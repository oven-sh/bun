//! The tree that `@glimmer/syntax` makes of a template, in flat lists.

pub(crate) type NodeId = u32;

/// The node that stands for `undefined`. It prints nothing.
pub(crate) const NOTHING: NodeId = 0;

/// Bytes of the template, or of `Tree::owned` where the tree has what the template has not.
#[derive(Copy, Clone, Default)]
pub(crate) struct Text {
    start: u32,
    len: u32,
}

const OWNED: u32 = 1 << 31;

impl Text {
    pub(crate) const EMPTY: Text = Text { start: 0, len: 0 };

    pub(crate) fn source(start: usize, end: usize) -> Text {
        Text {
            start: start as u32,
            len: end.saturating_sub(start) as u32,
        }
    }

    pub(crate) fn is_empty(self) -> bool {
        self.len == 0
    }

    /// Without the first and the last byte.
    pub(crate) fn without_ends(self) -> Text {
        Text {
            start: self.start + 1,
            len: self.len.saturating_sub(2),
        }
    }

    fn is_owned(self) -> bool {
        self.start & OWNED != 0
    }

    fn range(self) -> std::ops::Range<usize> {
        let start = (self.start & !OWNED) as usize;
        start..start + self.len as usize
    }
}

/// A part of `Tree::lists` or of `Tree::names`.
#[derive(Copy, Clone, Default)]
pub(crate) struct Range {
    pub(crate) start: u32,
    pub(crate) len: u32,
}

impl Range {
    pub(crate) fn is_empty(self) -> bool {
        self.len == 0
    }
}

/// `path`, `params` and the pairs of `hash`.
#[derive(Copy, Clone)]
pub(crate) struct Call {
    pub(crate) path: NodeId,
    pub(crate) params: Range,
    pub(crate) pairs: Range,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Head {
    This,
    At,
    Var,
}

/// `strip.open` of a mustache, `openStrip.open` of a block.
pub(crate) const OPEN_OPEN: u8 = 1;
pub(crate) const OPEN_CLOSE: u8 = 1 << 1;
pub(crate) const INVERSE_OPEN: u8 = 1 << 2;
pub(crate) const INVERSE_CLOSE: u8 = 1 << 3;
pub(crate) const CLOSE_OPEN: u8 = 1 << 4;
pub(crate) const CLOSE_CLOSE: u8 = 1 << 5;

#[derive(Copy, Clone)]
pub(crate) enum Kind {
    Nothing,
    FrontMatter,
    Template {
        body: Range,
    },
    Block {
        body: Range,
        block_params: Range,
    },
    Element {
        tag: Text,
        /// `attributes`, `modifiers` and `comments`, in the order of the template.
        attributes: Range,
        block_params: Range,
        children: Range,
        is_self_closing: bool,
    },
    BlockStatement {
        call: Call,
        program: NodeId,
        /// `NOTHING`: there is none.
        inverse: NodeId,
        strip: u8,
    },
    Mustache {
        call: Call,
        is_trusting: bool,
        strip: u8,
    },
    ElementModifier {
        call: Call,
    },
    SubExpression {
        call: Call,
    },
    Attr {
        name: Text,
        value: NodeId,
    },
    Concat {
        parts: Range,
    },
    HashPair {
        key: Text,
        value: NodeId,
    },
    Text {
        chars: Text,
    },
    MustacheComment {
        value: Text,
    },
    Comment {
        value: Text,
    },
    Path {
        head: Head,
        /// `head.original`
        name: Text,
        tail: Range,
    },
    String {
        value: Text,
    },
    /// As it is written.
    Number {
        token: Text,
    },
    Boolean(bool),
    Undefined,
    Null,
}

#[derive(Copy, Clone)]
pub(crate) struct Node {
    pub(crate) kind: Kind,
    /// `loc.start.offset` and `loc.end.offset`, in bytes.
    pub(crate) start: u32,
    pub(crate) end: u32,
}

pub(crate) struct Tree {
    pub(crate) nodes: Vec<Node>,
    lists: Vec<NodeId>,
    /// The tails of paths, and block parameters.
    names: Vec<Text>,
    owned: Vec<u8>,
}

impl Default for Tree {
    fn default() -> Self {
        let mut tree = Tree {
            nodes: Vec::new(),
            lists: Vec::new(),
            names: Vec::new(),
            owned: Vec::new(),
        };
        tree.clear();
        tree
    }
}

impl Tree {
    pub(crate) fn clear(&mut self) {
        self.nodes.clear();
        self.nodes.push(Node {
            kind: Kind::Nothing,
            start: 0,
            end: 0,
        });
        self.lists.clear();
        self.names.clear();
        self.owned.clear();
    }

    pub(crate) fn add(&mut self, kind: Kind, start: usize, end: usize) -> NodeId {
        self.nodes.push(Node {
            kind,
            start: start as u32,
            end: end as u32,
        });
        (self.nodes.len() - 1) as NodeId
    }

    pub(crate) fn node(&self, id: NodeId) -> Node {
        self.nodes.get(id as usize).copied().unwrap_or(Node {
            kind: Kind::Nothing,
            start: 0,
            end: 0,
        })
    }

    pub(crate) fn kind(&self, id: NodeId) -> Kind {
        self.node(id).kind
    }

    pub(crate) fn kind_mut(&mut self, id: NodeId) -> Option<&mut Kind> {
        self.nodes.get_mut(id as usize).map(|node| &mut node.kind)
    }

    pub(crate) fn list(&self, range: Range) -> &[NodeId] {
        self.lists.get(range.start as usize..(range.start + range.len) as usize).unwrap_or_default()
    }

    pub(crate) fn names(&self, range: Range) -> &[Text] {
        self.names.get(range.start as usize..(range.start + range.len) as usize).unwrap_or_default()
    }

    pub(crate) fn add_list(&mut self, nodes: &[NodeId]) -> Range {
        let start = self.lists.len() as u32;
        self.lists.extend_from_slice(nodes);
        Range {
            start,
            len: nodes.len() as u32,
        }
    }

    pub(crate) fn add_names(&mut self, names: &[Text]) -> Range {
        let start = self.names.len() as u32;
        self.names.extend_from_slice(names);
        Range {
            start,
            len: names.len() as u32,
        }
    }

    /// `source`: the template.
    pub(crate) fn text<'a>(&'a self, source: &'a [u8], text: Text) -> &'a [u8] {
        let bytes = if text.is_owned() { &self.owned[..] } else { source };
        bytes.get(text.range()).unwrap_or_default()
    }

    /// Where a text that is written to `owned` starts.
    pub(crate) fn start_text(&self) -> usize {
        self.owned.len()
    }

    pub(crate) fn write(&mut self, bytes: &[u8]) {
        self.owned.extend_from_slice(bytes);
    }

    pub(crate) fn write_text(&mut self, source: &[u8], text: Text) {
        match text.is_owned() {
            true => self.owned.extend_from_within(text.range()),
            false => self.owned.extend_from_slice(source.get(text.range()).unwrap_or_default()),
        }
    }

    /// What has been written since `start_text` returned `start`.
    pub(crate) fn end_text(&self, start: usize) -> Text {
        Text {
            start: start as u32 | OWNED,
            len: (self.owned.len() - start) as u32,
        }
    }

    /// Makes `text` end where `owned` ends, so that it can grow.
    fn own(&mut self, source: &[u8], text: &mut Text) {
        if text.is_owned() && text.range().end == self.owned.len() {
            return;
        }
        let start = self.start_text();
        self.write_text(source, *text);
        *text = self.end_text(start);
    }

    /// `text += source[start..end]`. Nothing is copied as long as `text` is one piece of the template.
    pub(crate) fn append_source(&mut self, source: &[u8], text: &mut Text, start: usize, end: usize) {
        if text.is_empty() {
            *text = Text::source(start, end);
        } else if !text.is_owned() && text.range().end == start {
            text.len += (end - start) as u32;
        } else {
            self.append(source, text, source.get(start..end).unwrap_or_default());
        }
    }

    /// `text += bytes`
    pub(crate) fn append(&mut self, source: &[u8], text: &mut Text, bytes: &[u8]) {
        self.own(source, text);
        self.owned.extend_from_slice(bytes);
        text.len += bytes.len() as u32;
    }
}
