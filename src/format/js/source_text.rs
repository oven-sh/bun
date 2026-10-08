//! Questions about the source text around a position.

use bun_lint::span::{Span, Spanned};

#[derive(Copy, Clone)]
pub(crate) struct SourceText<'a> {
    text: &'a [u8],
}

/// `\n`, `\r`, U+2028 or U+2029 at the start of `text`: its length.
#[inline]
fn line_terminator_len(text: &[u8]) -> usize {
    match text {
        [b'\n' | b'\r', ..] => 1,
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
        _ => 0,
    }
}

/// The same at the end of `text`.
#[inline]
fn line_terminator_len_back(text: &[u8]) -> usize {
    match text {
        [.., b'\n' | b'\r'] => 1,
        [.., 0xE2, 0x80, 0xA8 | 0xA9] => 3,
        _ => 0,
    }
}

/// `WhiteSpace` of the specification at the start of `text`: its length.
#[inline]
fn white_space_len(text: &[u8]) -> usize {
    match text {
        [b' ' | b'\t' | 0x0B | 0x0C, ..] => 1,
        [0xC2, 0xA0, ..] => 2,
        [0xEF, 0xBB, 0xBF, ..]
        | [0xE1, 0x9A, 0x80, ..]
        | [0xE2, 0x80, 0x80..=0x8A | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..] => 3,
        _ => 0,
    }
}

/// The same at the end of `text`.
#[inline]
fn white_space_len_back(text: &[u8]) -> usize {
    match text {
        [.., b' ' | b'\t' | 0x0B | 0x0C] => 1,
        [.., 0xEF, 0xBB, 0xBF]
        | [.., 0xE1, 0x9A, 0x80]
        | [.., 0xE2, 0x80, 0x80..=0x8A | 0xAF]
        | [.., 0xE2, 0x81, 0x9F]
        | [.., 0xE3, 0x80, 0x80] => 3,
        [.., 0xC2, 0xA0] => 2,
        _ => 0,
    }
}

impl<'a> SourceText<'a> {
    #[inline]
    pub(crate) fn new(text: &'a [u8]) -> Self {
        Self { text }
    }

    #[inline]
    pub(crate) fn as_bytes(self) -> &'a [u8] {
        self.text
    }

    #[inline]
    fn from(self, position: u32) -> &'a [u8] {
        self.text.get(position as usize..).unwrap_or_default()
    }

    #[inline]
    fn to(self, position: u32) -> &'a [u8] {
        self.text.get(..position as usize).unwrap_or_default()
    }

    #[inline]
    pub(crate) fn slice_range(self, start: u32, end: u32) -> &'a [u8] {
        self.text.get(start as usize..end.max(start) as usize).unwrap_or_default()
    }

    /// The same as [`SourceText::slice_range`].
    #[inline]
    pub(crate) fn bytes_range(self, start: u32, end: u32) -> &'a [u8] {
        self.slice_range(start, end)
    }

    #[inline]
    pub(crate) fn text_for(self, it: &impl Spanned) -> &'a [u8] {
        let span = it.span();
        self.slice_range(span.start, span.end)
    }

    #[inline]
    pub(crate) fn byte_at(self, position: u32) -> Option<u8> {
        self.text.get(position as usize).copied()
    }

    pub(crate) fn next_non_whitespace_byte_is(self, position: u32, expected: u8) -> bool {
        self.from(position).trim_ascii_start().first() == Some(&expected)
    }

    pub(crate) fn bytes_contain(self, start: u32, end: u32, byte: u8) -> bool {
        bun_core::strings::contains_char(self.slice_range(start, end), byte)
    }

    pub(crate) fn all_bytes_match(self, start: u32, end: u32, predicate: impl Fn(u8) -> bool) -> bool {
        self.slice_range(start, end).iter().all(|&b| predicate(b))
    }

    /// The number of characters in `span`.
    pub(crate) fn span_width(self, span: Span) -> usize {
        bstr::ByteSlice::chars(self.text_for(&span)).count()
    }

    pub(crate) fn contains_newline(self, span: Span) -> bool {
        self.contains_newline_between(span.start, span.end)
    }

    pub(crate) fn contains_newline_between(self, start: u32, end: u32) -> bool {
        let mut rest = self.slice_range(start, end);
        if matches!(rest, [] | [_, b'\n', ..]) {
            return !rest.is_empty();
        }
        // 0xE2 starts U+2028 and U+2029, and many other characters.
        while let Some(at) = bun_core::strings::index_of_any(rest, b"\n\r\xE2") {
            if line_terminator_len(&rest[at..]) != 0 {
                return true;
            }
            rest = &rest[at + 1..];
        }
        false
    }

    /// The number of line breaks between `end` and the next thing that is not whitespace. 0 if
    /// there is nothing more.
    pub(crate) fn lines_after(self, end: u32) -> usize {
        let (mut rest, mut count) = (self.from(end), 0);
        loop {
            let space = white_space_len(rest);
            if space != 0 {
                rest = &rest[space..];
                continue;
            }
            match line_terminator_len(rest) {
                0 if rest.is_empty() => return 0,
                0 => return count,
                _ if rest.starts_with(b"\r\n") => rest = &rest[2..],
                len => rest = &rest[len..],
            }
            count += 1;
        }
    }

    /// The number of line breaks between the previous token and `span`, or the comments that lead
    /// up to it, the first of which is `first_unprinted_comment`. Parentheses around `span` are
    /// looked through.
    pub(crate) fn get_lines_before(self, span: Span, first_unprinted_comment: Option<Span>) -> usize {
        let mut start = span.start;
        if let Some(comment) = first_unprinted_comment
            && comment.end <= start
        {
            start = comment.start;
        } else if start != 0 && self.byte_at(start - 1) == Some(b';') {
            // `;(function() {})`
            start -= 1;
        }

        let mut count = 0;
        let mut following = self.from(span.end);
        let mut before = self.to(start);
        loop {
            // What there is between most nodes.
            while let [rest @ .., last @ (b' ' | b'\t' | b'\n')] = before {
                before = rest;
                if *last == b'\n' {
                    count += 1;
                    before = before.strip_suffix(b"\r").unwrap_or(before);
                }
            }
            let space = white_space_len_back(before);
            if space != 0 {
                before = &before[..before.len() - space];
                continue;
            }
            if let [rest @ .., b'('] = before {
                // The line breaks inside the parentheses do not count.
                following = following.trim_ascii_start();
                match following.split_first() {
                    Some((b')', rest)) => following = rest,
                    Some(_) => return count,
                    None => {}
                }
                before = rest;
                count = 0;
                continue;
            }
            match line_terminator_len_back(before) {
                0 if before.is_empty() => return 0,
                0 => return count,
                _ if before.ends_with(b"\r\n") => before = &before[..before.len() - 2],
                len => before = &before[..before.len() - len],
            }
            count += 1;
        }
    }

    /// Whether only spaces and tabs are between the previous line break and `position`.
    pub(crate) fn has_line_terminator_before(self, position: u32) -> bool {
        let before = self.to(position);
        let end = before.iter().rposition(|b| !matches!(b, b' ' | b'\t')).map_or(0, |at| at + 1);
        line_terminator_len_back(&before[..end]) != 0
    }

    /// Whether only spaces and tabs are between `position` and the next line break.
    pub(crate) fn has_line_terminator_after(self, position: u32) -> bool {
        let after = self.from(position);
        let start = after.iter().position(|b| !matches!(b, b' ' | b'\t')).unwrap_or(after.len());
        line_terminator_len(&after[start..]) != 0
    }

    /// Whether there is a line break between `position` and the next token, which can be in or
    /// after a comment.
    pub(crate) fn has_line_terminator_after_skipping_comments(self, position: u32) -> bool {
        let mut rest = self.from(position);
        loop {
            match rest {
                [b' ' | b'\t', tail @ ..] => rest = tail,
                [b'/', b'/', tail @ ..] => {
                    return SourceText::new(tail).contains_newline_between(0, tail.len() as u32);
                }
                [b'/', b'*', tail @ ..] => {
                    let end = bun_core::strings::index_of(tail, b"*/").unwrap_or(tail.len());
                    if SourceText::new(tail).contains_newline_between(0, end as u32) {
                        return true;
                    }
                    rest = tail.get(end + 2..).unwrap_or_default();
                }
                _ => return line_terminator_len(rest) != 0,
            }
        }
    }
}
