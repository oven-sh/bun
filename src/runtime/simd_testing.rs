//! Kernels of `bun_simd_kernels` for `bun:internal-for-testing`, without the shortcuts of their callers.

use crate::generated_bindgen::simd_testing::{SimdSearch, SimdSharedSearch};
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal};
use bun_simd::SharedU8;
use bun_simd_kernels as kernels;

fn index_or_minus_one(index: Option<usize>) -> f64 {
    index.map_or(-1.0, |index| index as f64)
}

pub(crate) fn search(kernel: SimdSearch, haystack: &[u8], needle: &[u8]) -> f64 {
    let byte = needle.first().copied().unwrap_or(0);
    let units = |bytes: &[u8]| -> Vec<u16> {
        let pairs = bytes.as_chunks().0.iter();
        pairs.map(|&pair| u16::from_le_bytes(pair)).collect()
    };
    index_or_minus_one(match kernel {
        SimdSearch::IndexOfChar => kernels::index_of_char(haystack, byte),
        SimdSearch::LastIndexOfChar => kernels::last_index_of_char(haystack, byte),
        SimdSearch::IndexOfNotChar => kernels::index_of_not_char(haystack, byte),
        SimdSearch::CountChar => Some(kernels::count_char(haystack, byte)),
        SimdSearch::IndexOfAny => kernels::index_of_any_char(haystack, needle),
        SimdSearch::LastIndexOfAny => kernels::last_index_of_any_char(haystack, needle),
        SimdSearch::IndexOfUntidySlash => kernels::index_of_untidy_slash(haystack),
        SimdSearch::IndexOfUntidySlashOrNonAscii => {
            kernels::index_of_untidy_slash_or_non_ascii(haystack)
        }
        SimdSearch::LastIndexOfSlash => kernels::last_index_of_slash(haystack),
        SimdSearch::LastIndexOfSlashOrDot => kernels::last_index_of_slash_or_dot(haystack),
        SimdSearch::CommonPrefixLength => Some(kernels::common_prefix_len(haystack, needle)),
        SimdSearch::CountSlashes => Some(kernels::count_slashes(haystack)),
        SimdSearch::Memmem => kernels::memmem(haystack, needle),
        SimdSearch::Memrmem => kernels::memrmem(haystack, needle),
        SimdSearch::Memrmem16 => kernels::memrmem16(&units(haystack), &units(needle)),
        SimdSearch::ByteSetPrefixLength => match needle.as_chunks() {
            (&[rows, columns], []) => Some(kernels::ByteSet { rows, columns }.prefix_len(haystack)),
            _ => None,
        },
    })
}

pub(crate) fn search_shared(
    kernel: SimdSharedSearch,
    haystack: &[SharedU8],
    needle: &[SharedU8],
) -> f64 {
    let byte = needle.first().map_or(0, SharedU8::get);
    let (pairs, needle_pairs) = (haystack.as_chunks().0, needle.as_chunks().0);
    index_or_minus_one(match kernel {
        SimdSharedSearch::IndexOfChar => kernels::index_of_char_shared(haystack, byte),
        SimdSharedSearch::LastIndexOfChar => kernels::last_index_of_char_shared(haystack, byte),
        SimdSharedSearch::Memmem => kernels::memmem_shared(haystack, needle),
        SimdSharedSearch::Memrmem => kernels::memrmem_shared(haystack, needle),
        SimdSharedSearch::Memmem16 => kernels::memmem16_shared(pairs, needle_pairs),
        SimdSharedSearch::Memrmem16 => kernels::memrmem16_shared(pairs, needle_pairs),
    })
}

/// The three bitmaps, one after the other.
pub(crate) fn scanner_run_stops<'a>(
    heap: &JsHeap<'a>,
    text: &[u8],
) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
    let mut planes = [(); 3].map(|()| vec![[0; 8]; text.len().div_ceil(64)]);
    kernels::scanner_run_stops(text, planes.each_mut().map(Vec::as_mut_slice));
    heap.create_uint8_array(planes.concat().as_flattened())
}

pub(crate) use kernels::line_starts;

pub(crate) fn byte_bits(text: &[u8], byte: u8) -> impl Iterator<Item = u8> {
    let mut words = Vec::new();
    kernels::byte_bits(text, byte, &mut words);
    words.into_iter().flat_map(u64::to_le_bytes)
}

pub(crate) fn odd_blocks(text: &[u8]) -> impl Iterator<Item = u8> {
    let mut words = Vec::new();
    // Room for a word too many.
    bun_simd::extend_vec(&mut words, text.len().div_ceil(4096) + 1, |out| {
        kernels::odd_blocks(text, out)
    });
    words.into_iter().flat_map(u64::to_le_bytes)
}

/// Unlike `Bun.hash.xxHash3`, with all the bits of a BigInt.
pub(crate) fn xx_hash3<'a>(
    heap: &JsHeap<'a>,
    bytes: &[SharedU8],
    seed: JsLocal<'a>,
) -> bindgen::Result<'a, u64> {
    let seed = seed.to_js();
    let seed = if seed.is_number() {
        u64::from(seed.to_uint64_no_truncate() as u32)
    } else if seed.is_big_int() {
        seed.to_uint64_no_truncate()
    } else if seed.is_undefined() {
        0
    } else {
        return Err(heap.type_error(format_args!("seed must be a number or bigint")));
    };
    Ok(kernels::xxhash3_64_shared(seed, bytes))
}
