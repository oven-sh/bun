//! `hist.c`: how many times each byte value occurs.

use crate::error::{ErrorCode, Result};
use crate::util::{BUG, SliceExt};

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
        max_symbol = max_symbol.checked_sub(1).ok_or(BUG)?;
    }
    *max_symbol_value = max_symbol as u32;
    Ok(count.sub(..=max_symbol)?.iter().copied().max().unwrap_or(0))
}

#[inline(always)]
fn increment(counting: &mut [u32; 256], byte: u8) {
    if let Some(count) = counting.get_mut(usize::from(byte)) {
        *count = count.wrapping_add(1);
    }
}

/// `HIST_count_parallel_wksp`: four tables, so that a run of one value does not wait for its own counter.
/// `max_symbol_value` is at most 255. With `check`, a value above it is an error rather than trusted not to occur.
fn count_parallel(
    count: &mut [u32],
    max_symbol_value: &mut u32,
    src: &[u8],
    check: bool,
) -> Result<usize> {
    let count_size = *max_symbol_value as usize + 1;
    if src.is_empty() {
        count.sub_mut(..count_size)?.fill(0);
        *max_symbol_value = 0;
        return Ok(0);
    }

    let mut counting1 = [0u32; 256];
    let mut counting2 = [0u32; 256];
    let mut counting3 = [0u32; 256];
    let mut counting4 = [0u32; 256];

    // Each word is read before the bytes of the one before it are counted.
    let (words, rest) = src.as_chunks::<8>();
    if let Some((&first, words)) = words.split_first() {
        let mut cached = u64::from_le_bytes(first);
        let mut count_word = |next: [u8; 8]| {
            let c = cached;
            cached = u64::from_le_bytes(next);
            increment(&mut counting1, c as u8);
            increment(&mut counting2, (c >> 8) as u8);
            increment(&mut counting3, (c >> 16) as u8);
            increment(&mut counting4, (c >> 24) as u8);
            increment(&mut counting1, (c >> 32) as u8);
            increment(&mut counting2, (c >> 40) as u8);
            increment(&mut counting3, (c >> 48) as u8);
            increment(&mut counting4, (c >> 56) as u8);
        };
        let (stripes, words) = words.as_chunks::<2>();
        for &[a, b] in stripes {
            count_word(a);
            count_word(b);
        }
        for &word in words {
            count_word(word);
        }
        count_word([0; 8]);
    }
    for &byte in rest {
        increment(&mut counting1, byte);
    }

    let mut max = 0u32;
    let others = counting2.iter().zip(&counting3).zip(&counting4);
    for (sum, ((&c2, &c3), &c4)) in counting1.iter_mut().zip(others) {
        *sum = sum.wrapping_add(c2).wrapping_add(c3).wrapping_add(c4);
        max = max.max(*sum);
    }

    let max_symbol = counting1.iter().rposition(|&c| c != 0).ok_or(BUG)? as u32;
    if check && max_symbol > *max_symbol_value {
        return Err(ErrorCode::MaxSymbolValueTooSmall);
    }
    *max_symbol_value = max_symbol;
    count.write_at(0, counting1.sub(..count_size)?)?;
    Ok(max as usize)
}

/// `HIST_countFast_wksp`: as [`count_simple`], faster on large inputs.
pub(crate) fn count_fast_wksp(
    count: &mut [u32],
    max_symbol_value: &mut u32,
    src: &[u8],
) -> Result<usize> {
    if src.len() < 1500 {
        return Ok(count_simple(count, max_symbol_value, src)? as usize);
    }
    count_parallel(count, max_symbol_value, src, false)
}

/// `HIST_count_wksp`: as [`count_fast_wksp`], but a value above `max_symbol_value` in `src` is
/// [`ErrorCode::MaxSymbolValueTooSmall`].
pub(crate) fn count_wksp(
    count: &mut [u32],
    max_symbol_value: &mut u32,
    src: &[u8],
) -> Result<usize> {
    if *max_symbol_value < 255 {
        return count_parallel(count, max_symbol_value, src, true);
    }
    *max_symbol_value = 255;
    count_fast_wksp(count, max_symbol_value, src)
}
