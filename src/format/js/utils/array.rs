use crate::prelude::*;
use crate::write;

/// Prettier's `printArrayElements`: the elements of an array literal or an array pattern, each on
/// its own line if they do not fit on one. `None` is a hole, which is written as the comma after it.
///
/// `len`: the number of elements, including a rest element that the caller writes afterwards.
pub(crate) fn write_array_node<'a, N: Format<'a> + Spanned>(
    len: usize,
    array: impl IntoIterator<Item = Option<N>>,
    f: &mut Formatter<'a>,
) {
    let last_index = len.saturating_sub(1);
    // Where the previous element ends, unless it is a hole.
    let mut previous_end: Option<u32> = None;

    for (index, element) in array.into_iter().enumerate() {
        if index > 0 {
            // An empty line after an element is kept if the array breaks.
            match previous_end.is_some_and(|end| is_line_after_element_empty(f.source_text().as_bytes(), end as usize)) {
                true => write!(f, soft_empty_line_or_space()),
                false => write!(f, soft_line_break_or_space()),
            }
        }
        previous_end = element.as_ref().map(|it| it.span().end);
        match &element {
            Some(element) => {
                write!(f, group(element));
                match index != last_index {
                    true => write!(f, ","),
                    false => write!(f, FormatTrailingCommas::ES5),
                }
            }
            None => write!(f, ","),
        }
    }
}

fn skip(text: &[u8], at: usize, is_skipped: impl Fn(u8) -> bool) -> usize {
    at + text.get(at..).unwrap_or_default().iter().take_while(|b| is_skipped(**b)).count()
}

fn skip_spaces(text: &[u8], at: usize) -> usize {
    skip(text, at, |b| matches!(b, b' ' | b'\t'))
}

/// Prettier's `skipInlineComment`
fn skip_block_comment(text: &[u8], at: usize) -> usize {
    let rest = text.get(at..).unwrap_or_default();
    match rest.strip_prefix(b"/*").and_then(|content| bun_core::strings::index_of(content, b"*/")) {
        Some(end) => at + end + 4,
        None => at,
    }
}

/// Prettier's `skipTrailingComment`
fn skip_line_comment(text: &[u8], at: usize) -> usize {
    let rest = text.get(at..).unwrap_or_default();
    match rest.starts_with(b"//") {
        true => at + bun_core::strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len()),
        false => at,
    }
}

fn skip_newline(text: &[u8], at: usize) -> usize {
    match text.get(at..).unwrap_or_default() {
        [b'\r', b'\n', ..] => at + 2,
        [b'\n' | b'\r', ..] => at + 1,
        // U+2028 and U+2029
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => at + 3,
        _ => at,
    }
}

/// Prettier's `isNextLineEmpty`
fn is_next_line_empty(text: &[u8], start: usize) -> bool {
    let mut at = start;
    loop {
        let line_end = skip(text, at, |b| matches!(b, b',' | b';' | b' ' | b'\t'));
        let next = skip_spaces(text, skip_block_comment(text, line_end));
        if next == at {
            break;
        }
        at = next;
    }
    let line_start = skip_spaces(text, skip_newline(text, skip_line_comment(text, at)));
    skip_newline(text, line_start) != line_start
}

/// Prettier's `isLineAfterElementEmpty`: the line after the comma that follows the element that ends
/// at `end` is empty.
pub(crate) fn is_line_after_element_empty(text: &[u8], end: usize) -> bool {
    let mut at = end;
    while text.get(at).is_some_and(|b| *b != b',') {
        at = skip_block_comment(text, skip_line_comment(text, at + 1));
    }
    is_next_line_empty(text, at)
}
