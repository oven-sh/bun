//! Curves as the lines that `SkAnalyticEdge` makes of them, which start and end at quarters of a pixel. That is what
//! makes horizontal stems of glyphs crisp in Chromium.

use std::ops::Range;

use super::raster::{Coverage, IntRect, map_point};
use crate::gfx::{Command, Point, Transform};
use crate::small_vec::SmallVec;

/// Baseline x86-64 has no instruction for `f32::floor`.
#[inline]
fn floor(value: f32) -> i32 {
    value as i32 - i32::from(value < value as i32 as f32)
}

#[derive(Clone, Copy, Default)]
struct Vertex {
    x: f32,
    /// In quarters of a pixel.
    y: i32,
}

fn quarter(y: f32) -> i32 {
    floor(y * 4. + 0.5)
}

fn snapped(point: Point) -> Vertex {
    Vertex {
        x: point.x,
        y: quarter(point.y),
    }
}

const MAX_SHIFT: u32 = 6;
type Vertices = [Vertex; (1 << MAX_SHIFT) + 1];

/// `diff_to_shift`, for distances in pixels.
fn subdivisions(dx: f32, dy: f32) -> u32 {
    let (dx, dy) = ((dx.abs() * 256.) as u32, (dy.abs() * 256.) as u32);
    let distance = dx.max(dy).saturating_add(dx.min(dy) / 2);
    (32 - (distance.saturating_add(16) >> 5).leading_zeros()) / 2
}

fn lerp(a: Point, b: Point, t: f32) -> Point {
    a.lerp(b, t)
}

/// From top to bottom, without turning around. Returns how many it has written.
fn quadratic([a, b, c]: [Point; 3], vertices: &mut Vertices) -> usize {
    let count = 1
        << subdivisions((2. * b.x - a.x - c.x) / 4., (2. * b.y - a.y - c.y) / 4.)
            .clamp(1, MAX_SHIFT);
    let (mut last, mut last_y, bottom, step) = (snapped(a), a.y, quarter(c.y), 1. / count as f32);
    let (offset, mut len) = (last.y as f32 / 4. - a.y, 1);
    vertices[0] = last;
    for index in 1..count {
        let t = index as f32 * step;
        let exact = lerp(lerp(a, b, t), lerp(b, c, t), t);
        let y = exact.y + offset;
        let next = if exact.y - last_y >= 2. {
            let row = (floor(y + 0.5) * 4).min(bottom);
            Vertex {
                x: exact.x - (exact.x - last.x) / (y - last.y as f32 / 4.) * (y - row as f32 / 4.),
                y: row,
            }
        } else {
            Vertex {
                x: exact.x,
                y: quarter(y).min(bottom),
            }
        };
        last_y = exact.y;
        if next.y > last.y {
            (vertices[len], last) = (next, next);
            len += 1;
        }
    }
    vertices[len] = Vertex { x: c.x, y: bottom };
    len + 1
}

fn cubic([a, b, c, d]: [Point; 4], vertices: &mut Vertices) -> usize {
    let from_line = |a: f32, b: f32, c: f32, d: f32| {
        let (first, second) = (a * 8. - b * 15. + 6. * c + d, a + 6. * b - c * 15. + d * 8.);
        first.abs().max(second.abs()) * 19. / 512.
    };
    let count = 1
        << (subdivisions(from_line(a.x, b.x, c.x, d.x), from_line(a.y, b.y, c.y, d.y)) + 1)
            .min(MAX_SHIFT);
    let (first, bottom, step) = (snapped(a), quarter(d.y), 1. / count as f32);
    let offset = first.y as f32 / 4. - a.y;
    vertices[0] = first;
    for (index, vertex) in (1..count).zip(&mut vertices[1..]) {
        let t = index as f32 * step;
        let (ab, bc, cd) = (lerp(a, b, t), lerp(b, c, t), lerp(c, d, t));
        let exact = lerp(lerp(ab, bc, t), lerp(bc, cd, t), t);
        *vertex = Vertex {
            x: exact.x,
            y: quarter(exact.y + offset).min(bottom),
        };
    }
    vertices[count] = Vertex { x: d.x, y: bottom };
    count + 1
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

const END: u32 = u32::MAX;
/// More would magnify rounding errors.
const VERTICAL: f32 = 4096.;

#[derive(Clone, Copy)]
pub(super) struct Line {
    /// In quarters of a pixel.
    pub top: i32,
    pub bottom: i32,
    pub x: f32,
    /// To the right, for each quarter.
    pub step: f32,
    /// Quarters for each pixel to the side. It is finite.
    pub steepness: f32,
    /// The one whose top is this one's bottom.
    pub below: u32,
}

impl Line {
    #[inline(always)]
    pub fn at(&self, quarter: i32) -> f32 {
        self.x + self.step * (quarter - self.top) as f32
    }
}

/// Lines from top to bottom.
#[derive(Clone, Copy)]
pub(super) struct Chain {
    pub first: u32,
    pub top: i32,
    pub winding: i32,
}

/// Which windings are inside. Contours that overlap in a pixel do not count twice.
#[derive(Clone, Copy, PartialEq)]
pub enum Rule {
    NonZero,
    EvenOdd,
    Negative,
    Positive,
}

/// In `Edges`.
#[derive(Clone)]
pub struct Shape {
    pub(super) chains: Range<u32>,
    pub(super) rule: Rule,
    /// Nothing is outside.
    pub area: IntRect,
    pub(super) is_intricate: bool,
    /// Of the edges, in quarters of rows.
    pub length: u32,
    line_count: u32,
    /// In `Edges::periods`.
    periods: Option<u32>,
}

impl Shape {
    /// For what has no edges.
    pub fn blank(area: IntRect) -> Shape {
        Shape {
            chains: 0..0,
            rule: Rule::NonZero,
            area,
            is_intricate: false,
            length: 0,
            line_count: 0,
            periods: None,
        }
    }
}

/// Of any number of shapes.
#[derive(Default)]
pub struct Edges {
    pub(super) lines: Vec<Line>,
    pub(super) chains: Vec<Chain>,
    /// How what is left of the area changes the winding from one quarter of a row to the next.
    turns: Vec<i32>,
    /// Where the chains for each period of a shape's rows start.
    periods: Vec<u32>,
}

/// So many rows, from a multiple of it on, look the same whether or not those above were filled before.
pub const PERIOD: i32 = 32;

impl Edges {
    pub fn clear(&mut self) {
        self.lines.clear();
        self.chains.clear();
        self.periods.clear();
    }

    pub fn bytes_used(&self) -> usize {
        size_of_val(&self.lines[..])
            + size_of_val(&self.chains[..])
            + size_of_val(&self.periods[..])
    }

    pub fn bytes(&self) -> usize {
        self.lines.capacity() * size_of::<Line>()
            + self.chains.capacity() * size_of::<Chain>()
            + (self.turns.capacity() + self.periods.capacity()) * 4
    }

    /// For filling it a period at a time without going through all that is above.
    pub fn index(&mut self, shape: &mut Shape) {
        const LITTLE: u64 = 1 << 10;
        let period = |quarter: i32| {
            (quarter.div_euclid(PERIOD * 4) - shape.area.top.div_euclid(PERIOD)).max(0) as usize
        };
        let (
            Edges {
                lines,
                chains,
                periods,
                ..
            },
            count,
        ) = (self, period(shape.area.bottom * 4 - 1) + 1);
        if u64::from(shape.line_count) * (count as u64 - 1) < LITTLE {
            return;
        }
        let (all, first) = (
            shape.chains.start as usize..shape.chains.end as usize,
            periods.len(),
        );
        let visit = |chain: Chain, take: &mut dyn FnMut(usize, u32)| {
            let (mut index, mut next) = (chain.first, period(chain.top));
            while let Some(line) = lines.get(index as usize) {
                let end = (period(line.bottom - 1) + 1).min(count);
                (next..end).for_each(|it| take(it, index));
                (index, next) = (line.below, end.max(next));
            }
        };
        periods.resize(first + count + 1, 0);
        let ends = &mut periods[first + 1..];
        chains[all.clone()]
            .iter()
            .for_each(|it| visit(*it, &mut |period, _| ends[period] += 1));
        let total = ends.iter_mut().fold(chains.len() as u32, |before, it| {
            before + std::mem::replace(it, before)
        });
        let start = chains.len() as u32;
        chains.resize(
            total as usize,
            Chain {
                first: END,
                top: 0,
                winding: 0,
            },
        );
        for index in all {
            let chain = chains[index];
            visit(chain, &mut |period, first| {
                chains[ends[period] as usize] = Chain { first, ..chain };
                ends[period] += 1;
            });
        }
        (periods[first], shape.periods) = (start, Some(first as u32));
    }

    /// Those that matter from a row on, and up to where.
    pub(super) fn chains_from(&self, shape: &Shape, y: i32) -> (&[Chain], i32) {
        let Some(first) = shape.periods else {
            return (
                &self.chains[shape.chains.start as usize..shape.chains.end as usize],
                i32::MAX,
            );
        };
        let at =
            first as usize + (y.div_euclid(PERIOD) - shape.area.top.div_euclid(PERIOD)) as usize;
        (
            &self.chains[self.periods[at] as usize..self.periods[at + 1] as usize],
            (y + PERIOD) & -PERIOD,
        )
    }

    /// Only what matters in `area` is kept.
    pub fn outline<'a>(&'a mut self, matrix: &'a Transform, area: IntRect) -> Outline<'a> {
        self.turns.clear();
        let (first_line, first_chain) = (self.lines.len(), self.chains.len());
        Outline {
            edges: self,
            matrix,
            area,
            first_line,
            first_chain,
            length: 0,
            goes_on: false,
            contour: [first_line, first_chain],
            rows: [i32::MAX, i32::MIN],
            columns: [1e8, -1e8],
        }
    }
}

pub struct Outline<'a> {
    edges: &'a mut Edges,
    matrix: &'a Transform,
    area: IntRect,
    first_line: usize,
    first_chain: usize,
    /// In quarters of rows.
    length: u64,
    /// The last line and the last chain are of the current contour.
    goes_on: bool,
    /// Its first line, and its first chain.
    contour: [usize; 2],
    /// The first quarter, and the one after the last.
    rows: [i32; 2],
    /// Of the points.
    columns: [f32; 2],
}

impl Outline<'_> {
    /// With more, nothing is filled.
    const MAX_COUNT: usize = 1 << 22;
    const MAX_LENGTH: u64 = 1 << 29;
    const MAX_SORTED_LENGTH: u64 = 1 << 23;

    fn is_full(&self) -> bool {
        self.edges.lines.len() - self.first_line >= Self::MAX_COUNT
    }

    #[inline]
    fn line(&mut self, from: Vertex, to: Vertex) {
        let (upper, lower, winding) = if from.y < to.y {
            (from, to, 1)
        } else {
            (to, from, -1)
        };
        let (top, bottom, first) = (upper.y, lower.y, self.area.top * 4);
        let (start, end) = (top.max(first), bottom.min(self.area.bottom * 4));
        let (left, right) = (self.area.left as f32, self.area.right as f32);
        if start >= end || upper.x >= right && lower.x >= right {
            return;
        }
        self.rows = [self.rows[0].min(start), self.rows[1].max(end)];
        let Edges {
            lines,
            chains,
            turns,
            ..
        } = &mut *self.edges;
        if upper.x <= left && lower.x <= left {
            turns.resize(self.area.height() * 4 + 1, 0);
            turns[(start - first) as usize] += winding;
            turns[(end - first) as usize] -= winding;
            return;
        }
        let (across, down, index) = (lower.x - upper.x, (bottom - top) as f32, lines.len() as u32);
        let steepness = down / across.abs();
        let mut line = Line {
            top,
            bottom,
            x: upper.x,
            step: across / down,
            steepness: if steepness < VERTICAL {
                steepness
            } else {
                VERTICAL
            },
            below: END,
        };
        self.length += (end - start) as u64;
        match (
            chains
                .last_mut()
                .filter(|it| self.goes_on && it.winding == winding),
            lines.last_mut(),
        ) {
            (Some(_), Some(above)) if winding > 0 && above.bottom == top => above.below = index,
            (Some(chain), _) if winding < 0 && chain.top == bottom => {
                (line.below, chain.first, chain.top) = (chain.first, index, top)
            }
            _ => chains.push(Chain {
                first: index,
                top,
                winding,
            }),
        }
        lines.push(line);
        self.goes_on = true;
    }

    /// It does not turn around.
    #[inline]
    fn curve<const N: usize>(
        &mut self,
        mut curve: [Point; N],
        vertices: &mut Vertices,
        flatten: fn([Point; N], &mut Vertices) -> usize,
    ) {
        let rises = curve[0].y > curve[N - 1].y;
        if rises {
            curve.reverse();
        }
        let count = flatten(curve, vertices);
        match rises {
            true => vertices[..count]
                .windows(2)
                .rev()
                .for_each(|it| self.line(it[1], it[0])),
            false => vertices[..count]
                .windows(2)
                .for_each(|it| self.line(it[0], it[1])),
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

    fn map(&mut self, point: Point) -> Point {
        const FAR: f32 = 1e7;
        let (x, y) = map_point(self.matrix, point.x, point.y);
        let [x, y] = [x, y]
            .map(|it| if it > -FAR { it } else { -FAR })
            .map(|it| if it < FAR { it } else { FAR });
        self.columns = [
            if x < self.columns[0] {
                x
            } else {
                self.columns[0]
            },
            if x > self.columns[1] {
                x
            } else {
                self.columns[1]
            },
        ];
        Point::new(x, y)
    }

    fn quad(&mut self, [a, b, c]: [Point; 3], vertices: &mut Vertices) {
        if self.is_outside(&[a, b, c]) {
            return self.line(snapped(a), snapped(c));
        }
        let t = (a.y - b.y) / (a.y - 2. * b.y + c.y);
        if t > 0. && t < 1. {
            let (ab, bc) = (lerp(a, b, t), lerp(b, c, t));
            let turn = lerp(ab, bc, t);
            self.curve([a, Point::new(ab.x, turn.y), turn], vertices, quadratic);
            self.curve([turn, Point::new(bc.x, turn.y), c], vertices, quadratic);
        } else {
            self.curve([a, b, c], vertices, quadratic);
        }
    }

    fn cubic(&mut self, [mut a, mut b, mut c, d]: [Point; 4], vertices: &mut Vertices) {
        if self.is_outside(&[a, b, c, d]) {
            return self.line(snapped(a), snapped(d));
        }
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
            self.curve(
                [a, ab, Point::new(abc.x, middle.y), middle],
                vertices,
                cubic,
            );
            (a, b, c, done) = (middle, Point::new(bcd.x, middle.y), cd, turn);
        }
        self.curve([a, b, c, d], vertices, cubic);
    }

    pub fn add(&mut self, path: &[Command]) {
        let (mut start, mut current, mut vertices) = (Point::ZERO, Point::ZERO, None);
        let blank = || [Vertex::default(); _];
        self.begin_contour();
        for command in path {
            if self.is_full() {
                return;
            }
            let from = current;
            match *command {
                Command::MoveTo(to) => {
                    self.line(snapped(from), snapped(start));
                    self.end_contour();
                    start = self.map(to);
                    current = start;
                }
                Command::Close => {
                    current = start;
                    self.line(snapped(from), snapped(current));
                }
                Command::LineTo(to) => {
                    current = self.map(to);
                    self.line(snapped(from), snapped(current));
                }
                Command::QuadTo(b, c) => {
                    current = self.map(c);
                    let b = self.map(b);
                    self.quad([from, b, current], vertices.get_or_insert_with(blank));
                }
                Command::CurveTo(b, c, d) => {
                    current = self.map(d);
                    let (b, c) = (self.map(b), self.map(c));
                    self.cubic([from, b, c, current], vertices.get_or_insert_with(blank));
                }
            }
        }
        self.line(snapped(current), snapped(start));
        self.end_contour();
    }

    fn begin_contour(&mut self) {
        (self.contour, self.goes_on) = ([self.edges.lines.len(), self.edges.chains.len()], false);
    }

    /// Its start need not be where it turns around.
    fn end_contour(&mut self) {
        let (Edges { lines, chains, .. }, [line, chain]) = (&mut *self.edges, self.contour);
        if let [first, .., last] = chains[chain..]
            && first.winding == last.winding
        {
            let (upper, lower, kept) = if first.winding > 0 {
                (lines.len() - 1, first, last)
            } else {
                (line, last, first)
            };
            if lines[upper].bottom == lower.top {
                lines[upper].below = lower.first;
                chains[chain] = kept;
                chains.pop();
            }
        }
        self.begin_contour();
    }

    pub fn finish(self, rule: Rule) -> Shape {
        let (
            is_full,
            Outline {
                edges,
                area,
                first_line,
                first_chain,
                length,
                rows,
                columns,
                ..
            },
        ) = (self.is_full(), self);
        let Edges {
            lines,
            chains,
            turns,
            ..
        } = edges;
        let bounds = IntRect::new(
            floor(columns[0]) - 1,
            rows[0] >> 2,
            floor(columns[1]) + 9,
            rows[1].saturating_add(3) >> 2,
        )
        .intersect(area);
        if is_full || length > Self::MAX_LENGTH || rows[0] >= rows[1] || bounds.is_empty() {
            lines.truncate(first_line);
            chains.truncate(first_chain);
            return Shape::blank(IntRect::default());
        }
        let (mut top, mut winding) = (0, 0);
        for (bottom, turn) in (area.top * 4..).zip(turns.iter()).filter(|it| *it.1 != 0) {
            if winding != 0 {
                chains.push(Chain {
                    first: lines.len() as u32,
                    top,
                    winding,
                });
                lines.push(Line {
                    top,
                    bottom,
                    x: -1e8,
                    step: 0.,
                    steepness: VERTICAL,
                    below: END,
                });
            }
            (top, winding) = (bottom, winding + turn);
        }
        chains[first_chain..].sort_unstable_by_key(|it| it.top);
        Shape {
            chains: first_chain as u32..chains.len() as u32,
            rule,
            area: bounds,
            is_intricate: length > Self::MAX_SORTED_LENGTH,
            length: length as u32,
            line_count: (lines.len() - first_line) as u32,
            periods: None,
        }
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
