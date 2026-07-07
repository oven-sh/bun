#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod hmac;
pub mod sha;

// Convenience re-export so dependents can write `crate::evp::Algorithm`.
pub use sha::evp;

// Crate-root re-exports
// so dependents can write `bun_sha_hmac::SHA256` / `bun_sha_hmac::generate`.
pub use hmac::generate;
pub use sha::{Algorithm, MD4, MD5, MD5_SHA1, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256};

/// PKCS5_PBKDF2_HMAC over a BoringSSL digest. Zeroes `out`, runs the
/// derivation for `out.len()` bytes; returns false on BoringSSL failure.
/// `md` is an `EVP_MD` singleton, only passed through to BoringSSL.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn pbkdf2_hmac(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    md: *const bun_boringssl_sys::EVP_MD,
    out: &mut [u8],
) -> bool {
    use core::ffi::c_uint;
    out.fill(0);
    bun_boringssl_sys::ERR_clear_error();
    // SAFETY: password/salt/out are valid for their lengths; md is a static
    // EVP_MD singleton.
    let rc = unsafe {
        bun_boringssl_sys::PKCS5_PBKDF2_HMAC(
            if password.is_empty() {
                core::ptr::null()
            } else {
                password.as_ptr()
            },
            password.len(),
            salt.as_ptr(),
            salt.len(),
            iterations as c_uint,
            md,
            out.len(),
            out.as_mut_ptr(),
        )
    };
    rc > 0
}

/// SHA-256 convenience used by SCRAM (postgres SASL).
pub fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32, out: &mut [u8]) -> bool {
    pbkdf2_hmac(
        password,
        salt,
        iterations,
        bun_boringssl_sys::EVP_sha256(),
        out,
    )
}
