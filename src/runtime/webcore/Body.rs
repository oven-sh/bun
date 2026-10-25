//! https://developer.mozilla.org/en-US/docs/Web/API/Body

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::webcore::blob::BodyFacts;
use crate::webcore::jsc::{
    self as jsc, CommonAbortReason, CommonAbortReasonExt as _, DOMFormData, JSGlobalObject,
    JSPromise, JSValue, JsResult, SystemError, URLSearchParams, VirtualMachine,
};
use crate::webcore::{
    self, AnyBlob, Blob, BlobExt as _, ByteStream, DrainResult, FetchHeaders, Lifetime,
    ReadableStream, blob, streams,
};
use bun_core::Output;
use bun_http_types::MimeType::MimeType;
// Re-export so callers can write `body::InternalBlob`.
use crate::jsc::HTTPHeaderName;
pub(crate) use crate::webcore::InternalBlob;
use bun_core::String as BunString;
use bun_core::{Utf8Bytes, WTFString, WTFStringImpl, WTFStringImplExt as _, WTFStringImplStruct};
use bun_jsc::JsCell;
use bun_jsc::StringJsc as _;
use bun_jsc::SysErrorJsc as _;
use bun_jsc::bindgen::JsScope;
use bun_jsc::bun_string_jsc;

/// Deref the `Value::WTFStringImpl` payload.
///
/// # Safety (encapsulated)
/// `Value::WTFStringImpl` always stores a non-null `*mut WTF::StringImpl`
/// (constructed via `String::leak_wtf_impl()` / `r#ref()`); the body holds a
/// +1 intrusive ref for as long as the variant is active, so the pointee is
/// live for any borrow tied to `&s`. All `WTFStringImplStruct` methods take
/// `&self` (refcount lives in a `Cell`), so a shared borrow suffices even for
/// `r#ref()` / `deref()`.
#[inline(always)]
fn wtf_impl(s: &WTFStringImpl) -> &WTFStringImplStruct {
    // SAFETY: see fn doc — non-null, intrusive-refcounted, live while held.
    unsafe { &**s }
}

// ────────────────────────────────────────────────────────────────────────────
// Local shims for upstream-gated `JsClass` impls / `AnyPromise` methods.
// These adapt call sites in this file without editing `bun_jsc` (orphan rule).
// ────────────────────────────────────────────────────────────────────────────

#[inline]
fn as_dom_form_data(value: JSValue) -> Option<*mut DOMFormData> {
    // `DOMFormData` is an opaque C++ type that does not implement `JsClass`;
    // route through the hand-written `from_js` (`DOMFormData.rs`) instead of
    // `value.as_::<DOMFormData>()`.
    DOMFormData::from_js(value).map(std::ptr::from_mut::<DOMFormData>)
}
#[inline]
fn as_url_search_params(value: JSValue) -> Option<*mut URLSearchParams> {
    // See `as_dom_form_data` — opaque C++ type, hand-written `from_js`.
    URLSearchParams::from_js(value).map(|p| p.as_ptr())
}

bun_core::declare_scope!(BodyValue, visible);

// R-2 (host-fn re-entrancy): `Body` is embedded inline in JS-exposed
// `Response` (and aliased via `HiveRef` in `Request`). Every BodyMixin host
// fn takes `&self` and projects `&mut Value` through this `JsCell`; the
// `UnsafeCell` inside suppresses LLVM `noalias` on `&Body` so a re-entrant
// host call cannot stack two `&mut` to the same field.
#[repr(C)]
pub(crate) struct Body {
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

    /// R-2 interior-mutability projection: `&self` → `&mut Value`.
    /// Single-JS-thread invariant (see `JsCell`) makes this sound; keep the
    /// returned borrow short and do not hold it across a call that re-enters
    /// JS and may touch this same body.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn value_mut(&self) -> &mut Value {
        // SAFETY: single-JS-thread invariant — `Body` lives inside a
        // `Request`/`Response` JSC heap cell; concurrent access is impossible
        // and re-entrant host fns each form a fresh short-lived borrow.
        unsafe { self.value.get_mut() }
    }

    pub(crate) fn known_len(&self) -> Option<usize> {
        self.value_mut().known_size()
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

        match self.value_mut() {
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
                    Value::WTFStringImpl(s) => wtf_impl(s).utf8_byte_length(),
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
    pub(crate) fn reset(&self) {
        self.value_mut().reset();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PendingValue
// ────────────────────────────────────────────────────────────────────────────

pub struct PendingValue {
    pub(crate) promise: Option<JSValue>,
    pub(crate) readable: webcore::readable_stream::Strong,
    // writable: webcore::Sink

    // A raw pointer: `Value::Locked` lives in the heap payload of a Request/Response.
    pub global: *const JSGlobalObject,
    pub task: Option<NonNull<c_void>>,

    /// runs after the data is available.
    pub(crate) on_receive_value: Option<fn(ctx: NonNull<c_void>, value: &mut Value)>,

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
    pub(crate) facts: BodyFacts,
    /// The `Content-Type` this body implied before it became a stream. A stream passed in as a body implies none.
    pub(crate) content_type: blob::BlobContentType,

    pub(crate) deinit: bool,
    pub(crate) action: Action,
}

// `Value` is pooled, and `ValueError` is its largest arm in a release build.
const _: () = assert!(size_of::<PendingValue>() < size_of::<ValueError>());

impl PendingValue {
    pub(crate) fn new(global: &JSGlobalObject) -> Self {
        Self {
            global: std::ptr::from_ref(global),
            ..Default::default()
        }
    }

    fn from_stream(readable: ReadableStream, global: &JSGlobalObject) -> Self {
        Self {
            readable: webcore::readable_stream::Strong::init(readable, global),
            facts: readable.body_facts(),
            ..Self::new(global)
        }
    }

    /// The clone's body: the other branch of a tee of this body's stream.
    fn tee_branch(&self, readable: ReadableStream, global: &JSGlobalObject) -> Value {
        Value::Locked(Self {
            content_type: self.content_type.clone(),
            ..Self::from_stream(readable, global)
        })
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
            facts: BodyFacts::empty(),
            content_type: blob::BlobContentType::default(),
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
        if self.on_receive_value.is_none() {
            // A registered `on_receive_value` means `task` is the consumer's
            // ctx (overwriting the producer), read by `resolve()`.
            self.task = None;
        }
        self.producer = streams::SourceHandle::None;
    }

    /// `.text()` and friends, `Bun.write`, or a server's render-wait already reads this body.
    pub(crate) fn has_consumer(&self) -> bool {
        self.promise.is_some() || !self.action.is_none() || self.on_receive_value.is_some()
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
            // BACKREF: see `Source::bytes()` — payload live while the
            // ReadableStream JS wrapper (rooted via `self.readable`) is alive.
            if let Some(bytes) = readable.ptr.bytes() {
                return bytes.size_hint.get();
            }
        }
        self.size_hint
    }

    /// Lifts the whole payload out of a stream that nothing has read.
    fn to_any_blob(&mut self) -> Option<AnyBlob> {
        let blob = self.readable.get()?.to_any_blob(self.global())?;
        self.readable.deinit();
        Some(blob)
    }

    /// [`Self::to_any_blob`] for `clone()`, going through the wrapper's cached `.body` when there is one.
    fn take_blob_from_unread_stream(
        &mut self,
        global: &JSGlobalObject,
        cached: Option<ReadableStream>,
    ) -> Option<AnyBlob> {
        let mut stream = cached.or_else(|| self.readable.get())?;
        // Two Blobs over a pipe, a tty, or any fd would compete for its bytes,
        // so a stream over such a file stays teed.
        if let Some(reader) = stream.ptr.file() {
            let webcore::file_reader::Lazy::Blob(store) = reader.lazy.get() else {
                return None;
            };
            if !blob::store_reads_repeatably(store) {
                return None;
            }
        }
        let blob = stream.to_any_blob(global)?;
        self.readable.deinit();
        Some(blob)
    }

    fn set_promise(
        &mut self,
        global_this: &JSGlobalObject,
        action: Action,
        owned_readable: Option<ReadableStream>,
    ) -> JsResult<JSValue> {
        self.action = action;
        if let Some(readable) = owned_readable.or_else(|| self.readable.get()) {
            let promise = match &mut self.action {
                Action::GetJSON => global_this.readable_stream_to_json(readable.value),
                Action::GetArrayBuffer => {
                    global_this.readable_stream_to_array_buffer(readable.value)
                }
                Action::GetBytes => global_this.readable_stream_to_bytes(readable.value),
                Action::GetText => global_this.readable_stream_to_text(readable.value),
                Action::GetBlob => global_this.readable_stream_to_body_blob(
                    readable.value,
                    bun_string_jsc::create_utf8_for_js(global_this, self.content_type.as_slice())?,
                ),
                Action::GetFormData(encoding) => {
                    let boundary = match *encoding.take().unwrap() {
                        webcore::form_data::Encoding::Multipart(boundary) => {
                            bun_string_jsc::create_utf8_for_js(global_this, &boundary)?
                        }
                        webcore::form_data::Encoding::URLEncoded => JSValue::UNDEFINED,
                    };
                    global_this.readable_stream_to_form_data(readable.value, boundary)
                }
                Action::None => unreachable!(),
            };
            self.readable.deinit();
            if promise.is_ok() {
                // The consumer holds its reader now; keep the lock once it lets go.
                readable.mark_consumed_as_body(global_this);
            }
            // Don't protect() this promise: the stream keeps it alive, and nothing would unprotect it (#13678).
            return promise;
        }

        {
            let promise = JSPromise::create(global_this);
            let promise_value = promise.to_js();
            self.promise = Some(promise_value);
            promise_value.protect();

            if let Some(on_start_buffering) = self.on_start_buffering.take() {
                // Last use of `self`: the producer may settle the body (and so
                // replace `*self`) before this returns.
                let task = self.task.unwrap();
                on_start_buffering(task);
            }
            Ok(promise_value)
        }
    }
}

pub(crate) enum Action {
    None,
    GetText,
    GetJSON,
    GetArrayBuffer,
    GetBytes,
    GetBlob,
    /// `read_body` fills it in from the owner's `Content-Type`.
    GetFormData(Option<Box<webcore::form_data::Encoding>>),
}

impl Action {
    pub(crate) fn is_none(&self) -> bool {
        matches!(self, Action::None)
    }

    /// Turns the whole body into what the reader asked for. `content_type` is the owner's, for `blob()`.
    fn convert(
        &mut self,
        body: &mut Value,
        content_type: blob::BlobContentType,
        cx: &bun_jsc::JsThread<'_>,
    ) -> JsResult<JSValue> {
        if let Action::GetBlob = self {
            let blob_ptr = Blob::new(body.use_());
            // SAFETY: `Blob::new` returns a freshly heap-allocated, ref-counted Blob.
            let blob = unsafe { &*blob_ptr };
            set_type_of_body_blob(blob, content_type, true);
            return Ok(blob.to_js(cx.global()));
        }

        let mut blob = match self {
            // The parser needs UTF-8.
            Action::GetFormData(_) => body.use_as_any_blob(),
            _ => body.use_as_any_blob_allow_non_utf8_string(),
        };
        let result = match self {
            Action::GetText => blob.to_string(cx, Lifetime::Transfer),
            Action::GetJSON => blob.to_json(cx, Lifetime::Share),
            Action::GetArrayBuffer => blob.to_array_buffer(cx, Lifetime::Transfer),
            Action::GetBytes => blob.to_uint8_array(cx, Lifetime::Transfer),
            Action::GetFormData(encoding) => {
                let encoding = encoding.take().expect("read_body sets the encoding");
                webcore::form_data::FormData::to_js(cx.global(), blob.slice(), &encoding)
            }
            Action::None | Action::GetBlob => unreachable!(),
        };
        blob.detach();
        result
    }
}

/// `blob()`: the bytes keep their own type. Without one they get the owner's `content_type`, or else text/plain.
fn set_type_of_body_blob(blob: &Blob, content_type: blob::BlobContentType, or_else_text: bool) {
    if !blob.content_type().is_empty() {
        return;
    }
    let content_type = if content_type.is_empty() && or_else_text && blob.store.get().is_some() {
        bun_http_types::MimeType::TEXT.into()
    } else {
        content_type
    };
    blob.content_type_was_set.set(!content_type.is_empty());
    blob.content_type.set(content_type);
}

/// What [`Action::convert`] does for `blob()`, for the Blob that a stream's bytes were collected into.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Body__finishBlobOfStream(
    global: &JSGlobalObject,
    blob: JSValue,
    content_type: JSValue,
    facts: u8,
) {
    let Some(blob) = blob.as_class_ref::<Blob>() else {
        return;
    };
    // An exception stays pending for the caller.
    let Ok(content_type) = content_type.to_utf8(global) else {
        return;
    };
    let facts = BodyFacts::from_bits_truncate(facts);
    blob.body_facts.set(facts);
    // What comes out of the program's own stream has no type unless the program gave it one.
    set_type_of_body_blob(
        blob,
        blob::BlobContentType::Owned(content_type.slice().into()),
        facts.contains(BodyFacts::NATIVE_STREAM),
    );
}

/// Per-class codegen'd cached-slot accessors for the `body` and `stream`
/// JS-side properties, plus the weak `JsRef` back-pointer. Both `Request` and
/// `Response` forward these 1:1 to `js_Request` / `js_Response`.
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
    // `bun_core::WTFStringImpl` = `*mut WTFStringImplStruct` — a Copy raw
    // pointer to an *intrusively* refcounted WTF::StringImpl. We hold the +1 directly
    // (no Arc) and ref/deref explicitly at fixed points (from_js / clone /
    // use_ / to_blob_if_possible / reset / use_as_any_blob*).
    WTFStringImpl(WTFStringImpl),
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
pub(crate) type HiveRef = bun_collections::HiveRef<Value, POOL_SIZE>;
pub(crate) type HiveAllocator = bun_collections::hive_array::Fallback<HiveRef, POOL_SIZE>;
pub(crate) type BodyHiveHandle = bun_collections::HiveRefHandle<Value, POOL_SIZE>;

/// Moves `value` into a pooled `HiveRef` slot and returns an owning handle
/// (ref_count = 1).
pub(crate) fn hive_alloc(value: Value) -> BodyHiveHandle {
    let state = crate::jsc_hooks::runtime_state();
    debug_assert!(!state.is_null(), "hive_alloc before init_runtime_state");
    // SAFETY: `state` is the live boxed RuntimeState; `body_value_pool` is a
    // heap-stable `Box<HiveAllocator>` for the VM lifetime.
    let pool = unsafe { &raw const **(*state).body_value_pool };
    // SAFETY: `pool` outlives every handle (process lifetime).
    unsafe { BodyHiveHandle::new(value, pool) }
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
    /// `Value::drop` releases the string's ref that `into_raw` hands over.
    fn from(blob: AnyBlob) -> Value {
        match blob {
            AnyBlob::Blob(b) => Value::Blob(b),
            AnyBlob::InternalBlob(b) => Value::InternalBlob(b),
            AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(s.into_raw()),
        }
    }
}

impl Value {
    /// Downcast a `JSValue` to the `Body.Value` it owns, if any.
    ///
    /// `Body.Value` is not itself a JS class — it lives inside a `Request` or
    /// `Response` wrapper — so the generic `JSValue::as_::<T: JsClass>()` path
    /// cannot be used. Instead, try both wrapper classes and return the inner
    /// body pointer.
    ///
    /// Returns a raw pointer; the storage is owned
    /// by the JSC heap cell and outlives the call only as long as `value` is
    /// kept alive by the caller.
    pub(crate) fn from_request_or_response(value: JSValue) -> Option<*mut Value> {
        if !value.is_cell() || value.js_type() != jsc::JSType::DOMWrapper {
            return None;
        }
        if let Some(req) = value.as_class_ref::<crate::webcore::Request>() {
            return Some(std::ptr::from_mut::<Value>(req.get_body_value()));
        }
        if let Some(res) = value.as_class_ref::<crate::webcore::Response>() {
            return Some(std::ptr::from_mut::<Value>(res.get_body_value()));
        }
        None
    }

    pub(crate) fn facts(&self) -> BodyFacts {
        match self {
            Value::Blob(blob) => blob.body_facts.get(),
            Value::InternalBlob(blob) => blob.facts,
            Value::WTFStringImpl(_) => BodyFacts::STRING,
            Value::Locked(locked) => locked.facts,
            _ => BodyFacts::empty(),
        }
    }

    /// The `Content-Type` this body implies: what its owner's header list has if nothing else set one.
    pub(crate) fn content_type(&self) -> &blob::BlobContentType {
        static NONE: blob::BlobContentType = blob::BlobContentType::Static(b"");
        match self {
            Value::Blob(blob) => blob.content_type.get(),
            Value::Locked(locked) => &locked.content_type,
            _ => &NONE,
        }
    }

    /// Fetch's "extract a body": the type goes in the header list unless the list has one.
    pub(crate) fn put_content_type_default(
        &self,
        headers: &mut FetchHeaders,
        global_this: &JSGlobalObject,
    ) -> JsResult<()> {
        let content_type = self.content_type();
        if content_type.is_empty() {
            return Ok(());
        }
        headers.put_default(
            HTTPHeaderName::ContentType,
            &BunString::ascii(content_type.as_slice()),
            global_this,
        )
    }

    /// Replaces a stream that nothing has read with the bytes lifted out of it. They keep the type this body implied.
    fn replace_stream_with(&mut self, bytes: AnyBlob) {
        let content_type = match self {
            Value::Locked(locked) => core::mem::take(&mut locked.content_type),
            _ => blob::BlobContentType::default(),
        };
        *self = Value::from(bytes);
        self.keep_content_type(content_type);
    }

    /// Gives the bytes that replaced a pending body the type which that body implied.
    fn keep_content_type(&mut self, content_type: blob::BlobContentType) {
        if content_type.is_empty() || content_type.as_slice() == self.content_type().as_slice() {
            return;
        }
        if let Value::InternalBlob(internal) = self {
            *self = Value::Blob(internal.to_blob(VirtualMachine::get().global()));
        }
        if let Value::Blob(blob) = self {
            blob.content_type.set(content_type);
            blob.content_type_was_set.set(true);
        }
    }
}

impl Value {
    pub(crate) fn to_blob_if_possible(&mut self) {
        if let Value::WTFStringImpl(str) = *self {
            if let Utf8Bytes::Owned(bytes) = wtf_impl(&str).to_utf8() {
                // The UTF-8 buffer is already heap-owned by the slice wrapper;
                // transfer it (no copy). The deref is handled by `Value::drop` on the
                // overwritten `WTFStringImpl` variant — do NOT deref explicitly here.
                *self = Value::InternalBlob(InternalBlob::from_string_bytes(bytes));
            }
        }

        self.lift_unread_stream();
    }

    /// A stream that nothing has read, and whose bytes are all at hand, goes back to being those bytes.
    pub(crate) fn lift_unread_stream(&mut self) {
        let Value::Locked(locked) = self else {
            return;
        };
        if let Some(blob) = locked.to_any_blob() {
            self.replace_stream_with(blob);
        }
    }

    /// [`Self::to_blob_if_possible`], except a file-backed stream keeps streaming (a FIFO has no length).
    pub(crate) fn to_blob_if_in_memory(&mut self) {
        let Value::Locked(locked) = self else {
            return;
        };
        let file_backed = locked
            .readable
            .get()
            .is_some_and(|r| matches!(r.ptr, webcore::readable_stream::Source::File(_)));
        if !file_backed {
            self.to_blob_if_possible();
        }
    }

    pub(crate) fn size(&mut self) -> blob::SizeType {
        match self {
            Value::Blob(b) => b.get_size_for_bindings() as blob::SizeType,
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => wtf_impl(s).utf8_byte_length() as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            _ => 0,
        }
    }

    /// `None` for a file that does not exist or is not seekable.
    pub(crate) fn known_size(&mut self) -> Option<usize> {
        match self.size() {
            u64::MAX => None,
            size => Some(size as usize),
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.memory_cost(),
            Value::WTFStringImpl(s) => wtf_impl(s).memory_cost(),
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
            Value::WTFStringImpl(s) => wtf_impl(s).byte_slice().len(),
            // See memory_cost(): size_hint is anticipated, not allocated.
            Value::Locked(_) => 0,
            _ => 0,
        }
    }

    // pub const empty = Value::Empty;

    pub(crate) fn to_readable_stream(&mut self, cx: &bun_jsc::JsThread<'_>) -> JsResult<JSValue> {
        jsc::mark_binding();

        let content_type = self.content_type().clone();
        // From here on the stream is the body: `.body`, `bodyUsed` and every reader go through it.
        let stream = match self {
            Value::Used => return ReadableStream::used(cx.global()),
            Value::Null => return Ok(JSValue::NULL),
            Value::Locked(locked) => {
                if let Some(readable) = locked.readable.get() {
                    return Ok(readable.value);
                }
                return self.locked_to_native_stream(cx, false);
            }
            Value::Empty => ReadableStream::empty(cx.global())?,
            Value::InternalBlob(_) | Value::Blob(_) | Value::WTFStringImpl(_) => {
                // `deinit` must run on every exit incl. `?` paths.
                let blob = scopeguard::guard(self.use_(), |mut b| b.deinit());
                let blob_size = blob.resolve_size();
                ReadableStream::from_blob_copy_ref(cx, &blob, blob_size)?
            }
            Value::Error(err) => {
                let reason = err.to_js(cx.global());
                ReadableStream::errored(cx.global(), reason)?
            }
        };
        *self = Value::Locked(PendingValue {
            content_type,
            ..PendingValue::from_stream(
                ReadableStream::from_js_direct(stream).unwrap(),
                cx.global(),
            )
        });
        Ok(stream)
    }

    /// `Body.textStream()`: a `ReadableStream<string>` of the body's UTF-8
    /// content, decoded directly from the body's backing bytes without
    /// materializing a separate byte `ReadableStream` for native-backed bodies.
    /// Returns `NULL` for `Null` (caller substitutes an empty stream).
    pub(crate) fn to_text_readable_stream(
        &mut self,
        cx: &bun_jsc::JsThread<'_>,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();

        match self {
            Value::Used => ReadableStream::used(cx.global()),
            Value::Null => Ok(JSValue::NULL),
            Value::Empty => {
                *self = Value::Used;
                ReadableStream::empty(cx.global())
            }
            Value::InternalBlob(_) | Value::WTFStringImpl(_) => {
                let mut blob = self.use_as_any_blob_allow_non_utf8_string();
                let string = blob.to_string(cx, Lifetime::Transfer);
                blob.detach();
                ReadableStream::from_decoded_text(cx.global(), string?)
            }
            Value::Blob(_) => {
                let stream = {
                    let blob = scopeguard::guard(self.use_(), |mut b| b.deinit());
                    let blob_size = blob.resolve_size();
                    if blob.needs_to_read_file() || blob.is_s3() {
                        let bytes = ReadableStream::from_blob_copy_ref(cx, &blob, blob_size)?;
                        ReadableStream::text_decode_from(cx.global(), bytes)?
                    } else {
                        let string = blob.to_string(cx, Lifetime::Transfer)?;
                        ReadableStream::from_decoded_text(cx.global(), string)?
                    }
                };
                *self = Value::Used;
                Ok(stream)
            }
            Value::Locked(_) => self.locked_to_native_stream(cx, true),
            Value::Error(err) => {
                let reason = err.to_js(cx.global());
                let stream = ReadableStream::errored(cx.global(), reason)?;
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
        cx: &bun_jsc::JsThread<'_>,
        text_mode: bool,
    ) -> JsResult<JSValue> {
        let Value::Locked(locked) = self else {
            unreachable!("locked_to_native_stream on non-Locked Value");
        };
        // A registered `on_receive_value` means a native consumer (Bun.write,
        // the server's render-wait) owns this body and has retargeted `task`
        // to its own context; materializing a stream here would dispatch the
        // producer's remaining callbacks with that foreign context.
        if locked.has_consumer() {
            return ReadableStream::in_use(cx.global());
        }
        let mut drain_result = DrainResult::EstimatedSize(0);

        if let Some(drain) = locked.on_start_streaming.take() {
            drain_result = drain(locked.task.unwrap());
        }

        if matches!(drain_result, DrainResult::Aborted) {
            *self = Value::Null;
            return ReadableStream::empty(cx.global());
        }

        // `new_mut` centralises the post-allocation deref; ownership of the
        // heap `NewSource` transfers to the JS wrapper in
        // `to_readable_stream()` below (freed by the GC finalizer).
        let reader = webcore::readable_stream::NewSource::<ByteStream>::new_mut(
            webcore::readable_stream::NewSource {
                context: ByteStream::default(),
                global_this: core::cell::Cell::new(Some(bun_ptr::BackRef::new(cx.global()))),
                ..Default::default()
            },
        );

        reader.producer.set(locked.producer);

        reader.context.apply_drain_result(drain_result);

        let context_ptr: *mut ByteStream = &raw mut reader.context;
        let stream_value = if text_mode {
            reader.to_text_readable_stream(cx)?
        } else {
            reader.to_readable_stream(cx)?
        };
        ReadableStream::set_body_facts(stream_value, locked.facts);
        let readable = ReadableStream {
            ptr: webcore::readable_stream::Source::Bytes(context_ptr),
            value: stream_value,
        };
        locked.readable = webcore::readable_stream::Strong::init(readable, cx.global());

        if let Some(on_readable_stream_available) = locked.on_readable_stream_available.take() {
            on_readable_stream_available(locked.task.unwrap(), cx.global(), readable);
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

            // `leak_wtf_impl()` transfers the +1 ref out of the bun_core::String wrapper.
            return Ok(Value::WTFStringImpl(str.leak_wtf_impl()));
        }

        if js_type.is_typed_array_or_array_buffer() {
            if let Some(buffer) = value.as_array_buffer(global_this) {
                let bytes = buffer.byte_slice();

                if bytes.is_empty() {
                    return Ok(Value::Empty);
                }

                // The global allocator aborts on OOM, so a "Failed to clone
                // ArrayBufferView" error path is unreachable.
                return Ok(Value::InternalBlob(bytes.to_vec().into()));
            }
        }

        if let Some(form_data) = as_dom_form_data(value) {
            // SAFETY: shim returns a live JSC heap cell.
            return match Blob::from_dom_form_data(global_this, unsafe { &mut *form_data }) {
                Ok(blob) => Ok(Value::Blob(blob)),
                Err(err) => Err(err.throw(global_this)),
            };
        }

        if let Some(search_params) = as_url_search_params(value) {
            // SAFETY: shim returns a live JSC heap cell.
            return Ok(Value::Blob(Blob::from_url_search_params(
                global_this,
                unsafe { &mut *search_params },
            )));
        }

        if js_type == jsc::JSType::DOMWrapper {
            // `as_class_ref` is the safe shared-borrow downcast (one audited
            // unsafe in `JSValue`); `dupe` / `encode_for_body`
            // both take `&self`.
            if let Some(blob) = value.as_class_ref::<Blob>() {
                return Ok(Value::Blob(
                    // We must preserve "type" so that DOMFormData and the "type" field are preserved.
                    blob.dupe(),
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
                // SAFETY: `encoded.bytes` is the codec-owned slice; copy then drop frees it.
                let owned: Box<[u8]> = Box::from(unsafe { encoded.bytes.as_ref() });
                drop(encoded);
                let blob = Blob::init(owned.into_vec(), global_this);
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

        Ok(Value::Blob(Blob::get::<true, false>(global_this, value)?))
    }

    pub(crate) fn from_readable_stream_without_lock_check(
        readable: ReadableStream,
        global_this: &JSGlobalObject,
    ) -> Value {
        Value::Locked(PendingValue::from_stream(readable, global_this))
    }

    /// The producer has the whole body. It replaces the pending state, and the reader that waited for it gets it.
    pub(crate) fn fulfill(
        &mut self,
        bytes: Vec<u8>,
        cx: &bun_jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        let facts = self.facts();
        let content_type = self.content_type().clone();
        let mut pending =
            core::mem::replace(self, Value::InternalBlob(InternalBlob { bytes, facts }));
        self.keep_content_type(content_type);
        pending.resolve(self, cx)
    }

    pub(crate) fn resolve(
        &mut self,
        new: &mut Value,
        cx: &bun_jsc::JsThread<'_>,
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
                        // BACKREF: `Source::bytes()` payload is live for the
                        // ReadableStream JS wrapper's lifetime.
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
                callback(locked.task.unwrap(), new);
                return Ok(());
            }

            if let Some(promise_) = locked.promise.take() {
                let promise = promise_.as_any_promise().unwrap();
                let content_type = core::mem::take(&mut locked.content_type);
                // `wrap` turns what the conversion throws (a string too long, a JSON parse error) into a rejection.
                promise.wrap(cx.global(), |_| {
                    locked.action.convert(new, content_type, cx)
                })?;
                promise_.unprotect();
            }
        }
        Ok(())
    }

    pub(crate) fn use_(&mut self) -> Blob {
        self.to_blob_if_possible();

        match self {
            Value::Blob(b) => {
                // `Value` has `Drop`, so we cannot move the `Blob` out by
                // value (E0509). `mem::take` leaves a default `Blob` whose `deinit()`
                // (run by `Value::drop` on the assignment below) is a no-op.
                let new_blob = core::mem::take(b);
                *self = Value::Used;
                debug_assert!(!new_blob.is_heap_allocated()); // owned by Body
                new_blob
            }
            Value::InternalBlob(ib) => {
                // SAFETY: VirtualMachine::get() returns the live per-thread VM.
                let global = VirtualMachine::get().global();
                let new_blob = ib.to_blob(global);
                *self = Value::Used;
                new_blob
            }
            Value::WTFStringImpl(wtf) => {
                let wtf = *wtf;
                // Transfer the body's +1 to local `wtf`; suppress `Value::drop` (which
                // would deref) so the StringImpl stays alive across `to_utf8` and is
                // released exactly once below.
                let _ = core::mem::ManuallyDrop::new(core::mem::replace(self, Value::Used));
                let wtf_ref = wtf_impl(&wtf);
                // SAFETY: VirtualMachine::get() returns the live per-thread VM.
                let global = VirtualMachine::get().global();
                let new_blob = Blob::init(wtf_ref.to_utf8().into_vec(), global);
                new_blob.body_facts.set(BodyFacts::STRING);
                // Release the +1 the body held.
                wtf_ref.deref();
                new_blob
            }
            // A zero-length body is spent by a read like any other (`use_as_any_blob` agrees).
            // `Blob::default()` leaves `global_this` null which matches the
            // don't-care contract here.
            Value::Empty => {
                *self = Value::Used;
                Blob::default()
            }
            _ => Blob::default(),
        }
    }

    /// Moves the string out of the `WTFStringImpl` arm and leaves `Used`.
    fn take_wtf_string(&mut self) -> WTFString {
        let Value::WTFStringImpl(ptr) = *self else {
            unreachable!("Value::take_wtf_string on a body that is not a string")
        };
        // `Value::drop` must not release the ref that the handle takes over.
        let _ = core::mem::ManuallyDrop::new(core::mem::replace(self, Value::Used));
        // SAFETY: the arm holds a non-null, live `WTF::StringImpl` and owns one
        // ref on it (see `wtf_impl`). The arm was forgotten above, so that ref
        // has exactly one owner: the handle. The forget and this adopt stand in
        // for a by-value move, which `Value`'s raw arm and `impl Drop` rule out
        // (E0509).
        unsafe { WTFString::adopt(ptr) }
    }

    /// Returns the bytes if they are at hand and need no conversion, and leaves the body used.
    pub(crate) fn try_use_as_any_blob(&mut self) -> Option<AnyBlob> {
        self.lift_unread_stream();
        match self {
            Value::Blob(_) | Value::InternalBlob(_) => {}
            Value::WTFStringImpl(str) if wtf_impl(str).can_use_as_utf8() => {}
            _ => return None,
        }
        Some(self.use_as_any_blob_allow_non_utf8_string())
    }

    /// [`Self::use_as_any_blob_allow_non_utf8_string`], with a string that isn't ASCII as its UTF-8 bytes.
    pub(crate) fn use_as_any_blob(&mut self) -> AnyBlob {
        self.to_blob_if_possible();
        self.use_as_any_blob_allow_non_utf8_string()
    }

    /// Takes the bytes and leaves the body used. A null body stays null.
    pub(crate) fn use_as_any_blob_allow_non_utf8_string(&mut self) -> AnyBlob {
        self.lift_unread_stream();
        // `Value` has `Drop`, so a payload can't be moved out of it by value (E0509).
        let any_blob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(_) => return AnyBlob::WTFStringImpl(self.take_wtf_string()),
            Value::Null => return AnyBlob::Blob(Blob::default()),
            _ => AnyBlob::Blob(Blob::default()),
        };
        *self = Value::Used;
        any_blob
    }

    pub(crate) fn to_error_instance(
        &mut self,
        err: ValueError,
        global: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        if let Value::Locked(_) = self {
            // reshaped for borrowck + E0509 (`Value` has `Drop`) — `mem::take`
            // the `PendingValue` out (leaves `Locked(default)`, whose Drop is a no-op on
            // an empty readable), then overwrite with `Error`.
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
                // BACKREF: see `Source::bytes()` — payload live for the
                // lifetime of the ReadableStream JS wrapper.
                if let Some(bytes) = readable.ptr.bytes() {
                    bytes.on_data(streams::Result::Err(err_ref.to_stream_error(global)));
                } else {
                    // e.g. a `clone()` tee branch; a cancel would end its reads with `{ done: true }`.
                    readable.error(global, err_ref.to_js(global))?;
                }
            }

            if let Some(on_receive_value) = locked.on_receive_value.take() {
                // `task` is the live request-ctx pointer registered alongside
                // this callback.
                on_receive_value(locked.task.unwrap(), self);
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
    // Renamed from `deinit` per PORTING.md (never expose `pub fn deinit(&mut self)`). Now
    // delegates the actual resource release to `Drop` (below) via assignment, so a later
    // `HiveArray::put()` → `drop_in_place` on the resulting `Null` is a guaranteed no-op
    // (idempotent — no double-free).
    pub fn reset(&mut self) {
        if let Value::Locked(locked) = self {
            // Locked stays Locked (callers may still inspect the variant after
            // reset()); flip the `deinit` latch so Drop is a no-op afterwards.
            if !locked.deinit {
                locked.deinit = true;
                locked.readable.deinit();
                locked.readable = Default::default();
            }
            return;
        }
        // Assignment runs `Drop` on the old variant: deref WTFStringImpl, deinit
        // Blob, free InternalBlob's Vec, reset Error. Null/Used/Empty are no-ops.
        *self = Value::Null;
    }
}

/// Runs when a `HiveRef<Value>` slot is recycled
/// (`HiveArray::Fallback::put` → `drop_in_place`; see
/// `bun_collections::HiveRef::unref`). Without this impl `Request`/`Response`
/// GC finalization leaked `WTFStringImpl` refs / `Blob` stores /
/// `InternalBlob` buffers (H3 elysia rss).
///
/// Unlike `reset()` this never reassigns `*self` (it's already being torn
/// down), so calling `reset()` first then dropping (or dropping a `Null`
/// produced by `reset()`) is a no-op second pass — no double-free.
impl Drop for Value {
    fn drop(&mut self) {
        match self {
            Value::Locked(locked) => {
                if !locked.deinit {
                    locked.deinit = true;
                    locked.readable.deinit();
                }
            }
            Value::WTFStringImpl(s) => wtf_impl(s).deref(),
            Value::Blob(b) => b.deinit(),
            Value::Error(e) => e.reset(),
            // `InternalBlob`'s `Vec<u8>` is freed by the compiler's drop glue.
            Value::InternalBlob(_) | Value::Used | Value::Empty | Value::Null => {}
        }
    }
}

impl Value {
    pub(crate) fn tee(
        &mut self,
        cx: &bun_jsc::JsThread<'_>,
        owned_readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value> {
        let Value::Locked(locked) = self else {
            // Caller guarantees `self` is `Locked` at entry.
            unreachable!("tee() called on non-Locked Value");
        };
        // The copy of a body that is being read is a used body. A locked stream that script made throws from its tee() below.
        let unusable = |readable: &ReadableStream| {
            readable.is_disturbed(cx.global())
                || (!matches!(readable.ptr, webcore::readable_stream::Source::JavaScript)
                    && readable.is_locked(cx.global()))
        };
        if let Some(readable) = owned_readable {
            if unusable(readable) {
                return Ok(Value::Used);
            }

            if let Some((rs0, rs1)) = readable.tee(cx.global())? {
                // Keep the current readable as a strong reference when cloning, and return the second one in the result.
                // This will be checked and downgraded to a write barrier if needed.
                locked.readable = webcore::readable_stream::Strong::init(rs0, cx.global());
                return Ok(locked.tee_branch(rs1, cx.global()));
            }
        }
        if locked
            .readable
            .get()
            .is_some_and(|readable| unusable(&readable))
        {
            return Ok(Value::Used);
        }

        if let Some(readable) = locked.readable.tee(cx.global())? {
            return Ok(locked.tee_branch(readable, cx.global()));
        }

        if locked.has_consumer() || locked.readable.has() {
            return Ok(Value::Used);
        }

        self.locked_to_native_stream(cx, false)?;
        // The producer had aborted.
        let Value::Locked(locked) = self else {
            return Ok(Value::Null);
        };
        Ok(match locked.readable.tee(cx.global())? {
            Some(teed) => locked.tee_branch(teed, cx.global()),
            None => Value::Used,
        })
    }

    pub(crate) fn clone(&mut self, cx: &bun_jsc::JsThread<'_>) -> JsResult<Value> {
        self.clone_with_readable_stream(cx, None)
    }

    pub(crate) fn clone_with_readable_stream(
        &mut self,
        cx: &bun_jsc::JsThread<'_>,
        readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value> {
        // A native blob, file, or fully buffered byte stream that nothing has
        // read goes back to being a Blob, so both bodies share one store (and
        // its type) instead of pumping the bytes through a JS tee. The owner
        // must then drop its cached `.body` (`sync_body_stream_caches`).
        // Anything else is teed.
        if let Value::Locked(locked) = self {
            match locked.take_blob_from_unread_stream(cx.global(), readable.as_deref().copied()) {
                Some(blob) => self.replace_stream_with(blob),
                None => return self.tee(cx, readable),
            }
        }

        self.to_blob_if_possible();

        if let Value::InternalBlob(internal_blob) = self {
            *self = Value::Blob(internal_blob.to_blob(cx.global()));
        }

        if let Value::Blob(b) = self {
            if b.store().is_some_and(blob::store_yields_bytes_once) {
                // A pipe or other fd yields its bytes once: read it as one
                // stream and tee that.
                self.to_readable_stream(cx)?;
                return self.tee(cx, None);
            }
            return Ok(Value::Blob(b.dupe()));
        }

        if let Value::WTFStringImpl(s) = *self {
            wtf_impl(&s).r#ref();
            return Ok(Value::WTFStringImpl(s));
        }

        if matches!(self, Value::Null) {
            return Ok(Value::Null);
        }

        // A failed body clones as failed, so the clone's readers reject via
        // `handle_body_error` instead of falling through to `Empty` below and
        // resolving as an empty "successful" body.
        if let Value::Error(err) = self {
            return Ok(Value::Error(err.dupe(cx.global())));
        }

        Ok(Value::Empty)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// JSC-integration: extract / BodyMixin (host-fn methods).
// ────────────────────────────────────────────────────────────────────────────

// https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
pub(crate) fn extract(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Body> {
    let body_value = Value::from_js(global_this, value)?;
    if let Value::Blob(b) = &body_value {
        debug_assert!(!b.is_heap_allocated()); // owned by Body
    }
    Ok(Body::new(body_value))
}

// ────────────────────────────────────────────────────────────────────────────
// Mixin
// ────────────────────────────────────────────────────────────────────────────

/// Mixin trait with provided methods.
/// Implementers supply `get_body_value`, `get_content_type`, `ensure_headers`,
/// and optionally override `get_body_readable_stream`.
pub(crate) trait BodyMixin: BodyOwnerJs + Sized {
    /// R-2 interior-mutability boundary: implementors project `&mut Value`
    /// from `&self` via `JsCell` (Response) or a raw `NonNull` deref (Request);
    /// see [`Body::value_mut`]. Single-JS-thread invariant — keep the borrow
    /// short and do not hold it across a call that re-enters JS.
    #[allow(clippy::mut_from_ref)]
    fn get_body_value(&self) -> &mut Value;
    /// The `Content-Type` header, or else the type the body implies.
    fn get_content_type(&self) -> Option<Utf8Bytes<'_>>;
    /// Creates the header list if there is none yet, which copies the body's `Content-Type` into it.
    fn ensure_headers(&self, global_this: &JSGlobalObject) -> JsResult<()>;

    /// Call before a reader spends the body: a used body no longer has the `Content-Type`.
    fn copy_content_type_to_headers(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        if !self.get_body_value().content_type().is_empty() {
            self.ensure_headers(global_this)?;
        }
        Ok(())
    }

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
        if let Value::Locked(locked) = self.get_body_value() {
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
        if let Value::Locked(locked) = self.get_body_value() {
            // `mem::take` swaps in `Default` and drops the old value.
            let _ = core::mem::take(&mut locked.readable);
        }
    }

    /// Migrate any `Locked.readable` strong ref
    /// into the GC-traced `js.gc.stream` slot to break the cycle (the JS
    /// wrapper owns the stream; native side must not hold it strongly).
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        if let Some(js_value) = self.js_ref() {
            if let Value::Locked(locked) = self.get_body_value() {
                if let Some(stream) = locked.readable.get() {
                    stream.value.ensure_still_alive();
                    Self::stream_set_cached(js_value, global_object, stream.value);
                    locked.readable.downgrade(global_object);
                }
            }
        }
    }

    /// After `clone()` replaced this body's stream: point the wrapper's cached
    /// `body` at the tee branch now in `Locked.readable`, or, when the clone
    /// moved an unread native stream back into a Blob, forget the detached
    /// stream so `.body` is rebuilt from that Blob.
    fn sync_body_stream_caches(&self, this_value: JSValue, global_this: &JSGlobalObject) {
        match self.get_body_value() {
            Value::Locked(locked) => {
                if let Some(readable) = locked.readable.get() {
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

    /// Shared body-clone for `Request::cloned` / `clone_value`: clone through the
    /// JS-side cached stream when present, then resync this owner's
    /// `body`/`stream` cache slots with whatever the body now holds.
    fn clone_body_value_via_cached_stream(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<Value> {
        let cloned = 'brk: {
            if let Some(js_ref) = self.js_ref() {
                if let Some(stream) = Self::stream_get_cached(js_ref) {
                    let mut readable = ReadableStream::from_js_direct(stream);
                    if let Some(r) = readable.as_mut() {
                        break 'brk self
                            .get_body_value()
                            .clone_with_readable_stream(cx, Some(r))?;
                    }
                }
            }
            self.get_body_value().clone(cx)?
        };
        if let Some(js_ref) = self.js_ref() {
            self.sync_body_stream_caches(js_ref, cx.global());
        }
        self.check_body_stream_ref(cx.global());
        Ok(cloned)
    }

    /// What every reader does: rejects if the body can't be read, else reads all of it as `action` says.
    fn read_body(&self, cx: &bun_jsc::JsThread<'_>, mut action: Action) -> JsResult<JSValue> {
        let global_object = cx.global();
        match self.body_unusable(global_object) {
            Some(Unusable::Disturbed) => {
                return Ok(global_object
                    .err(
                        jsc::ErrorCode::BODY_ALREADY_USED,
                        format_args!("Body already used"),
                    )
                    .reject());
            }
            Some(Unusable::Locked) => {
                return Ok(global_object
                    .err(
                        jsc::ErrorCode::INVALID_STATE_TypeError,
                        format_args!("Invalid state: ReadableStream is locked"),
                    )
                    .reject());
            }
            None => {}
        }
        if let Some(rejected) = handle_body_error(self.get_body_value(), global_object) {
            return Ok(rejected);
        }

        // Asked before the stream's bytes are lifted out: their own type isn't one this body implied.
        let implies_content_type = !self.get_body_value().content_type().is_empty();
        self.get_body_value().to_blob_if_possible();

        let mut content_type = blob::BlobContentType::default();
        match &mut action {
            Action::GetFormData(encoding) => {
                *encoding = self
                    .get_content_type()
                    .and_then(|content_type| {
                        webcore::form_data::Encoding::get(content_type.slice())
                    })
                    .map(Box::new);
                if encoding.is_none() {
                    // TODO: catch specific errors from getFormDataEncoding
                    return Ok(global_object
                        .err(
                            jsc::ErrorCode::FORMDATA_PARSE_ERROR,
                            format_args!(
                                "Can't decode form data from body because of incorrect MIME type/boundary"
                            ),
                        )
                        .reject());
                }
            }
            Action::GetBlob => {
                if let Some(header) = self.get_content_type() {
                    content_type = MimeType::init(header.slice(), true).into();
                }
            }
            _ => {}
        }

        // A used body no longer has the type.
        if implies_content_type {
            self.ensure_headers(global_object)?;
        }
        if matches!(self.get_body_value(), Value::Locked(_)) {
            let readable = self.get_body_readable_stream();
            let Value::Locked(locked) = self.get_body_value() else {
                unreachable!()
            };
            if matches!(action, Action::GetBlob) {
                locked.content_type = content_type;
            }
            return locked.set_promise(global_object, action, readable);
        }
        JSPromise::wrap(global_object, |_| {
            action.convert(self.get_body_value(), content_type, cx)
        })
    }

    fn text(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.read_body(&cx.js_thread(), Action::GetText)
    }

    fn json(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.read_body(&cx.js_thread(), Action::GetJSON)
    }

    fn array_buffer(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.read_body(&cx.js_thread(), Action::GetArrayBuffer)
    }

    fn bytes(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.read_body(&cx.js_thread(), Action::GetBytes)
    }

    fn form_data(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.read_body(&cx.js_thread(), Action::GetFormData(None))
    }

    fn blob(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.read_body(&cx.js_thread(), Action::GetBlob)
    }

    fn get_body(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // The stream the getter makes is the reading script's.
        let cx = cx.js_thread();
        let global_this = cx.global();
        let body = self.get_body_value();

        if matches!(body, Value::Used) {
            return ReadableStream::used(global_this);
        }
        if matches!(body, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream() {
                return Ok(readable.value);
            }
        }
        let stream = self.get_body_value().to_readable_stream(&cx)?;
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
        self.copy_content_type_to_headers(global_this)?;

        // A `Locked` body whose stream is already materialized (user-provided
        // ReadableStream, or `.body` was accessed first) is decoded via a reader
        // on that existing stream.
        if matches!(self.get_body_value(), Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream() {
                let text = ReadableStream::text_decode_from(global_this, readable.value)?;
                self.detach_readable_stream(global_this);
                *self.get_body_value() = Value::Used;
                return Ok(text);
            }
        }

        // Step 2: null body → a new empty closed ReadableStream.
        // Steps 3-6: decode directly from the body's backing bytes.
        let stream = self.get_body_value().to_text_readable_stream(&cx)?;
        if stream.is_null() {
            return ReadableStream::empty(global_this);
        }
        Ok(stream)
    }

    /// Says why nothing more can read the body, if so.
    fn body_unusable(&self, global_object: &JSGlobalObject) -> Option<Unusable> {
        match self.get_body_value() {
            Value::Used => return Some(Unusable::Disturbed),
            Value::Locked(pending) if pending.has_consumer() => return Some(Unusable::Disturbed),
            Value::Locked(_) => {}
            _ => return None,
        }
        // A stream that was detached from the body is still the one `.body` returned.
        let readable = self
            .get_body_readable_stream()
            .or_else(|| ReadableStream::from_js_direct(Self::body_get_cached(self.js_ref()?)?))?;
        if readable.is_disturbed(global_object) {
            Some(Unusable::Disturbed)
        } else if readable.is_locked(global_object) {
            Some(Unusable::Locked)
        } else {
            None
        }
    }

    fn get_body_used(&self, cx: &mut JsScope<'_>) -> bool {
        self.body_unusable(cx.global()) == Some(Unusable::Disturbed)
    }

    /// Step 1 of `clone()` and `textStream()`.
    fn throw_if_body_unusable(&self, global_object: &JSGlobalObject) -> JsResult<()> {
        if self.body_unusable(global_object).is_some() {
            return Err(global_object
                .err(
                    jsc::ErrorCode::BODY_ALREADY_USED,
                    format_args!("Body is disturbed or locked"),
                )
                .throw());
        }
        Ok(())
    }
}

/// <https://fetch.spec.whatwg.org/#body-unusable>
#[derive(PartialEq, Eq)]
pub(crate) enum Unusable {
    Disturbed,
    Locked,
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
