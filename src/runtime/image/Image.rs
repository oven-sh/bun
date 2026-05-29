//! `Bun.Image` — Sharp-shaped image pipeline backed by the statically linked
//! libjpeg-turbo / libspng / libwebp codecs and the highway resize kernel.
//!
//! Shape: the constructor only captures the *input* (path or bytes). Chainable
//! mutators (`resize`, `rotate`, `flip`, `flop`, `jpeg`/`png`/`webp`) each
//! write one slot of `Pipeline` and return `this` — there is no op list, so
//! calling a setter twice overwrites. The actual decode → transform → encode
//! work happens off-thread when a terminal (`bytes`/`buffer`/`blob`/
//! `toBase64`/`metadata`) is awaited, via `jsc.ConcurrentPromiseTask`.

use core::cell::Cell;
use core::mem;

use crate::generated_classes::PropertyName;
use crate::webcore::Blob;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::store as blob_store;
use crate::webcore::blob::{ReadBytesHandler, ReadBytesResult};
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_core::ZBox;
use bun_core::base64;
use bun_core::zstr;
use bun_core::{ZStr, strings};
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsClass as _,
    JsRef, JsResult, StringJsc as _, Strong, SysErrorJsc as _,
};
use bun_sys as sys;

use super::codecs;
use super::exif;
use super::thumbhash;

/// Lowercase JS-visible name for a `codecs::Format`. Local until `Format`
/// derives `IntoStaticStr` (variant casing differs from JS).
#[inline]
fn format_name(f: codecs::Format) -> &'static str {
    match f {
        codecs::Format::Jpeg => "jpeg",
        codecs::Format::Png => "png",
        codecs::Format::Webp => "webp",
        codecs::Format::Heic => "heic",
        codecs::Format::Avif => "avif",
        codecs::Format::Bmp => "bmp",
        codecs::Format::Tiff => "tiff",
        codecs::Format::Gif => "gif",
    }
}

pub use crate::generated_classes::js_Image as js;

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). `max_pixels`
// / `auto_orient` are read-only after construction so stay bare.
#[bun_jsc::JsClass]
pub struct Image {
    source: JsCell<Source>,
    pipeline: Cell<Pipeline>,
    /// Decompression-bomb guard. Checked against the *header* dimensions before
    /// any RGBA buffer is allocated. Mirrors Sharp's `limitInputPixels`.
    max_pixels: u64,
    /// Apply EXIF Orientation (JPEG) before any user ops, the way Sharp's
    /// `.rotate()`-with-no-args / `autoOrient` does.
    auto_orient: bool,
    /// Populated after a pipeline has run once; lets `.width`/`.height` answer
    /// synchronously after the first await.
    last_width: Cell<i32>,
    last_height: Cell<i32>,
    this_ref: JsCell<JsRef>,
    pending_tasks: Cell<u32>,
}

impl Default for Image {
    fn default() -> Self {
        Self {
            source: JsCell::new(Source::JsBuffer),
            pipeline: Cell::new(Pipeline::default()),
            max_pixels: codecs::DEFAULT_MAX_PIXELS,
            auto_orient: true,
            last_width: Cell::new(-1),
            last_height: Cell::new(-1),
            this_ref: JsCell::new(JsRef::empty()),
            pending_tasks: Cell::new(0),
        }
    }
}

pub enum Source {
    JsBuffer,
    /// Owned — Blob inputs (the Blob's store may be sliced/freed independently)
    /// and decoded data: URLs.
    Owned(Vec<u8>),
    /// Owned, NUL-terminated. Read on the worker thread.
    Path(ZBox),
    Blob(Strong),
}

// `Source::deinit` in Zig only frees owned fields — `Vec<u8>`, `ZString`, and
// `Strong` all implement `Drop`, so no explicit `Drop` body is needed.

// Faithful port of `Image.zig`'s local externs — these C++ helpers are
// Image-specific (they pin/adopt typed-array storage for the off-thread
// pipeline) and have no `bun_jsc` wrapper.
unsafe extern "C" {
    fn JSC__JSValue__unpinArrayBuffer(v: JSValue);
    fn JSC__JSValue__borrowBytesForOffThread(
        v: JSValue,
        out_ptr: *mut *const u8,
        out_len: *mut usize,
    ) -> i32;
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
pub enum Fit {
    Fill,
    Inside,
}
// `pub const Map = bun.ComptimeEnumMap(Fit);` → covered by `strum::EnumString`.
static FIT_MAP: phf::Map<&'static [u8], Fit> = phf::phf_map! {
    b"fill" => Fit::Fill,
    b"inside" => Fit::Inside,
};
impl jsc::FromJsEnum for Fit {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, prop: &'static str) -> JsResult<Self> {
        v.to_enum_from_map(global, prop, &FIT_MAP, "'fill' or 'inside'")
    }
}
impl jsc::FromJsEnum for codecs::Filter {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, prop: &'static str) -> JsResult<Self> {
        v.to_enum_from_map(
            global,
            prop,
            &codecs::FILTER_MAP,
            "'box', 'bilinear', 'linear', 'lanczos3', 'mitchell', 'nearest', 'cubic', 'lanczos2', 'mks2013' or 'mks2021'",
        )
    }
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

#[derive(Clone, Copy, Default)]
pub struct Pipeline {
    pub rotate: u16, // 0/90/180/270
    pub flip: bool,  // vertical
    pub flop: bool,  // horizontal
    pub resize: Option<Resize>,
    pub modulate: Option<Modulate>,
    /// Output settings from `.jpeg()/.png()/.webp()`. `None` ⇒ re-encode in
    /// source format.
    pub output: Option<codecs::EncodeOptions>,
}

#[derive(Clone, Copy)]
pub struct Modulate {
    /// Multiplier; 1.0 = identity.
    pub brightness: f32,
    /// 0 = greyscale, 1 = identity, >1 = boost.
    pub saturation: f32,
}

impl Default for Modulate {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            saturation: 1.0,
        }
    }
}

macro_rules! coerce_int {
    ($T:ty, $x:expr, $lo:expr, $hi:expr) => {{
        let x: f64 = $x;
        if x.is_nan() {
            ($lo) as $T
        } else {
            x.max($lo).min($hi) as $T
        }
    }};
}

const MAX_INPUT_FILE_BYTES: u64 = 256 << 20;

// ───────────────────────────── lifecycle ────────────────────────────────────

impl Image {
    // PORT NOTE: no `#[bun_jsc::host_fn]` here — `#[bun_jsc::JsClass]` on the
    // struct emits the constructor C-ABI shim; the bare attribute would expand
    // to a free-fn call (`constructor(__g, __f)`) that can't resolve in `impl`.
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<Image>> {
        let args = callframe.arguments();
        if args.len() < 1 || args[0].is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Image() expects a path, ArrayBuffer, TypedArray, Blob or data: URL",
            )));
        }
        from_input_js(
            global,
            args[0],
            if args.len() > 1 {
                args[1]
            } else {
                JSValue::UNDEFINED
            },
            this_value,
        )
    }

    pub fn from_blob_js(
        global: &JSGlobalObject,
        blob_value: JSValue,
        options: JSValue,
    ) -> JsResult<JSValue> {
        let mut img = Box::<Image>::default();
        // errdefer img.finalize() — `Box` drops on `?` automatically.
        apply_options(&mut img, global, options)?;
        img.source
            .set(source_from_js(global, blob_value, JSValue::ZERO)?);
        debug_assert!(!matches!(img.source.get(), Source::JsBuffer));
        Ok(img.to_js(global))
    }

    // Codegen's `host_fn_finalize` calls this via `|b| Image::finalize(b)`
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        self.this_ref.with_mut(|r| r.finalize());
        // `source` is dropped by Box drop.
    }

    pub fn estimated_size(&self) -> usize {
        // Only the bytes WE own. .js_buffer is the caller's ArrayBuffer (already
        // counted via the cached value slot); the worker's RGBA scratch is
        // task-scoped and freed before any GC could observe it.
        mem::size_of::<Image>()
            + match self.source.get() {
                Source::JsBuffer | Source::Blob(_) => 0,
                Source::Owned(b) => b.len(),
                Source::Path(p) => p.len(),
            }
    }
}

fn from_input_js(
    global: &JSGlobalObject,
    input: JSValue,
    options: JSValue,
    this_value: JSValue,
) -> JsResult<Box<Image>> {
    let mut img = Box::<Image>::default();
    // `opt.get` can throw (Proxy/getter); without this the heap-allocated
    // *Image and the duplicated source bytes leak. (Handled by `Box` Drop on `?`.)
    img.source.set(source_from_js(global, input, this_value)?);
    apply_options(&mut img, global, options)?;
    Ok(img)
}

fn apply_options(img: &mut Image, global: &JSGlobalObject, opt: JSValue) -> JsResult<()> {
    if !opt.is_object() {
        return Ok(());
    }
    if let Some(v) = opt.get(global, "maxPixels")? {
        if v.is_number() {
            img.max_pixels = coerce_int!(u64, v.as_number(), 0.0, 1e15);
        }
    }
    if let Some(v) = opt.get(global, "autoOrient")? {
        img.auto_orient = v.to_boolean();
    }
    Ok(())
}

fn source_from_js(
    global: &JSGlobalObject,
    value: JSValue,
    this_value: JSValue,
) -> JsResult<Source> {
    // String → file path or data:/base64 URL. Everything else → bytes.
    if value.is_string() {
        let str = bun_core::OwnedString::new(value.to_bun_string(global)?);
        let utf8 = str.to_utf8();
        let s = utf8.slice();
        // `data:[<mime>][;base64],<payload>` — accept any image MIME (we sniff
        // anyway) and decode base64 here. Non-base64 data URLs aren't useful
        // for image bytes.
        if s.starts_with(b"data:") {
            let Some(comma) = strings::index_of_char(s, b',') else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Image(): malformed data: URL (no comma)"
                )));
            };
            let meta = &s[5..comma as usize];
            let payload = &s[comma as usize + 1..];
            if strings::index_of(meta, b";base64").is_none() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Image(): only base64 data: URLs are supported",
                )));
            }
            let mut out = vec![0u8; bun_base64::decode_len(payload)];
            let r = base64::decode(&mut out, payload);
            if r.fail {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Image(): invalid base64 in data: URL"
                )));
            }
            out.truncate(r.written);
            return Ok(Source::Owned(out));
        }
        return Ok(Source::Path(ZBox::from_bytes(s)));
    }
    if let Some(ab) = value.as_array_buffer(global) {
        if ab.resizable || ab.shared {
            return Err(global.throw_invalid_arguments(format_args!(
                "Image(): resizable / shared ArrayBuffer is not supported; pass a fixed-length view (e.g. buf.slice())",
            )));
        }
        // Just remember the JS object — see Source::JsBuffer for why we don't
        // cache the pointer or pin here.
        js::source_js_set_cached(this_value, global, value);
        return Ok(Source::JsBuffer);
    }
    if let Some(blob) = value.as_class_ref::<Blob>() {
        // In-memory blob: dupe its bytes (the store may be sliced/replaced
        // independently).
        let view = blob.shared_view();
        if !view.is_empty() {
            return Ok(Source::Owned(view.to_vec()));
        }
        if blob.store.get().is_some() {
            return Ok(Source::Blob(Strong::create(value, global)));
        }
    }
    Err(global.throw_invalid_arguments(format_args!(
        "Image() input must be a path string, data: URL, ArrayBuffer, TypedArray or Blob",
    )))
}

// ───────────────────────────── chainable ops ────────────────────────────────

impl Image {
    /// R-2 helper: read-modify-write the `Cell<Pipeline>` in one shot so each
    /// chainable setter stays a single field-write under `&self`.
    #[inline]
    fn update_pipeline(&self, f: impl FnOnce(&mut Pipeline)) {
        let mut p = self.pipeline.get();
        f(&mut p);
        self.pipeline.set(p);
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_resize(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.len() < 1 || !args[0].is_number() {
            return Err(
                global.throw_invalid_arguments(format_args!("resize(width, height?, options?)"))
            );
        }
        // 0x3FFF² is the max_pixels default; capping each side at 0x3FFFF (≈262k)
        // keeps every downstream u32 product in range without a per-stage check.
        let mut r = Resize {
            w: coerce_int!(u32, args[0].as_number(), 1.0, 0x3FFFF as f64),
            // 0 height = preserve aspect ratio (resolved at execute time once the
            // source dimensions are known).
            h: if args.len() > 1 && args[1].is_number() {
                coerce_int!(u32, args[1].as_number(), 0.0, 0x3FFFF as f64)
            } else {
                0
            },
            ..Default::default()
        };
        if args.len() > 2 && args[2].is_object() {
            let opt = args[2];
            if let Some(v) = opt.get_optional_enum::<codecs::Filter>(global, "filter")? {
                r.filter = v;
            }
            if let Some(v) = opt.get_optional_enum::<Fit>(global, "fit")? {
                r.fit = v;
            }
            if let Some(v) = opt.get(global, "withoutEnlargement")? {
                r.without_enlargement = v.to_boolean();
            }
        }
        self.update_pipeline(|p| p.resize = Some(r));
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_rotate(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.len() < 1 || !args[0].is_number() {
            return Err(global
                .throw_invalid_arguments(format_args!("rotate(degrees) expects 90, 180 or 270")));
        }
        // coerce_int for the same NaN/Inf/huge-finite reasons as everywhere else;
        // ±1e15 is plenty of headroom for "any multiple of 90 a user might pass".
        let raw: i64 = coerce_int!(i64, args[0].as_number(), -1e15, 1e15);
        let deg: u32 = u32::try_from(raw.rem_euclid(360)).unwrap();
        if deg != 0 && deg != 90 && deg != 180 && deg != 270 {
            return Err(global.throw_invalid_arguments(format_args!(
                "rotate: only multiples of 90 are supported"
            )));
        }
        self.update_pipeline(|p| p.rotate = u16::try_from(deg).expect("int cast"));
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_flip(&self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.update_pipeline(|p| p.flip = true);
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_flop(&self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.update_pipeline(|p| p.flop = true);
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_modulate(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments();
        let mut m: Modulate = self.pipeline.get().modulate.unwrap_or_default();
        if args.len() > 0 && args[0].is_object() {
            let opt = args[0];
            // Clamp finite + bounded so Infinity doesn't reach ModulateImpl as
            // f32 +Inf (0×Inf = NaN → static_cast<u8>(NaN) is UB).
            if let Some(v) = opt.get(global, "brightness")? {
                if v.is_number() {
                    let x = v.as_number();
                    m.brightness = if x.is_finite() {
                        x.clamp(0.0, 1e4) as f32
                    } else {
                        1.0
                    };
                }
            }
            if let Some(v) = opt.get(global, "saturation")? {
                if v.is_number() {
                    let x = v.as_number();
                    m.saturation = if x.is_finite() {
                        x.clamp(0.0, 1e4) as f32
                    } else {
                        1.0
                    };
                }
            }
        }
        self.update_pipeline(|p| p.modulate = Some(m));
        Ok(callframe.this())
    }

    fn set_format(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        fmt: codecs::Format,
    ) -> JsResult<JSValue> {
        let mut enc: codecs::EncodeOptions =
            self.pipeline
                .get()
                .output
                .unwrap_or_else(|| codecs::EncodeOptions {
                    format: fmt,
                    ..Default::default()
                });
        enc.format = fmt;
        let args = callframe.arguments();
        if args.len() > 0 && args[0].is_object() {
            let opt = args[0];
            if let Some(q) = opt.get(global, "quality")? {
                if q.is_number() {
                    enc.quality = coerce_int!(u8, q.as_number(), 1.0, 100.0);
                }
            }
            if let Some(l) = opt.get(global, "lossless")? {
                enc.lossless = l.to_boolean();
            }
            if let Some(c) = opt.get(global, "compressionLevel")? {
                if c.is_number() {
                    enc.compression_level = coerce_int!(i8, c.as_number(), 0.0, 9.0);
                }
            }
            if let Some(p) = opt.get(global, "palette")? {
                enc.palette = p.to_boolean();
            }
            if let Some(c) = opt.get(global, "colors")? {
                if c.is_number() {
                    enc.colors = coerce_int!(u16, c.as_number(), 2.0, 256.0);
                }
            }
            if let Some(d) = opt.get(global, "dither")? {
                enc.dither = d.to_boolean();
            }
            if let Some(p) = opt.get(global, "progressive")? {
                enc.progressive = p.to_boolean();
            }
        }
        self.update_pipeline(|p| p.output = Some(enc));
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_format_jpeg(&self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Jpeg)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_png(&self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Png)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_webp(&self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Webp)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_heic(&self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Heic)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_avif(&self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Avif)
    }
}

fn error_code(e: codecs::Error) -> &'static ZStr {
    use codecs::Error as E;
    match e {
        E::UnknownFormat => zstr!("ERR_IMAGE_UNKNOWN_FORMAT"),
        E::DecodeFailed => zstr!("ERR_IMAGE_DECODE_FAILED"),
        E::EncodeFailed => zstr!("ERR_IMAGE_ENCODE_FAILED"),
        E::TooManyPixels => zstr!("ERR_IMAGE_TOO_MANY_PIXELS"),
        E::UnsupportedOnPlatform => zstr!("ERR_IMAGE_FORMAT_UNSUPPORTED"),
        E::OutOfMemory => zstr!("ERR_OUT_OF_MEMORY"),
    }
}

fn error_message(e: codecs::Error) -> &'static ZStr {
    use codecs::Error as E;
    match e {
        E::UnknownFormat => zstr!(
            "Image: unrecognised format (expected JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC or AVIF)"
        ),
        E::DecodeFailed => zstr!("Image: decode failed"),
        E::EncodeFailed => zstr!("Image: encode failed"),
        E::TooManyPixels => zstr!("Image: input exceeds maxPixels limit"),
        E::UnsupportedOnPlatform => zstr!(
            "Image: format not supported on this machine (HEIC/AVIF/TIFF require the OS codec; AVIF encode needs an AV1 encoder)"
        ),
        E::OutOfMemory => zstr!("Image: out of memory"),
    }
}

fn reject_error(global: &JSGlobalObject, e: codecs::Error) -> JSValue {
    error_with_code(global, error_code(e), error_message(e))
}

fn error_with_code(global: &JSGlobalObject, code: &ZStr, msg: &ZStr) -> JSValue {
    let err = global.create_error_instance(format_args!("{}", bstr::BStr::new(msg.as_bytes())));
    let code_js = jsc::bun_string_jsc::create_utf8_for_js(global, code.as_bytes())
        .unwrap_or(JSValue::UNDEFINED);
    err.put(global, b"code", code_js);
    err
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
enum PinError {
    #[error("detached")]
    Detached,
}

impl Image {
    /// Fresh slice into the input bytes for use ON THE JS THREAD ONLY (re-reads
    /// the ArrayBuffer's vector each call so a detach between construction and
    /// here surfaces as `None` instead of UAF). For off-thread, see `pin_for_task`.
    fn js_thread_bytes(&self, this_value: JSValue, global: &JSGlobalObject) -> Option<&[u8]> {
        // TODO(port): lifetime — JsBuffer arm returns a borrow into the JS heap,
        // not into `self`; may need a different return type.
        match self.source.get() {
            Source::JsBuffer => js::source_js_get_cached(this_value)
                .and_then(|v: JSValue| v.as_array_buffer(global))
                .map(|ab| {
                    // SAFETY: `ArrayBuffer` is a view struct (ptr+len); the
                    // bytes live in the JS heap, not in `ab`. `this_value`
                    // keeps the buffer alive for this JS-thread call — see fn
                    // doc + TODO(port) above re: borrow-into-JS-heap.
                    unsafe { &*std::ptr::from_ref::<[u8]>(ab.byte_slice()) }
                }),
            Source::Owned(b) => Some(b.as_slice()),
            Source::Path(_) | Source::Blob(_) => None,
        }
    }

    fn pin_for_task(
        &self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> Result<Input, PinError> {
        match self.source.get() {
            Source::JsBuffer => {
                let Some(v) = js::source_js_get_cached(this_value) else {
                    return Err(PinError::Detached);
                };
                let mut ptr: *const u8 = core::ptr::null();
                let mut len: usize = 0;
                // SAFETY: FFI call; out-params are valid pointers to locals.
                match unsafe {
                    JSC__JSValue__borrowBytesForOffThread(v, &raw mut ptr, &raw mut len)
                } {
                    0 => Err(PinError::Detached),
                    // FastTypedArray (≤ fastSizeLimit elements, GC-movable): tiny
                    // by definition — dupe instead of forcing JSC to copy via
                    // tryCreate(span()) + allocate a butterfly.
                    1 => {
                        if len == 0 {
                            Err(PinError::Detached)
                        } else {
                            // SAFETY: classifier guarantees `ptr[0..len]` is
                            // valid for the duration of this call (JS thread).
                            let copied = unsafe { bun_core::ffi::slice(ptr, len) }.to_vec();
                            Ok(Input {
                                copied: Some(copied),
                                ..Default::default()
                            })
                        }
                    }
                    2 => {
                        if len == 0 {
                            // SAFETY: helper pinned `v`; unpin before erroring.
                            unsafe { JSC__JSValue__unpinArrayBuffer(v) };
                            Err(PinError::Detached)
                        } else {
                            // SAFETY: pinned for the lifetime of the task;
                            // unpinned in `then()` via `Input::release()`.
                            let bytes = unsafe { bun_core::ffi::slice(ptr, len) };
                            Ok(Input {
                                bytes: bun_ptr::RawSlice::new(bytes),
                                pinned: v,
                                ..Default::default()
                            })
                        }
                    }
                    _ => unreachable!(),
                }
            }
            // SAFETY: `Owned` bytes outlive the task because `this_ref` is held
            // Strong while pending_tasks > 0 (see `schedule()`).
            Source::Owned(b) => Ok(Input {
                bytes: bun_ptr::RawSlice::new(b.as_slice()),
                ..Default::default()
            }),
            Source::Path(p) => Ok(Input {
                path: Some(std::ptr::from_ref::<ZStr>(p.as_zstr())),
                ..Default::default()
            }),
            // schedule() peels this off before pin_for_task is reached.
            Source::Blob(_) => unreachable!(),
        }
    }
}

impl Image {
    pub fn get_backend(global: &JSGlobalObject, _: JSValue, _: PropertyName) -> JsResult<JSValue> {
        // `BACKEND` only ever stores a valid `Backend as u8` discriminant
        // (`set_backend` round-trips through `Backend`); any other value is
        // corruption — trap (matches Zig's safety-checked `@enumFromInt`).
        let b = match codecs::BACKEND.load(core::sync::atomic::Ordering::Relaxed) {
            0 => codecs::Backend::System,
            1 => codecs::Backend::Bun,
            n => unreachable!("invalid image Backend {n}"),
        };
        bun_core::String::static_(<&'static str>::from(&b)).to_js(global)
    }

    pub fn set_backend(
        global: &JSGlobalObject,
        _: JSValue,
        value: JSValue,
        _: PropertyName,
    ) -> bool {
        match value.to_enum::<codecs::Backend>(global, "Bun.Image.backend") {
            Ok(b) => {
                codecs::BACKEND.store(b as u8, core::sync::atomic::Ordering::Relaxed);
                true
            }
            Err(_) => false,
        }
    }

    pub fn from_clipboard(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        // `comptime codecs.system_backend` → cfg-gated module re-export.
        #[cfg(any(target_os = "macos", windows))]
        {
            use codecs::system_backend;
            let bytes = match system_backend::clipboard() {
                Ok(Some(b)) => b,
                Ok(None) => return Ok(JSValue::NULL),
                Err(system_backend::BackendError::OutOfMemory) => {
                    return Err(global.throw_out_of_memory());
                }
                // BackendUnavailable (and any other backend error) ⇔ no image present.
                Err(_) => return Ok(JSValue::NULL),
            };
            let img = Box::new(Image {
                source: JsCell::new(Source::Owned(bytes)),
                ..Default::default()
            });
            return Ok(img.to_js(global));
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = global;
            Ok(JSValue::NULL)
        }
    }

    pub fn has_clipboard_image(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any(target_os = "macos", windows))]
        {
            return Ok(JSValue::from(codecs::system_backend::has_clipboard_image()));
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        Ok(JSValue::FALSE)
    }

    pub fn clipboard_change_count(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        #[cfg(any(target_os = "macos", windows))]
        {
            return Ok(JSValue::js_number(
                codecs::system_backend::clipboard_change_count() as f64,
            ));
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        Ok(JSValue::js_number(-1.0))
    }
}

// ───────────────────────────── getters ──────────────────────────────────────

impl Image {
    #[bun_jsc::host_fn(getter)]
    pub fn get_width(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number(f64::from(self.last_width.get()))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_height(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number(f64::from(self.last_height.get()))
    }
}

// ───────────────────────────── async terminals ──────────────────────────────

impl Image {
    #[bun_jsc::host_fn(method)]
    pub fn do_metadata(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        // Header-only probe is a few dozen byte reads — when the bytes are already
        // in memory it's cheaper to do it inline than to bounce off the WorkPool
        // (~0.4 ms roundtrip). Path-backed sources still go async for the file I/O.
        if let Some(buf) = self.js_thread_bytes(callframe.this(), global) {
            match codecs::probe(buf, self.max_pixels) {
                Ok(p) => {
                    let mut w = p.width;
                    let mut h = p.height;
                    if self.auto_orient && p.format == codecs::Format::Jpeg {
                        let t = exif::read_jpeg(buf).transform();
                        if t.rotate == 90 || t.rotate == 270 {
                            mem::swap(&mut w, &mut h);
                        }
                    }
                    self.last_width.set(i32::try_from(w).expect("int cast"));
                    self.last_height.set(i32::try_from(h).expect("int cast"));
                    let obj = JSValue::create_empty_object(global, 3);
                    obj.put(global, b"width", JSValue::js_number(f64::from(w)));
                    obj.put(global, b"height", JSValue::js_number(f64::from(h)));
                    obj.put(
                        global,
                        b"format",
                        jsc::bun_string_jsc::create_utf8_for_js(
                            global,
                            format_name(p.format).as_bytes(),
                        )?,
                    );
                    return Ok(JSPromise::resolved_promise_value(global, obj));
                }
                // HEIC/AVIF need the system backend → fall through to async.
                Err(codecs::Error::UnsupportedOnPlatform) => {}
                Err(e) => {
                    return Ok(JSPromise::rejected_promise(global, reject_error(global, e))
                        .as_value(global));
                }
            }
        }
        self.schedule(
            global,
            callframe.this(),
            Kind::Metadata,
            Deliver::Uint8Array,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_bytes(&self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(
            global,
            cf.this(),
            Kind::Encode(self.pipeline.get().output),
            Deliver::Uint8Array,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_buffer(&self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(
            global,
            cf.this(),
            Kind::Encode(self.pipeline.get().output),
            Deliver::Buffer,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_blob(&self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(
            global,
            cf.this(),
            Kind::Encode(self.pipeline.get().output),
            Deliver::Blob,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_to_base64(&self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(
            global,
            cf.this(),
            Kind::Encode(self.pipeline.get().output),
            Deliver::Base64,
        )
    }

    /// `data:image/{format};base64,{…}`. Same encode as `.toBase64()` plus the
    /// MIME prefix, so it drops straight into `<img src>`.
    #[bun_jsc::host_fn(method)]
    pub fn do_data_url(&self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(
            global,
            cf.this(),
            Kind::Encode(self.pipeline.get().output),
            Deliver::DataUrl,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_placeholder(&self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments();
        // Single positional `"dataurl"` for now — leaves room for `"hash"` /
        // `"color"` without growing methods. Anything else throws so the
        // option space isn't accidentally squatted.
        if args.len() > 0 && !args[0].is_undefined_or_null() {
            let s = bun_core::OwnedString::new(args[0].to_bun_string(global)?);
            if !s.eql_utf8(b"dataurl") {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Image.placeholder(): only \"dataurl\" is supported",
                )));
            }
        }
        self.schedule(global, cf.this(), Kind::Placeholder, Deliver::DataUrl)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_write(&self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments();
        if args.len() < 1 || args[0].is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Image.write(dest): expected a path, Bun.file, Bun.s3 or fd",
            )));
        }

        let mut output = self.pipeline.get().output;
        // Extension inference only when dest is a plain string. BunFile/S3 dests
        // carry no extension contract, so the explicit `.png()` etc. (or source
        // format) decides.
        if output.is_none() && args[0].is_string() {
            let str = bun_core::OwnedString::new(args[0].to_bun_string(global)?);
            let utf8 = str.to_utf8();
            if let Some(f) = codecs::Format::from_extension(utf8.slice()) {
                match f {
                    // Only infer formats we can ENCODE; decode-only extensions
                    // (.bmp/.tiff/.gif) fall through to the source-format default.
                    codecs::Format::Jpeg
                    | codecs::Format::Png
                    | codecs::Format::Webp
                    | codecs::Format::Heic
                    | codecs::Format::Avif => {
                        output = Some(codecs::EncodeOptions {
                            format: f,
                            ..Default::default()
                        });
                    }
                    _ => {}
                }
            }
        }
        self.schedule(
            global,
            cf.this(),
            Kind::Encode(output),
            Deliver::WriteDest(Strong::create(args[0], global)),
        )
    }
}

impl Image {
    fn schedule(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        kind: Kind,
        deliver: Deliver,
    ) -> JsResult<JSValue> {
        if matches!(self.source.get(), Source::Blob(_)) {
            return BlobReadChain::start(self, global, this_value, kind, deliver);
        }
        let input = match self.pin_for_task(this_value, global) {
            Ok(i) => i,
            Err(PinError::Detached) => {
                // `deliver` may own a Strong; the task that would have freed it
                // in Drop is never created on this branch.
                drop(deliver);
                return Ok(JSPromise::rejected_promise(
                    global,
                    error_with_code(
                        global,
                        zstr!("ERR_INVALID_STATE"),
                        zstr!("Image: source ArrayBuffer was detached"),
                    ),
                )
                .as_value(global));
            }
        };
        let job = Box::new(PipelineTask {
            image: std::ptr::from_ref::<Image>(self),
            global,
            // Struct copy — the worker reads its own snapshot so further chained
            // calls on the JS side between schedule and completion don't race.
            pipeline: self.pipeline.get(),
            input,
            kind,
            deliver,
            max_pixels: self.max_pixels,
            auto_orient: self.auto_orient,
            result: TaskResult::Err(codecs::Error::DecodeFailed),
        });
        // First in-flight task ⇒ hold a Strong ref to the wrapper so GC can't
        // collect it (and its sourceJS slot, and the pinned ArrayBuffer) until
        // `then()` drops the count back to 0.
        if self.pending_tasks.get() == 0 {
            self.this_ref.with_mut(|r| r.set_strong(this_value, global));
        }
        self.pending_tasks.set(self.pending_tasks.get() + 1);
        let task = ConcurrentPromiseTask::<PipelineTask<'_>>::create_on_js_thread(global, job);
        let promise_value = task.promise.value();
        // Ownership transfers to the WorkPool / event-loop dispatch
        // (`task_tag::AsyncImageTask` → `run_from_js` → `destroy`).
        let raw = bun_core::heap::into_raw(task);
        // SAFETY: `raw` is freshly leaked; `schedule()` only writes the
        // intrusive `task` field into the work-pool queue. The worker thread
        // touches `ctx`/`task` only; `promise` was read above on this thread.
        unsafe { (*raw).schedule() };
        Ok(promise_value)
    }

    pub fn encode_for_body(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<(codecs::Encoded, &'static ZStr)> {
        if let Source::Blob(strong) = self.source.get() {
            const REFUSE: &str = "Image: fd/S3-backed Bun.file as a Response body — pass `await file.bytes()` or a path string";
            let blob_js = strong.get();
            let Some(blob) = blob_js.as_class_ref::<Blob>() else {
                return Err(global.throw(format_args!("{REFUSE}")));
            };
            if let Some(store) = blob.store.get() {
                if let blob_store::Data::File(file) = &store.data {
                    if let PathOrFileDescriptor::Path(path) = &file.pathlike {
                        let p = ZBox::from_bytes(path.slice());
                        // `Source::Blob`'s `Strong` Drop releases the JS ref.
                        self.source.set(Source::Path(p));
                    } else {
                        return Err(global.throw(format_args!("{REFUSE}")));
                    }
                } else {
                    return Err(global.throw(format_args!("{REFUSE}")));
                }
            } else {
                return Err(global.throw(format_args!("{REFUSE}")));
            }
        }
        let input = match self.pin_for_task(this_value, global) {
            Ok(i) => i,
            Err(PinError::Detached) => {
                return Err(global.throw(format_args!("Image: source ArrayBuffer was detached")));
            }
        };
        let mut task = mem::ManuallyDrop::new(PipelineTask {
            image: std::ptr::from_ref::<Image>(self),
            global,
            pipeline: self.pipeline.get(),
            input,
            kind: Kind::Encode(self.pipeline.get().output),
            deliver: Deliver::Uint8Array,
            max_pixels: self.max_pixels,
            auto_orient: self.auto_orient,
            result: TaskResult::Err(codecs::Error::DecodeFailed),
        });
        task.run();
        // PORT NOTE: reshaped for borrowck — move `result` out via `replace`
        // since `task` is behind `ManuallyDrop` deref.
        let result = mem::replace(
            &mut task.result,
            TaskResult::Err(codecs::Error::DecodeFailed),
        );
        // Zig `defer input.release()` (see PORT NOTE above).
        mem::take(&mut task.input).release();
        match result {
            TaskResult::Encoded { out, format, w, h } => {
                self.last_width.set(i32::try_from(w).expect("int cast"));
                self.last_height.set(i32::try_from(h).expect("int cast"));
                Ok((out, format.mime()))
            }
            TaskResult::Err(e) => Err(global.throw(format_args!(
                "{}",
                bstr::BStr::new(error_message(e).as_bytes())
            ))),
            // Preserve errno/path/syscall instead of flattening to DecodeFailed.
            TaskResult::IoErr(e) => Err(global.throw_value(e.to_js(global))),
            TaskResult::Meta { .. } => unreachable!(),
        }
    }
}

// ───────────────────────────── worker task ──────────────────────────────────

struct BlobReadChain<'a> {
    image: *const Image,
    global: &'a JSGlobalObject,
    kind: Kind,
    deliver: Deliver,
    outer: jsc::JSPromiseStrong,
}

impl<'a> BlobReadChain<'a> {
    fn start(
        image: &Image,
        global: &'a JSGlobalObject,
        this_value: JSValue,
        kind: Kind,
        deliver: Deliver,
    ) -> JsResult<JSValue> {
        // `deliver` may carry a `.write_dest` Strong; on these defensive
        // early-returns the chain is never created so its Drop can't free it.
        // (Same contract as schedule()'s detached-buffer branch.)
        let Source::Blob(strong) = image.source.get() else {
            unreachable!()
        };
        let blob_js = strong.get();
        let Some(blob) = blob_js.as_::<Blob>() else {
            drop(deliver);
            return Err(global.throw(format_args!("Image: Blob source is no longer a Blob")));
        };
        // SAFETY: `as_` returned a non-null `*mut Blob` rooted by `blob_js`.
        let blob = unsafe { &mut *blob };

        // Same Strong-ref contract as the regular pending_tasks bump — keeps
        // the wrapper (and its sourceJS slot) alive until the read settles.
        if image.pending_tasks.get() == 0 {
            image
                .this_ref
                .with_mut(|r| r.set_strong(this_value, global));
        }
        image.pending_tasks.set(image.pending_tasks.get() + 1);

        let chain = Box::new(BlobReadChain {
            image: std::ptr::from_ref::<Image>(image),
            global,
            kind,
            deliver,
            outer: jsc::JSPromiseStrong::init(global),
        });
        let promise = chain.outer.value();
        let raw = bun_core::heap::into_raw(chain);
        // SAFETY: `raw` is freshly leaked and uniquely owned by the read
        // dispatch; reclaimed in `<BlobReadChain as ReadBytesHandler>::on_read_bytes`.
        unsafe { blob.read_bytes_to_handler(&raw mut *raw, global) }.map_err(jsc::JsError::from)?;
        Ok(promise)
    }

    /// JS thread — `read_bytes_to_handler` guarantees this. `r.ok` is owned by us.
    fn on_read_bytes_impl(self, r: ReadBytesResult) {
        let global = self.global;
        // SAFETY: `image` is a BACKREF kept alive by the Strong `this_ref`
        // bump in `start()`; we are on the JS thread. R-2: shared deref —
        // mutation goes through `Cell`/`JsCell`.
        let image = unsafe { &*self.image };
        let mut outer = self.outer;
        let kind = self.kind;
        let deliver = self.deliver;
        // `bun.destroy(self)` — Box drops at end of scope.

        image.pending_tasks.set(image.pending_tasks.get() - 1);
        if image.pending_tasks.get() == 0 {
            image.this_ref.with_mut(|r| r.downgrade());
        }
        // `defer outer.deinit()` — `JSPromiseStrong` Drop handles this.

        match r {
            ReadBytesResult::Ok(bytes) => {
                if matches!(image.source.get(), Source::Blob(_)) {
                    image.source.set(Source::Owned(bytes));
                } else {
                    drop(bytes);
                }
                let Some(this_value) = image.this_ref.get().try_get() else {
                    let _ = outer.reject(
                        global,
                        Ok(global.create_error_instance(format_args!(
                            "Image: collected before read completed"
                        ))),
                    );
                    drop(deliver);
                    return;
                };
                // Source is now `.owned`; this re-entry takes the regular path.
                let inner = match image.schedule(global, this_value, kind, deliver) {
                    Ok(v) => v,
                    Err(_) => {
                        // PORT NOTE: `deliver` was moved into `schedule()`; on
                        // error it has already been dropped there.
                        let _ = outer.reject(
                            global,
                            Ok(global.create_error_instance(format_args!(
                                "Image: pipeline schedule failed"
                            ))),
                        );
                        return;
                    }
                };
                let _ = outer.resolve(global, inner);
            }
            ReadBytesResult::Err(e) => {
                drop(deliver);
                let _ = outer.reject(global, Ok(e.to_error_instance(global)));
            }
        }
    }
}

impl<'a> ReadBytesHandler for BlobReadChain<'a> {
    fn on_read_bytes(&mut self, result: ReadBytesResult) {
        // SAFETY: `self` is the `&mut *heap::alloc(chain)` handed to
        // `read_bytes_to_handler` in `start()`; we are the sole consumer on
        // the JS thread. Reconstruct the Box so the body can move fields out
        // and free the allocation (mirrors Zig `bun.destroy(self)`).
        let boxed = unsafe { bun_core::heap::take(std::ptr::from_mut::<Self>(self)) };
        boxed.on_read_bytes_impl(result);
    }
}

/// `jsc.ConcurrentPromiseTask(PipelineTask)` — the heap object the event-loop
/// dispatch sees (`task_tag::AsyncImageTask`).
pub type AsyncImageTask<'a> = ConcurrentPromiseTask<'a, PipelineTask<'a>>;

impl<'a> ConcurrentPromiseTaskContext for PipelineTask<'a> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::AsyncImageTask;
    #[inline]
    fn run(&mut self) {
        PipelineTask::run(self)
    }
    #[inline]
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        PipelineTask::then(self, promise)
    }
}

pub struct PipelineTask<'a> {
    image: *const Image,
    global: &'a JSGlobalObject,
    pipeline: Pipeline,
    input: Input,
    kind: Kind,
    deliver: Deliver,
    max_pixels: u64,
    auto_orient: bool,
    result: TaskResult,
}

/// Bytes for the worker. `.pinned` is the JS ArrayBuffer/view to unpin in
/// `then()` — `.zero` for owned/path sources (nothing to unpin).
pub struct Input {
    // Borrows pinned ArrayBuffer or `image.source.owned`; the owning `Image`
    // is held via BACKREF for the task's lifetime — `RawSlice` invariant.
    bytes: bun_ptr::RawSlice<u8>,
    // TODO(port): lifetime — borrows `image.source.path` (NUL-terminated).
    path: Option<*const ZStr>,
    /// JS value to `unpinArrayBuffer` in `then()`. `.zero` for sources
    /// with no ArrayBuffer to pin (Oversize TA, owned, path, copied).
    pinned: JSValue,
    /// Our own dupe of a FastTypedArray's bytes — freed in `then()`.
    copied: Option<Vec<u8>>,
}

impl Default for Input {
    fn default() -> Self {
        Self {
            bytes: bun_ptr::RawSlice::EMPTY,
            path: None,
            pinned: JSValue::ZERO,
            copied: None,
        }
    }
}

impl Input {
    fn slice(&self) -> &[u8] {
        if let Some(c) = &self.copied {
            return c.as_slice();
        }
        self.bytes.slice()
    }
    fn release(mut self) {
        if !self.pinned.is_empty() {
            // SAFETY: JS thread; `pinned` was returned by
            // `JSC__JSValue__borrowBytesForOffThread` with mode 2.
            unsafe { JSC__JSValue__unpinArrayBuffer(self.pinned) };
        }
        self.copied = None;
    }
}

pub enum Deliver {
    Uint8Array,
    Buffer,
    Blob,
    Base64,
    /// Like `.base64` plus a `data:{mime};base64,` prefix — same encode
    /// path, the prefix is the only difference.
    DataUrl,
    /// `.write(dest)` — `then()` hands the encoded bytes to `Bun.write`'s
    /// implementation with this as the destination. Anything `Bun.write`
    /// accepts (path string / BunFile / S3 / fd) works here unchanged.
    WriteDest(Strong),
}
// `Deliver::deinit` is just `Strong::Drop` on the `WriteDest` arm — handled
// automatically.

pub enum Kind {
    /// `None` ⇒ re-encode in the source format (resolved after decode).
    Encode(Option<codecs::EncodeOptions>),
    Metadata,
    Placeholder,
}

// PORT NOTE: renamed from `Result` to avoid shadowing `core::result::Result`.
pub enum TaskResult {
    Encoded {
        out: codecs::Encoded,
        format: codecs::Format,
        w: u32,
        h: u32,
    },
    Meta {
        w: u32,
        h: u32,
        format: codecs::Format,
    },
    Err(codecs::Error),
    IoErr(sys::Error),
}

impl<'a> PipelineTask<'a> {
    /// Runs on a `WorkPool` thread. No JSC access.
    pub fn run(&mut self) {
        // `self.input` was prepared on the JS thread by `pin_for_task`: either a
        // pinned ArrayBuffer slice (pin lives until `then()` unpins), an owned
        // buffer, or a path to read here.
        let owned_file: Option<Vec<u8>>;
        let input: &[u8] = if let Some(p) = self.input.path {
            // SAFETY: `p` borrows `image.source.path`, which outlives the task
            // because `this_ref` is held Strong while pending_tasks > 0.
            let p: &ZStr = unsafe { &*p };
            #[cfg(unix)]
            let oflags = sys::O::RDONLY | sys::O::NONBLOCK;
            #[cfg(not(unix))]
            let oflags = sys::O::RDONLY;
            let file = match sys::File::openat(sys::Fd::cwd(), p, oflags, 0) {
                sys::Result::Ok(f) => f,
                sys::Result::Err(e) => {
                    self.result = TaskResult::IoErr(e.with_path(p.as_bytes()));
                    return;
                }
            };
            // `defer file.close()` — assume `sys::File` closes on Drop.
            let st = match file.stat() {
                sys::Result::Ok(s) => s,
                sys::Result::Err(e) => {
                    self.result = TaskResult::IoErr(e.with_path(p.as_bytes()));
                    return;
                }
            };
            if !sys::S::ISREG(st.st_mode as _) {
                self.result = TaskResult::IoErr(sys::Error {
                    errno: sys::E::ENODEV as _,
                    syscall: sys::Tag::read,
                    path: p.as_bytes().to_vec().into_boxed_slice(),
                    ..Default::default()
                });
                return;
            }
            if u64::try_from(st.st_size.max(0)).expect("int cast") > MAX_INPUT_FILE_BYTES {
                self.result = TaskResult::Err(codecs::Error::TooManyPixels);
                return;
            }
            match file.read_to_end() {
                Ok(bytes) => owned_file = Some(bytes),
                Err(e) => {
                    self.result = TaskResult::IoErr(e.with_path(p.as_bytes()));
                    return;
                }
            }
            owned_file.as_deref().unwrap()
        } else {
            self.input.slice()
        };

        if matches!(self.kind, Kind::Metadata) {
            match codecs::probe(input, self.max_pixels) {
                Ok(p) => {
                    let mut w = p.width;
                    let mut h = p.height;
                    if self.auto_orient && p.format == codecs::Format::Jpeg {
                        let t = exif::read_jpeg(input).transform();
                        if t.rotate == 90 || t.rotate == 270 {
                            mem::swap(&mut w, &mut h);
                        }
                    }
                    self.result = TaskResult::Meta {
                        w,
                        h,
                        format: p.format,
                    };
                    return;
                }
                // HEIC/AVIF have no header probe — fall through to full decode
                // via the system backend.
                Err(codecs::Error::UnsupportedOnPlatform) => {}
                Err(e) => {
                    self.result = TaskResult::Err(e);
                    return;
                }
            }
        }

        let hint: codecs::DecodeHint = if let Some(r) = self.pipeline.resize {
            let mut tw = r.w;
            // r.h==0 means "preserve aspect" — constrain on width only.
            let mut th = if r.h != 0 { r.h } else { r.w };
            let swap_explicit = self.pipeline.rotate == 90 || self.pipeline.rotate == 270;
            let swap_exif = self.auto_orient && {
                let t = exif::read_jpeg(input).transform();
                t.rotate == 90 || t.rotate == 270
            };
            if swap_explicit != swap_exif {
                mem::swap(&mut tw, &mut th);
            }
            codecs::DecodeHint {
                target_w: tw,
                target_h: th,
            }
        } else {
            codecs::DecodeHint::default()
        };

        let mut decoded = match codecs::decode(input, self.max_pixels, hint) {
            Ok(d) => d,
            Err(e) => {
                self.result = TaskResult::Err(e);
                return;
            }
        };
        // `defer decoded.deinit()` — `codecs::Decoded` Drop frees rgba/icc.

        let src_format = codecs::Format::sniff(input).unwrap_or(codecs::Format::Png);

        // EXIF auto-orient: applied BEFORE any user op so resize targets and
        // metadata report the visually-upright dimensions, the way Sharp does.
        if self.auto_orient && src_format == codecs::Format::Jpeg {
            let orient = exif::read_jpeg(input);
            if orient != exif::Orientation::Normal {
                if let Err(e) = apply_orientation(&mut decoded, orient) {
                    self.result = TaskResult::Err(e);
                    return;
                }
            }
        }

        if matches!(self.kind, Kind::Metadata) {
            // Reached only for HEIC/AVIF (probe fell through).
            self.result = TaskResult::Meta {
                w: decoded.width,
                h: decoded.height,
                format: src_format,
            };
            return;
        }

        if matches!(self.kind, Kind::Placeholder) {
            self.result = match make_placeholder(&decoded.rgba, decoded.width, decoded.height) {
                Ok(r) => r,
                Err(e) => TaskResult::Err(e),
            };
            return;
        }

        if let Err(e) = self.apply_pipeline(&mut decoded) {
            self.result = TaskResult::Err(e);
            return;
        }

        let Kind::Encode(enc_opt) = &self.kind else {
            unreachable!()
        };
        let mut enc: codecs::EncodeOptions = enc_opt.unwrap_or(codecs::EncodeOptions {
            format: match src_format {
                codecs::Format::Bmp | codecs::Format::Tiff | codecs::Format::Gif => {
                    codecs::Format::Png
                }
                f => f,
            },
            ..Default::default()
        });
        if enc.icc_profile.is_none() {
            // `EncodeOptions.icc_profile` borrows for the duration of `encode()`
            // (raw `NonNull<[u8]>`); `decoded` outlives the call below.
            enc.icc_profile = decoded.icc_profile.as_deref().map(core::ptr::NonNull::from);
        }
        let out = match codecs::encode(&decoded.rgba, decoded.width, decoded.height, enc) {
            Ok(o) => o,
            Err(e) => {
                self.result = TaskResult::Err(e);
                return;
            }
        };

        self.result = TaskResult::Encoded {
            out,
            format: enc.format,
            w: decoded.width,
            h: decoded.height,
        };
    }

    /// Back on the JS thread.
    pub fn then(&mut self, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        mem::take(&mut self.input).release();
        let global = self.global;
        // SAFETY: BACKREF; JS thread; wrapper kept alive by `this_ref` Strong.
        // R-2: shared deref — mutation goes through `Cell`.
        let image = unsafe { &*self.image };
        // Stash final dims here (JS thread) — `run()` is on a WorkPool thread
        // so writing `self.image.*` there would race the synchronous getters.
        match &self.result {
            TaskResult::Encoded { w, h, .. } | TaskResult::Meta { w, h, .. } => {
                image.last_width.set(i32::try_from(*w).expect("int cast"));
                image.last_height.set(i32::try_from(*h).expect("int cast"));
            }
            _ => {}
        }
        // PORT NOTE: `Drop` forbids moving out of `self.result`; swap in a
        // throwaway sentinel (`Err` is `Copy`) and match the owned local.
        let result = mem::replace(
            &mut self.result,
            TaskResult::Err(codecs::Error::UnknownFormat),
        );
        match result {
            TaskResult::Encoded { out, format, .. } => {
                // Ownership of `out.bytes` is transferred to JS below; suppress
                // the codec `Drop` so the deallocator runs exactly once (via the
                // ArrayBuffer/Buffer finalizer or explicit drop).
                let out = mem::ManuallyDrop::new(out);
                // SAFETY: `out.bytes` is a non-null fat pointer into a live
                // codec allocation; valid until `out.free` runs.
                let out_slice: &[u8] = unsafe { out.bytes.as_ref() };
                match &mut self.deliver {
                    // The codec's own allocation is handed straight to JS with the
                    // codec's free as the finalizer — no dupe of the output.
                    Deliver::Uint8Array => {
                        // SAFETY: see `out_slice` above; mutability is for the
                        // `from_bytes` signature only — JS takes ownership.
                        let mut_slice = unsafe {
                            core::slice::from_raw_parts_mut(
                                out.bytes.as_ptr().cast::<u8>(),
                                out_slice.len(),
                            )
                        };
                        let v = ArrayBuffer::from_bytes(mut_slice, jsc::JSType::Uint8Array)
                            .to_js_with_context(global, core::ptr::null_mut(), Some(out.free));
                        match v {
                            Ok(v) => promise.resolve(global, v)?,
                            Err(_) => return promise.reject(global, Err(jsc::JsError::Thrown)),
                        }
                    }
                    // createBufferWithCtx returns plain JSValue (its C++ side asserts
                    // the no-throw contract), so the .uint8array catch is unmatched
                    // here by construction, not omission.
                    Deliver::Buffer => promise.resolve(
                        global,
                        // SAFETY: `out.bytes` is the codec-owned allocation whose
                        // ownership transfers to JSC; `ctx` is null and `out.free`
                        // ignores it.
                        unsafe {
                            JSValue::create_buffer_with_ctx(
                                global,
                                out.bytes,
                                core::ptr::null_mut(),
                                out.free,
                            )
                        },
                    )?,
                    Deliver::Blob => {
                        // Blob.Store frees via an Allocator; dupe for that path.
                        let owned = out_slice.to_vec();
                        // SAFETY: explicit free in lieu of suppressed `Drop`.
                        unsafe { (out.free)(out.bytes.as_ptr().cast(), core::ptr::null_mut()) };
                        let blob = Blob::init(owned, global);
                        blob.content_type
                            .set(std::ptr::from_ref::<[u8]>(format.mime().as_bytes()));
                        blob.content_type_was_set.set(true);
                        promise.resolve(global, <Blob as bun_jsc::JsClass>::to_js(blob, global))?;
                    }
                    tag @ (Deliver::Base64 | Deliver::DataUrl) => {
                        let _out = mem::ManuallyDrop::into_inner(out);
                        // `data:` and `;base64,` are both ASCII so the prefix
                        // length is exact; one buffer holds prefix+payload.
                        let mut pre_buf = [0u8; 40];
                        let pre: &[u8] = if matches!(tag, Deliver::DataUrl) {
                            use std::io::Write;
                            let mut w = &mut pre_buf[..];
                            write!(
                                w,
                                "data:{};base64,",
                                bstr::BStr::new(format.mime().as_bytes())
                            )
                            .expect("unreachable");
                            let written = 40 - w.len();
                            &pre_buf[..written]
                        } else {
                            b""
                        };
                        let mut buf = vec![0u8; pre.len() + base64::encode_len(out_slice)];
                        buf[..pre.len()].copy_from_slice(pre);
                        let wrote = pre.len() + base64::encode(&mut buf[pre.len()..], out_slice);
                        let str =
                            match jsc::bun_string_jsc::create_utf8_for_js(global, &buf[..wrote]) {
                                Ok(s) => s,
                                Err(_) => return promise.reject(global, Err(jsc::JsError::Thrown)),
                            };
                        promise.resolve(global, str)?;
                    }
                    Deliver::WriteDest(dest) => {
                        let dest_js = dest.get();
                        // SAFETY: `out.bytes` is the codec-owned allocation whose
                        // ownership transfers to JSC; `ctx` is null and `out.free`
                        // ignores it.
                        let data = unsafe {
                            JSValue::create_buffer_with_ctx(
                                global,
                                out.bytes,
                                core::ptr::null_mut(),
                                out.free,
                            )
                        };
                        // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine`
                        // valid for the JS thread; `ArgumentsSlice::init` wants `&`.
                        let args = [dest_js];
                        let mut arg_slice = jsc::ArgumentsSlice::init(global.bun_vm(), &args);
                        let mut path_or_blob = match crate::node::PathOrBlob::from_js_no_copy(
                            global,
                            &mut arg_slice,
                        ) {
                            Ok(p) => p,
                            Err(_) => return promise.reject(global, Err(jsc::JsError::Thrown)),
                        };
                        // PORT NOTE: `PathOrBlob::Path` owns its `PathOrFileDescriptor`
                        // and frees on Drop — no explicit `path.deinit()` needed.
                        let write_promise = match crate::webcore::blob::write_file_internal(
                            global,
                            &mut path_or_blob,
                            data,
                            Default::default(),
                        ) {
                            Ok(p) => p,
                            Err(_) => return promise.reject(global, Err(jsc::JsError::Thrown)),
                        };
                        promise.resolve(global, write_promise)?;
                    }
                }
            }
            TaskResult::Meta { w, h, format } => {
                let obj = JSValue::create_empty_object(global, 3);
                obj.put(global, b"width", JSValue::js_number(f64::from(w)));
                obj.put(global, b"height", JSValue::js_number(f64::from(h)));
                let fmt_js =
                    jsc::bun_string_jsc::create_utf8_for_js(global, format_name(format).as_bytes())
                        .unwrap_or(JSValue::UNDEFINED);
                obj.put(global, b"format", fmt_js);
                promise.resolve(global, obj)?;
            }
            TaskResult::Err(e) => promise.reject(global, Ok(reject_error(global, e)))?,
            TaskResult::IoErr(e) => promise.reject(global, Ok(e.to_js(global)))?,
        }
        Ok(())
    }

    fn apply_pipeline(&self, d: &mut codecs::Decoded) -> Result<(), codecs::Error> {
        let p = &self.pipeline;
        if p.rotate != 0 {
            let next = codecs::rotate(&d.rgba, d.width, d.height, u32::from(p.rotate))?;
            // PORT NOTE: `bun.default_allocator.free(d.rgba)` — assignment drops
            // the old `Vec<u8>`/owned buffer.
            d.rgba = next.rgba;
            d.width = next.width;
            d.height = next.height;
        }
        if p.flip {
            let next = codecs::flip(&d.rgba, d.width, d.height, false)?;
            d.rgba = next;
        }
        if p.flop {
            let next = codecs::flip(&d.rgba, d.width, d.height, true)?;
            d.rgba = next;
        }
        if let Some(r) = p.resize {
            let t = resolve_resize(r, d.width, d.height);
            if (t.0 as u64) * (t.1 as u64) > self.max_pixels
                || (t.0 as u64) * (d.height as u64) > self.max_pixels
            {
                return Err(codecs::Error::TooManyPixels);
            }
            if t.0 != d.width || t.1 != d.height {
                let next = codecs::resize(&d.rgba, d.width, d.height, t.0, t.1, r.filter)?;
                d.rgba = next;
                d.width = t.0;
                d.height = t.1;
            }
        }
        if let Some(m) = p.modulate {
            codecs::modulate(&mut d.rgba, m.brightness, m.saturation);
        }
        Ok(())
    }
}

fn make_placeholder(rgba: &[u8], sw: u32, sh: u32) -> Result<TaskResult, codecs::Error> {
    const MAX_IN: u32 = 100;
    let mut w = sw;
    let mut h = sh;
    let mut owned: Option<Vec<u8>> = None;
    let mut pixels: &[u8] = rgba;
    if w > MAX_IN || h > MAX_IN {
        let r = (w as f32) / (h as f32);
        if r > 1.0 {
            w = MAX_IN;
            h = 1u32.max(((MAX_IN as f32) / r).round() as u32);
        } else {
            h = MAX_IN;
            w = 1u32.max(((MAX_IN as f32) * r).round() as u32);
        }
        owned = Some(codecs::resize(rgba, sw, sh, w, h, codecs::Filter::Box)?);
        pixels = owned.as_deref().unwrap();
    }
    let mut buf = [0u8; thumbhash::MAX_LEN];
    let hash = thumbhash::encode(&mut buf, w, h, pixels);
    let rendered = thumbhash::decode(hash)?;
    // `defer bun.default_allocator.free(rendered.rgba)` — owned, drops at scope exit.
    // Placeholder is a synthetic ThumbHash render, not the source image —
    // no ICC profile attaches to it.
    let out = codecs::png::encode(&rendered.rgba, rendered.w, rendered.h, -1, None)?;
    let _ = owned; // PERF(port): explicit lifetime hint; drops here.
    Ok(TaskResult::Encoded {
        out,
        format: codecs::Format::Png,
        w: rendered.w,
        h: rendered.h,
    })
}

/// Map a resize spec to concrete output dims given the current dims.
fn resolve_resize(r: Resize, sw: u32, sh: u32) -> (u32, u32) {
    let mut w = r.w;
    let mut h: u32 = if r.h != 0 {
        r.h
    } else {
        u32::try_from((0x3FFFFu64).min(1u64.max((r.w as u64) * (sh as u64) / (sw as u64)))).unwrap()
    };
    if r.fit == Fit::Inside {
        // Shrink the box so the source's aspect ratio is preserved and
        // both sides fit. (Sharp's `fit:'inside'`.)
        let sx = (w as f64) / (sw as f64);
        let sy = (h as f64) / (sh as f64);
        let s = sx.min(sy);
        w = 1u32.max(((sw as f64) * s).round() as u32);
        h = 1u32.max(((sh as f64) * s).round() as u32);
    }
    if r.without_enlargement && (w > sw || h > sh) {
        return (sw, sh);
    }
    (w, h)
}

fn apply_orientation(
    d: &mut codecs::Decoded,
    orient: exif::Orientation,
) -> Result<(), codecs::Error> {
    let t = orient.transform();
    if t.flip {
        let next = codecs::flip(&d.rgba, d.width, d.height, false)?;
        d.rgba = next;
    }
    if t.flop {
        let next = codecs::flip(&d.rgba, d.width, d.height, true)?;
        d.rgba = next;
    }
    if t.rotate != 0 {
        // Swap pixel slots only — `next` carries no ICC profile, and the
        // one on `d` (set by decode) must survive EXIF auto-orient.
        let next = codecs::rotate(&d.rgba, d.width, d.height, u32::from(t.rotate))?;
        d.rgba = next.rgba;
        d.width = next.width;
        d.height = next.height;
    }
    Ok(())
}

impl<'a> Drop for PipelineTask<'a> {
    fn drop(&mut self) {
        // Only reached from `then()` on the JS thread (the `encode_for_body`
        // stack temporary is wrapped in `ManuallyDrop` — Zig never calls
        // `deinit()` on that path), so the ref/count touch is safe without
        // atomics.
        // `self.deliver.deinit()` — `Strong` Drop on the `WriteDest` arm.
        // SAFETY: `image` is a BACKREF kept alive by the wrapper's Strong
        // `this_ref` while pending_tasks > 0; we are on the JS thread.
        // R-2: shared deref — mutation goes through `Cell`/`JsCell`.
        let image = unsafe { &*self.image };
        image.pending_tasks.set(image.pending_tasks.get() - 1);
        if image.pending_tasks.get() == 0 {
            image.this_ref.with_mut(|r| r.downgrade());
        }
        // `bun.destroy(this)` — `Box<PipelineTask>` drop is the caller.
    }
}

// ported from: src/runtime/image/Image.zig
