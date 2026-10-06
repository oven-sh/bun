//! The static route of `new Response(s3file)`: a redirect to a presigned URL that Bun signs for each request.

use core::cell::Cell;
use core::mem::size_of;

use bun_core::strings;
use bun_http::{Headers, Method};
use bun_http_types::ETag::HeaderEntryColumns;
use bun_ptr::{RefPtr, ThisPtr};
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::AnyServer;
use crate::server::file_route::write_any_status;
use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};
use crate::webcore::Response;
use crate::webcore::blob::Store;
use crate::webcore::blob::store::presign_redirect;
use crate::webcore::body::Value as BodyValue;

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct S3RedirectRoute {
    ref_count: Cell<u32>,
    server: Cell<Option<AnyServer>>,
    store: RefPtr<Store>,
    /// The headers of the Response. The value of the `Location` entry is signed for each request.
    headers: Headers,
    location_index: usize,
    status_code: u16,
    has_date_header: bool,
}

impl S3RedirectRoute {
    #[inline]
    pub(crate) fn set_server(&self, server: Option<AnyServer>) {
        self.server.set(server);
    }

    pub(crate) fn memory_cost(&self) -> usize {
        size_of::<S3RedirectRoute>() + self.headers.memory_cost()
    }

    pub(crate) fn from_js(
        global: &JSGlobalObject,
        argument: JSValue,
    ) -> JsResult<Option<RefPtr<S3RedirectRoute>>> {
        let Some(response) = argument.as_class_ref::<Response>() else {
            return Ok(None);
        };
        if !matches!(
            *response.get_body_value(),
            BodyValue::Null | BodyValue::Empty
        ) {
            return Ok(None);
        }
        let Some(store) = response.s3_redirect_store() else {
            return Ok(None);
        };
        // A HEAD signature that cannot be made is an error of `Bun.serve()`, not a 500 for each HEAD request.
        if let Err(err) = presign_redirect(store.data.as_s3(), Method::HEAD) {
            return Err(crate::webcore::s3::client::throw_sign_error(
                err.into(),
                global,
            ));
        }

        let all = bun_http_jsc::headers_jsc::from_fetch_headers(response.get_init_headers(), None);
        let mut headers = Headers::default();
        let mut location_index = None;
        let entries = all.entries.slice();
        for (name, value) in entries.items_name().iter().zip(entries.items_value()) {
            let name = all.as_str(*name);
            if strings::eql_case_insensitive_ascii(name, b"content-length", true)
                || strings::eql_case_insensitive_ascii(name, b"transfer-encoding", true)
            {
                continue;
            }
            if strings::eql_case_insensitive_ascii(name, b"location", true) {
                location_index = Some(headers.entries.len());
                headers.append(name, b"");
            } else {
                headers.append(name, all.as_str(*value));
            }
        }
        let Some(location_index) = location_index else {
            return Ok(None);
        };

        Ok(Some(RefPtr::new(S3RedirectRoute {
            ref_count: Cell::new(1),
            server: Cell::new(None),
            has_date_header: headers.get(b"date").is_some(),
            store,
            headers,
            location_index,
            status_code: response.status_code(),
        })))
    }

    pub(crate) fn on_head_request(this: ThisPtr<Self>, req: AnyRequest, resp: AnyResponse) {
        Self::on(this, req, resp, Method::HEAD);
    }

    pub(crate) fn on_request(this: ThisPtr<Self>, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        Self::on(this, req, resp, method);
    }

    fn on(this: ThisPtr<Self>, mut req: AnyRequest, resp: AnyResponse, method: Method) {
        debug_assert!(this.server.get().is_some());
        // `on_static_request_complete` can drop the route table's ref.
        let route = RefPtr::from_this(this);
        req.set_yield(false);
        if let Some(mut server) = route.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }

        let signed = presign_redirect(route.store.data.as_s3(), method);
        resp.corked(|| {
            match &signed {
                Ok(result) => {
                    write_any_status(resp, route.status_code);
                    route.write_headers(resp, &result.url);
                }
                Err(_) => write_any_status(resp, 500),
            }
            if method == Method::HEAD {
                resp.write_header_int(b"Content-Length", 0);
                resp.end_without_body(resp.should_close_connection());
            } else {
                resp.end(b"", resp.should_close_connection());
            }
        });

        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(mut server) = route.server.get() {
            server.on_static_request_complete();
        }
    }

    fn write_headers(&self, resp: AnyResponse, location: &[u8]) {
        if self.has_date_header {
            resp.mark_wrote_date_header();
        }
        let entries = self.headers.entries.slice();
        let names = entries.items_name();
        let values = entries.items_value();
        for (index, (name, value)) in names.iter().zip(values).enumerate() {
            let value = if index == self.location_index {
                location
            } else {
                self.headers.as_str(*value)
            };
            resp.write_header(self.headers.as_str(*name), value);
        }
        if !matches!(resp, AnyResponse::H3(_)) {
            if let Some(server) = self.server.get() {
                if let Some(alt_svc) = server.h3_alt_svc() {
                    resp.write_header(b"alt-svc", alt_svc);
                }
            }
        }
    }
}
