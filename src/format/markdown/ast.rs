//! The syntax tree of a Markdown text: [mdast](https://github.com/syntax-tree/mdast) as
//! mdast-util-from-markdown builds it, with the nodes that Prettier's extensions add.
//!
//! The tree is flat: nodes refer to each other by index. Strings are ranges of the text, or of
//! [`Tree::strings`] if they are not written the way they are meant.

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Kind {
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
    /// For oxfmt: what is between `:::name`, which is its `value`, and `:::`, which is `second`.
    Directive,
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

pub type NodeId = u32;
pub const NONE: NodeId = u32::MAX;

/// A string: a range of the text, or of [`Tree::strings`].
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct Str {
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

    pub fn is_null(self) -> bool {
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
pub enum ReferenceType {
    Shortcut,
    Collapsed,
    Full,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Align {
    None,
    Left,
    Center,
    Right,
}

#[derive(Copy, Clone, Debug)]
pub struct Node {
    pub kind: Kind,
    /// `spread` of a list and an item, `ordered` of a list.
    pub spread: bool,
    pub ordered: bool,
    /// `isAligned` of a list.
    pub is_aligned: bool,
    /// `checked` of an item: 0 is `null`, 1 `false`, 2 `true`.
    pub checked: u8,
    pub reference_type: ReferenceType,
    /// For oxfmt: 1 for HTML that a certain text ends (`-->`, `</script>` ..), 1 for indented code.
    /// `depth` of a heading, `start` of an ordered list, the number of columns of a table, which are
    /// at `Tree::aligns[first_align..]`, the number of tokens of a sentence, which are at
    /// `Tree::tokens[first_align..]`. Of a list: how many lists of its kind are right before it.
    pub number: u32,
    pub first_align: u32,
    pub start: u32,
    pub end: u32,
    pub parent: NodeId,
    pub previous: NodeId,
    pub next: NodeId,
    pub first_child: NodeId,
    pub last_child: NodeId,
    /// `value`, `url`, or `label` of a reference.
    pub value: Str,
    /// `lang`, `title`, or `label` of a definition.
    pub second: Str,
    /// `meta`, `alt`, or `url` of a definition... see the accessors.
    pub third: Str,
    /// `identifier`
    pub identifier: Str,
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
pub struct Tree {
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

    pub fn get(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    pub(crate) fn get_mut(&mut self, id: NodeId) -> Option<&mut Node> {
        self.nodes.get_mut(id as usize)
    }

    pub fn kind(&self, id: NodeId) -> Option<Kind> {
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

    /// Takes `child` out of its parent.
    pub(crate) fn detach(&mut self, child: NodeId) {
        let Some(&Node {
            parent,
            previous,
            next,
            ..
        }) = self.get(child)
        else {
            return;
        };
        match self.get_mut(previous) {
            Some(previous) => previous.next = next,
            None => {
                if let Some(parent) = self.get_mut(parent) {
                    parent.first_child = next;
                }
            }
        }
        match self.get_mut(next) {
            Some(next) => next.previous = previous,
            None => {
                if let Some(parent) = self.get_mut(parent) {
                    parent.last_child = previous;
                }
            }
        }
        if let Some(child) = self.get_mut(child) {
            (child.parent, child.previous, child.next) = (NONE, NONE, NONE);
        }
    }

    pub fn children(&self, id: NodeId) -> Children<'_> {
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
    pub fn str<'t>(&'t self, text: &'t [u8], string: Str) -> &'t [u8] {
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

    /// Remaps every offset into the text with `map`: node spans, strings that are ranges of the text, and line starts.
    /// `copy(start, end, out)` gets the old range of each such string. If the text doesn't have the same bytes at the
    /// new offsets, it appends the string to `out` and returns true.
    pub(crate) fn map_offsets(
        &mut self,
        map: impl Fn(u32) -> u32,
        copy: impl Fn(u32, u32, &mut Vec<u8>) -> bool,
    ) {
        let strings = &mut self.strings;
        let mut string = |it: &mut Str| {
            if it.len & (Str::OWNED | Str::NULL) != 0 {
                return;
            }
            let copied_from = strings.len();
            *it = match copy(it.start, it.start + it.len, strings) {
                true => Str {
                    start: copied_from as u32,
                    len: (strings.len() - copied_from) as u32 | Str::OWNED,
                },
                false => Str::source(map(it.start), map(it.start + it.len)),
            };
        };
        for node in &mut self.nodes {
            (node.start, node.end) = (map(node.start), map(node.end));
            string(&mut node.value);
            string(&mut node.second);
            string(&mut node.third);
            string(&mut node.identifier);
        }
        for start in &mut self.line_starts {
            *start = map(*start);
        }
    }

    /// For a tree that was parsed from a copy of `text` in which every line break is `\n`, after [`Tree::map_offsets`]. Puts
    /// the line breaks of `text` back into the strings that were copied: the `value` of HTML and text nodes, and the label
    /// of a definition. In those, the nth line break of the string is the nth line break of the node, unless one was
    /// written as `&#10;`.
    pub(crate) fn restore_line_breaks(&mut self, text: &[u8]) {
        for node in &mut self.nodes {
            let string = match node.kind {
                Kind::Html | Kind::Text => &mut node.value,
                Kind::Definition => &mut node.third,
                _ => continue,
            };
            let mut source = text
                .get(node.start as usize..node.end as usize)
                .unwrap_or_default();
            if string.len & Str::OWNED == 0 || !bun_core::strings::contains_char(source, b'\r') {
                continue;
            }
            let (start, len) = (string.start as usize, (string.len & !Str::OWNED) as usize);
            let copied = self.strings.get(start..start + len).unwrap_or_default();
            if !bun_core::strings::contains_char(copied, b'\n') {
                continue;
            }
            let copied = copied.to_vec();
            let restored_from = self.strings.len();
            for (index, line) in bun_core::strings::split(&copied, b"\n").enumerate() {
                if index > 0 {
                    let at =
                        bun_core::strings::index_of_any(source, b"\r\n").unwrap_or(source.len());
                    let len = match &source[at..] {
                        [b'\r', b'\n', ..] => 2,
                        [] => 0,
                        _ => 1,
                    };
                    self.strings.extend_from_slice(match len {
                        0 => b"\n",
                        _ => &source[at..at + len],
                    });
                    source = &source[at + len..];
                }
                self.strings.extend_from_slice(line);
            }
            *string = Str {
                start: restored_from as u32,
                len: (self.strings.len() - restored_from) as u32 | Str::OWNED,
            };
        }
    }

    /// The column alignments of the table `node`.
    pub fn aligns(&self, node: &Node) -> &[Align] {
        let first = node.first_align as usize;
        self.aligns
            .get(first..first + node.number as usize)
            .unwrap_or_default()
    }

    /// The offset of the start of each line.
    pub fn line_starts(&self) -> &[u32] {
        &self.line_starts
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

pub struct Children<'t> {
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
