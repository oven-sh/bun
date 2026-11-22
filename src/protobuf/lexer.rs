//! <https://protobuf.dev/reference/protobuf/proto3-spec/#lexical_elements>

use crate::{Failure, Span};
use bun_core::strings;

#[derive(Clone, PartialEq)]
pub(crate) enum Token<'a> {
    Identifier(&'a str),
    Integer(&'a str),
    Float(&'a str),
    String(Vec<u8>),
    Symbol(u8),
    End,
}

#[derive(Clone)]
pub(crate) struct Lexer<'a> {
    text: &'a [u8],
    position: usize,
    pub(crate) token: Token<'a>,
    pub(crate) span: Span,
    /// The lines of the comment that ends right above `token`.
    pub(crate) comment: Vec<&'a [u8]>,
}

fn is_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_identifier_part(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

impl<'a> Lexer<'a> {
    pub(crate) fn new(text: &'a [u8]) -> Result<Self, Failure> {
        let mut lexer = Lexer {
            text,
            position: text.len() - strings::without_utf8_bom(text).len(),
            token: Token::End,
            span: Span::default(),
            comment: Vec::new(),
        };
        lexer.advance()?;
        Ok(lexer)
    }

    fn peek(&self, ahead: usize) -> u8 {
        self.text.get(self.position + ahead).copied().unwrap_or(0)
    }

    fn skip_while(&mut self, belongs: impl Fn(u8) -> bool) {
        while self.position < self.text.len() && belongs(self.text[self.position]) {
            self.position += 1;
        }
    }

    fn span_from(&self, start: usize) -> Span {
        Span {
            start,
            len: self.position - start,
        }
    }

    fn ascii_from(&self, start: usize) -> &'a str {
        core::str::from_utf8(&self.text[start..self.position]).expect("only ASCII was skipped")
    }

    fn skip_whitespace_and_comments(&mut self) -> Result<(), Failure> {
        self.comment.clear();
        let mut is_on_line_of_last_token = self.span.len > 0;
        let mut newlines = 0;
        loop {
            match (self.peek(0), self.peek(1)) {
                (b'\n', _) => {
                    self.position += 1;
                    is_on_line_of_last_token = false;
                    newlines += 1;
                    if newlines > 1 {
                        self.comment.clear();
                    }
                }
                (b' ' | b'\t' | b'\r' | 0x0b | 0x0c, _) => self.position += 1,
                (b'/', b'/') => {
                    let rest = &self.text[self.position + 2..];
                    let len = strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
                    if !is_on_line_of_last_token {
                        self.comment
                            .push(strings::trim_leading_char(&rest[..len], b'/'));
                    }
                    self.position += 2 + len;
                    newlines = 0;
                }
                (b'/', b'*') => {
                    let rest = &self.text[self.position + 2..];
                    let Some(len) = strings::index_of(rest, b"*/") else {
                        let span = Span {
                            start: self.position,
                            len: 2,
                        };
                        return Err(Failure::new(span, "Expected \"*/\" to end this comment"));
                    };
                    if !is_on_line_of_last_token {
                        let lines = strings::split(&rest[..len], b"\n");
                        let lines = lines.map(<[u8]>::trim_ascii_start);
                        (self.comment)
                            .extend(lines.map(|line| strings::trim_leading_char(line, b'*')));
                    }
                    self.position += 4 + len;
                    newlines = 0;
                }
                _ => return Ok(()),
            }
        }
    }

    pub(crate) fn advance(&mut self) -> Result<(), Failure> {
        self.skip_whitespace_and_comments()?;
        let start = self.position;
        self.token = match self.text.get(start) {
            None => Token::End,
            Some(&byte) if is_identifier_start(byte) => {
                self.skip_while(is_identifier_part);
                Token::Identifier(self.ascii_from(start))
            }
            Some(b'0'..=b'9') => self.number()?,
            Some(b'.') if self.peek(1).is_ascii_digit() => self.number()?,
            Some(&quote @ (b'"' | b'\'')) => Token::String(self.string(quote)?),
            Some(&byte) if byte.is_ascii_graphic() => {
                self.position += 1;
                Token::Symbol(byte)
            }
            Some(_) => {
                let span = Span { start, len: 1 };
                return Err(Failure::new(span, "Unexpected character"));
            }
        };
        self.span = self.span_from(start);
        Ok(())
    }

    fn number(&mut self) -> Result<Token<'a>, Failure> {
        let start = self.position;
        let mut is_float = false;
        if self.peek(0) == b'0' && matches!(self.peek(1), b'x' | b'X') {
            self.position += 2;
            self.skip_while(|byte| byte.is_ascii_hexdigit());
        } else {
            self.skip_while(|byte| byte.is_ascii_digit());
            if self.peek(0) == b'.' {
                is_float = true;
                self.position += 1;
                self.skip_while(|byte| byte.is_ascii_digit());
            }
            if matches!(self.peek(0), b'e' | b'E') {
                is_float = true;
                self.position += 1 + usize::from(matches!(self.peek(1), b'+' | b'-'));
                self.skip_while(|byte| byte.is_ascii_digit());
            }
        }
        let text = self.ascii_from(start);
        // The text format of an option's value allows `1.5f`.
        if matches!(self.peek(0), b'f' | b'F') {
            is_float = true;
            self.position += 1;
        }
        if is_identifier_part(self.peek(0)) {
            self.skip_while(is_identifier_part);
            return Err(Failure::new(self.span_from(start), "Invalid number"));
        }
        Ok(match is_float {
            true => Token::Float(text),
            false => Token::Integer(text),
        })
    }

    fn digits(&mut self, radix: u32, most: usize) -> (u32, usize) {
        let (mut value, mut count) = (0u32, 0);
        while count < most
            && let Some(digit) = char::from(self.peek(0)).to_digit(radix)
        {
            value = value.wrapping_mul(radix).wrapping_add(digit);
            self.position += 1;
            count += 1;
        }
        (value, count)
    }

    fn string(&mut self, quote: u8) -> Result<Vec<u8>, Failure> {
        let start = self.position;
        self.position += 1;
        let mut value = Vec::new();
        loop {
            match self.text.get(self.position) {
                None | Some(b'\n' | 0) => {
                    return Err(Failure::new(self.span_from(start), "Unterminated string"));
                }
                Some(b'\\') => self.escape(&mut value)?,
                Some(&byte) => {
                    self.position += 1;
                    if byte == quote {
                        return Ok(value);
                    }
                    value.push(byte);
                }
            }
        }
    }

    fn escape(&mut self, value: &mut Vec<u8>) -> Result<(), Failure> {
        let start = self.position;
        let kind = self.peek(1);
        self.position = (start + 2).min(self.text.len());
        let byte = match kind {
            b'a' => Some(0x07),
            b'b' => Some(0x08),
            b'f' => Some(0x0c),
            b'n' => Some(b'\n'),
            b'r' => Some(b'\r'),
            b't' => Some(b'\t'),
            b'v' => Some(0x0b),
            b'\\' | b'\'' | b'"' | b'?' => Some(kind),
            b'0'..=b'7' => {
                self.position -= 1;
                u8::try_from(self.digits(8, 3).0).ok()
            }
            b'x' | b'X' => match self.digits(16, 2) {
                (_, 0) => None,
                (byte, _) => Some(byte as u8),
            },
            b'u' | b'U' => {
                if let Some(character) = self.unicode_escape(kind) {
                    value.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
                    return Ok(());
                }
                None
            }
            _ => None,
        };
        let invalid = || Failure::new(self.span_from(start), "Invalid escape sequence");
        value.push(byte.ok_or_else(invalid)?);
        Ok(())
    }

    fn unicode_escape(&mut self, kind: u8) -> Option<char> {
        let expected = if kind == b'u' { 4 } else { 8 };
        let (code, count) = self.digits(16, expected);
        if count != expected {
            return None;
        }
        if (0xD800..0xDC00).contains(&code) && (self.peek(0), self.peek(1)) == (b'\\', b'u') {
            self.position += 2;
            let (low, count) = self.digits(16, 4);
            if count != 4 || !(0xDC00..0xE000).contains(&low) {
                return None;
            }
            return char::from_u32(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00));
        }
        char::from_u32(code)
    }
}
