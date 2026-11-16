//! What `content-visibility` skips keeps its styles and its boxes, out of date.

use std::rc::Rc;

use crate::boxes::{BoxId, Boxes, Kind};
use crate::document::Document;
use crate::name::{Map, Name, Set};
use crate::properties::{Id, Style};
use crate::restyle::Change;
use crate::tree::{DOCUMENT, Flags, Namespace, NodeId, State};
use crate::types::*;

/// What the children have not been told.
pub(crate) struct Missed {
    pub(crate) change: Change,
    pub(crate) customs: Set<Name>,
    /// The style that they have inherited from.
    pub(crate) seen: Option<Rc<Style>>,
}

/// Nothing else follows from it.
fn is_leaf(id: Id) -> bool {
    matches!(
        id,
        Id::Interactivity | Id::PointerEvents | Id::Cursor | Id::ContentVisibility
    )
}

pub(crate) fn with_leaves_of(seen: &Style, style: &Style) -> Rc<Style> {
    let mut shown = style.clone();
    seen.differences(style, |it| {
        if is_leaf(it) {
            shown.groups.set(&seen.get(it));
        }
    });
    shown.groups.share_with(seen);
    Rc::new(shown)
}

impl Missed {
    /// But for the leaves.
    pub(crate) fn has_seen(&self, style: &Style) -> bool {
        self.seen.as_ref().is_some_and(|seen| {
            let mut is_same = (seen.zoom, seen.dark, seen.metrics, seen.font_id)
                == (style.zoom, style.dark, style.metrics, style.font_id)
                && self
                    .customs
                    .iter()
                    .all(|it| seen.customs.inherited.get(*it) == style.customs.inherited.get(*it));
            seen.differences(style, |it| is_same &= is_leaf(it));
            is_same
        })
    }
}

#[derive(Default)]
pub(crate) struct Locks {
    pub(crate) missed: Map<NodeId, Missed>,
    /// Their contents are being looked at.
    forced: Vec<NodeId>,
    /// With `auto` in `contain-intrinsic-size`.
    pub(crate) remembering: Set<NodeId>,
    /// For how many more frames each counts as relevant, having been scrolled to.
    kept: Map<NodeId, u8>,
    /// The focus, the selection or the top layer has changed.
    pub(crate) relevance_is_stale: bool,
    pub(crate) wants_leaves: bool,
    /// The `layout_version`.
    pub(crate) proximity_is_for: Option<u32>,
}

#[derive(Default)]
pub(crate) struct Parked {
    pub(crate) children: Vec<BoxId>,
    pub(crate) outside_marker: BoxId,
    hoisted: Vec<BoxId>,
    /// The layout fits the box around them.
    pub(crate) fits: bool,
    /// Of that box, when they were laid out.
    size: Option<[f32; 2]>,
}

impl Boxes {
    /// Whether it is in a box that skips its contents.
    pub(crate) fn is_parked(&self, mut id: BoxId) -> bool {
        while !self.parked.is_empty() && id != 0 {
            id = self[id].parent;
            if self[id].is_parking {
                return true;
            }
        }
        false
    }

    /// Parked or not.
    pub(crate) fn all_children(&mut self, id: BoxId) -> &mut Vec<BoxId> {
        match self[id].is_parking {
            true => &mut self.parked.entry(id).or_default().children,
            false => &mut self[id].children,
        }
    }

    pub(crate) fn park(&mut self, id: BoxId, fits: bool) {
        let it = &mut self[id];
        if !core::mem::replace(&mut it.is_parking, true) {
            let (children, hoisted) = (
                core::mem::take(&mut it.children),
                core::mem::take(&mut it.hoisted),
            );
            let outside_marker = core::mem::take(&mut it.outside_marker);
            let size = (it.cache.is_current()
                && !it.cache.has_escapees()
                && !it.uses_parent[0]
                && !it.joins_formatting_context)
                .then(|| it.size());
            it.forget_extents();
            self.parked.insert(
                id,
                Parked {
                    children,
                    outside_marker,
                    hoisted,
                    fits,
                    size,
                },
            );
        }
    }

    /// Whether the layout fits.
    pub(crate) fn unpark(&mut self, id: BoxId) -> bool {
        let Some(parked) = self.parked.remove(&id) else {
            return true;
        };
        let it = &mut self[id];
        (it.children, it.outside_marker, it.hoisted, it.is_parking) = (
            parked.children,
            parked.outside_marker,
            parked.hoisted,
            false,
        );
        it.forget_extents();
        parked.fits
    }
}

impl Document {
    pub(crate) fn skips_contents(&self, id: NodeId) -> bool {
        self.tree[id].has(Flags::SKIPPED) && !self.locks.forced.contains(&id)
    }

    fn locks_around(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let ancestors = self
            .is_in_skipped_contents(id)
            .then(|| self.tree.flat_ancestors(id));
        ancestors
            .into_iter()
            .flatten()
            .filter(|it| self.tree[*it].has(Flags::SKIPPED))
    }

    pub(crate) fn is_in_skipped_contents(&self, id: NodeId) -> bool {
        !self.locks.missed.is_empty() && self.tree.is_in_skipped_contents(id)
    }

    /// Whether changing it has to wait.
    pub(crate) fn is_locked(&self, id: NodeId) -> bool {
        self.locks_around(id)
            .any(|it| !self.locks.forced.contains(&it))
    }

    pub(crate) fn content_visibility(&self, id: NodeId, style: &Style) -> ContentVisibility {
        let is_svg = self
            .tree
            .element(id)
            .is_some_and(|it| it.namespace == Namespace::Svg);
        match style.layout.content_visibility {
            ContentVisibility::Visible => ContentVisibility::Visible,
            it if !is_svg && style.display().can_skip_contents() => it,
            it if style.display().is_inline_box()
                && !is_svg
                && self.kind_of(id, style).is_some() =>
            {
                it
            }
            it if is_svg && style.display() != Display::None && self.outer_svg(id) == Some(id) => {
                it
            }
            _ => ContentVisibility::Visible,
        }
    }

    pub(crate) fn register_remembering(&mut self, id: NodeId, style: &Style) {
        let remembers = style.text.writing_mode.turn_axes([
            style.rare.intrinsic_width.remembers,
            style.rare.intrinsic_height.remembers,
        ]);
        _ = if remembers.contains(&true) {
            self.locks.remembering.insert(id)
        } else {
            self.locks.remembering.remove(&id)
        };
        if let Some(element) = self
            .tree
            .element_mut(id)
            .filter(|_| style.display() != Display::None)
        {
            element.remembered_size =
                [0, 1].map(|axis| element.remembered_size[axis].filter(|_| remembers[axis]));
        }
    }

    pub(crate) fn remember_sizes(&mut self) {
        for id in &self.locks.remembering {
            let Some(own) = self
                .own_box(*id)
                .filter(|it| !self.boxes[*it].is_skipped && !self.boxes.is_parked(*it))
            else {
                continue;
            };
            let ([.., width, height], it) = (self.content_box(own), &self.boxes[own]);
            let size = it.mode.turn_axes([
                it.style.rare.intrinsic_width.remembers.then_some(width),
                it.style.rare.intrinsic_height.remembers.then_some(height),
            ]);
            self.tree
                .element_mut(*id)
                .into_iter()
                .for_each(|it| it.remembered_size = size);
        }
    }

    /// Other than those that are near the viewport.
    pub(crate) fn relevant_nodes(&self) -> Set<NodeId> {
        let mut relevant: Set<_> = self.locks.kept.keys().copied().collect();
        for (positioned, state) in self
            .anchored
            .iter()
            .filter(|it| !self.is_in_skipped_contents(*it.0))
        {
            let is_between = |it: &NodeId| {
                !self
                    .tree
                    .flat_ancestors(*positioned)
                    .any(|around| around == *it)
            };
            relevant.extend(
                state
                    .anchors
                    .iter()
                    .flat_map(|it| self.tree.flat_ancestors(*it).take_while(is_between)),
            );
        }
        relevant.extend(
            self.top_layer
                .iter()
                .flat_map(|it| self.tree.flat_ancestors(*it)),
        );
        self.visit_selected(&mut |it| _ = relevant.insert(it));
        relevant
    }

    pub(crate) fn has_focus_within(&self, id: NodeId) -> bool {
        self.tree
            .element(id)
            .is_some_and(|it| it.state.contains(State::FOCUS_WITHIN))
    }

    pub(crate) fn relevance_changed(&mut self) {
        self.locks.relevance_is_stale = !self.auto_visible.is_empty();
        self.needs_frame |= self.locks.relevance_is_stale;
    }

    pub(crate) fn update_relevance(&mut self) {
        let relevant = self.relevant_nodes();
        let skips = |(id, is_near): (&NodeId, &Option<bool>)| {
            (
                *id,
                *is_near != Some(true) && !relevant.contains(id) && !self.has_focus_within(*id),
            )
        };
        let changed: Vec<_> = self
            .auto_visible
            .iter()
            .map(skips)
            .filter(|it| it.1 != self.tree[it.0].has(Flags::SKIPPED))
            .collect();
        changed
            .into_iter()
            .for_each(|(id, skips)| self.set_skipped(id, skips));
    }

    /// Whether it can be seen, once it has been scrolled to.
    pub(crate) fn unlock_around(&mut self, node: NodeId) -> bool {
        let locks: Vec<_> = self
            .tree
            .flat_ancestors(node)
            .filter(|it| self.tree[*it].has(Flags::HAS_MISSED | Flags::SKIPPED))
            .collect();
        if locks
            .iter()
            .any(|it| self.tree[*it].has(Flags::SKIPPED) && !self.auto_visible.contains_key(it))
        {
            return false;
        }
        for id in locks
            .into_iter()
            .filter(|it| self.auto_visible.contains_key(it))
        {
            self.locks.kept.insert(id, 3);
            self.locks.relevance_is_stale = true;
        }
        true
    }

    pub(crate) fn age_locks(&mut self) {
        self.needs_frame = !self.locks.kept.is_empty();
        self.locks.kept.retain(|_, frames| {
            *frames -= 1;
            *frames > 0
        });
    }

    /// `seen` is the style that the children know.
    pub(crate) fn lock(&mut self, id: NodeId, seen: Option<Rc<Style>>) {
        self.tree[id].set(
            Flags::SKIPPED | Flags::HAS_MISSED | Flags::DIRTY_DESCENDANTS | Flags::REBUILD_BELOW,
        );
        self.tree.forget_unskipped();
        self.tree[id].dirty_child.set(0);
        self.locks.missed.entry(id).or_insert(Missed {
            change: Change::empty(),
            customs: Set::default(),
            seen,
        });
        if let Some(own) = self.own_box(id) {
            self.boxes[own].is_skipped = true;
            self.boxes.park(own, false);
            if !self.auto_visible.contains_key(&id) {
                self.pictures.just_locked.push(id);
            }
        }
        self.lock_changed(id);
    }

    /// `restyle_children` has to follow.
    pub(crate) fn unlock(&mut self, id: NodeId) {
        self.tree[id].unset(Flags::SKIPPED);
        self.locks.forced.retain(|it| *it != id);
        if let Some(own) = self.own_box(id) {
            self.boxes[own].is_skipped = false;
            self.boxes.unpark(own);
        }
        self.resume(id);
        self.lock_changed(id);
    }

    fn lock_changed(&mut self, id: NodeId) {
        self.relayout(id);
        self.repaint(id);
        if self
            .top_layer
            .iter()
            .any(|it| self.tree.flat_ancestors(*it).any(|it| it == id))
        {
            self.mark_rebuild(DOCUMENT);
        }
    }

    fn resume(&mut self, id: NodeId) {
        self.tree.mark_ancestors(id, Flags::REBUILD_BELOW);
        let waiting = core::mem::take(&mut self.boxes.parked_stale);
        self.boxes.stale.extend(waiting);
        self.needs_layout = true;
    }

    pub(crate) fn forget_lock(&mut self, id: NodeId) {
        if self.tree[id].has(Flags::HAS_MISSED) {
            self.tree[id].unset(Flags::HAS_MISSED | Flags::SKIPPED);
            self.locks.missed.remove(&id);
            self.locks.forced.retain(|it| *it != id);
        }
    }

    /// Whether the style of the node is up to date but for the leaves, whatever else is not.
    fn knows_style(&mut self, node: NodeId) -> bool {
        if !self.prepare_restyle() {
            return false;
        }
        let is_settled = !self.needs_layout && !self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS);
        let (mut queries, mut is_unstyled) = (false, false);
        let elements = core::iter::once(node)
            .chain(self.tree.flat_ancestors(node))
            .take_while(|it| *it != DOCUMENT);
        for id in elements {
            let (flags, Some(style)) = (self.tree[id].flags.get(), self.tree.style(id)) else {
                (queries, is_unstyled) = (!self.containers.is_empty(), true);
                continue;
            };
            if flags.intersects(Flags::STYLE_DIRTY)
                || core::mem::take(&mut is_unstyled) && style.display() != Display::None
            {
                return false;
            }
            if id != node && self.skips_contents(id) {
                let is_told = self
                    .locks
                    .missed
                    .get(&id)
                    .is_some_and(|it| it.change.is_empty() && it.has_seen(style));
                if !is_told || queries && !self.has_settled_contents(id) {
                    return false;
                }
            }
            queries |= flags.contains(Flags::QUERIES_CONTAINER);
        }
        !is_unstyled && (!queries || is_settled)
    }

    pub(crate) fn update_skipped_values(&mut self, node: NodeId, properties: &[Id]) {
        if properties.iter().any(|it| is_leaf(*it)) {
            self.force_leaves(node);
        } else if !self.knows_style(node) {
            self.update_style_of(node);
        }
    }

    pub(crate) fn force_leaves(&mut self, node: NodeId) {
        self.stop_forcing();
        self.locks.wants_leaves = true;
        self.update_style_of(node);
        self.locks.wants_leaves = false;
    }

    fn has_settled_contents(&self, id: NodeId) -> bool {
        let dirty =
            Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS | Flags::REBUILD | Flags::REBUILD_BELOW;
        let parked = self
            .own_box(id)
            .and_then(|own| Some((self.boxes[own].size(), self.boxes.parked.get(&own)?.size?)));
        parked.is_some_and(|(now, then)| now == then)
            && self.boxes.parked_stale.is_empty()
            && self.boxes.stale.is_empty()
            && !self.tree[id].has(Flags::REBUILD)
            && !self
                .rendered_children(id)
                .any(|it| self.tree[it].has(dirty))
    }

    /// Until the next `stop_forcing`, the styles around the node are kept up to date, and so is the layout.
    pub(crate) fn force(&mut self, node: NodeId, update: fn(&mut Document)) {
        if !self.is_in_skipped_contents(node) {
            self.stop_forcing();
        }
        update(self);
        while let Some(id) = self
            .locks_around(node)
            .filter(|it| !self.locks.forced.contains(it))
            .last()
        {
            self.locks.forced.push(id);
            let dirty = Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS;
            let missed = self.locks.missed.get(&id).zip(self.tree.style(id));
            let has_seen = missed.is_some_and(|(missed, style)| missed.has_seen(style));
            if !has_seen
                || self.locks.wants_leaves
                || missed.is_some_and(|it| !it.0.change.is_empty())
                || self
                    .rendered_children(id)
                    .any(|it| self.tree[it].has(dirty))
            {
                self.tree.mark_style(id, Flags::DIRTY_DESCENDANTS);
            } else {
                self.tree[id].unset(Flags::DIRTY_DESCENDANTS);
            }
            let has_new_boxes = self.tree[id].has(Flags::REBUILD)
                || self
                    .rendered_children(id)
                    .any(|it| self.tree[it].has(Flags::REBUILD | Flags::REBUILD_BELOW));
            let own = self.own_box(id).unwrap_or(0);
            let has_kept_size = has_seen
                && self
                    .boxes
                    .parked
                    .get(&own)
                    .is_some_and(|it| it.size == Some(self.boxes[own].size()));
            let fits = self.boxes.unpark(own) || has_kept_size;
            if !fits {
                self.boxes.mark_contents(own);
            }
            match !fits
                || has_new_boxes
                || !self.boxes.parked_stale.is_empty()
                || !self.boxes.stale.is_empty()
            {
                true => self.resume(id),
                false => self.tree[id].unset(Flags::REBUILD_BELOW),
            }
            update(self);
        }
    }

    pub(crate) fn stop_forcing(&mut self) {
        for id in core::mem::take(&mut self.locks.forced) {
            self.tree[id].set(Flags::DIRTY_DESCENDANTS | Flags::REBUILD_BELOW);
            self.tree[id].dirty_child.set(0);
            if let Some(own) = self.own_box(id) {
                let fits = self.boxes[own].cache.is_current();
                self.boxes.park(own, fits);
                if self.boxes[own].is_cell() || self.boxes[own].kind == Kind::Grid {
                    self.relayout(id);
                }
            }
        }
    }
}
