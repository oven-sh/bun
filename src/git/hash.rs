//! Thin wrappers over the BoringSSL/zlib FFI hashers so the rest of the crate
//! stays `unsafe`-free.
//!
//! Goes through `bun_boringssl_sys` directly (not `bun_sha_hmac`) to keep this
//! crate's `cargo test` link free of the `bun_sys → bun_windows_sys` chain —
//! see the dependency note in `Cargo.toml`.

use crate::Oid;
use bun_boringssl_sys::{SHA_CTX, SHA1_Final, SHA1_Init, SHA1_Update};
use core::ffi::{c_uint, c_ulong, c_void};
use core::mem::MaybeUninit;

unsafe extern "C" {
    /// zlib-ng `crc32` (linked via the same archive build.rs assembles).
    fn crc32(crc: c_ulong, buf: *const u8, len: c_uint) -> c_ulong;
}

/// Incremental SHA-1. BoringSSL's `SHA1_*` — runtime-dispatched to
/// SHA-NI / ARMv8-SHA where available.
pub(crate) struct Sha1(SHA_CTX);

impl Sha1 {
    #[inline]
    pub(crate) fn new() -> Self {
        bun_boringssl_sys::CRYPTO_library_init();
        let mut ctx = MaybeUninit::<SHA_CTX>::uninit();
        // SAFETY: SHA1_Init only writes to the context (no reads of prior
        // state); ctx is sized exactly as SHA_CTX.
        unsafe { SHA1_Init(ctx.as_mut_ptr()) };
        // SAFETY: SHA1_Init fully initialises every field of SHA_CTX.
        Self(unsafe { ctx.assume_init() })
    }

    #[inline]
    pub(crate) fn update(&mut self, data: &[u8]) {
        // SAFETY: self.0 was initialised by SHA1_Init; data is readable for
        // `len` bytes.
        unsafe { SHA1_Update(&raw mut self.0, data.as_ptr().cast::<c_void>(), data.len()) };
    }

    #[inline]
    pub(crate) fn finish(mut self) -> Oid {
        let mut out = [0u8; 20];
        // SAFETY: out is exactly SHA1_DIGEST_LENGTH bytes; ctx is initialised.
        unsafe { SHA1_Final(out.as_mut_ptr(), &raw mut self.0) };
        Oid(out)
    }
}

/// `sha1("<type> <size>\0" || data)` — the loose-object id.
pub(crate) fn object_id(kind: crate::pack::ObjKind, data: &[u8]) -> Oid {
    let mut h = Sha1::new();
    let mut hdr = itoa::Buffer::new();
    h.update(kind.name());
    h.update(b" ");
    h.update(hdr.format(data.len()).as_bytes());
    h.update(&[0]);
    h.update(data);
    h.finish()
}

/// zlib-ng `crc32` (used for the pack-index per-object CRC column).
#[inline]
pub(crate) fn crc32_of(prev: u32, data: &[u8]) -> u32 {
    let mut crc = c_ulong::from(prev);
    // zlib's `len` is `uInt`; chunk so >4 GiB inputs are still correct.
    for chunk in data.chunks(u32::MAX as usize) {
        // SAFETY: chunk is a valid readable slice; len fits in c_uint by
        // construction.
        crc = unsafe { crc32(crc, chunk.as_ptr(), chunk.len() as c_uint) };
    }
    crc as u32
}
