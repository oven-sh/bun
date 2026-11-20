//! A guess at which transforms suit an image.

use super::entropy::{Cost, ONE_BIT, log2, set_bits, symbols_cost};
use super::palette::Colors;
use super::sub;
use crate::array::At;
use crate::error::Result;
use crate::lossless::Argb;
use crate::slice::InBounds;
use crate::vec;

/// Those for an image without a palette.
#[derive(Clone, Copy)]
pub(super) struct Transforms {
    pub(super) subtract_green: bool,
    pub(super) predictor: bool,
    pub(super) cross_color: bool,
}

type Counts = [u32; 256];

#[derive(Clone)]
struct Channels {
    alpha: Counts,
    red: Counts,
    green: Counts,
    blue: Counts,
    red_minus_green: Counts,
    blue_minus_green: Counts,
}

impl Channels {
    const EMPTY: Self = Self {
        alpha: [0; 256],
        red: [0; 256],
        green: [0; 256],
        blue: [0; 256],
        red_minus_green: [0; 256],
        blue_minus_green: [0; 256],
    };

    #[inline(always)]
    fn add(&mut self, pixel: Argb, count: u32) {
        let [blue, green, red, alpha] = pixel.to_le_bytes();
        for (counts, value) in [
            (&mut self.alpha, alpha),
            (&mut self.red, red),
            (&mut self.green, green),
            (&mut self.blue, blue),
            (&mut self.red_minus_green, red.wrapping_sub(green)),
            (&mut self.blue_minus_green, blue.wrapping_sub(green)),
        ] {
            *counts.at_mut(value.into()) += count;
        }
    }

    /// As they are, and with green subtracted.
    fn costs(&self) -> [Cost; 2] {
        let shared = symbols_cost(&self.alpha) + symbols_cost(&self.green);
        [
            shared + symbols_cost(&self.red) + symbols_cost(&self.blue),
            shared + symbols_cost(&self.red_minus_green) + symbols_cost(&self.blue_minus_green),
        ]
    }
}

/// Stands in for the index into a palette.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L100
#[inline(always)]
const fn hash(pixel: Argb) -> usize {
    let sum = pixel.wrapping_add(pixel >> 19);
    (sum.wrapping_mul(0x39c5_fba7) >> 24) as usize
}

/// Calls `visit` with each pixel and the one before it, but for those that repeat, which are going to be copied.
#[inline(always)]
fn for_each_change<P: Copy + Eq>(pixels: &[P], width: usize, mut visit: impl FnMut(P, P)) {
    const CHUNK: usize = 16;
    let (first_row, others) = pixels.split_at_checked(width).unwrap_or_default();
    for &[before, pixel] in first_row.array_windows() {
        if pixel != before {
            visit(pixel, before);
        }
    }
    let befores = pixels.part(width - 1..);
    let (chunks, rest) = others.as_chunks::<CHUNK>();
    let neighbors = befores
        .as_chunks::<CHUNK>()
        .0
        .iter()
        .zip(pixels.as_chunks::<CHUNK>().0);
    for (chunk, (before, above)) in chunks.iter().zip(neighbors) {
        let mut changes = 0u16;
        for (i, (pixel, (before, above))) in chunk.iter().zip(before.iter().zip(above)).enumerate()
        {
            changes |= u16::from((pixel != before) & (pixel != above)) << i;
        }
        for i in set_bits(changes.into()) {
            visit(*chunk.at(i), *before.at(i));
        }
    }
    let neighbors = befores.iter().zip(pixels).skip(others.len() - rest.len());
    for (&pixel, (&before, &above)) in rest.iter().zip(neighbors) {
        if pixel != before && pixel != above {
            visit(pixel, before);
        }
    }
}

/// `tiles` is how many the predictor would have.
pub(super) fn for_colors(pixels: &[Argb], width: usize, tiles: usize) -> Result<Transforms> {
    let [plain, predicted] = &mut *vec::array(Channels::EMPTY)?;
    for_each_change(pixels, width, |pixel, before| {
        plain.add(pixel, 1);
        predicted.add(sub(pixel, before), 1);
    });
    Ok(choose(plain, predicted, tiles).0)
}

/// `None` stands for the palette.
pub(super) fn for_bytes(
    bytes: &[u8],
    colors: &Colors,
    width: usize,
    tiles: usize,
    palette_len: usize,
) -> Result<Option<Transforms>> {
    let [plain, predicted] = &mut *vec::array(Channels::EMPTY)?;
    let [by_byte, by_hash]: &mut [Counts; 2] = &mut *vec::array([0; _])?;
    for_each_change(bytes, width, |byte, before| {
        *by_byte.at_mut(byte.into()) += 1;
        let [color, before] = [byte, before].map(|byte| *colors.at(byte.into()));
        predicted.add(sub(color, before), 1);
    });
    for (&color, &count) in colors.iter().zip(&*by_byte) {
        plain.add(color, count);
        *by_hash.at_mut(hash(color)) += count;
    }
    let (transforms, cost) = choose(plain, predicted, tiles);
    let with_palette = symbols_cost(by_hash) + palette_len as Cost * 8 * ONE_BIT;
    Ok((cost <= with_palette).then_some(transforms))
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L106
fn choose(plain: &Channels, predicted: &mut Channels, tiles: usize) -> (Transforms, Cost) {
    // At least one of the zeros that were left out is likely to be there.
    predicted.add(0, 1);

    let ([plain, plain_minus_green], [spatial, spatial_minus_green]) =
        (plain.costs(), predicted.costs());
    let tiles_with = |choices| tiles as Cost * Cost::from(log2(choices));
    let candidates = [
        (plain, false, false),
        (spatial + tiles_with(14), true, false),
        (plain_minus_green, false, true),
        (spatial_minus_green + tiles_with(24), true, true),
    ];
    let [mut best, others @ ..] = candidates;
    for candidate in others {
        if candidate.0 < best.0 {
            best = candidate;
        }
    }
    let (cost, predictor, subtract_green) = best;
    let ([_, red @ ..], [_, blue @ ..]) = if subtract_green {
        (&predicted.red_minus_green, &predicted.blue_minus_green)
    } else {
        (&predicted.red, &predicted.blue)
    };
    let transforms = Transforms {
        subtract_green,
        predictor,
        cross_color: predictor && red.iter().chain(blue).any(|&count| count != 0),
    };
    (transforms, cost)
}
