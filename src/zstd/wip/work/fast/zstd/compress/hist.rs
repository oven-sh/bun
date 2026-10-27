//! `hist.c`: how many times each byte value occurs.

use crate::error::Result;
use crate::util::SliceExt;

/// `HIST_add`: `count` has room for every value in `src`.
pub(crate) fn add(count: &mut [u32], src: &[u8]) -> Result<()> {
    for &byte in src {
        *count.at_mut(usize::from(byte))? += 1;
    }
    Ok(())
}

/// `HIST_count_simple`: `count` has room for the values up to `max_symbol_value`, and `src` has none above it.
/// Lowers `max_symbol_value` to the largest value present, and returns the largest count.
pub(crate) fn count_simple(
    count: &mut [u32],
    max_symbol_value: &mut u32,
    src: &[u8],
) -> Result<u32> {
    let mut max_symbol = *max_symbol_value as usize;
    count.sub_mut(..=max_symbol)?.fill(0);
    if src.is_empty() {
        *max_symbol_value = 0;
        return Ok(0);
    }
    add(count, src)?;
    while count.at(max_symbol)? == 0 {
        max_symbol -= 1;
    }
    *max_symbol_value = max_symbol as u32;
    Ok(count.sub(..=max_symbol)?.iter().copied().max().unwrap_or(0))
}
