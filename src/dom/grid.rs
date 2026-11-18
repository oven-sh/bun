//! Grid layout.

use core::ops::Range;
use std::rc::Rc;

use smallvec::SmallVec;

use crate::abi::Rect;
use crate::block::{align_self, justify_self};
use crate::boxes::{BoxId, Kind};
use crate::document::Document;
use crate::fragment::{Band, Breaks, Member};
use crate::layout::{
    AutoSize, Claims, Edges, Input, Output, Room, Traits, Widths, auto_margins, clamp, distribute,
    gap, is_relative, margin, resolve_if_definite, sizes, unit,
};
use crate::order::Order as _;
use crate::positioned::{Edge, halves};
use crate::properties::Style;
use crate::scroll::Contents;
use crate::types::*;
use crate::values::{Css, Lp, Out, Size, Str, write_list, write_px};

const MAX_TRACKS: i32 = 10_000;

/// For each line.
type Names = Vec<Vec<Str>>;

/// The edges of the tracks, from the start of the content box.
#[derive(Clone, Default)]
struct Positions(Option<Rc<[[f32; 2]]>>);

impl core::ops::Deref for Positions {
    type Target = [[f32; 2]];
    #[inline]
    fn deref(&self) -> &[[f32; 2]] {
        self.0.as_deref().unwrap_or_default()
    }
}

impl PartialEq for Positions {
    fn eq(&self, other: &Positions) -> bool {
        core::ptr::eq(&raw const **self, &raw const **other) || **self == **other
    }
}

impl FromIterator<[f32; 2]> for Positions {
    fn from_iter<I: IntoIterator<Item = [f32; 2]>>(all: I) -> Positions {
        Positions(Some(all.into_iter().collect()))
    }
}

#[derive(Clone, Copy, PartialEq)]
struct Frame {
    /// Of the content box in the border box.
    origin: [f32; 2],
    /// Where the columns start, if that is at the right.
    right: Option<f32>,
}

impl Frame {
    #[inline]
    fn physical(&self, axis: usize, [start, end]: [f32; 2]) -> [f32; 2] {
        match self.right.filter(|_| axis == 0) {
            Some(right) => [right - end, right - start],
            None => [self.origin[axis] + start, self.origin[axis] + end],
        }
    }
}

/// What is left of the layout. Axis 0 is the columns.
#[derive(Default)]
pub(crate) struct GridInfo {
    tracks: [Positions; 2],
    frame: Option<Frame>,
    lines: [Rc<Lines>; 2],
    kept: Option<Box<Kept>>,
}

/// What another layout starts from.
struct Kept {
    grid: Grid,
    repetitions: [usize; 2],
    children: usize,
    /// The items that have got another style, as long as they are few.
    restyled: SmallVec<[BoxId; 4]>,
    /// These go when something in the grid changes.
    columns: Option<Settled>,
    rows: Option<SizedRows>,
    placed: Option<Placed>,
}

/// The tracks after the items have had their say.
struct Settled {
    definite: Option<f32>,
    tracks: Vec<Sized>,
    gap: f32,
    uses_height: bool,
    max_content_fr: Option<f64>,
}

struct SizedRows {
    columns: Positions,
    /// What the items ask for, if they are much fewer than the rows.
    wanted: Option<Vec<Wanted>>,
    space: Space,
    total: f32,
    height: f32,
    positions: Positions,
    gap: f32,
}

struct Placed {
    tracks: [Positions; 2],
    frame: Frame,
    baselines: [Option<f32>; 2],
    escapes: Claims,
}

/// What an item in a single track asks for: at least, and as its min-content and max-content contributions.
type Wanted = (usize, [f32; 3]);

/// What a subgrid gets from the grid around it.
#[derive(Default, PartialEq)]
pub(crate) struct Inherited {
    tracks: [Option<Positions>; 2],
    names: [Names; 2],
    gaps: [f32; 2],
    baselines: [Vec<[f32; 2]>; 2],
}

#[derive(Default)]
struct Lines {
    /// The number of implicit tracks before the explicit grid, and of those in it.
    before: usize,
    explicit: usize,
    names: Names,
    /// Those in the template.
    own_names: Names,
    are_inherited: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Sizing {
    Fixed(f32),
    MinContent,
    MaxContent,
    Auto,
    Fr(f32),
    FitContent(f32),
}

#[derive(Clone)]
struct Sized {
    min: Sizing,
    max: Sizing,
    base: f32,
    limit: f32,
    planned: Option<f32>,
    grows_infinitely: bool,
    is_collapsed: bool,
}

#[derive(Default)]
struct Axis {
    lines: Rc<Lines>,
    /// For each track. Empty in a subgrid.
    tracks: Vec<Track>,
    collapsed: Vec<bool>,
    is_subgrid: bool,
    has_percentages: bool,
    has_flex: bool,
    /// No item spans several tracks, or is aligned to a baseline.
    has_simple_items: bool,
    positions: Positions,
    /// What a subgrid has last made of the tracks around it, its edges and the gaps.
    derived: Option<(Positions, [f32; 4], Positions)>,
    /// The sizes, as far as they are known before the positions.
    estimates: Vec<f32>,
    estimated_for: Option<Option<f32>>,
    gap: f32,
    has_baselines: bool,
    /// From the start and from the end of each track.
    baselines: Vec<[f32; 2]>,
}

struct Item {
    id: BoxId,
    align: [Align; 2],
    area: [Range<usize>; 2],
    subgrid: Option<Box<Grid>>,
    /// 1 if its axes are the other way round.
    crosses: usize,
    placement: Rc<crate::properties::Grid>,
}

struct Grid {
    style: Rc<Style>,
    axes: [Axis; 2],
    items: Vec<Item>,
    has_subgrids: bool,
    /// And so are its items and those of its subgrids.
    is_horizontal: bool,
    /// The boxes of the items are in no order.
    is_shuffled: bool,
}

/// An item, maybe of a subgrid, that the tracks have to make room for.
struct Contributor {
    id: BoxId,
    /// In its own grid, and whether that goes the other way.
    axis: usize,
    is_opposite: bool,
    span: Range<usize>,
    /// What the subgrids around it add before and after it.
    extra: [f32; 2],
    /// The size of its area along the axis, and along the other.
    own: Option<f32>,
    other: Option<f32>,
    align: [Align; 2],
    sizes: Option<[f32; 2]>,
    shim: f32,
}

#[derive(Clone, Copy, PartialEq)]
enum Space {
    MinContent,
    MaxContent,
    Definite(f32),
}

impl Space {
    fn definite(self) -> Option<f32> {
        if let Space::Definite(size) = self {
            Some(size)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Step {
    IntrinsicMinimums,
    ContentMinimums,
    MaxContentMinimums,
    IntrinsicMaximums,
    MaxContentMaximums,
}

enum Placement {
    Lines(i32, i32),
    Span(i32),
}

impl Lines {
    fn named<'a>(&'a self, name: &'a str) -> impl DoubleEndedIterator<Item = i32> + 'a {
        (0..self.names.len())
            .filter(move |it| self.names[*it].iter().any(|it| &**it == name))
            .map(|it| it as i32)
    }

    fn line(&self, line: &GridLine, is_end: bool) -> Option<i32> {
        let count = self.explicit as i32;
        Some(match line {
            GridLine::Line(index) if *index > 0 => i32::from(*index) - 1,
            GridLine::Line(index) => count + 1 + i32::from(*index),
            GridLine::NamedLine(name, index) => {
                if *index == 0
                    && let Some(found) = self
                        .named(&format!("{name}-{}", if is_end { "end" } else { "start" }))
                        .next()
                {
                    return Some(found);
                }
                let (index, found) = (
                    if *index == 0 { 1 } else { i32::from(*index) },
                    self.named(name).count() as i32,
                );
                match index > 0 {
                    true => self
                        .named(name)
                        .nth(index as usize - 1)
                        .unwrap_or(count + index - found),
                    false => self
                        .named(name)
                        .nth_back(-index as usize - 1)
                        .unwrap_or(index + found),
                }
            }
            _ => return None,
        })
    }

    fn across(&self, from: i32, span: &GridLine, forward: bool) -> i32 {
        match (span, forward) {
            (GridLine::NamedSpan(name, count), true) => {
                let after = || self.named(name).filter(|it| *it > from);
                let missing = i32::from(*count) - after().count() as i32;
                after()
                    .nth(usize::from(*count) - 1)
                    .unwrap_or_else(|| from.max(self.explicit as i32) + missing)
            }
            (GridLine::NamedSpan(name, count), false) => {
                let before = || self.named(name).filter(|it| *it < from);
                let missing = i32::from(*count) - before().count() as i32;
                before()
                    .nth_back(usize::from(*count) - 1)
                    .unwrap_or_else(|| from.min(0) - missing)
            }
            (GridLine::Span(count), _) => from + i32::from(*count) * if forward { 1 } else { -1 },
            _ => from + if forward { 1 } else { -1 },
        }
    }

    fn place(&self, start: &GridLine, end: &GridLine, auto_span: i32) -> Placement {
        match (self.line(start, false), self.line(end, true)) {
            (Some(start), Some(end)) if start == end => Placement::Lines(start, start + 1),
            (Some(start), Some(end)) => Placement::Lines(start.min(end), start.max(end)),
            (Some(start), None) if *end == GridLine::Auto => {
                Placement::Lines(start, start + auto_span)
            }
            (None, Some(end)) if *start == GridLine::Auto => Placement::Lines(end - auto_span, end),
            (Some(start), None) => Placement::Lines(start, self.across(start, end, true)),
            (None, Some(end)) => Placement::Lines(self.across(end, start, false), end),
            (None, None) => Placement::Span(match (start, end) {
                (GridLine::Span(count), _) | (GridLine::Auto, GridLine::Span(count)) => {
                    i32::from(*count)
                }
                (GridLine::Auto, GridLine::Auto) => auto_span,
                _ => 1,
            }),
        }
    }
}

fn template(style: &Style, axis: usize) -> &Template {
    if axis == 0 {
        &style.grid.columns
    } else {
        &style.grid.rows
    }
}

fn grid_lines(style: &Style, axis: usize) -> [&GridLine; 2] {
    let g = &style.grid;
    if axis == 0 {
        [&g.column_start, &g.column_end]
    } else {
        [&g.row_start, &g.row_end]
    }
}

fn gap_of(style: &Style, axis: usize, basis: Option<f32>) -> f32 {
    gap(
        if axis == 0 {
            &style.layout.column_gap
        } else {
            &style.layout.row_gap
        },
        basis,
    )
}

fn sizing(track: &Track, basis: Option<f32>) -> (Sizing, Sizing) {
    let of = |breadth: &Breadth| match breadth {
        Breadth::Length(length) => {
            resolve_if_definite(length, basis).map_or(Sizing::Auto, |it| Sizing::Fixed(it.max(0.0)))
        }
        Breadth::Fr(fr) => Sizing::Fr(*fr),
        Breadth::Auto => Sizing::Auto,
        Breadth::MinContent => Sizing::MinContent,
        Breadth::MaxContent => Sizing::MaxContent,
    };
    match track {
        Track::Breadth(Breadth::Fr(fr)) => (Sizing::Auto, Sizing::Fr(*fr)),
        Track::Breadth(breadth) => (of(breadth), of(breadth)),
        Track::MinMax(min, max) => (of(min), of(max)),
        Track::FitContent(limit) => (
            Sizing::Auto,
            resolve_if_definite(limit, basis).map_or(Sizing::MaxContent, Sizing::FitContent),
        ),
    }
}

fn has_percentage(track: &Track) -> bool {
    let has = |it: &Breadth| matches!(it, Breadth::Length(Lp::Fraction(_) | Lp::Calc(_)));
    match track {
        Track::Breadth(it) => has(it),
        Track::MinMax(min, max) => has(min) || has(max),
        Track::FitContent(limit) => !matches!(limit, Lp::Px(_)),
    }
}

fn simple_tracks(list: &TrackList) -> impl Iterator<Item = &Track> + Clone {
    list.items.iter().filter_map(|it| match it {
        TrackItem::Track(it) => Some(it),
        TrackItem::Repeat(..) => None,
    })
}

/// `size` is that of the content box, or else its limits.
fn automatic_repetitions(
    list: &TrackList,
    style: &Style,
    axis: usize,
    size: Result<f32, [f32; 2]>,
) -> usize {
    let (space, rounds_up) = match size {
        Ok(size) => (size, false),
        Err([_, max]) if max.is_finite() => (max, false),
        Err([min, _]) => (min, true),
    };
    let gap = gap_of(style, axis, Some(space));
    let least = |track: &Track| match sizing(track, Some(space)) {
        (Sizing::Fixed(min), Sizing::Fixed(max)) => max.max(min),
        (_, Sizing::Fixed(size)) | (Sizing::Fixed(size), _) => size,
        _ => 0.0,
    };
    let (mut fixed, mut repeated) = (0.0, 0.0);
    for item in &list.items {
        match item {
            TrackItem::Track(track) => fixed += least(track) + gap,
            TrackItem::Repeat(Repetition::Count(count), list) => {
                fixed +=
                    simple_tracks(list).map(|it| least(it) + gap).sum::<f32>() * f32::from(*count);
            }
            TrackItem::Repeat(_, list) => {
                repeated = simple_tracks(list).map(|it| least(it).max(1.0) + gap).sum()
            }
        }
    }
    let count = (space + gap - fixed) / repeated;
    (if rounds_up {
        count.ceil()
    } else {
        (count + 0.0001).floor()
    })
    .clamp(1.0, 2000.0) as usize
}

fn repetitions(style: &Style, size: impl Fn(usize) -> Result<f32, [f32; 2]>) -> [usize; 2] {
    [0, 1].map(|axis| match template(style, axis) {
        Template::Tracks(list) if list.repeats_automatically() => {
            automatic_repetitions(list, style, axis, size(axis))
        }
        _ => 0,
    })
}

pub(crate) fn repeats_automatically(style: &Style) -> bool {
    [0, 1].iter().any(|axis| matches!(template(style, *axis), Template::Tracks(list) if list.repeats_automatically()))
}

fn alignment(item: &Style, grid: &Style) -> [Align; 2] {
    [
        justify_self(item, grid),
        align_self(item, grid.layout.align_items),
    ]
}

impl GridInfo {
    pub(crate) fn forget_placement(&mut self) {
        self.kept = None;
    }

    pub(crate) fn note_new_style(&mut self, item: BoxId) {
        if let Some(kept) = self.kept.as_mut().filter(|it| !it.restyled.spilled()) {
            kept.restyled.push(item);
        }
    }

    /// From the border box.
    fn track(&self, axis: usize, index: usize) -> Option<[f32; 2]> {
        Some(self.frame?.physical(axis, *self.tracks[axis].get(index)?))
    }

    /// Of all tracks.
    pub(crate) fn extent(&self, axis: usize) -> Option<[f32; 2]> {
        Some(
            self.frame?.physical(
                axis,
                self.tracks[axis]
                    .iter()
                    .copied()
                    .reduce(|a, b| [a[0].min(b[0]), a[1].max(b[1])])?,
            ),
        )
    }

    /// The resolved value of `grid-template-columns` or `grid-template-rows`.
    pub(crate) fn write(&self, axis: usize, out: &mut Out) {
        let (lines, tracks, mut words) = (&self.lines[axis], &self.tracks[axis], Vec::new());
        for line in 0..=tracks.len() {
            let names = line
                .checked_sub(lines.before)
                .and_then(|it| lines.own_names.get(it))
                .map_or(&[][..], |it| it);
            if !names.is_empty() || lines.are_inherited {
                let mut word = b"[".to_vec();
                write_list(names, " ", &mut word, Str::write);
                words.push([&word[..], b"]"].concat());
            }
            if let Some([start, end]) = self.track(axis, line).filter(|_| !lines.are_inherited) {
                words.push(Out::new());
                words
                    .last_mut()
                    .into_iter()
                    .for_each(|it| write_px(end - start, it));
            }
        }
        out.extend(
            if lines.are_inherited {
                "subgrid "
            } else if tracks.is_empty() {
                return out.extend(b"none");
            } else {
                ""
            }
            .bytes(),
        );
        out.extend(words.join(&b' '));
    }
}

impl Axis {
    /// Also returns the lines, and the tracks that collapse if they are empty.
    fn explicit(
        style: &Style,
        axis: usize,
        repetitions: usize,
        inherited: Option<(usize, &Names)>,
    ) -> (Axis, Lines, Range<usize>) {
        let (mut new, mut lines, mut fitted) = (Axis::default(), Lines::default(), 0..0);
        let mut name = |line: usize, names: &[Str]| {
            if !names.is_empty() {
                lines
                    .names
                    .resize(lines.names.len().max(line + 1), Vec::new());
                lines.names[line].extend_from_slice(names);
            }
        };
        match (template(style, axis), inherited) {
            (Template::Subgrid(own), Some((count, names))) => {
                names
                    .iter()
                    .enumerate()
                    .for_each(|(line, names)| name(line, names));
                own.expand(count + 1)
                    .enumerate()
                    .for_each(|(line, names)| name(line, names));
                lines.own_names = own.expand(count + 1).cloned().collect();
                (new.is_subgrid, lines.explicit, lines.are_inherited) = (true, count, true);
            }
            (Template::Tracks(list), _) => {
                for (item, names) in list.items.iter().zip(&list.names) {
                    name(new.tracks.len(), names);
                    match item {
                        TrackItem::Track(track) => new.tracks.push(track.clone()),
                        TrackItem::Repeat(repetition, repeated) => {
                            let start = new.tracks.len();
                            let count = match repetition {
                                Repetition::Count(count) => usize::from(*count),
                                _ => repetitions,
                            };
                            for _ in 0..count.min(MAX_TRACKS as usize / repeated.items.len().max(1))
                            {
                                for (track, names) in simple_tracks(repeated).zip(&repeated.names) {
                                    name(new.tracks.len(), names);
                                    new.tracks.push(track.clone());
                                }
                                name(new.tracks.len(), repeated.names.last().map_or(&[], |it| it));
                            }
                            if *repetition == Repetition::AutoFit {
                                fitted = start..new.tracks.len();
                            }
                        }
                    }
                }
                name(new.tracks.len(), list.names.last().map_or(&[], |it| it));
                lines.explicit = new.tracks.len();
                lines.own_names.clone_from(&lines.names);
            }
            _ => {}
        }
        if style.grid.areas.counts()[1] > 0 {
            let mut name = |line: usize, name: String| {
                lines
                    .names
                    .resize(lines.names.len().max(line + 1), Vec::new());
                lines.names[line].push(name.into());
            };
            for (area, lines) in style.grid.areas.named() {
                name(lines[axis].start, format!("{area}-start"));
                name(lines[axis].end, format!("{area}-end"));
            }
        }
        match new.is_subgrid {
            true => lines.names.truncate(lines.explicit + 1),
            false => lines.explicit = lines.explicit.max(style.grid.areas.counts()[axis]),
        }
        (new, lines, fitted)
    }

    fn unsized_track(&self, index: usize, definite: Option<f32>) -> Sized {
        let is_collapsed = self.collapsed.get(index) == Some(&true);
        let (min, max) = if is_collapsed {
            (Sizing::Fixed(0.0), Sizing::Fixed(0.0))
        } else {
            sizing(&self.tracks[index], definite)
        };
        let fixed = |it| match it {
            Sizing::Fixed(size) => Some(size),
            _ => None,
        };
        let base = fixed(min).unwrap_or(0.0);
        let limit = fixed(max).map_or(f32::INFINITY, |it| it.max(base));
        Sized {
            min,
            max,
            base,
            limit,
            planned: None,
            grows_infinitely: false,
            is_collapsed,
        }
    }

    fn area(&self, span: &Range<usize>) -> Option<[f32; 2]> {
        Some([
            self.positions.get(span.start)?[0],
            self.positions.get(span.end - 1)?[1],
        ])
    }

    fn has_intrinsic(&self, span: &Range<usize>) -> bool {
        self.tracks.get(span.clone()).is_some_and(|it| {
            it.iter()
                .any(|it| !matches!(sizing(it, Some(0.0)), (Sizing::Fixed(_), Sizing::Fixed(_))))
        })
    }

    fn extent(&self, span: &Range<usize>) -> Option<f32> {
        let estimate = || {
            Some(
                self.estimates
                    .get(span.clone())?
                    .iter()
                    .try_fold(0.0, |all, it| {
                        it.is_finite().then_some(all + (it + self.gap))
                    })?
                    - self.gap,
            )
        };
        self.area(span)
            .map(|[start, end]| (end - start).max(0.0))
            .or_else(estimate)
    }
}

impl Item {
    /// If it has the tracks of that axis of its parent.
    fn inheriting(&self, axis: usize) -> Option<&Grid> {
        self.subgrid
            .as_deref()
            .filter(|it| it.axes[axis ^ self.crosses].is_subgrid)
    }
}

impl Grid {
    /// As it was built.
    fn unsize(&mut self) {
        for it in &mut self.axes {
            (it.positions, it.gap) = Default::default();
            it.baselines.clear();
        }
        if self.has_subgrids {
            self.items
                .iter_mut()
                .filter_map(|it| it.subgrid.as_mut())
                .for_each(|it| it.unsize());
        }
    }

    fn has_relative_tracks(&self, axis: usize) -> bool {
        let gap = if axis == 0 {
            &self.style.layout.column_gap
        } else {
            &self.style.layout.row_gap
        };
        self.axes[axis].has_percentages
            || gap.0.as_ref().is_some_and(|it| !matches!(it.0, Lp::Px(_)))
    }

    fn is_contained(&self, axis: usize) -> bool {
        self.style.contain().intersects(if axis == 0 {
            Contain::SIZE | Contain::INLINE_SIZE
        } else {
            Contain::SIZE
        })
    }

    fn holds_for(&self, new: &Rc<Style>) -> bool {
        let (old, [a, b]) = (&self.style, [&self.style.layout, &new.layout]);
        Rc::ptr_eq(old, new)
            || (Rc::ptr_eq(&old.grid, &new.grid) || old.grid == new.grid)
                && (
                    a.justify_items,
                    a.align_items,
                    a.justify_content,
                    a.align_content,
                ) == (
                    b.justify_items,
                    b.align_items,
                    b.justify_content,
                    b.align_content,
                )
                && (&a.column_gap, &a.row_gap) == (&b.column_gap, &b.row_gap)
                && (old.contain(), old.is_rtl()) == (new.contain(), new.is_rtl())
                && Rc::ptr_eq(&old.font, &new.font)
                && Rc::ptr_eq(&old.text, &new.text)
    }
}

/// Which cells are taken: for each run of tracks of the major axis, where it ends and the ordered ranges along the minor one.
#[derive(Default)]
struct Occupancy(Vec<(usize, Vec<Range<usize>>)>);

impl Occupancy {
    /// The lines up to which something that is in the way stays in the way.
    fn obstacle(&self, major: &Range<usize>, minor: &Range<usize>) -> Option<(usize, usize)> {
        let (first, mut start) = (
            self.0.partition_point(|it| it.0 <= major.start),
            major.start,
        );
        self.0[first..]
            .iter()
            .take_while(|it| core::mem::replace(&mut start, it.0) < major.end)
            .find_map(|(end, taken)| {
                let found = taken.get(taken.partition_point(|it| it.end <= minor.start))?;
                (found.start < minor.end).then_some((*end, found.end))
            })
    }

    /// The index of the run that starts at `line`.
    fn split(&mut self, line: usize) -> usize {
        let index = self.0.partition_point(|it| it.0 < line);
        if line == 0 {
            return 0;
        }
        match self.0.get(index) {
            Some(run) if run.0 == line => {}
            run => self.0.insert(
                index,
                (line, run.map(|it| it.1.clone()).unwrap_or_default()),
            ),
        }
        index + 1
    }

    fn take(&mut self, major: &Range<usize>, minor: &Range<usize>) {
        let runs = self.split(major.start)..self.split(major.end);
        for (_, taken) in &mut self.0[runs] {
            let touched = taken.partition_point(|it| it.end < minor.start)
                ..taken.partition_point(|it| it.start <= minor.end);
            let joined = taken[touched.clone()]
                .iter()
                .fold(minor.clone(), |a, b| a.start.min(b.start)..a.end.max(b.end));
            taken.splice(touched, [joined]);
        }
    }
}

fn place_items(
    placements: &[[Placement; 2]],
    lines: &mut [Lines; 2],
    flow: GridAutoFlow,
) -> Vec<[Range<usize>; 2]> {
    let (minor, is_dense) = (usize::from(flow.is_column), flow.is_dense);
    let major = 1 - minor;
    let mut counts = [0; 2];
    for axis in 0..2 {
        let (mut first, mut last, mut widest) = (0, lines[axis].explicit as i32, 0);
        for placement in placements {
            match placement[axis] {
                Placement::Lines(start, end) => (first, last) = (first.min(start), last.max(end)),
                Placement::Span(span) => widest = widest.max(span),
            }
        }
        lines[axis].before = -first as usize;
        counts[axis] = (last - first).max(widest) as usize;
    }
    if placements
        .iter()
        .all(|it| matches!(it, [Placement::Span(1), Placement::Span(1)]))
    {
        let area = |index: usize| {
            [0, 1]
                .map(|axis| {
                    if axis == minor {
                        index % counts[minor]
                    } else {
                        index / counts[minor]
                    }
                })
                .map(|it| it..it + 1)
        };
        return (0..placements.len()).map(area).collect();
    }
    let range = |placement: &[Placement; 2], axis: usize| match placement[axis] {
        Placement::Lines(start, end) => {
            let before = lines[axis].before as i32;
            Ok((start + before) as usize..(end + before) as usize)
        }
        Placement::Span(span) => Err(span as usize),
    };
    let (mut occupancy, last_start) = (
        Occupancy::default(),
        (MAX_TRACKS as usize * 10).max(placements.len() * 4),
    );
    let mut areas = vec![[0..0, 0..0]; placements.len()];
    let has_automatic = placements
        .iter()
        .any(|it| it.iter().any(|it| matches!(it, Placement::Span(_))));
    let mut set = |occupancy: &mut Occupancy,
                   index: usize,
                   along_major: Range<usize>,
                   along_minor: Range<usize>| {
        if has_automatic {
            occupancy.take(&along_major, &along_minor);
        }
        (areas[index][major], areas[index][minor]) = (along_major, along_minor);
    };
    for (index, placement) in placements.iter().enumerate() {
        if let (Ok(along_major), Ok(along_minor)) =
            (range(placement, major), range(placement, minor))
        {
            set(&mut occupancy, index, along_major, along_minor);
        }
    }
    let mut cursors = crate::name::Map::<usize, usize>::default();
    for (index, placement) in placements.iter().enumerate() {
        if let (Ok(along_major), Err(span)) = (range(placement, major), range(placement, minor)) {
            let cursor = cursors.entry(along_major.start).or_default();
            let mut at = if is_dense { 0 } else { *cursor };
            while let Some(obstacle) = occupancy.obstacle(&along_major, &(at..at + span)) {
                at = obstacle.1;
            }
            at = at.min(last_start);
            *cursor = at + span;
            if !lines[minor].are_inherited {
                counts[minor] = counts[minor].max(at + span);
            }
            set(&mut occupancy, index, along_major, at..at + span);
        }
    }
    let (mut cursor, mut earliest) = ((0, 0), crate::name::Map::default());
    for (index, placement) in placements.iter().enumerate() {
        let Err(span) = range(placement, major) else {
            continue;
        };
        let along_minor = range(placement, minor);
        if is_dense {
            cursor = earliest
                .get(&(span, along_minor.clone()))
                .copied()
                .unwrap_or((0, 0));
        }
        let placed = match along_minor.clone() {
            Ok(along_minor) => {
                cursor.0 += usize::from(along_minor.start < cursor.1);
                while let Some(obstacle) =
                    occupancy.obstacle(&(cursor.0..cursor.0 + span), &along_minor)
                {
                    cursor.0 = obstacle.0;
                }
                along_minor
            }
            Err(width) => {
                let mut next = if cursor.1 == 0 {
                    usize::MAX
                } else {
                    cursor.0 + 1
                };
                loop {
                    if cursor.1 + width > counts[minor] {
                        cursor = (core::mem::replace(&mut next, usize::MAX), 0);
                    }
                    let Some(obstacle) = occupancy
                        .obstacle(&(cursor.0..cursor.0 + span), &(cursor.1..cursor.1 + width))
                    else {
                        break cursor.1..cursor.1 + width;
                    };
                    (next, cursor.1) = (next.min(obstacle.0), obstacle.1);
                }
            }
        };
        cursor.1 = placed.start;
        if is_dense {
            earliest.insert((span, along_minor), cursor);
        }
        let start = cursor.0.min(last_start);
        set(&mut occupancy, index, start..start + span, placed);
    }
    areas
}

impl Sized {
    fn flex(&self) -> Option<f32> {
        match self.max {
            Sizing::Fr(fr) => Some(fr),
            _ => None,
        }
    }

    fn has_intrinsic_max(&self) -> bool {
        !matches!(self.max, Sizing::Fixed(_) | Sizing::Fr(_))
    }

    fn has_max_content_max(&self) -> bool {
        matches!(
            self.max,
            Sizing::MaxContent | Sizing::Auto | Sizing::FitContent(_)
        )
    }

    fn is_affected(&self, step: Step) -> bool {
        match step {
            Step::IntrinsicMinimums => !matches!(self.min, Sizing::Fixed(_)),
            Step::ContentMinimums => matches!(self.min, Sizing::MinContent | Sizing::MaxContent),
            Step::MaxContentMinimums => self.min == Sizing::MaxContent,
            Step::IntrinsicMaximums => self.has_intrinsic_max(),
            Step::MaxContentMaximums => self.has_max_content_max(),
        }
    }

    fn affected_size(&self, step: Step) -> f32 {
        match step {
            Step::IntrinsicMaximums | Step::MaxContentMaximums if self.limit.is_finite() => {
                self.limit
            }
            _ => self.base,
        }
    }

    /// What all steps come to for the items that span no other track.
    fn make_room(&mut self, [least, min, max]: [f32; 3]) {
        self.base = self.base.max(least);
        self.limit = self.limit.max(self.base);
        for (step, wanted) in [
            (Step::IntrinsicMaximums, min),
            (Step::MaxContentMaximums, max),
        ] {
            if self.is_affected(step) {
                let size = self.affected_size(step);
                self.limit = size + (wanted - size).max(0.0).min(self.potential(step, false));
            }
        }
    }

    fn potential(&self, step: Step, is_limited: bool) -> f32 {
        let fit = match self.max {
            Sizing::FitContent(limit) => limit,
            _ => f32::INFINITY,
        };
        let limit = match step {
            Step::IntrinsicMaximums | Step::MaxContentMaximums
                if is_limited && self.limit.is_finite() && !self.grows_infinitely =>
            {
                0.0
            }
            Step::IntrinsicMaximums | Step::MaxContentMaximums => fit,
            _ if is_limited => self.limit.min(fit.max(self.base)),
            _ => f32::INFINITY,
        };
        (limit - self.affected_size(step)).max(0.0)
    }
}

/// Adds to the second numbers equal shares of `space`, up to the first. Returns what is left.
fn share_equally(shares: &mut [(f32, f32, usize)], mut space: f32) -> f32 {
    shares.order_by(|a, b| a.0.total_cmp(&b.0));
    let count = shares.len();
    for (index, (potential, increase, _)) in shares.iter_mut().enumerate() {
        let share = if index + 1 == count {
            space
        } else {
            unit(space / (count - index) as f32)
        }
        .min(*potential);
        (*increase, space) = (*increase + share, space - share);
    }
    space
}

fn plan_increases(
    tracks: &mut [Sized],
    step: Step,
    contribution: f32,
    gap: f32,
    only_flexible: bool,
) {
    let is_affected = |it: &Sized| it.is_affected(step) && (!only_flexible || it.flex().is_some());
    let used = tracks.iter().map(|it| it.affected_size(step)).sum::<f32>()
        + gap * (tracks.len() - 1) as f32;
    let space = (contribution - used).max(0.0);
    let plan =
        |it: &mut Sized, increase: f32| it.planned = Some(it.planned.unwrap_or(0.0).max(increase));
    if let [only] = tracks {
        let is_maximum = matches!(step, Step::IntrinsicMaximums | Step::MaxContentMaximums);
        let increase = if is_maximum {
            space.min(only.potential(step, false))
        } else {
            space
        };
        return plan(only, increase);
    }
    let factors: f32 = tracks
        .iter()
        .filter(|it| is_affected(it))
        .filter_map(Sized::flex)
        .sum();
    if only_flexible && factors > 0.0 {
        for it in tracks.iter_mut().filter(|it| is_affected(it)) {
            let increase = unit(space * it.flex().unwrap_or(0.0) / factors);
            plan(it, increase);
        }
        return;
    }
    let affected = tracks.iter().enumerate().filter(|it| is_affected(it.1));
    let mut shares: Vec<_> = affected
        .map(|(index, it)| (it.potential(step, true), 0.0, index))
        .collect();
    let left = share_equally(&mut shares, space);
    if left > 0.0 {
        let prefers = |it: &Sized| match step {
            Step::IntrinsicMinimums | Step::ContentMinimums => it.has_intrinsic_max(),
            Step::MaxContentMinimums => it.has_max_content_max(),
            _ => true,
        };
        let has_preferred = shares.iter().any(|it| prefers(&tracks[it.2]));
        shares.order_by_key(|it| has_preferred && !prefers(&tracks[it.2]));
        let count = shares
            .iter()
            .filter(|it| !has_preferred || prefers(&tracks[it.2]))
            .count();
        shares[..count]
            .iter_mut()
            .for_each(|it| it.0 = tracks[it.2].potential(step, false) - it.1);
        share_equally(&mut shares[..count], left);
    }
    shares
        .into_iter()
        .for_each(|(_, increase, index)| plan(&mut tracks[index], increase));
}

fn find_fr(tracks: &[Sized], space: f32, gap: f32) -> f64 {
    let gaps = tracks
        .iter()
        .filter(|it| !it.is_collapsed)
        .count()
        .saturating_sub(1);
    let mut fr = f64::INFINITY;
    loop {
        let is_flexible = |it: &Sized| {
            it.flex()
                .filter(|flex| f64::from(*flex) * fr >= f64::from(it.base) || fr.is_infinite())
        };
        let left = space
            - gap * gaps as f32
            - tracks
                .iter()
                .filter(|it| is_flexible(it).is_none())
                .map(|it| it.base)
                .sum::<f32>();
        let factors = tracks
            .iter()
            .filter_map(is_flexible)
            .map(f64::from)
            .sum::<f64>();
        let next = f64::from(left.max(0.0)) / factors.max(1.0);
        if next.is_infinite()
            || tracks.iter().all(|it| {
                is_flexible(it).is_none_or(|flex| f64::from(flex) * next >= f64::from(it.base))
            })
        {
            return next;
        }
        fr = next;
    }
}

fn total(tracks: &[Sized], gap: f32) -> f32 {
    let count = tracks.iter().filter(|it| !it.is_collapsed).count();
    tracks.iter().map(|it| it.base).sum::<f32>() + gap * count.saturating_sub(1) as f32
}

fn finish_tracks(
    grid: &Grid,
    axis: usize,
    space: Space,
    tracks: &mut [Sized],
    gap: f32,
    max_content_fr: Option<f64>,
) {
    match space {
        Space::MinContent => return,
        Space::MaxContent => tracks.iter_mut().for_each(|it| it.base = it.limit),
        Space::Definite(size) => {
            let free = size - total(tracks, gap);
            if free > 0.0 && tracks.iter().any(|it| it.limit > it.base) {
                let mut shares: Vec<_> = tracks
                    .iter()
                    .enumerate()
                    .map(|(index, it)| (it.limit - it.base, 0.0, index))
                    .collect();
                share_equally(&mut shares, free);
                shares
                    .into_iter()
                    .for_each(|(_, increase, index)| tracks[index].base += increase);
            }
        }
    }
    if grid.axes[axis].has_flex {
        let fr = space.definite().map_or_else(
            || max_content_fr.unwrap_or(0.0),
            |size| find_fr(tracks, size, gap),
        );
        let (mut error, units) = (0.0, f64::from(crate::layout::units_per_pixel()));
        for it in &mut *tracks {
            if let Some(flex) = it.flex() {
                let exact = fr * f64::from(flex) + error;
                let size = (exact * units + 0.001).floor() / units;
                if size as f32 >= it.base {
                    (it.base, error) = (size as f32, exact - size);
                }
            }
        }
    }
    let align = if axis == 0 {
        grid.style.layout.justify_content
    } else {
        grid.style.layout.align_content
    };
    if let (Space::Definite(size), AlignName::Normal | AlignName::Stretch) = (space, align.0)
        && let free = size - total(tracks, gap)
        && free > 0.0
    {
        let automatic = tracks
            .iter()
            .enumerate()
            .filter(|it| it.1.max == Sizing::Auto);
        let mut shares: Vec<_> = automatic.map(|it| (f32::INFINITY, 0.0, it.0)).collect();
        share_equally(&mut shares, free);
        shares
            .into_iter()
            .for_each(|(_, increase, index)| tracks[index].base += increase);
    }
}

impl Document {
    fn is_subgrid(&self, id: BoxId, axis: usize) -> bool {
        let it = &self.boxes[id];
        it.kind == Kind::Grid
            && template(&it.style, axis).is_subgrid()
            && !it
                .style
                .contain()
                .intersects(Contain::LAYOUT | Contain::PAINT)
            && !it.style.queried_axes().contains(&true)
    }

    fn build_grid(
        &self,
        id: BoxId,
        repetitions: [usize; 2],
        inherited: [Option<(usize, &Names)>; 2],
    ) -> Grid {
        let (style, children) = (Rc::clone(&self.boxes[id].style), &self.boxes[id].children);
        let (columns, column_lines, fitted_columns) =
            Axis::explicit(&style, 0, repetitions[0], inherited[0]);
        let (rows, row_lines, fitted_rows) =
            Axis::explicit(&style, 1, repetitions[1], inherited[1]);
        let (mut axes, mut lines) = ([columns, rows], [column_lines, row_lines]);
        let is_shuffled = children.len() > 64
            && children
                .array_windows()
                .step_by(children.len() / 16)
                .filter(|[a, b]| a.abs_diff(*b) > 256)
                .count()
                > 8;
        let (mut items, mut placements) = (
            Vec::with_capacity(children.len()),
            Vec::with_capacity(children.len()),
        );
        let (mut has_subgrids, mut is_horizontal) =
            (false, self.boxes[id].mode == WritingMode::HorizontalTb);
        for (index, child) in children.iter().copied().enumerate() {
            if is_shuffled {
                self.boxes
                    .prefetch_scattered([6, 12].map(|it| children.get(index + it).copied()));
            }
            let it = &self.boxes[child];
            let own = &it.style;
            if own.is_out_of_flow() {
                continue;
            }
            let (crosses, may_be_subgrid) = (self.crosses(id, child), it.kind == Kind::Grid);
            let place = |axis: usize| {
                let ([start, end], lines) = (grid_lines(own, axis), &lines[axis]);
                let auto_span = match template(own, axis ^ crosses) {
                    Template::Subgrid(names)
                        if may_be_subgrid && self.is_subgrid(child, axis ^ crosses) =>
                    {
                        (names.count() as i32 - 1).max(1)
                    }
                    _ if *start == GridLine::Auto && *end == GridLine::Auto => {
                        return Placement::Span(1);
                    }
                    _ => 1,
                };
                let (min, max) = if lines.are_inherited {
                    (0, lines.explicit as i32)
                } else {
                    (-MAX_TRACKS, MAX_TRACKS)
                };
                match lines.place(start, end, auto_span) {
                    Placement::Lines(start, end) => {
                        Placement::Lines(start.min(max - 1).max(min), end.min(max).max(min + 1))
                    }
                    Placement::Span(span) => Placement::Span(span.min(max)),
                }
            };
            placements.push([place(0), place(1)]);
            let align = alignment(own, &style);
            let is_subgrid =
                may_be_subgrid && (self.is_subgrid(child, 0) || self.is_subgrid(child, 1));
            for axis in (0..2).filter(|axis| !is_subgrid || !self.is_subgrid(child, axis ^ crosses))
            {
                axes[axis].has_baselines |=
                    matches!(align[axis].0, AlignName::Baseline | AlignName::LastBaseline);
            }
            (has_subgrids, is_horizontal) = (
                has_subgrids || is_subgrid,
                is_horizontal && it.mode == WritingMode::HorizontalTb,
            );
            items.push(Item {
                id: child,
                align,
                area: [0..0, 0..0],
                subgrid: None,
                crosses,
                placement: Rc::clone(&own.grid),
            });
        }
        let mut areas = place_items(&placements, &mut lines, style.grid.flow);
        for ((axis, fitted), lines) in [fitted_columns, fitted_rows]
            .into_iter()
            .enumerate()
            .zip(lines)
        {
            let it = &mut axes[axis];
            it.lines = Rc::new(lines);
            if it.is_subgrid {
                let count = it.lines.explicit;
                areas.iter_mut().for_each(|area| {
                    area[axis] = area[axis].start.min(count - 1)..area[axis].end.min(count)
                });
                continue;
            }
            let automatic = if axis == 0 {
                &style.grid.auto_columns.0
            } else {
                &style.grid.auto_rows.0
            };
            let before = it.lines.before;
            let count = areas
                .iter()
                .map(|it| it[axis].end)
                .fold(before + it.lines.explicit, usize::max);
            let after = count - before - it.tracks.len();
            it.tracks
                .extend(automatic.iter().cycle().take(after).cloned());
            if before > 0 {
                it.tracks.splice(
                    0..0,
                    automatic
                        .iter()
                        .rev()
                        .cycle()
                        .take(before)
                        .cloned()
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev(),
                );
            }
            if !fitted.is_empty() {
                it.collapsed = (0..count)
                    .map(|it| it >= before && fitted.contains(&(it - before)))
                    .collect();
                areas
                    .iter()
                    .for_each(|area| it.collapsed[area[axis].clone()].fill(false));
            }
            it.has_percentages = it.tracks.iter().any(has_percentage);
            it.has_flex = (0..count).any(|index| {
                matches!(
                    it.tracks[index],
                    Track::Breadth(Breadth::Fr(_)) | Track::MinMax(_, Breadth::Fr(_))
                ) && it.collapsed.get(index) != Some(&true)
            });
        }
        let mut are_simple = [true; 2];
        for (item, area) in items.iter_mut().zip(areas) {
            item.area = area;
            if has_subgrids && (self.is_subgrid(item.id, 0) || self.is_subgrid(item.id, 1)) {
                let subgrid =
                    self.build_subgrid(&style, &axes, item, [Err([0.0, f32::INFINITY]); 2]);
                is_horizontal &= subgrid.is_horizontal;
                item.subgrid = Some(Box::new(subgrid));
            }
            for axis in 0..2 {
                let inherited = item
                    .inheriting(axis)
                    .map(|it| &it.axes[axis ^ item.crosses]);
                are_simple[axis] &=
                    inherited.map_or_else(|| item.area[axis].len() == 1, |it| it.has_simple_items);
                axes[axis].has_baselines |= inherited.is_some_and(|it| it.has_baselines);
            }
        }
        axes.iter_mut()
            .zip(are_simple)
            .for_each(|(it, is_simple)| it.has_simple_items = is_simple && !it.has_baselines);
        Grid {
            items,
            style,
            axes,
            has_subgrids,
            is_horizontal,
            is_shuffled,
        }
    }

    fn build_subgrid(
        &self,
        parent: &Style,
        axes: &[Axis; 2],
        item: &Item,
        size: [Result<f32, [f32; 2]>; 2],
    ) -> Grid {
        crate::recovery::need_stack();
        let names =
            [0, 1].map(|own| self.names_for_subgrid(parent, axes, item, own ^ item.crosses));
        let inherited = [0, 1].map(|own| {
            self.is_subgrid(item.id, own)
                .then(|| (item.area[own ^ item.crosses].len(), &names[own]))
        });
        self.build_grid(
            item.id,
            repetitions(&self.boxes[item.id].style, |axis| size[axis]),
            inherited,
        )
    }

    fn crosses(&self, parent: BoxId, child: BoxId) -> usize {
        usize::from(self.boxes[parent].mode.is_vertical() != self.boxes[child].mode.is_vertical())
    }

    fn is_opposite(&self, parent: &Style, item: &Item, axis: usize) -> bool {
        parent.runs_back(axis) != self.boxes[item.id].style.runs_back(axis ^ item.crosses)
    }

    /// Turns the items of the subgrids for their modes, or back. Returns those whose items were not yet turned.
    fn turn_subgrids(&mut self, grid: &Grid, turns: bool, out: &mut Vec<BoxId>) {
        if grid.is_horizontal || !grid.has_subgrids {
            return;
        }
        for (id, subgrid) in grid
            .items
            .iter()
            .filter_map(|it| Some((it.id, it.subgrid.as_deref()?)))
        {
            let mode = self.boxes[id].mode;
            if mode.is_vertical() && self.boxes[id].has_turned_children != turns {
                self.turn_children(
                    id,
                    if turns {
                        mode
                    } else {
                        WritingMode::HorizontalTb
                    },
                );
                out.push(id);
            }
            self.turn_subgrids(subgrid, turns, out);
        }
    }

    fn names_for_subgrid(
        &self,
        parent: &Style,
        axes: &[Axis; 2],
        item: &Item,
        axis: usize,
    ) -> Names {
        let (lines, span) = (&axes[axis].lines, &item.area[axis]);
        if lines.names.is_empty() {
            return Names::new();
        }
        let of = |line: usize| {
            line.checked_sub(lines.before)
                .and_then(|it| lines.names.get(it))
                .cloned()
                .unwrap_or_default()
        };
        let mut names: Names = (span.start..=span.end).map(of).collect();
        for (area, range) in parent.grid.areas.named() {
            let (start, end) = (
                range[axis].start + lines.before,
                range[axis].end + lines.before,
            );
            if start < span.start && end > span.start {
                names[0].push(format!("{area}-start").into());
            }
            if end > span.end && start < span.end {
                names[span.len()].push(format!("{area}-end").into());
            }
        }
        if self.is_opposite(parent, item, axis) {
            names.reverse();
        }
        names
    }

    /// Margin, border, padding and scrollbar at its start and at its end.
    fn subgrid_edges(&self, parent: &Style, item: &Item, axis: usize, basis: f32) -> [f32; 2] {
        let it = &self.boxes[item.id];
        let [near, far] = (margin(&it.style, basis) + it.inset(basis)).along(axis);
        if (axis == 0 && parent.is_rtl()) != self.is_opposite(parent, item, axis) {
            [far, near]
        } else {
            [near, far]
        }
    }

    fn subgrid_gap(style: &Style, axis: usize, outer: f32, basis: Option<f32>) -> f32 {
        let own = if axis == 0 {
            &style.layout.column_gap
        } else {
            &style.layout.row_gap
        };
        if own.0.is_some() {
            gap(own, basis)
        } else {
            outer
        }
    }

    /// `to_root` maps a span of tracks to those that are being sized, and gives what is added around it.
    fn contributors(
        &self,
        grid: &Grid,
        axis: usize,
        (gap, goes_back): (f32, bool),
        to_root: &dyn Fn(&Range<usize>) -> (Range<usize>, [f32; 2]),
        out: &mut Vec<Contributor>,
    ) {
        out.reserve(grid.items.len());
        for item in &grid.items {
            let [own, other] = [axis, 1 - axis].map(|it| grid.axes[it].extent(&item.area[it]));
            let new = |id, (span, extra), align, sizes| Contributor {
                id,
                axis,
                is_opposite: goes_back,
                span,
                extra,
                own,
                other,
                align,
                sizes,
                shim: 0.0,
            };
            let Some(subgrid) = item.inheriting(axis) else {
                out.push(new(item.id, to_root(&item.area[axis]), item.align, None));
                continue;
            };
            let (area, edges) = (
                &item.area[axis],
                self.subgrid_edges(
                    &grid.style,
                    item,
                    axis,
                    other.filter(|_| axis == 1).unwrap_or(0.0),
                ),
            );
            let own_gap = Self::subgrid_gap(&subgrid.style, axis ^ item.crosses, gap, None);
            let (half, is_opposite) = (
                (own_gap - gap) / 2.0,
                self.is_opposite(&grid.style, item, axis),
            );
            let to_root = |span: &Range<usize>| {
                let mut own = [
                    if span.start == 0 { edges[0] } else { half },
                    if span.end == area.len() {
                        edges[1]
                    } else {
                        half
                    },
                ];
                let mut outer = area.start + span.start..area.start + span.end;
                if is_opposite {
                    (outer, own) = (area.end - span.end..area.end - span.start, [own[1], own[0]]);
                }
                let (span, extra) = to_root(&outer);
                if goes_back {
                    own.reverse();
                }
                (span, [extra[0] + own[0], extra[1] + own[1]])
            };
            for edge in [0..1, area.len() - 1..area.len()] {
                out.push(new(0, to_root(&edge), [Align::NORMAL; 2], Some([0.0; 2])));
            }
            self.contributors(
                subgrid,
                axis ^ item.crosses,
                (own_gap, goes_back != is_opposite),
                &to_root,
                out,
            );
        }
    }

    /// The width, and the rest of what an item needs for its layout.
    fn fit_in_area(
        &mut self,
        id: BoxId,
        align: [Align; 2],
        area: [Option<f32>; 2],
    ) -> (Edges, Room, f32) {
        let it = &self.boxes[id];
        if let Some(fixed) = it.fixed_sizes().filter(|fixed| {
            it.kind != Kind::Grid && !fixed.traits.contains(Traits::HAS_AUTO_MARGIN)
        }) && let ([true, fills], Some(width)) = (
            align.map(|it| matches!(it.0, AlignName::Normal | AlignName::Stretch)),
            area[0],
        ) {
            let (margins, edges) = (fixed.margin.sums(), (fixed.border + fixed.padding).sums());
            let available = [
                Some((width - margins[0]).max(0.0)),
                area[1].map(|it| (it - margins[1]).max(0.0)),
            ];
            let height = available[1]
                .filter(|_| fills && fixed.height.is_none())
                .map(|it| clamp(it.max(edges[1]), fixed.limits[1]));
            let width = fixed
                .width
                .unwrap_or_else(|| (width - margins[0]).max(edges[0]));
            return (
                fixed.margin,
                Room {
                    available,
                    basis: area,
                    height,
                },
                clamp(width, fixed.limits[0]),
            );
        }
        let is_subgrid =
            [0, 1].map(|axis| self.is_subgrid(id, axis ^ usize::from(it.is_orthogonal())));
        let margin = margin(&it.style, area[0].unwrap_or(0.0));
        let available = [0, 1].map(|axis| area[axis].map(|it| (it - margin.sums()[axis]).max(0.0)));
        let mut room = Room {
            available,
            basis: area,
            height: None,
        };
        let [auto_width, auto_height] = [0, 1].map(|axis| match align[axis].0 {
            _ if auto_margins(&it.style, axis) != [false; 2] => AutoSize::Fit,
            AlignName::Stretch => AutoSize::Stretch,
            AlignName::Normal if it.kind == Kind::Table => AutoSize::Stretch,
            AlignName::Normal if !it.is_replaced() => AutoSize::Fill,
            _ => AutoSize::Fit,
        });
        let stretches = it.has_auto_size(1)
            && (auto_height == AutoSize::Stretch
                || auto_height == AutoSize::Fill && it.ratio.is_none());
        if is_subgrid[1] {
            room.height = available[1];
        } else if stretches {
            room.height = it.styled_height(
                &room,
                it.border_and_padding(area[0].unwrap_or(0.0)).sums(),
                available[1],
                None,
            );
        }
        let width = match available[0].filter(|_| is_subgrid[0]) {
            Some(width) => width,
            None => self.resolve_width(id, &room, auto_width),
        };
        if let Some(height) = room.height.filter(|_| !is_subgrid[1]) {
            room.height = Some(self.clamp_height(id, height, width, &room));
        }
        (margin, room, width)
    }

    fn measure_contributor(&mut self, it: &Contributor) -> (Edges, Output) {
        let (margin, room, width) = self.fit_in_area(it.id, it.align, [it.other, None]);
        (
            margin,
            self.measure(it.id, self.input_for(it.id, width, &room)),
        )
    }

    /// The min-content and max-content contributions.
    fn contributions(&mut self, it: &mut Contributor, uses_height: &mut bool) -> [f32; 2] {
        let sizes = it.sizes.unwrap_or_else(|| match it.axis {
            0 => {
                let own = &self.boxes[it.id];
                let stretches = own.has_auto_size(1)
                    && auto_margins(&own.style, 1) == [false; 2]
                    && (it.align[1].0 == AlignName::Stretch
                        || it.align[1].0 == AlignName::Normal && own.ratio.is_none());
                let stretched = it.other.filter(|_| stretches).and_then(|height| {
                    let room = Room {
                        basis: [None, Some(height)],
                        ..Room::default()
                    };
                    own.styled_height(
                        &room,
                        own.border_and_padding(0.0).sums(),
                        Some(height - margin(&own.style, 0.0).sums()[1]),
                        None,
                    )
                });
                let reads_height = stretches || own.uses_parent[1];
                let stretched = match it.other.is_none() && own.is_orthogonal() {
                    true => Some(self.orthogonal_heights(it.id, None, None)[1]),
                    false => stretched,
                };
                let widths = self.contribution(it.id, it.other, stretched);
                *uses_height |= widths.uses_height && reads_height;
                widths.sizes
            }
            _ if self.boxes[it.id].is_orthogonal() => {
                let margins = margin(&self.boxes[it.id].style, it.other.unwrap_or(0.0)).sums()[1];
                self.orthogonal_heights(it.id, it.other, None)
                    .map(|it| it + margins)
            }
            _ => {
                let (margin, output) = self.measure_contributor(it);
                [output.height + margin.sums()[1]; 2]
            }
        });
        it.sizes = Some(sizes);
        sizes.map(|size| size + it.extra[0] + it.extra[1] + it.shim)
    }

    fn minimum_contribution(
        &mut self,
        it: &mut Contributor,
        spanned: &[Sized],
        gap: f32,
        uses_height: &mut bool,
    ) -> f32 {
        let (own, axis) = (&self.boxes[it.id], it.axis);
        let all = sizes(&own.style);
        if it.id == 0 || !own.has_auto_size(axis) && !is_relative(all[axis]) {
            return self.contributions(it, uses_height)[0];
        }
        let basis = it.other.filter(|_| axis == 1).unwrap_or(0.0);
        let edges = own.border_and_padding(basis).sums();
        let around = margin(&own.style, basis).sums()[axis] + it.extra[0] + it.extra[1] + it.shim;
        if *all[2 + axis] != Size::Auto {
            let room = Room::default();
            return around
                + match (axis, all[3]) {
                    (0, _) => self.width_limits(it.id, &room, edges)[0],
                    (_, Size::Length(_) | Size::Stretch) => {
                        own.height_limits(&room, edges, None)[0]
                    }
                    _ => self.measure_contributor(it).1.intrinsic,
                };
        }
        if own.overflow[axis].scrolls()
            || !spanned.iter().any(|it| it.min == Sizing::Auto)
            || spanned.len() > 1 && spanned.iter().any(|it| it.flex().is_some())
        {
            return around + edges[axis];
        }
        let fixed = |it: &Sized| match it.max {
            Sizing::Fixed(size) => Some(size),
            _ => None,
        };
        let limit = spanned
            .iter()
            .map(fixed)
            .sum::<Option<f32>>()
            .map(|it| it + gap * (spanned.len() - 1) as f32);
        let content = self.contributions(it, uses_height)[0];
        limit.map_or(content, |limit| {
            content.min(limit.max(around + edges[axis]))
        })
    }

    /// The side of its area from which it is measured, and the distance, unless it takes no part in the alignment.
    fn item_baseline(
        &self,
        id: BoxId,
        axis: usize,
        align: Align,
        own: &Output,
        size: f32,
        margin: Edges,
        is_intrinsic: bool,
    ) -> (usize, Option<f32>) {
        let (it, is_last) = (&self.boxes[id], align.0 == AlignName::LastBaseline);
        let container = &self.boxes[it.parent].style;
        let (is_far, ascent, is_made_up) =
            it.aligned_baseline(container, axis, [is_last, false], own, size, margin);
        let is_cyclic = is_made_up
            && is_intrinsic
            && sizes(&it.style)
                .iter()
                .skip(axis)
                .step_by(2)
                .any(|it| is_relative(it));
        (
            usize::from(is_far != (axis == 0 && container.is_rtl())),
            (!is_cyclic).then_some(ascent),
        )
    }

    /// Makes room before or after the items whose baselines are aligned. Returns those of the tracks.
    fn add_baseline_shims(
        &mut self,
        contributors: &mut [Contributor],
        tracks: &Axis,
        is_final: bool,
    ) -> Vec<[f32; 2]> {
        let (mut baselines, mut own) = (vec![[f32::MIN; 2]; tracks.tracks.len()], Vec::new());
        for (index, it) in contributors.iter().enumerate() {
            if let AlignName::Baseline | AlignName::LastBaseline = it.align[it.axis].0
                && auto_margins(&self.boxes[it.id].style, it.axis) == [false; 2]
            {
                let mut area = [it.other; 2];
                area[it.axis] = it.own.filter(|_| is_final);
                let (margin, mut room, mut width) = self.fit_in_area(it.id, it.align, area);
                if area[1].is_none() && self.boxes[it.id].is_orthogonal() {
                    room.height = Some(self.orthogonal_heights(it.id, area[0], None)[1]);
                    width = area[0].map_or_else(
                        || self.resolve_width(it.id, &room, AutoSize::Fit),
                        |_| width,
                    );
                }
                let output = self.measure(it.id, self.input_for(it.id, width, &room));
                let size = [width, output.height][it.axis];
                if let (side, Some(ascent)) = self.item_baseline(
                    it.id,
                    it.axis,
                    it.align[it.axis],
                    &output,
                    size,
                    margin,
                    tracks.has_intrinsic(&it.span),
                ) {
                    let side = side ^ usize::from(it.is_opposite);
                    let (track, ascent) = (
                        [it.span.start, it.span.end - 1][side],
                        ascent + it.extra[side],
                    );
                    baselines[track][side] = baselines[track][side].max(ascent);
                    own.push((index, track, side, ascent));
                }
            }
        }
        own.into_iter().for_each(|(index, track, side, ascent)| {
            contributors[index].shim = baselines[track][side] - ascent
        });
        baselines
    }

    /// Only what makes a difference to the track.
    #[inline]
    fn wanted(
        &mut self,
        it: &mut Contributor,
        track: &Sized,
        gap: f32,
        for_fr: bool,
        uses_height: &mut bool,
    ) -> [f32; 3] {
        let least = match track.min {
            Sizing::Fixed(_) => 0.0,
            min => {
                let least =
                    self.minimum_contribution(it, core::slice::from_ref(track), gap, uses_height);
                match min {
                    Sizing::MinContent => least.max(self.contributions(it, uses_height)[0]),
                    Sizing::MaxContent => self
                        .contributions(it, uses_height)
                        .into_iter()
                        .fold(least, f32::max),
                    _ => least,
                }
            }
        };
        let [min, max] = if track.has_intrinsic_max() || for_fr && track.flex().is_some() {
            self.contributions(it, uses_height)
        } else {
            [0.0; 2]
        };
        [least, min, max]
    }

    /// For simple items. `track` is what one has been defined as.
    fn visit_wanted(
        &mut self,
        grid: &Grid,
        axis: usize,
        (gap, for_fr): (f32, bool),
        track: &dyn Fn(usize) -> Sized,
        visit: &mut dyn FnMut(Wanted),
    ) -> bool {
        let mut uses_height = false;
        let mut ask = |document: &mut Document, it: &mut Contributor| {
            let track = track(it.span.start);
            if !matches!((track.min, track.max), (Sizing::Fixed(_), Sizing::Fixed(_))) {
                visit((
                    it.span.start,
                    document.wanted(it, &track, gap, for_fr, &mut uses_height),
                ));
            }
        };
        if grid.has_subgrids {
            let mut contributors = Vec::new();
            self.contributors(
                grid,
                axis,
                (gap, false),
                &|span| (span.clone(), [0.0; 2]),
                &mut contributors,
            );
            contributors.iter_mut().for_each(|it| ask(self, it));
            return uses_height;
        }
        for (index, item) in grid.items.iter().enumerate() {
            if grid.is_shuffled {
                self.boxes
                    .prefetch_scattered([6, 12].map(|it| Some(grid.items.get(index + it)?.id)));
            }
            let other = grid.axes[1 - axis].extent(&item.area[1 - axis]);
            ask(
                self,
                &mut Contributor {
                    id: item.id,
                    axis,
                    is_opposite: false,
                    span: item.area[axis].clone(),
                    extra: [0.0; 2],
                    own: None,
                    other,
                    align: item.align,
                    sizes: None,
                    shim: 0.0,
                },
            );
        }
        uses_height
    }

    /// Returns the tracks, the gap, and whether the items depend on the heights of their areas.
    fn size_tracks(&mut self, grid: &Grid, axis: usize, space: Space) -> (Vec<Sized>, f32, bool) {
        let Settled {
            mut tracks,
            gap,
            uses_height,
            max_content_fr,
            ..
        } = self.settle_tracks(grid, axis, space);
        finish_tracks(grid, axis, space, &mut tracks, gap, max_content_fr);
        (tracks, gap, uses_height)
    }

    /// `size_tracks` that starts from what is `known`, and leaves something there.
    fn size_columns_again(
        &mut self,
        grid: &Grid,
        space: Space,
        known: &mut Option<Settled>,
    ) -> (Vec<Sized>, f32, bool) {
        let definite = space.definite();
        let holds = |it: &mut Settled| {
            (it.definite == definite
                || !grid.has_relative_tracks(0)
                    && (it.definite.is_some() == definite.is_some() || !grid.is_contained(0)))
                && (space != Space::MaxContent
                    || !grid.axes[0].has_flex
                    || it.max_content_fr.is_some())
        };
        let settled = known
            .take_if(holds)
            .unwrap_or_else(|| self.settle_tracks(grid, 0, space));
        let (mut tracks, gap, uses_height) =
            (settled.tracks.clone(), settled.gap, settled.uses_height);
        finish_tracks(grid, 0, space, &mut tracks, gap, settled.max_content_fr);
        *known = (!uses_height && !grid.axes[0].has_baselines).then_some(settled);
        (tracks, gap, uses_height)
    }

    fn settle_tracks(&mut self, grid: &Grid, axis: usize, space: Space) -> Settled {
        let definite = space.definite();
        let (own, gap, mut uses_height) =
            (&grid.axes[axis], gap_of(&grid.style, axis, definite), false);
        let mut tracks: Vec<Sized> = (0..own.tracks.len())
            .map(|it| own.unsized_track(it, definite))
            .collect();
        let steps = [
            Step::IntrinsicMinimums,
            Step::ContentMinimums,
            Step::MaxContentMinimums,
            Step::IntrinsicMaximums,
            Step::MaxContentMaximums,
        ];
        let matters = steps.map(|step| tracks.iter().any(|it| it.is_affected(step)));
        let asks_items = definite.map_or_else(
            || !grid.is_contained(axis),
            |_| matters != [false; 5] || own.has_baselines,
        );
        let (needs_fr, mut flexible, mut contributors) =
            (definite.is_none() && own.has_flex, Vec::new(), Vec::new());
        if asks_items && own.has_simple_items {
            let mut most = vec![[f32::NEG_INFINITY; 3]; tracks.len()];
            uses_height = self.visit_wanted(
                grid,
                axis,
                (gap, needs_fr),
                &|it| tracks[it].clone(),
                &mut |(track, wanted)| {
                    most[track] = [
                        most[track][0].max(wanted[0]),
                        most[track][1].max(wanted[1]),
                        most[track][2].max(wanted[2]),
                    ];
                    if needs_fr && tracks[track].flex().is_some() {
                        flexible.push((track..track + 1, wanted[2]));
                    }
                },
            );
            tracks
                .iter_mut()
                .zip(most)
                .filter(|it| it.1[0] != f32::NEG_INFINITY)
                .for_each(|(it, most)| it.make_room(most));
        } else if asks_items {
            self.contributors(
                grid,
                axis,
                (gap, false),
                &|span| (span.clone(), [0.0; 2]),
                &mut contributors,
            );
        }
        if own.has_baselines {
            self.add_baseline_shims(&mut contributors, own, false);
        }
        let is_flexible = |it: &Contributor, tracks: &[Sized]| {
            tracks[it.span.clone()].iter().any(|it| it.flex().is_some())
        };
        contributors.retain(|it| {
            tracks[it.span.clone()]
                .iter()
                .any(|it| !matches!((it.min, it.max), (Sizing::Fixed(_), Sizing::Fixed(_))))
        });
        let group = |it: &Contributor, tracks: &[Sized]| {
            if is_flexible(it, tracks) {
                usize::MAX
            } else {
                it.span.len()
            }
        };
        if !contributors.is_sorted_by_key(|it| group(it, &tracks)) {
            contributors.order_by_key(|it| group(it, &tracks));
        }
        let mut rest = &mut contributors[..];
        while let Some(first) = rest.first() {
            let key = group(first, &tracks);
            let (members, others) = rest.split_at_mut(
                rest.iter()
                    .take_while(|it| group(it, &tracks) == key)
                    .count(),
            );
            rest = others;
            let only_flexible = key == usize::MAX;
            for (step, matters) in steps[..if only_flexible { 3 } else { 5 }]
                .iter()
                .zip(matters)
            {
                for it in members.iter_mut().filter(|_| matters) {
                    let spanned = &mut tracks[it.span.clone()];
                    if !spanned
                        .iter()
                        .any(|it| it.is_affected(*step) && (!only_flexible || it.flex().is_some()))
                    {
                        continue;
                    }
                    let contribution = match step {
                        Step::IntrinsicMinimums => {
                            self.minimum_contribution(it, spanned, gap, &mut uses_height)
                        }
                        Step::ContentMinimums | Step::IntrinsicMaximums => {
                            self.contributions(it, &mut uses_height)[0]
                        }
                        _ => self.contributions(it, &mut uses_height)[1],
                    };
                    plan_increases(spanned, *step, contribution, gap, only_flexible);
                }
                for it in &mut tracks {
                    let planned = it.planned.take();
                    match (step, planned) {
                        (Step::IntrinsicMaximums | Step::MaxContentMaximums, Some(increase)) => {
                            it.grows_infinitely = it.limit.is_infinite();
                            it.limit = it.affected_size(*step) + increase;
                        }
                        (_, Some(increase)) => {
                            it.base += increase;
                            it.limit = it.limit.max(it.base);
                        }
                        _ => {}
                    }
                    it.grows_infinitely &= *step != Step::MaxContentMaximums;
                }
            }
        }
        tracks
            .iter_mut()
            .filter(|it| it.limit.is_infinite())
            .for_each(|it| it.limit = it.base);
        let max_content_fr = needs_fr.then(|| {
            for it in contributors
                .iter_mut()
                .filter(|it| is_flexible(it, &tracks))
            {
                flexible.push((it.span.clone(), self.contributions(it, &mut uses_height)[1]));
            }
            let maximized: Vec<_> = tracks
                .iter()
                .map(|it| Sized {
                    base: it.limit,
                    ..it.clone()
                })
                .collect();
            let own = maximized
                .iter()
                .filter_map(|it| Some(f64::from(it.base) / f64::from(it.flex()?.max(1.0))));
            flexible
                .into_iter()
                .fold(own.fold(0.0, f64::max), |fr, (span, contribution)| {
                    fr.max(find_fr(&maximized[span], contribution, gap))
                })
        });
        Settled {
            definite,
            tracks,
            gap,
            uses_height,
            max_content_fr,
        }
    }

    fn position_tracks(grid: &mut Grid, axis: usize, tracks: &[Sized], gap: f32, size: f32) {
        let (free, rtl) = (size - total(tracks, gap), grid.style.is_rtl());
        let align = if axis == 0 {
            grid.style.layout.justify_content
        } else {
            grid.style.layout.align_content
        };
        let count = tracks.iter().filter(|it| !it.is_collapsed).count();
        let (at, between) = distribute(align.resolved(axis, rtl, rtl, free), free, count);
        let [mut at, between] = [at, between].map(unit);
        let mut is_first = true;
        let positions = tracks.iter().map(|it| {
            if !it.is_collapsed && !core::mem::take(&mut is_first) {
                at += gap + between;
            }
            at += it.base;
            [at - it.base, at]
        });
        (grid.axes[axis].positions, grid.axes[axis].gap) = (positions.collect(), gap);
    }

    /// Passes the positions on to the subgrids. Those that have columns of their own size them.
    fn position_subgrids(&mut self, grid: &mut Grid, axis: usize) {
        if !grid.has_subgrids {
            return;
        }
        let mut items = core::mem::take(&mut grid.items);
        for item in items.iter_mut().filter(|it| it.subgrid.is_some()) {
            let (area, own) = (
                [0, 1].map(|it| grid.axes[it].extent(&item.area[it])),
                axis ^ item.crosses,
            );
            if item.inheriting(axis).is_some() {
                let (tracks, span) = (&grid.axes[axis], item.area[axis].clone());
                let Some(outer) = tracks
                    .positions
                    .get(span.clone())
                    .filter(|it| !it.is_empty())
                else {
                    continue;
                };
                let (first, last, count) = (outer[0][0], outer[outer.len() - 1][1], outer.len());
                let (edges, is_opposite) = (
                    self.subgrid_edges(&grid.style, item, axis, area[0].unwrap_or(0.0)),
                    self.is_opposite(&grid.style, item, axis),
                );
                let inner = (last - first - edges[0] - edges[1]).max(0.0);
                let gap =
                    Self::subgrid_gap(&self.boxes[item.id].style, own, tracks.gap, Some(inner));
                let half = (gap - tracks.gap) / 2.0;
                let inside = |index: usize| {
                    [
                        if index == 0 { edges[0] } else { half },
                        if index + 1 == count { edges[1] } else { half },
                    ]
                };
                let positions = (0..count).map(|index| {
                    let [start, end] = match is_opposite {
                        true => [
                            last - outer[count - 1 - index][1],
                            last - outer[count - 1 - index][0],
                        ],
                        false => [outer[index][0] - first, outer[index][1] - first],
                    };
                    let start = if index == 0 {
                        0.0
                    } else {
                        start - edges[0] + half
                    };
                    let end = if index + 1 == count {
                        inner
                    } else {
                        end - edges[0] - half
                    };
                    [start, end.max(start)]
                });
                let baselines = tracks.baselines.get(span).map_or(Vec::new(), |outer| {
                    let of = |index: usize, side: usize| {
                        if is_opposite {
                            outer[count - 1 - index][1 - side]
                        } else {
                            outer[index][side]
                        }
                    };
                    (0..count)
                        .map(|index| [0, 1].map(|side| of(index, side) - inside(index)[side]))
                        .collect()
                });
                let Some(subgrid) = &mut item.subgrid else {
                    continue;
                };
                let inherited = &mut subgrid.axes[own];
                let from = [edges[0], edges[1], gap, tracks.gap];
                let known = inherited.derived.take().filter(|it| {
                    core::ptr::eq(&raw const *it.0, &raw const *tracks.positions) && it.1 == from
                });
                (inherited.positions, inherited.baselines, inherited.gap) = (
                    known.map_or_else(|| positions.collect(), |it| it.2),
                    baselines,
                    gap,
                );
                inherited.derived =
                    Some((tracks.positions.clone(), from, inherited.positions.clone()));
            } else if own == 0 {
                let (_, room, width) = self.fit_in_area(
                    item.id,
                    item.align,
                    if axis == 0 { [area[0], None] } else { area },
                );
                let outer = if axis == 0 {
                    width
                } else {
                    self.measure(item.id, self.input_for(item.id, width, &room))
                        .height
                };
                let inner = (outer
                    - self.boxes[item.id].inset(area[0].unwrap_or(0.0)).sums()[axis])
                    .max(0.0);
                let mut subgrid = self.build_subgrid(
                    &grid.style,
                    &grid.axes,
                    item,
                    [Ok(inner), Err([0.0, f32::INFINITY])],
                );
                let (tracks, gap, _) = self.size_tracks(&subgrid, 0, Space::Definite(inner));
                Self::position_tracks(&mut subgrid, 0, &tracks, gap, inner);
                if let Some(old) = item.subgrid.as_mut().filter(|_| axis == 1) {
                    core::mem::swap(&mut old.axes[1], &mut subgrid.axes[1]);
                    self.position_subgrids(&mut subgrid, 1);
                }
                item.subgrid = Some(Box::new(subgrid));
            } else {
                continue;
            }
            item.subgrid
                .iter_mut()
                .for_each(|it| self.position_subgrids(it, own));
        }
        grid.items = items;
    }

    fn inherit(&mut self, grid: &Grid, item: &Item) {
        if self.boxes[item.id].kind != Kind::Grid {
            return;
        }
        let inherited = item.subgrid.as_deref().map(|subgrid| Inherited {
            tracks: subgrid.axes.each_ref().map(|it| {
                it.is_subgrid.then(|| {
                    if it.positions.is_empty() {
                        core::iter::repeat_n([0.0, f32::INFINITY], it.lines.explicit).collect()
                    } else {
                        it.positions.clone()
                    }
                })
            }),
            names: [0, 1].map(|own| {
                self.names_for_subgrid(&grid.style, &grid.axes, item, own ^ item.crosses)
            }),
            gaps: subgrid.axes.each_ref().map(|it| it.gap),
            baselines: subgrid.axes.each_ref().map(|it| it.baselines.clone()),
        });
        let it = &mut self.boxes[item.id];
        if it.inherited.as_deref() != inherited.as_ref() {
            let counts = |it: &Inherited| it.tracks.each_ref().map(|it| Some(it.as_ref()?.len()));
            let has_same_lines = it
                .inherited
                .as_deref()
                .zip(inherited.as_ref())
                .is_some_and(|(old, new)| counts(old) == counts(new) && old.names == new.names);
            let has_same_rest = it
                .inherited
                .as_deref()
                .zip(inherited.as_ref())
                .is_some_and(|(old, new)| old.gaps == new.gaps && old.baselines == new.baselines);
            it.inherited = inherited.map(Box::new);
            it.grid
                .iter_mut()
                .filter(|_| !has_same_lines)
                .for_each(|it| it.forget_placement());
            if has_same_rest {
                it.cache.clear_outside()
            } else {
                it.cache.clear()
            }
        }
    }

    /// For the items that are measured as a whole, though they have inherited the tracks of the other axis.
    fn inherit_below(&mut self, grid: &Grid, axis: usize) {
        if !grid.has_subgrids {
            return;
        }
        for item in grid.items.iter().filter(|it| it.subgrid.is_some()) {
            match item.inheriting(axis) {
                Some(subgrid) => self.inherit_below(subgrid, axis ^ item.crosses),
                None => self.inherit(grid, item),
            }
        }
    }

    fn is_placed_alike(&self, grid: &Grid, item: &Item) -> bool {
        let style = &self.boxes[item.id].style;
        (Rc::ptr_eq(&style.grid, &item.placement) || style.grid == item.placement)
            && alignment(style, &grid.style) == item.align
            && item.subgrid.is_none()
            && !(self.is_subgrid(item.id, 0) || self.is_subgrid(item.id, 1))
            && self.boxes[item.id].mode == WritingMode::HorizontalTb
    }

    /// It goes back with `keep_grid`.
    fn own_grid(&mut self, id: BoxId, size: [Option<f32>; 2], room: &Room) -> Box<Kept> {
        let it = &mut self.boxes[id];
        let (kept, knows_contents) = (
            it.grid_if_any().and_then(|it| it.kept.take()),
            core::mem::replace(&mut it.cache.knows_contents, true),
        );
        let it = &self.boxes[id];
        let repetitions = repetitions(&it.style, |axis| {
            size[axis].ok_or_else(|| {
                let (edges, inset) = (
                    it.border_and_padding(room.basis[0].unwrap_or(0.0)).sums(),
                    it.inset(room.basis[0].unwrap_or(0.0)).sums(),
                );
                let limit = |index: usize| {
                    it.resolve_size(sizes(&it.style)[index], index, room, edges, &mut |_| None)
                        .map(|it| it - inset[index % 2])
                };
                let transferred = |index: usize| {
                    it.transfer(axis, limit(index + 1 - axis)? + inset[1 - axis], edges)
                        .map(|it| it - inset[axis])
                };
                let min = limit(2 + axis).or_else(|| transferred(2)).unwrap_or(0.0);
                [
                    min,
                    limit(4 + axis)
                        .or_else(|| transferred(4))
                        .map_or(f32::INFINITY, |it| it.max(min)),
                ]
            })
        });
        let inherited = it.inherited.as_deref().filter(|_| {
            self.boxes[it.parent].kind == Kind::Grid
                && !it.style.is_out_of_flow()
                && (self.is_subgrid(id, 0) || self.is_subgrid(id, 1))
        });
        let holds = |kept: &Kept| {
            let (grid, few) = (&kept.grid, &kept.restyled);
            (kept.repetitions, kept.children) == (repetitions, it.children.len())
                && [it.mode, it.turned] == [WritingMode::HorizontalTb; 2]
                && grid.holds_for(&it.style)
                && [0, 1].iter().all(|axis| {
                    grid.axes[*axis].is_subgrid
                        == (template(&it.style, *axis).is_subgrid()
                            && inherited.is_some_and(|it| it.tracks[*axis].is_some()))
                })
                && (few.is_empty()
                    || grid
                        .items
                        .iter()
                        .filter(|it| few.spilled() || few.contains(&it.id))
                        .all(|it| self.is_placed_alike(grid, it)))
        };
        let mut kept = match kept.filter(|it| holds(it)) {
            Some(mut kept) => {
                kept.grid.unsize();
                (kept.grid.style, kept.restyled) = (Rc::clone(&it.style), SmallVec::new());
                if !knows_contents {
                    (kept.columns, kept.rows, kept.placed) = (None, None, None);
                }
                kept
            }
            None => {
                let grid = self.build_grid(
                    id,
                    repetitions,
                    [0, 1].map(|axis| {
                        Some((
                            inherited?.tracks[axis].as_ref()?.len(),
                            &inherited?.names[axis],
                        ))
                    }),
                );
                Box::new(Kept {
                    grid,
                    repetitions,
                    children: it.children.len(),
                    restyled: SmallVec::new(),
                    columns: None,
                    rows: None,
                    placed: None,
                })
            }
        };
        for (axis, own) in kept
            .grid
            .axes
            .iter_mut()
            .enumerate()
            .filter(|it| it.1.is_subgrid)
        {
            if let Some((inherited, tracks)) =
                inherited.and_then(|it| Some((it, it.tracks[axis].as_ref()?)))
            {
                if tracks.first().is_some_and(|it| it[1].is_finite()) {
                    own.positions = tracks.clone();
                }
                (own.gap, own.baselines) =
                    (inherited.gaps[axis], inherited.baselines[axis].clone());
            }
        }
        kept
    }

    fn keep_grid(&mut self, id: BoxId, kept: Box<Kept>) -> &mut GridInfo {
        let it = &mut self.boxes[id];
        let lasts = kept.grid.is_horizontal
            && it.turned == WritingMode::HorizontalTb
            && !(it.has_legend || it.is_parking || it.is_skipped);
        let info = it.grid.get_or_insert_default();
        info.kept = lasts.then_some(kept);
        info
    }

    fn estimate_rows(&mut self, grid: &mut Grid, height: Option<f32>) {
        let rows = &mut grid.axes[1];
        let estimate = |track: &Track| match sizing(track, height) {
            (Sizing::Fixed(min), Sizing::Fixed(max)) => max.max(min),
            (_, Sizing::Fixed(max)) => max,
            (_, Sizing::Fr(fr)) if fr >= 1.0 && rows.tracks.len() == 1 => {
                height.unwrap_or(f32::INFINITY)
            }
            _ => f32::INFINITY,
        };
        if !rows.is_subgrid {
            rows.gap = gap_of(&grid.style, 1, height);
            if rows.estimated_for.replace(height) != Some(height) {
                rows.estimates = rows.tracks.iter().map(estimate).collect();
            }
        }
        if grid.has_subgrids && grid.axes[1].estimates.iter().all(|it| it.is_finite()) {
            let (rows, mut at) = (&mut grid.axes[1], 0.0);
            if !rows.estimates.is_empty() {
                let positions = rows.estimates.iter().map(|size| {
                    at += size + rows.gap;
                    [at - size - rows.gap, at - rows.gap]
                });
                rows.positions = positions.collect();
            }
            if !rows.positions.is_empty() && grid.items.iter().any(|it| it.crosses == 1) {
                self.position_subgrids(grid, 1);
            }
        }
    }

    pub(crate) fn grid_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let mut kept = self.own_grid(id, [None, height], &self.room_for_widths(id));
        let Kept { grid, columns, .. } = &mut *kept;
        if grid.axes[0].is_subgrid {
            self.keep_grid(id, kept);
            return Widths::default();
        }
        let mut turned = Vec::new();
        self.turn_subgrids(grid, true, &mut turned);
        self.estimate_rows(grid, height);
        self.inherit_below(grid, 0);
        let mut uses_height = repeats_automatically(&grid.style);
        let mut width_in = |space| {
            let (mut tracks, gap, depends) = self.size_columns_again(grid, space, columns);
            uses_height |= depends;
            if depends && !grid.axes[1].is_subgrid {
                let known = core::mem::take(&mut grid.axes[1].positions);
                let width = total(&tracks, gap);
                Self::position_tracks(grid, 0, &tracks, gap, width);
                self.position_subgrids(grid, 0);
                self.inherit_below(grid, 1);
                let (rows, row_gap, _) =
                    self.size_tracks(grid, 1, height.map_or(Space::MaxContent, Space::Definite));
                let size = height.unwrap_or_else(|| total(&rows, row_gap));
                Self::position_tracks(grid, 1, &rows, row_gap, size);
                self.position_subgrids(grid, 1);
                self.inherit_below(grid, 0);
                tracks = self.size_tracks(grid, 0, space).0;
                grid.axes[1].positions = known;
            }
            total(&tracks, gap)
        };
        let sizes = [width_in(Space::MinContent), width_in(Space::MaxContent)];
        turned
            .into_iter()
            .for_each(|it| self.turn_children(it, WritingMode::HorizontalTb));
        self.keep_grid(id, kept);
        Widths { sizes, uses_height }
    }

    fn size_columns(&mut self, grid: &mut Grid, width: f32, known: &mut Option<Settled>) -> bool {
        let mut uses_height = false;
        if !grid.axes[0].is_subgrid {
            self.inherit_below(grid, 0);
            let (tracks, gap);
            (tracks, gap, uses_height) =
                self.size_columns_again(grid, Space::Definite(width), known);
            Self::position_tracks(grid, 0, &tracks, gap, width);
        } else if grid.axes[0].positions.is_empty() {
            grid.axes[0].positions =
                core::iter::repeat_n([0.0, width], grid.axes[0].lines.explicit).collect();
        }
        self.position_subgrids(grid, 0);
        uses_height
    }

    /// Sets the heights of `output`.
    fn size_rows(
        &mut self,
        id: BoxId,
        grid: &mut Grid,
        input: &Input,
        (inset, known): (Edges, Option<f32>),
        last: &mut Option<SizedRows>,
        output: &mut Output,
    ) {
        self.inherit_below(grid, 1);
        let has_automatic_minimum = self.boxes[id].ratio.is_some() && input.height.is_none();
        let space = known
            .filter(|_| !has_automatic_minimum)
            .map_or(Space::MaxContent, Space::Definite);
        let (rows, mut wanted) = (&grid.axes[1], None::<Vec<_>>);
        if rows.has_simple_items && rows.tracks.len() > 64 + 8 * grid.items.len() {
            let (all, definite) = (wanted.insert(Vec::new()), space.definite());
            self.visit_wanted(
                grid,
                1,
                (gap_of(&grid.style, 1, definite), true),
                &|it| rows.unsized_track(it, definite),
                &mut |it| all.push(it),
            );
        }
        let finish = |document: &Document, total: f32, output: &mut Output| {
            output.intrinsic = inset.sums()[1] + total;
            document.finish_height(id, input, inset, output);
            (output.height - inset.sums()[1]).max(0.0)
        };
        let holds = |it: &SizedRows| {
            it.space == space
                && if wanted.is_some() {
                    it.wanted == wanted
                } else {
                    it.columns == grid.axes[0].positions
                }
        };
        if let Some(last) = last
            .as_ref()
            .filter(|it| holds(it) && finish(self, it.total, output) == it.height)
        {
            (grid.axes[1].positions, grid.axes[1].gap) = (last.positions.clone(), last.gap);
            return;
        }
        let (mut tracks, mut gap, _) = self.size_tracks(grid, 1, space);
        let total = total(&tracks, gap);
        let height = finish(self, total, output);
        if space == Space::MaxContent
            && (grid.has_relative_tracks(1)
                || grid.is_contained(1)
                || output.height > output.intrinsic
                || rows.has_flex)
        {
            (tracks, gap, _) = self.size_tracks(grid, 1, Space::Definite(height));
        }
        Self::position_tracks(grid, 1, &tracks, gap, height);
        *last = Some(SizedRows {
            columns: grid.axes[0].positions.clone(),
            wanted,
            space,
            total,
            height,
            positions: grid.axes[1].positions.clone(),
            gap,
        });
    }

    #[inline(never)]
    pub(crate) fn lay_out_grid(
        &mut self,
        id: BoxId,
        input: &Input,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let it = &self.boxes[id];
        let inset = it.inset(input.basis.0);
        let inner = |height: f32| (height - inset.sums()[1]).max(0.0);
        let (width, known) = (
            (input.width - inset.sums()[0]).max(0.0),
            it.inner_height(input, inset),
        );
        let room = Room {
            available: [None, input.stretch],
            basis: [Some(input.basis.0), input.basis.1],
            height: None,
        };
        let mut kept = self.own_grid(
            id,
            [Some(width), known.or_else(|| input.height.map(inner))],
            &room,
        );
        let Kept {
            grid,
            columns: settled,
            rows: sized_rows,
            placed,
            ..
        } = &mut *kept;
        let (mut output, mut turned) = (Output::default(), Vec::new());
        self.turn_subgrids(grid, true, &mut turned);
        self.estimate_rows(grid, known);
        let mut resizes = self.size_columns(grid, width, settled);
        loop {
            if grid.axes[1].is_subgrid {
                let rows = &mut grid.axes[1];
                if rows.positions.len() != rows.lines.explicit {
                    rows.positions = core::iter::repeat_n([0.0; 2], rows.lines.explicit).collect();
                }
                output.intrinsic = inset.sums()[1] + rows.positions.last().map_or(0.0, |it| it[1]);
                self.finish_height(id, input, inset, &mut output);
            } else {
                self.size_rows(id, grid, input, (inset, known), sized_rows, &mut output);
                output.uses_height = resizes
                    || grid.axes[1].has_flex
                    || matches!(template(&grid.style, 1), Template::Tracks(list) if list.repeats_automatically());
            }
            self.position_subgrids(grid, 1);
            if !core::mem::take(&mut resizes) {
                break;
            }
            self.size_columns(grid, width, settled);
        }
        for axis in 0..2 {
            if grid.axes[axis].has_baselines && !grid.axes[axis].is_subgrid {
                let mut contributors = Vec::new();
                self.contributors(
                    grid,
                    axis,
                    (grid.axes[axis].gap, false),
                    &|span| (span.clone(), [0.0; 2]),
                    &mut contributors,
                );
                grid.axes[axis].baselines =
                    self.add_baseline_shims(&mut contributors, &grid.axes[axis], true);
                self.position_subgrids(grid, axis);
            }
        }
        let mut all_turned = Vec::new();
        self.turn_subgrids(grid, false, &mut all_turned);

        let rtl = grid.style.is_rtl();
        let frame = Frame {
            origin: [inset.left, inset.top],
            right: rtl.then_some(inset.left + width),
        };
        let mut candidates = [None::<((usize, usize, usize), f32)>; 2];
        let [columns, rows] = [0, 1].map(|axis| grid.axes[axis].positions.len());
        let is_touched = core::mem::take(&mut self.boxes[id].cache.has_touched_children);
        let stays = |it: &Placed| {
            !is_touched
                && breaks.is_none()
                && it.frame == frame
                && it.tracks[0] == grid.axes[0].positions
                && it.tracks[1] == grid.axes[1].positions
        };
        let placed_before = placed.take().filter(stays);
        let moving = if placed_before.is_some() {
            &[][..]
        } else {
            &grid.items[..]
        };
        let (first_row, last_row) = moving.iter().fold((usize::MAX, 0), |all, it| {
            (all.0.min(it.area[1].start), all.1.max(it.area[1].end))
        });
        let mut members = Vec::new();
        let (mut contents, mut gathers) = (
            Contents::default(),
            grid.items.len() > 8
                && grid.items.len() == self.boxes[id].children.len()
                && breaks.is_none(),
        );
        for (index, item) in moving.iter().enumerate() {
            if grid.is_shuffled {
                self.boxes
                    .prefetch_scattered([6, 12].map(|it| Some(moving.get(index + it)?.id)));
            }
            self.inherit(grid, item);
            let align = item.align;
            let area =
                [0, 1].map(|axis| grid.axes[axis].area(&item.area[axis]).unwrap_or_default());
            let size = area.map(|[start, end]| (end - start).max(0.0));
            let (mut margin, room, own_width) = self.fit_in_area(item.id, align, size.map(Some));
            let has_definite_width =
                self.boxes[item.id].is_orthogonal() && Some(own_width) == room.available[0];
            let own = self.lay_out(
                item.id,
                Input {
                    has_definite_width,
                    ..self.input_for(item.id, own_width, &room)
                },
                None,
            );
            let mut shared = [None; 2];
            let style = &self.boxes[item.id].style;
            let has_auto_margin = style.fixed().traits.contains(Traits::HAS_AUTO_MARGIN);
            let mut start_along = |axis: usize, own_size: f32| {
                let (margins, free) = (
                    margin.along(axis),
                    size[axis] - own_size - margin.sums()[axis],
                );
                let before = match if has_auto_margin {
                    auto_margins(style, axis)
                } else {
                    [false; 2]
                } {
                    [false, false]
                        if matches!(align[axis].0, AlignName::Normal | AlignName::Stretch) =>
                    {
                        0.0
                    }
                    [false, false] => match align[axis].resolved(
                        axis,
                        rtl,
                        self.boxes[item.id].starts_far(axis),
                        free,
                    ) {
                        AlignName::Baseline | AlignName::LastBaseline
                            if item.inheriting(axis).is_none() =>
                        {
                            let (tracks, span) = (&grid.axes[axis], &item.area[axis]);
                            let (side, ascent) = self.item_baseline(
                                item.id,
                                axis,
                                align[axis],
                                &own,
                                own_size,
                                margin,
                                tracks.has_intrinsic(span),
                            );
                            let baseline = tracks
                                .baselines
                                .get([span.start, span.end - 1][side])
                                .map(|it| it[side])
                                .filter(|it| *it > f32::MIN / 2.0);
                            if let Some(baseline) =
                                baseline.filter(|_| axis == 1 && ascent.is_some())
                            {
                                shared[side] = Some(if side == 0 {
                                    area[1][0] + baseline
                                } else {
                                    area[1][1] - baseline
                                });
                            }
                            match (side, baseline.zip(ascent)) {
                                (0, it) => it.map_or(0.0, |it| it.0 - it.1),
                                (_, Some(it)) => free - (it.0 - it.1),
                                _ => free.max(0.0),
                            }
                        }
                        align => distribute(align, free, 1).0,
                    },
                    auto => {
                        margin.set(
                            axis,
                            match auto {
                                [true, true] => halves(free.max(0.0)).into(),
                                [true, false] => [free.max(0.0), margins[1]],
                                _ => [margins[0], free.max(0.0)],
                            },
                        );
                        0.0
                    }
                };
                let start = area[axis][0] + before;
                frame.physical(axis, [start, start + own_size + margin.sums()[axis]])[0]
                    + margin.along(axis)[0]
            };
            let at = [start_along(0, own_width), start_along(1, own.height)];
            self.place_child(item.id, at, margin, (size[0], Some(size[1])));
            gathers = gathers && contents.add(&self.boxes[item.id]);
            output.escapes |= own.escapes;
            if breaks.is_some() {
                let [has_fixed_min, has_fixed_max] =
                    match grid.axes[1].tracks.get(item.area[1].start) {
                        Some(Track::Breadth(it)) => [matches!(it, Breadth::Length(_)); 2],
                        Some(Track::MinMax(min, max)) => [
                            matches!(min, Breadth::Length(_)),
                            matches!((min, max), (Breadth::Length(_), Breadth::Length(_))),
                        ],
                        _ => [false; 2],
                    };
                members.push(Member {
                    id: item.id,
                    input: Input {
                        has_definite_width,
                        ..self.input_for(item.id, own_width, &room)
                    },
                    bands: [item.area[1].start, item.area[1].end - 1],
                    offsets: [at[1] - inset.top - area[1][0], margin.bottom],
                    fills: room.height.is_some(),
                    grows: self.can_grow(item.id)
                        && self.boxes[item.id].has_auto_size(1)
                        && item.area[1].len() == 1
                        && !has_fixed_max
                        && (!has_fixed_min || self.boxes[id].has_auto_size(1)),
                    moves_alone: false,
                });
            }
            if item.area[1].start != first_row && item.area[1].end != last_row {
                continue;
            }
            for (which, baseline) in self.boxes[item.id]
                .baselines_for(&grid.style, &own)
                .into_iter()
                .enumerate()
            {
                let kind = [which, 1 - which]
                    .iter()
                    .position(|it| shared[*it].is_some())
                    .unwrap_or(2);
                let rank = match which {
                    0 => (item.area[1].start, kind, item.area[0].start),
                    _ => (rows - item.area[1].end, kind, columns - item.area[0].end),
                };
                if candidates[which].is_none_or(|it| rank < it.0 || which == 1 && rank == it.0) {
                    candidates[which] = Some((
                        rank,
                        shared[0]
                            .or(shared[1])
                            .map_or(at[1] + baseline, |it| inset.top + it),
                    ));
                }
            }
        }
        for subgrid in all_turned.into_iter().filter(|it| !turned.contains(it)) {
            self.turn_children(subgrid, self.boxes[subgrid].mode);
        }
        output.baselines = candidates.map(|it| Some(it?.1));
        if let Some(before) = placed_before {
            (output.baselines, output.escapes) = (before.baselines, before.escapes);
            gathers = gathers && grid.items.iter().all(|it| contents.add(&self.boxes[it.id]));
        }
        if gathers {
            self.gathered.set(Some((id, contents)));
        }
        let it = &mut self.boxes[id];
        it.cache.has_touched_children = false;
        *placed = (breaks.is_none() && !grid.has_subgrids).then(|| Placed {
            tracks: grid.axes.each_ref().map(|it| it.positions.clone()),
            frame,
            baselines: output.baselines,
            escapes: output.escapes,
        });

        let content = [
            [inset.left, inset.left + width],
            [inset.top, inset.top + inner(output.height)],
        ];
        for index in 0..if it.children.len() > grid.items.len() {
            it.children.len()
        } else {
            0
        } {
            let child = self.boxes[id].children[index];
            let it = &mut self.boxes[child];
            if it.style.is_out_of_flow() {
                output.escapes |= it.out_of_flow();
                let align = alignment(&it.style, &grid.style);
                it.static_position = [0, 1].map(|axis| {
                    let edge = Edge::from(
                        align[axis].resolved(axis, rtl, it.starts_far(axis), 0.0),
                        axis == 0 && rtl,
                    );
                    (edge.of(content[axis]), edge)
                });
            }
        }
        if let Some(breaks) = breaks {
            let (mut flow, mut end) = (self.flow(id, input, inset, breaks), 0.0);
            let rows = &mut grid.axes[1].positions;
            *sized_rows = None;
            let band = |&[top, bottom]: &[f32; 2]| {
                Band::new(
                    inset.top + top,
                    bottom - top,
                    (top - core::mem::replace(&mut end, bottom)).max(0.0),
                )
            };
            let mut bands: Vec<_> = rows.iter().map(band).collect();
            members.order_by_key(|it| it.bands[0]);
            self.fragment_bands(id, &mut flow, &mut bands, &mut members, 0..rows.len());
            *rows = bands
                .iter()
                .map(|it| {
                    [
                        flow.consumed_in(it.columns[0], it.top),
                        flow.consumed_in(it.columns[1], it.bottom),
                    ]
                    .map(|it| it - inset.top)
                })
                .collect();
            self.finish_bands(
                id,
                input,
                inset,
                flow,
                [
                    inset.top + end,
                    bands.last().map_or(inset.top, |it| it.bottom),
                ],
                &mut output,
            );
        }
        let (tracks, lines) = (
            grid.axes.each_ref().map(|it| it.positions.clone()),
            grid.axes.each_ref().map(|it| Rc::clone(&it.lines)),
        );
        let info = self.keep_grid(id, kept);
        (info.tracks, info.lines, info.frame) = (tracks, lines, Some(frame));
        output
    }

    /// `auto` stands for the edges of `padding_box`.
    pub(crate) fn grid_area_of_positioned(
        &self,
        grid: BoxId,
        id: BoxId,
        padding_box: Rect,
    ) -> Rect {
        let Some(info) = self.boxes[grid]
            .grid
            .as_ref()
            .filter(|it| it.frame.is_some())
        else {
            return padding_box;
        };
        let [[left, right], [top, bottom]] = [0, 1].map(|axis| {
            let ([start, end], lines) =
                (grid_lines(&self.boxes[id].style, axis), &info.lines[axis]);
            let mut range = [lines.line(start, false), lines.line(end, true)];
            if let (Placement::Lines(first, last), false) = (
                lines.place(start, end, 1),
                *start == GridLine::Auto || *end == GridLine::Auto,
            ) {
                range = [Some(first), Some(last)];
            }
            let (count, is_reversed) = (
                info.tracks[axis].len(),
                axis == 0 && self.boxes[grid].style.is_rtl(),
            );
            let [near, far] = if is_reversed { [1, 0] } else { [0, 1] };
            let index = |line: Option<i32>| {
                usize::try_from(line? + lines.before as i32)
                    .ok()
                    .filter(|it| *it <= count)
            };
            let origin = Rect::new(self.content_box(grid)).span(axis)[near];
            let start = index(range[0]).map(|it| {
                info.track(axis, it).map_or_else(
                    || {
                        info.track(axis, count.wrapping_sub(1))
                            .map_or(origin, |it| it[far])
                    },
                    |it| it[near],
                )
            });
            let end = index(range[1]).map(|it| {
                info.track(axis, it.wrapping_sub(1)).map_or_else(
                    || info.track(axis, 0).map_or(origin, |it| it[near]),
                    |it| it[far],
                )
            });
            let edges = padding_box.span(axis);
            let [start, end] = [start.unwrap_or(edges[near]), end.unwrap_or(edges[far])];
            if is_reversed {
                [end.min(start), start]
            } else {
                [start, end.max(start)]
            }
        });
        Rect::from_edges(left, top, right, bottom)
    }
}
