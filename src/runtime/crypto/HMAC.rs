use core::ffi::c_uint;
use core::mem::MaybeUninit;
use core::ptr;

use bun_boringssl_sys as boringssl;
use bun_core::{self, err};

use super::evp;

pub struct HMAC {
    ctx: boringssl::HMAC_CTX,
    pub algorithm: evp::Algorithm,
}

impl HMAC {
    pub fn init(algorithm: evp::Algorithm, key: &[u8]) -> Option<Box<HMAC>> {
        let md = algorithm.md()?;
        let mut ctx = MaybeUninit::<boringssl::HMAC_CTX>::uninit();
        // SAFETY: HMAC_CTX_init writes the entire struct; ctx is valid uninit memory.
        unsafe { boringssl::HMAC_CTX_init(ctx.as_mut_ptr()) };
        // SAFETY: ctx was initialized by HMAC_CTX_init above.
        let mut ctx = unsafe { ctx.assume_init() };
        // SAFETY: ctx is initialized; key.ptr/len are a valid readable region; md is non-null.
        if unsafe {
            boringssl::HMAC_Init_ex(&mut ctx, key.as_ptr().cast(), key.len(), md, ptr::null_mut())
        } != 1
        {
            // SAFETY: ctx was initialized by HMAC_CTX_init.
            unsafe { boringssl::HMAC_CTX_cleanup(&mut ctx) };
            return None;
        }
        Some(Box::new(HMAC { ctx, algorithm }))
    }

    pub fn update(&mut self, data: &[u8]) {
        // SAFETY: self.ctx is initialized; data is a valid readable slice.
        let _ = unsafe { boringssl::HMAC_Update(&mut self.ctx, data.as_ptr(), data.len()) };
    }

    pub fn size(&self) -> usize {
        // SAFETY: self.ctx is initialized.
        unsafe { boringssl::HMAC_size(&self.ctx) }
    }

    pub fn copy(&mut self) -> Result<Box<HMAC>, bun_core::Error> {
        // TODO(port): narrow error set
        let mut ctx = MaybeUninit::<boringssl::HMAC_CTX>::uninit();
        // SAFETY: HMAC_CTX_init writes the entire struct; ctx is valid uninit memory.
        unsafe { boringssl::HMAC_CTX_init(ctx.as_mut_ptr()) };
        // SAFETY: ctx was initialized by HMAC_CTX_init above.
        let mut ctx = unsafe { ctx.assume_init() };
        // SAFETY: both ctx and self.ctx are initialized HMAC_CTX values.
        if unsafe { boringssl::HMAC_CTX_copy(&mut ctx, &self.ctx) } != 1 {
            // SAFETY: ctx was initialized by HMAC_CTX_init.
            unsafe { boringssl::HMAC_CTX_cleanup(&mut ctx) };
            return Err(err!("BoringSSLError"));
        }
        Ok(Box::new(HMAC {
            ctx,
            algorithm: self.algorithm,
        }))
    }

    pub fn r#final<'a>(&mut self, out: &'a mut [u8]) -> &'a mut [u8] {
        let mut outlen: c_uint = 0;
        // SAFETY: self.ctx is initialized; out is a valid writable buffer of at least
        // HMAC_size(&self.ctx) bytes (caller invariant, same as Zig).
        let _ = unsafe { boringssl::HMAC_Final(&mut self.ctx, out.as_mut_ptr(), &mut outlen) };
        &mut out[..outlen as usize]
    }
}

impl Drop for HMAC {
    fn drop(&mut self) {
        // SAFETY: self.ctx was initialized by HMAC_CTX_init in `init`/`copy`.
        unsafe { boringssl::HMAC_CTX_cleanup(&mut self.ctx) };
        // bun.destroy(this) is handled by Box<HMAC>'s own Drop.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/HMAC.zig (57 lines)
//   confidence: high
//   todos:      1
//   notes:      HMAC_CTX moved by value into Box (matches Zig); verify not self-referential in Phase B. evp::Algorithm path may need adjustment.
// ──────────────────────────────────────────────────────────────────────────
