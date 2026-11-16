//! https://drafts.csswg.org/css-overflow-5/#scroll-navigation

use std::rc::Rc;

use crate::abi::Rect;
use crate::boxes::{BoxId, Kind, VIEWPORT};
use crate::document::Document;
use crate::geometry::translation;
use crate::name::{Map, Name, name};
use crate::properties::{Id, Style};
use crate::selector::{Pseudo, ScrollPart, key};
use crate::tree::{DOCUMENT, Flags, Namespace, NodeId, State};
use crate::types::*;

/// Bits of `generated_by_rules`.
pub(crate) const MARKER_RULES: u8 = 1 << 4;
pub(crate) const BUTTON_RULES: u8 = 1 << 5;
pub(crate) const COLUMN_RULES: u8 = 1 << 6;
pub(crate) const COLUMN_MARKER_RULES: u8 = 1 << 7;

/// What the pseudo-classes of scroll markers are for pseudo-elements.
pub(crate) const TARGET_STATES: [(Name, State); 3] = [
    (name!(":target-before"), State::IN_RANGE),
    (name!(":target-current"), State::CHECKED),
    (name!(":target-after"), State::OUT_OF_RANGE),
];

/// In what is returned to JavaScript.
const TAG: NodeId = 1 << 30;
const MAX_COLUMNS: usize = 1000;

#[derive(Default)]
struct Parts {
    group: NodeId,
    /// Block start, inline start, inline end and block end.
    buttons: [NodeId; 4],
    marker: NodeId,
    /// With their markers.
    columns: Vec<[NodeId; 2]>,
    rules: u8,
}

#[derive(Default)]
struct Group {
    markers: Vec<NodeId>,
    current: NodeId,
    /// `current` stays until this is scrolled somewhere else.
    pinned_in: NodeId,
}

#[derive(Default)]
pub(crate) struct Carousels {
    /// By the element that they originate from.
    parts: Map<NodeId, Parts>,
    /// By `::scroll-marker-group`, or by the element with `scroll-target-group`.
    groups: Map<NodeId, Group>,
    group_of: Map<NodeId, NodeId>,
    hovered: [NodeId; 2],
    focused: NodeId,
}

impl Carousels {
    pub(crate) fn is_empty(&self) -> bool {
        self.parts.is_empty() && self.groups.is_empty()
    }

    pub(crate) fn has(&self, id: NodeId) -> bool {
        !self.parts.is_empty() && self.parts.contains_key(&id)
    }

    /// Those that others inherit from come first.
    pub(crate) fn parts_of(&self, id: NodeId) -> Vec<NodeId> {
        let Some(parts) = self.parts.get(&id) else {
            return Vec::new();
        };
        let all = [parts.group, parts.marker]
            .into_iter()
            .chain(parts.buttons)
            .chain(parts.columns.iter().flatten().copied());
        all.filter(|it| *it != 0).collect()
    }

    pub(crate) fn markers_of(&self, id: NodeId) -> Vec<NodeId> {
        let parts = self.parts.get(&id).into_iter();
        parts
            .flat_map(|it| {
                [it.marker]
                    .into_iter()
                    .chain(it.columns.iter().map(|it| it[1]))
            })
            .filter(|it| *it != 0)
            .collect()
    }

    pub(crate) fn markers_in(&self, group: NodeId) -> &[NodeId] {
        self.groups.get(&group).map_or(&[], |it| &it.markers)
    }

    pub(crate) fn unpin(&mut self, scroller: NodeId) {
        self.groups
            .values_mut()
            .filter(|it| it.pinned_in == scroller)
            .for_each(|it| it.pinned_in = 0);
    }

    pub(crate) fn forget(&mut self, id: NodeId) {
        if !self.is_empty() {
            self.groups.remove(&id);
            self.unpin(id);
            if let Some(group) = self
                .group_of
                .remove(&id)
                .and_then(|it| self.groups.get_mut(&it))
            {
                group.markers.retain(|it| *it != id);
                group.current *= u32::from(group.current != id);
            }
        }
        self.hovered
            .iter_mut()
            .chain([&mut self.focused])
            .filter(|it| **it == id)
            .for_each(|it| *it = 0);
    }
}

/// The side that each button stands for: top, right, bottom or left.
fn sides_of_buttons(style: &Style) -> [u8; 4] {
    let side = |axis: usize, is_end: bool| {
        let is_far = is_end != style.runs_back(axis);
        if (axis == 0) != style.text.writing_mode.is_vertical() {
            if is_far { 1 } else { 3 }
        } else if is_far {
            2
        } else {
            0
        }
    };
    [side(1, false), side(0, false), side(0, true), side(1, true)]
}

/// Along one axis, as if nothing were scrolled.
#[derive(Clone, Copy)]
struct Target {
    marker: NodeId,
    /// The scroll offset that brings it into view, whether or not it can be reached.
    offset: f32,
    span: [f32; 2],
}

fn closest(targets: &[Target], distance: impl Fn(&Target) -> f32) -> Vec<Target> {
    let least = targets.iter().map(&distance).fold(f32::INFINITY, f32::min);
    targets
        .iter()
        .copied()
        .filter(|it| distance(it) <= least)
        .collect()
}

/// `view` is where the scrollport is.
fn choose(targets: &[Target], at: f32, [min, max]: [f32; 2], view: [f32; 2]) -> Vec<Target> {
    if min == max {
        return targets.to_vec();
    }
    let reserved = ((view[1] - view[0]) / 8.0).min(max - min);
    let (is_at_start, is_at_end) = (at < min + reserved, at > max - reserved);
    let is_reserved = |it: &f32| {
        if is_at_start {
            *it < min + reserved
        } else {
            is_at_end && *it > max - reserved
        }
    };
    let mut offsets: Vec<_> = targets
        .iter()
        .map(|it| it.offset)
        .filter(is_reserved)
        .map(f32::floor)
        .collect();
    offsets.sort_by(f32::total_cmp);
    offsets.dedup();
    let progress = (at - if is_at_start { min } else { max - reserved }) / reserved;
    let chosen = match offsets
        .get(((progress * offsets.len() as f32) as usize).min(offsets.len().saturating_sub(1)))
    {
        Some(offset) => targets
            .iter()
            .copied()
            .filter(|it| it.offset.floor() == *offset)
            .collect(),
        None => closest(targets, |it| (it.offset - at).abs()),
    };
    let edge = usize::from(is_at_end);
    closest(&chosen, |it| (it.span[edge] - view[edge] - at).abs())
}

impl Document {
    fn scroll_part(&self, id: NodeId) -> Option<ScrollPart> {
        if let Pseudo::Scroll(part) = self.tree.element(id)?.pseudo {
            Some(part)
        } else {
            None
        }
    }

    fn origin_of_part(&self, id: NodeId) -> NodeId {
        self.tree.element(id).map_or(0, |it| it.originator)
    }

    /// With both of the names of a button.
    pub(crate) fn complete_pseudo(&self, id: NodeId, pseudo: Pseudo) -> Pseudo {
        let (Pseudo::Scroll(ScrollPart::Button(..)), Some(style)) =
            (pseudo, self.style_on_demand(id))
        else {
            return pseudo;
        };
        let mut all = (0..)
            .zip(sides_of_buttons(&style))
            .map(|(index, side)| Pseudo::Scroll(ScrollPart::Button(Some(index), Some(side))));
        all.find(|it| pseudo.selects(*it)).unwrap_or(pseudo)
    }

    fn keep_part(&mut self, id: NodeId, part: ScrollPart, old: NodeId, is_wanted: bool) -> NodeId {
        if !is_wanted {
            if old != 0 {
                self.mark_parent_rebuild(old);
                self.free_subtree(old);
            }
            return 0;
        }
        let tag = if let ScrollPart::Button(..) = part {
            "button"
        } else {
            ""
        };
        let new = if old == 0 {
            self.create_element(tag, Namespace::Html)
        } else {
            old
        };
        self.tree[new].scope = self.tree[id].scope;
        if let Some(element) = self
            .tree
            .element_mut(new)
            .filter(|it| it.pseudo != Pseudo::Scroll(part))
        {
            (element.pseudo, element.originator) = (Pseudo::Scroll(part), id);
            self.tree[new].set(Flags::REMATCH);
            self.pseudo_element_created(id, Pseudo::Scroll(part), new);
        }
        if part == ScrollPart::Group {
            self.carousels.groups.entry(new).or_default();
        }
        new
    }

    pub(crate) fn update_scroll_parts(&mut self, id: NodeId, style: &Style, rules: u8) {
        let has_group = style.other(Id::ScrollMarkerGroup) != "none"
            && (style.scrolls() || self.tree.is_root(id));
        let mut parts = self.carousels.parts.remove(&id).unwrap_or_default();
        parts.group = self.keep_part(id, ScrollPart::Group, parts.group, has_group);
        parts.marker = self.keep_part(
            id,
            ScrollPart::Marker,
            parts.marker,
            rules & MARKER_RULES != 0,
        );
        for (index, side) in sides_of_buttons(style).into_iter().enumerate() {
            parts.buttons[index] = self.keep_part(
                id,
                ScrollPart::Button(Some(index as u8), Some(side)),
                parts.buttons[index],
                rules & BUTTON_RULES != 0,
            );
        }
        if (parts.rules ^ rules) & (COLUMN_RULES | COLUMN_MARKER_RULES) != 0 {
            parts
                .columns
                .drain(..)
                .flatten()
                .for_each(|it| _ = self.keep_part(id, ScrollPart::Column, it, false));
            self.needs_layout = true;
        }
        parts.rules = rules;
        if has_group || rules >= MARKER_RULES {
            self.carousels.parts.insert(id, parts);
        }
    }

    pub(crate) fn drop_scroll_parts(&mut self, id: NodeId) {
        let parts = self.carousels.parts_of(id);
        parts
            .into_iter()
            .for_each(|it| _ = self.keep_part(id, ScrollPart::Group, it, false));
        self.carousels.parts.remove(&id);
    }

    pub(crate) fn register_target_group(&mut self, id: NodeId, style: &Style) {
        if style.other_if_set(Id::ScrollTargetGroup) == Some("auto") {
            self.carousels.groups.entry(id).or_default();
            self.needs_layout = true;
        } else if !self.carousels.is_empty()
            && self.scroll_part(id).is_none()
            && self.carousels.groups.contains_key(&id)
        {
            self.set_markers(id, Vec::new());
            self.carousels.groups.remove(&id);
            self.needs_layout = true;
        }
    }

    /// The column that a marker inherits from.
    pub(crate) fn column_of(&self, marker: NodeId) -> Option<NodeId> {
        Some(
            self.carousels
                .parts
                .get(&self.origin_of_part(marker))?
                .columns
                .iter()
                .find(|it| it[1] == marker)?[0],
        )
    }

    /// The node whose box has that of the pseudo-element, if it is not the one that it originates from.
    pub(crate) fn layout_parent_of_part(&self, id: NodeId) -> Option<NodeId> {
        match self.scroll_part(id)? {
            ScrollPart::Group | ScrollPart::Button(..)
                if self.tree.is_root(self.origin_of_part(id)) =>
            {
                None
            }
            ScrollPart::Group | ScrollPart::Button(..) => {
                Some(self.tree.flat_parent(self.origin_of_part(id)))
            }
            _ => Some(self.carousels.group_of.get(&id).copied().unwrap_or(0)),
        }
    }

    fn is_shown(&self, part: NodeId) -> bool {
        let has_content = |it: &Style| {
            matches!(it.rare.content, Content::Items(..))
                || self.scroll_part(part) == Some(ScrollPart::Group)
        };
        self.tree
            .style(part)
            .is_some_and(|it| it.display() != Display::None && has_content(it))
    }

    /// The pseudo-elements before or after the box of the element.
    pub(crate) fn parts_beside(&self, id: NodeId, after: bool) -> Vec<(NodeId, Rc<Style>)> {
        let (Some(parts), Some(style)) = (self.carousels.parts.get(&id), self.tree.style(id))
        else {
            return Vec::new();
        };
        let group = (style.other(Id::ScrollMarkerGroup).starts_with("after") == after)
            .then_some(parts.group);
        let all = parts
            .buttons
            .into_iter()
            .filter(|_| after)
            .chain(group)
            .filter(|it| self.is_shown(*it));
        all.filter_map(|it| Some((it, Rc::clone(self.tree.style(it)?))))
            .collect()
    }

    /// `contains` is whether the absolutely positioned and the fixed children scroll along.
    fn collect_markers(&self, id: NodeId, contains: [bool; 2], found: &mut Vec<NodeId>) {
        let columns = self
            .carousels
            .parts
            .get(&id)
            .map_or(&[][..], |it| &it.columns);
        found.extend(
            columns
                .iter()
                .map(|it| it[1])
                .filter(|it| self.is_shown(*it)),
        );
        for child in self.tree.flat_children(id).take_while(|_| {
            !self.skips_contents(id) && bun_core::StackCheck::init().is_safe_to_recurse()
        }) {
            let Some(style) = self
                .tree
                .style(child)
                .filter(|it| it.display() != Display::None)
            else {
                continue;
            };
            let (position, has_box) = (style.layout.position, style.display() != Display::Contents);
            if position == PositionKind::Absolute && !contains[0]
                || position == PositionKind::Fixed && !contains[1]
            {
                continue;
            }
            found.extend(
                self.carousels
                    .parts
                    .get(&child)
                    .map(|it| it.marker)
                    .filter(|it| has_box && self.is_shown(*it)),
            );
            if !style.scrolls() || child == self.overflow_source() {
                let fixed = contains[1] || has_box && style.contains_fixed();
                self.collect_markers(
                    child,
                    [
                        contains[0] || fixed || has_box && position != PositionKind::Static,
                        fixed,
                    ],
                    found,
                );
            }
        }
    }

    fn collect_links(&self, id: NodeId, found: &mut Vec<NodeId>) {
        for child in self
            .tree
            .flat_children(id)
            .take_while(|_| bun_core::StackCheck::init().is_safe_to_recurse())
        {
            if self
                .tree
                .style(child)
                .is_some_and(|it| it.display() != Display::None)
            {
                found.extend(self.target_of_link(child).map(|_| child));
                if !self.carousels.groups.contains_key(&child) {
                    self.collect_links(child, found);
                }
            }
        }
    }

    fn target_of_link(&self, link: NodeId) -> Option<NodeId> {
        let element = self
            .tree
            .element(link)
            .filter(|it| it.html_tag() == name!("a"))?;
        let id = Name::new(
            element
                .attribute(name!("href"))?
                .strip_prefix('#')?
                .as_bytes(),
        );
        self.tree
            .descendants(self.tree[link].scope)
            .find(|it| self.tree.element(*it).is_some_and(|it| it.id == id))
    }

    fn set_markers(&mut self, group: NodeId, markers: Vec<NodeId>) {
        let Some(known) = self
            .carousels
            .groups
            .get_mut(&group)
            .filter(|it| it.markers != markers)
        else {
            return;
        };
        let old = core::mem::replace(&mut known.markers, markers.clone());
        known.current *= u32::from(markers.contains(&known.current));
        for marker in old {
            if self.carousels.group_of.get(&marker) == Some(&group) {
                self.carousels.group_of.remove(&marker);
                self.set_target_state(marker, None);
            }
        }
        let is_generated = self.scroll_part(group).is_some();
        for marker in markers {
            self.carousels.group_of.insert(marker, group);
            if is_generated {
                self.tree.mark_style(marker, Flags::RECASCADE);
            }
        }
        if is_generated {
            self.mark_rebuild(group);
            self.counters_are_stale = true;
        }
    }

    /// Before the boxes are built.
    pub(crate) fn assign_markers(&mut self) {
        for group in self.carousels.groups.keys().copied().collect::<Vec<_>>() {
            let (scroller, mut markers) = (self.origin_of_part(group), Vec::new());
            match self.tree.style(scroller).filter(|_| self.is_shown(group)) {
                Some(style) => {
                    let fixed = style.contains_fixed();
                    self.collect_markers(
                        scroller,
                        [
                            fixed
                                || style.layout.position != PositionKind::Static
                                || self.tree.is_root(scroller),
                            fixed,
                        ],
                        &mut markers,
                    );
                }
                None if scroller == 0 => self.collect_links(group, &mut markers),
                None => {}
            }
            self.set_markers(group, markers);
        }
        self.update_style();
    }

    pub(crate) fn display_of_group_changed(&self, group: NodeId) {
        self.carousels
            .markers_in(group)
            .iter()
            .for_each(|it| self.tree.mark_style(*it, Flags::RECASCADE));
    }

    /// What flows through the columns of the element.
    fn flow_of_columns(&self, id: NodeId) -> Option<BoxId> {
        let own = self.own_box(id)?;
        let mut candidates = [own].into_iter().chain(
            self.boxes[own]
                .children
                .iter()
                .copied()
                .filter(|it| self.boxes[*it].node == 0),
        );
        let columns = &self.boxes[candidates.find(|it| self.boxes[*it].kind == Kind::Columns)?];
        columns
            .children
            .get(usize::from(columns.has_legend))
            .copied()
    }

    /// After layout.
    pub(crate) fn update_column_parts(&mut self) {
        let wanting = self
            .carousels
            .parts
            .iter()
            .filter(|it| it.1.rules >= COLUMN_RULES)
            .map(|it| (*it.0, it.1.columns.len(), it.1.rules));
        for (id, old, rules) in wanting.collect::<Vec<_>>() {
            let count = self
                .flow_of_columns(id)
                .and_then(|it| self.pieces(it))
                .map_or(0, |it| it.len().min(MAX_COLUMNS));
            for _ in old..count {
                let column = self.keep_part(id, ScrollPart::Column, 0, true);
                let marker = self.keep_part(
                    id,
                    ScrollPart::ColumnMarker,
                    0,
                    rules & COLUMN_MARKER_RULES != 0,
                );
                self.tree.mark_style(column, Flags::REMATCH);
                self.carousels
                    .parts
                    .get_mut(&id)
                    .into_iter()
                    .for_each(|it| it.columns.push([column, marker]));
            }
            let gone = self
                .carousels
                .parts
                .get_mut(&id)
                .map_or(Vec::new(), |it| it.columns.split_off(count));
            gone.into_iter()
                .flatten()
                .for_each(|it| _ = self.keep_part(id, ScrollPart::Column, it, false));
            self.needs_layout |= old != count;
        }
    }

    /// With the box that the rectangles are relative to.
    pub(crate) fn columns_of(&self, id: NodeId) -> impl Iterator<Item = (NodeId, BoxId, Rect)> {
        let (columns, flow) = (
            self.carousels
                .parts
                .get(&id)
                .map_or(&[][..], |it| &it.columns),
            self.flow_of_columns(id).unwrap_or(0),
        );
        columns
            .iter()
            .zip(self.pieces(flow).unwrap_or_default())
            .map(move |(it, piece)| (it[0], flow, piece.rect))
    }

    /// The node that a marker scrolls to, with where it is in a box.
    fn target_of(&self, marker: NodeId) -> Option<(NodeId, BoxId, Rect)> {
        if let Some(column) = self.column_of(marker) {
            return self
                .columns_of(self.origin_of_part(marker))
                .find(|it| it.0 == column);
        }
        let node = self
            .target_of_link(marker)
            .unwrap_or_else(|| self.origin_of_part(marker));
        let rects = self.local_rects(node);
        let at = rects.first()?.0;
        Some((
            node,
            at,
            rects
                .iter()
                .filter(|it| it.0 == at)
                .map(|it| it.1)
                .reduce(|a, b| a.union(&b))?,
        ))
    }

    fn scroller_of_group(&self, group: NodeId) -> Option<BoxId> {
        match self.origin_of_part(group) {
            0 => {
                let targets: Vec<_> = self
                    .carousels
                    .markers_in(group)
                    .iter()
                    .filter_map(|it| Some(self.target_of(*it)?.1))
                    .collect();
                let has_all = |scroller: &BoxId| {
                    targets
                        .iter()
                        .all(|it| self.boxes.containers(*it).any(|it| it == *scroller))
                };
                self.boxes
                    .containers(*targets.first()?)
                    .filter(|it| self.boxes[*it].scrolls())
                    .find(has_all)
            }
            root if self.tree.is_root(root) => Some(VIEWPORT),
            scroller => self.scroller(scroller),
        }
    }

    fn locate_target(&self, marker: NodeId, scroller: BoxId) -> Option<[Target; 2]> {
        let (node, at, rect) = self.target_of(marker)?;
        let matrix = multiply(
            &translation(self.scroll_offset(self.boxes[scroller].node)),
            &self.to_scroller(at, scroller)?,
        );
        let (style, container, view) = (
            self.tree.style(node)?,
            &self.boxes[scroller].style,
            self.optimal_viewing_region(scroller),
        );
        let rect = rect
            .transformed(&matrix)
            .shrunk(crate::scroll::scroll_margin(style).map(|it| -it));
        let align = crate::snap::physical_alignment(style, container, &rect, &view);
        let runs_back = container
            .text
            .writing_mode
            .turn_axes([container.runs_back(0), container.runs_back(1)]);
        Some([0, 1].map(|axis| {
            let (span @ [start, end], [near, far]) = (rect.span(axis), view.span(axis));
            let offset = match align[axis] {
                SnapAlign::Center => (start + end - near - far) / 2.0,
                SnapAlign::None if runs_back[axis] => end - far,
                SnapAlign::End => end - far,
                _ => start - near,
            };
            Target {
                marker,
                offset,
                span,
            }
        }))
    }

    fn choose_marker(&self, group: NodeId) -> Option<NodeId> {
        let scroller = self.scroller_of_group(group)?;
        let (at, range, view) = (
            self.intended_scroll_offset(self.boxes[scroller].node),
            self.scroll_range(scroller),
            self.client_box(scroller),
        );
        let mut targets: Vec<_> = self
            .carousels
            .markers_in(group)
            .iter()
            .filter_map(|it| self.locate_target(*it, scroller))
            .collect();
        let block = usize::from(!self.boxes[scroller].style.text.writing_mode.is_vertical());
        for axis in [block, 1 - block] {
            let chosen = choose(
                &targets.iter().map(|it| it[axis]).collect::<Vec<_>>(),
                at[axis],
                range[axis],
                view.span(axis),
            );
            let chosen: crate::name::Set<_> = chosen.into_iter().map(|it| it.marker).collect();
            targets.retain(|it| chosen.contains(&it[0].marker));
        }
        Some(targets.first()?[0].marker)
    }

    fn set_part_state(&mut self, id: NodeId, state: State, on: bool) {
        let toggled = self.tree.element(id).map_or(State::empty(), |it| {
            if on {
                state - it.state
            } else {
                state & it.state
            }
        });
        if !toggled.is_empty() {
            self.change_state(id, toggled);
        }
    }

    fn set_target_state(&mut self, marker: NodeId, order: Option<usize>) {
        for (index, (name, state)) in TARGET_STATES.into_iter().enumerate() {
            let on = order == Some(index);
            match self.tree.element_mut(marker) {
                Some(element) if element.is_generated() => self.set_part_state(marker, state, on),
                Some(element) if element.custom_states.contains(&name) != on => {
                    element.custom_states.retain(|it| *it != name);
                    element.custom_states.extend(on.then_some(name));
                    self.feature_changed(marker, key::custom_state(name));
                }
                _ => {}
            }
        }
    }

    fn set_current_marker(&mut self, group: NodeId, current: NodeId) {
        let Some(known) = self.carousels.groups.get_mut(&group) else {
            return;
        };
        let (old, markers) = (
            core::mem::replace(&mut known.current, current),
            known.markers.clone(),
        );
        let position = markers.iter().position(|it| *it == current);
        for (index, marker) in markers.into_iter().enumerate() {
            self.set_target_state(
                marker,
                position.map(|it| (index.cmp(&it) as i8 + 1) as usize),
            );
        }
        if old != current && old != 0 && old == self.carousels.focused {
            self.focus_part(current);
        }
        if old != current && self.scroll_part(group).is_some() && self.scroller(group).is_some() {
            self.scroll_into_view(current, [crate::scroll::Alignment::Nearest; 2], 0, true);
        }
    }

    /// The scroll container, and how far the button scrolls it.
    fn step_of_button(&self, button: NodeId) -> Option<(NodeId, [f32; 2])> {
        let Some(ScrollPart::Button(_, Some(side))) = self.scroll_part(button) else {
            return None;
        };
        let node = Some(self.origin_of_part(button))
            .filter(|it| !self.tree.is_root(*it))
            .unwrap_or(DOCUMENT);
        let client = self.client_box(self.scroller(node)?);
        let [width, height] = [client.width, client.height].map(|it| it * 0.875);
        Some((
            node,
            [[0.0, -height], [width, 0.0], [0.0, height], [-width, 0.0]][usize::from(side)],
        ))
    }

    /// After layout, and after scrolling.
    pub(crate) fn update_scroll_controls(&mut self) {
        for group in self.carousels.groups.keys().copied().collect::<Vec<_>>() {
            let known = &self.carousels.groups[&group];
            let current = if known.pinned_in != 0 && known.current != 0 {
                Some(known.current)
            } else {
                self.choose_marker(group)
            };
            self.set_current_marker(group, current.unwrap_or(0));
        }
        let buttons: Vec<_> = self
            .carousels
            .parts
            .values()
            .flat_map(|it| it.buttons)
            .filter(|it| *it != 0)
            .collect();
        for button in buttons {
            let is_enabled = self
                .step_of_button(button)
                .is_some_and(|(node, step)| self.can_scroll_by(node, step));
            self.set_part_state(button, State::ENABLED, is_enabled);
            self.set_part_state(button, State::DISABLED, !is_enabled);
        }
    }

    /// The marker of what is being scrolled to, or of what it is in, becomes the current one.
    pub(crate) fn pin_marker_around(&mut self, node: NodeId) {
        let around: Vec<_> = core::iter::once(node)
            .chain(self.tree.flat_ancestors(node))
            .filter_map(|it| Some(self.carousels.parts.get(&it)?.marker))
            .collect();
        let links = self
            .carousels
            .group_of
            .keys()
            .copied()
            .filter(|it| self.target_of_link(*it) == Some(node));
        let markers: Vec<_> = links.chain(around.into_iter().rev()).collect();
        markers.into_iter().for_each(|it| self.pin_marker(it));
    }

    fn pin_marker(&mut self, marker: NodeId) {
        let Some(group) = self.carousels.group_of.get(&marker).copied() else {
            return;
        };
        let scroller = self
            .scroller_of_group(group)
            .map_or(0, |it| self.boxes[it].node);
        self.carousels
            .groups
            .get_mut(&group)
            .into_iter()
            .for_each(|it| it.pinned_in = scroller);
        self.set_current_marker(group, marker);
    }

    fn focus_part(&mut self, part: NodeId) {
        let old = core::mem::replace(&mut self.carousels.focused, part);
        for (id, on) in [(old, false), (part, true)] {
            self.set_part_state(id, State::FOCUS | State::FOCUS_WITHIN, on);
            self.set_part_state(
                self.carousels.group_of.get(&id).copied().unwrap_or(0),
                State::FOCUS_WITHIN,
                on,
            );
        }
        self.set_part_state(old, State::FOCUS_VISIBLE, false);
    }

    /// The marker or the button under the pointer, tagged. `kind` is that of `scrollbar_mouse`.
    pub(crate) fn point_at_scroll_control(&mut self, kind: u8, point: [f32; 2]) -> NodeId {
        let node = self
            .nodes_at(point)
            .next()
            .filter(|_| kind != 3)
            .unwrap_or(0);
        let part = core::iter::once(node)
            .chain(self.tree.flat_ancestors(node))
            .take(2)
            .find(|it| self.scroll_part(*it).is_some())
            .unwrap_or(0);
        let hovered = [
            part,
            self.carousels.group_of.get(&part).copied().unwrap_or(0),
        ];
        let old = core::mem::replace(&mut self.carousels.hovered, hovered);
        old.into_iter()
            .filter(|it| !hovered.contains(it))
            .for_each(|it| self.set_part_state(it, State::HOVER | State::ACTIVE, false));
        hovered
            .into_iter()
            .for_each(|it| self.set_part_state(it, State::HOVER, true));
        if kind != 0 {
            self.set_part_state(part, State::ACTIVE, kind == 1);
        }
        if kind == 0 || part == 0 || self.scroll_part(part) == Some(ScrollPart::Group) {
            0
        } else {
            part | TAG
        }
    }

    /// The element that counts as focused in its place or, tagged, the one to go on from.
    fn activate_scroll_control(&mut self, part: NodeId) -> NodeId {
        if let Some((node, step)) = self
            .step_of_button(part)
            .filter(|(node, step)| self.can_scroll_by(*node, *step))
        {
            let from = self.intended_scroll_offset(node);
            self.scroll_to(node, [from[0] + step[0], from[1] + step[1]], 0, true);
            self.focus_part(part);
            return self.origin_of_part(part);
        }
        let Some(group) = self.carousels.group_of.get(&part).copied() else {
            return 0;
        };
        let scroller = self.scroller_of_group(group).unwrap_or(0);
        if let Some(target) = self.locate_target(part, scroller) {
            self.scroll_to(
                self.boxes[scroller].node,
                target.map(|it| it.offset),
                0,
                false,
            );
        }
        self.pin_marker(part);
        let owner = self.origin_of_part(group);
        if !self
            .tree
            .style(owner)
            .is_some_and(|it| it.other(Id::ScrollMarkerGroup).ends_with("tabs"))
        {
            return self.origin_of_part(part) | TAG;
        }
        self.focus_part(part);
        owner
    }

    /// `action`: 0 activate `part`, 1 activate what has the focus, 2 and 3 go to the previous and the next marker, 4 blur.
    pub(crate) fn control_scrolling(&mut self, action: u8, part: NodeId) -> NodeId {
        let focused = self.carousels.focused;
        let markers = self
            .carousels
            .markers_in(self.carousels.group_of.get(&focused).copied().unwrap_or(0));
        let part = match (action, markers.iter().position(|it| *it == focused)) {
            (0, _) => part,
            (1, _) => focused,
            (2 | 3, Some(index)) => {
                markers[(index + if action == 2 { markers.len() - 1 } else { 1 }) % markers.len()]
            }
            (4, _) => {
                self.focus_part(0);
                0
            }
            _ => 0,
        };
        let owner = self.activate_scroll_control(part);
        self.set_part_state(self.carousels.focused, State::FOCUS_VISIBLE, action != 0);
        owner
    }
}
