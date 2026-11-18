//! Pixels: coverage masks, premultiplied RGBA layers, and what blends them.

use std::iter::once;
use std::ops::Range;
use std::rc::Rc;

use super::blur::blur;
use super::{blend, edges};
use crate::abi::{Matrix, Rect, RoundedRect};
pub use crate::gfx::Path;
use crate::gfx::{Command, Fill, PathBuilder as _, Pixmap, Point, Style, Transform};
use crate::parallel;
use crate::small_vec::SmallVec;

/// Premultiplied.
pub type Pixel = [u8; 4];

const MAX_PIXELS: i64 = 1 << 27;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct IntRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Baseline x86-64 has no instruction for `f32::floor`.
#[inline]
fn floor(value: f32) -> i32 {
    const LIMIT: f32 = (1 << 24) as f32;
    let value = value.clamp(-LIMIT, LIMIT);
    value as i32 - i32::from(value < value as i32 as f32)
}

impl IntRect {
    pub fn new(left: i32, top: i32, right: i32, bottom: i32) -> IntRect {
        IntRect {
            left,
            top,
            right,
            bottom,
        }
    }

    pub fn around(rect: Rect) -> IntRect {
        const SLACK: f32 = 1. / 256.;
        let (down, up) = (
            |value: f32| floor(value + SLACK),
            |value: f32| -floor(SLACK - value),
        );
        IntRect::new(
            down(rect.x),
            down(rect.y),
            up(rect.x + rect.width),
            up(rect.y + rect.height),
        )
    }

    pub fn nearest(rect: Rect) -> IntRect {
        let round = |value: f32| floor(value + 0.5);
        IntRect::new(
            round(rect.x),
            round(rect.y),
            round(rect.x + rect.width),
            round(rect.y + rect.height),
        )
    }

    pub fn width(self) -> usize {
        (self.right - self.left).max(0) as usize
    }

    pub fn height(self) -> usize {
        (self.bottom - self.top).max(0) as usize
    }

    pub fn area(self) -> i64 {
        self.width() as i64 * self.height() as i64
    }

    pub fn is_empty(self) -> bool {
        self.right <= self.left || self.bottom <= self.top
    }

    pub fn intersect(self, other: IntRect) -> IntRect {
        IntRect::new(
            self.left.max(other.left),
            self.top.max(other.top),
            self.right.min(other.right),
            self.bottom.min(other.bottom),
        )
    }

    pub fn union(self, other: IntRect) -> IntRect {
        if self.is_empty() || other.is_empty() {
            return if self.is_empty() { other } else { self };
        }
        IntRect::new(
            self.left.min(other.left),
            self.top.min(other.top),
            self.right.max(other.right),
            self.bottom.max(other.bottom),
        )
    }

    pub fn overlaps(self, other: IntRect) -> bool {
        !self.intersect(other).is_empty()
    }

    pub fn contains(self, other: IntRect) -> bool {
        self.intersect(other) == other
    }

    pub fn outset(self, by: i32) -> IntRect {
        IntRect::new(
            self.left - by,
            self.top - by,
            self.right + by,
            self.bottom + by,
        )
    }

    pub fn offset(self, x: i32, y: i32) -> IntRect {
        IntRect::new(self.left + x, self.top + y, self.right + x, self.bottom + y)
    }

    /// The pieces that are outside of `hole`.
    pub fn without(self, hole: IntRect) -> impl Iterator<Item = IntRect> {
        let hole = if self.overlaps(hole) {
            self.intersect(hole)
        } else {
            IntRect {
                top: self.bottom,
                ..self
            }
        };
        [
            IntRect {
                bottom: hole.top,
                ..self
            },
            IntRect {
                top: hole.bottom,
                ..self
            },
            IntRect::new(self.left, hole.top, hole.left, hole.bottom),
            IntRect::new(hole.right, hole.top, self.right, hole.bottom),
        ]
        .into_iter()
        .filter(|piece| !piece.is_empty())
    }

    pub fn to_rect(self) -> Rect {
        Rect {
            x: self.left as f32,
            y: self.top as f32,
            width: self.width() as f32,
            height: self.height() as f32,
        }
    }
}

pub fn transform([a, b, c, d, e, f]: Matrix) -> Transform {
    Transform::from_row(a, b, c, d, e, f)
}

pub fn map_point(matrix: &Transform, x: f32, y: f32) -> (f32, f32) {
    (
        matrix.sx * x + matrix.kx * y + matrix.tx,
        matrix.ky * x + matrix.sy * y + matrix.ty,
    )
}

pub fn map_rect(matrix: &Transform, rect: Rect) -> Rect {
    if matrix.kx == 0. && matrix.ky == 0. && matrix.sx > 0. && matrix.sy > 0. {
        let (x, y) = map_point(matrix, rect.x, rect.y);
        return Rect {
            x,
            y,
            width: rect.width * matrix.sx,
            height: rect.height * matrix.sy,
        };
    }
    let (right, bottom) = (rect.x + rect.width, rect.y + rect.height);
    let corners = [
        (rect.x, rect.y),
        (right, rect.y),
        (right, bottom),
        (rect.x, bottom),
    ];
    let corners = corners.map(|(x, y)| map_point(matrix, x, y));
    let fold = |pick: fn((f32, f32)) -> f32, f: fn(f32, f32) -> f32| {
        corners.map(pick).into_iter().reduce(f).unwrap_or(0.)
    };
    let (x, y) = (fold(|at| at.0, f32::min), fold(|at| at.1, f32::min));
    Rect {
        x,
        y,
        width: fold(|at| at.0, f32::max) - x,
        height: fold(|at| at.1, f32::max) - y,
    }
}

pub fn average_scale(matrix: &Transform) -> f32 {
    (matrix.sx * matrix.sy - matrix.kx * matrix.ky).abs().sqrt()
}

pub fn has_radii(shape: &RoundedRect) -> bool {
    shape.radii.iter().any(|[x, y]| *x > 0. && *y > 0.)
}

pub fn add_rounded_rect(path: &mut Path, shape: &RoundedRect) {
    const K: f32 = 1. - 0.552_284_8;
    let Rect {
        x,
        y,
        width,
        height,
    } = shape.rect;
    let (right, bottom) = (x + width, y + height);
    let [tl, tr, br, bl] = shape
        .radii
        .map(|[x, y]| if x > 0. && y > 0. { [x, y] } else { [0., 0.] });
    path.move_to([x + tl[0], y]);
    path.line_to([right - tr[0], y]);
    if tr[0] > 0. {
        path.curve_to(
            [right - tr[0] * K, y],
            [right, y + tr[1] * K],
            [right, y + tr[1]],
        );
    }
    path.line_to([right, bottom - br[1]]);
    if br[0] > 0. {
        path.curve_to(
            [right, bottom - br[1] * K],
            [right - br[0] * K, bottom],
            [right - br[0], bottom],
        );
    }
    path.line_to([x + bl[0], bottom]);
    if bl[0] > 0. {
        path.curve_to(
            [x + bl[0] * K, bottom],
            [x, bottom - bl[1] * K],
            [x, bottom - bl[1]],
        );
    }
    path.line_to([x, y + tl[1]]);
    if tl[0] > 0. {
        path.curve_to([x, y + tl[1] * K], [x + tl[0] * K, y], [x + tl[0], y]);
    }
    path.close();
}

/// Pixels that `shape` covers entirely: the rows between its corners.
pub fn inner_band(shape: &RoundedRect, matrix: &Transform) -> IntRect {
    if matrix.has_skew() || matrix.sy < 0. {
        return IntRect::default();
    }
    let [tl, tr, br, bl] = shape.radii.map(|[_, y]| y.max(0.));
    let (top, bottom) = (tl.max(tr), br.max(bl));
    let height = (shape.rect.height - top - bottom).max(0.);
    let band = map_rect(
        matrix,
        Rect {
            y: shape.rect.y + top,
            height,
            ..shape.rect
        },
    );
    let (up, down) = (
        |value: f32| (value - 0.004).ceil() as i32,
        |value: f32| (value + 0.004).floor() as i32,
    );
    IntRect::new(
        up(band.x),
        up(band.y),
        down(band.x + band.width),
        down(band.y + band.height),
    )
}

pub fn rounded_rect_path(shape: &RoundedRect) -> Path {
    let mut path = Path::new();
    add_rounded_rect(&mut path, shape);
    path
}

#[inline]
pub fn multiply(a: u8, b: u8) -> u8 {
    let product = u16::from(a) * u16::from(b) + 128;
    ((product + (product >> 8)) >> 8) as u8
}

pub fn premultiply(color: u32) -> Pixel {
    let [r, g, b, a] = color.to_be_bytes();
    [multiply(r, a), multiply(g, a), multiply(b, a), a]
}

#[inline]
pub fn demultiply([r, g, b, a]: Pixel) -> [u8; 4] {
    const RECIPROCALS: [u32; 256] = {
        let (mut table, mut alpha) = ([0; 256], 1);
        while alpha < 256 {
            table[alpha] = ((255 << 16) + alpha as u32 / 2) / alpha as u32;
            alpha += 1;
        }
        table
    };
    if a == 255 {
        return [r, g, b, a];
    }
    let divide = |channel: u8| {
        ((u32::from(channel) * RECIPROCALS[usize::from(a)] + (1 << 15)) >> 16).min(255) as u8
    };
    [divide(r), divide(g), divide(b), a]
}

/// `multiply` for the four channels.
#[inline]
pub fn scale(pixel: Pixel, by: u8) -> Pixel {
    const EVEN: u32 = 0x00FF_00FF;
    let pair = |channels: u32| {
        let product = (channels & EVEN) * u32::from(by) + 0x0080_0080;
        (product + (product >> 8 & EVEN)) >> 8 & EVEN
    };
    let bits = u32::from_ne_bytes(pixel);
    (pair(bits) | pair(bits >> 8) << 8).to_ne_bytes()
}

#[inline]
pub fn over(target: Pixel, source: Pixel) -> Pixel {
    let kept = scale(target, 255 - source[3]);
    std::array::from_fn(|channel| source[channel].saturating_add(kept[channel]))
}

/// Returns what the function of `wide.rs` does, if it can run.
macro_rules! prefer_wide {
    ($name:ident($($argument:expr),*)) => {
        #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
        if super::wide::is_available() {
            // SAFETY: the processor has the instructions.
            return unsafe { super::wide::$name($($argument),*) };
        }
    };
}
pub(super) use prefer_wide;

/// Written so that it compiles to vector instructions.
#[inline(always)]
fn over_four(target: &mut [Pixel; 4], source: &[Pixel; 4]) {
    let kept = |it: Pixel| ((!u32::from_le_bytes(it) >> 24) * 0x0101_0101).to_le_bytes();
    let kept = [
        kept(source[0]),
        kept(source[1]),
        kept(source[2]),
        kept(source[3]),
    ];
    let (target, source, kept) = (
        target.as_flattened_mut(),
        source.as_flattened(),
        kept.as_flattened(),
    );
    for index in 0..16 {
        let kept = if cfg!(target_arch = "x86_64") {
            kept[index]
        } else {
            255 - source[index | 3]
        };
        target[index] = source[index].saturating_add(multiply(target[index], kept));
    }
}

#[inline(always)]
fn scale_four(pixels: &[Pixel; 4], by: [u8; 4]) -> [Pixel; 4] {
    let [a, b, c, d] = by;
    let (mut scaled, spread) = (*pixels, [[a; 4], [b; 4], [c; 4], [d; 4]]);
    for (index, channel) in scaled.as_flattened_mut().iter_mut().enumerate() {
        *channel = multiply(
            *channel,
            if cfg!(target_arch = "x86_64") {
                spread.as_flattened()[index]
            } else {
                by[index / 4]
            },
        );
    }
    scaled
}

pub fn fill_rows_through<'a>(
    rows: impl Iterator<Item = (&'a mut [Pixel], &'a [u8])>,
    color: Pixel,
) {
    prefer_wide!(fill_through(rows, color));
    rows.for_each(|(row, coverage)| fill_through(row, color, &coverage[..row.len()]));
}

pub fn fill_through(row: &mut [Pixel], color: Pixel, coverage: &[u8]) {
    prefer_wide!(fill_through(once((row, coverage)), color));
    let ((runs, rest), (covered_runs, covered_rest)) = (row.as_chunks_mut(), coverage.as_chunks());
    for (pixels, coverage) in runs
        .iter_mut()
        .zip(covered_runs)
        .filter(|(_, coverage)| **coverage != [0; 4])
    {
        match *coverage == [255; 4] && color[3] == 255 {
            true => *pixels = [color; 4],
            false => over_four(pixels, &scale_four(&[color; 4], *coverage)),
        }
    }
    rest.iter_mut()
        .zip(covered_rest)
        .for_each(|(pixel, by)| *pixel = over(*pixel, scale(color, *by)));
}

/// The colors of a box.
pub struct Outlined {
    pub fill: Pixel,
    pub border: Pixel,
    both: Pixel,
}

impl Outlined {
    pub fn new(fill: Pixel, border: Pixel) -> Outlined {
        Outlined {
            fill,
            border,
            both: over(fill, border),
        }
    }

    /// For a pixel of which so much is inside of the outer edge, and outside of the inner one.
    #[inline(always)]
    pub fn at(&self, coverage: [u8; 2]) -> Pixel {
        match coverage {
            [0, _] => [0; 4],
            [255, 0] => self.fill,
            [255, 255] => self.both,
            [outer, inner] => scale(over(self.fill, scale(self.border, inner)), outer),
        }
    }

    #[inline(always)]
    pub fn over(&self, pixel: Pixel, coverage: [u8; 2]) -> Pixel {
        match self.at(coverage) {
            [0, 0, 0, 0] => pixel,
            color @ [.., 255] => color,
            color => over(pixel, color),
        }
    }
}

#[inline]
pub fn fill_outlined(row: &mut [Pixel], colors: &Outlined, coverage: &[[u8; 2]]) {
    if row.len() > 1 {
        prefer_wide!(fill_outlined(row, colors, coverage));
    }
    row.iter_mut()
        .zip(coverage)
        .for_each(|(pixel, coverage)| *pixel = colors.over(*pixel, *coverage));
}

#[inline(always)]
pub fn set_row(row: &mut [Pixel], color: Pixel) {
    row.as_chunks_mut().0.fill([color; 8]);
    match row.last_chunk_mut() {
        Some(last) => *last = [color; 8],
        None => row.fill(color),
    }
}

pub fn set_rows<'a>(rows: impl Iterator<Item = &'a mut [Pixel]>, color: Pixel) {
    prefer_wide!(set(rows, color));
    rows.for_each(|row| set_row(row, color));
}

pub fn fill_rows<'a>(rows: impl Iterator<Item = &'a mut [Pixel]>, color: Pixel) {
    match color[3] {
        255 => set_rows(rows, color),
        0 => rows.for_each(drop),
        _ => {
            prefer_wide!(tint(rows, color));
            rows.for_each(|row| fill_row(row, color));
        }
    }
}

pub fn fill_row(row: &mut [Pixel], color: Pixel) {
    match color[3] {
        255 => set_row(row, color),
        0 => {}
        _ => {
            prefer_wide!(tint(once(row), color));
            let (runs, rest) = row.as_chunks_mut::<8>();
            let (mut before, mut after) = ([[0; 4]; 8], [color; 8]);
            for pixels in runs {
                if *pixels != before {
                    (before, after) = (*pixels, *pixels);
                    after
                        .as_chunks_mut()
                        .0
                        .iter_mut()
                        .for_each(|four| over_four(four, &[color; 4]));
                }
                *pixels = after;
            }
            rest.iter_mut()
                .for_each(|pixel| *pixel = over(*pixel, color));
        }
    }
}

pub fn blend_rows<'a>(rows: impl Iterator<Item = (&'a mut [Pixel], &'a [Pixel])>, by: u8) {
    prefer_wide!(blend(rows, by));
    rows.for_each(|(row, colors)| blend_row(row, &colors[..row.len()], by));
}

pub fn blend_row(row: &mut [Pixel], colors: &[Pixel], by: u8) {
    prefer_wide!(blend(once((row, colors)), by));
    let ((runs, rest), (color_runs, color_rest)) = (row.as_chunks_mut(), colors.as_chunks());
    let shown = runs
        .iter_mut()
        .zip(color_runs)
        .filter(|(_, colors)| **colors != [[0; 4]; 4]);
    match by {
        255 => shown.for_each(|(pixels, colors)| {
            match colors.iter().fold(255, |all, it| all & it[3]) {
                255 => *pixels = *colors,
                _ => over_four(pixels, colors),
            }
        }),
        _ => shown.for_each(|(pixels, colors)| over_four(pixels, &scale_four(colors, [by; 4]))),
    }
    rest.iter_mut()
        .zip(color_rest)
        .for_each(|(pixel, color)| *pixel = over(*pixel, scale(*color, by)));
}

pub fn stamp<'a>(runs: impl Iterator<Item = &'a mut [Pixel; 8]>, colors: [Pixel; 8]) {
    prefer_wide!(stamp(runs, colors));
    runs.for_each(|run| blend_row(run, &colors, 255));
}

/// Between RGBA and BGRA.
#[inline]
pub fn swap_red_and_blue(pixel: Pixel) -> Pixel {
    let bits = u32::from_le_bytes(pixel);
    (bits & 0xFF00_FF00 | (bits & 0x00FF_00FF).rotate_left(16)).to_le_bytes()
}

/// Zero outside of `rect`.
#[derive(Clone, Default)]
pub struct Coverage {
    pub rect: IntRect,
    pub data: Vec<u8>,
}

impl Coverage {
    pub fn filled(rect: IntRect, value: u8) -> Coverage {
        if rect.is_empty() || rect.area() > MAX_PIXELS {
            return Coverage::default();
        }
        Coverage {
            rect,
            data: vec![value; rect.area() as usize],
        }
    }

    /// The part of the path that is in `area`.
    pub fn of_path<'a>(
        path: &[Command],
        style: impl Into<Style<'a>>,
        matrix: &Transform,
        area: IntRect,
    ) -> Coverage {
        match style.into() {
            _ if area.is_empty() || !matrix.is_finite() => Coverage::filled(area, 0),
            Style::Fill(rule) => edges::fill(path, rule == Fill::EvenOdd, matrix, area),
            Style::Stroke(stroke) => {
                let (mut edges, corners) = (
                    edges::Edges::new(matrix, area),
                    [(area.left, area.top), (area.right, area.bottom)],
                );
                stroke.outline(
                    path,
                    matrix,
                    corners.map(|(x, y)| Point::new(x as f32, y as f32)),
                    &mut |part| edges.add(part),
                );
                edges.fill(|winding| winding != 0)
            }
        }
    }

    pub fn of_positive_path(path: &[Command], matrix: &Transform, area: IntRect) -> Coverage {
        let sign = if matrix.sx * matrix.sy < matrix.kx * matrix.ky {
            -1
        } else {
            1
        };
        edges::fill_where(path, |winding| winding * sign < 0, matrix, area)
    }

    pub fn of_shape(shape: &RoundedRect, matrix: &Transform, area: IntRect) -> Coverage {
        let (path, inside) = (
            rounded_rect_path(shape),
            inner_band(shape, matrix).intersect(area),
        );
        let Rect {
            x,
            y,
            width,
            height,
        } = shape.rect;
        let corners = [
            (x, y),
            (x + width, y),
            (x + width, y + height),
            (x, y + height),
        ]
        .map(|(x, y)| matrix.map(Point::new(x, y)));
        let of_piece = |piece| match has_radii(shape) {
            true => Coverage::of_path(&path, Fill::NonZero, matrix, piece),
            false => edges::fill_exactly(corners, piece),
        };
        if inside.is_empty() {
            return of_piece(area);
        }
        let mut coverage = Coverage::filled(area, 255);
        for piece in area
            .without(inside)
            .filter(|_| !coverage.rect.is_empty())
            .collect::<SmallVec<_, 4>>()
        {
            let edge = of_piece(piece);
            for (y, row) in (piece.top..).zip(edge.data.chunks(piece.width())) {
                let start =
                    (y - area.top) as usize * area.width() + (piece.left - area.left) as usize;
                coverage.data[start..start + row.len()].copy_from_slice(row);
            }
        }
        coverage
    }

    /// `left..right` and `y` are in `rect`.
    fn row(&self, y: i32, left: i32, right: i32) -> &[u8] {
        let start =
            (y - self.rect.top) as usize * self.rect.width() + (left - self.rect.left) as usize;
        &self.data[start..start + (right - left) as usize]
    }

    fn combine(&mut self, other: &Coverage, f: impl Fn(u8, u8) -> u8) {
        let (rect, shared) = (self.rect, self.rect.intersect(other.rect));
        for (y, row) in (rect.top..).zip(self.data.chunks_mut(rect.width().max(1))) {
            if shared.is_empty() || !(shared.top..shared.bottom).contains(&y) {
                row.iter_mut().for_each(|value| *value = f(*value, 0));
                continue;
            }
            let (before, rest) = row.split_at_mut((shared.left - rect.left) as usize);
            let (inside, after) = rest.split_at_mut(shared.width());
            before
                .iter_mut()
                .chain(after)
                .for_each(|value| *value = f(*value, 0));
            for (value, other) in inside
                .iter_mut()
                .zip(other.row(y, shared.left, shared.right))
            {
                *value = f(*value, *other);
            }
        }
    }

    pub fn clear(&mut self, rect: IntRect) {
        let (all, rect) = (self.rect, rect.intersect(self.rect));
        for y in (rect.top..rect.bottom).filter(|_| !rect.is_empty()) {
            self.data[(y - all.top) as usize * all.width() + (rect.left - all.left) as usize..]
                [..rect.width()]
                .fill(0);
        }
    }

    pub fn intersect(&mut self, other: &Coverage) {
        self.combine(other, multiply);
    }

    pub fn subtract(&mut self, other: &Coverage) {
        self.combine(other, |value, other| multiply(value, 255 - other));
    }

    pub fn unite(&mut self, other: &Coverage) {
        self.combine(other, u8::max);
    }

    pub fn add(&mut self, other: &Coverage) {
        self.combine(other, u8::saturating_add);
    }

    pub fn remove(&mut self, other: &Coverage) {
        self.combine(other, u8::saturating_sub);
    }

    pub fn harden(&mut self) {
        self.data
            .iter_mut()
            .for_each(|value| *value = if *value >= 128 { 255 } else { 0 });
    }

    pub fn invert(&mut self) {
        self.data.iter_mut().for_each(|value| *value = 255 - *value);
    }

    pub fn blurred(&self, sigma: f32, rect: IntRect) -> Coverage {
        let mut result = Coverage::filled(rect, 0);
        blur::<1>(
            (self.data.as_chunks().0, self.rect),
            (result.data.as_chunks_mut().0, result.rect),
            [sigma; 2],
            false,
        );
        result
    }
}

#[derive(Clone, Default)]
pub struct Clip {
    pub rect: IntRect,
    /// Covers `rect`.
    pub mask: Option<Rc<Coverage>>,
    /// Where the mask is known to let everything through.
    pub open: IntRect,
}

impl Clip {
    pub fn new(rect: IntRect) -> Clip {
        Clip {
            rect,
            mask: None,
            open: rect,
        }
    }

    pub fn within_rect(&self, rect: IntRect) -> Clip {
        Clip {
            rect: self.rect.intersect(rect),
            ..self.clone()
        }
    }

    pub fn within(&self, mut coverage: Coverage) -> Clip {
        if let Some(mask) = &self.mask {
            coverage.intersect(mask);
        }
        Clip {
            rect: self.rect.intersect(coverage.rect),
            mask: Some(Rc::new(coverage)),
            open: IntRect::default(),
        }
    }
}

pub enum Paint<'a> {
    Solid(Pixel),
    /// Writes the pixels of row `y` from column `x` on.
    Shader(&'a dyn Fn(i32, i32, &mut [Pixel])),
}

pub enum Rows<'a> {
    Same(Pixel),
    /// With where its corner is, and an opacity.
    Of(&'a Pixmap, [i32; 2], u8),
}

struct RowsMut<'a> {
    rows: std::slice::ChunksExactMut<'a, Pixel>,
    columns: Range<usize>,
}

impl<'a> Iterator for RowsMut<'a> {
    type Item = &'a mut [Pixel];

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        self.rows.next().map(|it| &mut it[self.columns.clone()])
    }
}

pub struct Layer {
    pub rect: IntRect,
    pub pixmap: Pixmap,
}

impl Layer {
    pub fn new(rect: IntRect) -> Option<Layer> {
        if rect.area() > MAX_PIXELS {
            return None;
        }
        let pixmap = Pixmap::new(rect.width() as u32, rect.height() as u32)?;
        Some(Layer { rect, pixmap })
    }

    pub fn pixels(&self) -> &[Pixel] {
        self.pixmap.data().as_chunks().0
    }

    pub fn pixels_mut(&mut self) -> &mut [Pixel] {
        self.pixmap.data_mut().as_chunks_mut().0
    }

    pub fn row(&self, y: i32, left: i32, right: i32) -> &[Pixel] {
        let start =
            (y - self.rect.top) as usize * self.rect.width() + (left - self.rect.left) as usize;
        &self.pixels()[start..start + (right - left) as usize]
    }

    pub fn row_mut(&mut self, y: i32, left: i32, right: i32) -> &mut [Pixel] {
        let start =
            (y - self.rect.top) as usize * self.rect.width() + (left - self.rect.left) as usize;
        &mut self.pixels_mut()[start..start + (right - left) as usize]
    }

    pub fn copy(&self, rect: IntRect) -> Option<Layer> {
        let mut copy = Layer::new(rect)?;
        let shared = rect.intersect(self.rect);
        if !shared.is_empty() {
            for y in shared.top..shared.bottom {
                (copy.row_mut(y, shared.left, shared.right)).copy_from_slice(self.row(
                    y,
                    shared.left,
                    shared.right,
                ));
            }
        }
        Some(copy)
    }

    /// Source-over. `shape` is the coverage of `rect`, row by row.
    pub fn fill(&mut self, rect: IntRect, shape: Option<&[u8]>, clip: &Clip, paint: &Paint) {
        let area = rect.intersect(clip.rect).intersect(self.rect);
        if area.is_empty() || matches!(paint, Paint::Solid([0, 0, 0, 0])) {
            return;
        }
        let (mut colors, mut combined) = (Vec::new(), Vec::new());
        for y in area.top..area.bottom {
            let start = (y - rect.top) as usize * rect.width() + (area.left - rect.left) as usize;
            let shape = shape.map(|shape| &shape[start..start + area.width()]);
            let is_open = clip.open.contains(IntRect {
                top: y,
                bottom: y + 1,
                ..area
            });
            let mask = clip
                .mask
                .as_ref()
                .filter(|_| !is_open)
                .map(|mask| mask.row(y, area.left, area.right));
            let coverage = match (shape, mask) {
                (Some(shape), Some(mask)) => {
                    combined.clear();
                    combined.extend(shape.iter().zip(mask).map(|(a, b)| multiply(*a, *b)));
                    Some(&combined[..])
                }
                (shape, mask) => shape.or(mask),
            };
            let row = self.row_mut(y, area.left, area.right);
            match (paint, coverage) {
                (Paint::Solid(color), None) => fill_row(row, *color),
                (Paint::Solid(color), Some(coverage)) => fill_through(row, *color, coverage),
                (Paint::Shader(shade), coverage) => {
                    let end = coverage.map_or(row.len(), |it| {
                        it.iter().rposition(|it| *it != 0).map_or(0, |it| it + 1)
                    });
                    let start = coverage
                        .and_then(|it| it.iter().position(|it| *it != 0))
                        .unwrap_or(0);
                    if start == end {
                        continue;
                    }
                    colors.resize(end - start, [0; 4]);
                    shade(area.left + start as i32, y, &mut colors);
                    if let Some(coverage) = coverage {
                        colors
                            .iter_mut()
                            .zip(&coverage[start..])
                            .for_each(|(color, by)| *color = scale(*color, *by));
                    }
                    blend_row(&mut row[start..end], &colors, 255);
                }
            }
        }
    }

    fn rows_mut(&mut self, area: IntRect) -> impl Iterator<Item = &mut [Pixel]> {
        let (width, start, above) = (
            self.rect.width(),
            (area.left - self.rect.left) as usize,
            (area.top - self.rect.top) as usize,
        );
        self.pixels_mut()
            .chunks_exact_mut(width)
            .skip(above)
            .take(area.height())
            .map(move |it| &mut it[start..start + area.width()])
    }

    /// `work` gets some of the rows, and where the first is.
    fn in_bands(&mut self, area: IntRect, work: impl Fn(i32, RowsMut) + Sync) {
        if area.is_empty() {
            return;
        }
        let (width, start, above) = (
            self.rect.width(),
            (area.left - self.rect.left) as usize,
            (area.top - self.rect.top) as usize,
        );
        parallel::in_bands(
            &mut self.pixels_mut()[above * width..][..area.height() * width],
            width,
            area.area(),
            |first, band| {
                work(
                    area.top + first as i32,
                    RowsMut {
                        rows: band.chunks_exact_mut(width),
                        columns: start..start + area.width(),
                    },
                );
            },
        );
    }

    /// Source-over. Its edges need not be between pixels.
    pub fn fill_rect(&mut self, rect: Rect, color: Pixel, clip: IntRect) {
        let [left, top, right, bottom] =
            [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]
                .map(|it| floor(it.clamp(-4e6, 4e6) * 256.));
        let area = IntRect::new(left >> 8, top >> 8, (right + 255) >> 8, (bottom + 255) >> 8)
            .intersect(clip)
            .intersect(self.rect);
        if area.is_empty() || color == [0; 4] {
            return;
        }
        let part = |at: i32, start: i32, end: i32| end.min((at + 1) << 8) - start.max(at << 8);
        let [first, last] = [
            ((top + 255) >> 8).clamp(area.top, area.bottom),
            (bottom >> 8).clamp(area.top, area.bottom),
        ];
        for band in [
            IntRect {
                bottom: first,
                ..area
            },
            IntRect {
                top: first,
                bottom: last,
                ..area
            },
            IntRect {
                top: last.max(first),
                ..area
            },
        ] {
            if band.is_empty() {
                continue;
            }
            let down = part(band.top, top, bottom);
            let at = |x: i32| scale(color, ((part(x, left, right) * down - 1).max(0) >> 8) as u8);
            if area.width() <= 8 && self.rect.width() >= 8 {
                let start = area.left.min(self.rect.right - 8);
                let colors = std::array::from_fn(|it| {
                    Some(start + it as i32)
                        .filter(|x| (area.left..area.right).contains(x))
                        .map_or([0; 4], at)
                });
                stamp(
                    self.rows_mut(IntRect {
                        left: start,
                        right: start + 8,
                        ..band
                    })
                    .filter_map(|it| it.first_chunk_mut()),
                    colors,
                );
                continue;
            }
            let ([start, end], middle) = (
                [at(area.left), at(area.right - 1)],
                scale(color, ((256 * down - 1) >> 8) as u8),
            );
            let [before, after] = [start, end].map(|it| usize::from(it != middle));
            if band == self.rect
                && before + after == 0
                && middle[3] == 255
                && self.pixmap.fill_instead_of_copying(middle)
            {
                return;
            }
            self.in_bands(band, |_, rows| {
                let inside = rows.map(|row| {
                    let (last, length) = (row.len() - 1, row.len());
                    if before > 0 {
                        row[0] = over(row[0], start);
                    }
                    if after > 0 && last >= before {
                        row[last] = over(row[last], end);
                    }
                    &mut row[before..(length - after).max(before)]
                });
                fill_rows(inside, middle);
            });
        }
    }

    pub fn fill_coverage(&mut self, coverage: &Coverage, clip: &Clip, paint: &Paint) {
        self.fill(coverage.rect, Some(&coverage.data), clip, paint);
    }

    pub fn draw(&mut self, source: &Layer, shape: Option<&Coverage>, clip: &Clip) {
        let copy = |x: i32, y: i32, row: &mut [Pixel]| {
            row.copy_from_slice(source.row(y, x, x + row.len() as i32))
        };
        let clip = clip.within_rect(source.rect);
        match shape {
            Some(shape) => self.fill_coverage(shape, &clip, &Paint::Shader(&copy)),
            None if clip.mask.is_none() => {
                self.draw_with_mode(source, blend::Mode::SourceOver, &clip)
            }
            None => self.fill(source.rect, None, &clip, &Paint::Shader(&copy)),
        }
    }

    pub fn scale_alpha(&mut self, opacity: f32) {
        let alpha = (opacity.clamp(0., 1.) * 255.).round() as u8;
        if alpha != 255 {
            self.pixels_mut()
                .iter_mut()
                .for_each(|pixel| *pixel = scale(*pixel, alpha));
        }
    }

    /// Multiplies with the alpha or the luminance of `mask`, and clears what is outside of it.
    /// Becomes what looks like this when it is drawn over `behind`, which has the same size.
    pub fn take_out(&mut self, behind: &Layer) {
        for (pixel, behind) in self
            .pixels_mut()
            .iter_mut()
            .zip(behind.pixels())
            .filter(|it| it.1[3] != 0 && it.0[3] != 255)
        {
            let needed = |is: u8, was: u8| match is < was {
                true => (u32::from(was - is) * 255).div_ceil(was.into()),
                false => {
                    (u32::from(is - was) * 255 + u32::from(255 - was) / 2)
                        / u32::from(255 - was).max(1)
                }
            };
            let alpha = pixel
                .iter()
                .zip(behind)
                .map(|(is, was)| needed(*is, *was))
                .fold(0, u32::max) as u8;
            let left = scale(*behind, 255 - alpha);
            *pixel = std::array::from_fn(|it| {
                if it == 3 {
                    alpha
                } else {
                    pixel[it].saturating_sub(left[it]).min(alpha)
                }
            });
        }
    }

    pub fn keep(&mut self, mask: &Layer, luminance: bool) {
        for piece in self.rect.without(mask.rect) {
            (piece.top..piece.bottom)
                .for_each(|y| self.row_mut(y, piece.left, piece.right).fill([0; 4]));
        }
        let IntRect {
            left,
            top,
            right,
            bottom,
        } = self.rect.intersect(mask.rect);
        for y in (top..bottom).filter(|_| left < right) {
            let pixels = self
                .row_mut(y, left, right)
                .iter_mut()
                .zip(mask.row(y, left, right));
            if !luminance {
                pixels.for_each(|(pixel, by)| *pixel = scale(*pixel, by[3]));
                continue;
            }
            for (pixel, [r, g, b, _]) in pixels {
                let by = 0.2125 * f32::from(*r) + 0.7154 * f32::from(*g) + 0.0721 * f32::from(*b);
                *pixel = scale(*pixel, by.round() as u8);
            }
        }
    }

    pub fn alpha(&self) -> Coverage {
        Coverage {
            rect: self.rect,
            data: self.pixels().iter().map(|pixel| pixel[3]).collect(),
        }
    }

    /// For any mode: blends all of the clip, with `source` transparent outside of its bounds.
    pub fn draw_with_mode(&mut self, source: &Layer, mode: blend::Mode, clip: &Clip) {
        self.combine(
            source.rect,
            &Rows::Of(&source.pixmap, [source.rect.left, source.rect.top], 255),
            mode,
            clip,
        );
    }

    /// Likewise, for the part of `source` that is in `rect`.
    pub fn combine(&mut self, rect: IntRect, source: &Rows, mode: blend::Mode, clip: &Clip) {
        let area = clip.rect.intersect(self.rect);
        if area.is_empty() {
            return;
        }
        if mode.clears_backdrop() {
            area.without(rect).for_each(|it| {
                self.combine_within(it, &Rows::Same([0; 4]), blend::Mode::Source, clip)
            });
        }
        let IntRect {
            left,
            top,
            right,
            bottom,
        } = area.intersect(rect);
        if left < right {
            self.combine_within(
                IntRect {
                    left,
                    top,
                    right,
                    bottom,
                },
                source,
                mode,
                clip,
            );
        }
    }

    fn combine_within(&mut self, area: IntRect, source: &Rows, mode: blend::Mode, clip: &Clip) {
        let (left, mask) = (
            area.left,
            clip.mask.as_deref().filter(|_| !clip.open.contains(area)),
        );
        if (mode, area, mask.is_none()) == (blend::Mode::Source, self.rect, true) {
            match *source {
                Rows::Of(pixmap, [x, y], 255)
                    if IntRect::new(
                        x,
                        y,
                        x + pixmap.width() as i32,
                        y + pixmap.height() as i32,
                    ) == area
                        && let Some(shared) = pixmap.shared() =>
                {
                    return self.pixmap = shared;
                }
                Rows::Same(color) if self.pixmap.fill_instead_of_copying(color) => return,
                _ => {}
            }
        }
        self.in_bands(area, |top, rows| {
            let (mut colors, mut blended) = (Vec::new(), Vec::new());
            if let Rows::Same(color) = *source {
                if mode == blend::Mode::Source && mask.is_none() {
                    return set_rows(rows, color);
                }
                colors.resize(area.width(), color);
            }
            if let (&Rows::Of(pixmap, [x, y], by), blend::Mode::SourceOver, None) =
                (source, mode, mask)
            {
                let pixels = pixmap
                    .data()
                    .as_chunks()
                    .0
                    .chunks_exact(pixmap.width() as usize)
                    .skip((top - y) as usize);
                return blend_rows(rows.zip(pixels.map(|it| &it[(left - x) as usize..])), by);
            }
            for (y, row) in (top..).zip(rows) {
                let mut above = &colors[..];
                if let Rows::Of(pixmap, [x0, y0], by) = *source {
                    let pixels = &pixmap.data().as_chunks().0
                        [(y - y0) as usize * pixmap.width() as usize + (left - x0) as usize..]
                        [..row.len()];
                    above = pixels;
                    if by != 255 {
                        colors.clear();
                        colors.extend(pixels.iter().map(|it| scale(*it, by)));
                        above = &colors;
                    }
                }
                let Some(mask) = mask else {
                    blend::blend(row, above, mode);
                    continue;
                };
                row.clone_into(&mut blended);
                blend::blend(&mut blended, above, mode);
                for ((pixel, from), coverage) in row
                    .iter_mut()
                    .zip(&blended)
                    .zip(mask.row(y, left, area.right))
                {
                    for (channel, from) in pixel.iter_mut().zip(from) {
                        *channel = multiply(*from, *coverage)
                            .saturating_add(multiply(*channel, 255 - coverage));
                    }
                }
            }
        });
    }

    /// Interpolates towards `source` by the clip's coverage.
    pub fn replace(&mut self, source: &Layer, clip: &Clip) {
        self.draw_with_mode(source, blend::Mode::Source, &clip.within_rect(source.rect));
    }

    pub fn blurred(&self, sigma: [f32; 2], rect: IntRect) -> Option<Layer> {
        let mut result = Layer::new(rect)?;
        blur(
            (self.pixels(), self.rect),
            (result.pixels_mut(), rect),
            sigma,
            false,
        );
        Some(result)
    }

    /// As if it were mirrored at its edges.
    pub fn blur_mirrored(&mut self, sigma: f32) {
        if let Some(mut result) = Layer::new(self.rect) {
            blur(
                (self.pixels(), self.rect),
                (result.pixels_mut(), self.rect),
                [sigma; 2],
                true,
            );
            *self = result;
        }
    }
}
