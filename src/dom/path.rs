//! Paths: SVG's syntax for them, and their geometry.

use core::f32::consts::{FRAC_PI_2, TAU};

use std::io::Write;

use bun_core::strings;

use crate::abi::{Matrix, PathVerb, Rect, RoundedRect};
use crate::types::apply;
use crate::values::{Out, mix, write_number};

pub(crate) type Point = [f32; 2];

pub(crate) struct Numbers<'a>(pub(crate) &'a [u8]);

impl Numbers<'_> {
    pub(crate) fn skip_spaces(&mut self) {
        self.0 = self.0.trim_ascii_start();
    }

    fn skip_separator(&mut self) {
        self.skip_spaces();
        self.0 = self.0.strip_prefix(b",").unwrap_or(self.0);
        self.skip_spaces();
    }

    fn flag(&mut self) -> Option<f32> {
        let (first, rest) = self
            .0
            .split_first()
            .filter(|it| matches!(it.0, b'0' | b'1'))?;
        self.0 = rest;
        self.skip_separator();
        Some(f32::from(first - b'0'))
    }

    /// With nothing but digits, a point and a minus sign.
    pub(crate) fn only(source: &[u8]) -> Option<f32> {
        let (number, len) = decimal(source)?;
        (len == source.len()).then_some(number)
    }

    /// `None` unless there is nothing but numbers, and no more than 6.
    pub(crate) fn few(source: &[u8]) -> Option<smallvec::SmallVec<[f32; 6]>> {
        let mut input = Numbers(source);
        let numbers = input.by_ref().take(6).collect();
        (input.0.is_empty() && !source.trim_ascii_end().ends_with(b",")).then_some(numbers)
    }

    /// `None` unless there is nothing but numbers.
    pub(crate) fn all(source: &str) -> Option<Vec<f32>> {
        let mut input = Numbers(source.as_bytes());
        let numbers = input.by_ref().collect();
        (input.0.is_empty() && !source.trim_ascii_end().ends_with(',')).then_some(numbers)
    }
}

/// The number and its length, if it is short and has no exponent.
fn decimal(text: &[u8]) -> Option<(f32, usize)> {
    const POWERS: [f64; 16] = [
        1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15,
    ];
    let start = usize::from(text.first() == Some(&b'-'));
    let (mut digits, mut end, mut point) = (0u64, start, None);
    while let Some(&byte) = text.get(end).filter(|_| end < 16) {
        match byte {
            b'0'..=b'9' => digits = digits * 10 + u64::from(byte - b'0'),
            b'.' if point.is_none() => point = Some(end),
            _ => break,
        }
        end += 1;
    }
    (end > start
        && end < 16
        && text[end - 1] != b'.'
        && !matches!(text.get(end), Some(b'e' | b'E')))
    .then_some(())?;
    let number = (digits as f64 / POWERS[point.map_or(0, |it| end - it - 1)]) as f32;
    Some((if start == 1 { -number } else { number }, end))
}

impl Iterator for Numbers<'_> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        self.skip_spaces();
        let text = self.0;
        if let Some((number, len)) = decimal(text) {
            self.0 = &text[len..];
            self.skip_separator();
            return Some(number);
        }
        let digits = |from: usize| {
            text[from..]
                .iter()
                .take_while(|it| it.is_ascii_digit())
                .count()
        };
        let sign = |at: usize| usize::from(matches!(text.get(at), Some(b'+' | b'-')));
        let mut end = sign(0) + digits(sign(0));
        if text.get(end) == Some(&b'.') {
            end += 1 + Some(digits(end + 1)).filter(|it| *it > 0)?;
        }
        if matches!(text.get(end), Some(b'e' | b'E')) && digits(end + 1 + sign(end + 1)) > 0 {
            end += 1 + sign(end + 1);
            end += digits(end);
        }
        let number = crate::values::text(&text[..end])
            .parse()
            .ok()
            .filter(|it: &f32| it.is_finite())?;
        self.0 = &text[end..];
        self.skip_separator();
        Some(number)
    }
}

/// A command with its arguments, up to the first error.
struct Segments<'a> {
    input: Numbers<'a>,
    command: u8,
}

impl Iterator for Segments<'_> {
    type Item = (u8, [f32; 7]);

    fn next(&mut self) -> Option<Self::Item> {
        self.input.skip_spaces();
        let before = self.input.0;
        match self.input.0.split_first()? {
            (letter, rest)
                if letter.is_ascii_alphabetic()
                    && (self.command != 0 || matches!(letter, b'm' | b'M')) =>
            {
                (self.command, self.input.0) = (*letter, rest);
            }
            _ if matches!(self.command, b'm' | b'M') => self.command -= 1,
            _ if matches!(self.command, 0 | b'z' | b'Z') => return None,
            _ => {}
        }
        let mut arguments = [0.0; 7];
        let is_complete = argument_count(self.command).is_some_and(|count| {
            (0..count).all(|index| {
                let is_flag = count == 7 && matches!(index, 3 | 4);
                (if is_flag {
                    self.input.flag()
                } else {
                    self.input.next()
                })
                .map(|it| arguments[index] = it)
                .is_some()
            })
        });
        if !is_complete {
            self.input.0 = before;
        }
        is_complete.then_some((self.command, arguments))
    }
}

fn argument_count(command: u8) -> Option<usize> {
    Some(match command.to_ascii_lowercase() {
        b'z' => 0,
        b'h' | b'v' => 1,
        b'm' | b'l' | b't' => 2,
        b's' | b'q' => 4,
        b'c' => 6,
        b'a' => 7,
        _ => return None,
    })
}

/// With absolute coordinates.
fn absolute(data: &str, mut visit: impl FnMut(u8, [f32; 7], Point)) -> bool {
    let (mut segments, mut at, mut start) = (
        Segments {
            input: Numbers(data.as_bytes()),
            command: 0,
        },
        [0.0; 2],
        [0.0; 2],
    );
    for (command, mut arguments) in segments.by_ref() {
        let (kind, count) = (
            command.to_ascii_uppercase(),
            argument_count(command).unwrap_or(0),
        );
        if kind != command {
            let first = if kind == b'A' { 5 } else { 0 };
            (first..count).for_each(|it| {
                arguments[it] += at[if kind == b'V' { 1 } else { (it - first) % 2 }]
            });
        }
        visit(kind, arguments, at);
        at = match kind {
            b'Z' => start,
            b'H' => [arguments[0], at[1]],
            b'V' => [at[0], arguments[0]],
            _ => [arguments[count - 2], arguments[count - 1]],
        };
        if kind == b'M' {
            start = at;
        }
    }
    segments.input.0.is_empty()
}

fn write_segment(kind: u8, arguments: &[f32; 7], out: &mut Out) {
    out.extend((!out.is_empty()).then_some(b' ').into_iter().chain([kind]));
    for argument in &arguments[..argument_count(kind).unwrap_or(0)] {
        out.push(b' ');
        write_number(*argument, out);
    }
}

pub(crate) fn normalize(data: &str) -> Option<String> {
    let mut out = Out::new();
    absolute(data, |kind, arguments, _| {
        write_segment(kind, &arguments, &mut out)
    })
    .then(|| crate::values::text(&out).to_owned())
}

/// The sum, if they have the same commands.
pub(crate) fn mix_paths(a: &str, b: &str, of_a: f32, of_b: f32) -> Option<String> {
    let [a, b] = [a, b].map(|data| {
        let mut segments = Vec::new();
        absolute(data, |kind, arguments, _| segments.push((kind, arguments)));
        segments
    });
    (a.len() == b.len() && a.iter().zip(&b).all(|(a, b)| a.0 == b.0)).then_some(())?;
    let mut out = Out::new();
    for ((kind, a), (_, b)) in a.iter().zip(&b) {
        let mut mixed = core::array::from_fn(|it| a[it] * of_a + b[it] * of_b);
        if *kind == b'A' {
            mixed[3..5].copy_from_slice(&(if of_b < 0.5 { a } else { b })[3..5]);
        }
        write_segment(*kind, &mixed, &mut out);
    }
    Some(crate::values::text(&out).to_owned())
}

/// Turns `path()` into `shape()`, if that is what `other` is.
pub(crate) fn as_shape(source: &[u8], other: &[u8]) -> Option<Out> {
    let commands = crate::grammar::split_list(
        &other.strip_prefix(b"shape(")?
            [..strings::last_index_of_char(other, b')')?.checked_sub(6)?],
    );
    let (rule, rest) = strings::split_once_char(source.strip_prefix(b"path(")?, b'"')?;
    let (data, rest) = strings::split_once_char(rest, b'"')?;
    let (mut out, mut index) = (
        [
            b"shape(",
            rule.trim_ascii().strip_suffix(b",").unwrap_or_default(),
            b" from",
        ]
        .concat(),
        0,
    );
    absolute(crate::values::text(data), |kind, a, [x, y]| {
        let is_relative = commands
            .get(index)
            .is_some_and(|it| strings::split(it, b" ").nth(1) == Some(b"by"));
        let ([x, y], to) = if is_relative {
            ([x, y], "by")
        } else {
            ([0.0; 2], "to")
        };
        let point = |at: usize| format!("{}px {}px", a[at] - x, a[at + 1] - y);
        _ = match kind {
            _ if index == 0 => write!(out, " {}", point(0)),
            b'M' => write!(out, ", move {to} {}", point(0)),
            b'L' => write!(out, ", line {to} {}", point(0)),
            b'H' => write!(out, ", hline {to} {}px", a[0] - x),
            b'V' => write!(out, ", vline {to} {}px", a[0] - y),
            b'C' => write!(
                out,
                ", curve {to} {} with {} / {}",
                point(4),
                point(0),
                point(2)
            ),
            b'Q' => write!(out, ", curve {to} {} with {}", point(2), point(0)),
            b'S' => write!(out, ", smooth {to} {} with {}", point(2), point(0)),
            b'T' => write!(out, ", smooth {to} {}", point(0)),
            b'A' => {
                let flags = [
                    ["small", "large"][usize::from(a[3] != 0.0)],
                    ["ccw", "cw"][usize::from(a[4] != 0.0)],
                ];
                write!(
                    out,
                    ", arc {to} {} of {}px {}px {} {} rotate {}deg",
                    point(5),
                    a[0],
                    a[1],
                    flags[0],
                    flags[1],
                    a[2]
                )
            }
            _ => write!(out, ", close"),
        };
        index += 1;
    });
    out.extend_from_slice(rest);
    Some(out)
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct Path {
    pub(crate) verbs: Vec<PathVerb>,
    /// The verbs that end in the middle of an arc.
    in_arcs: Vec<u32>,
}

/// A line that is a part of a path.
pub(crate) struct Piece {
    pub(crate) from: Point,
    pub(crate) to: Point,
    /// The directions of the curve at both ends.
    pub(crate) tangents: Option<[Point; 2]>,
}

impl Piece {
    pub(crate) fn length(&self) -> f32 {
        (self.to[0] - self.from[0]).hypot(self.to[1] - self.from[1])
    }
}

/// Where a marker goes, with the directions in radians.
pub(crate) struct Vertex {
    pub(crate) at: Point,
    pub(crate) incoming: Option<f32>,
    pub(crate) outgoing: Option<f32>,
}

fn cubic_at([a, b, c, d]: [Point; 4], t: f32) -> Point {
    let u = 1.0 - t;
    [0, 1].map(|i| u * u * u * a[i] + 3.0 * u * t * (u * b[i] + t * c[i]) + t * t * t * d[i])
}

const STEPS: usize = 64;

fn halves([a, b, c, d]: [Point; 4]) -> [[Point; 4]; 2] {
    let middle = |a: Point, b: Point| [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let (ab, bc, cd) = (middle(a, b), middle(b, c), middle(c, d));
    let (abc, bcd) = (middle(ab, bc), middle(bc, cd));
    [
        [a, ab, abc, middle(abc, bcd)],
        [middle(abc, bcd), bcd, cd, d],
    ]
}

fn extent(points: &[Point], axis: usize) -> (f32, f32) {
    points.iter().fold((f32::MAX, f32::MIN), |(low, high), it| {
        (low.min(it[axis]), high.max(it[axis]))
    })
}

fn may_be_near(points: &[Point], point: Point, reach: f32) -> bool {
    let (x, y) = (extent(points, 0), extent(points, 1));
    point[0] >= x.0 - reach
        && point[0] <= x.1 + reach
        && point[1] >= y.0 - reach
        && point[1] <= y.1 + reach
}

/// `steps` says which part of the whole curve it is.
fn split_near(
    curve: [Point; 4],
    steps: core::ops::Range<usize>,
    point: Point,
    [near, far]: [f32; 2],
    out: &mut Vec<Piece>,
) {
    if !may_be_near(
        &curve,
        point,
        if steps.start == 0 || steps.end == STEPS {
            far
        } else {
            near
        },
    ) {
        return;
    }
    if steps.len() == 1 {
        return out.push(Piece {
            from: curve[0],
            to: curve[3],
            tangents: None,
        });
    }
    let ([first, second], middle) = (halves(curve), (steps.start + steps.end) / 2);
    split_near(first, steps.start..middle, point, [near, far], out);
    split_near(second, middle..steps.end, point, [near, far], out);
}

/// What a ray from a point to the right crosses.
struct Ray {
    from: Point,
    winding: i32,
    touches: bool,
}

impl Ray {
    const TOUCHING: f32 = 1e-4;

    fn line(&mut self, from: Point, to: Point) {
        let [x, y] = self.from;
        if (from[1] <= y) != (to[1] <= y)
            && x < from[0] + (y - from[1]) / (to[1] - from[1]) * (to[0] - from[0])
        {
            self.winding += if to[1] > from[1] { 1 } else { -1 };
        }
        self.touches |= may_be_near(&[from, to], self.from, Ray::TOUCHING)
            && distance(
                &Piece {
                    from,
                    to,
                    tangents: None,
                },
                self.from,
            ) < Ray::TOUCHING;
    }

    fn curve(&mut self, curve: [Point; 4], steps: usize) {
        let ([x, y], (left, right), (top, bottom)) =
            (self.from, extent(&curve, 0), extent(&curve, 1));
        if y < top - Ray::TOUCHING || y > bottom + Ray::TOUCHING || x > right + Ray::TOUCHING {
            return;
        }
        if steps == 1 || x < left - Ray::TOUCHING {
            return self.line(curve[0], curve[3]);
        }
        halves(curve)
            .into_iter()
            .for_each(|it| self.curve(it, steps / 2));
    }
}

impl From<&[PathVerb]> for Path {
    fn from(verbs: &[PathVerb]) -> Path {
        Path {
            verbs: verbs.to_vec(),
            in_arcs: Vec::new(),
        }
    }
}

impl Path {
    pub(crate) fn parse(data: &str) -> Path {
        let (mut path, mut control, mut previous, mut start) =
            (Path::default(), [0.0; 2], 0, [0.0; 2]);
        absolute(data, |kind, [a, b, c, d, e, f, g], at| {
            if previous == b'Z' && kind != b'M' {
                path.verbs.push(PathVerb::Move(start));
            }
            let reflected = |after: [u8; 2]| match after.contains(&previous) {
                true => [2.0 * at[0] - control[0], 2.0 * at[1] - control[1]],
                false => at,
            };
            match kind {
                b'M' => {
                    start = [a, b];
                    path.verbs.push(PathVerb::Move(start));
                }
                b'Z' => path.verbs.push(PathVerb::Close),
                b'L' => path.verbs.push(PathVerb::Line([a, b])),
                b'H' => path.verbs.push(PathVerb::Line([a, at[1]])),
                b'V' => path.verbs.push(PathVerb::Line([at[0], a])),
                b'C' | b'S' => {
                    let [first, second, to] = if kind == b'C' {
                        [[a, b], [c, d], [e, f]]
                    } else {
                        [reflected(*b"CS"), [a, b], [c, d]]
                    };
                    path.verbs.push(PathVerb::Cubic(first, second, to));
                    control = second;
                }
                b'Q' | b'T' => {
                    let [middle, to] = if kind == b'Q' {
                        [[a, b], [c, d]]
                    } else {
                        [reflected(*b"QT"), [a, b]]
                    };
                    path.quadratic(at, middle, to);
                    control = middle;
                }
                _ => path.arc(at, [a, b], c, d != 0.0, e != 0.0, [f, g]),
            }
            previous = kind;
        });
        path
    }

    pub(crate) fn polygon(points: impl IntoIterator<Item = Point>, is_closed: bool) -> Path {
        let verb = |(index, point)| {
            if index == 0 {
                PathVerb::Move(point)
            } else {
                PathVerb::Line(point)
            }
        };
        let mut verbs: Vec<_> = points.into_iter().enumerate().map(verb).collect();
        verbs.extend((is_closed && !verbs.is_empty()).then_some(PathVerb::Close));
        Path {
            verbs,
            in_arcs: Vec::new(),
        }
    }

    pub(crate) fn rect(rect: Rect) -> Path {
        Path::polygon(
            [
                [rect.x, rect.y],
                [rect.right(), rect.y],
                [rect.right(), rect.bottom()],
                [rect.x, rect.bottom()],
            ],
            true,
        )
    }

    pub(crate) fn rounded_rect(shape: &RoundedRect) -> Path {
        if shape.smoothing > 0.0 {
            let corners = shape.smooth_corners();
            let curves = |it: &[Point; 10]| {
                [
                    PathVerb::Line(it[0]),
                    PathVerb::Cubic(it[1], it[2], it[3]),
                    PathVerb::Cubic(it[4], it[5], it[6]),
                    PathVerb::Cubic(it[7], it[8], it[9]),
                ]
            };
            let verbs = [PathVerb::Move(corners[0][0])]
                .into_iter()
                .chain(corners.iter().flat_map(curves).skip(1))
                .chain([PathVerb::Close]);
            return Path::from(&verbs.collect::<Vec<_>>()[..]);
        }
        let (rect, [a, b, c, d]) = (shape.rect, shape.radii);
        let (left, top, right, bottom) = (rect.x, rect.y, rect.right(), rect.bottom());
        let mut path = Path::polygon([[left + a[0], top]], false);
        for (from, corner, to) in [
            ([right - b[0], top], [right, top], [right, top + b[1]]),
            (
                [right, bottom - c[1]],
                [right, bottom],
                [right - c[0], bottom],
            ),
            ([left + d[0], bottom], [left, bottom], [left, bottom - d[1]]),
            ([left, top + a[1]], [left, top], [left + a[0], top]),
        ] {
            path.verbs.push(PathVerb::Line(from));
            if from != to {
                path.quarter(from, corner, to);
            }
        }
        path.verbs.push(PathVerb::Close);
        path
    }

    pub(crate) fn ellipse([x, y]: Point, [rx, ry]: [f32; 2]) -> Path {
        let ends = [[x + rx, y], [x, y + ry], [x - rx, y], [x, y - ry]];
        let corners = [
            [x + rx, y + ry],
            [x - rx, y + ry],
            [x - rx, y - ry],
            [x + rx, y - ry],
        ];
        let mut path = Path::polygon([ends[0]], false);
        (0..4).for_each(|it| path.quarter(ends[it], corners[it], ends[(it + 1) % 4]));
        path.verbs.push(PathVerb::Close);
        path
    }

    fn quarter(&mut self, from: Point, corner: Point, to: Point) {
        let handle = |end: Point| [0, 1].map(|axis| mix(end[axis], corner[axis], 0.552_284_8));
        self.verbs
            .push(PathVerb::Cubic(handle(from), handle(to), to));
    }

    pub(crate) fn quadratic(&mut self, from: Point, middle: Point, to: Point) {
        let handle = |end: Point| [0, 1].map(|axis| mix(end[axis], middle[axis], 2.0 / 3.0));
        self.verbs
            .push(PathVerb::Cubic(handle(from), handle(to), to));
    }

    pub(crate) fn arc(
        &mut self,
        from: Point,
        [rx, ry]: [f32; 2],
        degrees: f32,
        large: bool,
        sweep: bool,
        to: Point,
    ) {
        let (mut rx, mut ry, (sin, cos)) = (rx.abs(), ry.abs(), degrees.to_radians().sin_cos());
        if rx == 0.0 || ry == 0.0 || from == to {
            return self.verbs.push(PathVerb::Line(to));
        }
        let [dx, dy] = [(from[0] - to[0]) / 2.0, (from[1] - to[1]) / 2.0];
        let [x, y] = [cos * dx + sin * dy, cos * dy - sin * dx];
        let excess = ((x / rx).powi(2) + (y / ry).powi(2)).sqrt().max(1.0);
        (rx, ry) = (rx * excess, ry * excess);
        let part = (rx * y).powi(2) + (ry * x).powi(2);
        let factor = (((rx * ry).powi(2) - part) / part).max(0.0).sqrt()
            * if large == sweep { -1.0 } else { 1.0 };
        let [cx, cy] = [factor * rx * y / ry, -factor * ry * x / rx];
        let center = [
            cos * cx - sin * cy + (from[0] + to[0]) / 2.0,
            sin * cx + cos * cy + (from[1] + to[1]) / 2.0,
        ];
        let start = ((y - cy) / ry).atan2((x - cx) / rx);
        let delta = (((-y - cy) / ry).atan2((-x - cx) / rx) - start).rem_euclid(TAU)
            - if sweep { 0.0 } else { TAU };
        let count = (delta.abs() / FRAC_PI_2 - 0.001).ceil().clamp(1.0, 4.0);
        let (step, place) = (
            delta / count,
            [
                rx * cos,
                rx * sin,
                -ry * sin,
                ry * cos,
                center[0],
                center[1],
            ],
        );
        let handle = 4.0 / 3.0 * (step / 4.0).tan();
        for index in 0..count as usize {
            let ((s0, c0), (s1, c1)) = (
                (start + step * index as f32).sin_cos(),
                (start + step * (index + 1) as f32).sin_cos(),
            );
            let [a, b, c] = [
                [c0 - handle * s0, s0 + handle * c0],
                [c1 + handle * s1, s1 - handle * c1],
                [c1, s1],
            ]
            .map(|it| apply(&place, it));
            let is_last = index + 1 == count as usize;
            self.in_arcs
                .extend((!is_last).then_some(self.verbs.len() as u32));
            self.verbs
                .push(PathVerb::Cubic(a, b, if is_last { to } else { c }));
        }
    }

    pub(crate) fn transformed(mut self, matrix: &Matrix) -> Path {
        for verb in &mut self.verbs {
            match verb {
                PathVerb::Move(point) | PathVerb::Line(point) => *point = apply(matrix, *point),
                PathVerb::Cubic(a, b, c) => [a, b, c]
                    .into_iter()
                    .for_each(|it| *it = apply(matrix, *it)),
                PathVerb::Close => {}
            }
        }
        self
    }

    /// Each verb with where it starts and where it ends.
    fn steps(&self) -> impl Iterator<Item = (Point, PathVerb, Point)> + '_ {
        self.verbs
            .iter()
            .scan(([0.0; 2], [0.0; 2]), |(at, start), verb| {
                let to = match *verb {
                    PathVerb::Move(to) => {
                        *start = to;
                        to
                    }
                    PathVerb::Line(to) | PathVerb::Cubic(_, _, to) => to,
                    PathVerb::Close => *start,
                };
                Some((core::mem::replace(at, to), *verb, to))
            })
    }

    pub(crate) fn as_rect(&self) -> Option<Rect> {
        use PathVerb::{Close, Line, Move};
        let [Move(a), Line(b), Line(c), Line(d), Close] = self.verbs[..] else {
            return None;
        };
        let is_rect = (a[1], b[0], c[1], d[0]) == (b[1], c[0], d[1], a[0])
            || (a[0], b[1], c[0], d[1]) == (b[0], c[1], d[0], a[1]);
        is_rect.then(|| {
            Rect::from_edges(
                a[0].min(c[0]),
                a[1].min(c[1]),
                a[0].max(c[0]),
                a[1].max(c[1]),
            )
        })
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.verbs.last() == Some(&PathVerb::Close)
    }

    pub(crate) fn pieces(&self) -> Vec<Piece> {
        let mut pieces = Vec::new();
        for (from, verb, to) in self.steps() {
            match verb {
                PathVerb::Move(_) => {}
                PathVerb::Line(_) | PathVerb::Close => pieces.push(Piece {
                    from,
                    to,
                    tangents: None,
                }),
                PathVerb::Cubic(a, b, _) => {
                    let at = |step: usize| cubic_at([from, a, b, to], step as f32 / STEPS as f32);
                    let tangent = |step: usize| {
                        let (t, u) = (step as f32 / STEPS as f32, 1.0 - step as f32 / STEPS as f32);
                        [0, 1].map(|i| {
                            u * u * (a[i] - from[i])
                                + 2.0 * u * t * (b[i] - a[i])
                                + t * t * (to[i] - b[i])
                        })
                    };
                    let tangents = |step| {
                        Some([tangent(step), tangent(step + 1)])
                            .filter(|it| !it.contains(&[0.0; 2]))
                    };
                    pieces.extend((0..STEPS).map(|step| Piece {
                        from: at(step),
                        to: at(step + 1),
                        tangents: tangents(step),
                    }));
                }
            }
        }
        pieces
    }

    /// Without those that are more than `near` away, or `far` where segments meet.
    pub(crate) fn pieces_near(&self, point: Point, near: f32, far: f32) -> Vec<Piece> {
        let mut pieces = Vec::new();
        for (from, verb, to) in self.steps() {
            match verb {
                PathVerb::Move(_) => {}
                PathVerb::Line(_) | PathVerb::Close => {
                    pieces.extend(may_be_near(&[from, to], point, far).then_some(Piece {
                        from,
                        to,
                        tangents: None,
                    }))
                }
                PathVerb::Cubic(a, b, _) => {
                    split_near([from, a, b, to], 0..STEPS, point, [near, far], &mut pieces)
                }
            }
        }
        pieces
    }

    pub(crate) fn length(&self) -> f32 {
        self.pieces()
            .iter()
            .map(|it| f64::from(it.length()))
            .sum::<f64>() as f32
            + 0.0
    }

    /// How far it is to the end of each segment.
    pub(crate) fn end_of_verb(&self, index: usize) -> Option<Point> {
        self.steps().nth(index).map(|it| it.2)
    }

    pub(crate) fn start(&self) -> Option<Point> {
        self.steps().next().map(|it| it.2)
    }

    pub(crate) fn bounds(&self) -> Option<Rect> {
        let (mut low, mut high) = ([f32::MAX; 2], [f32::MIN; 2]);
        let mut add = |point: Point| {
            (low, high) = (
                [0, 1].map(|it| low[it].min(point[it])),
                [0, 1].map(|it| high[it].max(point[it])),
            )
        };
        let draws = self.verbs.iter().any(|it| !matches!(it, PathVerb::Move(_)));
        let moved_on = if draws {
            0
        } else {
            self.verbs.len().saturating_sub(1)
        };
        for (from, verb, to) in self
            .steps()
            .skip(moved_on)
            .filter(|it| !draws || !matches!(it.1, PathVerb::Move(_)))
        {
            add(if draws { from } else { to });
            add(to);
            let PathVerb::Cubic(b, c, _) = verb else {
                continue;
            };
            let is_between =
                |axis: usize, it: Point| (it[axis] - from[axis]) * (it[axis] - to[axis]) <= 0.0;
            for axis in (0..2).filter(|it| !is_between(*it, b) || !is_between(*it, c)) {
                let [p, q, r] = [b[axis] - from[axis], c[axis] - b[axis], to[axis] - c[axis]];
                let (a, b2) = (p - 2.0 * q + r, q - p);
                let root = (b2 * b2 - a * p).sqrt();
                let roots = if a.abs() < 1e-6 * (p.abs() + q.abs() + r.abs()) {
                    [-p / (2.0 * b2); 2]
                } else {
                    [(-b2 + root) / a, (-b2 - root) / a]
                };
                roots
                    .into_iter()
                    .filter(|t| *t > 0.0 && *t < 1.0)
                    .for_each(|t| add(cubic_at([from, b, c, to], t)));
            }
        }
        (low[0] <= high[0]).then(|| Rect::from_edges(low[0], low[1], high[0], high[1]))
    }

    pub(crate) fn contains(&self, point: Point, is_even_odd: bool) -> bool {
        let (mut ray, mut open) = (
            Ray {
                from: point,
                winding: 0,
                touches: false,
            },
            None,
        );
        for (from, verb, to) in self.steps() {
            match verb {
                PathVerb::Move(_) => open
                    .replace((to, to))
                    .into_iter()
                    .for_each(|(start, at)| ray.line(at, start)),
                PathVerb::Line(_) | PathVerb::Close => ray.line(from, to),
                PathVerb::Cubic(a, b, _) => ray.curve([from, a, b, to], STEPS),
            }
            open.get_or_insert((from, to)).1 = to;
        }
        open.into_iter().for_each(|(start, at)| ray.line(at, start));
        ray.touches
            || if is_even_odd {
                ray.winding % 2 != 0
            } else {
                ray.winding != 0
            }
    }

    /// Like the renderer, with round joins.
    pub(crate) fn covers(&self, outline: &crate::abi::Outline, point: Point) -> bool {
        let reach = outline.stroke.width / 2.0;
        let is_near = || {
            self.pieces_near(point, reach, reach)
                .iter()
                .any(|it| distance(it, point) <= reach)
        };
        match outline.how {
            crate::abi::OUTLINE_WITH_STROKE => self.contains(point, outline.even_odd) || is_near(),
            crate::abi::OUTLINE_WITHOUT_STROKE => {
                self.contains(point, outline.even_odd) && !is_near()
            }
            _ => self.contains(point, outline.even_odd),
        }
    }

    /// For a polygon: at the leftmost of the points that are at the top.
    pub(crate) fn starting_at_top(&self) -> Path {
        let mut points: Vec<_> = self.steps().map(|it| it.2).collect();
        let first = (0..points.len()).min_by(|a, b| {
            points[*a][1]
                .total_cmp(&points[*b][1])
                .then(points[*a][0].total_cmp(&points[*b][0]))
        });
        points.rotate_left(first.unwrap_or(0));
        Path::polygon(points, true)
    }

    pub(crate) fn has_corners(&self) -> bool {
        self.verbs.iter().any(|it| matches!(it, PathVerb::Line(_)))
    }

    pub(crate) fn vertices(&self) -> Vec<Vertex> {
        let direction = |points: [Point; 4]| {
            let other = points[1..].iter().find(|it| **it != points[0])?;
            Some((other[1] - points[0][1]).atan2(other[0] - points[0][0]))
        };
        let (mut vertices, mut first, mut was_in_arc, mut was_closed) =
            (Vec::<Vertex>::new(), 0, false, false);
        for (index, (from, verb, to)) in self.steps().enumerate() {
            let [a, b] = if let PathVerb::Cubic(a, b, _) = verb {
                [a, b]
            } else {
                [to, from]
            };
            if let PathVerb::Move(_) = verb {
                if !(was_closed && from == to) {
                    vertices.push(Vertex {
                        at: to,
                        incoming: None,
                        outgoing: None,
                    });
                }
                (first, was_closed) = (vertices.len() - 1, false);
                continue;
            }
            let incoming = direction([to, b, a, from]).map(|it| it + TAU / 2.0);
            if let Some(last) = vertices.last_mut().filter(|_| !was_in_arc) {
                last.outgoing = direction([from, a, b, to]);
            }
            (was_in_arc, was_closed) = (
                self.in_arcs.binary_search(&(index as u32)).is_ok(),
                verb == PathVerb::Close,
            );
            if !was_in_arc {
                let incoming = incoming.or_else(|| vertices.last()?.incoming);
                vertices.push(Vertex {
                    at: to,
                    incoming,
                    outgoing: if was_closed {
                        vertices[first].outgoing
                    } else {
                        None
                    },
                });
                if was_closed && vertices[first].incoming.is_none() {
                    vertices[first].incoming = incoming;
                }
            }
        }
        vertices
    }
}

pub(crate) fn distance(piece: &Piece, [x, y]: Point) -> f32 {
    let (from, [dx, dy]) = (
        piece.from,
        [piece.to[0] - piece.from[0], piece.to[1] - piece.from[1]],
    );
    let t = (((x - from[0]) * dx + (y - from[1]) * dy) / (dx * dx + dy * dy).max(1e-12))
        .clamp(0.0, 1.0);
    (x - from[0] - t * dx).hypot(y - from[1] - t * dy)
}

/// The point, and the direction in radians.
pub(crate) fn at_distance(pieces: &[Piece], distance: f32) -> Option<(Point, f32)> {
    let mut rest = f64::from(distance.max(0.0));
    let mut drawn = pieces.iter().filter(|it| it.from != it.to).peekable();
    while let Some(piece) = drawn.next() {
        let length = f64::from(piece.length());
        if rest <= length || drawn.peek().is_none() {
            let between = |[from, to]: [Point; 2]| {
                [0, 1].map(|axis| mix(from[axis], to[axis], (rest / length).min(1.0) as f32))
            };
            let [x, y] = piece.tangents.map_or_else(
                || [0, 1].map(|axis| piece.to[axis] - piece.from[axis]),
                between,
            );
            return Some((between([piece.from, piece.to]), y.atan2(x)));
        }
        rest -= length;
    }
    pieces.first().map(|it| (it.from, 0.0))
}
