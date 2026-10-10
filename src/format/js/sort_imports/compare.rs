//! The orders that module specifiers and names are sorted by.
//!
//! JavaScript compares strings by UTF-16 code units. Nearly all text here is ASCII and is compared
//! as bytes: everything is generic over [`Unit`], and other text is converted first.

use bstr::ByteSlice;
use smallvec::SmallVec;
use std::cmp::Ordering;

/// A UTF-16 code unit, or a byte of ASCII text.
pub(super) trait Unit: Copy + Ord {
    fn code(self) -> u32;
}

impl Unit for u8 {
    #[inline]
    fn code(self) -> u32 {
        u32::from(self)
    }
}

impl Unit for u16 {
    #[inline]
    fn code(self) -> u32 {
        u32::from(self)
    }
}

/// `text.toLowerCase()`
pub(super) fn lowercase(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for lower in text.chars().flat_map(char::to_lowercase) {
        out.extend_from_slice(lower.encode_utf8(&mut [0; 4]).as_bytes());
    }
    out
}

fn utf16(text: &[u8], is_lowercased: bool) -> Vec<u16> {
    let units = |text: &[u8]| {
        text.chars()
            .flat_map(|it| it.encode_utf16(&mut [0; 2]).to_vec())
            .collect()
    };
    match is_lowercased {
        true => units(&lowercase(text)),
        false => units(text),
    }
}

#[inline]
fn is_digit<T: Unit>(unit: T) -> bool {
    matches!(unit.code(), 0x30..=0x39)
}

fn digits_at<T: Unit>(text: &[T], at: usize) -> usize {
    text.get(at..)
        .unwrap_or_default()
        .iter()
        .take_while(|unit| is_digit(**unit))
        .count()
}

fn ascii_of<T: Unit>(text: &[T]) -> String {
    text.iter()
        .map(|unit| {
            char::from_u32(unit.code())
                .filter(char::is_ascii)
                .unwrap_or('?')
        })
        .collect()
}

fn starts_with<T: Unit>(text: &[T], prefix: &[u8]) -> bool {
    text.len() >= prefix.len()
        && text
            .iter()
            .zip(prefix)
            .all(|(unit, byte)| unit.code() == u32::from(*byte))
}

/// How many units at the start of `text` are a `StrUnsignedDecimalLiteral` other than `Infinity`.
fn decimal_literal_len<T: Unit>(text: &[T]) -> usize {
    let whole = digits_at(text, 0);
    let mut len = whole;
    let mut fraction = 0;
    if text.get(len).is_some_and(|unit| unit.code() == 0x2E) {
        fraction = digits_at(text, len + 1);
        if whole > 0 || fraction > 0 {
            len += 1 + fraction;
        }
    }
    if whole == 0 && fraction == 0 {
        return 0;
    }
    if text
        .get(len)
        .is_some_and(|unit| matches!(unit.code(), 0x45 | 0x65))
    {
        let sign = usize::from(
            text.get(len + 1)
                .is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)),
        );
        let exponent = digits_at(text, len + 1 + sign);
        if exponent > 0 {
            len += 1 + sign + exponent;
        }
    }
    len
}

/// `parseFloat(text)`. `None`: `NaN`.
fn parse_float<T: Unit>(text: &[T]) -> Option<f64> {
    let blank = text
        .iter()
        .take_while(|unit| bun_core::strings::is_js_whitespace(unit.code()))
        .count();
    let text = &text[blank..];
    let sign = usize::from(
        text.first()
            .is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)),
    );
    let is_negative = sign == 1 && text[0].code() == 0x2D;
    let unsigned = &text[sign..];
    let value = match starts_with(unsigned, b"Infinity") {
        true => f64::INFINITY,
        false => match decimal_literal_len(unsigned) {
            0 => return None,
            // Nearly always a few digits.
            len @ ..=15 if digits_at(unsigned, 0) == len => {
                unsigned[..len].iter().fold(0u64, |value, unit| {
                    value * 10 + u64::from(unit.code() - 0x30)
                }) as f64
            }
            len => ascii_of(&unsigned[..len]).parse::<f64>().ok()?,
        },
    };
    Some(if is_negative { -value } else { value })
}

/// `isNaN(text)`
fn is_nan_as_number<T: Unit>(text: &[T]) -> bool {
    // What nearly all text starts with.
    if text.first().is_some_and(
        |unit| matches!(unit.code(), 0x21..=0x2A | 0x2C | 0x2E | 0x2F | 0x3A..=0x48 | 0x4A..=0x7E),
    ) {
        return true;
    }
    let start = text
        .iter()
        .take_while(|unit| bun_core::strings::is_js_whitespace(unit.code()))
        .count();
    let end = text.len()
        - text[start..]
            .iter()
            .rev()
            .take_while(|unit| bun_core::strings::is_js_whitespace(unit.code()))
            .count();
    let text = &text[start..end];
    if text.is_empty() {
        return false;
    }
    if text.len() > 2 && text[0].code() == 0x30 {
        let radix = match text[1].code() | 0x20 {
            0x78 => 16,
            0x6F => 8,
            0x62 => 2,
            _ => 0,
        };
        if radix != 0 {
            return !text[2..]
                .iter()
                .all(|unit| char::from_u32(unit.code()).is_some_and(|it| it.is_digit(radix)));
        }
    }
    let sign = usize::from(matches!(text[0].code(), 0x2B | 0x2D));
    let unsigned = &text[sign..];
    !((unsigned.len() == 8 && starts_with(unsigned, b"Infinity"))
        || (!unsigned.is_empty() && decimal_literal_len(unsigned) == unsigned.len()))
}

// ───────────────────────────── javascript-natural-sort ─────────────────────────────

/// Whether all of `text` is `[+-]?(0|[1-9]\d*)(\.\d*)?([eE][+-]?\d+)?`.
fn is_number<T: Unit>(text: &[T]) -> bool {
    let mut at = usize::from(
        text.first()
            .is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)),
    );
    match text.get(at).map(|unit| unit.code()) {
        Some(0x30) => at += 1,
        Some(0x31..=0x39) => at += digits_at(text, at),
        _ => return false,
    }
    if text.get(at).is_some_and(|unit| unit.code() == 0x2E) {
        at += 1 + digits_at(text, at + 1);
    }
    if text
        .get(at)
        .is_some_and(|unit| matches!(unit.code(), 0x45 | 0x65))
    {
        let sign = usize::from(
            text.get(at + 1)
                .is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)),
        );
        match digits_at(text, at + 1 + sign) {
            0 => return false,
            exponent => at += 1 + sign + exponent,
        }
    }
    at == text.len()
}

/// The value of `text` if all of it is `0x[0-9a-f]+`, in either case.
fn hexadecimal<T: Unit>(text: &[T]) -> Option<f64> {
    let digits = text.get(2..).filter(|digits| !digits.is_empty())?;
    if text[0].code() != 0x30 || text[1].code() | 0x20 != 0x78 {
        return None;
    }
    digits.iter().try_fold(0.0, |value, unit| {
        Some(value * 16.0 + f64::from(char::from_u32(unit.code())?.to_digit(16)?))
    })
}

/// The chunks of `text`: runs of digits and what is between them. A number is one chunk.
struct Chunks<'t, T> {
    text: &'t [T],
    at: usize,
    is_whole: bool,
}

impl<'t, T: Unit> Chunks<'t, T> {
    fn new(text: &'t [T]) -> Self {
        Chunks {
            text,
            at: 0,
            is_whole: text.is_empty() || is_number(text) || hexadecimal(text).is_some(),
        }
    }
}

impl<'t, T: Unit> Iterator for Chunks<'t, T> {
    type Item = &'t [T];

    fn next(&mut self) -> Option<&'t [T]> {
        let rest = self.text.get(self.at..)?;
        let first = *rest.first()?;
        let len = match self.is_whole {
            true => rest.len(),
            false => rest
                .iter()
                .take_while(|unit| is_digit(**unit) == is_digit(first))
                .count(),
        };
        self.at += len;
        Some(&rest[..len])
    }
}

enum Value<'t, T> {
    Number(f64),
    Text(&'t [T]),
}

/// `!(chunk || '').match(/^0/) && parseFloat(chunk) || chunk || 0`
fn value_of<T: Unit>(chunk: Option<&[T]>) -> Value<'_, T> {
    let Some(chunk) = chunk.filter(|chunk| !chunk.is_empty()) else {
        return Value::Number(0.0);
    };
    match parse_float(chunk).filter(|number| chunk[0].code() != 0x30 && *number != 0.0) {
        Some(number) => Value::Number(number),
        None => Value::Text(chunk),
    }
}

fn compare_number_with_text<T: Unit>(number: f64, text: &[T]) -> Ordering {
    let mut buffer = [0; 124];
    let number = bun_core::fmt::FormatDouble::dtoa(&mut buffer, number);
    number
        .iter()
        .map(|byte| u32::from(*byte))
        .cmp(text.iter().map(|unit| unit.code()))
}

fn natural_sort_units<T: Unit>(x: &[T], y: &[T]) -> Ordering {
    let trim = |text: &'_ [T]| -> (usize, usize) {
        let start = text.iter().take_while(|unit| unit.code() == 0x20).count();
        let end = text.len()
            - text[start..]
                .iter()
                .rev()
                .take_while(|unit| unit.code() == 0x20)
                .count();
        (start, end)
    };
    let ((x_start, x_end), (y_start, y_end)) = (trim(x), trim(y));
    let (x, y) = (&x[x_start..x_end], &y[y_start..y_end]);

    // Dates, which `Date.parse` is asked about, are not recognized.
    if let Some(y_value) = hexadecimal(y).filter(|value| *value != 0.0) {
        match hexadecimal(x).unwrap_or(0.0).total_cmp(&y_value) {
            Ordering::Equal => {}
            order => return order,
        }
    }

    compare_chunks(Chunks::new(x), Chunks::new(y))
}

fn compare_chunks<T: Unit>(mut x_chunks: Chunks<T>, mut y_chunks: Chunks<T>) -> Ordering {
    loop {
        let (x_chunk, y_chunk) = (x_chunks.next(), y_chunks.next());
        if x_chunk.is_none() && y_chunk.is_none() {
            return Ordering::Equal;
        }
        let order = match (value_of(x_chunk), value_of(y_chunk)) {
            (Value::Number(x), Value::Number(y)) => x.total_cmp(&y),
            (Value::Text(x), Value::Text(y)) => match (is_nan_as_number(x), is_nan_as_number(y)) {
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                _ => x.cmp(y),
            },
            (Value::Number(_), Value::Text(y)) if is_nan_as_number(y) => Ordering::Less,
            (Value::Text(x), Value::Number(_)) if is_nan_as_number(x) => Ordering::Greater,
            (Value::Number(x), Value::Text(y)) => compare_number_with_text(x, y),
            (Value::Text(x), Value::Number(y)) => compare_number_with_text(y, x).reverse(),
        };
        if order != Ordering::Equal {
            return order;
        }
    }
}

/// `naturalSort(x, y)` of the package `javascript-natural-sort`, 0.7.1. `is_insensitive`:
/// `naturalSort.insensitive`.
pub(super) fn natural_sort(x: &[u8], y: &[u8], is_insensitive: bool) -> Ordering {
    if !x.is_ascii() || !y.is_ascii() {
        return natural_sort_units(&utf16(x, is_insensitive), &utf16(y, is_insensitive));
    }
    if is_insensitive && (x.iter().chain(y).any(u8::is_ascii_uppercase)) {
        let lowercase = |text: &[u8]| {
            text.iter()
                .map(u8::to_ascii_lowercase)
                .collect::<SmallVec<[u8; 64]>>()
        };
        return natural_sort_ascii(&lowercase(x), &lowercase(y));
    }
    natural_sort_ascii(x, y)
}

fn natural_sort_ascii(x: &[u8], y: &[u8]) -> Ordering {
    // Neither a number nor anything to trim: only the chunks from where the two differ count.
    let is_plain = |text: &[u8]| {
        text.first()
            .is_some_and(|first| !first.is_ascii_digit() && !matches!(first, b'+' | b'-' | b' '))
            && text.last() != Some(&b' ')
    };
    if !is_plain(x) || !is_plain(y) {
        return natural_sort_units(x, y);
    }
    let common = x.iter().zip(y).take_while(|(x, y)| x == y).count();
    // Nearly always they differ in the middle of text that is no number.
    let is_text =
        |byte: u8| matches!(byte, 0x21..=0x2A | 0x2C | 0x2E | 0x2F | 0x3A..=0x48 | 0x4A..=0x7E);
    if let (Some(&x_byte), Some(&y_byte)) = (x.get(common), y.get(common))
        && !x_byte.is_ascii_digit()
        && !y_byte.is_ascii_digit()
    {
        let text_start = common
            - x[..common]
                .iter()
                .rev()
                .take_while(|byte| !byte.is_ascii_digit())
                .count();
        if if text_start < common {
            is_text(x[text_start])
        } else {
            is_text(x_byte) && is_text(y_byte)
        } {
            return x_byte.cmp(&y_byte);
        }
    }
    let mut start = common;
    if let Some(before) = common.checked_sub(1) {
        start -= x[..common]
            .iter()
            .rev()
            .take_while(|byte| byte.is_ascii_digit() == x[before].is_ascii_digit())
            .count();
    }
    let chunks = |text| Chunks {
        text,
        at: 0,
        is_whole: false,
    };
    compare_chunks(chunks(&x[start..]), chunks(&y[start..]))
}

// ───────────────────────────── @ianvs/prettier-plugin-sort-imports ─────────────────────────────

fn natural_sort_case_sensitive_units<T: Unit>(a: &[T], b: &[T]) -> Ordering {
    let (mut a_index, mut b_index) = (0, 0);
    while a_index < a.len().max(b.len()) {
        match (digits_at(a, a_index), digits_at(b, b_index)) {
            (0, 0) => {}
            (_, 0) => return Ordering::Less,
            (0, _) => return Ordering::Greater,
            (a_digits, b_digits) => {
                let number = |text: &[T]| ascii_of(text).parse::<f64>().unwrap_or(f64::INFINITY);
                let a_number = number(&a[a_index..a_index + a_digits]);
                match a_number.total_cmp(&number(&b[b_index..b_index + b_digits])) {
                    Ordering::Equal => {}
                    order => return order,
                }
                a_index += a_digits;
                b_index += b_digits;
            }
        }
        match (a.get(a_index), b.get(b_index)) {
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            (Some(a), Some(b)) if a != b => return a.cmp(b),
            _ => {}
        }
        a_index += 1;
        b_index += 1;
    }
    Ordering::Equal
}

/// The plugin's `naturalSortCaseSensitive`.
pub(super) fn natural_sort_case_sensitive(a: &[u8], b: &[u8]) -> Ordering {
    match a.is_ascii() && b.is_ascii() {
        true => natural_sort_case_sensitive_units(a, b),
        false => natural_sort_case_sensitive_units(&utf16(a, false), &utf16(b, false)),
    }
}

// ───────────────────────────── natord ─────────────────────────────

fn natord_chars(left: impl Iterator<Item = char>, right: impl Iterator<Item = char>) -> Ordering {
    let (mut left, mut right) = (left.fuse(), right.fuse());
    let digit = |c: Option<char>| c.and_then(|c| c.to_digit(10));
    let (mut l, mut r) = (left.next(), right.next());
    loop {
        while l.is_some_and(char::is_whitespace) {
            l = left.next();
        }
        while r.is_some_and(char::is_whitespace) {
            r = right.next();
        }
        match (l, r) {
            (None, None) => return Ordering::Equal,
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            (Some(l_char), Some(r_char)) => {
                let (Some(l_digit), Some(r_digit)) = (digit(l), digit(r)) else {
                    if l_char != r_char {
                        return l_char.cmp(&r_char);
                    }
                    (l, r) = (left.next(), right.next());
                    continue;
                };
                // With a zero at the start, digits are compared from the left: `015` < `12`.
                // Otherwise the longer number is the greater one: `15` < `123`.
                let is_left_aligned = l_digit == 0 || r_digit == 0;
                let mut order = l_digit.cmp(&r_digit);
                loop {
                    if is_left_aligned && order != Ordering::Equal {
                        return order;
                    }
                    (l, r) = (left.next(), right.next());
                    match (digit(l), digit(r)) {
                        (Some(l_digit), Some(r_digit)) => order = order.then(l_digit.cmp(&r_digit)),
                        (Some(_), None) => return Ordering::Greater,
                        (None, Some(_)) => return Ordering::Less,
                        (None, None) => break,
                    }
                }
                if order != Ordering::Equal {
                    return order;
                }
            }
        }
    }
}

/// `natord::compare` of the crate `natord`, 1.0.9. `ignores_case`: of the two in lower case.
pub(super) fn natord(left: &[u8], right: &[u8], ignores_case: bool) -> Ordering {
    if left.is_ascii() && right.is_ascii() {
        let char_of = |byte: &u8| {
            char::from(if ignores_case {
                byte.to_ascii_lowercase()
            } else {
                *byte
            })
        };
        return natord_chars(left.iter().map(char_of), right.iter().map(char_of));
    }
    match ignores_case {
        true => natord_chars(lowercase(left).chars(), lowercase(right).chars()),
        false => natord_chars(left.chars(), right.chars()),
    }
}
