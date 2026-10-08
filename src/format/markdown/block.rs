//! The blocks of a Markdown text: what micromark's `document`, `flow` and `content` tokenizers find,
//! line by line.
//!
//! A line first continues the containers that are open (block quotes, lists, footnote definitions),
//! then it can open new ones, and what is left of it goes to the leaf block that is open, or starts one.
//! The text of paragraphs, headings and table cells is parsed at the end, when all definitions are known.

use super::ast::{Align, Kind, NONE, NodeId, Str, Tree};
use super::content::Content;
use super::inline;
use super::strings::{normalize_identifier, unescape};
use rustc_hash::FxHashSet;

/// A place in a line. A tab is as wide as it takes to get to the next multiple of four columns. Its first
/// column is the character, the others are virtual spaces behind it.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Cursor {
    pub(crate) offset: usize,
    pub(crate) column: usize,
    /// How many virtual spaces of the tab before `offset` are left.
    pub(crate) virtual_spaces: u8,
}

/// A part of a line that belongs to a leaf block.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Segment {
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The virtual spaces before `start`, which are spaces in a value.
    pub(crate) virtual_spaces: u8,
    /// Of a line of a paragraph: it is indented by four columns or more.
    pub(crate) is_indented: bool,
}

#[derive(Copy, Clone, Debug)]
enum ContainerKind {
    Blockquote,
    List {
        ordered: bool,
        /// `-`, `+`, `*`, `.` or `)`
        marker: u8,
        /// How far the content of the current item is indented.
        size: usize,
        item: NodeId,
        initial_blank_line: bool,
        further_blank_lines: bool,
    },
    FootnoteDefinition,
}

#[derive(Copy, Clone, Debug)]
struct Container {
    kind: ContainerKind,
    node: NodeId,
}

#[derive(Copy, Clone, Debug)]
enum Leaf {
    None,
    /// Its lines are `segments[first_segment..]`.
    Paragraph {
        first_segment: usize,
    },
    IndentedCode {
        node: NodeId,
        first_segment: usize,
        /// How many of the segments are certain to be part of it: those after are blank lines.
        certain: usize,
    },
    /// Fenced code, or math between `$$`.
    Fenced {
        node: NodeId,
        marker: u8,
        size: usize,
        indent: usize,
        first_segment: usize,
    },
    Html {
        node: NodeId,
        kind: u8,
        first_segment: usize,
    },
    Table {
        node: NodeId,
    },
}

/// Text to be parsed when all blocks are known.
struct Pending {
    node: NodeId,
    first_segment: usize,
    segment_count: usize,
}

/// A line of the text, and what can be told from it alone.
#[derive(Copy, Clone)]
struct Line<'t> {
    text: &'t [u8],
    /// Where it ends, before its line break.
    end: usize,
}

pub(crate) struct Parser<'t> {
    text: &'t [u8],
    is_plain: bool,
    is_mdx: bool,
    has: inline::Has,
    line: Line<'t>,
    tree: &'t mut Tree,
    root: NodeId,
    containers: Vec<Container>,
    leaf: Leaf,
    segments: Vec<Segment>,
    pending: Vec<Pending>,
    pub(crate) definitions: FxHashSet<Vec<u8>>,
    pub(crate) footnotes: FxHashSet<Vec<u8>>,
    /// A blank line has been seen since the last line that was not.
    has_blank_line: bool,
    /// What is before this offset has been dealt with: Liquid over several lines.
    skip_to: usize,
    content: Content,
    stack_check: bun_core::StackCheck,
    pub(crate) is_nested_too_deeply: bool,
}

const MAX_CONTAINERS: usize = 200;

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

pub(crate) fn is_blank(text: &[u8]) -> bool {
    text.iter().all(|&byte| is_space(byte))
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Syntax {
    Markdown,
    /// See [`parse_content`].
    Plain,
    /// What Prettier makes of MDX, with remark-parse 8: `import` and `export`, any tag starts HTML, which is JSX.
    Mdx,
}

/// What Prettier parses has blanks in the place of the front matter. That only makes a difference if something
/// follows the front matter on its last line. Then this is the text with the blanks.
pub(crate) fn blank_front_matter(text: &[u8]) -> Option<Vec<u8>> {
    let end = super::front_matter::parse(text)?.end;
    if matches!(text.get(end), None | Some(b'\n')) {
        return None;
    }
    let mut blanked = text.to_vec();
    for byte in blanked[..end].iter_mut().filter(|byte| **byte != b'\n') {
        *byte = b' ';
    }
    Some(blanked)
}

/// Fills `tree` with the syntax of `text`, in which every line break is `\n`. Returns the root. `original`: the
/// same, or the text that `text` is for [`blank_front_matter`].
pub(crate) fn parse(text: &[u8], original: &[u8], syntax: Syntax, tree: &mut Tree) -> Option<NodeId> {
    let Some(front_matter) = super::front_matter::parse(original) else {
        return parse_lines(text, tree, syntax, 0);
    };
    let is_blanked = !matches!(original.get(front_matter.end), None | Some(b'\n'));
    let first_line = if is_blanked { front_matter.end - 3 } else { front_matter.end + 1 };
    let root = parse_lines(text, tree, syntax, first_line)?;
    let node = tree.add(Kind::FrontMatter, 0, front_matter.end as u32);
    tree.prepend(root, node);
    Some(root)
}

/// `is_plain`: CommonMark with strikethrough, footnotes and task lists, and nothing else: no tables, math, Liquid,
/// wiki links, or links that are not marked as such.
pub(crate) fn parse_content(text: &[u8], tree: &mut Tree, is_plain: bool) -> Option<NodeId> {
    let syntax = if is_plain { Syntax::Plain } else { Syntax::Markdown };
    parse_lines(text, tree, syntax, 0)
}

/// `first_line`: where the first line starts that is looked at.
fn parse_lines(text: &[u8], tree: &mut Tree, syntax: Syntax, first_line: usize) -> Option<NodeId> {
    tree.clear();
    let is_plain = syntax == Syntax::Plain;
    if u32::try_from(text.len()).is_err() || text.len() >= (1 << 30) {
        return None;
    }
    let root = tree.add(Kind::Root, 0, text.len() as u32);
    let mut parser = Parser {
        text,
        is_plain,
        is_mdx: syntax == Syntax::Mdx,
        has: inline::Has::new(text, is_plain),
        line: Line { text, end: 0 },
        tree,
        root,
        containers: Vec::new(),
        leaf: Leaf::None,
        segments: Vec::new(),
        pending: Vec::new(),
        definitions: FxHashSet::default(),
        footnotes: FxHashSet::default(),
        has_blank_line: false,
        skip_to: first_line,
        content: Content::default(),
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
    };
    parser.run();
    (!parser.is_nested_too_deeply).then_some(root)
}

impl<'t> Line<'t> {
    // ───────────────────────────── the cursor ─────────────────────────────

    fn byte(&self, cursor: Cursor) -> Option<u8> {
        if cursor.virtual_spaces > 0 {
            return Some(b' ');
        }
        self.text.get(cursor.offset).copied().filter(|_| cursor.offset < self.end)
    }

    fn at_space(&self, cursor: Cursor) -> bool {
        self.byte(cursor).is_some_and(is_space)
    }

    /// Passes one column of white space.
    fn pass_space(&self, cursor: &mut Cursor) {
        if cursor.virtual_spaces > 0 {
            cursor.virtual_spaces -= 1;
        } else {
            if self.text.get(cursor.offset) == Some(&b'\t') {
                cursor.virtual_spaces = (3 - cursor.column % 4) as u8;
            }
            cursor.offset += 1;
        }
        cursor.column += 1;
    }

    /// Passes up to `max` columns of white space. Returns how many.
    fn pass_spaces(&self, cursor: &mut Cursor, max: usize) -> usize {
        let mut count = 0;
        while count < max && self.at_space(*cursor) {
            self.pass_space(cursor);
            count += 1;
        }
        count
    }

    /// Passes a character that is not white space.
    fn pass_byte(cursor: &mut Cursor) {
        cursor.offset += 1;
        cursor.column += 1;
    }

    fn rest(&self, cursor: Cursor) -> &'t [u8] {
        self.text.get(cursor.offset..self.end).unwrap_or_default()
    }

    fn is_rest_blank(&self, cursor: Cursor) -> bool {
        is_blank(self.rest(cursor))
    }

    fn segment(&self, cursor: Cursor) -> Segment {
        Segment {
            start: cursor.offset as u32,
            end: self.end as u32,
            virtual_spaces: cursor.virtual_spaces,
            is_indented: false,
        }
    }
}

impl<'t> Line<'t> {
    /// Whether what is at `cursor` is a thematic break.
    fn is_thematic_break(&self, cursor: Cursor) -> bool {
        let rest = self.rest(cursor);
        let Some(&marker @ (b'*' | b'-' | b'_')) = rest.first() else {
            return false;
        };
        rest.iter().all(|&byte| byte == marker || is_space(byte)) && bun_core::strings::count_char(rest, marker) >= 3
    }

    /// The marker of a list item at `cursor`.
    fn find_item(&self, cursor: Cursor, interrupts: bool) -> Option<NewContainer> {
        if cursor.virtual_spaces > 0 {
            return None;
        }
        let rest = self.rest(cursor);
        let (ordered, marker, number, len) = match *rest.first()? {
            marker @ (b'*' | b'-') if self.is_thematic_break(cursor) => {
                let _ = marker;
                return None;
            }
            marker @ (b'*' | b'-' | b'+') => (false, marker, 0, 1),
            b'0'..=b'9' => {
                let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
                let marker = *rest.get(digits)?;
                if digits > 9 || !matches!(marker, b'.' | b')') {
                    return None;
                }
                // Only a list that starts with 1 interrupts a paragraph.
                if interrupts && rest[..digits] != *b"1" {
                    return None;
                }
                let number = rest[..digits].iter().fold(0u32, |number, digit| number * 10 + u32::from(digit - b'0'));
                (true, marker, number, digits + 1)
            }
            _ => return None,
        };
        let after = &rest[len..];
        match after.first() {
            // An empty item does not interrupt a paragraph.
            _ if is_blank(after) => (!interrupts).then_some(()),
            Some(&byte) if is_space(byte) => Some(()),
            _ => None,
        }?;
        Some(NewContainer::Item {
            ordered,
            marker,
            number,
        })
    }

    /// `[^label]:` at `cursor`
    fn find_footnote_definition(&self, cursor: Cursor) -> Option<NewContainer> {
        let rest = self.rest(cursor);
        let label = rest.strip_prefix(b"[^")?;
        let mut index = 0;
        let mut has_data = false;
        loop {
            match *label.get(index)? {
                b']' => break,
                b'[' => return None,
                byte if is_space(byte) => return None,
                b'\\' if matches!(label.get(index + 1), Some(b'[' | b'\\' | b']')) => index += 1,
                _ => {}
            }
            has_data = true;
            index += 1;
            if index > 999 {
                return None;
            }
        }
        if !has_data || label.get(index + 1) != Some(&b':') {
            return None;
        }
        Some(NewContainer::FootnoteDefinition {
            label_end: cursor.offset + 2 + index,
        })
    }

    /// The container that starts at `cursor`, after up to three spaces, which are passed.
    fn find_container(&self, cursor: &mut Cursor, interrupts: bool) -> Option<NewContainer> {
        self.pass_spaces(cursor, 3);
        if cursor.virtual_spaces > 0 {
            return None;
        }
        match self.byte(*cursor)? {
            b'>' => Some(NewContainer::Blockquote),
            b'[' => self.find_footnote_definition(*cursor),
            _ => self.find_item(*cursor, interrupts),
        }
    }
}

impl<'t> Parser<'t> {
    // ───────────────────────────── the tree ─────────────────────────────

    /// The node that new blocks are children of.
    fn parent(&self) -> NodeId {
        match self.containers.last() {
            Some(Container {
                kind: ContainerKind::List { item, .. },
                ..
            }) => *item,
            Some(container) => container.node,
            None => self.root,
        }
    }

    fn add_block(&mut self, kind: Kind, start: usize, end: usize) -> NodeId {
        let parent = self.parent();
        let node = self.tree.add(kind, start as u32, end as u32);
        self.tree.append(parent, node);
        node
    }

    fn set_end(&mut self, node: NodeId, end: usize) {
        if let Some(node) = self.tree.get_mut(node) {
            node.end = end as u32;
        }
    }

    /// The containers from `first` on get the current line.
    fn extend_containers(&mut self, end: usize) {
        for index in 0..self.containers.len() {
            let container = self.containers[index];
            self.set_end(container.node, end);
            if let ContainerKind::List { item, .. } = container.kind {
                self.set_end(item, end);
            }
        }
    }

    // ───────────────────────────── lines ─────────────────────────────

    fn run(&mut self) {
        let mut line_start = 0;
        // What is behind the last line break is a line too, an empty one.
        while !self.text.is_empty() {
            self.tree.line_starts.push(line_start as u32);
            let rest = &self.text[line_start..];
            let len = bun_core::strings::index_of_char_usize(rest, b'\n');
            self.line.end = line_start + len.unwrap_or(rest.len());
            if line_start >= self.skip_to {
                self.line(line_start);
            }
            if len.is_none() || self.is_nested_too_deeply {
                break;
            }
            line_start = self.line.end + 1;
        }
        if self.tree.line_starts.is_empty() {
            self.tree.line_starts.push(0);
        }
        self.close_leaf();
        self.close_containers(0);
        self.parse_pending();
    }

    fn line(&mut self, line_start: usize) {
        let mut cursor = Cursor {
            offset: line_start,
            column: 0,
            virtual_spaces: 0,
        };

        // Which of the open containers go on.
        let mut continued = 0;
        let mut starts_item = false;
        while continued < self.containers.len() {
            let mut attempt = cursor;
            match self.continue_container(continued, &mut attempt) {
                Continuation::Yes => cursor = attempt,
                Continuation::NextItem => {
                    // The flow and what is in the item are closed, the list goes on.
                    let has_line_break = self.close_flow(line_start);
                    if has_line_break {
                        self.end_containers(continued + 1, line_start, true);
                    }
                    self.close_containers(continued + 1);
                    self.note_blank_line_before(continued, true);
                    let previous_item = match self.containers[continued].kind {
                        ContainerKind::List { item, .. } => item,
                        _ => NONE,
                    };
                    self.start_item(continued, cursor, &mut attempt);
                    cursor = attempt;
                    // With no line break between them, mdast-util-from-markdown ends an item where the marker of
                    // the next ends.
                    if has_line_break {
                        self.set_end(previous_item, cursor.offset);
                    }
                    continued += 1;
                    starts_item = true;
                    break;
                }
                Continuation::No => break,
            }
            continued += 1;
        }
        let all_continued = continued == self.containers.len();

        // New containers.
        let is_concrete = matches!(self.leaf, Leaf::Fenced { .. } | Leaf::Html { .. });
        let mut has_new_container = starts_item;
        if !(all_continued && is_concrete && !starts_item) {
            let interrupts = all_continued
                && !starts_item
                && matches!(self.leaf, Leaf::Paragraph { .. } | Leaf::IndentedCode { .. });
            let mut is_first = true;
            loop {
                let mut attempt = cursor;
                let Some(new) = self.line.find_container(&mut attempt, interrupts) else {
                    break;
                };
                if is_first && !starts_item {
                    // micromark closes the containers here, and then moves their ends back over line breaks and
                    // indentation. The marker of a block quote is in the way of that.
                    let has_line_break = self.close_flow(line_start);
                    let has_marker = self.containers[..continued].iter().any(|it| matches!(it.kind, ContainerKind::Blockquote));
                    if has_line_break || has_marker {
                        self.end_containers(continued, cursor.offset, has_line_break);
                    }
                    self.close_containers(continued);
                    self.note_blank_line_before(continued.wrapping_sub(1), false);
                }
                is_first = false;
                has_new_container = true;
                self.open_container(&new, cursor, &mut attempt);
                cursor = attempt;
                if self.containers.len() > MAX_CONTAINERS {
                    self.is_nested_too_deeply = true;
                    return;
                }
            }
        }

        let is_lazy = !has_new_container && !all_continued;
        self.flow(cursor, is_lazy, continued, has_new_container);
    }

    /// Closes the leaf block because a container ends. Code and HTML that have not been closed have taken the
    /// line break before the line that starts at `line_start`. Returns whether that is so.
    fn close_flow(&mut self, line_start: usize) -> bool {
        let node = match self.leaf {
            Leaf::Fenced { node, .. } => node,
            Leaf::Html { node, kind, .. } if kind <= 5 => node,
            _ => {
                self.close_leaf();
                return false;
            }
        };
        self.segments.push(Segment {
            start: line_start as u32,
            end: line_start as u32,
            virtual_spaces: 0,
            is_indented: false,
        });
        self.set_end(node, line_start);
        self.close_leaf();
        true
    }

    /// The containers from `first` on end at `end`, and their items if `with_items`.
    fn end_containers(&mut self, first: usize, end: usize, with_items: bool) {
        for index in first..self.containers.len() {
            let container = self.containers[index];
            self.set_end(container.node, end);
            if let ContainerKind::List { item, .. } = container.kind
                && with_items
            {
                self.set_end(item, end);
            }
        }
    }

    /// A line that is not blank follows blank lines. `deepest`: the index of the innermost container that
    /// goes on. If that is a list, it or its item is spread out.
    fn note_blank_line_before(&mut self, deepest: usize, is_next_item: bool) {
        if !std::mem::take(&mut self.has_blank_line) {
            return;
        }
        let Some(&Container {
            kind: ContainerKind::List { item, .. },
            node,
        }) = self.containers.get(deepest)
        else {
            return;
        };
        if let Some(node) = self.tree.get_mut(if is_next_item { node } else { item }) {
            node.spread = true;
        }
    }
}

enum Continuation {
    Yes,
    No,
    /// The list goes on with its next item.
    NextItem,
}

/// A container that a line opens.
enum NewContainer {
    Blockquote,
    Item {
        ordered: bool,
        marker: u8,
        number: u32,
    },
    FootnoteDefinition {
        label_end: usize,
    },
}

impl<'t> Parser<'t> {
    // ───────────────────────────── containers ─────────────────────────────

    fn continue_container(&mut self, index: usize, cursor: &mut Cursor) -> Continuation {
        let is_blank = self.line.is_rest_blank(*cursor);
        let Some(container) = self.containers.get_mut(index) else {
            return Continuation::No;
        };
        match &mut container.kind {
            ContainerKind::Blockquote => {
                self.line.pass_spaces(cursor, 3);
                if self.line.byte(*cursor) != Some(b'>') || cursor.virtual_spaces > 0 {
                    return Continuation::No;
                }
                Line::pass_byte(cursor);
                self.line.pass_spaces(cursor, 1);
                Continuation::Yes
            }
            ContainerKind::FootnoteDefinition => {
                if is_blank {
                    return Continuation::Yes;
                }
                match self.line.pass_spaces(cursor, 4) {
                    4 => Continuation::Yes,
                    _ => Continuation::No,
                }
            }
            ContainerKind::List {
                size,
                initial_blank_line,
                further_blank_lines,
                ordered,
                marker,
                ..
            } => {
                let size = *size;
                if is_blank {
                    *further_blank_lines = *further_blank_lines || *initial_blank_line;
                    self.line.pass_spaces(cursor, size);
                    return Continuation::Yes;
                }
                let had_further_blank_lines = std::mem::take(further_blank_lines);
                *initial_blank_line = false;
                let (ordered, marker) = (*ordered, *marker);
                if !had_further_blank_lines {
                    let mut indented = *cursor;
                    if self.line.pass_spaces(&mut indented, size) == size {
                        *cursor = indented;
                        return Continuation::Yes;
                    }
                }
                let mut attempt = *cursor;
                self.line.pass_spaces(&mut attempt, 3);
                match self.line.find_item(attempt, false) {
                    Some(NewContainer::Item {
                        ordered: next_ordered,
                        marker: next_marker,
                        ..
                    }) if next_ordered == ordered && next_marker == marker => Continuation::NextItem,
                    _ => Continuation::No,
                }
            }
        }
    }

    /// `line_prefix_start`: where the white space before the marker starts. `cursor` is at the marker, and
    /// is moved behind what belongs to it.
    fn open_container(&mut self, new: &NewContainer, line_prefix_start: Cursor, cursor: &mut Cursor) {
        match *new {
            NewContainer::Blockquote => {
                let node = self.add_block(Kind::Blockquote, cursor.offset, cursor.offset + 1);
                Line::pass_byte(cursor);
                self.line.pass_spaces(cursor, 1);
                self.containers.push(Container {
                    kind: ContainerKind::Blockquote,
                    node,
                });
            }
            NewContainer::FootnoteDefinition { label_end } => {
                let node = self.add_block(Kind::FootnoteDefinition, cursor.offset, label_end + 2);
                let label = Str::source(cursor.offset as u32 + 2, label_end as u32);
                let raw = &self.text[cursor.offset + 2..label_end];
                let identifier = normalize_identifier(raw);
                let lowercase = self.tree.owned(|out| super::strings::push_lowercase(&identifier, out));
                let label = match bun_core::strings::index_of_any(raw, b"\\&") {
                    Some(_) => self.tree.owned(|out| unescape(raw, out)),
                    None => label,
                };
                self.footnotes.insert(identifier);
                if let Some(node) = self.tree.get_mut(node) {
                    (node.value, node.identifier) = (label, lowercase);
                }
                cursor.column += label_end + 2 - cursor.offset;
                cursor.offset = label_end + 2;
                self.line.pass_spaces(cursor, usize::MAX);
                self.containers.push(Container {
                    kind: ContainerKind::FootnoteDefinition,
                    node,
                });
            }
            NewContainer::Item {
                ordered,
                marker,
                number,
            } => {
                let node = self.add_block(Kind::List, cursor.offset, cursor.offset + 1);
                if let Some(node) = self.tree.get_mut(node) {
                    (node.ordered, node.number) = (ordered, number);
                }
                self.containers.push(Container {
                    kind: ContainerKind::List {
                        ordered,
                        marker,
                        size: 0,
                        item: NONE,
                        initial_blank_line: false,
                        further_blank_lines: false,
                    },
                    node,
                });
                let index = self.containers.len() - 1;
                self.start_item(index, line_prefix_start, cursor);
            }
        }
    }

    /// Starts an item in the list at `index` of the containers. `cursor` is before the white space in front
    /// of the marker or at the marker, and is moved to the content.
    fn start_item(&mut self, index: usize, line_prefix_start: Cursor, cursor: &mut Cursor) {
        *cursor = line_prefix_start;
        let initial_size = self.line.pass_spaces(cursor, 3);
        let marker_start = *cursor;
        while self.line.byte(*cursor).is_some_and(|byte| byte.is_ascii_digit()) {
            Line::pass_byte(cursor);
        }
        Line::pass_byte(cursor);
        let marker_end = *cursor;

        let is_blank = self.line.is_rest_blank(*cursor);
        if is_blank {
            // The white space is not part of the prefix.
        } else {
            // One to four spaces. If there are more, the rest is indented code.
            let mut after = *cursor;
            let count = self.line.pass_spaces(&mut after, 5);
            if count <= 4 {
                *cursor = after;
            } else {
                self.line.pass_spaces(cursor, 1);
            }
        }
        let size = initial_size + (cursor.column - marker_start.column) + usize::from(is_blank);

        let Some(&Container { node: list, .. }) = self.containers.get(index) else {
            return;
        };
        let item = self.tree.add(Kind::ListItem, marker_start.offset as u32, marker_end.offset as u32);
        self.tree.append(list, item);
        if let Some(Container {
            kind:
                ContainerKind::List {
                    size: list_size,
                    item: list_item,
                    initial_blank_line,
                    further_blank_lines,
                    ..
                },
            ..
        }) = self.containers.get_mut(index)
        {
            (*list_size, *list_item, *initial_blank_line, *further_blank_lines) = (size, item, is_blank, false);
        }
    }

    /// Closes the containers from `first` on.
    fn close_containers(&mut self, first: usize) {
        self.containers.truncate(first);
    }
}

/// A leaf block that a line starts, other than a paragraph, indented code and a table.
#[derive(Copy, Clone, Debug)]
enum LeafStart {
    Heading,
    ThematicBreak,
    SetextUnderline,
    /// The marker and how many there are.
    Fenced(u8, usize),
    Html(u8),
    /// Where it ends.
    Liquid(usize),
    /// `import` or `export`, and where it ends.
    EsSyntax(Kind, usize),
}

const HTML_BLOCK_NAMES: [&[u8]; 62] = [
    b"address", b"article", b"aside", b"base", b"basefont", b"blockquote", b"body", b"caption", b"center", b"col",
    b"colgroup", b"dd", b"details", b"dialog", b"dir", b"div", b"dl", b"dt", b"fieldset", b"figcaption", b"figure",
    b"footer", b"form", b"frame", b"frameset", b"h1", b"h2", b"h3", b"h4", b"h5", b"h6", b"head", b"header", b"hr",
    b"html", b"iframe", b"legend", b"li", b"link", b"main", b"menu", b"menuitem", b"nav", b"noframes", b"ol",
    b"optgroup", b"option", b"p", b"param", b"search", b"section", b"summary", b"table", b"tbody", b"td", b"tfoot",
    b"th", b"thead", b"title", b"tr", b"track", b"ul",
];
const HTML_RAW_NAMES: [&[u8]; 4] = [b"pre", b"script", b"style", b"textarea"];

fn is_name_in(names: &[&[u8]], name: &[u8]) -> bool {
    names.iter().any(|it| it.eq_ignore_ascii_case(name))
}

/// Whether `rest`, which is behind the name of a tag, is the rest of a complete tag with nothing but
/// white space behind it. micromark's `completeAttributeNameBefore` and what follows.
fn is_complete_tag(rest: &[u8], is_closing: bool) -> bool {
    enum State {
        ClosingTagAfter,
        AttributeNameBefore,
        AttributeName,
        AttributeNameAfter,
        AttributeValueBefore,
        AttributeValueQuoted(u8),
        AttributeValueUnquoted,
        AttributeValueQuotedAfter,
        End,
    }
    let mut state = if is_closing { State::ClosingTagAfter } else { State::AttributeNameBefore };
    let mut index = 0;
    loop {
        let byte = rest.get(index).copied();
        // Every arm either passes the character or goes to a state that looks at it again.
        let (next, passes) = match state {
            State::ClosingTagAfter => match byte {
                Some(b' ' | b'\t') => (State::ClosingTagAfter, true),
                _ => (State::End, false),
            },
            State::AttributeNameBefore => match byte {
                Some(b'/') => (State::End, true),
                Some(byte) if byte == b':' || byte == b'_' || byte.is_ascii_alphabetic() => (State::AttributeName, true),
                Some(b' ' | b'\t') => (State::AttributeNameBefore, true),
                _ => (State::End, false),
            },
            State::AttributeName => match byte {
                Some(byte) if matches!(byte, b'-' | b'.' | b':' | b'_') || byte.is_ascii_alphanumeric() => {
                    (State::AttributeName, true)
                }
                _ => (State::AttributeNameAfter, false),
            },
            State::AttributeNameAfter => match byte {
                Some(b'=') => (State::AttributeValueBefore, true),
                Some(b' ' | b'\t') => (State::AttributeNameAfter, true),
                _ => (State::AttributeNameBefore, false),
            },
            State::AttributeValueBefore => match byte {
                None | Some(b'<' | b'=' | b'>' | b'`') => return false,
                Some(quote @ (b'"' | b'\'')) => (State::AttributeValueQuoted(quote), true),
                Some(b' ' | b'\t') => (State::AttributeValueBefore, true),
                Some(_) => (State::AttributeValueUnquoted, false),
            },
            State::AttributeValueQuoted(quote) => match byte {
                None => return false,
                Some(byte) if byte == quote => (State::AttributeValueQuotedAfter, true),
                Some(_) => (State::AttributeValueQuoted(quote), true),
            },
            State::AttributeValueUnquoted => match byte {
                None | Some(b'"' | b'\'' | b'/' | b'<' | b'=' | b'>' | b'`' | b' ' | b'\t') => {
                    (State::AttributeNameAfter, false)
                }
                Some(_) => (State::AttributeValueUnquoted, true),
            },
            State::AttributeValueQuotedAfter => match byte {
                Some(b'/' | b'>' | b' ' | b'\t') => (State::AttributeNameBefore, false),
                _ => return false,
            },
            State::End => return byte == Some(b'>') && is_blank(&rest[index + 1..]),
        };
        state = next;
        index += usize::from(passes);
    }
}

/// The kind of HTML that `rest` starts, which starts with `<`, and where to go on looking for its end.
fn html_start(rest: &[u8], interrupts: bool, is_lazy: bool, is_mdx: bool) -> Option<(u8, usize, bool)> {
    match *rest.get(1)? {
        b'!' => match *rest.get(2)? {
            b'-' => (rest.get(3) == Some(&b'-')).then_some((2, 4, true)),
            b'[' => rest[3..].starts_with(b"CDATA[").then_some((5, 9, false)),
            byte => byte.is_ascii_alphabetic().then_some((4, 3, true)),
        },
        b'?' => Some((3, 2, true)),
        byte => {
            let is_closing = byte == b'/';
            let name_start = if is_closing { 2 } else { 1 };
            // `[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*|`: any name, with dots, or none.
            if is_mdx {
                let mut after = name_start;
                while rest.get(after).is_some_and(u8::is_ascii_alphabetic) {
                    after += rest[after..].iter().take_while(|byte| byte.is_ascii_alphanumeric()).count();
                    if rest.get(after) == Some(&b'.') && rest.get(after + 1).is_some_and(u8::is_ascii_alphabetic) {
                        after += 1;
                    } else {
                        break;
                    }
                }
                let is_raw = !is_closing && is_name_in(&HTML_RAW_NAMES[..3], &rest[name_start..after]);
                match rest[after..] {
                    [] | [b' ' | b'\t' | b'>', ..] => return Some((if is_raw { 1 } else { 6 }, after, false)),
                    [b'/', b'>', ..] => return Some((6, after, false)),
                    _ => {}
                }
            }
            if !rest.get(name_start)?.is_ascii_alphabetic() {
                return None;
            }
            let len = rest[name_start..].iter().take_while(|&&byte| byte == b'-' || byte.is_ascii_alphanumeric()).count();
            let (name, after) = (&rest[name_start..name_start + len], name_start + len);
            let next = rest.get(after).copied();
            if !matches!(next, None | Some(b'/' | b'>' | b' ' | b'\t')) {
                return None;
            }
            let is_slash = next == Some(b'/');
            if !is_slash && !is_closing && is_name_in(&HTML_RAW_NAMES, name) {
                return Some((1, after, false));
            }
            if is_name_in(&HTML_BLOCK_NAMES, name) {
                return (!is_slash || rest.get(after + 1) == Some(&b'>')).then_some((6, after, false));
            }
            if interrupts && !is_lazy {
                return None;
            }
            is_complete_tag(&rest[after..], is_closing).then_some((7, after, false))
        }
    }
}

/// Whether HTML of `kind`, 1 to 5, ends on the line `line`. micromark's `continuation` and what follows.
/// `in_declaration`: the line starts in `continuationDeclarationInside`.
fn html_ends(kind: u8, line: &[u8], in_declaration: bool) -> bool {
    #[derive(PartialEq)]
    enum State {
        Continuation,
        CommentInside,
        RawTagOpen,
        RawEndTag(usize),
        CdataInside,
        DeclarationInside,
    }
    let mut state = if in_declaration { State::DeclarationInside } else { State::Continuation };
    let mut index = 0;
    while let Some(&byte) = line.get(index) {
        state = match state {
            State::Continuation => {
                index += 1;
                match (byte, kind) {
                    (b'-', 2) => State::CommentInside,
                    (b'<', 1) => State::RawTagOpen,
                    (b'>', 4) => return true,
                    (b'?', 3) => State::DeclarationInside,
                    (b']', 5) => State::CdataInside,
                    _ => State::Continuation,
                }
            }
            State::CommentInside | State::CdataInside => {
                let wanted = if state == State::CommentInside { b'-' } else { b']' };
                match byte == wanted {
                    true => {
                        index += 1;
                        State::DeclarationInside
                    }
                    false => State::Continuation,
                }
            }
            State::RawTagOpen => match byte {
                b'/' => {
                    index += 1;
                    State::RawEndTag(index)
                }
                _ => State::Continuation,
            },
            State::RawEndTag(start) => match byte {
                b'>' if is_name_in(&HTML_RAW_NAMES, &line[start..index]) => return true,
                _ if byte.is_ascii_alphabetic() && index - start < 8 => {
                    index += 1;
                    State::RawEndTag(start)
                }
                _ => State::Continuation,
            },
            State::DeclarationInside => match byte {
                b'>' => return true,
                b'-' if kind == 2 => {
                    index += 1;
                    State::DeclarationInside
                }
                _ => State::Continuation,
            },
        };
    }
    false
}

impl<'t> Parser<'t> {
    // ───────────────────────────── leaf blocks ─────────────────────────────

    /// The leaf block that starts at `cursor`, which is behind less than four columns of indentation.
    fn find_leaf_start(&self, cursor: Cursor, interrupts: bool, is_lazy: bool) -> Option<LeafStart> {
        if cursor.virtual_spaces > 0 {
            return None;
        }
        let rest = self.line.rest(cursor);
        match *rest.first()? {
            b'#' => {
                let size = rest.iter().take_while(|&&byte| byte == b'#').count();
                (size <= 6 && rest.get(size).is_none_or(|&byte| is_space(byte))).then_some(LeafStart::Heading)
            }
            marker @ (b'-' | b'=') if interrupts && !is_lazy && {
                let size = rest.iter().take_while(|&&byte| byte == marker).count();
                is_blank(&rest[size..])
            } =>
            {
                Some(LeafStart::SetextUnderline)
            }
            b'*' | b'-' | b'_' => self.line.is_thematic_break(cursor).then_some(LeafStart::ThematicBreak),
            b'<' => html_start(rest, interrupts, is_lazy, self.is_mdx).map(|(kind, ..)| LeafStart::Html(kind)),
            marker @ (b'`' | b'~') => {
                let size = rest.iter().take_while(|&&byte| byte == marker).count();
                let is_fence = size >= 3 && (marker != b'`' || !bun_core::strings::contains_char(&rest[size..], b'`'));
                is_fence.then_some(LeafStart::Fenced(marker, size))
            }
            b'$' if !self.is_plain => {
                let size = rest.iter().take_while(|&&byte| byte == b'$').count();
                let is_fence = size >= 2 && !bun_core::strings::contains_char(&rest[size..], b'$');
                is_fence.then_some(LeafStart::Fenced(b'$', size))
            }
            b'{' if !self.is_plain && !self.is_mdx => self.find_liquid_end(cursor).map(LeafStart::Liquid),
            b'i' | b'e' if self.is_mdx && !interrupts => self.find_es_syntax(cursor),
            _ => None,
        }
    }

    /// Prettier's `tokenizeEsSyntax`: `import` or `export` at the start of a line that is not in a container, up to
    /// the next empty line.
    fn find_es_syntax(&self, cursor: Cursor) -> Option<LeafStart> {
        if !self.containers.is_empty() || cursor.column > 0 {
            return None;
        }
        let rest = &self.text[cursor.offset..];
        let kind = if rest.starts_with(b"import") { Kind::Import } else { Kind::Export };
        if !(kind == Kind::Import || rest.starts_with(b"export")) || !rest.get(6).is_some_and(u8::is_ascii_whitespace) {
            return None;
        }
        let len = bun_core::strings::index_of(rest, b"\n\n").unwrap_or(rest.len());
        Some(LeafStart::EsSyntax(kind, cursor.offset + len))
    }

    /// Where the `{{ .. }}` or `{% .. %}` at `cursor` ends, if nothing follows it on its last line.
    fn find_liquid_end(&self, cursor: Cursor) -> Option<usize> {
        let closing: &[u8] = match self.text.get(cursor.offset + 1)? {
            b'{' => b"}}",
            b'%' => b"%}",
            _ => return None,
        };
        // Over several lines only outside of containers.
        let limit = if self.containers.is_empty() { self.text.len() } else { self.line.end };
        let from = cursor.offset + 2;
        let end = from + bun_core::strings::index_of(self.text.get(from..limit)?, closing)? + 2;
        let after = &self.text[end..];
        let line_rest = &after[..bun_core::strings::index_of_char_usize(after, b'\n').unwrap_or(after.len())];
        if !is_blank(line_rest) {
            return None;
        }
        // No line in it starts a container.
        let mut line_end = self.line.end;
        while line_end < end {
            let start = line_end + 1;
            let rest = &self.text[start..];
            line_end = start + bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
            let line = Line {
                text: self.text,
                end: line_end,
            };
            let mut cursor = Cursor {
                offset: start,
                column: 0,
                virtual_spaces: 0,
            };
            if line.find_container(&mut cursor, true).is_some() {
                return None;
            }
        }
        Some(end)
    }
}

/// The columns of a table, if `row` is the row of a table that is under its head: `| --- | :-: |`.
fn parse_delimiter_row(row: &[u8]) -> Option<Vec<Align>> {
    let mut aligns = Vec::new();
    let mut has_pipe_or_colon = false;
    let mut index = 0;
    let at = |index: usize| row.get(index).copied();
    let skip_spaces = |index: &mut usize| {
        while at(*index).is_some_and(is_space) {
            *index += 1;
        }
    };
    loop {
        if at(index) == Some(b'|') {
            has_pipe_or_colon = true;
            index += 1;
            skip_spaces(&mut index);
            if at(index).is_none() {
                break;
            }
        }
        let is_left = at(index) == Some(b':');
        index += usize::from(is_left);
        let dashes = row[index.min(row.len())..].iter().take_while(|&&byte| byte == b'-').count();
        if dashes == 0 {
            return None;
        }
        index += dashes;
        let is_right = at(index) == Some(b':');
        index += usize::from(is_right);
        has_pipe_or_colon |= is_left || is_right;
        aligns.push(match (is_left, is_right) {
            (false, false) => Align::None,
            (true, false) => Align::Left,
            (true, true) => Align::Center,
            (false, true) => Align::Right,
        });
        skip_spaces(&mut index);
        match at(index) {
            None => break,
            Some(b'|') => {}
            Some(_) => return None,
        }
    }
    has_pipe_or_colon.then_some(aligns)
}

/// A cell of a row: where it is, and where what is in it is, if there is something in it.
struct Cell {
    start: usize,
    end: usize,
    content: Option<(usize, usize)>,
}

/// The cells of the row `row` of a table, with offsets in `row`. What micromark's `resolveTable` does.
fn split_row(row: &[u8]) -> Vec<Cell> {
    let mut cells: Vec<Cell> = Vec::new();
    let (mut start, mut content, mut awaits_first_pipe) = (0, None::<(usize, usize)>, true);
    let mut index = 0;
    while let Some(&byte) = row.get(index) {
        match byte {
            b'|' => {
                if !std::mem::take(&mut awaits_first_pipe) {
                    cells.push(Cell {
                        start,
                        end: index,
                        content: content.take(),
                    });
                    start = index;
                }
                index += 1;
            }
            b' ' | b'\t' => index += 1,
            _ => {
                awaits_first_pipe = false;
                let len = if byte == b'\\' && matches!(row.get(index + 1), Some(b'\\' | b'|')) { 2 } else { 1 };
                content = Some((content.map_or(index, |it| it.0), index + len));
                index += len;
            }
        }
    }
    match cells.last_mut() {
        // A pipe at the end belongs to the cell before it.
        Some(last) if content.is_none() => last.end = row.len(),
        _ => cells.push(Cell {
            start,
            end: row.len(),
            content,
        }),
    }
    cells
}

/// How many cells the row `row` has as the head of a table. `None`: it cannot be one.
fn count_head_cells(row: &[u8]) -> Option<usize> {
    if row.iter().filter(|&&byte| !is_space(byte)).count() == 1 && bun_core::strings::contains_char(row, b'|') {
        return None;
    }
    // An empty cell at the end, which `split_row` does not make one, does not count either.
    (!is_blank(row)).then(|| split_row(row).len())
}

impl<'t> Parser<'t> {
    // ───────────────────────────── what is left of a line ─────────────────────────────

    fn flow(&mut self, cursor: Cursor, is_lazy: bool, continued: usize, has_new_container: bool) {
        let is_blank = self.line.is_rest_blank(cursor);
        if is_lazy {
            // Only a paragraph goes on without the markers of its containers.
            if let Leaf::Paragraph { .. } = self.leaf
                && !is_blank
            {
                let mut content = cursor;
                let indent = self.line.pass_spaces(&mut content, usize::MAX);
                let start = if indent >= 4 { None } else { self.find_leaf_start(content, true, true) };
                match start {
                    None => {
                        self.segments.push(Segment {
                            is_indented: true,
                            ..self.line.segment(cursor)
                        });
                        return self.extend_containers(self.line.end);
                    }
                    // micromark only knows at the next line that a complete tag ends the paragraph. By then
                    // it has taken the line for one that goes on in the containers.
                    Some(start @ LeafStart::Html(7)) => {
                        self.close_leaf();
                        self.extend_containers(self.line.end);
                        return self.start_leaf(start, cursor, content);
                    }
                    Some(_) => {}
                }
            }
            self.close_leaf();
            self.close_containers(continued);
        }
        if is_blank {
            return self.blank_line(cursor, has_new_container);
        }
        let end = self.line.end;

        match self.leaf {
            Leaf::Fenced {
                node,
                marker,
                size,
                indent,
                ..
            } => {
                self.set_end(node, end);
                self.extend_containers(end);
                let mut fence = cursor;
                self.line.pass_spaces(&mut fence, 3);
                let rest = self.line.rest(fence);
                let count = rest.iter().take_while(|&&byte| byte == marker).count();
                if fence.virtual_spaces == 0 && count >= size && self::is_blank(&rest[count..]) {
                    return self.close_fenced(true);
                }
                let mut content = cursor;
                self.line.pass_spaces(&mut content, indent);
                return self.segments.push(self.line.segment(content));
            }
            Leaf::Html { node, kind, .. } => {
                self.set_end(node, end);
                self.extend_containers(end);
                self.segments.push(self.line.segment(cursor));
                if kind <= 5 && html_ends(kind, self.line.rest(cursor), false) {
                    self.close_leaf();
                }
                return;
            }
            Leaf::IndentedCode {
                node,
                first_segment,
                ..
            } => {
                let mut content = cursor;
                if self.line.pass_spaces(&mut content, 4) == 4 {
                    // The blank lines before it are part of the code.
                    self.has_blank_line = false;
                    self.segments.push(self.line.segment(content));
                    self.leaf = Leaf::IndentedCode {
                        node,
                        first_segment,
                        certain: self.segments.len(),
                    };
                    self.set_end(node, end);
                    return self.extend_containers(end);
                }
                self.close_leaf();
            }
            Leaf::Paragraph { first_segment } => {
                let mut content = cursor;
                let indent = self.line.pass_spaces(&mut content, usize::MAX);
                let start = if indent >= 4 { None } else { self.find_leaf_start(content, true, false) };
                match start {
                    Some(LeafStart::SetextUnderline) => {
                        let depth = if self.line.byte(content) == Some(b'=') { 1 } else { 2 };
                        self.extend_containers(end);
                        if self.close_paragraph(Some(depth)) {
                            return;
                        }
                        // There were only definitions: the line is like any other.
                    }
                    Some(_) => self.close_leaf(),
                    None if indent < 4 && self.starts_table(first_segment, content) => {
                        return self.extend_containers(end);
                    }
                    None => {
                        self.segments.push(Segment {
                            is_indented: indent >= 4,
                            ..self.line.segment(cursor)
                        });
                        return self.extend_containers(end);
                    }
                }
            }
            Leaf::Table { node } => {
                let mut content = cursor;
                let indent = self.line.pass_spaces(&mut content, 4);
                if indent < 4 && self.find_leaf_start(content, false, false).is_none() {
                    self.add_row(node, content.offset, end);
                    self.set_end(node, end);
                    return self.extend_containers(end);
                }
                self.close_leaf();
            }
            Leaf::None => {}
        }

        if !has_new_container {
            self.note_blank_line_before(self.containers.len().wrapping_sub(1), false);
        }
        self.has_blank_line = false;
        self.extend_containers(end);
        let mut content = cursor;
        if self.line.pass_spaces(&mut content, 4) == 4 {
            let node = self.add_block(Kind::Code, cursor.offset, end);
            let first_segment = self.segments.len();
            self.segments.push(self.line.segment(content));
            self.leaf = Leaf::IndentedCode {
                node,
                first_segment,
                certain: first_segment + 1,
            };
            // At the end of a line, micromark asks whether that line goes on without the markers of its
            // containers, not the next.
            if is_lazy {
                self.close_leaf();
            }
            return;
        }
        match self.find_leaf_start(content, false, false) {
            Some(start) => self.start_leaf(start, cursor, content),
            None => {
                self.leaf = Leaf::Paragraph {
                    first_segment: self.segments.len(),
                };
                self.segments.push(self.line.segment(content));
            }
        }
    }

    /// `has_new_container`: the line has the marker of a container that it opens.
    fn blank_line(&mut self, cursor: Cursor, has_new_container: bool) {
        let end = self.line.end;
        match self.leaf {
            Leaf::Fenced { node, indent, .. } => {
                let mut content = cursor;
                self.line.pass_spaces(&mut content, indent);
                self.segments.push(self.line.segment(content));
                self.set_end(node, end);
                return self.extend_containers(end);
            }
            // For remark-parse 8, only a line with nothing on it ends HTML.
            Leaf::Html { node, kind, .. } if kind <= 5 || (self.is_mdx && cursor.offset < end) => {
                self.segments.push(self.line.segment(cursor));
                self.set_end(node, end);
                return self.extend_containers(end);
            }
            Leaf::IndentedCode {
                node,
                first_segment,
                ..
            } => {
                let mut content = cursor;
                let is_indented = self.line.pass_spaces(&mut content, 4) == 4;
                self.segments.push(self.line.segment(content));
                // A blank line that is indented enough is part of the code, even at its end.
                if is_indented {
                    self.has_blank_line = false;
                    self.leaf = Leaf::IndentedCode {
                        node,
                        first_segment,
                        certain: self.segments.len(),
                    };
                    self.set_end(node, end);
                    return self.extend_containers(end);
                }
            }
            _ => self.close_leaf(),
        }
        if has_new_container {
            return self.extend_containers(end);
        }
        // The line belongs to the block quotes whose marker it has, and to what they are in. A list in
        // them ends behind it, but not its item.
        let Some(deepest) = self.containers.iter().rposition(|it| matches!(it.kind, ContainerKind::Blockquote)) else {
            self.has_blank_line = true;
            return;
        };
        self.has_blank_line |= deepest + 1 < self.containers.len();
        for index in 0..self.containers.len() {
            let container = self.containers[index];
            self.set_end(container.node, end);
            if let ContainerKind::List { item, .. } = container.kind
                && index < deepest
            {
                self.set_end(item, end);
            }
        }
    }

    /// `prefix_start`: where the indentation of the line starts. `cursor`: where the block does.
    fn start_leaf(&mut self, start: LeafStart, prefix_start: Cursor, cursor: Cursor) {
        let end = self.line.end;
        let rest = self.line.rest(cursor);
        match start {
            LeafStart::SetextUnderline => {}
            LeafStart::ThematicBreak => _ = self.add_block(Kind::ThematicBreak, cursor.offset, end),
            LeafStart::Heading => {
                let node = self.add_block(Kind::Heading, cursor.offset, end);
                let depth = rest.iter().take_while(|&&byte| byte == b'#').count();
                let after = &rest[depth..];
                let mut text = after.trim_ascii();
                let without_closing = &text[..text.len() - text.iter().rev().take_while(|&&byte| byte == b'#').count()];
                if without_closing.last().is_none_or(|&byte| is_space(byte)) {
                    text = without_closing.trim_ascii_end();
                }
                if let Some(node) = self.tree.get_mut(node) {
                    node.number = depth as u32;
                }
                if !text.is_empty() {
                    let blanks = after.len() - after.trim_ascii_start().len();
                    let text_start = cursor.offset + depth + blanks;
                    self.add_pending(node, text_start, text_start + text.len());
                }
            }
            LeafStart::Fenced(marker, size) => {
                let kind = if marker == b'$' { Kind::Math } else { Kind::Code };
                let node = self.add_block(kind, cursor.offset, end);
                let info = &rest[size..];
                let info = &info[info.len() - info.trim_ascii_start().len()..];
                let lang_len = match kind {
                    Kind::Code => info.iter().take_while(|&&byte| !is_space(byte)).count(),
                    _ => 0,
                };
                let (lang, meta) = info.split_at(lang_len);
                let meta = meta.trim_ascii_start();
                let (lang, meta) = (self.string_value(lang), self.string_value(meta));
                if let Some(node) = self.tree.get_mut(node) {
                    (node.second, node.third) = (lang, meta);
                }
                self.leaf = Leaf::Fenced {
                    node,
                    marker,
                    size,
                    indent: cursor.column - prefix_start.column,
                    first_segment: self.segments.len(),
                };
            }
            LeafStart::Html(kind) => {
                let node = self.add_block(Kind::Html, prefix_start.offset, end);
                let first_segment = self.segments.len();
                self.segments.push(self.line.segment(prefix_start));
                self.leaf = Leaf::Html {
                    node,
                    kind,
                    first_segment,
                };
                if let Some((_, from, in_declaration)) = html_start(rest, false, true, self.is_mdx)
                    && kind <= 5
                    && html_ends(kind, &rest[from..], in_declaration)
                {
                    self.close_leaf();
                }
            }
            LeafStart::EsSyntax(kind, es_end) => {
                let node = self.add_block(kind, cursor.offset, es_end);
                if let Some(node) = self.tree.get_mut(node) {
                    node.value = Str::source(cursor.offset as u32, es_end as u32);
                }
                self.skip_to = es_end;
            }
            LeafStart::Liquid(liquid_end) => {
                let node = self.add_block(Kind::LiquidNode, cursor.offset, liquid_end);
                if let Some(node) = self.tree.get_mut(node) {
                    node.value = Str::source(cursor.offset as u32, liquid_end as u32);
                }
                self.skip_to = liquid_end;
            }
        }
    }

    /// The value of a string in which escapes and character references count. `null` if it is empty.
    fn string_value(&mut self, raw: &'t [u8]) -> Str {
        if raw.is_empty() {
            return Str::NO;
        }
        if bun_core::strings::index_of_any(raw, b"\\&\0").is_some() {
            return self.tree.owned(|out| unescape(raw, out));
        }
        let start = raw.as_ptr().addr() - self.text.as_ptr().addr();
        Str::source(start as u32, (start + raw.len()) as u32)
    }

    fn add_pending(&mut self, node: NodeId, start: usize, end: usize) {
        self.pending.push(Pending {
            node,
            first_segment: self.segments.len(),
            segment_count: 1,
        });
        self.segments.push(Segment {
            start: start as u32,
            end: end as u32,
            virtual_spaces: 0,
            is_indented: false,
        });
    }

    /// The lines `segments[first..]`, joined by line breaks.
    fn joined_value(&mut self, first: usize) -> Str {
        let segments = self.segments.get(first..).unwrap_or_default();
        let (Some(first_segment), Some(last_segment)) = (segments.first(), segments.last()) else {
            return Str::EMPTY;
        };
        // Nothing has been taken away from the lines: the value is in the text as it is.
        let is_plain = segments.iter().all(|it| it.virtual_spaces == 0)
            && segments.iter().zip(&segments[1..]).all(|(line, next)| line.end + 1 == next.start)
            && !(self.has.nul
                && bun_core::strings::contains_char(&self.text[first_segment.start as usize..last_segment.end as usize], 0));
        if is_plain {
            return Str::source(first_segment.start, last_segment.end);
        }
        let text = self.text;
        self.tree.owned(|out| {
            for (index, segment) in segments.iter().enumerate() {
                if index > 0 {
                    out.push(b'\n');
                }
                out.extend(std::iter::repeat_n(b' ', usize::from(segment.virtual_spaces)));
                for part in bun_core::strings::split(&text[segment.start as usize..segment.end as usize], b"\0").enumerate() {
                    if part.0 > 0 {
                        out.extend_from_slice("\u{FFFD}".as_bytes());
                    }
                    out.extend_from_slice(part.1);
                }
            }
        })
    }

    fn close_fenced(&mut self, has_closing_fence: bool) {
        let Leaf::Fenced {
            node,
            first_segment,
            ..
        } = std::mem::replace(&mut self.leaf, Leaf::None)
        else {
            return;
        };
        // Without a closing fence, the line break at the end is not part of the value.
        if !has_closing_fence
            && self.segments.len() > first_segment
            && self.segments.last().is_some_and(|it| it.start == it.end && it.virtual_spaces == 0)
        {
            self.segments.pop();
        }
        let value = self.joined_value(first_segment);
        self.segments.truncate(first_segment);
        if let Some(node) = self.tree.get_mut(node) {
            node.value = value;
        }
    }

    fn close_leaf(&mut self) {
        match self.leaf {
            Leaf::None => {}
            Leaf::Table { .. } => self.leaf = Leaf::None,
            Leaf::Paragraph { .. } => _ = self.close_paragraph(None),
            Leaf::Fenced { .. } => self.close_fenced(false),
            Leaf::IndentedCode {
                node,
                first_segment,
                certain,
            } => {
                self.segments.truncate(certain);
                // A line break at the end is not part of the value.
                if self.segments.len() > first_segment + 1
                    && self.segments.last().is_some_and(|it| it.start == it.end && it.virtual_spaces == 0)
                {
                    self.segments.pop();
                }
                let value = self.joined_value(first_segment);
                self.segments.truncate(first_segment);
                if let Some(node) = self.tree.get_mut(node) {
                    node.value = value;
                }
                self.leaf = Leaf::None;
            }
            Leaf::Html {
                node,
                first_segment,
                ..
            } => {
                let value = self.joined_value(first_segment);
                self.segments.truncate(first_segment);
                if let Some(node) = self.tree.get_mut(node) {
                    node.value = value;
                }
                self.leaf = Leaf::None;
            }
        }
    }

    /// Closes the paragraph that is open: the definitions at its start, and a paragraph for the rest, or a
    /// heading of `setext_depth` that ends with the current line. Returns whether there is a rest.
    fn close_paragraph(&mut self, setext_depth: Option<u32>) -> bool {
        let Leaf::Paragraph { first_segment } = std::mem::replace(&mut self.leaf, Leaf::None) else {
            return false;
        };
        let mut first = first_segment;
        let content_start = self.segments.get(first).map_or(0, |it| it.start);
        if self.text.get(content_start as usize) == Some(&b'[') {
            let mut content = std::mem::take(&mut self.content);
            content.fill(self.text, &self.segments[first..]);
            let mut position = 0;
            while let Some(definition) = inline::parse_definition(&content.bytes, position) {
                self.add_definition(&content, &definition);
                position = definition.end + 1;
                if position > content.bytes.len() {
                    break;
                }
            }
            first = match position > content.bytes.len() {
                true => self.segments.len(),
                false => first + content.line_of(position),
            };
            self.content = content;
        }
        let (Some(first_line), Some(last_line)) = (self.segments.get(first), self.segments.last()) else {
            self.segments.truncate(first_segment);
            return false;
        };
        let (start, end) = (first_line.start as usize, last_line.end as usize);
        let blanks = self.text[start..end].iter().take_while(|&&byte| is_space(byte)).count();
        let start = start + blanks;
        if let Some(first_line) = self.segments.get_mut(first) {
            first_line.start = start as u32;
        }
        let node = match setext_depth {
            // The heading starts where the definitions do.
            Some(depth) => {
                let node = self.add_block(Kind::Heading, content_start as usize, self.line.end);
                if let Some(node) = self.tree.get_mut(node) {
                    node.number = depth;
                }
                node
            }
            None => self.add_block(Kind::Paragraph, start, end),
        };
        self.pending.push(Pending {
            node,
            first_segment: first,
            segment_count: self.segments.len() - first,
        });
        true
    }

    fn add_definition(&mut self, content: &Content, definition: &inline::Definition) {
        let node = self.add_block(
            Kind::Definition,
            content.source(definition.label.0 - 1) as usize,
            content.source_end(definition.end) as usize,
        );
        let bytes = &content.bytes;
        let raw_label = &bytes[definition.label.0..definition.label.1];
        let normalized = normalize_identifier(raw_label);
        let identifier = self.tree.owned(|out| super::strings::push_lowercase(&normalized, out));
        let label = self.tree.owned(|out| unescape(raw_label, out));
        let url = self.tree.owned(|out| unescape(&bytes[definition.destination.0..definition.destination.1], out));
        let title =
            definition.title.map_or(Str::NO, |title| self.tree.owned(|out| inline::push_title(&bytes[title.0..title.1], out)));
        self.definitions.insert(normalized);
        if let Some(node) = self.tree.get_mut(node) {
            (node.identifier, node.third, node.value, node.second) = (identifier, label, url, title);
        }
    }

    /// Whether the line at `cursor` is the row under the head of a table, which is the last line of the
    /// paragraph that is open. If so, the table is started.
    fn starts_table(&mut self, first_segment: usize, cursor: Cursor) -> bool {
        if self.is_plain || !matches!(self.line.byte(cursor), Some(b'|' | b'-' | b':')) {
            return false;
        }
        let Some(aligns) = parse_delimiter_row(self.line.rest(cursor)) else {
            return false;
        };
        let Some(&head) = self.segments.last().filter(|it| !it.is_indented) else {
            return false;
        };
        let row = &self.text[head.start as usize..head.end as usize];
        let head_start = head.start as usize + (row.len() - row.trim_ascii_start().len());
        let row = row.trim_ascii_start();
        if count_head_cells(row) != Some(aligns.len()) {
            return false;
        }
        self.segments.pop();
        match self.segments.len() > first_segment {
            true => self.close_leaf(),
            false => self.leaf = Leaf::None,
        }
        let node = self.add_block(Kind::Table, head_start, self.line.end);
        let first_align = self.tree.aligns.len() as u32;
        if let Some(node) = self.tree.get_mut(node) {
            (node.first_align, node.number) = (first_align, aligns.len() as u32);
        }
        self.tree.aligns.extend(aligns);
        self.add_row(node, head_start, head.end as usize);
        self.leaf = Leaf::Table { node };
        true
    }

    fn add_row(&mut self, table: NodeId, start: usize, end: usize) {
        let row = self.tree.add(Kind::TableRow, start as u32, end as u32);
        self.tree.append(table, row);
        for cell in split_row(&self.text[start..end]) {
            let node = self.tree.add(Kind::TableCell, (start + cell.start) as u32, (start + cell.end) as u32);
            self.tree.append(row, node);
            if let Some((content_start, content_end)) = cell.content {
                self.add_pending(node, start + content_start, start + content_end);
            }
        }
    }

    /// Parses the text of paragraphs, headings and cells.
    fn parse_pending(&mut self) {
        let mut content = std::mem::take(&mut self.content);
        let max_definition_len = self.definitions.iter().map(Vec::len).max().unwrap_or(0);
        let mut spare_items = Vec::new();
        for pending in std::mem::take(&mut self.pending) {
            let segments = &self.segments[pending.first_segment..pending.first_segment + pending.segment_count];
            content.fill(self.text, segments);
            let mut context = inline::Context {
                text: self.text,
                is_plain: self.is_plain,
                is_mdx: self.is_mdx,
                has: self.has,
                tree: self.tree,
                content: &content,
                definitions: &self.definitions,
                max_definition_len,
                footnotes: &self.footnotes,
                stack_check: self.stack_check,
                is_nested_too_deeply: false,
                spare_items,
            };
            context.parse(pending.node);
            self.is_nested_too_deeply |= context.is_nested_too_deeply;
            spare_items = context.spare_items;
        }
    }
}
