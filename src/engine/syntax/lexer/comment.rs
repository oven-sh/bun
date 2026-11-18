//! Comments, and the directives in them.

use bun_highway::ScannerWindow;

use super::{EXACT_RUN, Flaw, Lexer};
use crate::chars::{self, Start};
use crate::token::{Detail, Token, TokenKind};

impl Lexer<'_> {
    /// Where the line ends.
    #[inline(never)]
    pub(super) fn skip_line(&mut self, mut offset: usize) -> usize {
        loop {
            offset = self.stop(offset, |stops| stops.in_string);
            match self.bytes.get(offset) {
                Some(&byte) if !chars::is_newline(byte) => offset = self.skip_stop(offset),
                _ => return offset,
            }
        }
    }

    /// Past a stop that means nothing here, and past the characters that are not ASCII after it.
    #[inline(always)]
    pub(super) fn skip_stop(&self, mut offset: usize) -> usize {
        offset += 1;
        while !self.byte(offset).is_ascii() {
            offset += 1;
        }
        offset
    }

    #[inline(always)]
    pub(super) fn blank(&mut self, start: usize, lead: Detail, byte: u8) {
        if self.byte(start + 1) <= b' ' || byte != b' ' {
            return self.scan_past_trivia(start, lead);
        }
        self.scan(start + 1, lead);
    }

    #[inline(always)]
    pub(super) fn newline(&mut self, start: usize, lead: Detail) {
        let lead = lead | Detail::FOLLOWS_NEWLINE;
        let position = (start + 1).wrapping_sub(self.window_start);
        if position < ScannerWindow::REACH {
            let run = self.window.stops().after_blanks.run(position);
            let next = start + 1 + run.min(EXACT_RUN) as usize;
            if self.byte(next) > b' ' {
                return self.scan(next, lead);
            }
        }
        self.scan_past_trivia(start, lead);
    }

    #[inline(never)]
    pub(super) fn scan_past_trivia(&mut self, offset: usize, lead: Detail) {
        if let Some((offset, lead)) = self.skip_trivia(offset, lead) {
            self.scan(offset, lead);
        }
    }

    /// Where the next token starts. None if a comment does not end.
    #[inline(always)]
    fn skip_trivia(&mut self, mut offset: usize, mut lead: Detail) -> Option<(usize, Detail)> {
        loop {
            match chars::start(self.byte(offset)) {
                Start::Blank => offset += 1,
                Start::Newline => {
                    lead = lead | Detail::FOLLOWS_NEWLINE;
                    offset = self.stop(offset + 1, |stops| stops.after_blanks);
                }
                Start::Slash if self.byte(offset + 1) == b'/' => {
                    if matches!(self.byte(offset + 2), b'#' | b'@') {
                        self.directive(offset + 3);
                    }
                    offset = self.skip_line(offset + 2);
                }
                Start::Slash if self.byte(offset + 1) == b'*' => {
                    offset = self.skip_block_comment(offset, &mut lead)?;
                }
                Start::Operator
                    if self.opens_html_comment(offset)
                        || self.closes_html_comment(offset, lead) =>
                {
                    offset = self.skip_line(offset);
                }
                _ => return Some((offset, lead)),
            }
        }
    }

    #[inline(always)]
    fn skip_block_comment(&mut self, start: usize, lead: &mut Detail) -> Option<usize> {
        let rest = &self.bytes[start + 2..];
        let length = bun_highway::memmem(rest, b"*/");
        let text = &rest[..length.unwrap_or(rest.len())];
        if !lead.contains(Detail::FOLLOWS_NEWLINE)
            && bun_highway::index_of_any_char(text, b"\n\r").is_some()
        {
            *lead = *lead | Detail::FOLLOWS_NEWLINE;
        }
        if length.is_none() {
            let flaw = Flaw {
                kind: TokenKind::UnterminatedMultiline,
                end: self.bytes.len(),
                message: "Multiline comment was not closed properly",
            };
            self.fail(start, *lead, flaw);
        }
        Some(start + length? + 4)
    }

    /// ECMA-262 B.1.1.
    #[inline(always)]
    pub(super) fn opens_html_comment(&self, offset: usize) -> bool {
        !self.is_module && self.bytes[offset..].starts_with(b"<!--")
    }

    #[inline(always)]
    pub(super) fn closes_html_comment(&self, offset: usize, lead: Detail) -> bool {
        self.bytes[offset..].starts_with(b"-->")
            && !self.is_module
            && (lead.contains(Detail::FOLLOWS_NEWLINE) || self.previous_end == self.first_offset)
    }

    /// What opens the first comment that takes the rest of its line, if that comes before the next token.
    pub(crate) fn line_comment_after(&self, token: Token) -> Option<Token> {
        let mut start = token.end() as usize;
        let length = loop {
            match self.bytes[start..] {
                [b'/', b'/', ..] => break 2,
                [b'<', b'!', b'-', b'-', ..] => break 1,
                [b'-', b'-', b'>', ..] => break 3,
                [b'/', b'*', ref rest @ ..] => start += bun_highway::memmem(rest, b"*/")? + 4,
                [byte, ..] if matches!(chars::start(byte), Start::Blank | Start::Newline) => {
                    start += 1;
                }
                _ => return None,
            }
        };
        let end = start + length;
        (end <= self.token.start() as usize)
            .then(|| Token::new(TokenKind::Slash, start, end, Detail::NONE))
    }

    fn skip_blanks(&self, mut offset: usize) -> usize {
        while chars::start(self.byte(offset)) == Start::Blank {
            offset += 1;
        }
        offset
    }

    #[cold]
    #[inline(never)]
    fn directive(&mut self, offset: usize) {
        if chars::start(self.byte(offset)) != Start::Blank {
            return;
        }
        let rest = &self.bytes[offset + 1..];
        if let Some(value) = rest.strip_prefix(b"sourceURL=") {
            self.source_url = self.directive_value(self.bytes.len() - value.len());
        } else if let Some(value) = rest.strip_prefix(b"sourceMappingURL=") {
            self.source_mapping_url = self.directive_value(self.bytes.len() - value.len());
        }
    }

    fn directive_value(&self, offset: usize) -> Option<(u32, u32)> {
        let start = self.skip_blanks(offset);
        let rest = &self.bytes[start..];
        let length = bun_highway::index_of_any_char(rest, b"\t\n\x0b\x0c\r \"'\xa0");
        let end = start + length.unwrap_or(rest.len());
        let ends_line =
            (self.bytes.get(self.skip_blanks(end))).is_none_or(|&byte| chars::is_newline(byte));
        ends_line.then_some((start as u32, end as u32))
    }
}
