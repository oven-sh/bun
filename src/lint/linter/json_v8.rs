//! `JSON.parse` as V8 implements it, for its error messages: ESLint quotes them in what it reports
//! about an `/* eslint .. */` comment that it cannot read.

use crate::options::Json;

const MAX_DEPTH: usize = 512;
/// `kMaxContextCharacters`
const CONTEXT: usize = 10;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Token {
    String,
    Number,
    LBrace,
    RBrace,
    LBrack,
    RBrack,
    True,
    False,
    Null,
    Colon,
    Comma,
    Illegal,
    Eos,
}

struct Parser<'t> {
    text: &'t [u16],
    at: usize,
}

type Parsed<T> = Result<T, Vec<u8>>;

impl Parser<'_> {
    fn current(&self) -> Option<u16> {
        self.text.get(self.at).copied()
    }

    fn next(&mut self) -> Option<u16> {
        self.at += 1;
        self.current()
    }

    fn is_digit(c: Option<u16>) -> bool {
        c.is_some_and(|c| (0x30..=0x39).contains(&c))
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.current(), Some(0x20 | 0x09 | 0x0A | 0x0D)) {
            self.at += 1;
        }
    }

    fn peek(&self) -> Token {
        let Some(c) = self.current() else {
            return Token::Eos;
        };
        match u8::try_from(c).unwrap_or(0) {
            b'"' => Token::String,
            b'-' | b'0'..=b'9' => Token::Number,
            b'{' => Token::LBrace,
            b'}' => Token::RBrace,
            b'[' => Token::LBrack,
            b']' => Token::RBrack,
            b't' => Token::True,
            b'f' => Token::False,
            b'n' => Token::Null,
            b':' => Token::Colon,
            b',' => Token::Comma,
            _ => Token::Illegal,
        }
    }

    /// `message` with ` at position P (line L column C)`.
    fn error_at(&self, message: &str) -> Vec<u8> {
        let at = self.at.min(self.text.len());
        let (mut line, mut line_start, mut i) = (1, 0, 0);
        while i < at {
            if self.text[i] == 0x0D && i + 1 < at && self.text[i + 1] == 0x0A {
                i += 1;
            }
            if matches!(self.text[i], 0x0D | 0x0A) {
                line += 1;
                line_start = i + 1;
            }
            i += 1;
        }
        format!(
            "{message} at position {at} (line {line} column {})",
            1 + at - line_start
        )
        .into_bytes()
    }

    /// `ReportUnexpectedToken` without a message of its own.
    fn unexpected(&self) -> Vec<u8> {
        match self.peek() {
            Token::Eos => return b"Unexpected end of JSON input".to_vec(),
            Token::Number => return self.error_at("Unexpected number in JSON"),
            Token::String => return self.error_at("Unexpected string in JSON"),
            _ => {}
        }
        let (at, len) = (self.at, self.text.len());
        // `IsSpecialString`
        let is = |special: &str| special.encode_utf16().eq(self.text.iter().copied());
        if ["NaN", "Infinity", "undefined", "[object Object]"]
            .into_iter()
            .any(is)
        {
            let mut out = vec![b'"'];
            bun_core::strings::to_utf8_append_to_list(&mut out, self.text);
            out.extend_from_slice(b"\" is not valid JSON");
            return out;
        }
        let (before, start, end, after) = if len < CONTEXT * 2 + 1 {
            ("", 0, len, "")
        } else if at < CONTEXT {
            ("", 0, at + CONTEXT, "...")
        } else if at < len - CONTEXT {
            ("...", at - CONTEXT, at + CONTEXT, "...")
        } else {
            ("...", at - CONTEXT, len, "")
        };
        let mut out = b"Unexpected token '".to_vec();
        bun_core::strings::to_utf8_append_to_list(&mut out, &self.text[at..at + 1]);
        out.extend_from_slice(b"', ");
        out.extend_from_slice(before.as_bytes());
        out.push(b'"');
        bun_core::strings::to_utf8_append_to_list(&mut out, &self.text[start..end]);
        out.push(b'"');
        out.extend_from_slice(after.as_bytes());
        out.extend_from_slice(b" is not valid JSON");
        out
    }

    fn check(&mut self, token: Token) -> bool {
        self.skip_whitespace();
        let found = self.peek() == token;
        self.at += usize::from(found);
        found
    }

    fn expect_next(&mut self, token: Token, message: &str) -> Parsed<()> {
        match self.check(token) {
            true => Ok(()),
            false => Err(self.error_at(message)),
        }
    }

    fn literal(&mut self, word: &[u8], value: Json) -> Parsed<Json> {
        for &expected in word {
            if self.current() != Some(u16::from(expected)) {
                return Err(self.unexpected());
            }
            self.at += 1;
        }
        Ok(value)
    }

    fn number(&mut self) -> Parsed<Json> {
        let start = self.at;
        let mut c = self.current();
        if c == Some(0x2D) {
            c = self.next();
        }
        if c == Some(0x30) {
            if Self::is_digit(self.next()) {
                return Err(self.error_at("Unexpected number in JSON"));
            }
        } else {
            let digits = self.at;
            while Self::is_digit(self.current()) {
                self.at += 1;
            }
            if digits == self.at {
                return Err(self.error_at("No number after minus sign in JSON"));
            }
        }
        if self.current() == Some(0x2E) {
            if !Self::is_digit(self.next()) {
                return Err(self.error_at("Unterminated fractional number in JSON"));
            }
            while Self::is_digit(self.current()) {
                self.at += 1;
            }
        }
        if matches!(self.current(), Some(0x45 | 0x65)) {
            let mut c = self.next();
            if matches!(c, Some(0x2B | 0x2D)) {
                c = self.next();
            }
            if !Self::is_digit(c) {
                return Err(self.error_at("Exponent part is missing a number in JSON"));
            }
            while Self::is_digit(self.current()) {
                self.at += 1;
            }
        }
        let written: String = self.text[start..self.at]
            .iter()
            .map(|&c| c as u8 as char)
            .collect();
        Ok(Json::Number(written.parse().unwrap_or(f64::NAN)))
    }

    /// After the opening quote.
    fn string(&mut self) -> Parsed<Vec<u8>> {
        let mut units = Vec::new();
        loop {
            let Some(c) = self.current() else {
                return Err(self.error_at("Unterminated string in JSON"));
            };
            match c {
                0x22 => {
                    self.at += 1;
                    let mut out = Vec::with_capacity(units.len());
                    bun_core::strings::to_utf8_append_to_list(&mut out, &units);
                    return Ok(out);
                }
                0x5C => {
                    let Some(escaped) = self.next().and_then(|c| u8::try_from(c).ok()) else {
                        return Err(self.unexpected());
                    };
                    units.push(match Some(escaped) {
                        Some(c @ (b'"' | b'\\' | b'/')) => u16::from(c),
                        Some(b'b') => 0x08,
                        Some(b'f') => 0x0C,
                        Some(b'n') => 0x0A,
                        Some(b'r') => 0x0D,
                        Some(b't') => 0x09,
                        Some(b'u') => {
                            let mut value = 0;
                            for _ in 0..4 {
                                let digit = self
                                    .next()
                                    .and_then(|c| char::from_u32(u32::from(c))?.to_digit(16));
                                let Some(digit) = digit else {
                                    return Err(self.error_at("Bad Unicode escape in JSON"));
                                };
                                value = value * 16 + digit as u16;
                            }
                            value
                        }
                        _ => return Err(self.error_at("Bad escaped character in JSON")),
                    });
                    self.at += 1;
                }
                0..0x20 => {
                    return Err(self.error_at("Bad control character in string literal in JSON"));
                }
                _ => {
                    units.push(c);
                    self.at += 1;
                }
            }
        }
    }

    fn value(&mut self, depth: usize) -> Parsed<Json> {
        if depth > MAX_DEPTH {
            return Err(b"Maximum call stack size exceeded".to_vec());
        }
        self.skip_whitespace();
        match self.peek() {
            Token::String => {
                self.at += 1;
                self.string().map(Json::String)
            }
            Token::Number => self.number(),
            Token::True => self.literal(b"true", Json::Bool(true)),
            Token::False => self.literal(b"false", Json::Bool(false)),
            Token::Null => self.literal(b"null", Json::Null),
            Token::LBrace => {
                self.at += 1;
                let mut entries: Vec<(Vec<u8>, Json)> = Vec::new();
                if self.check(Token::RBrace) {
                    return Ok(Json::Object(entries));
                }
                self.expect_next(Token::String, "Expected property name or '}' in JSON")?;
                loop {
                    let key = self.string()?;
                    self.expect_next(Token::Colon, "Expected ':' after property name in JSON")?;
                    let value = self.value(depth + 1)?;
                    match entries.iter_mut().find(|it| it.0 == key) {
                        Some(entry) => entry.1 = value,
                        None => entries.push((key, value)),
                    }
                    if !self.check(Token::Comma) {
                        break;
                    }
                    self.expect_next(
                        Token::String,
                        "Expected double-quoted property name in JSON",
                    )?;
                }
                self.expect_next(
                    Token::RBrace,
                    "Expected ',' or '}' after property value in JSON",
                )?;
                Ok(Json::Object(entries))
            }
            Token::LBrack => {
                self.at += 1;
                let mut items = Vec::new();
                if self.check(Token::RBrack) {
                    return Ok(Json::Array(items));
                }
                loop {
                    items.push(self.value(depth + 1)?);
                    if !self.check(Token::Comma) {
                        break;
                    }
                }
                self.expect_next(
                    Token::RBrack,
                    "Expected ',' or ']' after array element in JSON",
                )?;
                Ok(Json::Array(items))
            }
            Token::Colon
            | Token::Comma
            | Token::Illegal
            | Token::RBrace
            | Token::RBrack
            | Token::Eos => Err(self.unexpected()),
        }
    }
}

/// `Err`: the message of the `SyntaxError`.
pub fn parse(text: &[u8]) -> Result<Json, Vec<u8>> {
    let mut units: Vec<u16> = Vec::with_capacity(text.len());
    for chunk in text.utf8_chunks() {
        units.extend(chunk.valid().encode_utf16());
        if !chunk.invalid().is_empty() {
            units.push(0xFFFD);
        }
    }
    let mut parser = Parser {
        text: &units,
        at: 0,
    };
    let value = parser.value(0)?;
    match parser.check(Token::Eos) {
        true => Ok(value),
        false => Err(parser.error_at("Unexpected non-whitespace character after JSON")),
    }
}
