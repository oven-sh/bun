//! PNG for `Bun.Image`. Decode and truecolour encode go through the `png`
//! crate (image-png, Chromium's PNG codec since M139); indexed encode stays
//! on libspng and quantises via `quantize.rs`. Dispatch lives in codecs.rs.

use core::ffi::c_int;
use core::ptr::NonNull;

use super::codecs;
use super::quantize;
use crate::encoded_wrap_free;

bun_opaque::opaque_ffi! { pub struct spng_ctx; }

unsafe extern "C" {
    fn spng_ctx_new(flags: c_int) -> *mut spng_ctx;
    fn spng_ctx_free(ctx: *mut spng_ctx);
    fn spng_set_ihdr(ctx: *mut spng_ctx, ihdr: *const Ihdr) -> c_int;
    fn spng_set_plte(ctx: *mut spng_ctx, plte: *const Plte) -> c_int;
    fn spng_set_trns(ctx: *mut spng_ctx, trns: *const Trns) -> c_int;
    fn spng_encode_image(
        ctx: *mut spng_ctx,
        img: *const u8,
        len: usize,
        fmt: c_int,
        flags: c_int,
    ) -> c_int;
    fn spng_get_png_buffer(ctx: *mut spng_ctx, len: *mut usize, err: *mut c_int) -> *mut u8;
    fn spng_set_option(ctx: *mut spng_ctx, opt: c_int, value: c_int) -> c_int;
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
const SPNG_FMT_PNG: c_int = 256;
const SPNG_ENCODE_FINALIZE: c_int = 2;
// spng_option enum
const SPNG_IMG_COMPRESSION_LEVEL: c_int = 2;
const SPNG_ENCODE_TO_BUFFER: c_int = 12;
const SPNG_COLOR_TYPE_INDEXED: u8 = 3;

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

/// One decoded row in the crate's output layout → RGBA8. EXPAND has already
/// applied palettes, sub-byte depths and tRNS, so only these four remain.
fn widen_row(color: ::png::ColorType, src: &[u8], dst: &mut [u8]) -> Result<(), codecs::Error> {
    let px = dst.as_chunks_mut::<4>().0.iter_mut();
    match color {
        ::png::ColorType::Rgba => dst.copy_from_slice(src),
        ::png::ColorType::Rgb => {
            for (o, i) in px.zip(src.as_chunks::<3>().0) {
                *o = [i[0], i[1], i[2], 255];
            }
        }
        ::png::ColorType::GrayscaleAlpha => {
            for (o, i) in px.zip(src.as_chunks::<2>().0) {
                *o = [i[0], i[0], i[0], i[1]];
            }
        }
        ::png::ColorType::Grayscale => {
            for (o, &g) in px.zip(src) {
                *o = [g, g, g, 255];
            }
        }
        ::png::ColorType::Indexed => return Err(codecs::Error::DecodeFailed),
    }
    Ok(())
}

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let mut decoder = ::png::Decoder::new(std::io::Cursor::new(bytes));
    // Skip adler32 and chunk-CRC verification (as libvips and stb_image do); they only cost decode time.
    decoder.ignore_checksums(true);
    // iCCP may inflate to at most the size of the largest RGBA buffer allowed, but never less than
    // libpng's default of 8 MB, so a small `maxPixels` still takes any usual profile (#46270). The
    // crate keeps one budget for everything it allocates, so it also covers the one output row it
    // reserves: at most 8 bytes per pixel of the IHDR width (16-bit RGBA).
    let max_inflated = max_pixels.saturating_mul(4).clamp(8 << 20, i32::MAX as u64);
    let width = bytes.get(16..20).and_then(|b| b.try_into().ok()).map_or(0, u32::from_be_bytes);
    decoder.set_limits(::png::Limits {
        bytes: usize::try_from(max_inflated + u64::from(width) * 8).unwrap_or(usize::MAX),
    });
    // ALPHA only for palettes (IHDR colour type, byte 25): on RGB the crate's generic alpha fill ran 0.89x libspng.
    let mut transform = ::png::Transformations::EXPAND | ::png::Transformations::STRIP_16;
    if bytes.get(25) == Some(&3) {
        transform |= ::png::Transformations::ALPHA;
    }
    decoder.set_transformations(transform);
    let mut reader = decoder.read_info().map_err(|_| codecs::Error::DecodeFailed)?;
    let (width, height) = (reader.info().width, reader.info().height);
    codecs::guard(width, height, max_pixels)?;
    let icc_profile = reader.info().icc_profile.as_deref().map(<[u8]>::to_vec);
    let (color, depth) = reader.output_color_type();
    if depth != ::png::BitDepth::Eight {
        return Err(codecs::Error::DecodeFailed);
    }

    let stride = (width as usize) * 4;
    let mut rgba = vec![0u8; stride * (height as usize)];
    if color == ::png::ColorType::Rgba {
        reader.next_frame(&mut rgba).map_err(|_| codecs::Error::DecodeFailed)?;
    } else if reader.info().interlaced {
        // Adam7 passes only assemble in a whole frame.
        let size = reader.output_buffer_size().ok_or(codecs::Error::DecodeFailed)?;
        let mut frame = vec![0u8; size];
        let out = reader.next_frame(&mut frame).map_err(|_| codecs::Error::DecodeFailed)?;
        for (dst, src) in rgba.chunks_exact_mut(stride).zip(frame.chunks_exact(out.line_size)) {
            widen_row(color, src, dst)?;
        }
    } else {
        for dst in rgba.chunks_exact_mut(stride) {
            let row = reader
                .next_row()
                .map_err(|_| codecs::Error::DecodeFailed)?
                .ok_or(codecs::Error::DecodeFailed)?;
            widen_row(color, row.data(), dst)?;
        }
    }
    Ok(codecs::Decoded {
        rgba,
        width,
        height,
        icc_profile,
    })
}

/// Attach `icc_profile` to the encoder as an iCCP chunk. libspng requires
/// `profile_name` non-empty (1-79 Latin-1 chars + NUL) and will deflate the
/// profile payload into the chunk itself. The PNG spec marks the keyword as
/// purely informational, so we write the literal `"ICC Profile"` always —
/// the colour-meaning payload is `p`. A malformed-profile return from
/// libspng drops the profile rather than failing the encode; a PNG without
/// an iCCP is still valid (implicitly sRGB). Indexed palettes live in the
/// source space too, so dropping the profile there would silently
/// reinterpret them as sRGB, same bug #30197 was filed for.
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
        profile: p.as_ptr().cast_mut(),
    };
    let name = b"ICC Profile";
    iccp.profile_name[..name.len()].copy_from_slice(name);
    // SAFETY: ctx is valid; iccp is fully initialised; libspng only reads from it.
    let _ = unsafe { spng_set_iccp(ctx, &raw const iccp) };
}

/// `level` is zlib's 0-9, or -1 for the default (6, as libspng used).
pub(crate) fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    level: i8,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    let mut info = ::png::Info::with_size(w, h);
    info.color_type = ::png::ColorType::Rgba;
    info.bit_depth = ::png::BitDepth::Eight;
    info.icc_profile = icc_profile.filter(|p| !p.is_empty()).map(Into::into);
    let mut out: Vec<u8> = Vec::with_capacity(rgba.len() / 4);
    {
        let mut encoder =
            ::png::Encoder::with_info(&mut out, info).map_err(|_| codecs::Error::EncodeFailed)?;
        match level {
            0 => encoder.set_deflate_compression(::png::DeflateCompression::NoCompression),
            l => {
                let l = if l < 0 { 6 } else { l.min(9) as u8 };
                encoder.set_deflate_compression(::png::DeflateCompression::Level(l));
                encoder.set_filter(::png::Filter::Adaptive);
            }
        }
        let mut writer = encoder.write_header().map_err(|_| codecs::Error::EncodeFailed)?;
        writer
            .write_image_data(rgba)
            .map_err(|_| codecs::Error::EncodeFailed)?;
        writer.finish().map_err(|_| codecs::Error::EncodeFailed)?;
    }
    out.shrink_to_fit();
    Ok(codecs::Encoded::from_owned(out))
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
        let _ =
            unsafe { spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, c_int::from(level.min(9))) };
    }

    let ihdr = Ihdr {
        width: w,
        height: h,
        bit_depth: 8,
        color_type: SPNG_COLOR_TYPE_INDEXED,
        ..Default::default()
    };
    // SAFETY: ctx is valid; ihdr is fully initialised.
    if unsafe { spng_set_ihdr(ctx, &raw const ihdr) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    embed_iccp(ctx, icc_profile);

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
    // SAFETY: ctx is valid; plte is fully initialised.
    if unsafe { spng_set_plte(ctx, &raw const plte) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: ctx is valid; trns is fully initialised.
    if q.has_alpha && unsafe { spng_set_trns(ctx, &raw const trns) } != 0 {
        return Err(codecs::Error::EncodeFailed);
    }

    // SAFETY: ctx is valid; q.indices is a valid readable buffer.
    if unsafe {
        spng_encode_image(
            ctx,
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
    // SAFETY: ctx is valid; len/err are valid out-ptrs.
    let buf = unsafe { spng_get_png_buffer(ctx, &raw mut len, &raw mut err) };
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
