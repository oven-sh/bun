//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.

use core::cell::Cell;
use core::mem::size_of;

use bun_http::headers::api::StringPointer;
use bun_http::headers::append_etag;
use bun_http::{Headers, Method};
use bun_http_types::ETag;
use bun_ptr::RefPtr;

use bun_http_types::MimeType::MimeType;
use bun_jsc::HTTPHeaderName;
use bun_telemetry_jsc::http_server::AnsweredRequest;
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::server::{AnyServer, HTTPStatusText, write_status};
use crate::webcore::body::Value as BodyValue;
use crate::webcore::headers_ref::any_blob_content_type;
use crate::webcore::{AnyBlob, FetchHeaders, InternalBlob, Response};

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct StaticRoute {
    ref_count: Cell<u32>,
    // TODO: Remove optional. StaticRoute requires a server object or else it will
    // not ensure it is alive while sending a large blob.
    pub(crate) server: Cell<Option<AnyServer>>,
    pub(crate) status_code: u16,
    pub(crate) blob: AnyBlob,
    pub(crate) cached_blob_size: u64,
    pub(crate) has_date: bool,
    pub(crate) headers: Headers,
}

#[derive(Clone, Copy)]
pub(crate) struct InitFromBytesOptions<'a> {
    pub(crate) server: Option<AnyServer>,
    pub(crate) mime_type: Option<&'a MimeType>,
    pub(crate) status_code: u16,
}

impl<'a> Default for InitFromBytesOptions<'a> {
    fn default() -> Self {
        Self {
            server: None,
            mime_type: None,
            status_code: 200,
        }
    }
}

impl StaticRoute {
    pub(crate) fn new(
        blob: AnyBlob,
        headers: Headers,
        server: Option<AnyServer>,
        status_code: u16,
    ) -> StaticRoute {
        StaticRoute {
            ref_count: Cell::new(1),
            cached_blob_size: blob.size(),
            has_date: headers.get(b"date").is_some(),
            blob,
            headers,
            server: Cell::new(server),
            status_code,
        }
    }

    /// Ownership of `blob` is transferred to this function.
    pub(crate) fn init_from_any_blob(
        blob: AnyBlob,
        options: InitFromBytesOptions<'_>,
    ) -> RefPtr<StaticRoute> {
        let mut headers = Headers::default();
        if let Some(content_type) = any_blob_content_type(&blob) {
            headers.append(b"Content-Type", content_type);
        } else if let Some(mime_type) = options.mime_type {
            headers.append(b"Content-Type", &mime_type.value);
        }

        // Generate ETag if not already present
        if headers.get(b"etag").is_none() {
            if !blob.slice().is_empty() {
                append_etag(blob.slice(), &mut headers);
            }
        }

        RefPtr::new(StaticRoute::new(
            blob,
            headers,
            options.server,
            options.status_code,
        ))
    }

    /// Ownership of `blob` is transferred to this function.
    pub(crate) fn init_from_any_blob_with_headers(
        global_this: &JSGlobalObject,
        blob: AnyBlob,
        fetch_headers: Option<&FetchHeaders>,
        status_code: u16,
    ) -> JsResult<RefPtr<StaticRoute>> {
        let mut headers: Headers = bun_http_jsc::headers_jsc::from_fetch_headers(
            global_this,
            fetch_headers,
            any_blob_content_type(&blob),
        )?;

        // Generate ETag if not already present
        if headers.get(b"etag").is_none() {
            if !blob.slice().is_empty() {
                append_etag(blob.slice(), &mut headers);
            }
        }

        let mut route = StaticRoute::new(blob, headers, None, status_code);
        // Match the body `on_get` sends. `blob.size()` returns the unknown-size sentinel for an S3 store.
        route.cached_blob_size = route.blob.slice().len() as u64;
        Ok(RefPtr::new(route))
    }

    /// Create a static route to be used on a single response, freeing the bytes once sent.
    pub(crate) fn send_blob_then_deinit(
        resp: AnyResponse,
        blob: AnyBlob,
        options: InitFromBytesOptions<'_>,
    ) {
        let temp_route = StaticRoute::init_from_any_blob(blob, options);
        temp_route.on(resp);
    }

    pub(crate) fn clone(&mut self, global_this: &JSGlobalObject) -> RefPtr<StaticRoute> {
        let blob = self.blob.to_blob(global_this);
        let duped = blob.dupe();
        self.blob = AnyBlob::Blob(blob);

        RefPtr::new(StaticRoute {
            ref_count: Cell::new(1),
            blob: AnyBlob::Blob(duped),
            cached_blob_size: self.cached_blob_size,
            has_date: self.has_date,
            headers: self.headers.clone(),
            server: Cell::new(self.server.get()),
            status_code: self.status_code,
        })
    }

    pub(crate) fn memory_cost(&self) -> usize {
        size_of::<StaticRoute>() + self.blob.memory_cost() + self.headers.memory_cost()
    }

    pub(crate) fn from_js(
        global_this: &JSGlobalObject,
        argument: JSValue,
    ) -> JsResult<Option<RefPtr<StaticRoute>>> {
        if let Some(response) = argument.as_class_ref::<Response>() {
            if !HTTPStatusText::is_sendable(response.status_code()) {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Cannot use a Response with status {} as a static route. HTTP status codes must be between 100 and 999 (Response.error() returns status 0).",
                    response.status_code(),
                )));
            }

            // The user may want to pass in the same Response object multiple endpoints
            // Let's let them do that.
            let body_value = response.get_body_value();
            let was_string = body_value.was_string();
            body_value.to_blob_if_possible();

            let blob: AnyBlob = 'brk: {
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
                        let blob = body_value.use_();
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

            if let Some(h) = response.get_init_headers_mut() {
                h.fast_remove(HTTPHeaderName::TransferEncoding);
                h.fast_remove(HTTPHeaderName::ContentLength);
            }

            // Consuming the body left a plain `Blob` behind, which no longer implies
            // the `text/plain` a string body carried. Record it on the response's own
            // headers so re-registering the same `Response` serves the same type.
            if was_string {
                let text_mime = bun_http_types::MimeType::TEXT;
                response.get_or_create_headers(global_this)?.put_default(
                    HTTPHeaderName::ContentType,
                    &bun_core::StringView::ascii(text_mime.value.as_ref()),
                    global_this,
                )?;
            }

            return Ok(Some(Self::init_from_any_blob_with_headers(
                global_this,
                blob,
                response.get_init_headers(),
                response.status_code(),
            )?));
        }

        Ok(None)
    }

    // HEAD requests have no body.
    pub(crate) fn on_head_request(self: RefPtr<Self>, mut req: AnyRequest, resp: AnyResponse) {
        let mut span = self.begin_span(&req, resp);
        // Evaluate conditional request preconditions for HEAD with 200 status
        if self.status_code == 200 {
            if let Some(status) = self.render_precondition(&mut req, resp) {
                span.set_status(status);
                return;
            }
        }

        // Continue with normal HEAD request handling
        req.set_yield(false);
        self.on_head(resp);
    }

    pub(crate) fn on_head(self: RefPtr<Self>, resp: AnyResponse) {
        debug_assert!(self.server.get().is_some());
        self.on_response_start(resp);
        resp.corked(|| self.render_metadata_and_end(resp));
        self.on_response_complete(resp);
    }

    fn render_metadata_and_end(&self, resp: AnyResponse) {
        self.render_metadata(resp);
        // `do_render_blob_corked` drops the body for a null-body status, so
        // HEAD reports the zero bytes GET actually sends (RFC 9110 §9.3.2).
        // 304: no synthesized Content-Length (RFC 9110 §8.6 only allows the
        // 200's length; `from_js` already stripped the handler's).
        if self.status_code != 304 {
            let size = if HTTPStatusText::is_null_body(self.status_code) {
                0
            } else {
                self.cached_blob_size
            };
            resp.write_header_int(b"Content-Length", size);
        }
        resp.end_without_body(resp.should_close_connection());
    }

    /// It ends when the response is handed to the socket.
    #[inline]
    fn begin_span(&self, req: &AnyRequest, resp: AnyResponse) -> AnsweredRequest {
        let Some(server) = self.server.get() else {
            return AnsweredRequest::default();
        };
        let mut span = server.begin_span(req, resp, core::ptr::from_ref(self).cast());
        span.set_status(self.status_code);
        span
    }

    pub(crate) fn on_request(self: RefPtr<Self>, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        if method == Method::GET {
            self.on_get(req, resp);
        } else if method == Method::HEAD {
            self.on_head_request(req, resp);
        } else {
            // For other methods, use the original behavior
            let _span = self.begin_span(&req, resp);
            let mut req = req;
            req.set_yield(false);
            self.on(resp);
        }
    }

    pub(crate) fn on_get(self: RefPtr<Self>, mut req: AnyRequest, resp: AnyResponse) {
        let mut span = self.begin_span(&req, resp);
        // Evaluate conditional request preconditions for GET with 200 status
        if self.status_code == 200 {
            if let Some(status) = self.render_precondition(&mut req, resp) {
                span.set_status(status);
                return;
            }
        }

        // Continue with normal GET request handling
        req.set_yield(false);
        self.on(resp);
    }

    pub(crate) fn on(self: RefPtr<Self>, resp: AnyResponse) {
        debug_assert!(self.server.get().is_some());
        self.on_response_start(resp);
        let mut finished = false;
        self.do_render_blob(resp, &mut finished);
        if finished {
            self.on_response_complete(resp);
            return;
        }

        self.to_async(resp);
    }

    /// The two handlers of `resp` own the ref between its events.
    fn to_async(self: RefPtr<Self>, resp: AnyResponse) {
        // SAFETY: `this` is the ref given up below. `on_response_complete` clears both handlers, an abort
        // is the last event of a response, and uWS dispatches none under `timeout` or `try_end`.
        let take = |this: *mut Self| unsafe { RefPtr::from_raw(this) };
        let this = self.into_raw();
        resp.on_aborted(
            move |this, resp| take(this).on_response_complete(resp),
            this,
        );
        resp.on_writable(
            move |this, write_offset, resp| take(this).on_writable(write_offset, resp),
            this,
        );
    }

    fn on_response_start(&self, resp: AnyResponse) {
        if let Some(server) = self.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
    }

    fn on_response_complete(&self, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(server) = self.server.get() {
            server.on_request_complete();
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
        // A null-body status never puts body bytes on the wire, the same drop
        // `render` and `FileRoute` already do. Writing them here with no
        // Content-Length (uWS suppresses it for 1xx/204) desyncs keep-alive.
        if HTTPStatusText::is_null_body(self.status_code) {
            // 304: try_end would write Content-Length: 0 (RFC 9110 §8.6 forbids
            // any but the 200's length); write_mark keeps Date.
            if self.status_code == 304 {
                resp.write_mark();
                resp.end_without_body(resp.should_close_connection());
                *did_finish = true;
            } else {
                *did_finish = resp.try_end(b"", 0, resp.should_close_connection());
            }
            return;
        }
        self.render_bytes(resp, did_finish);
    }

    fn on_writable(self: RefPtr<Self>, write_offset: u64, resp: AnyResponse) -> bool {
        if let Some(server) = self.server.get() {
            resp.timeout(server.config().idle_timeout);
        }

        if !self.on_writable_bytes(write_offset, resp) {
            let _ = self.into_raw(); // the handlers' until the next event
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
            AnyResponse::H3(_) | AnyResponse::H2(_) => {
                let mut b = bun_core::fmt::ItoaBuf::new();
                resp.write_status(bun_core::fmt::itoa(&mut b, status));
            }
        }
    }

    fn do_write_headers(&self, resp: AnyResponse) {
        use bun_http_types::ETag::HeaderEntryColumns;
        // Date is a singleton field (RFC 9110 §6.6.1); when the snapshot already
        // carries one, suppress uWS's auto-Date so only the user's value is sent.
        if self.has_date {
            resp.mark_wrote_date_header();
        }
        let entries = &self.headers.entries;
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
        self.do_write_status(self.status_code, resp);
        self.do_write_headers(resp);
    }

    pub(crate) fn on_with_method(self: RefPtr<Self>, method: Method, resp: AnyResponse) {
        match method {
            Method::GET => self.on(resp),
            Method::HEAD => self.on_head(resp),
            _ => {
                self.do_write_status(405, resp); // Method not allowed
                resp.write_header(b"Allow", b"GET, HEAD");
                resp.write_header_int(b"Content-Length", 0);
                resp.end_without_body(resp.should_close_connection());
            }
        }
    }

    /// RFC 9110 §13.2.2 precondition evaluation. Writes a 412 or 304 response
    /// and returns its status when a precondition short-circuits the request.
    fn render_precondition(&self, req: &mut AnyRequest, resp: AnyResponse) -> Option<u16> {
        let etag = self.headers.get(b"etag").filter(|v| !v.is_empty());
        // Deferred: `parse_http_date` allocates + calls into WTF; only run it
        // when the client actually sent a date-based conditional header.
        let last_modified = || {
            self.headers
                .get(b"last-modified")
                .and_then(crate::jsc_hooks::parse_http_date)
        };

        // Step 1: If-Match (strong comparison); step 2: If-Unmodified-Since
        // (only when If-Match is absent).
        let precondition_failed =
            if let Some(im) = req.header(b"if-match").filter(|v| !v.is_empty()) {
                !ETag::if_match(etag, im)
            } else if let Some(ius) = req
                .header(b"if-unmodified-since")
                .and_then(crate::jsc_hooks::parse_http_date)
            {
                matches!(last_modified(), Some(lm) if lm / 1000 > ius / 1000)
            } else {
                false
            };
        if precondition_failed {
            return self.render_bodiless(req, resp, 412);
        }

        // Step 3: If-None-Match (weak comparison). Presence suppresses step 4.
        let not_modified = if let Some(if_none_match) = req.header(b"if-none-match") {
            match etag {
                Some(etag) if !if_none_match.is_empty() => ETag::if_none_match(etag, if_none_match),
                _ => false,
            }
        // Step 4: If-Modified-Since (only when If-None-Match is absent).
        } else if let Some(ims) = req
            .header(b"if-modified-since")
            .and_then(crate::jsc_hooks::parse_http_date)
        {
            // §13.1.3: 304 when Last-Modified <= If-Modified-Since. HTTP-date
            // is second-granular, so compare at second precision.
            match last_modified() {
                Some(lm) => lm / 1000 <= ims / 1000,
                None => false,
            }
        } else {
            false
        };

        if !not_modified {
            return None;
        }

        self.render_bodiless(req, resp, 304)
    }

    fn render_bodiless(&self, req: &mut AnyRequest, resp: AnyResponse, status: u16) -> Option<u16> {
        req.set_yield(false);
        self.on_response_start(resp);
        self.do_write_status(status, resp);
        self.do_write_headers(resp);
        if !HTTPStatusText::is_null_body(status) {
            resp.write_header_int(b"Content-Length", 0);
        }
        resp.end_without_body(resp.should_close_connection());
        self.on_response_complete(resp);
        Some(status)
    }
}
