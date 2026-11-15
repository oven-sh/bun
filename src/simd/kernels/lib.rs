//! Bun's kernels on `bun_simd`, checked against those on Highway.
#![forbid(unsafe_code)]
// For `#[inline(always)]` in the copies.
#![recursion_limit = "512"]
// The copies for the targets look alike.
#![cfg_attr(mordant, allow(reimplemented_helper))]

mod hex;
mod image;
mod json;
mod memmem;
mod png;
mod sourcemap;
mod strings;
mod words;
mod xxh3;

pub use hex::simd::{decode_hex, encode_hex_lower, encode_hex_lower_shared};
pub use image::Resizer;
pub use image::simd::{cmyk_to_rgba, modulate};
pub use json::simd::index_chunk as json_structural_index_chunk;
pub use png::simd::{filter_rgba as png_filter_rgba, unfilter as png_unfilter};
pub use sourcemap::simd::parse_mappings;
pub use sourcemap::{Columns, ColumnsFilled, ColumnsOut, MappingsState};
pub use strings::simd::{
    bswap32, bswap32_shared, copy_u16_to_u8, count_char, count_char_shared, fill_shared_with_mask,
    fill_with_mask, first_non_ascii16, index_of_any_char, index_of_char, index_of_char_shared,
    index_of_char_within, index_of_either, index_of_html_escape_char8, index_of_html_escape_char16,
    index_of_interesting_character_in_string_literal, index_of_newline_or_non_ascii,
    last_index_of_char, last_index_of_char_shared, last_index_of_slash, lower_ascii16,
    scanner_run_stops,
};
pub use words::simd::{pack_words, unpack_words};

#[inline(always)]
pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    match *needle {
        [byte] => index_of_char(haystack, byte),
        _ => memmem::simd::memmem(haystack, needle),
    }
}

pub fn line_starts(text: &[u8]) -> Vec<u32> {
    assert!(u32::try_from(text.len()).is_ok());
    let room = count_char(text, b'\n') + 64;
    let mut starts = Vec::with_capacity(1 + room);
    starts.push(0);
    bun_simd::extend_vec(&mut starts, room, |out| {
        strings::simd::line_starts(text, out)
    });
    starts
}

/// `None` for up to 240 bytes.
#[inline(always)]
pub fn xxhash3_64_long(input: &[u8]) -> Option<u64> {
    if input.len() <= 240 {
        return None;
    }
    xxh3::simd::hash_long(input, &xxh3::SECRET)
}
