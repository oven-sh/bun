#![allow(dead_code)] // until every rule of the plugin is written
//! `doctrine.parse(comment, { unwrap: true })` of doctrine 2.1.0 (https://github.com/eslint/doctrine, Copyright JS Foundation
//! and other contributors, Apache License 2.0), for `@deprecated` and `@module`. It stops at the first tag that it cannot
//! parse, so each is read as it reads it, and `typed.js`, its parser of types, is here as a recognizer.

use bun_core::lexer::{self, char_and_size, end_of_run};
use bun_core::strings;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::sync::Arc;

/// What is read of the tags.
pub(crate) struct Parsed {
    /// The first whose title is `deprecated`: its description.
    pub(crate) deprecated: Option<Option<Arc<[u8]>>>,
    /// The title of one is `module`.
    pub(crate) has_module: bool,
}

// ───────────────────────────── esutils.code ─────────────────────────────

/// ES5 goes by general categories, and by units of UTF-16. As `text::is_identifier_es5`.
fn is_identifier_start_es5(c: i32) -> bool {
    (0..=0xFFFF).contains(&c)
        && lexer::is_identifier_start(c as u32)
        && !matches!(c, 0x1885 | 0x1886 | 0x2118 | 0x212E | 0x309B | 0x309C)
}

fn is_identifier_part_es5(c: i32) -> bool {
    let is_other = matches!(
        c,
        0xB7 | 0x387 | 0x1369..=0x1371 | 0x19DA | 0x2118 | 0x212E | 0x309B | 0x309C
    );
    matches!(c, 0x200C | 0x200D)
        || (0..=0xFFFF).contains(&c) && lexer::is_identifier_part(c as u32) && !is_other
}

fn is_octal_digit(c: u8) -> bool {
    matches!(c, b'0'..=b'7')
}

// ───────────────────────────── typed.js ─────────────────────────────

/// `utility.throwError`
struct Unexpected;

/// How deep a type may be nested. Upstream catches the `RangeError` of a stack that is used up.
const MAX_DEPTH: u32 = 200;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Token {
    Illegal,
    DotLt,
    Rest,
    Lt,
    Gt,
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBrack,
    RBrack,
    Comma,
    Colon,
    Star,
    Pipe,
    Question,
    Bang,
    Equal,
    Name,
    String,
    Number,
    Eof,
}

/// `type` of the node that a type is, as far as it is asked for.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Syntax {
    NameExpression,
    UnionType,
    Other,
}

struct Typed<'s> {
    source: &'s [u8],
    index: usize,
    token: Token,
    /// Of a `Token::Name`.
    value: &'s [u8],
    depth: u32,
}

fn is_type_name(c: i32) -> bool {
    !matches!(
        u8::try_from(c),
        Ok(b'>'
            | b'<'
            | b'('
            | b')'
            | b'{'
            | b'}'
            | b'['
            | b']'
            | b','
            | b':'
            | b'*'
            | b'|'
            | b'?'
            | b'!'
            | b'=')
    ) && !lexer::is_whitespace(c)
        && !strings::is_js_line_terminator(c as u32)
}

impl<'s> Typed<'s> {
    fn byte(&self, at: usize) -> Option<u8> {
        self.source.get(at).copied()
    }

    /// Only where it ends counts: an escape is a `\` and one character.
    fn scan_string(&mut self, quote: u8) -> Result<Token, Unexpected> {
        self.index += 1;
        while self.index < self.source.len() {
            let (ch, size) = char_and_size(self.source, self.index);
            self.index += size;
            if ch == i32::from(quote) {
                return Ok(Token::String);
            }
            if ch == i32::from(b'\\') {
                let (escaped, size) = char_and_size(self.source, self.index);
                self.index += size;
                if escaped == i32::from(b'\r') && self.byte(self.index) == Some(b'\n') {
                    self.index += 1;
                }
            } else if strings::is_js_line_terminator(ch as u32) {
                break;
            }
        }
        Err(Unexpected)
    }

    fn starts_identifier(&self, at: usize) -> bool {
        is_identifier_start_es5(char_and_size(self.source, at).0)
    }

    /// Past the digits. The last byte that was looked at, which is upstream's `ch`.
    fn skip_digits(&mut self, is: fn(u8) -> bool) -> Option<u8> {
        let mut ch = None;
        while let Some(byte) = self.byte(self.index) {
            ch = Some(byte);
            if !is(byte) {
                break;
            }
            self.index += 1;
        }
        ch
    }

    fn is_at_decimal_digit(&self) -> bool {
        self.byte(self.index).is_some_and(|it| it.is_ascii_digit())
    }

    fn scan_number(&mut self) -> Result<Token, Unexpected> {
        let is_decimal_digit = |it: u8| it.is_ascii_digit();
        let mut ch = self.byte(self.index);
        if ch != Some(b'.') {
            let first = ch;
            self.index += 1;
            ch = self.byte(self.index);
            if first == Some(b'0') {
                if matches!(ch, Some(b'x' | b'X')) {
                    self.index += 1;
                    let digits = self.index;
                    self.skip_digits(|it| it.is_ascii_hexdigit());
                    let is_number = self.index > digits && !self.starts_identifier(self.index);
                    return is_number.then_some(Token::Number).ok_or(Unexpected);
                }
                if ch.is_some_and(is_octal_digit) {
                    self.skip_digits(is_octal_digit);
                    let is_number =
                        !self.starts_identifier(self.index) && !self.is_at_decimal_digit();
                    return is_number.then_some(Token::Number).ok_or(Unexpected);
                }
                if ch.is_some_and(is_decimal_digit) {
                    return Err(Unexpected);
                }
            }
            ch = self.skip_digits(is_decimal_digit).or(ch);
        }
        if ch == Some(b'.') {
            self.index += 1;
            ch = self.skip_digits(is_decimal_digit).or(ch);
        }
        if matches!(ch, Some(b'e' | b'E')) {
            self.index += 1;
            if matches!(self.byte(self.index), Some(b'+' | b'-')) {
                self.index += 1;
            }
            if !self.is_at_decimal_digit() {
                return Err(Unexpected);
            }
            self.skip_digits(is_decimal_digit);
        }
        match self.starts_identifier(self.index) {
            true => Err(Unexpected),
            false => Ok(Token::Number),
        }
    }

    fn scan_type_name(&mut self) -> Token {
        let start = self.index;
        self.index += char_and_size(self.source, self.index).1;
        loop {
            let (ch, size) = char_and_size(self.source, self.index);
            if size == 0 || !is_type_name(ch) {
                break;
            }
            if ch == i32::from(b'.') {
                match self.byte(self.index + 1) {
                    None => return Token::Illegal,
                    Some(b'<') => break,
                    Some(_) => {}
                }
            }
            self.index += size;
        }
        self.value = &self.source[start..self.index];
        Token::Name
    }

    fn next(&mut self) -> Result<(), Unexpected> {
        self.index = end_of_run(self.source, self.index, lexer::is_whitespace);
        self.token = self.scan_token()?;
        Ok(())
    }

    fn scan_token(&mut self) -> Result<Token, Unexpected> {
        let Some(ch) = self.byte(self.index) else {
            return Ok(Token::Eof);
        };
        let token = match ch {
            b'\'' | b'"' => return self.scan_string(ch),
            b':' => Token::Colon,
            b',' => Token::Comma,
            b'(' => Token::LParen,
            b')' => Token::RParen,
            b'[' => Token::LBrack,
            b']' => Token::RBrack,
            b'{' => Token::LBrace,
            b'}' => Token::RBrace,
            b'.' => {
                let (token, len) = match (self.byte(self.index + 1), self.byte(self.index + 2)) {
                    (Some(b'<'), _) => (Token::DotLt, 2),
                    (Some(b'.'), Some(b'.')) => (Token::Rest, 3),
                    (Some(b'0'..=b'9'), _) => return self.scan_number(),
                    _ => (Token::Illegal, 0),
                };
                self.index += len;
                return Ok(token);
            }
            b'<' => Token::Lt,
            b'>' => Token::Gt,
            b'*' => Token::Star,
            b'|' => Token::Pipe,
            b'?' => Token::Question,
            b'!' => Token::Bang,
            b'=' => Token::Equal,
            b'-' | b'0'..=b'9' => return self.scan_number(),
            _ => return Ok(self.scan_type_name()),
        };
        self.index += 1;
        Ok(token)
    }

    fn expect(&mut self, target: Token) -> Result<(), Unexpected> {
        match self.token == target {
            true => self.next(),
            false => Err(Unexpected),
        }
    }

    fn parse_union_type(&mut self) -> Result<Syntax, Unexpected> {
        self.next()?;
        if self.token != Token::RParen {
            loop {
                self.parse_type_expression()?;
                if self.token == Token::RParen {
                    break;
                }
                self.expect(Token::Pipe)?;
            }
        }
        self.next()?;
        Ok(Syntax::UnionType)
    }

    fn parse_array_type(&mut self) -> Result<Syntax, Unexpected> {
        self.next()?;
        while self.token != Token::RBrack {
            if self.token == Token::Rest {
                self.next()?;
                self.parse_type_expression()?;
                break;
            }
            self.parse_type_expression()?;
            if self.token != Token::RBrack {
                self.expect(Token::Comma)?;
            }
        }
        self.expect(Token::RBrack)?;
        Ok(Syntax::Other)
    }

    /// With `parseFieldName`.
    fn parse_field_type(&mut self) -> Result<(), Unexpected> {
        if !matches!(self.token, Token::Name | Token::String | Token::Number) {
            return Err(Unexpected);
        }
        self.next()?;
        if self.token == Token::Colon {
            self.next()?;
            self.parse_type_expression()?;
        }
        Ok(())
    }

    fn parse_record_type(&mut self) -> Result<Syntax, Unexpected> {
        self.next()?;
        if self.token == Token::Comma {
            self.next()?;
        } else {
            while self.token != Token::RBrace {
                self.parse_field_type()?;
                if self.token != Token::RBrace {
                    self.expect(Token::Comma)?;
                }
            }
        }
        self.expect(Token::RBrace)?;
        Ok(Syntax::Other)
    }

    fn parse_name_expression(&mut self) -> Result<(), Unexpected> {
        let name = self.value;
        self.expect(Token::Name)?;
        if self.token == Token::Colon && matches!(name, b"module" | b"external" | b"event") {
            self.next()?;
            self.expect(Token::Name)?;
        }
        Ok(())
    }

    fn parse_type_expression_list(&mut self) -> Result<(), Unexpected> {
        self.parse_top()?;
        while self.token == Token::Comma {
            self.next()?;
            self.parse_top()?;
        }
        Ok(())
    }

    fn parse_type_name(&mut self) -> Result<Syntax, Unexpected> {
        self.parse_name_expression()?;
        if !matches!(self.token, Token::DotLt | Token::Lt) {
            return Ok(Syntax::NameExpression);
        }
        self.next()?;
        self.parse_type_expression_list()?;
        self.expect(Token::Gt)?;
        Ok(Syntax::Other)
    }

    fn parse_result_type(&mut self) -> Result<(), Unexpected> {
        self.next()?;
        if self.token == Token::Name && self.value == b"void" {
            return self.next();
        }
        self.parse_type_expression()?;
        Ok(())
    }

    fn parse_parameters_type(&mut self) -> Result<(), Unexpected> {
        let mut optional_sequence = false;
        while self.token != Token::RParen {
            if self.token == Token::Rest {
                self.next()?;
            }
            let expr = self.parse_type_expression()?;
            if expr == Syntax::NameExpression && self.token == Token::Colon {
                self.next()?;
                self.parse_type_expression()?;
            }
            if self.token == Token::Equal {
                self.next()?;
                optional_sequence = true;
            } else if optional_sequence {
                return Err(Unexpected);
            }
            if self.token != Token::RParen {
                self.expect(Token::Comma)?;
            }
        }
        Ok(())
    }

    fn parse_function_type(&mut self) -> Result<(), Unexpected> {
        self.next()?;
        self.expect(Token::LParen)?;
        if self.token == Token::Name && matches!(self.value, b"this" | b"new") {
            self.next()?;
            self.expect(Token::Colon)?;
            self.parse_type_name()?;
            if self.token == Token::Comma {
                self.next()?;
                self.parse_parameters_type()?;
            }
        } else {
            self.parse_parameters_type()?;
        }
        self.expect(Token::RParen)?;
        if self.token == Token::Colon {
            self.parse_result_type()?;
        }
        Ok(())
    }

    fn parse_basic_type_expression(&mut self) -> Result<Syntax, Unexpected> {
        match self.token {
            Token::LParen => self.parse_union_type(),
            Token::LBrack => self.parse_array_type(),
            Token::LBrace => self.parse_record_type(),
            Token::Name if !matches!(self.value, b"null" | b"undefined" | b"true" | b"false") => {
                if self.value == b"function" {
                    let context = (self.index, self.token, self.value, self.depth);
                    if self.parse_function_type().is_ok() {
                        return Ok(Syntax::Other);
                    }
                    (self.index, self.token, self.value, self.depth) = context;
                }
                self.parse_type_name()
            }
            Token::Star | Token::Name | Token::String | Token::Number => {
                self.next()?;
                Ok(Syntax::Other)
            }
            _ => Err(Unexpected),
        }
    }

    fn parse_type_expression(&mut self) -> Result<Syntax, Unexpected> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(Unexpected);
        }
        let expr = self.parse_type_expression_at_depth()?;
        self.depth -= 1;
        Ok(expr)
    }

    fn parse_type_expression_at_depth(&mut self) -> Result<Syntax, Unexpected> {
        use Token::{Bang, Comma, Eof, Equal, Gt, LBrack, Pipe, Question, RBrace, RBrack, RParen};
        if matches!(self.token, Question | Bang) {
            let is_question = self.token == Question;
            self.next()?;
            let ends = matches!(
                self.token,
                Comma | Equal | RBrace | RParen | Pipe | Eof | RBrack | Gt
            );
            if !(is_question && ends) {
                self.parse_basic_type_expression()?;
            }
            return Ok(Syntax::Other);
        }
        let expr = self.parse_basic_type_expression()?;
        match self.token {
            Bang | Question => self.next()?,
            LBrack => {
                self.next()?;
                self.expect(RBrack)?;
            }
            _ => return Ok(expr),
        }
        Ok(Syntax::Other)
    }

    fn parse_top(&mut self) -> Result<Syntax, Unexpected> {
        let expr = self.parse_type_expression()?;
        if self.token != Token::Pipe {
            return Ok(expr);
        }
        while self.token == Token::Pipe {
            self.next()?;
            self.parse_type_expression()?;
        }
        Ok(Syntax::UnionType)
    }

    fn parse_top_param_type(&mut self) -> Result<Syntax, Unexpected> {
        if self.token == Token::Rest {
            self.next()?;
            self.parse_top()?;
            return Ok(Syntax::Other);
        }
        let expr = self.parse_top()?;
        if self.token == Token::Equal {
            self.next()?;
            return Ok(Syntax::Other);
        }
        Ok(expr)
    }

    /// `typed.parseType`, and with `is_param` `typed.parseParamType`.
    fn parse(source: &'s [u8], is_param: bool) -> Result<Syntax, Unexpected> {
        let mut typed = Typed {
            source,
            index: 0,
            token: Token::Eof,
            value: b"",
            depth: 0,
        };
        typed.next()?;
        let expr = match is_param {
            true => typed.parse_top_param_type()?,
            false => typed.parse_top()?,
        };
        match typed.token {
            Token::Eof => Ok(expr),
            _ => Err(Unexpected),
        }
    }
}

// ───────────────────────────── doctrine.js ─────────────────────────────

/// A `TypeError` that leaves `doctrine.parse`.
struct Thrown;

fn is_param_title(title: &[u8]) -> bool {
    matches!(title, b"param" | b"argument" | b"arg")
}

fn is_return_title(title: &[u8]) -> bool {
    matches!(title, b"return" | b"returns")
}

/// `isAllowedNested`, `isAllowedOptional`
fn is_allowed_nested(title: &[u8]) -> bool {
    matches!(title, b"property" | b"prop") || is_param_title(title)
}

fn is_name_parameter_required(title: &[u8]) -> bool {
    is_allowed_nested(title) || matches!(title, b"alias" | b"this" | b"mixes" | b"requires")
}

fn is_allowed_name(title: &[u8]) -> bool {
    is_name_parameter_required(title) || matches!(title, b"const" | b"constant")
}

fn is_type_parameter_required(title: &[u8]) -> bool {
    is_allowed_nested(title)
        || is_return_title(title)
        || matches!(
            title,
            b"define" | b"enum" | b"implements" | b"this" | b"type" | b"typedef"
        )
}

/// `isAllowedType`, of a title that does not require one.
fn is_allowed_type(title: &[u8]) -> bool {
    matches!(
        title,
        b"throws"
            | b"const"
            | b"constant"
            | b"namespace"
            | b"member"
            | b"var"
            | b"module"
            | b"constructor"
            | b"class"
            | b"extends"
            | b"augments"
            | b"public"
            | b"private"
            | b"protected"
    )
}

/// `WHITESPACE`
fn is_whitespace_of_star_matcher(c: i32) -> bool {
    lexer::is_whitespace(c) || c == 0x180E
}

fn unwrap_comment(doc: &[u8]) -> Vec<u8> {
    let doc = match doc {
        [b'/', b'*', b'*', rest @ ..] | [b'/', b'*', rest @ ..] => rest,
        _ => doc,
    };
    let doc = doc.strip_suffix(b"*/").unwrap_or(doc);
    let mut unwrapped = Vec::with_capacity(doc.len());
    let mut at = 0;
    while at < doc.len() {
        // `(WHITESPACE*(?:\*WHITESPACE?)?)`
        let star = end_of_run(doc, at, is_whitespace_of_star_matcher);
        let mut start = star;
        if doc.get(star) == Some(&b'*') {
            let (c, size) = char_and_size(doc, star + 1);
            start = star + 1 + usize::from(is_whitespace_of_star_matcher(c)) * size;
        }
        // `.+` wants a character: the expression gives back the last that it has taken.
        if start == doc.len() {
            start = match start - star {
                0 => at + lexer::last_char(&doc[at..]).1,
                1 => star,
                _ => star + 1,
            };
        }
        // The rest of the line, or a line terminator.
        let (c, size) = char_and_size(doc, start);
        let end = match strings::is_js_line_terminator(c as u32) {
            true => start + size,
            false => {
                strings::find_js_line_break(&doc[start..]).map_or(doc.len(), |it| start + it.0)
            }
        };
        unwrapped.extend_from_slice(&doc[start..end]);
        at = end;
    }
    unwrapped.truncate(strings::trim_js_whitespace_end(&unwrapped).len());
    unwrapped
}

/// A method of `TagParser` that `Rules` names.
#[derive(Copy, Clone)]
enum Step {
    Access,
    NamePath,
    NamePathOptional,
    EnsureEnd,
    Type,
    Caption,
    Description,
    Kind,
    This,
    Variation,
    Name,
    Epilogue,
}

/// `Rules`, and the "default sequences".
fn rules(title: &[u8]) -> &'static [Step] {
    match title {
        b"access" => &[Step::Access],
        b"alias" | b"mixes" | b"name" | b"requires" => &[Step::NamePath, Step::EnsureEnd],
        b"augments" | b"constructor" | b"class" | b"extends" | b"member" | b"module" | b"var"
        | b"namespace" => &[Step::Type, Step::NamePathOptional, Step::EnsureEnd],
        b"example" => &[Step::Caption],
        b"deprecated" | b"since" | b"summary" | b"todo" | b"version" => &[Step::Description],
        b"global" | b"inner" | b"instance" | b"readonly" | b"static" => &[Step::EnsureEnd],
        b"kind" => &[Step::Kind],
        b"mixin" | b"method" | b"func" | b"function" => &[Step::NamePathOptional, Step::EnsureEnd],
        b"private" | b"protected" | b"public" => &[Step::Type, Step::Description],
        b"this" => &[Step::This, Step::EnsureEnd],
        b"typedef" => &[Step::Type, Step::NamePathOptional],
        b"variation" => &[Step::Variation],
        _ => &[Step::Type, Step::Name, Step::Description, Step::Epilogue],
    }
}

/// Whether `parseFloat(text)` is a number.
fn is_float(text: &[u8]) -> bool {
    let unsigned = match text {
        [b'+' | b'-', rest @ ..] => rest,
        _ => text,
    };
    unsigned.starts_with(b"Infinity")
        || matches!(unsigned, [b'0'..=b'9', ..] | [b'.', b'0'..=b'9', ..])
}

/// `TagParser`
struct Tag<'s> {
    /// `_title`: in lower case.
    title: SmallVec<[u8; 16]>,
    /// `_last`
    last: usize,
    /// `_tag.type`. `None`: `null` or `undefined`.
    ty: Option<Syntax>,
    /// `_tag.description`. Empty: `null`.
    description: &'s [u8],
}

struct Parser<'s> {
    source: &'s [u8],
    index: usize,
}

impl<'s> Parser<'s> {
    fn char(&self) -> (i32, usize) {
        char_and_size(self.source, self.index)
    }

    fn byte(&self) -> Option<u8> {
        self.source.get(self.index).copied()
    }

    fn scan_title(&mut self) -> &'s [u8] {
        // "waste '@'"
        self.index += 1;
        let start = self.index;
        while self.byte().is_some_and(|it| it.is_ascii_alphanumeric()) {
            self.index += 1;
        }
        &self.source[start..self.index]
    }

    fn seek_content(&self) -> usize {
        let (mut waiting, mut last) = (false, self.index);
        loop {
            let (ch, size) = char_and_size(self.source, last);
            if size == 0 {
                return last;
            }
            let is_before_line_feed =
                ch == i32::from(b'\r') && self.source.get(last + 1) == Some(&b'\n');
            if strings::is_js_line_terminator(ch as u32) && !is_before_line_feed {
                waiting = true;
            } else if waiting {
                if ch == i32::from(b'@') {
                    return last;
                }
                waiting = lexer::is_whitespace(ch);
            }
            last += size;
        }
    }

    /// `None`: "this is direct pattern".
    fn parse_type(&mut self, title: &[u8], last: usize) -> Result<Option<Syntax>, Unexpected> {
        while self.index < last {
            let (ch, size) = self.char();
            self.index += size;
            if ch == i32::from(b'{') {
                break;
            }
            if !lexer::is_whitespace(ch) {
                self.index -= size;
                return Ok(None);
            }
        }
        let (start, mut brace, mut has_line_terminator) = (self.index, 1, false);
        let mut end = start;
        while self.index < last && brace > 0 {
            let (ch, size) = self.char();
            end = self.index;
            self.index += size;
            match u8::try_from(ch) {
                Ok(b'}') => brace -= 1,
                Ok(b'{') => brace += 1,
                _ => has_line_terminator |= strings::is_js_line_terminator(ch as u32),
            }
        }
        if brace != 0 {
            return Err(Unexpected);
        }
        let written = &self.source[start..end];
        let ty = match has_line_terminator {
            true => Cow::Owned(without_line_terminators(written)),
            false => Cow::Borrowed(written),
        };
        Typed::parse(&ty, is_allowed_nested(title)).map(Some)
    }

    /// At the end of the source upstream reads `source[index].match`.
    fn scan_identifier(&mut self, last: usize) -> Result<(), Thrown> {
        let (first, size) = self.char();
        if size == 0 {
            return Err(Thrown);
        }
        if is_identifier_start_es5(first) || matches!(u8::try_from(first), Ok(b'0'..=b'9')) {
            self.index += size;
            while self.index < last {
                let (ch, size) = self.char();
                if !is_identifier_part_es5(ch) {
                    break;
                }
                self.index += size;
            }
        }
        Ok(())
    }

    /// `parseName`: whether there is one. Brackets are for `sloppy`.
    fn parse_name(&mut self, last: usize, allow_nested_params: bool) -> Result<bool, Thrown> {
        // `skipWhiteSpace`
        while self.index < last && strings::is_js_whitespace(self.char().0 as u32) {
            self.index += self.char().1;
        }
        if self.index >= last || self.byte() == Some(b'[') {
            return Ok(false);
        }
        let start = self.index;
        self.scan_identifier(last)?;
        if !allow_nested_params {
            return Ok(true);
        }
        let name = &self.source[start..self.index];
        if self.byte() == Some(b':') && matches!(name, b"module" | b"external" | b"event") {
            self.index += 1;
            self.scan_identifier(last)?;
        }
        if self.source[self.index..].starts_with(b"[]") {
            self.index += 2;
        }
        while matches!(self.byte(), Some(b'.' | b'/' | b'#' | b'-' | b'~')) {
            self.index += 1;
            self.scan_identifier(last)?;
        }
        Ok(true)
    }

    /// `sliceSource(source, index, this._last).trim()`
    fn rest(&self, last: usize) -> &'s [u8] {
        strings::trim_js_whitespace(self.source.get(self.index..last).unwrap_or_default())
    }

    /// `TagParser.prototype.parseType`
    fn parse_tag_type(&mut self, tag: &mut Tag) -> bool {
        if is_type_parameter_required(&tag.title) {
            let Ok(ty) = self.parse_type(&tag.title, tag.last) else {
                return false;
            };
            tag.ty = ty;
            return ty.is_some() || is_param_title(&tag.title) || is_return_title(&tag.title);
        }
        if is_allowed_type(&tag.title) {
            tag.ty = self.parse_type(&tag.title, tag.last).ok().flatten();
        }
        true
    }

    /// `TagParser.prototype.parseName`
    fn parse_tag_name(&mut self, tag: &mut Tag) -> Result<bool, Thrown> {
        if !is_allowed_name(&tag.title)
            || self.parse_name(tag.last, is_allowed_nested(&tag.title))?
            || !is_name_parameter_required(&tag.title)
        {
            return Ok(true);
        }
        // "it's possible the name has already been parsed but interpreted as a type"
        let was_type = is_param_title(&tag.title) && tag.ty == Some(Syntax::NameExpression);
        tag.ty = tag.ty.filter(|_| !was_type);
        Ok(was_type)
    }

    fn parse_description(&self, last: usize) -> &'s [u8] {
        let description = self.rest(last);
        match description {
            [b'-', after @ ..] if strings::js_whitespace_len(after) > 0 => {
                &after[strings::js_whitespace_len(after)..]
            }
            _ => description,
        }
    }

    fn parse_this(&mut self, tag: &mut Tag) -> Result<bool, Thrown> {
        if self.rest(tag.last).first() != Some(&b'{') {
            return self.parse_name(tag.last, true);
        }
        // Upstream goes on to read `type.type` of the `null` that is left.
        if !self.parse_tag_type(tag) {
            return Err(Thrown);
        }
        Ok(matches!(
            tag.ty,
            Some(Syntax::NameExpression | Syntax::UnionType)
        ))
    }

    /// `TagParser.prototype.parse`: whether there is a tag.
    fn parse_tag(&mut self, tag: &mut Tag<'s>) -> Result<bool, Thrown> {
        if tag.title.is_empty() {
            return Ok(false);
        }
        tag.last = self.seek_content();
        for step in rules(&tag.title) {
            let is_right = match step {
                Step::Access => {
                    matches!(self.rest(tag.last), b"private" | b"protected" | b"public")
                }
                Step::NamePath => self.parse_name(tag.last, true)?,
                Step::NamePathOptional => {
                    self.parse_name(tag.last, true)?;
                    true
                }
                Step::EnsureEnd => self.rest(tag.last).is_empty(),
                Step::Type => self.parse_tag_type(tag),
                Step::Caption => true,
                Step::Description => {
                    tag.description = self.parse_description(tag.last);
                    true
                }
                Step::Kind => matches!(
                    self.rest(tag.last),
                    b"class"
                        | b"constant"
                        | b"event"
                        | b"external"
                        | b"file"
                        | b"function"
                        | b"member"
                        | b"mixin"
                        | b"module"
                        | b"namespace"
                        | b"typedef"
                ),
                Step::This => self.parse_this(tag)?,
                Step::Variation => is_float(self.rest(tag.last)),
                Step::Name => self.parse_tag_name(tag)?,
                // Without `sloppy`.
                Step::Epilogue => {
                    !is_allowed_nested(&tag.title)
                        || tag.ty.is_some()
                        || tag.description.first() != Some(&b'[')
                }
            };
            if !is_right {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn scan_jsdoc_description(&mut self) {
        let mut at_allowed = true;
        loop {
            let (ch, size) = self.char();
            if size == 0 || at_allowed && ch == i32::from(b'@') {
                return;
            }
            at_allowed =
                strings::is_js_line_terminator(ch as u32) || at_allowed && lexer::is_whitespace(ch);
            self.index += size;
        }
    }
}

fn without_line_terminators(written: &[u8]) -> Vec<u8> {
    let mut kept = Vec::with_capacity(written.len());
    let mut rest = written;
    while let Some((at, len)) = strings::find_js_line_break(rest) {
        kept.extend_from_slice(&rest[..at]);
        rest = &rest[at + len..];
    }
    kept.extend_from_slice(rest);
    kept
}

/// `comment`: the `value` of a block comment. `None`: it throws.
pub(crate) fn parse(comment: &[u8]) -> Option<Parsed> {
    let source = unwrap_comment(comment);
    let mut parser = Parser {
        source: &source,
        index: 0,
    };
    let mut parsed = Parsed {
        deprecated: None,
        has_module: false,
    };
    parser.scan_jsdoc_description();
    // `parseTag`, after `skipToTag`.
    while let Some(skipped) = strings::index_of_char_usize(&source[parser.index..], b'@') {
        parser.index += skipped;
        let written = parser.scan_title();
        let mut tag = Tag {
            title: written.iter().map(u8::to_ascii_lowercase).collect(),
            last: 0,
            ty: None,
            description: b"",
        };
        if !parser.parse_tag(&mut tag).ok()? {
            break;
        }
        parser.index = parser.index.max(tag.last);
        if written == b"deprecated" && parsed.deprecated.is_none() {
            let description = Some(tag.description).filter(|it| !it.is_empty());
            parsed.deprecated = Some(description.map(Arc::from));
        }
        parsed.has_module |= written == b"module";
    }
    Some(parsed)
}
