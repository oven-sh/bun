//! Filling the rows of tables, many at a time. That goes up to `N` rows beyond those that are asked for.

use core::hint::black_box;

use crate::error::{Error, Result};

/// In bytes.
pub(super) const FILL: usize = 16;

/// Sets `count` rows from `start` on, `N` at a time.
#[inline(always)]
pub(super) fn fill_rows<T: Copy, const N: usize>(
    rows: &mut [T],
    start: usize,
    count: usize,
    value: T,
) -> Result<()> {
    let rows = (rows.get_mut(start..)).and_then(|rows| rows.get_mut(..count + N - 1));
    let chunk = [value; N];
    for to in rows.ok_or(Error::Internal)?.as_chunks_mut().0 {
        *to = chunk;
        // Most are short: neither unrolling nor a call of `memset()` pays.
        black_box(());
    }
    Ok(())
}

/// Sets `repeats` rows for each of `symbols` to what `map` makes of it, from `start` on.
#[inline(always)]
pub(super) fn repeat_each<T: Copy, const N: usize>(
    rows: &mut [T],
    start: usize,
    symbols: &[u8],
    repeats: usize,
    map: impl Fn(u8) -> T,
) -> Result<()> {
    let mut rows = rows.get_mut(start..).ok_or(Error::Internal)?;
    if repeats <= N {
        for &symbol in symbols {
            *rows.first_chunk_mut().ok_or(Error::Internal)? = [map(symbol); N];
            rows = rows.get_mut(repeats..).ok_or(Error::Internal)?;
        }
    } else {
        for &symbol in symbols {
            fill_rows::<_, N>(rows, 0, repeats, map(symbol))?;
            rows = rows.get_mut(repeats..).ok_or(Error::Internal)?;
        }
    }
    Ok(())
}

/// Puts behind the `period` rows from `start` on what `map` makes of them for each of `symbols`.
#[inline(always)]
pub(super) fn repeat_rows_for<T: Copy, const N: usize>(
    rows: &mut [T],
    start: usize,
    period: usize,
    symbols: &[u8],
    map: impl Fn(T, u8) -> T,
) -> Result<()> {
    let mapped = |mut chunk: [T; N], symbol| {
        chunk.iter_mut().for_each(|it| *it = map(*it, symbol));
        chunk
    };
    debug_assert!(period.is_power_of_two());
    let mut rows = rows.get_mut(start..).ok_or(Error::Internal)?;
    if period <= N {
        let pattern = *rows.first_chunk().ok_or(Error::Internal)?;
        for &symbol in symbols {
            rows = rows.get_mut(period..).ok_or(Error::Internal)?;
            *rows.first_chunk_mut().ok_or(Error::Internal)? = mapped(pattern, symbol);
        }
    } else {
        let pattern = rows.split_off_mut(..period).ok_or(Error::Internal)?;
        for &symbol in symbols {
            let copy = rows.split_off_mut(..period).ok_or(Error::Internal)?;
            for (to, from) in copy.as_chunks_mut().0.iter_mut().zip(pattern.as_chunks().0) {
                *to = mapped(*from, symbol);
                black_box(());
            }
        }
    }
    Ok(())
}
