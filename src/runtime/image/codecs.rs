//! Thin Rust wrappers over the statically-linked image codecs and the
//! highway resize/rotate kernels. Everything works on RGBA8 — decoders are
//! told to emit RGBA, encoders are fed RGBA, so Image.rs never branches on
//! channel layout.
//!
//! Memory ownership: decode returns global-allocator-owned RGBA. Encode
//! returns `Encoded{bytes, free}` carrying the codec's own deallocator so the
//! JS layer can hand the buffer to `ArrayBuffer.toJSWithContext` without a
//! dupe — see `Encoded` below.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

// Per-format implementations live in their own files; codecs.rs is the
// dispatch surface only.
pub use super::codec_bmp as bmp;
pub use super::codec_gif as gif;
pub use super::codec_jpeg as jpeg;
pub use super::codec_png as png;
pub use super::codec_webp as webp;

#[cfg(target_os = "macos")]
pub use super::backend_coregraphics as system_backend;
#[cfg(windows)]
pub use super::backend_wic as system_backend;

/// `true` on platforms where `system_backend` is present.
pub(crate) const HAS_SYSTEM_BACKEND: bool = cfg!(any(target_os = "macos", windows));

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
#[strum(serialize_all = "lowercase")]
pub enum Backend {
    System = 0,
    Bun = 1,
}
// PORT NOTE: `Backend.Map = bun.ComptimeEnumMap(Backend)` → phf map keyed by lowercase variant name.
pub(crate) static BACKEND_MAP: phf::Map<&'static [u8], Backend> = phf::phf_map! {
    b"system" => Backend::System,
    b"bun" => Backend::Bun,
};

impl bun_jsc::FromJsEnum for Backend {
    fn from_js_value(
        v: bun_jsc::JSValue,
        global: &bun_jsc::JSGlobalObject,
        property_name: &'static str,
    ) -> bun_jsc::JsResult<Self> {
        v.to_enum_from_map(global, property_name, &BACKEND_MAP, "'system' or 'bun'")
    }
}

// PORT NOTE: Zig `pub var backend` is read from WorkPool threads + written from JS;
// "torn read of a 1-byte enum is fine" → relaxed atomic is the safe-Rust spelling.
pub(crate) static BACKEND: core::sync::atomic::AtomicU8 =
    core::sync::atomic::AtomicU8::new(if HAS_SYSTEM_BACKEND {
        Backend::System as u8
    } else {
        Backend::Bun as u8
    });

#[cfg(any(target_os = "macos", windows))]
#[inline]
fn use_system() -> bool {
    BACKEND.load(core::sync::atomic::Ordering::Relaxed) == Backend::System as u8
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Format {
    Jpeg,
    Png,
    Webp,
    /// System-backend-only on macOS/Windows; no static codec.
    Heic,
    /// System-backend-only on macOS/Windows; no static codec.
    Avif,
    /// Decode-only. Static `BI_RGB`/`BI_BITFIELDS` parser everywhere; the
    /// system backend is tried first (covers RLE/JPEG-in-BMP). The Windows
    /// clipboard's `CF_DIB`/`CF_DIBV5` is exactly this.
    Bmp,
    /// Decode-only via system backend (ImageIO/WIC); no static codec.
    /// macOS pasteboard's preferred representation for screenshots.
    Tiff,
    /// Decode-only, first frame. Static LZW decoder everywhere; system
    /// backend tried first (handles disposal/animation we don't).
    Gif,
}

impl Format {
    pub(crate) fn sniff(bytes: &[u8]) -> Option<Format> {
        if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
            return Some(Format::Jpeg);
        }
        if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
            return Some(Format::Png);
        }
        if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            return Some(Format::Webp);
        }
        if bytes.len() >= 2 && bytes[0] == b'B' && bytes[1] == b'M' {
            return Some(Format::Bmp);
        }
        if bytes.len() >= 4 && (&bytes[0..4] == b"II*\x00" || &bytes[0..4] == b"MM\x00*") {
            return Some(Format::Tiff);
        }
        if bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a") {
            return Some(Format::Gif);
        }
        if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
            let box_: usize = bytes.len().min(16usize.max(u32::from_be_bytes(
                bytes[0..4].try_into().expect("infallible: size matches"),
            ) as usize));
            let mut miaf = false;
            let mut off: usize = 8;
            while off + 4 <= box_ {
                if off == 12 {
                    off += 4;
                    continue; // minor_version
                }
                let b = &bytes[off..off + 4];
                if b == b"avif" || b == b"avis" {
                    return Some(Format::Avif);
                }
                if b == b"heic" || b == b"heix" || b == b"hevc" || b == b"hevx" {
                    return Some(Format::Heic);
                }
                if b == b"mif1" || b == b"msf1" {
                    miaf = true;
                }
                off += 4;
            }
            if miaf {
                return Some(Format::Heic); // MIAF with no codec brand → assume HEVC
            }
        }
        None
    }

    /// Best-effort extension → format for `.write(path)`'s default. Only the
    /// final dotted segment is considered; case-insensitive. Returns `None`
    /// when there's no extension or it's not one we recognise.
    pub(crate) fn from_extension(path: &[u8]) -> Option<Format> {
        let dot = path.iter().rposition(|&b| b == b'.')?;
        let mut buf = [0u8; 5];
        let src = &path[dot + 1..];
        let n = src.len().min(buf.len());
        buf[..n].copy_from_slice(&src[..n]);
        for b in &mut buf[..n] {
            b.make_ascii_lowercase();
        }
        EXT_MAP.get(&buf[..n]).copied()
    }

    pub(crate) fn mime(self) -> &'static bun_core::ZStr {
        match self {
            Format::Jpeg => bun_core::zstr!("image/jpeg"),
            Format::Png => bun_core::zstr!("image/png"),
            Format::Webp => bun_core::zstr!("image/webp"),
            Format::Heic => bun_core::zstr!("image/heic"),
            Format::Avif => bun_core::zstr!("image/avif"),
            Format::Bmp => bun_core::zstr!("image/bmp"),
            Format::Tiff => bun_core::zstr!("image/tiff"),
            Format::Gif => bun_core::zstr!("image/gif"),
        }
    }
}

static EXT_MAP: phf::Map<&'static [u8], Format> = phf::phf_map! {
    b"jpg" => Format::Jpeg,  b"jpeg" => Format::Jpeg, b"png" => Format::Png,
    b"webp" => Format::Webp, b"heic" => Format::Heic, b"heif" => Format::Heic,
    b"avif" => Format::Avif, b"bmp" => Format::Bmp,   b"gif" => Format::Gif,
    b"tif" => Format::Tiff,  b"tiff" => Format::Tiff,
};

#[derive(Default)]
pub struct Decoded {
    pub rgba: Vec<u8>, // global allocator (mimalloc)
    pub width: u32,
    pub height: u32,
    pub icc_profile: Option<Vec<u8>>,
}
// PORT NOTE: `deinit` only freed owned fields → Drop is automatic via Vec/Option<Vec>.

#[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum Error {
    #[error("UnknownFormat")]
    UnknownFormat,
    #[error("DecodeFailed")]
    DecodeFailed,
    #[error("EncodeFailed")]
    EncodeFailed,
    /// width × height exceeds the caller's `max_pixels` guard. This is the
    /// decompression-bomb defence — checked AFTER reading the header but
    /// BEFORE allocating the full RGBA buffer.
    #[error("TooManyPixels")]
    TooManyPixels,
    /// HEIC/AVIF on a platform with no system backend (Linux), or the system
    /// backend declined and there's no static codec to fall back to.
    #[error("UnsupportedOnPlatform")]
    UnsupportedOnPlatform,
    #[error("OutOfMemory")]
    OutOfMemory,
}

bun_core::named_error_set!(Error);

bun_core::oom_from_alloc!(Error);

/// Sharp's default: 0x3FFF * 0x3FFF ≈ 268 MP. A single RGBA8 frame at this
/// cap is ~1 GiB, which is already past where you'd want to be.
pub(crate) const DEFAULT_MAX_PIXELS: u64 = 0x3FFF * 0x3FFF;

#[derive(Copy, Clone, Default)]
pub struct DecodeHint {
    /// Final output dims (after rotate). 0 = "no resize, full decode".
    pub target_w: u32,
    pub target_h: u32,
}

pub fn decode(bytes: &[u8], max_pixels: u64, hint: DecodeHint) -> Result<Decoded, Error> {
    let fmt = Format::sniff(bytes).ok_or(Error::UnknownFormat)?;
    match fmt {
        Format::Jpeg => jpeg::decode(bytes, max_pixels, hint),
        Format::Png => png::decode(bytes, max_pixels),
        Format::Webp => webp::decode(bytes, max_pixels),
        Format::Heic | Format::Avif | Format::Tiff => match decode_via_system(bytes, max_pixels)? {
            Some(d) => Ok(d),
            None => Err(Error::UnsupportedOnPlatform),
        },
        // BMP/GIF have static decoders so Linux (and `backend == .bun`) work;
        // the system backend is tried first because ImageIO/WIC handle the
        // long tail (RLE BMP, animated GIF disposal, etc.) we don't.
        Format::Bmp => match decode_via_system(bytes, max_pixels)? {
            Some(d) => Ok(d),
            None => bmp::decode(bytes, max_pixels),
        },
        Format::Gif => {
            let mut d = match decode_via_system(bytes, max_pixels)? {
                Some(d) => d,
                None => gif::decode(bytes, max_pixels)?,
            };
            for px in d.rgba.chunks_exact_mut(4) {
                if px[3] == 0 {
                    px[0] = 0;
                    px[1] = 0;
                    px[2] = 0;
                }
            }
            Ok(d)
        }
    }
}

// PORT NOTE: Zig returned `(Error || error{BackendUnavailable})!Decoded`;
// reshaped to `Result<Option<Decoded>, Error>` where `Ok(None)` = BackendUnavailable.
fn decode_via_system(_bytes: &[u8], _max_pixels: u64) -> Result<Option<Decoded>, Error> {
    #[cfg(any(target_os = "macos", windows))]
    if use_system() {
        return system_backend::BackendError::split(system_backend::decode(_bytes, _max_pixels));
    }
    Ok(None)
}

#[inline]
pub(crate) fn guard(w: u32, h: u32, max_pixels: u64) -> Result<(), Error> {
    // u64 mul cannot overflow from two u32 factors.
    if (w as u64) * (h as u64) > max_pixels {
        return Err(Error::TooManyPixels);
    }
    Ok(())
}

pub(crate) struct Probe {
    pub format: Format,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn probe(bytes: &[u8], max_pixels: u64) -> Result<Probe, Error> {
    let fmt = Format::sniff(bytes).ok_or(Error::UnknownFormat)?;
    let w: u32;
    let h: u32;
    match fmt {
        Format::Png => {
            // sig(8) · IHDR{len(4) type(4) w(4) h(4) ...}
            if bytes.len() < 24 {
                return Err(Error::DecodeFailed);
            }
            w = u32::from_be_bytes(bytes[16..20].try_into().expect("infallible: size matches"));
            h = u32::from_be_bytes(bytes[20..24].try_into().expect("infallible: size matches"));
        }
        Format::Jpeg => {
            // turbojpeg's header decode is already cheap (no scan data read).
            let handle = jpeg::Handle::init(1).ok_or(Error::OutOfMemory)?;
            // SAFETY: handle is live; (ptr,len) come from a valid live slice.
            if unsafe { jpeg::tj3DecompressHeader(handle.as_ptr(), bytes.as_ptr(), bytes.len()) }
                != 0
            {
                return Err(Error::DecodeFailed);
            }
            // SAFETY: handle is live and has had a header decoded into it above.
            let rw = unsafe { jpeg::tj3Get(handle.as_ptr(), jpeg::TJPARAM_JPEGWIDTH) };
            // SAFETY: same handle invariant as above.
            let rh = unsafe { jpeg::tj3Get(handle.as_ptr(), jpeg::TJPARAM_JPEGHEIGHT) };
            if rw <= 0 || rh <= 0 {
                return Err(Error::DecodeFailed);
            }
            w = u32::try_from(rw).expect("int cast");
            h = u32::try_from(rh).expect("int cast");
        }
        Format::Webp => {
            let mut cw: c_int = 0;
            let mut ch: c_int = 0;
            // SAFETY: (ptr,len) from a valid live slice; cw/ch are valid `*mut c_int` out-params.
            if unsafe { webp::WebPGetInfo(bytes.as_ptr(), bytes.len(), &raw mut cw, &raw mut ch) }
                == 0
                || cw <= 0
                || ch <= 0
            {
                return Err(Error::DecodeFailed);
            }
            w = u32::try_from(cw).expect("int cast");
            h = u32::try_from(ch).expect("int cast");
        }
        Format::Bmp => {
            let ih = bmp::parse_header(bytes)?;
            w = ih.width;
            h = ih.height;
        }
        Format::Gif => {
            // sig(6) · LSD: w(u16le) h(u16le) …
            if bytes.len() < 10 {
                return Err(Error::DecodeFailed);
            }
            w = u16::from_le_bytes(bytes[6..8].try_into().expect("infallible: size matches"))
                as u32;
            h = u16::from_le_bytes(bytes[8..10].try_into().expect("infallible: size matches"))
                as u32;
        }
        Format::Tiff => {
            // IFD walk would be a full TIFF parser; defer to whoever
            // actually decodes it (system backend on mac/win, else error).
            return Err(Error::UnsupportedOnPlatform);
        }
        Format::Heic | Format::Avif => {
            // System backend handles these; fall through to a full decode if
            // available, otherwise UnsupportedOnPlatform.
            return Err(Error::UnsupportedOnPlatform);
        }
    }
    if w == 0 || h == 0 || w > i32::MAX as u32 || h > i32::MAX as u32 {
        return Err(Error::DecodeFailed);
    }
    guard(w, h, max_pixels)?;
    Ok(Probe {
        format: fmt,
        width: w,
        height: h,
    })
}

#[derive(Copy, Clone)]
pub struct EncodeOptions {
    pub format: Format,
    /// 0–100 for JPEG/WebP-lossy. Ignored for PNG.
    pub quality: u8,
    /// WebP only: emit lossless VP8L instead of lossy VP8.
    pub lossless: bool,
    /// PNG only: zlib level 0–9. -1 = libspng default.
    pub compression_level: i8,
    /// PNG only: quantize to ≤ `colors` and emit an indexed PNG.
    pub palette: bool,
    pub colors: u16,
    /// PNG palette only: Floyd–Steinberg error-diffusion dither.
    pub dither: bool,
    /// JPEG only: emit a progressive scan script (coarse-to-fine render).
    pub progressive: bool,
    pub icc_profile: Option<NonNull<[u8]>>,
}

impl Default for EncodeOptions {
    fn default() -> Self {
        Self {
            format: Format::Png, // TODO(port): Zig has no default for `format`; pick at construction
            quality: 80,
            lossless: false,
            compression_level: -1,
            palette: false,
            colors: 256,
            dither: false,
            progressive: false,
            icc_profile: None,
        }
    }
}

pub struct Encoded {
    // SAFETY: fat pointer (ptr+len) owned by whichever C allocator produced
    // it; `free` is the matching deallocator. Not a Box — drop must call `free`.
    pub bytes: NonNull<[u8]>,
    pub free: unsafe extern "C" fn(*mut c_void, *mut c_void),
}

impl Drop for Encoded {
    fn drop(&mut self) {
        // SAFETY: `bytes` was allocated by the codec whose deallocator is `free`.
        unsafe {
            (self.free)(
                self.bytes.as_ptr().cast::<u8>().cast::<c_void>(),
                core::ptr::null_mut(),
            )
        }
    }
}

#[macro_export]
macro_rules! encoded_wrap_free {
    ($f:path) => {{
        unsafe extern "C" fn call(p: *mut ::core::ffi::c_void, _: *mut ::core::ffi::c_void) {
            // SAFETY: p was allocated by the matching allocator for `$f`.
            unsafe { $f(p) }
        }
        call as unsafe extern "C" fn(*mut ::core::ffi::c_void, *mut ::core::ffi::c_void)
    }};
}

impl Encoded {
    #[allow(dead_code)]
    pub(crate) fn from_owned(bytes: Vec<u8>) -> Encoded {
        let mut bytes = core::mem::ManuallyDrop::new(bytes);
        // SAFETY: Vec data ptr is non-null; len is valid.
        let slice = unsafe {
            NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(
                bytes.as_mut_ptr(),
                bytes.len(),
            ))
        };
        Encoded {
            bytes: slice,
            // `bytes` came from a `Vec<u8>` (the global allocator); free with
            // `default_alloc::free` so it agrees with the `#[global_allocator]`.
            free: encoded_wrap_free!(bun_alloc::default_alloc::free),
        }
    }
}

pub(crate) fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    opts: EncodeOptions,
) -> Result<Encoded, Error> {
    // SAFETY: `EncodeOptions.icc_profile` is borrowed from the caller for the
    // duration of this call (raw-ptr stand-in for a lifetime param).
    let icc: Option<&[u8]> = opts.icc_profile.map(|p| unsafe { p.as_ref() });
    match opts.format {
        Format::Jpeg => jpeg::encode(rgba, width, height, opts.quality, opts.progressive, icc),
        Format::Png => {
            if opts.palette {
                png::encode_indexed(
                    rgba,
                    width,
                    height,
                    opts.compression_level,
                    opts.colors,
                    opts.dither,
                    icc,
                )
            } else {
                png::encode(rgba, width, height, opts.compression_level, icc)
            }
        }
        Format::Webp => webp::encode(rgba, width, height, opts.quality, opts.lossless, icc),
        Format::Heic | Format::Avif => {
            #[cfg(any(target_os = "macos", windows))]
            if use_system() {
                return match system_backend::BackendError::split(system_backend::encode(
                    rgba, width, height, &opts,
                )) {
                    Ok(Some(buf)) => Ok(Encoded::from_owned(buf)),
                    // BackendUnavailable collapses into UnsupportedOnPlatform.
                    Ok(None) => Err(Error::UnsupportedOnPlatform),
                    Err(e) => Err(e),
                };
            }
            Err(Error::UnsupportedOnPlatform)
        }
        // Decode-only formats — no .bmp()/.tiff()/.gif() chain methods, so the
        // pipeline never sets these on EncodeOptions.format. Exhaustiveness
        // arm only.
        Format::Bmp | Format::Tiff | Format::Gif => Err(Error::UnsupportedOnPlatform),
    }
}

// ───────────────────────────── highway kernels ──────────────────────────────

#[repr(i32)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Filter {
    Box = 0,
    Bilinear = 1,
    Lanczos3 = 2,
    Mitchell = 3,
    Nearest = 4,
    Cubic = 5, // Catmull-Rom
    Lanczos2 = 6,
    Mks2013 = 7, // Magic Kernel Sharp
    Mks2021 = 8,
}

/// `JSValue.toEnum` lookup table. Hand-listed (not `ComptimeEnumMap`) so
/// Sharp's `'linear'` alias can map to `.bilinear`; the auto-generated
/// error message still lists only the canonical tags.
pub(crate) static FILTER_MAP: phf::Map<&'static [u8], Filter> = phf::phf_map! {
    b"box" => Filter::Box,
    b"bilinear" => Filter::Bilinear,
    b"linear" => Filter::Bilinear,
    b"lanczos3" => Filter::Lanczos3,
    b"mitchell" => Filter::Mitchell,
    b"nearest" => Filter::Nearest,
    b"cubic" => Filter::Cubic,
    b"lanczos2" => Filter::Lanczos2,
    b"mks2013" => Filter::Mks2013,
    b"mks2021" => Filter::Mks2021,
};

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn bun_image_resize_scratch_size(
        src_w: i32,
        src_h: i32,
        dst_w: i32,
        dst_h: i32,
        filter: i32,
    ) -> usize;
    fn bun_image_resize_rgba8(
        src: *const u8,
        src_w: i32,
        src_h: i32,
        dst: *mut u8,
        dst_w: i32,
        dst_h: i32,
        filter: i32,
        scratch: *mut u8,
    ) -> c_int;
    fn bun_image_rotate_rgba8(src: *const u8, w: i32, h: i32, dst: *mut u8, deg: i32);
    fn bun_image_flip_rgba8(src: *const u8, w: i32, h: i32, dst: *mut u8, horiz: i32);
    fn bun_image_modulate_rgba8(buf: *mut u8, len: usize, brightness: f32, saturation: f32);
}

/// In-place brightness/saturation. brightness multiplies V (so 1.0 is
/// identity); saturation linearly interpolates each channel toward the pixel's
/// luma (0 = greyscale, 1 = identity, >1 = boost).
pub(crate) fn modulate(rgba: &mut [u8], brightness: f32, saturation: f32) {
    // SAFETY: ptr+len from a valid slice; C++ kernel writes within bounds.
    unsafe { bun_image_modulate_rgba8(rgba.as_mut_ptr(), rgba.len(), brightness, saturation) }
}

pub(crate) fn resize(
    src: &[u8],
    sw: u32,
    sh: u32,
    dw: u32,
    dh: u32,
    f: Filter,
) -> Result<Vec<u8>, Error> {
    // Zig: `if (@hasDecl(b, "scale"))` — only `backend_coregraphics` provides
    // scale/rotate/flip (vImage); WIC has decode/encode only.
    #[cfg(target_os = "macos")]
    if use_system() {
        match system_backend::BackendError::split(system_backend::scale(src, sw, sh, dw, dh, f)) {
            Ok(Some(out)) => return Ok(out),
            Ok(None) => {} // BackendUnavailable → fall through
            Err(e) => return Err(e),
        }
    }
    let out_sz: usize = (dw as usize) * (dh as usize) * 4;
    // SAFETY: pure FFI query; all args are by-value ints, no pointers.
    let scratch_sz = unsafe {
        bun_image_resize_scratch_size(
            i32::try_from(sw).expect("int cast"),
            i32::try_from(sh).expect("int cast"),
            i32::try_from(dw).expect("int cast"),
            i32::try_from(dh).expect("int cast"),
            f as i32,
        )
    };
    let mut block: Vec<u8> = vec![0u8; out_sz + scratch_sz];
    // SAFETY: block has out_sz + scratch_sz bytes; dst at [0..out_sz), scratch at [out_sz..).
    let rc = unsafe {
        bun_image_resize_rgba8(
            src.as_ptr(),
            i32::try_from(sw).expect("int cast"),
            i32::try_from(sh).expect("int cast"),
            block.as_mut_ptr(),
            i32::try_from(dw).expect("int cast"),
            i32::try_from(dh).expect("int cast"),
            f as i32,
            block.as_mut_ptr().add(out_sz),
        )
    };
    if rc != 0 {
        return Err(Error::OutOfMemory);
    }
    // Drop the scratch tail; mimalloc's shrink is in-place when the new size
    // fits the same block, so this is free.
    block.truncate(out_sz);
    block.shrink_to_fit();
    // PERF(port): Zig used realloc directly; Vec::shrink_to_fit may not be in-place — profile if hot.
    Ok(block)
}

pub(crate) fn rotate(src: &[u8], w: u32, h: u32, degrees: u32) -> Result<Decoded, Error> {
    let (dw, dh): (u32, u32) = if degrees == 90 || degrees == 270 {
        (h, w)
    } else {
        (w, h)
    };
    #[cfg(target_os = "macos")]
    if use_system() {
        match system_backend::BackendError::split(system_backend::rotate(src, w, h, degrees / 90)) {
            Ok(Some(out)) => {
                return Ok(Decoded {
                    rgba: out,
                    width: dw,
                    height: dh,
                    icc_profile: None,
                });
            }
            Ok(None) => {} // BackendUnavailable → fall through
            Err(e) => return Err(e),
        }
    }
    let mut out: Vec<u8> = vec![0u8; (dw as usize) * (dh as usize) * 4];
    // SAFETY: src has w*h*4 bytes; out has dw*dh*4 bytes; degrees is multiple of 90.
    unsafe {
        bun_image_rotate_rgba8(
            src.as_ptr(),
            i32::try_from(w).expect("int cast"),
            i32::try_from(h).expect("int cast"),
            out.as_mut_ptr(),
            i32::try_from(degrees).expect("int cast"),
        )
    };
    Ok(Decoded {
        rgba: out,
        width: dw,
        height: dh,
        icc_profile: None,
    })
}

pub(crate) fn flip(src: &[u8], w: u32, h: u32, horizontal: bool) -> Result<Vec<u8>, Error> {
    #[cfg(target_os = "macos")]
    if use_system() {
        match system_backend::BackendError::split(system_backend::flip(src, w, h, horizontal)) {
            Ok(Some(out)) => return Ok(out),
            Ok(None) => {} // BackendUnavailable → fall through
            Err(e) => return Err(e),
        }
    }
    let mut out: Vec<u8> = vec![0u8; (w as usize) * (h as usize) * 4];
    // SAFETY: src and out both have w*h*4 bytes.
    unsafe {
        bun_image_flip_rgba8(
            src.as_ptr(),
            i32::try_from(w).expect("int cast"),
            i32::try_from(h).expect("int cast"),
            out.as_mut_ptr(),
            horizontal as i32,
        )
    };
    Ok(out)
}

// ported from: src/runtime/image/codecs.zig
