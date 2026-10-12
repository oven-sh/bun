#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod boringssl;
pub use boringssl::*;

/// Fill `buf` with cryptographically-secure random bytes via BoringSSL `RAND_bytes`.
///
/// BoringSSL's `RAND_bytes` is a thread-local AES-CTR DRBG seeded once from the
/// OS entropy source and then run entirely in userspace, so this does not incur
/// a syscall per call. This is the CSPRNG for all of Bun.
#[inline]
pub fn rand_bytes(buf: &mut [u8]) {
    if buf.is_empty() {
        return;
    }
    // SAFETY: `buf` is a valid writable slice of `buf.len()` bytes. BoringSSL's
    // `RAND_bytes` always returns 1 (it `abort()`s on failure).
    unsafe {
        boringssl::RAND_bytes(buf.as_mut_ptr(), buf.len());
    }
}

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
