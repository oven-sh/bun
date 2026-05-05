//! JSON5 Token-Based Scanner/Parser
//!
//! Parses JSON5 text into Expr AST values. JSON5 is a superset of JSON
//! based on ECMAScript 5.1 that supports comments, trailing commas,
//! unquoted keys, single-quoted strings, hex numbers, Infinity, NaN, etc.
//!
//! Architecture: a scanner reads source bytes and produces typed tokens;
//! the parser only consumes tokens and never touches source/pos directly.
//!
//! Reference: https://spec.json5.org/

use bun_alloc::Arena as Bump;
use bun_core::StackCheck;
// MOVE_DOWN(b0): bun_js_parser::lexer / {E,Expr,G} → bun_logger (js_ast remapped, T2)
use bun_logger::lexer::identifier;
use bun_logger::js_ast::{E, Expr, G};
use bun_logger::{self as logger, Loc, Log, Source};
use bun_str::strings;
use bumpalo::collections::Vec as BumpVec;

pub struct JSON5Parser<'a> {
    source: &'a [u8],
    pos: usize,
    bump: &'a Bump,
    stack_check: StackCheck,
    token: Token<'a>,
}

struct Token<'a> {
    loc: Loc,
    data: TokenData<'a>,
}

enum TokenData<'a> {
    Eof,
    // Structural
    LeftBrace,
    RightBrace,
    LeftBracket,
    RightBracket,
    Colon,
    Comma,
    // Values
    String(&'a [u8]),
    Number(f64),
    Boolean(bool),
    Null,
    // Identifiers (for unquoted keys that aren't keywords)
    Identifier(&'a [u8]),
}

impl<'a> TokenData<'a> {
    fn can_start_value(&self) -> bool {
        match self {
            TokenData::String(_)
            | TokenData::Number(_)
            | TokenData::Boolean(_)
            | TokenData::Identifier(_)
            | TokenData::Null
            | TokenData::LeftBrace
            | TokenData::LeftBracket => true,
            TokenData::Eof
            | TokenData::RightBrace
            | TokenData::RightBracket
            | TokenData::Colon
            | TokenData::Comma => false,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ParseError {
    OutOfMemory,
    UnexpectedCharacter,
    UnexpectedToken,
    UnexpectedEof,
    UnterminatedString,
    UnterminatedComment,
    UnterminatedObject,
    UnterminatedArray,
    UnterminatedEscape,
    InvalidNumber,
    LeadingZeros,
    InvalidHexNumber,
    InvalidHexEscape,
    InvalidUnicodeEscape,
    OctalEscape,
    ExpectedColon,
    ExpectedComma,
    ExpectedClosingBrace,
    ExpectedClosingBracket,
    InvalidIdentifier,
    TrailingData,
    StackOverflow,
}

impl From<bun_alloc::AllocError> for ParseError {
    fn from(_: bun_alloc::AllocError) -> Self {
        ParseError::OutOfMemory
    }
}

impl From<ParseError> for bun_core::Error {
    fn from(e: ParseError) -> Self {
        // IntoStaticStr yields the exact @errorName tag; intern into the global table.
        bun_core::Error::intern(<&'static str>::from(e))
    }
}

#[derive(Clone, Copy)]
pub enum Error {
    Oom,
    StackOverflow,
    UnexpectedCharacter { pos: usize },
    UnexpectedToken { pos: usize },
    UnexpectedEof { pos: usize },
    UnterminatedString { pos: usize },
    UnterminatedComment { pos: usize },
    UnterminatedObject { pos: usize },
    UnterminatedArray { pos: usize },
    UnterminatedEscape { pos: usize },
    InvalidNumber { pos: usize },
    LeadingZeros { pos: usize },
    InvalidHexNumber { pos: usize },
    InvalidHexEscape { pos: usize },
    InvalidUnicodeEscape { pos: usize },
    OctalEscape { pos: usize },
    ExpectedColon { pos: usize },
    ExpectedComma { pos: usize },
    ExpectedClosingBrace { pos: usize },
    ExpectedClosingBracket { pos: usize },
    InvalidIdentifier { pos: usize },
    TrailingData { pos: usize },
}

#[derive(Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum AddToLogError {
    OutOfMemory,
    StackOverflow,
}

impl From<AddToLogError> for bun_core::Error {
    fn from(e: AddToLogError) -> Self {
        match e {
            AddToLogError::OutOfMemory => bun_core::err!("OutOfMemory"),
            AddToLogError::StackOverflow => bun_core::err!("StackOverflow"),
        }
    }
}

impl Error {
    pub fn add_to_log(&self, source: &Source, log: &mut Log) -> Result<(), AddToLogError> {
        let loc: Loc = match *self {
            Error::Oom => return Err(AddToLogError::OutOfMemory),
            Error::StackOverflow => return Err(AddToLogError::StackOverflow),
            Error::UnexpectedCharacter { pos }
            | Error::UnexpectedToken { pos }
            | Error::UnexpectedEof { pos }
            | Error::UnterminatedString { pos }
            | Error::UnterminatedComment { pos }
            | Error::UnterminatedObject { pos }
            | Error::UnterminatedArray { pos }
            | Error::UnterminatedEscape { pos }
            | Error::InvalidNumber { pos }
            | Error::LeadingZeros { pos }
            | Error::InvalidHexNumber { pos }
            | Error::InvalidHexEscape { pos }
            | Error::InvalidUnicodeEscape { pos }
            | Error::OctalEscape { pos }
            | Error::ExpectedColon { pos }
            | Error::ExpectedComma { pos }
            | Error::ExpectedClosingBrace { pos }
            | Error::ExpectedClosingBracket { pos }
            | Error::InvalidIdentifier { pos }
            | Error::TrailingData { pos } => Loc { start: i32::try_from(pos).unwrap() },
        };
        let msg: &'static [u8] = match *self {
            Error::Oom | Error::StackOverflow => unreachable!(),
            Error::UnexpectedCharacter { .. } => b"Unexpected character",
            Error::UnexpectedToken { .. } => b"Unexpected token",
            Error::UnexpectedEof { .. } => b"Unexpected end of input",
            Error::UnterminatedString { .. } => b"Unterminated string",
            Error::UnterminatedComment { .. } => b"Unterminated multi-line comment",
            Error::UnterminatedObject { .. } => b"Unterminated object",
            Error::UnterminatedArray { .. } => b"Unterminated array",
            Error::UnterminatedEscape { .. } => b"Unexpected end of input in escape sequence",
            Error::InvalidNumber { .. } => b"Invalid number",
            Error::LeadingZeros { .. } => b"Leading zeros are not allowed in JSON5",
            Error::InvalidHexNumber { .. } => b"Invalid hex number",
            Error::InvalidHexEscape { .. } => b"Invalid hex escape",
            Error::InvalidUnicodeEscape { .. } => b"Invalid unicode escape: expected 4 hex digits",
            Error::OctalEscape { .. } => b"Octal escape sequences are not allowed in JSON5",
            Error::ExpectedColon { .. } => b"Expected ':' after object key",
            Error::ExpectedComma { .. } => b"Expected ','",
            Error::ExpectedClosingBrace { .. } => b"Expected '}'",
            Error::ExpectedClosingBracket { .. } => b"Expected ']'",
            Error::InvalidIdentifier { .. } => b"Invalid identifier start character",
            Error::TrailingData { .. } => b"Unexpected token after JSON5 value",
        };
        log.add_error(source, loc, msg).map_err(|_| AddToLogError::OutOfMemory)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ExternalError {
    OutOfMemory,
    SyntaxError,
    StackOverflow,
}

impl From<ExternalError> for bun_core::Error {
    fn from(e: ExternalError) -> Self {
        match e {
            ExternalError::OutOfMemory => bun_core::err!("OutOfMemory"),
            ExternalError::SyntaxError => bun_core::err!("SyntaxError"),
            ExternalError::StackOverflow => bun_core::err!("StackOverflow"),
        }
    }
}

impl<'a> JSON5Parser<'a> {
    fn to_error(err: ParseError, parser: &JSON5Parser<'_>) -> Error {
        let token_pos = parser.token.loc.to_usize();
        let scan_pos = parser.pos;
        match err {
            ParseError::OutOfMemory => Error::Oom,
            ParseError::StackOverflow => Error::StackOverflow,
            // Scanner errors use scan position
            ParseError::UnexpectedCharacter => Error::UnexpectedCharacter { pos: scan_pos },
            ParseError::UnterminatedString => Error::UnterminatedString { pos: scan_pos },
            ParseError::UnterminatedComment => Error::UnterminatedComment { pos: scan_pos },
            ParseError::UnterminatedEscape => Error::UnterminatedEscape { pos: scan_pos },
            ParseError::InvalidNumber => Error::InvalidNumber { pos: scan_pos },
            ParseError::LeadingZeros => Error::LeadingZeros { pos: scan_pos },
            ParseError::InvalidHexNumber => Error::InvalidHexNumber { pos: scan_pos },
            ParseError::InvalidHexEscape => Error::InvalidHexEscape { pos: scan_pos },
            ParseError::InvalidUnicodeEscape => Error::InvalidUnicodeEscape { pos: scan_pos },
            ParseError::OctalEscape => Error::OctalEscape { pos: scan_pos },
            ParseError::InvalidIdentifier => Error::InvalidIdentifier { pos: scan_pos },
            // Parser errors use token position
            ParseError::UnexpectedToken => Error::UnexpectedToken { pos: token_pos },
            ParseError::UnexpectedEof => {
                if matches!(parser.token.data, TokenData::Eof) {
                    Error::UnexpectedEof { pos: token_pos }
                } else {
                    Error::UnexpectedToken { pos: token_pos }
                }
            }
            ParseError::TrailingData => Error::TrailingData { pos: token_pos },
            ParseError::ExpectedColon => Error::ExpectedColon { pos: token_pos },
            ParseError::UnterminatedObject => Error::UnterminatedObject { pos: token_pos },
            ParseError::ExpectedComma => Error::ExpectedComma { pos: token_pos },
            ParseError::ExpectedClosingBrace => Error::ExpectedClosingBrace { pos: token_pos },
            ParseError::UnterminatedArray => Error::UnterminatedArray { pos: token_pos },
            ParseError::ExpectedClosingBracket => Error::ExpectedClosingBracket { pos: token_pos },
        }
    }

    pub fn parse(source: &'a Source, log: &mut Log, bump: &'a Bump) -> Result<Expr, ExternalError> {
        let mut parser = JSON5Parser {
            source: source.contents.as_ref(),
            pos: 0,
            bump,
            stack_check: StackCheck::init(),
            token: Token { loc: Loc::default(), data: TokenData::Eof },
        };
        match parser.parse_root() {
            Ok(result) => Ok(result),
            Err(err) => {
                let e = Self::to_error(err, &parser);
                e.add_to_log(source, log).map_err(|e| match e {
                    AddToLogError::OutOfMemory => ExternalError::OutOfMemory,
                    AddToLogError::StackOverflow => ExternalError::StackOverflow,
                })?;
                Err(ExternalError::SyntaxError)
            }
        }
    }

    // ── Scanner ──

    /// Returns the byte at the current position, or 0 if at EOF.
    /// All source access in scan() goes through this to avoid bounds checks.
    fn peek(&self) -> u8 {
        if self.pos < self.source.len() {
            return self.source[self.pos];
        }
        0
    }

    fn scan(&mut self) -> Result<(), ParseError> {
        self.token.data = 'next: loop {
            match self.peek() {
                0 => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    break 'next TokenData::Eof;
                }
                // Whitespace — skip without setting loc
                b'\t' | b'\n' | b'\r' | b' ' | 0x0B | 0x0C => {
                    self.pos += 1;
                    continue 'next;
                }
                // Structural
                b'{' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::LeftBrace;
                }
                b'}' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::RightBrace;
                }
                b'[' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::LeftBracket;
                }
                b']' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::RightBracket;
                }
                b':' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::Colon;
                }
                b',' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::Comma;
                }
                b'+' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::Number(self.scan_signed_value(false)?);
                }
                b'-' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    self.pos += 1;
                    break 'next TokenData::Number(self.scan_signed_value(true)?);
                }
                // Strings
                b'"' | b'\'' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    break 'next TokenData::String(self.scan_string()?);
                }
                // Numbers
                b'0'..=b'9' | b'.' => {
                    self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                    break 'next TokenData::Number(self.scan_number()?);
                }
                // Comments — skip without setting loc
                b'/' => {
                    let n = if self.pos + 1 < self.source.len() { self.source[self.pos + 1] } else { 0 };
                    if n == b'/' {
                        self.pos += 2;
                        self.skip_to_end_of_line();
                        continue 'next;
                    } else if n == b'*' {
                        self.pos += 2;
                        self.skip_block_comment()?;
                        continue 'next;
                    }
                    return Err(ParseError::UnexpectedCharacter);
                }
                c => {
                    if c == b't' {
                        self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                        break 'next if self.scan_keyword(b"true") {
                            TokenData::Boolean(true)
                        } else {
                            TokenData::Identifier(self.scan_identifier()?)
                        };
                    } else if c == b'f' {
                        self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                        break 'next if self.scan_keyword(b"false") {
                            TokenData::Boolean(false)
                        } else {
                            TokenData::Identifier(self.scan_identifier()?)
                        };
                    } else if c == b'n' {
                        self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                        break 'next if self.scan_keyword(b"null") {
                            TokenData::Null
                        } else {
                            TokenData::Identifier(self.scan_identifier()?)
                        };
                    } else if (c >= b'a' && c <= b'z') || (c >= b'A' && c <= b'Z') || c == b'_' || c == b'$' || c == b'\\' {
                        self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                        break 'next TokenData::Identifier(self.scan_identifier()?);
                    } else if c >= 0x80 {
                        // Multi-byte: check whitespace first, then identifier
                        let mb = self.multi_byte_whitespace();
                        if mb > 0 {
                            self.pos += usize::from(mb);
                            continue 'next;
                        }
                        self.token.loc = Loc { start: i32::try_from(self.pos).unwrap() };
                        let Some(cp) = self.read_codepoint() else {
                            return Err(ParseError::UnexpectedCharacter);
                        };
                        if identifier::is_identifier_start(cp.cp) {
                            break 'next TokenData::Identifier(self.scan_identifier()?);
                        } else {
                            return Err(ParseError::UnexpectedCharacter);
                        }
                    } else {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                }
            }
        };
        Ok(())
    }

    fn scan_keyword(&mut self, keyword: &'static [u8]) -> bool {
        if self.pos + keyword.len() > self.source.len() {
            return false;
        }
        if &self.source[self.pos..][..keyword.len()] != keyword {
            return false;
        }
        // Check word boundary
        if self.pos + keyword.len() < self.source.len() {
            let next = self.source[self.pos + keyword.len()];
            if is_ident_continue_ascii(next) || next == b'\\' || next >= 0x80 {
                return false;
            }
        }
        self.pos += keyword.len();
        true
    }

    fn scan_signed_value(&mut self, is_negative: bool) -> Result<f64, ParseError> {
        match self.peek() {
            b'0'..=b'9' | b'.' => {
                let n = self.scan_number()?;
                Ok(if is_negative { -n } else { n })
            }
            b'I' => {
                if self.scan_keyword(b"Infinity") {
                    return Ok(if is_negative { f64::NEG_INFINITY } else { f64::INFINITY });
                }
                Err(ParseError::UnexpectedCharacter)
            }
            b'N' => {
                if self.scan_keyword(b"NaN") {
                    let nan = f64::NAN;
                    return Ok(if is_negative { -nan } else { nan });
                }
                Err(ParseError::UnexpectedCharacter)
            }
            0 => Err(ParseError::UnexpectedEof),
            _ => Err(ParseError::UnexpectedCharacter),
        }
    }

    // ── Parser ──

    fn parse_root(&mut self) -> Result<Expr, ParseError> {
        self.scan()?;
        let result = self.parse_value()?;
        if !matches!(self.token.data, TokenData::Eof) {
            return Err(ParseError::TrailingData);
        }
        Ok(result)
    }

    fn parse_value(&mut self) -> Result<Expr, ParseError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(ParseError::StackOverflow);
        }

        let loc = self.token.loc;

        match self.token.data {
            TokenData::LeftBrace => self.parse_object(),
            TokenData::LeftBracket => self.parse_array(),
            TokenData::String(s) => {
                self.scan()?;
                Ok(Expr::init(E::String::init(s), loc))
            }
            TokenData::Number(n) => {
                self.scan()?;
                Ok(Expr::init(E::Number { value: n }, loc))
            }
            TokenData::Boolean(b) => {
                self.scan()?;
                Ok(Expr::init(E::Boolean { value: b }, loc))
            }
            TokenData::Null => {
                self.scan()?;
                Ok(Expr::init(E::Null {}, loc))
            }
            TokenData::Identifier(s) => {
                if s == b"NaN" {
                    self.scan()?;
                    return Ok(Expr::init(E::Number { value: f64::NAN }, loc));
                } else if s == b"Infinity" {
                    self.scan()?;
                    return Ok(Expr::init(E::Number { value: f64::INFINITY }, loc));
                }
                Err(ParseError::UnexpectedToken)
            }
            TokenData::Eof => Err(ParseError::UnexpectedEof),
            _ => Err(ParseError::UnexpectedToken),
        }
    }

    fn parse_object(&mut self) -> Result<Expr, ParseError> {
        let loc = self.token.loc;
        self.scan()?; // advance past '{'

        let mut properties: BumpVec<'a, G::Property> = BumpVec::new_in(self.bump);

        while !matches!(self.token.data, TokenData::RightBrace) {
            let key = self.parse_object_key()?;

            if !matches!(self.token.data, TokenData::Colon) {
                return Err(ParseError::ExpectedColon);
            }
            self.scan()?; // advance past ':'

            let value = self.parse_value()?;

            properties.push(G::Property {
                key: Some(key),
                value: Some(value),
                ..Default::default()
            });

            match self.token.data {
                TokenData::Comma => self.scan()?,
                TokenData::RightBrace => {}
                TokenData::Eof => return Err(ParseError::UnterminatedObject),
                _ => {
                    return if self.token.data.can_start_value() {
                        Err(ParseError::ExpectedComma)
                    } else {
                        Err(ParseError::ExpectedClosingBrace)
                    };
                }
            }
        }

        self.scan()?; // advance past '}'
        Ok(Expr::init(
            E::Object {
                // TODO(port): G.Property.List.moveFromList — verify exact API on bun_js_parser side
                properties: G::Property::List::move_from_list(&mut properties),
                ..Default::default()
            },
            loc,
        ))
    }

    fn parse_object_key(&mut self) -> Result<Expr, ParseError> {
        let loc = self.token.loc;
        match self.token.data {
            TokenData::String(s) => {
                self.scan()?;
                Ok(Expr::init(E::String::init(s), loc))
            }
            TokenData::Identifier(s) => {
                self.scan()?;
                Ok(Expr::init(E::String::init(s), loc))
            }
            TokenData::Number(_) => Err(ParseError::InvalidIdentifier),
            TokenData::Boolean(b) => {
                self.scan()?;
                Ok(Expr::init(E::Boolean { value: b }, loc))
            }
            TokenData::Null => {
                self.scan()?;
                Ok(Expr::init(E::Null {}, loc))
            }
            TokenData::Eof => Err(ParseError::UnexpectedEof),
            _ => Err(ParseError::InvalidIdentifier),
        }
    }

    fn parse_array(&mut self) -> Result<Expr, ParseError> {
        let loc = self.token.loc;
        self.scan()?; // advance past '['

        let mut items: BumpVec<'a, Expr> = BumpVec::new_in(self.bump);

        while !matches!(self.token.data, TokenData::RightBracket) {
            let value = self.parse_value()?;
            items.push(value);

            match self.token.data {
                TokenData::Comma => self.scan()?,
                TokenData::RightBracket => {}
                TokenData::Eof => return Err(ParseError::UnterminatedArray),
                _ => {
                    return if self.token.data.can_start_value() {
                        Err(ParseError::ExpectedComma)
                    } else {
                        Err(ParseError::ExpectedClosingBracket)
                    };
                }
            }
        }

        self.scan()?; // advance past ']'
        Ok(Expr::init(
            E::Array {
                // TODO(port): ExprNodeList.moveFromList — verify exact API on js_ast side
                // MOVE_DOWN(b0): bun_js_parser::ExprNodeList → bun_logger (T2)
                items: bun_logger::ExprNodeList::move_from_list(&mut items),
                ..Default::default()
            },
            loc,
        ))
    }

    // ── Scan Helpers ──

    fn scan_string(&mut self) -> Result<&'a [u8], ParseError> {
        let quote = self.source[self.pos];
        self.pos += 1; // skip opening quote

        let mut buf: BumpVec<'a, u8> = BumpVec::new_in(self.bump);

        while self.pos < self.source.len() {
            let c = self.source[self.pos];

            if c == quote {
                self.pos += 1;
                return Ok(buf.into_bump_slice());
            }

            if c == b'\\' {
                self.pos += 1;
                self.parse_escape_sequence(&mut buf)?;
                continue;
            }

            // Line terminators are not allowed unescaped in strings
            if c == b'\n' || c == b'\r' {
                return Err(ParseError::UnterminatedString);
            }

            // Check for U+2028/U+2029 (allowed unescaped in JSON5 strings)
            if c == 0xE2
                && self.pos + 2 < self.source.len()
                && self.source[self.pos + 1] == 0x80
                && (self.source[self.pos + 2] == 0xA8 || self.source[self.pos + 2] == 0xA9)
            {
                buf.extend_from_slice(&self.source[self.pos..][..3]);
                self.pos += 3;
                continue;
            }

            // Regular character - handle multi-byte UTF-8
            let cp_len = strings::wtf8_byte_sequence_length(c);
            if self.pos + usize::from(cp_len) > self.source.len() {
                buf.push(c);
                self.pos += 1;
            } else {
                buf.extend_from_slice(&self.source[self.pos..][..usize::from(cp_len)]);
                self.pos += usize::from(cp_len);
            }
        }

        Err(ParseError::UnterminatedString)
    }

    fn parse_escape_sequence(&mut self, buf: &mut BumpVec<'a, u8>) -> Result<(), ParseError> {
        if self.pos >= self.source.len() {
            return Err(ParseError::UnterminatedEscape);
        }

        let c = self.source[self.pos];
        self.pos += 1;

        match c {
            b'\'' => buf.push(b'\''),
            b'"' => buf.push(b'"'),
            b'\\' => buf.push(b'\\'),
            b'b' => buf.push(0x08),
            b'f' => buf.push(0x0C),
            b'n' => buf.push(b'\n'),
            b'r' => buf.push(b'\r'),
            b't' => buf.push(b'\t'),
            b'v' => buf.push(0x0B),
            b'0' => {
                // \0 null escape - must NOT be followed by a digit
                if self.pos < self.source.len() {
                    let next = self.source[self.pos];
                    if next >= b'0' && next <= b'9' {
                        return Err(ParseError::OctalEscape);
                    }
                }
                buf.push(0);
            }
            b'x' => {
                // \xHH hex escape
                let Some(hi) = self.read_hex_digit() else {
                    return Err(ParseError::InvalidHexEscape);
                };
                let Some(lo) = self.read_hex_digit() else {
                    return Err(ParseError::InvalidHexEscape);
                };
                let value: u8 = (hi << 4) | lo;
                append_codepoint_to_utf8(buf, i32::from(value))?;
            }
            b'u' => {
                // \uHHHH unicode escape
                let cp = self.read_hex4()?;
                // Check for surrogate pair
                if cp >= 0xD800 && cp <= 0xDBFF {
                    // High surrogate - expect \uDCxx low surrogate
                    if self.pos + 1 < self.source.len()
                        && self.source[self.pos] == b'\\'
                        && self.source[self.pos + 1] == b'u'
                    {
                        self.pos += 2;
                        let low = self.read_hex4()?;
                        if low >= 0xDC00 && low <= 0xDFFF {
                            let full_cp: i32 = 0x10000 + (cp - 0xD800) * 0x400 + (low - 0xDC00);
                            append_codepoint_to_utf8(buf, full_cp)?;
                        } else {
                            // Invalid low surrogate - just encode both independently
                            append_codepoint_to_utf8(buf, cp)?;
                            append_codepoint_to_utf8(buf, low)?;
                        }
                    } else {
                        append_codepoint_to_utf8(buf, cp)?;
                    }
                } else {
                    append_codepoint_to_utf8(buf, cp)?;
                }
            }
            b'\r' => {
                // Line continuation: \CR or \CRLF
                if self.pos < self.source.len() && self.source[self.pos] == b'\n' {
                    self.pos += 1;
                }
            }
            b'\n' => {
                // Line continuation: \LF
            }
            b'1'..=b'9' => {
                return Err(ParseError::OctalEscape);
            }
            0xE2 => {
                // Check for U+2028/U+2029 line continuation
                if self.pos + 1 < self.source.len()
                    && self.source[self.pos] == 0x80
                    && (self.source[self.pos + 1] == 0xA8 || self.source[self.pos + 1] == 0xA9)
                {
                    // Line continuation with U+2028 or U+2029
                    self.pos += 2;
                } else {
                    // Identity escape for the byte 0xE2
                    buf.push(0xE2);
                }
            }
            _ => {
                // Identity escape
                buf.push(c);
            }
        }
        Ok(())
    }

    fn scan_number(&mut self) -> Result<f64, ParseError> {
        let start = self.pos;

        // Leading zero: check for hex prefix or invalid leading zeros
        if self.peek() == b'0' && self.pos + 1 < self.source.len() {
            match self.source[self.pos + 1] {
                b'x' | b'X' => return self.scan_hex_number(),
                b'0'..=b'9' => return Err(ParseError::LeadingZeros),
                _ => {}
            }
        }

        // Integer part
        let mut has_digits = false;
        while self.pos < self.source.len() {
            match self.source[self.pos] {
                b'0'..=b'9' => {
                    self.pos += 1;
                    has_digits = true;
                }
                _ => break,
            }
        }

        // Fractional part
        if self.peek() == b'.' {
            self.pos += 1;
            let mut has_frac_digits = false;
            while self.pos < self.source.len() {
                match self.source[self.pos] {
                    b'0'..=b'9' => {
                        self.pos += 1;
                        has_frac_digits = true;
                    }
                    _ => break,
                }
            }
            if !has_digits && !has_frac_digits {
                return Err(ParseError::InvalidNumber);
            }
            has_digits = true;
        }

        if !has_digits {
            return Err(ParseError::InvalidNumber);
        }

        // Exponent part
        match self.peek() {
            b'e' | b'E' => {
                self.pos += 1;
                match self.peek() {
                    b'+' | b'-' => self.pos += 1,
                    _ => {}
                }
                match self.peek() {
                    b'0'..=b'9' => self.pos += 1,
                    _ => return Err(ParseError::InvalidNumber),
                }
                while self.pos < self.source.len() {
                    match self.source[self.pos] {
                        b'0'..=b'9' => self.pos += 1,
                        _ => break,
                    }
                }
            }
            _ => {}
        }

        let num_str = &self.source[start..self.pos];
        // SAFETY: scanner above only advanced past ASCII bytes [0-9.eE+-], so num_str is valid UTF-8.
        let s = unsafe { core::str::from_utf8_unchecked(num_str) };
        s.parse::<f64>().map_err(|_| ParseError::InvalidNumber)
    }

    fn scan_hex_number(&mut self) -> Result<f64, ParseError> {
        self.pos += 2; // skip '0x' or '0X'
        let hex_start = self.pos;

        while self.pos < self.source.len() {
            match self.source[self.pos] {
                b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' => self.pos += 1,
                _ => break,
            }
        }

        if self.pos == hex_start {
            return Err(ParseError::InvalidHexNumber);
        }

        let hex_str = &self.source[hex_start..self.pos];
        // SAFETY: only ASCII hex digits per loop above.
        let s = unsafe { core::str::from_utf8_unchecked(hex_str) };
        let value = u64::from_str_radix(s, 16).map_err(|_| ParseError::InvalidHexNumber)?;
        Ok(value as f64)
    }

    fn scan_identifier(&mut self) -> Result<&'a [u8], ParseError> {
        let mut buf: BumpVec<'a, u8> = BumpVec::new_in(self.bump);

        // First character must be IdentifierStart
        let Some(start_cp) = self.read_codepoint() else {
            return Err(ParseError::InvalidIdentifier);
        };

        if start_cp.cp == i32::from(b'\\') {
            // Unicode escape in identifier
            let escaped_cp = self.parse_identifier_unicode_escape()?;
            if !identifier::is_identifier_start(escaped_cp) {
                return Err(ParseError::InvalidIdentifier);
            }
            append_codepoint_to_utf8(&mut buf, escaped_cp)?;
        } else if identifier::is_identifier_start(start_cp.cp) {
            self.pos += usize::from(start_cp.len);
            append_codepoint_to_utf8(&mut buf, start_cp.cp)?;
        } else {
            return Err(ParseError::InvalidIdentifier);
        }

        // Continue characters
        while self.pos < self.source.len() {
            let Some(cont_cp) = self.read_codepoint() else { break };

            if cont_cp.cp == i32::from(b'\\') {
                let escaped_cp = self.parse_identifier_unicode_escape()?;
                if !identifier::is_identifier_part(escaped_cp) {
                    break;
                }
                append_codepoint_to_utf8(&mut buf, escaped_cp)?;
            } else if identifier::is_identifier_part(cont_cp.cp) {
                self.pos += usize::from(cont_cp.len);
                append_codepoint_to_utf8(&mut buf, cont_cp.cp)?;
            } else {
                break;
            }
        }

        Ok(buf.into_bump_slice())
    }

    fn parse_identifier_unicode_escape(&mut self) -> Result<i32, ParseError> {
        // We already consumed the '\', now expect 'u' + 4 hex digits
        self.pos += 1; // skip '\'
        if self.pos >= self.source.len() || self.source[self.pos] != b'u' {
            return Err(ParseError::InvalidUnicodeEscape);
        }
        self.pos += 1;
        self.read_hex4()
    }

    // ── Comment Helpers ──

    fn skip_to_end_of_line(&mut self) {
        while self.pos < self.source.len() {
            let cc = self.source[self.pos];
            if cc == b'\n' || cc == b'\r' {
                break;
            }
            // Check for U+2028/U+2029 line terminators
            if cc == 0xE2
                && self.pos + 2 < self.source.len()
                && self.source[self.pos + 1] == 0x80
                && (self.source[self.pos + 2] == 0xA8 || self.source[self.pos + 2] == 0xA9)
            {
                break;
            }
            self.pos += 1;
        }
    }

    fn skip_block_comment(&mut self) -> Result<(), ParseError> {
        while self.pos < self.source.len() {
            if self.source[self.pos] == b'*'
                && self.pos + 1 < self.source.len()
                && self.source[self.pos + 1] == b'/'
            {
                self.pos += 2;
                return Ok(());
            }
            self.pos += 1;
        }
        Err(ParseError::UnterminatedComment)
    }

    /// Check if the current position has a multi-byte whitespace character.
    /// Returns the number of bytes consumed, or 0 if not whitespace.
    fn multi_byte_whitespace(&self) -> u8 {
        if self.pos + 1 >= self.source.len() {
            return 0;
        }
        let b0 = self.source[self.pos];
        let b1 = self.source[self.pos + 1];

        // U+00A0 NBSP: C2 A0
        if b0 == 0xC2 && b1 == 0xA0 {
            return 2;
        }

        if self.pos + 2 >= self.source.len() {
            return 0;
        }
        let b2 = self.source[self.pos + 2];

        // U+FEFF BOM: EF BB BF
        if b0 == 0xEF && b1 == 0xBB && b2 == 0xBF {
            return 3;
        }

        // U+2028 LS: E2 80 A8
        // U+2029 PS: E2 80 A9
        if b0 == 0xE2 && b1 == 0x80 && (b2 == 0xA8 || b2 == 0xA9) {
            return 3;
        }

        // U+1680: E1 9A 80
        if b0 == 0xE1 && b1 == 0x9A && b2 == 0x80 {
            return 3;
        }

        // U+2000-U+200A: E2 80 80-8A
        if b0 == 0xE2 && b1 == 0x80 && b2 >= 0x80 && b2 <= 0x8A {
            return 3;
        }

        // U+202F: E2 80 AF
        if b0 == 0xE2 && b1 == 0x80 && b2 == 0xAF {
            return 3;
        }

        // U+205F: E2 81 9F
        if b0 == 0xE2 && b1 == 0x81 && b2 == 0x9F {
            return 3;
        }

        // U+3000: E3 80 80
        if b0 == 0xE3 && b1 == 0x80 && b2 == 0x80 {
            return 3;
        }

        0
    }

    // ── Helper Functions ──

    fn read_hex_digit(&mut self) -> Option<u8> {
        if self.pos >= self.source.len() {
            return None;
        }
        let c = self.source[self.pos];
        let result: u8 = match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            b'A'..=b'F' => c - b'A' + 10,
            _ => return None,
        };
        self.pos += 1;
        Some(result)
    }

    fn read_hex4(&mut self) -> Result<i32, ParseError> {
        let mut value: i32 = 0;
        // PERF(port): was `inline while` (comptime unrolled) — profile in Phase B
        for _ in 0..4 {
            let Some(digit) = self.read_hex_digit() else {
                return Err(ParseError::InvalidUnicodeEscape);
            };
            value = (value << 4) | i32::from(digit);
        }
        Ok(value)
    }

    fn read_codepoint(&self) -> Option<Codepoint> {
        if self.pos >= self.source.len() {
            return None;
        }
        let first = self.source[self.pos];
        if first < 0x80 {
            return Some(Codepoint { cp: i32::from(first), len: 1 });
        }
        let seq_len = strings::wtf8_byte_sequence_length(first);
        if self.pos + usize::from(seq_len) > self.source.len() {
            return Some(Codepoint { cp: i32::from(first), len: 1 });
        }
        // SAFETY: Zig reinterprets the slice ptr as *const [4]u8; we have at least
        // seq_len (≤4) valid bytes at self.pos. decode_wtf8_rune_t reads at most seq_len bytes.
        // TODO(port): verify decode_wtf8_rune_t signature — Zig passes ptr[0..4] which may
        // read past end-of-buffer when seq_len < 4 and remaining < 4; preserve that contract.
        let decoded = unsafe {
            strings::decode_wtf8_rune_t(
                &*(self.source.as_ptr().add(self.pos) as *const [u8; 4]),
                seq_len,
                -1i32,
            )
        };
        if decoded < 0 {
            return Some(Codepoint { cp: i32::from(first), len: 1 });
        }
        Some(Codepoint { cp: decoded, len: seq_len })
    }
}

#[derive(Copy, Clone)]
struct Codepoint {
    cp: i32,
    len: u8,
}

fn append_codepoint_to_utf8(buf: &mut BumpVec<'_, u8>, cp: i32) -> Result<(), ParseError> {
    if cp < 0 || cp > 0x10FFFF {
        return Err(ParseError::InvalidUnicodeEscape);
    }
    let mut encoded = [0u8; 4];
    let len = strings::encode_wtf8_rune(&mut encoded, cp);
    buf.extend_from_slice(&encoded[..usize::from(len)]);
    Ok(())
}

fn is_ident_continue_ascii(c: u8) -> bool {
    matches!(c, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$')
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/json5.zig (913 lines)
//   confidence: medium
//   todos:      3
//   notes:      arena-backed (interchange = AST crate); Expr::init / E::* / move_from_list signatures need Phase-B alignment with bun_js_parser; labeled-switch scanner mapped to `loop { break 'next ... }`.
// ──────────────────────────────────────────────────────────────────────────
