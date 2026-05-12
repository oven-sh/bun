//! https://developer.mozilla.org/en-US/docs/Web/API/Request

use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;

use bun_jsc::JsCell;
use enumset::EnumSet;

use super::response::HeadersRef;
use crate::api::AnyRequestContext;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::ZigStringBlobExt as _;
use crate::webcore::body::{self, Body, BodyMixin, HiveRef as BodyHiveRef, Value as BodyValue};
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

// TODO(port): WeakRef = bun.ptr.WeakPtr(Request, "weak_ptr_data") — intrusive weak-ptr;
// keep raw *mut Request + embedded WeakPtrData. See PORTING.md §Pointers.
impl bun_ptr::weak_ptr::HasWeakPtrData for Request {
    unsafe fn weak_ptr_data(this: *mut Self) -> *mut WeakPtrData {
        // SAFETY: caller guarantees `this` points to a live (possibly-finalized) allocation.
        unsafe { core::ptr::addr_of_mut!((*this).weak_ptr_data) }
    }
}
pub type WeakRef = bun_ptr::WeakPtr<Request>;

// PORT NOTE: hand-rolled `JsClass` impl (proc-macro `#[bun_jsc::JsClass]`
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
            // Route through the inherent `Request::to_js` so the Zig override
            // semantics (Request.zig:229-236) are preserved for generic
            // `<T: JsClass>::to_js` callers too: `calculate_estimated_byte_size`,
            // `js_ref = .init_weak(...)`, and `check_body_stream_ref` must all
            // run, otherwise the wrapper reports size 0 and any Locked-body
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

    headers: JsCell<Option<HeadersRef>>,
    // PORT NOTE: Zig `?*AbortSignal` with manual `ref()`/`unref()`. AbortSignal
    // is an opaque C++ handle with intrusive WebCore refcounting — `Arc` of an
    // opaque ZST is meaningless (its payload address is not the C++ object).
    // `AbortSignalRef` wraps `NonNull<AbortSignal>` and routes Clone/Drop to
    // the C++ ref/unref.
    pub signal: JsCell<Option<AbortSignalRef>>,
    /// Intrusive ref into the per-VM `Body::Value::HiveAllocator` pool. The
    /// `Request` and (when served by `Bun.serve`) the `RequestContext` share
    /// the same slot — `RequestContext.request_body` aliases
    /// `&mut hive.value` — so streamed bytes buffered by the server surface
    /// on `req.body`/`req.json()` without a copy. `finalize()` releases this
    /// ref via `HiveRef::unref()`.
    body: NonNull<BodyHiveRef>,
    js_ref: JsCell<JsRef>,
    pub method: Method,
    pub flags: Flags,
    pub request_context: AnyRequestContext,
    pub weak_ptr_data: WeakPtrData,
    // We must report a consistent value for this
    pub reported_estimated_size: Cell<usize>,
    pub internal_event_callback: JsCell<InternalJSEventCallback>,
}

// PORT NOTE: Zig was `packed struct(u8)` (u2+u3+u2+bool = 8 bits). Fields are
// enums + 1 bool, so the canonical port would be `#[repr(transparent)]` u8 +
// shift accessors. Kept as a `#[repr(C)]` 4-byte struct to preserve direct
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

// NOTE: toJS is overridden
pub use js_gen::from_js;
pub use js_gen::from_js_direct;

// `pub const new = bun.TrivialNew(@This());` → Box::new (global mimalloc).
impl Request {
    #[inline]
    pub fn new(v: Request) -> Box<Request> {
        Box::new(v)
    }
}

// Wire the codegen'd cached `body`/`stream` JS slot accessors + weak `js_ref`
// so the [`BodyMixin`] twin defaults can run generically (Zig:
// `T.js.bodyGetCached` / `T.js.gc.stream.*` / `this.#js_ref.tryGet()`).
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
        // Zig: `?*FetchHeaders` — opaque C++ handle. Return the raw `*mut`
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

// ─── un-gated header accessors & simple getters ─────────────────────────────
impl Request {
    /// Zig: `pub fn getBodyValue(this: *Request) *Body.Value`.
    /// Inherent shim until the real `BodyMixin` (body::_jsc_gated) is un-gated
    /// and `impl BodyMixin for Request` supplies this as a trait method.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn get_body_value(&self) -> &mut BodyValue {
        self.body_value_mut()
    }

    /// Exclusive borrow of the pooled `HiveRef<BodyValue>` slot this request
    /// holds a `+1` ref on. **Single centralised `unsafe` deref** for the
    /// set-once `body: NonNull<BodyHiveRef>` field — [`body_value`],
    /// [`body_value_mut`], `finalize()` and the construct-cleanup path all
    /// route through here so the `NonNull::as_ptr()` deref is audited in one
    /// place.
    ///
    /// R-2: takes `&self` and projects `&mut` through the raw `NonNull`
    /// (the hive slot is a separate heap allocation; not covered by `&self`'s
    /// `noalias`). Single-JS-thread invariant — keep the borrow short.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn body_hive(&self) -> &mut BodyHiveRef {
        // SAFETY: `body` is a +1 ref into the VM-owned hive allocator; the
        // slot is live until `finalize()` (or the JS wrapper's GC finalizer)
        // calls `unref()`. `Request` is `!Sync` so no concurrent `&mut` exists.
        // The slot is a separate hive allocation (not `*self`), so the returned
        // `&mut` does not alias `&Request`. R-2: the aliasing
        // `RequestContext.request_body` pointer is only dereferenced while no
        // other `&mut BodyValue` is live (single-threaded event-loop sequencing).
        unsafe { &mut *self.body.as_ptr() }
    }

    /// Zig: `this.#body.value` (immutable view).
    #[inline]
    pub(crate) fn body_value(&self) -> &BodyValue {
        &self.body_hive().value
    }

    /// Zig: `&this.#body.value`. See [`body_hive`] for the R-2 invariant.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn body_value_mut(&self) -> &mut BodyValue {
        &mut self.body_hive().value
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
            // PORT NOTE: reshaped for borrowck — Zig read `blob.content_type`
            // through `self.body_value()` while holding `self.headers`. Snapshot the
            // pointer first; `Blob.content_type` is a raw `*const [u8]` that
            // stays valid across the field borrow.
            let content_type: Option<*const [u8]> = match self.body_value() {
                BodyValue::Blob(blob) => Some(blob.content_type.get()),
                BodyValue::Locked(locked) => match locked.readable.get(global_this) {
                    Some(readable) => match readable.ptr {
                        crate::webcore::readable_stream::Source::Blob(blob) => {
                            // SAFETY: `Source::Blob` holds a live `*mut ByteBlobLoader`
                            // for as long as the readable stream exists; we only read
                            // its `content_type` slice and immediately copy below.
                            let ct: &[u8] = unsafe { &(*blob).content_type };
                            Some(std::ptr::from_ref::<[u8]>(ct))
                        }
                        _ => None,
                    },
                    None => None,
                },
                _ => None,
            };

            if let Some(content_type_) = content_type {
                // SAFETY: Blob.content_type is always a valid (possibly empty)
                // slice pointer (see Blob field contract).
                let content_type_ = unsafe { &*content_type_ };
                if !content_type_.is_empty() {
                    self.headers_mut().as_mut().unwrap().put(
                        HTTPHeaderName::ContentType,
                        content_type_,
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
    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
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

        // Zig spec: `seconds.to(c_uint)` → `JSValue.toU32` (clamps via JS ToUint32 rules,
        // not signed wrap-then-reinterpret like `to_int32() as c_uint` would do).
        self.set_timeout(seconds.to_u32() as c_uint);
    }

    #[bun_uws::uws_callback(export = "Request__clone")]
    pub fn ffi_clone(&self, global_this: &JSGlobalObject) -> Option<Box<Request>> {
        self.clone(global_this).ok()
    }
}

// `comptime { _ = Request__clone; ... }` force-reference block → drop. Rust links what's pub.

// NOTE: `EventType` and `impl InternalJSEventCallback` are defined once below
// (near the struct decl); the duplicate block that used to live here was
// removed to resolve E0034 ambiguity.

impl Request {
    /// TODO: do we need this?
    pub fn init2(
        url: BunString,
        headers: Option<HeadersRef>,
        body: NonNull<BodyHiveRef>,
        method: Method,
    ) -> Request {
        Request {
            url: OwnedStringCell::new(url),
            headers: JsCell::new(headers),
            signal: JsCell::new(None),
            body,
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
        // `defer content_type_slice.deinit()` → Drop on ZigString::Slice
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

    pub fn get_remote_socket_info(
        &self,
        global_object: &JSGlobalObject,
    ) -> JsResult<Option<JSValue>> {
        let Some(info) = self.request_context.get_remote_socket_info() else {
            return Ok(None);
        };
        // Zig: `jsc.JSSocketAddress.create` → SocketAddress DTO POJO. Zig's
        // `JSSocketAddress.create` is infallible, but the Rust port routes
        // through `create_utf8_for_js` which can throw — propagate, don't
        // swallow, so we never return `None` while a JS exception is pending.
        crate::socket::socket_address::SocketAddress::create_dto(
            global_object,
            &info.ip,
            info.port as u16,
            info.is_ipv6,
        )
        .map(Some)
    }

    #[bun_uws::uws_callback(export = "Bun__JSRequest__calculateEstimatedByteSize")]
    pub fn calculate_estimated_byte_size(&self) {
        self.reported_estimated_size.set(
            self.body_value().estimated_size()
                + self.size_of_url()
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

    #[inline]
    pub fn detach_readable_stream(&self, global_object: &JSGlobalObject) {
        <Self as BodyMixin>::detach_readable_stream(self, global_object)
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

// TODO(port): move to runtime_sys
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
        // TODO(port): `@src()` argument dropped — fromJSHostCall location tracking TBD
    }
}

// TODO(port): move to runtime_sys
unsafe extern "C" {
    #[link_name = "Bun__getParamsIfBunRequest"]
    safe fn Bun__getParamsIfBunRequest(this_value: JSValue) -> JSValue;
    // Zig: `extern "JS"` — JS-side builtin; Phase B wires the actual link section.
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
        // PORT NOTE: return type narrowed to `core::fmt::Result` (matches
        // Response::write_format / Blob::write_format). Funnel JsError /
        // AllocError through `fmt::Error`; Zig's `anyerror!void` carried no
        // payload either.
        let js_err = |_: JsError| core::fmt::Error;

        let params_object = Bun__getParamsIfBunRequest(this_value);

        let class_label = if params_object.is_empty() {
            "Request"
        } else {
            "BunRequest"
        };
        write!(
            writer,
            "{} ({}) {{\n",
            class_label,
            bun_fmt::size(self.body_value_mut().size() as usize, Default::default())
        )?;
        {
            // Zig: `formatter.indent += 1; defer formatter.indent -|= 1;` — RAII guard
            // restores indent on every exit incl. `?` error paths. Shadows `formatter`
            // for the block; auto-derefs to `&mut F`.
            let mut formatter = bun_jsc::IndentScope::new(&mut *formatter);

            formatter.write_indent(writer)?;
            writer.write_str(
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>method<d>:<r> \"").as_ref(),
            )?;

            // Zig: `bun.asByteSlice(@tagName(this.method))` — wire-form token
            // (e.g. "M-SEARCH"), not the Rust Debug variant identifier.
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
                    // TODO(port): comptime Output.prettyFmt with embedded {f} — needs const_format
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
                        // TODO(port): Blob.initEmpty(undefined) — `undefined` global ptr;
                        // Phase B should pass a real global or make initEmpty not need one.
                        let mut empty = Blob::init_empty(formatter.global_this());
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

    pub fn mime_type(&self) -> &[u8] {
        if let Some(headers) = self.headers_mut().as_mut() {
            // TODO(port): Zig has `try` here but fn returns plain `string` — preserved as
            // non-fallible; FetchHeaders.fastGet may need to be infallible in Rust.
            if let Some(content_type) = headers.fast_get(HTTPHeaderName::ContentType) {
                // PORT NOTE: `fast_get` returns a `ZigString` by value whose
                // bytes borrow the FetchHeaders' WTF::String storage (NOT the
                // local). `ZigString::slice` ties the borrow to the local
                // `content_type`; detach and re-anchor on `self` so the
                // returned `&[u8]` outlives the temporary.
                // SAFETY: the bytes point into `self.headers`' WTF storage,
                // which is held alive for the borrow `&self`.
                return unsafe { bun_ptr::detach_lifetime(content_type.slice()) };
            }
        }

        // PORT NOTE: upstream `bun_http_types::MimeType::{OTHER,TEXT}` are `const` items
        // (not `static`), so `&CONST.value` borrows a temporary `Cow` and cannot be
        // returned. Mirror their `init_comptime` byte literals here as `'static` slices.
        const MIME_OTHER_VALUE: &[u8] = b"application/octet-stream";
        const MIME_TEXT_VALUE: &[u8] = b"text/plain;charset=utf-8";

        match self.body_value() {
            BodyValue::Blob(blob) => {
                let ct = blob.content_type_slice();
                if !ct.is_empty() {
                    return ct;
                }

                MIME_OTHER_VALUE
            }
            BodyValue::InternalBlob(ib) => ib.content_type(),
            BodyValue::WTFStringImpl(_) => MIME_TEXT_VALUE,
            // BodyValue::InlineBlob(ib) => ib.content_type(),
            BodyValue::Null
            | BodyValue::Error(_)
            | BodyValue::Used
            | BodyValue::Locked(_)
            | BodyValue::Empty => MIME_OTHER_VALUE,
        }
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_cache(&self, global_this: &JSGlobalObject) -> JSValue {
        fetch_cache_mode_to_js(self.flags.cache, global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_credentials(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        global_this.common_strings().include()
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_destination(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(b"").to_js(global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_integrity(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::EMPTY.to_js(global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_signal(&self, global_this: &JSGlobalObject) -> JSValue {
        // Already have a C++ instance
        if let Some(signal) = self.signal.get() {
            return signal.to_js(global_this);
        }
        // Lazy create default signal
        let js_signal = AbortSignal::create(global_this);
        js_signal.ensure_still_alive();
        if let Some(signal) = AbortSignal::ref_from_js(js_signal) {
            // `ref_from_js` already bumped the C++ refcount (Zig: `signal.ref()`).
            self.signal.set(Some(signal));
        }
        js_signal
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_method(&self, global_this: &JSGlobalObject) -> JSValue {
        self.method.to_js(global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_mode(&self, global_this: &JSGlobalObject) -> JSValue {
        fetch_request_mode_to_js(self.flags.mode, global_this)
    }

    pub fn finalize_without_deinit(&mut self) {
        // headers.deref() → HeadersRef::Drop when set to None
        self.headers.set(None);

        self.url.set(BunString::empty());

        // Zig: `signal.unref()` — AbortSignalRef::Drop unrefs the C++ handle.
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
        // Release the +1 hive ref handed out by `body::hive_alloc` /
        // `HiveRef::ref_()`; slot returns to the pool when the count hits
        // zero (drops the payload in place). `body: NonNull<_>` has no Drop,
        // so this is the only release point. Deref is centralised in
        // `body_hive()`.
        this.body_hive().unref();
        if this.weak_ptr_data.on_finalize() {
            // Hot path: no outstanding weak refs. Reclaim and drop the whole
            // allocation in one shot — `Box::from_raw`'s drop runs
            // `drop_in_place` over every field (headers / url / signal /
            // js_ref / internal_event_callback) once, matching Zig's
            // plain-store `finalizeWithoutDeinit` without the 4× `Cell::set`
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

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_redirect(&self, global_this: &JSGlobalObject) -> JSValue {
        fetch_redirect_to_js(self.flags.redirect, global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_referrer(&self, global_object: &JSGlobalObject) -> JSValue {
        if let Some(headers_ref) = self.headers_mut().as_mut() {
            if let Some(referrer) = headers_ref.get(b"referrer", global_object) {
                return referrer.to_js(global_object);
            }
        }

        ZigString::init(b"").to_js(global_object)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_referrer_policy(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(b"").to_js(global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
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
            let req_url = req.url();
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req.header(b"host") {
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

    pub fn ensure_url(&self) -> Result<(), AllocError> {
        if !self.url.get().is_empty() {
            return Ok(());
        }

        if let Some(req) = self.request_context.get_request() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST handle — safe deref.
            let req = bun_opaque::opaque_deref(req);
            let req_url = req.url();
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req.header(b"host") {
                    // With `port: None`, HostFormatter always emits exactly `host`. Compute the
                    // length and assemble the URL with straight slice copies instead of going
                    // through `core::fmt::write` (which is not monomorphized and shows up in
                    // per-request profiles).
                    let protocol = self.get_protocol();
                    let url_bytelength = protocol.len() + host.len() + req_url.len();

                    #[cfg(debug_assertions)]
                    debug_assert!(self.size_of_url() == url_bytelength);

                    if url_bytelength < 128 {
                        let mut buffer = [0u8; 128];
                        let url = {
                            let mut at = 0;
                            buffer[at..at + protocol.len()].copy_from_slice(protocol);
                            at += protocol.len();
                            buffer[at..at + host.len()].copy_from_slice(host);
                            at += host.len();
                            buffer[at..at + req_url.len()].copy_from_slice(req_url);
                            at += req_url.len();
                            &buffer[..at]
                        };

                        #[cfg(debug_assertions)]
                        debug_assert!(self.size_of_url() == url.len());

                        let mut href = bun_url::href_from_string(&BunString::from_bytes(url));
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

                    if strings::is_all_ascii(host) && strings::is_all_ascii(req_url) {
                        let (new_url, bytes) =
                            BunString::create_uninitialized_latin1(url_bytelength);
                        self.url.set(new_url);
                        // exact space was counted above
                        let (a, rest) = bytes.split_at_mut(protocol.len());
                        let (b, c) = rest.split_at_mut(host.len());
                        a.copy_from_slice(protocol);
                        b.copy_from_slice(host);
                        c.copy_from_slice(req_url);
                    } else {
                        // slow path
                        let mut temp_url: Vec<u8> = Vec::with_capacity(url_bytelength);
                        temp_url.extend_from_slice(protocol);
                        temp_url.extend_from_slice(host);
                        temp_url.extend_from_slice(req_url);
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

            #[cfg(debug_assertions)]
            debug_assert!(self.size_of_url() == req_url.len());
            self.url.set(BunString::clone_utf8(req_url));
        }
        Ok(())
    }
}

#[derive(enumset::EnumSetType)]
enum Fields {
    Method,
    Headers,
    Body,
    // Referrer,
    // ReferrerPolicy,
    Mode,
    // Credentials,
    Redirect,
    Cache,
    // Integrity,
    // Keepalive,
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
        let body = body::hive_alloc(global_this.bun_vm().as_mut(), BodyValue::Null);
        let mut req = Request {
            url: OwnedStringCell::new(BunString::empty()),
            headers: JsCell::new(None),
            signal: JsCell::new(None),
            body,
            js_ref: JsCell::new(JsRef::init_weak(this_value)),
            method: Method::GET,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
            internal_event_callback: JsCell::new(InternalJSEventCallback::default()),
        };
        // Zig `defer { if (!success) { req.finalizeWithoutDeinit(); _ = req.#body.unref(); }
        //               if (req.#body != body) { _ = body.unref(); } }`
        // PORT NOTE: reshaped for borrowck — scopeguard cannot capture `&mut req` while the
        // fn body also uses it. Cleanup is invoked at each early-return site via `bail!`.
        let cleanup = |req: &mut Request, body: NonNull<BodyHiveRef>, success: bool| {
            if !success {
                req.finalize_without_deinit();
                // `req.body` is the +1 ref this fn allocated above; deref is
                // centralised in `body_hive()`.
                req.body_hive().unref();
            }
            if req.body != body {
                // SAFETY: `body` was allocated with ref_count=1 at fn entry; if
                // `req.body` was repointed (not currently done by any path here),
                // release the original.
                unsafe { (*body.as_ptr()).unref() };
            }
        };

        macro_rules! bail {
            ($e:expr) => {{
                cleanup(&mut req, body, success);
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

        for &value in values_to_try {
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
                        cleanup(&mut req, body, success);
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
                                match request.body_value_mut().clone(global_this) {
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
                            // Zig: `req.#headers = try headers.cloneThis(globalThis);
                            //       fields.insert(.headers);`
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
                        // `bun.String` (no ref bump). Zig spec is `response.url.dupeRef()`,
                        // so take a +1 ref before storing — `req.url` is later released by
                        // `finalize_without_deinit` / the bail!-path `deref()`.
                        let url = response.url();
                        if !url.is_empty() {
                            req.url.set(url.dupe_ref());
                            fields.insert(Fields::Url);
                        }
                    }

                    if !fields.contains(Fields::Body) {
                        let body_value = response.get_body_value();
                        match body_value {
                            BodyValue::Null | BodyValue::Empty | BodyValue::Used => {}
                            _ => {
                                match body_value.clone(global_this) {
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
                        // Preserve Zig short-circuit ordering: only probe
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
                match value.get_truthy(global_this, b"signal") {
                    Ok(Some(signal_)) => {
                        fields.insert(Fields::Signal);
                        if let Some(signal) = AbortSignal::ref_from_js(signal_) {
                            // Keep it alive
                            signal_.ensure_still_alive();
                            // `ref_from_js` already ref'd (Zig: `signal.ref()`).
                            req.signal.set(Some(signal));
                        } else {
                            if !global_this.has_exception() {
                                bail!(Err(global_this.throw(format_args!(
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
                    // PORT NOTE: reshaped for borrowck — split borrow of req.body and req.headers
                    let ct_ptr: *const [u8] = ct;
                    match req.headers_mut().as_mut().unwrap().put(
                        HTTPHeaderName::ContentType,
                        // SAFETY: ct_ptr borrows req.body which is not mutated here.
                        unsafe { &*ct_ptr },
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

        cleanup(&mut req, body, success);
        Ok(req)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn]
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

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn do_clone(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        let cloned = self.clone(global_this)?;

        // TODO(port): cloned is Box<Request>; to_js consumes via heap::alloc inside codegen.
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
        let vm = global_this.bun_vm().as_mut();
        let body_ = self.clone_body_value_via_cached_stream(global_this)?;
        // errdefer body_.deinit() → deleted; BodyValue: Drop frees on `?` error path
        // SAFETY: vm is the live per-thread singleton.
        let body = body::hive_alloc(unsafe { &mut *vm }, body_);
        // Last fallible call. Zig hoists `url` above this with an
        // `errdefer if (!preserve_url) url.deref()`; we instead sink the url
        // computation below it so no guard is needed at all — `BunString` is
        // `Copy` with no `Drop`, so an early return here leaves `req.url`
        // untouched and still owned by the caller's `finalize_without_deinit`.
        let headers = match self.clone_headers(global_this) {
            Ok(h) => h,
            Err(e) => {
                // Zig: `errdefer body.unref()` — `NonNull` is `Copy`, so no
                // RAII covers this; release the +1 we just allocated.
                // SAFETY: `body` is a fresh +1 hive slot from `hive_alloc`.
                unsafe { (*body.as_ptr()).unref() };
                return Err(e);
            }
        };
        // errdefer if (headers) |_h| _h.deref() → Arc drop on error path is automatic
        let url = if preserve_url {
            // Bitwise copy — the `ptr::write` below overwrites the old slot;
            // `BunString` has no `Drop`, so the stale `req.url` bits are discarded
            // and this copy becomes the sole live handle.
            req.url.get()
        } else {
            self.url.get().dupe_ref()
        };

        // Zig `req.* = Request{...}` is a raw bit-overwrite — no destructors run
        // on the old `*req`. Match that with `ptr::write` so future Drop impls
        // on `JsRef` / `strong::Optional` don't fire on the caller's sentinel.
        // The old `req.body` hive ref is NOT unref'd here (Zig doesn't either):
        // `clone()` seeds it with `NonNull::dangling()`, and `construct_into`
        // releases its seed via the `req.body != body` arm of its `cleanup`.
        // `url` was bitwise-copied above (preserve_url) or is the empty
        // sentinel; remaining incoming fields are None/weak/Copy by contract.
        // SAFETY: `req` is a valid &mut, fully initialized by the caller;
        // nothing between here and the write can panic.
        unsafe {
            core::ptr::write(
                req,
                Request {
                    url: OwnedStringCell::new(url),
                    headers: JsCell::new(headers),
                    signal: JsCell::new(None),
                    body,
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
            // `AbortSignalRef::clone` → C++ `ref()` (matches Zig `signal.ref()`).
            req.signal.set(Some(signal.clone()));
        }
        Ok(())
    }

    pub fn clone(&self, global_this: &JSGlobalObject) -> JsResult<Box<Request>> {
        // allocator param dropped (global mimalloc)
        // Zig does `Request.new(undefined)` then clone_into bit-overwrites the whole
        // struct. clone_into uses `ptr::write` (no drop glue) but does `ptr::read`
        // `req.body` first to release the seed allocation, so seed with a valid
        // sentinel rather than `MaybeUninit`.
        let mut req = Box::new(Request {
            url: OwnedStringCell::new(BunString::empty()),
            headers: JsCell::new(None),
            signal: JsCell::new(None),
            // `clone_into` `ptr::write`s the whole struct without dropping the
            // sentinel; seed with a non-deref'd dangling so no hive slot is
            // allocated for the throwaway.
            body: NonNull::dangling(),
            js_ref: JsCell::new(JsRef::empty()),
            method: Method::GET,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: Cell::new(0),
            internal_event_callback: JsCell::new(InternalJSEventCallback::default()),
        });
        // errdefer bun.destroy(req) → Box<Request> drops on error path automatically
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

/// Re-export of `NodeHTTPResponse.AbortEvent` (Zig: `pub const EventType =
/// jsc.API.NodeHTTPResponse.AbortEvent`).
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
        body: NonNull<BodyHiveRef>,
    ) -> Request {
        Request {
            url: OwnedStringCell::new(BunString::empty()),
            headers: JsCell::new(None),
            signal: JsCell::new(signal),
            body,
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

    #[inline]
    pub fn get_fetch_headers(&self) -> Option<&FetchHeaders> {
        self.headers.get().as_deref()
    }

    /// Mutable access to the already-materialized headers (does NOT lazily
    /// create from the underlying uWS request — see `get_fetch_headers_unless_empty`
    /// for that). Mirrors Zig `Request.getFetchHeaders` returning `?*FetchHeaders`.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn get_fetch_headers_mut(&self) -> Option<&mut FetchHeaders> {
        self.headers_mut().as_deref_mut()
    }
}

// ported from: src/runtime/webcore/Request.zig
