//! Tokens to tree.
//!
//! This is the tree that taplo's parser builds for a document without errors, minus the whitespace.
//! Where a comment or a run of line breaks sits in the tree decides how it's printed. The tree is a
//! vector of elements in source order, where a node is followed by its children.

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
    /// A token that's copied verbatim.
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
    /// The token's span. Empty for a node.
    pub(super) start: u32,
    pub(super) end: u32,
    /// Index of the first element after this one and its descendants.
    pub(super) next: u32,
}

struct Builder<'t> {
    text: &'t [u8],
    tokens: std::slice::Iter<'t, Token>,
    /// Offset just past the last token.
    at: usize,
    elements: Vec<Element>,
    stack_check: bun_core::StackCheck,
}

/// `tokens` must be the tokens of `text`.
pub(super) fn build(text: &[u8], tokens: &[Token]) -> Result<Vec<Element>, FormatError> {
    let mut builder = Builder {
        text,
        tokens: tokens.iter(),
        at: if text.starts_with(BOM) { BOM.len() } else { 0 },
        elements: Vec::with_capacity(tokens.len() * 2),
        stack_check: crate::stack::check_for_tree(),
    };
    loop {
        builder.trivia();
        let Some(kind) = builder.peek() else {
            return Ok(builder.elements);
        };
        if kind == TokenKind::Key {
            let entry = builder.start(Kind::Entry);
            builder.key_and_value()?;
            builder.same_line_comment();
            builder.finish(entry);
        } else {
            let header = builder.start(Kind::Header);
            builder.token(Kind::Text);
            builder.key();
            builder.token(Kind::Text);
            builder.same_line_comment();
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

    /// Pushes the next token as `kind`.
    fn token(&mut self, kind: Kind) {
        if let Some(token) = self.tokens.next() {
            self.push(kind, token.start as usize, token.end as usize);
            self.at = token.end as usize;
        }
    }

    /// Start of the next token.
    fn gap_end(&self) -> usize {
        let next = self.tokens.as_slice().first();
        next.map_or(self.text.len(), |it| it.start as usize)
    }

    fn skip_spaces_and_tabs(&mut self) {
        let rest = self.text.get(self.at..).unwrap_or_default();
        self.at += rest
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
    }

    /// taplo's `step`: a comment after a token on the same line belongs to the token's node.
    fn same_line_comment(&mut self) {
        self.skip_spaces_and_tabs();
        if self.at < self.gap_end() && self.text[self.at] == b'#' {
            let rest = &self.text[self.at..];
            let len = bun_core::strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len());
            self.push(Kind::Comment, self.at, self.at + len);
            self.at += len;
        }
    }

    /// Pushes the comments and line breaks up to the next token.
    fn trivia(&mut self) {
        let end = self.gap_end();
        loop {
            self.same_line_comment();
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
            // Nothing else can appear between two tokens.
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
                self.same_line_comment();
            }
        }
        self.finish(value);
        Ok(())
    }

    /// An array or an inline table.
    fn container(&mut self, kind: Kind) -> Result<(), FormatError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(FormatError::NestedTooDeeply);
        }
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
        Ok(())
    }
}
