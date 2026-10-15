//! `Bun.Image` — Sharp-shaped image pipeline.
//!
//! The pure-Rust codec dispatch (`codecs.rs`), per-format decoders/encoders
//! (`codec_*.rs`), EXIF/quantize/thumbhash helpers, and the platform backends
//! are wired here. The JS-facing `Image` wrapper (`Image.rs`) — constructor,
//! chainable mutators, pool-job plumbing — is re-exported as the public
//! surface of this module.

// ─── codec dispatch surface ──────────────────────────────────────────────────
//
// `codecs.rs` owns the shared `Decoded`/`Encoded`/`Error`/`DecodeHint`/
// `EncodeOptions` shapes plus the format-agnostic dispatch (`decode`, `encode`,
// `resize`, `Filter`, `Format`). Per-format files (`codec_*.rs`), the platform
// backends, and `Image.rs` all import via `super::codecs` so there is exactly
// one `codecs::Error` type at every boundary.

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
// pipeline/task state types.

#[path = "Image.rs"]
pub(crate) mod image_body;
pub(crate) use image_body::Image;

/// The thunks that `ZigGeneratedClasses.image.cpp` calls (src/codegen/generate-classes.ts). src/runtime/generated_classes.rs
/// says why what is generated trips each of these lints.
#[allow(non_snake_case, improper_ctypes, clippy::redundant_closure)]
pub(crate) mod generated_classes {
    include!(concat!(
        env!("BUN_CODEGEN_DIR"),
        "/generated_classes.image.rs"
    ));
}

/// `Bun.Image`
#[bun_core::feature::behind(bun_runtime::features::image_constructor, image)]
fn constructor(global: &bun_jsc::JSGlobalObject) -> bun_jsc::JSValue {
    bun_jsc::codegen::js::get_constructor::<Image>(global)
}

/// `Bun.file("…").image(options)`
#[bun_core::feature::behind(bun_runtime::features::image_of_blob, image)]
fn of_blob(
    global: &bun_jsc::JSGlobalObject,
    blob: bun_jsc::JSValue,
    options: bun_jsc::JSValue,
) -> bun_jsc::JsResult<bun_jsc::JSValue> {
    Image::from_blob_js(global, blob, options)
}

/// `new Response(image)`: what it encodes to and the MIME type of that, if `value` is an image.
#[bun_core::feature::behind(bun_runtime::features::image_as_body, image)]
fn as_body(
    global: &bun_jsc::JSGlobalObject,
    value: bun_jsc::JSValue,
) -> bun_jsc::JsResult<Option<(Box<[u8]>, &'static bun_core::ZStr)>> {
    let Some(image) = value.as_class_ref::<Image>() else {
        return Ok(None);
    };
    let (encoded, mime) = image.encode_for_body(global, value)?;
    // Blob.Store frees via an Allocator, so dupe out of the codec's allocator here. The hot path (`.bytes()`) hands the
    // codec buffer to JS without this copy.
    // SAFETY: `encoded.bytes` is the codec-owned slice; copy then drop frees it.
    Ok(Some((Box::from(unsafe { encoded.bytes.as_ref() }), mime)))
}
