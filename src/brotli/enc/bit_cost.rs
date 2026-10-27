//! Estimates of how many bits it takes to encode the symbols of a histogram.

use super::fast_log::fast_log2;
use super::histogram::Histogram;
use crate::common::constants::{CODE_LENGTH_CODES, REPEAT_ZERO_CODE_LENGTH};
use crate::util::{Checked, SliceExt};

/// The entropy of `population`, but at least one bit for each symbol.
pub(crate) fn bits_entropy(population: &[u32]) -> f64 {
    let mut sum = 0usize;
    let mut retval = 0f64;
    for &p in population {
        let p = p as usize;
        sum += p;
        retval -= p as f64 * fast_log2(p);
    }
    if sum != 0 {
        retval += sum as f64 * fast_log2(sum);
    }
    retval.max(sum as f64)
}

const ONE_SYMBOL_HISTOGRAM_COST: f64 = 12.0;

/// [`population_cost`] where only `count` symbols occur, which is at most 4. `histo` starts with how often each does.
fn simple_population_cost(histo: [u32; 5], count: usize, total_count: usize) -> Option<f64> {
    const TWO_SYMBOL_HISTOGRAM_COST: f64 = 20.0;
    const THREE_SYMBOL_HISTOGRAM_COST: f64 = 28.0;
    const FOUR_SYMBOL_HISTOGRAM_COST: f64 = 37.0;
    match count {
        1 => Some(ONE_SYMBOL_HISTOGRAM_COST),
        2 => Some(TWO_SYMBOL_HISTOGRAM_COST + total_count as f64),
        3 => {
            let [histo0, histo1, histo2, ..] = histo;
            let histomax = histo0.max(histo1).max(histo2);
            let twice = 2u32.wrapping_mul(histo0.wrapping_add(histo1).wrapping_add(histo2));
            Some(THREE_SYMBOL_HISTOGRAM_COST + f64::from(twice) - f64::from(histomax))
        }
        4 => {
            let [mut histo @ .., _] = histo;
            histo.sort_unstable_by(|a, b| b.cmp(a));
            let h23 = histo[2].wrapping_add(histo[3]);
            let histomax = h23.max(histo[0]);
            Some(
                FOUR_SYMBOL_HISTOGRAM_COST
                    + f64::from(3u32.wrapping_mul(h23))
                    + f64::from(2u32.wrapping_mul(histo[0].wrapping_add(histo[1])))
                    - f64::from(histomax),
            )
        }
        _ => None,
    }
}

/// The cost of the symbols and of the prefix code for them.
pub(crate) fn population_cost<const N: usize>(histogram: &Histogram<N>) -> Checked<f64> {
    if histogram.total_count == 0 {
        return Ok(ONE_SYMBOL_HISTOGRAM_COST);
    }
    // The counts of the first five symbols that occur.
    let mut histo = [0u32; 5];
    let mut count = 0;
    for (slot, &n) in histo
        .iter_mut()
        .zip(histogram.data.iter().filter(|&&n| n > 0))
    {
        *slot = n;
        count += 1;
    }
    if let Some(cost) = simple_population_cost(histo, count, histogram.total_count) {
        return Ok(cost);
    }

    // The entropy of the histogram and, along with it, a simplified histogram of the code length codes: with the code
    // for repeated zeros (17), without the one for other repeated lengths (16).
    let mut bits = 0f64;
    let mut max_depth = 1usize;
    let mut depth_histo = [0u32; CODE_LENGTH_CODES];
    let log2total = fast_log2(histogram.total_count);
    let mut i = 0;
    while i < N {
        let n = histogram.data.at(i)?;
        if n > 0 {
            // -log2(P(symbol)), and its rounded value as the code length.
            let log2p = log2total - fast_log2(n as usize);
            let depth = ((log2p + 0.5) as usize).min(15);
            bits += f64::from(n) * log2p;
            max_depth = max_depth.max(depth);
            *depth_histo.at_mut(depth)? += 1;
            i += 1;
        } else {
            let mut reps = histogram
                .data
                .sub(i..)?
                .iter()
                .take_while(|&&n| n == 0)
                .count() as u32;
            i += reps as usize;
            if i == N {
                // The zeros at the end are not written.
                break;
            }
            if reps < 3 {
                depth_histo[0] += reps;
            } else {
                reps -= 2;
                while reps > 0 {
                    depth_histo[REPEAT_ZERO_CODE_LENGTH] += 1;
                    // The extra bits of code 17.
                    bits += 3.0;
                    reps >>= 3;
                }
            }
        }
    }
    bits += (18 + 2 * max_depth) as f64;
    bits += bits_entropy(&depth_histo);
    Ok(bits)
}
