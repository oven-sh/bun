//! Counting symbols.

use bun_highway::zstd::{are_quicker_for, count_bytes};
use bun_zstd_decoder::array::At;
use bun_zstd_decoder::bounded::Bounded;

/// How often each of `N` symbols occurs.
#[derive(Clone, Copy)]
pub(crate) struct Histogram<const N: usize> {
    pub(crate) counts: [u32; N],
    /// The last symbol that occurs.
    pub(crate) max_symbol: usize,
    pub(crate) largest_count: usize,
}

impl Histogram<256> {
    #[inline]
    pub(crate) fn of(symbols: &[u8]) -> Self {
        Self::new(match symbols.len() {
            ..1500 => {
                let mut counts = [0; _];
                add(&mut counts, symbols);
                counts
            }
            len if are_quicker_for(len) => count_in_vectors(symbols),
            1500..16_384 => count_interleaved::<1>(symbols),
            _ => count_interleaved::<2>(symbols),
        })
    }
}

impl<const N: usize> Histogram<N> {
    #[inline]
    pub(crate) fn new(counts: [u32; N]) -> Self {
        let (mut max_symbol, mut largest_count) = (0u32, 0);
        // Without branches, it compiles to vector instructions.
        for (symbol, &count) in (0..N as u32).zip(&counts) {
            max_symbol = max_symbol.max(if count != 0 { symbol } else { 0 });
            largest_count = largest_count.max(count);
        }
        Self {
            counts,
            max_symbol: max_symbol as usize,
            largest_count: largest_count as usize,
        }
    }

    /// Up to the last symbol that occurs.
    pub(crate) fn used(&self) -> &[u32] {
        self.counts.get(..=self.max_symbol).unwrap_or_default()
    }
}

#[inline(always)]
pub(crate) fn raise(count: &mut u32, by: u32) {
    *count = count.plus(by);
}

#[inline(always)]
pub(crate) fn add(counts: &mut [u32; 256], symbols: &[u8]) {
    for &symbol in symbols {
        raise(counts.at_mut(usize::from(symbol)), 1);
    }
}

#[inline(never)]
fn count_in_vectors(symbols: &[u8]) -> [u32; 256] {
    count_bytes(symbols).unwrap_or_else(|| count_interleaved::<2>(symbols))
}

/// With several tables, a symbol that repeats does not wait for its last count to be stored.
#[inline(never)]
fn count_interleaved<const SETS: usize>(symbols: &[u8]) -> [u32; 256] {
    // Padded, as processors mistake addresses that are 4 KB apart for the same.
    let mut sets = [[[0u32; 256 + 16]; 4]; SETS];
    let (stripes, rest) = symbols.as_chunks::<16>();
    let mut loaded = 0;
    for stripe in stripes {
        for (index, word) in stripe.as_chunks().0.iter().enumerate() {
            let word = core::mem::replace(&mut loaded, u32::from_le_bytes(*word));
            // Keeps the load ahead of the stores.
            core::hint::black_box(());
            for (byte, table) in sets.at_mut(index % SETS).iter_mut().enumerate() {
                raise(table.at_mut(usize::from((word >> (8 * byte)) as u8)), 1);
            }
        }
    }
    let mut counts = [0; _];
    add(&mut counts, &loaded.to_le_bytes());
    add(&mut counts, rest);
    for table in sets.as_flattened() {
        for (count, more) in counts.iter_mut().zip(table) {
            raise(count, *more);
        }
    }
    // What `loaded` started with.
    *counts.at_mut(0) -= 4;
    counts
}

#[test]
fn what_the_kernel_refuses_is_counted_without_it() {
    for bytes in [&b"refused"[..], b"accepted"] {
        let mut expected = [0; _];
        add(&mut expected, bytes);
        assert_eq!(count_bytes(bytes).is_some(), bytes == b"accepted");
        assert_eq!(count_in_vectors(bytes), expected);
    }
}

#[test]
fn symbols_are_used_up_to_the_last_one_that_occurs() {
    for (counts, used, largest) in [([0; 4], 1, 0), ([5, 0, 0, 0], 1, 5), ([1, 0, 0, 2], 4, 2)] {
        let histogram = Histogram::new(counts);
        assert_eq!(
            (histogram.used().len(), histogram.largest_count),
            (used, largest)
        );
    }
}
