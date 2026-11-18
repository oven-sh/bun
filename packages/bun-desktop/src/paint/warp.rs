//! Pixels that are painted once and then repeated or distorted.

use super::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Pixel, map_point, map_rect, over, prefer_wide, scale,
};
use super::scan::Floats as _;
use super::slant::{Gauge, Slant};
use crate::abi::{Rect, RoundedRect, Tile};
use crate::gfx::{Pixmap, Transform};

const MAX_SIDE: f32 = 4096.;

/// The rows of a 3x3 matrix.
pub struct Projection(pub [f32; 9]);

impl From<&Transform> for Projection {
    fn from(matrix: &Transform) -> Projection {
        Projection([
            matrix.sx, matrix.kx, matrix.tx, matrix.ky, matrix.sy, matrix.ty, 0., 0., 1.,
        ])
    }
}

impl Projection {
    pub fn after(&self, other: &Projection) -> Projection {
        Projection(std::array::from_fn(|at| {
            (0..3)
                .map(|k| self.0[at / 3 * 3 + k] * other.0[k * 3 + at % 3])
                .sum()
        }))
    }

    fn map(&self, x: f32, y: f32) -> [f32; 3] {
        [0, 3, 6].map(|row| self.0[row] * x + self.0[row + 1] * y + self.0[row + 2])
    }

    fn invert(&self) -> Option<Projection> {
        let [a, b, c, d, e, f, g, h, i] = self.0.map(f64::from);
        let adjugate = [
            e * i - f * h,
            c * h - b * i,
            b * f - c * e,
            f * g - d * i,
            a * i - c * g,
            c * d - a * f,
            d * h - e * g,
            b * g - a * h,
            a * e - b * d,
        ];
        let determinant = a * adjugate[0] + b * adjugate[3] + c * adjugate[6];
        (determinant.abs() > 1e-12)
            .then(|| Projection(adjugate.map(|cell| (cell / determinant) as f32)))
    }

    /// Of the part that is in front of the viewer.
    pub fn map_rect(&self, rect: Rect) -> Rect {
        const NEAREST: f32 = 1e-4;
        let (right, bottom) = (rect.x + rect.width, rect.y + rect.height);
        let corners = [
            (rect.x, rect.y),
            (right, rect.y),
            (right, bottom),
            (rect.x, bottom),
        ]
        .map(|(x, y)| self.map(x, y));
        let (mut low, mut high) = ([f32::MAX; 2], [f32::MIN; 2]);
        let mut add = |[x, y, w]: [f32; 3]| {
            low = [low[0].min(x / w), low[1].min(y / w)];
            high = [high[0].max(x / w), high[1].max(y / w)];
        };
        for (from, to) in (0..4).map(|index| (corners[index], corners[(index + 1) % 4])) {
            if from[2] >= NEAREST {
                add(from);
            }
            if (from[2] >= NEAREST) != (to[2] >= NEAREST) {
                let t = (NEAREST - from[2]) / (to[2] - from[2]);
                add([
                    from[0] + (to[0] - from[0]) * t,
                    from[1] + (to[1] - from[1]) * t,
                    NEAREST,
                ]);
            }
        }
        Rect {
            x: low[0],
            y: low[1],
            width: (high[0] - low[0]).max(0.),
            height: (high[1] - low[1]).max(0.),
        }
    }
}

/// `at` gives the pixel in a column and a row.
fn interpolate(x: f32, y: f32, at: impl Fn(i32, i32) -> Pixel) -> Pixel {
    let (x, y) = (x - 0.5, y - 0.5);
    let (left, top) = (x.floor(), y.floor());
    let [fx, fy] = [x - left, y - top].map(|fraction| (fraction * 256. + 0.5) as u32);
    let (left, top) = (left as i32, top as i32);
    let [a, b, c, d] = [
        at(left, top),
        at(left + 1, top),
        at(left, top + 1),
        at(left + 1, top + 1),
    ];
    std::array::from_fn(|channel| {
        let row =
            |a: Pixel, b: Pixel| u32::from(a[channel]) * (256 - fx) + u32::from(b[channel]) * fx;
        ((row(a, b) * (256 - fy) + row(c, d) * fy + (1 << 15)) >> 16) as u8
    })
}

/// Positions have 16 bits after the point.
pub struct Samples<'a> {
    pub texels: &'a [Pixel],
    pub width: usize,
    /// From one pixel to the next.
    pub step: [i32; 2],
    /// Positions are taken to be between 0 and this, which leaves room for another column and another row.
    pub last: [i32; 2],
}

impl Samples<'_> {
    #[inline(always)]
    pub(super) fn at(&self, start: [i32; 2], steps: i32) -> Pixel {
        let [x, y] = [0, 1].map(|axis| {
            start[axis]
                .wrapping_add(self.step[axis].wrapping_mul(steps))
                .clamp(0, self.last[axis])
        });
        let (at, across, down) = (
            (y >> 16) as usize * self.width + (x >> 16) as usize,
            x as u64 >> 9 & 127,
            y as u64 >> 9 & 127,
        );
        let spread = |at: usize| {
            let bits = u64::from(u32::from_le_bytes(self.texels[at]));
            (bits | bits << 24) & 0xFF_00FF_00FF_00FF
        };
        let mix = |a: u64, b: u64, by: u64| {
            (a * (128 - by) + b * by + 0x40_0040_0040_0040) >> 7 & 0xFF_00FF_00FF_00FF
        };
        let line = |at: usize| mix(spread(at), spread(at + 1), across);
        let mixed = mix(line(at), line(at + self.width), down);
        ((mixed | mixed >> 24) as u32).to_le_bytes()
    }
}

impl Samples<'_> {
    /// What is at the height of a row of pixels, and one more. Returns where the row starts in that, and the last position.
    #[inline(always)]
    pub(super) fn line(&self, [x, y]: [i32; 2], length: usize, to: &mut Vec<Pixel>) -> [i32; 2] {
        let ends = [
            x,
            x.saturating_add(self.step[0].saturating_mul(length as i32)),
        ]
        .map(|it| it.clamp(0, self.last[0]) >> 16);
        let (first, last, y) = (
            ends[0].min(ends[1]),
            (ends[0].max(ends[1]) + 1).min(self.last[0] >> 16),
            y.clamp(0, self.last[1]),
        );
        let [above, below] = [y >> 16, ((y >> 16) + 1).min(self.last[1] >> 16)]
            .map(|it| &self.texels[it as usize * self.width..][first as usize..=last as usize]);
        let down = (y >> 8 & 255) as u16;
        to.resize(above.len() + 1, [0; 4]);
        for (to, (a, b)) in to
            .as_flattened_mut()
            .iter_mut()
            .zip(above.as_flattened().iter().zip(below.as_flattened()))
        {
            *to = ((u16::from(*a) * (256 - down) + u16::from(*b) * down + 128) >> 8) as u8;
        }
        [x.wrapping_sub(first << 16), (last - first) << 16]
    }
}

/// `draw_samples` without steps down. It is more exact, and needs no room after the last column and row.
pub fn draw_upright_samples<'a>(
    rows: impl Iterator<Item = (&'a mut [Pixel], [i32; 2])>,
    source: &Samples,
    by: u8,
) {
    prefer_wide!(draw_upright_samples(rows, source, by));
    let mut line = Vec::new();
    for (row, start) in rows {
        let [mut x, last] = source.line(start, row.len(), &mut line);
        for pixel in row {
            let at = x.clamp(0, last);
            let (left, right, across) = (
                line[(at >> 16) as usize],
                line[(at >> 16) as usize + 1],
                (at >> 8 & 255) as u16,
            );
            let color = std::array::from_fn(|it| {
                ((u16::from(left[it]) * (256 - across) + u16::from(right[it]) * across + 128) >> 8)
                    as u8
            });
            *pixel = over(*pixel, scale(color, by));
            x = x.wrapping_add(source.step[0]);
        }
    }
}

/// Each row comes with the position of its first pixel.
pub fn draw_samples<'a>(
    rows: impl Iterator<Item = (&'a mut [Pixel], [i32; 2])>,
    source: &Samples,
    by: u8,
) {
    prefer_wide!(draw_samples(rows, source, by));
    for (row, start) in rows {
        for (steps, pixel) in (0..).zip(row) {
            *pixel = match source.at(start, steps) {
                color @ [.., 255] if by == 255 => color,
                color => over(*pixel, scale(color, by)),
            };
        }
    }
}

/// Likewise, and with what `slant::fill` takes.
pub fn draw_samples_in_slant<'a>(
    rows: impl Iterator<Item = (&'a mut [Pixel], [f32; 2], [i32; 2])>,
    slant: &Slant,
    source: &Samples,
    by: u8,
) {
    prefer_wide!(draw_samples_in_slant(rows, slant, source, by));
    let gauge = Gauge::<[f32; 8]>::new(slant);
    for (row, [x, y], start) in rows {
        let coverage = (0..).flat_map(|it| gauge.coverage([x + (it * 8) as f32, y]).bytes());
        (0..)
            .zip(row)
            .zip(coverage)
            .for_each(|((steps, pixel), coverage)| {
                *pixel = over(*pixel, scale(scale(source.at(start, steps), by), coverage))
            });
    }
}

/// `paint` paints what is in `bounds` with a matrix that only scales.
pub fn project(
    target: &mut Layer,
    clip: &Clip,
    projection: &Projection,
    bounds: Rect,
    paint: impl FnOnce(&mut Layer, &Transform),
) {
    let Some(inverse) = projection.invert() else {
        return;
    };
    let seen = inverse.map_rect(clip.rect.outset(2).to_rect());
    let bounds = super::scene::intersect(bounds, super::scene::outset(seen, 2.));
    let [a, b, _, d, e, _, g, h, _] = projection.0;
    let [x, y, w] = projection.map(bounds.x + bounds.width / 2., bounds.y + bounds.height / 2.);
    let w = w.max(0.25);
    let stretch = |dx: f32, dy: f32, dw: f32| ((dx - x / w * dw) / w).hypot((dy - y / w * dw) / w);
    let (mut scale_x, mut scale_y) = (stretch(a, d, g), stretch(b, e, h));
    if [g, h] != [0.; 2] {
        scale_x = scale_x.max(scale_y).max(1.).round();
        scale_y = scale_x;
    }
    let (scale_x, scale_y) = (
        scale_x.min(MAX_SIDE / bounds.width),
        scale_y.min(MAX_SIDE / bounds.height),
    );
    let matrix = Transform::from_scale(scale_x, scale_y);
    let Some(mut flat) = Layer::new(IntRect::around(map_rect(&matrix, bounds))) else {
        return;
    };
    paint(&mut flat, &matrix);
    let IntRect {
        left,
        top,
        right,
        bottom,
    } = flat.rect;
    let at = |x: i32, y: i32| match (left..right).contains(&x) && (top..bottom).contains(&y) {
        true => flat.row(y, x, x + 1)[0],
        false => [0; 4],
    };
    let shade = |first: i32, y: i32, row: &mut [Pixel]| {
        for (x, pixel) in (first..).zip(row) {
            let [u, v, w] = inverse.map(x as f32 + 0.5, y as f32 + 0.5);
            *pixel = if w > 0. {
                interpolate(u / w * scale_x, v / w * scale_y, at)
            } else {
                [0; 4]
            };
        }
    };
    target.fill(clip.rect, None, clip, &Paint::Shader(&shade));
}

/// Shows the part of `source` that is in `rect`. `placement` puts it in the space of `rect`.
pub fn draw(
    target: &mut Layer,
    source: &Pixmap,
    rect: Rect,
    placement: Transform,
    matrix: &Transform,
    smooth: bool,
) {
    const ONE: f32 = 65536.;
    let Some(inverse) = matrix.pre_concat(placement).invert() else {
        return;
    };
    let (pixels, width): (&[Pixel], _) = (source.data().as_chunks().0, source.width() as usize);
    let (last_column, last_row) = (
        i64::from(source.width()) - 1,
        i64::from(source.height()) - 1,
    );
    let row_at = |y: i64| &pixels[y.clamp(0, last_row) as usize * width..][..width];
    // Two channels at a time, with 8 bits after the point.
    let spread = |pixel: Pixel| {
        u64::from(u32::from_le_bytes(pixel) & 0xff_00ff)
            | u64::from(u32::from_le_bytes(pixel) & 0xff00_ff00) << 24
    };
    let mix = |[a, b]: [u64; 2], by: i64| {
        ((a * (256 - by as u64) + b * by as u64 + 0x80_0080_0080_0080) >> 8) & 0xff_00ff_00ff_00ff
    };
    let shade = |first: i32, y: i32, row: &mut [Pixel]| {
        let (u, v) = map_point(&inverse, first as f32 + 0.5, y as f32 + 0.5);
        let fixed = |it: f32| (it * ONE).clamp(-1e13, 1e13).round() as i64;
        let (mut u, mut v, du, dv) = (fixed(u), fixed(v), fixed(inverse.sx), fixed(inverse.ky));
        if !smooth {
            for pixel in row {
                *pixel = row_at(v >> 16)[(u >> 16).clamp(0, last_column) as usize];
                (u, v) = (u + du, v + dv);
            }
            return;
        }
        (u, v) = (u - (1 << 15) + 128, v - (1 << 15) + 128);
        if dv == 0
            && [
                u,
                v,
                du * (row.len() as i64 + 8),
                last_column << 16,
                last_row << 16,
            ]
            .iter()
            .all(|it| it.abs() < 1 << 30)
        {
            let samples = Samples {
                texels: pixels,
                width,
                step: [du as i32, 0],
                last: [last_column, last_row].map(|it| (it as i32) << 16),
            };
            row.fill([0; 4]);
            return draw_upright_samples(
                std::iter::once((row, [u as i32, v as i32])),
                &samples,
                255,
            );
        }
        let (mut rows, mut columns, mut known) = ([row_at(0); 2], [0; 2], (i64::MIN, i64::MIN));
        for pixel in row {
            if known != (u >> 16, v >> 8) {
                if known.1 >> 8 != v >> 16 {
                    rows = [row_at(v >> 16), row_at((v >> 16) + 1)];
                }
                let column = |x: i64| {
                    mix(
                        rows.map(|row| spread(row[x.clamp(0, last_column) as usize])),
                        v >> 8 & 255,
                    )
                };
                columns = [
                    if known == ((u >> 16) - 1, v >> 8) {
                        columns[1]
                    } else {
                        column(u >> 16)
                    },
                    column((u >> 16) + 1),
                ];
                known = (u >> 16, v >> 8);
            }
            let mixed = mix(columns, u >> 8 & 255);
            *pixel = ((mixed | mixed >> 24) as u32).to_le_bytes();
            (u, v) = (u + du, v + dv);
        }
    };
    let (mapped, paint) = (map_rect(matrix, rect), Paint::Shader(&shade));
    let area = IntRect::around(mapped).intersect(target.rect);
    if !matrix.has_skew() && IntRect::around(mapped).to_rect() == mapped {
        return target.fill(area, None, &Clip::new(area), &paint);
    }
    target.fill_coverage(
        &Coverage::of_shape(
            &RoundedRect {
                rect,
                ..RoundedRect::default()
            },
            matrix,
            area,
        ),
        &Clip::new(area),
        &paint,
    );
}

/// Shows `part` of the pixels in each tile.
fn sample_tiles(
    target: &mut Layer,
    clip: &Clip,
    tile: &Tile,
    matrix: &Transform,
    source: &Pixmap,
    part: Rect,
    smooth: bool,
) {
    let Some(inverse) = matrix.invert() else {
        return;
    };
    let (Tile { rect, step }, pixels): (_, &[Pixel]) = (*tile, source.data().as_chunks().0);
    let axis = |start: f32, length: f32, limit: u32, step: f32, size: f32| {
        let (low, high) = (
            (start + 0.01).floor().max(0.) as i32,
            ((start + length - 0.01).ceil() as i32).min(limit as i32),
        );
        let wraps = (step - size).abs() < 1e-3;
        move |at: i32| {
            if wraps {
                low + (at - low).rem_euclid((high - low).max(1))
            } else {
                at.min(high - 1).max(low)
            }
        }
    };
    let column = axis(part.x, part.width, source.width(), step[0], rect.width);
    let row_of = axis(part.y, part.height, source.height(), step[1], rect.height);
    let at = |x: i32, y: i32| {
        let index = row_of(y) as usize * source.width() as usize + column(x) as usize;
        pixels.get(index).copied().unwrap_or_default()
    };
    let wrap = |at: f32, step: f32| if step > 0. { at.rem_euclid(step) } else { at };
    let shade = |first: i32, y: i32, row: &mut [Pixel]| {
        for (x, pixel) in (first..).zip(row) {
            let (u, v) = map_point(&inverse, x as f32 + 0.5, y as f32 + 0.5);
            let (u, v) = (
                wrap(u - rect.x, step[0]) / rect.width,
                wrap(v - rect.y, step[1]) / rect.height,
            );
            let (column, line) = (part.x + u * part.width, part.y + v * part.height);
            *pixel = match ((0. ..=1.).contains(&u) && (0. ..=1.).contains(&v), smooth) {
                (false, _) => [0; 4],
                (true, true) => interpolate(column, line, at),
                (true, false) => at(column.floor() as i32, line.floor() as i32),
            };
        }
    };
    target.fill(clip.rect, None, clip, &Paint::Shader(&shade));
}

/// `paint` paints what is in `tile.rect`.
pub fn repeat(
    target: &mut Layer,
    clip: &Clip,
    tile: &Tile,
    matrix: &Transform,
    smooth: bool,
    paint: impl FnOnce(&mut Layer, &Transform),
) {
    let (rect, (scale_x, scale_y)) = (tile.rect, matrix.get_scale());
    let [width, height] = [rect.width * scale_x, rect.height * scale_y]
        .map(|side| (side - 0.01).ceil().clamp(1., MAX_SIDE));
    let Some(mut cell) = Layer::new(IntRect::new(0, 0, width as i32, height as i32)) else {
        return;
    };
    paint(
        &mut cell,
        &Transform::from_scale(width / rect.width, height / rect.height)
            .pre_translate(-rect.x, -rect.y),
    );
    sample_tiles(
        target,
        clip,
        tile,
        matrix,
        &cell.pixmap,
        cell.rect.to_rect(),
        smooth,
    );
}

#[expect(clippy::too_many_arguments)]
pub fn repeat_part(
    target: &mut Layer,
    clip: &Clip,
    tile: &Tile,
    matrix: &Transform,
    source: &Pixmap,
    whole: [f32; 2],
    part: Rect,
    smooth: bool,
) {
    let (x, y) = (
        source.width() as f32 / whole[0],
        source.height() as f32 / whole[1],
    );
    let part = Rect {
        x: part.x * x,
        y: part.y * y,
        width: part.width * x,
        height: part.height * y,
    };
    sample_tiles(target, clip, tile, matrix, source, part, smooth);
}
