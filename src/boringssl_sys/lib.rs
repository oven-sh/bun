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

/// `PKCS5_PBKDF2_HMAC` with SHA-256 into `out` (the derived key length is
/// `out.len()`). Returns whether BoringSSL succeeded.
pub fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32, out: &mut [u8]) -> bool {
    // SAFETY: each pointer is readable/writable for the length passed with it
    // (an empty password is passed as null/0); `EVP_sha256` is a static digest.
    unsafe {
        boringssl::PKCS5_PBKDF2_HMAC(
            if password.is_empty() {
                core::ptr::null()
            } else {
                password.as_ptr()
            },
            password.len(),
            salt.as_ptr(),
            salt.len(),
            iterations,
            boringssl::EVP_sha256(),
            out.len(),
            out.as_mut_ptr(),
        ) > 0
    }
}

/// `ERR_error_string_n`: the human-readable string for `packed_error`, written
/// into `buf` and returned up to (not including) its NUL terminator.
pub fn err_error_string_n(packed_error: u32, buf: &mut [u8]) -> &[u8] {
    if buf.is_empty() {
        return buf;
    }
    // SAFETY: `buf` is writable for `buf.len()` bytes; BoringSSL NUL-terminates
    // within that length.
    unsafe {
        boringssl::ERR_error_string_n(packed_error, buf.as_mut_ptr().cast(), buf.len());
    }
    let end = bun_core::strings::index_of_char_usize(buf, 0).unwrap_or(buf.len());
    &buf[..end]
}
