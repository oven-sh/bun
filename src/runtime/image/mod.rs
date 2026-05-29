//! `Bun.Image` — Sharp-shaped image pipeline.
//!
//! The pure-Rust codec dispatch (`codecs.rs`), per-format decoders/encoders
//! (`codec_*.rs`), EXIF/quantize/thumbhash helpers, and the platform backends
//! are wired here. The JS-facing `Image` wrapper (`Image.rs`) — constructor,
//! chainable mutators, `ConcurrentPromiseTask` plumbing — is re-exported as
//! the public surface of this module.

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

#[path = "Image.rs"]
pub mod image_body;
pub use image_body::{
    AsyncImageTask, Deliver, Fit, Image, Input, Kind, Modulate, Pipeline, PipelineTask, Resize,
    Source, TaskResult,
};
