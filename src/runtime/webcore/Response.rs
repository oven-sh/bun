use core::cell::Cell;

use bun_jsc::JsCell;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{AbortSignal, GlobalRef, HeadersRef};
use bun_ptr::{CellExt as _, RefPtr};

use crate::webcore::jsc::{
    BuiltinName, HTTPHeaderName, JSGlobalObject, JSType, JSValue, JsError, JsRef, JsResult,
    StringJsc as _,
};
use bun_core::Output;
use bun_core::{String as BunString, StringView};
use bun_http_types::Method::Method;

use super::body::{
    Body, BodyMixin, Tag as BodyTag, Value as BodyValue, ValueError as BodyValueError,
};
use super::{FetchHeaders, ReadableStream, Request};

use super::blob::Blob;
use bun_ptr::weak_ptr::WeakPtrData;

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
            response.body().tag(),
            BodyTag::Used | BodyTag::Error | BodyTag::Null | BodyTag::Empty
        ) {
            // `Locked.readable` is a real `JSC::Weak`: `None` exactly when the stream's source is gone.
            if let Some(readable) = response.body().readable() {
                readable.value.ensure_still_alive();
                crate::dispatch::fold(readable.error(&global, reason));
            }
            let err = BodyValueError::JSValue(bun_jsc::strong::Optional::create(reason, &global));
            let _ = response.body().to_error_instance(err, &global);
        }
    }
}

use crate::generated_bindgen::response::js_Response as js;

#[inline]
pub(crate) fn from_js(value: JSValue) -> Option<*mut Response> {
    js::from_js(value).map(|p| p.as_ptr())
}

/// [`from_js`] as a shared borrow; `value` must stay rooted while it is used.
#[inline]
pub(crate) fn from_js_ref(value: JSValue) -> Option<bun_ptr::ParentRef<Response>> {
    from_js(value)
        .and_then(core::ptr::NonNull::new)
        .map(bun_ptr::ParentRef::from)
}

impl bun_jsc::JsClass for Response {
    fn from_js(value: JSValue) -> Option<*mut Self> {
        from_js(value)
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        js::from_js_direct(value).map(|p| p.as_ptr())
    }
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        Response::to_js(RefPtr::new(self), global)
    }
}

/// Every JS-facing member takes `&Response` (not
/// `&mut Response`) so re-entrant JS calls cannot stack two `&mut` to the same
/// instance. Fields the members mutate are therefore wrapped in `Cell` (Copy
/// scalars) or `JsCell` (non-Copy `init`/`url`). Both are
/// `#[repr(transparent)]`, so `#[repr(C)]` field layout is unchanged.
#[repr(C)]
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = bun_ptr::weak_ptr::destroy)]
pub(crate) struct Response {
    body: Body,
    init: JsCell<Init>,
    url: JsCell<BunString>,
    redirected: Cell<bool>,
    /// The JS wrapper, fetch (so a discarded JS Response can still resolve
    /// its body) and HTMLRewriter each hold a ref.
    ref_count: bun_ptr::RefCount,
    /// Bun.serve's RequestContext holds a weak reference so `onAbort` /
    /// `handleResolveStream` / `handleRejectStream` can safely observe that the
    /// Response was GC'd (null) instead of dereferencing a freed pointer when
    /// backpressure lets GC run between `render()` and the async callback.
    weak_ptr_data: WeakPtrData,
    js_ref: JsRef,

    // We must report a consistent value for this
    reported_estimated_size: Cell<usize>,

    /// Fetch's `AbortSignal` listener; survives `FetchTasklet` teardown so a fully-buffered body is still errored.
    abort_listener: JsCell<Option<bun_ptr::AliasableBox<BodyAbortListener>>>,
}

impl Default for Response {
    fn default() -> Self {
        Self {
            body: Body::default(),
            init: JsCell::new(Init::default()),
            url: JsCell::new(BunString::EMPTY),
            redirected: Cell::new(false),
            ref_count: bun_ptr::RefCount::init(),
            weak_ptr_data: WeakPtrData::EMPTY,
            js_ref: JsRef::empty(),
            reported_estimated_size: Cell::new(0),
            abort_listener: JsCell::new(None),
        }
    }
}

// SAFETY: see its `#[ref_count(destroy = …)]`. No field reaches a `WeakRef`.
unsafe impl bun_ptr::weak_ptr::HasWeakPtrData for Response {
    unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData {
        // SAFETY: caller guarantees `this` points to a live (possibly-finalized) allocation.
        unsafe { core::ptr::addr_of_mut!((*this).weak_ptr_data) }
    }
}
pub(crate) type WeakRef = bun_ptr::WeakPtr<Response>;

// Wire the codegen'd cached `body`/`stream` JS slot accessors + weak `js_ref`
// so the [`BodyMixin`] twin defaults can run generically.
impl crate::webcore::body::BodyOwnerJs for Response {
    #[inline]
    fn js_ref(&self) -> Option<JSValue> {
        self.js_ref.try_get()
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
        Response::body(self)
    }
    #[inline]
    fn get_content_type_header(&self) -> Option<BunString> {
        self.header(HTTPHeaderName::ContentType)
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
        Response {
            init: JsCell::new(response_init),
            body,
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
        self.init.get().headers.set(headers);
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

    /// The response has no headers while `f` runs.
    pub(crate) fn with_init_headers<R>(&self, f: impl FnOnce(Option<&FetchHeaders>) -> R) -> R {
        // Not `with_taken`, whose `&Init` would span `f`, which can call `set_init`.
        let headers = self.swap_init_headers();
        let result = f(headers.as_deref());
        self.set_init_headers(headers);
        result
    }

    pub(crate) fn header(&self, name: HTTPHeaderName) -> Option<BunString> {
        self.with_init_headers(|headers| headers?.fast_get(name))
    }

    pub(crate) fn has_header(&self, name: HTTPHeaderName) -> bool {
        self.with_init_headers(|headers| headers.is_some_and(|headers| headers.fast_has(name)))
    }

    /// Deep-copy this response's init headers (if any) into a fresh
    /// `HeadersRef`.
    #[inline]
    pub(crate) fn clone_init_headers(
        &self,
        global: &JSGlobalObject,
    ) -> JsResult<Option<HeadersRef>> {
        self.init.get().clone_headers(global)
    }

    #[inline]
    pub(crate) fn swap_init_headers(&self) -> Option<HeadersRef> {
        self.init.get().headers.take()
    }

    #[inline]
    pub(crate) fn get_method(&self) -> Method {
        self.init.get().method
    }

    pub(crate) fn estimated_size(this: &Response) -> usize {
        this.reported_estimated_size.get()
    }

    #[inline]
    pub(crate) fn body(&self) -> &Body {
        &self.body
    }
}

impl Response {
    #[inline]
    pub(crate) fn get_form_data_encoding(
        &self,
    ) -> JsResult<Option<Box<bun_core::form_data::AsyncFormData>>> {
        let encoding = self.with_content_type(bun_core::form_data::Encoding::get);
        Ok(encoding
            .flatten()
            .map(bun_core::form_data::AsyncFormData::init))
    }

    pub(crate) fn calculate_estimated_byte_size(&self) {
        self.reported_estimated_size.set(
            self.body.estimated_size()
                + self.url.get().byte_slice().len()
                + self.init.get().status_text.byte_slice().len(),
        );
    }

    #[inline]
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::check_body_stream_ref(self, global_object)
    }

    /// The wrapper adopts the ref.
    pub(crate) fn to_js(this: RefPtr<Self>, global_object: &JSGlobalObject) -> JSValue {
        this.calculate_estimated_byte_size();
        let js_value = js::to_js(this.as_ptr(), global_object);
        this.js_ref.set_weak(js_value);

        this.check_body_stream_ref(global_object);
        // The wrapper has held this ref since `js::to_js`.
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
    ///
    /// SAFETY: `this` must be a live heap `Response` (stored as the listener's [`ParentRef`]).
    pub(crate) unsafe fn attach_abort_signal(
        this: *mut Response,
        global: &JSGlobalObject,
        signal: &AbortSignal,
        context: bun_jsc::ContextId,
    ) {
        let listener = bun_ptr::AliasableBox::new(BodyAbortListener {
            abort_handle: bun_jsc::AbortHandle::for_owner::<BodyAbortListener>(),
            // SAFETY: caller contract; `this` is live and owns the box.
            response: unsafe { bun_ptr::ParentRef::from_raw_mut(this) },
            global: GlobalRef::new(global),
            context,
        });
        // SAFETY: on the heap until it drops.
        unsafe { bun_jsc::AbortHandle::follow_owner(listener.as_ptr(), signal.ref_()) };
        // SAFETY: caller contract; `this` is live.
        unsafe { (*this).abort_listener.set(Some(listener)) };
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
        if self.init.get().status_code < 200 {
            return cx.global().common_strings().error();
        }

        cx.global().common_strings().default()
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

    /// [`with_init_headers`](Self::with_init_headers), after creating them if there are none.
    fn with_init_headers_or_create<R>(
        &self,
        global_this: &JSGlobalObject,
        f: impl FnOnce(&FetchHeaders) -> JsResult<R>,
    ) -> JsResult<R> {
        self.init.get().headers.with_taken(|headers| {
            if let Some(headers) = headers {
                return f(headers);
            }
            let headers = headers.insert(HeadersRef::create_empty());
            self.body
                .with_blob_content_type(|content_type| {
                    headers.put(
                        HTTPHeaderName::ContentType,
                        &StringView::ascii(content_type),
                        global_this,
                    )
                })
                .transpose()?;
            f(headers)
        })
    }

    fn headers_to_js(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        self.with_init_headers_or_create(global_this, |headers| Ok(headers.to_js(global_this)))
    }

    pub(crate) fn put_default_content_type(
        &self,
        global_this: &JSGlobalObject,
        mime: &bun_http_types::MimeType::MimeType,
    ) -> JsResult<()> {
        let value = StringView::ascii(mime.value.as_ref());
        self.with_init_headers_or_create(global_this, |headers| {
            headers.put_default(HTTPHeaderName::ContentType, &value, global_this)
        })
    }

    fn put_location(&self, global_this: &JSGlobalObject, location: &BunString) -> JsResult<()> {
        self.with_init_headers_or_create(global_this, |headers| {
            headers.put(HTTPHeaderName::Location, location, global_this)
        })
    }

    pub(crate) fn get_headers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.headers_to_js(cx.global())
    }

    /// The header, else the type of a `Blob` body.
    pub(crate) fn with_content_type<R>(&self, f: impl FnOnce(&[u8]) -> R) -> Option<R> {
        if let Some(value) = self.get_content_type_header() {
            return Some(f(value.into_utf8().slice()));
        }
        self.body.with_blob_content_type(f)
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

        match self.body.known_size() {
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
                .headers_to_js(formatter.global_this())
                .map_err(js_err)?;
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
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_this = cx.global();
        self.throw_if_body_unusable(global_this)?;
        let cloned = self.clone(&cx)?;

        let js_wrapper = Response::to_js(cloned, global_this);
        self.sync_cloned_body_stream_caches(this_value.to_js(), js_wrapper, global_this);
        Ok(js_wrapper)
    }

    pub(crate) fn clone_value(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<Response> {
        let body = Body::new(self.clone_body_value_via_cached_stream(cx)?);
        let init = self.init.get().clone(cx.global())?;
        Ok(Response {
            body,
            init: JsCell::new(init),
            url: JsCell::new(self.url.get().clone()),
            redirected: Cell::new(self.redirected.get()),
            ..Default::default()
        })
    }

    pub(crate) fn clone(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<RefPtr<Response>> {
        Ok(RefPtr::new(self.clone_value(cx)?))
    }

    pub(crate) fn finalize(&self) {
        self.js_ref.finalize();
    }

    pub(crate) fn construct_json(cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let global_this = cx.global();
        let args = JsLocal::to_js_slice(args);
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4

        let response = Response {
            body: Body::new(BodyValue::Empty),
            init: JsCell::new(Init {
                status_code: 200,
                ..Default::default()
            }),
            ..Default::default()
        };

        if let Some(&json_value) = args.first() {
            let str = Self::json_text_of(global_this, json_value)?;

            if let Some(str) = str.into_wtf() {
                response.body.set(BodyValue::WTFStringImpl(str));
                response.body.to_blob_if_possible();
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

        response.put_default_content_type(global_this, &bun_http_types::MimeType::JSON)?;
        Ok(Response::to_js(RefPtr::new(response), global_this))
    }

    /// `construct_json` on a value and the members of a literal. The value is serialized before the members are taken.
    fn json_from_parts(
        global_this: &JSGlobalObject,
        json_value: JSValue,
        parts: &InitParts,
    ) -> JsResult<JSValue> {
        let response = Response {
            body: Body::new(BodyValue::Empty),
            ..Default::default()
        };
        let str = Self::json_text_of(global_this, json_value)?;
        if let Some(str) = str.into_wtf() {
            response.body.set(BodyValue::WTFStringImpl(str));
            response.body.to_blob_if_possible();
        }
        response.init.set(Init::from_parts(global_this, parts)?);
        response.put_default_content_type(global_this, &bun_http_types::MimeType::JSON)?;
        Ok(Response::to_js(RefPtr::new(response), global_this))
    }

    #[inline(always)]
    fn json_text_of(global_this: &JSGlobalObject, json_value: JSValue) -> JsResult<BunString> {
        // Validate top-level values that are not JSON serializable (Node.js compatibility)
        if json_value.is_undefined()
            || json_value.is_symbol()
            || json_value.js_type() == bun_jsc::JSType::JSFunction
            || json_value.js_type() == bun_jsc::JSType::CompiledClosure
            || json_value.js_type() == bun_jsc::JSType::SlimClosure
            || json_value.js_type() == bun_jsc::JSType::SlimClosureWithProperties
        {
            let err = global_this
                .create_type_error_instance(format_args!("Value is not JSON serializable"));
            return Err(global_this.throw_value(err));
        }

        // BigInt has a different error message to match Node.js exactly
        if json_value.is_big_int() {
            let err = global_this
                .create_type_error_instance(format_args!("Do not know how to serialize a BigInt"));
            return Err(global_this.throw_value(err));
        }

        // Use jsonStringifyFast which passes undefined for the space parameter, triggering JSC's FastStringifier optimization.
        json_value.json_stringify_fast(global_this)
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
            body: Body::new(BodyValue::Null),
            ..Default::default()
        };

        if let Some(&arg_init) = args.get(1) {
            if arg_init.is_undefined_or_null() {
                // no-op
            } else if arg_init.is_number() {
                let status = Self::validate_redirect_status_code(global_this, arg_init.to_int32())?;
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

        // https://fetch.spec.whatwg.org/#dom-response-redirect steps 1 & 6: `Location`
        // gets the serialization of the parsed url, not the raw input. Non-absolute
        // input keeps the raw string: relative redirects are documented Bun behavior.
        let href = bun_url::href_from_string(&url_string);
        // The JS string's own WTF string (no re-encode), same as `Headers.prototype.set`.
        let location = if href.is_empty() { &url_string } else { &href };
        response.put_location(global_this, location)?;
        Ok(Response::to_js(RefPtr::new(response), global_this))
    }

    pub(crate) fn error(cx: &mut JsScope<'_>) -> JSValue {
        let global_this = cx.global();
        let response = RefPtr::new(Response {
            init: JsCell::new(Init {
                status_code: 0,
                ..Default::default()
            }),
            body: Body::new(BodyValue::Null),
            ..Default::default()
        });

        Response::to_js(response, global_this)
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        body: JsLocal<'a>,
        init: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let response = Self::construct_into(cx.global(), body.to_js(), init.to_js())?;
        let this = response.this_ptr();
        let this_value = structure.create(&cx.heap, response);
        this.js_ref.set_weak(this_value.to_js());
        this.check_body_stream_ref(cx.global());
        Ok(this_value)
    }

    fn construct_into(
        global_this: &JSGlobalObject,
        body: JSValue,
        init: JSValue,
    ) -> JsResult<RefPtr<Response>> {
        if body.is_object() {
            // `as_class_ref` is the safe shared-borrow downcast (one audited
            // unsafe in `JSValue`); only `&self` accessors (`is_s3`, `store`)
            // are touched on this path.
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
                        body: Body::new(BodyValue::Null),
                        ..Default::default()
                    });

                    let s3 = blob.store().unwrap().data.as_s3();
                    let credentials = &s3.credentials;

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
                    response.put_location(global_this, &StringView::ascii(&result.url))?;
                    return Ok(response);
                }
            }
        }
        let init: Init = 'brk: {
            if init.is_undefined_or_null() {
                break 'brk Init {
                    status_code: 200,
                    ..Default::default()
                };
            }
            if init.is_object() {
                break 'brk Init::init(global_this, init)?.expect("unreachable");
            }
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Failed to construct 'Response': The provided body value is not of type 'ResponseInit'",
            )));
        };

        Self::from_body_and_init(global_this, body, init)
    }

    #[inline(always)]
    fn from_body_and_init(
        global_this: &JSGlobalObject,
        body: JSValue,
        mut init: Init,
    ) -> JsResult<RefPtr<Response>> {
        let body = if body.is_undefined_or_null() {
            BodyValue::Null
        } else {
            BodyValue::from_js(global_this, body)?
        };

        // from_js() throws without returning Err; see Blob::from_dom_form_data
        if global_this.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        if let BodyValue::Blob(blob) = &body {
            if let Some(headers) = init.headers.get_mut() {
                let content_type = blob.content_type_slice();
                if !content_type.is_empty() && !headers.fast_has(HTTPHeaderName::ContentType) {
                    headers.put(
                        HTTPHeaderName::ContentType,
                        &StringView::ascii(content_type),
                        global_this,
                    )?;
                }
            }
        }

        let response = RefPtr::new(Response {
            body: Body::new(body),
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
        let response = Self::from_body_and_init(global_this, body, init)?;
        Ok(Response::to_js(response, global_this))
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
// (e.g. Request::construct_into reading `response_init.headers`) keep working;
// the fields' own drop glue releases `headers` and `status_text`.
pub(crate) struct Init {
    pub(crate) headers: Cell<Option<HeadersRef>>,
    pub(crate) status_code: u16,
    pub(crate) status_text: BunString,
    pub method: Method,
}

impl Default for Init {
    fn default() -> Self {
        Self {
            headers: Cell::new(None),
            status_code: 0,
            status_text: BunString::EMPTY,
            method: Method::GET,
        }
    }
}

impl Init {
    fn clone_headers(&self, ctx: &JSGlobalObject) -> JsResult<Option<HeadersRef>> {
        self.headers.with_taken(|headers| match headers {
            // `clone_this` does a deep copy on the C++ side and may return
            // null on OOM/throw. Flatten the
            // `Option<HeadersRef>` so a null clone leaves `headers` empty.
            Some(head) => head.clone_this(ctx),
            None => Ok(None),
        })
    }

    pub(crate) fn clone(&self, ctx: &JSGlobalObject) -> JsResult<Init> {
        Ok(Init {
            headers: Cell::new(self.clone_headers(ctx)?),
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
        // `JSValue::as_::<FetchHeaders>()` requires `JsClass`; FetchHeaders is a hand-bound opaque, so use its dedicated `cast_()`.
        if let Some(orig) = FetchHeaders::cast_(headers, global_this.vm()) {
            if !orig.is_empty() {
                self.headers.set(orig.clone_this(global_this)?);
            }
        } else {
            self.headers
                .set(HeadersRef::create_from_js(global_this, headers)?);
        }
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
            if let Some(req) = response_init.as_direct::<Request>() {
                // SAFETY: `as_direct` returned a live `*mut Request` owned by the
                // JS wrapper cell; the wrapper is rooted by `response_init` for
                // the duration of this call, so no GC can finalize it here.
                // Everything touched is `&self`.
                let req = unsafe { &*req };
                if let Some(headers) = req.get_fetch_headers_unless_empty() {
                    result.headers.set(headers.clone_this(global_this)?);
                }

                result.method = req.method;
                return Ok(Some(result));
            }

            if let Some(resp) = response_init.as_direct::<Response>() {
                // SAFETY: `as_direct` returned a live `*mut Response` owned by the
                // JS wrapper cell; rooted by `response_init` for this call.
                let resp = unsafe { &*resp };
                return Ok(Some(resp.init.get().clone(global_this)?));
            }
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
