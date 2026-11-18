//! Runs of points across an axis, and the edges that they make up.
//!
//! Derived from the auto-hinter of FreeType and its port in skrifa. Copyright (c) The FreeType Project (www.freetype.org),
//! (c) 2019 Fontations Developers. FreeType License and MIT, see `licenses/freetype.txt` and `licenses/fontations.txt`.

use super::outline::{Direction, NO_DIRECTION, Outline, Point};
use super::scripts::{Group, NEUTRAL, SUB_TOP, TOP};
use super::{Zone, div, mul};

const FAR: i32 = 32000;

#[derive(Clone, Copy, Default)]
pub struct Segment {
    direction: Direction,
    pub first: usize,
    pub last: usize,
    pub position: i32,
    spread: i32,
    /// Across the axis.
    extent: [i32; 2],
    is_round: bool,
    score: i32,
    len: i32,
    /// The other side of the stem.
    pub link: Option<usize>,
    serif: Option<usize>,
    pub edge: Option<usize>,
    next_in_edge: Option<usize>,
}

#[derive(Clone, Copy, Default)]
pub struct Edge {
    pub units: i32,
    pub scaled: i32,
    pub fitted: i32,
    direction: Direction,
    first: usize,
    last: usize,
    pub link: Option<usize>,
    pub serif: Option<usize>,
    /// Where it has to go.
    pub zone: Option<i32>,
    pub is_round: bool,
    pub is_neutral: bool,
    pub is_done: bool,
}

pub struct Axis {
    /// 0 for x.
    pub along: usize,
    major: Direction,
    pub segments: Vec<Segment>,
    pub edges: Vec<Edge>,
}

#[derive(Clone, Copy)]
struct Run {
    positions: [i32; 2],
    /// With whether the point is on the curve.
    extent: [(i32, bool); 2],
    on_curve: [i32; 2],
}

fn union(a: [i32; 2], b: [i32; 2]) -> [i32; 2] {
    [a[0].min(b[0]), a[1].max(b[1])]
}

impl Run {
    fn at(point: &Point, along: usize) -> Run {
        let across = point.units[1 - along];
        let on_curve = if point.is_on_curve {
            [across; 2]
        } else {
            [FAR, -FAR]
        };
        Run {
            positions: [point.units[along]; 2],
            extent: [(across, point.is_on_curve); 2],
            on_curve,
        }
    }

    fn add(&mut self, other: Run) {
        (self.positions, self.on_curve) = (
            union(self.positions, other.positions),
            union(self.on_curve, other.on_curve),
        );
        let [low, high] = self.extent;
        self.extent = [
            if other.extent[0].0 < low.0 {
                other.extent[0]
            } else {
                low
            },
            if other.extent[1].0 > high.0 {
                other.extent[1]
            } else {
                high
            },
        ];
    }

    fn len(&self) -> i32 {
        (self.extent[1].0 - self.extent[0].0).abs()
    }

    fn place(&self, segment: &mut Segment, last: usize) {
        let [low, high] = self.positions;
        (segment.last, segment.position, segment.spread) =
            (last, (low + high) >> 1, (high - low) >> 1);
    }

    fn describe(&self, segment: &mut Segment, last: usize, flat: i32) {
        self.place(segment, last);
        segment.is_round |=
            !(self.extent[0].1 && self.extent[1].1) && self.on_curve[1] - self.on_curve[0] < flat;
        segment.extent = self.extent.map(|it| it.0);
    }
}

impl Axis {
    pub fn new(outline: &Outline, along: usize, em: i32) -> Axis {
        let major = [[2, -2], [-1, 1]][along][usize::from(outline.is_clockwise)];
        let mut axis = Axis {
            along,
            major,
            segments: Vec::new(),
            edges: Vec::new(),
        };
        if outline
            .contours
            .iter()
            .try_for_each(|it| axis.find_segments(&outline.points, it.start, em / 14))
            .is_none()
        {
            axis.segments.clear();
        }
        axis
    }

    fn find_segments(&mut self, points: &[Point], first: usize, flat: i32) -> Option<()> {
        let (segments, along) = (&mut self.segments, self.along);
        let is_across = |at: usize| points[at].outgoing.abs() == self.major.abs();
        let mut start = first;
        while is_across(first) && is_across(points[start].previous) {
            start = points[start].previous;
            if start == first {
                break;
            }
        }
        let (mut at, mut has_passed, is_single) = (start, false, points[first].next == first);
        let (mut current, mut previous): (Option<Run>, Option<(usize, Run)>) = (None, None);
        loop {
            let point = &points[at];
            if let Some(run) = &mut current {
                run.add(Run::at(point, along));
            }
            if let Some(mut run) = current.take_if(|_| {
                point.outgoing != segments[segments.len() - 1].direction || at == start
            }) {
                let mut segment = segments.pop()?;
                match previous
                    .as_mut()
                    .filter(|it| segments[it.0].last == segment.first)
                {
                    Some((index, before))
                        if points[segments[*index].last].incoming == point.incoming =>
                    {
                        run.add(*before);
                        run.describe(&mut segments[*index], at, flat);
                    }
                    Some((index, before)) if before.len() > run.len() => {
                        before.positions = union(before.positions, run.positions);
                        before.place(&mut segments[*index], at);
                    }
                    Some((index, before)) => {
                        run.positions = union(before.positions, run.positions);
                        run.describe(&mut segment, at, flat);
                        (segments[*index], *before) = (segment, run);
                    }
                    None => {
                        run.describe(&mut segment, at, flat);
                        previous = Some((segments.len(), run));
                        segments.push(segment);
                    }
                }
            }
            if at == start && std::mem::replace(&mut has_passed, true) {
                return Some(());
            }
            if current.is_none() && (is_across(at) || is_single) {
                (segments.len() <= 1000).then_some(())?;
                let mut segment = Segment {
                    direction: point.outgoing,
                    first: at,
                    last: at,
                    score: FAR,
                    ..Segment::default()
                };
                if is_single {
                    (segment.position, segment.extent, segment.is_round) = (
                        point.units[along],
                        [point.units[1 - along]; 2],
                        !point.is_on_curve,
                    );
                } else {
                    current = Some(Run::at(point, along));
                }
                segments.push(segment);
            }
            at = point.next;
        }
    }

    /// Calls `visit` for segments that face each other, with their distance and how much they overlap.
    fn pair(&mut self, mut visit: impl FnMut(&mut Segment, usize, i32, i32)) {
        for first in 0..self.segments.len() {
            for second in 0..if self.segments[first].direction == self.major {
                self.segments.len()
            } else {
                0
            } {
                let (a, b) = (self.segments[first], self.segments[second]);
                if a.direction + b.direction == 0 {
                    let (distance, len) = (
                        b.position - a.position,
                        a.extent[1].min(b.extent[1]) - a.extent[0].max(b.extent[0]),
                    );
                    visit(&mut self.segments[first], second, distance, len);
                    visit(&mut self.segments[second], first, distance, len);
                }
            }
        }
    }

    pub fn link(&mut self, em: i32, widest: i32) {
        self.pair(|segment, other, distance, len| {
            if distance > 0 && len >= (8 * em / 2048).max(1) {
                let demerit = match widest {
                    0 => distance,
                    _ => match (distance << 10) / widest - (1 << 10) {
                        10001.. => FAR,
                        excess => excess.max(0).pow(2) / 3000,
                    },
                };
                let score = demerit + 6000 * em / 2048 / len;
                if score < segment.score {
                    (segment.score, segment.link) = (score, Some(other));
                }
            }
        });
        for index in 0..self.segments.len() {
            if let Some(back) = self.segments[index]
                .link
                .map(|it| self.segments[it].link)
                .filter(|it| *it != Some(index))
            {
                (self.segments[index].link, self.segments[index].serif) = (None, back);
            }
        }
    }

    pub fn link_cjk(&mut self, em: i32, scale: i32) {
        self.pair(|it, other, distance, len| {
            if distance >= 0
                && len >= 8 * em / 2048
                && distance * 8 < it.score * 9
                && (distance * 8 < it.score * 7 || it.len < len)
            {
                (it.score, it.len, it.link) = (distance, len, Some(other));
            }
        });
        let (segments, near) = (&mut self.segments, div(64 * 3, scale));
        let stem = |segments: &[Segment], index: usize| {
            segments[index]
                .link
                .filter(|it| segments[*it].link == Some(index))
        };
        for inner in 0..segments.len() {
            let a = segments[inner];
            let Some(inner_end) = stem(segments, inner)
                .filter(|it| a.score < near && segments[*it].position > a.position)
            else {
                continue;
            };
            for outer in (0..segments.len()).filter(|it| *it != inner) {
                let b = segments[outer];
                let Some(outer_end) = stem(segments, outer).filter(|_| b.position <= a.position)
                else {
                    continue;
                };
                let ends = (segments[inner_end].position, segments[outer_end].position);
                if ends.1 < ends.0
                    || a.position == b.position && ends.0 == ends.1
                    || b.score <= a.score
                    || a.score * 4 <= b.score
                {
                    continue;
                }
                if a.len < b.len * 3 {
                    (segments[inner].link, segments[inner_end].link) = (None, None);
                    break;
                }
                for segment in segments
                    .iter_mut()
                    .filter(|it| it.link == Some(outer) || it.link == Some(outer_end))
                {
                    segment.serif = Some(if segment.link.take() == Some(outer) {
                        inner_end
                    } else {
                        inner
                    });
                }
            }
        }
        for index in 0..segments.len() {
            if let Some(other) = segments[index]
                .link
                .map(|it| segments[it])
                .filter(|it| it.link != Some(index))
            {
                segments[index].link = None;
                if other.score < near || segments[index].score < other.score * 4 {
                    segments[index].serif = other.link;
                }
            }
        }
    }

    fn members(&self, edge: &Edge) -> impl Iterator<Item = usize> {
        let last = edge.last;
        std::iter::successors(Some(edge.first), move |it| {
            self.segments[*it].next_in_edge.filter(|_| *it != last)
        })
    }

    fn append(&mut self, segment: usize, edge: usize) {
        let last = std::mem::replace(&mut self.edges[edge].last, segment);
        self.segments[last].next_in_edge = Some(segment);
    }

    pub fn find_edges(&mut self, group: Group, scale: i32, width: i32) {
        let near = match mul(width / 5, scale) {
            ..=16 if group == Group::Cjk => width / 5,
            scaled => div(scaled.min(16), scale),
        };
        for index in 0..self.segments.len() {
            let segment = self.segments[index];
            if group != Group::Cjk
                && (segment.spread > div(32, scale) || segment.direction == NO_DIRECTION)
            {
                continue;
            }
            let mut fitting = (0..self.edges.len()).filter(|it| {
                let edge = &self.edges[*it];
                let has_near_links = |link: usize| {
                    let mut links = self.members(edge).filter_map(|it| self.segments[it].link);
                    links.all(|it| {
                        (self.segments[it].position - self.segments[link].position).abs() < near
                    })
                };
                (segment.position - edge.units).abs() < near
                    && edge.direction == segment.direction
                    && (group != Group::Cjk || segment.link.is_none_or(has_near_links))
            });
            let best = if group == Group::Cjk {
                fitting.min_by_key(|it| (segment.position - self.edges[*it].units).abs())
            } else {
                fitting.next()
            };
            if let Some(edge) = best {
                self.append(index, edge);
                continue;
            }
            let (units, scaled) = (segment.position, mul(segment.position, scale));
            let stays_before = |it: &Edge| match it.units == units {
                true => segment.direction == self.major,
                false => (it.units > units) == (group == Group::Hanging),
            };
            let at = self
                .edges
                .iter()
                .rposition(stays_before)
                .map_or(0, |it| it + 1);
            self.edges.insert(
                at,
                Edge {
                    units,
                    scaled,
                    fitted: scaled,
                    direction: segment.direction,
                    first: index,
                    last: index,
                    ..Edge::default()
                },
            );
        }
        for index in 0..self.segments.len() {
            let segment = self.segments[index];
            if group != Group::Cjk
                && segment.direction == NO_DIRECTION
                && let Some(edge) = self
                    .edges
                    .iter()
                    .position(|it| (segment.position - it.units).abs() < near)
            {
                self.append(index, edge);
            }
        }
        for index in 0..self.edges.len() {
            for member in self.members(&self.edges[index]).collect::<Vec<_>>() {
                self.segments[member].edge = Some(index);
            }
        }
        for index in 0..self.edges.len() {
            let (mut edge, mut roundness) = (self.edges[index], 0);
            for segment in self.members(&self.edges[index]).map(|it| self.segments[it]) {
                roundness += if segment.is_round { 1 } else { -1 };
                let serif = segment
                    .serif
                    .filter(|it| self.segments[*it].edge.is_some_and(|it| it != index));
                let Some(other) = serif
                    .or(segment.link.filter(|it| self.segments[*it].edge.is_some()))
                    .map(|it| self.segments[it])
                else {
                    continue;
                };
                let known = if serif.is_some() {
                    &mut edge.serif
                } else {
                    &mut edge.link
                };
                *known = known
                    .filter(|it| {
                        (edge.units - self.edges[*it].units).abs()
                            <= (segment.position - other.position).abs()
                    })
                    .or(other.edge);
            }
            self.edges[index] = Edge {
                is_round: roundness >= 0,
                serif: edge.serif.filter(|_| edge.link.is_none()),
                ..edge
            };
        }
    }

    pub fn find_zones(&mut self, group: Group, em: i32, scale: i32, zones: &[(Zone, [i32; 2])]) {
        for edge in &mut self.edges {
            let mut best = mul(em / 40, scale).min(32);
            for (zone, fitted) in zones {
                let (is_top, is_neutral) =
                    (zone.kind & (TOP | SUB_TOP) != 0, zone.kind & NEUTRAL != 0);
                if is_top == (edge.direction == self.major) && !is_neutral {
                    continue;
                }
                let away = zone.heights.map(|it| (edge.units - it).abs());
                let first = usize::from(group == Group::Cjk && away[0] > away[1]);
                let overshoots = group != Group::Cjk
                    && edge.is_round
                    && !is_neutral
                    && is_top != (edge.units < zone.heights[0]);
                for which in [
                    Some(first),
                    (overshoots && mul(away[0], scale) != 0).then_some(1),
                ]
                .into_iter()
                .flatten()
                {
                    if mul(away[which], scale) < best {
                        (best, edge.zone, edge.is_neutral) =
                            (mul(away[which], scale), Some(fitted[which]), is_neutral);
                    }
                }
            }
        }
    }
}
