//! `postcss-values-parser` 2.0.1 in loose mode (`lib/tokenize.js`, `lib/parser.js`), and what
//! Prettier makes of its result (`parse/parse-value.js`).
//!
//! The positions that the parser gives its nodes are wrong in several ways. They are kept that way,
//! since Prettier goes by them.

use super::Parser as Syntax;
use super::misc::is_space;
use super::selector_parser::{SelectorId, Selectors};
use crate::text::{self, ByteSet};

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

/// The index of the first character from `from` on that ends a word. A `/` does if `slash` says so,
/// given what follows it.
fn word_end(
    css: &[u8],
    from: usize,
    set: &ByteSet,
    slash: impl Fn(Option<&u8>) -> bool,
) -> Option<usize> {
    let mut at = from;
    loop {
        at = set.find(css, at)?;
        if css[at] != b'/' || slash(css.get(at + 1)) {
            return Some(at);
        }
        at += 1;
    }
}

static WORD_END: ByteSet = ByteSet::new(b" \n\t\r(){}*:;@!&'\"+|~>,[]\\/");
static WORD_END_NUM: ByteSet = ByteSet::new(b" \n\t\r(){}*:;@!&'\"-+|~>,[]\\/");
static AT_END: ByteSet = ByteSet::new(b" \n\t\r{()'\"\\;,/");

fn tokenize(css: &[u8], tokens: &mut Vec<Token>) -> Result<(), ParseError> {
    tokens.clear();
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
                        last.kind == TokenKind::Word
                            && &css[last.pos as usize..last.end as usize] == b"url"
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
                    let backslashes = css[..close]
                        .iter()
                        .rev()
                        .take_while(|&&b| b == b'\\')
                        .count();
                    if backslashes % 2 == 0 {
                        break;
                    }
                }
                (kind, end, next) = (TokenKind::String, close + 1, close);
            }
            b'@' => {
                let at = AT_END.find(css, pos + 1).unwrap_or(length);
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
            b'/' if css.get(pos + 1) == Some(&b'*')
                || (!is_url_arg && css.get(pos + 1) == Some(&b'/')) =>
            {
                let last = if css[pos + 1] == b'*' {
                    text::index_of_from(css, b"*/", pos + 2).ok_or(ParseError)? + 1
                } else {
                    text::index_of_char_from(css, b'\n', pos + 2).map_or(length, |at| at - 1)
                };
                let content = &css[pos..(last + 1).min(length)];
                let lines = bun_core::strings::count_char(content, b'\n') as u32;
                if lines > 0 {
                    let last_line_len = content.len()
                        - 1
                        - bun_core::strings::last_index_of_char(content, b'\n').unwrap_or(0);
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
                while at < length && (css[at].is_ascii_hexdigit() || matches!(css[at], b'?' | b'-'))
                {
                    at += 1;
                }
                let at = at.min(length.max(pos + 3));
                (kind, end, next) = (TokenKind::UnicodeRange, at.min(length), at);
            }
            b'/' => (kind, end, next) = (TokenKind::Operator, pos + 1, pos + 1),
            _ => {
                let is_number = code.is_ascii_digit();
                let find = |from: usize, is_number: bool| match is_number {
                    true => word_end(css, from, &WORD_END_NUM, |_| true),
                    false => word_end(css, from, &WORD_END, |after| after == Some(&b'*')),
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
            line: if kind == TokenKind::Space {
                line
            } else {
                start_line
            },
            column: start_column,
            end_line: line,
            end_column: column(next, offset),
        });
        pos = end;
    }
    Ok(())
}

/// `source` and `sourceIndex`, and what Prettier's `calculateLoc` makes of them.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Loc {
    /// `NONE`: there is none. The same for the others.
    source_index: u32,
    start_line: u32,
    start_offset: u32,
    end_offset: u32,
}

const NONE: u32 = u32::MAX;

impl Default for Loc {
    fn default() -> Self {
        Loc {
            source_index: NONE,
            start_line: NONE,
            start_offset: NONE,
            end_offset: NONE,
        }
    }
}

impl Loc {
    fn source_index(&self) -> Option<u32> {
        Some(self.source_index).filter(|&it| it != NONE)
    }

    /// `source.start.line`
    pub(crate) fn start_line(&self) -> Option<u32> {
        Some(self.start_line).filter(|&it| it != NONE)
    }

    pub(crate) fn start_offset(&self) -> Option<u32> {
        Some(self.start_offset).filter(|&it| it != NONE)
    }

    pub(crate) fn end_offset(&self) -> Option<u32> {
        Some(self.end_offset).filter(|&it| it != NONE)
    }
}

/// What the parser says of where a node is.
#[derive(Copy, Clone)]
struct Source {
    index: u32,
    start_line: u32,
    /// The line and the column.
    end: (u32, u32),
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum ValueKind {
    /// It has a `group`.
    Root,
    /// It has a `group`.
    Value,
    Word,
    Number,
    String,
    Operator,
    Colon,
    Comma,
    Comment,
    /// It has a `group`.
    Func,
    Paren,
    AtWord,
    UnicodeRange,
    ParenGroup,
    CommaGroup,
    /// A string in the `groups` of the parentheses of `url()`.
    Text,
    /// What is in the parentheses of `selector()`.
    Selector,
    /// `value-unknown`
    Unknown,
}

/// `raws.before`
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Before {
    /// A group has no `raws`.
    None,
    Empty,
    Spaces,
}

/// A range of `Values::text`.
pub(crate) type Span = (u32, u32);

/// An index into `Values::nodes`. 0: there is none.
pub(crate) type ValueId = u32;

#[derive(Debug, Copy, Clone)]
pub(crate) struct ValueNode {
    pub(crate) kind: ValueKind,
    /// The first byte of `value`, or 0.
    pub(crate) first_byte: u8,
    /// `value`, if it is a string.
    value: Span,
    /// Of a number.
    pub(crate) unit: Span,
    /// Of a word.
    pub(crate) is_hex: bool,
    pub(crate) is_color: bool,
    /// Of a comment.
    pub(crate) inline: bool,
    pub(crate) before: Before,
    pub(crate) group: ValueId,
    /// Of a `value-paren_group`.
    pub(crate) open: ValueId,
    pub(crate) close: ValueId,
    /// `groups`: a range of `Values::lists`.
    groups: (u32, u32),
    pub(crate) selector: SelectorId,
    pub(crate) loc: Loc,
    /// Whether there is a `source.end`.
    has_end: bool,
    /// For the parser: the nodes of a container, what follows in the container that it is in, and `unbalanced`.
    first_child: ValueId,
    last_child: ValueId,
    next_sibling: ValueId,
    /// `NO_BALANCE`: it has no such property.
    unbalanced: i32,
}

const NO_BALANCE: i32 = i32::MIN;

impl ValueNode {
    fn new(kind: ValueKind) -> Self {
        ValueNode {
            kind,
            first_byte: 0,
            value: (0, 0),
            unit: (0, 0),
            is_hex: false,
            is_color: false,
            inline: false,
            before: Before::None,
            group: 0,
            open: 0,
            close: 0,
            groups: (0, 0),
            selector: 0,
            loc: Loc::default(),
            has_end: false,
            first_child: 0,
            last_child: 0,
            next_sibling: 0,
            unbalanced: NO_BALANCE,
        }
    }

    /// Whether it has a `source`, after `calculateLoc`.
    pub(crate) fn has_source(&self) -> bool {
        self.loc.start_offset != NONE || self.has_end
    }

    /// A group with nothing in it, which nothing says where it is.
    fn is_empty_group(&self) -> bool {
        matches!(self.kind, ValueKind::ParenGroup | ValueKind::CommaGroup)
            && self.groups.0 == self.groups.1
            && !self.has_source()
    }

    /// `fillEmptyLocFromParent`
    fn fill_empty_loc(&mut self, parent: &Loc) {
        if self.is_empty_group() && parent.end_offset != NONE {
            self.loc.start_offset = parent.start_offset;
            self.loc.end_offset = parent.start_offset;
            self.loc.start_line = parent.start_line;
        }
    }
}

/// A node of `values`.
#[derive(Copy, Clone)]
pub(crate) struct ValueRef<'v> {
    pub(crate) values: &'v Values,
    pub(crate) id: ValueId,
}

impl<'v> ValueRef<'v> {
    pub(crate) fn node(self) -> &'v ValueNode {
        self.values.node(self.id)
    }

    pub(crate) fn kind(self) -> ValueKind {
        self.node().kind
    }

    /// `node.value`, if it is a string.
    pub(crate) fn value(self) -> Option<&'v [u8]> {
        self.values.value(self.id)
    }

    /// Another node of the same values.
    pub(crate) fn at(self, id: ValueId) -> ValueRef<'v> {
        ValueRef { id, ..self }
    }

    /// `node.groups`, or nothing if it has none.
    pub(crate) fn groups(
        self,
    ) -> impl DoubleEndedIterator<Item = ValueRef<'v>> + ExactSizeIterator + Clone {
        self.values
            .groups(self.id)
            .iter()
            .map(move |&id| self.at(id))
    }

    /// `node.groups[index]`
    pub(crate) fn group(self, index: usize) -> Option<ValueRef<'v>> {
        self.values
            .groups(self.id)
            .get(index)
            .map(|&id| self.at(id))
    }
}

/// The parentheses that are open while the nodes of a container are grouped.
#[derive(Copy, Clone)]
struct OpenParen {
    open: ValueId,
    /// Where its groups start in `Values::groups`, and the nodes of its last group in `Values::group`.
    groups_start: usize,
    group_start: usize,
}

/// The values that have been parsed, and what it takes to parse the next one.
#[derive(Default)]
pub(crate) struct Values {
    /// The texts of the values, and the strings that are not a part of them.
    text: Vec<u8>,
    nodes: Vec<ValueNode>,
    lists: Vec<ValueId>,
    tokens: Vec<Token>,
    /// `cache` of the parser.
    cache: Vec<ValueId>,
    open_parens: Vec<OpenParen>,
    groups: Vec<ValueId>,
    group: Vec<ValueId>,
}

/// `/^[+-]?((\d+(\.\d*)?)|(\.\d+))([eE][+-]?\d+)?/`: the length of the match.
fn number_prefix_len(text: &[u8]) -> Option<usize> {
    let digits = |from: usize| {
        text[from.min(text.len())..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count()
    };
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

struct ValuesParser<'t> {
    values: &'t mut Values,
    /// Where the text of the value starts in `Values::text`, which all positions count from.
    base: usize,
    len: usize,
    /// Where Prettier takes the value to start in the style sheet.
    root_offset: u32,
    position: usize,
    current: ValueId,
    spaces: bool,
}

impl ValuesParser<'_> {
    fn text(&self) -> &[u8] {
        &self.values.text[self.base..self.base + self.len]
    }

    fn span(&self, start: usize, end: usize) -> Span {
        ((self.base + start) as u32, (self.base + end) as u32)
    }

    fn token(&self, position: usize) -> Option<Token> {
        self.values.tokens.get(position).copied()
    }

    fn text_of(&self, token: Token) -> &[u8] {
        &self.values.text[self.base + token.pos as usize..self.base + token.end as usize]
    }

    fn node(&mut self, id: ValueId) -> &mut ValueNode {
        &mut self.values.nodes[id as usize]
    }

    fn last_of_current(&self) -> Option<ValueId> {
        Some(self.values.nodes[self.current as usize].last_child).filter(|&id| id != 0)
    }

    fn new_node(&mut self, kind: ValueKind, value: Span, source: Source) -> ValueId {
        // `calculateNodeLoc`
        let end = match source.end {
            (1, column) => column,
            end => line_column_to_index(end, self.text()),
        };
        let (start, end) = match kind {
            ValueKind::Word => {
                let value = self.values.text(value);
                (
                    fix_value_word_loc(value, source.index),
                    fix_value_word_loc(value, end),
                )
            }
            ValueKind::Paren => (
                source.index,
                source.index + u32::from(self.values.text(value) == b")"),
            ),
            _ => (source.index, end),
        };
        let max_end = self.root_offset + self.len as u32;
        let loc = Loc {
            source_index: source.index,
            start_line: source.start_line,
            start_offset: (start + self.root_offset).min(max_end),
            end_offset: (end + self.root_offset).min(max_end),
        };
        let id = self.values.nodes.len() as ValueId;
        self.values.nodes.push(ValueNode {
            first_byte: self.values.text(value).first().copied().unwrap_or(0),
            has_end: true,
            value,
            before: if std::mem::take(&mut self.spaces) {
                Before::Spaces
            } else {
                Before::Empty
            },
            loc,
            unbalanced: if kind == ValueKind::Func {
                -1
            } else {
                NO_BALANCE
            },
            ..ValueNode::new(kind)
        });
        let current = self.current;
        match std::mem::replace(&mut self.node(current).last_child, id) {
            0 => self.node(current).first_child = id,
            previous => self.node(previous).next_sibling = id,
        }
        id
    }

    /// The `source` and the `sourceIndex` that most nodes get from their token.
    fn loc_of(token: Token) -> Source {
        Source {
            index: token.pos,
            start_line: token.line,
            end: (token.end_line, token.end_column),
        }
    }

    fn parse(&mut self) -> Result<(), ParseError> {
        while let Some(token) = self.token(self.position) {
            let (start, end) = (token.pos as usize, token.end as usize);
            match token.kind {
                TokenKind::Space => self.space()?,
                TokenKind::Colon => self.simple(ValueKind::Colon, token),
                TokenKind::Comma => self.simple(ValueKind::Comma, token),
                TokenKind::Comment => {
                    // `.replace(/\/\*|\*\//g, "")`
                    let text = self.text_of(token);
                    let has_delimiter =
                        |text: &[u8]| text::includes(text, b"/*") || text::includes(text, b"*/");
                    let mut value = match text
                        .strip_prefix(b"/*")
                        .and_then(|it| it.strip_suffix(b"*/"))
                    {
                        Some(inner) if !has_delimiter(inner) => self.span(start + 2, end - 2),
                        _ if !has_delimiter(text) => self.span(start, end),
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
                            self.values.add_text(&value)
                        }
                    };
                    let inline = self.values.text(value).starts_with(b"//");
                    if inline {
                        value.0 += 2;
                    }
                    let id = self.new_node(ValueKind::Comment, value, Self::loc_of(token));
                    self.node(id).inline = inline;
                    self.position += 1;
                }
                TokenKind::OpenParen => self.paren_open(token)?,
                TokenKind::CloseParen => self.paren_close(token)?,
                TokenKind::Operator => self.operator(token)?,
                TokenKind::String => {
                    // The quotes are `raws.quote`.
                    let value = self.span(start + 1, end - 1);
                    self.new_node(ValueKind::String, value, Self::loc_of(token));
                    self.position += 1;
                }
                TokenKind::UnicodeRange => self.simple(ValueKind::UnicodeRange, token),
                _ => self.split_word(),
            }
        }
        Ok(())
    }

    /// A node whose value is the text of `token`.
    fn simple(&mut self, kind: ValueKind, token: Token) {
        let value = self.span(token.pos as usize, token.end as usize);
        self.new_node(kind, value, Self::loc_of(token));
        self.position += 1;
    }

    fn space(&mut self) -> Result<(), ParseError> {
        let next = self.token(self.position + 1);
        if next.is_none_or(|next| next.kind == TokenKind::CloseParen) {
            // It is added to the `raws.after` of the last node, which has to be there.
            self.last_of_current().ok_or(ParseError)?;
        } else {
            self.spaces = true;
        }
        self.position += 1;
        Ok(())
    }

    fn operator(&mut self, token: Token) -> Result<(), ParseError> {
        if matches!(self.text_of(token), b"+" | b"-") {
            let is_sign = match self.last_of_current() {
                None => true,
                Some(last) => self.values.nodes[last as usize].kind == ValueKind::Operator,
            };
            if is_sign && self.token(self.position + 1).ok_or(ParseError)?.kind == TokenKind::Word {
                self.split_word();
                return Ok(());
            }
        }
        let value = self.span(token.pos as usize, token.end as usize);
        let loc = Source {
            // `this.currToken[4]`, which is a line.
            index: token.end_line,
            start_line: token.line,
            end: (token.line, token.column),
        };
        self.new_node(ValueKind::Operator, value, loc);
        self.position += 1;
        Ok(())
    }

    fn paren_open(&mut self, token: Token) -> Result<(), ParseError> {
        let mut unbalanced = 1;
        for token in self
            .values
            .tokens
            .get(self.position + 1..)
            .unwrap_or_default()
        {
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
            && self.node(last).kind == ValueKind::Func
            && self.node(last).unbalanced < 0
        {
            self.node(last).unbalanced = 0;
            self.current = last;
        }
        let current = self.current;
        let current = self.node(current);
        if current.unbalanced != NO_BALANCE {
            current.unbalanced += 1;
        }
        self.simple(ValueKind::Paren, token);
        Ok(())
    }

    fn paren_close(&mut self, token: Token) -> Result<(), ParseError> {
        self.simple(ValueKind::Paren, token);
        let is_zero = |unbalanced: i32| unbalanced == NO_BALANCE || unbalanced == 0;
        let current = self.current;
        if self.position + 1 >= self.values.tokens.len() && is_zero(self.node(current).unbalanced) {
            return Ok(());
        }
        let current = self.node(current);
        if current.unbalanced != NO_BALANCE {
            current.unbalanced -= 1;
            if current.unbalanced < 0 {
                return Err(ParseError);
            }
        }
        if is_zero(current.unbalanced)
            && let Some(outer) = self.values.cache.pop()
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
        // `/^(?!#([a-z0-9]+))[#{}]/i`
        let no_follow = match self.text_of(first) {
            [b'{' | b'}', ..] => true,
            [b'#', rest @ ..] => !rest.first().is_some_and(u8::is_ascii_alphanumeric),
            _ => false,
        };
        if !no_follow {
            while self
                .token(self.position + 1)
                .is_some_and(|next| next.kind == TokenKind::Word)
            {
                self.position += 1;
            }
        }
        // The positions are taken from the last token, as if the word started there.
        let Some(current) = self.token(self.position) else {
            return;
        };
        let next_is_paren = self
            .token(self.position + 1)
            .is_some_and(|next| next.kind == TokenKind::OpenParen);
        let word_len = current.end as usize - word_start;
        let is_number = number_prefix_len(self.text_of(current)).is_some();

        // It is split before every `@` but one at the start.
        let mut ind = 0;
        loop {
            let word = &self.text()[word_start..word_start + word_len];
            static AT: ByteSet = ByteSet::new(b"@");
            let index = AT.find(word, ind + 1).unwrap_or(word_len);
            let value = &word[ind..index];
            let (start, end) = (word_start + ind, word_start + index);
            let loc = Source {
                index: current.pos + ind as u32,
                start_line: current.line,
                end: (
                    current.end_line,
                    (current.column + index as u32).saturating_sub(1),
                ),
            };
            if value.starts_with(b"@") {
                let value = self.span(start + 1, end);
                self.new_node(ValueKind::AtWord, value, loc);
            } else if is_number {
                let unit_start = number_prefix_len(value).unwrap_or(0);
                let unit = &value[unit_start..];
                // `value.replace(unit, "")` removes the first occurrence, wherever it is.
                // It can only start earlier with what can be in a number.
                let is_elsewhere = matches!(
                    unit.first(),
                    Some(b'+' | b'-' | b'.' | b'e' | b'E' | b'0'..=b'9')
                );
                let number = match if is_elsewhere {
                    bun_core::strings::index_of(value, unit)
                } else {
                    None
                } {
                    Some(at) if !unit.is_empty() && at != unit_start => {
                        let number = [&value[..at], &value[at + unit.len()..]].concat();
                        self.values.add_text(&number)
                    }
                    _ => self.span(start, start + unit_start),
                };
                let id = self.new_node(ValueKind::Number, number, loc);
                self.node(id).unit = self.span(start + unit_start, end);
            } else if next_is_paren {
                let value = self.span(start, end);
                self.values.cache.push(self.current);
                self.new_node(ValueKind::Func, value, loc);
            } else {
                let is_hex = value.len() > 1 && value[0] == b'#';
                let is_color = is_hex
                    && matches!(value.len(), 4 | 5 | 7 | 9)
                    && value[1..].iter().all(u8::is_ascii_hexdigit);
                let value = self.span(start, end);
                let id = self.new_node(ValueKind::Word, value, loc);
                self.node(id).is_hex = is_hex;
                self.node(id).is_color = is_color;
            }
            if index == word_len {
                break;
            }
            ind = index;
        }
        self.position += 1;
    }
}

// ───────────────────────────── Prettier's `parse-value.js` ─────────────────────────────

/// What is looked at of a node to put it into a group.
struct NodeToGroup {
    kind: ValueKind,
    first_byte: u8,
    value: Span,
    unit: Span,
    group: ValueId,
}

struct Grouper<'t> {
    values: &'t mut Values,
    selectors: &'t mut Selectors,
    /// Where the text of the value starts in `Values::text`.
    base: usize,
    syntax: Syntax,
    is_unbalanced: bool,
}

impl Grouper<'_> {
    fn node(&self, id: ValueId) -> &ValueNode {
        &self.values.nodes[id as usize]
    }

    fn add(&mut self, node: &ValueNode) -> ValueId {
        self.values.nodes.push(*node);
        (self.values.nodes.len() - 1) as ValueId
    }

    /// Adds a group, which is where the nodes in it are: `fillLocFromChildren`, `fillEmptyChildLocs`.
    fn add_group(&mut self, node: &ValueNode) -> ValueId {
        let mut node = *node;
        let (nodes, lists) = (&mut self.values.nodes, &self.values.lists);
        let children = || {
            let groups = lists
                .get(node.groups.0 as usize..node.groups.1 as usize)
                .unwrap_or_default();
            [node.open, node.close]
                .into_iter()
                .filter(|&id| id != 0)
                .chain(groups.iter().copied())
        };
        let mut has_empty_group = false;
        for child in children() {
            let child = &nodes[child as usize];
            has_empty_group |= child.is_empty_group();
            let (start, end) = (child.loc.start_offset, child.loc.end_offset);
            if start != NONE && end != NONE {
                // The first time, it is before `NONE`.
                if start < node.loc.start_offset {
                    node.loc.start_line = child.loc.start_line;
                    node.loc.start_offset = start;
                }
                if node.loc.end_offset == NONE || end > node.loc.end_offset {
                    node.loc.end_offset = end;
                }
            }
        }
        if has_empty_group && node.loc.start_offset != NONE {
            for child in children() {
                nodes[child as usize].fill_empty_loc(&node.loc);
            }
        }
        self.add(&node)
    }

    /// What is between the parentheses of the function whose `group` is `group`, counted from the start of the
    /// value.
    fn arguments_range(&self, group: ValueId) -> Option<(usize, usize)> {
        let group = self.node(group);
        if group.kind != ValueKind::ParenGroup || group.open == 0 || group.close == 0 {
            return None;
        }
        Some((
            self.node(group.open).loc.source_index()? as usize + 1,
            self.node(group.close).loc.source_index()? as usize,
        ))
    }

    /// A `value-comma_group` of `self.values.group[start..]`, after `flattenGroups`: if it is only one, that is it.
    fn take_comma_group(&mut self, start: usize) -> ValueId {
        if let [only] = self.values.group[start..] {
            self.values.group.truncate(start);
            return only;
        }
        let groups = self.values.add_list_from_group(start);
        self.add_group(&ValueNode {
            groups,
            ..ValueNode::new(ValueKind::CommaGroup)
        })
    }

    /// `parseNestedValue` and `parseValueNode` for the container `id`, and `flattenGroups` for the result.
    fn group_nodes_of(&mut self, id: ValueId) -> ValueId {
        // A group of one node is that node.
        let only = self.node(self.node(id).first_child);
        if only.next_sibling == 0
            && matches!(
                only.kind,
                ValueKind::Word | ValueKind::String | ValueKind::AtWord | ValueKind::Operator
            )
        {
            return self.node(id).first_child;
        }
        // The functions in it first.
        let mut child = self.node(id).first_child;
        while child != 0 {
            if self.node(child).kind == ValueKind::Func {
                let group = self.group_nodes_of(child);
                self.values.nodes[child as usize].group = group;
                let loc = self.node(child).loc;
                self.values.nodes[group as usize].fill_empty_loc(&loc);
            }
            child = self.node(child).next_sibling;
        }
        // How many there are, and the last two.
        let (mut len, mut last, mut before_last) = (0usize, 0, 0);
        let mut child = self.node(id).first_child;
        while child != 0 {
            len += 1;
            (before_last, last) = (last, child);
            child = self.node(child).next_sibling;
        }
        // Whether a comma is followed by a comment and the `)` that ends the list.
        let ends_with_comment_and_paren = len >= 3
            && self.node(before_last).kind == ValueKind::Comment
            && self.node(last).kind == ValueKind::Paren
            && self.node(last).first_byte == b')';

        let (parens_start, groups_start, group_start) = (
            self.values.open_parens.len(),
            self.values.groups.len(),
            self.values.group.len(),
        );
        self.values.open_parens.push(OpenParen {
            open: 0,
            groups_start,
            group_start,
        });

        let mut next = self.node(id).first_child;
        for i in 0..len {
            let id = next;
            let node = self.node(id);
            next = node.next_sibling;
            let node = NodeToGroup {
                kind: node.kind,
                first_byte: node.first_byte,
                value: node.value,
                unit: node.unit,
                group: node.group,
            };
            if self.syntax == Syntax::Scss
                && node.kind == ValueKind::Number
                && self.values.text(node.unit) == b".."
                && self.values.text(node.value).ends_with(b".")
            {
                let unit = self.values.add_text(b"...");
                let node = &mut self.values.nodes[id as usize];
                node.value.1 -= 1;
                node.unit = unit;
            }

            if node.kind == ValueKind::Func {
                let (is_selector, is_url) = (
                    self.values.text(node.value) == b"selector",
                    self.values.text(node.value) == b"url",
                );
                if is_selector && let Some((start, end)) = self.arguments_range(node.group) {
                    let text = self
                        .values
                        .text
                        .get(self.base + start..self.base + end)
                        .unwrap_or_default();
                    let selector = self.selectors.parse(text);
                    let mut selector = ValueNode {
                        selector,
                        ..ValueNode::new(ValueKind::Selector)
                    };
                    selector.loc.source_index = start as u32;
                    let selector = self.add(&selector);
                    self.values.nodes[node.group as usize].groups =
                        self.values.add_list(&[selector]);
                }
                if is_url && self.node(node.group).kind == ValueKind::ParenGroup {
                    let range = self.arguments_range(node.group);
                    // What is in the parentheses, and in the groups there.
                    let mut has_interpolation = false;
                    let mut has_string_or_function = false;
                    let mut first = None;
                    let mut previous: Option<ValueId> = None;
                    let mut look_at = |values: &Values, id: ValueId| {
                        let node = values.node(id);
                        let is_word = node.kind == ValueKind::Word;
                        has_interpolation |= is_word
                            && values.text(node.value) == b"{"
                            && previous.is_some_and(|it| {
                                values.node(it).kind == ValueKind::Word
                                    && values.text(values.node(it).value).ends_with(b"#")
                            });
                        has_string_or_function |= match node.kind {
                            ValueKind::String => true,
                            ValueKind::Func => !values.text(node.value).ends_with(b"\\"),
                            _ => false,
                        };
                        first = first.or(Some(id));
                        previous = Some(id);
                    };
                    for &group in self.values.groups(node.group) {
                        match self.node(group).kind {
                            ValueKind::CommaGroup => self
                                .values
                                .groups(group)
                                .iter()
                                .for_each(|&id| look_at(self.values, id)),
                            _ => look_at(self.values, group),
                        }
                    }
                    let is_scss_variable = self.syntax == Syntax::Scss
                        && first.is_some_and(|it| {
                            self.node(it).kind == ValueKind::Word
                                && self.values.text(self.node(it).value).starts_with(b"$")
                        });
                    if (has_interpolation || (!has_string_or_function && !is_scss_variable))
                        && let Some((start, end)) = range
                    {
                        let inner = self
                            .values
                            .text
                            .get(self.base + start..self.base + end)
                            .unwrap_or_default();
                        let skipped = inner.len() - text::trim_start(inner).len();
                        let start = self.base + start + skipped;
                        let text = self.add(&ValueNode {
                            value: (start as u32, (start + text::trim(inner).len()) as u32),
                            ..ValueNode::new(ValueKind::Text)
                        });
                        self.values.nodes[node.group as usize].groups =
                            self.values.add_list(&[text]);
                    }
                }
            }

            match node.kind {
                ValueKind::Paren if node.first_byte == b'(' => {
                    self.values.open_parens.push(OpenParen {
                        open: id,
                        groups_start: self.values.groups.len(),
                        group_start: self.values.group.len(),
                    });
                }
                ValueKind::Paren => {
                    if self.values.open_parens.len() < parens_start + 2 {
                        self.is_unbalanced = true;
                        continue;
                    }
                    let Some(paren) = self.values.open_parens.pop() else {
                        continue;
                    };
                    if self.values.group.len() > paren.group_start {
                        let last = self.take_comma_group(paren.group_start);
                        self.values.groups.push(last);
                    }
                    let groups = self.values.add_list_from_groups(paren.groups_start);
                    let group = self.add_group(&ValueNode {
                        open: paren.open,
                        close: id,
                        groups,
                        ..ValueNode::new(ValueKind::ParenGroup)
                    });
                    self.values.group.push(group);
                }
                ValueKind::Comma => {
                    if i + 3 == len && ends_with_comment_and_paren {
                        continue;
                    }
                    if let Some(paren) = self.values.open_parens.last().copied() {
                        let group = self.take_comma_group(paren.group_start);
                        self.values.groups.push(group);
                    }
                }
                _ => self.values.group.push(id),
            }
        }
        // An unclosed parenthesis cannot get here: its groups would be lost, as in Prettier.
        if let Some(paren) = self.values.open_parens.last().copied()
            && self.values.group.len() > paren.group_start
        {
            let last = self.take_comma_group(paren.group_start);
            self.values.groups.push(last);
        }
        self.values.open_parens.truncate(parens_start);
        self.values.group.truncate(group_start);
        if let [only] = self.values.groups[groups_start..] {
            self.values.groups.truncate(groups_start);
            return only;
        }
        let groups = self.values.add_list_from_groups(groups_start);
        self.add_group(&ValueNode {
            groups,
            ..ValueNode::new(ValueKind::ParenGroup)
        })
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

impl Values {
    /// Forgets all values.
    pub(crate) fn clear(&mut self) {
        self.text.clear();
        self.nodes.clear();
        self.lists.clear();
    }

    pub(crate) fn node(&self, id: ValueId) -> &ValueNode {
        &self.nodes[id as usize]
    }

    pub(crate) fn text(&self, (start, end): Span) -> &[u8] {
        self.text
            .get(start as usize..end as usize)
            .unwrap_or_default()
    }

    /// `node.value`, if it is a string.
    pub(crate) fn value(&self, id: ValueId) -> Option<&[u8]> {
        let node = self.node(id);
        match node.kind {
            ValueKind::Root
            | ValueKind::Value
            | ValueKind::ParenGroup
            | ValueKind::CommaGroup
            | ValueKind::Text
            | ValueKind::Selector => None,
            _ => Some(self.text(node.value)),
        }
    }

    /// A string with its quotes.
    pub(crate) fn raw_string(&self, id: ValueId) -> &[u8] {
        let (start, end) = self.node(id).value;
        self.text((start.saturating_sub(1), end + 1))
    }

    /// The text of a `ValueKind::Text`.
    pub(crate) fn text_of(&self, id: ValueId) -> &[u8] {
        self.text(self.node(id).value)
    }

    /// `node.groups`, or nothing if it has none.
    pub(crate) fn groups(&self, id: ValueId) -> &[ValueId] {
        let (start, end) = self.node(id).groups;
        self.lists
            .get(start as usize..end as usize)
            .unwrap_or_default()
    }

    fn add_text(&mut self, text: &[u8]) -> Span {
        let start = self.text.len() as u32;
        self.text.extend_from_slice(text);
        (start, self.text.len() as u32)
    }

    fn add_list(&mut self, ids: &[ValueId]) -> (u32, u32) {
        let start = self.lists.len() as u32;
        self.lists.extend_from_slice(ids);
        (start, self.lists.len() as u32)
    }

    fn add_list_from_group(&mut self, from: usize) -> (u32, u32) {
        let start = self.lists.len() as u32;
        self.lists.extend(self.group.drain(from..));
        (start, self.lists.len() as u32)
    }

    fn add_list_from_groups(&mut self, from: usize) -> (u32, u32) {
        let start = self.lists.len() as u32;
        self.lists.extend(self.groups.drain(from..));
        (start, self.lists.len() as u32)
    }

    /// `value-unknown`
    pub(crate) fn unknown(&mut self, value: &[u8], root_offset: u32) -> ValueId {
        if self.nodes.is_empty() {
            self.nodes.push(ValueNode::new(ValueKind::Unknown));
        }
        let mut node = ValueNode {
            value: self.add_text(value),
            ..ValueNode::new(ValueKind::Unknown)
        };
        node.loc.start_offset = root_offset;
        node.loc.end_offset = root_offset + value.len() as u32;
        self.nodes.push(node);
        (self.nodes.len() - 1) as ValueId
    }

    /// Prettier's `parseValue`, and `calculateLoc` for its result. `root_offset`: where Prettier takes
    /// `value` to start in the style sheet.
    ///
    /// An error is one that Prettier does not catch: a `)` without a `(`.
    pub(crate) fn parse(
        &mut self,
        value: &[u8],
        syntax: Syntax,
        root_offset: u32,
        selectors: &mut Selectors,
    ) -> Result<ValueId, ParseError> {
        // Inline JavaScript in Less.
        if syntax == Syntax::Less && value.starts_with(b"~`") {
            return Ok(self.unknown(value, root_offset));
        }
        if self.nodes.is_empty() {
            self.nodes.push(ValueNode::new(ValueKind::Unknown));
        }
        let (base, first_node) = (self.text.len(), self.nodes.len());
        self.text.extend_from_slice(value);
        self.cache.clear();
        // The `Value`, which is the only node of the root.
        let container = first_node as ValueId;
        self.nodes.push(ValueNode {
            unbalanced: 0,
            ..ValueNode::new(ValueKind::Value)
        });
        let parsed = tokenize(value, &mut self.tokens).and_then(|()| {
            ValuesParser {
                values: self,
                base,
                len: value.len(),
                root_offset,
                position: 0,
                current: container,
                spaces: false,
            }
            .parse()
        });
        if parsed.is_err() {
            self.text.truncate(base);
            self.nodes.truncate(first_node);
            return Ok(self.unknown(value, root_offset));
        }
        let mut grouper = Grouper {
            values: self,
            selectors,
            base,
            syntax,
            is_unbalanced: false,
        };
        let group = grouper.group_nodes_of(container);
        let is_unbalanced = grouper.is_unbalanced;
        // `fillLocFromChildren`
        let loc = self.nodes[group as usize].loc;
        let loc = Loc {
            source_index: NONE,
            ..if loc.start_offset != NONE && loc.end_offset != NONE {
                loc
            } else {
                Loc::default()
            }
        };
        self.nodes[container as usize].group = group;
        self.nodes[container as usize].loc = loc;
        let mut root = ValueNode {
            group: container,
            ..ValueNode::new(ValueKind::Root)
        };
        root.loc.start_line = loc.start_line;
        root.loc.start_offset = root_offset;
        root.loc.end_offset = root_offset + value.len() as u32;
        self.nodes.push(root);
        let root = (self.nodes.len() - 1) as ValueId;
        match is_unbalanced {
            true => Err(ParseError),
            false => Ok(root),
        }
    }
}
