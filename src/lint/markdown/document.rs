//! A Markdown text and its tree: `MarkdownSourceCode` of `@eslint/markdown`.
//!
//! The tree is [mdast](https://github.com/syntax-tree/mdast), with the places that mdast-util-from-markdown gives its nodes.
//!
//! Places in the tree are byte offsets. The rules of the plugin count in UTF-16 code units, and add to and subtract from what
//! they have counted, so what they do with an index is done with an [`Index`] here. In a text that is ASCII the two are the same.

use crate::{Dialect, FrontMatter};
use bun_core::strings;
use bun_format::markdown::ast::{self, Kind, NONE, NodeId, Tree};
use bun_format::markdown::{Extensions, parse_to_mdast};
use bun_lint::ast::File;
use bun_lint::languages::Comment;
use bun_lint::span::Span;
use std::cell::{Cell, OnceCell};
use std::sync::OnceLock;

/// An index into the text as JavaScript has it. It can be outside of the text.
pub(crate) type Index = i64;

/// A line and a column, both from 1, the column in UTF-16 code units.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub(crate) struct Loc {
    pub(crate) line: i64,
    pub(crate) column: i64,
}

/// `getLocFromIndex` throws: the index is not in the text.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct OutOfRange {
    pub(crate) index: Index,
    /// `text.length`
    pub(crate) length: Index,
}

/// What a text is parsed to.
pub(crate) struct Mdast {
    tree: Tree,
    root: NodeId,
    front_matter: FrontMatter,
    /// The index at which each line starts, for a text that is not ASCII. All rules ask for the same.
    line_indices: OnceLock<Vec<u32>>,
}

impl Mdast {
    /// `text`: without a byte order mark. `None`: it is too long for the parser, or nested too deeply.
    pub(crate) fn parse(text: &[u8], dialect: Dialect) -> Option<Mdast> {
        let with = Extensions {
            gfm: dialect.is_gfm,
            math: dialect.math,
            front_matter: match dialect.front_matter {
                FrontMatter::None => None,
                FrontMatter::Yaml | FrontMatter::Json => Some(b'-'),
                FrontMatter::Toml => Some(b'+'),
            },
        };
        let mut tree = Tree::default();
        let root = parse_to_mdast(text, with, &mut tree)?;
        Some(Mdast {
            tree,
            root,
            front_matter: dialect.front_matter,
            line_indices: OnceLock::new(),
        })
    }
}

/// A tree and the text that it is of.
pub struct Document<'t> {
    text: &'t [u8],
    mdast: &'t Mdast,
    is_ascii: bool,
    /// The byte offset that was asked about last, and its index: most are asked about in the order of the text, and a line
    /// can be all of it.
    last_asked: Cell<(u32, u32)>,
    length: OnceCell<Index>,
}

impl<'t> Document<'t> {
    /// `None`: the file is not Markdown.
    pub(crate) fn of(file: &'t File<'t>) -> Option<Document<'t>> {
        Some(Document::new(file.tree()?, file.text()))
    }

    pub(crate) fn new(mdast: &'t Mdast, text: &'t [u8]) -> Document<'t> {
        Document {
            text,
            mdast,
            is_ascii: strings::first_non_ascii(text).is_none(),
            last_asked: Cell::new((0, 0)),
            length: OnceCell::new(),
        }
    }

    #[inline]
    pub(crate) fn text(&self) -> &'t [u8] {
        self.text
    }

    #[inline]
    pub(crate) fn root(&self) -> Node<'_> {
        self.node(self.mdast.root)
    }

    #[inline]
    fn node(&self, id: NodeId) -> Node<'_> {
        Node { document: self, id }
    }

    /// `text.slice(start, end)`, with byte offsets.
    #[inline]
    pub(crate) fn slice(&self, span: Span) -> &'t [u8] {
        self.text.get(span.range()).unwrap_or_default()
    }

    /// `text.length`
    pub(crate) fn length(&self) -> Index {
        *self.length.get_or_init(|| match self.is_ascii {
            true => self.text.len() as Index,
            false => {
                let start = self.line_starts().last().copied().unwrap_or(0);
                let before = self.line_indices().last().copied().unwrap_or(0);
                Index::from(before) + length(self.text.get(start as usize..).unwrap_or_default())
            }
        })
    }

    fn line_starts(&self) -> &[u32] {
        self.mdast.tree.line_starts()
    }

    fn line_indices(&self) -> &[u32] {
        if self.is_ascii {
            return self.line_starts();
        }
        self.mdast.line_indices.get_or_init(|| {
            let (mut index, mut from) = (0, 0);
            (self.line_starts().iter())
                .map(|&start| {
                    index += strings::wtf8_len_utf16(self.slice(Span::new(from, start)));
                    from = start;
                    index
                })
                .collect()
        })
    }

    /// The how manyth line, from 0, `at` is on, given where the lines start.
    fn line_at(starts: &[u32], at: u32) -> usize {
        starts.partition_point(|&start| start <= at).max(1) - 1
    }

    /// The index of the byte offset `offset`.
    pub(crate) fn index_of(&self, offset: u32) -> Index {
        if self.is_ascii {
            return Index::from(offset);
        }
        let line = Self::line_at(self.line_starts(), offset);
        let mut from = (
            self.line_starts().get(line).copied().unwrap_or(0),
            self.line_indices().get(line).copied().unwrap_or(0),
        );
        let last = self.last_asked.get();
        if (from.0..=offset).contains(&last.0) {
            from = last;
        }
        let index = from.1 + strings::wtf8_len_utf16(self.slice(Span::new(from.0, offset)));
        self.last_asked.set((offset, index));
        Index::from(index)
    }

    /// The byte offset of `index`: the start or the end of the text if it is outside of it, the start of the character if
    /// it is between the halves of a surrogate pair.
    pub(crate) fn offset_of(&self, index: Index) -> u32 {
        let index = index.clamp(0, Index::from(u32::MAX)) as u32;
        if self.is_ascii {
            return index.min(self.text.len() as u32);
        }
        let line = Self::line_at(self.line_indices(), index);
        let mut from = (
            self.line_starts().get(line).copied().unwrap_or(0),
            self.line_indices().get(line).copied().unwrap_or(0),
        );
        let last = self.last_asked.get();
        if (from.1..=index).contains(&last.1) {
            from = last;
        }
        let rest = self.text.get(from.0 as usize..).unwrap_or_default();
        from.0 + strings::wtf8_offset_of_utf16_index(rest, index - from.1) as u32
    }

    /// The byte offset of a line and a column. `None`: there is no such place in the text.
    pub(crate) fn offset_at(&self, loc: Loc) -> Option<u32> {
        let line = usize::try_from(loc.line - 1).ok()?;
        let index = Index::from(*self.line_indices().get(line)?) + loc.column - 1;
        let offset = self.offset_of(index);
        (loc.column >= 1 && self.loc(offset) == loc).then_some(offset)
    }

    /// `sourceCode.getLocFromIndex(index)`
    pub(crate) fn loc_from_index(&self, index: Index) -> Result<Loc, OutOfRange> {
        let length = self.length();
        if index < 0 || index > length {
            return Err(OutOfRange { index, length });
        }
        let starts = self.line_indices();
        let line = Self::line_at(starts, index as u32);
        Ok(Loc {
            line: line as i64 + 1,
            column: index - Index::from(starts.get(line).copied().unwrap_or(0)) + 1,
        })
    }

    /// `position.start` or `position.end` of a node, from its byte offset.
    pub(crate) fn loc(&self, offset: u32) -> Loc {
        let line = Self::line_at(self.line_starts(), offset);
        let start = self.line_indices().get(line).copied().unwrap_or(0);
        Loc {
            line: line as i64 + 1,
            column: self.index_of(offset) - Index::from(start) + 1,
        }
    }

    /// The comments of the HTML in it, which can configure ESLint: `<!-- eslint-disable -->`.
    pub(crate) fn comments(&self) -> Vec<Comment> {
        let mut comments = Vec::new();
        if !strings::contains(self.text, b"eslint") {
            return comments;
        }
        let mut node = self.root();
        loop {
            if node.kind() == Kind::Html {
                let start = node.span().start;
                comments.extend(crate::util::html_comments(node.text()).map(|(from, to)| {
                    let span = Span::new(start + from as u32, start + to as u32);
                    Comment {
                        span,
                        value: span.shrink(4, 3),
                    }
                }));
            }
            if let Some(child) = node.first_child() {
                node = child;
                continue;
            }
            loop {
                if let Some(next) = node.next() {
                    node = next;
                    break;
                }
                match node.parent() {
                    Some(parent) => node = parent,
                    None => return comments,
                }
            }
        }
    }
}

/// `string.length`
#[inline]
pub(crate) fn length(string: &[u8]) -> Index {
    Index::from(strings::wtf8_len_utf16(string))
}

/// The indices of places in a string, which are asked for in ascending order.
pub(crate) struct Indices<'s> {
    string: &'s [u8],
    /// The byte offset that was asked about last, and its index.
    last: (usize, Index),
}

impl<'s> Indices<'s> {
    /// `first`: the index of the start of `string`.
    pub(crate) fn new(string: &'s [u8], first: Index) -> Self {
        Indices {
            string,
            last: (0, first),
        }
    }

    /// The index of the byte offset `offset`.
    pub(crate) fn at(&mut self, offset: usize) -> Index {
        let between = self.string.get(self.last.0..offset).unwrap_or_default();
        self.last = (offset.max(self.last.0), self.last.1 + length(between));
        self.last.1
    }
}

/// A node of the tree.
#[derive(Copy, Clone)]
pub(crate) struct Node<'d> {
    document: &'d Document<'d>,
    id: NodeId,
}

impl PartialEq for Node<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl<'d> Node<'d> {
    #[inline]
    fn get(self) -> Option<&'d ast::Node> {
        self.document.mdast.tree.get(self.id)
    }

    #[inline]
    pub(crate) fn kind(self) -> Kind {
        self.get().map_or(Kind::Root, |it| it.kind)
    }

    /// `node.type`
    pub(crate) fn type_name(self) -> &'static str {
        match self.kind() {
            Kind::Root => "root",
            Kind::FrontMatter => match self.document.mdast.front_matter {
                FrontMatter::Toml => "toml",
                FrontMatter::Json => "json",
                FrontMatter::Yaml | FrontMatter::None => "yaml",
            },
            Kind::Paragraph => "paragraph",
            Kind::Heading => "heading",
            Kind::ThematicBreak => "thematicBreak",
            Kind::Blockquote => "blockquote",
            Kind::List => "list",
            Kind::ListItem => "listItem",
            Kind::Html => "html",
            Kind::Code => "code",
            Kind::Definition => "definition",
            Kind::FootnoteDefinition => "footnoteDefinition",
            Kind::Table => "table",
            Kind::TableRow => "tableRow",
            Kind::TableCell => "tableCell",
            Kind::Math => "math",
            Kind::Text => "text",
            Kind::Emphasis => "emphasis",
            Kind::Strong => "strong",
            Kind::Delete => "delete",
            Kind::InlineCode => "inlineCode",
            Kind::Break => "break",
            Kind::Link => "link",
            Kind::Image => "image",
            Kind::LinkReference => "linkReference",
            Kind::ImageReference => "imageReference",
            Kind::FootnoteReference => "footnoteReference",
            Kind::InlineMath => "inlineMath",
            // The parser makes none of these of what micromark reads.
            Kind::Directive
            | Kind::LiquidNode
            | Kind::WikiLink
            | Kind::Import
            | Kind::Export
            | Kind::Jsx
            | Kind::EsComment
            | Kind::Sentence => "",
        }
    }

    /// `sourceCode.getRange(node)`, in bytes.
    #[inline]
    pub(crate) fn span(self) -> Span {
        self.get()
            .map_or(Span::default(), |it| Span::new(it.start, it.end))
    }

    /// `node.position.start.offset`
    pub(crate) fn start_index(self) -> Index {
        self.document.index_of(self.span().start)
    }

    /// `node.position.start`
    pub(crate) fn start(self) -> Loc {
        self.document.loc(self.span().start)
    }

    /// `node.position.end`
    pub(crate) fn end(self) -> Loc {
        self.document.loc(self.span().end)
    }

    /// `sourceCode.getText(node)`
    #[inline]
    pub(crate) fn text(self) -> &'d [u8] {
        self.document.slice(self.span())
    }

    /// `sourceCode.getParent(node)`
    pub(crate) fn parent(self) -> Option<Node<'d>> {
        let parent = self.get()?.parent;
        (parent != NONE).then(|| self.document.node(parent))
    }

    /// `node.children`
    pub(crate) fn children(self) -> impl Iterator<Item = Node<'d>> {
        let document = self.document;
        document
            .mdast
            .tree
            .children(self.id)
            .map(|id| document.node(id))
    }

    pub(crate) fn first_child(self) -> Option<Node<'d>> {
        let child = self.get()?.first_child;
        (child != NONE).then(|| self.document.node(child))
    }

    pub(crate) fn last_child(self) -> Option<Node<'d>> {
        let child = self.get()?.last_child;
        (child != NONE).then(|| self.document.node(child))
    }

    pub(crate) fn next(self) -> Option<Node<'d>> {
        let next = self.get()?.next;
        (next != NONE).then(|| self.document.node(next))
    }

    fn string(self, of: impl FnOnce(&ast::Node) -> ast::Str) -> Option<&'d [u8]> {
        let string = of(self.get()?);
        (!string.is_null()).then(|| self.document.mdast.tree.str(self.document.text, string))
    }

    /// `node.value`. `None`: a node of its type has none.
    pub(crate) fn value(self) -> Option<&'d [u8]> {
        match self.kind() {
            Kind::FrontMatter
            | Kind::Html
            | Kind::Code
            | Kind::Math
            | Kind::Text
            | Kind::InlineCode
            | Kind::InlineMath => Some(self.string(|it| it.value).unwrap_or_default()),
            _ => None,
        }
    }

    /// `node.depth` of a heading.
    pub(crate) fn depth(self) -> u32 {
        self.get().map_or(0, |it| it.number)
    }

    /// `node.lang` of code. `None` is `null`.
    pub(crate) fn lang(self) -> Option<&'d [u8]> {
        self.string(|it| it.second)
    }

    /// `node.meta` of code. `None` is `null`.
    pub(crate) fn meta(self) -> Option<&'d [u8]> {
        self.string(|it| it.third)
    }

    /// `node.url` of a link, an image and a definition.
    pub(crate) fn url(self) -> &'d [u8] {
        self.string(|it| it.value).unwrap_or_default()
    }

    /// `node.title` of a link, an image and a definition. `None` is `null`.
    pub(crate) fn title(self) -> Option<&'d [u8]> {
        self.string(|it| it.second)
    }

    /// `node.alt` of an image and of a reference to one.
    pub(crate) fn alt(self) -> &'d [u8] {
        self.string(|it| it.third).unwrap_or_default()
    }

    /// `node.identifier` of a definition and a reference.
    pub(crate) fn identifier(self) -> &'d [u8] {
        self.string(|it| it.identifier).unwrap_or_default()
    }

    /// `node.label` of a definition and a reference.
    pub(crate) fn label(self) -> &'d [u8] {
        match self.kind() {
            Kind::Definition => self.string(|it| it.third),
            _ => self.string(|it| it.value),
        }
        .unwrap_or_default()
    }

    /// For the tests: what the rules do not look at.
    pub(crate) fn raw(self) -> Option<&'d ast::Node> {
        self.get()
    }

    pub(crate) fn aligns(self) -> &'d [ast::Align] {
        self.get()
            .map_or(&[], |it| self.document.mdast.tree.aligns(it))
    }
}

/// `text.indexOf(part)`
pub(crate) fn index_of(text: &[u8], part: &[u8]) -> Index {
    strings::index_of(text, part).map_or(-1, |at| length(&text[..at]))
}

/// `text.lastIndexOf(part)`
pub(crate) fn last_index_of(text: &[u8], part: &[u8]) -> Index {
    strings::last_index_of(text, part).map_or(-1, |at| length(&text[..at]))
}
