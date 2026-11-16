//! What all layout algorithms share: sizes, the cache, and replaced elements.

use core::sync::atomic::{AtomicU32, Ordering};
use std::rc::Rc;

use smallvec::SmallVec;

use crate::block::Floats;
use crate::boxes::{BoxId, Kind, LayoutBox, VIEWPORT};
use crate::document::Document;
use crate::fragment::Breaks;
use crate::name::{is_name, name};
use crate::properties::Style;
use crate::selector::Pseudo;
use crate::types::*;
use crate::values::{Auto, Lp, Normal, PositiveLp, Size};

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Point {
    pub(crate) x: f32,
    pub(crate) y: f32,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Dimensions {
    pub(crate) width: f32,
    pub(crate) height: f32,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Edges {
    pub(crate) top: f32,
    pub(crate) right: f32,
    pub(crate) bottom: f32,
    pub(crate) left: f32,
}

impl Edges {
    pub(crate) fn new([top, right, bottom, left]: [f32; 4]) -> Edges {
        Edges {
            top,
            right,
            bottom,
            left,
        }
    }

    pub(crate) fn to_array(self) -> [f32; 4] {
        [self.top, self.right, self.bottom, self.left]
    }

    /// Horizontal and vertical.
    pub(crate) fn sums(self) -> [f32; 2] {
        [self.left + self.right, self.top + self.bottom]
    }

    /// Left and right, or top and bottom.
    pub(crate) fn along(self, axis: usize) -> [f32; 2] {
        if axis == 0 {
            [self.left, self.right]
        } else {
            [self.top, self.bottom]
        }
    }

    pub(crate) fn set(&mut self, axis: usize, [start, end]: [f32; 2]) {
        match axis {
            0 => (self.left, self.right) = (start, end),
            _ => (self.top, self.bottom) = (start, end),
        }
    }
}

impl core::ops::Add for Edges {
    type Output = Edges;
    fn add(self, other: Edges) -> Edges {
        Edges::new([
            self.top + other.top,
            self.right + other.right,
            self.bottom + other.bottom,
            self.left + other.left,
        ])
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Layout {
    pub(crate) location: Point,
    pub(crate) size: Dimensions,
    pub(crate) border: Edges,
    pub(crate) padding: Edges,
    pub(crate) margin: Edges,
}

static UNITS: AtomicU32 = AtomicU32::new(64.0_f32.to_bits());

/// Lengths are multiples of 1/64 of a device pixel, as in Blink, so that they add up to the same.
pub(crate) fn units_per_pixel() -> f32 {
    f32::from_bits(UNITS.load(Ordering::Relaxed))
}

/// It is taken as a power of two, for which the multiples are exact.
pub(crate) fn set_scale_of_units(scale: f32) {
    UNITS.store(
        ((64 << (scale.clamp(1.0, 8.0) as u32).ilog2()) as f32).to_bits(),
        Ordering::Relaxed,
    );
}

pub(crate) fn unit(value: f32) -> f32 {
    let units = units_per_pixel();
    (value.clamp(-33_554_428.0, 33_554_428.0) * units).trunc() / units
}

pub(crate) fn ceil_to_unit(value: f32) -> f32 {
    let units = units_per_pixel();
    (value * units - 0.01).ceil() / units
}

pub(crate) fn resolve(length: &Lp, basis: f32) -> f32 {
    unit(length.resolve(basis))
}

pub(crate) fn resolve_if_definite(length: &Lp, basis: Option<f32>) -> Option<f32> {
    match length {
        Lp::Px(px) => Some(unit(*px)),
        _ => Some(resolve(length, basis?)),
    }
}

/// The minimum wins.
pub(crate) fn clamp(value: f32, [min, max]: [f32; 2]) -> f32 {
    value.min(max).max(min)
}

pub(crate) fn gap(gap: &Normal<PositiveLp>, basis: Option<f32>) -> f32 {
    gap.0
        .as_ref()
        .map_or(0.0, |it| resolve(&it.0, basis.unwrap_or(0.0)))
}

/// Margins that collapse.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Strut {
    positive: f32,
    negative: f32,
}

impl Strut {
    pub(crate) fn with(self, margin: f32) -> Strut {
        Strut {
            positive: self.positive.max(margin),
            negative: self.negative.min(margin),
        }
    }

    pub(crate) fn and(self, other: Strut) -> Strut {
        self.with(other.positive).with(other.negative)
    }

    pub(crate) fn sum(self) -> f32 {
        self.positive + self.negative
    }
}

/// What a box is laid out for. The parent decides on the width.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Input {
    pub(crate) width: f32,
    /// Overrides what the style says.
    pub(crate) height: Option<f32>,
    /// Percentages do not refer to `height`.
    pub(crate) is_indefinite: bool,
    /// Percentages refer to `width`, even if that is the block axis of the box.
    pub(crate) has_definite_width: bool,
    /// The height is that of the contents.
    pub(crate) ignores_height: bool,
    /// What percentages refer to.
    pub(crate) basis: (f32, Option<f32>),
    /// The height for `stretch`.
    pub(crate) stretch: Option<f32>,
    /// For a cell that is aligned to it.
    pub(crate) row_baseline: Option<f32>,
    /// Whether `text-box-trim` applies to the first and to the last line.
    pub(crate) trim: [bool; 2],
    /// Above the box.
    pub(crate) room_for_annotations: f32,
    /// For a cell with a height, or in a table with one: scroll containers with percentages of it do not make it grow.
    pub(crate) is_restricted: bool,
    /// Quirks: nothing separates it from the start of the body or of a cell.
    pub(crate) is_at_quirky_start: bool,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Output {
    pub(crate) height: f32,
    /// The height that the contents ask for, if none was known beforehand.
    pub(crate) intrinsic: f32,
    /// The first one, and the one of an inline block.
    pub(crate) baselines: [Option<f32>; 2],
    pub(crate) last_baseline: Option<f32>,
    /// Below the text of the last line.
    pub(crate) room_for_annotations: f32,
    /// The margins of the contents that collapse with those of the box.
    pub(crate) margins: [Strut; 2],
    pub(crate) collapses_through: bool,
    /// The contents would change if the same height were known beforehand.
    pub(crate) uses_height: bool,
    /// It has added floats to the formatting context around it.
    pub(crate) has_floats: bool,
    pub(crate) escapes: Claims,
}

bitflags::bitflags! {
    /// Kinds of out-of-flow boxes.
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct Claims: u8 {
        const ABSOLUTE = 1;
        const FIXED = 2;
    }
}

/// The min-content and max-content widths, and whether they depend on the height of the containing block.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Widths {
    pub(crate) sizes: [f32; 2],
    pub(crate) uses_height: bool,
}

#[derive(Default)]
pub(crate) struct Cache {
    /// What the boxes inside are laid out for.
    performed: Option<(Input, Output)>,
    /// With the pass that has last asked.
    measured: SmallVec<[(Input, Output, u32); 1]>,
    /// The one that has last asked for `performed`.
    pass: u32,
    /// A pass has laid it out for more than one width.
    had_other_width: bool,
    widths: Option<(Option<f32>, Widths)>,
    /// The contents have changed, and the rest is only there to be compared with.
    is_stale: bool,
}

impl Cache {
    pub(crate) fn clear(&mut self) {
        (self.performed, self.widths, self.is_stale) = (None, None, false);
        self.measured.clear();
    }

    fn remember(&mut self, input: Input, output: Output, pass: u32) {
        if !self.measured.iter().any(|it| it.0 == input) {
            self.measured.truncate(3);
            self.measured.insert(0, (input, output, pass));
        }
    }

    /// Whether some are still in use.
    fn forget_other_widths(&mut self) -> bool {
        let (width, pass) = (self.performed.as_ref().map(|it| it.0.width), self.pass);
        self.measured
            .retain(|it| Some(it.0.width) == width || it.2 == pass);
        self.measured.iter().any(|it| Some(it.0.width) != width)
    }

    pub(crate) fn forget_layout(&mut self) {
        self.performed = None;
        self.measured.clear();
    }

    /// Whether it was not yet.
    pub(crate) fn make_stale(&mut self) -> bool {
        !core::mem::replace(&mut self.is_stale, true)
    }

    pub(crate) fn is_current(&self) -> bool {
        self.performed.is_some() && !self.is_stale
    }

    pub(crate) fn collapsed_bottom_margin(&self) -> Strut {
        self.performed
            .as_ref()
            .map_or_else(Strut::default, |it| it.1.margins[1])
    }

    /// Whether an out-of-flow box in it has its containing block outside.
    pub(crate) fn has_escapees(&self) -> bool {
        self.performed
            .as_ref()
            .is_none_or(|it| !it.1.escapes.is_empty())
    }

    pub(crate) fn performed(&self) -> (Input, Output) {
        self.performed.unwrap_or_default()
    }

    pub(crate) fn collapses_through(&self) -> bool {
        self.performed
            .as_ref()
            .is_some_and(|it| it.1.collapses_through)
    }

    pub(crate) fn escapes(&self) -> Claims {
        self.performed
            .as_ref()
            .map_or(Claims::empty(), |it| it.1.escapes)
    }
}

/// `width`, `height`, and their minimums and maximums.
pub(crate) fn sizes(style: &Style) -> [&Size; 6] {
    let l = &style.layout;
    [
        &l.width,
        &l.height,
        &l.min_width,
        &l.min_height,
        &l.max_width.0,
        &l.max_height.0,
    ]
}

pub(crate) fn is_relative(size: &Size) -> bool {
    match size {
        Size::Length(it) => !matches!(it, Lp::Px(_)),
        Size::Stretch => true,
        Size::Calc(calc) => is_relative(&calc.0) || calc.1.has_percentage(),
        _ => false,
    }
}

/// Whether the layout of a box reads the width and the height of its containing block.
pub(crate) fn uses_parent(style: &Style) -> [bool; 2] {
    let l = &style.layout;
    let paddings = [
        &l.padding_top,
        &l.padding_right,
        &l.padding_bottom,
        &l.padding_left,
    ];
    [
        paddings.iter().any(|it| !matches!(it.0, Lp::Px(_))),
        [&l.height, &l.min_height, &l.max_height.0]
            .into_iter()
            .any(is_relative),
    ]
}

fn positioned_claims(style: &Style) -> Claims {
    let is_positioned = style.is_positioned()
        || style
            .effects
            .will_change
            .0
            .contains(crate::properties::WillChange::POSITION);
    if is_positioned {
        Claims::ABSOLUTE
    } else {
        Claims::empty()
    }
}

pub(crate) fn claims(style: &Style, is_inline: bool) -> Claims {
    let will_change = style.effects.will_change.0;
    let fixed = match is_inline {
        true => {
            !style.effects.filter.0.is_empty()
                || !style.effects.backdrop_filter.0.is_empty()
                || will_change.contains(crate::properties::WillChange::FILTER)
        }
        false => style.contains_fixed(),
    };
    if fixed {
        Claims::all()
    } else {
        positioned_claims(style)
    }
}

pub(crate) fn margins(style: &Style) -> [&Auto<Lp>; 4] {
    let l = &style.layout;
    [
        &l.margin_top,
        &l.margin_right,
        &l.margin_bottom,
        &l.margin_left,
    ]
}

/// `auto` is zero.
pub(crate) fn margin(style: &Style, basis: f32) -> Edges {
    Edges::new(margins(style).map(|it| it.0.as_ref().map_or(0.0, |it| resolve(it, basis))))
}

pub(crate) fn auto_margins(style: &Style, axis: usize) -> [bool; 2] {
    let [top, right, bottom, left] = margins(style).map(|it| it.0.is_none());
    if axis == 0 {
        [left, right]
    } else {
        [top, bottom]
    }
}

/// What is known about a box while its width is resolved.
#[derive(Clone, Copy, Default)]
pub(crate) struct Room {
    /// Without the margins.
    pub(crate) available: [Option<f32>; 2],
    pub(crate) basis: [Option<f32>; 2],
    /// Overrides what the style says.
    pub(crate) height: Option<f32>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AutoSize {
    Fit,
    /// Yields to an aspect ratio.
    Fill,
    Stretch,
}

impl LayoutBox {
    pub(crate) fn padding(&self, basis: f32) -> Edges {
        let l = &self.style.layout;
        match self.kind {
            Kind::Table if self.collapsed.is_some() => Edges::default(),
            Kind::Row | Kind::RowGroup => Edges::default(),
            _ => Edges::new(
                [
                    &l.padding_top,
                    &l.padding_right,
                    &l.padding_bottom,
                    &l.padding_left,
                ]
                .map(|it| resolve(&it.0, basis)),
            ),
        }
    }

    pub(crate) fn border_and_padding(&self, basis: f32) -> Edges {
        Edges::new(self.border()) + self.padding(basis)
    }

    /// What the scrollbars take from the padding box.
    pub(crate) fn gutters(&self) -> Edges {
        if self.scrollbars == [false; 2] {
            return Edges::default();
        }
        let [horizontal, vertical] = self
            .scrollbars
            .map(|has| if has { self.scrollbar_size } else { 0.0 });
        let both = self
            .style
            .layout
            .scrollbar_gutter
            .contains(ScrollbarGutter::BOTH_EDGES);
        if self.mode.is_vertical() || self.turned.is_vertical() {
            let [top, left] = self
                .mode
                .turn_axes([0.0, 1.0])
                .map(|it| if both { it } else { 0.0 });
            let [right, left] = if self.style.is_rtl() && !self.mode.is_vertical() {
                [left, 1.0]
            } else {
                [1.0, left]
            };
            return Edges::new(self.turned.turn_sides(&[
                top * horizontal,
                right * vertical,
                horizontal,
                left * vertical,
            ]));
        }
        let other = if both { vertical } else { 0.0 };
        let (left, right) = if self.style.is_rtl() {
            (vertical, other)
        } else {
            (other, vertical)
        };
        Edges {
            top: 0.0,
            right,
            bottom: horizontal,
            left,
        }
    }

    /// From the border box to the content box.
    pub(crate) fn inset(&self, basis: f32) -> Edges {
        self.border_and_padding(basis) + self.gutters()
    }

    pub(crate) fn claims(&self) -> Claims {
        match self.node {
            _ if self.is_foreign_object => Claims::all(),
            crate::tree::DOCUMENT => Claims::all(),
            0 => Claims::empty(),
            _ if self.parent == crate::boxes::VIEWPORT
                && self.tag == crate::name::name!("html")
                && !self.style.contains_fixed_as_root() =>
            {
                positioned_claims(&self.style)
            }
            _ => claims(&self.style, false),
        }
    }

    /// Empty for a box in flow.
    pub(crate) fn out_of_flow(&self) -> Claims {
        match self.style.layout.position {
            PositionKind::Absolute => Claims::ABSOLUTE,
            PositionKind::Fixed => Claims::FIXED,
            _ => Claims::empty(),
        }
    }

    /// Whether they make no difference to what is around it.
    fn ignores_contents(&self) -> bool {
        self.style
            .contain()
            .contains(Contain::SIZE | Contain::LAYOUT)
    }

    pub(crate) fn clamp_baseline(&self, baseline: f32, height: f32) -> f32 {
        if self.scrolls() {
            baseline.clamp(0.0, height.max(0.0))
        } else {
            baseline
        }
    }

    pub(crate) fn is_cell(&self) -> bool {
        self.style.display() == Display::TableCell
    }

    pub(crate) fn width_uses_height(&self) -> bool {
        self.ratio.is_some()
            || self.is_orthogonal()
            || self.cache.widths.is_some_and(|it| it.1.uses_height)
    }

    pub(crate) fn is_compressible(&self) -> bool {
        self.is_replaced()
            || is_name!(
                self.tag,
                "input" | "textarea" | "select" | "meter" | "progress"
            ) && !self.style.look.is_checkable()
    }

    /// What `box-sizing` leaves out.
    fn outside(&self, border_and_padding: [f32; 2]) -> [f32; 2] {
        match self.style.layout.box_sizing {
            BoxSizing::ContentBox => border_and_padding,
            BoxSizing::BorderBox => [0.0; 2],
        }
    }

    /// The size along `axis` that the aspect ratio gives for a size along the other.
    pub(crate) fn transfer(
        &self,
        axis: usize,
        other: f32,
        border_and_padding: [f32; 2],
    ) -> Option<f32> {
        let ratio = self.ratio?;
        let outside = match self.style.layout.aspect_ratio.auto
            || self.style.layout.aspect_ratio.value().is_none()
        {
            true => border_and_padding,
            false => self.outside(border_and_padding),
        };
        let inner = other.max(border_and_padding[1 - axis]) - outside[1 - axis];
        let size = outside[axis]
            + if axis == 0 {
                inner * ratio
            } else {
                inner / ratio
            };
        Some(unit(size + 0.001).max(border_and_padding[axis]))
    }

    /// One of `sizes`, or `flex-basis`. `content` answers for the keywords.
    pub(crate) fn resolve_size(
        &self,
        size: &Size,
        index: usize,
        room: &Room,
        border_and_padding: [f32; 2],
        content: &mut dyn FnMut(&Size) -> Option<f32>,
    ) -> Option<f32> {
        let axis = index % 2;
        let outside = self.outside(border_and_padding)[axis];
        let resolved = match size {
            Size::Length(length) => resolve_if_definite(length, room.basis[axis])? + outside,
            Size::Stretch => room.available[axis]?,
            Size::Anchor(_) => return None,
            Size::Any => outside,
            Size::Calc(calc) => {
                let basis = match &calc.0 {
                    Size::Length(length) => resolve_if_definite(length, room.basis[axis])?,
                    basis => {
                        self.resolve_size(basis, index, room, border_and_padding, content)?
                            - outside
                    }
                };
                calc.1
                    .resolve(room.basis[axis].unwrap_or(0.0), basis, &|_| None)?
                    .max(0.0)
                    + outside
            }
            keyword => content(keyword)?,
        };
        Some(resolved.max(border_and_padding[axis]))
    }

    /// `min-height` and `max-height`. Their keywords stand for `intrinsic`.
    pub(crate) fn height_limits(
        &self,
        room: &Room,
        border_and_padding: [f32; 2],
        intrinsic: Option<f32>,
    ) -> [f32; 2] {
        let l = &self.style.layout;
        let mut content = |size: &Size| intrinsic.filter(|_| *size != Size::Auto);
        let min = match &l.min_height {
            Size::Auto => None,
            Size::Length(_) if room.basis[1].is_none() => self.resolve_size(
                &l.min_height,
                3,
                &Room {
                    basis: [None, Some(0.0)],
                    ..*room
                },
                border_and_padding,
                &mut content,
            ),
            min => self.resolve_size(min, 3, room, border_and_padding, &mut content),
        };
        let max = match &l.max_height.0 {
            Size::Auto => None,
            max => self.resolve_size(max, 5, room, border_and_padding, &mut content),
        };
        [
            min.unwrap_or(border_and_padding[1]),
            max.unwrap_or(f32::INFINITY),
        ]
    }

    pub(crate) fn has_auto_size(&self, axis: usize) -> bool {
        *sizes(&self.style)[axis].basis() == Size::Auto
    }

    /// From the style alone. `auto` is `for_auto`, and the other keywords are `intrinsic`.
    pub(crate) fn styled_height(
        &self,
        room: &Room,
        border_and_padding: [f32; 2],
        for_auto: Option<f32>,
        intrinsic: Option<f32>,
    ) -> Option<f32> {
        let mut content = |size: &Size| {
            if *size == Size::Auto {
                for_auto
            } else {
                intrinsic
            }
        };
        let height = (self.resolve_size(
            &self.style.layout.height,
            1,
            room,
            border_and_padding,
            &mut content,
        ))
        .or(for_auto)?;
        Some(clamp(
            height,
            self.height_limits(room, border_and_padding, intrinsic),
        ))
    }

    /// The height, if the contents have no say in it. `intrinsic` is `None` before they are laid out.
    pub(crate) fn used_height(&self, input: &Input, intrinsic: Option<f32>) -> Option<f32> {
        if input.height.is_some() {
            return input
                .height
                .filter(|_| !input.is_indefinite || intrinsic.is_some());
        }
        if input.ignores_height {
            return intrinsic;
        }
        let edges = self.border_and_padding(input.basis.0).sums();
        let room = Room {
            available: [None, input.stretch],
            basis: [Some(input.basis.0), input.basis.1],
            height: None,
        };
        if self.legend_excess != 0.0 {
            let height = self.styled_height(
                &room,
                [edges[0], edges[1] - self.legend_excess],
                intrinsic,
                intrinsic,
            );
            return height.map(|it| it.max(edges[1]));
        }
        if self.is_cell() {
            let least = self.resolve_size(
                &self.style.layout.height,
                1,
                &Room::default(),
                edges,
                &mut |_| None,
            );
            return intrinsic.map(|it| it.max(least.unwrap_or(0.0)));
        }
        let Some(transferred) = self.transfer(1, input.width, edges) else {
            return self.styled_height(&room, edges, intrinsic, intrinsic);
        };
        let height = self.styled_height(&room, edges, Some(transferred), Some(transferred))?;
        let is_specified = self
            .resolve_size(&self.style.layout.height, 1, &room, edges, &mut |_| None)
            .is_some();
        match intrinsic {
            Some(intrinsic)
                if !is_specified
                    && self.style.layout.min_height == Size::Auto
                    && !self.overflow[1].scrolls() =>
            {
                Some(height.max(intrinsic.min(self.height_limits(&room, edges, None)[1])))
            }
            _ => Some(height),
        }
    }

    /// The height of the content box, for percentages.
    pub(crate) fn inner_height(&self, input: &Input, inset: Edges) -> Option<f32> {
        match self.used_height(input, None) {
            Some(height) => Some((height - inset.sums()[1]).max(0.0)),
            None if self.fills_parent => self
                .filled_height(input, [Strut::default(); 2])
                .map(|it| (it - inset.sums()[1]).max(0.0)),
            None => input
                .basis
                .1
                .filter(|_| self.node == 0 || self.passes_height && self.has_auto_size(1)),
        }
    }

    /// `margins` are those of the contents that collapse with its own.
    fn filled_height(&self, input: &Input, [top, bottom]: [Strut; 2]) -> Option<f32> {
        let own = margin(&self.style, input.basis.0);
        input
            .basis
            .1
            .filter(|_| self.has_auto_size(1))
            .map(|it| it - top.with(own.top).sum() - bottom.with(own.bottom).sum())
    }
}

impl Document {
    /// Of the border box, for a content box of that height.
    pub(crate) fn intrinsic_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let it = &mut self.boxes[id];
        if it.is_foreign() {
            return self.foreign_widths(id, height);
        }
        if it.cache.is_stale {
            it.cache.clear();
        }
        if let Some((known, widths)) = it.cache.widths
            && (!widths.uses_height || known == height)
        {
            return widths;
        }
        let (inset, turns) = (
            it.inset(0.0).sums()[0],
            it.turned.is_vertical() && !it.has_turned_children,
        );
        if turns {
            self.turn_children(id, self.boxes[id].mode);
        }
        self.measuring += 1;
        let legend = self.boxes[id]
            .has_legend
            .then(|| self.boxes[id].children.remove(0));
        let mut widths = match (self.fixed_content_size(id)[0], self.boxes[id].kind) {
            (Some(width), kind) if kind != Kind::Table => Widths {
                sizes: [width; 2],
                uses_height: false,
            },
            (_, Kind::Lines) => self.lines_widths(id, height),
            (_, Kind::Flex) => self.flex_widths(id, height),
            (_, Kind::Grid) => self.grid_widths(id, height),
            (_, Kind::Table) => self.table_widths(id, false),
            (_, Kind::Columns) => self.columns_widths(id, height),
            (_, Kind::Math) => self.math_widths(id, height),
            _ if self.boxes[id].style.display().is_math()
                && let Some(widths) = self.token_widths(id) =>
            {
                widths
            }
            _ => self.block_widths(id, height),
        };
        if let Some(legend) = legend {
            self.boxes[id].children.insert(0, legend);
            let own = self.contribution(legend, height, None).sizes;
            if self.fixed_content_size(id)[0].is_none() {
                widths.sizes = [0, 1].map(|it| widths.sizes[it].max(own[it]));
            }
        }
        self.measuring -= 1;
        if turns {
            self.turn_children(id, WritingMode::HorizontalTb);
        }
        if self.boxes[id].kind != Kind::Table {
            widths.sizes = widths.sizes.map(|it| it.max(0.0) + inset);
        }
        widths.sizes[1] = widths.sizes[1].max(widths.sizes[0]);
        self.boxes[id].cache.widths = Some((height, widths));
        widths
    }

    /// `min-content` and `max-content`, which an aspect ratio `transfers` from a definite height.
    pub(crate) fn content_widths(
        &mut self,
        id: BoxId,
        room: &Room,
        edges: [f32; 2],
        transfers: bool,
    ) -> Widths {
        let it = &self.boxes[id];
        let passes = it.node == 0 || it.passes_height && it.has_auto_size(1);
        let reads_parent = it.uses_parent[1] || passes;
        if it.is_replaced() {
            let width = self.replaced_size(id, room, None, [true, false])[0];
            return Widths {
                sizes: [width; 2],
                uses_height: it.ratio.is_some(),
            };
        }
        let height = room
            .height
            .or_else(|| it.styled_height(room, edges, None, None));
        if transfers && let Some(width) = height.and_then(|height| it.transfer(0, height, edges)) {
            return Widths {
                sizes: [width; 2],
                uses_height: true,
            };
        }
        if it.is_orthogonal() {
            return self.orthogonal_widths(id, room);
        }
        let inner = height.map(|height| (height - edges[1] - it.gutters().sums()[1]).max(0.0));
        let inner = inner.or_else(|| room.basis[1].filter(|_| passes));
        let percentages = edges[0] - it.border_and_padding(0.0).sums()[0];
        let mut widths = self.intrinsic_widths(id, inner);
        let it = &self.boxes[id];
        widths.sizes = widths.sizes.map(|it| it + percentages);
        if transfers && it.ratio.is_some() {
            widths.sizes = widths
                .sizes
                .map(|width| clamp(width, self.transferred_width_limits(id, room, edges)));
            widths.uses_height = true;
        }
        widths.uses_height &= reads_parent || it.has_auto_size(1);
        widths
    }

    pub(crate) fn transferred_width_limits(
        &self,
        id: BoxId,
        room: &Room,
        edges: [f32; 2],
    ) -> [f32; 2] {
        let it = &self.boxes[id];
        let [min, max] = it.height_limits(room, edges, None);
        let min = it.transfer(0, min, edges).filter(|_| min > edges[1]);
        let max = it.transfer(0, max, edges).filter(|_| max.is_finite());
        [min.unwrap_or(0.0), max.unwrap_or(f32::INFINITY)]
    }

    /// One of the widths of `sizes`, or `flex-basis`. `auto` is `for_auto`.
    pub(crate) fn resolve_width_value(
        &mut self,
        id: BoxId,
        size: &Size,
        index: usize,
        room: &Room,
        edges: [f32; 2],
        for_auto: &Size,
    ) -> Option<f32> {
        let keyword = if *size.basis() == Size::Auto {
            for_auto
        } else {
            size.basis()
        };
        let content = match keyword {
            Size::Auto | Size::Any | Size::Length(_) | Size::Anchor(_) => None,
            Size::Stretch => room.available[0],
            _ => {
                let [min, max] = self.content_widths(id, room, edges, true).sizes;
                Some(match (keyword, room.available[0]) {
                    (Size::MinContent, _) => min,
                    (Size::FitContent, Some(available)) => clamp(available, [min, max]),
                    _ => max,
                })
            }
        };
        self.boxes[id].resolve_size(size, index, room, edges, &mut |_| content)
    }

    pub(crate) fn width_limits(&mut self, id: BoxId, room: &Room, edges: [f32; 2]) -> [f32; 2] {
        let l = &self.boxes[id].style.layout;
        if (&l.min_width, &l.max_width.0) == (&Size::Auto, &Size::Auto) {
            return [edges[0], f32::INFINITY];
        }
        let l = Rc::clone(l);
        let min = match (&l.min_width, room.basis[0]) {
            (Size::Length(_), None) => {
                let room = Room {
                    basis: [Some(0.0), None],
                    ..*room
                };
                self.resolve_width_value(id, &l.min_width, 2, &room, edges, &Size::Auto)
            }
            (min, _) => self.resolve_width_value(id, min, 2, room, edges, &Size::Auto),
        };
        let max = self.resolve_width_value(id, &l.max_width.0, 4, room, edges, &Size::Auto);
        [min.unwrap_or(edges[0]), max.unwrap_or(f32::INFINITY)]
    }

    pub(crate) fn resolve_width(&mut self, id: BoxId, room: &Room, auto: AutoSize) -> f32 {
        let it = &self.boxes[id];
        if it.kind == Kind::Lines
            && auto != AutoSize::Fit
            && let Some(available) = room.available[0]
        {
            return available.max(0.0);
        }
        if it.is_replaced() {
            let width =
                room.available[0].filter(|_| auto == AutoSize::Stretch && it.has_auto_size(0));
            return self.replaced_size(id, room, width, [false; 2])[0];
        }
        if it.kind == Kind::Table && !it.is_orthogonal() {
            return self.table_width(id, room, auto);
        }
        let (edges, l) = (
            it.border_and_padding(room.basis[0].unwrap_or(0.0)).sums(),
            Rc::clone(&it.style.layout),
        );
        let is_auto = it.has_auto_size(0);
        let transfers = it.ratio.is_some()
            && !(is_auto && auto == AutoSize::Stretch)
            && !matches!(l.width, Size::Length(_) | Size::Stretch)
            && room
                .height
                .or_else(|| it.styled_height(room, edges, None, None))
                .is_some();
        let for_auto = match auto {
            _ if transfers => Size::FitContent,
            AutoSize::Fit => Size::FitContent,
            _ if room.available[0].is_none() => Size::MaxContent,
            _ => Size::Stretch,
        };
        let width = self.resolve_width_value(id, &l.width, 0, room, edges, &for_auto);
        let mut width = width
            .or_else(|| {
                self.resolve_width_value(id, &Size::Auto, 0, room, edges, &Size::FitContent)
            })
            .unwrap_or(0.0);
        let mut limits = self.width_limits(id, room, edges);
        let it = &self.boxes[id];
        if it.ratio.is_some() && is_auto && !transfers && auto != AutoSize::Stretch {
            width = clamp(width, self.transferred_width_limits(id, room, edges));
        }
        if transfers && l.min_width == Size::Auto && !it.overflow[0].scrolls() {
            limits[0] = self.content_widths(id, room, edges, false).sizes[0].min(limits[1]);
        }
        clamp(width, limits)
    }

    /// With the margins. `height` is that of the containing block, and `stretched` what the box gets for `height: auto`.
    pub(crate) fn contribution(
        &mut self,
        id: BoxId,
        height: Option<f32>,
        stretched: Option<f32>,
    ) -> Widths {
        let least = if self.boxes[id].kind == Kind::Table {
            self.table_min_width(id)
        } else {
            0.0
        };
        let it = &self.boxes[id];
        let (edges, l, margin) = (
            it.border_and_padding(0.0).sums(),
            Rc::clone(&it.style.layout),
            margin(&it.style, 0.0).sums(),
        );
        let available = height.map(|it| it - margin[1]);
        let room = Room {
            available: [None, available],
            basis: [None, height],
            height: stretched,
        };
        let is_compressed =
            it.is_compressible() && (is_relative(&l.width) || is_relative(&l.max_width.0));
        let mut widths = match &l.width {
            _ if it.is_replaced() => {
                let width = self.replaced_size(id, &room, None, [false; 2])[0];
                Widths {
                    sizes: [width; 2],
                    uses_height: it.ratio.is_some() && (it.uses_parent[1] || it.has_auto_size(1)),
                }
            }
            Size::Length(Lp::Px(_)) | Size::MinContent | Size::MaxContent => {
                let width = self
                    .resolve_width_value(id, &l.width, 0, &room, edges, &Size::Auto)
                    .unwrap_or(0.0);
                Widths {
                    sizes: [width; 2],
                    uses_height: !matches!(l.width, Size::Length(_))
                        && self.content_widths(id, &room, edges, true).uses_height,
                }
            }
            width => {
                let mut widths = self.content_widths(id, &room, edges, true);
                if let Size::Calc(_) = width {
                    widths.sizes = [Size::MinContent, Size::MaxContent].map(|auto| {
                        let room = Room {
                            available: [(auto == Size::MinContent).then_some(0.0), available],
                            ..room
                        };
                        self.resolve_width_value(id, width, 0, &room, edges, &auto)
                            .unwrap_or(0.0)
                    });
                }
                let it = &self.boxes[id];
                if it.ratio.is_some() && l.min_width == Size::Auto && !it.overflow[0].scrolls() {
                    let least = self.content_widths(id, &room, edges, false).sizes[0];
                    widths.sizes = widths.sizes.map(|it| it.max(least));
                }
                widths
            }
        };
        if is_compressed {
            let room = Room {
                basis: [Some(0.0), height],
                available: [Some(0.0), available],
                ..room
            };
            widths.sizes[0] = widths.sizes[0].min(self.resolve_width(id, &room, AutoSize::Fit));
        }
        let mut limits = [self.width_limits(id, &room, edges); 2];
        let is_keyword =
            |it: &Size| matches!(it, Size::MinContent | Size::MaxContent | Size::FitContent);
        if is_keyword(&l.min_width) || is_keyword(&l.max_width.0) {
            widths.uses_height |= self.content_widths(id, &room, edges, true).uses_height;
            if l.min_width == Size::FitContent || l.max_width.0 == Size::FitContent {
                limits[0] = self.width_limits(
                    id,
                    &Room {
                        available: [Some(0.0), available],
                        ..room
                    },
                    edges,
                );
            }
        }
        widths.sizes = [0, 1].map(|it| {
            clamp(widths.sizes[it], [limits[it][0].max(least), limits[it][1]]) + margin[0]
        });
        widths
    }

    /// For a child whose height is up to its style.
    pub(crate) fn input_for(&self, id: BoxId, width: f32, room: &Room) -> Input {
        let stretches = sizes(&self.boxes[id].style)
            .iter()
            .skip(1)
            .step_by(2)
            .any(|it| matches!(it, Size::Stretch | Size::Calc(_)))
            || self.boxes[id].is_orthogonal();
        Input {
            width,
            height: room.height,
            basis: (room.basis[0].unwrap_or(0.0), room.basis[1]),
            stretch: room.available[1].filter(|_| stretches),
            ..Input::default()
        }
    }

    /// For a box with `height: auto` that is stretched.
    pub(crate) fn clamp_height(&mut self, id: BoxId, height: f32, width: f32, room: &Room) -> f32 {
        let l = &self.boxes[id].style.layout;
        let is_keyword = |it: &Size| {
            !matches!(
                it,
                Size::Auto | Size::Length(_) | Size::Stretch | Size::Anchor(_)
            )
        };
        let intrinsic = (is_keyword(&l.min_height) || is_keyword(&l.max_height.0))
            .then(|| self.content_height(id, width, room));
        let it = &self.boxes[id];
        it.styled_height(
            room,
            it.border_and_padding(room.basis[0].unwrap_or(0.0)).sums(),
            Some(height),
            intrinsic,
        )
        .unwrap_or(height)
    }

    /// The height with `height: auto`, and with neither limits nor an aspect ratio.
    pub(crate) fn content_height(&mut self, id: BoxId, width: f32, room: &Room) -> f32 {
        let input = self.input_for(
            id,
            width,
            &Room {
                height: None,
                ..*room
            },
        );
        let ignores_height = self.boxes[id].used_height(&input, None).is_some();
        self.measure(
            id,
            Input {
                ignores_height,
                ..input
            },
        )
        .intrinsic
    }

    fn normalized(&self, id: BoxId, mut input: Input) -> Input {
        let it = &self.boxes[id];
        if !it.uses_parent[0] && !it.fills_parent {
            input.basis.0 = 0.0;
        }
        if !it.uses_parent[1] && !it.passes_height && !it.fills_parent {
            input.basis.1 = None;
        }
        input.is_indefinite &= input.height.is_some();
        input
    }

    /// Like `lay_out`, which has to follow.
    pub(crate) fn measure(&mut self, id: BoxId, input: Input) -> Output {
        if self.boxes[id].is_foreign() {
            return self.lay_out_foreign(id, input);
        }
        let input = self.normalized(id, input);
        let cache = &mut self.boxes[id].cache;
        if !cache.is_stale
            && let Some(index) = cache.measured.iter().position(|it| it.0 == input)
        {
            cache.measured[..=index].rotate_right(1);
            cache.measured[0].2 = self.layout_pass;
            return cache.measured[0].1;
        }
        let output = self.lay_out(id, input, None);
        self.boxes[id]
            .cache
            .remember(input, output, self.layout_pass);
        output
    }

    pub(crate) fn lay_out(
        &mut self,
        id: BoxId,
        input: Input,
        mut floats: Option<&mut Floats>,
    ) -> Output {
        if self.boxes[id].is_foreign() {
            return self.lay_out_foreign(id, input);
        }
        let input = self.normalized(id, input);
        let it = &mut self.boxes[id];
        if it.cache.is_stale {
            it.cache.clear();
        }
        it.cache.had_other_width |=
            it.cache.pass == self.layout_pass && it.layout.size.width != input.width;
        it.cache.pass = self.layout_pass;
        let is_affected = floats.as_ref().is_some_and(|it| it.are_in_the_way());
        if let Some((known, output)) = &mut it.cache.performed
            && !is_affected
            && !output.has_floats
        {
            let gets_own_height = || {
                input.height == Some(output.height)
                    && Input {
                        height: None,
                        is_indefinite: false,
                        stretch: known.stretch,
                        ..input
                    } == *known
                    && (!output.uses_height
                        || input.is_indefinite
                            && it.style.layout.height == Size::Auto
                            && it.ratio.is_none())
            };
            if *known == input || gets_own_height() {
                it.layout.size.height = output.height;
                return *output;
            }
            // An ancestor may have been measured with the old result.
            if known.width == input.width && known.basis.1.is_none() && input.basis.1.is_some() {
                let (known, output) = (*known, *output);
                it.cache.remember(known, output, self.layout_pass);
            }
        }
        if self.measuring > 0 {
            let mut ancestor = it.parent;
            while ancestor != 0 {
                self.boxes[ancestor].cache.performed = None;
                ancestor = self.boxes[ancestor].parent;
            }
        }
        let count = floats.as_ref().map_or(0, |it| it.len());
        let mut output = self.compute(id, &input, floats.as_deref_mut());
        output.has_floats = is_affected || floats.is_some_and(|it| it.len() != count);
        let it = &mut self.boxes[id];
        it.cache.performed = Some((input, output));
        it.forget_extents();
        if it.scrolls() {
            self.resized_scrollers.push(it.node);
        }
        output
    }

    /// For a box that may be split.
    pub(crate) fn lay_out_uncached(
        &mut self,
        id: BoxId,
        input: Input,
        floats: Option<&mut Floats>,
        breaks: &mut Breaks,
    ) -> Output {
        let (input, keeps_turned) = (
            self.normalized(id, input),
            self.boxes[id].has_turned_children,
        );
        if self.boxes[id].cache.is_stale {
            self.boxes[id].cache.clear();
        }
        let output = Output {
            has_floats: true,
            ..self.run_algorithm(id, &input, floats, Some(breaks))
        };
        if keeps_turned {
            self.turn_children(id, self.boxes[id].mode);
        }
        self.boxes[id].cache.performed = Some((input, output));
        self.boxes[id].forget_extents();
        output
    }

    fn compute(&mut self, id: BoxId, input: &Input, mut floats: Option<&mut Floats>) -> Output {
        let (snapshot, keeps_turned) = (
            floats.as_ref().map(|it| it.len()),
            self.boxes[id].has_turned_children,
        );
        let mut output = self.run_algorithm(id, input, floats.as_deref_mut(), None);
        for attempt in 0..3 {
            if !self.update_scrollbars(id, attempt == 0) {
                break;
            }
            floats
                .iter_mut()
                .zip(snapshot)
                .for_each(|(floats, len)| floats.truncate(len));
            output = self.run_algorithm(id, input, floats.as_deref_mut(), None);
        }
        if keeps_turned {
            self.turn_children(id, self.boxes[id].mode);
        }
        output
    }

    fn run_algorithm(
        &mut self,
        id: BoxId,
        input: &Input,
        floats: Option<&mut Floats>,
        mut breaks: Option<&mut Breaks>,
    ) -> Output {
        if !self.boxes.pieces.is_empty() {
            self.boxes.pieces.remove(&id);
        }
        if self.boxes[id].is_parking {
            self.boxes.parked.entry(id).or_default().fits = false;
        }
        let it = &mut self.boxes[id];
        (it.layout.border, it.layout.padding) =
            (Edges::new(it.border()), it.padding(input.basis.0));
        it.layout.size.width = input.width;
        if it.turned.is_vertical() && !it.is_replaced() {
            self.turn_children(id, self.boxes[id].mode);
        }
        let legend = self.boxes[id]
            .has_legend
            .then(|| self.lay_out_legend(id, input));
        let mut output = match self.boxes[id].kind {
            Kind::Lines => self.lay_out_lines(id, input, floats, breaks.as_deref_mut()),
            Kind::Replaced | Kind::Svg | Kind::Bullet => self.lay_out_replaced(id, input),
            Kind::Flex => self.lay_out_flex(id, input, breaks.as_deref_mut()),
            Kind::Grid => self.lay_out_grid(id, input, breaks.as_deref_mut()),
            Kind::Table => self.lay_out_table(id, input, breaks.as_deref_mut()),
            Kind::Columns => self.lay_out_columns(id, input, breaks.as_deref_mut()),
            Kind::Math => self.lay_out_math(id, input),
            _ => self.lay_out_block(id, input, floats, breaks.as_deref_mut()),
        };
        if self.environment.has_math {
            match self.boxes[id].kind {
                Kind::Block if self.boxes[id].style.display().is_math() => {
                    self.finish_token(id, input, &mut output)
                }
                Kind::Table => {
                    output.baselines[0] = self
                        .math_table_baseline(id, output.height)
                        .or(output.baselines[0])
                }
                _ => {}
            }
        }
        if let Some((legend, own)) = legend {
            self.boxes[id].children.insert(0, legend);
            self.absorb(legend, &own, &mut output);
        }
        if self.boxes[id].style.contain().contains(Contain::LAYOUT) {
            (output.baselines, output.last_baseline) = ([None; 2], None);
        }
        if self.boxes[id].kind != Kind::Block || output.baselines[0].is_none() {
            output.last_baseline = output.baselines[1];
        }
        self.place_outside_marker(id, input, &mut output);
        self.boxes[id].layout.size.height = output.height;
        self.settle_children(id);
        self.lay_out_positioned(id, &mut output, breaks);
        match self.boxes[id].is_skipped {
            true => Output {
                height: output.height,
                intrinsic: output.intrinsic,
                ..Output::default()
            },
            false => output,
        }
    }

    /// Takes it out of the children.
    fn lay_out_legend(&mut self, id: BoxId, input: &Input) -> (BoxId, Output) {
        let it = &mut self.boxes[id];
        it.legend_excess = 0.0;
        let (legend, edges, style) = (
            it.children.remove(0),
            it.border_and_padding(input.basis.0),
            Rc::clone(&it.style),
        );
        let basis = (
            (input.width - edges.sums()[0]).max(0.0),
            it.inner_height(input, edges),
        );
        let (mut margin, own_input) = self.shrunk_input(legend, basis);
        let (own, border) = (self.lay_out(legend, own_input, None), style.border()[0]);
        let x =
            edges.left + self.align_in_flow(&style, legend, basis.0, own_input.width, &mut margin);
        let y = ((border - own.height) / 2.0).max(0.0);
        self.place_child(legend, [x, y], margin, basis);
        let it = &mut self.boxes[id];
        it.legend_excess = (y + own.height + margin.bottom - border).max(0.0);
        it.layout.border = Edges::new(it.border());
        (legend, own)
    }

    /// Sets `height` from `intrinsic`.
    pub(crate) fn finish_height(
        &self,
        id: BoxId,
        input: &Input,
        inset: Edges,
        output: &mut Output,
    ) {
        if let Some(fixed) = self.fixed_content_size(id)[1] {
            output.intrinsic = fixed + inset.sums()[1] - self.boxes[id].legend_excess;
        }
        if self.boxes[id].fills_parent {
            output.intrinsic = output.intrinsic.max(
                self.boxes[id]
                    .filled_height(input, output.margins)
                    .unwrap_or(0.0),
            );
        }
        output.height = self.boxes[id]
            .used_height(input, Some(output.intrinsic))
            .unwrap_or(output.intrinsic);
    }

    /// `at` is without the relative offset.
    pub(crate) fn place_child(
        &mut self,
        id: BoxId,
        at: [f32; 2],
        margin: Edges,
        basis: (f32, Option<f32>),
    ) {
        let it = &mut self.boxes[id];
        let offset = crate::lines::relative_offset(&it.style, basis.0, basis.1);
        (it.layout.location, it.layout.margin) = (
            Point {
                x: at[0] + offset[0],
                y: at[1] + offset[1],
            },
            margin,
        );
    }

    /// Adds what a child in flow passes on to its parent.
    pub(crate) fn absorb(&self, child: BoxId, own: &Output, output: &mut Output) {
        let it = &self.boxes[child];
        let has_offset = || {
            !matches!(
                (&it.style.layout.top, &it.style.layout.bottom),
                (
                    Inset::Auto | Inset::Length(Lp::Px(_)),
                    Inset::Auto | Inset::Length(Lp::Px(_))
                )
            )
        };
        output.escapes |= own.escapes;
        output.uses_height |= match it.node {
            0 => own.uses_height,
            _ => {
                it.uses_parent[1]
                    || it.fills_parent
                    || it.passes_height && own.uses_height
                    || it.style.layout.position == PositionKind::Relative && has_offset()
            }
        };
    }

    /// Whether the parent has to be laid out again.
    fn refresh(&mut self, id: BoxId) -> bool {
        let it = &mut self.boxes[id];
        it.cache.forget_other_widths();
        let old = core::mem::take(&mut it.cache);
        let Some((input, output)) = old.performed else {
            return true;
        };
        let it = &self.boxes[id];
        let is_subgrid = it.kind == Kind::Grid
            && (it.style.grid.rows.is_subgrid() || it.style.grid.columns.is_subgrid());
        let parent = it.parent;
        if self.boxes[VIEWPORT].size() != self.environment.viewport
            || output.has_floats
            || !output.escapes.is_empty()
            || is_subgrid
            || it.mode.is_vertical()
            || it.is_cell()
            || it.style.display().is_math()
            || matches!(
                it.kind,
                Kind::Table | Kind::Row | Kind::RowGroup | Kind::Column
            )
            || self.boxes[parent].cache.is_stale
            || self.boxes[parent].mode.is_vertical()
            || !self.boxes.pieces.is_empty() && self.is_in_columns(id)
            || self
                .boxes
                .containers(id)
                .take_while(|it| {
                    self.boxes[*it].joins_formatting_context || self.boxes[*it].is_clamped()
                })
                .any(|it| self.boxes[it].is_clamped())
        {
            return true;
        }
        let has_changed = old
            .widths
            .is_some_and(|(height, widths)| self.intrinsic_widths(id, height) != widths)
            || old
                .measured
                .iter()
                .rev()
                .any(|(input, output, _)| self.measure(id, *input) != *output);
        self.boxes[id]
            .cache
            .measured
            .iter_mut()
            .for_each(|it| it.2 = old.pass);
        if has_changed {
            return true;
        }
        let mut floats = Floats::default();
        let joins =
            self.boxes[id].joins_formatting_context && self.boxes[id].is_in_block(&self.boxes);
        floats.enter([0.0; 2], input.width);
        if self.lay_out(id, input, joins.then_some(&mut floats)) != output
            || self.boxes[parent].cache.performed.is_none()
        {
            return true;
        }
        let cache = &mut self.boxes[id].cache;
        (cache.measured, cache.pass, cache.had_other_width) =
            (old.measured, old.pass, old.had_other_width);
        let (mut ancestor, mut matters) = (
            parent,
            old.had_other_width && !self.boxes[id].ignores_contents(),
        );
        while ancestor != 0 {
            let it = &mut self.boxes[ancestor];
            matters = matters && !it.ignores_contents();
            if it.cache.forget_other_widths() && matters {
                return true;
            }
            ancestor = it.parent;
        }
        self.boxes.mark_ink(id);
        self.moved_boxes_in_scrollers.push(id);
        false
    }

    pub(crate) fn lay_out_viewport(&mut self) {
        let [width, height] = self.boxes[VIEWPORT]
            .mode
            .turn_axes(self.environment.viewport);
        if self.boxes[VIEWPORT].size() != self.environment.viewport {
            core::mem::take(&mut self.boxes.sized_by_viewport)
                .into_iter()
                .for_each(|id| self.boxes.mark_layout(id));
        }
        if self.boxes.turned_styles.get_mut().len() > 1024 {
            self.boxes.turned_styles.get_mut().clear();
        }
        for _ in 0..3 {
            self.layout_pass = self.layout_pass.wrapping_add(1);
            let (parked, stale): (Vec<_>, Vec<_>) = (core::mem::take(&mut self.boxes.stale)
                .into_iter())
            .partition(|it| self.boxes.is_parked(*it));
            self.boxes.parked_stale.extend(parked);
            let mut stale: std::collections::BinaryHeap<_> = stale
                .into_iter()
                .map(|id| (self.boxes[id].depth, id))
                .collect();
            while let Some((_, id)) = stale.pop() {
                let it = &self.boxes[id];
                if id != VIEWPORT && it.cache.is_stale && it.kind != Kind::Free && self.refresh(id)
                {
                    let parent = self.boxes[id].parent;
                    if self.boxes[parent].cache.make_stale() {
                        stale.push((self.boxes[parent].depth, parent));
                    }
                }
            }
            self.turn(VIEWPORT, self.boxes[VIEWPORT].mode);
            self.lay_out(
                VIEWPORT,
                Input {
                    width,
                    height: Some(height),
                    ..Input::default()
                },
                None,
            );
            self.turn(VIEWPORT, WritingMode::HorizontalTb);
            let moved = core::mem::take(&mut self.moved_boxes_in_scrollers);
            self.update_scrollers_around(moved);
            for id in core::mem::take(&mut self.changed_scrollbars) {
                self.boxes.mark_layout(id);
            }
            if self.boxes.stale.is_empty() {
                break;
            }
        }
    }

    /// Of the content box, where it does not depend on the contents.
    pub(crate) fn fixed_content_size(&self, id: BoxId) -> [Option<f32>; 2] {
        let it = &self.boxes[id];
        if it.node == 0
            || it.is_cell()
            || matches!(it.kind, Kind::Table | Kind::Row | Kind::RowGroup)
        {
            return [None; 2];
        }
        let (style, element) = (&it.style, self.tree.element(it.node));
        let contain = style.contain()
            | if it.is_skipped {
                Contain::SIZE
            } else {
                Contain::empty()
            };
        let intrinsic = |size: IntrinsicSize, axis: usize| {
            element
                .and_then(|it| it.remembered_size[axis])
                .filter(|_| size.remembers && it.is_skipped)
                .or(size.length)
        };
        let control = || {
            if style.look.is_checkable() {
                return Some([Some(13.0 * style.zoom); 2]);
            }
            let element = element.filter(|_| style.rare.field_sizing == FieldSizing::Fixed)?;
            let count = |name, default| {
                element
                    .number(name)
                    .filter(|it| *it >= 1.0)
                    .unwrap_or(default)
                    .floor()
            };
            let character = style.metrics.average_advance;
            match it.tag {
                tag if tag == name!("textarea") => {
                    let scrolls = matches!(it.overflow[1], Overflow::Auto | Overflow::Scroll);
                    let scrollbar = if scrolls {
                        it.scrollbar_size - it.gutters().sums()[0]
                    } else {
                        0.0
                    };
                    let height = style.line_height() * count(name!("rows"), 2.0);
                    Some([
                        Some((character * count(name!("cols"), 20.0)).ceil() + scrollbar),
                        Some(height),
                    ])
                }
                tag if tag == name!("input") && element.is_text_field() => Some([
                    Some(
                        (character * (count(name!("size"), 20.0) - 1.0)
                            + style.metrics.widest_advance)
                            .ceil(),
                    ),
                    None,
                ]),
                tag if tag == name!("input") && element.input_type() == name!("range") => {
                    Some([Some(129.0 * style.zoom), None])
                }
                tag if tag == name!("input") && element.input_type() == name!("file") => {
                    Some([Some(253.0 * style.zoom), None])
                }
                tag if tag == name!("select")
                    && (element.has(name!("multiple")) || count(name!("size"), 1.0) > 1.0) =>
                {
                    let row =
                        (style.font.size.0 * 1.2).round().max(style.line_height()) + style.zoom;
                    Some([None, Some(row * count(name!("size"), 4.0))])
                }
                _ => None,
            }
        };
        if !contain.intersects(Contain::SIZE | Contain::INLINE_SIZE) {
            return if it.shrinks_to_fit {
                control().unwrap_or_default()
            } else {
                [None; 2]
            };
        }
        let empty_menu = || {
            let texts = &self.boxes[*self.boxes
                [*it.children.first().filter(|_| it.tag == name!("select"))?]
            .children
            .first()?];
            let [width, height] = texts.padding(0.0).sums();
            (texts.node != 0 && texts.tag != name!("option"))
                .then(|| [Some(width), Some(height + style.line_height())])
        };
        let otherwise = control().or_else(empty_menu).unwrap_or_default();
        let has_tracks = [
            matches!(it.kind, Kind::Grid | Kind::Columns),
            it.kind == Kind::Grid,
        ];
        let contained = |size, axis: usize| {
            intrinsic(size, axis)
                .or(otherwise[axis])
                .or_else(|| (!has_tracks[axis]).then_some(0.0))
        };
        let width = contained(style.rare.intrinsic_width, 0);
        match contain.contains(Contain::SIZE) {
            true => [width, contained(style.rare.intrinsic_height, 1)],
            false
                if it.is_replaced()
                    && style.text.writing_mode.is_vertical() != it.turned.is_vertical() =>
            {
                [
                    None,
                    contain
                        .contains(Contain::INLINE_SIZE)
                        .then(|| intrinsic(style.rare.intrinsic_height, 1).unwrap_or(0.0)),
                ]
            }
            false => [width, otherwise[1]],
        }
    }

    /// For `overflow: auto`.
    pub(crate) fn needed_scrollbars(&self, id: BoxId, range: &[[f32; 2]; 2]) -> [bool; 2] {
        let it = &self.boxes[id];
        let padding_box = self.border_box(id).shrunk(it.border());
        let has_room = [
            padding_box.height > it.gutters().bottom
                || !it.has_auto_size(1) && padding_box.height > 0.0,
            padding_box.width > 0.0,
        ];
        let stable = it
            .style
            .layout
            .scrollbar_gutter
            .contains(ScrollbarGutter::STABLE);
        [0, 1].map(|axis| {
            range[axis][1] - range[axis][0] >= 0.5 && has_room[axis]
                || axis == it.block_axis() && stable
        })
    }

    /// Whether `overflow: auto` has changed its mind.
    fn update_scrollbars(&mut self, id: BoxId, may_remove: bool) -> bool {
        if !self.boxes[id].overflow.contains(&Overflow::Auto) {
            return false;
        }
        let turned = self.turn(id, WritingMode::HorizontalTb);
        self.boxes[id].forget_extents();
        let range = self.scroll_range(id);
        let needed = self.needed_scrollbars(id, &range);
        let it = &mut self.boxes[id];
        let before = it.scrollbars;
        let stable = it
            .style
            .layout
            .scrollbar_gutter
            .contains(ScrollbarGutter::STABLE);
        for axis in 0..2 {
            if it.overflow[axis] == Overflow::Auto {
                it.scrollbars[axis] = needed[axis] || before[axis] && !may_remove;
            }
        }
        let fits_without = |axis: usize| range[axis][1] - range[axis][0] <= it.scrollbar_size;
        if may_remove
            && !stable
            && it.overflow == [Overflow::Auto; 2]
            && before == [true; 2]
            && fits_without(0)
            && fits_without(1)
        {
            it.scrollbars = [false; 2];
        }
        let changed = it.scrollbars != before && it.scrollbar_size > 0.0;
        it.forget_extents();
        if changed
            && may_remove
            && it.scrollbars[it.block_axis()] != before[it.block_axis()]
            && it.cache.widths.is_some()
        {
            self.changed_scrollbars.push(id);
        }
        self.turn(id, turned);
        changed
    }

    /// `width` overrides the style. `ignores` leaves out what the style says about the width or the height.
    pub(crate) fn replaced_size(
        &self,
        id: BoxId,
        room: &Room,
        width: Option<f32>,
        ignores: [bool; 2],
    ) -> [f32; 2] {
        let (it, fixed) = (&self.boxes[id], self.fixed_content_size(id));
        let edges = it.border_and_padding(room.basis[0].unwrap_or(0.0)).sums();
        let natural = self.natural_size(id);
        let natural = [0, 1].map(|axis| fixed[axis].or(natural[axis]).map(|it| it + edges[axis]));
        let all = sizes(&it.style);
        let value = |index: usize| {
            let axis = index % 2;
            let mut content = |size: &Size| {
                let mut ignores = ignores;
                ignores[axis] = true;
                let is_size =
                    *size != Size::Auto && (index >= 2 || matches!(all[index], Size::Calc(_)));
                (is_size || matches!(all[index], Size::Calc(_)) && index < 2)
                    .then(|| self.replaced_size(id, room, width, ignores)[axis])
            };
            let room = match (index, room.basis[axis]) {
                (2 | 3, None) => Room {
                    basis: [Some(0.0); 2],
                    ..*room
                },
                _ => *room,
            };
            it.resolve_size(all[index], index, &room, edges, &mut content)
        };
        let limits = [0, 1].map(|axis| match ignores[axis] {
            true => [edges[axis], f32::INFINITY],
            false => [
                value(2 + axis).unwrap_or(edges[axis]),
                value(4 + axis).unwrap_or(f32::INFINITY),
            ],
        });
        let known = |axis: usize, forced: Option<f32>| {
            forced.or_else(|| {
                (!ignores[axis])
                    .then(|| Some(clamp(value(axis)?, limits[axis])))
                    .flatten()
            })
        };
        let (mut width, height) = (
            known(0, width.map(|it| clamp(it, limits[0]))),
            known(1, room.height),
        );
        let (transfer, default) = (
            |axis: usize, other: f32| it.transfer(axis, other, edges),
            it.turned.turn_axes([300.0, 150.0]),
        );
        if (width, height, natural) == (None, None, [None; 2]) && it.ratio.is_some() {
            let limit = |it: f32| transfer(0, it).filter(|_| it.is_finite()).unwrap_or(it);
            let available = room.available[0]
                .unwrap_or_else(|| edges[0] + if is_relative(all[0]) { default[0] } else { 0.0 });
            width = Some(clamp(clamp(available, limits[1].map(limit)), limits[0]));
        }
        let natural = match natural {
            [Some(width), height] => [
                width,
                transfer(1, width)
                    .or(height)
                    .unwrap_or(default[1] + edges[1]),
            ],
            [None, Some(height)] => [transfer(0, height).unwrap_or(default[0] + edges[0]), height],
            [None, None] => [default[0] + edges[0], default[1] + edges[1]],
        };
        match (width, height) {
            (Some(width), Some(height)) => [width, height],
            (Some(width), None) => [
                width,
                clamp(transfer(1, width).unwrap_or(natural[1]), limits[1]),
            ],
            (None, Some(height)) => [
                clamp(transfer(0, height).unwrap_or(natural[0]), limits[0]),
                height,
            ],
            (None, None) => {
                let [width, height] = [0, 1].map(|axis| clamp(natural[axis], limits[axis]));
                let (Some(for_height), Some(for_width)) = (transfer(0, height), transfer(1, width))
                else {
                    return [width, height];
                };
                let keeps_width = match (
                    width.total_cmp(&natural[0]) as i8,
                    height.total_cmp(&natural[1]) as i8,
                ) {
                    (0, 0) | (1, -1) | (-1, 1) => return [width, height],
                    (-1, -1) => width <= for_height,
                    (1, 1) => width >= for_height,
                    (_, height) => height == 0,
                };
                match keeps_width {
                    true => [width, clamp(for_width, limits[1])],
                    false => [clamp(for_height, limits[0]), height],
                }
            }
        }
    }

    fn lay_out_replaced(&mut self, id: BoxId, input: &Input) -> Output {
        let room = Room {
            available: [None, input.stretch],
            basis: [Some(input.basis.0), input.basis.1],
            height: None,
        };
        let intrinsic = self.replaced_size(id, &room, Some(input.width), [true, true])[1];
        let height = input.height.unwrap_or_else(|| match input.ignores_height {
            true => intrinsic,
            false => self.replaced_size(id, &room, Some(input.width), [true, false])[1],
        });
        let mut output = Output {
            height,
            intrinsic,
            ..Output::default()
        };
        if self.boxes[id].kind == Kind::Bullet {
            output.baselines = [Some(self.boxes[id].style.metrics.ascent); 2];
        }
        for index in 0..self.boxes[id].children.len() {
            let child = self.boxes[id].children[index];
            let [at, basis] = self.foreign_placement(self.boxes[child].node, [input.width, height]);
            let room = Room {
                basis: basis.map(Some),
                ..Room::default()
            };
            let it = &self.boxes[child];
            let size = [0, 1].map(|axis| {
                it.resolve_size(sizes(&it.style)[axis], axis, &room, [0.0; 2], &mut |_| None)
                    .unwrap_or(0.0)
            });
            self.lay_out(
                child,
                self.input_for(
                    child,
                    size[0],
                    &Room {
                        height: Some(size[1]),
                        ..room
                    },
                ),
                None,
            );
            self.place_child(child, at, Edges::default(), (0.0, None));
        }
        output
    }

    pub(crate) fn natural_size(&self, id: BoxId) -> [Option<f32>; 2] {
        let it = &self.boxes[id];
        let (style, element) = (&it.style, self.tree.element(it.node));
        if it.kind == Kind::Bullet {
            let (ascent, size, scale) = (
                style.metrics.ascent,
                style.font.size.0,
                self.environment.scale,
            );
            let is_inside = self.boxes[it.parent].kind == Kind::Lines;
            let width = match (crate::counters::is_disclosure(style), is_inside) {
                (true, _) => size * (0.66 + 0.4 / (scale * style.zoom)),
                (false, true) => crate::counters::bullet_size(style, scale) + 1.0 / scale + size,
                (false, false) => (((ascent * scale).round() * 2.0 / 3.0).floor() + 7.0) / scale,
            };
            return [Some(width), Some(ascent + style.metrics.descent)];
        }
        match element.and_then(|it| it.replaced) {
            Some(replaced) if it.tag == name!("iframe") => {
                let (size, default) = (
                    it.turned.turn_axes(replaced.size),
                    it.turned.turn_axes([300.0, 150.0]),
                );
                let follows = match style.other_if_set(crate::properties::Id::FrameSizing) {
                    Some("content-width") => it.turned.turn_axes([true, false]),
                    Some("content-height") => it.turned.turn_axes([false, true]),
                    other => [
                        other == Some("content-inline-size"),
                        other == Some("content-block-size"),
                    ],
                };
                [0, 1].map(|axis| {
                    Some(
                        size[axis]
                            .filter(|_| follows[axis])
                            .unwrap_or(default[axis])
                            * style.zoom,
                    )
                })
            }
            Some(replaced)
                if replaced.size.contains(&None)
                    && self
                        .tree
                        .element(self.tree[it.node].parent)
                        .is_some_and(|it| it.pseudo == crate::selector::Pseudo::Marker) =>
            {
                let natural = replaced.size.map(|it| Some(it? * style.zoom));
                it.turned
                    .turn_axes(crate::background::concrete_size(
                        [None; 2],
                        natural,
                        replaced.ratio,
                        [style.metrics.ascent.round() / 2.0; 2],
                    ))
                    .map(Some)
            }
            Some(replaced) => it
                .turned
                .turn_axes(replaced.viewed(style).0.size)
                .map(|it| Some(it? * style.zoom)),
            None if it.kind == Kind::Svg => it.turned.turn_axes(self.natural_size_of_svg(it.node)),
            None if it.tag == name!("img") || element.is_some_and(|it| it.is_generated()) => {
                [Some(0.0); 2]
            }
            None => [None; 2],
        }
    }

    fn place_outside_marker(&mut self, id: BoxId, input: &Input, output: &mut Output) {
        let marker = self.boxes[id].outside_marker;
        if marker == 0 {
            return;
        }
        let width = self.resolve_width(marker, &Room::default(), AutoSize::Fit);
        let own = self.lay_out(
            marker,
            Input {
                width,
                ..Input::default()
            },
            None,
        );
        let inset = self.boxes[id].inset(input.basis.0);
        let ascent = own.baselines[0].unwrap_or(own.height);
        let baseline = match output.baselines[0] {
            Some(baseline) => {
                let (ascent, descent) = if self.boxes[marker].is_replaced() {
                    (ascent, 0.0)
                } else {
                    (ascent, own.height - own.baselines[1].unwrap_or(ascent))
                };
                let missing = (inset.top + ascent - baseline).max(0.0);
                let bottom = baseline + missing + descent + inset.bottom;
                if missing > 0.0 || bottom > output.intrinsic {
                    self.shift_children(id, missing, output, None);
                    output.intrinsic = (output.intrinsic + missing).max(bottom);
                    self.finish_height(id, input, inset, output);
                }
                baseline + missing
            }
            None => {
                let style = &self.boxes[marker].style;
                let line_height = unit(style.line_height());
                let baseline = inset.top
                    + style.metrics.ascent
                    + ((line_height - style.metrics.ascent - style.metrics.descent) / 2.0).floor();
                output.intrinsic = output
                    .intrinsic
                    .max(line_height.max(own.height) + inset.sums()[1]);
                self.finish_height(id, input, inset, output);
                output.collapses_through &= output.height == 0.0;
                output.baselines = [Some(baseline); 2];
                baseline
            }
        };
        let x = if self.boxes[id].style.is_rtl() {
            input.width
        } else {
            -width
        };
        self.place_child(
            marker,
            [x, baseline - ascent],
            Edges::default(),
            (0.0, None),
        );
    }

    pub(crate) fn scrollbar_size(&self, id: crate::tree::NodeId, style: &Style) -> f32 {
        let (width, colors) = (style.layout.scrollbar_width, &style.ink.scrollbar_color);
        if width == ScrollbarWidth::None {
            return 0.0;
        }
        if width == ScrollbarWidth::Auto
            && colors.0.is_none()
            && let Some(custom) = self.pseudo_style(id, Pseudo::Scrollbar, Default::default())
        {
            return match (
                custom.display(),
                &custom.layout.width,
                &custom.layout.height,
            ) {
                (Display::None, ..) => 0.0,
                (_, Size::Length(size), _) | (_, _, Size::Length(size)) => {
                    size.resolve(0.0).floor()
                }
                _ => 15.0,
            };
        }
        match (self.environment.overlay_scrollbars, width) {
            (true, _) => 0.0,
            (false, ScrollbarWidth::Thin) => 10.0 / self.environment.zoom,
            (false, _) => 15.0 / self.environment.zoom,
        }
    }
}

/// How much of the free space goes before a box, or before the first of `count`, and how much between them.
/// Part `index` of equal parts, which add up to whole units.
pub(crate) fn diffused(part: f32, index: usize) -> f32 {
    let until = |count: usize| (f64::from(part) * count as f64 * 64.0).round() / 64.0;
    (until(index + 1) - until(index)) as f32
}

pub(crate) fn distribute(align: AlignName, free: f32, count: usize) -> (f32, f32) {
    let count = count as f32;
    match align {
        AlignName::Center => (unit(free / 2.0), 0.0),
        AlignName::End => (free, 0.0),
        AlignName::SpaceBetween if free > 0.0 && count > 1.0 => (0.0, free / (count - 1.0)),
        AlignName::SpaceAround if free > 0.0 && count > 0.0 => (free / count / 2.0, free / count),
        AlignName::SpaceEvenly if free > 0.0 => (free / (count + 1.0), free / (count + 1.0)),
        _ => (0.0, 0.0),
    }
}
