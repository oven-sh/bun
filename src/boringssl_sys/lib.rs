#![feature(core_io_borrowed_buf)]
#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod boringssl;
pub use boringssl::*;

use bun_core::vec::{BorrowedBuf, BorrowedCursor};

/// Fill `buf` with cryptographically-secure random bytes via BoringSSL `RAND_bytes`.
///
/// BoringSSL's `RAND_bytes` is a thread-local AES-CTR DRBG seeded once from the
/// OS entropy source and then run entirely in userspace, so this does not incur
/// a syscall per call. This is the CSPRNG for all of Bun.
#[inline]
pub fn rand_bytes(buf: &mut [u8]) {
    rand_bytes_buf(BorrowedBuf::from(buf).unfilled());
}

/// [`rand_bytes`] for memory that can be uninitialized.
#[inline]
pub fn rand_bytes_buf(mut buf: BorrowedCursor<'_, u8>) {
    let len = buf.capacity();
    if len == 0 {
        return;
    }
    // SAFETY: `buf` is writable for `len` bytes. BoringSSL's `RAND_bytes`
    // writes all of them (it `abort()`s on failure).
    unsafe {
        boringssl::RAND_bytes(buf.as_mut().as_mut_ptr().cast(), len);
        buf.advance(len);
    }
}

/// Formats `packed_error` into `buf` via `ERR_error_string_n`, cut short to fit.
pub fn error_string(packed_error: u32, buf: &mut [u8]) -> &[u8] {
    // SAFETY: BoringSSL writes at most `buf.len()` bytes.
    unsafe { boringssl::ERR_error_string_n(packed_error, buf.as_mut_ptr().cast(), buf.len()) };
    bun_core::slice_to_nul(buf)
}

/// Fills `out` via `PKCS5_PBKDF2_HMAC`.
pub fn pbkdf2_hmac(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    digest: &EVP_MD,
    out: &mut [u8],
) -> bool {
    // SAFETY: each pointer is valid for the length next to it.
    unsafe {
        boringssl::PKCS5_PBKDF2_HMAC(
            password.as_ptr(),
            password.len(),
            salt.as_ptr(),
            salt.len(),
            iterations,
            digest,
            out.len(),
            out.as_mut_ptr(),
        ) > 0
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
