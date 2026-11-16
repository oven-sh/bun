//! Pixels: coverage masks, premultiplied RGBA layers, and what blends them.

use std::rc::Rc;

use resvg::tiny_skia::{
    self, LineCap, LineJoin, PathSegment, PathStroker, Pixmap, PixmapPaint, StrokeDash, Transform,
};
use smallvec::SmallVec;
use zeno::{Command, PathBuilder as _, Point};

use super::edges;
use crate::abi::{Matrix, Rect, RoundedRect};

pub type Path = Vec<Command>;
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
        const LIMIT: f32 = (1 << 24) as f32;
        const SLACK: f32 = 1. / 256.;
        let down = |value: f32| (value + SLACK).floor().clamp(-LIMIT, LIMIT) as i32;
        let up = |value: f32| (value - SLACK).ceil().clamp(-LIMIT, LIMIT) as i32;
        IntRect::new(
            down(rect.x),
            down(rect.y),
            up(rect.x + rect.width),
            up(rect.y + rect.height),
        )
    }

    pub fn nearest(rect: Rect) -> IntRect {
        const LIMIT: f32 = (1 << 24) as f32;
        let round = |value: f32| (value + 0.5).floor().clamp(-LIMIT, LIMIT) as i32;
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

/// Written so that it compiles to vector instructions.
#[inline(always)]
fn over_four(target: &mut [Pixel; 4], source: &[Pixel; 4]) {
    let (target, source) = (target.as_flattened_mut(), source.as_flattened());
    for index in 0..16 {
        target[index] =
            source[index].saturating_add(multiply(target[index], 255 - source[index | 3]));
    }
}

#[inline(always)]
fn scale_four(pixels: &[Pixel; 4], by: [u8; 4]) -> [Pixel; 4] {
    let mut scaled = *pixels;
    for (index, channel) in scaled.as_flattened_mut().iter_mut().enumerate() {
        *channel = multiply(*channel, by[index / 4]);
    }
    scaled
}

pub fn fill_through(row: &mut [Pixel], color: Pixel, coverage: &[u8]) {
    let ((runs, rest), (covered_runs, covered_rest)) = (row.as_chunks_mut(), coverage.as_chunks());
    for (pixels, coverage) in runs
        .iter_mut()
        .zip(covered_runs)
        .filter(|(_, coverage)| **coverage != [0; 4])
    {
        over_four(pixels, &scale_four(&[color; 4], *coverage));
    }
    rest.iter_mut()
        .zip(covered_rest)
        .for_each(|(pixel, by)| *pixel = over(*pixel, scale(color, *by)));
}

pub fn set_row(row: &mut [Pixel], color: Pixel) {
    let (runs, rest) = row.as_chunks_mut();
    runs.fill([color; 8]);
    rest.fill(color);
}

pub fn fill_row(row: &mut [Pixel], color: Pixel) {
    match color[3] {
        255 => set_row(row, color),
        0 => {}
        _ => {
            let (runs, rest) = row.as_chunks_mut();
            runs.iter_mut()
                .for_each(|pixels| over_four(pixels, &[color; 4]));
            rest.iter_mut()
                .for_each(|pixel| *pixel = over(*pixel, color));
        }
    }
}

pub fn blend_row(row: &mut [Pixel], colors: &[Pixel], by: u8) {
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

pub fn path_from(path: &tiny_skia::Path) -> Path {
    let point = |point: tiny_skia::Point| Point::new(point.x, point.y);
    (path.segments())
        .map(|segment| match segment {
            PathSegment::MoveTo(to) => Command::MoveTo(point(to)),
            PathSegment::LineTo(to) => Command::LineTo(point(to)),
            PathSegment::QuadTo(a, to) => Command::QuadTo(point(a), point(to)),
            PathSegment::CubicTo(a, b, to) => Command::CurveTo(point(a), point(b), point(to)),
            PathSegment::Close => Command::Close,
        })
        .collect()
}

fn outline(path: &[Command], stroke: &zeno::Stroke, matrix: &Transform) -> Option<Path> {
    let mut builder = tiny_skia::PathBuilder::new();
    for command in path {
        match *command {
            Command::MoveTo(to) => builder.move_to(to.x, to.y),
            Command::LineTo(to) => builder.line_to(to.x, to.y),
            Command::QuadTo(a, to) => builder.quad_to(a.x, a.y, to.x, to.y),
            Command::CurveTo(a, b, to) => builder.cubic_to(a.x, a.y, b.x, b.y, to.x, to.y),
            Command::Close => builder.close(),
        }
    }
    let (mut path, resolution) = (
        builder.finish()?,
        PathStroker::compute_resolution_scale(matrix),
    );
    if let Some(dash) = StrokeDash::new(stroke.dashes.to_vec(), stroke.offset) {
        path = path.dash(&dash, resolution)?;
    }
    let style = tiny_skia::Stroke {
        width: stroke.width,
        miter_limit: stroke.miter_limit,
        line_cap: match stroke.start_cap {
            zeno::Cap::Butt => LineCap::Butt,
            zeno::Cap::Square => LineCap::Square,
            zeno::Cap::Round => LineCap::Round,
        },
        line_join: match stroke.join {
            zeno::Join::Bevel => LineJoin::Bevel,
            zeno::Join::Miter => LineJoin::Miter,
            zeno::Join::Round => LineJoin::Round,
        },
        dash: None,
    };
    Some(path_from(&path.stroke(&style, resolution)?))
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
        style: impl Into<zeno::Style<'a>>,
        matrix: &Transform,
        area: IntRect,
    ) -> Coverage {
        match style.into() {
            _ if area.is_empty() || !matrix.is_finite() => Coverage::filled(area, 0),
            zeno::Style::Fill(rule) => edges::fill(path, rule == zeno::Fill::EvenOdd, matrix, area),
            zeno::Style::Stroke(stroke) => edges::fill(
                &outline(path, &stroke, matrix).unwrap_or_default(),
                false,
                matrix,
                area,
            ),
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

    /// For a path that does not overlap itself.
    fn of_simple_path(path: &[Command], matrix: &Transform, area: IntRect) -> Coverage {
        let mut coverage = Coverage::filled(area, 0);
        if !coverage.data.is_empty() && matrix.is_finite() {
            let (x, y) = (matrix.tx - area.left as f32, matrix.ty - area.top as f32);
            zeno::Mask::new(path)
                .transform(Some(zeno::Transform::new(
                    matrix.sx, matrix.ky, matrix.kx, matrix.sy, x, y,
                )))
                .size(area.width() as u32, area.height() as u32)
                .render_into(&mut coverage.data, None);
        }
        coverage
    }

    pub fn of_shape(shape: &RoundedRect, matrix: &Transform, area: IntRect) -> Coverage {
        let (path, inside) = (
            rounded_rect_path(shape),
            inner_band(shape, matrix).intersect(area),
        );
        // Zeno has 24.8 fixed point numbers, and does not return once they overflow.
        if !area
            .outset(1 << 20)
            .contains(IntRect::around(map_rect(matrix, shape.rect)))
        {
            return edges::fill(&path, false, matrix, area);
        }
        let of_piece = |piece| match has_radii(shape) {
            true => Coverage::of_path(&path, zeno::Fill::NonZero, matrix, piece),
            false => Coverage::of_simple_path(&path, matrix, piece),
        };
        if inside.is_empty() {
            return of_piece(area);
        }
        let mut coverage = Coverage::filled(area, 255);
        for piece in area
            .without(inside)
            .filter(|_| !coverage.rect.is_empty())
            .collect::<SmallVec<[_; 4]>>()
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

    pub fn blur(&mut self, sigma: f32) {
        blur::<1>(&mut self.data, self.rect.width(), [sigma; 2]);
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
                (Paint::Solid(color @ [.., 255]), None) => row.fill(*color),
                (Paint::Solid(color), None) => fill_row(row, *color),
                (Paint::Solid(color), Some(coverage)) => fill_through(row, *color, coverage),
                (Paint::Shader(shade), coverage) => {
                    colors.resize(row.len(), [0; 4]);
                    shade(area.left, y, &mut colors);
                    if let Some(coverage) = coverage {
                        colors
                            .iter_mut()
                            .zip(coverage)
                            .for_each(|(color, by)| *color = scale(*color, *by));
                    }
                    blend_row(row, &colors, 255);
                }
            }
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
    pub fn draw_with_mode(&mut self, source: &Layer, mode: tiny_skia::BlendMode, clip: &Clip) {
        let area = clip.rect.intersect(self.rect);
        let (Some(mut blended), Some(source)) = (self.copy(area), source.copy(area)) else {
            return;
        };
        let paint = PixmapPaint {
            blend_mode: mode,
            ..PixmapPaint::default()
        };
        (blended.pixmap).draw_pixmap(
            0,
            0,
            source.pixmap.as_ref(),
            &paint,
            Transform::identity(),
            None,
        );
        self.replace(&blended, clip);
    }

    /// Interpolates towards `source` by the clip's coverage.
    pub fn replace(&mut self, source: &Layer, clip: &Clip) {
        let area = clip.rect.intersect(self.rect).intersect(source.rect);
        if area.is_empty() {
            return;
        }
        for y in area.top..area.bottom {
            let (from, row) = (
                source.row(y, area.left, area.right),
                self.row_mut(y, area.left, area.right),
            );
            let Some(mask) = &clip.mask else {
                row.copy_from_slice(from);
                continue;
            };
            for ((pixel, from), coverage) in row
                .iter_mut()
                .zip(from)
                .zip(mask.row(y, area.left, area.right))
            {
                for (channel, from) in pixel.iter_mut().zip(from) {
                    *channel = multiply(*from, *coverage)
                        .saturating_add(multiply(*channel, 255 - coverage));
                }
            }
        }
    }

    pub fn blur(&mut self, sigma: f32) {
        self.blur_by([sigma; 2]);
    }

    pub fn blur_by(&mut self, sigma: [f32; 2]) {
        let width = self.rect.width();
        blur::<4>(self.pixmap.data_mut(), width, sigma);
    }
}

/// How far a blur reaches.
pub fn blur_extent(sigma: f32) -> i32 {
    (sigma * 3.).ceil().clamp(0., 4096.) as i32
}

fn gaussian_line<const N: usize>(line: &[[f32; N]], output: &mut [[f32; N]], kernel: &[f32]) {
    let radius = kernel.len() / 2;
    for (index, output) in output.iter_mut().enumerate() {
        let first = index.saturating_sub(radius);
        let window = &line[first..(index + radius + 1).min(line.len())];
        *output = [0.; N];
        for (value, weight) in window.iter().zip(&kernel[first + radius - index..]) {
            for channel in 0..N {
                output[channel] += value[channel] * weight;
            }
        }
    }
}

/// Averages `before + 1 + after` values.
fn box_line<const N: usize>(
    line: &[[f32; N]],
    output: &mut [[f32; N]],
    before: usize,
    after: usize,
) {
    let (mut sum, scale) = ([0.; N], 1. / (before + 1 + after) as f32);
    let change = |sum: &mut [f32; N], value: Option<&[f32; N]>, sign: f32| {
        if let Some(value) = value {
            for channel in 0..N {
                sum[channel] += value[channel] * sign;
            }
        }
    };
    (0..after).for_each(|index| change(&mut sum, line.get(index), 1.));
    for (index, output) in output.iter_mut().enumerate() {
        change(&mut sum, line.get(index + after), 1.);
        *output = sum.map(|channel| channel * scale);
        change(
            &mut sum,
            index.checked_sub(before).map(|index| &line[index]),
            -1.,
        );
    }
}

fn blur<const N: usize>(data: &mut [u8], width: usize, [x, y]: [f32; 2]) {
    if !data.is_empty() {
        let pixels: &mut [[u8; N]] = data.as_chunks_mut().0;
        let height = pixels.len() / width;
        blur_lines(pixels, [height, width, 1, width], x);
        blur_lines(pixels, [width, height, width, 1], y);
    }
}

fn blur_lines<const N: usize>(
    pixels: &mut [[u8; N]],
    [count, length, step, stride]: [usize; 4],
    sigma: f32,
) {
    const EXACT_UP_TO: f32 = 4.;
    if sigma < 0.05 || sigma.is_nan() {
        return;
    }
    let radius = if sigma <= EXACT_UP_TO {
        blur_extent(sigma)
    } else {
        0
    };
    let kernel = (-radius..=radius).map(|at| (-(at * at) as f32 / (2. * sigma * sigma)).exp());
    let mut kernel: Vec<f32> = kernel.collect();
    let total: f32 = kernel.iter().sum();
    kernel.iter_mut().for_each(|weight| *weight /= total);
    // https://drafts.fxtf.org/filter-effects/#feGaussianBlurElement
    let window = (sigma * 3. * (2. * std::f32::consts::PI).sqrt() / 4. + 0.5) as usize;
    let half = window / 2;
    let passes = match window % 2 {
        1 => [(half, half); 3],
        _ => [
            (half, half.saturating_sub(1)),
            (half.saturating_sub(1), half),
            (half, half),
        ],
    };

    {
        let (mut line, mut output) = (vec![[0.; N]; length], vec![[0.; N]; length]);
        let (mut previous_input, mut previous_output) = (Vec::new(), Vec::new());
        for index in 0..count {
            let at = |position: usize| index * stride + position * step;
            // The lines through the middle of a box are all the same.
            if index > 0
                && (0..length).all(|position| pixels[at(position)] == previous_input[position])
            {
                (0..length).for_each(|position| pixels[at(position)] = previous_output[position]);
                continue;
            }
            previous_input.clear();
            previous_input.extend((0..length).map(|position| pixels[at(position)]));
            for (value, pixel) in line.iter_mut().zip(&previous_input) {
                *value = pixel.map(f32::from);
            }
            if sigma <= EXACT_UP_TO {
                gaussian_line(&line, &mut output, &kernel);
            } else {
                box_line(&line, &mut output, passes[0].0, passes[0].1);
                box_line(&output, &mut line, passes[1].0, passes[1].1);
                box_line(&line, &mut output, passes[2].0, passes[2].1);
            }
            previous_output.clear();
            previous_output.extend(
                output
                    .iter()
                    .map(|value| value.map(|channel| (channel + 0.5) as u8)),
            );
            (0..length).for_each(|position| pixels[at(position)] = previous_output[position]);
        }
    }
}
