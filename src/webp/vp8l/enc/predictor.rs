//! `predictor_enc.c`: chooses the spatial predictor and the colour transform of each tile, and applies them.

use super::lossless::{
    Accumulated, ColorTile, LOG_2_PRECISION_BITS, Multipliers, combined_shannon_entropy, div_round,
    transform_color,
};
use crate::EncodeError;
use crate::util::{Checked, SliceExt, try_vec};
use crate::vp8l::enc::predictors::{
    predictor0, predictor1, predictor2, predictor3, predictor4, predictor5, predictor6, predictor7,
    predictor8, predictor9, predictor10, predictor11, predictor12, predictor13, sub_pixels,
};
use crate::vp8l::format_constants::{ARGB_BLACK, MAX_TRANSFORM_BITS, sub_sample_size};

const SPATIAL_PREDICTOR_BIAS: i64 = 15 << LOG_2_PRECISION_BITS;
const MASK_ALPHA: u32 = 0xff00_0000;
const NUM_PRED_MODES: usize = 14;

/// The counts of the values of alpha, red, green and blue.
type HistoArgb = [[u32; 256]; 4];

//------------------------------------------------------------------------------
// Methods to calculate Entropy (Shannon).

/// A bias, hence negative, in favour of values near 0. `exp_val` is a percentage.
fn prediction_cost_bias(counts: &[u32; 256], weight_0: u64, exp_val: u64) -> i64 {
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
    accumulated: &[Accumulated; 4],
    tile: &HistoArgb,
    mode: usize,
    left_mode: Option<usize>,
    above_mode: Option<usize>,
) -> i64 {
    let mut retval = 0;
    for (tile, accumulated) in tile.iter().zip(accumulated) {
        retval += prediction_cost_bias(tile, 1, 94);
        // A low entropy both of the tile and of the image so far with it.
        retval += combined_shannon_entropy(tile, accumulated) as i64;
    }
    if Some(mode) == left_mode {
        retval -= SPATIAL_PREDICTOR_BIAS;
    }
    if Some(mode) == above_mode {
        retval -= SPATIAL_PREDICTOR_BIAS;
    }
    retval
}

#[inline]
fn update_histo(histo_argb: &mut HistoArgb, argb: u32) -> Checked {
    let [b, g, r, a] = argb.to_le_bytes();
    for (histo, value) in histo_argb.iter_mut().zip([a, r, g, b]) {
        *histo.at_mut(value.into())? += 1;
    }
    Ok(())
}

//------------------------------------------------------------------------------
// Spatial transform functions.

/// The difference between `current` and `predict`. Unless `EXACT`, the colour of a transparent pixel is free to
/// choose: it becomes the predicted one, in `current` too because later predictions depend on it.
#[inline]
fn residual_of<const EXACT: bool>(current: &mut u32, predict: u32) -> u32 {
    let residual = sub_pixels(*current, predict);
    if !EXACT && *current & MASK_ALPHA == 0 {
        *current = predict & !MASK_ALPHA;
        residual & MASK_ALPHA
    } else {
        residual
    }
}

/// The residuals of `current_row[x_start..x_end]`, where `x_start` is not 0.
#[inline]
fn predict_batch<const EXACT: bool>(
    predictor: impl Fn(u32, u32, u32, u32) -> u32,
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
            *out = sub_pixels(current, predictor(left, top_left, top, top_right));
        }
    } else {
        let mut left = current_row.at(x_start - 1)?;
        let current = current_row.sub_mut(x_start..x_end)?;
        for ((current, &[top_left, top, top_right]), out) in current.iter_mut().zip(upper).zip(out)
        {
            *out = residual_of::<EXACT>(current, predictor(left, top_left, top, top_right));
            left = *current;
        }
    }
    Ok(())
}

/// `GetResidual`: stores in `out` the residuals of `current_row[x_start..x_end]`, which is part of row `y`. Both rows
/// have `width + 1` pixels: the first pixel of the next row is the top right neighbour of the last pixel below.
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
        let predict = if y == 0 { ARGB_BLACK } else { upper_row.at(0)? };
        let first = current_row.at_mut(0)?;
        out.put(0, residual_of::<EXACT>(first, predict))?;
        if !EXACT && y != 0 {
            upper_row.put(width, *first)?;
        }
        x_start = 1;
        out = out.sub_mut(1..)?;
    }
    macro_rules! batch {
        ($predictor:expr) => {
            predict_batch::<EXACT>($predictor, upper_row, current_row, x_start, x_end, out)
        };
    }
    match if y == 0 { 1 } else { mode } {
        0 => batch!(predictor0),
        1 => batch!(predictor1),
        2 => batch!(predictor2),
        3 => batch!(predictor3),
        4 => batch!(predictor4),
        5 => batch!(predictor5),
        6 => batch!(predictor6),
        7 => batch!(predictor7),
        8 => batch!(predictor8),
        9 => batch!(predictor9),
        10 => batch!(predictor10),
        11 => batch!(predictor11),
        12 => batch!(predictor12),
        _ => batch!(predictor13),
    }
}

/// The mode that an element of the predictor image stands for.
const fn mode_of(pixel: u32) -> usize {
    ((pixel >> 8) & 0xff) as usize
}

/// Finds the best predictor for a tile from the histograms of the residuals of each, and adds the histogram of that
/// one to `accumulated_argb`.
fn get_best_predictor_for_tile(
    all_argb: &[HistoArgb],
    tile_x: usize,
    tile_y: usize,
    tiles_per_row: usize,
    accumulated_argb: &mut [Accumulated; 4],
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
    for (mode, histo_argb) in all_argb.iter().enumerate() {
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
    for (accumulated, best) in accumulated_argb.iter_mut().zip(all_argb.at_ref(best_mode)?) {
        accumulated.add(best);
    }
    modes.put(index, ARGB_BLACK | ((best_mode as u32) << 8))
}

/// Two rows of `width + 1` pixels.
struct Rows<'a> {
    upper: &'a mut [u32],
    current: &'a mut [u32],
}

/// Adds to `all_argb` the residuals that each predictor leaves in a tile.
fn compute_residuals_for_tile<const EXACT: bool>(
    width: usize,
    height: usize,
    tile_x: usize,
    tile_y: usize,
    bits: u32,
    all_argb: &mut [HistoArgb],
    rows: &mut Rows<'_>,
    argb: &[u32],
) -> Checked {
    let start_x = tile_x << bits;
    let start_y = tile_y << bits;
    let tile_size = 1 << bits;
    let max_y = tile_size.min(height - start_y);
    let max_x = tile_size.min(width - start_x);
    // The tile and the column to its left, if there is one.
    let have_left = usize::from(start_x > 0);
    let context_start_x = start_x - have_left;
    let context_width = max_x + have_left;
    let mut residuals = [0u32; 1 << MAX_TRANSFORM_BITS];
    let residuals = residuals.sub_mut(..max_x)?;

    for (mode, histo_argb) in all_argb.iter_mut().enumerate() {
        // A row is read with the pixel to the right of the tile, which at the right edge is the first one of the next
        // row. Only the very last pixel of the image has none.
        let read_row = |row: &mut [u32], y: usize| -> Checked {
            let len = context_width + usize::from(y + 1 < height);
            let start = y * width + context_start_x;
            row.write_at(context_start_x, argb.sub(start..start + len)?)
        };
        if start_y > 0 {
            read_row(rows.current, start_y - 1)?;
        }
        for y in start_y..start_y + max_y {
            core::mem::swap(&mut rows.upper, &mut rows.current);
            read_row(rows.current, y)?;
            get_residual::<EXACT>(
                width,
                rows.upper,
                rows.current,
                mode,
                start_x,
                start_x + max_x,
                y,
                residuals,
            )?;
            for &residual in residuals.iter() {
                update_histo(histo_argb, residual)?;
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

/// `VP8LOptimizeSampling`: `image` has one element for each tile of `1 << bits` pixels squared. If it is made of
/// squares of equal elements, shrinks it so that each becomes a single element. Returns the new `bits`.
pub(crate) fn optimize_sampling(
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
) -> Result<(Vec<u32>, u32), EncodeError> {
    let tiles_per_row = sub_sample_size(width, bits);
    let tiles_per_col = sub_sample_size(height, bits);
    let mut modes = try_vec(0u32, tiles_per_row * tiles_per_col)?;
    let mut argb_scratch = try_vec(0u32, 2 * (width + 1))?;
    let (upper, current) = argb_scratch.halves_mut(width + 1)?;
    let mut rows = Rows { upper, current };

    let mut all_argb = try_vec([[0u32; 256]; 4], NUM_PRED_MODES)?;
    let mut accumulated_argb = [const { Accumulated::new() }; 4];
    for tile_y in 0..tiles_per_col {
        for tile_x in 0..tiles_per_row {
            compute_residuals_for_tile::<EXACT>(
                width,
                height,
                tile_x,
                tile_y,
                bits,
                &mut all_argb,
                &mut rows,
                argb,
            )?;
            get_best_predictor_for_tile(
                &all_argb,
                tile_x,
                tile_y,
                tiles_per_row,
                &mut accumulated_argb,
                &mut modes,
            )?;
            all_argb.fill([[0; 256]; 4]);
        }
    }

    let best_bits = optimize_sampling(&mut modes, width, height, bits, MAX_TRANSFORM_BITS)?;
    modes.truncate(sub_sample_size(width, best_bits) * sub_sample_size(height, best_bits));
    copy_image_with_prediction::<EXACT>(width, height, best_bits, &modes, &mut rows, argb)?;
    Ok((modes, best_bits))
}

/// `VP8LResidualImage`: finds the best predictor for each tile of `1 << bits` pixels squared and replaces the pixels by
/// their residuals. Returns the predictor image and the size of the tiles that it ends up with. Unless `exact`,
/// transparent pixels lose their colour.
pub(crate) fn residual_image(
    width: usize,
    height: usize,
    bits: u32,
    argb: &mut [u32],
    exact: bool,
) -> Result<(Vec<u32>, u32), EncodeError> {
    // Without transparent pixels it makes no difference, and pixels that stay as they are can be dealt with in parallel.
    if exact || argb.iter().all(|pixel| pixel & MASK_ALPHA != 0) {
        residual_image_with::<true>(width, height, bits, argb)
    } else {
        residual_image_with::<false>(width, height, bits, argb)
    }
}

//------------------------------------------------------------------------------
// Color transform functions.

const fn color_code_to_multipliers(color_code: u32) -> Multipliers {
    let [green_to_red, green_to_blue, red_to_blue, _] = color_code.to_le_bytes();
    Multipliers {
        green_to_red,
        green_to_blue,
        red_to_blue,
    }
}

const fn multipliers_to_color_code(m: Multipliers) -> u32 {
    u32::from_le_bytes([m.green_to_red, m.green_to_blue, m.red_to_blue, 0xff])
}

/// The `quality` of an image. In an alpha plane red and blue are 0, so that it never gets this transform.
const QUALITY: i32 = 70;

/// What is taken off the cost for each way in which a multiplier is like its neighbours, or 0.
const SAME_MULTIPLIER_BIAS: i64 = 3 << LOG_2_PRECISION_BITS;

fn prediction_cost_cross_color(accumulated: &Accumulated, counts: &[u32; 256]) -> i64 {
    combined_shannon_entropy(counts, accumulated) as i64 + prediction_cost_bias(counts, 3, 240)
}

/// A tile, and what the search for its multipliers depends on.
struct Tile {
    pixels: ColorTile,
    /// The multipliers of the tile to the left and of the one above.
    prev_x: Multipliers,
    prev_y: Multipliers,
}

impl Tile {
    fn get_prediction_cost_cross_color_red(
        &self,
        green_to_red: i32,
        accumulated_red_histo: &Accumulated,
    ) -> i64 {
        let multiplier = green_to_red as u8;
        let histo = self.pixels.collect_color_red_transforms(multiplier);
        let same = i64::from(multiplier == self.prev_x.green_to_red)
            + i64::from(multiplier == self.prev_y.green_to_red)
            + i64::from(green_to_red == 0);
        prediction_cost_cross_color(accumulated_red_histo, &histo) - same * SAME_MULTIPLIER_BIAS
    }

    fn get_best_green_to_red(&self, accumulated_red_histo: &Accumulated) -> u8 {
        const MAX_ITERS: i32 = 4 + ((7 * QUALITY) >> 8);
        let mut green_to_red_best = 0;
        let mut best_diff =
            self.get_prediction_cost_cross_color_red(green_to_red_best, accumulated_red_histo);
        for iter in 0..MAX_ITERS {
            // 32 stands for 1, so that this explores -2 to 2.
            let delta = 32 >> iter;
            for offset in [-delta, delta] {
                let green_to_red_cur = offset + green_to_red_best;
                let cur_diff = self
                    .get_prediction_cost_cross_color_red(green_to_red_cur, accumulated_red_histo);
                if cur_diff < best_diff {
                    best_diff = cur_diff;
                    green_to_red_best = green_to_red_cur;
                }
            }
        }
        green_to_red_best as u8
    }

    fn get_prediction_cost_cross_color_blue(
        &self,
        green_to_blue: i32,
        red_to_blue: i32,
        accumulated_blue_histo: &Accumulated,
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
    fn get_best_green_red_to_blue(&self, accumulated_blue_histo: &Accumulated) -> (u8, u8) {
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
        let mut best = (0, 0);
        let mut best_diff = self.get_prediction_cost_cross_color_blue(0, 0, accumulated_blue_histo);
        // The steps that repeat lead back to pairs that have been tried, none of which can be an improvement.
        let mut tried = [(0, 0); 1 + OFFSET.len() * DELTA_LUT.len()];
        let mut num_tried = 1;
        for delta in DELTA_LUT {
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
                    self.get_prediction_cost_cross_color_blue(cur.0, cur.1, accumulated_blue_histo);
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

/// `VP8LColorSpaceTransform`: finds the best multipliers for each tile of `1 << bits` pixels squared and applies them.
/// Returns the image of the multipliers and the size of the tiles that it ends up with.
pub(crate) fn color_space_transform(
    width: usize,
    height: usize,
    bits: u32,
    argb: &mut [u32],
) -> Result<(Vec<u32>, u32), EncodeError> {
    let max_tile_size = 1 << bits;
    let tile_xsize = sub_sample_size(width, bits);
    let tile_ysize = sub_sample_size(height, bits);
    let mut image = try_vec(0u32, tile_xsize * tile_ysize)?;
    let mut accumulated_red_histo = Accumulated::new();
    let mut accumulated_blue_histo = Accumulated::new();
    let mut prev_x = Multipliers::default();
    let mut prev_y = Multipliers::default();
    for tile_y in 0..tile_ysize {
        for tile_x in 0..tile_xsize {
            let tile_x_offset = tile_x * max_tile_size;
            let tile_y_offset = tile_y * max_tile_size;
            let all_x_max = (tile_x_offset + max_tile_size).min(width);
            let all_y_max = (tile_y_offset + max_tile_size).min(height);
            let tile_width = all_x_max - tile_x_offset;
            let offset = tile_y * tile_xsize + tile_x;
            if tile_y != 0 {
                prev_y = color_code_to_multipliers(image.at(offset - tile_xsize)?);
            }
            let tile_range =
                tile_y_offset * width + tile_x_offset..(all_y_max - 1) * width + all_x_max;
            let tile = Tile {
                pixels: ColorTile::new(argb.sub(tile_range.clone())?, width, tile_width)?,
                prev_x,
                prev_y,
            };
            let green_to_red = tile.get_best_green_to_red(&accumulated_red_histo);
            let (green_to_blue, red_to_blue) =
                tile.get_best_green_red_to_blue(&accumulated_blue_histo);
            prev_x = Multipliers {
                green_to_red,
                green_to_blue,
                red_to_blue,
            };
            image.put(offset, multipliers_to_color_code(prev_x))?;
            for row in argb.sub_mut(tile_range)?.chunks_mut(width.max(1)) {
                transform_color(prev_x, row.sub_mut(..tile_width)?);
            }

            // Pixels that a backward reference is likely to take care of are left out.
            let mut red_histo = [0u32; 256];
            let mut blue_histo = [0u32; 256];
            for y in tile_y_offset..all_y_max {
                for ix in y * width + tile_x_offset..y * width + all_x_max {
                    let pix = argb.at(ix)?;
                    if ix >= 2 && pix == argb.at(ix - 2)? && pix == argb.at(ix - 1)? {
                        continue;
                    }
                    if ix >= width + 2
                        && argb.at(ix - 2)? == argb.at(ix - width - 2)?
                        && argb.at(ix - 1)? == argb.at(ix - width - 1)?
                        && pix == argb.at(ix - width)?
                    {
                        continue;
                    }
                    let [blue, _, red, _] = pix.to_le_bytes();
                    *red_histo.at_mut(red.into())? += 1;
                    *blue_histo.at_mut(blue.into())? += 1;
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
