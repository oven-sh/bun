//! https://httpwg.org/specs/rfc9651.html#text-parse

use crate::headers::is_token_byte;

#[derive(Clone, PartialEq)]
pub enum Bare<'a> {
    Token(&'a [u8]),
    String(Vec<u8>),
    Boolean(bool),
    Number(f64),
    ByteSequence(&'a [u8]),
}

pub struct Parameters<'a>(Vec<(&'a [u8], Bare<'a>)>);

impl Parameters<'_> {
    /// A string, or a token.
    pub fn text(&self, name: &[u8]) -> Option<&[u8]> {
        match &self.0.iter().rfind(|it| it.0 == name)?.1 {
            Bare::Token(text) => Some(text),
            Bare::String(text) => Some(text),
            _ => None,
        }
    }
}

pub enum Value<'a> {
    Item(Bare<'a>),
    InnerList(Vec<Bare<'a>>),
}

impl<'a> Value<'a> {
    pub fn items(&self) -> &[Bare<'a>] {
        match self {
            Value::Item(item) => core::slice::from_ref(item),
            Value::InnerList(items) => items,
        }
    }
}

struct Parser<'a>(&'a [u8]);

impl<'a> Parser<'a> {
    fn take_while(&mut self, takes: impl Fn(u8) -> bool) -> &'a [u8] {
        let (taken, rest) = self
            .0
            .split_at(self.0.iter().take_while(|it| takes(**it)).count());
        self.0 = rest;
        taken
    }

    fn eat(&mut self, byte: u8) -> bool {
        self.0
            .split_first()
            .filter(|it| *it.0 == byte)
            .map(|it| self.0 = it.1)
            .is_some()
    }

    fn key(&mut self) -> Option<&'a [u8]> {
        matches!(self.0.first()?, b'a'..=b'z' | b'*').then_some(())?;
        Some(
            self.take_while(
                |it| matches!(it, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-' | b'.' | b'*'),
            ),
        )
    }

    fn string(&mut self) -> Option<Vec<u8>> {
        let mut text = Vec::new();
        loop {
            self.0 = match self.0 {
                [b'"', rest @ ..] => {
                    self.0 = rest;
                    return Some(text);
                }
                [b'\\', byte @ (b'"' | b'\\'), rest @ ..]
                | [byte @ (0x20..=0x5b | 0x5d..=0x7e), rest @ ..] => {
                    text.push(*byte);
                    rest
                }
                _ => return None,
            };
        }
    }

    fn bare(&mut self) -> Option<Bare<'a>> {
        if self.eat(b'"') {
            return self.string().map(Bare::String);
        }
        if self.eat(b'?') {
            return if self.eat(b'1') {
                Some(Bare::Boolean(true))
            } else {
                self.eat(b'0').then_some(Bare::Boolean(false))
            };
        }
        if self.eat(b':') {
            let bytes = self
                .take_while(|it| it.is_ascii_alphanumeric() || matches!(it, b'+' | b'/' | b'='));
            return self.eat(b':').then_some(Bare::ByteSequence(bytes));
        }
        match self.0.first()? {
            b'-' | b'0'..=b'9' => {
                let number = self.take_while(|it| matches!(it, b'-' | b'.' | b'0'..=b'9'));
                core::str::from_utf8(number)
                    .ok()?
                    .parse()
                    .ok()
                    .map(Bare::Number)
            }
            b'a'..=b'z' | b'A'..=b'Z' | b'*' => {
                Some(Bare::Token(self.take_while(|it| {
                    is_token_byte(it) || matches!(it, b':' | b'/')
                })))
            }
            _ => None,
        }
    }

    fn parameters(&mut self) -> Option<Parameters<'a>> {
        let mut parameters = Vec::new();
        while self.eat(b';') {
            self.take_while(|it| it == b' ');
            let key = self.key()?;
            parameters.push((
                key,
                if self.eat(b'=') {
                    self.bare()?
                } else {
                    Bare::Boolean(true)
                },
            ));
        }
        Some(Parameters(parameters))
    }

    fn value(&mut self) -> Option<Value<'a>> {
        if !self.eat(b'(') {
            return self.bare().map(Value::Item);
        }
        let mut items = Vec::new();
        loop {
            self.take_while(|it| it == b' ');
            if self.eat(b')') {
                return Some(Value::InnerList(items));
            }
            items.push(self.bare()?);
            self.parameters()?;
            matches!(self.0.first()?, b' ' | b')').then_some(())?;
        }
    }
}

pub fn parse_item(text: &[u8]) -> Option<(Bare<'_>, Parameters<'_>)> {
    let mut parser = Parser(text.trim_ascii());
    let item = (parser.bare()?, parser.parameters()?);
    parser.0.is_empty().then_some(item)
}

/// Of the members with the same key, the last one counts.
pub fn parse_dictionary(text: &[u8]) -> Option<Vec<(&[u8], Value<'_>, Parameters<'_>)>> {
    let (mut parser, mut members) = (Parser(text.trim_ascii()), Vec::<(&[u8], _, _)>::new());
    while !parser.0.is_empty() {
        let key = parser.key()?;
        let value = if parser.eat(b'=') {
            parser.value()?
        } else {
            Value::Item(Bare::Boolean(true))
        };
        members.retain(|it| it.0 != key);
        members.push((key, value, parser.parameters()?));
        parser.take_while(|it| matches!(it, b' ' | b'\t'));
        if !parser.0.is_empty() {
            parser.eat(b',').then_some(())?;
            parser.take_while(|it| matches!(it, b' ' | b'\t'));
            (!parser.0.is_empty()).then_some(())?;
        }
    }
    Some(members)
}
