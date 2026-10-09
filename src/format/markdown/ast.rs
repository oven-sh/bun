//! The syntax tree of a Markdown text: [mdast](https://github.com/syntax-tree/mdast) as
//! mdast-util-from-markdown builds it, with the nodes that Prettier's extensions add.
//!
//! The tree is flat: nodes refer to each other by index. Strings are ranges of the text, or of
//! [`Tree::strings`] if they are not written the way they are meant.

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Root,
    FrontMatter,
    Paragraph,
    Heading,
    ThematicBreak,
    Blockquote,
    List,
    ListItem,
    Html,
    Code,
    Definition,
    FootnoteDefinition,
    Table,
    TableRow,
    TableCell,
    Math,
    LiquidNode,
    Text,
    Emphasis,
    Strong,
    Delete,
    InlineCode,
    Break,
    Link,
    Image,
    LinkReference,
    ImageReference,
    FootnoteReference,
    InlineMath,
    WikiLink,
    /// MDX: `import ..`, `export ..`, HTML that is not a comment, `{/* .. */}`.
    Import,
    Export,
    Jsx,
    EsComment,
    /// What Prettier's `splitText` makes of a `Text`: words and white space, which are not nodes here.
    Sentence,
}

impl Kind {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Kind::Root => "root",
            Kind::FrontMatter => "frontMatter",
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
            Kind::LiquidNode => "liquidNode",
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
            Kind::WikiLink => "wikiLink",
            Kind::Import => "import",
            Kind::Export => "export",
            Kind::Jsx => "jsx",
            Kind::EsComment => "esComment",
            Kind::Sentence => "sentence",
        }
    }
}

pub(crate) type NodeId = u32;
pub(crate) const NONE: NodeId = u32::MAX;

/// A string: a range of the text, or of [`Tree::strings`].
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub(crate) struct Str {
    start: u32,
    /// The highest bit says that it is a range of `Tree::strings`, the one below that there is no
    /// string: `null`.
    len: u32,
}

impl Str {
    const OWNED: u32 = 1 << 31;
    const NULL: u32 = 1 << 30;
    pub(crate) const EMPTY: Str = Str { start: 0, len: 0 };
    pub(crate) const NO: Str = Str {
        start: 0,
        len: Str::NULL,
    };

    /// The text from `start` to `end`.
    pub(crate) fn source(start: u32, end: u32) -> Str {
        Str {
            start,
            len: end.saturating_sub(start) & !(Str::OWNED | Str::NULL),
        }
    }

    pub(crate) fn is_null(self) -> bool {
        self.len & Str::NULL != 0
    }

    /// The part of it from `start` to `end`.
    pub(crate) fn slice(self, start: usize, end: usize) -> Str {
        Str {
            start: self.start + start as u32,
            len: (end.saturating_sub(start) as u32) | (self.len & Str::OWNED),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ReferenceType {
    Shortcut,
    Collapsed,
    Full,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Align {
    None,
    Left,
    Center,
    Right,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Node {
    pub(crate) kind: Kind,
    /// `spread` of a list and an item, `ordered` of a list.
    pub(crate) spread: bool,
    pub(crate) ordered: bool,
    /// `isAligned` of a list.
    pub(crate) is_aligned: bool,
    /// `checked` of an item: 0 is `null`, 1 `false`, 2 `true`.
    pub(crate) checked: u8,
    pub(crate) reference_type: ReferenceType,
    /// `depth` of a heading, `start` of an ordered list, the number of columns of a table, which are
    /// at `Tree::aligns[first_align..]`, the number of tokens of a sentence, which are at
    /// `Tree::tokens[first_align..]`.
    pub(crate) number: u32,
    pub(crate) first_align: u32,
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) parent: NodeId,
    pub(crate) previous: NodeId,
    pub(crate) next: NodeId,
    pub(crate) first_child: NodeId,
    pub(crate) last_child: NodeId,
    /// `value`, `url`, or `label` of a reference.
    pub(crate) value: Str,
    /// `lang`, `title`, or `label` of a definition.
    pub(crate) second: Str,
    /// `meta`, `alt`, or `url` of a definition... see the accessors.
    pub(crate) third: Str,
    /// `identifier`
    pub(crate) identifier: Str,
}

impl Node {
    pub(crate) fn new(kind: Kind, start: u32, end: u32) -> Node {
        Node {
            kind,
            spread: false,
            ordered: false,
            is_aligned: false,
            checked: 0,
            reference_type: ReferenceType::Shortcut,
            number: 0,
            first_align: 0,
            start,
            end,
            parent: NONE,
            previous: NONE,
            next: NONE,
            first_child: NONE,
            last_child: NONE,
            value: Str::NO,
            second: Str::NO,
            third: Str::NO,
            identifier: Str::NO,
        }
    }
}

#[derive(Default)]
pub(crate) struct Tree {
    pub(crate) nodes: Vec<Node>,
    pub(crate) strings: Vec<u8>,
    pub(crate) aligns: Vec<Align>,
    /// The words and the white space of all sentences.
    pub(crate) tokens: Vec<super::preprocess::Token>,
    /// Where each line of the text starts.
    pub(crate) line_starts: Vec<u32>,
}

impl Tree {
    pub(crate) fn clear(&mut self) {
        self.nodes.clear();
        self.strings.clear();
        self.aligns.clear();
        self.tokens.clear();
        self.line_starts.clear();
    }

    /// Adds a node that is not in anything yet.
    pub(crate) fn add(&mut self, kind: Kind, start: u32, end: u32) -> NodeId {
        self.nodes.push(Node::new(kind, start, end));
        (self.nodes.len() - 1) as NodeId
    }

    pub(crate) fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    pub(crate) fn get_mut(&mut self, id: NodeId) -> Option<&mut Node> {
        self.nodes.get_mut(id as usize)
    }

    pub(crate) fn kind(&self, id: NodeId) -> Option<Kind> {
        self.get(id).map(|node| node.kind)
    }

    /// Makes `child` the last child of `parent`.
    pub(crate) fn append(&mut self, parent: NodeId, child: NodeId) {
        let Some(last) = self.get(parent).map(|node| node.last_child) else {
            return;
        };
        if let Some(node) = self.get_mut(child) {
            node.parent = parent;
            node.previous = last;
            node.next = NONE;
        }
        match self.get_mut(last) {
            Some(last) => last.next = child,
            None => {
                if let Some(parent) = self.get_mut(parent) {
                    parent.first_child = child;
                }
            }
        }
        if let Some(parent) = self.get_mut(parent) {
            parent.last_child = child;
        }
    }

    /// Makes `child` the first child of `parent`.
    pub(crate) fn prepend(&mut self, parent: NodeId, child: NodeId) {
        let Some(first) = self.get(parent).map(|node| node.first_child) else {
            return;
        };
        if let Some(node) = self.get_mut(child) {
            (node.parent, node.previous, node.next) = (parent, NONE, first);
        }
        match self.get_mut(first) {
            Some(first) => first.previous = child,
            None => {
                if let Some(parent) = self.get_mut(parent) {
                    parent.last_child = child;
                }
            }
        }
        if let Some(parent) = self.get_mut(parent) {
            parent.first_child = child;
        }
    }

    pub(crate) fn children(&self, id: NodeId) -> Children<'_> {
        Children {
            tree: self,
            next: self.get(id).map_or(NONE, |node| node.first_child),
        }
    }

    /// A string that is not written in the text the way it is meant: what `write` appends.
    pub(crate) fn owned(&mut self, write: impl FnOnce(&mut Vec<u8>)) -> Str {
        let start = self.strings.len();
        write(&mut self.strings);
        Str {
            start: start as u32,
            len: ((self.strings.len() - start) as u32 & !(Str::OWNED | Str::NULL)) | Str::OWNED,
        }
    }

    /// `text`: what the tree is the syntax of. A string that is `null` is empty.
    pub(crate) fn str<'t>(&'t self, text: &'t [u8], string: Str) -> &'t [u8] {
        if string.is_null() {
            return &[];
        }
        let from = if string.len & Str::OWNED != 0 {
            &self.strings[..]
        } else {
            text
        };
        let (start, len) = (string.start as usize, (string.len & !Str::OWNED) as usize);
        from.get(start..start + len).unwrap_or_default()
    }

    /// The number of the line that `offset` is on. The first is 1.
    pub(crate) fn line(&self, offset: u32) -> u32 {
        self.line_starts
            .partition_point(|&start| start <= offset)
            .max(1) as u32
    }

    /// Where the line that `offset` is on starts.
    pub(crate) fn line_start(&self, offset: u32) -> u32 {
        self.line_starts
            .get(self.line(offset) as usize - 1)
            .copied()
            .unwrap_or(0)
    }
}

pub(crate) struct Children<'t> {
    tree: &'t Tree,
    next: NodeId,
}

impl Iterator for Children<'_> {
    type Item = NodeId;

    fn next(&mut self) -> Option<NodeId> {
        let id = self.next;
        self.next = self.tree.get(id)?.next;
        Some(id)
    }
}

/// The tree for debugging and for comparing it with Prettier's: a node on each line, with its range in
/// bytes, its lines and columns, and its fields in alphabetical order.
pub(crate) fn dump(text: &[u8], tree: &Tree, root: NodeId, out: &mut Vec<u8>) {
    fn json(string: &[u8], out: &mut Vec<u8>) {
        out.push(b'"');
        for &byte in string {
            match byte {
                b'"' => out.extend_from_slice(b"\\\""),
                b'\\' => out.extend_from_slice(b"\\\\"),
                b'\n' => out.extend_from_slice(b"\\n"),
                b'\r' => out.extend_from_slice(b"\\r"),
                b'\t' => out.extend_from_slice(b"\\t"),
                0x08 => out.extend_from_slice(b"\\b"),
                0x0C => out.extend_from_slice(b"\\f"),
                0..=0x1F => out.extend_from_slice(format!("\\u{byte:04x}").as_bytes()),
                _ => out.push(byte),
            }
        }
        out.push(b'"');
    }
    fn column(text: &[u8], tree: &Tree, offset: u32) -> usize {
        let line = text
            .get(tree.line_start(offset) as usize..offset as usize)
            .unwrap_or_default();
        1 + line
            .iter()
            .map(|&byte| usize::from(byte & 0xC0 != 0x80) + usize::from(byte >= 0xF0))
            .sum::<usize>()
    }
    let mut stack = vec![(root, 0usize)];
    while let Some((id, depth)) = stack.pop() {
        let Some(node) = tree.get(id) else {
            continue;
        };
        out.extend(std::iter::repeat_n(b' ', depth * 2));
        out.extend_from_slice(node.kind.name().as_bytes());
        out.extend_from_slice(
            format!(
                " {}-{} {}:{}-{}:{}",
                node.start,
                node.end,
                tree.line(node.start),
                column(text, tree, node.start),
                tree.line(node.end),
                column(text, tree, node.end)
            )
            .as_bytes(),
        );
        let mut field = |name: &str, string: Str| {
            out.extend_from_slice(format!(" {name}=").as_bytes());
            match string.is_null() {
                true => out.extend_from_slice(b"null"),
                false => json(tree.str(text, string), out),
            }
        };
        let reference_type = match node.reference_type {
            ReferenceType::Shortcut => "shortcut",
            ReferenceType::Collapsed => "collapsed",
            ReferenceType::Full => "full",
        };
        match node.kind {
            Kind::Text
            | Kind::InlineCode
            | Kind::Html
            | Kind::LiquidNode
            | Kind::InlineMath
            | Kind::WikiLink
            | Kind::Import
            | Kind::Export
            | Kind::Jsx
            | Kind::EsComment => {
                field("value", node.value);
            }
            Kind::Code => {
                field("lang", node.second);
                field("meta", node.third);
                field("value", node.value);
            }
            Kind::Math => {
                field("meta", node.third);
                field("value", node.value);
            }
            Kind::Link => {
                field("title", node.second);
                field("url", node.value);
            }
            Kind::Image => {
                field("alt", node.third);
                field("title", node.second);
                field("url", node.value);
            }
            Kind::Definition => {
                field("identifier", node.identifier);
                field("label", node.third);
                field("title", node.second);
                field("url", node.value);
            }
            Kind::LinkReference => {
                field("identifier", node.identifier);
                field("label", node.value);
                out.extend_from_slice(format!(" referenceType=\"{reference_type}\"").as_bytes());
            }
            Kind::ImageReference => {
                field("alt", node.third);
                field("identifier", node.identifier);
                field("label", node.value);
                out.extend_from_slice(format!(" referenceType=\"{reference_type}\"").as_bytes());
            }
            Kind::FootnoteReference | Kind::FootnoteDefinition => {
                field("identifier", node.identifier);
                field("label", node.value);
            }
            Kind::Heading => out.extend_from_slice(format!(" depth={}", node.number).as_bytes()),
            Kind::List => {
                let start = if node.ordered {
                    node.number.to_string()
                } else {
                    "null".to_string()
                };
                out.extend_from_slice(
                    format!(
                        " ordered={} spread={} start={start}",
                        node.ordered, node.spread
                    )
                    .as_bytes(),
                );
            }
            Kind::ListItem => {
                let checked = ["null", "false", "true"]
                    .get(node.checked as usize)
                    .copied()
                    .unwrap_or("null");
                out.extend_from_slice(
                    format!(" checked={checked} spread={}", node.spread).as_bytes(),
                );
            }
            Kind::Table => {
                let first = node.first_align as usize;
                let aligns = tree
                    .aligns
                    .get(first..first + node.number as usize)
                    .unwrap_or_default();
                let names: Vec<&str> = aligns
                    .iter()
                    .map(|align| match align {
                        Align::None => "null",
                        Align::Left => "\"left\"",
                        Align::Center => "\"center\"",
                        Align::Right => "\"right\"",
                    })
                    .collect();
                out.extend_from_slice(format!(" align=[{}]", names.join(",")).as_bytes());
            }
            _ => {}
        }
        out.push(b'\n');
        let first = stack.len();
        stack.extend(tree.children(id).map(|child| (child, depth + 1)));
        stack[first..].reverse();
    }
}
