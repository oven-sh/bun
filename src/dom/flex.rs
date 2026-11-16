//! Flex layout.

use core::ops::Range;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::block::align_self;
use crate::boxes::{BoxId, Kind};
use crate::document::Document;
use crate::fragment::{Band, Breaks, Member};
use crate::layout::{
    AutoSize, Edges, Input, Output, Room, Widths, auto_margins, clamp, diffused, distribute, gap,
    margin, sizes, unit,
};
use crate::positioned::{Edge, halves};
use crate::properties::Style;
use crate::types::*;
use crate::values::{Lp, Size};

struct Container {
    style: Rc<Style>,
    /// 0 for a row.
    main: usize,
    is_reversed: bool,
    wraps: bool,
    wraps_back: bool,
    /// The least number of lines.
    balanced: Option<usize>,
    align_items: Align,
    /// Of the content box.
    size: [Option<f32>; 2],
}

struct Item {
    id: BoxId,
    margin: Edges,
    room: Room,
    /// Along the main axis, of the border box.
    base: f32,
    limits: [f32; 2],
    edges: f32,
    size: f32,
    is_frozen: bool,
    factors: [f32; 2],
    has_definite_basis: bool,
    align: Align,
    stretches: bool,
    cross: f32,
    /// Whether it is measured from the end of the line, and the distance.
    baseline: Option<(usize, f32)>,
}

struct Line {
    items: Range<usize>,
    cross: f32,
    /// From the start and from the end to the shared baselines.
    ascents: [f32; 2],
}

impl Container {
    fn new(style: &Rc<Style>, size: [Option<f32>; 2]) -> Container {
        let l = &style.layout;
        let (main, is_reversed, wrap, align_items) = match style.display() {
            Display::WebkitBox | Display::WebkitInlineBox => (
                usize::from(style.rare.box_orient == BoxOrient::Vertical),
                false,
                FlexWrap::default(),
                style.rare.box_align,
            ),
            _ => (
                usize::from(matches!(
                    l.flex_direction,
                    FlexDirection::Column | FlexDirection::ColumnReverse
                )),
                matches!(
                    l.flex_direction,
                    FlexDirection::RowReverse | FlexDirection::ColumnReverse
                ),
                l.flex_wrap,
                l.align_items,
            ),
        };
        let balanced = wrap
            .is_balanced
            .then_some(style.rare.flex_line_count.0 as usize);
        Container {
            style: Rc::clone(style),
            main,
            is_reversed,
            wraps: wrap.wraps,
            wraps_back: wrap.is_reversed,
            balanced,
            align_items,
            size,
        }
    }

    /// Along the main and the cross axis.
    fn gaps(&self) -> [f32; 2] {
        let gaps = [
            gap(&self.style.layout.column_gap, self.size[0]),
            gap(&self.style.layout.row_gap, self.size[1]),
        ];
        [gaps[self.main], gaps[1 - self.main]]
    }

    /// Relative to the direction in which things flow along the axis, which `flex-start` and `flex-end` refer to.
    fn along_flow(&self, align: Align, axis: usize, starts_far: bool, free: f32) -> AlignName {
        let is_reversed = if axis == self.main {
            self.is_reversed
        } else {
            self.wraps_back
        };
        match (
            align.0,
            align.resolved(axis, self.style.is_rtl(), starts_far, free),
        ) {
            (AlignName::FlexStart | AlignName::FlexEnd, resolved)
                if !(align.is_safe() && free < 0.0) =>
            {
                resolved
            }
            (_, AlignName::Start) if is_reversed => AlignName::End,
            (_, AlignName::End) if is_reversed => AlignName::Start,
            (_, resolved) => resolved,
        }
    }

    fn content_alignment(&self, align: Align, axis: usize, free: f32, count: usize) -> (f32, f32) {
        let fallback = match align.0 {
            AlignName::SpaceAround | AlignName::SpaceEvenly if free < 0.0 => {
                Align::safe(AlignName::Center)
            }
            _ => align,
        };
        let physical = match fallback.0 {
            AlignName::Left | AlignName::Right
                if axis == 1 && self.style.text.writing_mode.is_vertical() =>
            {
                let is_end = (fallback.0 == AlignName::Right) != self.style.runs_back(1);
                Align(
                    if is_end {
                        AlignName::End
                    } else {
                        AlignName::Start
                    },
                    fallback.1,
                )
            }
            _ => fallback,
        };
        distribute(
            self.along_flow(physical, axis, self.style.is_rtl(), free),
            free,
            count,
        )
    }

    /// Whether things flow towards the left or the top.
    fn is_backwards(&self, axis: usize) -> bool {
        (if axis == self.main {
            self.is_reversed
        } else {
            self.wraps_back
        }) != (axis == 0 && self.style.is_rtl())
    }
}

impl Item {
    fn outer(&self, size: f32, axis: usize) -> f32 {
        size + self.margin.sums()[axis]
    }
}

fn resolve_flexible_lengths(items: &mut [Item], space: f32, main: usize) {
    let hypothetical: f32 = items.iter().map(|it| it.outer(it.size, main)).sum();
    let shrinks = hypothetical >= space;
    for it in items.iter_mut() {
        it.is_frozen = it.factors[usize::from(shrinks)] == 0.0
            || if shrinks {
                it.base < it.size
            } else {
                it.base > it.size
            };
    }
    let free = |items: &[Item]| {
        space
            - items
                .iter()
                .map(|it| it.outer(if it.is_frozen { it.size } else { it.base }, main))
                .sum::<f32>()
    };
    let weight = |it: &Item| {
        f64::from(if shrinks {
            it.factors[1] * (it.base - it.edges)
        } else {
            it.factors[0]
        })
    };
    let initial = free(items);
    while items.iter().any(|it| !it.is_frozen) {
        let unfrozen = || items.iter().filter(|it| !it.is_frozen);
        let (factors, total) = (
            unfrozen()
                .map(|it| it.factors[usize::from(shrinks)])
                .sum::<f32>(),
            unfrozen().map(weight).sum::<f64>(),
        );
        let mut remaining = free(items);
        if factors < 1.0 && (initial * factors).abs() < remaining.abs() {
            remaining = initial * factors;
        }
        let (mut violation, mut error) = (0.0, 0.0);
        let (mut wanted, units) = (
            SmallVec::<[f32; 8]>::new(),
            f64::from(crate::layout::units_per_pixel()),
        );
        for it in items.iter_mut().filter(|it| !it.is_frozen) {
            let exact = match total > 0.0 && (remaining < 0.0) == shrinks {
                true => f64::from(remaining) * weight(it) / total + error,
                false => 0.0,
            };
            let share = (exact * units).round() / units;
            error = exact - share;
            let target = it.base + share as f32;
            it.size = clamp(target, it.limits);
            violation += it.size - target;
            wanted.push(target);
        }
        for (it, target) in items.iter_mut().filter(|it| !it.is_frozen).zip(wanted) {
            it.is_frozen = violation == 0.0
                || if violation > 0.0 {
                    it.size > target
                } else {
                    it.size < target
                };
        }
    }
}

impl Document {
    fn flex_item(&mut self, container: &Container, id: BoxId) -> Item {
        if self.boxes[id].kind == Kind::Table {
            // Its borders may collapse.
            self.table_min_width(id);
        }
        let (it, main) = (&self.boxes[id], container.main);
        let (style, basis) = (Rc::clone(&it.style), container.size[0].unwrap_or(0.0));
        let (margin, edges) = (margin(&style, basis), it.border_and_padding(basis).sums());
        let mut space = container.size;
        if let Some(count) = container.balanced.map(|it| it as f32) {
            space[1 - main] =
                space[1 - main].map(|it| unit((it - container.gaps()[1] * (count - 1.0)) / count));
        }
        let available =
            [0, 1].map(|axis| space[axis].map(|it| (it - margin.sums()[axis]).max(0.0)));
        let mut room = Room {
            available,
            basis: container.size,
            height: None,
        };
        if main == 0 && container.wraps && !it.is_orthogonal() {
            room.available[1] = None;
        }
        let is_webkit_box = matches!(
            container.style.display(),
            Display::WebkitBox | Display::WebkitInlineBox
        );
        let (l, align) = (
            &style.layout,
            if is_webkit_box {
                container.align_items
            } else {
                align_self(&style, container.align_items)
            },
        );
        let stretches = matches!(align.0, AlignName::Normal | AlignName::Stretch)
            && it.has_auto_size(1 - main)
            && auto_margins(&style, 1 - main) == [false; 2];
        let fills = stretches && !container.wraps;
        let (is_table, is_replaced) = (it.kind == Kind::Table, it.is_replaced());
        let min = sizes(&style)[2 + main];
        let is_auto = *min.basis() == Size::Auto;
        let has_automatic_minimum = is_auto && !it.overflow[main].scrolls() && !is_webkit_box;
        let basis = match &l.flex_basis.0 {
            Size::Auto => sizes(&style)[main],
            basis => basis,
        };
        let (base, mut limits, has_definite_basis, mut cross);
        if main == 0 {
            if fills {
                room.height = it.styled_height(&room, edges, available[1], None);
            }
            let resolved = self.resolve_width_value(id, basis, 0, &room, edges, &Size::MaxContent);
            base = resolved.unwrap_or_else(|| self.content_widths(id, &room, edges, true).sizes[1]);
            (limits, has_definite_basis, cross) = (self.width_limits(id, &room, edges), true, 0.0);
            if has_automatic_minimum {
                let specified =
                    self.resolve_width_value(id, &l.width, 0, &room, edges, &Size::Auto);
                let mut content = self.content_widths(id, &room, edges, true).sizes[0];
                if self.boxes[id].ratio.is_some() && !is_replaced {
                    let own = self.content_widths(id, &room, edges, false).sizes[0];
                    content =
                        content.max(own.min(self.transferred_width_limits(id, &room, edges)[1]));
                }
                if self.boxes[id].is_compressible()
                    && crate::layout::is_relative(&l.max_width.0)
                    && container.size[0].is_none()
                {
                    content = edges[0];
                }
                limits[0] = content
                    .min(specified.unwrap_or(content))
                    .min(limits[1])
                    .max(edges[0]);
            }
            if is_table {
                limits[0] = limits[0].max(self.table_min_width(id));
            }
        } else {
            let mut resolved = it.resolve_size(basis, 1, &room, edges, &mut |_| None);
            let width_is_independent = fills
                || !it.has_auto_size(0)
                    && !matches!(
                        l.width,
                        Size::MinContent | Size::MaxContent | Size::FitContent
                    );
            cross = self.resolve_width(
                id,
                &room,
                if fills {
                    AutoSize::Stretch
                } else {
                    AutoSize::Fit
                },
            );
            if let Some(resolved) = resolved.as_mut().filter(|_| is_table) {
                *resolved += self.height_of_captions(id, cross);
            }
            let mut known = None;
            let mut content = |document: &mut Document| {
                *known.get_or_insert_with(|| {
                    let it = &document.boxes[id];
                    if is_replaced && !width_is_independent {
                        return (
                            document.replaced_size(id, &room, None, [false, true])[1],
                            0.0,
                        );
                    }
                    let transferred = it.transfer(1, cross, edges);
                    let intrinsic = document.content_height(id, cross, &room);
                    (transferred.unwrap_or(intrinsic), intrinsic)
                })
            };
            has_definite_basis = resolved.is_some() || self.boxes[id].ratio.is_some();
            base = resolved.unwrap_or_else(|| {
                let content = content(self).0;
                self.boxes[id]
                    .resolve_size(basis, 1, &room, edges, &mut |_| Some(content))
                    .unwrap_or(content)
            });
            let is_keyword =
                |it: &Size| !matches!(it, Size::Auto | Size::Length(_) | Size::Stretch);
            let intrinsic = (!is_auto && is_keyword(&l.min_height) || is_keyword(&l.max_height.0))
                .then(|| content(self).0);
            limits = self.boxes[id].height_limits(&room, edges, intrinsic);
            if has_automatic_minimum || is_table {
                let specified = self.boxes[id]
                    .resolve_size(&l.height, 1, &room, edges, &mut |_| None)
                    .filter(|_| !is_table);
                let (content, intrinsic) = content(self);
                let content = match () {
                    () if is_table => intrinsic,
                    () if self.boxes[id].is_orthogonal() => {
                        self.orthogonal_min_content(id, cross, container.size[0].unwrap_or(0.0))
                    }
                    () => content.max(intrinsic),
                };
                limits[0] =
                    limits[0].max(content.min(specified.unwrap_or(content)).min(if is_table {
                        f32::INFINITY
                    } else {
                        limits[1]
                    }));
            }
        }
        if let (Size::Calc(_), true) = (min, is_auto) {
            let automatic = if has_automatic_minimum {
                limits[0]
            } else {
                edges[main]
            };
            limits[0] = self.boxes[id]
                .resolve_size(min, 2 + main, &room, edges, &mut |_| Some(automatic))
                .unwrap_or(automatic);
        }
        let factors = match is_webkit_box {
            true => [style.rare.box_flex; 2],
            false => [l.flex_grow.0, l.flex_shrink.0],
        };
        let (size, edges) = (clamp(base, limits), edges[main]);
        cross = cross.max(0.0);
        let (is_frozen, baseline) = (false, None);
        Item {
            id,
            margin,
            room,
            base,
            limits,
            edges,
            size,
            is_frozen,
            factors,
            has_definite_basis,
            align,
            stretches,
            cross,
            baseline,
        }
    }

    fn flex_items(&mut self, id: BoxId, container: &Container) -> SmallVec<[Item; 4]> {
        let mut items = SmallVec::new();
        for index in 0..self.boxes[id].children.len() {
            let child = self.boxes[id].children[index];
            if !self.boxes[child].style.is_out_of_flow() {
                items.push(self.flex_item(container, child));
            }
        }
        items
    }

    pub(crate) fn flex_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let container = Container::new(&self.boxes[id].style, [None, height]);
        if container.main == 1 && container.wraps {
            return self.wrapped_columns_widths(id, &container);
        }
        let (mut widths, mut count, mut maxes) = (Widths::default(), 0, Vec::new());
        for index in 0..self.boxes[id].children.len() {
            let child = self.boxes[id].children[index];
            let it = &self.boxes[child];
            if it.style.is_out_of_flow() {
                continue;
            }
            let fills = container.main == 0
                && !container.wraps
                && matches!(
                    align_self(&it.style, container.align_items).0,
                    AlignName::Normal | AlignName::Stretch
                )
                && it.has_auto_size(1)
                && auto_margins(&it.style, 1) == [false; 2];
            let stretched = height.filter(|_| fills).and_then(|height| {
                let room = Room {
                    basis: [None, Some(height)],
                    ..Room::default()
                };
                it.styled_height(
                    &room,
                    it.border_and_padding(0.0).sums(),
                    Some(height - margin(&it.style, 0.0).sums()[1]),
                    None,
                )
            });
            let reads_height = fills || it.uses_parent[1];
            let mut own = self.contribution(child, height, stretched);
            if container.main == 0
                && let Size::Length(Lp::Px(_)) = self.boxes[child].style.layout.flex_basis.0
            {
                let item = self.flex_item(&container, child);
                for size in &mut own.sizes[usize::from(container.wraps)..] {
                    let base = item.outer(item.base, 0);
                    if *size != base && item.factors[usize::from(*size < base)] == 0.0 {
                        *size = item.outer(item.size, 0);
                    }
                }
            }
            let [min, max] = &mut widths.sizes;
            *min = if container.main == 1 || container.wraps {
                min.max(own.sizes[0])
            } else {
                *min + own.sizes[0]
            };
            *max = if container.main == 1 {
                max.max(own.sizes[1])
            } else {
                *max + own.sizes[1]
            };
            widths.uses_height |= own.uses_height && reads_height;
            count += 1;
            maxes.extend(container.balanced.map(|_| own.sizes[1]));
        }
        if container.main == 0 && count > 1 {
            let gaps = container.gaps()[0] * (count - 1) as f32;
            widths.sizes = [
                widths.sizes[0] + if container.wraps { 0.0 } else { gaps },
                widths.sizes[1] + gaps,
            ];
        }
        if let Some(count) = container.balanced.filter(|it| *it > 1) {
            let gap = container.gaps()[0];
            let length =
                |line: Range<usize>| maxes[line].iter().map(|it| it + gap).sum::<f32>() - gap;
            widths.sizes[1] = balance(&maxes, gap, f32::INFINITY, count.min(maxes.len()))
                .into_iter()
                .map(length)
                .fold(0.0, f32::max);
        }
        widths
    }

    fn wrapped_columns_widths(&mut self, id: BoxId, container: &Container) -> Widths {
        let mut items = self.flex_items(id, container);
        let it = &self.boxes[id];
        let edges = it.border_and_padding(0.0).sums();
        let limit = container.size[1]
            .unwrap_or_else(|| it.height_limits(&Room::default(), edges, None)[1] - edges[1]);
        let (lines, mut sizes) = (break_lines(&items, container, limit), [0.0f32; 2]);
        for line in &lines {
            let (mut widest, mut ascents, mut descents) = (0.0, [f32::MIN; 2], [f32::MIN; 2]);
            for item in &mut items[line.items.clone()] {
                let own = self.contribution(item.id, container.size[1], None).sizes;
                (sizes[0], item.cross) = (sizes[0].max(own[0]), own[1] - item.margin.sums()[0]);
                self.add_to_line(
                    container,
                    item,
                    &Output::default(),
                    (&mut widest, &mut ascents, &mut descents),
                );
            }
            sizes[1] += widest;
        }
        sizes[1] += container.gaps()[1] * lines.len().saturating_sub(1) as f32;
        Widths {
            sizes,
            uses_height: true,
        }
    }

    fn item_input(&self, container: &Container, item: &Item) -> Input {
        let is_orthogonal = self.boxes[item.id].is_orthogonal();
        match container.main {
            0 => Input {
                has_definite_width: is_orthogonal,
                ..self.input_for(item.id, item.size, &item.room)
            },
            _ => Input {
                has_definite_width: is_orthogonal && item.stretches,
                height: Some(item.size),
                is_indefinite: container.size[1].is_none() && !item.has_definite_basis,
                ..self.input_for(item.id, item.cross, &item.room)
            },
        }
    }

    pub(crate) fn lay_out_flex(
        &mut self,
        id: BoxId,
        input: &Input,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let it = &self.boxes[id];
        let inset = it.inset(input.basis.0);
        let inner = |height: f32| (height - inset.sums()[1]).max(0.0);
        let width = (input.width - inset.sums()[0]).max(0.0);
        let container = Container::new(&it.style, [Some(width), it.inner_height(input, inset)]);
        let (main, cross, gaps) = (container.main, 1 - container.main, container.gaps());
        let has_ratio = it.ratio.is_some() && input.height.is_none();
        let mut items = self.flex_items(id, &container);
        let mut output = Output {
            uses_height: main == 1 && container.wraps,
            ..Output::default()
        };
        let known_height = input.height.map(inner).or(container.size[1]);
        let limit = match main {
            0 => width,
            _ => known_height.unwrap_or_else(|| {
                inner(
                    self.boxes[id]
                        .used_height(input, Some(f32::MAX))
                        .unwrap_or(f32::MAX),
                )
            }),
        };
        let mut lines = break_lines(&items, &container, limit);
        let gaps_in = |count: usize, gap: f32| gap * count.saturating_sub(1) as f32;
        let mut main_size = width;
        if main == 1 {
            let length = |line: &Line| {
                items[line.items.clone()]
                    .iter()
                    .map(|it| it.outer(it.size, 1))
                    .sum::<f32>()
                    + gaps_in(line.items.len(), gaps[0])
            };
            output.intrinsic = inset.sums()[1] + lines.iter().map(length).fold(0.0, f32::max);
            self.finish_height(id, input, inset, &mut output);
            main_size = inner(output.height);
        }

        for line in &mut lines {
            let items = &mut items[line.items.clone()];
            resolve_flexible_lengths(items, main_size - gaps_in(items.len(), gaps[0]), main);
            let mut descents = [f32::MIN; 2];
            for item in items {
                let mut own = Output::default();
                if main == 0 {
                    let input = self.item_input(&container, item);
                    own = match item.stretches && (item.room.height.is_none() || has_ratio) {
                        true => self.measure(
                            item.id,
                            Input {
                                height: None,
                                ..input
                            },
                        ),
                        false => self.lay_out(item.id, input, None),
                    };
                    item.cross = own.height;
                } else if self.boxes[item.id].ratio.is_some()
                    && !(item.stretches && !container.wraps)
                {
                    item.cross = self.resolve_width(
                        item.id,
                        &Room {
                            height: Some(item.size),
                            ..item.room
                        },
                        AutoSize::Fit,
                    );
                }
                self.add_to_line(
                    &container,
                    item,
                    &own,
                    (&mut line.cross, &mut line.ascents, &mut descents),
                );
            }
        }
        let content = lines.iter().map(|it| it.cross).sum::<f32>() + gaps_in(lines.len(), gaps[1]);
        let mut cross_size = width;
        if main == 0 {
            output.intrinsic = inset.sums()[1] + content;
            if items.is_empty() && self.has_line_if_empty(self.boxes[id].node) {
                output.intrinsic += unit(container.style.line_height());
            }
            self.finish_height(id, input, inset, &mut output);
            cross_size = inner(output.height);
        }
        let (mut free, align_content) =
            (cross_size - content, container.style.layout.align_content);
        if !container.wraps
            || free > 0.0 && matches!(align_content.0, AlignName::Normal | AlignName::Stretch)
        {
            let share = free / lines.len().max(1) as f32;
            lines
                .iter_mut()
                .enumerate()
                .for_each(|(index, line)| line.cross += diffused(share, index));
            free = 0.0;
        }

        let (mut line_offset, between_lines) =
            container.content_alignment(align_content, cross, free, lines.len());
        let (sizes, basis) = ([width, inner(output.height)], (width, container.size[1]));
        let physical = |axis: usize, offset: f32, size: f32| {
            inset.along(axis)[0]
                + if container.is_backwards(axis) {
                    sizes[axis] - offset - size
                } else {
                    offset
                }
        };
        let (line_count, mut stacks) = (lines.len(), Vec::new());
        for (line_index, line) in lines.iter().enumerate() {
            let exact_offset = line_offset;
            line_offset = diffused(line_offset, 0);
            let items = &mut items[line.items.clone()];
            let used = items.iter().map(|it| it.outer(it.size, main)).sum::<f32>()
                + gaps_in(items.len(), gaps[0]);
            let mut free = main_size - used;
            let auto = |document: &Document, item: &Item, axis| {
                auto_margins(&document.boxes[item.id].style, axis)
            };
            let auto_count = items
                .iter()
                .flat_map(|it| auto(self, it, main))
                .filter(|it| *it)
                .count();
            let (mut share, mut shares) = (0.0, 0..);
            if auto_count > 0 && free > 0.0 {
                (share, free) = (free / auto_count as f32, 0.0);
            }
            let (mut offset, between) = container.content_alignment(
                container.style.layout.justify_content,
                main,
                free,
                items.len(),
            );
            let mut fallback = [None; 2];
            if breaks.is_some() {
                stacks.push((
                    vec![Band::new(
                        physical(1, line_offset, line.cross),
                        line.cross,
                        gaps[1],
                    )],
                    Vec::new(),
                ));
            }
            for item in items {
                let (margins, is_auto) = (item.margin.along(main), auto(self, item, main));
                item.margin.set(
                    main,
                    [0, 1].map(|side| {
                        if is_auto[side] {
                            diffused(share, shares.next().unwrap_or(0))
                        } else {
                            margins[side]
                        }
                    }),
                );
                if main == 0 && !self.boxes[item.id].is_orthogonal() {
                    item.room.available[1] = Some((line.cross - item.margin.sums()[1]).max(0.0));
                }
                if item.stretches && item.room.height.is_none() {
                    let space = (line.cross - item.margin.sums()[cross]).max(0.0);
                    if main == 0 {
                        item.room.height =
                            Some(self.clamp_height(item.id, space, item.size, &item.room));
                    } else if container.wraps {
                        item.room.available[0] = Some(space);
                        item.cross = self.resolve_width(item.id, &item.room, AutoSize::Stretch);
                    }
                } else if main == 1 && container.wraps && line.cross > width {
                    let available = [
                        Some(line.cross - item.margin.sums()[0]),
                        item.room.available[1],
                    ];
                    item.cross = self.resolve_width(
                        item.id,
                        &Room {
                            available,
                            height: Some(item.size),
                            ..item.room
                        },
                        AutoSize::Fit,
                    );
                }
                let own = self.lay_out(item.id, self.item_input(&container, item), None);
                if main == 0 {
                    item.cross = own.height;
                }
                let mut free = line.cross - item.outer(item.cross, cross);
                let (margins, is_auto) = (item.margin.along(cross), auto(self, item, cross));
                let within = if is_auto != [false; 2] {
                    free = free.max(0.0);
                    item.margin.set(
                        cross,
                        match is_auto {
                            [true, true] => halves(free).into(),
                            [true, false] => [free, margins[1]],
                            _ => [margins[0], free],
                        },
                    );
                    0.0
                } else {
                    match item.baseline {
                        Some((0, ascent)) => line.ascents[0] - ascent,
                        Some((_, ascent)) => free - (line.ascents[1] - ascent),
                        None => {
                            distribute(
                                container.along_flow(
                                    item.align,
                                    cross,
                                    self.boxes[item.id].starts_far(cross),
                                    free,
                                ),
                                free,
                                1,
                            )
                            .0
                        }
                    }
                };
                let mut at = [0.0; 2];
                at[main] = physical(main, diffused(offset, 0), item.outer(item.size, main))
                    + item.margin.along(main)[0];
                at[cross] = physical(cross, line_offset + within, item.outer(item.cross, cross))
                    + item.margin.along(cross)[0];
                offset += item.outer(item.size, main) + gaps[0] + between;
                self.place_child(item.id, at, item.margin, basis);
                self.absorb(item.id, &own, &mut output);
                if let Some((bands, members)) = stacks.last_mut() {
                    let (it, is_auto) = (&self.boxes[item.id], self.boxes[id].has_auto_size(1));
                    let grows = self.can_grow(item.id)
                        && match main {
                            0 => {
                                it.has_auto_size(1)
                                    && (container.wraps || !item.stretches || is_auto)
                            }
                            _ if item.factors[1] == 0.0 || container.size[1].is_none() => {
                                it.has_auto_size(1) || !item.has_definite_basis
                            }
                            _ => it.has_auto_size(1) && it.style.layout.min_height == Size::Auto,
                        };
                    let mut offsets = [at[1] - bands[0].top, item.margin.bottom];
                    if main == 1 {
                        offsets[0] = 0.0;
                        bands.push(Band {
                            is_block: true,
                            margin: item.margin.top,
                            ..Band::new(at[1], own.height, gaps[0])
                        });
                    }
                    let input = self.item_input(&container, item);
                    members.push(Member {
                        id: item.id,
                        input,
                        bands: [0; 2],
                        offsets,
                        fills: item.stretches && main == 0,
                        grows,
                        moves_alone: true,
                    });
                }
                output.uses_height |= main == 1 && own.uses_height
                    || main == 0 && self.boxes[item.id].width_uses_height();
                if main == 1 {
                    let style = &self.boxes[item.id].style;
                    output.uses_height |= crate::layout::is_relative(&style.layout.flex_basis.0);
                }
                for (which, baseline) in self.boxes[item.id]
                    .baselines_for(&container.style, &own)
                    .into_iter()
                    .enumerate()
                {
                    if (which == 1) != container.is_reversed || fallback[which].is_none() {
                        fallback[which] = Some(at[1] + baseline);
                    }
                }
            }
            for which in 0..2 {
                let is_first = (which == 1) == container.wraps_back;
                if line_index == if is_first { 0 } else { line_count - 1 } {
                    let top = physical(1, line_offset, line.cross);
                    let shared =
                        |far: usize| match line.ascents[far ^ usize::from(container.wraps_back)] {
                            ascent if main == 1 || ascent == f32::MIN => None,
                            ascent => Some(if far == 1 {
                                top + line.cross - ascent
                            } else {
                                top + ascent
                            }),
                        };
                    output.baselines[which] = shared(which)
                        .or_else(|| shared(1 - which))
                        .or(fallback[which]);
                }
            }
            line_offset = exact_offset + line.cross + gaps[1] + between_lines;
        }

        for index in 0..self.boxes[id].children.len() {
            let child = self.boxes[id].children[index];
            let it = &mut self.boxes[child];
            if it.style.is_out_of_flow() {
                output.escapes |= it.out_of_flow();
                it.static_position = [0, 1].map(|axis| {
                    let align = match axis == main {
                        true => container.style.layout.justify_content,
                        false => align_self(&it.style, container.align_items),
                    };
                    let align = match container.along_flow(align, axis, it.starts_far(axis), 0.0) {
                        AlignName::SpaceAround | AlignName::SpaceEvenly => AlignName::Center,
                        AlignName::Baseline if container.wraps_back => AlignName::End,
                        AlignName::LastBaseline if container.wraps_back => AlignName::Start,
                        align => align,
                    };
                    let (edge, start) = (
                        Edge::from(align, container.is_backwards(axis)),
                        inset.along(axis)[0],
                    );
                    (edge.of([start, start + sizes[axis]]), edge)
                });
            }
        }
        if let Some(breaks) = breaks {
            let mut flow = self.flow(id, input, inset, breaks);
            let ends = if main == 0 {
                stacks.sort_by(|a, b| a.0[0].top.total_cmp(&b.0[0].top));
                let (mut bands, mut members) = (Vec::new(), Vec::new());
                for (band, own) in stacks {
                    members.extend(own.into_iter().map(|it| Member {
                        bands: [bands.len(); 2],
                        ..it
                    }));
                    bands.extend(band);
                }
                let (unbroken, all) = (
                    bands.last().map_or(inset.top, |it| it.bottom),
                    0..bands.len(),
                );
                self.fragment_bands(id, &mut flow, &mut bands, &mut members, all);
                [unbroken, bands.last().map_or(inset.top, |it| it.bottom)]
            } else {
                let mut unbroken = inset.top;
                for (bands, members) in &mut stacks {
                    bands.remove(0);
                    if container.is_reversed {
                        bands.reverse();
                        members.reverse();
                    }
                    members
                        .iter_mut()
                        .enumerate()
                        .for_each(|(index, it)| it.bands = [index; 2]);
                    unbroken = unbroken
                        .max(bands[bands.len() - 1].bottom + members[bands.len() - 1].offsets[1]);
                }
                [
                    unbroken,
                    self.fragment_stacks(id, &mut flow, &mut stacks)
                        .max(inset.top),
                ]
            };
            self.finish_bands(id, input, inset, flow, ends, &mut output);
        }
        output
    }

    /// `own` is only needed in a row.
    fn add_to_line(
        &mut self,
        container: &Container,
        item: &mut Item,
        own: &Output,
        (size, ascents, descents): (&mut f32, &mut [f32; 2], &mut [f32; 2]),
    ) {
        let cross = 1 - container.main;
        let outer = item.outer(item.cross, cross);
        if matches!(item.align.0, AlignName::Baseline | AlignName::LastBaseline)
            && auto_margins(&self.boxes[item.id].style, cross) == [false; 2]
        {
            if cross == 0 && self.boxes[item.id].is_orthogonal() {
                self.lay_out(item.id, self.item_input(container, item), None);
            }
            let sides = [
                item.align.0 == AlignName::LastBaseline,
                container.wraps_back,
            ];
            let (is_far, ascent, _) = self.boxes[item.id].aligned_baseline(
                &container.style,
                cross,
                sides,
                own,
                item.cross,
                item.margin,
            );
            let side = usize::from(is_far != container.is_backwards(cross));
            (ascents[side], descents[side]) = (
                ascents[side].max(ascent),
                descents[side].max(outer - ascent),
            );
            (*size, item.baseline) = (
                size.max(ascents[side] + descents[side]),
                Some((side, ascent)),
            );
        } else {
            *size = size.max(outer);
        }
    }
}

fn break_lines(items: &[Item], container: &Container, limit: f32) -> SmallVec<[Line; 1]> {
    let (mut lines, mut start, mut used, gap) = (SmallVec::new(), 0, 0.0, container.gaps()[0]);
    let line = |items| Line {
        items,
        cross: 0.0,
        ascents: [f32::MIN; 2],
    };
    for (index, item) in items.iter().enumerate().filter(|_| container.wraps) {
        let outer = item
            .outer(item.size, container.main)
            .max(if container.balanced.is_some() {
                0.0
            } else {
                f32::MIN
            });
        if index > start && used + outer > limit + 0.001 {
            lines.push(line(start..index));
            (start, used) = (index, 0.0);
        }
        used += outer + gap;
    }
    if start < items.len() {
        lines.push(line(start..items.len()));
    }
    if let Some(count) = container
        .balanced
        .map(|it| it.min(items.len()).max(lines.len()))
        .filter(|it| *it > 1)
    {
        let sizes: Vec<_> = items
            .iter()
            .map(|it| it.outer(it.size, container.main).max(0.0))
            .collect();
        let balanced = balance(&sizes, gap, limit, count);
        if !balanced.is_empty() {
            return balanced.into_iter().map(line).collect();
        }
    }
    lines
}

/// The `count` lines whose lengths have the least sum of squares. Empty if that takes too long to find.
fn balance(sizes: &[f32], gap: f32, limit: f32, count: usize) -> Vec<Range<usize>> {
    let (len, mut budget) = (sizes.len(), 50_000_000u32);
    let mut scores: Vec<_> = (0..=len)
        .map(|it| if it == len { 0.0 } else { f64::INFINITY })
        .collect();
    let mut ends = Vec::with_capacity(count);
    for _ in 0..count {
        let best = (0..=len).map(|start| {
            let (mut best, mut length) = ((f64::INFINITY, len), -gap);
            for end in start + 1..=len {
                length += sizes[end - 1] + gap;
                budget = budget.saturating_sub(1);
                if end > start + 1 && length > limit + 0.001 || budget == 0 {
                    break;
                }
                let score = f64::from(length.min(limit)).powi(2) + scores[end];
                if score <= best.0 {
                    best = (score, end);
                }
            }
            best
        });
        let (next, own): (Vec<_>, Vec<_>) = best.unzip();
        scores = next;
        ends.push(own);
        if budget == 0 {
            return Vec::new();
        }
    }
    let mut start = 0;
    let line = |ends: &Vec<usize>| {
        let end = ends[start];
        core::mem::replace(&mut start, end)..end
    };
    ends.iter().rev().map(line).collect()
}
