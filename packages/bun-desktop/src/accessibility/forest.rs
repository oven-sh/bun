//! The trees of all documents, and what differs after an update.

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

use super::tables::Grid;
use super::text::{Block, Position};
use crate::abi::Rect;
use crate::abi::accessibility::{
    self as abi, Number, NumberEntry, Placement, Relation, RelationEntry, Role, Run, TREE_OF_IMAGE,
    Text,
};
use crate::hash::{FastMap, FastSet};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Id {
    pub tree: u32,
    pub node: u32,
}

impl Id {
    pub fn bits(self) -> u64 {
        u64::from(self.tree) << 32 | u64::from(self.node)
    }

    pub fn from_bits(bits: u64) -> Id {
        Id {
            tree: (bits >> 32) as u32,
            node: bits as u32,
        }
    }
}

#[derive(Default)]
pub struct Node {
    pub role: Role,
    pub states: u64,
    parent: u32,
    children: Vec<u32>,
    texts: Vec<(Text, Box<str>)>,
    numbers: Vec<NumberEntry>,
    relations: Vec<RelationEntry>,
    pub runs: Vec<Run>,
    pub advances: Vec<f32>,
    pub misspelled: Vec<[u32; 2]>,
    placement: Placement,
}

impl Node {
    /// One of them.
    pub fn has(&self, states: u64) -> bool {
        self.states & states != 0
    }

    pub fn text(&self, key: Text) -> Option<&str> {
        self.texts.iter().find(|it| it.0 == key).map(|it| &*it.1)
    }

    pub fn name(&self) -> &str {
        self.text(Text::Name).unwrap_or_default()
    }

    pub fn number(&self, key: Number) -> Option<f64> {
        self.numbers
            .iter()
            .find(|it| it.key == key)
            .map(|it| it.value)
    }

    fn layers(&self) -> impl Iterator<Item = f64> {
        self.numbers
            .iter()
            .filter(|it| it.key == Number::Layer)
            .map(|it| it.value)
    }

    pub fn is_text(&self) -> bool {
        matches!(
            self.role,
            Role::StaticText | Role::LineBreak | Role::ListMarker
        )
    }

    pub fn is_live(&self) -> bool {
        self.has(abi::LIVE_POLITE | abi::LIVE_ASSERTIVE)
    }

    pub fn is_table(&self) -> bool {
        matches!(self.role, Role::Table | Role::Grid | Role::TreeGrid)
    }

    pub fn is_cell(&self) -> bool {
        matches!(
            self.role,
            Role::Cell | Role::GridCell | Role::ColumnHeader | Role::RowHeader
        )
    }

    fn frame(&self) -> Option<u32> {
        Some(self.number(Number::Frame)? as u32 | TREE_OF_IMAGE)
    }

    pub fn holds_selection(&self) -> bool {
        self.is_table()
            || matches!(
                self.role,
                Role::Listbox | Role::Tree | Role::TabList | Role::Menu | Role::MenuListPopup
            )
    }
}

fn is_above(later: &[f64], earlier: &[f64]) -> bool {
    let (level, which) = (
        |it: f64| it.div_euclid(abi::LAYER_LEVEL),
        |it: f64| it.rem_euclid(abi::LAYER_LEVEL),
    );
    match later
        .iter()
        .zip(earlier)
        .find(|it| which(*it.0) != which(*it.1))
    {
        Some((later, earlier)) => level(*later) >= level(*earlier),
        None => later.get(earlier.len()).map_or_else(
            || earlier.get(later.len()).is_none_or(|it| *it < 0.),
            |it| *it >= 0.,
        ),
    }
}

pub struct Update {
    is_first: bool,
    is_complete: bool,
    zoom: f32,
    root: u32,
    focus: u32,
    selection: abi::Selection,
    removed: Vec<u32>,
    nodes: Vec<(u32, Node)>,
    placements: Vec<Placement>,
    announcements: Vec<(String, bool)>,
}

impl Update {
    /// # Safety
    /// The slices are valid, and so are the spans in them.
    pub unsafe fn copy(from: &abi::Update) -> Update {
        // SAFETY: the caller's contract.
        unsafe {
            let (bytes, texts) = (from.bytes.get(), from.texts.get());
            let text =
                |span: crate::abi::Span| String::from_utf8_lossy(&bytes[span.range()]).into_owned();
            let node = |it: &abi::Node| Node {
                role: it.role,
                states: it.states,
                parent: 0,
                children: from.children.get()[it.children.range()].to_vec(),
                texts: texts[it.texts.range()]
                    .iter()
                    .map(|it| (it.key, text(it.value).into()))
                    .collect(),
                numbers: from.numbers.get()[it.numbers.range()].to_vec(),
                relations: from.relations.get()[it.relations.range()].to_vec(),
                runs: from.runs.get()[it.runs.range()].to_vec(),
                advances: from.advances.get()[it.advances.range()].to_vec(),
                misspelled: from.misspelled.get()[it.misspelled.range()].to_vec(),
                placement: Placement::default(),
            };
            Update {
                is_first: from.is_first,
                is_complete: from.is_complete,
                zoom: from.zoom,
                root: from.root,
                focus: from.focus,
                selection: from.selection,
                removed: from.removed.get().to_vec(),
                nodes: from
                    .nodes
                    .get()
                    .iter()
                    .map(|it| (it.id, node(it)))
                    .collect(),
                placements: from.placements.get().to_vec(),
                announcements: from
                    .announcements
                    .get()
                    .iter()
                    .map(|it| (text(it.text), it.is_urgent))
                    .collect(),
            }
        }
    }
}

#[derive(Default)]
struct Tree {
    nodes: FastMap<u32, Node>,
    root: u32,
    focus: u32,
    selection: abi::Selection,
    zoom: f32,
}

#[derive(Clone, Copy, PartialEq)]
pub struct Root {
    pub surface: u32,
    pub tree: u32,
    pub rect: Rect,
}

#[derive(Default)]
struct Window {
    roots: Vec<Root>,
    focused: Option<u32>,
    is_active: bool,
    focus: Option<Id>,
    has_waited: bool,
}

/// With the numbers of `AXTextSelectionGranularity`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Granularity {
    Unknown,
    Character,
    Word,
    Line,
    Paragraph = 5,
    Page,
    Document,
    All,
}

/// With the numbers of `AXTextSelectionDirection`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Direction {
    Beginning = 1,
    End,
    Previous,
    Next,
    Discontiguous,
}

#[derive(Debug)]
#[cfg_attr(
    target_os = "macos",
    expect(dead_code, reason = "AT-SPI wants to know more")
)]
pub enum Event {
    Destroyed(Id, Role),
    Created(Id),
    ActiveDescendantChanged(Id),
    RootsChanged(u32),
    ActivationChanged,
    ChildrenChanged {
        parent: Id,
        added: Vec<Id>,
        removed: Vec<Id>,
    },
    Loaded(Id),
    Focused {
        window: u32,
        to: Option<Id>,
    },
    NameChanged(Id),
    DescriptionChanged(Id),
    ValueChanged(Id),
    /// With those that have.
    StatesChanged(Id, u64),
    TextChanged(Id, Text),
    /// `at` is a UTF-8 offset in the text of the field.
    Edited {
        field: Id,
        at: usize,
        deleted: String,
        inserted: String,
    },
    /// `at` counts characters.
    #[cfg(not(target_os = "macos"))]
    HypertextChanged {
        id: Id,
        at: usize,
        deleted: String,
        inserted: String,
    },
    SelectionChanged {
        within: Id,
        extends: bool,
        was_extended: bool,
        direction: Direction,
        granularity: Granularity,
        follows_focus: bool,
        follows_edit: bool,
    },
    LiveRegionCreated(Id),
    LiveRegionChanged(Id),
    Announced {
        tree: u32,
        text: String,
        is_urgent: bool,
    },
}

#[derive(Default)]
pub struct Forest {
    trees: FastMap<u32, Tree>,
    windows: FastMap<u32, Window>,
    /// From a tree to the node that shows it.
    hosts: FastMap<u32, Id>,
    pub last_key: Option<(String, u8, Instant)>,
    pub(super) last_block: RefCell<Option<Rc<Block>>>,
    pub(super) last_grid: RefCell<Option<Rc<Grid>>>,
}

fn intersection(a: Rect, b: Rect) -> Rect {
    let [left, right] = [a.x, a.x + a.width].map(|it| it.min(b.x + b.width).max(b.x));
    let [top, bottom] = [a.y, a.y + a.height].map(|it| it.min(b.y + b.height).max(b.y));
    Rect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

impl Forest {
    pub fn clear(&mut self) -> Vec<Event> {
        let old = std::mem::take(self);
        let nodes = old.trees.into_iter().flat_map(|(tree, it)| {
            it.nodes
                .into_iter()
                .map(move |(node, it)| Event::Destroyed(Id { tree, node }, it.role))
        });
        nodes
            .chain(old.windows.into_keys().map(Event::RootsChanged))
            .collect()
    }

    // ───────────────────────────── structure ─────────────────────────────

    pub fn get(&self, id: Id) -> Option<&Node> {
        self.trees.get(&id.tree)?.nodes.get(&id.node)
    }

    pub fn root_of(&self, tree: u32) -> Option<Id> {
        let id = Id {
            tree,
            node: self.trees.get(&tree)?.root,
        };
        self.get(id).map(|_| id)
    }

    fn host_of(&self, tree: u32) -> Option<Id> {
        self.hosts
            .get(&tree)
            .copied()
            .filter(|it| self.get(*it).is_some_and(|it| it.frame() == Some(tree)))
    }

    /// The window and the surface that show it.
    pub fn place_of(&self, tree: u32) -> Option<(u32, Root)> {
        let top = std::iter::successors(Some(tree), |it| Some(self.host_of(*it)?.tree))
            .take(64)
            .last()?;
        self.windows
            .iter()
            .find_map(|(id, it)| Some((*id, *it.roots.iter().find(|it| it.tree == top)?)))
    }

    pub fn windows(&self) -> impl Iterator<Item = u32> + '_ {
        self.windows.keys().copied()
    }

    pub fn roots(&self, window: u32) -> Vec<Id> {
        self.windows
            .get(&window)
            .into_iter()
            .flat_map(|it| &it.roots)
            .filter_map(|it| self.root_of(it.tree))
            .collect()
    }

    pub fn has_all_roots(&self, window: u32) -> bool {
        self.windows
            .get(&window)
            .is_some_and(|it| it.roots.len() == self.roots(window).len())
    }

    /// Whether it is the first time.
    pub fn note_waiting(&mut self, window: u32) -> bool {
        !std::mem::replace(
            &mut self.windows.entry(window).or_default().has_waited,
            true,
        )
    }

    pub fn parent(&self, id: Id) -> Option<Id> {
        match self.get(id)?.parent {
            0 => self.host_of(id.tree),
            node => Some(Id { node, ..id }),
        }
    }

    pub fn ancestors(&self, id: Id) -> impl Iterator<Item = Id> + '_ {
        std::iter::successors(self.parent(id), |it| self.parent(*it)).take(4096)
    }

    pub fn closest(&self, id: Id, matches: impl Fn(&Node) -> bool) -> Option<Id> {
        std::iter::once(id)
            .chain(self.ancestors(id))
            .find(|it| self.get(*it).is_some_and(&matches))
    }

    pub fn contains(&self, ancestor: Id, id: Id) -> bool {
        ancestor == id || self.ancestors(id).any(|it| it == ancestor)
    }

    fn framed(&self, node: &Node) -> Option<Id> {
        self.root_of(node.frame()?)
    }

    pub fn children(&self, id: Id) -> impl DoubleEndedIterator<Item = Id> + '_ {
        let node = self.get(id);
        let own = node
            .into_iter()
            .flat_map(|it| &it.children)
            .map(move |it| Id { node: *it, ..id });
        own.chain(
            node.filter(|it| it.children.is_empty())
                .and_then(|it| self.framed(it)),
        )
    }

    pub fn index_in_parent(&self, id: Id) -> Option<usize> {
        self.children(self.parent(id)?).position(|it| it == id)
    }

    pub fn sibling(&self, id: Id, is_next: bool) -> Option<Id> {
        let siblings = &self
            .get(Id {
                node: self.get(id)?.parent,
                ..id
            })?
            .children;
        let index = siblings.iter().position(|it| *it == id.node)?;
        let node = *siblings.get(if is_next {
            index + 1
        } else {
            index.checked_sub(1)?
        })?;
        Some(Id { node, ..id })
    }

    /// In tree order, without `root`.
    pub fn descendants(&self, root: Id) -> impl Iterator<Item = Id> + '_ {
        let mut pending: Vec<Id> = self.children(root).rev().collect();
        std::iter::from_fn(move || {
            let next = pending.pop()?;
            pending.extend(self.children(next).rev());
            Some(next)
        })
    }

    pub fn related(&self, id: Id, key: Relation) -> impl Iterator<Item = Id> + '_ {
        let all = self
            .get(id)
            .into_iter()
            .flat_map(|it| &it.relations)
            .filter(move |it| it.key == key);
        all.map(move |it| Id {
            node: it.node,
            ..id
        })
        .filter(|it| self.get(*it).is_some())
    }

    /// Those that have the relation with `id`.
    #[cfg(not(target_os = "macos"))]
    pub fn related_to(&self, id: Id, key: Relation) -> Vec<Id> {
        let (all, entry) = (
            self.trees
                .get(&id.tree)
                .into_iter()
                .flat_map(|it| &it.nodes),
            RelationEntry { key, node: id.node },
        );
        all.filter(|it| it.1.relations.contains(&entry))
            .map(|it| Id { node: *it.0, ..id })
            .collect()
    }

    /// Whether assistive technologies are spared the children.
    pub fn is_leaf(&self, id: Id) -> bool {
        self.get(id).is_none_or(|node| {
            node.has(abi::ATOMIC_FIELD)
                || (node.has(abi::PRESENTATIONAL_CHILDREN) || node.role == Role::MenuItem)
                    && self
                        .children(id)
                        .all(|it| self.get(it).is_none_or(Node::is_text))
        })
    }

    pub fn exposed_children(&self, id: Id) -> Vec<Id> {
        if self.is_leaf(id) {
            Vec::new()
        } else {
            self.children(id).collect()
        }
    }

    /// Itself, or what stands for it.
    pub fn exposed(&self, id: Id) -> Id {
        self.ancestors(id)
            .take_while(|it| {
                self.is_leaf(*it) || self.get(*it).is_some_and(|it| it.has(abi::EDITABLE))
            })
            .filter(|it| self.is_leaf(*it))
            .last()
            .unwrap_or(id)
    }

    pub fn selection_container(&self, id: Id) -> Option<Id> {
        self.closest(id, Node::holds_selection)
    }

    pub fn inherited_text(&self, id: Id, key: Text) -> Option<&str> {
        std::iter::once(id)
            .chain(self.ancestors(id))
            .find_map(|it| self.get(it)?.text(key))
    }

    // ───────────────────────────── focus and selection ─────────────────────────────

    fn focus_in(&self, tree: u32) -> Option<Id> {
        let mut id = Id {
            tree,
            node: self.trees.get(&tree)?.focus,
        };
        for _ in 0..64 {
            let Some(inner) = self.framed(self.get(id)?) else {
                break;
            };
            id = Id {
                node: self.trees.get(&inner.tree)?.focus,
                ..inner
            };
        }
        self.get(id).map(|_| id)
    }

    /// What has the keyboard.
    pub fn real_focus(&self, window: u32) -> Option<Id> {
        let window = self.windows.get(&window)?;
        self.focus_in(
            window
                .roots
                .iter()
                .find(|it| Some(it.surface) == window.focused)?
                .tree,
        )
    }

    /// What the user works with.
    pub fn focus(&self, window: u32) -> Option<Id> {
        let real = self.real_focus(window)?;
        Some(
            self.related(real, Relation::ActiveDescendant)
                .next()
                .unwrap_or(real),
        )
    }

    pub fn is_focused(&self, id: Id) -> bool {
        self.place_of(id.tree)
            .is_some_and(|it| self.focus(it.0) == Some(id))
    }

    pub fn is_window_active(&self, window: u32) -> bool {
        self.windows.get(&window).is_some_and(|it| it.is_active)
    }

    /// The anchor and the focus.
    pub fn selection(&self, tree: u32) -> Option<[Position; 2]> {
        let selection = self.trees.get(&tree)?.selection;
        let at = |it: abi::Point, is_upstream| {
            self.position_at(
                Id {
                    tree,
                    node: it.node,
                },
                it.offset as usize,
                is_upstream,
            )
        };
        let is_collapsed = selection.anchor == selection.focus;
        Some([
            at(selection.anchor, selection.is_upstream && is_collapsed)?,
            at(selection.focus, selection.is_upstream)?,
        ])
    }

    // ───────────────────────────── places ─────────────────────────────

    /// In the window. `part` is relative to the corner of the node, in its units.
    pub fn bounds(&self, id: Id, part: Option<Rect>, clips: bool) -> Rect {
        let Some(tree) = self.trees.get(&id.tree) else {
            return Rect::default();
        };
        let Some(mut at) = tree.nodes.get(&id.node).map(|it| it.placement) else {
            return Rect::default();
        };
        let has_size = |it: Rect| it.width > 0. || it.height > 0.;
        if part.is_none() && !has_size(at.rect) {
            let inside = self.descendants(id).filter(|it| {
                it.tree == id.tree && self.get(*it).is_some_and(|it| has_size(it.placement.rect))
            });
            if let Some(all) = inside
                .map(|it| self.bounds(it, None, clips))
                .reduce(super::text::union)
            {
                return all;
            }
        }
        let mut rect = part.map_or(at.rect, |it| Rect {
            x: at.rect.x + it.x,
            y: at.rect.y + it.y,
            ..it
        });
        for _ in 0..256 {
            let Some(container) = tree.nodes.get(&at.container) else {
                break;
            };
            at = container.placement;
            (rect.x, rect.y) = (
                rect.x + at.rect.x - at.scroll[0],
                rect.y + at.rect.y - at.scroll[1],
            );
            if clips && container.has(abi::CLIPS) {
                rect = intersection(rect, at.rect);
            }
        }
        let outer = match self.host_of(id.tree) {
            Some(host) => self.bounds(host, None, false),
            None => self
                .place_of(id.tree)
                .map_or_else(Rect::default, |it| it.1.rect),
        };
        let zoom = tree.zoom;
        let rect = Rect {
            x: outer.x + rect.x * zoom,
            y: outer.y + rect.y * zoom,
            width: rect.width * zoom,
            height: rect.height * zoom,
        };
        match self.host_of(id.tree).filter(|_| clips) {
            Some(host) => intersection(rect, self.bounds(host, None, true)),
            None => rect,
        }
    }

    pub fn is_offscreen(&self, id: Id) -> bool {
        let (shown, whole) = (self.bounds(id, None, true), self.bounds(id, None, false));
        shown.width <= 0. && whole.width > 0. || shown.height <= 0. && whole.height > 0.
    }

    /// What is deepest and on top.
    pub fn hit(&self, within: Id, [x, y]: [f32; 2]) -> Option<Id> {
        let has_it = |id: Id| {
            let it = self.bounds(id, None, true);
            x >= it.x && x < it.x + it.width && y >= it.y && y < it.y + it.height
        };
        let of_start = self.closest(within, |it| {
            it.role == Role::WebArea || it.number(Number::Layer).is_some()
        });
        let mut pending = vec![(
            within,
            self.get(of_start?)?.layers().skip(1).collect::<Rc<[f64]>>(),
            0,
        )];
        let mut found = None::<(Id, Rc<[f64]>)>;
        while let Some((id, mut layers, mut of_frames)) = pending.pop() {
            let is_hit = has_it(id);
            let node = self.get(id)?;
            if node.role == Role::WebArea {
                of_frames = layers.len();
            } else if node.number(Number::Layer).is_some() {
                layers = layers[..of_frames]
                    .iter()
                    .copied()
                    .chain(node.layers().skip(1))
                    .collect();
            }
            let is_on_text = || {
                let bounds = node
                    .runs
                    .iter()
                    .map(|it| self.bounds(id, Some(it.rect), false));
                bounds
                    .into_iter()
                    .any(|it| x >= it.x && x < it.x + it.width && y >= it.y && y < it.y + it.height)
            };
            let takes_it =
                !node.has(abi::PASSES_POINTER) || node.has(abi::FOCUSABLE | abi::CLICKABLE);
            let is_on_top = || {
                found
                    .as_ref()
                    .is_none_or(|it| is_above(&layers, &it.1) || self.contains(it.0, id))
            };
            if is_hit && takes_it && (node.runs.len() < 2 || is_on_text()) && is_on_top() {
                found = Some((id, Rc::clone(&layers)));
            }
            if is_hit || !node.has(abi::SCROLLS) {
                pending.extend(
                    self.children(id)
                        .rev()
                        .map(|it| (it, Rc::clone(&layers), of_frames)),
                );
            }
        }
        Some(found?.0)
    }

    pub fn hit_in_window(&self, window: u32, point: [f32; 2]) -> Option<Id> {
        self.roots(window)
            .into_iter()
            .rev()
            .find_map(|root| self.hit(root, point).filter(|it| *it != root))
            .or_else(|| {
                self.roots(window)
                    .into_iter()
                    .find_map(|root| self.hit(root, point))
            })
    }

    // ───────────────────────────── changes ─────────────────────────────

    fn check_focus(&mut self, events: &mut Vec<Event>) {
        let ids: Vec<u32> = self.windows().collect();
        for window in ids {
            let to = self.focus(window);
            if let Some(state) = self.windows.get_mut(&window).filter(|it| it.focus != to) {
                state.focus = to;
                events.push(Event::Focused { window, to });
            }
        }
    }

    pub fn set_roots(
        &mut self,
        window: u32,
        roots: Vec<Root>,
        focused: Option<u32>,
        is_active: bool,
    ) -> Vec<Event> {
        let (state, mut events) = (self.windows.entry(window).or_default(), Vec::new());
        if state
            .roots
            .iter()
            .map(|it| it.tree)
            .ne(roots.iter().map(|it| it.tree))
        {
            events.push(Event::RootsChanged(window));
        }
        if is_active != state.is_active {
            state.focus = state.focus.filter(|_| !is_active);
            events.push(Event::ActivationChanged);
        }
        (state.roots, state.focused, state.is_active) = (roots, focused, is_active);
        self.check_focus(&mut events);
        events
    }

    pub fn remove_window(&mut self, window: u32) -> Vec<Event> {
        self.windows.remove(&window);
        vec![Event::RootsChanged(window)]
    }

    pub fn remove_tree(&mut self, tree: u32) -> Vec<Event> {
        self.last_block.take();
        self.last_grid.take();
        let nodes = self.trees.remove(&tree).into_iter().flat_map(|it| it.nodes);
        let mut events = nodes
            .map(|(node, it)| Event::Destroyed(Id { tree, node }, it.role))
            .collect();
        self.check_focus(&mut events);
        events
    }

    fn compare(id: Id, old: &Node, new: &Node, events: &mut Vec<Event>) {
        if old.name() != new.name() {
            events.push(Event::NameChanged(id));
        }
        if old.text(Text::Description) != new.text(Text::Description) {
            events.push(Event::DescriptionChanged(id));
        }
        if old.text(Text::Value) != new.text(Text::Value)
            || old.number(Number::Now) != new.number(Number::Now)
        {
            events.push(Event::ValueChanged(id));
        }
        if old.states != new.states {
            events.push(Event::StatesChanged(id, old.states ^ new.states));
        }
        let texts = [Text::Invalid, Text::Current, Text::Sort];
        events.extend(
            texts
                .into_iter()
                .filter(|it| old.text(*it) != new.text(*it))
                .map(|it| Event::TextChanged(id, it)),
        );
        if old.children != new.children {
            let missing = |from: &Node, of: &Node| {
                let from: FastSet<_> = from.children.iter().collect();
                of.children
                    .iter()
                    .filter(|it| !from.contains(it))
                    .map(|it| Id { node: *it, ..id })
                    .collect()
            };
            events.push(Event::ChildrenChanged {
                parent: id,
                added: missing(old, new),
                removed: missing(new, old),
            });
        }
        let active = |it: &Node| {
            it.relations
                .iter()
                .find(|it| it.key == Relation::ActiveDescendant)
                .map(|it| it.node)
        };
        if active(old) != active(new) {
            events.push(Event::ActiveDescendantChanged(id));
        }
        if new.is_live() && !old.is_live() {
            events.push(Event::LiveRegionCreated(id));
        }
    }

    pub fn live_region(&self, id: Id) -> Option<Id> {
        let region = self.closest(id, |it| it.is_live() || it.has(abi::LIVE_OFF))?;
        let is_busy = || {
            std::iter::once(id)
                .chain(self.ancestors(id))
                .take_while(|it| *it != region)
                .chain([region])
                .any(|it| self.get(it).is_some_and(|it| it.has(abi::BUSY)))
        };
        (self.get(region)?.is_live() && !is_busy()).then_some(region)
    }

    fn find_live_changes(&self, created: &FastSet<u32>, events: &mut Vec<Event>) {
        let mut regions = Vec::new();
        for event in events.iter() {
            let (at, kinds) = match event {
                Event::NameChanged(id)
                    if self
                        .get(*id)
                        .is_some_and(|it| !it.has(abi::NAMED_BY_CONTENT)) =>
                {
                    (*id, ["text", "additions"])
                }
                Event::ChildrenChanged { parent, added, .. } if !added.is_empty() => {
                    (*parent, ["text", "additions"])
                }
                Event::ChildrenChanged { parent, .. } => (*parent, ["removals"; 2]),
                Event::StatesChanged(id, changed) if changed & abi::BUSY != 0 => {
                    (*id, ["text", "additions"])
                }
                _ => continue,
            };
            let is_relevant = |it: &Id| {
                let relevant = self
                    .get(*it)
                    .and_then(|it| it.text(Text::LiveRelevant))
                    .unwrap_or_default();
                relevant
                    .split_ascii_whitespace()
                    .any(|it| it == "all" || kinds.contains(&it))
            };
            regions.extend(
                self.live_region(at)
                    .filter(|it| !created.contains(&it.node) && !regions.contains(it))
                    .filter(is_relevant),
            );
        }
        events.extend(regions.into_iter().map(Event::LiveRegionChanged));
    }

    /// Of the nodes in which it is about to change.
    #[cfg(not(target_os = "macos"))]
    fn hypertexts_before(&self, tree: u32, update: &Update) -> Vec<(Id, String)> {
        let holder = |(node, new): &(u32, Node)| {
            let (id, old) = (
                Id { tree, node: *node },
                self.trees.get(&tree)?.nodes.get(node)?,
            );
            (old.children != new.children || old.is_text() && old.name() != new.name())
                .then(|| self.holder_of_text(id))
        };
        let holders: FastSet<_> = update.nodes.iter().filter_map(holder).collect();
        holders
            .into_iter()
            .map(|it| (it, self.hypertext(it).text))
            .collect()
    }

    fn intent(
        &self,
        key: Option<(String, u8, Instant)>,
        old: Option<[Position; 2]>,
        new: [Position; 2],
    ) -> (Direction, Granularity) {
        let (word, far) = if cfg!(target_os = "macos") {
            (4, 8)
        } else {
            (2, 2)
        };
        let towards = |is_next| {
            if is_next {
                Direction::Next
            } else {
                Direction::Previous
            }
        };
        let to_edge = |is_end| {
            if is_end {
                Direction::End
            } else {
                Direction::Beginning
            }
        };
        let moves_on = || old.is_none_or(|it| self.compare_positions(it[1], new[1]).is_le());
        match key.as_ref().map(|it| (&*it.0, it.1)) {
            Some(("ArrowLeft" | "ArrowRight", m)) if m & word != 0 => {
                (towards(moves_on()), Granularity::Word)
            }
            Some(("ArrowLeft" | "ArrowRight", m)) if m & far != 0 => {
                (to_edge(moves_on()), Granularity::Line)
            }
            Some(("ArrowLeft" | "ArrowRight", _)) => (towards(moves_on()), Granularity::Character),
            Some((code @ ("ArrowUp" | "ArrowDown"), m)) if m & word != 0 => {
                (towards(code == "ArrowDown"), Granularity::Paragraph)
            }
            Some((code @ ("ArrowUp" | "ArrowDown"), m)) if m & far != 0 => {
                (to_edge(code == "ArrowDown"), Granularity::Document)
            }
            Some((code @ ("ArrowUp" | "ArrowDown"), _)) => {
                (towards(code == "ArrowDown"), Granularity::Line)
            }
            Some((code @ ("Home" | "End"), m)) if m & 2 != 0 => {
                (to_edge(code == "End"), Granularity::Document)
            }
            Some((code @ ("Home" | "End"), _)) => (to_edge(code == "End"), Granularity::Line),
            Some((code @ ("PageUp" | "PageDown"), _)) => {
                (towards(code == "PageDown"), Granularity::Page)
            }
            Some(("KeyA", m)) if m & far != 0 => (Direction::Discontiguous, Granularity::All),
            _ => (Direction::Discontiguous, Granularity::Unknown),
        }
    }

    pub fn apply(&mut self, tree: u32, update: Update) -> Vec<Event> {
        let id = |node| Id { tree, node };
        let is_first = update.is_first
            || self
                .trees
                .get(&tree)
                .is_none_or(|it| it.root != update.root);
        let mut events = if is_first {
            self.remove_tree(tree)
        } else {
            Vec::new()
        };
        let edited = self
            .trees
            .get(&tree)
            .map(|it| id(it.focus))
            .filter(|it| self.get(*it).is_some_and(|it| it.has(abi::TEXT_FIELD)));
        let edited = edited
            .filter(|_| !update.nodes.is_empty())
            .map(|it| (it, self.field_text(it).text));
        let old_selection = self.selection(tree);
        #[cfg(not(target_os = "macos"))]
        let hypertexts = self.hypertexts_before(tree, &update);
        self.last_block.take();
        self.last_grid.take();

        let own = self.trees.entry(tree).or_default();
        let had_focus = std::mem::replace(&mut own.focus, update.focus);
        let selection_differs =
            std::mem::replace(&mut own.selection, update.selection) != update.selection;
        (own.root, own.zoom) = (update.root, update.zoom);
        for node in update.removed {
            events.extend(
                own.nodes
                    .remove(&node)
                    .map(|it| Event::Destroyed(id(node), it.role)),
            );
        }
        if update.is_complete {
            let kept: FastSet<_> = update.nodes.iter().map(|it| it.0).collect();
            events.extend(
                own.nodes
                    .extract_if(|node, _| !kept.contains(node))
                    .map(|(node, it)| Event::Destroyed(id(node), it.role)),
            );
        }
        let (mut created, changed) = (
            FastSet::default(),
            update.nodes.iter().map(|it| it.0).collect::<Vec<_>>(),
        );
        for (node, mut new) in update.nodes {
            self.hosts.extend(new.frame().map(|it| (it, id(node))));
            match own.nodes.get(&node) {
                Some(old) => {
                    (new.parent, new.placement) = (old.parent, old.placement);
                    Self::compare(id(node), old, &new, &mut events);
                }
                None => {
                    created.insert(node);
                    events.extend((!is_first).then_some(Event::Created(id(node))));
                    events.extend(
                        (new.is_live() && !is_first).then_some(Event::LiveRegionCreated(id(node))),
                    );
                }
            }
            own.nodes.insert(node, new);
        }
        for node in changed {
            for index in 0..own.nodes[&node].children.len() {
                let child = own.nodes[&node].children[index];
                if let Some(child) = own.nodes.get_mut(&child) {
                    child.parent = node;
                }
            }
        }
        for placement in update.placements {
            if let Some(node) = own.nodes.get_mut(&placement.id) {
                node.placement = placement;
            }
        }

        if is_first {
            events.extend(self.host_of(tree).map(|parent| Event::ChildrenChanged {
                parent,
                added: vec![id(update.root)],
                removed: Vec::new(),
            }));
            events.extend(self.place_of(tree).map(|it| Event::RootsChanged(it.0)));
            events.extend(
                self.get(id(update.root))
                    .filter(|it| !it.has(abi::LOADING))
                    .map(|_| Event::Loaded(id(update.root))),
            );
        }
        self.find_live_changes(&created, &mut events);
        #[cfg(not(target_os = "macos"))]
        for (id, old) in hypertexts.into_iter().filter(|it| self.get(it.0).is_some()) {
            let new = self.hypertext(id);
            let caret = self
                .selection(tree)
                .and_then(|it| self.offset_in_hypertext(&new, it[1], false))
                .unwrap_or(0);
            let (at, deleted, inserted) = difference(&old, &new.text, caret);
            events.push(Event::HypertextChanged {
                id,
                at: old[..at].chars().count(),
                deleted: deleted.to_owned(),
                inserted: inserted.to_owned(),
            });
        }
        let mut was_edited = false;
        if let Some((field, old)) = edited.filter(|it| self.get(it.0).is_some()) {
            let new = self.field_text(field).text;
            if new != old {
                was_edited = true;
                let caret = self
                    .selection(tree)
                    .and_then(|it| self.field_text(field).offset_of(self, it[1]))
                    .unwrap_or(new.len());
                let (at, deleted, inserted) = difference(&old, &new, caret);
                events.push(Event::Edited {
                    field,
                    at,
                    deleted: deleted.to_owned(),
                    inserted: inserted.to_owned(),
                });
            }
        }
        self.check_focus(&mut events);
        if let Some(new) = self.selection(tree).filter(|_| selection_differs) {
            let follows_focus = had_focus != update.focus;
            let key = self
                .last_key
                .take()
                .filter(|it| !follows_focus && it.2.elapsed().as_millis() < 500);
            let (direction, granularity) = self.intent(key, old_selection, new);
            let within = self
                .closest(new[1].node, |it| it.has(abi::TEXT_FIELD))
                .unwrap_or(id(update.root));
            let (extends, was_extended) = (
                new[0] != new[1],
                old_selection.is_some_and(|it| it[0] != it[1]),
            );
            events.push(Event::SelectionChanged {
                within,
                extends,
                was_extended,
                direction,
                granularity,
                follows_focus,
                follows_edit: was_edited,
            });
        }
        events.extend(
            update
                .announcements
                .into_iter()
                .map(|(text, is_urgent)| Event::Announced {
                    tree,
                    text,
                    is_urgent,
                }),
        );
        events
    }
}

/// Where, what was deleted, and what was inserted. Of several answers, the one that ends at the caret.
fn difference<'a>(old: &'a str, new: &'a str, caret: usize) -> (usize, &'a str, &'a str) {
    let same = |it: &(char, char)| it.0 == it.1;
    let length = |it: (char, char)| it.0.len_utf8();
    let tail: usize = old
        .chars()
        .rev()
        .zip(new[caret..].chars().rev())
        .take_while(same)
        .map(length)
        .sum();
    let (old, new) = (&old[..old.len() - tail], &new[..new.len() - tail]);
    let head: usize = old
        .chars()
        .zip(new.chars())
        .take_while(same)
        .map(length)
        .sum();
    let (old, new) = (&old[head..], &new[head..]);
    let tail: usize = old
        .chars()
        .rev()
        .zip(new.chars().rev())
        .take_while(same)
        .map(length)
        .sum();
    (head, &old[..old.len() - tail], &new[..new.len() - tail])
}
