//! The cross-color transform, which takes from red what green tells about it, and from blue what green and red do.

use core::ops::Range;

use super::entropy::{ONE_BIT, set_bits};
use super::matches::differences;
use super::residuals::{Bias, Counts, Totals};
use super::sub;
use super::tiles::Tiles;
use crate::array::At;
use crate::error::Result;
use crate::lossless::{Argb, color_cache_key, subsampled};
use crate::slice::InBounds;
use crate::vec;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L282
pub(super) const MAX_TILE_BITS: u32 = 5;

#[derive(Clone, Copy, Default)]
struct Multipliers {
    green_to_red: i8,
    green_to_blue: i8,
    red_to_blue: i8,
}

impl Multipliers {
    const fn from_pixel(pixel: Argb) -> Self {
        let [green_to_red, green_to_blue, red_to_blue, _] = pixel.to_le_bytes();
        Self {
            green_to_red: green_to_red as i8,
            green_to_blue: green_to_blue as i8,
            red_to_blue: red_to_blue as i8,
        }
    }

    const fn to_pixel(self) -> Argb {
        Argb::from_le_bytes([
            self.green_to_red as u8,
            self.green_to_blue as u8,
            self.red_to_blue as u8,
            0xff,
        ])
    }

    #[inline(always)]
    fn apply(self, pixel: Argb) -> Argb {
        let (green, red) = ((pixel & 0xff00) as i16, (pixel >> 8 & 0xff00) as i16);
        let from_red = delta(self.green_to_red, green);
        let from_blue = delta(self.green_to_blue, green) + delta(self.red_to_blue, red);
        sub(
            pixel,
            Argb::from(from_red as u8) << 16 | Argb::from(from_blue as u8),
        )
    }
}

const MAX_TILE_LEN: usize = 1 << (2 * MAX_TILE_BITS);
const LANES: usize = 8;

/// Some of the colors of a tile.
struct Lanes {
    /// Both in the high byte.
    green: [i16; LANES],
    red: [i16; LANES],
    blue: [i16; LANES],
    /// How many pixels have it.
    count: [u16; LANES],
}

/// How much to take from another channel for `color`, which is in the high byte: a 32nd of the product.
#[inline(always)]
fn delta(multiplier: i8, color: i16) -> i16 {
    ((i32::from(color) * i32::from(i16::from(multiplier) << 3)) >> 16) as i16
}

/// The colors of a tile. Most of those that several pixels have are there only once.
struct Colors {
    pixels: Box<[Argb; MAX_TILE_LEN]>,
    counts: Box<[u16; MAX_TILE_LEN]>,
    len: usize,
    /// By hash, where in `pixels` a color may be.
    indices: Box<[u16; 2 * MAX_TILE_LEN]>,
    lanes: Vec<Lanes>,
}

impl Colors {
    #[inline(always)]
    fn add(&mut self, pixel: Argb, count: u16) {
        let pixel = pixel & 0x00ff_ffff;
        let index = color_cache_key(pixel, 2 * MAX_TILE_BITS + 1);
        let index = self.indices.at_mut(index);
        let known = usize::from(*index);
        let is_known = (known < self.len) & (*self.pixels.at(known) == pixel);
        let at = if is_known { known } else { self.len };
        *index = at as u16;
        *self.pixels.at_mut(at) = pixel;
        *self.counts.at_mut(at) += count;
        self.len += usize::from(!is_known);
    }

    fn add_row(&mut self, row: &[Argb]) {
        let (fours, rest) = row.as_chunks::<4>();
        for &four @ [first, ..] in fours {
            if four == [first; 4] {
                self.add(first, 4);
            } else {
                four.into_iter().for_each(|pixel| self.add(pixel, 1));
            }
        }
        rest.iter().for_each(|&pixel| self.add(pixel, 1));
    }

    /// Moves what was added to `lanes`.
    fn finish(&mut self) {
        self.lanes.clear();
        let (pixels, counts) = (self.pixels.as_chunks().0, self.counts.as_chunks_mut().0);
        let used = pixels.iter().zip(counts).take(self.len.div_ceil(LANES));
        self.lanes.extend(used.map(|(pixels, counts)| Lanes {
            green: pixels.map(|pixel: Argb| (pixel & 0xff00) as i16),
            red: pixels.map(|pixel| (pixel >> 8 & 0xff00) as i16),
            blue: pixels.map(|pixel| (pixel & 0xff) as i16),
            count: core::mem::take(counts),
        }));
        self.len = 0;
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/predictor_enc.c#L854
    #[inline(always)]
    fn cost(&self, totals: &Totals, channel: impl Fn(&Lanes, usize) -> i16) -> i64 {
        const BIAS: Bias = Bias::new(3, 240);
        let mut counts: Counts = [0; 256];
        for lanes in &self.lanes {
            let values: [i16; LANES] = core::array::from_fn(|i| channel(lanes, i));
            for (value, count) in values.into_iter().zip(lanes.count) {
                *counts.at_mut(usize::from(value as u8)) += count;
            }
        }
        totals.entropy_with(&counts) + BIAS.cost(&counts)
    }

    fn red_cost(&self, totals: &Totals, from_green: i8) -> i64 {
        self.cost(totals, |lanes, i| {
            (*lanes.red.at(i) >> 8) - delta(from_green, *lanes.green.at(i))
        })
    }

    fn blue_cost(&self, totals: &Totals, from_green: i8, from_red: i8) -> i64 {
        self.cost(totals, |lanes, i| {
            *lanes.blue.at(i)
                - delta(from_green, *lanes.green.at(i))
                - delta(from_red, *lanes.red.at(i))
        })
    }
}

/// For being 0, or the same as in a tile nearby.
fn bonus(multiplier: i8, nearby: [i8; 2]) -> i64 {
    let [before, above] = nearby;
    let same = [before, above, 0].map(|other| i64::from(multiplier == other));
    same.iter().sum::<i64>() * 3 * ONE_BIT as i64
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/predictor_enc.c#L888
fn best_for_red(tile: &Colors, totals: &Totals, nearby: [Multipliers; 2]) -> i8 {
    let nearby = nearby.map(|it| it.green_to_red);
    let cost = |from_green| tile.red_cost(totals, from_green) - bonus(from_green, nearby);
    let (mut best, mut least) = (0, cost(0));
    for step in [32, 16, 8, 4, 2] {
        for candidate in [best - step, best + step] {
            let cost = cost(candidate);
            if cost < least {
                (best, least) = (candidate, cost);
                // The step back leads to what has just been beaten.
                break;
            }
        }
    }
    best
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/predictor_enc.c#L957
fn best_for_blue(tile: &Colors, totals: &Totals, nearby: [Multipliers; 2]) -> [i8; 2] {
    const DIRECTIONS: [[i8; 2]; 8] = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
    ];
    const STEPS: [i8; 7] = [16, 16, 8, 4, 2, 2, 2];
    let cost = |[from_green, from_red]: [i8; 2]| {
        tile.blue_cost(totals, from_green, from_red)
            - bonus(from_green, nearby.map(|it| it.green_to_blue))
            - bonus(from_red, nearby.map(|it| it.red_to_blue))
    };
    let (mut best, mut least) = ([0i8; 2], cost([0; 2]));
    // What has been tried is no better the next time. The rest is where it starts.
    let mut tried = [best; STEPS.len() * DIRECTIONS.len()];
    let mut tries = 0;
    for step in STEPS {
        for [green, red] in DIRECTIONS {
            let [from_green, from_red] = best;
            let candidate = [
                from_green.wrapping_add(green * step),
                from_red.wrapping_add(red * step),
            ];
            if tried.iter().fold(false, |any, &it| any | (it == candidate)) {
                continue;
            }
            *tried.at_mut(tries) = candidate;
            tries += 1;
            let cost = cost(candidate);
            if cost < least {
                (best, least) = (candidate, cost);
            }
        }
    }
    best
}

/// A bit for each pixel of `row` that is unlikely to be copied from the left or from above, and maybe more behind those.
fn not_repeated(pixels: &[Argb], row: Range<usize>, width: usize) -> u64 {
    // From two pixels before the row on.
    let same_at = |distance: usize| {
        let missing = (distance + 2).saturating_sub(row.start);
        let start = row.start + missing - 2;
        let here = pixels.get(start..row.end).unwrap_or_default();
        let earlier = pixels.get(start - distance..).unwrap_or_default();
        let (fours, rest) = here.as_chunks::<4>();
        let mut same = 0;
        for (index, (a, b)) in fours.iter().zip(earlier.as_chunks().0).enumerate() {
            same |= u64::from(differences(a, b) ^ 0xf) << (4 * index);
        }
        let done = here.len() - rest.len();
        for (index, (a, b)) in here.iter().zip(earlier).enumerate().skip(done) {
            same |= u64::from(a == b) << index;
        }
        same.unbounded_shl(missing as u32)
    };
    let (left, above) = (same_at(1), same_at(width));
    !((left >> 1 & left >> 2) | (above & above >> 1 & above >> 2))
}

/// Returns the multipliers of each tile.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/predictor_enc.c#L1045
pub(super) fn apply(pixels: &mut [Argb], width: usize, height: usize, bits: u32) -> Result<Tiles> {
    let mut tiles = Tiles::new(width, height, bits)?;
    let [red_totals, blue_totals] = &mut *vec::array(Totals::EMPTY)?;
    let mut tile = Colors {
        pixels: vec::array(0)?,
        counts: vec::array(0)?,
        len: 0,
        indices: vec::array(0)?,
        lanes: vec::with_room(MAX_TILE_LEN / LANES)?,
    };
    let mut before = Multipliers::default();
    for tile_y in 0..subsampled(height, bits) {
        for tile_x in 0..tiles.per_row {
            let (x, y) = (tile_x << bits, tile_y << bits);
            let (x_end, y_end) = (width.min(x + (1 << bits)), height.min(y + (1 << bits)));
            let rows = || (y..y_end).map(|y| y * width + x..y * width + x_end);
            for row in rows() {
                tile.add_row(pixels.part(row));
            }
            tile.finish();
            let above = tiles.above_next().map(Multipliers::from_pixel);
            let nearby = [before, above.unwrap_or_default()];
            let green_to_red = best_for_red(&tile, red_totals, nearby);
            let [green_to_blue, red_to_blue] = best_for_blue(&tile, blue_totals, nearby);
            before = Multipliers {
                green_to_red,
                green_to_blue,
                red_to_blue,
            };
            tiles.pixels.push(before.to_pixel());

            let (mut reds, mut blues): (Counts, Counts) = ([0; 256], [0; 256]);
            for row in rows() {
                for pixel in pixels.part_mut(row.start..row.end) {
                    *pixel = before.apply(*pixel);
                }
                let counted = not_repeated(pixels, row.start..row.end, width);
                let row = pixels.part(row);
                for pixel in set_bits(counted).map_while(|x| row.get(x)) {
                    let [blue, _, red, _] = pixel.to_le_bytes();
                    *reds.at_mut(red.into()) += 1;
                    *blues.at_mut(blue.into()) += 1;
                }
            }
            red_totals.add(&reds);
            blue_totals.add(&blues);
        }
    }
    tiles.merge();
    Ok(tiles)
}
