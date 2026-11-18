//! The tree that assistive technologies see. Nothing here runs until one is listening.

mod aria;
mod build;
mod changes;
mod inspector;
pub(crate) mod remote;

use crate::abi::accessibility::{self as abi, Placement, Role};
use crate::document::Document;
use crate::name::{Map, Name, is_name, name};
use crate::selector::{filter, key};
use crate::tree::{DOCUMENT, NodeId, State, Tree};
use aria::Reader;
use build::{Builder, Output};
use changes::Changes;

/// What only the side of the scripts knows about an element.
#[derive(Default, PartialEq)]
pub(crate) struct Facts {
    pub(crate) is_clickable: bool,
    pub(crate) has_custom_error: bool,
    /// They can change without a sign, and are asked for each time.
    pub(crate) are_volatile: bool,
    /// The value, the minimum, the maximum and the step.
    pub(crate) numbers: [Option<f64>; 4],
    pub(crate) value: Option<Box<str>>,
    /// In the place of attributes.
    pub(crate) defaults: Vec<(Name, Box<str>)>,
    pub(crate) references: Vec<(Name, Vec<NodeId>)>,
}

/// What the library has been told about a node.
struct Known {
    id: u32,
    hash: u64,
    placement: Placement,
    update: u32,
    role: Role,
    children: Box<[u32]>,
    /// The hash of what is around it, if nothing else outside of its box matters to what is in it.
    valid_for: Option<u64>,
    ends_paragraph: bool,
}

pub(crate) struct Page<'a> {
    pub(crate) url: &'a str,
    pub(crate) focused: NodeId,
    pub(crate) is_loading: bool,
    pub(crate) selects_backwards: bool,
}

#[derive(Default)]
pub(crate) struct Accessibility {
    facts: Map<NodeId, Facts>,
    /// The elements whose facts have not been asked for, once those that were there at the start have been.
    unasked: Option<Vec<NodeId>>,
    has_urgent_news: bool,
    sent: Sent,
    changes: Changes,
    announcements: Vec<(Box<str>, bool)>,
}

#[derive(Default)]
struct Sent {
    known: Map<NodeId, Known>,
    /// Also of the nodes that something refers to, and that may not be in the tree.
    ids: Map<NodeId, u32>,
    nodes: Map<u32, NodeId>,
    last_id: u32,
    freed: Vec<u32>,
    /// They have been the children of a node that has changed.
    orphans: Vec<u32>,
    update: u32,
    focused: NodeId,
    focus: u32,
    selection: abi::Selection,
}

impl Sent {
    fn id_for(&mut self, node: NodeId) -> u32 {
        *self.ids.entry(node).or_insert_with(|| {
            self.last_id += 1;
            self.nodes.insert(self.last_id, node);
            self.last_id
        })
    }
}

impl Accessibility {
    pub(crate) fn element_added(&mut self, id: NodeId) {
        self.unasked.iter_mut().for_each(|it| it.push(id));
        self.changes.element_added(id);
    }

    pub(crate) fn contents_changed(&mut self, id: NodeId) {
        self.changes.touch(id);
    }

    /// With the old and the new id of the element.
    pub(crate) fn attribute_changed(
        &mut self,
        tree: &Tree,
        id: NodeId,
        name: Name,
        ids: [Name; 2],
    ) {
        self.changes.touch(id);
        ids.into_iter()
            .filter(|_| ids[0] != ids[1])
            .for_each(|it| self.changes.id_changed(tree[id].scope, it));
        if name == name!("aria-hidden") {
            self.changes.hiding_changed(id);
        }
        self.has_urgent_news |= is_name!(
            name,
            "aria-activedescendant"
                | "aria-busy"
                | "aria-checked"
                | "aria-expanded"
                | "aria-invalid"
                | "aria-live"
                | "aria-pressed"
                | "aria-selected"
                | "aria-valuenow"
                | "aria-valuetext"
                | "open"
                | "role"
        );
    }

    pub(crate) fn state_changed(&mut self, id: NodeId, changed: State) {
        if changed.intersects(!(State::HOVER | State::ACTIVE)) {
            self.changes.touch(id);
        }
        let urgent = State::CHECKED
            | State::INDETERMINATE
            | State::MODAL
            | State::OPEN
            | State::POPOVER_OPEN
            | State::TARGET
            | State::INVALID;
        self.has_urgent_news |= changed.intersects(urgent);
    }

    pub(crate) fn nodes_freed(&mut self, tree: &Tree, nodes: &[NodeId]) {
        for node in nodes {
            self.has_urgent_news |= *node == self.sent.focused;
            self.facts.remove(node);
            self.changes.node_freed(tree, *node);
            if let Some(id) = self.sent.ids.remove(node) {
                self.sent.nodes.remove(&id);
                if let Some(known) = self.sent.known.remove(node) {
                    self.sent.freed.push(id);
                    self.sent.orphans.extend(known.children);
                }
            }
        }
        for facts in self
            .facts
            .values_mut()
            .filter(|it| !it.references.is_empty())
        {
            facts
                .references
                .iter_mut()
                .for_each(|it| it.1.retain(|it| !nodes.contains(it)));
        }
    }
}

impl Document {
    /// The elements whose `Facts` are needed.
    pub(crate) fn elements_without_facts(&mut self, only_new: bool) -> Vec<NodeId> {
        let state = self.accessibility.get_or_insert_default();
        let mut wanted = state.unasked.replace(Vec::new()).unwrap_or_else(|| {
            let mut all = Vec::new();
            self.tree.visit_subtree(DOCUMENT, |id| all.push(id));
            all
        });
        wanted
            .iter()
            .filter_map(|it| Some((*it, self.tree.element(*it)?)))
            .for_each(|it| state.changes.id_changed(self.tree[it.0].scope, it.1.id));
        wanted.retain(|it| self.tree.element(*it).is_some() && self.tree.is_rendered(*it));
        let interrupts =
            |it: &str| matches!(it, "alert" | "alertdialog" | "dialog" | "listbox" | "menu");
        state.has_urgent_news |= wanted.iter().any(|it| {
            self.tree
                .element(*it)
                .and_then(|it| it.attribute(name!("role")))
                .is_some_and(interrupts)
        });
        for (id, element) in wanted
            .iter()
            .filter_map(|it| Some((*it, self.tree.element(*it)?)))
        {
            if is_name!(element.html_tag(), "input" | "label") {
                state.changes.touch(id);
            }
        }
        wanted.extend(
            state
                .facts
                .iter()
                .filter(|it| !only_new && it.1.are_volatile)
                .map(|it| *it.0),
        );
        wanted
    }

    pub(crate) fn set_facts(&mut self, id: NodeId, facts: Facts) {
        let state = self.accessibility.get_or_insert_default();
        let old = state.facts.get(&id);
        if old.map_or_else(|| facts != Facts::default(), |it| *it != facts) {
            state.has_urgent_news |= old.is_some();
            state.changes.touch(id);
            state.facts.insert(id, facts);
        }
    }

    pub(crate) fn forget_facts(&mut self, id: NodeId) {
        if let Some(state) = &mut self.accessibility {
            state.facts.remove(&id);
            state.changes.touch(id);
            state.element_added(id);
        }
    }

    pub(crate) fn announce_to_user(&mut self, text: &str, is_urgent: bool) {
        if let Some(state) = &mut self.accessibility {
            state.announcements.push((text.into(), is_urgent));
        }
    }

    /// Whether something has changed that the user is waiting to hear of.
    pub(crate) fn has_urgent_news(&self, focused: NodeId) -> bool {
        self.accessibility.as_ref().is_none_or(|it| {
            it.has_urgent_news || it.sent.update == 0 || it.sent.focused != focused
        })
    }

    pub(crate) fn set_screen_reader(&mut self, is_on: bool) {
        self.locks.are_open = is_on;
        self.locks.proximity_is_for = None;
    }

    /// It reads what is out of sight. Returns whether there was something to unlock.
    pub(crate) fn unlock_for_screen_reader(&mut self) -> bool {
        let mut has_unlocked = false;
        while self.locks.are_open && !self.auto_visible.is_empty() {
            self.update_layout();
            if !self.update_auto_visibility() {
                break;
            }
            has_unlocked = true;
        }
        has_unlocked
    }

    fn lay_out_around(&mut self, node: NodeId) {
        self.catch_up_with_compositor();
        self.update_layout_for(node);
    }

    pub(crate) fn update_accessibility(&mut self, surface: u32, page: &Page, only_focused: bool) {
        self.lay_out_around(page.focused);
        self.update_layout();
        self.update_marks();
        let mut state = self.accessibility.take().unwrap_or_default();
        let (is_first, old_focus, old_selection) = (
            state.sent.update == 0,
            state.sent.focus,
            state.sent.selection,
        );
        let looks_around = !only_focused
            || is_first
            || self.own_box(page.focused).is_some_and(|it| {
                self.is_typed_in(page.focused) && !self.boxes[it].painted.is_described()
            });
        let have_lost_track =
            is_first || looks_around && core::mem::take(&mut self.pictures.were_discarded);
        state.has_urgent_news &= !looks_around;
        let mut builder = Builder::new(
            Reader::new(self, &state.facts),
            &mut state.sent,
            &mut state.changes,
            page,
        );
        if looks_around {
            builder.walk(have_lost_track);
        }
        let mut out = builder.finish();
        state
            .announcements
            .drain(..)
            .for_each(|(text, is_urgent)| out.announce(&text, is_urgent));
        let sent = &state.sent;
        if let Some(renderer) = crate::platform::renderer()
            && (is_first
                || !out.is_empty()
                || (old_focus, old_selection) != (sent.focus, sent.selection))
        {
            let update = abi::Update {
                is_first,
                ..out.as_update(
                    self.environment.zoom,
                    sent.ids[&DOCUMENT],
                    sent.focus,
                    sent.selection,
                )
            };
            // SAFETY: `out` has what the slices point to.
            unsafe { (renderer.update_accessibility)(surface, &raw const update) };
        }
        self.accessibility = Some(state);
    }

    fn is_typed_in(&self, id: NodeId) -> bool {
        is_name!(self.tree.html_tag(id), "input" | "textarea")
            || self.tree.style(id).is_some_and(|it| it.is_editable())
    }

    pub(crate) fn accessible_node(&self, id: u32) -> NodeId {
        self.accessibility
            .as_ref()
            .and_then(|it| it.sent.nodes.get(&id))
            .copied()
            .unwrap_or(0)
    }

    pub(crate) fn accessible_point(&self, point: abi::Point) -> Option<[u32; 2]> {
        build::point_in_tree(self, self.accessible_node(point.node), point.offset)
            .map(|it| self.for_script(it))
    }

    fn read_aria<R>(&self, read: impl FnOnce(Reader) -> R) -> R {
        let none = Map::default();
        read(Reader::new(
            self,
            self.accessibility.as_ref().map_or(&none, |it| &it.facts),
        ))
    }

    pub(crate) fn computed_role_and_name(&mut self, id: NodeId) -> [String; 2] {
        self.lay_out_around(id);
        self.read_aria(|reader| match reader.is_hidden_above(id) {
            true => [Role::None.name().to_owned(), String::new()],
            false => [reader.role(id).name().to_owned(), reader.name(id).0],
        })
    }

    /// The `nodes` of `Accessibility.getFullAXTree`.
    pub(crate) fn inspect_accessibility(&mut self, page: &Page) -> Vec<u8> {
        self.lay_out_around(page.focused);
        self.update_layout();
        self.read_aria(|reader| {
            let (mut sent, mut changes) = (Sent::default(), Changes::default());
            let mut builder = Builder::new(reader, &mut sent, &mut changes, page);
            builder.walk_unnoticed();
            let out: Output = builder.finish();
            inspector::write(&out, &sent)
        })
    }

    fn title(&self) -> String {
        let title = self
            .tree
            .descendants_with(DOCUMENT, filter([key::tag(name!("title"))].into_iter()))
            .find(|it| self.tree.html_tag(*it) == name!("title"));
        let texts = title
            .into_iter()
            .flat_map(|it| self.tree.children(it))
            .filter_map(|it| self.tree[it].text());
        aria::collapsed(&texts.map(crate::values::text).collect::<String>())
    }
}
