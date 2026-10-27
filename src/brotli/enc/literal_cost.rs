//! An estimate of what each literal costs, for weighing it against a backward reference.

use super::fast_log::fast_log2;
use super::utf8_util::is_mostly_utf8;
use crate::util::{Checked, SliceExt};

/// Whether the second or the third byte of a UTF-8 character follows `c`, which itself follows `last`. A fourth byte
/// counts as a first one.
fn is_inside_character(last: usize, c: usize) -> bool {
    c >= 192 || (c >= 128 && last >= 0xE0)
}

/// Whether there are enough bytes inside of UTF-8 characters to give them a histogram of their own. One more for the
/// third bytes would be natural, but compresses worse.
fn has_multi_byte_characters(pos: usize, len: usize, mask: usize, data: &[u8]) -> Checked<bool> {
    let mut count = 0usize;
    let mut last_c = 0usize;
    for i in 0..len {
        let c = usize::from(data.at((pos + i) & mask)?);
        count += usize::from(is_inside_character(last_c, c));
        last_c = c;
    }
    Ok(count >= 25)
}

fn estimate_bit_costs_for_literals_utf8(
    pos: usize,
    len: usize,
    mask: usize,
    data: &[u8],
    cost: &mut [f32],
) -> Checked {
    const WINDOW_HALF: usize = 495;
    const PROLOGUE_LENGTH: usize = 2000;
    const MULTIPLIER: f64 = 0.35 / 2000.0;
    let multi_byte = has_multi_byte_characters(pos, len, mask, data)?;
    // Which histogram counts the byte after `c`, which itself follows `last`.
    let utf8_position =
        |last: usize, c: usize| usize::from(multi_byte && is_inside_character(last, c));
    let byte = |ix: usize| data.at(ix & mask).map(usize::from);
    let mut histogram = [0usize; 2 * 256];
    let mut in_window_utf8 = [0usize; 2];

    let mut last_c = 0usize;
    let mut utf8_pos = 0usize;
    for i in 0..WINDOW_HALF.min(len) {
        let c = byte(pos + i)?;
        *histogram.at_mut(256 * utf8_pos + c)? += 1;
        *in_window_utf8.at_mut(utf8_pos)? += 1;
        utf8_pos = utf8_position(last_c, c);
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
            let utf8_pos = utf8_position(last_c, c);
            *histogram.at_mut(256 * utf8_pos + byte(pos + i - WINDOW_HALF)?)? -= 1;
            *in_window_utf8.at_mut(utf8_pos)? -= 1;
        }
        if i + WINDOW_HALF < len {
            // A byte enters the window.
            let c = byte(pos + i + WINDOW_HALF - 1)?;
            let last_c = byte(pos + i + WINDOW_HALF - 2)?;
            let utf8_pos = utf8_position(last_c, c);
            *histogram.at_mut(256 * utf8_pos + byte(pos + i + WINDOW_HALF)?)? += 1;
            *in_window_utf8.at_mut(utf8_pos)? += 1;
        }
        let c = if i < 1 { 0 } else { byte(pos + i - 1)? };
        let last_c = if i < 2 { 0 } else { byte(pos + i - 2)? };
        let utf8_pos = utf8_position(last_c, c);
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
/// byte is among those around it.
pub(crate) fn estimate_bit_costs_for_literals(
    pos: usize,
    len: usize,
    mask: usize,
    data: &[u8],
    cost: &mut [f32],
) -> Checked {
    const WINDOW_HALF: usize = 2000;
    if is_mostly_utf8(data, pos, mask, len)? {
        return estimate_bit_costs_for_literals_utf8(pos, len, mask, data, cost);
    }
    let byte = |ix: usize| data.at(ix & mask).map(usize::from);
    let mut histogram = [0usize; 256];
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
