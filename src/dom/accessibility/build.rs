//! From the document to an `abi::Update`.

use core::hash::{Hash, Hasher};
use core::ops::Range;

use smallvec::SmallVec;

use super::aria::{NameFrom, Reader, collapsed, has_text, is_cell, is_range};
use super::changes::Changes;
use super::{Known, Page, Sent};
use crate::abi::accessibility::{
    self as abi, Number, NumberEntry, Placement, Relation, RelationEntry, Role, Run, Text,
    TextEntry,
};
use crate::abi::{Matrix, Rect, Slice, Span};
use crate::boxes::{BoxId, Kind, VIEWPORT};
use crate::document::Document;
use crate::editing::{Mark, Point};
use crate::inline::{Inline, Item, ItemKind};
use crate::lines::{Fragment, FragmentKind};
use crate::name::{FastHasher, Map, Name, is_name, name};
use crate::order::Order as _;
use crate::properties::Style;
use crate::selector::Pseudo;
use crate::tree::{DOCUMENT, Data, Element, Flags, Namespace, NodeId, State};
use crate::types::*;
use crate::values::text;

#[derive(Default)]
pub(super) struct Output {
    removed: Vec<u32>,
    /// Each after its descendants.
    pub(super) nodes: Vec<abi::Node>,
    pub(super) placements: Vec<Placement>,
    announcements: Vec<abi::Announcement>,
    pub(super) children: Vec<u32>,
    pub(super) texts: Vec<TextEntry>,
    pub(super) numbers: Vec<NumberEntry>,
    pub(super) relations: Vec<RelationEntry>,
    pub(super) runs: Vec<Run>,
    pub(super) advances: Vec<f32>,
    misspelled: Vec<[u32; 2]>,
    pub(super) bytes: Vec<u8>,
}

/// The lengths of `texts`, `numbers`, `relations` and `bytes`.
pub(super) type Lengths = [usize; 4];

pub(super) fn span(start: usize, end: usize) -> Span {
    Span {
        start: start as u32,
        end: end as u32,
    }
}

impl Output {
    pub(super) fn is_empty(&self) -> bool {
        self.removed.is_empty()
            && self.nodes.is_empty()
            && self.placements.is_empty()
            && self.announcements.is_empty()
    }

    pub(super) fn push_bytes(&mut self, value: &str) -> Span {
        self.bytes.extend_from_slice(value.as_bytes());
        span(self.bytes.len() - value.len(), self.bytes.len())
    }

    pub(super) fn announce(&mut self, text: &str, is_urgent: bool) {
        let text = self.push_bytes(text);
        self.announcements
            .push(abi::Announcement { text, is_urgent });
    }

    pub(super) fn text(&mut self, key: Text, value: &str) {
        if !value.is_empty() {
            let value = self.push_bytes(value);
            self.texts.push(TextEntry { key, value });
        }
    }

    pub(super) fn number(&mut self, key: Number, value: Option<f64>) {
        self.numbers
            .extend(value.map(|value| NumberEntry { key, value }));
    }

    pub(super) fn lengths(&self) -> Lengths {
        [
            self.texts.len(),
            self.numbers.len(),
            self.relations.len(),
            self.bytes.len(),
        ]
    }

    fn truncate(&mut self, [texts, numbers, relations, bytes]: Lengths) {
        self.texts.truncate(texts);
        self.numbers.truncate(numbers);
        self.relations.truncate(relations);
        self.bytes.truncate(bytes);
    }

    fn hash_since(&self, [texts, numbers, relations, bytes]: Lengths, hasher: &mut FastHasher) {
        self.texts[texts..]
            .iter()
            .for_each(|it| (it.key as u8, it.value.end - it.value.start).hash(hasher));
        self.numbers[numbers..]
            .iter()
            .for_each(|it| (it.key as u8, it.value.to_bits().swap_bytes()).hash(hasher));
        self.relations[relations..]
            .iter()
            .for_each(|it| (it.key as u8, it.node).hash(hasher));
        hasher.write(&self.bytes[bytes..]);
    }

    pub(super) fn node(
        &self,
        id: u32,
        role: Role,
        states: u64,
        [texts, numbers, relations, _]: Lengths,
    ) -> abi::Node {
        abi::Node {
            id,
            role,
            states,
            children: Span::default(),
            texts: span(texts, self.texts.len()),
            numbers: span(numbers, self.numbers.len()),
            relations: span(relations, self.relations.len()),
            runs: Span::default(),
            advances: Span::default(),
            misspelled: Span::default(),
        }
    }

    pub(super) fn as_update(
        &self,
        zoom: f32,
        root: u32,
        focus: u32,
        selection: abi::Selection,
    ) -> abi::Update {
        abi::Update {
            is_first: false,
            is_complete: false,
            zoom,
            root,
            focus,
            selection,
            removed: Slice::new(&self.removed),
            nodes: Slice::new(&self.nodes),
            placements: Slice::new(&self.placements),
            announcements: Slice::new(&self.announcements),
            children: Slice::new(&self.children),
            texts: Slice::new(&self.texts),
            numbers: Slice::new(&self.numbers),
            relations: Slice::new(&self.relations),
            runs: Slice::new(&self.runs),
            advances: Slice::new(&self.advances),
            misspelled: Slice::new(&self.misspelled),
            bytes: Slice::new(&self.bytes),
        }
    }
}

// ───────────────────────────── text ─────────────────────────────

type Items<'a> = SmallVec<[(BoxId, &'a Inline, usize); 1]>;

fn is_leaf_of(item: &Item, id: NodeId) -> bool {
    item.node == id && matches!(item.kind, ItemKind::Text | ItemKind::Break)
}

fn items_of(document: &Document, id: NodeId) -> Items<'_> {
    let mut found = Items::new();
    for (lines, inline) in document.lines_with(id) {
        found.extend(
            inline
                .items
                .iter()
                .enumerate()
                .filter(|it| is_leaf_of(it.1, id))
                .map(|it| (lines, inline, it.0)),
        );
    }
    found
}

fn text_of<'a>((_, inline, index): &(BoxId, &'a Inline, usize)) -> &'a str {
    &inline.text[inline.items[*index].start as usize..inline.items[*index].end as usize]
}

pub(super) fn rendered_text(document: &Document, id: NodeId) -> Option<String> {
    let items = items_of(document, id);
    (!items.is_empty()).then(|| items.iter().map(text_of).collect())
}

fn rendered_offset(items: &Items, offset: u32) -> u32 {
    let mut before = 0;
    for (_, inline, index) in items {
        let item = &inline.items[*index];
        if inline
            .segments_of(item)
            .last()
            .is_none_or(|it| offset <= it.node_end)
        {
            return before + inline.text_offset(item, offset).clamp(item.start, item.end)
                - item.start;
        }
        before += item.end - item.start;
    }
    before
}

pub(super) fn point_in_tree(document: &Document, node: NodeId, mut offset: u32) -> Option<Point> {
    let tree = &document.tree;
    let is_generated = |it| tree.element(it).is_some_and(Element::is_generated);
    if let Some(generated) = [node, tree[node].parent]
        .into_iter()
        .find(|it| is_generated(*it))
    {
        let element = tree.element(generated)?;
        let is_after = element.pseudo == Pseudo::After;
        return Some(Point {
            node: element.originator,
            offset: if is_after {
                0
            } else {
                tree[element.originator].first_child
            },
        });
    }
    let Some(data) = tree[node].text() else {
        tree.element(node)?;
        return Some(
            match document
                .own_box(node)
                .is_none_or(|it| document.boxes[it].is_replaced())
                && tree[node].first_child == 0
            {
                true => Point {
                    node: tree[node].parent,
                    offset: if offset == 0 { node } else { tree[node].next },
                },
                false => Point {
                    node,
                    offset: if offset == 0 {
                        tree[node].first_child
                    } else {
                        0
                    },
                },
            },
        );
    };
    for (_, inline, index) in items_of(document, node) {
        let item = &inline.items[index];
        if offset <= item.end - item.start {
            return Some(Point {
                node,
                offset: inline.node_offset(item, item.start + offset),
            });
        }
        offset -= item.end - item.start;
    }
    Some(Point {
        node,
        offset: data.len() as u32,
    })
}

// ───────────────────────────── the walk ─────────────────────────────

/// A node that others are placed in.
struct Container {
    id: u32,
    /// Where its corner would be if it moved with its contents.
    origin: [f32; 2],
    /// Of its box.
    depth: u16,
}

const IN_VIEWPORT: usize = 0;
const IN_DOCUMENT: usize = 1;

#[derive(Clone, Copy)]
struct Context {
    /// In `Builder::containers`.
    container: usize,
    may_skip: bool,
    field: NodeId,
    /// `EDITABLE`, `RICHLY_EDITABLE`, `DISABLED`, `UNDERLINED` and `STRUCK`.
    inherited: u64,
    is_presentational: bool,
    is_said_elsewhere: bool,
    is_blocked_by_modal: bool,
    /// Of what has no box.
    fallback: Option<Rect>,
    parent_role: Role,
    /// How many lists or items of trees it is in.
    depth: u32,
    selects_by_focus: bool,
    /// In `Builder::layers`.
    layers: Span,
    has_other_layers: bool,
}

#[derive(Clone, Copy, Hash)]
struct Layer {
    /// Twice the `z-index`.
    level: i32,
    node: NodeId,
    is_stacking_context: bool,
}

const HIGHEST_Z_INDEX: i32 = (1 << 19) - 2;

pub(super) struct Builder<'a> {
    reader: Reader<'a>,
    document: &'a Document,
    sent: &'a mut Sent,
    changes: &'a mut Changes,
    page: &'a Page<'a>,
    out: Output,
    /// The children of the nodes that are being visited.
    stack: Vec<u32>,
    is_break_due: bool,
    has_walked: bool,
    /// The boxes are left as they are.
    is_unnoticed: bool,
    containers: Vec<Container>,
    layers: Vec<Layer>,
    /// The depth of the outermost box that the ones that have been visited depend on.
    outermost: u16,
    modal: NodeId,
    around_modal: Vec<NodeId>,
    matrices: Vec<Option<Matrix>>,
    /// The item after the one that was looked for last.
    cursor: (BoxId, usize),
    /// Of the inline elements in long texts. `None` for those that go on after a block.
    inline_rects: Map<BoxId, Map<NodeId, Option<Rect>>>,
    /// The fragments of long lines, in the order of their items.
    long_lines: Map<(BoxId, usize), Vec<&'a Fragment>>,
}

pub(super) fn has_presentational_children(role: Role) -> bool {
    use Role::*;
    matches!(
        role,
        Button
            | Checkbox
            | Image
            | MenuItemCheckbox
            | MenuItemRadio
            | Meter
            | Option
            | ProgressBar
            | Radio
            | Scrollbar
            | Separator
            | Slider
            | Switch
            | Tab
            | DocCover
            | GraphicsSymbol
    )
}

fn passes_pointer(style: &Style) -> u64 {
    if style.ink.pointer_events == PointerEvents::None {
        abi::PASSES_POINTER
    } else {
        0
    }
}

const SUGGESTIONS: Pseudo = Pseudo::Part(name!("-internal-suggestions"));

pub(super) fn is_activatable(role: Role) -> bool {
    use Role::*;
    matches!(
        role,
        Button
            | Link
            | Checkbox
            | Radio
            | Switch
            | Tab
            | Option
            | TreeItem
            | MenuItem
            | MenuItemCheckbox
            | MenuItemRadio
            | DisclosureTriangle
            | Combobox
            | ColorWell
            | Date
            | DateTime
            | InputTime
            | DocBacklink
            | DocBiblioRef
            | DocGlossRef
            | DocNoteRef
    )
}

impl<'a> Builder<'a> {
    pub(super) fn new(
        reader: Reader<'a>,
        sent: &'a mut Sent,
        changes: &'a mut Changes,
        page: &'a Page<'a>,
    ) -> Self {
        let document = reader.document;
        Builder {
            reader,
            document,
            sent,
            changes,
            page,
            out: Output::default(),
            stack: Vec::new(),
            is_break_due: false,
            has_walked: false,
            is_unnoticed: false,
            containers: Vec::new(),
            layers: Vec::new(),
            outermost: u16::MAX,
            modal: 0,
            around_modal: Vec::new(),
            matrices: Vec::new(),
            cursor: (0, 0),
            inline_rects: Map::default(),
            long_lines: Map::default(),
        }
    }

    fn find_modal(&self) -> NodeId {
        let blocks = |it: &&NodeId| {
            self.reader
                .element(**it)
                .is_some_and(|it| it.state.intersects(State::MODAL | State::FULLSCREEN))
        };
        let says_so = |it: &NodeId| {
            self.reader.aria_is(*it, name!("aria-modal"), "true")
                && matches!(self.reader.role(*it), Role::Dialog | Role::AlertDialog)
        };
        // VoiceOver leaves it to the application to hide what is behind `aria-modal`.
        let by_aria = || {
            core::iter::once(self.page.focused)
                .chain(self.reader.ancestors(self.page.focused))
                .find(says_so)
        };
        let by_aria = if cfg!(target_os = "macos") {
            by_aria()
        } else {
            None
        };
        by_aria
            .or_else(|| self.document.top_layer.iter().rfind(blocks).copied())
            .unwrap_or(0)
    }

    pub(super) fn walk_unnoticed(&mut self) {
        self.is_unnoticed = true;
        self.walk(true);
    }

    pub(super) fn walk(&mut self, has_lost_track: bool) {
        self.has_walked = true;
        self.sent.update += 1;
        self.modal = self.find_modal();
        self.around_modal = self.reader.ancestors(self.modal).collect();
        let may_skip = self.changes.tell_boxes(
            &self.reader,
            self.sent,
            self.page,
            self.modal,
            has_lost_track,
        );
        self.reader.sources.borrow_mut().clear();
        let (id, [width, height]) = (
            self.sent.id_for(DOCUMENT),
            self.document.environment.viewport,
        );
        let scroll = self.document.scroll_offset(DOCUMENT);
        let (rect, origin) = (Rect::new([0.0, 0.0, width, height]), scroll.map(|it| -it));
        self.containers = vec![
            Container {
                id: 0,
                origin: [0.0; 2],
                depth: 0,
            },
            Container {
                id,
                origin,
                depth: 0,
            },
        ];
        let outside = Context {
            container: IN_VIEWPORT,
            may_skip,
            field: 0,
            inherited: 0,
            is_presentational: false,
            is_said_elsewhere: false,
            is_blocked_by_modal: self.modal != 0,
            fallback: None,
            parent_role: Role::WebArea,
            depth: 0,
            selects_by_focus: false,
            layers: Span::default(),
            has_other_layers: false,
        };
        for child in self.document.tree.element_children(DOCUMENT) {
            self.visit(
                child,
                &Context {
                    container: IN_DOCUMENT,
                    ..outside
                },
            );
        }
        let lengths = self.out.lengths();
        self.out.text(Text::Name, &self.document.title());
        self.out.text(Text::Url, self.page.url);
        let root = self.document.tree.root_element();
        self.out.text(
            Text::Language,
            self.reader
                .attribute(root, name!("lang"))
                .unwrap_or_default(),
        );
        let states = abi::FOCUSABLE
            | abi::SCROLLS
            | abi::CLIPS
            | abi::IMPLICIT_ROLE
            | if self.page.is_loading {
                abi::LOADING
            } else {
                0
            };
        self.commit(DOCUMENT, Role::WebArea, states, lengths, 0);
        self.place(DOCUMENT, rect, scroll, &outside);
        self.stack.clear();
        let sent = &mut *self.sent;
        while let Some(id) = sent.orphans.pop() {
            let node = sent.nodes.get(&id).filter(|it| {
                sent.known
                    .get(*it)
                    .is_some_and(|it| it.update != sent.update)
            });
            if let Some(gone) = node.and_then(|it| sent.known.remove(it)) {
                self.out.removed.push(id);
                sent.orphans.extend(gone.children);
            }
        }
    }

    pub(super) fn finish(mut self) -> Output {
        let known = |it| self.sent.known.get(&it).map(|it: &Known| it.id);
        let around = core::iter::once(self.page.focused)
            .chain(self.document.tree.flat_ancestors(self.page.focused));
        if self.has_walked {
            self.out.removed.append(&mut self.sent.freed);
            (self.sent.focus, self.sent.focused) = (
                around.chain([DOCUMENT]).find_map(known).unwrap_or(0),
                self.page.focused,
            );
        }
        let [start, end] = self
            .document
            .marks
            .selection
            .map_or_else(Default::default, |it| {
                it.map(|it| self.accessible_point(it))
            });
        let [anchor, focus] = if self.page.selects_backwards {
            [end, start]
        } else {
            [start, end]
        };
        self.sent.selection = abi::Selection {
            anchor,
            focus,
            is_upstream: self.document.marks.caret == Some(true),
        };
        self.out
    }

    fn accessible_point(&self, point: Point) -> abi::Point {
        let (tree, known) = (&self.document.tree, &self.sent.known);
        if !tree.contains(point.node) {
            return abi::Point::default();
        }
        let is_text = tree[point.node].text().is_some();
        if let Some(it) = known.get(&point.node).filter(|_| is_text) {
            return abi::Point {
                node: it.id,
                offset: rendered_offset(&items_of(self.document, point.node), point.offset),
            };
        }
        let (parent, after) = if is_text {
            (tree[point.node].parent, point.node)
        } else {
            (point.node, point.offset)
        };
        let is_leaf = |it: &NodeId| known.contains_key(it) && tree[*it].first_child == 0;
        let (mut is_past, mut before) = (false, None);
        for it in tree.descendants(parent) {
            is_past |= it == after;
            match (is_leaf(&it), is_past) {
                (true, true) => {
                    return abi::Point {
                        node: known[&it].id,
                        offset: 0,
                    };
                }
                (true, false) => before = Some(it),
                _ => {}
            }
        }
        if let Some(it) = before {
            let is_last_break = tree.html_tag(it) == name!("br");
            let length = || rendered_text(self.document, it).map_or(1, |it| it.len() as u32);
            return abi::Point {
                node: known[&it].id,
                offset: if is_last_break { 0 } else { length() },
            };
        }
        let around = core::iter::once(parent)
            .chain(tree.flat_ancestors(parent))
            .find_map(|it| known.get(&it));
        abi::Point {
            node: around.map_or(0, |it| it.id),
            offset: 0,
        }
    }

    // ───────────────────────────── places ─────────────────────────────

    fn to_viewport(&mut self, id: BoxId) -> Matrix {
        if id == VIEWPORT || id == 0 {
            return IDENTITY;
        }
        if let Some(Some(known)) = self.matrices.get(id as usize) {
            return *known;
        }
        let matrix = match bun_core::StackCheck::init().is_safe_to_recurse() {
            true => multiply(
                &self.to_viewport(self.document.boxes[id].container),
                &self.document.to_container(id),
            ),
            false => self.document.to_viewport(id),
        };
        if self.matrices.len() <= id as usize {
            self.matrices.resize(id as usize + 256, None);
        }
        self.matrices[id as usize] = Some(matrix);
        matrix
    }

    fn map(&mut self, id: BoxId, rect: Rect) -> Rect {
        match self.document.has_depth.get() || !self.document.boxes.pieces.is_empty() {
            true => self.document.map_to_viewport(id, rect),
            false => rect.transformed(&self.to_viewport(id)),
        }
    }

    fn nowhere(&self, context: &Context) -> Rect {
        Rect::default().moved(self.containers[context.container].origin)
    }

    fn rect_in_long_text(&mut self, id: NodeId, context: &Context) -> Option<Rect> {
        let (document, lines) = (self.document, self.document.tree[id].layout_box);
        let inline = document.boxes[lines]
            .inline
            .as_deref()
            .filter(|it| it.items.len() > 64 && document.tree.html_tag(id) != Name::NONE)?;
        let rects =
            self.inline_rects.entry(lines).or_insert_with(|| {
                let mut all: Map<_, _> = inline
                    .items
                    .iter()
                    .filter(|it| it.kind == ItemKind::Close(false))
                    .map(|it| (it.node, None))
                    .collect();
                for it in inline.lines.fragments.iter().filter(|it| {
                    !matches!(it.kind, FragmentKind::Text { .. } | FragmentKind::Hyphen)
                }) {
                    let rect = document.from_lines(lines, it.rect());
                    if let Some(whole) = all
                        .entry(inline.items[it.item as usize].node)
                        .or_insert(Some(rect))
                        && !rect.is_empty()
                    {
                        *whole = if whole.is_empty() {
                            rect
                        } else {
                            whole.union(&rect)
                        };
                    }
                }
                all
            });
        match rects.get(&id).copied() {
            Some(rect) => Some(self.map(lines, rect?)),
            None => Some(self.nowhere(context)),
        }
    }

    fn rect_of(&mut self, id: NodeId, context: &Context) -> Rect {
        match self
            .document
            .own_box(id)
            .filter(|_| self.document.boxes.pieces.is_empty())
        {
            Some(own) if is_name!(self.reader.tag(id), "iframe" | "frame" | "embed" | "object") => {
                self.map(own, Rect::new(self.document.content_box(own)))
            }
            Some(own) => self.map(own, self.document.border_box(own)),
            None if let Some(rect) = self.rect_in_long_text(id, context) => rect,
            None => {
                let rects = self
                    .document
                    .local_rects(id)
                    .into_iter()
                    .map(|it| self.map(it.0, it.1))
                    .collect::<SmallVec<[_; 2]>>();
                let non_empty = rects
                    .iter()
                    .filter(|it| !it.is_empty())
                    .copied()
                    .reduce(|a, b| a.union(&b));
                non_empty
                    .or_else(|| rects.first().copied())
                    .unwrap_or_else(|| self.nowhere(context))
            }
        }
    }

    fn place(&mut self, node: NodeId, rect: Rect, scroll: [f32; 2], context: &Context) {
        let (Some(known), container) = (
            self.sent.known.get_mut(&node),
            &self.containers[context.container],
        ) else {
            return;
        };
        let rect = Rect::new(
            rect.moved(container.origin.map(|it| -it))
                .to_array()
                .map(|it| (it * 16.0).round() / 16.0),
        );
        let placement = Placement {
            id: known.id,
            container: container.id,
            rect,
            scroll,
        };
        if known.placement != placement {
            known.placement = placement;
            self.out.placements.push(placement);
        }
    }

    /// Whether the library has to be told. The children are on the stack from `first_child`.
    fn note(&mut self, node: NodeId, role: Role, hash: u64, first_child: usize) -> (u32, bool) {
        let (id, update, children) = (
            self.sent.id_for(node),
            self.sent.update,
            &self.stack[first_child..],
        );
        let Some(known) = self.sent.known.get_mut(&node) else {
            let (placement, children) = (Placement::default(), children.into());
            self.sent.known.insert(
                node,
                Known {
                    id,
                    hash,
                    placement,
                    update,
                    role,
                    children,
                    valid_for: None,
                    ends_paragraph: false,
                },
            );
            return (id, true);
        };
        if *known.children != *children {
            self.sent
                .orphans
                .extend(core::mem::replace(&mut known.children, children.into()));
        }
        (known.update, known.role, known.valid_for) = (update, role, None);
        (id, core::mem::replace(&mut known.hash, hash) != hash)
    }

    /// With the children on the stack from `first_child`, which it replaces.
    fn commit(
        &mut self,
        node: NodeId,
        role: Role,
        states: u64,
        lengths: Lengths,
        first_child: usize,
    ) {
        let mut hasher = FastHasher::default();
        (role as u8, states).hash(&mut hasher);
        self.stack[first_child..]
            .iter()
            .for_each(|it| it.hash(&mut hasher));
        self.out.hash_since(lengths, &mut hasher);
        let (id, is_news) = self.note(node, role, hasher.finish(), first_child);
        if is_news {
            let start = self.out.children.len();
            self.out
                .children
                .extend_from_slice(&self.stack[first_child..]);
            let children = span(start, self.out.children.len());
            self.out.nodes.push(abi::Node {
                children,
                ..self.out.node(id, role, states, lengths)
            });
        } else {
            self.out.truncate(lengths);
        }
        self.stack.truncate(first_child);
        self.stack.push(id);
    }

    fn take_break(&mut self) -> u64 {
        if core::mem::take(&mut self.is_break_due) {
            abi::STARTS_PARAGRAPH
        } else {
            0
        }
    }

    // ───────────────────────────── leaves ─────────────────────────────

    fn find_items(&mut self, id: NodeId) -> Items<'a> {
        let (document, lines) = (self.document, self.document.tree[id].layout_box);
        let Some(inline) = document.boxes[lines].inline.as_deref() else {
            return Items::new();
        };
        let from = if self.cursor.0 == lines {
            self.cursor.1
        } else {
            0
        };
        let Some(first) = (from..inline.items.len())
            .chain(0..from)
            .find(|it| is_leaf_of(&inline.items[*it], id))
        else {
            return Items::new();
        };
        let items: Items = (first..inline.items.len())
            .take_while(|it| is_leaf_of(&inline.items[*it], id))
            .map(|it| (lines, inline, it))
            .collect();
        self.cursor = (lines, first + items.len());
        items
    }

    fn fragments_for(
        &mut self,
        items: Range<usize>,
        lines: BoxId,
        line: usize,
        all: &'a [Fragment],
    ) -> SmallVec<[&'a Fragment; 2]> {
        if all.len() <= 64 {
            return all
                .iter()
                .filter(|it| items.contains(&(it.item as usize)))
                .collect();
        }
        let sorted = self.long_lines.entry((lines, line)).or_insert_with(|| {
            let mut sorted: Vec<_> = all.iter().collect();
            sorted.order_by_key(|it| it.item);
            sorted
        });
        let [start, end] = [items.start, items.end]
            .map(|edge| sorted.partition_point(|it| (it.item as usize) < edge));
        sorted[start..end].into()
    }

    fn separates_text(inline: &Inline, index: usize) -> bool {
        let is_content = |it: &&Item| {
            !matches!(
                it.kind,
                ItemKind::Open(_) | ItemKind::Close(_) | ItemKind::Control
            ) && it.start != it.end
        };
        let (before, after) = (
            inline.items[..index].iter().rfind(is_content),
            inline.items[index + 1..].iter().find(is_content),
        );
        [before, after]
            .iter()
            .all(|it| it.is_some_and(|it| it.kind == ItemKind::Text))
    }

    fn describe_text(&mut self, style: &Style) -> u64 {
        let family = bun_core::strings::split(&style.font.family.0, b"\0")
            .next()
            .unwrap_or_default();
        self.out.text(
            Text::FontFamily,
            text(
                family
                    .strip_prefix(&[crate::abi::GENERIC_FAMILY])
                    .unwrap_or(family),
            ),
        );
        self.out
            .number(Number::FontSize, Some(style.font.size.0.into()));
        self.out.number(Number::Color, Some(style.color().into()));
        (if style.font.weight.0 >= 600.0 {
            abi::BOLD
        } else {
            0
        }) | if style.font.style == FontStyle::Normal {
            0
        } else {
            abi::ITALIC
        }
    }

    fn unboxed_text(&mut self, id: NodeId, role: Role, name: &str, rect: Rect, context: &Context) {
        if !name.is_empty() {
            let (lengths, states) = (
                self.out.lengths(),
                context.inherited & !abi::DISABLED | self.take_break(),
            );
            self.out.text(Text::Name, name);
            self.describe_layers(context);
            self.commit(id, role, states, lengths, self.stack.len());
            self.place(id, rect, [0.0; 2], context);
        }
    }

    fn text(&mut self, id: NodeId, role: Role, style: &Style, context: &Context) {
        let items = self.find_items(id);
        let Some(&(lines, inline, first)) = items.first() else {
            if let (Some(rect), Some(data)) = (context.fallback, self.document.tree[id].text()) {
                self.unboxed_text(id, role, &collapsed(text(data)), rect, context);
            }
            return;
        };
        let range =
            inline.items[first].start as usize..inline.items[first + items.len() - 1].end as usize;
        let name = &inline.text[range.clone()];
        let matters = || {
            context.inherited & abi::EDITABLE != 0
                || style.text.collapse.preserves_spaces()
                || Self::separates_text(inline, first)
        };
        if name.is_empty() || role == Role::StaticText && !has_text(name) && !matters() {
            return;
        }
        let clusters =
            inline.items[first].clusters.start..inline.items[first + items.len() - 1].clusters.end;
        let all = &inline.lines.lines;
        let first_line = all.partition_point(|it| it.clusters.end <= clusters.start);
        let mut pieces = SmallVec::<[_; 4]>::new();
        for (index, line) in all
            .iter()
            .enumerate()
            .skip(first_line)
            .take_while(|it| it.1.clusters.start < clusters.end)
        {
            let start = pieces.len();
            pieces.extend(
                self.fragments_for(
                    first..first + items.len(),
                    lines,
                    index,
                    inline.lines.fragments_of(line),
                )
                .into_iter()
                .filter_map(|it| match &it.kind {
                    FragmentKind::Text { clusters, rtl, .. } => {
                        Some((it.rect(), Some(it), clusters.start, *rtl, false))
                    }
                    _ => None,
                }),
            );
            if pieces.len() == start {
                let x = inline
                    .lines
                    .fragments_of(line)
                    .last()
                    .map_or(line.left, |it| it.x + it.width);
                pieces.push((
                    Rect::new([x, line.y, 0.0, line.height]),
                    None,
                    line.clusters.start.max(clusters.start),
                    line.rtl,
                    false,
                ));
            }
            pieces[start..].order_by_key(|it| it.2);
            let wraps = index > 0
                && line.clusters.start >= clusters.start
                && !inline.is_newline(line.clusters.start.max(1) - 1);
            pieces[start].4 = wraps;
            pieces[start].2 = line.clusters.start.max(clusters.start);
        }
        let rects: SmallVec<[Rect; 4]> = pieces
            .iter()
            .map(|it| self.map(lines, self.document.from_lines(lines, it.0)))
            .collect();
        let whole = rects
            .iter()
            .copied()
            .reduce(|a, b| a.union(&b))
            .unwrap_or_else(|| self.nowhere(context));
        let is_misspelled = |it: &&(_, Mark)| it.1 == Mark::Highlight(name!("::spelling-error"));
        let misspelled: SmallVec<[[u32; 2]; 1]> = self
            .document
            .marks_of(id)
            .filter(is_misspelled)
            .map(|it| [it.0.start, it.0.end].map(|it| rendered_offset(&items, it)))
            .collect();

        let lengths = self.out.lengths();
        self.out.text(Text::Name, name);
        let states = context.inherited & !abi::DISABLED
            | self.take_break()
            | self.describe_text(style)
            | passes_pointer(style);
        self.describe_layers(context);
        let mut hasher = FastHasher::default();
        (role as u8, states).hash(&mut hasher);
        self.out.hash_since(lengths, &mut hasher);
        misspelled
            .iter()
            .for_each(|it| (it[0], it[1]).hash(&mut hasher));
        let relative = |it: &Rect| {
            it.moved([-whole.x, -whole.y])
                .to_array()
                .map(|it| (it * 4.0).round() / 4.0)
        };
        for (piece, rect) in pieces.iter().zip(&rects) {
            (piece.2 - clusters.start, piece.4).hash(&mut hasher);
            relative(rect)
                .iter()
                .for_each(|it| it.to_bits().hash(&mut hasher));
        }
        let (own, is_news) = self.note(id, role, hasher.finish(), self.stack.len());
        self.stack.push(own);
        self.place(id, whole, [0.0; 2], context);
        if !is_news {
            return self.out.truncate(lengths);
        }

        let out = &mut self.out;
        let starts = [out.runs.len(), out.advances.len(), out.misspelled.len()];
        let is_vertical = self.document.boxes[lines].mode.is_vertical();
        let offset = |cluster: u32| {
            inline
                .clusters
                .get(cluster as usize)
                .map_or(inline.text.len(), |it| it.start as usize)
                .clamp(range.start, range.end)
        };
        for (index, (piece, rect)) in pieces.iter().zip(&rects).enumerate() {
            let start = (offset(piece.2) - range.start) as u32;
            out.runs.push(Run {
                start,
                rect: Rect::new(relative(rect)),
                is_rtl: piece.3,
                is_vertical,
                starts_line: piece.4,
            });
            let along = if is_vertical { rect.height } else { rect.width };
            let scale = if piece.0.width > 0.0 {
                along / piece.0.width
            } else {
                1.0
            };
            let shown = piece.1.and_then(|it| match &it.kind {
                FragmentKind::Text { clusters, .. } => Some(clusters.clone()),
                _ => None,
            });
            for cluster in piece.2..pieces.get(index + 1).map_or(clusters.end, |it| it.2) {
                let is_shown = shown.as_ref().is_some_and(|it| it.contains(&cluster));
                let advance = if is_shown {
                    inline.advance(piece.1.map_or(&[], core::slice::from_ref), cluster) * scale
                } else {
                    0.0
                };
                let characters = inline.text[offset(cluster)..offset(cluster + 1)]
                    .chars()
                    .count();
                out.advances
                    .extend((0..characters).map(|it| if it == 0 { advance } else { 0.0 }));
            }
        }
        out.misspelled.extend(misspelled);
        out.nodes.push(abi::Node {
            runs: span(starts[0], out.runs.len()),
            advances: span(starts[1], out.advances.len()),
            misspelled: span(starts[2], out.misspelled.len()),
            ..out.node(own, role, states, lengths)
        });
    }

    // ───────────────────────────── elements ─────────────────────────────

    fn visit_children(&mut self, id: NodeId, style: &Style, context: &Context) {
        if self.reader.hides_contents(id) || !bun_core::StackCheck::init().is_safe_to_recurse() {
            return;
        }
        let shows_text = style.is_visible()
            && !context.is_said_elsewhere
            && !context.is_blocked_by_modal
            && style.ink.interactivity == Interactivity::Auto;
        for child in self.reader.children(id) {
            match &self.document.tree[child].data {
                Data::Text(_) if shows_text => self.text(child, Role::StaticText, style, context),
                Data::Element(it) if it.pseudo == SUGGESTIONS => {}
                Data::Element(it) => {
                    self.visit(child, context);
                    // A text field has no children.
                    let last = (it.html_tag() == name!("input"))
                        .then(|| self.document.rendered_children(child).last())
                        .flatten();
                    last.filter(|it| {
                        self.reader
                            .element(*it)
                            .is_some_and(|it| it.pseudo == SUGGESTIONS)
                    })
                    .into_iter()
                    .for_each(|it| self.visit(it, context));
                }
                _ => {}
            }
        }
    }

    fn has_own_lines(&self, id: NodeId) -> bool {
        let boxes = &self.document.boxes;
        self.document
            .own_box(id)
            .is_some_and(|it| match boxes[it].children[..] {
                [only] => {
                    boxes[only].kind == Kind::Lines
                        && boxes[only]
                            .inline
                            .as_ref()
                            .is_some_and(|it| it.items.iter().any(|it| it.kind == ItemKind::Text))
                }
                _ => false,
            })
    }

    fn has_accessible_graphics(&self, svg: NodeId) -> bool {
        let is_text = |it| {
            self.reader
                .element(it)
                .is_some_and(|it| is_name!(it.tag, "text" | "foreignObject"))
        };
        self.document.tree.descendants(svg).any(|it| {
            is_text(it)
                || self.reader.element(it).is_some()
                    && !matches!(self.reader.role(it), Role::None | Role::Generic)
        })
    }

    fn is_worth_it(
        &self,
        id: NodeId,
        element: &Element,
        role: Role,
        states: u64,
        context: &Context,
    ) -> bool {
        let reader = &self.reader;
        if states & (abi::FOCUSABLE | abi::SCROLLS) != 0 {
            return true;
        }
        if context.is_presentational {
            return false;
        }
        let is_only_styled = || {
            element.html_tag() == name!("span")
                && element
                    .style
                    .as_ref()
                    .is_some_and(|it| !it.display().is_inline_level())
        };
        match role {
            Role::None => false,
            Role::Generic if element.namespace == Namespace::MathMl => {
                element.tag != name!("mspace")
            }
            Role::Generic => {
                states & abi::CLICKABLE != 0
                    || element.pseudo == Pseudo::Part(name!("-webkit-datetime-edit-fields-wrapper"))
                    || reader.has_global_state(id)
                    || element
                        .attributes
                        .iter()
                        .any(|it| is_name!(it.name, "title" | "lang") && has_text(&it.value))
                        && !self.document.tree.is_root(id)
                    || element.id != Name::NONE
                        && is_name!(element.html_tag(), "a" | "div" | "span")
                        && self.document.tree[id].scope == DOCUMENT
                    || context.inherited & abi::EDITABLE != 0
                        && self.document.own_box(id).is_some()
                        && element.pseudo == Pseudo::None
                    || context.field == 0
                        && !matches!(element.pseudo, Pseudo::Part(_))
                        && !is_only_styled()
                        && self.has_own_lines(id)
                        && !self.document.tree.is_root(id)
            }
            Role::RowGroup => element.has(name!("role")) || reader.has_global_state(id),
            _ => true,
        }
    }

    /// Whether all that a label has to say is the name of a check box.
    fn is_redundant_label(&self, id: NodeId) -> bool {
        let reader = &self.reader;
        let is_toggle = |it: &Element| {
            it.html_tag() == name!("input")
                && is_name!(it.input_type(), "checkbox" | "radio")
                && it
                    .style
                    .as_ref()
                    .is_some_and(|it| it.is_visible() && it.display() != Display::None)
        };
        let is_named_here = |it| {
            reader.aria_text(it, name!("aria-label")).is_none() && reader.labelled_by(it).is_empty()
        };
        let control = reader
            .labelled_control(id)
            .filter(|it| reader.element(*it).is_some_and(is_toggle) && is_named_here(*it));
        control.is_some_and(|control| {
            reader
                .children(id)
                .into_iter()
                .all(|it| it == control || reader.element(it).is_none())
        }) && !reader.has_global_state(id)
    }

    fn hash_surroundings(&mut self, own: BoxId, context: &Context) -> u64 {
        let mut hasher = FastHasher::default();
        let Context {
            container: _,
            may_skip: _,
            field,
            inherited,
            is_presentational,
            is_said_elsewhere,
            is_blocked_by_modal,
            fallback,
            parent_role,
            depth,
            selects_by_focus,
            layers,
            has_other_layers,
        } = *context;
        let flags = [
            is_presentational,
            is_said_elsewhere,
            is_blocked_by_modal,
            self.is_break_due,
            selects_by_focus,
            has_other_layers,
        ];
        (
            field,
            inherited,
            parent_role as u8,
            depth,
            flags,
            &self.layers[layers.range()],
        )
            .hash(&mut hasher);
        let size = fallback.map_or([-1.0; 2], |it| [it.width, it.height]);
        self.to_viewport(own)[..4]
            .iter()
            .chain(&size)
            .for_each(|it| it.to_bits().hash(&mut hasher));
        hasher.finish()
    }

    fn layer_of(&self, node: NodeId) -> Option<Layer> {
        let (document, style) = (self.document, self.document.tree.style(node)?);
        let z_index = match document.own_box(node) {
            _ if document.tree[node].has(Flags::TOP_LAYER) => Some(i32::MAX),
            _ if document.tree.is_root(node) || style.display() == Display::Contents => {
                return None;
            }
            Some(own) => document.stack_level(own),
            None => style.is_stacking_context(style.is_positioned()).then(|| {
                style
                    .paint
                    .z_index
                    .0
                    .filter(|_| style.is_positioned())
                    .unwrap_or(0)
            }),
        };
        let level = z_index.map_or(0, |it| {
            it.clamp(
                -HIGHEST_Z_INDEX,
                HIGHEST_Z_INDEX + i32::from(it == i32::MAX),
            ) * 2
        });
        (z_index.is_some() || style.is_positioned()).then_some(Layer {
            level,
            node,
            is_stacking_context: z_index.is_some(),
        })
    }

    /// `around` is at the end of `layers`.
    fn enter(&mut self, layer: Layer, around: Span) -> Span {
        let (mut kept, end) = (around.range(), self.layers.len());
        if layer.level > HIGHEST_Z_INDEX * 2 {
            kept = end..end;
        } else if self.layers[kept.clone()]
            .last()
            .is_some_and(|it| !it.is_stacking_context)
        {
            self.layers.extend_from_within(kept.start..kept.end - 1);
            kept.start = end;
        }
        self.layers.push(layer);
        span(kept.start, self.layers.len())
    }

    fn find_layers(&mut self, id: NodeId, context: &mut Context) {
        let (around, is_owned) = (context.layers, self.reader.is_owned(id));
        if is_owned {
            let outer: SmallVec<[_; 8]> = self
                .document
                .tree
                .flat_ancestors(id)
                .filter_map(|it| self.layer_of(it))
                .collect();
            let none = span(self.layers.len(), self.layers.len());
            (context.layers, context.has_other_layers) = (
                outer
                    .into_iter()
                    .rev()
                    .fold(none, |around, it| self.enter(it, around)),
                true,
            );
        }
        if let Some(own) = self.layer_of(id) {
            (context.layers, context.has_other_layers) = (self.enter(own, context.layers), true);
        }
        if is_owned {
            // The order of the tree does not tell that it is painted later, which is why it is elsewhere.
            let shared = around
                .range()
                .zip(context.layers.range())
                .take_while(|it| self.layers[it.0].node == self.layers[it.1].node)
                .count();
            self.layers[context.layers.range()]
                .iter_mut()
                .skip(shared)
                .take(1)
                .for_each(|it| it.level += 1);
        }
    }

    fn describe_layers(&mut self, context: &Context) {
        if context.has_other_layers {
            let values = self.layers[context.layers.range()]
                .iter()
                .map(|it| f64::from(it.level) * abi::LAYER_LEVEL + f64::from(it.node));
            self.out.numbers.extend(
                core::iter::once(0.0)
                    .chain(values)
                    .map(|value| NumberEntry {
                        key: Number::Layer,
                        value,
                    }),
            );
        }
    }

    /// Unless the author says what is selected.
    fn selects_by_focus(&self, container: NodeId) -> bool {
        let reader = &self.reader;
        let mut pending = reader.children(container).to_vec();
        while let Some(id) = pending.pop() {
            let says = |name| reader.aria_bool(id, name).is_some();
            if reader.element(id).is_some() {
                let other = if reader.aria_is(id, name!("role"), "tab") {
                    name!("aria-expanded")
                } else {
                    name!("aria-checked")
                };
                if says(name!("aria-selected")) || says(other) {
                    return false;
                }
                pending.extend(reader.children(id));
            }
        }
        !reader.aria_is(container, name!("aria-multiselectable"), "true")
    }

    /// For what is not laid out by its parent.
    fn find_container(&mut self, id: NodeId, own: BoxId, context: &mut Context) {
        let (boxes, it) = (&self.document.boxes, &self.document.boxes[own]);
        let is_on_top = self.document.tree[id].has(Flags::TOP_LAYER);
        if it.container != it.parent || is_on_top || self.reader.is_owned(id) {
            let depth = if self.reader.is_owned(id) {
                0
            } else {
                boxes[it.container].depth
            };
            self.outermost = self.outermost.min(depth);
            context.container = match self.document.is_fixed_to_viewport(own) {
                true => IN_VIEWPORT,
                false => self.containers[..=context.container]
                    .iter()
                    .rposition(|it| it.depth <= depth)
                    .unwrap_or(0)
                    .max(IN_DOCUMENT),
            };
        }
    }

    fn visit(&mut self, id: NodeId, outer: &Context) {
        let document = self.document;
        let Some(own) = document.own_box(id) else {
            return self.visit_changed(id, outer);
        };
        let (mut context, painted) = (*outer, &document.boxes[own].painted);
        self.find_container(id, own, &mut context);
        let (surroundings, outermost) = (
            self.hash_surroundings(own, &context),
            core::mem::replace(&mut self.outermost, u16::MAX),
        );
        let known = self.sent.known.get_mut(&id).filter(|it| {
            context.may_skip && painted.is_described() && it.valid_for == Some(surroundings)
        });
        if let Some(known) = known {
            known.update = self.sent.update;
            self.stack.push(known.id);
            self.is_break_due = known.ends_paragraph;
            let (scroll, rect) = (known.placement.scroll, self.rect_of(id, &context));
            self.place(
                id,
                context.fallback.filter(|_| rect.is_empty()).unwrap_or(rect),
                scroll,
                &context,
            );
        } else {
            self.visit_changed(id, &context);
            let is_by_itself = self.outermost >= document.boxes[own].depth
                && !is_name!(document.tree.html_tag(id), "th" | "summary")
                && !self.reader.is_owned(id);
            if let Some(known) = self.sent.known.get_mut(&id).filter(|_| is_by_itself) {
                (known.valid_for, known.ends_paragraph) = (Some(surroundings), self.is_break_due);
            }
            if !self.is_unnoticed {
                painted.set_described(true);
            }
        }
        self.outermost = self.outermost.min(outermost);
    }

    fn visit_changed(&mut self, id: NodeId, outer: &Context) {
        let (document, reader) = (self.document, &self.reader);
        let Some((element, style)) = reader
            .element(id)
            .and_then(|it| Some((it, &**it.style.as_ref()?)))
        else {
            return;
        };
        let (display, tag) = (style.display(), element.html_tag());
        let has_place = document.tree[id].layout_box != 0
            || display == Display::Contents
            || outer.fallback.is_some();
        if display == Display::None || !has_place && !reader.counts_without_box(id) {
            return;
        }
        let mut context = Context {
            is_blocked_by_modal: outer.is_blocked_by_modal && id != self.modal,
            ..*outer
        };
        if context.is_blocked_by_modal && !self.around_modal.contains(&id) {
            return;
        }
        let has_focus = || {
            id == self.page.focused
                || document
                    .tree
                    .flat_ancestors(self.page.focused)
                    .any(|it| it == id)
        };
        if reader.is_aria_hidden(id) && !has_focus()
            || is_name!(
                element.tag,
                "title" | "desc" | "defs" | "style" | "script" | "rp"
            )
        {
            return;
        }
        if let Pseudo::Part(part) = element.pseudo
            && is_name!(
                part,
                "placeholder"
                    | "-webkit-search-cancel-button"
                    | "-webkit-inner-spin-button"
                    | "-internal-select-button"
                    | "-webkit-color-swatch-wrapper"
            )
        {
            return;
        }
        let is_anchored = document
            .own_box(id)
            .is_some_and(|it| document.boxes[it].anchored.is_some());
        if style.layout.position == PositionKind::Sticky || is_anchored || reader.shows_others(id) {
            self.outermost = 0;
        }
        if style.scrolls() {
            self.changes.is_scrolled(id, element.scroll);
        }
        let layers = self.layers.len();
        self.find_layers(id, &mut context);
        let reader = &self.reader;
        let is_block = !display.is_inline_level()
            && display != Display::Contents
            && element.pseudo != Pseudo::Marker;
        self.is_break_due |= is_block;
        let decoration = style.paint.decoration_line;
        context.inherited |= if decoration.contains(DecorationLine::UNDERLINE) {
            abi::UNDERLINED
        } else {
            0
        };
        context.inherited |= if decoration.contains(DecorationLine::LINE_THROUGH) {
            abi::STRUCK
        } else {
            0
        };
        if !style.is_visible()
            || context.is_blocked_by_modal
            || style.ink.interactivity != Interactivity::Auto
        {
            self.visit_children(id, style, &context);
        } else if tag == name!("br") {
            self.text(id, Role::LineBreak, style, &context);
        } else if element.pseudo == Pseudo::Marker || reader.alternative_text(id).is_some() {
            let name = reader
                .alternative_text(id)
                .map_or_else(|| reader.marker_text(id), str::to_owned);
            let (role, rect) = (
                if element.pseudo == Pseudo::Marker {
                    Role::ListMarker
                } else {
                    Role::StaticText
                },
                self.rect_of(id, &context),
            );
            if role == Role::StaticText || matches!(outer.parent_role, Role::ListItem) {
                self.unboxed_text(id, role, &name, rect, &context);
            }
        } else {
            self.visit_shown(id, element, style, context);
        }
        self.layers.truncate(layers);
        self.note_sources(id);
        self.is_break_due |= is_block;
    }

    fn note_sources(&mut self, id: NodeId) {
        self.changes
            .depends_on(id, self.reader.sources.borrow_mut().drain(..));
    }

    fn visit_shown(
        &mut self,
        id: NodeId,
        element: &'a Element,
        style: &Style,
        mut context: Context,
    ) {
        let (reader, tag) = (&self.reader, element.html_tag());
        let mut role = reader.role(id);
        let is_control = matches!(
            role,
            Role::Textbox | Role::Searchbox | Role::Combobox | Role::SpinButton
        ) || is_name!(tag, "input" | "textarea");
        let is_atomic = is_control && reader.is_text_control(id);
        let is_host = !is_atomic && style.is_editable() && reader.is_editing_host(id);
        if context.field != 0
            && !style.is_editable()
            && context.inherited & abi::RICHLY_EDITABLE != 0
        {
            context.inherited &= !(abi::EDITABLE | abi::RICHLY_EDITABLE);
        }
        let scrolls = style.scrolls()
            && !self.document.tree.is_root(id)
            && tag != name!("body")
            && reader.scrolls(id);
        let mut states = (if reader.supports_focus(id) {
            abi::FOCUSABLE
        } else {
            0
        }) | if scrolls { abi::SCROLLS } else { 0 }
            | if reader.facts(id).is_some_and(|it| it.is_clickable) {
                abi::CLICKABLE
            } else {
                0
            };
        if role == Role::GraphicsDocument
            && element.tag == name!("svg")
            && !element.has(name!("role"))
            && !self.has_accessible_graphics(id)
        {
            role = if reader.name(id).0.is_empty() && states & abi::FOCUSABLE == 0 {
                Role::None
            } else {
                Role::Image
            };
        }
        if element.namespace == Namespace::Svg
            || is_name!(tag, "canvas" | "audio" | "video")
            || self.document.tree[id].has(Flags::SKIPPED)
        {
            context.fallback = Some(self.rect_of(id, &context));
        }
        let is_redundant =
            role == Role::Label && states & abi::FOCUSABLE == 0 && self.is_redundant_label(id);
        let is_shown = !is_redundant && self.is_worth_it(id, element, role, states, &context);
        if role == Role::None {
            role = Role::Generic;
        }
        // The roles of the descendants may depend on it.
        context.may_skip &= self.sent.known.get(&id).map(|it| it.role) == is_shown.then_some(role);
        self.note_sources(id);
        if is_redundant {
            return self.visit_children(
                id,
                style,
                &Context {
                    is_presentational: true,
                    is_said_elsewhere: true,
                    ..context
                },
            );
        } else if !is_shown {
            return self.visit_children(id, style, &context);
        }
        let is_field = is_atomic || is_host || matches!(role, Role::Textbox | Role::Searchbox);
        if is_atomic || is_host {
            context.inherited |= abi::EDITABLE | if is_host { abi::RICHLY_EDITABLE } else { 0 };
        }
        if self.reader.aria_is(id, name!("aria-disabled"), "true") {
            context.inherited |= abi::DISABLED;
        }
        states |= context.inherited & (abi::EDITABLE | abi::RICHLY_EDITABLE)
            | if states & abi::FOCUSABLE != 0
                || self.reader.aria(id, name!("aria-disabled")).is_some()
            {
                context.inherited & abi::DISABLED
            } else {
                0
            }
            | if is_field { abi::TEXT_FIELD } else { 0 }
            | if is_atomic { abi::ATOMIC_FIELD } else { 0 }
            | if style.scrolls() { abi::CLIPS } else { 0 }
            | passes_pointer(style)
            | if style.display().is_inline_level() {
                0
            } else {
                abi::BLOCK
            }
            | if self.is_break_due {
                abi::STARTS_PARAGRAPH
            } else {
                0
            };

        let (rect, scroll) = (
            self.rect_of(id, &context),
            if scrolls { element.scroll } else { [0.0; 2] },
        );
        let (own, rect) = (
            self.document.own_box(id),
            context.fallback.filter(|_| rect.is_empty()).unwrap_or(rect),
        );
        let (mut inner, containers) = (
            Context {
                parent_role: role,
                has_other_layers: false,
                ..context
            },
            self.containers.len(),
        );
        if let Some(own) = own {
            let origin = [rect.x - scroll[0], rect.y - scroll[1]];
            self.containers.push(Container {
                id: self.sent.id_for(id),
                origin,
                depth: self.document.boxes[own].depth,
            });
            inner.container = containers;
        }
        if is_field && context.field == 0 {
            inner.field = id;
        }
        inner.is_presentational |= has_presentational_children(role) || is_atomic;
        inner.depth = match role {
            Role::List | Role::TreeItem => context.depth + 1,
            Role::Tree => 1,
            _ => context.depth,
        };
        if matches!(
            role,
            Role::Listbox | Role::TabList | Role::Tree | Role::TreeGrid
        ) {
            inner.selects_by_focus = tag != name!("select") && self.selects_by_focus(id);
        }
        let first_child = self.stack.len();
        let is_closed_select = tag == name!("select")
            && role == Role::Combobox
            && !element.state.contains(State::OPEN);
        let is_leaf = is_closed_select
            || is_name!(
                tag,
                "img" | "progress" | "meter" | "iframe" | "frame" | "hr"
            )
            || tag == name!("input")
                && !is_atomic
                && !matches!(
                    role,
                    Role::ColorWell | Role::Date | Role::DateTime | Role::InputTime
                )
            || is_name!(tag, "audio" | "video") && !element.has(name!("controls"))
            || role == Role::Math && element.namespace != Namespace::MathMl
            || role == Role::SpinButton && !is_field
            || role == Role::Image;
        if !is_leaf {
            self.visit_children(id, style, &inner);
        }
        if tag == name!("img") {
            self.visit_areas(id, style, rect, &inner);
        }
        self.containers.truncate(containers);
        if self.stack.len() == first_child {
            self.is_break_due = false;
            if style.display() == Display::Contents
                && role == Role::Generic
                && states & abi::FOCUSABLE == 0
                && !self.reader.has_global_state(id)
            {
                return;
            }
        }

        let lengths = self.out.lengths();
        states |= self.describe(id, element, role, states, &context);
        self.describe_layers(&context);
        self.commit(id, role, states, lengths, first_child);
        self.place(id, rect, scroll, &context);
    }

    fn visit_areas(&mut self, image: NodeId, style: &Style, whole: Rect, context: &Context) {
        for area in self.reader.areas(image) {
            let Some(element) = self
                .reader
                .element(area)
                .filter(|_| !self.reader.is_aria_hidden(area))
            else {
                continue;
            };
            let coordinates = element
                .attribute(name!("coords"))
                .unwrap_or_default()
                .as_bytes();
            let numbers: Vec<f32> = bun_core::strings::tokenize_any(coordinates, b", ;")
                .map(|it| text(it).parse().unwrap_or(0.0))
                .collect();
            let rect = match (
                element
                    .attribute(name!("shape"))
                    .unwrap_or_default()
                    .as_bytes()
                    .first()
                    .map(u8::to_ascii_lowercase),
                &numbers[..],
            ) {
                (Some(b'd'), _) => whole,
                (Some(b'c'), &[x, y, radius, ..]) => Rect::new([
                    whole.x + x - radius,
                    whole.y + y - radius,
                    radius * 2.0,
                    radius * 2.0,
                ]),
                _ => numbers
                    .as_chunks()
                    .0
                    .iter()
                    .map(|[x, y]| Rect::new([whole.x + x, whole.y + y, 0.0, 0.0]))
                    .reduce(|a, b| a.union(&b))
                    .unwrap_or(whole),
            };
            self.visit_shown(
                area,
                element,
                style,
                Context {
                    fallback: Some(rect),
                    ..*context
                },
            );
        }
    }

    fn relate(&mut self, key: Relation, nodes: impl IntoIterator<Item = NodeId>) {
        for node in nodes {
            let node = self.sent.id_for(node);
            self.out.relations.push(RelationEntry { key, node });
        }
    }

    fn describe_names(&mut self, id: NodeId, element: &Element, role: Role) -> u64 {
        let reader = &self.reader;
        let (name, from) = if reader.may_have_name(id, role, element) {
            reader.spoken_name(id, element, role)
        } else {
            (String::new(), NameFrom::Nothing)
        };
        self.out.text(Text::Name, &name);
        let may_be_described = element.namespace == Namespace::Svg
            || is_name!(element.tag, "input" | "table")
            || reader.facts(id).is_some()
            || element
                .attributes
                .iter()
                .any(|it| is_name!(it.name, "aria-describedby" | "aria-description" | "title"));
        if may_be_described {
            self.out
                .text(Text::Description, &reader.description(id, &name, from));
        }
        let placeholder = element
            .attribute(name!("placeholder"))
            .or_else(|| reader.aria(id, name!("aria-placeholder")));
        self.out
            .text(Text::Placeholder, placeholder.unwrap_or_default());
        let is_by_aria = may_be_described
            && (reader.aria_text(id, name!("aria-description")).is_some()
                || !reader.referenced(id, name!("aria-describedby")).is_empty());
        (if is_by_aria {
            abi::DESCRIBED_BY_ARIA
        } else {
            0
        }) | match from {
            NameFrom::Content | NameFrom::Value => abi::NAMED_BY_CONTENT,
            NameFrom::Relation => abi::NAMED_BY_RELATION,
            NameFrom::EmptyAttribute => abi::EXPLICITLY_UNNAMED,
            _ => 0,
        }
    }

    fn describe_value(&mut self, id: NodeId, element: &Element, role: Role, states: u64) {
        let (reader, facts) = (&self.reader, self.reader.facts(id));
        let is_adjustable = role == Role::Separator && states & abi::FOCUSABLE != 0;
        if is_range(role) || is_adjustable {
            let native = facts.map_or([None; 4], |it| it.numbers);
            let has_limits = role != Role::SpinButton;
            let min = reader
                .aria_number(id, name!("aria-valuemin"))
                .or(native[1])
                .or_else(|| has_limits.then_some(0.0));
            let max = reader
                .aria_number(id, name!("aria-valuemax"))
                .or(native[2])
                .or_else(|| has_limits.then_some(100.0));
            let default = match role {
                Role::Slider | Role::Scrollbar | Role::Separator => {
                    min.zip(max).map(|it| (it.0 + it.1) / 2.0)
                }
                Role::Meter => min,
                Role::SpinButton if states & abi::TEXT_FIELD == 0 => Some(0.0),
                _ => None,
            };
            let now = reader
                .aria_number(id, name!("aria-valuenow"))
                .or(native[0])
                .or(default);
            [
                (Number::Now, now),
                (Number::Min, min),
                (Number::Max, max),
                (Number::Step, native[3]),
            ]
            .into_iter()
            .for_each(|it| self.out.number(it.0, it.1));
        }
        match reader
            .aria_text(id, name!("aria-valuetext"))
            .or_else(|| facts?.value.as_deref())
        {
            Some(value) => self.out.text(Text::Value, value),
            None if element.html_tag() == name!("select") && role == Role::Combobox => self
                .out
                .text(Text::Value, &reader.selected_labels(id, ", ")),
            None if role == Role::Combobox && states & abi::TEXT_FIELD == 0 => {
                self.out.text(Text::Value, &reader.contents(id));
            }
            None => {}
        }
    }

    fn describe_toggles(
        &self,
        id: NodeId,
        element: &Element,
        role: Role,
        selects_by_focus: bool,
    ) -> u64 {
        let (reader, tag, mut states) = (&self.reader, element.html_tag(), 0);
        let tristate = |name, may_be_mixed: bool| match reader.aria_bool(id, name) {
            Some(true) if reader.aria_is(id, name, "mixed") => {
                Some(if may_be_mixed { abi::MIXED } else { 0 })
            }
            Some(true) => Some(abi::CHECKED),
            Some(false) => Some(0),
            None => None,
        };
        let checked = match role {
            _ if tag == name!("input") && is_name!(element.input_type(), "checkbox" | "radio") => {
                Some(match role {
                    Role::Checkbox if element.state.contains(State::INDETERMINATE) => abi::MIXED,
                    _ if element.state.contains(State::CHECKED) => abi::CHECKED,
                    _ => 0,
                })
            }
            Role::Button => tristate(name!("aria-pressed"), true),
            Role::Checkbox | Role::MenuItemCheckbox => {
                tristate(name!("aria-checked"), true).or(Some(0))
            }
            Role::Radio | Role::MenuItemRadio | Role::Switch => {
                tristate(name!("aria-checked"), false).or(Some(0))
            }
            Role::Option | Role::TreeItem => tristate(name!("aria-checked"), true),
            _ => None,
        };
        states |= checked.map_or(0, |it| it | abi::CHECKABLE);

        let popover = || {
            let target = element
                .attribute(name!("popovertarget"))
                .filter(|_| is_name!(tag, "button" | "input"))?;
            let target = reader.element(reader.by_id(self.document.tree[id].scope, target)?)?;
            target
                .has(name!("popover"))
                .then(|| target.state.contains(State::POPOVER_OPEN))
        };
        let expanded = match role {
            _ if tag == name!("select") && role == Role::Combobox => {
                Some(element.state.contains(State::OPEN))
            }
            _ if tag == name!("summary") && reader.is_summary(id) => {
                let details = reader
                    .ancestors(id)
                    .find(|it| reader.tag(*it) == name!("details"));
                details.map(|it| reader.attribute(it, name!("open")).is_some())
            }
            Role::Combobox => reader.aria_bool(id, name!("aria-expanded")).or(Some(false)),
            _ => popover().or_else(|| reader.aria_bool(id, name!("aria-expanded"))),
        };
        states |= expanded.map_or(0, |it| if it { abi::EXPANDED } else { abi::COLLAPSED });

        if matches!(
            role,
            Role::Option
                | Role::Tab
                | Role::TreeItem
                | Role::Row
                | Role::GridCell
                | Role::ColumnHeader
                | Role::RowHeader
        ) {
            let follows_focus = || {
                let is_current = id == self.page.focused
                    || reader
                        .referenced(self.page.focused, name!("aria-activedescendant"))
                        .first()
                        == Some(&id);
                (selects_by_focus && matches!(role, Role::Option | Role::Tab | Role::TreeItem))
                    .then_some(is_current)
            };
            let is_in_menu = || {
                reader
                    .ancestors(id)
                    .any(|it| reader.tag(it) == name!("select") && reader.is_drop_down(it))
            };
            let native = (tag == name!("option")).then(|| {
                element.state.contains(if is_in_menu() {
                    State::TARGET
                } else {
                    State::CHECKED
                })
            });
            let selected = reader
                .aria_bool(id, name!("aria-selected"))
                .or(native)
                .or_else(follows_focus);
            states |= selected.map_or(0, |it| abi::SELECTABLE | if it { abi::SELECTED } else { 0 });
        }
        states
    }

    fn describe_live(&mut self, id: NodeId, role: Role) -> u64 {
        let reader = &self.reader;
        let given = [
            ("polite", abi::LIVE_POLITE),
            ("assertive", abi::LIVE_ASSERTIVE),
            ("off", abi::LIVE_OFF),
        ];
        let live = given
            .into_iter()
            .find(|it| reader.aria_is(id, name!("aria-live"), it.0))
            .map(|it| it.1)
            .unwrap_or(match role {
                Role::Alert => abi::LIVE_ASSERTIVE,
                Role::Log | Role::Status => abi::LIVE_POLITE,
                Role::Marquee | Role::Timer => abi::LIVE_OFF,
                _ => 0,
            });
        if live == 0 {
            return 0;
        }
        self.out.text(
            Text::LiveRelevant,
            reader
                .aria_text(id, name!("aria-relevant"))
                .unwrap_or("additions text"),
        );
        let is_atomic = reader
            .aria_bool(id, name!("aria-atomic"))
            .unwrap_or(matches!(role, Role::Alert | Role::Status));
        live | if is_atomic { abi::LIVE_ATOMIC } else { 0 }
    }

    fn describe_position(&mut self, id: NodeId, element: &Element, role: Role, depth: u32) {
        let (reader, out) = (&self.reader, &mut self.out);
        let heading = ["h1", "h2", "h3", "h4", "h5", "h6"]
            .iter()
            .position(|it| element.tag == Name::new(it.as_bytes()));
        let level = match role {
            Role::Heading => Some(heading.map_or(2.0, |it| it as f64 + 1.0)),
            Role::ListItem | Role::TreeItem => Some(depth.max(1).into()),
            _ => None,
        };
        out.number(
            Number::Level,
            reader
                .aria_number(id, name!("aria-level"))
                .filter(|it| *it > 0.0)
                .or(level),
        );
        let given = [
            (Number::PositionInSet, name!("aria-posinset")),
            (Number::SetSize, name!("aria-setsize")),
            (Number::RowCount, name!("aria-rowcount")),
            (Number::ColumnCount, name!("aria-colcount")),
        ];
        given
            .into_iter()
            .for_each(|it| out.number(it.0, reader.aria_number(id, it.1)));
        if is_cell(role) {
            let span = |native, aria| {
                element
                    .number(native)
                    .map(f64::from)
                    .or_else(|| reader.aria_number(id, aria))
            };
            out.number(
                Number::RowSpan,
                span(name!("rowspan"), name!("aria-rowspan")),
            );
            out.number(
                Number::ColumnSpan,
                span(name!("colspan"), name!("aria-colspan")),
            );
        }
        if role == Role::Row || is_cell(role) {
            let text = |text, number| {
                reader
                    .aria_text(id, text)
                    .or_else(|| reader.aria_text(id, number))
                    .unwrap_or_default()
            };
            out.text(
                Text::RowIndex,
                text(name!("aria-rowindextext"), name!("aria-rowindex")),
            );
            out.text(
                Text::ColumnIndex,
                text(name!("aria-colindextext"), name!("aria-colindex")),
            );
        }
    }

    fn describe_relations(&mut self, id: NodeId, element: &Element, role: Role, is_invalid: bool) {
        let tag = element.html_tag();
        let labels = Some(self.reader.labelled_by(id))
            .filter(|it| !it.is_empty())
            .unwrap_or_else(|| self.reader.labels_of(id));
        self.relate(Relation::LabelledBy, labels);
        let relations = [
            (Relation::ActiveDescendant, name!("aria-activedescendant")),
            (Relation::Controls, name!("aria-controls")),
            (Relation::DescribedBy, name!("aria-describedby")),
            (Relation::Details, name!("aria-details")),
            (Relation::ErrorMessage, name!("aria-errormessage")),
            (Relation::FlowTo, name!("aria-flowto")),
            (Relation::Owns, name!("aria-owns")),
            (Relation::Headers, name!("headers")),
        ];
        for (key, name) in relations
            .into_iter()
            .filter(|it| it.0 != Relation::ErrorMessage || is_invalid)
        {
            let nodes = self.reader.referenced(id, name);
            self.relate(key, nodes);
        }
        if tag == name!("select") && element.state.contains(State::OPEN) {
            let active = self.reader.options(id).find(|it| {
                self.reader
                    .element(*it)
                    .is_some_and(|it| it.state.contains(State::TARGET))
            });
            self.relate(Relation::ActiveDescendant, active);
        } else if tag == name!("input") && role == Role::Radio {
            let group = self.reader.radio_group(id);
            self.relate(Relation::RadioGroup, group);
        } else if let Some(fragment) = element
            .attribute(name!("href"))
            .and_then(|it| it.strip_prefix('#'))
        {
            let target = self.reader.by_id(DOCUMENT, fragment);
            self.relate(Relation::Target, target);
        }
    }

    fn describe(
        &mut self,
        id: NodeId,
        element: &Element,
        role: Role,
        known: u64,
        context: &Context,
    ) -> u64 {
        let tag = element.html_tag();
        let mut states = self.describe_names(id, element, role)
            | self.describe_toggles(id, element, role, context.selects_by_focus)
            | self.describe_live(id, role);
        self.describe_value(id, element, role, known);
        self.describe_position(id, element, role, context.depth);

        let (reader, out) = (&self.reader, &mut self.out);
        let is = |name| reader.aria_is(id, name, "true");
        let orientation = match role {
            _ if reader.aria_is(id, name!("aria-orientation"), "vertical") => abi::VERTICAL,
            _ if reader.aria_is(id, name!("aria-orientation"), "horizontal") => abi::HORIZONTAL,
            Role::Listbox | Role::Menu | Role::Scrollbar | Role::Tree => abi::VERTICAL,
            Role::Menubar | Role::Slider | Role::Separator | Role::TabList | Role::Toolbar => {
                abi::HORIZONTAL
            }
            _ => 0,
        };
        let is_native_field = known & abi::ATOMIC_FIELD != 0;
        let is_multiline = known & abi::TEXT_FIELD != 0
            && tag != name!("input")
            && reader
                .aria_bool(id, name!("aria-multiline"))
                .unwrap_or(known & abi::EDITABLE != 0);
        let flags = [
            (element.state.contains(State::DISABLED), abi::DISABLED),
            (
                is_native_field && element.has(name!("readonly")) || is(name!("aria-readonly")),
                abi::READ_ONLY,
            ),
            (
                element.state.contains(State::REQUIRED) || is(name!("aria-required")),
                abi::REQUIRED,
            ),
            (
                reader.aria_text(id, name!("role")).is_none(),
                abi::IMPLICIT_ROLE,
            ),
            (is_multiline, abi::MULTILINE),
            (
                is_native_field && element.input_type() == name!("password"),
                abi::PROTECTED,
            ),
            (
                tag == name!("select") && element.has(name!("multiple"))
                    || is(name!("aria-multiselectable")),
                abi::MULTISELECTABLE,
            ),
            (
                element.state.contains(State::MODAL)
                    || matches!(role, Role::Dialog | Role::AlertDialog) && is(name!("aria-modal")),
                abi::MODAL,
            ),
            (is(name!("aria-busy")), abi::BUSY),
            (is_activatable(role), abi::CLICKABLE),
            (
                has_presentational_children(role),
                abi::PRESENTATIONAL_CHILDREN,
            ),
            (
                tag == name!("select") && role == Role::Combobox,
                abi::MENU_LIST,
            ),
        ];
        states |= flags
            .iter()
            .fold(orientation, |all, it| all | if it.0 { it.1 } else { 0 });

        let token = |name, allowed: &[&'static str], otherwise: &'static str| {
            let value = reader
                .aria_text(id, name)
                .filter(|_| reader.aria_bool(id, name) == Some(true))?
                .trim_ascii();
            Some(
                allowed
                    .iter()
                    .find(|it| value.eq_ignore_ascii_case(it))
                    .copied()
                    .unwrap_or(otherwise),
            )
        };
        // That it is required has been said.
        let is_only_empty = || {
            is_native_field
                && element.state.contains(State::REQUIRED)
                && reader.control_text(id).is_empty()
                && reader.facts(id).is_none_or(|it| !it.has_custom_error)
        };
        let invalid = match reader.aria_bool(id, name!("aria-invalid")) {
            Some(_) => token(name!("aria-invalid"), &["grammar", "spelling"], "true"),
            None => (element.state.contains(State::INVALID)
                && !is_name!(tag, "form" | "fieldset")
                && !is_only_empty())
            .then_some("true"),
        };
        let default_popup = match role {
            _ if states & abi::MENU_LIST != 0 => Some("menu"),
            Role::Combobox => Some("listbox"),
            _ => None,
        };
        let popup = token(
            name!("aria-haspopup"),
            &["menu", "listbox", "tree", "grid", "dialog"],
            if is(name!("aria-haspopup")) {
                "menu"
            } else {
                ""
            },
        );
        let tokens = [
            (Text::Invalid, invalid),
            (Text::HasPopup, popup.or(default_popup)),
            (
                Text::Current,
                token(
                    name!("aria-current"),
                    &["page", "step", "location", "date", "time"],
                    "true",
                ),
            ),
            (
                Text::Sort,
                token(
                    name!("aria-sort"),
                    &["ascending", "descending", "other"],
                    "",
                ),
            ),
            (
                Text::Autocomplete,
                token(name!("aria-autocomplete"), &["inline", "list", "both"], ""),
            ),
        ];
        tokens
            .into_iter()
            .for_each(|it| out.text(it.0, it.1.unwrap_or_default()));
        let copied = [
            (Text::RoleDescription, name!("aria-roledescription")),
            (Text::KeyShortcuts, name!("aria-keyshortcuts")),
            (Text::BrailleLabel, name!("aria-braillelabel")),
            (
                Text::BrailleRoleDescription,
                name!("aria-brailleroledescription"),
            ),
            (Text::AccessKey, name!("accesskey")),
            (Text::Language, name!("lang")),
            (Text::DomId, name!("id")),
            (Text::DomClass, name!("class")),
        ];
        copied
            .into_iter()
            .for_each(|it| out.text(it.0, reader.aria_text(id, it.1).unwrap_or_default()));
        out.text(Text::Tag, &element.local.as_utf8());
        if tag == name!("input") {
            out.text(
                Text::InputType,
                element.attribute(name!("type")).unwrap_or_default(),
            );
        }
        let url = match role {
            _ if element.state.contains(State::LINK) => element.attribute(name!("href")),
            Role::Image => element
                .attribute(name!("src"))
                .filter(|it| !it.starts_with("data:")),
            _ => None,
        };
        if let Some(url) = url {
            out.text(Text::Url, &self.document.resolve_url(url));
        }
        if matches!(role, Role::Iframe | Role::EmbeddedObject) || is_name!(tag, "iframe" | "frame")
        {
            out.number(Number::Frame, element.replaced.map(|it| it.image.into()));
        }
        self.describe_relations(id, element, role, invalid.is_some());
        states
    }
}
