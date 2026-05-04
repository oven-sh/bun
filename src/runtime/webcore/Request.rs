//! https://developer.mozilla.org/en-US/docs/Web/API/Request

use core::ffi::{c_uint, c_void};
use std::sync::Arc;

use enumset::EnumSet;

use bun_alloc::AllocError;
use bun_core::{fmt as bun_fmt, Output};
use bun_http::MimeType;
use bun_http_types::{FetchCacheMode, FetchRedirect, FetchRequestMode, Method};
use bun_jsc::codegen::JSRequest as js;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsRef, JsResult, Strong, URL};
use bun_ptr::WeakPtrData;
use bun_runtime::api::{AnyRequestContext, NodeHTTPResponse};
use bun_runtime::webcore::body::{self, Body, BodyMixin, BodyValue};
use bun_runtime::webcore::{AbortSignal, Blob, CookieMap, FetchHeaders, ReadableStream, Response};
use bun_str::{strings, String as BunString, ZigString};
use bun_uws as uws;

// TODO(port): WeakRef = bun.ptr.WeakPtr(Request, "weak_ptr_data") — intrusive weak-ptr;
// keep raw *mut Request + embedded WeakPtrData. See PORTING.md §Pointers.
pub type WeakRef = bun_ptr::WeakPtr<Request>;

#[bun_jsc::JsClass]
pub struct Request {
    pub url: BunString,

    headers: Option<Arc<FetchHeaders>>,
    pub signal: Option<Arc<AbortSignal>>,
    body: Arc<BodyValue>,
    // TODO(port): Arc<BodyValue> mapped from *Body.Value.HiveRef per LIFETIMES.tsv;
    // Zig mutates `#body.value` in place — Phase B must decide on interior mutability
    // (Arc<RefCell<BodyValue>> or IntrusiveRc<HiveRef>) since Arc<T> alone is immutable.
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

// TODO(port): BodyMixin(@This()) — in Rust, BodyMixin is a trait impl'd for Request;
// these re-exports become trait methods (get_text/get_bytes/get_body/get_body_used/
// get_json/get_array_buffer/get_blob/get_form_data/get_blob_without_call_frame).
impl BodyMixin for Request {}

impl Request {
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Request>()
            + self.request_context.memory_cost()
            + self.url.byte_slice().len()
            + self.body.value().memory_cost()
        // TODO(port): `self.body.value()` — see Arc<BodyValue> mutation note above
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Request__setCookiesOnRequestContext(
    this: *mut Request,
    cookie_map: Option<&CookieMap>,
) {
    // SAFETY: called from C++ with a live Request* (m_ctx payload)
    let this = unsafe { &mut *this };
    this.request_context.set_cookies(cookie_map);
}

#[unsafe(no_mangle)]
pub extern "C" fn Request__getUWSRequest(this: *mut Request) -> Option<&'static mut uws::Request> {
    // SAFETY: called from C++ with a live Request* (m_ctx payload)
    let this = unsafe { &mut *this };
    // TODO(port): lifetime of returned uws::Request is tied to request_context, not 'static
    this.request_context.get_request()
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

    this.set_timeout(seconds.to::<c_uint>());
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

#[derive(Default)]
pub struct InternalJSEventCallback {
    pub function: Strong, // jsc.Strong.Optional → bun_jsc::Strong
}

pub type EventType = <NodeHTTPResponse as bun_runtime::api::HasAbortEvent>::AbortEvent;
// TODO(port): `jsc.API.NodeHTTPResponse.AbortEvent` — direct path is
// `bun_runtime::api::node_http_response::AbortEvent`; adjust in Phase B.

impl InternalJSEventCallback {
    pub fn init(function: JSValue, global_this: &JSGlobalObject) -> InternalJSEventCallback {
        InternalJSEventCallback {
            function: Strong::create(function, global_this),
        }
    }

    pub fn has_callback(&self) -> bool {
        self.function.has()
    }

    pub fn trigger(&mut self, event_type: EventType, global_this: &JSGlobalObject) -> bool {
        if let Some(callback) = self.function.get() {
            let _ = callback
                .call(
                    global_this,
                    JSValue::UNDEFINED,
                    &[JSValue::js_number(event_type as i32)],
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
        body: Arc<BodyValue>,
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
            weak_ptr_data: WeakPtrData::empty(),
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        }
    }

    /// TODO: do we need this?
    pub fn init2(
        url: BunString,
        headers: Option<Arc<FetchHeaders>>,
        body: Arc<BodyValue>,
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
            weak_ptr_data: WeakPtrData::empty(),
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        }
    }

    pub fn get_content_type(&mut self) -> JsResult<Option<ZigString::Slice>> {
        if let Some(req) = self.request_context.get_request() {
            if let Some(value) = req.header(b"content-type") {
                return Ok(Some(ZigString::Slice::from_utf8_never_free(value)));
            }
        }

        if let Some(headers) = &self.headers {
            if let Some(value) = headers.fast_get(FetchHeaders::HeaderName::ContentType) {
                return Ok(Some(value.to_slice()));
            }
        }

        if let BodyValue::Blob(blob) = self.body.value() {
            if !blob.content_type.is_empty() {
                return Ok(Some(ZigString::Slice::from_utf8_never_free(
                    &blob.content_type,
                )));
            }
        }

        Ok(None)
    }

    pub fn get_form_data_encoding(
        &mut self,
    ) -> JsResult<Option<Box<bun_runtime::webcore::form_data::AsyncFormData>>> {
        let Some(content_type_slice) = self.get_content_type()? else {
            return Ok(None);
        };
        // `defer content_type_slice.deinit()` → Drop on ZigString::Slice
        let Some(encoding) =
            bun_runtime::webcore::form_data::Encoding::get(content_type_slice.slice())
        else {
            return Ok(None);
        };
        Ok(Some(bun_runtime::webcore::form_data::AsyncFormData::init(
            encoding,
        )))
    }

    #[bun_jsc::host_call]
    pub extern "C" fn estimated_size(this: *mut Request) -> usize {
        // SAFETY: called from JSC codegen with live m_ctx
        unsafe { (*this).reported_estimated_size }
    }

    pub fn get_remote_socket_info(&mut self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(info) = self.request_context.get_remote_socket_info() {
            return Some(bun_jsc::JSSocketAddress::create(
                global_object,
                info.ip,
                info.port,
                info.is_ipv6,
            ));
        }

        None
    }

    pub fn calculate_estimated_byte_size(&mut self) {
        self.reported_estimated_size = self.body.value().estimated_size()
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
            if let Some(stream) = js::gc::stream::get(js_ref) {
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
        if let BodyValue::Locked(locked) = self.body.value() {
            return locked.readable.get(global_object);
        }
        None
    }

    #[inline]
    pub fn detach_readable_stream(&mut self, global_object: &JSGlobalObject) {
        if let Some(js_ref) = self.js_ref.try_get() {
            js::gc::stream::clear(js_ref, global_object);
        }
        if let BodyValue::Locked(locked) = self.body.value_mut() {
            // TODO(port): Arc<BodyValue> mutation — see field note
            let mut old = core::mem::take(&mut locked.readable);
            drop(old);
            locked.readable = Default::default();
        }
    }

    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
        self.calculate_estimated_byte_size();
        let js_value = js::to_js_unchecked(global_object, self);
        self.js_ref = JsRef::init_weak(js_value);

        self.check_body_stream_ref(global_object);
        js_value
    }
}

// TODO(port): move to runtime_sys
unsafe extern "C" {
    #[link_name = "Bun__JSRequest__createForBake"]
    fn Bun__JSRequest__createForBake(
        global_object: *const JSGlobalObject,
        request_ptr: *mut Request,
    ) -> JSValue;
    // callconv(jsc.conv) — see #[bun_jsc::host_fn] note; raw extern keeps C ABI here and
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
    ) -> Result<(), bun_core::Error>
    where
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
        // TODO(port): narrow error set
    {
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
            bun_fmt::size(self.body.value().size(), Default::default())
        )?;
        {
            formatter.indent_mut().add(1);
            // Zig: `defer formatter.indent -|= 1;` — must run on every exit incl. `?` error paths.
            // SAFETY: `formatter` outlives `_indent_guard` (same scope, guard dropped first);
            // the raw pointer is only dereferenced in the closure at scope exit, at which point
            // no other borrow of `formatter` is live.
            let _indent_guard = scopeguard::guard(
                formatter.indent_mut() as *mut _,
                |p| unsafe { *p = (*p).saturating_sub(1) },
            );

            formatter.write_indent(writer)?;
            writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>method<d>:<r> \""))?;

            writer.write_str(<&'static str>::from(self.method))?;
            writer.write_str("\"")?;
            formatter
                .print_comma::<ENABLE_ANSI_COLORS, _>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            formatter.write_indent(writer)?;
            writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>url<d>:<r> "))?;
            self.ensure_url()?;
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
                .print_comma::<ENABLE_ANSI_COLORS, _>(writer)
                .expect("unreachable");
            writer.write_str("\n")?;

            if params_object.is_cell() {
                formatter.write_indent(writer)?;
                writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>params<d>:<r> "))?;
                formatter.print_as::<ENABLE_ANSI_COLORS, _>(
                    bun_jsc::FormatTag::Private,
                    writer,
                    params_object,
                    bun_jsc::JSType::Object,
                )?;
                formatter
                    .print_comma::<ENABLE_ANSI_COLORS, _>(writer)
                    .expect("unreachable");
                writer.write_str("\n")?;
            }

            formatter.write_indent(writer)?;
            writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>headers<d>:<r> "))?;
            let headers_js = self.get_headers(formatter.global_this())?;
            formatter.print_as::<ENABLE_ANSI_COLORS, _>(
                bun_jsc::FormatTag::Private,
                writer,
                headers_js,
                bun_jsc::JSType::DOMWrapper,
            )?;

            match self.body.value() {
                BodyValue::Blob(blob) => {
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    blob.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
                }
                BodyValue::InternalBlob(_) | BodyValue::WTFStringImpl(_) => {
                    writer.write_str("\n")?;
                    formatter.write_indent(writer)?;
                    let size = self.body.value().size();
                    if size == 0 {
                        // TODO(port): Blob.initEmpty(undefined) — `undefined` global ptr;
                        // Phase B should pass a real global or make initEmpty not need one.
                        let mut empty = Blob::init_empty_unchecked();
                        empty.write_format::<F, W, ENABLE_ANSI_COLORS>(formatter, writer)?;
                    } else {
                        Blob::write_format_for_size::<W, ENABLE_ANSI_COLORS>(false, size, writer)?;
                    }
                }
                BodyValue::Locked(_) => {
                    if let Some(stream) = self.get_body_readable_stream(formatter.global_this()) {
                        writer.write_str("\n")?;
                        formatter.write_indent(writer)?;
                        formatter.print_as::<ENABLE_ANSI_COLORS, _>(
                            bun_jsc::FormatTag::Object,
                            writer,
                            stream.value,
                            stream.value.js_type(),
                        )?;
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
        if let Some(headers) = &self.headers {
            // TODO(port): Zig has `try` here but fn returns plain `string` — preserved as
            // non-fallible; FetchHeaders.fastGet may need to be infallible in Rust.
            if let Some(content_type) = headers.fast_get(FetchHeaders::HeaderName::ContentType) {
                return content_type.slice();
            }
        }

        match self.body.value() {
            BodyValue::Blob(blob) => {
                if !blob.content_type.is_empty() {
                    return &blob.content_type;
                }

                MimeType::other().value
            }
            BodyValue::InternalBlob(ib) => ib.content_type(),
            BodyValue::WTFStringImpl(_) => MimeType::text().value,
            // BodyValue::InlineBlob(ib) => ib.content_type(),
            BodyValue::Null
            | BodyValue::Error(_)
            | BodyValue::Used
            | BodyValue::Locked(_)
            | BodyValue::Empty => MimeType::other().value,
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_cache(&self, global_this: &JSGlobalObject) -> JSValue {
        self.flags.cache.to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_credentials(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        global_this.common_strings().include()
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_destination(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(b"").to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_integrity(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::EMPTY.to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_signal(&mut self, global_this: &JSGlobalObject) -> JSValue {
        // Already have an C++ instance
        if let Some(signal) = &self.signal {
            signal.to_js(global_this)
        } else {
            // Lazy create default signal
            let js_signal = AbortSignal::create(global_this);
            js_signal.ensure_still_alive();
            if let Some(signal) = AbortSignal::from_js(js_signal) {
                self.signal = Some(signal.clone()); // signal.ref() → Arc::clone
            }
            js_signal
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_method(&self, global_this: &JSGlobalObject) -> JSValue {
        self.method.to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_mode(&self, global_this: &JSGlobalObject) -> JSValue {
        self.flags.mode.to_js(global_this)
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

    #[bun_jsc::host_fn(getter)]
    pub fn get_redirect(&self, global_this: &JSGlobalObject) -> JSValue {
        self.flags.redirect.to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_referrer(&self, global_object: &JSGlobalObject) -> JSValue {
        if let Some(headers_ref) = &self.headers {
            if let Some(referrer) = headers_ref.get(b"referrer", global_object) {
                return ZigString::init(referrer).to_js(global_object);
            }
        }

        ZigString::init(b"").to_js(global_object)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_referrer_policy(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ZigString::init(b"").to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_url(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.ensure_url()?;
        Ok(self.url.to_js(global_object))
    }

    pub fn size_of_url(&self) -> usize {
        if self.url.length() > 0 {
            return self.url.byte_slice().len();
        }

        if let Some(req) = self.request_context.get_request() {
            let req_url = req.url();
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req.header(b"host") {
                    let fmt = bun_fmt::HostFormatter {
                        is_https: self.flags.https,
                        host,
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
            let req_url = req.url();
            if !req_url.is_empty() && req_url[0] == b'/' {
                if let Some(host) = req.header(b"host") {
                    let fmt = bun_fmt::HostFormatter {
                        is_https: self.flags.https,
                        host,
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

                        let mut href = URL::href_from_string(BunString::from_bytes(url));
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

                    let href = URL::href_from_string(self.url.clone_ref());
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
            if let BodyValue::Locked(locked) = self.body.value_mut() {
                // TODO(port): Arc<BodyValue> mutation — see field note
                if let Some(stream) = locked.readable.get(global_object) {
                    // Store the stream in js.gc.stream instead of holding a strong reference
                    // to avoid circular references. The Request object owns the stream,
                    // so Locked.readable should not be used directly by consumers.
                    stream.value.ensure_still_alive();
                    js::gc::stream::set(js_value, global_object, stream.value);
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
        let vm = global_this.bun_vm();
        let body = vm.init_request_body_value(BodyValue::Null)?;
        let mut req = Request {
            url: BunString::empty(),
            headers: None,
            signal: None,
            body: body.clone(),
            js_ref: JsRef::init_weak(this_value),
            method: Method::GET,
            flags: Flags::default(),
            request_context: AnyRequestContext::NULL,
            weak_ptr_data: WeakPtrData::empty(),
            reported_estimated_size: 0,
            internal_event_callback: InternalJSEventCallback::default(),
        };
        // Zig `defer { if (!success) ...; if (req.#body != body) ... }`
        // PORT NOTE: reshaped for borrowck — scopeguard cannot capture &mut req while body
        // of fn uses it. Cleanup is performed at each early-return site via the closure below.
        // TODO(port): errdefer — verify all error paths invoke cleanup; Phase B may wrap
        // `req` in a guard struct whose Drop runs finalize_without_deinit unless disarmed.
        let cleanup = |req: &mut Request, body: &Arc<BodyValue>, success: bool| {
            if !success {
                req.finalize_without_deinit();
                // _ = req.#body.unref() → Arc drop when req drops
            }
            if !Arc::ptr_eq(&req.body, body) {
                // _ = body.unref() → drop the original `body` Arc clone (caller's local)
            }
        };

        macro_rules! bail {
            ($e:expr) => {{
                cleanup(&mut req, &body, success);
                return $e;
            }};
        }

        if arguments.is_empty() {
            bail!(global_this.throw(format_args!(
                "Failed to construct 'Request': 1 argument required, but only 0 present."
            )));
        } else if arguments[0].is_empty_or_undefined_or_null() || !arguments[0].is_cell() {
            bail!(global_this.throw(format_args!(
                "Failed to construct 'Request': expected non-empty string or object, got undefined"
            )));
        }

        let url_or_object = arguments[0];
        let url_or_object_type = url_or_object.js_type();
        let mut fields: EnumSet<Fields> = EnumSet::empty();

        let is_first_argument_a_url =
            // fastest path:
            url_or_object_type.is_string_like() ||
            // slower path:
            url_or_object.as_::<bun_jsc::DOMURL>().is_some();

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
            bail!(global_this.throw(format_args!(
                "Failed to construct 'Request': expected non-empty string or object"
            )));
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
                    if values_to_try.len() == 1 {
                        match request.clone_into(&mut req, global_this, fields.contains(Fields::Url))
                        {
                            Ok(()) => {}
                            Err(e) => bail!(Err(e)),
                        }
                        success = true;
                        cleanup(&mut req, &body, success);
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
                        match request.body.value() {
                            BodyValue::Null | BodyValue::Empty | BodyValue::Used => {}
                            _ => {
                                match request.body.value().clone(global_this) {
                                    Ok(v) => {
                                        // TODO(port): Arc<BodyValue> mutation
                                        *req.body.value_mut() = v;
                                    }
                                    Err(e) => bail!(Err(e)),
                                }
                                fields.insert(Fields::Body);
                            }
                        }
                    }
                }

                if let Some(response) = value.as_direct::<Response>() {
                    if !fields.contains(Fields::Method) {
                        req.method = response.get_method();
                        fields.insert(Fields::Method);
                    }

                    if !fields.contains(Fields::Headers) {
                        if let Some(headers) = response.get_init_headers() {
                            match headers.clone_this(global_this) {
                                Ok(h) => {
                                    req.headers = Some(h);
                                    fields.insert(Fields::Headers);
                                }
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
                                        // TODO(port): Arc<BodyValue> mutation
                                        *req.body.value_mut() = v;
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
                                // TODO(port): Arc<BodyValue> mutation
                                *req.body.value_mut() = v;
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
                            && match value.implements_to_string(global_this) {
                                Ok(b) => b,
                                Err(e) => bail!(Err(e)),
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
                        if let Some(signal) = AbortSignal::from_js(signal_) {
                            // Keep it alive
                            signal_.ensure_still_alive();
                            req.signal = Some(signal.clone()); // signal.ref()
                        } else {
                            if !global_this.has_exception() {
                                bail!(global_this.throw(format_args!(
                                    "Failed to construct 'Request': signal is not of type AbortSignal."
                                )));
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
                match Response::Init::init(global_this, value) {
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
                match value.get_optional_enum::<FetchRedirect>(global_this, b"redirect") {
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
                match value.get_optional_enum::<FetchCacheMode>(global_this, b"cache") {
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
                match value.get_optional_enum::<FetchRequestMode>(global_this, b"mode") {
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

        if req.url.is_empty() {
            bail!(global_this.throw(format_args!(
                "Failed to construct 'Request': url is required."
            )));
        }

        let href = URL::href_from_string(req.url.clone_ref());
        if href.is_empty() {
            if !global_this.has_exception() {
                // globalThis.throw can cause GC, which could cause the above string to be freed.
                // so we must increment the reference count before calling it.
                bail!(global_this
                    .err_invalid_url(format_args!(
                        "Failed to construct 'Request': Invalid URL \"{}\"",
                        req.url
                    ))
                    .throw());
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

        if matches!(req.body.value(), BodyValue::Blob(_))
            && req.headers.is_some()
        {
            if let BodyValue::Blob(blob) = req.body.value() {
                if !blob.content_type.is_empty()
                    && !req
                        .headers
                        .as_ref()
                        .unwrap()
                        .fast_has(FetchHeaders::HeaderName::ContentType)
                {
                    let ct = blob.content_type.clone();
                    // PORT NOTE: reshaped for borrowck — split borrow of req.body and req.headers
                    match req.headers.as_ref().unwrap().put(
                        FetchHeaders::HeaderName::ContentType,
                        &ct,
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

        cleanup(&mut req, &body, success);
        Ok(req)
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<Request>> {
        let arguments_ = callframe.arguments_old(2);
        let arguments = &arguments_.ptr[0..arguments_.len];

        let request = Self::construct_into(global_this, arguments, this_value)?;
        Ok(Request::new(request))
    }

    pub fn get_body_value(&mut self) -> &mut BodyValue {
        // TODO(port): Arc<BodyValue> mutation — see field note
        self.body.value_mut()
    }

    #[bun_jsc::host_fn(method)]
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
            if let Some(cloned_stream) = js::gc::stream::get(js_wrapper) {
                js::body_set_cached(js_wrapper, global_this, cloned_stream);
            }
        }

        // Update the original request's body cache with the new teed stream.
        // At this point, this.#body.value.Locked.readable still holds the teed stream
        // because checkBodyStreamRef hasn't been called on the original request yet.
        if let BodyValue::Locked(locked) = self.body.value() {
            if let Some(readable) = locked.readable.get(global_this) {
                js::body_set_cached(this_value, global_this, readable.value);
            }
        }

        self.check_body_stream_ref(global_this);
        Ok(js_wrapper)
    }

    // Returns if the request has headers already cached/set.
    pub fn has_fetch_headers(&self) -> bool {
        self.headers.is_some()
    }

    /// Sets the headers of the request. This will take ownership of the headers.
    /// it will deref the previous headers if they exist.
    pub fn set_fetch_headers(&mut self, headers: Option<Arc<FetchHeaders>>) {
        // old_headers.deref() → handled by Arc Drop on assignment
        self.headers = headers;
    }

    /// Returns the headers of the request. If the headers are not already cached, it will create a new FetchHeaders object.
    /// If the headers are empty, it will look at request_context to get the headers.
    /// If the headers are empty and request_context is null, it will create an empty FetchHeaders object.
    pub fn ensure_fetch_headers(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> JsResult<Arc<FetchHeaders>> {
        if let Some(headers) = &self.headers {
            // headers is already set
            return Ok(headers.clone());
        }

        if let Some(req) = self.request_context.get_request() {
            // we have a request context, so we can get the headers from it
            self.headers = Some(FetchHeaders::create_from_uws(req));
        } else {
            // we don't have a request context, so we need to create an empty headers object
            self.headers = Some(FetchHeaders::create_empty());
            let content_type: Option<&[u8]> = match self.body.value() {
                BodyValue::Blob(blob) => Some(&blob.content_type),
                BodyValue::Locked(locked) => {
                    if let Some(readable) = locked.readable.get(global_this) {
                        match &readable.ptr {
                            body::ReadablePtr::Blob(blob) => Some(&blob.content_type),
                            _ => None,
                        }
                    } else {
                        None
                    }
                }
                _ => None,
            };

            if let Some(content_type_) = content_type {
                if !content_type_.is_empty() {
                    self.headers.as_ref().unwrap().put(
                        FetchHeaders::HeaderName::ContentType,
                        content_type_,
                        global_this,
                    )?;
                }
            }
        }

        Ok(self.headers.as_ref().unwrap().clone())
    }

    pub fn get_fetch_headers_unless_empty(&mut self) -> Option<Arc<FetchHeaders>> {
        if self.headers.is_none() {
            if let Some(req) = self.request_context.get_request() {
                // we have a request context, so we can get the headers from it
                self.headers = Some(FetchHeaders::create_from_uws(req));
            }
        }

        let headers = self.headers.as_ref()?;
        if headers.is_empty() {
            return None;
        }
        Some(headers.clone())
    }

    /// Returns the headers of the request. This will not look at the request contex to get the headers.
    pub fn get_fetch_headers(&self) -> Option<Arc<FetchHeaders>> {
        self.headers.clone()
    }

    /// This should only be called by the JS code. use getFetchHeaders to get the current headers or ensureFetchHeaders to get the headers and create them if they don't exist.
    #[bun_jsc::host_fn(getter)]
    pub fn get_headers(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(self.ensure_fetch_headers(global_this)?.to_js(global_this))
    }

    pub fn clone_headers(
        &mut self,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<Arc<FetchHeaders>>> {
        if self.headers.is_none() {
            if let Some(uws_req) = self.request_context.get_request() {
                self.headers = Some(FetchHeaders::create_from_uws(uws_req));
            }
        }

        if let Some(head) = &self.headers {
            if head.is_empty() {
                return Ok(None);
            }

            return Ok(Some(head.clone_this(global_this)?));
        }

        Ok(None)
    }

    pub fn clone_into(
        &mut self,
        req: &mut Request,
        global_this: &JSGlobalObject,
        preserve_url: bool,
    ) -> JsResult<()> {
        // allocator param dropped (global mimalloc)
        let _ = self.ensure_url();
        let vm = global_this.bun_vm();
        let mut body_ = 'brk: {
            if let Some(js_ref) = self.js_ref.try_get() {
                if let Some(stream) = js::gc::stream::get(js_ref) {
                    let mut readable = ReadableStream::from_js(stream, global_this)?;
                    if let Some(r) = readable.as_mut() {
                        break 'brk self.body.value().clone_with_readable_stream(global_this, r)?;
                    }
                }
            }

            break 'brk self.body.value().clone(global_this)?;
        };
        // errdefer body_.deinit() → deleted; BodyValue: Drop frees on `?` error path
        let body = vm.init_request_body_value(body_)?;
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
            weak_ptr_data: WeakPtrData::empty(),
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
        // TODO(port): Zig does `Request.new(undefined)` then clone_into writes the whole struct.
        // Rust cannot construct an `undefined` Request safely; use MaybeUninit and write in place.
        let mut req: Box<core::mem::MaybeUninit<Request>> = Box::new_uninit();
        // errdefer bun.destroy(req) → Box drops on error path automatically
        // SAFETY: clone_into fully initializes *req via `*req = Request { ... }` before reading
        // any field. We pass &mut to a zeroed/uninit slot; on error the Box<MaybeUninit> drops
        // without running Request's Drop.
        let req_mut = unsafe { &mut *req.as_mut_ptr() };
        self.clone_into(req_mut, global_this, false)?;
        // SAFETY: clone_into succeeded → req is fully initialized
        Ok(unsafe { req.assume_init() })
    }

    pub fn set_timeout(&mut self, seconds: c_uint) {
        let _ = self.request_context.set_timeout(seconds);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/Request.zig (1115 lines)
//   confidence: medium
//   todos:      25
//   notes:      Arc<BodyValue> (per LIFETIMES.tsv) needs interior mutability — Zig mutates #body.value in place; construct_into defer-cleanup reshaped to macro+closure (verify error paths); Flags kept unpacked for field-access parity.
// ──────────────────────────────────────────────────────────────────────────
