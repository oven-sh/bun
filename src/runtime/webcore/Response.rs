use core::cell::Cell;
use core::mem;

use bun_jsc::JsCell;
use bun_jsc::{AbortSignal, GlobalRef};
use bun_ptr::RefPtr;

use crate::webcore::jsc::{
    BuiltinName, CallFrame, HTTPHeaderName, JSGlobalObject, JSType, JSValue, JsError, JsRef,
    JsResult, StringJsc as _,
};
use bun_core::Output;
use bun_core::{String as BunString, Utf8Bytes};
use bun_http_types::Method::Method;

use super::body::{Body, BodyMixin, Value as BodyValue, ValueError as BodyValueError};
use super::{FetchHeaders, ReadableStream, Request};

// Codegen (`generated_classes.rs`) re-exports `Blob` from
// `crate::webcore::response` because the `.classes.ts` source path is
// `bun.jsc.WebCore.response.Blob`. Keep this `pub use` so that resolves.
pub use super::blob::Blob;
pub use bun_jsc::HeadersRef;
use bun_ptr::weak_ptr::{HasWeakPtrData, WeakPtrData};

/// Errors the owning fetch `Response`'s body on abort (Fetch spec "abort a fetch" step 4).
pub(crate) struct BodyAbortListener {
    /// Our listener on the signal (and reference on it); dropped with the Response.
    registration: Cell<Option<bun_jsc::AbortListenerRegistration>>,
    /// `Response` owns this, so a ref-counted pointer here would cycle.
    response: bun_ptr::BackRef<Response, bun_ptr::Root>,
    global: GlobalRef,
}

impl bun_jsc::NativeAbortListener for BodyAbortListener {
    fn on_abort(this: bun_ptr::ThisPtr<Self>, reason: JSValue) {
        reason.ensure_still_alive();
        // Copy out up front: erroring a still-streaming body can re-enter and
        // drop the response's last other ref via
        // `FetchTasklet::abandon_response_body`, destroying this listener.
        let (response, global) = (this.response, this.global);
        let _keepalive = bun_ptr::RefPtr::from_this(response.this_ptr());
        if !matches!(
            response.body_value().get(),
            BodyValue::Used | BodyValue::Error(_) | BodyValue::Null | BodyValue::Empty
        ) {
            // Not `get_body_readable_stream`: its `js_ref()` path reads a raw
            // JSValue to a wrapper that may be unmarked but not yet swept,
            // reaching a `NewSource` the source cell's (PreciseAllocation)
            // destructor already freed. `Locked.readable` is a real `JSC::Weak`
            // on the stream and reads `None` exactly when it is gone.
            if let BodyValue::Locked(locked) = response.body_value().get() {
                if let Some(readable) = locked.readable.get() {
                    readable.value.ensure_still_alive();
                    crate::dispatch::fold(readable.error(&global, reason));
                }
            }
            let err = BodyValueError::JSValue(bun_jsc::strong::Optional::create(reason, &global));
            // R-2: re-derive after `error()` ran JS.
            let _ = response
                .body_value()
                .with_mut(|value| value.to_error_instance(err, &global));
        }
    }
}

// `jsc.Codegen.JSResponse` — the real bindings, emitted by
// `js_class_module!` in `bun_jsc::generated`.
pub mod js {
    pub use bun_jsc::generated::JSResponse::*;
}
/// Typed `from_js`. The `js::` module erases the payload to `*mut ()`
/// (Response is defined above the `bun_jsc` crate, so `js_class_module!`
/// can't name it).
#[inline]
pub fn from_js(value: JSValue) -> Option<*mut Response> {
    js::from_js(value).map(<*mut ()>::cast::<Response>)
}

// Routes through the codegen'd `JSResponse` wrappers; `to_js` goes through the
// inherent [`Response::to_js`] so generic `<T: JsClass>::to_js` callers also run
// `calculate_estimated_byte_size`, seed `js_ref`, and migrate a Locked-body
// stream into the GC slot.
impl bun_jsc::JsClass for Response {
    fn from_js(value: JSValue) -> Option<*mut Self> {
        from_js(value)
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        js::from_js_direct(value).map(<*mut ()>::cast::<Response>)
    }
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        Response::to_js(self, global)
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        js::get_constructor(global)
    }
}

/// R-2 (`sharedThis`): every JS-facing host-fn takes `&Response` (not
/// `&mut Response`) so re-entrant JS calls cannot stack two `&mut` to the same
/// instance. Fields mutated by host-fns are therefore wrapped in `Cell` (Copy
/// scalars) or `JsCell` (non-Copy `init`/`url`/`js_ref`); `body` is itself a
/// `JsCell` wrapper. Both are `#[repr(transparent)]`, so `#[repr(C)]` field
/// layout is unchanged.
///
/// The allocation is refcounted: the JS wrapper owns one reference (released in
/// [`Response::finalize`]); fetch and HTMLRewriter hold `RefPtr<Response>`s so a
/// discarded JS Response can still have its body resolved.
#[repr(C)]
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = bun_ptr::weak_ptr::destroy_weakly_held)]
pub struct Response {
    body: Body,
    init: JsCell<Init>,
    url: JsCell<BunString>,
    redirected: Cell<bool>,
    ref_count: Cell<u32>,
    /// Bun.serve's RequestContext holds a weak reference so `onAbort` /
    /// `handleResolveStream` / `handleRejectStream` can safely observe that the
    /// Response was GC'd (null) instead of dereferencing a freed pointer when
    /// backpressure lets GC run between `render()` and the async callback.
    weak_ptr_data: WeakPtrData,
    js_ref: JsCell<JsRef>,

    // We must report a consistent value for this
    reported_estimated_size: Cell<usize>,

    /// Fetch's `AbortSignal` listener; survives `FetchTasklet` teardown so a fully-buffered body is still errored.
    abort_listener: JsCell<Option<bun_ptr::OwnedThis<BodyAbortListener>>>,
}

impl Default for Response {
    fn default() -> Self {
        Self::new(
            Init::default(),
            BodyValue::Null,
            BunString::EMPTY,
            false,
            JsRef::empty(),
        )
    }
}

impl Response {
    /// Every field spelled out (no `..Default::default()` temporary to move
    /// the `Cell` fields out of), so construction lowers to member stores.
    #[inline]
    fn new(init: Init, body: BodyValue, url: BunString, redirected: bool, js_ref: JsRef) -> Self {
        Self {
            body: Body::new(body),
            init: JsCell::new(init),
            url: JsCell::new(url),
            redirected: Cell::new(redirected),
            ref_count: Cell::new(1),
            weak_ptr_data: WeakPtrData::EMPTY,
            js_ref: JsCell::new(js_ref),
            reported_estimated_size: Cell::new(0),
            abort_listener: JsCell::new(None),
        }
    }
}

impl HasWeakPtrData for Response {
    fn weak_ptr_data(&self) -> &WeakPtrData {
        &self.weak_ptr_data
    }

    /// The last reference is gone but a `WeakRef` (RequestContext.response_weakref)
    /// still holds the allocation: release what the fields own, leaving them
    /// empty. `WeakRef::get()` returns null from here on.
    fn finalize_contents(&self) {
        self.init.set(Init::default());
        self.body.reset();
        self.url.set(BunString::EMPTY);
        self.js_ref.set(JsRef::empty());
        self.abort_listener.set(None);
    }
}
pub(crate) type WeakRef = bun_ptr::WeakPtr<Response>;

// Wire the codegen'd cached `body`/`stream` JS slot accessors + weak `js_ref`
// so the [`BodyMixin`] twin defaults can run generically.
impl crate::webcore::body::BodyOwnerJs for Response {
    #[inline]
    fn js_ref(&self) -> Option<JSValue> {
        self.js_ref.get().try_get()
    }
    #[inline]
    fn body_get_cached(this: JSValue) -> Option<JSValue> {
        js::body_get_cached(this)
    }
    #[inline]
    fn body_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::body_set_cached(this, global, value)
    }
    #[inline]
    fn stream_get_cached(this: JSValue) -> Option<JSValue> {
        js::stream_get_cached(this)
    }
    #[inline]
    fn stream_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::stream_set_cached(this, global, value)
    }
}

// BodyMixin is a trait with default methods providing getText/
// getBody/getBytes/getBodyUsed/getJSON/getArrayBuffer/getBlob/getBlobWithoutCallFrame/
// getFormData over any type exposing body()/getFormDataEncoding()/etc.
// Response implements it.

impl BodyMixin for Response {
    #[inline]
    fn body(&self) -> &Body {
        &self.body
    }
    #[inline]
    fn get_fetch_headers(&self) -> Option<core::ptr::NonNull<FetchHeaders>> {
        // Opaque C++ handle. Return the raw `*mut`
        // directly (via `HeadersRef::as_ptr`) so the provenance is mutable;
        // going through `as_deref()` would derive it from a `&FetchHeaders`
        // and make the later `as_mut()` UB under Stacked Borrows.
        self.init.get().headers.as_ref().map(|h| {
            core::ptr::NonNull::new(h.as_ptr())
                .expect("HeadersRef wraps a non-null *mut FetchHeaders")
        })
    }
    #[inline]
    fn get_form_data_encoding(
        &self,
    ) -> bun_jsc::JsResult<Option<Box<bun_core::form_data::AsyncFormData>>> {
        Response::get_form_data_encoding(self)
    }
}

impl Response {
    pub(crate) fn init(
        response_init: Init,
        body: Body,
        url: BunString,
        redirected: bool,
    ) -> Response {
        Self::new(
            response_init,
            body.into_value(),
            url,
            redirected,
            JsRef::empty(),
        )
    }

    #[inline]
    pub(crate) fn set_init(&self, method: Method, status_code: u16, status_text: BunString) {
        self.init.with_mut(|init| {
            init.method = method;
            init.status_code = status_code;
            init.status_text = status_text;
        });
    }

    #[inline]
    pub(crate) fn set_init_headers(&self, headers: Option<HeadersRef>) {
        // old headers dropped (HeadersRef::Drop derefs the C++ handle)
        self.init.with_mut(|init| init.headers = headers);
    }

    #[inline]
    pub(crate) fn get_init_status_code(&self) -> u16 {
        self.init.get().status_code
    }

    #[inline]
    pub(crate) fn get_init_status_text(&self) -> &BunString {
        &self.init.get().status_text
    }

    #[inline]
    pub(crate) fn set_url(&self, url: BunString) {
        self.url.set(url);
    }

    /// The JS getter keeps `get_url` (codegen calls that name); this internal
    /// accessor is `url()`.
    #[inline]
    pub(crate) fn url(&self) -> &BunString {
        self.url.get()
    }

    #[inline]
    pub(crate) fn get_init_headers(&self) -> Option<&FetchHeaders> {
        self.init.get().headers.as_deref()
    }

    /// The init headers as the `&mut` the C++ accessors take (opaque ZST
    /// handle — see [`HeadersRef::headers`]).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn get_init_headers_mut(&self) -> Option<&mut FetchHeaders> {
        self.init.get().headers.as_ref().map(HeadersRef::headers)
    }

    /// Deep-copy this response's init headers (if any) into a fresh
    /// `HeadersRef`.
    #[inline]
    pub(crate) fn clone_init_headers(
        &self,
        global: &JSGlobalObject,
    ) -> JsResult<Option<HeadersRef>> {
        match self.init.get().headers.as_ref() {
            Some(headers) => headers.clone_this(global),
            None => Ok(None),
        }
    }

    #[inline]
    pub(crate) fn swap_init_headers(&self) -> Option<HeadersRef> {
        self.init.with_mut(|init| init.headers.take())
    }

    #[inline]
    pub(crate) fn get_method(&self) -> Method {
        self.init.get().method
    }

    pub(crate) fn estimated_size(this: &Response) -> usize {
        this.reported_estimated_size.get()
    }
}

impl Response {
    #[inline]
    pub(crate) fn get_body_len(&self) -> usize {
        self.body.len() as usize
    }

    /// The body's `Value` slot.
    #[inline]
    pub(crate) fn body_value(&self) -> &JsCell<BodyValue> {
        &self.body.value
    }

    pub(crate) fn get_form_data_encoding(
        &self,
    ) -> JsResult<Option<Box<bun_core::form_data::AsyncFormData>>> {
        let Some(content_type_slice) = self.get_content_type()? else {
            return Ok(None);
        };
        // content_type_slice drops at scope exit
        let Some(encoding) = bun_core::form_data::Encoding::get(content_type_slice.slice()) else {
            return Ok(None);
        };
        Ok(Some(bun_core::form_data::AsyncFormData::init(encoding)))
    }

    pub(crate) fn calculate_estimated_byte_size(&self) {
        self.reported_estimated_size.set(
            self.body.value.get().estimated_size()
                + self.url.get().byte_slice().len()
                + self.init.get().status_text.byte_slice().len()
                + mem::size_of::<Response>(),
        );
    }

    #[inline]
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::check_body_stream_ref(self, global_object)
    }

    /// Hand a heap `Response` to a new JS wrapper, which owns the initial
    /// reference (released in [`Response::finalize`]).
    #[inline]
    pub fn into_js(self: Box<Self>, global_object: &JSGlobalObject) -> JSValue {
        Self::create_js(RefPtr::from_box(self), global_object)
    }

    #[inline]
    pub fn to_js(self, global_object: &JSGlobalObject) -> JSValue {
        Box::new(self).into_js(global_object)
    }

    /// [`to_js`](Self::to_js) that also hands back a second, native reference.
    #[inline]
    pub(crate) fn to_js_retained(
        self: Box<Self>,
        global_object: &JSGlobalObject,
    ) -> (JSValue, RefPtr<Response>) {
        let this = RefPtr::from_box(self);
        let native = this.clone();
        (Self::create_js(this, global_object), native)
    }

    /// Hand `this` (the wrapper's reference) to a new `JSResponse`.
    fn create_js(this: RefPtr<Response>, global_object: &JSGlobalObject) -> JSValue {
        this.calculate_estimated_byte_size();
        // `bun_jsc::generated::JSResponse::to_js` ⇒ `Response__create` (C++
        // shim). Payload type is erased (`*mut ()`) at the bun_jsc tier.
        let js_value = js::to_js(this.as_ptr().cast::<()>(), global_object);
        this.js_ref.set(JsRef::init_weak(js_value));

        this.check_body_stream_ref(global_object);
        // The wrapper's `m_ctx` now holds this reference.
        let _ = this.into_raw();
        js_value
    }

    #[inline]
    pub(crate) fn get_body_readable_stream(&self) -> Option<ReadableStream> {
        <Self as BodyMixin>::get_body_readable_stream(self)
    }

    #[inline]
    pub(crate) fn detach_readable_stream(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::detach_readable_stream(self, global_object)
    }

    /// Install a [`BodyAbortListener`] so abort reaches this body after `FetchTasklet` has detached.
    pub(crate) fn attach_abort_signal(
        this: bun_ptr::ThisPtr<Response>,
        global: &JSGlobalObject,
        signal: &AbortSignal,
    ) {
        let listener = bun_ptr::OwnedThis::new(BodyAbortListener {
            registration: Cell::new(None),
            response: this.into(),
            global: GlobalRef::new(global),
        });
        listener
            .registration
            .set(Some(signal.listen_native(listener.this_ptr().into())));
        this.abort_listener.set(Some(listener));
    }

    #[inline]
    pub(crate) fn set_size_hint(&self, size_hint: super::blob::SizeType) {
        self.body.value.with_mut(|value| {
            if let BodyValue::Locked(locked) = value {
                locked.size_hint = size_hint;
                if let Some(readable) = locked.readable.get() {
                    if let Some(bytes) = readable.ptr.bytes() {
                        bytes.size_hint.set(size_hint);
                    }
                }
            }
        });
    }
}

impl Response {
    pub(crate) fn get_fetch_headers(&self) -> Option<&FetchHeaders> {
        self.init.get().headers.as_deref()
    }

    #[inline]
    pub(crate) fn status_code(&self) -> u16 {
        self.init.get().status_code
    }
}

// ─── getters & header helpers ───────────────────────────────────────────────
impl Response {
    pub(crate) fn is_ok(&self) -> bool {
        let status_code = self.init.get().status_code;
        status_code >= 200 && status_code <= 299
    }

    // JS getter; codegen calls this exact name.
    pub(crate) fn get_url(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        this.url.get().to_js(global_this)
    }

    pub(crate) fn get_response_type(
        this: &Self,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        if this.init.get().status_code < 200 {
            return Ok(global_this.common_strings().error());
        }

        Ok(global_this.common_strings().default())
    }

    pub(crate) fn get_status_text(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText
        this.init.get().status_text.to_js(global_this)
    }

    pub(crate) fn get_redirected(this: &Self, _global: &JSGlobalObject) -> JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected
        JSValue::from(this.redirected.get())
    }

    pub(crate) fn get_ok(this: &Self, _global: &JSGlobalObject) -> JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        JSValue::from(this.is_ok())
    }

    pub(crate) fn get_status(this: &Self, _global: &JSGlobalObject) -> JSValue {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        JSValue::js_number(this.init.get().status_code as f64)
    }

    #[allow(clippy::mut_from_ref)]
    pub(crate) fn get_or_create_headers(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<&mut FetchHeaders> {
        if self.init.get().headers.is_none() {
            self.init
                .with_mut(|init| init.headers = Some(HeadersRef::create_empty()));

            if let BodyValue::Blob(blob) = self.body.value.get() {
                let content_type = blob.content_type_slice();
                if !content_type.is_empty() {
                    self.get_init_headers_mut().unwrap().put(
                        HTTPHeaderName::ContentType,
                        &BunString::ascii(content_type),
                        global_this,
                    )?;
                }
            }
        }

        Ok(self.get_init_headers_mut().unwrap())
    }

    pub(crate) fn get_headers(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(this.get_or_create_headers(global_this)?.to_js(global_this))
    }

    pub(crate) fn get_content_type(&self) -> JsResult<Option<Utf8Bytes<'_>>> {
        // `fast_get` (FFI out-param write) does not re-enter JS.
        if let Some(headers) = self.get_init_headers_mut() {
            if let Some(value) = headers.fast_get(HTTPHeaderName::ContentType) {
                return Ok(Some(value.to_utf8()));
            }
        }

        if let BodyValue::Blob(blob) = self.body.value.get() {
            let content_type = blob.content_type_slice();
            if !content_type.is_empty() {
                return Ok(Some(Utf8Bytes::Borrowed(content_type)));
            }
        }

        Ok(None)
    }
}

impl Response {
    pub(crate) fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        // return type narrowed to `core::fmt::Result`. The trait
        // methods produce `fmt::Error`/`JsError`/`crate::Error`; none of
        // those convert into the others, so funnel everything through
        // `fmt::Error`.
        let js_err = |_: JsError| core::fmt::Error;

        writeln!(
            writer,
            "Response ({}) {{",
            bun_core::fmt::size(self.get_body_len(), Default::default())
        )?;

        {
            let mut formatter = formatter.indented();

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>ok<d>:<r> ")
            )?;
            formatter
                .print_as::<_, ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatAs::Boolean,
                    writer,
                    JSValue::from(self.is_ok()),
                    bun_jsc::JSType::BooleanObject,
                )
                .map_err(js_err)?;
            formatter.print_comma::<_, ENABLE_ANSI_COLORS>(writer)?;
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>url<d>:<r> \"")
            )?;
            bun_core::write_pretty!(writer, ENABLE_ANSI_COLORS, "<r><b>{}<r>", self.url.get())?;
            writer.write_str("\"")?;
            formatter.print_comma::<_, ENABLE_ANSI_COLORS>(writer)?;
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>status<d>:<r> ")
            )?;
            formatter
                .print_as::<_, ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatAs::Double,
                    writer,
                    JSValue::js_number(self.init.get().status_code as f64),
                    bun_jsc::JSType::NumberObject,
                )
                .map_err(js_err)?;
            formatter.print_comma::<_, ENABLE_ANSI_COLORS>(writer)?;
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>statusText<d>:<r> ")
            )?;
            bun_core::write_pretty!(
                writer,
                ENABLE_ANSI_COLORS,
                "<r>\"<b>{}<r>\"",
                &self.init.get().status_text
            )?;
            formatter.print_comma::<_, ENABLE_ANSI_COLORS>(writer)?;
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>headers<d>:<r> ")
            )?;
            let headers_js = Self::get_headers(self, formatter.global_this()).map_err(js_err)?;
            formatter
                .print_as::<_, ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatAs::Private,
                    writer,
                    headers_js,
                    bun_jsc::JSType::DOMWrapper,
                )
                .map_err(js_err)?;
            formatter.print_comma::<_, ENABLE_ANSI_COLORS>(writer)?;
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>redirected<d>:<r> ")
            )?;
            formatter
                .print_as::<_, ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatAs::Boolean,
                    writer,
                    JSValue::from(self.redirected.get()),
                    bun_jsc::JSType::BooleanObject,
                )
                .map_err(js_err)?;
            formatter.print_comma::<_, ENABLE_ANSI_COLORS>(writer)?;
            writer.write_str("\n")?;

            formatter.reset_line();
            self.body
                .write_format::<F, W, ENABLE_ANSI_COLORS>(&mut *formatter, writer)?;
        }
        writer.write_str("\n")?;
        formatter.write_indent(writer)?;
        writer.write_str("}")?;
        formatter.reset_line();
        Ok(())
    }

    pub(crate) fn do_clone(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.throw_if_body_unusable(global_this)?;
        let this_value = callframe.this();
        let js_wrapper = Box::new(this.clone_value(global_this)?).into_js(global_this);
        this.sync_cloned_body_stream_caches(this_value, js_wrapper, global_this);
        Ok(js_wrapper)
    }

    /// Move a fetch/S3-built `Response` to the heap and hand it to a new JS wrapper.
    #[inline]
    pub(crate) fn make_maybe_pooled(global_object: &JSGlobalObject, response: Response) -> JSValue {
        response.to_js(global_object)
    }

    pub(crate) fn clone_value(&self, global_this: &JSGlobalObject) -> JsResult<Response> {
        let body = self.clone_body_value_via_cached_stream(global_this)?;
        let init = self.init.get().clone(global_this)?;
        Ok(Response::new(
            init,
            body,
            self.url.get().clone(),
            self.redirected.get(),
            JsRef::empty(),
        ))
    }

    /// The JS wrapper is being collected; its reference is released after
    /// this (fetch / HTMLRewriter refs and any outstanding `WeakRef` may keep
    /// the allocation past that).
    pub fn finalize(&self) {
        self.js_ref.with_mut(JsRef::finalize);
    }

    pub(crate) fn construct_json(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        let mut args = bun_jsc::ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());

        // `Init`'s and `Body`'s field drop glue releases their refs on `?`.
        let response = Box::new(Response::new(
            Init {
                status_code: 200,
                ..Default::default()
            },
            BodyValue::Empty,
            BunString::EMPTY,
            false,
            JsRef::empty(),
        ));
        let json_value = args.next_eat().unwrap_or_default();

        if !json_value.is_empty() {
            // Validate top-level values that are not JSON serializable (Node.js compatibility)
            if json_value.is_undefined()
                || json_value.is_symbol()
                || json_value.js_type() == bun_jsc::JSType::JSFunction
            {
                let err = global_this
                    .create_type_error_instance(format_args!("Value is not JSON serializable"));
                return Err(global_this.throw_value(err));
            }

            // BigInt has a different error message to match Node.js exactly
            if json_value.is_big_int() {
                let err = global_this.create_type_error_instance(format_args!(
                    "Do not know how to serialize a BigInt"
                ));
                return Err(global_this.throw_value(err));
            }

            // Use jsonStringifyFast which passes undefined for the space parameter,
            // triggering JSC's FastStringifier optimization. This is significantly faster
            // than jsonStringify which passes 0 for space and uses the slower Stringifier.
            let str = json_value.json_stringify_fast(global_this)?;

            if !str.is_empty() {
                debug_assert!(str.tag() == bun_core::Tag::WTFStringImpl);
                response.body.value.with_mut(|v| {
                    *v = BodyValue::WTFStringImpl(str.into_wtf().unwrap());
                    v.to_blob_if_possible();
                });
            }
        }

        if let Some(arg_init) = args.next_eat() {
            if arg_init.is_undefined_or_null() {
                // no-op
            } else if arg_init.is_number() {
                response.init.with_mut(|i| {
                    i.status_code =
                        u16::try_from(0.max(arg_init.to_int32()).min(i32::from(u16::MAX))).unwrap();
                });
            } else {
                if let Some(init) = Init::init(global_this, arg_init)? {
                    response.init.set(init);
                }
            }
        }

        let headers_ref = response.get_or_create_headers(global_this)?;
        let json_mime = bun_http_types::MimeType::JSON;
        headers_ref.put_default(
            HTTPHeaderName::ContentType,
            &BunString::ascii(json_mime.value.as_ref()),
            global_this,
        )?;
        Ok(response.into_js(global_this))
    }

    fn validate_redirect_status_code(
        global_this: &JSGlobalObject,
        status_code: i32,
    ) -> JsResult<u16> {
        match status_code {
            301 | 302 | 303 | 307 | 308 => Ok(u16::try_from(status_code).expect("int cast")),
            _ => {
                let err = global_this.create_range_error_instance(format_args!(
                    "Failed to execute 'redirect' on 'Response': Invalid status code"
                ));
                Err(global_this.throw_value(err))
            }
        }
    }

    pub(crate) fn construct_redirect(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let response = Self::construct_redirect_impl(global_this, callframe)?;
        Ok(response.into_js(global_this))
    }

    pub(crate) fn construct_redirect_impl(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<Response>> {
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        let mut args = bun_jsc::ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());

        let url_string: BunString;
        let response: Box<Response> = 'brk: {
            let response = Box::new(Response::new(
                Init {
                    status_code: 302,
                    ..Default::default()
                },
                BodyValue::Empty,
                BunString::EMPTY,
                false,
                JsRef::empty(),
            ));

            let url_string_value = args.next_eat().unwrap_or_default();
            url_string = if url_string_value.is_empty() {
                BunString::EMPTY
            } else {
                url_string_value.to_bun_string(global_this)?
            };

            if let Some(arg_init) = args.next_eat() {
                if arg_init.is_undefined_or_null() {
                    // no-op
                } else if arg_init.is_number() {
                    let status =
                        Self::validate_redirect_status_code(global_this, arg_init.to_int32())?;
                    response.init.with_mut(|i| i.status_code = status);
                } else if let Some(init) = Init::init(global_this, arg_init)? {
                    // cleanup is handled by Init's drop glue on `?` below
                    response.init.set(init);

                    let status = response.init.get().status_code;
                    if status != 200 {
                        let status =
                            Self::validate_redirect_status_code(global_this, i32::from(status))?;
                        response.init.with_mut(|i| i.status_code = status);
                    }
                }
            }

            break 'brk response;
        };

        // `get_or_create_headers` already populated init.headers.
        let headers = response.get_or_create_headers(global_this)?;
        // https://fetch.spec.whatwg.org/#dom-response-redirect steps 1 & 6: `Location`
        // gets the serialization of the parsed url, not the raw input. Non-absolute
        // input keeps the raw string: relative redirects are documented Bun behavior.
        let href = bun_url::href_from_string(&url_string);
        // The JS string's own WTF string (no re-encode), same as `Headers.prototype.set`.
        let location = if href.is_empty() { &url_string } else { &href };
        headers.put(HTTPHeaderName::Location, location, global_this)?;
        Ok(response)
    }

    pub(crate) fn construct_error(
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let response = Box::new(Response::new(
            Init {
                status_code: 0,
                ..Default::default()
            },
            BodyValue::Empty,
            BunString::EMPTY,
            false,
            JsRef::empty(),
        ));

        Ok(response.into_js(global_this))
    }

    // Hand-written: the constructor signature includes js_this (the pre-allocated
    // JS wrapper), which `#[bun_jsc::host_fn]` has no variant for. The returned
    // box is the wrapper's reference.
    pub(crate) fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        js_this: JSValue,
    ) -> JsResult<Box<Response>> {
        let arguments = callframe.arguments_as_array::<2>();

        if !arguments[0].is_undefined_or_null() && arguments[0].is_object() {
            if let Some(blob) = arguments[0].as_class_ref::<Blob>() {
                if blob.is_s3() {
                    if !arguments[1].is_empty_or_undefined_or_null() {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "new Response(s3File) do not support ResponseInit options",
                        )));
                    }
                    let response = Response::new(
                        Init {
                            status_code: 302,
                            ..Default::default()
                        },
                        BodyValue::Empty,
                        BunString::EMPTY,
                        false,
                        JsRef::init_weak(js_this),
                    );

                    let s3 = blob.store.get().as_ref().unwrap().data.as_s3();
                    let credentials = s3.get_credentials();

                    let result = match credentials.sign_request::<false>(
                        &bun_s3_signing::SignOptions {
                            path: s3.path(),
                            method: Method::GET,
                            content_hash: None,
                            content_md5: None,
                            search_params: None,
                            content_disposition: None,
                            content_type: None,
                            content_encoding: None,
                            acl: None,
                            storage_class: None,
                            request_payer: false,
                        },
                        Some(bun_s3_signing::SignQueryOptions { expires: 15 * 60 }),
                    ) {
                        Ok(r) => r,
                        Err(sign_err) => {
                            return Err(crate::webcore::s3::client::throw_sign_error(
                                sign_err.into(),
                                global_this,
                            ));
                        }
                    };
                    // `defer result.deinit()` — SignResult: Drop frees owned buffers at scope exit.
                    response.redirected.set(true);
                    let headers = response.get_or_create_headers(global_this)?;
                    headers.put(
                        HTTPHeaderName::Location,
                        &BunString::ascii(&result.url),
                        global_this,
                    )?;
                    return Ok(Box::new(response));
                }
            }
        }
        let init: Init = 'brk: {
            if arguments[1].is_undefined_or_null() {
                break 'brk Init {
                    status_code: 200,
                    headers: None,
                    ..Default::default()
                };
            }
            if arguments[1].is_object() {
                break 'brk Init::init(global_this, arguments[1])?.expect("unreachable");
            }
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Failed to construct 'Response': The provided body value is not of type 'ResponseInit'",
            )));
        };

        let body: BodyValue = 'brk: {
            if arguments[0].is_undefined_or_null() {
                break 'brk BodyValue::Null;
            }
            super::body::extract(global_this, arguments[0])?
        };

        // extract() throws without returning Err; see Blob::from_dom_form_data
        if global_this.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        // Perform the only remaining fallible op BEFORE heap-allocating:
        // doing it on stack locals lets `?` run `body`'s and `init`'s drop glue
        // and avoids leaking the heap allocation entirely.
        if let BodyValue::Blob(blob) = &body {
            if let Some(headers) = init.headers.as_ref().map(HeadersRef::headers) {
                let content_type = blob.content_type_slice();
                if !content_type.is_empty() && !headers.fast_has(HTTPHeaderName::ContentType) {
                    headers.put(
                        HTTPHeaderName::ContentType,
                        &BunString::ascii(content_type),
                        global_this,
                    )?;
                }
            }
        }

        // Ownership transfers to the JSC wrapper (freed via `finalize`). The
        // codegen constructor thunk binds this box to `js_this`.
        let response = Box::new(Response::new(
            init,
            body,
            BunString::EMPTY,
            false,
            JsRef::init_weak(js_this),
        ));

        response.calculate_estimated_byte_size();
        response.check_body_stream_ref(global_this);
        Ok(response)
    }
}

// We deliberately do NOT `impl Drop for Init` so struct-update
// syntax (`Init { status_code: x, ..Default::default() }`) and partial moves
// (e.g. Request::construct_into reading `response_init.headers`) keep working;
// the fields' own drop glue releases `headers` and `status_text`.
pub struct Init {
    pub(crate) headers: Option<HeadersRef>,
    pub(crate) status_code: u16,
    pub(crate) status_text: BunString,
    pub method: Method,
}

impl Default for Init {
    fn default() -> Self {
        Self {
            headers: None,
            status_code: 0,
            status_text: BunString::EMPTY,
            method: Method::GET,
        }
    }
}

impl Init {
    pub(crate) fn clone(&self, ctx: &JSGlobalObject) -> JsResult<Init> {
        let headers = match &self.headers {
            // `clone_this` does a deep copy on the C++ side and may return
            // null on OOM/throw. Flatten the
            // `Option<HeadersRef>` so a null clone leaves `headers` empty.
            Some(head) => head.clone_this(ctx)?,
            None => None,
        };
        Ok(Init {
            headers,
            status_code: self.status_code,
            status_text: self.status_text.clone(),
            method: self.method,
        })
    }

    pub(crate) fn init(
        global_this: &JSGlobalObject,
        response_init: JSValue,
    ) -> JsResult<Option<Init>> {
        let mut result = Init {
            status_code: 200,
            ..Default::default()
        };

        if !response_init.is_cell() {
            return Ok(None);
        }

        let js_type = response_init.js_type();

        if !js_type.is_object() {
            return Ok(None);
        }

        if js_type == JSType::DOMWrapper {
            // fast path: it's a Request object or a Response object
            // we can skip calling JS getters
            if let Some(req) = response_init.as_direct_class_ref::<Request>() {
                if let Some(headers) = req.get_fetch_headers_unless_empty() {
                    result.headers = headers.clone_this(global_this)?;
                }

                result.method = req.method;
                return Ok(Some(result));
            }

            if let Some(resp) = response_init.as_direct_class_ref::<Response>() {
                return Ok(Some(resp.init.get().clone(global_this)?));
            }
        }

        if let Some(headers) = response_init.fast_get(global_this, BuiltinName::headers)? {
            // `JSValue::as_::<FetchHeaders>()` requires `JsClass`;
            // FetchHeaders is a hand-bound opaque, so use its dedicated
            // `cast()` (wraps `WebCore__FetchHeaders__cast_`).
            if let Some(orig) = FetchHeaders::cast(headers) {
                // `orig` is a live `WebCore::FetchHeaders*` borrowed from JS;
                // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
                let orig = bun_opaque::opaque_deref_mut(orig.as_ptr());
                if !orig.is_empty() {
                    result.headers = HeadersRef::clone_from(orig, global_this)?;
                }
            } else {
                result.headers = HeadersRef::create_from_js(global_this, headers)?;
            }
        }

        if let Some(status_value) = response_init.fast_get(global_this, BuiltinName::status)? {
            let number = status_value.coerce_to_int64(global_this)?;
            if (200 <= number && number < 600) || number == 101 {
                result.status_code = (u32::try_from(number).expect("int cast")) as u16;
            } else {
                let err = global_this.create_range_error_instance(format_args!(
                    "The status provided ({}) must be 101 or in the range of [200, 599]",
                    number
                ));
                return Err(global_this.throw_value(err));
            }
        }

        if let Some(status_text) =
            response_init.fast_get_truthy(global_this, BuiltinName::statusText)?
        {
            result.status_text = status_text.to_bun_string(global_this)?;
        }

        if let Some(method_value) =
            response_init.fast_get_truthy(global_this, BuiltinName::method)?
        {
            if let Some(method) = bun_http_jsc::method_jsc::from_js(global_this, method_value)? {
                result.method = method;
            }
        }

        Ok(Some(result))
    }
}

// https://developer.mozilla.org/en-US/docs/Web/API/Headers
// TODO: move to the http module. this has nothing to do with jsc or WebCore
