//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.

use core::cell::Cell;
use core::mem::size_of;

use bun_core::Error;
use bun_http::{ETag, Headers, Method, MimeType};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_ptr::IntrusiveRc;
use bun_schema::api::StringPointer;
use bun_uws::{AnyRequest, AnyResponse};

use crate::api::server::{write_status, AnyServer};
use crate::webcore::body::Value as BodyValue;
use crate::webcore::{AnyBlob, FetchHeaders, Response};

// bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive single-thread refcount.
// `*StaticRoute` crosses FFI (uws onAborted/onWritable context), so IntrusiveRc not Rc.
pub type StaticRouteRc = IntrusiveRc<StaticRoute>;

pub struct StaticRoute {
    // TODO: Remove optional. StaticRoute requires a server object or else it will
    // not ensure it is alive while sending a large blob.
    ref_count: Cell<u32>,
    pub server: Option<AnyServer>,
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
    // `ref` is a Rust keyword; use ref_/deref_ on &self for parity with Zig call sites.
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    pub fn deref_(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: ref_count hit zero; self was created via Box::into_raw in the
            // constructors below and no other live references remain.
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }

    /// Ownership of `blob` is transferred to this function.
    pub fn init_from_any_blob(blob: &AnyBlob, options: InitFromBytesOptions<'_>) -> *mut StaticRoute {
        let mut headers = Headers::from(options.headers, HeadersFromOptions { body: Some(blob) });
        // TODO(port): Headers::from signature — Zig passes allocator + .{ .body = blob }; allocator dropped per §Allocators
        if headers.get_content_type().is_none() {
            if let Some(mime_type) = options.mime_type {
                headers.append(b"Content-Type", mime_type.value);
            } else if blob.has_content_type_from_user() {
                headers.append(b"Content-Type", blob.content_type());
            }
        }

        // Generate ETag if not already present
        if headers.get(b"etag").is_none() {
            if !blob.slice().is_empty() {
                ETag::append_to_headers(blob.slice(), &mut headers);
            }
        }

        Box::into_raw(Box::new(StaticRoute {
            ref_count: Cell::new(1),
            blob: *blob,
            cached_blob_size: blob.size(),
            has_content_disposition: false,
            headers,
            server: options.server,
            status_code: options.status_code,
        }))
    }

    /// Create a static route to be used on a single response, freeing the bytes once sent.
    pub fn send_blob_then_deinit(resp: AnyResponse, blob: &AnyBlob, options: InitFromBytesOptions<'_>) {
        let temp_route = StaticRoute::init_from_any_blob(blob, options);
        // SAFETY: init_from_any_blob returns a freshly boxed StaticRoute with ref_count=1.
        let temp_route = unsafe { &*temp_route };
        temp_route.on(resp);
        temp_route.deref_();
    }

    pub fn clone(&mut self, global_this: &JSGlobalObject) -> Result<*mut StaticRoute, Error> {
        // TODO(port): narrow error set
        let blob = self.blob.to_blob(global_this);
        self.blob = AnyBlob::Blob(blob);

        Ok(Box::into_raw(Box::new(StaticRoute {
            ref_count: Cell::new(1),
            blob: AnyBlob::Blob(blob.dupe()),
            cached_blob_size: self.cached_blob_size,
            has_content_disposition: self.has_content_disposition,
            headers: self.headers.clone()?,
            server: self.server,
            status_code: self.status_code,
        })))
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<StaticRoute>() + self.blob.memory_cost() + self.headers.memory_cost()
    }

    pub fn from_js(global_this: &JSGlobalObject, argument: JSValue) -> JsResult<Option<*mut StaticRoute>> {
        if let Some(response) = argument.as_::<Response>() {
            // The user may want to pass in the same Response object multiple endpoints
            // Let's let them do that.
            let body_value = response.get_body_value();
            let was_string = body_value.was_string();
            body_value.to_blob_if_possible();

            let mut blob: AnyBlob = 'brk: {
                match &*body_value {
                    BodyValue::Used => {
                        return Err(global_this
                            .throw_invalid_arguments("Response body has already been used", ()));
                    }

                    BodyValue::Null | BodyValue::Empty => {
                        break 'brk AnyBlob::InternalBlob(InternalBlob {
                            bytes: Vec::<u8>::new(),
                        });
                    }

                    BodyValue::Blob(_) | BodyValue::InternalBlob(_) | BodyValue::WTFStringImpl(_) => {
                        if let BodyValue::Blob(b) = &*body_value {
                            if b.needs_to_read_file() {
                                return Err(global_this
                                    .throw_todo("TODO: support Bun.file(path) in static routes"));
                            }
                        }
                        let mut blob = body_value.use_();
                        blob.global_this = global_this;
                        // TODO(port): Blob.global_this is a JSC_BORROW raw ptr; storing &JSGlobalObject here may need cast
                        debug_assert!(
                            !blob.is_heap_allocated(),
                            "expected blob not to be heap-allocated",
                        );
                        *body_value = BodyValue::Blob(blob.dupe());

                        break 'brk AnyBlob::Blob(blob);
                    }

                    _ => {
                        return Err(global_this.throw_invalid_arguments(
                            "Body must be fully buffered before it can be used in a static route. Consider calling new Response(await response.blob()) to buffer the body.",
                            (),
                        ));
                    }
                }
            };

            let mut has_content_disposition = false;

            if let Some(headers) = response.get_init_headers() {
                has_content_disposition = headers.fast_has(HttpHeader::ContentDisposition);
                headers.fast_remove(HttpHeader::TransferEncoding);
                headers.fast_remove(HttpHeader::ContentLength);
            }

            let mut headers: Headers = if let Some(h) = response.get_init_headers() {
                match Headers::from(Some(h), HeadersFromOptions { body: Some(&blob) }) {
                    Ok(v) => v,
                    Err(_) => {
                        blob.detach();
                        global_this.throw_out_of_memory();
                        return Err(bun_jsc::JsError::Thrown);
                    }
                }
            } else {
                Headers::default()
            };

            if was_string && headers.get_content_type().is_none() {
                headers.append(
                    b"Content-Type",
                    MimeType::TEXT_PLAIN_CHARSET_UTF8.slice(),
                    // TODO(port): MimeType.Table.@"text/plain; charset=utf-8" — exact const name TBD in bun_http
                );
            }

            // Generate ETag if not already present
            if headers.get(b"etag").is_none() {
                if !blob.slice().is_empty() {
                    ETag::append_to_headers(blob.slice(), &mut headers)?;
                }
            }

            return Ok(Some(Box::into_raw(Box::new(StaticRoute {
                ref_count: Cell::new(1),
                blob,
                cached_blob_size: blob.size(),
                has_content_disposition,
                headers,
                server: None,
                status_code: response.status_code(),
            }))));
        }

        Ok(None)
    }

    // HEAD requests have no body.
    pub fn on_head_request(&self, req: AnyRequest, resp: AnyResponse) {
        // Check If-None-Match for HEAD requests with 200 status
        if self.status_code == 200 {
            if self.render_304_not_modified_if_none_match(req, resp) {
                return;
            }
        }

        // Continue with normal HEAD request handling
        req.set_yield(false);
        self.on_head(resp);
    }

    pub fn on_head(&self, resp: AnyResponse) {
        debug_assert!(self.server.is_some());
        self.ref_();
        if let Some(server) = self.server {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        resp.corked(|| self.render_metadata_and_end(resp));
        self.on_response_complete(resp);
    }

    fn render_metadata_and_end(&self, resp: AnyResponse) {
        self.render_metadata(resp);
        resp.write_header_int(b"Content-Length", self.cached_blob_size);
        resp.end_without_body(resp.should_close_connection());
    }

    pub fn on_request(&self, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        if method == Method::GET {
            self.on_get(req, resp);
        } else if method == Method::HEAD {
            self.on_head_request(req, resp);
        } else {
            // For other methods, use the original behavior
            req.set_yield(false);
            self.on(resp);
        }
    }

    pub fn on_get(&self, req: AnyRequest, resp: AnyResponse) {
        // Check If-None-Match for GET requests with 200 status
        if self.status_code == 200 {
            if self.render_304_not_modified_if_none_match(req, resp) {
                return;
            }
        }

        // Continue with normal GET request handling
        req.set_yield(false);
        self.on(resp);
    }

    pub fn on(&self, resp: AnyResponse) {
        debug_assert!(self.server.is_some());
        self.ref_();
        if let Some(server) = self.server {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        let mut finished = false;
        self.do_render_blob(resp, &mut finished);
        if finished {
            self.on_response_complete(resp);
            return;
        }

        self.to_async(resp);
    }

    fn to_async(&self, resp: AnyResponse) {
        // SAFETY: self has ref_count >= 1 held until on_response_complete; uws stores
        // the raw pointer and calls back on the same thread.
        let this = self as *const StaticRoute as *mut StaticRoute;
        resp.on_aborted::<StaticRoute>(Self::on_aborted, this);
        resp.on_writable::<StaticRoute>(Self::on_writable, this);
        // TODO(port): exact bun_uws::AnyResponse callback registration API
    }

    fn on_aborted(&self, resp: AnyResponse) {
        self.on_response_complete(resp);
    }

    fn on_response_complete(&self, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(server) = self.server {
            server.on_static_request_complete();
        }
        self.deref_();
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

    fn on_writable(&self, write_offset: u64, resp: AnyResponse) -> bool {
        if let Some(server) = self.server {
            resp.timeout(server.config().idle_timeout);
        }

        if !self.on_writable_bytes(write_offset, resp) {
            return false;
        }

        self.on_response_complete(resp);
        true
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
                use std::io::Write;
                let mut b = [0u8; 16];
                let mut cursor: &mut [u8] = &mut b[..];
                write!(cursor, "{}", status).expect("unreachable");
                let written = 16 - cursor.len();
                r.write_status(&b[..written]);
            }
        }
    }

    fn do_write_headers(&self, resp: AnyResponse) {
        // Zig: switch (resp) { inline else => |s, tag| { ... } } — expanded per arm.
        let entries = self.headers.entries.slice();
        let names: &[StringPointer] = entries.items_name();
        let values: &[StringPointer] = entries.items_value();
        let buf = self.headers.buf.as_slice();

        match resp {
            AnyResponse::SSL(s) => {
                debug_assert_eq!(names.len(), values.len());
                for (name, value) in names.iter().zip(values) {
                    s.write_header(name.slice(buf), value.slice(buf));
                }
                if let Some(srv) = self.server {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::TCP(s) => {
                debug_assert_eq!(names.len(), values.len());
                for (name, value) in names.iter().zip(values) {
                    s.write_header(name.slice(buf), value.slice(buf));
                }
                if let Some(srv) = self.server {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::H3(s) => {
                debug_assert_eq!(names.len(), values.len());
                for (name, value) in names.iter().zip(values) {
                    s.write_header(name.slice(buf), value.slice(buf));
                }
                // tag == .H3: skip alt-svc
            }
        }
        // TODO(port): MultiArrayList .items(.name)/.items(.value) accessor names on bun_collections::MultiArrayList
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

    pub fn on_with_method(&self, method: Method, resp: AnyResponse) {
        match method {
            Method::GET => self.on(resp),
            Method::HEAD => self.on_head(resp),
            _ => {
                self.do_write_status(405, resp); // Method not allowed
                resp.end_without_body(resp.should_close_connection());
            }
        }
    }

    fn render_304_not_modified_if_none_match(&self, req: AnyRequest, resp: AnyResponse) -> bool {
        let Some(if_none_match) = req.header(b"if-none-match") else {
            return false;
        };
        let Some(etag) = self.headers.get(b"etag") else {
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
        self.ref_();
        if let Some(server) = self.server {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        self.do_write_status(304, resp);
        self.do_write_headers(resp);
        resp.end_without_body(resp.should_close_connection());
        self.on_response_complete(resp);
        true
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

// TODO(port): these are placeholder type refs for items whose exact module path is TBD in Phase B.
use crate::webcore::blob::InternalBlob;
use crate::webcore::fetch_headers::HttpHeader;
use bun_http::HeadersFromOptions;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/StaticRoute.zig (409 lines)
//   confidence: medium
//   todos:      6
//   notes:      IntrusiveRc pattern hand-rolled (ref_/deref_); uws callback registration + MultiArrayList accessors + Headers::from signature need Phase B wiring; resp.corked mapped to closure form
// ──────────────────────────────────────────────────────────────────────────
