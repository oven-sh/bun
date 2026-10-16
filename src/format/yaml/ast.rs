//! `yaml-unist-parser` 3.2: the tree that Prettier prints, from what Bun's parser reads: the documents say what is in
//! what, the tokens where it is written.

use crate::stack::Stack;
use crate::syntax_error::{Message, SyntaxError};
use bun_ast::expr::Data;
use bun_ast::{E, Expr, G};
use bun_core::strings;
use bun_parsers::yaml::{SourceToken, SourceTokenKind as TokenKind};

/// An error that `yaml-unist-parser` throws, or a `TypeError` in it.
pub(crate) struct Unexpected;

type Result<T> = std::result::Result<T, Unexpected>;

#[derive(Debug, Copy, Clone, Default, PartialEq, Eq)]
pub(crate) struct Point {
    pub(crate) offset: u32,
    pub(crate) line: u32,
    pub(crate) column: u32,
}

#[derive(Debug, Copy, Clone, Default)]
pub(crate) struct Position {
    pub(crate) start: Point,
    pub(crate) end: Point,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Kind {
    Root,
    Document,
    DocumentHead,
    DocumentBody,
    Directive,
    Comment,
    Alias,
    Tag,
    Anchor,
    BlockFolded,
    BlockLiteral,
    Plain,
    QuoteDouble,
    QuoteSingle,
    FlowMapping,
    FlowSequence,
    FlowMappingItem,
    FlowSequenceItem,
    Mapping,
    MappingItem,
    MappingKey,
    MappingValue,
    Sequence,
    SequenceItem,
}

impl Kind {
    /// `"leadingComments" in node`
    fn has_leading_comments(self) -> bool {
        use Kind::*;
        matches!(
            self,
            Alias
                | BlockFolded
                | BlockLiteral
                | Directive
                | FlowMapping
                | FlowSequence
                | FlowMappingItem
                | MappingItem
                | MappingValue
                | Mapping
                | Plain
                | QuoteDouble
                | QuoteSingle
                | SequenceItem
                | Sequence
        )
    }

    /// `"trailingComment" in node`
    fn has_trailing_comment(self) -> bool {
        use Kind::*;
        matches!(
            self,
            Alias
                | Directive
                | DocumentHead
                | Document
                | FlowMapping
                | FlowSequence
                | MappingKey
                | MappingValue
                | Plain
                | QuoteDouble
                | QuoteSingle
                | SequenceItem
        )
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Chomping {
    Clip,
    Keep,
    Strip,
}

/// Which of `Tree::nodes`: its index plus one, so that `Option<Id>` is no larger.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) struct Id(std::num::NonZeroU32);

impl Id {
    fn of_index(index: usize) -> Id {
        Id(std::num::NonZeroU32::MIN.saturating_add(index as u32))
    }

    fn index(self) -> usize {
        self.0.get() as usize - 1
    }
}

/// Nodes that follow each other by their `next`. Each node is in one list at most.
#[derive(Debug, Copy, Clone, Default)]
pub(crate) struct List {
    first: Option<Id>,
    last: Option<Id>,
    len: u32,
}

impl List {
    pub(crate) fn is_empty(self) -> bool {
        self.first.is_none()
    }

    pub(crate) fn len(self) -> usize {
        self.len as usize
    }

    pub(crate) fn first(self) -> Option<Id> {
        self.first
    }

    pub(crate) fn last(self) -> Option<Id> {
        self.last
    }
}

#[derive(Debug)]
pub(crate) struct Node<'a> {
    pub(crate) kind: Kind,
    pub(crate) position: Position,
    pub(crate) parent: Option<Id>,
    /// What follows in the list that it is in.
    pub(crate) next: Option<Id>,
    pub(crate) children: List,
    pub(crate) leading_comments: List,
    pub(crate) middle_comments: List,
    pub(crate) end_comments: List,
    pub(crate) trailing_comment: Option<Id>,
    pub(crate) indicator_comment: Option<Id>,
    pub(crate) tag: Option<Id>,
    pub(crate) anchor: Option<Id>,
    /// Of a comment, an alias and an anchor. Of a directive: all of it.
    pub(crate) value: &'a [u8],
    /// Of a tag: it is `tag:yaml.org,2002:set`.
    pub(crate) is_set_tag: bool,
    /// Of a block scalar.
    pub(crate) chomping: Chomping,
    pub(crate) indent: Option<u32>,
    /// Of a document.
    pub(crate) directives_end_marker: bool,
    pub(crate) document_end_marker: bool,
}

pub(crate) struct Tree<'a> {
    pub(crate) nodes: Vec<Node<'a>>,
    pub(crate) root: Id,
}

/// The nodes of `list`.
fn items<'t>(nodes: &'t [Node<'_>], list: List) -> impl Iterator<Item = Id> + 't {
    std::iter::successors(list.first, |&id| nodes[id.index()].next)
}

/// Which list of a node.
#[derive(Copy, Clone)]
enum Which {
    Children,
    LeadingComments,
    MiddleComments,
    EndComments,
}

/// Adds `item` to a list of `owner`, which is its parent from now on.
fn append(nodes: &mut [Node<'_>], owner: Id, which: Which, item: Id) {
    let node = &mut nodes[owner.index()];
    let list = match which {
        Which::Children => &mut node.children,
        Which::LeadingComments => &mut node.leading_comments,
        Which::MiddleComments => &mut node.middle_comments,
        Which::EndComments => &mut node.end_comments,
    };
    list.len += 1;
    match list.last.replace(item) {
        None => list.first = Some(item),
        Some(last) => nodes[last.index()].next = Some(item),
    }
    nodes[item.index()].parent = Some(owner);
}

impl Tree<'_> {
    /// The nodes of `list`.
    pub(crate) fn items(&self, list: List) -> impl Iterator<Item = Id> + '_ {
        items(&self.nodes, list)
    }
}

impl<'a> std::ops::Index<Id> for Tree<'a> {
    type Output = Node<'a>;

    fn index(&self, id: Id) -> &Node<'a> {
        &self.nodes[id.index()]
    }
}

/// The properties of a node: tokens that are a comment, a tag or an anchor.
type Props = smallvec::SmallVec<[SourceToken; 4]>;

struct Context<'c, 'a> {
    text: &'a [u8],
    tokens: &'c [SourceToken],
    /// How many of `tokens` have been looked at.
    at: usize,
    /// The `%TAG` directives of the document: handles and prefixes. The last with a handle counts.
    tags: smallvec::SmallVec<[(&'a [u8], &'a [u8]); 2]>,
    is_ascii: bool,
    /// Where the lines start.
    line_starts: Vec<u32>,
    /// The line that has been asked for last: its number, where it starts, and where the next one does.
    last_line: std::cell::Cell<(u32, u32, u32)>,
    /// A place in that line, and how many UTF-16 code units are before it in the line. The next place that is asked for is
    /// near it as a rule, and a line can be as long as the text.
    last_place: std::cell::Cell<(u32, u32)>,
    nodes: Vec<Node<'a>>,
    comments: Vec<Id>,
    /// The nodes whose parents are not made yet.
    pending: Vec<Id>,
    /// There is a tag or an anchor.
    has_properties: bool,
    stack: &'c Stack,
}

/// `maybeContentPropertyToken`
fn is_content_property(token: SourceToken) -> bool {
    matches!(
        token.kind,
        TokenKind::Comment | TokenKind::Tag | TokenKind::Anchor
    )
}

/// `isEmptyNode`
fn is_empty_node(node: &Expr, props: &[SourceToken]) -> bool {
    matches!(node.data, Data::ENull(_))
        && props.iter().all(|token| token.kind == TokenKind::Comment)
}

impl<'a> Context<'_, 'a> {
    /// `transformOffset`
    fn point(&self, offset: u32) -> Point {
        // Most of the time it is the same line as the last time, or the next one.
        let (mut line, mut start, mut next) = self.last_line.get();
        if offset < start || offset >= next {
            let start_of = |line: u32| {
                self.line_starts
                    .get(line as usize - 1)
                    .copied()
                    .unwrap_or(u32::MAX)
            };
            line = match offset >= next && offset < start_of(line + 2) {
                true => line + 1,
                false => self.line_starts.partition_point(|&start| start <= offset) as u32,
            }
            .max(1);
            (start, next) = (start_of(line), start_of(line + 1));
            self.last_line.set((line, start, next));
            self.last_place.set((start, 0));
        }
        // Columns count UTF-16 code units.
        let column = match self.is_ascii {
            true => offset.saturating_sub(start),
            false => {
                let units = |from: u32, to: u32| {
                    let between = self.text.get(from as usize..to as usize);
                    let between = between.unwrap_or_default();
                    let count = match between.is_ascii() {
                        true => between.len(),
                        false => {
                            between.iter().filter(|&&b| b & 0xC0 != 0x80).count()
                                + between.iter().filter(|&&b| b >= 0xF0).count()
                        }
                    };
                    count as u32
                };
                // Near the start of the line nothing is gained by remembering.
                if offset.saturating_sub(start) <= 64 {
                    units(start, offset)
                } else {
                    let (place, before_place) = self.last_place.get();
                    let column = match offset >= place {
                        true => before_place + units(place, offset),
                        false => before_place.saturating_sub(units(offset, place)),
                    };
                    self.last_place.set((offset, column));
                    column
                }
            }
        };
        Point {
            offset,
            line,
            column: column + 1,
        }
    }

    /// `transformOffset`, next to a point that is known.
    fn point_near(&self, offset: u32, known: Point) -> Point {
        if known.offset == offset {
            known
        } else {
            self.point(offset)
        }
    }

    /// `transformRange`
    fn position(&self, start: u32, end: u32) -> Position {
        Position {
            start: self.point(start),
            end: self.point(end),
        }
    }

    fn new_node(&mut self, kind: Kind, position: Position) -> Id {
        let id = Id::of_index(self.nodes.len());
        self.nodes.push(Node {
            kind,
            position,
            parent: None,
            next: None,
            children: List::default(),
            leading_comments: List::default(),
            middle_comments: List::default(),
            end_comments: List::default(),
            trailing_comment: None,
            indicator_comment: None,
            tag: None,
            anchor: None,
            value: b"",
            is_set_tag: false,
            chomping: Chomping::Clip,
            indent: None,
            directives_end_marker: false,
            document_end_marker: false,
        });
        id
    }

    fn node(&mut self, id: Id) -> &mut Node<'a> {
        &mut self.nodes[id.index()]
    }

    fn position_of(&self, id: Id) -> Position {
        self.nodes[id.index()].position
    }

    fn add_child(&mut self, parent: Id, child: Id) {
        append(&mut self.nodes, parent, Which::Children, child);
    }

    /// Makes `self.pending[from..]` the children of `parent`.
    fn add_pending_children(&mut self, parent: Id, from: usize) {
        for index in from..self.pending.len() {
            self.add_child(parent, self.pending[index]);
        }
        self.pending.truncate(from);
    }

    /// `related` belongs to `owner`.
    fn own(&mut self, owner: Id, related: Id) -> Option<Id> {
        self.node(related).parent = Some(owner);
        Some(related)
    }

    fn transform_comment(&mut self, token: SourceToken) -> Id {
        let id = self.new_node(Kind::Comment, self.position(token.start, token.end));
        self.node(id).value = self
            .text
            .get(token.start as usize + 1..token.end as usize)
            .unwrap_or_default();
        self.comments.push(id);
        id
    }

    fn peek(&self) -> Option<SourceToken> {
        self.tokens.get(self.at).copied()
    }

    /// The next token, if it is of `kind`.
    fn take(&mut self, kind: TokenKind) -> Option<SourceToken> {
        let token = self.peek().filter(|token| token.kind == kind)?;
        self.at += 1;
        Some(token)
    }

    fn expect(&mut self, kind: TokenKind) -> Result<SourceToken> {
        self.take(kind).ok_or(Unexpected)
    }

    /// Adds the comments, tags and anchors that follow to `props`.
    fn take_props(&mut self, props: &mut Props) {
        while let Some(token) = self.peek().filter(|&token| is_content_property(token)) {
            props.push(token);
            self.at += 1;
        }
    }

    /// Adds the properties of `node` to `props`, which is written behind `indicator`, in a block collection. Of a node that
    /// is not written otherwise, they are on the line of the indicator, or further to the right than `entry`, where
    /// what the indicator belongs to starts: anything else belongs to what follows.
    fn take_props_behind(
        &mut self,
        indicator: SourceToken,
        entry: u32,
        node: &Expr,
        props: &mut Props,
    ) {
        if !matches!(node.data, Data::ENull(_)) {
            return self.take_props(props);
        }
        while let Some(token) = self.peek().filter(|&token| is_content_property(token)) {
            if token.kind != TokenKind::Comment {
                let place = self.point(token.start);
                if place.line != self.point(indicator.start).line
                    && place.column <= self.point(entry).column
                {
                    break;
                }
            }
            props.push(token);
            self.at += 1;
        }
    }

    fn take_comments(&mut self) {
        while let Some(token) = self.take(TokenKind::Comment) {
            self.transform_comment(token);
        }
    }

    /// `extractComments`
    fn extract_comments(&mut self, props: &[SourceToken]) {
        for &token in props {
            if token.kind == TokenKind::Comment {
                self.transform_comment(token);
            }
        }
    }

    /// Whether the tag that is written `source` is `tag:yaml.org,2002:set`.
    fn is_set_tag(&self, source: &[u8]) -> bool {
        const SET: &[u8] = b"tag:yaml.org,2002:set";
        if let Some(verbatim) = source.strip_prefix(b"!<") {
            return verbatim.strip_suffix(b">") == Some(SET);
        }
        let handle_len = strings::last_index_of_char(source, b'!').map_or(0, |at| at + 1);
        let (handle, suffix) = source.split_at(handle_len);
        let declared = self.tags.iter().rev().find(|(it, _)| *it == handle);
        let prefix = match declared {
            Some((_, prefix)) => Some(*prefix),
            None => (handle == b"!!").then_some(&b"tag:yaml.org,2002:"[..]),
        };
        prefix.is_some_and(|prefix| SET.strip_prefix(prefix) == Some(suffix))
    }

    /// `transformContentProperties`, for the node `id`, whose content starts at `start`.
    fn transform_content_properties(&mut self, id: Id, start: u32, props: &[SourceToken]) {
        let mut first_tag_or_anchor_start = None;
        self.has_properties |= !props.is_empty();
        for &token in props {
            let source = self.text.get(token.start as usize..token.end as usize);
            match token.kind {
                TokenKind::Tag => {
                    first_tag_or_anchor_start.get_or_insert(token.start);
                    let tag = self.new_node(Kind::Tag, self.position(token.start, token.end));
                    self.node(tag).is_set_tag = matches!(
                        self.nodes[id.index()].kind,
                        Kind::Mapping | Kind::FlowMapping
                    ) && self.is_set_tag(source.unwrap_or_default());
                    self.node(id).tag = self.own(id, tag);
                }
                TokenKind::Anchor => {
                    first_tag_or_anchor_start.get_or_insert(token.start);
                    let anchor = self.new_node(Kind::Anchor, self.position(token.start, token.end));
                    self.node(anchor).value = source.and_then(|it| it.get(1..)).unwrap_or_default();
                    self.node(id).anchor = self.own(id, anchor);
                }
                _ => {
                    let comment = self.transform_comment(token);
                    if first_tag_or_anchor_start.is_some_and(|first| first <= token.start)
                        && token.end <= start
                    {
                        append(&mut self.nodes, id, Which::MiddleComments, comment);
                    }
                }
            }
        }
    }

    /// Whether what starts at the next token is `mapping` in braces, and not a mapping without, whose first key is in
    /// brackets or braces: that starts where its key does.
    fn is_in_braces(&self, node: &Expr, mapping: &E::Object) -> bool {
        let first_key = mapping.properties.first().and_then(|it| it.key.as_ref());
        self.peek()
            .is_some_and(|token| token.kind == TokenKind::MappingStart)
            && !first_key.is_some_and(|key| {
                matches!(key.data, Data::EObject(_) | Data::EArray(_)) && key.loc == node.loc
            })
    }

    /// `transformNode`. `node` is written at the next token, behind `props`.
    fn transform_node(&mut self, node: &Expr, props: Props) -> Result<Id> {
        if !self.stack.has_room() {
            return Err(Unexpected);
        }
        match &node.data {
            Data::EBoolean(scalar) if scalar.value => self.transform_scalar(&props),
            Data::EBoolean(_) => {
                let SourceToken { start, end, .. } = self.expect(TokenKind::Alias)?;
                let id = self.new_node(Kind::Alias, self.position(start, end));
                self.transform_content_properties(id, start, &props);
                self.node(id).value = self
                    .text
                    .get(start as usize + 1..end as usize)
                    .unwrap_or_default();
                Ok(id)
            }
            Data::EObject(mapping) if self.is_in_braces(node, mapping) => {
                self.transform_flow_map(mapping, &props)
            }
            Data::EObject(mapping) => self.transform_map(mapping, props),
            Data::EArray(sequence) => match self.peek().map(|token| token.kind) {
                Some(TokenKind::SequenceStart) => self.transform_flow_seq(sequence, &props),
                _ => self.transform_seq(sequence, &props),
            },
            _ => self.transform_empty_node(&props),
        }
    }

    /// A node of which nothing is written but a tag or an anchor.
    fn transform_empty_node(&mut self, props: &[SourceToken]) -> Result<Id> {
        let mut properties = props.iter().filter(|it| it.kind != TokenKind::Comment);
        let end = properties.next_back().ok_or(Unexpected)?.end;
        let id = self.new_node(Kind::Plain, self.position(end, end));
        self.transform_content_properties(id, end, props);
        Ok(id)
    }

    fn transform_scalar(&mut self, props: &[SourceToken]) -> Result<Id> {
        let token = self.expect(TokenKind::Scalar)?;
        let (kind, end) = match self.text.get(token.start as usize) {
            Some(b'|') => return self.transform_block_scalar(Kind::BlockLiteral, token, props),
            Some(b'>') => return self.transform_block_scalar(Kind::BlockFolded, token, props),
            Some(b'"') => (Kind::QuoteDouble, token.end),
            Some(b'\'') => (Kind::QuoteSingle, token.end),
            // Which Bun's parser takes outside of brackets.
            Some(b',') => return Err(Unexpected),
            _ => {
                let source = self.text.get(token.start as usize..token.end as usize);
                let len = source
                    .and_then(|it| it.iter().rposition(|b| !matches!(b, b' ' | b'\t' | b'\n')))
                    .map_or(0, |last| last + 1);
                (Kind::Plain, token.start + len as u32)
            }
        };
        let id = self.new_node(kind, self.position(token.start, end));
        self.transform_content_properties(id, token.start, props);
        Ok(id)
    }

    /// Where `yaml` has the block scalar end whose lines start at `body`, and which something at `next` follows. Lines at
    /// the end with nothing in them, and not indented further than the first, are only part of it with `+`.
    fn end_of_block_scalar(&self, body: usize, next: usize, is_kept: bool) -> usize {
        let text = self.text;
        let mut after_line_break = match next >= text.len() && !text.ends_with(b"\n") {
            true => text.len() + 1,
            false => strings::last_index_of_char(&text[..next.min(text.len())], b'\n')
                .map_or(body, |at| at + 1),
        };
        let mut indent = 0;
        for byte in text.get(body..).unwrap_or_default() {
            match byte {
                b' ' => indent += 1,
                b'\n' => indent = 0,
                _ => break,
            }
        }
        while !is_kept && after_line_break >= 2 {
            let last = after_line_break - 2;
            let blanks = (text.get(..=last).unwrap_or_default().iter().rev())
                .take_while(|&&byte| byte == b' ')
                .count();
            match last.checked_sub(blanks) {
                Some(at) if at >= body && text[at] == b'\n' && at + 1 + indent > last => {
                    after_line_break = at + 1;
                }
                _ => break,
            }
        }
        after_line_break.clamp(body, text.len())
    }

    fn transform_block_scalar(
        &mut self,
        kind: Kind,
        token: SourceToken,
        props: &[SourceToken],
    ) -> Result<Id> {
        let rest = self.text.get(token.start as usize..).unwrap_or_default();
        let header = &rest[..strings::index_of_any(rest, b" \t\n").unwrap_or(rest.len())];
        let indicator_comment = self
            .peek()
            .filter(|it| it.kind == TokenKind::Comment && it.start < token.end)
            .map(|comment| {
                self.at += 1;
                self.transform_comment(comment)
            });
        // `/([+-]?)(\d*)([+-]?)$/`
        let (before_last_sign, last_sign) = match header {
            [rest @ .., sign @ (b'+' | b'-')] => (rest, Some(*sign)),
            _ => (header, None),
        };
        let digits_len = before_last_sign
            .iter()
            .rev()
            .take_while(|b| b.is_ascii_digit())
            .count();
        let (before_digits, digits) =
            before_last_sign.split_at(before_last_sign.len() - digits_len);
        let first_sign = before_digits
            .last()
            .copied()
            .filter(|b| matches!(b, b'+' | b'-'));
        let chomping = match last_sign.or(first_sign) {
            Some(b'+') => Chomping::Keep,
            Some(_) => Chomping::Strip,
            None => Chomping::Clip,
        };
        let body = strings::index_of_char_usize(rest, b'\n')
            .map_or(self.text.len(), |at| token.start as usize + at + 1);
        let end = self.end_of_block_scalar(body, token.end as usize, chomping == Chomping::Keep);
        let id = self.new_node(kind, self.position(token.start, end as u32));
        self.transform_content_properties(id, token.start, props);
        let block = self.node(id);
        block.indent = (!digits.is_empty()).then(|| {
            digits
                .iter()
                .fold(0u32, |all, b| all.saturating_mul(10) + u32::from(b - b'0'))
        });
        block.chomping = chomping;
        block.indicator_comment = indicator_comment;
        if let Some(comment) = indicator_comment {
            self.own(id, comment);
        }
        Ok(id)
    }

    /// The comments and commas before the end of a flow collection, and the end. `children`: where its items start in
    /// `self.pending`.
    fn finish_flow_collection(
        &mut self,
        kind: Kind,
        end_kind: TokenKind,
        start: SourceToken,
        children: usize,
        props: &[SourceToken],
    ) -> Result<Id> {
        self.take_comments();
        while self.take(TokenKind::CollectEntry).is_some() {
            self.take_comments();
        }
        let close = self.expect(end_kind)?;
        let id = self.new_node(kind, self.position(start.start, close.end));
        self.transform_content_properties(id, start.start, props);
        self.add_pending_children(id, children);
        Ok(id)
    }

    fn transform_flow_map(&mut self, mapping: &E::Object, props: &[SourceToken]) -> Result<Id> {
        let start = self.expect(TokenKind::MappingStart)?;
        let children = self.pending.len();
        for property in mapping.properties.iter() {
            let child = self.transform_pair(property, Kind::FlowMappingItem, Props::new())?;
            self.pending.push(child);
        }
        self.finish_flow_collection(
            Kind::FlowMapping,
            TokenKind::MappingEnd,
            start,
            children,
            props,
        )
    }

    fn transform_flow_seq(&mut self, sequence: &E::Array, props: &[SourceToken]) -> Result<Id> {
        let start = self.expect(TokenKind::SequenceStart)?;
        let children = self.pending.len();
        for item in sequence.items.iter() {
            let mut item_props = Props::new();
            self.take_props(&mut item_props);
            while self.take(TokenKind::CollectEntry).is_some() {
                self.take_props(&mut item_props);
            }
            let child = match &item.data {
                // `[ key: value ]`
                Data::EObject(pair) if !self.is_in_braces(item, &**pair) => self.transform_pair(
                    pair.properties.first().ok_or(Unexpected)?,
                    Kind::FlowMappingItem,
                    item_props,
                )?,
                _ => {
                    let content = self.transform_node(item, item_props)?;
                    let id = self.new_node(Kind::FlowSequenceItem, self.position_of(content));
                    self.add_child(id, content);
                    id
                }
            };
            self.pending.push(child);
        }
        self.finish_flow_collection(
            Kind::FlowSequence,
            TokenKind::SequenceEnd,
            start,
            children,
            props,
        )
    }

    /// A node of `kind` from the first to the last of `self.pending[children..]`, which are in it.
    fn finish_block_collection(
        &mut self,
        kind: Kind,
        start: u32,
        children: usize,
        props: &[SourceToken],
    ) -> Result<Id> {
        let (&first, &last) = self
            .pending
            .get(children)
            .zip(self.pending.last())
            .ok_or(Unexpected)?;
        let position = Position {
            start: self.position_of(first).start,
            end: self.position_of(last).end,
        };
        let id = self.new_node(kind, position);
        self.transform_content_properties(id, start, props);
        self.add_pending_children(id, children);
        Ok(id)
    }

    fn transform_map(&mut self, mapping: &E::Object, mut props: Props) -> Result<Id> {
        let start = self.peek().ok_or(Unexpected)?.start;
        // `getFirstKeyStartProps`: what is on the line of the first key belongs to that.
        let line_start = strings::last_index_of_char(&self.text[..start as usize], b'\n')
            .map_or(0, |at| at as u32 + 1);
        let own = props.iter().take_while(|it| it.start < line_start).count();
        let mut key_props: Props = props.drain(own..).collect();
        let children = self.pending.len();
        for property in mapping.properties.iter() {
            if self.pending.len() > children && self.is_at_key_that_yaml_refuses() {
                return Err(Unexpected);
            }
            let key_props = std::mem::take(&mut key_props);
            let child = self.transform_pair(property, Kind::MappingItem, key_props)?;
            self.pending.push(child);
        }
        self.finish_block_collection(Kind::Mapping, start, children, &props)
    }

    /// `yaml` 2.9 cannot read a key in brackets or braces without a `?` if anything is written, be it blanks, between it
    /// and the line that the value above it ends on. That value is in the last of `self.pending`.
    fn is_at_key_that_yaml_refuses(&self) -> bool {
        let rest = self.tokens.get(self.at..).unwrap_or_default();
        let mut rest = rest.iter().filter(|it| it.kind != TokenKind::Comment);
        let Some(first) = rest.next() else {
            return false;
        };
        let key = std::iter::once(first)
            .chain(rest)
            .find(|&&it| !is_content_property(it));
        let value = (self.pending.last())
            .and_then(|item| self.nodes[item.index()].children.last())
            .and_then(|value| self.nodes[value.index()].children.first())
            .map(|content| &self.nodes[content.index()]);
        let (Some(TokenKind::SequenceStart | TokenKind::MappingStart), Some(value)) =
            (key.map(|it| it.kind), value)
        else {
            return false;
        };
        let end = value.position.end.offset as usize;
        let between = self.text.get(end..first.start as usize).unwrap_or_default();
        match value.kind {
            Kind::BlockFolded | Kind::BlockLiteral => strings::contains_char(between, b'\n'),
            Kind::Plain if value.position.start.offset as usize == end => false,
            _ => !between.ends_with(b"\n") || strings::count_char(between, b'\n') != 1,
        }
    }

    fn transform_seq(&mut self, sequence: &E::Array, props: &[SourceToken]) -> Result<Id> {
        let start = self.peek().ok_or(Unexpected)?.start;
        let children = self.pending.len();
        for item in sequence.items.iter() {
            self.take_comments();
            let indicator = self.expect(TokenKind::SequenceEntry)?;
            let mut item_props = Props::new();
            self.take_props_behind(indicator, indicator.start, item, &mut item_props);
            // `transformItemValue`
            let content = match is_empty_node(item, &item_props) {
                true => {
                    self.extract_comments(&item_props);
                    None
                }
                false => Some(self.transform_node(item, item_props)?),
            };
            let position = Position {
                start: self.point(indicator.start),
                end: match content {
                    Some(content) => self.position_of(content).end,
                    None => self.point(indicator.end),
                },
            };
            let id = self.new_node(Kind::SequenceItem, position);
            if let Some(content) = content {
                self.add_child(id, content);
            }
            self.pending.push(id);
        }
        self.finish_block_collection(Kind::Sequence, start, children, props)
    }

    /// `transformPair`. `kind`: of the item. `key_props`: what has been seen of the properties of the key.
    fn transform_pair(
        &mut self,
        pair: &G::Property,
        kind: Kind,
        mut key_props: Props,
    ) -> Result<Id> {
        let (Some(key), Some(value)) = (&pair.key, &pair.value) else {
            return Err(Unexpected);
        };
        let is_flow = kind == Kind::FlowMappingItem;
        let mut explicit_key_ind = None;
        loop {
            match explicit_key_ind.filter(|_| !is_flow) {
                Some(it) => self.take_props_behind(it, it.start, key, &mut key_props),
                None => self.take_props(&mut key_props),
            }
            match self.peek().map(|token| token.kind) {
                Some(TokenKind::MappingKey) if explicit_key_ind.is_none() => {
                    explicit_key_ind = self.take(TokenKind::MappingKey);
                }
                Some(TokenKind::CollectEntry) if is_flow => self.at += 1,
                _ => break,
            }
        }
        let entry = (key_props
            .iter()
            .find(|it| it.kind != TokenKind::Comment)
            .copied())
        .or(explicit_key_ind)
        .or_else(|| self.peek())
        .map_or(0, |it| {
            it.start
                .min(explicit_key_ind.map_or(u32::MAX, |it| it.start))
        });
        let key_token = self.peek().filter(|_| !matches!(key.data, Data::ENull(_)));

        // `transformAstPair`
        let key_content = match is_empty_node(key, &key_props) {
            true => {
                self.extract_comments(&key_props);
                None
            }
            false => Some(self.transform_node(key, key_props)?),
        };
        self.take_comments();
        // Further to the left than its `?`, it is that of a mapping around.
        let map_value_ind = self.peek().filter(|colon| {
            colon.kind == TokenKind::MappingValue
                && (is_flow
                    || explicit_key_ind.is_none_or(|key| {
                        let (key, colon) = (self.point(key.start), self.point(colon.start));
                        key.line == colon.line || key.column <= colon.column
                    }))
        });
        let mut value_props = Props::new();
        if let Some(colon) = map_value_ind {
            self.at += 1;
            match is_flow {
                true => self.take_props(&mut value_props),
                false => self.take_props_behind(colon, entry, value, &mut value_props),
            }
        }
        let value_content = match is_empty_node(value, &value_props) {
            true => {
                self.extract_comments(&value_props);
                None
            }
            false => Some(self.transform_node(value, value_props)?),
        };

        let key_start = explicit_key_ind
            .or(key_token)
            .or(map_value_ind)
            .ok_or(Unexpected)?
            .start;
        let key_position = match key_content.map(|it| self.position_of(it)) {
            Some(content) => Position {
                start: self.point_near(key_start, content.start),
                end: content.end,
            },
            None => self.position(key_start, explicit_key_ind.map_or(key_start, |it| it.end)),
        };
        let mapping_key = self.new_node(Kind::MappingKey, key_position);
        if let Some(content) = key_content {
            self.add_child(mapping_key, content);
        }
        let value_position = match (map_value_ind, value_content) {
            (Some(colon), Some(content)) => Position {
                start: self.point(colon.start),
                end: self.position_of(content).end,
            },
            (Some(colon), None) => self.position(colon.start, colon.start + 1),
            (None, Some(content)) => self.position_of(content),
            (None, None) => Position {
                start: key_position.end,
                end: key_position.end,
            },
        };
        let mapping_value = self.new_node(Kind::MappingValue, value_position);
        if let Some(content) = value_content {
            self.add_child(mapping_value, content);
        }
        let id = self.new_node(
            kind,
            Position {
                start: key_position.start,
                end: value_position.end,
            },
        );
        self.add_child(id, mapping_key);
        self.add_child(id, mapping_value);
        Ok(id)
    }

    /// The directive whose `%` is `token`, and the comment behind it.
    fn transform_directive(&mut self, token: SourceToken) -> (Id, Option<SourceToken>) {
        let text = self.text;
        let rest = text.get(token.start as usize..).unwrap_or_default();
        let line = &rest[..strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len())];
        let comment = (1..line.len())
            .find(|&at| line[at] == b'#' && matches!(line[at - 1], b' ' | b'\t'))
            .map(|at| SourceToken {
                kind: TokenKind::Comment,
                start: token.start + at as u32,
                end: token.start + line.len() as u32,
            });
        let line = &line[..comment.map_or(line.len(), |it| (it.start - token.start) as usize)];
        let line = &line[..line
            .iter()
            .rposition(|b| !matches!(b, b' ' | b'\t'))
            .map_or(0, |last| last + 1)];
        let end = token.start + line.len() as u32;
        let directive = self.new_node(Kind::Directive, self.position(token.start, end));
        self.node(directive).value = line;
        let mut parts = strings::split_any(line, b" \t").filter(|part| !part.is_empty());
        if let (Some(b"%TAG"), Some(handle), Some(prefix)) =
            (parts.next(), parts.next(), parts.next())
        {
            self.tags.push((handle, prefix));
        }
        (directive, comment)
    }

    /// The comments behind `content`, which is all that is in a document, as far as they are in the document for `yaml`.
    /// Returns those that it has at the end of the document, and in nothing that is in it.
    fn take_end_comments(&mut self, content: Option<Id>) -> Vec<Id> {
        let mut end_comments = Vec::new();
        let Some(content) = content.map(|content| &self.nodes[content.index()]) else {
            return end_comments;
        };
        let is_block = matches!(content.kind, Kind::Mapping | Kind::Sequence);
        // What is behind an item without a value is in that item.
        let is_open = is_block
            && (content.children.last())
                .map(|item| &self.nodes[item.index()])
                .and_then(|item| match item.kind {
                    Kind::MappingItem => item.children.last().map(|it| &self.nodes[it.index()]),
                    _ => Some(item),
                })
                .is_none_or(|it| it.children.is_empty());
        let last = self.at.checked_sub(1).and_then(|at| self.tokens.get(at));
        let is_block_scalar =
            last.is_some_and(|it| matches!(self.text.get(it.start as usize), Some(b'|' | b'>')));
        let end = match (is_block_scalar, self.peek()) {
            (false, Some(next)) => {
                strings::trim_js_whitespace_end(&self.text[..next.start as usize]).len() as u32
            }
            _ => content.position.end.offset,
        };
        let last_line = self.point(end.saturating_sub(1)).line;
        while let Some(token) = self.peek().filter(|it| it.kind == TokenKind::Comment) {
            let place = self.point(token.start);
            // A document whose content is no block collection ends with the line after that.
            if !is_block && place.line > last_line + 1 {
                break;
            }
            self.at += 1;
            let comment = self.transform_comment(token);
            if place.line > last_line
                && !is_open
                && (!is_block || place.column == 1 || !end_comments.is_empty())
            {
                end_comments.push(comment);
            }
        }
        end_comments
    }

    /// `transformDocument`. `root`: what is in it.
    fn transform_document(&mut self, root: Option<&Expr>) -> Result<Id> {
        let root = root.filter(|root| !matches!(root.data, Data::ENull(_)));
        // `transformDocumentHead`
        self.tags.clear();
        let mut directives: Vec<Id> = Vec::new();
        let mut end_comment_candidates: Vec<Id> = Vec::new();
        // Bun's parser takes it for a part of a directive that it does not know.
        let mut comment_of_directive = None;
        loop {
            let unlisted = comment_of_directive.take();
            if let Some(token) = unlisted.or_else(|| self.take(TokenKind::Comment)) {
                let comment = self.transform_comment(token);
                let position = self.position_of(comment);
                match directives.last().copied() {
                    Some(last)
                        if self.position_of(last).end.line == position.start.line
                            && self.nodes[last.index()].trailing_comment.is_none() =>
                    {
                        let directive = self.node(last);
                        directive.trailing_comment = Some(comment);
                        directive.position.end = position.end;
                        self.own(last, comment);
                    }
                    _ => end_comment_candidates.push(comment),
                }
            } else if let Some(token) = self.take(TokenKind::Directive) {
                let (directive, comment) = self.transform_directive(token);
                directives.push(directive);
                comment_of_directive = comment.filter(|_| self.peek() != comment);
                end_comment_candidates.clear();
            } else {
                break;
            }
        }
        let doc_start = self.take(TokenKind::DocumentStart);
        let mut prop_tokens = Props::new();
        self.take_props(&mut prop_tokens);
        let has_properties = prop_tokens.iter().any(|it| it.kind != TokenKind::Comment);
        let contents_start = match root {
            None => (prop_tokens.iter().rev())
                .find(|it| it.kind != TokenKind::Comment)
                .map_or(0, |it| it.end),
            Some(_) => self.peek().ok_or(Unexpected)?.start,
        };
        let (mut head_start, head_end) = match doc_start {
            Some(doc_start) => (doc_start.start, doc_start.end),
            None => (contents_start, contents_start),
        };
        if let Some(&first) = directives.first() {
            head_start = self.position_of(first).start.offset;
        }
        let head_position = self.position(head_start, head_end);
        let mut head_trailing_comment = None;
        if doc_start.is_some()
            && let Some(&first) = prop_tokens.first()
            && first.kind == TokenKind::Comment
            && self.point(first.start).line == head_position.end.line
        {
            head_trailing_comment = Some(self.transform_comment(first));
            prop_tokens.remove(0);
        }
        let head = self.new_node(Kind::DocumentHead, head_position);
        for directive in directives {
            self.add_child(head, directive);
        }
        if doc_start.is_some() {
            for comment in end_comment_candidates {
                append(&mut self.nodes, head, Which::EndComments, comment);
            }
        }
        self.node(head).trailing_comment = head_trailing_comment;
        if let Some(comment) = head_trailing_comment {
            self.own(head, comment);
        }

        // `transformDocumentBody`
        let content = match root {
            Some(root) => Some(self.transform_node(root, prop_tokens)?),
            None if has_properties => Some(self.transform_empty_node(&prop_tokens)?),
            None => {
                self.extract_comments(&prop_tokens);
                None
            }
        };
        let end_comments = self.take_end_comments(content);
        let rest = self.tokens.get(self.at..).unwrap_or_default();
        let next = rest.iter().find(|it| it.kind != TokenKind::Comment);
        if next.is_some_and(|it| it.kind == TokenKind::DocumentEnd) {
            self.take_comments();
        }
        let doc_end = self.take(TokenKind::DocumentEnd);
        let mut document_trailing_comment = None;
        if let Some(doc_end) = doc_end {
            let line = self.point(doc_end.start).line;
            if let Some(comment) = self.peek().filter(|it| it.kind == TokenKind::Comment)
                && self.point(comment.start).line == line
            {
                self.at += 1;
                document_trailing_comment = Some(self.transform_comment(comment));
            }
        }
        let body_end = match (doc_end, self.peek()) {
            (Some(doc_end), _) => doc_end.start.saturating_sub(1),
            (None, Some(next)) => next.start,
            (None, None) => self.text.len() as u32,
        };
        let mut body_start =
            content.map_or(body_end, |content| self.position_of(content).start.offset);
        if let Some(doc_start) = doc_start {
            let doc_start_end = doc_start.end + 1;
            if body_start < doc_start_end && doc_start_end <= body_end {
                body_start = doc_start_end;
            }
        }
        let body_position = self.position(body_start, body_end);
        let body = self.new_node(Kind::DocumentBody, body_position);
        if let Some(content) = content {
            self.add_child(body, content);
        }
        for comment in end_comments {
            append(&mut self.nodes, body, Which::EndComments, comment);
        }
        let document_end_point = match doc_end {
            Some(doc_end) => self.point(doc_end.end),
            None => body_position.end,
        };
        let document = self.new_node(
            Kind::Document,
            Position {
                start: head_position.start,
                end: document_end_point,
            },
        );
        let node = self.node(document);
        node.trailing_comment = document_trailing_comment;
        node.directives_end_marker = doc_start.is_some();
        node.document_end_marker = doc_end.is_some();
        if let Some(comment) = document_trailing_comment {
            self.own(document, comment);
        }
        self.add_child(document, head);
        self.add_child(document, body);
        Ok(document)
    }

    /// `transformDocuments`. For `yaml`, every `...` ends a document of its own.
    fn transform_documents(&mut self, documents: &[Expr]) -> Result<Vec<Id>> {
        let mut roots = documents.iter();
        let mut children = Vec::with_capacity(documents.len());
        loop {
            let rest = self.tokens.get(self.at..).unwrap_or_default();
            let next = rest.iter().find(|it| it.kind != TokenKind::Comment);
            let root = match next.map(|it| it.kind) {
                None if !children.is_empty() => break,
                Some(TokenKind::DocumentEnd) if !children.is_empty() => None,
                _ => Some(roots.next().ok_or(Unexpected)?),
            };
            children.push(self.transform_document(root)?);
        }
        self.take_comments();
        Ok(children)
    }
}

// ───────────────────────────── `attach.ts` ─────────────────────────────

#[derive(Copy, Clone, Default)]
struct Line {
    comment: Option<Id>,
    leading_attachable_node: Option<Id>,
    trailing_attachable_node: Option<Id>,
    trailing_node: Option<Id>,
}

fn init_node_table(nodes: &[Node<'_>], table: &mut [Line], id: Id, stack: &Stack) {
    if !stack.has_room() {
        return;
    }
    let node = &nodes[id.index()];
    let Position { start, end } = node.position;
    if start.offset == end.offset {
        return;
    }
    let column_of = |id: Id, is_start: bool| {
        let position = nodes[id.index()].position;
        if is_start {
            position.start.column
        } else {
            position.end.column
        }
    };
    let (start_line, end_line) = (start.line as usize - 1, end.line as usize - 1);
    if node.kind.has_leading_comments()
        && let Some(line) = table.get_mut(start_line)
        && line
            .leading_attachable_node
            .is_none_or(|it| start.column < column_of(it, true))
    {
        line.leading_attachable_node = Some(id);
    }
    if node.kind.has_trailing_comment()
        && end.column > 1
        && !matches!(node.kind, Kind::Document | Kind::DocumentHead)
        && let Some(line) = table.get_mut(end_line)
        && line
            .trailing_attachable_node
            .is_none_or(|it| end.column >= column_of(it, false))
    {
        line.trailing_attachable_node = Some(id);
    }
    if !matches!(
        node.kind,
        Kind::Root | Kind::Document | Kind::DocumentHead | Kind::DocumentBody
    ) {
        for index in [
            Some(end_line),
            (start_line != end_line).then_some(start_line),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(line) = table.get_mut(index)
                && line
                    .trailing_node
                    .is_none_or(|it| end.column >= column_of(it, false))
            {
                line.trailing_node = Some(id);
            }
        }
    }
    for child in items(nodes, node.children) {
        init_node_table(nodes, table, child, stack);
    }
}

/// `isExplicitMappingKey`
fn is_explicit_mapping_key(nodes: &[Node<'_>], id: Id) -> bool {
    let node = &nodes[id.index()];
    node.children.first().is_none_or(|child| {
        node.position.start.offset != nodes[child.index()].position.start.offset
    })
}

fn should_own_end_comment(nodes: &[Node<'_>], id: Id, comment: Position) -> bool {
    let node = &nodes[id.index()];
    if node.position.start.offset < comment.start.offset
        && node.position.end.offset > comment.end.offset
        && matches!(node.kind, Kind::FlowMapping | Kind::FlowSequence)
    {
        return node
            .children
            .last()
            .is_none_or(|last| comment.start.line > nodes[last.index()].position.end.line);
    }
    if comment.end.offset < node.position.end.offset {
        return false;
    }
    match node.kind {
        Kind::SequenceItem => comment.start.column > node.position.start.column,
        Kind::MappingKey | Kind::MappingValue => {
            let parent_column = node
                .parent
                .map_or(0, |parent| nodes[parent.index()].position.start.column);
            comment.start.column > parent_column
                && match (node.children.first(), node.children.len()) {
                    (None, _) => true,
                    (Some(child), 1) => !matches!(
                        nodes[child.index()].kind,
                        Kind::BlockFolded | Kind::BlockLiteral
                    ),
                    _ => false,
                }
                && (node.kind == Kind::MappingValue || is_explicit_mapping_key(nodes, id))
        }
        _ => false,
    }
}

/// `next_leading[line]`: the first line from the one with the index `line` on that has a
/// `leading_attachable_node`.
fn attach_comment(
    nodes: &mut [Node<'_>],
    table: &[Line],
    next_leading: &[u32],
    comment: Id,
    document: Id,
) -> Result<()> {
    let position = nodes[comment.index()].position;
    let comment_line = position.start.line as usize;
    let line_at = |line: usize| table.get(line.wrapping_sub(1)).copied().unwrap_or_default();
    if let Some(node) = line_at(comment_line).trailing_attachable_node {
        if nodes[node.index()]
            .trailing_comment
            .replace(comment)
            .is_some()
        {
            return Err(Unexpected);
        }
        nodes[comment.index()].parent = Some(node);
        return Ok(());
    }
    let document_position = nodes[document.index()].position;
    let mut line = comment_line;
    while line >= document_position.start.line as usize && line > 0 {
        let mut current = match line_at(line).trailing_node {
            Some(node) => node,
            // A comment in a line before, and what it belongs to.
            None => match line_at(line).comment.filter(|_| line != comment_line) {
                Some(other) => nodes[other.index()].parent.ok_or(Unexpected)?,
                None => {
                    line -= 1;
                    continue;
                }
            },
        };
        if matches!(nodes[current.index()].kind, Kind::Sequence | Kind::Mapping) {
            current = nodes[current.index()].children.first().ok_or(Unexpected)?;
        }
        if nodes[current.index()].kind == Kind::MappingItem {
            let children = nodes[current.index()].children;
            let (Some(key), Some(value), 2) = (children.first(), children.last(), children.len())
            else {
                return Err(Unexpected);
            };
            current = if is_explicit_mapping_key(nodes, key) {
                key
            } else {
                value
            };
        }
        loop {
            if should_own_end_comment(nodes, current, position) {
                append(nodes, current, Which::EndComments, comment);
                return Ok(());
            }
            match nodes[current.index()].parent {
                Some(parent) => current = parent,
                None => break,
            }
        }
        break;
    }
    // The first line after that of the comment, in the document.
    if let Some(&index) = next_leading.get(comment_line)
        && index < document_position.end.line
        && let Some(node) = table
            .get(index as usize)
            .and_then(|line| line.leading_attachable_node)
    {
        append(nodes, node, Which::LeadingComments, comment);
        return Ok(());
    }
    let body = nodes[document.index()]
        .children
        .last()
        .filter(|_| nodes[document.index()].children.len() > 1)
        .ok_or(Unexpected)?;
    append(nodes, body, Which::EndComments, comment);
    Ok(())
}

/// `updatePositions`. `has_properties`: there are comments, tags or anchors. Without them, everything in the body of
/// a document is where it is said to be from the start.
fn update_positions(nodes: &mut [Node<'_>], id: Id, has_properties: bool, stack: &Stack) {
    if !stack.has_room() {
        return;
    }
    let children = nodes[id.index()].children;
    let has_children_field = !matches!(
        nodes[id.index()].kind,
        Kind::Directive
            | Kind::Comment
            | Kind::Alias
            | Kind::Tag
            | Kind::Anchor
            | Kind::BlockFolded
            | Kind::BlockLiteral
            | Kind::Plain
            | Kind::QuoteDouble
            | Kind::QuoteSingle
    );
    if !has_children_field {
        return;
    }
    let mut child = children
        .first()
        .filter(|_| has_properties || nodes[id.index()].kind != Kind::DocumentBody);
    while let Some(id) = child {
        update_positions(nodes, id, has_properties, stack);
        child = nodes[id.index()].next;
    }
    if let (Kind::Document, Some(head), Some(body), 2) = (
        nodes[id.index()].kind,
        children.first(),
        children.last(),
        children.len(),
    ) {
        let (head_position, body_position) =
            (nodes[head.index()].position, nodes[body.index()].position);
        if head_position.start.offset == head_position.end.offset {
            nodes[head.index()].position = Position {
                start: body_position.start,
                end: body_position.start,
            };
        } else if body_position.start.offset == body_position.end.offset {
            nodes[body.index()].position = Position {
                start: head_position.end,
                end: head_position.end,
            };
        }
    }
    let mut position = nodes[id.index()].position;
    let mut update_start = |point: Point| {
        if point.offset < position.start.offset {
            position.start = point;
        }
    };
    let position_of = |id: Id| nodes[id.index()].position;
    let node = &nodes[id.index()];
    let first_child = children.first().map(|child| &nodes[child.index()]);
    update_start_points(node, first_child, &position_of, &mut update_start);
    let mut end = position.end;
    let mut update_end = |point: Point| {
        if point.offset > end.offset {
            end = point;
        }
    };
    if let Some(last) = node.end_comments.last() {
        update_end(position_of(last).end);
    }
    if let Some(last) = children.last() {
        update_end(position_of(last).end);
        if let Some(comment) = nodes[last.index()].trailing_comment {
            update_end(position_of(comment).end);
        }
    }
    position.end = end;
    nodes[id.index()].position = position;
}

fn update_start_points(
    node: &Node<'_>,
    first_child: Option<&Node<'_>>,
    position_of: &impl Fn(Id) -> Position,
    update_start: &mut impl FnMut(Point),
) {
    if let Some(first) = node.end_comments.first() {
        update_start(position_of(first).start);
    }
    if let Some(first_child) = first_child {
        update_start(first_child.position.start);
        for related in first_child
            .leading_comments
            .first()
            .into_iter()
            .chain(first_child.tag)
            .chain(first_child.anchor)
        {
            update_start(position_of(related).start);
        }
    }
}

/// `parse` of `yaml-unist-parser`.
pub(crate) fn build<'a>(
    text: &'a [u8],
    documents: &[Expr],
    tokens: &[SourceToken],
    stack: &Stack,
) -> std::result::Result<Tree<'a>, SyntaxError> {
    let mut line_starts = vec![0u32];
    let mut from = 0;
    while let Some(at) = strings::index_of_char_usize(&text[from..], b'\n') {
        from += at + 1;
        line_starts.push(from as u32);
    }
    let mut context = Context {
        text,
        tokens,
        at: 0,
        tags: Default::default(),
        is_ascii: text.is_ascii(),
        // Before the first.
        last_line: std::cell::Cell::new((0, 0, 0)),
        last_place: std::cell::Cell::new((0, 0)),
        line_starts,
        // A key, its `:` and its value are three tokens and five nodes.
        nodes: Vec::with_capacity(tokens.len() * 2 + 16),
        comments: Vec::new(),
        pending: Vec::new(),
        has_properties: false,
        stack,
    };
    // What has been made last is next to what cannot be.
    let children = context
        .transform_documents(documents)
        .map_err(|Unexpected| {
            let last = context.nodes.last();
            SyntaxError(
                Message::CannotBeFormatted,
                last.map_or(0, |it| it.position.start.offset),
            )
        })?;
    let root = context.new_node(Kind::Root, context.position(0, text.len() as u32));
    for &child in &children {
        context.add_child(root, child);
    }
    let Context {
        mut nodes,
        mut comments,
        has_properties,
        ..
    } = context;
    crate::sort::sort_by_key(&mut comments[..], |&comment| {
        nodes[comment.index()].position.start.offset
    });

    // `attachComments`, if there are comments to attach.
    if comments
        .iter()
        .all(|&comment| nodes[comment.index()].parent.is_some())
    {
        update_positions(
            &mut nodes,
            root,
            has_properties || !comments.is_empty(),
            stack,
        );
        return Ok(Tree { nodes, root });
    }
    let mut table = vec![Line::default(); nodes[root.index()].position.end.line as usize];
    for &comment in &comments {
        if let Some(line) = table.get_mut(nodes[comment.index()].position.start.line as usize - 1) {
            line.comment = Some(comment);
        }
    }
    init_node_table(&nodes, &mut table, root, stack);
    let mut next_leading = vec![u32::MAX; table.len()];
    for index in (0..table.len()).rev() {
        next_leading[index] = match table[index].leading_attachable_node {
            Some(_) => index as u32,
            None => next_leading.get(index + 1).copied().unwrap_or(u32::MAX),
        };
    }
    let mut rest_documents = &children[..];
    for &comment in &comments {
        if nodes[comment.index()].parent.is_some() {
            continue;
        }
        while let [first, _, ..] = rest_documents
            && nodes[comment.index()].position.start.line > nodes[first.index()].position.end.line
        {
            rest_documents = &rest_documents[1..];
        }
        let misplaced = SyntaxError(
            Message::MisplacedComment,
            nodes[comment.index()].position.start.offset,
        );
        attach_comment(
            &mut nodes,
            &table,
            &next_leading,
            comment,
            *rest_documents.first().ok_or(misplaced)?,
        )
        .map_err(|Unexpected| misplaced)?;
    }
    update_positions(&mut nodes, root, true, stack);
    Ok(Tree { nodes, root })
}
