//! Questions about the source text around a position.

use bun_core::strings::{
    contains_js_line_break, js_line_break_len, js_line_break_len_back, js_whitespace_len,
    js_whitespace_len_back,
};
use bun_lint::span::{Span, Spanned};

#[derive(Copy, Clone)]
pub(crate) struct SourceText<'a> {
    text: &'a [u8],
}

fn has_line_terminator(rest: &[u8]) -> bool {
    match rest {
        [] => false,
        [_, b'\n', ..] => true,
        _ => contains_js_line_break(rest),
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
    pub(crate) fn text_for(self, it: &impl Spanned) -> &'a [u8] {
        let span = it.span();
        self.text
            .get(span.start as usize..span.end.max(span.start) as usize)
            .unwrap_or_default()
    }

    #[inline]
    pub(crate) fn byte_at(self, position: u32) -> Option<u8> {
        self.text.get(position as usize).copied()
    }

    pub(crate) fn next_non_whitespace_byte_is(self, position: u32, expected: u8) -> bool {
        let mut rest = self.from(position).trim_ascii_start();
        while rest.first().is_some_and(|b| !b.is_ascii()) {
            match js_whitespace_len(rest) {
                0 => break,
                len => rest = rest[len..].trim_ascii_start(),
            }
        }
        rest.first() == Some(&expected)
    }

    pub(crate) fn contains_byte(self, span: Span, byte: u8) -> bool {
        bun_core::strings::contains_char(self.text_for(&span), byte)
    }

    /// White space that is not ASCII counts as a space, and so does the vertical tab, which `u8::is_ascii_whitespace` does not
    /// know. U+2028 and U+2029 count as `\n`.
    pub(crate) fn all_bytes(self, span: Span, predicate: impl Fn(u8) -> bool) -> bool {
        let mut rest = self.text_for(&span);
        while let Some(at) = rest.iter().position(|&b| !predicate(b)) {
            rest = &rest[at..];
            let stands_for = match js_line_break_len(rest) {
                0 => b' ',
                _ => b'\n',
            };
            let len = js_whitespace_len(rest);
            if (len < 2 && rest[0] != 0x0B) || !predicate(stands_for) {
                return false;
            }
            rest = &rest[len..];
        }
        true
    }

    /// The number of characters in `span`.
    pub(crate) fn span_width(self, span: Span) -> usize {
        bstr::ByteSlice::chars(self.text_for(&span)).count()
    }

    pub(crate) fn contains_newline(self, span: Span) -> bool {
        has_line_terminator(self.text_for(&span))
    }

    /// Prettier's `hasNewlineInRange`, which does not know U+2028 and U+2029.
    pub(crate) fn has_newline_in_range(self, span: Span) -> bool {
        bun_core::strings::index_of_any(self.text_for(&span), b"\n\r").is_some()
    }

    /// The number of line breaks between `end` and the next thing that is not whitespace. 0 if
    /// there is nothing more.
    pub(crate) fn lines_after(self, end: u32) -> usize {
        let (mut rest, mut count) = (self.from(end), 0);
        loop {
            // What there is between most nodes.
            while let [first @ (b' ' | b'\t' | b'\n'), after @ ..] = rest {
                count += usize::from(*first == b'\n');
                rest = after;
            }
            match (js_line_break_len(rest), js_whitespace_len(rest)) {
                (0, 0) if rest.is_empty() => return 0,
                (0, 0) => return count,
                (0, space) => rest = &rest[space..],
                (len, _) => {
                    rest = &rest[len..];
                    count += 1;
                }
            }
        }
    }

    /// The number of line breaks between the previous token and `span`, or the comments that lead
    /// up to it, the first of which is `first_unprinted_comment`. Parentheses around `span` are
    /// looked through.
    ///
    /// `looks_past_comma`: in `a: 1\n\n, b: 2` the comma is on the line of what follows it, and the line breaks before it count.
    pub(crate) fn get_lines_before(
        self,
        span: Span,
        first_unprinted_comment: Option<Span>,
        looks_past_comma: bool,
    ) -> usize {
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
        let mut is_after_comma = !looks_past_comma;
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
            if js_line_break_len_back(before) == 0
                && let space @ 1.. = js_whitespace_len_back(before)
            {
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
            match js_line_break_len_back(before) {
                0 if before.is_empty() => return 0,
                0 if count == 0 && !is_after_comma && before.ends_with(b",") => {
                    before = &before[..before.len() - 1];
                    is_after_comma = true;
                    continue;
                }
                0 => return count,
                len => before = &before[..before.len() - len],
            }
            count += 1;
        }
    }

    /// Whether only spaces and tabs are between the previous line break and `position`.
    pub(crate) fn has_line_terminator_before(self, position: u32) -> bool {
        let before = self.to(position);
        let end = before
            .iter()
            .rposition(|b| !matches!(b, b' ' | b'\t'))
            .map_or(0, |at| at + 1);
        js_line_break_len_back(&before[..end]) != 0
    }

    /// Whether only spaces and tabs are between `position` and the next line break.
    pub(crate) fn has_line_terminator_after(self, position: u32) -> bool {
        let after = self.from(position);
        let start = after
            .iter()
            .position(|b| !matches!(b, b' ' | b'\t'))
            .unwrap_or(after.len());
        js_line_break_len(&after[start..]) != 0
    }

    /// Whether there is a line break between `position` and the next token, which can be in or
    /// after a comment.
    pub(crate) fn has_line_terminator_after_skipping_comments(self, position: u32) -> bool {
        let mut rest = self.from(position);
        loop {
            match rest {
                [b' ' | b'\t', tail @ ..] => rest = tail,
                [b'/', b'/', tail @ ..] => {
                    return has_line_terminator(tail);
                }
                [b'/', b'*', tail @ ..] => {
                    let end = bun_core::strings::index_of(tail, b"*/").unwrap_or(tail.len());
                    if has_line_terminator(&tail[..end]) {
                        return true;
                    }
                    rest = tail.get(end + 2..).unwrap_or_default();
                }
                _ => return js_line_break_len(rest) != 0,
            }
        }
    }
}
