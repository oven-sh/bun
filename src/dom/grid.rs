//! Grid layout.

use core::ops::Range;
use std::rc::Rc;

use crate::abi::Rect;
use crate::block::{align_self, justify_self};
use crate::boxes::{BoxId, Kind};
use crate::document::Document;
use crate::fragment::{Band, Breaks, Member};
use crate::layout::{
    AutoSize, Edges, Input, Output, Room, Widths, auto_margins, distribute, gap, is_relative,
    margin, resolve_if_definite, sizes, unit,
};
use crate::positioned::{Edge, halves};
use crate::properties::Style;
use crate::types::*;
use crate::values::{Css, Lp, Out, Size, Str, write_list, write_px};

const MAX_TRACKS: i32 = 10_000;

/// For each line.
type Names = Vec<Vec<Str>>;

/// What is left of the layout. Axis 0 is the columns.
pub(crate) struct GridInfo {
    /// The edges of the tracks, from the border box.
    pub(crate) tracks: [Vec<[f32; 2]>; 2],
    lines: [Lines; 2],
}

/// What a subgrid gets from the grid around it.
#[derive(Default, PartialEq)]
pub(crate) struct Inherited {
    /// From the start of the content box.
    tracks: [Option<Vec<[f32; 2]>>; 2],
    names: [Names; 2],
    gaps: [f32; 2],
    baselines: [Vec<[f32; 2]>; 2],
}

#[derive(Clone, Default)]
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
    lines: Lines,
    /// For each track. Empty in a subgrid.
    tracks: Vec<Track>,
    collapsed: Vec<bool>,
    is_subgrid: bool,
    /// From the start of the content box.
    positions: Vec<[f32; 2]>,
    /// The sizes, as far as they are known before the positions.
    estimates: Vec<f32>,
    gap: f32,
    has_baselines: bool,
    /// From the start and from the end of each track.
    baselines: Vec<[f32; 2]>,
}

struct Item {
    id: BoxId,
    area: [Range<usize>; 2],
    subgrid: Option<Box<Grid>>,
    /// 1 if its axes are the other way round.
    crosses: usize,
}

struct Grid {
    style: Rc<Style>,
    axes: [Axis; 2],
    items: Vec<Item>,
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

impl GridInfo {
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
            if let Some([start, end]) = tracks.get(line).filter(|_| !lines.are_inherited) {
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
    /// Also returns the tracks that collapse if they are empty.
    fn explicit(
        style: &Style,
        axis: usize,
        size: Result<f32, [f32; 2]>,
        inherited: Option<(usize, &Names)>,
    ) -> (Axis, Range<usize>) {
        let (mut new, mut fitted) = (Axis::default(), 0..0);
        let mut name = |line: usize, names: &[Str]| {
            if !names.is_empty() {
                new.lines
                    .names
                    .resize(new.lines.names.len().max(line + 1), Vec::new());
                new.lines.names[line].extend_from_slice(names);
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
                new.lines.own_names = own.expand(count + 1).cloned().collect();
                (new.is_subgrid, new.lines.explicit, new.lines.are_inherited) = (true, count, true);
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
                                _ => automatic_repetitions(list, style, axis, size),
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
                new.lines.explicit = new.tracks.len();
                new.lines.own_names.clone_from(&new.lines.names);
            }
            _ => {}
        }
        let mut name = |line: usize, name: String| {
            new.lines
                .names
                .resize(new.lines.names.len().max(line + 1), Vec::new());
            new.lines.names[line].push(name.into());
        };
        for (area, lines) in style.grid.areas.named() {
            name(lines[axis].start, format!("{area}-start"));
            name(lines[axis].end, format!("{area}-end"));
        }
        match new.is_subgrid {
            true => new.lines.names.truncate(new.lines.explicit + 1),
            false => new.lines.explicit = new.lines.explicit.max(style.grid.areas.counts()[axis]),
        }
        (new, fitted)
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
                    .map(|it| it + self.gap)
                    .sum::<f32>()
                    - self.gap,
            )
            .filter(|it| it.is_finite())
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
    axes: &mut [Axis; 2],
    flow: GridAutoFlow,
) -> Vec<[Range<usize>; 2]> {
    let (minor, is_dense) = (usize::from(flow.is_column), flow.is_dense);
    let major = 1 - minor;
    let mut counts = [0; 2];
    for axis in 0..2 {
        let (mut first, mut last, mut widest) = (0, axes[axis].lines.explicit as i32, 0);
        for placement in placements {
            match placement[axis] {
                Placement::Lines(start, end) => (first, last) = (first.min(start), last.max(end)),
                Placement::Span(span) => widest = widest.max(span),
            }
        }
        axes[axis].lines.before = -first as usize;
        counts[axis] = (last - first).max(widest) as usize;
    }
    let range = |placement: &[Placement; 2], axis: usize| match placement[axis] {
        Placement::Lines(start, end) => {
            let before = axes[axis].lines.before as i32;
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
            if !axes[minor].is_subgrid {
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
    shares.sort_by(|a, b| a.0.total_cmp(&b.0));
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
        shares.sort_by_key(|it| has_preferred && !prefers(&tracks[it.2]));
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
        if tracks.iter().all(|it| {
            is_flexible(it).is_none_or(|flex| f64::from(flex) * next >= f64::from(it.base))
        }) {
            return next;
        }
        fr = next;
    }
}

fn total(tracks: &[Sized], gap: f32) -> f32 {
    let count = tracks.iter().filter(|it| !it.is_collapsed).count();
    tracks.iter().map(|it| it.base).sum::<f32>() + gap * count.saturating_sub(1) as f32
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
        size: [Result<f32, [f32; 2]>; 2],
        inherited: [Option<(usize, &Names)>; 2],
    ) -> Grid {
        let style = Rc::clone(&self.boxes[id].style);
        let [(columns, fitted_columns), (rows, fitted_rows)] =
            [0, 1].map(|axis| Axis::explicit(&style, axis, size[axis], inherited[axis]));
        let mut axes = [columns, rows];
        let in_flow = || {
            self.boxes[id]
                .children
                .iter()
                .copied()
                .filter(|it| !self.boxes[*it].style.is_out_of_flow())
        };
        let placements: Vec<_> = in_flow()
            .map(|child| {
                let style = &self.boxes[child].style;
                [0, 1].map(|axis| {
                    let ([start, end], lines) = (grid_lines(style, axis), &axes[axis].lines);
                    let own = axis ^ self.crosses(id, child);
                    let auto_span = match template(style, own) {
                        Template::Subgrid(names) if self.is_subgrid(child, own) => {
                            (names.count() as i32 - 1).max(1)
                        }
                        _ => 1,
                    };
                    let (min, max) = if axes[axis].is_subgrid {
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
                })
            })
            .collect();
        let mut areas = place_items(&placements, &mut axes, style.grid.flow);
        for (axis, fitted) in [fitted_columns, fitted_rows].into_iter().enumerate() {
            let it = &mut axes[axis];
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
            if !fitted.is_empty() {
                it.collapsed = (0..count)
                    .map(|it| it >= before && fitted.contains(&(it - before)))
                    .collect();
                areas
                    .iter()
                    .for_each(|area| it.collapsed[area[axis].clone()].fill(false));
            }
        }
        let items = in_flow().zip(areas).map(|(child, area)| {
            let (is_subgrid, crosses) = (
                [0, 1].map(|axis| self.is_subgrid(child, axis)),
                self.crosses(id, child),
            );
            let mut item = Item {
                id: child,
                area,
                subgrid: None,
                crosses,
            };
            if is_subgrid != [false; 2] {
                item.subgrid = Some(Box::new(self.build_subgrid(
                    &style,
                    &axes,
                    &item,
                    [Err([0.0, f32::INFINITY]); 2],
                )));
            }
            item
        });
        let items: Vec<_> = items.collect();
        for item in &items {
            let own = &self.boxes[item.id].style;
            for (axis, align) in [
                justify_self(own, &style),
                align_self(own, style.layout.align_items),
            ]
            .into_iter()
            .enumerate()
            {
                axes[axis].has_baselines |= match item.inheriting(axis) {
                    Some(subgrid) => subgrid.axes[axis ^ item.crosses].has_baselines,
                    None => matches!(align.0, AlignName::Baseline | AlignName::LastBaseline),
                };
            }
        }
        Grid { items, style, axes }
    }

    fn build_subgrid(
        &self,
        parent: &Style,
        axes: &[Axis; 2],
        item: &Item,
        size: [Result<f32, [f32; 2]>; 2],
    ) -> Grid {
        let names =
            [0, 1].map(|own| self.names_for_subgrid(parent, axes, item, own ^ item.crosses));
        let inherited = [0, 1].map(|own| {
            self.is_subgrid(item.id, own)
                .then(|| (item.area[own ^ item.crosses].len(), &names[own]))
        });
        self.build_grid(item.id, size, inherited)
    }

    fn crosses(&self, parent: BoxId, child: BoxId) -> usize {
        usize::from(self.boxes[parent].mode.is_vertical() != self.boxes[child].mode.is_vertical())
    }

    fn is_opposite(&self, parent: &Style, item: &Item, axis: usize) -> bool {
        parent.runs_back(axis) != self.boxes[item.id].style.runs_back(axis ^ item.crosses)
    }

    /// Turns the items of the subgrids for their modes, or back. Returns those whose items were not yet turned.
    fn turn_subgrids(&mut self, grid: &Grid, turns: bool, out: &mut Vec<BoxId>) {
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
                let style = &self.boxes[item.id].style;
                let align = [
                    justify_self(style, &grid.style),
                    align_self(style, grid.style.layout.align_items),
                ];
                out.push(new(item.id, to_root(&item.area[axis]), align, None));
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

    /// Returns the tracks, the gap, and whether the items depend on the heights of their areas.
    fn size_tracks(&mut self, grid: &Grid, axis: usize, space: Space) -> (Vec<Sized>, f32, bool) {
        let definite = match space {
            Space::Definite(size) => Some(size),
            _ => None,
        };
        let (own, gap, mut uses_height) =
            (&grid.axes[axis], gap_of(&grid.style, axis, definite), false);
        let new = |(index, track): (usize, &Track)| {
            let is_collapsed = own.collapsed.get(index) == Some(&true);
            let (min, max) = if is_collapsed {
                (Sizing::Fixed(0.0), Sizing::Fixed(0.0))
            } else {
                sizing(track, definite)
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
        };
        let mut tracks: Vec<Sized> = own.tracks.iter().enumerate().map(new).collect();
        let mut contributors = Vec::with_capacity(grid.items.len());
        let is_contained = match axis {
            0 => grid
                .style
                .contain()
                .intersects(Contain::SIZE | Contain::INLINE_SIZE),
            _ => grid.style.contain().contains(Contain::SIZE),
        };
        if definite.is_some() || !is_contained {
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
        contributors.sort_by_key(|it| group(it, &tracks));
        let mut rest = &mut contributors[..];
        while let Some(first) = rest.first() {
            let key = group(first, &tracks);
            let (members, others) = rest.split_at_mut(
                rest.iter()
                    .take_while(|it| group(it, &tracks) == key)
                    .count(),
            );
            rest = others;
            let steps = [
                Step::IntrinsicMinimums,
                Step::ContentMinimums,
                Step::MaxContentMinimums,
                Step::IntrinsicMaximums,
                Step::MaxContentMaximums,
            ];
            let only_flexible = key == usize::MAX;
            for step in &steps[..if only_flexible { 3 } else { 5 }] {
                for it in members.iter_mut() {
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

        match space {
            Space::MinContent => {}
            Space::MaxContent => tracks.iter_mut().for_each(|it| it.base = it.limit),
            Space::Definite(size) => {
                let free = size - total(&tracks, gap);
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
        if space != Space::MinContent && tracks.iter().any(|it| it.flex().is_some()) {
            let fr = match space {
                Space::Definite(size) => find_fr(&tracks, size, gap),
                _ => {
                    let own = tracks
                        .iter()
                        .filter_map(|it| Some(f64::from(it.base) / f64::from(it.flex()?.max(1.0))));
                    let mut fr = own.fold(0.0, f64::max);
                    for it in contributors
                        .iter_mut()
                        .filter(|it| is_flexible(it, &tracks))
                    {
                        let contribution = self.contributions(it, &mut uses_height)[1];
                        fr = fr.max(find_fr(&tracks[it.span.clone()], contribution, gap));
                    }
                    fr
                }
            };
            let (mut error, units) = (0.0, f64::from(crate::layout::units_per_pixel()));
            for it in &mut tracks {
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
        if let (Some(size), AlignName::Normal | AlignName::Stretch) = (definite, align.0) {
            let automatic = tracks
                .iter()
                .enumerate()
                .filter(|it| it.1.max == Sizing::Auto);
            let mut shares: Vec<_> = automatic.map(|it| (f32::INFINITY, 0.0, it.0)).collect();
            share_equally(&mut shares, (size - total(&tracks, gap)).max(0.0));
            shares
                .into_iter()
                .for_each(|(_, increase, index)| tracks[index].base += increase);
        }
        (tracks, gap, uses_height)
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
        let mut items = core::mem::take(&mut grid.items);
        for item in items.iter_mut().filter(|it| it.subgrid.is_some()) {
            let (area, own) = (
                [0, 1].map(|it| grid.axes[it].extent(&item.area[it])),
                axis ^ item.crosses,
            );
            if item.inheriting(axis).is_some() {
                let (tracks, span) = (&grid.axes[axis], item.area[axis].clone());
                let outer = &tracks.positions[span.clone()];
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
                (inherited.positions, inherited.baselines, inherited.gap) =
                    (positions.collect(), baselines, gap);
            } else if own == 0 {
                let style = Rc::clone(&self.boxes[item.id].style);
                let align = [
                    justify_self(&style, &grid.style),
                    align_self(&style, grid.style.layout.align_items),
                ];
                let (_, room, width) = self.fit_in_area(
                    item.id,
                    align,
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
        let inherited = item.subgrid.as_deref().map(|subgrid| Inherited {
            tracks: subgrid.axes.each_ref().map(|it| {
                it.is_subgrid.then(|| {
                    if it.positions.is_empty() {
                        vec![[0.0, f32::INFINITY]; it.lines.explicit]
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
            it.inherited = inherited.map(Box::new);
            it.cache.clear();
        }
    }

    /// For the items that are measured as a whole, though they have inherited the tracks of the other axis.
    fn inherit_below(&mut self, grid: &Grid, axis: usize) {
        for item in grid.items.iter().filter(|it| it.subgrid.is_some()) {
            match item.inheriting(axis) {
                Some(subgrid) => self.inherit_below(subgrid, axis ^ item.crosses),
                None => self.inherit(grid, item),
            }
        }
    }

    fn own_grid(&self, id: BoxId, size: [Option<f32>; 2], room: &Room) -> Grid {
        let it = &self.boxes[id];
        let (edges, inset) = (
            it.border_and_padding(room.basis[0].unwrap_or(0.0)).sums(),
            it.inset(room.basis[0].unwrap_or(0.0)).sums(),
        );
        let limit = |index: usize| {
            it.resolve_size(sizes(&it.style)[index], index, room, edges, &mut |_| None)
                .map(|it| it - inset[index % 2])
        };
        let size = [0, 1].map(|axis| {
            size[axis].ok_or_else(|| {
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
        let inherited = it
            .inherited
            .as_deref()
            .filter(|_| self.boxes[it.parent].kind == Kind::Grid && !it.style.is_out_of_flow());
        let mut grid = self.build_grid(
            id,
            size,
            [0, 1].map(|axis| {
                Some((
                    inherited?.tracks[axis].as_ref()?.len(),
                    &inherited?.names[axis],
                ))
            }),
        );
        for (axis, own) in grid
            .axes
            .iter_mut()
            .enumerate()
            .filter(|it| it.1.is_subgrid)
        {
            if let Some((inherited, tracks)) =
                inherited.and_then(|it| Some((it, it.tracks[axis].as_ref()?)))
            {
                own.positions
                    .extend(tracks.iter().filter(|it| it[1].is_finite()));
                (own.gap, own.baselines) =
                    (inherited.gaps[axis], inherited.baselines[axis].clone());
            }
        }
        grid
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
            (rows.estimates, rows.gap) = (
                rows.tracks.iter().map(estimate).collect(),
                gap_of(&grid.style, 1, height),
            );
        }
        if grid.items.iter().any(|it| it.subgrid.is_some())
            && grid.axes[1].estimates.iter().all(|it| it.is_finite())
        {
            let (rows, mut at) = (&mut grid.axes[1], 0.0);
            rows.positions.extend(rows.estimates.iter().map(|size| {
                at += size + rows.gap;
                [at - size - rows.gap, at - rows.gap]
            }));
            if !rows.positions.is_empty() && grid.items.iter().any(|it| it.crosses == 1) {
                self.position_subgrids(grid, 1);
            }
        }
    }

    pub(crate) fn grid_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let mut grid = self.own_grid(id, [None, height], &Room::default());
        if grid.axes[0].is_subgrid {
            return Widths::default();
        }
        let mut turned = Vec::new();
        self.turn_subgrids(&grid, true, &mut turned);
        self.estimate_rows(&mut grid, height);
        self.inherit_below(&grid, 0);
        let mut uses_height = matches!(template(&grid.style, 1), Template::Tracks(list) if list.repeats_automatically());
        let sizes = [Space::MinContent, Space::MaxContent].map(|space| {
            let (mut tracks, gap, depends) = self.size_tracks(&grid, 0, space);
            uses_height |= depends;
            if depends && !grid.axes[1].is_subgrid {
                let known = core::mem::take(&mut grid.axes[1].positions);
                let width = total(&tracks, gap);
                Self::position_tracks(&mut grid, 0, &tracks, gap, width);
                self.position_subgrids(&mut grid, 0);
                self.inherit_below(&grid, 1);
                let (rows, row_gap, _) =
                    self.size_tracks(&grid, 1, height.map_or(Space::MaxContent, Space::Definite));
                let size = height.unwrap_or_else(|| total(&rows, row_gap));
                Self::position_tracks(&mut grid, 1, &rows, row_gap, size);
                self.position_subgrids(&mut grid, 1);
                self.inherit_below(&grid, 0);
                tracks = self.size_tracks(&grid, 0, space).0;
                grid.axes[1].positions = known;
            }
            total(&tracks, gap)
        });
        turned
            .into_iter()
            .for_each(|it| self.turn_children(it, WritingMode::HorizontalTb));
        Widths { sizes, uses_height }
    }

    fn size_columns(&mut self, grid: &mut Grid, width: f32) -> bool {
        let mut uses_height = false;
        if !grid.axes[0].is_subgrid {
            self.inherit_below(grid, 0);
            let (tracks, gap);
            (tracks, gap, uses_height) = self.size_tracks(grid, 0, Space::Definite(width));
            Self::position_tracks(grid, 0, &tracks, gap, width);
        } else if grid.axes[0].positions.is_empty() {
            grid.axes[0].positions = vec![[0.0, width]; grid.axes[0].lines.explicit];
        }
        self.position_subgrids(grid, 0);
        uses_height
    }

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
        let mut grid = self.own_grid(
            id,
            [Some(width), known.or_else(|| input.height.map(inner))],
            &room,
        );
        let (mut output, mut turned) = (Output::default(), Vec::new());
        self.turn_subgrids(&grid, true, &mut turned);
        self.estimate_rows(&mut grid, known);
        let mut resizes = self.size_columns(&mut grid, width);
        loop {
            if grid.axes[1].is_subgrid {
                let rows = &mut grid.axes[1];
                rows.positions.resize(rows.lines.explicit, [0.0; 2]);
                output.intrinsic = inset.sums()[1] + rows.positions.last().map_or(0.0, |it| it[1]);
                self.finish_height(id, input, inset, &mut output);
            } else {
                self.inherit_below(&grid, 1);
                let has_automatic_minimum =
                    self.boxes[id].ratio.is_some() && !input.height.is_some();
                let space = known
                    .filter(|_| !has_automatic_minimum)
                    .map_or(Space::MaxContent, Space::Definite);
                let (mut tracks, mut gap, _) = self.size_tracks(&grid, 1, space);
                output.intrinsic = inset.sums()[1] + total(&tracks, gap);
                self.finish_height(id, input, inset, &mut output);
                let height = inner(output.height);
                let is_relative = grid.axes[1].tracks.iter().any(has_percentage)
                    || grid
                        .style
                        .layout
                        .row_gap
                        .0
                        .as_ref()
                        .is_some_and(|it| !matches!(it.0, Lp::Px(_)));
                let is_contained = grid.style.contain().contains(Contain::SIZE);
                if space == Space::MaxContent
                    && (is_relative
                        || is_contained
                        || output.height > output.intrinsic
                        || tracks.iter().any(|it| it.flex().is_some()))
                {
                    (tracks, gap, _) = self.size_tracks(&grid, 1, Space::Definite(height));
                }
                output.uses_height = resizes
                    || tracks.iter().any(|it| it.flex().is_some())
                    || matches!(template(&grid.style, 1), Template::Tracks(list) if list.repeats_automatically());
                Self::position_tracks(&mut grid, 1, &tracks, gap, height);
            }
            self.position_subgrids(&mut grid, 1);
            if !core::mem::take(&mut resizes) {
                break;
            }
            self.size_columns(&mut grid, width);
        }
        for axis in 0..2 {
            if grid.axes[axis].has_baselines && !grid.axes[axis].is_subgrid {
                let mut contributors = Vec::new();
                self.contributors(
                    &grid,
                    axis,
                    (grid.axes[axis].gap, false),
                    &|span| (span.clone(), [0.0; 2]),
                    &mut contributors,
                );
                grid.axes[axis].baselines =
                    self.add_baseline_shims(&mut contributors, &grid.axes[axis], true);
                self.position_subgrids(&mut grid, axis);
            }
        }
        let mut all_turned = Vec::new();
        self.turn_subgrids(&grid, false, &mut all_turned);

        let rtl = grid.style.is_rtl();
        let physical = |axis: usize, [start, end]: [f32; 2]| match axis == 0 && rtl {
            true => [inset.left + width - end, inset.left + width - start],
            false => [inset.along(axis)[0] + start, inset.along(axis)[0] + end],
        };
        let mut candidates = [None::<((usize, usize, usize), f32)>; 2];
        let [columns, rows] = [0, 1].map(|axis| grid.axes[axis].positions.len());
        let mut members = Vec::new();
        for item in &grid.items {
            self.inherit(&grid, item);
            let style = Rc::clone(&self.boxes[item.id].style);
            let align = [
                justify_self(&style, &grid.style),
                align_self(&style, grid.style.layout.align_items),
            ];
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
            let at = [(0, own_width), (1, own.height)].map(|(axis, own_size)| {
                let (margins, free) = (
                    margin.along(axis),
                    size[axis] - own_size - margin.sums()[axis],
                );
                let before = match auto_margins(&style, axis) {
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
                physical(axis, [start, start + own_size + margin.sums()[axis]])[0]
                    + margin.along(axis)[0]
            });
            self.place_child(item.id, at, margin, (size[0], Some(size[1])));
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

        let content = [
            [inset.left, inset.left + width],
            [inset.top, inset.top + inner(output.height)],
        ];
        for index in 0..self.boxes[id].children.len() {
            let child = self.boxes[id].children[index];
            let it = &mut self.boxes[child];
            if it.style.is_out_of_flow() {
                output.escapes |= it.out_of_flow();
                let align = [
                    justify_self(&it.style, &grid.style),
                    align_self(&it.style, grid.style.layout.align_items),
                ];
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
            let band = |&[top, bottom]: &[f32; 2]| {
                Band::new(
                    inset.top + top,
                    bottom - top,
                    (top - core::mem::replace(&mut end, bottom)).max(0.0),
                )
            };
            let mut bands: Vec<_> = rows.iter().map(band).collect();
            members.sort_by_key(|it| it.bands[0]);
            self.fragment_bands(id, &mut flow, &mut bands, &mut members, 0..rows.len());
            for (row, band) in rows.iter_mut().zip(&bands) {
                *row = [
                    flow.consumed_in(band.columns[0], band.top),
                    flow.consumed_in(band.columns[1], band.bottom),
                ]
                .map(|it| it - inset.top);
            }
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
        let [columns, rows] = grid.axes;
        self.boxes[id].grid = Some(Box::new(GridInfo {
            tracks: [(0, columns.positions), (1, rows.positions)]
                .map(|(axis, it)| it.into_iter().map(|it| physical(axis, it)).collect()),
            lines: [columns.lines, rows.lines],
        }));
        output
    }

    /// `auto` stands for the edges of `padding_box`.
    pub(crate) fn grid_area_of_positioned(
        &self,
        grid: BoxId,
        id: BoxId,
        padding_box: Rect,
    ) -> Rect {
        let Some(info) = &self.boxes[grid].grid else {
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
            let (tracks, is_reversed) = (
                &info.tracks[axis],
                axis == 0 && self.boxes[grid].style.is_rtl(),
            );
            let [near, far] = if is_reversed { [1, 0] } else { [0, 1] };
            let index = |line: Option<i32>| {
                usize::try_from(line? + lines.before as i32)
                    .ok()
                    .filter(|it| *it <= tracks.len())
            };
            let origin = Rect::new(self.content_box(grid)).span(axis)[near];
            let start = index(range[0]).map(|it| {
                tracks
                    .get(it)
                    .map_or_else(|| tracks.last().map_or(origin, |it| it[far]), |it| it[near])
            });
            let end = index(range[1]).map(|it| {
                it.checked_sub(1).map_or_else(
                    || tracks.first().map_or(origin, |it| it[near]),
                    |it| tracks[it][far],
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
