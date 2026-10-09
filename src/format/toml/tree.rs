//! Tokens to tree.
//!
//! The tree is the one that taplo's parser makes of a document without errors, without its white
//! space: where a comment or a run of line breaks is in it decides what becomes of it. It is a vector
//! of elements in the order of the text: a node is followed by what is in it.

use crate::FormatError;
use crate::text::BOM;
use bun_parsers::toml::{Token, TokenKind};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Kind {
    /// `[a]` or `[[a]]`
    Header,
    /// `a = 1`
    Entry,
    Key,
    Value,
    Array,
    InlineTable,
    /// A token that is written as it is.
    Text,
    /// `[` of an array, `{`
    Open,
    /// `]` of an array, `}`
    Close,
    Comma,
    Comment,
    /// `\n` or `\r\n`, any number of times.
    LineBreaks,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct Element {
    pub(super) kind: Kind,
    /// Of a token.
    pub(super) start: u32,
    pub(super) end: u32,
    /// The index of the element after this one and all that is in it.
    pub(super) next: u32,
}

/// How deep arrays and inline tables can be nested: they are read and written by functions that call
/// each other.
const MAX_DEPTH: u32 = 128;

struct Builder<'t> {
    text: &'t [u8],
    tokens: std::slice::Iter<'t, Token>,
    /// Behind the last token.
    at: usize,
    elements: Vec<Element>,
    depth: u32,
}

/// `tokens`: those of `text`.
pub(super) fn build(text: &[u8], tokens: &[Token]) -> Result<Vec<Element>, FormatError> {
    let mut builder = Builder {
        text,
        tokens: tokens.iter(),
        at: if text.starts_with(BOM) { BOM.len() } else { 0 },
        elements: Vec::with_capacity(tokens.len() * 2),
        depth: 0,
    };
    loop {
        builder.trivia();
        let Some(kind) = builder.peek() else {
            return Ok(builder.elements);
        };
        if kind == TokenKind::Key {
            let entry = builder.start(Kind::Entry);
            builder.key_and_value()?;
            builder.comment_on_the_line();
            builder.finish(entry);
        } else {
            let header = builder.start(Kind::Header);
            builder.token(Kind::Text);
            builder.key();
            builder.token(Kind::Text);
            builder.comment_on_the_line();
            builder.finish(header);
        }
    }
}

impl Builder<'_> {
    fn peek(&self) -> Option<TokenKind> {
        self.tokens.as_slice().first().map(|it| it.kind)
    }

    fn push(&mut self, kind: Kind, start: usize, end: usize) {
        let next = self.elements.len() as u32 + 1;
        self.elements.push(Element {
            kind,
            start: start as u32,
            end: end as u32,
            next,
        });
    }

    fn start(&mut self, kind: Kind) -> usize {
        self.push(kind, self.at, self.at);
        self.elements.len() - 1
    }

    fn finish(&mut self, node: usize) {
        self.elements[node].next = self.elements.len() as u32;
    }

    /// The next token, as `kind`.
    fn token(&mut self, kind: Kind) {
        if let Some(token) = self.tokens.next() {
            self.push(kind, token.start as usize, token.end as usize);
            self.at = token.end as usize;
        }
    }

    /// Where the next token starts.
    fn gap_end(&self) -> usize {
        let next = self.tokens.as_slice().first();
        next.map_or(self.text.len(), |it| it.start as usize)
    }

    fn skip_blanks(&mut self) {
        let rest = self.text.get(self.at..).unwrap_or_default();
        self.at += rest
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
    }

    /// taplo's `step`: a comment behind a token, on its line, is in the node that the token is in.
    fn comment_on_the_line(&mut self) {
        self.skip_blanks();
        if self.at < self.gap_end() && self.text[self.at] == b'#' {
            let rest = &self.text[self.at..];
            let len = bun_core::strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len());
            self.push(Kind::Comment, self.at, self.at + len);
            self.at += len;
        }
    }

    /// The comments and the line breaks up to the next token.
    fn trivia(&mut self) {
        let end = self.gap_end();
        loop {
            self.comment_on_the_line();
            if self.at >= end {
                return;
            }
            let rest = &self.text[self.at..end];
            let len = match rest[0] {
                b'\n' => rest.iter().take_while(|byte| **byte == b'\n').count(),
                _ => {
                    let pairs = rest.as_chunks::<2>().0.iter();
                    2 * pairs.take_while(|pair| *pair == b"\r\n").count()
                }
            };
            // Between two tokens there is nothing else.
            if len == 0 {
                self.at = end;
                return;
            }
            self.push(Kind::LineBreaks, self.at, self.at + len);
            self.at += len;
        }
    }

    fn key(&mut self) {
        let key = self.start(Kind::Key);
        while matches!(self.peek(), Some(TokenKind::Key | TokenKind::Dot)) {
            self.token(Kind::Text);
        }
        self.finish(key);
    }

    /// `a = 1`
    fn key_and_value(&mut self) -> Result<(), FormatError> {
        self.key();
        if let Some(equals) = self.tokens.next() {
            self.at = equals.end as usize;
        }
        self.value()
    }

    fn value(&mut self) -> Result<(), FormatError> {
        let value = self.start(Kind::Value);
        match self.peek() {
            Some(TokenKind::ArrayOpen) => self.container(Kind::Array)?,
            Some(TokenKind::InlineOpen) => self.container(Kind::InlineTable)?,
            _ => {
                self.token(Kind::Text);
                self.comment_on_the_line();
            }
        }
        self.finish(value);
        Ok(())
    }

    /// An array or an inline table.
    fn container(&mut self, kind: Kind) -> Result<(), FormatError> {
        if self.depth == MAX_DEPTH {
            return Err(FormatError::NestedTooDeeply);
        }
        self.depth += 1;
        let container = self.start(kind);
        self.token(Kind::Open);
        loop {
            self.trivia();
            match self.peek() {
                Some(TokenKind::Comma) => self.token(Kind::Comma),
                Some(TokenKind::Key) => {
                    let entry = self.start(Kind::Entry);
                    self.key_and_value()?;
                    self.finish(entry);
                }
                Some(TokenKind::ArrayClose | TokenKind::InlineClose) | None => break,
                Some(_) => self.value()?,
            }
        }
        self.token(Kind::Close);
        self.finish(container);
        self.depth -= 1;
        Ok(())
    }
}
