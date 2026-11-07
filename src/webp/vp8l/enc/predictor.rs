//! `predictor_enc.c`: chooses the spatial predictor and the color transform of each tile, and applies them.

use super::Quality;
use super::lossless::{
    AccumulatedHistogram, ColorTile, LOG_2_PRECISION_BITS, combined_shannon_entropy, div_round,
    sub_pixels, transform_color,
};
use crate::Result;
use crate::util::{ByteHistogram, Checked, SliceExt, increment, try_vec};
use crate::vp8l::common::{ARGB_BLACK, MAX_TRANSFORM_BITS, Multipliers, sub_sample_size};
use crate::vp8l::predictors::predict;
use core::ops::Range;

const SPATIAL_PREDICTOR_BIAS: i64 = 15 << LOG_2_PRECISION_BITS;
const MASK_ALPHA: u32 = 0xff00_0000;
const NUM_PRED_MODES: usize = 14;

/// The counts of the values of alpha, red, green and blue.
type HistoArgb = [ByteHistogram; 4];

/// A bias, hence negative, in favor of values near 0. `exp_val` is a percentage.
fn prediction_cost_bias(counts: &ByteHistogram, weight_0: u64, exp_val: u64) -> i64 {
    const SIGNIFICANT_SYMBOLS: usize = 256 >> 4;
    let [count_0, ..] = *counts;
    let mut bits = (weight_0 * u64::from(count_0)) << LOG_2_PRECISION_BITS;
    let mut exp_val = exp_val << LOG_2_PRECISION_BITS;
    for (&positive, &negative) in counts
        .iter()
        .skip(1)
        .zip(counts.iter().rev())
        .take(SIGNIFICANT_SYMBOLS - 1)
    {
        bits += div_round::<100>((exp_val * u64::from(positive + negative)) as i64) as u64;
        exp_val = div_round::<10>((6 * exp_val) as i64) as u64;
    }
    -div_round::<10>(bits as i64)
}

fn prediction_cost_spatial_histogram(
    accumulated: &[AccumulatedHistogram; 4],
    tile: &HistoArgb,
    mode: usize,
    left_mode: Option<usize>,
    above_mode: Option<usize>,
) -> i64 {
    let mut cost = 0;
    for (tile, accumulated) in tile.iter().zip(accumulated) {
        cost += prediction_cost_bias(tile, 1, 94);
        // A low entropy both of the tile and of the image so far with it.
        cost += combined_shannon_entropy(tile, accumulated) as i64;
    }
    if Some(mode) == left_mode {
        cost -= SPATIAL_PREDICTOR_BIAS;
    }
    if Some(mode) == above_mode {
        cost -= SPATIAL_PREDICTOR_BIAS;
    }
    cost
}

#[inline]
fn update_histo(histo_argb: &mut HistoArgb, argb: u32) {
    let [b, g, r, a] = argb.to_le_bytes();
    for (histo, value) in histo_argb.iter_mut().zip([a, r, g, b]) {
        increment(histo, value);
    }
}

// Spatial transform functions.

/// `current - prediction`. Unless `EXACT`, a transparent pixel takes the predicted color, in `current` too.
#[inline]
fn residual_of<const EXACT: bool>(current: &mut u32, prediction: u32) -> u32 {
    let residual = sub_pixels(*current, prediction);
    if !EXACT && *current & MASK_ALPHA == 0 {
        *current = prediction & !MASK_ALPHA;
        residual & MASK_ALPHA
    } else {
        residual
    }
}

/// The residuals of `current_row[x_start..x_end]`, where `x_start` is not 0.
#[inline]
fn predict_batch<const EXACT: bool, const MODE: u32>(
    upper_row: &[u32],
    current_row: &mut [u32],
    x_start: usize,
    x_end: usize,
    out: &mut [u32],
) -> Checked {
    let upper = upper_row.sub(x_start - 1..x_end + 1)?.array_windows();
    if EXACT {
        let current = current_row.sub(x_start - 1..x_end)?.array_windows();
        for ((&[left, current], &[top_left, top, top_right]), out) in current.zip(upper).zip(out) {
            *out = sub_pixels(current, predict(MODE, left, top_left, top, top_right));
        }
    } else {
        let mut left = current_row.at(x_start - 1)?;
        let current = current_row.sub_mut(x_start..x_end)?;
        for ((current, &[top_left, top, top_right]), out) in current.iter_mut().zip(upper).zip(out)
        {
            *out = residual_of::<EXACT>(current, predict(MODE, left, top_left, top, top_right));
            left = *current;
        }
    }
    Ok(())
}

/// `GetResidual` of `current_row[x_start..x_end]`. Rows have one more pixel, the last one's top right neighbor.
fn get_residual<const EXACT: bool>(
    width: usize,
    upper_row: &mut [u32],
    current_row: &mut [u32],
    mode: usize,
    mut x_start: usize,
    x_end: usize,
    y: usize,
    mut out: &mut [u32],
) -> Checked {
    if x_start == 0 {
        let prediction = if y == 0 { ARGB_BLACK } else { upper_row.at(0)? };
        let first = current_row.at_mut(0)?;
        out.put(0, residual_of::<EXACT>(first, prediction))?;
        if !EXACT && y != 0 {
            upper_row.put(width, *first)?;
        }
        x_start = 1;
        out = out.sub_mut(1..)?;
    }
    macro_rules! batch {
        ($mode:literal) => {
            predict_batch::<EXACT, $mode>(upper_row, current_row, x_start, x_end, out)
        };
    }
    match if y == 0 { 1 } else { mode } {
        0 => batch!(0),
        1 => batch!(1),
        2 => batch!(2),
        3 => batch!(3),
        4 => batch!(4),
        5 => batch!(5),
        6 => batch!(6),
        7 => batch!(7),
        8 => batch!(8),
        9 => batch!(9),
        10 => batch!(10),
        11 => batch!(11),
        12 => batch!(12),
        _ => batch!(13),
    }
}

/// The mode that an element of the predictor image stands for.
const fn mode_of(pixel: u32) -> usize {
    ((pixel >> 8) & 0xff) as usize
}

/// Picks a tile's predictor by the histograms of the residuals, and adds the winner's to `accumulated_argb`.
fn get_best_predictor_for_tile(
    histos_by_mode: &[HistoArgb],
    tile_x: usize,
    tile_y: usize,
    tiles_per_row: usize,
    accumulated_argb: &mut [AccumulatedHistogram; 4],
    modes: &mut [u32],
) -> Checked {
    let index = tile_y * tiles_per_row + tile_x;
    let left_mode = match tile_x {
        0 => None,
        _ => Some(mode_of(modes.at(index - 1)?)),
    };
    let above_mode = match tile_y {
        0 => None,
        _ => Some(mode_of(modes.at(index - tiles_per_row)?)),
    };
    let mut best_diff = i64::MAX;
    let mut best_mode = 0;
    for (mode, histo_argb) in histos_by_mode.iter().enumerate() {
        let cur_diff = prediction_cost_spatial_histogram(
            accumulated_argb,
            histo_argb,
            mode,
            left_mode,
            above_mode,
        );
        if cur_diff < best_diff {
            best_diff = cur_diff;
            best_mode = mode;
        }
    }
    for (accumulated, best) in accumulated_argb
        .iter_mut()
        .zip(histos_by_mode.at_ref(best_mode)?)
    {
        accumulated.add(best);
    }
    modes.put(index, ARGB_BLACK | ((best_mode as u32) << 8))
}

/// Two rows of `width + 1` pixels.
struct Rows<'a> {
    upper: &'a mut [u32],
    current: &'a mut [u32],
}

/// The part of a tile that is inside the image.
struct TileArea {
    x: Range<usize>,
    y: Range<usize>,
    /// `x` and the column to its left, if there is one.
    context_x: Range<usize>,
}

impl TileArea {
    fn new(width: usize, height: usize, tile_x: usize, tile_y: usize, bits: u32) -> Self {
        let (start_x, start_y) = (tile_x << bits, tile_y << bits);
        let x = start_x..width.min(start_x + (1 << bits));
        Self {
            context_x: start_x.saturating_sub(1)..x.end,
            x,
            y: start_y..height.min(start_y + (1 << bits)),
        }
    }
}

/// Adds to `histos_by_mode` the residuals that each predictor leaves in a tile.
fn compute_residuals_for_tile<const EXACT: bool>(
    width: usize,
    height: usize,
    tile: &TileArea,
    histos_by_mode: &mut [HistoArgb],
    rows: &mut Rows<'_>,
    argb: &[u32],
) -> Checked {
    let mut residuals = [0u32; 1 << MAX_TRANSFORM_BITS];
    let residuals = residuals.sub_mut(..tile.x.len())?;

    for (mode, histo_argb) in histos_by_mode.iter_mut().enumerate() {
        // A row is read with the pixel right of the tile, or else the next row's first. Only the last has none.
        let read_row = |row: &mut [u32], y: usize| -> Checked {
            let len = tile.context_x.len() + usize::from(y + 1 < height);
            let start = y * width + tile.context_x.start;
            row.write_at(tile.context_x.start, argb.sub(start..start + len)?)
        };
        if tile.y.start > 0 {
            read_row(rows.current, tile.y.start - 1)?;
        }
        for y in tile.y.clone() {
            core::mem::swap(&mut rows.upper, &mut rows.current);
            read_row(rows.current, y)?;
            get_residual::<EXACT>(
                width,
                rows.upper,
                rows.current,
                mode,
                tile.x.start,
                tile.x.end,
                y,
                residuals,
            )?;
            for &residual in residuals.iter() {
                update_histo(histo_argb, residual);
            }
        }
    }
    Ok(())
}

/// Replaces the pixels by their residuals.
fn copy_image_with_prediction<const EXACT: bool>(
    width: usize,
    height: usize,
    bits: u32,
    modes: &[u32],
    rows: &mut Rows<'_>,
    argb: &mut [u32],
) -> Checked {
    let tiles_per_row = sub_sample_size(width, bits);
    for y in 0..height {
        core::mem::swap(&mut rows.upper, &mut rows.current);
        let len = width + usize::from(y + 1 < height);
        rows.current
            .write_at(0, argb.sub(y * width..y * width + len)?)?;
        let out = argb.sub_mut(y * width..(y + 1) * width)?;
        let modes = modes.sub((y >> bits) * tiles_per_row..)?;
        let mut x = 0;
        for (out, &mode) in out.chunks_mut(1 << bits).zip(modes) {
            let x_end = x + out.len();
            get_residual::<EXACT>(
                width,
                rows.upper,
                rows.current,
                mode_of(mode),
                x,
                x_end,
                y,
                out,
            )?;
            x = x_end;
        }
    }
    Ok(())
}

/// `VP8LOptimizeSampling`: if `image` is made of squares of equal elements, shrinks each to one. Returns new `bits`.
pub(super) fn optimize_sampling(
    image: &mut [u32],
    full_width: usize,
    full_height: usize,
    bits: u32,
    max_bits: u32,
) -> Checked<u32> {
    let width = sub_sample_size(full_width, bits);
    let height = sub_sample_size(full_height, bits);
    let mut best_bits = bits;
    // Rows first: only the first rows of two halves of a square are compared, the rest was at the size before.
    while best_bits < max_bits {
        let square_size = 1 << (best_bits - bits);
        let mut y = 0;
        let mut is_good = true;
        while is_good && y + square_size < height {
            let other = y + square_size;
            is_good = image.sub(y * width..(y + 1) * width)?
                == image.sub(other * width..(other + 1) * width)?;
            y += 2 * square_size;
        }
        if !is_good {
            break;
        }
        best_bits += 1;
    }

    // Then columns.
    while best_bits > bits {
        let square_size = 1 << (best_bits - bits);
        let is_good = image
            .sub(..width * height)?
            .chunks(width.max(1))
            .all(|row| {
                row.chunks(square_size)
                    .all(|square| square.iter().all(|element| Some(element) == square.first()))
            });
        if is_good {
            break;
        }
        best_bits -= 1;
    }
    if best_bits == bits {
        return Ok(bits);
    }

    let old_width = width;
    let square_size = 1 << (best_bits - bits);
    let width = sub_sample_size(full_width, best_bits);
    let height = sub_sample_size(full_height, best_bits);
    for y in 0..height {
        for x in 0..width {
            image.put(y * width + x, image.at(square_size * (y * old_width + x))?)?;
        }
    }
    Ok(best_bits)
}

fn residual_image_with<const EXACT: bool>(
    width: usize,
    height: usize,
    bits: u32,
    argb: &mut [u32],
) -> Result<(Vec<u32>, u32)> {
    let tiles_per_row = sub_sample_size(width, bits);
    let tiles_per_col = sub_sample_size(height, bits);
    let mut modes = try_vec(0u32, tiles_per_row * tiles_per_col)?;
    let mut argb_scratch = try_vec(0u32, 2 * (width + 1))?;
    let (upper, current) = argb_scratch.split_at_mid(width + 1)?;
    let mut rows = Rows { upper, current };

    let mut histos_by_mode = try_vec([[0u32; 256]; 4], NUM_PRED_MODES)?;
    let mut accumulated_argb = [const { AccumulatedHistogram::new() }; 4];
    for tile_y in 0..tiles_per_col {
        for tile_x in 0..tiles_per_row {
            compute_residuals_for_tile::<EXACT>(
                width,
                height,
                &TileArea::new(width, height, tile_x, tile_y, bits),
                &mut histos_by_mode,
                &mut rows,
                argb,
            )?;
            get_best_predictor_for_tile(
                &histos_by_mode,
                tile_x,
                tile_y,
                tiles_per_row,
                &mut accumulated_argb,
                &mut modes,
            )?;
            histos_by_mode.fill([[0; 256]; 4]);
        }
    }

    let best_bits = optimize_sampling(&mut modes, width, height, bits, MAX_TRANSFORM_BITS)?;
    modes.truncate(sub_sample_size(width, best_bits) * sub_sample_size(height, best_bits));
    copy_image_with_prediction::<EXACT>(width, height, best_bits, &modes, &mut rows, argb)?;
    Ok((modes, best_bits))
}

/// `VP8LResidualImage`: the pixels become residuals. Returns each tile's predictor and the final size of the tiles.
pub(super) fn residual_image(
    width: usize,
    height: usize,
    bits: u32,
    argb: &mut [u32],
    exact: bool,
) -> Result<(Vec<u32>, u32)> {
    // Without transparent pixels it makes no difference, and pixels that stay as they are can be handled in parallel.
    if exact || argb.iter().all(|pixel| pixel & MASK_ALPHA != 0) {
        residual_image_with::<true>(width, height, bits, argb)
    } else {
        residual_image_with::<false>(width, height, bits, argb)
    }
}

// Color transform functions.

/// What each of these takes off the cost: a multiplier equal to the left tile's, to the upper tile's, to 0.
const SAME_MULTIPLIER_BIAS: i64 = 3 << LOG_2_PRECISION_BITS;

fn prediction_cost_cross_color(accumulated: &AccumulatedHistogram, counts: &ByteHistogram) -> i64 {
    combined_shannon_entropy(counts, accumulated) as i64 + prediction_cost_bias(counts, 3, 240)
}

/// A tile, and what the search for its multipliers depends on.
struct MultiplierSearch {
    quality: Quality,
    pixels: ColorTile,
    /// The multipliers of the tile to the left and of the one above.
    prev_x: Multipliers,
    prev_y: Multipliers,
}

impl MultiplierSearch {
    fn prediction_cost_cross_color_red(
        &self,
        green_to_red: i32,
        accumulated_red_histo: &AccumulatedHistogram,
    ) -> i64 {
        let multiplier = green_to_red as u8;
        let histo = self.pixels.collect_color_red_transforms(multiplier);
        let same = i64::from(multiplier == self.prev_x.green_to_red)
            + i64::from(multiplier == self.prev_y.green_to_red)
            + i64::from(green_to_red == 0);
        prediction_cost_cross_color(accumulated_red_histo, &histo) - same * SAME_MULTIPLIER_BIAS
    }

    fn best_green_to_red(&self, accumulated_red_histo: &AccumulatedHistogram) -> u8 {
        let max_iters = 4 + ((7 * self.quality as i32) >> 8);
        let mut green_to_red_best = 0;
        let mut best_diff =
            self.prediction_cost_cross_color_red(green_to_red_best, accumulated_red_histo);
        for iter in 0..max_iters {
            // 32 stands for 1, so that this explores -2 to 2.
            let delta = 32 >> iter;
            for offset in [-delta, delta] {
                let green_to_red_cur = offset + green_to_red_best;
                let cur_diff =
                    self.prediction_cost_cross_color_red(green_to_red_cur, accumulated_red_histo);
                if cur_diff < best_diff {
                    best_diff = cur_diff;
                    green_to_red_best = green_to_red_cur;
                }
            }
        }
        green_to_red_best as u8
    }

    fn prediction_cost_cross_color_blue(
        &self,
        green_to_blue: i32,
        red_to_blue: i32,
        accumulated_blue_histo: &AccumulatedHistogram,
    ) -> i64 {
        let (from_green, from_red) = (green_to_blue as u8, red_to_blue as u8);
        let histo = self
            .pixels
            .collect_color_blue_transforms(from_green, from_red);
        let same = i64::from(from_green == self.prev_x.green_to_blue)
            + i64::from(from_green == self.prev_y.green_to_blue)
            + i64::from(from_red == self.prev_x.red_to_blue)
            + i64::from(from_red == self.prev_y.red_to_blue)
            + i64::from(green_to_blue == 0)
            + i64::from(red_to_blue == 0);
        prediction_cost_cross_color(accumulated_blue_histo, &histo) - same * SAME_MULTIPLIER_BIAS
    }

    /// Returns `green_to_blue` and `red_to_blue`.
    fn best_green_red_to_blue(&self, accumulated_blue_histo: &AccumulatedHistogram) -> (u8, u8) {
        const OFFSET: [(i32, i32); 8] = [
            (0, -1),
            (0, 1),
            (-1, 0),
            (1, 0),
            (-1, -1),
            (-1, 1),
            (1, -1),
            (1, 1),
        ];
        const DELTA_LUT: [i32; 7] = [16, 16, 8, 4, 2, 2, 2];
        // libwebp also skips the diagonals of the fifth step below a quality of 25, where there is no fifth step.
        let iters = match self.quality {
            Quality::Palette => 1,
            Quality::AlphaPlane => 4,
            Quality::Image => DELTA_LUT.len(),
        };
        let mut best = (0, 0);
        let mut best_diff = self.prediction_cost_cross_color_blue(0, 0, accumulated_blue_histo);
        // The steps that repeat lead back to pairs that have been tried, none of which can be an improvement.
        let mut tried = [(0, 0); 1 + OFFSET.len() * DELTA_LUT.len()];
        let mut num_tried = 1;
        for delta in DELTA_LUT.into_iter().take(iters) {
            for (green_offset, red_offset) in OFFSET {
                let cur = (green_offset * delta + best.0, red_offset * delta + best.1);
                if tried.iter().take(num_tried).any(|&pair| pair == cur) {
                    continue;
                }
                if let Some(slot) = tried.get_mut(num_tried) {
                    *slot = cur;
                    num_tried += 1;
                }
                let cur_diff =
                    self.prediction_cost_cross_color_blue(cur.0, cur.1, accumulated_blue_histo);
                if cur_diff < best_diff {
                    best_diff = cur_diff;
                    best = cur;
                }
            }
            if delta == 2 && best == (0, 0) {
                break;
            }
        }
        (best.0 as u8, best.1 as u8)
    }
}

/// `VP8LColorSpaceTransform`: applies each tile's best multipliers. Returns them and the final size of the tiles.
pub(super) fn color_space_transform(
    width: usize,
    height: usize,
    bits: u32,
    quality: Quality,
    argb: &mut [u32],
) -> Result<(Vec<u32>, u32)> {
    let tiles_per_row = sub_sample_size(width, bits);
    let tiles_per_col = sub_sample_size(height, bits);
    let mut image = try_vec(0u32, tiles_per_row * tiles_per_col)?;
    let mut accumulated_red_histo = AccumulatedHistogram::new();
    let mut accumulated_blue_histo = AccumulatedHistogram::new();
    let mut prev_x = Multipliers::default();
    let mut prev_y = Multipliers::default();
    for tile_y in 0..tiles_per_col {
        for tile_x in 0..tiles_per_row {
            let area = TileArea::new(width, height, tile_x, tile_y, bits);
            let tile_width = area.x.len();
            let index = tile_y * tiles_per_row + tile_x;
            if tile_y != 0 {
                prev_y = Multipliers::from_color_code(image.at(index - tiles_per_row)?);
            }
            let tile_range =
                area.y.start * width + area.x.start..(area.y.end - 1) * width + area.x.end;
            let search = MultiplierSearch {
                quality,
                pixels: ColorTile::new(argb.sub(tile_range.clone())?, width, tile_width)?,
                prev_x,
                prev_y,
            };
            let green_to_red = search.best_green_to_red(&accumulated_red_histo);
            let (green_to_blue, red_to_blue) =
                search.best_green_red_to_blue(&accumulated_blue_histo);
            prev_x = Multipliers {
                green_to_red,
                green_to_blue,
                red_to_blue,
            };
            image.put(index, prev_x.to_color_code())?;
            for row in argb.sub_mut(tile_range)?.chunks_mut(width.max(1)) {
                transform_color(prev_x, row.sub_mut(..tile_width)?);
            }

            // Pixels that a backward reference is likely to take care of are left out.
            let mut red_histo = [0u32; 256];
            let mut blue_histo = [0u32; 256];
            for y in area.y {
                for idx in y * width + area.x.start..y * width + area.x.end {
                    let pix = argb.at(idx)?;
                    if idx >= 2 && pix == argb.at(idx - 2)? && pix == argb.at(idx - 1)? {
                        continue;
                    }
                    if idx >= width + 2
                        && argb.at(idx - 2)? == argb.at(idx - width - 2)?
                        && argb.at(idx - 1)? == argb.at(idx - width - 1)?
                        && pix == argb.at(idx - width)?
                    {
                        continue;
                    }
                    let [blue, _, red, _] = pix.to_le_bytes();
                    increment(&mut red_histo, red);
                    increment(&mut blue_histo, blue);
                }
            }
            accumulated_red_histo.add(&red_histo);
            accumulated_blue_histo.add(&blue_histo);
        }
    }
    let best_bits = optimize_sampling(&mut image, width, height, bits, MAX_TRANSFORM_BITS)?;
    image.truncate(sub_sample_size(width, best_bits) * sub_sample_size(height, best_bits));
    Ok((image, best_bits))
}
