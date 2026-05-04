//! https://developer.mozilla.org/en-US/docs/Web/API/Body

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_core::Output;
use bun_http::MimeType;
use bun_jsc::{
    self as jsc, CallFrame, CommonAbortReason, DOMFormData, JSGlobalObject, JSPromise, JSValue,
    JsResult, Strong, SystemError, URLSearchParams, VirtualMachine,
};
use bun_runtime::webcore::{
    self, streams, AnyBlob, Blob, ByteStream, DrainResult, FetchHeaders, InternalBlob, Lifetime,
    Pipe, ReadableStream,
};
use bun_runtime::webcore::sink::ArrayBufferSink;
use bun_str::{self as strings, MutableString, String as BunString, ZigString};
use bun_wtf::StringImpl as WTFStringImpl;

bun_output::declare_scope!(BodyValue, visible);
bun_output::declare_scope!(BodyMixin, visible);
bun_output::declare_scope!(BodyValueBufferer, visible);

// TODO(port): `bun.JSTerminated!T` is a narrower error set than `bun.JSError`; using JsResult for now.
type JsTerminated<T> = bun_jsc::JsResult<T>;

pub struct Body<'a> {
    pub value: Value<'a>, // = Value::Empty,
}

impl<'a> Body<'a> {
    pub fn len(&self) -> blob::SizeType {
        self.value.size()
    }

    pub fn slice(&self) -> &[u8] {
        self.value.slice()
    }

    pub fn use_(&mut self) -> Blob {
        self.value.use_()
    }

    pub fn clone(&mut self, global_this: &JSGlobalObject) -> JsResult<Body<'a>> {
        Ok(Body {
            value: self.value.clone(global_this)?,
        })
    }

    pub fn clone_with_readable_stream(
        &mut self,
        global_this: &JSGlobalObject,
        readable: Option<&mut ReadableStream>,
    ) -> JsResult<Body<'a>> {
        Ok(Body {
            value: self.value.clone_with_readable_stream(global_this, readable)?,
        })
    }

    pub fn write_format<F, W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> Result<(), bun_core::Error>
    where
        F: bun_jsc::ConsoleFormatter, // TODO(port): exact trait for ConsoleObject.Formatter
    {
        formatter.write_indent(writer)?;
        writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>bodyUsed<d>:<r> "))?;
        formatter.print_as(
            jsc::FormatAs::Boolean,
            writer,
            JSValue::from(matches!(self.value, Value::Used)),
            jsc::JSType::BooleanObject,
            ENABLE_ANSI_COLORS,
        )?;

        match &self.value {
            Value::Blob(blob) => {
                formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                blob.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
            }
            Value::InternalBlob(_) | Value::WTFStringImpl(_) => {
                formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
                writer.write_str("\n")?;
                formatter.write_indent(writer)?;
                Blob::write_format_for_size::<W, ENABLE_ANSI_COLORS>(false, self.value.size(), writer)?;
            }
            Value::Locked(locked) => {
                if let Some(stream) = locked.readable.get(locked.global) {
                    formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    formatter.print_as(
                        jsc::FormatAs::Object,
                        writer,
                        stream.value,
                        stream.value.js_type(),
                        ENABLE_ANSI_COLORS,
                    )?;
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
impl<'a> Body<'a> {
    pub fn reset(&mut self) {
        self.value.reset();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PendingValue
// ────────────────────────────────────────────────────────────────────────────

pub struct PendingValue<'a> {
    pub promise: Option<JSValue>,
    pub readable: webcore::readable_stream::Strong,
    // writable: webcore::Sink

    pub global: &'a JSGlobalObject,
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

impl<'a> Default for PendingValue<'a> {
    fn default() -> Self {
        // TODO(port): `global` has no Zig default; callers must always set it. This Default
        // is only for convenient `..Default::default()` field-init at call sites that DO set global.
        unreachable!("PendingValue must be constructed with `global` set")
    }
}

impl<'a> PendingValue<'a> {
    pub fn new(global: &'a JSGlobalObject) -> Self {
        Self {
            promise: None,
            readable: webcore::readable_stream::Strong::default(),
            global,
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

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If the size is unknown will be 0
    fn size_hint(&self) -> blob::SizeType {
        if let Some(readable) = self.readable.get(self.global) {
            if let webcore::readable_stream::Ptr::Bytes(bytes) = &readable.ptr {
                return bytes.size_hint;
            }
        }
        self.size_hint
    }

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
            if ReadableStream::is_disturbed_value(body_value, global_object) {
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

    pub fn is_streaming_or_buffering(&self) -> bool {
        self.readable.held.has()
            || self
                .promise
                .map_or(false, |p| !p.is_empty_or_undefined_or_null())
    }

    pub fn to_any_blob_allow_promise(&mut self) -> Option<AnyBlob> {
        let mut stream = self.readable.get(self.global)?;

        if let Some(blob) = stream.to_any_blob(self.global) {
            self.readable.deinit();
            return Some(blob);
        }

        None
    }

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
                                bun_core::FormDataEncoding::Multipart(multipart) => {
                                    BunString::init(multipart).to_js(global_this)?
                                }
                                bun_core::FormDataEncoding::URLEncoded => JSValue::UNDEFINED,
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

/// Trait for types whose generated `.classes.ts` JS wrapper exposes a cached `body` property.
/// TODO(port): replaces Zig `comptime T: type` + `T.js.bodyGetCached(this_value)`.
pub trait BodyOwnerJs {
    fn body_get_cached(this_value: JSValue) -> Option<JSValue>;
}

// ────────────────────────────────────────────────────────────────────────────
// Value
// ────────────────────────────────────────────────────────────────────────────

/// This is a duplex stream!
pub enum Value<'a> {
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
    Locked(PendingValue<'a>),
    Used,
    Empty,
    Error(ValueError),
    Null,
}

// TODO(port): bun.heap_breakdown.enabled is a build-time flag.
const POOL_SIZE: usize = if cfg!(feature = "heap_breakdown") { 0 } else { 256 };
pub type HiveRef<'a> = bun_collections::HiveRef<Value<'a>, POOL_SIZE>;
pub type HiveAllocator<'a> = bun_collections::hive_array::Fallback<HiveRef<'a>, POOL_SIZE>;

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
            ValueError::SystemError(e) => {
                let mut v = e.clone();
                v.ref_();
                ValueError::SystemError(v)
            }
            ValueError::Message(m) => {
                let mut v = m.clone();
                v.ref_();
                ValueError::Message(v)
            }
            ValueError::TypeError(m) => {
                let mut v = m.clone();
                v.ref_();
                ValueError::TypeError(v)
            }
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

    // TODO(port): not a clean Drop — resets self to safe-empty in place. Renamed from `deinit`
    // per PORTING.md (never expose `pub fn deinit(&mut self)`).
    pub fn reset(&mut self) {
        match self {
            ValueError::SystemError(system_error) => system_error.deref(),
            ValueError::Message(message) => message.deref(),
            ValueError::TypeError(message) => message.deref(),
            ValueError::JSValue(v) => v.deinit(),
            ValueError::AbortReason(_) => {}
        }
        // safe empty value after deinit
        *self = ValueError::JSValue(jsc::strong::Optional::empty());
    }
}

impl<'a> Value<'a> {
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

    // We may not have all the data yet
    // So we can't know for sure if it's empty or not
    // We CAN know that it is definitely empty.
    pub fn is_definitely_empty(&self) -> bool {
        match self {
            Value::Null => true,
            Value::Used | Value::Empty => true,
            Value::InternalBlob(b) => b.slice().is_empty(),
            Value::Blob(b) => b.size == 0,
            Value::WTFStringImpl(s) => s.length() == 0,
            Value::Error(_) | Value::Locked(_) => false,
        }
    }

    pub fn was_string(&self) -> bool {
        match self {
            Value::InternalBlob(blob) => blob.was_string,
            Value::WTFStringImpl(_) => true,
            _ => false,
        }
    }

    pub fn to_blob_if_possible(&mut self) {
        if let Value::WTFStringImpl(str) = self {
            if let Some(bytes) = str.to_utf8_if_needed() {
                // PORT NOTE: reshaped for borrowck — take str out before reassigning *self.
                let _str = core::mem::replace(self, Value::Null);
                // _str dropped at end of scope (deref via Arc Drop / intrusive deref).
                *self = Value::InternalBlob(InternalBlob {
                    bytes: Vec::from(bytes.slice()),
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
                AnyBlob::WTFStringImpl(s) => Value::WTFStringImpl(s),
                // AnyBlob::InlineBlob(b) => Value::InlineBlob(b),
            };
        }
    }

    pub fn size(&self) -> blob::SizeType {
        match self {
            Value::Blob(b) => b.get_size_for_bindings() as blob::SizeType,
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => s.utf8_byte_length() as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            // Value::InlineBlob(b) => b.slice_const().len() as blob::SizeType,
            _ => 0,
        }
    }

    pub fn fast_size(&self) -> blob::SizeType {
        match self {
            Value::InternalBlob(b) => b.slice_const().len() as blob::SizeType,
            Value::WTFStringImpl(s) => s.byte_slice().len() as blob::SizeType,
            Value::Locked(l) => l.size_hint(),
            // Value::InlineBlob(b) => b.slice_const().len() as blob::SizeType,
            _ => 0,
        }
    }

    pub fn memory_cost(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.bytes.len(),
            Value::WTFStringImpl(s) => s.memory_cost(),
            Value::Locked(l) => l.size_hint() as usize,
            // Value::InlineBlob(b) => b.slice_const().len(),
            _ => 0,
        }
    }

    pub fn estimated_size(&self) -> usize {
        match self {
            Value::InternalBlob(b) => b.slice_const().len(),
            Value::WTFStringImpl(s) => s.byte_slice().len(),
            Value::Locked(l) => l.size_hint() as usize,
            // Value::InlineBlob(b) => b.slice_const().len(),
            _ => 0,
        }
    }

    pub fn create_blob_value(data: Vec<u8>, was_string: bool) -> Value<'a> {
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

    pub fn to_readable_stream(&mut self, global_this: &'a JSGlobalObject) -> JsResult<JSValue> {
        jsc::mark_binding(core::panic::Location::caller());

        match self {
            Value::Used => Ok(ReadableStream::used(global_this)),
            Value::Empty => Ok(ReadableStream::empty(global_this)),
            Value::Null => Ok(JSValue::NULL),
            Value::InternalBlob(_) | Value::Blob(_) | Value::WTFStringImpl(_) => {
                let mut blob = self.use_();
                // defer blob.detach() — done below before return
                blob.resolve_size();
                let value = ReadableStream::from_blob_copy_ref(global_this, &mut blob, blob.size)?;

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
                    return Ok(ReadableStream::used(global_this));
                }
                let mut drain_result = DrainResult::EstimatedSize(0);

                if let Some(drain) = locked.on_start_streaming.take() {
                    drain_result = drain(locked.task.unwrap());
                }

                if matches!(drain_result, DrainResult::Empty | DrainResult::Aborted) {
                    *self = Value::Null;
                    return Ok(ReadableStream::empty(global_this));
                }

                let reader = ByteStream::Source::new(ByteStream::SourceInit {
                    // TODO(port): `context: undefined` — Phase B should confirm Source::new zero-inits.
                    context: Default::default(),
                    global_this,
                });

                if let Some(on_cancelled) = locked.on_stream_cancelled {
                    if let Some(task) = locked.task {
                        reader.cancel_handler = Some(on_cancelled);
                        reader.cancel_ctx = Some(task);
                    }
                }

                reader.context.setup();

                match &drain_result {
                    DrainResult::EstimatedSize(estimated_size) => {
                        reader.context.high_water_mark = *estimated_size as blob::SizeType;
                        reader.context.size_hint = *estimated_size as blob::SizeType;
                    }
                    DrainResult::Owned(owned) => {
                        reader.context.buffer = owned.list;
                        reader.context.size_hint = owned.size_hint as blob::SizeType;
                    }
                    _ => {}
                }

                locked.readable = webcore::readable_stream::Strong::init(
                    ReadableStream {
                        ptr: webcore::readable_stream::Ptr::Bytes(&mut reader.context),
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
                Ok(ReadableStream::empty(global_this))
            }
        }
    }

    pub fn from_js(global_this: &'a JSGlobalObject, value: JSValue) -> JsResult<Value<'a>> {
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

            return Ok(Value::WTFStringImpl(str.into_wtf_string_impl()));
            // TODO(port): Zig accessed str.value.WTFStringImpl directly; depends on bun_str::String layout.
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

        if let Some(form_data) = value.as_::<DOMFormData>() {
            return Ok(Value::Blob(Blob::from_dom_form_data(global_this, form_data)));
        }

        if let Some(search_params) = value.as_::<URLSearchParams>() {
            return Ok(Value::Blob(Blob::from_url_search_params(
                global_this,
                search_params,
            )));
        }

        if js_type == jsc::JSType::DOMWrapper {
            if let Some(blob) = value.as_::<Blob>() {
                return Ok(Value::Blob(
                    // We must preserve "type" so that DOMFormData and the "type" field are preserved.
                    blob.dupe_with_content_type(true),
                ));
            }

            if let Some(image) = value.as_::<bun_runtime::api::Image>() {
                // Body init is synchronous, so encode now and wrap as a Blob
                // with the right MIME type. The off-thread path is still
                // available via `await image.blob()`.
                let out = image.encode_for_body(global_this, value)?;
                // Blob.Store frees via an Allocator, so dupe out of the
                // codec's allocator here. The hot path (`.bytes()`) hands the
                // codec buffer to JS without this copy.
                let owned: Box<[u8]> = Box::from(out.bytes.bytes());
                out.bytes.deinit();
                let mut blob = Blob::init(owned.into_vec(), global_this);
                blob.content_type = out.mime;
                blob.content_type_was_set = true;
                return Ok(Value::Blob(blob));
            }
        }

        value.ensure_still_alive();

        if let Some(readable) = ReadableStream::from_js(value, global_this)? {
            if readable.is_disturbed(global_this) {
                return Err(global_this.throw("ReadableStream has already been used"));
            }

            match &readable.ptr {
                webcore::readable_stream::Ptr::Blob(blob) => {
                    let result = if let Some(any_blob) = blob.to_any_blob(global_this) {
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

        let blob = match Blob::get(global_this, value, true, false) {
            Ok(b) => b,
            Err(err) => {
                if !global_this.has_exception() {
                    if err == bun_core::err!("InvalidArguments") {
                        return Err(global_this.throw_invalid_arguments("Expected an Array"));
                    }
                    return Err(global_this.throw_invalid_arguments("Invalid Body object"));
                }
                return Err(bun_jsc::JsError::Thrown);
            }
        };
        Ok(Value::Blob(blob))
    }

    pub fn from_readable_stream_without_lock_check(
        readable: ReadableStream,
        global_this: &'a JSGlobalObject,
    ) -> Value<'a> {
        Value::Locked(PendingValue {
            readable: webcore::readable_stream::Strong::init(readable, global_this),
            ..PendingValue::new(global_this)
        })
    }

    pub fn resolve(
        to_resolve: &mut Value<'a>,
        new: &mut Value<'a>,
        global: &JSGlobalObject,
        headers: Option<&FetchHeaders>,
    ) -> JsTerminated<()> {
        bun_output::scoped_log!(BodyValue, "resolve");
        if let Value::Locked(locked) = to_resolve {
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
                            promise.wrap(global, AnyBlob::to_string_transfer, (&mut blob, global))?;
                        }
                        _ => {
                            let mut blob = new.use_();
                            promise.wrap(global, Blob::to_string_transfer, (&mut blob, global))?;
                        }
                    },
                    Action::GetJSON => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        let result = promise.wrap(global, AnyBlob::to_json_share, (&mut blob, global));
                        blob.detach();
                        result?;
                    }
                    Action::GetArrayBuffer => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap(global, AnyBlob::to_array_buffer_transfer, (&mut blob, global))?;
                    }
                    Action::GetBytes => {
                        let mut blob = new.use_as_any_blob_allow_non_utf8_string();
                        promise.wrap(global, AnyBlob::to_uint8_array_transfer, (&mut blob, global))?;
                    }
                    Action::GetFormData(form_data_slot) => 'inner: {
                        let mut blob = new.use_as_any_blob();
                        let Some(async_form_data) = form_data_slot.take() else {
                            // Zig: `defer blob.detach()` covers the `try promise.reject(...)` error path.
                            let r = promise.reject(
                                global,
                                ZigString::init(b"Internal error: task for FormData must not be null")
                                    .to_error_instance(global),
                            );
                            blob.detach();
                            r?;
                            break 'inner;
                        };
                        let result = async_form_data.to_js(global, blob.slice(), &promise);
                        blob.detach();
                        // async_form_data dropped (Box<AsyncFormData> -> Drop replaces deinit)
                        result?;
                    }
                    Action::None | Action::GetBlob => {
                        let mut blob = Blob::new(new.use_());
                        if let Some(fetch_headers) = headers {
                            if let Some(content_type) = fetch_headers.fast_get(FetchHeaders::ContentType) {
                                let content_slice = content_type.to_slice();
                                let mut allocated = false;
                                let mime_type = MimeType::init(content_slice.slice(), &mut allocated);
                                blob.content_type = mime_type.value;
                                blob.content_type_allocated = allocated;
                                blob.content_type_was_set = true;
                                if let Some(store) = blob.store.as_mut() {
                                    store.mime_type = mime_type;
                                }
                                // content_slice dropped (replaces defer content_slice.deinit())
                            }
                        }
                        if !blob.content_type_was_set && blob.store.is_some() {
                            blob.content_type = MimeType::TEXT.value;
                            blob.content_type_allocated = false;
                            blob.content_type_was_set = true;
                            blob.store.as_mut().unwrap().mime_type = MimeType::TEXT;
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
                let new_blob = Blob::init(
                    ib.to_owned_slice(),
                    // we will never resize it from here
                    // we have to use the default allocator
                    // even if it was actually allocated on a different thread
                    VirtualMachine::get().global,
                );
                *self = Value::Used;
                new_blob
            }
            Value::WTFStringImpl(_) => {
                let old = core::mem::replace(self, Value::Used);
                let Value::WTFStringImpl(wtf) = old else { unreachable!() };
                let new_blob = if let Some(allocated_slice) = wtf.to_utf8_if_needed() {
                    // TODO(port): Zig @constCast'd allocated_slice.slice() into an owned ArrayList.
                    Blob::init(allocated_slice.into_owned(), VirtualMachine::get().global)
                } else {
                    Blob::init(wtf.latin1_slice().to_vec(), VirtualMachine::get().global)
                };
                // wtf dropped here (deref via Arc Drop)
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
            _ => Blob::init_empty(core::ptr::null_mut() /* undefined */),
        }
    }

    pub fn try_use_as_any_blob(&mut self) -> Option<AnyBlob> {
        let any_blob: AnyBlob = match self {
            Value::Blob(b) => AnyBlob::Blob(core::mem::take(b)),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(core::mem::take(b)),
            Value::WTFStringImpl(str) => {
                if str.can_use_as_utf8() {
                    AnyBlob::WTFStringImpl(str.clone())
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

    pub fn use_as_any_blob(&mut self) -> AnyBlob {
        let was_null = matches!(self, Value::Null);
        let any_blob: AnyBlob = match core::mem::replace(self, Value::Used) {
            Value::Blob(b) => AnyBlob::Blob(b),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(b),
            Value::WTFStringImpl(str) => 'brk: {
                if let Some(utf8) = str.to_utf8_if_needed() {
                    // str dropped at end of scope (deref)
                    break 'brk AnyBlob::InternalBlob(InternalBlob {
                        // TODO(port): Zig used fromOwnedSlice(@constCast(utf8.slice())).
                        bytes: utf8.into_owned(),
                        was_string: true,
                    });
                } else {
                    break 'brk AnyBlob::WTFStringImpl(str);
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
            _ => AnyBlob::Blob(Blob::init_empty(core::ptr::null_mut() /* undefined */)),
        };

        *self = if was_null { Value::Null } else { Value::Used };
        any_blob
    }

    pub fn use_as_any_blob_allow_non_utf8_string(&mut self) -> AnyBlob {
        let was_null = matches!(self, Value::Null);
        let any_blob: AnyBlob = match core::mem::replace(self, Value::Used) {
            Value::Blob(b) => AnyBlob::Blob(b),
            Value::InternalBlob(b) => AnyBlob::InternalBlob(b),
            Value::WTFStringImpl(s) => AnyBlob::WTFStringImpl(s),
            // Value::InlineBlob(b) => AnyBlob::InlineBlob(b),
            Value::Locked(mut l) => l
                .to_any_blob_allow_promise()
                .unwrap_or(AnyBlob::Blob(Blob::default())),
            _ => AnyBlob::Blob(Blob::init_empty(core::ptr::null_mut() /* undefined */)),
        };

        *self = if was_null { Value::Null } else { Value::Used };
        any_blob
    }

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
                    if promise.status() == jsc::PromiseStatus::Pending {
                        promise.reject_with_async_stack(global, err_ref.to_js(global))?;
                    }
                }
            }

            // The Promise version goes before the ReadableStream version incase the Promise version is used too.
            // Avoid creating unnecessary duplicate JSValue.
            if let Some(readable) = strong_readable.get(global) {
                if let webcore::readable_stream::Ptr::Bytes(bytes) = &readable.ptr {
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
            if let Value::InternalBlob(ib) = self {
                ib.clear_and_free();
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

    pub fn tee(
        &mut self,
        global_this: &'a JSGlobalObject,
        owned_readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value<'a>> {
        let Value::Locked(locked) = self else {
            // TODO(port): Zig assumed self.* == .Locked at entry (caller guarantees).
            unreachable!("tee() called on non-Locked Value");
        };
        if let Some(readable) = owned_readable {
            if readable.is_disturbed(global_this) {
                return Ok(Value::Used);
            }

            if let Some(new_readable) = readable.tee(global_this)? {
                // Keep the current readable as a strong reference when cloning, and return the second one in the result.
                // This will be checked and downgraded to a write barrier if needed.
                locked.readable =
                    webcore::readable_stream::Strong::init(new_readable[0], global_this);
                return Ok(Value::Locked(PendingValue {
                    readable: webcore::readable_stream::Strong::init(new_readable[1], global_this),
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

        let reader = ByteStream::Source::new(ByteStream::SourceInit {
            context: Default::default(),
            global_this,
        });

        reader.context.setup();

        match &drain_result {
            DrainResult::EstimatedSize(estimated_size) => {
                reader.context.high_water_mark = *estimated_size as blob::SizeType;
                reader.context.size_hint = *estimated_size as blob::SizeType;
            }
            DrainResult::Owned(owned) => {
                reader.context.buffer = owned.list;
                reader.context.size_hint = owned.size_hint as blob::SizeType;
            }
            _ => {}
        }

        // PORT NOTE: reshaped for borrowck — re-borrow locked after the early *self = Null path above.
        let Value::Locked(locked) = self else { unreachable!() };

        locked.readable = webcore::readable_stream::Strong::init(
            ReadableStream {
                ptr: webcore::readable_stream::Ptr::Bytes(&mut reader.context),
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

    pub fn clone(&mut self, global_this: &'a JSGlobalObject) -> JsResult<Value<'a>> {
        self.clone_with_readable_stream(global_this, None)
    }

    pub fn clone_with_readable_stream(
        &mut self,
        global_this: &'a JSGlobalObject,
        readable: Option<&mut ReadableStream>,
    ) -> JsResult<Value<'a>> {
        self.to_blob_if_possible();

        if matches!(self, Value::Locked(_)) {
            return self.tee(global_this, readable);
        }

        if let Value::InternalBlob(internal_blob) = self {
            let owned = internal_blob.to_owned_slice();
            *self = Value::Blob(Blob::init(owned, global_this));
        }

        if let Value::Blob(b) = self {
            return Ok(Value::Blob(b.dupe()));
        }

        if let Value::WTFStringImpl(s) = self {
            // Arc::clone == ref()
            return Ok(Value::WTFStringImpl(s.clone()));
        }

        if matches!(self, Value::Null) {
            return Ok(Value::Null);
        }

        Ok(Value::Empty)
    }
}

// https://github.com/WebKit/webkit/blob/main/Source/WebCore/Modules/fetch/FetchBody.cpp#L45
pub fn extract<'a>(global_this: &'a JSGlobalObject, value: JSValue) -> JsResult<Body<'a>> {
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
    fn get_body_value(&mut self) -> &mut Value<'_>;
    fn get_fetch_headers(&self) -> Option<&FetchHeaders>;
    fn get_form_data_encoding(&mut self) -> JsResult<Option<Box<bun_core::form_data::AsyncFormData>>>;

    /// Default: None. Override to enable the `@hasDecl(Type, "getBodyReadableStream")` paths.
    /// TODO(port): Zig used `@hasDecl` to gate this at comptime; here it's a default method.
    fn get_body_readable_stream(&self, _global_object: &JSGlobalObject) -> Option<ReadableStream> {
        None
    }

    #[bun_jsc::host_fn(method)]
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
        Ok(JSPromise::wrap(
            global_object,
            lifetime_wrap(AnyBlob::to_string, Lifetime::Transfer),
            (&mut blob, global_object),
        ))
    }

    #[bun_jsc::host_fn(getter)]
    fn get_body(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let body = self.get_body_value();

        if matches!(body, Value::Used) {
            return Ok(ReadableStream::used(global_this));
        }
        if matches!(body, Value::Locked(_)) {
            if let Some(readable) = self.get_body_readable_stream(global_this) {
                return Ok(readable.value);
            }
        }
        self.get_body_value().to_readable_stream(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    fn get_body_used(&mut self, global_object: &JSGlobalObject) -> JSValue {
        let used = match self.get_body_value() {
            Value::Used => true,
            Value::Locked(pending) => 'brk: {
                if !pending.action.is_none() {
                    break 'brk true;
                }
                if let Some(readable) = self.get_body_readable_stream(global_object) {
                    break 'brk readable.is_disturbed(global_object);
                }
                if let Some(stream) = pending.readable.get(global_object) {
                    break 'brk stream.is_disturbed(global_object);
                }
                false
            }
            _ => false,
        };
        JSValue::from(used)
    }

    #[bun_jsc::host_fn(method)]
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
                drop(locked);
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetJSON, None);
                }
            }
        }

        let value = self.get_body_value();
        let mut blob = value.use_as_any_blob_allow_non_utf8_string();
        Ok(JSPromise::wrap(
            global_object,
            lifetime_wrap(AnyBlob::to_json, Lifetime::Share),
            (&mut blob, global_object),
        ))
    }

    #[bun_jsc::host_fn(method)]
    fn get_array_buffer(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(BodyMixin, "getArrayBuffer");
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
                drop(locked);
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
        Ok(JSPromise::wrap(
            global_object,
            lifetime_wrap(AnyBlob::to_array_buffer, Lifetime::Transfer),
            (&mut blob, global_object),
        ))
    }

    #[bun_jsc::host_fn(method)]
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
                drop(locked);
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
        Ok(JSPromise::wrap(
            global_object,
            lifetime_wrap(AnyBlob::to_uint8_array, Lifetime::Transfer),
            (&mut blob, global_object),
        ))
    }

    #[bun_jsc::host_fn(method)]
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
                drop(locked);
                let value = self.get_body_value();
                value.to_blob_if_possible();
            }
        }

        let Some(encoder) = self.get_form_data_encoding()? else {
            // TODO: catch specific errors from getFormDataEncoding
            return Ok(global_object
                .err(jsc::ErrorCode::FORMDATA_PARSE_ERROR)
                .message("Can't decode form data from body because of incorrect MIME type/boundary")
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
        let encoding = encoder.encoding;
        // encoder dropped at end of scope (replaces defer encoder.deinit())

        let js_value = match bun_core::form_data::to_js(global_object, blob.slice(), encoding) {
            Ok(v) => v,
            Err(err) => {
                blob.detach();
                return Ok(global_object
                    .err(jsc::ErrorCode::FORMDATA_PARSE_ERROR)
                    .message(format_args!("FormData parse error {}", err.name()))
                    .reject());
            }
        };
        blob.detach();

        Ok(JSPromise::wrap_value(global_object, js_value))
    }

    #[bun_jsc::host_fn(method)]
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
                drop(locked);
                let value = self.get_body_value();
                value.to_blob_if_possible();
                if let Value::Locked(locked) = value {
                    return locked.set_promise(global_object, Action::GetBlob, None);
                }
            }
        }

        let value = self.get_body_value();
        let mut blob = Blob::new(value.use_());
        if blob.content_type.is_empty() {
            if let Some(fetch_headers) = self.get_fetch_headers() {
                if let Some(content_type) = fetch_headers.fast_get(FetchHeaders::ContentType) {
                    let content_slice = content_type.to_slice();
                    let mut allocated = false;
                    let mime_type = MimeType::init(content_slice.slice(), &mut allocated);
                    blob.content_type = mime_type.value;
                    blob.content_type_allocated = allocated;
                    blob.content_type_was_set = true;
                    if let Some(store) = blob.store.as_mut() {
                        store.mime_type = mime_type;
                    }
                    // content_slice dropped (replaces defer content_slice.deinit())
                }
            }
            if !blob.content_type_was_set && blob.store.is_some() {
                blob.content_type = MimeType::TEXT.value;
                blob.content_type_allocated = false;
                blob.content_type_was_set = true;
                blob.store.as_mut().unwrap().mime_type = MimeType::TEXT;
            }
        }
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
        .err(jsc::ErrorCode::BODY_ALREADY_USED)
        .message("Body already used")
        .reject()
}

// TODO(port): `lifetimeWrap` returns a fn at comptime in Zig. In Rust this needs either a
// const-generic dispatch on `Lifetime` or a closure. Stubbing the shape; Phase B should
// inline the wrapped call (jsc::to_js_host_call) at each callsite or use a macro.
fn lifetime_wrap(
    f: fn(&mut AnyBlob, &JSGlobalObject, Lifetime) -> JsResult<JSValue>,
    lifetime: Lifetime,
) -> impl Fn(&mut AnyBlob, &JSGlobalObject) -> JSValue {
    move |this, global_object| {
        jsc::to_js_host_call(global_object, core::panic::Location::caller(), || {
            f(this, global_object, lifetime)
        })
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

    pub js_sink: Option<Box<ArrayBufferSink::JSSink>>,
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
            // SAFETY: kept alive by readable_stream_ref while set
            unsafe { byte_stream.as_ref() }.unpipe_without_deref();
        }
        self.readable_stream_ref.deinit();

        if let Some(buffer_stream) = self.js_sink.take() {
            buffer_stream.detach(self.global);
            buffer_stream.sink.destroy();
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
        value: &mut Value<'_>,
        owned_readable_stream: Option<ReadableStream>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set — Zig used inferred `!void` with StreamAlreadyUsed/InvalidStream/etc.
        value.to_blob_if_possible();

        match value {
            Value::Used => {
                bun_output::scoped_log!(BodyValueBufferer, "Used");
                return Err(bun_core::err!("StreamAlreadyUsed"));
            }
            Value::Empty | Value::Null => {
                bun_output::scoped_log!(BodyValueBufferer, "Empty");
                (self.on_finished_buffering)(self.ctx, b"", None, false);
                return Ok(());
            }
            Value::Error(err) => {
                bun_output::scoped_log!(BodyValueBufferer, "Error");
                // Zig passes `err` by bitwise value copy with no ref bump; mirror exactly.
                // SAFETY: ValueError is plain data in Zig (no Drop on the copy); callback owns
                // neither original nor copy refcount-wise — matches Zig 1:1.
                // TODO(port): callback ownership — verify no double-free once ValueError gains Drop.
                let err_copy = unsafe { core::ptr::read(err) };
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
                        blob.do_read_file_internal(self, Self::on_finished_loading_file, self.global);
                    }
                } else {
                    let bytes = input.slice();
                    bun_output::scoped_log!(BodyValueBufferer, "Blob {}", bytes.len());
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
                bun_output::scoped_log!(BodyValueBufferer, "onFinishedLoadingFile Error");
                (self.on_finished_buffering)(self.ctx, b"", Some(ValueError::SystemError(err)), true);
            }
            blob::read_file::ReadFileResultType::Result(data) => {
                bun_output::scoped_log!(
                    BodyValueBufferer,
                    "onFinishedLoadingFile Data {}",
                    data.buf.len()
                );
                (self.on_finished_buffering)(self.ctx, &data.buf, None, true);
                if data.is_temporary {
                    // data.buf dropped (Box<[u8]> Drop replaces allocator.free)
                    drop(data.buf);
                }
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
        bun_output::scoped_log!(BodyValueBufferer, "onStreamPipe chunk {}", chunk.len());
        let _ = self.stream_buffer.write(chunk);
        if stream_.is_done() {
            let bytes = self.stream_buffer.list.as_slice();
            bun_output::scoped_log!(BodyValueBufferer, "onStreamPipe done {}", bytes.len());
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

    #[bun_jsc::host_fn]
    pub fn on_resolve_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old(2);
        let Some(sink) =
            bun_runtime::api::NativePromiseContext::take::<Self>(args.ptr[args.len - 1])
        else {
            return Ok(JSValue::UNDEFINED);
        };
        sink.handle_resolve_stream(true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn on_reject_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old(2);
        let Some(sink) =
            bun_runtime::api::NativePromiseContext::take::<Self>(args.ptr[args.len - 1])
        else {
            return Ok(JSValue::UNDEFINED);
        };
        let err = args.ptr[0];
        sink.handle_reject_stream(err, true);
        Ok(JSValue::UNDEFINED)
    }

    fn handle_reject_stream(&mut self, err: JSValue, is_async: bool) {
        if let Some(wrapper) = self.js_sink.take() {
            wrapper.detach(self.global);
            wrapper.sink.destroy();
        }
        // Zig: `var ref = ...; defer ref.deinit(); sink.onFinishedBuffering(..., .{ .JSValue = ref }, ...);`
        // — passes a bitwise copy into the callback and *always* deinits the local afterward.
        let ref_ = scopeguard::guard(
            jsc::strong::Optional::create(err, self.global),
            |mut r| r.deinit(),
        );
        // SAFETY: bitwise copy of Strong.Optional matches Zig's by-value struct pass; the
        // scopeguard above deinits the original exactly as Zig's `defer ref.deinit()` does.
        // TODO(port): callback ownership — Zig's pattern relies on callback not retaining the
        // Strong past this call; verify in Phase B.
        let ref_copy = unsafe { core::ptr::read(&*ref_) };
        (self.on_finished_buffering)(self.ctx, b"", Some(ValueError::JSValue(ref_copy)), is_async);
    }

    fn handle_resolve_stream(&mut self, is_async: bool) {
        if let Some(wrapper) = &self.js_sink {
            let bytes = wrapper.sink.bytes.slice();
            bun_output::scoped_log!(BodyValueBufferer, "handleResolveStream {}", bytes.len());
            (self.on_finished_buffering)(self.ctx, bytes, None, is_async);
        } else {
            bun_output::scoped_log!(BodyValueBufferer, "handleResolveStream no sink");
            (self.on_finished_buffering)(self.ctx, b"", None, is_async);
        }
    }

    fn create_js_sink(&mut self, stream: ReadableStream) -> Result<(), bun_core::Error> {
        stream.value.ensure_still_alive();
        let mut buffer_stream = Box::new(ArrayBufferSink::JSSink {
            sink: ArrayBufferSink {
                bytes: bun_collections::ByteList::empty(),
                next: None,
                ..Default::default()
            },
        });
        let global_this = self.global;
        let signal = &mut buffer_stream.sink.signal;

        *signal = ArrayBufferSink::JSSink::SinkSignal::init(JSValue::ZERO);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();
        debug_assert!(signal.is_dead());

        // SAFETY: signal.ptr is *anyopaque in Zig; passing &mut as **c_void.
        let signal_ptr = &mut signal.ptr as *mut _ as *mut *mut c_void;

        let buffer_stream_ptr: *mut ArrayBufferSink::JSSink = &mut *buffer_stream;
        self.js_sink = Some(buffer_stream);

        let assignment_result: JSValue = ArrayBufferSink::JSSink::assign_to_stream(
            global_this,
            stream.value,
            buffer_stream_ptr,
            signal_ptr,
        );

        assignment_result.ensure_still_alive();

        // assert that it was updated
        // SAFETY: buffer_stream_ptr is still valid (boxed in self.js_sink)
        debug_assert!(!unsafe { &(*buffer_stream_ptr).sink.signal }.is_dead());

        if assignment_result.is_error() {
            return Err(bun_core::err!("PipeFailed"));
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            assignment_result.ensure_still_alive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    jsc::PromiseStatus::Pending => {
                        let cell = bun_runtime::api::NativePromiseContext::create(global_this, self);
                        let _ = assignment_result.then_with_value(
                            global_this,
                            cell,
                            Self::on_resolve_stream,
                            Self::on_reject_stream,
                        );
                    }
                    jsc::PromiseStatus::Fulfilled => {
                        self.handle_resolve_stream(false);
                        stream.value.unprotect();
                    }
                    jsc::PromiseStatus::Rejected => {
                        self.handle_reject_stream(promise.result(global_this.vm()), false);
                        stream.value.unprotect();
                    }
                }
                return Ok(());
            }
        }

        Err(bun_core::err!("PipeFailed"))
    }

    fn buffer_locked_body_value(
        &mut self,
        value: &mut Value<'_>,
        owned_readable_stream: Option<ReadableStream>,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(matches!(value, Value::Locked(_)));
        let Value::Locked(locked) = value else { unreachable!() };
        let readable_stream = 'brk: {
            if let Some(stream) = locked.readable.get(self.global) {
                // keep the stream alive until we're done with it
                self.readable_stream_ref = locked.readable.clone();
                // TODO(port): Zig copied the Strong by value (struct copy); verify Strong is Clone.
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
                webcore::readable_stream::Ptr::Invalid => {
                    return Err(bun_core::err!("InvalidStream"));
                }
                // toBlobIfPossible should've caught this
                webcore::readable_stream::Ptr::Blob(_)
                | webcore::readable_stream::Ptr::File(_) => unreachable!(),
                webcore::readable_stream::Ptr::JavaScript(_)
                | webcore::readable_stream::Ptr::Direct(_) => {
                    // this is broken right now
                    // return self.create_js_sink(stream);
                    return Err(bun_core::err!("UnsupportedStreamType"));
                }
                webcore::readable_stream::Ptr::Bytes(byte_stream) => {
                    debug_assert!(byte_stream.pipe.ctx.is_null());
                    debug_assert!(self.byte_stream.is_none());

                    let bytes = byte_stream.buffer.as_slice();
                    // If we've received the complete body by the time this function is called
                    // we can avoid streaming it and just send it all at once.
                    if byte_stream.has_received_last_chunk {
                        bun_output::scoped_log!(
                            BodyValueBufferer,
                            "byte stream has_received_last_chunk {}",
                            bytes.len()
                        );
                        (self.on_finished_buffering)(self.ctx, bytes, None, false);
                        // is safe to detach here because we're not going to receive any more data
                        stream.done(self.global);
                        return Ok(());
                    }

                    byte_stream.pipe = Pipe::wrap::<Self>(Self::on_stream_pipe).init(self);
                    self.byte_stream = Some(NonNull::from(byte_stream));
                    bun_output::scoped_log!(
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

    fn on_receive_value(ctx: *mut c_void, value: &mut Value<'_>) {
        // SAFETY: ctx was set from `self as *mut Self` in buffer_locked_body_value.
        let sink = unsafe { &mut *(ctx as *mut Self) };
        match value {
            Value::Error(err) => {
                bun_output::scoped_log!(BodyValueBufferer, "onReceiveValue Error");
                // Zig passes `err` by bitwise value copy with no ref bump; mirror exactly.
                // SAFETY: matches Zig's struct-by-value pass; see run() above.
                // TODO(port): callback ownership — verify no double-free once ValueError gains Drop.
                let err_copy = unsafe { core::ptr::read(err) };
                (sink.on_finished_buffering)(sink.ctx, b"", Some(err_copy), true);
            }
            _ => {
                value.to_blob_if_possible();
                let mut input = value.use_as_any_blob_allow_non_utf8_string();
                let bytes = input.slice();
                bun_output::scoped_log!(BodyValueBufferer, "onReceiveValue {}", bytes.len());
                (sink.on_finished_buffering)(sink.ctx, bytes, None, true);
            }
        }
    }
}

// comptime { @export(...) } → no_mangle extern "C" exports.
// TODO(port): #[bun_jsc::host_fn] on on_resolve_stream/on_reject_stream emits the JSC ABI shim;
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

// Re-export module path aliases used above.
mod blob {
    pub use bun_runtime::webcore::Blob;
    pub type SizeType = super::Blob::SizeType;
    pub use bun_runtime::webcore::blob::read_file;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/Body.zig (1833 lines)
//   confidence: medium
//   todos:      26
//   notes:      Value/PendingValue carry <'a> from JSC_BORROW global per LIFETIMES.tsv — cascades widely; Mixin reshaped to trait (BodyMixin + BodyOwnerJs); WTFStringImpl mapped to Arc<> per TSV but is intrusively refcounted (verify); several borrowck reshapes around &mut self in match arms; deinit() renamed reset() (in-place state transition, not Drop); ValueBufferer callback receives bitwise ValueError copies to match Zig — ownership needs Phase B audit.
// ──────────────────────────────────────────────────────────────────────────
