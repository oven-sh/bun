//! Conversion between WTF-8 and WTF-16 (UTF-16 that may contain unpaired surrogates).

use bun_core::WStr;
use bun_core::strings::{
    UNICODE_REPLACEMENT, encode_surrogate_pair, encode_wtf8_rune, u16_is_lead, u16_is_trail,
    wtf8_codepoint_at,
};

#[derive(Debug, PartialEq, Eq)]
pub enum EncodeError {
    /// Not WTF-8, or contains a NUL.
    Malformed,
    TooLong,
}

pub fn encode<'a>(text: &[u8], buf: &'a mut [u16]) -> Result<&'a WStr, EncodeError> {
    let mut offset = 0;
    let mut len = 0;
    let mut previous_unit = 0;
    while let Some(&byte) = text.get(offset) {
        let (code_point, sequence_len) = match byte {
            1..0x80 => (u32::from(byte), 1),
            _ => wtf8_codepoint_at(text, offset),
        };
        offset += sequence_len;
        if matches!((code_point, sequence_len), (0 | UNICODE_REPLACEMENT, 1)) {
            return Err(EncodeError::Malformed);
        }
        let unit = match u16::try_from(code_point) {
            // WTF-8 encodes a surrogate pair as one four-byte sequence.
            Ok(unit) if u16_is_trail(unit) && u16_is_lead(previous_unit) => {
                return Err(EncodeError::Malformed);
            }
            Ok(unit) => unit,
            Err(_) => {
                let [lead, trail] = encode_surrogate_pair(code_point);
                *buf.get_mut(len).ok_or(EncodeError::TooLong)? = lead;
                len += 1;
                trail
            }
        };
        *buf.get_mut(len).ok_or(EncodeError::TooLong)? = unit;
        len += 1;
        previous_unit = unit;
    }
    *buf.get_mut(len).ok_or(EncodeError::TooLong)? = 0;
    Ok(WStr::from_buf(buf, len))
}

fn code_points(units: impl IntoIterator<Item = u16>) -> impl Iterator<Item = u32> {
    char::decode_utf16(units)
        .map(|result| result.map_or_else(|error| error.unpaired_surrogate().into(), u32::from))
}

/// Returns the length written, or `None` if `buf` is too small.
pub(crate) fn decode(units: impl IntoIterator<Item = u16>, buf: &mut [u8]) -> Option<usize> {
    let mut len = 0;
    for code_point in code_points(units) {
        let mut bytes = [0; 4];
        let sequence_len = encode_wtf8_rune(&mut bytes, code_point);
        buf.get_mut(len..len + sequence_len)?
            .copy_from_slice(&bytes[..sequence_len]);
        len += sequence_len;
    }
    Some(len)
}

pub(crate) fn decoded_len(units: impl IntoIterator<Item = u16>) -> usize {
    code_points(units)
        .map(|code_point| encode_wtf8_rune(&mut [0; 4], code_point))
        .sum()
}

/// Decodes all of `units` if there is no NUL.
pub(crate) fn decode_until_nul(units: impl Iterator<Item = u16> + Clone) -> Vec<u8> {
    let units = units.take_while(|&unit| unit != 0);
    let mut text = vec![0; decoded_len(units.clone())];
    decode(units, &mut text).expect("buffer is sized by decoded_len");
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for (text, units) in [
            (&b""[..], &[][..]),
            (b"C:\\a", &[0x43, 0x3A, 0x5C, 0x61]),
            ("\u{80}\u{7FF}".as_bytes(), &[0x80, 0x7FF]),
            ("\u{800}\u{FFFD}".as_bytes(), &[0x800, 0xFFFD]),
            ("\u{10000}".as_bytes(), &[0xD800, 0xDC00]),
            ("\u{10FFFF}".as_bytes(), &[0xDBFF, 0xDFFF]),
            (b"\xED\xA0\x80a", &[0xD800, 0x61]),
            (b"\xED\xB0\x80\xED\xA0\x80", &[0xDC00, 0xD800]),
            (b"\xF0\x90\x80\x80\xED\xB0\x80", &[0xD800, 0xDC00, 0xDC00]),
        ] {
            let mut encoded = vec![1; units.len() + 1];
            assert_eq!(encode(text, &mut encoded).unwrap().as_slice(), units);
            let result = encode(text, &mut encoded[..units.len()]);
            assert_eq!(result.err(), Some(EncodeError::TooLong));

            let mut decoded = vec![0; text.len()];
            let units = units.iter().copied();
            assert_eq!(decode(units.clone(), &mut decoded), Some(text.len()));
            assert_eq!(decoded, text);
            assert_eq!(decoded_len(units.clone()), text.len());
            if let Some((_, short_buf)) = decoded.split_last_mut() {
                assert_eq!(decode(units, short_buf), None);
            }
        }
    }

    #[test]
    fn decode_until_nul_stops_at_nul_or_end() {
        for (units, text) in [
            (&[][..], &b""[..]),
            (&[0, 0x61], b""),
            (&[0x61, 0xD800, 0, 0x62], b"a\xED\xA0\x80"),
            (&[0x61, 0xD800, 0xDC00], b"a\xF0\x90\x80\x80"),
        ] {
            assert_eq!(decode_until_nul(units.iter().copied()), text);
        }
    }

    #[test]
    fn encode_reports_malformed_text() {
        for text in [&b"\x80"[..], b"\xFF", b"a\0b", b"\xC3", b"\xE2\x82"] {
            let error = encode(text, &mut [0; 8]).err();
            assert_eq!(error, Some(EncodeError::Malformed));
        }
    }
}
