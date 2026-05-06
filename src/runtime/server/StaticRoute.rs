//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.

use core::cell::Cell;
use core::mem::size_of;

use bun_http::Headers;
use bun_http_types::MimeType::MimeType;
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::server::AnyServer;
use crate::webcore::{AnyBlob, FetchHeaders};

// bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — single-thread refcount.
// PORT NOTE (§Pointers Rc/Arc default): owned via `Rc<StaticRoute>` from
// `AnyRoute`. `*StaticRoute` is also passed as uws onAborted/onWritable
// userdata; if cargo-check shows FFI breakage, swap to `bun_ptr::RefPtr` and
// `impl RefCounted`. ref_count Cell kept for now so the on()/send paths can
// bump locally without `Rc::clone` churn.
pub struct StaticRoute {
    // TODO: Remove optional. StaticRoute requires a server object or else it will
    // not ensure it is alive while sending a large blob.
    ref_count: Cell<u32>,
    pub server: Cell<Option<AnyServer>>,
    pub status_code: u16,
    pub blob: AnyBlob,
    pub cached_blob_size: u64,
    pub has_content_disposition: bool,
    pub headers: Headers,
}

pub struct InitFromBytesOptions<'a> {
    pub server: Option<AnyServer>,
    pub mime_type: Option<&'a MimeType>,
    pub status_code: u16,
    pub headers: Option<&'a FetchHeaders>,
}

impl<'a> Default for InitFromBytesOptions<'a> {
    fn default() -> Self {
        Self {
            server: None,
            mime_type: None,
            status_code: 200,
            headers: None,
        }
    }
}

impl StaticRoute {
    pub fn memory_cost(&self) -> usize {
        size_of::<StaticRoute>() + self.blob.memory_cost() + self.headers.memory_cost()
    }
}

// ─── route-handler bodies (gated) ────────────────────────────────────────────
// init_from_any_blob / from_js / clone need: Headers::from(body=..),
// AnyBlob::{to_blob, dupe, content_type, slice}, ETag::append_to_headers,
// JSValue::as_::<Response>.
// on / on_head_request / on_response / send need: bun_uws AnyResponse
// write/end/on_writable/on_aborted (cycle-5-B), HTTPStatusText, RangeRequest.
// TODO(b2-blocked): bun_jsc + bun_uws response write surface.

mod _gated {
use super::*;
use bun_core::Error;
use bun_http::Method;
use bun_http_types::ETag;
use bun_http_types::ETag::{HeaderEntryField, StringPointer};
use crate::server::write_status;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::blob::Blob;
use crate::webcore::Response;

// ─── local cycle-break shims ─────────────────────────────────────────────────
// `bun_http::Headers::from` takes vtable-erased refs (`FetchHeadersRef` /
// `AnyBlobRef`) because http (T5) cannot depend on runtime (T6). Build the
// vtables here from the concrete `FetchHeaders` / `AnyBlob` types.

unsafe fn fh_count(owner: *const (), header_count: &mut u32, buf_len: &mut u32) {
    // SAFETY: `owner` is `&FetchHeaders` erased; `count` mutates only internal
    // scratch state on the C++ side, hence the const→mut cast.
    unsafe { (*(owner as *mut FetchHeaders)).count(header_count, buf_len) }
}
unsafe fn fh_fast_has(owner: *const (), _name: bun_http::headers::HeaderName) -> bool {
    // SAFETY: see `fh_count`. Only ever called with HeaderName::ContentType
    // (see Headers::from).
    unsafe { (*(owner as *mut FetchHeaders)).fast_has(HttpHeader::ContentType) }
}
unsafe fn fh_copy_to(
    owner: *const (),
    names: *mut StringPointer,
    values: *mut StringPointer,
    buf: *mut u8,
) {
    // SAFETY: see `fh_count`. `bun_http_types::ETag::StringPointer` and
    // `bun_string::StringPointer` are both `#[repr(C)] {u32,u32}`.
    unsafe { (*(owner as *mut FetchHeaders)).copy_to(names.cast(), values.cast(), buf) }
}

static FETCH_HEADERS_VTABLE: bun_http::headers::FetchHeadersVTable =
    bun_http::headers::FetchHeadersVTable {
        count: fh_count,
        fast_has: fh_fast_has,
        copy_to: fh_copy_to,
    };

#[inline]
fn fetch_headers_ref(h: &FetchHeaders) -> bun_http::headers::FetchHeadersRef<'_> {
    bun_http::headers::FetchHeadersRef {
        owner: h as *const FetchHeaders as *const (),
        vtable: &FETCH_HEADERS_VTABLE,
        _phantom: core::marker::PhantomData,
    }
}

unsafe fn ab_has_content_type_from_user(owner: *const ()) -> bool {
    // SAFETY: `owner` is `&AnyBlob` erased.
    unsafe { (*(owner as *const AnyBlob)).has_content_type_from_user() }
}
unsafe fn ab_content_type(owner: *const ()) -> (*const u8, usize) {
    // SAFETY: `owner` is `&AnyBlob` erased; the returned slice borrows blob
    // storage that outlives the `AnyBlobRef`.
    let s = unsafe { (*(owner as *const AnyBlob)).content_type() };
    (s.as_ptr(), s.len())
}

static ANY_BLOB_VTABLE: bun_http::headers::AnyBlobVTable = bun_http::headers::AnyBlobVTable {
    has_content_type_from_user: ab_has_content_type_from_user,
    content_type: ab_content_type,
};

#[inline]
fn any_blob_ref(b: &AnyBlob) -> bun_http::headers::AnyBlobRef<'_> {
    bun_http::headers::AnyBlobRef {
        owner: b as *const AnyBlob as *const (),
        vtable: &ANY_BLOB_VTABLE,
        _phantom: core::marker::PhantomData,
    }
}

/// Local mirror of `bun_http_types::ETag::append_to_headers` that targets
/// `bun_http::Headers` (the upstream version takes the http_types-local
/// `Headers` placeholder, which is a distinct type).
fn append_etag_to_headers(bytes: &[u8], headers: &mut Headers) {
    let hash: u64 = bun_core::hash::xxhash64(0, bytes);
    let mut etag_buf = [0u8; 40];
    let len = {
        use std::io::Write;
        let mut cursor = &mut etag_buf[..];
        write!(cursor, "\"{:016x}\"", hash).expect("unreachable");
        40 - cursor.len()
    };
    headers.append(b"etag", &etag_buf[..len]);
}

/// `bun_uws::AnyRequest` only exposes `header()`; add the rest here as a local
/// extension trait dispatching to the underlying `uws_sys` request types.
trait AnyRequestExt {
    fn set_yield(&mut self, y: bool);
    fn method(&self) -> &[u8];
}

impl AnyRequestExt for AnyRequest {
    fn set_yield(&mut self, y: bool) {
        // SAFETY: variant pointers are non-null FFI handles owned by uWS for
        // the duration of the request callback (see `AnyRequest::header`).
        match self {
            AnyRequest::H1(r) => unsafe { (**r).set_yield(y) },
            AnyRequest::H3(r) => unsafe { (**r).set_yield(y) },
        }
    }
    fn method(&self) -> &[u8] {
        // SAFETY: see `set_yield`.
        match self {
            AnyRequest::H1(r) => unsafe { (**r).method() },
            AnyRequest::H3(r) => unsafe { (**r).method() },
        }
    }
}

// ─── blocked shims (duplicate inherent methods upstream) ─────────────────────
// `webcore::blob::Blob` currently has two `dupe` and two `needs_to_read_file`
// inherent impls; method-call syntax is E0034-ambiguous and UFCS cannot
// disambiguate same-type duplicates. Shim until Blob.rs is deduped.
#[inline]
fn blob_dupe(_b: &Blob) -> Blob {
    todo!("blocked_on: webcore::blob::Blob::dupe (duplicate inherent impl)")
}
#[inline]
fn blob_needs_to_read_file(_b: &Blob) -> bool {
    todo!("blocked_on: webcore::blob::Blob::needs_to_read_file (duplicate inherent impl)")
}
/// `Response` does not yet implement `bun_jsc::JsClass`; downcast stub.
#[inline]
fn response_from_js(_value: JSValue) -> Option<*mut Response> {
    todo!("blocked_on: bun_jsc::JsClass for webcore::Response")
}

impl StaticRoute {
    // pub const ref / deref — intrusive refcount accessors.
    // `ref` is a Rust keyword; use ref_/deref_ on &self for parity with Zig call sites.
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// # Safety
    /// `this` must have been produced by `Box::into_raw` in one of the constructors
    /// below (write provenance preserved through FFI userdata round-trips). Caller
    /// must not hold any live `&`/`&mut` to `*this` across this call when the
    /// refcount may reach zero.
    pub unsafe fn deref_(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and uniquely held when n→0.
        unsafe {
            let n = (*this).ref_count.get() - 1;
            (*this).ref_count.set(n);
            if n == 0 {
                // ref_count hit zero; `this` was created via Box::into_raw and
                // retains write provenance (no `&self` in the chain), so
                // reconstituting the Box and dropping it is sound.
                drop(Box::from_raw(this));
            }
        }
    }

    /// Ownership of `blob` is transferred to this function.
    pub fn init_from_any_blob(blob: &AnyBlob, options: InitFromBytesOptions<'_>) -> *mut StaticRoute {
        let mut headers = Headers::from(
            options.headers.map(fetch_headers_ref),
            HeadersFromOptions { body: Some(any_blob_ref(blob)) },
        );
        if headers.get_content_type().is_none() {
            if let Some(mime_type) = options.mime_type {
                headers.append(b"Content-Type", &mime_type.value);
            } else if blob.has_content_type_from_user() {
                headers.append(b"Content-Type", blob.content_type());
            }
        }

        // Generate ETag if not already present
        if headers.get(b"etag").is_none() {
            if !blob.slice().is_empty() {
                append_etag_to_headers(blob.slice(), &mut headers);
            }
        }

        let cached_blob_size = blob.size();
        Box::into_raw(Box::new(StaticRoute {
            ref_count: Cell::new(1),
            // SAFETY: doc-contract — ownership of `*blob` is transferred to this
            // function (Zig: `blob.*` struct copy); caller must not use it again.
            blob: unsafe { core::ptr::read(blob) },
            cached_blob_size,
            has_content_disposition: false,
            headers,
            server: Cell::new(options.server),
            status_code: options.status_code,
        }))
    }

    /// Create a static route to be used on a single response, freeing the bytes once sent.
    pub fn send_blob_then_deinit(resp: AnyResponse, blob: &AnyBlob, options: InitFromBytesOptions<'_>) {
        let temp_route = StaticRoute::init_from_any_blob(blob, options);
        // SAFETY: init_from_any_blob returns a freshly boxed StaticRoute (ref_count=1)
        // with write provenance; on()/deref_() consume it via that same *mut.
        unsafe {
            StaticRoute::on(temp_route, resp);
            StaticRoute::deref_(temp_route);
        }
    }

    pub fn clone(&mut self, global_this: &JSGlobalObject) -> Result<*mut StaticRoute, Error> {
        let blob = self.blob.to_blob(global_this);
        let duped = blob_dupe(&blob);
        self.blob = AnyBlob::Blob(blob);

        Ok(Box::into_raw(Box::new(StaticRoute {
            ref_count: Cell::new(1),
            blob: AnyBlob::Blob(duped),
            cached_blob_size: self.cached_blob_size,
            has_content_disposition: self.has_content_disposition,
            headers: self.headers.clone(),
            server: Cell::new(self.server.get()),
            status_code: self.status_code,
        })))
    }

    pub fn from_js(global_this: &JSGlobalObject, argument: JSValue) -> JsResult<Option<*mut StaticRoute>> {
        if let Some(response_ptr) = response_from_js(argument) {
            // SAFETY: `response_from_js` returns a live JSC-owned Response cell
            // valid for the duration of this call (GC cannot run mid-function).
            let response = unsafe { &mut *response_ptr };

            // The user may want to pass in the same Response object multiple endpoints
            // Let's let them do that.
            let body_value = response.get_body_value();
            let was_string = body_value.was_string();
            body_value.to_blob_if_possible();

            let mut blob: AnyBlob = 'brk: {
                match &*body_value {
                    BodyValue::Used => {
                        return Err(global_this
                            .throw_invalid_arguments("Response body has already been used"));
                    }

                    BodyValue::Null | BodyValue::Empty => {
                        break 'brk AnyBlob::InternalBlob(InternalBlob {
                            bytes: Vec::<u8>::new(),
                            was_string: false,
                        });
                    }

                    BodyValue::Blob(_) | BodyValue::InternalBlob(_) | BodyValue::WTFStringImpl(_) => {
                        if let BodyValue::Blob(b) = &*body_value {
                            if blob_needs_to_read_file(b) {
                                return Err(global_this
                                    .throw_todo("TODO: support Bun.file(path) in static routes"));
                            }
                        }
                        let mut blob = body_value.use_();
                        blob.global_this = global_this as *const JSGlobalObject;
                        debug_assert!(
                            !blob.is_heap_allocated(),
                            "expected blob not to be heap-allocated",
                        );
                        *body_value = BodyValue::Blob(blob_dupe(&blob));

                        break 'brk AnyBlob::Blob(blob);
                    }

                    _ => {
                        return Err(global_this.throw_invalid_arguments(
                            "Body must be fully buffered before it can be used in a static route. Consider calling new Response(await response.blob()) to buffer the body.",
                        ));
                    }
                }
            };

            let mut has_content_disposition = false;

            if let Some(h) = response.get_init_headers() {
                // SAFETY: `fast_has`/`fast_remove` mutate C++-side state; the
                // `&FetchHeaders` borrow is the only handle and the underlying
                // object is not aliased elsewhere during this call.
                let h = unsafe { &mut *(h as *const FetchHeaders as *mut FetchHeaders) };
                has_content_disposition = h.fast_has(HttpHeader::ContentDisposition);
                h.fast_remove(HttpHeader::TransferEncoding);
                h.fast_remove(HttpHeader::ContentLength);
            }

            let mut headers: Headers = if let Some(h) = response.get_init_headers() {
                Headers::from(
                    Some(fetch_headers_ref(h)),
                    HeadersFromOptions { body: Some(any_blob_ref(&blob)) },
                )
            } else {
                Headers::default()
            };

            if was_string && headers.get_content_type().is_none() {
                headers.append(
                    b"Content-Type",
                    &bun_http_types::MimeType::TEXT.value,
                );
            }

            // Generate ETag if not already present
            if headers.get(b"etag").is_none() {
                if !blob.slice().is_empty() {
                    append_etag_to_headers(blob.slice(), &mut headers);
                }
            }

            let cached_blob_size = blob.size();
            return Ok(Some(Box::into_raw(Box::new(StaticRoute {
                ref_count: Cell::new(1),
                blob,
                cached_blob_size,
                has_content_disposition,
                headers,
                server: Cell::new(None),
                status_code: response.status_code(),
            }))));
        }

        Ok(None)
    }

    // HEAD requests have no body.
    /// # Safety
    /// `this` must point to a live heap-allocated `StaticRoute` produced by one of
    /// the constructors (write provenance intact). Mirrors Zig `*StaticRoute` receiver.
    pub unsafe fn on_head_request(this: *mut Self, req: AnyRequest, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
            let mut req = req;
            // Check If-None-Match for HEAD requests with 200 status
            if (*this).status_code == 200 {
                if Self::render_304_not_modified_if_none_match(this, &mut req, resp) {
                    return;
                }
            }

            // Continue with normal HEAD request handling
            req.set_yield(false);
            Self::on_head(this, resp);
        }
    }

    /// # Safety
    /// See [`on_head_request`].
    pub unsafe fn on_head(this: *mut Self, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
            debug_assert!((*this).server.get().is_some());
            (*this).ref_();
            if let Some(mut server) = (*this).server.get() {
                server.on_pending_request();
                resp.timeout(server.config().idle_timeout);
            }
            resp.corked(|| (*this).render_metadata_and_end(resp));
            Self::on_response_complete(this, resp);
        }
    }

    fn render_metadata_and_end(&self, resp: AnyResponse) {
        self.render_metadata(resp);
        resp.write_header_int(b"Content-Length", self.cached_blob_size);
        resp.end_without_body(resp.should_close_connection());
    }

    /// # Safety
    /// See [`on_head_request`].
    pub unsafe fn on_request(this: *mut Self, req: AnyRequest, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
            let method = Method::find(req.method()).unwrap_or(Method::GET);
            if method == Method::GET {
                Self::on_get(this, req, resp);
            } else if method == Method::HEAD {
                Self::on_head_request(this, req, resp);
            } else {
                // For other methods, use the original behavior
                let mut req = req;
                req.set_yield(false);
                Self::on(this, resp);
            }
        }
    }

    /// # Safety
    /// See [`on_head_request`].
    pub unsafe fn on_get(this: *mut Self, req: AnyRequest, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
            let mut req = req;
            // Check If-None-Match for GET requests with 200 status
            if (*this).status_code == 200 {
                if Self::render_304_not_modified_if_none_match(this, &mut req, resp) {
                    return;
                }
            }

            // Continue with normal GET request handling
            req.set_yield(false);
            Self::on(this, resp);
        }
    }

    /// # Safety
    /// See [`on_head_request`].
    pub unsafe fn on(this: *mut Self, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
            debug_assert!((*this).server.get().is_some());
            (*this).ref_();
            if let Some(mut server) = (*this).server.get() {
                server.on_pending_request();
                resp.timeout(server.config().idle_timeout);
            }
            let mut finished = false;
            (*this).do_render_blob(resp, &mut finished);
            if finished {
                Self::on_response_complete(this, resp);
                return;
            }

            Self::to_async(this, resp);
        }
    }

    /// # Safety
    /// `this` has ref_count >= 1 held until `on_response_complete`; uws stores the
    /// raw pointer and calls back on the same thread. Receiving `*mut Self` (rather
    /// than `&self`) preserves write provenance through the FFI userdata round-trip
    /// so the eventual `Box::from_raw` in `deref_` is sound.
    unsafe fn to_async(this: *mut Self, resp: AnyResponse) {
        resp.on_aborted(
            |this: *mut StaticRoute, resp| {
                // SAFETY: uws invokes with the same userdata pointer registered
                // below, on the same thread, while the route holds a ref.
                unsafe { Self::on_aborted(this, resp) }
            },
            this,
        );
        resp.on_writable(
            |this: *mut StaticRoute, off, resp| {
                // SAFETY: see on_aborted closure above.
                unsafe { Self::on_writable(this, off, resp) }
            },
            this,
        );
    }

    /// # Safety
    /// uws callback: `this` is the userdata registered in `to_async`.
    unsafe fn on_aborted(this: *mut Self, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe { Self::on_response_complete(this, resp) };
    }

    /// # Safety
    /// `this` must be a live heap-allocated route with write provenance; may free
    /// `*this` via `deref_` when the refcount reaches zero.
    unsafe fn on_response_complete(this: *mut Self, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
            resp.clear_aborted();
            resp.clear_on_writable();
            resp.clear_timeout();
            if let Some(mut server) = (*this).server.get() {
                server.on_static_request_complete();
            }
            Self::deref_(this);
        }
    }

    fn do_render_blob(&self, resp: AnyResponse, did_finish: &mut bool) {
        // We are not corked
        // The body is small
        // Faster to do the memcpy than to do the two network calls
        // We are not streaming
        // This is an important performance optimization
        if self.blob.fast_size() < 16384 - 1024 {
            resp.corked(|| self.do_render_blob_corked(resp, did_finish));
        } else {
            self.do_render_blob_corked(resp, did_finish);
        }
    }

    fn do_render_blob_corked(&self, resp: AnyResponse, did_finish: &mut bool) {
        self.render_metadata(resp);
        self.render_bytes(resp, did_finish);
    }

    /// # Safety
    /// uws callback: `this` is the userdata registered in `to_async`.
    unsafe fn on_writable(this: *mut Self, write_offset: u64, resp: AnyResponse) -> bool {
        // SAFETY: caller contract.
        unsafe {
            if let Some(server) = (*this).server.get() {
                resp.timeout(server.config().idle_timeout);
            }

            if !(*this).on_writable_bytes(write_offset, resp) {
                return false;
            }

            Self::on_response_complete(this, resp);
            true
        }
    }

    fn on_writable_bytes(&self, write_offset: u64, resp: AnyResponse) -> bool {
        let blob = &self.blob;
        let all_bytes = blob.slice();

        let off = usize::try_from((all_bytes.len() as u64).min(write_offset)).unwrap();
        let bytes = &all_bytes[off..];

        resp.try_end(bytes, all_bytes.len(), resp.should_close_connection())
    }

    fn do_write_status(&self, status: u16, resp: AnyResponse) {
        match resp {
            // SAFETY: variant pointers are non-null live uWS response handles
            // for the duration of the request callback.
            AnyResponse::SSL(r) => write_status::<true>(unsafe { &mut *r }, status),
            AnyResponse::TCP(r) => write_status::<false>(unsafe { &mut *r }, status),
            AnyResponse::H3(r) => {
                use std::io::Write;
                let mut b = [0u8; 16];
                let mut cursor: &mut [u8] = &mut b[..];
                write!(cursor, "{}", status).expect("unreachable");
                let written = 16 - cursor.len();
                // SAFETY: see above.
                unsafe { (*r).write_status(&b[..written]) };
            }
        }
    }

    fn do_write_headers(&self, resp: AnyResponse) {
        // Zig: switch (resp) { inline else => |s, tag| { ... } } — expanded per arm.
        let entries = self.headers.entries.slice();
        // SAFETY: `HeaderEntry` columns are both `StringPointer` (see
        // `bun_http_types::ETag::HeaderEntry` MultiArrayElement impl).
        let names: &[StringPointer] =
            unsafe { entries.items::<StringPointer>(HeaderEntryField::Name) };
        let values: &[StringPointer] =
            unsafe { entries.items::<StringPointer>(HeaderEntryField::Value) };
        let buf = self.headers.buf.as_slice();

        #[inline]
        fn sp_slice(ptr: &StringPointer, buf: &[u8]) -> *const [u8] {
            &buf[ptr.offset as usize..][..ptr.length as usize]
        }

        match resp {
            // SAFETY: variant pointers are non-null live uWS response handles
            // for the duration of the request callback.
            AnyResponse::SSL(s) => {
                let s = unsafe { &mut *s };
                debug_assert_eq!(names.len(), values.len());
                for (name, value) in names.iter().zip(values) {
                    // SAFETY: sp_slice returns a borrow of `buf` which is live.
                    s.write_header(unsafe { &*sp_slice(name, buf) }, unsafe {
                        &*sp_slice(value, buf)
                    });
                }
                if let Some(srv) = self.server.get() {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::TCP(s) => {
                let s = unsafe { &mut *s };
                debug_assert_eq!(names.len(), values.len());
                for (name, value) in names.iter().zip(values) {
                    s.write_header(unsafe { &*sp_slice(name, buf) }, unsafe {
                        &*sp_slice(value, buf)
                    });
                }
                if let Some(srv) = self.server.get() {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::H3(s) => {
                let s = unsafe { &mut *s };
                debug_assert_eq!(names.len(), values.len());
                for (name, value) in names.iter().zip(values) {
                    s.write_header(unsafe { &*sp_slice(name, buf) }, unsafe {
                        &*sp_slice(value, buf)
                    });
                }
                // tag == .H3: skip alt-svc
            }
        }
    }

    fn render_bytes(&self, resp: AnyResponse, did_finish: &mut bool) {
        *did_finish = self.on_writable_bytes(0, resp);
    }

    fn render_metadata(&self, resp: AnyResponse) {
        let mut status = self.status_code;
        let size = self.cached_blob_size;

        status = if status == 200 && size == 0 && !self.blob.is_detached() {
            204
        } else {
            status
        };

        self.do_write_status(status, resp);
        self.do_write_headers(resp);
    }

    /// # Safety
    /// See [`on_head_request`].
    pub unsafe fn on_with_method(this: *mut Self, method: Method, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
            match method {
                Method::GET => Self::on(this, resp),
                Method::HEAD => Self::on_head(this, resp),
                _ => {
                    (*this).do_write_status(405, resp); // Method not allowed
                    resp.end_without_body(resp.should_close_connection());
                }
            }
        }
    }

    /// # Safety
    /// See [`on_head_request`]. May free `*this` via `on_response_complete` when it
    /// returns `true`.
    unsafe fn render_304_not_modified_if_none_match(this: *mut Self, req: &AnyRequest, resp: AnyResponse) -> bool {
        // SAFETY: caller contract.
        unsafe {
            let Some(if_none_match) = req.header(b"if-none-match") else {
                return false;
            };
            let Some(etag) = (*this).headers.get(b"etag") else {
                return false;
            };
            if if_none_match.is_empty() || etag.is_empty() {
                return false;
            }

            if !ETag::if_none_match(etag, if_none_match) {
                return false;
            }

            // Return 304 Not Modified
            (*this).ref_();
            if let Some(mut server) = (*this).server.get() {
                server.on_pending_request();
                resp.timeout(server.config().idle_timeout);
            }
            (*this).do_write_status(304, resp);
            (*this).do_write_headers(resp);
            resp.end_without_body(resp.should_close_connection());
            Self::on_response_complete(this, resp);
            true
        }
    }
}

impl Drop for StaticRoute {
    fn drop(&mut self) {
        // Zig deinit: blob.detach() + headers.deinit() + bun.destroy(this).
        // Box drop handles the dealloc; Headers has its own Drop.
        self.blob.detach();
        // headers dropped automatically
    }
}

use crate::webcore::InternalBlob;
use bun_jsc::HTTPHeaderName as HttpHeader;
use bun_http::headers::Options as HeadersFromOptions;
} // mod _gated

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/StaticRoute.zig (409 lines)
//   confidence: medium
//   todos:      6
//   notes:      IntrusiveRc pattern hand-rolled (ref_/deref_); uws callback registration + MultiArrayList accessors + Headers::from signature need Phase B wiring; resp.corked mapped to closure form
// ──────────────────────────────────────────────────────────────────────────
