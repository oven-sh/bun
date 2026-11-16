//! Bun's kernels on `bun_simd`, checked against those on Highway.
#![feature(loop_hints, trait_alias)]
#![forbid(unsafe_code)]
// For `#[inline(always)]` in the copies.
#![recursion_limit = "512"]
// The copies for the targets look alike.
#![cfg_attr(mordant, allow(reimplemented_helper))]

mod byte_set;
mod convert;
mod hex;
mod image;
mod json;
mod memmem;
mod paths;
mod png;
mod scanner;
mod search;
mod sourcemap;
mod width;
mod words;
mod xml;
mod xxhash;

use bun_simd::SharedU8;

pub use byte_set::ByteSet;
pub use convert::simd::{
    bswap16_shared, bswap32_shared, bswap64_shared, copy_ascii_prefix_to_shared,
    copy_few_ascii_to_shared, copy_short_ascii_prefix_to_shared, copy_u16_to_shared,
    copy_u16_to_u8, fill_with_mask, fill_with_mask_from_shared, lower_ascii, lower_ascii16,
    mask_in_place,
};
pub use hex::simd::{
    decode_hex, decode_hex_to_shared, decode_hex16, decode_hex16_to_shared, encode_hex_lower,
    encode_hex_lower_shared,
};
pub use image::simd::{cmyk_to_rgba, flip_horizontally, modulate, nearest_in_palette};
pub use image::{Filter, flip_vertically, resize, rotate_90, rotate_180, rotate_270};
pub use json::class as json_class;
pub use json::simd::index_chunk as json_structural_index_chunk;
pub use memmem::simd::{memmem16_shared, memrmem16, memrmem16_shared};
pub use paths::simd::{
    common_prefix_length, count_slashes, index_of_untidy_slash, index_of_untidy_slash_or_non_ascii,
    last_index_of_slash, last_index_of_slash_or_dot,
};
pub use png::simd::filter_rgba as png_filter_rgba;
pub use png::unfilter as png_unfilter;
pub use scanner::simd::{odd_blocks, scanner_run_stops};
pub use search::simd::{
    contains_newline_or_non_ascii_or_quote, count_char, first_non_ascii8, first_non_ascii16,
    html_escape_extra_len8, html_escape_extra_len16, index_of_char, index_of_char_shared,
    index_of_char16, index_of_escape_char8, index_of_escape_char16, index_of_first_ascii_upper,
    index_of_first_ascii_upper16, index_of_html_escape_char8, index_of_html_escape_char16,
    index_of_interesting_character_in_multiline_comment,
    index_of_interesting_character_in_string_literal, index_of_newline_or_non_ascii,
    index_of_newline_or_non_ascii_or_hash_or_at, index_of_not_char,
    index_of_space_or_newline_or_non_ascii, last_index_of_char, last_index_of_char_shared,
    last_index_of_char16,
};
pub use sourcemap::simd::{count_mapping_delims, parse_mappings};
pub use sourcemap::{Columns, ColumnsFilled, ColumnsOut, MappingsState};
pub use width::simd::{
    count_printable_ascii16, visible_latin1_width, visible_latin1_width_exclude_ansi,
    visible_utf16_width,
};
pub use words::simd::{pack_words, unpack_words};
pub use xml::class as xml_class;
pub use xml::simd::{
    index_chunk as xml_structural_index_chunk, index_chunk16 as xml_structural_index16_chunk,
};
pub use xxhash::XxHash64State;
pub use xxhash::simd::{xxhash3_64_shared, xxhash32, xxhash32_shared, xxhash64, xxhash64_shared};

#[inline(always)]
pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    match *needle {
        [byte] => index_of_char(haystack, byte),
        _ => memmem::simd::memmem(haystack, needle),
    }
}

#[inline(always)]
pub fn memmem_shared(haystack: &[SharedU8], needle: &[SharedU8]) -> Option<usize> {
    match needle {
        [byte] => index_of_char_shared(haystack, byte.get()),
        _ => memmem::simd::memmem_shared(haystack, needle),
    }
}

#[inline(always)]
pub fn memrmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    match *needle {
        [byte] => last_index_of_char(haystack, byte),
        _ => memmem::simd::memrmem(haystack, needle),
    }
}

#[inline(always)]
pub fn memrmem_shared(haystack: &[SharedU8], needle: &[SharedU8]) -> Option<usize> {
    match needle {
        [byte] => last_index_of_char_shared(haystack, byte.get()),
        _ => memmem::simd::memrmem_shared(haystack, needle),
    }
}

/// The tables are constants if `chars` is.
#[inline(always)]
pub fn index_of_any_char(text: &[u8], chars: &[u8]) -> Option<usize> {
    match *chars {
        [a, b] => search::simd::index_of_either(text, a, b),
        [a, b, c] => search::simd::index_of_one_of_three(text, a, b, c),
        _ => match search::tables_of_set(chars) {
            (ascii, 0) => search::simd::index_in_ascii_set(text, ascii),
            (ascii, others) => search::simd::index_in_set(text, ascii, others),
        },
    }
}

#[inline(always)]
pub fn last_index_of_any_char(text: &[u8], chars: &[u8]) -> Option<usize> {
    if let [a, b] = *chars {
        return search::simd::last_index_of_either(text, a, b);
    }
    let (ascii, others) = search::tables_of_set(chars);
    search::simd::last_index_in_set(text, ascii, others)
}

#[inline(always)]
pub fn index_of_needs_escape_for_javascript_string(text: &[u8], quote: u8) -> Option<usize> {
    match quote {
        b'`' => search::simd::index_of_interesting_character_in_template(text),
        _ => index_of_interesting_character_in_string_literal(text, quote),
    }
}

pub fn line_starts(text: &[u8]) -> Vec<u32> {
    assert!(u32::try_from(text.len()).is_ok());
    let room = count_char(text, b'\n') + 64;
    let mut starts = Vec::with_capacity(1 + room);
    starts.push(0);
    bun_simd::extend_vec(&mut starts, room, |out| {
        scanner::simd::line_starts(text, out)
    });
    starts
}
