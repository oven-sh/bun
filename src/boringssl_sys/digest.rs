//! Owned `EVP_MD_CTX` / `HMAC_CTX` and slice-typed one-shot digests, so
//! callers never touch the raw contexts or pointer/length pairs.

use core::ffi::{CStr, c_uint, c_void};
use core::mem::MaybeUninit;

use crate::boringssl::{
    ENGINE, EVP_Digest, EVP_DigestFinal_ex, EVP_DigestInit_ex, EVP_DigestUpdate, EVP_MD,
    EVP_MD_CTX, EVP_MD_CTX_cleanup, EVP_MD_CTX_copy_ex, EVP_MD_CTX_init, EVP_MD_CTX_size,
    EVP_MD_size, EVP_get_digestbyname, HMAC_CTX, HMAC_CTX_cleanup, HMAC_CTX_copy, HMAC_CTX_init,
    HMAC_Final, HMAC_Init_ex, HMAC_Update, HMAC_size, PKCS5_PBKDF2_HMAC,
};

/// `EVP_get_digestbyname`; the table entries are static.
pub fn digest_by_name(name: &CStr) -> Option<&'static EVP_MD> {
    // SAFETY: `name` is NUL-terminated; a non-null result is a static `EVP_MD`.
    let md = unsafe { EVP_get_digestbyname(name.as_ptr()) };
    (!md.is_null()).then(|| EVP_MD::opaque_ref(md))
}

/// `EVP_MD_size`.
pub fn md_size(md: &EVP_MD) -> usize {
    // SAFETY: `md` is a live digest.
    unsafe { EVP_MD_size(md) }
}

/// One-shot `EVP_Digest` of `input` into `out`, which must hold at least
/// `md_size(md)` bytes (else `None`). Returns the digest length.
pub fn digest(
    md: &EVP_MD,
    input: &[u8],
    out: &mut [u8],
    engine: Option<&ENGINE>,
) -> Option<c_uint> {
    if out.len() < md_size(md) {
        return None;
    }
    let mut out_len: c_uint = 0;
    // SAFETY: `input` is readable for its length; `out` holds the
    // `EVP_MD_size(md)` bytes written (checked above); BoringSSL ignores `engine`.
    let rc = unsafe {
        EVP_Digest(
            input.as_ptr().cast::<c_void>(),
            input.len(),
            out.as_mut_ptr(),
            &raw mut out_len,
            md,
            engine_ptr(engine),
        )
    };
    (rc == 1).then_some(out_len)
}

fn engine_ptr(engine: Option<&ENGINE>) -> *mut ENGINE {
    engine.map_or(core::ptr::null_mut(), ENGINE::as_mut_ptr)
}

/// An `EVP_MD_CTX` with a digest installed, cleaned up on drop.
#[repr(transparent)]
pub struct DigestCtx(EVP_MD_CTX);

impl DigestCtx {
    /// `EVP_MD_CTX_init` + `EVP_DigestInit_ex(md)`.
    pub fn new(md: &'static EVP_MD, engine: Option<&ENGINE>) -> Self {
        let mut ctx: EVP_MD_CTX = bun_core::ffi::zeroed();
        EVP_MD_CTX_init(&mut ctx);
        let mut this = DigestCtx(ctx);
        let _ = this.init(md, engine);
        this
    }

    /// `EVP_DigestInit_ex` — restart with `md` (BoringSSL always returns 1).
    pub fn init(&mut self, md: &'static EVP_MD, engine: Option<&ENGINE>) -> bool {
        // SAFETY: `self.0` is initialised; `md` is a static digest; `engine` is unused.
        unsafe { EVP_DigestInit_ex(&raw mut self.0, md, engine_ptr(engine)) == 1 }
    }

    /// The installed digest.
    pub fn md(&self) -> &'static EVP_MD {
        EVP_MD::opaque_ref(self.0.digest)
    }

    /// `EVP_DigestUpdate`.
    pub fn update(&mut self, data: &[u8]) -> bool {
        // SAFETY: a digest is installed (type invariant); `data` is readable for its length.
        unsafe {
            EVP_DigestUpdate(&raw mut self.0, data.as_ptr().cast::<c_void>(), data.len()) == 1
        }
    }

    /// `EVP_DigestFinal_ex` into `out`, which must hold at least [`size`](Self::size)
    /// bytes (else `None`). Returns the digest length. The context must be
    /// re-[`init`](Self::init)ed before further updates produce a fresh digest.
    pub fn final_(&mut self, out: &mut [u8]) -> Option<c_uint> {
        if out.len() < self.size() {
            return None;
        }
        let mut out_len: c_uint = 0;
        // SAFETY: a digest is installed; `out` holds the `size()` bytes written (checked above).
        let rc = unsafe { EVP_DigestFinal_ex(&raw mut self.0, out.as_mut_ptr(), &raw mut out_len) };
        (rc == 1).then_some(out_len)
    }

    /// `EVP_MD_CTX_size` — the installed digest's output length.
    pub fn size(&self) -> usize {
        // SAFETY: a digest is installed (type invariant).
        unsafe { EVP_MD_CTX_size(&raw const self.0) }
    }

    /// `EVP_MD_CTX_copy_ex(self, other)` — make `self` a copy of `other`'s
    /// state. `false` on allocation failure.
    pub fn copy_from(&mut self, other: &DigestCtx) -> bool {
        // SAFETY: both contexts are initialised.
        unsafe { EVP_MD_CTX_copy_ex(&raw mut self.0, &raw const other.0) != 0 }
    }
}

impl Drop for DigestCtx {
    fn drop(&mut self) {
        // SAFETY: `self.0` was initialised in `new`; cleanup returns it to the zero state.
        unsafe { EVP_MD_CTX_cleanup(&raw mut self.0) };
    }
}

/// An initialised `HMAC_CTX` keyed in [`new`](Self::new), cleaned up on drop.
#[repr(transparent)]
pub struct HmacCtx(HMAC_CTX);

impl HmacCtx {
    fn blank() -> Self {
        let mut ctx = MaybeUninit::<HMAC_CTX>::uninit();
        // SAFETY: `ctx` is writable; `HMAC_CTX_init` only stores into it.
        unsafe { HMAC_CTX_init(ctx.as_mut_ptr()) };
        // SAFETY: `HMAC_CTX_init` set `md` and each inner context's pointer
        // fields; the remaining `md_data` unions have no validity invariant.
        HmacCtx(unsafe { ctx.assume_init() })
    }

    /// `HMAC_CTX_init` + `HMAC_Init_ex(key, md)`; `None` if BoringSSL rejects it.
    pub fn new(key: &[u8], md: &'static EVP_MD) -> Option<Self> {
        let mut this = Self::blank();
        // SAFETY: `this.0` is initialised; `key` is readable for its length; `md` is static.
        let rc = unsafe {
            HMAC_Init_ex(
                &raw mut this.0,
                key.as_ptr().cast::<c_void>(),
                key.len(),
                md,
                core::ptr::null_mut(),
            )
        };
        (rc == 1).then_some(this)
    }

    /// `HMAC_Update`.
    pub fn update(&mut self, data: &[u8]) -> bool {
        // SAFETY: keyed in `new` (type invariant); `data` is readable for its length.
        unsafe { HMAC_Update(&raw mut self.0, data.as_ptr(), data.len()) == 1 }
    }

    /// `HMAC_size` — the digest's output length.
    pub fn size(&self) -> usize {
        // SAFETY: keyed in `new`, so `md` is set.
        unsafe { HMAC_size(&raw const self.0) }
    }

    /// `HMAC_CTX_copy` into a fresh context; `None` on failure.
    pub fn copy(&self) -> Option<Self> {
        let mut out = Self::blank();
        // SAFETY: both contexts are initialised.
        let rc = unsafe { HMAC_CTX_copy(&raw mut out.0, &raw const self.0) };
        (rc == 1).then_some(out)
    }

    /// `HMAC_Final` into `out`, which must hold at least [`size`](Self::size)
    /// bytes (else 0). Returns the number of bytes written (0 on failure).
    pub fn final_(&mut self, out: &mut [u8]) -> usize {
        if out.len() < self.size() {
            return 0;
        }
        let mut out_len: c_uint = 0;
        // SAFETY: keyed in `new`; `out` holds the `size()` bytes written (checked above).
        unsafe { HMAC_Final(&raw mut self.0, out.as_mut_ptr(), &raw mut out_len) };
        out_len as usize
    }
}

impl Drop for HmacCtx {
    fn drop(&mut self) {
        // SAFETY: `self.0` was initialised by `HMAC_CTX_init`.
        unsafe { HMAC_CTX_cleanup(&raw mut self.0) };
    }
}

/// `PKCS5_PBKDF2_HMAC` with `md` into `out` (the derived key length is
/// `out.len()`). Returns whether BoringSSL succeeded.
pub fn pbkdf2_hmac(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
    md: &EVP_MD,
    out: &mut [u8],
) -> bool {
    // SAFETY: each pointer is readable/writable for the length passed with it
    // (an empty password is passed as null/0); `md` is a live digest.
    unsafe {
        PKCS5_PBKDF2_HMAC(
            if password.is_empty() {
                core::ptr::null()
            } else {
                password.as_ptr()
            },
            password.len(),
            salt.as_ptr(),
            salt.len(),
            iterations,
            md,
            out.len(),
            out.as_mut_ptr(),
        ) > 0
    }
}
