use bun_paths::strings;
use core::ffi::c_int;

use crate::jsc::{self, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_core::{self, Utf8Bytes, Utf8WithString, fmt as bun_fmt};
use bun_core::{WStr, ZStr};
use bun_jsc::bun_string_jsc;
use bun_jsc::{StringJsc as _, Utf8WithStringJsc as _};
use bun_paths::{MAX_PATH_BYTES, OSPathBuffer, OSPathSliceZ, PathBuffer, WPathBuffer};
use bun_sys::{self, Fd, Mode, O};

use crate::node::util::validators;
use crate::webcore::{Blob, Request, Response};

pub use jsc::MarkedArrayBuffer as Buffer;
use jsc::PinnedArrayBuffer;

// `jsc.ArgumentsSlice` — cursor over CallFrame args.
pub use jsc::ArgumentsSlice;

// LAYERING: `Fd::{from_js,from_js_validated,to_js}` are provided by the
// canonical `bun_sys_jsc::FdJsc` extension trait (full range/type
// validation). Re-exported so existing
// `crate::node::types::FdJsc` import paths keep resolving.
pub use bun_sys_jsc::FdJsc;

/// `bun_runtime`-tier required-argument helper layered on `FdJsc`. Collapses
/// the `next_eat → from_js_validated → ok_or_else(throw_invalid_fd_error)`
/// boilerplate repeated 12× across `node_fs.rs::args::*::from_js`.
pub(crate) trait FdArgExt: FdJsc {
    #[inline]
    fn from_js_required(ctx: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Self> {
        let fd_value = arguments.next_eat().unwrap_or(JSValue::UNDEFINED);
        Self::from_js_validated(fd_value, ctx)?.ok_or_else(|| {
            if fd_value.is_number() {
                return ctx
                    .err(
                        jsc::ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "The value of \"fd\" is out of range. It must be an integer. Received {}",
                            bun_fmt::double(fd_value.as_number())
                        ),
                    )
                    .throw();
            }
            ctx.throw_invalid_argument_type_value(b"fd", b"number", fd_value)
        })
    }
}
impl FdArgExt for Fd {}

// LAYERING: `bun_sys::SystemError → JSValue` bridge (reshapes the T1 data
// struct into the `#[repr(C)]` FFI layout and forwards to C++). Re-exported so
// `system_error.to_error_instance(ctx)` resolves via the canonical impl.
pub use bun_sys_jsc::SystemErrorJsc;

pub use bun_sys::PlatformIoVec;

// ──────────────────────────────────────────────────────────────────────────

/// Whether a call is serviced on the JS thread before it returns (`Sync`) or
/// handed to the thread pool (`Async`). A few FS operations take a different
/// path per flavor (`read_file`'s scratch buffer, recursive `readdir`), and
/// the arguments parsed for an async call must outlive it off the JS thread:
/// strings are copied or re-referenced thread-safely, buffers are pinned and
/// GC-rooted until the parsed value drops ([`PinnedArrayBuffer`]).
#[derive(Copy, Clone, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Flavor {
    Sync,
    Async,
}

/// Whether a `String` wrapper object (`new String("..")`) counts as a string
/// when parsing a string-or-buffer argument. Node's `fs.writeFile` family
/// rejects wrapper objects; everything else unwraps them.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum StringObjects {
    Allow,
    /// Only primitive strings match; a wrapper object parses as "not a string
    /// or buffer", so the caller throws its own type error.
    Reject,
}

/// What [`BlobOrStringOrBuffer`] parsing does with a file-backed `Blob`
/// (`Bun.file(..)`). Nothing here reads the file: an allowed one is returned
/// as [`BlobOrStringOrBuffer::Blob`] like an in-memory blob, and its `slice()`
/// is empty.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FileBlobs {
    Allow,
    /// Throws "File blob cannot be used here".
    Reject,
}

// ──────────────────────────────────────────────────────────────────────────

pub enum BlobOrStringOrBuffer {
    Blob(Box<Blob>),
    StringOrBuffer(StringOrBuffer<'static>),
}

impl Drop for BlobOrStringOrBuffer {
    fn drop(&mut self) {
        match self {
            Self::Blob(blob) => {
                let _ = blob.store.with_mut(|s| s.take());
            }
            Self::StringOrBuffer(_) => {
                // StringOrBuffer's own Drop handles cleanup.
            }
        }
    }
}

impl BlobOrStringOrBuffer {
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            Self::Blob(blob) => blob.shared_view(),
            Self::StringOrBuffer(str) => str.slice(),
        }
    }

    pub(crate) fn byte_length(&self) -> usize {
        self.slice().len()
    }

    pub(crate) fn from_js_maybe_file(
        global: &JSGlobalObject,
        value: JSValue,
        file_blobs: FileBlobs,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        // Check StringOrBuffer first because it's more common and cheaper.
        if let Some(str) = StringOrBuffer::from_js(global, value)? {
            return Ok(Some(Self::StringOrBuffer(str)));
        }
        let Some(blob) = value.as_class_ref::<Blob>() else {
            return Ok(None);
        };
        if file_blobs == FileBlobs::Reject && blob.needs_to_read_file() {
            return Err(
                global.throw_invalid_arguments(format_args!("File blob cannot be used here"))
            );
        }
        Ok(Some(Self::Blob(Box::new(blob.dupe()))))
    }

    pub fn from_js(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        Self::from_js_maybe_file(global, value, FileBlobs::Reject)
    }

    /// Like [`from_js_with_encoding_value_allow_request_response`] but takes an
    /// already-parsed [`Encoding`], so callers that must inspect the encoding
    /// first (e.g. to validate odd-length hex) don't coerce `encoding_value`
    /// twice.
    pub(crate) fn from_js_with_encoding(
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        if value.js_type() == jsc::JSType::DOMWrapper {
            if let Some(blob) = value.as_class_ref::<Blob>() {
                return Ok(Some(Self::Blob(Box::new(blob.dupe()))));
            }
        }
        match StringOrBuffer::from_js_with_encoding(global, value, encoding)? {
            Some(s) => Ok(Some(Self::StringOrBuffer(s))),
            None => Ok(None),
        }
    }

    pub(crate) fn from_js_with_encoding_value_allow_request_response(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
        allow_request_response: bool,
    ) -> JsResult<Option<BlobOrStringOrBuffer>> {
        match value.js_type() {
            jsc::JSType::DOMWrapper => {
                // `as_class_ref` is the safe shared-borrow downcast (centralised
                // deref proof in `JSValue`); the JS wrapper roots the payload
                // while `value` is on the stack.
                if let Some(blob) = value.as_class_ref::<Blob>() {
                    return Ok(Some(Self::Blob(Box::new(blob.dupe()))));
                }
                if allow_request_response {
                    if let Some(request) = value.as_class_ref::<Request>() {
                        let body_value = request.get_body_value();
                        body_value.to_blob_if_possible();

                        if let Some(mut any_blob) = body_value.try_use_as_any_blob() {
                            let blob = any_blob.to_blob(global);
                            any_blob.detach();
                            return Ok(Some(Self::Blob(Box::new(blob))));
                        }

                        return Err(global.throw_invalid_arguments(format_args!(
                            "Only buffered Request/Response bodies are supported for now.",
                        )));
                    }

                    if let Some(response) = value.as_class_ref::<Response>() {
                        let body_value = response.get_body_value();
                        body_value.to_blob_if_possible();

                        if let Some(mut any_blob) = body_value.try_use_as_any_blob() {
                            let blob = any_blob.to_blob(global);
                            any_blob.detach();
                            return Ok(Some(Self::Blob(Box::new(blob))));
                        }

                        return Err(global.throw_invalid_arguments(format_args!(
                            "Only buffered Request/Response bodies are supported for now.",
                        )));
                    }
                }
            }
            _ => {}
        }

        match StringOrBuffer::from_js_with_encoding_value_allow_string_object(
            global,
            value,
            encoding_value,
            StringObjects::Allow,
        )? {
            Some(s) => Ok(Some(Self::StringOrBuffer(s))),
            None => Ok(None),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// # Safety
/// As the type's `from_js_async` parser or owned constructor builds it — JS
/// buffers pinned and GC-rooted, strings thread-isolated — nothing in it is
/// thread-affine: a work-pool job may read it and the JS thread drops it.
pub unsafe trait ThreadIsolatedArg {}

/// A `T` built by its `from_js_async` parser or owned constructor (see
/// [`ThreadIsolatedArg`]); nothing else constructs one.
pub struct ThreadIsolated<T>(T);

impl<T: ThreadIsolatedArg> ThreadIsolated<T> {
    /// # Safety
    /// `value` was built as [`ThreadIsolatedArg`] describes (async parse or
    /// owned data only).
    #[inline]
    pub(crate) unsafe fn new(value: T) -> Self {
        Self(value)
    }
}

// SAFETY: `new`'s contract is exactly what makes the value sendable.
unsafe impl<T: ThreadIsolatedArg> Send for ThreadIsolated<T> {}

impl<T> core::ops::Deref for ThreadIsolated<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T> core::ops::DerefMut for ThreadIsolated<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

/// Parsed from JS it is `StringOrBuffer<'static>`; `Utf8` may instead borrow
/// Rust-side bytes for a synchronous call ([`StringOrBuffer::borrowed`]).
pub enum StringOrBuffer<'a> {
    String(Utf8WithString),
    ThreadIsolatedString(Utf8WithString),
    Utf8(Utf8Bytes<'a>),
    /// A JS buffer borrowed for a synchronous call, or owned result bytes not yet handed to JS.
    Buffer(Buffer),
    /// A JS buffer parsed for an async call: pinned and GC-rooted until this drops.
    PinnedBuffer(PinnedArrayBuffer),
}

impl Default for StringOrBuffer<'_> {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl<'a> StringOrBuffer<'a> {
    pub(crate) const EMPTY: Self = StringOrBuffer::Utf8(Utf8Bytes::EMPTY);

    #[inline]
    pub(crate) fn borrowed(bytes: &'a [u8]) -> StringOrBuffer<'a> {
        StringOrBuffer::Utf8(Utf8Bytes::Borrowed(bytes))
    }

    #[inline]
    pub(crate) fn owned(bytes: Vec<u8>) -> StringOrBuffer<'static> {
        StringOrBuffer::Utf8(Utf8Bytes::Owned(bytes))
    }

    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            Self::String(str) => str.slice(),
            Self::ThreadIsolatedString(str) => str.slice(),
            Self::Utf8(str) => str.slice(),
            Self::Buffer(str) => str.slice(),
            Self::PinnedBuffer(buffer) => buffer.slice(),
        }
    }
}

impl StringOrBuffer<'_> {
    pub fn into_js(self, ctx: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Self::ThreadIsolatedString(str) | Self::String(str) => str.into_js(ctx),
            Self::Utf8(utf8) => bun_string_jsc::create_utf8_for_js(ctx, &utf8),
            Self::Buffer(mut buffer) => {
                if buffer.buffer.value != JSValue::ZERO {
                    return Ok(buffer.buffer.value);
                }
                buffer.to_node_buffer(ctx)
            }
            Self::PinnedBuffer(buffer) => Ok(buffer.value),
        }
    }
}

// SAFETY: `Flavor::Async` yields `ThreadIsolatedString` / `Utf8` / `PinnedBuffer` only.
unsafe impl ThreadIsolatedArg for StringOrBuffer<'static> {}

impl StringOrBuffer<'static> {
    /// Rust-owned bytes for a work-pool job.
    #[inline]
    pub(crate) fn owned_isolated(bytes: Vec<u8>) -> ThreadIsolated<Self> {
        // SAFETY: owned bytes only.
        unsafe { ThreadIsolated::new(Self::owned(bytes)) }
    }

    /// Copies a `Sync`-parsed buffer's current bytes (or isolates a string) for a work-pool job.
    pub(crate) fn make_thread_isolated_copy(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        match self {
            Self::Buffer(buffer) => {
                if let Some(current) = buffer.buffer.value.as_array_buffer(global) {
                    buffer.buffer = current;
                }
                let mut bytes = Vec::new();
                if bytes.try_reserve_exact(buffer.slice().len()).is_err() {
                    return Err(global.throw_out_of_memory());
                }
                bytes.extend_from_slice(buffer.slice());
                global.vm().report_extra_memory(bytes.len());
                *self = Self::owned(bytes);
            }
            Self::String(str) => {
                str.make_thread_isolated();
                *self = Self::ThreadIsolatedString(core::mem::take(str));
            }
            Self::ThreadIsolatedString(_) | Self::Utf8(_) => {}
            Self::PinnedBuffer(_) => {
                unreachable!("make_thread_isolated_copy on a value parsed with Flavor::Async")
            }
        }
        Ok(())
    }

    /// `value` is ArrayBuffer-like (the caller checked): borrowed for `Sync`,
    /// pinned and GC-rooted for `Async`.
    pub(crate) fn buffer_from_js(
        global: &JSGlobalObject,
        value: JSValue,
        flavor: Flavor,
    ) -> JsResult<Self> {
        if flavor == Flavor::Sync {
            return Ok(Self::Buffer(Buffer::from_array_buffer(global, value)));
        }
        match PinnedArrayBuffer::root(global, value) {
            Some(buffer) => Ok(Self::PinnedBuffer(buffer)),
            None => Err(global.throw_out_of_memory()),
        }
    }

    pub(crate) fn from_js_to_owned_slice(
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Vec<u8>> {
        if let Some(array_buffer) = value.as_array_buffer(global_object) {
            let bytes = array_buffer.byte_slice();
            global_object
                .vm()
                .report_extra_memory(array_buffer.len as usize);
            return Ok(bytes.to_vec());
        }

        let str = bun_core::String::from_js(value, global_object)?;

        let result = str.to_owned_slice();
        global_object.vm().report_extra_memory(result.len());
        Ok(result)
    }

    /// Out-param core of [`from_js_maybe_async`]. Writes the decoded payload
    /// directly into `*out` and returns
    /// `Ok(true)` on success, `Ok(false)` if `value` is not a string/buffer
    /// type. `*out` is left untouched on `Ok(false)` / `Err`.
    ///
    /// Hot callers (e.g. `NodeHTTPResponse::write_or_end`) should use this
    /// directly — returning `JsResult<Option<StringOrBuffer>>` by value lowers
    /// to ~128B of `vmovups` stack-to-stack copies per call which the
    /// `Option<>`-returning wrappers below cannot always NRVO away.
    #[inline]
    pub(crate) fn from_js_maybe_async_into(
        out: &mut Self,
        global: &JSGlobalObject,
        value: JSValue,
        flavor: Flavor,
        string_objects: StringObjects,
    ) -> JsResult<bool> {
        use jsc::JSType;
        match value.js_type() {
            str_type @ (JSType::String | JSType::StringObject | JSType::DerivedStringObject) => {
                if string_objects == StringObjects::Reject && str_type != JSType::String {
                    return Ok(false);
                }
                let str = bun_core::String::from_js(value, global)?;
                *out = if flavor == Flavor::Async {
                    shared_or_utf8(
                        global,
                        str.into_utf8_with_string_thread_isolated(),
                        Self::ThreadIsolatedString,
                        Self::Utf8,
                    )
                } else {
                    Self::String(str.into_utf8_with_string())
                };
                Ok(true)
            }

            JSType::ArrayBuffer
            | JSType::Int8Array
            | JSType::Uint8Array
            | JSType::Uint8ClampedArray
            | JSType::Int16Array
            | JSType::Uint16Array
            | JSType::Int32Array
            | JSType::Uint32Array
            | JSType::Float32Array
            | JSType::Float16Array
            | JSType::Float64Array
            | JSType::BigInt64Array
            | JSType::BigUint64Array
            | JSType::DataView => {
                *out = Self::buffer_from_js(global, value, flavor)?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    #[inline]
    pub(crate) fn from_js_maybe_async(
        global: &JSGlobalObject,
        value: JSValue,
        flavor: Flavor,
        string_objects: StringObjects,
    ) -> JsResult<Option<Self>> {
        let mut out = Self::EMPTY;
        if Self::from_js_maybe_async_into(&mut out, global, value, flavor, string_objects)? {
            Ok(Some(out))
        } else {
            Ok(None)
        }
    }

    #[inline]
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        Self::from_js_maybe_async(global, value, Flavor::Sync, StringObjects::Allow)
    }

    /// [`from_js`](Self::from_js) for a work-pool job that reads the bytes itself: strings thread-isolated, buffers pinned and GC-rooted, a resizable buffer copied ([`PinnedArrayBuffer::copy_if_resizable`]).
    #[inline]
    pub(crate) fn from_js_async(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<ThreadIsolated<Self>>> {
        let mut parsed =
            Self::from_js_maybe_async(global, value, Flavor::Async, StringObjects::Allow)?;
        if let Some(Self::PinnedBuffer(buffer)) = &mut parsed
            && !buffer.copy_if_resizable(global)
        {
            return Err(global.throw_out_of_memory());
        }
        // SAFETY: parsed with `Flavor::Async`.
        Ok(parsed.map(|v| unsafe { ThreadIsolated::new(v) }))
    }

    #[inline]
    pub(crate) fn from_js_with_encoding(
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
    ) -> JsResult<Option<Self>> {
        Self::from_js_with_encoding_maybe_async(
            global,
            value,
            encoding,
            Flavor::Sync,
            StringObjects::Allow,
        )
    }

    /// Out-param convenience wrapper — see [`from_js_with_encoding_maybe_async_into`].
    #[inline]
    pub(crate) fn from_js_with_encoding_into(
        out: &mut Self,
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
    ) -> JsResult<bool> {
        Self::from_js_with_encoding_maybe_async_into(
            out,
            global,
            value,
            encoding,
            Flavor::Sync,
            StringObjects::Allow,
        )
    }

    /// Out-param core of [`from_js_with_encoding_maybe_async`]. Writes into
    /// `*out` and returns `Ok(true)` on success, `Ok(false)` for not-a-
    /// string-or-buffer. See [`from_js_maybe_async_into`] for rationale.
    #[inline]
    pub(crate) fn from_js_with_encoding_maybe_async_into(
        out: &mut Self,
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
        flavor: Flavor,
        string_objects: StringObjects,
    ) -> JsResult<bool> {
        if value.is_cell() && value.js_type().is_array_buffer_like() {
            *out = Self::buffer_from_js(global, value, flavor)?;
            return Ok(true);
        }

        if encoding == Encoding::Utf8 {
            return Self::from_js_maybe_async_into(out, global, value, flavor, string_objects);
        }

        if value.is_string() {
            let str = bun_core::String::from_js(value, global)?;
            if str.is_empty() {
                return Self::from_js_maybe_async_into(out, global, value, flavor, string_objects);
            }

            use crate::webcore::encoding::BunStringEncode as _;
            let encoded = str.encode(encoding);
            global.vm().report_extra_memory(encoded.len());

            *out = Self::owned(encoded);
            return Ok(true);
        }

        Ok(false)
    }

    #[inline]
    pub(crate) fn from_js_with_encoding_maybe_async(
        global: &JSGlobalObject,
        value: JSValue,
        encoding: Encoding,
        flavor: Flavor,
        string_objects: StringObjects,
    ) -> JsResult<Option<Self>> {
        let mut out = Self::EMPTY;
        if Self::from_js_with_encoding_maybe_async_into(
            &mut out,
            global,
            value,
            encoding,
            flavor,
            string_objects,
        )? {
            Ok(Some(out))
        } else {
            Ok(None)
        }
    }

    pub(crate) fn from_js_with_encoding_value_allow_string_object(
        global: &JSGlobalObject,
        value: JSValue,
        encoding_value: JSValue,
        string_objects: StringObjects,
    ) -> JsResult<Option<Self>> {
        let encoding: Encoding = 'brk: {
            if !encoding_value.is_cell() {
                break 'brk Encoding::Utf8;
            }
            break 'brk Encoding::from_js(encoding_value, global)?.unwrap_or(Encoding::Utf8);
        };
        Self::from_js_with_encoding_maybe_async(
            global,
            value,
            encoding,
            Flavor::Sync,
            string_objects,
        )
    }
}

// String encoding — see `crate::webcore::encoding::BunStringEncode`.

// ──────────────────────────────────────────────────────────────────────────

/// https://github.com/nodejs/node/blob/master/lib/buffer.js#L587
/// See `webcore::encoding` for encoding and decoding functions.
/// must match src/jsc/bindings/BufferEncodingType.h
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, strum::IntoStaticStr)]
pub enum Encoding {
    Utf8,
    Ucs2,
    Utf16le,
    Latin1,
    Ascii,
    Base64,
    Base64url,
    Hex,

    /// Refer to the buffer's encoding
    Buffer,
}

bun_core::comptime_string_map! {
    /// Buffer encoding names → [`Encoding`]. Looked up case-insensitively
    /// ([`Encoding::from`]), so keys must stay lowercase.
    static ENCODING_MAP: Encoding = {
        b"hex" => Encoding::Hex,
        b"utf8" => Encoding::Utf8,
        b"ucs2" => Encoding::Utf16le,
        b"utf-8" => Encoding::Utf8,
        b"ucs-2" => Encoding::Utf16le,
        b"ascii" => Encoding::Ascii,
        b"base64" => Encoding::Base64,
        b"binary" => Encoding::Latin1,
        b"latin1" => Encoding::Latin1,
        b"buffer" => Encoding::Buffer,
        b"utf16le" => Encoding::Utf16le,
        b"utf16-le" => Encoding::Utf16le,
        b"base64url" => Encoding::Base64url,
    };
}

impl From<Encoding> for bun_core::NodeEncoding {
    fn from(e: Encoding) -> Self {
        // Both enums are `#[repr(u8)]` with identical discriminant order
        // (Utf8, Ucs2, Utf16le, Latin1, Ascii, Base64, Base64url, Hex, Buffer).
        match e {
            Encoding::Utf8 => Self::Utf8,
            Encoding::Ucs2 => Self::Ucs2,
            Encoding::Utf16le => Self::Utf16le,
            Encoding::Latin1 => Self::Latin1,
            Encoding::Ascii => Self::Ascii,
            Encoding::Base64 => Self::Base64,
            Encoding::Base64url => Self::Base64url,
            Encoding::Hex => Self::Hex,
            Encoding::Buffer => Self::Buffer,
        }
    }
}

impl From<bun_core::NodeEncoding> for Encoding {
    fn from(e: bun_core::NodeEncoding) -> Self {
        // Reverse of the impl above — both enums are `#[repr(u8)]` with identical
        // discriminant order; required so `webcore::encoding::{to_string,to_bun_string}`'s
        // `impl Into<Encoding>` bound accepts `bun_core::NodeEncoding` directly.
        match e {
            bun_core::NodeEncoding::Utf8 => Self::Utf8,
            bun_core::NodeEncoding::Ucs2 => Self::Ucs2,
            bun_core::NodeEncoding::Utf16le => Self::Utf16le,
            bun_core::NodeEncoding::Latin1 => Self::Latin1,
            bun_core::NodeEncoding::Ascii => Self::Ascii,
            bun_core::NodeEncoding::Base64 => Self::Base64,
            bun_core::NodeEncoding::Base64url => Self::Base64url,
            bun_core::NodeEncoding::Hex => Self::Hex,
            bun_core::NodeEncoding::Buffer => Self::Buffer,
        }
    }
}

pub(crate) fn js_assert_encoding_valid(
    global: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    let value = call_frame.argument(0);
    let _ = Encoding::assert(value, global, Encoding::Utf8)?;
    Ok(JSValue::UNDEFINED)
}

impl Encoding {
    /// Caller must verify the value is a string
    pub(crate) fn from(slice: &[u8]) -> Option<Encoding> {
        ENCODING_MAP.get_ascii_case_insensitive(slice).copied()
    }

    /// Case-insensitive lookup against a `bun.String` without allocating
    /// (`bun.String.inMapCaseInsensitive`): UTF-16 code units are narrowed
    /// into a stack buffer (any non-ASCII unit ⇒ miss — no encoding name
    /// contains one) before the map lookup.
    pub(crate) fn from_bun_string(s: &bun_core::String) -> Option<Encoding> {
        s.in_map_case_insensitive(&ENCODING_MAP)
    }
}

impl Encoding {
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Encoding>> {
        // `from_bun_string` narrows into a stack buffer — no `to_utf8()`
        // allocation needed for a short ASCII key.
        let str = bun_core::String::from_js(value, global)?;
        Ok(Self::from_bun_string(&str))
    }

    pub(crate) fn assert(
        value: JSValue,
        global_object: &JSGlobalObject,
        default: Encoding,
    ) -> JsResult<Encoding> {
        if value.is_falsey() {
            return Ok(default);
        }

        if !value.is_string() {
            return Err(Self::throw_encoding_error(global_object, value));
        }

        match Self::from_js_with_default_on_empty(value, global_object, default)? {
            Some(e) => Ok(e),
            None => Err(Self::throw_encoding_error(global_object, value)),
        }
    }

    pub(crate) fn from_js_with_default_on_empty(
        value: JSValue,
        global_object: &JSGlobalObject,
        default: Encoding,
    ) -> JsResult<Option<Encoding>> {
        let str = bun_core::String::from_js(value, global_object)?;
        if str.is_empty() {
            return Ok(Some(default));
        }
        Ok(Self::from(str.to_utf8().slice()))
    }

    pub(crate) fn throw_encoding_error(
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> jsc::JsError {
        global_object
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "encoding '{}' is an invalid encoding",
                    value.fmt_string(global_object)
                ),
            )
            .throw()
    }

    /// `max_size` is a runtime arg (see `encode_with_size`); callers pass
    /// `EVP_MAX_MD_SIZE` etc.
    pub(crate) fn encode_with_max_size(
        self,
        global_object: &JSGlobalObject,
        max_size: usize,
        input: &[u8],
    ) -> JsResult<JSValue> {
        debug_assert!(
            input.len() <= max_size,
            "input length ({}) should not exceed max_size ({})",
            input.len(),
            max_size,
        );
        match self {
            Self::Buffer => jsc::ArrayBuffer::create_buffer(global_object, input),
            enc => crate::webcore::encoding::to_string(input, global_object, enc),
        }
    }

    pub fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        // `Encoding` is `#[repr(u8)]` matching BufferEncodingType.h.
        WebCore_BufferEncodingType_toJS(global_object, self)
    }
}

// Externs stay in this crate per PORTING.md §FFI: "If your file has externs
// and isn't already *_sys, leave them in place".
unsafe extern "C" {
    safe fn WebCore_BufferEncodingType_toJS(
        global_object: &JSGlobalObject,
        encoding: Encoding,
    ) -> JSValue;
}

// ──────────────────────────────────────────────────────────────────────────

// LAYERING: single nominal `PathLike`/`PathOrFileDescriptor` live in
// `bun_jsc::node_path` so `bun_jsc::webcore_types::store::File::pathlike`
// and the `Store`/`Blob` constructors here share one type. This module
// re-exports them and layers the JS-argument-parsing helpers via the
// `PathLikeExt` / `PathOrFdExt` extension traits.
pub use bun_jsc::node_path::{PathLike, PathOrFileDescriptor};

/// Returned by [`PathLikeExt::slice_w`] / [`PathLikeExt::os_path`] /
/// [`PathLikeExt::os_path_kernel32`] when the path's UTF-16 form would not
/// fit a `WPathBuffer` (`strings::fits_in_wide_path_buffer`). NT caps paths
/// at `PATH_MAX_WIDE` units, so such a path cannot exist on disk — callers
/// map this to `false`/`ENAMETOOLONG` as appropriate instead of letting the
/// conversion overflow (oven-sh/bun#27775).
#[derive(Debug, Clone, Copy)]
pub struct NameTooLong;

/// `bun_runtime`-tier behaviour layered on `bun_jsc::node_path::PathLike`.
///
/// `thread_isolated_copy` / `slice` / `estimated_size` are
/// inherent on the lower-tier type (see `bun_jsc::node_path`); this trait
/// adds only the path-buffer slicers and JS-argument parsing that depend on
/// `bun_runtime` types (`Valid`, `ArgumentsSlice` cursor flow).
pub trait PathLikeExt {
    fn slice_z_with_force_copy<'a, const FORCE: bool>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> &'a ZStr
    where
        Self: Sized;
    fn slice_z<'a>(&'a self, buf: &'a mut PathBuffer) -> &'a ZStr
    where
        Self: Sized;
    fn slice_w<'a>(&'a self, buf: &'a mut WPathBuffer) -> Result<&'a WStr, NameTooLong>
    where
        Self: Sized;
    fn os_path<'a>(&'a self, buf: &'a mut OSPathBuffer) -> Result<&'a OSPathSliceZ, NameTooLong>
    where
        Self: Sized;
    fn os_path_kernel32<'a>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> Result<&'a OSPathSliceZ, NameTooLong>
    where
        Self: Sized;
    fn from_js(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathLike<'static>>>
    where
        Self: Sized;

    /// `from_js` + Node's `ERR_INVALID_ARG_VALUE` "<name> must be a string
    /// or TypedArray" throw on `None`. Collapses the open-coded
    /// `?.ok_or_else(|| ctx.throw_invalid_arguments(...))?` repeated 22× in
    /// `node_fs.rs::args::*::from_js`.
    #[inline]
    fn from_js_required(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
        name: &str,
    ) -> JsResult<PathLike<'static>>
    where
        Self: Sized,
    {
        Self::from_js(ctx, arguments)?.ok_or_else(|| {
            ctx.throw_invalid_arguments(format_args!("{name} must be a string or TypedArray"))
        })
    }

    fn from_js_with_allocator(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathLike<'static>>>
    where
        Self: Sized;
    /// Throws ENAMETOOLONG too; [`Self::from_js`] defers it for async bindings instead.
    fn from_bun_string(
        global: &JSGlobalObject,
        str: bun_core::String,
        will_be_async: bool,
    ) -> JsResult<PathLike<'static>>
    where
        Self: Sized;
}

/// `bun_runtime`-tier behaviour layered on `bun_jsc::node_path::PathOrFileDescriptor`.
pub(crate) trait PathOrFdExt {
    fn from_js(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathOrFileDescriptor<'static>>>
    where
        Self: Sized;
}

impl PathLikeExt for PathLike<'_> {
    // Const-generics can't change return mutability, so this always returns
    // `&ZStr`. A future force=true caller that needs `&mut ZStr` will need a
    // separate method.
    fn slice_z_with_force_copy<'a, const FORCE: bool>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> &'a ZStr {
        let sliced = self.slice();

        #[cfg(windows)]
        {
            // Only take the fast path for paths that can exist on NT at
            // all (≤ ~32757 UTF-16 units). That bounds the `\\?\`-prefixed
            // copy below in bytes too (≤ 3×32757 + 5 < MAX_PATH_BYTES);
            // the cwd-join branch of `resolve_cwd_with_external_buf_z`
            // prepends the cwd's filesystem root — arbitrarily long for UNC
            // cwds — and bounds-checks internally, surfacing NameTooLong.
            // Anything over-long falls through to the plain copy at the
            // bottom, which fits without the prefix (or takes the too-long
            // fallback) and fails at the syscall.
            if bun_paths::is_absolute(sliced) && strings::fits_in_wide_path_buffer(sliced) {
                if sliced.len() > 2
                    && bun_paths::is_drive_letter(sliced[0])
                    && sliced[1] == b':'
                    && bun_paths::is_sep_any(sliced[2])
                {
                    // Add the long path syntax. This affects most of node:fs
                    // Normalize the path directly into buf without an intermediate
                    // buffer. The input (sliced) already has a drive letter, so
                    // resolveCWDWithExternalBufZ would just memcpy it, making the
                    // temporary allocation unnecessary.
                    buf[0..4].copy_from_slice(&bun_sys::windows::LONG_PATH_PREFIX_U8);
                    let n = bun_paths::resolve_path::normalize_buf::<bun_paths::platform::Windows>(
                        sliced,
                        &mut buf[4..],
                    )
                    .len();
                    buf[4 + n] = 0;
                    // SAFETY: buf[4+n] == 0 written above.
                    return ZStr::from_buf(&buf[..], 4 + n);
                }
                // reshaped for borrowck — capture the length so
                // the `Ok` borrow ends at the match, then re-derive.
                let resolved_len = match bun_paths::resolve_path::PosixToWinNormalizer::resolve_cwd_with_external_buf_z(buf, sliced) {
                    Ok(res) => Some(res.len()),
                    // The cwd root + path don't fit `buf` (UNC cwds can push
                    // a near-MAX_PATH_BYTES path over); fall through to the
                    // plain copy / too-long handling below.
                    Err(bun_paths::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG)) => None,
                    Err(e) => panic!("Error while resolving path: {e:?}"),
                };
                if let Some(len) = resolved_len {
                    // SAFETY: `resolve_cwd_with_external_buf_z` wrote the NUL
                    // at `buf[len]`.
                    return ZStr::from_buf(&buf[..], len);
                }
            }
        }

        if sliced.is_empty() {
            if !FORCE {
                return ZStr::EMPTY;
            }

            buf[0] = 0;
            // SAFETY: buf[0] == 0 written above.
            return ZStr::from_buf(&buf[..], 0);
        }

        if !FORCE {
            if sliced[sliced.len() - 1] == 0 {
                // SAFETY: last byte is NUL.
                return ZStr::from_slice_with_nul(sliced);
            }
        }

        if sliced.len() >= buf.len() {
            bun_core::debug_warn!(
                "path too long: {} bytes exceeds PathBuffer capacity of {}\n",
                sliced.len(),
                buf.len()
            );
            if !FORCE {
                return ZStr::EMPTY;
            }

            buf[0] = 0;
            // SAFETY: buf[0] == 0 written above.
            return ZStr::from_buf(&buf[..], 0);
        }

        buf[..sliced.len()].copy_from_slice(sliced);
        buf[sliced.len()] = 0;
        // SAFETY: buf[sliced.len()] == 0 written above.
        ZStr::from_buf(&buf[..], sliced.len())
    }

    #[inline]
    fn slice_z<'a>(&'a self, buf: &'a mut PathBuffer) -> &'a ZStr {
        self.slice_z_with_force_copy::<false>(buf)
    }

    #[inline]
    fn slice_w<'a>(&'a self, buf: &'a mut WPathBuffer) -> Result<&'a WStr, NameTooLong> {
        let sliced = self.slice();
        if !strings::fits_in_wide_path_buffer(sliced) {
            return Err(NameTooLong);
        }
        Ok(strings::paths::to_w_path(buf, sliced))
    }

    #[inline]
    fn os_path<'a>(&'a self, buf: &'a mut OSPathBuffer) -> Result<&'a OSPathSliceZ, NameTooLong> {
        #[cfg(windows)]
        {
            return self.slice_w(buf);
        }
        #[cfg(not(windows))]
        {
            Ok(self.slice_z_with_force_copy::<false>(buf))
        }
    }

    #[inline]
    fn os_path_kernel32<'a>(
        &'a self,
        buf: &'a mut PathBuffer,
    ) -> Result<&'a OSPathSliceZ, NameTooLong> {
        #[cfg(windows)]
        {
            let s = self.slice();
            let mut b = bun_paths::path_buffer_pool::get();
            // RAII guard puts back on Drop.

            // Device paths (\\.\, \\?\) and NT object paths (\??\) should not be normalized
            // because the "." in \\.\pipe\name would be incorrectly stripped as a "current directory" component.
            if s.len() >= 4
                && bun_paths::is_sep_any(s[0])
                && bun_paths::is_sep_any(s[1])
                && (s[2] == b'.' || s[2] == b'?')
                && bun_paths::is_sep_any(s[3])
            {
                if !strings::fits_in_wide_path_buffer(s) {
                    return Err(NameTooLong);
                }
                // SAFETY: reinterpreting PathBuffer ([u8; N]) as [u16] — 2-byte
                // alignment is runtime-asserted inside `bytes_as_slice_mut`;
                // see PathBuffer doc comment for
                // why the buffer is always sufficiently aligned in practice.
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
                return Ok(strings::to_kernel32_path(buf_u16, s));
            }
            if !s.is_empty() && bun_paths::is_sep_any(s[0]) {
                // Bail before the cwd resolution + normalization below write
                // into fixed u8 buffers: UNC-shaped inputs pass through the
                // resolver untouched and can reach `normalize_buf` at full
                // MAX_PATH_BYTES length, whose root handling writes one past
                // the input length.
                if !strings::fits_in_wide_path_buffer(s) {
                    return Err(NameTooLong);
                }
                // `buf` is the scratch for cwd-resolution; `b` is the pooled
                // scratch for normalisation; final wide path lands back in `buf`.
                let resolve = match bun_paths::resolve_path::PosixToWinNormalizer::resolve_cwd_with_external_buf(
                    buf, s,
                ) {
                    Ok(r) => r,
                    // The cwd root + path don't fit the resolution buffer
                    // (UNC cwds can push a near-MAX_PATH_BYTES path over) —
                    // such a path can't exist on NT.
                    Err(bun_paths::Error::Sys(bun_errno::SystemErrno::ENAMETOOLONG)) => return Err(NameTooLong),
                    Err(e) => panic!("Error while resolving path: {e:?}"),
                };
                let normal = bun_paths::resolve_path::normalize_buf::<bun_paths::platform::Windows>(
                    resolve,
                    &mut b[..],
                );
                if !strings::fits_in_wide_path_buffer(normal) {
                    return Err(NameTooLong);
                }
                // `resolve`'s borrow of `buf` ended at the line above (NLL).
                // SAFETY: same alignment note as above.
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
                return Ok(strings::to_kernel32_path(buf_u16, normal));
            }
            // Handle "." specially since normalizeStringBuf strips it to an empty string
            if s.len() == 1 && s[0] == b'.' {
                // SAFETY: see alignment note above (PathBuffer reinterpreted as [u16]).
                let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
                return Ok(strings::to_kernel32_path(buf_u16, b"."));
            }
            let normal = bun_paths::resolve_path::normalize_string_buf::<
                true,
                bun_paths::platform::Windows,
                false,
            >(s, &mut b[..]);
            if !strings::fits_in_wide_path_buffer(normal) {
                return Err(NameTooLong);
            }
            // SAFETY: see alignment note above (PathBuffer reinterpreted as [u16]).
            let buf_u16 = unsafe { bun_core::bytes_as_slice_mut::<u16>(&mut buf[..]) };
            return Ok(strings::to_kernel32_path(buf_u16, normal));
        }

        #[cfg(not(windows))]
        {
            Ok(self.slice_z_with_force_copy::<false>(buf))
        }
    }

    fn from_js(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathLike<'static>>> {
        Self::from_js_with_allocator(ctx, arguments)
    }

    fn from_js_with_allocator(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathLike<'static>>> {
        let Some(arg) = arguments.next() else {
            return Ok(None);
        };
        use jsc::JSType;
        let path = match arg.js_type() {
            JSType::Uint8Array | JSType::DataView | JSType::ArrayBuffer => {
                let mut buffer = if arguments.will_be_async {
                    PinnedArrayBuffer::root(ctx, arg)
                } else {
                    PinnedArrayBuffer::pin(ctx, arg)
                }
                .ok_or_else(|| ctx.throw_out_of_memory())?;
                // Read after this call (pool thread, a later argument's getter, a `Blob` store): a shrink in between unmaps the pages.
                if !buffer.copy_if_resizable(ctx) {
                    return Err(ctx.throw_out_of_memory());
                }
                Valid::path_buffer(buffer.slice(), ctx)?;
                Valid::path_null_bytes(buffer.slice(), ctx)?;
                arguments.eat();
                PathLike::Buffer(buffer)
            }

            JSType::String | JSType::StringObject | JSType::DerivedStringObject => {
                let str = arg.to_bun_string(ctx)?;
                arguments.eat();
                path_like_from_string(ctx, str, arguments.will_be_async)?
            }
            _ => {
                if let Some(domurl) = jsc::DOMURL::cast(arg) {
                    use jsc::dom_url::ToFileSystemPathError;
                    let str = match domurl.file_system_path() {
                        Ok(s) => s,
                        Err(ToFileSystemPathError::NotFileUrl) => {
                            return Err(ctx
                                .err(
                                    jsc::ErrorCode::INVALID_URL_SCHEME,
                                    format_args!("URL must be a non-empty \"file:\" path"),
                                )
                                .throw());
                        }
                        Err(ToFileSystemPathError::InvalidPath) => {
                            return Err(ctx
                                .err(
                                    jsc::ErrorCode::INVALID_FILE_URL_PATH,
                                    format_args!("URL must be a non-empty \"file:\" path"),
                                )
                                .throw());
                        }
                        Err(ToFileSystemPathError::InvalidHost) => {
                            return Err(ctx
                                .err(
                                    jsc::ErrorCode::INVALID_FILE_URL_HOST,
                                    format_args!("URL must be a non-empty \"file:\" path"),
                                )
                                .throw());
                        }
                    };
                    if str.is_empty() {
                        return Err(ctx
                            .err(
                                jsc::ErrorCode::INVALID_ARG_VALUE,
                                format_args!("URL must be a non-empty \"file:\" path"),
                            )
                            .throw());
                    }
                    arguments.eat();
                    path_like_from_string(ctx, str, arguments.will_be_async)?
                } else {
                    return Ok(None);
                }
            }
        };

        Valid::path_length(path, ctx, arguments).map(Some)
    }

    fn from_bun_string(
        global: &JSGlobalObject,
        str: bun_core::String,
        will_be_async: bool,
    ) -> JsResult<PathLike<'static>> {
        let path = path_like_from_string(global, str, will_be_async)?;
        match Valid::path_too_long(path.slice()) {
            Some(err) => Err(global.throw_value(err.to_error_instance(global))),
            None => Ok(path),
        }
    }
}

/// `str` as a `PathLike`, NUL-checked; the caller checks the length ([`Valid::path_length`]).
fn path_like_from_string(
    global: &JSGlobalObject,
    str: bun_core::String,
    will_be_async: bool,
) -> JsResult<PathLike<'static>> {
    let utf8 = if will_be_async {
        str.into_utf8_with_string_thread_isolated()
    } else {
        str.into_utf8_with_string()
    };

    Valid::path_null_bytes(utf8.slice(), global)?;

    let shared = if will_be_async {
        PathLike::ThreadIsolatedString
    } else {
        PathLike::String
    };
    Ok(shared_or_utf8(global, utf8, shared, PathLike::Utf8))
}

/// `shared(utf8)` when the UTF-8 bytes are read out of `utf8`'s WTF string
/// (costs nothing to keep both); otherwise only the transcoded copy, reported
/// to the GC, as `owned(..)`.
fn shared_or_utf8<T>(
    global: &JSGlobalObject,
    utf8: Utf8WithString,
    shared: impl FnOnce(Utf8WithString) -> T,
    owned: impl FnOnce(Utf8Bytes<'static>) -> T,
) -> T {
    if utf8.is_shared() {
        return shared(utf8);
    }
    let utf8 = utf8.into_utf8();
    if let Utf8Bytes::Owned(transcoded) = &utf8 {
        global.vm().report_extra_memory(transcoded.len());
    }
    owned(utf8)
}

// ──────────────────────────────────────────────────────────────────────────

pub struct Valid;

impl Valid {
    /// The ENAMETOOLONG the syscall would return: no `PathBuffer` fits this path plus its NUL.
    pub(crate) fn path_too_long(path: &[u8]) -> Option<bun_sys::SystemError> {
        if path.len() < MAX_PATH_BYTES {
            return None;
        }
        let mut system_error =
            bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
                .with_path(path)
                .to_system_error();
        system_error.syscall = bun_core::String::DEAD;
        Some(system_error)
    }

    /// Sync bindings throw; async ones get it as `arguments.deferred_error` and a placeholder path.
    pub(crate) fn path_length(
        path: PathLike<'static>,
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<PathLike<'static>> {
        let Some(err) = Self::path_too_long(path.slice()) else {
            return Ok(path);
        };
        drop(path);
        if !arguments.will_be_async {
            return Err(ctx.throw_value(err.to_error_instance(ctx)));
        }
        if arguments.deferred_error.is_none() {
            arguments.deferred_error = Some(Box::new(err));
        }
        Ok(PathLike::default())
    }

    pub(crate) fn path_buffer(slice: &[u8], ctx: &JSGlobalObject) -> JsResult<()> {
        if slice.is_empty() {
            return Err(
                ctx.throw_invalid_arguments(format_args!("Invalid path buffer: can't be empty"))
            );
        }
        Ok(())
    }

    pub(crate) fn path_null_bytes(slice: &[u8], global: &JSGlobalObject) -> JsResult<()> {
        if strings::index_of_char(slice, 0).is_some() {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received {}",
                        bun_fmt::quote(slice)
                    ),
                )
                .throw());
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct VectorArrayBuffer {
    pub value: JSValue,
    pub(crate) buffers: Vec<PlatformIoVec>,
    /// The collected elements, in order. Rooted (and their backing stores
    /// pinned), along with `value`, from `from_js(.., pin: true)` until drop.
    pub(crate) views: Vec<JSValue>,
    pinned: bool,
}

impl Drop for VectorArrayBuffer {
    /// Releases the roots and pins taken by `from_js(.., pin: true)` (JS thread).
    fn drop(&mut self) {
        if !self.pinned {
            return;
        }
        for view in &self.views {
            view.unpin_array_buffer();
            view.unprotect();
        }
        self.value.unprotect();
    }
}

unsafe extern "C" {
    fn Bun__JSArray__collectBufferSpans(
        global_object: &JSGlobalObject,
        value: JSValue,
        pin_buffers: bool,
        ctx: *mut std::ffi::c_void,
        append: unsafe extern "C" fn(
            ctx: *mut std::ffi::c_void,
            element: JSValue,
            data: *mut u8,
            byte_len: usize,
        ),
    ) -> i32;
}

unsafe extern "C" fn append_buffer_span(
    ctx: *mut std::ffi::c_void,
    element: JSValue,
    data: *mut u8,
    byte_len: usize,
) {
    // SAFETY: `ctx` is the `&mut VectorArrayBuffer` passed to
    // `Bun__JSArray__collectBufferSpans` by `from_js` below, alive for the
    // duration of the call.
    let out = unsafe { &mut *ctx.cast::<VectorArrayBuffer>() };
    let slice: &mut [u8] = if data.is_null() || byte_len == 0 {
        &mut []
    } else {
        // SAFETY: `data..data + byte_len` is the byte range of `element`'s
        // backing store, valid and unaliased for the duration of the callback.
        unsafe { std::slice::from_raw_parts_mut(data, byte_len) }
    };
    out.buffers.push(bun_sys::platform_iovec_create(slice));
    out.views.push(element);
}

impl VectorArrayBuffer {
    /// Collect an array of ArrayBufferViews into iovecs. Every element is read
    /// before any raw pointer is taken, so user code run by an indexed read (a
    /// getter, a proxy trap) cannot free a backing store that has already been
    /// captured.
    ///
    /// `pin` is required when the spans outlive this call (async I/O): `val` and
    /// each element are rooted and each backing store is pinned against detach
    /// until the value drops.
    pub fn from_js(
        global_object: &JSGlobalObject,
        val: JSValue,
        pin: bool,
    ) -> JsResult<VectorArrayBuffer> {
        let mut out = VectorArrayBuffer {
            value: val,
            buffers: Vec::new(),
            views: Vec::new(),
            pinned: false,
        };
        bun_jsc::validation_scope!(scope, global_object);
        // SAFETY: `out` outlives the call; the callback only dereferences the
        // ctx pointer it is handed.
        let status = unsafe {
            Bun__JSArray__collectBufferSpans(
                global_object,
                val,
                pin,
                (&raw mut out).cast(),
                append_buffer_span,
            )
        };
        scope.assert_exception_presence_matches(status == -1);
        if pin {
            // The C++ side already pinned each backing store; root the views
            // themselves so a getter-returned element that is not reachable
            // from `value` survives until completion. Set `pinned` even on
            // failure so `Drop` balances the elements collected before the error.
            out.pinned = true;
            for view in &out.views {
                view.protect();
            }
            val.protect();
        }
        match status {
            0 => Ok(out),
            -1 => Err(jsc::JsError::Thrown),
            2 => Err(global_object.throw_out_of_memory()),
            _ => {
                Err(global_object
                    .throw_invalid_arguments(format_args!("Expected ArrayBufferView[]")))
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub fn mode_from_js(ctx: &JSGlobalObject, value: JSValue) -> JsResult<Option<Mode>> {
    let mode_int: u32 = if value.is_number() {
        validators::validate_uint32(ctx, value, format_args!("mode"), false)?
    } else {
        if value.is_undefined_or_null() {
            return Ok(None);
        }

        // Node gates on `typeof value === 'string'`, so a `new String(...)`
        // wrapper falls through to the number-only validator.
        if !value.is_string_literal() {
            return Err(ctx.throw_invalid_argument_type_value(b"mode", b"number", value));
        }

        // An easier method of constructing the mode is to use a sequence of
        // three octal digits (e.g. 765). The left-most digit (7 in the example),
        // specifies the permissions for the file owner. The middle digit (6 in
        // the example), specifies permissions for the group. The right-most
        // digit (5 in the example), specifies the permissions for others.

        let str_view = value.to_js_string_view(ctx)?;
        let utf8 = str_view.to_utf8();
        let slice = utf8.slice();

        // Node validates mode strings against /^[0-7]+$/ before parsing.
        if slice.is_empty() || !slice.iter().all(|b| (b'0'..=b'7').contains(b)) {
            let actual = JSGlobalObject::inspect_for_error_message(ctx, value)?;
            return Err(ctx
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The argument 'mode' must be a 32-bit unsigned integer or an octal string. Received {}",
                        actual
                    ),
                )
                .throw());
        }

        // Node range-checks the parsed octal string with the same validateUint32
        // as numeric modes (> u32::MAX is ERR_OUT_OF_RANGE). `slice` is already
        // [0-7]+, so the only parse error is Overflow; u64::MAX stays out of range.
        let parsed = strings::parse_int::<u64>(slice, 8).unwrap_or(u64::MAX);
        validators::validate_uint32(
            ctx,
            JSValue::js_number_from_uint64(parsed),
            format_args!("mode"),
            false,
        )?
    };

    Ok(Some(mode_int as Mode))
}

// ──────────────────────────────────────────────────────────────────────────

// LAYERING: `Clone for PathOrFileDescriptor` and the `SerializeTag` enum now
// live alongside the type in `bun_jsc::node_path` (orphan rules forbid the
// foreign-type impl here). Re-export the tag so downstream
// `crate::node::types::PathOrFileDescriptorSerializeTag` paths keep resolving.
pub use bun_jsc::node_path::PathOrFileDescriptorSerializeTag;

impl PathOrFdExt for PathOrFileDescriptor<'_> {
    fn from_js(
        ctx: &JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Option<PathOrFileDescriptor<'static>>> {
        let Some(first) = arguments.next() else {
            return Ok(None);
        };

        if let Some(fd) = Fd::from_js_validated(first, ctx)? {
            arguments.eat();
            return Ok(Some(PathOrFileDescriptor::Fd(fd)));
        }

        match PathLike::from_js_with_allocator(ctx, arguments)? {
            Some(path) => Ok(Some(PathOrFileDescriptor::Path(path))),
            None => Ok(None),
        }
    }
}

// Drop: unref()s the path string if it is a PathLike (via PathLike's Drop).
// Does nothing for file descriptors, **does not** close file descriptors.
// (No explicit `impl Drop` needed — field drop of PathLike handles it.)

// ──────────────────────────────────────────────────────────────────────────

/// Non-exhaustive set of flag values; newtype over c_int.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct FileSystemFlags(c_int);

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FileSystemFlagsKind {
    Access,
    CopyFile,
}

impl FileSystemFlags {
    // `pub type TagType = c_int;` would be an inherent associated
    // type (unstable). Dropped — callers use `c_int` directly.

    /// Open file for appending. The file is created if it does not exist.
    pub(crate) const A: Self = Self(O::APPEND | O::WRONLY | O::CREAT);
    /// Open file for reading. An exception occurs if the file does not exist.
    pub(crate) const R: Self = Self(O::RDONLY);
    /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    pub(crate) const W: Self = Self(O::TRUNC | O::CREAT | O::WRONLY);

    #[inline]
    pub(crate) fn as_int(self) -> c_int {
        self.0
    }
}

impl FileSystemFlags {
    pub fn from_js(ctx: &JSGlobalObject, val: JSValue) -> JsResult<Option<FileSystemFlags>> {
        if val.is_number() {
            // Match Node's stringToFlags, which runs validateInt32 on a numeric
            // `flags`: accept any integer-valued number in the int32 range,
            // regardless of whether JSC boxed it as an int32 or a double. Go's
            // `syscall/js` bridge reads arguments out of wasm memory with
            // getFloat64, so valid flags like 578 (O_RDWR|O_CREAT|O_TRUNC)
            // arrive double-boxed and must not be rejected.
            let number = validators::validate_int32(ctx, val, "flags", None, None)?;
            let flags = number.max(0);
            // On Windows, numeric flags from fs.constants (e.g. O_CREAT=0x100)
            // use the platform's native MSVC/libuv values which differ from the
            // internal bun.O representation. Convert them here so downstream
            // code that operates on bun.O flags works correctly.
            #[cfg(windows)]
            {
                return Ok(Some(FileSystemFlags(bun_libuv_sys::O::to_bun_o(flags))));
            }
            #[cfg(not(windows))]
            {
                return Ok(Some(FileSystemFlags(flags)));
            }
        }

        if val.is_undefined_or_null() {
            return Ok(None);
        }

        // Node switches on the value with strict equality, so only primitive
        // strings can match; `new String("w")` and every other object throw.
        if val.is_string_literal() {
            let str = val.to_js_string_view(ctx)?;
            // The longest valid flag string is 3 bytes ("as+" etc).
            if str.length() >= 1 && str.length() <= 3 {
                let key_slice = str.to_utf8();
                if let Some(flags) = FILE_SYSTEM_FLAGS_MAP.get(key_slice.slice()).copied() {
                    return Ok(Some(FileSystemFlags(flags)));
                }
            }
        }

        let actual = JSGlobalObject::inspect_for_error_message(ctx, val)?;
        Err(ctx
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!("The argument 'flags' is invalid. Received {}", actual),
            )
            .throw())
    }

    /// Equivalent of GetValidFileMode, which is used to implement fs.access and copyFile
    pub(crate) fn from_js_number_only(
        global: &JSGlobalObject,
        value: JSValue,
        kind: FileSystemFlagsKind,
    ) -> JsResult<FileSystemFlags> {
        // Allow only int32 or null/undefined values.
        if !value.is_number() {
            if value.is_undefined_or_null() {
                return Ok(FileSystemFlags(match kind {
                    FileSystemFlagsKind::Access => 0,   // F_OK
                    FileSystemFlagsKind::CopyFile => 0, // constexpr int kDefaultCopyMode = 0;
                }));
            }
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("mode must be int32 or null/undefined"),
                )
                .throw());
        }
        const MIN: i32 = 0;
        const MAX: i32 = 7;
        if value.is_int32() {
            let int: i32 = value.as_int32();
            if int < MIN || int > MAX {
                return Err(global
                    .err(
                        jsc::ErrorCode::OUT_OF_RANGE,
                        format_args!("mode is out of range: >= 0 and <= 7"),
                    )
                    .throw());
            }
            Ok(FileSystemFlags(int))
        } else {
            let float = value.as_number();
            if float.is_nan() || float.is_infinite() || float < MIN as f64 || float > MAX as f64 {
                return Err(global
                    .err(
                        jsc::ErrorCode::OUT_OF_RANGE,
                        format_args!("mode is out of range: >= 0 and <= 7"),
                    )
                    .throw());
            }
            Ok(FileSystemFlags(float as i32))
        }
    }
}

bun_core::comptime_string_map! {
    /// Node's `stringToFlags` table. Case-sensitive: uppercase spellings
    /// ("W", "A+", ...) are rejected by Node with ERR_INVALID_ARG_VALUE.
    static FILE_SYSTEM_FLAGS_MAP: c_int = {
        b"r" => O::RDONLY,
        b"w" => O::TRUNC | O::CREAT | O::WRONLY,
        b"a" => O::APPEND | O::CREAT | O::WRONLY,
        b"r+" => O::RDWR,
        b"w+" => O::TRUNC | O::CREAT | O::RDWR,
        b"a+" => O::APPEND | O::CREAT | O::RDWR,
        b"rs" => O::RDONLY | O::SYNC,
        b"sr" => O::RDONLY | O::SYNC,
        b"wx" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,
        b"xw" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,
        b"ax" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
        b"xa" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
        b"as" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,
        b"sa" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,
        b"rs+" => O::RDWR | O::SYNC,
        b"sr+" => O::RDWR | O::SYNC,
        b"wx+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,
        b"xw+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,
        b"ax+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
        b"xa+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
        b"as+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
        b"sa+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
    };
}

// ──────────────────────────────────────────────────────────────────────────

/// A class representing a directory stream.
///
/// Created by {@link opendir}, {@link opendirSync}, or `fsPromises.opendir()`.
///
/// ```js
/// import { opendir } from 'fs/promises';
///
/// try {
///   const dir = await opendir('./');
///   for await (const dirent of dir)
///     console.log(dirent.name);
/// } catch (err) {
///   console.error(err);
/// }
/// ```
///
/// When using the async iterator, the `fs.Dir` object will be automatically
/// closed after the iterator exits.
/// @since v12.12.0
pub struct Dirent {
    pub name: bun_core::String,
    pub path: bun_core::String,
    // not publicly exposed
    pub(crate) kind: DirentKind,
}

pub type DirentKind = bun_sys::FileKind;

// Externs stay in this crate per PORTING.md §FFI: "If your file has externs
// and isn't already *_sys, leave them in place".
// `&JSGlobalObject` / `&mut bun_core::String` are ABI-identical to non-null
// pointers; `Option<&mut *mut JSString>` uses the niche-optimization layout
// (`*mut *mut JSString`), so the validity proof lives in the type signature.
unsafe extern "C" {
    safe fn Bun__JSDirentObjectConstructor(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Dirent__toJS(
        global: &JSGlobalObject,
        kind: i32,
        name: bun_core::String,
        path: bun_core::String,
        cached_previous_path_jsvalue: Option<&mut *mut jsc::JSString>,
    ) -> JSValue;
}

impl Dirent {
    pub(crate) fn get_constructor(global: &JSGlobalObject) -> JSValue {
        Bun__JSDirentObjectConstructor(global)
    }

    pub fn into_js(
        self,
        global_object: &JSGlobalObject,
        cached_previous_path_jsvalue: Option<&mut *mut jsc::JSString>,
    ) -> JsResult<JSValue> {
        use bun_libuv_sys::{
            UV_DIRENT_BLOCK, UV_DIRENT_CHAR, UV_DIRENT_DIR, UV_DIRENT_FIFO, UV_DIRENT_FILE,
            UV_DIRENT_LINK, UV_DIRENT_SOCKET, UV_DIRENT_UNKNOWN,
        };
        let kind_int: i32 = match self.kind {
            DirentKind::File => UV_DIRENT_FILE,
            DirentKind::BlockDevice => UV_DIRENT_BLOCK,
            DirentKind::CharacterDevice => UV_DIRENT_CHAR,
            DirentKind::Directory => UV_DIRENT_DIR,
            // event_port is deliberate there.
            DirentKind::EventPort | DirentKind::NamedPipe => UV_DIRENT_FIFO,
            DirentKind::UnixDomainSocket => UV_DIRENT_SOCKET,
            DirentKind::SymLink => UV_DIRENT_LINK,
            DirentKind::Whiteout | DirentKind::Door | DirentKind::Unknown => UV_DIRENT_UNKNOWN,
        };
        bun_jsc::from_js_host_call(global_object, || {
            Bun__Dirent__toJS(
                global_object,
                kind_int,
                self.name,
                self.path,
                cached_previous_path_jsvalue,
            )
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub enum PathOrBlob {
    Path(PathOrFileDescriptor<'static>),
    Blob(Box<Blob>),
}

impl PathOrBlob {
    pub(crate) fn from_js_no_copy(
        ctx: &JSGlobalObject,
        args: &mut ArgumentsSlice,
    ) -> JsResult<PathOrBlob> {
        if let Some(path) = PathOrFileDescriptor::from_js(ctx, args)? {
            return Ok(PathOrBlob::Path(path));
        }

        let Some(arg) = args.next_eat() else {
            return Err(ctx.throw_invalid_argument_type_value(
                b"destination",
                b"path, file descriptor, or Blob",
                JSValue::UNDEFINED,
            ));
        };
        if let Some(blob) = arg.as_class_ref::<Blob>() {
            return Ok(PathOrBlob::Blob(Box::new(blob.borrowed_view())));
        }
        Err(ctx.throw_invalid_argument_type_value(
            b"destination",
            b"path, file descriptor, or Blob",
            arg,
        ))
    }
}
