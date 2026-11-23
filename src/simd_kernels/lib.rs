//! Vector kernels for text, which many crates and C++ call. Those of a codec are in its crate.
#![cfg_attr(any(target_os = "linux", target_os = "android"), feature(linkage))]
#![deny(unsafe_code)]

// Bytes, paths and scanners.
mod blocks;
mod byte_set;
mod paths;
mod scanner;
mod search;
mod text;
mod untidy;
mod words;
pub use byte_set::ByteSet;
pub use paths::*;
pub use scanner::*;
pub use text::*;
pub use untidy::{index_of_untidy_slash, index_of_untidy_slash_or_non_ascii};
pub use words::{pack_words, unpack_words};

// Substrings, hex, widths, and what C++ calls.
mod ascii;
mod ffi;
mod ffi_testing;
mod hex;
mod html;
mod near;
mod shared;
mod substring;
mod swap;
mod width;
pub use ascii::{copy_ascii_prefix, copy_u16_to_u8};
pub use hex::{decode_hex, decode_hex_u16, encode_hex_lower};
pub use shared::SharedBytes;
pub use substring::{memmem, memmem16, memrmem, memrmem16};
pub use swap::{fill_with_skip_mask, fill_with_skip_mask_inplace};

// Indices of JSON and XML, and source maps.
pub mod json;
pub mod sourcemap;
pub mod xml;

pub mod level;
pub mod zstd;
