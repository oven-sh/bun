use core::ffi::{c_uint, c_void};

use bun_boringssl_sys as boring;
// CYCLEBREAK MOVE_DOWN: evp::Algorithm now lives in this crate (sha.rs `pub mod evp`).
use crate::evp::Algorithm;

#[cfg(any())]
// TODO(b2-blocked): bun_boringssl_sys::EVP_MAX_MD_SIZE
// TODO(b2-blocked): bun_boringssl_sys::HMAC
pub fn generate<'a>(
    key: &[u8],
    data: &[u8],
    algorithm: Algorithm,
    out: &'a mut [u8; boring::EVP_MAX_MD_SIZE as usize],
) -> Option<&'a [u8]> {
    let mut outlen: c_uint = boring::EVP_MAX_MD_SIZE as c_uint;
    let Some(md) = algorithm.md() else {
        bun_core::output::panic(format_args!("Expected BoringSSL algorithm for HMAC"));
    };
    // SAFETY: key/data are valid slices; out has EVP_MAX_MD_SIZE bytes; outlen is initialized.
    if unsafe {
        boring::HMAC(
            md,
            key.as_ptr().cast::<c_void>(),
            key.len(),
            data.as_ptr(),
            data.len(),
            out.as_mut_ptr(),
            &mut outlen,
        )
    }
    .is_null()
    {
        return None;
    }

    Some(&out[..outlen as usize])
}

// TODO(b2-blocked): bun_boringssl_sys::EVP_MAX_MD_SIZE — stub mirrors B-1 surface
// (`out: &mut [u8]`) so dependents compile until the bindgen output lands.
#[cfg(not(any()))]
pub fn generate<'a>(
    _key: &[u8],
    _data: &[u8],
    _algorithm: Algorithm,
    _out: &'a mut [u8],
) -> Option<&'a [u8]> {
    todo!("gated: bun_boringssl_sys::HMAC / EVP_MAX_MD_SIZE missing")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sha_hmac/hmac.zig (19 lines)
//   confidence: medium
//   todos:      1
//   notes:      EVP.Algorithm crate path guessed (bun.jsc.API.Bun.Crypto deep path); bun.Output.panic mapped to bun_core::output::panic
// ──────────────────────────────────────────────────────────────────────────
