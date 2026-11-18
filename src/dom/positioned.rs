//! Absolutely positioned boxes.

use std::rc::Rc;

use crate::abi::Rect;
use crate::anchor::Anchored;
use crate::boxes::{BoxId, Kind, LayoutBox, VIEWPORT};
use crate::document::Document;
use crate::fragment::Breaks;
use crate::layout::{
    AutoSize, Claims, Output, Point, Room, Setting, auto_margins, margin, resolve, unit,
};
use crate::types::*;
use crate::values::Size;

/// The part of a box that is at its static position.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Edge {
    #[default]
    Near,
    Center,
    Far,
}

impl Edge {
    pub(crate) fn from(align: AlignName, is_reversed: bool) -> Edge {
        match (align, is_reversed) {
            (AlignName::Center, _) => Edge::Center,
            (AlignName::End | AlignName::LastBaseline, false) => Edge::Far,
            (AlignName::End | AlignName::LastBaseline, true) | (_, false) => Edge::Near,
            (_, true) => Edge::Far,
        }
    }

    pub(crate) fn opposite(self) -> Edge {
        match self {
            Edge::Near => Edge::Far,
            Edge::Center => Edge::Center,
            Edge::Far => Edge::Near,
        }
    }

    pub(crate) fn of(self, [near, far]: [f32; 2]) -> f32 {
        match self {
            Edge::Near => near,
            Edge::Center => (near + far) / 2.0,
            Edge::Far => far,
        }
    }
}

pub(crate) fn halves(free: f32) -> (f32, f32) {
    let half = unit(free / 2.0);
    (half, free - half)
}

struct Axis {
    /// The containing block, modified by the insets.
    range: [f32; 2],
    has_both_insets: bool,
    edge: Edge,
    align: Align,
    /// What is left of the containing block, or how much too little that is.
    room: [f32; 2],
}

impl LayoutBox {
    /// In both axes.
    pub(crate) fn has_insets(&self) -> bool {
        let l = &self.style.layout;
        [[&l.left, &l.right], [&l.top, &l.bottom]]
            .iter()
            .all(|it| it.iter().any(|it| matches!(it, Inset::Length(_))))
    }
}

impl Document {
    /// Those in `id` that nothing in between is the containing block of.
    fn collect_positioned(&self, id: BoxId, wanted: Claims, out: &mut Vec<BoxId>) {
        for child in &self.boxes[id].children {
            let it = &self.boxes[*child];
            let (wanted, kind) = (wanted - it.claimed_by_inline, it.out_of_flow());
            if wanted.intersects(kind) {
                out.push(*child);
            } else if kind.is_empty() && !self.is_spanner(*child) {
                self.collect_escapees(*child, wanted, out);
            }
        }
        if let (Kind::Columns, Some(flow)) = (self.boxes[id].kind, self.boxes[id].children.first())
        {
            let mut spanners = Vec::new();
            self.spanners_in(*flow, &mut spanners);
            spanners
                .into_iter()
                .for_each(|it| self.collect_escapees(it, wanted, out));
        }
    }

    fn collect_escapees(&self, id: BoxId, wanted: Claims, out: &mut Vec<BoxId>) {
        let it = &self.boxes[id];
        if wanted.intersects(it.cache.escapes()) || matches!(it.kind, Kind::Row | Kind::RowGroup) {
            let wanted = wanted - it.claims();
            self.collect_positioned(id, wanted, out);
            for hoisted in &it.hoisted {
                self.collect_escapees(
                    *hoisted,
                    wanted - self.boxes[*hoisted].claimed_by_inline,
                    out,
                );
            }
        }
    }

    pub(crate) fn lay_out_positioned(
        &mut self,
        id: BoxId,
        output: &mut Output,
        mut breaks: Option<&mut Breaks>,
    ) {
        let it = &mut self.boxes[id];
        it.forget_hoisted();
        if it.kind == Kind::Lines {
            return self.claim_by_inline_elements(id, output, breaks);
        }
        if it.splits_layers {
            self.claim_by_split_elements(id, output, breaks.as_deref_mut());
        }
        let claims = self.boxes[id].claims();
        if !output.escapes.intersects(claims) {
            return;
        }
        let mut found = Vec::new();
        self.collect_positioned(id, claims, &mut found);
        output.escapes -= claims;
        if let Some(height) = breaks.as_ref().and_then(|it| it.whole_height(id)) {
            self.boxes[id].layout.size.height = height;
        }
        let (area, rtl) = (self.client_box(id), self.boxes[id].style.is_rtl());
        output.escapes |= self.lay_out_all_in(id, found, claims, area, rtl, breaks);
    }

    /// For a child of `Lines`, or what is in it, in an inline element that is a containing block.
    pub(crate) fn lay_out_positioned_in_inline(
        &mut self,
        lines: BoxId,
        child: BoxId,
        claims: Claims,
        area: Rect,
        rtl: bool,
        breaks: Option<&mut Breaks>,
    ) -> Claims {
        let mut found = Vec::new();
        match self.boxes[child].out_of_flow().intersects(claims) {
            true => found.push(child),
            false => self.collect_escapees(child, claims, &mut found),
        }
        self.lay_out_all_in(lines, found, claims, area, rtl, breaks)
    }

    /// Returns what escapes from them.
    fn lay_out_all_in(
        &mut self,
        container: BoxId,
        mut found: Vec<BoxId>,
        claims: Claims,
        area: Rect,
        rtl: bool,
        mut breaks: Option<&mut Breaks>,
    ) -> Claims {
        let (mut index, mut escapes) = (0, Claims::empty());
        while let Some(child) = found.get(index).copied() {
            index += 1;
            let own = self.lay_out_out_of_flow(child, container, area, rtl, breaks.as_deref_mut());
            if own.escapes.intersects(claims) {
                self.collect_escapees(child, claims, &mut found);
            }
            escapes |= own.escapes - claims;
        }
        if !found.is_empty() {
            self.boxes[container].hoisted.append(&mut found);
        }
        escapes
    }

    /// Without what is around it, if that is enough to know where it and what is in it are.
    pub(crate) fn lay_out_alone(&mut self, id: BoxId) -> bool {
        let container = self.boxes[id].container;
        let block = &self.boxes[container];
        if block.kind == Kind::Lines
            || block.mode.is_vertical()
            || block.splits_layers
            || !self.boxes.pieces.is_empty()
        {
            return false;
        }
        let (area, rtl) = (self.client_box(container), block.style.is_rtl());
        self.lay_out_out_of_flow(id, container, area, rtl, None)
            .escapes
            .is_empty()
    }

    /// Whether nothing but its own contents and style, `area` and the static position say where it is.
    fn is_simply_positioned(&self, id: BoxId, container: BoxId) -> bool {
        let (it, block) = (&self.boxes[id], &self.boxes[container]);
        matches!(block.kind, Kind::Block | Kind::Flex)
            && [block.mode, block.turned, self.boxes[it.parent].mode]
                == [WritingMode::HorizontalTb; 3]
            && it.claimed_by_inline.is_empty()
            && !(block.is_cell() || block.splits_layers)
            && self.anchored.is_empty()
            && self.boxes.pieces.is_empty()
    }

    pub(crate) fn move_boxes(&mut self) {
        let mut last = None;
        for node in core::mem::take(&mut self.boxes_to_move) {
            let Some(id) = self
                .tree
                .contains(node)
                .then(|| self.own_box(node))
                .flatten()
            else {
                continue;
            };
            let Some(location) = self.new_location(id) else {
                if self.boxes[self.boxes[id].parent].kind == Kind::Lines {
                    self.mark_parent_rebuild(node);
                }
                self.repaint(node);
                self.relayout(node);
                continue;
            };
            let it = &mut self.boxes[id];
            it.layout.location = location;
            let (parent, container, position) = (it.parent, it.container, it.style.layout.position);
            if last.replace((parent, position)) != Some((parent, position)) {
                self.boxes.mark_moved(id, true);
                self.boxes.note_change(container);
                self.moved_boxes_in_scrollers.push(id);
            }
        }
    }

    /// If nothing else depends on `left` and `top`.
    pub(crate) fn new_location(&self, id: BoxId) -> Option<Point> {
        let it = &self.boxes[id];
        let (l, ([width, height], start)) = (&it.style.layout, it.cache.settled_in()?);
        let (Inset::Length(left), Inset::Length(top), Inset::Auto, Inset::Auto, Size::Length(_)) =
            (&l.left, &l.top, &l.right, &l.bottom, &l.width)
        else {
            return None;
        };
        ([
            &l.height,
            &l.min_width,
            &l.min_height,
            &l.max_width.0,
            &l.max_height.0,
        ]
        .iter()
        .all(|it| matches!(it, Size::Auto | Size::Length(_)))
            && it.style.is_out_of_flow()
            && matches!(it.kind, Kind::Block | Kind::Flex | Kind::Grid)
            && !it.cache.has_escapees()
            && !self.boxes.is_parked(id)
            && self.is_simply_positioned(id, it.container))
        .then(|| Point {
            x: start + resolve(left, width) + it.layout.margin.left,
            y: start + resolve(top, height) + it.layout.margin.top,
        })
    }

    /// Without its container. Returns what escapes from it.
    pub(crate) fn refresh_out_of_flow(&mut self, id: BoxId) -> Option<Claims> {
        let it = &self.boxes[id];
        let container = it.container;
        (it.style.is_out_of_flow()
            && it.cache.escapes().is_empty()
            && self.boxes[VIEWPORT].size() == self.environment.viewport
            && self.boxes[container].cache.is_current()
            && self.is_simply_positioned(id, container)
            && (self.boxes[container].hoisted.binary_search(&id).is_ok()
                || self.boxes[container].hoisted.contains(&id)))
        .then_some(())?;
        let (area, rtl, before) = (
            self.client_box(container),
            self.boxes[container].style.is_rtl(),
            it.cache.has_kept_style().then(|| it.cover()),
        );
        let escapes = self
            .lay_out_out_of_flow(id, container, area, rtl, None)
            .escapes;
        if let Some(before) = before.filter(|it| it.frame == self.boxes[id].cover().frame) {
            self.note_new_contents(id, &before);
            return Some(escapes);
        }
        self.boxes.mark_ink(id);
        self.boxes.note_change(container);
        self.moved_boxes_in_scrollers.push(id);
        Some(escapes)
    }

    /// Whether those that have their containing blocks outside of `id`, which stays as it is, could be laid out without those.
    pub(crate) fn refresh_escapees(&mut self, id: BoxId) -> bool {
        let mut found = Vec::new();
        self.collect_escapees(id, Claims::all(), &mut found);
        let is_known = |it: &BoxId| {
            self.boxes[self.boxes[*it].container].depth < self.boxes[id].depth
                && self.is_simply_positioned(*it, self.boxes[*it].container)
        };
        if self.boxes.has_lost_out_of_flow || !found.iter().all(is_known) {
            return false;
        }
        for it in found {
            let (container, before) = (self.boxes[it].container, self.boxes[it].cover().frame);
            if !self.boxes[container].cache.is_current() {
                continue;
            }
            let (area, rtl) = (
                self.client_box(container),
                self.boxes[container].style.is_rtl(),
            );
            if !self
                .lay_out_out_of_flow(it, container, area, rtl, None)
                .escapes
                .is_empty()
            {
                return false;
            }
            if before != self.boxes[it].cover().frame {
                self.boxes.mark_ink(it);
                self.boxes.note_change(container);
                self.moved_boxes_in_scrollers.push(it);
            }
        }
        true
    }

    fn lay_out_out_of_flow(
        &mut self,
        id: BoxId,
        container: BoxId,
        mut area: Rect,
        rtl: bool,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let setting = Setting::new(
            (area.width, Some(area.height)),
            [rtl, false, false, false],
            TextAlign::Start,
            Align::NORMAL,
        );
        let may_settle = area.x == area.y
            && breaks.is_none()
            && self.boxes[id].has_insets()
            && self.is_simply_positioned(id, container);
        if may_settle
            && self.boxes[id].container == container
            && let Some((_, _, output)) = self.settled(id, setting).filter(|it| it.0 == area.x)
        {
            return output;
        }
        let (mut origin, mut at) = ([0.0; 2], self.boxes[id].parent);
        while at != container && at != 0 {
            let location = self.boxes[at].layout.location;
            (origin, at) = (
                [origin[0] + location.x, origin[1] + location.y],
                self.boxes[at].container,
            );
        }
        let (mode, container_size) = (self.boxes[container].turned, self.boxes[container].size());
        let [x, y] = self.boxes[id].static_position;
        let mut static_position = mode.turn_position(
            [(origin[0] + x.0, x.1), (origin[1] + y.0, y.1)],
            container_size,
        );
        self.turn(id, mode);
        if self.boxes[container].kind == Kind::Grid {
            area = self.grid_area_of_positioned(container, id, area);
            if self.boxes[id].parent == container {
                static_position = [0, 1].map(|axis| {
                    (
                        static_position[axis].1.of(area.span(axis)),
                        static_position[axis].1,
                    )
                });
            }
        }
        let old = core::mem::replace(&mut self.boxes[id].container, container);
        self.boxes.has_lost_out_of_flow |= old != container && old != self.boxes[id].parent;
        let is_fixed = self.is_fixed_to_viewport(id);
        let (it, block, none) = (&self.boxes[id], &self.boxes[container], Anchored::default());
        let anchored = it.anchored.as_deref().unwrap_or(&none);
        if anchored.has_default
            && block.scrolls()
            && !is_fixed
            && area == self.client_box(container)
        {
            area = self.scrollable_containing_block(container);
        }
        if let Some(known) = self.anchored.get_mut(&it.node) {
            known.block = area.transformed(&mode.to_physical(container_size));
        }
        if matches!(block.kind, Kind::Grid | Kind::Lines) || block.splits_layers {
            self.containing_parts
                .insert(id, area.transformed(&mode.to_physical(container_size)));
        } else if !self.containing_parts.is_empty() {
            self.containing_parts.remove(&id);
        }
        let (original, reverses, has_area) = (area, mode.reverses(), anchored.area.is_some());
        let center = mode.turn_axes(anchored.center);
        let center = [0, 1].map(|axis| {
            Some(
                original.span(axis)[usize::from(reverses[axis])]
                    + if reverses[axis] {
                        -center[axis]?
                    } else {
                        center[axis]?
                    },
            )
        });
        let (edges, scrolls_into_view) = (
            mode.turn_axes(anchored.edges),
            mode.turn_axes(anchored.scrolls_into_view),
        );
        area = anchored
            .area
            .map_or(area, |it| area.shrunk(mode.turn_sides(&it)));
        let (style, size) = (Rc::clone(&it.style), [area.width, area.height]);
        let l = &style.layout;
        let parent = &self.boxes[it.parent];
        let is_in_column = parent.kind == Kind::Flex && parent.style.has_flex_columns();
        let swaps_alignment = is_in_column != (parent.mode.is_vertical() != mode.is_vertical());
        let insets = [(0, &l.left, &l.right), (1, &l.top, &l.bottom)].map(|(axis, start, end)| {
            let is_zero = has_area || center[axis].is_some();
            [start, end].map(|it| {
                if let Inset::Length(it) = it {
                    Some(resolve(it, size[axis]))
                } else {
                    is_zero.then_some(0.0)
                }
            })
        });
        let [horizontal, vertical] = [0, 1].map(|axis| {
            let (is_reversed, [near, far]) = (axis == 0 && rtl, area.span(axis));
            let mut align = [l.justify_self, l.align_self][axis];
            let (room, edge) = match insets[axis] {
                [None, None] => {
                    let (at, edge) = static_position[axis];
                    let half = (at - near).min(far - at);
                    align = [l.justify_self, l.align_self][axis ^ usize::from(swaps_alignment)];
                    let range = match edge {
                        Edge::Near => [at, far],
                        Edge::Center => [at - half, at + half],
                        Edge::Far => [near, at],
                    };
                    (range, edge)
                }
                [Some(start), None] => ([near + start, far], Edge::Near),
                [None, Some(end)] => ([near, far - end], Edge::Far),
                [Some(start), Some(end)] => {
                    let edge = match (edges[axis], center[axis]) {
                        (Some((edge, is_unsafe)), _) => {
                            align = Align(
                                AlignName::Start,
                                if is_unsafe {
                                    AlignmentSafety::Unsafe
                                } else {
                                    AlignmentSafety::Default
                                },
                            );
                            if reverses[axis] {
                                edge.opposite()
                            } else {
                                edge
                            }
                        }
                        (_, Some(_)) => {
                            align = Align(
                                AlignName::AnchorCenter,
                                [l.justify_self, l.align_self][axis].1,
                            );
                            Edge::Center
                        }
                        _ => Edge::from(
                            align.resolved(axis, is_reversed, it.starts_far(axis), 0.0),
                            is_reversed,
                        ),
                    };
                    ([near + start, far - end], edge)
                }
            };
            let has_both_insets = insets[axis][0].is_some() && insets[axis][1].is_some();
            let weak = if has_both_insets {
                Edge::from(AlignName::Start, is_reversed)
            } else {
                edge
            };
            let mut range = if room[1] < room[0] {
                [weak.of(room); 2]
            } else {
                room
            };
            if it.kind == Kind::Table && range[1] - range[0] > size[axis] {
                range[0] = edge.of([range[0], range[1] - size[axis]]);
                range[1] = range[0] + size[axis];
            }
            Axis {
                range,
                has_both_insets,
                edge,
                align,
                room,
            }
        });
        let is_unbounded = [0, 1].map(|axis| {
            if is_fixed {
                scrolls_into_view[axis]
            } else {
                block.scrolls()
            }
        });

        let mut margin = margin(&style, size[0]);
        let available = [&horizontal, &vertical].map(|it| it.range[1] - it.range[0]);
        let inside = [0, 1].map(|axis| Some((available[axis] - margin.sums()[axis]).max(0.0)));
        let mut room = Room {
            available: inside,
            basis: size.map(Some),
            height: None,
        };
        let [auto_width, auto_height] = [&horizontal, &vertical].map(|axis| match axis.align.0 {
            _ if !axis.has_both_insets => AutoSize::Fit,
            AlignName::Stretch => AutoSize::Stretch,
            AlignName::Auto | AlignName::Normal if it.kind != Kind::Table && !it.is_replaced() => {
                AutoSize::Fill
            }
            _ => AutoSize::Fit,
        });
        let width_comes_first = !it.has_auto_size(0) || auto_width != AutoSize::Fit;
        let stretches = it.has_auto_size(1)
            && (auto_height == AutoSize::Stretch
                || auto_height == AutoSize::Fill && !(it.ratio.is_some() && width_comes_first));
        if stretches {
            let edges = it.border_and_padding(size[0]).sums();
            room.height = it.styled_height(&room, edges, inside[1], None);
        }
        let width = self.resolve_width(id, &room, auto_width);
        if let Some(height) = room.height {
            room.height = Some(self.clamp_height(id, height, width, &room));
        }
        let mut input = self.input_for(id, width, &room);
        input.has_definite_width = auto_width != AutoSize::Fit && self.boxes[id].is_orthogonal();
        if self.boxes[id].kind == Kind::Table {
            input.stretch = room.height.or(input.stretch);
        }
        let output = self.lay_out(id, input, None);

        let [x, y] =
            [(0, &horizontal, width), (1, &vertical, output.height)].map(|(index, axis, size)| {
                let [mut start, mut end] = margin.along(index);
                let (mut free, is_reversed) =
                    (available[index] - size - start - end, index == 0 && rtl);
                let auto = if axis.has_both_insets && center[index].is_none() && !has_area {
                    auto_margins(&style, index)
                } else {
                    [false; 2]
                };
                match auto {
                    [true, true] if free >= 0.0 || index == 1 => (start, end) = halves(free),
                    [true, true] => *(if is_reversed { &mut start } else { &mut end }) = free,
                    [true, false] => start = free,
                    [false, true] => end = free,
                    [false, false] => {}
                }
                if auto != [false; 2] {
                    free = 0.0;
                }
                margin.set(index, [start, end]);
                let (is_safe, outer) = (
                    free < 0.0
                        && axis.align.is_safe()
                        && insets[index][0].is_some() == insets[index][1].is_some(),
                    size + start + end,
                );
                let edge = if is_safe {
                    Edge::from(AlignName::Start, is_reversed)
                } else {
                    axis.edge
                };
                let mut at = match center[index].filter(|_| !is_safe) {
                    Some(center) => center - unit(outer / 2.0),
                    None => axis.range[0] + unit(edge.of([0.0, free])),
                };
                if axis.has_both_insets
                    && !matches!(axis.align.0, AlignName::Auto | AlignName::Normal)
                    && !is_safe
                    && !axis.align.is_unsafe()
                {
                    let ([mut near, mut far], block) = (axis.range, original.span(index));
                    if free < 0.0 {
                        (near, far) = (near.min(block[0]), far.max(block[1]));
                        if is_unbounded[index] {
                            *(if is_reversed { &mut near } else { &mut far }) =
                                if is_reversed { f32::MIN } else { f32::MAX };
                        }
                    }
                    at = if is_reversed {
                        at.max(near).min(far - outer)
                    } else {
                        at.min(far - outer).max(near)
                    };
                }
                at + start
            });
        if let Some(known) = self.anchored.get_mut(&self.boxes[id].node) {
            let ([left, right], [top, bottom]) = (horizontal.room, vertical.room);
            let free = [
                y - margin.top - top,
                right - x - width - margin.right,
                bottom - y - output.height - margin.bottom,
                x - margin.left - left,
            ];
            (known.free, known.room) = (
                mode.physical_sides(&free),
                mode.turn_axes([right - left, bottom - top]),
            );
        }
        let layout = &mut self.boxes[id].layout;
        (layout.location, layout.margin) = (Point { x, y }, margin);
        if may_settle {
            self.note_settled(id, setting, original.x);
        }
        let is_static = insets[1] == [None; 2] || self.boxes[container].kind == Kind::Lines;
        let output = breaks
            .and_then(|it| self.fragment_out_of_flow(id, container, input, y, is_static, it))
            .unwrap_or(output);
        if mode.is_vertical() {
            self.settle(id, mode, container_size);
            self.turn(id, WritingMode::HorizontalTb);
        }
        output
    }
}
