//! RGBA to YUV 4:2:0, cut into macroblocks.

use bun_highway::webp::{self, Block, GammaTable, LinearColors, Macroblock};

use crate::array::At;
use crate::error::Result;
use crate::slice::{self, InBounds, known};
use crate::vec;

type Rgba = [u8; 4];
type Row = [Rgba; 16];

pub(super) struct Picture {
    /// In macroblocks.
    pub(super) width: usize,
    /// By row. Those that reach beyond the image repeat its last column and row.
    pub(super) macroblocks: Vec<Macroblock>,
}

impl Picture {
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/picture_csp_enc.c#L477
    #[inline(never)]
    pub(super) fn new(rgba: &[Rgba], width: usize, height: usize, has_alpha: bool) -> Result<Self> {
        let width = width.max(1);
        let width_in_macroblocks = width.div_ceil(16);
        let mut macroblocks = vec::with_room(width_in_macroblocks * height.div_ceil(16))?;
        let mut padded = [[[0; 4]; 16]; 16];
        let mut colors = LinearColors::default();
        let mut converted = Macroblock::default();
        for band in rgba.chunks(width * 16) {
            let rows = band.len() / width;
            let mut runs = [None; 2];
            for x in (0..width).step_by(16) {
                let columns = (width - x).min(16);
                let is_whole = (columns, rows) == (16, 16);
                let (mut from, mut stride) = (band.part(x..), width);
                if !is_whole {
                    pad(from, width, columns, rows, &mut padded);
                    (from, stride) = (padded.as_flattened(), 16);
                }
                let mut from = from.chunks(stride);
                let mut pixels = [&[[0; 4]; 16]; 16];
                for to in &mut pixels {
                    *to = known(from.next().and_then(<[_]>::first_chunk)).unwrap_or(to);
                }
                let is_translucent = has_alpha && !is_opaque(&pixels);
                if !repeats_left(band, width, x) {
                    if is_translucent {
                        average(&pixels, &mut colors, weighted_sums);
                    } else {
                        average(&pixels, &mut colors, sums);
                    }
                    webp::convert(&pixels, &colors, &LINEAR_TO_GAMMA, &mut converted);
                }
                let samples = macroblocks.push_mut(converted);
                if is_translucent {
                    flatten_transparent(samples, &pixels, columns, rows, &mut runs);
                } else {
                    runs = [None; 2];
                }
                if !is_whole {
                    repeat_edges(&mut samples.luma, columns, rows);
                    for plane in samples.chroma.as_chunks_mut::<4>().0 {
                        repeat_edges(plane, columns.div_ceil(2), rows.div_ceil(2));
                    }
                }
            }
        }
        Ok(Self {
            width: width_in_macroblocks,
            macroblocks,
        })
    }

    pub(super) fn rows(&self) -> impl Iterator<Item = &[Macroblock]> {
        self.macroblocks.chunks(self.width.max(1))
    }
}

/// Whether the 16 columns from `x` on are the same as those before them.
fn repeats_left(band: &[Rgba], width: usize, x: usize) -> bool {
    band.chunks(width).all(|row| {
        let (left, right) = row.split_at_checked(x).unwrap_or_default();
        left.last_chunk::<16>()
            .is_some_and(|left| Some(left) == right.first_chunk())
    })
}

/// Repeats the last of the `columns` and `rows`.
#[inline(never)]
fn pad(from: &[Rgba], stride: usize, columns: usize, rows: usize, to: &mut [Row; 16]) {
    for (to, from) in to.iter_mut().zip(from.chunks(stride)) {
        slice::copy(from, to);
        let last = *to.at(columns - 1);
        to.iter_mut().skip(columns).for_each(|it| *it = last);
    }
    let last = *to.at(rows - 1);
    to.iter_mut().skip(rows).for_each(|it| *it = last);
}

fn sample<const N: usize>(blocks: &mut [Block; N], x: usize, y: usize) -> &mut u8 {
    let block = blocks.at_mut(y / 4 * N.isqrt() + x / 4);
    block.at_mut(x % 4).at_mut(y % 4)
}

/// Only so many `columns` and `rows` of the square are in the image.
#[inline(never)]
fn repeat_edges<const N: usize>(blocks: &mut [Block; N], columns: usize, rows: usize) {
    for x in 0..4 * N.isqrt() {
        for y in (if x < columns { rows } else { 0 })..4 * N.isqrt() {
            *sample(blocks, x, y) = *sample(blocks, x.min(columns - 1), y.min(rows - 1));
        }
    }
}

fn is_opaque(pixels: &[&Row; 16]) -> bool {
    let all = pixels.iter().flat_map(|row| row.iter());
    all.fold(u32::MAX, |all, &it| all & u32::from_le_bytes(it)) >> 24 == 255
}

/// Entry `i` is `(i * step / scale)^(power / to_power) * to_scale`, rounded.
const fn gamma_table<const N: usize>(
    power: u32,
    scale: u128,
    step: u128,
    to_power: u32,
    to_scale: u128,
) -> [u32; N] {
    let mut table = [0; N];
    let mut rest = table.as_mut_slice();
    let (mut from, mut to) = (0_u128, 0_u128);
    while let [entry, tail @ ..] = rest {
        while (2 * to + 1).pow(to_power) * scale.pow(power)
            <= from.pow(power) * (2 * to_scale).pow(to_power)
        {
            to += 1;
        }
        *entry = to as u32;
        from += step;
        rest = tail;
    }
    table
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/picture_csp_enc.c#L91
static GAMMA_TO_LINEAR: [u32; 256] = gamma_table(4, 255, 1, 5, 4095);
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static LINEAR_TO_GAMMA: GammaTable = {
    let table: [u32; 33] = gamma_table(5, 4095, 128, 4, 255);
    let (mut values, mut slopes) = ([0; 32], [0; 32]);
    let mut i = 0;
    while i < 32 {
        values[i] = table[i] as u8;
        slopes[i] = (table[i + 1] - table[i]) as u8;
        i += 1;
    }
    GammaTable { values, slopes }
};

#[inline(always)]
fn linear(pixel: Rgba) -> [u32; 3] {
    let pixel = u32::from_le_bytes(pixel);
    [0, 8, 16].map(|shift| *GAMMA_TO_LINEAR.at(usize::from((pixel >> shift) as u8)))
}

#[inline(always)]
fn sums(square: [Rgba; 4]) -> [u32; 3] {
    let [a, b, c, d] = square.map(linear);
    [0, 1, 2].map(|i| a.at(i) + b.at(i) + c.at(i) + d.at(i))
}

/// The more opaque pixels count more.
#[inline(always)]
fn weighted_sums(square: [Rgba; 4]) -> [u32; 3] {
    let alpha: u32 = square.iter().map(|&[.., a]| u32::from(a)).sum();
    if alpha == 0 || alpha == 4 * 255 {
        return sums(square);
    }
    let reciprocal = (1 << 19) / alpha;
    let [a, b, c, d] = square.map(|pixel| linear(pixel).map(|it| it * u32::from(pixel[3])));
    [0, 1, 2].map(|i| ((a.at(i) + b.at(i) + c.at(i) + d.at(i)) * reciprocal) >> 17)
}

#[inline(always)]
fn average(pixels: &[&Row; 16], colors: &mut LinearColors, sums: impl Fn([Rgba; 4]) -> [u32; 3]) {
    for (y, [upper, lower]) in pixels.as_chunks().0.iter().enumerate() {
        let squares = upper.as_chunks().0.iter().zip(lower.as_chunks().0);
        for (x, (&[a, b], &[c, d])) in squares.enumerate() {
            for (color, sum) in colors.sums.iter_mut().zip(sums([a, b, c, d])) {
                *color.at_mut(y % 4).at_mut(y / 4).at_mut(x) = sum as u16;
            }
        }
    }
}

/// What cannot be seen is made cheap to store. `runs` has, for the upper and the lower half, the Y, U and V of the
/// transparent squares of 8x8 to the left.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/picture_tools_enc.c#L104
#[inline(never)]
fn flatten_transparent(
    samples: &mut Macroblock,
    pixels: &[&Row; 16],
    columns: usize,
    rows: usize,
    runs: &mut [Option<[u8; 3]>; 2],
) {
    let mut is_visible: [Block; 16] = core::array::from_fn(|n| {
        let rows = [0, 1, 2, 3].map(|y| *pixels.at(n / 4 * 4 + y));
        [0, 1, 2, 3].map(|x| rows.map(|row| row.at(n % 4 * 4 + x)[3]))
    });
    for x in 0..16 {
        for y in (if x < columns { rows } else { 0 })..16 {
            *sample(&mut is_visible, x, y) = 0;
        }
    }
    for (y, run) in runs.iter_mut().enumerate() {
        for x in 0..2 {
            let blocks = [0, 1, 4, 5].map(|n| 8 * y + 2 * x + n);
            let (mut sum, mut count) = (0, 0);
            for n in blocks {
                let pairs = samples
                    .luma
                    .at(n)
                    .as_flattened()
                    .iter()
                    .zip(is_visible.at(n).as_flattened());
                for (&luma, &alpha) in pairs {
                    sum += u32::from(if alpha != 0 { luma } else { 0 });
                    count += u32::from(alpha != 0);
                }
            }
            if let Some(average) = sum.checked_div(count) {
                *run = None;
                for n in blocks {
                    let pairs = samples
                        .luma
                        .at_mut(n)
                        .as_flattened_mut()
                        .iter_mut()
                        .zip(is_visible.at(n).as_flattened());
                    for (luma, &alpha) in pairs {
                        *luma = if alpha != 0 { *luma } else { average as u8 };
                    }
                }
            } else if 8 * x + 8 <= columns && 8 * y + 8 <= rows {
                let (u, v) = (2 * y + x, 4 + 2 * y + x);
                let first = [
                    samples.luma.at(blocks[0]),
                    samples.chroma.at(u),
                    samples.chroma.at(v),
                ];
                let flat = run
                    .get_or_insert(first.map(|it| it[0][0]))
                    .map(|it| [[it; 4]; 4]);
                for n in blocks {
                    *samples.luma.at_mut(n) = flat[0];
                }
                *samples.chroma.at_mut(u) = flat[1];
                *samples.chroma.at_mut(v) = flat[2];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gamma_tables_are_those_of_floating_point() {
        let expected = |from: f64, power: f64, scale: f64| (from.powf(power) * scale + 0.5) as u32;
        for (i, linear) in (0..).zip(GAMMA_TO_LINEAR) {
            assert_eq!(linear, expected(f64::from(i) / 255.0, 0.8, 4095.0));
        }
        let GammaTable { values, slopes } = LINEAR_TO_GAMMA;
        for ((i, value), slope) in (0..).zip(values).zip(slopes) {
            let [from, to] = [i, i + 1].map(|i| expected(f64::from(i * 128) / 4095.0, 1.25, 255.0));
            assert_eq!([value, slope].map(u32::from), [from, to - from]);
        }
        assert_eq!(gamma_table(1, 1, 3, 2, 10), [0, 17, 24, 30]);
    }
}
