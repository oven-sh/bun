//! `Bun.Image` — Sharp-shaped image pipeline.
//!
//! The pure-Rust codec dispatch (`codecs.rs`), per-format decoders/encoders
//! (`codec_*.rs`), EXIF/quantize/thumbhash helpers, and the platform backends
//! are wired here. The JS-facing `Image` wrapper (`Image.rs`) — constructor,
//! chainable mutators, `ConcurrentPromiseTask` plumbing — is re-exported as
//! the public surface of this module.

// ─── codec dispatch surface ──────────────────────────────────────────────────
//
// `codecs.rs` is mounted as `codecs_body` (its historical Phase-A name) and
// re-exported as `codecs` so per-format files (`codec_*.rs`) and `Image.rs`
// — which import via `super::codecs` and `super::codecs_body` respectively —
// resolve to the *same* set of `Decoded`/`Encoded`/`Error`/`DecodeHint`/
// `EncodeOptions` types. The earlier inline stand-in `mod codecs { … }` is
// gone now that the real body compiles; keeping both produced two distinct
// `codecs::Error` types and a wall of "similar names but distinct types"
// mismatches at every dispatch boundary.

#[path = "codecs.rs"]
pub mod codecs_body;
pub use codecs_body as codecs;

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

// ─── pure helpers (no jsc / no FFI sys deps) ─────────────────────────────────
#[path = "thumbhash.rs"]
pub mod thumbhash;
#[path = "quantize.rs"]
pub mod quantize;
#[path = "exif.rs"]
pub mod exif;

// ─── JS-facing `Image` class + pipeline task ─────────────────────────────────
//
// `Image.rs` owns the `#[bun_jsc::JsClass]`-derived `Image` payload plus the
// pipeline/task state types. Re-exported here so `crate::image::Image` is the
// JsClass-bearing struct (Body.rs / Blob.rs downcast to it).

#[path = "Image.rs"]
mod image_body;
pub use image_body::{
    AsyncImageTask, Deliver, Fit, Image, Input, Kind, Modulate, Pipeline, PipelineTask, Resize,
    Source, TaskResult,
};
