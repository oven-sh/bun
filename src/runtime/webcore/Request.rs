//! https://developer.mozilla.org/en-US/docs/Web/API/Request

use core::cell::Cell;
use core::ptr::NonNull;
use std::borrow::Cow;

use bun_jsc::JsCell;

use super::response::HeadersRef;
use crate::api::AnyRequestContext;
use crate::generated_bindgen::response::js_Request as js;
use crate::webcore::BlobExt as _;
use crate::webcore::body::{self, BodyHiveHandle, BodyMixin, Value as BodyValue};
use crate::webcore::fetch::request_init::{self, InitSources};
use crate::webcore::jsc::{HTTPHeaderName, JSGlobalObject, JSValue, JsError, JsRef, JsResult};
use crate::webcore::{AbortSignal, Blob, CookieMap, ReadableStream, Response};
use bun_alloc::AllocError;
use bun_core::{Output, fmt as bun_fmt};
use bun_core::{String as BunString, StringView, strings};
use bun_http_jsc::fetch_enums_jsc::{
    fetch_cache_mode_to_js, fetch_redirect_to_js, fetch_request_mode_to_js,
};
use bun_http_jsc::method_jsc::{self, MethodJsc as _};
use bun_http_types::FetchCacheMode::FetchCacheMode;
use bun_http_types::FetchRedirect::FetchRedirect;
use bun_http_types::FetchRequestMode::FetchRequestMode;
use bun_http_types::Method::{Method, OwnedMethod};
use bun_jsc::AbortSignalRef;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::StringJsc as _;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_ptr::RefPtr;
use bun_ptr::weak_ptr::WeakPtrData;
use core::mem::ManuallyDrop;

impl bun_ptr::weak_ptr::HasWeakPtrData for Request {
    unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData {
        // SAFETY: caller guarantees `this` points to a live (possibly-finalized) allocation.
        unsafe { core::ptr::addr_of_mut!((*this).weak_ptr_data) }
    }
}
pub(crate) type WeakRef = bun_ptr::WeakPtr<Request>;

impl bun_jsc::JsClass for Request {
    fn from_js(value: JSValue) -> Option<*mut Self> {
        js::from_js(value).map(|p| p.as_ptr())
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        js::from_js_direct(value).map(|p| p.as_ptr())
    }
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        let ptr = Request::new(self);
        // SAFETY: `ptr` is a new heap allocation; the wrapper made by the inherent `to_js` adopts its ref.
        unsafe { Request::to_js(ptr, global) }
    }
}

/// Every JS-facing member takes `&Request` (not
/// `&mut Request`) so re-entrant JS calls cannot stack two `&mut` to the same
/// instance. Fields the members mutate are wrapped in `Cell` (Copy scalars)
/// or `JsCell` (Drop types). Both are `#[repr(transparent)]`, so `#[repr(C)]`
/// field layout is unchanged. `method`/`flags`/`request_context`/`body`/
/// `weak_ptr_data` are only written during construction or via raw-ptr
/// `destroy`, so stay plain.
#[repr(C)]
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Request::destroy)]
pub(crate) struct Request {
    pub(crate) url: JsCell<BunString>,

    headers: JsCell<Option<HeadersRef>>,
    // AbortSignal is an opaque C++ handle with intrusive WebCore refcounting —
    // `Arc` of an opaque ZST is meaningless (its payload address is not the
    // C++ object). `AbortSignalRef` wraps `NonNull<AbortSignal>` and routes
    // Clone/Drop to the C++ ref/unref.
    signal: JsCell<Option<AbortSignalRef>>,
    /// Owning `+1` handle into the per-VM `Body::Value` hive pool. The
    /// `Request` and (when served by `Bun.serve`) the `RequestContext` each
    /// hold their own `+1` on the same slot. `ManuallyDrop` because
    /// `destroy()` decouples from `Box` and must release this handle exactly
    /// once before `Box::from_raw().drop()` (which would otherwise re-run it).
    body: ManuallyDrop<BodyHiveHandle>,
    js_ref: JsCell<JsRef>,
    pub method: OwnedMethod,
    pub(crate) request_context: AnyRequestContext,
    /// The JS wrapper holds the only ref, so `destroy` runs when it is collected.
    ref_count: Cell<u32>,
    /// Bun.serve's RequestContext holds a weak reference, which can outlive the wrapper.
    pub(crate) weak_ptr_data: WeakPtrData,
    pub(crate) flags: Flags,
    // We must report a consistent value for this
    reported_estimated_size: Cell<usize>,
}

// A `#[repr(C)]` 4-byte struct for direct
// field access — `Request` is only ever passed to C++ by **pointer**, so the absolute size is
// not ABI-locked. `#[repr(C)]` + `assert_ffi_layout!` make the layout
// deterministic and grep-discoverable.
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Flags {
    pub(crate) redirect: FetchRedirect,
    pub(crate) cache: FetchCacheMode,
    pub(crate) mode: FetchRequestMode,
    pub(crate) https: bool,
}

bun_core::assert_ffi_layout!(Flags, 4, 1; redirect @ 0, cache @ 1, mode @ 2, https @ 3);

impl Default for Flags {
    fn default() -> Self {
        Self {
            redirect: FetchRedirect::Follow,
            cache: FetchCacheMode::Default,
            mode: FetchRequestMode::Cors,
            https: false,
        }
    }
}

// Heap-allocates via Box::new (global mimalloc).
impl Request {
    /// The caller owns the one ref, which the JS wrapper adopts in `to_js`.
    #[inline]
    pub(crate) fn new(v: Request) -> *mut Request {
        bun_core::heap::into_raw(Box::new(v))
    }
}

// Wire the codegen'd cached `body`/`stream` JS slot accessors + weak `js_ref`
// so the [`BodyMixin`] twin defaults can run generically.
impl crate::webcore::body::BodyOwnerJs for Request {
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

impl BodyMixin for Request {
    #[inline]
    fn get_body_value(&self) -> &mut BodyValue {
        Request::get_body_value(self)
    }
    #[inline]
    fn get_content_type(&self) -> Option<bun_core::Utf8Bytes<'_>> {
        Request::get_content_type(self)
    }
    #[inline]
    fn ensure_headers(&self, global_this: &JSGlobalObject) -> bun_jsc::JsResult<()> {
        self.ensure_fetch_headers(global_this).map(|_| ())
    }
}

// ─── header accessors & simple getters ──────────────────────────────────────
impl Request {
    /// Inherent shim; `impl BodyMixin for Request` supplies the real trait method.
    #[inline]
    pub(crate) fn get_body_value(&self) -> &mut BodyValue {
        self.body_value_mut()
    }

    /// Immutable view of the body value.
    #[inline]
    fn body_value(&self) -> &BodyValue {
        &self.body
    }

    /// R-2: `&self` → `&mut` through the slot's raw pointer. The slot is shared
    /// with `RequestContext.request_body` but never `&mut`-borrowed concurrently
    /// (single-threaded event-loop sequencing). Keep the borrow short.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn body_value_mut(&self) -> &mut BodyValue {
        // SAFETY: see R-2 invariant above.
        unsafe { &mut (*self.body.as_ptr()).value }
    }

    /// R-2: short-hand for `unsafe { self.headers.get_mut() }`. The
    /// single-JS-thread invariant (see `JsCell` docs) means no other
    /// `&mut Option<HeadersRef>` is live for the duration of the borrow.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn headers_mut(&self) -> &mut Option<HeadersRef> {
        // SAFETY: single-JS-thread; callers below keep the borrow short and do
        // not re-enter a path that touches `self.headers`.
        unsafe { self.headers.get_mut() }
    }

    // Returns if the request has headers already cached/set.
    pub(crate) fn has_fetch_headers(&self) -> bool {
        self.headers.get().is_some()
    }

    /// Sets the headers of the request. This will take ownership of the headers.
    /// it will deref the previous headers if they exist.
    pub(crate) fn set_fetch_headers(&self, headers: Option<HeadersRef>) {
        // old_headers.deref() → handled by HeadersRef::Drop on assignment
        self.headers.set(headers);
    }

    /// Returns the headers of the request. If the headers are not already cached, it will create a new FetchHeaders object.
    /// If the headers are empty, it will look at request_context to get the headers.
    /// If the headers are empty and request_context is null, it will create an empty FetchHeaders object.
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn ensure_fetch_headers(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<&mut HeadersRef> {
        if let Some(headers) = self.headers_mut() {
            // headers is already set
            return Ok(headers);
        }

        if let Some(req) = self.request_context.get_request() {
            // we have a request context, so we can get the headers from it
            self.headers.set(Some(HeadersRef::create_from_uws(
                req.cast::<core::ffi::c_void>(),
            )));
        } else {
            // we don't have a request context, so we need to create an empty headers object
            let headers = self.headers_mut().insert(HeadersRef::create_empty());
            let body = self.body_value();
            body.put_content_type_default(headers, global_this)?;
            // Only this header list takes the type of a Blob whose unread stream() is the body.
            if let BodyValue::Locked(locked) = body
                && let Some(readable) = locked.readable.get()
                && let crate::webcore::readable_stream::Source::Blob(loader) = readable.ptr
            {
                // SAFETY: `locked.readable` holds the stream, which keeps its `ByteBlobLoader` alive.
                let content_type = unsafe { (*loader).content_type.get() };
                if !content_type.is_empty() {
                    headers.put_default(
                        HTTPHeaderName::ContentType,
                        &StringView::ascii(content_type.as_slice()),
                        global_this,
                    )?;
                }
            }
        }

        Ok(self.headers_mut().as_mut().unwrap())
    }

    pub(crate) fn get_fetch_headers_unless_empty(&self) -> Option<&mut HeadersRef> {
        if self.headers.get().is_none() {
            if let Some(req) = self.request_context.get_request() {
                // we have a request context, so we can get the headers from it
                self.headers.set(Some(HeadersRef::create_from_uws(
                    req.cast::<core::ffi::c_void>(),
                )));
            }
        }

        let headers = self.headers_mut().as_mut()?;
        if headers.is_empty() {
            return None;
        }
        Some(headers)
    }

    /// This should only be called by the JS code. use getFetchHeaders to get the current headers or ensureFetchHeaders to get the headers and create them if they don't exist.
    pub(crate) fn get_headers(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        Ok(self.ensure_fetch_headers(global_this)?.to_js(global_this))
    }

    pub(crate) fn clone_headers(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<HeadersRef>> {
        if self.headers.get().is_none() {
            if let Some(uws_req) = self.request_context.get_request() {
                self.headers.set(Some(HeadersRef::create_from_uws(
                    uws_req.cast::<core::ffi::c_void>(),
                )));
            }
        }

        if let Some(head) = self.headers_mut().as_mut() {
            if head.is_empty() {
                return Ok(None);
            }

            return head.clone_this(global_this);
        }

        Ok(None)
    }

    pub(crate) fn get_content_type(&self) -> Option<bun_core::Utf8Bytes<'_>> {
        // The header list has what the handler changed, so the request it was made from comes second.
        if let Some(headers) = self.headers_mut().as_mut() {
            if let Some(value) = headers.fast_get(HTTPHeaderName::ContentType) {
                return Some(value.to_utf8());
            }
        } else if let Some(req) = self.request_context.get_request() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST handle — safe deref.
            let req = bun_opaque::opaque_deref(req);
            if let Some(value) = req.header(b"content-type") {
                return Some(bun_core::Utf8Bytes::Borrowed(value));
            }
        }

        let content_type = self.body_value().content_type().as_slice();
        (!content_type.is_empty()).then_some(bun_core::Utf8Bytes::Borrowed(content_type))
    }
}

impl Request {
    pub(crate) fn memory_cost(&self) -> usize {
        self.request_context.memory_cost()
            + self.url.get().byte_slice().len()
            + self.body_value().memory_cost()
    }

    #[bun_uws::uws_callback(export = "Request__setCookiesOnRequestContext")]
    pub(crate) fn ffi_set_cookies_on_request_context(&self, cookie_map: Option<&CookieMap>) {
        self.request_context
            .set_cookies(cookie_map.map(|c| std::ptr::from_ref::<CookieMap>(c).cast_mut()));
    }

    /// `BunRequest.prototype.clone` (`JSBunRequest::clone`) calls this, not [`Self::do_clone`], so it needs the same check.
    #[bun_uws::uws_callback(export = "Request__clone")]
    pub(crate) fn ffi_clone(&self, global_this: &JSGlobalObject) -> Option<NonNull<Request>> {
        self.throw_if_body_unusable(global_this).ok()?;
        // `BunRequest.prototype.clone`, a C++ host function, calls this.
        let cx = global_this.js_thread_of_caller();
        NonNull::new(self.clone(&cx).ok()?)
    }

    /// `JSBunRequest::clone` tail: mirror [`Self::do_clone`]'s cache sync so a
    /// `routes:` handler that observed `.body` before cloning gets a fresh tee
    /// branch from the next `.body` read instead of the locked tee source.
    #[bun_uws::uws_callback(export = "Request__syncClonedBodyStreamCaches")]
    pub(crate) fn ffi_sync_cloned_body_stream_caches(
        &self,
        global_this: &JSGlobalObject,
        this_value: JSValue,
        cloned: &Request,
        js_wrapper: JSValue,
    ) {
        // `JSBunRequest::create` bypasses `to_js`, so seed the still-empty
        // `js_ref` for `check_body_stream_ref`; guarded so a pre-populated
        // Strong is never downgraded.
        if cloned.js_ref.get().is_empty() {
            cloned.js_ref.set(JsRef::init_weak(js_wrapper));
        }
        cloned.check_body_stream_ref(global_this);
        self.sync_cloned_body_stream_caches(this_value, js_wrapper, global_this);
    }
}

impl Request {
    /// TODO: do we need this?
    pub(crate) fn init2(
        url: BunString,
        headers: Option<HeadersRef>,
        body: BodyHiveHandle,
        method: OwnedMethod,
    ) -> Request {
        Request {
            url: JsCell::new(url),
            headers: JsCell::new(headers),
            signal: JsCell::new(None),
            body: ManuallyDrop::new(body),
            js_ref: JsCell::new(JsRef::empty()),
            method,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            ref_count: Cell::new(1),
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
        }
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.reported_estimated_size.get()
    }

    #[bun_uws::uws_callback(export = "Bun__JSRequest__calculateEstimatedByteSize")]
    pub(crate) fn calculate_estimated_byte_size(&self) {
        self.reported_estimated_size
            .set(self.body_value().estimated_size() + self.size_of_url());
    }
}

impl Request {
    #[inline]
    pub(crate) fn get_body_readable_stream(&self) -> Option<ReadableStream> {
        <Self as BodyMixin>::get_body_readable_stream(self)
    }

    /// # Safety
    /// `this` is from [`Request::new`] and the caller owns its ref, which the wrapper adopts.
    pub(crate) unsafe fn to_js(this: *mut Self, global_object: &JSGlobalObject) -> JSValue {
        // SAFETY: fn contract.
        let request = unsafe { &*this };
        request.calculate_estimated_byte_size();
        let js_value = js::to_js(this, global_object);
        request.js_ref.set(JsRef::init_weak(js_value));

        request.check_body_stream_ref(global_object);
        js_value
    }
}

// C++ side defines `extern "C" SYSV_ABI` (JSBunRequest.cpp).
bun_jsc::jsc_abi_extern! {
    #[allow(improper_ctypes)]
    #[link_name = "Bun__JSRequest__createForBake"]
    // `&JSGlobalObject` discharges the only deref'd-param precondition;
    // `request_ptr` is stored opaquely as `void*`.
    safe fn Bun__JSRequest__createForBake(
        global_object: &JSGlobalObject,
        request_ptr: *mut Request,
    ) -> JSValue;
}

impl Request {
    /// The wrapper adopts the ref of `this`, which is from [`Request::new`].
    pub(crate) fn to_js_for_bake(
        this: *mut Self,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_object, || {
            Bun__JSRequest__createForBake(global_object, this)
        })
    }
}

unsafe extern "C" {
    #[link_name = "Bun__getParamsIfBunRequest"]
    safe fn Bun__getParamsIfBunRequest(this_value: JSValue) -> JSValue;
}

impl Request {
    pub(crate) fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        this_value: JSValue,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        // Return type narrowed to `core::fmt::Result` (matches
        // Response::write_format / Blob::write_format). Funnel JsError /
        // AllocError through `fmt::Error`.
        let js_err = |_: JsError| core::fmt::Error;

        let params_object = Bun__getParamsIfBunRequest(this_value);

        let class_label = if params_object.is_empty() {
            "Request"
        } else {
            "BunRequest"
        };
        match self.body_value_mut().known_size() {
            Some(size) => writeln!(
                writer,
                "{} ({}) {{",
                class_label,
                bun_fmt::size(size, Default::default())
            )?,
            None => writeln!(writer, "{} {{", class_label)?,
        }
        {
            // RAII guard restores indent on every exit incl. `?` error paths.
            // Shadows `formatter` for the block; auto-derefs to `&mut F`.
            let mut formatter = bun_jsc::IndentScope::new(&mut *formatter);

            formatter.write_indent(writer)?;
            writer.write_str(
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>method<d>:<r> \"").as_ref(),
            )?;

            // Wire-form token (e.g. "M-SEARCH"), not the Rust Debug variant identifier.
            write!(writer, "{}", bstr::BStr::new(self.method.as_bytes()))?;
            writer.write_str("\"")?;
            formatter
                .print_comma::<_, ENABLE_ANSI_COLORS>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            writer
                .write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>url<d>:<r> ").as_ref())?;
            self.ensure_url().map_err(|_| core::fmt::Error)?;
            write!(
                writer,
                "{}",
                format_args!(
                    "{}{}{}",
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("\"<b>"),
                    self.url.get(),
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>\""),
                )
            )?;
            formatter
                .print_comma::<_, ENABLE_ANSI_COLORS>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            if params_object.is_cell() {
                formatter.write_indent(writer)?;
                writer.write_str(
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>params<d>:<r> ").as_ref(),
                )?;
                formatter
                    .print_as::<_, ENABLE_ANSI_COLORS>(
                        bun_jsc::FormatTag::Private,
                        writer,
                        params_object,
                        bun_jsc::JSType::Object,
                    )
                    .map_err(js_err)?;
                formatter
                    .print_comma::<_, ENABLE_ANSI_COLORS>(writer)
                    .expect("unreachable");
                writer.write_str("\n")?;
            }

            formatter.write_indent(writer)?;
            writer.write_str(
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>headers<d>:<r> ").as_ref(),
            )?;
            let headers_js = self
                .ensure_fetch_headers(formatter.global_this())
                .map_err(js_err)?
                .to_js(formatter.global_this());
            formatter
                .print_as::<_, ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatTag::Private,
                    writer,
                    headers_js,
                    bun_jsc::JSType::DOMWrapper,
                )
                .map_err(js_err)?;

            match self.body_value_mut() {
                BodyValue::Blob(blob) => {
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    blob.write_format::<F, W, ENABLE_ANSI_COLORS>(&mut formatter, writer)?;
                }
                BodyValue::InternalBlob(_) | BodyValue::WTFStringImpl(_) => {
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    let size = self.body_value_mut().size();
                    if size == 0 {
                        let empty = Blob::init_empty(formatter.global_this());
                        empty.write_format::<F, W, ENABLE_ANSI_COLORS>(&mut formatter, writer)?;
                    } else {
                        crate::webcore::blob::write_format_for_size::<W, ENABLE_ANSI_COLORS>(
                            false,
                            size as usize,
                            writer,
                        )?;
                    }
                }
                BodyValue::Locked(_) => {
                    if let Some(stream) = self.get_body_readable_stream() {
                        writer.write_str("\n")?;
                        formatter.write_indent(writer)?;
                        formatter
                            .print_as::<_, ENABLE_ANSI_COLORS>(
                                bun_jsc::FormatTag::Object,
                                writer,
                                stream.value,
                                stream.value.js_type(),
                            )
                            .map_err(js_err)?;
                    }
                }
                _ => {}
            }
        }
        writer.write_str("\n")?;
        formatter.write_indent(writer)?;
        writer.write_str("}")?;
        Ok(())
    }

    pub(crate) fn get_cache(&self, cx: &mut JsScope<'_>) -> JSValue {
        fetch_cache_mode_to_js(self.flags.cache, cx.global())
    }

    pub(crate) fn get_credentials(&self, cx: &mut JsScope<'_>) -> JSValue {
        cx.global().common_strings().include()
    }

    pub(crate) fn get_destination(&self, cx: &mut JsScope<'_>) -> JSValue {
        JSValue::js_empty_string(cx.global())
    }

    pub(crate) fn get_integrity(&self, cx: &mut JsScope<'_>) -> JSValue {
        JSValue::js_empty_string(cx.global())
    }

    /// The `AbortSignal` this request was constructed with or lazily created
    /// for its `signal` getter, if any.
    pub(crate) fn abort_signal(&self) -> Option<&AbortSignalRef> {
        self.signal.get().as_ref()
    }

    pub(crate) fn get_signal(&self, cx: &mut JsScope<'_>) -> JSValue {
        let global_this = cx.global();
        // Already have a C++ instance
        if let Some(signal) = self.signal.get() {
            return signal.to_js(global_this);
        }
        // Lazy create default signal
        let js_signal = AbortSignal::create(global_this);
        js_signal.ensure_still_alive();
        if let Some(signal) = AbortSignal::ref_from_js(js_signal) {
            // `ref_from_js` already bumped the C++ refcount.
            self.signal.set(Some(signal));
        }
        js_signal
    }

    pub(crate) fn get_method(&self, cx: &mut JsScope<'_>) -> JSValue {
        match &self.method {
            OwnedMethod::Known(method) => method.to_js(cx.global()),
            OwnedMethod::Token(token) => bun_core::EncodedSlice::latin1(token).to_js(cx.global()),
        }
    }

    pub(crate) fn get_mode(&self, cx: &mut JsScope<'_>) -> JSValue {
        fetch_request_mode_to_js(self.flags.mode, cx.global())
    }

    pub(crate) fn finalize_without_deinit(&mut self) {
        // headers.deref() → HeadersRef::Drop when set to None
        self.headers.set(None);

        self.url.set(BunString::EMPTY);

        // AbortSignalRef::Drop unrefs the C++ handle.
        self.signal.set(None);
    }

    fn destroy(this: *mut Request) {
        // Release the request's `+1` on the body slot. `ManuallyDrop` so the
        // hot-path `Box::from_raw().drop()` below cannot re-run this.
        // SAFETY: `this` is live and this is the sole release point for `body`.
        unsafe { ManuallyDrop::drop(&mut (*this).body) };
        // SAFETY: ref_count hit 0; any remaining `WeakPtr` only touches `weak_ptr_data`, on this thread.
        if unsafe { (*this).weak_ptr_data.on_finalize() } {
            // Hot path: no outstanding weak refs. Reclaim and drop the whole
            // allocation in one shot — `Box::from_raw`'s drop runs
            // `drop_in_place` over every field (headers / url / signal /
            // js_ref) once, without the `Cell::set`
            // read-write-drop round-trips the old `finalize_without_deinit()`
            // call performed here before re-dropping the (now-empty) fields.
            // SAFETY: `this` is the live Box-allocated payload.
            drop(unsafe { Box::from_raw(this) });
        } else {
            // Cold path: weak_ptr_data still has outstanding refs — keep the
            // allocation alive, but release inner resources now so they aren't
            // pinned until the last `WeakPtr` drops.
            // SAFETY: as above.
            unsafe {
                (*this).js_ref.with_mut(|r| r.finalize());
                (*this).finalize_without_deinit();
            }
        }
    }

    pub(crate) fn get_redirect(&self, cx: &mut JsScope<'_>) -> JSValue {
        fetch_redirect_to_js(self.flags.redirect, cx.global())
    }

    pub(crate) fn get_referrer(&self, cx: &mut JsScope<'_>) -> JSValue {
        let global_object = cx.global();
        if let Some(headers_ref) = self.headers_mut().as_mut() {
            if let Some(referrer) = headers_ref.get(b"referrer", global_object) {
                return referrer.to_js(global_object);
            }
        }

        JSValue::js_empty_string(global_object)
    }

    pub(crate) fn get_referrer_policy(&self, cx: &mut JsScope<'_>) -> JSValue {
        JSValue::js_empty_string(cx.global())
    }

    pub(crate) fn get_url(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.ensure_url()?;
        self.url.get().to_js(cx.global())
    }

    pub(crate) fn size_of_url(&self) -> usize {
        let url = self.url.get();
        if url.length() > 0 {
            return url.byte_slice().len();
        }

        if let Some(req) = self.request_context.get_request() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST handle — safe deref.
            let req = bun_opaque::opaque_deref(req);
            let req_url = Self::request_target_path(req.url());
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req
                    .header(b"host")
                    .filter(|host| Self::is_valid_host_header(host))
                {
                    // With `port: None`, HostFormatter always emits exactly `host`, so the
                    // formatted byte-count is just `host.len()`. Avoid the `core::fmt::write`
                    // vtable dispatch that `bun_fmt::count(format_args!(...))` incurs — this
                    // runs once per request via JSC extra-memory accounting.
                    return self.get_protocol().len() + host.len() + req_url.len();
                }
            }
            return req_url.len();
        }

        0
    }

    pub(crate) fn get_protocol(&self) -> &'static [u8] {
        if self.flags.https {
            return b"https://";
        }

        b"http://"
    }

    fn request_target_path(target: &[u8]) -> Cow<'_, [u8]> {
        let scheme_len = if strings::has_prefix_case_insensitive(target, b"https://") {
            b"https://".len()
        } else if strings::has_prefix_case_insensitive(target, b"http://") {
            b"http://".len()
        } else {
            return Cow::Borrowed(target);
        };

        let path_start = strings::index_of_char_pos(target, b'/', scheme_len);
        let query_start = strings::index_of_char_pos(target, b'?', scheme_len);
        match (path_start, query_start) {
            (Some(path_start), None) => Cow::Borrowed(&target[path_start..]),
            (Some(path_start), Some(query_start)) if path_start < query_start => {
                Cow::Borrowed(&target[path_start..])
            }
            (_, Some(query_start)) => {
                let mut path = Vec::with_capacity(1 + target.len() - query_start);
                path.push(b'/');
                path.extend_from_slice(&target[query_start..]);
                Cow::Owned(path)
            }
            _ => Cow::Borrowed(b"/"),
        }
    }

    /// RFC 3986 3.2.2 `uri-host [ ":" port ]` byte set. A Host value outside it, or an empty
    /// one, cannot form a URL authority, so `request.url` synthesis falls back to the
    /// configured host instead of pasting the client bytes into the URL.
    pub(crate) fn is_valid_host_header(host: &[u8]) -> bool {
        !host.is_empty()
            && host.iter().all(|&c| {
                c.is_ascii_alphanumeric()
                    || matches!(
                        c,
                        b'-' | b'.'
                            | b'_'
                            | b'~'
                            | b'%'
                            | b'!'
                            | b'$'
                            | b'&'
                            | b'\''
                            | b'('
                            | b')'
                            | b'*'
                            | b'+'
                            | b','
                            | b';'
                            | b'='
                            | b':'
                            | b'['
                            | b']'
                    )
            })
    }

    pub(crate) fn ensure_url(&self) -> Result<(), AllocError> {
        if !self.url.get().is_empty() {
            return Ok(());
        }

        if let Some(req) = self.request_context.get_request() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST handle — safe deref.
            let req = bun_opaque::opaque_deref(req);
            let req_url = Self::request_target_path(req.url());
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req
                    .header(b"host")
                    .filter(|host| Self::is_valid_host_header(host))
                {
                    // With `port: None`, HostFormatter always emits exactly `host`. Compute the
                    // length and assemble the URL with straight slice copies instead of going
                    // through `core::fmt::write` (which is not monomorphized and shows up in
                    // per-request profiles).
                    let protocol = self.get_protocol();
                    let url_bytelength = protocol.len() + host.len() + req_url.len();

                    debug_assert!(self.size_of_url() == url_bytelength);

                    if url_bytelength < 128 {
                        let mut buffer = [0u8; 128];
                        let url = {
                            let mut at = 0;
                            buffer[at..at + protocol.len()].copy_from_slice(protocol);
                            at += protocol.len();
                            buffer[at..at + host.len()].copy_from_slice(host);
                            at += host.len();
                            buffer[at..at + req_url.len()].copy_from_slice(&req_url);
                            at += req_url.len();
                            &buffer[..at]
                        };

                        debug_assert!(self.size_of_url() == url.len());

                        let href = bun_url::href_from_string(&StringView::from_bytes(url));
                        if !href.is_empty() {
                            if core::ptr::eq(href.byte_slice().as_ptr(), url.as_ptr()) {
                                self.url.set(BunString::clone_latin1(&url[..href.length()]));
                            } else {
                                self.url.set(href);
                            }
                        } else {
                            // TODO: what is the right thing to do for invalid URLS?
                            self.url.set(BunString::clone_utf8(url));
                        }

                        return Ok(());
                    }

                    if strings::is_all_ascii(host) && strings::is_all_ascii(&req_url) {
                        let (new_url, bytes) =
                            BunString::create_uninitialized_latin1(url_bytelength);
                        self.url.set(new_url);
                        // exact space was counted above
                        let (a, rest) = bytes.split_at_mut(protocol.len());
                        let (b, c) = rest.split_at_mut(host.len());
                        a.copy_from_slice(protocol);
                        b.copy_from_slice(host);
                        c.copy_from_slice(&req_url);
                    } else {
                        // slow path
                        let mut temp_url: Vec<u8> = Vec::with_capacity(url_bytelength);
                        temp_url.extend_from_slice(protocol);
                        temp_url.extend_from_slice(host);
                        temp_url.extend_from_slice(&req_url);
                        // `defer bun.default_allocator.free(temp_url)` → Vec drops at scope end
                        self.url.set(BunString::clone_utf8(&temp_url));
                    }

                    let href = bun_url::href_from_string(self.url.get());
                    // TODO: what is the right thing to do for invalid URLS?
                    if !href.is_empty() {
                        self.url.set(href);
                    }

                    return Ok(());
                }
            }

            debug_assert!(self.size_of_url() == req_url.len());
            self.url.set(BunString::clone_utf8(&req_url));
        }
        Ok(())
    }
}

/// A Request or Response that nothing has tampered with is copied from its fields, not through its getters.
pub(crate) enum Pristine<'a> {
    Request(&'a Request),
    Response(&'a Response),
    No,
}

impl Pristine<'_> {
    /// `value` is an object.
    pub(crate) fn of(value: JSValue) -> Self {
        if value.js_type() == bun_jsc::JSType::DOMWrapper {
            if let Some(request) = value.as_direct::<Request>() {
                // SAFETY: the live payload of the wrapper, which the caller's argument keeps alive.
                return Self::Request(unsafe { &*request });
            }
            if let Some(response) = value.as_direct::<Response>() {
                // SAFETY: as above.
                return Self::Response(unsafe { &*response });
            }
        }
        Self::No
    }
}

/// Returns a copy of the body, or `None` if there is none left to copy.
fn copy_body<T: BodyMixin>(owner: &T, cx: &bun_jsc::JsThread<'_>) -> JsResult<Option<BodyValue>> {
    match owner.get_body_value() {
        BodyValue::Null | BodyValue::Used => Ok(None),
        _ => owner.clone_body_value_via_cached_stream(cx).map(Some),
    }
}

impl Request {
    #[inline]
    fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::check_body_stream_ref(self, global_object)
    }

    /// A Request that script made. Nothing here can fail, so a caller's `?` never leaves a body slot behind.
    fn from_members(
        url: BunString,
        method: OwnedMethod,
        headers: Option<HeadersRef>,
        signal: Option<AbortSignalRef>,
        body: BodyValue,
        flags: Flags,
    ) -> Request {
        Request {
            url: JsCell::new(url),
            headers: JsCell::new(headers),
            signal: JsCell::new(signal),
            body: ManuallyDrop::new(body::hive_alloc(body)),
            js_ref: JsCell::new(JsRef::empty()),
            method,
            flags,
            request_context: AnyRequestContext::NULL,
            ref_count: Cell::new(1),
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
        }
    }

    fn construct_into(
        cx: &bun_jsc::JsThread<'_>,
        input: JSValue,
        init: JSValue,
    ) -> JsResult<Request> {
        let global = cx.global();
        if !input.is_cell() {
            return Err(global.throw_type_error(format_args!(
                "Failed to construct 'Request': expected non-empty string or object, got {}",
                if input.is_null() {
                    "null"
                } else if input.is_number() {
                    "number"
                } else if input.is_boolean() {
                    "boolean"
                } else {
                    "undefined"
                }
            )));
        }

        let input_type = input.js_type();
        let mut url = BunString::EMPTY;
        let input = if input_type.is_string_like()
            || bun_jsc::DOMURL::cast_(input, global.vm()).is_some()
        {
            url = BunString::from_js(input, global)?;
            None
        } else if input_type.is_object() {
            Some(input)
        } else {
            return Err(global.throw_type_error(format_args!(
                "Failed to construct 'Request': expected non-empty string or object"
            )));
        };
        let init = init.is_object().then_some(init);

        if let (Some(only), None) | (None, Some(only)) = (init, input)
            && let Pristine::Request(request) = Pristine::of(only)
        {
            return request.cloned(cx, (!url.is_empty()).then_some(url));
        }

        // `new Request()` also copies a Request that is `init`, so the readers below tell the kinds of object apart.
        let sources = InitSources {
            init,
            request: None,
            object: input,
        };

        let body = sources.object_member(|object| {
            let copy = match Pristine::of(object) {
                Pristine::Request(request) => copy_body(request, cx)?,
                Pristine::Response(response) => copy_body(response, cx)?,
                Pristine::No => None,
            };
            if copy.is_some() {
                return Ok(copy);
            }
            let Some(value) = object.fast_get(global, bun_jsc::BuiltinName::Body)? else {
                return Ok(None);
            };
            // The spec throws before it extracts the body. "keepalive" is Node's message.
            if ReadableStream::is_readable_stream(value)
                && let Some(keepalive) = object.get(global, "keepalive")?
                && keepalive.to_boolean()
            {
                return Err(global.throw_type_error(format_args!("keepalive")));
            }
            BodyValue::from_js(global, value).map(Some)
        })?;

        if url.is_empty() {
            let member = sources.object_member(|object| {
                if let Pristine::Response(response) = Pristine::of(object)
                    && !response.url().is_empty()
                {
                    return Ok(Some(response.url().clone()));
                }
                let url = match object.fast_get(global, bun_jsc::BuiltinName::Url)? {
                    Some(value) => BunString::from_js(value, global)?,
                    // Only `input` is converted to a string.
                    None if Some(object) == input && object.implements_to_string(global)? => {
                        BunString::from_js(object, global)?
                    }
                    None => return Ok(None),
                };
                Ok((!url.is_empty()).then_some(url))
            })?;
            if let Some(member) = member {
                url = member;
            }
        }

        let signal = sources.object_member(|object| {
            request_init::signal_member(global, object, || {
                global.throw_type_error(format_args!(
                    "Failed to construct 'Request': signal is not of type AbortSignal."
                ))
            })
        })?;

        let headers = sources.object_member(|object| match Pristine::of(object) {
            Pristine::Request(request) => request.clone_headers(global),
            Pristine::Response(response) => response.clone_init_headers(global),
            Pristine::No => match object.fast_get(global, bun_jsc::BuiltinName::Headers)? {
                Some(value) => HeadersRef::from_init_value(global, value),
                None => Ok(None),
            },
        })?;

        let method = sources.object_member(|object| match Pristine::of(object) {
            Pristine::Request(request) => Ok(Some(request.method.clone())),
            // A Response has no `method` property, so as `init` it can't set one.
            Pristine::Response(response) => {
                Ok((Some(object) == input).then(|| response.get_method().into()))
            }
            Pristine::No => match object.fast_get(global, bun_jsc::BuiltinName::Method)? {
                Some(value) => method_jsc::request_method_from_js(global, value).map(Some),
                None => Ok(None),
            },
        })?;

        let mut flags = Flags::default();
        if let Some(redirect) = sources.object_member(|object| match Pristine::of(object) {
            Pristine::Request(request) => Ok(Some(request.flags.redirect)),
            _ => object.get_optional_enum::<FetchRedirect>(global, "redirect"),
        })? {
            flags.redirect = redirect;
        }
        if let Some(cache) = sources.object_member(|object| match Pristine::of(object) {
            Pristine::Request(request) => Ok(Some(request.flags.cache)),
            _ => object.get_optional_enum::<FetchCacheMode>(global, "cache"),
        })? {
            flags.cache = cache;
        }
        if let Some(mode) = sources.object_member(|object| match Pristine::of(object) {
            Pristine::Request(request) => Ok(Some(request.flags.mode)),
            _ => object.get_optional_enum::<FetchRequestMode>(global, "mode"),
        })? {
            flags.mode = mode;
        }

        if url.is_empty() {
            return Err(global.throw_type_error(format_args!(
                "Failed to construct 'Request': url is required."
            )));
        }
        let href = bun_url::href_from_string(&url);
        if href.is_empty() {
            let err = global.err_invalid_url(format_args!(
                "Failed to construct 'Request': Invalid URL \"{url}\""
            ));
            return Err(global.throw_value(err));
        }

        let body = body.unwrap_or(BodyValue::Null);
        let mut headers = headers;
        if let Some(headers) = &mut headers {
            body.put_content_type_default(headers, global)?;
        }

        let req = Self::from_members(
            href,
            method.unwrap_or_else(|| Method::GET.into()),
            headers,
            signal.flatten(),
            body,
            flags,
        );
        req.calculate_estimated_byte_size();
        Ok(req)
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        input: JsLocal<'a>,
        init: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let request = Self::construct_into(&cx.js_thread(), input.to_js(), init.to_js())?;
        let request = RefPtr::new(request);
        let this = request.this_ptr();
        let this_value = structure.create(&cx.heap, request);
        this.js_ref.set(JsRef::init_weak(this_value.to_js()));
        this.check_body_stream_ref(cx.global());
        Ok(this_value)
    }

    pub(crate) fn do_clone(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global_this = cx.global();
        self.throw_if_body_unusable(global_this)?;
        let cloned_ptr = self.clone(&cx)?;
        // SAFETY: `clone` just allocated it; the wrapper adopts its ref in `to_js`.
        let js_wrapper = unsafe { Request::to_js(cloned_ptr, global_this) };
        self.sync_cloned_body_stream_caches(this_value.to_js(), js_wrapper, global_this);
        Ok(js_wrapper)
    }

    /// A copy with its own headers and body, at `url` if there is one.
    fn cloned(&self, cx: &bun_jsc::JsThread<'_>, url: Option<BunString>) -> JsResult<Request> {
        let _ = self.ensure_url();
        let body = self.clone_body_value_via_cached_stream(cx)?;
        let headers = self.clone_headers(cx.global())?;
        Ok(Self::from_members(
            url.unwrap_or_else(|| self.url.get().clone()),
            self.method.clone(),
            headers,
            self.signal.get().clone(),
            body,
            self.flags,
        ))
    }

    pub(crate) fn clone(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<*mut Request> {
        Ok(Request::new(self.cloned(cx, None)?))
    }
}

impl Request {
    pub(crate) fn init(
        method: Method,
        request_context: AnyRequestContext,
        https: bool,
        signal: Option<AbortSignalRef>,
        body: BodyHiveHandle,
    ) -> Request {
        Request {
            url: JsCell::new(BunString::EMPTY),
            headers: JsCell::new(None),
            signal: JsCell::new(signal),
            body: ManuallyDrop::new(body),
            js_ref: JsCell::new(JsRef::empty()),
            method: method.into(),
            flags: Flags {
                https,
                ..Flags::default()
            },
            request_context,
            ref_count: Cell::new(1),
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
        }
    }
}
