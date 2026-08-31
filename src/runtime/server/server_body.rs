use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;
use std::io::Write as _;

use crate::api::js_bundler::PluginJscExt as _;
use crate::api::{SocketAddress, js_bundler as JSBundler};
use crate::bake::framework_router as FrameworkRouter;
use crate::bake::{self as bake};
use crate::node::types::PathLikeExt as _;
use crate::webcore::BlobExt;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::fetch as Fetch;
use crate::webcore::{
    self as WebCore, AbortSignal, AnyBlob, Blob, FetchHeaders, Request, Response, request,
};
use ::bstr::BStr;
use bun_collections::HashMap;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_core::{Output, fmt as bun_fmt};
use bun_http::{self as http, Method, MimeType};
use bun_jsc::Debugger::DebuggerId;
use bun_jsc::HeadersRef;
use bun_jsc::uuid::UUID;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, GlobalRef, JSGlobalObject, JSPromise, JSValue, JsError,
    JsResult, Node, StringJsc as _, VirtualMachine, host_fn,
};
use bun_paths as paths;
use bun_ptr::{JsCell, RefPtr, ThisPtr};
use bun_resolver::fs::FileSystem;
use bun_standalone_graph::StandaloneModuleGraph;
use bun_sys as sys;
use bun_url::URL;
use bun_uws::{self as uws, AnyWebSocket, ResponseKind, WebSocketUpgradeContext};
use bun_uws_sys as uws_sys;
use bun_wyhash::hash;

bun_output::declare_scope!(Server, visible);
bun_output::declare_scope!(RequestContext, visible);

macro_rules! httplog {
    ($($arg:tt)*) => { bun_output::scoped_log!(Server, $($arg)*) };
}
macro_rules! ctx_log {
    ($($arg:tt)*) => { bun_output::scoped_log!(RequestContext, $($arg)*) };
}

use bun_jsc::bun_string_jsc;

// ─── Re-exports ──────────────────────────────────────────────────────────────
pub(super) use super::html_bundle::{self as html_bundle, HTMLBundle};
// TODO: rename to StaticBlobRoute? the html bundle is sometimes a static route
pub(super) use super::any_request_context::AnyRequestContext;
pub(super) use super::file_route::FileRoute;
pub(super) use super::node_http_response::NodeHTTPResponse;
pub(super) use super::request_context::{
    DeferDeinitFlag, REQUEST_CONTEXT_POOL_CAPACITY, RequestContext as NewRequestContext,
    UpgradeState,
};
pub(super) use super::server_config::{self as server_config, ServerConfig};
pub(super) use super::server_web_socket::ServerWebSocket;
pub(super) use super::static_route::StaticRoute;

// ─── RequestCtx trait ────────────────────────────────────────────────────────
// NOTE: Stable Rust has no inherent associated types, so the per-transport
// request handle type of `RequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, MUX>`
// is surfaced via this local trait: it lets one generic body serve HTTP/1,
// HTTP/2 and HTTP/3 without naming the concrete context type. The response
// handle is a separate generic (`R: RespLike`) at each dispatch entry point:
// the MUX instantiation serves both `h2::Response` and `h3::Response`.
type CtxPool<Ctx> = bun_collections::hive_array::Fallback<Ctx, { REQUEST_CONTEXT_POOL_CAPACITY }>;
type CtxSlot<Ctx> =
    bun_collections::hive_array::Pooled<'static, Ctx, { REQUEST_CONTEXT_POOL_CAPACITY }>;

#[allow(clippy::too_many_arguments)]
pub(super) trait RequestCtx<const SSL: bool, const DEBUG: bool>:
    super::any_request_context::CtxKind + Sized + 'static
{
    type Req: ReqLike;
    const IS_MUX: bool;

    /// The server's pool for this transport.
    fn pool(server: &NewServer<SSL, DEBUG>) -> &'static CtxPool<Self>;

    fn init(
        slot: NonNull<Self>,
        server: bun_ptr::BackRef<NewServer<SSL, DEBUG>, bun_ptr::Root>,
        req: &mut Self::Req,
        resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<http::Method>,
    ) -> Self;
    fn adopt_pool_slot(&self, slot: CtxSlot<Self>);
    fn on_response(
        &self,
        server: &NewServer<SSL, DEBUG>,
        request_value: JSValue,
        response_value: JSValue,
    );
    fn deinit(&self);
    fn should_render_missing(&self) -> bool;
    fn render_missing(&self);
    fn to_async(&self, req: &mut Self::Req, request_object: &Request);
    /// The heap `Request`, while the context still holds it.
    fn request(&self) -> Option<&Request>;
    /// `to_async` (which also detaches the stack request), or just its
    /// abort-handler arming when the `Request` is gone.
    fn arm_async(&self, req: &mut Self::Req) {
        match self.request() {
            Some(request) => self.to_async(req, request),
            None => self.set_abort_handler(),
        }
    }
    /// Detach the borrowed stack request from the heap `Request` so the JS
    /// object never dangles a pointer past the uWS frame it borrowed.
    fn detach_uws_request(&self) {
        if let Some(request) = self.request() {
            request.request_context.get().detach_request();
        }
    }
    fn set_abort_handler(&self);
    fn ctx_method(&self) -> http::Method;
    fn set_defer_deinit(&self, flag: Option<DeferDeinitFlag>);
    fn set_request_body(&self, body: Option<crate::webcore::body::BodyHiveHandle>);
    fn set_signal(&self, sig: NonNull<AbortSignal>);
    fn set_request_weakref(&self, weak: crate::webcore::request::WeakRef);
    fn clear_req(&self);
    fn set_is_web_browser_navigation(&self, v: bool);
    fn set_request_body_content_len(&self, len: usize);
    fn set_is_transfer_encoding(&self, v: bool);
    fn set_is_waiting_for_request_body(&self, v: bool);
    fn arm_on_data(&self, resp: uws::AnyResponse);
    // body-streaming callback hooks (type-erased, stored on `Body::PendingValue`).
    // `this` must be a live `*mut Self` cast to `*mut c_void`.
    fn on_start_buffering_callback(this: NonNull<c_void>);
    fn on_start_streaming_request_body_callback(this: NonNull<c_void>) -> WebCore::DrainResult;
    fn on_request_body_readable_stream_available(
        this: NonNull<c_void>,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    );
}

macro_rules! impl_request_ctx {
    ($mux:literal, $Req:ty, $pool:ident) => {
        impl<const SSL: bool, const DEBUG: bool> RequestCtx<SSL, DEBUG>
            for NewRequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, $mux>
        {
            type Req = $Req;
            const IS_MUX: bool = $mux;

            #[inline]
            fn pool(server: &NewServer<SSL, DEBUG>) -> &'static CtxPool<Self> {
                $pool(server)
            }
            #[inline]
            fn init(
                slot: NonNull<Self>,
                server: bun_ptr::BackRef<NewServer<SSL, DEBUG>, bun_ptr::Root>,
                req: &mut Self::Req,
                resp: uws::AnyResponse,
                should_deinit_context: Option<DeferDeinitFlag>,
                method: Option<http::Method>,
            ) -> Self {
                Self::init(
                    slot,
                    server,
                    std::ptr::from_mut(req).cast(),
                    resp,
                    should_deinit_context,
                    method,
                )
            }
            #[inline]
            fn adopt_pool_slot(&self, slot: CtxSlot<Self>) {
                self.pool_slot.set(Some(slot));
            }
            #[inline]
            fn on_response(&self, server: &NewServer<SSL, DEBUG>, rq: JSValue, rv: JSValue) {
                Self::on_response(self, server, rq, rv)
            }
            #[inline]
            fn deinit(&self) {
                Self::deinit(self)
            }
            #[inline]
            fn should_render_missing(&self) -> bool {
                Self::should_render_missing(self)
            }
            #[inline]
            fn render_missing(&self) {
                Self::render_missing(self)
            }
            #[inline]
            fn to_async(&self, req: &mut Self::Req, ro: &Request) {
                Self::to_async(self, std::ptr::from_mut(req).cast(), ro)
            }
            #[inline]
            fn request(&self) -> Option<&Request> {
                self.request_weakref.get().peek()
            }
            #[inline]
            fn set_abort_handler(&self) {
                Self::set_abort_handler(self)
            }
            #[inline]
            fn ctx_method(&self) -> http::Method {
                self.method
            }
            #[inline]
            fn set_defer_deinit(&self, flag: Option<DeferDeinitFlag>) {
                self.defer_deinit_until_callback_completes.set(flag)
            }
            #[inline]
            fn set_request_body(&self, body: Option<crate::webcore::body::BodyHiveHandle>) {
                self.request_body.set(body)
            }
            #[inline]
            fn set_signal(&self, sig: NonNull<AbortSignal>) {
                // `AbortSignal::new` returns a raw +1 ref to a C++-refcounted opaque;
                // `RequestContext.signal` stores it and pairs the unref in
                // RequestContext cleanup (which drops both the pending-activity
                // count and the intrusive ref).
                self.signal.set(Some(sig));
            }
            #[inline]
            fn set_request_weakref(&self, weak: crate::webcore::request::WeakRef) {
                self.request_weakref.set(weak);
            }
            #[inline]
            fn clear_req(&self) {
                self.req.set(None)
            }
            #[inline]
            fn set_is_web_browser_navigation(&self, v: bool) {
                self.flags.set_is_web_browser_navigation(v)
            }
            #[inline]
            fn set_request_body_content_len(&self, len: usize) {
                self.request_body_content_len.set(len)
            }
            #[inline]
            fn set_is_transfer_encoding(&self, v: bool) {
                self.flags.set_is_transfer_encoding(v)
            }
            #[inline]
            fn set_is_waiting_for_request_body(&self, v: bool) {
                self.flags.set_is_waiting_for_request_body(v)
            }
            #[inline]
            fn arm_on_data(&self, resp: uws::AnyResponse) {
                resp.on_data(
                    |ctx: *mut Self, chunk: &[u8], last: bool| {
                        Self::on_buffered_body_chunk(ctx, chunk, last)
                    },
                    self.as_ctx_ptr(),
                );
            }
            #[inline]
            fn on_start_buffering_callback(this: NonNull<c_void>) {
                Self::on_start_buffering_callback(this)
            }
            #[inline]
            fn on_start_streaming_request_body_callback(
                this: NonNull<c_void>,
            ) -> WebCore::DrainResult {
                Self::on_start_streaming_request_body_callback(this)
            }
            #[inline]
            fn on_request_body_readable_stream_available(
                this: NonNull<c_void>,
                global_this: &JSGlobalObject,
                readable: WebCore::ReadableStream,
            ) {
                Self::on_request_body_readable_stream_available(this, global_this, readable)
            }
        }
    };
}

fn h1_pool<const SSL: bool, const DEBUG: bool>(
    server: &NewServer<SSL, DEBUG>,
) -> &'static CtxPool<ServerRequestContext<SSL, DEBUG>> {
    server.request_pool
}
fn mux_pool<const SSL: bool, const DEBUG: bool>(
    server: &NewServer<SSL, DEBUG>,
) -> &'static CtxPool<ServerMuxRequestContext<SSL, DEBUG>> {
    server
        .mux_request_pool
        .get()
        .expect("HTTP/2 or HTTP/3 request dispatched but mux_request_pool was never allocated")
}
impl_request_ctx!(false, uws_sys::Request, h1_pool);
impl_request_ctx!(true, uws_sys::h3::Request, mux_pool);

// NOTE: local request/response traits so generic `Ctx::Req` / `R: RespLike`
// call sites can dispatch to any uWS HTTP/1, HTTP/2 or HTTP/3 handle type without
// touching `bun_uws_sys`. Only the surface `prepare_js_request_context_for`
// actually needs is exposed.
pub(super) trait ReqLike {
    fn header(&mut self, name: &[u8]) -> Option<&[u8]>;
    /// Whether the transport frames the body with a Transfer-Encoding header.
    /// This is the parser's verdict, not a lookup of the first header field.
    fn has_transfer_encoding(&mut self) -> bool;
    fn method(&mut self) -> &[u8];
    fn url(&mut self) -> &[u8];
    fn set_yield(&mut self, y: bool);
}
impl ReqLike for uws_sys::Request {
    #[inline]
    fn header(&mut self, name: &[u8]) -> Option<&[u8]> {
        uws_sys::Request::header(self, name)
    }
    #[inline]
    fn has_transfer_encoding(&mut self) -> bool {
        uws_sys::Request::has_transfer_encoding(self)
    }
    #[inline]
    fn method(&mut self) -> &[u8] {
        uws_sys::Request::method(self)
    }
    #[inline]
    fn url(&mut self) -> &[u8] {
        uws_sys::Request::url(self)
    }
    #[inline]
    fn set_yield(&mut self, y: bool) {
        uws_sys::Request::set_yield(self, y)
    }
}
impl ReqLike for uws_sys::h3::Request {
    #[inline]
    fn header(&mut self, name: &[u8]) -> Option<&[u8]> {
        uws_sys::h3::Request::header(self, name)
    }
    /// HTTP/3 has no transfer codings (RFC 9114 4.2): the body ends at the
    /// QUIC stream FIN, and a request that carries the header is rejected
    /// before this is consulted.
    #[inline]
    fn has_transfer_encoding(&mut self) -> bool {
        false
    }
    #[inline]
    fn method(&mut self) -> &[u8] {
        uws_sys::h3::Request::method(self)
    }
    #[inline]
    fn url(&mut self) -> &[u8] {
        uws_sys::h3::Request::url(self)
    }
    #[inline]
    fn set_yield(&mut self, y: bool) {
        uws_sys::h3::Request::set_yield(self, y)
    }
}

pub(super) trait RespLike {
    const IS_MUX: bool;
    fn write_status(&mut self, status: &[u8]);
    fn end_without_body(&mut self, close_connection: bool);
    fn timeout(&mut self, seconds: u8);
    fn on_timeout_warn(&mut self, ud: *mut c_void);
    fn to_any_response(&mut self) -> uws::AnyResponse;
    /// HTTP/2 only: END_STREAM on the HEADERS frame, or `content-length: 0`.
    fn request_body_ended(&mut self) -> bool;
}
impl<const SSL: bool> RespLike for uws_sys::NewAppResponse<SSL> {
    const IS_MUX: bool = false;
    #[inline]
    fn request_body_ended(&mut self) -> bool {
        false
    }
    #[inline]
    fn write_status(&mut self, s: &[u8]) {
        uws_sys::NewAppResponse::<SSL>::write_status(self, s)
    }
    #[inline]
    fn end_without_body(&mut self, c: bool) {
        uws_sys::NewAppResponse::<SSL>::end_without_body(self, c)
    }
    #[inline]
    fn timeout(&mut self, s: u8) {
        uws_sys::NewAppResponse::<SSL>::timeout(self, s)
    }
    #[inline]
    fn on_timeout_warn(&mut self, ud: *mut c_void) {
        // The dev-mode idle-timeout warning ignores both args; the user-data
        // pointer is an opaque sentinel (any non-null value satisfies uWS).
        uws_sys::NewAppResponse::<SSL>::on_timeout(
            self,
            |_: *mut c_void, _: &mut uws_sys::NewAppResponse<SSL>| on_timeout_for_idle_warn(),
            ud,
        );
    }
    #[inline]
    fn to_any_response(&mut self) -> uws::AnyResponse {
        // SAFETY: NewAppResponse<true>/NewAppResponse<false> are the only two
        // monomorphizations; cast through the matching `From` arm. The const
        // bool is checked at compile time so only one branch is reachable.
        if SSL {
            uws::AnyResponse::from(
                std::ptr::from_mut::<Self>(self).cast::<uws_sys::NewAppResponse<true>>(),
            )
        } else {
            uws::AnyResponse::from(
                std::ptr::from_mut::<Self>(self).cast::<uws_sys::NewAppResponse<false>>(),
            )
        }
    }
}
impl RespLike for uws_sys::h3::Response {
    const IS_MUX: bool = true;
    /// The QUIC FIN is only seen by a read after dispatch.
    #[inline]
    fn request_body_ended(&mut self) -> bool {
        false
    }
    #[inline]
    fn write_status(&mut self, s: &[u8]) {
        uws_sys::h3::Response::write_status(self, s)
    }
    #[inline]
    fn end_without_body(&mut self, c: bool) {
        uws_sys::h3::Response::end_without_body(self, c)
    }
    #[inline]
    fn timeout(&mut self, s: u8) {
        uws_sys::h3::Response::timeout(self, s)
    }
    #[inline]
    fn on_timeout_warn(&mut self, ud: *mut c_void) {
        uws_sys::h3::Response::on_timeout(
            self,
            |_: &mut c_void, _: &mut uws_sys::h3::Response| on_timeout_for_idle_warn(),
            ud,
        );
    }
    #[inline]
    fn to_any_response(&mut self) -> uws::AnyResponse {
        uws::AnyResponse::from(std::ptr::from_mut::<Self>(self))
    }
}
impl RespLike for uws_sys::h2::Response {
    const IS_MUX: bool = true;
    #[inline]
    fn request_body_ended(&mut self) -> bool {
        uws_sys::h2::Response::request_body_ended(self)
    }
    #[inline]
    fn write_status(&mut self, s: &[u8]) {
        uws_sys::h2::Response::write_status(self, s)
    }
    #[inline]
    fn end_without_body(&mut self, c: bool) {
        uws_sys::h2::Response::end_without_body(self, c)
    }
    #[inline]
    fn timeout(&mut self, s: u8) {
        uws_sys::h2::Response::timeout(self, s)
    }
    #[inline]
    fn on_timeout_warn(&mut self, ud: *mut c_void) {
        uws_sys::h2::Response::on_timeout(
            self,
            |_: &mut c_void, _: &mut uws_sys::h2::Response| on_timeout_for_idle_warn(),
            ud,
        );
    }
    #[inline]
    fn to_any_response(&mut self) -> uws::AnyResponse {
        uws::AnyResponse::from(std::ptr::from_mut::<Self>(self))
    }
}

/// Answer a request that arrived after `finalize()` set the wrapper's
/// `JsRef` to `Finalized` (idle keep-alive sockets aren't counted in
/// `pending_requests`, so `self` can outlive the wrapper between the
/// finalizer and the next-tick `schedule_deinit`). 503 instead of
/// dispatching into a dead handler shadow. One helper so every dispatch
/// trampoline gets the same guard. H1 closes the connection; H2/H3 end only
/// this stream (`!R::IS_MUX`) so sibling streams on the same connection
/// survive — same per-protocol close treatment as the other reject fast
/// paths.
#[inline]
pub(super) fn respond_stopped_503<R: RespLike + ?Sized>(resp: &mut R) {
    resp.write_status(b"503 Service Unavailable");
    resp.end_without_body(!R::IS_MUX);
}

/// RFC 6455 §4.1: |Sec-WebSocket-Key| is the base64 encoding of a 16-byte
/// value, i.e. 22 base64 characters followed by `==`.
#[inline]
fn is_valid_sec_websocket_key(key: &[u8]) -> bool {
    key.len() == 24
        && key[22] == b'='
        && key[23] == b'='
        && key[..22]
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/')
}

type ServerRequestContext<const SSL: bool, const DEBUG: bool> =
    NewRequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, false>;
type ServerMuxRequestContext<const SSL: bool, const DEBUG: bool> =
    NewRequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, true>;

// ─── BunInfo (moved from bun_core::Global) ───────────────────────────────────
// `generate()` builds the JSON AST by hand: an `E.Object` with
// `bun_version` (string) + `platform` (nested `E.Object` of `os`/`arch`/
// `version`, enums emitted as `@tagName` strings).
pub(crate) mod BunInfo {
    use bun_analytics::generate_header::generate_platform;
    use bun_analytics::{OperatingSystem, Platform};
    use bun_ast::Loc;
    use bun_ast::e::EString;
    use bun_ast::{E, Expr, G};
    use bun_core::Environment::Architecture;
    use bun_core::Global;

    pub(crate) struct BunInfo {
        pub(crate) bun_version: &'static [u8],
        pub(crate) platform: Platform,
    }

    fn os_tag_name(os: OperatingSystem) -> &'static [u8] {
        match os {
            OperatingSystem::Linux => b"linux",
            OperatingSystem::Macos => b"macos",
            OperatingSystem::Windows => b"windows",
            OperatingSystem::Wsl => b"wsl",
            OperatingSystem::Android => b"android",
            OperatingSystem::Freebsd => b"freebsd",
        }
    }

    fn arch_tag_name(arch: Architecture) -> &'static [u8] {
        match arch {
            Architecture::X64 => b"x64",
            Architecture::Arm64 => b"arm",
            Architecture::Wasm => b"wasm",
        }
    }

    #[inline]
    fn str_expr(s: &[u8]) -> Expr {
        Expr::init(EString::init(s), Loc::EMPTY)
    }

    #[inline]
    fn prop(key: &'static [u8], value: Expr) -> G::Property {
        G::Property {
            key: Some(str_expr(key)),
            value: Some(value),
            ..G::Property::default()
        }
    }

    /// `_transpiler` is an unused witness; expressions allocate from the
    /// global expr `Store` used by `Expr::init`.
    pub(crate) fn generate<B>(_transpiler: B) -> Result<Expr, crate::Error> {
        let info = BunInfo {
            bun_version: Global::package_json_version.as_bytes(),
            platform: generate_platform::for_os(),
        };

        // `JSON.toAST(allocator, BunInfo, info)` — hand-expanded:
        let platform_props = bun_alloc::AstAlloc::vec_from_iter([
            prop(b"os", str_expr(os_tag_name(info.platform.os))),
            prop(
                b"arch",
                str_expr(arch_tag_name(bun_core::Environment::ARCH)),
            ),
            prop(b"version", str_expr(info.platform.version)),
        ]);
        let platform_expr = Expr::init(
            E::Object {
                properties: platform_props,
                is_single_line: false,
                ..E::Object::default()
            },
            Loc::EMPTY,
        );

        let root_props = bun_alloc::AstAlloc::vec_from_iter([
            prop(b"bun_version", str_expr(info.bun_version)),
            prop(b"platform", platform_expr),
        ]);
        Ok(Expr::init(
            E::Object {
                properties: root_props,
                is_single_line: false,
                ..E::Object::default()
            },
            Loc::EMPTY,
        ))
    }
}

// ─── AnyRoute ────────────────────────────────────────────────────────────────
// The enum itself lives in mod.rs; this block adds the JS-facing constructors.
pub(super) use super::AnyRoute;

impl AnyRoute {
    fn bundled_html_manifest_item_from_js(
        argument: JSValue,
        index_path: &[u8],
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if !argument.is_object() {
            return Ok(None);
        }

        let Some(path_js) = argument.get(init_ctx.global, b"path")? else {
            return Ok(None);
        };
        let mut path = Node::PathOrFileDescriptor::Path(Node::PathLike::from_bun_string(
            init_ctx.global,
            BunString::from_js(path_js, init_ctx.global)?,
            false,
        )?);

        // Construct the route by stripping paths above the root.
        //
        //    "./index-abc.js" -> "/index-abc.js"
        //    "../index-abc.js" -> "/index-abc.js"
        //    "/index-abc.js" -> "/index-abc.js"
        //    "index-abc.js" -> "/index-abc.js"
        //
        let path_slice = path.path().slice();
        let cwd: &[u8] = if StandaloneModuleGraph::is_bun_standalone_file_path(path_slice) {
            StandaloneModuleGraph::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes()
        } else {
            FileSystem::instance().top_level_dir
        };

        let abs_path = FileSystem::instance().abs(&[path_slice]);
        let mut relative_path = FileSystem::instance().relative(cwd, abs_path);

        if relative_path.starts_with(b"./") {
            relative_path = &relative_path[2..];
        } else if relative_path.starts_with(b"../") {
            while relative_path.starts_with(b"../") {
                relative_path = &relative_path[3..];
            }
        }
        let is_index_route = path.path().slice() == index_path;
        let mut builder: Vec<u8> = Vec::new();
        if !relative_path.starts_with(b"/") {
            builder.push(b'/');
        }
        builder.extend_from_slice(relative_path);

        let Some(headers_js) = argument.get(init_ctx.global, b"headers")? else {
            return Ok(None);
        };
        let fetch_headers = FetchHeaders::create_from_js(init_ctx.global, headers_js)?;
        let _fh_guard = scopeguard::guard(fetch_headers, |fh| {
            // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
            if let Some(h) = fh {
                bun_opaque::opaque_deref_mut(h.as_ptr()).deref();
            }
        });

        // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
        let headers_ref = fetch_headers.map(|p| bun_opaque::opaque_deref(p.as_ptr().cast_const()));
        let route = Self::from_options(init_ctx.global, headers_ref, &mut path)?;

        if is_index_route {
            return Ok(Some(route));
        }

        let mut methods =
            bun_http_types::Method::Optional::Method(bun_http_types::Method::Set::empty());
        methods.insert(Method::GET);
        methods.insert(Method::HEAD);

        init_ctx.user_routes.push(server_config::StaticRouteEntry {
            path: builder.into_boxed_slice(),
            route,
            method: methods,
        });
        Ok(None)
    }

    /// This is the JS representation of an HTMLImportManifest
    fn bundled_html_manifest_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if !argument.is_object() {
            return Ok(None);
        }

        let Some(index) = argument.get_optional_slice(init_ctx.global, b"index")? else {
            return Ok(None);
        };

        let Some(files) = argument.get_array(init_ctx.global, b"files")? else {
            return Ok(None);
        };
        let mut iter = files.array_iterator(init_ctx.global)?;
        let mut html_route: Option<AnyRoute> = None;
        while let Some(file_entry) = iter.next()? {
            if let Some(item) =
                Self::bundled_html_manifest_item_from_js(file_entry, index.slice(), init_ctx)?
            {
                html_route = Some(item);
            }
        }

        Ok(html_route)
    }

    pub(crate) fn from_options(
        global: &JSGlobalObject,
        headers: Option<&FetchHeaders>,
        path: &mut Node::PathOrFileDescriptor<'static>,
    ) -> JsResult<AnyRoute> {
        // The file/static route doesn't ref it.
        let blob = <Blob as BlobExt>::find_or_create_file_from_path(path, global, false);

        if blob.needs_to_read_file() {
            // Throw a more helpful error upfront if the file does not exist.
            //
            // In production, you do NOT want to find out that all the assets
            // are 404'ing when the user goes to the route. You want to find
            // that out immediately so that the health check on startup fails
            // and the process exits with a non-zero status code.
            if let Some(store) = blob.store.get().as_deref() {
                if let Some(store_path) = store.get_path() {
                    // NOTE: `sys::exists_at_type` takes `&ZStr`; the store
                    // path is a borrowed byte slice. NUL-terminate into a path
                    // buffer for the syscall.
                    let mut buf = bun_paths::PathBuffer::default();
                    let zpath = bun_paths::resolve_path::z(store_path, &mut buf);
                    match sys::exists_at_type(sys::Fd::cwd(), zpath) {
                        Ok(sys::ExistsAtType::Directory) => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "Bundled file {} cannot be a directory. You may want to configure --asset-naming or `naming` when bundling.",
                                bun_fmt::quote(store_path)
                            )));
                        }
                        Ok(sys::ExistsAtType::File) => {}
                        Err(_) => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "Bundled file {} not found. You may want to configure --asset-naming or `naming` when bundling.",
                                bun_fmt::quote(store_path)
                            )));
                        }
                    }
                }
            }

            return Ok(AnyRoute::File(FileRoute::init_from_blob(
                blob,
                &super::file_route::InitOptions {
                    server: None,
                    status_code: 200,
                    headers,
                },
            )));
        }

        Ok(AnyRoute::Static(StaticRoute::init_from_any_blob(
            AnyBlob::Blob(blob),
            super::static_route::InitFromBytesOptions {
                server: None,
                headers,
                ..Default::default()
            },
        )))
    }

    pub(crate) fn html_route_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        use bun_collections::zig_hash_map::MapEntry as StdEntry;
        if let Some(html_bundle) = argument.as_class_this_ptr::<HTMLBundle>() {
            let entry = init_ctx
                .dedupe_html_bundle_map
                .entry(html_bundle.as_ptr().cast_const());
            // HashMap aborts on OOM (repo-wide abort-on-OOM policy).
            return Ok(Some(match entry {
                StdEntry::Vacant(v) => {
                    // The rc=1 `Route::init(..)` is returned to the caller; the
                    // map slot is a non-owning back-reference for deduping later
                    // entries in this same config.
                    let route = html_bundle::Route::init(html_bundle);
                    v.insert(route.this_ptr().into());
                    AnyRoute::Html(route)
                }
                StdEntry::Occupied(o) => AnyRoute::Html(RefPtr::from_this(o.get().this_ptr())),
            }));
        }

        if let Some(html_route) = Self::bundled_html_manifest_from_js(argument, init_ctx)? {
            return Ok(Some(html_route));
        }

        Ok(None)
    }

    pub fn from_js(
        global: &JSGlobalObject,
        path: &[u8],
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        if let Some(html_route) = AnyRoute::html_route_from_js(argument, init_ctx)? {
            return Ok(Some(html_route));
        }

        if argument.is_object() {
            if let Some(dir) = argument.get_optional_slice(global, b"dir")? {
                let relative_root = init_ctx.js_string_allocations.track(dir);

                if !strings::ends_with(path, b"/*") {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "To mount a directory, make sure the path ends in `/*`"
                    )));
                }

                let style_js = argument.get(global, b"style")?;
                if style_js.is_none() {
                    if strings::index_of_char(path, b':').is_some() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Directory routes do not support :parameters; use a fixed prefix ending in `/*`"
                        )));
                    }
                    if strings::contains(path, b"//") {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Directory route paths cannot contain empty segments"
                        )));
                    }
                    // `{ dir }` without `style` serves the directory tree
                    // verbatim; `{ dir, style }` opts into framework routing.
                    let url_prefix: &[u8] = if path.len() == 2 {
                        b"/"
                    } else {
                        &path[..path.len() - 1]
                    };
                    let stat_cache = argument
                        .get_boolean_loose(global, b"statCache")?
                        .unwrap_or(true);
                    let route = super::DirectoryRoute::create(
                        global,
                        relative_root,
                        url_prefix,
                        stat_cache,
                    )?;
                    return Ok(Some(AnyRoute::Directory(route)));
                }

                let style: FrameworkRouter::Style =
                    FrameworkRouter::Style::from_js(style_js.unwrap(), global)?;
                // Style impls Drop; `?` drops it on the error path.

                // trim the /*
                // NOTE: `FileSystemRouterType` fields are `Cow<'static,[u8]>`.
                // Rather
                // than erasing a lifetime through a raw-pointer round-trip
                // (banned per PORTING.md), copy the prefix bytes here — the
                // route table is built once at server startup, so the extra
                // allocation is cold.
                use std::borrow::Cow;
                let prefix: Cow<'static, [u8]> = if path.len() == 2 {
                    Cow::Borrowed(b"/")
                } else {
                    Cow::Owned(path[..path.len() - 2].to_vec())
                };
                init_ctx
                    .framework_router_list
                    .push(bake::FileSystemRouterType {
                        root: Cow::Owned(relative_root.to_vec()),
                        style,
                        prefix,
                        // TODO: customizable framework option.
                        entry_client: Some(Cow::Borrowed(b"bun-framework-react/client.tsx")),
                        entry_server: Cow::Borrowed(b"bun-framework-react/server.tsx"),
                        ignore_underscores: true,
                        ignore_dirs: vec![
                            Cow::Borrowed(b"node_modules".as_slice()),
                            Cow::Borrowed(b".git".as_slice()),
                        ],
                        extensions: vec![
                            Cow::Borrowed(b".tsx".as_slice()),
                            Cow::Borrowed(b".jsx".as_slice()),
                        ],
                        allow_layouts: true,
                    });

                // `@typeInfo(FrameworkRouter.Type.Index).@"enum".tag_type` → the index newtype's backing-int MAX.
                let limit = u8::MAX as usize;
                if init_ctx.framework_router_list.len() > limit {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Too many framework routers. Maximum is {}.",
                        limit
                    )));
                }
                return Ok(Some(AnyRoute::FrameworkRouter(
                    FrameworkRouter::TypeIndex::init(
                        u8::try_from(init_ctx.framework_router_list.len() - 1).expect("int cast"),
                    ),
                )));
            }
        }

        if let Some(file_route) = FileRoute::from_js(global, argument)? {
            return Ok(Some(AnyRoute::File(file_route)));
        }
        match StaticRoute::from_js(global, argument)? {
            Some(s) => Ok(Some(AnyRoute::Static(s))),
            None => Ok(None),
        }
    }
}

pub struct ServerInitContext<'a> {
    pub(crate) dedupe_html_bundle_map:
        HashMap<*const HTMLBundle, bun_ptr::BackRef<html_bundle::Route, bun_ptr::Root>>,
    pub(crate) js_string_allocations: bake::StringRefList,
    pub global: &'a JSGlobalObject,
    pub(crate) framework_router_list: Vec<bake::FileSystemRouterType>,
    pub(crate) user_routes: &'a mut Vec<server_config::StaticRouteEntry>,
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
/// State machine to handle loading plugins asynchronously. This structure is not thread-safe.
#[derive(bun_ptr::CellRefCounted)]
pub struct ServePlugins {
    state: JsCell<ServePluginsState>,
    /// Reference count is incremented while there are other objects waiting on plugin loads.
    ref_count: Cell<u32>,
    /// The ref the pending plugin-load promise's reactions hold (taken before
    /// `.then()`, released by `on_resolve_plugins` / `on_reject_plugins`).
    promise_ref: Cell<Option<RefPtr<ServePlugins>>>,
}

pub(crate) enum ServePluginsState {
    Unqueued(Box<[Box<[u8]>]>),
    Pending {
        /// The (GC-protected) `JSBundlerPlugin` cell.
        plugin: NonNull<JSBundler::Plugin>,
        /// Promise may be empty if the plugin load finishes synchronously.
        promise: jsc::JSPromiseStrong,
        /// Each holds a ref, released once the route is told the outcome.
        html_bundle_routes: Vec<RefPtr<html_bundle::Route>>,
        /// The server whose DevServer is waiting on the load.
        dev_server: Option<AnyServer>,
    },
    Loaded(NonNull<JSBundler::Plugin>),
    /// Error information is not stored as it is already reported.
    Err,
}

pub enum GetOrStartLoadResult<'a> {
    /// None = no plugins, used by server implementation
    Ready(Option<&'a JSBundler::Plugin>),
    Pending,
    Err,
}

#[derive(Clone, Copy)]
pub enum ServePluginsCallback {
    HtmlBundleRoute(bun_ptr::ThisPtr<html_bundle::Route>),
    /// The calling server's DevServer.
    DevServer,
}

impl ServePlugins {
    pub(crate) fn init(plugins: Box<[Box<[u8]>]>) -> RefPtr<ServePlugins> {
        RefPtr::new(ServePlugins {
            ref_count: Cell::new(1),
            state: JsCell::new(ServePluginsState::Unqueued(plugins)),
            promise_ref: Cell::new(None),
        })
    }

    pub(crate) fn get_or_start_load<'a>(
        this: bun_ptr::ThisPtr<Self>,
        global: &JSGlobalObject,
        cb: ServePluginsCallback,
        server: AnyServer,
    ) -> JsResult<GetOrStartLoadResult<'a>> {
        if matches!(this.state.get(), ServePluginsState::Unqueued(_)) {
            // could end up in any state if synchronously resolved
            Self::load_and_resolve_plugins(this, global)?;
        }
        enum Now {
            Pending,
            Loaded(NonNull<JSBundler::Plugin>),
            Err,
        }
        let now = match this.state.get() {
            ServePluginsState::Unqueued(_) => unreachable!(),
            ServePluginsState::Pending { .. } => Now::Pending,
            ServePluginsState::Loaded(plugin) => Now::Loaded(*plugin),
            ServePluginsState::Err => Now::Err,
        };
        match now {
            Now::Pending => {
                this.state.with_mut(|state| {
                    let ServePluginsState::Pending {
                        html_bundle_routes,
                        dev_server,
                        ..
                    } = state
                    else {
                        unreachable!()
                    };
                    match cb {
                        ServePluginsCallback::HtmlBundleRoute(route) => {
                            html_bundle_routes.push(RefPtr::from_this(route));
                        }
                        ServePluginsCallback::DevServer => {
                            // one dev server per server
                            debug_assert!(dev_server.is_none_or(|s| s == server));
                            *dev_server = Some(server);
                        }
                    }
                });
                Ok(GetOrStartLoadResult::Pending)
            }
            // S008: `Plugin` is an `opaque_ffi!` ZST handle (a protected JS
            // cell) — safe deref.
            Now::Loaded(plugin) => Ok(GetOrStartLoadResult::Ready(Some(bun_opaque::opaque_deref(
                plugin.as_ptr(),
            )))),
            Now::Err => Ok(GetOrStartLoadResult::Err),
        }
    }

    fn load_and_resolve_plugins(
        this: bun_ptr::ThisPtr<Self>,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        let (plugin_js_array, bunfig_folder_bunstr) = {
            let ServePluginsState::Unqueued(plugin_list) = this.state.get() else {
                unreachable!()
            };
            let bunfig_path: &[u8] = &global.bun_vm().transpiler.options.bunfig_path;
            let bunfig_folder: &[u8] = bun_paths::resolve_path::dirname::<
                bun_paths::resolve_path::platform::Auto,
            >(bunfig_path);
            let mut bunstring_array: Vec<BunString> = Vec::with_capacity(plugin_list.len());
            for raw_plugin in plugin_list.iter() {
                bunstring_array.push(BunString::from_bytes(raw_plugin));
            }
            (
                bun_string_jsc::to_js_array(global, &bunstring_array)?,
                bun_string_jsc::create_utf8_for_js(global, bunfig_folder)?,
            )
        };

        let plugin = NonNull::new(JSBundler::Plugin::create(
            global,
            bun_jsc::BunPluginTarget::Browser,
        ))
        .expect("JSBundlerPlugin__create returns a non-null protected JSCell");
        this.state.set(ServePluginsState::Pending {
            promise: jsc::JSPromiseStrong::init(global),
            plugin,
            html_bundle_routes: Vec::new(),
            dev_server: None,
        });

        global.bun_vm().event_loop_mut().enter();
        let result = jsc::host_fn::from_js_host_call(global, || {
            // S008: opaque ZST handle to the protected cell — safe deref.
            bun_opaque::opaque_deref(plugin.as_ptr())
                .load_and_resolve_plugins_for_serve(plugin_js_array, bunfig_folder_bunstr)
        });
        global.bun_vm().event_loop_mut().exit();
        let result = result?;

        // handle the case where js synchronously throws an error
        if let Some(e) = global.try_take_exception() {
            this.handle_on_reject(global, e);
            return Ok(());
        }

        if !result.is_empty_or_undefined_or_null() {
            // handle the case where js returns a promise
            if let Some(promise) = result.as_any_promise() {
                match promise.status() {
                    // promise not fulfilled yet
                    jsc::js_promise::Status::Pending => {
                        this.promise_ref.set(Some(RefPtr::from_this(this)));
                        let promise_value = promise.as_value();
                        this.state.with_mut(|state| {
                            if let ServePluginsState::Pending {
                                promise: pending_promise,
                                ..
                            } = state
                            {
                                pending_promise.set(global, promise_value);
                            }
                        });
                        promise_value.then(
                            global,
                            this.as_ptr(),
                            crate::generated_host_exports::BunServe__onResolvePlugins,
                            crate::generated_host_exports::BunServe__onRejectPlugins,
                        );
                        return Ok(());
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        this.handle_on_resolve();
                        return Ok(());
                    }
                    jsc::js_promise::Status::Rejected => {
                        let value = promise.result(global.vm());
                        this.handle_on_reject(global, value);
                        return Ok(());
                    }
                }
            }

            if let Some(e) = result.to_error() {
                this.handle_on_reject(global, e);
            } else {
                this.handle_on_resolve();
            }
        }
        Ok(())
    }

    pub(crate) fn handle_on_resolve(&self) {
        let ServePluginsState::Pending {
            plugin,
            dev_server,
            html_bundle_routes,
            promise,
        } = self.state.replace(ServePluginsState::Err)
        else {
            unreachable!()
        };
        drop(promise); // Drop on JscStrong releases the slot.

        self.state.set(ServePluginsState::Loaded(plugin));

        for route in html_bundle_routes {
            bun_core::handle_oom(html_bundle::Route::on_plugins_resolved(
                route.this_ptr(),
                Some(plugin),
            ));
        }
        if let Some(server) = dev_server {
            if let Some(r) =
                server.with_dev_server_mut(|dev| dev.on_plugins_resolved(Some(plugin.as_ptr())))
            {
                bun_core::handle_oom(r);
            }
        }
    }

    pub(crate) fn handle_on_reject(&self, global: &JSGlobalObject, err: JSValue) {
        let ServePluginsState::Pending {
            plugin,
            dev_server,
            html_bundle_routes,
            promise,
        } = self.state.replace(ServePluginsState::Err)
        else {
            unreachable!()
        };
        // The (protected) plugin cell is left as is: a bundle already running
        // with it releases it itself.
        let _ = plugin;
        drop(promise); // Drop on JscStrong releases the slot.

        for route in html_bundle_routes {
            bun_core::handle_oom(route.on_plugins_rejected());
        }
        if let Some(server) = dev_server {
            if let Some(r) = server.with_dev_server_mut(|dev| dev.on_plugins_rejected()) {
                bun_core::handle_oom(r);
            }
        }

        Output::err_generic("Failed to load plugins for Bun.serve:", ());
        global.bun_vm().as_mut().run_error_handler(err, None);
    }

    fn release_promise_ref(&self) {
        drop(self.promise_ref.take());
    }

    /// `server` (whose DevServer may be waiting on a pending load) is going away.
    pub(crate) fn forget_server(&self, server: AnyServer) {
        self.state.with_mut(|state| {
            if let ServePluginsState::Pending { dev_server, .. } = state {
                if *dev_server == Some(server) {
                    *dev_server = None;
                }
            }
        });
    }
}

impl Drop for ServePlugins {
    fn drop(&mut self) {
        match self.state.get() {
            ServePluginsState::Unqueued(_) => {}
            ServePluginsState::Pending { .. } => debug_assert!(false), // should have one ref while pending!
            // The plugin cell may still be in use by (and is released by) a
            // bundle running with it.
            ServePluginsState::Loaded(_) => {}
            ServePluginsState::Err => {}
        }
    }
}

// HOST_EXPORT(BunServe__onResolvePlugins)
pub fn on_resolve_plugins(
    this: bun_ptr::ThisPtr<ServePlugins>,
    _global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    ctx_log!("onResolve");
    let [plugins_result, _] = callframe.arguments_as_array::<2>();
    let _guard = scopeguard::guard(this, |p| p.release_promise_ref());
    plugins_result.ensure_still_alive();
    this.handle_on_resolve();
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(BunServe__onRejectPlugins)
pub fn on_reject_plugins(
    this: bun_ptr::ThisPtr<ServePlugins>,
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    ctx_log!("onReject");
    let [error_js, _] = callframe.arguments_as_array::<2>();
    let _guard = scopeguard::guard(this, |p| p.release_promise_ref());
    this.handle_on_reject(global, error_js);
    Ok(JSValue::UNDEFINED)
}

#[inline]
fn fetch_headers_from_js(value: JSValue, global: &JSGlobalObject) -> Option<*mut FetchHeaders> {
    FetchHeaders::cast_(value, global.vm()).map(|p| p.as_ptr())
}

/// Per-process latch for the dev-mode idle-timeout warning. The
/// warning is gated on `DEBUG && !silent` and only fires once globally, so a
/// single shared `AtomicBool` matches user-visible behavior.
#[inline]
fn did_send_idletimeout_warning_once() -> &'static core::sync::atomic::AtomicBool {
    static FLAG: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
    &FLAG
}

/// Emits the once-only dev-mode
/// warning. Factored out as a free fn so the `RespLike::on_timeout_warn`
/// closures (which cannot name `NewServer<SSL,DEBUG>`) can call it.
fn on_timeout_for_idle_warn() {
    if !did_send_idletimeout_warning_once().swap(true, core::sync::atomic::Ordering::Relaxed)
        && !crate::cli::Command::get().debug.silent
    {
        bun_core::pretty_errorln!(
            "<r><yellow>[Bun.serve]<r><d>:<r> request timed out after 10 seconds. Pass <d><cyan>`idleTimeout`<r> to configure."
        );
        Output::flush();
    }
}

// ─── NewServer ───────────────────────────────────────────────────────────────
// ─── NewServer (canonical type lives in mod.rs) ──────────────────────────────
// NOTE (unification): the struct, `ServerFlags`, `UserRoute`,
// `CreateJsRequest`, `PreparedRequest`, `SavedRequest`, `SavedRequestUnion`,
// `ServerAllConnectionsClosedTask`, `AnyServer` and the four type aliases are
// defined once in `super` (mod.rs). This file contributes additional inherent
// methods on the same type — there is no separate Phase-A struct.
pub(super) use super::{
    AnyServer, CreateJsRequest, DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer,
    NewServer, PreparedRequestFor, ServerFlags, UserRoute,
};

// `WebSocketUpgradeServer<SSL>`: the `/*` websocket fallback route registers
// the server itself; per-route websockets register their `UserRoute`.
impl<const SSL: bool, const DEBUG: bool> uws_sys::web_socket::WebSocketUpgradeServer<SSL>
    for NewServer<SSL, DEBUG>
{
    fn on_websocket_upgrade(
        this: ThisPtr<Self>,
        res: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws_sys::Request,
        context: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        debug_assert!(id == 0);
        Self::on_web_socket_upgrade(this, res, req, context);
    }
}

impl<const SSL: bool, const DEBUG: bool> uws_sys::web_socket::WebSocketUpgradeServer<SSL>
    for UserRoute<SSL, DEBUG>
{
    fn on_websocket_upgrade(
        this: ThisPtr<Self>,
        res: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws_sys::Request,
        context: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        debug_assert!(id == 1);
        jsc::mark_binding!();
        NewServer::<SSL, DEBUG>::upgrade_web_socket_user_route(this, res, req, context, None);
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    /// Construct the cross-module `super::AnyServer` back-reference. Routes
    /// (StaticRoute/FileRoute/HTMLBundle) store this so they can call back
    /// into `on_pending_request` / `on_static_request_complete`.
    #[inline]
    fn as_any_server(&self) -> AnyServer {
        AnyServer::from(self)
    }

    /// Shared `&VirtualMachine` accessor.
    #[inline(always)]
    fn vm_ref(&self) -> &jsc::virtual_machine::VirtualMachine {
        // `vm` is a `BackRef<VirtualMachine>` (per-thread singleton, set in
        // `init()`); safe `Deref` projection.
        self.vm.get()
    }

    /// Shared `&JSGlobalObject` accessor (struct stores it as `*const`).
    #[inline(always)]
    fn global(&self) -> GlobalRef {
        // `global_this` is set in `init()`; non-null and valid for the
        // server's lifetime (LIFETIMES.tsv: STATIC).
        GlobalRef::from(bun_opaque::opaque_deref(self.global_this))
    }

    /// Unbounded so `teardown()` (in
    /// the unbounded `impl NewServer` in mod.rs) can call it without naming
    /// the per-transport `RequestContext` bounds.
    pub(super) fn notify_inspector_server_stopped(&self) {
        if self.inspector_server_id.get().get() != 0 {
            bun_core::hint::cold();
            if let Some(debugger) = &self.vm().as_mut().debugger {
                bun_core::hint::cold();
                // NOTE (layering): the `HTTPServerAgent.notifyServerStopped`
                // wrapper lives in
                // `super::http_server_agent` so this crate-tier call doesn't
                // re-declare the C ABI.
                super::http_server_agent::notify_server_stopped(
                    &debugger.http_server_agent,
                    self.as_any_server(),
                );
                // Only clear the id once the agent has been notified, so a
                // call that races a not-yet-attached debugger leaves the id set
                // for a later retry.
                self.inspector_server_id.set(DebuggerId::init(0));
            }
        }
    }

    // NOTE: there is no `getPluginsAsync` method or `AnyServer` dispatcher;
    // the live HTMLBundle path goes through `get_or_load_plugins`.

    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub(crate) fn get_or_load_plugins(
        &self,
        callback: ServePluginsCallback,
    ) -> GetOrStartLoadResult<'_> {
        let Some(p) = self.plugins.get().as_ref().map(RefPtr::this_ptr) else {
            // no plugins
            return GetOrStartLoadResult::Ready(None);
        };
        let global = self.global();
        // Keep `*p` alive across re-entrant JS in `load_and_resolve_plugins`.
        let _keep_alive = RefPtr::from_this(p);
        match ServePlugins::get_or_start_load(p, &global, callback, self.as_any_server()) {
            Ok(r) => r,
            Err(JsError::Thrown | JsError::Terminated) => {
                panic!("unhandled exception from ServePlugins.getStartOrLoad")
            }
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_subscriber_count(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [topic_value] = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global.throw_not_enough_arguments("subscriberCount", 1, 0));
        }

        if topic_value.is_empty_or_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!(
                "subscriberCount requires a topic name as a string"
            )));
        }

        let topic_view = topic_value.to_js_string_view(global)?;
        let topic = topic_view.to_utf8();

        if topic.slice().is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        Ok(JSValue::js_number(f64::from(
            self.app_mut()
                .expect("server not listening")
                .num_subscribers(topic.slice()),
        )))
    }

    // ── host_fn.wrapInstanceMethod hand-expansions ───────────────────────

    /// `pub const doStop = host_fn.wrapInstanceMethod(ThisServer, "stopFromJS", false)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_stop(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), callframe.arguments());
        // ?jsc.JSValue
        let abruptly = iter.next_eat();
        Ok(self.stop_from_js(abruptly))
    }

    /// `pub const dispose = host_fn.wrapInstanceMethod(ThisServer, "disposeFromJS", false)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn dispose(
        &self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self.dispose_from_js())
    }

    /// `pub const doUpgrade = host_fn.wrapInstanceMethod(ThisServer, "onUpgrade", false)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_upgrade(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), callframe.arguments());
        // jsc.JSValue
        let object = iter
            .next_eat()
            .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))?;
        // ?jsc.JSValue
        let optional = iter.next_eat();
        self.on_upgrade(global, object, optional)
    }

    /// `pub const doPublish = host_fn.wrapInstanceMethod(ThisServer, "publish", false)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_publish(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), callframe.arguments());
        let topic_value = iter
            .next_eat()
            .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))?;
        if topic_value.is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!("Expected string")));
        }
        // Converting `message_value` can run user JS / GC; `topic_view` keeps
        // the topic bytes alive across it.
        let topic_view = topic_value.to_js_string_view(global)?;
        let topic = topic_view.to_utf8();
        // jsc.JSValue
        let message_value = iter
            .next_eat()
            .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))?;
        // ?jsc.JSValue
        let compress_value = iter.next_eat();
        self.publish(global, topic.slice(), message_value, compress_value)
    }

    /// `pub const doRequestIP = host_fn.wrapInstanceMethod(ThisServer, "requestIP", false)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_request_ip(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), callframe.arguments());
        let arg = iter.next_eat().ok_or_else(|| {
            global.throw_invalid_arguments(format_args!("Missing Request object"))
        })?;
        let request = arg.as_class_ref::<Request>().ok_or_else(|| {
            global.throw_invalid_arguments(format_args!("Expected Request object"))
        })?;
        self.request_ip(request)
    }

    /// `pub const doReload = onReload`
    #[inline]
    pub(crate) fn do_reload(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.on_reload(global, callframe)
    }

    /// `pub const doFetch = onFetch`
    #[inline]
    pub(crate) fn do_fetch(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.on_fetch(global, callframe)
    }

    /// `pub const doTimeout = timeout`
    #[inline]
    pub(crate) fn do_timeout(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.timeout(global, callframe)
    }

    pub(crate) fn request_ip(&self, request: &Request) -> JsResult<JSValue> {
        if matches!(self.config().address, server_config::Address::Unix(_)) {
            return Ok(JSValue::NULL);
        }
        let Some(info) = request.request_context.get().get_remote_socket_info() else {
            return Ok(JSValue::NULL);
        };
        crate::socket::socket_address::SocketAddress::create_dto(
            &self.global(),
            &info.ip,
            u16::try_from(info.port).expect("int cast"),
            info.is_ipv6,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn timeout(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 2 || arguments[0].is_empty_or_undefined_or_null() {
            return Err(global.throw_not_enough_arguments("timeout", 2, arguments.len()));
        }

        let seconds = arguments[1];

        if matches!(self.config().address, server_config::Address::Unix(_)) {
            return Ok(JSValue::NULL);
        }

        if !seconds.is_number() {
            return Err(self
                .global()
                .throw(format_args!("timeout() requires a number")));
        }
        let value = seconds.to_u32();

        if let Some(request) = arguments[0].as_class_ref::<Request>() {
            let _ = request.request_context.get().set_timeout(value);
        } else if let Some(response) = arguments[0].as_class_ref::<NodeHTTPResponse>() {
            response.set_timeout((value % 255) as u8);
        } else {
            return Err(self
                .global()
                .throw_invalid_arguments(format_args!("timeout() requires a Request object")));
        }

        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn publish(
        &self,
        global: &JSGlobalObject,
        topic: &[u8],
        message_value: JSValue,
        compress_value: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if self.config().websocket.is_none() {
            return Ok(JSValue::js_number(0.0));
        }

        if topic.is_empty() {
            httplog!("publish() topic invalid");
            return Err(global.throw(format_args!("publish requires a topic string")));
        }

        // compress defaults to true when the argument is omitted.
        let compress_js = compress_value.unwrap_or(JSValue::TRUE);
        let compress = compress_js.to_boolean();

        // Resolve the payload before reading `self.app`: `to_js_string` can run
        // user JS that stops the server.
        let array_buffer = message_value.as_array_buffer(global);
        let message_view;
        let string_slice;
        let (buffer, opcode): (&[u8], uws_sys::Opcode) = if let Some(buffer) = &array_buffer {
            (buffer.slice(), uws_sys::Opcode::Binary)
        } else if let Some(slice) =
            super::server_web_socket::blob_payload(global, "publish", message_value)?
        {
            (slice, uws_sys::Opcode::Binary)
        } else {
            message_view = message_value.to_js_string_view(global)?;
            string_slice = message_view.to_utf8();
            (string_slice.slice(), uws_sys::Opcode::Text)
        };

        let Some(app) = self.app_ptr() else {
            return Ok(JSValue::js_number(0.0));
        };
        let status = AnyWebSocket::publish_with_options(
            SSL,
            app.cast::<c_void>(),
            topic,
            buffer,
            opcode,
            compress,
        );
        let result =
            super::server_web_socket::send_status_to_js(status, buffer.len(), "publish", "bytes");
        message_value.ensure_still_alive();
        Ok(result)
    }

    pub(crate) fn on_upgrade(
        &self,
        global: &JSGlobalObject,
        object: JSValue,
        optional: Option<JSValue>,
    ) -> JsResult<JSValue> {
        use super::node_http_response::Flags as NodeHTTPResponseFlags;
        use bun_core::Utf8Bytes;
        use bun_jsc::HTTPHeaderName;

        if self.config().websocket.is_none() {
            return Err(global.throw_invalid_arguments(format_args!(
                "To enable websocket support, set the \"websocket\" object in Bun.serve({{}})"
            )));
        }

        if self.has_flags(ServerFlags::TERMINATED) {
            return Ok(JSValue::FALSE);
        }

        // `deinit_if_we_can` only clears `handler.server` once every
        // connection has closed, so this is defensive for the `Finalized`
        // window between the wrapper's `finalize()` and the next-tick
        // `schedule_deinit`: accepting an upgrade there would create a
        // `ServerWebSocket` whose open/close accounting is skipped.
        if self
            .config()
            .websocket
            .as_ref()
            .is_some_and(|ws| ws.handler.server.is_none())
        {
            return Ok(JSValue::FALSE);
        }

        if let Some(node_http_response) = object.as_class_ref::<NodeHTTPResponse>() {
            if node_http_response
                .flags
                .get()
                .contains(NodeHTTPResponseFlags::ENDED)
                || node_http_response
                    .flags
                    .get()
                    .contains(NodeHTTPResponseFlags::SOCKET_CLOSED)
            {
                return Ok(JSValue::FALSE);
            }

            let mut data_value = JSValue::ZERO;

            // if we converted a HeadersInit to a Headers object, this owns (and frees) it
            let mut created_headers: Option<HeadersRef> = None;

            // Copied out of `options.headers` because `fast_remove` frees the
            // entry they would otherwise borrow.
            let mut sec_websocket_protocol = Utf8Bytes::EMPTY;
            let mut sec_websocket_extensions = Utf8Bytes::EMPTY;

            if let Some(opts) = optional {
                'getter: {
                    if opts.is_empty_or_undefined_or_null() {
                        break 'getter;
                    }

                    if !opts.is_object() {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "upgrade options must be an object"
                        )));
                    }

                    if let Some(headers_value) = opts.fast_get(global, jsc::BuiltinName::data)? {
                        data_value = headers_value;
                    }

                    if let Some(headers_value) = opts.fast_get(global, jsc::BuiltinName::headers)? {
                        if headers_value.is_empty_or_undefined_or_null() {
                            break 'getter;
                        }

                        let fetch_headers_to_use: *mut FetchHeaders =
                            match fetch_headers_from_js(headers_value, global) {
                                Some(h) => h,
                                None => 'brk: {
                                    if headers_value.is_object() {
                                        if let Some(fetch_headers) =
                                            HeadersRef::create_from_js(global, headers_value)?
                                        {
                                            break 'brk created_headers
                                                .insert(fetch_headers)
                                                .as_ptr();
                                        }
                                    }
                                    return Err(global.throw_invalid_arguments(format_args!(
                                        "upgrade options.headers must be a Headers or an object"
                                    )));
                                }
                            };
                        // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                        let fetch_headers_to_use =
                            bun_opaque::opaque_deref_mut(fetch_headers_to_use);

                        if let Some(protocol) =
                            fetch_headers_to_use.fast_get(HTTPHeaderName::SecWebSocketProtocol)
                        {
                            sec_websocket_protocol = protocol.to_utf8().into_owned();
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use.fast_remove(HTTPHeaderName::SecWebSocketProtocol);
                        }

                        if let Some(extensions) =
                            fetch_headers_to_use.fast_get(HTTPHeaderName::SecWebSocketExtensions)
                        {
                            sec_websocket_extensions = extensions.to_utf8().into_owned();
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use
                                .fast_remove(HTTPHeaderName::SecWebSocketExtensions);
                        }
                        if let Some(raw_response) = node_http_response.raw_response.get() {
                            // we must write the status first so that 200 OK isn't written
                            raw_response.write_status(b"101 Switching Protocols");
                            fetch_headers_to_use.to_uws_response(
                                if SSL {
                                    ResponseKind::Ssl
                                } else {
                                    ResponseKind::Tcp
                                },
                                raw_response.socket().cast::<c_void>(),
                            );
                        }
                    }
                }
            }
            return Ok(JSValue::from(node_http_response.upgrade(
                data_value,
                sec_websocket_protocol.slice(),
                sec_websocket_extensions.slice(),
            )));
        }

        let Some(request) = object.as_class_ref::<Request>() else {
            return Err(
                global.throw_invalid_arguments(format_args!("upgrade requires a Request object"))
            );
        };

        let request_ctx = request.request_context.get();
        let Some(upgrader) = request_ctx.get_ref::<ServerRequestContext<SSL, DEBUG>>() else {
            return Ok(JSValue::FALSE);
        };

        if upgrader.is_aborted_or_ended() {
            return Ok(JSValue::FALSE);
        }

        let UpgradeState::Pending(upgrade_ctx) = upgrader.upgrade_context.get() else {
            return Ok(JSValue::FALSE);
        };

        let Some(resp) = upgrader.resp.get() else {
            return Ok(JSValue::FALSE);
        };

        // Keep the upgrader alive across option getters below, which run
        // arbitrary user JS. A re-entrant server.upgrade(req) from a getter
        // would otherwise be able to deref this context out from under us.
        upgrader.ref_();
        let _upgrader_guard = scopeguard::guard(upgrader, |u| u.deref());

        let mut sec_websocket_key = Utf8Bytes::EMPTY;
        let mut sec_websocket_protocol = Utf8Bytes::EMPTY;
        let mut sec_websocket_extensions = Utf8Bytes::EMPTY;
        let mut sec_websocket_version = Utf8Bytes::EMPTY;
        let mut upgrade_header = Utf8Bytes::EMPTY;

        // NOTE: `FetchHeaders::fast_get` takes `&mut self` (FFI signature
        // is `*mut`), so go through the `BodyMixin` accessor which yields a
        // `NonNull` instead of the inherent `&FetchHeaders` getter.
        if let Some(head) = crate::webcore::body::BodyMixin::get_fetch_headers(request) {
            use jsc::HTTPHeaderName;
            // `head` is a live, intrusively-refcounted C++ handle owned by
            // `request.headers`. `FetchHeaders` is an opaque ZST FFI handle
            // (S008) — safe `*mut → &mut` via `opaque_deref_mut`.
            let head = bun_opaque::opaque_deref_mut(head.as_ptr());
            if let Some(key) = head.fast_get(HTTPHeaderName::SecWebSocketKey) {
                sec_websocket_key = key.to_utf8().into_owned();
            }
            if let Some(proto) = head.fast_get(HTTPHeaderName::SecWebSocketProtocol) {
                sec_websocket_protocol = proto.to_utf8().into_owned();
            }
            if let Some(ext) = head.fast_get(HTTPHeaderName::SecWebSocketExtensions) {
                sec_websocket_extensions = ext.to_utf8().into_owned();
            }
            if let Some(ver) = head.fast_get(HTTPHeaderName::SecWebSocketVersion) {
                sec_websocket_version = ver.to_utf8().into_owned();
            }
            if let Some(up) = head.fast_get(HTTPHeaderName::Upgrade) {
                upgrade_header = up.to_utf8().into_owned();
            }
        }

        if let Some(req_ptr) = upgrader.req.get() {
            // NOTE: `RequestContext.req` is type-erased to `*mut c_void`.
            // `server.upgrade()` is HTTP/1-only — H3 contexts have a distinct
            // generic param and `request_context.get_ref` above would have
            // returned None — so the concrete `Req` is always `uws_sys::Request`.
            // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref
            // (BACKREF; live while RequestContext.req is Some).
            let r = bun_opaque::opaque_deref(req_ptr.cast::<uws_sys::Request>().cast_const());
            for (value, name) in [
                (&mut sec_websocket_key, b"sec-websocket-key".as_slice()),
                (&mut sec_websocket_protocol, b"sec-websocket-protocol"),
                (&mut sec_websocket_extensions, b"sec-websocket-extensions"),
                (&mut sec_websocket_version, b"sec-websocket-version"),
                (&mut upgrade_header, b"upgrade"),
            ] {
                if value.is_empty() {
                    *value = Utf8Bytes::Borrowed(r.header(name).unwrap_or(b""));
                }
            }
        }

        // RFC 6455 §4.2.1: validate the client's opening handshake.
        // A request that does not name "websocket" in its |Upgrade| token list,
        // or whose |Sec-WebSocket-Key| is not base64 of 16 bytes, is not a
        // WebSocket handshake; fall through so the caller's fetch() can respond.
        if !strings::split(upgrade_header.slice(), b",")
            .any(|t| strings::eql_case_insensitive_ascii(t.trim_ascii(), b"websocket", true))
        {
            return Ok(JSValue::FALSE);
        }
        if !is_valid_sec_websocket_key(sec_websocket_key.slice()) {
            return Ok(JSValue::FALSE);
        }
        // RFC 6455 §4.4: an unsupported |Sec-WebSocket-Version| MUST be
        // answered with an HTTP error and a |Sec-WebSocket-Version| header
        // listing the versions the server understands.
        if sec_websocket_version.slice() != b"13" {
            resp.write_status(b"426 Upgrade Required");
            resp.write_header(b"Sec-WebSocket-Version", b"13");
            upgrader.flags.set_has_written_status(true);
            upgrader.end_without_body(true);
            return Ok(JSValue::FALSE);
        }
        let mut data_value = JSValue::ZERO;
        // Holds the temporarily-created FetchHeaders (if any); its `Drop` derefs it.
        let mut created_headers: Option<HeadersRef> = None;
        let mut fetch_headers_to_use: Option<*mut FetchHeaders> = None;

        if let Some(opts) = optional {
            'getter: {
                if opts.is_empty_or_undefined_or_null() {
                    break 'getter;
                }
                if !opts.is_object() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "upgrade options must be an object"
                    )));
                }
                if let Some(v) = opts.fast_get(global, jsc::BuiltinName::Data)? {
                    data_value = v;
                }

                if let Some(headers_value) = opts.fast_get(global, jsc::BuiltinName::Headers)? {
                    if headers_value.is_empty_or_undefined_or_null() {
                        break 'getter;
                    }
                    use jsc::HTTPHeaderName;
                    let fh: *mut FetchHeaders = match fetch_headers_from_js(headers_value, global) {
                        Some(h) => h,
                        None => 'brk: {
                            if headers_value.is_object() {
                                if let Some(created) =
                                    HeadersRef::create_from_js(global, headers_value)?
                                {
                                    break 'brk created_headers.insert(created).as_ptr();
                                }
                            }
                            return Err(global.throw_invalid_arguments(format_args!(
                                "upgrade options.headers must be a Headers or an object"
                            )));
                        }
                    };
                    fetch_headers_to_use = Some(fh);

                    // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                    let fh = bun_opaque::opaque_deref_mut(fh);
                    // Copied out because `fast_remove` frees the entry.
                    if let Some(p) = fh.fast_get(HTTPHeaderName::SecWebSocketProtocol) {
                        sec_websocket_protocol = p.to_utf8().into_owned();
                        fh.fast_remove(HTTPHeaderName::SecWebSocketProtocol);
                    }
                    if let Some(e) = fh.fast_get(HTTPHeaderName::SecWebSocketExtensions) {
                        sec_websocket_extensions = e.to_utf8().into_owned();
                        fh.fast_remove(HTTPHeaderName::SecWebSocketExtensions);
                    }
                }
            }
        }

        // Option getters may have run a re-entrant server.upgrade(req).
        if upgrader.is_aborted_or_ended() || upgrader.did_upgrade_web_socket() {
            return Ok(JSValue::FALSE);
        }

        // `CookieMapRef` releases the moved-out ref on every exit path of this
        // scope (including the `?` below) once `cookies_to_write` drops.
        let mut cookies_to_write = upgrader.cookies.replace(None);

        // Write status, custom headers, and cookies in one place
        if fetch_headers_to_use.is_some() || cookies_to_write.is_some() {
            resp.write_status(b"101 Switching Protocols");
            if let Some(h) = fetch_headers_to_use {
                // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(h).to_uws_response(
                    if SSL {
                        ResponseKind::Ssl
                    } else {
                        ResponseKind::Tcp
                    },
                    resp.socket().cast::<c_void>(),
                );
            }
            if let Some(c) = cookies_to_write.as_mut() {
                c.write(
                    global,
                    if SSL {
                        ResponseKind::Ssl
                    } else {
                        ResponseKind::Tcp
                    },
                    resp.socket().cast::<c_void>(),
                )?;
            }
        }
        drop(created_headers);

        // --- After this point, do not throw an exception
        // See https://github.com/oven-sh/bun/issues/1339
        upgrader.upgrade_context.set(UpgradeState::Upgraded);
        let signal = upgrader.signal.take();
        upgrader.resp.set(None);

        // Snapshot lazy url/headers before detaching (mirrors to_async_without_abort_handler).
        if request.ensure_url().is_err() {
            request.url.set(BunString::EMPTY);
        }
        if !request.has_fetch_headers() {
            if let Some(req_ptr) = upgrader.req.get() {
                request.set_fetch_headers(Some(HeadersRef::create_from_uws(req_ptr)));
            }
        }

        request.request_context.set(AnyRequestContext::NULL);
        upgrader.request_weakref.set(request::WeakRef::EMPTY);

        data_value.ensure_still_alive();
        let ws = ServerWebSocket::init(
            &self.config().websocket.as_ref().unwrap().handler,
            data_value,
            signal,
        );
        data_value.ensure_still_alive();

        resp.clear_aborted();
        resp.clear_on_data();
        resp.clear_on_writable();
        resp.clear_timeout();

        // The upgrade detaches the response and disarms onAborted, so neither
        // on_abort nor an end path can reclaim a parked handler promise's
        // claim later. Reclaim it here.
        upgrader.reclaim_promise_cell();
        upgrader.deref();

        resp.upgrade(
            ws,
            sec_websocket_key.slice(),
            sec_websocket_protocol.slice(),
            sec_websocket_extensions.slice(),
            // S008: `WebSocketUpgradeContext` is an `opaque_ffi!` ZST, safe
            // deref; `UpgradeState::Pending` documents who keeps it alive.
            Some(bun_opaque::opaque_deref_mut(upgrade_ctx.as_ptr())),
        );

        Ok(JSValue::TRUE)
    }

    /// Swaps the live server's mutable
    /// configuration (handlers, websocket, routes) with `new_config` and
    /// re-registers routes on the uws app(s). Ownership of moved-in fields
    /// transfers to `self.config`; the caller's `new_config` is left in a
    /// valid-but-emptied state and its `Drop` frees whatever was *not* taken.
    /// Any `Some(ws)` is adopted unconditionally — `Handler::from_js` already
    /// rejected configs with no non-error callback.
    pub(crate) fn on_reload_from_zig(
        &self,
        new_config: &mut ServerConfig,
        global: &JSGlobalObject,
    ) {
        httplog!("onReload");

        // `on_reload` is only reachable while the server is running (`self.app`
        // created in `listen()`).
        self.app_mut().expect("server not listening").clear_routes();
        for_each_mux_app!(self, |mux| {
            mux.clear_routes();
        });

        // `on_request` / `on_error` keep their previous value when the reload
        // config omits them. The async-context re-wrap is unconditional:
        // `with_async_context_if_needed` is a no-op when no ALS frame is
        // active, so re-wrapping on every reload keeps the captured frame in
        // sync with the call-time context. `on_reload` is a host_fn — the
        // wrapper is `callframe.this()` on the JS stack, alive even if
        // `js_value` was downgraded after stop(). The slot writes must reach
        // it so the new handlers are GC-rooted.
        let server_js = self.js_value_assert_alive();
        if !new_config.on_request.is_empty_or_undefined_or_null() {
            super::wrap_handler_slot(
                &mut new_config.on_request,
                server_js,
                global,
                Self::js_gc_on_request_set,
            );
            let v = new_config.on_request;
            self.config.with_mut(|c| c.on_request = v);
        }
        // Swap on any change, *including* clearing to ZERO when the reload
        // config omits the handler, so subsequent `on_web_socket_upgrade` /
        // `set_routes` stop routing through the node:http path.
        //
        // Never the other direction: a server that was not created as a
        // node:http server cannot become one through reload(). listen()
        // already sized every future connection's socket ext block for this
        // server's kind (HttpResponseData vs the bigger NodeHttpResponseData)
        // and set_routes would swap the context onto the node:http handler
        // instantiation under those already-sized allocations, so the node
        // request path would construct and index past them.
        if self.config().is_node_http_server
            && self.config().on_node_http_request != new_config.on_node_http_request
        {
            super::wrap_handler_slot(
                &mut new_config.on_node_http_request,
                server_js,
                global,
                Self::js_gc_on_node_http_request_set,
            );
            let v = new_config.on_node_http_request;
            self.config.with_mut(|c| c.on_node_http_request = v);
        }
        if !new_config.on_error.is_empty_or_undefined_or_null() {
            super::wrap_handler_slot(
                &mut new_config.on_error,
                server_js,
                global,
                Self::js_gc_on_error_set,
            );
            let v = new_config.on_error;
            self.config.with_mut(|c| c.on_error = v);
        }

        if let Some(mut ws) = new_config.websocket.take() {
            // `Handler::from_js` already rejected configs with no non-error
            // callback, so any `Some(ws)` is adoptable — match initial-serve
            // and adopt unconditionally.
            ws.handler
                .flags
                .set(super::web_socket_server_context::HandlerFlags::SSL, SSL);
            self.config.with_mut(|c| c.websocket = Some(ws));
            self.write_ws_handler_slots(server_js, global);
        }

        // These get re-applied when we set the static routes again.
        self.dev_server.with_mut(|dev| {
            if let Some(dev_server) = dev.as_deref_mut() {
                // Prevent a use-after-free in the hash table keys.
                dev_server.html_router.clear();
                dev_server.html_router.fallback = None;
            }
        });

        self.config.with_mut(|c| {
            // NOTE: `Vec<StaticRouteEntry>` impls `Drop`, so
            // a move-assign frees the old `static_routes`.
            c.static_routes = core::mem::take(&mut new_config.static_routes);
            c.negative_routes = core::mem::take(&mut new_config.negative_routes);

            if new_config.had_routes_object {
                c.user_routes_to_build = core::mem::take(&mut new_config.user_routes_to_build);
            }
        });
        if new_config.had_routes_object {
            // Registrations were cleared above; each `UserRoute` drops here.
            self.user_routes.set(Vec::new());
        }

        let route_list_value = self.set_routes();
        if new_config.had_routes_object {
            Self::js_gc_route_list_set(server_js, global, route_list_value);
        }

        if self.inspector_server_id.get().get() != 0 {
            if let Some(debugger) = self.vm().as_mut().debugger.as_deref_mut() {
                bun_core::handle_oom(super::http_server_agent::notify_server_routes_updated(
                    &debugger.http_server_agent,
                    self.as_any_server(),
                ));
            }
        }
    }

    pub(crate) fn reload_static_routes(&self) -> Result<bool, crate::Error> {
        let Some(app) = self.app_mut() else {
            // Static routes will get cleaned up when the server is stopped
            return Ok(false);
        };
        let new_config = self
            .config
            .with_mut(|c| c.clone_for_reloading_static_routes())?;
        self.config.set(new_config);
        app.clear_routes();
        for_each_mux_app!(self, |mux| {
            mux.clear_routes();
        });
        let route_list_value = self.set_routes();
        if !route_list_value.is_empty() {
            if let Some(server_js_value) = self.js_value_for_dispatch() {
                Self::js_gc_route_list_set(server_js_value, &self.global(), route_list_value);
            }
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn on_reload(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global.throw_not_enough_arguments("reload", 1, 0));
        }

        let mut args_slice = jsc::ArgumentsSlice::init(global.bun_vm(), arguments);

        let mut new_config = ServerConfig::from_js(
            global,
            &mut args_slice,
            server_config::FromJSOptions {
                allow_bake_config: false,
                is_fetch_required: true,
                previous_fetch: !self.config().on_request.is_empty_or_undefined_or_null(),
                previous_routes: !self.user_routes.get().is_empty(),
            },
        )?;

        // `on_reload_from_zig` moves `new_config.websocket` into the unscanned
        // `self.config` heap box before `write_ws_handler_slots` roots the 7
        // ws shadows, and each `wrap_handler_slot` call allocates via
        // `with_async_context_if_needed`. Same window as `serve()`; same fix.
        let _handler_pins = super::protect_handler_shadows(&new_config);
        self.on_reload_from_zig(&mut new_config, global);

        Ok(self.js_value.get().try_get().unwrap_or(JSValue::UNDEFINED))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn on_fetch(
        &self,
        ctx: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if self.config().on_request.is_empty() {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ctx.create_error_instance(format_args!(
                        "fetch() requires the server to have a fetch handler"
                    )),
                ),
            );
        }

        let arguments = callframe.arguments();
        if arguments.is_empty() {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ctx.create_error_instance(format_args!(
                        "fetch() expects a string but received no arguments."
                    )),
                ),
            );
        }

        let mut headers: Option<HeadersRef> = None;
        let mut method = Method::GET;
        let mut args = jsc::ArgumentsSlice::init(ctx.bun_vm(), arguments);

        let first_arg = args.next_eat().unwrap();
        let mut body = BodyValue::Null;
        // TODO: set Host header
        // TODO: set User-Agent header
        // TODO: unify with fetch() implementation.
        let existing_request: Box<Request> = if first_arg.is_string() {
            let url_utf8 = arguments[0].to_utf8(ctx)?;
            let temp_url_str = url_utf8.slice();

            if temp_url_str.is_empty() {
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        ctx,
                        ctx.create_error_instance(format_args!(
                            "fetch() URL must not be a blank string."
                        )),
                    ),
                );
            }

            let mut url = URL::parse(temp_url_str);

            // The UTF-8 clone of `url.href` below makes its own copy, so the
            // joined buffer only needs to live through this block. The else arm
            // borrows `temp_url_str` (kept alive by `url_utf8`) instead of
            // duping it.
            let owned_url_buf: std::borrow::Cow<'_, [u8]> = if url.hostname.is_empty() {
                std::borrow::Cow::Owned(
                    strings::append(&self.base_url_string_for_joining, url.pathname).into_vec(),
                )
            } else {
                std::borrow::Cow::Borrowed(temp_url_str)
            };
            url = URL::parse(&owned_url_buf);

            if arguments.len() >= 2 && arguments[1].is_object() {
                let opts = arguments[1];
                if let Some(method_) = opts.fast_get(ctx, jsc::BuiltinName::Method)? {
                    let slice_ = method_.to_utf8(ctx)?;
                    method = Method::which(slice_.slice()).unwrap_or(method);
                }

                if let Some(headers_) = opts.fast_get(ctx, jsc::BuiltinName::Headers)? {
                    if let Some(headers__) = FetchHeaders::cast_(headers_, ctx.vm()) {
                        // A JS `Headers`: the `Request` gets its own copy (as
                        // `new Request(url, { headers })` does).
                        // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                        headers =
                            bun_opaque::opaque_deref_mut(headers__.as_ptr()).clone_this_ref(ctx)?;
                    } else if let Some(headers__) = HeadersRef::create_from_js(ctx, headers_)? {
                        headers = Some(headers__);
                    }
                }

                if let Some(body__) = opts.fast_get(ctx, jsc::BuiltinName::Body)? {
                    match Blob::get::<true, false>(ctx, body__) {
                        Ok(new_blob) => body = BodyValue::Blob(new_blob),
                        Err(_) => {
                            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                ctx,
                                ctx.create_error_instance(format_args!("fetch() received invalid body")),
                            ));
                        }
                    }
                }
            }

            Box::new(Request::init2(
                BunString::clone_utf8(url.href),
                headers,
                // Moves `body` into the per-VM hive pool (ref_count = 1).
                crate::webcore::body::hive_alloc(body),
                method,
            ))
        } else if let Some(request_) = first_arg
            .is_object()
            .then(|| first_arg.as_class_ref::<Request>())
            .flatten()
        {
            // NOTE: `Request::clone()` seeds a fully-initialized sentinel and
            // calls `clone_into(.., preserve_url=false)`.
            request_.clone(ctx)?
        } else {
            let fetch_error = Fetch::fetch_type_error_string(first_arg);
            let err = jsc::ErrorCode::INVALID_ARG_TYPE.fmt(ctx, format_args!("{}", fetch_error));
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(ctx, err),
            );
        };

        // `Request::to_js` stores the request as the JS wrapper's `m_ctx`,
        // which adopts ownership and frees the allocation in its GC finalizer;
        // `request_value` keeps it alive for the rest of this frame.
        let request: &Request = Box::leak(existing_request);

        debug_assert!(!self.config().on_request.is_empty()); // confirmed above
        let global_this = self.global();
        let on_request = self.config().on_request;
        let request_value = request.to_js(&global_this);
        let response_value =
            match on_request.call(&global_this, self.js_value_assert_alive(), &[request_value]) {
                Ok(v) => v,
                Err(err) => global_this.take_exception(err),
            };

        if response_value.is_any_error() {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    response_value,
                ),
            );
        }

        if response_value.is_empty_or_undefined_or_null() {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ctx.create_error_instance(format_args!("fetch() returned an empty value")),
                ),
            );
        }

        if response_value.as_any_promise().is_some() {
            return Ok(response_value);
        }

        if let Some(resp) = response_value.as_class_ref::<Response>() {
            resp.set_url(request.url.get().clone());
        }
        request_value.ensure_still_alive();
        Ok(JSPromise::resolved_promise_value(ctx, response_value))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn close_idle_connections(
        &self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(app) = self.app_mut() else {
            return Ok(JSValue::js_number(0.0));
        };
        if self.deinit_running.get() {
            return Ok(JSValue::js_number(0.0));
        }
        // Each close reaches `on_connection_filter(-2)` synchronously; hold
        // the guard so its `deinit_if_we_can` is skipped while this frame
        // sweeps. One-shot sweep (Node semantics): busy connections are spared
        // and are NOT marked to close later.
        self.deinit_running.set(true);
        let closed = app.close_idle_connections(false);
        self.deinit_running.set(false);
        self.deinit_if_we_can();
        Ok(JSValue::js_number(closed as f64))
    }

    pub(crate) fn stop_from_js(&self, abruptly: Option<JSValue>) -> JSValue {
        let rc = self.get_all_closed_promise(&self.global());

        let abrupt = matches!(abruptly, Some(v) if v.is_boolean() && v.to_boolean());
        // `!deinit_running`: a `server.stop()` reached from a close callback
        // that an outer `stop()`'s drain fired must not re-run `stop_listening`
        // under the outer frame's drain.
        if self.has_listener()
            || (abrupt && !self.has_flags(ServerFlags::TERMINATED) && !self.deinit_running.get())
        {
            self.stop(abrupt);
        }

        rc
    }

    pub(crate) fn dispose_from_js(&self) -> JSValue {
        if self.has_listener()
            || (!self.has_flags(ServerFlags::TERMINATED) && !self.deinit_running.get())
        {
            self.stop(true);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_port(&self, _: &JSGlobalObject) -> JSValue {
        let config_port = match &self.config().address {
            server_config::Address::Unix(_) => return JSValue::UNDEFINED,
            server_config::Address::Tcp { port, .. } => *port,
        };

        if let Some(listener) = self.listener_mut() {
            if let Some(p) = listener.get_local_port() {
                return JSValue::js_number(p as f64);
            }
        }
        if let Some(h3l) = self.h3_listener_mut() {
            if let Some(p) = h3l.get_local_port() {
                return JSValue::js_number(p as f64);
            }
        }
        JSValue::js_number(config_port as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_id(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::create_utf8_for_js(global, &self.config().id)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_pending_requests(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number((self.pending_requests.get() as u32 & 0x7FFF_FFFF) as i32 as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_pending_web_sockets(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number((self.active_sockets_count() as u32 & 0x7FFF_FFFF) as i32 as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_address(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.config().address {
            server_config::Address::Unix(unix) => {
                bun_string_jsc::create_utf8_for_js(global, unix.as_bytes())
            }
            server_config::Address::Tcp { port: tcp_port, .. } => {
                let mut port: u16 = *tcp_port;

                if let Some(listener) = self.listener_mut() {
                    port = listener.get_local_port().unwrap_or(port);

                    let mut buf = [0u8; 64];
                    let Some(address_bytes) = listener.socket().local_address(&mut buf) else {
                        return Ok(JSValue::NULL);
                    };
                    let addr = match SocketAddress::init(address_bytes, port) {
                        Ok(a) => a,
                        Err(_) => {
                            bun_core::hint::cold();
                            return Ok(JSValue::NULL);
                        }
                    };
                    return addr.into_dto(&self.global());
                }
                if let Some(h3l) = self.h3_listener_mut() {
                    port = h3l.get_local_port().unwrap_or(port);
                    let mut buf = [0u8; 64];
                    let Some(address_bytes) = h3l.get_local_address(&mut buf) else {
                        return Ok(JSValue::NULL);
                    };
                    let addr = match SocketAddress::init(address_bytes, port) {
                        Ok(a) => a,
                        Err(_) => {
                            bun_core::hint::cold();
                            return Ok(JSValue::NULL);
                        }
                    };
                    return addr.into_dto(&self.global());
                }
                let _ = port;
                Ok(JSValue::NULL)
            }
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_url(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let url = self
            .get_url_as_string()
            .map_err(|_| global.throw_out_of_memory())?;
        bun_string_jsc::to_jsdomurl(&url, global)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_hostname(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.config().address {
            server_config::Address::Unix(_) => return Ok(JSValue::UNDEFINED),
            server_config::Address::Tcp { .. } => {}
        }
        {
            if let Some(listener) = self.listener_mut() {
                let mut buf = [0u8; 1024];
                if let Some(addr) = listener.socket().remote_address(&mut buf[..1024]) {
                    if !addr.is_empty() {
                        return bun_string_jsc::create_utf8_for_js(global, addr);
                    }
                }
            }
            {
                match &self.config().address {
                    server_config::Address::Tcp { hostname, .. } => {
                        if let Some(hostname) = hostname {
                            return bun_string_jsc::create_utf8_for_js(global, hostname.as_bytes());
                        } else {
                            return BunString::static_("localhost").to_js(global);
                        }
                    }
                    server_config::Address::Unix(_) => unreachable!(),
                }
            }
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_protocol(&self, global: &JSGlobalObject) -> JSValue {
        let _ = self;
        if SSL {
            global.common_strings().https()
        } else {
            global.common_strings().http()
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_development(_this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(DEBUG)
    }

    /// Runs before the wrapper's ref is dropped (`refCounted` class).
    pub fn finalize(&self) {
        httplog!("finalize");
        self.js_value.with_mut(|v| v.finalize());
        self.deinit_if_we_can();
        // `deinit_if_we_can` may defer (pending requests), so teardown is not
        // unconditional. JSC-handle Drops are no-ops past `is_shutting_down()`;
        // `TERMINATED` means `app.close()` already ran, so destroying the app
        // can't orphan a keep-alive socket.
        if self.has_flags(ServerFlags::DEINIT_SCHEDULED)
            && self.has_flags(ServerFlags::TERMINATED)
            && self.vm().is_shutting_down()
        {
            // Not the last ref: the caller still holds the wrapper's.
            drop(self.teardown());
        }
    }

    pub(crate) fn get_all_closed_promise(&self, global: &JSGlobalObject) -> JSValue {
        if self.is_closed() {
            return JSPromise::resolved_promise(global, JSValue::UNDEFINED).to_js();
        }
        let existing = self.all_closed_promise.get();
        if existing.has_value() {
            return existing.value();
        }
        let promise = jsc::JSPromiseStrong::init(global);
        let value = promise.value();
        self.all_closed_promise.set(promise);
        value
    }

    /// Route handler for the HTTP/2 and HTTP/3 apps; both hand us the same
    /// decoded-header request.
    pub(crate) fn on_mux_request(
        this: ThisPtr<Self>,
        req: uws_sys::AnyRequest,
        resp: uws::AnyResponse,
    ) {
        if this.config().on_request.is_empty() {
            return Self::on_mux_404(this, req, resp);
        }
        match mux_parts(req, resp) {
            MuxParts::H2(req, resp) => {
                Self::on_request_for::<ServerMuxRequestContext<SSL, DEBUG>, _>(this, req, resp)
            }
            MuxParts::H3(req, resp) => {
                Self::on_request_for::<ServerMuxRequestContext<SSL, DEBUG>, _>(this, req, resp)
            }
        }
    }

    pub(crate) fn on_mux_user_route_request(
        user_route: ThisPtr<UserRoute<SSL, DEBUG>>,
        req: uws_sys::AnyRequest,
        resp: uws::AnyResponse,
    ) {
        match mux_parts(req, resp) {
            MuxParts::H2(req, resp) => Self::on_user_route_request_for::<
                ServerMuxRequestContext<SSL, DEBUG>,
                _,
            >(user_route, req, resp),
            MuxParts::H3(req, resp) => Self::on_user_route_request_for::<
                ServerMuxRequestContext<SSL, DEBUG>,
                _,
            >(user_route, req, resp),
        }
    }

    pub(crate) fn on_mux_404(
        _this: ThisPtr<Self>,
        _req: uws_sys::AnyRequest,
        resp: uws::AnyResponse,
    ) {
        resp.write_status(b"404 Not Found");
        resp.end_without_body(false);
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(&self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.ref_event_loop();
        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unref(&self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.unref_event_loop();
        Ok(this_value)
    }

    pub(crate) fn on_bun_info_request(
        this: ThisPtr<Self>,
        req: uws_sys::AnyRequest,
        resp: uws::AnyResponse,
    ) {
        jsc::mark_binding!();
        let (req, resp) = super::h1_parts::<SSL>(req, resp);
        // S008: `Response<SSL>` is a ZST opaque — safe deref.
        let resp = bun_opaque::opaque_deref_mut(resp);
        let server = this.get();
        if !matches!(server.config().address, server_config::Address::Unix(_))
            && (!bake::is_allowed_host_header(req, Some(&server.config().address))
                || !resp
                    .get_remote_socket_info()
                    .is_some_and(|address| address.is_loopback()))
        {
            req.set_yield(true);
            return;
        }
        server.on_pending_request();
        req.set_yield(false);

        let buffer_writer = bun_js_printer::BufferWriter::init();
        let mut writer = bun_js_printer::BufferPrinter::init(buffer_writer);
        let source = bun_ast::Source::init_empty_file(b"info.json");
        let transpiler = &VirtualMachine::VirtualMachine::get().transpiler;
        let _ = bun_js_printer::print_json(
            &mut writer,
            BunInfo::generate(transpiler).expect("unreachable"),
            &source,
            bun_js_printer::PrintJsonOptions {
                mangled_props: None,
                ..Default::default()
            },
        );

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", &MimeType::JSON.value);
        resp.write_header(b"Cache-Control", b"public, max-age=3600");
        resp.write_header_int(b"Age", 0);
        let buffer = writer.ctx.written();
        resp.end(buffer, false);
        server
            .pending_requests
            .set(server.pending_requests.get() - 1);
    }

    fn on_user_route_request_for<Ctx: RequestCtx<SSL, DEBUG>, R: RespLike>(
        user_route: ThisPtr<UserRoute<SSL, DEBUG>>,
        req: &mut Ctx::Req,
        resp: &mut R,
    ) {
        // Read everything up front: the route handler may `reload()` and drop this route.
        let server = user_route.server;
        let server = server.get();
        let index = user_route.id;
        let method = user_route.route.method.specific();

        let Some(server_js) = server.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };

        let should_deinit_context = Cell::new(false);
        let Some(mut prepared) = Self::prepare_js_request_context_for::<Ctx, R>(
            server.this_ptr(),
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::No,
            method,
        ) else {
            return;
        };

        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        let server_request_list = Self::js_route_list_get_cached(server_js).unwrap();
        let call_route = if Ctx::IS_MUX {
            Bun__ServerRouteList__callRouteH3
        } else {
            Bun__ServerRouteList__callRoute
        };
        let global = server.global_this();
        let response_value = match jsc::from_js_host_call(global, || {
            call_route(
                global,
                index,
                prepared.request_ptr.as_ptr(),
                server_js,
                server_request_list,
                &mut prepared.js_request,
                std::ptr::from_mut(req).cast::<c_void>(),
            )
        }) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        server.handle_request_for::<Ctx>(&should_deinit_context, &prepared, req, response_value);
    }

    fn handle_request_for<Ctx: RequestCtx<SSL, DEBUG>>(
        &self,
        should_deinit_context: &Cell<bool>,
        prepared: &PreparedRequestFor<Ctx>,
        req: &mut Ctx::Req,
        response_value: JSValue,
    ) {
        let ctx = prepared.ctx.get();
        // The uWS request will not live longer than this function: on every
        // exit below it is detached from the `Request`.
        ctx.on_response(self, prepared.js_request, response_value);
        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        ctx.set_defer_deinit(None);

        if should_deinit_context.get() {
            ctx.detach_uws_request();
            ctx.deinit();
            return;
        }

        if ctx.should_render_missing() {
            ctx.detach_uws_request();
            ctx.render_missing();
            return;
        }

        // The request is asynchronous, and all information from `req` must be copied
        // since the provided uws.Request will be re-used for future requests (stack allocated).
        ctx.arm_async(req);
        prepared.js_request.ensure_still_alive();
    }

    fn on_request_for<Ctx: RequestCtx<SSL, DEBUG>, R: RespLike>(
        this: ThisPtr<Self>,
        req: &mut Ctx::Req,
        resp: &mut R,
    ) {
        let Some(js_value) = this.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };
        let should_deinit_context = Cell::new(false);
        let Some(prepared) = Self::prepare_js_request_context_for::<Ctx, R>(
            this,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::Yes,
            None,
        ) else {
            return;
        };

        let server = this.get();
        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        let on_request_fn = server.config().on_request;
        debug_assert!(!on_request_fn.is_empty());

        let global = server.global_this();
        let response_value =
            match on_request_fn.call(global, js_value, &[prepared.js_request, js_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

        server.handle_request_for::<Ctx>(&should_deinit_context, &prepared, req, response_value);
    }

    fn prepare_js_request_context_for<Ctx: RequestCtx<SSL, DEBUG>, R: RespLike>(
        this: ThisPtr<Self>,
        req: &mut Ctx::Req,
        resp: &mut R,
        should_deinit_context: Option<DeferDeinitFlag>,
        create_js_request: CreateJsRequest,
        method: Option<http::Method>,
    ) -> Option<PreparedRequestFor<Ctx>> {
        jsc::mark_binding!();
        let server = this.get();

        // We need to register the handler immediately since uSockets will not buffer.
        //
        // We first validate the self-reported request body length so that
        // we avoid needing to worry as much about what memory to free.
        // RFC 9114 §4.2: an HTTP/3 message containing transfer-encoding is
        // malformed (HTTP/2 rejects it with RST_STREAM before dispatch).
        if Ctx::IS_MUX {
            if ReqLike::header(req, b"transfer-encoding").is_some() {
                RespLike::write_status(resp, b"400 Bad Request");
                RespLike::end_without_body(resp, false);
                return None;
            }
        }

        // Resolve once, reuse for both `has_request_body()` and the forward to
        // `Ctx::init`.
        let method = method.or_else(|| http::Method::which(ReqLike::method(req)));

        let request_body_length: Option<usize> = 'request_body_length: {
            if method.unwrap_or(http::Method::OPTIONS).has_request_body() {
                let len: usize = 'brk: {
                    if let Some(content_length) = ReqLike::header(req, b"content-length") {
                        break 'brk bun_http_types::parse_content_length(content_length);
                    }
                    0
                };

                // Abort the request very early. For H2/H3 a per-request error
                // is a stream error; close_connection would take down every
                // sibling stream on the connection.
                if len > server.config().max_request_body_size {
                    RespLike::write_status(resp, b"413 Request Entity Too Large");
                    RespLike::end_without_body(resp, !Ctx::IS_MUX);
                    return None;
                }

                break 'request_body_length Some(len);
            }
            None
        };

        server.on_pending_request();

        ReqLike::set_yield(req, false);
        RespLike::timeout(resp, server.config().idle_timeout);

        // Since we do timeouts by default, we should tell the user when
        // this happens - but limit it to only warn once.
        if server.should_add_timeout_handler_for_warning() {
            // We need to pass it a pointer, any pointer should do: the handler
            // ignores it and reads the static directly. `AtomicBool::as_ptr`
            // yields a `*mut` with interior-mutability provenance.
            RespLike::on_timeout_warn(
                resp,
                did_send_idletimeout_warning_once()
                    .as_ptr()
                    .cast::<c_void>(),
            );
        }

        let is_te = request_body_length.is_some() && ReqLike::has_transfer_encoding(req);
        // HTTP/2 and HTTP/3 frame the body by END_STREAM or QUIC FIN, not Content-Length.
        let expects_body = matches!(request_body_length, Some(req_len)
            if req_len > 0 || is_te || (Ctx::IS_MUX && !RespLike::request_body_ended(resp)));
        let any_resp = RespLike::to_any_response(resp);
        let mut prepared = Self::create_request_context::<Ctx>(
            this,
            req,
            any_resp,
            should_deinit_context,
            method,
            expects_body,
        );
        let ctx: &Ctx = prepared.ctx.get();
        let Some(request_object) = ctx.request() else {
            unreachable!("just created");
        };

        // The lazy `getRequest()` path that backs Request.url / .headers
        // is `*uws.Request`-typed; for HTTP/2 and HTTP/3 we populate both
        // eagerly so the rest of the pipeline never needs to know which
        // transport delivered the bytes.
        if Ctx::IS_MUX {
            request_object.set_fetch_headers(Some(HeadersRef::create_from_h3(
                std::ptr::from_mut(req).cast::<c_void>(),
            )));
            // NOTE: `ReqLike::{url,header}` both borrow `&mut req`; the
            // returned slices alias the same uWS-owned header buffer. Format
            // the `https://{host}` prefix while `host` is borrowed so the
            // second `&mut req` borrow for `url` is unconflicted.
            let prefix: Option<Vec<u8>> = ReqLike::header(req, b"host")
                .filter(|host| Request::is_valid_host_header(host))
                .map(|host| {
                    let fmt = bun_fmt::HostFormatter {
                        is_https: SSL,
                        host,
                        port: None,
                    };
                    let mut s = Vec::new();
                    let _ = write!(&mut s, "{}://{}", if SSL { "https" } else { "http" }, fmt);
                    s
                });
            let path = ReqLike::url(req);
            if !path.is_empty() && path[0] == b'/' {
                if let Some(mut s) = prefix {
                    s.extend_from_slice(path);
                    // Same WHATWG pass as `Request::ensure_url` for HTTP/1.
                    let href = bun_url::href_from_string(&BunString::from_bytes(&s));
                    request_object.url.set(if href.is_empty() {
                        BunString::clone_utf8(&s)
                    } else if core::ptr::eq(href.byte_slice().as_ptr(), s.as_ptr()) {
                        BunString::clone_latin1(&s[..href.length()])
                    } else {
                        href
                    });
                } else {
                    request_object.url.set(BunString::clone_utf8(path));
                }
            } else {
                request_object.url.set(BunString::clone_utf8(path));
            }
            ctx.clear_req();
        }

        if DEBUG {
            ctx.set_is_web_browser_navigation('brk: {
                if let Some(fetch_dest) = ReqLike::header(req, b"sec-fetch-dest") {
                    if fetch_dest == b"document" {
                        break 'brk true;
                    }
                }
                false
            });
        }

        if let Some(req_len) = request_body_length {
            ctx.set_request_body_content_len(req_len);
            ctx.set_is_transfer_encoding(is_te);
            if expects_body {
                ctx.set_is_waiting_for_request_body(true);
                ctx.arm_on_data(any_resp);
            }
        }

        let js_request = match create_js_request {
            CreateJsRequest::Yes => request_object.to_js(&server.global()),
            CreateJsRequest::Bake => match request_object.to_js_for_bake(&server.global()) {
                Ok(v) => v,
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                Err(_) => return None,
            },
            CreateJsRequest::No => JSValue::ZERO,
        };
        prepared.js_request = js_request;
        Some(prepared)
    }

    /// The core of every dispatch path: allocate the request context from its
    /// transport's pool, its body slot and abort signal, and the heap `Request`.
    /// `js_request` is left `ZERO` for the caller to fill.
    #[inline]
    pub(super) fn create_request_context<Ctx: RequestCtx<SSL, DEBUG>>(
        this: ThisPtr<Self>,
        req: &mut Ctx::Req,
        resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<http::Method>,
        expects_body: bool,
    ) -> PreparedRequestFor<Ctx> {
        let server = this.get();
        let pooled = Ctx::pool(server).claim_init(|slot| {
            Ctx::init(slot, this.into(), req, resp, should_deinit_context, method)
        });
        let ctx_ptr: NonNull<Ctx> = pooled.as_ptr();
        let ctx_ref = bun_ptr::BackRef::new(&*pooled);
        ctx_ref.adopt_pool_slot(pooled);
        let ctx: &Ctx = ctx_ref.get();

        server
            .vm()
            .jsc_vm()
            .deprecated_report_extra_memory(core::mem::size_of::<Ctx>());

        // Pooled body slot, ref_count = 1. The ctx and Request each own a +1
        // on the same slot (streamed bytes buffered into the ctx surface on
        // `request.body`/`request.json()`). Paired drop in
        // `RequestContext::deinit` / `Request::finalize`.
        let body_hive = crate::webcore::body::hive_alloc(if expects_body {
            // we defer pre-allocating the body until we receive the first chunk
            // that way if the client is lying about how big the body is or the client aborts
            // we don't waste memory
            BodyValue::Locked(crate::webcore::body::PendingValue {
                task: Some(ctx_ptr.cast::<c_void>()),
                global: server.global_this,
                on_start_buffering: Some(Ctx::on_start_buffering_callback),
                on_start_streaming: Some(Ctx::on_start_streaming_request_body_callback),
                on_readable_stream_available: Some(Ctx::on_request_body_readable_stream_available),
                producer: crate::webcore::streams::SourceHandle::ServerRequestBody(
                    AnyRequestContext::init(ctx_ptr.as_ptr()),
                ),
                ..Default::default()
            })
        } else {
            BodyValue::Null
        });
        ctx.set_request_body(Some(body_hive.clone()));

        // The context owns one ref (plus a pending-activity count) so aborts
        // propagate; the Request's own counted ref pairs with `Request::Drop`.
        let signal =
            NonNull::new(AbortSignal::new(&server.global())).expect("AbortSignal::new is non-null");
        ctx.set_signal(signal);
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe deref.
        let signal = bun_opaque::opaque_deref(signal.as_ptr());
        signal.pending_activity_ref();

        // Leaked to the heap: owned by its JS wrapper once created (or by the
        // C++ route-list caller that wraps it), reachable from the ctx through
        // its weak handle until `RequestContext::deinit` lets go.
        let (request_weak, request_ptr) =
            bun_ptr::WeakPtr::init_leaked(Request::new(Request::init(
                ctx.ctx_method(),
                AnyRequestContext::init(ctx_ptr.as_ptr()),
                SSL,
                Some(signal.ref_()),
                body_hive,
            )));
        ctx.set_request_weakref(request_weak);
        PreparedRequestFor {
            js_request: JSValue::ZERO,
            request_ptr,
            ctx: ctx_ref,
        }
    }

    fn upgrade_web_socket_user_route(
        this: ThisPtr<UserRoute<SSL, DEBUG>>,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws::Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        method: Option<http::Method>,
    ) {
        // Read everything up front: the route handler may `reload()` and drop this route.
        let server = this.server;
        let server = server.get();
        let index = this.id;

        let Some(server_js) = server.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };

        let should_deinit_context = Cell::new(false);
        let Some(mut prepared) = Self::prepare_js_request_context(
            server.this_ptr(),
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::No,
            method,
        ) else {
            return;
        };
        prepared
            .ctx
            .upgrade_context
            .set(UpgradeState::Pending(NonNull::from(upgrade_ctx)));
        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        let server_request_list = Self::js_route_list_get_cached(server_js).unwrap();
        let global = server.global_this();
        let response_value = match jsc::from_js_host_call(global, || {
            Bun__ServerRouteList__callRoute(
                global,
                index,
                prepared.request_ptr.as_ptr(),
                server_js,
                server_request_list,
                &mut prepared.js_request,
                std::ptr::from_mut(req).cast::<c_void>(),
            )
        }) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        server.handle_request(&should_deinit_context, &prepared, req, response_value);
    }

    /// The `/*` websocket fallback route: `this` is the server itself.
    pub(crate) fn on_web_socket_upgrade(
        this: ThisPtr<Self>,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws::Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
    ) {
        jsc::mark_binding!();
        let server = this.get();
        // Guards both branches below: the `on_request` fallthrough has no
        // other gate, and the node:http branch's own re-check (mod.rs:
        // `on_node_http_request_with_upgrade_ctx`) is redundant on this path
        // but load-bearing for its other caller (`on_node_http_request`).
        let Some(server_js) = server.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };
        if !server.config().on_node_http_request.is_empty() {
            server.on_node_http_request_with_upgrade_ctx(req, resp, upgrade_ctx);
            return;
        }
        if server.config().on_request.is_empty() {
            // require fetch method to be set otherwise we dont know what route to call
            // this should be the fallback in case no route is provided to upgrade
            resp.write_status(b"403 Forbidden");
            resp.end_without_body(true);
            return;
        }
        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        server.on_pending_request();
        req.set_yield(false);
        let should_deinit_context = Cell::new(false);
        let prepared = Self::create_request_context::<ServerRequestContext<SSL, DEBUG>>(
            this,
            req,
            RespLike::to_any_response(resp),
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            None,
            false,
        );
        let ctx = prepared.ctx.get();
        ctx.upgrade_context
            .set(UpgradeState::Pending(NonNull::from(upgrade_ctx)));
        let Some(request_object) = ctx.request_weakref.get().peek() else {
            unreachable!("just created");
        };

        // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
        let global = server.global();
        let args = [request_object.to_js(&global), server_js];
        args[0].ensure_still_alive();

        let on_request = server.config().on_request;
        let response_value = match on_request.call(&global, server_js, &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };
        // The uWS request will not live longer than this function: on every
        // exit below it is detached from the `Request`.
        ctx.on_response(server, args[0], response_value);

        ctx.defer_deinit_until_callback_completes.set(None);

        if should_deinit_context.get() {
            RequestCtx::detach_uws_request(ctx);
            ctx.deinit();
            return;
        }

        if ctx.should_render_missing() {
            RequestCtx::detach_uws_request(ctx);
            ctx.render_missing();
            return;
        }

        ctx.arm_async(req);
        args[0].ensure_still_alive();
    }

    // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
    pub(super) fn on_chrome_dev_tools_json_request(
        this: ThisPtr<Self>,
        req: uws_sys::AnyRequest,
        resp: uws::AnyResponse,
    ) {
        let (req, resp) = super::h1_parts::<SSL>(req, resp);
        // S008: `Response<SSL>` is a ZST opaque — safe deref.
        let resp = bun_opaque::opaque_deref_mut(resp);
        let server = this.get();
        if cfg!(debug_assertions) {
            // NOTE: scoped_log! expands each arg twice (ANSI/no-ANSI branches);
            // copy to owned buffers so the two `&req` borrows in the expansion
            // don't overlap with the returned slice lifetimes.
            let m = req.method().to_vec();
            let u = req.url().to_vec();
            httplog!("{} - {}", BStr::new(&m), BStr::new(&u));
        }

        let dev_server_guard = server.dev_server.get();
        let authorized = 'brk: {
            let Some(dev_server) = dev_server_guard.as_deref() else {
                break 'brk false;
            };

            // The loopback source-IP check below is not enough on its own: a
            // DNS-rebound origin connects from 127.0.0.1 but presents the
            // attacker's hostname in `Host`. Apply the same Host allowlist as
            // the `/_bun/*` routes before disclosing the project root path.
            if !bake::is_allowed_dev_host(dev_server, req) {
                break 'brk false;
            }

            if resp
                .get_remote_socket_info()
                .is_some_and(|address| address.is_loopback())
            {
                break 'brk true;
            }

            false
        };

        if !authorized {
            req.set_yield(true);
            return;
        }
        let root: &[u8] = &dev_server_guard.as_deref().expect("authorized").root;

        // They need a 16 byte uuid. It needs to be somewhat consistent. We don't want to store this field anywhere.

        // So we first use a hash of the main field:
        let first_hash_segment: [u8; 8] = 'brk: {
            let mut buffer = paths::path_buffer_pool::get();
            let main = server.vm_ref().main();
            let len = main.len().min(buffer.len());
            break 'brk hash(strings::copy_lowercase(&main[..len], &mut buffer[..len]))
                .to_ne_bytes();
        };

        // And then we use a hash of their project root directory:
        let second_hash_segment: [u8; 8] = 'brk: {
            let mut buffer = paths::path_buffer_pool::get();
            let len = root.len().min(buffer.len());
            break 'brk hash(strings::copy_lowercase(&root[..len], &mut buffer[..len]))
                .to_ne_bytes();
        };

        // We combine it together to get a 16 byte uuid.
        let mut hash_bytes = [0u8; 16];
        hash_bytes[..8].copy_from_slice(&first_hash_segment);
        hash_bytes[8..].copy_from_slice(&second_hash_segment);
        let uuid = UUID::init_with(&hash_bytes);

        // interface DevToolsJSON {
        //   workspace?: {
        //     root: string,
        //     uuid: string,
        //   }
        // }
        let mut json_string = Vec::new();
        let _ = write!(
            &mut json_string,
            "{{ \"workspace\": {{ \"root\": {}, \"uuid\": \"{}\" }} }}",
            bun_fmt::format_json_string_utf8(root, Default::default()),
            uuid,
        );

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", b"application/json");
        resp.end(&json_string, resp.should_close_connection());
    }

    pub(crate) fn on_client_error_callback(
        &self,
        socket: &mut uws::Socket,
        error_code: u8,
        raw_packet: &[u8],
    ) -> JsResult<()> {
        if self.js_value_for_dispatch().is_none() {
            return Ok(());
        }
        let callback = self.on_clienterror.get();
        if callback.is_empty() {
            return Ok(());
        }
        {
            let is_ssl = SSL;
            let global = self.global();
            let node_socket = jsc::from_js_host_call(&global, || {
                Bun__getOrCreateNodeHTTPServerSocket(
                    is_ssl,
                    std::ptr::from_mut(socket).cast::<c_void>(),
                    &global,
                )
            })?;
            if node_socket.is_undefined_or_null() {
                return Ok(());
            }

            let error_code_value = JSValue::js_number(error_code as f64);
            let raw_packet_value = ArrayBuffer::create_buffer(&global, raw_packet)?;
            let _scope = global.bun_vm().enter_event_loop_scope();
            callback.call(
                &global,
                JSValue::UNDEFINED,
                &[
                    JSValue::from(is_ssl),
                    node_socket,
                    error_code_value,
                    raw_packet_value,
                ],
            )?;
        }
        Ok(())
    }

    /// node:http compat: a connection was accepted on this server (for TLS,
    /// its handshake completed). Hands the JSNodeHTTPServerSocket to the JS
    /// `onConnection` callback so `node:http` can emit 'connection' before any
    /// request bytes arrive.
    pub(crate) fn on_connection_callback(&self, socket: *mut c_void) -> JsResult<()> {
        if self.js_value_for_dispatch().is_none() {
            return Ok(());
        }
        let callback = self.on_connection.get();
        if callback.is_empty() {
            return Ok(());
        }
        let global = self.global();
        let node_socket = jsc::from_js_host_call(&global, || {
            Bun__getOrCreateNodeHTTPServerSocket(SSL, socket, &global)
        })?;
        if node_socket.is_undefined_or_null() {
            return Ok(());
        }
        let _scope = global.bun_vm().enter_event_loop_scope();
        callback.call(&global, JSValue::UNDEFINED, &[node_socket])?;
        Ok(())
    }

    // `js_gc_route_list_set` / `ptr_to_js` live on the unbounded
    // `impl NewServer` in mod.rs; do not redefine them here.
}

/// The `(request, response)` handles of an HTTP/2 or HTTP/3 route callback;
/// both transports hand over the same decoded-header request type.
enum MuxParts<'a> {
    H2(&'a mut uws_sys::h3::Request, &'a mut uws_sys::h2::Response),
    H3(&'a mut uws_sys::h3::Request, &'a mut uws_sys::h3::Response),
}

#[inline]
fn mux_parts<'a>(req: uws_sys::AnyRequest, resp: uws::AnyResponse) -> MuxParts<'a> {
    let uws_sys::AnyRequest::H3(req) = req else {
        unreachable!("H2/H3 route dispatched an H1 request")
    };
    // S008: all three are `opaque_ffi!` ZST handles — safe deref.
    let req = bun_opaque::opaque_deref_mut(req);
    match resp {
        uws::AnyResponse::H2(resp) => MuxParts::H2(req, bun_opaque::opaque_deref_mut(resp)),
        uws::AnyResponse::H3(resp) => MuxParts::H3(req, bun_opaque::opaque_deref_mut(resp)),
        uws::AnyResponse::SSL(_) | uws::AnyResponse::TCP(_) => {
            unreachable!("H2/H3 route dispatched an H1 response")
        }
    }
}

// JsClass impls for the four server monomorphizations. Forward into the
// canonical `crate::generated_classes::js_$ty` wrappers (emitted by
// `generate-classes.ts`) instead of redeclaring the `${T}__fromJS`/
// `${T}__create` externs locally — the codegen module is the single owner of
// those FFI signatures, so going through it avoids `clashing_extern_declarations`
// and keeps the ABI definition in one place.
//
// `get_constructor` is intentionally omitted: `server.classes.ts` sets
// `noConstructor: true` for all four variants, so no `${T}__getConstructor`
// symbol is exported by C++ and the trait default (`JSValue::UNDEFINED`) is
// the spec-correct answer.
bun_jsc::impl_js_class_via_generated!(HTTPServer => crate::generated_classes::js_HTTPServer, no_constructor);
bun_jsc::impl_js_class_via_generated!(HTTPSServer => crate::generated_classes::js_HTTPSServer, no_constructor);
bun_jsc::impl_js_class_via_generated!(DebugHTTPServer => crate::generated_classes::js_DebugHTTPServer, no_constructor);
bun_jsc::impl_js_class_via_generated!(DebugHTTPSServer => crate::generated_classes::js_DebugHTTPSServer, no_constructor);

// ─── Exported fns ────────────────────────────────────────────────────────────
/// Run `$body` with `$s` bound to the `&NewServer<..>` behind `server`, or
/// evaluate to `$otherwise` if it is not a server wrapper.
macro_rules! with_any_server_js {
    ($server:expr, |$s:ident| $body:expr, $otherwise:expr) => {{
        let server = $server;
        if let Some($s) = server.as_class_ref::<HTTPServer>() {
            $body
        } else if let Some($s) = server.as_class_ref::<HTTPSServer>() {
            $body
        } else if let Some($s) = server.as_class_ref::<DebugHTTPServer>() {
            $body
        } else if let Some($s) = server.as_class_ref::<DebugHTTPSServer>() {
            $body
        } else {
            $otherwise
        }
    }};
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    fn set_on_client_error_from_js(
        &self,
        server: JSValue,
        global: &JSGlobalObject,
        callback: JSValue,
    ) {
        let Some(app) = self.app_mut() else { return };
        let mut shadow = callback;
        super::wrap_handler_slot(&mut shadow, server, global, Self::js_gc_on_client_error_set);
        self.on_clienterror.set(shadow);
        app.on_client_error_this(
            |this: ThisPtr<Self>,
             socket: *mut uws_sys::us_socket_t,
             error_code: u8,
             packet: &[u8]| {
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                crate::dispatch::fold(this.on_client_error_callback(
                    bun_opaque::opaque_deref_mut(socket),
                    error_code,
                    packet,
                ));
            },
            self.this_ptr(),
        );
    }

    fn set_on_connection_from_js(
        &self,
        server: JSValue,
        global: &JSGlobalObject,
        callback: JSValue,
    ) {
        let Some(app) = self.app_mut() else { return };
        let mut shadow = callback;
        super::wrap_handler_slot(&mut shadow, server, global, Self::js_gc_on_connection_set);
        self.on_connection.set(shadow);
        // uws filters fire with `1` when an HTTP connection is opened
        // (for TLS, when its handshake completes) and `-1` on close;
        // only the open notification is forwarded to JS.
        app.filter_this(
            |this: ThisPtr<Self>, socket: *mut uws_sys::us_socket_t, opened: i32| {
                if opened != 1 {
                    return;
                }
                crate::dispatch::fold(this.on_connection_callback(socket.cast::<c_void>()));
            },
            self.this_ptr(),
        );
    }
}

// Signatures match the C++ callers in `node:http`/`node:https`
// (`bindings/NodeHTTP.cpp`), which declare them as bare `extern "C"` (no
// `SYSV_ABI`) — hence the `c` calling convention.

// HOST_EXPORT(Server__setOnClientError, c)
pub fn server_set_on_client_error(
    global: &JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        (|| -> JsResult<JSValue> {
            if !server.is_object() {
                return Err(global.throw(format_args!(
                    "Failed to set clientError: The 'this' value is not a Server."
                )));
            }
            if !callback.is_function() {
                return Err(global.throw(format_args!(
                    "Failed to set clientError: The provided value is not a function."
                )));
            }
            with_any_server_js!(
                server,
                |s| s.set_on_client_error_from_js(server, global, callback),
                debug_assert!(false)
            );
            Ok(JSValue::UNDEFINED)
        })(),
    )
}

// HOST_EXPORT(Server__setOnConnection, c)
pub fn server_set_on_connection(
    global: &JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        (|| -> JsResult<JSValue> {
            if !server.is_object() {
                return Err(global.throw(format_args!(
                    "Failed to set onConnection: The 'this' value is not a Server."
                )));
            }
            if !callback.is_function() {
                return Err(global.throw(format_args!(
                    "Failed to set onConnection: The provided value is not a function."
                )));
            }
            with_any_server_js!(
                server,
                |s| s.set_on_connection_from_js(server, global, callback),
                debug_assert!(false)
            );
            Ok(JSValue::UNDEFINED)
        })(),
    )
}

// HOST_EXPORT(Server__setAppFlags, c)
pub fn server_set_app_flags(
    global: &JSGlobalObject,
    server: JSValue,
    require_host_header: bool,
    use_strict_method_validation: bool,
    lenient_http_flags: u8,
    http_allow_half_open: bool,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        (|| -> JsResult<JSValue> {
            if !server.is_object() {
                return Err(global.throw(format_args!(
                    "Failed to set requireHostHeader: The 'this' value is not a Server."
                )));
            }
            with_any_server_js!(
                server,
                |s| s.set_flags(
                    require_host_header,
                    use_strict_method_validation,
                    lenient_http_flags,
                    http_allow_half_open,
                ),
                return Err(global.throw(format_args!(
                    "Failed to set timeout: The 'this' value is not a Server."
                )))
            );
            Ok(JSValue::UNDEFINED)
        })(),
    )
}

// HOST_EXPORT(Server__setMaxHTTPHeaderSize, c)
pub fn server_set_max_http_header_size(
    global: &JSGlobalObject,
    server: JSValue,
    max_header_size: u64,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        (|| -> JsResult<JSValue> {
            if !server.is_object() {
                return Err(global.throw(format_args!(
                    "Failed to set maxHeaderSize: The 'this' value is not a Server."
                )));
            }
            with_any_server_js!(
                server,
                |s| s.set_max_http_header_size(max_header_size),
                return Err(global.throw(format_args!(
                    "Failed to set maxHeaderSize: The 'this' value is not a Server."
                )))
            );
            Ok(JSValue::UNDEFINED)
        })(),
    )
}

// ─── Externs ─────────────────────────────────────────────────────────────────
// C++-implemented (bindings/BunServer.cpp). Declared here (not `bun_jsc`)
// because the signatures name `bun_runtime` types (`NodeHTTPResponse`,
// `uws::Request`) — moving them down would create a forward dependency.
// Pointee types lack #[repr(C)] but are only passed by pointer.
#[allow(improper_ctypes)]
unsafe extern "C" {
    // NodeHTTPServer__onRequest_{http,https} live in `mod.rs::ffi` (sole user
    // is `on_node_http_request_with_upgrade_ctx`); duplicate decls here caused
    // clashing_extern_declarations.

    // `&JSGlobalObject` encodes non-null/aligned; `socket` is the opaque live
    // `uws::Socket*` handed to `on_client_error_callback` /
    // `on_connection_callback` by the uws dispatcher. Returns the
    // JSNodeHTTPServerSocket already attached to the raw socket, creating one
    // if the connection has not produced a parsed request yet.
    safe fn Bun__getOrCreateNodeHTTPServerSocket(
        is_ssl: bool,
        socket: *mut c_void,
        global: &JSGlobalObject,
    ) -> JSValue;

    // `&JSGlobalObject` / `&mut JSValue` discharge the deref'd-param
    // preconditions; `request_ptr`/`req` are opaque handles that C++ stores or
    // forwards (module-private — sole callers pass live pointers).
    pub(super) safe fn Bun__ServerRouteList__callRoute(
        global: &JSGlobalObject,
        index: u32,
        request_ptr: *mut Request,
        server_object: JSValue,
        route_list_object: JSValue,
        request_object: &mut JSValue,
        req: *mut c_void, // *uws.Request
    ) -> JSValue;

    safe fn Bun__ServerRouteList__callRouteH3(
        global: &JSGlobalObject,
        index: u32,
        request_ptr: *mut Request,
        server_object: JSValue,
        route_list_object: JSValue,
        request_object: &mut JSValue,
        req: *mut c_void,
    ) -> JSValue;

    // `global` is the live VM global; `callbacks`/`paths` are the ptr/len of
    // local scratch `Vec`s that C++ reads (and copies) synchronously.
    // Module-private — sole caller (`on_listen` in mod.rs) passes live slices.
    pub(super) safe fn Bun__ServerRouteList__create(
        global: *const JSGlobalObject,
        callbacks: *mut JSValue,
        paths: *mut EncodedSlice,
        paths_length: usize,
    ) -> JSValue;
}
