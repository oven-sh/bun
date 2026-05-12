//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.

use core::cell::Cell;
use core::mem::size_of;

use bun_core::Error;
use bun_http::headers::api::StringPointer;
use bun_http::headers::append_etag;
use bun_http::{Headers, Method};
use bun_http_types::ETag;

use bun_http_types::MimeType::MimeType;
use bun_jsc::{HTTPHeaderName, JsClass};
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::server::{AnyServer, write_status};
use crate::webcore::BlobExt as _;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::headers_ref::any_blob_content_type;
use crate::webcore::{AnyBlob, FetchHeaders, InternalBlob, Response};

// bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — single-thread refcount.
// PORT NOTE (§Pointers): `*StaticRoute` is also passed as uws onAborted/
// onWritable userdata; the intrusive `ref_count` Cell + `*mut Self` receivers
// preserve write provenance through the FFI userdata round-trip so the eventual
// `heap::take` in `deref_` is sound.
#[derive(bun_ptr::CellRefCounted)]
pub struct StaticRoute {
    // TODO: Remove optional. StaticRoute requires a server object or else it will
    // not ensure it is alive while sending a large blob.
    // `pub(super)` so sibling route modules (HTMLBundle) can construct directly
    // (Zig `bun.new(StaticRoute, .{ .ref_count = .init(), ... })`).
    pub(super) ref_count: Cell<u32>,
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
    // pub const ref / deref — intrusive refcount accessors.
    // `ref_()`/`deref()` are provided by `#[derive(CellRefCounted)]`; `deref_`
    // is kept as a thin alias so existing call sites (and Zig parity) keep
    // working without renaming.
    /// # Safety
    /// `this` must have been produced by `heap::alloc` in one of the
    /// constructors below (write provenance preserved through FFI userdata
    /// round-trips). Caller must not hold any live `&`/`&mut` to `*this` across
    /// this call when the refcount may reach zero.
    #[inline]
    pub unsafe fn deref_(this: *mut Self) {
        // SAFETY: forwarded caller contract — see `CellRefCounted::deref`.
        unsafe { <Self as bun_ptr::CellRefCounted>::deref(this) }
    }

    /// Ownership of `blob` is transferred to this function.
    // PORT NOTE: Zig takes `*const AnyBlob` and bit-copies (`blob.*`) into the
    // route, relying on no-auto-drop. Rust `AnyBlob` has drop glue (e.g.
    // `InternalBlob.bytes: Vec<u8>`), so a `&AnyBlob` + `ptr::read` would alias
    // and double-free when the caller's value drops. Take by value instead.
    pub fn init_from_any_blob(
        blob: AnyBlob,
        options: InitFromBytesOptions<'_>,
    ) -> *mut StaticRoute {
        let mut headers = bun_http_jsc::headers_jsc::from_fetch_headers(
            options.headers,
            any_blob_content_type(&blob),
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
                append_etag(blob.slice(), &mut headers);
            }
        }

        let cached_blob_size = blob.size();
        bun_core::heap::into_raw(Box::new(StaticRoute {
            ref_count: Cell::new(1),
            blob,
            cached_blob_size,
            has_content_disposition: false,
            headers,
            server: Cell::new(options.server),
            status_code: options.status_code,
        }))
    }

    /// Create a static route to be used on a single response, freeing the bytes once sent.
    pub fn send_blob_then_deinit(
        resp: AnyResponse,
        blob: AnyBlob,
        options: InitFromBytesOptions<'_>,
    ) {
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
        let duped = blob.dupe();
        self.blob = AnyBlob::Blob(blob);

        Ok(bun_core::heap::into_raw(Box::new(StaticRoute {
            ref_count: Cell::new(1),
            blob: AnyBlob::Blob(duped),
            cached_blob_size: self.cached_blob_size,
            has_content_disposition: self.has_content_disposition,
            headers: self.headers.clone(),
            server: Cell::new(self.server.get()),
            status_code: self.status_code,
        })))
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<StaticRoute>() + self.blob.memory_cost() + self.headers.memory_cost()
    }

    pub fn from_js(
        global_this: &JSGlobalObject,
        argument: JSValue,
    ) -> JsResult<Option<*mut StaticRoute>> {
        // `as_class_ref` is the safe shared-borrow downcast (one audited
        // unsafe in `JSValue`); every `Response` accessor used below takes
        // `&self` (interior mutability for `body`), so no `&mut` is needed.
        if let Some(response) = argument.as_class_ref::<Response>() {
            // The user may want to pass in the same Response object multiple endpoints
            // Let's let them do that.
            let body_value = response.get_body_value();
            let was_string = body_value.was_string();
            body_value.to_blob_if_possible();

            let mut blob: AnyBlob = 'brk: {
                match body_value {
                    BodyValue::Used => {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Response body has already been used"
                        )));
                    }

                    BodyValue::Null | BodyValue::Empty => {
                        break 'brk AnyBlob::InternalBlob(InternalBlob {
                            bytes: Vec::<u8>::new(),
                            was_string: false,
                        });
                    }

                    BodyValue::Blob(_)
                    | BodyValue::InternalBlob(_)
                    | BodyValue::WTFStringImpl(_) => {
                        if let BodyValue::Blob(b) = &*body_value {
                            if b.needs_to_read_file() {
                                return Err(global_this
                                    .throw_todo(b"TODO: support Bun.file(path) in static routes"));
                            }
                        }
                        let mut blob = body_value.use_();
                        blob.global_this
                            .set(std::ptr::from_ref::<JSGlobalObject>(global_this));
                        debug_assert!(
                            !blob.is_heap_allocated(),
                            "expected blob not to be heap-allocated",
                        );
                        *body_value = BodyValue::Blob(blob.dupe());

                        break 'brk AnyBlob::Blob(blob);
                    }

                    _ => {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Body must be fully buffered before it can be used in a static route. Consider calling new Response(await response.blob()) to buffer the body."
                        )));
                    }
                }
            };

            let mut has_content_disposition = false;

            if let Some(h) = response.get_init_headers_mut() {
                has_content_disposition = h.fast_has(HTTPHeaderName::ContentDisposition);
                h.fast_remove(HTTPHeaderName::TransferEncoding);
                h.fast_remove(HTTPHeaderName::ContentLength);
            }

            let mut headers: Headers = if let Some(h) = response.get_init_headers() {
                bun_http_jsc::headers_jsc::from_fetch_headers(Some(h), any_blob_content_type(&blob))
            } else {
                Headers::default()
            };

            if was_string && headers.get_content_type().is_none() {
                headers.append(b"Content-Type", b"text/plain; charset=utf-8");
            }

            // Generate ETag if not already present
            if headers.get(b"etag").is_none() {
                if !blob.slice().is_empty() {
                    append_etag(blob.slice(), &mut headers);
                }
            }

            let cached_blob_size = blob.size();
            return Ok(Some(bun_core::heap::into_raw(Box::new(StaticRoute {
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
    pub unsafe fn on_head_request(this: *mut Self, mut req: AnyRequest, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
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
    pub unsafe fn on_get(this: *mut Self, mut req: AnyRequest, resp: AnyResponse) {
        // SAFETY: caller contract.
        unsafe {
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
    /// so the eventual `heap::take` in `deref_` is sound.
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
            AnyResponse::SSL(r) => write_status::<true>(r, status),
            AnyResponse::TCP(r) => write_status::<false>(r, status),
            AnyResponse::H3(r) => {
                let mut b = bun_core::fmt::ItoaBuf::new();
                let s = bun_core::fmt::itoa(&mut b, status);
                // S008: `h3::Response` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(r).write_status(s);
            }
        }
    }

    fn do_write_headers(&self, resp: AnyResponse) {
        use bun_http_types::ETag::HeaderEntryColumns;
        let entries = self.headers.entries.slice();
        let names: &[StringPointer] = entries.items_name();
        let values: &[StringPointer] = entries.items_value();
        let buf = self.headers.buf.as_slice();

        debug_assert_eq!(names.len(), values.len());
        for (name, value) in names.iter().zip(values) {
            resp.write_header(
                &buf[name.offset as usize..][..name.length as usize],
                &buf[value.offset as usize..][..value.length as usize],
            );
        }
        // Zig: `if (comptime tag != .H3) ... s.writeHeader("alt-svc", alt)`.
        if !matches!(resp, AnyResponse::H3(_)) {
            if let Some(srv) = self.server.get() {
                if let Some(alt) = srv.h3_alt_svc() {
                    resp.write_header(b"alt-svc", alt);
                }
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
    unsafe fn render_304_not_modified_if_none_match(
        this: *mut Self,
        req: &mut AnyRequest,
        resp: AnyResponse,
    ) -> bool {
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
            req.set_yield(false);
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
    }
}
