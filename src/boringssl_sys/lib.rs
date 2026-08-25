#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod boringssl;
mod digest;
pub use boringssl::*;
pub use digest::*;

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

fn static_cstr(ptr: *const core::ffi::c_char) -> Option<&'static core::ffi::CStr> {
    // SAFETY: BoringSSL's `ERR_*_error_string` return NUL-terminated entries
    // from its static string tables (or null).
    (!ptr.is_null()).then(|| unsafe { core::ffi::CStr::from_ptr(ptr) })
}

/// `ERR_lib_error_string` — the library name for `packed_error`, if known.
pub fn err_lib_error_string(packed_error: u32) -> Option<&'static core::ffi::CStr> {
    static_cstr(boringssl::ERR_lib_error_string(packed_error))
}

/// `ERR_func_error_string` — the function name for `packed_error`, if known.
pub fn err_func_error_string(packed_error: u32) -> Option<&'static core::ffi::CStr> {
    static_cstr(boringssl::ERR_func_error_string(packed_error))
}

/// `ERR_reason_error_string` — the reason string for `packed_error`, if known.
pub fn err_reason_error_string(packed_error: u32) -> Option<&'static core::ffi::CStr> {
    static_cstr(boringssl::ERR_reason_error_string(packed_error))
}
