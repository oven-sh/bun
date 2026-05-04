//! `Bun.Image` — Sharp-shaped image pipeline backed by the statically linked
//! libjpeg-turbo / libspng / libwebp codecs and the highway resize kernel.
//!
//! Shape: the constructor only captures the *input* (path or bytes). Chainable
//! mutators (`resize`, `rotate`, `flip`, `flop`, `jpeg`/`png`/`webp`) each
//! write one slot of `Pipeline` and return `this` — there is no op list, so
//! calling a setter twice overwrites. The actual decode → transform → encode
//! work happens off-thread when a terminal (`bytes`/`buffer`/`blob`/
//! `toBase64`/`metadata`) is awaited, via `jsc.ConcurrentPromiseTask`.

use core::ffi::c_int;
use core::mem;

use bun_core::base64;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSValue, JsRef, JsResult,
    Strong, ZigString,
};
use bun_runtime::webcore::Blob;
use bun_str::{self as strings, ZStr};
use bun_sys as sys;

use super::codecs;
use super::exif;
use super::thumbhash;

// `pub const js = jsc.Codegen.JSImage;` and the `fromJS`/`fromJSDirect`/`toJS`
// re-exports are provided by `#[bun_jsc::JsClass]` codegen — see PORTING.md
// §JSC types. `js.sourceJSSetCached` / `js.sourceJSGetCached` are likewise
// codegen'd cached-property accessors on the wrapper.
// TODO(port): verify codegen accessor names (`source_js_set_cached` / `source_js_get_cached`).

#[bun_jsc::JsClass]
pub struct Image {
    source: Source,
    pipeline: Pipeline,
    /// Decompression-bomb guard. Checked against the *header* dimensions before
    /// any RGBA buffer is allocated. Mirrors Sharp's `limitInputPixels`.
    max_pixels: u64,
    /// Apply EXIF Orientation (JPEG) before any user ops, the way Sharp's
    /// `.rotate()`-with-no-args / `autoOrient` does.
    auto_orient: bool,
    /// Populated after a pipeline has run once; lets `.width`/`.height` answer
    /// synchronously after the first await.
    last_width: i32,
    last_height: i32,
    /// Strong while at least one PipelineTask is in flight, weak otherwise. The
    /// Strong→wrapper→sourceJS-slot chain is what keeps the borrowed ArrayBuffer
    /// alive across the WorkPool roundtrip; switching to weak when idle lets GC
    /// collect the wrapper without polling `hasPendingActivity` every cycle.
    this_ref: JsRef,
    pending_tasks: u32,
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
            this_ref: JsRef::empty(),
            pending_tasks: 0,
        }
    }
}

pub enum Source {
    /// Input is a JS ArrayBuffer/TypedArray held in the wrapper's `sourceJS`
    /// cached slot. We never cache the raw pointer here — it could be detached
    /// or (for resizable, which we reject) reallocated. Each use re-fetches:
    ///  - `doMetadata` (sync, JS thread): `asArrayBuffer` → probe; no copy.
    ///  - `schedule()` (JS thread): `asArrayBuffer` → `pin()` → hand the
    ///    fresh slice to the worker; `then()` (JS thread) unpins. The pin
    ///    only lives for the task, never touches `finalize` (which runs
    ///    during GC sweep), and only forces `possiblySharedBuffer()`
    ///    materialisation when actually going off-thread — and that costs no
    ///    more than the dupe it replaces.
    JsBuffer,
    /// Owned — Blob inputs (the Blob's store may be sliced/freed independently)
    /// and decoded data: URLs.
    Owned(Vec<u8>),
    /// Owned, NUL-terminated. Read on the worker thread.
    // TODO(port): owned `[:0]u8` field — verify `bun_str` owned-ZStr type name.
    Path(bun_str::ZString),
    /// `Bun.file()`, `Bun.s3()`, an fd-backed Blob — anything whose bytes
    /// don't exist until read. We hold a Strong on the JS Blob and, at
    /// terminal time, just call its own `.bytes()` (whatever that means for
    /// that kind of Blob — file, S3, pipe, slice) and chain the pipeline
    /// task off the resulting Promise. After the first read completes the
    /// source is swapped to `.owned` so subsequent terminals reuse the bytes.
    Blob(Strong),
}

// `Source::deinit` in Zig only frees owned fields — `Vec<u8>`, `ZString`, and
// `Strong` all implement `Drop`, so no explicit `Drop` body is needed.

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn JSC__JSValue__unpinArrayBuffer(v: JSValue);
    /// 0 = detached/null, 1 = FastTypedArray (≤~1 KB, GC-movable — dupe),
    /// 2 = pinned ArrayBuffer (caller must unpin). For OversizeTypedArray the
    /// helper adopts the storage in-place (createAdopted — no byte copy) and
    /// pins; once adopted it's detachable, so it MUST be pinned, not borrowed.
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
/// overwrites, it doesn't resize twice. This is Sharp's semantics and means
/// the worker snapshot is a plain struct copy with a fixed execution order
/// (`run()` below), no allocation, no "too many ops" edge.
///
/// Execution order matches Sharp: (autoOrient) → rotate → flip/flop → resize
/// → modulate. Rotate precedes resize so the target box is interpreted in
/// upright space; modulate runs last so it operates on the fewest pixels.
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
        Self { brightness: 1.0, saturation: 1.0 }
    }
}

/// `@intFromFloat` is safety-checked UB on NaN/±Inf/out-of-range; every
/// number we read from JS goes through this so hostile input throws/clamps
/// instead of aborting. NaN → lo, ±Inf → the matching bound; bounds are f64
/// so the clamp stays in float space.
///
/// Rust `as` already saturates on overflow/NaN, but we keep the explicit
/// clamp so behaviour matches Zig exactly (NaN → `lo`, not 0).
macro_rules! coerce_int {
    ($T:ty, $x:expr, $lo:expr, $hi:expr) => {{
        let x: f64 = $x;
        if x.is_nan() { ($lo) as $T } else { x.max($lo).min($hi) as $T }
    }};
}

/// Size cap for `.path` sources, applied at fstat time before reading
/// anything. This is the *encoded* file, not the decoded RGBA — `maxPixels`
/// covers the latter once we have a header. 256 MiB comfortably fits any
/// real-world image (a 268 MP JPEG is ~80 MB) while keeping a single
/// path-driven request from materialising gigabytes before any guard runs.
const MAX_INPUT_FILE_BYTES: u64 = 256 << 20;

// ───────────────────────────── lifecycle ────────────────────────────────────

impl Image {
    #[bun_jsc::host_fn]
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<Image>> {
        let args = callframe.arguments();
        if args.len() < 1 || args[0].is_undefined_or_null() {
            return global.throw_invalid_arguments(
                "Image() expects a path, ArrayBuffer, TypedArray, Blob or data: URL",
            );
        }
        from_input_js(
            global,
            args[0],
            if args.len() > 1 { args[1] } else { JSValue::UNDEFINED },
            this_value,
        )
    }

    /// `Bun.file("…").image()` / `Bun.s3("…").image()` / `Blob#image()`. Same
    /// allocation as `new Bun.Image(blob, opts)`. Everything that can throw runs
    /// BEFORE `toJS()` — once the wrapper exists its `m_ctx` owns the *Image and
    /// the generated `~JSImage` will `finalize()` on GC, so a manual `finalize()`
    /// after `toJS()` is a double-free. (Contrast `from_input_js` where the
    /// codegen constructor only wires `m_ctx` after the fn returns, so its
    /// errdefer is safe.)
    pub fn from_blob_js(
        global: &JSGlobalObject,
        blob_value: JSValue,
        options: JSValue,
    ) -> JsResult<JSValue> {
        let mut img = Box::new(Image { source: Source::JsBuffer, ..Default::default() });
        // errdefer img.finalize() — `Box` drops on `?` automatically.
        apply_options(&mut img, global, options)?;
        // For Blob receivers `source_from_js` either dupes (in-memory blob) or
        // creates a Strong (file/S3); the cached `sourceJS` slot is only used
        // for the `.js_buffer` path, which a Blob never produces. The only
        // reason `source_from_js` takes `this_value` at all is to set that slot
        // for ArrayBuffer inputs — pass `.zero` and assert below.
        img.source = source_from_js(global, blob_value, JSValue::ZERO)?;
        debug_assert!(!matches!(img.source, Source::JsBuffer));
        Ok(img.to_js(global))
    }

    pub fn finalize(this: *mut Image) {
        // SAFETY: called once by the codegen'd `~JSImage` on the mutator thread
        // during lazy sweep; `this` was `Box::into_raw`'d at construction.
        unsafe {
            (*this).this_ref.finalize();
            // `source` is dropped by `Box::from_raw` below.
            drop(Box::from_raw(this));
        }
    }

    pub fn estimated_size(&self) -> usize {
        // Only the bytes WE own. .js_buffer is the caller's ArrayBuffer (already
        // counted via the cached value slot); the worker's RGBA scratch is
        // task-scoped and freed before any GC could observe it.
        mem::size_of::<Image>()
            + match &self.source {
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
    let mut img = Box::new(Image { source: Source::JsBuffer, ..Default::default() });
    // `opt.get` can throw (Proxy/getter); without this the heap-allocated
    // *Image and the duplicated source bytes leak. (Handled by `Box` Drop on `?`.)
    img.source = source_from_js(global, input, this_value)?;
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

fn source_from_js(global: &JSGlobalObject, value: JSValue, this_value: JSValue) -> JsResult<Source> {
    // String → file path or data:/base64 URL. Everything else → bytes.
    if value.is_string() {
        let str = value.to_bun_string(global)?;
        let utf8 = str.to_utf8();
        let s = utf8.slice();
        // `data:[<mime>][;base64],<payload>` — accept any image MIME (we sniff
        // anyway) and decode base64 here. Non-base64 data URLs aren't useful
        // for image bytes.
        if s.starts_with(b"data:") {
            let Some(comma) = strings::strings::index_of_char(s, b',') else {
                return global
                    .throw_invalid_arguments("Image(): malformed data: URL (no comma)");
            };
            let meta = &s[5..comma as usize];
            let payload = &s[comma as usize + 1..];
            if strings::strings::index_of(meta, b";base64").is_none() {
                return global.throw_invalid_arguments(
                    "Image(): only base64 data: URLs are supported",
                );
            }
            let mut out = vec![0u8; base64::decode_len(payload)];
            let r = base64::decode(&mut out, payload);
            if !r.is_successful() {
                return global
                    .throw_invalid_arguments("Image(): invalid base64 in data: URL");
            }
            out.truncate(r.count);
            return Ok(Source::Owned(out));
        }
        return Ok(Source::Path(bun_str::ZStr::from_bytes(s)));
    }
    if let Some(ab) = value.as_array_buffer(global) {
        // A resizable/growable buffer can shrink or reallocate underneath any
        // slice we'd take; a SharedArrayBuffer can be mutated by another
        // thread while the worker decodes (the codec layer parses the same
        // bytes twice — header then body — so a TOCTOU swap can resize the
        // implied output behind a guard that's already passed). The worker
        // *borrows* the slice (see `pin_for_task`), so this rejection is
        // load-bearing — `buf.slice()` is the obvious workaround.
        if ab.resizable || ab.shared {
            return global.throw_invalid_arguments(
                "Image(): resizable / shared ArrayBuffer is not supported; pass a fixed-length view (e.g. buf.slice())",
            );
        }
        // Just remember the JS object — see Source::JsBuffer for why we don't
        // cache the pointer or pin here.
        Image::source_js_set_cached(this_value, global, value);
        return Ok(Source::JsBuffer);
    }
    if let Some(blob) = value.as_::<Blob>() {
        // In-memory blob: dupe its bytes (the store may be sliced/replaced
        // independently).
        let view = blob.shared_view();
        if !view.is_empty() {
            return Ok(Source::Owned(view.to_vec()));
        }
        // Anything with a backing store but no in-memory view yet
        // (`Bun.file()`, `Bun.s3()`, fd, …) — keep the JS object and read it
        // through ITS OWN `.bytes()` at terminal time, so we inherit whatever
        // that store type does (file → ReadFile, S3 → fetch, etc.) without
        // knowing about it here.
        if blob.store.is_some() {
            return Ok(Source::Blob(Strong::create(value, global)));
        }
    }
    global.throw_invalid_arguments(
        "Image() input must be a path string, data: URL, ArrayBuffer, TypedArray or Blob",
    )
}

// ───────────────────────────── chainable ops ────────────────────────────────

impl Image {
    #[bun_jsc::host_fn(method)]
    pub fn do_resize(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.len() < 1 || !args[0].is_number() {
            return global.throw_invalid_arguments("resize(width, height?, options?)");
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
        self.pipeline.resize = Some(r);
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_rotate(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.len() < 1 || !args[0].is_number() {
            return global.throw_invalid_arguments("rotate(degrees) expects 90, 180 or 270");
        }
        // coerce_int for the same NaN/Inf/huge-finite reasons as everywhere else;
        // ±1e15 is plenty of headroom for "any multiple of 90 a user might pass".
        let raw: i64 = coerce_int!(i64, args[0].as_number(), -1e15, 1e15);
        let deg: u32 = u32::try_from(((raw % 360) + 360) % 360).unwrap();
        if deg != 0 && deg != 90 && deg != 180 && deg != 270 {
            return global
                .throw_invalid_arguments("rotate: only multiples of 90 are supported");
        }
        self.pipeline.rotate = u16::try_from(deg).unwrap();
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_flip(&mut self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.pipeline.flip = true;
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_flop(&mut self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.pipeline.flop = true;
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_modulate(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments();
        let mut m: Modulate = self.pipeline.modulate.unwrap_or_default();
        if args.len() > 0 && args[0].is_object() {
            let opt = args[0];
            // Clamp finite + bounded so Infinity doesn't reach ModulateImpl as
            // f32 +Inf (0×Inf = NaN → static_cast<u8>(NaN) is UB).
            if let Some(v) = opt.get(global, "brightness")? {
                if v.is_number() {
                    let x = v.as_number();
                    m.brightness =
                        if x.is_finite() { x.max(0.0).min(1e4) as f32 } else { 1.0 };
                }
            }
            if let Some(v) = opt.get(global, "saturation")? {
                if v.is_number() {
                    let x = v.as_number();
                    m.saturation =
                        if x.is_finite() { x.max(0.0).min(1e4) as f32 } else { 1.0 };
                }
            }
        }
        self.pipeline.modulate = Some(m);
        Ok(callframe.this())
    }

    fn set_format(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        fmt: codecs::Format,
    ) -> JsResult<JSValue> {
        let mut enc: codecs::EncodeOptions =
            self.pipeline.output.unwrap_or(codecs::EncodeOptions { format: fmt, ..Default::default() });
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
        self.pipeline.output = Some(enc);
        Ok(callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_format_jpeg(&mut self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Jpeg)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_png(&mut self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Png)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_webp(&mut self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Webp)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_heic(&mut self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Heic)
    }
    #[bun_jsc::host_fn(method)]
    pub fn do_format_avif(&mut self, g: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.set_format(g, cf, codecs::Format::Avif)
    }
}

/// Stable `.code` so callers can branch without parsing the message — and so
/// tests can skip when a system-backend format is unavailable on *this
/// machine* (e.g. AVIF encode on M1/M2, or Windows without the HEIF store
/// extension) without hard-coding which configurations have what.
fn error_code(e: codecs::Error) -> &'static ZStr {
    use codecs::Error as E;
    match e {
        E::UnknownFormat => ZStr::from_lit(b"ERR_IMAGE_UNKNOWN_FORMAT\0"),
        E::DecodeFailed => ZStr::from_lit(b"ERR_IMAGE_DECODE_FAILED\0"),
        E::EncodeFailed => ZStr::from_lit(b"ERR_IMAGE_ENCODE_FAILED\0"),
        E::TooManyPixels => ZStr::from_lit(b"ERR_IMAGE_TOO_MANY_PIXELS\0"),
        E::UnsupportedOnPlatform => ZStr::from_lit(b"ERR_IMAGE_FORMAT_UNSUPPORTED\0"),
        E::OutOfMemory => ZStr::from_lit(b"ERR_OUT_OF_MEMORY\0"),
    }
}

fn error_message(e: codecs::Error) -> &'static ZStr {
    use codecs::Error as E;
    match e {
        E::UnknownFormat => ZStr::from_lit(
            b"Image: unrecognised format (expected JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC or AVIF)\0",
        ),
        E::DecodeFailed => ZStr::from_lit(b"Image: decode failed\0"),
        E::EncodeFailed => ZStr::from_lit(b"Image: encode failed\0"),
        E::TooManyPixels => ZStr::from_lit(b"Image: input exceeds maxPixels limit\0"),
        E::UnsupportedOnPlatform => ZStr::from_lit(
            b"Image: format not supported on this machine (HEIC/AVIF/TIFF require the OS codec; AVIF encode needs an AV1 encoder)\0",
        ),
        E::OutOfMemory => ZStr::from_lit(b"Image: out of memory\0"),
    }
}

fn reject_error(global: &JSGlobalObject, e: codecs::Error) -> JSValue {
    error_with_code(global, error_code(e), error_message(e))
}

fn error_with_code(global: &JSGlobalObject, code: &ZStr, msg: &ZStr) -> JSValue {
    let err = global.create_error_instance(format_args!("{}", bstr::BStr::new(msg.as_bytes())));
    err.put(
        global,
        ZigString::static_(b"code"),
        ZigString::init(code.as_bytes()).to_js(global),
    );
    err
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
enum PinError {
    #[error("detached")]
    Detached,
    #[error("out of memory")]
    OutOfMemory,
}

impl Image {
    /// Fresh slice into the input bytes for use ON THE JS THREAD ONLY (re-reads
    /// the ArrayBuffer's vector each call so a detach between construction and
    /// here surfaces as `None` instead of UAF). For off-thread, see `pin_for_task`.
    fn js_thread_bytes(&self, this_value: JSValue, global: &JSGlobalObject) -> Option<&[u8]> {
        // TODO(port): lifetime — JsBuffer arm returns a borrow into the JS heap,
        // not into `self`. Phase B may need a different return type.
        match &self.source {
            Source::JsBuffer => Self::source_js_get_cached(this_value)
                .and_then(|v| v.as_array_buffer(global))
                .map(|ab| ab.byte_slice()),
            Source::Owned(b) => Some(b.as_slice()),
            Source::Path(_) | Source::Blob(_) => None,
        }
    }

    /// Pin the source ArrayBuffer for the duration of one off-thread task and
    /// return a slice that's safe for the worker to read. Unpinned in `then()`.
    ///
    /// We deliberately DON'T copy: the encoded input can be tens of MB and
    /// nobody mutates a buffer they just handed to a decoder. The contract is
    /// documented and `.shared`/`.resizable` are refused at construction. The
    /// codec layer is hardened so a hostile mid-decode mutation degrades to
    /// `DecodeFailed`, not OOB/heap-leak — see `codec_jpeg.zig` cropping +
    /// post-check, `codec_webp.zig` dim re-check. (If the attacker already runs
    /// JS in-process the threat model is moot anyway; the surface that matters
    /// is hostile *bytes*, which the codec validation handles.)
    fn pin_for_task(
        &self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> Result<Input, PinError> {
        match &self.source {
            Source::JsBuffer => {
                let Some(v) = Self::source_js_get_cached(this_value) else {
                    return Err(PinError::Detached);
                };
                // Classify the storage mode WITHOUT promoting it. A fresh
                // `new Uint8Array(N)` (the common path — `await res.bytes()`,
                // `Buffer.from(file)`) is `OversizeTypedArray`: bytes in
                // fastMalloc, no JSArrayBuffer wrapper, can't be detached or
                // moved. Calling `possiblySharedBuffer()` on that would
                // `slowDownAndWasteMemory()` → copy + allocate a wrapper for
                // every input. The classifier returns the slice directly and
                // tells us whether anything actually needs pinning.
                let mut ptr: *const u8 = core::ptr::null();
                let mut len: usize = 0;
                // SAFETY: FFI call; out-params are valid pointers to locals.
                match unsafe { JSC__JSValue__borrowBytesForOffThread(v, &mut ptr, &mut len) } {
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
                            let copied =
                                unsafe { core::slice::from_raw_parts(ptr, len) }.to_vec();
                            Ok(Input { copied: Some(copied), ..Default::default() })
                        }
                    }
                    // Oversize/Wasteful/DataView/JSArrayBuffer: pinned by the
                    // helper. For Oversize, possiblySharedBuffer() adopts the
                    // existing fastMalloc storage in-place (zero byte copy);
                    // pinning then keeps it alive even if JS does `.buffer` →
                    // `transfer()` while the worker reads.
                    2 => {
                        if len == 0 {
                            // SAFETY: helper pinned `v`; unpin before erroring.
                            unsafe { JSC__JSValue__unpinArrayBuffer(v) };
                            Err(PinError::Detached)
                        } else {
                            // SAFETY: pinned for the lifetime of the task;
                            // unpinned in `then()` via `Input::release()`.
                            let bytes = unsafe { core::slice::from_raw_parts(ptr, len) };
                            Ok(Input {
                                bytes: bytes as *const [u8],
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
            Source::Owned(b) => Ok(Input { bytes: b.as_slice() as *const [u8], ..Default::default() }),
            Source::Path(p) => Ok(Input { path: Some(p.as_ptr()), ..Default::default() }),
            // schedule() peels this off before pin_for_task is reached.
            Source::Blob(_) => unreachable!(),
        }
    }
}

// ───────────────────────── static `Bun.Image.backend` ───────────────────────

#[bun_jsc::host_fn(getter)]
pub fn get_backend(global: &JSGlobalObject, _: JSValue, _: JSValue) -> JsResult<JSValue> {
    Ok(bun_str::String::static_(<&'static str>::from(codecs::backend())).to_js(global))
}

#[bun_jsc::host_fn(setter)]
pub fn set_backend(_: JSValue, global: &JSGlobalObject, value: JSValue) -> bool {
    match value.to_enum::<codecs::Backend>(global, "Bun.Image.backend") {
        Ok(b) => {
            codecs::set_backend(b);
            true
        }
        Err(_) => false,
    }
}

// ───────────── static `Bun.Image.fromClipboard()` / `.hasClipboardImage()` ──
//
// JS-thread synchronous read of the system clipboard for an image
// representation, returning a fresh `Bun.Image` wrapping the raw container
// bytes. Decode/encode still go through the normal off-thread pipeline; only
// the pasteboard fetch is synchronous, and that's a memcpy of bytes the OS
// already has in-process. `null` ⇔ no image present. Linux returns `null`
// unconditionally — there's no stable native API to dlopen and shelling out
// to `wl-paste`/`xclip` from inside `Bun.Image` is the wrong layer.

#[bun_jsc::host_fn]
pub fn from_clipboard(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    // TODO(port): `comptime codecs.system_backend` — Phase B exposes this as a
    // `cfg`-gated `Option<&'static dyn SystemBackend>` or per-platform module.
    if let Some(sb) = codecs::SYSTEM_BACKEND {
        let bytes = match sb.clipboard() {
            Ok(Some(b)) => b,
            Ok(None) => return Ok(JSValue::NULL),
            Err(codecs::ClipboardError::OutOfMemory) => return global.throw_out_of_memory(),
            Err(codecs::ClipboardError::BackendUnavailable) => return Ok(JSValue::NULL),
        };
        let img = Box::new(Image { source: Source::Owned(bytes), ..Default::default() });
        return Ok(img.to_js(global));
    }
    Ok(JSValue::NULL)
}

#[bun_jsc::host_fn]
pub fn has_clipboard_image(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    if let Some(sb) = codecs::SYSTEM_BACKEND {
        return Ok(JSValue::from(sb.has_clipboard_image()));
    }
    Ok(JSValue::FALSE)
}

/// Monotone counter that increments on every system-wide clipboard write
/// (NSPasteboard.changeCount / GetClipboardSequenceNumber). macOS has no
/// clipboard-change notification, so polling this and calling
/// `hasClipboardImage()` only when it moves is the cheapest hint-UI pattern.
/// `-1` on Linux.
#[bun_jsc::host_fn]
pub fn clipboard_change_count(_: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    if let Some(sb) = codecs::SYSTEM_BACKEND {
        return Ok(JSValue::js_number(sb.clipboard_change_count()));
    }
    Ok(JSValue::js_number(-1i64))
}

// ───────────────────────────── getters ──────────────────────────────────────

impl Image {
    #[bun_jsc::host_fn(getter)]
    pub fn get_width(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number(self.last_width)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_height(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number(self.last_height)
    }
}

// ───────────────────────────── async terminals ──────────────────────────────

impl Image {
    #[bun_jsc::host_fn(method)]
    pub fn do_metadata(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
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
                    self.last_width = i32::try_from(w).unwrap();
                    self.last_height = i32::try_from(h).unwrap();
                    let obj = JSValue::create_empty_object(global, 3);
                    obj.put(global, ZigString::static_(b"width"), JSValue::js_number(w));
                    obj.put(global, ZigString::static_(b"height"), JSValue::js_number(h));
                    obj.put(
                        global,
                        ZigString::static_(b"format"),
                        ZigString::init(<&'static str>::from(p.format).as_bytes()).to_js(global),
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
        self.schedule(global, callframe.this(), Kind::Metadata, Deliver::Uint8Array)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_bytes(&mut self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(global, cf.this(), Kind::Encode(self.pipeline.output), Deliver::Uint8Array)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_buffer(&mut self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(global, cf.this(), Kind::Encode(self.pipeline.output), Deliver::Buffer)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_blob(&mut self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(global, cf.this(), Kind::Encode(self.pipeline.output), Deliver::Blob)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_to_base64(&mut self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(global, cf.this(), Kind::Encode(self.pipeline.output), Deliver::Base64)
    }

    /// `data:image/{format};base64,{…}`. Same encode as `.toBase64()` plus the
    /// MIME prefix, so it drops straight into `<img src>`.
    #[bun_jsc::host_fn(method)]
    pub fn do_data_url(&mut self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        self.schedule(global, cf.this(), Kind::Encode(self.pipeline.output), Deliver::DataUrl)
    }

    /// `.placeholder()` — ThumbHash-rendered ≤32px PNG `data:` URL. ~28 chars
    /// of hash → ~400-700 bytes of `data:image/png;base64,…` ready for `<img
    /// src>` / Next's `blurDataURL`. Runs entirely on the work pool; the
    /// pipeline ops (resize/rotate/…) are skipped — a placeholder is OF the
    /// source, not of the output.
    #[bun_jsc::host_fn(method)]
    pub fn do_placeholder(
        &mut self,
        global: &JSGlobalObject,
        cf: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = cf.arguments();
        // Single positional `"dataurl"` for now — leaves room for `"hash"` /
        // `"color"` without growing methods. Anything else throws so the
        // option space isn't accidentally squatted.
        if args.len() > 0 && !args[0].is_undefined_or_null() {
            let s = args[0].to_bun_string(global)?;
            if !s.eql(b"dataurl") {
                return global.throw_invalid_arguments(
                    "Image.placeholder(): only \"dataurl\" is supported",
                );
            }
        }
        self.schedule(global, cf.this(), Kind::Placeholder, Deliver::DataUrl)
    }

    /// Terminal: encode and write to `path` on the work pool (no round-trip of
    /// then `Bun.write(dest, encoded)` — same path as `await Bun.write(...)`, so
    /// `dest` may be a path string, `Bun.file()`, `Bun.s3()`, or an fd. Resolves
    /// with bytes written. If no format method was chained and `dest` is a path
    /// string, the encode format is inferred from its extension, falling back to
    /// the source format — so `img.resize(100).write("thumb.webp")` Just Works.
    #[bun_jsc::host_fn(method)]
    pub fn do_write(&mut self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        let args = cf.arguments();
        if args.len() < 1 || args[0].is_undefined_or_null() {
            return global.throw_invalid_arguments(
                "Image.write(dest): expected a path, Bun.file, Bun.s3 or fd",
            );
        }

        let mut output = self.pipeline.output;
        // Extension inference only when dest is a plain string. BunFile/S3 dests
        // carry no extension contract, so the explicit `.png()` etc. (or source
        // format) decides.
        if output.is_none() && args[0].is_string() {
            let str = args[0].to_bun_string(global)?;
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
                        output = Some(codecs::EncodeOptions { format: f, ..Default::default() });
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
        &mut self,
        global: &JSGlobalObject,
        this_value: JSValue,
        kind: Kind,
        deliver: Deliver,
    ) -> JsResult<JSValue> {
        if matches!(self.source, Source::Blob(_)) {
            return BlobReadChain::start(self, global, this_value, kind, deliver);
        }
        let input = match self.pin_for_task(this_value, global) {
            Ok(i) => i,
            Err(e) => {
                // `deliver` may own a Strong; the task that would have freed it
                // in Drop is never created on this branch.
                drop(deliver);
                if matches!(e, PinError::OutOfMemory) {
                    bun_core::out_of_memory();
                }
                return Ok(JSPromise::rejected_promise(
                    global,
                    error_with_code(
                        global,
                        ZStr::from_lit(b"ERR_INVALID_STATE\0"),
                        ZStr::from_lit(b"Image: source ArrayBuffer was detached\0"),
                    ),
                )
                .as_value(global));
            }
        };
        let job = Box::new(PipelineTask {
            image: self as *mut Image,
            global,
            // Struct copy — the worker reads its own snapshot so further chained
            // calls on the JS side between schedule and completion don't race.
            pipeline: self.pipeline,
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
        if self.pending_tasks == 0 {
            self.this_ref.set_strong(this_value, global);
        }
        self.pending_tasks += 1;
        let mut task = AsyncImageTask::create_on_js_thread(global, job);
        task.schedule();
        Ok(task.promise.value())
    }

    /// Run the full pipeline on the *current* thread. Used when an `Image` is
    /// passed straight to `new Response(image)` / `new Request(url, {body: image})`
    /// — the body-init contract is synchronous, so we encode here and hand back an
    /// owned buffer the Body can wrap as an `InternalBlob`. The async terminals
    /// (`bytes`/`blob`/…) remain the off-thread path.
    ///
    /// A later refinement is to return a `.Locked` body and resolve it from the
    /// worker pool; this is the simple, correct first cut.
    pub fn encode_for_body(
        &mut self,
        global: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<(codecs::Encoded, &'static ZStr)> {
        // The body-init contract is synchronous, so a `.blob` source can't go
        // through the async read chain here. For the common case (file by path)
        // fall back to the `.path` source — `run()` reads it inline. fd/S3-backed
        // BunFiles would block or need network; refuse with a clear message until
        // the body path is made `.Locked`.
        if let Source::Blob(strong) = &self.source {
            const REFUSE: &str = "Image: fd/S3-backed Bun.file as a Response body — pass `await file.bytes()` or a path string";
            let Some(blob_js) = strong.get() else {
                return global.throw("Image: Blob source was collected");
            };
            let Some(blob) = blob_js.as_::<Blob>() else {
                return global.throw(REFUSE);
            };
            // Braced so the `else` can't dangle onto the inner `if` — a null
            // store would otherwise fall through to `pin_for_task`'s `.blob =>
            // unreachable`. (The Strong-held wrapper makes that nominally
            // unreachable, but this path should throw, not abort, when it isn't.)
            // TODO(port): Blob store/pathlike field access — verify shape.
            if let Some(store) = &blob.store {
                if store.data.is_file() && store.data.file().pathlike.is_path() {
                    let p = bun_str::ZStr::from_bytes(store.data.file().pathlike.path().slice());
                    self.source = Source::Path(p);
                } else {
                    return global.throw(REFUSE);
                }
            } else {
                return global.throw(REFUSE);
            }
        }
        let input = match self.pin_for_task(this_value, global) {
            Ok(i) => i,
            Err(e) => {
                if matches!(e, PinError::OutOfMemory) {
                    bun_core::out_of_memory();
                }
                return global.throw("Image: source ArrayBuffer was detached");
            }
        };
        let _release = scopeguard::guard((), |_| input.release());
        // TODO(port): `input.release()` needs `&mut`/ownership; reshape guard in Phase B.
        // PORT NOTE: Zig never calls `PipelineTask.deinit()` on this stack
        // temporary (only `then()` does — Image.zig:1092). `Drop` here would
        // underflow `pending_tasks` and downgrade `this_ref`, so suppress it.
        let mut task = mem::ManuallyDrop::new(PipelineTask {
            image: self as *mut Image,
            global,
            pipeline: self.pipeline,
            input,
            kind: Kind::Encode(self.pipeline.output),
            deliver: Deliver::Uint8Array,
            max_pixels: self.max_pixels,
            auto_orient: self.auto_orient,
            result: TaskResult::Err(codecs::Error::DecodeFailed),
        });
        task.run();
        // PORT NOTE: reshaped for borrowck — move `result` out via `replace`
        // since `task` is behind `ManuallyDrop` deref.
        let result = mem::replace(&mut task.result, TaskResult::Err(codecs::Error::DecodeFailed));
        match result {
            TaskResult::Encoded { out, format, w, h } => {
                self.last_width = i32::try_from(w).unwrap();
                self.last_height = i32::try_from(h).unwrap();
                Ok((out, format.mime()))
            }
            TaskResult::Err(e) => {
                global.throw(format_args!("{}", bstr::BStr::new(error_message(e).as_bytes())))
            }
            // Preserve errno/path/syscall instead of flattening to DecodeFailed.
            TaskResult::IoErr(e) => global.throw_value(e.to_js(global)?),
            TaskResult::Meta { .. } => unreachable!(),
        }
    }
}

// ───────────────────────────── worker task ──────────────────────────────────

/// `.blob` source: ask the Blob for its bytes via the store-agnostic
/// `Blob.readBytesToHandler` (file → ReadFile/ReadFileUV, S3 → S3.download,
/// memory → dupe), receive the owned `[]u8` directly — never wrapped in a
/// JSValue — swap it into `image.source = .owned`, and re-enter `schedule()`.
/// Promise-of-promise flattens, so the caller sees one `await` for
/// read+decode+ops+encode. After the first read, subsequent terminals on the
/// same instance reuse the `.owned` bytes without re-reading.
struct BlobReadChain<'a> {
    image: *mut Image,
    global: &'a JSGlobalObject,
    kind: Kind,
    deliver: Deliver,
    outer: jsc::JSPromiseStrong,
}

impl<'a> BlobReadChain<'a> {
    fn start(
        image: &mut Image,
        global: &'a JSGlobalObject,
        this_value: JSValue,
        kind: Kind,
        deliver: Deliver,
    ) -> JsResult<JSValue> {
        // `deliver` may carry a `.write_dest` Strong; on these defensive
        // early-returns the chain is never created so its Drop can't free it.
        // (Same contract as schedule()'s detached-buffer branch.)
        let Source::Blob(strong) = &image.source else { unreachable!() };
        let Some(blob_js) = strong.get() else {
            drop(deliver);
            return global.throw("Image: Blob source was collected");
        };
        let Some(blob) = blob_js.as_::<Blob>() else {
            drop(deliver);
            return global.throw("Image: Blob source is no longer a Blob");
        };

        // Same Strong-ref contract as the regular pending_tasks bump — keeps
        // the wrapper (and its sourceJS slot) alive until the read settles.
        if image.pending_tasks == 0 {
            image.this_ref.set_strong(this_value, global);
        }
        image.pending_tasks += 1;

        let chain = Box::new(BlobReadChain {
            image: image as *mut Image,
            global,
            kind,
            deliver,
            outer: jsc::JSPromiseStrong::init(global),
        });
        let promise = chain.outer.value();
        // TODO(port): `read_bytes_to_handler` generic-handler signature.
        blob.read_bytes_to_handler(Box::into_raw(chain), global)?;
        Ok(promise)
    }

    /// JS thread — `read_bytes_to_handler` guarantees this. `r.ok` is owned by us.
    pub fn on_read_bytes(self: Box<Self>, r: Blob::ReadBytesResult) {
        let global = self.global;
        // SAFETY: `image` is a BACKREF kept alive by the Strong `this_ref`
        // bump in `start()`; we are on the JS thread.
        let image = unsafe { &mut *self.image };
        let mut outer = self.outer;
        let kind = self.kind;
        let deliver = self.deliver;
        // `bun.destroy(self)` — Box drops at end of scope.

        image.pending_tasks -= 1;
        if image.pending_tasks == 0 {
            image.this_ref.downgrade();
        }
        // `defer outer.deinit()` — `JSPromiseStrong` Drop handles this.

        match r {
            Blob::ReadBytesResult::Ok(bytes) => {
                // Concurrent terminals can have started multiple BlobReadChains
                // (no in-flight serialisation — `start()` re-enters every time
                // it sees `.blob`). The FIRST resolver wins and swaps to
                // `.owned`; that buffer is then *borrowed* by `pin_for_task`
                // into a worker-thread PipelineTask. A later resolver MUST NOT
                // drop the source (it would free what the worker is reading)
                // — drop the redundant read instead and re-enter `schedule()`
                // on the already-swapped source.
                if matches!(image.source, Source::Blob(_)) {
                    image.source = Source::Owned(bytes);
                } else {
                    drop(bytes);
                }
                let Some(this_value) = image.this_ref.try_get() else {
                    let _ = outer.reject(
                        global,
                        global.create_error_instance(format_args!(
                            "Image: collected before read completed"
                        )),
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
                            global.create_error_instance(format_args!(
                                "Image: pipeline schedule failed"
                            )),
                        );
                        return;
                    }
                };
                let _ = outer.resolve(global, inner);
            }
            Blob::ReadBytesResult::Err(e) => {
                drop(deliver);
                let _ = outer.reject(global, e.to_error_instance(global));
            }
        }
    }
}

pub type AsyncImageTask<'a> = jsc::ConcurrentPromiseTask<PipelineTask<'a>>;

pub struct PipelineTask<'a> {
    image: *mut Image,
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
    // TODO(port): lifetime — borrows pinned ArrayBuffer or `image.source.owned`;
    // raw `*const [u8]` because the owning `Image` is held via BACKREF.
    bytes: *const [u8],
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
            bytes: &[] as *const [u8],
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
        // SAFETY: see field doc — pinned/owned for the task's lifetime.
        unsafe { &*self.bytes }
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
    /// `.placeholder()` — decode → box-resize ≤100 → ThumbHash → render
    /// → PNG → `data:` URL. The whole chain runs on the worker; the
    /// hash itself never crosses the JS boundary unless we add an
    /// `as: "hash"` option later.
    Placeholder,
}

// PORT NOTE: renamed from `Result` to avoid shadowing `core::result::Result`.
pub enum TaskResult {
    Encoded { out: codecs::Encoded, format: codecs::Format, w: u32, h: u32 },
    Meta { w: u32, h: u32, format: codecs::Format },
    Err(codecs::Error),
    IoErr(sys::Error),
}

impl<'a> PipelineTask<'a> {
    /// Runs on a `WorkPool` thread. No JSC access.
    pub fn run(&mut self) {
        // `self.input` was prepared on the JS thread by `pin_for_task`: either a
        // pinned ArrayBuffer slice (pin lives until `then()` unpins), an owned
        // buffer, or a path to read here.
        let mut owned_file: Option<Vec<u8>> = None;
        let input: &[u8] = if let Some(p) = self.input.path {
            // SAFETY: `p` borrows `image.source.path`, which outlives the task
            // because `this_ref` is held Strong while pending_tasks > 0.
            let p: &ZStr = unsafe { &*p };
            // The path string came straight from the constructor, so treat
            // it as untrusted: open + fstat first instead of `readFrom`.
            //   • !S_ISREG → ENODEV. `/dev/zero`/`/dev/urandom` would
            //     otherwise pread forever (st_size=0, never returns 0) until
            //     the doubling Vec OOMs the process; a FIFO with no writer
            //     would park this WorkPool thread in-kernel forever.
            //   • st_size cap → file-based decompression-bomb fails up
            //     front with a clear error instead of materialising a
            //     multi-GB encoded buffer before `maxPixels` even runs.
            // O_NONBLOCK so the open itself can't block on a FIFO. POSIX-only:
            // on Windows it omits FILE_SYNCHRONOUS_IO_NONALERT (overlapped
            // handle) and the subsequent sync read fails EINVAL. Windows has
            // no open-blocking FIFOs in the same sense; the !S_ISREG check
            // below still rejects pipes/devices.
            #[cfg(unix)]
            let oflags = sys::O::RDONLY | sys::O::NONBLOCK;
            #[cfg(not(unix))]
            let oflags = sys::O::RDONLY;
            let file = match sys::File::openat(sys::Fd::cwd(), p, oflags, 0) {
                sys::Result::Ok(f) => f,
                sys::Result::Err(e) => {
                    self.result = TaskResult::IoErr(e.with_path(p));
                    return;
                }
            };
            // `defer file.close()` — assume `sys::File` closes on Drop.
            let st = match file.stat() {
                sys::Result::Ok(s) => s,
                sys::Result::Err(e) => {
                    self.result = TaskResult::IoErr(e.with_path(p));
                    return;
                }
            };
            if !sys::S::is_reg(u32::try_from(st.mode).unwrap()) {
                self.result = TaskResult::IoErr(sys::Error {
                    errno: sys::E::NODEV as _,
                    syscall: sys::Syscall::Read,
                    path: p.into(),
                    ..Default::default()
                });
                return;
            }
            if u64::try_from(st.size.max(0)).unwrap() > MAX_INPUT_FILE_BYTES {
                self.result = TaskResult::Err(codecs::Error::TooManyPixels);
                return;
            }
            let r = file.read_to_end();
            if let Some(e) = r.err {
                drop(r.bytes);
                self.result = TaskResult::IoErr(e.with_path(p));
                return;
            }
            owned_file = Some(r.bytes);
            owned_file.as_deref().unwrap()
        } else {
            self.input.slice()
        };

        // Header-only fast path for `.metadata()` — Sharp parses just the
        // IHDR/SOF/VP8 header; we used to decode the full RGBA buffer first
        // (~70× slower on a 1920×1080 PNG). EXIF orientation only swaps the
        // reported dims, no pixels involved.
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
                    self.result = TaskResult::Meta { w, h, format: p.format };
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

        // Decode-time downscale hint. The IDCT picker constrains in *stored*
        // axes, so any 90/270 rotate that runs before resize — explicit OR
        // EXIF auto-orient — needs the hint axes swapped, otherwise one axis
        // can be over-shrunk and then upscaled, throwing away detail.
        // (flip/flop are pure mirrors that never change w/h, so the hint
        //  stays valid through them.)
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
            codecs::DecodeHint { target_w: tw, target_h: th }
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
            self.result =
                TaskResult::Meta { w: decoded.width, h: decoded.height, format: src_format };
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

        // No format method chained ⇒ re-encode in the source format. For
        // decode-only sources (bmp/tiff/gif) that would dead-end in the
        // "HEIC/AVIF require macOS or Windows" message, which is wrong twice
        // over. Emit PNG instead — it's the lossless, everywhere-supported
        // default Sharp uses for the same case.
        let Kind::Encode(enc_opt) = &self.kind else { unreachable!() };
        let mut enc: codecs::EncodeOptions = enc_opt.unwrap_or(codecs::EncodeOptions {
            format: match src_format {
                codecs::Format::Bmp | codecs::Format::Tiff | codecs::Format::Gif => {
                    codecs::Format::Png
                }
                f => f,
            },
            ..Default::default()
        });
        // Carry the source ICC profile through to the encoder unless the
        // caller already set one (reserved for a future `.withIccProfile()`
        // method). The pipeline doesn't colour-convert the RGBA, so dropping
        // the profile reinterprets a non-sRGB source (Display-P3, Adobe RGB,
        // Jpegli XYB) as sRGB and visibly shifts the colours — see #30197.
        // JPEG/PNG/WebP embed it; HEIC/AVIF via the system backend do not.
        if enc.icc_profile.is_none() {
            enc.icc_profile = decoded.icc_profile.clone();
        }
        let out = match codecs::encode(&decoded.rgba, decoded.width, decoded.height, &enc) {
            Ok(o) => o,
            Err(e) => {
                self.result = TaskResult::Err(e);
                return;
            }
        };

        self.result =
            TaskResult::Encoded { out, format: enc.format, w: decoded.width, h: decoded.height };
    }

    /// Back on the JS thread.
    pub fn then(self: Box<Self>, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        // `defer self.deinit()` → handled by `Drop for PipelineTask` at scope exit.
        // JS thread again — release the per-task pin so user code can
        // transfer/detach the source now.
        // PORT NOTE: reshaped for borrowck — take `input` out so `release()` can
        // consume it while we still hold `&self` for the rest.
        let input = mem::take(&mut { self }.input);
        // TODO(port): the line above doesn't compile as-is — Phase B: destructure
        // `*self` into locals so `input.release()` and `Drop` don't fight.
        input.release();
        let global = self.global;
        // SAFETY: BACKREF; JS thread; wrapper kept alive by `this_ref` Strong.
        let image = unsafe { &mut *self.image };
        // Stash final dims here (JS thread) — `run()` is on a WorkPool thread
        // so writing `self.image.*` there would race the synchronous getters.
        match &self.result {
            TaskResult::Encoded { w, h, .. } | TaskResult::Meta { w, h, .. } => {
                image.last_width = i32::try_from(*w).unwrap();
                image.last_height = i32::try_from(*h).unwrap();
            }
            _ => {}
        }
        match self.result {
            TaskResult::Encoded { out, format, .. } => match &mut self.deliver {
                // The codec's own allocation is handed straight to JS with the
                // codec's free as the finalizer — no dupe of the output.
                Deliver::Uint8Array => {
                    let v = ArrayBuffer::from_bytes(out.bytes, jsc::TypedArrayType::Uint8Array)
                        .to_js_with_context(global, core::ptr::null_mut(), out.free);
                    match v {
                        Ok(v) => promise.resolve(global, v)?,
                        Err(_) => return promise.reject(global, jsc::JsError::Thrown.into()),
                    }
                }
                // createBufferWithCtx returns plain JSValue (its C++ side asserts
                // the no-throw contract), so the .uint8array catch is unmatched
                // here by construction, not omission.
                Deliver::Buffer => promise.resolve(
                    global,
                    JSValue::create_buffer_with_ctx(global, out.bytes, core::ptr::null_mut(), out.free),
                )?,
                Deliver::Blob => {
                    // Blob.Store frees via an Allocator; dupe for that path.
                    let owned = out.bytes.to_vec();
                    out.deinit();
                    let mut blob = Blob::init(owned, global);
                    blob.content_type = format.mime();
                    blob.content_type_was_set = true;
                    promise.resolve(global, Box::new(blob).to_js(global))?;
                }
                tag @ (Deliver::Base64 | Deliver::DataUrl) => {
                    // PERF(port): was comptime tag dispatch — profile in Phase B.
                    let _guard = scopeguard::guard((), |_| out.deinit());
                    // `data:` and `;base64,` are both ASCII so the prefix
                    // length is exact; one buffer holds prefix+payload.
                    let mut pre_buf = [0u8; 40];
                    let pre: &[u8] = if matches!(tag, Deliver::DataUrl) {
                        use std::io::Write;
                        let mut w = &mut pre_buf[..];
                        write!(w, "data:{};base64,", bstr::BStr::new(format.mime().as_bytes()))
                            .expect("unreachable");
                        let written = 40 - w.len();
                        &pre_buf[..written]
                    } else {
                        b""
                    };
                    let mut buf = vec![0u8; pre.len() + base64::encode_len(out.bytes)];
                    buf[..pre.len()].copy_from_slice(pre);
                    let wrote = pre.len() + base64::encode(&mut buf[pre.len()..], out.bytes);
                    let str = match bun_str::String::create_utf8_for_js(global, &buf[..wrote]) {
                        Ok(s) => s,
                        Err(_) => return promise.reject(global, jsc::JsError::Thrown.into()),
                    };
                    promise.resolve(global, str)?;
                }
                // `.write(dest)` — wrap the codec buffer as a Buffer (codec's
                // own free is the finalizer; no dupe), hand it to the SAME
                // implementation `Bun.write` uses, and resolve our promise
                // with that Promise<number>. So `dest` may be a path string,
                // `Bun.file()`, `Bun.s3()`, or an fd — anything `Bun.write`
                // accepts — and we don't reimplement any of it.
                Deliver::WriteDest(dest) => {
                    let Some(dest_js) = dest.get() else {
                        out.deinit();
                        return promise.reject(
                            global,
                            global.create_error_instance(format_args!(
                                "Image.write: destination was collected"
                            )),
                        );
                    };
                    let data = JSValue::create_buffer_with_ctx(
                        global,
                        out.bytes,
                        core::ptr::null_mut(),
                        out.free,
                    );
                    let mut arg_slice =
                        jsc::CallFrame::ArgumentsSlice::init(global.bun_vm(), &[dest_js]);
                    // TODO(port): `PathOrBlob::from_js_no_copy` signature.
                    let mut path_or_blob =
                        match bun_runtime::node::PathOrBlob::from_js_no_copy(global, &mut arg_slice)
                        {
                            Ok(p) => p,
                            Err(_) => return promise.reject(global, jsc::JsError::Thrown.into()),
                        };
                    let _path_guard = scopeguard::guard((), |_| {
                        if path_or_blob.is_path() {
                            path_or_blob.path_deinit();
                        }
                    });
                    let write_promise = match Blob::write_file_internal(
                        global,
                        &mut path_or_blob,
                        data,
                        Default::default(),
                    ) {
                        Ok(p) => p,
                        Err(_) => return promise.reject(global, jsc::JsError::Thrown.into()),
                    };
                    promise.resolve(global, write_promise)?;
                }
            },
            TaskResult::Meta { w, h, format } => {
                let obj = JSValue::create_empty_object(global, 3);
                obj.put(global, ZigString::static_(b"width"), JSValue::js_number(w));
                obj.put(global, ZigString::static_(b"height"), JSValue::js_number(h));
                obj.put(
                    global,
                    ZigString::static_(b"format"),
                    ZigString::init(<&'static str>::from(format).as_bytes()).to_js(global),
                );
                promise.resolve(global, obj)?;
            }
            TaskResult::Err(e) => promise.reject(global, reject_error(global, e))?,
            TaskResult::IoErr(e) => promise.reject(global, e.to_js(global))?,
        }
        Ok(())
    }

    /// Fixed Sharp order: rotate → flip/flop → resize. Each stage replaces
    /// `d` in place; the old buffer is freed before assigning the new one so
    /// peak memory is at most 2× one frame. Every stage hand-swaps only the
    /// pixel slots — rotate/resize return a fresh `Decoded` with
    /// `icc_profile == None`, so overwriting `d.*` wholesale would drop the
    /// source's colour profile. Geometry doesn't change colour meaning, so
    /// the profile survives unchanged.
    fn apply_pipeline(&self, d: &mut codecs::Decoded) -> Result<(), codecs::Error> {
        let p = &self.pipeline;
        if p.rotate != 0 {
            let next = codecs::rotate(&d.rgba, d.width, d.height, p.rotate)?;
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
            // Guard the output canvas AND the H-then-V intermediate (always
            // dst_w × src_h — image_resize.cpp pass order is fixed). A 1×N
            // source → resize(W,1) has tiny input AND output canvases yet a
            // W×N intermediate; with W=262143, N=16383 that's a 17 GiB alloc
            // from a ~200-byte PNG. The src_w×dst_h cross-product is bounded
            // by max(input, output) so doesn't need its own check.
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

/// `.placeholder()` body — runs on the worker. Input is the decoded RGBA
/// at source size; output is a PNG of the ThumbHash render, ready for the
/// `.dataurl` deliver. ThumbHash needs ≤100×100, so first downscale with
/// `box` (the only filter that's correct for "average everything in a
/// cell" — Lanczos would ring into the DCT). The hash itself stays on
/// the worker stack; only the rendered PNG crosses back.
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
    let png_out = codecs::png::encode(&rendered.rgba, rendered.w, rendered.h, -1, None)?;
    let _ = owned; // PERF(port): explicit lifetime hint; drops here.
    Ok(TaskResult::Encoded { out: png_out, format: codecs::Format::Png, w: rendered.w, h: rendered.h })
}

/// Map a resize spec to concrete output dims given the current dims.
fn resolve_resize(r: Resize, sw: u32, sh: u32) -> (u32, u32) {
    let mut w = r.w;
    // Widen before multiplying — `r.w` is user-controlled and `sh` is
    // bounded only by `max_pixels`, so the u32 product can wrap; and the
    // quotient can exceed u32 for tall-thin sources (1×5M with .resize(1k)
    // → 5e9), so clamp to the same per-side cap do_resize uses before the
    // narrowing cast. The maxPixels guard then rejects the product.
    let mut h: u32 = if r.h != 0 {
        r.h
    } else {
        u32::try_from((0x3FFFFu64).min(1u64.max((r.w as u64) * (sh as u64) / (sw as u64))))
            .unwrap()
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

fn apply_orientation(d: &mut codecs::Decoded, orient: exif::Orientation) -> Result<(), codecs::Error> {
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
        let next = codecs::rotate(&d.rgba, d.width, d.height, t.rotate)?;
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
        unsafe {
            (*self.image).pending_tasks -= 1;
            if (*self.image).pending_tasks == 0 {
                (*self.image).this_ref.downgrade();
            }
        }
        // `bun.destroy(this)` — `Box<PipelineTask>` drop is the caller.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/Image.zig (1288 lines)
//   confidence: medium
//   todos:      12
//   notes:      .classes.ts payload; <'a> on PipelineTask/BlobReadChain per LIFETIMES.tsv may need *const for cross-thread Box; Input borrows via raw ptrs; owned [:0]u8 path type unresolved; then() needs borrowck reshape (destructure Box<Self>); encode_for_body stack task is ManuallyDrop (Zig never deinit()s it).
// ──────────────────────────────────────────────────────────────────────────
