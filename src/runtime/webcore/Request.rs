//! https://developer.mozilla.org/en-US/docs/Web/API/Request

use core::cell::Cell;
use core::ffi::c_uint;
use core::ptr::NonNull;
use std::borrow::Cow;

use bun_jsc::JsCell;
use enumset::EnumSet;

use super::response::HeadersRef;
use crate::api::AnyRequestContext;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::ZigStringBlobExt as _;
use crate::webcore::body::{self, BodyHiveHandle, BodyMixin, Value as BodyValue};
use crate::webcore::jsc::{
    self as jsc, CallFrame, HTTPHeaderName, JSGlobalObject, JSValue, JsError, JsRef, JsResult,
};
use crate::webcore::{AbortSignal, Blob, CookieMap, FetchHeaders, ReadableStream, Response};
use bun_alloc::AllocError;
use bun_core::{Output, fmt as bun_fmt};
use bun_core::{OwnedStringCell, String as BunString, ZigString, strings};
use bun_http_jsc::fetch_enums_jsc::{
    fetch_cache_mode_to_js, fetch_redirect_to_js, fetch_request_mode_to_js,
};
use bun_http_jsc::method_jsc::MethodJsc as _;
use bun_http_types::FetchCacheMode::FetchCacheMode;
use bun_http_types::FetchRedirect::FetchRedirect;
use bun_http_types::FetchRequestMode::FetchRequestMode;
use bun_http_types::Method::Method;
use bun_jsc::AbortSignalRef;
use bun_jsc::StringJsc as _;
use bun_jsc::generated::JSRequest as js_gen;
use bun_ptr::weak_ptr::WeakPtrData;
use bun_uws as uws;
use core::mem::ManuallyDrop;

impl bun_ptr::weak_ptr::HasWeakPtrData for Request {
    unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData {
        // SAFETY: caller guarantees `this` points to a live (possibly-finalized) allocation.
        unsafe { core::ptr::addr_of_mut!((*this).weak_ptr_data) }
    }
}
pub(crate) type WeakRef = bun_ptr::WeakPtr<Request>;

// Hand-rolled `JsClass` impl (proc-macro `#[bun_jsc::JsClass]`
// not yet wired for Request). Routes through the codegen'd
// `crate::generated_classes::js_Request` wrappers — no local extern decls.
const _: () = {
    use crate::generated_classes::js_Request as js;

    impl bun_jsc::JsClass for Request {
        fn from_js(value: bun_jsc::JSValue) -> Option<*mut Self> {
            js::from_js(value).map(|p| p.as_ptr())
        }
        fn from_js_direct(value: bun_jsc::JSValue) -> Option<*mut Self> {
            js::from_js_direct(value).map(|p| p.as_ptr())
        }
        fn to_js(self, global: &bun_jsc::JSGlobalObject) -> bun_jsc::JSValue {
            // Route through the inherent `Request::to_js` so generic
            // `<T: JsClass>::to_js` callers also run `calculate_estimated_byte_size`,
            // `js_ref = .init_weak(...)`, and `check_body_stream_ref` —
            // otherwise the wrapper reports size 0 and any Locked-body
            // ReadableStream is never migrated into the GC slot.
            let ptr = bun_core::heap::into_raw(Box::new(self));
            // SAFETY: `ptr` is a freshly-leaked heap allocation; the inherent
            // `to_js` hands it to the C++ wrapper which takes ownership (freed
            // via `RequestClass__finalize`). Same pattern as `do_clone`.
            unsafe { Request::to_js(&*ptr, global) }
        }
        fn get_constructor(global: &bun_jsc::JSGlobalObject) -> bun_jsc::JSValue {
            js::get_constructor(global)
        }
    }
};

/// R-2 (`sharedThis`): every JS-facing host-fn takes `&Request` (not
/// `&mut Request`) so re-entrant JS calls cannot stack two `&mut` to the same
/// instance. Fields mutated by host-fns are wrapped in `Cell` (Copy scalars)
/// or `JsCell` (Drop types). Both are `#[repr(transparent)]`, so `#[repr(C)]`
/// field layout is unchanged. `method`/`flags`/`request_context`/`body`/
/// `weak_ptr_data` are only written during construction or via raw-ptr
/// `finalize`, so stay plain.
#[repr(C)]
pub struct Request {
    pub url: bun_core::OwnedStringCell,

    /// Subresource integrity metadata. Empty means the default (no integrity).
    pub integrity: bun_core::OwnedStringCell,
    /// Referrer state (Fetch spec):
    /// - empty → "client" (default); getter returns "about:client"
    /// - equal to `NO_REFERRER_SENTINEL` → getter returns ""
    /// - otherwise → the serialized URL; getter returns it as-is
    pub referrer: bun_core::OwnedStringCell,

    headers: JsCell<Option<HeadersRef>>,
    // AbortSignal is an opaque C++ handle with intrusive WebCore refcounting —
    // `Arc` of an opaque ZST is meaningless (its payload address is not the
    // C++ object). `AbortSignalRef` wraps `NonNull<AbortSignal>` and routes
    // Clone/Drop to the C++ ref/unref.
    pub signal: JsCell<Option<AbortSignalRef>>,
    /// Owning `+1` handle into the per-VM `Body::Value` hive pool. The
    /// `Request` and (when served by `Bun.serve`) the `RequestContext` each
    /// hold their own `+1` on the same slot. `ManuallyDrop` because
    /// `finalize()` decouples from `Box` and must release this handle exactly
    /// once before `Box::from_raw().drop()` (which would otherwise re-run it).
    body: ManuallyDrop<BodyHiveHandle>,
    js_ref: JsCell<JsRef>,
    pub method: Method,
    pub flags: Flags,
    pub request_context: AnyRequestContext,
    pub weak_ptr_data: WeakPtrData,
    // We must report a consistent value for this
    pub reported_estimated_size: Cell<usize>,
    pub internal_event_callback: JsCell<InternalJSEventCallback>,
}

// A `#[repr(C)]` struct for direct
// field access — `Request` is only ever passed to C++ by **pointer** with size
// reported via the codegen'd `Request__ZigStructSize`, so the absolute size is
// not ABI-locked. `#[repr(C)]` + `assert_ffi_layout!` make the layout
// deterministic and grep-discoverable.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Flags {
    pub redirect: FetchRedirect,
    pub cache: FetchCacheMode,
    pub mode: FetchRequestMode,
    pub https: bool,
    pub keepalive: bool,
}

bun_core::assert_ffi_layout!(Flags, 5, 1; redirect @ 0, cache @ 1, mode @ 2, https @ 3, keepalive @ 4);

impl Default for Flags {
    fn default() -> Self {
        Self {
            redirect: FetchRedirect::Follow,
            cache: FetchCacheMode::Default,
            mode: FetchRequestMode::Cors,
            https: false,
            keepalive: false,
        }
    }
}

/// Sentinel value for `referrer` meaning "no-referrer" (the Fetch spec's
/// request referrer state distinct from "client"). When `referrer` is set to
/// this, the getter returns "" per spec. Static: no allocation, deref is a
/// no-op.
const NO_REFERRER_SENTINEL: &[u8] = b"no-referrer";

// NOTE: toJS is overridden
pub use js_gen::from_js;
pub use js_gen::from_js_direct;

// Heap-allocates via Box::new (global mimalloc).
impl Request {
    #[inline]
    pub fn new(v: Request) -> Box<Request> {
        Box::new(v)
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
        js_gen::body_get_cached(this)
    }
    #[inline]
    fn body_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        js_gen::body_set_cached(this, global, value)
    }
    #[inline]
    fn stream_get_cached(this: JSValue) -> Option<JSValue> {
        js_gen::stream_get_cached(this)
    }
    #[inline]
    fn stream_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        js_gen::stream_set_cached(this, global, value)
    }
}

impl BodyMixin for Request {
    #[inline]
    fn get_body_value(&self) -> &mut BodyValue {
        Request::get_body_value(self)
    }
    #[inline]
    fn get_fetch_headers(&self) -> Option<core::ptr::NonNull<FetchHeaders>> {
        // Opaque C++ handle. Return the raw `*mut`
        // directly (via `HeadersRef::as_ptr`) so the provenance is mutable;
        // going through `as_deref()` would derive it from a `&FetchHeaders`
        // and make the later `as_mut()` UB under Stacked Borrows.
        self.headers.get().as_ref().map(|h| {
            core::ptr::NonNull::new(h.as_ptr())
                .expect("HeadersRef wraps a non-null *mut FetchHeaders")
        })
    }
    #[inline]
    fn get_form_data_encoding(
        &self,
    ) -> bun_jsc::JsResult<Option<Box<bun_core::form_data::AsyncFormData>>> {
        Request::get_form_data_encoding(self)
    }
}

// ─── header accessors & simple getters ──────────────────────────────────────
impl Request {
    /// Inherent shim; `impl BodyMixin for Request` supplies the real trait method.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn get_body_value(&self) -> &mut BodyValue {
        self.body_value_mut()
    }

    /// Immutable view of the body value.
    #[inline]
    pub(crate) fn body_value(&self) -> &BodyValue {
        &self.body
    }

    /// R-2: `&self` → `&mut` through the slot's raw pointer. The slot is shared
    /// with `RequestContext.request_body` but never `&mut`-borrowed concurrently
    /// (single-threaded event-loop sequencing). Keep the borrow short.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn body_value_mut(&self) -> &mut BodyValue {
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
    pub fn has_fetch_headers(&self) -> bool {
        self.headers.get().is_some()
    }

    /// Sets the headers of the request. This will take ownership of the headers.
    /// it will deref the previous headers if they exist.
    pub fn set_fetch_headers(&self, headers: Option<HeadersRef>) {
        // old_headers.deref() → handled by HeadersRef::Drop on assignment
        self.headers.set(headers);
    }

    /// Returns the headers of the request. If the headers are not already cached, it will create a new FetchHeaders object.
    /// If the headers are empty, it will look at request_context to get the headers.
    /// If the headers are empty and request_context is null, it will create an empty FetchHeaders object.
    #[allow(clippy::mut_from_ref)]
    pub fn ensure_fetch_headers(&self, global_this: &JSGlobalObject) -> JsResult<&mut HeadersRef> {
        if self.headers.get().is_some() {
            // headers is already set
            return Ok(self.headers_mut().as_mut().unwrap());
        }

        if let Some(req) = self.request_context.get_request() {
            // we have a request context, so we can get the headers from it
            self.headers.set(Some(HeadersRef::create_from_uws(
                req.cast::<core::ffi::c_void>(),
            )));
        } else {
            // we don't have a request context, so we need to create an empty headers object
            self.headers.set(Some(HeadersRef::create_empty()));
            // Snapshot the pointer first; it stays valid across the field borrow.
            let content_type: Option<*const [u8]> = match self.body_value() {
                BodyValue::Blob(blob) => {
                    Some(std::ptr::from_ref::<[u8]>(blob.content_type_slice()))
                }
                BodyValue::Locked(locked) => match locked.readable.get(global_this) {
                    Some(readable) => match readable.ptr {
                        crate::webcore::readable_stream::Source::Blob(blob) => {
                            // SAFETY: `Source::Blob` holds a live `*mut ByteBlobLoader`
                            // for as long as the readable stream exists; we only read
                            // its `content_type` slice and immediately copy below.
                            let ct: &[u8] = unsafe { (*blob).content_type.as_slice() };
                            Some(std::ptr::from_ref::<[u8]>(ct))
                        }
                        _ => None,
                    },
                    None => None,
                },
                _ => None,
            };

            if let Some(content_type_) = content_type {
                // SAFETY: the sources above are live for the duration of this
                // call; the bytes are copied into the header map below.
                let content_type_ = unsafe { &*content_type_ };
                if !content_type_.is_empty() {
                    self.headers_mut().as_mut().unwrap().put(
                        HTTPHeaderName::ContentType,
                        &BunString::ascii(content_type_),
                        global_this,
                    )?;
                }
            }
        }

        Ok(self.headers_mut().as_mut().unwrap())
    }

    #[allow(clippy::mut_from_ref)]
    pub fn get_fetch_headers_unless_empty(&self) -> Option<&mut HeadersRef> {
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
    pub fn get_headers(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(self.ensure_fetch_headers(global_this)?.to_js(global_this))
    }

    pub fn clone_headers(&self, global_this: &JSGlobalObject) -> JsResult<Option<HeadersRef>> {
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

    pub fn get_content_type(&self) -> JsResult<Option<bun_core::ZigStringSlice>> {
        if let Some(req) = self.request_context.get_request() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST handle — safe deref.
            let req = bun_opaque::opaque_deref(req);
            if let Some(value) = req.header(b"content-type") {
                return Ok(Some(bun_core::ZigStringSlice::from_utf8_never_free(value)));
            }
        }

        if let Some(headers) = self.headers_mut().as_mut() {
            if let Some(value) = headers.fast_get(HTTPHeaderName::ContentType) {
                return Ok(Some(value.to_slice()));
            }
        }

        if let BodyValue::Blob(blob) = self.body_value() {
            let ct = blob.content_type_slice();
            if !ct.is_empty() {
                return Ok(Some(bun_core::ZigStringSlice::from_utf8_never_free(ct)));
            }
        }

        Ok(None)
    }
}

impl Request {
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Request>()
            + self.request_context.memory_cost()
            + self.url.get().byte_slice().len()
            + self.integrity.get().byte_slice().len()
            + self.referrer.get().byte_slice().len()
            + self.body_value().memory_cost()
    }

    #[bun_uws::uws_callback(export = "Request__setCookiesOnRequestContext")]
    pub fn ffi_set_cookies_on_request_context(&self, cookie_map: Option<&CookieMap>) {
        self.request_context
            .set_cookies(cookie_map.map(|c| std::ptr::from_ref::<CookieMap>(c).cast_mut()));
    }

    /// C++ treats the returned pointer as borrowed for the request handler's lifetime.
    #[bun_uws::uws_callback(export = "Request__getUWSRequest", no_catch)]
    pub fn ffi_get_uws_request(&self) -> *mut uws::Request {
        self.request_context
            .get_request()
            .unwrap_or(core::ptr::null_mut())
    }

    #[bun_uws::uws_callback(export = "Request__setInternalEventCallback")]
    pub fn ffi_set_internal_event_callback(&self, callback: JSValue, global_this: &JSGlobalObject) {
        self.internal_event_callback
            .set(InternalJSEventCallback::init(callback, global_this));
        // we always have the abort event but we need to enable the timeout event as well in case of `node:http`.Server.setTimeout is set
        self.request_context.enable_timeout_events();
    }

    #[bun_uws::uws_callback(export = "Request__setTimeout")]
    pub fn ffi_set_timeout(&self, seconds: JSValue, global_this: &JSGlobalObject) {
        if !seconds.is_number() {
            let _ = global_this.throw(format_args!(
                "Failed to set timeout: The provided value is not of type 'number'."
            ));
            return;
        }

        // `JSValue.toU32` clamps via JS ToUint32 rules,
        // not signed wrap-then-reinterpret like `to_int32() as c_uint` would do.
        self.set_timeout(seconds.to_u32() as c_uint);
    }

    /// `BunRequest.prototype.clone` (the `Bun.serve` `routes:` subclass) goes
    /// through `JSBunRequest::clone` -> here, not through [`Self::do_clone`],
    /// so it needs the same fetch-spec step-1 usability check.
    #[bun_uws::uws_callback(export = "Request__clone")]
    pub fn ffi_clone(&self, global_this: &JSGlobalObject) -> Option<Box<Request>> {
        self.throw_if_body_unusable(global_this).ok()?;
        self.clone(global_this).ok()
    }

    /// `JSBunRequest::clone` tail: mirror [`Self::do_clone`]'s cache sync so a
    /// `routes:` handler that observed `.body` before cloning gets a fresh tee
    /// branch from the next `.body` read instead of the locked tee source.
    #[bun_uws::uws_callback(export = "Request__syncClonedBodyStreamCaches")]
    pub fn ffi_sync_cloned_body_stream_caches(
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

// NOTE: `EventType` and `impl InternalJSEventCallback` are defined once below
// (near the struct decl); the duplicate block that used to live here was
// removed to resolve E0034 ambiguity.

impl Request {
    /// TODO: do we need this?
    pub fn init2(
        url: BunString,
        headers: Option<HeadersRef>,
        body: BodyHiveHandle,
        method: Method,
    ) -> Request {
        Request {
            url: OwnedStringCell::new(url),
            integrity: OwnedStringCell::new(BunString::empty()),
            referrer: OwnedStringCell::new(BunString::empty()),
            headers: JsCell::new(headers),
            signal: JsCell::new(None),
            body: ManuallyDrop::new(body),
            js_ref: JsCell::new(JsRef::empty()),
            method,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
            internal_event_callback: JsCell::new(InternalJSEventCallback::default()),
        }
    }

    pub fn get_form_data_encoding(
        &self,
    ) -> JsResult<Option<Box<crate::webcore::form_data::AsyncFormData>>> {
        let Some(content_type_slice) = self.get_content_type()? else {
            return Ok(None);
        };
        let Some(encoding) = crate::webcore::form_data::Encoding::get(content_type_slice.slice())
        else {
            return Ok(None);
        };
        Ok(Some(crate::webcore::form_data::AsyncFormData::init(
            encoding,
        )))
    }

    pub fn estimated_size(&self) -> usize {
        self.reported_estimated_size.get()
    }

    #[bun_uws::uws_callback(export = "Bun__JSRequest__calculateEstimatedByteSize")]
    pub fn calculate_estimated_byte_size(&self) {
        self.reported_estimated_size.set(
            self.body_value().estimated_size()
                + self.size_of_url()
                + self.integrity.get().byte_slice().len()
                + self.referrer.get().byte_slice().len()
                + core::mem::size_of::<Request>(),
        );
    }
}

impl Request {
    #[inline]
    pub fn get_body_readable_stream(
        &self,
        global_object: &JSGlobalObject,
    ) -> Option<ReadableStream> {
        <Self as BodyMixin>::get_body_readable_stream(self, global_object)
    }

    pub fn to_js(&self, global_object: &JSGlobalObject) -> JSValue {
        self.calculate_estimated_byte_size();
        // R-2: `to_js_unchecked` stores `self` as the C++ `m_ctx` payload (an
        // opaque `void*` never deref'd as `&mut Request` on the C++ side), so
        // forming `*mut` from `&self` here is provenance-safe.
        let js_value = js_gen::to_js_unchecked(
            global_object,
            std::ptr::from_ref::<Request>(self).cast_mut().cast::<()>(),
        );
        self.js_ref.set(JsRef::init_weak(js_value));

        self.check_body_stream_ref(global_object);
        js_value
    }
}

// Request is opaque on the C++ side; see note on the JsClass extern block above.
// C++ side defines `extern "C" SYSV_ABI` (JSBunRequest.cpp).
bun_jsc::jsc_abi_extern! {
    #[allow(improper_ctypes)]
    #[link_name = "Bun__JSRequest__createForBake"]
    // `&JSGlobalObject` discharges the only deref'd-param precondition;
    // `request_ptr` is stored opaquely as `void* m_ctx` (module-private —
    // sole caller forwards `from_ref(self)`). Matches the `*__createObject`
    // precedent.
    safe fn Bun__JSRequest__createForBake(
        global_object: &JSGlobalObject,
        request_ptr: *mut Request,
    ) -> JSValue;
}

impl Request {
    pub fn to_js_for_bake(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_object, || {
            // C++ stores `self` as opaque `void* m_ctx`; see `to_js` note.
            Bun__JSRequest__createForBake(
                global_object,
                std::ptr::from_ref::<Request>(self).cast_mut(),
            )
        })
    }
}

unsafe extern "C" {
    #[link_name = "Bun__getParamsIfBunRequest"]
    safe fn Bun__getParamsIfBunRequest(this_value: JSValue) -> JSValue;
}

impl Request {
    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
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
        writeln!(
            writer,
            "{} ({}) {{",
            class_label,
            bun_fmt::size(self.body_value_mut().size() as usize, Default::default())
        )?;
        {
            // RAII guard restores indent on every exit incl. `?` error paths.
            // Shadows `formatter` for the block; auto-derefs to `&mut F`.
            let mut formatter = bun_jsc::IndentScope::new(&mut *formatter);

            formatter.write_indent(writer)?;
            writer.write_str(
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>method<d>:<r> \"").as_ref(),
            )?;

            // Wire-form token (e.g. "M-SEARCH"), not the Rust Debug variant identifier.
            writer.write_str(self.method.as_str())?;
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
            let headers_js = self.get_headers(formatter.global_this()).map_err(js_err)?;
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
                    if let Some(stream) = self.get_body_readable_stream(formatter.global_this()) {
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

    pub fn get_cache(&self, global_this: &JSGlobalObject) -> JSValue {
        fetch_cache_mode_to_js(self.flags.cache, global_this)
    }

    pub fn get_credentials(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        global_this.common_strings().include()
    }

    pub fn get_destination(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(b"").to_js(global_this)
    }

    pub fn get_integrity(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if self.integrity.get().is_empty() {
            return Ok(ZigString::EMPTY.to_js(global_this));
        }
        self.integrity.get().to_js(global_this)
    }

    pub fn get_keepalive(&self, _global_this: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.flags.keepalive)
    }

    pub fn get_signal(&self, global_this: &JSGlobalObject) -> JSValue {
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

    pub fn get_method(&self, global_this: &JSGlobalObject) -> JSValue {
        self.method.to_js(global_this)
    }

    pub fn get_mode(&self, global_this: &JSGlobalObject) -> JSValue {
        fetch_request_mode_to_js(self.flags.mode, global_this)
    }

    pub fn finalize_without_deinit(&mut self) {
        // headers.deref() → HeadersRef::Drop when set to None
        self.headers.set(None);

        self.url.set(BunString::empty());
        self.integrity.set(BunString::empty());
        self.referrer.set(BunString::empty());

        // AbortSignalRef::Drop unrefs the C++ handle.
        self.signal.set(None);
        // internal_event_callback.deinit() → Drop on Strong inside; explicit take to match timing
        self.internal_event_callback
            .set(InternalJSEventCallback::default());
    }

    pub fn finalize(self: Box<Self>) {
        // weak_ptr_data may have outstanding refs aliasing this allocation;
        // hand ownership back to the raw pointer FIRST so a panic in the work
        // below leaks instead of Box-drop UAF-ing those weak holders.
        let this = bun_core::heap::release(self);
        // Release the request's `+1` on the body slot. `ManuallyDrop` so the
        // hot-path `Box::from_raw().drop()` below cannot re-run this.
        // SAFETY: `this` is live and this is the sole release point for `body`.
        unsafe { ManuallyDrop::drop(&mut this.body) };
        if this.weak_ptr_data.on_finalize() {
            // Hot path: no outstanding weak refs. Reclaim and drop the whole
            // allocation in one shot — `Box::from_raw`'s drop runs
            // `drop_in_place` over every field (headers / url / signal /
            // js_ref / internal_event_callback) once, without the 4× `Cell::set`
            // read-write-drop round-trips the old `finalize_without_deinit()`
            // call performed here before re-dropping the (now-empty) fields.
            // SAFETY: `this` is the live Box-allocated payload.
            drop(unsafe { Box::from_raw(this) });
        } else {
            // Cold path: weak_ptr_data still has outstanding refs — keep the
            // allocation alive, but release inner resources now so they aren't
            // pinned until the last `WeakPtr` drops.
            this.js_ref.with_mut(|r| r.finalize());
            this.finalize_without_deinit();
        }
    }

    pub fn get_redirect(&self, global_this: &JSGlobalObject) -> JSValue {
        fetch_redirect_to_js(self.flags.redirect, global_this)
    }

    pub fn get_referrer(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // Fetch spec: the referrer getter returns
        //   "about:client" when the referrer state is "client" (our default / empty),
        //   ""             when the referrer state is "no-referrer",
        //   the serialized URL otherwise.
        let referrer = self.referrer.get();
        if referrer.is_empty() {
            return Ok(ZigString::init(b"about:client").to_js(global_object));
        }
        if referrer.eql_comptime(NO_REFERRER_SENTINEL) {
            return Ok(ZigString::EMPTY.to_js(global_object));
        }
        referrer.to_js(global_object)
    }

    pub fn get_referrer_policy(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(b"").to_js(global_this)
    }

    pub fn get_url(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.ensure_url()?;
        self.url.get().to_js(global_object)
    }

    pub fn size_of_url(&self) -> usize {
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

    pub fn get_protocol(&self) -> &'static [u8] {
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
    fn is_valid_host_header(host: &[u8]) -> bool {
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

    pub fn ensure_url(&self) -> Result<(), AllocError> {
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

                        let href = bun_url::href_from_string(&BunString::from_bytes(url));
                        if !href.is_empty() {
                            if core::ptr::eq(href.byte_slice().as_ptr(), url.as_ptr()) {
                                self.url.set(BunString::clone_latin1(&url[..href.length()]));
                                href.deref();
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

                    let href = bun_url::href_from_string(&self.url.get());
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

#[derive(enumset::EnumSetType)]
enum Fields {
    Method,
    Headers,
    Body,
    Referrer,
    // ReferrerPolicy,
    Mode,
    // Credentials,
    Redirect,
    Cache,
    Integrity,
    Keepalive,
    Signal,
    // Proxy,
    // Timeout,
    Url,
}

impl Request {
    #[inline]
    pub(crate) fn check_body_stream_ref(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::check_body_stream_ref(self, global_object)
    }

    pub fn construct_into(
        global_this: &JSGlobalObject,
        arguments: &[JSValue],
        this_value: JSValue,
    ) -> JsResult<Request> {
        let mut success = false;
        // SAFETY: bun_vm() yields the live per-thread VM singleton.
        let body = body::hive_alloc(BodyValue::Null);
        // Snapshot the seed slot pointer for the repoint check below; `body`
        // (the +1) is moved into `req.body` next.
        let body_seed_ptr = body.as_ptr();
        let mut req = Request {
            url: OwnedStringCell::new(BunString::empty()),
            integrity: OwnedStringCell::new(BunString::empty()),
            referrer: OwnedStringCell::new(BunString::empty()),
            headers: JsCell::new(None),
            signal: JsCell::new(None),
            body: ManuallyDrop::new(body),
            js_ref: JsCell::new(JsRef::init_weak(this_value)),
            method: Method::GET,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
            internal_event_callback: JsCell::new(InternalJSEventCallback::default()),
        };
        // A scopeguard cannot capture `&mut req` while the
        // fn body also uses it. Cleanup is invoked at each early-return site via `bail!`.
        let cleanup = |req: &mut Request,
                       body_seed_ptr: *mut crate::webcore::body::HiveRef,
                       success: bool| {
            // Snapshot before the `!success` drop — reading a `ManuallyDrop`
            // after `ManuallyDrop::drop()` is documented use-after-drop.
            let req_body_ptr = req.body.as_ptr();
            if !success {
                req.finalize_without_deinit();
                // SAFETY: `req.body` is live; this is the sole release on this path.
                unsafe { ManuallyDrop::drop(&mut req.body) };
            }
            if req_body_ptr != body_seed_ptr {
                // `clone_into` `ptr::write`-overwrote `req.body`, orphaning the
                // seed slot's +1. Recover and drop it.
                // SAFETY: `body_seed_ptr` is a live +1 leaked by the ptr::write.
                drop(unsafe { BodyHiveHandle::from_raw(body_seed_ptr) });
            }
        };

        macro_rules! bail {
            ($e:expr) => {{
                cleanup(&mut req, body_seed_ptr, success);
                return $e;
            }};
        }

        if arguments.is_empty() {
            bail!(Err(global_this.throw(format_args!(
                "Failed to construct 'Request': 1 argument required, but only 0 present."
            ))));
        } else if arguments[0].is_empty_or_undefined_or_null() || !arguments[0].is_cell() {
            bail!(Err(global_this.throw(format_args!(
                "Failed to construct 'Request': expected non-empty string or object, got undefined"
            ))));
        }

        let url_or_object = arguments[0];
        let url_or_object_type = url_or_object.js_type();
        let mut fields: EnumSet<Fields> = EnumSet::empty();

        let is_first_argument_a_url =
            // fastest path:
            url_or_object_type.is_string_like() ||
            // slower path:
            bun_jsc::DOMURL::cast_(url_or_object, global_this.vm()).is_some();

        if is_first_argument_a_url {
            let str = match BunString::from_js(arguments[0], global_this) {
                Ok(s) => s,
                Err(e) => bail!(Err(e)),
            };
            req.url.set(str);

            if !req.url.get().is_empty() {
                fields.insert(Fields::Url);
            }
        } else if !url_or_object_type.is_object() {
            bail!(Err(global_this.throw(format_args!(
                "Failed to construct 'Request': expected non-empty string or object"
            ))));
        }

        let values_to_try_: [JSValue; 2] = [
            if arguments.len() > 1 && arguments[1].is_object() {
                arguments[1]
            } else if is_first_argument_a_url {
                JSValue::UNDEFINED
            } else {
                url_or_object
            },
            if is_first_argument_a_url {
                JSValue::UNDEFINED
            } else {
                url_or_object
            },
        ];
        let values_to_try = &values_to_try_[0..((!is_first_argument_a_url) as usize
            + (arguments.len() > 1 && arguments[1].is_object()) as usize)];

        // Fetch spec step 12: if init is not empty (i.e. the WebIDL dictionary
        // conversion of init has any present member), request's referrer is
        // reset to "client" before init.referrer is consulted. When
        // values_to_try.len() == 2 the first value is the init object and the
        // second is the base Request; probe init for any recognized
        // RequestInit member with a non-undefined value and, if so, skip
        // inheriting referrer from the base.
        //
        // Probing is up-front rather than inferred from what the parsing loop
        // stores, because the spec's "is not empty" test keys on member
        // *presence* — including members we don't read (credentials,
        // referrerPolicy, duplex, window) and members filtered by our loop
        // (signal: null is dropped by get_truthy, but it IS a present WebIDL
        // member). Key list mirrors undici's webidl.converters.RequestInit.
        let init_has_key: bool = 'probe: {
            if values_to_try.len() != 2 {
                break 'probe false;
            }
            // len == 2 guarantees values_to_try[0] == arguments[1] and that it
            // is an object (both are preconditions of the slice length above).
            let init_obj = values_to_try[0];
            const KEYS: [&[u8]; 14] = [
                b"method",
                b"headers",
                b"body",
                b"referrer",
                b"referrerPolicy",
                b"mode",
                b"credentials",
                b"cache",
                b"redirect",
                b"integrity",
                b"keepalive",
                b"signal",
                b"duplex",
                b"window",
            ];
            let mut found = false;
            for key in KEYS {
                // `get` returns None for missing OR undefined; any Some means
                // the member is present (including null/false/0/""), which
                // WebIDL treats as present.
                match init_obj.get(global_this, key) {
                    Ok(Some(_)) => {
                        found = true;
                        break;
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }
            }
            found
        };

        for (iter_idx, &value) in values_to_try.iter().enumerate() {
            let value_type = value.js_type();
            let explicit_check = values_to_try.len() == 2
                && value_type == bun_jsc::JSType::FinalObject
                && values_to_try[1].js_type() == bun_jsc::JSType::DOMWrapper;
            if value_type == bun_jsc::JSType::DOMWrapper {
                if let Some(request) = value.as_direct::<Request>() {
                    // SAFETY: as_direct returns a live *mut Request payload (m_ctx)
                    let request = unsafe { &*request };
                    if values_to_try.len() == 1 {
                        match Request::clone_into(
                            request,
                            &mut req,
                            global_this,
                            fields.contains(Fields::Url),
                        ) {
                            Ok(()) => {}
                            Err(e) => bail!(Err(e)),
                        }
                        success = true;
                        cleanup(&mut req, body_seed_ptr, success);
                        return Ok(req);
                    }

                    if !fields.contains(Fields::Method) {
                        req.method = request.method;
                        fields.insert(Fields::Method);
                    }

                    if !fields.contains(Fields::Redirect) {
                        req.flags.redirect = request.flags.redirect;
                        fields.insert(Fields::Redirect);
                    }

                    if !fields.contains(Fields::Cache) {
                        req.flags.cache = request.flags.cache;
                        fields.insert(Fields::Cache);
                    }

                    if !fields.contains(Fields::Mode) {
                        req.flags.mode = request.flags.mode;
                        fields.insert(Fields::Mode);
                    }

                    if !fields.contains(Fields::Keepalive) {
                        req.flags.keepalive = request.flags.keepalive;
                        fields.insert(Fields::Keepalive);
                    }

                    if !fields.contains(Fields::Integrity) {
                        if !request.integrity.get().is_empty() {
                            req.integrity.set(request.integrity.get().dupe_ref());
                        }
                        fields.insert(Fields::Integrity);
                    }

                    // Spec step 12: if init is not empty, referrer was already
                    // reset to "client" — do NOT inherit from the base Request.
                    // The gate only applies to the *base* iteration: when `init`
                    // is itself a Request (`new Request(base, other)`) this
                    // branch fires first with `request == other`, and there we
                    // DO want `other.referrer`. `base` is the last entry in
                    // values_to_try (len==2). `.referrer` is inserted
                    // unconditionally so the later generic pass skips this
                    // iteration's Request `referrer` getter.
                    if !fields.contains(Fields::Referrer) {
                        // Loop index, not JSValue identity: aliasing
                        // (`new Request(req, req)`) puts the same value in
                        // both slots, and identity would misclassify iter 0
                        // as the base iter.
                        let is_base_iter =
                            values_to_try.len() == 2 && iter_idx == values_to_try.len() - 1;
                        let skip_copy = is_base_iter && init_has_key;
                        if !skip_copy && !request.referrer.get().is_empty() {
                            req.referrer.set(request.referrer.get().dupe_ref());
                        }
                        fields.insert(Fields::Referrer);
                    }

                    if !fields.contains(Fields::Headers) {
                        match request.clone_headers(global_this) {
                            Ok(Some(headers)) => {
                                req.headers.set(Some(headers));
                                fields.insert(Fields::Headers);
                            }
                            Ok(None) => {}
                            Err(e) => bail!(Err(e)),
                        }

                        if global_this.has_exception() {
                            bail!(Err(JsError::Thrown));
                        }
                    }

                    if !fields.contains(Fields::Body) {
                        match request.body_value() {
                            BodyValue::Null | BodyValue::Empty | BodyValue::Used => {}
                            _ => {
                                match request.clone_body_value_via_cached_stream(global_this) {
                                    Ok(v) => {
                                        *req.body_value_mut() = v;
                                    }
                                    Err(e) => bail!(Err(e)),
                                }
                                fields.insert(Fields::Body);
                            }
                        }
                    }
                }

                if let Some(response) = value.as_direct::<Response>() {
                    // SAFETY: `as_direct` returned a live `*mut Response` owned by the JS wrapper.
                    let response = unsafe { &mut *response };
                    if !fields.contains(Fields::Method) {
                        req.method = response.get_method();
                        fields.insert(Fields::Method);
                    }

                    if !fields.contains(Fields::Headers) {
                        if let Some(headers) = response.get_init_headers_mut() {
                            // The flag is set unconditionally once `getInitHeaders()` yielded a
                            // value, even if `cloneThis` returns null — so a later arg can't
                            // repopulate headers from a different source.
                            match headers.clone_this(global_this) {
                                Ok(h) => {
                                    // SAFETY: clone_this returns a +1 ref FetchHeaders.
                                    req.headers.set(h.map(|p| unsafe { HeadersRef::adopt(p) }));
                                    fields.insert(Fields::Headers);
                                }
                                Err(e) => bail!(Err(e)),
                            }
                        }
                    }

                    if !fields.contains(Fields::Url) {
                        // `Response::url()` returns a bitwise `Copy` of the underlying
                        // `bun.String` (no ref bump),
                        // so take a +1 ref before storing — `req.url` is later released by
                        // `finalize_without_deinit` / the bail!-path `deref()`.
                        let url = response.url();
                        if !url.is_empty() {
                            req.url.set(url.dupe_ref());
                            fields.insert(Fields::Url);
                        }
                    }

                    if !fields.contains(Fields::Body) {
                        match response.get_body_value() {
                            BodyValue::Null | BodyValue::Empty | BodyValue::Used => {}
                            _ => {
                                match response.clone_body_value_via_cached_stream(global_this) {
                                    Ok(v) => {
                                        *req.body_value_mut() = v;
                                    }
                                    Err(e) => bail!(Err(e)),
                                }
                                fields.insert(Fields::Body);
                            }
                        }
                    }

                    if global_this.has_exception() {
                        bail!(Err(JsError::Thrown));
                    }
                }
            }

            if !fields.contains(Fields::Body) {
                match value.fast_get(global_this, bun_jsc::BuiltinName::Body) {
                    Ok(Some(body_)) => {
                        fields.insert(Fields::Body);
                        // fetch spec Request(init): `keepalive: true` with a ReadableStream
                        // body throws before body extraction (Node's message is "keepalive").
                        if crate::webcore::ReadableStream::is_readable_stream(body_) {
                            match value.get(global_this, "keepalive") {
                                Ok(Some(keepalive)) if keepalive.to_boolean() => {
                                    bail!(Err(
                                        global_this.throw_type_error(format_args!("keepalive"))
                                    ));
                                }
                                Ok(_) => {}
                                Err(e) => bail!(Err(e)),
                            }
                        }
                        match BodyValue::from_js(global_this, body_) {
                            Ok(v) => {
                                *req.body_value_mut() = v;
                            }
                            Err(e) => bail!(Err(e)),
                        }
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }

                if global_this.has_exception() {
                    bail!(Err(JsError::Thrown));
                }
            }

            if !fields.contains(Fields::Url) {
                match value.fast_get(global_this, bun_jsc::BuiltinName::Url) {
                    Ok(Some(url)) => {
                        match BunString::from_js(url, global_this) {
                            Ok(s) => req.url.set(s),
                            Err(e) => bail!(Err(e)),
                        }
                        if !req.url.get().is_empty() {
                            fields.insert(Fields::Url);
                        }

                        // first value
                    }
                    Ok(None) => {
                        // Short-circuit ordering: only probe
                        // `implementsToString` (which performs JS property
                        // lookup with observable side effects) when the first
                        // two guards already hold.
                        if value == values_to_try[values_to_try.len() - 1]
                            && !is_first_argument_a_url
                        {
                            let implements = match value.implements_to_string(global_this) {
                                Ok(b) => b,
                                Err(e) => bail!(Err(e)),
                            };
                            if implements {
                                let str = match BunString::from_js(value, global_this) {
                                    Ok(s) => s,
                                    Err(e) => bail!(Err(e)),
                                };
                                req.url.set(str);
                                if !req.url.get().is_empty() {
                                    fields.insert(Fields::Url);
                                }
                            }
                        }
                    }
                    Err(e) => bail!(Err(e)),
                }

                if global_this.has_exception() {
                    bail!(Err(JsError::Thrown));
                }
            }

            if !fields.contains(Fields::Signal) {
                // WebIDL `AbortSignal?`: present iff the member is not undefined.
                // `fast_get` maps absent/undefined → None; `null` is Some(null) and
                // means "present, detach" (no fallback to the input Request's signal).
                match value.fast_get(global_this, bun_jsc::BuiltinName::signal) {
                    Ok(Some(signal_)) => {
                        fields.insert(Fields::Signal);
                        if signal_.is_null() {
                            // explicit detach; leave `req.signal` as None
                        } else if let Some(signal) = AbortSignal::ref_from_js(signal_) {
                            // Keep it alive
                            signal_.ensure_still_alive();
                            // `ref_from_js` already ref'd.
                            req.signal.set(Some(signal));
                        } else {
                            if !global_this.has_exception() {
                                bail!(Err(global_this.throw_type_error(format_args!(
                                    "Failed to construct 'Request': signal is not of type AbortSignal."
                                ))));
                            }
                            bail!(Err(JsError::Thrown));
                        }
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }

                if global_this.has_exception() {
                    bail!(Err(JsError::Thrown));
                }
            }

            if !fields.contains(Fields::Method) || !fields.contains(Fields::Headers) {
                if global_this.has_exception() {
                    bail!(Err(JsError::Thrown));
                }
                match crate::webcore::response::Init::init(global_this, value) {
                    Ok(Some(response_init)) => {
                        let header_check = !explicit_check
                            || (explicit_check
                                && match value.fast_get(global_this, bun_jsc::BuiltinName::Headers)
                                {
                                    Ok(v) => v.is_some(),
                                    Err(e) => bail!(Err(e)),
                                });
                        if header_check {
                            if let Some(headers) = response_init.headers {
                                if !fields.contains(Fields::Headers) {
                                    req.headers.set(Some(headers));
                                    fields.insert(Fields::Headers);
                                } else {
                                    drop(headers); // headers.deref()
                                }
                            }
                        }

                        if global_this.has_exception() {
                            bail!(Err(JsError::Thrown));
                        }

                        let method_check = !explicit_check
                            || (explicit_check
                                && match value.fast_get(global_this, bun_jsc::BuiltinName::Method) {
                                    Ok(v) => v.is_some(),
                                    Err(e) => bail!(Err(e)),
                                });
                        if method_check {
                            if !fields.contains(Fields::Method) {
                                req.method = response_init.method;
                                fields.insert(Fields::Method);
                            }
                        }
                        if global_this.has_exception() {
                            bail!(Err(JsError::Thrown));
                        }
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }

                if global_this.has_exception() {
                    bail!(Err(JsError::Thrown));
                }
            }

            // Extract redirect option
            if !fields.contains(Fields::Redirect) {
                match value.get_optional_enum::<FetchRedirect>(global_this, "redirect") {
                    Ok(Some(redirect_value)) => {
                        req.flags.redirect = redirect_value;
                        fields.insert(Fields::Redirect);
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }
            }

            // Extract cache option
            if !fields.contains(Fields::Cache) {
                match value.get_optional_enum::<FetchCacheMode>(global_this, "cache") {
                    Ok(Some(cache_value)) => {
                        req.flags.cache = cache_value;
                        fields.insert(Fields::Cache);
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }
            }

            // Extract mode option
            if !fields.contains(Fields::Mode) {
                match value.get_optional_enum::<FetchRequestMode>(global_this, "mode") {
                    Ok(Some(mode_value)) => {
                        req.flags.mode = mode_value;
                        fields.insert(Fields::Mode);
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }
            }

            // Extract keepalive option (spec: `init["keepalive"] !== undefined`
            // then request.keepalive = Boolean(init.keepalive)). `get` already
            // collapses `undefined` into `None`, so the optional unwrap IS the
            // `!== undefined` check.
            if !fields.contains(Fields::Keepalive) {
                match value.get(global_this, "keepalive") {
                    Ok(Some(keepalive_value)) => {
                        req.flags.keepalive = keepalive_value.to_boolean();
                        fields.insert(Fields::Keepalive);
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }
            }

            // Extract integrity option (spec: `init["integrity"] !== undefined`
            // then request.integrity = String(init.integrity)). Compute the new
            // String before dropping the old one.
            if !fields.contains(Fields::Integrity) {
                match value.get(global_this, "integrity") {
                    Ok(Some(integrity_value)) => {
                        match BunString::from_js(integrity_value, global_this) {
                            Ok(s) => req.integrity.set(s),
                            Err(e) => bail!(Err(e)),
                        }
                        fields.insert(Fields::Integrity);
                    }
                    Ok(None) => {}
                    Err(e) => bail!(Err(e)),
                }
            }

            // Extract referrer option (spec: `init["referrer"] !== undefined`
            // then: "" → "no-referrer"; else parse as URL, failure throws
            // TypeError). Spec step 12: if init is non-empty, the base
            // Request's referrer must be reset to "client" — not leaked via
            // its `referrer` getter. The DOMWrapper branch above handles that
            // for direct Requests but falls through here when the base is a
            // Request subclass (asDirect returns null), so re-apply the gate.
            if !fields.contains(Fields::Referrer) {
                let is_base_iter = values_to_try.len() == 2 && iter_idx == values_to_try.len() - 1;
                if !(is_base_iter && init_has_key) {
                    match value.get(global_this, "referrer") {
                        Ok(Some(referrer_value)) => {
                            let referrer_str = match BunString::from_js(referrer_value, global_this)
                            {
                                Ok(s) => s,
                                Err(e) => bail!(Err(e)),
                            };
                            if referrer_str.is_empty() {
                                referrer_str.deref();
                                // Static: no allocation. Getter maps this
                                // sentinel to "".
                                req.referrer.set(BunString::static_(NO_REFERRER_SENTINEL));
                            } else {
                                let parsed = bun_url::href_from_string(&referrer_str);
                                referrer_str.deref();
                                if parsed.is_empty() {
                                    parsed.deref();
                                    bail!(Err(global_this.throw_type_error(format_args!(
                                        "Referrer is not a valid URL."
                                    ))));
                                }
                                req.referrer.set(parsed);
                            }
                            fields.insert(Fields::Referrer);
                        }
                        Ok(None) => {}
                        Err(e) => bail!(Err(e)),
                    }
                }
            }
        }

        if global_this.has_exception() {
            bail!(Err(JsError::Thrown));
        }

        if req.url.get().is_empty() {
            bail!(Err(global_this.throw(format_args!(
                "Failed to construct 'Request': url is required."
            ))));
        }

        let href = bun_url::href_from_string(&req.url.get());
        if href.is_empty() {
            if !global_this.has_exception() {
                // globalThis.throw can cause GC, which could cause the above string to be freed.
                // so we must increment the reference count before calling it.
                let err = global_this.err_invalid_url(format_args!(
                    "Failed to construct 'Request': Invalid URL \"{}\"",
                    req.url.get()
                ));
                bail!(Err(global_this.throw_value(err)));
            }
            bail!(Err(JsError::Thrown));
        }

        // hrefFromString increments the reference count if they end up being
        // the same
        //
        // we increment the reference count on usage above, so we must
        // decrement it to be perfectly balanced.

        req.url.set(href);

        if matches!(req.body_value(), BodyValue::Blob(_)) && req.headers.get().is_some() {
            if let BodyValue::Blob(blob) = req.body_value() {
                let ct: &[u8] = blob.content_type_slice();
                if !ct.is_empty()
                    && !req
                        .headers_mut()
                        .as_mut()
                        .unwrap()
                        .fast_has(HTTPHeaderName::ContentType)
                {
                    // Reshaped for borrowck — split borrow of req.body and req.headers
                    let ct_ptr: *const [u8] = ct;
                    match req.headers_mut().as_mut().unwrap().put(
                        HTTPHeaderName::ContentType,
                        // SAFETY: ct_ptr borrows req.body which is not mutated here.
                        &BunString::ascii(unsafe { &*ct_ptr }),
                        global_this,
                    ) {
                        Ok(()) => {}
                        Err(e) => bail!(Err(e)),
                    }
                }
            }
        }

        req.calculate_estimated_byte_size();
        req.check_body_stream_ref(global_this);
        success = true;

        cleanup(&mut req, body_seed_ptr, success);
        Ok(req)
    }

    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<Request>> {
        let arguments_ = callframe.arguments_old::<2>();
        let arguments = &arguments_.ptr[0..arguments_.len];

        let request = Self::construct_into(global_this, arguments, this_value)?;
        Ok(Request::new(request))
    }

    pub fn do_clone(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.throw_if_body_unusable(global_this)?;
        let this_value = callframe.this();
        let cloned = self.clone(global_this)?;

        let cloned_ptr = bun_core::heap::into_raw(cloned);
        // SAFETY: cloned_ptr was just created via heap::alloc above; toJS adopts ownership.
        let js_wrapper = unsafe { (*cloned_ptr).to_js(global_this) };
        self.sync_cloned_body_stream_caches(this_value, js_wrapper, global_this);
        Ok(js_wrapper)
    }

    pub fn clone_into(
        &self,
        req: &mut Request,
        global_this: &JSGlobalObject,
        preserve_url: bool,
    ) -> JsResult<()> {
        // allocator param dropped (global mimalloc)
        let _ = self.ensure_url();
        let body_ = self.clone_body_value_via_cached_stream(global_this)?;
        // BodyValue's Drop frees `body_` on the `?` error path
        let body = body::hive_alloc(body_);
        // Last fallible call. The url computation is sunk below it
        // so no guard is needed at all — `BunString` is
        // `Copy` with no `Drop`, so an early return here leaves `req.url`
        // untouched and still owned by the caller's `finalize_without_deinit`.
        // `body` (a `BodyHiveHandle`) drops on the `?` error path below,
        // releasing its +1.
        let headers = self.clone_headers(global_this)?;
        // `headers` is released automatically on the error path via its drop glue
        let url = if preserve_url {
            // Bitwise copy — the `ptr::write` below overwrites the old slot;
            // `BunString` has no `Drop`, so the stale `req.url` bits are discarded
            // and this copy becomes the sole live handle.
            req.url.get()
        } else {
            self.url.get().dupe_ref()
        };

        // `ptr::write` is a raw bit-overwrite — no destructors run on the old
        // `*req`, so Drop impls on `JsRef` / `strong::Optional` don't fire on
        // the caller's sentinel.
        // The old `req.body` hive ref is intentionally NOT unref'd here:
        // `clone()` seeds it with a dangling sentinel, and `construct_into`
        // releases its seed via the ptr-equality arm of its `cleanup`.
        // `url`/`integrity`/`referrer` are `OwnedStringCell`s holding either a
        // bitwise-copied handle (`url` under preserve_url) or the empty
        // sentinel both callers seed — so their skipped Drop is a no-op
        // (empty `deref()` is a no-op). Remaining incoming fields are
        // None/weak/Copy by contract.
        // SAFETY: `req` is a valid &mut, fully initialized by the caller;
        // nothing between here and the write can panic.
        unsafe {
            core::ptr::write(
                req,
                Request {
                    url: OwnedStringCell::new(url),
                    integrity: OwnedStringCell::new(self.integrity.get().dupe_ref()),
                    referrer: OwnedStringCell::new(self.referrer.get().dupe_ref()),
                    headers: JsCell::new(headers),
                    signal: JsCell::new(None),
                    body: ManuallyDrop::new(body),
                    js_ref: JsCell::new(JsRef::empty()),
                    method: self.method,
                    flags: self.flags,
                    request_context: AnyRequestContext::NULL,
                    weak_ptr_data: WeakPtrData::EMPTY,
                    reported_estimated_size: Cell::new(0),
                    internal_event_callback: JsCell::new(InternalJSEventCallback::default()),
                },
            );
        }

        if let Some(signal) = self.signal.get() {
            // `AbortSignalRef::clone` → C++ `ref()`.
            req.signal.set(Some(signal.clone()));
        }
        Ok(())
    }

    pub fn clone(&self, global_this: &JSGlobalObject) -> JsResult<Box<Request>> {
        // allocator param dropped (global mimalloc)
        // `clone_into` `ptr::write`s the new fields over the seed
        // without reading or dropping it.
        let mut req = Box::new(Request {
            url: OwnedStringCell::new(BunString::empty()),
            integrity: OwnedStringCell::new(BunString::empty()),
            referrer: OwnedStringCell::new(BunString::empty()),
            headers: JsCell::new(None),
            signal: JsCell::new(None),
            // `clone_into` `ptr::write`s the whole struct without dropping the
            // sentinel; seed with a non-deref'd dangling handle. `ManuallyDrop`
            // suppresses drop, so the `?` error path won't unref the dangling ptr.
            // SAFETY: never deref'd or dropped — overwritten by `clone_into`.
            body: ManuallyDrop::new(unsafe {
                BodyHiveHandle::from_raw(NonNull::dangling().as_ptr())
            }),
            js_ref: JsCell::new(JsRef::empty()),
            method: Method::GET,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
            internal_event_callback: JsCell::new(InternalJSEventCallback::default()),
        });
        // Box<Request> drops on the error path automatically
        self.clone_into(&mut req, global_this, false)?;
        Ok(req)
    }

    pub fn set_timeout(&self, seconds: c_uint) {
        let _ = self.request_context.set_timeout(seconds);
    }
}

#[derive(Default)]
pub struct InternalJSEventCallback {
    pub function: jsc::strong::Optional, // jsc.Strong.Optional → bun_jsc::Strong
}

/// Re-export of `NodeHTTPResponse.AbortEvent`.
pub type EventType = crate::server::node_http_response::AbortEvent;

impl InternalJSEventCallback {
    pub fn init(function: JSValue, global_this: &JSGlobalObject) -> InternalJSEventCallback {
        InternalJSEventCallback {
            function: jsc::strong::Optional::create(function, global_this),
        }
    }

    pub fn has_callback(&self) -> bool {
        self.function.has()
    }

    pub fn deinit(&mut self) {
        self.function.deinit();
    }

    pub fn trigger(&mut self, event_type: EventType, global_this: &JSGlobalObject) -> bool {
        if let Some(callback) = self.function.get() {
            let _ = callback
                .call(
                    global_this,
                    JSValue::UNDEFINED,
                    &[JSValue::js_number(event_type as i32 as f64)],
                )
                .map_err(|err| global_this.report_active_exception_as_unhandled(err));
            return true;
        }
        false
    }
}

impl Request {
    pub fn init(
        method: Method,
        request_context: AnyRequestContext,
        https: bool,
        signal: Option<AbortSignalRef>,
        body: BodyHiveHandle,
    ) -> Request {
        Request {
            url: OwnedStringCell::new(BunString::empty()),
            integrity: OwnedStringCell::new(BunString::empty()),
            referrer: OwnedStringCell::new(BunString::empty()),
            headers: JsCell::new(None),
            signal: JsCell::new(signal),
            body: ManuallyDrop::new(body),
            js_ref: JsCell::new(JsRef::empty()),
            method,
            flags: Flags {
                https,
                ..Flags::default()
            },
            request_context,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
            internal_event_callback: JsCell::new(InternalJSEventCallback::default()),
        }
    }
}
