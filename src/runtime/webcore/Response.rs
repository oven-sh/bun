use core::cell::{Cell, OnceCell};

use bun_jsc::JsCell;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{AbortSignal, GlobalRef, HasJsRef as _};
use bun_ptr::RefPtr;

use crate::server::RangeRequest;
use crate::webcore::jsc::{
    BuiltinName, HTTPHeaderName, JSGlobalObject, JSValue, JsError, JsRef, JsResult, StringJsc as _,
};
use bun_core::Output;
use bun_core::{String as BunString, StringView, Utf8Bytes};
use bun_http_types::Method::Method;

use super::body::{Body, BodyMixin, Value as BodyValue, ValueError as BodyValueError};
use super::request::Pristine;
use super::{FetchHeaders, ReadableStream};

use super::blob::{Blob, BodyFacts};
use super::fetch::request_init::HeadersInit;
use bun_ptr::weak_ptr::WeakPtrData;

pub(crate) use bun_jsc::HeadersRef;

/// Errors the owning fetch `Response`'s body on abort (Fetch spec "abort a fetch" step 4).
pub(crate) struct BodyAbortListener {
    abort_handle: bun_jsc::AbortHandle,
    /// `Response` owns `Self`, so a ref-counted pointer here would cycle.
    response: bun_ptr::ParentRef<Response, bun_ptr::Mut>,
    global: GlobalRef,
    /// The context of the script that fetched: the body's error is reported to it.
    context: bun_jsc::ContextId,
}

bun_jsc::impl_abort_handle_owner!(
    BodyAbortListener,
    abort_handle,
    keep_alive = |this| -> RefPtr<Response> {
        // SAFETY: the `Response` drops this box, and with it the handle, before it goes.
        unsafe { RefPtr::init_ref((*this).response.as_mut_ptr()) }
    },
    |this, cause| {
        if let bun_jsc::AbortCause::Signal(reason) = cause {
            // SAFETY: the `Response` that owns the box is kept alive.
            unsafe { (*this).on_abort(reason) }
        }
    }
);

impl BodyAbortListener {
    fn on_abort(&self, reason: JSValue) {
        reason.ensure_still_alive();
        let (response, global) = (self.response, self.global);
        let _context = global.bun_vm().enter_context(self.context);
        if !matches!(
            response.get_body_value(),
            BodyValue::Used | BodyValue::Error(_) | BodyValue::Null | BodyValue::Empty
        ) {
            // `Locked.readable` is a real `JSC::Weak`: `None` exactly when the stream's source is gone.
            if let BodyValue::Locked(locked) = response.get_body_value() {
                if let Some(readable) = locked.readable.get() {
                    readable.value.ensure_still_alive();
                    crate::dispatch::fold(readable.error(&global, reason));
                }
            }
            let err = BodyValueError::JSValue(bun_jsc::strong::Optional::create(reason, &global));
            // R-2: re-derive after `error()` ran JS.
            let _ = response.get_body_value().to_error_instance(err, &global);
        }
    }
}

use crate::generated_bindgen::response::js_Response as js;

impl bun_jsc::JsClass for Response {
    fn from_js(value: &JSValue) -> Option<bun_jsc::WrapperGuard<'_, Self>> {
        js::from_js(value)
    }
    fn from_js_direct(value: &JSValue) -> Option<bun_jsc::WrapperGuard<'_, Self>> {
        js::from_js_direct(value)
    }
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        RefPtr::new(self).to_js(global)
    }
}

/// Every JS-facing member takes `&Response` (not
/// `&mut Response`) so re-entrant JS calls cannot stack two `&mut` to the same
/// instance. Fields the members mutate are therefore wrapped in `Cell` (Copy
/// scalars) or `JsCell` (non-Copy `body`/`init`/`url`/`js_ref`). Both are
/// `#[repr(transparent)]`, so `#[repr(C)]` field layout is unchanged.
#[repr(C)]
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = bun_ptr::weak_ptr::destroy)]
pub(crate) struct Response {
    body: JsCell<Body>,
    init: JsCell<Init>,
    url: JsCell<BunString>,
    redirected: Cell<bool>,
    /// The JS wrapper, fetch (so a discarded JS Response can still resolve
    /// its body) and HTMLRewriter each hold a ref.
    ref_count: Cell<u32>,
    /// Bun.serve's RequestContext holds a weak reference so `onAbort` /
    /// `handleResolveStream` / `handleRejectStream` can safely observe that the
    /// Response was GC'd (null) instead of dereferencing a freed pointer when
    /// backpressure lets GC run between `render()` and the async callback.
    weak_ptr_data: WeakPtrData,
    pub(crate) js_ref: JsCell<JsRef>,

    // We must report a consistent value for this
    reported_estimated_size: Cell<usize>,

    /// Fetch's `AbortSignal` listener; survives `FetchTasklet` teardown so a fully-buffered body is still errored.
    abort_listener: OnceCell<bun_ptr::AliasableBox<BodyAbortListener>>,
}

impl Default for Response {
    fn default() -> Self {
        Self {
            body: JsCell::new(Body::default()),
            init: JsCell::new(Init::default()),
            url: JsCell::new(BunString::EMPTY),
            redirected: Cell::new(false),
            ref_count: Cell::new(1),
            weak_ptr_data: WeakPtrData::EMPTY,
            js_ref: JsCell::new(JsRef::empty()),
            reported_estimated_size: Cell::new(0),
            abort_listener: OnceCell::new(),
        }
    }
}

// SAFETY: see its `#[ref_count(destroy = …)]`. No field reaches a `WeakRef`.
unsafe impl bun_ptr::weak_ptr::HasWeakPtrData for Response {
    unsafe fn weak_ptr_data(this: *mut Self) -> *const WeakPtrData {
        // SAFETY: caller guarantees `this` points to a live (possibly-finalized) allocation.
        unsafe { core::ptr::addr_of!((*this).weak_ptr_data) }
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
// getFormData over any type exposing getBodyValue()/getFormDataEncoding()/etc.
// Response implements it.

impl BodyMixin for Response {
    #[inline]
    fn get_body_value(&self) -> &mut BodyValue {
        Response::get_body_value(self)
    }
    #[inline]
    fn get_content_type(&self) -> Option<Utf8Bytes<'_>> {
        Response::get_content_type(self)
    }
    #[inline]
    fn ensure_headers(&self, global_this: &JSGlobalObject) -> bun_jsc::JsResult<()> {
        self.get_or_create_headers(global_this).map(|_| ())
    }
}

impl Response {
    pub(crate) fn init(
        response_init: Init,
        body: Body,
        url: BunString,
        redirected: bool,
    ) -> Response {
        Response {
            init: JsCell::new(response_init),
            body: JsCell::new(body),
            url: JsCell::new(url),
            redirected: Cell::new(redirected),
            ..Default::default()
        }
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

    /// R-2 `JsCell` escape hatch — single-JS-thread invariant. Centralises the
    /// `unsafe { self.init.get_mut() }` deref so the four call sites
    /// ([`get_init_headers_mut`], [`header`], [`get_or_create_headers`],
    /// [`get_content_type`]) read it as a plain `&mut Init`.
    ///
    /// # Safety (encapsulated)
    /// `Response` is JS-thread-affine (`!Sync`) and `init` is never reborrowed
    /// across re-entrant JS; the returned `&mut Init` is held only for FFI
    /// out-param writes (`FetchHeaders::fast_get`/`put`) that do not call back
    /// into Response host-fns, so no overlapping `&mut Init` is live.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn init_mut(&self) -> &mut Init {
        // SAFETY: see fn doc — single-JS-thread, no overlapping `&mut Init`.
        unsafe { self.init.get_mut() }
    }

    #[inline]
    pub(crate) fn get_init_headers_mut(&self) -> Option<&mut FetchHeaders> {
        self.init_mut().headers.as_deref_mut()
    }

    /// Deep-copy this response's init headers (if any) into a fresh `HeadersRef`.
    #[inline]
    pub(crate) fn clone_init_headers(
        &self,
        global: &JSGlobalObject,
    ) -> JsResult<Option<HeadersRef>> {
        match self.init_mut().headers.as_ref() {
            Some(headers) => headers.clone_this(global),
            None => Ok(None),
        }
    }

    #[inline]
    pub(crate) fn swap_init_headers(&self) -> Option<HeadersRef> {
        self.init.with_mut(|init| init.headers.take())
    }

    /// Removes what describes the bytes as they were before `fetch()` decoded them.
    fn drop_headers_of_encoded_body(&self) {
        let init = self.init_mut();
        let Some(headers) = init.headers.as_deref_mut() else {
            return;
        };
        let decoded = BodyFacts::DECODED
            & match self.get_body_value() {
                BodyValue::Null | BodyValue::Empty | BodyValue::Used => headers.body_facts(),
                body => body.facts(),
            };
        if decoded.is_empty() {
            return;
        }
        let names_decoded_coding = headers
            .fast_get(HTTPHeaderName::ContentEncoding)
            .is_some_and(|value| {
                let value = value.to_utf8();
                let mut codings = bun_http::HeaderValueIterator::init(value.slice())
                    .map(bun_http::Encoding::from_token)
                    .filter(|coding| *coding != Some(bun_http::Encoding::Identity));
                let first = codings.next().flatten();
                first.map(BodyFacts::decoded_from) == Some(decoded) && codings.next().is_none()
            });
        if !names_decoded_coding {
            return;
        }
        headers.fast_remove(HTTPHeaderName::ContentEncoding);
        headers.fast_remove(HTTPHeaderName::ContentLength);
        if init.status_code == 206
            && headers
                .fast_get(HTTPHeaderName::ContentRange)
                .is_some_and(|value| RangeRequest::is_whole_content_range(value.to_utf8().slice()))
        {
            headers.fast_remove(HTTPHeaderName::ContentRange);
            init.status_code = 200;
            init.status_text = BunString::EMPTY;
        }
    }

    /// Settles what the body says about the headers. Call it before the body is taken to be sent.
    pub(crate) fn prepare_headers_for_send(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        self.drop_headers_of_encoded_body();
        let body = self.get_body_value();
        body.to_blob_if_possible();
        // Bytes are sent with their own type. A stream's type can only be sent as a header.
        if matches!(body, BodyValue::Locked(_)) {
            self.copy_content_type_to_headers(global_this)?;
        }
        Ok(())
    }

    #[inline]
    pub(crate) fn get_method(&self) -> Method {
        self.init.get().method
    }

    pub(crate) fn estimated_size(this: &Response) -> usize {
        this.reported_estimated_size.get()
    }

    /// R-2: returns `&mut BodyValue` from `&self` via the `JsCell` escape
    /// hatch. Callers must keep the borrow short and not hold it across calls
    /// that may re-enter a `Response` host-fn (which could project a second
    /// `&mut` to the same `body`).
    #[inline]
    pub(crate) fn get_body_value(&self) -> &mut BodyValue {
        // R-2: both `Response.body` and `Body.value` are `JsCell` —
        // single-JS-thread interior-mutability boundary. See `Body::value_mut`.
        self.body.get().value_mut()
    }
}

impl Response {
    pub(crate) fn calculate_estimated_byte_size(&self) {
        self.reported_estimated_size.set(
            self.body.get().value.get().estimated_size()
                + self.url.get().byte_slice().len()
                + self.init.get().status_text.byte_slice().len(),
        );
    }

    #[inline]
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::check_body_stream_ref(self, global_object)
    }

    /// The wrapper adopts the ref.
    pub(crate) fn to_js(self: RefPtr<Self>, global_object: &JSGlobalObject) -> JSValue {
        self.wrap(global_object).to_js()
    }

    /// As `to_js`, for code that goes on to use the struct.
    pub(crate) fn wrap(
        self: RefPtr<Self>,
        global_object: &JSGlobalObject,
    ) -> bun_jsc::WrapperGuard<'_, Self> {
        self.calculate_estimated_byte_size();
        let this = js::wrap(self, global_object);
        this.set_js_ref_weak();

        this.check_body_stream_ref(global_object);
        this
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
        this: &bun_jsc::WrapperGuard<'_, Self>,
        global: &JSGlobalObject,
        signal: &AbortSignal,
        context: bun_jsc::ContextId,
    ) {
        let listener = bun_ptr::AliasableBox::new(BodyAbortListener {
            abort_handle: bun_jsc::AbortHandle::for_owner::<BodyAbortListener>(),
            // SAFETY: the pointer that the wrapper holds, to the `Response` that owns the box.
            response: unsafe { bun_ptr::ParentRef::from_raw_mut(this.as_ptr()) },
            global: GlobalRef::new(global),
            context,
        });
        // SAFETY: on the heap until it drops.
        unsafe { bun_jsc::AbortHandle::follow_owner(listener.as_ptr(), signal.ref_()) };
        let _ = this.abort_listener.set(listener);
    }

    #[inline]
    pub(crate) fn set_size_hint(&self, size_hint: super::blob::SizeType) {
        if let BodyValue::Locked(locked) = self.body.get().value_mut() {
            locked.size_hint = size_hint;
            if let Some(readable) = locked.readable.get() {
                // BACKREF: see `Source::bytes()` — back-pointer owned by the
                // ReadableStream; `size_hint` is `Cell<_>` so shared deref + `.set()`.
                if let Some(bytes) = readable.ptr.bytes() {
                    bytes.size_hint.set(size_hint);
                }
            }
        }
    }
}

impl Response {
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

    pub(crate) fn get_url(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/url
        self.url.get().to_js(cx.global())
    }

    pub(crate) fn get_type(&self, cx: &mut JsScope<'_>) -> JSValue {
        // https://fetch.spec.whatwg.org/#concept-response-type
        let common_strings = cx.global().common_strings();
        if self.init.get().status_code == 0 {
            return common_strings.error();
        }
        // Only a fetched response has a URL. Bun has no origin, so "cors" and "opaque" never apply.
        if !self.url.get().is_empty() {
            return common_strings.basic();
        }
        common_strings.default()
    }

    pub(crate) fn get_status_text(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText
        self.init.get().status_text.to_js(cx.global())
    }

    pub(crate) fn get_redirected(&self) -> bool {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected
        self.redirected.get()
    }

    pub(crate) fn get_ok(&self) -> bool {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/ok
        self.is_ok()
    }

    pub(crate) fn get_status(&self) -> u16 {
        // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
        self.status_code()
    }

    pub(crate) fn get_or_create_headers(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<&mut HeadersRef> {
        // R-2 escape hatch via `init_mut()` — the returned `&mut HeadersRef`
        // borrows `self.init`; callers (`get_headers`, `construct_*`) do not
        // hold the borrow across calls that re-enter Response host-fns.
        let init = self.init_mut();
        if init.headers.is_none() {
            let headers = init.headers.insert(HeadersRef::create_empty());
            self.get_body_value()
                .put_content_type_default(headers, global_this)?;
        }

        Ok(init.headers.as_mut().unwrap())
    }

    pub(crate) fn get_headers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        Ok(self.get_or_create_headers(global_this)?.to_js(global_this))
    }

    pub(crate) fn get_content_type(&self) -> Option<Utf8Bytes<'_>> {
        // R-2 escape hatch via `init_mut()` — `fast_get` (FFI out-param write)
        // does not re-enter JS.
        if let Some(headers) = self.init_mut().headers.as_mut() {
            if let Some(value) = headers.fast_get(HTTPHeaderName::ContentType) {
                return Some(value.to_utf8());
            }
        }

        let content_type = self.body.get().value.get().content_type().as_slice();
        (!content_type.is_empty()).then_some(Utf8Bytes::Borrowed(content_type))
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

        match self.body.get().known_len() {
            Some(len) => writeln!(
                writer,
                "Response ({}) {{",
                bun_core::fmt::size(len, Default::default())
            )?,
            None => writeln!(writer, "Response {{")?,
        }

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
            let headers_js = self
                .get_or_create_headers(formatter.global_this())
                .map_err(js_err)?
                .to_js(formatter.global_this());
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
                .get()
                .write_format::<F, W, ENABLE_ANSI_COLORS>(&mut *formatter, writer)?;
        }
        writer.write_str("\n")?;
        formatter.write_indent(writer)?;
        writer.write_str("}")?;
        formatter.reset_line();
        Ok(())
    }

    pub(crate) fn do_clone(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_this = cx.global();
        self.throw_if_body_unusable(global_this)?;
        let cloned = self.clone(&cx)?;

        let js_wrapper = cloned.to_js(global_this);
        self.sync_cloned_body_stream_caches(this_value.to_js(), js_wrapper, global_this);
        Ok(js_wrapper)
    }

    pub(crate) fn clone_value(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<Response> {
        let body = Body::new(self.clone_body_value_via_cached_stream(cx)?);
        let init = self.init.get().clone(cx.global())?;
        Ok(Response {
            body: JsCell::new(body),
            init: JsCell::new(init),
            url: JsCell::new(self.url.get().clone()),
            redirected: Cell::new(self.redirected.get()),
            ..Default::default()
        })
    }

    pub(crate) fn clone(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<RefPtr<Response>> {
        Ok(RefPtr::new(self.clone_value(cx)?))
    }

    pub(crate) fn construct_json(cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let global_this = cx.global();
        let args = JsLocal::to_js_slice(args);
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4

        let response = Response {
            body: JsCell::new(Body::new(BodyValue::Empty)),
            init: JsCell::new(Init {
                status_code: 200,
                ..Default::default()
            }),
            ..Default::default()
        };

        if let Some(&json_value) = args.first() {
            let str = Self::json_text_of(global_this, json_value)?;

            if let Some(str) = str.into_wtf() {
                let value = &response.body.get().value;
                value.set(BodyValue::WTFStringImpl(str));
                value.with_mut(|v| v.to_blob_if_possible());
            }
        }

        if let Some(&arg_init) = args.get(1) {
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
            &StringView::ascii(json_mime.value.as_ref()),
            global_this,
        )?;
        Ok(RefPtr::new(response).to_js(global_this))
    }

    /// `construct_json` on a value and the members of a literal. The value is serialized before the members are taken.
    fn json_from_parts(
        global_this: &JSGlobalObject,
        json_value: JSValue,
        parts: &InitParts,
    ) -> JsResult<JSValue> {
        let response = Response {
            body: JsCell::new(Body::new(BodyValue::Empty)),
            ..Default::default()
        };
        let str = Self::json_text_of(global_this, json_value)?;
        if let Some(str) = str.into_wtf() {
            let value = &response.body.get().value;
            value.set(BodyValue::WTFStringImpl(str));
            value.with_mut(|v| v.to_blob_if_possible());
        }
        response.init.set(Init::from_parts(global_this, parts)?);
        let headers_ref = response.get_or_create_headers(global_this)?;
        headers_ref.put_default(
            HTTPHeaderName::ContentType,
            &StringView::ascii(bun_http_types::MimeType::JSON.value.as_ref()),
            global_this,
        )?;
        Ok(RefPtr::new(response).to_js(global_this))
    }

    #[inline(always)]
    fn json_text_of(global_this: &JSGlobalObject, json_value: JSValue) -> JsResult<BunString> {
        if json_value.is_big_int()
            && !json_value
                .get_prototype(global_this)?
                .get(global_this, "toJSON")?
                .is_some_and(JSValue::is_callable)
        {
            return Err(
                global_this.throw_type_error(format_args!("Do not know how to serialize a BigInt"))
            );
        }
        // Use jsonStringifyFast which passes undefined for the space parameter, triggering JSC's FastStringifier optimization.
        let text = json_value.json_stringify_fast(global_this)?;
        // An empty string means `JSON.stringify` returned undefined.
        if text.is_empty() {
            return Err(
                global_this.throw_type_error(format_args!("Value is not JSON serializable"))
            );
        }
        Ok(text)
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

    pub(crate) fn redirect(cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let global_this = cx.global();
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4
        let args = JsLocal::to_js_slice(args);

        let url_string = match args.first() {
            Some(url) => url.to_bun_string(global_this)?,
            None => BunString::EMPTY,
        };
        let response = Response {
            init: JsCell::new(Init {
                status_code: 302,
                ..Default::default()
            }),
            body: JsCell::new(Body::new(BodyValue::Null)),
            ..Default::default()
        };

        if let Some(&arg_init) = args.get(1) {
            if arg_init.is_undefined_or_null() {
                // no-op
            } else if arg_init.is_number() {
                let status = Self::validate_redirect_status_code(global_this, arg_init.to_int32())?;
                response.init.with_mut(|i| i.status_code = status);
            } else if let Some(init) = Init::init_with_default_status(global_this, arg_init, 302)? {
                if init.status_code != 200 {
                    let status = i32::from(init.status_code);
                    Self::validate_redirect_status_code(global_this, status)?;
                }
                response.init.set(init);
            } else if arg_init.is_string() {
                // "307" is 307. A string that isn't a redirect status is ignored.
                if let status @ (301 | 302 | 303 | 307 | 308) =
                    arg_init.coerce_to_i32(global_this)?
                {
                    response.init.with_mut(|i| i.status_code = status as u16);
                }
            }
        }

        // `get_or_create_headers` already populated init.headers.
        let headers = response.get_or_create_headers(global_this)?;
        // https://fetch.spec.whatwg.org/#dom-response-redirect steps 1 & 6: `Location`
        // gets the serialization of the parsed url, not the raw input. Non-absolute
        // input keeps the raw string: relative redirects are documented Bun behavior.
        let href = bun_url::href_from_string(&url_string);
        // The JS string's own WTF string (no re-encode), same as `Headers.prototype.set`.
        let location = if href.is_empty() { &url_string } else { &href };
        headers.put(HTTPHeaderName::Location, location, global_this)?;
        Ok(RefPtr::new(response).to_js(global_this))
    }

    pub(crate) fn error(cx: &mut JsScope<'_>) -> JSValue {
        let global_this = cx.global();
        let response = RefPtr::new(Response {
            init: JsCell::new(Init {
                status_code: 0,
                ..Default::default()
            }),
            body: JsCell::new(Body::new(BodyValue::Null)),
            ..Default::default()
        });

        response.to_js(global_this)
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        body: JsLocal<'a>,
        init: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let response = Self::construct_into(cx.global(), body.to_js(), init.to_js())?;
        let this_value = structure.create(&cx.heap, response);
        this_value.set_js_ref_weak();
        Self::wrapped_by(this_value).check_body_stream_ref(cx.global());
        Ok(this_value)
    }

    fn construct_into(
        global_this: &JSGlobalObject,
        body: JSValue,
        init: JSValue,
    ) -> JsResult<RefPtr<Response>> {
        if body.is_object() {
            if let Some(blob) = body.as_class_ref::<Blob>() {
                if blob.is_s3() {
                    if !init.is_undefined_or_null() {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "new Response(s3File) do not support ResponseInit options",
                        )));
                    }
                    let response = RefPtr::new(Response {
                        init: JsCell::new(Init {
                            status_code: 302,
                            ..Default::default()
                        }),
                        body: JsCell::new(Body::new(BodyValue::Null)),
                        ..Default::default()
                    });

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
                        &StringView::ascii(&result.url),
                        global_this,
                    )?;
                    return Ok(response);
                }
            }
        }
        let init_value = init;
        let init: Init = 'brk: {
            if init_value.is_undefined_or_null() {
                break 'brk Init {
                    status_code: 200,
                    headers: None,
                    ..Default::default()
                };
            }
            if init_value.is_object() {
                break 'brk Init::init(global_this, init_value)?.expect("unreachable");
            }
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Failed to construct 'Response': The provided body value is not of type 'ResponseInit'",
            )));
        };

        Self::from_body_and_init(global_this, body, init, init_value)
    }

    #[inline(always)]
    fn from_body_and_init(
        global_this: &JSGlobalObject,
        body: JSValue,
        mut init: Init,
        init_value: JSValue,
    ) -> JsResult<RefPtr<Response>> {
        let body: Body = 'brk: {
            if body.is_undefined_or_null() {
                break 'brk Body::new(BodyValue::Null);
            }
            // `Body::extract` is a free fn re-exported as `body::extract`.
            super::body::extract(global_this, body)?
        };

        if let Some(headers) = init.headers.as_deref_mut() {
            body.value
                .get()
                .put_content_type_default(headers, global_this)?;
        } else if let Some(source) = BodyValue::from_request_or_response(init_value) {
            // SAFETY: `init_value` is an argument of this call, so the Request or Response it wraps is live.
            let source = unsafe { &*source };
            // It has no header list either, so the type its body implies is the one header to copy.
            if body.value.get().content_type().is_empty() && !source.content_type().is_empty() {
                if let BodyValue::Locked(stream) = body.value_mut() {
                    stream.set_content_type(source.content_type().clone());
                } else {
                    let headers = init.headers.insert(HeadersRef::create_empty());
                    source.put_content_type_default(headers, global_this)?;
                }
            }
        }

        let response = RefPtr::new(Response {
            body: JsCell::new(body),
            init: JsCell::new(init),
            ..Default::default()
        });
        response.calculate_estimated_byte_size();
        Ok(response)
    }

    fn from_parts(
        global_this: &JSGlobalObject,
        body: JSValue,
        parts: &InitParts,
    ) -> JsResult<JSValue> {
        if body.is_object() && body.as_class_ref::<Blob>().is_some_and(|blob| blob.is_s3()) {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "new Response(s3File) do not support ResponseInit options",
            )));
        }
        let init = Init::from_parts(global_this, parts)?;
        let response = Self::from_body_and_init(global_this, body, init, JSValue::UNDEFINED)?;
        Ok(response.to_js(global_this))
    }
}

/// The members of a `ResponseInit` literal that compiled code has taken apart. Undefined stands for a member that the literal lacks.
pub(crate) struct InitParts {
    status: JSValue,
    status_text: JSValue,
    headers: JSValue,
}

/// `new Response(body, { status, statusText, headers })` (`literalPartsForm` of the table of built-ins).
#[unsafe(no_mangle)]
#[bun_jsc::host_call]
fn Response__createFromParts(
    global_this: &JSGlobalObject,
    body: JSValue,
    status: JSValue,
    status_text: JSValue,
    headers: JSValue,
) -> JSValue {
    let parts = InitParts {
        status,
        status_text,
        headers,
    };
    bun_jsc::to_js_host_call(global_this, || {
        Response::from_parts(global_this, body, &parts)
    })
}

/// `Response.json(value, { status, statusText, headers })` (`literalPartsForm` of the table of built-ins).
#[unsafe(no_mangle)]
#[bun_jsc::host_call]
fn Response__jsonFromParts(
    global_this: &JSGlobalObject,
    value: JSValue,
    status: JSValue,
    status_text: JSValue,
    headers: JSValue,
) -> JSValue {
    let parts = InitParts {
        status,
        status_text,
        headers,
    };
    bun_jsc::to_js_host_call(global_this, || {
        Response::json_from_parts(global_this, value, &parts)
    })
}

// We deliberately do NOT `impl Drop for Init` so struct-update
// syntax (`Init { status_code: x, ..Default::default() }`) and partial moves
// keep working; the fields' own drop glue releases `headers` and `status_text`.
pub(crate) struct Init {
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

    /// The members are taken in the order in which `init` reads them.
    fn from_parts(global_this: &JSGlobalObject, parts: &InitParts) -> JsResult<Init> {
        let mut init = Init {
            status_code: 200,
            ..Default::default()
        };
        if !parts.headers.is_undefined() {
            init.set_headers(global_this, parts.headers)?;
        }
        if !parts.status.is_undefined() {
            init.set_status(global_this, parts.status)?;
        }
        let status_text = parts.status_text;
        if !status_text.is_empty_or_undefined_or_null()
            && !(status_text.is_string() && !status_text.to_boolean())
        {
            init.status_text = status_text.to_bun_string(global_this)?;
        }
        Ok(init)
    }

    fn set_headers(&mut self, global_this: &JSGlobalObject, headers: JSValue) -> JsResult<()> {
        self.headers = HeadersInit::copy_from_js(global_this, headers)?;
        Ok(())
    }

    fn set_status(&mut self, global_this: &JSGlobalObject, status_value: JSValue) -> JsResult<()> {
        let number = status_value.coerce_to_int64(global_this)?;
        if (200 <= number && number < 600) || number == 101 {
            self.status_code = (u32::try_from(number).expect("int cast")) as u16;
        } else {
            let err = global_this.create_range_error_instance(format_args!(
                "The status provided ({}) must be 101 or in the range of [200, 599]",
                number
            ));
            return Err(global_this.throw_value(err));
        }
        Ok(())
    }

    pub(crate) fn init(
        global_this: &JSGlobalObject,
        response_init: JSValue,
    ) -> JsResult<Option<Init>> {
        Self::init_with_default_status(global_this, response_init, 200)
    }

    /// Returns `None` if `response_init` is not an object.
    fn init_with_default_status(
        global_this: &JSGlobalObject,
        response_init: JSValue,
        default_status: u16,
    ) -> JsResult<Option<Init>> {
        let mut result = Init {
            status_code: default_status,
            ..Default::default()
        };

        if !response_init.is_cell() {
            return Ok(None);
        }

        if !response_init.js_type().is_object() {
            return Ok(None);
        }

        match Pristine::of(&response_init) {
            Pristine::Request(req) => {
                if let Some(headers) = req.get_fetch_headers_unless_empty() {
                    result.headers = headers.clone_this(global_this)?;
                }

                result.method = req.method.known().unwrap_or(Method::GET);
                return Ok(Some(result));
            }
            Pristine::Response(resp) => return Ok(Some(resp.init.get().clone(global_this)?)),
            Pristine::No => {}
        }

        if let Some(headers) = response_init.fast_get(global_this, BuiltinName::headers)? {
            result.set_headers(global_this, headers)?;
        }

        if let Some(status_value) = response_init.fast_get(global_this, BuiltinName::status)? {
            result.set_status(global_this, status_value)?;
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
