//! A Markdown file's text and tree: `@eslint/markdown`'s `MarkdownSourceCode`.
//!
//! The tree is [mdast](https://github.com/syntax-tree/mdast), with the same node positions as mdast-util-from-markdown.
//!
//! The tree stores byte offsets. The plugin's rules work with UTF-16 indices and do arithmetic on them, so the ports do
//! the same arithmetic on an [`Index`]. In ASCII text the two are equal.

use crate::{Dialect, FrontMatter};
use bun_core::strings;
use bun_format::markdown::ast::{self, Kind, NONE, NodeId, Tree};
use bun_format::markdown::{Extensions, parse_to_mdast};
use bun_lint::ast::File;
use bun_lint::languages::{Comment, JoinedComment};
use bun_lint::span::Span;
use std::cell::{Cell, OnceCell};
use std::sync::OnceLock;

/// An index into the text in UTF-16 code units, as in JavaScript. It can be out of range.
pub(crate) type Index = i64;

/// A line and a column, both 1-based. The column counts UTF-16 code units.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub(crate) struct Loc {
    pub(crate) line: i64,
    pub(crate) column: i64,
}

/// The error that `getLocFromIndex` throws for an index outside the text.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct OutOfRange {
    pub(crate) index: Index,
    /// `text.length`
    pub(crate) length: Index,
}

/// A parsed file.
pub(crate) struct Mdast {
    tree: Tree,
    root: NodeId,
    front_matter: FrontMatter,
    /// The index of each line start, for non-ASCII text. It's cached here because every rule needs it.
    line_indices: OnceLock<Vec<u32>>,
}

impl Mdast {
    /// `text` has no byte order mark. Returns `None` if it's too long for the parser or nested too deeply.
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

/// A tree and its source text.
pub struct Document<'t> {
    text: &'t [u8],
    mdast: &'t Mdast,
    is_ascii: bool,
    /// The last byte offset that was converted, and its index. Most lookups come in source order, and the whole file
    /// can be a single line, so the next lookup counts from here instead of from the start of the line.
    last_lookup: Cell<(u32, u32)>,
    length: OnceCell<Index>,
}

impl<'t> Document<'t> {
    /// Returns `None` if the file isn't Markdown.
    pub(crate) fn of(file: &'t File<'t>) -> Option<Document<'t>> {
        Some(Document::new(file.tree()?, file.text()))
    }

    pub(crate) fn new(mdast: &'t Mdast, text: &'t [u8]) -> Document<'t> {
        Document {
            text,
            mdast,
            is_ascii: strings::first_non_ascii(text).is_none(),
            last_lookup: Cell::new((0, 0)),
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
            let (mut index, mut line_before) = (0, Span::empty(0));
            (self.line_starts().iter())
                .map(|&line| {
                    line_before = Span::after(line_before, line);
                    index += strings::wtf8_len_utf16(self.slice(line_before));
                    index
                })
                .collect()
        })
    }

    /// The 0-based number of the line that contains `at`. `starts` has the start of each line.
    fn line_at(starts: &[u32], at: u32) -> usize {
        starts.partition_point(|&start| start <= at).max(1) - 1
    }

    /// Converts a byte offset to an index.
    pub(crate) fn index_of(&self, offset: u32) -> Index {
        if self.is_ascii {
            return Index::from(offset);
        }
        let line = Self::line_at(self.line_starts(), offset);
        let mut from = (
            self.line_starts().get(line).copied().unwrap_or(0),
            self.line_indices().get(line).copied().unwrap_or(0),
        );
        let last = self.last_lookup.get();
        if (from.0..=offset).contains(&last.0) {
            from = last;
        }
        let index = from.1 + strings::wtf8_len_utf16(self.slice(Span::new(from.0, offset)));
        self.last_lookup.set((offset, index));
        Index::from(index)
    }

    /// Converts an index to a byte offset. An index outside the text is clamped to its start or end. An index in the
    /// middle of a surrogate pair maps to the start of the character.
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
        let last = self.last_lookup.get();
        if (from.1..=index).contains(&last.1) {
            from = last;
        }
        let rest = self.text.get(from.0 as usize..).unwrap_or_default();
        from.0 + strings::wtf8_offset_of_utf16_index(rest, index - from.1) as u32
    }

    /// Converts a line and a column to a byte offset. Returns `None` if the text has no such position.
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

    /// Converts a byte offset to a node's `position.start` or `position.end`.
    pub(crate) fn loc(&self, offset: u32) -> Loc {
        let line = Self::line_at(self.line_starts(), offset);
        let start = self.line_indices().get(line).copied().unwrap_or(0);
        Loc {
            line: line as i64 + 1,
            column: self.index_of(offset) - Index::from(start) + 1,
        }
    }

    /// The HTML comments in the file, which can configure ESLint: `<!-- eslint-disable -->`.
    pub(crate) fn comments(&self) -> (Vec<Comment>, Vec<JoinedComment>) {
        let (mut comments, mut joined) = (Vec::new(), Vec::new());
        if !strings::contains(self.text, b"eslint") {
            return (comments, joined);
        }
        let mut node = self.root();
        loop {
            if node.kind() == Kind::Html {
                let html = JoinedComment::new(self.text, node.span(), node.container_prefixes());
                for (from, to) in crate::util::html_comments(html.text()) {
                    let span = html.span_of(from..to);
                    let value = span.shrink(4, 3);
                    comments.push(Comment { span, value });
                    let is_inside = |gap: &&Span| value.contains(**gap);
                    let gaps: Vec<Span> = html.gaps().iter().filter(is_inside).copied().collect();
                    if !gaps.is_empty() {
                        joined.push(JoinedComment::new(self.text, value, gaps));
                    }
                }
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
                    None => return (comments, joined),
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

/// Converts byte offsets in a string to indices. The offsets have to be passed in ascending order.
pub(crate) struct Indices<'s> {
    string: &'s [u8],
    /// The last byte offset that was converted, and its index.
    last: (usize, Index),
}

impl<'s> Indices<'s> {
    /// `first` is the index of the start of `string`.
    pub(crate) fn new(string: &'s [u8], first: Index) -> Self {
        Indices {
            string,
            last: (0, first),
        }
    }

    /// Converts a byte offset to an index.
    pub(crate) fn at(&mut self, offset: usize) -> Index {
        let between = self.string.get(self.last.0..offset).unwrap_or_default();
        self.last = (offset.max(self.last.0), self.last.1 + length(between));
        self.last.1
    }
}

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
            // The parser never produces these when it's limited to the syntax that micromark supports.
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
            .map_or_else(Span::default, |it| Span::new(it.start, it.end))
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

    /// The prefixes of the node's second and later lines that are in the source but not in `node.value`: the `> ` of a
    /// block quote, the indentation of a list item.
    fn container_prefixes(self) -> Vec<Span> {
        let (text, value) = (self.text(), self.value().unwrap_or_default());
        let mut prefixes = Vec::new();
        if text == value {
            return prefixes;
        }
        let lines = crate::util::lines(text).zip(crate::util::lines(value));
        for (line, line_of_value) in lines.skip(1) {
            let same = line.iter().rev().zip(line_of_value.iter().rev());
            let prefix = line.len() - same.take_while(|(a, b)| a == b).count();
            if prefix > 0 {
                let start =
                    self.span().start + (line.as_ptr().addr() - text.as_ptr().addr()) as u32;
                prefixes.push(Span::new(start, start + prefix as u32));
            }
        }
        prefixes
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

    /// `node.value`, or `None` for a node type that has no `value`.
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

    /// `node.lang` of a code block. `None` means `null`.
    pub(crate) fn lang(self) -> Option<&'d [u8]> {
        self.string(|it| it.second)
    }

    /// `node.meta` of a code block. `None` means `null`.
    pub(crate) fn meta(self) -> Option<&'d [u8]> {
        self.string(|it| it.third)
    }

    /// `node.url` of a link, an image or a definition.
    pub(crate) fn url(self) -> &'d [u8] {
        self.string(|it| it.value).unwrap_or_default()
    }

    /// `node.title` of a link, an image or a definition. `None` means `null`.
    pub(crate) fn title(self) -> Option<&'d [u8]> {
        self.string(|it| it.second)
    }

    /// `node.alt` of an image or an image reference.
    pub(crate) fn alt(self) -> &'d [u8] {
        self.string(|it| it.third).unwrap_or_default()
    }

    /// `node.identifier` of a definition or a reference.
    pub(crate) fn identifier(self) -> &'d [u8] {
        self.string(|it| it.identifier).unwrap_or_default()
    }

    /// `node.label` of a definition or a reference.
    pub(crate) fn label(self) -> &'d [u8] {
        match self.kind() {
            Kind::Definition => self.string(|it| it.third),
            _ => self.string(|it| it.value),
        }
        .unwrap_or_default()
    }

    /// For tests, which also check the fields that no rule reads.
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
