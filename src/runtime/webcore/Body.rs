//! https://developer.mozilla.org/en-US/docs/Web/API/Body

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_core::Output;
use bun_http_types::MimeType::MimeType;
use crate::webcore::jsc::{
    self as jsc, CallFrame, CommonAbortReason, DOMFormData, JSGlobalObject, JSPromise, JSValue,
    JsResult, Strong, SystemError, URLSearchParams, VirtualMachine,
};
use crate::webcore::{
    self, blob, streams, AnyBlob, Blob, ByteStream, DrainResult, FetchHeaders,
    Lifetime, Pipe, ReadableStream,
};
// Re-export so callers can write `body::InternalBlob` (mirrors Zig nested-type access).
pub use crate::webcore::InternalBlob;
use crate::jsc::HTTPHeaderName;
use bun_jsc::StringJsc as _;
use bun_str::{self as strings, MutableString, String as BunString, ZigString};
use bun_str::WTFStringImpl;
use bun_jsc::ZigStringJsc as _;

// ────────────────────────────────────────────────────────────────────────────
// Local shims for upstream-gated `JsClass` impls / `AnyPromise` methods.
// These adapt call sites in this file without editing `bun_jsc` (orphan rule).
// ────────────────────────────────────────────────────────────────────────────

#[inline]
fn as_dom_form_data(_value: JSValue) -> Option<*mut DOMFormData> {
    // TODO(port): blocked_on: bun_jsc::JsClass for DOMFormData (opaque stub_ty!).
    None
}
#[inline]
fn as_url_search_params(_value: JSValue) -> Option<*mut URLSearchParams> {
    // TODO(port): blocked_on: bun_jsc::JsClass for URLSearchParams (opaque stub_ty!).
    None
}
#[inline]
fn as_image(_value: JSValue) -> Option<*mut crate::image::Image> {
    // TODO(port): blocked_on: bun_jsc::JsClass for crate::image::Image
    // (`#[bun_jsc::JsClass]` not yet derived on Image).
    None
}

/// Local extension over `bun_jsc::AnyPromise` adding `wrap`/`resolve`/`reject`
/// (the upstream enum exposes only `as_value`/`status`/`set_handled`/`unwrap`;
/// the full impl lives in the gated `src/jsc/AnyPromise.rs`).
trait AnyPromiseExt {
    fn wrap_call<F>(self, global: &JSGlobalObject, f: F) -> JsTerminated<()>
    where
        F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>;
    fn resolve_value(self, global: &JSGlobalObject, value: JSValue) -> JsTerminated<()>;
    fn reject_value(self, global: &JSGlobalObject, value: JSValue) -> JsTerminated<()>;
    fn reject_value_with_async_stack(
        self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsTerminated<()>;
}
impl AnyPromiseExt for jsc::AnyPromise {
    fn wrap_call<F>(self, global: &JSGlobalObject, f: F) -> JsTerminated<()>
    where
        F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
    {
        // Mirror `AnyPromise.wrap` (AnyPromise.zig): run `f` through the host-call
        // wrapper so a thrown exception is converted to an Err, then resolve/reject
        // this existing promise with the outcome.
        match f(global) {
            Ok(v) => self.resolve_value(global, v),
            Err(_) => {
                let err = global.try_take_exception().unwrap_or(JSValue::UNDEFINED);
                self.reject_value(global, err)
            }
        }
    }
    fn resolve_value(self, global: &JSGlobalObject, value: JSValue) -> JsTerminated<()> {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        // `JSInternalPromise` subclasses `JSPromise` in C++; the pointer cast is sound.
        let p: *mut JSPromise = match self {
            jsc::AnyPromise::Normal(p) => p,
            jsc::AnyPromise::Internal(p) => p as *mut JSPromise,
        };
        unsafe { Ok((*p).resolve(global, value)?) }
    }
    fn reject_value(self, global: &JSGlobalObject, value: JSValue) -> JsTerminated<()> {
        // SAFETY: see `resolve_value`.
        let p: *mut JSPromise = match self {
            jsc::AnyPromise::Normal(p) => p,
            jsc::AnyPromise::Internal(p) => p as *mut JSPromise,
        };
        unsafe { Ok((*p).reject(global, Ok(value))?) }
    }
    fn reject_value_with_async_stack(
        self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsTerminated<()> {
        // TODO(port): `value.attach_async_stack_from_promise(global, self.as_js_promise())`
        // — `attach_async_stack_from_promise` is gated upstream. Fall back to plain reject.
        self.reject_value(global, value)
    }
}

bun_core::declare_scope!(BodyValue, visible);
bun_core::declare_scope!(BodyMixin, visible);
bun_core::declare_scope!(BodyValueBufferer, visible);

// TODO(port): `bun.JSTerminated!T` is a narrower error set than `bun.JSError`; using JsResult for now.
type JsTerminated<T> = jsc::JsResult<T>;

#[repr(C)]
pub struct Body {
    pub value: Value, // = Value::Empty,
}

impl Default for Body {
    fn default() -> Self { Self { value: Value::Empty } }
}

impl Body {
    // TODO(b2-blocked): Blob::get_size_for_bindings (gated in Blob.rs `_jsc_gated`).
    
    pub fn len(&mut self) -> blob::SizeType {
        self.value.size()
    }

    pub fn slice(&self) -> &[u8] {
        self.value.slice()
    }

    // TODO(b2-blocked): Blob::init(Vec<u8>, &JSGlobalObject) (gated in Blob.rs `_jsc_gated`).
    
    pub fn use_(&mut self) -> Blob {
        self.value.use_()
    }

    // TODO(b2-blocked): Value::clone (gated below).
    
    pub fn clone(&mut self, global_this: &JSGlobalObject) -> JsResult<Body> {
        Ok(Body {
            value: self.value.clone(global_this)?,
        })
    }

    
    pub fn clone_with_readable_stream(
        &mut self,
        global_this: &JSGlobalObject,
        readable: Option<&mut ReadableStream>,
    ) -> JsResult<Body> {
        Ok(Body {
            value: self.value.clone_with_readable_stream(global_this, readable)?,
        })
    }
}

// TODO(b2-blocked): bun_jsc::ConsoleFormatter — write_format depends on the
// ConsoleObject formatter trait (`print_as`/`print_comma`/`write_indent`).

impl Body {
    pub fn write_format<F, W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
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
                JSValue::from(matches!(self.value, Value::Used)),
                jsc::JSType::BooleanObject,
            )
            .map_err(|_| core::fmt::Error)?;

        let size = self.value.size();
        match &mut self.value {
            Value::Blob(blob) => {
                formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                blob.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
            }
            Value::InternalBlob(_) | Value::WTFStringImpl(_) => {
                formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                blob::write_format_for_size::<W, ENABLE_ANSI_COLORS>(false, size as usize, writer)?;
            }
            Value::Locked(locked) => {
                // SAFETY: `locked.global` is stored from a live `&JSGlobalObject` at
                // construction time; the JSC global object outlives every Body that holds it.
                let global = unsafe { &*locked.global };
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
    pub fn reset(&mut self) {
        self.value.reset();
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
            global: global as *const _,
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
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If the size is unknown will be 0
    fn size_hint(&self) -> blob::SizeType {
        if let Some(readable) = self.readable.get(unsafe { &*self.global }) {
            if let webcore::readable_stream::Source::Bytes(bytes) = readable.ptr {
                // TODO(b2-blocked): ByteStream is a stub unit struct in webcore.rs;
                // its `size_hint` field will return once the real ByteStream module
                // is wired in. Until then, fall through to `self.size_hint`.
                let _ = bytes;
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
        // SAFETY: `self.global` is stored from a live `&JSGlobalObject` at
        // construction time (see `PendingValue::new`); the JSC global object
        // outlives every Body that holds it.
        let global = unsafe { &*self.global };
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
                    use ReadableStreamConvert as _;
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

/// Local extension shim for `JSGlobalObject::readableStreamTo*` — the real
/// methods live in the cfg-gated `src/jsc/JSGlobalObject.rs`.
// TODO(b2-blocked): drop once `bun_jsc::JSGlobalObject::readable_stream_to_*` un-gates.
trait ReadableStreamConvert {
    fn readable_stream_to_json(&self, value: JSValue) -> JSValue;
    fn readable_stream_to_array_buffer(&self, value: JSValue) -> JSValue;
    fn readable_stream_to_bytes(&self, value: JSValue) -> JSValue;
    fn readable_stream_to_text(&self, value: JSValue) -> JSValue;
    fn readable_stream_to_blob(&self, value: JSValue) -> JSValue;
    fn readable_stream_to_form_data(&self, value: JSValue, content_type: JSValue) -> JSValue;
}
impl ReadableStreamConvert for JSGlobalObject {
    fn readable_stream_to_json(&self, _value: JSValue) -> JSValue {
        todo!("blocked_on: bun_jsc::JSGlobalObject::readable_stream_to_json")
    }
    fn readable_stream_to_array_buffer(&self, _value: JSValue) -> JSValue {
        todo!("blocked_on: bun_jsc::JSGlobalObject::readable_stream_to_array_buffer")
    }
    fn readable_stream_to_bytes(&self, _value: JSValue) -> JSValue {
        todo!("blocked_on: bun_jsc::JSGlobalObject::readable_stream_to_bytes")
    }
    fn readable_stream_to_text(&self, _value: JSValue) -> JSValue {
        todo!("blocked_on: bun_jsc::JSGlobalObject::readable_stream_to_text")
    }
    fn readable_stream_to_blob(&self, _value: JSValue) -> JSValue {
        todo!("blocked_on: bun_jsc::JSGlobalObject::readable_stream_to_blob")
    }
    fn readable_stream_to_form_data(&self, _value: JSValue, _content_type: JSValue) -> JSValue {
        todo!("blocked_on: bun_jsc::JSGlobalObject::readable_stream_to_form_data")
    }
}

/// Trait for types whose generated `.classes.ts` JS wrapper exposes a cached `body` property.
/// TODO(port): replaces Zig `comptime T: type` + `T.js.bodyGetCached(this_value)`.
pub trait BodyOwnerJs {
    fn body_get_cached(this_value: JSValue) -> Option<JSValue>;
}

// ────────────────────────────────────────────────────────────────────────────
// Value
// ────────────────────────────────────────────────────────────────────────────

/// This is a duplex stream!
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
    // TODO(port): LIFETIMES.tsv says Arc<WTFStringImpl>, but WTF::StringImpl is intrusively
    // refcounted by WebKit. Phase B should confirm whether bun_wtf::StringImpl is itself a
    // smart-pointer wrapper (in which case Arc<> double-counts).
    WTFStringImpl(std::sync::Arc<WTFStringImpl>),
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

// TODO(b2-blocked): bun_collections::HiveRef / hive_array::Fallback — not yet exported.
 const POOL_SIZE: usize = if bun_alloc::heap_breakdown::ENABLED { 0 } else { 256 };
 pub type HiveRef = bun_collections::HiveRef<Value, POOL_SIZE>;
 pub type HiveAllocator = bun_collections::hive_array::Fallback<HiveRef, POOL_SIZE>;

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
    pub fn to_stream_error(&mut self, global_object: &JSGlobalObject) -> streams::result::StreamError {
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
            ValueError::SystemError(_e) => {
                // SystemError lacks `Clone` in bun_jsc; Zig did `var v = this.*; v.ref();`
                // (bitwise copy + bump). Bitwise copy of a non-Copy upstream struct is
                // not expressible safely in Rust without `Clone`.
                todo!("blocked_on: bun_jsc::SystemError::Clone")
            }
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
    /// `offset_of!` (Zig: `@fieldParentPtr("value", this)`) and forward.
    ///
    /// # Safety
    /// `self` must be the `value` field of a live `HiveRef<Value, POOL_SIZE>`
    /// produced by `HiveRef::init`.
    pub unsafe fn unref(&mut self) -> Option<&mut Self> {
        // SAFETY: caller contract — `self` is the `.value` field of a HiveRef slot.
        let parent = unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(core::mem::offset_of!(HiveRef, value))
                .cast::<HiveRef>()
        };
        parent.unref().map(|h| &mut h.value)
    }

    /// See [`Value::unref`] for the safety contract.
    pub unsafe fn ref_(&mut self) -> &mut Self {
        // SAFETY: caller contract — `self` is the `.value` field of a HiveRef slot.
        let parent = unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(core::mem::offset_of!(HiveRef, value))
                .cast::<HiveRef>()
        };
        &mut parent.ref_().value
    }

    pub fn tag(&self) -> Tag {
        match self {
            Value::Blob(_) => Tag::Blob,
            Value::WTFStringImpl(_) => Tag::WTFStringImpl,
            Value::InternalBlob(_) => Tag::InternalBlob,
            Value::Locked(_) => Tag::Locked,
            Value::Used => Tag::Used,
            Value::Empty => Tag::Empty,
            Value::Error(_) => Tag::Error,
            Value::Null => Tag::Null,
        }
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
            Value::Blob(b) => b.size == 0,
            Value::WTFStringImpl(s) => (unsafe { (***s).length() }) == 0,
            Value::Error(_) | Value::Locked(_) => false,
        }
    }

    // TODO(b2-blocked): ZigStringSlice::slice() accessor + AnyBlob payload
    // matching depend on the wtf string slice port. `to_any_blob` itself is
    // un-gated above; only the WTFStringImpl→InternalBlob conversion blocks.
    
    pub fn to_blob_if_possible(&mut self) {
        if let Value::WTFStringImpl(str) = self {
            // SAFETY: `**str` derefs Arc → `*mut WTFStringImplStruct`; the pointee is
            // a live WTF::StringImpl kept alive by the intrusive refcount.
            if let Some(bytes) = unsafe { (***str).to_utf8_if_needed() } {
                // PORT NOTE: reshaped for borrowck — take str out before reassigning *self.
                let _str = core::mem::replace(self, Value::Null);
                // _str dropped at end of scope (deref via Arc Drop / intrusive deref).
                *self = Value::InternalBlob(InternalBlob {
                    bytes: bytes.slice().to_vec(),
                    // TODO(port): Zig used fromOwnedSlice on @constCast(bytes.slice()); ownership
                    // semantics depend on toUTF8IfNeeded contract — verify in Phase B.
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
                AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(std::sync::Arc::new(s)),
                // AnyBlob::InlineBlob(b) => Value::InlineBlob(b),
            };
        }
    }

    // TODO(b2-blocked): Blob::get_size_for_bindings (gated in Blob.rs `_jsc_gated`).
    
    pub fn size(&mut self) -> blob::SizeType {
        match self {
            Value::Blob(b) => b.get_size_for_bindings() as blob::SizeType,
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => (unsafe { (***s).utf8_byte_length() }) as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            // Value::InlineBlob(b) => b.slice_const().len() as blob::SizeType,
            _ => 0,
        }
    }

    pub fn fast_size(&self) -> blob::SizeType {
        match self {
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => unsafe { (***s).byte_slice() }.len() as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            // Value::InlineBlob(b) => b.slice_const().len() as blob::SizeType,
            _ => 0,
        }
    }

    pub fn memory_cost(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.memory_cost(),
            Value::WTFStringImpl(s) => unsafe { (***s).memory_cost() },
            Value::Locked(l) => l.size_hint() as usize,
            // Value::InlineBlob(b) => b.slice_const().len(),
            _ => 0,
        }
    }

    pub fn estimated_size(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.slice_const().len(),
            Value::WTFStringImpl(s) => unsafe { (***s).byte_slice() }.len(),
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
                let mut blob = self.use_();
                // defer blob.detach() — done below before return
                blob.resolve_size();
                let blob_size = blob.size;
                let value = ReadableStream::from_blob_copy_ref(global_this, &mut blob, blob_size)?;

                let stream = ReadableStream::from_js(value, global_this)?.unwrap();
                *self = Value::Locked(PendingValue {
                    readable: webcore::readable_stream::Strong::init(stream, global_this),
                    ..PendingValue::new(global_this)
                });
                blob.detach();
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

                // TODO(b2-blocked): `ByteStream::Source` (`NewSource<ByteStream>`) requires
                // the full `NewSource { context, cancelled, ref_count, ... }` field set and
                // `SourceContext` codegen externs to be wired. The Zig path:
                //   var reader = ByteStream.Source.new(.{ .context = undefined, .globalThis = ... });
                //   reader.context.setup(); reader.toReadableStream(...);
                // is not yet expressible against the current `readable_stream::NewSource` shape.
                let _ = (&locked.on_stream_cancelled, &locked.task, &drain_result);
                todo!("blocked_on: webcore::byte_stream::Source / readable_stream::NewSource<ByteStream>");
                #[allow(unreachable_code)]
                {
                locked.readable = webcore::readable_stream::Strong::init(
                    ReadableStream {
                        ptr: webcore::readable_stream::Source::Invalid,
                        value: JSValue::ZERO,
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

            debug_assert!(str.tag() == bun_str::Tag::WTFStringImpl);

            // Zig accessed `str.value.WTFStringImpl` directly; `leak_wtf_impl()` transfers
            // the +1 ref out of the bun_str::String wrapper.
            return Ok(Value::WTFStringImpl(std::sync::Arc::new(str.leak_wtf_impl())));
        }

        if js_type.is_typed_array_or_array_buffer() {
            if let Some(buffer) = value.as_array_buffer(global_this) {
                let bytes = buffer.byte_slice();

                if bytes.is_empty() {
                    return Ok(Value::Empty);
                }

                let owned = match bytes.to_vec().into_boxed_slice() {
                    // PORT NOTE: Zig used `catch` on dupe; Rust Vec aborts on OOM. Keeping the
                    // error path as a TODO since global allocator can't return Err here.
                    items => items,
                };
                // TODO(port): original threw "Failed to clone ArrayBufferView" on OOM.
                return Ok(Value::InternalBlob(InternalBlob {
                    bytes: owned.into_vec(),
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
            return Ok(Value::Blob(Blob::from_dom_form_data(global_this, unsafe { &mut *form_data })));
        }

        if let Some(search_params) = as_url_search_params(value) {
            // SAFETY: shim returns a live JSC heap cell.
            return Ok(Value::Blob(Blob::from_url_search_params(
                global_this,
                unsafe { &mut *search_params },
            )));
        }

        if js_type == jsc::JSType::DOMWrapper {
            if let Some(blob) = value.as_::<Blob>() {
                return Ok(Value::Blob(
                    // We must preserve "type" so that DOMFormData and the "type" field are preserved.
                    // SAFETY: as_ returns a live *mut Blob backed by a JS wrapper.
                    unsafe { (*blob).dupe_with_content_type(true) },
                ));
            }

            if let Some(image) = as_image(value) {
                // Body init is synchronous, so encode now and wrap as a Blob
                // with the right MIME type. The off-thread path is still
                // available via `await image.blob()`.
                // SAFETY: as_image returns a live *mut Image backed by a JS wrapper.
                let (encoded, mime) = unsafe { (*image).encode_for_body(global_this, value)? };
                // Blob.Store frees via an Allocator, so dupe out of the
                // codec's allocator here. The hot path (`.bytes()`) hands the
                // codec buffer to JS without this copy.
                // SAFETY: `encoded.bytes` is the codec-owned slice; copy then drop frees it.
                let owned: Box<[u8]> = Box::from(unsafe { encoded.bytes.as_ref() });
                drop(encoded);
                let mut blob = Blob::init(owned.into_vec(), global_this);
                blob.content_type = mime.as_bytes() as *const [u8];
                blob.content_type_was_set = true;
                return Ok(Value::Blob(blob));
            }
        }

        value.ensure_still_alive();

        if let Some(readable) = ReadableStream::from_js(value, global_this)? {
            if readable.is_disturbed(global_this) {
                return Err(global_this.throw("ReadableStream has already been used"));
            }

            match readable.ptr {
                webcore::readable_stream::Source::Blob(blob) => {
                    // SAFETY: `Source::Blob` holds a live *mut ByteBlobLoader for the
                    // lifetime of the ReadableStream JS wrapper.
                    let result = if let Some(any_blob) = unsafe { (*blob).to_any_blob(global_this) } {
                        match any_blob {
                            AnyBlob::Blob(b) => Value::Blob(b),
                            AnyBlob::InternalBlob(b) => Value::InternalBlob(b),
                            AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(std::sync::Arc::new(s)),
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
                    // TODO(port): Zig matched `error.InvalidArguments` from a wider error set;
                    // `JsResult` carries only `JsError`, so the message-selection branch
                    // collapses. Revisit once `Blob::get` carries a discriminator.
                    return Err(global_this.throw_invalid_arguments("Invalid Body object"));
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
        headers: Option<&FetchHeaders>,
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
                            promise.wrap_call(global, |g| blob.to_string_transfer(g))?;
                        }
                        _ => {
                            let mut blob = new.use_();
                            promise.wrap_call(global, |g| blob.to_string_transfer(g))?;
                        }
                    },
                    Action::GetJSON => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        let result = promise.wrap_call(global, |g| blob.to_json_share(g));
                        blob.detach();
                        result?;
                    }
                    Action::GetArrayBuffer => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap_call(global, |g| blob.to_array_buffer_transfer(g))?;
                    }
                    Action::GetBytes => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap_call(global, |g| blob.to_uint8_array_transfer(g))?;
                    }
                    Action::GetFormData(form_data_slot) => 'inner: {
                        let mut blob = new.use_as_any_blob();
                        let Some(_async_form_data) = form_data_slot.take() else {
                            // Zig: `defer blob.detach()` covers the `try promise.reject(...)` error path.
                            let r = promise.reject_value(
                                global,
                                ZigString::init(b"Internal error: task for FormData must not be null")
                                    .to_error_instance(global),
                            );
                            blob.detach();
                            r?;
                            break 'inner;
                        };
                        // TODO(port): `bun_core::form_data::AsyncFormData::to_js` —
                        // the bun_core stub has no `to_js`; `Action::GetFormData`
                        // payload is `Box<()>` until that lands.
                        let result: JsTerminated<()> = {
                            let _ = (global, blob.slice(), &promise);
                            todo!("blocked_on: bun_core::form_data::AsyncFormData::to_js")
                        };
                        blob.detach();
                        // async_form_data dropped (Box<AsyncFormData> -> Drop replaces deinit)
                        result?;
                    }
                    Action::None | Action::GetBlob => {
                        let blob_ptr = Blob::new(new.use_());
                        // SAFETY: `Blob::new` returns a freshly heap-allocated *mut Blob.
                        let blob = unsafe { &mut *blob_ptr };
                        if let Some(fetch_headers) = headers {
                            // SAFETY: `fast_get` only writes a stack out-param via FFI; the
                            // `&FetchHeaders` is an opaque C++ ZST handle (interior-mutable),
                            // so re-deriving `&mut` from the raw handle pointer is sound — no
                            // Rust-side state is aliased. Zig spec takes `?*FetchHeaders`.
                            #[allow(invalid_reference_casting)]
                            let fetch_headers = unsafe { &mut *(fetch_headers as *const FetchHeaders as *mut FetchHeaders) };
                            if let Some(content_type) = fetch_headers.fast_get(HTTPHeaderName::ContentType) {
                                let content_slice = content_type.to_slice();
                                let mut allocated = false;
                                let mime_type = MimeType::init(content_slice.slice(), true, Some(&mut allocated));
                                blob.content_type = mime_type.value.as_ref() as *const [u8];
                                blob.content_type_allocated = allocated;
                                blob.content_type_was_set = true;
                                if let Some(store) = blob.store.as_ref() {
                                    // SAFETY: store is a live StoreRef; single-threaded JS — no concurrent &Store.
                                    unsafe { (*store.as_ptr()).mime_type = mime_type };
                                }
                                // content_slice dropped (replaces defer content_slice.deinit())
                            }
                        }
                        if !blob.content_type_was_set && blob.store.is_some() {
                            blob.content_type = bun_http_types::MimeType::TEXT.value.as_ref() as *const [u8];
                            blob.content_type_allocated = false;
                            blob.content_type_was_set = true;
                            // SAFETY: store presence checked above; single-threaded JS — no concurrent &Store.
                            unsafe { (*blob.store.as_ref().unwrap().as_ptr()).mime_type = bun_http_types::MimeType::TEXT };
                        }
                        promise.resolve_value(global, blob.to_js(global))?;
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
                // SAFETY: WTFStringImpl is a non-null intrusive-refcounted ptr.
                let s = unsafe { &*(**s) };
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
            Value::Blob(_) => {
                // PORT NOTE: reshaped for borrowck — replace self first, then extract.
                let old = core::mem::replace(self, Value::Used);
                let Value::Blob(new_blob) = old else { unreachable!() };
                debug_assert!(!new_blob.is_heap_allocated()); // owned by Body
                new_blob
            }
            Value::InternalBlob(ib) => {
                // SAFETY: VirtualMachine::get() returns the live per-thread VM.
                let global = unsafe { &*(*VirtualMachine::get()).global };
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
            Value::WTFStringImpl(_) => {
                let old = core::mem::replace(self, Value::Used);
                let Value::WTFStringImpl(wtf) = old else { unreachable!() };
                // SAFETY: WTFStringImpl is a non-null intrusive-refcounted ptr; the +1 we
                // hold keeps it alive across `to_utf8_if_needed`/`latin1_slice`.
                let wtf_ref = unsafe { &**wtf };
                // SAFETY: VirtualMachine::get() returns the live per-thread VM.
                let global = unsafe { &*(*VirtualMachine::get()).global };
                let new_blob = if let Some(allocated_slice) = wtf_ref.to_utf8_if_needed() {
                    // TODO(port): Zig @constCast'd allocated_slice.slice() into an owned ArrayList.
                    Blob::init(allocated_slice.slice().to_vec(), global)
                } else {
                    Blob::init(wtf_ref.latin1_slice().to_vec(), global)
                };
                // wtf dropped here (deref via Drop)
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
                // SAFETY: WTFStringImpl is a non-null intrusive-refcounted ptr.
                if unsafe { (***str).can_use_as_utf8() } {
                    // PORT NOTE: Zig dups the +1 ref; until `Value::WTFStringImpl` drops the
                    // `Arc<>` wrapper, hand the raw ptr through (the *self = Used below
                    // releases our side).
                    AnyBlob::WTFStringImpl(**str)
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
        let any_blob: AnyBlob = match core::mem::replace(self, Value::Used) {
            Value::Blob(b) => AnyBlob::Blob(b),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(b),
            Value::WTFStringImpl(str) => 'brk: {
                // SAFETY: WTFStringImpl is a non-null intrusive-refcounted ptr.
                let wtf_ref = unsafe { &**str };
                if let Some(utf8) = wtf_ref.to_utf8_if_needed() {
                    // str dropped at end of scope (deref)
                    let bytes = utf8.slice().to_vec();
                    wtf_ref.deref();
                    break 'brk AnyBlob::InternalBlob(InternalBlob {
                        // TODO(port): Zig used fromOwnedSlice(@constCast(utf8.slice())).
                        bytes,
                        was_string: true,
                    });
                } else {
                    break 'brk AnyBlob::WTFStringImpl(*str);
                }
            }
            // Value::InlineBlob(b) => AnyBlob::InlineBlob(b),
            Value::Locked(mut l) => {
                let result = l.to_any_blob_allow_promise().unwrap_or(AnyBlob::Blob(Blob::default()));
                // PORT NOTE: reshaped — Zig kept Locked in place via &this.Locked; here we
                // moved it out via mem::replace. Put it back if we still need Locked state? No —
                // Zig overwrites *self below regardless.
                result
            }
            _ => AnyBlob::Blob(Blob::default()),
        };

        *self = if was_null { Value::Null } else { Value::Used };
        any_blob
    }

    // TODO(b2-blocked): see `try_use_as_any_blob`.
    
    pub fn use_as_any_blob_allow_non_utf8_string(&mut self) -> AnyBlob {
        let was_null = matches!(self, Value::Null);
        let any_blob: AnyBlob = match core::mem::replace(self, Value::Used) {
            Value::Blob(b) => AnyBlob::Blob(b),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(b),
            Value::WTFStringImpl(s) => AnyBlob::WTFStringImpl(*s),
            // Value::InlineBlob(b) => AnyBlob::InlineBlob(b),
            Value::Locked(mut l) => l
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
            // PORT NOTE: reshaped for borrowck — extract locked by value, then write Error.
            let old = core::mem::replace(self, Value::Error(err));
            let Value::Locked(mut locked) = old else { unreachable!() };
            let Value::Error(err_ref) = self else { unreachable!() };

            // Zig: `defer strong_readable.deinit()` — must run on every exit incl. `?` paths.
            let strong_readable = scopeguard::guard(
                core::mem::take(&mut locked.readable),
                |mut r| r.deinit(),
            );

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
                        promise.reject_value_with_async_stack(global, err_ref.to_js(global))?;
                    }
                }
            }

            // The Promise version goes before the ReadableStream version incase the Promise version is used too.
            // Avoid creating unnecessary duplicate JSValue.
            if let Some(readable) = strong_readable.get(global) {
                if let webcore::readable_stream::Source::Bytes(bytes) = readable.ptr {
                    // SAFETY: `Source::Bytes` holds a live *mut ByteStream for the lifetime
                    // of the ReadableStream JS wrapper.
                    unsafe { (*bytes).on_data(streams::Result::Err(err_ref.to_stream_error(global)))? };
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

    // TODO(port): not a clean Drop — mutates self to Null and is called explicitly at specific
    // protocol points. Renamed from `deinit` per PORTING.md (never expose `pub fn deinit(&mut self)`).
    pub fn reset(&mut self) {
        let tag = self.tag();
        if tag == Tag::Locked {
            let Value::Locked(locked) = self else { unreachable!() };
            if !locked.deinit {
                locked.deinit = true;
                locked.readable.deinit();
                locked.readable = Default::default();
            }
            return;
        }

        if tag == Tag::InternalBlob {
            // PORT NOTE: `Internal::clear_and_free` not yet ported; the Zig
            // body just freed the backing list. Taking the Vec drops it.
            if let Value::InternalBlob(ib) = self {
                let _ = core::mem::take(ib);
            }
            *self = Value::Null;
        }

        if tag == Tag::Blob {
            if let Value::Blob(b) = self {
                b.deinit();
            }
            *self = Value::Null;
        }

        if tag == Tag::WTFStringImpl {
            // Dropping the Arc derefs it.
            *self = Value::Null;
        }

        if tag == Tag::Error {
            if let Value::Error(e) = self {
                e.reset();
            }
        }
    }

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
                locked.readable =
                    webcore::readable_stream::Strong::init(rs0, global_this);
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

        let mut reader = webcore::readable_stream::NewSource::<ByteStream>::new(
            webcore::readable_stream::NewSource {
                context: ByteStream::default(),
                global_this,
                ..Default::default()
            },
        );

        reader.context.setup();

        match drain_result {
            DrainResult::EstimatedSize(estimated_size) => {
                reader.context.high_water_mark = estimated_size as blob::SizeType;
                reader.context.size_hint = estimated_size as blob::SizeType;
            }
            DrainResult::Owned { list, size_hint } => {
                reader.context.buffer = list;
                reader.context.size_hint = size_hint as blob::SizeType;
            }
            _ => {}
        }

        // PORT NOTE: reshaped for borrowck — re-borrow locked after the early *self = Null path above.
        let Value::Locked(locked) = self else { unreachable!() };

        let context_ptr: *mut ByteStream = &mut reader.context;
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

        if let Value::WTFStringImpl(s) = self {
            // SAFETY: WTFStringImpl is a non-null intrusive-refcounted ptr; bump +1.
            unsafe { (***s).r#ref() };
            return Ok(Value::WTFStringImpl(std::sync::Arc::new(**s)));
        }

        if matches!(self, Value::Null) {
            return Ok(Value::Null);
        }

        Ok(Value::Empty)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// JSC-integration: extract / BodyMixin (host-fn methods) / ValueBufferer.
// TODO(b2-blocked): bun_jsc::* — host_fn proc-macro, JSValue/JSPromise methods,
// bun_core::form_data, ArrayBufferSink, blob::read_file. The BodyMixin trait
// is referenced by Response/Request as a marker — a stub trait is provided
// outside this gate so `impl BodyMixin for Response/Request {}` type-checks.
// ────────────────────────────────────────────────────────────────────────────

mod _jsc_gated {
use super::*;
use crate::webcore::sink::{self, ArrayBufferSink};

// PORT NOTE: Zig `ArrayBufferSink.JSSink` is a nested type from `Sink.JSSink(@This(), name)`.
// Rust uses a free generic `sink::JSSink<T>` (inherent associated types are unstable).
type ArrayBufferJSSink = sink::JSSink<ArrayBufferSink>;

// https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
pub fn extract(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Body> {
    let mut body = Body { value: Value::Null };

    body.value = Value::from_js(global_this, value)?;
    if let Value::Blob(b) = &body.value {
        debug_assert!(!b.is_heap_allocated()); // owned by Body
    }
    Ok(body)
}

// ────────────────────────────────────────────────────────────────────────────
// Mixin
// ────────────────────────────────────────────────────────────────────────────

/// `pub fn Mixin(comptime Type: type) type` → trait with provided methods.
/// Implementers supply `get_body_value`, `get_fetch_headers`, `get_form_data_encoding`,
/// and optionally override `get_body_readable_stream` (Zig `@hasDecl` check).
pub trait BodyMixin: BodyOwnerJs + Sized {
    fn get_body_value(&mut self) -> &mut Value;
    fn get_fetch_headers(&self) -> Option<&FetchHeaders>;
    fn get_form_data_encoding(&mut self) -> JsResult<Option<Box<bun_core::form_data::AsyncFormData>>>;

    /// Default: None. Override to enable the `@hasDecl(Type, "getBodyReadableStream")` paths.
    /// TODO(port): Zig used `@hasDecl` to gate this at comptime; here it's a default method.
    /// Takes `&mut self` so Response/Request (whose inherent impls mutate `js_ref`/body
    /// state) can override it; the trait-default callers below all hold `&mut self`.
    fn get_body_readable_stream(
        &mut self,
        _global_object: &JSGlobalObject,
    ) -> Option<ReadableStream> {
        None
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    fn get_text(
        &mut self,
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
    fn get_body(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
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
    fn get_body_used(&mut self, global_object: &JSGlobalObject) -> JSValue {
        // PORT NOTE: reshaped for borrowck — `get_body_readable_stream` needs `&mut self`,
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
    fn get_json(
        &mut self,
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
        &mut self,
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
                    return locked.set_promise(global_object, Action::GetArrayBuffer, Some(readable));
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
        &mut self,
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
        &mut self,
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
                    format_args!("Can't decode form data from body because of incorrect MIME type/boundary"),
                )
                .reject());
        };

        let value = self.get_body_value();
        if let Value::Locked(locked) = value {
            let owned_readable = self.get_body_readable_stream(global_object);
            // PORT NOTE: reshaped for borrowck — re-borrow after self method call.
            let value = self.get_body_value();
            let Value::Locked(locked) = value else { unreachable!() };
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
            bun_core::form_data::Encoding::Multipart(b) => webcore::form_data::Encoding::Multipart(b),
        };
        // encoder dropped at end of scope (replaces defer encoder.deinit())

        let js_value = match webcore::form_data::FormData::to_js(global_object, blob.slice(), &encoding) {
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
    fn get_blob(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.get_blob_with_this_value(global_object, callframe.this())
    }

    fn get_blob_with_this_value(
        &mut self,
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
                let Value::Locked(locked) = value else { unreachable!() };
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
            // TODO(port): Blob.content_type is `*const [u8]` and StoreRef has no
            // public `mime_type` setter yet; full content-type/mime-type plumbing
            // pending the Blob/Store port. Preserve the Zig logic structure but
            // defer the field assignments.
            let _ = self.get_fetch_headers();
            let _ = HTTPHeaderName::ContentType;
            todo!("blocked_on: webcore::blob::Blob content_type/MimeType plumbing");
        }
        #[allow(unreachable_code)]
        Ok(JSPromise::resolved_promise_value(
            global_object,
            blob.to_js(global_object),
        ))
    }

    fn get_blob_without_call_frame(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.get_blob_with_this_value(global_object, JSValue::ZERO)
    }
}

fn handle_body_already_used(global_object: &JSGlobalObject) -> JSValue {
    global_object
        .err(jsc::ErrorCode::BODY_ALREADY_USED, format_args!("Body already used"))
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
        jsc::to_js_host_call(global_object, f(this, global_object, lifetime))
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
        if let Some(mut byte_stream) = self.byte_stream {
            // SAFETY: kept alive by readable_stream_ref while set
            unsafe { byte_stream.as_mut() }.unpipe_without_deref();
        }
        self.readable_stream_ref.deinit();

        if let Some(_buffer_stream) = self.js_sink.take() {
            // TODO(blocked_on: webcore::sink::ArrayBufferSink): JSSink::detach /
            // ArrayBufferSink::destroy not yet ported; create_js_sink (the only
            // path that populates js_sink) is itself stubbed out.
            todo!("blocked_on: webcore::sink::JSSink::detach / ArrayBufferSink::destroy");
        }
    }
}

impl<'a> ValueBufferer<'a> {
    pub fn init(ctx: *mut c_void, on_finish: ValueBuffererCallback, global: &'a JSGlobalObject) -> Self {
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
                    if let AnyBlob::Blob(_blob) = &mut input {
                        // TODO(blocked_on: blob::read_file): module is `#![cfg(any())]`-gated.
                        // _blob.do_read_file_internal(self, Self::on_finished_loading_file, self.global);
                        todo!("blocked_on: blob::read_file::do_read_file_internal");
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

    // TODO(blocked_on: blob::read_file): `blob::read_file` is `#![cfg(any())]`-gated;
    // restore the real `ReadFileResultType` parameter and match body once ungated.
    #[allow(dead_code)]
    fn on_finished_loading_file(&mut self /*, bytes: blob::read_file::ReadFileResultType */) {
        todo!("blocked_on: blob::read_file::ReadFileResultType");
        // match bytes {
        //     blob::read_file::ReadFileResultType::Err(err) => {
        //         bun_core::scoped_log!(BodyValueBufferer, "onFinishedLoadingFile Error");
        //         (self.on_finished_buffering)(self.ctx, b"", Some(ValueError::SystemError(err)), true);
        //     }
        //     blob::read_file::ReadFileResultType::Result(data) => {
        //         bun_core::scoped_log!(BodyValueBufferer, "onFinishedLoadingFile Data {}", data.buf.len());
        //         (self.on_finished_buffering)(self.ctx, &data.buf, None, true);
        //         if data.is_temporary { drop(data.buf); }
        //     }
        // }
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

    // TODO(b2-blocked): #[bun_jsc::host_fn]
    pub fn on_resolve_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let Some(mut sink) =
            crate::api::NativePromiseContext::take::<Self>(args.ptr[args.len - 1])
        else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: NativePromiseContext::take returns the live ctx pointer set in create().
        unsafe { sink.as_mut() }.handle_resolve_stream(true);
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn]
    pub fn on_reject_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let Some(mut sink) =
            crate::api::NativePromiseContext::take::<Self>(args.ptr[args.len - 1])
        else {
            return Ok(JSValue::UNDEFINED);
        };
        let err = args.ptr[0];
        // SAFETY: NativePromiseContext::take returns the live ctx pointer set in create().
        unsafe { sink.as_mut() }.handle_reject_stream(err, true);
        Ok(JSValue::UNDEFINED)
    }

    fn handle_reject_stream(&mut self, err: JSValue, is_async: bool) {
        if let Some(_wrapper) = self.js_sink.take() {
            // TODO(blocked_on: webcore::sink::ArrayBufferSink): see Drop impl above.
            todo!("blocked_on: webcore::sink::JSSink::detach / ArrayBufferSink::destroy");
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
        if let Some(_wrapper) = &self.js_sink {
            // TODO(blocked_on: webcore::sink::ArrayBufferSink): `bytes` field
            // not yet present on the stub ArrayBufferSink.
            let bytes: &[u8] =
                todo!("blocked_on: webcore::sink::ArrayBufferSink.bytes");
            #[allow(unreachable_code)]
            {
                bun_core::scoped_log!(BodyValueBufferer, "handleResolveStream {}", bytes.len());
                (self.on_finished_buffering)(self.ctx, bytes, None, is_async);
            }
        } else {
            bun_core::scoped_log!(BodyValueBufferer, "handleResolveStream no sink");
            (self.on_finished_buffering)(self.ctx, b"", None, is_async);
        }
    }

    #[allow(dead_code)]
    fn create_js_sink(&mut self, stream: ReadableStream) -> Result<(), bun_core::Error> {
        // The Zig caller has this path commented out ("this is broken right now"
        // — see buffer_locked_body_value below). ArrayBufferSink is currently a
        // unit-struct stub without `bytes`/`signal`/`JsSinkAbi`, and
        // `JSValue::then_with_value` is not yet bound. Restore from
        // src/runtime/webcore/Body.zig:1639 once those land.
        let _ = stream;
        todo!("blocked_on: webcore::sink::ArrayBufferSink + bun_jsc::JSValue::then_with_value");
    }

    fn buffer_locked_body_value(
        &mut self,
        value: &mut Value,
        owned_readable_stream: Option<ReadableStream>,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(matches!(value, Value::Locked(_)));
        let Value::Locked(locked) = value else { unreachable!() };
        let readable_stream = 'brk: {
            if let Some(stream) = locked.readable.get(self.global) {
                // keep the stream alive until we're done with it
                // PORT NOTE: Zig copied the Strong by value (struct copy). Rust's
                // `readable_stream::Strong` is non-Clone (owns a GC root), so create
                // a fresh strong ref to the same stream value instead.
                self.readable_stream_ref =
                    webcore::readable_stream::Strong::init(stream, self.global);
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
                    // SAFETY: `Source::Bytes` holds a live `*mut ByteStream` owned by the
                    // readable stream; kept alive via `self.readable_stream_ref` above.
                    let byte_stream = unsafe { &mut *byte_stream_ptr };
                    debug_assert!(byte_stream.pipe.ctx.is_none());
                    debug_assert!(self.byte_stream.is_none());

                    let bytes = byte_stream.buffer.as_slice();
                    // If we've received the complete body by the time this function is called
                    // we can avoid streaming it and just send it all at once.
                    if byte_stream.has_received_last_chunk {
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

                    byte_stream.pipe = crate::webcore::Wrap::<Self>::init(self);
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
        let Value::Locked(locked) = value else { unreachable!() };

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
        locked.task = Some(self as *mut Self as *mut c_void);
        locked.on_receive_value = Some(Self::on_receive_value);
        Ok(())
    }

    fn on_receive_value(ctx: *mut c_void, value: &mut Value) {
        // SAFETY: ctx was set from `self as *mut Self` in buffer_locked_body_value.
        let sink = unsafe { &mut *(ctx as *mut Self) };
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
#[unsafe(no_mangle)]
pub extern "C" fn Bun__BodyValueBufferer__onResolveStream(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    // TODO(port): proc-macro — jsc::to_js_host_fn wraps the Rust host fn into JSC ABI.
    jsc::to_js_host_fn(ValueBufferer::on_resolve_stream)(global, callframe)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__BodyValueBufferer__onRejectStream(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    jsc::to_js_host_fn(ValueBufferer::on_reject_stream)(global, callframe)
}

} // mod _jsc_gated

pub use _jsc_gated::{extract, ValueBufferer};

/// Stub `BodyMixin` so `impl BodyMixin for Response/Request {}` type-checks
/// while the real trait (with `get_text`/`get_json`/etc. host-fn defaults)
/// is gated above. The real trait extends `BodyOwnerJs` and provides ~9
/// default-method bodies that call JSC.
// TODO(b2-blocked): replace with `pub use _jsc_gated::BodyMixin;`.
pub trait BodyMixin: Sized {}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/Body.zig (1833 lines)
//   confidence: medium
//   todos:      26
//   notes:      Value/PendingValue carry <'a> from JSC_BORROW global per LIFETIMES.tsv — cascades widely; Mixin reshaped to trait (BodyMixin + BodyOwnerJs); WTFStringImpl mapped to Arc<> per TSV but is intrusively refcounted (verify); several borrowck reshapes around &mut self in match arms; deinit() renamed reset() (in-place state transition, not Drop); ValueBufferer callback receives bitwise ValueError copies to match Zig — ownership needs Phase B audit.
// ──────────────────────────────────────────────────────────────────────────
