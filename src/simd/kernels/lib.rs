//! Bun's kernels on `bun_simd`. They give what those on Highway give.
#![forbid(unsafe_code)]

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
pub use png::simd::{filter_rgba as png_filter_rgba, unfilter4 as png_unfilter4};
pub use sourcemap::simd::parse_mappings;
pub use sourcemap::{Columns, MappingsState};
pub use strings::simd::{
    bswap32, bswap32_shared, copy_u16_to_u8, count_char, count_char_shared, fill_shared_with_mask,
    fill_with_mask, index_of_char_within, lower_ascii16, scanner_run_stops,
};
pub use words::simd::{pack_words, unpack_words};

use core::sync::atomic::AtomicU8;

macro_rules! searches {
    ($($name:ident = $kernel:ident(text: &[$Unit:ty] $(, $arg:ident: $ty:ty)?);)*) => {$(
        #[inline(always)]
        pub fn $name(text: &[$Unit] $(, $arg: $ty)?) -> Option<usize> {
            let at = strings::simd::$kernel(text $(, $arg)?);
            (at != text.len()).then_some(at)
        }
    )*};
}

searches! {
    index_of_char = index_of_char(text: &[u8], needle: u8);
    index_of_char_shared = index_of_char_shared(text: &[AtomicU8], needle: u8);
    last_index_of_char = last_index_of_char(text: &[u8], needle: u8);
    last_index_of_char_shared = last_index_of_char_shared(text: &[AtomicU8], needle: u8);
    index_of_either = index_of_either(text: &[u8], chars: [u8; 2]);
    index_of_any_char = index_of_any_char(text: &[u8], chars: &[u8]);
    index_of_interesting_character_in_string_literal = string_literal(text: &[u8], quote: u8);
    index_of_newline_or_non_ascii = newline_or_non_ascii(text: &[u8]);
    index_of_html_escape_char8 = index_of_html_escape_char8(text: &[u8]);
    index_of_html_escape_char16 = index_of_html_escape_char16(text: &[u16]);
    first_non_ascii16 = first_non_ascii16(text: &[u16]);
    last_index_of_slash = last_index_of_slash(text: &[u8]);
}

#[inline(always)]
pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    match *needle {
        [byte] => index_of_char(haystack, byte),
        _ => memmem::simd::memmem(haystack, needle),
    }
}

pub fn line_starts(text: &[u8]) -> Vec<u32> {
    assert!(u32::try_from(text.len()).is_ok());
    let mut starts = Vec::with_capacity(1 + count_char(text, b'\n'));
    starts.push(0);
    strings::simd::line_starts(text, &mut starts);
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
