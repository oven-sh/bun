//! HTTP request handling: routing `/_bun/*` paths, host and origin checks, and static responses.

use super::*;

/// Handler dispatch for `dev_route_tramp`. A fn pointer cannot be a const
/// generic, so use a `ConstParamTy` enum instead and
/// `match` inside the trampoline (the optimizer folds the constant `match`).
#[derive(Copy, Clone, Eq, PartialEq, ::core::marker::ConstParamTy)]
pub(super) enum DevHandlerId {
    JsRequest,
    AssetRequest,
    SrcRequest,
    ReportError,
    UnrefSourceMap,
    NotFound,
    Request,
}

/// DNS-rebinding guard for `/_bun/...` internal routes and the Chrome
/// DevTools `/.well-known/...` route. A rebound origin
/// (`attacker.com` → 127.0.0.1) presents `Host: attacker.com`; rejecting
/// non-loopback / non-IP / non-configured hostnames prevents the attacker's
/// page from reading bundled source via same-origin fetch.
pub(crate) fn is_allowed_dev_host(dev: &DevServer, req: &Request) -> bool {
    is_allowed_host_header(
        req,
        dev.server.as_ref().map(|server| &server.config().address),
    )
}

pub(crate) fn is_allowed_host_header(
    req: &Request,
    address: Option<&crate::server::server_config::Address>,
) -> bool {
    let Some(host) = req.header(b"host") else {
        return false;
    };
    let host = host_without_port(host);
    if strings::eql_case_insensitive_ascii(host, b"localhost", true) {
        return true;
    }
    const DOT_LOCALHOST: &[u8] = b".localhost";
    if host.len() > DOT_LOCALHOST.len()
        && strings::eql_case_insensitive_ascii(
            &host[host.len() - DOT_LOCALHOST.len()..],
            DOT_LOCALHOST,
            true,
        )
    {
        return true;
    }
    // A host that the resolver reads as a number is never looked up, so DNS cannot rebind it.
    let numeric = bun_core::ip_address::strip_ipv6_brackets(host);
    if bun_core::ip_address::is_ip_address(numeric)
        || (numeric.first().is_some_and(u8::is_ascii_digit)
            && bun_core::ip_address::to_ip_address(numeric).is_some_and(|ip| ip.is_ipv4()))
    {
        return true;
    }
    use crate::server::server_config::Address;
    match address {
        Some(Address::Tcp {
            hostname: Some(h), ..
        }) => strings::eql_case_insensitive_ascii(host, h.as_bytes(), true),
        Some(Address::Tcp { hostname: None, .. }) | Some(Address::Unix(_)) | None => false,
    }
}

/// `host[":" port]` / `"[" v6 "]" [":" port]` → host (brackets retained for IPv6).
/// Malformed authorities (missing `]`, empty or non-numeric port, trailing
/// garbage) yield an empty slice so callers fail closed.
fn host_without_port(host: &[u8]) -> &[u8] {
    let (host, rest) = if host.first() == Some(&b'[') {
        match strings::index_of_scalar(host, b']') {
            Some(end) => (&host[..=end], &host[end + 1..]),
            None => return b"",
        }
    } else {
        match strings::last_index_of_char(host, b':') {
            Some(colon) => (&host[..colon], &host[colon..]),
            None => (host, &host[host.len()..]),
        }
    };
    match rest {
        [] => host,
        [b':', port @ ..] if !port.is_empty() && port.iter().all(u8::is_ascii_digit) => host,
        _ => b"",
    }
}

/// Cross-origin guard for the HMR WebSocket. WebSocket handshakes are exempt
/// from the same-origin policy, so any page the developer visits could open
/// `ws://localhost:<port>/_bun/hmr` and subscribe to hot-update payloads (the
/// bundled source) — the browser still sends `Host: localhost`, so
/// `is_allowed_dev_host` alone does not stop it. Browsers always include an
/// `Origin` header on WebSocket handshakes; require its host to be the
/// request's own host or a localhost name. Requests without an `Origin`
/// header (non-browser clients) are allowed.
pub(super) fn is_allowed_dev_origin(req: &Request) -> bool {
    let Some(origin) = req.header(b"origin") else {
        return true;
    };
    // An origin is `scheme "://" host [":" port]`; opaque origins serialize
    // to `null` and are rejected here.
    let Some(scheme_end) = strings::index_of(origin, b"://") else {
        return false;
    };
    let origin_host = host_without_port(&origin[scheme_end + 3..]);
    if strings::eql_case_insensitive_ascii(origin_host, b"localhost", true) {
        return true;
    }
    const DOT_LOCALHOST: &[u8] = b".localhost";
    if origin_host.len() > DOT_LOCALHOST.len()
        && strings::eql_case_insensitive_ascii(
            &origin_host[origin_host.len() - DOT_LOCALHOST.len()..],
            DOT_LOCALHOST,
            true,
        )
    {
        return true;
    }
    match req.header(b"host") {
        Some(host) => {
            strings::eql_case_insensitive_ascii(origin_host, host_without_port(host), true)
        }
        None => false,
    }
}

pub(super) fn host_forbidden(resp: AnyResponse) {
    resp.corked(move || {
        resp.write_status(b"403 Forbidden");
        resp.end(b"Blocked: Host header does not match the dev server", false);
    });
}

pub(super) fn origin_forbidden(resp: AnyResponse) {
    resp.corked(move || {
        resp.write_status(b"403 Forbidden");
        resp.end(
            b"Blocked: Origin header does not match the dev server",
            false,
        );
    });
}

/// `extern "C"` trampoline: recovers `&mut DevServer` from user-data and wraps
/// the raw `uws_res` as `AnyResponse`, then calls the handler for `ID`.
#[allow(
    clippy::undocumented_unsafe_blocks,
    reason = "the SAFETY note above the match covers the eight identical call-scoped reborrows"
)]
pub(super) extern "C" fn dev_route_tramp<const SSL: bool, const ID: DevHandlerId>(
    res: *mut bun_uws_sys::uws_res,
    req: *mut bun_uws_sys::Request,
    ud: *mut c_void,
) {
    // SAFETY: `ud`/`req`/`res` were registered by `set_routes` and outlive the
    // route; uWS guarantees they are non-null in handler callbacks. `dev` is
    // re-derived per statement so no `&mut DevServer` spans the guard reads.
    let dev = ud.cast::<DevServer>();
    let req = req.cast::<Request>();
    let resp = if SSL {
        AnyResponse::SSL(res.cast::<bun_uws_sys::response::TLSResponse>())
    } else {
        AnyResponse::TCP(res.cast::<bun_uws_sys::response::TCPResponse>())
    };
    // SAFETY: uWS passes a non-null `Request*` valid for the callback; shared,
    // call-scoped reborrow.
    if !is_allowed_dev_host(unsafe { &*dev }, unsafe { &*req }) {
        return host_forbidden(resp);
    }
    // SAFETY: as above.
    if matches!(ID, DevHandlerId::ReportError | DevHandlerId::UnrefSourceMap)
        && !is_allowed_dev_origin(unsafe { &*req })
    {
        return origin_forbidden(resp);
    }
    // SAFETY: as above — the exclusive borrow is consumed by the single handler
    // call; nothing else stores or re-derives this `Request` pointer.
    match ID {
        DevHandlerId::JsRequest => on_js_request(unsafe { &mut *dev }, unsafe { &mut *req }, resp),
        DevHandlerId::AssetRequest => {
            on_asset_request(unsafe { &mut *dev }, unsafe { &mut *req }, resp)
        }
        DevHandlerId::SrcRequest => {
            on_src_request(unsafe { &mut *dev }, unsafe { &mut *req }, resp)
        }
        DevHandlerId::ReportError => {
            on_report_error_request(unsafe { &mut *dev }, unsafe { &mut *req }, resp)
        }
        DevHandlerId::UnrefSourceMap => {
            on_unref_source_map_request(unsafe { &mut *dev }, unsafe { &mut *req }, resp)
        }
        DevHandlerId::NotFound => on_not_found(unsafe { &mut *dev }, unsafe { &mut *req }, resp),
        DevHandlerId::Request => {
            // The catch-all route can reach a framework request handler; this
            // trampoline folds what bundling for it left pending.
            crate::dispatch::fold(on_request(unsafe { &mut *dev }, unsafe { &mut *req }, resp));
        }
    }
}

fn on_report_error_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    use bun_uws_sys::thunk::OpaqueHandle as _;
    match resp {
        AnyResponse::SSL(r) => {
            ErrorReportRequest::run(dev, req, bun_uws_sys::response::TLSResponse::as_handle(r))
        }
        AnyResponse::TCP(r) => {
            ErrorReportRequest::run(dev, req, bun_uws_sys::response::TCPResponse::as_handle(r))
        }
        AnyResponse::H3(_) | AnyResponse::H2(_) => not_found(resp),
    }
}

fn on_unref_source_map_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    use bun_uws_sys::thunk::OpaqueHandle as _;
    match resp {
        AnyResponse::SSL(r) => {
            UnrefSourceMapRequest::run(dev, req, bun_uws_sys::response::TLSResponse::as_handle(r))
        }
        AnyResponse::TCP(r) => {
            UnrefSourceMapRequest::run(dev, req, bun_uws_sys::response::TCPResponse::as_handle(r))
        }
        AnyResponse::H3(_) | AnyResponse::H2(_) => not_found(resp),
    }
}

// `ResponseLike` for the concrete `Response<SSL>` (used by `on_websocket_upgrade`).
impl<const SSL: bool> ResponseLike for bun_uws_sys::response::Response<SSL> {
    fn write_status(&mut self, status: &[u8]) {
        bun_uws_sys::response::Response::<SSL>::write_status(self, status)
    }
    fn end(&mut self, data: &[u8], close_connection: bool) {
        bun_uws_sys::response::Response::<SSL>::end(self, data, close_connection)
    }
    fn as_any_response(&mut self) -> bun_uws::AnyResponse {
        if SSL {
            bun_uws::AnyResponse::SSL(std::ptr::from_mut::<Self>(self).cast())
        } else {
            bun_uws::AnyResponse::TCP(std::ptr::from_mut::<Self>(self).cast())
        }
    }
}

fn on_not_found(_: &mut DevServer, _: &mut Request, resp: AnyResponse) {
    not_found(resp);
}

fn not_found(resp: AnyResponse) {
    resp.corked(move || on_not_found_corked(resp));
}

fn on_not_found_corked(resp: AnyResponse) {
    resp.write_status(b"404 Not Found");
    resp.end(b"Not Found", false);
}

pub(super) fn on_outdated_js_corked(resp: AnyResponse) {
    // Send a payload to instantly reload the page. This only happens when the
    // client bundle is invalidated while the page is loading, aka when you
    // perform many file updates that cannot be hot-updated.
    resp.write_status(b"200 OK");
    resp.write_header(b"Content-Type", &MimeType::JAVASCRIPT.value);
    resp.end(
        b"try{location.reload()}catch(_){}\n\
         addEventListener(\"DOMContentLoaded\",function(event){location.reload()})",
        false,
    );
}

fn on_js_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    let route_id = req.parameter(0);
    let is_map = strings::has_suffix_comptime(route_id, b".js.map");
    if !is_map && !strings::has_suffix_comptime(route_id, b".js") {
        return not_found(resp);
    }
    let min_len = b"00000000FFFFFFFF.js".len() + if is_map { b".map".len() } else { 0 };
    if route_id.len() < min_len {
        return not_found(resp);
    }
    let hex = &route_id[route_id.len() - min_len..][..::core::mem::size_of::<u64>() * 2];
    let Some(id) = parse_hex_to_int::<u64>(hex) else {
        return not_found(resp);
    };

    if is_map {
        let source_id = source_map_store::SourceId(id);
        // Note: `render_json` needs `&mut DevServer` while `entry` borrows
        // `dev.source_maps.entries[_]`. The entry is read-only (`&self`) and
        // `render_json` does not touch `source_maps.entries`, so erase the
        // entry borrow to a raw pointer and reborrow `dev` for the call.
        let Some(entry) = dev
            .source_maps
            .entries
            .get_mut(&source_map_store::Key::init(id))
        else {
            return not_found(resp);
        };
        let entry_ptr: *const source_map_store::Entry = &raw const *entry;
        // SAFETY: `entry_ptr` points into `dev.source_maps.entries` storage,
        // which is not reallocated by `render_json`.
        let json_bytes =
            match unsafe { &*entry_ptr }.render_json(dev, source_id.kind(), bake::Side::Client) {
                Ok(b) => b,
                Err(e) => bun_core::handle_oom(Err(e)),
            };
        let response = StaticRoute::init_from_any_blob(
            crate::webcore::blob::Any::from_array_list(json_bytes),
            crate::server::static_route::InitFromBytesOptions {
                server: dev.server,
                mime_type: Some(&MimeType::JSON),
                ..Default::default()
            },
        );
        StaticRoute::on_request(response.this_ptr(), bun_uws::AnyRequest::H1(req), resp);
        return;
    }

    let index = id as u32;
    let generation = (id >> 32) as u32;

    // Check the range first because `Index::init` asserts on `u32::MAX`, which the URL can contain.
    if index as usize >= dev.route_bundles.len() {
        return not_found(resp);
    }
    let route_bundle_index = route_bundle::Index::init(index);

    dev.serve_client_script(
        route_bundle_index,
        generation,
        resp,
        Method::which(req.method()).unwrap_or(Method::POST),
    );
}

fn on_asset_request(dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    let param = req.parameter(0);
    if param.len() < ::core::mem::size_of::<u64>() * 2 {
        return not_found(resp);
    }
    let hex = &param[..::core::mem::size_of::<u64>() * 2];
    let Some(hash) = parse_hex_to_int::<u64>(hex) else {
        return not_found(resp);
    };
    debug_log!("onAssetRequest {} {}", hash, bstr::BStr::new(param));
    let Some(asset) = dev.assets.get(hash) else {
        return not_found(resp);
    };
    req.set_yield(false);
    StaticRoute::on(asset.this_ptr(), resp);
}

pub(super) use bun_core::fmt::parse_hex_to_int;

fn on_src_request(_dev: &mut DevServer, req: &mut Request, resp: AnyResponse) {
    if req.header(b"open-in-editor").is_none() {
        resp.write_status(b"501 Not Implemented");
        resp.end(
            b"Viewing source without opening in editor is not implemented yet!",
            false,
        );
        return;
    }

    // TODO: better editor detection. on chloe's dev env, this opens apple terminal + vim
    resp.write_status(b"501 Not Implemented");
    resp.end(b"TODO", false);
}

fn on_request(dev: &mut DevServer, req: &mut Request, mut resp: AnyResponse) -> JsResult<()> {
    let mut params: router::MatchedParams = Default::default();
    let pathname = extract_pathname_from_url(req.url());
    if let Some(route_index) = dev.router.match_slow(pathname, &mut params) {
        let route_bundle_index = dev
            .get_or_put_route_bundle(route_bundle::UnresolvedIndex::Framework(route_index))
            .expect("oom");
        let mut ctx = RequestEnsureRouteBundledCtx {
            dev: std::ptr::from_mut::<DevServer>(dev),
            req: ReqOrSaved::Req(req),
            resp,
            kind: deferred_request::HandlerKind::ServerHandler,
            route_bundle_index,
        };
        let rbi = ctx.route_bundle_index;
        return match ensure_route_is_bundled(dev, rbi, &mut ctx) {
            Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
            bundled => bundled,
        };
    }

    if !dev
        .server
        .as_ref()
        .expect("infallible: server bound")
        .config()
        .on_request
        .is_empty()
    {
        dev.server
            .as_mut()
            .expect("infallible: server bound")
            .on_request(req, resp);
        return Ok(());
    }

    send_built_in_not_found(&mut resp);
    Ok(())
}

fn send_built_in_not_found<R: ResponseLike>(resp: &mut R) {
    let message = b"404 Not Found";
    resp.write_status(b"404 Not Found");
    resp.end(message, true);
}

/// Problem statement documented on `SCRIPT_UNREF_PAYLOAD`
/// Takes 8 bytes: The generation ID in hex.
struct UnrefSourceMapRequest {
    // BACKREF: DevServer outlives the request; raw ptr avoids the `'static`
    // bound on `BodyReaderHandler` that a borrowed `&mut DevServer` would violate.
    dev: *mut DevServer,
    body: uws::BodyReaderMixin<Self>,
}

bun_core::intrusive_field!(UnrefSourceMapRequest, body: uws::BodyReaderMixin<UnrefSourceMapRequest>);

impl bun_uws_sys::body_reader_mixin::BodyReaderHandler for UnrefSourceMapRequest {
    unsafe fn on_body(this: *mut Self, body: &[u8], resp: AnyResponse) -> bun_uws_sys::Result<()> {
        // SAFETY: caller (BodyReaderMixin) passes the original heap-allocated
        // pointer with full-allocation provenance and no live borrows.
        unsafe { Self::run_with_body(this, body, resp) }.map_err(Into::into)
    }
    unsafe fn on_error(this: *mut Self) {
        // SAFETY: caller passes the original heap-allocated pointer; finalize
        // consumes it via heap::take exactly once.
        unsafe { Self::finalize(this) }
    }
}

impl UnrefSourceMapRequest {
    fn run<R>(dev: &mut DevServer, _: &mut Request, resp: &mut R)
    where
        R: bun_uws_sys::body_reader_mixin::BodyResponse,
    {
        dev.server
            .as_mut()
            .expect("server bound")
            .on_pending_request();
        let ctx = Box::new(UnrefSourceMapRequest {
            dev: std::ptr::from_mut::<DevServer>(dev),
            body: uws::BodyReaderMixin::init(),
        });
        let raw = bun_core::heap::into_raw(ctx);
        uws::BodyReaderMixin::<Self>::read_body(raw, resp);
    }

    /// SAFETY: `ctx` must be the pointer returned by `heap::alloc` in `run`;
    /// called exactly once.
    unsafe fn finalize(ctx: *mut UnrefSourceMapRequest) {
        // SAFETY: caller contract — ctx is the original Box allocation; no
        // live borrow of *ctx exists.
        let ctx = unsafe { bun_core::heap::take(ctx) };
        // SAFETY: dev outlives the request
        unsafe {
            (*ctx.dev)
                .server
                .as_mut()
                .unwrap()
                .on_static_request_complete()
        };
        drop(ctx);
    }

    /// SAFETY: `ctx` must be the pointer returned by `heap::alloc` in `run`.
    /// On `Ok` this consumes `ctx` via `finalize`; on `Err` ownership stays
    /// with the caller (BodyReaderMixin → `on_error`).
    unsafe fn run_with_body(
        ctx: *mut UnrefSourceMapRequest,
        body: &[u8],
        r: AnyResponse,
    ) -> crate::Result<()> {
        if body.len() != 8 {
            return Err(crate::Error::InvalidRequest);
        }
        let mut generation_bytes = [0u8; 4];
        strings::decode_hex_to_bytes(&mut generation_bytes, body)
            .map_err(|_| crate::Error::InvalidRequest)?;
        let generation = u32::from_ne_bytes(generation_bytes);
        let source_map_key = source_map_store::Key::init((generation as u64) << 32);
        // SAFETY: ctx is live (caller contract); dev outlives the request; the
        // exclusive reborrow is narrowed to `source_maps` for this statement.
        let _ = unsafe { &mut (*(*ctx).dev).source_maps }.remove_or_upgrade_weak_ref(
            source_map_key,
            source_map_store::RemoveOrUpgradeMode::Remove,
        );
        r.write_status(b"204 No Content");
        r.end(b"", false);
        // SAFETY: ctx is the original heap-allocated pointer; the only borrow
        // derived from it points into a separate DevServer allocation and has
        // ended.
        unsafe { Self::finalize(ctx) };
        Ok(())
    }
}

/// Returns the pathname of a URL or HTTP request target, without the query string or hash.
/// Returns a target that doesn't have a path (`CONNECT host:port`, `OPTIONS *`) unchanged.
pub(super) fn extract_pathname_from_url(url: &[u8]) -> &[u8] {
    let pathname = if url.first() == Some(&b'/') {
        url
    } else if let Some(scheme_end) = strings::index_of(url, b"://") {
        let after_scheme = &url[scheme_end + b"://".len()..];
        match strings::index_of_any(after_scheme, b"/?#") {
            Some(path_start) if after_scheme[path_start] == b'/' => &after_scheme[path_start..],
            _ => b"/",
        }
    } else {
        return url;
    };
    &pathname[..strings::index_of_any(pathname, b"?#").unwrap_or(pathname.len())]
}
