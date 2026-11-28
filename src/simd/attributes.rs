//! What the attributes of `bun_simd_macros` need of this crate. Nothing here or there is trusted.

#[doc = include_str!("docs/simd.md")]
pub use bun_simd_macros::simd;
/// See [simd](macro@simd).
pub use bun_simd_macros::{except, only, shared};
