//! libjpeg-turbo (TurboJPEG 3 API) decode/encode for `Bun.Image`.
//! Dispatch lives in codecs.rs; this file is the codec body.

use core::ffi::{c_char, c_int, c_void};

use super::codecs;

#[allow(non_camel_case_types)]
type tjhandle = *mut c_void;

// TODO(port): move to libjpeg_turbo_sys (or runtime_sys) crate
// TJINIT_COMPRESS=0, TJINIT_DECOMPRESS=1.
unsafe extern "C" {
    pub fn tj3Init(init_type: c_int) -> tjhandle;
    pub fn tj3Destroy(h: tjhandle);
    fn tj3Set(h: tjhandle, param: c_int, value: c_int) -> c_int;
    pub fn tj3Get(h: tjhandle, param: c_int) -> c_int;
    pub fn tj3DecompressHeader(h: tjhandle, buf: *const u8, len: usize) -> c_int;
    fn tj3Decompress8(h: tjhandle, buf: *const u8, len: usize, dst: *mut u8, pitch: c_int, pf: c_int) -> c_int;
    fn tj3Compress8(h: tjhandle, src: *const u8, w: c_int, pitch: c_int, height: c_int, pf: c_int, out: *mut *mut u8, out_len: *mut usize) -> c_int;
    fn tj3SetScalingFactor(h: tjhandle, sf: ScalingFactor) -> c_int;
    fn tj3SetCroppingRegion(h: tjhandle, r: CropRegion) -> c_int;
    fn tj3GetScalingFactors(n: *mut c_int) -> *const ScalingFactor;
    pub fn tj3Free(ptr: *mut c_void);
    #[allow(dead_code)]
    fn tj3GetErrorStr(h: tjhandle) -> *const c_char;
    // ICC profile transport: the APP2 ICC_PROFILE marker carries the source's
    // colour space (sRGB implicit when absent; Display-P3 / Adobe RGB / Jpegli
    // XYB / … explicit when present). tj3GetICCProfile reads the decoded
    // marker after TJPARAM_SAVEMARKERS is set to 2 or 4 — it allocates via
    // libjpeg-turbo's allocator and returns it in *iccBuf for the caller to
    // tj3Free. tj3SetICCProfile copies the bytes into the encoder's state so
    // the input buffer can be freed immediately after.
    fn tj3GetICCProfile(h: tjhandle, icc_buf: *mut *mut u8, icc_size: *mut usize) -> c_int;
    fn tj3SetICCProfile(h: tjhandle, icc_buf: *const u8, icc_size: usize) -> c_int;
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ScalingFactor {
    num: c_int,
    denom: c_int,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CropRegion {
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
}

/// TJSCALED: ceil(dim * num / denom).
#[inline]
fn scaled(dim: u32, sf: ScalingFactor) -> u32 {
    // @divFloor with positive denom and non-negative numerator == truncating division.
    u32::try_from((i64::from(dim) * i64::from(sf.num) + i64::from(sf.denom) - 1) / i64::from(sf.denom)).unwrap()
}

// tjparam / tjpf enum values from turbojpeg.h.
const TJPARAM_QUALITY: c_int = 3;
const TJPARAM_SUBSAMP: c_int = 4;
pub const TJPARAM_JPEGWIDTH: c_int = 5;
pub const TJPARAM_JPEGHEIGHT: c_int = 6;
const TJPARAM_PROGRESSIVE: c_int = 12;
const TJPARAM_MAXPIXELS: c_int = 24;
/// `2` = save only APP2/ICC_PROFILE markers (enough for colour management,
/// skips the rest). Must be set BEFORE `tj3DecompressHeader` so the marker
/// parser keeps the profile around for `tj3GetICCProfile`.
const TJPARAM_SAVEMARKERS: c_int = 25;
const TJPF_RGBA: c_int = 7;
const TJSAMP_420: c_int = 2;

pub fn decode(bytes: &[u8], max_pixels: u64, hint: codecs::DecodeHint) -> Result<codecs::Decoded, codecs::Error> {
    // SAFETY: FFI — tj3Init has no preconditions; returns null on failure.
    let h = unsafe { tj3Init(1) };
    if h.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    // SAFETY: `h` is the non-null tjhandle returned above; tj3Destroy is the
    // documented owner-release and is called exactly once via this guard.
    let _h_guard = scopeguard::guard(h, |h| unsafe { tj3Destroy(h) });
    // Ask libjpeg-turbo to keep the APP2/ICC_PROFILE markers so we can pull
    // the profile out after header parse. Must be set PRE-header — the
    // marker buffer is discarded if we set this after.
    // SAFETY: `h` is a live tjhandle for the duration of `_h_guard`.
    unsafe { tj3Set(h, TJPARAM_SAVEMARKERS, 2) };
    // SAFETY: `h` is live; ptr/len come from a valid `&[u8]` borrowed for the call.
    if unsafe { tj3DecompressHeader(h, bytes.as_ptr(), bytes.len()) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    // SAFETY: `h` is live; tj3Get only reads handle state.
    let rw = unsafe { tj3Get(h, TJPARAM_JPEGWIDTH) };
    // SAFETY: `h` is live; tj3Get only reads handle state.
    let rh = unsafe { tj3Get(h, TJPARAM_JPEGHEIGHT) };
    // tj3Get returns -1 on error; treat any non-positive dim as a decode
    // failure rather than letting the cast trap on hostile input.
    if rw <= 0 || rh <= 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    let src_w: u32 = u32::try_from(rw).unwrap();
    let src_h: u32 = u32::try_from(rh).unwrap();
    codecs::guard(src_w, src_h, max_pixels)?;

    let mut w = src_w;
    let mut ht = src_h;
    // DCT-domain scaling: if the pipeline will downscale, ask libjpeg-turbo
    // for the smallest M/8 IDCT that still ≥ target. The IDCT is where the
    // decode time goes, so this is roughly (8/M)² faster AND the RGBA
    // buffer shrinks by the same factor — both speed and RSS win in one
    // place. The subsequent resize pass takes it the rest of the way.
    if hint.target_w != 0
        && hint.target_h != 0
        && (hint.target_w < src_w || hint.target_h < src_h)
    {
        let mut n: c_int = 0;
        // SAFETY: FFI — writes a count into `n` and returns a pointer to a
        // static const table inside libjpeg-turbo; no handle required.
        let sfs = unsafe { tj3GetScalingFactors(&mut n) };
        if !sfs.is_null() {
            let mut best = ScalingFactor { num: 1, denom: 1 };
            // SAFETY: tj3GetScalingFactors returned `n` valid ScalingFactor entries at `sfs`.
            let sfs = unsafe { core::slice::from_raw_parts(sfs, usize::try_from(n).unwrap()) };
            for &sf in sfs {
                // Only consider downscale factors.
                if sf.num >= sf.denom {
                    continue;
                }
                let sw = scaled(src_w, sf);
                let sh = scaled(src_h, sf);
                // Never go BELOW target — that would force upscale and
                // throw away detail the user asked for.
                if sw < hint.target_w || sh < hint.target_h {
                    continue;
                }
                // Pick the smallest output (= largest reduction).
                if u64::from(sw) * u64::from(sh) < u64::from(scaled(src_w, best)) * u64::from(scaled(src_h, best)) {
                    best = sf;
                }
            }
            if best.num != best.denom {
                // SAFETY: `h` is live; `best` is a plain #[repr(C)] value passed by copy.
                unsafe { tj3SetScalingFactor(h, best) };
                w = scaled(src_w, best);
                ht = scaled(src_h, best);
            }
        }
    }

    // `bytes` may alias a JS ArrayBuffer; the contract is "don't mutate while
    // a terminal is pending" (SharedArrayBuffer is refused at construction),
    // so the honest path costs nothing. Hardening here is so a hostile
    // mid-decode swap degrades to DecodeFailed, not OOB/heap-leak:
    // tj3DecompressHeader ends with `jpeg_abort_decompress`, so
    // tj3Decompress8 re-runs `jpeg_read_header` and derives row count /
    // stride from a fresh parse. Bound the WRITE REGION to OUR alloc with
    //   • TJPARAM_MAXPIXELS — second-parse w'·h' > w·h fails before output
    //     (turbojpeg-mp.c:183)
    //   • explicit pitch — stride can't grow with w'
    //   • croppingRegion {0,0,w,ht} — `croppedHeight = ht` regardless of h'
    //     (turbojpeg-mp.c:222), so an aspect-swap (4096×1→1×4096) that
    //     passes the product check still can't write more rows than fit
    // and post-check the second-parse dims so a smaller swap (which would
    // leave rows unfilled with raw mimalloc bytes) is treated as corrupt.
    // SAFETY: `h` is live; CropRegion is a plain #[repr(C)] value passed by copy.
    unsafe {
        tj3Set(h, TJPARAM_MAXPIXELS, c_int::try_from(src_w * src_h).unwrap_or(c_int::MAX));
        tj3SetCroppingRegion(h, CropRegion {
            x: 0,
            y: 0,
            w: c_int::try_from(w).unwrap(),
            h: c_int::try_from(ht).unwrap(),
        });
    }
    // PERF(port): was uninitialized `allocator.alloc(u8, n)` — zero-init here; profile in Phase B
    let mut out = vec![0u8; w as usize * ht as usize * 4].into_boxed_slice();
    // SAFETY: `h` is live; src ptr/len come from a valid `&[u8]`; dst is the
    // exclusive `out` buffer sized `w*ht*4` and the explicit pitch + cropping
    // region above bound libjpeg-turbo's writes to that allocation.
    if unsafe { tj3Decompress8(h, bytes.as_ptr(), bytes.len(), out.as_mut_ptr(), c_int::try_from(w * 4).unwrap(), TJPF_RGBA) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    // SAFETY: `h` is live; tj3Get only reads handle state.
    if unsafe { tj3Get(h, TJPARAM_JPEGWIDTH) } != rw || unsafe { tj3Get(h, TJPARAM_JPEGHEIGHT) } != rh {
        return Err(codecs::Error::DecodeFailed);
    }

    // Extract the APP2 ICC profile (if the source carried one). The marker
    // parser ran during tj3DecompressHeader, so this is a copy-out of
    // already-parsed state. `tj3GetICCProfile` allocates via libjpeg-turbo's
    // allocator; re-home into the global allocator so the rest of the
    // pipeline can free it uniformly. A decode that simply has no profile
    // returns non-zero with iccSize==0 — treat that as "no profile", not an
    // error. OutOfMemory on the dupe is propagated (not swallowed) — the
    // pixels may be Display P3 / Adobe RGB / XYB, where "no profile"
    // silently reinterprets them as sRGB and shifts colour, which is the
    // exact bug #30197 is about.
    let mut icc_ptr: *mut u8 = core::ptr::null_mut();
    let mut icc_size: usize = 0;
    let icc: Option<Box<[u8]>> = 'blk: {
        // SAFETY: `h` is live; out-params are valid `&mut` locals.
        if unsafe { tj3GetICCProfile(h, &mut icc_ptr, &mut icc_size) } != 0 || icc_size == 0 {
            break 'blk None;
        }
        let _free = scopeguard::guard(icc_ptr, |p| {
            if !p.is_null() {
                // SAFETY: `p` was allocated by libjpeg-turbo via tj3GetICCProfile;
                // tj3Free is its matching deallocator and is called exactly once.
                unsafe { tj3Free(p.cast()) };
            }
        });
        if icc_ptr.is_null() {
            break 'blk None;
        }
        // SAFETY: tj3GetICCProfile wrote `icc_size` bytes at `icc_ptr`.
        let src = unsafe { core::slice::from_raw_parts(icc_ptr, icc_size) };
        break 'blk Some(Box::<[u8]>::from(src));
    };
    Ok(codecs::Decoded { rgba: out, width: w, height: ht, icc_profile: icc })
}

pub fn encode(rgba: &[u8], w: u32, ht: u32, quality: u8, progressive: bool, icc_profile: Option<&[u8]>) -> Result<codecs::Encoded, codecs::Error> {
    // SAFETY: FFI — tj3Init has no preconditions; returns null on failure.
    let h = unsafe { tj3Init(0) };
    if h.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    // SAFETY: `h` is the non-null tjhandle returned above; tj3Destroy is the
    // documented owner-release and is called exactly once via this guard.
    let _h_guard = scopeguard::guard(h, |h| unsafe { tj3Destroy(h) });
    // SAFETY: `h` is a live tjhandle for the duration of `_h_guard`.
    unsafe {
        tj3Set(h, TJPARAM_QUALITY, c_int::from(quality.clamp(1, 100)));
        tj3Set(h, TJPARAM_SUBSAMP, TJSAMP_420);
    }
    // Progressive emits a multi-scan SOF2 stream; same size ±1%, decodes
    // coarse-to-fine. Off by default (slower to encode, some old decoders
    // mishandle it).
    if progressive {
        // SAFETY: `h` is live.
        unsafe { tj3Set(h, TJPARAM_PROGRESSIVE, 1) };
    }
    // Embed the source colour profile as an APP2/ICC_PROFILE marker. The
    // library copies the bytes, so the caller can free `icc_profile` right
    // after this call returns. A non-zero return here means the profile
    // was malformed — drop it rather than fail the encode; a JPEG without a
    // profile is still a valid JPEG (implicitly sRGB). See #30197.
    if let Some(p) = icc_profile {
        if !p.is_empty() {
            // SAFETY: `h` is live; ptr/len come from a valid `&[u8]`; the
            // library copies the bytes so the borrow need only outlive the call.
            unsafe { tj3SetICCProfile(h, p.as_ptr(), p.len()) };
        }
    }
    let mut out_ptr: *mut u8 = core::ptr::null_mut();
    let mut out_len: usize = 0;
    // SAFETY: `h` is live; src ptr/len come from a valid `&[u8]` with the
    // caller-asserted `w*ht*4` layout; out-params are valid `&mut` locals and
    // libjpeg-turbo allocates the output buffer (out_ptr starts null).
    if unsafe {
        tj3Compress8(
            h,
            rgba.as_ptr(),
            c_int::try_from(w).unwrap(),
            0,
            c_int::try_from(ht).unwrap(),
            TJPF_RGBA,
            &mut out_ptr,
            &mut out_len,
        )
    } != 0
    {
        // tj3Compress8 may have allocated (or grown) `out_ptr` before
        // failing mid-stream; the docs say the caller owns it on any return.
        if !out_ptr.is_null() {
            // SAFETY: `out_ptr` was allocated by tj3Compress8 via libjpeg-turbo's
            // allocator; tj3Free is its matching deallocator.
            unsafe { tj3Free(out_ptr.cast()) };
        }
        return Err(codecs::Error::EncodeFailed);
    }
    // tj3Compress8 allocates via libjpeg-turbo's allocator; hand it to JS
    // with `tj3Free` as the finalizer instead of duping.
    // TODO(port): codecs::Encoded layout — bytes is a foreign-allocator slice (ptr+len) freed via `free` fn pointer
    Ok(codecs::Encoded {
        // SAFETY: tj3Compress8 succeeded; out_ptr is non-null and owns `out_len` bytes.
        bytes: unsafe { core::slice::from_raw_parts_mut(out_ptr, out_len) },
        free: codecs::Encoded::wrap(tj3Free),
    })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/codec_jpeg.zig (176 lines)
//   confidence: medium
//   todos:      2
//   notes:      codecs::Encoded.bytes is a foreign-allocator slice with custom free fn — Phase B must settle its Rust shape (ptr+len vs ManuallyDrop); extern fns left inline pending *_sys crate.
// ──────────────────────────────────────────────────────────────────────────
