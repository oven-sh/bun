//! Names that take more than a look at the first character that is no letter.

use bun_engine_text::Text;
use bun_engine_unicode::{MAX_CODE_POINT, is_identifier_part, is_identifier_start};

use super::Lexer;
use crate::chars;
use crate::error::LexicalError;
use crate::names::{Key, NameKind};
use crate::token::{Detail, TokenKind};

pub(super) enum Malformed {
    /// More text could make it whole.
    Incomplete,
    Invalid,
}

fn is_surrogate(code_point: u32) -> bool {
    code_point & !0x7ff == 0xd800
}

impl Lexer<'_> {
    #[inline(never)]
    pub(super) fn short_name(&mut self, key: Key, start: usize, end: usize, lead: Detail) {
        let name = self.names.intern_short(key, start);
        self.token = self.word(name, start, end, lead);
    }

    /// One that starts with an ASCII character.
    #[inline(never)]
    pub(super) fn any_name(&mut self, start: usize, lead: Detail) {
        let end = self.skip_name(start);
        if chars::continues_name(self.byte(end)) {
            return self.elaborate_name(start, end, lead);
        }
        if lead.contains(Detail::UNNAMED) {
            return self.set(TokenKind::Identifier, start, end, lead);
        }
        let name = (self.names).intern_narrow(self.source, start, end, NameKind::Ordinary);
        self.token = self.word(name, start, end, lead);
    }

    /// A lone surrogate is itself. Zero past the end.
    pub(super) fn code_point(&self, offset: usize) -> u32 {
        if offset >= self.bytes.len() {
            return 0;
        }
        (self.source.text.slice(0..self.bytes.len())).code_point_at(offset)
    }

    pub(super) fn starts_name(&self, offset: usize) -> bool {
        is_identifier_start(self.code_point(offset))
    }

    /// At a character that starts a name or no token at all.
    #[inline(never)]
    pub(super) fn unusual_name(&mut self, start: usize, lead: Detail) {
        match self.byte(start) {
            b'#' if self.byte(start + 1) == b'\\' || self.starts_name(start + 1) => {
                let end = self.skip_name(start + 1);
                self.elaborate_name(start, end, lead);
            }
            b'@' if self.is_builtin => self.builtin_name(start, lead),
            b'\\' => self.elaborate_name(start, start, lead),
            _ if self.starts_name(start) => self.elaborate_name(start, start, lead),
            _ => {
                let unit = self.source.text.at(start);
                self.error = Some(LexicalError::InvalidCharacter(unit));
                self.set(TokenKind::Invalid, start, start, lead);
            }
        }
    }

    fn builtin_name(&mut self, start: usize, lead: Detail) {
        let (kind, text_start) = match self.byte(start + 1) {
            b'@' => (NameKind::WellKnownSymbol, start + 2),
            _ => (NameKind::Private, start + 1),
        };
        let end = self.skip_name(text_start);
        let name = self.names.intern_narrow(self.source, text_start, end, kind);
        self.token = self.word(name, start, end, lead);
    }

    /// All is well up to `offset`.
    #[inline(never)]
    pub(super) fn elaborate_name(&mut self, start: usize, mut offset: usize, lead: Detail) {
        /// From this far off the end, a keyword that runs into a character above 0xff is taken for an identifier.
        const LONGEST_KEYWORD: usize = 10;
        let first = start + usize::from(self.byte(start) == b'#');
        let mut has_escape = false;
        let mut may_be_keyword = true;
        while chars::continues_name(self.byte(offset)) {
            if self.byte(offset) == b'\\' {
                has_escape = true;
                match self.escape_in_name(offset + 1, offset == first) {
                    Ok(end) => offset = end,
                    Err((kind, end)) => return self.set(kind, start, end, lead),
                }
            } else {
                let code_point = self.code_point(offset);
                if is_surrogate(code_point) {
                    return self.set(TokenKind::InvalidEncoding, start, offset, lead);
                }
                if !is_identifier_part(code_point) {
                    if code_point > 0xffff {
                        return self.set(TokenKind::InvalidCodePoint, start, offset, lead);
                    }
                    may_be_keyword = has_escape
                        || code_point <= 0xff
                        || self.bytes.len() - start <= LONGEST_KEYWORD;
                    break;
                }
                offset += if code_point > 0xffff { 2 } else { 1 };
            }
            offset = self.skip_name(offset);
        }
        let (name, detail) = if has_escape {
            self.unescape_name(start, offset);
            let name = (self.names).intern_text(self.source, Text::Utf16(&self.scratch));
            (name, lead | Detail::ELABORATE)
        } else {
            (self.names.intern_source(self.source, start, offset), lead)
        };
        let word = self.word(name, start, offset, detail);
        self.token = word.with_kind(match word.kind() {
            _ if first != start => TokenKind::PrivateName,
            TokenKind::Identifier => TokenKind::Identifier,
            _ if !may_be_keyword => TokenKind::Identifier,
            _ if has_escape => TokenKind::EscapedKeyword,
            keyword => keyword,
        });
    }

    /// `offset` is past the backslash.
    fn escape_in_name(&self, offset: usize, is_first: bool) -> Result<usize, (TokenKind, usize)> {
        if self.byte(offset) != b'u' {
            return Err(if offset >= self.bytes.len() {
                (TokenKind::IncompleteEscape, offset)
            } else {
                (TokenKind::InvalidEscape, offset)
            });
        }
        match self.unicode_escape(offset + 1) {
            (Ok(code_point), end) if is_first && is_identifier_start(code_point) => Ok(end),
            (Ok(code_point), end) if !is_first && is_identifier_part(code_point) => Ok(end),
            (Err(Malformed::Incomplete), end) => Err((TokenKind::IncompleteEscape, end)),
            (_, end) => Err((TokenKind::InvalidUnicodeEscape, end)),
        }
    }

    pub(super) fn skip_hex_digits(&self, mut offset: usize) -> usize {
        while self.byte(offset).is_ascii_hexdigit() {
            offset += 1;
        }
        offset
    }

    /// `offset` is past the `u`. What is malformed ends where NotEscapeSequence of ECMA-262 ends.
    pub(super) fn unicode_escape(&self, offset: usize) -> (Result<u32, Malformed>, usize) {
        let malformed = |is_incomplete| {
            Err(if is_incomplete {
                Malformed::Incomplete
            } else {
                Malformed::Invalid
            })
        };
        let value = |start: usize, end: usize| {
            self.bytes[start..end].iter().fold(0u32, |value, &digit| {
                let digit = char::from(digit).to_digit(16).unwrap_or(0);
                (value << 4 | digit).min(MAX_CODE_POINT + 1)
            })
        };
        if self.byte(offset) != b'{' {
            let is_whole = (offset..offset + 4).all(|at| self.byte(at).is_ascii_hexdigit());
            return if is_whole {
                (Ok(value(offset, offset + 4)), offset + 4)
            } else {
                let is_incomplete = offset + 4 >= self.bytes.len();
                (malformed(is_incomplete), self.skip_hex_digits(offset))
            };
        }
        let end = self.skip_hex_digits(offset + 1);
        let code_point = value(offset + 1, end);
        if code_point > MAX_CODE_POINT {
            (malformed(end >= self.bytes.len()), end)
        } else if end == offset + 1 || self.byte(end) != b'}' {
            (malformed(self.byte(end) == 0), end)
        } else {
            (Ok(code_point), end + 1)
        }
    }

    fn unescape_name(&mut self, mut offset: usize, end: usize) {
        self.scratch.clear();
        while offset < end {
            if self.bytes[offset] == b'\\' {
                let (code_point, next) = self.unicode_escape(offset + 2);
                self.push_code_point(code_point.unwrap_or(0));
                offset = next;
            } else {
                self.scratch.push(self.source.text.at(offset));
                offset += 1;
            }
        }
    }

    pub(super) fn push_code_point(&mut self, code_point: u32) {
        match u16::try_from(code_point) {
            Ok(unit) => self.scratch.push(unit),
            Err(_) => self.scratch.extend([
                (0xd7c0 + (code_point >> 10)) as u16,
                0xdc00 | (code_point & 0x3ff) as u16,
            ]),
        }
    }
}
