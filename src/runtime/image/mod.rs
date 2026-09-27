//! `Bun.Image` — Sharp-shaped image pipeline.
//!
//! The pure-Rust codec dispatch (`codecs.rs`), per-format decoders/encoders
//! (`codec_*.rs`), EXIF/quantize/thumbhash helpers, and the platform backends
//! are wired here. The JS-facing `Image` wrapper (`Image.rs`) — constructor,
//! chainable mutators, pool-job plumbing — is re-exported as the public
//! surface of this module.

// ─── codec dispatch surface ──────────────────────────────────────────────────
//
// `codecs.rs` owns the shared `Encoded`/`Error`/`DecodeHint`/`EncodeOptions`
// shapes plus the format-agnostic dispatch (`decode`, `encode`, `resize`,
// `Filter`, `Format`), and re-exports `Decoded` from `plane.rs`, whose own
// module keeps the plane's fields private to the dispatch too. Per-format
// files (`codec_*.rs`), the platform backends, and `Image.rs` all import via
// `super::codecs` so there is exactly one `codecs::Error` type at every
// boundary.

#[path = "plane.rs"]
pub(crate) mod plane;

#[path = "codecs.rs"]
pub(crate) mod codecs;

#[path = "codec_jpeg.rs"]
pub(crate) mod codec_jpeg;

#[path = "codec_png.rs"]
pub(crate) mod codec_png;

#[path = "codec_webp.rs"]
pub(crate) mod codec_webp;

#[path = "codec_bmp.rs"]
pub(crate) mod codec_bmp;

#[path = "codec_gif.rs"]
pub(crate) mod codec_gif;

#[cfg(target_os = "macos")]
#[path = "backend_coregraphics.rs"]
pub(crate) mod backend_coregraphics;

#[path = "backend_wic.rs"]
pub(crate) mod backend_wic;

// ─── pure helpers (no jsc / no FFI sys deps) ─────────────────────────────────
#[path = "exif.rs"]
pub(crate) mod exif;
#[path = "quantize.rs"]
pub(crate) mod quantize;
#[path = "thumbhash.rs"]
pub(crate) mod thumbhash;

// ─── JS-facing `Image` class + pipeline task ─────────────────────────────────
//
// `Image.rs` owns the `#[bun_jsc::JsClass]`-derived `Image` payload plus the
// pipeline/task state types. Re-exported here so `crate::image::Image` is the
// JsClass-bearing struct (Body.rs / Blob.rs downcast to it).
//
// `pub` so generated_classes.rs can re-export `crate::image::image_body::Image`
// directly — codegen addresses the defining module, not the flattened re-export.

#[path = "Image.rs"]
pub(crate) mod image_body;
pub(crate) use image_body::Image;
