//! Comments, plus the neighboring tokens and nodes the parser recorded for each one.

use super::*;
use bun_sema::hir::NodeData;

/// A `//` or `/* */` comment.
#[derive(Copy, Clone)]
pub struct Comment<'a> {
    file: &'a File<'a>,
    id: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum NodeOrName<'a> {
    Node(Node<'a>),
    /// An identifier or a literal key, identified by its start offset.
    Name(u32),
}

fn node_from_data<'a>(file: &'a File<'a>, data: NodeData) -> Option<Node<'a>> {
    Some(match data {
        NodeData::Expr(id) => Expr::new(file, id).into(),
        NodeData::Stmt(id) => Stmt::new(file, id).into(),
        NodeData::Type(id) => TypeNode::new(file, id).into(),
        NodeData::Pat(id) => Pat::new(file, id).into(),
        NodeData::PatProp(id) => PatProp::new(file, id).into(),
        NodeData::PatElem(id) => PatElem::new(file, id).into(),
        NodeData::Param(id) => Param::new(file, id).into(),
        NodeData::TypeParam(id) => TypeParam::new(file, id).into(),
        NodeData::Member(id) => Member::new(file, id).into(),
        NodeData::Prop(id) => Prop::new(file, id).into(),
        NodeData::VarDecl(id) => VarDecl::new(file, id).into(),
        NodeData::Case(id) => Case::new(file, id).into(),
        NodeData::EnumMember(id) => EnumMember::new(file, id).into(),
        NodeData::ImportSpec(id) => ImportSpec::new(file, id).into(),
        NodeData::ExportSpec(id) => ExportSpec::new(file, id).into(),
        NodeData::TupleElem(id) => TupleElem::new(file, id).into(),
        _ => return None,
    })
}

impl<'a> Comment<'a> {
    /// Index into the file's comments.
    #[inline]
    pub fn id(self) -> u32 {
        self.id
    }

    fn raw(self) -> hir::Comment {
        const MISSING: hir::Comment = hir::Comment {
            pos: 0,
            end: 0,
            prev_token_end: 0,
            next_token_start: 0,
            is_block: false,
            is_multiline: false,
            has_newline_before: false,
            has_newline_after: false,
            enclosing_node: hir::NodeOrName::None,
            preceding_node: hir::NodeOrName::None,
            following_node: hir::NodeOrName::None,
        };
        (self.file.hir.comments.get(self.id as usize)).map_or(MISSING, |comment| *comment)
    }

    pub fn span(self) -> Span {
        let raw = self.raw();
        Span::new(raw.pos, raw.end)
    }

    /// The source text, including the `//` or the `/*` and `*/`.
    pub fn text(self) -> &'a [u8] {
        self.file.slice(self.span())
    }

    /// The text between `/*` and `*/`, or after `//`, `<!--` or `-->`.
    pub fn content(self) -> &'a [u8] {
        match self.text() {
            [b'/', b'*', content @ .., b'*', b'/']
            | [b'/', b'/', content @ ..]
            | [b'<', b'!', b'-', b'-', content @ ..]
            | [b'-', b'-', b'>', content @ ..] => content,
            text => text,
        }
    }

    /// `// comment`
    pub fn is_line(self) -> bool {
        !self.raw().is_block
    }

    /// `/* comment */`
    pub fn is_block(self) -> bool {
        self.raw().is_block
    }

    /// A block comment that spans more than one line.
    pub fn is_multiline_block(self) -> bool {
        self.raw().is_multiline
    }

    /// True if there's a line break between the comment and the token or comment before it.
    pub fn has_newline_before(self) -> bool {
        self.raw().has_newline_before
    }

    /// True if there's a line break between the comment and the token or comment after it.
    pub fn has_newline_after(self) -> bool {
        self.raw().has_newline_after
    }

    /// End of the previous token, or 0 if there is none.
    pub fn prev_token_end(self) -> u32 {
        self.raw().prev_token_end
    }

    /// Start of the next token, or the length of the text if there is none.
    pub fn next_token_start(self) -> u32 {
        self.raw().next_token_start
    }

    fn node_or_name(self, raw: hir::NodeOrName) -> Option<NodeOrName<'a>> {
        match raw {
            hir::NodeOrName::None => None,
            hir::NodeOrName::Node(data) => node_from_data(self.file, data).map(NodeOrName::Node),
            hir::NodeOrName::Name(start) => Some(NodeOrName::Name(start)),
        }
    }

    /// The smallest node that contains the comment. `None` at the top level of the file.
    pub fn enclosing_node(self) -> Option<Node<'a>> {
        match self.raw().enclosing_node {
            hir::NodeOrName::Node(data) => node_from_data(self.file, data),
            _ => None,
        }
    }

    /// The closest child of the enclosing node that ends before the comment.
    pub fn preceding_node(self) -> Option<NodeOrName<'a>> {
        self.node_or_name(self.raw().preceding_node)
    }

    /// The closest child of the enclosing node that starts after the comment.
    pub fn following_node(self) -> Option<NodeOrName<'a>> {
        self.node_or_name(self.raw().following_node)
    }
}

impl<'a> File<'a> {
    /// Trims the trailing `;` off the `span` of a statement or class member, along with any whitespace and comments
    /// before it.
    pub fn without_semicolon(&self, span: Span) -> Span {
        if span.is_empty() || self.text().get(span.end as usize - 1) != Some(&b';') {
            return span;
        }
        let semicolon = span.end - 1;
        let detached = self.hir.detached_semicolons;
        match detached.binary_search_by_key(&semicolon, |entry| entry.0) {
            Ok(index) => Span::new(span.start, detached[index].1.max(span.start)),
            Err(_) => Span::new(span.start, semicolon),
        }
    }

    #[inline]
    pub fn comment(&'a self, id: u32) -> Comment<'a> {
        Comment { file: self, id }
    }

    #[inline]
    pub fn comment_count(&self) -> usize {
        self.hir.comments.len()
    }

    /// All comments in source order. Their neighboring nodes are only recorded if the file was parsed with
    /// `attach_comments`.
    pub fn comments_by_id(&'a self) -> impl ExactSizeIterator<Item = Comment<'a>> {
        (0..self.hir.comments.len() as u32).map(move |id| Comment { file: self, id })
    }
}
