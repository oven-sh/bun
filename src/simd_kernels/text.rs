//! Searches for bytes. The functions are inlined so that the dispatch is at the call site, but for debug builds, in
//! which this crate is optimized and the caller is not.

use super::search;

/// Answers without a call what is often all there is between two tokens: nothing, one byte, or a match right away.
#[inline(always)]
fn first_or(
    text: &[u8],
    matches: impl Fn(u8) -> bool,
    search: impl Fn() -> Option<usize>,
) -> Option<usize> {
    match *text {
        [first, ..] if matches(first) => Some(0),
        [] | [_] => None,
        _ => search(),
    }
}

/// As [`first_or`], from the end of a short text.
#[inline(always)]
fn last_or(
    text: &[u8],
    matches: impl Fn(u8) -> bool,
    search: impl Fn() -> Option<usize>,
) -> Option<usize> {
    match *text {
        [.., last] if matches(last) & (text.len() < 64) => Some(text.len() - 1),
        [] | [_] => None,
        _ => search(),
    }
}

#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_char(haystack: &[u8], needle: u8) -> Option<usize> {
    first_or(
        haystack,
        |it| it == needle,
        || search::index_of_char(haystack, needle),
    )
}

#[cfg_attr(not(debug_assertions), inline(always))]
pub fn last_index_of_char(haystack: &[u8], needle: u8) -> Option<usize> {
    last_or(
        haystack,
        |it| it == needle,
        || search::last_index_of_char(haystack, needle),
    )
}

/// Index of the first byte that is not `value` (i.e. the length of the leading
/// run of `value`), or `None` if every byte is `value`.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_not_char(haystack: &[u8], value: u8) -> Option<usize> {
    first_or(
        haystack,
        |it| it != value,
        || search::index_of_not_char(haystack, value),
    )
}

#[cfg_attr(not(debug_assertions), inline(always))]
pub fn count_char(haystack: &[u8], needle: u8) -> usize {
    match *haystack {
        [] => 0,
        [only] => usize::from(only == needle),
        _ => search::count_char(haystack, needle),
    }
}

/// It folds to a constant for a literal.
#[inline(always)]
fn ascii_set(chars: &[u8]) -> Option<u128> {
    let (mut lower, mut upper, mut all) = (0u64, 0u64, 0);
    for &char in chars {
        let (bit, is_upper) = (1 << (8 * (char & 7) + (char >> 4 & 7)), char & 8 != 0);
        lower |= if is_upper { 0 } else { bit };
        upper |= if is_upper { bit } else { 0 };
        all |= char;
    }
    all.is_ascii()
        .then_some(u128::from(upper) << 64 | u128::from(lower))
}

#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_any_char(haystack: &[u8], chars: &[u8]) -> Option<usize> {
    match *chars {
        [a, b] => first_or(
            haystack,
            |it| it == a || it == b,
            || search::index_of_either(haystack, a, b),
        ),
        [a, b, c] => first_or(
            haystack,
            |it| it == a || it == b || it == c,
            || search::index_of_one_of_four(haystack, a, b, c, c),
        ),
        [a, b, c, d] => first_or(
            haystack,
            |it| it == a || it == b || it == c || it == d,
            || search::index_of_one_of_four(haystack, a, b, c, d),
        ),
        _ => match ascii_set(chars) {
            Some(set) => search::index_of_any_ascii(haystack, set),
            None => search::index_of_many(haystack, chars),
        },
    }
}

/// [`index_of_any_char`] for many `chars` that are not known at compile time, if a match is likely to be near.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_any_char_nearby(haystack: &[u8], chars: &[u8]) -> Option<usize> {
    search::index_of_many(haystack, chars)
}

#[cfg_attr(not(debug_assertions), inline(always))]
pub fn last_index_of_any_char(haystack: &[u8], chars: &[u8]) -> Option<usize> {
    match *chars {
        [a, b] => last_or(
            haystack,
            |it| it == a || it == b,
            || search::last_index_of_either(haystack, a, b),
        ),
        [a, b, c] => search::last_index_of_one_of_four(haystack, a, b, c, c),
        [a, b, c, d] => search::last_index_of_one_of_four(haystack, a, b, c, d),
        _ => search::last_index_of_many(haystack, chars),
    }
}

/// Finds the first character that needs escaping in a JavaScript string: 0x7F and above, control characters,
/// the backslash, the quote itself, and for backtick strings also the dollar sign.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_needs_escape_for_javascript_string(slice: &[u8], quote_char: u8) -> Option<u32> {
    // Characters that are not ASCII come in runs.
    if *slice.first()? >= 0x7f {
        return Some(0);
    }
    let found = if quote_char == b'`' {
        search::index_of_needs_escape_in_template(slice)
    } else {
        search::index_of_interesting_character_in_string_literal(slice, quote_char)
    };
    found.map(|at| at as u32)
}

/// Checks if the string contains any control characters, non-ASCII characters, or quotes
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn contains_newline_or_non_ascii_or_quote(text: &[u8]) -> bool {
    !text.is_empty() && search::index_of_newline_or_non_ascii_or_quote(text).is_some()
}

/// Scans for `quote`, the backslash, control characters, 0x7F and above.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_interesting_character_in_string_literal(text: &[u8], quote: u8) -> Option<usize> {
    search::index_of_interesting_character_in_string_literal(text, quote)
}

/// Scans for `*`, `\n`, `\r` and 0xE2, with which U+2028 and U+2029 start.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_interesting_character_in_multiline_comment(text: &[u8]) -> Option<usize> {
    // Lines start with " * ", and characters for boxes come in runs.
    if matches!(*text.first()?, b'*' | b'\n' | b'\r' | 0xe2) {
        return Some(0);
    }
    search::index_of_interesting_character_in_multiline_comment(text)
}

/// Scans for `#`, `@`, `\n`, `\r` and 0xE2.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_interesting_character_in_line_comment(text: &[u8]) -> Option<usize> {
    if *text.first()? == 0xe2 {
        return Some(0);
    }
    search::index_of_interesting_character_in_line_comment(text)
}

/// Scans for control characters and non-ASCII characters.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_newline_or_non_ascii(text: &[u8]) -> Option<usize> {
    search::index_of_newline_or_non_ascii(text)
}

/// Scans for spaces, control characters and non-ASCII characters.
#[cfg_attr(not(debug_assertions), inline(always))]
pub fn index_of_space_or_newline_or_non_ascii(text: &[u8]) -> Option<usize> {
    search::index_of_space_or_newline_or_non_ascii(text)
}
