//! The format of the data package of `bun_icu`, which `bun_icu_pack` writes (src/icu/README.md).
#![no_std]
#![forbid(unsafe_code)]
// A panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

pub mod bundles;
pub mod code;
pub mod collation;
pub mod dictionary;
pub mod key;
pub mod locales;
pub mod model;
pub mod package;
pub mod record;
pub mod runs;
pub mod schema;
pub mod squeezed;
pub mod text;
mod words;
pub mod zone;

pub use words::Words;
