//! The kernels. A macroblock fills no more than 32 bytes.
#![expect(
    clippy::indexing_slicing,
    reason = "the positions are constants, or within lengths that no image has a say in"
)]

mod common;
mod decoder;
mod encoder;
mod filter;
mod lossless;
#[cfg(test)]
#[path = "../tests/unit/simd.rs"]
mod tests;

pub(crate) use {decoder::*, encoder::*, filter::*, lossless::*};
