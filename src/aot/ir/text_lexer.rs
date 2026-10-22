#[cfg(test)]
mod tests;

use bun_core::fmt::{hex_digit_value, hex_pair_value, parse_f64};
use bun_core::strings;

const NAN_WORD: &[u8] = b"NaN";
const INFINITY_WORD: &[u8] = b"Infinity";
const FIRST_STRING_BYTE: u8 = 0x20;
const ESCAPE_PAIR_LENGTH: usize = 2;
const MAX_CODE_POINT: u32 = 0x10FFFF;
const MAX_CODE_POINT_DIGIT_COUNT: usize = 6;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct TextPosition {
    pub line: u32,
    pub column: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TokenKind {
    EndOfFile,
    EndOfLine,
    Word,
    Integer,
    Number,
    String,
    Colon,
    Equal,
    Comma,
    LeftParenthesis,
    RightParenthesis,
    LeftBracket,
    RightBracket,
    LeftBrace,
    RightBrace,
    LeftAngle,
    RightAngle,
    Bar,
    At,
    NumberSign,
    Minus,
    Arrow,
    Invalid,
}

#[derive(Copy, Clone)]
pub struct Token<'t> {
    pub kind: TokenKind,
    pub position: TextPosition,
    pub text: &'t [u8],
    pub integer: i64,
}

impl Token<'_> {
    pub fn double(&self) -> Option<f64> {
        match self.kind {
            TokenKind::Integer => Some(self.integer as f64),
            TokenKind::Number => parse_f64(self.text),
            TokenKind::Word if self.text == NAN_WORD => Some(f64::NAN),
            TokenKind::Word if self.text == INFINITY_WORD => Some(f64::INFINITY),
            TokenKind::Word
            | TokenKind::EndOfFile
            | TokenKind::EndOfLine
            | TokenKind::String
            | TokenKind::Colon
            | TokenKind::Equal
            | TokenKind::Comma
            | TokenKind::LeftParenthesis
            | TokenKind::RightParenthesis
            | TokenKind::LeftBracket
            | TokenKind::RightBracket
            | TokenKind::LeftBrace
            | TokenKind::RightBrace
            | TokenKind::LeftAngle
            | TokenKind::RightAngle
            | TokenKind::Bar
            | TokenKind::At
            | TokenKind::NumberSign
            | TokenKind::Minus
            | TokenKind::Arrow
            | TokenKind::Invalid => None,
        }
    }
}

#[derive(Copy, Clone)]
pub struct LexerState {
    offset: usize,
    position: TextPosition,
    has_token_on_line: bool,
}

pub struct Lexer<'t> {
    text: &'t [u8],
    state: LexerState,
}

impl<'t> Lexer<'t> {
    pub fn new(text: &'t [u8]) -> Lexer<'t> {
        let state = LexerState {
            offset: 0,
            position: TextPosition { line: 1, column: 1 },
            has_token_on_line: false,
        };
        Lexer { text, state }
    }

    pub fn next(&mut self) -> Token<'t> {
        loop {
            self.skip_blanks();
            let start = self.state;
            match self.peek(0) {
                None => {
                    self.state.has_token_on_line = false;
                    let kind = if start.has_token_on_line {
                        TokenKind::EndOfLine
                    } else {
                        TokenKind::EndOfFile
                    };
                    return self.token(kind, start);
                }
                Some(b'\n') => {
                    self.bump_line();
                    if start.has_token_on_line {
                        return self.token(TokenKind::EndOfLine, start);
                    }
                }
                Some(b'#') if self.peek(1) != Some(b'"') => self.skip_comment(),
                Some(byte) => {
                    self.state.has_token_on_line = true;
                    return self.scan_token(byte);
                }
            }
        }
    }

    pub fn state(&self) -> LexerState {
        self.state
    }

    pub fn restore(&mut self, state: LexerState) {
        self.state = state;
    }

    fn peek(&self, distance: usize) -> Option<u8> {
        self.text.get(self.state.offset + distance).copied()
    }

    fn is_at_digit(&self, distance: usize) -> bool {
        self.peek(distance)
            .is_some_and(|byte| byte.is_ascii_digit())
    }

    fn bump(&mut self, count: usize) {
        let columns = u32::try_from(count).unwrap_or(u32::MAX);
        self.state.offset += count;
        self.state.position.column = self.state.position.column.saturating_add(columns);
    }

    fn bump_line(&mut self) {
        self.state.offset += 1;
        self.state.position.line = self.state.position.line.saturating_add(1);
        self.state.position.column = 1;
        self.state.has_token_on_line = false;
    }

    fn token(&self, kind: TokenKind, start: LexerState) -> Token<'t> {
        Token {
            kind,
            position: start.position,
            text: &self.text[start.offset..self.state.offset],
            integer: 0,
        }
    }

    fn skip_blanks(&mut self) {
        while matches!(self.peek(0), Some(b' ' | b'\t' | b'\r')) {
            self.bump(1);
        }
    }

    fn skip_comment(&mut self) {
        let start = self.state.offset;
        let end = strings::index_of_char_pos(self.text, b'\n', start).unwrap_or(self.text.len());
        self.bump(end - start);
    }

    fn skip_word_bytes(&mut self) {
        while self.peek(0).is_some_and(is_word_byte) {
            self.bump(1);
        }
    }

    fn skip_digits(&mut self) {
        while self.is_at_digit(0) {
            self.bump(1);
        }
    }

    fn skip_fraction(&mut self) {
        if self.peek(0) == Some(b'.') && self.is_at_digit(1) {
            self.bump(1);
            self.skip_digits();
        }
    }

    fn skip_exponent(&mut self) {
        if !matches!(self.peek(0), Some(b'e' | b'E')) {
            return;
        }
        let sign_length = usize::from(matches!(self.peek(1), Some(b'+' | b'-')));
        if self.is_at_digit(1 + sign_length) {
            self.bump(1 + sign_length);
            self.skip_digits();
        }
    }

    fn scan_token(&mut self, byte: u8) -> Token<'t> {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'_' => self.scan_word(),
            b'0'..=b'9' => self.scan_number(),
            b'-' => self.scan_minus(),
            b'"' => self.scan_string(),
            _ => self.scan_punctuation(byte),
        }
    }

    fn scan_word(&mut self) -> Token<'t> {
        let start = self.state;
        self.skip_word_bytes();
        self.token(TokenKind::Word, start)
    }

    fn scan_number(&mut self) -> Token<'t> {
        let start = self.state;
        let is_negative = self.peek(0) == Some(b'-');
        if is_negative {
            self.bump(1);
        }
        let mut value = Some(0i64);
        while let Some(byte) = self.peek(0).filter(u8::is_ascii_digit) {
            let digit = i64::from(byte - b'0');
            let signed_digit = if is_negative { -digit } else { digit };
            value = value
                .and_then(|value| value.checked_mul(10))
                .and_then(|value| value.checked_add(signed_digit));
            self.bump(1);
        }
        let digits_end = self.state.offset;
        self.skip_fraction();
        self.skip_exponent();
        self.skip_word_bytes();
        let has_only_digits = self.state.offset == digits_end;
        let is_negative_zero = is_negative && value == Some(0);
        let number = self.token(TokenKind::Number, start);
        match value.filter(|_| has_only_digits && !is_negative_zero) {
            Some(integer) => Token {
                kind: TokenKind::Integer,
                integer,
                ..number
            },
            None if parse_f64(number.text).is_some() => number,
            None => Token {
                kind: TokenKind::Invalid,
                ..number
            },
        }
    }

    fn scan_minus(&mut self) -> Token<'t> {
        if self.is_at_digit(1) {
            return self.scan_number();
        }
        let start = self.state;
        self.bump(1);
        if self.peek(0) == Some(b'>') {
            self.bump(1);
            return self.token(TokenKind::Arrow, start);
        }
        let minus = self.token(TokenKind::Minus, start);
        let after_minus = self.state;
        self.skip_word_bytes();
        if &self.text[after_minus.offset..self.state.offset] == INFINITY_WORD {
            return self.token(TokenKind::Number, start);
        }
        self.state = after_minus;
        minus
    }

    fn scan_string(&mut self) -> Token<'t> {
        let start = self.state;
        self.bump(1);
        loop {
            match self.peek(0) {
                Some(b'"') => {
                    let text = &self.text[start.offset + 1..self.state.offset];
                    self.bump(1);
                    let string = self.token(TokenKind::String, start);
                    return Token { text, ..string };
                }
                Some(b'\\') if self.peek(1).is_some_and(is_string_byte) => {
                    self.bump(ESCAPE_PAIR_LENGTH);
                }
                Some(byte) if byte != b'\\' && is_string_byte(byte) => self.bump(1),
                _ => return self.token(TokenKind::Invalid, self.state),
            }
        }
    }

    fn scan_punctuation(&mut self, byte: u8) -> Token<'t> {
        let kind = match byte {
            b':' => TokenKind::Colon,
            b'=' => TokenKind::Equal,
            b',' => TokenKind::Comma,
            b'(' => TokenKind::LeftParenthesis,
            b')' => TokenKind::RightParenthesis,
            b'[' => TokenKind::LeftBracket,
            b']' => TokenKind::RightBracket,
            b'{' => TokenKind::LeftBrace,
            b'}' => TokenKind::RightBrace,
            b'<' => TokenKind::LeftAngle,
            b'>' => TokenKind::RightAngle,
            b'|' => TokenKind::Bar,
            b'@' => TokenKind::At,
            b'#' => TokenKind::NumberSign,
            _ => TokenKind::Invalid,
        };
        let start = self.state;
        self.bump(1);
        self.token(kind, start)
    }
}

pub fn decode_string(text: &[u8]) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some((&byte, tail)) = rest.split_first() {
        if byte != b'\\' {
            bytes.push(byte);
            rest = tail;
            continue;
        }
        rest = match tail {
            [escaped @ (b'"' | b'\\'), after @ ..] => {
                bytes.push(*escaped);
                after
            }
            [b'n', after @ ..] => {
                bytes.push(b'\n');
                after
            }
            [b'x', high, low, after @ ..] => {
                bytes.push(hex_pair_value(*high, *low)?);
                after
            }
            [b'u', b'{', after @ ..] => decode_code_point_escape(after, &mut bytes)?,
            _ => return None,
        };
    }
    Some(bytes)
}

pub fn decode_bytes(text: &[u8]) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some((&byte, tail)) = rest.split_first() {
        rest = match (byte, tail) {
            (b'\\', [b'x', high, low, after @ ..]) => {
                bytes.push(hex_pair_value(*high, *low)?);
                after
            }
            (0x20..=0x5b | 0x5d..=0x7e, _) => {
                bytes.push(byte);
                tail
            }
            _ => return None,
        };
    }
    Some(bytes)
}

fn decode_code_point_escape<'t>(text: &'t [u8], bytes: &mut Vec<u8>) -> Option<&'t [u8]> {
    let (digits, rest) = text.split_at(strings::index_of_char_usize(text, b'}')?);
    if digits.is_empty() || digits.len() > MAX_CODE_POINT_DIGIT_COUNT {
        return None;
    }
    let mut code_point = 0u32;
    for &digit in digits {
        code_point = (code_point << 4) | u32::from(hex_digit_value(digit)?);
    }
    if code_point > MAX_CODE_POINT {
        return None;
    }
    strings::push_codepoint_wtf8(bytes, code_point);
    Some(&rest[1..])
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn is_string_byte(byte: u8) -> bool {
    byte >= FIRST_STRING_BYTE
}
