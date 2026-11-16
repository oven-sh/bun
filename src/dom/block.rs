//! Block layout and floats.

use std::rc::Rc;

use crate::boxes::{BoxId, Kind, LayoutBox, VIEWPORT};
use crate::document::{Document, Quirks};
use crate::float_area::FloatArea;
use crate::fragment::{Breaks, Decision, Flow, Outcome};
use crate::layout::{
    AutoSize, Edges, Input, Output, Room, Strut, Widths, auto_margins, distribute, margin,
};
use crate::lines::relative_offset;
use crate::name::{is_name, name};
use crate::positioned::Edge;
use crate::properties::{Id, Style};
use crate::types::*;

struct Exclusion {
    is_left: bool,
    /// The side that faces the content.
    x: f32,
    top: f32,
    bottom: f32,
    /// With the width of the margin box.
    area: Option<(Box<FloatArea>, f32)>,
}

impl Exclusion {
    /// `x` for a line.
    fn edge_between(&self, top: f32, bottom: f32) -> Option<f32> {
        let Some((area, width)) = &self.area else {
            return Some(self.x);
        };
        let [left, right] = area
            .across(top - self.top, bottom - self.top)?
            .map(|it| it.clamp(0.0, width.max(0.0)));
        Some(if self.is_left {
            self.x - width + right
        } else {
            self.x + left
        })
    }
}

/// Those of a block formatting context. The methods use the coordinates of the box that has been entered.
#[derive(Default)]
pub(crate) struct Floats {
    all: Vec<Exclusion>,
    origin: [f32; 2],
    width: f32,
}

pub(crate) struct Slot {
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) width: f32,
    /// Where it may get wider.
    pub(crate) next: Option<f32>,
}

/// Left and right.
pub(crate) fn clears(style: &Style) -> [bool; 2] {
    [Clear::Left, Clear::Right]
        .map(|side| style.layout.clear == side || style.layout.clear == Clear::Both)
}

impl Floats {
    /// Returns what `leave` needs.
    pub(crate) fn enter(&mut self, [x, y]: [f32; 2], width: f32) -> ([f32; 2], f32) {
        let outer = (self.origin, self.width);
        (self.origin, self.width) = ([self.origin[0] + x, self.origin[1] + y], width);
        outer
    }

    pub(crate) fn leave(&mut self, outer: ([f32; 2], f32)) {
        (self.origin, self.width) = outer;
    }

    pub(crate) fn len(&self) -> usize {
        self.all.len()
    }

    pub(crate) fn truncate(&mut self, len: usize) {
        self.all.truncate(len);
    }

    pub(crate) fn are_in_the_way(&self) -> bool {
        self.all.iter().any(|it| it.bottom > self.origin[1])
    }

    fn has_one_at(&self, y: f32) -> bool {
        self.all
            .last()
            .is_some_and(|it| it.top == self.origin[1] + y)
    }

    pub(crate) fn clearance(&self, sides: [bool; 2]) -> Option<f32> {
        let cleared = self.all.iter().filter(|it| sides[usize::from(!it.is_left)]);
        cleared
            .map(|it| it.bottom - self.origin[1])
            .reduce(f32::max)
    }

    /// What is free between `left` and `right` from `y` down to `y + height`.
    pub(crate) fn slot(&self, range: [f32; 2], y: f32, height: f32) -> Slot {
        self.slot_for(range, y, height, false)
    }

    pub(crate) fn slot_for(
        &self,
        [mut left, mut right]: [f32; 2],
        y: f32,
        height: f32,
        is_line: bool,
    ) -> Slot {
        let ([x, top], mut next) = (self.origin, None::<f32>);
        for it in self
            .all
            .iter()
            .filter(|it| it.bottom - top > y && (it.top - top <= y || it.top - top < y + height))
        {
            let (edge, end) = match is_line && it.area.is_some() {
                true => (
                    it.edge_between(top + y, top + y + height),
                    (it.bottom - top)
                        .min((y + 1.0f32.max((it.bottom - it.top) / 4096.0)).max(y.next_up())),
                ),
                false => (Some(it.x), it.bottom - top),
            };
            if let Some(edge) = edge.map(|it| it - x).filter(|edge| {
                if it.is_left {
                    *edge > left
                } else {
                    *edge < right
                }
            }) {
                *(if it.is_left { &mut left } else { &mut right }) = edge;
            }
            next = Some(next.map_or(end, |next| next.min(end)));
        }
        Slot {
            x: left,
            y,
            width: right - left,
            next,
        }
    }

    /// Keeps lines out of `width` at one side.
    pub(crate) fn exclude(&mut self, is_left: bool, x: f32, [top, bottom]: [f32; 2]) {
        let (top, bottom) = (self.origin[1] + top, self.origin[1] + bottom);
        self.all.push(Exclusion {
            is_left,
            x: self.origin[0] + x,
            top,
            bottom,
            area: None,
        });
    }

    /// Returns the position of the margin box.
    pub(crate) fn place(
        &mut self,
        style: &Style,
        range: [f32; 2],
        y: f32,
        [width, height]: [f32; 2],
        area: Option<Box<FloatArea>>,
    ) -> [f32; 2] {
        let is_left = !style.floats_right();
        let mut y = y.max(self.clearance(clears(style)).unwrap_or(y));
        y = y.max(self.all.last().map_or(y, |it| it.top - self.origin[1]));
        let slot = loop {
            let slot = self.slot(range, y, height.max(0.0));
            match slot.next {
                Some(next) if slot.width + 0.01 < width && slot.width < range[1] - range[0] => {
                    y = next
                }
                _ => break slot,
            }
        };
        let x = if is_left {
            slot.x
        } else {
            slot.x + slot.width - width
        };
        let (top, bottom) = (self.origin[1] + y, self.origin[1] + y + height);
        self.all.push(Exclusion {
            is_left,
            x: self.origin[0] + if is_left { x + width } else { x },
            top,
            bottom,
            area: area.map(|it| (it, width)),
        });
        [x, y]
    }
}

impl LayoutBox {
    fn has_default_margin(&self, margin: f32) -> bool {
        let headings = [
            name!("h1"),
            name!("h2"),
            name!("h3"),
            name!("h4"),
            name!("h5"),
            name!("h6"),
        ];
        let ems = match headings.iter().position(|it| *it == self.tag) {
            Some(level) => [0.67, 0.83, 1.0, 1.33, 1.67, 2.33][level],
            None if is_name!(
                self.tag,
                "p" | "blockquote"
                    | "dir"
                    | "dl"
                    | "listing"
                    | "menu"
                    | "ol"
                    | "plaintext"
                    | "pre"
                    | "ul"
                    | "xmp"
            ) =>
            {
                1.0
            }
            None => return false,
        };
        (margin - ems * self.style.font.size.0).abs() < 0.02
    }
}

impl Document {
    pub(crate) fn block_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let (mut widths, mut floats) = (Widths::default(), [0.0f32; 2]);
        for index in 0..self.boxes[id].children.len() {
            let child = self.boxes[id].children[index];
            if self.boxes[child].style.is_out_of_flow() || self.boxes.ignored.contains(&child) {
                continue;
            }
            let own = self.contribution(child, height, None);
            let it = &self.boxes[child];
            let (is_float, [min, mut max]) = (it.style.is_floating(), own.sizes);
            if is_float || !it.joins_formatting_context {
                let cleared = clears(&it.style);
                floats = [0, 1].map(|side| if cleared[side] { 0.0 } else { floats[side] });
            }
            if is_float {
                floats[usize::from(it.style.floats_right())] += max.max(0.0);
                max = floats[0] + floats[1];
            } else {
                if !it.joins_formatting_context || it.kind == Kind::Lines {
                    let margin = margin(&it.style, 0.0);
                    let beside = |float: f32, margin: f32| {
                        if margin > 0.0 {
                            float.max(margin) - margin
                        } else {
                            float
                        }
                    };
                    max += beside(floats[0], margin.left) + beside(floats[1], margin.right);
                }
                floats = [0.0; 2];
            }
            widths.sizes = [widths.sizes[0].max(min), widths.sizes[1].max(max)];
            widths.uses_height |=
                own.uses_height && (it.uses_parent[1] || it.node == 0 || it.passes_height);
        }
        widths
    }

    /// Returns the size of the border box, which has been laid out.
    pub(crate) fn lay_out_shrunk(
        &mut self,
        id: BoxId,
        basis: (f32, Option<f32>),
    ) -> (Edges, f32, Output) {
        let (margin, input) = self.shrunk_input(id, basis);
        (margin, input.width, self.lay_out(id, input, None))
    }

    pub(crate) fn shrunk_input(&mut self, id: BoxId, basis: (f32, Option<f32>)) -> (Edges, Input) {
        let margin = margin(&self.boxes[id].style, basis.0);
        let [horizontal, vertical] = margin.sums();
        let available = [
            Some((basis.0 - horizontal).max(0.0)),
            basis.1.map(|it| it - vertical),
        ];
        let room = Room {
            available,
            basis: [Some(basis.0), basis.1],
            height: None,
        };
        let width = self.resolve_width(id, &room, AutoSize::Fit);
        (margin, self.input_for(id, width, &room))
    }

    /// What the margins at the top of the contents will probably collapse to.
    fn leading_margins(&self, id: BoxId, width: f32) -> Strut {
        let it = &self.boxes[id];
        if !it.joins_formatting_context || it.kind != Kind::Block || it.inset(width).top != 0.0 {
            return Strut::default();
        }
        let first = it.children.iter().find(|it| {
            !self.boxes[**it].style.is_out_of_flow() && !self.boxes[**it].style.is_floating()
        });
        first.map_or(Strut::default(), |first| {
            self.leading_margins(*first, width)
                .with(margin(&self.boxes[*first].style, width).top)
        })
    }

    fn block_alignment(&self, id: BoxId) -> Align {
        let it = &self.boxes[id];
        match (
            it.style.layout.align_content,
            &it.style.layout.vertical_align,
        ) {
            (Align::NORMAL, _) if is_name!(it.tag, "button" | "input") => {
                Align::safe(AlignName::Center)
            }
            (Align::NORMAL, VerticalAlign::Keyword(VerticalAlignName::Middle)) if it.is_cell() => {
                Align::safe(AlignName::Center)
            }
            (Align::NORMAL, VerticalAlign::Keyword(VerticalAlignName::Bottom)) if it.is_cell() => {
                Align::safe(AlignName::End)
            }
            (align, _) => align,
        }
    }

    /// By `align-content`.
    pub(crate) fn content_offset(&self, id: BoxId, free: f32) -> f32 {
        let align = self.block_alignment(id);
        if align == Align::NORMAL {
            return 0.0;
        }
        let align = if align.is_unsafe() || self.boxes[id].scrolls() {
            align
        } else {
            Align::safe(align.0)
        };
        match align.resolved(1, false, false, free) {
            AlignName::SpaceAround | AlignName::SpaceEvenly => {
                distribute(AlignName::Center, free.max(0.0), 1).0
            }
            AlignName::LastBaseline => free.max(0.0),
            align => distribute(align, free, 1).0,
        }
    }

    /// The offset of the border box in `available`, which the margins are part of.
    pub(crate) fn align_in_flow(
        &self,
        parent: &Style,
        child: BoxId,
        available: f32,
        width: f32,
        margin: &mut Edges,
    ) -> f32 {
        let (style, rtl) = (&self.boxes[child].style, parent.is_rtl());
        let free = available - width - margin.sums()[0];
        match auto_margins(style, 0) {
            _ if free <= 0.0 && style.layout.justify_self == Align::AUTO => {}
            [true, true] => (margin.left, margin.right) = crate::positioned::halves(free.max(0.0)),
            [true, false] => margin.left += free.max(0.0),
            [false, true] => margin.right += free.max(0.0),
            [false, false] => {
                let text_align = if self.boxes[child].tag == name!("legend") {
                    TextAlign::Start
                } else {
                    parent.text.align
                };
                let align = match (justify_self(style, parent), text_align) {
                    (Align::NORMAL, TextAlign::WebkitCenter) => AlignName::Center,
                    (Align::NORMAL, TextAlign::WebkitLeft) => {
                        Align::safe(AlignName::Left).resolved(0, rtl, rtl, free)
                    }
                    (Align::NORMAL, TextAlign::WebkitRight) => {
                        Align::safe(AlignName::Right).resolved(0, rtl, rtl, free)
                    }
                    (align, _) => align.resolved(0, rtl, self.boxes[child].starts_far(0), free),
                };
                let before = distribute(align, free, 1).0;
                return if rtl {
                    available - margin.right - width - before
                } else {
                    margin.left + before
                };
            }
        }
        if rtl {
            available - margin.right - width
        } else {
            margin.left
        }
    }

    pub(crate) fn lay_out_block(
        &mut self,
        id: BoxId,
        input: &Input,
        floats: Option<&mut Floats>,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let it = &self.boxes[id];
        let (style, inset, joins) = (
            Rc::clone(&it.style),
            it.inset(input.basis.0),
            floats.is_some(),
        );
        let basis = (
            (input.width - inset.sums()[0]).max(0.0),
            it.inner_height(input, inset),
        );
        let (has_auto_height, splits_layers) =
            (it.used_height(input, None).is_none(), it.splits_layers);
        let (mut own_floats, mut output) = (Floats::default(), Output::default());
        let floats = floats.unwrap_or(&mut own_floats);
        let range = [inset.left, inset.left + basis.0];
        let (mut y, mut strut, mut at_top) =
            (inset.top, Strut::default(), joins && inset.top == 0.0);
        let mut ends_with_clearance = false;
        let mut trim = [0, 1].map(|side| {
            style.rare.box_trim.sides()[side] || input.trim[side] && inset.along(1)[side] == 0.0
        });
        let has_last_line = |it: &&BoxId| {
            let it = &self.boxes[**it];
            !it.style.is_out_of_flow()
                && !it.style.is_floating()
                && it.inline.as_ref().is_none_or(|it| !it.is_passed_over())
        };
        let last = if trim[1] {
            self.boxes[id].children.iter().rfind(has_last_line).copied()
        } else {
            None
        };
        let [mut trims_margin, trims_last_margin] = style.rare.margin_trim.0;
        let is_quirky = self.environment.quirks == Quirks::All
            && (self.boxes[id].is_cell() || self.boxes[id].tag == name!("body"));
        let mut is_at_quirky_start = is_quirky || input.is_at_quirky_start && at_top;
        let mut ends_with_quirky_margin = false;
        let padding = inset.top - self.boxes[id].border()[0];
        let mut room_for_annotations = padding
            + if padding == inset.top {
                input.room_for_annotations
            } else {
                0.0
            };
        let passes_height =
            self.boxes[id].passes_height && has_auto_height && !self.boxes[id].fills_parent;
        let mut flow = breaks.map(|it| self.flow(id, input, inset, it));
        let (mut upcoming, mut discards_margin) = (0, false);
        while let Some(child) = self.boxes[id].children.get(upcoming).copied() {
            let (index, it) = (upcoming, &self.boxes[child]);
            upcoming += 1;
            discards_margin |= trims_margin;
            let next = if at_top { y } else { y + strut.sum() };
            if let Some(flow) = &mut flow {
                if flow.must_stop() {
                    break;
                }
                let is_spanner = flow.breaks.allows_spanners && it.spans_columns();
                let resumed = if is_spanner {
                    flow.pass_spanner(child, y + strut.sum())
                } else {
                    flow.break_early((child, None), y)
                };
                if flow.must_stop() {
                    break;
                }
                if let Some(resumed) = resumed {
                    output.margins[0] = if at_top { strut } else { output.margins[0] };
                    (y, strut, at_top, discards_margin) =
                        (resumed, Strut::default(), false, !is_spanner);
                    upcoming -= usize::from(!is_spanner);
                    continue;
                }
            }
            if it.style.is_out_of_flow() {
                flow.iter_mut()
                    .for_each(|it| it.note_static_position(child));
                output.escapes |= it.out_of_flow();
                self.set_static_position_in_flow(
                    child,
                    &style,
                    range,
                    if id == VIEWPORT { inset.top } else { next },
                );
                if self.boxes[child].style.was_inline {
                    let (slot, rtl) = (floats.slot(range, next, 0.0), style.is_rtl());
                    let indent = if (index == 0) != style.text.indent.hangs {
                        crate::layout::resolve(&style.text.indent.length, basis.0)
                    } else {
                        0.0
                    };
                    let before = match (style.text.align, rtl) {
                        (TextAlign::Center | TextAlign::WebkitCenter, _) => {
                            (slot.width + indent) / 2.0
                        }
                        (TextAlign::End, _)
                        | (TextAlign::Right | TextAlign::WebkitRight, false)
                        | (TextAlign::Left | TextAlign::WebkitLeft, true) => slot.width,
                        _ => indent,
                    };
                    self.boxes[child].static_position[0].0 = if rtl {
                        slot.x + slot.width - before
                    } else {
                        slot.x + before
                    };
                }
                continue;
            }
            if it.style.is_floating() {
                let (margin, own_input) = self.shrunk_input(child, basis);
                let (mut own, [horizontal, vertical]) =
                    (self.lay_out(child, own_input, None), margin.sums());
                let size = [own_input.width + horizontal, own.height + vertical];
                let mut at = floats.place(
                    &self.boxes[child].style,
                    range,
                    next,
                    size,
                    self.float_area(child, margin, size, basis.0),
                );
                if let Some(flow) = &mut flow {
                    let (top, height);
                    (top, height, own) = self.fragment_float(
                        child,
                        own_input,
                        flow,
                        flow.column,
                        at[1] + margin.top,
                        margin,
                    );
                    floats.truncate(floats.len() - 1);
                    at = floats.place(
                        &self.boxes[child].style,
                        range,
                        top - margin.top,
                        [size[0], margin.top + height],
                        self.float_area(child, margin, size, basis.0),
                    );
                }
                self.place_child(
                    child,
                    [at[0] + margin.left, at[1] + margin.top],
                    margin,
                    basis,
                );
                flow.iter_mut().for_each(|it| {
                    it.shift(
                        child,
                        self.boxes[child].layout.location.y - at[1] - margin.top,
                    )
                });
                self.absorb(child, &own, &mut output);
                continue;
            }
            let (mut margin, child_joins) =
                (margin(&it.style, basis.0), it.joins_formatting_context);
            if is_at_quirky_start
                && it.has_default_margin(margin.top)
                && !self.is_set_by_page(it.node, Id::MarginTop)
            {
                margin.top = 0.0;
            }
            ends_with_quirky_margin = is_quirky
                && is_name!(it.tag, "p" | "pre" | "listing" | "plaintext" | "xmp")
                && it.has_default_margin(margin.bottom)
                && !self.is_set_by_page(it.node, Id::MarginBottom);
            let auto = match justify_self(&it.style, &style).0 {
                _ if it.node == 0 && it.kind != Kind::Table => AutoSize::Fill,
                AlignName::Normal
                    if !it.shrinks_to_fit && !it.is_replaced() && !it.is_orthogonal() =>
                {
                    AutoSize::Fill
                }
                AlignName::Stretch if it.kind != Kind::Table => AutoSize::Stretch,
                _ => AutoSize::Fit,
            };
            let [above, below] = [0, 1].map(|side| {
                if joins && inset.along(1)[side] == 0.0 {
                    0.0
                } else {
                    margin.along(1)[side]
                }
            });
            let available = [
                Some(basis.0 - margin.sums()[0]),
                basis
                    .1
                    .filter(|_| !passes_height)
                    .map(|it| it - above - below),
            ];
            let mut room = Room {
                available,
                basis: [Some(basis.0), basis.1],
                height: None,
            };
            if input.is_restricted
                && basis.1.is_none()
                && matches!(
                    it.overflow[it.block_axis()],
                    Overflow::Auto | Overflow::Scroll
                )
                && crate::layout::is_relative(&it.style.layout.height)
                && !it.is_compressible()
            {
                room.height =
                    Some(it.height_limits(&room, it.border_and_padding(basis.0).sums(), None)[0]);
            }
            let clearance = floats.clearance(clears(&it.style));
            let above = strut.with(margin.top);
            let position = |margins: Strut| {
                let natural = if at_top || discards_margin {
                    y
                } else {
                    y + above.and(margins).sum()
                };
                clearance
                    .filter(|it| *it > natural)
                    .map_or((natural, false), |it| (it, true))
            };
            let child_trim = [trim[0], last == Some(child)].map(|side| side && !it.is_foreign());
            let (x, mut top, mut is_cleared, own);
            let column_end = flow.as_ref().map_or(f32::INFINITY, |it| it.end());
            let (count, tally, mut outcome) = (
                floats.len(),
                flow.as_ref().map(|it| it.breaks.tally.clone()),
                Outcome::default(),
            );
            let mut lay_out = |document: &mut Document,
                               input: Input,
                               floats: Option<&mut Floats>,
                               top: f32| match (&mut flow, &tally) {
                (Some(flow), Some(tally)) => {
                    flow.breaks.rewind(tally);
                    let (at, own);
                    at = flow.at(top);
                    (own, outcome) =
                        document.lay_out_in_column(child, input, floats, flow.breaks, at);
                    own
                }
                _ => document.lay_out(child, input, floats),
            };
            let depends_on_top = self.boxes.has_floats || tally.is_some();
            if child_joins {
                let width = self.resolve_width(child, &room, auto);
                let mut child_input = Input {
                    trim: child_trim,
                    is_at_quirky_start,
                    ..self.input_for(child, width, &room)
                };
                if self.boxes.has_annotations {
                    let is_padding = index == 0 && !at_top && self.boxes[child].kind != Kind::Lines;
                    child_input.room_for_annotations = match above.sum() {
                        0.0 => {
                            if is_padding {
                                0.0
                            } else {
                                room_for_annotations
                            }
                        }
                        margins if at_top => margins.max(room_for_annotations),
                        margins => margins.max(0.0),
                    };
                }
                let estimate = position(match depends_on_top {
                    true => self.leading_margins(child, basis.0),
                    false => Strut::default(),
                });
                x = inset.left + self.align_in_flow(&style, child, basis.0, width, &mut margin);
                let mut attempt = |document: &mut Document, top: f32| {
                    floats.truncate(count);
                    let outer = floats.enter([x, top], width);
                    let own = lay_out(document, child_input, Some(floats), top);
                    floats.leave(outer);
                    own
                };
                let first = attempt(self, estimate.0);
                (top, is_cleared) = position(first.margins[0]);
                own = if top != estimate.0 && depends_on_top {
                    attempt(self, top)
                } else {
                    first
                };
            } else {
                (top, is_cleared) = position(Strut::default());
                let mut height = 0.0;
                loop {
                    let slot = floats.slot(range, top, height);
                    let taken = [slot.x - range[0], range[1] - slot.x - slot.width];
                    let beside = [0, 1].map(|side| {
                        if taken[side] > 0.0 {
                            (taken[side] - margin.along(0)[side]).max(0.0)
                        } else {
                            0.0
                        }
                    });
                    let space = basis.0 - beside[0] - beside[1];
                    room.available[0] = Some(space - margin.sums()[0]);
                    let width = self.resolve_width(child, &room, auto);
                    let laid_out = lay_out(
                        self,
                        Input {
                            trim: child_trim,
                            ..self.input_for(child, width, &room)
                        },
                        None,
                        top,
                    );
                    let needs = laid_out.height.min(column_end - top);
                    let needed = width
                        + if style.is_rtl() {
                            margin.right + beside[1] - taken[1]
                        } else {
                            margin.left + beside[0] - taken[0]
                        };
                    match slot.next {
                        Some(next) if needed > slot.width + 0.01 && taken != [0.0; 2] => {
                            is_cleared |= at_top && floats.has_one_at(y);
                            (top, height) = (next, 0.0);
                        }
                        _ if needs > height
                            && floats.slot(range, top, needs).width < slot.width =>
                        {
                            height = needs
                        }
                        _ => {
                            x = inset.left
                                + beside[0]
                                + self.align_in_flow(&style, child, space, width, &mut margin);
                            own = laid_out;
                            break;
                        }
                    }
                }
            }
            if let (Some(flow), Some(tally)) = (&mut flow, &tally) {
                flow.is_separated |= top
                    > if at_top || discards_margin {
                        y
                    } else {
                        y + above.and(own.margins[0]).sum()
                    };
                match flow.decide(
                    (child, None),
                    [top, top + own.height],
                    &outcome,
                    self.avoids_break_inside(child),
                    true,
                ) {
                    Decision::Stay
                        if self.boxes[child].kind == Kind::Lines && own.collapses_through => {}
                    Decision::Stay => flow.pass(child, top + own.height, &outcome),
                    Decision::Move(appeal, is_forced) => {
                        flow.breaks.rewind(tally);
                        floats.truncate(count);
                        output.margins[0] = if at_top {
                            above.and(own.margins[0])
                        } else {
                            output.margins[0]
                        };
                        (y, strut, at_top) =
                            (flow.break_at(y, appeal, is_forced), Strut::default(), false);
                        (discards_margin, upcoming) = (!is_forced, index);
                        continue;
                    }
                    Decision::Abort => break,
                }
            }
            let before = if core::mem::take(&mut discards_margin) {
                Strut::default()
            } else {
                above.and(own.margins[0])
            };
            let collapses_through = child_joins && own.collapses_through;
            if at_top && (is_cleared || !collapses_through) {
                output.margins[0] = if is_cleared { strut } else { before };
                at_top = false;
            }
            ends_with_clearance =
                is_cleared && collapses_through || ends_with_clearance && collapses_through;
            if is_cleared && collapses_through {
                let own_top = Strut::default().with(margin.top).and(own.margins[0]);
                (y, strut) = (top - own_top.sum(), own_top.with(margin.bottom));
            } else if collapses_through {
                strut = if trims_margin {
                    Strut::default()
                } else {
                    before.with(margin.bottom)
                };
            } else {
                (y, strut) = (top + own.height, own.margins[1].with(margin.bottom));
            }
            self.place_child(child, [x, top], margin, basis);
            if splits_layers {
                let turned = |style| self.turned_style(style, self.boxes[id].turned);
                let offsets = self
                    .split_elements_around(child, id)
                    .map(|it| relative_offset(&turned(it.1), basis.0, basis.1));
                let [x, y] = offsets.fold([0.0; 2], |a, b| [a[0] + b[0], a[1] + b[1]]);
                let location = &mut self.boxes[child].layout.location;
                (location.x, location.y) = (location.x + x, location.y + y);
            }
            flow.iter_mut()
                .for_each(|it| it.shift(child, self.boxes[child].layout.location.y - top));
            self.absorb(child, &own, &mut output);
            let it = &self.boxes[child];
            trim[0] &= it.inline.as_ref().is_some_and(|it| it.is_passed_over());
            trims_margin &= collapses_through && !is_cleared;
            is_at_quirky_start &= collapses_through;
            room_for_annotations = if collapses_through {
                room_for_annotations
            } else {
                own.room_for_annotations
            };
            if !it.is_replaced() {
                let placed = |baseline: f32| top + it.clamp_baseline(baseline, own.height);
                output.baselines[0] = output.baselines[0].or(own.baselines[0].map(placed));
                output.last_baseline = own.last_baseline.map(placed).or(output.last_baseline);
                let last = match it.kind {
                    Kind::Table => None,
                    Kind::Block if it.scrolls() => Some(own.height + margin.bottom),
                    Kind::Block | Kind::Lines | Kind::Columns => own.baselines[1],
                    _ => own.baselines[0],
                };
                output.baselines[1] = last.map(|it| top + it).or(output.baselines[1]);
            }
        }

        if ends_with_quirky_margin && !joins {
            strut = Strut::default();
        }
        if trims_last_margin {
            strut = Strut::default();
            for index in (0..self.boxes[id].children.len()).rev() {
                let child = self.boxes[id].children[index];
                let it = &mut self.boxes[child];
                if !it.style.is_out_of_flow() && !it.style.is_floating() {
                    if !it.cache.collapses_through() {
                        break;
                    }
                    it.layout.location.y = it.layout.location.y.min(y);
                }
            }
        }
        output.room_for_annotations = if inset.bottom == 0.0 {
            room_for_annotations
        } else {
            0.0
        };
        let at_bottom = joins && inset.bottom == 0.0 && has_auto_height && !ends_with_clearance;
        if !at_bottom && !at_top {
            let limit = flow.as_ref().map_or(f32::INFINITY, |it| it.end().max(y));
            y = (y + strut.sum()).min(limit);
        }
        if let Some(clearance) = floats.clearance([true; 2]).filter(|it| !joins && *it > y) {
            y = clearance;
            flow.iter_mut().for_each(|it| it.extend_to(y));
        }
        output.intrinsic =
            flow.as_ref().map_or(y, |it| it.consumed(y)).max(inset.top) + inset.bottom;
        if let Some(lines) = style
            .rare
            .line_clamp
            .0
            .map(|it| it.0)
            .filter(|_| self.boxes[id].is_clamped())
            && let Some(bottom) = self.clamp_lines(id, lines.max(1) as usize)
        {
            output.intrinsic = bottom + inset.bottom;
        }
        if let Some(row) = input.row_baseline.filter(|_| {
            flow.as_ref()
                .is_none_or(|it| it.is_whole(input.height.unwrap_or(0.0)))
        }) {
            let own = output.baselines[0]
                .filter(|_| !style.contain().contains(Contain::LAYOUT))
                .unwrap_or(output.intrinsic);
            self.shift_children(id, row - own, &mut output, flow.as_mut());
            output.intrinsic += row - own;
        }
        if at_top || at_bottom {
            output.margins[usize::from(!at_top)] = strut;
        }
        self.finish_height(id, input, inset, &mut output);
        output.collapses_through = at_top && output.height == 0.0;
        if output.height != output.intrinsic {
            output.margins[1] = Strut::default();
        }
        if flow.as_ref().is_none_or(|it| it.is_whole(output.height)) {
            let offset = self.content_offset(id, output.height - output.intrinsic);
            self.shift_children(id, offset, &mut output, flow.as_mut());
        }
        if let Some(flow) = flow {
            flow.finish(id, inset, self.counts_clones(id), &mut output);
        }
        if self.boxes[id].tag == name!("textarea") {
            output.baselines = [None; 2];
        } else if self.boxes[id].tag == name!("button") && output.baselines[0].is_none() {
            output.baselines = [Some(output.height - inset.bottom); 2];
        }
        output
    }

    pub(crate) fn shift_children(
        &mut self,
        id: BoxId,
        offset: f32,
        output: &mut Output,
        mut flow: Option<&mut Flow>,
    ) {
        if offset == 0.0 {
            return;
        }
        for index in 0..self.boxes[id].children.len() {
            let child = self.boxes[id].children[index];
            let it = &mut self.boxes[child];
            it.layout.location.y += offset;
            it.static_position[1].0 += offset;
            flow.iter_mut().for_each(|it| it.shift(child, offset));
        }
        self.boxes[id].forget_extents();
        output.baselines = output.baselines.map(|it| Some(it? + offset));
        output.last_baseline = output.last_baseline.map(|it| it + offset);
    }

    fn set_static_position_in_flow(
        &mut self,
        id: BoxId,
        parent: &Style,
        [left, right]: [f32; 2],
        y: f32,
    ) {
        let it = &mut self.boxes[id];
        let rtl = parent.is_rtl();
        let edge = Edge::from(
            justify_self(&it.style, parent).resolved(0, rtl, it.starts_far(0), 0.0),
            rtl,
        );
        let vertical = Edge::from(
            it.style
                .layout
                .align_self
                .resolved(1, false, it.starts_far(1), 0.0),
            false,
        );
        it.static_position = [(edge.of([left, right]), edge), (y, vertical)];
    }

    /// Returns where the last line ends, if there are more.
    fn clamp_lines(&mut self, id: BoxId, count: usize) -> Option<f32> {
        let mut all = Vec::new();
        self.collect_lines(id, 0.0, &mut all);
        let total: usize = all.iter().map(|it| it.2).sum();
        let (mut remaining, mut bottom) = (count, None);
        for (lines, y, len) in all {
            let Some(mut inline) = self.boxes[lines].inline.take() else {
                continue;
            };
            inline
                .lines
                .lines
                .iter_mut()
                .for_each(|line| line.clamp = None);
            inline.lines.visible = (total > count && len >= remaining).then_some(remaining);
            if total > count && (1..=len).contains(&remaining) {
                let last = &inline.lines.lines[remaining - 1];
                let (mut end, mut at) = (y + last.y + last.height, self.boxes[lines].parent);
                if self.boxes[id].style.rare.box_trim.sides()[1] {
                    end -= crate::lines::trimmed(self, &self.boxes[lines].style, 1, false, last);
                }
                let mut top = y - self.boxes[lines].layout.location.y;
                while at != id {
                    let it = &mut self.boxes[at];
                    end += it.layout.padding.bottom + it.layout.border.bottom;
                    if it.has_auto_size(1) {
                        it.layout.size.height = end - top;
                        it.cache.forget_layout();
                    }
                    (top, at) = (top - it.layout.location.y, it.parent);
                }
                bottom = Some(end);
                let truncation = self.truncate(&inline.lines, last, &self.boxes[lines].style, true);
                inline.lines.lines[remaining - 1].clamp = truncation;
            }
            remaining = remaining.saturating_sub(len);
            self.boxes[lines].inline = Some(inline);
        }
        bottom
    }

    fn collect_lines(&self, id: BoxId, y: f32, out: &mut Vec<(BoxId, f32, usize)>) {
        for child in &self.boxes[id].children {
            let it = &self.boxes[*child];
            match &it.inline {
                Some(inline) => {
                    out.push((*child, y + it.layout.location.y, inline.lines.lines.len()))
                }
                None if it.joins_formatting_context => {
                    self.collect_lines(*child, y + it.layout.location.y, out)
                }
                None => {}
            }
        }
    }
}

pub(crate) fn justify_self(style: &Style, parent: &Style) -> Align {
    match (style.layout.justify_self, parent.layout.justify_items) {
        (Align::AUTO, items) => items,
        (own, _) => own,
    }
}

pub(crate) fn align_self(style: &Style, items: Align) -> Align {
    if style.layout.align_self == Align::AUTO {
        items
    } else {
        style.layout.align_self
    }
}
