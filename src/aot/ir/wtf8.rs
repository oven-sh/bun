#[cfg(test)]
mod tests;

use core::ops::RangeInclusive;

use bun_core::strings;
use smallvec::SmallVec;

const SURROGATE_LEAD_BYTE: u8 = 0xED;
const SURROGATE_LENGTH: usize = 3;
const HIGH_SURROGATES: RangeInclusive<u32> = 0xD800..=0xDBFF;
const LOW_SURROGATES: RangeInclusive<u32> = 0xDC00..=0xDFFF;

pub fn is_canonical_wtf8(bytes: &[u8]) -> bool {
    if strings::is_all_ascii(bytes) {
        return true;
    }
    let mut rest = bytes;
    let mut is_after_high_surrogate = false;
    while !rest.is_empty() {
        let Some((code_point, length)) = decode_wtf8_code_point(rest) else {
            return false;
        };
        if is_after_high_surrogate && LOW_SURROGATES.contains(&code_point) {
            return false;
        }
        is_after_high_surrogate = HIGH_SURROGATES.contains(&code_point);
        rest = &rest[length..];
    }
    true
}

pub(super) fn decode_wtf8_code_point(bytes: &[u8]) -> Option<(u32, usize)> {
    let (code_point, length) = strings::wtf8_codepoint_at(bytes, 0);
    let is_ill_formed = length == 1 && code_point == strings::UNICODE_REPLACEMENT;
    (length > 0 && !is_ill_formed).then_some((code_point, length))
}

fn decode_surrogate_pair(bytes: &[u8]) -> Option<u32> {
    let (high, length) = decode_wtf8_code_point(bytes)?;
    let (low, _) = decode_wtf8_code_point(&bytes[length..])?;
    strings::decode_surrogate_pair(u16::try_from(high).ok()?, u16::try_from(low).ok()?)
}

fn find_surrogate_pair(bytes: &[u8], mut from: usize) -> Option<(usize, u32)> {
    loop {
        let start = strings::index_of_char_pos(bytes, SURROGATE_LEAD_BYTE, from)?;
        if let Some(code_point) = decode_surrogate_pair(&bytes[start..]) {
            return Some((start, code_point));
        }
        from = start + 1;
    }
}

pub(super) fn join_surrogate_pairs(bytes: &[u8]) -> Option<SmallVec<[u8; 64]>> {
    let mut pair = Some(find_surrogate_pair(bytes, 0)?);
    let mut joined = SmallVec::new();
    let mut copied = 0;
    while let Some((start, code_point)) = pair {
        joined.extend_from_slice(&bytes[copied..start]);
        let mut encoded = [0; 4];
        let length = strings::encode_wtf8_rune(&mut encoded, code_point);
        joined.extend_from_slice(&encoded[..length]);
        copied = start + 2 * SURROGATE_LENGTH;
        pair = find_surrogate_pair(bytes, copied);
    }
    joined.extend_from_slice(&bytes[copied..]);
    Some(joined)
}
