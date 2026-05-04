//! libspng decode/encode for `Bun.Image`. Indexed-PNG encode quantises via
//! `quantize.rs`. Dispatch lives in codecs.rs; this file is the codec body.

use core::ffi::{c_int, c_void};

use super::codecs;
use super::quantize;

// TODO(port): move to runtime_sys (or a dedicated spng_sys crate)
#[repr(C)]
pub struct spng_ctx {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    fn spng_ctx_new(flags: c_int) -> *mut spng_ctx;
    fn spng_ctx_free(ctx: *mut spng_ctx);
    fn spng_set_png_buffer(ctx: *mut spng_ctx, buf: *const u8, len: usize) -> c_int;
    fn spng_decoded_image_size(ctx: *mut spng_ctx, fmt: c_int, out: *mut usize) -> c_int;
    fn spng_decode_image(ctx: *mut spng_ctx, out: *mut u8, len: usize, fmt: c_int, flags: c_int) -> c_int;
    fn spng_get_ihdr(ctx: *mut spng_ctx, ihdr: *mut Ihdr) -> c_int;
    fn spng_set_ihdr(ctx: *mut spng_ctx, ihdr: *const Ihdr) -> c_int;
    fn spng_set_plte(ctx: *mut spng_ctx, plte: *const Plte) -> c_int;
    fn spng_set_trns(ctx: *mut spng_ctx, trns: *const Trns) -> c_int;
    fn spng_encode_image(ctx: *mut spng_ctx, img: *const u8, len: usize, fmt: c_int, flags: c_int) -> c_int;
    fn spng_get_png_buffer(ctx: *mut spng_ctx, len: *mut usize, err: *mut c_int) -> *mut u8;
    fn spng_set_option(ctx: *mut spng_ctx, opt: c_int, value: c_int) -> c_int;
    /// iCCP chunk read/write — PNG carries an optional ICC profile alongside
    /// the pixels for every colour type (including indexed). `spng_get_iccp`
    /// returns non-zero when the source has no iCCP (or the chunk was
    /// malformed); we treat all non-zero returns the same way — drop the
    /// profile — because the pixels are still valid and a PNG without iCCP
    /// is still a valid PNG. The `profile` pointer it hands back is owned by
    /// the context and freed with `spng_ctx_free`; dupe out before then.
    fn spng_get_iccp(ctx: *mut spng_ctx, iccp: *mut Iccp) -> c_int;
    fn spng_set_iccp(ctx: *mut spng_ctx, iccp: *const Iccp) -> c_int;
}

#[repr(C)]
struct Iccp {
    /// PNG's Latin-1 iCCP keyword (1-79 chars + NUL). libspng requires it
    /// non-empty on encode; the PNG spec marks it purely informational
    /// (the profile bytes are what describe the colour space), so on
    /// encode we always write the literal `"ICC Profile"`. The source
    /// keyword is not threaded through `Decoded`.
    profile_name: [u8; 80],
    profile_len: usize,
    profile: *mut u8,
}

#[repr(C)]
struct Ihdr {
    width: u32,
    height: u32,
    bit_depth: u8,
    color_type: u8,
    compression_method: u8,
    filter_method: u8,
    interlace_method: u8,
}

impl Default for Ihdr {
    fn default() -> Self {
        Self {
            width: 0,
            height: 0,
            bit_depth: 0,
            color_type: 0,
            compression_method: 0,
            filter_method: 0,
            interlace_method: 0,
        }
    }
}

const SPNG_CTX_ENCODER: c_int = 2;
const SPNG_FMT_RGBA8: c_int = 1;
const SPNG_FMT_PNG: c_int = 256;
const SPNG_DECODE_TRNS: c_int = 1; // apply tRNS chunk so paletted/grey get real alpha
const SPNG_ENCODE_FINALIZE: c_int = 2;
// spng_option enum
const SPNG_IMG_COMPRESSION_LEVEL: c_int = 2;
const SPNG_ENCODE_TO_BUFFER: c_int = 12;
const SPNG_COLOR_TYPE_INDEXED: u8 = 3;
const SPNG_COLOR_TYPE_TRUECOLOR_ALPHA: u8 = 6;

#[repr(C)]
struct Plte {
    n_entries: u32,
    entries: [[u8; 4]; 256], // r,g,b,alpha(reserved)
}

#[repr(C)]
struct Trns {
    gray: u16,
    red: u16,
    green: u16,
    blue: u16,
    n_type3_entries: u32,
    type3_alpha: [u8; 256],
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    // SAFETY: spng_ctx_new is safe to call with any flags; null return = OOM.
    let ctx = unsafe { spng_ctx_new(0) };
    if ctx.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    let _ctx_guard = scopeguard::guard(ctx, |c| {
        // SAFETY: ctx was returned non-null by spng_ctx_new and is freed exactly once here.
        unsafe { spng_ctx_free(c) }
    });

    // SAFETY: ctx is valid; bytes outlives the ctx (freed at end of scope).
    if unsafe { spng_set_png_buffer(ctx, bytes.as_ptr(), bytes.len()) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    // SAFETY: all-zero is a valid Ihdr (POD, no NonNull/NonZero/enum fields).
    let mut ihdr: Ihdr = unsafe { core::mem::zeroed() };
    // SAFETY: ctx is valid; ihdr is a valid out-ptr.
    if unsafe { spng_get_ihdr(ctx, &mut ihdr) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    codecs::guard(ihdr.width, ihdr.height, max_pixels)?;
    let mut size: usize = 0;
    // SAFETY: ctx is valid; size is a valid out-ptr.
    if unsafe { spng_decoded_image_size(ctx, SPNG_FMT_RGBA8, &mut size) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    let mut out = vec![0u8; size].into_boxed_slice();
    // SAFETY: ctx is valid; out is a valid mutable buffer of `size` bytes.
    if unsafe { spng_decode_image(ctx, out.as_mut_ptr(), out.len(), SPNG_FMT_RGBA8, SPNG_DECODE_TRNS) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }

    // iCCP after decode so the chunk has definitely been parsed. A non-zero
    // return here means "no iCCP" or "iCCP was malformed" — treat both as
    // the no-profile case; the pixels are still valid RGBA. `profile` is
    // context-owned memory, so copy it out before `spng_ctx_free` runs at
    // function exit. Propagate OutOfMemory on allocator failure rather
    // than silently degrading colour fidelity — the pixels may be Display
    // P3 / Adobe RGB / XYB, and a "no profile" result there is a visible
    // colour shift, which is the exact bug #30197 is about.
    // SAFETY: all-zero is a valid Iccp (POD; null profile ptr is the "no profile" state).
    let mut iccp: Iccp = unsafe { core::mem::zeroed() };
    // SAFETY: ctx is valid; iccp is a valid out-ptr.
    let icc: Option<Box<[u8]>> = if unsafe { spng_get_iccp(ctx, &mut iccp) } == 0
        && iccp.profile_len > 0
        && !iccp.profile.is_null()
    {
        // SAFETY: libspng guarantees profile points to profile_len bytes owned by ctx.
        Some(Box::<[u8]>::from(unsafe {
            core::slice::from_raw_parts(iccp.profile, iccp.profile_len)
        }))
    } else {
        None
    };
    Ok(codecs::Decoded { rgba: out, width: ihdr.width, height: ihdr.height, icc_profile: icc })
}

/// Attach `icc_profile` to the encoder as an iCCP chunk. libspng requires
/// `profile_name` non-empty (1-79 Latin-1 chars + NUL) and will deflate the
/// profile payload into the chunk itself. The PNG spec marks the keyword as
/// purely informational, so we write the literal `"ICC Profile"` always —
/// the colour-meaning payload is `p`. A malformed-profile return from
/// libspng drops the profile rather than failing the encode; a PNG without
/// an iCCP is still valid (implicitly sRGB). Called from both truecolour
/// `encode()` and indexed `encode_indexed()` — the PNG spec applies iCCP to
/// every colour type (indexed-colour palettes live in the source space
/// too, so dropping the profile there would silently reinterpret them as
/// sRGB, same bug #30197 was filed for).
fn embed_iccp(ctx: *mut spng_ctx, icc_profile: Option<&[u8]>) {
    let Some(p) = icc_profile else { return };
    if p.is_empty() {
        return;
    }
    let mut iccp = Iccp {
        profile_name: [0u8; 80],
        profile_len: p.len(),
        // `profile` is `char*` in libspng; the library reads-only during
        // encode when `user.iccp = 1` (set by spng_set_iccp). Const-cast
        // to fit the extern-struct field type without duping.
        profile: p.as_ptr() as *mut u8,
    };
    let name = b"ICC Profile";
    iccp.profile_name[..name.len()].copy_from_slice(name);
    // SAFETY: ctx is valid; iccp is fully initialised; libspng only reads from it.
    let _ = unsafe { spng_set_iccp(ctx, &iccp) };
}

pub fn encode(rgba: &[u8], w: u32, h: u32, level: i8, icc_profile: Option<&[u8]>) -> Result<codecs::Encoded, codecs::Error> {
    // SAFETY: spng_ctx_new is safe to call; null return = OOM.
    let ctx = unsafe { spng_ctx_new(SPNG_CTX_ENCODER) };
    if ctx.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    let _ctx_guard = scopeguard::guard(ctx, |c| {
        // SAFETY: ctx was returned non-null by spng_ctx_new and is freed exactly once here.
        unsafe { spng_ctx_free(c) }
    });

    // SAFETY: ctx is valid.
    let _ = unsafe { spng_set_option(ctx, SPNG_ENCODE_TO_BUFFER, 1) };
    if level >= 0 {
        // SAFETY: ctx is valid.
        let _ = unsafe { spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, c_int::from(level.min(9))) };
    }
    let ihdr = Ihdr {
        width: w,
        height: h,
        bit_depth: 8,
        color_type: SPNG_COLOR_TYPE_TRUECOLOR_ALPHA,
        ..Default::default()
    };
    // SAFETY: ctx is valid; ihdr is fully initialised.
    if unsafe { spng_set_ihdr(ctx, &ihdr) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    embed_iccp(ctx, icc_profile);
    // SAFETY: ctx is valid; rgba is a valid readable buffer.
    if unsafe { spng_encode_image(ctx, rgba.as_ptr(), rgba.len(), SPNG_FMT_PNG, SPNG_ENCODE_FINALIZE) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    let mut len: usize = 0;
    let mut err: c_int = 0;
    // SAFETY: ctx is valid; len/err are valid out-ptrs.
    let buf = unsafe { spng_get_png_buffer(ctx, &mut len, &mut err) };
    if buf.is_null() {
        return Err(codecs::Error::EncodeFailed);
    }
    // spng_get_png_buffer transfers ownership (libc malloc); hand to JS
    // with libc `free` as the finalizer instead of duping.
    // SAFETY: buf is non-null and points to `len` bytes owned by us (malloc'd by libspng).
    Ok(codecs::Encoded {
        bytes: unsafe { core::slice::from_raw_parts_mut(buf, len) },
        free: codecs::Encoded::wrap(libc::free as unsafe extern "C" fn(*mut c_void)),
    })
}

/// Quantize RGBA to ≤ `colors` and emit an indexed (colour-type 3) PNG
/// with PLTE + tRNS. The quantizer is a small median-cut — see
/// quantize.rs. `icc_profile` carries the source colour space; median
/// cut operates on the raw RGB numbers without converting colour spaces,
/// so the palette entries are still in that space and need the profile
/// to be interpreted correctly — same contract as truecolour encode.
pub fn encode_indexed(
    rgba: &[u8],
    w: u32,
    h: u32,
    level: i8,
    colors: u16,
    dither: bool,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    let q = quantize::quantize(rgba, w, h, quantize::Options { max_colors: colors, dither })?;

    // SAFETY: spng_ctx_new is safe to call; null return = OOM.
    let ctx = unsafe { spng_ctx_new(SPNG_CTX_ENCODER) };
    if ctx.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    let _ctx_guard = scopeguard::guard(ctx, |c| {
        // SAFETY: ctx was returned non-null by spng_ctx_new and is freed exactly once here.
        unsafe { spng_ctx_free(c) }
    });

    // SAFETY: ctx is valid.
    let _ = unsafe { spng_set_option(ctx, SPNG_ENCODE_TO_BUFFER, 1) };
    if level >= 0 {
        // SAFETY: ctx is valid.
        let _ = unsafe { spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, c_int::from(level.min(9))) };
    }

    let ihdr = Ihdr {
        width: w,
        height: h,
        bit_depth: 8,
        color_type: SPNG_COLOR_TYPE_INDEXED,
        ..Default::default()
    };
    // SAFETY: ctx is valid; ihdr is fully initialised.
    if unsafe { spng_set_ihdr(ctx, &ihdr) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    embed_iccp(ctx, icc_profile);

    let mut plte = Plte { n_entries: q.colors, entries: [[0u8; 4]; 256] };
    let mut trns = Trns {
        gray: 0,
        red: 0,
        green: 0,
        blue: 0,
        n_type3_entries: q.colors,
        type3_alpha: [0u8; 256],
    };
    for i in 0..(q.colors as usize) {
        plte.entries[i] = [q.palette[i * 4], q.palette[i * 4 + 1], q.palette[i * 4 + 2], 255];
        trns.type3_alpha[i] = q.palette[i * 4 + 3];
    }
    // SAFETY: ctx is valid; plte is fully initialised.
    if unsafe { spng_set_plte(ctx, &plte) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: ctx is valid; trns is fully initialised.
    if q.has_alpha && unsafe { spng_set_trns(ctx, &trns) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }

    // SAFETY: ctx is valid; q.indices is a valid readable buffer.
    if unsafe { spng_encode_image(ctx, q.indices.as_ptr(), q.indices.len(), SPNG_FMT_PNG, SPNG_ENCODE_FINALIZE) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }

    let mut len: usize = 0;
    let mut err: c_int = 0;
    // SAFETY: ctx is valid; len/err are valid out-ptrs.
    let buf = unsafe { spng_get_png_buffer(ctx, &mut len, &mut err) };
    if buf.is_null() {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: buf is non-null and points to `len` bytes owned by us (malloc'd by libspng).
    Ok(codecs::Encoded {
        bytes: unsafe { core::slice::from_raw_parts_mut(buf, len) },
        free: codecs::Encoded::wrap(libc::free as unsafe extern "C" fn(*mut c_void)),
    })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/codec_png.zig (197 lines)
//   confidence: medium
//   todos:      1
//   notes:      codecs::Encoded.bytes/free shape and quantize::Options name guessed; spng externs need a *_sys crate
// ──────────────────────────────────────────────────────────────────────────
