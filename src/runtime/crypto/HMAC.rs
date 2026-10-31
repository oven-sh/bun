use core::ffi::c_uint;
use core::mem::MaybeUninit;
use core::ptr;

use bun_boringssl_sys as boringssl;

use super::evp;

pub(crate) struct HMAC {
    ctx: boringssl::HMAC_CTX,
    pub(crate) algorithm: evp::Algorithm,
}

impl HMAC {
    pub(crate) fn init(algorithm: evp::Algorithm, key: &[u8]) -> Option<Box<HMAC>> {
        let md = algorithm.md()?;
        let mut ctx = MaybeUninit::<boringssl::HMAC_CTX>::uninit();
        boringssl::HMAC_CTX_init(&mut ctx);
        // SAFETY: ctx was initialized by HMAC_CTX_init above.
        let mut ctx = unsafe { ctx.assume_init() };
        // SAFETY: ctx is initialized; key.ptr/len are a valid readable region; md is non-null.
        if unsafe {
            boringssl::HMAC_Init_ex(
                &raw mut ctx,
                key.as_ptr().cast(),
                key.len(),
                md,
                ptr::null_mut(),
            )
        } != 1
        {
            // SAFETY: ctx was initialized by HMAC_CTX_init.
            unsafe { boringssl::HMAC_CTX_cleanup(&raw mut ctx) };
            return None;
        }
        Some(Box::new(HMAC { ctx, algorithm }))
    }

    pub(crate) fn update(&mut self, data: &[u8]) {
        // SAFETY: self.ctx is initialized; data is a valid readable slice.
        let _ = unsafe { boringssl::HMAC_Update(&raw mut self.ctx, data.as_ptr(), data.len()) };
    }

    pub(crate) fn size(&self) -> usize {
        // SAFETY: self.ctx is initialized.
        unsafe { boringssl::HMAC_size(&raw const self.ctx) }
    }

    pub(crate) fn copy(&self) -> crate::Result<Box<HMAC>> {
        let mut ctx = MaybeUninit::<boringssl::HMAC_CTX>::uninit();
        boringssl::HMAC_CTX_init(&mut ctx);
        // SAFETY: ctx was initialized by HMAC_CTX_init above.
        let mut ctx = unsafe { ctx.assume_init() };
        // SAFETY: both ctx and self.ctx are initialized HMAC_CTX values.
        if unsafe { boringssl::HMAC_CTX_copy(&raw mut ctx, &raw const self.ctx) } != 1 {
            // SAFETY: ctx was initialized by HMAC_CTX_init.
            unsafe { boringssl::HMAC_CTX_cleanup(&raw mut ctx) };
            return Err(crate::Error::BoringSSLError);
        }
        Ok(Box::new(HMAC {
            ctx,
            algorithm: self.algorithm,
        }))
    }

    pub(crate) fn r#final<'a>(&mut self, out: &'a mut [u8]) -> &'a mut [u8] {
        let mut outlen: c_uint = 0;
        // SAFETY: self.ctx is initialized; out is a valid writable buffer of at least
        // HMAC_size(&self.ctx) bytes (caller invariant).
        let _ =
            unsafe { boringssl::HMAC_Final(&raw mut self.ctx, out.as_mut_ptr(), &raw mut outlen) };
        &mut out[..outlen as usize]
    }
}

impl Drop for HMAC {
    fn drop(&mut self) {
        // SAFETY: self.ctx was initialized by HMAC_CTX_init in `init`/`copy`.
        unsafe { boringssl::HMAC_CTX_cleanup(&raw mut self.ctx) };
        // bun.destroy(this) is handled by Box<HMAC>'s own Drop.
    }
}
