//! Fragmentation. What flows through columns is laid out in one strip, with every box and line assigned to the column that it
//! starts in. Once the outermost multi-column container is done, they are moved to where their columns are.

use core::ops::Range;

use crate::abi::Rect;
use crate::block::Floats;
use crate::boxes::{BoxId, Kind};
use crate::document::Document;
use crate::layout::{Edges, Input, Output, Point, Room};
use crate::lines::FragmentKind;
use crate::name::{Map, is_name};
use crate::properties::{Style, Text};
use crate::types::*;

const TOLERANCE: f32 = 0.005;
const FAR: f32 = 16_384.0;

#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Appeal {
    LastResort,
    ViolatesAvoid,
    ViolatesOrphansAndWidows,
    #[default]
    Perfect,
}

/// Before a box, or before a line or a band of it.
#[derive(Clone, Copy)]
pub(crate) struct Breakpoint {
    id: BoxId,
    line: Option<usize>,
    appeal: Appeal,
}

/// Columns that are side by side.
#[derive(Clone, Copy)]
pub(crate) struct Row {
    pub(crate) first: usize,
    /// In the strip.
    pub(crate) start: f32,
    /// Infinite while the contents are measured.
    pub(crate) height: f32,
    /// In the strip around, or else from the content box of the container.
    pub(crate) y: f32,
    pub(crate) outer_column: usize,
    /// The columns before it are shorter than those of the next row would be.
    pub(crate) short_until: usize,
}

/// What a layout that is abandoned must not leave behind.
#[derive(Clone, Default)]
pub(crate) struct Tally {
    /// How far the contents of each column go from its start, with and without out-of-flow boxes.
    pub(crate) reach: [Vec<f32>; 2],
    /// The last columns that the box being laid out has something in, with and without out-of-flow boxes.
    furthest: [usize; 2],
    /// A box starts in the last row.
    pub(crate) has_new_box: bool,
    /// Where the columns after forced breaks start in a row of infinite height.
    starts: Vec<f32>,
    pub(crate) forced: usize,
    /// Of the breaks in the last row.
    pub(crate) worst: Appeal,
}

struct Placed {
    column: usize,
    /// In the strip.
    top: f32,
    /// What moves it afterwards.
    shift: f32,
    is_monolithic: bool,
    is_known_to_fit: bool,
    height: f32,
    height_in_strip: f32,
    /// Column, top and bottom, if it is split.
    pieces: Vec<(usize, f32, f32)>,
    /// The columns and tops at which it is repeated.
    copies: Vec<(usize, f32)>,
    /// The column of each line.
    lines: Vec<usize>,
}

impl Placed {
    fn whole(column: usize, top: f32, height: f32) -> Placed {
        Placed {
            column,
            top,
            shift: 0.0,
            is_monolithic: true,
            is_known_to_fit: false,
            height,
            height_in_strip: height,
            pieces: Vec::new(),
            copies: Vec::new(),
            lines: Vec::new(),
        }
    }
}

/// The state of a multi-column container.
#[derive(Default)]
pub(crate) struct Breaks {
    pub(crate) rows: Vec<Row>,
    /// From a column to the next.
    pub(crate) step: f32,
    /// From the content box to the first column.
    pub(crate) indent: f32,
    pub(crate) column_width: f32,
    pub(crate) tally: Tally,
    /// The columns from it on will be in the next row.
    pub(crate) kept: usize,
    pub(crate) shortage: f32,
    pub(crate) tallest_unbreakable: f32,
    /// Those that have been laid out, with the index of the row after them, and where they are in the content box.
    pub(crate) spanners: Vec<(BoxId, usize, [f32; 2])>,
    /// One that has not, which ends the layout.
    pub(crate) found_spanner: Option<BoxId>,
    pub(crate) allows_spanners: bool,
    /// What cloned borders and paddings take from the start and the end of the columns, up to those that their boxes end in.
    insets: Vec<([f32; 2], usize)>,
    /// The columns that boxes end in before their contents do.
    ends: Vec<(BoxId, usize)>,
    /// From which on everything that overflows is clipped.
    open: Option<usize>,
    /// What comes first cannot go to the next column.
    is_pinned: bool,
    /// The height that it is given is the least.
    grows: bool,
    is_out_of_flow: bool,
    at: (usize, f32),
    outcome: Outcome,
    earlier: Vec<Breakpoint>,
    retry: Option<Breakpoint>,
    /// The top in the strip, and the height with the bottom margin, of floats among lines.
    floats: Vec<(BoxId, f32, f32)>,
    pub(crate) budget: u32,
    placed: Map<BoxId, Placed>,
    pub(crate) nested: Map<BoxId, Breaks>,
}

#[derive(Clone, Copy)]
pub(crate) struct Outcome {
    /// The column that it ends in.
    pub(crate) last: usize,
    /// Of the break in the column that it starts in.
    inside: Option<Appeal>,
    is_forced: bool,
    /// The best in `last`.
    early: Option<Breakpoint>,
    before: BreakBetween,
    after: BreakBetween,
}

impl Default for Outcome {
    fn default() -> Outcome {
        Outcome {
            last: 0,
            inside: None,
            is_forced: false,
            early: None,
            before: BreakBetween::Auto,
            after: BreakBetween::Auto,
        }
    }
}

/// The state of a box whose contents are laid out.
pub(crate) struct Flow<'a> {
    pub(crate) breaks: &'a mut Breaks,
    /// Of the border box, in the strip.
    pub(crate) top: f32,
    contents_top: f32,
    first: usize,
    pub(crate) column: usize,
    /// How far the contents go in `column`, in the strip.
    reach: f32,
    /// Where it ends in the columns that it has left.
    cuts: Vec<(usize, f32)>,
    outcome: Outcome,
    pub(crate) is_separated: bool,
    is_pinned: bool,
    /// What a break has last been forced before.
    forced: Option<(BoxId, Option<usize>)>,
    is_known_to_fit: bool,
    /// Up to what height.
    grows: Option<f32>,
    /// The last that it has gone on in after a spanner.
    after_spanner: usize,
    /// What it adds to `Breaks::insets`, and how many of them are from outside.
    cloned: [f32; 2],
    depth: usize,
}

pub(crate) enum Decision {
    Stay,
    /// To the next column, maybe by force.
    Move(Appeal, bool),
    /// The layout has to start over.
    Abort,
}

/// A row of a table, a grid or a flex container, or else a box on its own.
pub(crate) struct Band {
    /// From the top of the container. In the strip once it is fragmented.
    pub(crate) top: f32,
    pub(crate) height: f32,
    /// The space before it that a break does away with, and the one that goes with it.
    pub(crate) gap: f32,
    pub(crate) lead: f32,
    /// What a forced break leaves.
    pub(crate) margin: f32,
    pub(crate) between: [BreakBetween; 2],
    pub(crate) avoids_break: bool,
    /// Its only member is all there is to it.
    pub(crate) is_block: bool,
    /// The columns that it starts and ends in, and the bottom in the strip.
    pub(crate) columns: [usize; 2],
    pub(crate) bottom: f32,
    pub(crate) shift: f32,
}

impl Band {
    pub(crate) fn new(top: f32, height: f32, gap: f32) -> Band {
        let between = [BreakBetween::Auto; 2];
        Band {
            top,
            height,
            gap,
            lead: 0.0,
            margin: 0.0,
            shift: 0.0,
            between,
            avoids_break: false,
            is_block: false,
            columns: [0; 2],
            bottom: top + height,
        }
    }

    pub(crate) fn belongs_to(&mut self, style: &Style, [is_first, is_last]: [bool; 2]) {
        let avoids = matches!(
            style.rare.break_inside,
            BreakInside::Avoid | BreakInside::AvoidColumn
        );
        let inside = if avoids {
            BreakBetween::Avoid
        } else {
            BreakBetween::Auto
        };
        self.between[0] = join(
            if is_first {
                style.rare.break_before
            } else {
                inside
            },
            self.between[0],
        );
        self.between[1] = join(
            self.between[1],
            if is_last {
                style.rare.break_after
            } else {
                BreakBetween::Auto
            },
        );
        self.avoids_break |= avoids;
    }
}

pub(crate) struct Member {
    pub(crate) id: BoxId,
    pub(crate) input: Input,
    /// The first and the last.
    pub(crate) bands: [usize; 2],
    /// From the top of the band, and to the bottom.
    pub(crate) offsets: [f32; 2],
    pub(crate) fills: bool,
    /// It makes the band taller if need be.
    pub(crate) grows: bool,
    pub(crate) moves_alone: bool,
}

/// A part of a box that is split, relative to the border box.
pub(crate) struct Piece {
    pub(crate) rect: Rect,
    /// Of the whole box, for its part to be in `rect`.
    pub(crate) shift: [f32; 2],
    /// Only limited where the box is cut. For a column, the middle of the gap before it.
    pub(crate) clip: Rect,
}

fn join(first: BreakBetween, second: BreakBetween) -> BreakBetween {
    let rank = |it| match it {
        BreakBetween::Auto => 0,
        BreakBetween::AvoidPage => 1,
        BreakBetween::AvoidColumn | BreakBetween::Avoid => 2,
        BreakBetween::Column => 4,
        _ => 3,
    };
    if rank(second) >= rank(first) {
        second
    } else {
        first
    }
}

impl Breaks {
    fn row(&self, column: usize) -> &Row {
        &self.rows[self.rows.partition_point(|it| it.first <= column) - 1]
    }

    pub(crate) fn start(&self, column: usize) -> f32 {
        let row = self.row(column);
        match (column - row.first, row.height.is_finite()) {
            (0, _) => row.start,
            (index, true) => row.start + index as f32 * row.height.max(1.0),
            (index, false) => self
                .tally
                .starts
                .get(index - 1)
                .or_else(|| self.tally.starts.last())
                .copied()
                .unwrap_or(row.start),
        }
    }

    pub(crate) fn end(&self, column: usize) -> f32 {
        match self.open.is_some_and(|it| column >= it) {
            true => f32::INFINITY,
            false => self.start(column) + self.row(column).height.max(1.0),
        }
    }

    /// What is left of the column by the `depth` outermost boxes that clone their edges, which is enough to make progress.
    fn range(&self, column: usize, depth: usize) -> [f32; 2] {
        let sum = |side: usize| {
            self.insets[..depth]
                .iter()
                .filter(|it| column + side <= it.1)
                .map(|it| it.0[side])
                .sum::<f32>()
        };
        let start = self.start(column) + sum(0);
        [start, (self.end(column) - sum(1)).max(start + 1.0)]
    }

    pub(crate) fn note(&mut self, column: usize, bottom: f32) {
        let (used, tally) = (bottom - self.start(column), &mut self.tally);
        let both = tally.reach.iter_mut().zip(&mut tally.furthest);
        for (reach, furthest) in both.take(if self.is_out_of_flow { 1 } else { 2 }) {
            reach.resize(reach.len().max(column + 1), 0.0);
            (reach[column], *furthest) = (reach[column].max(used), column.max(*furthest));
        }
    }

    fn is_in_last_row(&self, column: usize) -> bool {
        self.rows.last().is_some_and(|it| column >= it.first)
    }

    pub(crate) fn lacks(&mut self, column: usize, space: f32) {
        if space > TOLERANCE && self.is_in_last_row(column) {
            self.shortage = self.shortage.min(space);
        }
    }

    pub(crate) fn cannot_break(&mut self, column: usize, height: f32) {
        if self.is_in_last_row(column) {
            self.tallest_unbreakable = self.tallest_unbreakable.max(height);
        }
    }

    pub(crate) fn rewind(&mut self, tally: &Tally) {
        self.tally.clone_from(tally);
        self.found_spanner = None;
    }

    /// Without what is only in the strip.
    pub(crate) fn whole_height(&self, id: BoxId) -> Option<f32> {
        Some(self.placed.get(&id)?.height)
    }

    /// The column that `y` is in, for what has no say in that.
    fn column_at(&self, mut column: usize, y: f32) -> usize {
        while column > 0 && y < self.start(column) {
            column -= 1;
        }
        let rows = &self.rows[self.rows.partition_point(|it| it.first <= column) - 1..];
        let row = rows.iter().rfind(|it| it.start <= y).unwrap_or(&rows[0]);
        let found = row.first
            + (((y - row.start + TOLERANCE) / row.height.max(1.0)) as usize).min(MAX_COLUMNS);
        column.max(found.min(self.open.unwrap_or(usize::MAX)))
    }

    pub(crate) fn begin_pass(&mut self) {
        (self.tally, self.shortage, self.tallest_unbreakable) =
            (Tally::default(), f32::INFINITY, 0.0);
        (self.found_spanner, self.allows_spanners) = (None, true);
    }

    fn violates(&mut self, column: usize, appeal: Appeal) {
        if self.is_in_last_row(column) && column < self.kept {
            self.tally.worst = self.tally.worst.min(appeal);
        }
    }
}

/// The work is exponential in it.
const MAX_NESTED_COLUMNS: usize = 5;
pub(crate) const MAX_COLUMNS: usize = 2000;

impl Flow<'_> {
    /// Where the contents start in the column, from `top`.
    pub(crate) fn start(&self) -> f32 {
        self.breaks.range(self.column, self.breaks.insets.len())[0] - self.top
    }

    pub(crate) fn end(&self) -> f32 {
        self.breaks.range(self.column, self.breaks.insets.len())[1] - self.top
    }

    fn start_of_next(&self) -> f32 {
        self.breaks.range(self.column + 1, self.breaks.insets.len())[0] - self.top
    }

    pub(crate) fn must_stop(&self) -> bool {
        self.breaks.found_spanner.is_some() || self.breaks.retry.is_some()
    }

    /// For a child at `top`.
    pub(crate) fn at(&mut self, top: f32) -> (usize, f32) {
        self.breaks.is_pinned = self.is_pinned && !self.is_separated && self.column == self.first;
        (self.column, self.top + top)
    }

    fn is_short(&self) -> bool {
        let row = self.breaks.row(self.column);
        row.first < self.column && self.column < row.short_until
    }

    /// Whether what is at `top` would not be better off in the next column.
    fn is_stuck(&self, top: f32) -> bool {
        top <= self.start() + TOLERANCE && !self.is_short()
            || self.is_pinned && !self.is_separated && self.column == self.first
            || self.column >= MAX_COLUMNS
    }

    pub(crate) fn broke(&mut self, appeal: Appeal, is_forced: bool) {
        if self.column == self.first {
            self.outcome.inside = Some(self.outcome.inside.map_or(appeal, |it| it.min(appeal)));
            self.outcome.is_forced |= is_forced;
        }
    }

    fn advance(&mut self, column: usize) {
        while self.column < column {
            let end = self.breaks.range(self.column, self.depth)[1];
            let reach = self.reach + self.cloned[1];
            self.cuts.push((
                self.column,
                if end.is_finite() {
                    end.max(reach)
                } else {
                    reach
                },
            ));
            self.column += 1;
            self.reach = self.start() + self.top;
            self.outcome.early = None;
        }
    }

    /// Returns where the contents go on. They have got as far as `y`.
    pub(crate) fn break_at(&mut self, y: f32, appeal: Appeal, is_forced: bool) -> f32 {
        let row = *self.breaks.row(self.column);
        if row.height.is_infinite() {
            self.reach = self.reach.max(self.top + y);
            if self.breaks.tally.starts.len() <= self.column - row.first {
                self.breaks.tally.starts.push(self.top + y);
            }
        }
        self.breaks.tally.forced +=
            usize::from(is_forced && self.breaks.is_in_last_row(self.column));
        self.breaks.violates(self.column, appeal);
        self.broke(appeal, is_forced);
        self.advance(self.column + 1);
        self.breaks
            .note(self.column, self.breaks.start(self.column));
        self.is_separated = false;
        self.start()
    }

    /// Returns where the contents go on after a spanner, unless it is yet to be laid out.
    pub(crate) fn pass_spanner(&mut self, id: BoxId, y: f32) -> Option<f32> {
        self.breaks.note(self.column, self.top + y);
        self.reach = self.reach.max(self.top + y);
        let Some((_, row, _)) = self.breaks.spanners.iter().find(|it| it.0 == id) else {
            self.breaks.found_spanner = Some(id);
            return None;
        };
        let first = self.breaks.rows[*row].first;
        self.skip_to(first);
        Some(self.start())
    }

    fn skip_to(&mut self, column: usize) {
        if column > self.column {
            self.cuts.push((self.column, self.reach));
            (
                self.column,
                self.after_spanner,
                self.outcome.early,
                self.is_separated,
            ) = (column, column, None, false);
            self.reach = self.start() + self.top;
        }
    }

    fn earlier(&self, id: BoxId, line: Option<usize>) -> Option<Appeal> {
        self.breaks
            .earlier
            .iter()
            .rfind(|it| (it.id, it.line) == (id, line))
            .map(|it| it.appeal)
    }

    /// Returns where the contents go on if an earlier attempt has found that they had better break before the child.
    pub(crate) fn break_early(
        &mut self,
        (id, line): (BoxId, Option<usize>),
        y: f32,
    ) -> Option<f32> {
        let appeal = self.earlier(id, line).filter(|_| self.is_separated)?;
        Some(self.break_at(y, appeal, false))
    }

    /// For a child, or a row of them, from `top` to `bottom`.
    pub(crate) fn decide(
        &mut self,
        (id, line): (BoxId, Option<usize>),
        [top, bottom]: [f32; 2],
        own: &Outcome,
        avoids: bool,
        is_in_flow: bool,
    ) -> Decision {
        if is_in_flow && !self.is_separated && self.column == self.first {
            self.outcome.before = join(self.outcome.before, own.before);
        }
        let between = join(self.outcome.after, own.before);
        let is_separated = self.is_separated || !is_in_flow;
        if is_in_flow
            && is_separated
            && between == BreakBetween::Column
            && self.breaks.open.is_none_or(|it| self.column < it)
            && self.forced.replace((id, line)) != Some((id, line))
        {
            return Decision::Move(Appeal::Perfect, true);
        }
        let before = match between {
            _ if top <= self.start() + TOLERANCE && self.is_short() => self.breaks.tally.worst,
            _ if !is_separated => Appeal::LastResort,
            BreakBetween::Avoid | BreakBetween::AvoidColumn => Appeal::ViolatesAvoid,
            _ => Appeal::Perfect,
        };
        let space = self.end() - top;
        let with_avoidance = |appeal: Appeal| {
            if avoids {
                appeal.min(Appeal::ViolatesAvoid)
            } else {
                appeal
            }
        };
        let inside = own.inside.map(|it| {
            if own.is_forced {
                Appeal::Perfect
            } else {
                with_avoidance(it)
            }
        });
        let is_stuck = self.is_stuck(top) || self.breaks.budget == 0;
        let early = self.outcome.early.filter(|_| is_in_flow);
        let stays = match inside {
            _ if is_stuck => true,
            _ if space < -TOLERANCE || space <= TOLERANCE && own.last > self.column => false,
            Some(inside) => inside >= before && early.is_none_or(|it| inside >= it.appeal),
            None => bottom - top <= space + TOLERANCE,
        };
        if !stays {
            if inside.is_none() {
                self.breaks.lacks(self.column, bottom - top - space);
            }
            if let Some(early) = early.filter(|it| it.appeal > before) {
                self.breaks.retry = Some(early);
                return Decision::Abort;
            }
            return Decision::Move(before, false);
        }
        if let Some(inside) = inside {
            self.breaks.violates(self.column, inside);
            self.broke(inside, own.is_forced);
        }
        if is_in_flow && own.last == self.column {
            let within = own.early.map(|it| Breakpoint {
                appeal: with_avoidance(it.appeal),
                ..it
            });
            let here = Breakpoint {
                id,
                line,
                appeal: before,
            };
            let here = (!is_stuck && before > within.map_or(Appeal::LastResort, |it| it.appeal))
                .then_some(here);
            for candidate in within.into_iter().chain(here) {
                if self
                    .outcome
                    .early
                    .is_none_or(|it| it.appeal <= candidate.appeal)
                {
                    self.outcome.early = Some(candidate);
                }
            }
        }
        Decision::Stay
    }

    /// Goes on after a child in flow.
    pub(crate) fn pass(&mut self, id: BoxId, bottom: f32, own: &Outcome) {
        if own.last > self.column {
            let pieces = self
                .breaks
                .placed
                .get(&id)
                .map_or(Vec::new(), |it| it.pieces.clone());
            for (piece, next) in pieces
                .iter()
                .zip(&pieces[1..])
                .filter(|it| it.1.0 <= own.last)
            {
                self.reach = self.reach.max(piece.2);
                match self
                    .breaks
                    .spanners
                    .iter()
                    .any(|it| self.breaks.rows[it.1].first == next.0)
                {
                    true => self.skip_to(next.0),
                    false => self.advance(next.0),
                }
            }
            self.outcome.early = own.early;
        }
        self.reach = self.reach.max(self.top + bottom);
        (self.outcome.after, self.is_separated) = (own.after, true);
    }

    pub(crate) fn fill_to(&mut self, y: f32) {
        self.breaks.note(self.column, self.top + y);
        (self.reach, self.is_separated) = (self.reach.max(self.top + y), true);
    }

    /// For what is laid out in parallel and has to be inside.
    pub(crate) fn extend_to(&mut self, y: f32) {
        if self.top + y > self.reach + TOLERANCE {
            self.advance(
                self.breaks
                    .column_at(self.column, self.top + y - 3.0 * TOLERANCE),
            );
        }
    }

    /// Returns where the line has to go instead. `columns` has those of the lines before.
    pub(crate) fn break_before_line(
        &mut self,
        id: BoxId,
        columns: &[usize],
        [top, bottom]: [f32; 2],
        text: &Text,
    ) -> Option<f32> {
        let count = columns
            .iter()
            .rev()
            .take_while(|it| **it == self.column)
            .count();
        let early = self.earlier(id, Some(columns.len())).filter(|_| count > 0);
        let fits = bottom <= self.end() + TOLERANCE || bottom == top || self.is_stuck(top);
        if fits && early.is_none() {
            self.breaks.cannot_break(self.column, bottom - top);
            self.breaks.note(self.column, self.top + bottom);
            (self.reach, self.is_separated) = (self.reach.max(self.top + bottom), true);
            return None;
        }
        self.breaks.lacks(self.column, bottom - self.end());
        let least = if columns.len() == count {
            text.orphans.0
        } else {
            text.orphans.0.max(text.widows.0)
        };
        let appeal = early.unwrap_or_else(|| match count {
            0 if top > 0.0 || top <= self.start() + TOLERANCE => Appeal::Perfect,
            0 => Appeal::LastResort,
            _ if count < least as usize => Appeal::ViolatesOrphansAndWidows,
            _ => Appeal::Perfect,
        });
        Some(self.break_at(top, appeal, false))
    }

    /// Like `Breaks::floats`, from `top`.
    pub(crate) fn fragmented_floats(&self) -> Vec<(BoxId, f32, f32)> {
        self.breaks
            .floats
            .iter()
            .map(|it| (it.0, it.1 - self.top, it.2))
            .collect()
    }

    /// `columns` has that of each line.
    pub(crate) fn finish_lines(
        mut self,
        id: BoxId,
        columns: Vec<usize>,
        text: &Text,
        output: &mut Output,
    ) {
        let (total, orphans, widows) = (
            columns.len(),
            text.orphans.0 as usize,
            text.widows.0 as usize,
        );
        let last = columns.partition_point(|it| Some(it) < columns.last());
        if last > 0 && total - last < widows {
            let first = columns.partition_point(|it| *it < columns[last - 1]);
            let line = first + (total - first).saturating_sub(widows).max(orphans);
            let appeal = if total - line.min(last) < widows {
                Appeal::ViolatesOrphansAndWidows
            } else {
                Appeal::Perfect
            };
            if line < last && self.breaks.budget > 0 && self.earlier(id, Some(line)).is_none() {
                self.breaks.retry = Some(Breakpoint {
                    id,
                    line: Some(line),
                    appeal,
                });
            } else if columns[last - 1] == self.first {
                self.outcome.inside = self.outcome.inside.map(|it| it.min(appeal));
            }
        }
        let count = total - last;
        if count >= 2 {
            let line = count.saturating_sub(widows).max(orphans.min(count - 1));
            let violates = line < orphans || count - line < widows;
            let appeal = if violates {
                Appeal::ViolatesOrphansAndWidows
            } else {
                Appeal::Perfect
            };
            self.outcome.early = Some(Breakpoint {
                id,
                line: Some(last + line),
                appeal,
            });
        }
        let height = output.height;
        output.intrinsic = self.consumed(output.intrinsic);
        output.height = output.intrinsic;
        let breaks = self.finish(id, Edges::default(), false, output);
        breaks
            .placed
            .entry(id)
            .and_modify(|it| (it.lines, it.height) = (columns, height));
    }

    fn top_in(&self, column: usize) -> f32 {
        if column == self.first {
            self.top
        } else {
            self.breaks.range(column, self.depth)[0]
        }
    }

    /// The height from the top of the box to `y` in the current column, without what is only in the strip.
    pub(crate) fn consumed(&self, y: f32) -> f32 {
        let repeated = (self.cloned[0] + self.cloned[1]) * self.cuts.len() as f32;
        self.cuts
            .iter()
            .map(|(column, bottom)| bottom - self.top_in(*column))
            .sum::<f32>()
            + self.top
            + y
            - self.top_in(self.column)
            - repeated
    }

    /// For what goes from the top of the first to the bottom of the last.
    pub(crate) fn place_over(&mut self, id: BoxId, bands: &[Band]) -> f32 {
        let (first, last) = (&bands[0], &bands[bands.len() - 1]);
        let (depth, [start, end]) = (
            self.breaks.insets.len(),
            [first.columns[0], last.columns[1]],
        );
        let top = |it| {
            if it == start {
                self.top + first.top
            } else {
                self.breaks.range(it, depth)[0]
            }
        };
        let pieces = (start..=end).map(|it| (it, top(it), self.bottom_in(bands, it).max(top(it))));
        let pieces: Vec<_> = pieces.collect();
        let height = pieces.iter().map(|it| it.2 - it.1).sum();
        let pieces = if start < end { pieces } else { Vec::new() };
        let whole = Placed::whole(start, self.top + first.top, last.bottom - first.top);
        self.breaks.placed.insert(
            id,
            Placed {
                is_monolithic: false,
                height,
                pieces,
                ..whole
            },
        );
        height
    }

    fn bottom_in(&self, bands: &[Band], column: usize) -> f32 {
        match bands.iter().rfind(|it| it.columns[0] <= column) {
            Some(band) if band.columns[1] == column => self.top + band.bottom,
            _ => {
                let cut = self
                    .cuts
                    .binary_search_by_key(&column, |it| it.0)
                    .map_or(0.0, |it| self.cuts[it].1);
                if cut > self.breaks.end(column) {
                    cut
                } else {
                    cut.min(self.breaks.range(column, self.breaks.insets.len())[1])
                }
            }
        }
    }

    /// Whether a section of a table is small enough to be repeated.
    pub(crate) fn can_repeat(&self, height: f32) -> bool {
        height <= self.breaks.row(self.column).height / 4.0
            && self.end().is_finite()
            && self.breaks.open.is_none()
    }

    /// Leaves room at the start or at the end of the columns.
    pub(crate) fn reserve(&mut self, space: [f32; 2]) {
        self.breaks.insets.push((space, usize::MAX));
    }

    /// Gives the room back. The sections are also at the start of the columns that `rows` go on in, and after them.
    pub(crate) fn repeat(
        &mut self,
        header: Option<BoxId>,
        footer: Option<(BoxId, f32)>,
        rows: &[Band],
    ) {
        let (first, last) = (rows[0].columns[0], rows[rows.len() - 1].columns[1]);
        let after = footer.map(|(id, gap)| {
            (
                id,
                (first..last)
                    .map(|it| (it, self.bottom_in(rows, it) + gap))
                    .collect(),
            )
        });
        self.breaks
            .insets
            .truncate(self.depth + usize::from(self.cloned != [0.0; 2]));
        let depth = self.breaks.insets.len();
        let before = header.map(|id| {
            (
                id,
                (first + 1..=last)
                    .map(|it| (it, self.breaks.range(it, depth)[0]))
                    .collect(),
            )
        });
        for (id, copies) in before.into_iter().chain(after) {
            self.breaks
                .placed
                .entry(id)
                .and_modify(|it| it.copies = copies);
        }
    }

    /// Of what was reserved before the last, from this column on.
    pub(crate) fn release_end(&mut self) {
        self.breaks
            .insets
            .iter_mut()
            .nth_back(1)
            .into_iter()
            .for_each(|it| it.1 = self.column);
    }

    /// The height from the top of the box to `y` in a column that may have been left.
    pub(crate) fn consumed_in(&self, column: usize, y: f32) -> f32 {
        let cuts = self.cuts.iter().take_while(|it| it.0 < column);
        cuts.map(|it| it.1 - self.top_in(it.0) - self.cloned[0] - self.cloned[1])
            .sum::<f32>()
            + self.top
            + y
            - self.top_in(column)
    }

    pub(crate) fn is_whole(&self, height: f32) -> bool {
        self.outcome.inside.is_none()
            && self.cuts.is_empty()
            && height <= self.end() + self.cloned[1] + TOLERANCE
    }

    pub(crate) fn shift(&mut self, id: BoxId, by: f32) {
        self.breaks.placed.entry(id).and_modify(|it| it.shift += by);
    }

    pub(crate) fn note_static_position(&mut self, id: BoxId) {
        self.breaks
            .placed
            .insert(id, Placed::whole(self.column, f32::NAN, 0.0));
    }

    pub(crate) fn note_static_position_at(&mut self, id: BoxId, y: f32) {
        self.breaks.placed.insert(
            id,
            Placed::whole(
                self.breaks.column_at(self.first, self.top + y),
                f32::NAN,
                0.0,
            ),
        );
    }
}

impl<'a> Flow<'a> {
    /// Distributes `output.height` over the columns, and makes it the height in the strip.
    pub(crate) fn finish(
        mut self,
        id: BoxId,
        inset: Edges,
        counts_clones: bool,
        output: &mut Output,
    ) -> &'a mut Breaks {
        if let Some(limit) = self.grows {
            output.height = output.height.max(output.intrinsic.min(limit));
        }
        let (mut left, mut pieces, mut height) = (output.height, Vec::new(), output.height);
        let is_stopped = self.must_stop();
        let repeated = if counts_clones {
            0.0
        } else {
            self.cloned[0] + self.cloned[1]
        };
        let mut end = None;
        for (column, bottom) in core::mem::take(&mut self.cuts) {
            let top = self.top_in(column);
            if left <= bottom - top && output.height < output.intrinsic {
                (end, self.outcome.early, output.margins[1]) =
                    (Some((column, top + left)), None, Default::default());
                if self.after_spanner > column {
                    pieces.push((column, top, top + left));
                    end = Some((self.after_spanner, self.top_in(self.after_spanner)));
                }
                break;
            }
            let size = (bottom - top).min((left - inset.bottom + self.cloned[1]).max(0.0));
            pieces.push((column, top, top + size));
            (left, height) = (left - size + repeated, height + repeated);
        }
        let (last, bottom) = end.unwrap_or_else(|| {
            loop {
                let top = self.top_in(self.column);
                let space = self.breaks.range(self.column, self.depth)[1]
                    .max(self.reach + self.cloned[1])
                    - top;
                if is_stopped {
                    break (self.column, top + left.min(self.reach - top));
                }
                if left <= space + TOLERANCE || self.column >= MAX_COLUMNS {
                    break (self.column, top + left);
                }
                self.breaks.lacks(self.column, left - space);
                let mut appeal = if pieces.is_empty() && space < inset.top {
                    Appeal::LastResort
                } else {
                    Appeal::Perfect
                };
                if output.height <= output.intrinsic {
                    appeal = Appeal::LastResort;
                    if self.outcome.early.is_some() && self.breaks.budget > 0 {
                        self.breaks.retry = self.outcome.early;
                        break (self.column, top);
                    }
                }
                let size = Some(space.min(left - inset.bottom + self.cloned[1]))
                    .filter(|it| *it > 0.0 || top > self.breaks.start(self.column));
                let size = size.unwrap_or(space).max(0.0);
                pieces.push((self.column, top, top + size));
                self.breaks.note(self.column, top + size);
                (left, height) = (
                    left - size + repeated.min(size - 1.0).max(0.0),
                    height + repeated,
                );
                self.break_at(0.0, appeal, false);
            }
        });
        self.breaks.note(last, bottom);
        if !pieces.is_empty() {
            pieces.push((last, self.top_in(last), bottom));
        }
        output.height = bottom - self.top;
        let Flow {
            breaks,
            top,
            first: column,
            depth,
            is_known_to_fit,
            outcome,
            ..
        } = self;
        breaks.cannot_break(column, inset.top);
        breaks.cannot_break(last, inset.bottom);
        breaks.insets.truncate(depth);
        breaks.outcome = Outcome { last, ..outcome };
        breaks.placed.insert(
            id,
            Placed {
                is_monolithic: false,
                is_known_to_fit,
                height,
                pieces,
                ..Placed::whole(column, top, output.height)
            },
        );
        breaks
    }
}

/// How to get from a strip to the content box of the outermost container.
struct Mapping<'a> {
    breaks: &'a Breaks,
    /// Of the content box, in the strip around.
    x: f32,
    outer: Option<&'a Mapping<'a>>,
}

impl Mapping<'_> {
    fn locate(&self, column: usize, [x, y]: [f32; 2]) -> [f32; 2] {
        let row = self.breaks.row(column);
        let at = [
            self.x + x + self.breaks.indent + self.breaks.step * (column - row.first) as f32,
            row.y + y - self.breaks.start(column),
        ];
        self.outer.map_or(at, |it| it.locate(row.outer_column, at))
    }
}

struct Root {
    mode: WritingMode,
    size: [f32; 2],
    baselines: [Option<f32>; 2],
}

impl Root {
    fn physical(&self, [x, y]: [f32; 2], [width, height]: [f32; 2]) -> Rect {
        Rect::new([x, y, width, height]).transformed(&self.mode.to_physical(self.size))
    }
}

impl Document {
    fn is_monolithic(&self, id: BoxId) -> bool {
        if self.boxes[id].kind == Kind::Columns {
            let around = core::iter::successors(Some(id), |it| {
                Some(self.boxes[*it].parent).filter(|it| *it != 0)
            });
            if around
                .filter(|it| self.boxes[*it].kind == Kind::Columns)
                .count()
                % MAX_NESTED_COLUMNS
                == 0
            {
                return true;
            }
        }
        let it = &self.boxes[id];
        it.is_replaced()
            || it.is_foreign()
            || it.kind == Kind::Math
            || it.overflow[1].scrolls()
            || it.is_skipped
            || it.is_clamped()
            || it.style.contain().contains(Contain::SIZE) && !it.is_cell() && it.kind != Kind::Table
            || is_name!(
                it.tag,
                "button" | "input" | "select" | "textarea" | "meter" | "progress" | "legend"
            )
    }

    pub(crate) fn avoids_break_inside(&self, id: BoxId) -> bool {
        matches!(
            self.boxes[id].style.rare.break_inside,
            BreakInside::Avoid | BreakInside::AvoidColumn
        )
    }

    /// For the box that is being laid out.
    pub(crate) fn flow<'a>(
        &self,
        id: BoxId,
        input: &Input,
        inset: Edges,
        breaks: &'a mut Breaks,
    ) -> Flow<'a> {
        let (it, (column, top), depth) = (&self.boxes[id], breaks.at, breaks.insets.len());
        let space = breaks.range(column, depth)[1] - top;
        let grows = core::mem::take(&mut breaks.grows);
        let is_known_to_fit = space.is_finite()
            && !grows
            && it
                .used_height(input, Some(f32::INFINITY))
                .is_some_and(|it| it <= space + TOLERANCE);
        let mut cloned = [0.0; 2];
        if it.style.rare.decoration_break == DecorationBreak::Clone && inset.sums()[1] > 0.0 {
            cloned = [inset.top, inset.bottom];
            breaks.insets.push((
                cloned,
                breaks
                    .ends
                    .iter()
                    .rfind(|it| it.0 == id)
                    .map_or(usize::MAX, |it| it.1),
            ));
        }
        Flow {
            is_pinned: breaks.is_pinned || is_known_to_fit,
            breaks,
            top,
            contents_top: inset.top,
            first: column,
            column,
            reach: top,
            cuts: Vec::new(),
            outcome: Outcome::default(),
            is_separated: false,
            forced: None,
            is_known_to_fit,
            grows: grows.then(|| {
                it.height_limits(
                    &Room {
                        basis: [None, input.basis.1],
                        ..Room::default()
                    },
                    inset.sums(),
                    None,
                )[1]
            }),
            after_spanner: 0,
            cloned,
            depth,
        }
    }

    /// Whether the height includes the borders and paddings of all the pieces.
    pub(crate) fn counts_clones(&self, id: BoxId) -> bool {
        self.boxes[id].style.layout.box_sizing == BoxSizing::BorderBox
            && !self.boxes[id].has_auto_size(1)
    }

    /// With its top at `top` in the strip. `Output::height` is that in the strip.
    pub(crate) fn lay_out_in_column(
        &mut self,
        id: BoxId,
        input: Input,
        mut floats: Option<&mut Floats>,
        breaks: &mut Breaks,
        (column, top): (usize, f32),
    ) -> (Output, Outcome) {
        let rare = &self.boxes[id].style.rare;
        let (before, after) = (rare.break_before, rare.break_after);
        breaks.tally.has_new_box |= breaks.is_in_last_row(column) && self.boxes[id].node != 0;
        let grows = core::mem::take(&mut breaks.grows);
        if self.is_monolithic(id) || self.layout_fuel == 0 {
            let output = self.lay_out(id, input, floats);
            let height = output.height;
            breaks.placed.insert(id, Placed::whole(column, top, height));
            breaks.note(column, top + height);
            breaks.cannot_break(column, height);
            return (
                output,
                Outcome {
                    last: column,
                    before,
                    after,
                    ..Outcome::default()
                },
            );
        }
        let it = &self.boxes[id];
        let keeps_spanners = it.node == 0
            || it.joins_formatting_context && floats.is_some() && !it.style.contains_fixed();
        let allowed = breaks.allows_spanners;
        breaks.allows_spanners &= keeps_spanners;
        let clips = it.overflow[1] == Overflow::Clip || it.style.contain().contains(Contain::PAINT);
        let cares_for_end = clips || it.style.rare.decoration_break == DecorationBreak::Clone;
        let furthest = core::mem::replace(&mut breaks.tally.furthest, [column; 2]);
        let (marks, open, is_pinned) = (
            [breaks.earlier.len(), breaks.floats.len(), breaks.ends.len()],
            breaks.open,
            breaks.is_pinned,
        );
        let (count, tally) = (
            floats.as_ref().map_or(0, |it| it.len()),
            breaks.tally.clone(),
        );
        let output = loop {
            (breaks.at, breaks.is_pinned, breaks.grows, breaks.budget) = (
                (column, top),
                is_pinned,
                grows,
                breaks
                    .budget
                    .saturating_sub(1)
                    .min(self.layout_fuel.try_into().unwrap_or(u32::MAX)),
            );
            let output = self.lay_out_uncached(id, input, floats.as_deref_mut(), breaks);
            let last = breaks.outcome.last;
            match breaks.retry.take() {
                Some(retry) => breaks.earlier.extend((retry.id != 0).then_some(retry)),
                None if cares_for_end
                    && breaks.tally.furthest[0] > last
                    && breaks.ends.len() == marks[2]
                    && breaks.found_spanner.is_none() =>
                {
                    breaks.ends.push((id, last));
                    breaks.open = if clips { Some(last) } else { open };
                }
                None => break output,
            }
            breaks.rewind(&tally);
            floats.iter_mut().for_each(|it| it.truncate(count));
        };
        breaks.earlier.truncate(marks[0]);
        breaks.floats.truncate(marks[1]);
        breaks.ends.truncate(marks[2]);
        breaks.open = open;
        let last = breaks.outcome.last;
        if clips {
            for (reach, before) in breaks.tally.reach.iter_mut().zip(&tally.reach) {
                reach
                    .iter_mut()
                    .skip(last)
                    .take(1)
                    .for_each(|it| *it = before.get(last).copied().unwrap_or(0.0));
            }
            breaks.note(last, top + output.height);
        }
        let empty: Vec<_> = (last + 1..=breaks.tally.furthest[1])
            .map(|it| (it, breaks.start(it), breaks.start(it)))
            .collect();
        if let Some(placed) = breaks.placed.get_mut(&id).filter(|_| !empty.is_empty()) {
            if placed.pieces.is_empty() {
                placed.pieces.push((column, top, top + output.height));
            }
            placed.pieces.extend(empty);
        }
        breaks.tally.furthest = [0, 1].map(|it| furthest[it].max(breaks.tally.furthest[it]));
        breaks.allows_spanners = allowed;
        if self.avoids_break_inside(id) {
            breaks.cannot_break(column, output.height);
        }
        let inner = breaks.outcome;
        match self.boxes[id].style.contain().contains(Contain::LAYOUT) {
            true => (
                output,
                Outcome {
                    before,
                    after,
                    ..inner
                },
            ),
            false => (
                output,
                Outcome {
                    before: join(before, inner.before),
                    after: join(inner.after, after),
                    ..inner
                },
            ),
        }
    }

    /// Puts it at `y` from the top of `flow`, or else in a later column than `first`. Returns the top, and how far it keeps others away.
    pub(crate) fn fragment_float(
        &mut self,
        id: BoxId,
        input: Input,
        flow: &mut Flow,
        first: usize,
        mut y: f32,
        margin: Edges,
    ) -> (f32, f32, Output) {
        let (column, tally) = (flow.column, flow.breaks.tally.clone());
        flow.column = flow
            .breaks
            .column_at(first, flow.top + y - margin.top)
            .max(first);
        loop {
            let at = flow.at(y);
            let (output, own) = self.lay_out_in_column(id, input, None, flow.breaks, at);
            let range = [y - margin.top.max(0.0), y + output.height + margin.bottom];
            if let Decision::Stay =
                flow.decide((id, None), range, &own, self.avoids_break_inside(id), false)
            {
                let (is_moved, space) = (
                    flow.column > first,
                    flow.breaks.end(own.last) - flow.top - y,
                );
                flow.breaks.note(
                    own.last,
                    flow.top + y + (output.height + margin.bottom).min(space),
                );
                flow.column = first;
                if is_moved {
                    flow.broke(Appeal::Perfect, false);
                }
                flow.column = column;
                return (y, (output.height + margin.bottom).min(space), output);
            }
            flow.breaks.tally.clone_from(&tally);
            flow.column += 1;
            y = flow.start() + margin.top;
        }
    }

    /// Whether the height of an item may follow from how its contents break.
    pub(crate) fn can_grow(&self, id: BoxId) -> bool {
        !self.is_monolithic(id) && !self.has_relative_heights(id)
    }

    fn has_relative_heights(&self, id: BoxId) -> bool {
        self.boxes[id]
            .children
            .iter()
            .any(|child| match &self.boxes[*child] {
                it if it.node == 0 => self.has_relative_heights(*child),
                it => it.uses_parent[1] && !it.style.is_out_of_flow(),
            })
    }

    /// `members` are in the order of the bands that they start in.
    pub(crate) fn fragment_bands(
        &mut self,
        id: BoxId,
        flow: &mut Flow,
        bands: &mut [Band],
        members: &mut [Member],
        range: Range<usize>,
    ) {
        let before = range.start.checked_sub(1).map(|it| &bands[it]);
        let (mut shift, mut y) =
            before.map_or((0.0, flow.contents_top), |it| (it.shift, it.bottom));
        let mut next = members.partition_point(|it| it.bands[0] < range.start);
        for index in range {
            if flow.must_stop() {
                return;
            }
            let first = next;
            next += members[first..]
                .iter()
                .take_while(|it| it.bands[0] == index)
                .count();
            let band = &mut bands[index];
            let (mut top, unbroken) = (band.top + shift, band.top + band.height);
            let key = if band.is_block {
                (members[first].id, None)
            } else {
                (id, Some(index))
            };
            if let Some(resumed) = flow.break_early(key, y) {
                top = resumed + band.lead;
            }
            top -= (top - flow.end()).min(band.gap).max(0.0);
            while top > flow.end() + TOLERANCE && flow.column < MAX_COLUMNS {
                top += flow.start_of_next() - flow.end();
                y = flow.break_at(y, Appeal::Perfect, false);
            }
            flow.is_separated |= band.is_block && top > y.max(flow.start());
            let (tally, mut attempts) = (flow.breaks.tally.clone(), 0);
            let (all, reaches) = loop {
                flow.breaks.rewind(&tally);
                let shortage = flow.breaks.shortage;
                let (column, [before, after]) = (flow.column, band.between);
                let mut all = Outcome {
                    last: column,
                    before,
                    after,
                    ..Outcome::default()
                };
                let (mut needed, mut unbreakable, mut reaches) = (band.height, top, Vec::new());
                for member in &members[first..next] {
                    let (mut at, outcome) = (top + member.offsets[0], flow.outcome);
                    if member.offsets[0] > 0.0 {
                        flow.column = flow.breaks.column_at(column, flow.top + at);
                    }
                    let (output, own) = loop {
                        let (start, tally) = (flow.at(at), flow.breaks.tally.clone());
                        flow.breaks.grows = member.grows;
                        let (output, own) = self.lay_out_in_column(
                            member.id,
                            member.input,
                            None,
                            flow.breaks,
                            start,
                        );
                        let (range, avoids) = (
                            [at, at + output.height],
                            self.avoids_break_inside(member.id),
                        );
                        if !member.moves_alone
                            || member.offsets[0] <= 0.0
                            || matches!(
                                flow.decide((member.id, None), range, &own, avoids, false),
                                Decision::Stay
                            )
                        {
                            break (output, own);
                        }
                        flow.breaks.rewind(&tally);
                        flow.column += 1;
                        at = flow.start();
                    };
                    let (starts_here, start) = (flow.column == column, flow.start());
                    let skipped = (column..flow.column)
                        .map(|it| flow.breaks.range(it, flow.breaks.insets.len()))
                        .map(|it| it[1] - it[0].max(flow.top + top));
                    let offset = skipped.sum::<f32>() + at - if starts_here { top } else { start };
                    (flow.column, flow.outcome) = (column, outcome);
                    let it = &mut self.boxes[member.id];
                    let relative = crate::lines::relative_offset(
                        &it.style,
                        member.input.basis.0,
                        member.input.basis.1,
                    )[1];
                    it.layout.location.y = at + relative;
                    flow.shift(member.id, relative);
                    if band.is_block {
                        (all, needed, unbreakable) = (own, band.height, at + output.height);
                        continue;
                    }
                    let placed = &flow.breaks.placed[&member.id];
                    if member.grows && member.bands[1] == index
                        || member.moves_alone && offset > member.offsets[0] + TOLERANCE
                    {
                        needed = needed.max(offset + placed.height + member.offsets[1]);
                        reaches.extend(placed.pieces.iter().map(|it| (it.0, it.2)));
                        all.last = all.last.max(own.last);
                    }
                    let avoids = self.avoids_break_inside(member.id) && !own.is_forced;
                    match own.inside.map(|it| {
                        if avoids {
                            it.min(Appeal::ViolatesAvoid)
                        } else {
                            it
                        }
                    }) {
                        _ if !starts_here => {}
                        Some(inside) => {
                            all.inside = Some(all.inside.map_or(inside, |it| it.min(inside)))
                        }
                        None => unbreakable = unbreakable.max(at + output.height),
                    }
                    all.is_forced |= own.is_forced;
                    all.before = join(all.before, own.before);
                    all.after = if member.bands[1] == index {
                        join(all.after, own.after)
                    } else {
                        all.after
                    };
                }
                if !band.is_block {
                    if unbreakable > flow.end() + TOLERANCE {
                        all.inside = None;
                    } else if top + needed > flow.end() + TOLERANCE {
                        (all.inside, all.last) = (
                            all.inside.or(Some(Appeal::Perfect)),
                            all.last.max(column + 1),
                        );
                    }
                }
                let avoids = if band.is_block {
                    self.avoids_break_inside(key.0)
                } else {
                    band.avoids_break
                };
                if !band.is_block && top >= flow.end() - TOLERANCE {
                    flow.breaks.shortage = shortage;
                    flow.breaks.lacks(column, top + band.height - flow.end());
                }
                match flow.decide(key, [top - band.lead, unbreakable], &all, avoids, true) {
                    Decision::Abort => return,
                    Decision::Move(appeal, is_forced) => {
                        flow.breaks.rewind(&tally);
                        y = flow.break_at(y, appeal, is_forced);
                        top = y + band.lead + if is_forced { band.margin } else { 0.0 };
                    }
                    Decision::Stay if needed > band.height + TOLERANCE && attempts < 3 => {
                        for member in members[first..next]
                            .iter_mut()
                            .filter(|it| it.fills && it.bands[1] == index)
                        {
                            member.input.height =
                                member.input.height.map(|it| it + needed - band.height);
                        }
                        (band.height, attempts) = (needed, attempts + 1);
                    }
                    Decision::Stay => break (all, (reaches, unbreakable)),
                }
            };
            (band.top, band.columns[0]) = (top, flow.column);
            if band.is_block {
                y = reaches.1;
                flow.pass(key.0, y, &all);
            } else {
                let mut left = band.height;
                flow.reach = flow.reach.max(flow.top + reaches.1.min(top + left));
                loop {
                    let here = reaches.0.iter().filter(|it| it.0 == flow.column);
                    flow.reach = here.fold(flow.reach, |reach, it| reach.max(it.1));
                    let (end, reach) = (flow.end(), flow.reach - flow.top);
                    let (space, goes_on) = match end.is_finite() {
                        true => (
                            end.max(reach) - top,
                            left > end.max(reach) - top + TOLERANCE,
                        ),
                        false => (reach - top, flow.column < all.last),
                    };
                    if !goes_on || flow.column >= MAX_COLUMNS {
                        break;
                    }
                    flow.breaks.lacks(flow.column, left - space);
                    flow.breaks.note(flow.column, flow.top + top + space);
                    flow.advance(flow.column + 1);
                    (top, left) = (flow.start(), left - space);
                }
                y = top + left.max(0.0);
                flow.fill_to(y);
                flow.outcome.after = all.after;
                if band.avoids_break {
                    flow.breaks.cannot_break(band.columns[0], band.height);
                }
            }
            shift = y - unbroken;
            (band.bottom, band.columns[1], band.shift) = (y, flow.column, shift);
            for member in members[..first]
                .iter_mut()
                .filter(|it| it.fills && it.bands[1] == index)
            {
                let start = &bands[member.bands[0]];
                let height = flow.consumed(y)
                    - flow.consumed_in(start.columns[0], start.top)
                    - member.offsets[0]
                    - member.offsets[1];
                let Placed {
                    column, top, shift, ..
                } = flow.breaks.placed[&member.id];
                member.input.height = Some(height.max(0.0));
                self.lay_out_in_column(member.id, member.input, None, flow.breaks, (column, top));
                flow.shift(member.id, shift);
            }
        }
    }

    /// For stacks of boxes that are side by side. Returns where the longest ends.
    pub(crate) fn fragment_stacks(
        &mut self,
        id: BoxId,
        flow: &mut Flow,
        stacks: &mut [(Vec<Band>, Vec<Member>)],
    ) -> f32 {
        let (mut furthest, mut all) = (
            (flow.column, flow.reach, Vec::new(), flow.reach),
            flow.outcome,
        );
        for (bands, members) in stacks {
            (flow.column, flow.reach, flow.outcome, flow.is_separated) =
                (flow.first, flow.top, Outcome::default(), false);
            let range = 0..bands.len();
            self.fragment_bands(id, flow, bands, members, range);
            let (own, cuts) = (flow.outcome, core::mem::take(&mut flow.cuts));
            let bottom = flow.top
                + bands
                    .last()
                    .map_or(0.0, |it| it.bottom + members[members.len() - 1].offsets[1]);
            if (flow.column, bottom) > (furthest.0, furthest.1) {
                (furthest, all.early) = ((flow.column, bottom, cuts, flow.reach), own.early);
            }
            all.inside = all.inside.into_iter().chain(own.inside).min();
            (all.is_forced, all.before, all.after) = (
                all.is_forced || own.is_forced,
                join(all.before, own.before),
                join(all.after, own.after),
            );
            if flow.must_stop() {
                break;
            }
        }
        (flow.column, flow.reach, flow.cuts, flow.outcome) =
            (furthest.0, furthest.3, furthest.2, all);
        furthest.1 - flow.top
    }

    /// The contents, which end at `y`, ended at `unbroken` before they were fragmented.
    pub(crate) fn finish_bands(
        &mut self,
        id: BoxId,
        input: &Input,
        inset: Edges,
        mut flow: Flow,
        [unbroken, y]: [f32; 2],
        output: &mut Output,
    ) {
        let (used, height) = (flow.consumed(y), output.height);
        if used != unbroken {
            output.intrinsic += used - unbroken;
            self.finish_height(id, input, inset, output);
        }
        for child in self.boxes[id].children.clone() {
            let (at, edge) = &mut self.boxes[child].static_position[1];
            *at += edge.of([0.0, output.height - height]);
            let inside = *at - edge.of([0.0, 3.0 * TOLERANCE]);
            if self.boxes[child].style.is_out_of_flow() {
                flow.note_static_position_at(child, inside);
            }
        }
        output.intrinsic = output.intrinsic.max(used + inset.bottom);
        flow.finish(id, inset, self.counts_clones(id), output);
    }

    /// The lines have to be laid out again if it ends up elsewhere than they think.
    pub(crate) fn fragment_float_in_lines(
        &mut self,
        id: BoxId,
        basis: (f32, Option<f32>),
        flow: &mut Flow,
        y: f32,
    ) {
        let (margin, input) = self.shrunk_input(id, basis);
        const MAX_ATTEMPTS: usize = 6;
        let mut attempts = flow.breaks.floats.iter().rev().filter(|it| it.0 == id);
        let (known, may_retry) = (
            attempts.next().map(|it| it.2),
            attempts.nth(MAX_ATTEMPTS).is_none(),
        );
        let known = known.unwrap_or(self.boxes[id].layout.size.height + margin.bottom);
        let (top, height, _) = self.fragment_float(id, input, flow, flow.first, y, margin);
        if flow.breaks.retry.is_none()
            && flow.breaks.budget > 0
            && may_retry
            && ((top - y).abs() > TOLERANCE || (height - known).abs() > TOLERANCE)
        {
            flow.breaks.floats.push((id, flow.top + top, height));
            flow.breaks.retry = Some(Breakpoint {
                id: 0,
                line: None,
                appeal: Appeal::Perfect,
            });
        }
    }

    pub(crate) fn is_in_columns(&self, id: BoxId) -> bool {
        let mut around = core::iter::successors(Some(self.boxes[id].parent), |it| {
            Some(self.boxes[*it].parent).filter(|it| *it != 0)
        });
        around
            .find(|it| self.boxes[*it].kind == Kind::Columns || self.is_monolithic(*it))
            .is_some_and(|it| self.boxes[it].kind == Kind::Columns)
    }

    /// For an out-of-flow box at `y` from the top of its containing block, which is in the strip.
    pub(crate) fn fragment_out_of_flow(
        &mut self,
        id: BoxId,
        container: BoxId,
        input: Input,
        y: f32,
        is_static: bool,
        breaks: &mut Breaks,
    ) -> Option<Output> {
        let block = breaks.placed.get(&container)?;
        let (mut column, mut top, mut consumed) = (block.column, block.top + y, 0.0);
        breaks.is_pinned = block.is_known_to_fit;
        for (index, (own, start, end)) in block.pieces.iter().enumerate().filter(|_| !is_static) {
            if index == 0 || y >= consumed && end > start {
                (column, top) = (*own, start + y - consumed);
            }
            consumed += end - start;
        }
        let column = breaks.column_at(column, top);
        let (outer, allowed) = (breaks.outcome, core::mem::take(&mut breaks.allows_spanners));
        let (insets, found) = (
            core::mem::take(&mut breaks.insets),
            breaks.found_spanner.take(),
        );
        let was_out_of_flow = core::mem::replace(&mut breaks.is_out_of_flow, true);
        let furthest = breaks.tally.furthest[1];
        let (output, own) = self.lay_out_in_column(id, input, None, breaks, (column, top));
        breaks.tally.furthest[1] = furthest;
        let excess = top + output.height - breaks.end(own.last);
        if excess > TOLERANCE && top > breaks.start(column) {
            breaks.lacks(column, excess);
            breaks.violates(column, Appeal::LastResort);
        }
        breaks.is_out_of_flow = was_out_of_flow;
        (
            breaks.outcome,
            breaks.allows_spanners,
            breaks.insets,
            breaks.found_spanner,
        ) = (outer, allowed, insets, found);
        Some(output)
    }

    /// Moves everything in `flow`, which gets that size, to its column. Returns the baselines.
    pub(crate) fn distribute_to_columns(
        &mut self,
        flow: BoxId,
        breaks: &Breaks,
        size: [f32; 2],
    ) -> [Option<f32>; 2] {
        let mut root = Root {
            mode: self.boxes[flow].turned,
            size,
            baselines: [None; 2],
        };
        (
            self.boxes[flow].layout.size.width,
            self.boxes[flow].layout.size.height,
        ) = (size[0], size[1]);
        self.distribute_flow(
            flow,
            &Mapping {
                breaks,
                x: 0.0,
                outer: None,
            },
            [0.0; 2],
            0.0,
            &mut root,
        );
        root.baselines
    }

    /// `origin` is where `flow` is.
    fn distribute_flow(
        &mut self,
        flow: BoxId,
        mapping: &Mapping,
        origin: [f32; 2],
        shift: f32,
        root: &mut Root,
    ) {
        let breaks = mapping.breaks;
        let columns = (0..breaks.tally.reach[0].len().max(1)).map(|column| {
            let [x, y] = mapping.locate(column, [0.0, breaks.start(column)]);
            let (row, origin) = (breaks.row(column), origin.map(|it| -it));
            let fills = mapping.outer.is_none() && breaks.is_in_last_row(column);
            let length = if column == row.first {
                0.0
            } else if fills {
                row.height.max(root.size[1] - y)
            } else {
                row.height
            };
            let clip = root
                .physical(
                    [x + (breaks.column_width - breaks.step) / 2.0, y + shift],
                    [0.0, length],
                )
                .moved(origin);
            Piece {
                rect: root
                    .physical([x, y + shift], [breaks.column_width, row.height])
                    .moved(origin),
                shift: [0.0; 2],
                clip,
            }
        });
        self.boxes.pieces.insert(flow, columns.collect());
        self.distribute_contents(flow, mapping, [0.0; 2], origin, shift, root);
    }

    /// Along the lines, from its container.
    fn inline_offset(&self, id: BoxId, mode: WritingMode, container_width: f32) -> f32 {
        let layout = &self.boxes[id].layout;
        match mode {
            WritingMode::HorizontalTb => layout.location.x,
            WritingMode::SidewaysLr => container_width - layout.location.y - layout.size.height,
            _ => layout.location.y,
        }
    }

    /// `at` is where `id` is in the strip, and `origin` where it has been moved.
    fn distribute_contents(
        &mut self,
        id: BoxId,
        mapping: &Mapping,
        at: [f32; 2],
        origin: [f32; 2],
        shift: f32,
        root: &mut Root,
    ) {
        let it = &self.boxes[id];
        it.forget_extents();
        let width = if it.node == 0
            && it.kind == Kind::Block
            && self.boxes[it.parent].kind == Kind::Columns
        {
            mapping.breaks.column_width
        } else {
            root.mode.turn_axes(it.size())[0]
        };
        let children: Vec<_> = it
            .children
            .iter()
            .filter(|_| it.kind != Kind::Columns)
            .map(|it| (*it, false))
            .chain(it.hoisted.iter().map(|it| (*it, true)))
            .collect();
        for (child, is_hoisted) in children {
            let (own, mut mapping) = (&self.boxes[child], mapping);
            let mut x = at[0] + self.inline_offset(child, root.mode, width);
            if let Some((.., position)) = mapping.breaks.spanners.iter().find(|it| it.0 == child) {
                x = mapping.x + position[0];
                let Some(outer) = mapping.outer else {
                    let rect = root.physical(*position, root.mode.turn_axes(own.size()));
                    self.boxes[child].layout.location = Point {
                        x: rect.x - origin[0],
                        y: rect.y - origin[1],
                    };
                    continue;
                };
                mapping = outer;
            }
            let Some(placed) = mapping.breaks.placed.get(&child) else {
                continue;
            };
            if own.style.is_out_of_flow() && !is_hoisted {
                if let Some(parent) = mapping
                    .breaks
                    .placed
                    .get(&id)
                    .filter(|_| placed.top.is_nan())
                {
                    let [x, y] = mapping.locate(placed.column, at);
                    let moved = root.physical([x, y + shift], [width, parent.height_in_strip]);
                    let position = &mut self.boxes[child].static_position;
                    (position[0].0, position[1].0) = (
                        position[0].0 + moved.x - origin[0],
                        position[1].0 + moved.y - origin[1],
                    );
                }
                continue;
            }
            let shift = shift + placed.shift;
            let size = [root.mode.turn_axes(own.size())[0], placed.height];
            let locate = |column, y| {
                let [x, y] = mapping.locate(column, [x, y]);
                [x, y + shift]
            };
            let whole = root.physical(locate(placed.column, placed.top), size);
            let layout = &mut self.boxes[child].layout;
            layout.location = Point {
                x: whole.x - origin[0],
                y: whole.y - origin[1],
            };
            if placed.is_monolithic {
                continue;
            }
            (layout.size.width, layout.size.height) = (whole.width, whole.height);
            if !placed.pieces.is_empty() {
                let mut consumed = 0.0;
                let pieces =
                    placed
                        .pieces
                        .iter()
                        .enumerate()
                        .map(|(index, (column, top, bottom))| {
                            let [x, y] = locate(*column, *top);
                            let moved = root.physical([x, y - consumed], size);
                            consumed += bottom - top;
                            let rect = root
                                .physical([x, y], [size[0], bottom - top])
                                .moved([-whole.x, -whole.y]);
                            let [above, below] = [0, placed.pieces.len() - 1]
                                .map(|it| if index == it { FAR } else { 0.0 });
                            let clip = root.physical(
                                [x - FAR, y - above],
                                [size[0] + 2.0 * FAR, bottom - top + above + below],
                            );
                            Piece {
                                rect,
                                shift: [moved.x - whole.x, moved.y - whole.y],
                                clip: clip.moved([-whole.x, -whole.y]),
                            }
                        });
                self.boxes.pieces.insert(child, pieces.collect());
            }
            let (at, origin) = ([x, placed.top], [whole.x, whole.y]);
            self.distribute_lines(child, placed, &|column| locate(column, placed.top), root);
            if let (Some(breaks), Some(flow)) = (
                mapping.breaks.nested.get(&child),
                self.boxes[child].children.first().copied(),
            ) {
                let x = x + self.inline_offset(flow, root.mode, size[0]);
                let layout = &mut self.boxes[flow].layout;
                (layout.location, layout.size) = (Point::default(), Default::default());
                self.distribute_flow(
                    flow,
                    &Mapping {
                        breaks,
                        x,
                        outer: Some(mapping),
                    },
                    origin,
                    shift,
                    root,
                );
            }
            self.distribute_contents(child, mapping, at, origin, shift, root);
            if let Some(first) = placed.copies.first() {
                let place = |it: &(usize, f32)| root.physical(locate(it.0, it.1), size);
                let mut all: Vec<_> = placed.copies.iter().map(place).collect();
                let main = if first.0 < placed.column {
                    core::mem::replace(&mut all[0], whole)
                } else {
                    whole
                };
                let location = &mut self.boxes[child].layout.location;
                (location.x, location.y) =
                    (location.x + main.x - whole.x, location.y + main.y - whole.y);
                self.boxes.copies.insert(
                    child,
                    all.iter()
                        .map(|it| [it.x - main.x, it.y - main.y])
                        .collect(),
                );
            }
        }
    }

    /// `locate` tells where the box would be if it were in that column.
    fn distribute_lines(
        &mut self,
        id: BoxId,
        placed: &Placed,
        locate: &dyn Fn(usize) -> [f32; 2],
        root: &mut Root,
    ) {
        let Some(mut inline) = self.boxes[id].inline.take() else {
            return;
        };
        let (own, flips) = (locate(placed.column), root.mode.flips_lines());
        let (lines, mut bounds) = (&mut inline.lines, None::<Rect>);
        for (line, column) in lines.lines.iter_mut().zip(&placed.lines) {
            let at = locate(*column);
            let baseline = at[1]
                + if flips {
                    placed.height - line.baseline
                } else {
                    line.baseline
                };
            root.baselines = [
                root.baselines[0].map_or(baseline, |it| it.min(baseline)),
                root.baselines[1].map_or(baseline, |it| it.max(baseline)),
            ]
            .map(Some);
            let [x, y] = [
                at[0] - own[0],
                (at[1] - own[1]) * if flips { -1.0 } else { 1.0 },
            ];
            line.translate([x, y]);
            for fragment in
                &mut lines.fragments[line.fragments.start as usize..line.fragments.end as usize]
            {
                (fragment.x, fragment.y, fragment.baseline) =
                    (fragment.x + x, fragment.y + y, fragment.baseline + y);
                bounds =
                    Some(bounds.map_or_else(|| fragment.rect(), |it| it.union(&fragment.rect())));
                if let FragmentKind::Atomic(child) = fragment.kind {
                    let [from, to] = [own, at].map(|it| root.physical(it, [0.0; 2]));
                    let location = &mut self.boxes[child].layout.location;
                    (location.x, location.y) =
                        (location.x + to.x - from.x, location.y + to.y - from.y);
                }
            }
        }
        if !placed.pieces.is_empty() {
            lines.bounds = bounds.unwrap_or_default();
            lines.flow = lines.bounds;
        }
        self.boxes[id].inline = Some(inline);
    }

    pub(crate) fn pieces(&self, id: BoxId) -> Option<&[Piece]> {
        if self.boxes.pieces.is_empty() {
            None
        } else {
            self.boxes.pieces.get(&id).map(|it| &it[..])
        }
    }

    /// The border box, or what is around its pieces.
    #[inline]
    pub(crate) fn extent(&self, id: BoxId) -> Rect {
        if self.boxes.pieces.is_empty() {
            return self.border_box(id);
        }
        let pieces = self
            .pieces(id)
            .and_then(|it| it.iter().map(|it| it.rect).reduce(|a, b| a.union(&b)));
        pieces.unwrap_or_else(|| self.border_box(id))
    }
}
