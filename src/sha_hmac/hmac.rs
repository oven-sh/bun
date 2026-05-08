use core::ffi::{c_uint, c_void};

use crate::evp::Algorithm;
use crate::sha::ffi;

/// `#define EVP_MAX_MD_SIZE 64` — re-exported so callers can size their output
/// buffer without reaching into the private `ffi` module.
pub const EVP_MAX_MD_SIZE: usize = ffi::EVP_MAX_MD_SIZE;

pub fn generate<'a>(
    key: &[u8],
    data: &[u8],
    algorithm: Algorithm,
    out: &'a mut [u8; EVP_MAX_MD_SIZE],
) -> Option<&'a [u8]> {
    let mut outlen: c_uint = EVP_MAX_MD_SIZE as c_uint;
    let Some(md) = algorithm.md() else {
        bun_core::output::panic(format_args!("Expected BoringSSL algorithm for HMAC"));
    };
    // SAFETY: key/data are valid slices; out has EVP_MAX_MD_SIZE bytes; outlen is initialized.
    if unsafe {
        ffi::HMAC(
            md,
            key.as_ptr().cast::<c_void>(),
            key.len(),
            data.as_ptr(),
            data.len(),
            out.as_mut_ptr(),
            &raw mut outlen,
        )
    }
    .is_null()
    {
        return None;
    }

    Some(&out[..outlen as usize])
}

// ported from: src/sha_hmac/hmac.zig
