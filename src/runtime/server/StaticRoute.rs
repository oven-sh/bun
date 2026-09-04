//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.

use core::cell::Cell;
use core::mem::size_of;

use bun_http::headers::api::StringPointer;
use bun_http::headers::append_etag;
use bun_http::{Headers, Method};
use bun_http_types::ETag;
use bun_ptr::{RefPtr, ThisPtr};

use bun_http_types::MimeType::MimeType;
use bun_jsc::HTTPHeaderName;
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::server::{AnyServer, HTTPStatusText, write_status};
use crate::webcore::body::Value as BodyValue;
use crate::webcore::headers_ref::any_blob_content_type;
use crate::webcore::{AnyBlob, FetchHeaders, InternalBlob, Response};

#[derive(bun_ptr::CellRefCounted)]
pub struct StaticRoute {
    ref_count: Cell<u32>,
    /// The ref that in-flight responses (whose uws userdata is this route)
    /// collectively hold: taken by the first, released with the last in
    /// `on_response_complete`.
    pending_ref: Cell<Option<RefPtr<StaticRoute>>>,
    pending_responses: Cell<u32>,
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
pub struct InitFromBytesOptions<'a> {
    pub(crate) server: Option<AnyServer>,
    pub(crate) mime_type: Option<&'a MimeType>,
    pub(crate) status_code: u16,
    pub(crate) headers: Option<&'a FetchHeaders>,
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
    pub(crate) fn new(
        blob: AnyBlob,
        headers: Headers,
        server: Option<AnyServer>,
        status_code: u16,
    ) -> StaticRoute {
        StaticRoute {
            ref_count: Cell::new(1),
            pending_ref: Cell::new(None),
            pending_responses: Cell::new(0),
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

        RefPtr::new(StaticRoute::new(
            blob,
            headers,
            options.server,
            options.status_code,
        ))
    }

    /// Create a static route to be used on a single response, freeing the bytes once sent.
    pub(crate) fn send_blob_then_deinit(
        resp: AnyResponse,
        blob: AnyBlob,
        options: InitFromBytesOptions<'_>,
    ) {
        let temp_route = StaticRoute::init_from_any_blob(blob, options);
        StaticRoute::on(temp_route.this_ptr(), resp);
    }

    pub(crate) fn clone(&mut self, global_this: &JSGlobalObject) -> RefPtr<StaticRoute> {
        let blob = self.blob.to_blob(global_this);
        let duped = blob.dupe();
        self.blob = AnyBlob::Blob(blob);

        RefPtr::new(StaticRoute {
            ref_count: Cell::new(1),
            pending_ref: Cell::new(None),
            pending_responses: Cell::new(0),
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

    /// A copy of the body for a response this route does not send itself.
    pub(crate) fn dupe_blob(&self) -> AnyBlob {
        match &self.blob {
            AnyBlob::Blob(blob) => AnyBlob::Blob(blob.dupe()),
            AnyBlob::InternalBlob(blob) => AnyBlob::InternalBlob(InternalBlob {
                bytes: blob.bytes.clone(),
                was_string: blob.was_string,
            }),
            AnyBlob::WTFStringImpl(s) => {
                // SAFETY: the route holds a +1 on the impl while this variant is active.
                unsafe { (**s).r#ref() };
                AnyBlob::WTFStringImpl(*s)
            }
        }
    }

    pub fn from_js(
        global_this: &JSGlobalObject,
        argument: JSValue,
    ) -> JsResult<Option<RefPtr<StaticRoute>>> {
        // `as_class_ref` is the safe shared-borrow downcast (one audited
        // unsafe in `JSValue`); every `Response` accessor used below takes
        // `&self` (interior mutability for `body`), so no `&mut` is needed.
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
                    &bun_core::String::ascii(text_mime.value.as_ref()),
                    global_this,
                )?;
            }

            let mut headers: Headers = bun_http_jsc::headers_jsc::from_fetch_headers(
                response.get_init_headers(),
                any_blob_content_type(&blob),
            );

            // Generate ETag if not already present
            if headers.get(b"etag").is_none() {
                if !blob.slice().is_empty() {
                    append_etag(blob.slice(), &mut headers);
                }
            }

            return Ok(Some(RefPtr::new(StaticRoute::new(
                blob,
                headers,
                None,
                response.status_code(),
            ))));
        }

        Ok(None)
    }

    // HEAD requests have no body.
    pub(crate) fn on_head_request(this: ThisPtr<Self>, mut req: AnyRequest, resp: AnyResponse) {
        // Evaluate conditional request preconditions for HEAD with 200 status
        if this.status_code == 200 {
            if Self::render_precondition(this, &mut req, resp) {
                return;
            }
        }

        // Continue with normal HEAD request handling
        req.set_yield(false);
        Self::on_head(this, resp);
    }

    pub(crate) fn on_head(this: ThisPtr<Self>, resp: AnyResponse) {
        debug_assert!(this.server.get().is_some());
        Self::retain_for_response(this);
        if let Some(mut server) = this.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        resp.corked(|| this.render_metadata_and_end(resp));
        Self::on_response_complete(this, resp);
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

    pub(crate) fn on_request(this: ThisPtr<Self>, req: AnyRequest, resp: AnyResponse) {
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

    pub(crate) fn on_get(this: ThisPtr<Self>, mut req: AnyRequest, resp: AnyResponse) {
        // Evaluate conditional request preconditions for GET with 200 status
        if this.status_code == 200 {
            if Self::render_precondition(this, &mut req, resp) {
                return;
            }
        }

        // Continue with normal GET request handling
        req.set_yield(false);
        Self::on(this, resp);
    }

    pub(crate) fn on(this: ThisPtr<Self>, resp: AnyResponse) {
        debug_assert!(this.server.get().is_some());
        Self::retain_for_response(this);
        if let Some(mut server) = this.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        let mut finished = false;
        this.do_render_blob(resp, &mut finished);
        if finished {
            Self::on_response_complete(this, resp);
            return;
        }

        Self::to_async(this, resp);
    }

    fn to_async(this: ThisPtr<Self>, resp: AnyResponse) {
        resp.on_aborted_this(Self::on_aborted, this);
        resp.on_writable_this(Self::on_writable, this);
    }

    fn on_aborted(this: ThisPtr<Self>, resp: AnyResponse) {
        Self::on_response_complete(this, resp);
    }

    /// The response whose uws userdata is this route keeps it alive until
    /// `on_response_complete`.
    fn retain_for_response(this: ThisPtr<Self>) {
        let n = this.pending_responses.get();
        if n == 0 {
            this.pending_ref.set(Some(RefPtr::from_this(this)));
        }
        this.pending_responses.set(n + 1);
    }

    /// May free `this`.
    fn on_response_complete(this: ThisPtr<Self>, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(mut server) = this.server.get() {
            server.on_static_request_complete();
        }
        let n = this.pending_responses.get() - 1;
        this.pending_responses.set(n);
        if n == 0 {
            this.pending_ref.set(None);
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

    fn on_writable(this: ThisPtr<Self>, write_offset: u64, resp: AnyResponse) -> bool {
        if let Some(server) = this.server.get() {
            resp.timeout(server.config().idle_timeout);
        }

        if !this.on_writable_bytes(write_offset, resp) {
            return false;
        }

        Self::on_response_complete(this, resp);
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

    pub(crate) fn on_with_method(this: ThisPtr<Self>, method: Method, resp: AnyResponse) {
        match method {
            Method::GET => Self::on(this, resp),
            Method::HEAD => Self::on_head(this, resp),
            _ => {
                this.do_write_status(405, resp); // Method not allowed
                resp.write_header(b"Allow", b"GET, HEAD");
                resp.write_header_int(b"Content-Length", 0);
                resp.end_without_body(resp.should_close_connection());
            }
        }
    }

    /// RFC 9110 §13.2.2 precondition evaluation. Writes a 412 or 304 response
    /// and returns `true` when a precondition short-circuits the request.
    fn render_precondition(this: ThisPtr<Self>, req: &mut AnyRequest, resp: AnyResponse) -> bool {
        let etag = this.headers.get(b"etag").filter(|v| !v.is_empty());
        // Deferred: `parse_http_date` allocates + calls into WTF; only run it
        // when the client actually sent a date-based conditional header.
        let last_modified = || {
            this.headers
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
            return Self::render_bodiless(this, req, resp, 412);
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
            return false;
        }

        Self::render_bodiless(this, req, resp, 304)
    }

    /// May free `this`.
    fn render_bodiless(
        this: ThisPtr<Self>,
        req: &mut AnyRequest,
        resp: AnyResponse,
        status: u16,
    ) -> bool {
        req.set_yield(false);
        Self::retain_for_response(this);
        if let Some(mut server) = this.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        this.do_write_status(status, resp);
        this.do_write_headers(resp);
        if !HTTPStatusText::is_null_body(status) {
            resp.write_header_int(b"Content-Length", 0);
        }
        resp.end_without_body(resp.should_close_connection());
        Self::on_response_complete(this, resp);
        true
    }
}

impl Drop for StaticRoute {
    fn drop(&mut self) {
        self.blob.detach();
    }
}
