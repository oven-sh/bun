//! The points of a glyph, and how they follow the edges.
//!
//! Derived from the auto-hinter of FreeType and its port in skrifa. Copyright (c) The FreeType Project (www.freetype.org),
//! (c) 2019 Fontations Developers. FreeType License and MIT, see `licenses/freetype.txt` and `licenses/fontations.txt`.

use std::ops::Range;

use super::edges::Axis;
use super::{div, mul};
use crate::text::sfnt::Shape;

/// 1 is right, 2 is up, and opposites add up to 0.
pub type Direction = i8;
pub const NO_DIRECTION: Direction = 4;

fn direction([x, y]: [i32; 2]) -> Direction {
    let (direction, long, short) = match (y >= x, y >= -x) {
        (true, true) => (2, y, x),
        (true, false) => (-1, -x, y),
        (false, true) => (1, x, y),
        (false, false) => (-2, -y, x),
    };
    if long <= 14 * short.abs() {
        NO_DIRECTION
    } else {
        direction
    }
}

#[derive(Clone, Copy)]
pub struct Point {
    /// In font units.
    pub units: [i32; 2],
    /// In 1/64 of a pixel.
    pub scaled: [i32; 2],
    pub fitted: [i32; 2],
    pub is_on_curve: bool,
    is_weak: bool,
    is_touched: bool,
    pub incoming: Direction,
    pub outgoing: Direction,
    pub next: usize,
    pub previous: usize,
    /// The next and the previous point that matter.
    neighbors: [usize; 2],
}

pub struct Outline {
    pub points: Vec<Point>,
    pub contours: Vec<Range<usize>>,
    pub is_clockwise: bool,
}

fn from_to(from: &Point, to: &Point) -> [i32; 2] {
    [to.units[0] - from.units[0], to.units[1] - from.units[1]]
}

fn length([x, y]: [i32; 2]) -> i32 {
    x.abs() + y.abs()
}

impl Outline {
    pub fn new(shape: &Shape, em: i32) -> Option<Outline> {
        let mut outline = Outline {
            points: Vec::with_capacity(shape.points.len()),
            contours: Vec::new(),
            is_clockwise: false,
        };
        for &end in &shape.ends {
            let start = outline.points.len();
            (start <= end && end <= shape.points.len().min(0xffff)).then_some(())?;
            outline.contours.extend((start < end).then_some(start..end));
            outline.points.extend((start..end).map(|it| Point {
                units: [shape.points[it].x, shape.points[it].y].map(|it| i32::from(it as i16)),
                scaled: [0; 2],
                fitted: [0; 2],
                is_on_curve: shape.is_on_curve[it],
                is_weak: false,
                is_touched: false,
                incoming: NO_DIRECTION,
                outgoing: NO_DIRECTION,
                next: if it + 1 == end { start } else { it + 1 },
                previous: if it == start { end - 1 } else { it - 1 },
                neighbors: [0; 2],
            }));
        }
        outline.find_directions(20 * em / 2048);
        outline.find_weak_points();
        let area = |it: &Point, previous: &Point| {
            i64::from(it.units[1] - previous.units[1]) * i64::from(it.units[0] + previous.units[0])
        };
        outline.is_clockwise = outline
            .points
            .iter()
            .map(|it| area(it, &outline.points[it.previous]))
            .sum::<i64>()
            > 0;
        Some(outline)
    }

    fn find_directions(&mut self, near: i32) {
        let points = &mut self.points;
        for contour in &self.contours {
            let mut first = contour.start;
            while points[first].previous != contour.start
                && length(from_to(&points[points[first].previous], &points[first])) < 2 * near - 1
            {
                first = points[first].previous;
            }
            points[first].neighbors = [first; 2];
            let (mut from, mut next, mut way) = (first, first, [0; 2]);
            for _ in contour.clone() {
                let point = points[next];
                next = point.next;
                let step = from_to(&point, &points[next]);
                way = [way[0] + step[0], way[1] + step[1]];
                if length(way) < near {
                    points[next].is_weak = true;
                    continue;
                }
                let direction = direction(std::mem::take(&mut way));
                (points[next].incoming, points[next].neighbors[1]) = (direction, from);
                (points[from].outgoing, points[from].neighbors[0]) = (direction, next);
                let mut between = points[from].next;
                while between != next {
                    (points[between].incoming, points[between].outgoing) = (direction, direction);
                    between = points[between].next;
                }
                from = next;
                points[from].neighbors[0] = first;
                points[first].neighbors[1] = from;
            }
        }
    }

    fn find_weak_points(&mut self) {
        let hypot = |[x, y]: [i32; 2]| x.abs().max(y.abs()) + ((3 * x.abs().min(y.abs())) >> 3);
        for is_first_pass in [true, false] {
            for index in 0..self.points.len() {
                let point = self.points[index];
                if point.is_weak {
                    continue;
                }
                let has_directions =
                    (point.incoming, point.outgoing) != (NO_DIRECTION, NO_DIRECTION);
                if !is_first_pass && (!point.is_on_curve || has_directions) {
                    self.points[index].is_weak =
                        !point.is_on_curve || point.incoming.abs() == point.outgoing.abs();
                } else if !has_directions {
                    let [next, previous] = point.neighbors;
                    let (a, b) = (
                        from_to(&self.points[previous], &point),
                        from_to(&point, &self.points[next]),
                    );
                    let direct = hypot([a[0] + b[0], a[1] + b[1]]);
                    if if is_first_pass {
                        a[0] ^ b[0] >= 0 && a[1] ^ b[1] >= 0
                    } else {
                        hypot(a) + hypot(b) - direct < direct >> 4
                    } {
                        self.points[index].is_weak = true;
                        self.points[previous].neighbors[0] = next;
                        self.points[next].neighbors[1] = previous;
                    }
                }
            }
        }
    }

    pub fn scale(&mut self, by: [i32; 2]) {
        for point in &mut self.points {
            point.scaled = [mul(point.units[0], by[0]), mul(point.units[1], by[1])];
            point.fitted = point.scaled;
        }
    }

    pub fn follow(&mut self, axis: &Axis, snaps: bool) {
        let (along, edges) = (axis.along, &axis.edges);
        self.points.iter_mut().for_each(|it| it.is_touched = false);
        for (segment, edge) in axis
            .segments
            .iter()
            .filter_map(|it| Some((it, edges[it.edge?])))
        {
            let mut at = segment.first;
            loop {
                let point = &mut self.points[at];
                point.fitted[along] = if snaps {
                    edge.fitted
                } else {
                    point.fitted[along] + edge.fitted - edge.scaled
                };
                point.is_touched = true;
                if at == segment.last {
                    break;
                }
                at = point.next;
            }
        }
        if let (Some(first), Some(last)) = (edges.first(), edges.last()) {
            for point in self
                .points
                .iter_mut()
                .filter(|it| !it.is_touched && !it.is_weak)
            {
                let units = point.units[along];
                point.fitted[along] = if units <= first.units {
                    first.fitted - first.scaled + point.scaled[along]
                } else if units >= last.units {
                    last.fitted - last.scaled + point.scaled[along]
                } else {
                    let (mut low, mut high) = (0, edges.len());
                    while low < high && edges.len() > 8 && edges[low.midpoint(high)].units != units
                    {
                        let middle = low.midpoint(high);
                        (low, high) = if units < edges[middle].units {
                            (low, middle)
                        } else {
                            (middle + 1, high)
                        };
                    }
                    let after = if edges.len() > 8 {
                        low.midpoint(high)
                    } else {
                        edges.iter().take_while(|it| it.units < units).count()
                    };
                    let (before, after) =
                        (edges[after.max(1) - 1], edges[after.min(edges.len() - 1)]);
                    match after.units == units {
                        true => after.fitted,
                        false => {
                            before.fitted
                                + mul(
                                    units - before.units,
                                    div(after.fitted - before.fitted, after.units - before.units),
                                )
                        }
                    }
                };
                point.is_touched = true;
            }
        }
        for contour in &self.contours {
            let Some(first) = contour.clone().find(|it| self.points[*it].is_touched) else {
                continue;
            };
            let mut from = first;
            loop {
                let mut to = self.points[from].next;
                while !self.points[to].is_touched {
                    to = self.points[to].next;
                }
                let mut ends = [from, to]
                    .map(|it| (self.points[it].scaled[along], self.points[it].fitted[along]));
                ends.sort_by_key(|it| it.0);
                let ([low, high], mut at) = (ends, self.points[from].next);
                while at != to {
                    let point = &mut self.points[at];
                    point.fitted[along] = match point.scaled[along] {
                        it if it <= low.0 => it + low.1 - low.0,
                        it if it >= high.0 => it + high.1 - high.0,
                        it => low.1 + mul(it - low.0, div(high.1 - low.1, high.0 - low.0)),
                    };
                    at = point.next;
                }
                from = to;
                if from == first {
                    break;
                }
            }
        }
    }
}
