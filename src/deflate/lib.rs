//! One-shot DEFLATE, gzip and zlib, derived from libdeflate 1.26 (LICENSE.md).
#![forbid(unsafe_code)]
// Streams come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]
#![feature(
    hint_prefetch,
    iter_advance_by,
    stmt_expr_attributes,
    vec_push_within_capacity
)]

/// `core::array::from_fn` for constants.
macro_rules! table {
    (|$index:ident| $value:expr) => {{
        let mut $index = 0;
        let mut table = [$value; _];
        while $index < table.len() {
            #[expect(clippy::indexing_slicing, reason = "runs in the compiler")]
            {
                table[$index] = $value;
            }
            $index += 1;
        }
        table
    }};
}

mod binary_trees;
mod bit_reader;
mod bit_writer;
mod block;
mod block_splitter;
mod compressor;
mod decode_tables;
mod decompressor;
mod error;
pub mod format;
pub mod gzip;
mod hash_chains;
mod hash_lists;
mod hash_table;
mod huffman;
mod match_cache;
mod near_optimal;
mod output;
mod parser;
mod window;
mod zlib;

pub use compressor::{Compressor, Format, Level, compress_bound, compress_to_vec};
pub use decompressor::{Decompressed, gunzip, inflate, inflate_message};
pub use error::{Error, Result};
pub use output::Output;

/// The `N` items from `at` on.
#[inline(always)]
fn chunk_at<T, const N: usize>(items: &[T], at: usize) -> Option<&[T; N]> {
    // Written out, so that it takes one comparison, with a loop invariant.
    if at > items.len().checked_sub(N)? {
        return None;
    }
    items.get(at..).and_then(<[T]>::first_chunk)
}

#[inline(always)]
fn chunk_at_mut<T, const N: usize>(items: &mut [T], at: usize) -> Option<&mut [T; N]> {
    if at > items.len().checked_sub(N)? {
        return None;
    }
    items.get_mut(at..).and_then(<[T]>::first_chunk_mut)
}

/// Copies as many items as both have. Returns how many.
#[inline(always)]
fn copy_prefix<T: Copy>(to: &mut [T], from: &[T]) -> usize {
    let len = to.len().min(from.len());
    to.split_at_mut(len).0.copy_from_slice(from.split_at(len).0);
    len
}

/// Makes `storage` at least `len` long, with zeros after what an earlier input left in it.
fn grow<T: Copy + Default>(storage: &mut Vec<T>, len: usize) -> Result<&mut [T]> {
    if let Some(more) = len.checked_sub(storage.len()) {
        storage.try_reserve_exact(more)?;
        storage.resize(len, T::default());
    }
    Ok(storage)
}

fn grow_to_array<T: Copy + Default, const N: usize>(storage: &mut Vec<T>) -> Result<&mut [T; N]> {
    let array = grow(storage, N)?.first_chunk_mut();
    array.ok_or(Error::Alloc(bun_alloc::AllocError))
}

/// `table[index % N]`, which the compiler knows to be in bounds.
#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
const fn wrapped<T, const N: usize>(table: &[T; N], index: usize) -> &T {
    const { assert!(N.is_power_of_two()) };
    &table[index % N]
}

#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
fn wrapped_mut<T, const N: usize>(table: &mut [T; N], index: usize) -> &mut T {
    const { assert!(N.is_power_of_two()) };
    &mut table[index % N]
}

#[cfg(test)]
mod tests {
    #[test]
    fn chunk_of_too_few_items() {
        assert_eq!(super::chunk_at_mut::<_, 2>(&mut [0], 0), None);
    }
}
