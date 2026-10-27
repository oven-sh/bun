//! `filters.c` and `filters_utils.c`: the spatial prediction of an alpha plane, and how to undo it.

use crate::util::{Bug, Checked, SliceExt};

/// `WEBP_FILTER_TYPE`, bits 2 and 3 of the first byte of the chunk: what each value is predicted from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Filter {
    None = 0,
    Horizontal = 1,
    Vertical = 2,
    Gradient = 3,
}

#[inline]
fn gradient_predictor(left: u8, top: u8, top_left: u8) -> u8 {
    (i32::from(left) + i32::from(top) - i32::from(top_left)).clamp(0, 255) as u8
}

/// `dst = src - pred`
#[inline]
fn predict_line(src: &[u8], pred: &[u8], dst: &mut [u8]) {
    for ((dst, src), pred) in dst.iter_mut().zip(src).zip(pred) {
        *dst = src.wrapping_sub(*pred);
    }
}

/// `WebPFilters[filter]`: `out` becomes `data` minus its prediction. `filter` is not `None`.
pub(super) fn apply_filter(filter: Filter, data: &[u8], width: usize, out: &mut [u8]) -> Checked {
    let mut rows = data.chunks_exact(width).zip(out.chunks_exact_mut(width));
    // The first value stays, and the rest of the first row is predicted from the left.
    let (mut above, first_out) = rows.next().ok_or(Bug)?;
    first_out.put(0, above.at(0)?)?;
    predict_line(above.sub(1..)?, above, first_out.sub_mut(1..)?);

    for (row, out) in rows {
        // There is nothing to the left of the first value.
        let (first, out) = out.split_at_mid(1)?;
        predict_line(row, above, first);
        match filter {
            Filter::None => return Err(Bug),
            Filter::Horizontal => predict_line(row.sub(1..)?, row, out),
            Filter::Vertical => predict_line(row.sub(1..)?, above.sub(1..)?, out),
            Filter::Gradient => {
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
pub(super) fn estimate_best_filter(data: &[u8], width: usize, height: usize) -> Checked<Filter> {
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

    for y in (2..height.saturating_sub(1)).step_by(2) {
        let above = data.sub((y - 1) * width..y * width)?;
        let row = data.sub(y * width..(y + 1) * width)?;
        let mut mean = i32::from(row.at(0)?);
        for x in (2..width.saturating_sub(1)).step_by(2) {
            let value = row.at(x)?;
            let (left, top, top_left) = (row.at(x - 1)?, above.at(x)?, above.at(x - 1)?);
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

    let score = |bins: &[bool; SMAX]| -> usize {
        let used = bins.iter().enumerate().filter(|&(_, &is_used)| is_used);
        used.map(|(size, _)| size).sum()
    };
    let best = FILTERS
        .into_iter()
        .zip(bins)
        .min_by_key(|(_, bins)| score(bins));
    best.map(|(filter, _)| filter).ok_or(Bug)
}

/// `pred` is the value to the left of the row.
fn horizontal_unfilter(mut pred: u8, row: &mut [u8]) {
    for value in row {
        pred = pred.wrapping_add(*value);
        *value = pred;
    }
}

fn vertical_unfilter(prev: &[u8], row: &mut [u8]) {
    for (value, &top) in row.iter_mut().zip(prev) {
        *value = value.wrapping_add(top);
    }
}

fn gradient_unfilter(prev: &[u8], row: &mut [u8]) {
    let Some(&first) = prev.first() else { return };
    let (mut top_left, mut left) = (first, first);
    for (value, &top) in row.iter_mut().zip(prev) {
        left = value.wrapping_add(gradient_predictor(left, top, top_left));
        top_left = top;
        *value = left;
    }
}

/// `WebPUnfilters[filter]` on each row of `plane`, from the top down.
pub(super) fn unfilter(filter: Filter, plane: &mut [u8], width: usize) -> Checked {
    if filter == Filter::None {
        return Ok(());
    }
    let (mut prev, below) = plane.split_at_mid(width)?;
    horizontal_unfilter(0, prev);
    for row in below.chunks_exact_mut(width) {
        match filter {
            Filter::Vertical => vertical_unfilter(prev, row),
            Filter::Gradient => gradient_unfilter(prev, row),
            _ => horizontal_unfilter(prev.at(0)?, row),
        }
        prev = row;
    }
    Ok(())
}
