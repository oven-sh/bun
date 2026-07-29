//! `Bun.Image` — Sharp-shaped image pipeline.
//!
//! The pure-Rust codec dispatch (`codecs.rs`), per-format decoders/encoders
//! (`codec_*.rs`), EXIF/quantize/thumbhash helpers, and the platform backends
//! are wired here. The JS-facing `Image` wrapper (`Image.rs`) — constructor,
//! chainable mutators, `ConcurrentPromiseTask` plumbing — is re-exported as
//! the public surface of this module.

// ─── codec dispatch surface ──────────────────────────────────────────────────
//
// `codecs.rs` owns the shared `Decoded`/`Encoded`/`Error`/`DecodeHint`/
// `EncodeOptions` shapes plus the format-agnostic dispatch (`decode`, `encode`,
// `resize`, `Filter`, `Format`). Per-format files (`codec_*.rs`), the platform
// backends, and `Image.rs` all import via `super::codecs` so there is exactly
// one `codecs::Error` type at every boundary.

#[path = "codecs.rs"]
pub mod codecs;

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

// AVIF on Linux is dlopen'd at runtime — see `codec_avif.rs` header and
// `src/jsc/bindings/image_avif_shim.cpp`. Linux-only; other targets route
// AVIF through their `system_backend` (or throw UnsupportedOnPlatform).
#[cfg(target_os = "linux")]
#[path = "codec_avif.rs"]
pub mod codec_avif;

#[path = "backend_coregraphics.rs"]
pub mod backend_coregraphics;

#[path = "backend_wic.rs"]
pub mod backend_wic;

// ─── pure helpers (no jsc / no FFI sys deps) ─────────────────────────────────
#[path = "exif.rs"]
pub mod exif;
#[path = "quantize.rs"]
pub mod quantize;
#[path = "thumbhash.rs"]
pub mod thumbhash;

// ─── JS-facing `Image` class + pipeline task ─────────────────────────────────
//
// `Image.rs` owns the `#[bun_jsc::JsClass]`-derived `Image` payload plus the
// pipeline/task state types. Re-exported here so `crate::image::Image` is the
// JsClass-bearing struct (Body.rs / Blob.rs downcast to it).
//
// `pub` so generated_classes.rs can re-export `crate::image::image_body::Image`
// directly — codegen addresses the defining module, not the flattened re-export.

#[path = "Image.rs"]
pub mod image_body;
pub use image_body::{
    AsyncImageTask, Deliver, Fit, Image, Input, Kind, Modulate, Pipeline, PipelineTask, Resize,
    Source, TaskResult,
};
