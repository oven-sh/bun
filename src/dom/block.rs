//! Block layout and floats.

use std::rc::Rc;

use crate::boxes::{BoxId, Kind, LayoutBox, VIEWPORT};
use crate::document::{Document, Quirks};
use crate::float_area::FloatArea;
use crate::fragment::{Breaks, Decision, Flow, Outcome};
use crate::layout::{
    AutoSize, Edges, Input, Output, Room, Setting, Strut, Traits, Widths, auto_margins, clamp,
    distribute, margin,
};
use crate::lines::relative_offset;
use crate::name::{is_name, name};
use crate::positioned::Edge;
use crate::properties::{Id, Style};
use crate::types::*;
use crate::values::Size;

struct Exclusion {
    is_left: bool,
    /// The side that faces the content.
    x: f32,
    top: f32,
    bottom: f32,
    /// Of the left and of the right ones up to this one.
    lowest: [f32; 2],
    /// Up to this one, none is above those before it.
    is_in_order: bool,
    /// Of those right before it that start where it does, and itself: the first index, the room they leave and the first bottom.
    row: (usize, [f32; 2], f32),
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
        self.reach_below(0.0)
    }

    fn reach_below(&self, y: f32) -> bool {
        self.all
            .last()
            .is_some_and(|it| it.lowest[0].max(it.lowest[1]) > self.origin[1] + y)
    }

    fn has_one_at(&self, y: f32) -> bool {
        self.all
            .last()
            .is_some_and(|it| it.top == self.origin[1] + y)
    }

    pub(crate) fn clearance(&self, sides: [bool; 2]) -> Option<f32> {
        let [left, right] = [0, 1].map(|side| {
            self.all
                .last()
                .filter(|_| sides[side])
                .map_or(f32::NEG_INFINITY, |it| it.lowest[side])
        });
        Some(left.max(right) - self.origin[1]).filter(|it| *it != f32::NEG_INFINITY)
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
        let (is_in_order, starts_above) = (
            self.all.last().is_some_and(|it| it.is_in_order),
            |it: &Exclusion| it.top - top <= y || it.top - top < y + height,
        );
        let row = self
            .all
            .last()
            .filter(|it| !is_line && it.row.2 - top > y && starts_above(it))
            .map(|it| it.row);
        if let Some((_, edges, bottom)) = row {
            (left, right, next) = (
                left.max(edges[0] - x),
                right.min(edges[1] - x),
                Some(bottom - top),
            );
        }
        let (others, are_above) = (
            &self.all[..row.map_or(self.all.len(), |it| it.0)],
            |it: &Exclusion| it.lowest[0].max(it.lowest[1]) - top <= y,
        );
        let above = if others.last().is_none_or(are_above) {
            others.len()
        } else {
            others.partition_point(are_above)
        };
        for it in others[above..]
            .iter()
            .take_while(|it| !is_in_order || starts_above(it))
            .filter(|it| it.bottom - top > y && starts_above(it))
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

    fn add(&mut self, mut new: Exclusion) {
        new.lowest[usize::from(new.is_left)] = f32::NEG_INFINITY;
        new.lowest = self.all.last().map_or(new.lowest, |it| {
            [0, 1].map(|side| it.lowest[side].max(new.lowest[side]))
        });
        new.is_in_order = self
            .all
            .last()
            .is_none_or(|it| it.is_in_order && it.top <= new.top);
        let edges = if new.is_left {
            [new.x, f32::INFINITY]
        } else {
            [f32::NEG_INFINITY, new.x]
        };
        new.row = match self.all.last().filter(|it| it.top == new.top) {
            Some(Exclusion { row, .. }) => (
                row.0,
                [row.1[0].max(edges[0]), row.1[1].min(edges[1])],
                row.2.min(new.bottom),
            ),
            None => (self.all.len(), edges, new.bottom),
        };
        self.all.push(new);
    }

    /// Keeps lines out of `width` at one side.
    pub(crate) fn exclude(&mut self, is_left: bool, x: f32, [top, bottom]: [f32; 2]) {
        let (top, bottom) = (self.origin[1] + top, self.origin[1] + bottom);
        self.add(Exclusion {
            is_left,
            x: self.origin[0] + x,
            top,
            bottom,
            lowest: [bottom; 2],
            is_in_order: true,
            row: Default::default(),
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
        self.add(Exclusion {
            is_left,
            x: self.origin[0] + if is_left { x + width } else { x },
            top,
            bottom,
            lowest: [bottom; 2],
            is_in_order: true,
            row: Default::default(),
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

    #[inline]
    pub(crate) fn shrunk_input(&mut self, id: BoxId, basis: (f32, Option<f32>)) -> (Edges, Input) {
        match self.boxes[id]
            .fixed_sizes()
            .and_then(|it| Some((it.width?, it)))
        {
            Some((width, fixed)) => (
                fixed.margin,
                Input {
                    width: clamp(width, fixed.limits[0]),
                    basis,
                    ..Input::default()
                },
            ),
            None => self.input_by_contents(id, basis),
        }
    }

    fn input_by_contents(&mut self, id: BoxId, basis: (f32, Option<f32>)) -> (Edges, Input) {
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
        first.map_or_else(Strut::default, |first| {
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
        let (rtl, starts_far) = (false, false);
        match align.resolved(1, rtl, starts_far, free) {
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
        child_width: f32,
        margin: &mut Edges,
    ) -> f32 {
        let (style, rtl) = (&self.boxes[child].style, parent.is_rtl());
        let free = available - child_width - margin.sums()[0];
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
                    available - margin.right - child_width - before
                } else {
                    margin.left + before
                };
            }
        }
        if rtl {
            available - margin.right - child_width
        } else {
            margin.left
        }
    }

    /// `lay_out_block` for what most blocks with text are.
    fn lay_out_paragraph(
        &mut self,
        id: BoxId,
        lines: BoxId,
        input: &Input,
        floats: Option<&mut Floats>,
    ) -> Output {
        let it = &self.boxes[id];
        let (inset, mut own_floats) = (it.inset(input.basis.0), Floats::default());
        let (is_at_top, basis) = (
            floats.is_some() && inset.top == 0.0,
            (
                (input.width - inset.sums()[0]).max(0.0),
                it.inner_height(input, inset),
            ),
        );
        let own = self.lay_out(
            lines,
            Input {
                width: basis.0,
                basis,
                ..Input::default()
            },
            Some(floats.unwrap_or(&mut own_floats)),
        );
        self.place_child(lines, [inset.left, inset.top], Edges::default(), basis);
        let mut output = Output {
            intrinsic: inset.top + own.height + inset.bottom,
            ..Output::default()
        };
        self.absorb(lines, &own, &mut output);
        (output.baselines, output.last_baseline) = (
            own.baselines.map(|it| Some(inset.top + it?)),
            own.last_baseline.map(|it| inset.top + it),
        );
        self.finish_block(
            id,
            input,
            inset,
            is_at_top && own.collapses_through,
            output,
            None,
        )
    }

    /// `y` is that of a block and that of a line.
    fn pass_out_of_flow(
        &mut self,
        id: BoxId,
        index: usize,
        range: [f32; 2],
        y: [f32; 2],
        floats: &Floats,
    ) {
        let (style, child) = (
            Rc::clone(&self.boxes[id].style),
            self.boxes[id].children[index],
        );
        self.set_static_position_in_flow(child, &style, range, y[0]);
        if self.boxes[child].style.was_inline {
            let (slot, rtl) = (floats.slot(range, y[1], 0.0), style.is_rtl());
            let indent = if (index == 0) != style.text.indent.hangs {
                crate::layout::resolve(&style.text.indent.length, range[1] - range[0])
            } else {
                0.0
            };
            let before = match (style.text.align, rtl) {
                (TextAlign::Center | TextAlign::WebkitCenter, _) => (slot.width + indent) / 2.0,
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
    }

    #[inline]
    pub(crate) fn is_plain_block(&self, id: BoxId, input: &Input, floats: Option<&Floats>) -> bool {
        let it = &self.boxes[id];
        let stays_below = |fixed: crate::layout::Fixed| {
            fixed.traits.contains(Traits::HAS_FIXED_MARGIN)
                && fixed.margin.top >= 0.0
                && fixed.margin.bottom >= 0.0
        };
        it.kind == Kind::Block
            && it.is_ordinary
            && it.turned == it.mode
            && !(it.has_legend
                || it.is_skipped
                || it.is_parking
                || it.splits_layers
                || input.is_restricted
                || it.has_floats
                || self.boxes.has_annotations)
            && input.trim == [false; 2]
            && it.style.fixed().traits.contains(Traits::IS_PLAIN_INSIDE)
            && self.environment.quirks == Quirks::None
            && self.boxes.is_unbroken(id)
            && floats.is_none_or(|floats| {
                floats.len() == 0
                    || !floats.are_in_the_way()
                        && it
                            .children
                            .iter()
                            .all(|it| stays_below(self.boxes[*it].style.fixed()))
            })
    }

    /// What `run_algorithm` comes to for most blocks.
    #[inline(always)]
    pub(crate) fn lay_out_plain_block(
        &mut self,
        id: BoxId,
        input: &Input,
        floats: Option<&mut Floats>,
    ) -> Output {
        let it = &mut self.boxes[id];
        let (fixed, joins) = (it.style.fixed(), floats.is_some());
        let border = if it.collapsed.is_some() {
            Edges::new(it.border())
        } else {
            fixed.border
        };
        (it.layout.border, it.layout.padding, it.layout.size.width) =
            (border, fixed.padding, input.width);
        let inset = border + fixed.padding;
        let definite = match input.height {
            None => fixed.height.filter(|_| !input.ignores_height),
            height => height.filter(|_| !input.is_indefinite),
        };
        let basis = (
            (input.width - inset.sums()[0]).max(0.0),
            definite.map(|it| (it - inset.sums()[1]).max(0.0)),
        );
        let (mut y, mut strut, mut at_top) =
            (inset.top, Strut::default(), joins && inset.top == 0.0);
        let (mut output, count) = (
            Output {
                ignores_floats: joins
                    && it.outside_marker == 0
                    && it.style.layout.clear == Clear::None,
                ..Output::default()
            },
            it.children.len(),
        );
        let (mut contents, mut gathers) = (
            crate::scroll::Contents::default(),
            count > 8 && it.outside_marker == 0,
        );
        if count > 0 {
            let mut own_floats = None;
            let floats = floats.unwrap_or_else(|| own_floats.insert(Floats::default()));
            let (rtl, align, justify) = (
                it.style.is_rtl(),
                it.style.text.align,
                it.style.layout.justify_items,
            );
            let open = [at_top, joins && inset.bottom == 0.0];
            let setting = Setting::new(basis, [open[0], open[1], false, rtl], align, justify);
            let is_unaligned = justify == Align::NORMAL
                && !matches!(
                    align,
                    TextAlign::WebkitCenter | TextAlign::WebkitLeft | TextAlign::WebkitRight
                );
            for index in 0..count {
                let child = self.boxes[id].children[index];
                let it = &self.boxes[child];
                let (x, mut margin, own);
                if it.kind == Kind::Lines {
                    (x, margin) = (0.0, Edges::default());
                    own = self.lay_out(
                        child,
                        Input {
                            width: basis.0,
                            basis,
                            ..Input::default()
                        },
                        Some(floats),
                    );
                } else if it.style.is_out_of_flow() {
                    (output.escapes, output.ignores_floats, gathers) =
                        (output.escapes | it.out_of_flow(), false, false);
                    let next = if at_top { y } else { y + strut.sum() };
                    self.pass_out_of_flow(
                        id,
                        index,
                        [inset.left, inset.left + basis.0],
                        [next; 2],
                        floats,
                    );
                    continue;
                } else if let Some(known) = self.settled(child, setting) {
                    (x, margin, own) = known;
                } else {
                    let it = &self.boxes[child];
                    let (fixed, joins) = (it.style.fixed(), it.joins_formatting_context);
                    let input = if is_unaligned
                        && it.is_ordinary
                        && fixed.traits.contains(Traits::IS_PLAIN_OUTSIDE)
                    {
                        margin = fixed.margin;
                        let width = match &it.style.layout.width {
                            Size::Length(length) => {
                                crate::layout::resolve(length, basis.0) + fixed.beside
                            }
                            _ => basis.0 - margin.sums()[0],
                        };
                        Input {
                            width: clamp(
                                width.max((fixed.border + fixed.padding).sums()[0]),
                                fixed.limits[0],
                            ),
                            basis,
                            ..Input::default()
                        }
                    } else {
                        margin = crate::layout::margin(&it.style, basis.0);
                        let (above, below) = (
                            if open[0] { 0.0 } else { margin.top },
                            if open[1] { 0.0 } else { margin.bottom },
                        );
                        let room = Room {
                            available: [
                                Some(basis.0 - margin.sums()[0]),
                                basis.1.map(|it| it - above - below),
                            ],
                            basis: [Some(basis.0), basis.1],
                            height: None,
                        };
                        let width = self.resolve_width(
                            child,
                            &room,
                            it.auto_width_in(&self.boxes[id].style),
                        );
                        self.input_for(child, width, &room)
                    };
                    x = match is_unaligned
                        && (fixed.traits & (Traits::IS_PLAIN_OUTSIDE | Traits::HAS_AUTO_MARGIN))
                            .bits()
                            == Traits::IS_PLAIN_OUTSIDE.bits()
                    {
                        true if rtl => basis.0 - margin.right - input.width,
                        true => margin.left,
                        false => self.align_in_flow(
                            &self.boxes[id].style,
                            child,
                            basis.0,
                            input.width,
                            &mut margin,
                        ),
                    };
                    own = self.lay_out(child, input, joins.then_some(&mut *floats));
                    self.note_settled(child, setting, x);
                }
                let before = strut.with(margin.top).and(own.margins[0]);
                let top = if at_top { y } else { y + before.sum() };
                if own.collapses_through && self.boxes[child].joins_formatting_context {
                    strut = before.with(margin.bottom);
                } else {
                    if core::mem::take(&mut at_top) {
                        output.margins[0] = before;
                    }
                    (y, strut) = (top + own.height, own.margins[1].with(margin.bottom));
                }
                self.place_child(child, [inset.left + x, top], margin, basis);
                gathers = gathers && contents.add(&self.boxes[child]);
                output.ignores_floats &= own.ignores_floats;
                self.absorb(child, &own, &mut output);
                self.boxes[child].pass_baselines(top, margin.bottom, &own, &mut output);
            }
        }
        let at_bottom = joins && inset.bottom == 0.0 && definite.is_none();
        if !at_bottom && !at_top {
            y += strut.sum();
        }
        output.intrinsic = y.max(inset.top) + inset.bottom;
        if at_top || at_bottom {
            output.margins[usize::from(!at_top)] = strut;
        }
        if self.boxes[id].parent_kind == Kind::Row && self.boxes[id].is_cell() {
            let mut finished = self.finish_block(id, input, inset, false, output, None);
            finished.last_baseline = if finished.baselines[0].is_none() {
                finished.baselines[1]
            } else {
                finished.last_baseline
            };
            self.boxes[id].layout.size.height = finished.height;
            self.lay_out_positioned(id, &mut finished, None);
            return finished;
        }
        output.height = fixed.height_for(input, output.intrinsic);
        output.collapses_through = at_top && output.height == 0.0;
        if output.height != output.intrinsic {
            output.margins[1] = Strut::default();
        }
        if output.baselines[0].is_none() {
            output.last_baseline = output.baselines[1];
        }
        if gathers {
            self.gathered.set(Some((id, contents)));
        }
        let it = &mut self.boxes[id];
        it.layout.size.height = output.height;
        it.forget_hoisted();
        if it.outside_marker != 0 || !output.escapes.is_empty() {
            let mut finished = output;
            self.place_outside_marker(id, input, &mut finished);
            self.boxes[id].layout.size.height = finished.height;
            self.lay_out_positioned(id, &mut finished, None);
            return finished;
        }
        output
    }

    #[inline(never)]
    pub(crate) fn lay_out_block(
        &mut self,
        id: BoxId,
        input: &Input,
        floats: Option<&mut Floats>,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let it = &self.boxes[id];
        if let ([lines], None) = (&it.children[..], &breaks)
            && self.boxes[*lines].kind == Kind::Lines
            && !it.has_floats
            && floats.as_ref().is_none_or(|it| !it.are_in_the_way())
            && !self.boxes.has_annotations
            && self.environment.quirks == Quirks::None
            && input.trim == [false; 2]
            && it.style.rare.box_trim == TextBoxTrim::None
            && !it.splits_layers
            && !it.is_clamped()
            && self.boxes[*lines]
                .inline
                .as_ref()
                .is_some_and(|it| it.label.is_some() || !it.text.is_empty())
        {
            return self.lay_out_paragraph(id, *lines, input, floats);
        }
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
        for index in 0..if splits_layers { it.children.len() } else { 0 } {
            let child = self.boxes[id].children[index];
            let it = &mut self.boxes[child];
            // What is out of flow in them is claimed anew.
            if it.kind == Kind::Lines && it.cache.has_escapees() {
                it.cache.forget_layout();
            }
        }
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
        let is_simple = flow.is_none()
            && !self.boxes.has_annotations
            && trim == [false; 2]
            && !input.is_restricted
            && self.environment.quirks != Quirks::All
            && self.boxes[id].mode == crate::types::WritingMode::HorizontalTb
            && !self.boxes[id].has_legend;
        let open = [joins && inset.top == 0.0, joins && inset.bottom == 0.0];
        let setting = Setting::new(
            basis,
            [open[0], open[1], passes_height, style.is_rtl()],
            style.text.align,
            style.layout.justify_items,
        );
        let it = &self.boxes[id];
        output.ignores_floats =
            is_simple && joins && it.outside_marker == 0 && style.layout.clear == Clear::None;
        let mut gathers = is_simple
            && it.children.len() > 8
            && it.outside_marker == 0
            && !splits_layers
            && !trims_last_margin
            && style.fixed().traits.contains(Traits::IS_PLAIN_INSIDE)
            && it.is_ordinary
            && !it.is_cell();
        let mut contents = crate::scroll::Contents::default();
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
                (output.escapes, output.ignores_floats, gathers) =
                    (output.escapes | it.out_of_flow(), false, false);
                self.pass_out_of_flow(
                    id,
                    index,
                    range,
                    [if id == VIEWPORT { inset.top } else { next }, next],
                    floats,
                );
                continue;
            }
            if it.style.is_floating() {
                output.ignores_floats = false;
                if is_simple && let Some((_, margin, own)) = self.settled(child, setting) {
                    let size = [
                        self.boxes[child].layout.size.width + margin.sums()[0],
                        own.height + margin.sums()[1],
                    ];
                    let at = floats.place(
                        &self.boxes[child].style,
                        range,
                        next,
                        size,
                        self.float_area(child, margin, size, basis.0),
                    );
                    self.place_child(
                        child,
                        [at[0] + margin.left, at[1] + margin.top],
                        margin,
                        basis,
                    );
                    gathers = gathers && contents.add(&self.boxes[child]);
                    self.absorb(child, &own, &mut output);
                    continue;
                }
                let (margin, own_input) = self.shrunk_input(child, basis);
                let (mut own, [horizontal, vertical]) =
                    (self.lay_out(child, own_input, None), margin.sums());
                if is_simple {
                    self.note_settled(child, setting, 0.0);
                }
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
                gathers = gathers && contents.add(&self.boxes[child]);
                self.absorb(child, &own, &mut output);
                continue;
            }
            let adds_floats = it.has_floats && it.joins_formatting_context;
            let clearance = if floats.len() == 0 {
                None
            } else {
                floats.clearance(clears(&it.style))
            };
            let settled = if is_simple && !adds_floats {
                self.settled(child, setting)
            } else {
                None
            };
            let settled = settled.filter(|it| {
                let natural = y + strut.with(it.1.top).and(it.2.margins[0]).sum();
                it.2.ignores_floats
                    || !floats.reach_below(
                        clearance
                            .filter(|it| *it > y.max(natural))
                            .unwrap_or_else(|| y.min(natural)),
                    )
            });
            let it = &self.boxes[child];
            let (mut margin, child_joins) = (
                settled.map_or_else(|| margin(&it.style, basis.0), |it| it.1),
                it.joins_formatting_context,
            );
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
            let auto = it.auto_width_in(&style);
            let (above, below) = (
                if open[0] { 0.0 } else { margin.top },
                if open[1] { 0.0 } else { margin.bottom },
            );
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
            let child_trim = [
                trim[0] && !it.is_foreign(),
                last == Some(child) && !it.is_foreign(),
            ];
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
            let depends_on_top = adds_floats || count > 0 || tally.is_some();
            if let Some((known, _, output)) = settled {
                (x, own) = (inset.left + known, output);
                (top, is_cleared) = position(if child_joins {
                    own.margins[0]
                } else {
                    Strut::default()
                });
            } else if child_joins {
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
            if is_simple
                && settled.is_none()
                && (own.ignores_floats
                    || !floats.reach_below(if is_cleared { top } else { y.min(top) }))
            {
                self.note_settled(child, setting, x - inset.left);
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
            gathers = gathers && contents.add(&self.boxes[child]);
            output.ignores_floats &= own.ignores_floats;
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
            it.pass_baselines(top, margin.bottom, &own, &mut output);
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
            && let Some([baseline, bottom]) = self.clamp_lines(id, lines.max(1) as usize)
        {
            (output.intrinsic, output.last_baseline) = (bottom + inset.bottom, Some(baseline));
        }
        if at_top || at_bottom {
            output.margins[usize::from(!at_top)] = strut;
        }
        if gathers {
            self.gathered.set(Some((id, contents)));
        }
        self.finish_block(id, input, inset, at_top, output, flow)
    }

    fn finish_block(
        &mut self,
        id: BoxId,
        input: &Input,
        inset: Edges,
        at_top: bool,
        mut output: Output,
        mut flow: Option<Flow>,
    ) -> Output {
        if let Some(row) = input.row_baseline.filter(|_| {
            flow.as_ref()
                .is_none_or(|it| it.is_whole(input.height.unwrap_or(0.0)))
        }) {
            let own = output.baselines[0]
                .filter(|_| !self.boxes[id].style.contain().contains(Contain::LAYOUT))
                .unwrap_or(output.intrinsic);
            self.shift_children(id, row - own, &mut output, flow.as_mut());
            output.intrinsic += row - own;
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
            if it.style.is_out_of_flow() {
                it.static_position[1].0 += offset;
                it.cache.settled = None;
            }
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

    /// Returns the baseline and the end of the last line, if there are more.
    fn clamp_lines(&mut self, id: BoxId, count: usize) -> Option<[f32; 2]> {
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
            inline.lines.visible = (total > count && len >= remaining).then_some(remaining as u32);
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
                bottom = Some([y + last.baseline, end]);
                let truncation = self.truncate(
                    &inline.lines,
                    &inline.clusters,
                    last,
                    &self.boxes[lines].style,
                    true,
                );
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

impl LayoutBox {
    fn auto_width_in(&self, parent: &Style) -> AutoSize {
        match justify_self(&self.style, parent).0 {
            _ if self.node == 0 && self.kind != Kind::Table => AutoSize::Fill,
            AlignName::Normal
                if !self.shrinks_to_fit && !self.is_replaced() && !self.is_orthogonal() =>
            {
                AutoSize::Fill
            }
            AlignName::Stretch if self.kind != Kind::Table => AutoSize::Stretch,
            _ => AutoSize::Fit,
        }
    }

    /// To the block that it is in.
    #[inline(always)]
    fn pass_baselines(&self, top: f32, margin_bottom: f32, own: &Output, output: &mut Output) {
        if !self.is_replaced() {
            let placed = |baseline: f32| top + self.clamp_baseline(baseline, own.height);
            output.baselines[0] = output.baselines[0].or_else(|| own.baselines[0].map(placed));
            output.last_baseline = own.last_baseline.map(placed).or(output.last_baseline);
            let last = match self.kind {
                Kind::Table => None,
                Kind::Block if self.scrolls() => Some(own.height + margin_bottom),
                Kind::Block | Kind::Lines | Kind::Columns => own.baselines[1],
                _ => own.baselines[0],
            };
            output.baselines[1] = last.map(|it| top + it).or(output.baselines[1]);
        }
    }
}

pub(crate) fn justify_self(item: &Style, parent: &Style) -> Align {
    match (item.layout.justify_self, parent.layout.justify_items) {
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
