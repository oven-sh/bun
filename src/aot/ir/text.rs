use super::body::Body;
use super::ids::{ABSENT_WORD, Id, PropertyKeyId, StringId, TypeId};
use super::program::Program;
use super::text_body::parse_body;
use super::text_lexer::{Lexer, Token, TokenKind, decode_bytes, decode_string};
use super::text_names::{parse_property_key, parse_type};
use super::text_program::parse_lines;

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ParseError {
    pub line: u32,
    pub column: u32,
    pub expected: &'static str,
}

pub type Parsed<T> = Result<T, ParseError>;

pub fn parse_program(text: &str) -> Parsed<Program> {
    let mut parser = Parser::new(text.as_bytes());
    parse_lines(&mut parser)?;
    Ok(parser.program)
}

pub struct Parser<'t> {
    pub program: Program,
    pub(super) lexer: Lexer<'t>,
    pub(super) token: Token<'t>,
}

impl<'t> Parser<'t> {
    pub(super) fn new(text: &'t [u8]) -> Parser<'t> {
        let mut lexer = Lexer::new(text);
        let token = lexer.next();
        Parser {
            program: Program::new(),
            lexer,
            token,
        }
    }

    pub(super) fn advance(&mut self) {
        self.token = self.lexer.next();
    }

    pub fn fail<T>(&self, expected: &'static str) -> Parsed<T> {
        Err(ParseError {
            line: self.token.position.line,
            column: self.token.position.column,
            expected,
        })
    }

    pub fn at(&self, kind: TokenKind) -> bool {
        self.token.kind == kind
    }

    pub fn accept(&mut self, kind: TokenKind) -> bool {
        let is_accepted = self.at(kind);
        if is_accepted {
            self.advance();
        }
        is_accepted
    }

    pub fn expect(&mut self, kind: TokenKind, expected: &'static str) -> Parsed<()> {
        if self.accept(kind) {
            return Ok(());
        }
        self.fail(expected)
    }

    pub fn word_text(&self) -> Option<&'t str> {
        if !self.at(TokenKind::Word) {
            return None;
        }
        core::str::from_utf8(self.token.text).ok()
    }

    pub fn accept_word(&mut self, word: &str) -> bool {
        let is_accepted = self.word_text() == Some(word);
        if is_accepted {
            self.advance();
        }
        is_accepted
    }

    pub fn parse_word(&mut self, expected: &'static str) -> Parsed<&'t str> {
        let Some(word) = self.word_text() else {
            return self.fail(expected);
        };
        self.advance();
        Ok(word)
    }

    pub fn next_field_name(&mut self) -> Parsed<Option<&'t str>> {
        let Some(name) = self.word_text() else {
            return Ok(None);
        };
        let state = self.lexer.state();
        if self.lexer.next().kind != TokenKind::Equal {
            self.lexer.restore(state);
            return Ok(None);
        }
        self.advance();
        Ok(Some(name))
    }

    pub fn parse_nested<R>(
        &mut self,
        parse_fields: impl FnOnce(&mut Parser<'t>) -> Parsed<R>,
    ) -> Parsed<R> {
        self.expect(TokenKind::LeftBrace, "{")?;
        let record = parse_fields(self)?;
        self.expect(TokenKind::RightBrace, "a field or }")?;
        Ok(record)
    }

    pub fn parse_list<R>(
        &mut self,
        mut parse_item: impl FnMut(&mut Parser<'t>) -> Parsed<R>,
    ) -> Parsed<Vec<R>> {
        self.expect(TokenKind::LeftBracket, "[")?;
        let mut items = Vec::new();
        if self.accept(TokenKind::RightBracket) {
            return Ok(items);
        }
        loop {
            items.push(parse_item(self)?);
            if !self.accept(TokenKind::Comma) {
                break;
            }
        }
        self.expect(TokenKind::RightBracket, ", or ]")?;
        Ok(items)
    }

    pub fn parse_optional<R>(
        &mut self,
        parse_item: impl FnOnce(&mut Parser<'t>) -> Parsed<R>,
    ) -> Parsed<Option<R>> {
        if self.accept(TokenKind::Minus) {
            return Ok(None);
        }
        parse_item(self).map(Some)
    }

    pub fn parse_enum<E>(
        &mut self,
        from_name: impl FnOnce(&str) -> Option<E>,
        expected: &'static str,
    ) -> Parsed<E> {
        let Some(member) = self.word_text().and_then(from_name) else {
            return self.fail(expected);
        };
        self.advance();
        Ok(member)
    }

    pub fn parse_flags(&mut self, names: &[&str], expected: &'static str) -> Parsed<u32> {
        let bits = self.parse_list(|parser| {
            let find_bit = |word: &str| names.iter().position(|&name| name == word);
            parser.parse_enum(find_bit, expected)
        })?;
        Ok(bits.into_iter().fold(0, |word, bit| word | (1 << bit)))
    }

    pub fn parse_bool(&mut self) -> Parsed<bool> {
        if self.accept_word("true") {
            return Ok(true);
        }
        if self.accept_word("false") {
            return Ok(false);
        }
        self.fail("true or false")
    }

    pub fn parse_i64(&mut self) -> Parsed<i64> {
        if !self.at(TokenKind::Integer) {
            return self.fail("an integer");
        }
        let value = self.token.integer;
        self.advance();
        Ok(value)
    }

    pub fn parse_u32(&mut self) -> Parsed<u32> {
        let is_integer = self.at(TokenKind::Integer);
        let Some(value) = u32::try_from(self.token.integer)
            .ok()
            .filter(|_| is_integer)
        else {
            return self.fail("an unsigned 32-bit integer");
        };
        self.advance();
        Ok(value)
    }

    pub fn parse_double(&mut self) -> Parsed<f64> {
        let Some(value) = self.token.double() else {
            return self.fail("a number");
        };
        self.advance();
        Ok(value)
    }

    pub fn parse_id<I: Id>(&mut self, expected: &'static str) -> Parsed<I> {
        let digits = self
            .word_text()
            .and_then(|word| word.strip_prefix(I::PREFIX));
        let number = digits.and_then(|digits| digits.parse::<u32>().ok());
        let Some(number) = number.filter(|&number| number != ABSENT_WORD) else {
            return self.fail(expected);
        };
        self.advance();
        Ok(I::from_word(number))
    }

    pub fn parse_string(&mut self) -> Parsed<StringId> {
        if !self.at(TokenKind::String) {
            return self.fail("a string");
        }
        let Some(bytes) = decode_string(self.token.text) else {
            return self.fail("a string with valid escapes");
        };
        self.advance();
        Ok(self.program.strings.intern(&bytes))
    }

    pub fn parse_bytes(&mut self) -> Parsed<Vec<u8>> {
        if !self.at(TokenKind::String) {
            return self.fail("a string of bytes");
        }
        let Some(bytes) = decode_bytes(self.token.text) else {
            return self.fail("a string of bytes with valid escapes");
        };
        self.advance();
        Ok(bytes)
    }

    pub fn parse_property_key(&mut self) -> Parsed<PropertyKeyId> {
        parse_property_key(self)
    }

    pub fn parse_type(&mut self) -> Parsed<TypeId> {
        parse_type(self)
    }

    pub fn parse_body(&mut self) -> Parsed<Body> {
        parse_body(self)
    }
}
