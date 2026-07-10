//! libspng decode/encode for `Bun.Image`. Indexed-PNG encode quantises via
//! `quantize.rs`. Dispatch lives in codecs.rs; this file is the codec body.

use core::ffi::c_int;
use core::ptr::NonNull;

use super::codecs;
use super::quantize;
use crate::encoded_wrap_free;

/// The C object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`spng_ctx`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// libspng's `spng_ctx`. `&Self` is ABI-identical to a non-null
        /// `spng_ctx *` and carries no `noalias`/`readonly` — libspng mutates
        /// the context's parse/encode state through it on every call.
        pub struct spng_ctx;
    }
}

unsafe extern "C" {
    fn spng_ctx_new(flags: c_int) -> *mut sys::spng_ctx;
    // NOT `safe fn`: this deallocates. A `safe fn` taking `&sys::spng_ctx` would
    // let safe code free a context the handle still owns. Reached only through
    // `spng_ctx_free_release`, below.
    fn spng_ctx_free(ctx: *mut sys::spng_ctx);
    fn spng_set_png_buffer(ctx: &sys::spng_ctx, buf: *const u8, len: usize) -> c_int;
    fn spng_decoded_image_size(ctx: &sys::spng_ctx, fmt: c_int, out: *mut usize) -> c_int;
    fn spng_decode_image(
        ctx: &sys::spng_ctx,
        out: *mut u8,
        len: usize,
        fmt: c_int,
        flags: c_int,
    ) -> c_int;
    fn spng_get_ihdr(ctx: &sys::spng_ctx, ihdr: *mut Ihdr) -> c_int;
    fn spng_set_ihdr(ctx: &sys::spng_ctx, ihdr: *const Ihdr) -> c_int;
    fn spng_set_plte(ctx: &sys::spng_ctx, plte: *const Plte) -> c_int;
    fn spng_set_trns(ctx: &sys::spng_ctx, trns: *const Trns) -> c_int;
    fn spng_encode_image(
        ctx: &sys::spng_ctx,
        img: *const u8,
        len: usize,
        fmt: c_int,
        flags: c_int,
    ) -> c_int;
    fn spng_get_png_buffer(ctx: &sys::spng_ctx, len: *mut usize, err: *mut c_int) -> *mut u8;
    // safe: the handle plus scalars; libspng only stores the option value.
    safe fn spng_set_option(ctx: &sys::spng_ctx, opt: c_int, value: c_int) -> c_int;
    /// iCCP chunk read/write — PNG carries an optional ICC profile alongside
    /// the pixels for every colour type (including indexed). `spng_get_iccp`
    /// returns non-zero when the source has no iCCP (or the chunk was
    /// malformed); we treat all non-zero returns the same way — drop the
    /// profile — because the pixels are still valid and a PNG without iCCP
    /// is still a valid PNG. The `profile` pointer it hands back is owned by
    /// the context and freed when the owning [`spng_ctx`] handle drops; dupe
    /// out before then.
    fn spng_get_iccp(ctx: &sys::spng_ctx, iccp: *mut Iccp) -> c_int;
    fn spng_set_iccp(ctx: &sys::spng_ctx, iccp: *const Iccp) -> c_int;
}

/// `ForeignOwned::release` hands us `&sys::spng_ctx`; libspng's destructor takes
/// `spng_ctx *`. `as_mut_ptr` is the sanctioned interior-mutability route to it.
fn spng_ctx_free_release(ctx: &sys::spng_ctx) {
    // SAFETY: reached only from `ForeignRef::drop`, which owns the sole allocation
    // `spng_ctx_new` returned and gives it back exactly once.
    unsafe { spng_ctx_free(ctx.as_mut_ptr()) }
}

// `spng_ctx_new` calloc's a fresh context and hands Rust the allocation. There
// is no refcount: `spng_ctx_free` unconditionally destroys the object, so one
// `spng_ctx` handle owns exactly that one allocation.
bun_opaque::foreign_handle! {
    /// Owned handle to a libspng `spng_ctx`; `Drop` frees it.
    ///
    /// Every method takes `&self`: `sys::spng_ctx` is `UnsafeCell`-backed, so a
    /// `&` carries no `noalias`/`readonly` and libspng mutates the context
    /// through it on every call — including the ones C spells as taking a
    /// non-const `spng_ctx *`.
    pub struct spng_ctx(sys::spng_ctx) via spng_ctx_free_release;
}

impl spng_ctx {
    /// Allocate a context: `0` for a decoder, `SPNG_CTX_ENCODER` for an
    /// encoder. `None` on allocation failure.
    fn new(flags: c_int) -> Option<Self> {
        // SAFETY: `spng_ctx_new` either returns null — for unrecognised flags,
        // or because its `calloc` failed, in which case nothing was allocated
        // and nothing needs freeing — or a fresh `calloc`'d context whose sole
        // ownership unit it transfers to the caller. It frees nothing on any
        // path, so no other handle can give this unit back.
        unsafe { Self::adopt_ptr(spng_ctx_new(flags)) }
    }
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
#[derive(Default)]
struct Ihdr {
    width: u32,
    height: u32,
    bit_depth: u8,
    color_type: u8,
    compression_method: u8,
    filter_method: u8,
    interlace_method: u8,
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
    let ctx = spng_ctx::new(0).ok_or(codecs::Error::OutOfMemory)?;

    // SAFETY: bytes outlives the ctx (dropped at end of scope).
    if unsafe { spng_set_png_buffer(ctx.raw(), bytes.as_ptr(), bytes.len()) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    let mut ihdr = Ihdr::default();
    // SAFETY: ihdr is a valid out-ptr.
    if unsafe { spng_get_ihdr(ctx.raw(), &raw mut ihdr) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    codecs::guard(ihdr.width, ihdr.height, max_pixels)?;
    let mut size: usize = 0;
    // SAFETY: size is a valid out-ptr.
    if unsafe { spng_decoded_image_size(ctx.raw(), SPNG_FMT_RGBA8, &raw mut size) } != 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    let mut out = vec![0u8; size];
    // SAFETY: out is a valid mutable buffer of `size` bytes.
    if unsafe {
        spng_decode_image(
            ctx.raw(),
            out.as_mut_ptr(),
            out.len(),
            SPNG_FMT_RGBA8,
            SPNG_DECODE_TRNS,
        )
    } != 0
    {
        return Err(codecs::Error::DecodeFailed);
    }

    // iCCP after decode so the chunk has definitely been parsed. A non-zero
    // return here means "no iCCP" or "iCCP was malformed" — treat both as
    // the no-profile case; the pixels are still valid RGBA. `profile` is
    // context-owned memory, so copy it out before `ctx` drops at function
    // exit. Propagate OutOfMemory on allocator failure rather
    // than silently degrading colour fidelity — the pixels may be Display
    // P3 / Adobe RGB / XYB, and a "no profile" result there is a visible
    // colour shift, which is the exact bug #30197 is about.
    // SAFETY: all-zero is a valid Iccp (POD; null profile ptr is the "no profile" state).
    let mut iccp: Iccp = unsafe { bun_core::ffi::zeroed_unchecked() };
    // SAFETY: iccp is a valid out-ptr.
    let icc: Option<Vec<u8>> = if unsafe { spng_get_iccp(ctx.raw(), &raw mut iccp) } == 0
        && iccp.profile_len > 0
        && !iccp.profile.is_null()
    {
        // SAFETY: libspng guarantees profile points to profile_len bytes owned by ctx.
        Some(unsafe { core::slice::from_raw_parts(iccp.profile, iccp.profile_len) }.to_vec())
    } else {
        None
    };
    Ok(codecs::Decoded {
        rgba: out,
        width: ihdr.width,
        height: ihdr.height,
        icc_profile: icc,
    })
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
fn embed_iccp(ctx: &spng_ctx, icc_profile: Option<&[u8]>) {
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
        profile: p.as_ptr().cast_mut(),
    };
    let name = b"ICC Profile";
    iccp.profile_name[..name.len()].copy_from_slice(name);
    // SAFETY: iccp is fully initialised; libspng only reads from it.
    let _ = unsafe { spng_set_iccp(ctx.raw(), &raw const iccp) };
}

pub(crate) fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    level: i8,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    let ctx = spng_ctx::new(SPNG_CTX_ENCODER).ok_or(codecs::Error::OutOfMemory)?;

    let _ = spng_set_option(ctx.raw(), SPNG_ENCODE_TO_BUFFER, 1);
    if level >= 0 {
        let _ = spng_set_option(
            ctx.raw(),
            SPNG_IMG_COMPRESSION_LEVEL,
            c_int::from(level.min(9)),
        );
    }
    let ihdr = Ihdr {
        width: w,
        height: h,
        bit_depth: 8,
        color_type: SPNG_COLOR_TYPE_TRUECOLOR_ALPHA,
        ..Default::default()
    };
    // SAFETY: ihdr is fully initialised; libspng only reads from it.
    if unsafe { spng_set_ihdr(ctx.raw(), &raw const ihdr) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    embed_iccp(&ctx, icc_profile);
    // SAFETY: rgba is a valid readable buffer.
    if unsafe {
        spng_encode_image(
            ctx.raw(),
            rgba.as_ptr(),
            rgba.len(),
            SPNG_FMT_PNG,
            SPNG_ENCODE_FINALIZE,
        )
    } != 0
    {
        return Err(codecs::Error::EncodeFailed);
    }
    let mut len: usize = 0;
    let mut err: c_int = 0;
    // SAFETY: len/err are valid out-ptrs.
    let buf = unsafe { spng_get_png_buffer(ctx.raw(), &raw mut len, &raw mut err) };
    if buf.is_null() {
        return Err(codecs::Error::EncodeFailed);
    }
    // spng_get_png_buffer transfers ownership (libc malloc); hand to JS
    // with libc `free` as the finalizer instead of duping.
    // SAFETY: buf is non-null and points to `len` bytes owned by us (malloc'd by libspng).
    let bytes = unsafe { NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(buf, len)) };
    Ok(codecs::Encoded {
        bytes,
        free: encoded_wrap_free!(libc::free),
    })
}

/// Quantize RGBA to ≤ `colors` and emit an indexed (colour-type 3) PNG
/// with PLTE + tRNS. The quantizer is a small median-cut — see
/// quantize.rs. `icc_profile` carries the source colour space; median
/// cut operates on the raw RGB numbers without converting colour spaces,
/// so the palette entries are still in that space and need the profile
/// to be interpreted correctly — same contract as truecolour encode.
pub(crate) fn encode_indexed(
    rgba: &[u8],
    w: u32,
    h: u32,
    level: i8,
    colors: u16,
    dither: bool,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    let q = quantize::quantize(
        rgba,
        w,
        h,
        quantize::Options {
            max_colors: colors,
            dither,
        },
    )
    .map_err(|_| codecs::Error::OutOfMemory)?;

    let ctx = spng_ctx::new(SPNG_CTX_ENCODER).ok_or(codecs::Error::OutOfMemory)?;

    let _ = spng_set_option(ctx.raw(), SPNG_ENCODE_TO_BUFFER, 1);
    if level >= 0 {
        let _ = spng_set_option(
            ctx.raw(),
            SPNG_IMG_COMPRESSION_LEVEL,
            c_int::from(level.min(9)),
        );
    }

    let ihdr = Ihdr {
        width: w,
        height: h,
        bit_depth: 8,
        color_type: SPNG_COLOR_TYPE_INDEXED,
        ..Default::default()
    };
    // SAFETY: ihdr is fully initialised; libspng only reads from it.
    if unsafe { spng_set_ihdr(ctx.raw(), &raw const ihdr) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    embed_iccp(&ctx, icc_profile);

    let mut plte = Plte {
        n_entries: u32::from(q.colors),
        entries: [[0u8; 4]; 256],
    };
    let mut trns = Trns {
        gray: 0,
        red: 0,
        green: 0,
        blue: 0,
        n_type3_entries: u32::from(q.colors),
        type3_alpha: [0u8; 256],
    };
    for i in 0..(q.colors as usize) {
        plte.entries[i] = [
            q.palette[i * 4],
            q.palette[i * 4 + 1],
            q.palette[i * 4 + 2],
            255,
        ];
        trns.type3_alpha[i] = q.palette[i * 4 + 3];
    }
    // SAFETY: plte is fully initialised; libspng only reads from it.
    if unsafe { spng_set_plte(ctx.raw(), &raw const plte) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: trns is fully initialised; libspng only reads from it.
    if q.has_alpha && unsafe { spng_set_trns(ctx.raw(), &raw const trns) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }

    // SAFETY: q.indices is a valid readable buffer.
    if unsafe {
        spng_encode_image(
            ctx.raw(),
            q.indices.as_ptr(),
            q.indices.len(),
            SPNG_FMT_PNG,
            SPNG_ENCODE_FINALIZE,
        )
    } != 0
    {
        return Err(codecs::Error::EncodeFailed);
    }

    let mut len: usize = 0;
    let mut err: c_int = 0;
    // SAFETY: len/err are valid out-ptrs.
    let buf = unsafe { spng_get_png_buffer(ctx.raw(), &raw mut len, &raw mut err) };
    if buf.is_null() {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: buf is non-null and points to `len` bytes owned by us (malloc'd by libspng).
    let bytes = unsafe { NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(buf, len)) };
    Ok(codecs::Encoded {
        bytes,
        free: encoded_wrap_free!(libc::free),
    })
}
