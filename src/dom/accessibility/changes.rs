//! Which parts of the document have to be looked at again. The boxes know of what changes their looks or their layout.

use core::hash::{Hash, Hasher};

use super::aria::{Nodes, Reader};
use super::{Page, Sent};
use crate::document::Document;
use crate::name::{FastHasher, Map, Name, Set, name};
use crate::tree::{NodeId, Tree};

/// Something else than its own contents that the description of a node depends on.
pub(super) enum Source {
    /// In a scope.
    Id(NodeId, Name),
    Node(NodeId),
}

#[derive(Default)]
pub(super) struct Changes {
    nodes: Vec<NodeId>,
    ids: Vec<(NodeId, Name)>,
    /// `aria-hidden` has changed, which matters to names that are taken from below them.
    hiding: Set<NodeId>,
    are_too_many: bool,
    by_id: Map<(NodeId, Name), Nodes>,
    by_node: Map<NodeId, Nodes>,
    scrollers: Map<NodeId, [f32; 2]>,
    active_descendant: NodeId,
    /// Of what any node can depend on.
    surroundings: u64,
}

fn describe_again(
    document: &Document,
    node: NodeId,
    seen: &mut Set<NodeId>,
    mut also: impl FnMut(NodeId),
) {
    let tree = &document.tree;
    let mut at = if tree.contains(node) { node } else { 0 };
    while at != 0 && seen.insert(at) {
        document
            .own_box(at)
            .into_iter()
            .for_each(|it| document.boxes[it].painted.set_described(false));
        also(at);
        at = [tree.flat_parent(at), tree[at].parent, tree.host_of(at)]
            .into_iter()
            .find(|it| *it != 0)
            .unwrap_or(0);
    }
}

impl Changes {
    pub(super) fn touch(&mut self, node: NodeId) {
        self.are_too_many |= self.nodes.len() > 8192;
        if !self.are_too_many && self.nodes.last() != Some(&node) {
            self.nodes.push(node);
        }
    }

    pub(super) fn element_added(&mut self, node: NodeId) {
        if self.by_node.contains_key(&node) {
            self.touch(node);
        }
    }

    pub(super) fn hiding_changed(&mut self, node: NodeId) {
        self.hiding.insert(node);
    }

    pub(super) fn id_changed(&mut self, scope: NodeId, id: Name) {
        self.ids
            .extend(Some((scope, id)).filter(|it| self.by_id.contains_key(it)));
    }

    pub(super) fn node_freed(&mut self, tree: &Tree, node: NodeId) {
        let Some(element) = tree.element(node) else {
            return;
        };
        self.id_changed(tree[node].scope, element.id);
        self.by_node
            .remove(&node)
            .into_iter()
            .flatten()
            .for_each(|it| self.touch(it));
        self.scrollers.remove(&node);
    }

    pub(super) fn depends_on(&mut self, node: NodeId, sources: impl Iterator<Item = Source>) {
        for source in sources {
            let dependents = match source {
                Source::Id(scope, id) => self.by_id.entry((scope, id)).or_default(),
                Source::Node(source) => self.by_node.entry(source).or_default(),
            };
            if let Err(index) = dependents.binary_search(&node) {
                dependents.insert(index, node);
            }
        }
    }

    pub(super) fn is_scrolled(&mut self, node: NodeId, offset: [f32; 2]) {
        self.scrollers.insert(node, offset);
    }

    /// Returns whether the boxes now tell what has changed.
    pub(super) fn tell_boxes(
        &mut self,
        reader: &Reader,
        sent: &Sent,
        page: &Page,
        modal: NodeId,
        have_lost_track: bool,
    ) -> bool {
        let document = reader.document;
        let mut hasher = FastHasher::default();
        hasher.write(&document.base_url);
        (modal, reader.hash_of_owners()).hash(&mut hasher);
        let is_lost = core::mem::replace(&mut self.surroundings, hasher.finish())
            != self.surroundings
            || have_lost_track
            || self.are_too_many
            || document.has_depth.get()
            || !document.boxes.pieces.is_empty();
        let active = reader
            .referenced(page.focused, name!("aria-activedescendant"))
            .first()
            .copied()
            .unwrap_or(0);
        let was_active = core::mem::replace(&mut self.active_descendant, active);
        if is_lost {
            *self = Changes {
                active_descendant: active,
                surroundings: self.surroundings,
                ..Changes::default()
            };
            return false;
        }

        let mut dependents = Vec::new();
        if (sent.focused, was_active) != (page.focused, active) {
            dependents.extend([sent.focused, page.focused, was_active, active]);
        }
        dependents.extend(
            self.ids
                .drain(..)
                .filter_map(|it| self.by_id.remove(&it))
                .flatten(),
        );
        dependents.extend(
            self.scrollers
                .iter()
                .filter(|it| {
                    reader
                        .element(*it.0)
                        .is_some_and(|element| element.scroll != *it.1)
                })
                .map(|it| *it.0),
        );
        let hiding = core::mem::take(&mut self.hiding);
        let is_below = |it| {
            !hiding.is_empty()
                && document.tree.contains(it)
                && document
                    .tree
                    .flat_ancestors(it)
                    .any(|it| hiding.contains(&it))
        };
        dependents.extend(
            self.by_node
                .iter()
                .filter(|it| is_below(*it.0))
                .flat_map(|it| it.1),
        );
        let around: Vec<_> = self
            .by_node
            .iter()
            .map(|it| (&document.boxes[document.nearest_box(*it.0)].painted, it.1))
            .collect();
        dependents.extend(
            around
                .iter()
                .filter(|it| !it.0.is_checked())
                .flat_map(|it| it.1),
        );
        around.iter().for_each(|it| it.0.set_checked());

        let mut seen = Set::default();
        for node in self.nodes.drain(..) {
            describe_again(document, node, &mut seen, |it| {
                dependents.extend(self.by_node.get(&it).into_iter().flatten());
                match reader.tag(it) {
                    tag if tag == name!("label") => dependents.extend(reader.labelled_control(it)),
                    tag if tag == name!("input") => dependents.extend(reader.radio_group(it)),
                    _ => {}
                }
            });
        }
        dependents
            .into_iter()
            .for_each(|it| describe_again(document, it, &mut seen, |_| {}));
        true
    }
}
