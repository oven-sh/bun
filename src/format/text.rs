//! What the printers of all languages ask of a text: the strings and regular expressions of
//! JavaScript, for bytes, and Prettier's `src/utilities/`.
//!
//! An index is an offset in bytes. Where Prettier goes backwards from the index of a character, the
//! functions here take the offset behind it: `hasNewline(text, index, { backwards: true })`, which
//! starts at `index - 1`, is `has_newline_backwards(text, index)`.

use bun_core::strings;

pub(crate) use bun_lint::utils::text::{
    is_blank, to_lower_case, trim, trim_end, trim_start, utf16_len, white_space_len,
};

pub(crate) const BOM: &[u8] = &strings::BOM::UTF8_BYTES;

/// `/^\s/.test(text)`
#[inline]
pub(crate) fn starts_with_white_space(text: &[u8]) -> bool {
    white_space_len(text) > 0
}

/// The number of bytes of `text` that are before its first character that `\s` does not match.
#[inline]
pub(crate) fn leading_white_space_len(text: &[u8]) -> usize {
    text.len() - trim_start(text).len()
}

/// `a.toLowerCase() === b`, where `b` is ASCII in lower case.
#[inline]
pub(crate) fn eq_lower_case(a: &[u8], b: &[u8]) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// `\w`
#[inline]
pub(crate) fn is_word_character(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// A set of bytes, for the ends of tokens: they are a few bytes away, and there are more kinds of them
/// than the vectorized search takes at once.
pub(crate) struct ByteSet([bool; 256]);

impl ByteSet {
    pub(crate) const fn new(bytes: &[u8]) -> ByteSet {
        let mut set = [false; 256];
        let mut i = 0;
        while i < bytes.len() {
            set[bytes[i] as usize] = true;
            i += 1;
        }
        ByteSet(set)
    }

    /// The index of the first byte of `text` from `from` on that is in the set.
    #[inline]
    pub(crate) fn find(&self, text: &[u8], from: usize) -> Option<usize> {
        let rest = text.get(from..)?;
        rest.iter()
            .position(|&byte| self.0[byte as usize])
            .map(|at| from + at)
    }
}

/// `text.includes(part)`
#[inline]
pub(crate) fn includes(text: &[u8], part: &[u8]) -> bool {
    strings::contains(text, part)
}

/// `text.indexOf(byte, from)`
#[inline]
pub(crate) fn index_of_char_from(text: &[u8], byte: u8, from: usize) -> Option<usize> {
    strings::index_of_char_usize(text.get(from..)?, byte).map(|at| at + from)
}

/// `text.indexOf(part, from)`
#[inline]
pub(crate) fn index_of_from(text: &[u8], part: &[u8], from: usize) -> Option<usize> {
    strings::index_of(text.get(from..)?, part).map(|at| at + from)
}

#[inline]
fn skip(text: &[u8], at: usize, is_skipped: impl Fn(u8) -> bool) -> usize {
    let rest = text.get(at..).unwrap_or_default();
    at + rest.iter().take_while(|byte| is_skipped(**byte)).count()
}

/// `skipSpaces`
#[inline]
pub(crate) fn skip_spaces(text: &[u8], at: usize) -> usize {
    skip(text, at, |byte| matches!(byte, b' ' | b'\t'))
}

/// `skipSpaces(.., { backwards: true })`
#[inline]
pub(crate) fn skip_spaces_backwards(text: &[u8], end: usize) -> usize {
    let before = text.get(..end).unwrap_or_default();
    let is_space = |byte: &&u8| matches!(byte, b' ' | b'\t');
    before.len() - before.iter().rev().take_while(is_space).count()
}

/// `skipNewline`
#[inline]
pub(crate) fn skip_newline(text: &[u8], at: usize) -> usize {
    match text.get(at..).unwrap_or_default() {
        [b'\r', b'\n', ..] => at + 2,
        [b'\n' | b'\r', ..] => at + 1,
        // U+2028 and U+2029
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => at + 3,
        _ => at,
    }
}

/// `skipNewline(.., { backwards: true })`
#[inline]
pub(crate) fn skip_newline_backwards(text: &[u8], end: usize) -> usize {
    match text.get(..end).unwrap_or_default() {
        [.., b'\r', b'\n'] => end - 2,
        [.., b'\n' | b'\r'] => end - 1,
        [.., 0xE2, 0x80, 0xA8 | 0xA9] => end - 3,
        _ => end,
    }
}

/// `skipInlineComment`
#[inline]
pub(crate) fn skip_inline_comment(text: &[u8], at: usize) -> usize {
    let rest = text.get(at..).unwrap_or_default();
    match rest
        .strip_prefix(b"/*")
        .and_then(|content| strings::index_of(content, b"*/"))
    {
        Some(end) => at + end + 4,
        None => at,
    }
}

/// `skipTrailingComment`
#[inline]
pub(crate) fn skip_trailing_comment(text: &[u8], at: usize) -> usize {
    let rest = text.get(at..).unwrap_or_default();
    match rest.starts_with(b"//") {
        true => at + strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len()),
        false => at,
    }
}

/// `hasNewline`: nothing but blanks is between `at` and the end of the line.
#[inline]
pub(crate) fn has_newline(text: &[u8], at: usize) -> bool {
    let line_end = skip_spaces(text, at);
    skip_newline(text, line_end) != line_end
}

/// `hasNewline(.., { backwards: true })`: nothing but blanks is between the start of the line and
/// `end`. Not on the first line.
#[inline]
pub(crate) fn has_newline_backwards(text: &[u8], end: usize) -> bool {
    let line_start = skip_spaces_backwards(text, end);
    skip_newline_backwards(text, line_start) != line_start
}

/// `isNextLineEmpty`: whether the line after the one that `at` is on is empty. Commas, semicolons
/// and comments after `at` are passed over.
#[inline]
pub(crate) fn is_next_line_empty(text: &[u8], at: usize) -> bool {
    match text.get(at) {
        // Nearly always the line ends here.
        Some(b'\n') => has_newline(text, at + 1),
        _ => is_line_after_the_rest_of_the_line_empty(text, at),
    }
}

fn is_line_after_the_rest_of_the_line_empty(text: &[u8], mut at: usize) -> bool {
    loop {
        let line_end = skip(text, at, |byte| matches!(byte, b',' | b';' | b' ' | b'\t'));
        let next = skip_spaces(text, skip_inline_comment(text, line_end));
        if next == at {
            break;
        }
        at = next;
    }
    has_newline(text, skip_newline(text, skip_trailing_comment(text, at)))
}

/// `isPreviousLineEmpty`
#[inline]
pub(crate) fn is_previous_line_empty(text: &[u8], at: usize) -> bool {
    let line_start = skip_spaces_backwards(text, at);
    has_newline_backwards(text, skip_newline_backwards(text, line_start))
}

/// What `printLeadingComment` asks: whether the line after the one that ends at `at`, but for blanks,
/// is empty.
#[inline]
pub(crate) fn is_followed_by_empty_line(text: &[u8], at: usize) -> bool {
    has_newline(text, skip_newline(text, skip_spaces(text, at)))
}

/// `makeString`: `content`, which is what is between quotes of either kind, in `quote`.
pub(crate) fn make_string(content: &[u8], quote: u8, out: &mut Vec<u8>) {
    let other = if quote == b'"' { b'\'' } else { b'"' };
    out.push(quote);
    let mut bytes = content.iter().copied();
    while let Some(byte) = bytes.next() {
        match byte {
            b'\\' => match bytes.next() {
                // It does not have to be escaped any more.
                Some(escaped) if escaped == other => out.push(escaped),
                Some(escaped) => out.extend([b'\\', escaped]),
                None => out.push(b'\\'),
            },
            _ if byte == quote => out.extend([b'\\', byte]),
            _ => out.push(byte),
        }
    }
    out.push(quote);
}

/// `/^\s*#[^\S\n]*@(?:a|b)\s*?(?:\n|$)/`: what YAML and GraphQL have for `hasPragma` and
/// `hasIgnorePragma`.
pub(crate) fn has_pragma_in_hash_comment(text: &[u8], pragmas: [&[u8]; 2]) -> bool {
    fn without_blanks(mut text: &[u8]) -> &[u8] {
        while !text.starts_with(b"\n")
            && let len @ 1.. = white_space_len(text)
        {
            text = &text[len..];
        }
        text
    }
    let Some(comment) = trim_start(text).strip_prefix(b"#") else {
        return false;
    };
    let Some(name) = without_blanks(comment).strip_prefix(b"@") else {
        return false;
    };
    pragmas.iter().any(|pragma| {
        name.strip_prefix(*pragma)
            .is_some_and(|rest| matches!(without_blanks(rest), [] | [b'\n', ..]))
    })
}
