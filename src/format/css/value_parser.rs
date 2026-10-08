//! `postcss-values-parser` 2.0.1 in loose mode (`lib/tokenize.js`, `lib/parser.js`), and what
//! Prettier makes of its result (`parse/parse-value.js`).
//!
//! The positions that the parser gives its nodes are wrong in several ways. They are kept that way,
//! since Prettier goes by them.

use super::Parser as Syntax;
use super::selector_parser::{self, SelectorNode};
use super::text;
use std::borrow::Cow;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum TokenKind {
    Space,
    Colon,
    Comma,
    OpenBrace,
    CloseBrace,
    OpenParen,
    CloseParen,
    String,
    AtWord,
    Word,
    Operator,
    Comment,
    Hash,
    UnicodeRange,
}

#[derive(Debug, Copy, Clone)]
struct Token {
    kind: TokenKind,
    /// `token[6]`, and where the text ends.
    pos: u32,
    end: u32,
    /// `token[2]` to `token[5]`
    line: u32,
    column: u32,
    end_line: u32,
    end_column: u32,
}

#[derive(Debug)]
pub(crate) struct ParseError;

/// How deep parentheses can be nested. What follows is recursive.
const MAX_DEPTH: i32 = 128;

fn is_space(byte: Option<&u8>) -> bool {
    matches!(byte, Some(b' ' | b'\n' | b'\t' | b'\r' | 0x0C))
}

/// The index of the first character from `from` on that ends a word. A `/` does if `slash` says so,
/// given what follows it.
fn word_end(css: &[u8], from: usize, set: &[u8], slash: impl Fn(Option<&u8>) -> bool) -> Option<usize> {
    let mut at = from;
    loop {
        at += bun_core::strings::index_of_any(css.get(at..)?, set)? as usize;
        if css[at] != b'/' || slash(css.get(at + 1)) {
            return Some(at);
        }
        at += 1;
    }
}

const WORD_END: &[u8] = b" \n\t\r(){}*:;@!&'\"+|~>,[]\\/";
const WORD_END_NUM: &[u8] = b" \n\t\r(){}*:;@!&'\"-+|~>,[]\\/";

fn tokenize(css: &[u8]) -> Result<Vec<Token>, ParseError> {
    let mut tokens: Vec<Token> = Vec::new();
    let length = css.len();
    // The position of the last line break, which is -1 at first: all columns are one more.
    let mut offset: i64 = -1;
    let mut line: u32 = 1;
    let mut pos = 0usize;
    let mut paren_count = 0i32;
    let mut is_url_arg = false;

    while pos < length {
        let code = css[pos];
        if code == b'\n' {
            offset = pos as i64;
            line += 1;
        }
        let column = |at: usize, offset: i64| (at as i64 - offset) as u32;
        let (start_line, start_column) = (line, column(pos, offset));
        // Where the text of the token ends, and what `next` is for its last column.
        let (kind, end, next): (TokenKind, usize, usize);
        match code {
            b'\n' | b' ' | b'\t' | b'\r' | 0x0C => {
                let mut at = pos + 1;
                while is_space(css.get(at)) {
                    if css[at] == b'\n' {
                        offset = at as i64;
                        line += 1;
                    }
                    at += 1;
                }
                (kind, end, next) = (TokenKind::Space, at, at);
            }
            b':' => (kind, end, next) = (TokenKind::Colon, pos + 1, pos + 1),
            b',' => (kind, end, next) = (TokenKind::Comma, pos + 1, pos + 1),
            b'{' => (kind, end, next) = (TokenKind::OpenBrace, pos + 1, pos + 1),
            b'}' => (kind, end, next) = (TokenKind::CloseBrace, pos + 1, pos + 1),
            b'(' => {
                paren_count += 1;
                if paren_count > MAX_DEPTH {
                    return Err(ParseError);
                }
                is_url_arg = !is_url_arg
                    && paren_count == 1
                    && tokens.last().is_some_and(|last| {
                        last.kind == TokenKind::Word && &css[last.pos as usize..last.end as usize] == b"url"
                    });
                (kind, end, next) = (TokenKind::OpenParen, pos + 1, pos + 1);
            }
            b')' => {
                paren_count -= 1;
                is_url_arg = is_url_arg && paren_count > 0;
                (kind, end, next) = (TokenKind::CloseParen, pos + 1, pos + 1);
            }
            b'\'' | b'"' => {
                let mut close = pos;
                loop {
                    close = text::index_of_char_from(css, code, close + 1).ok_or(ParseError)?;
                    let backslashes = css[..close].iter().rev().take_while(|&&b| b == b'\\').count();
                    if backslashes % 2 == 0 {
                        break;
                    }
                }
                (kind, end, next) = (TokenKind::String, close + 1, close);
            }
            b'@' => {
                let at = bun_core::strings::index_of_any(&css[pos + 1..], b" \n\t\r{()'\"\\;,/")
                    .map_or(length, |at| pos + 1 + at as usize);
                (kind, end, next) = (TokenKind::AtWord, at, at - 1);
            }
            b'\\' => (kind, end, next) = (TokenKind::Word, pos + 1, pos),
            b'+' | b'-' | b'*' => {
                if code == b'-' && css.get(pos + 1) == Some(&b'-') {
                    (kind, end, next) = (TokenKind::Word, pos + 2, pos + 2);
                } else {
                    (kind, end, next) = (TokenKind::Operator, pos + 1, pos + 1);
                }
            }
            b'/' if css.get(pos + 1) == Some(&b'*') || (!is_url_arg && css.get(pos + 1) == Some(&b'/')) => {
                let last = if css[pos + 1] == b'*' {
                    text::index_of_from(css, b"*/", pos + 2).ok_or(ParseError)? + 1
                } else {
                    text::index_of_char_from(css, b'\n', pos + 2).map_or(length, |at| at - 1)
                };
                let content = &css[pos..(last + 1).min(length)];
                let lines = bun_core::strings::count_char(content, b'\n') as u32;
                if lines > 0 {
                    let last_line_len = content.len() - 1 - bun_core::strings::last_index_of_char(content, b'\n').unwrap_or(0);
                    line += lines;
                    offset = last as i64 - last_line_len as i64;
                }
                (kind, end, next) = (TokenKind::Comment, (last + 1).min(length), last);
            }
            b'#' if !css.get(pos + 1).is_some_and(u8::is_ascii_alphanumeric) => {
                (kind, end, next) = (TokenKind::Hash, pos + 1, pos + 1);
            }
            b'u' | b'U' if css.get(pos + 1) == Some(&b'+') => {
                let mut at = pos + 3;
                while at < length && (css[at].is_ascii_hexdigit() || matches!(css[at], b'?' | b'-')) {
                    at += 1;
                }
                let at = at.min(length.max(pos + 3));
                (kind, end, next) = (TokenKind::UnicodeRange, at.min(length), at);
            }
            b'/' => (kind, end, next) = (TokenKind::Operator, pos + 1, pos + 1),
            _ => {
                let is_number = code.is_ascii_digit();
                let find = |from: usize, is_number: bool| match is_number {
                    true => word_end(css, from, WORD_END_NUM, |_| true),
                    false => word_end(css, from, WORD_END, |after| after == Some(&b'*')),
                };
                let mut last = find(pos + 1, is_number).map_or(length - 1, |at| at - 1);
                // `1e-10`, `1e+10`
                if (is_number || code == b'.')
                    && matches!(css.get(last), Some(b'e' | b'E'))
                    && matches!(css.get(last + 1), Some(b'-' | b'+'))
                    && css.get(last + 2).is_some_and(u8::is_ascii_digit)
                {
                    last = find(last + 2, true).map_or(length - 1, |at| at - 1);
                }
                (kind, end, next) = (TokenKind::Word, last + 1, last);
            }
        }
        tokens.push(Token {
            kind,
            pos: pos as u32,
            end: end as u32,
            line: if kind == TokenKind::Space { line } else { start_line },
            column: start_column,
            end_line: line,
            end_column: column(next, offset),
        });
        pos = end;
    }
    Ok(tokens)
}

/// `source` and `sourceIndex`, and what Prettier's `calculateLoc` makes of them.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Loc {
    source_index: Option<u32>,
    /// `source.start.line`
    pub(crate) start_line: Option<u32>,
    /// `source.end`: the line and the column.
    end: Option<(u32, u32)>,
    pub(crate) start_offset: Option<u32>,
    pub(crate) end_offset: Option<u32>,
}

#[derive(Debug)]
pub(crate) enum ValueKind<'a> {
    Root {
        group: Box<ValueNode<'a>>,
    },
    Value {
        group: Box<ValueNode<'a>>,
    },
    Word {
        value: Cow<'a, [u8]>,
        is_hex: bool,
        is_color: bool,
    },
    Number {
        value: Cow<'a, [u8]>,
        unit: Cow<'a, [u8]>,
    },
    String {
        value: Cow<'a, [u8]>,
        /// `raws.quote`
        quote: &'static [u8],
    },
    Operator(Cow<'a, [u8]>),
    Colon,
    Comma,
    Comment {
        value: Cow<'a, [u8]>,
        inline: bool,
    },
    Func {
        value: Cow<'a, [u8]>,
        group: Box<ValueNode<'a>>,
    },
    Paren(u8),
    AtWord(Cow<'a, [u8]>),
    UnicodeRange(Cow<'a, [u8]>),
    ParenGroup {
        open: Option<Box<ValueNode<'a>>>,
        close: Option<Box<ValueNode<'a>>>,
        groups: Vec<ValueNode<'a>>,
    },
    CommaGroup {
        groups: Vec<ValueNode<'a>>,
    },
    /// A string in the `groups` of the parentheses of `url()`.
    Text(Cow<'a, [u8]>),
    /// What is in the parentheses of `selector()`.
    Selector(SelectorNode<'a>),
    /// `value-unknown`
    Unknown(Cow<'a, [u8]>),
}

#[derive(Debug)]
pub(crate) struct ValueNode<'a> {
    pub(crate) kind: ValueKind<'a>,
    /// `raws.before`. A group has no `raws`.
    pub(crate) before: Option<Cow<'a, [u8]>>,
    pub(crate) loc: Loc,
}

impl<'a> ValueNode<'a> {
    fn without_loc(kind: ValueKind<'a>) -> Self {
        ValueNode {
            kind,
            before: None,
            loc: Loc::default(),
        }
    }

    /// `node.value`, if it is a string.
    pub(crate) fn value(&self) -> Option<&[u8]> {
        match &self.kind {
            ValueKind::Word { value, .. }
            | ValueKind::Comment { value, .. }
            | ValueKind::Number { value, .. }
            | ValueKind::String { value, .. }
            | ValueKind::Operator(value)
            | ValueKind::Func { value, .. }
            | ValueKind::AtWord(value)
            | ValueKind::UnicodeRange(value)
            | ValueKind::Unknown(value) => Some(value),
            ValueKind::Colon => Some(b":"),
            ValueKind::Comma => Some(b","),
            ValueKind::Paren(b'(') => Some(b"("),
            ValueKind::Paren(_) => Some(b")"),
            _ => None,
        }
    }

    /// `node.groups`
    pub(crate) fn groups(&self) -> Option<&[ValueNode<'a>]> {
        match &self.kind {
            ValueKind::ParenGroup { groups, .. } | ValueKind::CommaGroup { groups } => Some(groups),
            _ => None,
        }
    }

    /// Whether it has a `source`, after `calculateLoc`.
    pub(crate) fn has_source(&self) -> bool {
        self.loc.start_offset.is_some() || self.loc.end.is_some()
    }
}

/// A node of `postcss-values-parser`, before Prettier groups what is in it.
struct RawNode<'a> {
    node: ValueNode<'a>,
    /// Of a container.
    nodes: Vec<usize>,
    is_func: bool,
    /// Of a function and of the value. `None`: it has no such property.
    unbalanced: Option<i32>,
}

struct ValuesParser<'t, 'a> {
    text: &'t [u8],
    /// `text`, if it lives as long as the nodes.
    borrowed: Option<&'a [u8]>,
    tokens: Vec<Token>,
    position: usize,
    nodes: Vec<RawNode<'a>>,
    current: usize,
    cache: Vec<usize>,
    spaces: Option<(u32, u32)>,
}

/// `/^[+-]?((\d+(\.\d*)?)|(\.\d+))([eE][+-]?\d+)?/`: the length of the match.
fn number_prefix_len(text: &[u8]) -> Option<usize> {
    let digits = |from: usize| text[from.min(text.len())..].iter().take_while(|b| b.is_ascii_digit()).count();
    let mut at = usize::from(matches!(text.first(), Some(b'+' | b'-')));
    let integer = digits(at);
    if integer > 0 {
        at += integer;
        if text.get(at) == Some(&b'.') {
            at += 1 + digits(at + 1);
        }
    } else if text.get(at) == Some(&b'.') && digits(at + 1) > 0 {
        at += 1 + digits(at + 1);
    } else {
        return None;
    }
    if matches!(text.get(at), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(text.get(at + 1), Some(b'+' | b'-')));
        let exponent = digits(at + 1 + sign);
        if exponent > 0 {
            at += 1 + sign + exponent;
        }
    }
    Some(at)
}

impl<'t, 'a> ValuesParser<'t, 'a> {
    fn cow(&self, start: usize, end: usize) -> Cow<'a, [u8]> {
        match self.borrowed {
            Some(text) => Cow::Borrowed(text.get(start..end).unwrap_or_default()),
            None => Cow::Owned(self.text.get(start..end).unwrap_or_default().to_vec()),
        }
    }

    fn token(&self, position: usize) -> Option<Token> {
        self.tokens.get(position).copied()
    }

    fn text_of(&self, token: Token) -> &'t [u8] {
        &self.text[token.pos as usize..token.end as usize]
    }

    fn last_of_current(&self) -> Option<usize> {
        self.nodes[self.current].nodes.last().copied()
    }

    fn new_node(&mut self, kind: ValueKind<'a>, loc: Loc) -> usize {
        let before = match self.spaces.take() {
            Some((start, end)) => self.cow(start as usize, end as usize),
            None => Cow::Borrowed(&b""[..]),
        };
        let is_func = matches!(kind, ValueKind::Func { .. });
        let id = self.nodes.len();
        self.nodes.push(RawNode {
            node: ValueNode {
                kind,
                before: Some(before),
                loc,
            },
            nodes: Vec::new(),
            is_func,
            unbalanced: is_func.then_some(-1),
        });
        self.nodes[self.current].nodes.push(id);
        id
    }

    /// The `source` and the `sourceIndex` that most nodes get from their token.
    fn loc_of(token: Token) -> Loc {
        Loc {
            source_index: Some(token.pos),
            start_line: Some(token.line),
            end: Some((token.end_line, token.end_column)),
            ..Loc::default()
        }
    }

    fn parse(&mut self) -> Result<(), ParseError> {
        while let Some(token) = self.token(self.position) {
            match token.kind {
                TokenKind::Space => self.space(token)?,
                TokenKind::Colon => self.simple(ValueKind::Colon, token),
                TokenKind::Comma => self.simple(ValueKind::Comma, token),
                TokenKind::Comment => {
                    // `.replace(/\/\*|\*\//g, "")`
                    let text = self.text_of(token);
                    let (start, end) = (token.pos as usize, token.end as usize);
                    let mut value = match text.strip_prefix(b"/*").and_then(|it| it.strip_suffix(b"*/")) {
                        Some(inner) if !text::includes(inner, b"/*") && !text::includes(inner, b"*/") => {
                            self.cow(start + 2, end - 2)
                        }
                        _ if !text::includes(text, b"/*") && !text::includes(text, b"*/") => self.cow(start, end),
                        _ => {
                            let mut value = Vec::with_capacity(text.len());
                            let mut rest = text;
                            while let Some(&byte) = rest.first() {
                                match rest.starts_with(b"/*") || rest.starts_with(b"*/") {
                                    true => rest = &rest[2..],
                                    false => {
                                        value.push(byte);
                                        rest = &rest[1..];
                                    }
                                }
                            }
                            Cow::Owned(value)
                        }
                    };
                    let inline = value.starts_with(b"//");
                    if inline {
                        match &mut value {
                            Cow::Borrowed(value) => *value = &value[2..],
                            Cow::Owned(value) => drop(value.drain(..2)),
                        }
                    }
                    self.simple(ValueKind::Comment { value, inline }, token);
                }
                TokenKind::OpenParen => self.paren_open(token)?,
                TokenKind::CloseParen => self.paren_close(token)?,
                TokenKind::Operator => self.operator(token)?,
                TokenKind::String => {
                    let text = self.text_of(token);
                    let quote: &'static [u8] = if text.starts_with(b"\"") { b"\"" } else { b"'" };
                    let value = self.cow(token.pos as usize + 1, token.end as usize - 1);
                    self.simple(ValueKind::String { value, quote }, token);
                }
                TokenKind::UnicodeRange => {
                    let value = self.cow(token.pos as usize, token.end as usize);
                    self.simple(ValueKind::UnicodeRange(value), token);
                }
                _ => self.split_word(),
            }
        }
        Ok(())
    }

    fn simple(&mut self, kind: ValueKind<'a>, token: Token) {
        self.new_node(kind, Self::loc_of(token));
        self.position += 1;
    }

    fn space(&mut self, token: Token) -> Result<(), ParseError> {
        let next = self.token(self.position + 1);
        if next.is_none_or(|next| next.kind == TokenKind::CloseParen) {
            // It is added to the `raws.after` of the last node, which has to be there.
            self.last_of_current().ok_or(ParseError)?;
        } else {
            self.spaces = Some((token.pos, token.end));
        }
        self.position += 1;
        Ok(())
    }

    fn operator(&mut self, token: Token) -> Result<(), ParseError> {
        if matches!(self.text_of(token), b"+" | b"-") {
            let is_sign = match self.last_of_current() {
                None => true,
                Some(last) => matches!(self.nodes[last].node.kind, ValueKind::Operator(_)),
            };
            if is_sign && self.token(self.position + 1).ok_or(ParseError)?.kind == TokenKind::Word {
                self.split_word();
                return Ok(());
            }
        }
        let value = self.cow(token.pos as usize, token.end as usize);
        let loc = Loc {
            // `this.currToken[4]`, which is a line.
            source_index: Some(token.end_line),
            start_line: Some(token.line),
            end: Some((token.line, token.column)),
            ..Loc::default()
        };
        self.new_node(ValueKind::Operator(value), loc);
        self.position += 1;
        Ok(())
    }

    fn paren_open(&mut self, token: Token) -> Result<(), ParseError> {
        let mut unbalanced = 1;
        for token in self.tokens.get(self.position + 1..).unwrap_or_default() {
            match token.kind {
                TokenKind::OpenParen => unbalanced += 1,
                TokenKind::CloseParen => unbalanced -= 1,
                _ => {}
            }
            if unbalanced == 0 {
                break;
            }
        }
        if unbalanced != 0 {
            return Err(ParseError);
        }
        if let Some(last) = self.last_of_current()
            && self.nodes[last].is_func
            && self.nodes[last].unbalanced.is_some_and(|it| it < 0)
        {
            self.nodes[last].unbalanced = Some(0);
            self.current = last;
        }
        let current = &mut self.nodes[self.current];
        current.unbalanced = current.unbalanced.map(|it| it + 1);
        self.simple(ValueKind::Paren(b'('), token);
        Ok(())
    }

    fn paren_close(&mut self, token: Token) -> Result<(), ParseError> {
        self.simple(ValueKind::Paren(b')'), token);
        let is_zero = |unbalanced: Option<i32>| unbalanced.is_none_or(|it| it == 0);
        if self.position + 1 >= self.tokens.len() && is_zero(self.nodes[self.current].unbalanced) {
            return Ok(());
        }
        let current = &mut self.nodes[self.current];
        current.unbalanced = current.unbalanced.map(|it| it - 1);
        if current.unbalanced.is_some_and(|it| it < 0) {
            return Err(ParseError);
        }
        if is_zero(current.unbalanced)
            && let Some(outer) = self.cache.pop()
        {
            self.current = outer;
        }
        Ok(())
    }

    fn split_word(&mut self) {
        let Some(first) = self.token(self.position) else {
            return;
        };
        let word_start = first.pos as usize;
        let first_text = self.text_of(first);
        // `/^(?!#([a-z0-9]+))[#{}]/i`
        let no_follow = match first_text {
            [b'{' | b'}', ..] => true,
            [b'#', rest @ ..] => !rest.first().is_some_and(u8::is_ascii_alphanumeric),
            _ => false,
        };
        if !no_follow {
            while self.token(self.position + 1).is_some_and(|next| next.kind == TokenKind::Word) {
                self.position += 1;
            }
        }
        // The positions are taken from the last token, as if the word started there.
        let Some(current) = self.token(self.position) else {
            return;
        };
        let next_is_paren = self.token(self.position + 1).is_some_and(|next| next.kind == TokenKind::OpenParen);
        let word_end = current.end as usize;
        let word = &self.text[word_start..word_end];
        let is_number = number_prefix_len(self.text_of(current)).is_some();

        let mut indices: Vec<usize> = vec![0];
        let mut from = 0;
        while let Some(at) = text::index_of_char_from(word, b'@', from) {
            if at != 0 {
                indices.push(at);
            }
            from = at + 1;
        }
        for (i, &ind) in indices.iter().enumerate() {
            let index = indices.get(i + 1).copied().unwrap_or(word.len());
            let value = &word[ind..index];
            let (start, end) = (word_start + ind, word_start + index);
            let loc = Loc {
                source_index: Some(current.pos + ind as u32),
                start_line: Some(current.line),
                end: Some((current.end_line, (current.column + index as u32).saturating_sub(1))),
                ..Loc::default()
            };
            if value.starts_with(b"@") {
                let value = self.cow(start + 1, end);
                self.new_node(ValueKind::AtWord(value), loc);
            } else if is_number {
                let unit_start = number_prefix_len(value).unwrap_or(0);
                let unit = &value[unit_start..];
                // `value.replace(unit, "")` removes the first occurrence, wherever it is.
                let number = match bun_core::strings::index_of(value, unit) {
                    Some(at) if !unit.is_empty() && at != unit_start => {
                        Cow::Owned([&value[..at], &value[at + unit.len()..]].concat())
                    }
                    _ => self.cow(start, start + unit_start),
                };
                let unit = self.cow(start + unit_start, end);
                self.new_node(ValueKind::Number { value: number, unit }, loc);
            } else if next_is_paren {
                let value = self.cow(start, end);
                let placeholder = Box::new(ValueNode::without_loc(ValueKind::Text(Cow::Borrowed(b""))));
                self.cache.push(self.current);
                self.new_node(
                    ValueKind::Func {
                        value,
                        group: placeholder,
                    },
                    loc,
                );
            } else {
                let is_hex = value.len() > 1 && value[0] == b'#';
                let is_color =
                    is_hex && matches!(value.len(), 4 | 5 | 7 | 9) && value[1..].iter().all(u8::is_ascii_hexdigit);
                let value = self.cow(start, end);
                self.new_node(
                    ValueKind::Word {
                        value,
                        is_hex,
                        is_color,
                    },
                    loc,
                );
            }
        }
        self.position += 1;
    }
}

// ───────────────────────────── Prettier's `parse-value.js` ─────────────────────────────

struct Grouper<'t, 'a> {
    text: &'t [u8],
    borrowed: Option<&'a [u8]>,
    syntax: Syntax,
    is_unbalanced: std::cell::Cell<bool>,
}

fn is_word(node: &ValueNode<'_>, text: &[u8]) -> bool {
    matches!(&node.kind, ValueKind::Word { value, .. } if **value == *text)
}

impl<'t, 'a> Grouper<'t, 'a> {
    fn cow(&self, start: usize, end: usize) -> Cow<'a, [u8]> {
        match self.borrowed {
            Some(text) => Cow::Borrowed(text.get(start..end).unwrap_or_default()),
            None => Cow::Owned(self.text.get(start..end).unwrap_or_default().to_vec()),
        }
    }

    /// What is between the parentheses of the function whose `group` is `group`.
    fn arguments_range(group: &ValueNode<'a>) -> Option<(usize, usize)> {
        let ValueKind::ParenGroup {
            open: Some(open),
            close: Some(close),
            ..
        } = &group.kind
        else {
            return None;
        };
        Some((open.loc.source_index? as usize + 1, close.loc.source_index? as usize))
    }

    /// `parseNestedValue` for the container `id`: its `nodes`, each with its `group`.
    fn children(&self, nodes: &mut Vec<RawNode<'a>>, id: usize) -> Vec<ValueNode<'a>> {
        let ids = std::mem::take(&mut nodes[id].nodes);
        let mut children = Vec::with_capacity(ids.len());
        for child in ids {
            let is_func = nodes[child].is_func;
            let group = is_func.then(|| {
                let inner = self.children(nodes, child);
                flatten_groups(self.parse_value_node(inner))
            });
            let placeholder = ValueNode::without_loc(ValueKind::Comma);
            let mut node = std::mem::replace(&mut nodes[child].node, placeholder);
            if let (ValueKind::Func { group: slot, .. }, Some(group)) = (&mut node.kind, group) {
                **slot = group;
            }
            children.push(node);
        }
        children
    }

    /// `parseValueNode`
    fn parse_value_node(&self, nodes: Vec<ValueNode<'a>>) -> ValueNode<'a> {
        struct ParenGroup<'a> {
            open: Option<Box<ValueNode<'a>>>,
            groups: Vec<ValueNode<'a>>,
        }
        let comma_group = |groups: Vec<ValueNode<'a>>| ValueNode::without_loc(ValueKind::CommaGroup { groups });
        let mut paren_groups = vec![ParenGroup {
            open: None,
            groups: Vec::new(),
        }];
        let mut comma_groups: Vec<Vec<ValueNode<'a>>> = vec![Vec::new()];
        let len = nodes.len();
        let is_closing = |node: Option<&ValueNode<'a>>| matches!(node.map(|it| &it.kind), Some(ValueKind::Paren(b')')));
        // Whether a comma is followed by a comment and the `)` that ends the list.
        let ends_with_comment_and_paren = len >= 3
            && matches!(nodes[len - 2].kind, ValueKind::Comment { .. })
            && is_closing(nodes.last());

        for (i, mut node) in nodes.into_iter().enumerate() {
            if self.syntax == Syntax::Scss
                && let ValueKind::Number { value, unit } = &mut node.kind
                && **unit == *b".."
                && value.ends_with(b".")
            {
                let shorter = value.len() - 1;
                match value {
                    Cow::Borrowed(value) => *value = &value[..shorter],
                    Cow::Owned(value) => value.truncate(shorter),
                }
                *unit = Cow::Borrowed(b"...");
            }

            if let ValueKind::Func { value, group } = &mut node.kind {
                if **value == *b"selector"
                    && let Some((start, end)) = Self::arguments_range(group)
                    && let ValueKind::ParenGroup { groups, .. } = &mut group.kind
                {
                    let selector = selector_parser::parse_selector(self.cow(start, end));
                    let mut selector = ValueNode::without_loc(ValueKind::Selector(selector));
                    selector.loc.source_index = Some(start as u32);
                    *groups = vec![selector];
                }
                if **value == *b"url" {
                    let range = Self::arguments_range(group);
                    if let ValueKind::ParenGroup { groups, .. } = &mut group.kind {
                        let mut list: Vec<&ValueNode<'a>> = Vec::new();
                        for group in groups.iter() {
                            match &group.kind {
                                ValueKind::CommaGroup { groups } => list.extend(groups.iter()),
                                _ => list.push(group),
                            }
                        }
                        let has_interpolation = (1..list.len()).any(|i| {
                            is_word(list[i], b"{")
                                && matches!(&list[i - 1].kind, ValueKind::Word { value, .. } if value.ends_with(b"#"))
                        });
                        let has_string_or_function = list.iter().any(|it| match &it.kind {
                            ValueKind::String { .. } => true,
                            ValueKind::Func { value, .. } => !value.ends_with(b"\\"),
                            _ => false,
                        });
                        let is_scss_variable = self.syntax == Syntax::Scss
                            && matches!(list.first().map(|it| &it.kind), Some(ValueKind::Word { value, .. }) if value.starts_with(b"$"));
                        if (has_interpolation || (!has_string_or_function && !is_scss_variable))
                            && let Some((start, end)) = range
                        {
                            let inner = self.text.get(start..end).unwrap_or_default();
                            let skipped = inner.len() - text::trim_start(inner).len();
                            let trimmed = text::trim(inner).len();
                            let text = self.cow(start + skipped, start + skipped + trimmed);
                            *groups = vec![ValueNode::without_loc(ValueKind::Text(text))];
                        }
                    }
                }
            }

            match node.kind {
                ValueKind::Paren(b'(') => {
                    paren_groups.push(ParenGroup {
                        open: Some(Box::new(node)),
                        groups: Vec::new(),
                    });
                    comma_groups.push(Vec::new());
                }
                ValueKind::Paren(_) => {
                    if paren_groups.len() < 2 {
                        self.is_unbalanced.set(true);
                        continue;
                    }
                    let (Some(mut paren_group), Some(last)) = (paren_groups.pop(), comma_groups.pop()) else {
                        continue;
                    };
                    if !last.is_empty() {
                        paren_group.groups.push(comma_group(last));
                    }
                    let group = ValueNode::without_loc(ValueKind::ParenGroup {
                        open: paren_group.open,
                        close: Some(Box::new(node)),
                        groups: paren_group.groups,
                    });
                    if let Some(outer) = comma_groups.last_mut() {
                        outer.push(group);
                    }
                }
                ValueKind::Comma => {
                    if i + 3 == len && ends_with_comment_and_paren {
                        continue;
                    }
                    if let (Some(paren_group), Some(last)) = (paren_groups.last_mut(), comma_groups.last_mut()) {
                        paren_group.groups.push(comma_group(std::mem::take(last)));
                    }
                }
                _ => {
                    if let Some(last) = comma_groups.last_mut() {
                        last.push(node);
                    }
                }
            }
        }
        // An unclosed parenthesis cannot get here: its groups would be lost, as in Prettier.
        let last = comma_groups.pop().unwrap_or_default();
        if !last.is_empty()
            && let Some(paren_group) = paren_groups.last_mut()
        {
            paren_group.groups.push(comma_group(last));
        }
        let root = paren_groups.swap_remove(0);
        ValueNode::without_loc(ValueKind::ParenGroup {
            open: None,
            close: None,
            groups: root.groups,
        })
    }
}

fn flatten_groups(mut node: ValueNode<'_>) -> ValueNode<'_> {
    match &mut node.kind {
        ValueKind::ParenGroup {
            open: None,
            close: None,
            groups,
        }
        | ValueKind::CommaGroup { groups }
            if groups.len() == 1 =>
        {
            match groups.pop() {
                Some(only) => flatten_groups(only),
                None => node,
            }
        }
        ValueKind::ParenGroup { groups, .. } | ValueKind::CommaGroup { groups } => {
            *groups = std::mem::take(groups).into_iter().map(flatten_groups).collect();
            node
        }
        _ => node,
    }
}

// ───────────────────────────── Prettier's `loc.js` ─────────────────────────────

fn line_column_to_index((line, column): (u32, u32), text: &[u8]) -> u32 {
    let mut index = 0usize;
    for _ in 1..line {
        index = text::index_of_char_from(text, b'\n', index).map_or(0, |at| at + 1);
    }
    index as u32 + column
}

fn fix_value_word_loc(value: &[u8], index: u32) -> u32 {
    match value {
        b"-" | b"--" => index,
        [b'-', b'-', ..] => index.saturating_sub(2),
        [b'-', ..] => index.saturating_sub(1),
        _ => index,
    }
}

/// `calculateNodeLoc` for what is in a value. `text`: of the value, which starts at `root_offset`.
fn calculate_loc(node: &mut ValueNode<'_>, text: &[u8], root_offset: u32) {
    let max_end = root_offset + text.len() as u32;
    if let Some(source_index) = node.loc.source_index
        && !matches!(node.kind, ValueKind::Selector(_))
    {
        let start = match &node.kind {
            ValueKind::Word { value, .. } => fix_value_word_loc(value, source_index),
            _ => source_index,
        };
        let end = match (&node.kind, node.loc.end) {
            (ValueKind::Paren(paren), _) => Some(source_index + u32::from(*paren == b')')),
            (ValueKind::Word { value, .. }, Some(end)) => Some(fix_value_word_loc(value, line_column_to_index(end, text))),
            (_, Some(end)) => Some(line_column_to_index(end, text)),
            (_, None) => None,
        };
        node.loc.start_offset = Some((start + root_offset).min(max_end));
        node.loc.end_offset = end.map(|end| (end + root_offset).min(max_end));
    }

    let parent_start = |loc: &Loc| loc.start_offset.zip(loc.end_offset).map(|(start, _)| (start, loc.start_line));
    let mut children: Vec<&mut ValueNode<'_>> = Vec::new();
    match &mut node.kind {
        ValueKind::Root { group } | ValueKind::Value { group } | ValueKind::Func { group, .. } => children.push(group),
        ValueKind::ParenGroup { open, close, groups } => {
            children.extend(open.as_deref_mut());
            children.extend(close.as_deref_mut());
            children.extend(groups.iter_mut());
        }
        ValueKind::CommaGroup { groups } => children.extend(groups.iter_mut()),
        _ => {}
    }
    let own = parent_start(&node.loc);
    let is_empty_group = |child: &ValueNode<'_>| child.groups().is_some_and(<[_]>::is_empty) && !child.has_source();
    let mut from_children: Option<(u32, u32, Option<u32>)> = None;
    for child in &mut children {
        match &child.kind {
            ValueKind::Text(_) => continue,
            // It is the root of a text of its own, and nobody asks where it is.
            ValueKind::Selector(_) => continue,
            _ => calculate_loc(child, text, root_offset),
        }
        // `fillEmptyLocFromParent`
        if let Some((start, line)) = own
            && is_empty_group(child)
        {
            child.loc.start_offset = Some(start);
            child.loc.end_offset = Some(start);
            child.loc.start_line = line;
        }
        if let (Some(start), Some(end)) = (child.loc.start_offset, child.loc.end_offset) {
            from_children = Some(match from_children {
                None => (start, end, child.loc.start_line),
                Some((first, last, line)) => {
                    (first.min(start), last.max(end), if start < first { child.loc.start_line } else { line })
                }
            });
        }
    }
    // `fillLocFromChildren`
    let has_offsets = node.loc.start_offset.is_some() && node.loc.end_offset.is_some();
    if !(has_offsets && node.loc.end.is_some())
        && let Some((start, end, line)) = from_children
    {
        if !has_offsets {
            node.loc.start_offset = Some(start);
            node.loc.end_offset = Some(end);
        }
        node.loc.start_line = node.loc.start_line.or(line);
    }
    // `fillEmptyChildLocs`
    if let Some((start, line)) = parent_start(&node.loc) {
        for child in children {
            if is_empty_group(child) {
                child.loc.start_offset = Some(start);
                child.loc.end_offset = Some(start);
                child.loc.start_line = line;
            }
        }
    }
}

/// Prettier's `parseValue`, and `calculateLoc` for its result. `root_offset`: where Prettier takes
/// `value` to start in the style sheet.
///
/// An error is one that Prettier does not catch: a `)` without a `(`.
pub(crate) fn parse_value<'a>(value: Cow<'a, [u8]>, syntax: Syntax, root_offset: u32) -> Result<ValueNode<'a>, ParseError> {
    // Inline JavaScript in Less.
    if syntax == Syntax::Less && value.starts_with(b"~`") {
        return Ok(unknown(value, root_offset));
    }
    let borrowed = match &value {
        Cow::Borrowed(text) => Some(*text),
        Cow::Owned(_) => None,
    };
    let parsed = (|| {
        let mut parser = ValuesParser {
            text: &value,
            borrowed,
            tokens: tokenize(&value)?,
            position: 0,
            nodes: Vec::new(),
            current: 0,
            cache: Vec::new(),
            spaces: None,
        };
        // The `Value`, which is the only node of the root.
        parser.nodes.push(RawNode {
            node: ValueNode::without_loc(ValueKind::Comma),
            nodes: Vec::new(),
            is_func: false,
            unbalanced: Some(0),
        });
        parser.parse()?;
        Ok::<_, ParseError>(parser.nodes)
    })();
    let Ok(mut nodes) = parsed else {
        return Ok(unknown(value, root_offset));
    };
    let grouper = Grouper {
        text: &value,
        borrowed,
        syntax,
        is_unbalanced: std::cell::Cell::new(false),
    };
    let children = grouper.children(&mut nodes, 0);
    let group = flatten_groups(grouper.parse_value_node(children));
    let inner = ValueNode::without_loc(ValueKind::Value { group: Box::new(group) });
    let mut root = ValueNode::without_loc(ValueKind::Root { group: Box::new(inner) });
    root.loc.start_offset = Some(root_offset);
    root.loc.end_offset = Some(root_offset + value.len() as u32);
    calculate_loc(&mut root, &value, root_offset);
    match grouper.is_unbalanced.get() {
        true => Err(ParseError),
        false => Ok(root),
    }
}

pub(crate) fn unknown(value: Cow<'_, [u8]>, root_offset: u32) -> ValueNode<'_> {
    let mut node = ValueNode::without_loc(ValueKind::Unknown(Cow::Borrowed(b"")));
    node.loc.start_offset = Some(root_offset);
    node.loc.end_offset = Some(root_offset + value.len() as u32);
    node.kind = ValueKind::Unknown(value);
    node
}
