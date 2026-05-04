use core::ffi::{c_uint, c_void};

use bun_boringssl_sys as boring;
// TODO(port): verify crate path for EVP.Algorithm — Zig path is bun.jsc.API.Bun.Crypto.EVP.Algorithm
use bun_jsc::api::bun::crypto::evp::Algorithm;

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sha_hmac/hmac.zig (19 lines)
//   confidence: medium
//   todos:      1
//   notes:      EVP.Algorithm crate path guessed (bun.jsc.API.Bun.Crypto deep path); bun.Output.panic mapped to bun_core::output::panic
// ──────────────────────────────────────────────────────────────────────────
