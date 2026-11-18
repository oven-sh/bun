//! Multi-column layout.

use std::rc::Rc;

use crate::boxes::{BoxId, Kind, LayoutBox};
use crate::document::Document;
use crate::fragment::{Appeal, Breaks, Decision, MAX_COLUMNS, Row};
use crate::layout::{
    AutoSize, Edges, Input, Output, Room, Strut, Widths, ceil_to_unit, margin, resolve, unit,
};
use crate::properties::Style;
use crate::types::*;
use crate::values::{Normal, PositiveLp};

fn gap(style: &Style, gap: &Normal<PositiveLp>, basis: f32) -> f32 {
    gap.0
        .as_ref()
        .map_or(style.font.size.0, |it| resolve(&it.0, basis))
}

/// The height with which `runs`, which forced breaks separate, fill `count` columns.
fn balanced_height(runs: &[f32], count: usize) -> f32 {
    let mut columns = vec![1.0; runs.len()];
    let tallest = |columns: &[f32]| {
        let heights = runs
            .iter()
            .zip(columns)
            .map(|(run, columns)| ceil_to_unit(run / columns))
            .enumerate();
        heights
            .reduce(|a, b| if b.1 > a.1 { b } else { a })
            .unwrap_or_default()
    };
    for _ in runs.len()..count {
        let index = tallest(&columns).0;
        columns[index] += 1.0;
    }
    tallest(&columns).1
}

impl LayoutBox {
    fn lets_spanners_out(&self) -> bool {
        self.joins_formatting_context && self.inline.is_none() && !self.style.contains_fixed()
    }
}

impl Document {
    pub(crate) fn spanners_in(&self, id: BoxId, out: &mut Vec<BoxId>) {
        for child in &self.boxes[id].children {
            match &self.boxes[*child] {
                it if it.spans_columns() => out.push(*child),
                it if it.lets_spanners_out() => self.spanners_in(*child, out),
                _ => {}
            }
        }
    }

    pub(crate) fn is_spanner(&self, id: BoxId) -> bool {
        let mut around = self.boxes.containers(id).map(|it| &self.boxes[it]);
        self.boxes[id].spans_columns()
            && around
                .find(|it| it.parent_kind == Kind::Columns || !it.lets_spanners_out())
                .is_some_and(|it| it.parent_kind == Kind::Columns)
    }

    pub(crate) fn columns_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let (style, mut spanners) = (Rc::clone(&self.boxes[id].style), Vec::new());
        let mut widths = Widths::default();
        if let Some(flow) = self.boxes[id].children.first().copied().filter(|_| {
            !style
                .contain()
                .intersects(Contain::SIZE | Contain::INLINE_SIZE)
        }) {
            self.spanners_in(flow, &mut spanners);
            self.boxes.ignored.extend(&spanners);
            widths = self.intrinsic_widths(flow, height);
            self.boxes
                .ignored
                .truncate(self.boxes.ignored.len() - spanners.len());
        }
        let (count, gap) = (
            style.rare.column_count.0.map_or(1, |it| it.0) as f32,
            gap(&style, &style.layout.column_gap, 0.0),
        );
        let [min, max] = widths.sizes;
        widths.sizes = match style.rare.column_width.0 {
            Some(width) => [
                min.min(width.0),
                max.max(width.0) * count + gap * (count - 1.0),
            ],
            None => widths.sizes.map(|it| it * count + gap * (count - 1.0)),
        };
        for spanner in spanners {
            let outer = self.turn(spanner, self.boxes[id].turned);
            let own = self.contribution(spanner, height, None).sizes;
            self.turn(spanner, outer);
            widths.sizes = [0, 1].map(|it| widths.sizes[it].max(own[it]));
        }
        widths
    }

    pub(crate) fn lay_out_columns(
        &mut self,
        id: BoxId,
        input: &Input,
        outer: Option<&mut Breaks>,
    ) -> Output {
        let it = &self.boxes[id];
        let (style, inset, mut output) = (
            Rc::clone(&it.style),
            it.inset(input.basis.0),
            Output::default(),
        );
        let (width, height) = (
            (input.width - inset.sums()[0]).max(0.0),
            it.inner_height(input, inset),
        );
        let limit = it
            .used_height(input, Some(f32::INFINITY))
            .map_or(f32::INFINITY, |it| it - inset.sums()[1]);
        let (flow, mode, rare) = (
            it.children.first().copied().unwrap_or_default(),
            it.turned,
            &style.rare,
        );
        let column_gap = gap(&style, &style.layout.column_gap, width);
        let fitting = rare
            .column_width
            .0
            .map(|it| ((width + column_gap) / (it.0.max(1.0) + column_gap)).floor() as i32);
        let count = fitting.unwrap_or(i32::MAX).min(
            rare.column_count
                .0
                .map_or_else(|| if fitting.is_some() { i32::MAX } else { 1 }, |it| it.0),
        );
        let count = count.clamp(1, MAX_COLUMNS as i32) as usize;
        let column_width = unit(((width + column_gap) / count as f32 - column_gap).max(0.0));
        let row_height = rare.column_height.0.map(|it| unit(it.0));
        let wraps = rare.column_wrap == ColumnWrap::Wrap
            || rare.column_wrap == ColumnWrap::Auto && row_height.is_some();
        let row_height = row_height.or_else(|| height.filter(|_| wraps));
        let row_gap = gap(&style, &style.layout.row_gap, height.unwrap_or(0.0));
        let mut breaks = Breaks::default();
        (breaks.column_width, breaks.budget) =
            (column_width, outer.as_ref().map_or(200_000, |it| it.budget));
        (breaks.step, breaks.indent) = match style.is_rtl() {
            true => (-column_width - column_gap, width - column_width),
            false => (column_width + column_gap, 0.0),
        };
        let mut outer = outer.map(|it| self.flow(id, input, inset, it));
        let trim = [0, 1].map(|side| {
            style.rare.box_trim.sides()[side] || input.trim[side] && inset.along(1)[side] == 0.0
        });
        let flow_input = Input {
            width: column_width,
            basis: (column_width, row_height.or(height)),
            trim,
            ..Input::default()
        };
        let (mut y, mut strut, mut first, mut start) = (inset.top, Strut::default(), 0, 0.0);
        let (mut rows_start, mut end_of_flow) = (y, None);
        let used_of_row = |y: f32| {
            row_height.map_or(0.0, |it| {
                if it + row_gap > 0.0 {
                    y.max(0.0) % (it + row_gap)
                } else {
                    0.0
                }
            })
        };
        loop {
            if flow == 0 {
                break;
            }
            let margins = strut.sum();
            let mut top = y + margins;
            let mut used_of_row = used_of_row(top - rows_start);
            if let Some(row) = row_height.filter(|it| used_of_row > 0.0 && used_of_row >= *it) {
                (top, used_of_row) = (top + row + row_gap - used_of_row, 0.0);
            }
            if let Some(outer) = outer.as_mut().filter(|it| {
                Some(it.end() - top) < row_height
                    && used_of_row == 0.0
                    && y > it.start()
                    && it.column < MAX_COLUMNS
            }) {
                let appeal = if outer.is_separated {
                    Appeal::Perfect
                } else {
                    Appeal::LastResort
                };
                (y, strut) = (outer.break_at(y, appeal, false), Strut::default());
                rows_start = y;
                continue;
            }
            let used = outer.as_ref().map_or(top, |it| it.consumed(top)) - inset.top;
            let outer_space = outer
                .as_ref()
                .map(|it| (it.end() - top).max(0.0))
                .filter(|it| it.is_finite());
            let (specified, limit) = match row_height {
                Some(height) => (
                    Some((height - used_of_row).max(0.0)),
                    (height - used_of_row).max(0.0),
                ),
                None => (
                    height.map(|it| (it - used).max(0.0)),
                    (limit - used).max(0.0),
                ),
            };
            let constrain = |it: f32| it.min(limit).min(outer_space.unwrap_or(f32::INFINITY));
            let resumes = outer_space.is_some_and(|space| specified.is_none_or(|it| it > space));
            let (row_y, outer_column) = outer
                .as_ref()
                .map_or((top - inset.top, 0), |it| (it.top + top, it.column));
            let is_short = resumes
                && outer
                    .as_ref()
                    .is_some_and(|it| top > it.start() + 0.01 && it.column < MAX_COLUMNS);
            breaks.rows.push(Row {
                first,
                start,
                height: 0.0,
                y: row_y,
                outer_column,
                short_until: 0,
            });
            let mut pass = |document: &mut Document, breaks: &mut Breaks, height: f32| {
                breaks.rows.last_mut().into_iter().for_each(|it| {
                    (it.height, it.short_until) = (
                        height,
                        if is_short && Some(height) >= outer_space {
                            first + count
                        } else {
                            0
                        },
                    );
                });
                breaks.kept = if resumes || wraps {
                    first + count
                } else {
                    usize::MAX
                };
                breaks.begin_pass();
                let own = document
                    .lay_out_in_column(flow, flow_input, None, breaks, (0, 0.0))
                    .0;
                (output.escapes, output.uses_height) = (own.escapes | output.escapes, true);
                breaks.note(first, start);
                breaks.tally.reach[0].len() - first
            };
            let (mut fills, mut balances) = (rare.column_fill == ColumnFill::Auto, false);
            let (mut height, mut columns) = (constrain(specified.unwrap_or(f32::INFINITY)), 0);
            if fills && (specified.is_some() || outer_space.is_some())
                || rare.column_height.0.is_some()
            {
                columns = pass(self, &mut breaks, height);
            }
            if columns == 0
                || (breaks.found_spanner.is_some() || !fills)
                    && !((resumes || wraps) && columns > count)
            {
                (fills, balances) = (fills && breaks.found_spanner.is_none(), true);
                pass(self, &mut breaks, f32::INFINITY);
                fills &= breaks.found_spanner.is_none() && outer.is_none();
                let (tallest, runs) = (breaks.tallest_unbreakable, &breaks.tally.reach[0][first..]);
                let runs = &runs[..runs.len().min(if wraps { count } else { usize::MAX })];
                outer
                    .iter_mut()
                    .for_each(|it| it.breaks.cannot_break(it.column, tallest));
                height =
                    constrain(balanced_height(runs, if fills { 1 } else { count }).max(tallest));
                loop {
                    columns = pass(self, &mut breaks, height);
                    if columns <= count && breaks.tally.worst == Appeal::Perfect
                        || breaks.budget == 0
                    {
                        break;
                    }
                    let taller = match count <= breaks.tally.forced + 1 {
                        true if outer_space.is_none() => break,
                        true => f32::INFINITY,
                        false if breaks.shortage.is_infinite() => break,
                        false => height + breaks.shortage,
                    };
                    if constrain(taller) <= height {
                        break;
                    }
                    height = constrain(taller);
                }
            }
            let reach = &breaks.tally.reach[0][first..];
            let is_empty = columns == 1 && reach[0] == 0.0 && !breaks.tally.has_new_box;
            let goes_on = (resumes || wraps) && columns > count && first < MAX_COLUMNS;
            if let (Some(outer), Some(space)) = (&mut outer, outer_space) {
                let tallest = reach.iter().take(count).copied().fold(0.0, f32::max);
                if tallest > space + 0.01
                    && top > outer.start() + 0.01
                    && outer.column < MAX_COLUMNS
                {
                    outer.breaks.lacks(outer.column, tallest - space);
                    let appeal = if outer.is_separated {
                        Appeal::Perfect
                    } else {
                        Appeal::LastResort
                    };
                    (y, strut) = (outer.break_at(y, appeal, false), Strut::default());
                    breaks.rows.pop();
                    continue;
                }
            }
            if !is_empty || breaks.found_spanner.is_none() {
                let in_flow = breaks.tally.reach[1].get(first..).unwrap_or_default();
                let shrinks = !balances && specified.is_none() && in_flow.len() <= 1;
                let height = specified
                    .filter(|_| rare.column_height.0.is_some() && breaks.found_spanner.is_none())
                    .map_or(height, constrain);
                (y, strut) = (
                    top + if shrinks {
                        in_flow.first().map_or(0.0, |it| it.min(height))
                    } else {
                        height
                    },
                    Strut::default(),
                );
                if let Some(outer) = outer.as_ref().filter(|_| goes_on && in_flow.len() <= count) {
                    end_of_flow.get_or_insert_with(|| outer.consumed(y));
                }
                for outer in outer.iter_mut().filter(|_| end_of_flow.is_none()) {
                    outer.fill_to(y);
                    if outer_space.is_some() && breaks.tally.worst != Appeal::Perfect {
                        outer.broke(breaks.tally.worst, false);
                    }
                }
            } else {
                breaks
                    .rows
                    .last_mut()
                    .into_iter()
                    .for_each(|it| it.height = 0.0);
            }
            if is_empty && breaks.found_spanner.is_none() && rare.margin_trim.0[1] {
                y -= margins;
            }
            let columns = if goes_on { count } else { columns };
            (first, start) = (
                first + columns,
                start + columns as f32 * breaks.rows.last().map_or(1.0, |it| it.height.max(1.0)),
            );
            if goes_on {
                match outer
                    .as_mut()
                    .filter(|_| resumes && height >= outer_space.unwrap_or(0.0) || !wraps)
                {
                    Some(outer) => {
                        outer.breaks.lacks(outer.column, breaks.shortage);
                        y = outer.break_at(y, Appeal::Perfect, false);
                        let used = used_of_row + height;
                        rows_start = y - if row_height.is_some_and(|it| used < it) {
                            used
                        } else {
                            0.0
                        };
                    }
                    None => (y, rows_start) = (y + row_gap, y + row_gap),
                }
                continue;
            }
            let Some(spanner) = breaks.found_spanner.take() else {
                break;
            };
            let was_turned = self.turn(spanner, mode);
            let mut margin = margin(&self.boxes[spanner].style, width);
            let room = Room {
                available: [Some(width - margin.sums()[0]), None],
                basis: [Some(width), flow_input.basis.1],
                height: None,
            };
            let auto = if self.boxes[spanner].shrinks_to_fit || self.boxes[spanner].is_replaced() {
                AutoSize::Fit
            } else {
                AutoSize::Fill
            };
            let own_width = self.resolve_width(spanner, &room, auto);
            let is_first = breaks.spanners.is_empty() && y == inset.top;
            let is_last = || {
                self.boxes[flow]
                    .children
                    .iter()
                    .rfind(|it| !self.boxes[**it].style.is_out_of_flow())
                    == Some(&spanner)
            };
            let own_input = Input {
                trim: [trim[0] && is_first, trim[1] && is_last()],
                ..self.input_for(spanner, own_width, &room)
            };
            let x = self.align_in_flow(&style, spanner, width, own_width, &mut margin);
            let is_trimmed = rare.margin_trim.0[0] && is_first;
            let (mut top, used) = (
                y + if is_trimmed {
                    0.0
                } else {
                    strut.with(margin.top).sum()
                },
                row_height.map_or(0.0, |it| (y - rows_start).max(0.0) % (it + row_gap)),
            );
            if let Some(row) = row_height.filter(|it| {
                used > 0.0 && used + top - y + self.measure(spanner, own_input).height > *it
            }) {
                y += row + row_gap - used;
                if let Some(outer) = outer.as_mut().filter(|it| it.end() - y < row) {
                    y = outer.break_at(y, Appeal::Perfect, false);
                    rows_start = y;
                }
                top = y + margin.top;
            }
            let own = loop {
                let Some(outer) = &mut outer else {
                    break self.lay_out(spanner, own_input, None);
                };
                let (tally, at) = (outer.breaks.tally.clone(), outer.at(top));
                let (own, outcome) =
                    self.lay_out_in_column(spanner, own_input, None, outer.breaks, at);
                match outer.decide(
                    (spanner, None),
                    [top, top + own.height],
                    &outcome,
                    self.avoids_break_inside(spanner),
                    true,
                ) {
                    Decision::Move(appeal, is_forced) => {
                        outer.breaks.rewind(&tally);
                        top = outer.break_at(y, appeal, is_forced);
                    }
                    Decision::Stay => {
                        outer.pass(spanner, top + own.height, &outcome);
                        break own;
                    }
                    Decision::Abort => break own,
                }
            };
            self.place_child(
                spanner,
                [x, top - inset.top],
                margin,
                (width, flow_input.basis.1),
            );
            let at = self.boxes[spanner].layout.location;
            outer
                .iter_mut()
                .for_each(|it| it.shift(spanner, at.y - (top - inset.top)));
            self.turn(spanner, was_turned);
            breaks
                .spanners
                .push((spanner, breaks.rows.len(), [at.x, at.y]));
            output.escapes |= own.escapes;
            output.baselines = [
                output.baselines[0].or_else(|| own.baselines[0].map(|it| top + it)),
                own.baselines[1].map(|it| top + it).or(output.baselines[1]),
            ];
            (y, strut) = (top + own.height, Strut::default().with(margin.bottom));
            if outer.as_ref().is_some_and(|it| it.must_stop()) {
                break;
            }
        }
        for (spanner, ..) in &breaks.spanners {
            let (escapes, mut at) = (
                self.boxes[*spanner].cache.escapes(),
                self.boxes[*spanner].parent,
            );
            while at != id {
                self.boxes[at].cache.let_escape(escapes);
                at = self.boxes[at].parent;
            }
        }
        output.intrinsic = end_of_flow
            .unwrap_or_else(|| outer.as_ref().map_or(y, |it| it.consumed(y)))
            + inset.bottom;
        let filled = output.intrinsic;
        self.finish_height(id, input, inset, &mut output);
        if end_of_flow.is_some() {
            output.intrinsic = f32::INFINITY;
        }
        let offset = if outer.is_none() {
            self.content_offset(id, output.height - filled)
        } else {
            0.0
        };
        self.place_child(
            flow,
            [inset.left, inset.top + offset],
            Edges::default(),
            (0.0, None),
        );
        match outer {
            Some(outer) => {
                let outer = outer.finish(id, inset, self.counts_clones(id), &mut output);
                outer.budget = breaks.budget;
                outer.nested.insert(id, breaks);
            }
            None if flow != 0 => {
                let [first, last] = self.distribute_to_columns(
                    flow,
                    &breaks,
                    [
                        width,
                        (output.height.min(output.height - offset) - inset.sums()[1]).max(0.0),
                    ],
                );
                let both = |a: Option<f32>, b: Option<f32>| {
                    a.map(|it| it + inset.top)
                        .into_iter()
                        .chain(b)
                        .map(|it| it + offset)
                };
                output.baselines = [
                    both(first, output.baselines[0]).reduce(f32::min),
                    both(last, output.baselines[1]).reduce(f32::max),
                ];
                output.last_baseline = output.baselines[1];
            }
            None => {}
        }
        output
    }
}
