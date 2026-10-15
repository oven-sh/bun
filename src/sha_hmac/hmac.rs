use core::ffi::{c_int, c_uint, c_void};
use core::mem::MaybeUninit;
use core::ptr;

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

/// HMAC over a message that arrives in pieces. [`generate`] is the one-shot form.
pub struct HMAC {
    ctx: ffi::HMAC_CTX,
}

impl HMAC {
    pub fn init(key: &[u8], algorithm: Algorithm) -> Option<HMAC> {
        let md = algorithm.md()?;
        let mut ctx = MaybeUninit::<ffi::HMAC_CTX>::uninit();
        // SAFETY: HMAC_CTX_init writes the whole struct.
        unsafe { ffi::HMAC_CTX_init(ctx.as_mut_ptr()) };
        // SAFETY: initialised by HMAC_CTX_init above.
        let mut this = HMAC {
            ctx: unsafe { ctx.assume_init() },
        };
        // SAFETY: `this.ctx` is initialised; `key` is a readable slice; `md` is a static digest.
        let rc: c_int = unsafe {
            ffi::HMAC_Init_ex(
                &raw mut this.ctx,
                key.as_ptr().cast::<c_void>(),
                key.len(),
                md,
                ptr::null_mut(),
            )
        };
        (rc == 1).then_some(this)
    }

    pub fn update(&mut self, data: &[u8]) {
        // SAFETY: `self.ctx` is initialised; `data` is a readable slice.
        let rc: c_int = unsafe { ffi::HMAC_Update(&raw mut self.ctx, data.as_ptr(), data.len()) };
        debug_assert!(rc == 1);
    }

    pub fn r#final(mut self, out: &mut [u8; EVP_MAX_MD_SIZE]) -> Option<&[u8]> {
        let mut outlen: c_uint = 0;
        // SAFETY: `self.ctx` is initialised; `out` holds EVP_MAX_MD_SIZE bytes, the largest digest.
        let rc: c_int =
            unsafe { ffi::HMAC_Final(&raw mut self.ctx, out.as_mut_ptr(), &raw mut outlen) };
        if rc != 1 {
            return None;
        }
        Some(&out[..outlen as usize])
    }
}

impl Drop for HMAC {
    fn drop(&mut self) {
        // SAFETY: `self.ctx` was initialised by HMAC_CTX_init in `init`.
        unsafe { ffi::HMAC_CTX_cleanup(&raw mut self.ctx) };
    }
}
