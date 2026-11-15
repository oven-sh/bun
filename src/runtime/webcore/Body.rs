//! https://developer.mozilla.org/en-US/docs/Web/API/Body

use core::cell::Cell;
use core::mem::ManuallyDrop;

use crate::webcore::jsc::{
    self as jsc, CommonAbortReason, CommonAbortReasonExt as _, DOMFormData, JSGlobalObject,
    JSPromise, JSValue, JsResult, SystemError, URLSearchParams, VirtualMachine,
};
use crate::webcore::{
    self, AnyBlob, Blob, BlobExt as _, ByteStream, DrainResult, ReadableStream, blob, streams,
};
use bun_core::Output;
use bun_http_types::MimeType::MimeType;
// Re-export so callers can write `body::InternalBlob`.
pub(crate) use crate::webcore::InternalBlob;
use crate::webcore::form_data::AsyncFormDataExt as _;
use bun_core::String as BunString;
use bun_core::{Utf8Bytes, WTFString, WTFStringImplExt as _};
use bun_jsc::StringJsc as _;
use bun_jsc::WrapperGuard;
use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::bun_string_jsc;
use bun_ptr::BackRef;

fn set_blob_content_type(blob: &Blob, mime_type: MimeType) {
    blob.content_type_was_set.set(true);
    blob.content_type
        .set(blob::BlobContentType::from(mime_type));
}

bun_core::declare_scope!(BodyValue, visible);
bun_core::declare_scope!(BodyMixin, visible);

/// Lends no reference to its value, but to its own readers: what else works on the value moves it out first, and the body reads as used meanwhile.
#[repr(C)]
pub(crate) struct Body {
    value: Cell<Value>,
}

impl Default for Body {
    fn default() -> Self {
        Self::new(Value::Empty)
    }
}

macro_rules! take_variant {
    ($name:ident, $Variant:ident, $T:ty) => {
        fn $name(&self) -> Option<$T> {
            self.read(|value| matches!(value, Value::$Variant(_)))
                .then(|| match self.take() {
                    Value::$Variant(value) => value,
                    _ => unreachable!(),
                })
        }
    };
}

impl Body {
    #[inline]
    pub(crate) fn new(value: Value) -> Self {
        Self {
            value: Cell::new(value),
        }
    }

    pub(crate) fn tag(&self) -> Tag {
        self.read(Value::tag)
    }

    pub(crate) fn set(&self, value: Value) {
        match self.tag() {
            Tag::Used | Tag::Empty | Tag::Null => self.put_back(value),
            _ => self.value.set(value),
        }
    }

    fn take(&self) -> Value {
        self.value.replace(Value::Used)
    }

    /// Ends a `take`. What was stored in the body since then is leaked.
    fn put_back(&self, value: Value) {
        // Not dropped, so no drop glue of `Value` is called.
        let old = ManuallyDrop::new(self.value.replace(value));
        debug_assert!(matches!(*old, Value::Used | Value::Empty | Value::Null));
    }

    /// For a `reader` that is written at the call, and runs no script, producer or finalizer.
    fn read<R>(&self, reader: fn(&Value) -> R) -> R {
        // SAFETY: `reader` captures nothing and calls nothing that finds this body, so the cell is not written meanwhile. `R` cannot borrow from it.
        reader(unsafe { &*self.value.as_ptr() })
    }

    take_variant!(take_blob, Blob, Blob);
    take_variant!(take_wtf_string, WTFStringImpl, WTFString);
    take_variant!(take_internal_blob, InternalBlob, InternalBlob);
    take_variant!(take_locked, Locked, PendingValue);
    take_variant!(take_error, Error, ValueError);

    pub(crate) fn with_blob<R>(&self, f: impl FnOnce(&Blob) -> R) -> Option<R> {
        self.read(|value| matches!(value, Value::Blob(_)))
            .then(|| match self.take() {
                Value::Blob(blob) => {
                    let result = f(&blob);
                    self.put_back(Value::Blob(blob));
                    result
                }
                _ => unreachable!(),
            })
    }

    pub(crate) fn needs_to_read_file(&self) -> bool {
        self.read(|value| matches!(value, Value::Blob(blob) if blob.needs_to_read_file()))
    }

    /// `None` unless the body is a `Blob` that has a type.
    pub(crate) fn with_blob_content_type<R>(&self, f: impl FnOnce(&[u8]) -> R) -> Option<R> {
        let content_type = self.read(|value| match value {
            Value::Blob(blob) => Some(blob.content_type.get().clone()),
            _ => None,
        })?;
        (!content_type.is_empty()).then(|| f(content_type.as_slice()))
    }

    fn with_locked<R>(&self, f: impl FnOnce(&mut PendingValue) -> R) -> Option<R> {
        self.read(|value| matches!(value, Value::Locked(_)))
            .then(|| match self.take() {
                Value::Locked(mut pending) => {
                    let result = f(&mut pending);
                    self.put_back(Value::Locked(pending));
                    result
                }
                _ => unreachable!(),
            })
    }

    fn with_readable<R>(
        &self,
        f: impl FnOnce(&mut webcore::readable_stream::Strong) -> R,
    ) -> Option<R> {
        let mut readable = self.with_locked(|pending| core::mem::take(&mut pending.readable))?;
        let result = f(&mut readable);
        self.with_locked(|pending| core::mem::swap(&mut pending.readable, &mut readable));
        Some(result)
    }

    /// The stream that the body itself holds. See [`BodyMixin::get_body_readable_stream`].
    pub(crate) fn readable(&self) -> Option<ReadableStream> {
        self.read(|value| match value {
            Value::Locked(pending) => pending.readable.get(),
            _ => None,
        })
    }

    pub(crate) fn take_readable(&self) -> webcore::readable_stream::Strong {
        self.with_locked(|pending| core::mem::take(&mut pending.readable))
            .unwrap_or_default()
    }

    /// `.text()` or one of its friends already reads this body.
    pub(crate) fn has_consumer(&self) -> bool {
        self.read(|value| matches!(value, Value::Locked(pending) if pending.consumer.is_some()))
    }

    fn set_consumer(&self, consumer: Consumer) {
        let mut consumer = Some(consumer);
        self.with_locked(|pending| core::mem::swap(&mut pending.consumer, &mut consumer));
    }

    /// The consumer waits for [`Self::resolve`].
    pub(crate) fn has_promise(&self) -> bool {
        self.read(|value| match value {
            Value::Locked(pending) => matches!(pending.consumer, Some(Consumer::Promise(..))),
            _ => false,
        })
    }

    fn producer(&self) -> streams::SourceHandle {
        self.read(|value| match value {
            Value::Locked(pending) => pending.producer,
            _ => streams::SourceHandle::None,
        })
    }

    pub(crate) fn has_producer(&self) -> bool {
        !matches!(self.producer(), streams::SourceHandle::None)
    }

    pub(crate) fn set_size_hint(&self, size_hint: blob::SizeType) {
        self.with_locked(|pending| pending.size_hint = size_hint);
        if let Some(bytes) = self.readable().and_then(|readable| readable.ptr.bytes()) {
            bytes.size_hint.set(size_hint);
        }
    }

    /// The error of a failed body, which the body keeps.
    pub(crate) fn error_to_js(&self, global: &JSGlobalObject) -> Option<JSValue> {
        let mut err = self.take_error()?;
        let js_err = err.to_js(global);
        self.put_back(Value::Error(err));
        Some(js_err)
    }

    /// Only for a `Locked` body.
    pub(crate) fn is_disturbed<T: BodyOwnerJs>(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> bool {
        if self.has_consumer() {
            return true;
        }

        if let Some(body_value) = T::body_get_cached(this_value) {
            return webcore::readable_stream::is_disturbed_value(body_value, global_object);
        }

        self.readable()
            .is_some_and(|readable| readable.is_disturbed(global_object))
    }

    /// Only for a `Locked` body.
    fn is_disturbed_without_wrapper(&self, global_object: &JSGlobalObject) -> bool {
        self.has_consumer()
            || self
                .readable()
                .is_some_and(|readable| readable.is_disturbed(global_object))
    }

    /// Closes the stream, so the caller has to replace the value.
    fn take_blob_from_stream(&self) -> Option<AnyBlob> {
        let (mut stream, global) = self.read(|value| match value {
            Value::Locked(pending) => Some((pending.readable.get()?, pending.global)),
            _ => None,
        })?;
        stream.to_any_blob(&global)
    }

    /// [`Self::take_blob_from_stream`] for `clone()`, going through the wrapper's cached `.body` when there is one.
    fn take_blob_from_unread_stream(
        &self,
        global: &JSGlobalObject,
        cached: Option<ReadableStream>,
    ) -> Option<AnyBlob> {
        if self.has_promise() {
            return None;
        }
        let mut stream = cached.or_else(|| self.readable())?;
        // Two Blobs over a pipe, a tty, or any fd would compete for its bytes, so such a stream stays teed.
        if let Some(reader) = stream.ptr.file() {
            let webcore::file_reader::Lazy::Blob(store) = reader.lazy.get() else {
                return None;
            };
            if !blob::store_reads_repeatably(store) {
                return None;
            }
        }
        stream.to_any_blob(global)
    }
}

impl Body {
    pub(crate) fn write_format<F, W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: bun_jsc::ConsoleFormatter,
    {
        formatter.write_indent(writer)?;
        write!(
            writer,
            "{}",
            Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>bodyUsed<d>:<r> ")
        )?;
        formatter
            .print_as::<W, ENABLE_ANSI_COLORS>(
                jsc::FormatAs::Boolean,
                writer,
                JSValue::from(self.tag() == Tag::Used),
                jsc::JSType::BooleanObject,
            )
            .map_err(|_| core::fmt::Error)?;

        match self.tag() {
            Tag::Blob => {
                formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                self.with_blob(|blob| {
                    blob.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)
                })
                .transpose()?;
            }
            Tag::InternalBlob | Tag::WTFStringImpl => {
                // Do not hoist `size()` out of this arm: for `.Blob` it would stat the file.
                let size = self.size() as usize;
                formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                blob::write_format_for_size::<W, ENABLE_ANSI_COLORS>(false, size, writer)?;
            }
            Tag::Locked => {
                if let Some(stream) = self.readable() {
                    formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    formatter
                        .print_as::<W, ENABLE_ANSI_COLORS>(
                            jsc::FormatAs::Object,
                            writer,
                            stream.value,
                            stream.value.js_type(),
                        )
                        .map_err(|_| core::fmt::Error)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PendingValue
// ────────────────────────────────────────────────────────────────────────────

pub struct PendingValue {
    readable: webcore::readable_stream::Strong,
    // writable: webcore::Sink
    global: BackRef<JSGlobalObject>,
    /// Until the body is realised as a native stream, whose `NewSource` then has it.
    pub producer: streams::SourceHandle,
    consumer: Option<Consumer>,
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If the size is unknown will be 0
    size_hint: blob::SizeType,
}

/// Who reads the whole body.
enum Consumer {
    /// Reads the body's stream, which settles its promise.
    Stream,
    Promise(jsc::Strong, Action),
}

pub(crate) enum Action {
    GetText,
    GetJSON,
    GetArrayBuffer,
    GetBytes,
    GetBlob,
    GetFormData(Box<bun_core::form_data::AsyncFormData>),
}

/// Per-class codegen'd cached-slot accessors for the `body` and `stream`
/// JS-side properties, plus the weak `JsRef` back-pointer. Both `Request` and
/// `Response` forward these 1:1 to `js_Request` / `js_Response`.
pub(crate) trait BodyOwnerJs {
    /// `self.js_ref.try_get()` — the live JS wrapper, if any.
    fn js_ref(&self) -> Option<JSValue>;

    fn body_get_cached(this: JSValue) -> Option<JSValue>;
    fn body_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    fn stream_get_cached(this: JSValue) -> Option<JSValue>;
    fn stream_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
}

// ────────────────────────────────────────────────────────────────────────────
// Value
// ────────────────────────────────────────────────────────────────────────────

/// This is a duplex stream!
#[derive(bun_core::EnumTag)]
#[enum_tag(existing = Tag)]
// Pooled inline in `HiveRef` slots; boxing `Blob` would change
// construction/match sites across many files and defeat the pool.
#[allow(clippy::large_enum_variant)]
pub enum Value {
    Blob(Blob),

    /// This is the String type from WebKit
    /// Be careful where it can directly be used.
    ///
    /// If it is a latin1 string with only ascii, we can use it directly.
    /// Otherwise, we must convert it to utf8.
    ///
    /// Unless we are sending it directly to JavaScript, for example:
    ///
    ///   var str = "hello world 🤭"
    ///   var response = new Response(str);
    ///   /* Body.Value stays WTFStringImpl */
    ///   var body = await response.text();
    ///
    /// In this case, even though there's an emoji, we can use the StringImpl directly.
    /// BUT, if we were instead using it in the HTTP server, this cannot be used directly.
    ///
    /// When the server calls .toBlobIfPossible(), we will automatically
    /// convert this Value to an InternalBlob
    ///
    /// Example code:
    ///
    /// ```js
    /// Bun.serve({
    ///     fetch(req) {
    ///          /* Body.Value becomes InternalBlob */
    ///          return new Response("hello world 🤭");
    ///     }
    /// })
    /// ```
    ///
    /// This works for .json(), too.
    WTFStringImpl(WTFString),
    /// Single-use Blob
    /// Avoids a heap allocation.
    InternalBlob(InternalBlob),
    Locked(PendingValue),
    Used,
    Empty,
    Error(ValueError),
    Null,
}

const POOL_SIZE: usize = if bun_alloc::heap_breakdown::ENABLED {
    0
} else {
    256
};
pub(crate) type HiveRef = bun_collections::HiveRef<Body, POOL_SIZE>;
pub(crate) type HiveAllocator = bun_collections::hive_array::Fallback<HiveRef, POOL_SIZE>;
pub(crate) type BodyHiveHandle = bun_collections::HiveRefHandle<Body, POOL_SIZE>;

/// Moves `value` into a pooled `HiveRef` slot and returns an owning handle
/// (ref_count = 1).
pub(crate) fn hive_alloc(value: Value) -> BodyHiveHandle {
    let pool: &HiveAllocator = &crate::jsc_hooks::runtime_state().body_value_pool;
    // SAFETY: `pool` outlives every handle (process lifetime).
    unsafe { BodyHiveHandle::new(Body::new(value), pool) }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Tag {
    Blob,
    WTFStringImpl,
    InternalBlob,
    Locked,
    Used,
    Empty,
    Error,
    Null,
}

pub enum ValueError {
    AbortReason(CommonAbortReason),
    /// `SystemError` surfaced as a JS `TypeError` (fetch network errors). Boxed, because it is larger than every other arm of [`Value`].
    SystemTypeError(Box<SystemError>),
    Message(BunString),
    /// Surfaces as a JS `TypeError`. The fetch spec maps every "network
    /// error" to TypeError, so use this for fetch-layer rejections that
    /// callers feature-detect via `err instanceof TypeError`.
    TypeError(BunString),
    JSValue(jsc::strong::Optional),
}

impl ValueError {
    // Not a clean Drop — resets self to safe-empty in place. Renamed from `deinit`
    // per PORTING.md (never expose `pub fn deinit(&mut self)`).
    pub fn reset(&mut self) {
        *self = ValueError::JSValue(jsc::strong::Optional::empty());
    }
}

impl ValueError {
    pub(crate) fn to_stream_error(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> streams::result::StreamError {
        match self {
            ValueError::AbortReason(reason) => streams::result::StreamError::AbortReason(*reason),
            _ => streams::result::StreamError::JSValue(jsc::strong::Optional::create(
                self.to_js(global_object),
                global_object,
            )),
        }
    }

    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
        let js_value = match self {
            ValueError::AbortReason(reason) => reason.to_js(global_object),
            // `to_type_error_instance` consumes the error's string refs, and `to_js`
            // takes `&mut self` — take the value out so a second call builds an
            // empty error rather than releasing those refs twice.
            ValueError::SystemTypeError(system_error) => {
                core::mem::take(&mut **system_error).to_type_error_instance(global_object)
            }
            ValueError::Message(message) => message.to_error_instance(global_object),
            ValueError::TypeError(message) => message.to_type_error_instance(global_object),
            // do an early return in this case we don't need to create a new Strong
            ValueError::JSValue(js_value) => {
                return js_value.get().unwrap_or(JSValue::UNDEFINED);
            }
        };
        *self = ValueError::JSValue(jsc::strong::Optional::create(js_value, global_object));
        js_value
    }

    pub(crate) fn dupe(&self, global_object: &JSGlobalObject) -> Self {
        match self {
            ValueError::SystemTypeError(e) => ValueError::SystemTypeError(e.clone()),
            ValueError::Message(m) => ValueError::Message(m.clone()),
            ValueError::TypeError(m) => ValueError::TypeError(m.clone()),
            ValueError::JSValue(js_ref) => {
                if let Some(js_value) = js_ref.get() {
                    return ValueError::JSValue(jsc::strong::Optional::create(
                        js_value,
                        global_object,
                    ));
                }
                ValueError::JSValue(jsc::strong::Optional::empty())
            }
            ValueError::AbortReason(r) => ValueError::AbortReason(*r),
        }
    }
}

impl From<AnyBlob> for Value {
    fn from(blob: AnyBlob) -> Value {
        match blob {
            AnyBlob::Blob(b) => Value::Blob(b),
            AnyBlob::InternalBlob(b) => Value::InternalBlob(b),
            AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(s),
        }
    }
}

impl Body {
    pub(crate) fn from_request_or_response(value: &JSValue) -> Option<WrapperGuard<'_, Body>> {
        if value.is_empty_or_undefined_or_null() {
            return None;
        }
        if let Some(req) = value.as_class_ref::<crate::webcore::Request>() {
            return Some(WrapperGuard::map(req, |req| req.body()));
        }
        if let Some(res) = value.as_class_ref::<crate::webcore::Response>() {
            return Some(WrapperGuard::map(res, |res| res.body()));
        }
        None
    }

    pub(crate) fn was_string(&self) -> bool {
        self.read(|value| match value {
            Value::InternalBlob(blob) => blob.was_string,
            Value::WTFStringImpl(_) => true,
            _ => false,
        })
    }

    pub(crate) fn to_blob_if_possible(&self) {
        if let Some(bytes) = self.read(|value| match value {
            Value::WTFStringImpl(str) => match str.to_utf8() {
                Utf8Bytes::Owned(bytes) => Some(bytes),
                _ => None,
            },
            _ => None,
        }) {
            drop(self.take_wtf_string());
            self.set(Value::InternalBlob(InternalBlob {
                bytes,
                was_string: true,
            }));
        } else if self.tag() == Tag::Locked
            && !self.has_promise()
            && let Some(blob) = self.take_blob_from_stream()
        {
            self.set(Value::from(blob));
        }
    }

    /// [`Self::to_blob_if_possible`], except a file-backed stream keeps streaming (a FIFO has no length).
    pub(crate) fn to_blob_if_in_memory(&self) {
        if self.tag() != Tag::Locked {
            return;
        }
        let file_backed = self
            .readable()
            .is_some_and(|r| matches!(r.ptr, webcore::readable_stream::Source::File(_)));
        if !file_backed {
            self.to_blob_if_possible();
        }
    }

    pub(crate) fn size(&self) -> blob::SizeType {
        self.read(|value| match value {
            Value::Blob(b) => b.get_size_for_bindings() as blob::SizeType,
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => s.utf8_byte_length() as blob::SizeType,
            Value::Locked(l) => match l.readable.get().and_then(|readable| readable.ptr.bytes()) {
                Some(bytes) => bytes.size_hint.get(),
                None => l.size_hint,
            },
            _ => 0,
        })
    }

    /// `None` for a file that does not exist or is not seekable.
    pub(crate) fn known_size(&self) -> Option<usize> {
        match self.size() {
            u64::MAX => None,
            size => Some(size as usize),
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.read(|value| match value {
            Value::InternalBlob(b) => b.memory_cost(),
            Value::WTFStringImpl(s) => s.memory_cost(),
            // Not `size_hint`: a Locked body owns no bytes (they live in the
            // ByteStream buffer, separately accounted), so reporting the
            // content-length here mis-trains JSC's GC live-size estimate.
            Value::Locked(_) => 0,
            _ => 0,
        })
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.read(|value| match value {
            Value::InternalBlob(b) => b.slice_const().len(),
            Value::WTFStringImpl(s) => s.byte_slice().len(),
            // See memory_cost(): size_hint is anticipated, not allocated.
            Value::Locked(_) => 0,
            _ => 0,
        })
    }

    // pub const empty = Value::Empty;

    pub(crate) fn to_readable_stream(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<JSValue> {
        jsc::mark_binding();

        // From here on the stream is the body: `.body`, `bodyUsed` and every reader go through it.
        let stream = match self.tag() {
            Tag::Used => return ReadableStream::used(cx.global()),
            Tag::Null => return Ok(JSValue::NULL),
            Tag::Locked => {
                if let Some(readable) = self.readable() {
                    return Ok(readable.value);
                }
                return self.locked_to_native_stream(cx, false);
            }
            Tag::Empty => ReadableStream::empty(cx.global())?,
            Tag::InternalBlob | Tag::Blob | Tag::WTFStringImpl => {
                let blob = self.use_();
                blob.resolve_size();
                let blob_size = blob.size.get();
                ReadableStream::from_blob_copy_ref(cx, &blob, blob_size)?
            }
            Tag::Error => {
                let reason = self.error_to_js(cx.global()).unwrap();
                ReadableStream::errored(cx.global(), reason)?
            }
        };
        self.set(Value::from_readable_stream_without_lock_check(
            ReadableStream::from_js_direct(stream).unwrap(),
            cx.global(),
        ));
        Ok(stream)
    }

    /// `Body.textStream()`: a `ReadableStream<string>` of the body's UTF-8
    /// content, decoded directly from the body's backing bytes without
    /// materializing a separate byte `ReadableStream` for native-backed bodies.
    /// Returns `NULL` for `Null` (caller substitutes an empty stream).
    pub(crate) fn to_text_readable_stream(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<JSValue> {
        jsc::mark_binding();

        match self.tag() {
            Tag::Used => ReadableStream::used(cx.global()),
            Tag::Null => Ok(JSValue::NULL),
            Tag::Empty => {
                self.set(Value::Used);
                ReadableStream::empty(cx.global())
            }
            Tag::InternalBlob | Tag::WTFStringImpl => {
                let mut blob = self.use_as_any_blob_allow_non_utf8_string();
                let string = blob.to_string_transfer(cx)?;
                ReadableStream::from_decoded_text(cx.global(), string)
            }
            Tag::Blob => {
                let mut blob = self.use_();
                blob.resolve_size();
                if blob.needs_to_read_file() || blob.is_s3() {
                    let blob_size = blob.size.get();
                    let bytes = ReadableStream::from_blob_copy_ref(cx, &blob, blob_size)?;
                    ReadableStream::text_decode_from(cx.global(), bytes)
                } else {
                    let string = blob.to_string_transfer(cx)?;
                    ReadableStream::from_decoded_text(cx.global(), string)
                }
            }
            Tag::Locked => self.locked_to_native_stream(cx, true),
            Tag::Error => {
                let reason = self.error_to_js(cx.global()).unwrap();
                let stream = ReadableStream::errored(cx.global(), reason)?;
                self.set(Value::Used);
                Ok(stream)
            }
        }
    }

    /// Shared tail of [`to_readable_stream`] and [`to_text_readable_stream`].
    fn locked_to_native_stream(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        text_mode: bool,
    ) -> JsResult<JSValue> {
        if self.has_consumer() {
            return ReadableStream::in_use(cx.global());
        }
        let Some(readable) = self.stream_from_producer(cx, text_mode)? else {
            return ReadableStream::empty(cx.global());
        };

        // A stream of strings must not be cached as the body's byte stream.
        if text_mode {
            self.set(Value::Used);
        }

        Ok(readable.value)
    }

    /// Gives a `Locked` body without a stream a native one. `None`: the producer was aborted.
    fn stream_from_producer(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        text_mode: bool,
    ) -> JsResult<Option<ReadableStream>> {
        let producer = self.producer();
        let drain_result = producer.start_streaming();

        if matches!(drain_result, DrainResult::Aborted) {
            self.set(Value::Null);
            return Ok(None);
        }

        // Ownership of the heap `NewSource` transfers to the JS wrapper in
        // `to_readable_stream()` below (freed by the GC finalizer).
        let reader = webcore::readable_stream::NewSource::<ByteStream>::new_mut(
            webcore::readable_stream::NewSource {
                // `ByteStream::default()` is the post-setup state.
                context: ByteStream::default(),
                global_this: core::cell::Cell::new(Some(bun_ptr::BackRef::new(cx.global()))),
                ..Default::default()
            },
        );

        reader.producer.set(producer);

        reader.context.setup();
        reader.context.apply_drain_result(drain_result);

        let context_ptr: *mut ByteStream = &raw mut reader.context;
        let stream_value = if text_mode {
            reader.to_text_readable_stream(cx)?
        } else {
            reader.to_readable_stream(cx)?
        };
        let readable = ReadableStream {
            ptr: webcore::readable_stream::Source::Bytes(context_ptr),
            value: stream_value,
        };
        self.with_readable(|held| held.set(readable, cx.global()));
        self.with_locked(|pending| pending.producer = streams::SourceHandle::None);
        producer.readable_stream_available(cx.global(), readable);

        Ok(Some(readable))
    }
}

impl Value {
    pub fn from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Value> {
        value.ensure_still_alive();

        if value.is_empty_or_undefined_or_null() {
            return Ok(Value::Null);
        }

        let js_type = value.js_type();

        if js_type.is_string_like() {
            // WTF-backed unless it is empty.
            return Ok(match value.to_bun_string(global_this)?.into_wtf() {
                Some(str) => Value::WTFStringImpl(str),
                None => Value::Empty,
            });
        }

        if js_type.is_typed_array_or_array_buffer() {
            if let Some(buffer) = value.as_array_buffer(global_this) {
                let bytes = buffer.byte_slice();

                if bytes.is_empty() {
                    return Ok(Value::Empty);
                }

                // The global allocator aborts on OOM, so a "Failed to clone
                // ArrayBufferView" error path is unreachable.
                return Ok(Value::InternalBlob(InternalBlob {
                    bytes: bytes.to_vec(),
                    was_string: false,
                }));
            }
        }

        if let Some(form) = DOMFormData::from_js(&value) {
            return Ok(Value::Blob(Blob::from_dom_form_data(global_this, &form)));
        }

        if let Some(params) = URLSearchParams::from_js(&value) {
            return Ok(Value::Blob(Blob::from_url_search_params(
                global_this,
                &params,
            )));
        }

        if js_type == jsc::JSType::DOMWrapper {
            if let Some(blob) = value.as_class_ref::<Blob>() {
                return Ok(Value::Blob(
                    // We must preserve "type" so that DOMFormData and the "type" field are preserved.
                    blob.dupe_with_content_type(true),
                ));
            }

            if let Some(image) = value.as_class_ref::<crate::image::Image>() {
                // Body init is synchronous, so encode now and wrap as a Blob
                // with the right MIME type. The off-thread path is still
                // available via `await image.blob()`.
                let (encoded, mime) = image.encode_for_body(global_this, value)?;
                // Blob.Store owns a `Vec`, so dupe out of the
                // codec's allocator here. The hot path (`.bytes()`) hands the
                // codec buffer to JS without this copy.
                let owned = encoded.to_vec();
                drop(encoded);
                let blob = Blob::init(owned, global_this);
                blob.content_type
                    .set(blob::BlobContentType::Static(mime.as_bytes()));
                blob.content_type_was_set.set(true);
                return Ok(Value::Blob(blob));
            }
        }

        value.ensure_still_alive();

        if let Some(readable) = ReadableStream::from_js(value, global_this)? {
            // fetch spec: a body init stream must be neither disturbed nor locked (TypeError).
            if readable.is_disturbed(global_this) || readable.is_locked(global_this) {
                return Err(global_this.throw_type_error(format_args!(
                    "Body object should not be disturbed or locked"
                )));
            }

            // Adopt the stream whatever backs it; `to_blob_if_possible` lifts a native payload out later.
            return Ok(Value::from_readable_stream_without_lock_check(
                readable,
                global_this,
            ));
        }

        Ok(Value::Blob(Blob::get::<false>(global_this, value)?))
    }

    pub(crate) fn from_readable_stream_without_lock_check(
        readable: ReadableStream,
        global_this: &JSGlobalObject,
    ) -> Value {
        Value::Locked(PendingValue {
            readable: webcore::readable_stream::Strong::init(readable, global_this),
            global: BackRef::new(global_this),
            producer: streams::SourceHandle::None,
            consumer: None,
            size_hint: 0,
        })
    }

    pub(crate) fn from_producer(
        producer: streams::SourceHandle,
        size_hint: blob::SizeType,
        global_this: &JSGlobalObject,
    ) -> Value {
        Value::Locked(PendingValue {
            readable: webcore::readable_stream::Strong::default(),
            global: BackRef::new(global_this),
            producer,
            consumer: None,
            size_hint,
        })
    }
}

impl Body {
    /// Replaces the value with `new`, and hands that to what waited for it.
    pub(crate) fn resolve(
        &self,
        new: Value,
        cx: &bun_jsc::JsThread<'_>,
        // For the content type of a waiting `.blob()`.
        response: Option<&webcore::Response>,
    ) -> jsc::JsResult<()> {
        bun_core::scoped_log!(BodyValue, "resolve");
        let pending = self.take_locked();
        self.set(new);
        if let Some(locked) = pending {
            if let Some(readable) = locked.readable.get() {
                // Feed the already-created stream (instead of closing it empty)
                // only when it is the sole consumer of this pending body.
                match readable.ptr.bytes() {
                    Some(bytes) if !matches!(locked.consumer, Some(Consumer::Promise(..))) => {
                        // BACKREF: `Source::bytes()` payload is live for the
                        // ReadableStream JS wrapper's lifetime.
                        let blob = self.use_as_any_blob_allow_non_utf8_string();
                        self.set(Value::Used);
                        bytes.on_data(streams::Result::TemporaryAndDone(blob.slice()));
                    }
                    _ => readable.done(),
                }
            }

            if let Some(Consumer::Promise(root, action)) = locked.consumer {
                let promise = root.get().as_any_promise().unwrap();

                match action {
                    // These ones must use promise.wrap() to handle exceptions thrown while calling .toJS() on the value.
                    // These exceptions can happen if the String is too long, ArrayBuffer is too large, JSON parse error, etc.
                    Action::GetText => match self.tag() {
                        Tag::WTFStringImpl | Tag::InternalBlob => {
                            let mut blob = self.use_as_any_blob_allow_non_utf8_string();
                            promise.wrap(cx.global(), |_| blob.to_string_transfer(cx))?;
                        }
                        _ => {
                            let mut blob = self.use_();
                            promise.wrap(cx.global(), |_| blob.to_string_transfer(cx))?;
                        }
                    },
                    Action::GetJSON => {
                        let mut blob = self.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap(cx.global(), |_| blob.to_json(cx))?;
                    }
                    Action::GetArrayBuffer => {
                        let mut blob = self.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap(cx.global(), |_| blob.to_array_buffer_transfer(cx))?;
                    }
                    Action::GetBytes => {
                        let mut blob = self.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap(cx.global(), |_| blob.to_uint8_array_transfer(cx))?;
                    }
                    Action::GetFormData(async_form_data) => {
                        let blob = self.use_as_any_blob();
                        // `webcore::form_data::AsyncFormData` re-exports `bun_core::form_data::AsyncFormData`;
                        // `to_js` is provided via the `AsyncFormDataExt` extension trait.
                        async_form_data.to_js(cx.global(), blob.slice(), promise)?;
                    }
                    Action::GetBlob => {
                        let blob = self.use_();
                        if let Some(content_type) =
                            response.and_then(|r| r.get_content_type_header())
                        {
                            let content_slice = content_type.to_utf8();
                            let mime_type = MimeType::init(content_slice.slice());
                            set_blob_content_type(&blob, mime_type);
                        }
                        if !blob.content_type_was_set.get() && blob.store.is_some() {
                            set_blob_content_type(&blob, bun_http_types::MimeType::TEXT);
                        }
                        promise.resolve(cx.global(), blob.into_js(cx.global()))?;
                    }
                }
            }
        }
        Ok(())
    }

    pub(crate) fn use_(&self) -> Blob {
        self.to_blob_if_possible();

        if let Some(blob) = self.take_blob() {
            return blob;
        }
        if let Some(mut ib) = self.take_internal_blob() {
            return Blob::init(ib.to_owned_slice(), VirtualMachine::get().global());
        }
        if let Some(wtf) = self.take_wtf_string() {
            return Blob::init(wtf.to_utf8().into_vec(), VirtualMachine::get().global());
        }
        // A zero-length body is spent by a read like any other (`use_as_any_blob` agrees).
        if self.tag() == Tag::Empty {
            self.set(Value::Used);
        }
        Blob::default()
    }

    pub(crate) fn try_use_as_any_blob(&self) -> Option<AnyBlob> {
        if let Some(str) = self.take_wtf_string() {
            if str.can_use_as_utf8() {
                return Some(AnyBlob::WTFStringImpl(str));
            }
            self.put_back(Value::WTFStringImpl(str));
            return None;
        }
        match self.tag() {
            Tag::Blob | Tag::InternalBlob => Some(self.use_as_any_blob_allow_non_utf8_string()),
            _ => {
                let any_blob = self.take_blob_from_stream()?;
                self.set(Value::Used);
                Some(any_blob)
            }
        }
    }

    pub(crate) fn use_as_any_blob(&self) -> AnyBlob {
        let Some(str) = self.take_wtf_string() else {
            return self.use_as_any_blob_allow_non_utf8_string();
        };
        if let Utf8Bytes::Owned(bytes) = str.to_utf8() {
            AnyBlob::InternalBlob(InternalBlob {
                bytes,
                was_string: true,
            })
        } else {
            AnyBlob::WTFStringImpl(str)
        }
    }

    pub(crate) fn use_as_any_blob_allow_non_utf8_string(&self) -> AnyBlob {
        if let Some(str) = self.take_wtf_string() {
            return AnyBlob::WTFStringImpl(str);
        }
        if let Some(blob) = self.take_internal_blob() {
            return AnyBlob::InternalBlob(blob);
        }
        if let Some(blob) = self.take_blob() {
            return AnyBlob::Blob(blob);
        }
        let any_blob = self
            .take_blob_from_stream()
            .unwrap_or(AnyBlob::Blob(Blob::default()));
        if self.tag() != Tag::Null {
            self.set(Value::Used);
        }
        any_blob
    }

    pub(crate) fn to_error_instance(
        &self,
        mut err: ValueError,
        global: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        let Some(locked) = self.take_locked() else {
            self.set(Value::Error(err));
            return Ok(());
        };
        let was_disturbed = locked.consumer.is_some() || locked.readable.is_disturbed(global);

        if let Some(Consumer::Promise(root, _)) = &locked.consumer
            && let Some(promise) = root.get().as_any_promise()
            && promise.status() == jsc::js_promise::Status::Pending
        {
            promise.reject_with_async_stack(global, err.to_js(global))?;
        }

        if let Some(readable) = locked.readable.get() {
            if let Some(bytes) = readable.ptr.bytes() {
                let stream_err = err.to_stream_error(global);
                self.set(Value::Error(err));
                bytes.on_data(streams::Result::Err(stream_err));
            } else {
                let js_err = err.to_js(global);
                self.set(Value::Error(err));
                // e.g. a `clone()` tee branch; a cancel would end its reads with `{ done: true }`.
                readable.error(global, js_err)?;
            }
        } else {
            self.set(Value::Error(err));
        }

        if was_disturbed {
            self.set(Value::Used);
        }
        Ok(())
    }
}

impl Body {
    fn locked_stream_to_tee(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        owned_readable: Option<ReadableStream>,
    ) -> JsResult<Option<ReadableStream>> {
        if let Some(readable) = owned_readable.or_else(|| self.readable()) {
            return Ok((!readable.is_disturbed(cx.global())).then_some(readable));
        }

        if self.has_consumer() {
            return Ok(None);
        }

        self.stream_from_producer(cx, false)
    }

    /// For the owner to tee. Without one, the clone is [`Self::dupe`].
    fn stream_to_tee(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        readable: Option<ReadableStream>,
    ) -> JsResult<Option<ReadableStream>> {
        // A native blob, file, or fully buffered byte stream that nothing has
        // read goes back to being a Blob, so both bodies share one store (and
        // its type) instead of pumping the bytes through a JS tee. The owner
        // must then drop its cached `.body` (`sync_body_stream_caches`).
        // Anything else is teed.
        if self.tag() == Tag::Locked {
            match self.take_blob_from_unread_stream(cx.global(), readable) {
                Some(blob) => self.set(Value::from(blob)),
                None => return self.locked_stream_to_tee(cx, readable),
            }
        }

        self.to_blob_if_possible();

        if let Some(mut internal_blob) = self.take_internal_blob() {
            let owned = internal_blob.to_owned_slice();
            self.set(Value::Blob(Blob::init(owned, cx.global())));
        }

        if self.read(|value| match value {
            Value::Blob(b) => b.store().is_some_and(blob::store_yields_bytes_once),
            _ => false,
        }) {
            // A pipe or other fd yields its bytes once: read it as one stream and tee that.
            self.to_readable_stream(cx)?;
            return self.locked_stream_to_tee(cx, None);
        }

        Ok(None)
    }

    fn dupe(&self, global: &JSGlobalObject) -> Value {
        // So that the clone's readers reject instead of resolving with an empty body.
        if let Some(err) = self.take_error() {
            let dupe = err.dupe(global);
            self.put_back(Value::Error(err));
            return Value::Error(dupe);
        }
        self.read(|value| match value {
            Value::Blob(blob) => Value::Blob(blob.dupe_with_content_type(false)),
            Value::WTFStringImpl(string) => Value::WTFStringImpl(string.clone()),
            Value::Null => Value::Null,
            Value::Locked(_) => Value::Used,
            _ => Value::Empty,
        })
    }
}

// ────────────────────────────────────────────────────────────────────────────
// JSC-integration: extract / BodyMixin (host-fn methods).
// ────────────────────────────────────────────────────────────────────────────

// https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
pub(crate) fn extract(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Body> {
    Ok(Body::new(Value::from_js(global_this, value)?))
}

// ────────────────────────────────────────────────────────────────────────────
// Mixin
// ────────────────────────────────────────────────────────────────────────────

/// Mixin trait with provided methods.
/// Implementers supply `body`, `get_content_type_header`, `get_form_data_encoding`,
/// and optionally override `get_body_readable_stream`.
pub(crate) trait BodyMixin: BodyOwnerJs + Sized {
    fn body(&self) -> &Body;
    fn get_content_type_header(&self) -> Option<bun_core::String>;
    fn get_form_data_encoding(&self) -> JsResult<Option<Box<bun_core::form_data::AsyncFormData>>>;

    // ────────────────────────────────────────────────────────────────────
    // Twin methods (identical for Request/Response); [`BodyOwnerJs`] reaches each class's generated module.
    // ────────────────────────────────────────────────────────────────────

    /// JS-side `js.gc.stream` cache is the
    /// source of truth; fall back to the native `Locked.readable` slot.
    fn get_body_readable_stream(&self) -> Option<ReadableStream> {
        if let Some(js_ref) = self.js_ref() {
            if let Some(stream) = Self::stream_get_cached(js_ref) {
                // JS is always source of truth for the stream
                return ReadableStream::from_js_direct(stream);
            }
        }
        self.body().readable()
    }

    /// Clear both the JS-side cache and the
    /// native `Locked.readable` strong ref.
    fn detach_readable_stream(&self, global_object: &JSGlobalObject) {
        if let Some(js_ref) = self.js_ref() {
            Self::stream_set_cached(js_ref, global_object, JSValue::ZERO);
        }
        drop(self.body().take_readable());
    }

    /// Migrate any `Locked.readable` strong ref
    /// into the GC-traced `js.gc.stream` slot to break the cycle (the JS
    /// wrapper owns the stream; native side must not hold it strongly).
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        if let Some(js_value) = self.js_ref()
            && let Some(stream) = self.body().readable()
        {
            stream.value.ensure_still_alive();
            Self::stream_set_cached(js_value, global_object, stream.value);
            self.body()
                .with_readable(|readable| readable.downgrade(global_object));
        }
    }

    /// After `clone()` replaced this body's stream: point the wrapper's cached
    /// `body` at the tee branch now in `Locked.readable`, or, when the clone
    /// moved an unread native stream back into a Blob, forget the detached
    /// stream so `.body` is rebuilt from that Blob.
    fn sync_body_stream_caches(&self, this_value: JSValue, global_this: &JSGlobalObject) {
        match self.body().tag() {
            Tag::Locked => {
                if let Some(readable) = self.body().readable() {
                    Self::body_set_cached(this_value, global_this, readable.value);
                }
            }
            _ => {
                if Self::stream_get_cached(this_value).is_some() {
                    Self::stream_set_cached(this_value, global_this, JSValue::ZERO);
                    Self::body_set_cached(this_value, global_this, JSValue::ZERO);
                }
            }
        }
    }

    /// Shared tail of `do_clone`: after the clone's `to_js` ran
    /// `check_body_stream_ref`, sync both wrappers' cached `body` slots to
    /// their respective streams, then migrate the original's
    /// `Locked.readable` into its own `js.gc.stream`.
    fn sync_cloned_body_stream_caches(
        &self,
        this_value: JSValue,
        js_wrapper: JSValue,
        global_this: &JSGlobalObject,
    ) {
        if !js_wrapper.is_empty() {
            if let Some(cloned_stream) = Self::stream_get_cached(js_wrapper) {
                Self::body_set_cached(js_wrapper, global_this, cloned_stream);
            }
        }
        self.sync_body_stream_caches(this_value, global_this);
        self.check_body_stream_ref(global_this);
    }

    /// Shared body-clone for `Request` and `Response`: clone through the
    /// JS-side cached stream when present, then resync this owner's
    /// `body`/`stream` cache slots with whatever the body now holds.
    fn clone_body_value_via_cached_stream(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<Value> {
        let cached = (self.js_ref())
            .and_then(Self::stream_get_cached)
            .and_then(ReadableStream::from_js_direct);
        let cloned = match self.body().stream_to_tee(cx, cached)? {
            None => self.body().dupe(cx.global()),
            Some(readable) => match readable.tee(cx.global())? {
                Some((ours, theirs)) => {
                    self.body()
                        .with_readable(|readable| readable.set(ours, cx.global()));
                    Value::from_readable_stream_without_lock_check(theirs, cx.global())
                }
                None => Value::Used,
            },
        };
        if let Some(js_ref) = self.js_ref() {
            self.sync_body_stream_caches(js_ref, cx.global());
        }
        self.check_body_stream_ref(cx.global());
        Ok(cloned)
    }

    fn read_locked_body(
        &self,
        global_this: &JSGlobalObject,
        action: Action,
        owned_readable: Option<ReadableStream>,
    ) -> JsResult<JSValue> {
        let body = self.body();
        let Some(readable) = owned_readable.or_else(|| body.readable()) else {
            let promise = JSPromise::create(global_this).to_js();
            let root = jsc::Strong::create(promise, global_this);
            body.set_consumer(Consumer::Promise(root, action));
            body.producer().start_buffering();
            return Ok(promise);
        };
        body.set_consumer(Consumer::Stream);
        // Don't root this promise: the stream keeps it alive (#13678).
        let promise = match action {
            Action::GetJSON => global_this.readable_stream_to_json(readable.value),
            Action::GetArrayBuffer => global_this.readable_stream_to_array_buffer(readable.value),
            Action::GetBytes => global_this.readable_stream_to_bytes(readable.value),
            Action::GetText => global_this.readable_stream_to_text(readable.value),
            Action::GetBlob => global_this.readable_stream_to_blob(readable.value),
            Action::GetFormData(form_data) => {
                let encoding_js = match &form_data.encoding {
                    bun_core::form_data::Encoding::Multipart(multipart) => {
                        bun_string_jsc::create_utf8_for_js(global_this, multipart)?
                    }
                    bun_core::form_data::Encoding::URLEncoded => JSValue::UNDEFINED,
                };
                global_this.readable_stream_to_form_data(readable.value, encoding_js)
            }
        };
        drop(body.take_readable());
        if promise.is_ok() {
            // The consumer holds its reader now; keep the lock once it lets go.
            readable.mark_consumed_as_body(global_this);
        }
        promise
    }

    fn text(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_object = cx.global();
        let body = self.body();
        if body.tag() == Tag::Used {
            return Ok(handle_body_already_used(global_object));
        }
        if let Some(rejected) = handle_body_error(body, global_object) {
            return Ok(rejected);
        }

        if body.tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                if let Some(rejected) = handle_body_stream_unusable(&readable, global_object) {
                    return Ok(rejected);
                }
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetText, Some(readable));
                }
            }
            if body.tag() == Tag::Locked {
                if body.is_disturbed::<Self>(global_object, this_value.to_js()) {
                    return Ok(handle_body_already_used(global_object));
                }
                return self.read_locked_body(global_object, Action::GetText, None);
            }
        }

        let mut blob = body.use_as_any_blob_allow_non_utf8_string();
        JSPromise::wrap(global_object, |_| blob.to_string_transfer(&cx))
    }

    fn get_body(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // The stream the getter makes is the reading script's.
        let cx = cx.js_thread();
        let global_this = cx.global();
        let body = self.body();

        if body.tag() == Tag::Used {
            return ReadableStream::used(global_this);
        }
        if body.tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                return Ok(readable.value);
            }
        }
        let stream = body.to_readable_stream(&cx)?;
        // The wrapper's traced `m_stream` slot owns the stream from here;
        // release the `Strong` `to_readable_stream` parked in `Locked.readable`.
        self.check_body_stream_ref(global_this);
        Ok(stream)
    }

    /// <https://fetch.spec.whatwg.org/#dom-body-textstream>
    fn text_stream(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_this = cx.global();
        // Step 1: If this is unusable, throw a TypeError.
        self.throw_if_body_unusable(global_this)?;

        // A `Locked` body whose stream is already materialized (user-provided
        // ReadableStream, or `.body` was accessed first) is decoded via a reader
        // on that existing stream.
        if self.body().tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                let text = ReadableStream::text_decode_from(global_this, readable.value)?;
                self.detach_readable_stream(global_this);
                self.body().set(Value::Used);
                return Ok(text);
            }
        }

        // Step 2: null body → a new empty closed ReadableStream.
        // Steps 3-6: decode directly from the body's backing bytes.
        let stream = self.body().to_text_readable_stream(&cx)?;
        if stream.is_null() {
            return ReadableStream::empty(global_this);
        }
        Ok(stream)
    }

    /// `Used` / in-flight-read bodies are unconditionally `true`; otherwise
    /// `check` decides from the body's ReadableStream (JS `stream` cache
    /// first, then `Locked.readable`). Bodies with no stream yet are `false`.
    fn body_stream_check(
        &self,
        global_object: &JSGlobalObject,
        check: fn(&ReadableStream, &JSGlobalObject) -> bool,
    ) -> bool {
        match self.body().tag() {
            Tag::Used => true,
            Tag::Locked => {
                self.body().has_consumer()
                    || self
                        .get_body_readable_stream()
                        .is_some_and(|readable| check(&readable, global_object))
            }
            _ => false,
        }
    }

    fn get_body_used(&self, cx: &mut JsScope<'_>) -> bool {
        self.body_stream_check(cx.global(), ReadableStream::is_disturbed)
    }

    /// Fetch spec step 1 of both `clone()` algorithms: throw a `TypeError`
    /// when "this is unusable", i.e. the body is non-null and its stream is
    /// disturbed or locked. <https://fetch.spec.whatwg.org/#body-unusable>
    fn throw_if_body_unusable(&self, global_object: &JSGlobalObject) -> JsResult<()> {
        let unusable =
            self.body_stream_check(global_object, ReadableStream::is_disturbed_or_locked);
        if unusable {
            return Err(global_object
                .err(
                    jsc::ErrorCode::BODY_ALREADY_USED,
                    format_args!("Body is disturbed or locked"),
                )
                .throw());
        }
        Ok(())
    }

    fn json(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_object = cx.global();
        let body = self.body();
        if body.tag() == Tag::Used {
            return Ok(handle_body_already_used(global_object));
        }
        if let Some(rejected) = handle_body_error(body, global_object) {
            return Ok(rejected);
        }

        if body.tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                if let Some(rejected) = handle_body_stream_unusable(&readable, global_object) {
                    return Ok(rejected);
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetJSON, Some(readable));
                }
            }
            if body.tag() == Tag::Locked {
                if body.is_disturbed::<Self>(global_object, this_value.to_js()) {
                    return Ok(handle_body_already_used(global_object));
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetJSON, None);
                }
            }
        }

        let mut blob = body.use_as_any_blob_allow_non_utf8_string();
        JSPromise::wrap(global_object, |_| blob.to_json(&cx))
    }

    fn array_buffer(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_object = cx.global();
        bun_core::scoped_log!(BodyMixin, "getArrayBuffer");
        let body = self.body();

        if body.tag() == Tag::Used {
            return Ok(handle_body_already_used(global_object));
        }
        if let Some(rejected) = handle_body_error(body, global_object) {
            return Ok(rejected);
        }

        if body.tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                if let Some(rejected) = handle_body_stream_unusable(&readable, global_object) {
                    return Ok(rejected);
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(
                        global_object,
                        Action::GetArrayBuffer,
                        Some(readable),
                    );
                }
            }
            if body.tag() == Tag::Locked {
                if body.is_disturbed::<Self>(global_object, this_value.to_js()) {
                    return Ok(handle_body_already_used(global_object));
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetArrayBuffer, None);
                }
            }
        }

        // toArrayBuffer in AnyBlob checks for non-UTF8 strings
        let mut blob: AnyBlob = body.use_as_any_blob_allow_non_utf8_string();
        JSPromise::wrap(global_object, |_| blob.to_array_buffer_transfer(&cx))
    }

    fn bytes(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_object = cx.global();
        let body = self.body();

        if body.tag() == Tag::Used {
            return Ok(handle_body_already_used(global_object));
        }
        if let Some(rejected) = handle_body_error(body, global_object) {
            return Ok(rejected);
        }

        if body.tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                if let Some(rejected) = handle_body_stream_unusable(&readable, global_object) {
                    return Ok(rejected);
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetBytes, Some(readable));
                }
            }
            if body.tag() == Tag::Locked {
                if body.is_disturbed::<Self>(global_object, this_value.to_js()) {
                    return Ok(handle_body_already_used(global_object));
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetBytes, None);
                }
            }
        }

        // toArrayBuffer in AnyBlob checks for non-UTF8 strings
        let mut blob: AnyBlob = body.use_as_any_blob_allow_non_utf8_string();
        JSPromise::wrap(global_object, |_| blob.to_uint8_array_transfer(&cx))
    }

    fn form_data(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let global_object = cx.global();
        let body = self.body();

        if body.tag() == Tag::Used {
            return Ok(handle_body_already_used(global_object));
        }
        if let Some(rejected) = handle_body_error(body, global_object) {
            return Ok(rejected);
        }

        if body.tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                if let Some(rejected) = handle_body_stream_unusable(&readable, global_object) {
                    return Ok(rejected);
                }
                body.to_blob_if_possible();
            }
            if body.tag() == Tag::Locked {
                if body.is_disturbed::<Self>(global_object, this_value.to_js()) {
                    return Ok(handle_body_already_used(global_object));
                }
                body.to_blob_if_possible();
            }
        }

        let Some(encoder) = self.get_form_data_encoding()? else {
            // TODO: catch specific errors from getFormDataEncoding
            return Ok(global_object
                .err(
                    jsc::ErrorCode::FORMDATA_PARSE_ERROR,
                    format_args!(
                        "Can't decode form data from body because of incorrect MIME type/boundary"
                    ),
                )
                .reject());
        };

        if body.tag() == Tag::Locked {
            return self.read_locked_body(
                global_object,
                Action::GetFormData(encoder),
                self.get_body_readable_stream(),
            );
        }

        let blob: AnyBlob = body.use_as_any_blob();
        // `encoder.encoding` is `bun_core::form_data::Encoding`; convert
        // to the `webcore::form_data::Encoding` shape FormData::to_js expects.
        let encoding = match encoder.encoding {
            bun_core::form_data::Encoding::URLEncoded => webcore::form_data::Encoding::URLEncoded,
            bun_core::form_data::Encoding::Multipart(b) => {
                webcore::form_data::Encoding::Multipart(b)
            }
        };
        // encoder dropped at end of scope (replaces defer encoder.deinit())

        let js_value =
            match webcore::form_data::FormData::to_js(global_object, blob.slice(), &encoding) {
                Ok(v) => v,
                Err(crate::Error::JSError) => {
                    let error = global_object.take_error(jsc::JsError::Thrown);
                    return Ok(JSPromise::rejected_promise(global_object, error).to_js());
                }
                Err(err) => {
                    return Ok(global_object
                        .err(
                            jsc::ErrorCode::FORMDATA_PARSE_ERROR,
                            format_args!("FormData parse error {}", err.name()),
                        )
                        .reject());
                }
            };

        Ok(JSPromise::wrap_value(global_object, js_value))
    }

    fn blob(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.get_blob_with_this_value(cx.global(), this_value.to_js())
    }

    fn get_blob_with_this_value(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let body = self.body();

        if body.tag() == Tag::Used {
            return Ok(handle_body_already_used(global_object));
        }
        if let Some(rejected) = handle_body_error(body, global_object) {
            return Ok(rejected);
        }

        if body.tag() == Tag::Locked {
            if let Some(readable) = self.get_body_readable_stream() {
                if body.has_consumer() {
                    return Ok(handle_body_already_used(global_object));
                }
                if let Some(rejected) = handle_body_stream_unusable(&readable, global_object) {
                    return Ok(rejected);
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetBlob, Some(readable));
                }
            }
            if body.tag() == Tag::Locked {
                let is_disturbed = if this_value.is_empty() {
                    body.is_disturbed_without_wrapper(global_object)
                } else {
                    body.is_disturbed::<Self>(global_object, this_value)
                };
                if is_disturbed {
                    return Ok(handle_body_already_used(global_object));
                }
                body.to_blob_if_possible();
                if body.tag() == Tag::Locked {
                    return self.read_locked_body(global_object, Action::GetBlob, None);
                }
            }
        }

        let blob = body.use_();
        if blob.content_type().is_empty() {
            if let Some(content_type) = self.get_content_type_header() {
                let content_slice = content_type.to_utf8();
                let mime_type = MimeType::init(content_slice.slice());
                set_blob_content_type(&blob, mime_type);
            }
            if !blob.content_type_was_set.get() && blob.store.is_some() {
                set_blob_content_type(&blob, bun_http_types::MimeType::TEXT);
            }
        }
        Ok(JSPromise::resolved_promise_value(
            global_object,
            blob.into_js(global_object),
        ))
    }

    fn get_blob_without_call_frame(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.get_blob_with_this_value(global_object, JSValue::ZERO)
    }
}

fn handle_body_already_used(global_object: &JSGlobalObject) -> JSValue {
    global_object
        .err(
            jsc::ErrorCode::BODY_ALREADY_USED,
            format_args!("Body already used"),
        )
        .reject()
}

/// <https://fetch.spec.whatwg.org/#body-unusable>: a disturbed or locked stream rejects every reader.
fn handle_body_stream_unusable(
    readable: &ReadableStream,
    global_object: &JSGlobalObject,
) -> Option<JSValue> {
    if readable.is_disturbed(global_object) {
        return Some(handle_body_already_used(global_object));
    }
    if readable.is_locked(global_object) {
        return Some(
            global_object
                .err(
                    jsc::ErrorCode::INVALID_STATE_TypeError,
                    format_args!("Invalid state: ReadableStream is locked"),
                )
                .reject(),
        );
    }
    None
}

/// If the body already failed, reject the read with that error. Every body
/// reader must call this before its `Locked` handling: `Value::Error` would
/// otherwise fall through to `use_as_any_blob_*` and resolve empty.
fn handle_body_error(body: &Body, global_object: &JSGlobalObject) -> Option<JSValue> {
    let js = body.take_error()?.to_js(global_object);
    Some(JSPromise::rejected_promise(global_object, js).to_js())
}
