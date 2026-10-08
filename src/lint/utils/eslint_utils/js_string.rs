//! JavaScript strings as the HIR stores them: UTF-8, in which half a surrogate pair is the three
//! bytes that its code point would have.

use bun_core::strings;
use std::borrow::Cow;

/// The UTF-16 code units of `text`.
pub(super) fn to_utf16(text: &[u8]) -> Vec<u16> {
    if strings::first_non_ascii(text).is_none() {
        return text.iter().map(|&byte| u16::from(byte)).collect();
    }
    let mut units = Vec::with_capacity(text.len());
    let mut at = 0;
    while let Some(&first) = text.get(at) {
        let continuation = |i: usize| text.get(at + i).map_or(0, |&byte| u32::from(byte & 0x3F));
        let (code_point, len) = match first {
            0..0x80 => (u32::from(first), 1),
            0x80..0xE0 => ((u32::from(first & 0x1F) << 6) | continuation(1), 2),
            0xE0..0xF0 => (
                (u32::from(first & 0x0F) << 12) | (continuation(1) << 6) | continuation(2),
                3,
            ),
            _ => (
                (u32::from(first & 0x07) << 18)
                    | (continuation(1) << 12)
                    | (continuation(2) << 6)
                    | continuation(3),
                4,
            ),
        };
        match code_point.checked_sub(0x10000) {
            Some(high) => {
                units.push(0xD800 | ((high >> 10) as u16 & 0x3FF));
                units.push(0xDC00 | (high as u16 & 0x3FF));
            }
            None => units.push(code_point as u16),
        }
        at += len;
    }
    units
}

pub(super) fn push_code_point(text: &mut Vec<u8>, c: u32) {
    match c {
        0..0x80 => text.push(c as u8),
        0x80..0x800 => text.extend_from_slice(&[0xC0 | (c >> 6) as u8, 0x80 | (c & 0x3F) as u8]),
        0x800..0x10000 => text.extend_from_slice(&[
            0xE0 | (c >> 12) as u8,
            0x80 | ((c >> 6) & 0x3F) as u8,
            0x80 | (c & 0x3F) as u8,
        ]),
        _ => text.extend_from_slice(&[
            0xF0 | ((c >> 18) & 0x07) as u8,
            0x80 | ((c >> 12) & 0x3F) as u8,
            0x80 | ((c >> 6) & 0x3F) as u8,
            0x80 | (c & 0x3F) as u8,
        ]),
    }
}

/// The code points of `units`. Half a surrogate pair is one.
pub(super) fn code_points_of(units: &[u16]) -> impl Iterator<Item = u32> + '_ {
    let mut at = 0;
    std::iter::from_fn(move || {
        let first = u32::from(*units.get(at)?);
        at += 1;
        if let (0xD800..0xDC00, Some(&second @ 0xDC00..0xE000)) = (first, units.get(at)) {
            at += 1;
            return Some(0x10000 + (((first & 0x3FF) << 10) | (u32::from(second) & 0x3FF)));
        }
        Some(first)
    })
}

pub(super) fn from_utf16(units: &[u16]) -> Vec<u8> {
    let mut text = Vec::with_capacity(units.len());
    code_points_of(units).for_each(|c| push_code_point(&mut text, c));
    text
}

/// `text.length`
pub(super) fn len_utf16(text: &[u8]) -> usize {
    match strings::first_non_ascii(text) {
        None => text.len(),
        Some(_) => (text.iter())
            .map(|&byte| usize::from(!(0x80..0xC0).contains(&byte)) + usize::from(byte >= 0xF0))
            .sum(),
    }
}

/// `a + b`. The two halves of a surrogate pair that meet become one code point.
pub(super) fn concat<'a>(a: Cow<'a, [u8]>, b: Cow<'a, [u8]>) -> Cow<'a, [u8]> {
    if a.is_empty() {
        return b;
    }
    if b.is_empty() {
        return a;
    }
    let mut text = a.into_owned();
    push_str(&mut text, &b);
    Cow::Owned(text)
}

/// `text += more`
pub(super) fn push_str(text: &mut Vec<u8>, more: &[u8]) {
    if let ([.., 0xED, high1 @ 0xA0..0xB0, high2], [0xED, low1 @ 0xB0..0xC0, low2, rest @ ..]) =
        (&text[..], more)
    {
        let high = (u32::from(high1 & 0x0F) << 6) | u32::from(high2 & 0x3F);
        let low = (u32::from(low1 & 0x0F) << 6) | u32::from(low2 & 0x3F);
        text.truncate(text.len() - 3);
        push_code_point(text, 0x10000 + ((high << 10) | low));
        text.extend_from_slice(rest);
        return;
    }
    text.extend_from_slice(more);
}

/// The order of `a < b`: by UTF-16 code units.
pub(super) fn compare(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    if strings::first_non_ascii(a).is_none() || strings::first_non_ascii(b).is_none() {
        return a.cmp(b);
    }
    to_utf16(a).cmp(&to_utf16(b))
}

/// The first index at or after `from` where `needle` is in `units`.
pub(super) fn index_of(units: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    let last = units.len().checked_sub(needle.len())?;
    (from..=last).find(|&at| units[at..].starts_with(needle))
}

/// The last index at or before `from` where `needle` is in `units`.
pub(super) fn last_index_of(units: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    let last = units.len().checked_sub(needle.len())?;
    (0..=last.min(from))
        .rev()
        .find(|&at| units[at..].starts_with(needle))
}
