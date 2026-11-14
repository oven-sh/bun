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
        out_transform: *mut Transform,
    ) -> i32;
    fn bun_avif_decode(
        bytes: *const u8,
        len: usize,
        max_pixels: u64,
        out_w: *mut u32,
        out_h: *mut u32,
        out: *mut u8, // nullable
        out_len: usize,
        out_icc_ptr: *mut *mut u8,
        out_icc_size: *mut usize,
        out_transform: *mut Transform,
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

/// The item's transformative properties, mirrored from `BunAvifTransform`
/// in the shim. libavif parses `clap`/`irot`/`imir` but never applies them
/// to the planes, so the wrapper does, in spec order: crop, then rotate,
/// then mirror. `crop_*` is the full coded image when no `clap` is present.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Transform {
    crop_x: u32,
    crop_y: u32,
    crop_w: u32,
    crop_h: u32,
    /// `irot` angle in anti-clockwise quarter turns (0..=3).
    rot_ccw_quarters: u8,
    /// 0 = none, 1 = top/bottom exchanged (`imir` axis 0), 2 = left/right
    /// exchanged (`imir` axis 1).
    mirror: u8,
}

impl Transform {
    /// Dimensions the item presents after crop and rotation.
    fn displayed_dims(&self) -> (u32, u32) {
        if self.rot_ccw_quarters & 1 == 1 {
            (self.crop_h, self.crop_w)
        } else {
            (self.crop_w, self.crop_h)
        }
    }
}

/// Crop `rgba` (coded `w`×`h`) to the transform's clap rect.
fn crop(rgba: &[u8], w: u32, h: u32, t: &Transform) -> Result<Vec<u8>, codecs::Error> {
    let (cx, cy, cw, ch) = (
        t.crop_x as usize,
        t.crop_y as usize,
        t.crop_w as usize,
        t.crop_h as usize,
    );
    let (w, h) = (w as usize, h as usize);
    if cw == 0
        || ch == 0
        || cx.checked_add(cw).is_none_or(|r| r > w)
        || cy.checked_add(ch).is_none_or(|b| b > h)
    {
        return Err(codecs::Error::DecodeFailed);
    }
    let row_bytes = cw * 4;
    let mut out: Vec<u8> = Vec::new();
    if out.try_reserve_exact(row_bytes * ch).is_err() {
        return Err(codecs::Error::OutOfMemory);
    }
    for row in cy..cy + ch {
        let start = (row * w + cx) * 4;
        out.extend_from_slice(&rgba[start..start + row_bytes]);
    }
    Ok(out)
}

/// Apply clap, irot, imir to a decoded buffer, in that order.
fn apply_transform(d: &mut codecs::Decoded, t: &Transform) -> Result<(), codecs::Error> {
    if t.crop_x != 0 || t.crop_y != 0 || t.crop_w != d.width || t.crop_h != d.height {
        d.rgba = crop(&d.rgba, d.width, d.height, t)?;
        d.width = t.crop_w;
        d.height = t.crop_h;
    }
    // `codecs::rotate` takes clockwise degrees; irot is anti-clockwise.
    let cw_degrees = u32::from((4 - t.rot_ccw_quarters) & 3) * 90;
    if cw_degrees != 0 {
        let next = codecs::rotate(&d.rgba, d.width, d.height, cw_degrees)?;
        d.rgba = next.rgba;
        d.width = next.width;
        d.height = next.height;
    }
    match t.mirror {
        1 => d.rgba = codecs::flip(&d.rgba, d.width, d.height, false)?,
        2 => d.rgba = codecs::flip(&d.rgba, d.width, d.height, true)?,
        _ => {}
    }
    Ok(())
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

/// RAII wrapper that frees a libc-malloc'd ICC buffer on drop. Null-safe.
/// `into_owned()` copies the bytes into a `Vec<u8>` before `Drop` fires,
/// so callers never have to call `libc::free` directly.
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
    /// empty.
    fn into_owned(self) -> Option<Vec<u8>> {
        if self.ptr.is_null() || self.size == 0 {
            return None;
        }
        // SAFETY: the shim's allocation is exactly `self.size` bytes at `self.ptr`;
        // we copy them out before `Drop` frees the source.
        let slice: &[u8] = unsafe { core::slice::from_raw_parts(self.ptr, self.size) };
        // OOM on the dupe aborts rather than silently dropping colour
        // management — matching codec_jpeg/png/webp and the #30197
        // rationale ("no profile" reinterprets P3/Adobe RGB as sRGB).
        Some(slice.to_vec())
    }
}

impl Drop for IccBuf {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            // SAFETY: the shim allocates via std::malloc; libc::free is the matching deallocator.
            unsafe { libc::free(self.ptr.cast::<c_void>()) };
        }
    }
}

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
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
    // into the `w₁·h₁·4` alloc if unchecked. Phase 2 gets the buffer
    // length and refuses an ispe that does not fit it, then the dims are
    // post-checked so a SMALLER swap (which would leave tail rows
    // uninitialised) also degrades to DecodeFailed rather than returning
    // junk.
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    // IccBuf's Drop frees the libc malloc'd buffer on every early return
    // between here and `into_owned()` — the dimension post-check, an OOM
    // on the RGBA alloc, anything else. Null until phase 2 writes it, so
    // on phase-1 error paths this is a no-op.
    let mut icc = IccBuf::new();
    let mut transform = Transform::default();
    // SAFETY: bytes.ptr/len come from a valid live slice; the `*mut u32`
    // / `*mut *mut u8` / `*mut usize` / `*mut Transform` out-params are all
    // valid locals.
    let rc = unsafe {
        bun_avif_decode(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            &raw mut w,
            &raw mut h,
            core::ptr::null_mut(),
            0,
            &raw mut icc.ptr,
            &raw mut icc.size,
            &raw mut transform,
        )
    };
    if rc != AVIF_OK {
        return Err(map_decode_err(rc));
    }
    if w == 0 || h == 0 {
        return Err(codecs::Error::DecodeFailed);
    }

    // Fallible alloc — ~1 GiB ceiling via `max_pixels` is enforced by the
    // shim already, but a hostile 16k×16k input still asks for a 1 GiB
    // RGBA. `vec![0u8; n]` aborts on OOM, so split into a fallible reserve
    // + zero-fill resize: same observable bytes as the sibling codecs,
    // but OOM propagates instead of aborting the process.
    let pixels = usize::try_from(w).expect("int cast") * usize::try_from(h).expect("int cast") * 4;
    let mut out: Vec<u8> = Vec::new();
    if out.try_reserve_exact(pixels).is_err() {
        return Err(codecs::Error::OutOfMemory);
    }
    out.resize(pixels, 0);

    let mut w2: u32 = 0;
    let mut h2: u32 = 0;
    // SAFETY: same as the phase-1 call; `out.as_mut_ptr()` is valid for
    // `out.len()` bytes as reserved above.
    let rc = unsafe {
        bun_avif_decode(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            &raw mut w2,
            &raw mut h2,
            out.as_mut_ptr(),
            out.len(),
            &raw mut icc.ptr,
            &raw mut icc.size,
            &raw mut transform,
        )
    };
    if rc != AVIF_OK {
        return Err(map_decode_err(rc));
    }
    if w2 != w || h2 != h {
        return Err(codecs::Error::DecodeFailed);
    }

    // Re-home the ICC profile into the global allocator (OOM on the dupe
    // aborts rather than silently dropping colour management — same
    // contract as the sibling codecs, see the #30197 rationale there).
    let icc_profile = icc.into_owned();

    let mut decoded = codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        icc_profile,
    };
    apply_transform(&mut decoded, &transform)?;
    Ok(decoded)
}

/// Header-only dimensions probe for `.metadata()`. libavif's parse() stops
/// before sample decode, so this reads the ispe box and returns — roughly
/// PNG-IHDR-cheap, not "full AV1 decode".
pub(crate) fn probe(bytes: &[u8], max_pixels: u64) -> Result<(u32, u32), codecs::Error> {
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    let mut transform = Transform::default();
    // SAFETY: bytes.ptr/len come from a valid live slice; the out-params are valid locals.
    let rc = unsafe {
        bun_avif_probe(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            &raw mut w,
            &raw mut h,
            &raw mut transform,
        )
    };
    if rc != AVIF_OK {
        return Err(map_decode_err(rc));
    }
    if w == 0 || h == 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    // `metadata()` reports what a viewer shows: the clap rect, rotated.
    Ok(transform.displayed_dims())
}

pub(crate) fn encode(
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
    let bytes =
        unsafe { NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(out, out_size)) };
    Ok(codecs::Encoded {
        bytes,
        free: encoded_wrap_free!(bun_avif_free_output),
    })
}
