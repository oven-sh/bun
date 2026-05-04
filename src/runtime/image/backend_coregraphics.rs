//! macOS ImageIO/CoreGraphics backend.
//!
//! All framework calls live in `src/jsc/bindings/image_coregraphics_shim.cpp`
//! — see the header comment there for why (Zig→dlsym'd-function-pointer calls
//! into CG segfaulted on x86_64 even after thunking the obvious by-value
//! struct, so the whole dispatch is in C++ where clang owns the ABI). This
//! file just allocates the RGBA/output buffers in the global allocator and
//! maps the C status codes back onto `codecs::Error`.

use super::codecs;

/// Zig: `pub const BackendError = codecs.Error || error{BackendUnavailable};`
#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum BackendError {
    #[error("BackendUnavailable")]
    BackendUnavailable,
    // ── from codecs::Error ────────────────────────────────────────────────
    #[error("DecodeFailed")]
    DecodeFailed,
    #[error("EncodeFailed")]
    EncodeFailed,
    #[error("TooManyPixels")]
    TooManyPixels,
    #[error("OutOfMemory")]
    OutOfMemory,
    // TODO(port): narrow error set — confirm full variant list of codecs::Error
}

impl From<codecs::Error> for BackendError {
    fn from(e: codecs::Error) -> Self {
        // TODO(port): exhaustive match once codecs::Error is ported
        match <&'static str>::from(e) {
            "DecodeFailed" => Self::DecodeFailed,
            "EncodeFailed" => Self::EncodeFailed,
            "TooManyPixels" => Self::TooManyPixels,
            "OutOfMemory" => Self::OutOfMemory,
            _ => Self::BackendUnavailable,
        }
    }
}

impl From<BackendError> for bun_core::Error {
    fn from(e: BackendError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// TODO(port): move to runtime_sys (or a dedicated image_sys crate)
unsafe extern "C" {
    fn bun_coregraphics_decode(
        bytes: *const u8,
        len: usize,
        max_pixels: u64,
        out_w: *mut u32,
        out_h: *mut u32,
        out: *mut u8, // nullable
    ) -> i32;

    fn bun_coregraphics_encode(
        rgba: *const u8,
        width: u32,
        height: u32,
        format: i32,
        quality: i32,
        out: *mut u8, // nullable
        out_len: *mut usize,
    ) -> i32;
}

const CG_OK: i32 = 0;
const CG_UNAVAILABLE: i32 = 1;
const CG_DECODE_FAILED: i32 = 2;
const CG_ENCODE_FAILED: i32 = 3;
const CG_TOO_MANY_PIXELS: i32 = 4;

fn map_err(rc: i32) -> BackendError {
    match rc {
        CG_UNAVAILABLE => BackendError::BackendUnavailable,
        CG_DECODE_FAILED => BackendError::DecodeFailed,
        CG_ENCODE_FAILED => BackendError::EncodeFailed,
        CG_TOO_MANY_PIXELS => BackendError::TooManyPixels,
        _ => BackendError::BackendUnavailable,
    }
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, BackendError> {
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    // Phase 1: dimensions only (out=null) so we can allocate in the global
    // allocator like every other decode path.
    // SAFETY: bytes is a valid slice; out=null signals "probe only" to the shim.
    match unsafe {
        bun_coregraphics_decode(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            &mut w,
            &mut h,
            core::ptr::null_mut(),
        )
    } {
        CG_OK => {}
        rc => return Err(map_err(rc)),
    }
    // PERF(port): Zig used uninitialized alloc; vec![0u8; n] zero-fills — profile in Phase B
    let mut out = vec![0u8; (w as usize) * (h as usize) * 4];
    // Phase 2: render. The C side re-creates the CGImageSource (cheap — the
    // header parse is the only repeated work) so we don't have to thread an
    // opaque handle across the boundary.
    // SAFETY: out has exactly w*h*4 bytes; shim writes that many.
    match unsafe {
        bun_coregraphics_decode(
            bytes.as_ptr(),
            bytes.len(),
            max_pixels,
            &mut w,
            &mut h,
            out.as_mut_ptr(),
        )
    } {
        CG_OK => {}
        rc => return Err(map_err(rc)),
    }
    Ok(codecs::Decoded { rgba: out, width: w, height: h })
}

pub fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    opts: &codecs::EncodeOptions,
) -> Result<Vec<u8>, BackendError> {
    // codecs::encode only routes heic/avif here, so the "knob ImageIO can't
    // express" bailouts (palette/compressionLevel/lossless) are dead — kept
    // only as a guard if a future caller passes png/webp directly.
    debug_assert!(opts.format == codecs::Format::Heic || opts.format == codecs::Format::Avif);
    let fmt: i32 = opts.format as i32;
    let mut len: usize = 0;
    // Phase 1: encode into a thread-local CFData inside the shim, return size.
    // SAFETY: rgba is valid; out=null signals "size probe" to the shim.
    match unsafe {
        bun_coregraphics_encode(
            rgba.as_ptr(),
            width,
            height,
            fmt,
            opts.quality,
            core::ptr::null_mut(),
            &mut len,
        )
    } {
        CG_OK => {}
        rc => return Err(map_err(rc)),
    }
    // PERF(port): Zig used uninitialized alloc — profile in Phase B
    let mut out = vec![0u8; len];
    // Phase 2: copy out and release the CFData.
    // SAFETY: out has `len` bytes; shim writes ≤ len and updates `len`.
    match unsafe {
        bun_coregraphics_encode(
            rgba.as_ptr(),
            width,
            height,
            fmt,
            opts.quality,
            out.as_mut_ptr(),
            &mut len,
        )
    } {
        CG_OK => {}
        rc => return Err(map_err(rc)),
    }
    out.truncate(len);
    Ok(out)
}

// ── vImage geometry ────────────────────────────────────────────────────────
// AMX-backed kernels for the common pipeline ops. Signatures mirror the
// Highway path in `codecs.rs` so the dispatch site is `system_backend.x()
// .or_else(|_| fallback.x())`.

// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn bun_coregraphics_scale(src: *const u8, sw: u32, sh: u32, dst: *mut u8, dw: u32, dh: u32) -> i32;
    fn bun_coregraphics_rotate90(src: *const u8, w: u32, h: u32, dst: *mut u8, quarters: u32) -> i32;
    fn bun_coregraphics_reflect(src: *const u8, w: u32, h: u32, dst: *mut u8, horizontal: i32) -> i32;
}

/// vImageScale's default kernel is Lanczos-3 (the HQ flag widens to L5), so
/// we only take this path for the `.lanczos3` default — explicit non-Lanczos
/// filters fall through to the Highway kernel which honours them exactly.
pub fn scale(
    src: &[u8],
    sw: u32,
    sh: u32,
    dw: u32,
    dh: u32,
    filter: codecs::Filter,
) -> Result<Vec<u8>, BackendError> {
    if filter != codecs::Filter::Lanczos3 {
        return Err(BackendError::BackendUnavailable);
    }
    // PERF(port): Zig used uninitialized alloc — profile in Phase B
    let mut out = vec![0u8; (dw as usize) * (dh as usize) * 4];
    // SAFETY: src has sw*sh*4 bytes (caller invariant); out has dw*dh*4 bytes.
    if unsafe { bun_coregraphics_scale(src.as_ptr(), sw, sh, out.as_mut_ptr(), dw, dh) } != CG_OK {
        return Err(BackendError::BackendUnavailable);
    }
    Ok(out)
}

pub fn rotate(src: &[u8], w: u32, h: u32, quarters: u32) -> Result<Vec<u8>, BackendError> {
    // PERF(port): Zig used uninitialized alloc — profile in Phase B
    let mut out = vec![0u8; (w as usize) * (h as usize) * 4];
    // SAFETY: src and out both have w*h*4 bytes.
    if unsafe { bun_coregraphics_rotate90(src.as_ptr(), w, h, out.as_mut_ptr(), quarters) } != CG_OK {
        return Err(BackendError::BackendUnavailable);
    }
    Ok(out)
}

pub fn flip(src: &[u8], w: u32, h: u32, horizontal: bool) -> Result<Vec<u8>, BackendError> {
    // PERF(port): Zig used uninitialized alloc — profile in Phase B
    let mut out = vec![0u8; (w as usize) * (h as usize) * 4];
    // SAFETY: src and out both have w*h*4 bytes.
    if unsafe { bun_coregraphics_reflect(src.as_ptr(), w, h, out.as_mut_ptr(), horizontal as i32) } != CG_OK {
        return Err(BackendError::BackendUnavailable);
    }
    Ok(out)
}

// ── NSPasteboard ───────────────────────────────────────────────────────────
// JS-thread only (NSPasteboard is documented main-thread-safe to *read*, and
// the static `Bun.Image.fromClipboard()` accessor calls this synchronously
// before constructing the Image — the heavy decode still goes to WorkPool).

// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn bun_coregraphics_clipboard(out: *mut u8, out_len: *mut usize, probe_only: i32) -> i32;
}

/// `None` ⇔ no image on the pasteboard. Returned bytes are an opaque container
/// (PNG/TIFF/HEIC/…); feed straight to `new Bun.Image(…)`.
// Zig error set: `error{BackendUnavailable, OutOfMemory}` — subset of BackendError.
pub fn clipboard() -> Result<Option<Vec<u8>>, BackendError> {
    let mut len: usize = 0;
    // SAFETY: out=null + probe_only=0 → shim fills len with required byte count.
    if unsafe { bun_coregraphics_clipboard(core::ptr::null_mut(), &mut len, 0) } != CG_OK {
        return Err(BackendError::BackendUnavailable);
    }
    if len == 0 {
        return Ok(None);
    }
    // PERF(port): Zig used uninitialized alloc — profile in Phase B
    let mut out = vec![0u8; len];
    // SAFETY: out has `len` bytes; shim writes ≤ len and updates `len`.
    if unsafe { bun_coregraphics_clipboard(out.as_mut_ptr(), &mut len, 0) } != CG_OK {
        return Err(BackendError::BackendUnavailable);
    }
    out.truncate(len);
    Ok(Some(out))
}

pub fn has_clipboard_image() -> bool {
    let mut len: usize = 0;
    // SAFETY: out=null + probe_only=1 → shim only checks for image presence.
    unsafe { bun_coregraphics_clipboard(core::ptr::null_mut(), &mut len, 1) == CG_OK && len > 0 }
}

// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn bun_coregraphics_clipboard_change_count() -> i64;
}
// Zig: `pub const clipboardChangeCount = bun_coregraphics_clipboard_change_count;`
pub fn clipboard_change_count() -> i64 {
    // SAFETY: pure getter, no preconditions.
    unsafe { bun_coregraphics_clipboard_change_count() }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/backend_coregraphics.zig (155 lines)
//   confidence: medium
//   todos:      5
//   notes:      BackendError hand-expanded from codecs::Error union; vec![0u8;n] zero-fills where Zig left uninit (PERF-tagged); externs left in-file pending *_sys crate
// ──────────────────────────────────────────────────────────────────────────
