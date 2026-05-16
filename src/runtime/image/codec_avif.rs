//! AVIF decode + encode for `Bun.Image` on Linux, via libavif + libdav1d (and
//! whichever AV1 encoder the distro bundled — typically aom, rav1e, and/or
//! SVT-AV1) loaded at runtime. Dispatch lives in codecs.rs; this file is a
//! thin Rust-side wrapper over `image_avif_shim.cpp` — the shim does the
//! dlopen, holds the dlsym table, and speaks libavif's ABI. If libavif isn't
//! installed the shim returns `AVIF_UNAVAILABLE` and we surface
//! `Error::UnsupportedOnPlatform` (same contract as a mac/win system-backend
//! miss); if libavif is present but has no registered encoder (rare — an
//! explicit decode-only build), encode fails as `EncodeFailed`.
//!
//! macOS and Windows continue to use the OS codec (ImageIO/WIC) via
//! `backend_*` — see `codecs.rs`'s dispatch for how the two paths combine.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use super::codecs;
use crate::encoded_wrap_free;

const AVIF_OK: i32 = 0;
const AVIF_UNAVAILABLE: i32 = 1;
// AVIF_DECODE_FAILED = 2 / AVIF_ENCODE_FAILED = 3 fall through the `else` arms.
const AVIF_TOO_MANY_PIXELS: i32 = 4;

// `bun_avif_*` live in src/jsc/bindings/image_avif_shim.cpp. Return codes:
//   0                    → success
//   AVIF_UNAVAILABLE     → libavif.so.16 not installed or dlsym missed a
//                          required symbol; surface UnsupportedOnPlatform
//                          (same as a mac/win system-backend miss).
//   AVIF_DECODE_FAILED   → libavif's own decode error; surface DecodeFailed.
//   AVIF_ENCODE_FAILED   → libavif's own encode error (also used for "no
//                          codec registered"); surface EncodeFailed.
//   AVIF_TOO_MANY_PIXELS → the shim's pre-decode pixel guard fired; map to
//                          TooManyPixels so callers get the same error code
//                          jpeg/png/webp produce.
unsafe extern "C" {
    fn bun_avif_probe(
        bytes: *const u8,
        len: usize,
        max_pixels: u64,
        out_w: *mut u32,
        out_h: *mut u32,
    ) -> i32;
    fn bun_avif_decode(
        bytes: *const u8,
        len: usize,
        max_pixels: u64,
        out_w: *mut u32,
        out_h: *mut u32,
        out: *mut u8, // nullable
        out_icc_ptr: *mut *mut u8,
        out_icc_size: *mut usize,
    ) -> i32;
    fn bun_avif_encode(
        rgba: *const u8,
        w: u32,
        h: u32,
        quality: c_int,
        icc: *const u8, // nullable
        icc_size: usize,
        out_data: *mut *mut u8,
        out_size: *mut usize,
    ) -> i32;
    fn bun_avif_free_output(data: *mut c_void);
}

// libc `free()` for the malloc'd ICC buffer the shim hands us.
unsafe extern "C" {
    fn free(p: *mut c_void);
}

fn map_decode_err(rc: i32) -> codecs::Error {
    match rc {
        AVIF_UNAVAILABLE => codecs::Error::UnsupportedOnPlatform,
        AVIF_TOO_MANY_PIXELS => codecs::Error::TooManyPixels,
        _ => codecs::Error::DecodeFailed,
    }
}

fn map_encode_err(rc: i32) -> codecs::Error {
    match rc {
        AVIF_UNAVAILABLE => codecs::Error::UnsupportedOnPlatform,
        _ => codecs::Error::EncodeFailed,
    }
}

/// RAII wrapper that frees a libc-malloc'd ICC buffer on drop unless
/// `take()` is called first. Null-safe.
struct IccBuf {
    ptr: *mut u8,
    size: usize,
}

impl IccBuf {
    fn new() -> Self {
        Self {
            ptr: core::ptr::null_mut(),
            size: 0,
        }
    }

    /// Copy the bytes into a `Vec<u8>` (global allocator) and leave the
    /// libc buffer to be freed by `Drop`. Returns `None` if the buffer is
    /// empty or allocation fails.
    fn into_owned(self) -> Option<Vec<u8>> {
        if self.ptr.is_null() || self.size == 0 {
            return None;
        }
        // SAFETY: the shim's allocation is exactly `self.size` bytes at `self.ptr`;
        // we copy them out before `Drop` frees the source.
        let slice: &[u8] = unsafe { core::slice::from_raw_parts(self.ptr, self.size) };
        // Fallible alloc — an OOM dropping the profile is fine (AVIF without
        // ICC is still valid, implicitly sRGB via CICP), same as jpeg/png.
        let mut v: Vec<u8> = Vec::new();
        if v.try_reserve_exact(self.size).is_err() {
            return None;
        }
        v.extend_from_slice(slice);
        Some(v)
    }
}

impl Drop for IccBuf {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            // SAFETY: the shim allocates via std::malloc; free() is the matching deallocator.
            unsafe { free(self.ptr.cast::<c_void>()) };
        }
    }
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    // Two-phase so the output buffer can live in the global allocator
    // (matches jpeg/png/webp ownership contract): phase 1 runs
    // `avifDecoderParse` and returns dims; phase 2 runs the AV1 decode and
    // fills the caller-provided buffer. The shim re-opens the decoder
    // between phases, which is cheap relative to the AV1 decode itself.
    //
    // `bytes` is a borrowed view of a JS ArrayBuffer the user can still
    // WRITE (the pin only blocks detach), so a hostile caller can swap in
    // a different AVIF between the two parses. Phase 1 sizes the
    // allocation from the first ispe; phase 2 parses again on the
    // (possibly mutated) bytes and would happily write `w₂·h₂·4` bytes
    // into the `w₁·h₁·4` alloc if unchecked. Harden the same way
    // codec_jpeg/codec_webp do: tell phase 2 to refuse anything larger
    // than phase 1's pixel product (reuses the shim's existing
    // `pixels > max_pixels` check), then post-check dims are unchanged
    // so a SMALLER swap (which would leave tail rows uninitialised)
    // also degrades to DecodeFailed rather than returning junk.
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    // IccBuf's Drop frees the libc malloc'd buffer on every early return
    // between here and `into_owned()` — the dimension post-check, an OOM
    // on the RGBA alloc, anything else. Null until phase 2 writes it, so
    // on phase-1 error paths this is a no-op.
    let mut icc = IccBuf::new();
    // SAFETY: bytes.ptr/len come from a valid live slice; the `*mut u32`
    // / `*mut *mut u8` / `*mut usize` out-params are all valid locals.
    let rc = unsafe {
        bun_avif_decode(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            &raw mut w,
            &raw mut h,
            core::ptr::null_mut(),
            &raw mut icc.ptr,
            &raw mut icc.size,
        )
    };
    if rc != AVIF_OK {
        return Err(map_decode_err(rc));
    }
    if w == 0 || h == 0 {
        return Err(codecs::Error::DecodeFailed);
    }

    // Fallible alloc — match jpeg/png/webp: ~1 GiB ceiling via `max_pixels`
    // enforced by the shim already, but a hostile 16k×16k input still asks
    // for a 1 GiB RGBA. Let the OOM propagate instead of aborting.
    let pixels = usize::try_from(w).expect("int cast") * usize::try_from(h).expect("int cast") * 4;
    let mut out: Vec<u8> = Vec::new();
    if out.try_reserve_exact(pixels).is_err() {
        return Err(codecs::Error::OutOfMemory);
    }
    // SAFETY: `try_reserve_exact` guarantees capacity ≥ pixels and the Vec
    // is empty; set_len is safe because the shim will fill every byte on
    // success (and we discard the Vec on error before observing contents).
    unsafe { out.set_len(pixels) };

    let mut w2: u32 = 0;
    let mut h2: u32 = 0;
    let phase1_pixels = u64::from(w) * u64::from(h);
    // SAFETY: same as the phase-1 call; `out.as_mut_ptr()` is valid for
    // `pixels` bytes as reserved above.
    let rc = unsafe {
        bun_avif_decode(
            bytes.as_ptr(),
            bytes.len(),
            phase1_pixels,
            &raw mut w2,
            &raw mut h2,
            out.as_mut_ptr(),
            &raw mut icc.ptr,
            &raw mut icc.size,
        )
    };
    match rc {
        AVIF_OK => {}
        // At this call site `max_pixels` is the phase-1 alloc bound, not
        // the user's `maxPixels` — TooManyPixels firing here means a
        // hostile larger-swap, which `pinForTask`'s invariant (and the
        // sibling codec_jpeg/codec_webp) surface as DecodeFailed. Remap.
        AVIF_TOO_MANY_PIXELS => return Err(codecs::Error::DecodeFailed),
        _ => return Err(map_decode_err(rc)),
    }
    if w2 != w || h2 != h {
        return Err(codecs::Error::DecodeFailed);
    }

    // Re-home the ICC profile into the global allocator; if the dupe OOMs
    // we drop the profile and keep the pixels (jpeg/png do the same — see
    // #30197 rationale; an AVIF without ICC is still valid, implicitly
    // sRGB via CICP).
    let icc_profile = icc.into_owned();

    Ok(codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        icc_profile,
    })
}

/// Header-only dimensions probe for `.metadata()`. libavif's parse() stops
/// before sample decode, so this reads the ispe box and returns — roughly
/// PNG-IHDR-cheap, not "full AV1 decode".
pub fn probe(bytes: &[u8], max_pixels: u64) -> Result<(u32, u32), codecs::Error> {
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    // SAFETY: bytes.ptr/len come from a valid live slice; the out-params are valid locals.
    let rc = unsafe {
        bun_avif_probe(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            &raw mut w,
            &raw mut h,
        )
    };
    if rc != AVIF_OK {
        return Err(map_decode_err(rc));
    }
    if w == 0 || h == 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    Ok((w, h))
}

pub fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    quality: u8,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    // libavif's `quality` is 0-100 (AVIF_QUALITY_WORST .. AVIF_QUALITY_BEST),
    // matching our `EncodeOptions.quality` verbatim — no remap needed.
    // ICC bytes are attached via `avifImageSetProfileICC` inside the shim;
    // libavif copies into its own allocator, so our caller keeps the
    // borrow. See #30197 for why dropping the profile matters.
    let mut out: *mut u8 = core::ptr::null_mut();
    let mut out_size: usize = 0;
    let (icc_ptr, icc_len) = match icc_profile {
        Some(p) if !p.is_empty() => (p.as_ptr(), p.len()),
        _ => (core::ptr::null(), 0),
    };
    // SAFETY: rgba.ptr/len describe a valid readable buffer of w*h*4 bytes;
    // icc_ptr is either null or valid for icc_len bytes; out/out_size are
    // valid `*mut` locals.
    let rc = unsafe {
        bun_avif_encode(
            rgba.as_ptr(),
            w,
            h,
            c_int::from(quality),
            icc_ptr,
            icc_len,
            &raw mut out,
            &raw mut out_size,
        )
    };
    if rc != AVIF_OK {
        return Err(map_encode_err(rc));
    }
    if out.is_null() || out_size == 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    // The shim owns the buffer via libavif's `avifRWData`. Hand the raw
    // pointer+size to JS via `Encoded`; Drop calls `avifRWDataFree`
    // (wrapped in `bun_avif_free_output`) — same zero-copy ownership model
    // as WebPFree / tj3Free.
    // SAFETY: `out` is non-null and `out_size` bytes are valid as returned by the shim.
    let bytes = unsafe {
        NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(out, out_size))
    };
    Ok(codecs::Encoded {
        bytes,
        free: encoded_wrap_free!(bun_avif_free_output),
    })
}
