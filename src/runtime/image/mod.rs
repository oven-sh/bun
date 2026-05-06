//! `Bun.Image` — Sharp-shaped image pipeline.
//!
//! B-2 un-gate: the pure-Rust codec dispatch (`codecs.rs`), per-format
//! decoders/encoders (`codec_*.rs`), EXIF/quantize/thumbhash helpers, and the
//! platform backends are wired here. The JS-facing `Image` wrapper
//! (`Image.rs`) — constructor, chainable mutators, `ConcurrentPromiseTask`
//! plumbing — stays gated until the `bun_jsc` method surface it needs
//! (`ConcurrentPromiseTask`, `webcore::Blob`, cached-slot accessors) is real.

// ─── gated Phase-A drafts (preserved on disk, not compiled) ──────────────────

#[path = "Image.rs"]
mod image_body; // full Phase-A draft of Image.zig
pub use image_body::AsyncImageTask;

#[path = "codecs.rs"]
pub mod codecs_body; // full Phase-A draft — needs bun_str::zstr!, bun_alloc::mimalloc

// Per-codec bodies depend on `super::codecs` (the gated draft above) for
// `Decoded`/`Encoded`/`Error`/`DecodeHint`, plus FFI sys crates not yet
// vendored (libspng / libjpeg-turbo / libwebp). They stay gated alongside it.

#[path = "codec_jpeg.rs"]
pub mod codec_jpeg;

#[path = "codec_png.rs"]
pub mod codec_png;

#[path = "codec_webp.rs"]
pub mod codec_webp;

#[path = "codec_bmp.rs"]
pub mod codec_bmp;

#[path = "codec_gif.rs"]
pub mod codec_gif;

#[path = "backend_coregraphics.rs"]
pub mod backend_coregraphics;

#[path = "backend_wic.rs"]
pub mod backend_wic;

// ─── compiling submodules (no jsc / no FFI sys deps) ─────────────────────────
#[path = "thumbhash.rs"]
pub mod thumbhash;
#[path = "quantize.rs"]
pub mod quantize;
#[path = "exif.rs"]
pub mod exif;

// ─── real type surface (B-2 struct/state un-gate) ────────────────────────────
// Method bodies (`Image::constructor`, `pin_for_task`, `PipelineTask::run`/
// `then`, `do_metadata`) remain in `Image.rs` above — they need:
//   TODO(b2-blocked): bun_jsc::ConcurrentPromiseTask
//   TODO(b2-blocked): bun_jsc cached-slot accessors (sourceJSSetCached / …)
//   TODO(b2-blocked): crate::webcore::Blob
//   TODO(b2-blocked): bun_str::{zstr!, ZString owned-NUL type}
//   TODO(b2-blocked): bun_alloc::mimalloc::mi_free (Encoded::from_owned)

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::jsc::{JsRef, JSValue, Strong};

/// Dispatch surface re-exported with type-only stand-ins until `codecs.rs`
/// is un-gated. Layout matches the draft so `Image`/`Pipeline` below are real.
pub mod codecs {
    use super::*;

    pub const HAS_SYSTEM_BACKEND: bool = cfg!(any(target_os = "macos", windows));
    /// Sharp's default: 0x3FFF * 0x3FFF ≈ 268 MP.
    pub const DEFAULT_MAX_PIXELS: u64 = 0x3FFF * 0x3FFF;

    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
    #[strum(serialize_all = "lowercase")]
    pub enum Backend {
        System = 0,
        Bun = 1,
    }

    pub static BACKEND: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(
        if HAS_SYSTEM_BACKEND { Backend::System as u8 } else { Backend::Bun as u8 },
    );

    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Format {
        Jpeg,
        Png,
        Webp,
        Heic,
        Avif,
        Bmp,
        Tiff,
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
            if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
                let box_: usize = bytes.len().min(
                    16usize.max(u32::from_be_bytes(bytes[0..4].try_into().unwrap()) as usize),
                );
                let mut miaf = false;
                let mut off: usize = 8;
                while off + 4 <= box_ {
                    if off == 12 {
                        off += 4;
                        continue;
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
                    return Some(Format::Heic);
                }
            }
            None
        }
    }

    #[derive(Default)]
    pub struct Decoded {
        pub rgba: Vec<u8>,
        pub width: u32,
        pub height: u32,
        pub icc_profile: Option<Vec<u8>>,
    }

    #[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
    pub enum Error {
        #[error("UnknownFormat")]
        UnknownFormat,
        #[error("DecodeFailed")]
        DecodeFailed,
        #[error("EncodeFailed")]
        EncodeFailed,
        #[error("TooManyPixels")]
        TooManyPixels,
        #[error("UnsupportedOnPlatform")]
        UnsupportedOnPlatform,
        #[error("OutOfMemory")]
        OutOfMemory,
    }

    #[derive(Copy, Clone, Default)]
    pub struct DecodeHint {
        pub target_w: u32,
        pub target_h: u32,
    }

    #[derive(Copy, Clone, Default)]
    pub struct Probe {
        pub format: Option<Format>,
        pub width: u32,
        pub height: u32,
    }

    #[derive(Copy, Clone)]
    pub struct EncodeOptions {
        pub format: Format,
        pub quality: u8,
        pub lossless: bool,
        pub compression_level: i8,
        pub palette: bool,
        pub colors: u16,
        pub dither: bool,
        pub progressive: bool,
        // TODO(port): lifetime — borrowed from caller for the duration of `encode()`.
        pub icc_profile: Option<NonNull<[u8]>>,
    }

    impl Default for EncodeOptions {
        fn default() -> Self {
            Self {
                format: Format::Png,
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

    /// Encoded output paired with the free function for its allocator.
    pub struct Encoded {
        pub bytes: NonNull<[u8]>,
        pub free: unsafe extern "C" fn(*mut c_void, *mut c_void),
    }
    impl Drop for Encoded {
        fn drop(&mut self) {
            // SAFETY: `bytes` was allocated by the codec whose deallocator is `free`.
            unsafe {
                (self.free)(self.bytes.as_ptr() as *mut u8 as *mut c_void, core::ptr::null_mut())
            }
        }
    }

    #[repr(i32)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Filter {
        Box = 0,
        Bilinear = 1,
        Lanczos3 = 2,
        Mitchell = 3,
        Nearest = 4,
        Cubic = 5,
        Lanczos2 = 6,
        Mks2013 = 7,
        Mks2021 = 8,
    }

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
}

// ── Image (`.classes.ts` payload) ────────────────────────────────────────────

/// `Bun.Image` native payload. The `#[bun_jsc::JsClass]` derive on the gated
/// draft generates the wrapper/prototype/constructor; this is just `m_ctx`.
pub struct Image {
    pub source: Source,
    pub pipeline: Pipeline,
    /// Decompression-bomb guard (Sharp's `limitInputPixels`).
    pub max_pixels: u64,
    pub auto_orient: bool,
    pub last_width: i32,
    pub last_height: i32,
    /// Strong while ≥1 PipelineTask is in flight, weak otherwise.
    pub this_ref: JsRef,
    pub pending_tasks: u32,
}

impl Default for Image {
    fn default() -> Self {
        Self {
            source: Source::JsBuffer,
            pipeline: Pipeline::default(),
            max_pixels: codecs::DEFAULT_MAX_PIXELS,
            auto_orient: true,
            last_width: -1,
            last_height: -1,
            this_ref: JsRef::default(),
            pending_tasks: 0,
        }
    }
}

pub enum Source {
    /// Input is a JS ArrayBuffer/TypedArray held in the wrapper's `sourceJS`
    /// cached slot. We never cache the raw pointer here.
    JsBuffer,
    /// Owned — Blob inputs and decoded `data:` URLs.
    Owned(Vec<u8>),
    /// Owned, NUL-terminated. Read on the worker thread.
    // TODO(b2-blocked): bun_str owned-NUL type — boxed bytes until then.
    Path(Box<[u8]>),
    /// `Bun.file()`, S3, fd-backed Blob — bytes don't exist until read.
    Blob(Strong),
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
pub enum Fit {
    Fill,
    Inside,
}

#[derive(Clone, Copy)]
pub struct Resize {
    pub w: u32,
    pub h: u32,
    pub filter: codecs::Filter,
    pub fit: Fit,
    pub without_enlargement: bool,
}

impl Default for Resize {
    fn default() -> Self {
        Self {
            w: 0,
            h: 0,
            filter: codecs::Filter::Lanczos3,
            fit: Fit::Fill,
            without_enlargement: false,
        }
    }
}

/// One slot per operation, not an op list — calling `.resize()` twice
/// overwrites. Execution order matches Sharp: (autoOrient) → rotate →
/// flip/flop → resize → modulate.
#[derive(Clone, Copy, Default)]
pub struct Pipeline {
    pub rotate: u16,
    pub flip: bool,
    pub flop: bool,
    pub resize: Option<Resize>,
    pub modulate: Option<Modulate>,
    pub output: Option<codecs::EncodeOptions>,
}

#[derive(Clone, Copy)]
pub struct Modulate {
    pub brightness: f32,
    pub saturation: f32,
}
impl Default for Modulate {
    fn default() -> Self {
        Self { brightness: 1.0, saturation: 1.0 }
    }
}

// ── PipelineTask (off-thread work unit) ──────────────────────────────────────

pub struct PipelineTask {
    pub image: *mut Image,
    // TODO(port): lifetime — JSC_BORROW; raw ptr until bun_jsc lands &'static.
    pub global: *const crate::jsc::JSGlobalObject,
    pub pipeline: Pipeline,
    pub input: Input,
    pub kind: Kind,
    pub deliver: Deliver,
    pub max_pixels: u64,
    pub auto_orient: bool,
    pub result: TaskResult,
}

pub struct Input {
    pub bytes: *const [u8],
    pub path: Option<*const [u8]>,
    pub pinned: JSValue,
    pub copied: Option<Vec<u8>>,
}
impl Default for Input {
    fn default() -> Self {
        Self {
            bytes: &[] as *const [u8],
            path: None,
            pinned: JSValue::ZERO,
            copied: None,
        }
    }
}

pub enum Deliver {
    Uint8Array,
    Buffer,
    Blob,
    Base64,
    DataUrl,
    WriteDest(Strong),
}

pub enum Kind {
    Encode(Option<codecs::EncodeOptions>),
    Metadata,
    Placeholder,
}

pub enum TaskResult {
    Encoded { out: codecs::Encoded, format: codecs::Format, w: u32, h: u32 },
    Meta { w: u32, h: u32, format: codecs::Format },
    Err(codecs::Error),
    // TODO(b2-blocked): bun_sys::Error — erased until sys::Error is reachable here.
    IoErr(i32),
}
