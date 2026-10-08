//! The orders that module specifiers and names are sorted by.
//!
//! JavaScript compares strings by UTF-16 code units. Nearly all text here is ASCII and is compared
//! as bytes: everything is generic over [`Unit`], and other text is converted first.

use super::collation_tables::{EXPANSIONS, PRIMARY, SECONDARY, TERTIARY};
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

fn utf16(text: &[u8], is_lowercased: bool) -> Vec<u16> {
    let text = String::from_utf8_lossy(text);
    match is_lowercased {
        true => text.to_lowercase().encode_utf16().collect(),
        false => text.encode_utf16().collect(),
    }
}

#[inline]
fn is_digit<T: Unit>(unit: T) -> bool {
    matches!(unit.code(), 0x30..=0x39)
}

fn digits_at<T: Unit>(text: &[T], at: usize) -> usize {
    text.get(at..).unwrap_or_default().iter().take_while(|unit| is_digit(**unit)).count()
}

/// ECMAScript's `WhiteSpace` and `LineTerminator`.
fn is_js_whitespace(code: u32) -> bool {
    matches!(
        code,
        0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF
    )
}

fn ascii_of<T: Unit>(text: &[T]) -> String {
    text.iter().map(|unit| char::from_u32(unit.code()).filter(char::is_ascii).unwrap_or('?')).collect()
}

fn starts_with<T: Unit>(text: &[T], prefix: &[u8]) -> bool {
    text.len() >= prefix.len() && text.iter().zip(prefix).all(|(unit, byte)| unit.code() == u32::from(*byte))
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
    if text.get(len).is_some_and(|unit| matches!(unit.code(), 0x45 | 0x65)) {
        let sign = usize::from(text.get(len + 1).is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)));
        let exponent = digits_at(text, len + 1 + sign);
        if exponent > 0 {
            len += 1 + sign + exponent;
        }
    }
    len
}

/// `parseFloat(text)`. `None`: `NaN`.
fn parse_float<T: Unit>(text: &[T]) -> Option<f64> {
    let blank = text.iter().take_while(|unit| is_js_whitespace(unit.code())).count();
    let text = &text[blank..];
    let sign = usize::from(text.first().is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)));
    let is_negative = sign == 1 && text[0].code() == 0x2D;
    let unsigned = &text[sign..];
    let value = match starts_with(unsigned, b"Infinity") {
        true => f64::INFINITY,
        false => match decimal_literal_len(unsigned) {
            0 => return None,
            len => ascii_of(&unsigned[..len]).parse::<f64>().ok()?,
        },
    };
    Some(if is_negative { -value } else { value })
}

/// `isNaN(text)`
fn is_nan_as_number<T: Unit>(text: &[T]) -> bool {
    let start = text.iter().take_while(|unit| is_js_whitespace(unit.code())).count();
    let end = text.len() - text[start..].iter().rev().take_while(|unit| is_js_whitespace(unit.code())).count();
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
            return !text[2..].iter().all(|unit| char::from_u32(unit.code()).is_some_and(|it| it.is_digit(radix)));
        }
    }
    let sign = usize::from(matches!(text[0].code(), 0x2B | 0x2D));
    let unsigned = &text[sign..];
    !(ascii_of(unsigned) == "Infinity" || (!unsigned.is_empty() && decimal_literal_len(unsigned) == unsigned.len()))
}

// ───────────────────────────── javascript-natural-sort ─────────────────────────────

/// Whether all of `text` is `[+-]?(0|[1-9]\d*)(\.\d*)?([eE][+-]?\d+)?`.
fn is_number<T: Unit>(text: &[T]) -> bool {
    let mut at = usize::from(text.first().is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)));
    match text.get(at).map(|unit| unit.code()) {
        Some(0x30) => at += 1,
        Some(0x31..=0x39) => at += digits_at(text, at),
        _ => return false,
    }
    if text.get(at).is_some_and(|unit| unit.code() == 0x2E) {
        at += 1 + digits_at(text, at + 1);
    }
    if text.get(at).is_some_and(|unit| matches!(unit.code(), 0x45 | 0x65)) {
        let sign = usize::from(text.get(at + 1).is_some_and(|unit| matches!(unit.code(), 0x2B | 0x2D)));
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
    digits.iter().try_fold(0.0, |value, unit| Some(value * 16.0 + f64::from(char::from_u32(unit.code())?.to_digit(16)?)))
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
            false => rest.iter().take_while(|unit| is_digit(**unit) == is_digit(first)).count(),
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
    number.iter().map(|byte| u32::from(*byte)).cmp(text.iter().map(|unit| unit.code()))
}

fn natural_sort_units<T: Unit>(x: &[T], y: &[T]) -> Ordering {
    let trim = |text: &'_ [T]| -> (usize, usize) {
        let start = text.iter().take_while(|unit| unit.code() == 0x20).count();
        let end = text.len() - text[start..].iter().rev().take_while(|unit| unit.code() == 0x20).count();
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

    let (mut x_chunks, mut y_chunks) = (Chunks::new(x), Chunks::new(y));
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
        return natural_sort_units(&x.to_ascii_lowercase(), &y.to_ascii_lowercase());
    }
    natural_sort_units(x, y)
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

// ───────────────────────────── Intl.Collator ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum Element<'t> {
    /// The ranks of the primary, secondary and tertiary weights of a character.
    Weights(u32, u8, u8),
    /// With `numeric`: digits, without zeros at their start.
    Number(&'t [u8]),
}

struct Elements<'t> {
    text: &'t [u8],
    is_numeric: bool,
    /// The second letter of an expansion.
    pending: Option<Element<'t>>,
}

impl<'t> Iterator for Elements<'t> {
    type Item = Element<'t>;

    fn next(&mut self) -> Option<Element<'t>> {
        if let Some(pending) = self.pending.take() {
            return Some(pending);
        }
        loop {
            let &first = self.text.first()?;
            if self.is_numeric && first.is_ascii_digit() {
                let len = self.text.iter().take_while(|byte| byte.is_ascii_digit()).count();
                let (digits, rest) = self.text.split_at(len);
                self.text = rest;
                let zeros = digits.iter().take_while(|byte| **byte == b'0').count();
                return Some(Element::Number(&digits[zeros..]));
            }
            let (code, len) = match first.is_ascii() {
                true => (u32::from(first), 1),
                false => {
                    let (code, len) = bun_core::lexer::char_and_size(self.text, 0);
                    (code as u32, len.max(1))
                }
            };
            self.text = self.text.get(len..).unwrap_or_default();
            let at = code as usize;
            match PRIMARY.get(at) {
                Some(0) => {}
                Some(255) => {
                    let letters = EXPANSIONS.iter().find(|it| u32::from(it.0) == code).map_or(*b"??", |it| it.1);
                    let letter = |byte: u8| Element::Weights(u32::from(PRIMARY[usize::from(byte)]), 0, 2);
                    self.pending = Some(letter(letters[1]));
                    return Some(letter(letters[0]));
                }
                Some(&primary) => return Some(Element::Weights(u32::from(primary), SECONDARY[at], TERTIARY[at])),
                // Combining marks
                None if matches!(code, 0x300..=0x36F) => {}
                None => return Some(Element::Weights(0x1000 + code, 0, 0)),
            }
        }
    }
}

fn compare_primary(a: Element, b: Element) -> Ordering {
    let after_digits = u32::from(PRIMARY[usize::from(b'9')]);
    match (a, b) {
        (Element::Weights(a, ..), Element::Weights(b, ..)) => a.cmp(&b),
        (Element::Number(a), Element::Number(b)) => a.len().cmp(&b.len()).then_with(|| a.cmp(b)),
        (Element::Number(_), Element::Weights(b, ..)) => if b > after_digits { Ordering::Less } else { Ordering::Greater },
        (Element::Weights(a, ..), Element::Number(_)) => if a > after_digits { Ordering::Greater } else { Ordering::Less },
    }
}

fn elements(text: &[u8], is_numeric: bool) -> Elements<'_> {
    Elements {
        text,
        is_numeric,
        pending: None,
    }
}

fn compare_by<'t>(a: Elements<'t>, b: Elements<'t>, compare: impl Fn(Element<'t>, Element<'t>) -> Ordering) -> Ordering {
    let (mut a, mut b) = (a, b);
    loop {
        match (a.next(), b.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(a), Some(b)) => match compare(a, b) {
                Ordering::Equal => {}
                order => return order,
            },
        }
    }
}

/// `a.localeCompare(b, "en", { sensitivity: "base", numeric: true })`: the plugin's `naturalSort`.
pub(super) fn collate_base_numeric(a: &[u8], b: &[u8]) -> Ordering {
    compare_by(elements(a, true), elements(b, true), compare_primary)
}

/// `a.localeCompare(b)`
pub(super) fn locale_compare(a: &[u8], b: &[u8]) -> Ordering {
    let level = |pick: fn(Element) -> u8| compare_by(elements(a, false), elements(b, false), move |a, b| pick(a).cmp(&pick(b)));
    compare_by(elements(a, false), elements(b, false), compare_primary)
        .then_with(|| level(|it| if let Element::Weights(_, secondary, _) = it { secondary } else { 0 }))
        .then_with(|| level(|it| if let Element::Weights(_, _, tertiary) = it { tertiary } else { 0 }))
}
