//! Computes the styles that are out of date, and marks what depends on them.

use std::rc::Rc;

use crate::boxes::Kind;
use crate::custom::Changed;
use crate::document::Document;
use crate::name::{Map, Name, name};
use crate::properties::{Id, Style};
use crate::selector::{Bloom, Pseudo};
use crate::theme::Look;
use crate::tree::{
    AFTER, BACKDROP, BEFORE, DOCUMENT, Data, Element, Flags, MARKER, Namespace, NodeId,
};
use crate::types::*;
use crate::values::Deps;

const MAX_DEPTH: usize = 512;

bitflags::bitflags! {
    /// What has changed above an element.
    #[derive(Clone, Copy)]
    pub(crate) struct Change: u8 {
        const REMATCH_ALL = 1;
        const RECASCADE_ALL = 1 << 1;
        const INHERITED = 1 << 2;
        const NOT_INHERITED = 1 << 3;
        const DISPLAY = 1 << 4;
        const BY_ANIMATION = 1 << 5;
    }
}

struct Traversal {
    bloom: Bloom,
    reparented: Map<(*const Style, *const ()), (Rc<Style>, Rc<Style>)>,
    replaced: Map<(*const Style, *const Style), [Rc<Style>; 3]>,
}

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    struct Damage: u16 {
        const PAINT = 1;
        const INK = 1 << 1;
        const LAYOUT = 1 << 2;
        const CONTENTS = 1 << 3;
        const PARENT = 1 << 4;
        const GENERATED = 1 << 5;
        const COUNTERS = 1 << 6;
        /// Which the layout of a table resolves if the borders collapse.
        const BORDER_COLOR = 1 << 7;
        /// With `INK`: what is where does not change.
        const STAYS = 1 << 8;
    }
}

fn damage(id: Id) -> Damage {
    let is_in = |first: Id, last: Id| (first as u16..=last as u16).contains(&(id as u16));
    match id {
        Id::Display
        | Id::Position
        | Id::Float
        | Id::Order
        | Id::ColumnCount
        | Id::ColumnWidth
        | Id::ColumnHeight
        | Id::ColumnSpan
        | Id::LineClamp
        | Id::BoxOrient
        | Id::WritingMode => Damage::PARENT | Damage::CONTENTS | Damage::LAYOUT | Damage::COUNTERS,
        Id::ScrollMarkerGroup => Damage::PARENT | Damage::CONTENTS | Damage::LAYOUT,
        Id::Content | Id::ListStyleType | Id::ListStyleImage | Id::ListStylePosition => {
            Damage::PARENT | Damage::CONTENTS | Damage::GENERATED
        }
        Id::CounterReset | Id::CounterIncrement | Id::CounterSet | Id::Quotes => Damage::COUNTERS,
        Id::UnicodeBidi | Id::TextOverflow => Damage::CONTENTS | Damage::LAYOUT,
        Id::ScrollbarColor
        | Id::ContentVisibility
        | Id::FrameSizing
        | Id::AnchorScope
        | Id::PositionVisibility
        | Id::PositionTryOrder
        | Id::ScrollSnapType
        | Id::ScrollSnapAlign
        | Id::ScrollSnapStop
        | Id::ScrollInitialTarget => Damage::LAYOUT,
        _ if is_in(Id::ScrollMarginTop, Id::ScrollPaddingLeft) => Damage::LAYOUT,
        Id::Color => Damage::PAINT | Damage::BORDER_COLOR,
        _ if is_in(Id::BorderTopColor, Id::BorderLeftColor) => Damage::PAINT | Damage::BORDER_COLOR,
        Id::BoxShadow
        | Id::OutlineWidth
        | Id::OutlineOffset
        | Id::OutlineStyle
        | Id::TextShadow
        | Id::Filter => Damage::INK | Damage::STAYS,
        Id::ZIndex | Id::ViewTransitionName | Id::BackdropFilter => Damage::INK,
        Id::BorderImageOutset
        | Id::BorderShape
        | Id::OffsetAnchor
        | Id::OffsetDistance
        | Id::OffsetPath
        | Id::OffsetPosition
        | Id::OffsetRotate
        | Id::TransformStyle
        | Id::PerspectiveOrigin
        | Id::WebkitTextStrokeWidth
        | Id::WebkitBoxReflect => Damage::INK,
        Id::FontLanguageOverride
        | Id::FontPalette
        | Id::FontSizeAdjust
        | Id::FontSynthesisSmallCaps
        | Id::FontVariantAlternates
        | Id::FontVariantEastAsian
        | Id::FontVariantEmoji
        | Id::FontVariantPosition
        | Id::HyphenateLimitChars
        | Id::MathDepth
        | Id::MathShift
        | Id::MathStyle
        | Id::TextEmphasisPosition
        | Id::TextEmphasisStyle
        | Id::TextFit
        | Id::ImageOrientation
        | Id::ObjectViewBox => Damage::CONTENTS | Damage::LAYOUT,
        _ if is_in(Id::FontFamily, Id::UserModify) => Damage::CONTENTS | Damage::LAYOUT,
        _ if is_in(Id::Display, Id::GridColumnEnd) => Damage::LAYOUT,
        _ if is_in(Id::Transform, Id::OverflowClipMargin) => Damage::INK,
        _ if is_in(Id::TransitionProperty, Id::AnimationRangeEnd) => Damage::empty(),
        _ => Damage::PAINT,
    }
}

pub(crate) fn only_repaints(id: Id) -> bool {
    (Damage::PAINT | Damage::INK | Damage::STAYS | Damage::BORDER_COLOR).contains(damage(id))
}

pub(crate) fn changes_ink(id: Id) -> bool {
    damage(id).contains(Damage::INK)
}

fn inherited_change(old: &Style, new: &Style) -> Change {
    let mut change = Change::empty();
    old.differences(new, |it| {
        change |= if it.is_inherited() {
            Change::INHERITED
        } else {
            Change::NOT_INHERITED
        }
    });
    change.set(
        Change::INHERITED,
        change.contains(Change::INHERITED)
            || (old.zoom, old.dark, old.metrics, old.font_id)
                != (new.zoom, new.dark, new.metrics, new.font_id),
    );
    change
}

const BASE: Flags = Flags::BASE_SELECT.union(Flags::BASE_OPTIONS);

impl Document {
    pub(crate) fn update_style(&mut self) {
        if self.smil.needs_update {
            self.update_smil();
        }
        self.update_directions();
        if core::mem::take(&mut self.locks.relevance_is_stale) {
            self.update_relevance();
        }
        if self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS)
            || self.styles.dependencies.get_mut().has_pending()
        {
            self.catch_up_with_compositor();
        }
        loop {
            while self.styles.dependencies.get_mut().has_pending() {
                self.styles
                    .dependencies
                    .get_mut()
                    .flush(&self.tree, &self.styles.has_results);
            }
            if !self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS) {
                break;
            }
            self.tree[DOCUMENT].unset(Flags::DIRTY_DESCENDANTS);
            let mut bloom = self.styles.bloom.take().unwrap_or_else(Bloom::new);
            bloom.begin_traversal(&self.tree);
            let mut traversal = Traversal {
                bloom,
                reparented: Map::default(),
                replaced: Map::default(),
            };
            let (root, initial) = (self.tree.root_element(), Rc::clone(&self.styles.initial));
            if root != 0 {
                self.restyle(root, &initial, Change::empty(), None, &mut traversal);
            }
            let others: Vec<_> = self.tree.next_elements(root).collect();
            for (id, parent) in others
                .into_iter()
                .zip(core::iter::repeat(self.tree.style(root).cloned()))
            {
                self.restyle(
                    id,
                    parent.as_ref().unwrap_or(&initial),
                    Change::INHERITED,
                    None,
                    &mut traversal,
                );
            }
            self.styles.bloom = Some(traversal.bloom);
            self.update_top_layer();
        }
        self.update_top_layer();
        if !self.marks.is_empty() {
            let count = self
                .styles
                .scopes
                .values()
                .map(|it| it.borrow().count_pseudos())
                .sum();
            if core::mem::replace(&mut self.marks.styled_pseudos, count) != count {
                self.forget_highlights();
            }
        }
        if !self.marks.restyled.is_empty() {
            let restyled = core::mem::take(&mut self.marks.restyled);
            self.update_highlights(&restyled);
        }
        if self.animations.names_are_stale {
            self.find_named_timelines();
            self.update_style();
        }
    }

    /// Whether the flags of the nodes now say which styles `update_style` would change.
    pub(crate) fn prepare_restyle(&mut self) -> bool {
        if self.smil.needs_update
            || !self.stale_directions.is_empty()
            || !self.leaving_top_layer.is_empty()
            || self.animations.names_are_stale
            || self.locks.relevance_is_stale
        {
            return false;
        }
        while self.styles.dependencies.get_mut().has_pending() {
            self.styles
                .dependencies
                .get_mut()
                .flush(&self.tree, &self.styles.has_results);
        }
        true
    }

    fn update_top_layer(&mut self) {
        if self.top_layer.is_empty() && self.leaving_top_layer.is_empty() {
            return;
        }
        let tree = &self.tree;
        let stays = |id: &NodeId| {
            tree.style(*id)
                .is_some_and(|it| it.rare.overlay == OverlayKind::Auto)
        };
        let (staying, left): (Vec<_>, Vec<_>) =
            self.leaving_top_layer.iter().copied().partition(stays);
        self.leaving_top_layer = staying;
        self.top_layer.retain(|it| !left.contains(it));
        let is_in = |id: &NodeId| !self.tree[*id].has(Flags::ANIMATED) || stays(id);
        let moving = self
            .top_layer
            .iter()
            .copied()
            .filter(|it| is_in(it) != self.tree[*it].has(Flags::TOP_LAYER));
        let moving: Vec<_> = moving
            .chain(
                left.into_iter()
                    .filter(|it| self.tree[*it].has(Flags::TOP_LAYER)),
            )
            .collect();
        for id in &moving {
            self.mark_rebuild(DOCUMENT);
            self.detach_box(*id);
            match self.tree[*id].has(Flags::TOP_LAYER) {
                true => self.tree[*id].unset(Flags::TOP_LAYER),
                false => self.tree[*id].set(Flags::TOP_LAYER),
            }
            self.tree.mark_style(*id, Flags::RECASCADE);
            self.mark_parent_rebuild(*id);
        }
        if !moving.is_empty() {
            self.update_style();
        }
    }

    fn reparent(&self, old: &Rc<Style>, parent: &Style, traversal: &mut Traversal) -> Rc<Style> {
        let key = (
            Rc::as_ptr(old),
            Rc::as_ptr(&parent.customs.inherited).cast(),
        );
        let known = traversal.reparented.entry(key).or_insert_with(|| {
            let customs = old
                .customs
                .reparented(&parent.customs, &self.styles.recent_customs);
            (
                Rc::clone(old),
                Rc::new(Style {
                    customs,
                    ..Style::clone(old)
                }),
            )
        });
        Rc::clone(&known.1)
    }

    fn restyle(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        mut change: Change,
        customs: Option<&Changed>,
        traversal: &mut Traversal,
    ) {
        let (flags, dirty_child) = (self.tree[id].flags.get(), self.tree[id].dirty_child.get());
        let Some(element) = self.tree.element(id) else {
            return;
        };
        if !flags.intersects(Flags::STYLE_DIRTY)
            && (change - Change::BY_ANIMATION).is_empty()
            && customs.is_none()
            && element.style.is_some()
        {
            return self.restyle_descendants(id, traversal);
        }
        self.tree[id].unset(Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS);
        if element.is_generated() && element.pseudo == Pseudo::None {
            return;
        }
        let (old_rules, old_base, old) = (
            element.rules.clone(),
            element.base_style.clone(),
            element.style.clone(),
        );
        if flags.contains(Flags::REMATCH_SUBTREE) {
            change |= Change::REMATCH_ALL;
        }
        if flags.contains(Flags::RECASCADE_SUBTREE) {
            change |= Change::RECASCADE_ALL;
        }
        // It may have another parent than the one that it inherited from.
        let moved = old
            .as_ref()
            .filter(|_| flags.contains(Flags::REMATCH_SUBTREE | Flags::RECASCADE_SUBTREE));
        let moved = moved.map(|it| Changed {
            names: it.customs.inherited_differences(&parent.customs),
            outer: customs,
        });
        let customs = moved.as_ref().filter(|it| !it.names.is_empty()).or(customs);
        let mut rematches = old_rules.is_none()
            || flags.contains(Flags::REMATCH)
            || change.contains(Change::REMATCH_ALL);
        let mut rules = match old_rules.as_ref().filter(|_| !rematches) {
            Some(rules) => Rc::clone(rules),
            None => {
                if self.tree[id].has(Flags::HAS_ANCHOR) && old.is_none() {
                    self.styles.has_results.get_mut().remove(&id);
                }
                self.match_rules(id, Some(traversal.bloom.update(&self.tree)), false)
            }
        };
        if !self.marks.styles.get_mut().is_empty() && self.marks.styles.get_mut().contains_key(&id)
        {
            self.marks.restyled.push(id);
        }
        let mut is_computed = true;
        let mut base = match &old_base {
            Some(old_base)
                if old_rules.as_ref().is_some_and(|it| Rc::ptr_eq(it, &rules))
                    && !flags.contains(Flags::RECASCADE)
                    && !change.intersects(
                        Change::RECASCADE_ALL | Change::INHERITED | Change::DISPLAY,
                    )
                    && !(change.contains(Change::NOT_INHERITED)
                        && old_base.deps.contains(Deps::PARENT))
                    && !customs.is_some_and(|it| rules.references_any(it)) =>
            {
                is_computed = false;
                match customs.is_none() {
                    true => Rc::clone(old_base),
                    false => self.reparent(old_base, parent, traversal),
                }
            }
            Some(old_base) => {
                let computed = self.compute_style(id, &rules, parent);
                match Rc::ptr_eq(&computed, old_base) {
                    true => computed,
                    false => {
                        let known = traversal
                            .replaced
                            .entry((Rc::as_ptr(old_base), Rc::as_ptr(&computed)));
                        let known = known.or_insert_with(|| {
                            let mut shared = Style::clone(&computed);
                            shared.groups.share_with(old_base);
                            if customs.is_none()
                                && shared.customs.differences(&old_base.customs).is_empty()
                            {
                                shared.customs.share_with(&old_base.customs);
                            }
                            [Rc::new(shared), Rc::clone(old_base), computed]
                        });
                        Rc::clone(&known[0])
                    }
                }
            }
            None => self.compute_style(id, &rules, parent),
        };
        if (self.has_base_selects || base.layout.appearance == Appearance::BaseSelect)
            && self.update_base_select(id, &base)
        {
            rules = self.match_rules(id, Some(traversal.bloom.update(&self.tree)), false);
            base = self.compute_style(id, &rules, parent);
            (is_computed, rematches) = (true, true);
            change |= Change::REMATCH_ALL;
        }
        if self.tree.is_root(id)
            && !self.tree[id].has(Flags::ANIMATED)
            && self.update_root_units(id, &base)
        {
            base = self.compute_style(id, &rules, parent);
            change |= Change::RECASCADE_ALL;
        }
        let mut is_provisional = false;
        if is_computed
            && (base.is_out_of_flow()
                || base.deps.contains(Deps::ANCHOR)
                || !self.anchored.is_empty())
        {
            is_provisional = self
                .anchored
                .get_mut(&id)
                .is_some_and(|it| core::mem::take(&mut it.is_unresolved));
            base = self.with_anchors(id, base);
        }
        let base_changed = !old_base.as_ref().is_some_and(|it| Rc::ptr_eq(it, &base));
        if (base_changed || flags.contains(Flags::KEYFRAMES_CHANGED)) && !is_provisional {
            self.tree
                .element_mut(id)
                .into_iter()
                .for_each(|it| it.rules = Some(Rc::clone(&rules)));
            self.start_animations(
                id,
                parent,
                old.as_deref().and(old_base.as_deref()),
                &base,
                change,
                flags,
                traversal,
            );
        }
        let new = match (
            &old,
            self.tree[id].has(Flags::ANIMATED) || flags.contains(Flags::REANIMATE),
        ) {
            (Some(old), false) if !base_changed => Rc::clone(old),
            (_, false) => self.animate(id, &rules, parent, &base),
            _ => {
                let animated = self.animate(id, &rules, parent, &base);
                self.with_animated_anchors(id, animated)
            }
        };
        if self.tree.is_root(id) && self.update_root_units(id, &new) {
            change |= Change::RECASCADE_ALL;
        }
        self.tree[id].unset(Flags::REANIMATE | Flags::CATCHES_UP | Flags::LAGS);
        if new.deps.intersects(Deps::VIEWPORT | Deps::CONTAINER) {
            self.viewport_users.insert(id);
        }
        if let Some(element) = self.tree.element_mut(id) {
            (element.rules, element.base_style, element.style) =
                (Some(rules), Some(base), Some(Rc::clone(&new)));
            element.generated_by_rules.take_if(|_| rematches);
        }

        if old
            .as_ref()
            .is_some_and(|it| !Rc::ptr_eq(it, &new) || change.contains(Change::RECASCADE_ALL))
        {
            self.container_changed(id, false);
        }
        let mut below = change & (Change::REMATCH_ALL | Change::RECASCADE_ALL);
        let mut changed_customs = customs;
        let own_customs;
        match &old {
            Some(old) if Rc::ptr_eq(old, &new) => changed_customs = None,
            Some(old) => {
                below |= self.apply_damage(
                    id,
                    old,
                    &new,
                    !base_changed && flags.contains(Flags::CATCHES_UP),
                );
                if !old.customs.has_same_locals(&new.customs) {
                    below |= Change::NOT_INHERITED;
                }
                if Rc::ptr_eq(&old.customs.inherited, &new.customs.inherited) {
                    changed_customs = None;
                } else {
                    own_customs = Changed {
                        names: old.customs.differences(&new.customs).into_iter().collect(),
                        outer: customs,
                    };
                    changed_customs = if own_customs.names.is_empty() {
                        customs
                    } else {
                        Some(&own_customs)
                    };
                }
                if change.contains(Change::BY_ANIMATION) || !base_changed {
                    below |= Change::BY_ANIMATION;
                }
            }
            None => self.first_style(id, &new),
        }
        if new.display() == Display::Contents {
            below |= change & Change::DISPLAY;
        }
        if new.display() == Display::None {
            if old.is_some_and(|it| it.display() != Display::None) {
                if self
                    .tree
                    .element(id)
                    .and_then(|it| it.base_style.as_ref())
                    .is_none_or(|it| it.display() == Display::None)
                {
                    self.cancel_css_animations(id);
                }
                self.detach_box(id);
                self.forget_styles_below(id);
                self.forget_lock(id);
                self.tree
                    .element_mut(id)
                    .into_iter()
                    .for_each(|it| it.scroll = [0.0; 2]);
            }
            return;
        }
        if rematches && new.scrolls() {
            self.update_scrollbar_style(id);
        }
        if rematches || base_changed || flags.contains(Flags::RECASCADE) {
            let matches_the_same = !rematches
                && !flags.contains(Flags::RECASCADE)
                && !self.tree[id].has(Flags::QUERIES_CONTAINER);
            self.update_generated(id, &new, matches_the_same, traversal);
        }
        let is_new = old.is_none_or(|it| it.display() == Display::None);
        self.restyle_children(
            id,
            &new,
            (flags, dirty_child),
            change,
            below,
            changed_customs,
            is_new,
            rematches,
            traversal,
        );
    }

    fn restyle_children(
        &mut self,
        id: NodeId,
        new: &Rc<Style>,
        (flags, dirty_child): (Flags, NodeId),
        change: Change,
        mut below: Change,
        changed_customs: Option<&Changed>,
        mut is_new: bool,
        rematches: bool,
        traversal: &mut Traversal,
    ) {
        let (missed_customs, shown);
        let (mut new, mut changed_customs) = (new, changed_customs);
        if self.tree[id].has(Flags::HAS_MISSED) {
            let (skips, has_parts) = (
                self.skips_contents(id),
                self.tree.element(id).is_some_and(|it| it.shadow_root != 0),
            );
            let Some(missed) = self.locks.missed.get_mut(&id) else {
                return;
            };
            missed.change |=
                below & (Change::REMATCH_ALL | Change::RECASCADE_ALL | Change::DISPLAY);
            core::iter::successors(changed_customs, |it| it.outer)
                .for_each(|it| missed.customs.extend(&it.names));
            if skips {
                if rematches && has_parts {
                    missed.change |= Change::REMATCH_ALL;
                }
                let generated = self
                    .tree
                    .element(id)
                    .filter(|_| rematches)
                    .map_or([0; 4], |it| it.generated);
                generated
                    .into_iter()
                    .filter(|it| *it != 0)
                    .for_each(|it| self.tree[it].set(Flags::REMATCH));
                return self.tree[id].set(Flags::DIRTY_DESCENDANTS);
            }
            below = core::mem::replace(&mut missed.change, Change::empty());
            let names = core::mem::take(&mut missed.customs);
            match missed.seen.take() {
                Some(seen) => {
                    if self.tree[id].has(Flags::SKIPPED) && !self.locks.wants_leaves {
                        shown = crate::lock::with_leaves_of(&seen, new);
                        new = &shown;
                    }
                    below |= inherited_change(&seen, new);
                    let differs = |it: &Name| {
                        seen.customs.inherited.get(*it) != new.customs.inherited.get(*it)
                    };
                    missed_customs = Changed {
                        names: names.into_iter().filter(differs).collect(),
                        outer: None,
                    };
                    changed_customs = (!missed_customs.names.is_empty()).then_some(&missed_customs);
                }
                None => is_new = true,
            }
            missed.seen = Some(Rc::clone(new));
            if !self.tree[id].has(Flags::SKIPPED) {
                self.forget_lock(id);
            }
        }
        let visits_all =
            is_new || !(below - Change::BY_ANIMATION).is_empty() || changed_customs.is_some();
        let generated = self.tree.element(id).map_or([0; 4], |it| it.generated);
        for child in generated.into_iter().filter(|it| *it != 0) {
            if rematches {
                self.tree[child].set(Flags::REMATCH);
            }
            let below = if rematches && Some(child) == self.transition_root() {
                below | Change::REMATCH_ALL
            } else {
                below
            };
            if visits_all || self.tree[child].has(Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS) {
                self.restyle(child, new, below, changed_customs, traversal);
                self.drop_if_empty(id, child);
            }
        }
        if self.carousels.has(id) {
            for child in self.carousels.parts_of(id) {
                if rematches {
                    self.tree[child].set(Flags::REMATCH);
                }
                let column = self
                    .column_of(child)
                    .and_then(|it| self.tree.style(it))
                    .cloned();
                self.restyle(
                    child,
                    column.as_ref().unwrap_or(new),
                    below | Change::RECASCADE_ALL,
                    changed_customs,
                    traversal,
                );
            }
        }
        if !visits_all && !flags.contains(Flags::DIRTY_DESCENDANTS) && !rematches
            || traversal.bloom.depth() > MAX_DEPTH
        {
            return;
        }
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let has_parts = rematches && element.shadow_root != 0;
        let is_dirty = |child: &NodeId| {
            let node = &self.tree[*child];
            node.element().is_some()
                && (visits_all
                    || has_parts
                    || node.has(Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS))
        };
        let children: smallvec::SmallVec<[NodeId; 8]> =
            match visits_all || rematches || dirty_child == 0 {
                true => self.tree.flat_children(id).filter(is_dirty).collect(),
                false => {
                    let is_child = self.tree[dirty_child].parent != 0
                        && self.tree.flat_parent(dirty_child) == id;
                    is_child
                        .then_some(dirty_child)
                        .into_iter()
                        .filter(is_dirty)
                        .collect()
                }
            };
        if children.is_empty() {
            return;
        }
        if has_parts
            && matches!(
                self.tree[element.shadow_root].data,
                Data::ShadowRoot {
                    user_agent: true,
                    ..
                }
            )
        {
            below |= Change::REMATCH_ALL;
        }
        let depth = traversal.bloom.depth();
        traversal.bloom.push(id);
        for child in children {
            let is_slotted = self.tree[child].slot != 0;
            let below = if is_slotted {
                below - (Change::REMATCH_ALL - change)
            } else {
                below
            };
            self.restyle(child, new, below, changed_customs, traversal);
        }
        traversal.bloom.truncate(depth);
    }

    /// Of an element that has not changed, and neither has anything above it.
    fn restyle_descendants(&mut self, mut id: NodeId, traversal: &mut Traversal) {
        let depth = traversal.bloom.depth();
        loop {
            let (node, child) = (&self.tree[id], self.tree[id].dirty_child.get());
            if child == 0
                || self.tree.flat_parent(child) != id
                || self.tree[child].has(Flags::STYLE_DIRTY)
                || self.tree[child].parent == 0
            {
                break;
            }
            node.unset(Flags::DIRTY_DESCENDANTS);
            traversal.bloom.push(id);
            id = child;
        }
        let flags = (self.tree[id].flags.get(), self.tree[id].dirty_child.get());
        self.tree[id].unset(Flags::DIRTY_DESCENDANTS);
        if let Some(style) = self
            .tree
            .style(id)
            .filter(|it| it.display() != Display::None)
            .cloned()
        {
            self.restyle_children(
                id,
                &style,
                flags,
                Change::empty(),
                Change::empty(),
                None,
                false,
                false,
                traversal,
            );
        }
        traversal.bloom.truncate(depth);
    }

    /// Whether they have changed.
    fn update_root_units(&mut self, id: NodeId, style: &Style) -> bool {
        let (layout, is_vertical) = (&style.layout, style.flow().is_vertical());
        let gutters = [ScrollbarGutter::STABLE, ScrollbarGutter::BOTH_EDGES]
            .map(|it| u8::from(layout.scrollbar_gutter.contains(it)));
        let count = |overflow, is_inline: bool| {
            u8::from(overflow == Overflow::Scroll).max(if is_inline {
                gutters[0] + gutters[1]
            } else {
                0
            })
        };
        let counts = [
            count(layout.overflow_y, !is_vertical),
            count(layout.overflow_x, is_vertical),
        ];
        let scrollbars = if counts == [0; 2]
            || self
                .pseudo_style(id, Pseudo::Scrollbar, Default::default())
                .is_some()
        {
            [0.0; 2]
        } else {
            counts.map(|it| f32::from(it) * self.scrollbar_size(id, style))
        };
        if (style.root_units(), scrollbars) == (self.environment.root_font, self.root_scrollbars) {
            return false;
        }
        (self.environment.root_font, self.root_scrollbars) = (style.root_units(), scrollbars);
        self.environment.generation += 1;
        self.styles.forget_values();
        true
    }

    fn start_animations(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        old: Option<&Style>,
        new: &Style,
        change: Change,
        flags: Flags,
        traversal: &mut Traversal,
    ) {
        let is_displayed = self
            .tree
            .style(id)
            .is_some_and(|it| it.display() != Display::None);
        let is_hidden_by_animation = !is_displayed
            && self.tree[id].has(Flags::ANIMATED)
            && old.is_some_and(|it| it.display() != Display::None);
        let was_rendered = (is_displayed || is_hidden_by_animation)
            && self.queries.fresh[..self.queries.laid_out]
                .binary_search(&id)
                .is_err();
        let takes_time = new.transition.duration.iter().any(|it| it.0 > 0.0);
        let inherited = |this: &Self| {
            if takes_time {
                this.inherited_after_transitions(id)
            } else {
                None
            }
        };
        let after = |this: &Self, parent: &Option<Rc<Style>>| {
            Some(this.compute_style(id, this.tree.element(id)?.rules.as_ref()?, parent.as_ref()?))
        };
        match old.filter(|_| was_rendered) {
            Some(_)
                if change.contains(Change::BY_ANIMATION)
                    && !flags.intersects(Flags::REMATCH | Flags::RECASCADE) => {}
            Some(old) => {
                let after =
                    after(self, &inherited(self)).filter(|_| !new.deps.contains(Deps::ANCHOR));
                self.update_transitions(id, old, after.as_deref().unwrap_or(new), parent);
            }
            None if new.display() != Display::None && takes_time && self.has_starting_styles() => {
                let (rules, inherited) = (
                    self.match_rules(id, Some(traversal.bloom.update(&self.tree)), true),
                    inherited(self),
                );
                let starting = self.compute_style(id, &rules, inherited.as_ref().unwrap_or(parent));
                if starting.display() != Display::None {
                    let after =
                        after(self, &inherited).filter(|_| !new.deps.contains(Deps::ANCHOR));
                    self.update_transitions(id, &starting, after.as_deref().unwrap_or(new), parent);
                }
            }
            None => {}
        }
        let is_animated = |style: &Style| style.animation.name.iter().any(|it| it.0.is_some());
        fn others(style: &Style) -> [Option<&str>; 2] {
            [Id::AnimationComposition, Id::AnimationTrigger].map(|it| style.other_if_set(it))
        }
        let changed = match old.filter(|_| was_rendered) {
            Some(old) => {
                old.animation != new.animation
                    || others(old) != others(new)
                    || flags.contains(Flags::KEYFRAMES_CHANGED)
            }
            None => is_animated(new),
        };
        if is_hidden_by_animation && new.display() == Display::None {
            self.cancel_css_animations(id);
        } else if changed && new.display() != Display::None {
            self.update_css_animations(id, new);
        }
    }

    fn register(&mut self, id: NodeId, style: &Style, old: Option<&Rc<Style>>) {
        let names_timelines = |style: &Style| {
            !style.scroll.timeline_name.is_empty()
                || [
                    Id::ViewTimelineName,
                    Id::TimelineScope,
                    Id::TimelineTriggerName,
                ]
                .iter()
                .any(|it| style.other_if_set(*it).is_some())
        };
        self.animations.names_are_stale |=
            names_timelines(style) || self.scrolling.timeline_sources.contains(&id);
        if !self.has_depth.get() && (style.effects.perspective.0.is_some() || style.has_depth()) {
            self.has_depth.set(true);
            self.boxes.forget_all_extents();
            self.pictures.discard();
        }
        if !style.paint.decoration_line.is_empty() {
            let length = |it: &Option<crate::values::Lp>| {
                it.as_ref()
                    .map_or(0.0, |it| it.resolve(style.font.size.0).abs())
            };
            let reach = length(&style.paint.decoration_thickness.0) * 4.0
                + length(&style.ink.underline_offset.0);
            if reach > self.decoration_reach.max(style.font.size.0) {
                self.decoration_reach = reach;
                self.boxes.forget_all_extents();
                self.pictures.discard();
            }
        }
        if style.effects.blend != Blend::Normal && self.outer_svg(id).is_some_and(|it| it != id) {
            self.blends_in_svg.set(true);
            self.pictures.discard();
        }
        for (set, is_member) in [
            (
                &mut self.containers,
                style
                    .layout
                    .container_type
                    .intersects(ContainerType::SIZE | ContainerType::INLINE_SIZE),
            ),
            (&mut self.anchors, !style.rare.anchor_name.is_empty()),
            (&mut self.scrolling.timeline_sources, names_timelines(style)),
        ] {
            _ = if is_member {
                set.insert(id)
            } else {
                set.remove(&id)
            };
        }
        match style
            .layout
            .container_type
            .contains(ContainerType::SCROLL_STATE)
        {
            true => _ = self.scrolling.states.entry(id).or_default(),
            false => _ = self.scrolling.states.remove(&id),
        }
        if matches!(style.rare.content, Content::Items(..)) || !self.replacements.is_empty() {
            self.update_replacement(id, style);
        }
        self.register_snapping(id, style);
        self.register_target_group(id, style);
        self.register_remembering(id, style);
        let (visibility, was_skipped) = (
            self.content_visibility(id, style),
            self.tree[id].has(Flags::SKIPPED),
        );
        let skips = match visibility {
            ContentVisibility::Auto if self.auto_visible.contains_key(&id) => was_skipped,
            ContentVisibility::Auto => self.auto_visible.insert(id, None).is_none(),
            _ => {
                self.auto_visible.remove(&id);
                visibility == ContentVisibility::Hidden
            }
        };
        match (was_skipped, skips) {
            (false, true) => self.lock(id, old.filter(|it| it.display() != Display::None).cloned()),
            (true, false) => self.unlock(id),
            _ => {}
        }
    }

    fn first_style(&mut self, id: NodeId, style: &Rc<Style>) {
        if !self.containers.is_empty() {
            self.queries.fresh.push(id);
        }
        self.register(id, style, None);
        self.id_changed(id);
        self.svg_changed(id);
        if style.display() != Display::None {
            self.mark_parent_rebuild(id);
        }
        if self.tree.element(id).is_some_and(Element::is_generated) {
            self.generate_content(id, style);
        }
    }

    /// Returns what the children have to know.
    fn apply_damage(
        &mut self,
        id: NodeId,
        old: &Rc<Style>,
        new: &Rc<Style>,
        is_shown: bool,
    ) -> Change {
        let (mut total, mut change, mut moves) = (Damage::empty(), Change::empty(), false);
        old.differences(new, |property| {
            let damage = damage(property);
            total |= damage - Damage::STAYS;
            moves |= damage.contains(Damage::INK) && !damage.contains(Damage::STAYS);
            let is_in =
                |first: Id, last: Id| (first as u16..=last as u16).contains(&(property as u16));
            if is_in(Id::Width, Id::Left)
                || is_in(Id::Transform, Id::Scale)
                || property == Id::Position
            {
                self.scrolling.repositioned.insert(id);
            }
            change |= if property.is_inherited() {
                Change::INHERITED
            } else {
                Change::NOT_INHERITED
            };
        });
        if (
            old.layout.container_type,
            &old.rare.container_name,
            old.queried_axes(),
        ) != (
            new.layout.container_type,
            &new.rare.container_name,
            new.queried_axes(),
        ) || !new.layout.container_type.is_empty() && old.flow() != new.flow()
        {
            self.mark_in_container(id, true, true);
        }
        if old.contain().contains(Contain::STYLE) != new.contain().contains(Contain::STYLE) {
            total |= Damage::COUNTERS;
        }
        if old.is_out_of_flow() != new.is_out_of_flow() {
            self.suppress_scroll_anchoring_around(id);
        }
        if (old.zoom, old.dark, old.metrics, old.font_id)
            != (new.zoom, new.dark, new.metrics, new.font_id)
        {
            (total, change) = (
                total | Damage::CONTENTS | Damage::LAYOUT,
                change | Change::INHERITED,
            );
        }
        if old.display() != new.display() || old.clamps_lines() != new.clamps_lines() {
            change |= Change::DISPLAY;
        }
        if (&old.layout.height, &old.layout.width) != (&new.layout.height, &new.layout.width)
            && self
                .tree
                .element(id)
                .is_some_and(|it| it.tag == name!("input"))
        {
            change |= Change::RECASCADE_ALL;
        }
        if old.look != new.look {
            total |= Damage::LAYOUT;
            change |= Change::REMATCH_ALL | Change::RECASCADE_ALL;
        }
        if old.layout.justify_items.is_legacy() != new.layout.justify_items.is_legacy() {
            change |= Change::RECASCADE_ALL;
        }
        if old.was_inline != new.was_inline {
            total |= Damage::PARENT;
        }
        if old.effects.will_change != new.effects.will_change
            || old.contains_fixed() != new.contains_fixed()
        {
            total |= Damage::LAYOUT;
        }
        if old.animates != new.animates
            || old.is_stacking_context(false) != new.is_stacking_context(false)
        {
            (total, moves) = (total | Damage::INK, true);
        }
        let own = self.own_box(id);
        if let Some(own) = own {
            self.boxes[own].style = if self.boxes[own].parent == crate::boxes::VIEWPORT {
                self.used_style(id, new)
            } else {
                Rc::clone(new)
            };
        }
        if total.is_empty() || is_shown {
            return change;
        }
        match old.paint.decoration_line.is_empty() && new.paint.decoration_line.is_empty() {
            true => self.repaint(id),
            false => self.repaint_subtree(id),
        }
        self.register(id, new, Some(old));
        self.svg_changed(id);
        if old.display() != new.display() && !self.carousels.is_empty() {
            self.display_of_group_changed(id);
        }
        self.counters_are_stale |= total.contains(Damage::COUNTERS);
        if total.contains(Damage::COUNTERS)
            && (new.display().is_list_item()
                || !old.rare.counter_reset.is_empty()
                || !new.rare.counter_reset.is_empty())
        {
            total |= Damage::PARENT | Damage::CONTENTS;
        }
        self.needs_layout |= self.counters_are_stale && !self.counter_users.is_empty();
        if total.contains(Damage::GENERATED)
            && self.tree.element(id).is_some_and(Element::is_generated)
        {
            self.generate_content(id, new);
        }
        let first_child = own.and_then(|it| self.boxes.all_children(it).first().copied());
        let has_pinned_styles = |it: &u32| {
            self.boxes[*it].inline.as_ref().is_some_and(|it| {
                it.first_line.is_some()
                    || it
                        .items
                        .iter()
                        .take(4)
                        .any(|it| it.has_own_style || it.node == 0)
            })
        };
        match own {
            Some(_) if first_child.as_ref().is_some_and(has_pinned_styles) => {
                total |= Damage::CONTENTS
            }
            None if has_pinned_styles(&self.tree[id].layout_box) => total |= Damage::CONTENTS,
            _ => {}
        }
        let Some(own) = own else {
            use crate::inline::is_layer;
            if !self.boxes.split.is_empty() && self.boxes.split.contains(&id) {
                let block = self.boxes[self.tree[id].layout_box].parent;
                self.boxes[block]
                    .children
                    .iter()
                    .for_each(|it| self.boxes[*it].forget_extents());
                self.boxes.mark_ink(block);
            }
            if total.intersects(
                !(Damage::PAINT | Damage::INK | Damage::COUNTERS | Damage::BORDER_COLOR),
            ) || is_layer(old) != is_layer(new)
            {
                self.mark_parent_rebuild(id);
            } else if total.contains(Damage::INK) {
                self.boxes.mark_ink(self.tree[id].layout_box);
            }
            return change;
        };
        let is_embedded = self.boxes[self.boxes[own].parent].kind == Kind::Lines;
        if total.contains(Damage::PARENT)
            || is_embedded && total.intersects(Damage::LAYOUT | Damage::CONTENTS)
        {
            self.mark_parent_rebuild(id);
        }
        if total.contains(Damage::CONTENTS) {
            self.mark_rebuild(id);
        }
        if total.intersects(Damage::LAYOUT | Damage::PARENT) {
            self.relayout(id);
        } else if total.contains(Damage::BORDER_COLOR)
            && new.text.border_collapse == BorderCollapse::Collapse
            && (self.boxes[own].collapsed.is_some()
                || matches!(
                    self.boxes[own].kind,
                    Kind::Row | Kind::RowGroup | Kind::Column
                ))
        {
            self.boxes.mark_layout(own);
            self.needs_layout = true;
        }
        if total.contains(Damage::INK) {
            self.boxes.mark_ink(own);
        }
        if total.contains(Damage::INK) && moves {
            self.layout_version += 1;
            self.sizes_version += u32::from(
                self.tree
                    .element(id)
                    .is_some_and(|it| it.namespace == crate::tree::Namespace::Svg),
            );
            self.needs_layout |= !self.anchored.is_empty();
            if old.has_transform() || new.has_transform() {
                self.moved_boxes.push(id);
            }
        }
        change
    }

    /// Whether other rules of the user agent apply now.
    fn update_base_select(&mut self, id: NodeId, style: &Style) -> bool {
        let Some(element) = self.tree.element(id) else {
            return false;
        };
        let is_base = style.layout.appearance == Appearance::BaseSelect;
        let (select, flags) = if element.html_tag() == name!("select") {
            let kept = self.tree[id].flags.get() & Flags::BASE_OPTIONS;
            let options = if Look::of(element) == Look::ListBox {
                Flags::BASE_OPTIONS
            } else {
                kept
            };
            (
                id,
                if is_base {
                    Flags::BASE_SELECT | options
                } else {
                    Flags::empty()
                },
            )
        } else if element.pseudo == Pseudo::Part(name!("picker(select)"))
            && self.tree[element.originator].has(Flags::BASE_SELECT)
        {
            (
                element.originator,
                if is_base { BASE } else { Flags::BASE_SELECT },
            )
        } else {
            return false;
        };
        let has_changed = self.tree[select].flags.get() & BASE != flags;
        self.has_base_selects |= is_base;
        self.tree[select].unset(BASE);
        self.tree[select].set(flags);
        has_changed
    }

    fn generated_in_base_select(&self, id: NodeId, element: &Element) -> Option<Pseudo> {
        let tag = element.html_tag();
        if tag == name!("select") {
            return (self.tree[id].has(Flags::BASE_SELECT) && Look::of(element) != Look::ListBox)
                .then_some(Pseudo::Part(name!("picker-icon")));
        }
        let select = self
            .tree
            .flat_ancestors(id)
            .take_while(|_| tag == name!("option"))
            .find(|it| self.tree.html_tag(*it) == name!("select"))?;
        self.tree[select]
            .has(Flags::BASE_OPTIONS)
            .then_some(Pseudo::Part(name!("checkmark")))
    }

    fn update_scrollbar_style(&mut self, id: NodeId) {
        if let Some(own) = self.own_box(id).filter(|it| self.boxes[*it].scrolls()) {
            self.repaint_box(own);
            let it = &self.boxes[own];
            if it.overflow != [Overflow::Hidden; 2]
                && self.scrollbar_size(id, &it.style) != it.scrollbar_size
            {
                self.relayout(id);
            }
        }
    }

    fn update_generated(
        &mut self,
        id: NodeId,
        style: &Style,
        matches_the_same: bool,
        traversal: &mut Traversal,
    ) {
        let Some(element) = self.tree.element(id).filter(|it| !it.is_generated()) else {
            return;
        };
        let (generated, tag) = (element.generated, element.html_tag());
        let has_contents = element.namespace != Namespace::Svg
            && !style.display().is_math()
            && !crate::name::is_name!(
                tag,
                "img" | "canvas" | "video" | "iframe" | "textarea" | "br" | "wbr"
            )
            && (tag != name!("select") || self.tree[id].has(Flags::BASE_SELECT))
            && (tag != name!("input") || !element.is_text_field());
        let known = element.generated_by_rules.filter(|_| matches_the_same);
        let by_rules = has_contents.then(|| {
            known.unwrap_or_else(|| {
                self.generated_by_rules(id, Some(traversal.bloom.update(&self.tree)))
            })
        });
        self.tree
            .element_mut(id)
            .into_iter()
            .for_each(|it| it.generated_by_rules = by_rules);
        let by_rules = by_rules.unwrap_or(0);
        if by_rules >= crate::carousel::MARKER_RULES
            || self.carousels.has(id)
            || style.other_if_set(Id::ScrollMarkerGroup).is_some()
        {
            self.update_scroll_parts(id, style, by_rules);
        }
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let generates = |index: usize| by_rules >> index & 1 != 0;
        let has_marker = style.display().is_list_item()
            && tag != name!("fieldset")
            && (style.text.list_type != ListStyleType::None
                || style.text.list_image.0.is_some()
                || generates(MARKER));
        let part = if self.has_base_selects {
            self.generated_in_base_select(id, element)
        } else {
            None
        };
        let mut generated = generated;
        if self.has_base_selects
            && self
                .tree
                .element(generated[MARKER])
                .is_some_and(|it| it.pseudo != part.unwrap_or(Pseudo::Marker))
        {
            self.drop_generated(id, core::mem::take(&mut generated[MARKER]));
        }
        let wanted = [
            (
                MARKER,
                part.unwrap_or(Pseudo::Marker),
                has_marker || part.is_some(),
            ),
            (BEFORE, Pseudo::Before, generates(BEFORE)),
            (AFTER, Pseudo::After, generates(AFTER)),
            (
                BACKDROP,
                Pseudo::Backdrop,
                self.tree[id].has(Flags::TOP_LAYER)
                    || Some(generated[BACKDROP]) == self.transition_root(),
            ),
        ];
        for (index, pseudo, is_wanted) in wanted {
            if is_wanted && generated[index] == 0 {
                let new = self.create_element("", Namespace::Html);
                self.tree[new].scope = self.tree[id].scope;
                self.tree
                    .element_mut(id)
                    .into_iter()
                    .for_each(|it| it.generated[index] = new);
                self.tree
                    .element_mut(new)
                    .into_iter()
                    .for_each(|it| (it.pseudo, it.originator) = (pseudo, id));
                self.tree[new].set(Flags::REMATCH);
                self.pseudo_element_created(id, pseudo, new);
            } else if !is_wanted && generated[index] != 0 {
                self.drop_generated(id, generated[index]);
            }
        }
    }

    fn drop_generated(&mut self, id: NodeId, generated: NodeId) {
        self.mark_rebuild(id);
        self.free_subtree(generated);
        let slots = self
            .tree
            .element_mut(id)
            .into_iter()
            .flat_map(|it| &mut it.generated);
        slots.filter(|it| **it == generated).for_each(|it| *it = 0);
    }

    fn drop_if_empty(&mut self, id: NodeId, generated: NodeId) {
        let Some(element) = self.tree.element(generated) else {
            return;
        };
        let is_empty = element.style.as_ref().is_some_and(|style| {
            match (&style.rare.content, element.pseudo) {
                (_, Pseudo::Backdrop | Pseudo::Transition(..)) | (Content::Items(..), _) => false,
                (Content::Normal, Pseudo::Marker) => {
                    style.text.list_type == ListStyleType::None && style.text.list_image.0.is_none()
                }
                _ => true,
            }
        });
        if is_empty {
            self.drop_generated(id, generated);
        }
    }
}
