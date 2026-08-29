//! https://developer.mozilla.org/en-US/docs/Web/API/Body

use bun_jsc::JsClass as _;
use core::ffi::c_void;
use core::ptr::NonNull;

use crate::webcore::jsc::{
    self as jsc, CallFrame, CommonAbortReason, CommonAbortReasonExt as _, DOMFormData,
    JSGlobalObject, JSPromise, JSValue, JsResult, SystemError, URLSearchParams, VirtualMachine,
};
use crate::webcore::{
    self, AnyBlob, Blob, BlobExt as _, ByteStream, DrainResult, FetchHeaders, Lifetime,
    ReadableStream, blob, streams,
};
use bun_core::Output;
use bun_http_types::MimeType::MimeType;
// Re-export so callers can write `body::InternalBlob`.
use crate::jsc::HTTPHeaderName;
pub use crate::webcore::InternalBlob;
use crate::webcore::form_data::AsyncFormDataExt as _;
use bun_core::String as BunString;
use bun_core::{Utf8Bytes, WTFString, WTFStringImplExt as _};
use bun_jsc::StringJsc as _;
use bun_jsc::{JsCell, bun_string_jsc};

fn set_blob_content_type(blob: &Blob, mime_type: MimeType) {
    blob.content_type_was_set.set(true);
    if let Some(store) = blob.store.get().as_ref() {
        blob::Store::set_mime_type(store, mime_type.clone());
    }
    blob.content_type
        .set(blob::BlobContentType::from(mime_type));
}

bun_core::declare_scope!(BodyValue, visible);
bun_core::declare_scope!(BodyMixin, visible);

// R-2 (host-fn re-entrancy): `Body` is embedded inline in JS-exposed
// `Response` (and pooled in a `HiveRef` for `Request`). Every BodyMixin host
// fn takes `&self` and reaches the `Value` through this `JsCell` in
// closure-scoped borrows, so a re-entrant host call cannot stack two `&mut`
// to the same field.
#[repr(C)]
pub struct Body {
    pub value: JsCell<Value>, // = Value::Empty,
}

impl Default for Body {
    fn default() -> Self {
        Self {
            value: JsCell::new(Value::Empty),
        }
    }
}

impl Body {
    #[inline]
    pub(crate) fn new(value: Value) -> Self {
        Self {
            value: JsCell::new(value),
        }
    }

    #[inline]
    pub(crate) fn into_value(self) -> Value {
        self.value.into_inner()
    }

    pub(crate) fn len(&self) -> blob::SizeType {
        self.value.with_mut(|v| v.size())
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
                JSValue::from(matches!(self.value.get(), Value::Used)),
                jsc::JSType::BooleanObject,
            )
            .map_err(|_| core::fmt::Error)?;

        match self.value.get() {
            Value::Blob(blob) => {
                formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                blob.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
            }
            v @ (Value::InternalBlob(_) | Value::WTFStringImpl(_)) => {
                // Do not hoist a generic `self.value.size()` call out of this arm:
                // for `.Blob` it would stat the file, for `.Locked` it would deref the
                // global. Compute the size from the matched payload directly.
                let size = match v {
                    Value::InternalBlob(b) => b.slice_const().len(),
                    Value::WTFStringImpl(s) => s.utf8_byte_length(),
                    _ => unreachable!(),
                };
                formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                blob::write_format_for_size::<W, ENABLE_ANSI_COLORS>(false, size, writer)?;
            }
            Value::Locked(locked) => {
                if let Some(stream) = locked.readable.get() {
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

// Not a clean Drop — Value::reset mutates self to Null/Used and is called explicitly
// at specific protocol points (e.g. resolve()). PORTING.md forbids `pub fn deinit(&mut self)`;
// renamed to `reset()` since it cannot take `self` by value (in-place state transition).
impl Body {
    pub fn reset(&self) {
        self.value.with_mut(Value::reset);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PendingValue
// ────────────────────────────────────────────────────────────────────────────

pub struct PendingValue {
    pub(crate) promise: Option<JSValue>,
    pub(crate) readable: webcore::readable_stream::Strong,
    // writable: webcore::Sink

    // LIFETIMES.tsv JSC_BORROW → `&JSGlobalObject`, but `Value::Locked`
    // is stored on heap (Body in Request/Response m_ctx). Dropped the `<'a>`
    // lifetime per PORTING.md §Type map (no lifetime params on structs);
    // raw ptr until we pick `&'static` vs a JSC handle.
    pub global: *const JSGlobalObject,
    pub task: Option<NonNull<c_void>>,

    /// runs after the data is available.
    pub(crate) on_receive_value: Option<ReceiveValue>,

    /// A consumer that wants the whole body (`.text()`/`.json()`/…,
    /// `Bun.write`) has started waiting on it without realising a stream.
    /// Producers use it to stop holding data back (the server ignores request
    /// bodies until asked; HTMLRewriter stops pacing its input). The producer
    /// may resolve or fail this body synchronously from inside the call —
    /// replacing the `Value` this `PendingValue` lives in — so callers install
    /// their `promise`/`on_receive_value` first and touch nothing afterwards.
    pub(crate) on_start_buffering: Option<fn(ctx: NonNull<c_void>)>,
    pub(crate) on_start_streaming: Option<fn(ctx: NonNull<c_void>) -> DrainResult>,
    pub(crate) on_readable_stream_available:
        Option<fn(ctx: NonNull<c_void>, global_this: &JSGlobalObject, readable: ReadableStream)>,
    /// Upstream producer to notify on cancel/drain/consumer-attach; forwarded
    /// to the `NewSource` when the locked body is realised as a native stream.
    pub producer: streams::SourceHandle,
    pub(crate) size_hint: blob::SizeType,

    pub(crate) deinit: bool,
    pub(crate) action: Action,
}

/// The native consumer waiting on a [`PendingValue`] (`on_receive_value`).
pub(crate) enum ReceiveValue {
    /// Called with [`PendingValue::task`], which the registrant retargeted to
    /// its own context.
    Ctx(fn(ctx: NonNull<c_void>, value: &mut Value)),
    /// `Bun.write(file, body)` waiting for the body.
    WriteFile(Box<crate::webcore::blob::write_file::WriteFileWaitFromLockedValueTask>),
}

impl ReceiveValue {
    fn call(self, task: Option<NonNull<c_void>>, value: &mut Value) {
        match self {
            ReceiveValue::Ctx(callback) => callback(task.unwrap(), value),
            ReceiveValue::WriteFile(waiter) => waiter.receive(value),
        }
    }
}

impl PendingValue {
    pub(crate) fn new(global: &JSGlobalObject) -> Self {
        Self {
            global: std::ptr::from_ref(global),
            ..Default::default()
        }
    }
}

impl Default for PendingValue {
    /// Callers using `..Default::default()` must initialize `global`
    /// explicitly. Null here is the only viable default.
    fn default() -> Self {
        Self {
            promise: None,
            readable: webcore::readable_stream::Strong::default(),
            global: core::ptr::null(),
            task: None,
            on_receive_value: None,
            on_start_buffering: None,
            on_start_streaming: None,
            on_readable_stream_available: None,
            producer: streams::SourceHandle::None,
            size_hint: 0,
            deinit: false,
            action: Action::None,
        }
    }
}

impl PendingValue {
    /// Once `readable` is set the live handle is `NewSource.producer`; these
    /// hooks go stale when the producer (e.g. `FetchTasklet`) is freed.
    fn detach_producer(&mut self) {
        self.on_start_buffering = None;
        self.on_start_streaming = None;
        self.on_readable_stream_available = None;
        if !matches!(self.on_receive_value, Some(ReceiveValue::Ctx(_))) {
            // A registered `ReceiveValue::Ctx` means `task` is the consumer's
            // ctx (overwriting the producer), read by `resolve()`.
            self.task = None;
        }
        self.producer = streams::SourceHandle::None;
    }

    /// Safe `&JSGlobalObject` accessor for the JSC_BORROW `global` back-pointer.
    #[inline]
    pub(crate) fn global(&self) -> &JSGlobalObject {
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST handle, so the
        // `*const → &` deref is safe via `bun_opaque::opaque_deref`
        // (const-asserted ZST/align-1; panics on the impossible null —
        // `self.global` is set from a live `&JSGlobalObject` at construction).
        bun_opaque::opaque_deref(self.global)
    }

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If the size is unknown will be 0
    fn size_hint(&self) -> blob::SizeType {
        if let Some(readable) = self.readable.get() {
            if let Some(bytes) = readable.ptr.bytes() {
                return bytes.size_hint.get();
            }
        }
        self.size_hint
    }

    fn to_any_blob(&mut self) -> Option<AnyBlob> {
        if self.promise.is_some() {
            return None;
        }
        self.to_any_blob_allow_promise()
    }

    pub(crate) fn is_disturbed<T: BodyOwnerJs>(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> bool {
        if self.promise.is_some() {
            return true;
        }

        if let Some(body_value) = T::body_get_cached(this_value) {
            if webcore::readable_stream::is_disturbed_value(body_value, global_object) {
                return true;
            }
            return false;
        }

        if let Some(readable) = self.readable.get() {
            return readable.is_disturbed(global_object);
        }

        false
    }

    pub(crate) fn is_disturbed2(&self, global_object: &JSGlobalObject) -> bool {
        if self.promise.is_some() {
            return true;
        }

        if let Some(readable) = self.readable.get() {
            return readable.is_disturbed(global_object);
        }

        false
    }

    fn to_any_blob_allow_promise(&mut self) -> Option<AnyBlob> {
        let global = self.global();
        let mut stream = self.readable.get()?;

        if let Some(blob) = stream.to_any_blob(global) {
            self.readable.deinit();
            return Some(blob);
        }

        None
    }

    /// Commit this pending body to `action`. The script half of the read —
    /// draining an already-realised stream, or telling the producer to start
    /// buffering (which may settle and so replace the `Value` this lives in)
    /// — is returned for the caller to [`run`](LockedRead::run) once its
    /// borrow of the body is released.
    fn set_promise(
        &mut self,
        global_this: &JSGlobalObject,
        action: Action,
        owned_readable: Option<ReadableStream>,
    ) -> JsResult<LockedRead> {
        self.action = action;
        if let Some(readable) = owned_readable.or_else(|| self.readable.get()) {
            match &mut self.action {
                Action::GetFormData(_)
                | Action::GetText
                | Action::GetJSON
                | Action::GetBlob
                | Action::GetArrayBuffer
                | Action::GetBytes => {
                    let (kind, encoding) = match &mut self.action {
                        Action::GetJSON => (StreamRead::JSON, JSValue::UNDEFINED),
                        Action::GetArrayBuffer => (StreamRead::ArrayBuffer, JSValue::UNDEFINED),
                        Action::GetBytes => (StreamRead::Bytes, JSValue::UNDEFINED),
                        Action::GetText => (StreamRead::Text, JSValue::UNDEFINED),
                        Action::GetBlob => (StreamRead::Blob, JSValue::UNDEFINED),
                        Action::GetFormData(form_data) => {
                            let fd = form_data.take().unwrap();
                            let encoding_js = match &fd.encoding {
                                bun_core::form_data::Encoding::Multipart(multipart) => {
                                    bun_string_jsc::create_utf8_for_js(global_this, multipart)?
                                }
                                bun_core::form_data::Encoding::URLEncoded => JSValue::UNDEFINED,
                            };
                            // fd dropped at end of scope (Box<AsyncFormData> -> Drop)
                            (StreamRead::FormData, encoding_js)
                        }
                        _ => unreachable!(),
                    };
                    self.readable.deinit();
                    // The ReadableStream within is expected to keep this Promise alive.
                    // If you try to protect() this, it will leak memory because the other end of the ReadableStream won't call it.
                    // See https://github.com/oven-sh/bun/issues/13678
                    return Ok(LockedRead::Stream {
                        readable,
                        kind,
                        encoding,
                    });
                }
                Action::None => {}
            }
        }

        {
            let promise = JSPromise::create(global_this);
            let promise_value = promise.to_js();
            self.promise = Some(promise_value);
            promise_value.protect();

            // Last use of `self`: the producer may settle the body (and so
            // replace `*self`) from inside the hook.
            let start = self
                .on_start_buffering
                .take()
                .map(|hook| (hook, self.task.unwrap()));
            Ok(LockedRead::Buffer {
                promise: promise_value,
                start,
            })
        }
    }
}

/// Which `readableStreamTo*` builtin drains the stream.
pub enum StreamRead {
    Text,
    JSON,
    ArrayBuffer,
    Bytes,
    Blob,
    FormData,
}

/// The script half of a [`PendingValue::set_promise`] read; run it with no
/// borrow of the body live (a JS-backed stream's `pull`, or the producer's
/// start hook, can reach the same body again).
#[must_use]
pub enum LockedRead {
    Stream {
        readable: ReadableStream,
        kind: StreamRead,
        encoding: JSValue,
    },
    Buffer {
        promise: JSValue,
        start: Option<(fn(ctx: NonNull<c_void>), NonNull<c_void>)>,
    },
}

impl LockedRead {
    pub fn run(self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            LockedRead::Stream {
                readable,
                kind,
                encoding,
            } => {
                let _keep = jsc::EnsureStillAlive(readable.value);
                match kind {
                    StreamRead::JSON => global_this.readable_stream_to_json(readable.value),
                    StreamRead::ArrayBuffer => {
                        global_this.readable_stream_to_array_buffer(readable.value)
                    }
                    StreamRead::Bytes => global_this.readable_stream_to_bytes(readable.value),
                    StreamRead::Text => global_this.readable_stream_to_text(readable.value),
                    StreamRead::Blob => global_this.readable_stream_to_blob(readable.value),
                    StreamRead::FormData => {
                        global_this.readable_stream_to_form_data(readable.value, encoding)
                    }
                }
            }
            LockedRead::Buffer { promise, start } => {
                if let Some((on_start_buffering, task)) = start {
                    on_start_buffering(task);
                }
                Ok(promise)
            }
        }
    }
}

pub enum Action {
    None,
    GetText,
    GetJSON,
    GetArrayBuffer,
    GetBytes,
    GetBlob,
    GetFormData(Option<Box<bun_core::form_data::AsyncFormData>>),
}

impl Action {
    pub(crate) fn is_none(&self) -> bool {
        matches!(self, Action::None)
    }
}

/// Tag-only equality. `GetFormData` payload is ignored.
impl PartialEq for Action {
    fn eq(&self, other: &Self) -> bool {
        core::mem::discriminant(self) == core::mem::discriminant(other)
    }
}

/// Per-class codegen'd cached-slot accessors for the `body` and `stream`
/// JS-side properties, plus the weak `JsRef` back-pointer. Both `Request` and
/// `Response` forward these 1:1 to `bun_jsc::generated::JS{Request,Response}`.
pub(crate) trait BodyOwnerJs {
    /// `self.js_ref.get().try_get()` — the live JS wrapper, if any.
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
// Plain tag + union rather than niche-filled through `WTFString`'s non-null
// pointer: measurably cheaper moves/matches on the Request/Response
// constructor and body-reader paths.
#[repr(u8)]
pub enum Value {
    Blob(Blob),

    /// This is the String type from WebKit
    /// It is reference counted, so we must always deref it (which this does automatically)
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
    // The body's own +1 on the *intrusively* refcounted `WTF::StringImpl`;
    // released when the handle is dropped or moved out.
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
    crate::jsc_hooks::body_hive_alloc(Body::new(value))
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

// Constructed/matched across several modules; boxing `SystemError` would
// ripple through those callers.
#[allow(clippy::large_enum_variant)]
pub enum ValueError {
    AbortReason(CommonAbortReason),
    SystemError(SystemError),
    /// `SystemError` surfaced as a JS `TypeError` (fetch network errors).
    SystemTypeError(SystemError),
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
            // `to_error_instance` consumes the error's string refs, and `to_js`
            // takes `&mut self` — take the value out so a second call builds an
            // empty error rather than releasing those refs twice.
            ValueError::SystemError(system_error) => {
                core::mem::take(system_error).to_error_instance(global_object)
            }
            ValueError::SystemTypeError(system_error) => {
                core::mem::take(system_error).to_type_error_instance(global_object)
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
            ValueError::SystemError(e) => ValueError::SystemError(e.clone()),
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
    /// Each arm moves its payload as is: a `WTFStringImpl`'s `+1` travels with
    /// the handle, so nothing is ref'd here.
    fn from(blob: AnyBlob) -> Value {
        match blob {
            AnyBlob::Blob(b) => Value::Blob(b),
            AnyBlob::InternalBlob(b) => Value::InternalBlob(b),
            AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(s),
        }
    }
}

impl Value {
    /// The `Body` a `Request`/`Response` wrapper `value` owns, if it is one.
    ///
    /// `Body.Value` is not itself a JS class — it lives inside a `Request` or
    /// `Response` wrapper — so the generic `JSValue::as_::<T: JsClass>()` path
    /// cannot be used. The storage is owned by the JSC heap cell and outlives
    /// the call only as long as `value` is kept alive by the caller.
    pub(crate) fn from_request_or_response(value: JSValue) -> Option<&'static Body> {
        if value.is_empty_or_undefined_or_null() {
            return None;
        }
        if let Some(req) = value.as_class_ref::<crate::webcore::Request>() {
            return Some(req.body());
        }
        if let Some(res) = value.as_class_ref::<crate::webcore::Response>() {
            return Some(res.body());
        }
        None
    }

    pub(crate) fn was_string(&self) -> bool {
        match self {
            Value::InternalBlob(blob) => blob.was_string,
            Value::WTFStringImpl(_) => true,
            _ => false,
        }
    }
}

impl Value {
    pub(crate) fn to_blob_if_possible(&mut self) {
        if let Value::WTFStringImpl(str) = &*self {
            if let Utf8Bytes::Owned(bytes) = str.to_utf8() {
                // The UTF-8 buffer is already heap-owned by the slice wrapper;
                // transfer it (no copy). The overwritten `WTFStringImpl` handle
                // releases its ref on assignment.
                *self = Value::InternalBlob(InternalBlob {
                    bytes,
                    was_string: true,
                });
            }
        }

        let Value::Locked(locked) = self else {
            return;
        };

        if let Some(blob) = locked.to_any_blob() {
            *self = Value::from(blob);
        }
    }

    pub(crate) fn size(&mut self) -> blob::SizeType {
        match self {
            Value::Blob(b) => b.get_size_for_bindings() as blob::SizeType,
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => s.utf8_byte_length() as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            _ => 0,
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.memory_cost(),
            Value::WTFStringImpl(s) => s.memory_cost(),
            // Not `size_hint()`: a Locked body owns no bytes (they live in the
            // ByteStream buffer, separately accounted), so reporting the
            // content-length here mis-trains JSC's GC live-size estimate.
            Value::Locked(_) => 0,
            _ => 0,
        }
    }

    pub(crate) fn estimated_size(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.slice_const().len(),
            Value::WTFStringImpl(s) => s.byte_slice().len(),
            // See memory_cost(): size_hint is anticipated, not allocated.
            Value::Locked(_) => 0,
            _ => 0,
        }
    }

    // pub const empty = Value::Empty;

    pub(crate) fn to_readable_stream(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        jsc::mark_binding();

        match self {
            Value::Used => ReadableStream::used(global_this),
            Value::Empty => ReadableStream::empty(global_this),
            Value::Null => Ok(JSValue::NULL),
            Value::InternalBlob(_) | Value::Blob(_) | Value::WTFStringImpl(_) => {
                // `deinit` must run on every exit incl. `?` paths.
                let blob = scopeguard::guard(self.use_(), |mut b| b.deinit());
                blob.resolve_size();
                let blob_size = blob.size.get();
                let value = ReadableStream::from_blob_copy_ref(global_this, &blob, blob_size)?;

                let stream = ReadableStream::from_js_direct(value).unwrap();
                *self = Value::Locked(PendingValue {
                    readable: webcore::readable_stream::Strong::init(stream, global_this),
                    ..PendingValue::new(global_this)
                });
                Ok(value)
            }
            Value::Locked(locked) => {
                if let Some(readable) = locked.readable.get() {
                    return Ok(readable.value);
                }
                self.locked_to_native_stream(global_this, false)
            }
            Value::Error(err) => {
                let reason = err.to_js(global_this);
                let value = ReadableStream::errored(global_this, reason)?;
                // As for a blob above: this stream is the body from here on, so `.body` hands it
                // out again, `bodyUsed` follows it, and the promise readers reject through it.
                let stream = ReadableStream::from_js_direct(value).unwrap();
                *self = Value::Locked(PendingValue {
                    readable: webcore::readable_stream::Strong::init(stream, global_this),
                    ..PendingValue::new(global_this)
                });
                Ok(value)
            }
        }
    }

    /// `Body.textStream()`: a `ReadableStream<string>` of the body's UTF-8
    /// content, decoded directly from the body's backing bytes without
    /// materializing a separate byte `ReadableStream` for native-backed bodies.
    /// Returns `NULL` for `Null` (caller substitutes an empty stream).
    pub(crate) fn to_text_readable_stream(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();

        match self {
            Value::Used => ReadableStream::used(global_this),
            Value::Null => Ok(JSValue::NULL),
            Value::Empty => {
                *self = Value::Used;
                ReadableStream::empty(global_this)
            }
            Value::InternalBlob(_) | Value::WTFStringImpl(_) => {
                let mut blob = self.use_as_any_blob_allow_non_utf8_string();
                let string = blob.to_string(global_this, Lifetime::Transfer);
                blob.detach();
                ReadableStream::from_decoded_text(global_this, string?)
            }
            Value::Blob(_) => {
                let stream = {
                    let blob = scopeguard::guard(self.use_(), |mut b| b.deinit());
                    blob.resolve_size();
                    if blob.needs_to_read_file() || blob.is_s3() {
                        let blob_size = blob.size.get();
                        let bytes =
                            ReadableStream::from_blob_copy_ref(global_this, &blob, blob_size)?;
                        ReadableStream::text_decode_from(global_this, bytes)?
                    } else {
                        let string = blob.to_string(global_this, Lifetime::Transfer)?;
                        ReadableStream::from_decoded_text(global_this, string)?
                    }
                };
                *self = Value::Used;
                Ok(stream)
            }
            Value::Locked(_) => self.locked_to_native_stream(global_this, true),
            Value::Error(err) => {
                let reason = err.to_js(global_this);
                let stream = ReadableStream::errored(global_this, reason)?;
                *self = Value::Used;
                Ok(stream)
            }
        }
    }

    /// Materialize a `Value::Locked` body (no readable yet) as a
    /// `NewSource<ByteStream>`-backed native `ReadableStream` and wire up the
    /// HTTP-client callbacks. Shared tail of [`to_readable_stream`] and
    /// [`to_text_readable_stream`].
    fn locked_to_native_stream(
        &mut self,
        global_this: &JSGlobalObject,
        text_mode: bool,
    ) -> JsResult<JSValue> {
        let Value::Locked(locked) = self else {
            unreachable!("locked_to_native_stream on non-Locked Value");
        };
        // A registered `on_receive_value` means a native consumer (Bun.write,
        // the server's render-wait) owns this body (and the render-wait has
        // retargeted `task` to its own context); materializing a stream here
        // would hand the body to a second consumer.
        if locked.promise.is_some() || !locked.action.is_none() || locked.on_receive_value.is_some()
        {
            return ReadableStream::used(global_this);
        }
        let mut drain_result = DrainResult::EstimatedSize(0);

        if let Some(drain) = locked.on_start_streaming.take() {
            drain_result = drain(locked.task.unwrap());
        }

        if matches!(drain_result, DrainResult::Aborted) {
            *self = Value::Null;
            return ReadableStream::empty(global_this);
        }

        // The JS wrapper made by `to_readable_stream()` below owns the source
        // from here (freed by the GC finalizer).
        let reader =
            webcore::readable_stream::NewSource::new(ByteStream::new(drain_result), global_this);
        reader.producer.set(locked.producer);

        let stream_value = if text_mode {
            reader.to_text_readable_stream(global_this)?
        } else {
            reader.to_readable_stream(global_this)?
        };
        let readable = ReadableStream {
            ptr: webcore::readable_stream::Source::Bytes(reader.as_context_ptr()),
            value: stream_value,
        };
        locked.readable = webcore::readable_stream::Strong::init(readable, global_this);

        if let Some(on_readable_stream_available) = locked.on_readable_stream_available.take() {
            on_readable_stream_available(locked.task.unwrap(), global_this, readable);
        }
        locked.detach_producer();

        // In text mode the returned stream emits strings, so it must not be
        // cached as the body's byte stream (consulted by `.body`, `bodyUsed`,
        // and `throw_if_body_unusable`). Mark the body consumed instead.
        if text_mode {
            *self = Value::Used;
        }

        Ok(stream_value)
    }

    pub fn from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Value> {
        value.ensure_still_alive();

        if value.is_empty_or_undefined_or_null() {
            return Ok(Value::Null);
        }

        let js_type = value.js_type();

        if js_type.is_string_like() {
            let str = value.to_bun_string(global_this)?;
            if str.length() == 0 {
                return Ok(Value::Empty);
            }

            debug_assert!(str.tag() == bun_core::Tag::WTFStringImpl);

            // `into_wtf()` moves the +1 ref out of the bun_core::String wrapper.
            return Ok(Value::WTFStringImpl(str.into_wtf().unwrap()));
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

        if let Some(form_data) = DOMFormData::from_js(value) {
            return Ok(Value::Blob(Blob::from_dom_form_data(
                global_this,
                form_data,
            )));
        }

        if let Some(search_params) = URLSearchParams::from_js(value) {
            // S008: `URLSearchParams` is an `opaque_ffi!` ZST handle — safe deref.
            return Ok(Value::Blob(Blob::from_url_search_params(
                global_this,
                bun_opaque::opaque_deref_mut(search_params.as_ptr()),
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
                // Blob.Store frees via an Allocator, so dupe out of the
                // codec's allocator here. The hot path (`.bytes()`) hands the
                // codec buffer to JS without this copy.
                let owned: Vec<u8> = encoded.as_slice().to_vec();
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

            if let Some(blob) = readable.ptr.blob() {
                let result = blob
                    .to_any_blob(global_this)
                    .map_or(Value::Empty, Value::from);
                readable.force_detach(global_this);
                return Ok(result);
            }

            return Ok(Value::from_readable_stream_without_lock_check(
                readable,
                global_this,
            ));
        }

        Ok(Value::Blob(Blob::get::<true, false>(global_this, value)?))
    }

    pub(crate) fn from_readable_stream_without_lock_check(
        readable: ReadableStream,
        global_this: &JSGlobalObject,
    ) -> Value {
        Value::Locked(PendingValue {
            readable: webcore::readable_stream::Strong::init(readable, global_this),
            ..PendingValue::new(global_this)
        })
    }

    pub(crate) fn resolve(
        &mut self,
        new: &mut Value,
        global: &JSGlobalObject,
        // Opaque C++ handle, mutated via FFI. Taking
        // `NonNull` (not `&`/`&mut`) avoids manufacturing aliased Rust borrows.
        headers: Option<NonNull<FetchHeaders>>,
    ) -> jsc::JsResult<()> {
        bun_core::scoped_log!(BodyValue, "resolve");
        if let Value::Locked(locked) = self {
            if let Some(readable) = locked.readable.get() {
                // Feed the already-created stream (instead of closing it empty)
                // only when it is the sole consumer of this pending body.
                let sole_consumer = locked.promise.is_none() && locked.on_receive_value.is_none();
                let fed = sole_consumer
                    .then(|| readable.ptr.bytes())
                    .flatten()
                    .map(|bytes| {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        bytes.on_data(streams::Result::TemporaryAndDone(bun_ptr::RawSlice::new(
                            blob.slice(),
                        )));
                        blob.detach();
                    });

                if fed.is_some() {
                    *new = Value::Used;
                } else {
                    readable.done();
                }
                locked.readable.deinit();
            }

            if let Some(callback) = locked.on_receive_value.take() {
                callback.call(locked.task, new);
                return Ok(());
            }

            if let Some(promise_) = locked.promise.take() {
                let promise = promise_.as_any_promise().unwrap();

                match &mut locked.action {
                    // These ones must use promise.wrap() to handle exceptions thrown while calling .toJS() on the value.
                    // These exceptions can happen if the String is too long, ArrayBuffer is too large, JSON parse error, etc.
                    Action::GetText => match new {
                        Value::WTFStringImpl(_) | Value::InternalBlob(_) => {
                            let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                            let result = promise.wrap(global, |g| blob.to_string_transfer(g));
                            blob.detach();
                            result?;
                        }
                        _ => {
                            let blob = new.use_();
                            promise.wrap(global, |g| blob.to_string_transfer(g))?;
                        }
                    },
                    Action::GetJSON => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        let result = promise.wrap(global, |g| blob.to_json_share(g));
                        blob.detach();
                        result?;
                    }
                    Action::GetArrayBuffer => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        let result = promise.wrap(global, |g| blob.to_array_buffer_transfer(g));
                        blob.detach();
                        result?;
                    }
                    Action::GetBytes => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        let result = promise.wrap(global, |g| blob.to_uint8_array_transfer(g));
                        blob.detach();
                        result?;
                    }
                    Action::GetFormData(form_data_slot) => 'inner: {
                        let mut blob = new.use_as_any_blob();
                        let Some(async_form_data) = form_data_slot.take() else {
                            // `blob.detach()` below covers the reject error path too.
                            let r = promise.reject(
                                global,
                                global.create_error_instance(format_args!(
                                    "Internal error: task for FormData must not be null"
                                )),
                            );
                            blob.detach();
                            r?;
                            break 'inner;
                        };
                        let result = async_form_data.to_js(global, blob.slice(), promise);
                        blob.detach();
                        // async_form_data dropped (Box<AsyncFormData> -> Drop replaces deinit)
                        result?;
                    }
                    Action::None | Action::GetBlob => {
                        let blob_owned = new.use_();
                        let blob = &blob_owned;
                        if let Some(fetch_headers) = headers {
                            // `headers` is a live C++ FetchHeaders handle;
                            // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
                            let fetch_headers =
                                bun_opaque::opaque_deref_mut(fetch_headers.as_ptr());
                            if let Some(content_type) =
                                fetch_headers.fast_get(HTTPHeaderName::ContentType)
                            {
                                let content_slice = content_type.to_utf8();
                                let mime_type = MimeType::init(content_slice.slice(), true, None);
                                set_blob_content_type(blob, mime_type);
                            }
                        }
                        if !blob.content_type_was_set.get() && blob.store.get().is_some() {
                            set_blob_content_type(blob, bun_http_types::MimeType::TEXT);
                        }
                        promise.resolve(global, blob_owned.to_js(global))?;
                    }
                }
                promise_.unprotect();
            }
        }
        Ok(())
    }

    pub(crate) fn use_(&mut self) -> Blob {
        self.to_blob_if_possible();

        match self {
            Value::Blob(b) => {
                let new_blob = core::mem::take(b);
                *self = Value::Used;
                debug_assert!(!new_blob.is_heap_allocated()); // owned by Body
                new_blob
            }
            Value::InternalBlob(ib) => {
                let global = VirtualMachine::get().global();
                let new_blob = Blob::init(
                    ib.to_owned_slice(),
                    // we will never resize it from here
                    // we have to use the default allocator
                    // even if it was actually allocated on a different thread
                    global,
                );
                *self = Value::Used;
                new_blob
            }
            Value::WTFStringImpl(wtf) => {
                let global = VirtualMachine::get().global();
                let new_blob = Blob::init(wtf.to_utf8().into_vec(), global);
                // Releases the body's ref on the string.
                *self = Value::Used;
                new_blob
            }
            // Leave the non-payload variants (`Locked`/`Error`/`Null`/…) in place.
            // `Blob::default()` leaves `global_this` null which matches the
            // don't-care contract here.
            _ => Blob::default(),
        }
    }

    pub(crate) fn try_use_as_any_blob(&mut self) -> Option<AnyBlob> {
        let any_blob: AnyBlob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(str) => {
                if str.can_use_as_utf8() {
                    let s = str.clone();
                    *self = Value::Used;
                    return Some(AnyBlob::WTFStringImpl(s));
                } else {
                    return None;
                }
            }
            // `?` on the Option early-returns None; on Some it falls through
            // to the `*self = Value::Used` assignment below.
            Value::Locked(l) => l.to_any_blob_allow_promise()?,
            _ => return None,
        };

        *self = Value::Used;
        Some(any_blob)
    }

    pub(crate) fn use_as_any_blob(&mut self) -> AnyBlob {
        let was_null = matches!(self, Value::Null);
        let any_blob: AnyBlob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(str) => {
                if let Utf8Bytes::Owned(utf8) = str.to_utf8() {
                    // The handle's ref is released by the assignment below (the
                    // variant is still `WTFStringImpl(str)`).
                    AnyBlob::InternalBlob(InternalBlob {
                        // Transfer ownership of the heap-allocated UTF-8 buffer (no copy).
                        bytes: utf8,
                        was_string: true,
                    })
                } else {
                    let s = str.clone();
                    *self = Value::Used;
                    AnyBlob::WTFStringImpl(s)
                }
            }
            Value::Locked(l) => l
                .to_any_blob_allow_promise()
                .unwrap_or(AnyBlob::Blob(Blob::default())),
            _ => AnyBlob::Blob(Blob::default()),
        };

        *self = if was_null { Value::Null } else { Value::Used };
        any_blob
    }

    pub(crate) fn use_as_any_blob_allow_non_utf8_string(&mut self) -> AnyBlob {
        let was_null = matches!(self, Value::Null);
        let any_blob: AnyBlob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(s) => {
                // Copy the handle out (a ref) and drop the body's (a deref)
                // rather than moving the whole `Value`.
                let s = s.clone();
                *self = Value::Used;
                AnyBlob::WTFStringImpl(s)
            }
            Value::Locked(l) => l
                .to_any_blob_allow_promise()
                .unwrap_or(AnyBlob::Blob(Blob::default())),
            _ => AnyBlob::Blob(Blob::default()),
        };

        *self = if was_null { Value::Null } else { Value::Used };
        any_blob
    }

    pub(crate) fn to_error_instance(
        &mut self,
        err: ValueError,
        global: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        if let Value::Locked(_) = self {
            // Take the `PendingValue` out (leaves `Locked(default)`, which owns
            // nothing), then overwrite with `Error`.
            let mut locked = match self {
                Value::Locked(l) => core::mem::take(l),
                _ => unreachable!(),
            };
            let was_disturbed = !locked.action.is_none()
                || locked.promise.is_some()
                || locked.readable.is_disturbed(global);
            *self = Value::Error(err);
            let Value::Error(err_ref) = self else {
                unreachable!()
            };

            // `deinit` must run on every exit incl. `?` paths.
            let strong_readable =
                scopeguard::guard(core::mem::take(&mut locked.readable), |mut r| r.deinit());

            if let Some(promise_value) = locked.promise.take() {
                // `unprotect` + `ensure_still_alive` are non-Drop side effects
                // (GC root decrement) that must run even if
                // reject_with_async_stack errors.
                let promise_value = scopeguard::guard(promise_value, |p| {
                    p.unprotect();
                    p.ensure_still_alive();
                });
                if let Some(promise) = promise_value.as_any_promise() {
                    if promise.status() == jsc::js_promise::Status::Pending {
                        promise.reject_with_async_stack(global, err_ref.to_js(global))?;
                    }
                }
            }

            // The Promise version goes before the ReadableStream version incase the Promise version is used too.
            // Avoid creating unnecessary duplicate JSValue.
            if let Some(readable) = strong_readable.get() {
                if let Some(bytes) = readable.ptr.bytes() {
                    bytes.on_data(streams::Result::Err(err_ref.to_stream_error(global)));
                } else {
                    readable.abort(global)?;
                }
            }

            if let Some(on_receive_value) = locked.on_receive_value.take() {
                // For `ReceiveValue::Ctx`, `task` is the live request-ctx
                // pointer registered alongside this callback.
                on_receive_value.call(locked.task, self);
            }

            if was_disturbed {
                *self = Value::Used;
            }

            return Ok(());
        }
        *self = Value::Error(err);
        Ok(())
    }

    // mutates self to Null and is called explicitly at specific protocol points.
    // Renamed from `deinit` per PORTING.md (never expose `pub fn deinit(&mut self)`).
    // Every variant's payload releases what it owns when dropped (the Blob's
    // store, the `WTF::StringImpl` ref, the InternalBlob's buffer, the Locked
    // stream root, the Error's Strong), so the assignment below — like a
    // `HiveRef<Body>` slot being recycled — is the whole release.
    pub fn reset(&mut self) {
        if let Value::Locked(locked) = self {
            // Locked stays Locked (callers may still inspect the variant after
            // reset()).
            if !locked.deinit {
                locked.deinit = true;
                locked.readable.deinit();
                locked.readable = Default::default();
            }
            return;
        }
        *self = Value::Null;
    }
}

impl Value {
    pub(crate) fn tee(
        &mut self,
        global_this: &JSGlobalObject,
        owned_readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value> {
        let Value::Locked(locked) = self else {
            // Caller guarantees `self` is `Locked` at entry.
            unreachable!("tee() called on non-Locked Value");
        };
        if let Some(readable) = owned_readable {
            if readable.is_disturbed(global_this) {
                return Ok(Value::Used);
            }

            if let Some((rs0, rs1)) = readable.tee(global_this)? {
                // Keep the current readable as a strong reference when cloning, and return the second one in the result.
                // This will be checked and downgraded to a write barrier if needed.
                locked.readable = webcore::readable_stream::Strong::init(rs0, global_this);
                return Ok(Value::Locked(PendingValue {
                    readable: webcore::readable_stream::Strong::init(rs1, global_this),
                    ..PendingValue::new(global_this)
                }));
            }
        }
        if locked.readable.is_disturbed(global_this) {
            return Ok(Value::Used);
        }

        if let Some(readable) = locked.readable.tee(global_this)? {
            return Ok(Value::Locked(PendingValue {
                readable: webcore::readable_stream::Strong::init(readable, global_this),
                ..PendingValue::new(global_this)
            }));
        }

        // `on_receive_value`: same consumer-owned-task guard as
        // `locked_to_native_stream`.
        if locked.promise.is_some()
            || !locked.action.is_none()
            || locked.readable.has()
            || locked.on_receive_value.is_some()
        {
            return Ok(Value::Used);
        }

        let mut drain_result = DrainResult::EstimatedSize(0);

        if let Some(drain) = locked.on_start_streaming.take() {
            drain_result = drain(locked.task.unwrap());
        }

        if matches!(drain_result, DrainResult::Aborted) {
            *self = Value::Null;
            return Ok(Value::Null);
        }

        // The JS wrapper made by `to_readable_stream()` below owns the source
        // from here (freed by the GC finalizer).
        let reader =
            webcore::readable_stream::NewSource::new(ByteStream::new(drain_result), global_this);

        // reshaped for borrowck — re-borrow locked after the early *self = Null path above.
        let Value::Locked(locked) = self else {
            unreachable!()
        };

        reader.producer.set(locked.producer);

        locked.readable = webcore::readable_stream::Strong::init(
            ReadableStream {
                ptr: webcore::readable_stream::Source::Bytes(reader.as_context_ptr()),
                value: reader.to_readable_stream(global_this)?,
            },
            global_this,
        );

        if let Some(on_readable_stream_available) = locked.on_readable_stream_available.take() {
            on_readable_stream_available(
                locked.task.unwrap(),
                global_this,
                locked.readable.get().unwrap(),
            );
        }
        locked.detach_producer();

        let teed = match locked.readable.tee(global_this)? {
            Some(t) => t,
            None => return Ok(Value::Used),
        };

        Ok(Value::Locked(PendingValue {
            readable: webcore::readable_stream::Strong::init(teed, global_this),
            ..PendingValue::new(global_this)
        }))
    }

    pub(crate) fn clone(&mut self, global_this: &JSGlobalObject) -> JsResult<Value> {
        self.clone_with_readable_stream(global_this, None)
    }

    pub(crate) fn clone_with_readable_stream(
        &mut self,
        global_this: &JSGlobalObject,
        readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value> {
        // Tee a Locked body before any blob extraction: `to_blob_if_possible()`
        // would `.done()` an already-materialized `.body` stream, leaving the
        // user-visible cached stream empty instead of a live tee branch.
        if matches!(self, Value::Locked(_)) {
            return self.tee(global_this, readable);
        }

        self.to_blob_if_possible();

        if let Value::InternalBlob(internal_blob) = self {
            let owned = internal_blob.to_owned_slice();
            *self = Value::Blob(Blob::init(owned, global_this));
        }

        if let Value::Blob(b) = self {
            return Ok(Value::Blob(b.dupe_with_content_type(false)));
        }

        if let Value::WTFStringImpl(s) = self {
            return Ok(Value::WTFStringImpl(s.clone()));
        }

        if matches!(self, Value::Null) {
            return Ok(Value::Null);
        }

        // A failed body clones as failed, so the clone's readers reject via
        // `handle_body_error` instead of falling through to `Empty` below and
        // resolving as an empty "successful" body.
        if let Value::Error(err) = self {
            return Ok(Value::Error(err.dupe(global_this)));
        }

        Ok(Value::Empty)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// JSC-integration: extract / BodyMixin (host-fn methods).
// ────────────────────────────────────────────────────────────────────────────

// https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
pub(crate) fn extract(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Value> {
    let body_value = Value::from_js(global_this, value)?;
    if let Value::Blob(b) = &body_value {
        debug_assert!(!b.is_heap_allocated()); // owned by Body
    }
    Ok(body_value)
}

// ────────────────────────────────────────────────────────────────────────────
// Mixin
// ────────────────────────────────────────────────────────────────────────────

/// Mixin trait with provided methods.
/// Implementers supply `body`, `get_fetch_headers`, `get_form_data_encoding`.
///
/// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self` and
/// reaches the body's `Value` in closure-scoped borrows of its `JsCell`.
pub(crate) trait BodyMixin: BodyOwnerJs + Sized {
    /// The owner's `Body` (inline in `Response`, pooled for `Request`).
    fn body(&self) -> &Body;
    /// `FetchHeaders` is an
    /// opaque, intrusively-refcounted C++ handle whose accessors take `&mut self`
    /// (FFI signature is `*mut`). Returning `NonNull` instead of `&FetchHeaders`
    /// avoids deriving `&mut T` from `&T` at the call sites (UB).
    fn get_fetch_headers(&self) -> Option<NonNull<FetchHeaders>>;
    fn get_form_data_encoding(&self) -> JsResult<Option<Box<bun_core::form_data::AsyncFormData>>>;

    /// The body's `Value` slot.
    #[inline]
    fn body_value(&self) -> &JsCell<Value> {
        &self.body().value
    }

    // ────────────────────────────────────────────────────────────────────
    // Twin methods (identical for Request/Response). These were previously
    // open-coded in both files against `js_gen::*` / `js::*` directly; the
    // [`BodyOwnerJs`] forwarders erase the per-class codegen module so the
    // bodies can live here once.
    // ────────────────────────────────────────────────────────────────────

    /// JS-side `js.gc.stream` cache is the
    /// source of truth; fall back to the native `Locked.readable` slot.
    fn get_body_readable_stream(&self) -> Option<ReadableStream> {
        self.readable_stream_of(self.body_value().get())
    }

    /// [`get_body_readable_stream`](Self::get_body_readable_stream) against an
    /// already-borrowed `value`.
    #[inline(always)]
    fn readable_stream_of(&self, value: &Value) -> Option<ReadableStream> {
        if let Some(js_ref) = self.js_ref() {
            if let Some(stream) = Self::stream_get_cached(js_ref) {
                // JS is always source of truth for the stream
                return ReadableStream::from_js_direct(stream);
            }
        }
        if let Value::Locked(locked) = value {
            return locked.readable.get();
        }
        None
    }

    /// Clear both the JS-side cache and the
    /// native `Locked.readable` strong ref.
    fn detach_readable_stream(&self, global_object: &JSGlobalObject) {
        if let Some(js_ref) = self.js_ref() {
            Self::stream_set_cached(js_ref, global_object, JSValue::ZERO);
        }
        self.body_value().with_mut(|value| {
            if let Value::Locked(locked) = value {
                // `mem::take` swaps in `Default` and drops the old value.
                let _ = core::mem::take(&mut locked.readable);
            }
        });
    }

    /// Migrate any `Locked.readable` strong ref
    /// into the GC-traced `js.gc.stream` slot to break the cycle (the JS
    /// wrapper owns the stream; native side must not hold it strongly).
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        if let Some(js_value) = self.js_ref() {
            self.body_value().with_mut(|value| {
                if let Value::Locked(locked) = value {
                    if let Some(stream) = locked.readable.get() {
                        stream.value.ensure_still_alive();
                        Self::stream_set_cached(js_value, global_object, stream.value);
                        locked.readable.downgrade(global_object);
                    }
                }
            });
        }
    }

    /// Shared tail of `do_clone`: after the clone's `to_js` ran
    /// `check_body_stream_ref`, sync both wrappers' cached `body` slots to
    /// their respective teed streams, then migrate the original's
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
        if let Value::Locked(locked) = self.body_value().get() {
            if let Some(readable) = locked.readable.get() {
                Self::body_set_cached(this_value, global_this, readable.value);
            }
        }
        self.check_body_stream_ref(global_this);
    }

    /// Shared body-clone for `clone_into` / `clone_value`: tee through the
    /// JS-side cached stream when present, then repoint this owner's
    /// `body`/`stream` cache slots at the fresh branch in `locked.readable`.
    fn clone_body_value_via_cached_stream(&self, global_this: &JSGlobalObject) -> JsResult<Value> {
        let cloned = self.body_value().with_mut(|value| {
            if let Some(js_ref) = self.js_ref() {
                if let Some(stream) = Self::stream_get_cached(js_ref) {
                    let mut readable = ReadableStream::from_js_direct(stream);
                    if let Some(r) = readable.as_mut() {
                        return value.clone_with_readable_stream(global_this, Some(r));
                    }
                }
            }
            value.clone(global_this)
        })?;
        if let Some(js_ref) = self.js_ref() {
            if let Value::Locked(locked) = self.body_value().get() {
                if let Some(readable) = locked.readable.get() {
                    Self::body_set_cached(js_ref, global_this, readable.value);
                }
            }
        }
        self.check_body_stream_ref(global_this);
        Ok(cloned)
    }

    fn get_text(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.body_value()
            .with_mut(|value| {
                if let Some(early) =
                    self.pending_body_read(value, global_object, callframe.this(), false, || {
                        Action::GetText
                    })?
                {
                    return Ok(early);
                }
                let mut blob = value.use_as_any_blob_allow_non_utf8_string();
                let result =
                    JSPromise::wrap(global_object, |g| blob.to_string(g, Lifetime::Transfer));
                blob.detach();
                result.map(BodyRead::Settled)
            })?
            .finish(global_object)
    }

    fn get_body(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let stream = self.body_value().with_mut(|body| {
            if matches!(body, Value::Used) {
                return ReadableStream::used(global_this).map(Err);
            }
            if matches!(body, Value::Locked(_)) {
                if let Some(readable) = self.readable_stream_of(body) {
                    return Ok(Err(readable.value));
                }
            }
            body.to_readable_stream(global_this).map(Ok)
        })?;
        let stream = match stream {
            Ok(created) => created,
            Err(existing) => return Ok(existing),
        };
        // The wrapper's traced `m_stream` slot owns the stream from here;
        // release the `Strong` `to_readable_stream` parked in `Locked.readable`.
        self.check_body_stream_ref(global_this);
        Ok(stream)
    }

    /// <https://fetch.spec.whatwg.org/#dom-body-textstream>
    fn get_text_stream(
        &self,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Step 1: If this is unusable, throw a TypeError.
        self.throw_if_body_unusable(global_this)?;

        // A `Locked` body whose stream is already materialized (user-provided
        // ReadableStream, or `.body` was accessed first) is decoded via a reader
        // on that existing stream.
        if matches!(self.body_value().get(), Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream() {
                let text = ReadableStream::text_decode_from(global_this, readable.value)?;
                self.detach_readable_stream(global_this);
                self.body_value().set(Value::Used);
                return Ok(text);
            }
        }

        // Step 2: null body → a new empty closed ReadableStream.
        // Steps 3-6: decode directly from the body's backing bytes.
        let stream = self
            .body_value()
            .with_mut(|value| value.to_text_readable_stream(global_this))?;
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
        match self.body_value().get() {
            Value::Used => true,
            Value::Locked(pending) if !pending.action.is_none() => true,
            value @ Value::Locked(pending) => {
                if let Some(readable) = self.readable_stream_of(value) {
                    return check(&readable, global_object);
                }
                if let Some(stream) = pending.readable.get() {
                    return check(&stream, global_object);
                }
                false
            }
            _ => false,
        }
    }

    fn get_body_used(&self, global_object: &JSGlobalObject) -> JSValue {
        JSValue::from(self.body_stream_check(global_object, ReadableStream::is_disturbed))
    }

    /// Fetch spec step 1 of both `clone()` algorithms: throw a `TypeError`
    /// when "this is unusable", i.e. the body is non-null and its stream is
    /// disturbed or locked. <https://fetch.spec.whatwg.org/#body-unusable>
    fn throw_if_body_unusable(&self, global_object: &JSGlobalObject) -> JsResult<()> {
        let unusable =
            self.body_stream_check(global_object, |s, g| s.is_disturbed(g) || s.is_locked(g));
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

    /// Front half of `text()` / `json()` / `arrayBuffer()` / `bytes()`,
    /// run inside the body borrow: reject a used or failed body, or commit a
    /// still-streaming one to `action` (its script half comes back as
    /// [`BodyRead::Locked`]). `None`: the body is buffered — read it out.
    #[inline(always)]
    fn pending_body_read(
        &self,
        value: &mut Value,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        to_blob_if_possible: bool,
        action: fn() -> Action,
    ) -> JsResult<Option<BodyRead>> {
        if matches!(value, Value::Used) {
            return Ok(Some(BodyRead::Settled(handle_body_already_used(
                global_object,
            ))));
        }
        if let Some(rejected) = handle_body_error(value, global_object) {
            return Ok(Some(BodyRead::Settled(rejected)));
        }

        if matches!(value, Value::Locked(_)) {
            if let Some(readable) = self.readable_stream_of(value) {
                if readable.is_disturbed(global_object) {
                    return Ok(Some(BodyRead::Settled(handle_body_already_used(
                        global_object,
                    ))));
                }
                if to_blob_if_possible {
                    value.to_blob_if_possible();
                }
                if let Value::Locked(locked) = value {
                    return locked
                        .set_promise(global_object, action(), Some(readable))
                        .map(|r| Some(BodyRead::Locked(r)));
                }
            }
            if let Value::Locked(locked) = value {
                if !locked.action.is_none()
                    || locked.is_disturbed::<Self>(global_object, this_value)
                {
                    return Ok(Some(BodyRead::Settled(handle_body_already_used(
                        global_object,
                    ))));
                }
                if to_blob_if_possible {
                    value.to_blob_if_possible();
                }
                if let Value::Locked(locked) = value {
                    return locked
                        .set_promise(global_object, action(), None)
                        .map(|r| Some(BodyRead::Locked(r)));
                }
            }
        }
        Ok(None)
    }

    fn get_json(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.body_value()
            .with_mut(|value| {
                if let Some(early) =
                    self.pending_body_read(value, global_object, callframe.this(), true, || {
                        Action::GetJSON
                    })?
                {
                    return Ok(early);
                }
                let mut blob = value.use_as_any_blob_allow_non_utf8_string();
                let result = JSPromise::wrap(global_object, |g| blob.to_json(g, Lifetime::Share));
                blob.detach();
                result.map(BodyRead::Settled)
            })?
            .finish(global_object)
    }

    fn get_array_buffer(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_core::scoped_log!(BodyMixin, "getArrayBuffer");
        self.body_value()
            .with_mut(|value| {
                if let Some(early) =
                    self.pending_body_read(value, global_object, callframe.this(), true, || {
                        Action::GetArrayBuffer
                    })?
                {
                    return Ok(early);
                }
                // toArrayBuffer in AnyBlob checks for non-UTF8 strings
                let mut blob: AnyBlob = value.use_as_any_blob_allow_non_utf8_string();
                let result = JSPromise::wrap(global_object, |g| {
                    blob.to_array_buffer(g, Lifetime::Transfer)
                });
                blob.detach();
                result.map(BodyRead::Settled)
            })?
            .finish(global_object)
    }

    fn get_bytes(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.body_value()
            .with_mut(|value| {
                if let Some(early) =
                    self.pending_body_read(value, global_object, callframe.this(), true, || {
                        Action::GetBytes
                    })?
                {
                    return Ok(early);
                }
                // toArrayBuffer in AnyBlob checks for non-UTF8 strings
                let mut blob: AnyBlob = value.use_as_any_blob_allow_non_utf8_string();
                let result = JSPromise::wrap(global_object, |g| {
                    blob.to_uint8_array(g, Lifetime::Transfer)
                });
                blob.detach();
                result.map(BodyRead::Settled)
            })?
            .finish(global_object)
    }

    fn get_form_data(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if let Some(settled) = self.body_value().with_mut(|value| {
            if matches!(value, Value::Used) {
                return Some(handle_body_already_used(global_object));
            }
            if let Some(rejected) = handle_body_error(value, global_object) {
                return Some(rejected);
            }

            if matches!(value, Value::Locked(_)) {
                if let Some(readable) = self.readable_stream_of(value) {
                    if readable.is_disturbed(global_object) {
                        return Some(handle_body_already_used(global_object));
                    }
                    value.to_blob_if_possible();
                    let _ = readable; // not consumed in this branch
                }
                if let Value::Locked(locked) = value {
                    if !locked.action.is_none()
                        || locked.is_disturbed::<Self>(global_object, callframe.this())
                    {
                        return Some(handle_body_already_used(global_object));
                    }
                    value.to_blob_if_possible();
                }
            }
            None
        }) {
            return Ok(settled);
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

        let (mut blob, encoder) = match self.body_value().with_mut(|value| {
            if let Value::Locked(_) = value {
                let owned_readable = self.readable_stream_of(value);
                let Value::Locked(locked) = value else {
                    unreachable!()
                };
                return locked
                    .set_promise(
                        global_object,
                        Action::GetFormData(Some(encoder)),
                        owned_readable,
                    )
                    .map(Ok);
            }
            Ok(Err((value.use_as_any_blob(), encoder)))
        })? {
            Ok(read) => return read.run(global_object),
            Err(buffered) => buffered,
        };
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
                Err(err) => {
                    blob.detach();
                    return Ok(global_object
                        .err(
                            jsc::ErrorCode::FORMDATA_PARSE_ERROR,
                            format_args!("FormData parse error {}", err.name()),
                        )
                        .reject());
                }
            };
        blob.detach();

        Ok(JSPromise::wrap_value(global_object, js_value))
    }

    fn get_blob(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.get_blob_with_this_value(global_object, callframe.this())
    }

    fn get_blob_with_this_value(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        self.body_value()
            .with_mut(|value| {
                if matches!(value, Value::Used) {
                    return Ok(BodyRead::Settled(handle_body_already_used(global_object)));
                }
                if let Some(rejected) = handle_body_error(value, global_object) {
                    return Ok(BodyRead::Settled(rejected));
                }

                if matches!(value, Value::Locked(_)) {
                    if let Some(readable) = self.readable_stream_of(value) {
                        let Value::Locked(locked) = &*value else {
                            unreachable!()
                        };
                        if !locked.action.is_none()
                            || ((!this_value.is_empty() && readable.is_disturbed(global_object))
                                || (this_value.is_empty() && readable.is_disturbed(global_object)))
                        {
                            return Ok(BodyRead::Settled(handle_body_already_used(global_object)));
                        }
                        value.to_blob_if_possible();
                        if let Value::Locked(locked) = value {
                            return locked
                                .set_promise(global_object, Action::GetBlob, Some(readable))
                                .map(BodyRead::Locked);
                        }
                    }
                    if let Value::Locked(locked) = &*value {
                        if !locked.action.is_none()
                            || ((!this_value.is_empty()
                                && locked.is_disturbed::<Self>(global_object, this_value))
                                || (this_value.is_empty()
                                    && locked.readable.is_disturbed(global_object)))
                        {
                            return Ok(BodyRead::Settled(handle_body_already_used(global_object)));
                        }
                        value.to_blob_if_possible();
                        if let Value::Locked(locked) = value {
                            return locked
                                .set_promise(global_object, Action::GetBlob, None)
                                .map(BodyRead::Locked);
                        }
                    }
                }

                let blob_owned = value.use_();
                let blob = &blob_owned;
                if blob.content_type().is_empty() {
                    if let Some(fetch_headers) = BodyMixin::get_fetch_headers(self) {
                        // `fetch_headers` is a live C++ FetchHeaders handle;
                        // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
                        let fetch_headers = bun_opaque::opaque_deref_mut(fetch_headers.as_ptr());
                        if let Some(content_type) =
                            fetch_headers.fast_get(HTTPHeaderName::ContentType)
                        {
                            let content_slice = content_type.to_utf8();
                            let mime_type = MimeType::init(content_slice.slice(), true, None);
                            set_blob_content_type(blob, mime_type);
                            // content_slice dropped (replaces defer content_slice.deinit())
                        }
                    }
                    if !blob.content_type_was_set.get() && blob.store.get().is_some() {
                        set_blob_content_type(blob, bun_http_types::MimeType::TEXT);
                    }
                }
                Ok(BodyRead::Settled(JSPromise::resolved_promise_value(
                    global_object,
                    blob_owned.to_js(global_object),
                )))
            })?
            .finish(global_object)
    }

    fn get_blob_without_call_frame(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.get_blob_with_this_value(global_object, JSValue::ZERO)
    }
}

/// Outcome of the borrow-scoped half of a `BodyMixin` read.
pub(crate) enum BodyRead {
    /// Settled inside the borrow (used / errored / disturbed / buffered): the promise.
    Settled(JSValue),
    /// Still streaming: run this once the borrow is released.
    Locked(LockedRead),
}

impl BodyRead {
    #[inline(always)]
    fn finish(self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            BodyRead::Settled(value) => Ok(value),
            BodyRead::Locked(read) => read.run(global_object),
        }
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

/// If the body already failed, reject the read with that error. Every body
/// reader must call this before its `Locked` handling: `Value::Error` would
/// otherwise fall through to `use_as_any_blob_*` and resolve empty.
fn handle_body_error(value: &mut Value, global_object: &JSGlobalObject) -> Option<JSValue> {
    let Value::Error(err) = value else {
        return None;
    };
    let js = err.to_js(global_object);
    *value = Value::Used;
    Some(JSPromise::rejected_promise(global_object, js).to_js())
}
