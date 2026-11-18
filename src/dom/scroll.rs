//! Scrolling, scrollbars and resizers.

use core::cell::RefCell;
use std::rc::Rc;

use crate::abi::{Matrix, Rect};
use crate::boxes::{BoxId, Cover, Kind, LayoutBox, VIEWPORT};
use crate::document::Document;
use crate::engine_event::{EngineEvent, ForNode};
use crate::inline::{Item, ItemKind};
use crate::layout::{Strut, at_least, at_most};
use crate::lines::FragmentKind;
use crate::name::{Map, Name, Set, name};
use crate::order::Order as _;
use crate::properties::Style;
use crate::segments::Layers;
use crate::selector::Pseudo;
use crate::snap::{Intent, Snapping};
use crate::tree::{DOCUMENT, Element, Gone, NodeId, State};
use crate::types::*;
use crate::values::Size;

struct Smooth {
    by_user: bool,
    request: u32,
    node: NodeId,
    from: [f32; 2],
    to: [f32; 2],
    start: Option<f64>,
    duration: f64,
    /// Where on the curve it starts.
    coasts_from: Option<f32>,
}

/// The fling curve of Chromium, in pixels and seconds.
mod coasting {
    const ALPHA: f32 = -5707.62;
    const BETA: f32 = 172.0;
    const GAMMA: f32 = 3.7;

    pub(super) fn position_at(time: f32) -> f32 {
        ALPHA * (-GAMMA * time).exp() - BETA * time - ALPHA
    }

    pub(super) fn time_at(velocity: f32) -> f32 {
        -((velocity + BETA) / (-ALPHA * GAMMA)).ln() / GAMMA
    }
}

/// In place of the axis of a scrollbar.
pub(crate) const RESIZER: usize = 2;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Part {
    Track,
    Thumb,
    Back,
    Forward,
}

#[derive(Default)]
pub(crate) struct Scrolling {
    pub(crate) viewport: [f32; 2],
    smooth: Vec<Smooth>,
    /// What a script is asking for, or 0.
    request: u32,
    last_request: u32,
    /// Those that scripts wait for, each with how many scrollers have not arrived.
    awaited: Vec<(u32, usize)>,
    /// Those that are not at the origin.
    pub(crate) scrolled: Set<NodeId>,
    /// Something gets `display: none`, which offsets outlast.
    pub(crate) is_hiding: bool,
    /// The ancestors of those that had an offset then.
    pub(crate) around_hidden: Set<NodeId>,
    moved: Vec<NodeId>,
    ended: Vec<NodeId>,
    pub(crate) timeline_sources: Set<NodeId>,
    /// Among those, while nothing but first styles change.
    pub(crate) declarers: RefCell<Option<crate::timeline::Declarers>>,
    /// What the containers of `scroll-state()` queries were last evaluated with.
    pub(crate) states: Map<NodeId, [[bool; 4]; 4]>,
    /// The sides towards which those have last been scrolled by a distance.
    directions: Map<NodeId, [bool; 4]>,
    pub(crate) snapping: Map<NodeId, Snapping>,
    /// Whether the scroll has ended, and the targets along the block and the inline axis.
    pub(crate) snap_events: Vec<(NodeId, bool, [NodeId; 2])>,
    pub(crate) initial_targets: Set<NodeId>,
    /// Those that `scroll-initial-target` leaves alone.
    pub(crate) touched: Set<NodeId>,
    /// By the user or a script, since the fragment of the URL was shown.
    pub(crate) has_moved_on: bool,
    /// When the gesture counts as over.
    pub(crate) settling: Option<(NodeId, f64)>,
    /// The elements whose change of style rules out scroll anchoring.
    pub(crate) repositioned: Set<NodeId>,
    pub(crate) hovered: Option<(NodeId, usize, Part)>,
    /// With the distance from the start of the thumb to the pointer.
    pub(crate) dragged: Option<(NodeId, usize, f32)>,
    /// When to hide the overlay scrollbars.
    pub(crate) shown: Vec<(NodeId, f64)>,
}

/// An overlay scrollbar, in milliseconds. The former includes the latter.
const SHOWN_FOR: f64 = 1000.0;
const FADES_FOR: f64 = 250.0;

impl Scrolling {
    pub(crate) fn overlay_opacity(&self, node: NodeId, now: f64) -> f32 {
        let left = self
            .shown
            .iter()
            .find(|it| it.0 == node)
            .map_or(0.0, |it| it.1 - now);
        if left < FADES_FOR {
            (left / FADES_FOR).max(0.0) as f32
        } else {
            1.0
        }
    }

    pub(crate) fn wakes(&self, now: f64) -> impl Iterator<Item = f64> {
        let fading = self
            .shown
            .iter()
            .map(move |it| (it.1 - now - FADES_FOR).max(FADES_FOR / 10.0));
        fading.chain(self.settling.map(|it| it.1 - now))
    }

    pub(crate) fn forget(&mut self, gone: &Gone) {
        gone.leave_list(&mut self.smooth, |it| it.node);
        gone.leave_list(&mut self.moved, |it| *it);
        gone.leave_list(&mut self.ended, |it| *it);
        gone.leave_list(&mut self.shown, |it| it.0);
        gone.leave_list(&mut self.snap_events, |it| it.0);
        for set in [
            &mut self.scrolled,
            &mut self.around_hidden,
            &mut self.timeline_sources,
            &mut self.initial_targets,
            &mut self.touched,
            &mut self.repositioned,
        ] {
            gone.leave_set(set);
        }
        gone.leave_map(&mut self.states);
        gone.leave_map(&mut self.directions);
        gone.leave_map(&mut self.snapping);
        self.settling = self.settling.filter(|it| !gone.has(it.0));
        self.hovered = self.hovered.filter(|it| !gone.has(it.0));
        self.dragged = self.dragged.filter(|it| !gone.has(it.0));
    }

    pub(crate) fn is_animating(&self) -> bool {
        !self.smooth.is_empty()
            || self
                .shown
                .iter()
                .chain(&self.settling)
                .any(|it| it.1.is_nan())
    }

    /// For those that have appeared since the last time.
    pub(crate) fn time_scrollbars(&mut self, now: f64) {
        self.shown
            .iter_mut()
            .filter(|it| it.1.is_nan())
            .for_each(|it| it.1 = now + SHOWN_FOR);
    }

    pub(crate) fn is_in_progress(&self, node: NodeId) -> bool {
        self.smooth.iter().any(|it| it.node == node)
            || self.settling.is_some_and(|it| it.0 == node)
            || self.dragged.is_some_and(|it| it.0 == node)
    }

    pub(crate) fn has_events(&self) -> bool {
        !self.moved.is_empty() || !self.ended.is_empty() || !self.snap_events.is_empty()
    }
}

pub(crate) struct Scrollbar {
    pub(crate) rect: Rect,
    pub(crate) thumb: Option<Rect>,
    /// The length of each of the buttons.
    pub(crate) button: f32,
    /// `::-webkit-scrollbar`
    pub(crate) custom: Option<Rc<Style>>,
    pub(crate) track: [f32; 2],
}

pub(crate) struct ScrollAnchor {
    scroller: NodeId,
    node: NodeId,
    /// Of the side at the start of the block axis, in device pixels.
    position: f32,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Alignment {
    Start,
    Center,
    End,
    Nearest,
    CenterIfNeeded,
}

/// Those that scroll to reveal something.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Scrollers {
    All,
    Nearest,
}

/// What is left for the document around a frame.
#[derive(Clone, Copy)]
pub(crate) struct Revealed {
    /// In the viewport.
    pub(crate) rect: Rect,
    pub(crate) align: [Alignment; 2],
    pub(crate) behavior: u8,
}

pub(crate) const FAR: Rect = Rect {
    x: -1e9,
    y: -1e9,
    width: 2e9,
    height: 2e9,
};

/// What quiet boxes come to in their parent.
#[derive(Clone, Copy)]
pub(crate) struct Contents {
    /// Left, top, right and bottom.
    reach: [f32; 4],
    ink: [f32; 4],
    layers: Layers,
}

impl Default for Contents {
    fn default() -> Contents {
        let nothing = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        Contents {
            reach: nothing,
            ink: nothing,
            layers: Layers::KNOWN,
        }
    }
}

impl Contents {
    /// Whether it is known.
    #[inline(always)]
    pub(crate) fn add(&mut self, child: &LayoutBox) -> bool {
        let (Some(spread), Some(ink), true) =
            (child.spread.get(), child.ink.get(), child.is_quiet())
        else {
            return false;
        };
        let (at, layers) = (
            [child.layout.location.x, child.layout.location.y],
            child.painted.layers.get(),
        );
        let add = |[left, top, right, bottom]: [f32; 4], it: Rect| {
            [
                at_most(left, it.x),
                at_most(top, it.y),
                at_least(right, it.right()),
                at_least(bottom, it.bottom()),
            ]
        };
        let spread = spread.moved(at).intersection(&FAR);
        (self.reach, self.ink) = (
            if spread.is_empty() {
                self.reach
            } else {
                add(self.reach, spread)
            },
            add(self.ink, ink.moved(at)),
        );
        self.layers = (self.layers | (layers - Layers::KNOWN)) - (Layers::KNOWN - layers);
        true
    }
}

#[inline(always)]
fn around([left, top, right, bottom]: [f32; 4], it: Rect) -> Rect {
    Rect::from_edges(
        at_most(left, it.x),
        at_most(top, it.y),
        at_least(right, it.right()),
        at_least(bottom, it.bottom()),
    )
}

impl Document {
    pub(crate) fn scroll_offset(&self, node: NodeId) -> [f32; 2] {
        match node {
            DOCUMENT => self.scrolling.viewport,
            _ => self.tree.element(node).map_or([0.0; 2], |it| it.scroll),
        }
    }

    /// What the box adds to the scrollable overflow of its container, relative to the container's border box.
    pub(crate) fn overflow_contribution(&self, id: BoxId) -> Rect {
        let it = &self.boxes[id];
        if let Some(known) = it.spread.get() {
            return known.moved([it.layout.location.x, it.layout.location.y]);
        }
        let mut rect = self.extent(id);
        if self.is_collapsed_row(id) {
            return rect.moved([it.layout.location.x, it.layout.location.y]);
        }
        if it.overflow == [Overflow::Visible; 2] && it.style.stacking() == [false; 2] {
            let inside = self.scrollable_overflow(id);
            rect = if rect.is_empty() {
                inside
            } else {
                rect.union(&inside)
            };
            it.spread.set(rect);
            return rect.moved([it.layout.location.x, it.layout.location.y]);
        }
        let spills = !it.scrolls() && !it.style.contain().contains(Contain::LAYOUT);
        if spills {
            let inside = self.scrollable_overflow(id);
            let inside = self
                .overflow_clip(id)
                .map_or(inside, |clip| inside.intersection(&clip));
            rect = if rect.is_empty() {
                inside
            } else {
                rect.union(&inside)
            };
        }
        let rect = self.overflow_of_parts(id, spills).unwrap_or_else(|| {
            self.own_transform(id)
                .map_or(rect, |matrix| rect.transformed(&matrix))
        });
        rect.moved([it.layout.location.x, it.layout.location.y])
    }

    /// What is out of flow counts as if it were not transformed.
    fn overflow_of_parts(&self, id: BoxId, spills: bool) -> Option<Rect> {
        _ = self.transformed_parts(id)?;
        let (extent, clip) = (self.extent(id), self.overflow_clip(id));
        let inside = if spills {
            self.boxes.transformed.get(&id)?.overflow.get()
        } else {
            Default::default()
        };
        let [in_flow, out_of_flow] = inside.map(|it| {
            Some(clip.map_or(it, |clip| it.intersection(&clip))).filter(|it| !it.is_empty())
        });
        let transformed =
            self.transformed_by_parts(id, in_flow.map_or(extent, |it| extent.union(&it)))?;
        Some(out_of_flow.map_or(transformed, |it| transformed.union(&it)))
    }

    /// Only what is in the box has changed.
    pub(crate) fn note_new_contents(&mut self, id: BoxId, before: &Cover) {
        let it = &self.boxes[id];
        let keeps_reach = it.scrolls()
            || it.style.contain().contains(Contain::LAYOUT)
            || before
                .reach
                .is_some_and(|it| it == self.scrollable_overflow(id));
        if keeps_reach
            && before.layers.contains(Layers::KNOWN)
            && before.ink.is_some_and(|it| it == self.ink(id))
            && before.layers == self.layers(id)
        {
            return self.repaint_eventually(id);
        }
        self.boxes.mark_ink_around(id, !keeps_reach);
        if !keeps_reach {
            self.moved_boxes_in_scrollers.push(id);
        }
    }

    /// While the boxes in it are at hand.
    #[inline]
    pub(crate) fn note_extents(&self, id: BoxId) {
        let it = &self.boxes[id];
        let gathered = self.gathered.take().filter(|it| it.0 == id).map(|it| it.1);
        if it.overflow == [Overflow::Hidden; 2] {
            return self.note_extents_of_scroller(id, gathered);
        }
        if !(it.is_ordinary
            && it.turned == it.mode
            && it.overflow == [Overflow::Visible; 2]
            && (it.outside_marker == 0 || self.boxes[it.outside_marker].is_quiet())
            && !it.has_legend
            && it.is_quiet()
            && it.hoisted.is_empty())
        {
            return;
        }
        let mut contents = gathered.unwrap_or_default();
        if gathered.is_none()
            && !(it.children.len() <= 8
                && it.children.iter().all(|it| contents.add(&self.boxes[*it])))
        {
            let is_near = |it: &LayoutBox| {
                it.ink.get().is_some()
                    || it.children.len() <= 8
                        && it
                            .children
                            .iter()
                            .all(|it| self.boxes[*it].ink.get().is_some())
            };
            if it.children.len() <= 8
                && it
                    .children
                    .iter()
                    .map(|it| &self.boxes[*it])
                    .all(|it| it.mode == WritingMode::HorizontalTb && is_near(it))
            {
                self.overflow_contribution(id);
                self.ink(id);
            }
            return;
        }
        self.note_contents(id, contents);
    }

    fn note_extents_of_scroller(&self, id: BoxId, gathered: Option<Contents>) {
        let it = &self.boxes[id];
        if !(it.is_ordinary
            && it.turned == it.mode
            && it.outside_marker == 0
            && !it.has_legend
            && it.is_quiet())
        {
            return;
        }
        let (whole, mut contents) = (self.border_box(id), gathered.unwrap_or_default());
        it.spread.set(whole);
        it.ink.set(
            whole.union(
                &whole
                    .grown(it.style.fixed().outset)
                    .grown(it.layout.border.top),
            ),
        );
        if gathered.is_some()
            || it.children.len() <= 8 && it.children.iter().all(|it| contents.add(&self.boxes[*it]))
        {
            self.note_layers(id, contents.layers, Layers::SCROLLS);
        }
    }

    /// For a row or a group of rows.
    pub(crate) fn note_extents_of_part(&self, id: BoxId, contents: Contents) {
        let it = &self.boxes[id];
        if [it.mode, it.turned] == [WritingMode::HorizontalTb; 2]
            && it.is_quiet()
            && it.hoisted.is_empty()
            && !it.is_skipped
            && !it.is_parking
            && self.boxes.is_unbroken(id)
            && !self.is_collapsed_row(id)
        {
            self.note_contents(id, contents);
        }
    }

    #[inline(always)]
    fn note_contents(&self, id: BoxId, contents: Contents) {
        let it = &self.boxes[id];
        let (border, whole) = (it.layout.border, self.border_box(id));
        let (reach, mut ink) = (
            around(contents.reach, whole.shrunk(border.to_array())),
            around(contents.ink, whole),
        );
        if it.outside_marker != 0 {
            let at = self.boxes[it.outside_marker].layout.location;
            ink = ink.union(&self.ink(it.outside_marker).moved([at.x, at.y]));
        }
        it.reach.set(reach);
        it.spread.set(if whole.is_empty() {
            reach
        } else {
            whole.union(&reach)
        });
        it.ink
            .set(ink.union(&whole.grown(it.style.fixed().outset).grown(border.top)));
        self.note_layers(id, contents.layers, Layers::empty());
    }

    /// What it takes to show the document without scrolling.
    pub(crate) fn size_of_contents(&self) -> [f32; 2] {
        let client = self.client_box(VIEWPORT);
        let root = self.own_box(self.tree.root_element()).map(|it| {
            self.overflow_contribution(it)
                .union(&self.space_in_flow(it, [client.width, client.height]))
        });
        let all = self.boxes[VIEWPORT]
            .hoisted
            .iter()
            .map(|it| self.overflow_contribution(*it))
            .chain(root)
            .reduce(|a, b| a.union(&b))
            .unwrap_or_default();
        let reversed = self.boxes[VIEWPORT].reaches_negative_overflow();
        [0, 1].map(|axis| {
            if reversed[axis] {
                client.span(axis)[1] - all.span(axis)[0]
            } else {
                all.span(axis)[1]
            }
            .max(0.0)
            .ceil()
        })
    }

    /// As narrow as it can be, and as high as it is.
    pub(crate) fn preferred_size(&mut self) -> [f32; 2] {
        let Some(root) = self.own_box(self.tree.root_element()) else {
            return [0.0; 2];
        };
        let ([_, right, _, left], client) = (self.gutters(VIEWPORT), self.client_box(root));
        let height = client
            .height
            .max(self.scrollable_overflow(root).bottom() - client.y);
        [
            self.contribution(root, None, None).sizes[0] + left + right,
            height,
        ]
        .map(|it| (it * self.environment.zoom).round())
    }

    /// With the margins, and without a relative offset.
    fn space_in_flow(&self, id: BoxId, [width, height]: [f32; 2]) -> Rect {
        let (it, offset) = (
            &self.boxes[id],
            crate::lines::relative_offset(&self.boxes[id].style, width, Some(height)),
        );
        let rect = it.inline.as_ref().map_or_else(
            || self.border_box(id),
            |it| self.from_lines(id, it.lines.flow),
        );
        let (at, mut margin, end) = (
            it.layout.location,
            it.layout.margin.to_array(),
            it.mode.sides()[2],
        );
        margin[end] = it.cache.collapsed_bottom_margin().with(margin[end]).sum();
        rect.moved([at.x - offset[0], at.y - offset[1]])
            .shrunk(margin.map(|it| -it))
    }

    pub(crate) fn scrollable_overflow(&self, id: BoxId) -> Rect {
        let it = &self.boxes[id];
        if let Some(known) = it.reach.get() {
            return known;
        }
        let client = self.client_box(id);
        let mut reachable = FAR;
        if it.scrolls() {
            let [backwards, upwards] = it.reaches_negative_overflow();
            let [left, right] = if backwards {
                [-1e9, client.right()]
            } else {
                [client.x, 1e9]
            };
            let [top, bottom] = if upwards {
                [-1e9, client.bottom()]
            } else {
                [client.y, 1e9]
            };
            reachable = Rect::from_edges(left, top, right, bottom);
        }
        let least = if self.pieces(id).is_some() {
            self.extent(id)
        } else if it.kind == Kind::Table && it.collapsed.is_some() {
            self.border_box(id)
        } else {
            client
        };
        let mut reach = least;
        let add = |to: &mut Rect, rect: Rect| {
            let rect = rect.intersection(&reachable);
            if !rect.is_empty() {
                *to = to.union(&rect);
            }
        };
        for child in it
            .children
            .iter()
            .skip(usize::from(it.has_legend && it.scrolls()))
        {
            if !it.is_replaced() && !self.boxes[*child].style.is_out_of_flow() {
                add(&mut reach, self.overflow_contribution(*child));
            }
        }
        it.inline
            .iter()
            .for_each(|it| add(&mut reach, self.from_lines(id, it.lines.bounds)));
        let hoisted = it
            .hoisted
            .iter()
            .filter(|it| !self.is_fixed_to_viewport(**it))
            .map(|it| self.overflow_contribution(*it));
        match (!self.boxes.transformed.is_empty())
            .then(|| self.boxes.transformed.get(&id))
            .flatten()
        {
            Some(parts) => {
                let out_of_flow = hoisted
                    .filter(|it| !it.is_empty())
                    .reduce(|a, b| a.union(&b))
                    .unwrap_or_default();
                parts.overflow.set([reach, out_of_flow]);
                add(&mut reach, out_of_flow);
            }
            None => hoisted.for_each(|it| add(&mut reach, it)),
        }
        if it.scrolls() {
            reach = Some(reach.union(&self.padded_flow(id)))
                .filter(|it| !it.is_empty())
                .unwrap_or(reach);
        }
        it.reach.set(reach);
        reach
    }

    /// What is in flow, with the paddings around it.
    fn padded_flow(&self, id: BoxId) -> Rect {
        let (it, [x, y, width, height]) = (&self.boxes[id], self.content_box(id));
        let to_physical = it.mode.to_physical(if it.turned.is_vertical() {
            it.size()
        } else {
            it.mode.turn_axes(it.size())
        });
        let flow = match &it.grid {
            Some(info)
                if let [Some([left, right]), Some([top, bottom])] =
                    [info.extent(0), info.extent(1)] =>
            {
                Rect::from_edges(left, top, right, bottom).transformed(&to_physical)
            }
            _ => {
                let in_flow = it
                    .children
                    .iter()
                    .filter(|child| !self.boxes[**child].style.is_out_of_flow());
                let unite = |a: Rect, b: Rect| {
                    Rect::from_edges(
                        a.x.min(b.x),
                        a.y.min(b.y),
                        a.right().max(b.right()),
                        a.bottom().max(b.bottom()),
                    )
                };
                let mut end = (y, Strut::default());
                let space = |child: &BoxId| {
                    let (mut rect, own) = (
                        self.space_in_flow(*child, [width, height]),
                        &self.boxes[*child],
                    );
                    if it.kind == Kind::Block
                        && it.mode == WritingMode::HorizontalTb
                        && !own.style.is_floating()
                    {
                        let margin = own.layout.margin;
                        let below = own.cache.collapsed_bottom_margin().with(margin.bottom);
                        end = match own.joins_formatting_context && own.cache.collapses_through() {
                            true => (
                                end.0,
                                end.1
                                    .with(margin.top)
                                    .and(own.cache.collapsed_top_margin())
                                    .and(below),
                            ),
                            false => (rect.bottom() - below.sum(), below),
                        };
                        rect.height = end.0 + end.1.sum() - rect.y;
                    }
                    rect
                };
                in_flow
                    .map(space)
                    .reduce(unite)
                    .unwrap_or_else(|| Rect::new([x, y, 0.0, 0.0]))
            }
        };
        flow.shrunk(
            it.turned
                .physical_sides(&it.layout.padding.to_array())
                .map(|it| -it),
        )
    }

    /// For what has a default anchor. Turned like the box, whose children have been settled.
    pub(crate) fn scrollable_containing_block(&self, id: BoxId) -> Rect {
        let (it, client) = (&self.boxes[id], self.client_box(id));
        let flow = self
            .padded_flow(id)
            .transformed(&invert(&it.turned.to_physical(it.size())).unwrap_or(IDENTITY));
        let back = it.turned.turn_axes(it.reaches_negative_overflow());
        let [[left, right], [top, bottom]] = [0, 1].map(|axis| {
            let ([near, far], [start, end]) = (client.span(axis), flow.span(axis));
            if back[axis] != it.turned.reverses()[axis] {
                [near.min(start), far]
            } else {
                [near, far.max(end)]
            }
        });
        Rect::from_edges(left, top, right, bottom)
    }

    /// The least and the greatest offset along each axis.
    pub(crate) fn scroll_range(&self, id: BoxId) -> [[f32; 2]; 2] {
        let (it, client, reach) = (
            &self.boxes[id],
            self.client_box(id),
            self.scrollable_overflow(id),
        );
        let mut reversed = it.reaches_negative_overflow();
        reversed[1] &= it.scrolls();
        [0, 1].map(|axis| {
            let ([near, far], [start, end]) = (client.span(axis), reach.span(axis));
            let significant = |it: f32| if it < 0.02 { 0.0 } else { it };
            match reversed[axis] {
                true => [-significant(near - start), 0.0],
                false => [0.0, significant(end - far)],
            }
        })
    }

    pub(crate) fn scroller(&self, node: NodeId) -> Option<BoxId> {
        self.own_box(node).filter(|it| self.boxes[*it].scrolls())
    }

    pub(crate) fn forget_hidden_offsets(&mut self, leaving: NodeId) {
        if self.scrolling.around_hidden.is_empty() || !self.scrolling.around_hidden.remove(&leaving)
        {
            return;
        }
        for node in &self.scrolling.scrolled {
            if self.tree.flat_ancestors(*node).any(|it| it == leaving) {
                self.tree
                    .element_mut(*node)
                    .and_then(Element::rare_if_any)
                    .into_iter()
                    .for_each(|it| it.scroll = [0.0; 2]);
            }
        }
    }

    fn clamp_offset(&self, id: BoxId, offset: [f32; 2]) -> [f32; 2] {
        let (range, scale) = (self.scroll_range(id), self.environment.scale);
        [0, 1].map(|axis| {
            let [min, max] = range[axis].map(|it| (it * scale).round() / scale);
            match self.boxes[id].overflow[axis] {
                Overflow::Clip => 0.0,
                _ => ((offset[axis] * scale).round() / scale).min(max).max(min),
            }
        })
    }

    fn set_scroll_offset(&mut self, node: NodeId, offset: [f32; 2]) -> bool {
        let Some(id) = self.scroller(node).filter(|it| !self.boxes[*it].is_parking) else {
            return false;
        };
        if offset == [0.0; 2] && self.scroll_offset(node) == offset {
            return false;
        }
        let offset = self.clamp_offset(id, offset);
        if offset == self.scroll_offset(node) {
            return false;
        }
        match self.tree.element_to_style(node) {
            Some(element) => element.rare_mut().scroll = offset,
            None => self.scrolling.viewport = offset,
        }
        self.scrolling.scrolled.insert(node);
        if !self.scrolling.moved.contains(&node) {
            self.scrolling.moved.push(node);
        }
        if self.has_overlay_scrollbars(id) {
            match self.scrolling.shown.iter_mut().find(|it| it.0 == node) {
                Some(shown) => {
                    if core::mem::replace(&mut shown.1, f64::NAN) - self.animations.now <= FADES_FOR
                    {
                        self.repaint(node);
                    }
                }
                None => {
                    self.scrolling.shown.push((node, f64::NAN));
                    self.repaint(node);
                }
            }
        }
        self.scroll_offset_changed(node, offset);
        self.layout_version += 1;
        self.needs_layout |= !self.anchored.is_empty();
        self.update_scroll_states();
        true
    }

    pub(crate) fn scroll_by_user_to(&mut self, node: NodeId, offset: [f32; 2], has_ended: bool) {
        self.scrolling.smooth.retain(|it| it.node != node);
        self.note_direction(node, self.scroll_offset(node), offset);
        self.set_scroll_offset(node, offset);
        if has_ended {
            self.end_scroll(node);
        }
    }

    pub(crate) fn update_scroll_states(&mut self) {
        let mut states = core::mem::take(&mut self.scrolling.states);
        for (node, known) in &mut states {
            let state = [
                name!("scrollable"),
                name!("stuck"),
                name!("snapped"),
                name!("scrolled"),
            ]
            .map(|it| self.scroll_state_sides(*node, it));
            if core::mem::replace(known, state) != state {
                self.container_changed(*node, false);
            }
        }
        self.scrolling.states = states;
        if !self.carousels.is_empty() {
            self.update_scroll_controls();
        }
    }

    pub(crate) fn intended_scroll_offset(&self, node: NodeId) -> [f32; 2] {
        self.scrolling
            .smooth
            .iter()
            .find(|it| it.node == node)
            .map_or_else(|| self.scroll_offset(node), |it| it.to)
    }

    pub(crate) fn can_scroll_by(&self, node: NodeId, step: [f32; 2]) -> bool {
        let (Some(id), from) = (self.scroller(node), self.intended_scroll_offset(node)) else {
            return false;
        };
        let to = self.snap_position(
            node,
            from,
            self.clamp_offset(id, [from[0] + step[0], from[1] + step[1]]),
            Intent::EndAndDirection,
        );
        (0..2).any(|axis| (to[axis] - from[axis]) * step[axis].signum() >= 0.5 && step[axis] != 0.0)
    }

    fn note_direction(&mut self, node: NodeId, from: [f32; 2], to: [f32; 2]) {
        self.carousels.unpin(node);
        self.scrolling.touched.insert(node);
        self.scrolling.has_moved_on |= from != to;
        if !self.scrolling.states.is_empty() && from != to {
            let known = self.scrolling.directions.entry(node).or_default();
            for (axis, [back, forth]) in [[3, 1], [0, 2]]
                .into_iter()
                .enumerate()
                .filter(|it| from[it.0] != to[it.0])
            {
                (known[back], known[forth]) = (to[axis] < from[axis], to[axis] > from[axis]);
            }
        }
    }

    fn end_scroll(&mut self, node: NodeId) {
        self.announce_snap_targets(node, true);
        if !self.scrolling.ended.contains(&node) {
            self.scrolling.ended.push(node);
        }
    }

    pub(crate) fn emit_scroll_events(&mut self) {
        if !self.scrolling.has_events() {
            return;
        }
        let snaps = core::mem::take(&mut self.scrolling.snap_events);
        for (has_ended, nodes) in [
            (false, core::mem::take(&mut self.scrolling.moved)),
            (true, core::mem::take(&mut self.scrolling.ended)),
        ] {
            snaps
                .iter()
                .filter(|it| it.1 == has_ended)
                .for_each(|(node, _, targets)| {
                    self.emit(
                        *node,
                        ForNode::Snap {
                            has_ended,
                            targets: *targets,
                        },
                    )
                });
            nodes
                .into_iter()
                .for_each(|node| self.emit(node, ForNode::Scroll { has_ended }));
        }
    }

    fn scrolls_smoothly(&self, node: NodeId, behavior: u8) -> bool {
        let style = self.tree.style(if node == DOCUMENT {
            self.tree.root_element()
        } else {
            node
        });
        behavior == 2
            || behavior == 0 && style.is_some_and(|it| it.scroll.behavior == ScrollBehavior::Smooth)
    }

    /// An axis that is not a number stays as it is.
    pub(crate) fn scroll_to(
        &mut self,
        node: NodeId,
        to: [f32; 2],
        behavior: u8,
        is_relative: bool,
    ) {
        let Some(id) = self.scroller(node) else {
            return;
        };
        let (from, axes) = (self.scroll_offset(node), to.map(|it| !it.is_nan()));
        let to = self.clamp_offset(
            id,
            [0, 1].map(|axis| if axes[axis] { to[axis] } else { from[axis] }),
        );
        let to = self.snap(
            node,
            from,
            to,
            if is_relative {
                Intent::EndAndDirection
            } else {
                Intent::End(axes)
            },
        );
        self.scrolling.has_moved_on |= from != to;
        match is_relative {
            true => self.note_direction(node, from, to),
            false => self.note_direction(node, to, to),
        }
        self.glide_or_jump(node, to, behavior, true);
        if !self.carousels.is_empty() {
            self.update_scroll_controls();
        }
    }

    pub(crate) fn glide_or_jump(&mut self, node: NodeId, to: [f32; 2], behavior: u8, ends: bool) {
        let Some(id) = self.scroller(node) else {
            return;
        };
        let (from, to) = (self.scroll_offset(node), self.clamp_offset(id, to));
        if !self.scrolls_smoothly(node, behavior) {
            // What the user started goes on from there.
            self.scrolling
                .smooth
                .retain(|it| it.node != node || it.by_user);
            for smooth in self
                .scrolling
                .smooth
                .iter_mut()
                .filter(|it| it.node == node)
            {
                [smooth.from, smooth.to] = [smooth.from, smooth.to]
                    .map(|it| [0, 1].map(|axis| it[axis] + to[axis] - from[axis]));
            }
            if self.set_scroll_offset(node, to) && ends {
                self.end_scroll(node);
            }
            return;
        }
        self.scrolling.smooth.retain(|it| it.node != node);
        self.interrupt_compositor(node, to != from);
        if to != from {
            let distance = (to[0] - from[0]).abs().max((to[1] - from[1]).abs());
            let duration = f64::from(distance.sqrt() / 60.0 * 1000.0).min(700.0);
            self.scrolling.smooth.push(Smooth {
                by_user: false,
                request: self.scrolling.request,
                node,
                from,
                to,
                start: None,
                duration,
                coasts_from: None,
            });
        }
    }

    fn end_gesture(&mut self, node: NodeId) {
        let from = self.scroll_offset(node);
        let to = self.snap(node, from, from, Intent::End([true; 2]));
        self.glide_or_jump(node, to, 2, true);
        if !self.scrolling.is_in_progress(node) {
            self.end_scroll(node);
        }
    }

    pub(crate) fn scroll_for_script(
        &mut self,
        is_awaited: bool,
        scroll: impl FnOnce(&mut Document),
    ) {
        self.scrolling.last_request = self.scrolling.last_request % u32::MAX + 1;
        self.scrolling.request = self.scrolling.last_request;
        scroll(self);
        let request = core::mem::take(&mut self.scrolling.request);
        let count = self
            .scrolling
            .smooth
            .iter()
            .filter(|it| it.request == request)
            .count();
        self.scrolling
            .awaited
            .extend((is_awaited && count > 0).then_some((request, count)));
    }

    /// 0 if it is over.
    pub(crate) fn last_scroll_request(&self) -> u32 {
        self.scrolling
            .awaited
            .last()
            .map(|it| it.0)
            .filter(|it| *it == self.scrolling.last_request)
            .unwrap_or(0)
    }

    pub(crate) fn report_finished_scrolls(&mut self) {
        let (awaited, smooth) = (&mut self.scrolling.awaited, &self.scrolling.smooth);
        if awaited.is_empty() {
            return;
        }
        let over: Vec<_> = awaited
            .extract_if(.., |it| !smooth.iter().any(|smooth| smooth.request == it.0))
            .collect();
        self.events.extend(
            over.into_iter()
                .map(|(request, left)| EngineEvent::ScrollRequest {
                    request,
                    was_interrupted: left > 0,
                }),
        );
    }

    pub(crate) fn advance_smooth_scrolls(&mut self, now: f64) {
        for mut smooth in core::mem::take(&mut self.scrolling.smooth) {
            let start = *smooth.start.get_or_insert(now - 16.0);
            let t = ((now - start) / smooth.duration).min(1.0) as f32;
            let eased = match smooth.coasts_from.map(|from| {
                [
                    from,
                    crate::values::mix(from, coasting::time_at(0.0), t),
                    coasting::time_at(0.0),
                ]
                .map(coasting::position_at)
            }) {
                Some([from, now, to]) => (now - from) / (to - from),
                None => Easing::EASE_IN_OUT.apply(t.into(), false) as f32,
            };
            let mut offset =
                [0, 1].map(|axis| crate::values::mix(smooth.from[axis], smooth.to[axis], eased));
            let mut is_at_end = false;
            if let Some(id) = smooth.coasts_from.and_then(|_| self.scroller(smooth.node)) {
                offset = self.clamp_offset(id, offset);
                is_at_end = offset == self.clamp_offset(id, smooth.to);
            }
            self.set_scroll_offset(smooth.node, offset);
            match t < 1.0 && !is_at_end {
                true => self.scrolling.smooth.push(smooth),
                false => {
                    self.scrolling
                        .awaited
                        .iter_mut()
                        .filter(|it| it.0 == smooth.request)
                        .for_each(|it| it.1 -= 1);
                    self.end_scroll(smooth.node);
                }
            }
        }
        self.scrolling
            .settling
            .iter_mut()
            .filter(|it| it.1.is_nan())
            .for_each(|it| it.1 = now + 120.0);
        if let Some((node, _)) = self.scrolling.settling.take_if(|it| it.1 <= now) {
            self.end_gesture(node);
        }
        if !self.scrolling.shown.is_empty() {
            self.scrolling.time_scrollbars(now);
            let held = self
                .scrolling
                .hovered
                .map(|it| it.0)
                .or_else(|| self.scrolling.dragged.map(|it| it.0));
            self.scrolling
                .shown
                .iter_mut()
                .filter(|it| Some(it.0) == held)
                .for_each(|it| it.1 = now + SHOWN_FOR);
            let fading: Vec<_> = self
                .scrolling
                .shown
                .iter()
                .filter(|it| it.1 - now <= FADES_FOR)
                .map(|it| it.0)
                .collect();
            self.scrolling.shown.retain(|it| it.1 > now);
            for it in fading {
                self.repaint(it);
            }
        }
    }

    /// What the user has just scrolled goes on, at first with that many pixels per second.
    pub(crate) fn fling(&mut self, velocity: [f32; 2]) {
        const TOO_SLOW: f32 = 50.0;
        let fastest = velocity[0].abs().max(velocity[1].abs());
        let Some((node, _)) = self.scrolling.settling.take_if(|_| fastest >= TOO_SLOW) else {
            return;
        };
        let Some(id) = self.scroller(node) else {
            return;
        };
        let (from, [start, end]) = (
            self.scroll_offset(node),
            [coasting::time_at(fastest).max(0.0), coasting::time_at(0.0)],
        );
        let way = coasting::position_at(end) - coasting::position_at(start);
        let beyond = [0, 1].map(|axis| {
            from[axis]
                + if self.boxes[id].overflow[axis] == Overflow::Hidden {
                    0.0
                } else {
                    velocity[axis] / fastest * way
                }
        });
        let within = self.clamp_offset(id, beyond);
        let snapped = self.snap(node, from, within, Intent::EndAndDirection);
        let (to, duration) = (
            if snapped == within { beyond } else { snapped },
            f64::from(end - start) * 1000.0,
        );
        self.scrolling.smooth.push(Smooth {
            by_user: true,
            request: 0,
            node,
            from,
            to,
            start: None,
            duration,
            coasts_from: Some(start),
        });
    }

    /// Returns whether anything did.
    pub(crate) fn stop_coasting(&mut self) -> bool {
        let stopped: Vec<_> = self
            .scrolling
            .smooth
            .extract_if(.., |it| it.coasts_from.is_some())
            .collect();
        stopped.iter().for_each(|it| self.end_gesture(it.node));
        !stopped.is_empty()
    }

    pub(crate) fn user_scroll(
        &mut self,
        node: NodeId,
        delta: [f32; 2],
        unit: u8,
        smooth: bool,
    ) -> NodeId {
        let rendered = core::iter::once(node)
            .chain(self.tree.flat_ancestors(node))
            .find(|it| self.tree[*it].layout_box != 0);
        let mut at = self.tree[rendered.unwrap_or(DOCUMENT)].layout_box;
        while at != 0 {
            let it = &self.boxes[at];
            if it.scrolls() {
                let (node, client) = (it.node, self.client_box(at));
                let ongoing = self.scrolling.smooth.iter().position(|it| it.node == node);
                let from = ongoing.map_or_else(
                    || self.scroll_offset(node),
                    |index| self.scrolling.smooth[index].to,
                );
                let to = [0, 1].map(|axis| {
                    let step = [1.0, 40.0, [client.width, client.height][axis] * 0.875, 1e9]
                        [usize::from(unit.min(3))];
                    from[axis]
                        + if it.overflow[axis] == Overflow::Hidden {
                            0.0
                        } else {
                            delta[axis] * step
                        }
                });
                let mut to = self.clamp_offset(at, to);
                if to != from {
                    to = match (smooth, unit) {
                        (false, _) => {
                            self.snap(node, from, to, Intent::End([true; 2]));
                            to
                        }
                        (_, 0 | 1) => self.snap(node, from, to, Intent::Direction),
                        _ => self.snap(node, from, to, Intent::EndAndDirection),
                    };
                    self.note_direction(node, if unit < 3 { from } else { to }, to);
                    self.scrolling.smooth.retain(|it| it.node != node);
                    self.interrupt_compositor(node, true);
                    if smooth {
                        let (from, to) = (self.scroll_offset(node), self.clamp_offset(at, to));
                        self.scrolling.smooth.push(Smooth {
                            by_user: true,
                            request: 0,
                            node,
                            from,
                            to,
                            start: None,
                            duration: 150.0,
                            coasts_from: None,
                        });
                    } else {
                        self.set_scroll_offset(node, to);
                        if let Some((other, _)) = self
                            .scrolling
                            .settling
                            .replace((node, f64::NAN))
                            .filter(|it| it.0 != node)
                        {
                            self.end_gesture(other);
                        }
                    }
                    return node;
                }
                let behavior = [it.style.scroll.overscroll_x, it.style.scroll.overscroll_y];
                if (0..2).any(|axis| delta[axis] != 0.0 && behavior[axis] != Overscroll::Auto) {
                    return 0;
                }
            }
            at = if self.is_fixed_to_viewport(at) && at != VIEWPORT {
                VIEWPORT
            } else {
                it.container
            };
        }
        0
    }

    pub(crate) fn optimal_viewing_region(&self, id: BoxId) -> Rect {
        let (client, node) = (self.client_box(id), self.boxes[id].node);
        let Some(style) = self.tree.style(if node == DOCUMENT {
            self.tree.root_element()
        } else {
            node
        }) else {
            return client;
        };
        let s = &style.scroll;
        let sides = [
            &s.padding_top,
            &s.padding_right,
            &s.padding_bottom,
            &s.padding_left,
        ];
        let basis = [client.height, client.width];
        client.shrunk([0, 1, 2, 3].map(|side| {
            sides[side]
                .0
                .as_ref()
                .map_or(0.0, |it| it.0.resolve(basis[side % 2]))
        }))
    }

    /// `rect` is relative to the border box of `at`, and `align` is physical.
    pub(crate) fn reveal(
        &mut self,
        at: BoxId,
        rect: Rect,
        align: [Alignment; 2],
        behavior: u8,
        scrollers: Scrollers,
    ) -> Option<Revealed> {
        let mut rect = rect.transformed(&self.to_viewport(at));
        let mut at = at;
        while at != VIEWPORT && self.boxes[at].container != 0 {
            let moves = if self.is_fixed_to_viewport(at) {
                self.anchored
                    .get(&self.boxes[at].node)
                    .map_or([false; 2], |it| it.follows)
            } else {
                [true; 2]
            };
            if moves == [false; 2] {
                break;
            }
            at = self.boxes[at].container;
            if !self.boxes[at].scrolls() {
                continue;
            }
            let (matrix, node) = (self.to_viewport(at), self.boxes[at].node);
            let local = rect.transformed(&invert(&matrix).unwrap_or(IDENTITY));
            let (view, from) = (self.optimal_viewing_region(at), self.scroll_offset(node));
            let to = [0, 1].map(|axis| {
                let ([start, end], [near, far]) = (local.span(axis), view.span(axis));
                let is_visible = start >= near && end <= far || start <= near && end >= far;
                from[axis]
                    + match align[axis] {
                        _ if !moves[axis] => 0.0,
                        Alignment::Nearest | Alignment::CenterIfNeeded if is_visible => 0.0,
                        Alignment::Start => start - near,
                        Alignment::End => end - far,
                        Alignment::Center => (start + end - near - far) / 2.0,
                        Alignment::CenterIfNeeded if end <= near || start >= far => {
                            (start + end - near - far) / 2.0
                        }
                        _ if (start < near) == (end - start < far - near) => start - near,
                        _ => end - far,
                    }
            });
            self.scroll_to(node, to, behavior, false);
            let to = self
                .scrolling
                .smooth
                .iter()
                .find(|it| it.node == node)
                .map_or_else(|| self.scroll_offset(node), |it| it.to);
            let moved = local.moved([from[0] - to[0], from[1] - to[1]]);
            rect = moved
                .intersection(&self.client_box(at))
                .transformed(&matrix);
            if scrollers == Scrollers::Nearest {
                return None;
            }
        }
        Some(Revealed {
            rect,
            align,
            behavior,
        })
    }

    pub(crate) fn scroll_into_view_for_script(
        &mut self,
        node: NodeId,
        align: [Alignment; 2],
        behavior: u8,
        scrollers: Scrollers,
        is_awaited: bool,
    ) -> Option<Revealed> {
        self.update_style();
        if node != 0 && !self.unlock_around(node) {
            return None;
        }
        self.catch_up_with_compositor();
        self.update_layout_for(node);
        let mut revealed = None;
        self.scroll_for_script(is_awaited, |it| {
            revealed = it.scroll_into_view(node, align, behavior, scrollers)
        });
        if !self.carousels.is_empty() {
            self.pin_marker_around(node);
        }
        revealed
    }

    /// `align` is for the inline and the block axis.
    pub(crate) fn scroll_into_view(
        &mut self,
        node: NodeId,
        align: [Alignment; 2],
        behavior: u8,
        scrollers: Scrollers,
    ) -> Option<Revealed> {
        let rects = self.local_rects(node);
        let (at, _) = rects.first()?;
        let rect = rects
            .iter()
            .filter(|it| it.0 == *at)
            .map(|it| it.1)
            .reduce(|a, b| a.union(&b))
            .unwrap_or_default();
        let Some(style) = self.tree.style(node) else {
            return self.reveal(*at, rect, align, behavior, scrollers);
        };
        let align = style.text.writing_mode.turn_axes([0, 1].map(|axis| {
            match (align[axis], style.runs_back(axis)) {
                (Alignment::Start, true) => Alignment::End,
                (Alignment::End, true) => Alignment::Start,
                (align, _) => align,
            }
        }));
        self.reveal(
            *at,
            rect.shrunk(scroll_margin(style).map(|it| -it)),
            align,
            behavior,
            scrollers,
        )
    }

    /// Top, right, bottom and left.
    fn scroll_state_sides(&self, node: NodeId, feature: Name) -> [bool; 4] {
        let node = if self.tree.is_root(node) {
            DOCUMENT
        } else {
            node
        };
        let Some(id) = self.own_box(node) else {
            return [false; 4];
        };
        if feature == name!("scrollable") {
            let (range, offset) = (self.scroll_range(id), self.scroll_offset(node));
            let can = |axis: usize, side: usize| {
                self.boxes[id].scrolls() && (range[axis][side] - offset[axis]).abs() >= 1.0
            };
            [can(1, 0), can(0, 1), can(1, 1), can(0, 0)]
        } else if feature == name!("scrolled") {
            self.scrolling
                .directions
                .get(&node)
                .copied()
                .filter(|_| self.boxes[id].scrolls())
                .unwrap_or_default()
        } else if feature == name!("snapped") {
            let [x, y] = self.snapped_axes(node);
            [y, x, y, x]
        } else if self.boxes[id].style.layout.position == PositionKind::Sticky {
            let [x, y] = self.sticky_offset(id, None);
            [y > 0.0, x < 0.0, y < 0.0, x > 0.0]
        } else {
            [false; 4]
        }
    }

    pub(crate) fn scroll_state(&self, node: NodeId, feature: Name, value: Name) -> bool {
        let (sides, Some(style)) = (
            self.scroll_state_sides(node, feature),
            self.tree.style(node),
        ) else {
            return false;
        };
        let ([top, right, bottom, left], [over, far, under, near]) =
            (sides, style.text.writing_mode.turn_sides(&sides));
        let (start, end) = if style.is_rtl() {
            (far, near)
        } else {
            (near, far)
        };
        match () {
            () if value == name!("top") => top,
            () if value == name!("right") => right,
            () if value == name!("bottom") => bottom,
            () if value == name!("left") => left,
            () if value == name!("block-start") => over,
            () if value == name!("block-end") => under,
            () if value == name!("inline-start") => start,
            () if value == name!("inline-end") => end,
            () if value == name!("x") => left || right,
            () if value == name!("y") => top || bottom,
            () if value == name!("inline") => start || end,
            () if value == name!("block") => over || under,
            () if value == name!("both") => top && left,
            () => (value == name!("none")) != sides.contains(&true),
        }
    }

    // ───────────────────────────── across layouts ─────────────────────────────

    pub(crate) fn update_scrollers_of_moved_boxes(&mut self) {
        if self.moved_boxes.is_empty() {
            return;
        }
        let moved = core::mem::take(&mut self.moved_boxes)
            .into_iter()
            .filter_map(|it| self.own_box(it))
            .collect();
        self.update_scrollers_around(moved);
    }

    pub(crate) fn update_scrollers_around(&mut self, moved: Vec<BoxId>) {
        let moved = moved
            .into_iter()
            .filter(|it| !self.is_fixed_to_viewport(*it));
        let scrollers: Set<_> = moved
            .filter_map(|it| {
                self.boxes
                    .containers(it)
                    .find(|it| self.boxes[*it].scrolls())
            })
            .collect();
        for id in scrollers {
            if !self.boxes[id].overflow.contains(&Overflow::Auto)
                && self.scroll_offset(self.boxes[id].node) == [0.0; 2]
            {
                continue;
            }
            let (it, range) = (&self.boxes[id], self.scroll_range(id));
            let needed = self.needed_scrollbars(id, &range);
            let need_each_other = it.scrollbars == [true; 2]
                && range
                    .iter()
                    .all(|range| range[1] - range[0] < it.scrollbar_size + 0.5);
            let is_stale = |axis: usize| {
                it.overflow[axis] == Overflow::Auto
                    && (it.scrollbars[axis] != needed[axis] || need_each_other)
            };
            let node = it.node;
            if (is_stale(0) || is_stale(1)) && !self.queries.with_new_scrollbars.contains(&id) {
                self.boxes.mark_contents(id);
                self.needs_layout = true;
            }
            self.set_scroll_offset(node, self.scroll_offset(node));
        }
    }

    /// From the border box of `descendant` to that of `scroller`, if it scrolls with it.
    pub(crate) fn to_scroller(&self, descendant: BoxId, scroller: BoxId) -> Option<Matrix> {
        let (mut matrix, mut at) = (IDENTITY, descendant);
        while at != scroller {
            (at != 0 && !self.is_fixed_to_viewport(at)).then_some(())?;
            (matrix, at) = (
                multiply(&self.to_container(at), &matrix),
                self.boxes[at].container,
            );
        }
        Some(matrix)
    }

    /// With what overflows at the end of the block axis.
    fn bounds_as_anchor(&self, id: BoxId) -> Rect {
        let rect = self.extent(id);
        if self.whole_overflow_clip(id).is_some() {
            return rect;
        }
        let (all, mut sides) = (rect.union(&self.scrollable_overflow(id)), [0.0; 4]);
        let end = self.boxes[id].mode.sides()[2];
        sides[end] = [
            all.y - rect.y,
            rect.right() - all.right(),
            rect.bottom() - all.bottom(),
            all.x - rect.x,
        ][end];
        rect.shrunk(sides)
    }

    fn can_be_anchor(&self, id: BoxId) -> bool {
        let it = &self.boxes[id];
        let (style, l) = (
            if it.node == 0 {
                Some(&it.style)
            } else {
                self.tree
                    .style(it.node)
                    .filter(|_| self.own_box(it.node) == Some(id))
            },
            &it.style.layout,
        );
        style
            .is_some_and(|it| it.scroll.anchor == AutoOrNone::Auto && it.display() != Display::None)
            && l.position != PositionKind::Fixed
            && (l.position != PositionKind::Sticky
                || [&l.top, &l.right, &l.bottom, &l.left]
                    .iter()
                    .all(|it| **it == Inset::Auto))
    }

    /// In `id`, which `matrix` takes to the coordinates of `view`.
    fn find_anchor_in(
        &self,
        id: BoxId,
        matrix: &Matrix,
        scroller: BoxId,
        view: &Rect,
    ) -> Option<NodeId> {
        let it = &self.boxes[id];
        let examine = |child: BoxId| {
            self.can_be_anchor(child).then_some(())?;
            let matrix = if self.boxes[child].container == id {
                multiply(matrix, &self.to_container(child))
            } else {
                self.to_scroller(child, scroller)?
            };
            let (node, rect) = (
                self.boxes[child].node,
                self.bounds_as_anchor(child).transformed(&matrix),
            );
            let visible = Some(rect.intersection(view)).filter(|it| !it.is_empty())?;
            let inside = (node == 0 || visible != rect)
                .then(|| self.find_anchor_in(child, &matrix, scroller, view));
            inside.flatten().or_else(|| (node != 0).then_some(node))
        };
        let Some(inline) = &it.inline else {
            let hoisted = it
                .hoisted
                .iter()
                .filter(|child| self.boxes[**child].parent != id);
            return it
                .children
                .iter()
                .chain(hoisted)
                .find_map(|it| examine(*it));
        };
        let view = view.transformed(&invert(
            &self
                .line_matrix(id)
                .map_or(*matrix, |it| multiply(matrix, &it)),
        )?);
        let is_excluded = |item: &Item| {
            let around = core::iter::successors(item.parent.checked_sub(1), |it| {
                inline.items[*it as usize].parent.checked_sub(1)
            });
            around
                .map(|it| &inline.items[it as usize].style)
                .chain((item.element != 0).then_some(&item.style))
                .any(|it| it.scroll.anchor == AutoOrNone::None)
        };
        let mut next = 0;
        let mut aside = |until: usize| {
            let items = inline
                .items
                .get(core::mem::replace(&mut next, until)..until)
                .unwrap_or_default();
            items.iter().find_map(|it| {
                if let ItemKind::Float(child) | ItemKind::OutOfFlow(child) = it.kind {
                    examine(child)
                } else {
                    None
                }
            })
        };
        let visible = inline
            .lines
            .fragments
            .iter()
            .filter(|it| !it.rect().intersection(&view).is_empty());
        let found = visible
            .filter(|it| !is_excluded(&inline.items[it.item as usize]))
            .find_map(|fragment| {
                let node = inline.items[fragment.item as usize].node;
                aside(fragment.item as usize).or_else(|| match fragment.kind {
                    FragmentKind::Text { .. } => (self.tree.contains(node)
                        && self.tree[node].layout_box == id)
                        .then_some(node),
                    FragmentKind::Atomic(child) => examine(child),
                    _ => None,
                })
            });
        found.or_else(|| aside(inline.items.len()))
    }

    /// The focused element or something in it, if text is typed into it.
    fn preferred_anchor(&self, scroller: NodeId) -> Option<NodeId> {
        let has = |node: NodeId, state| {
            self.tree
                .element(node)
                .is_some_and(|it| it.state.contains(state))
        };
        let next = |node: &NodeId| {
            self.rendered_children(*node)
                .find(|it| has(*it, State::FOCUS_WITHIN))
        };
        let focused =
            core::iter::successors(next(&scroller), next).find(|it| has(*it, State::FOCUS))?;
        let (id, scroller) = (
            self.own_box(focused)
                .filter(|it| self.boxes[*it].style.is_editable())?,
            self.scroller(scroller)?,
        );
        let (matrix, view) = (
            self.to_scroller(id, scroller)?,
            self.optimal_viewing_region(scroller),
        );
        let mut path = core::iter::once(id)
            .chain(self.boxes.containers(id))
            .take_while(|it| *it != scroller);
        let rect = self.bounds_as_anchor(id).transformed(&matrix);
        let visible = Some(rect.intersection(&view))
            .filter(|it| !it.is_empty() && path.all(|it| self.can_be_anchor(it)))?;
        (visible != rect)
            .then(|| self.find_anchor_in(id, &matrix, scroller, &view))
            .flatten()
            .or(Some(focused))
    }

    /// If that is its top.
    fn first_line_of_text(&self, node: NodeId, scroller: BoxId) -> Option<(BoxId, Rect)> {
        let lines = self.tree[node].text().map(|_| self.tree[node].layout_box)?;
        let (inline, [_, b, c, d, ..]) = (
            self.boxes[lines].inline.as_deref()?,
            self.to_scroller(lines, scroller)?,
        );
        let is_upright = (b, c) == (0.0, 0.0)
            && d > 0.0
            && self.boxes[scroller].mode == WritingMode::HorizontalTb
            && self.line_matrix(lines).is_none()
            && self.boxes.is_unbroken(lines);
        inline
            .clusters_of(node)
            .filter(|_| is_upright && inline.first_line.is_none())?;
        Some((lines, inline.fragments_of_node(node).next()?.rect()))
    }

    fn anchor_position(&self, node: NodeId, scroller: BoxId) -> Option<f32> {
        let (at, rect) = match self.own_box(node) {
            Some(own) => (own, self.bounds_as_anchor(own)),
            None if let Some(first) = self.first_line_of_text(node, scroller) => first,
            None => self
                .local_rects(node)
                .into_iter()
                .reduce(|a, b| (a.0, a.1.union(&b.1)))?,
        };
        let (it, rect) = (
            &self.boxes[scroller],
            rect.transformed(&self.to_scroller(at, scroller)?)
                .moved(self.scroll_offset(self.boxes[scroller].node)),
        );
        let position =
            [rect.y, rect.right() - it.layout.size.width, 0.0, rect.x][it.mode.sides()[0]];
        Some((position * self.environment.scale).round())
    }

    pub(crate) fn select_scroll_anchors(&self) -> Vec<ScrollAnchor> {
        let anchors = self.scrolling.scrolled.iter().filter_map(|scroller| {
            let id = self
                .scroller(*scroller)
                .filter(|it| !self.boxes.is_parked(*it))?;
            let owner = self.scrollbar_owner(id);
            let offset = self.boxes[id].mode.turn_axes(self.scroll_offset(*scroller))[1];
            (offset != 0.0 && self.tree.style(owner)?.scroll.anchor == AutoOrNone::Auto)
                .then_some(())?;
            let node = self.preferred_anchor(*scroller).or_else(|| {
                self.find_anchor_in(id, &IDENTITY, id, &self.optimal_viewing_region(id))
            })?;
            let mut path = core::iter::once(node)
                .chain(
                    self.tree
                        .flat_ancestors(node)
                        .take_while(|it| it != scroller),
                )
                .chain([*scroller]);
            let is_suppressed = !self.scrolling.repositioned.is_empty()
                && path.any(|it| self.scrolling.repositioned.contains(&it));
            (!is_suppressed).then_some(ScrollAnchor {
                scroller: *scroller,
                node,
                position: self.anchor_position(node, id)?,
            })
        });
        let mut anchors: Vec<_> = anchors.collect();
        if anchors.len() > 1 {
            anchors.order_by_cached_key(|it| {
                core::cmp::Reverse(self.tree.flat_ancestors(it.scroller).count())
            });
        }
        anchors
    }

    /// An element in it has been taken out of the flow or put back.
    pub(crate) fn suppress_scroll_anchoring_around(&mut self, node: NodeId) {
        let scroller = self
            .tree
            .flat_ancestors(node)
            .find(|it| self.scroller(*it).is_some());
        self.scrolling
            .repositioned
            .insert(scroller.unwrap_or(DOCUMENT));
    }

    pub(crate) fn adjust_scroll_positions(&mut self, anchors: &[ScrollAnchor]) {
        for anchor in anchors {
            let Some(id) = self.scroller(anchor.scroller) else {
                continue;
            };
            let Some(position) = self
                .anchor_position(anchor.node, id)
                .filter(|it| *it != anchor.position)
            else {
                continue;
            };
            let (axis, delta) = (
                usize::from(!self.boxes[id].mode.is_vertical()),
                (position - anchor.position) / self.environment.scale,
            );
            let mut offset = self.scroll_offset(anchor.scroller);
            offset[axis] += delta;
            self.set_scroll_offset(anchor.scroller, offset);
            for smooth in self
                .scrolling
                .smooth
                .iter_mut()
                .filter(|it| it.node == anchor.scroller)
            {
                (smooth.from[axis], smooth.to[axis]) =
                    (smooth.from[axis] + delta, smooth.to[axis] + delta);
            }
        }
        for node in core::mem::take(&mut self.resized_scrollers) {
            if self.scroll_offset(node) != [0.0; 2] {
                self.set_scroll_offset(node, self.scroll_offset(node));
            }
        }
        if !self.scrolling.initial_targets.is_empty() {
            self.scroll_to_initial_targets();
        }
        if !self.scrolling.snapping.is_empty() {
            self.snap_after_layout();
        }
        self.update_scroll_states();
        self.update_scroll_timelines();
    }

    // ───────────────────────────── scrollbars ─────────────────────────────

    pub(crate) fn scrollbar_owner(&self, id: BoxId) -> NodeId {
        if id == VIEWPORT {
            self.tree.root_element()
        } else {
            self.boxes[id].node
        }
    }

    pub(crate) fn scrollbar_part_style(
        &self,
        id: BoxId,
        axis: usize,
        pseudo: Pseudo,
    ) -> Option<Rc<Style>> {
        let node = self.boxes[id].node;
        let mut state = [State::HORIZONTAL, State::VERTICAL][axis];
        let part = self
            .scrolling
            .hovered
            .filter(|it| (it.0, it.1) == (node, axis))
            .map(|it| it.2);
        let is_dragged = self
            .scrolling
            .dragged
            .is_some_and(|it| (it.0, it.1) == (node, axis));
        state.set(
            State::HOVER,
            is_dragged
                || part.is_some_and(|it| pseudo != Pseudo::ScrollbarThumb || it == Part::Thumb),
        );
        state.set(State::ACTIVE, is_dragged);
        self.pseudo_style(self.scrollbar_owner(id), pseudo, state)
    }

    /// Relative to the border box.
    pub(crate) fn resizer(&self, id: BoxId) -> Option<Rect> {
        let it = &self.boxes[id];
        (it.style.scroll.resize != Resize::None
            && self
                .tree
                .element(it.node)
                .is_some_and(|it| !it.is_generated())
            && (it.scrolls() || it.tag == name!("iframe")))
        .then_some(())?;
        let (inside, is_left) = (
            Rect::new([0.0, 0.0, it.size()[0], it.size()[1]]).shrunk(it.border()),
            it.style.is_rtl() && !it.mode.is_vertical(),
        );
        let size = if it.scrollbar_size > 0.0 {
            it.scrollbar_size
        } else {
            15.0 / self.environment.zoom
        };
        Some(Rect::new([
            if is_left {
                inside.x
            } else {
                inside.right() - size
            },
            inside.bottom() - size,
            size,
            size,
        ]))
    }

    fn has_overlay_scrollbars(&self, id: BoxId) -> bool {
        let it = &self.boxes[id];
        let is_wanted = || {
            self.tree
                .style(self.scrollbar_owner(id))
                .is_some_and(|it| it.layout.scrollbar_width != ScrollbarWidth::None)
        };
        self.environment.overlay_scrollbars
            && it.scrollbar_size == 0.0
            && it.scrollbars != [false; 2]
            && is_wanted()
    }

    /// Relative to the border box.
    pub(crate) fn scrollbar(&self, id: BoxId, axis: usize) -> Option<Scrollbar> {
        let it = &self.boxes[id];
        let [min, max] = self.scroll_range(id)[axis];
        let is_overlay = it.scrollbar_size == 0.0;
        let style = self.tree.style(self.scrollbar_owner(id))?;
        let is_shown = match is_overlay {
            true => {
                self.scrolling.shown.iter().any(|shown| shown.0 == it.node)
                    && style.layout.scrollbar_width != ScrollbarWidth::None
            }
            false => {
                it.overflow[axis] == Overflow::Scroll
                    || it.overflow[axis] != Overflow::Hidden && max > min
            }
        };
        (it.scrollbars[axis] && is_shown).then_some(())?;
        let is_standard = style.layout.scrollbar_width != ScrollbarWidth::Auto
            || style.ink.scrollbar_color.0.is_some();
        let custom = if is_standard {
            None
        } else {
            self.scrollbar_part_style(id, axis, Pseudo::Scrollbar)
        };
        (!is_overlay || custom.is_none()).then_some(())?;
        let (client, size) = (
            self.client_box(id),
            if is_overlay {
                16.0 / self.environment.zoom
            } else {
                it.scrollbar_size
            },
        );
        let inward = if is_overlay { size } else { 0.0 };
        let rect = match (axis, it.style.is_rtl() && !it.mode.is_vertical()) {
            (0, _) => Rect {
                y: client.bottom() - inward,
                height: size,
                ..client
            },
            (_, false) => Rect {
                x: client.right() - inward,
                width: size,
                ..client
            },
            (_, true) => Rect {
                x: client.x + inward - size,
                width: size,
                ..client
            },
        };
        let rect = match self
            .resizer(id)
            .filter(|it| !it.intersection(&rect).is_empty())
        {
            Some(corner) if axis == 1 => Rect {
                height: (corner.y - rect.y).max(0.0),
                ..rect
            },
            Some(corner) if corner.x > rect.x => Rect {
                width: corner.x - rect.x,
                ..rect
            },
            Some(corner) => Rect::from_edges(
                corner.right().min(rect.right()),
                rect.y,
                rect.right(),
                rect.bottom(),
            ),
            None => rect,
        };
        let [start, end] = rect.span(axis);
        let button = if custom.is_some() || is_overlay || cfg!(target_os = "macos") {
            0.0
        } else {
            (size * 1.2).round().min((end - start) / 2.0)
        };
        let (mut track, mut shortest) = (
            [start + button, end - button],
            size * if is_overlay { 26.0 / 16.0 } else { 17.0 / 15.0 },
        );
        if custom.is_some() {
            shortest = size;
            if let Some(style) = self.scrollbar_part_style(id, axis, Pseudo::ScrollbarTrack) {
                let l = &style.layout;
                let margins = [
                    [&l.margin_left, &l.margin_right],
                    [&l.margin_top, &l.margin_bottom],
                ][axis];
                let [before, after] =
                    margins.map(|it| it.0.as_ref().map_or(0.0, |it| it.resolve(0.0)));
                track = [track[0] + before, track[1] - after];
            }
            if let Some(style) = self.scrollbar_part_style(id, axis, Pseudo::ScrollbarThumb)
                && let Size::Length(min) = [&style.layout.min_width, &style.layout.min_height][axis]
            {
                shortest = min.resolve(0.0);
            }
        }
        let (visible, available) = (end - start, track[1] - track[0]);
        let length = (available * visible / (visible + max - min))
            .round()
            .max(shortest);
        let length = if cfg!(target_os = "macos") {
            length
        } else {
            length.min(available)
        };
        let thumb = (max > min && length > 0.0 && length <= available).then(|| {
            let at = track[0]
                + (available - length) * (self.scroll_offset(it.node)[axis] - min) / (max - min);
            match axis {
                0 => Rect {
                    x: at,
                    width: length,
                    ..rect
                },
                _ => Rect {
                    y: at,
                    height: length,
                    ..rect
                },
            }
        });
        Some(Scrollbar {
            rect,
            thumb,
            button,
            custom,
            track,
        })
    }

    fn drag_thumb(&mut self, node: NodeId, axis: usize, grip: f32, point: [f32; 2]) -> Option<()> {
        let id = self.scroller(node)?;
        let bar = self.scrollbar(id, axis)?;
        let (thumb, [min, max]) = (bar.thumb?.span(axis), self.scroll_range(id)[axis]);
        let at = apply(&invert(&self.to_viewport(id))?, point)[axis] - grip - bar.track[0];
        let mut offset = self.scroll_offset(node);
        offset[axis] =
            min + (max - min) * at / (bar.track[1] - bar.track[0] - (thumb[1] - thumb[0])).max(1.0);
        self.set_scroll_offset(node, offset);
        Some(())
    }

    pub(crate) fn scrollbar_mouse(&mut self, kind: u8, point: [f32; 2]) -> NodeId {
        if let Some((node, axis, grip)) = self.scrolling.dragged {
            if kind == 0 {
                self.drag_thumb(node, axis, grip, point);
            } else if kind != 3 {
                self.scrolling.dragged = None;
                self.repaint(node);
                self.end_gesture(node);
            }
            return node;
        }
        let found = self.scrollbar_at(point).filter(|_| kind != 3);
        if let (Some((id, RESIZER)), 1) = (found, kind) {
            return self.boxes[id].node | 1 << 31;
        }
        let found = found.filter(|it| it.1 != RESIZER).and_then(|(id, axis)| {
            let (bar, at) = (
                self.scrollbar(id, axis)?,
                apply(&invert(&self.to_viewport(id))?, point)[axis],
            );
            let thumb = bar.thumb.map_or([f32::NAN; 2], |it| it.span(axis));
            let part = match () {
                () if at >= thumb[0] && at < thumb[1] => Part::Thumb,
                () if bar.button > 0.0 && at < bar.track[0] => Part::Back,
                () if bar.button > 0.0 && at >= bar.track[1] => Part::Forward,
                () => Part::Track,
            };
            Some((self.boxes[id].node, axis, part, at - thumb[0]))
        });
        let hovered = found.map(|it| (it.0, it.1, it.2));
        let control = if self.carousels.is_empty() {
            0
        } else {
            self.point_at_scroll_control(if found.is_some() { 3 } else { kind }, point)
        };
        if control != 0 {
            return control;
        }
        let old = core::mem::replace(&mut self.scrolling.hovered, hovered);
        if old != hovered {
            old.into_iter()
                .chain(hovered)
                .for_each(|it| self.repaint(it.0));
        }
        let Some((node, axis, part, grip)) = found else {
            return 0;
        };
        if kind == 1 {
            let mut delta = [0.0; 2];
            delta[axis] = if part == Part::Back || part == Part::Track && grip < 0.0 {
                -1.0
            } else {
                1.0
            };
            match part {
                Part::Thumb => {
                    self.scrolling.dragged = Some((node, axis, grip));
                    self.repaint(node);
                }
                _ => _ = self.user_scroll(node, delta, 1 + u8::from(part == Part::Track), true),
            }
        }
        node
    }
}

pub(crate) fn scroll_margin(style: &Style) -> [f32; 4] {
    let s = &style.scroll;
    [
        s.margin_top.0,
        s.margin_right.0,
        s.margin_bottom.0,
        s.margin_left.0,
    ]
}
