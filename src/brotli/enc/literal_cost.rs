//! An estimate of what each literal costs, for weighing it against a backward reference.

use super::fast_log::fast_log2;
use super::utf8_util::is_mostly_utf8;
use crate::util::{Checked, SliceExt};

const MIN_UTF8_RATIO: f64 = 0.75;

/// Which byte of a UTF-8 character follows `c`, which itself follows `last`: 0 for the first one, up to `clamp`.
fn utf8_position(last: usize, c: usize, clamp: usize) -> usize {
    if c < 128 {
        0
    } else if c >= 192 {
        1.min(clamp)
    } else if last < 0xE0 {
        // The end of a character of two or three bytes.
        0
    } else {
        2.min(clamp)
    }
}

/// How many histograms, less one, to use for the bytes of UTF-8 characters.
fn decide_multi_byte_stats_level(
    pos: usize,
    len: usize,
    mask: usize,
    data: &[u8],
) -> Checked<usize> {
    let mut counts = [0usize; 3];
    let mut last_c = 0usize;
    for i in 0..len {
        let c = usize::from(data.at((pos + i) & mask)?);
        *counts.at_mut(utf8_position(last_c, c, 2))? += 1;
        last_c = c;
    }
    // 2 would be the natural choice where there are many third bytes, but 1 compresses better.
    Ok(if counts[1] + counts[2] < 25 { 0 } else { 1 })
}

fn estimate_bit_costs_for_literals_utf8(
    pos: usize,
    len: usize,
    mask: usize,
    data: &[u8],
    histogram: &mut [usize],
    cost: &mut [f32],
) -> Checked {
    const WINDOW_HALF: usize = 495;
    const PROLOGUE_LENGTH: usize = 2000;
    const MULTIPLIER: f64 = 0.35 / 2000.0;
    let max_utf8 = decide_multi_byte_stats_level(pos, len, mask, data)?;
    let byte = |ix: usize| data.at(ix & mask).map(usize::from);
    // One histogram for each position in a character.
    let histogram = histogram.sub_mut(..3 * 256)?;
    histogram.fill(0);
    let mut in_window_utf8 = [0usize; 3];

    let mut last_c = 0usize;
    let mut utf8_pos = 0usize;
    for i in 0..WINDOW_HALF.min(len) {
        let c = byte(pos + i)?;
        *histogram.at_mut(256 * utf8_pos + c)? += 1;
        *in_window_utf8.at_mut(utf8_pos)? += 1;
        utf8_pos = utf8_position(last_c, c, max_utf8);
        last_c = c;
    }

    for (i, cost) in cost.sub_mut(..len)?.iter_mut().enumerate() {
        if i >= WINDOW_HALF {
            // A byte leaves the window.
            let c = if i < WINDOW_HALF + 1 {
                0
            } else {
                byte(pos + i - WINDOW_HALF - 1)?
            };
            let last_c = if i < WINDOW_HALF + 2 {
                0
            } else {
                byte(pos + i - WINDOW_HALF - 2)?
            };
            let utf8_pos = utf8_position(last_c, c, max_utf8);
            *histogram.at_mut(256 * utf8_pos + byte(pos + i - WINDOW_HALF)?)? -= 1;
            *in_window_utf8.at_mut(utf8_pos)? -= 1;
        }
        if i + WINDOW_HALF < len {
            // A byte enters the window.
            let c = byte(pos + i + WINDOW_HALF - 1)?;
            let last_c = byte(pos + i + WINDOW_HALF - 2)?;
            let utf8_pos = utf8_position(last_c, c, max_utf8);
            *histogram.at_mut(256 * utf8_pos + byte(pos + i + WINDOW_HALF)?)? += 1;
            *in_window_utf8.at_mut(utf8_pos)? += 1;
        }
        let c = if i < 1 { 0 } else { byte(pos + i - 1)? };
        let last_c = if i < 2 { 0 } else { byte(pos + i - 2)? };
        let utf8_pos = utf8_position(last_c, c, max_utf8);
        let histo = histogram.at(256 * utf8_pos + byte(pos + i)?)?.max(1);
        let mut lit_cost = fast_log2(in_window_utf8.at(utf8_pos)?) - fast_log2(histo);
        lit_cost += 0.02905;
        if lit_cost < 1.0 {
            lit_cost *= 0.5;
            lit_cost += 0.5;
        }
        // It helps to make the first bytes more expensive. Perhaps because the statistics change quickly there.
        if i < PROLOGUE_LENGTH {
            lit_cost += 0.35 + MULTIPLIER * i as f64;
        }
        *cost = lit_cost as f32;
    }
    Ok(())
}

/// Sets `cost[i]` to the estimated number of bits of the literal at `pos + i`, for `i < len`, from how frequent the
/// byte is among those around it. `histogram` is scratch space of `3 * 256` elements.
pub(crate) fn estimate_bit_costs_for_literals(
    pos: usize,
    len: usize,
    mask: usize,
    data: &[u8],
    histogram: &mut [usize],
    cost: &mut [f32],
) -> Checked {
    const WINDOW_HALF: usize = 2000;
    if is_mostly_utf8(data, pos, mask, len, MIN_UTF8_RATIO)? {
        return estimate_bit_costs_for_literals_utf8(pos, len, mask, data, histogram, cost);
    }
    let byte = |ix: usize| data.at(ix & mask).map(usize::from);
    let histogram = histogram.sub_mut(..256)?;
    histogram.fill(0);
    let mut in_window = WINDOW_HALF.min(len);
    for i in 0..in_window {
        *histogram.at_mut(byte(pos + i)?)? += 1;
    }

    for (i, cost) in cost.sub_mut(..len)?.iter_mut().enumerate() {
        if i >= WINDOW_HALF {
            // A byte leaves the window.
            *histogram.at_mut(byte(pos + i - WINDOW_HALF)?)? -= 1;
            in_window -= 1;
        }
        if i + WINDOW_HALF < len {
            // A byte enters the window.
            *histogram.at_mut(byte(pos + i + WINDOW_HALF)?)? += 1;
            in_window += 1;
        }
        let histo = histogram.at(byte(pos + i)?)?.max(1);
        let mut lit_cost = fast_log2(in_window) - fast_log2(histo);
        lit_cost += 0.029;
        if lit_cost < 1.0 {
            lit_cost *= 0.5;
            lit_cost += 0.5;
        }
        *cost = lit_cost as f32;
    }
    Ok(())
}
