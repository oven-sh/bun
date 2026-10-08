//! `yaml` 2.9: `parse/parser.js`, which makes a concrete syntax tree of what the lexer finds.
//!
//! An error token makes the composer report an error, and Prettier rejects a text with an error. So
//! here the first one ends the parsing.

use super::lexer::{Lexeme, LexemeKind};
use crate::text::BOM;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum TokenType {
    ByteOrderMark,
    DocMode,
    FlowErrorEnd,
    Scalar,
    DocStart,
    DocEnd,
    Newline,
    SeqItemInd,
    ExplicitKeyInd,
    MapValueInd,
    FlowMapStart,
    FlowMapEnd,
    FlowSeqStart,
    FlowSeqEnd,
    Comma,
    Space,
    Comment,
    DirectiveLine,
    Alias,
    Anchor,
    Tag,
    SingleQuotedScalar,
    DoubleQuotedScalar,
    BlockScalarHeader,
}

/// `tokenType`
fn token_type(source: &[u8]) -> Option<TokenType> {
    use TokenType::*;
    Some(match source {
        b"---" => DocStart,
        b"..." => DocEnd,
        b"" | b"\n" => Newline,
        b"-" => SeqItemInd,
        b"?" => ExplicitKeyInd,
        b":" => MapValueInd,
        b"{" => FlowMapStart,
        b"}" => FlowMapEnd,
        b"[" => FlowSeqStart,
        b"]" => FlowSeqEnd,
        b"," => Comma,
        b"\x02" => DocMode,
        b"\x18" => FlowErrorEnd,
        b"\x1f" => Scalar,
        _ if source == BOM => ByteOrderMark,
        [b' ' | b'\t', ..] => Space,
        [b'#', ..] => Comment,
        [b'%', ..] => DirectiveLine,
        [b'*', ..] => Alias,
        [b'&', ..] => Anchor,
        [b'!', ..] => Tag,
        [b'\'', ..] => SingleQuotedScalar,
        [b'"', ..] => DoubleQuotedScalar,
        [b'|' | b'>', ..] => BlockScalarHeader,
        _ => return None,
    })
}

#[derive(Debug, Copy, Clone)]
pub(crate) struct SourceToken {
    pub(crate) kind: TokenType,
    pub(crate) offset: u32,
    pub(crate) indent: u32,
    /// `offset + source.length`
    pub(crate) end: u32,
}

impl SourceToken {
    pub(crate) fn source(self, text: &[u8]) -> &[u8] {
        text.get(self.offset as usize..self.end as usize)
            .unwrap_or_default()
    }

    pub(crate) fn len(self) -> u32 {
        self.end - self.offset
    }
}

/// An item of a collection.
#[derive(Debug, Default)]
pub(crate) struct Item {
    pub(crate) start: Vec<SourceToken>,
    pub(crate) explicit_key: bool,
    pub(crate) key: Option<Box<Token>>,
    pub(crate) sep: Option<Vec<SourceToken>>,
    pub(crate) value: Option<Box<Token>>,
}

#[derive(Debug)]
pub(crate) enum Token {
    /// A byte order mark, a space, a comment or a line break outside of documents.
    Source(SourceToken),
    Directive(SourceToken),
    Document {
        offset: u32,
        start: Vec<SourceToken>,
        value: Option<Box<Token>>,
        end: Option<Vec<SourceToken>>,
    },
    DocEnd {
        token: SourceToken,
        end: Option<Vec<SourceToken>>,
    },
    /// An alias, or a scalar that is not a block scalar.
    FlowScalar {
        token: SourceToken,
        end: Option<Vec<SourceToken>>,
    },
    BlockScalar {
        offset: u32,
        indent: u32,
        props: Vec<SourceToken>,
        /// Where the text is.
        source: (u32, u32),
    },
    BlockMap {
        offset: u32,
        indent: u32,
        items: Vec<Item>,
    },
    BlockSeq {
        offset: u32,
        indent: u32,
        items: Vec<Item>,
    },
    FlowCollection {
        offset: u32,
        indent: u32,
        start: SourceToken,
        items: Vec<Item>,
        end: Vec<SourceToken>,
    },
}

impl Token {
    pub(crate) fn offset(&self) -> u32 {
        match self {
            Token::Source(token)
            | Token::Directive(token)
            | Token::DocEnd { token, .. }
            | Token::FlowScalar { token, .. } => token.offset,
            Token::Document { offset, .. }
            | Token::BlockScalar { offset, .. }
            | Token::BlockMap { offset, .. }
            | Token::BlockSeq { offset, .. }
            | Token::FlowCollection { offset, .. } => *offset,
        }
    }

    /// `"indent" in token ? token.indent : undefined`
    pub(crate) fn indent(&self) -> Option<u32> {
        match self {
            Token::FlowScalar { token, .. } => Some(token.indent),
            Token::BlockScalar { indent, .. }
            | Token::BlockMap { indent, .. }
            | Token::BlockSeq { indent, .. }
            | Token::FlowCollection { indent, .. } => Some(*indent),
            _ => None,
        }
    }

    /// `isFlowToken`
    fn is_flow_token(&self) -> bool {
        matches!(
            self,
            Token::FlowScalar { .. } | Token::FlowCollection { .. }
        )
    }

    /// `token.end`, if it is an array.
    fn end_mut(&mut self) -> Option<&mut Vec<SourceToken>> {
        match self {
            Token::FlowScalar { end, .. }
            | Token::Document { end, .. }
            | Token::DocEnd { end, .. } => end.as_mut(),
            Token::FlowCollection { end, .. } => Some(end),
            _ => None,
        }
    }
}

#[derive(Debug)]
pub(crate) enum ParseError {
    Syntax,
    NestedTooDeeply,
}

/// How deep collections can be nested. What follows is recursive.
const MAX_DEPTH: usize = 100;

fn includes_token(list: &[SourceToken], kind: TokenType) -> bool {
    list.iter().any(|token| token.kind == kind)
}

fn is_empty_token(token: &SourceToken) -> bool {
    matches!(
        token.kind,
        TokenType::Space | TokenType::Comment | TokenType::Newline
    )
}

/// `getPrevProps`
fn prev_props(parent: &mut Token) -> Option<&mut Vec<SourceToken>> {
    match parent {
        Token::Document { start, .. } => Some(start),
        Token::BlockMap { items, .. } => {
            let it = items.last_mut()?;
            Some(match &mut it.sep {
                Some(sep) => sep,
                None => &mut it.start,
            })
        }
        Token::BlockSeq { items, .. } => Some(&mut items.last_mut()?.start),
        _ => None,
    }
}

/// `getFirstKeyStartProps`
fn first_key_start_props(prev: Option<&mut Vec<SourceToken>>) -> Vec<SourceToken> {
    let Some(prev) = prev else {
        return Vec::new();
    };
    use TokenType::*;
    let mut i = prev
        .iter()
        .rposition(|token| {
            matches!(
                token.kind,
                DocStart | ExplicitKeyInd | MapValueInd | SeqItemInd | Newline
            )
        })
        .map_or(0, |at| at + 1);
    while prev.get(i).is_some_and(|token| token.kind == Space) {
        i += 1;
    }
    prev.split_off(i.min(prev.len()))
}

/// `fixFlowSeqItems`
fn fix_flow_seq_items(start: SourceToken, items: &mut [Item]) {
    if start.kind != TokenType::FlowSeqStart {
        return;
    }
    for it in items {
        let is_plain_value = it.value.is_none()
            && !includes_token(&it.start, TokenType::ExplicitKeyInd)
            && it
                .sep
                .as_ref()
                .is_some_and(|sep| !includes_token(sep, TokenType::MapValueInd));
        if !is_plain_value {
            continue;
        }
        let sep = it.sep.take().unwrap_or_default();
        it.value = it.key.take();
        match it.value.as_deref_mut() {
            Some(Token::FlowScalar { end, .. }) => end.get_or_insert_default().extend(sep),
            Some(Token::FlowCollection { end, .. }) => end.extend(sep),
            _ => it.start.extend(sep),
        }
    }
}

/// What a step of the parser ends with.
enum Next {
    Done,
    /// `this.stack.push(token)`
    Push(Token),
    /// `yield* this.pop()`
    Pop,
    /// `yield* this.pop(); yield* this.step()`
    PopAndStep,
    /// Pops until the top of the stack is not a flow collection.
    PopFlowCollections,
}

struct Parser<'a> {
    text: &'a [u8],
    at_new_line: bool,
    at_scalar: bool,
    indent: u32,
    offset: u32,
    on_key_line: bool,
    stack: Vec<Token>,
    /// `this.source.length`
    source_len: u32,
    kind: TokenType,
    out: Vec<Token>,
}

type Result<T> = std::result::Result<T, ParseError>;

fn item_with_start(start: Vec<SourceToken>) -> Item {
    Item {
        start,
        ..Item::default()
    }
}

/// `{ start, key, sep }`
fn item_with_key(start: Vec<SourceToken>, key: Option<Token>, sep: Vec<SourceToken>) -> Item {
    Item {
        start,
        key: key.map(Box::new),
        sep: Some(sep),
        ..Item::default()
    }
}

impl Parser<'_> {
    fn source_token(&self) -> SourceToken {
        SourceToken {
            kind: self.kind,
            offset: self.offset,
            indent: self.indent,
            end: self.offset + self.source_len,
        }
    }

    fn next(&mut self, lexeme: Lexeme) -> Result<()> {
        let len = lexeme.end - lexeme.start;
        self.source_len = len;
        if self.at_scalar {
            self.at_scalar = false;
            self.step()?;
            self.offset += len;
            return Ok(());
        }
        let kind = match lexeme.kind {
            LexemeKind::Document => TokenType::DocMode,
            LexemeKind::FlowEnd => TokenType::FlowErrorEnd,
            LexemeKind::Scalar => TokenType::Scalar,
            LexemeKind::Text => {
                match token_type(&self.text[lexeme.start as usize..lexeme.end as usize]) {
                    // A character of the text that looks like a mark of the lexer confuses the parser.
                    None
                    | Some(TokenType::DocMode | TokenType::FlowErrorEnd | TokenType::Scalar) => {
                        return Err(ParseError::Syntax);
                    }
                    Some(kind) => kind,
                }
            }
        };
        self.kind = kind;
        if kind == TokenType::Scalar {
            self.at_new_line = false;
            self.at_scalar = true;
            return Ok(());
        }
        self.step()?;
        match kind {
            TokenType::Newline => {
                self.at_new_line = true;
                self.indent = 0;
            }
            TokenType::Space => {
                if self.at_new_line && self.text.get(lexeme.start as usize) == Some(&b' ') {
                    self.indent += len;
                }
            }
            TokenType::ExplicitKeyInd | TokenType::MapValueInd | TokenType::SeqItemInd => {
                if self.at_new_line {
                    self.indent += len;
                }
            }
            TokenType::DocMode | TokenType::FlowErrorEnd => return Ok(()),
            _ => self.at_new_line = false,
        }
        self.offset += len;
        Ok(())
    }

    fn step(&mut self) -> Result<()> {
        loop {
            if self.kind == TokenType::DocEnd
                && !matches!(self.stack.last(), Some(Token::DocEnd { .. }))
            {
                while !self.stack.is_empty() {
                    self.pop()?;
                }
                let token = self.source_token();
                self.stack.push(Token::DocEnd { token, end: None });
                return Ok(());
            }
            // While its top is looked at, the stack is not there.
            let mut stack = std::mem::take(&mut self.stack);
            let Some((top, below)) = stack.split_last_mut() else {
                return self.stream();
            };
            let next = match top {
                Token::Document { .. } => self.document(top),
                Token::FlowScalar { .. } => self.scalar(top, below.last_mut()),
                Token::BlockScalar { .. } => self.block_scalar(top),
                Token::BlockMap { .. } => self.block_map(top),
                Token::BlockSeq { .. } => self.block_sequence(top),
                Token::FlowCollection { .. } => self.flow_collection(top, below.last_mut()),
                Token::DocEnd { .. } => self.document_end(top),
                Token::Source(_) | Token::Directive(_) => Ok(Next::PopAndStep),
            };
            self.stack = stack;
            match next? {
                Next::Done => return Ok(()),
                Next::Push(token) => {
                    if self.stack.len() >= MAX_DEPTH {
                        return Err(ParseError::NestedTooDeeply);
                    }
                    self.stack.push(token);
                    return Ok(());
                }
                Next::Pop => return self.pop(),
                Next::PopAndStep => self.pop()?,
                Next::PopFlowCollections => {
                    loop {
                        self.pop()?;
                        if !matches!(self.stack.last(), Some(Token::FlowCollection { .. })) {
                            break;
                        }
                    }
                    return Ok(());
                }
            }
        }
    }

    fn pop(&mut self) -> Result<()> {
        let mut token = self.stack.pop().ok_or(ParseError::Syntax)?;
        let Some(top) = self.stack.last_mut() else {
            self.out.push(token);
            return Ok(());
        };
        match &mut token {
            // A block scalar goes by the indentation of its parent, not that of its header.
            Token::BlockScalar { indent, .. } => *indent = top.indent().unwrap_or(0),
            Token::FlowCollection {
                indent,
                start,
                items,
                ..
            } => {
                if matches!(top, Token::Document { .. }) {
                    *indent = 0;
                }
                fix_flow_seq_items(*start, items);
            }
            _ => {}
        }
        let becomes_value = match top {
            Token::Document { .. } | Token::BlockSeq { .. } => true,
            Token::BlockMap { items, .. } => items
                .last()
                .is_some_and(|it| it.value.is_none() && it.sep.is_some()),
            _ => false,
        };
        // The last item of a block collection, if it is nothing but white space and comments that are
        // not indented, belongs to what is around the collection.
        let mut moved = None;
        if becomes_value
            && let Token::BlockMap { indent, items, .. } | Token::BlockSeq { indent, items, .. } =
                &mut token
        {
            let indent = *indent;
            let is_moved = items.last().is_some_and(|last| {
                last.sep.is_none()
                    && last.value.is_none()
                    && !last.start.is_empty()
                    && last.start.iter().all(is_empty_token)
                    && (indent == 0
                        || last
                            .start
                            .iter()
                            .all(|st| st.kind != TokenType::Comment || st.indent < indent))
            });
            if is_moved {
                moved = items.pop().map(|it| it.start);
            }
        }
        let token = Box::new(token);
        match top {
            Token::Document { value, end, .. } => {
                *value = Some(token);
                if moved.is_some() {
                    *end = moved;
                }
            }
            Token::BlockMap { items, .. } => {
                let it = items.last_mut().ok_or(ParseError::Syntax)?;
                if it.value.is_some() {
                    items.push(Item {
                        key: Some(token),
                        sep: Some(Vec::new()),
                        ..Item::default()
                    });
                    self.on_key_line = true;
                } else if it.sep.is_some() {
                    it.value = Some(token);
                    items.extend(moved.map(item_with_start));
                } else {
                    it.key = Some(token);
                    it.sep = Some(Vec::new());
                    self.on_key_line = !it.explicit_key;
                }
            }
            Token::BlockSeq { items, .. } => {
                let it = items.last_mut().ok_or(ParseError::Syntax)?;
                if it.value.is_some() {
                    items.push(Item {
                        value: Some(token),
                        ..Item::default()
                    });
                } else {
                    it.value = Some(token);
                }
                items.extend(moved.map(item_with_start));
            }
            Token::FlowCollection { items, .. } => match items.last_mut() {
                Some(it) if it.value.is_none() && it.sep.is_some() => it.value = Some(token),
                Some(it) if it.value.is_none() => {
                    it.key = Some(token);
                    it.sep = Some(Vec::new());
                }
                _ => items.push(Item {
                    key: Some(token),
                    sep: Some(Vec::new()),
                    ..Item::default()
                }),
            },
            // Only an error ends up in anything else.
            _ => return Err(ParseError::Syntax),
        }
        Ok(())
    }

    fn stream(&mut self) -> Result<()> {
        let token = self.source_token();
        match self.kind {
            TokenType::DirectiveLine => self.out.push(Token::Directive(token)),
            TokenType::ByteOrderMark
            | TokenType::Space
            | TokenType::Comment
            | TokenType::Newline => {
                self.out.push(Token::Source(token));
            }
            TokenType::DocMode | TokenType::DocStart => {
                let start = if self.kind == TokenType::DocStart {
                    vec![token]
                } else {
                    Vec::new()
                };
                self.stack.push(Token::Document {
                    offset: self.offset,
                    start,
                    value: None,
                    end: None,
                });
            }
            _ => return Err(ParseError::Syntax),
        }
        Ok(())
    }

    fn document(&mut self, doc: &mut Token) -> Result<Next> {
        let token = self.source_token();
        let Token::Document { start, value, .. } = doc else {
            return Err(ParseError::Syntax);
        };
        if value.is_some() {
            return self.line_end(doc);
        }
        match self.kind {
            TokenType::DocStart => {
                if !start.iter().all(is_empty_token) {
                    return Ok(Next::PopAndStep);
                }
                start.push(token);
                return Ok(Next::Done);
            }
            TokenType::Anchor
            | TokenType::Tag
            | TokenType::Space
            | TokenType::Comment
            | TokenType::Newline => {
                start.push(token);
                return Ok(Next::Done);
            }
            _ => {}
        }
        self.start_block_value(doc)
            .map(Next::Push)
            .ok_or(ParseError::Syntax)
    }

    /// `parent`: what is below it on the stack.
    fn scalar(&mut self, scalar: &mut Token, parent: Option<&mut Token>) -> Result<Next> {
        if self.kind != TokenType::MapValueInd {
            return self.line_end(scalar);
        }
        let start = first_key_start_props(parent.and_then(prev_props));
        let mut sep = match scalar {
            Token::FlowScalar { end, .. } => end.take().unwrap_or_default(),
            _ => Vec::new(),
        };
        sep.push(self.source_token());
        self.on_key_line = true;
        let (offset, indent) = (scalar.offset(), scalar.indent().unwrap_or(0));
        let key = std::mem::replace(
            scalar,
            Token::BlockMap {
                offset,
                indent,
                items: Vec::new(),
            },
        );
        if let Token::BlockMap { items, .. } = scalar {
            items.push(item_with_key(start, Some(key), sep));
        }
        Ok(Next::Done)
    }

    fn block_scalar(&mut self, scalar: &mut Token) -> Result<Next> {
        let token = self.source_token();
        let Token::BlockScalar { props, source, .. } = scalar else {
            return Err(ParseError::Syntax);
        };
        match self.kind {
            TokenType::Space | TokenType::Comment | TokenType::Newline => {
                props.push(token);
                Ok(Next::Done)
            }
            TokenType::Scalar => {
                *source = (token.offset, token.end);
                // The text of a block scalar has the line break at its end.
                self.at_new_line = true;
                self.indent = 0;
                Ok(Next::Pop)
            }
            _ => Ok(Next::PopAndStep),
        }
    }

    /// What `blockMap` and `blockSequence` do with a comment that is indented further than the
    /// collection and comes first in the last of `items`: it goes to the end of the value before.
    fn moves_indented_comment(&self, items: &mut Vec<Item>, indent: u32) -> bool {
        let [.., prev, it] = &mut items[..] else {
            return false;
        };
        // `atIndentedComment`
        let at_indented_comment = self.kind == TokenType::Comment
            && self.indent > indent
            && it
                .start
                .iter()
                .all(|st| matches!(st.kind, TokenType::Newline | TokenType::Space));
        if !at_indented_comment {
            return false;
        }
        let Some(end) = prev.value.as_deref_mut().and_then(Token::end_mut) else {
            return false;
        };
        end.append(&mut it.start);
        end.push(self.source_token());
        items.pop();
        true
    }

    /// A line break after the value of the last of `items`.
    fn newline_after_value(&self, items: &mut Vec<Item>) {
        let token = self.source_token();
        let end = items
            .last_mut()
            .and_then(|it| it.value.as_deref_mut())
            .and_then(Token::end_mut);
        match end {
            Some(end)
                if end
                    .last()
                    .is_some_and(|last| last.kind == TokenType::Comment) =>
            {
                end.push(token)
            }
            _ => items.push(item_with_start(vec![token])),
        }
    }

    fn block_map(&mut self, map: &mut Token) -> Result<Next> {
        let token = self.source_token();
        let Token::BlockMap {
            indent: map_indent,
            items,
            ..
        } = map
        else {
            return Err(ParseError::Syntax);
        };
        let map_indent = *map_indent;
        let it = items.last_mut().ok_or(ParseError::Syntax)?;
        match self.kind {
            TokenType::Newline => {
                self.on_key_line = false;
                if it.value.is_some() {
                    self.newline_after_value(items);
                } else {
                    it.sep.as_mut().unwrap_or(&mut it.start).push(token);
                }
                return Ok(Next::Done);
            }
            TokenType::Space | TokenType::Comment => {
                if it.value.is_some() {
                    items.push(item_with_start(vec![token]));
                } else if let Some(sep) = &mut it.sep {
                    sep.push(token);
                } else if !self.moves_indented_comment(items, map_indent) {
                    items
                        .last_mut()
                        .ok_or(ParseError::Syntax)?
                        .start
                        .push(token);
                }
                return Ok(Next::Done);
            }
            _ => {}
        }
        if self.indent < map_indent {
            return Ok(Next::PopAndStep);
        }
        let at_map_indent = !self.on_key_line && self.indent == map_indent;
        let at_next_item = at_map_indent
            && (it.sep.is_some() || it.explicit_key)
            && self.kind != TokenType::SeqItemInd;

        // After an empty node, what is behind an empty line and not indented belongs to the next node.
        let mut start = Vec::new();
        if at_next_item
            && it.value.is_none()
            && let Some(sep) = &mut it.sep
        {
            let mut newlines: Vec<usize> = Vec::new();
            for (i, st) in sep.iter().enumerate() {
                match st.kind {
                    TokenType::Newline => newlines.push(i),
                    TokenType::Space => {}
                    TokenType::Comment => {
                        if st.indent > map_indent {
                            newlines.clear();
                        }
                    }
                    _ => newlines.clear(),
                }
            }
            if let Some(&second) = newlines.get(1) {
                start = sep.split_off(second);
            }
        }

        let new_map = |items: Vec<Item>| {
            Next::Push(Token::BlockMap {
                offset: token.offset,
                indent: token.indent,
                items,
            })
        };
        match self.kind {
            TokenType::Anchor | TokenType::Tag => {
                if at_next_item || it.value.is_some() {
                    start.push(token);
                    items.push(item_with_start(start));
                    self.on_key_line = true;
                } else {
                    it.sep.as_mut().unwrap_or(&mut it.start).push(token);
                }
                Ok(Next::Done)
            }
            TokenType::ExplicitKeyInd => {
                self.on_key_line = true;
                if it.sep.is_none() && !it.explicit_key {
                    it.start.push(token);
                    it.explicit_key = true;
                } else if at_next_item || it.value.is_some() {
                    start.push(token);
                    items.push(Item {
                        start,
                        explicit_key: true,
                        ..Item::default()
                    });
                } else {
                    return Ok(new_map(vec![Item {
                        start: vec![token],
                        explicit_key: true,
                        ..Item::default()
                    }]));
                }
                Ok(Next::Done)
            }
            TokenType::MapValueInd => {
                self.on_key_line = true;
                if it.explicit_key {
                    match &mut it.sep {
                        None if includes_token(&it.start, TokenType::Newline) => {
                            it.sep = Some(vec![token])
                        }
                        None => {
                            let start = first_key_start_props(Some(&mut it.start));
                            return Ok(new_map(vec![item_with_key(start, None, vec![token])]));
                        }
                        Some(_) if it.value.is_some() => {
                            items.push(item_with_key(Vec::new(), None, vec![token]))
                        }
                        Some(sep) if includes_token(sep, TokenType::MapValueInd) => {
                            return Ok(new_map(vec![item_with_key(start, None, vec![token])]));
                        }
                        Some(sep)
                            if it.key.as_ref().is_some_and(|key| key.is_flow_token())
                                && !includes_token(sep, TokenType::Newline) =>
                        {
                            let start = first_key_start_props(Some(&mut it.start));
                            let key = it.key.take().map(|key| *key);
                            let mut sep = it.sep.take().unwrap_or_default();
                            sep.push(token);
                            return Ok(new_map(vec![item_with_key(start, key, sep)]));
                        }
                        Some(sep) => {
                            // With `start`, it is not at the next item after all.
                            sep.append(&mut start);
                            sep.push(token);
                        }
                    }
                } else {
                    match &mut it.sep {
                        None => it.sep = Some(vec![token]),
                        Some(_) if it.value.is_some() || at_next_item => {
                            items.push(item_with_key(start, None, vec![token]))
                        }
                        Some(sep) if includes_token(sep, TokenType::MapValueInd) => {
                            return Ok(new_map(vec![item_with_key(Vec::new(), None, vec![token])]));
                        }
                        Some(sep) => sep.push(token),
                    }
                }
                Ok(Next::Done)
            }
            TokenType::Alias
            | TokenType::Scalar
            | TokenType::SingleQuotedScalar
            | TokenType::DoubleQuotedScalar => {
                let scalar = Token::FlowScalar { token, end: None };
                if at_next_item || it.value.is_some() {
                    items.push(item_with_key(start, Some(scalar), Vec::new()));
                    self.on_key_line = true;
                } else if it.sep.is_some() {
                    return Ok(Next::Push(scalar));
                } else {
                    it.key = Some(Box::new(scalar));
                    it.sep = Some(Vec::new());
                    self.on_key_line = true;
                }
                Ok(Next::Done)
            }
            _ => {
                let is_on_line_of_key = !it.explicit_key
                    && it
                        .sep
                        .as_ref()
                        .is_some_and(|sep| !includes_token(sep, TokenType::Newline));
                let Some(block_value) = self.start_block_value(map) else {
                    return Ok(Next::PopAndStep);
                };
                if matches!(block_value, Token::BlockSeq { .. }) {
                    if is_on_line_of_key {
                        return Err(ParseError::Syntax);
                    }
                } else if at_map_indent && let Token::BlockMap { items, .. } = map {
                    items.push(item_with_start(start));
                }
                Ok(Next::Push(block_value))
            }
        }
    }

    fn block_sequence(&mut self, seq: &mut Token) -> Result<Next> {
        let token = self.source_token();
        let Token::BlockSeq {
            indent: seq_indent,
            items,
            ..
        } = seq
        else {
            return Err(ParseError::Syntax);
        };
        let seq_indent = *seq_indent;
        let it = items.last_mut().ok_or(ParseError::Syntax)?;
        match self.kind {
            TokenType::Newline => {
                if it.value.is_some() {
                    self.newline_after_value(items);
                } else {
                    it.start.push(token);
                }
                return Ok(Next::Done);
            }
            TokenType::Space | TokenType::Comment => {
                if it.value.is_some() {
                    items.push(item_with_start(vec![token]));
                } else if !self.moves_indented_comment(items, seq_indent) {
                    items
                        .last_mut()
                        .ok_or(ParseError::Syntax)?
                        .start
                        .push(token);
                }
                return Ok(Next::Done);
            }
            TokenType::Anchor | TokenType::Tag
                if it.value.is_none() && self.indent > seq_indent =>
            {
                it.start.push(token);
                return Ok(Next::Done);
            }
            TokenType::SeqItemInd if self.indent == seq_indent => {
                if it.value.is_some() || includes_token(&it.start, TokenType::SeqItemInd) {
                    items.push(item_with_start(vec![token]));
                } else {
                    it.start.push(token);
                }
                return Ok(Next::Done);
            }
            _ => {}
        }
        if self.indent > seq_indent
            && let Some(block_value) = self.start_block_value(seq)
        {
            return Ok(Next::Push(block_value));
        }
        Ok(Next::PopAndStep)
    }

    /// `parent`: what is below it on the stack.
    fn flow_collection(
        &mut self,
        collection: &mut Token,
        parent: Option<&mut Token>,
    ) -> Result<Next> {
        let token = self.source_token();
        let Token::FlowCollection {
            offset,
            indent,
            start: collection_start,
            items,
            end,
        } = collection
        else {
            return Err(ParseError::Syntax);
        };
        if self.kind == TokenType::FlowErrorEnd {
            return Ok(Next::PopFlowCollections);
        }
        if end.is_empty() {
            // The item that goes on, if there is one.
            let it = items.last_mut().filter(|it| it.value.is_none());
            match self.kind {
                TokenType::Comma | TokenType::ExplicitKeyInd => {
                    match items.last_mut().filter(|it| it.sep.is_none()) {
                        Some(it) => it.start.push(token),
                        None => items.push(item_with_start(vec![token])),
                    }
                }
                TokenType::MapValueInd => match it {
                    None => items.push(item_with_key(Vec::new(), None, vec![token])),
                    Some(it) => it.sep.get_or_insert_default().push(token),
                },
                TokenType::Space
                | TokenType::Comment
                | TokenType::Newline
                | TokenType::Anchor
                | TokenType::Tag => match it {
                    None => items.push(item_with_start(vec![token])),
                    Some(it) => it.sep.as_mut().unwrap_or(&mut it.start).push(token),
                },
                TokenType::Alias
                | TokenType::Scalar
                | TokenType::SingleQuotedScalar
                | TokenType::DoubleQuotedScalar => {
                    let scalar = Token::FlowScalar { token, end: None };
                    match it {
                        None => items.push(item_with_key(Vec::new(), Some(scalar), Vec::new())),
                        Some(it) if it.sep.is_some() => return Ok(Next::Push(scalar)),
                        Some(it) => {
                            it.key = Some(Box::new(scalar));
                            it.sep = Some(Vec::new());
                        }
                    }
                }
                TokenType::FlowMapEnd | TokenType::FlowSeqEnd => end.push(token),
                _ => {
                    return Ok(match self.start_block_value(collection) {
                        Some(block_value) => Next::Push(block_value),
                        None => Next::PopAndStep,
                    });
                }
            }
            return Ok(Next::Done);
        }
        let parent = parent.ok_or(ParseError::Syntax)?;
        if let Token::BlockMap {
            indent: parent_indent,
            items: parent_items,
            ..
        } = parent
            && ((self.kind == TokenType::MapValueInd && parent_indent == indent)
                || (self.kind == TokenType::Newline
                    && parent_items.last().is_some_and(|it| it.sep.is_none())))
        {
            return Ok(Next::PopAndStep);
        }
        if self.kind == TokenType::MapValueInd && !matches!(parent, Token::FlowCollection { .. }) {
            let start = first_key_start_props(prev_props(parent));
            fix_flow_seq_items(*collection_start, items);
            let mut sep = end.split_off(1);
            sep.push(token);
            self.on_key_line = true;
            let (offset, indent) = (*offset, *indent);
            let key = std::mem::replace(
                collection,
                Token::BlockMap {
                    offset,
                    indent,
                    items: Vec::new(),
                },
            );
            if let Token::BlockMap { items, .. } = collection {
                items.push(item_with_key(start, Some(key), sep));
            }
            return Ok(Next::Done);
        }
        self.line_end(collection)
    }

    /// `startBlockValue`. `parent`: the top of the stack.
    fn start_block_value(&mut self, parent: &mut Token) -> Option<Token> {
        let token = self.source_token();
        let (offset, indent) = (token.offset, token.indent);
        Some(match self.kind {
            TokenType::Alias
            | TokenType::Scalar
            | TokenType::SingleQuotedScalar
            | TokenType::DoubleQuotedScalar => Token::FlowScalar { token, end: None },
            TokenType::BlockScalarHeader => Token::BlockScalar {
                offset,
                indent,
                props: vec![token],
                source: (token.end, token.end),
            },
            TokenType::FlowMapStart | TokenType::FlowSeqStart => Token::FlowCollection {
                offset,
                indent,
                start: token,
                items: Vec::new(),
                end: Vec::new(),
            },
            TokenType::SeqItemInd => Token::BlockSeq {
                offset,
                indent,
                items: vec![item_with_start(vec![token])],
            },
            TokenType::ExplicitKeyInd => {
                self.on_key_line = true;
                let mut start = first_key_start_props(prev_props(parent));
                start.push(token);
                Token::BlockMap {
                    offset,
                    indent,
                    items: vec![Item {
                        start,
                        explicit_key: true,
                        ..Item::default()
                    }],
                }
            }
            TokenType::MapValueInd => {
                self.on_key_line = true;
                let start = first_key_start_props(prev_props(parent));
                Token::BlockMap {
                    offset,
                    indent,
                    items: vec![item_with_key(start, None, vec![token])],
                }
            }
            _ => return None,
        })
    }

    fn document_end(&mut self, doc_end: &mut Token) -> Result<Next> {
        if self.kind == TokenType::DocMode {
            return Ok(Next::Done);
        }
        if let Token::DocEnd { end, .. } = doc_end {
            end.get_or_insert_default().push(self.source_token());
        }
        Ok(if self.kind == TokenType::Newline {
            Next::Pop
        } else {
            Next::Done
        })
    }

    fn line_end(&mut self, token: &mut Token) -> Result<Next> {
        match self.kind {
            TokenType::Comma
            | TokenType::DocStart
            | TokenType::DocEnd
            | TokenType::FlowSeqEnd
            | TokenType::FlowMapEnd
            | TokenType::MapValueInd => return Ok(Next::PopAndStep),
            TokenType::Newline => self.on_key_line = false,
            _ => {}
        }
        // Anything but a space, a comment and a line break is an error, which the composer finds.
        let source_token = self.source_token();
        match token {
            Token::FlowScalar { end, .. } | Token::Document { end, .. } => {
                end.get_or_insert_default().push(source_token)
            }
            Token::FlowCollection { end, .. } => end.push(source_token),
            _ => return Err(ParseError::Syntax),
        }
        Ok(if self.kind == TokenType::Newline {
            Next::Pop
        } else {
            Next::Done
        })
    }
}

/// `[...new Parser().parse(text)]`
pub(crate) fn parse(text: &[u8], lexemes: &[Lexeme]) -> Result<Vec<Token>> {
    let mut parser = Parser {
        text,
        at_new_line: true,
        at_scalar: false,
        indent: 0,
        offset: 0,
        on_key_line: false,
        stack: Vec::new(),
        source_len: 0,
        kind: TokenType::Newline,
        out: Vec::new(),
    };
    for &lexeme in lexemes {
        parser.next(lexeme)?;
    }
    while !parser.stack.is_empty() {
        parser.pop()?;
    }
    Ok(parser.out)
}
