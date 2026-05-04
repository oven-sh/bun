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
pub use super::codec_jpeg as jpeg;
pub use super::codec_png as png;
pub use super::codec_webp as webp;
pub use super::codec_bmp as bmp;
pub use super::codec_gif as gif;

/// Optional OS-native backend. Absent on Linux (and any platform we haven't
/// written one for) so the dispatch in `decode`/`encode` compiles away. The
/// backend module is only `use`d inside the matching cfg arm so non-target
/// platforms never see its symbols. Exposed for `Image.fromClipboard()`.
#[cfg(target_os = "macos")]
pub use super::backend_coregraphics as system_backend;
#[cfg(windows)]
pub use super::backend_wic as system_backend;

/// `true` on platforms where `system_backend` is present.
pub const HAS_SYSTEM_BACKEND: bool = cfg!(any(target_os = "macos", windows));

/// Process-global selector exposed as `Bun.Image.backend`.
///
/// `.system` (default on darwin/windows) is the perf-optimal hybrid:
///   • jpeg/png/webp decode+encode → static codecs (turbo/spng/libwebp).
///     Profiling on M-series found ImageIO no faster: Huffman/inflate
///     dominate and aren't AMX-amenable, and ImageIO bottoms out in stock
///     libz vs our zlib-ng. Keeping these static also makes output bytes
///     and the `quality` scale match Linux.
///   • lanczos3 resize, rotate90, flip → vImage (AMX, ~3-6× the Highway
///     kernel on the geometry step).
///   • heic/avif decode+encode → ImageIO/WIC (no static codec).
///
/// `.bun` skips the OS layer entirely (Highway geometry, heic/avif throw)
/// so behaviour is byte-identical to a Linux build.
///
/// Unsynchronised: written from JS, read from WorkPool — a torn read of a
/// 1-byte enum is fine and the worst case is one task using the previous
/// mode.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
#[strum(serialize_all = "lowercase")]
pub enum Backend {
    System = 0,
    Bun = 1,
}
// PORT NOTE: `Backend.Map = bun.ComptimeEnumMap(Backend)` → strum::EnumString (keys == variant names).

// PORT NOTE: Zig `pub var backend` is read from WorkPool threads + written from JS;
// "torn read of a 1-byte enum is fine" → relaxed atomic is the safe-Rust spelling.
pub static BACKEND: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(
    if HAS_SYSTEM_BACKEND { Backend::System as u8 } else { Backend::Bun as u8 },
);

/// Runtime half of the dispatch check; the comptime half is the
/// `#[cfg(any(target_os = "macos", windows))]` gate at each call site (types
/// can't be runtime-conditional, so the two stay separate). On platforms with
/// no backend the cfg is comptime-dead and this is never referenced.
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
    pub fn sniff(bytes: &[u8]) -> Option<Format> {
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
        // ISO BMFF: u32be box-size · "ftyp" · major-brand · minor-version ·
        // compatible-brands… HEIC and AVIF share this container; the brands
        // distinguish them. `mif1`/`msf1` are codec-agnostic MIAF structural
        // brands that appear in BOTH, so they can't decide on first sight —
        // scan the whole brand list and let a codec-specific brand win.
        if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
            let box_: usize = bytes.len().min(
                16usize.max(u32::from_be_bytes(bytes[0..4].try_into().unwrap()) as usize),
            );
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
    pub fn from_extension(path: &[u8]) -> Option<Format> {
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

    pub fn mime(self) -> &'static bun_str::ZStr {
        // TODO(port): verify bun_str::zstr! macro for [:0]const u8 literals
        match self {
            Format::Jpeg => bun_str::zstr!("image/jpeg"),
            Format::Png => bun_str::zstr!("image/png"),
            Format::Webp => bun_str::zstr!("image/webp"),
            Format::Heic => bun_str::zstr!("image/heic"),
            Format::Avif => bun_str::zstr!("image/avif"),
            Format::Bmp => bun_str::zstr!("image/bmp"),
            Format::Tiff => bun_str::zstr!("image/tiff"),
            Format::Gif => bun_str::zstr!("image/gif"),
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
    /// ICC color profile bytes pulled from the source container (JPEG APP2,
    /// PNG iCCP, WebP ICCP), global-allocator-owned. `None` when the
    /// source didn't carry one or the decode path doesn't extract it —
    /// BMP/GIF (no ICC chunk) and system backends (which already colour-
    /// manage into sRGB during decode, so the profile is no longer
    /// needed). The image pipeline hands this straight to the matching
    /// encoder — the RGBA buffer is NOT converted to sRGB, so the bytes
    /// only have their intended colour meaning when the profile travels
    /// with them. Dropping it on a Display-P3 / Adobe RGB / XYB source
    /// would reinterpret the values as sRGB and visibly shift the
    /// colours. See issue #30197.
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

impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

/// Sharp's default: 0x3FFF * 0x3FFF ≈ 268 MP. A single RGBA8 frame at this
/// cap is ~1 GiB, which is already past where you'd want to be.
pub const DEFAULT_MAX_PIXELS: u64 = 0x3FFF * 0x3FFF;

/// Hint from the pipeline about the eventual output size. JPEG can do M/8
/// IDCT scaling for free, so when we know the resize target up front we
/// decode at the smallest factor that still ≥ the target — skipping most of
/// the IDCT work AND shrinking the RGBA buffer the resize pass touches. This
/// is the same trick Sharp/libvips use and is where most of the perf gap was.
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
        // Static codecs cover everything we ship; profiling on M-series showed
        // ImageIO is no faster (AppleJPEG ≈ libjpeg-turbo since Huffman is the
        // bottleneck and isn't vectorisable; spng+zlib-ng beats ImageIO's
        // system libz). The OS backend is purely a *capability* fallback for
        // containers we don't link a decoder for — and `backend == .bun` opts
        // out of even that so behaviour is identical to Linux.
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
        Format::Gif => match decode_via_system(bytes, max_pixels)? {
            Some(d) => Ok(d),
            None => gif::decode(bytes, max_pixels),
        },
    }
}

// PORT NOTE: Zig returned `(Error || error{BackendUnavailable})!Decoded`;
// reshaped to `Result<Option<Decoded>, Error>` where `Ok(None)` = BackendUnavailable.
#[allow(unused_variables)]
fn decode_via_system(bytes: &[u8], max_pixels: u64) -> Result<Option<Decoded>, Error> {
    #[cfg(any(target_os = "macos", windows))]
    if use_system() {
        return system_backend::decode(bytes, max_pixels).map(Some);
    }
    Ok(None)
}

#[inline]
pub fn guard(w: u32, h: u32, max_pixels: u64) -> Result<(), Error> {
    // u64 mul cannot overflow from two u32 factors.
    if (w as u64) * (h as u64) > max_pixels {
        return Err(Error::TooManyPixels);
    }
    Ok(())
}

pub struct Probe {
    pub format: Format,
    pub width: u32,
    pub height: u32,
}

/// Header-only dimensions probe for `.metadata()`. Decoding the full RGBA for
/// a 1920×1080 PNG just to read the IHDR is ~70× slower than Sharp; this reads
/// the few bytes each format needs and stops. Still subject to `max_pixels` so
/// metadata() and bytes() agree on what's "too big".
pub fn probe(bytes: &[u8], max_pixels: u64) -> Result<Probe, Error> {
    let fmt = Format::sniff(bytes).ok_or(Error::UnknownFormat)?;
    let mut w: u32 = 0;
    let mut h: u32 = 0;
    match fmt {
        Format::Png => {
            // sig(8) · IHDR{len(4) type(4) w(4) h(4) ...}
            if bytes.len() < 24 {
                return Err(Error::DecodeFailed);
            }
            w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
            h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        }
        Format::Jpeg => {
            // turbojpeg's header decode is already cheap (no scan data read).
            // SAFETY: FFI call; tj3Init(TJINIT_DECOMPRESS) takes no pointers.
            let handle = unsafe { jpeg::tj3Init(1) };
            if handle.is_null() {
                return Err(Error::OutOfMemory);
            }
            // SAFETY: handle is non-null (checked above); destroyed exactly once on scope exit.
            let _guard = scopeguard::guard((), |_| unsafe { jpeg::tj3Destroy(handle) });
            // SAFETY: handle is non-null; (ptr,len) come from a valid live slice.
            if unsafe { jpeg::tj3DecompressHeader(handle, bytes.as_ptr(), bytes.len()) } != 0 {
                return Err(Error::DecodeFailed);
            }
            // SAFETY: handle is non-null and has had a header decoded into it above.
            let rw = unsafe { jpeg::tj3Get(handle, jpeg::TJPARAM_JPEGWIDTH) };
            // SAFETY: same handle invariant as above.
            let rh = unsafe { jpeg::tj3Get(handle, jpeg::TJPARAM_JPEGHEIGHT) };
            if rw <= 0 || rh <= 0 {
                return Err(Error::DecodeFailed);
            }
            w = u32::try_from(rw).unwrap();
            h = u32::try_from(rh).unwrap();
        }
        Format::Webp => {
            let mut cw: c_int = 0;
            let mut ch: c_int = 0;
            // SAFETY: (ptr,len) from a valid live slice; cw/ch are valid `*mut c_int` out-params.
            if unsafe { webp::WebPGetInfo(bytes.as_ptr(), bytes.len(), &mut cw, &mut ch) } == 0
                || cw <= 0
                || ch <= 0
            {
                return Err(Error::DecodeFailed);
            }
            w = u32::try_from(cw).unwrap();
            h = u32::try_from(ch).unwrap();
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
            w = u16::from_le_bytes(bytes[6..8].try_into().unwrap()) as u32;
            h = u16::from_le_bytes(bytes[8..10].try_into().unwrap()) as u32;
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
    // The PNG/JPEG/BMP specs all cap each dimension at 2³¹−1; a header with
    // a larger u32 value is corrupt regardless of `maxPixels`. Reject here so
    // the i32 `last_width`/`last_height` casts downstream can't trap on a
    // 24-byte hostile IHDR.
    if w == 0 || h == 0 || w > i32::MAX as u32 || h > i32::MAX as u32 {
        return Err(Error::DecodeFailed);
    }
    guard(w, h, max_pixels)?;
    Ok(Probe { format: fmt, width: w, height: h })
}

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
    /// ICC profile to embed in the output container (JPEG APP2, PNG iCCP,
    /// WebP ICCP). `None` ⇒ no profile chunk/marker is written. The
    /// pipeline forwards this from the decode step so a non-sRGB source
    /// (P3, Adobe RGB, XYB/Jpegli) preserves its colour meaning through
    /// re-encode. Borrowed; the caller retains ownership.
    // TODO(port): lifetime — borrowed from caller for the duration of `encode()`;
    // raw ptr in Phase A per rule "never put a lifetime param on a struct".
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

/// Encoded output paired with the free function for its allocator. The C
/// codecs each malloc internally (turbojpeg's allocator, libwebp's, libc for
/// libspng); rather than dupe into the global allocator so JS can own it,
/// we hand the original buffer to JS via `ArrayBuffer.toJSWithContext` with
/// the matching free — one allocation, zero copies, for the final output.
///
/// `free` matches `jsc.C.JSTypedArrayBytesDeallocator` (bytes, ctx) so it can
/// be passed straight through; the `ctx` arg is unused.
pub struct Encoded {
    // SAFETY: fat pointer (ptr+len) owned by whichever C allocator produced
    // it; `free` is the matching deallocator. Not a Box — drop must call `free`.
    pub bytes: NonNull<[u8]>,
    pub free: unsafe extern "C" fn(*mut c_void, *mut c_void),
}

impl Drop for Encoded {
    fn drop(&mut self) {
        // SAFETY: `bytes` was allocated by the codec whose deallocator is `free`.
        unsafe { (self.free)(self.bytes.as_ptr() as *mut u8 as *mut c_void, core::ptr::null_mut()) }
    }
}

/// Adapt a 1-arg C free (`tj3Free`, `WebPFree`, `std.c.free`) to the
/// 2-arg JSC deallocator signature.
// PORT NOTE: Zig `wrap(comptime f: anytype)` generated a distinct static fn per
// call site. Rust cannot capture a runtime fn pointer in a non-capturing
// `extern "C" fn`, so this is a macro that mints a static trampoline per call.
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
    pub fn from_owned(bytes: Vec<u8>) -> Encoded {
        let mut bytes = core::mem::ManuallyDrop::new(bytes);
        // SAFETY: Vec data ptr is non-null; len is valid.
        let slice = unsafe { NonNull::new_unchecked(core::ptr::slice_from_raw_parts_mut(bytes.as_mut_ptr(), bytes.len())) };
        Encoded {
            bytes: slice,
            free: encoded_wrap_free!(bun_alloc::mimalloc::mi_free),
        }
    }
}

pub fn encode(rgba: &[u8], width: u32, height: u32, opts: EncodeOptions) -> Result<Encoded, Error> {
    match opts.format {
        Format::Jpeg => jpeg::encode(rgba, width, height, opts.quality, opts.progressive, opts.icc_profile),
        // PNG carries iCCP on both truecolour and indexed images — quantise
        // operates on raw RGB numbers without converting colour spaces, so
        // the palette entries are still in the source space and need the
        // profile to be interpreted correctly (see PNG spec §11.3.3.3).
        Format::Png => {
            if opts.palette {
                png::encode_indexed(rgba, width, height, opts.compression_level, opts.colors, opts.dither, opts.icc_profile)
            } else {
                png::encode(rgba, width, height, opts.compression_level, opts.icc_profile)
            }
        }
        Format::Webp => webp::encode(rgba, width, height, opts.quality, opts.lossless, opts.icc_profile),
        // Same routing rationale as decode(): the OS encoder is a capability
        // fallback, not a fast path — ImageIO's quality scale doesn't match
        // libjpeg-turbo's, and it can't honour compressionLevel/palette/
        // lossless, so using it for jpeg/png/webp would make output bytes
        // diverge from Linux for no speed win.
        Format::Heic | Format::Avif => {
            #[cfg(any(target_os = "macos", windows))]
            if use_system() {
                return match system_backend::encode(rgba, width, height, &opts) {
                    Ok(buf) => Ok(Encoded::from_owned(buf)),
                    // PORT NOTE: backend returns Error directly; BackendUnavailable
                    // collapsed into UnsupportedOnPlatform here.
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
pub static FILTER_MAP: phf::Map<&'static [u8], Filter> = phf::phf_map! {
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
    fn bun_image_resize_scratch_size(src_w: i32, src_h: i32, dst_w: i32, dst_h: i32, filter: i32) -> usize;
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
pub fn modulate(rgba: &mut [u8], brightness: f32, saturation: f32) {
    // SAFETY: ptr+len from a valid slice; C++ kernel writes within bounds.
    unsafe { bun_image_modulate_rgba8(rgba.as_mut_ptr(), rgba.len(), brightness, saturation) }
}

pub fn resize(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32, f: Filter) -> Result<Vec<u8>, Error> {
    #[cfg(any(target_os = "macos", windows))]
    if use_system() {
        // TODO(port): @hasDecl(b, "scale") — verify backend module exports `scale`
        match system_backend::scale(src, sw, sh, dw, dh, f) {
            Ok(Some(out)) => return Ok(out),
            Ok(None) => {} // BackendUnavailable → fall through
            Err(e) => return Err(e),
        }
    }
    // ONE allocation for output + the kernel's scratch arena (intermediate
    // dst_w×src_h×4 row buffer + spans/weights tables). Zero mallocs in the
    // C++; mimalloc here is faster than libc, and the over-allocation rounds
    // into the same size class as the row buffer alone.
    let out_sz: usize = (dw as usize) * (dh as usize) * 4;
    // SAFETY: pure FFI query; all args are by-value ints, no pointers.
    let scratch_sz = unsafe {
        bun_image_resize_scratch_size(
            i32::try_from(sw).unwrap(),
            i32::try_from(sh).unwrap(),
            i32::try_from(dw).unwrap(),
            i32::try_from(dh).unwrap(),
            f as i32,
        )
    };
    let mut block: Vec<u8> = vec![0u8; out_sz + scratch_sz];
    // SAFETY: block has out_sz + scratch_sz bytes; dst at [0..out_sz), scratch at [out_sz..).
    let rc = unsafe {
        bun_image_resize_rgba8(
            src.as_ptr(),
            i32::try_from(sw).unwrap(),
            i32::try_from(sh).unwrap(),
            block.as_mut_ptr(),
            i32::try_from(dw).unwrap(),
            i32::try_from(dh).unwrap(),
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
    // PERF(port): Zig used realloc directly; Vec::shrink_to_fit may not in-place — profile in Phase B
    Ok(block)
}

pub fn rotate(src: &[u8], w: u32, h: u32, degrees: u32) -> Result<Decoded, Error> {
    let (dw, dh): (u32, u32) = if degrees == 90 || degrees == 270 { (h, w) } else { (w, h) };
    #[cfg(any(target_os = "macos", windows))]
    if use_system() {
        // TODO(port): @hasDecl(b, "rotate") — verify backend module exports `rotate`
        match system_backend::rotate(src, w, h, degrees / 90) {
            Ok(Some(out)) => return Ok(Decoded { rgba: out, width: dw, height: dh, icc_profile: None }),
            Ok(None) => {} // BackendUnavailable → fall through
            Err(e) => return Err(e),
        }
    }
    let mut out: Vec<u8> = vec![0u8; (dw as usize) * (dh as usize) * 4];
    // SAFETY: src has w*h*4 bytes; out has dw*dh*4 bytes; degrees is multiple of 90.
    unsafe {
        bun_image_rotate_rgba8(
            src.as_ptr(),
            i32::try_from(w).unwrap(),
            i32::try_from(h).unwrap(),
            out.as_mut_ptr(),
            i32::try_from(degrees).unwrap(),
        )
    };
    Ok(Decoded { rgba: out, width: dw, height: dh, icc_profile: None })
}

pub fn flip(src: &[u8], w: u32, h: u32, horizontal: bool) -> Result<Vec<u8>, Error> {
    #[cfg(any(target_os = "macos", windows))]
    if use_system() {
        // TODO(port): @hasDecl(b, "flip") — verify backend module exports `flip`
        match system_backend::flip(src, w, h, horizontal) {
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
            i32::try_from(w).unwrap(),
            i32::try_from(h).unwrap(),
            out.as_mut_ptr(),
            horizontal as i32,
        )
    };
    Ok(out)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/codecs.zig (498 lines)
//   confidence: medium
//   todos:      7
//   notes:      system_backend ?type → cfg-gated module re-export; BackendUnavailable error reshaped to Ok(None); wrap() comptime fn → macro; backend global → AtomicU8; EncodeOptions.icc_profile is raw NonNull<[u8]> (Phase-A no-lifetime rule)
// ──────────────────────────────────────────────────────────────────────────
