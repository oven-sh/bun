use core::cell::Cell;
use core::ptr::NonNull;

use bun_jsc::JsCell;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{AbortSignal, GlobalRef};
use bun_ptr::RefPtr;

use crate::webcore::jsc::{
    BuiltinName, HTTPHeaderName, JSGlobalObject, JSType, JSValue, JsError, JsRef, JsResult,
    StringJsc as _,
};
use bun_core::Output;
use bun_core::{String as BunString, Utf8Bytes};
use bun_http_types::Method::Method;

use super::body::{Body, BodyMixin, Value as BodyValue, ValueError as BodyValueError};
use super::{FetchHeaders, ReadableStream, Request};

use super::blob::Blob;
use bun_ptr::weak_ptr::WeakPtrData;

/// RAII handle to a C++-owned `WebCore::FetchHeaders`.
///
/// Holds exactly one ref on the C++ intrusive refcount; `Drop` releases it via
/// `WebCore__FetchHeaders__deref`. NOT a `std::rc::Rc` (the payload lives on
/// the C++ heap and is opaque here).
///
/// Intentionally not `Clone`: the only "share" operation the surface
/// exposes is `clone_this()`, which deep-copies a fresh `FetchHeaders` on the
/// C++ side. Transferring ownership is by-move.
#[repr(transparent)]
pub(crate) struct HeadersRef(NonNull<FetchHeaders>);

impl HeadersRef {
    /// Adopt a freshly-created `FetchHeaders*` (refcount already 1).
    ///
    /// # Safety
    /// `ptr` must be a valid `WebCore::FetchHeaders*` and the caller must
    /// transfer ownership of one ref.
    #[inline]
    pub(crate) unsafe fn adopt(ptr: NonNull<FetchHeaders>) -> Self {
        Self(ptr)
    }

    #[inline]
    pub(crate) fn as_ptr(&self) -> *mut FetchHeaders {
        self.0.as_ptr()
    }

    /// `FetchHeaders.createEmpty()` — fresh C++ allocation, refcount 1.
    #[inline]
    pub(crate) fn create_empty() -> Self {
        // SAFETY: C++ allocates a new FetchHeaders with refcount 1; never null.
        unsafe { Self::adopt(FetchHeaders::create_empty()) }
    }

    /// `FetchHeaders.createFromUWS(req)` — fresh C++ allocation, refcount 1.
    #[inline]
    pub(crate) fn create_from_uws(uws_request: *mut core::ffi::c_void) -> Self {
        // SAFETY: C++ allocates a new FetchHeaders with refcount 1; never null.
        unsafe { Self::adopt(FetchHeaders::create_from_uws(uws_request)) }
    }

    /// `FetchHeaders.createFromJS(global, value)` — may throw, may return null.
    #[inline]
    pub(crate) fn create_from_js(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<Self>> {
        // SAFETY: C++ returns a +1 ref or null.
        Ok(FetchHeaders::create_from_js(global, value)?.map(|p| unsafe { Self::adopt(p) }))
    }

    /// `FetchHeaders.cloneThis(global)` — deep copy on the C++ side.
    #[inline]
    pub(crate) fn clone_this(&self, global: &JSGlobalObject) -> JsResult<Option<Self>> {
        // SAFETY: C++ returns a +1 ref or null.
        Ok(bun_opaque::opaque_deref_mut(self.0.as_ptr())
            .clone_this(global)?
            .map(|p| unsafe { Self::adopt(p) }))
    }
}

impl core::ops::Deref for HeadersRef {
    type Target = FetchHeaders;
    #[inline]
    fn deref(&self) -> &FetchHeaders {
        // `FetchHeaders` is an opaque ZST FFI handle (S008); `self.0` is live
        // for the lifetime of `self` — safe `*const → &` via `opaque_deref`.
        bun_opaque::opaque_deref(self.0.as_ptr())
    }
}

impl core::ops::DerefMut for HeadersRef {
    #[inline]
    fn deref_mut(&mut self) -> &mut FetchHeaders {
        // `FetchHeaders` is an opaque ZST FFI handle (S008); `self.0` is live
        // for the lifetime of `self` — safe `*mut → &mut` via `opaque_deref_mut`.
        bun_opaque::opaque_deref_mut(self.0.as_ptr())
    }
}

impl Drop for HeadersRef {
    #[inline]
    fn drop(&mut self) {
        // `self.0` is live; releasing our +1 ref via WebCore__FetchHeaders__deref.
        // Explicit UFCS to avoid `core::ops::Deref::deref` resolution ambiguity.
        // `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
        FetchHeaders::deref(bun_opaque::opaque_deref_mut(self.0.as_ptr()));
    }
}

/// Errors the owning fetch `Response`'s body on abort (Fetch spec "abort a fetch" step 4).
pub(crate) struct BodyAbortListener {
    abort_handle: bun_jsc::AbortHandle,
    /// `Response` owns `Box<Self>`, so a ref-counted pointer here would cycle.
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
        Response::make_maybe_pooled(global, bun_core::heap::into_raw(Box::new(self)))
    }
}

/// Every JS-facing member takes `&Response` (not
/// `&mut Response`) so re-entrant JS calls cannot stack two `&mut` to the same
/// instance. Fields the members mutate are therefore wrapped in `Cell` (Copy
/// scalars) or `JsCell` (non-Copy `body`/`init`/`url`/`js_ref`). Both are
/// `#[repr(transparent)]`, so `#[repr(C)]` field layout is unchanged.
#[repr(C)]
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Response::destroy)]
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
    js_ref: JsCell<JsRef>,

    // We must report a consistent value for this
    reported_estimated_size: Cell<usize>,

    /// Fetch's `AbortSignal` listener; survives `FetchTasklet` teardown so a fully-buffered body is still errored.
    abort_listener: JsCell<Option<Box<BodyAbortListener>>>,
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
            abort_listener: JsCell::new(None),
        }
    }
}

impl bun_ptr::weak_ptr::HasWeakPtrData for Response {
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

    /// Deep-copy this response's init headers (if any) into a fresh
    /// `HeadersRef`. Centralises the `FetchHeaders::clone_this` +
    /// `HeadersRef::adopt` pair so callers stay `unsafe`-free.
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
    #[inline]
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
            self.body.get().value.get().estimated_size()
                + self.url.get().byte_slice().len()
                + self.init.get().status_text.byte_slice().len(),
        );
    }

    #[inline]
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::check_body_stream_ref(self, global_object)
    }

    /// # Safety
    /// `this` is a live heap allocation and the caller owns a ref on it, which the wrapper adopts.
    pub(crate) unsafe fn to_js(this: *mut Self, global_object: &JSGlobalObject) -> JSValue {
        // SAFETY: fn contract.
        let response = unsafe { &*this };
        response.calculate_estimated_byte_size();
        let js_value = js::to_js(this, global_object);
        response.js_ref.set(JsRef::init_weak(js_value));

        response.check_body_stream_ref(global_object);
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
        let listener = bun_core::heap::into_raw(Box::new(BodyAbortListener {
            abort_handle: bun_jsc::AbortHandle::for_owner::<BodyAbortListener>(),
            // SAFETY: caller contract; `this` is live and owns the box.
            response: unsafe { bun_ptr::ParentRef::from_raw_mut(this) },
            global: GlobalRef::new(global),
            context,
        }));
        // SAFETY: `listener` is a live heap allocation; both calls keep its provenance.
        let listener = unsafe {
            bun_jsc::AbortHandle::follow_owner(listener, signal.ref_());
            bun_core::heap::take(listener)
        };
        // SAFETY: caller contract; `this` is live.
        unsafe { (*this).abort_listener.set(Some(listener)) };
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

    pub(crate) fn get_or_create_headers(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<&mut HeadersRef> {
        // R-2 escape hatch via `init_mut()` — the returned `&mut HeadersRef`
        // borrows `self.init`; callers (`get_headers`, `construct_*`) do not
        // hold the borrow across calls that re-enter Response host-fns.
        let init = self.init_mut();
        if init.headers.is_none() {
            init.headers = Some(HeadersRef::create_empty());

            if let BodyValue::Blob(blob) = self.body.get().value.get() {
                let content_type = blob.content_type_slice();
                if !content_type.is_empty() {
                    init.headers.as_mut().unwrap().put(
                        HTTPHeaderName::ContentType,
                        &BunString::ascii(content_type),
                        global_this,
                    )?;
                }
            }
        }

        Ok(init.headers.as_mut().unwrap())
    }

    pub(crate) fn get_headers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        Ok(self.get_or_create_headers(global_this)?.to_js(global_this))
    }

    pub(crate) fn get_content_type(&self) -> JsResult<Option<Utf8Bytes<'_>>> {
        // R-2 escape hatch via `init_mut()` — `fast_get` (FFI out-param write)
        // does not re-enter JS.
        if let Some(headers) = self.init_mut().headers.as_mut() {
            if let Some(value) = headers.fast_get(HTTPHeaderName::ContentType) {
                return Ok(Some(value.to_utf8()));
            }
        }

        if let BodyValue::Blob(blob) = self.body.get().value.get() {
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
            // SAFETY: R-2 `JsCell` escape hatch — `Body::write_format` takes
            // `&mut self`; single-JS-thread invariant.
            unsafe { self.body.get_mut() }
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

        // SAFETY: `cloned` is a freshly-boxed Response from `clone()`.
        let js_wrapper = Response::make_maybe_pooled(global_this, cloned);
        self.sync_cloned_body_stream_caches(this_value.to_js(), js_wrapper, global_this);
        Ok(js_wrapper)
    }

    /// # Safety
    /// `ptr` must point to a live `Response` allocation (e.g. freshly boxed via
    /// [`Response::clone`]); ownership of the +1 ref transfers to the returned
    /// JS wrapper.
    pub(crate) fn make_maybe_pooled(global_object: &JSGlobalObject, ptr: *mut Response) -> JSValue {
        // SAFETY: caller contract — `ptr` is live and uniquely owned.
        unsafe { Response::to_js(ptr, global_object) }
    }

    pub(crate) fn clone_value(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<Response> {
        let body = Body::new(self.clone_body_value_via_cached_stream(cx)?);
        // `Body` has NO `Drop`; arm a guard so the
        // `?` below releases the cloned body payload.
        let body = scopeguard::guard(body, |b| b.reset());
        let init = self.init.get().clone(cx.global())?;
        Ok(Response {
            body: JsCell::new(scopeguard::ScopeGuard::into_inner(body)),
            init: JsCell::new(init),
            url: JsCell::new(self.url.get().clone()),
            redirected: Cell::new(self.redirected.get()),
            ..Default::default()
        })
    }

    pub(crate) fn clone(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<*mut Response> {
        Ok(bun_core::heap::into_raw(Box::new(self.clone_value(cx)?)))
    }

    fn destroy(this: *mut Response) {
        // SAFETY: ref_count hit 0; this is the unique owner
        unsafe {
            // We assign safe-empty values rather than `drop_in_place` so the
            // struct stays in a valid (all-empty) state if `on_finalize()`
            // returns false and the allocation outlives this call until the
            // last WeakRef releases it.
            //
            // - `Init` field drop glue releases `headers` (HeadersRef::Drop →
            //   C++ deref) and `status_text` (WTF deref).
            // - `Body` has NO `Drop`; `reset()` is the explicit cleanup API
            //   (Body.rs renames `deinit` → `reset`). `drop_in_place` here
            //   would leak refcounted payloads (WTFStringImpl, Blob store).
            // - `url` — assignment drops the old value (WTF deref).
            // - `JsRef` — assignment drops the `Strong` arm (block slot released).
            (*this).init.set(Init::default());
            (*this).body.get_mut().reset();
            (*this).url.set(BunString::EMPTY);
            (*this).js_ref.set(JsRef::empty());
            (*this).abort_listener.set(None);

            // Contents are gone; the allocation itself stays until any outstanding
            // WeakRef derefs (RequestContext.response_weakref). WeakRef.get() returns
            // null from here on.
            if (*this).weak_ptr_data.on_finalize() {
                // Do NOT use heap::take — that would re-run field drop glue
                // on init/url/js_ref. They are now safe-empty so the second drop
                // would be a no-op, but it is still wasted work and fragile under
                // future field additions; free the allocation with a raw dealloc.
                let layout = std::alloc::Layout::new::<Response>();
                std::alloc::dealloc(this.cast::<u8>(), layout);
            }
        }
    }

    pub(crate) fn finalize(&self) {
        self.js_ref.with_mut(|r| r.finalize());
    }

    pub(crate) fn construct_json(cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let args = JsLocal::to_js_slice(args);
        Self::construct_json_response(cx.global(), args, JsonArgument::Value)
    }

    fn construct_json_response(
        global_this: &JSGlobalObject,
        args: &[JSValue],
        argument: JsonArgument,
    ) -> JsResult<JSValue> {
        // https://github.com/remix-run/remix/blob/db2c31f64affb2095e4286b91306b96435967969/packages/remix-server-runtime/responses.ts#L4

        // `Init`'s field drop glue releases its refs on `?`. `Body` has NO `Drop` and its
        // `WTFStringImpl` arm is a raw `*mut` (no drop glue), so wrap the
        // stack value in a scopeguard that calls `body.reset()`
        // on early return; disarmed before `heap::alloc`.
        let response = scopeguard::guard(
            Response {
                body: JsCell::new(Body::new(BodyValue::Empty)),
                init: JsCell::new(Init {
                    status_code: 200,
                    ..Default::default()
                }),
                ..Default::default()
            },
            |r| r.body.get().reset(),
        );

        if let Some(&json_value) = args.first() {
            let str = Self::json_text_of(global_this, json_value, argument)?;

            if !str.is_empty() {
                debug_assert!(str.tag() == bun_core::Tag::WTFStringImpl);
                let value = &response.body.get().value;
                value.set(BodyValue::WTFStringImpl(str.leak_wtf_impl()));
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
            &BunString::ascii(json_mime.value.as_ref()),
            global_this,
        )?;
        // Disarm the body-reset guard: all fallible ops have succeeded.
        let response = scopeguard::ScopeGuard::into_inner(response);
        let ptr = bun_core::heap::into_raw(Box::new(response));
        // SAFETY: `ptr` is freshly boxed; the wrapper adopts its ref.
        Ok(unsafe { Response::to_js(ptr, global_this) })
    }

    fn json_text_of(
        global_this: &JSGlobalObject,
        json_value: JSValue,
        argument: JsonArgument,
    ) -> JsResult<BunString> {
        if argument == JsonArgument::Text && json_value.is_string_literal() {
            return json_value.to_bun_string(global_this);
        }

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
            body: JsCell::new(Body::new(BodyValue::Null)),
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

        // `get_or_create_headers` already populated init.headers.
        let headers = response.get_or_create_headers(global_this)?;
        // https://fetch.spec.whatwg.org/#dom-response-redirect steps 1 & 6: `Location`
        // gets the serialization of the parsed url, not the raw input. Non-absolute
        // input keeps the raw string: relative redirects are documented Bun behavior.
        let href = bun_url::href_from_string(&url_string);
        // The JS string's own WTF string (no re-encode), same as `Headers.prototype.set`.
        let location = if href.is_empty() { &url_string } else { &href };
        headers.put(HTTPHeaderName::Location, location, global_this)?;
        let ptr = bun_core::heap::into_raw(Box::new(response));
        // SAFETY: `ptr` is freshly boxed; the wrapper adopts its ref.
        Ok(unsafe { Response::to_js(ptr, global_this) })
    }

    pub(crate) fn error(cx: &mut JsScope<'_>) -> JSValue {
        let global_this = cx.global();
        let response = bun_core::heap::into_raw(Box::new(Response {
            init: JsCell::new(Init {
                status_code: 0,
                ..Default::default()
            }),
            body: JsCell::new(Body::new(BodyValue::Null)),
            ..Default::default()
        }));

        // SAFETY: `response` is freshly boxed; the wrapper adopts its ref.
        unsafe { Response::to_js(response, global_this) }
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
        this.js_ref.set(JsRef::init_weak(this_value.to_js()));
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
                        &BunString::ascii(&result.url),
                        global_this,
                    )?;
                    return Ok(response);
                }
            }
        }
        let init: Init = 'brk: {
            if init.is_undefined_or_null() {
                break 'brk Init {
                    status_code: 200,
                    headers: None,
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
        let body: Body = 'brk: {
            if body.is_undefined_or_null() {
                break 'brk Body::new(BodyValue::Null);
            }
            // `Body::extract` is a free fn re-exported as `body::extract`.
            super::body::extract(global_this, body)?
        };
        // `Body` has NO `Drop`; arm a guard so the
        // error returns below release the extracted body payload.
        let body = scopeguard::guard(body, |b| b.reset());

        // extract() throws without returning Err; see Blob::from_dom_form_data
        if global_this.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }

        // Perform the only remaining fallible op BEFORE heap-allocating:
        // doing it on stack locals lets `?` trigger the scopeguard and
        // `init`'s drop glue and avoids leaking the heap allocation entirely.
        if let BodyValue::Blob(blob) = body.value.get() {
            if let Some(headers) = init.headers.as_deref_mut() {
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

        // Disarm: all fallible ops have succeeded.
        let body = scopeguard::ScopeGuard::into_inner(body);
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
        let response = Self::from_body_and_init(global_this, body, init)?;
        // SAFETY: the wrapper adopts the new response's only ref.
        Ok(unsafe { Response::to_js(response.into_raw(), global_this) })
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
    global_this: *mut JSGlobalObject,
    body: JSValue,
    status: JSValue,
    status_text: JSValue,
    headers: JSValue,
) -> JSValue {
    // SAFETY: compiled code passes its live realm.
    let global_this = unsafe { &*global_this };
    let parts = InitParts {
        status,
        status_text,
        headers,
    };
    bun_jsc::to_js_host_call(global_this, || {
        Response::from_parts(global_this, body, &parts)
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum JsonArgument {
    Value,
    Text,
}

/// `Response.json(value, init)` for compiled code that has already serialized `value`: argument 0 is the JSON text (`jsonTextForm`).
pub(crate) fn construct_json_from_text(
    cx: &mut JsScope<'_>,
    args: &[JsLocal<'_>],
) -> JsResult<JSValue> {
    let args = JsLocal::to_js_slice(args);
    Response::construct_json_response(cx.global(), args, JsonArgument::Text)
}

// We deliberately do NOT `impl Drop for Init` so struct-update
// syntax (`Init { status_code: x, ..Default::default() }`) and partial moves
// (e.g. Request::construct_into reading `response_init.headers`) keep working;
// the fields' own drop glue releases `headers` and `status_text`.
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
        // `JSValue::as_::<FetchHeaders>()` requires `JsClass`; FetchHeaders is a hand-bound opaque, so use its dedicated `cast()` (wraps `WebCore__FetchHeaders__cast_`).
        if let Some(orig) = FetchHeaders::cast(headers) {
            // `orig` is a live `WebCore::FetchHeaders*` borrowed from JS; `FetchHeaders` is an opaque ZST FFI handle (S008) — safe deref.
            let orig = bun_opaque::opaque_deref_mut(orig.as_ptr());
            if !orig.is_empty() {
                self.headers = orig.clone_this(global_this)?.map(|p| {
                    // SAFETY: `clone_this` returns a fresh +1-ref'd `FetchHeaders*`;
                    // ownership of that ref is transferred into the `HeadersRef`.
                    unsafe { HeadersRef::adopt(p) }
                });
            }
        } else {
            self.headers = HeadersRef::create_from_js(global_this, headers)?;
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
                    result.headers = headers.clone_this(global_this)?;
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
