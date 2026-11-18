//! Curves as the lines that `SkAnalyticEdge` makes of them, which start and end at quarters of a pixel. That is what
//! makes horizontal stems of glyphs crisp in Chromium.

use super::raster::{Coverage, IntRect, map_point};
use crate::gfx::{Command, Point, Transform};
use crate::small_vec::SmallVec;

type Points = SmallVec<Point, 8>;

fn snap(y: f32) -> f32 {
    (y * 4. + 0.5).floor() / 4.
}

/// `diff_to_shift`, for distances in pixels.
fn subdivisions(dx: f32, dy: f32) -> u32 {
    let (dx, dy) = ((dx.abs() * 256.) as u32, (dy.abs() * 256.) as u32);
    let distance = dx.max(dy) + dx.min(dy) / 2;
    (32 - ((distance + 16) >> 5).leading_zeros()) / 2
}

fn lerp(a: Point, b: Point, t: f32) -> Point {
    a.lerp(b, t)
}

/// From top to bottom, without turning around.
fn quadratic([a, b, c]: [Point; 3]) -> Points {
    let count =
        1 << subdivisions((2. * b.x - a.x - c.x) / 4., (2. * b.y - a.y - c.y) / 4.).clamp(1, 6);
    let (offset, bottom) = (snap(a.y) - a.y, snap(c.y));
    let (mut last, mut last_y) = (Point::new(a.x, snap(a.y)), a.y);
    let mut points = Points::from_iter([last]);
    for step in 1..count {
        let t = step as f32 / count as f32;
        let exact = lerp(lerp(a, b, t), lerp(b, c, t), t);
        let y = exact.y + offset;
        let next = if exact.y - last_y >= 2. {
            let row = (y + 0.5).floor().min(bottom);
            Point::new(exact.x - (exact.x - last.x) / (y - last.y) * (y - row), row)
        } else {
            Point::new(exact.x, snap(y).min(bottom))
        };
        last_y = exact.y;
        if next.y > last.y {
            points.push(next);
            last = next;
        }
    }
    points.push(Point::new(c.x, bottom));
    points
}

fn cubic([a, b, c, d]: [Point; 4]) -> Points {
    let from_line = |a: f32, b: f32, c: f32, d: f32| {
        let (first, second) = (a * 8. - b * 15. + 6. * c + d, a + 6. * b - c * 15. + d * 8.);
        first.abs().max(second.abs()) * 19. / 512.
    };
    let count = 1
        << (subdivisions(from_line(a.x, b.x, c.x, d.x), from_line(a.y, b.y, c.y, d.y)) + 1).min(6);
    let (offset, bottom) = (snap(a.y) - a.y, snap(d.y));
    let mut points = Points::from_iter([Point::new(a.x, snap(a.y))]);
    points.extend((1..count).map(|step| {
        let t = step as f32 / count as f32;
        let (ab, bc, cd) = (lerp(a, b, t), lerp(b, c, t), lerp(c, d, t));
        let exact = lerp(lerp(ab, bc, t), lerp(bc, cd, t), t);
        Point::new(exact.x, snap(exact.y + offset).min(bottom))
    }));
    points.push(Point::new(d.x, bottom));
    points
}

/// Where between 0 and 1 `a t² + b t + c` is zero, ascending.
fn roots(a: f32, b: f32, c: f32) -> SmallVec<f32, 2> {
    let discriminant = b * b - 4. * a * c;
    let q = -0.5 * (b + discriminant.sqrt().copysign(b));
    let mut roots: SmallVec<f32, 2> = [q / a, c / q]
        .into_iter()
        .filter(|t| *t > 1e-5 && *t < 1. - 1e-5)
        .collect();
    roots.sort_by(f32::total_cmp);
    if roots.first() == roots.get(1) {
        roots.truncate(1);
    }
    roots
}

struct Edge {
    /// In quarters of a pixel.
    top: i32,
    bottom: i32,
    x: f32,
    step: f32,
    winding: i32,
}

impl Edge {
    fn after(&self, quarters: f32) -> f32 {
        self.x + self.step * quarters
    }
}

/// Those that matter in an area.
pub struct Edges<'a> {
    matrix: &'a Transform,
    area: IntRect,
    list: Vec<Edge>,
    /// How what is left of the area changes the winding from one quarter of a row to the next.
    turns: Vec<i32>,
    /// In quarters of rows.
    length: u64,
}

impl<'a> Edges<'a> {
    /// With more, nothing is filled.
    const MAX_COUNT: usize = 1 << 22;
    const MAX_LENGTH: u64 = 1 << 29;
    const MAX_SORTED_LENGTH: u64 = 1 << 23;

    pub fn new(matrix: &'a Transform, area: IntRect) -> Self {
        Edges {
            matrix,
            area,
            list: Vec::new(),
            turns: Vec::new(),
            length: 0,
        }
    }

    fn line(&mut self, from: Point, to: Point) {
        let (upper, lower, winding) = if from.y < to.y {
            (from, to, 1)
        } else {
            (to, from, -1)
        };
        let (top, bottom, first) = (
            (upper.y * 4.) as i32,
            (lower.y * 4.) as i32,
            self.area.top * 4,
        );
        let (start, end) = (top.max(first), bottom.min(self.area.bottom * 4));
        if start >= end || upper.x.min(lower.x) >= self.area.right as f32 {
            return;
        }
        if upper.x.max(lower.x) <= self.area.left as f32 {
            self.turns.resize(self.area.height() * 4 + 1, 0);
            self.turns[(start - first) as usize] += winding;
            self.turns[(end - first) as usize] -= winding;
        } else if self.list.len() < Self::MAX_COUNT {
            let step = (lower.x - upper.x) / (bottom - top) as f32;
            self.list.push(Edge {
                top,
                bottom,
                x: upper.x - self.area.left as f32,
                step,
                winding,
            });
            self.length += (end - start) as u64;
        }
    }

    /// It does not turn around.
    fn curve<const N: usize>(&mut self, mut curve: [Point; N], flatten: fn([Point; N]) -> Points) {
        let rises = curve[0].y > curve[N - 1].y;
        if rises {
            curve.reverse();
        }
        for pair in flatten(curve).windows(2) {
            self.line(pair[usize::from(rises)], pair[usize::from(!rises)]);
        }
    }

    /// Whether the line between its ends does as well.
    fn is_outside(&self, curve: &[Point]) -> bool {
        let IntRect {
            left,
            top,
            right,
            bottom,
        } = self.area;
        curve.iter().all(|it| it.x <= left as f32)
            || curve.iter().all(|it| it.x >= right as f32)
            || curve.iter().all(|it| it.y <= top as f32)
            || curve.iter().all(|it| it.y >= bottom as f32)
    }

    pub fn add(&mut self, path: &[Command]) {
        const FAR: f32 = 1e7;
        let matrix = self.matrix;
        let map = |point: Point| {
            let (x, y) = map_point(matrix, point.x, point.y);
            let [x, y] = [x, y].map(|it| {
                if it.is_nan() {
                    -FAR
                } else {
                    it.clamp(-FAR, FAR)
                }
            });
            Point::new(x, y)
        };
        let snapped = |it: Point| Point::new(it.x, snap(it.y));
        let (mut start, mut current) = (Point::ZERO, Point::ZERO);
        for command in path.iter().chain([&Command::Close]) {
            if self.list.len() == Self::MAX_COUNT {
                return;
            }
            let from = current;
            match *command {
                Command::MoveTo(to) => {
                    self.line(snapped(from), snapped(start));
                    (start, current) = (map(to), map(to));
                    continue;
                }
                Command::Close => current = start,
                Command::LineTo(to) => current = map(to),
                Command::QuadTo(b, c) => {
                    let (a, b, c) = (from, map(b), map(c));
                    current = c;
                    if !self.is_outside(&[a, b, c]) {
                        let t = (a.y - b.y) / (a.y - 2. * b.y + c.y);
                        if t > 0. && t < 1. {
                            let (ab, bc) = (lerp(a, b, t), lerp(b, c, t));
                            let turn = lerp(ab, bc, t);
                            self.curve([a, Point::new(ab.x, turn.y), turn], quadratic);
                            self.curve([turn, Point::new(bc.x, turn.y), c], quadratic);
                        } else {
                            self.curve([a, b, c], quadratic);
                        }
                        continue;
                    }
                }
                Command::CurveTo(b, c, d) => {
                    let [mut a, mut b, mut c, d] = [from, map(b), map(c), map(d)];
                    current = d;
                    if !self.is_outside(&[a, b, c, d]) {
                        let turns = roots(
                            d.y - a.y + 3. * (b.y - c.y),
                            2. * (a.y - 2. * b.y + c.y),
                            b.y - a.y,
                        );
                        let mut done = 0.;
                        for turn in turns {
                            let t = (turn - done) / (1. - done);
                            let (ab, bc, cd) = (lerp(a, b, t), lerp(b, c, t), lerp(c, d, t));
                            let (abc, bcd) = (lerp(ab, bc, t), lerp(bc, cd, t));
                            let middle = lerp(abc, bcd, t);
                            self.curve([a, ab, Point::new(abc.x, middle.y), middle], cubic);
                            (a, b, c, done) = (middle, Point::new(bcd.x, middle.y), cd, turn);
                        }
                        self.curve([a, b, c, d], cubic);
                        continue;
                    }
                }
            }
            self.line(snapped(from), snapped(current));
        }
    }

    pub fn fill(self, is_inside: impl Fn(i32) -> bool) -> Coverage {
        let Edges {
            area,
            list: mut edges,
            turns,
            length,
            ..
        } = self;
        let mut coverage = Coverage::filled(area, 0);
        if edges.len() == Self::MAX_COUNT || length > Self::MAX_LENGTH {
            return coverage;
        }
        let (mut top, mut winding) = (0, 0);
        for (bottom, turn) in (area.top * 4..).zip(turns).filter(|it| it.1 != 0) {
            edges.extend((winding != 0).then_some(Edge {
                top,
                bottom,
                x: -1.,
                step: 0.,
                winding,
            }));
            (top, winding) = (bottom, winding + turn);
        }
        edges.sort_unstable_by_key(|edge| std::cmp::Reverse(edge.top));
        match length > Self::MAX_SORTED_LENGTH {
            true => sample(edges, is_inside, &mut coverage),
            false => measure(edges, is_inside, &mut coverage),
        }
        coverage
    }
}

/// Adds what is right of a line that goes from `from` to `to` and `height` down, as differences between neighbors.
fn accumulate(row: &mut [f32], from: f32, to: f32, mut height: f32) {
    let (limit, low, high) = ((row.len() - 2) as f32, from.min(to), from.max(to));
    let (left, right) = (low.clamp(0., limit), high.clamp(0., limit));
    if left < right && (low, high) != (left, right) {
        let slope = height / (high - low);
        row[0] += slope * (left - low);
        height = slope * (right - left);
    }
    let (first, last) = (left as usize, right as usize);
    if first == last {
        let middle = (left + right) / 2. - first as f32;
        row[first] += height * (1. - middle);
        row[first + 1] += height * middle;
        return;
    }
    let slope = height / (right - left);
    for column in first..=last {
        let (start, end) = (left.max(column as f32), right.min(column as f32 + 1.));
        let (part, middle) = (slope * (end - start), (start + end) / 2. - column as f32);
        row[column] += part * (1. - middle);
        row[column + 1] += part * middle;
    }
}

/// How much of each pixel the corners enclose.
pub fn fill_exactly(corners: [Point; 4], area: IntRect) -> Coverage {
    let mut coverage = Coverage::filled(area, 0);
    let place =
        |at: f32, origin: i32| ((at - origin as f32).clamp(-1e7, 1e7) * 256.).trunc() / 256.;
    let corners = corners.map(|it| Point::new(place(it.x, area.left), place(it.y, area.top)));
    let mut sums = vec![0.; area.width() + 2];
    for (y, row) in coverage.data.chunks_mut(area.width().max(1)).enumerate() {
        for (from, to) in (0..4).map(|it| (corners[it], corners[(it + 1) % 4])) {
            let [start, end] = [from.y, to.y].map(|it| it.clamp(y as f32, y as f32 + 1.));
            if start != end {
                let x = |y: f32| from.x + (to.x - from.x) * (y - from.y) / (to.y - from.y);
                accumulate(&mut sums, x(start), x(end), end - start);
            }
        }
        add_up(&mut sums, row, |sum| (sum.abs() * 256. - 1. / 1024.) as u8);
    }
    coverage
}

/// Clears `differences`, most of which are zero.
fn add_up(differences: &mut [f32], row: &mut [u8], value: impl Fn(f32) -> u8) {
    const RUN: usize = 8;
    let (mut sum, mut last) = (0., 0);
    for (values, differences) in row.chunks_mut(RUN).zip(differences.chunks_mut(RUN)) {
        if differences.iter().fold(0, |all, it| all | it.to_bits()) == 0 {
            values.fill(last);
            continue;
        }
        for (target, difference) in values.iter_mut().zip(differences) {
            sum += std::mem::take(difference);
            last = value(sum);
            *target = last;
        }
    }
    differences[row.len()..].fill(0.);
}

/// Contours that overlap in a pixel do not count twice.
pub fn fill(path: &[Command], is_even_odd: bool, matrix: &Transform, area: IntRect) -> Coverage {
    let mask = if is_even_odd { 1 } else { -1 };
    fill_where(path, |winding| winding & mask != 0, matrix, area)
}

pub fn fill_where(
    path: &[Command],
    is_inside: impl Fn(i32) -> bool,
    matrix: &Transform,
    area: IntRect,
) -> Coverage {
    let mut edges = Edges::new(matrix, area);
    edges.add(path);
    edges.fill(is_inside)
}

fn advance(active: &mut Vec<Edge>, waiting: &mut Vec<Edge>, quarter: i32) {
    active.retain(|edge| edge.bottom > quarter);
    while let Some(mut edge) = waiting.pop_if(|edge| edge.top <= quarter) {
        edge.x += edge.step * (quarter - edge.top) as f32;
        active.push(edge);
    }
}

/// Most are in order.
fn sort(active: &mut [Edge]) {
    let mut swaps_left = active.len() * 4 + 64;
    for next in 1..active.len() {
        let (middle, mut at) = (active[next].after(0.5), next);
        while at > 0 && active[at - 1].after(0.5) > middle {
            active.swap(at - 1, at);
            at -= 1;
        }
        let Some(left) = swaps_left.checked_sub(next - at) else {
            return active.sort_by(|a, b| a.after(0.5).total_cmp(&b.after(0.5)));
        };
        swaps_left = left;
    }
}

fn measure(mut edges: Vec<Edge>, is_inside: impl Fn(i32) -> bool, coverage: &mut Coverage) {
    let area = coverage.rect;
    let (mut active, mut sums, width) =
        (Vec::new(), vec![0.; area.width() + 2], area.width().max(1));
    let mut repeats_until = i32::MIN;
    for (y, start) in (area.top..).zip((0..coverage.data.len()).step_by(width)) {
        let (mut quarter, end) = (y * 4, y * 4 + 4);
        if end <= repeats_until {
            coverage.data.copy_within(start - width..start, start);
            continue;
        }
        while quarter < end {
            advance(&mut active, &mut edges, quarter);
            sort(&mut active);
            let change = active
                .iter()
                .fold(edges.last().map_or(i32::MAX, |it| it.top), |first, it| {
                    first.min(it.bottom)
                });
            let mut count = (change.min(end) - quarter) as f32;
            let side = |x: f32| (x < 0., x > width as f32);
            if count > 1.
                && (active.iter().any(|it| side(it.x) != side(it.after(count)))
                    || active
                        .windows(2)
                        .any(|it| it[0].after(count - 0.5) > it[1].after(count - 0.5)))
            {
                count = 1.;
            }
            if count == 4. && active.iter().all(|it| it.step == 0.) {
                repeats_until = change;
            }
            let mut winding = 0;
            for edge in &mut active {
                let (was_inside, from) = (is_inside(winding), edge.x);
                (winding, edge.x) = (winding + edge.winding, edge.after(count));
                if was_inside != is_inside(winding) {
                    accumulate(
                        &mut sums,
                        from,
                        edge.x,
                        if was_inside { -0.25 } else { 0.25 } * count,
                    );
                }
            }
            quarter += count as i32;
        }
        add_up(
            &mut sums,
            &mut coverage.data[start..start + area.width()],
            |sum| (sum * 255. + 0.5) as u8,
        );
    }
}

/// At 16 points of each pixel, which takes no sorting.
fn sample(mut edges: Vec<Edge>, is_inside: impl Fn(i32) -> bool, coverage: &mut Coverage) {
    let area = coverage.rect;
    let (mut active, mut turns) = (Vec::new(), vec![0; area.width() * 4 + 4]);
    for (y, row) in (area.top..).zip(coverage.data.chunks_mut(area.width().max(1))) {
        for quarter in y * 4..y * 4 + 4 {
            advance(&mut active, &mut edges, quarter);
            for edge in &mut active {
                turns[((edge.after(0.5) * 4. + 0.5) as usize).min(row.len() * 4)] += edge.winding;
                edge.x += edge.step;
            }
            let mut winding = 0;
            for (value, turns) in row.iter_mut().zip(turns.as_chunks_mut::<4>().0) {
                for turn in turns {
                    winding += std::mem::take(turn);
                    *value = value.saturating_add(if is_inside(winding) { 16 } else { 0 });
                }
            }
        }
    }
}
