//! https://developer.mozilla.org/en-US/docs/Web/API/Request

use core::ffi::{c_uint, c_void};
use std::sync::Arc;

use enumset::EnumSet;

use bun_alloc::AllocError;
use bun_core::{fmt as bun_fmt, Output};
use bun_http_types::FetchCacheMode::FetchCacheMode;
use bun_http_types::FetchRedirect::FetchRedirect;
use bun_http_types::FetchRequestMode::FetchRequestMode;
use bun_http_types::Method::Method;
use crate::webcore::jsc::codegen::JSRequest as js;
use bun_jsc::generated::JSRequest as js_gen;
use crate::webcore::jsc::{
    self as jsc, CallFrame, HTTPHeaderName, JSGlobalObject, JSValue, JsError, JsRef, JsResult,
};
use bun_ptr::weak_ptr::WeakPtrData;
use crate::api::AnyRequestContext;
use crate::webcore::body::{self, Body, BodyMixin, Value as BodyValue};
use crate::webcore::{AbortSignal, Blob, CookieMap, FetchHeaders, ReadableStream, Response};
use super::response::HeadersRef;
use bun_str::{strings, String as BunString, ZigString};
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
// not yet wired for Request). Mirrors the Blob.rs pattern — bind the
// generated C++ shims by link-name and wrap.
const _: () = {
    // Request is #[repr(C)] but holds Option<Arc<_>> (niche-opt, not formally
    // FFI-safe). C++ only ever sees *mut Request as an opaque pointer, so
    // suppress the field-level lint here.
    #[allow(improper_ctypes)]
    unsafe extern "C" {
        #[link_name = "Request__fromJS"]
        fn __from_js(value: bun_jsc::JSValue) -> Option<core::ptr::NonNull<Request>>;
        #[link_name = "Request__fromJSDirect"]
        fn __from_js_direct(value: bun_jsc::JSValue) -> Option<core::ptr::NonNull<Request>>;
        #[link_name = "Request__create"]
        fn __create(global: *const bun_jsc::JSGlobalObject, ptr: *mut Request) -> bun_jsc::JSValue;
        #[link_name = "Request__getConstructor"]
        fn __get_constructor(global: *const bun_jsc::JSGlobalObject) -> bun_jsc::JSValue;
    }

    impl bun_jsc::JsClass for Request {
        fn from_js(value: bun_jsc::JSValue) -> Option<*mut Self> {
            // SAFETY: pure FFI downcast; returns null on type mismatch.
            unsafe { __from_js(value) }.map(|p| p.as_ptr())
        }
        fn from_js_direct(value: bun_jsc::JSValue) -> Option<*mut Self> {
            // SAFETY: pure FFI downcast (exact-structure check); null on miss.
            unsafe { __from_js_direct(value) }.map(|p| p.as_ptr())
        }
        fn to_js(self, global: &bun_jsc::JSGlobalObject) -> bun_jsc::JSValue {
            let ptr = Box::into_raw(Box::new(self));
            // SAFETY: `global` is live; ownership of `ptr` transfers to the
            // C++ wrapper (freed via `RequestClass__finalize`).
            unsafe { __create(global, ptr) }
        }
        fn get_constructor(global: &bun_jsc::JSGlobalObject) -> bun_jsc::JSValue {
            // SAFETY: `global` is a live JSC global; C++ reads its cached
            // structure/constructor table.
            unsafe { __get_constructor(global) }
        }
    }
};

#[repr(C)]
pub struct Request {
    pub url: BunString,

    headers: Option<HeadersRef>,
    pub signal: Option<Arc<AbortSignal>>,
    // TODO(port): mapped from *Body.Value.HiveRef per LIFETIMES.tsv. Zig pools
    // BodyValue in a HiveAllocator and mutates `#body.value` in place; Phase B
    // must decide on `Arc<RefCell<BodyValue>>` vs `IntrusiveRc<HiveRef>` once
    // body::HiveRef is un-gated. Boxed for now to keep struct size stable.
    body: Box<BodyValue>,
    js_ref: JsRef,
    pub method: Method,
    pub flags: Flags,
    pub request_context: AnyRequestContext,
    pub weak_ptr_data: WeakPtrData,
    // We must report a consistent value for this
    pub reported_estimated_size: usize,
    pub internal_event_callback: InternalJSEventCallback,
}

// TODO(port): was `packed struct(u8)`. Fields are enums + 1 bool, not all-bool, so the
// guide says #[repr(transparent)] u8 + shift accessors. Kept as a plain struct here to
// preserve direct-field-access logic 1:1; restore bit-packing in Phase B if size/FFI matters.
#[derive(Clone, Copy)]
pub struct Flags {
    pub redirect: FetchRedirect,
    pub cache: FetchCacheMode,
    pub mode: FetchRequestMode,
    pub https: bool,
}

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
pub use js::from_js;
pub use js::from_js_direct;

// `pub const new = bun.TrivialNew(@This());` → Box::new (global mimalloc).
impl Request {
    #[inline]
    pub fn new(v: Request) -> Box<Request> {
        Box::new(v)
    }
}

// Wire the cached `body` JS slot accessor so `PendingValue::is_disturbed` can
// short-circuit on a JS-side stream that was already read (Zig:
// `T.js.bodyGetCached(this_value)`).
// TODO(b2-blocked): bun_jsc::* — JSValue, generated `js::body_get_cached`.

impl crate::webcore::body::BodyOwnerJs for Request {
    fn body_get_cached(this_value: JSValue) -> Option<JSValue> {
        js_gen::body_get_cached(this_value)
    }
}

// BodyMixin(@This()) — in Rust, BodyMixin is a trait impl'd for Request;
// these become trait methods (get_text/get_bytes/get_body/get_body_used/
// get_json/get_array_buffer/get_blob/get_form_data/get_blob_without_call_frame).
//
// Override `get_body_readable_stream` so the BodyMixin default methods
// (get_text/get_json/etc.) actually see the cached stream. The trait default
// returns `None`; without this override the `@hasDecl(Type, "getBodyReadableStream")`
// paths in Body.zig are silently dead.
//
impl BodyMixin for Request {
    #[inline]
    fn get_body_value(&mut self) -> &mut BodyValue {
        Request::get_body_value(self)
    }
    #[inline]
    fn get_fetch_headers(&self) -> Option<core::ptr::NonNull<FetchHeaders>> {
        // Zig: `?*FetchHeaders` — opaque C++ handle. Return the raw `*mut`
        // directly (via `HeadersRef::as_ptr`) so the provenance is mutable;
        // going through `as_deref()` would derive it from a `&FetchHeaders`
        // and make the later `as_mut()` UB under Stacked Borrows.
        self.headers.as_ref().map(|h| {
            // SAFETY: HeadersRef wraps a non-null `*mut FetchHeaders`.
            unsafe { core::ptr::NonNull::new_unchecked(h.as_ptr()) }
        })
    }
    #[inline]
    fn get_form_data_encoding(
        &mut self,
    ) -> bun_jsc::JsResult<Option<Box<bun_core::form_data::AsyncFormData>>> {
        Request::get_form_data_encoding(self)
    }
    #[inline]
    fn get_body_readable_stream(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> Option<ReadableStream> {
        Request::get_body_readable_stream(self, global_object)
    }
}

// ─── un-gated header accessors & simple getters ─────────────────────────────
impl Request {
    /// Zig: `pub fn getBodyValue(this: *Request) *Body.Value`.
    /// Inherent shim until the real `BodyMixin` (body::_jsc_gated) is un-gated
    /// and `impl BodyMixin for Request` supplies this as a trait method.
    #[inline]
    pub fn get_body_value(&mut self) -> &mut BodyValue {
        &mut self.body
    }

    // Returns if the request has headers already cached/set.
    pub fn has_fetch_headers(&self) -> bool {
        self.headers.is_some()
    }

    /// Sets the headers of the request. This will take ownership of the headers.
    /// it will deref the previous headers if they exist.
    pub fn set_fetch_headers(&mut self, headers: Option<HeadersRef>) {
        // old_headers.deref() → handled by HeadersRef::Drop on assignment
        self.headers = headers;
    }

    /// Returns the headers of the request. If the headers are not already cached, it will create a new FetchHeaders object.
    /// If the headers are empty, it will look at request_context to get the headers.
    /// If the headers are empty and request_context is null, it will create an empty FetchHeaders object.
    pub fn ensure_fetch_headers(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> JsResult<&mut HeadersRef> {
        if self.headers.is_some() {
            // headers is already set
            return Ok(self.headers.as_mut().unwrap());
        }

        // TODO(b2-blocked): AnyRequestContext::get_request is cfg-gated in
        // src/runtime/server/AnyRequestContext.rs. Until un-gated, behave as
        // if there is no live uWS request.
        let uws_req: Option<*mut uws::Request> = None;
        if let Some(req) = uws_req {
            // we have a request context, so we can get the headers from it
            self.headers = Some(HeadersRef::create_from_uws(req as *mut core::ffi::c_void));
        } else {
            // we don't have a request context, so we need to create an empty headers object
            self.headers = Some(HeadersRef::create_empty());
            // PORT NOTE: reshaped for borrowck — Zig read `blob.content_type`
            // through `self.body` while holding `self.headers`. Snapshot the
            // pointer first; `Blob.content_type` is a raw `*const [u8]` that
            // stays valid across the field borrow.
            let content_type: Option<*const [u8]> = match &*self.body {
                BodyValue::Blob(blob) => Some(blob.content_type),
                BodyValue::Locked(locked) => match locked.readable.get(global_this) {
                    Some(readable) => match readable.ptr {
                        crate::webcore::readable_stream::Source::Blob(blob) => {
                            // TODO(b2-blocked): ByteBlobLoader is a stub unit struct
                            // (webcore.rs); its `content_type` field comes back once
                            // the real ByteBlobLoader module is wired in.
                            let _ = blob;
                            None
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
                    self.headers.as_mut().unwrap().put(
                        HTTPHeaderName::ContentType,
                        content_type_,
                        global_this,
                    )?;
                }
            }
        }

        Ok(self.headers.as_mut().unwrap())
    }

    pub fn get_fetch_headers_unless_empty(&mut self) -> Option<&mut HeadersRef> {
        if self.headers.is_none() {
            // TODO(b2-blocked): AnyRequestContext::get_request is cfg-gated.
            let uws_req: Option<*mut uws::Request> = None;
            if let Some(req) = uws_req {
                // we have a request context, so we can get the headers from it
                self.headers = Some(HeadersRef::create_from_uws(req as *mut core::ffi::c_void));
            }
        }

        let headers = self.headers.as_mut()?;
        if headers.is_empty() {
            return None;
        }
        Some(headers)
    }

    /// This should only be called by the JS code. use getFetchHeaders to get the current headers or ensureFetchHeaders to get the headers and create them if they don't exist.
    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_headers(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(self.ensure_fetch_headers(global_this)?.to_js(global_this))
    }

    pub fn clone_headers(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<HeadersRef>> {
        if self.headers.is_none() {
            if let Some(uws_req) = self.request_context.get_request() {
                self.headers =
                    Some(HeadersRef::create_from_uws(uws_req as *mut core::ffi::c_void));
            }
        }

        if let Some(head) = self.headers.as_mut() {
            if head.is_empty() {
                return Ok(None);
            }

            return head.clone_this(global_this);
        }

        Ok(None)
    }

    pub fn get_content_type(&mut self) -> JsResult<Option<bun_str::ZigStringSlice>> {
        if let Some(req) = self.request_context.get_request() {
            // SAFETY: `req` points to a live uWS HttpRequest for the duration
            // of the request handler; header() returns a view into its buffer.
            let req = unsafe { &*req };
            if let Some(value) = req.header(b"content-type") {
                return Ok(Some(bun_str::ZigStringSlice::from_utf8_never_free(value)));
            }
        }

        if let Some(headers) = self.headers.as_mut() {
            if let Some(value) = headers.fast_get(HTTPHeaderName::ContentType) {
                return Ok(Some(value.to_slice()));
            }
        }

        if let BodyValue::Blob(blob) = &*self.body {
            // SAFETY: see ensure_fetch_headers note.
            let ct = unsafe { &*blob.content_type };
            if !ct.is_empty() {
                return Ok(Some(bun_str::ZigStringSlice::from_utf8_never_free(ct)));
            }
        }

        Ok(None)
    }
}

// TODO(b2-blocked): bun_jsc::* — every block below until `Flags`-adjacent
// `init`/accessors depends on JSC method surface (JSValue::is_number/to/call,
// Strong::create/get, request_context methods, JsRef::try_get, codegen
// gc.stream slots, etc.). Struct + Flags + InternalJSEventCallback type are
// kept un-gated; impl bodies gated.

mod _jsc_gated {
use super::*;
use bun_jsc::StringJsc as _;
use bun_http_jsc::method_jsc::MethodJsc as _;
use bun_http_jsc::fetch_enums_jsc::{fetch_cache_mode_to_js, fetch_redirect_to_js, fetch_request_mode_to_js};
use crate::webcore::blob::ZigStringBlobExt as _;

impl Request {
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Request>()
            + self.request_context.memory_cost()
            + self.url.byte_slice().len()
            + self.body.memory_cost()
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Request__setCookiesOnRequestContext(
    this: *mut Request,
    cookie_map: Option<&CookieMap>,
) {
    // SAFETY: called from C++ with a live Request* (m_ctx payload)
    let this = unsafe { &mut *this };
    this.request_context
        .set_cookies(cookie_map.map(|c| c as *const CookieMap as *mut CookieMap));
}

#[unsafe(no_mangle)]
pub extern "C" fn Request__getUWSRequest(this: *mut Request) -> Option<&'static mut uws::Request> {
    // SAFETY: called from C++ with a live Request* (m_ctx payload)
    let this = unsafe { &mut *this };
    // TODO(port): lifetime of returned uws::Request is tied to request_context, not 'static
    this.request_context
        .get_request()
        // SAFETY: caller (C++) treats the pointer as borrowed for the request handler's lifetime.
        .map(|p| unsafe { &mut *p })
}

#[unsafe(no_mangle)]
pub extern "C" fn Request__setInternalEventCallback(
    this: *mut Request,
    callback: JSValue,
    global_this: &JSGlobalObject,
) {
    // SAFETY: called from C++ with a live Request* (m_ctx payload)
    let this = unsafe { &mut *this };
    this.internal_event_callback = InternalJSEventCallback::init(callback, global_this);
    // we always have the abort event but we need to enable the timeout event as well in case of `node:http`.Server.setTimeout is set
    this.request_context.enable_timeout_events();
}

#[unsafe(no_mangle)]
pub extern "C" fn Request__setTimeout(
    this: *mut Request,
    seconds: JSValue,
    global_this: &JSGlobalObject,
) {
    // SAFETY: called from C++ with a live Request* (m_ctx payload)
    let this = unsafe { &mut *this };
    if !seconds.is_number() {
        let _ = global_this.throw(format_args!(
            "Failed to set timeout: The provided value is not of type 'number'."
        ));
        return;
    }

    this.set_timeout(seconds.to_int32() as c_uint);
}

#[unsafe(no_mangle)]
pub extern "C" fn Request__clone(
    this: *mut Request,
    global_this: &JSGlobalObject,
) -> Option<Box<Request>> {
    // SAFETY: called from C++ with a live Request* (m_ctx payload)
    let this = unsafe { &mut *this };
    this.clone(global_this).ok()
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
        body: Box<BodyValue>,
        method: Method,
    ) -> Request {
        Request {
            url,
            headers,
            signal: None,
            body,
            js_ref: JsRef::empty(),
            method,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        }
    }

    pub fn get_form_data_encoding(
        &mut self,
    ) -> JsResult<Option<Box<crate::webcore::form_data::AsyncFormData>>> {
        let Some(content_type_slice) = self.get_content_type()? else {
            return Ok(None);
        };
        // `defer content_type_slice.deinit()` → Drop on ZigString::Slice
        let Some(encoding) =
            crate::webcore::form_data::Encoding::get(content_type_slice.slice())
        else {
            return Ok(None);
        };
        Ok(Some(crate::webcore::form_data::AsyncFormData::init(
            encoding,
        )))
    }

    // TODO(b2-blocked): #[bun_jsc::host_call]
    pub extern "C" fn estimated_size(this: *mut Request) -> usize {
        // SAFETY: called from JSC codegen with live m_ctx
        unsafe { (*this).reported_estimated_size }
    }

    pub fn get_remote_socket_info(&mut self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(info) = self.request_context.get_remote_socket_info() {
            // Zig: `jsc.JSSocketAddress.create` → SocketAddress DTO POJO.
            return crate::socket::socket_address::SocketAddress::create_dto(
                global_object,
                &info.ip,
                info.port as u16,
                info.is_ipv6,
            )
            .ok();
        }

        None
    }

    pub fn calculate_estimated_byte_size(&mut self) {
        self.reported_estimated_size = self.body.estimated_size()
            + self.size_of_url()
            + core::mem::size_of::<Request>();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__JSRequest__calculateEstimatedByteSize(this: *mut Request) {
    // SAFETY: called from C++ with a live Request*
    unsafe { (*this).calculate_estimated_byte_size() };
}

impl Request {
    #[inline]
    pub fn get_body_readable_stream(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> Option<ReadableStream> {
        if let Some(js_ref) = self.js_ref.try_get() {
            if let Some(stream) = js_gen::stream_get_cached(js_ref) {
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
        if let BodyValue::Locked(locked) = &*self.body {
            return locked.readable.get(global_object);
        }
        None
    }

    #[inline]
    pub fn detach_readable_stream(&mut self, global_object: &JSGlobalObject) {
        if let Some(js_ref) = self.js_ref.try_get() {
            // Zig `js.gc.stream.clear(...)` → `set(.zero)`.
            js_gen::stream_set_cached(js_ref, global_object, JSValue::ZERO);
        }
        if let BodyValue::Locked(locked) = &mut *self.body {
            // TODO(port): Arc<BodyValue> mutation — see field note
            let mut old = core::mem::take(&mut locked.readable);
            drop(old);
            locked.readable = Default::default();
        }
    }

    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
        self.calculate_estimated_byte_size();
        let js_value = js::to_js_unchecked(global_object, self as *mut Request as *mut ());
        self.js_ref = JsRef::init_weak(js_value);

        self.check_body_stream_ref(global_object);
        js_value
    }
}

// TODO(port): move to runtime_sys
// Request is opaque on the C++ side; see note on the JsClass extern block above.
#[allow(improper_ctypes)]
unsafe extern "C" {
    #[link_name = "Bun__JSRequest__createForBake"]
    fn Bun__JSRequest__createForBake(
        global_object: *const JSGlobalObject,
        request_ptr: *mut Request,
    ) -> JSValue;
    // callconv(jsc.conv) — see // TODO(b2-blocked): #[bun_jsc::host_fn] note; raw extern keeps C ABI here and
    // fromJSHostCall handles the calling-convention shim.
}

impl Request {
    pub fn to_js_for_bake(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_object, || unsafe {
            // SAFETY: FFI to C++; pointers valid for the duration of the call
            Bun__JSRequest__createForBake(global_object, self)
        })
        // TODO(port): `@src()` argument dropped — fromJSHostCall location tracking TBD
    }
}

// TODO(port): move to runtime_sys
unsafe extern "C" {
    #[link_name = "Bun__getParamsIfBunRequest"]
    fn Bun__getParamsIfBunRequest(this_value: JSValue) -> JSValue;
    // Zig: `extern "JS"` — JS-side builtin; Phase B wires the actual link section.
}

impl Request {
    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
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

        // SAFETY: FFI call into JS builtin; this_value is a valid JSValue on stack
        let params_object = unsafe { Bun__getParamsIfBunRequest(this_value) };

        let class_label = if params_object.is_empty() {
            "Request"
        } else {
            "BunRequest"
        };
        write!(
            writer,
            "{} ({}) {{\n",
            class_label,
            bun_fmt::size(self.body.size() as usize, Default::default())
        )?;
        {
            formatter.indent_inc();
            // Zig: `defer formatter.indent -|= 1;` — must run on every exit incl. `?` error paths.
            // SAFETY: `formatter` outlives `_indent_guard` (same scope, guard dropped first);
            // the raw pointer is only dereferenced in the closure at scope exit, at which point
            // no other borrow of `formatter` is live.
            let formatter_ptr: *mut F = formatter;
            let _indent_guard = scopeguard::guard((), move |_| unsafe {
                (*formatter_ptr).indent_dec()
            });

            formatter.write_indent(writer)?;
            writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>method<d>:<r> \"").as_ref())?;

            write!(writer, "{:?}", self.method)?;
            writer.write_str("\"")?;
            formatter
                .print_comma::<_, ENABLE_ANSI_COLORS>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>url<d>:<r> ").as_ref())?;
            self.ensure_url().map_err(|_| core::fmt::Error)?;
            write!(
                writer,
                "{}",
                format_args!(
                    // TODO(port): comptime Output.prettyFmt with embedded {f} — needs const_format
                    "{}{}{}",
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("\"<b>"),
                    self.url,
                    Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>\""),
                )
            )?;
            formatter
                .print_comma::<_, ENABLE_ANSI_COLORS>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            if params_object.is_cell() {
                formatter.write_indent(writer)?;
                writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>params<d>:<r> ").as_ref())?;
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
            writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>headers<d>:<r> ").as_ref())?;
            let headers_js = self.get_headers(formatter.global_this()).map_err(js_err)?;
            formatter
                .print_as::<_, ENABLE_ANSI_COLORS>(
                    bun_jsc::FormatTag::Private,
                    writer,
                    headers_js,
                    bun_jsc::JSType::DOMWrapper,
                )
                .map_err(js_err)?;

            match &mut *self.body {
                BodyValue::Blob(blob) => {
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    blob.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
                }
                BodyValue::InternalBlob(_) | BodyValue::WTFStringImpl(_) => {
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    let size = self.body.size();
                    if size == 0 {
                        // TODO(port): Blob.initEmpty(undefined) — `undefined` global ptr;
                        // Phase B should pass a real global or make initEmpty not need one.
                        let mut empty = Blob::init_empty(formatter.global_this());
                        empty.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
                    } else {
                        crate::webcore::blob::write_format_for_size::<W, ENABLE_ANSI_COLORS>(
                            false, size as usize, writer,
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

    pub fn mime_type(&mut self) -> &[u8] {
        if let Some(headers) = &mut self.headers {
            // TODO(port): Zig has `try` here but fn returns plain `string` — preserved as
            // non-fallible; FetchHeaders.fastGet may need to be infallible in Rust.
            if let Some(_content_type) = headers.fast_get(HTTPHeaderName::ContentType) {
                // TODO(port): blocked_on lifetimes — `fast_get` returns an owned
                // `ZigString` whose slice borrows a local; cannot return `&[u8]`.
                // Phase B: change return type to owned slice or `bun.String`.
                todo!("blocked_on: bun_jsc::FetchHeaders::fast_get borrowed-slice return");
            }
        }

        // PORT NOTE: upstream `bun_http_types::MimeType::{OTHER,TEXT}` are `const` items
        // (not `static`), so `&CONST.value` borrows a temporary `Cow` and cannot be
        // returned. Mirror their `init_comptime` byte literals here as `'static` slices.
        const MIME_OTHER_VALUE: &[u8] = b"application/octet-stream";
        const MIME_TEXT_VALUE: &[u8] = b"text/plain;charset=utf-8";

        match &*self.body {
            BodyValue::Blob(blob) => {
                // SAFETY: Blob.content_type is a valid (possibly empty) raw slice ptr.
                let ct = unsafe { &*blob.content_type };
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
    pub fn get_signal(&mut self, global_this: &JSGlobalObject) -> JSValue {
        let _ = global_this;
        // Already have a C++ instance
        if let Some(_signal) = &self.signal {
            todo!("blocked_on: bun_jsc::AbortSignal::to_js")
        } else {
            // Lazy create default signal
            todo!("blocked_on: bun_jsc::AbortSignal::create / from_js")
        }
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
        // headers.deref() / signal.unref() → handled by Arc Drop when set to None
        self.headers = None;

        self.url.deref();
        self.url = BunString::empty();

        self.signal = None;
        // internal_event_callback.deinit() → Drop on Strong inside; explicit take to match timing
        self.internal_event_callback = InternalJSEventCallback::default();
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called by codegen finalize on the mutator thread; `this` is the m_ctx payload.
        let this_ref = unsafe { &mut *this };
        this_ref.js_ref.finalize();
        this_ref.finalize_without_deinit();
        // TODO(port): `_ = this.#body.unref()` — with Arc<BodyValue> this is implicit drop,
        // but we cannot drop a struct field in place; Phase B: make body Option<Arc<..>> or
        // rely on Box::from_raw below to drop everything.
        if this_ref.weak_ptr_data.on_finalize() {
            // SAFETY: m_ctx was allocated via Box::into_raw in Request::new
            drop(unsafe { Box::from_raw(this) });
        }
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_redirect(&self, global_this: &JSGlobalObject) -> JSValue {
        fetch_redirect_to_js(self.flags.redirect, global_this)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_referrer(&mut self, global_object: &JSGlobalObject) -> JSValue {
        if let Some(headers_ref) = &mut self.headers {
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
    pub fn get_url(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.ensure_url()?;
        self.url.to_js(global_object)
    }

    pub fn size_of_url(&self) -> usize {
        if self.url.length() > 0 {
            return self.url.byte_slice().len();
        }

        if let Some(req) = self.request_context.get_request() {
            // SAFETY: `req` points to a live uWS HttpRequest for the duration
            // of the request handler.
            let req = unsafe { &*req };
            let req_url = req.url();
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req.header(b"host") {
                    let fmt = bun_fmt::HostFormatter {
                        is_https: self.flags.https,
                        host,
                        port: None,
                    };
                    return self.get_protocol().len()
                        + req_url.len()
                        + bun_fmt::count(format_args!("{}", fmt));
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

    pub fn ensure_url(&mut self) -> Result<(), AllocError> {
        if !self.url.is_empty() {
            return Ok(());
        }

        if let Some(req) = self.request_context.get_request() {
            // SAFETY: `req` points to a live uWS HttpRequest for the duration
            // of the request handler.
            let req = unsafe { &*req };
            let req_url = req.url();
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req.header(b"host") {
                    let fmt = bun_fmt::HostFormatter {
                        is_https: self.flags.https,
                        host,
                        port: None,
                    };
                    let url_bytelength = bun_fmt::count(format_args!(
                        "{}{}{}",
                        bstr::BStr::new(self.get_protocol()),
                        fmt,
                        bstr::BStr::new(req_url),
                    ));

                    #[cfg(debug_assertions)]
                    debug_assert!(self.size_of_url() == url_bytelength);

                    if url_bytelength < 128 {
                        let mut buffer = [0u8; 128];
                        let url = {
                            use std::io::Write;
                            let mut cursor = &mut buffer[..];
                            write!(
                                cursor,
                                "{}{}{}",
                                bstr::BStr::new(self.get_protocol()),
                                fmt,
                                bstr::BStr::new(req_url),
                            )
                            .expect("Unexpected error while printing URL");
                            let written = 128 - cursor.len();
                            &buffer[..written]
                        };

                        #[cfg(debug_assertions)]
                        debug_assert!(self.size_of_url() == url.len());

                        let mut href = bun_url::href_from_string(&BunString::from_bytes(url));
                        if !href.is_empty() {
                            if core::ptr::eq(href.byte_slice().as_ptr(), url.as_ptr()) {
                                self.url = BunString::clone_latin1(&url[..href.length()]);
                                href.deref();
                            } else {
                                self.url = href;
                            }
                        } else {
                            // TODO: what is the right thing to do for invalid URLS?
                            self.url = BunString::clone_utf8(url);
                        }

                        return Ok(());
                    }

                    if strings::is_all_ascii(host) && strings::is_all_ascii(req_url) {
                        let (new_url, bytes) =
                            BunString::create_uninitialized_latin1(url_bytelength);
                        self.url = new_url;
                        {
                            use std::io::Write;
                            let mut cursor = &mut bytes[..];
                            // exact space should have been counted
                            write!(
                                cursor,
                                "{}{}{}",
                                bstr::BStr::new(self.get_protocol()),
                                fmt,
                                bstr::BStr::new(req_url),
                            )
                            .expect("unreachable");
                        }
                    } else {
                        // slow path
                        let mut temp_url: Vec<u8> = Vec::new();
                        {
                            use std::io::Write;
                            write!(
                                &mut temp_url,
                                "{}{}{}",
                                bstr::BStr::new(self.get_protocol()),
                                fmt,
                                bstr::BStr::new(req_url),
                            )
                            .map_err(|_| AllocError)?;
                        }
                        // `defer bun.default_allocator.free(temp_url)` → Vec drops at scope end
                        self.url = BunString::clone_utf8(&temp_url);
                    }

                    let href = bun_url::href_from_string(&self.url.dupe_ref());
                    // TODO: what is the right thing to do for invalid URLS?
                    if !href.is_empty() {
                        self.url.deref();
                        self.url = href;
                    }

                    return Ok(());
                }
            }

            #[cfg(debug_assertions)]
            debug_assert!(self.size_of_url() == req_url.len());
            self.url = BunString::clone_utf8(req_url);
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
    fn check_body_stream_ref(&mut self, global_object: &JSGlobalObject) {
        if let Some(js_value) = self.js_ref.try_get() {
            if let BodyValue::Locked(locked) = &mut *self.body {
                // TODO(port): Arc<BodyValue> mutation — see field note
                if let Some(stream) = locked.readable.get(global_object) {
                    // Store the stream in js.gc.stream instead of holding a strong reference
                    // to avoid circular references. The Request object owns the stream,
                    // so Locked.readable should not be used directly by consumers.
                    stream.value.ensure_still_alive();
                    js_gen::stream_set_cached(js_value, global_object, stream.value);
                    locked.readable.deinit();
                    locked.readable = Default::default();
                }
            }
        }
    }

    pub fn construct_into(
        global_this: &JSGlobalObject,
        arguments: &[JSValue],
        this_value: JSValue,
    ) -> JsResult<Request> {
        let mut success = false;
        // TODO(port): blocked_on: bun_jsc::VirtualMachine::init_request_body_value
        // (Zig pools BodyValue in a HiveAllocator). Box directly for now.
        let _ = global_this.bun_vm();
        let body: Box<BodyValue> = Box::new(BodyValue::Null);
        let body_ptr: *const BodyValue = &*body;
        let mut req = Request {
            url: BunString::empty(),
            headers: None,
            signal: None,
            body,
            js_ref: JsRef::init_weak(this_value),
            method: Method::GET,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        };
        // Zig `defer { if (!success) ...; if (req.#body != body) ... }`
        // PORT NOTE: reshaped for borrowck — scopeguard cannot capture &mut req while body
        // of fn uses it. Cleanup is performed at each early-return site via the closure below.
        // TODO(port): errdefer — verify all error paths invoke cleanup; Phase B may wrap
        // `req` in a guard struct whose Drop runs finalize_without_deinit unless disarmed.
        let cleanup = |req: &mut Request, body_ptr: *const BodyValue, success: bool| {
            if !success {
                req.finalize_without_deinit();
                // _ = req.#body.unref() → Box drop when req drops
            }
            if !core::ptr::eq(&*req.body as *const BodyValue, body_ptr) {
                // _ = body.unref() → original Box already moved into req or replaced; no-op.
            }
        };

        macro_rules! bail {
            ($e:expr) => {{
                cleanup(&mut req, body_ptr, success);
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
            req.url = str;

            if !req.url.is_empty() {
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
                    let request = unsafe { &mut *request };
                    if values_to_try.len() == 1 {
                        match Request::clone_into(request, &mut req, global_this, fields.contains(Fields::Url))
                        {
                            Ok(()) => {}
                            Err(e) => bail!(Err(e)),
                        }
                        success = true;
                        cleanup(&mut req, body_ptr, success);
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
                                req.headers = Some(headers);
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
                        match &*request.body {
                            BodyValue::Null | BodyValue::Empty | BodyValue::Used => {}
                            _ => {
                                match request.body.clone(global_this) {
                                    Ok(v) => {
                                        *req.body = v;
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
                            match headers.clone_this(global_this) {
                                Ok(Some(h)) => {
                                    // SAFETY: clone_this returns a +1 ref FetchHeaders.
                                    req.headers = Some(unsafe { HeadersRef::adopt(h) });
                                    fields.insert(Fields::Headers);
                                }
                                Ok(None) => {}
                                Err(e) => bail!(Err(e)),
                            }
                        }
                    }

                    if !fields.contains(Fields::Url) {
                        let url = response.get_url();
                        if !url.is_empty() {
                            req.url = url.dupe_ref();
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
                                        *req.body = v;
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
                                *req.body = v;
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
                            Ok(s) => req.url = s,
                            Err(e) => bail!(Err(e)),
                        }
                        if !req.url.is_empty() {
                            fields.insert(Fields::Url);
                        }

                        // first value
                    }
                    Ok(None) => {
                        if value == values_to_try[values_to_try.len() - 1]
                            && !is_first_argument_a_url
                            && {
                                let _ = value;
                                todo!("blocked_on: bun_jsc::JSValue::implements_to_string");
                                #[allow(unreachable_code)]
                                false
                            }
                        {
                            let str = match BunString::from_js(value, global_this) {
                                Ok(s) => s,
                                Err(e) => bail!(Err(e)),
                            };
                            req.url = str;
                            if !req.url.is_empty() {
                                fields.insert(Fields::Url);
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
                        // Keep it alive
                        signal_.ensure_still_alive();
                        let _ = signal_;
                        todo!("blocked_on: bun_jsc::AbortSignal::from_js");
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
                                    req.headers = Some(headers);
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
                let _ = (&value, global_this);
                todo!("blocked_on: bun_jsc::FromJsEnum for FetchRedirect");
            }

            // Extract cache option
            if !fields.contains(Fields::Cache) {
                let _ = (&value, global_this);
                todo!("blocked_on: bun_jsc::FromJsEnum for FetchCacheMode");
            }

            // Extract mode option
            if !fields.contains(Fields::Mode) {
                let _ = (&value, global_this);
                todo!("blocked_on: bun_jsc::FromJsEnum for FetchRequestMode");
            }
        }

        if global_this.has_exception() {
            bail!(Err(JsError::Thrown));
        }

        if req.url.is_empty() {
            bail!(Err(global_this.throw(format_args!(
                "Failed to construct 'Request': url is required."
            ))));
        }

        let href = bun_url::href_from_string(&req.url.dupe_ref());
        if href.is_empty() {
            if !global_this.has_exception() {
                // globalThis.throw can cause GC, which could cause the above string to be freed.
                // so we must increment the reference count before calling it.
                let err = global_this.err_invalid_url(format_args!(
                    "Failed to construct 'Request': Invalid URL \"{}\"",
                    req.url
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
        req.url.deref();

        req.url = href;

        if matches!(&*req.body, BodyValue::Blob(_)) && req.headers.is_some() {
            if let BodyValue::Blob(blob) = &*req.body {
                // SAFETY: Blob.content_type is a valid (possibly empty) raw slice ptr.
                let ct: &[u8] = unsafe { &*blob.content_type };
                if !ct.is_empty()
                    && !req
                        .headers
                        .as_mut()
                        .unwrap()
                        .fast_has(HTTPHeaderName::ContentType)
                {
                    // PORT NOTE: reshaped for borrowck — split borrow of req.body and req.headers
                    let ct_ptr: *const [u8] = ct;
                    match req.headers.as_mut().unwrap().put(
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

        cleanup(&mut req, body_ptr, success);
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
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        let cloned = self.clone(global_this)?;

        // TODO(port): cloned is Box<Request>; to_js consumes via Box::into_raw inside codegen.
        let cloned_ptr = Box::into_raw(cloned);
        // SAFETY: cloned_ptr was just created via Box::into_raw above; toJS adopts ownership.
        let js_wrapper = unsafe { (*cloned_ptr).to_js(global_this) };
        if !js_wrapper.is_empty() {
            // After toJS, checkBodyStreamRef has already moved the streams from
            // Locked.readable to js.gc.stream. So we need to use js.gc.stream
            // to get the streams and update the body cache.
            if let Some(cloned_stream) = js_gen::stream_get_cached(js_wrapper) {
                js_gen::body_set_cached(js_wrapper, global_this, cloned_stream);
            }
        }

        // Update the original request's body cache with the new teed stream.
        // At this point, this.#body.value.Locked.readable still holds the teed stream
        // because checkBodyStreamRef hasn't been called on the original request yet.
        if let BodyValue::Locked(locked) = &*self.body {
            if let Some(readable) = locked.readable.get(global_this) {
                js_gen::body_set_cached(this_value, global_this, readable.value);
            }
        }

        self.check_body_stream_ref(global_this);
        Ok(js_wrapper)
    }

    pub fn clone_into(
        &mut self,
        req: &mut Request,
        global_this: &JSGlobalObject,
        preserve_url: bool,
    ) -> JsResult<()> {
        // allocator param dropped (global mimalloc)
        let _ = self.ensure_url();
        let _ = global_this.bun_vm();
        let body_ = 'brk: {
            if let Some(js_ref) = self.js_ref.try_get() {
                if let Some(stream) = js_gen::stream_get_cached(js_ref) {
                    let mut readable = ReadableStream::from_js(stream, global_this)?;
                    if let Some(r) = readable.as_mut() {
                        break 'brk self.body.clone_with_readable_stream(global_this, Some(r))?;
                    }
                }
            }

            break 'brk self.body.clone(global_this)?;
        };
        // errdefer body_.deinit() → deleted; BodyValue: Drop frees on `?` error path
        // TODO(port): blocked_on: bun_jsc::VirtualMachine::init_request_body_value (HiveRef pool)
        let body: Box<BodyValue> = Box::new(body_);
        // TODO(port): errdefer chain — the Zig has 3 cascading errdefers; ScopeGuard
        // captures only one &mut at a time. Phase B should verify error-path cleanup.
        let url = if preserve_url {
            core::mem::replace(&mut req.url, BunString::empty())
        } else {
            self.url.dupe_ref()
        };
        let url_guard = scopeguard::guard(url, |u| {
            if !preserve_url {
                u.deref();
            }
        });
        let headers = self.clone_headers(global_this)?;
        // errdefer if (headers) |_h| _h.deref() → Arc drop on error path is automatic
        let url = scopeguard::ScopeGuard::into_inner(url_guard);

        *req = Request {
            url,
            headers,
            signal: None,
            body,
            js_ref: JsRef::empty(),
            method: self.method,
            flags: self.flags,
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        };

        if let Some(signal) = &self.signal {
            req.signal = Some(signal.clone()); // signal.ref()
        }
        Ok(())
    }

    pub fn clone(&mut self, global_this: &JSGlobalObject) -> JsResult<Box<Request>> {
        // allocator param dropped (global mimalloc)
        // Zig does `Request.new(undefined)` then clone_into overwrites the whole struct.
        // In Rust, `*req = Request { ... }` inside clone_into runs drop glue on the old
        // value, which would be UB on uninitialized memory (garbage Arc/BunString/Box
        // derefs). Seed the box with a cheap fully-initialized sentinel instead so the
        // overwrite drops a valid (empty) value.
        let mut req = Box::new(Request {
            url: BunString::empty(),
            headers: None,
            signal: None,
            body: Box::new(BodyValue::Null),
            js_ref: JsRef::empty(),
            method: Method::GET,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        });
        // errdefer bun.destroy(req) → Box<Request> drops on error path automatically
        self.clone_into(&mut req, global_this, false)?;
        Ok(req)
    }

    pub fn set_timeout(&mut self, seconds: c_uint) {
        let _ = self.request_context.set_timeout(seconds);
    }
}

} // mod _jsc_gated

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
        signal: Option<Arc<AbortSignal>>,
        body: Box<BodyValue>,
    ) -> Request {
        Request {
            url: BunString::empty(),
            headers: None,
            signal,
            body,
            js_ref: JsRef::empty(),
            method,
            flags: Flags { https, ..Flags::default() },
            request_context,
            weak_ptr_data: WeakPtrData::EMPTY,
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        }
    }

    #[inline]
    pub fn get_fetch_headers(&self) -> Option<&FetchHeaders> {
        self.headers.as_deref()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/Request.zig (1115 lines)
//   confidence: medium
//   todos:      25
//   notes:      headers is Option<HeadersRef> (RAII over C++-refcounted FetchHeaders, NOT Rc/Arc); Box<BodyValue> needs interior mutability — Zig mutates #body.value in place; construct_into defer-cleanup reshaped to macro+closure (verify error paths); Flags kept unpacked for field-access parity.
// ──────────────────────────────────────────────────────────────────────────
