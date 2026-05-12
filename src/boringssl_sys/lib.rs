#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod boringssl;
pub use boringssl::*;

/// Constant-time byte-slice equality via BoringSSL `CRYPTO_memcmp`.
///
/// Returns `false` when lengths differ (the length comparison itself is NOT
/// constant-time — matches all existing call sites, which already early-out on len).
#[inline]
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    // SAFETY: both pointers are valid for `a.len()` bytes; lengths verified equal above.
    unsafe { boringssl::CRYPTO_memcmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0 }
}
