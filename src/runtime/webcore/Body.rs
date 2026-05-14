//! https://developer.mozilla.org/en-US/docs/Web/API/Body

use bun_collections::{ByteVecExt, VecExt};
use core::ffi::c_void;
use core::ptr::NonNull;
use std::borrow::Cow;

use crate::webcore::jsc::{
    self as jsc, CallFrame, CommonAbortReason, CommonAbortReasonExt as _, DOMFormData,
    JSGlobalObject, JSPromise, JSValue, JsResult, Strong, SystemError, URLSearchParams,
    VirtualMachine,
};
use crate::webcore::{
    self, AnyBlob, Blob, BlobExt as _, ByteStream, DrainResult, FetchHeaders, Lifetime, Pipe,
    ReadableStream, blob, streams,
};
use bun_core::Output;
use bun_http_types::MimeType::MimeType;
// Re-export so callers can write `body::InternalBlob` (mirrors Zig nested-type access).
use crate::jsc::HTTPHeaderName;
pub use crate::webcore::InternalBlob;
use crate::webcore::form_data::AsyncFormDataExt as _;
use crate::webcore::sink::{self, ArrayBufferSink};
use bun_core::{MutableString, String as BunString, ZigString, strings};
use bun_core::{WTFStringImpl, WTFStringImplExt as _, WTFStringImplStruct};
use bun_jsc::ZigStringJsc as _;
use bun_jsc::{JsCell, StringJsc as _};

/// Deref the `Value::WTFStringImpl` / `AnyBlob::WTFStringImpl` payload.
/// Centralises the per-site `(**s)` raw deref at the dozen `match` arms below
/// (and in `Blob::Any`, `Response::construct_json`).
///
/// # Safety (encapsulated)
/// `Value::WTFStringImpl` always stores a non-null `*mut WTF::StringImpl`
/// (constructed via `String::leak_wtf_impl()` / `r#ref()`); the body holds a
/// +1 intrusive ref for as long as the variant is active, so the pointee is
/// live for any borrow tied to `&s`. All `WTFStringImplStruct` methods take
/// `&self` (refcount lives in a `Cell`), so a shared borrow suffices even for
/// `r#ref()` / `deref()`.
#[inline(always)]
pub(super) fn wtf_impl(s: &WTFStringImpl) -> &WTFStringImplStruct {
    // SAFETY: see fn doc — non-null, intrusive-refcounted, live while held.
    unsafe { &**s }
}

/// Mutable view of a [`Blob`]'s backing `Store` through its
/// `JsCell<Option<StoreRef>>` field. Centralises the per-site raw
/// `(*blob.store.get()…as_ptr()).mime_type = …` deref under the same
/// invariant `StoreRef::data_mut` already documents: Zig-semantics
/// shared-mutable interior, single-threaded JS event-loop, no concurrent
/// `&Store` outstanding for the borrow's duration.
#[inline]
#[allow(clippy::mut_from_ref)]
fn blob_store_mut(blob: &Blob) -> Option<&mut blob::Store> {
    blob.store
        .get()
        .as_ref()
        // SAFETY: `StoreRef` invariant — pointee is a live heap `Store` while
        // any `StoreRef` exists; single-threaded JS event-loop discipline
        // guarantees no other `&`/`&mut Store` is live for this borrow.
        .map(|s| unsafe { &mut *s.as_ptr() })
}

// ────────────────────────────────────────────────────────────────────────────
// Local shims for upstream-gated `JsClass` impls / `AnyPromise` methods.
// These adapt call sites in this file without editing `bun_jsc` (orphan rule).
// ────────────────────────────────────────────────────────────────────────────

#[inline]
fn as_dom_form_data(value: JSValue) -> Option<*mut DOMFormData> {
    // `DOMFormData` is an opaque C++ type without a `#[bun_jsc::JsClass]` derive;
    // route through the hand-written `from_js` (`DOMFormData.rs`) instead of
    // `value.as_::<DOMFormData>()`.
    DOMFormData::from_js(value).map(|r| std::ptr::from_mut::<DOMFormData>(r))
}
#[inline]
fn as_url_search_params(value: JSValue) -> Option<*mut URLSearchParams> {
    // See `as_dom_form_data` — opaque C++ type, hand-written `from_js`.
    URLSearchParams::from_js(value).map(|p| p.as_ptr())
}

bun_core::declare_scope!(BodyValue, visible);
bun_core::declare_scope!(BodyMixin, visible);
bun_core::declare_scope!(BodyValueBufferer, visible);

// TODO(port): `bun.JSTerminated!T` is a narrower error set than `bun.JSError`; using JsResult for now.
type JsTerminated<T> = jsc::JsResult<T>;

// R-2 (host-fn re-entrancy): `Body` is embedded inline in JS-exposed
// `Response` (and aliased via `HiveRef` in `Request`). Every BodyMixin host
// fn takes `&self` and projects `&mut Value` through this `JsCell`; the
// `UnsafeCell` inside suppresses LLVM `noalias` on `&Body` so a re-entrant
// host call cannot stack two `&mut` to the same field.
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
    pub fn new(value: Value) -> Self {
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
    pub fn value_mut(&self) -> &mut Value {
        // SAFETY: single-JS-thread invariant — `Body` lives inside a
        // `Request`/`Response` JSC heap cell; concurrent access is impossible
        // and re-entrant host fns each form a fresh short-lived borrow.
        unsafe { self.value.get_mut() }
    }

    // TODO(b2-blocked): Blob::get_size_for_bindings (gated in Blob.rs `_jsc_gated`).

    pub fn len(&self) -> blob::SizeType {
        self.value_mut().size()
    }

    pub fn slice(&self) -> &[u8] {
        self.value.get().slice()
    }

    // TODO(b2-blocked): Blob::init(Vec<u8>, &JSGlobalObject) (gated in Blob.rs `_jsc_gated`).

    pub fn use_(&self) -> Blob {
        self.value_mut().use_()
    }

    // TODO(b2-blocked): Value::clone (gated below).

    pub fn clone(&self, global_this: &JSGlobalObject) -> JsResult<Body> {
        Ok(Body::new(self.value_mut().clone(global_this)?))
    }

    pub fn clone_with_readable_stream(
        &self,
        global_this: &JSGlobalObject,
        readable: Option<&mut ReadableStream>,
    ) -> JsResult<Body> {
        Ok(Body::new(
            self.value_mut()
                .clone_with_readable_stream(global_this, readable)?,
        ))
    }
}

// TODO(b2-blocked): bun_jsc::ConsoleFormatter — write_format depends on the
// ConsoleObject formatter trait (`print_as`/`print_comma`/`write_indent`).

impl Body {
    pub fn write_format<F, W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: bun_jsc::ConsoleFormatter, // TODO(port): exact trait for ConsoleObject.Formatter
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
                // Zig calls `this.value.size()` *inside* this arm only — do not hoist:
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
                let global = locked.global();
                if let Some(stream) = locked.readable.get(global) {
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

// TODO(port): not a clean Drop — Value::reset mutates self to Null/Used and is called explicitly
// at specific protocol points (e.g. resolve()). PORTING.md forbids `pub fn deinit(&mut self)`;
// renamed to `reset()` since it cannot take `self` by value (in-place state transition).
impl Body {
    pub fn reset(&self) {
        self.value_mut().reset();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PendingValue
// ────────────────────────────────────────────────────────────────────────────

pub struct PendingValue {
    pub promise: Option<JSValue>,
    pub readable: webcore::readable_stream::Strong,
    // writable: webcore::Sink

    // PORT NOTE: LIFETIMES.tsv JSC_BORROW → `&JSGlobalObject`, but `Value::Locked`
    // is stored on heap (Body in Request/Response m_ctx). Dropped the `<'a>`
    // lifetime per PORTING.md §Type map ("never put a lifetime param on a struct
    // in Phase A"); raw ptr until Phase B picks `&'static` vs JSC handle.
    pub global: *const JSGlobalObject,
    pub task: Option<*mut c_void>,

    /// runs after the data is available.
    pub on_receive_value: Option<fn(ctx: *mut c_void, value: &mut Value)>,

    /// conditionally runs when requesting data
    /// used in HTTP server to ignore request bodies unless asked for it
    pub on_start_buffering: Option<fn(ctx: *mut c_void)>,
    pub on_start_streaming: Option<fn(ctx: *mut c_void) -> DrainResult>,
    pub on_readable_stream_available:
        Option<fn(ctx: *mut c_void, global_this: &JSGlobalObject, readable: ReadableStream)>,
    pub on_stream_cancelled: Option<fn(ctx: Option<*mut c_void>)>,
    pub size_hint: blob::SizeType,

    pub deinit: bool,
    pub action: Action,
}

impl PendingValue {
    pub fn new(global: &JSGlobalObject) -> Self {
        Self {
            global: std::ptr::from_ref(global),
            ..Default::default()
        }
    }
}

impl Default for PendingValue {
    /// PORT NOTE: Zig requires `global` to be set; callers using `..Default::default()`
    /// must initialize `global` explicitly. Null here is the only viable Rust default.
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
            on_stream_cancelled: None,
            size_hint: 0,
            deinit: false,
            action: Action::None,
        }
    }
}

impl PendingValue {
    /// Safe `&JSGlobalObject` accessor for the JSC_BORROW `global` back-pointer.
    #[inline]
    pub fn global(&self) -> &JSGlobalObject {
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
        if let Some(readable) = self.readable.get(self.global()) {
            // BACKREF: see `Source::bytes()` — payload live while the
            // ReadableStream JS wrapper (rooted via `self.readable`) is alive.
            if let Some(bytes) = readable.ptr.bytes() {
                return bytes.size_hint.get();
            }
        }
        self.size_hint
    }

    // TODO(b2-blocked): ReadableStream::to_any_blob (gated on ByteBlobLoader/
    // ByteStream un-stubbing in ReadableStream.rs).

    pub fn to_any_blob(&mut self) -> Option<AnyBlob> {
        if self.promise.is_some() {
            return None;
        }
        self.to_any_blob_allow_promise()
    }

    pub fn is_disturbed<T: BodyOwnerJs>(
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

        if let Some(readable) = self.readable.get(global_object) {
            return readable.is_disturbed(global_object);
        }

        false
    }

    pub fn is_disturbed2(&self, global_object: &JSGlobalObject) -> bool {
        if self.promise.is_some() {
            return true;
        }

        if let Some(readable) = self.readable.get(global_object) {
            return readable.is_disturbed(global_object);
        }

        false
    }

    pub fn is_streaming_or_buffering(&mut self) -> bool {
        self.readable.has()
            || self
                .promise
                .map_or(false, |p| !p.is_empty_or_undefined_or_null())
    }

    // TODO(b2-blocked): ReadableStream::to_any_blob (see above).

    pub fn to_any_blob_allow_promise(&mut self) -> Option<AnyBlob> {
        let global = self.global();
        let mut stream = self.readable.get(global)?;

        if let Some(blob) = stream.to_any_blob(global) {
            self.readable.deinit();
            return Some(blob);
        }

        None
    }

    // TODO(b2-blocked): JSGlobalObject::readable_stream_to_{json,array_buffer,
    // bytes,text,blob,form_data} + bun_core::FormDataEncoding (gated payload).

    pub fn set_promise(
        &mut self,
        global_this: &JSGlobalObject,
        action: Action,
        owned_readable: Option<ReadableStream>,
    ) -> JsResult<JSValue> {
        self.action = action;
        if let Some(readable) = owned_readable.or_else(|| self.readable.get(global_this)) {
            match &mut self.action {
                Action::GetFormData(_)
                | Action::GetText
                | Action::GetJSON
                | Action::GetBlob
                | Action::GetArrayBuffer
                | Action::GetBytes => {
                    let promise = match &mut self.action {
                        Action::GetJSON => global_this.readable_stream_to_json(readable.value),
                        Action::GetArrayBuffer => {
                            global_this.readable_stream_to_array_buffer(readable.value)
                        }
                        Action::GetBytes => global_this.readable_stream_to_bytes(readable.value),
                        Action::GetText => global_this.readable_stream_to_text(readable.value),
                        Action::GetBlob => global_this.readable_stream_to_blob(readable.value),
                        Action::GetFormData(form_data) => 'brk: {
                            let fd = form_data.take().unwrap();
                            // defer: form_data already taken; action.getFormData = None handled by take()
                            let encoding_js = match &fd.encoding {
                                bun_core::form_data::Encoding::Multipart(multipart) => {
                                    BunString::init(&multipart[..]).to_js(global_this)?
                                }
                                bun_core::form_data::Encoding::URLEncoded => JSValue::UNDEFINED,
                            };
                            // fd dropped at end of scope (Box<AsyncFormData> -> Drop)
                            break 'brk global_this
                                .readable_stream_to_form_data(readable.value, encoding_js);
                        }
                        _ => unreachable!(),
                    };
                    self.readable.deinit();
                    // The ReadableStream within is expected to keep this Promise alive.
                    // If you try to protect() this, it will leak memory because the other end of the ReadableStream won't call it.
                    // See https://github.com/oven-sh/bun/issues/13678
                    return Ok(promise);
                }
                Action::None => {}
            }
        }

        {
            let promise = JSPromise::create(global_this);
            let promise_value = promise.to_js();
            self.promise = Some(promise_value);
            promise_value.protect();

            if let Some(on_start_buffering) = self.on_start_buffering.take() {
                on_start_buffering(self.task.unwrap());
            }
            Ok(promise_value)
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
    pub fn is_none(&self) -> bool {
        matches!(self, Action::None)
    }
}

/// Tag-only equality (mirrors Zig union-tag comparison `action != .none`).
/// `GetFormData` payload is ignored.
impl PartialEq for Action {
    fn eq(&self, other: &Self) -> bool {
        core::mem::discriminant(self) == core::mem::discriminant(other)
    }
}

/// Per-class codegen'd cached-slot accessors for the `body` and `stream`
/// JS-side properties, plus the weak `JsRef` back-pointer. Both `Request` and
/// `Response` forward these 1:1 to `bun_jsc::generated::JS{Request,Response}`.
///
/// Replaces Zig's `T.js.bodyGetCached` / `T.js.gc.stream.{get,set,clear}` /
/// `this.#js_ref.tryGet()` comptime duck-typing.
pub trait BodyOwnerJs {
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
    ///     Bun.serve({
    ///         fetch(req) {
    ///              /* Body.Value becomes InternalBlob */
    ///              return new Response("hello world 🤭");
    ///         }
    ///     })
    ///
    /// This works for .json(), too.
    // PORT NOTE: `bun_core::WTFStringImpl` = `*mut WTFStringImplStruct` — a Copy raw
    // pointer to an *intrusively* refcounted WTF::StringImpl. We hold the +1 directly
    // (no Arc) and ref/deref explicitly at the same points Zig does (from_js / clone /
    // use_ / to_blob_if_possible / reset / use_as_any_blob*).
    WTFStringImpl(WTFStringImpl),
    /// Single-use Blob
    /// Avoids a heap allocation.
    InternalBlob(InternalBlob),
    /// Single-use Blob that stores the bytes in the Value itself.
    // InlineBlob(InlineBlob),
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
pub type HiveRef = bun_collections::HiveRef<Value, POOL_SIZE>;
pub type HiveAllocator = bun_collections::hive_array::Fallback<HiveRef, POOL_SIZE>;

/// Typed front-end for `VirtualMachine::init_request_body_value` (the hook is
/// type-erased to break the `bun_jsc` → `bun_runtime` dep edge). Spec
/// `VirtualMachine.zig:255 initRequestBodyValue` — moves `value` into a
/// pooled `HiveRef` slot (ref_count = 1) and returns it.
pub fn hive_alloc(vm: &mut VirtualMachine, value: Value) -> core::ptr::NonNull<HiveRef> {
    // The hook impl (`runtime/jsc_hooks.rs`) `ptr::read`s its `*mut Value`
    // argument; suppress the local drop so the move is one-way.
    let mut value = core::mem::ManuallyDrop::new(value);
    let ptr = vm
        .init_request_body_value((&raw mut *value).cast::<core::ffi::c_void>())
        .cast::<HiveRef>();
    // `HiveRef::init` only fails on allocator OOM, which `handle_oom` upstream
    // would have already aborted on; treat null as unreachable.
    core::ptr::NonNull::new(ptr).expect("body HiveAllocator returned null")
}

pub const HEAP_BREAKDOWN_LABEL: &str = "BodyValue";

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Tag {
    Blob,
    WTFStringImpl,
    InternalBlob,
    // InlineBlob,
    Locked,
    Used,
    Empty,
    Error,
    Null,
}

pub enum ValueError {
    AbortReason(CommonAbortReason),
    SystemError(SystemError),
    Message(BunString),
    /// Surfaces as a JS `TypeError`. The fetch spec maps every "network
    /// error" to TypeError, so use this for fetch-layer rejections that
    /// callers feature-detect via `err instanceof TypeError`.
    TypeError(BunString),
    JSValue(jsc::strong::Optional),
}

impl ValueError {
    // TODO(port): not a clean Drop — resets self to safe-empty in place. Renamed from `deinit`
    // per PORTING.md (never expose `pub fn deinit(&mut self)`).
    pub fn reset(&mut self) {
        match self {
            // PORT NOTE: Zig `system_error.deref()` released the bun.String
            // fields; in Rust those are dropped by the assignment below.
            ValueError::SystemError(_system_error) => {}
            ValueError::Message(message) => message.deref(),
            ValueError::TypeError(message) => message.deref(),
            ValueError::JSValue(v) => v.deinit(),
            ValueError::AbortReason(_) => {}
        }
        // safe empty value after deinit
        *self = ValueError::JSValue(jsc::strong::Optional::empty());
    }
}

// TODO(b2-blocked): BunString::{to_error_instance,to_type_error_instance} not
// yet exported from `bun_string`; SystemError lacks Clone. The bodies are
// otherwise wired to bun_jsc (CommonAbortReason::to_js, strong::Optional,
// JSValue::attach_async_stack_from_promise all exist).

impl ValueError {
    pub fn to_stream_error(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> streams::result::StreamError {
        match self {
            ValueError::AbortReason(reason) => streams::result::StreamError::AbortReason(*reason),
            _ => streams::result::StreamError::JSValue(self.to_js(global_object)),
        }
    }

    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
        let js_value = match self {
            ValueError::AbortReason(reason) => reason.to_js(global_object),
            ValueError::SystemError(system_error) => system_error.to_error_instance(global_object),
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

    /// Like `to_js` but populates the error's stack trace with async frames
    /// from the given promise's await chain. Use when rejecting from a
    /// fetch/body callback at the top of the event loop.
    pub fn to_js_with_async_stack(
        &mut self,
        global_object: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue {
        let js_value = self.to_js(global_object);
        js_value.attach_async_stack_from_promise(global_object, promise);
        js_value
    }

    pub fn dupe(&self, global_object: &JSGlobalObject) -> Self {
        match self {
            // `.clone()` on BunString/SystemError already bumps the refcount (paired
            // with their Drop deref). Zig did `var v = this.*; v.ref();` (bitwise copy
            // + one bump) — `.clone()` alone is the Rust equivalent. An extra `.ref_()`
            // here would leak +1 per dupe.
            ValueError::SystemError(e) => ValueError::SystemError(e.dupe()),
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

    // `reset` is un-gated above.
}

impl Value {
    /// Decrement the refcount of the enclosing pooled `HiveRef<Value>` slot.
    ///
    /// `RequestContext.request_body` stores `NonNull<Value>` (the pooled
    /// payload), but the Zig field type is `?*Body.Value.HiveRef` — the slot
    /// header carries the refcount + pool back-pointer. Recover the parent via
    /// `offset_of!``) and forward.
    ///
    /// # Safety
    /// `self` must be the `value` field of a live `HiveRef<Value, POOL_SIZE>`
    /// produced by `HiveRef::init`.
    pub unsafe fn unref(&mut self) -> Option<&mut Self> {
        // SAFETY: caller contract — `self` is the `.value` field of a HiveRef slot.
        let parent = unsafe {
            &mut *bun_core::from_field_ptr!(HiveRef, value, std::ptr::from_mut::<Self>(self))
        };
        parent.unref().map(|h| &mut h.value)
    }

    /// See [`Value::unref`] for the safety contract.
    pub unsafe fn ref_(&mut self) -> &mut Self {
        // SAFETY: caller contract — `self` is the `.value` field of a HiveRef slot.
        let parent = unsafe {
            &mut *bun_core::from_field_ptr!(HiveRef, value, std::ptr::from_mut::<Self>(self))
        };
        &mut parent.ref_().value
    }

    /// Downcast a `JSValue` to the `Body.Value` it owns, if any.
    ///
    /// Port of the `Body.Value` special-case in `JSValue.as()` (JSValue.zig:449):
    /// `Body.Value` is not itself a JS class — it lives inside a `Request` or
    /// `Response` wrapper — so the generic `JSValue::as_::<T: JsClass>()` path
    /// cannot be used. Instead, try both wrapper classes and return the inner
    /// body pointer.
    ///
    /// Returns a raw pointer (mirrors Zig `?*Body.Value`); the storage is owned
    /// by the JSC heap cell and outlives the call only as long as `value` is
    /// kept alive by the caller.
    pub fn from_request_or_response(value: JSValue) -> Option<*mut Value> {
        if value.is_empty_or_undefined_or_null() {
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

    pub fn was_string(&self) -> bool {
        match self {
            Value::InternalBlob(blob) => blob.was_string,
            Value::WTFStringImpl(_) => true,
            _ => false,
        }
    }
}

impl Value {
    // We may not have all the data yet
    // So we can't know for sure if it's empty or not
    // We CAN know that it is definitely empty.
    pub fn is_definitely_empty(&self) -> bool {
        match self {
            Value::Null => true,
            Value::Used | Value::Empty => true,
            Value::InternalBlob(b) => b.slice_const().is_empty(),
            Value::Blob(b) => b.size.get() == 0,
            Value::WTFStringImpl(s) => wtf_impl(s).length() == 0,
            Value::Error(_) | Value::Locked(_) => false,
        }
    }

    // TODO(b2-blocked): ZigStringSlice::slice() accessor + AnyBlob payload
    // matching depend on the wtf string slice port. `to_any_blob` itself is
    // un-gated above; only the WTFStringImpl→InternalBlob conversion blocks.

    pub fn to_blob_if_possible(&mut self) {
        if let Value::WTFStringImpl(str) = *self {
            if let Some(bytes) = wtf_impl(&str).to_utf8_if_needed() {
                // Zig: `fromOwnedSlice(@constCast(bytes.slice()))` — the UTF-8 buffer is
                // already heap-owned by the slice wrapper; transfer it (no copy).
                // Zig's `defer str.deref()` is now handled by `Value::drop` on the
                // overwritten `WTFStringImpl` variant — do NOT deref explicitly here.
                *self = Value::InternalBlob(InternalBlob {
                    bytes: bytes.into_vec(),
                    was_string: true,
                });
            }
        }

        let Value::Locked(locked) = self else {
            return;
        };

        if let Some(blob) = locked.to_any_blob() {
            *self = match blob {
                AnyBlob::Blob(b) => Value::Blob(b),
                AnyBlob::InternalBlob(b) => Value::InternalBlob(b),
                AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(s),
                // AnyBlob::InlineBlob(b) => Value::InlineBlob(b),
            };
        }
    }

    // TODO(b2-blocked): Blob::get_size_for_bindings (gated in Blob.rs `_jsc_gated`).

    pub fn size(&mut self) -> blob::SizeType {
        match self {
            Value::Blob(b) => b.get_size_for_bindings() as blob::SizeType,
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => wtf_impl(s).utf8_byte_length() as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            // Value::InlineBlob(b) => b.slice_const().len() as blob::SizeType,
            _ => 0,
        }
    }

    pub fn fast_size(&self) -> blob::SizeType {
        match self {
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => wtf_impl(s).byte_slice().len() as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            // Value::InlineBlob(b) => b.slice_const().len() as blob::SizeType,
            _ => 0,
        }
    }

    pub fn memory_cost(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.memory_cost(),
            Value::WTFStringImpl(s) => wtf_impl(s).memory_cost(),
            Value::Locked(l) => l.size_hint() as usize,
            // Value::InlineBlob(b) => b.slice_const().len(),
            _ => 0,
        }
    }

    pub fn estimated_size(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.slice_const().len(),
            Value::WTFStringImpl(s) => wtf_impl(s).byte_slice().len(),
            Value::Locked(l) => l.size_hint() as usize,
            // Value::InlineBlob(b) => b.slice_const().len(),
            _ => 0,
        }
    }

    /// Shorthand constructor for the `Blob` variant (mirrors Zig
    /// `Body.Value{ .Blob = ... }` field-init syntax used by callers).
    #[inline]
    pub fn blob(b: Blob) -> Value {
        Value::Blob(b)
    }

    pub fn create_blob_value(data: Vec<u8>, was_string: bool) -> Value {
        // if (data.len <= InlineBlob.available_bytes) {
        //     var _blob = InlineBlob{
        //         .bytes = undefined,
        //         .was_string = was_string,
        //         .len = @truncate(InlineBlob.IntSize, data.len),
        //     };
        //     @memcpy(&_blob.bytes, data.ptr, data.len);
        //     allocator.free(data);
        //     return Value{ .InlineBlob = _blob };
        // }

        Value::InternalBlob(InternalBlob {
            bytes: data,
            was_string,
        })
    }

    // pub const empty = Value::Empty;

    // TODO(b2-blocked): ByteStream::Source — webcore::byte_stream is still a unit
    // stub (`pub struct ByteStream;`); `Source::new` / `.context.setup()` /
    // `.to_readable_stream()` need the real ByteStream port to land.

    pub fn to_readable_stream(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        jsc::mark_binding();

        match self {
            Value::Used => ReadableStream::used(global_this),
            Value::Empty => ReadableStream::empty(global_this),
            Value::Null => Ok(JSValue::NULL),
            Value::InternalBlob(_) | Value::Blob(_) | Value::WTFStringImpl(_) => {
                // Zig: `defer blob.detach()` — must run on every exit incl. `?` paths.
                let mut blob = scopeguard::guard(self.use_(), |mut b| b.detach());
                blob.resolve_size();
                let blob_size = blob.size.get();
                let value = ReadableStream::from_blob_copy_ref(global_this, &mut blob, blob_size)?;

                let stream = ReadableStream::from_js(value, global_this)?.unwrap();
                *self = Value::Locked(PendingValue {
                    readable: webcore::readable_stream::Strong::init(stream, global_this),
                    ..PendingValue::new(global_this)
                });
                Ok(value)
            }
            Value::Locked(locked) => {
                if let Some(readable) = locked.readable.get(global_this) {
                    return Ok(readable.value);
                }
                if locked.promise.is_some() || !locked.action.is_none() {
                    return ReadableStream::used(global_this);
                }
                let mut drain_result = DrainResult::EstimatedSize(0);

                if let Some(drain) = locked.on_start_streaming.take() {
                    drain_result = drain(locked.task.unwrap());
                }

                if matches!(drain_result, DrainResult::Empty | DrainResult::Aborted) {
                    *self = Value::Null;
                    return ReadableStream::empty(global_this);
                }

                // `new_mut` centralises the post-allocation deref; ownership of the
                // heap `NewSource` transfers to the JS wrapper's `m_ctx` in
                // `to_readable_stream()` below (freed by the GC finalizer).
                let reader = webcore::readable_stream::NewSource::<ByteStream>::new_mut(
                    webcore::readable_stream::NewSource {
                        // Zig: `.context = undefined` then `reader.context.setup()`; Rust
                        // default-constructs (ByteStream::default == post-setup state).
                        context: ByteStream::default(),
                        global_this: Some(bun_ptr::BackRef::new(global_this)),
                        ..Default::default()
                    },
                );

                if let Some(on_cancelled) = locked.on_stream_cancelled {
                    if let Some(task) = locked.task {
                        reader.cancel_handler.set(Some(on_cancelled));
                        reader.cancel_ctx.set(Some(task));
                    }
                }

                reader.context.setup();

                match drain_result {
                    DrainResult::EstimatedSize(estimated_size) => {
                        reader.context.high_water_mark = estimated_size as blob::SizeType;
                        reader
                            .context
                            .size_hint
                            .set(estimated_size as blob::SizeType);
                    }
                    DrainResult::Owned { list, size_hint } => {
                        reader.context.buffer.set(list);
                        reader.context.size_hint.set(size_hint as blob::SizeType);
                    }
                    _ => {}
                }

                let context_ptr: *mut ByteStream = &raw mut reader.context;
                locked.readable = webcore::readable_stream::Strong::init(
                    ReadableStream {
                        ptr: webcore::readable_stream::Source::Bytes(context_ptr),
                        value: reader.to_readable_stream(global_this)?,
                    },
                    global_this,
                );

                if let Some(on_readable_stream_available) = locked.on_readable_stream_available {
                    on_readable_stream_available(
                        locked.task.unwrap(),
                        global_this,
                        locked.readable.get(global_this).unwrap(),
                    );
                }

                Ok(locked.readable.get(global_this).unwrap().value)
            }
            Value::Error(_) => {
                // TODO: handle error properly
                ReadableStream::empty(global_this)
            }
        }
    }

    // TODO(b2-blocked): crate::api::Image, Blob::from_dom_form_data /
    // from_url_search_params / get / dupe_with_content_type live in Blob's
    // `_jsc_gated` block; ReadableStream::from_js / Ptr::Blob too.

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

            // Zig accessed `str.value.WTFStringImpl` directly; `leak_wtf_impl()` transfers
            // the +1 ref out of the bun_core::String wrapper.
            return Ok(Value::WTFStringImpl(str.leak_wtf_impl()));
        }

        if js_type.is_typed_array_or_array_buffer() {
            if let Some(buffer) = value.as_array_buffer(global_this) {
                let bytes = buffer.byte_slice();

                if bytes.is_empty() {
                    return Ok(Value::Empty);
                }

                // PORT NOTE: Zig threw "Failed to clone ArrayBufferView" on OOM; Rust's
                // global allocator aborts on OOM, so the error path is unreachable.
                return Ok(Value::InternalBlob(InternalBlob {
                    bytes: bytes.to_vec(),
                    was_string: false,
                }));
            }
        }

        // TODO(port): `bun_jsc::JsClass` is not yet implemented for the opaque
        // `DOMFormData`/`URLSearchParams` stubs (orphan rule prevents impl here).
        // The `as_dom_form_data`/`as_url_search_params` shims below return None
        // until upstream wires `from_js`.
        if let Some(form_data) = as_dom_form_data(value) {
            // SAFETY: shim returns a live JSC heap cell.
            return Ok(Value::Blob(Blob::from_dom_form_data(global_this, unsafe {
                &mut *form_data
            })));
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
            // unsafe in `JSValue`); `dupe_with_content_type` / `encode_for_body`
            // both take `&self`.
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
                // SAFETY: `encoded.bytes` is the codec-owned slice; copy then drop frees it.
                let owned: Box<[u8]> = Box::from(unsafe { encoded.bytes.as_ref() });
                drop(encoded);
                let mut blob = Blob::init(owned.into_vec(), global_this);
                blob.content_type
                    .set(std::ptr::from_ref::<[u8]>(mime.as_bytes()));
                blob.content_type_was_set.set(true);
                return Ok(Value::Blob(blob));
            }
        }

        value.ensure_still_alive();

        if let Some(readable) = ReadableStream::from_js(value, global_this)? {
            if readable.is_disturbed(global_this) {
                return Err(global_this.throw(format_args!("ReadableStream has already been used")));
            }

            match readable.ptr {
                webcore::readable_stream::Source::Blob(blob) => {
                    // SAFETY: `Source::Blob` holds a live *mut ByteBlobLoader for the
                    // lifetime of the ReadableStream JS wrapper.
                    let result = if let Some(any_blob) = unsafe { (*blob).to_any_blob(global_this) }
                    {
                        match any_blob {
                            AnyBlob::Blob(b) => Value::Blob(b),
                            AnyBlob::InternalBlob(b) => Value::InternalBlob(b),
                            AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(s),
                        }
                    } else {
                        Value::Empty
                    };
                    readable.force_detach(global_this);
                    return Ok(result);
                }
                _ => {}
            }

            return Ok(Value::from_readable_stream_without_lock_check(
                readable,
                global_this,
            ));
        }

        let blob = match Blob::get::<true, false>(global_this, value) {
            Ok(b) => b,
            Err(_err) => {
                if !global_this.has_exception() {
                    // PORT NOTE: Zig matched `error.InvalidArguments` here for an
                    // "Expected an Array" message. With `REQUIRE_ARRAY = false` that
                    // branch is unreachable in Zig's `Blob.get` too (the only
                    // `error.InvalidArguments` producer is gated on `require_array`),
                    // and every other failure path throws first (sets the exception).
                    // The Rust `JsResult` collapse is therefore semantics-preserving.
                    return Err(
                        global_this.throw_invalid_arguments(format_args!("Invalid Body object"))
                    );
                }
                return Err(bun_jsc::JsError::Thrown);
            }
        };
        Ok(Value::Blob(blob))
    }

    pub fn from_readable_stream_without_lock_check(
        readable: ReadableStream,
        global_this: &JSGlobalObject,
    ) -> Value {
        Value::Locked(PendingValue {
            readable: webcore::readable_stream::Strong::init(readable, global_this),
            ..PendingValue::new(global_this)
        })
    }

    // TODO(b2-blocked): AnyBlob::to_string_transfer / to_json_share /
    // to_array_buffer_transfer / to_uint8_array_transfer + Blob::new/to_js +
    // AnyPromise::wrap — all in gated Blob/jsc impls.

    pub fn resolve(
        &mut self,
        new: &mut Value,
        global: &JSGlobalObject,
        // Zig: `?*FetchHeaders` — opaque C++ handle, mutated via FFI. Taking
        // `NonNull` (not `&`/`&mut`) avoids manufacturing aliased Rust borrows.
        headers: Option<NonNull<FetchHeaders>>,
    ) -> JsTerminated<()> {
        bun_core::scoped_log!(BodyValue, "resolve");
        if let Value::Locked(locked) = self {
            if let Some(readable) = locked.readable.get(global) {
                readable.done(global);
                locked.readable.deinit();
            }

            if let Some(callback) = locked.on_receive_value.take() {
                callback(locked.task.unwrap(), new);
                return Ok(());
            }

            if let Some(promise_) = locked.promise.take() {
                let promise = promise_.as_any_promise().unwrap();

                match &mut locked.action {
                    // These ones must use promise.wrap() to handle exceptions thrown while calling .toJS() on the value.
                    // These exceptions can happen if the String is too long, ArrayBuffer is too large, JSON parse error, etc.
                    Action::GetText => match new {
                        Value::WTFStringImpl(_) | Value::InternalBlob(_) /* | Value::InlineBlob(_) */ => {
                            let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                            promise.wrap(global, |g| blob.to_string_transfer(g))?;
                        }
                        _ => {
                            let mut blob = new.use_();
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
                        promise.wrap(global, |g| blob.to_array_buffer_transfer(g))?;
                    }
                    Action::GetBytes => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap(global, |g| blob.to_uint8_array_transfer(g))?;
                    }
                    Action::GetFormData(form_data_slot) => 'inner: {
                        let mut blob = new.use_as_any_blob();
                        let Some(async_form_data) = form_data_slot.take() else {
                            // Zig: `defer blob.detach()` covers the `try promise.reject(...)` error path.
                            let r = promise.reject(
                                global,
                                ZigString::init(
                                    b"Internal error: task for FormData must not be null",
                                )
                                .to_error_instance(global),
                            );
                            blob.detach();
                            r?;
                            break 'inner;
                        };
                        // `webcore::form_data::AsyncFormData` re-exports `bun_core::form_data::AsyncFormData`;
                        // `to_js` is provided via the `AsyncFormDataExt` extension trait.
                        let result = async_form_data.to_js(global, blob.slice(), promise);
                        blob.detach();
                        // async_form_data dropped (Box<AsyncFormData> -> Drop replaces deinit)
                        result?;
                    }
                    Action::None | Action::GetBlob => {
                        let blob_ptr = Blob::new(new.use_());
                        // SAFETY: `Blob::new` returns a freshly heap-allocated *mut Blob.
                        let blob = unsafe { &mut *blob_ptr };
                        if let Some(fetch_headers) = headers {
                            // `headers` is a live C++ FetchHeaders handle (Zig: `?*FetchHeaders`);
                            // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
                            let fetch_headers =
                                bun_opaque::opaque_deref_mut(fetch_headers.as_ptr());
                            if let Some(content_type) =
                                fetch_headers.fast_get(HTTPHeaderName::ContentType)
                            {
                                let content_slice = content_type.to_slice();
                                let mut allocated = false;
                                let mime_type = MimeType::init(
                                    content_slice.slice(),
                                    true,
                                    Some(&mut allocated),
                                );
                                blob.content_type_was_set.set(true);
                                // PORT NOTE: ownership reshape vs Zig. Zig's MimeType has no destructor so
                                // `blob.content_type` (freed via `content_type_allocated`) is the sole owner
                                // and `store.mime_type` aliases it. Rust `MimeType.value` is `Cow` (RAII), so
                                // we give the Store the owning Cow and let `blob.content_type` alias it
                                // (Blob holds a +1 on Store, alias valid for Blob's lifetime). When there is
                                // no store, transfer the buffer into `blob.content_type` directly.
                                if let Some(store) = blob_store_mut(blob) {
                                    store.mime_type = mime_type;
                                    blob.content_type.set(std::ptr::from_ref::<[u8]>(
                                        store.mime_type.value.as_ref(),
                                    ));
                                    blob.content_type_allocated.set(false);
                                } else {
                                    blob.content_type.set(match mime_type.value {
                                        Cow::Owned(v) => {
                                            bun_core::heap::into_raw(v.into_boxed_slice())
                                        }
                                        Cow::Borrowed(s) => std::ptr::from_ref::<[u8]>(s),
                                    });
                                    blob.content_type_allocated.set(allocated);
                                }
                                // content_slice dropped (replaces defer content_slice.deinit())
                            }
                        }
                        if !blob.content_type_was_set.get() && blob.store.get().is_some() {
                            blob.content_type.set(std::ptr::from_ref::<[u8]>(
                                bun_http_types::MimeType::TEXT.value.as_ref(),
                            ));
                            blob.content_type_allocated.set(false);
                            blob.content_type_was_set.set(true);
                            blob_store_mut(blob)
                                .expect("infallible: checked above")
                                .mime_type = bun_http_types::MimeType::TEXT;
                        }
                        promise.resolve(global, blob.to_js(global))?;
                    }
                }
                promise_.unprotect();
            }
        }
        Ok(())
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            Value::Blob(b) => b.shared_view(),
            Value::InternalBlob(b) => b.slice_const(),
            Value::WTFStringImpl(s) => {
                let s = wtf_impl(s);
                if s.can_use_as_utf8() {
                    s.latin1_slice()
                } else {
                    b""
                }
            }
            // Value::InlineBlob(b) => b.slice_const(),
            _ => b"",
        }
    }

    // TODO(b2-blocked): Blob::init(Vec<u8>, &JSGlobalObject) lives in Blob.rs
    // `_jsc_gated`; VirtualMachine::get().global field access also pending.

    pub fn use_(&mut self) -> Blob {
        self.to_blob_if_possible();

        match self {
            Value::Blob(b) => {
                // PORT NOTE: `Value` has `Drop`, so we cannot move the `Blob` out by
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
                let wtf = *wtf;
                // Transfer the body's +1 to local `wtf`; suppress `Value::drop` (which
                // would deref) so the StringImpl stays alive across
                // `to_utf8_if_needed`/`latin1_slice` and is released exactly once below.
                core::mem::forget(core::mem::replace(self, Value::Used));
                let wtf_ref = wtf_impl(&wtf);
                // SAFETY: VirtualMachine::get() returns the live per-thread VM.
                let global = VirtualMachine::get().global();
                let new_blob = if let Some(allocated_slice) = wtf_ref.to_utf8_if_needed() {
                    // Zig: `fromOwnedSlice(@constCast(allocated_slice.slice()))` — transfer
                    // ownership of the heap-allocated UTF-8 buffer (no copy).
                    Blob::init(allocated_slice.into_vec(), global)
                } else {
                    Blob::init(wtf_ref.latin1_slice().to_vec(), global)
                };
                // Zig: `defer wtf.deref()` — release the +1 the body held.
                wtf_ref.deref();
                new_blob
            }
            // Value::InlineBlob(_) => {
            //     let cloned = self.InlineBlob.bytes;
            //     // keep same behavior as InternalBlob but clone the data
            //     let new_blob = Blob::create(
            //         &cloned[0..self.InlineBlob.len],
            //         VirtualMachine::get().global,
            //         false,
            //     );
            //     *self = Value::Used;
            //     new_blob
            // }
            // PORT NOTE: Zig passed `undefined` for global_this; `Blob::default()` leaves
            // `global_this` null which matches the don't-care contract here.
            _ => Blob::default(),
        }
    }

    // TODO(b2-blocked): Blob::init_empty signature takes `&JSGlobalObject` (the
    // un-gated B-2 ctor) but the Zig path passed `undefined`; needs a nullable
    // overload (or `Blob::default()`) before this type-checks.

    pub fn try_use_as_any_blob(&mut self) -> Option<AnyBlob> {
        let any_blob: AnyBlob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(str) => {
                if wtf_impl(str).can_use_as_utf8() {
                    // Transfer the body's +1 to AnyBlob; suppress `Value::drop` so the
                    // assignment below does not deref the StringImpl we just handed out.
                    let s = *str;
                    core::mem::forget(core::mem::replace(self, Value::Used));
                    return Some(AnyBlob::WTFStringImpl(s));
                } else {
                    return None;
                }
            }
            // Zig: `.Locked => this.Locked.toAnyBlobAllowPromise() orelse return null` — on Some
            // it falls through to `this.* = .{ .Used = {} }` below. `?` on Option early-returns None.
            Value::Locked(l) => l.to_any_blob_allow_promise()?,
            _ => return None,
        };

        *self = Value::Used;
        Some(any_blob)
    }

    // TODO(b2-blocked): see `try_use_as_any_blob`.

    pub fn use_as_any_blob(&mut self) -> AnyBlob {
        let was_null = matches!(self, Value::Null);
        // PORT NOTE: `Value` has `Drop`, so we cannot `mem::replace` then
        // destructure by value (E0509). Match by `&mut` and `mem::take` the
        // payload; the trailing `*self = Used/Null` runs `Value::drop` on the
        // emptied/residual variant (no-op for taken Blob/InternalBlob, releases
        // the +1 for the UTF-8-converted WTFStringImpl arm, deinit for Locked).
        let any_blob: AnyBlob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(str) => 'brk: {
                let str = *str;
                let wtf_ref = wtf_impl(&str);
                if let Some(utf8) = wtf_ref.to_utf8_if_needed() {
                    // Zig: `defer str.deref()` — handled by `Value::drop` on the
                    // assignment below (the variant is still `WTFStringImpl(str)`).
                    break 'brk AnyBlob::InternalBlob(InternalBlob {
                        // Zig: `fromOwnedSlice(@constCast(utf8.slice()))` — transfer
                        // ownership of the heap-allocated UTF-8 buffer (no copy).
                        bytes: utf8.into_vec(),
                        was_string: true,
                    });
                } else {
                    // Transfer the body's +1 into AnyBlob; suppress `Value::drop`.
                    core::mem::forget(core::mem::replace(self, Value::Used));
                    break 'brk AnyBlob::WTFStringImpl(str);
                }
            }
            // Value::InlineBlob(b) => AnyBlob::InlineBlob(b),
            Value::Locked(l) => l
                .to_any_blob_allow_promise()
                .unwrap_or(AnyBlob::Blob(Blob::default())),
            _ => AnyBlob::Blob(Blob::default()),
        };

        *self = if was_null { Value::Null } else { Value::Used };
        any_blob
    }

    // TODO(b2-blocked): see `try_use_as_any_blob`.

    pub fn use_as_any_blob_allow_non_utf8_string(&mut self) -> AnyBlob {
        let was_null = matches!(self, Value::Null);
        // PORT NOTE: see `use_as_any_blob` — match by `&mut` to avoid E0509.
        let any_blob: AnyBlob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(s) => {
                let s = *s;
                // Transfer the body's +1 into AnyBlob; suppress `Value::drop`.
                core::mem::forget(core::mem::replace(self, Value::Used));
                AnyBlob::WTFStringImpl(s)
            }
            // Value::InlineBlob(b) => AnyBlob::InlineBlob(b),
            Value::Locked(l) => l
                .to_any_blob_allow_promise()
                .unwrap_or(AnyBlob::Blob(Blob::default())),
            _ => AnyBlob::Blob(Blob::default()),
        };

        *self = if was_null { Value::Null } else { Value::Used };
        any_blob
    }

    // TODO(b2-blocked): webcore::readable_stream::Source::Bytes + ByteStream::on_data.

    pub fn to_error_instance(
        &mut self,
        err: ValueError,
        global: &JSGlobalObject,
    ) -> JsTerminated<()> {
        if let Value::Locked(_) = self {
            // PORT NOTE: reshaped for borrowck + E0509 (`Value` has `Drop`) — `mem::take`
            // the `PendingValue` out (leaves `Locked(default)`, whose Drop is a no-op on
            // an empty readable), then overwrite with `Error`.
            let mut locked = match self {
                Value::Locked(l) => core::mem::take(l),
                _ => unreachable!(),
            };
            *self = Value::Error(err);
            let Value::Error(err_ref) = self else {
                unreachable!()
            };

            // Zig: `defer strong_readable.deinit()` — must run on every exit incl. `?` paths.
            let strong_readable =
                scopeguard::guard(core::mem::take(&mut locked.readable), |mut r| r.deinit());

            if let Some(promise_value) = locked.promise.take() {
                // Zig: `defer promise_value.ensureStillAlive(); defer promise_value.unprotect();`
                // — non-Drop side effect (GC root decrement) that must run even if
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
            if let Some(readable) = strong_readable.get(global) {
                // BACKREF: see `Source::bytes()` — payload live for the
                // lifetime of the ReadableStream JS wrapper.
                if let Some(bytes) = readable.ptr.bytes() {
                    bytes.on_data(streams::Result::Err(err_ref.to_stream_error(global)))?;
                } else {
                    readable.abort(global);
                }
            }

            if let Some(on_receive_value) = locked.on_receive_value.take() {
                on_receive_value(locked.task.unwrap(), self);
            }

            return Ok(());
        }
        *self = Value::Error(err);
        Ok(())
    }

    // TODO(b2-blocked): forwards to `to_error_instance` (gated above).

    pub fn to_error(&mut self, err: bun_core::Error, global: &JSGlobalObject) -> JsTerminated<()> {
        self.to_error_instance(
            ValueError::Message(BunString::create_format(format_args!(
                "Error reading file {}",
                err.name()
            ))),
            global,
        )
    }

    // PORT NOTE: mutates self to Null and is called explicitly at specific protocol points.
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

/// Spec: `Body.Value.deinit` (Body.zig). Runs when a `HiveRef<Value>` slot is
/// recycled (`HiveArray::Fallback::put` → `drop_in_place`) — Zig's
/// `if @hasDecl(T, "deinit") this.value.deinit()` in `HiveRef::unref` was
/// mapped to `T::drop` in the Rust port (see `bun_collections::HiveRef::unref`),
/// so without this impl `Request`/`Response` GC finalization leaked
/// `WTFStringImpl` refs / `Blob` stores / `InternalBlob` buffers (H3 elysia rss).
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
    // TODO(b2-blocked): ByteStream::Source — see `to_readable_stream`. The
    // tail half of `tee()` constructs a `ByteStream::Source` to back a fresh
    // ReadableStream; un-gate once the real ByteStream port lands.

    pub fn tee(
        &mut self,
        global_this: &JSGlobalObject,
        owned_readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value> {
        let Value::Locked(locked) = self else {
            // TODO(port): Zig assumed self.* == .Locked at entry (caller guarantees).
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

        if locked.promise.is_some() || !locked.action.is_none() || locked.readable.has() {
            return Ok(Value::Used);
        }

        let mut drain_result = DrainResult::EstimatedSize(0);

        if let Some(drain) = locked.on_start_streaming.take() {
            drain_result = drain(locked.task.unwrap());
        }

        if matches!(drain_result, DrainResult::Empty | DrainResult::Aborted) {
            *self = Value::Null;
            return Ok(Value::Null);
        }

        // `new_mut` centralises the post-allocation deref; ownership of the
        // heap `NewSource` transfers to the JS wrapper's `m_ctx` in
        // `to_readable_stream()` below (freed by the GC finalizer).
        let reader = webcore::readable_stream::NewSource::<ByteStream>::new_mut(
            webcore::readable_stream::NewSource {
                context: ByteStream::default(),
                global_this: Some(bun_ptr::BackRef::new(global_this)),
                ..Default::default()
            },
        );

        reader.context.setup();

        match drain_result {
            DrainResult::EstimatedSize(estimated_size) => {
                reader.context.high_water_mark = estimated_size as blob::SizeType;
                reader
                    .context
                    .size_hint
                    .set(estimated_size as blob::SizeType);
            }
            DrainResult::Owned { list, size_hint } => {
                reader.context.buffer.set(list);
                reader.context.size_hint.set(size_hint as blob::SizeType);
            }
            _ => {}
        }

        // PORT NOTE: reshaped for borrowck — re-borrow locked after the early *self = Null path above.
        let Value::Locked(locked) = self else {
            unreachable!()
        };

        let context_ptr: *mut ByteStream = &raw mut reader.context;
        locked.readable = webcore::readable_stream::Strong::init(
            ReadableStream {
                ptr: webcore::readable_stream::Source::Bytes(context_ptr),
                value: reader.to_readable_stream(global_this)?,
            },
            global_this,
        );

        if let Some(on_readable_stream_available) = locked.on_readable_stream_available {
            on_readable_stream_available(
                locked.task.unwrap(),
                global_this,
                locked.readable.get(global_this).unwrap(),
            );
        }

        let teed = match locked.readable.tee(global_this)? {
            Some(t) => t,
            None => return Ok(Value::Used),
        };

        Ok(Value::Locked(PendingValue {
            readable: webcore::readable_stream::Strong::init(teed, global_this),
            ..PendingValue::new(global_this)
        }))
    }

    // TODO(b2-blocked): forwards to `to_blob_if_possible`/`tee`/`Blob::init`,
    // all of which are still gated (see notes above each).

    pub fn clone(&mut self, global_this: &JSGlobalObject) -> JsResult<Value> {
        self.clone_with_readable_stream(global_this, None)
    }

    pub fn clone_with_readable_stream(
        &mut self,
        global_this: &JSGlobalObject,
        readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value> {
        self.to_blob_if_possible();

        if matches!(self, Value::Locked(_)) {
            return self.tee(global_this, readable);
        }

        if let Value::InternalBlob(internal_blob) = self {
            let owned = internal_blob.to_owned_slice();
            *self = Value::Blob(Blob::init(owned, global_this));
        }

        if let Value::Blob(b) = self {
            return Ok(Value::Blob(b.dupe_with_content_type(false)));
        }

        if let Value::WTFStringImpl(s) = *self {
            wtf_impl(&s).r#ref();
            return Ok(Value::WTFStringImpl(s));
        }

        if matches!(self, Value::Null) {
            return Ok(Value::Null);
        }

        Ok(Value::Empty)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// JSC-integration: extract / BodyMixin (host-fn methods) / ValueBufferer.
// ────────────────────────────────────────────────────────────────────────────

// PORT NOTE: Zig `ArrayBufferSink.JSSink` is a nested type from `Sink.JSSink(@This(), name)`.
// Rust uses a free generic `sink::JSSink<T>` (inherent associated types are unstable).
type ArrayBufferJSSink = sink::JSSink<ArrayBufferSink>;

// https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
pub fn extract(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Body> {
    let body_value = Value::from_js(global_this, value)?;
    if let Value::Blob(b) = &body_value {
        debug_assert!(!b.is_heap_allocated()); // owned by Body
    }
    Ok(Body::new(body_value))
}

// ────────────────────────────────────────────────────────────────────────────
// Mixin
// ────────────────────────────────────────────────────────────────────────────

/// `pub fn Mixin(comptime Type: type) type` → trait with provided methods.
/// Implementers supply `get_body_value`, `get_fetch_headers`, `get_form_data_encoding`,
/// and optionally override `get_body_readable_stream` (Zig `@hasDecl` check).
///
/// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`. The
/// codegen shim still emits `this: &mut T` until Phase 1 lands — `&mut T`
/// auto-derefs to `&T` so the impls below compile against either.
pub trait BodyMixin: BodyOwnerJs + Sized {
    /// R-2 interior-mutability boundary: implementors project `&mut Value`
    /// from `&self` via `JsCell` (Response) or a raw `NonNull` deref (Request);
    /// see [`Body::value_mut`]. Single-JS-thread invariant — keep the borrow
    /// short and do not hold it across a call that re-enters JS.
    #[allow(clippy::mut_from_ref)]
    fn get_body_value(&self) -> &mut Value;
    /// Zig: `Type.getFetchHeaders(this) -> ?*FetchHeaders`. `FetchHeaders` is an
    /// opaque, intrusively-refcounted C++ handle whose accessors take `&mut self`
    /// (FFI signature is `*mut`). Returning `NonNull` instead of `&FetchHeaders`
    /// avoids deriving `&mut T` from `&T` at the call sites (UB).
    fn get_fetch_headers(&self) -> Option<NonNull<FetchHeaders>>;
    fn get_form_data_encoding(&self) -> JsResult<Option<Box<bun_core::form_data::AsyncFormData>>>;

    // ────────────────────────────────────────────────────────────────────
    // Twin methods (identical for Request/Response). These were previously
    // open-coded in both files against `js_gen::*` / `js::*` directly; the
    // [`BodyOwnerJs`] forwarders erase the per-class codegen module so the
    // bodies can live here once. Zig had the same shape via comptime
    // `T.js.gc.stream.*` duck-typing.
    // ────────────────────────────────────────────────────────────────────

    /// Zig: `getBodyReadableStream`. JS-side `js.gc.stream` cache is the
    /// source of truth; fall back to the native `Locked.readable` slot.
    fn get_body_readable_stream(&self, global_object: &JSGlobalObject) -> Option<ReadableStream> {
        if let Some(js_ref) = self.js_ref() {
            if let Some(stream) = Self::stream_get_cached(js_ref) {
                // JS is always source of truth for the stream
                return match ReadableStream::from_js(stream, global_object) {
                    Ok(rs) => rs,
                    Err(err) => {
                        let _ = global_object.take_exception(err);
                        None
                    }
                };
            }
        }
        if let Value::Locked(locked) = self.get_body_value() {
            return locked.readable.get(global_object);
        }
        None
    }

    /// Zig: `detachReadableStream` — clear both the JS-side cache and the
    /// native `Locked.readable` strong ref.
    fn detach_readable_stream(&self, global_object: &JSGlobalObject) {
        if let Some(js_ref) = self.js_ref() {
            // Zig `js.gc.stream.clear(...)` → `set(.zero)`.
            Self::stream_set_cached(js_ref, global_object, JSValue::ZERO);
        }
        if let Value::Locked(locked) = self.get_body_value() {
            // `mem::take` swaps in `Default` and drops the old value —
            // equivalent to Zig's `old.deinit(); ... = .{}`.
            let _ = core::mem::take(&mut locked.readable);
        }
    }

    /// Zig: `checkBodyStreamRef`. Migrate any `Locked.readable` strong ref
    /// into the GC-traced `js.gc.stream` slot to break the cycle (the JS
    /// wrapper owns the stream; native side must not hold it strongly).
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        if let Some(js_value) = self.js_ref() {
            if let Value::Locked(locked) = self.get_body_value() {
                if let Some(stream) = locked.readable.get(global_object) {
                    stream.value.ensure_still_alive();
                    Self::stream_set_cached(js_value, global_object, stream.value);
                    let _ = core::mem::take(&mut locked.readable);
                }
            }
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
        if let Value::Locked(locked) = self.get_body_value() {
            if let Some(readable) = locked.readable.get(global_this) {
                Self::body_set_cached(this_value, global_this, readable.value);
            }
        }
        self.check_body_stream_ref(global_this);
    }

    /// Shared `'brk:` block of `clone_into` / `clone_value`: clone the body
    /// [`Value`], teeing through the JS-side cached stream if one exists.
    fn clone_body_value_via_cached_stream(&self, global_this: &JSGlobalObject) -> JsResult<Value> {
        if let Some(js_ref) = self.js_ref() {
            if let Some(stream) = Self::stream_get_cached(js_ref) {
                let mut readable = ReadableStream::from_js(stream, global_this)?;
                if let Some(r) = readable.as_mut() {
                    return self
                        .get_body_value()
                        .clone_with_readable_stream(global_this, Some(r));
                }
            }
        }
        self.get_body_value().clone(global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    fn get_text(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let value = self.get_body_value();
        if matches!(value, Value::Used) {
            return Ok(handle_body_already_used(global_object));
        }

        if matches!(value, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_object) {
                if readable.is_disturbed(global_object) {
                    return Ok(handle_body_already_used(global_object));
                }
                let value = self.get_body_value();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetText, Some(readable));
                }
            }
            let value = self.get_body_value();
            if let Value::Locked(locked) = value {
                if !locked.action.is_none()
                    || locked.is_disturbed::<Self>(global_object, callframe.this())
                {
                    return Ok(handle_body_already_used(global_object));
                }
                return locked.set_promise(global_object, Action::GetText, None);
            }
        }

        let value = self.get_body_value();
        let mut blob = value.use_as_any_blob_allow_non_utf8_string();
        Ok(JSPromise::wrap(global_object, |g| {
            blob.to_string(g, Lifetime::Transfer)
        })?)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    fn get_body(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let body = self.get_body_value();

        if matches!(body, Value::Used) {
            return ReadableStream::used(global_this);
        }
        if matches!(body, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_this) {
                return Ok(readable.value);
            }
        }
        self.get_body_value().to_readable_stream(global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    fn get_body_used(&self, global_object: &JSGlobalObject) -> JSValue {
        // PORT NOTE: reshaped for borrowck — `get_body_readable_stream` needs `&self`,
        // so we can't hold a `match` borrow on `get_body_value()` across it.
        let used = match self.get_body_value() {
            Value::Used => true,
            Value::Locked(pending) if !pending.action.is_none() => true,
            Value::Locked(_) => 'brk: {
                if let Some(readable) = self.get_body_readable_stream(global_object) {
                    break 'brk readable.is_disturbed(global_object);
                }
                if let Value::Locked(pending) = self.get_body_value() {
                    if let Some(stream) = pending.readable.get(global_object) {
                        break 'brk stream.is_disturbed(global_object);
                    }
                }
                false
            }
            _ => false,
        };
        JSValue::from(used)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    fn get_json(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let value = self.get_body_value();
        if matches!(value, Value::Used) {
            return Ok(handle_body_already_used(global_object));
        }

        if matches!(value, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_object) {
                if readable.is_disturbed(global_object) {
                    return Ok(handle_body_already_used(global_object));
                }
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetJSON, Some(readable));
                }
            }
            let value = self.get_body_value();
            if let Value::Locked(locked) = value {
                if !locked.action.is_none()
                    || locked.is_disturbed::<Self>(global_object, callframe.this())
                {
                    return Ok(handle_body_already_used(global_object));
                }
                // PORT NOTE: reshaped for borrowck
                let _ = locked;
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetJSON, None);
                }
            }
        }

        let value = self.get_body_value();
        let mut blob = value.use_as_any_blob_allow_non_utf8_string();
        Ok(JSPromise::wrap(global_object, |g| {
            blob.to_json(g, Lifetime::Share)
        })?)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    fn get_array_buffer(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_core::scoped_log!(BodyMixin, "getArrayBuffer");
        let value = self.get_body_value();

        if matches!(value, Value::Used) {
            return Ok(handle_body_already_used(global_object));
        }

        if matches!(value, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_object) {
                if readable.is_disturbed(global_object) {
                    return Ok(handle_body_already_used(global_object));
                }
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(
                        global_object,
                        Action::GetArrayBuffer,
                        Some(readable),
                    );
                }
            }
            let value = self.get_body_value();
            if let Value::Locked(locked) = value {
                if !locked.action.is_none()
                    || locked.is_disturbed::<Self>(global_object, callframe.this())
                {
                    return Ok(handle_body_already_used(global_object));
                }
                let _ = locked;
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetArrayBuffer, None);
                }
            }
        }

        // toArrayBuffer in AnyBlob checks for non-UTF8 strings
        let value = self.get_body_value();
        let mut blob: AnyBlob = value.use_as_any_blob_allow_non_utf8_string();
        Ok(JSPromise::wrap(global_object, |g| {
            blob.to_array_buffer(g, Lifetime::Transfer)
        })?)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    fn get_bytes(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let value = self.get_body_value();

        if matches!(value, Value::Used) {
            return Ok(handle_body_already_used(global_object));
        }

        if matches!(value, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_object) {
                if readable.is_disturbed(global_object) {
                    return Ok(handle_body_already_used(global_object));
                }
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetBytes, Some(readable));
                }
            }
            let value = self.get_body_value();
            if let Value::Locked(locked) = value {
                if !locked.action.is_none()
                    || locked.is_disturbed::<Self>(global_object, callframe.this())
                {
                    return Ok(handle_body_already_used(global_object));
                }
                let _ = locked;
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetBytes, None);
                }
            }
        }

        // toArrayBuffer in AnyBlob checks for non-UTF8 strings
        let value = self.get_body_value();
        let mut blob: AnyBlob = value.use_as_any_blob_allow_non_utf8_string();
        Ok(JSPromise::wrap(global_object, |g| {
            blob.to_uint8_array(g, Lifetime::Transfer)
        })?)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    fn get_form_data(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let value = self.get_body_value();

        if matches!(value, Value::Used) {
            return Ok(handle_body_already_used(global_object));
        }

        if matches!(value, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_object) {
                if readable.is_disturbed(global_object) {
                    return Ok(handle_body_already_used(global_object));
                }
                let value = self.get_body_value();
                value.to_blob_if_possible();
                let _ = readable; // not consumed in this branch in Zig either
            }
            let value = self.get_body_value();
            if let Value::Locked(locked) = value {
                if !locked.action.is_none()
                    || locked.is_disturbed::<Self>(global_object, callframe.this())
                {
                    return Ok(handle_body_already_used(global_object));
                }
                let _ = locked;
                let value = self.get_body_value();
                value.to_blob_if_possible();
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

        let value = self.get_body_value();
        if let Value::Locked(locked) = value {
            let owned_readable = self.get_body_readable_stream(global_object);
            // PORT NOTE: reshaped for borrowck — re-borrow after self method call.
            let value = self.get_body_value();
            let Value::Locked(locked) = value else {
                unreachable!()
            };
            return locked.set_promise(
                global_object,
                Action::GetFormData(Some(encoder)),
                owned_readable,
            );
        }

        let mut blob: AnyBlob = value.use_as_any_blob();
        // PORT NOTE: `encoder.encoding` is `bun_core::form_data::Encoding`; convert
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

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    fn get_blob(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.get_blob_with_this_value(global_object, callframe.this())
    }

    fn get_blob_with_this_value(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let value = self.get_body_value();

        if matches!(value, Value::Used) {
            return Ok(handle_body_already_used(global_object));
        }

        if matches!(value, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_object) {
                let value = self.get_body_value();
                let Value::Locked(locked) = value else {
                    unreachable!()
                };
                if !locked.action.is_none()
                    || ((!this_value.is_empty() && readable.is_disturbed(global_object))
                        || (this_value.is_empty() && readable.is_disturbed(global_object)))
                {
                    return Ok(handle_body_already_used(global_object));
                }
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetBlob, Some(readable));
                }
            }
            let value = self.get_body_value();
            if let Value::Locked(locked) = value {
                if !locked.action.is_none()
                    || ((!this_value.is_empty()
                        && locked.is_disturbed::<Self>(global_object, this_value))
                        || (this_value.is_empty() && locked.readable.is_disturbed(global_object)))
                {
                    return Ok(handle_body_already_used(global_object));
                }
                let _ = locked;
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetBlob, None);
                }
            }
        }

        let value = self.get_body_value();
        let blob_ptr = Blob::new(value.use_());
        // SAFETY: `Blob::new` returns a freshly heap-allocated, ref-counted Blob.
        let blob = unsafe { &mut *blob_ptr };
        if blob.content_type().is_empty() {
            if let Some(fetch_headers) = BodyMixin::get_fetch_headers(self) {
                // `fetch_headers` is a live C++ FetchHeaders handle (Zig: `?*FetchHeaders`);
                // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
                let fetch_headers = bun_opaque::opaque_deref_mut(fetch_headers.as_ptr());
                if let Some(content_type) = fetch_headers.fast_get(HTTPHeaderName::ContentType) {
                    let content_slice = content_type.to_slice();
                    let mut allocated = false;
                    let mime_type =
                        MimeType::init(content_slice.slice(), true, Some(&mut allocated));
                    blob.content_type_was_set.set(true);
                    // PORT NOTE: ownership reshape vs Zig — see `resolve` (Action::None|GetBlob).
                    // Store's Cow becomes the sole owner; Blob aliases it. With no store, Blob
                    // takes the buffer directly via `content_type_allocated`.
                    if let Some(store) = blob_store_mut(blob) {
                        store.mime_type = mime_type;
                        blob.content_type
                            .set(std::ptr::from_ref::<[u8]>(store.mime_type.value.as_ref()));
                        blob.content_type_allocated.set(false);
                    } else {
                        blob.content_type.set(match mime_type.value {
                            Cow::Owned(v) => bun_core::heap::into_raw(v.into_boxed_slice()),
                            Cow::Borrowed(s) => std::ptr::from_ref::<[u8]>(s),
                        });
                        blob.content_type_allocated.set(allocated);
                    }
                    // content_slice dropped (replaces defer content_slice.deinit())
                }
            }
            if !blob.content_type_was_set.get() && blob.store.get().is_some() {
                blob.content_type.set(std::ptr::from_ref::<[u8]>(
                    bun_http_types::MimeType::TEXT.value.as_ref(),
                ));
                blob.content_type_allocated.set(false);
                blob.content_type_was_set.set(true);
                blob_store_mut(blob)
                    .expect("infallible: checked above")
                    .mime_type = bun_http_types::MimeType::TEXT;
            }
        }
        Ok(JSPromise::resolved_promise_value(
            global_object,
            blob.to_js(global_object),
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

// TODO(port): `lifetimeWrap` returns a fn at comptime in Zig. The wrapped
// call has been inlined at each `JSPromise::wrap` callsite as a closure;
// keep this helper for reference / future macro extraction.
#[allow(dead_code)]
fn lifetime_wrap(
    f: fn(&mut AnyBlob, &JSGlobalObject, Lifetime) -> JsResult<JSValue>,
    lifetime: Lifetime,
) -> impl Fn(&mut AnyBlob, &JSGlobalObject) -> JSValue {
    move |this, global_object| {
        jsc::to_js_host_call(global_object, || f(this, global_object, lifetime))
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ValueBufferer
// ────────────────────────────────────────────────────────────────────────────

pub type ValueBuffererCallback =
    fn(ctx: *mut c_void, bytes: &[u8], err: Option<ValueError>, is_async: bool);

pub struct ValueBufferer<'a> {
    pub ctx: *mut c_void,
    pub on_finished_buffering: ValueBuffererCallback,

    pub js_sink: Option<Box<ArrayBufferJSSink>>,
    pub byte_stream: Option<NonNull<ByteStream>>,
    // readable stream strong ref to keep byte stream alive
    pub readable_stream_ref: webcore::readable_stream::Strong,
    pub stream_buffer: MutableString,
    // allocator dropped — global mimalloc
    pub global: &'a JSGlobalObject,
}

impl<'a> Drop for ValueBufferer<'a> {
    fn drop(&mut self) {
        // stream_buffer dropped automatically
        if let Some(byte_stream) = self.byte_stream {
            // Kept alive by `readable_stream_ref` while set — satisfies the
            // `BackRef` outlives-holder invariant. R-2: `unpipe_without_deref`
            // takes `&self` (interior-mutable).
            bun_ptr::BackRef::from(byte_stream).unpipe_without_deref();
        }
        self.readable_stream_ref.deinit();

        if let Some(mut buffer_stream) = self.js_sink.take() {
            buffer_stream.detach_self(self.global);
            // PORT NOTE: Zig `wrapper.sink.destroy()` frees the JSSink wrapper
            // allocation (sink is at offset 0). In Rust the wrapper is a
            // `Box<JSSink<ArrayBufferSink>>`; dropping it frees the box and
            // runs `Vec<u8>`'s Drop — equivalent without the fragile
            // sub-field-pointer free.
            drop(buffer_stream);
        }
    }
}

impl<'a> ValueBufferer<'a> {
    pub fn init(
        ctx: *mut c_void,
        on_finish: ValueBuffererCallback,
        global: &'a JSGlobalObject,
    ) -> Self {
        Self {
            ctx,
            on_finished_buffering: on_finish,
            js_sink: None,
            byte_stream: None,
            readable_stream_ref: Default::default(),
            global,
            stream_buffer: MutableString::default(),
        }
    }

    pub fn run(
        &mut self,
        value: &mut Value,
        owned_readable_stream: Option<ReadableStream>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set — Zig used inferred `!void` with StreamAlreadyUsed/InvalidStream/etc.
        value.to_blob_if_possible();

        match value {
            Value::Used => {
                bun_core::scoped_log!(BodyValueBufferer, "Used");
                return Err(bun_core::err!("StreamAlreadyUsed"));
            }
            Value::Empty | Value::Null => {
                bun_core::scoped_log!(BodyValueBufferer, "Empty");
                (self.on_finished_buffering)(self.ctx, b"", None, false);
                return Ok(());
            }
            Value::Error(err) => {
                bun_core::scoped_log!(BodyValueBufferer, "Error");
                // Zig passed the union by bitwise value (no destructors). In Rust the
                // payload (BunString / Strong) owns refs and has Drop, so a `ptr::read`
                // bitwise copy would manufacture a second owner → double-deref when both
                // sides drop. Produce a properly ref-bumped duplicate instead.
                let err_copy = err.dupe(self.global);
                (self.on_finished_buffering)(self.ctx, b"", Some(err_copy), false);
                return Ok(());
            }
            // Value::InlineBlob(_) |
            Value::WTFStringImpl(_) | Value::InternalBlob(_) | Value::Blob(_) => {
                // toBlobIfPossible checks for WTFString needing a conversion.
                let mut input = value.use_as_any_blob_allow_non_utf8_string();
                let is_pending = input.needs_to_read_file();

                if is_pending {
                    if let AnyBlob::Blob(blob) = &mut input {
                        // PORT NOTE: Zig `comptime Function: anytype` becomes a ZST
                        // `InternalReadFileFn<C>` impl so `do_read_file_internal` can
                        // monomorphize a `fn(*mut c_void, ReadFileResultType)` thunk.
                        struct LoadFileAdapter;
                        impl<'b> blob::InternalReadFileFn<ValueBufferer<'b>> for LoadFileAdapter {
                            fn call(
                                sink: *mut ValueBufferer<'b>,
                                bytes: blob::read_file::ReadFileResultType,
                            ) {
                                // SAFETY: `sink` was set from `self as *mut Self` below and
                                // outlives the read (ValueBufferer is heap-pinned by caller).
                                unsafe { &mut *sink }.on_finished_loading_file(bytes);
                            }
                        }
                        let global = self.global;
                        blob.do_read_file_internal::<Self, LoadFileAdapter>(
                            std::ptr::from_mut::<Self>(self),
                            global,
                        );
                    }
                } else {
                    let bytes = input.slice();
                    bun_core::scoped_log!(BodyValueBufferer, "Blob {}", bytes.len());
                    (self.on_finished_buffering)(self.ctx, bytes, None, false);
                    input.detach();
                }
                return Ok(());
            }
            Value::Locked(_) => {
                self.buffer_locked_body_value(value, owned_readable_stream)?;
            }
        }
        Ok(())
    }

    fn on_finished_loading_file(&mut self, bytes: blob::read_file::ReadFileResultType) {
        match bytes {
            blob::read_file::ReadFileResultType::Err(err) => {
                bun_core::scoped_log!(BodyValueBufferer, "onFinishedLoadingFile Error");
                (self.on_finished_buffering)(
                    self.ctx,
                    b"",
                    Some(ValueError::SystemError(err)),
                    true,
                );
            }
            blob::read_file::ReadFileResultType::Result(data) => {
                // SAFETY: every producer sets `buf = heap::alloc(v.into_boxed_slice())`
                // (read_file.rs); reclaim ownership here. Dropped at end of scope.
                let buf = unsafe { Box::<[u8]>::from_raw(data.buf) };
                bun_core::scoped_log!(
                    BodyValueBufferer,
                    "onFinishedLoadingFile Data {}",
                    buf.len()
                );
                (self.on_finished_buffering)(self.ctx, &buf, None, true);
            }
        }
    }

    fn on_stream_pipe(&mut self, stream: streams::Result) {
        let mut stream_ = stream;
        let stream_needs_deinit = matches!(
            stream_,
            streams::Result::Owned(_) | streams::Result::OwnedAndDone(_)
        );

        let chunk = stream_.slice();
        bun_core::scoped_log!(BodyValueBufferer, "onStreamPipe chunk {}", chunk.len());
        let _ = self.stream_buffer.write(chunk);
        if stream_.is_done() {
            let bytes = self.stream_buffer.list.as_slice();
            bun_core::scoped_log!(BodyValueBufferer, "onStreamPipe done {}", bytes.len());
            (self.on_finished_buffering)(self.ctx, bytes, None, true);
        }

        if stream_needs_deinit {
            match stream_ {
                streams::Result::OwnedAndDone(owned) | streams::Result::Owned(owned) => {
                    drop(owned);
                }
                _ => unreachable!(),
            }
        }
    }

    /// Reclaim the `*mut Self` smuggled through a `NativePromiseContext` cell
    /// as an exclusive borrow. Centralises the `Option<NonNull<Self>>` deref
    /// for the two host-fn entry points below (one accessor, N safe callers).
    ///
    /// # Safety (encapsulated)
    /// `NativePromiseContext::take` returns the live ctx pointer set in
    /// `create()` (caller stashed `&mut Self` and held a +1 ref); the cell is
    /// nulled on take so this is the sole owner. `ValueBufferer` is heap-
    /// pinned by its caller for the stream's duration.
    #[inline]
    fn take_ctx<'r>(cell: JSValue) -> Option<&'r mut Self> {
        // SAFETY: see fn doc — +1 ref transferred back; sole live `&mut`.
        crate::api::NativePromiseContext::take::<Self>(cell).map(|mut p| unsafe { p.as_mut() })
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn]
    pub fn on_resolve_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let Some(sink) = Self::take_ctx(args.ptr[args.len - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        sink.handle_resolve_stream(true);
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn]
    pub fn on_reject_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let Some(sink) = Self::take_ctx(args.ptr[args.len - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let err = args.ptr[0];
        sink.handle_reject_stream(err, true);
        Ok(JSValue::UNDEFINED)
    }

    fn handle_reject_stream(&mut self, err: JSValue, is_async: bool) {
        if let Some(mut wrapper) = self.js_sink.take() {
            wrapper.detach_self(self.global);
            // PORT NOTE: see `Drop` impl — dropping the Box frees the wrapper
            // and runs `Vec<u8>`'s Drop (≡ Zig `wrapper.sink.destroy()`).
            drop(wrapper);
        }
        // Zig: `var ref = ...; defer ref.deinit(); sink.onFinishedBuffering(..., .{ .JSValue = ref }, ...);`
        // — Zig's bitwise pass + `defer deinit` is only safe because Zig has no Drop. In
        // Rust `jsc::strong::Optional` owns a GC root; `ptr::read`-duplicating it would
        // double-deinit. Transfer the single owner directly to the callback; the callback
        // (or its returned `ValueError`'s Drop) is responsible for releasing it.
        let ref_ = jsc::strong::Optional::create(err, self.global);
        (self.on_finished_buffering)(self.ctx, b"", Some(ValueError::JSValue(ref_)), is_async);
    }

    fn handle_resolve_stream(&mut self, is_async: bool) {
        if let Some(wrapper) = &self.js_sink {
            let bytes = wrapper.sink.bytes.slice();
            bun_core::scoped_log!(BodyValueBufferer, "handleResolveStream {}", bytes.len());
            (self.on_finished_buffering)(self.ctx, bytes, None, is_async);
        } else {
            bun_core::scoped_log!(BodyValueBufferer, "handleResolveStream no sink");
            (self.on_finished_buffering)(self.ctx, b"", None, is_async);
        }
    }

    #[allow(dead_code)]
    fn create_js_sink(&mut self, stream: ReadableStream) -> Result<(), bun_core::Error> {
        // PORT NOTE: The Zig caller has this path commented out ("this is broken
        // right now" — see buffer_locked_body_value below). Ported faithfully so
        // un-commenting that call site needs no further work.
        stream.value.ensure_still_alive();
        let global_this = self.global;
        // Stash the Box in `self.js_sink` first (so error paths / Drop find it),
        // then re-borrow mutably through the slot for `assign_to_stream`.
        self.js_sink = Some(Box::new(ArrayBufferJSSink {
            sink: ArrayBufferSink {
                bytes: Default::default(),
                next: None,
                ..Default::default()
            },
        }));
        // Just inserted above; `Some` guaranteed.
        let buffer_stream: &mut ArrayBufferJSSink = self.js_sink.as_deref_mut().unwrap();

        buffer_stream.sink.signal = sink::SinkSignal::<ArrayBufferSink>::init(JSValue::ZERO);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        buffer_stream.sink.signal.clear();
        debug_assert!(buffer_stream.sink.signal.is_dead());

        // PORT NOTE: reshaped for borrowck — capture the `signal.ptr` slot as a raw
        // pointer before passing `buffer_stream` to FFI (Zig aliased both).
        let signal_ptr_slot: *mut *mut c_void =
            (&raw mut buffer_stream.sink.signal.ptr).cast::<*mut c_void>();

        // Zig passes `buffer_stream` (the `*ArrayBufferSink.JSSink` wrapper). The
        // Rust `assign_to_stream` takes `&mut T` and casts to `*mut c_void`; since
        // `JSSink<T>` is `#[repr(transparent)]` over `T`, `&mut buffer_stream.sink`
        // and `buffer_stream as *mut JSSink<T>` are address-identical. Reborrow the
        // wrapper through the inner field via the transparent guarantee.
        // SAFETY: `JSSink<T>` is `#[repr(transparent)]` (single field `sink: T`).
        let inner: &mut ArrayBufferSink = unsafe {
            &mut *std::ptr::from_mut::<ArrayBufferJSSink>(buffer_stream).cast::<ArrayBufferSink>()
        };
        let assignment_result: JSValue =
            ArrayBufferJSSink::assign_to_stream(global_this, stream.value, inner, signal_ptr_slot);

        assignment_result.ensure_still_alive();

        // assert that it was updated
        debug_assert!(!buffer_stream.sink.signal.is_dead());

        if assignment_result.is_error() {
            return Err(bun_core::err!("PipeFailed"));
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            assignment_result.ensure_still_alive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    jsc::js_promise::Status::Pending => {
                        let cell = crate::api::NativePromiseContext::create(
                            global_this,
                            std::ptr::from_mut::<Self>(self),
                        );
                        // Zig: `catch {}` — termination is observed by the surrounding scope.
                        assignment_result.then_with_value(
                            global_this,
                            cell,
                            Bun__BodyValueBufferer__onResolveStream,
                            Bun__BodyValueBufferer__onRejectStream,
                        );
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        let _guard = jsc::js_value::Protected::adopt(stream.value);
                        self.handle_resolve_stream(false);
                    }
                    jsc::js_promise::Status::Rejected => {
                        let _guard = jsc::js_value::Protected::adopt(stream.value);
                        self.handle_reject_stream(promise.result(global_this.vm()), false);
                    }
                }
                return Ok(());
            }
        }

        Err(bun_core::err!("PipeFailed"))
    }

    fn buffer_locked_body_value(
        &mut self,
        value: &mut Value,
        owned_readable_stream: Option<ReadableStream>,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(matches!(value, Value::Locked(_)));
        let Value::Locked(locked) = value else {
            unreachable!()
        };
        let readable_stream = 'brk: {
            if let Some(stream) = locked.readable.get(self.global) {
                // keep the stream alive until we're done with it
                // Zig: `sink.readable_stream_ref = locked.readable;` — bitwise struct
                // copy that aliases the same Strong. Transfer ownership: `*value =
                // .Used` below would otherwise drop `locked.readable` anyway, so
                // moving the existing GC root preserves the Zig refcount balance.
                self.readable_stream_ref = core::mem::take(&mut locked.readable);
                break 'brk Some(stream);
            }
            if let Some(stream) = owned_readable_stream {
                // response owns the stream, so we hold a strong reference to it
                self.readable_stream_ref =
                    webcore::readable_stream::Strong::init(stream, self.global);
                break 'brk Some(stream);
            }
            None
        };
        if let Some(stream) = readable_stream {
            *value = Value::Used;

            if stream.is_locked(self.global) {
                return Err(bun_core::err!("StreamAlreadyUsed"));
            }

            match stream.ptr {
                webcore::readable_stream::Source::Invalid => {
                    return Err(bun_core::err!("InvalidStream"));
                }
                // toBlobIfPossible should've caught this
                webcore::readable_stream::Source::Blob(_)
                | webcore::readable_stream::Source::File(_) => unreachable!(),
                webcore::readable_stream::Source::JavaScript
                | webcore::readable_stream::Source::Direct => {
                    // this is broken right now
                    // return self.create_js_sink(stream);
                    return Err(bun_core::err!("UnsupportedStreamType"));
                }
                webcore::readable_stream::Source::Bytes(byte_stream_ptr) => {
                    // BACKREF: see `Source::bytes()` — payload owned by the
                    // readable stream, kept alive via `self.readable_stream_ref`
                    // above. R-2: all touched fields are interior-mutable.
                    let byte_stream = stream.ptr.bytes().expect("matched Bytes");
                    debug_assert!(byte_stream.pipe.get().ctx.is_none());
                    debug_assert!(self.byte_stream.is_none());

                    let bytes = byte_stream.buffer.get().as_slice();
                    // If we've received the complete body by the time this function is called
                    // we can avoid streaming it and just send it all at once.
                    if byte_stream.has_received_last_chunk.get() {
                        bun_core::scoped_log!(
                            BodyValueBufferer,
                            "byte stream has_received_last_chunk {}",
                            bytes.len()
                        );
                        (self.on_finished_buffering)(self.ctx, bytes, None, false);
                        // is safe to detach here because we're not going to receive any more data
                        stream.done(self.global);
                        return Ok(());
                    }

                    byte_stream
                        .pipe
                        .set(crate::webcore::Wrap::<Self>::init(self));
                    self.byte_stream = NonNull::new(byte_stream_ptr);
                    bun_core::scoped_log!(
                        BodyValueBufferer,
                        "byte stream pre-buffered {}",
                        bytes.len()
                    );

                    let _ = self.stream_buffer.write(bytes);
                    return Ok(());
                }
            }
        }

        // PORT NOTE: reshaped for borrowck — re-borrow locked after possible *value = Used above.
        let Value::Locked(locked) = value else {
            unreachable!()
        };

        if locked.on_receive_value.is_some() || locked.task.is_some() {
            // someone else is waiting for the stream or waiting for `onStartStreaming`
            let readable = value
                .to_readable_stream(self.global)
                .map_err(|_| bun_core::err!("JSError"))?;
            // TODO(port): Zig propagated bun.JSError here via `try`; bufferLockedBodyValue's
            // inferred error set includes JSError. Mapping to bun_core::Error for now.
            readable.ensure_still_alive();
            readable.protect();
            return self.buffer_locked_body_value(value, None);
        }
        // is safe to wait it buffer
        locked.task = Some(std::ptr::from_mut::<Self>(self).cast::<c_void>());
        locked.on_receive_value = Some(Self::on_receive_value);
        Ok(())
    }

    fn on_receive_value(ctx: *mut c_void, value: &mut Value) {
        // SAFETY: ctx was set from `self as *mut Self` in buffer_locked_body_value.
        let sink = unsafe { bun_ptr::callback_ctx::<Self>(ctx) };
        match value {
            Value::Error(err) => {
                bun_core::scoped_log!(BodyValueBufferer, "onReceiveValue Error");
                // See run(): produce a ref-bumped duplicate instead of `ptr::read`ing a
                // non-Copy owned value (would double-deref on drop).
                let err_copy = err.dupe(sink.global);
                (sink.on_finished_buffering)(sink.ctx, b"", Some(err_copy), true);
            }
            _ => {
                value.to_blob_if_possible();
                let mut input = value.use_as_any_blob_allow_non_utf8_string();
                let bytes = input.slice();
                bun_core::scoped_log!(BodyValueBufferer, "onReceiveValue {}", bytes.len());
                (sink.on_finished_buffering)(sink.ctx, bytes, None, true);
            }
        }
    }
}

// PORT NOTE: Zig's `Pipe.Wrap(Type, fn)` took a comptime fn pointer; the Rust
// `webcore::Wrap<T>` reshape requires `T: PipeHandler`.
impl<'a> crate::webcore::PipeHandler for ValueBufferer<'a> {
    fn on_pipe(&mut self, stream: streams::Result) {
        self.on_stream_pipe(stream)
    }
}

// comptime { @export(...) } → no_mangle extern "C" exports.
// TODO(port): // TODO(b2-blocked): #[bun_jsc::host_fn] on on_resolve_stream/on_reject_stream emits the JSC ABI shim;
// these no_mangle re-exports point at those shims under the C names the C++ side expects.
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__BodyValueBufferer__onResolveStream(
        global: *mut JSGlobalObject,
        callframe: *mut CallFrame,
    ) -> JSValue {
        // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
        // safe `*mut → &` via `opaque_deref` (JSC guarantees non-null/live).
        let (global, callframe) =
            (bun_opaque::opaque_deref(global), bun_opaque::opaque_deref(callframe));
        jsc::to_js_host_fn_result(global, ValueBufferer::on_resolve_stream(global, callframe))
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__BodyValueBufferer__onRejectStream(
        global: *mut JSGlobalObject,
        callframe: *mut CallFrame,
    ) -> JSValue {
        // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
        // safe `*mut → &` via `opaque_deref` (JSC guarantees non-null/live).
        let (global, callframe) =
            (bun_opaque::opaque_deref(global), bun_opaque::opaque_deref(callframe));
        jsc::to_js_host_fn_result(global, ValueBufferer::on_reject_stream(global, callframe))
    }
}

// ported from: src/runtime/webcore/Body.zig
