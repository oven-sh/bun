//! Scroll snapping.

use crate::abi::{Matrix, Rect};
use crate::boxes::BoxId;
use crate::document::Document;
use crate::inline::ItemKind;
use crate::order::Order as _;
use crate::properties::{Id, Style};
use crate::scroll::{Alignment, scroll_margin};
use crate::tree::{DOCUMENT, NodeId, State};
use crate::types::*;
use crate::values::Pair;

#[derive(PartialEq)]
struct Area {
    node: NodeId,
    rect: Rect,
    align: [SnapAlign; 2],
    stops: bool,
}

/// Physical, and as if nothing were scrolled.
#[derive(Default, PartialEq)]
struct Container {
    axes: [bool; 2],
    is_mandatory: bool,
    is_vertical: bool,
    view: Rect,
    range: [[f32; 2]; 2],
    areas: Vec<Area>,
}

#[derive(Default)]
pub(crate) struct Snapping {
    laid_out: Container,
    /// What it follows when the layout changes.
    targets: [NodeId; 2],
    /// As of the last `scrollsnapchanging` and `scrollsnapchange`.
    announced: [[NodeId; 2]; 2],
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Intent {
    /// Along the axes.
    End([bool; 2]),
    /// To stay with the targets.
    Targets,
    Direction,
    EndAndDirection,
}

#[derive(Clone, Copy)]
struct Search {
    intent: Intent,
    from: [f32; 2],
    to: [f32; 2],
    only_stops: bool,
}

#[derive(Clone, Copy)]
struct Found {
    offset: f32,
    /// The offsets along the other axis at which the area can be seen.
    visible: [f32; 2],
    area: usize,
    /// One that is aligned just as well, and along the other axis at that offset.
    alternative: Option<(usize, f32)>,
}

struct Snapper<'a> {
    container: &'a Container,
    targets: [NodeId; 2],
    /// By area.
    has_focus: Vec<bool>,
    targeted: Option<usize>,
}

impl Search {
    fn is_directional(&self) -> bool {
        matches!(self.intent, Intent::Direction | Intent::EndAndDirection)
    }

    fn base(&self) -> [f32; 2] {
        if self.intent == Intent::Direction {
            self.from
        } else {
            self.to
        }
    }

    fn snaps(&self, axis: usize) -> bool {
        match self.intent {
            Intent::End(axes) => axes[axis],
            Intent::Targets => true,
            _ => self.to[axis] != self.from[axis],
        }
    }

    fn accepts(&self, axis: usize, offset: f32) -> bool {
        !self.is_directional()
            || (offset - self.from[axis]) * (self.to[axis] - self.from[axis]).signum() >= 1.0
    }
}

fn see_each_other(a: &Found, b: &Found) -> bool {
    let sees = |a: &Found, b: &Found| b.offset >= a.visible[0] && b.offset <= a.visible[1];
    sees(a, b) && sees(b, a)
}

fn encloses(outer: &Rect, inner: &Rect) -> bool {
    outer != inner && outer.union(inner) == *outer
}

impl Snapper<'_> {
    fn clamp(&self, axis: usize, offset: f32) -> f32 {
        offset
            .min(self.container.range[axis][1])
            .max(self.container.range[axis][0])
    }

    fn aligned(&self, axis: usize, area: usize) -> Found {
        let (it, view) = (&self.container.areas[area], &self.container.view);
        let ([start, end], [near, far]) = (it.rect.span(axis), view.span(axis));
        let offset = match it.align[axis] {
            SnapAlign::End => end - far,
            SnapAlign::Center => (start + end - near - far) / 2.0,
            _ => start - near,
        };
        let ([start, end], [near, far]) = (it.rect.span(1 - axis), view.span(1 - axis));
        let visible = [start - far, end - near].map(|it| self.clamp(1 - axis, it));
        Found {
            offset: self.clamp(axis, offset),
            visible,
            area,
            alternative: None,
        }
    }

    /// The nearest offset at which the area fills the snapport, and what is between the others can be seen.
    fn covering(&self, axis: usize, aligned: &Found, intended: f32) -> Option<Found> {
        let (areas, [near, far]) = (&self.container.areas, self.container.view.span(axis));
        let own = &areas[aligned.area].rect;
        let [start, end] = own.span(axis);
        (end - start >= far - near).then_some(())?;
        let overlaps = |a: [f32; 2], b: [f32; 2]| a[0] < b[1] && b[0] < a[1];
        let others = areas.iter().filter(|it| {
            it.align[axis] != SnapAlign::None
                && overlaps(it.rect.span(1 - axis), own.span(1 - axis))
        });
        let mut intruders: Vec<_> = others
            .map(|it| it.rect.span(axis))
            .filter(|it| overlaps(*it, [start, end]) && (it[0] > start || it[1] < end))
            .collect();
        intruders.order_by(|a, b| a[0].total_cmp(&b[0]));
        let mut free = start;
        let gaps = intruders.into_iter().chain([[end; 2]]).map(|it| {
            let gap = [free, it[0]];
            free = free.max(it[1]);
            gap
        });
        let offsets = gaps.filter(|it| it[1] > it[0]).map(|it| {
            let [min, max] = [it[0] - near, it[1] - far];
            let offset = match areas[aligned.area].align[axis] {
                _ if max > min => intended.min(max).max(min),
                SnapAlign::End => max,
                SnapAlign::Center => (min + max) / 2.0,
                _ => min,
            };
            self.clamp(axis, offset.min(end - far).max(start - near))
        });
        let offset =
            offsets.min_by(|a, b| (a - intended).abs().total_cmp(&(b - intended).abs()))?;
        Some(Found { offset, ..*aligned })
    }

    fn closest_among(&self, axis: usize, search: &Search, cross: &Found) -> Option<Found> {
        let (areas, [near, far], base) = (
            &self.container.areas,
            self.container.view.span(axis),
            search.base(),
        );
        let mut least = if self.container.is_mandatory {
            f32::INFINITY
        } else {
            (far - near) / 3.0
        };
        let (mut closest, mut covering) = (None::<Found>, None);
        let mut evaluate = |candidate: Found| {
            let distance = (candidate.offset - base[axis]).abs();
            if !see_each_other(&candidate, cross)
                || !search.accepts(axis, candidate.offset)
                || distance > least
            {
                return;
            }
            let area = &areas[candidate.area];
            match &mut closest {
                Some(best) if distance == least && !self.has_focus[candidate.area] => {
                    if self.has_focus[best.area] || Some(best.area) == self.targeted {
                    } else if Some(candidate.area) == self.targeted
                        || encloses(&areas[best.area].rect, &area.rect)
                    {
                        *best = candidate;
                    } else if self.container.axes == [true; 2]
                        && !area.align.contains(&SnapAlign::None)
                    {
                        let (offset, away) =
                            (self.aligned(1 - axis, candidate.area).offset, |it: f32| {
                                (it - base[1 - axis]).abs()
                            });
                        let is_better = |(other, at): (usize, f32)| {
                            away(offset) < away(at)
                                || away(offset) == away(at)
                                    && encloses(&areas[other].rect, &area.rect)
                        };
                        if best.alternative.is_none_or(is_better) {
                            best.alternative = Some((candidate.area, offset));
                        }
                    }
                }
                _ => (least, closest) = (distance, Some(candidate)),
            }
        };
        for index in (0..areas.len()).filter(|it| {
            areas[*it].align[axis] != SnapAlign::None && (areas[*it].stops || !search.only_stops)
        }) {
            let aligned = self.aligned(axis, index);
            evaluate(aligned);
            match self
                .covering(axis, &aligned, search.to[axis])
                .filter(|_| !search.only_stops)
            {
                Some(it) if it.offset != search.to[axis] => evaluate(it),
                Some(it)
                    if see_each_other(&it, cross)
                        && (covering.is_none() || self.has_focus[index]) =>
                {
                    covering = Some(it)
                }
                _ => {}
            }
        }
        match (closest, covering) {
            (Some(closest), Some(covering)) if search.intent == Intent::Direction => {
                let comes_first =
                    (closest.offset < covering.offset) == (search.to[axis] > search.from[axis]);
                Some(if comes_first { closest } else { covering })
            }
            _ => covering.or(closest),
        }
    }

    fn closest(&self, axis: usize, search: &Search, cross: &Found) -> Option<Found> {
        let found = self.closest_among(axis, search, cross);
        if let Some(found) = found.filter(|_| search.intent == Intent::EndAndDirection) {
            let stop = self.closest_among(
                axis,
                &Search {
                    intent: Intent::Direction,
                    only_stops: true,
                    ..*search
                },
                cross,
            );
            let away = |it: &Found| (it.offset - search.from[axis]).abs();
            return stop.filter(|it| away(it) < away(&found)).or(Some(found));
        }
        if found.is_some() || !self.container.is_mandatory || !search.is_directional() {
            return found;
        }
        self.closest_among(
            axis,
            &Search {
                intent: Intent::End([true; 2]),
                to: search.from,
                ..*search
            },
            cross,
        )
    }

    /// For what neither axis alone brings into view.
    fn closest_in_both(&self, search: &Search) -> [Option<Found>; 2] {
        let (areas, base) = (&self.container.areas, search.base());
        let both = (0..areas.len())
            .filter(|it| !areas[*it].align.contains(&SnapAlign::None))
            .map(|it| [0, 1].map(|axis| self.aligned(axis, it)));
        let is_near = |axis: usize, it: &Found| {
            let [near, far] = self.container.view.span(axis);
            search.accepts(axis, it.offset)
                && (self.container.is_mandatory
                    || (it.offset - base[axis]).abs() <= (far - near) / 3.0)
        };
        let away = |[x, y]: &[Found; 2]| (x.offset - base[0]).hypot(y.offset - base[1]);
        let found = both
            .filter(|[x, y]| is_near(0, x) && is_near(1, y))
            .min_by(|a, b| away(a).total_cmp(&away(b)));
        found.map_or([None; 2], |it| it.map(Some))
    }

    fn find(&self, search: &Search) -> [Option<Found>; 2] {
        let (areas, base, snaps) = (
            &self.container.areas,
            search.base(),
            [0, 1].map(|axis| search.snaps(axis) && self.container.axes[axis]),
        );
        let is_kept = |axis: usize, area: usize| {
            search.intent == Intent::Targets && areas[area].node == self.targets[axis]
        };
        let mut found = [0, 1].map(|axis| {
            snaps[axis].then_some(())?;
            if let Some(area) = (0..areas.len())
                .find(|it| is_kept(axis, *it) && areas[*it].align[axis] != SnapAlign::None)
            {
                let aligned = self.aligned(axis, area);
                return self
                    .covering(axis, &aligned, search.to[axis])
                    .or(Some(aligned));
            }
            let cross = Found {
                offset: self.clamp(1 - axis, base[1 - axis]),
                visible: self.container.range[axis],
                area: 0,
                alternative: None,
            };
            self.closest(axis, search, &cross)
        });
        match found {
            [None, None] if snaps == [true; 2] && search.intent != Intent::EndAndDirection => {
                return self.closest_in_both(search);
            }
            [Some(x), Some(y)] if !see_each_other(&x, &y) => {
                let only = |[x, y]: [bool; 2]| (x != y).then_some(usize::from(y));
                let leading = only([x, y].map(|it| self.has_focus[it.area]))
                    .or_else(|| only([x, y].map(|it| Some(it.area) == self.targeted)))
                    .or_else(|| only([is_kept(0, x.area), is_kept(1, y.area)]))
                    .or_else(|| {
                        is_kept(0, x.area).then_some(usize::from(!self.container.is_vertical))
                    })
                    .unwrap_or_else(|| {
                        usize::from((x.offset - base[0]).abs() > (y.offset - base[1]).abs())
                    });
                found[1 - leading] = self.closest(1 - leading, search, &[x, y][leading]);
            }
            _ => {}
        }
        for axis in [1, 0] {
            let cross = found[1 - axis].map_or_else(
                || self.clamp(1 - axis, search.from[1 - axis]),
                |it| it.offset,
            );
            if let Some(it) = &mut found[axis]
                && let Some((area, _)) = it.alternative.filter(|it| (it.1 - cross).abs() <= 1.0)
            {
                it.area = area;
            }
        }
        found
    }
}

/// Along the horizontal and the vertical axis.
pub(crate) fn physical_alignment(
    own: &Style,
    container: &Style,
    rect: &Rect,
    view: &Rect,
) -> [SnapAlign; 2] {
    let is_larger = if own.text.writing_mode.is_vertical() {
        rect.height > view.height
    } else {
        rect.width > view.width
    };
    let (style, &Pair(block, inline)) = (
        if is_larger { own } else { container },
        &own.scroll.snap_align,
    );
    style
        .text
        .writing_mode
        .turn_axes([(inline, 0), (block, 1)].map(|(align, axis)| {
            match (align, style.runs_back(axis)) {
                (SnapAlign::Start, true) => SnapAlign::End,
                (SnapAlign::End, true) => SnapAlign::Start,
                _ => align,
            }
        }))
}

impl Document {
    /// The elements in `id` whose nearest scroll container is `scroller`, with the rectangles around them, in tree order.
    fn visit_scrolled(
        &self,
        id: BoxId,
        matrix: &Matrix,
        scroller: BoxId,
        visit: &mut dyn FnMut(NodeId, &Style, &dyn Fn() -> Rect),
    ) {
        let items = self.boxes[id].inline.iter().flat_map(|it| &it.items);
        for item in items.filter(|it| it.kind == ItemKind::Open(true)) {
            let rects = || {
                self.local_rects(item.node)
                    .into_iter()
                    .filter(|it| it.0 == id)
                    .map(|it| it.1.transformed(matrix))
            };
            visit(item.node, &item.style, &|| {
                rects().reduce(|a, b| a.union(&b)).unwrap_or_default()
            });
        }
        for (column, flow, rect) in self
            .carousels
            .has(self.boxes[id].node)
            .then(|| self.columns_of(self.boxes[id].node))
            .into_iter()
            .flatten()
        {
            if let (Some(style), Some(own)) = (self.tree.style(column), self.to_scroller(flow, id))
            {
                visit(column, style, &|| rect.transformed(&multiply(matrix, &own)));
            }
        }
        self.boxes[id]
            .children
            .iter()
            .for_each(|it| self.visit_scrolled_child(*it, Some((id, matrix)), scroller, visit));
    }

    fn visit_scrolled_child(
        &self,
        child: BoxId,
        parent: Option<(BoxId, &Matrix)>,
        scroller: BoxId,
        visit: &mut dyn FnMut(NodeId, &Style, &dyn Fn() -> Rect),
    ) {
        let it = &self.boxes[child];
        let matrix = match parent.filter(|parent| parent.0 == it.container) {
            Some((_, matrix)) => multiply(matrix, &self.to_container(child)),
            None => {
                let Some(own) = self.to_scroller(child, scroller) else {
                    return;
                };
                multiply(
                    &crate::geometry::translation(self.scroll_offset(self.boxes[scroller].node)),
                    &own,
                )
            }
        };
        if it.node != 0 {
            visit(it.node, &it.style, &|| {
                self.extent(child).transformed(&matrix)
            });
        }
        match it.scrolls() {
            true => self.visit_escapees(child, scroller, visit),
            false => self.visit_scrolled(child, &matrix, scroller, visit),
        }
    }

    /// `id` scrolls, or something between it and `scroller` scrolls it.
    fn visit_escapees(
        &self,
        id: BoxId,
        scroller: BoxId,
        visit: &mut dyn FnMut(NodeId, &Style, &dyn Fn() -> Rect),
    ) {
        for child in self.boxes[id]
            .children
            .iter()
            .copied()
            .take_while(|_| self.boxes[id].cache.has_escapees())
        {
            match self.boxes[child].container != id
                && self
                    .boxes
                    .containers(child)
                    .find(|it| *it == scroller || self.boxes[*it].scrolls())
                    == Some(scroller)
            {
                true => self.visit_scrolled_child(child, None, scroller, visit),
                false => self.visit_escapees(child, scroller, visit),
            }
        }
    }

    fn snap_container(&self, id: BoxId) -> Container {
        let kind = self
            .tree
            .style(self.scrollbar_owner(id))
            .map_or(ScrollSnapType::empty(), |it| it.scroll.snap_type);
        let (style, view, mut areas) = (
            &self.boxes[id].style,
            self.optimal_viewing_region(id),
            Vec::new(),
        );
        let unscrolled = crate::geometry::translation(self.scroll_offset(self.boxes[id].node));
        self.visit_scrolled(id, &unscrolled, id, &mut |node, own, rect| {
            if own.scroll.snap_align != Pair(SnapAlign::None, SnapAlign::None) {
                let rect = rect().shrunk(scroll_margin(own).map(|it| -it));
                let stops = own.other(Id::ScrollSnapStop) == "always";
                areas.push(Area {
                    node,
                    align: physical_alignment(own, style, &rect, &view),
                    rect,
                    stops,
                });
            }
        });
        let logical = style
            .text
            .writing_mode
            .turn_axes([ScrollSnapType::INLINE, ScrollSnapType::BLOCK]);
        Container {
            axes: [0, 1].map(|axis| {
                kind.intersects(
                    [ScrollSnapType::X, ScrollSnapType::Y][axis]
                        | logical[axis]
                        | ScrollSnapType::BOTH,
                )
            }),
            is_mandatory: kind.contains(ScrollSnapType::MANDATORY),
            is_vertical: style.text.writing_mode.is_vertical(),
            view,
            range: self.scroll_range(id),
            areas,
        }
    }

    pub(crate) fn register_snapping(&mut self, node: NodeId, style: &Style) {
        let scroller = if self.tree.is_root(node) {
            DOCUMENT
        } else {
            node
        };
        if !style.scroll.snap_type.is_empty() {
            self.scrolling.snapping.entry(scroller).or_default();
        }
        if style.other_if_set(Id::ScrollInitialTarget).is_some() {
            self.scrolling.initial_targets.insert(node);
        } else if !self.scrolling.initial_targets.is_empty() {
            self.scrolling.initial_targets.remove(&node);
        }
    }

    /// With the new targets.
    fn find_snap(
        &self,
        node: NodeId,
        from: [f32; 2],
        to: [f32; 2],
        intent: Intent,
    ) -> Option<([f32; 2], [NodeId; 2])> {
        let state = self.scrolling.snapping.get(&node)?;
        let (container, has) = (&state.laid_out, |node: NodeId, state| {
            self.tree
                .element(node)
                .is_some_and(|it| it.state.contains(state))
        });
        let snapper = Snapper {
            container,
            targets: state.targets,
            has_focus: container
                .areas
                .iter()
                .map(|it| has(it.node, State::FOCUS_WITHIN))
                .collect(),
            targeted: container
                .areas
                .iter()
                .position(|it| has(it.node, State::TARGET)),
        };
        let search = Search {
            intent,
            from: if let Intent::End(_) = intent {
                to
            } else {
                from
            },
            to,
            only_stops: false,
        };
        let found = snapper.find(&search);
        let targets = [0, 1].map(|axis| match found[axis] {
            Some(it) => container.areas[it.area].node,
            None if search.snaps(axis) => 0,
            None => state.targets[axis],
        });
        Some((
            [0, 1].map(|axis| found[axis].map_or(to[axis], |it| it.offset)),
            targets,
        ))
    }

    pub(crate) fn snap_position(
        &self,
        node: NodeId,
        from: [f32; 2],
        to: [f32; 2],
        intent: Intent,
    ) -> [f32; 2] {
        self.find_snap(node, from, to, intent).map_or(to, |it| it.0)
    }

    /// Where a scroll is going to end.
    pub(crate) fn snap(
        &mut self,
        node: NodeId,
        from: [f32; 2],
        to: [f32; 2],
        intent: Intent,
    ) -> [f32; 2] {
        let Some((to, targets)) = self.find_snap(node, from, to, intent) else {
            return to;
        };
        self.scrolling
            .snapping
            .get_mut(&node)
            .into_iter()
            .for_each(|it| it.targets = targets);
        self.announce_snap_targets(node, false);
        to
    }

    pub(crate) fn announce_snap_targets(&mut self, node: NodeId, has_ended: bool) {
        let Some(state) = self.scrolling.snapping.get_mut(&node) else {
            return;
        };
        let (targets, is_vertical) = (state.targets, state.laid_out.is_vertical);
        let old = core::mem::replace(&mut state.announced[usize::from(has_ended)], targets);
        if old != targets {
            let [x, y] = targets.map(|it| {
                if self.tree.contains(it) {
                    self.event_target(it).0
                } else {
                    0
                }
            });
            let (block, inline) = if is_vertical { (x, y) } else { (y, x) };
            self.scrolling
                .snap_events
                .push((node, has_ended, [block, inline]));
            self.update_scroll_states();
        }
    }

    /// Whether its scroll container is going to be snapped to it, along each axis.
    pub(crate) fn snapped_axes(&self, node: NodeId) -> [bool; 2] {
        [0, 1].map(|axis| {
            self.scrolling
                .snapping
                .values()
                .any(|it| it.announced[0][axis] == node)
        })
    }

    pub(crate) fn snap_after_layout(&mut self) {
        let snapping: Vec<_> = self.scrolling.snapping.keys().copied().collect();
        for node in snapping {
            let Some(id) = self.scroller(node) else {
                continue;
            };
            let container = self.snap_container(id);
            let Some(state) = self
                .scrolling
                .snapping
                .get_mut(&node)
                .filter(|it| it.laid_out != container)
            else {
                continue;
            };
            let (old, is_off) = (
                core::mem::replace(&mut state.laid_out, container),
                state.laid_out.axes == [false; 2],
            );
            if !self.scrolling.is_in_progress(node) {
                let from = self.scroll_offset(node);
                let to = self.snap(node, from, from, Intent::Targets);
                let is_switched_on = old.axes == [false; 2] && from != [0.0; 2];
                self.glide_or_jump(node, to, u8::from(!is_switched_on), false);
                if !self.scrolling.is_in_progress(node) {
                    self.announce_snap_targets(node, true);
                }
            }
            if is_off {
                self.scrolling.snapping.remove(&node);
            }
        }
    }

    pub(crate) fn scroll_to_initial_targets(&mut self) {
        let around = |node: &NodeId| {
            self.boxes
                .containers(self.tree[*node].layout_box)
                .find(|it| self.boxes[*it].scrolls())
        };
        let scrollers = self
            .scrolling
            .initial_targets
            .iter()
            .filter(|it| self.tree[**it].layout_box != 0)
            .filter_map(around);
        let untouched: crate::name::Set<_> = scrollers
            .filter(|it| !self.scrolling.touched.contains(&self.boxes[*it].node))
            .collect();
        for id in untouched {
            let mut first = None;
            self.visit_scrolled(id, &IDENTITY, id, &mut |node, own, _| {
                if first.is_none() && self.scrolling.initial_targets.contains(&node) {
                    let Pair(block, inline) = own.scroll.snap_align;
                    first = Some((node, [inline, block]));
                }
            });
            let Some((node, align)) = first else { continue };
            let align = align.map(|it| match it {
                SnapAlign::Center => Alignment::Center,
                SnapAlign::End => Alignment::End,
                _ => Alignment::Start,
            });
            self.scroll_into_view(node, align, 1, true);
            self.scrolling.touched.remove(&self.boxes[id].node);
        }
    }
}
