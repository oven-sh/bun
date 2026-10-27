//! `filters.c`: undoes the spatial prediction of an alpha plane.

use super::Filter;
use crate::util::{Checked, SliceExt};

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
        let pred = (i32::from(left) + i32::from(top) - i32::from(top_left)).clamp(0, 255) as u8;
        left = value.wrapping_add(pred);
        top_left = top;
        *value = left;
    }
}

/// `WebPUnfilters[filter]` on each row of `plane`, from the top down.
pub(super) fn unfilter(filter: Filter, plane: &mut [u8], width: usize) -> Checked {
    if filter == Filter::None {
        return Ok(());
    }
    let (mut prev, below) = plane.halves_mut(width)?;
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
