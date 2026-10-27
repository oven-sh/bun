//! `alpha_enc.c`, and the forward filters of `filters.c` and `filters_utils.c`.

use super::{ALPHA_LOSSLESS_COMPRESSION, ALPHA_NO_COMPRESSION, Filter};
use crate::EncodeError;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_vec};
use crate::vp8l::enc::{BitWriter, Config, encode_stream};

#[inline]
fn gradient_predictor(a: u8, b: u8, c: u8) -> u8 {
    (i32::from(a) + i32::from(b) - i32::from(c)).clamp(0, 255) as u8
}

/// `dst = src - pred`
#[inline]
fn predict_line(src: &[u8], pred: &[u8], dst: &mut [u8]) {
    for ((dst, src), pred) in dst.iter_mut().zip(src).zip(pred) {
        *dst = src.wrapping_sub(*pred);
    }
}

/// `WebPFilters`: `out` gets what `filter`, which is not `None`, leaves of `data`.
fn apply_filter(filter: Filter, data: &[u8], width: usize, out: &mut [u8]) -> Checked {
    let mut rows = data.chunks_exact(width).zip(out.chunks_exact_mut(width));
    // The first value stays, and the rest of the first row is predicted from the left.
    let (mut above, first_out) = rows.next().ok_or(Bug)?;
    first_out.put(0, above.at(0)?)?;
    predict_line(above.sub(1..)?, above, first_out.sub_mut(1..)?);

    for (row, out) in rows {
        if filter == Filter::Vertical {
            predict_line(row, above, out);
        } else {
            // There is nothing to the left of the first value.
            predict_line(row, above, out.sub_mut(..1)?);
            let out = out.sub_mut(1..)?;
            if filter == Filter::Horizontal {
                predict_line(row.sub(1..)?, row, out);
            } else {
                for ((out, &[left, value]), &[top_left, top]) in out
                    .iter_mut()
                    .zip(row.array_windows())
                    .zip(above.array_windows())
                {
                    *out = value.wrapping_sub(gradient_predictor(left, top, top_left));
                }
            }
        }
        above = row;
    }
    Ok(())
}

/// `WebPEstimateBestFilter`: a quick guess from every other value of every other row.
fn estimate_best_filter(data: &[u8], width: usize, height: usize) -> Checked<Filter> {
    const SMAX: usize = 16;
    const FILTERS: [Filter; 4] = [
        Filter::None,
        Filter::Horizontal,
        Filter::Vertical,
        Filter::Gradient,
    ];
    let sdiff = |a: u8, b: u8| usize::from(a.abs_diff(b) >> 4);
    // Which sizes of error each filter leaves.
    let mut bins = [[false; SMAX]; FILTERS.len()];

    for j in (2..height.saturating_sub(1)).step_by(2) {
        let above = data.sub((j - 1) * width..j * width)?;
        let p = data.sub(j * width..(j + 1) * width)?;
        let mut mean = i32::from(p.at(0)?);
        for i in (2..width.saturating_sub(1)).step_by(2) {
            let value = p.at(i)?;
            let (left, top, top_left) = (p.at(i - 1)?, above.at(i)?, above.at(i - 1)?);
            let diffs = [
                sdiff(value, mean as u8),
                sdiff(value, left),
                sdiff(value, top),
                sdiff(value, gradient_predictor(left, top, top_left)),
            ];
            for (bins, diff) in bins.iter_mut().zip(diffs) {
                bins.put(diff, true)?;
            }
            mean = (3 * mean + i32::from(value) + 2) >> 2;
        }
    }

    let mut best_filter = Filter::None;
    let mut best_score = usize::MAX;
    for (filter, bins) in FILTERS.into_iter().zip(bins) {
        let score = bins
            .into_iter()
            .enumerate()
            .filter(|&(_, is_used)| is_used)
            .map(|(i, _)| i)
            .sum();
        if score < best_score {
            best_score = score;
            best_filter = filter;
        }
    }
    Ok(best_filter)
}

/// `EncodeLossless`: the plane becomes the green channel of an image. `header` comes first.
fn encode_lossless(
    header: u8,
    data: &[u8],
    width: usize,
    height: usize,
) -> Result<Vec<u8>, EncodeError> {
    let mut argb = try_vec(0u32, data.len())?;
    for (argb, &alpha) in argb.iter_mut().zip(data) {
        *argb = u32::from(alpha) << 8;
    }
    // All of this image is transparent, and all of it counts. The quality is 8 times the `method`.
    let config = Config {
        quality: 32,
        exact: true,
    };
    let mut bw = BitWriter::new();
    bw.put_bits(header.into(), 8);
    encode_stream(config, argb, width, height, &mut bw)?;
    Ok(bw.finish()?)
}

/// `EncodeAlphaInternal`: the chunk for `data`, which `filter` has been applied to.
fn encode_alpha_internal(
    data: &[u8],
    width: usize,
    height: usize,
    filter: Filter,
) -> Result<Vec<u8>, EncodeError> {
    let header = |method: u8| method | ((filter as u8) << 2);
    let compressed = encode_lossless(header(ALPHA_LOSSLESS_COMPRESSION), data, width, height)?;
    if compressed.len() <= 1 + data.len() {
        return Ok(compressed);
    }
    let mut chunk = Vec::new();
    chunk
        .try_reserve_exact(1 + data.len())
        .map_err(|_| OutOfMemory)?;
    chunk.push(header(ALPHA_NO_COMPRESSION));
    chunk.extend_from_slice(data);
    Ok(chunk)
}

fn get_num_colors(data: &[u8]) -> usize {
    let mut color = [false; 256];
    for &value in data {
        if let Some(color) = color.get_mut(usize::from(value)) {
            *color = true;
        }
    }
    color.into_iter().filter(|&is_used| is_used).count()
}

/// `VP8EncStartAlpha`/`VP8EncFinishAlpha` with `alpha_compression` 1, `alpha_filtering` 1, `alpha_quality` 100.
pub(crate) fn encode(alpha: &[u8], width: usize, height: usize) -> Result<Vec<u8>, EncodeError> {
    const MIN_COLORS_FOR_FILTER_NONE: usize = 16;
    if width == 0 || height == 0 || alpha.len() != width * height {
        return Err(Bug.into());
    }
    // At this `method` no filter is always tried, and with it the one that looks best unless there are few levels.
    let best = encode_alpha_internal(alpha, width, height, Filter::None)?;
    if get_num_colors(alpha) <= MIN_COLORS_FOR_FILTER_NONE {
        return Ok(best);
    }
    let filter = estimate_best_filter(alpha, width, height)?;
    if filter == Filter::None {
        return Ok(best);
    }
    let mut filtered_alpha = try_vec(0u8, alpha.len())?;
    apply_filter(filter, alpha, width, &mut filtered_alpha)?;
    let trial = encode_alpha_internal(&filtered_alpha, width, height, filter)?;
    Ok(if trial.len() < best.len() {
        trial
    } else {
        best
    })
}
