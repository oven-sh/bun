//! Strings, templates and regular expressions.

use bun_engine_text::Text;
use bun_engine_unicode::is_line_terminator;

use super::{Flaw, Lexer};
use crate::chars;
use crate::error::LexicalError;
use crate::names::Name;
use crate::source::WIDE_UNIT;
use crate::token::{Detail, Token, TokenKind};

/// In `Token::value`.
pub(crate) const TEMPLATE_IS_TAIL: u32 = 1;
const TEMPLATE_IS_MALFORMED: u32 = 2;

impl Lexer<'_> {
    #[inline(always)]
    pub(super) fn string(&mut self, start: usize, lead: Detail, quote: u8) {
        let end = self.stop(start + 1, |stops| stops.in_string);
        if self.byte(end) != quote {
            return self.rest_of_string(start, end, lead);
        }
        self.set(TokenKind::String, start, end + 1, lead);
    }

    #[inline(never)]
    fn rest_of_string(&mut self, start: usize, mut offset: usize, mut detail: Detail) {
        let quote = self.byte(start);
        loop {
            match self.bytes.get(offset) {
                Some(&byte) if byte == quote => {
                    return self.set(TokenKind::String, start, offset + 1, detail);
                }
                Some(b'\\') => {
                    detail = detail | Detail::ELABORATE;
                    match self.escape(offset + 1, self.is_strict) {
                        Ok(end) => offset = end,
                        Err(flaw) => return self.malformed_escape(start, offset, detail, flaw),
                    }
                }
                Some(b'\n') if self.source.text.at(offset) > 0xff => offset += 1,
                Some(b'\n' | b'\r') | None => {
                    return self.fail(start, detail, self.flaw(offset, "Unexpected EOF"));
                }
                Some(_) => offset = self.skip_stop(offset),
            }
            offset = self.stop(offset, |stops| stops.in_string);
        }
    }

    /// The token takes in the one digit after `\x` only if something unusual is in the string before.
    #[cold]
    fn malformed_escape(&mut self, start: usize, backslash: usize, detail: Detail, mut flaw: Flaw) {
        let mut is_escaped = false;
        let is_plain = (self.source.text.slice(start..backslash).code_units()).all(|unit| {
            let follows_backslash = is_escaped;
            is_escaped = !is_escaped && unit == u16::from(b'\\');
            match u8::try_from(unit) {
                Ok(b'0'..=b'9' | b'u' | 0x0e..=0x1f | 0x7f..) => !follows_backslash,
                Ok(byte) => byte >= 0x0e || chars::is_newline(byte),
                Err(_) => follows_backslash && is_line_terminator(unit.into()),
            }
        });
        if is_plain && self.byte(backslash + 1) == b'x' {
            flaw.end = backslash + 2;
        }
        self.fail(start, detail, flaw);
    }

    /// `offset` is past the backslash.
    #[inline]
    fn escape(&self, offset: usize, is_strict: bool) -> Result<usize, Flaw> {
        let next = offset + 1;
        let (end, message) = match self.bytes.get(offset) {
            Some(b'x') => match self.skip_hex_digits(next) {
                end if end >= next + 2 => return Ok(next + 2),
                end => (end, "\\x can only be followed by a hex character sequence"),
            },
            Some(b'u') => match self.unicode_escape(next) {
                (Ok(_), end) => return Ok(end),
                (Err(_), end) => (
                    end,
                    "\\u can only be followed by a Unicode character sequence",
                ),
            },
            Some(&digit @ b'0'..=b'9')
                if is_strict && (digit != b'0' || self.byte(next).is_ascii_digit()) =>
            {
                (
                    next + usize::from(digit == b'0'),
                    "The only valid numeric escape in strict mode is '\\0'",
                )
            }
            Some(b'\r') if self.byte(next) == b'\n' => return Ok(next + 1),
            Some(_) => return Ok(next),
            None => (offset, "Unterminated string constant"),
        };
        Err(self.flaw(end, message))
    }

    /// Makes of the current token, a backquote or a closing brace, the part of a template that it starts.
    pub(crate) fn scan_template(&mut self, is_tagged: bool) {
        let (start, mut detail) = (self.token.start() as usize, self.token.lead());
        let mut offset = self.token.end() as usize;
        let mut flaw = loop {
            offset = self.stop(offset, |stops| stops.in_string);
            match self.bytes.get(offset) {
                Some(b'`') => {
                    detail = detail | Detail::value(TEMPLATE_IS_TAIL);
                    return self.set(TokenKind::Template, start, offset + 1, detail);
                }
                Some(b'$') if self.byte(offset + 1) == b'{' => {
                    return self.set(TokenKind::Template, start, offset + 2, detail);
                }
                Some(b'\\') => {
                    detail = detail | Detail::ELABORATE;
                    match self.escape(offset + 1, true) {
                        Ok(end) => offset = end,
                        Err(flaw) if is_tagged && flaw.kind == TokenKind::Invalid => {
                            detail = detail | Detail::value(TEMPLATE_IS_MALFORMED);
                            offset = flaw.end;
                        }
                        Err(flaw) => break flaw,
                    }
                }
                Some(b'\r') => {
                    detail = detail | Detail::ELABORATE;
                    offset += 1;
                }
                Some(_) => offset = self.skip_stop(offset),
                None => break self.flaw(offset, "Unexpected EOF"),
            }
        };
        if flaw.kind == TokenKind::Unterminated {
            flaw.kind = TokenKind::UnterminatedMultiline;
        }
        self.fail(start, detail, flaw);
    }

    /// Makes of the current token, `/` or `/=`, the literal that it starts. Its value is where the flags start.
    pub(crate) fn scan_regexp(&mut self) {
        let (start, lead) = (self.token.start() as usize, self.token.lead());
        let mut offset = self.token.end() as usize;
        let (mut is_escaped, mut is_in_class) = (false, false);
        loop {
            let byte = match self.bytes.get(offset) {
                Some(&byte) if !chars::is_newline(byte) => byte,
                _ => {
                    let error = LexicalError::UnterminatedRegExp(start as u32, offset as u32);
                    self.error = Some(error);
                    return self.set(TokenKind::Unterminated, start, offset, lead);
                }
            };
            offset += 1;
            match byte {
                _ if is_escaped => is_escaped = false,
                b'/' if !is_in_class => break,
                b'[' => is_in_class = true,
                b']' => is_in_class = false,
                b'\\' => is_escaped = true,
                _ => {}
            }
        }
        let detail = lead | Detail::value(offset as u32);
        offset = self.skip_name(offset);
        while !matches!(self.byte(offset), b'\\' | WIDE_UNIT)
            && chars::continues_name(self.byte(offset))
        {
            offset = self.skip_name(offset + 1);
        }
        if self.byte(offset) == WIDE_UNIT && self.source.text.at(offset) > 0xff {
            self.error = Some(LexicalError::WideRegExpFlag(start as u32, offset as u32));
            return self.set(TokenKind::Invalid, start, offset, lead);
        }
        self.set(TokenKind::RegExp, start, offset, detail);
    }

    /// The value of a string that is compared with other names.
    pub(crate) fn string_name(&mut self, token: Token) -> Name {
        let (start, end) = (token.start() as usize + 1, token.end() as usize - 1);
        if !token.is_elaborate() {
            return self.names.intern_source(self.source, start, end);
        }
        self.unescape(start, end);
        (self.names).intern_text(self.source, Text::Utf16(&self.scratch))
    }

    #[inline]
    pub(crate) fn string_value(&mut self, token: Token) -> Name {
        self.literal(token, token.start() as usize + 1, token.end() as usize - 1)
    }

    #[inline]
    fn literal(&mut self, token: Token, start: usize, end: usize) -> Name {
        if !token.is_elaborate() {
            return self.names.literal_in_source(self.source, start, end);
        }
        self.unescape(start, end);
        self.names.literal(self.source, Text::Utf16(&self.scratch))
    }

    fn template_range(token: Token) -> (usize, usize) {
        let delimiter = if token.value() & TEMPLATE_IS_TAIL != 0 {
            1
        } else {
            2
        };
        (token.start() as usize + 1, token.end() as usize - delimiter)
    }

    /// TV of ECMA-262.
    pub(crate) fn cooked_template(&mut self, token: Token) -> Option<Name> {
        let (start, end) = Self::template_range(token);
        (token.value() & TEMPLATE_IS_MALFORMED == 0).then(|| self.literal(token, start, end))
    }

    /// TRV of ECMA-262.
    pub(crate) fn raw_template(&mut self, token: Token) -> Name {
        let (mut offset, end) = Self::template_range(token);
        if !token.is_elaborate() {
            return self.names.literal_in_source(self.source, offset, end);
        }
        self.scratch.clear();
        while offset < end {
            offset = self.push_normalized(offset);
        }
        self.names.literal(self.source, Text::Utf16(&self.scratch))
    }

    fn unit(&self, offset: usize) -> u16 {
        self.source.text.get(offset).unwrap_or(0)
    }

    /// Both CR and CR LF are LF.
    fn push_normalized(&mut self, offset: usize) -> usize {
        let unit = self.unit(offset);
        if unit != 0x0d {
            self.scratch.push(unit);
            return offset + 1;
        }
        self.scratch.push(0x0a);
        offset + 1 + usize::from(self.unit(offset + 1) == 0x0a)
    }

    /// Into `scratch`. The escapes are well formed.
    fn unescape(&mut self, mut offset: usize, end: usize) {
        self.scratch.clear();
        while offset < end {
            let rest = &self.bytes[offset..end];
            let plain = bun_highway::index_of_any_char(rest, b"\\\r").unwrap_or(rest.len());
            match self.source.text.slice(offset..offset + plain) {
                Text::Latin1(run) => self.scratch.extend(run.iter().map(|&it| u16::from(it))),
                Text::Utf16(run) => self.scratch.extend_from_slice(run),
            }
            offset += plain;
            match rest.get(plain) {
                Some(b'\\') => offset = self.push_escaped(offset + 1),
                Some(_) => offset = self.push_normalized(offset),
                None => {}
            }
        }
    }

    /// `offset` is past the backslash.
    fn push_escaped(&mut self, offset: usize) -> usize {
        let next = offset + 1;
        let digit = |offset: usize, radix| char::from(self.byte(offset)).to_digit(radix);
        let (value, end) = match self.byte(offset) {
            b'b' => (0x08, next),
            b't' => (0x09, next),
            b'n' => (0x0a, next),
            b'v' => (0x0b, next),
            b'f' => (0x0c, next),
            b'r' => (0x0d, next),
            b'\r' => return next + usize::from(self.unit(next) == 0x0a),
            b'\n' => return next,
            b'x' => {
                let (high, low) = (digit(next, 16), digit(next + 1, 16));
                (high.unwrap_or(0) << 4 | low.unwrap_or(0), next + 2)
            }
            b'u' => {
                let (code_point, end) = self.unicode_escape(next);
                (code_point.unwrap_or(0), end)
            }
            first @ b'0'..=b'7' => {
                let limit = offset + if first <= b'3' { 3 } else { 2 };
                let (mut value, mut end) = (0, offset);
                while end < limit
                    && let Some(digit) = digit(end, 8)
                {
                    value = value * 8 + digit;
                    end += 1;
                }
                (value, end)
            }
            _ => (u32::from(self.unit(offset)), next),
        };
        self.push_code_point(value);
        end
    }
}
