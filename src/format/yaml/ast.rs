//! `yaml-unist-parser` 3.2: the tree that Prettier prints.

use super::compose::{Document, Node as Composed, NodeKind, Pair, ScalarType, SeqItem};
use super::cst::{Item, SourceToken, Token, TokenType};
use bun_core::strings;
use std::borrow::Cow;

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

/// An index into `Tree::nodes`.
pub(crate) type Id = u32;

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
    /// Of a comment, an alias, an anchor and a scalar that is not a block scalar. Of a directive: all of
    /// it.
    pub(crate) value: Cow<'a, [u8]>,
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
    std::iter::successors(list.first, |&id| nodes[id as usize].next)
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
    let node = &mut nodes[owner as usize];
    let list = match which {
        Which::Children => &mut node.children,
        Which::LeadingComments => &mut node.leading_comments,
        Which::MiddleComments => &mut node.middle_comments,
        Which::EndComments => &mut node.end_comments,
    };
    list.len += 1;
    match list.last.replace(item) {
        None => list.first = Some(item),
        Some(last) => nodes[last as usize].next = Some(item),
    }
    nodes[item as usize].parent = Some(owner);
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
        &self.nodes[id as usize]
    }
}

/// The properties of a node: tokens that are a comment, a tag or an anchor.
type Props = smallvec::SmallVec<[SourceToken; 4]>;

struct Context<'a> {
    text: &'a [u8],
    is_ascii: bool,
    /// Where the lines start.
    line_starts: Vec<u32>,
    /// The line that has been asked for last.
    last_line: std::cell::Cell<usize>,
    nodes: Vec<Node<'a>>,
    comments: Vec<Id>,
    /// The nodes whose parents are not made yet.
    pending: Vec<Id>,
    /// There is a tag or an anchor.
    has_properties: bool,
}

/// `tokens(..)`: without spaces and line breaks.
fn tokens(list: &[SourceToken]) -> impl Iterator<Item = SourceToken> + '_ {
    list.iter()
        .copied()
        .filter(|token| !matches!(token.kind, TokenType::Space | TokenType::Newline))
}

/// `maybeContentPropertyToken`
fn is_content_property(token: SourceToken) -> bool {
    matches!(
        token.kind,
        TokenType::Comment | TokenType::Tag | TokenType::Anchor
    )
}

/// `isEmptyNode`
fn is_empty_node(node: Option<&Composed<'_, '_>>, props: &[SourceToken]) -> bool {
    node.is_none_or(|node| {
        node.range[0] == node.range[1] && props.iter().all(|token| token.kind == TokenType::Comment)
    })
}

impl<'a> Context<'a> {
    /// `transformOffset`
    fn point(&self, offset: u32) -> Point {
        // Most of the time it is the same line as the last time, or the next one.
        let starts_at_or_before = |line: usize| {
            self.line_starts
                .get(line)
                .is_some_and(|&start| start <= offset)
        };
        let mut line = self.last_line.get();
        if !starts_at_or_before(line - 1) || starts_at_or_before(line + 1) {
            line = self.line_starts.partition_point(|&start| start <= offset);
        } else if starts_at_or_before(line) {
            line += 1;
        }
        self.last_line.set(line.max(1));
        let start = self
            .line_starts
            .get(line.wrapping_sub(1))
            .copied()
            .unwrap_or(0);
        let before = self
            .text
            .get(start as usize..offset as usize)
            .unwrap_or_default();
        // Columns count UTF-16 code units.
        let column = match self.is_ascii || before.is_ascii() {
            true => before.len(),
            false => {
                before.iter().filter(|&&b| b & 0xC0 != 0x80).count()
                    + before.iter().filter(|&&b| b >= 0xF0).count()
            }
        };
        Point {
            offset,
            line: line as u32,
            column: column as u32 + 1,
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
            value: Cow::Borrowed(b""),
            is_set_tag: false,
            chomping: Chomping::Clip,
            indent: None,
            directives_end_marker: false,
            document_end_marker: false,
        });
        self.nodes.len() as Id - 1
    }

    fn node(&mut self, id: Id) -> &mut Node<'a> {
        &mut self.nodes[id as usize]
    }

    fn position_of(&self, id: Id) -> Position {
        self.nodes[id as usize].position
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
        let id = self.new_node(Kind::Comment, self.position(token.offset, token.end));
        self.node(id).value = Cow::Borrowed(
            self.text
                .get(token.offset as usize + 1..token.end as usize)
                .unwrap_or_default(),
        );
        self.comments.push(id);
        id
    }

    /// `extractComments`, where anything else is an error unless `allows` says otherwise.
    fn extract_comments(
        &mut self,
        list: &[SourceToken],
        allows: impl Fn(TokenType) -> bool,
    ) -> Result<()> {
        for token in tokens(list) {
            match token.kind {
                TokenType::Comment => {
                    self.transform_comment(token);
                }
                kind if allows(kind) => {}
                _ => return Err(Unexpected),
            }
        }
        Ok(())
    }

    /// `transformContentProperties`, for the node `id` that is made of `node`.
    fn transform_content_properties(
        &mut self,
        id: Id,
        node: &Composed<'_, 'a>,
        props: &[SourceToken],
    ) -> Result<()> {
        let mut first_tag_or_anchor_start = None;
        self.has_properties |= !props.is_empty();
        for &token in props {
            match token.kind {
                TokenType::Tag => {
                    first_tag_or_anchor_start.get_or_insert(token.offset);
                    let tag = self.new_node(Kind::Tag, self.position(token.offset, token.end));
                    self.node(tag).is_set_tag = node.has_set_tag;
                    self.node(id).tag = self.own(id, tag);
                }
                TokenType::Anchor => {
                    first_tag_or_anchor_start.get_or_insert(token.offset);
                    let anchor =
                        self.new_node(Kind::Anchor, self.position(token.offset, token.end));
                    let (start, end) = node.anchor.ok_or(Unexpected)?;
                    self.node(anchor).value = Cow::Borrowed(
                        self.text
                            .get(start as usize..end as usize)
                            .unwrap_or_default(),
                    );
                    self.node(id).anchor = self.own(id, anchor);
                }
                TokenType::Comment => {
                    let comment = self.transform_comment(token);
                    if first_tag_or_anchor_start.is_some_and(|start| start <= token.offset)
                        && token.end <= node.range[0]
                    {
                        append(&mut self.nodes, id, Which::MiddleComments, comment);
                    }
                }
                _ => return Err(Unexpected),
            }
        }
        Ok(())
    }

    /// The `end` of the token of a scalar or an alias.
    fn extract_end_comments(&mut self, node: &Composed<'_, 'a>) -> Result<()> {
        match node.src_token {
            Some(Token::FlowScalar { end, .. }) => {
                self.extract_comments(end.as_deref().unwrap_or_default(), |_| false)
            }
            _ => Err(Unexpected),
        }
    }

    /// `transformNode`
    fn transform_node(&mut self, node: &Composed<'_, 'a>, props: &[SourceToken]) -> Result<Id> {
        let [start, end, _] = node.range;
        match &node.kind {
            NodeKind::Alias => {
                self.extract_end_comments(node)?;
                let id = self.new_node(Kind::Alias, self.position(start, end));
                self.transform_content_properties(id, node, props)?;
                self.node(id).value.clone_from(&node.source);
                Ok(id)
            }
            NodeKind::Map { flow: true, items } => self.transform_flow_map(node, items, props),
            NodeKind::Map { flow: false, items } => self.transform_map(node, items, props),
            NodeKind::Seq { flow: true, items } => self.transform_flow_seq(node, items, props),
            NodeKind::Seq { flow: false, items } => self.transform_seq(node, items, props),
            NodeKind::Scalar(kind @ (ScalarType::BlockFolded | ScalarType::BlockLiteral)) => {
                let Some(Token::BlockScalar {
                    props: scalar_props,
                    ..
                }) = node.src_token
                else {
                    return Err(Unexpected);
                };
                let mut header = None;
                let mut indicator_comment = None;
                for token in tokens(scalar_props) {
                    match token.kind {
                        TokenType::Comment => {
                            indicator_comment = Some(self.transform_comment(token))
                        }
                        TokenType::BlockScalarHeader => header = Some(token),
                        _ => return Err(Unexpected),
                    }
                }
                // `/([+-]?)(\d*)([+-]?)$/`
                let header = header.ok_or(Unexpected)?.source(self.text);
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
                let kind = if *kind == ScalarType::BlockFolded {
                    Kind::BlockFolded
                } else {
                    Kind::BlockLiteral
                };
                let id = self.new_node(kind, self.position(start, end));
                self.transform_content_properties(id, node, props)?;
                let block = self.node(id);
                block.indent = (!digits.is_empty()).then(|| {
                    digits
                        .iter()
                        .fold(0u32, |all, b| all.saturating_mul(10) + u32::from(b - b'0'))
                });
                block.chomping = match last_sign.or(first_sign) {
                    Some(b'+') => Chomping::Keep,
                    Some(_) => Chomping::Strip,
                    None => Chomping::Clip,
                };
                block.indicator_comment = indicator_comment;
                if let Some(comment) = indicator_comment {
                    self.own(id, comment);
                }
                Ok(id)
            }
            NodeKind::Scalar(ScalarType::Plain) if start == end => {
                // `findLastCharIndex(text, start - 1, /\S/) + 1`
                let before = self.text.get(..start as usize).unwrap_or_default();
                let index = crate::text::trim_end(before).len() as u32;
                let id = self.new_node(Kind::Plain, self.position(index, index));
                self.transform_content_properties(id, node, props)?;
                Ok(id)
            }
            NodeKind::Scalar(kind) => {
                self.extract_end_comments(node)?;
                let kind = match kind {
                    ScalarType::QuoteDouble => Kind::QuoteDouble,
                    ScalarType::QuoteSingle => Kind::QuoteSingle,
                    _ => Kind::Plain,
                };
                let id = self.new_node(kind, self.position(start, end));
                self.transform_content_properties(id, node, props)?;
                self.node(id).value.clone_from(&node.source);
                Ok(id)
            }
        }
    }

    /// The items of the token that no item of the node has been made of.
    fn extract_comments_of_rest(
        &mut self,
        items: &[Item],
        from: usize,
        allows_comma: bool,
    ) -> Result<()> {
        for item in items.get(from..).unwrap_or_default() {
            self.extract_comments(&item.start, |kind| allows_comma && kind == TokenType::Comma)?;
        }
        Ok(())
    }

    fn transform_flow_map(
        &mut self,
        node: &Composed<'_, 'a>,
        pairs: &[Pair<'_, 'a>],
        props: &[SourceToken],
    ) -> Result<Id> {
        let Some(Token::FlowCollection {
            start, items, end, ..
        }) = node.src_token
        else {
            return Err(Unexpected);
        };
        let children = self.pending.len();
        for (pair, item) in pairs.iter().zip(items) {
            let child = self.transform_pair(pair, item, Kind::FlowMappingItem)?;
            self.pending.push(child);
        }
        self.extract_comments_of_rest(items, pairs.len(), true)?;
        self.finish_flow_collection(
            Kind::FlowMapping,
            TokenType::FlowMapEnd,
            node,
            *start,
            end,
            children,
            props,
        )
    }

    fn finish_flow_collection(
        &mut self,
        kind: Kind,
        end_kind: TokenType,
        node: &Composed<'_, 'a>,
        start: SourceToken,
        end: &[SourceToken],
        // Where they start in `self.pending`.
        children: usize,
        props: &[SourceToken],
    ) -> Result<Id> {
        self.extract_comments(end, |kind| kind == end_kind)?;
        let close = tokens(end)
            .filter(|token| token.kind == end_kind)
            .last()
            .ok_or(Unexpected)?;
        let id = self.new_node(kind, self.position(start.offset, close.end));
        self.transform_content_properties(id, node, props)?;
        self.add_pending_children(id, children);
        Ok(id)
    }

    fn transform_flow_seq(
        &mut self,
        node: &Composed<'_, 'a>,
        nodes: &[SeqItem<'_, 'a>],
        props: &[SourceToken],
    ) -> Result<Id> {
        let Some(Token::FlowCollection {
            start, items, end, ..
        }) = node.src_token
        else {
            return Err(Unexpected);
        };
        let children = self.pending.len();
        for (item_node, item) in nodes.iter().zip(items) {
            let child = match item_node {
                SeqItem::Pair(pair) => self.transform_pair(pair, item, Kind::FlowMappingItem)?,
                // `[ key: value ]`
                SeqItem::Node(Composed {
                    kind: NodeKind::Map { items: pairs, .. },
                    src_token: None,
                    ..
                }) => self.transform_pair(
                    pairs.last().ok_or(Unexpected)?,
                    item,
                    Kind::FlowMappingItem,
                )?,
                SeqItem::Node(item_node) => {
                    let mut item_props = Props::new();
                    for token in tokens(&item.start) {
                        match token.kind {
                            _ if is_content_property(token) => item_props.push(token),
                            TokenType::Comma => {}
                            _ => return Err(Unexpected),
                        }
                    }
                    let content = self.transform_node(item_node, &item_props)?;
                    let id = self.new_node(Kind::FlowSequenceItem, self.position_of(content));
                    self.add_child(id, content);
                    id
                }
            };
            self.pending.push(child);
        }
        self.extract_comments_of_rest(items, nodes.len(), true)?;
        self.finish_flow_collection(
            Kind::FlowSequence,
            TokenType::FlowSeqEnd,
            node,
            *start,
            end,
            children,
            props,
        )
    }

    fn transform_map(
        &mut self,
        node: &Composed<'_, 'a>,
        pairs: &[Pair<'_, 'a>],
        props: &[SourceToken],
    ) -> Result<Id> {
        let Some(Token::BlockMap { items, .. }) = node.src_token else {
            return Err(Unexpected);
        };
        let children = self.pending.len();
        for (pair, item) in pairs.iter().zip(items) {
            let child = self.transform_pair(pair, item, Kind::MappingItem)?;
            self.pending.push(child);
        }
        self.extract_comments_of_rest(items, pairs.len(), false)?;
        let (&first, &last) = self
            .pending
            .get(children)
            .zip(self.pending.last())
            .ok_or(Unexpected)?;
        let position = Position {
            start: self.position_of(first).start,
            end: self.position_of(last).end,
        };
        let id = self.new_node(Kind::Mapping, position);
        self.transform_content_properties(id, node, props)?;
        self.add_pending_children(id, children);
        Ok(id)
    }

    fn transform_seq(
        &mut self,
        node: &Composed<'_, 'a>,
        nodes: &[SeqItem<'_, 'a>],
        props: &[SourceToken],
    ) -> Result<Id> {
        let Some(Token::BlockSeq { items, .. }) = node.src_token else {
            return Err(Unexpected);
        };
        let children = self.pending.len();
        for (item_node, item) in nodes.iter().zip(items) {
            let mut item_props = Props::new();
            let mut indicator = None;
            for token in tokens(&item.start) {
                match token.kind {
                    _ if is_content_property(token) => item_props.push(token),
                    TokenType::SeqItemInd => indicator = Some(token),
                    _ => return Err(Unexpected),
                }
            }
            // `transformItemValue`
            let content = match item_node {
                SeqItem::Node(item_node) if is_empty_node(Some(item_node), &item_props) => {
                    self.extract_comments(&item_props, |_| false)?;
                    None
                }
                SeqItem::Node(item_node) => Some(self.transform_node(item_node, &item_props)?),
                SeqItem::Pair(pair) => {
                    let mapping_item = self.transform_pair(
                        pair,
                        pair.src_token.ok_or(Unexpected)?,
                        Kind::MappingItem,
                    )?;
                    let mapping = self.new_node(Kind::Mapping, self.position_of(mapping_item));
                    self.transform_content_properties(mapping, &pair.key, &item_props)?;
                    self.add_child(mapping, mapping_item);
                    Some(mapping)
                }
            };
            let position = Position {
                start: match (indicator, content) {
                    (Some(indicator), _) => self.point(indicator.offset),
                    (None, Some(content)) => self.position_of(content).start,
                    (None, None) => return Err(Unexpected),
                },
                end: match (content, indicator) {
                    (Some(content), _) => self.position_of(content).end,
                    (None, Some(indicator)) => self.point(indicator.end),
                    (None, None) => return Err(Unexpected),
                },
            };
            let id = self.new_node(Kind::SequenceItem, position);
            if let Some(content) = content {
                self.add_child(id, content);
            }
            self.pending.push(id);
        }
        self.extract_comments_of_rest(items, nodes.len(), false)?;
        let (&first, &last) = self
            .pending
            .get(children)
            .zip(self.pending.last())
            .ok_or(Unexpected)?;
        let position = Position {
            start: self.position_of(first).start,
            end: self.position_of(last).end,
        };
        let id = self.new_node(Kind::Sequence, position);
        self.transform_content_properties(id, node, props)?;
        self.add_pending_children(id, children);
        Ok(id)
    }

    /// `transformPair`. `kind`: of the item.
    fn transform_pair(&mut self, pair: &Pair<'_, 'a>, item: &Item, kind: Kind) -> Result<Id> {
        let mut key_props = Props::new();
        let mut explicit_key_ind = None;
        for token in tokens(&item.start) {
            match token.kind {
                _ if is_content_property(token) => key_props.push(token),
                TokenType::ExplicitKeyInd => explicit_key_ind = Some(token),
                TokenType::Comma => {}
                _ => return Err(Unexpected),
            }
        }
        let mut value_props = Props::new();
        let mut map_value_ind = None;
        for token in tokens(item.sep.as_deref().unwrap_or_default()) {
            match token.kind {
                _ if is_content_property(token) => value_props.push(token),
                TokenType::MapValueInd => map_value_ind = Some(token),
                _ => return Err(Unexpected),
            }
        }
        let key_start = explicit_key_ind
            .map(|it| it.offset)
            .or_else(|| item.key.as_ref().map(|key| key.offset()))
            .or_else(|| map_value_ind.map(|it| it.offset))
            .or_else(|| item.value.as_ref().map(|value| value.offset()))
            .ok_or(Unexpected)?;
        let key_end = match (&item.key, explicit_key_ind) {
            (Some(_), _) => pair.key.range[1],
            (None, Some(indicator)) => indicator.end,
            (None, None) => key_start,
        };
        let value_start = pair.value.as_ref().map(|value| {
            map_value_ind
                .map(|it| it.offset)
                .or_else(|| item.value.as_ref().map(|it| it.offset()))
                .unwrap_or(value.range[0])
        });

        // `transformAstPair`
        let key_content = match is_empty_node(Some(&pair.key), &key_props) {
            true => {
                self.extract_comments(&key_props, |_| true)?;
                None
            }
            false => Some(self.transform_node(&pair.key, &key_props)?),
        };
        let value_content = match (
            &pair.value,
            is_empty_node(pair.value.as_ref(), &value_props),
        ) {
            (Some(value), false) => Some(self.transform_node(value, &value_props)?),
            _ => {
                self.extract_comments(&value_props, |_| true)?;
                None
            }
        };
        let key_position = self.position(
            key_start,
            key_content.map_or(key_end, |it| self.position_of(it).end.offset),
        );
        let mapping_key = self.new_node(Kind::MappingKey, key_position);
        if let Some(content) = key_content {
            self.add_child(mapping_key, content);
        }
        let value_position = match (value_start, value_content) {
            (Some(start), Some(content)) => {
                self.position(start, self.position_of(content).end.offset)
            }
            (Some(start), None) => self.position(start, start + 1),
            (None, Some(content)) => {
                let position = self.position_of(content);
                self.position(position.start.offset, position.end.offset)
            }
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
}

/// What `transformDocuments` collects for a document.
struct DocumentData<'t, 'a> {
    tokens_before_body: Vec<&'t Token>,
    cst_node: Option<&'t Token>,
    node: &'t Document<'t, 'a>,
    tokens_after_body: Vec<SourceToken>,
    document_end: Option<&'t Token>,
}

impl<'a> Context<'a> {
    fn transform_document(&mut self, data: &DocumentData<'_, 'a>) -> Result<Id> {
        let (cst_start, cst_end) = match data.cst_node {
            Some(Token::Document { start, end, .. }) => {
                (&start[..], end.as_deref().unwrap_or_default())
            }
            _ => (&[][..], &[][..]),
        };

        // `transformDocumentHead`
        let mut directives: Vec<Id> = Vec::new();
        let mut end_comment_candidates: Vec<Id> = Vec::new();
        for token in &data.tokens_before_body {
            match token {
                Token::Source(token) => {
                    let comment = self.transform_comment(*token);
                    let position = self.position_of(comment);
                    match directives.last().copied() {
                        Some(last)
                            if self.position_of(last).end.line == position.start.line
                                && self.nodes[last as usize].trailing_comment.is_none() =>
                        {
                            let directive = self.node(last);
                            directive.trailing_comment = Some(comment);
                            directive.position.end = position.end;
                            self.own(last, comment);
                        }
                        _ => end_comment_candidates.push(comment),
                    }
                }
                Token::Directive(token) => {
                    let directive =
                        self.new_node(Kind::Directive, self.position(token.offset, token.end));
                    self.node(directive).value = Cow::Borrowed(token.source(self.text));
                    directives.push(directive);
                    end_comment_candidates.clear();
                }
                _ => return Err(Unexpected),
            }
        }
        let mut between_tokens: Vec<SourceToken> = Vec::new();
        let mut doc_start: Option<SourceToken> = None;
        for token in tokens(cst_start) {
            between_tokens.push(token);
            if doc_start.is_none() && token.kind == TokenType::DocStart {
                for token in between_tokens.drain(..) {
                    if token.kind == TokenType::Comment {
                        let comment = self.transform_comment(token);
                        end_comment_candidates.push(comment);
                    }
                }
                doc_start = Some(token);
            }
        }
        let contents = data.node.contents.as_ref();
        let (mut head_start, head_end) = match (doc_start, contents) {
            (Some(doc_start), _) => (doc_start.offset, doc_start.end),
            (None, Some(contents)) => (contents.range[0], contents.range[0]),
            (None, None) => (data.node.range[0], data.node.range[0]),
        };
        if let Some(&first) = directives.first() {
            head_start = self.position_of(first).start.offset;
        }
        let head_position = self.position(head_start, head_end);
        let mut head_trailing_comment = None;
        if doc_start.is_some()
            && let Some(&first) = between_tokens.first()
            && first.kind == TokenType::Comment
            && self.point(first.offset).line == head_position.end.line
        {
            head_trailing_comment = Some(self.transform_comment(first));
            between_tokens.remove(0);
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
        let (doc_end, doc_end_end) = match data.document_end {
            Some(Token::DocEnd { token, end }) => {
                (Some(*token), end.as_deref().unwrap_or_default())
            }
            _ => (None, &[][..]),
        };
        let prop_tokens = between_tokens;
        if !prop_tokens.iter().all(|&token| is_content_property(token)) {
            return Err(Unexpected);
        }
        self.extract_comments(&data.tokens_after_body, |_| false)?;
        let doc_end_point = doc_end.map(|token| self.point(token.offset));
        let mut end_comments = Vec::new();
        let mut document_trailing_comment = None;
        if data.cst_node.is_some() {
            for token in tokens(cst_end).chain(tokens(doc_end_end)) {
                if token.kind != TokenType::Comment {
                    return Err(Unexpected);
                }
                let comment = self.transform_comment(token);
                let line = self.position_of(comment).start.line;
                match doc_end_point {
                    Some(point) if point.line == line => {
                        if document_trailing_comment.replace(comment).is_some() {
                            return Err(Unexpected);
                        }
                    }
                    Some(point) if line < point.line => end_comments.push(comment),
                    Some(_) => {}
                    None => end_comments.push(comment),
                }
            }
        }
        let has_content = contents.is_some_and(|contents| {
            contents.range[0] < contents.range[1]
                || prop_tokens
                    .iter()
                    .any(|token| matches!(token.kind, TokenType::Tag | TokenType::Anchor))
        });
        let content = match (contents, has_content) {
            (Some(contents), true) => Some(self.transform_node(contents, &prop_tokens)?),
            _ => {
                self.extract_comments(&prop_tokens, |_| false)?;
                None
            }
        };
        let text_len = self.text.len() as u32;
        let body_end = match doc_end {
            Some(doc_end) => doc_end.offset.saturating_sub(1),
            // `findCharIndex(text, document.range[2], /\S/) ?? text.length`
            None => {
                let rest = self
                    .text
                    .get(data.node.range[2] as usize..)
                    .unwrap_or_default();
                text_len - crate::text::trim_start(rest).len() as u32
            }
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

    /// `transformDocuments`
    fn transform_documents<'t>(
        &mut self,
        documents: &'t [Document<'t, 'a>],
        cst_tokens: &'t [Token],
    ) -> Result<Vec<Id>> {
        let mut data: Vec<DocumentData<'t, 'a>> = Vec::new();
        let mut buffer_comments: Vec<&'t Token> = Vec::new();
        let mut tokens_before_body: Vec<&'t Token> = Vec::new();
        let source_tokens = |tokens: &mut Vec<&'t Token>| -> Vec<SourceToken> {
            tokens
                .drain(..)
                .filter_map(|token| match token {
                    Token::Source(token) => Some(*token),
                    _ => None,
                })
                .collect()
        };
        for token in cst_tokens {
            match token {
                Token::Source(source) if source.kind == TokenType::Comment => {
                    buffer_comments.push(token)
                }
                Token::Source(_) => {}
                Token::Document { .. } => {
                    let node = documents.get(data.len()).ok_or(Unexpected)?;
                    tokens_before_body.append(&mut buffer_comments);
                    data.push(DocumentData {
                        tokens_before_body: std::mem::take(&mut tokens_before_body),
                        cst_node: Some(token),
                        node,
                        tokens_after_body: Vec::new(),
                        document_end: None,
                    });
                }
                Token::Directive(_) => {
                    tokens_before_body.append(&mut buffer_comments);
                    tokens_before_body.push(token);
                }
                Token::DocEnd { .. } => {
                    let current = data
                        .last_mut()
                        .filter(|it| it.document_end.is_none())
                        .ok_or(Unexpected)?;
                    current.tokens_after_body = source_tokens(&mut buffer_comments);
                    current.document_end = Some(token);
                }
                _ => {}
            }
        }
        if !tokens_before_body.is_empty() {
            return Err(Unexpected);
        }
        if !buffer_comments.is_empty() {
            if data.is_empty() {
                data.push(DocumentData {
                    tokens_before_body: std::mem::take(&mut buffer_comments),
                    cst_node: None,
                    node: documents.first().ok_or(Unexpected)?,
                    tokens_after_body: Vec::new(),
                    document_end: None,
                });
            }
            if let Some(current) = data.last_mut() {
                current
                    .tokens_after_body
                    .extend(source_tokens(&mut buffer_comments));
            }
        }
        data.iter()
            .map(|data| self.transform_document(data))
            .collect()
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

fn init_node_table(nodes: &[Node<'_>], table: &mut [Line], id: Id) {
    let node = &nodes[id as usize];
    let Position { start, end } = node.position;
    if start.offset == end.offset {
        return;
    }
    let column_of = |id: Id, is_start: bool| {
        let position = nodes[id as usize].position;
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
        init_node_table(nodes, table, child);
    }
}

/// `isExplicitMappingKey`
fn is_explicit_mapping_key(nodes: &[Node<'_>], id: Id) -> bool {
    let node = &nodes[id as usize];
    node.children.first().is_none_or(|child| {
        node.position.start.offset != nodes[child as usize].position.start.offset
    })
}

fn should_own_end_comment(nodes: &[Node<'_>], id: Id, comment: Position) -> bool {
    let node = &nodes[id as usize];
    if node.position.start.offset < comment.start.offset
        && node.position.end.offset > comment.end.offset
        && matches!(node.kind, Kind::FlowMapping | Kind::FlowSequence)
    {
        return node
            .children
            .last()
            .is_none_or(|last| comment.start.line > nodes[last as usize].position.end.line);
    }
    if comment.end.offset < node.position.end.offset {
        return false;
    }
    match node.kind {
        Kind::SequenceItem => comment.start.column > node.position.start.column,
        Kind::MappingKey | Kind::MappingValue => {
            let parent_column = node
                .parent
                .map_or(0, |parent| nodes[parent as usize].position.start.column);
            comment.start.column > parent_column
                && match (node.children.first(), node.children.len()) {
                    (None, _) => true,
                    (Some(child), 1) => !matches!(
                        nodes[child as usize].kind,
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
    let position = nodes[comment as usize].position;
    let comment_line = position.start.line as usize;
    let line_at = |line: usize| table.get(line.wrapping_sub(1)).copied().unwrap_or_default();
    if let Some(node) = line_at(comment_line).trailing_attachable_node {
        if nodes[node as usize]
            .trailing_comment
            .replace(comment)
            .is_some()
        {
            return Err(Unexpected);
        }
        nodes[comment as usize].parent = Some(node);
        return Ok(());
    }
    let document_position = nodes[document as usize].position;
    let mut line = comment_line;
    while line >= document_position.start.line as usize && line > 0 {
        let mut current = match line_at(line).trailing_node {
            Some(node) => node,
            // A comment in a line before, and what it belongs to.
            None => match line_at(line).comment.filter(|_| line != comment_line) {
                Some(other) => nodes[other as usize].parent.ok_or(Unexpected)?,
                None => {
                    line -= 1;
                    continue;
                }
            },
        };
        if matches!(nodes[current as usize].kind, Kind::Sequence | Kind::Mapping) {
            current = nodes[current as usize].children.first().ok_or(Unexpected)?;
        }
        if nodes[current as usize].kind == Kind::MappingItem {
            let children = nodes[current as usize].children;
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
            match nodes[current as usize].parent {
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
    let body = nodes[document as usize]
        .children
        .last()
        .filter(|_| nodes[document as usize].children.len() > 1)
        .ok_or(Unexpected)?;
    append(nodes, body, Which::EndComments, comment);
    Ok(())
}

/// `updatePositions`. `has_properties`: there are comments, tags or anchors. Without them, everything in the body of
/// a document is where it is said to be from the start.
fn update_positions(nodes: &mut [Node<'_>], id: Id, has_properties: bool) {
    let children = nodes[id as usize].children;
    let has_children_field = !matches!(
        nodes[id as usize].kind,
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
        .filter(|_| has_properties || nodes[id as usize].kind != Kind::DocumentBody);
    while let Some(id) = child {
        update_positions(nodes, id, has_properties);
        child = nodes[id as usize].next;
    }
    if let (Kind::Document, Some(head), Some(body), 2) = (
        nodes[id as usize].kind,
        children.first(),
        children.last(),
        children.len(),
    ) {
        let (head_position, body_position) =
            (nodes[head as usize].position, nodes[body as usize].position);
        if head_position.start.offset == head_position.end.offset {
            nodes[head as usize].position = Position {
                start: body_position.start,
                end: body_position.start,
            };
        } else if body_position.start.offset == body_position.end.offset {
            nodes[body as usize].position = Position {
                start: head_position.end,
                end: head_position.end,
            };
        }
    }
    let mut position = nodes[id as usize].position;
    let mut update_start = |point: Point| {
        if point.offset < position.start.offset {
            position.start = point;
        }
    };
    let position_of = |id: Id| nodes[id as usize].position;
    let node = &nodes[id as usize];
    let first_child = children.first().map(|child| &nodes[child as usize]);
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
        if let Some(comment) = nodes[last as usize].trailing_comment {
            update_end(position_of(comment).end);
        }
    }
    position.end = end;
    nodes[id as usize].position = position;
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

/// `parse` of `yaml-unist-parser`, from the results of `yaml`.
pub(crate) fn build<'a>(
    text: &'a [u8],
    documents: &[Document<'_, 'a>],
    cst_tokens: &[Token],
) -> Result<Tree<'a>> {
    let mut line_starts = vec![0u32];
    let mut from = 0;
    while let Some(at) = strings::index_of_char_usize(&text[from..], b'\n') {
        from += at + 1;
        line_starts.push(from as u32);
    }
    let mut context = Context {
        text,
        is_ascii: text.is_ascii(),
        line_starts,
        last_line: std::cell::Cell::new(1),
        nodes: Vec::with_capacity(text.len() / 4 + 8),
        comments: Vec::new(),
        pending: Vec::new(),
        has_properties: false,
    };
    let children = context.transform_documents(documents, cst_tokens)?;
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
    comments.sort_by_key(|&comment| nodes[comment as usize].position.start.offset);

    // `attachComments`, if there are comments to attach.
    if comments
        .iter()
        .all(|&comment| nodes[comment as usize].parent.is_some())
    {
        update_positions(&mut nodes, root, has_properties || !comments.is_empty());
        return Ok(Tree { nodes, root });
    }
    let mut table = vec![Line::default(); nodes[root as usize].position.end.line as usize];
    for &comment in &comments {
        if let Some(line) = table.get_mut(nodes[comment as usize].position.start.line as usize - 1)
        {
            line.comment = Some(comment);
        }
    }
    init_node_table(&nodes, &mut table, root);
    let mut next_leading = vec![u32::MAX; table.len()];
    for index in (0..table.len()).rev() {
        next_leading[index] = match table[index].leading_attachable_node {
            Some(_) => index as u32,
            None => next_leading.get(index + 1).copied().unwrap_or(u32::MAX),
        };
    }
    let mut rest_documents = &children[..];
    for &comment in &comments {
        if nodes[comment as usize].parent.is_some() {
            continue;
        }
        while let [first, _, ..] = rest_documents
            && nodes[comment as usize].position.start.line
                > nodes[*first as usize].position.end.line
        {
            rest_documents = &rest_documents[1..];
        }
        attach_comment(
            &mut nodes,
            &table,
            &next_leading,
            comment,
            *rest_documents.first().ok_or(Unexpected)?,
        )?;
    }
    update_positions(&mut nodes, root, true);
    Ok(Tree { nodes, root })
}
