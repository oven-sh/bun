//! The outline of a stroke, which is then filled.
//!
//! Derived from `SkStroke`, `SkDash` and `SkContourMeasure` in Skia, and their port in tiny-skia.
//! Copyright (c) 2011 Google Inc., (c) 2020 Yevhenii Reizner. BSD 3-Clause, see `licenses/skia.txt`.

use std::f32::consts::{FRAC_1_SQRT_2, SQRT_2};

use super::{Command, Path, PathBuilder as _, Point, Transform};

const NEARLY_ZERO: f32 = 1. / 4096.;
const MAX_PIECES: usize = 1 << 20;

#[derive(Clone, Copy, PartialEq)]
pub enum Cap {
    Butt,
    Round,
    Square,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Join {
    Miter,
    Round,
    Bevel,
}

#[derive(Clone, Copy)]
pub struct Stroke<'a> {
    pub width: f32,
    pub cap: Cap,
    pub join: Join,
    pub miter_limit: f32,
    /// An even number of them.
    pub dashes: &'a [f32],
    pub dash_offset: f32,
}

#[derive(Clone, Copy)]
enum Segment {
    Line([Point; 2]),
    Quad([Point; 3]),
    Cubic([Point; 4]),
}

impl Segment {
    fn points(&self) -> &[Point] {
        match self {
            Segment::Line(points) => points,
            Segment::Quad(points) => points,
            Segment::Cubic(points) => points,
        }
    }

    fn end(&self) -> Point {
        self.points()[self.points().len() - 1]
    }

    /// The last control point of the part between the start and `t`, the point at `t`, and the first one after it.
    fn around(&self, t: f32) -> [Point; 3] {
        let (before, after) = match *self {
            Segment::Line([a, b]) => (a, b),
            Segment::Quad([a, b, c]) => (a.lerp(b, t), b.lerp(c, t)),
            Segment::Cubic([a, b, c, d]) => (
                a.lerp(b, t).lerp(b.lerp(c, t), t),
                b.lerp(c, t).lerp(c.lerp(d, t), t),
            ),
        };
        [
            before,
            if t == 1. {
                after
            } else {
                before.lerp(after, t)
            },
            after,
        ]
    }

    fn split(&self, t: f32) -> (Segment, Segment) {
        let [before, middle, after] = self.around(t);
        match *self {
            Segment::Line([a, b]) => (Segment::Line([a, middle]), Segment::Line([middle, b])),
            Segment::Quad([a, _, c]) => (
                Segment::Quad([a, before, middle]),
                Segment::Quad([middle, after, c]),
            ),
            Segment::Cubic([a, b, c, d]) => (
                Segment::Cubic([a, a.lerp(b, t), before, middle]),
                Segment::Cubic([middle, after, c.lerp(d, t), d]),
            ),
        }
    }

    fn part(&self, from: f32, to: f32) -> Command {
        if from == to || matches!(self, Segment::Line(_)) {
            return Command::LineTo(self.around(to)[1]);
        }
        let rest = if from > 0. { self.split(from).1 } else { *self };
        match if to < 1. {
            rest.split((to - from) / (1. - from)).0
        } else {
            rest
        } {
            Segment::Line([_, to]) => Command::LineTo(to),
            Segment::Quad([_, a, to]) => Command::QuadTo(a, to),
            Segment::Cubic([_, a, b, to]) => Command::CurveTo(a, b, to),
        }
    }

    fn direction(&self, t: f32) -> Point {
        let ([before, _, after], points) = (self.around(t), self.points());
        let (first, last) = (points[0], self.end());
        let near = match t {
            _ if before != after => None,
            0. => points.iter().find(|it| **it != first).map(|it| *it - first),
            1. => points.iter().rfind(|it| **it != last).map(|it| last - *it),
            // At a cusp.
            _ => self
                .split(t)
                .0
                .points()
                .iter()
                .rfind(|it| **it != before)
                .map(|it| before - *it),
        };
        near.unwrap_or(after - before)
    }
}

struct Contour {
    start: Point,
    segments: Vec<Segment>,
    is_closed: bool,
}

fn contours(path: &[Command], mut take: impl FnMut(&Contour)) {
    let mut contour = Contour {
        start: Point::ZERO,
        segments: Vec::new(),
        is_closed: false,
    };
    let mut has_moved = false;
    for command in path.iter().chain([&Command::MoveTo(Point::ZERO)]) {
        let at = contour.segments.last().map_or(contour.start, Segment::end);
        match *command {
            Command::LineTo(to) => contour.segments.push(Segment::Line([at, to])),
            Command::QuadTo(a, to) => contour.segments.push(Segment::Quad([at, a, to])),
            Command::CurveTo(a, b, to) => contour.segments.push(Segment::Cubic([at, a, b, to])),
            Command::MoveTo(_) | Command::Close => {
                contour.is_closed = *command == Command::Close;
                if contour.is_closed
                    && (at != contour.start || has_moved && contour.segments.is_empty())
                {
                    contour.segments.push(Segment::Line([at, contour.start]));
                }
                if !contour.segments.is_empty() {
                    take(&contour);
                }
                contour.segments.clear();
                has_moved = !contour.is_closed;
                if let Command::MoveTo(to) = *command {
                    contour.start = to;
                }
            }
        }
    }
}

/// What a path has to touch for its stroke to show, after `matrix`.
struct Window<'a> {
    matrix: &'a Transform,
    low: Point,
    high: Point,
}

impl Window<'_> {
    fn may_touch(&self, points: &[Point]) -> bool {
        let sides = |it: Point| {
            u8::from(it.x < self.low.x)
                | u8::from(it.x > self.high.x) << 1
                | u8::from(it.y < self.low.y) << 2
                | u8::from(it.y > self.high.y) << 3
        };
        points
            .iter()
            .fold(15, |all, it| all & sides(self.matrix.map(*it)))
            == 0
    }

    /// From where to where between 0 and 1 the line is inside, if that is ascending.
    fn clip(&self, line: [Point; 2]) -> [f32; 2] {
        let [a, b] = line.map(|it| self.matrix.map(it));
        [
            (a.x, b.x, self.low.x, self.high.x),
            (a.y, b.y, self.low.y, self.high.y),
        ]
        .into_iter()
        .fold([0., 1.], |[from, to], (a, b, low, high)| {
            let (first, second) = ((low - a) / (b - a), (high - a) / (b - a));
            [from.max(first.min(second)), to.min(first.max(second))]
        })
    }

    /// The contour without the segments that do not show, and are not joined to one that does.
    fn parts(&self, contour: &Contour, mut take: impl FnMut(&Contour)) {
        let (all, count) = (&contour.segments, contour.segments.len());
        let shows = |index: usize| {
            (contour.is_closed || (count..count * 2).contains(&index))
                && self.may_touch(all[index % count].points())
        };
        let is_needed = |index: usize| {
            shows(index + count) || shows(index + count - 1) || shows(index + count + 1)
        };
        let Some(far) = (0..count).find(|it| !is_needed(*it)) else {
            return take(contour);
        };
        let first = if contour.is_closed { far } else { 0 };
        let mut part = Contour {
            start: contour.start,
            segments: Vec::new(),
            is_closed: false,
        };
        for index in (first..count).chain(0..first).map(Some).chain([None]) {
            match index.filter(|it| is_needed(*it)) {
                Some(index) => part.segments.push(all[index]),
                None if part.segments.is_empty() => {}
                None => {
                    part.start = part.segments[0].points()[0];
                    take(&part);
                    part.segments.clear();
                }
            }
        }
    }

    /// From where to where along the contour it shows.
    fn stretches(&self, contour: &Contour, marks: &[Mark]) -> Vec<[f32; 2]> {
        let (mut stretches, mut start) = (Vec::<[f32; 2]>::new(), 0.);
        for marks in marks.chunk_by(|a, b| a.segment == b.segment) {
            let (segment, end) = (
                contour.segments[marks[0].segment],
                marks[marks.len() - 1].distance,
            );
            let [from, to] = match segment {
                _ if !self.may_touch(segment.points()) => [1., 0.],
                Segment::Line(line) => self.clip(line),
                _ => [0., 1.],
            };
            if from <= to {
                let [from, to] = [
                    start + (end - start) * from,
                    if to < 1. {
                        start + (end - start) * to
                    } else {
                        end
                    },
                ];
                match stretches.last_mut() {
                    Some(last) if last[1] >= from => last[1] = to,
                    _ => stretches.push([from, to]),
                }
            }
            start = end;
        }
        stretches
    }
}

fn distance(a: Point, b: Point) -> f32 {
    (a - b).dot(a - b).sqrt()
}

/// How far along the contour it is at `t` of a segment.
struct Mark {
    distance: f32,
    segment: usize,
    t: f32,
}

fn measure(contour: &Contour, tolerance: f32) -> Vec<Mark> {
    fn add(
        part: Segment,
        [from, to]: [f32; 2],
        segment: usize,
        tolerance: f32,
        marks: &mut Vec<Mark>,
    ) {
        let is_far = |a: Point, b: Point| (a.x - b.x).abs().max((a.y - b.y).abs()) > tolerance;
        let is_curved = match part {
            Segment::Line(_) => false,
            Segment::Quad([a, b, c]) => is_far(b * 0.5, (a + c) * 0.25),
            Segment::Cubic([a, b, c, d]) => {
                is_far(b, a.lerp(d, 1. / 3.)) || is_far(c, a.lerp(d, 2. / 3.))
            }
        };
        if is_curved && to - from > 1. / 1024. && marks.len() < MAX_PIECES {
            let ((first, second), middle) = (part.split(0.5), (from + to) / 2.);
            add(first, [from, middle], segment, tolerance, marks);
            return add(second, [middle, to], segment, tolerance, marks);
        }
        let before = marks.last().map_or(0., |it| it.distance);
        let distance = before + distance(part.points()[0], part.end());
        if distance > before {
            marks.push(Mark {
                distance,
                segment,
                t: to,
            });
        }
    }
    let mut marks = Vec::new();
    contour
        .segments
        .iter()
        .enumerate()
        .for_each(|(index, it)| add(*it, [0., 1.], index, tolerance, &mut marks));
    marks
}

pub fn length(path: &[Command]) -> f32 {
    let mut total = 0.;
    contours(path, |contour| {
        total += measure(contour, 0.01).last().map_or(0., |it| it.distance)
    });
    total
}

fn add_between(
    contour: &Contour,
    marks: &[Mark],
    [from, to]: [f32; 2],
    moves: bool,
    path: &mut Path,
) {
    let locate = |distance: f32| {
        let index = marks
            .partition_point(|it| it.distance < distance)
            .min(marks.len() - 1);
        let (mark, before) = (&marks[index], index.checked_sub(1).map(|it| &marks[it]));
        let (start, t) = (
            before.map_or(0., |it| it.distance),
            before
                .filter(|it| it.segment == mark.segment)
                .map_or(0., |it| it.t),
        );
        (
            mark.segment,
            (t + (mark.t - t) * (distance - start) / (mark.distance - start)).min(1.),
        )
    };
    let ((first, from), (last, to)) = (locate(from), locate(to));
    if moves {
        path.move_to(contour.segments[first].around(from)[1]);
    }
    for (index, segment) in (first..=last).zip(&contour.segments[first..]) {
        path.push(segment.part(
            if index == first { from } else { 0. },
            if index == last { to } else { 1. },
        ));
    }
}

/// `None` if there are too many.
fn dashed(
    path: &[Command],
    dashes: &[f32],
    offset: f32,
    resolution: f32,
    window: &Window,
) -> Option<Path> {
    let period: f32 = dashes.iter().sum();
    let (mut first, mut phase) = (0, offset.rem_euclid(period));
    while first < dashes.len() && (phase > dashes[first] || phase == dashes[first] && phase != 0.) {
        (first, phase) = (first + 1, phase - dashes[first]);
    }
    let (first, first_length) = dashes
        .get(first)
        .map_or((0, dashes[0]), |it| (first, it - phase));
    let (mut result, mut count, whole) = (
        Path::new(),
        0.,
        dashes.iter().copied().map(f64::from).sum::<f64>(),
    );
    contours(path, |contour| {
        let marks = measure(contour, 0.5 / resolution);
        let Some(length) = marks.last().map(|it| it.distance) else {
            return;
        };
        let stretches = window.stretches(contour, &marks);
        count += stretches
            .iter()
            .map(|[from, to]| ((to - from) / period + 2.) * (dashes.len() / 2) as f32)
            .sum::<f32>();
        if f64::from(length) * dashes.len() as f64 > whole * 1e12 {
            count = f32::INFINITY;
        }
        if count.is_nan() || count > MAX_PIECES as f32 {
            return;
        }
        let (mut at, mut dash, mut index, mut is_at_end) =
            (0., f64::from(first_length), first, false);
        for [from, to] in stretches.iter().map(|it| it.map(f64::from)) {
            while at < f64::from(length) && at <= to {
                let (is_first, skipped) =
                    (at == 0. && index == first, ((from - at) / whole).floor());
                if !is_first && skipped >= 1. {
                    at += skipped * whole;
                }
                is_at_end = index % 2 == 0 && !(contour.is_closed && is_first) && at + dash >= from;
                if is_at_end {
                    add_between(
                        contour,
                        &marks,
                        [at as f32, ((at + dash) as f32).min(length)],
                        true,
                        &mut result,
                    );
                }
                (at, index) = (at + dash, (index + 1) % dashes.len());
                dash = dashes[index].into();
            }
        }
        if contour.is_closed && first % 2 == 0 {
            add_between(
                contour,
                &marks,
                [0., first_length.min(length)],
                !is_at_end || at < f64::from(length),
                &mut result,
            );
        }
    });
    (count <= MAX_PIECES as f32).then_some(result)
}

fn end_of(path: &[Command]) -> Point {
    match path.last() {
        Some(
            &(Command::MoveTo(to)
            | Command::LineTo(to)
            | Command::QuadTo(_, to)
            | Command::CurveTo(.., to)),
        ) => to,
        _ => Point::ZERO,
    }
}

fn replace_end(path: &mut Path, to: Point) {
    match path.last_mut() {
        Some(Command::MoveTo(end) | Command::LineTo(end)) => *end = to,
        _ => path.push(Command::LineTo(to)),
    }
}

/// An arc of at most a quarter of a circle.
fn conic_to(path: &mut Path, control: Point, to: Point, weight: f32) {
    fn halve(path: &mut Path, [a, b, c]: [Point; 3], weight: f32, times: u32) {
        if times == 0 {
            return path.push(Command::QuadTo(b, c));
        }
        let (scale, next) = (1. / (1. + weight), (0.5 + weight * 0.5).sqrt());
        let middle = (a + b * (weight * 2.) + c) * (scale * 0.5);
        halve(path, [a, (a + b * weight) * scale, middle], next, times - 1);
        halve(path, [middle, (b * weight + c) * scale, c], next, times - 1);
    }
    let from = end_of(path);
    let error = distance(from + to, control * 2.) * (1. - weight) / (4. * (1. + weight));
    let times = (1..5)
        .find(|it| error <= 0.25 * (1 << (it * 2)) as f32)
        .unwrap_or(5);
    halve(path, [from, control, to], weight, times);
}

fn unit(vector: Point) -> Option<Point> {
    let length = f64::from(vector.x).hypot(vector.y.into());
    let unit = Point::new(
        (f64::from(vector.x) / length) as f32,
        (f64::from(vector.y) / length) as f32,
    );
    (unit.x.is_finite() && unit.y.is_finite() && unit != Point::ZERO).then_some(unit)
}

/// Where between 0 and 1 `a t² + b t + c` is zero, ascending.
fn roots(a: f32, b: f32, c: f32) -> impl Iterator<Item = f32> {
    let q = -0.5
        * (b + ((f64::from(b).powi(2) - 4. * f64::from(a) * f64::from(c)).sqrt() as f32)
            .copysign(b));
    let (first, second) = (q / a, c / q);
    let both = if first > second {
        [second, first]
    } else {
        [first, if first == second { f32::NAN } else { second }]
    };
    both.into_iter().filter(|it| *it > 0. && *it < 1.)
}

struct Stroker {
    radius: f32,
    cap: Cap,
    join: Join,
    least_sine: f32,
    tolerance: f32,
    /// To the left and to the right of the contour.
    sides: [Path; 2],
    pieces_left: usize,
}

/// Where a segment starts or ends.
#[derive(Clone, Copy)]
struct End {
    at: Point,
    normal: Point,
    is_line: bool,
}

impl Stroker {
    fn join(&mut self, join: Join, before: End, after: End) {
        let join = if join == Join::Round && self.pieces_left == 0 {
            Join::Bevel
        } else {
            join
        };
        let (dot, pivot) = (before.normal.dot(after.normal), after.at);
        if join != Join::Bevel && 1. - dot <= NEARLY_ZERO {
            return;
        }
        let turns_around = join == Join::Miter && 1. + dot <= NEARLY_ZERO;
        let sign = if turns_around || before.normal.cross(after.normal) > 0. {
            1.
        } else {
            -1.
        };
        let (from, to, [left, right]) =
            (before.normal * sign, after.normal * sign, &mut self.sides);
        let (outer, inner) = if sign > 0. {
            (left, right)
        } else {
            (right, left)
        };
        let (sine, mut is_at_end) = (((1. + dot) / 2.).sqrt(), false);
        match join {
            Join::Round => {
                let (mut from, turn, count) = (
                    from,
                    |it: Point| Point::new(-it.y, it.x) * sign,
                    outer.len(),
                );
                while from.dot(to) < NEARLY_ZERO {
                    conic_to(
                        outer,
                        pivot + (from + turn(from)) * self.radius,
                        pivot + turn(from) * self.radius,
                        FRAC_1_SQRT_2,
                    );
                    from = turn(from);
                }
                let cosine = from.dot(to).min(1.);
                if distance(from, to) > NEARLY_ZERO && from.cross(to) * sign > 0. {
                    let control = (from + to) * (self.radius / (1. + cosine));
                    conic_to(
                        outer,
                        pivot + control,
                        pivot + to * self.radius,
                        ((1. + cosine) / 2.).sqrt(),
                    );
                }
                self.pieces_left = self.pieces_left.saturating_sub(outer.len() - count);
                is_at_end = true;
            }
            Join::Miter if !turns_around && sine >= self.least_sine => {
                let middle = if dot < 0. {
                    Point::new(to.y - from.y, from.x - to.x) * sign
                } else {
                    from + to
                };
                let tip = pivot
                    + if dot == 0. {
                        middle * self.radius
                    } else {
                        unit(middle).unwrap_or(to) * (self.radius / sine)
                    };
                if before.is_line {
                    replace_end(outer, tip)
                } else {
                    outer.push(Command::LineTo(tip))
                }
                is_at_end = after.is_line;
            }
            _ => {}
        }
        if !is_at_end {
            outer.line_to(pivot + to * self.radius);
        }
        inner.line_to(pivot).line_to(pivot - to * self.radius);
    }

    fn cap(&mut self, path: &mut Path, end: End, to: Point) {
        let (normal, at, count) = (end.normal * self.radius, end.at, path.len());
        let tip = at + Point::new(-normal.y, normal.x);
        match self.cap {
            Cap::Butt => path.push(Command::LineTo(to)),
            Cap::Round if self.pieces_left == 0 => path.push(Command::LineTo(to)),
            Cap::Round => {
                conic_to(path, tip + normal, tip, FRAC_1_SQRT_2);
                conic_to(path, tip - normal, to, FRAC_1_SQRT_2);
                self.pieces_left = self.pieces_left.saturating_sub(path.len() - count);
            }
            Cap::Square if end.is_line => {
                replace_end(path, tip + normal);
                path.line_to(tip - normal);
            }
            Cap::Square => _ = path.line_to(tip + normal).line_to(tip - normal).line_to(to),
        }
    }

    /// The point on the curve, the one beside it, and the direction.
    fn ray(&self, curve: &Segment, t: f32, side: usize) -> [Point; 3] {
        let (on, along) = (
            curve.around(t)[1],
            unit(curve.direction(t)).unwrap_or(Point::new(1., 0.)) * self.radius,
        );
        [
            on,
            on + Point::new(along.y, -along.x) * if side == 0 { 1. } else { -1. },
            along,
        ]
    }

    /// The command that follows the curve at a distance, if one is enough.
    fn beside(&self, curve: &Segment, [from, to]: [f32; 2], side: usize) -> Option<Command> {
        let ([_, start, leaving], [_, end, arriving]) =
            (self.ray(curve, from, side), self.ray(curve, to, side));
        let [on, middle, _] = self.ray(curve, (from + to) / 2., side);
        let from_line = |point: Point, start: Point, along: Point| {
            let t = along.dot(point - start) / along.dot(along);
            distance(
                point,
                if (0. ..=1.).contains(&t) {
                    start + along * t
                } else {
                    start
                },
            )
        };
        let (denominator, gap) = (leaving.cross(arriving), start - end);
        let (a, b) = (arriving.cross(gap), leaving.cross(gap));
        let t = a / denominator;
        if denominator == 0. || t.is_nan() || t <= t - 1. {
            let is_straight = leaving.dot(arriving) >= 0.
                && from_line(middle, start, end - start) < self.tolerance;
            return is_straight.then_some(Command::LineTo(end));
        }
        if (a >= 0.) == (b >= 0.) {
            let is_near = from_line(start, end, arriving).max(from_line(end, start, leaving))
                <= self.tolerance;
            return is_near.then_some(Command::LineTo(end));
        }
        let control = start + leaving * t;
        let quad = Segment::Quad([start, control, end]);
        let is_near = distance(middle, quad.around(0.5)[1]) <= self.tolerance
            || {
                let [a, b, c] = [start, control, end].map(|it| (on - middle).cross(it - middle));
                let mut crossings = roots(c + a - 2. * b, 2. * (b - a), a);
                matches!((crossings.next(), crossings.next()), (Some(t), None)
                if distance(middle, quad.around(t)[1]) <= self.tolerance * (1. - (t - 0.5).abs() * 2.))
            };
        (is_near && (control - start).dot(control - end) <= 0.)
            .then_some(Command::QuadTo(control, end))
    }

    fn follow(&mut self, curve: &Segment, [from, to]: [f32; 2], side: usize, depth: u32) {
        self.pieces_left = self.pieces_left.saturating_sub(1);
        match self.beside(curve, [from, to], side) {
            Some(command) => self.sides[side].push(command),
            None if depth == 0 || self.pieces_left == 0 => {
                _ = self.sides[side].line_to(self.ray(curve, to, side)[1])
            }
            None => {
                self.follow(curve, [from, (from + to) / 2.], side, depth - 1);
                self.follow(curve, [(from + to) / 2., to], side, depth - 1);
            }
        }
    }

    fn contour(&mut self, contour: &Contour, take: &mut dyn FnMut(&[Command])) {
        let mut ends: Option<(End, End)> = None;
        let normal = |along: Point| unit(along).map(|it| Point::new(it.y, -it.x));
        let mut add =
            |stroker: &mut Stroker, segment: Segment, join: Join, start: Point, end: Point| {
                let is_line = matches!(segment, Segment::Line(_));
                let (start, end) = (
                    End {
                        at: segment.points()[0],
                        normal: start,
                        is_line,
                    },
                    End {
                        at: segment.end(),
                        normal: end,
                        is_line,
                    },
                );
                match ends {
                    Some((_, before)) => stroker.join(join, before, start),
                    None => {
                        stroker.sides[0].move_to(start.at + start.normal * stroker.radius);
                        stroker.sides[1].move_to(start.at - start.normal * stroker.radius);
                    }
                }
                ends = Some((ends.map_or(start, |it| it.0), end));
                if is_line {
                    stroker.sides[0].line_to(end.at + end.normal * stroker.radius);
                    stroker.sides[1].line_to(end.at - end.normal * stroker.radius);
                    return;
                }
                let inflections = match segment {
                    Segment::Cubic([a, b, c, d]) => {
                        let (first, second, third) = (b - a, c - b * 2. + a, d + (b - c) * 3. - a);
                        Some(roots(
                            second.cross(third),
                            first.cross(third),
                            first.cross(second),
                        ))
                    }
                    _ => None,
                };
                let mut from = 0.;
                for to in inflections.into_iter().flatten().chain([1.]) {
                    (0..2).for_each(|side| stroker.follow(&segment, [from, to], side, 12));
                    from = to;
                }
            };
        let (mut at, mut is_empty) = (contour.start, true);
        for segment in &contour.segments {
            let points = segment.points();
            let farthest = points.iter().fold(at, |far, it| {
                if distance(*it, at) > distance(far, at) {
                    *it
                } else {
                    far
                }
            });
            let (reach, along) = (distance(farthest, at), farthest - at);
            if reach <= NEARLY_ZERO * self.tolerance {
                continue;
            }
            let is_straight = points
                .iter()
                .all(|it| along.cross(*it - at).abs() <= reach * reach * 0.003);
            if let (false, Some(start), Some(end)) = (
                is_straight,
                normal(segment.direction(0.)),
                normal(segment.direction(1.)),
            ) {
                add(self, *segment, self.join, start, end);
                (at, is_empty) = (segment.end(), false);
                continue;
            }
            // It may go back and forth.
            let turns = match *segment {
                Segment::Line(_) => None,
                Segment::Quad([a, b, c]) => {
                    Some(roots(0., along.dot(a - b * 2. + c), along.dot(b - a)))
                }
                Segment::Cubic([a, b, c, d]) => Some(roots(
                    along.dot(d - a + (b - c) * 3.),
                    along.dot(a - b * 2. + c) * 2.,
                    along.dot(b - a),
                )),
            };
            let mut join = self.join;
            for to in turns
                .into_iter()
                .flatten()
                .chain([1.])
                .map(|t| segment.around(t)[1])
            {
                let Some(normal) = normal(to - at) else {
                    continue;
                };
                add(
                    self,
                    Segment::Line([at, to]),
                    std::mem::replace(&mut join, Join::Round),
                    normal,
                    normal,
                );
                (at, is_empty) = (to, false);
            }
        }
        if is_empty && self.cap != Cap::Butt {
            add(
                self,
                Segment::Line([at, at]),
                self.join,
                Point::new(1., 0.),
                Point::new(1., 0.),
            );
        }
        let Some((first, last)) = ends else { return };
        let is_closed = contour.is_closed && !is_empty;
        if is_closed {
            self.join(self.join, last, first);
        }
        let [mut left, right] = std::mem::take(&mut self.sides);
        match is_closed {
            true => _ = left.close().move_to(end_of(&right)),
            false => self.cap(&mut left, last, end_of(&right)),
        }
        for index in (1..right.len()).rev() {
            let to = end_of(&right[..index]);
            left.push(if let Command::QuadTo(control, _) = right[index] {
                Command::QuadTo(control, to)
            } else {
                Command::LineTo(to)
            });
        }
        if !is_closed {
            let start = first.at + first.normal * self.radius;
            self.cap(
                &mut left,
                End {
                    normal: -first.normal,
                    ..first
                },
                start,
            );
        }
        take(left.close());
        self.sides = [left, right];
        self.sides.iter_mut().for_each(Vec::clear);
    }
}

impl Stroke<'_> {
    pub fn new(width: f32) -> Self {
        Stroke {
            width,
            cap: Cap::Butt,
            join: Join::Miter,
            miter_limit: 4.,
            dashes: &[],
            dash_offset: 0.,
        }
    }

    /// In parts, as precise as it has to be for `matrix`, which it is filled with, and then only right between the corners.
    pub fn outline(
        &self,
        path: &[Command],
        matrix: &Transform,
        [low, high]: [Point; 2],
        take: &mut dyn FnMut(&[Command]),
    ) {
        if !(self.width > 0. && self.width.is_finite()) {
            return;
        }
        let (x, y) = matrix.get_scale();
        let resolution = Some(x.max(y))
            .filter(|it| it.is_finite() && *it > 0.)
            .unwrap_or(1.);
        let period: f32 = self.dashes.iter().sum();
        let is_dashed = self.dashes.len().is_multiple_of(2)
            && self.dashes.iter().all(|it| *it >= 0.)
            && period > 0.;
        let reach = self.width / 2.
            * if self.join == Join::Miter {
                self.miter_limit.max(SQRT_2)
            } else {
                SQRT_2
            }
            * x.hypot(y)
            + 1.;
        let window = Window {
            matrix,
            low: low - Point::new(reach, reach),
            high: high + Point::new(reach, reach),
        };
        let dashed = (is_dashed && (period + self.dash_offset).is_finite()).then(|| {
            dashed(path, self.dashes, self.dash_offset, resolution, &window).unwrap_or_default()
        });
        let mut stroker = Stroker {
            radius: self.width / 2.,
            cap: self.cap,
            join: if self.join == Join::Miter && self.miter_limit <= 1. {
                Join::Bevel
            } else {
                self.join
            },
            least_sine: 1. / self.miter_limit,
            tolerance: 0.25 / resolution,
            sides: Default::default(),
            pieces_left: MAX_PIECES * 2,
        };
        contours(dashed.as_deref().unwrap_or(path), |contour| {
            window.parts(contour, |part| stroker.contour(part, take))
        });
    }
}
