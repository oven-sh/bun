//! Vertical writing modes. The layout algorithms only know `horizontal-tb`: while a box is laid out, it and its children are
//! turned, so that their width is along its lines. Outside of that everything is physical, but for what is in `Lines`.

use std::rc::Rc;

use crate::abi::{Matrix, Rect};
use crate::boxes::{BoxId, Kind, LayoutBox, VIEWPORT};
use crate::document::Document;
use crate::layout::{
    AutoSize, Edges, Input, Output, Point, Room, Widths, clamp, margin, unit, uses_parent,
};
use crate::positioned::Edge;
use crate::properties::Style;
use crate::types::*;
use crate::values::{Lp, PositiveLp, Size};

use WritingMode::{HorizontalTb, SidewaysLr, SidewaysRl, VerticalLr, VerticalRl};

impl WritingMode {
    pub(crate) fn is_vertical(self) -> bool {
        self != HorizontalTb
    }

    /// The physical sides that take the places of the top, the right, the bottom and the left.
    pub(crate) fn sides(self) -> [usize; 4] {
        match self {
            HorizontalTb => [0, 1, 2, 3],
            VerticalRl | SidewaysRl => [1, 2, 3, 0],
            VerticalLr => [3, 2, 1, 0],
            SidewaysLr => [3, 0, 1, 2],
        }
    }

    /// Whether the turned axes go up and to the left.
    pub(crate) fn reverses(self) -> [bool; 2] {
        [self == SidewaysLr, matches!(self, VerticalRl | SidewaysRl)]
    }

    /// Whether the text has its top towards the next line.
    pub(crate) fn flips_lines(self) -> bool {
        self == VerticalLr
    }

    /// The mode in which the top is that of the text.
    pub(crate) fn of_lines(self) -> WritingMode {
        if self.flips_lines() { VerticalRl } else { self }
    }

    pub(crate) fn turn_sides<T: Clone>(self, physical: &[T; 4]) -> [T; 4] {
        self.sides().map(|side| physical[side].clone())
    }

    pub(crate) fn physical_sides<T: Clone>(self, turned: &[T; 4]) -> [T; 4] {
        let mut physical = turned.clone();
        self.sides()
            .into_iter()
            .zip(turned)
            .for_each(|(side, it)| physical[side] = it.clone());
        physical
    }

    pub(crate) fn turn_axes<T>(self, [x, y]: [T; 2]) -> [T; 2] {
        if self.is_vertical() { [y, x] } else { [x, y] }
    }

    /// From turned coordinates in a box of the turned `size`.
    pub(crate) fn to_physical(self, size: [f32; 2]) -> Matrix {
        match self {
            HorizontalTb => IDENTITY,
            VerticalRl | SidewaysRl => [0.0, 1.0, -1.0, 0.0, size[1], 0.0],
            VerticalLr => [0.0, 1.0, 1.0, 0.0, 0.0, 0.0],
            SidewaysLr => [0.0, -1.0, 1.0, 0.0, 0.0, size[0]],
        }
    }

    fn mirror(self, position: [(f32, Edge); 2], size: [f32; 2]) -> [(f32, Edge); 2] {
        [0, 1].map(|axis| match (self.reverses()[axis], position[axis]) {
            (true, (at, edge)) => (size[axis] - at, edge.opposite()),
            (false, it) => it,
        })
    }

    pub(crate) fn turn_position(
        self,
        position: [(f32, Edge); 2],
        size: [f32; 2],
    ) -> [(f32, Edge); 2] {
        self.mirror(self.turn_axes(position), size)
    }
}

impl Style {
    pub(crate) fn has_central_baseline(&self) -> bool {
        matches!(self.text.writing_mode, VerticalRl | VerticalLr)
            && self.text.orientation != TextOrientation::Sideways
    }

    fn made_up_baseline(&self, lines: WritingMode, size: f32) -> f32 {
        match () {
            () if self.has_central_baseline() => unit(size / 2.0),
            () if lines.flips_lines() => 0.0,
            () => size,
        }
    }

    /// Whether the inline or the block axis starts at the right or at the bottom.
    pub(crate) fn runs_back(&self, axis: usize) -> bool {
        (axis == 0 && self.is_rtl()) != self.text.writing_mode.reverses()[axis]
    }

    fn turned(&self, mode: WritingMode) -> Style {
        let mut style = self.clone();
        macro_rules! sides {
            ($group:ident: $($a:ident $b:ident $c:ident $d:ident),+) => {
                let (from, to) = (&self.$group, Rc::make_mut(&mut style.groups.$group));
                $([to.$a, to.$b, to.$c, to.$d] = mode.turn_sides(&[&from.$a, &from.$b, &from.$c, &from.$d]).map(Clone::clone);)+
            };
        }
        sides!(layout: margin_top margin_right margin_bottom margin_left, padding_top padding_right padding_bottom padding_left,
            top right bottom left, border_top border_right border_bottom border_left,
            border_top_style border_right_style border_bottom_style border_left_style);
        sides!(paint: border_top border_right border_bottom border_left);
        let l = Rc::make_mut(&mut style.groups.layout);
        core::mem::swap(&mut l.width, &mut l.height);
        core::mem::swap(&mut l.min_width, &mut l.min_height);
        core::mem::swap(&mut l.max_width, &mut l.max_height);
        core::mem::swap(&mut l.overflow_x, &mut l.overflow_y);
        if self.rare.intrinsic_width != self.rare.intrinsic_height {
            let rare = Rc::make_mut(&mut style.groups.rare);
            core::mem::swap(&mut rare.intrinsic_width, &mut rare.intrinsic_height);
        }
        if self.has_central_baseline() {
            [style.metrics.ascent, style.metrics.descent] =
                centered(self.metrics.ascent, self.metrics.descent);
        }
        style
    }
}

pub(crate) fn centered(ascent: f32, descent: f32) -> [f32; 2] {
    let descent_now = ((ascent + descent) / 2.0).floor();
    [ascent + descent - descent_now, descent_now]
}

impl LayoutBox {
    /// Whether it is turned for another writing mode than its own.
    pub(crate) fn is_foreign(&self) -> bool {
        self.turned != self.mode && !self.is_replaced()
    }

    pub(crate) fn is_orthogonal(&self) -> bool {
        self.turned.is_vertical() != self.mode.is_vertical() && !self.is_replaced()
    }

    /// Whether `self-start` is at the right or at the bottom.
    pub(crate) fn starts_far(&self, axis: usize) -> bool {
        let (mode, rtl) = (self.style.text.writing_mode, self.style.is_rtl());
        let own_axis = axis ^ usize::from(mode.is_vertical() != self.turned.is_vertical());
        (own_axis == 0 && rtl) != (mode.reverses()[own_axis] != self.turned.reverses()[axis])
    }

    /// For alignment along `axis` of `container`. Returns whether it is measured from the far side of the margin box, the distance,
    /// and whether it is made up. `flips` swaps the sides.
    pub(crate) fn aligned_baseline(
        &self,
        container: &Style,
        axis: usize,
        [is_last, flips]: [bool; 2],
        own: &Output,
        size: f32,
        margin: Edges,
    ) -> (bool, f32, bool) {
        let (mode, outer) = (self.style.text.writing_mode, self.turned);
        let lines = match (axis, mode.is_vertical() == outer.is_vertical()) {
            (1, true) | (0, false) => mode,
            (1, false) => outer,
            _ if outer.is_vertical() => HorizontalTb,
            _ if container.is_rtl() => VerticalRl,
            _ => VerticalLr,
        };
        let starts_far = matches!(
            outer.sides().iter().position(|it| *it == lines.sides()[0]),
            Some(1 | 2)
        );
        let own = if self.is_foreign() {
            self.cache.performed().1
        } else {
            *own
        };
        let real = (if is_last {
            own.last_baseline
        } else {
            own.baselines[0]
        })
        .filter(|_| lines == mode && !self.is_replaced());
        let baseline = real.map_or_else(
            || container.made_up_baseline(lines, size),
            |it| self.clamp_baseline(it, size),
        );
        let is_far = starts_far != (is_last != flips);
        (
            is_far,
            margin.along(axis)[usize::from(is_far)]
                + if is_last != flips {
                    size - baseline
                } else {
                    baseline
                },
            real.is_none(),
        )
    }

    /// The first and the last that it gives to `container`.
    pub(crate) fn baselines_for(&self, container: &Style, own: &Output) -> [f32; 2] {
        [own.baselines[0], own.last_baseline].map(|it| {
            match it.filter(|_| !self.is_foreign() && !self.is_replaced()) {
                Some(it) => self.clamp_baseline(it, own.height),
                None => container.made_up_baseline(self.turned, own.height),
            }
        })
    }

    pub(crate) fn spans_columns(&self) -> bool {
        self.style.rare.column_span == ColumnSpan::All
            && !self.style.is_floating()
            && !self.style.is_out_of_flow()
            && self.node != 0
    }

    /// The physical one.
    pub(crate) fn block_axis(&self) -> usize {
        usize::from(!self.mode.is_vertical())
    }

    pub(crate) fn size(&self) -> [f32; 2] {
        [self.layout.size.width, self.layout.size.height]
    }

    fn swap_axes(&mut self) {
        self.overflow.swap(0, 1);
        self.ratio = self.ratio.map(f32::recip);
        core::mem::swap(&mut self.layout.size.width, &mut self.layout.size.height);
    }

    fn move_sides(&mut self, from: WritingMode, to: WritingMode) {
        fn moved<T: Clone>(sides: &mut [T; 4], from: WritingMode, to: WritingMode) {
            *sides = to.turn_sides(&from.physical_sides(sides));
        }
        for edges in [
            &mut self.layout.border,
            &mut self.layout.padding,
            &mut self.layout.margin,
        ] {
            *edges = Edges::new(to.turn_sides(&from.physical_sides(&edges.to_array())));
        }
        self.collapsed.iter_mut().for_each(|it| moved(it, from, to));
    }
}

impl Document {
    pub(crate) fn turned_style(&self, style: &Rc<Style>, mode: WritingMode) -> Rc<Style> {
        if !mode.is_vertical() {
            return Rc::clone(style);
        }
        let mut known = self.boxes.turned_styles.borrow_mut();
        let entry = known.entry((Rc::as_ptr(style).addr(), mode as u8));
        Rc::clone(&entry.or_insert_with(|| [Rc::clone(style), Rc::new(style.turned(mode))])[1])
    }

    /// Returns what it was turned for. The location stays as it is.
    pub(crate) fn turn(&mut self, id: BoxId, mode: WritingMode) -> WritingMode {
        let old = self.boxes[id].turned;
        if old != mode {
            let it = &mut self.boxes[id];
            let physical = it.physical.take().unwrap_or_else(|| Rc::clone(&it.style));
            let style = self.turned_style(&physical, mode);
            let it = &mut self.boxes[id];
            (it.style, it.physical, it.turned) =
                (style, mode.is_vertical().then_some(physical), mode);
            if old.is_vertical() != mode.is_vertical() {
                it.swap_axes();
            }
            it.move_sides(old, mode);
            if it.node != 0 {
                it.uses_parent = uses_parent(&it.style).map(|uses| uses || it.is_orthogonal());
            }
        }
        old
    }

    fn children_and_marker(&self, id: BoxId) -> Vec<BoxId> {
        let it = &self.boxes[id];
        it.children
            .iter()
            .copied()
            .chain(Some(it.outside_marker).filter(|it| *it != 0))
            .collect()
    }

    /// Those that the algorithm of `id` looks at.
    pub(crate) fn turn_children(&mut self, id: BoxId, mode: WritingMode) {
        self.boxes[id].has_turned_children = mode.is_vertical();
        for child in self.children_and_marker(id) {
            self.turn(child, mode);
            let it = &self.boxes[child];
            if matches!(it.kind, Kind::Row | Kind::RowGroup | Kind::Column) {
                self.turn_children(child, mode);
            }
        }
    }

    /// Makes the children physical, once they have been placed and the size of `id` is known.
    pub(crate) fn settle_children(&mut self, id: BoxId) {
        let (mode, size) = (self.boxes[id].turned, self.boxes[id].size());
        if !self.boxes[id].has_turned_children {
            return;
        }
        for child in self.children_and_marker(id) {
            let it = &mut self.boxes[child];
            match it.style.is_out_of_flow() {
                true => it.static_position = mode.turn_axes(mode.mirror(it.static_position, size)),
                false => self.settle(child, mode, size),
            }
            if self.boxes[child].kind == Kind::Column {
                self.settle_children(child);
            }
            self.turn(child, HorizontalTb);
        }
        self.turn_children(id, HorizontalTb);
    }

    /// Makes the location physical. `size` is that of the container.
    pub(crate) fn settle(&mut self, id: BoxId, mode: WritingMode, size: [f32; 2]) {
        let layout = &mut self.boxes[id].layout;
        let rect = Rect::new([
            layout.location.x,
            layout.location.y,
            layout.size.width,
            layout.size.height,
        ]);
        let Rect { x, y, .. } = rect.transformed(&mode.to_physical(size));
        layout.location = Point { x, y };
    }

    /// From the coordinates of the fragments to those of the border box.
    pub(crate) fn line_matrix(&self, id: BoxId) -> Option<Matrix> {
        let it = &self.boxes[id];
        let is_turned = it.mode.is_vertical() && it.kind == Kind::Lines;
        is_turned.then(|| {
            it.mode.of_lines().to_physical(if it.turned.is_vertical() {
                it.size()
            } else {
                it.mode.turn_axes(it.size())
            })
        })
    }

    pub(crate) fn from_lines(&self, id: BoxId, rect: Rect) -> Rect {
        self.line_matrix(id)
            .map_or(rect, |it| rect.transformed(&it))
    }

    pub(crate) fn lines_to_viewport(&self, id: BoxId) -> Matrix {
        let matrix = self.to_viewport(id);
        self.line_matrix(id)
            .map_or(matrix, |it| multiply(&matrix, &it))
    }

    /// With the box turned for its own mode. Percentages of paddings still refer to `basis`.
    fn in_own_mode<T>(&mut self, id: BoxId, basis: f32, run: impl FnOnce(&mut Document) -> T) -> T {
        let is_orthogonal = self.boxes[id].is_orthogonal();
        let outer = self.turn(id, HorizontalTb);
        let it = &mut self.boxes[id];
        let (original, padding) = (Rc::clone(&it.style), it.padding(basis));
        if is_orthogonal && uses_parent(&original)[0] {
            let l = Rc::make_mut(&mut Rc::make_mut(&mut it.style).groups.layout);
            [
                l.padding_top,
                l.padding_right,
                l.padding_bottom,
                l.padding_left,
            ] = padding.to_array().map(|it| PositiveLp(Lp::Px(it)));
            if core::mem::replace(&mut it.layout.padding, padding) != padding {
                it.cache.clear();
            }
        }
        self.turn(id, self.boxes[id].mode);
        let result = run(self);
        self.turn(id, HorizontalTb);
        self.boxes[id].style = original;
        self.turn(id, outer);
        result
    }

    /// The space along the lines of an orthogonal box whose containing block has no definite height.
    fn fallback_height(&mut self, id: BoxId) -> f32 {
        self.boxes.sized_by_viewport.insert(id);
        let (mode, viewport) = (self.boxes[id].turned, &self.boxes[VIEWPORT]);
        let gutters = viewport.turned.turn_axes(viewport.gutters().sums());
        let axis = usize::from(!mode.is_vertical());
        let around = core::iter::successors(Some(self.boxes[id].parent), |it| {
            Some(self.boxes[*it].parent).filter(|it| *it != 0)
        });
        let block = around
            .map(|it| &self.boxes[it])
            .find(|it| it.node != 0)
            .unwrap_or(viewport);
        let edges = block.border_and_padding(0.0).sums();
        let fixed = |size: &Size, index| {
            Some(
                block.resolve_size(size, index, &Room::default(), edges, &mut |_| None)? - edges[1],
            )
        };
        let l = &block.style.layout;
        let limits = [
            fixed(&l.min_height, 3).unwrap_or(0.0),
            fixed(&l.max_height.0, 5).unwrap_or(f32::INFINITY),
        ];
        clamp(fixed(&l.height, 1).unwrap_or(f32::INFINITY), limits)
            .min(self.environment.viewport[axis] - gutters[axis])
    }

    /// What `room` is in the mode of an orthogonal box.
    fn own_room(&mut self, id: BoxId, room: &Room) -> Room {
        let margins = margin(&self.boxes[id].style, room.basis[0].unwrap_or(0.0)).sums()[1];
        let basis = room.basis[1].unwrap_or_else(|| self.fallback_height(id));
        let available = room.available[1].unwrap_or(basis - margins);
        Room {
            available: [Some(available.max(0.0)), room.available[0]],
            basis: [Some(basis), room.basis[0]],
            height: None,
        }
    }

    pub(crate) fn orthogonal_widths(&mut self, id: BoxId, room: &Room) -> Widths {
        let own = self.own_room(id, room);
        self.in_own_mode(id, room.basis[0].unwrap_or(0.0), |document| {
            let width = room
                .height
                .unwrap_or_else(|| document.resolve_width(id, &own, AutoSize::Fit));
            Widths {
                sizes: [document.content_height(id, width, &own); 2],
                uses_height: true,
            }
        })
    }

    /// The min-content and max-content heights of an orthogonal box in an area of that width, as its style limits them.
    pub(crate) fn orthogonal_heights(
        &mut self,
        id: BoxId,
        width: Option<f32>,
        stretched: Option<f32>,
    ) -> [f32; 2] {
        self.in_own_mode(id, width.unwrap_or(0.0), |document| {
            let margins = margin(&document.boxes[id].style, 0.0).sums()[0];
            document
                .contribution(id, width, stretched)
                .sizes
                .map(|it| it - margins)
        })
    }

    /// The min-content height of an orthogonal box, whatever its style says.
    pub(crate) fn orthogonal_min_content(&mut self, id: BoxId, width: f32, basis: f32) -> f32 {
        self.in_own_mode(id, basis, |document| {
            let edges = document.boxes[id].border_and_padding(0.0).sums();
            document
                .content_widths(
                    id,
                    &Room {
                        height: Some(width),
                        ..Room::default()
                    },
                    edges,
                    true,
                )
                .sizes[0]
        })
    }

    pub(crate) fn foreign_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        match self.boxes[id].is_orthogonal() {
            true => self.orthogonal_widths(id, &Room::default()),
            false => self.in_own_mode(id, 0.0, |document| document.intrinsic_widths(id, height)),
        }
    }

    pub(crate) fn lay_out_foreign(&mut self, id: BoxId, input: Input) -> Output {
        let it = &self.boxes[id];
        if !it.is_orthogonal() {
            let is_flipped = it.mode.reverses()[1] != it.turned.reverses()[1];
            let keeps_baselines = it.style.has_central_baseline()
                == self.boxes[it.parent].style.has_central_baseline();
            let mut output =
                self.in_own_mode(id, 0.0, |document| document.lay_out(id, input, None));
            let seen = |it: Option<f32>| {
                Some(if is_flipped { output.height - it? } else { it? }).filter(|_| keeps_baselines)
            };
            (output.baselines, output.last_baseline) =
                (output.baselines.map(seen), seen(output.last_baseline));
            return output;
        }
        let is_indefinite = it.has_auto_size(0) && !input.has_definite_width;
        let room = Room {
            available: [None, input.stretch],
            basis: [Some(input.basis.0), input.basis.1],
            height: None,
        };
        let room = self.own_room(id, &room);
        self.in_own_mode(id, input.basis.0, |document| {
            let edges = document.boxes[id].border_and_padding(0.0).sums();
            let intrinsic = document
                .resolve_width_value(id, &Size::FitContent, 0, &room, edges, &Size::Auto)
                .unwrap_or(0.0);
            let width = match input.height {
                Some(height) => height,
                None if input.ignores_height => intrinsic,
                None => document.resolve_width(id, &room, AutoSize::Fit),
            };
            let own = Input {
                height: Some(input.width),
                is_indefinite,
                ..document.input_for(id, width, &room)
            };
            let escapes = document.lay_out(id, own, None).escapes;
            Output {
                height: width,
                intrinsic,
                escapes,
                ..Output::default()
            }
        })
    }
}
