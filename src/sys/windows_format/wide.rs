//! Between WTF-8 and names, which are UTF-16 that may hold half of a surrogate pair.

use bun_core::WStr;
use bun_core::strings::{
    UNICODE_REPLACEMENT, encode_surrogate_pair, encode_wtf8_rune, u16_is_lead, u16_is_trail,
    wtf8_codepoint_at,
};

#[derive(Debug, PartialEq, Eq)]
pub enum EncodeError {
    /// Not WTF-8, or it holds a NUL.
    Malformed,
    TooLong,
}

pub fn encode<'a>(text: &[u8], buf: &'a mut [u16]) -> Result<&'a WStr, EncodeError> {
    let (mut at, mut len) = (0, 0);
    let mut last = 0;
    while let Some(&byte) = text.get(at) {
        let (code_point, size) = match byte {
            1..0x80 => (u32::from(byte), 1),
            _ => wtf8_codepoint_at(text, at),
        };
        at += size;
        let unit = match u16::try_from(code_point) {
            _ if matches!((code_point, size), (0 | UNICODE_REPLACEMENT, 1)) => {
                return Err(EncodeError::Malformed);
            }
            // A pair has four bytes.
            Ok(unit) if u16_is_trail(unit) && u16_is_lead(last) => {
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
        last = unit;
    }
    *buf.get_mut(len).ok_or(EncodeError::TooLong)? = 0;
    Ok(WStr::from_buf(buf, len))
}

fn code_points(units: impl IntoIterator<Item = u16>) -> impl Iterator<Item = u32> {
    char::decode_utf16(units)
        .map(|it| it.map_or_else(|half| half.unpaired_surrogate().into(), u32::from))
}

/// Returns the length written, or `None` if `buf` is too small.
pub fn decode(units: impl IntoIterator<Item = u16>, buf: &mut [u8]) -> Option<usize> {
    let mut len = 0;
    for code_point in code_points(units) {
        let mut bytes = [0; 4];
        let size = encode_wtf8_rune(&mut bytes, code_point);
        buf.get_mut(len..len + size)?
            .copy_from_slice(&bytes[..size]);
        len += size;
    }
    Some(len)
}

pub(crate) fn decoded_len(units: impl IntoIterator<Item = u16>) -> usize {
    code_points(units)
        .map(|code_point| encode_wtf8_rune(&mut [0; 4], code_point))
        .sum()
}

/// The text ends at the first NUL, or with `units`.
pub(crate) fn decode_until_nul(units: impl Iterator<Item = u16> + Clone) -> Vec<u8> {
    let units = units.take_while(|&unit| unit != 0);
    let mut text = vec![0; decoded_len(units.clone())];
    decode(units, &mut text).expect("measured");
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
            let mut wide = vec![1; units.len() + 1];
            assert_eq!(encode(text, &mut wide).unwrap().as_slice(), units);
            let short = encode(text, &mut wide[..units.len()]);
            assert_eq!(short.err(), Some(EncodeError::TooLong));

            let mut narrow = vec![0; text.len()];
            let units = units.iter().copied();
            assert_eq!(decode(units.clone(), &mut narrow), Some(text.len()));
            assert_eq!(narrow, text);
            assert_eq!(decoded_len(units.clone()), text.len());
            if let Some((_, short)) = narrow.split_last_mut() {
                assert_eq!(decode(units, short), None);
            }
        }
    }

    #[test]
    fn stops_at_a_nul_or_at_the_end() {
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
    fn takes_well_formed_text_only() {
        for text in [&b"\x80"[..], b"\xFF", b"a\0b", b"\xC3", b"\xE2\x82"] {
            let error = encode(text, &mut [0; 8]).err();
            assert_eq!(error, Some(EncodeError::Malformed));
        }
    }
}
