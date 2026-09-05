use core::ffi::{c_int, c_void};
use core::mem;
use core::ptr::NonNull;
use std::io::Write as _;

use crate::api::js_bundler::PluginJscExt as _;
use crate::api::{SocketAddress, js_bundler as JSBundler};
use crate::bake::dev_server::DevServer;
use crate::bake::framework_router as FrameworkRouter;
use crate::bake::{self as bake};
use crate::node::types::PathLikeExt as _;
use crate::webcore::BlobExt;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::fetch as Fetch;
use crate::webcore::response::HeadersRef;
use crate::webcore::{
    self as WebCore, AbortSignal, AnyBlob, Blob, FetchHeaders, Request, Response, request,
};
use ::bstr::BStr;
use bun_collections::HashMap;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_core::{Output, fmt as bun_fmt};
use bun_http::{self as http, Method, MimeType};
use bun_jsc::Debugger::DebuggerId;
use bun_jsc::uuid::UUID;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, GlobalRef, JSGlobalObject, JSPromise, JSValue, JsError,
    JsResult, Node, StringJsc as _, VirtualMachine, host_fn,
};
use bun_paths as paths;
use bun_ptr::RefPtr;
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
    DeferDeinitFlag, RequestContext as NewRequestContext, UpgradeState,
};
pub(super) use super::server_config::{self as server_config, ServerConfig};
pub(super) use super::server_web_socket::ServerWebSocket;
pub(super) use super::static_route::StaticRoute;

// ─── RequestCtx trait ────────────────────────────────────────────────────────
// NOTE: Stable Rust has no inherent
// associated types, so the per-monomorphization request handle type is
// surfaced via this local trait. Only `IS_MUX` is consumed for control flow;
// `Req` is erased to `c_void` to match `super::request_context::Req`. The
// response handle is a separate generic (`R: RespLike`) at each dispatch
// entry point: the MUX instantiation serves both `h2::Response` and
// `h3::Response`.
trait RequestCtx: super::any_request_context::CtxKind {
    type Req: ReqLike;
    const IS_MUX: bool;
}
impl<ThisServer, const SSL: bool, const DBG: bool> RequestCtx
    for NewRequestContext<ThisServer, SSL, DBG, false>
where
    NewRequestContext<ThisServer, SSL, DBG, false>: super::any_request_context::CtxKind,
{
    type Req = uws_sys::Request;
    const IS_MUX: bool = false;
}
impl<ThisServer, const SSL: bool, const DBG: bool> RequestCtx
    for NewRequestContext<ThisServer, SSL, DBG, true>
where
    NewRequestContext<ThisServer, SSL, DBG, true>: super::any_request_context::CtxKind,
{
    type Req = uws_sys::h3::Request;
    const IS_MUX: bool = true;
}

/// Field/method surface needed on the generic `Ctx` so the bodies of
/// `handle_request_for` / `prepare_js_request_context_for` / `on_saved_request`
/// can be written without naming the concrete `RequestContext<_, SSL, DBG, MUX>`
/// type. Implemented via blanket impl below for every `NewRequestContext<..>`.
#[allow(clippy::too_many_arguments)]
trait RequestCtxOps: RequestCtx {
    type Server;
    fn create_in(
        slot: *mut Self,
        server: *mut Self::Server,
        req: &mut Self::Req,
        resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<http::Method>,
    );
    fn on_response(&self, server: &Self::Server, request_value: JSValue, response_value: JSValue);
    fn deinit(&self);
    fn should_render_missing(&self) -> bool;
    fn render_missing(&self);
    fn to_async(&self, req: &mut Self::Req, request_object: &mut Request);
    fn ctx_method(&self) -> http::Method;
    fn set_defer_deinit(&self, flag: Option<DeferDeinitFlag>);
    fn set_request_body(&self, body: Option<crate::webcore::body::BodyHiveHandle>);
    #[allow(
        clippy::mut_from_ref,
        reason = "the body slot is a separate pooled allocation, not a field of *self (R-2)"
    )]
    fn request_body_mut(&self) -> Option<&mut BodyValue>;
    fn set_signal(&self, sig: *mut AbortSignal);
    fn set_request_weakref(&self, req: *mut Request);
    fn clear_req(&self);
    fn set_is_web_browser_navigation(&self, v: bool);
    fn set_request_body_content_len(&self, len: usize);
    fn set_is_transfer_encoding(&self, v: bool);
    fn set_is_waiting_for_request_body(&self, v: bool);
    fn arm_on_data(&self, resp: uws::AnyResponse);
    // body-streaming callback hooks (type-erased, stored on `Body::PendingValue`).
    // `this` must be a live `*mut Self::RequestCtx` cast to `*mut c_void`.
    fn on_start_buffering_callback(this: NonNull<c_void>);
    fn on_start_streaming_request_body_callback(this: NonNull<c_void>) -> WebCore::DrainResult;
    fn on_request_body_readable_stream_available(
        this: NonNull<c_void>,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    );
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> RequestCtxOps
    for NewRequestContext<ThisServer, SSL, DBG, MUX>
where
    Self: RequestCtx,
    ThisServer: super::ServerLike + 'static,
{
    type Server = ThisServer;
    #[inline]
    fn create_in(
        slot: *mut Self,
        server: *mut ThisServer,
        req: &mut Self::Req,
        any_resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<http::Method>,
    ) {
        // SAFETY: `slot` points at a fresh HiveArray pool entry; treat as
        // MaybeUninit for in-place construction — `&mut` scoped to this call.
        Self::create(
            unsafe { &mut *slot.cast::<core::mem::MaybeUninit<Self>>() },
            server,
            std::ptr::from_mut(req).cast(),
            any_resp,
            should_deinit_context,
            method,
        );
    }
    #[inline]
    fn on_response(&self, server: &ThisServer, rq: JSValue, rv: JSValue) {
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
    fn to_async(&self, req: &mut Self::Req, ro: &mut Request) {
        Self::to_async(self, std::ptr::from_mut(req).cast(), ro)
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
    fn request_body_mut(&self) -> Option<&mut BodyValue> {
        // SAFETY: R-2 invariant — slot shared with `Request.body`, never
        // `&mut`-borrowed concurrently (single-threaded event loop).
        self.request_body
            .get()
            .as_ref()
            .map(|h| unsafe { &mut (*h.as_ptr()).value })
    }
    #[inline]
    fn set_signal(&self, sig: *mut AbortSignal) {
        // `AbortSignal::new` returns a raw +1 ref to a C++-refcounted opaque;
        // `RequestContext.signal` stores it as `Option<NonNull<AbortSignal>>`
        // and pairs the unref in RequestContext cleanup (`shim::signal_release`,
        // which drops both the pending-activity count and the intrusive ref).
        self.signal.set(NonNull::new(sig));
    }
    #[inline]
    fn set_request_weakref(&self, req: *mut Request) {
        // SAFETY: `req` is a freshly-boxed Request (live for the request
        // duration) still carrying its `heap::into_raw` provenance.
        self.request_weakref
            .set(unsafe { bun_ptr::WeakPtr::<Request>::init_ref(req) });
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
        fn handler<S, const SSL_: bool, const DBG_: bool, const MUX_: bool>(
            ctx: *mut NewRequestContext<S, SSL_, DBG_, MUX_>,
            chunk: &[u8],
            last: bool,
        ) where
            S: super::ServerLike + 'static,
        {
            NewRequestContext::<S, SSL_, DBG_, MUX_>::on_buffered_body_chunk(ctx, chunk, last);
        }
        resp.on_data(handler::<ThisServer, SSL, DBG, MUX>, self.as_ctx_ptr());
    }
    #[inline]
    fn on_start_buffering_callback(this: NonNull<c_void>) {
        Self::on_start_buffering_callback(this)
    }
    #[inline]
    fn on_start_streaming_request_body_callback(this: NonNull<c_void>) -> WebCore::DrainResult {
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

// NOTE: local request/response traits so generic `Ctx::Req` / `R: RespLike`
// call sites can dispatch to any uWS HTTP/1, HTTP/2 or HTTP/3 handle type without
// touching `bun_uws_sys`. Only the surface `prepare_js_request_context_for`
// actually needs is exposed.
trait ReqLike {
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
    state: ServePluginsState,
    ref_count: core::cell::Cell<u32>,
}

// Reference count is incremented while there are other objects waiting on plugin loads.
pub(crate) enum ServePluginsState {
    Unqueued(Box<[Box<[u8]>]>),
    Pending {
        /// Promise may be empty if the plugin load finishes synchronously.
        plugin: Box<JSBundler::Plugin>,
        promise: jsc::JSPromiseStrong,
        /// Each holds a ref, released once the route is told the outcome.
        html_bundle_routes: Vec<RefPtr<html_bundle::Route>>,
        // LIFETIMES.tsv classifies this BORROW_PARAM (`Option<&'a DevServer>`),
        // but `ServePlugins` is a refcounted heap object handed across FFI as
        // a raw promise-context pointer with dynamic lifetime, so a borrowed
        // `&'a DevServer` cannot be expressed here. Back-reference invariant:
        // the DevServer outlives the pending plugin load (see the SAFETY
        // comments at the deref sites in `on_plugins_resolved`/`_rejected`).
        dev_server: Option<NonNull<DevServer>>,
    },
    Loaded(Box<JSBundler::Plugin>),
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
pub enum ServePluginsCallback<'a> {
    HtmlBundleRoute(bun_ptr::ThisPtr<html_bundle::Route>),
    DevServer(&'a DevServer),
}

impl ServePlugins {
    pub(crate) fn init(plugins: Box<[Box<[u8]>]>) -> RefPtr<ServePlugins> {
        RefPtr::new(ServePlugins {
            ref_count: core::cell::Cell::new(1),
            state: ServePluginsState::Unqueued(plugins),
        })
    }

    pub(crate) fn get_or_start_load(
        &mut self,
        global: &JSGlobalObject,
        cb: ServePluginsCallback<'_>,
    ) -> JsResult<GetOrStartLoadResult<'_>> {
        loop {
            match &mut self.state {
                ServePluginsState::Unqueued(_) => {
                    self.load_and_resolve_plugins(global)?;
                    // could jump to any branch if synchronously resolved
                    continue;
                }
                ServePluginsState::Pending {
                    html_bundle_routes,
                    dev_server,
                    ..
                } => {
                    match cb {
                        ServePluginsCallback::HtmlBundleRoute(route) => {
                            html_bundle_routes.push(RefPtr::from_this(route));
                        }
                        ServePluginsCallback::DevServer(server) => {
                            debug_assert!(
                                dev_server.is_none()
                                    || dev_server.map(|p| p.as_ptr().cast_const())
                                        == Some(std::ptr::from_ref(server))
                            ); // one dev server per server
                            *dev_server = Some(NonNull::from(server));
                        }
                    }
                    return Ok(GetOrStartLoadResult::Pending);
                }
                ServePluginsState::Loaded(_) => break,
                ServePluginsState::Err => return Ok(GetOrStartLoadResult::Err),
            }
        }
        // NOTE: split out of the loop so the `Loaded` arm's borrow of
        // `self.state` doesn't conflict with the `Unqueued` arm's `&mut self`.
        match &mut self.state {
            ServePluginsState::Loaded(plugins) => Ok(GetOrStartLoadResult::Ready(Some(plugins))),
            _ => unreachable!(),
        }
    }

    fn load_and_resolve_plugins(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        debug_assert!(matches!(self.state, ServePluginsState::Unqueued(_)));
        let ServePluginsState::Unqueued(plugin_list) = &self.state else {
            unreachable!()
        };
        // NOTE: reshaped for borrowck — clone the slice refs so we can mutate self.state below
        let plugin_list: Vec<_> = plugin_list.iter().collect();
        let bunfig_path: &[u8] = &global.bun_vm().transpiler.options.bunfig_path;
        let bunfig_folder: &[u8] = bun_paths::resolve_path::dirname::<
            bun_paths::resolve_path::platform::Auto,
        >(bunfig_path);

        // NOTE: the keep-alive ref/deref pair
        // lives in the caller (`get_or_load_plugins`), which holds the heap-allocated
        // `*mut ServePlugins` directly. Deriving the guard's pointer from `&mut self`
        // here would give it a tag that is invalidated by the writes to `self.state`
        // below (Stacked Borrows), making the eventual `heap::take` in `deref_` UB.

        let plugin = JSBundler::Plugin::create(global, bun_jsc::BunPluginTarget::Browser);
        // SAFETY: `Plugin::create` returns a freshly-boxed `*mut Plugin` (single owner).
        let plugin: Box<JSBundler::Plugin> = unsafe { bun_core::heap::take(plugin) };
        let mut bunstring_array: Vec<BunString> = Vec::with_capacity(plugin_list.len());
        for raw_plugin in &plugin_list {
            bunstring_array.push(BunString::from_bytes(raw_plugin));
        }
        let plugin_js_array = bun_string_jsc::to_js_array(global, &bunstring_array)?;
        let bunfig_folder_bunstr = bun_string_jsc::create_utf8_for_js(global, bunfig_folder)?;

        self.state = ServePluginsState::Pending {
            promise: jsc::JSPromiseStrong::init(global),
            plugin,
            html_bundle_routes: Vec::new(),
            dev_server: None,
        };

        global.bun_vm().event_loop_mut().enter();
        let result = jsc::host_fn::from_js_host_call(global, || {
            match &self.state {
                ServePluginsState::Pending { plugin, .. } => plugin.as_ref(),
                _ => unreachable!(),
            }
            .load_and_resolve_plugins_for_serve(plugin_js_array, bunfig_folder_bunstr)
        })?;
        global.bun_vm().event_loop_mut().exit();

        // handle the case where js synchronously throws an error
        if let Some(e) = global.try_take_exception() {
            self.handle_on_reject(global, e);
            return Ok(());
        }

        if !result.is_empty_or_undefined_or_null() {
            // handle the case where js returns a promise
            if let Some(promise) = result.as_any_promise() {
                match promise.status() {
                    // promise not fulfilled yet
                    jsc::js_promise::Status::Pending => {
                        // The reaction's ref, adopted by `on_resolve_impl`/`on_reject_impl`.
                        self.ref_();
                        let promise_value = promise.as_value();
                        if let ServePluginsState::Pending {
                            promise: pending_promise,
                            ..
                        } = &mut self.state
                        {
                            pending_promise.set(global, promise_value);
                        }
                        promise_value.then(
                            global,
                            std::ptr::from_mut::<Self>(self),
                            __jsc_host_on_resolve_impl,
                            __jsc_host_on_reject_impl,
                        );
                        return Ok(());
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        self.handle_on_resolve();
                        return Ok(());
                    }
                    jsc::js_promise::Status::Rejected => {
                        let value = promise.result(global.vm());
                        self.handle_on_reject(global, value);
                        return Ok(());
                    }
                }
            }

            if let Some(e) = result.to_error() {
                self.handle_on_reject(global, e);
            } else {
                self.handle_on_resolve();
            }
        }
        Ok(())
    }

    pub(crate) fn handle_on_resolve(&mut self) {
        debug_assert!(matches!(self.state, ServePluginsState::Pending { .. }));
        let ServePluginsState::Pending {
            plugin,
            dev_server,
            html_bundle_routes,
            promise,
        } = mem::replace(&mut self.state, ServePluginsState::Err)
        else {
            unreachable!()
        };
        drop(promise); // Drop on JscStrong releases the slot.

        self.state = ServePluginsState::Loaded(plugin);
        let plugin_ref = match &self.state {
            ServePluginsState::Loaded(p) => &**p,
            _ => unreachable!(),
        };

        for route in html_bundle_routes {
            bun_core::handle_oom(html_bundle::Route::on_plugins_resolved(
                route.this_ptr(),
                Some(NonNull::from(plugin_ref)),
            ));
        }
        if let Some(mut server) = dev_server {
            // SAFETY: dev_server outlives plugin load (stored as a back-reference
            // by `get_or_start_load`; the owning Box<DevServer> is held by the
            // server instance, which itself holds a counted ref on `self`).
            bun_core::handle_oom(unsafe { server.as_mut() }.on_plugins_resolved(Some(
                std::ptr::from_ref::<JSBundler::Plugin>(plugin_ref).cast_mut(),
            )));
        }
    }

    pub(crate) fn handle_on_reject(&mut self, global: &JSGlobalObject, err: JSValue) {
        debug_assert!(matches!(self.state, ServePluginsState::Pending { .. }));
        let ServePluginsState::Pending {
            plugin,
            dev_server,
            html_bundle_routes,
            promise,
        } = mem::replace(&mut self.state, ServePluginsState::Err)
        else {
            unreachable!()
        };
        drop(plugin); // pending.plugin.deinit()
        drop(promise); // Drop on JscStrong releases the slot.

        for route in html_bundle_routes {
            bun_core::handle_oom(route.on_plugins_rejected());
        }
        if let Some(mut server) = dev_server {
            // SAFETY: dev_server outlives plugin load
            bun_core::handle_oom(unsafe { server.as_mut() }.on_plugins_rejected());
        }

        Output::err_generic("Failed to load plugins for Bun.serve:", ());
        global.bun_vm().as_mut().run_error_handler(err, None);
    }
}

impl Drop for ServePlugins {
    fn drop(&mut self) {
        match &self.state {
            ServePluginsState::Unqueued(_) => {}
            ServePluginsState::Pending { .. } => debug_assert!(false), // should have one ref while pending!
            ServePluginsState::Loaded(_) => {}                         // Box<Plugin> drops
            ServePluginsState::Err => {}
        }
    }
}

#[bun_jsc::host_fn(export = "BunServe__onResolvePlugins")]
fn on_resolve_impl(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onResolve");

    let [plugins_result, plugins_js] = callframe.arguments_as_array::<2>();
    let plugins = plugins_js.as_promise_ptr::<ServePlugins>();
    // SAFETY: `plugins` was heap-allocated and ref()'d before .then(); this adopts that ref.
    let _guard = unsafe { RefPtr::from_raw(plugins) };
    plugins_result.ensure_still_alive();

    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_resolve();

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "BunServe__onRejectPlugins")]
fn on_reject_impl(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onReject");

    let [error_js, plugin_js] = callframe.arguments_as_array::<2>();
    let plugins = plugin_js.as_promise_ptr::<ServePlugins>();
    // SAFETY: `plugins` was heap-allocated and ref()'d before .then(); this adopts that ref.
    let _guard = unsafe { RefPtr::from_raw(plugins) };
    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_reject(global, error_js);

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
    CreateJsRequest, DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer, NewServer,
    ServerFlags, UserRoute,
};

/// Generic over the
/// per-transport `RequestContext` so the same body serves HTTP/1 and HTTP/3.
/// `super::PreparedRequest<SSL,DEBUG>` is the HTTP/1-concrete instantiation
/// used by the bake/saved-request path; the generic form here is only reached
/// from the `_for<Ctx>` dispatch helpers below.
pub(crate) struct PreparedRequestFor<Ctx> {
    pub(crate) js_request: JSValue,
    pub(crate) request_object: *mut Request,
    pub ctx: *mut Ctx,
}

// `WebSocketUpgradeServer<SSL>` so `ServerWebSocket::behavior::<Self, SSL>` and
// `app.ws(...)` accept `*mut Self` / `*mut UserRoute<..>` as the upgrade ctx.
impl<const SSL: bool, const DEBUG: bool> uws_sys::web_socket::WebSocketUpgradeServer<SSL>
    for NewServer<SSL, DEBUG>
where
    // NOTE: see the bounded `impl NewServer` below for why these are
    // spelled out — `on_web_socket_upgrade` lives in that impl.
    NewRequestContext<Self, SSL, DEBUG, false>: super::request_context::RequestContextHostFns,
    NewRequestContext<Self, SSL, DEBUG, true>: super::request_context::RequestContextHostFns,
{
    unsafe fn on_websocket_upgrade(
        this: *mut Self,
        res: *mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws_sys::Request,
        context: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        // S008: `Response<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        // SAFETY: forwarded raw — `this` is only dereferenced after the `id`
        // dispatch inside `on_web_socket_upgrade`.
        unsafe {
            Self::on_web_socket_upgrade(this, bun_opaque::opaque_deref_mut(res), req, context, id)
        };
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    /// Construct the cross-module `super::AnyServer` back-reference. Routes
    /// (StaticRoute/FileRoute/HTMLBundle) store this so they can call back
    /// into `on_pending_request` / `on_static_request_complete`.
    #[inline]
    fn as_any_server(&self) -> super::AnyServer {
        super::AnyServer::from(std::ptr::from_ref::<Self>(self))
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

    /// `&mut` accessor for the live uws App. Only call from paths where the
    /// server is running (`self.app` set in `listen()`).
    #[inline]
    fn app_mut(&self) -> &mut uws_sys::NewApp<SSL> {
        // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref via
        // const-asserted `bun_opaque::opaque_deref_mut`. `self.app` is `Some`
        // for the lifetime of any JS-reachable `Server` (set in `listen()`,
        // freed in `deinit()` after the JS wrapper is gone).
        bun_opaque::opaque_deref_mut(self.app.expect("server not listening"))
    }

    /// Unbounded so `deinit()` (in
    /// the unbounded `impl NewServer` in mod.rs) can call it without naming
    /// the per-transport `RequestContext` bounds.
    pub(super) fn notify_inspector_server_stopped(&mut self) {
        if self.inspector_server_id.get() != 0 {
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
                self.inspector_server_id = DebuggerId::init(0);
            }
        }
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG>
where
    // NOTE (const-generic dispatch): `RequestContextHostFns` (the host-fn
    // export table) is blanket-impl'd per (SSL,DBG,H3) tuple in
    // `RequestContext.rs` for `ThisServer: ServerLike`; restating it here lets
    // method bodies name `<NewRequestContext<..> as RequestContextHostFns>::ON_*`
    // without each method repeating the bound.
    NewRequestContext<Self, SSL, DEBUG, false>: super::request_context::RequestContextHostFns,
    NewRequestContext<Self, SSL, DEBUG, true>: super::request_context::RequestContextHostFns,
{
    // NOTE: there is no `getPluginsAsync` method or `AnyServer` dispatcher;
    // the live HTMLBundle path goes through `get_or_load_plugins`.

    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub(crate) fn get_or_load_plugins(
        &mut self,
        callback: ServePluginsCallback<'_>,
    ) -> GetOrStartLoadResult<'_> {
        if let Some(p) = &self.plugins {
            // Keep `*p` alive across re-entrant JS in `load_and_resolve_plugins`.
            let p = p.clone();
            let global = self.global();
            // SAFETY: intrusive refcount permits mutation through any owner. No
            // other `&mut ServePlugins` is live on this (single-threaded) JS
            // thread for the call's duration.
            return match unsafe { &mut *p.as_ptr() }.get_or_start_load(&global, callback) {
                Ok(r) => r,
                Err(JsError::Thrown | JsError::Terminated) => {
                    panic!("unhandled exception from ServePlugins.getStartOrLoad")
                }
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            };
        }
        // no plugins
        GetOrStartLoadResult::Ready(None)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_subscriber_count(
        &mut self,
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
            self.app_mut().num_subscribers(topic.slice()),
        )))
    }

    // ── host_fn.wrapInstanceMethod hand-expansions ───────────────────────
    //
    // NOTE: the `#[bun_jsc::host_fn(method)]` proc-macro that will eventually
    // replace these hand-expansions hasn't landed, so the per-type decode arms
    // used by the server (`EncodedSlice`, `JSValue`, `Option<JSValue>`, `&Request`)
    // are open-coded here.

    /// `pub const doStop = host_fn.wrapInstanceMethod(ThisServer, "stopFromJS", false)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_stop(
        &mut self,
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
        &mut self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self.dispose_from_js())
    }

    /// `pub const doUpgrade = host_fn.wrapInstanceMethod(ThisServer, "onUpgrade", false)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_upgrade(
        &mut self,
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
        &mut self,
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
        &mut self,
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
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.on_reload(global, callframe)
    }

    /// `pub const doFetch = onFetch`
    #[inline]
    pub(crate) fn do_fetch(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.on_fetch(global, callframe)
    }

    /// `pub const doTimeout = timeout`
    #[inline]
    pub(crate) fn do_timeout(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.timeout(global, callframe)
    }

    pub(crate) fn request_ip(&self, request: &Request) -> JsResult<JSValue> {
        if matches!(self.config.address, server_config::Address::Unix(_)) {
            return Ok(JSValue::NULL);
        }
        let Some(info) = request.request_context.get_remote_socket_info() else {
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
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 2 || arguments[0].is_empty_or_undefined_or_null() {
            return Err(global.throw_not_enough_arguments("timeout", 2, arguments.len()));
        }

        let seconds = arguments[1];

        if matches!(self.config.address, server_config::Address::Unix(_)) {
            return Ok(JSValue::NULL);
        }

        if !seconds.is_number() {
            return Err(self
                .global()
                .throw(format_args!("timeout() requires a number")));
        }
        let value = seconds.to_u32();

        if let Some(request) = <Request as bun_jsc::JsClass>::from_js(arguments[0]) {
            // SAFETY: from_js returns a live *mut Request; shared access only.
            let _ = unsafe { (*request).request_context.set_timeout(value) };
        } else if let Some(response) = <NodeHTTPResponse as bun_jsc::JsClass>::from_js(arguments[0])
        {
            // SAFETY: from_js returns a live *mut NodeHTTPResponse
            unsafe { (*response).set_timeout((value % 255) as u8) };
        } else {
            return Err(self
                .global()
                .throw_invalid_arguments(format_args!("timeout() requires a Request object")));
        }

        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn publish(
        &mut self,
        global: &JSGlobalObject,
        topic: &[u8],
        message_value: JSValue,
        compress_value: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if self.config.websocket.is_none() {
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

        let Some(app) = self.app else {
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
        &mut self,
        global: &JSGlobalObject,
        object: JSValue,
        optional: Option<JSValue>,
    ) -> JsResult<JSValue> {
        use super::node_http_response::Flags as NodeHTTPResponseFlags;
        use bun_core::Utf8Bytes;
        use bun_jsc::HTTPHeaderName;

        if self.config.websocket.is_none() {
            return Err(global.throw_invalid_arguments(format_args!(
                "To enable websocket support, set the \"websocket\" object in Bun.serve({{}})"
            )));
        }

        if self.flags.contains(ServerFlags::TERMINATED) {
            return Ok(JSValue::FALSE);
        }

        // `deinit_if_we_can` only clears `handler.server` once every
        // connection has closed, so this is defensive for the `Finalized`
        // window between the wrapper's `finalize()` and the next-tick
        // `schedule_deinit`: accepting an upgrade there would create a
        // `ServerWebSocket` whose open/close accounting is skipped.
        if self
            .config
            .websocket
            .as_ref()
            .is_some_and(|ws| ws.handler.server.is_none())
        {
            return Ok(JSValue::FALSE);
        }

        if let Some(node_http_response) = <NodeHTTPResponse as bun_jsc::JsClass>::from_js(object) {
            // SAFETY: from_js returns a live *mut NodeHTTPResponse; shared —
            // its mutable state is `Cell`/`JsCell` and `upgrade` takes `&self`.
            let node_http_response = unsafe { &*node_http_response };
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

            // if we converted a HeadersInit to a Headers object, we need to free it
            let fetch_headers_to_deref: core::cell::Cell<Option<*mut FetchHeaders>> =
                core::cell::Cell::new(None);
            let _fh_guard = scopeguard::guard(&fetch_headers_to_deref, |cell| {
                if let Some(fh) = cell.get() {
                    // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                    bun_opaque::opaque_deref_mut(fh).deref();
                }
            });

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
                                            FetchHeaders::create_from_js(global, headers_value)?
                                        {
                                            fetch_headers_to_deref
                                                .set(Some(fetch_headers.as_ptr()));
                                            break 'brk fetch_headers.as_ptr();
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

        let Some(request_ptr) = <Request as bun_jsc::JsClass>::from_js(object) else {
            return Err(
                global.throw_invalid_arguments(format_args!("upgrade requires a Request object"))
            );
        };
        // SAFETY: from_js returns a live *mut Request (rooted by the caller's
        // argument). Shared, re-derived after each JS re-entry point below; the
        // one field write at the end goes through `request_ptr`.
        let request = unsafe { &*request_ptr };

        let Some(upgrader_ptr) = request
            .request_context
            .get::<ServerRequestContext<SSL, DEBUG>>()
        else {
            return Ok(JSValue::FALSE);
        };
        // SAFETY: tagged pointer just matched this monomorphization.
        let upgrader = unsafe { &*upgrader_ptr };

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
        let _upgrader_guard = scopeguard::guard(upgrader_ptr, |p| {
            // SAFETY: `p` is the live `upgrader_ptr` whose refcount was bumped by
            // the `ref_()` above; this guard pairs it with a single `deref()`.
            unsafe { (*p).deref() }
        });

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

        // SAFETY: upgrader_ptr is live (ref_() above)
        let upgrader = unsafe { &*upgrader_ptr };
        if let Some(req_ptr) = upgrader.req.get() {
            // NOTE: `RequestContext.req` is type-erased to `*mut c_void`
            // (RequestContext.rs:82). `server.upgrade()` is HTTP/1-only — H3
            // contexts have a distinct generic param and `request_context.get`
            // above would have returned None — so the concrete `Req` is always
            // `uws_sys::Request` here.
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
            // SAFETY: upgrader_ptr is live (ref_() above)
            let upgrader = unsafe { &*upgrader_ptr };
            upgrader.flags.set_has_written_status(true);
            upgrader.end_without_body(true);
            return Ok(JSValue::FALSE);
        }
        let mut data_value = JSValue::ZERO;
        // Non-unit guard state: holds the temporarily-created FetchHeaders (if
        // any) and derefs it on scope exit. Populated below via DerefMut.
        let mut fetch_headers_to_deref = scopeguard::guard(None::<*mut FetchHeaders>, |fh| {
            // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
            if let Some(h) = fh {
                bun_opaque::opaque_deref_mut(h).deref()
            }
        });
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
                                    FetchHeaders::create_from_js(global, headers_value)?
                                {
                                    *fetch_headers_to_deref = Some(created.as_ptr());
                                    break 'brk created.as_ptr();
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

        // SAFETY: upgrader_ptr is live (ref_() above)
        let upgrader = unsafe { &*upgrader_ptr };
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

        // --- After this point, do not throw an exception
        // See https://github.com/oven-sh/bun/issues/1339
        upgrader.upgrade_context.set(UpgradeState::Upgraded);
        let signal = upgrader.signal.take();
        upgrader.resp.set(None);

        // Snapshot lazy url/headers before detaching (mirrors to_async_without_abort_handler).
        // SAFETY: re-derived after the JS-running option getters above; still
        // the live JsClass payload for `object`.
        let request = unsafe { &*request_ptr };
        if request.ensure_url().is_err() {
            request.url.set(BunString::EMPTY);
        }
        if !request.has_fetch_headers() {
            if let Some(req_ptr) = upgrader.req.get() {
                request.set_fetch_headers(Some(HeadersRef::create_from_uws(req_ptr)));
            }
        }

        // SAFETY: plain-field detach through the root pointer; the shared
        // borrow above is not used past this point.
        unsafe { (*request_ptr).request_context = AnyRequestContext::NULL };
        upgrader.request_weakref.set(request::WeakRef::EMPTY);

        data_value.ensure_still_alive();
        let ws = ServerWebSocket::init(
            &self.config.websocket.as_mut().unwrap().handler,
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
        &mut self,
        new_config: &mut ServerConfig,
        global: &JSGlobalObject,
    ) {
        httplog!("onReload");

        // SAFETY: `on_reload` is only reachable while the server is running
        // (`self.app` set in `listen()`).
        self.app_mut().clear_routes();
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
            self.config.on_request = new_config.on_request;
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
        if self.config.is_node_http_server
            && self.config.on_node_http_request != new_config.on_node_http_request
        {
            super::wrap_handler_slot(
                &mut new_config.on_node_http_request,
                server_js,
                global,
                Self::js_gc_on_node_http_request_set,
            );
            self.config.on_node_http_request = new_config.on_node_http_request;
        }
        if !new_config.on_error.is_empty_or_undefined_or_null() {
            super::wrap_handler_slot(
                &mut new_config.on_error,
                server_js,
                global,
                Self::js_gc_on_error_set,
            );
            self.config.on_error = new_config.on_error;
        }

        if let Some(mut ws) = new_config.websocket.take() {
            // `Handler::from_js` already rejected configs with no non-error
            // callback, so any `Some(ws)` is adoptable — match initial-serve
            // and adopt unconditionally.
            ws.handler
                .flags
                .set(super::web_socket_server_context::HandlerFlags::SSL, SSL);
            self.config.websocket = Some(ws);
            self.write_ws_handler_slots(server_js, global);
        }

        // These get re-applied when we set the static routes again.
        if let Some(dev_server) = self.dev_server.as_deref_mut() {
            // Prevent a use-after-free in the hash table keys.
            dev_server.html_router.clear();
            dev_server.html_router.fallback = None;
        }

        // NOTE: `Vec<StaticRouteEntry>` impls `Drop`, so
        // a move-assign frees the old `static_routes`.
        self.config.static_routes = core::mem::take(&mut new_config.static_routes);
        self.config.negative_routes = core::mem::take(&mut new_config.negative_routes);

        if new_config.had_routes_object {
            self.config.user_routes_to_build =
                core::mem::take(&mut new_config.user_routes_to_build);
            // `UserRoute`'s owned `RouteDeclaration` drops via `Vec::clear`.
            self.user_routes.clear();
        }

        let route_list_value = self.set_routes();
        if new_config.had_routes_object {
            Self::js_gc_route_list_set(server_js, global, route_list_value);
        }

        if self.inspector_server_id.get() != 0 {
            if let Some(debugger) = self.vm().as_mut().debugger.as_deref_mut() {
                bun_core::handle_oom(super::http_server_agent::notify_server_routes_updated(
                    &debugger.http_server_agent,
                    self.as_any_server(),
                ));
            }
        }
    }

    pub(crate) fn reload_static_routes(&mut self) -> Result<bool, crate::Error> {
        if self.app.is_none() {
            // Static routes will get cleaned up when the server is stopped
            return Ok(false);
        }
        self.config = self.config.clone_for_reloading_static_routes()?;
        self.app_mut().clear_routes();
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
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global.throw_not_enough_arguments("reload", 1, 0));
        }

        // SAFETY: bun_vm() returns the live per-thread VM singleton.
        let mut args_slice = jsc::ArgumentsSlice::init(global.bun_vm(), arguments);

        let mut new_config = ServerConfig::from_js(
            global,
            &mut args_slice,
            server_config::FromJSOptions {
                allow_bake_config: false,
                is_fetch_required: true,
                previous_fetch: !self.config.on_request.is_empty_or_undefined_or_null(),
                previous_routes: !self.user_routes.is_empty(),
            },
        )?;

        // `on_reload_from_zig` moves `new_config.websocket` into the unscanned
        // `self.config` heap box before `write_ws_handler_slots` roots the 7
        // ws shadows, and each `wrap_handler_slot` call allocates via
        // `with_async_context_if_needed`. Same window as `serve()`; same fix.
        let _handler_pins = super::protect_handler_shadows(&new_config);
        self.on_reload_from_zig(&mut new_config, global);

        Ok(self.js_value.try_get().unwrap_or(JSValue::UNDEFINED))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn on_fetch(
        &mut self,
        ctx: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if self.config.on_request.is_empty() {
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
        // SAFETY: bun_vm() returns the live per-thread VM singleton.
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
                        // NOTE: `cast_` returns the `FetchHeaders*` held by the
                        // JS `Headers` wrapper (`JSFetchHeaders`'s internal
                        // `Ref<FetchHeaders>`) without bumping the refcount —
                        // the FFI surface has `WebCore__FetchHeaders__deref` but
                        // no `ref()`, so a +1 cannot be taken here. Adopting
                        // hands that wrapper-held ref to the constructed
                        // `Request` (via `Request::init2` below): the eventual
                        // single deref happens when the Request's finalizer
                        // drops its `headers` field (`HeadersRef::Drop`,
                        // Response.rs), pairing with the wrapper's +1.
                        // SAFETY: `headers__` is live (rooted by `headers_`),
                        // and ownership of one ref transfers as described above.
                        headers = Some(unsafe { HeadersRef::adopt(headers__) });
                    } else if let Some(headers__) = FetchHeaders::create_from_js(ctx, headers_)? {
                        // SAFETY: create_from_js returns a +1 ref.
                        headers = Some(unsafe { HeadersRef::adopt(headers__) });
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
            .then(|| <Request as bun_jsc::JsClass>::from_js(first_arg))
            .flatten()
        {
            // SAFETY: JsClass::from_js returns a live *mut Request.
            // NOTE: `Request::clone()` (Request.rs:1627) seeds a fully-initialized
            // sentinel and calls `clone_into(.., preserve_url=false)`.
            unsafe { (*request_).clone(ctx)? }
        } else {
            let fetch_error = Fetch::fetch_type_error_string(first_arg);
            let err = jsc::ErrorCode::INVALID_ARG_TYPE.fmt(ctx, format_args!("{}", fetch_error));
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(ctx, err),
            );
        };

        // `Request::to_js` stores `self as *mut
        // Request` into the JS wrapper, which adopts ownership and frees the
        // allocation in its GC finalizer. Relinquish the `Box` here so the
        // local going out of scope does not also drop it (double-free / UAF).
        let request: *mut Request = bun_core::heap::into_raw(existing_request);

        debug_assert!(!self.config.on_request.is_empty()); // confirmed above
        let global_this = self.global();
        let on_request = self.config.on_request;
        // SAFETY: `request` was just allocated via `heap::alloc`; ownership
        // transfers to the JS wrapper inside `to_js`.
        let request_value = unsafe { (*request).to_js(&global_this) };
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

        if let Some(resp) = <Response as bun_jsc::JsClass>::from_js(response_value) {
            // SAFETY: `from_js` returns a live `*mut Response` (owned by its
            // JS wrapper, which `response_value` keeps alive). `request` is
            // kept alive by `request_value` (its JS wrapper) for the duration
            // of this synchronous frame.
            unsafe { (*resp).set_url((*request).url.get().clone()) };
        }
        Ok(JSPromise::resolved_promise_value(ctx, response_value))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn close_idle_connections(
        &mut self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.app.is_none() || self.deinit_running.get() {
            return Ok(JSValue::js_number(0.0));
        }
        // Each close reaches `on_connection_filter(-2)` synchronously; hold
        // the guard so it cannot re-derive `&mut self` while this frame owns
        // it. One-shot sweep (Node semantics): busy connections are spared
        // and are NOT marked to close later.
        self.deinit_running.set(true);
        let closed = self.app_mut().close_idle_connections(false);
        self.deinit_running.set(false);
        self.deinit_if_we_can();
        Ok(JSValue::js_number(closed as f64))
    }

    pub(crate) fn stop_from_js(&mut self, abruptly: Option<JSValue>) -> JSValue {
        let rc = self.get_all_closed_promise(&self.global());

        let abrupt = matches!(abruptly, Some(v) if v.is_boolean() && v.to_boolean());
        // `!deinit_running`: a `server.stop()` reached from a close callback
        // that an outer `stop()`'s drain fired would re-enter `stop_listening`
        // with a fresh `&mut self` under the outer frame's borrow.
        if self.has_listener()
            || (abrupt
                && !self.flags.contains(ServerFlags::TERMINATED)
                && !self.deinit_running.get())
        {
            self.stop(abrupt);
        }

        rc
    }

    pub(crate) fn dispose_from_js(&mut self) -> JSValue {
        if self.has_listener()
            || (!self.flags.contains(ServerFlags::TERMINATED) && !self.deinit_running.get())
        {
            self.stop(true);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_port(&self, _: &JSGlobalObject) -> JSValue {
        let config_port = match &self.config.address {
            server_config::Address::Unix(_) => return JSValue::UNDEFINED,
            server_config::Address::Tcp { port, .. } => *port,
        };

        if let Some(listener) = self.listener {
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            if let Some(p) = bun_opaque::opaque_deref_mut(listener).get_local_port() {
                return JSValue::js_number(p as f64);
            }
        }
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener {
                // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                if let Some(p) = bun_opaque::opaque_deref_mut(h3l).get_local_port() {
                    return JSValue::js_number(p as f64);
                }
            }
        }
        JSValue::js_number(config_port as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_id(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_string_jsc::create_utf8_for_js(global, &self.config.id)
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
        match &self.config.address {
            server_config::Address::Unix(unix) => {
                bun_string_jsc::create_utf8_for_js(global, unix.as_bytes())
            }
            server_config::Address::Tcp { port: tcp_port, .. } => {
                let mut port: u16 = *tcp_port;

                if let Some(listener) = self.listener {
                    // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
                    let listener = bun_opaque::opaque_deref_mut(listener);
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
                if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener {
                        // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                        let h3l = bun_opaque::opaque_deref_mut(h3l);
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
        match &self.config.address {
            server_config::Address::Unix(_) => return Ok(JSValue::UNDEFINED),
            server_config::Address::Tcp { .. } => {}
        }
        {
            if let Some(listener) = self.listener {
                let mut buf = [0u8; 1024];
                // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
                if let Some(addr) = bun_opaque::opaque_deref_mut(listener)
                    .socket()
                    .remote_address(&mut buf[..1024])
                {
                    if !addr.is_empty() {
                        return bun_string_jsc::create_utf8_for_js(global, addr);
                    }
                }
            }
            {
                match &self.config.address {
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

    pub fn finalize(self: Box<Self>) {
        httplog!("finalize");
        let this_ptr = bun_core::heap::into_raw(self);
        // SAFETY: just unboxed; uniquely owned here until either the inline
        // `deinit()` below or `schedule_deinit()`'s enqueued task reclaims it.
        // `deinit_if_we_can` may defer (pending requests), so the free is not
        // unconditional. `Box::into_raw` (not `heap::release`) keeps raw-owner
        // provenance for the `deinit()` dealloc — a `&mut self`-derived tag
        // there would be Stacked-Borrows UB. JSC-handle Drops are no-ops past
        // `is_shutting_down()`; `TERMINATED` means `app.close()` already ran,
        // so `NewApp::destroy` can't orphan a keep-alive socket.
        unsafe {
            (*this_ptr).js_value.finalize();
            (*this_ptr).deinit_if_we_can();
            if (*this_ptr).flags.contains(ServerFlags::DEINIT_SCHEDULED)
                && (*this_ptr).flags.contains(ServerFlags::TERMINATED)
                && (*this_ptr).vm().is_shutting_down()
            {
                Self::deinit(this_ptr);
            }
        }
    }

    pub(crate) fn get_all_closed_promise(&mut self, global: &JSGlobalObject) -> JSValue {
        if self.is_closed() {
            return JSPromise::resolved_promise(global, JSValue::UNDEFINED).to_js();
        }
        if self.all_closed_promise.has_value() {
            return self.all_closed_promise.value();
        }
        self.all_closed_promise = jsc::JSPromiseStrong::init(global);
        self.all_closed_promise.value()
    }

    // `notify_inspector_server_stopped` lives in the unbounded impl block
    // above so the unbounded `deinit()` (mod.rs) can call it.

    /// Route handler for the HTTP/2 and HTTP/3 apps (`R` = `uws::H2::Response`
    /// or `uws::H3::Response`); both hand us the same decoded-header request.
    pub(super) fn on_mux_request<R: RespLike>(&mut self, req: &mut uws::H3::Request, resp: &mut R) {
        if self.config.on_request.is_empty() {
            return Self::on_mux_404(self, req, resp);
        }
        self.on_request_for::<ServerMuxRequestContext<SSL, DEBUG>, _>(req, resp);
    }

    pub(super) fn on_mux_user_route_request<R: RespLike>(
        user_route: &mut UserRoute<SSL, DEBUG>,
        req: &mut uws::H3::Request,
        resp: &mut R,
    ) {
        Self::on_user_route_request_for::<ServerMuxRequestContext<SSL, DEBUG>, _>(
            user_route, req, resp,
        );
    }

    pub(super) fn on_mux_404<R: RespLike>(
        _this: &mut Self,
        _req: &mut uws::H3::Request,
        resp: &mut R,
    ) {
        resp.write_status(b"404 Not Found");
        resp.end_without_body(false);
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(
        &mut self,
        _: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.ref_();
        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unref(
        &mut self,
        _: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.unref();
        Ok(this_value)
    }

    pub(crate) fn on_bun_info_request(
        &mut self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        jsc::mark_binding!();
        if !matches!(self.config.address, server_config::Address::Unix(_))
            && (!bake::is_allowed_host_header(req, Some(&self.config.address))
                || !resp
                    .get_remote_socket_info()
                    .is_some_and(|address| address.is_loopback()))
        {
            req.set_yield(true);
            return;
        }
        self.on_pending_request();
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
        self.pending_requests.set(self.pending_requests.get() - 1);
    }

    // `on_chrome_dev_tools_json_request` is defined once below (next to
    // `on404`); a second copy here was a concurrent-port duplicate and has
    // been removed.

    fn on_user_route_request_for<Ctx: RequestCtxOps<Server = Self>, R: RespLike>(
        user_route: &UserRoute<SSL, DEBUG>,
        req: &mut Ctx::Req,
        resp: &mut R,
    ) {
        debug_assert!(!user_route.server.is_null());
        // SAFETY: `UserRoute.server` is the owning `*mut NewServer` (write
        // provenance), a back-pointer to the owning server, which outlives
        // every route it registered.
        let server_ref = unsafe { bun_ptr::BackRef::from_raw_mut(user_route.server) };
        let server_ptr = server_ref.as_ptr();
        let index = user_route.id;

        let Some(server_js) = server_ref.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };

        let should_deinit_context = core::cell::Cell::new(false);
        let Some(mut prepared) = Self::prepare_js_request_context_for::<Ctx, R>(
            server_ptr,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::No,
            user_route.route.method.specific(),
        ) else {
            return;
        };

        let _entered = server_ref.vm().enter_event_loop_scope_without_checkpoint();
        let server_request_list = Self::js_route_list_get_cached(server_js).unwrap();
        let call_route = if Ctx::IS_MUX {
            Bun__ServerRouteList__callRouteH3
        } else {
            Bun__ServerRouteList__callRoute
        };
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST — safe deref.
        let global = bun_opaque::opaque_deref(server_ref.global_this);
        let response_value = match jsc::from_js_host_call(global, || {
            call_route(
                global,
                index,
                prepared.request_object,
                server_js,
                server_request_list,
                &mut prepared.js_request,
                std::ptr::from_mut(req).cast::<c_void>(),
            )
        }) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        Self::handle_request_for::<Ctx>(
            server_ptr,
            &should_deinit_context,
            &prepared,
            req,
            response_value,
        );
    }

    fn handle_request_for<Ctx: RequestCtxOps<Server = Self>>(
        this: *mut Self,
        should_deinit_context: &core::cell::Cell<bool>,
        prepared: &PreparedRequestFor<Ctx>,
        req: &mut Ctx::Req,
        response_value: JSValue,
    ) {
        let request_object_ptr: *mut Request = prepared.request_object;
        let detach_ptr = request_object_ptr;
        scopeguard::defer! {
            // uWS request will not live longer than this function
            // SAFETY: request_object outlives this stack frame (boxed on the request).
            unsafe { (*detach_ptr).request_context.detach_request() };
        }

        // SAFETY: `prepared.ctx` was allocated by `prepare_js_request_context_for`
        // for this frame and cannot be freed while `defer_deinit_...` is set (set
        // by the caller until cleared below); `this` is the live server backref.
        let (ctx, server) = unsafe { (&*prepared.ctx, &*this) };
        RequestCtxOps::on_response(ctx, server, prepared.js_request, response_value);
        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        RequestCtxOps::set_defer_deinit(ctx, None);

        if should_deinit_context.get() {
            RequestCtxOps::deinit(ctx);
            return;
        }

        if RequestCtxOps::should_render_missing(ctx) {
            RequestCtxOps::render_missing(ctx);
            return;
        }

        // The request is asynchronous, and all information from `req` must be copied
        // since the provided uws.Request will be re-used for future requests (stack allocated).
        // SAFETY: `request_object_ptr` is the live heap `Request` (see above).
        RequestCtxOps::to_async(ctx, req, unsafe { &mut *request_object_ptr });
    }

    fn on_request_for<Ctx: RequestCtxOps<Server = Self>, R: RespLike>(
        &mut self,
        req: &mut Ctx::Req,
        resp: &mut R,
    ) {
        let Some(js_value) = self.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };
        let self_ptr: *mut Self = self;
        let should_deinit_context = core::cell::Cell::new(false);
        let Some(prepared) = Self::prepare_js_request_context_for::<Ctx, R>(
            self_ptr,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::Yes,
            None,
        ) else {
            return;
        };

        // SAFETY: `self_ptr` is `self`, live for this frame. Shared — the
        // handler call below re-enters JS, so no `&mut` may span it.
        let server = unsafe { &*self_ptr };
        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        let on_request_fn = server.config.on_request;
        debug_assert!(!on_request_fn.is_empty());

        let global = server.global_this();
        let response_value =
            match on_request_fn.call(global, js_value, &[prepared.js_request, js_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

        Self::handle_request_for::<Ctx>(
            self_ptr,
            &should_deinit_context,
            &prepared,
            req,
            response_value,
        );
    }

    fn prepare_js_request_context_for<Ctx: RequestCtxOps<Server = Self>, R: RespLike>(
        this: *mut Self,
        req: &mut Ctx::Req,
        resp: &mut R,
        should_deinit_context: Option<DeferDeinitFlag>,
        create_js_request: CreateJsRequest,
        method: Option<http::Method>,
    ) -> Option<PreparedRequestFor<Ctx>> {
        jsc::mark_binding!();
        // SAFETY: `this` is the live heap server registered as the callback
        // user-data; everything below only needs `&Self`.
        let server = unsafe { &*this };

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
        // `Ctx::create`.
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
                if len > server.config.max_request_body_size {
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
        RespLike::timeout(resp, server.config.idle_timeout);

        // Since we do timeouts by default, we should tell the user when
        // this happens - but limit it to only warn once.
        if server.should_add_timeout_handler_for_warning() {
            // We need to pass it a pointer, any pointer should do.
            // SAFETY: the user-data pointer is an opaque sentinel — `on_timeout_for_idle_warn`
            // ignores it and reads the static directly. `AtomicBool::as_ptr` yields a `*mut`
            // with interior-mutability provenance, so no `&T as *const _ as *mut _` cast is needed.
            RespLike::on_timeout_warn(
                resp,
                did_send_idletimeout_warning_once()
                    .as_ptr()
                    .cast::<c_void>(),
            );
        }

        let any_resp = RespLike::to_any_response(resp);
        // SAFETY: both allocators hand out `*mut RequestContext<_, SSL, DEBUG, _>`; the
        // const-bool MUX parameter only affects associated consts/types, not layout, so
        // reinterpreting the slot pointer as the caller's `Ctx` monomorphization is sound.
        //
        // `claim()` reserves the slot as a `HiveSlot`; `create_in` does
        // `MaybeUninit::write` placement-new through the slot's stable
        // address, after which `assume_init()` consumes the token.
        // `RequestContext` carries the heaviest drop glue in the codebase, so
        // a panic inside `create_in` now releases the slot via
        // `HiveSlot::drop` without running `RequestContext::drop` on garbage.
        let ctx_slot: *mut Ctx = unsafe {
            if Ctx::IS_MUX {
                debug_assert!(
                    !server.mux_request_pool.is_null(),
                    "HTTP/2 or HTTP/3 request dispatched but mux_request_pool was never allocated"
                );
                let slot = (*server.mux_request_pool).claim();
                Ctx::create_in(
                    slot.addr().as_ptr().cast(),
                    this,
                    req,
                    any_resp,
                    should_deinit_context,
                    method,
                );
                // SAFETY: `create_in` fully initialized the slot via `MaybeUninit::write`.
                slot.assume_init().as_ptr().cast()
            } else {
                let slot = (*server.request_pool).claim();
                Ctx::create_in(
                    slot.addr().as_ptr().cast(),
                    this,
                    req,
                    any_resp,
                    should_deinit_context,
                    method,
                );
                // SAFETY: `create_in` fully initialized the slot via `MaybeUninit::write`.
                slot.assume_init().as_ptr().cast()
            }
        };
        // SAFETY: ctx_slot was just initialized by create_in.
        let ctx = unsafe { &*ctx_slot };

        server
            .vm()
            .jsc_vm()
            .deprecated_report_extra_memory(core::mem::size_of::<Ctx>());

        // Pooled body slot, ref_count = 1.
        let body_hive = crate::webcore::body::hive_alloc(BodyValue::Null);
        // The ctx and Request each own a +1 on the same slot: see the
        // `RequestContext::request_body` doc and `Request::finalize`.
        ctx.set_request_body(Some(body_hive.clone()));

        let signal = AbortSignal::new(&server.global());
        ctx.set_signal(signal);
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe deref.
        bun_opaque::opaque_deref_mut(signal).pending_activity_ref();

        // The Request's own ref.
        let signal_for_req = bun_opaque::opaque_deref_mut(signal).ref_();
        let request_object_box = Request::new(Request::init(
            ctx.ctx_method(),
            AnyRequestContext::init(std::ptr::from_ref::<Ctx>(ctx)),
            SSL,
            Some(signal_for_req),
            body_hive,
        ));
        // Leak so the ctx (which outlives this stack frame) can hold the
        // pointer; Request is freed via ctx.deinit's request_weakref. The weak
        // handle takes the raw pointer, not a reborrow of `request_object`:
        // writes through `request_object` below would otherwise invalidate it.
        let request_object_ptr: *mut Request = bun_core::heap::into_raw(request_object_box);
        ctx.set_request_weakref(request_object_ptr);
        // SAFETY: freshly leaked; shared view — everything below (headers/url
        // population, `to_js`) takes `&Request`.
        let request_object: &Request = unsafe { &*request_object_ptr };

        // The lazy `getRequest()` path that backs Request.url / .headers
        // is `*uws.Request`-typed; for HTTP/2 and HTTP/3 we populate both
        // eagerly so the rest of the pipeline never needs to know which
        // transport delivered the bytes.
        if Ctx::IS_MUX {
            // SAFETY: create_from_h3 returns a +1-ref FetchHeaders; adopt into RAII wrapper.
            request_object.set_fetch_headers(Some(unsafe {
                crate::webcore::response::HeadersRef::adopt(FetchHeaders::create_from_h3(
                    std::ptr::from_mut(req).cast::<c_void>(),
                ))
            }));
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
            let is_te = ReqLike::has_transfer_encoding(req);
            ctx.set_is_transfer_encoding(is_te);
            // HTTP/2 and HTTP/3 frame the body by END_STREAM or QUIC FIN, not Content-Length.
            if req_len > 0 || is_te || (Ctx::IS_MUX && !RespLike::request_body_ended(resp)) {
                // we defer pre-allocating the body until we receive the first chunk
                // that way if the client is lying about how big the body is or the client aborts
                // we don't waste memory
                if let Some(body) = ctx.request_body_mut() {
                    *body = BodyValue::Locked(crate::webcore::body::PendingValue {
                        task: Some(NonNull::new(ctx_slot).unwrap().cast::<c_void>()),
                        global: server.global_this,
                        on_start_buffering: Some(Ctx::on_start_buffering_callback),
                        on_start_streaming: Some(Ctx::on_start_streaming_request_body_callback),
                        on_readable_stream_available: Some(
                            Ctx::on_request_body_readable_stream_available,
                        ),
                        producer: crate::webcore::streams::SourceHandle::ServerRequestBody(
                            AnyRequestContext::init(ctx_slot),
                        ),
                        ..Default::default()
                    });
                }
                ctx.set_is_waiting_for_request_body(true);
                ctx.arm_on_data(any_resp);
            }
        }

        Some(PreparedRequestFor {
            js_request: match create_js_request {
                CreateJsRequest::Yes => request_object.to_js(&server.global()),
                CreateJsRequest::Bake => match request_object.to_js_for_bake(&server.global()) {
                    Ok(v) => v,
                    Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                    Err(_) => return None,
                },
                CreateJsRequest::No => JSValue::ZERO,
            },
            request_object: request_object_ptr,
            ctx: ctx_slot,
        })
    }

    fn upgrade_web_socket_user_route(
        this: &UserRoute<SSL, DEBUG>,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws::Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        method: Option<http::Method>,
    ) {
        // BACKREF: `UserRoute.server` is set at construction from the owning
        // `NewServer` (which outlives every `UserRoute` in its `user_routes`
        // vec); non-null by invariant.
        debug_assert!(!this.server.is_null());
        // SAFETY: `UserRoute.server` is the owning `*mut NewServer` (write provenance),
        // set at construction and non-null while the route is registered.
        let server_ref = unsafe { bun_ptr::BackRef::from_raw_mut(this.server) };
        let server_ptr = server_ref.as_ptr();
        let index = this.id;

        let Some(server_js) = server_ref.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };

        let should_deinit_context = core::cell::Cell::new(false);
        // SAFETY: `server_ptr` is the live heap server registered for this route;
        // `req`/`resp` are the live uWS handles passed to the route handler.
        let Some(mut prepared) = Self::prepare_js_request_context(
            server_ptr,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::No,
            method,
        ) else {
            return;
        };
        // SAFETY: `prepared.ctx` is the freshly-allocated RequestContext slot.
        unsafe {
            (*prepared.ctx)
                .upgrade_context
                .set(UpgradeState::Pending(NonNull::from(upgrade_ctx)))
        };
        let _entered = server_ref.vm().enter_event_loop_scope_without_checkpoint();
        let server_request_list = Self::js_route_list_get_cached(server_js).unwrap();
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST — safe deref.
        let global = bun_opaque::opaque_deref(server_ref.global_this);
        let response_value = match jsc::from_js_host_call(global, || {
            Bun__ServerRouteList__callRoute(
                global,
                index,
                prepared.request_object,
                server_js,
                server_request_list,
                &mut prepared.js_request,
                std::ptr::from_mut(req).cast::<c_void>(),
            )
        }) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        Self::handle_request(
            server_ptr,
            &should_deinit_context,
            &prepared,
            req,
            response_value,
        );
    }

    /// # Safety
    /// `this` is the raw user-data pointer registered with `app.ws(...)` cast
    /// to `*mut Self`. Its **actual pointee type depends on `id`**: `id == 1`
    /// registers a `*mut UserRoute<SSL,DEBUG>` (mod.rs per-route ws), `id == 0`
    /// registers `*mut Self` (mod.rs `/*` fallback). The receiver is therefore
    /// kept raw and only dereferenced *after* dispatching on `id`, so no
    /// wrong-typed `&mut Self` reference is ever materialized (which would be
    /// instant UB regardless of whether it is read).
    pub(crate) unsafe fn on_web_socket_upgrade(
        this: *mut Self,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws::Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        jsc::mark_binding!();
        if id == 1 {
            // SAFETY: for `id == 1` the registered user-data IS
            // `*mut UserRoute<SSL,DEBUG>` (mod.rs `app.ws(path, ud, 1, ..)`);
            // live for the request's duration. Raw-ptr cast only — no
            // intermediate `&mut Self` was ever created; shared suffices (the
            // route entry is only read).
            let user_route = unsafe { &*this.cast::<UserRoute<SSL, DEBUG>>() };
            Self::upgrade_web_socket_user_route(user_route, resp, req, upgrade_ctx, None);
            return;
        }
        // Access `this` as *ThisServer only if id is 0
        debug_assert!(id == 0);
        let self_ptr: *mut Self = this;
        // SAFETY: for `id == 0` the registered user-data IS `*mut Self`
        // (mod.rs `app.ws("/*", self_ptr, 0, ..)`); live for the request's
        // duration. Shared — the `on_request` call below re-enters JS, so no
        // `&mut` may span it (pending-request accounting is a `Cell`).
        let this = unsafe { &*self_ptr };
        // Guards both branches below: the `on_request` fallthrough has no
        // other gate, and the node:http branch's own re-check (mod.rs:
        // `on_node_http_request_with_upgrade_ctx`) is redundant on this path
        // but load-bearing for its other caller (`on_node_http_request`).
        let Some(server_js) = this.js_value_for_dispatch() else {
            respond_stopped_503(resp);
            return;
        };
        if !this.config.on_node_http_request.is_empty() {
            // NOTE: receiver is `*mut Self` (mod.rs) — the callee re-enters
            // JS, so a long-lived `&mut self` here would alias on callback.
            Self::on_node_http_request_with_upgrade_ctx(self_ptr, req, resp, upgrade_ctx);
            return;
        }
        if this.config.on_request.is_empty() {
            // require fetch method to be set otherwise we dont know what route to call
            // this should be the fallback in case no route is provided to upgrade
            resp.write_status(b"403 Forbidden");
            resp.end_without_body(true);
            return;
        }
        let _entered = this.vm().enter_event_loop_scope_without_checkpoint();
        this.on_pending_request();
        req.set_yield(false);
        // SAFETY: `request_pool` is non-null while the server is alive; `claim()`
        // reserves a fresh slot whose `Drop` releases it on panic before init.
        let ctx_slot = unsafe { (*this.request_pool).claim() };
        let should_deinit_context = core::cell::Cell::new(false);
        <ServerRequestContext<SSL, DEBUG> as RequestCtxOps>::create_in(
            ctx_slot.addr().as_ptr(),
            self_ptr,
            req,
            RespLike::to_any_response(resp),
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            None,
        );
        // SAFETY: `create_in` fully initialized the slot via `MaybeUninit::write`.
        let ctx = unsafe { &*ctx_slot.assume_init().as_ptr() };

        // Pooled body slot, ref_count = 1.
        let body_hive = crate::webcore::body::hive_alloc(BodyValue::Null);
        // The ctx and Request each own a +1 on the same slot: see the
        // `RequestContext::request_body` doc and `Request::finalize`.
        ctx.request_body.set(Some(body_hive.clone()));

        let signal = AbortSignal::new(&this.global());
        // The
        // RequestContext owns one ref so aborts during the WS-upgrade fallback
        // fetch path propagate.
        ctx.signal.set(NonNull::new(signal));
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe deref.
        bun_opaque::opaque_deref_mut(signal).pending_activity_ref();
        // The Request's own ref.
        let signal_for_req = bun_opaque::opaque_deref_mut(signal).ref_();
        let request_object_box = Request::new(Request::init(
            ctx.method,
            AnyRequestContext::init(std::ptr::from_ref(ctx)),
            SSL,
            Some(signal_for_req),
            body_hive,
        ));
        ctx.upgrade_context
            .set(UpgradeState::Pending(NonNull::from(upgrade_ctx)));
        // Leaked so the ctx (which outlives this stack frame) can hold the
        // pointer; freed via ctx.deinit's request_weakref. Everything below
        // goes through this raw pointer rather than a `&mut Request` reborrow:
        // the weak handle and the deferred `detach_request` both alias it.
        let request_object_ptr: *mut Request = bun_core::heap::into_raw(request_object_box);
        // SAFETY: freshly leaked, so it carries the allocation's provenance.
        ctx.request_weakref
            .set(unsafe { bun_ptr::WeakPtr::<Request>::init_ref(request_object_ptr) });

        // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
        let global = this.global();
        // SAFETY: `request_object_ptr` is live; no other borrow is outstanding.
        let args = [unsafe { (*request_object_ptr).to_js(&global) }, server_js];
        args[0].ensure_still_alive();

        let response_value = match this.config.on_request.call(&global, server_js, &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };
        // Its own copy, so the closure's capture does not pin `request_object_ptr`.
        let detach_ptr = request_object_ptr;
        scopeguard::defer! {
            // uWS request will not live longer than this function
            // SAFETY: see request_object_ptr above.
            unsafe { (*detach_ptr).request_context.detach_request() };
        }

        ctx.on_response(this, args[0], response_value);

        ctx.defer_deinit_until_callback_completes.set(None);

        if should_deinit_context.get() {
            ctx.deinit();
            return;
        }

        if ctx.should_render_missing() {
            ctx.render_missing();
            return;
        }

        ctx.to_async(
            std::ptr::from_mut::<uws::Request>(req).cast::<c_void>(),
            // SAFETY: `request_object_ptr` is live (the ctx's weakref owns it)
            // and no other borrow of the Request is outstanding here.
            unsafe { &mut *request_object_ptr },
        );
    }

    // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
    pub(super) fn on_chrome_dev_tools_json_request(
        &mut self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        if cfg!(debug_assertions) {
            // NOTE: scoped_log! expands each arg twice (ANSI/no-ANSI branches);
            // copy to owned buffers so the two `&req` borrows in the expansion
            // don't overlap with the returned slice lifetimes.
            let m = req.method().to_vec();
            let u = req.url().to_vec();
            httplog!("{} - {}", BStr::new(&m), BStr::new(&u));
        }

        let authorized = 'brk: {
            let Some(dev_server) = self.dev_server.as_deref() else {
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

        // They need a 16 byte uuid. It needs to be somewhat consistent. We don't want to store this field anywhere.

        // So we first use a hash of the main field:
        let first_hash_segment: [u8; 8] = 'brk: {
            let mut buffer = paths::path_buffer_pool::get();
            let main = self.vm_ref().main();
            let len = main.len().min(buffer.len());
            break 'brk hash(strings::copy_lowercase(&main[..len], &mut buffer[..len]))
                .to_ne_bytes();
        };

        // And then we use a hash of their project root directory:
        let second_hash_segment: [u8; 8] = 'brk: {
            let mut buffer = paths::path_buffer_pool::get();
            let root = &self.dev_server.as_ref().unwrap().root;
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
            bun_fmt::format_json_string_utf8(
                &self.dev_server.as_ref().unwrap().root,
                Default::default()
            ),
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
        let callback = self.on_clienterror;
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
            // SAFETY: event_loop() returns a live raw pointer tied to the global.
            let _scope =
                unsafe { jsc::event_loop::EventLoop::enter_scope(global.bun_vm().event_loop()) };
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
        let callback = self.on_connection;
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
        // SAFETY: event_loop() returns a live raw pointer tied to the global.
        let _scope =
            unsafe { jsc::event_loop::EventLoop::enter_scope(global.bun_vm().event_loop()) };
        callback.call(&global, JSValue::UNDEFINED, &[node_socket])?;
        Ok(())
    }

    // `js_gc_route_list_set` / `ptr_to_js` live on the unbounded
    // `impl NewServer` in mod.rs; do not redefine them here.
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
fn server_set_on_client_error(
    global: &JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JsResult<JSValue> {
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

    macro_rules! handle {
        ($T:ty) => {
            if let Some(this_ptr) = server.as_::<$T>() {
                // SAFETY: as_ returned a non-null *mut to a live server; nothing
                // here re-enters through it, so each scoped access is exclusive.
                if let Some(app) = unsafe { (*this_ptr).app } {
                    // SAFETY: see above — `&mut` scoped to this statement.
                    unsafe {
                        (*this_ptr).on_clienterror = callback;
                        super::wrap_handler_slot(
                            &mut (*this_ptr).on_clienterror,
                            server,
                            global,
                            <$T>::js_gc_on_client_error_set,
                        );
                    }
                    // uws_sys::App::on_client_error takes the raw C-ABI handler shape;
                    // wrap our typed callback in an extern "C" thunk that slices raw_packet.
                    extern "C" fn thunk(
                        user_data: *mut c_void,
                        _ssl: c_int,
                        socket: *mut uws_sys::us_socket_t,
                        error_code: u8,
                        raw_packet: *mut u8,
                        raw_packet_len: c_int,
                    ) {
                        // SAFETY: user_data is the `*mut Self` registered below; socket is a live
                        // uWS socket; raw_packet/raw_packet_len describe a valid (possibly empty)
                        // buffer. Shared — the callback re-enters JS.
                        let this = unsafe { &*user_data.cast::<$T>() };
                        let packet: &[u8] = if raw_packet_len > 0 {
                            // SAFETY: uWS guarantees `raw_packet` points to `raw_packet_len`
                            // readable bytes when `raw_packet_len > 0`.
                            unsafe { bun_core::ffi::slice(raw_packet, raw_packet_len as usize) }
                        } else {
                            &[]
                        };
                        // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                        crate::dispatch::fold(this.on_client_error_callback(
                            bun_opaque::opaque_deref_mut(socket),
                            error_code,
                            packet,
                        ));
                    }
                    // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(app)
                        .on_client_error(thunk, this_ptr.cast::<c_void>());
                }
                return Ok(JSValue::UNDEFINED);
            }
        };
    }
    handle!(HTTPServer);
    handle!(HTTPSServer);
    handle!(DebugHTTPServer);
    handle!(DebugHTTPSServer);
    debug_assert!(false);
    Ok(JSValue::UNDEFINED)
}

fn server_set_on_connection(
    global: &JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JsResult<JSValue> {
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

    macro_rules! handle {
        ($T:ty) => {
            if let Some(this_ptr) = server.as_::<$T>() {
                // SAFETY: as_ returned a non-null *mut to a live server; nothing
                // here re-enters through it, so each scoped access is exclusive.
                if let Some(app) = unsafe { (*this_ptr).app } {
                    // SAFETY: see above — `&mut` scoped to this statement.
                    unsafe {
                        (*this_ptr).on_connection = callback;
                        super::wrap_handler_slot(
                            &mut (*this_ptr).on_connection,
                            server,
                            global,
                            <$T>::js_gc_on_connection_set,
                        );
                    }
                    // uws filters fire with `1` when an HTTP connection is opened
                    // (for TLS, when its handshake completes) and `-1` on close;
                    // only the open notification is forwarded to JS.
                    extern "C" fn thunk(
                        socket: *mut uws_sys::us_socket_t,
                        opened: i32,
                        user_data: *mut c_void,
                    ) {
                        if opened != 1 {
                            return;
                        }
                        // SAFETY: user_data is the `*mut Self` registered below;
                        // socket is a live uWS socket for this server's group.
                        // Shared — the callback re-enters JS.
                        let this = unsafe { &*user_data.cast::<$T>() };
                        crate::dispatch::fold(this.on_connection_callback(socket.cast::<c_void>()));
                    }
                    // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(app).filter(thunk, this_ptr.cast::<c_void>());
                }
                return Ok(JSValue::UNDEFINED);
            }
        };
    }
    handle!(HTTPServer);
    handle!(HTTPSServer);
    handle!(DebugHTTPServer);
    handle!(DebugHTTPSServer);
    debug_assert!(false);
    Ok(JSValue::UNDEFINED)
}

fn server_set_app_flags(
    global: &JSGlobalObject,
    server: JSValue,
    require_host_header: bool,
    use_strict_method_validation: bool,
    lenient_http_flags: u8,
    http_allow_half_open: bool,
) -> JsResult<JSValue> {
    if !server.is_object() {
        return Err(global.throw(format_args!(
            "Failed to set requireHostHeader: The 'this' value is not a Server."
        )));
    }

    if let Some(this) = server.as_::<HTTPServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_flags(
            require_host_header,
            use_strict_method_validation,
            lenient_http_flags,
            http_allow_half_open,
        );
    } else if let Some(this) = server.as_::<HTTPSServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_flags(
            require_host_header,
            use_strict_method_validation,
            lenient_http_flags,
            http_allow_half_open,
        );
    } else if let Some(this) = server.as_::<DebugHTTPServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_flags(
            require_host_header,
            use_strict_method_validation,
            lenient_http_flags,
            http_allow_half_open,
        );
    } else if let Some(this) = server.as_::<DebugHTTPSServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_flags(
            require_host_header,
            use_strict_method_validation,
            lenient_http_flags,
            http_allow_half_open,
        );
    } else {
        return Err(global.throw(format_args!(
            "Failed to set timeout: The 'this' value is not a Server."
        )));
    }
    Ok(JSValue::UNDEFINED)
}

fn server_set_max_http_header_size(
    global: &JSGlobalObject,
    server: JSValue,
    max_header_size: u64,
) -> JsResult<JSValue> {
    if !server.is_object() {
        return Err(global.throw(format_args!(
            "Failed to set maxHeaderSize: The 'this' value is not a Server."
        )));
    }

    if let Some(this) = server.as_::<HTTPServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_max_http_header_size(max_header_size);
    } else if let Some(this) = server.as_::<HTTPSServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_max_http_header_size(max_header_size);
    } else if let Some(this) = server.as_::<DebugHTTPServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_max_http_header_size(max_header_size);
    } else if let Some(this) = server.as_::<DebugHTTPSServer>() {
        // SAFETY: `as_` returned a non-null `*mut` to a live JS-wrapped server.
        unsafe { &mut *this }.set_max_http_header_size(max_header_size);
    } else {
        return Err(global.throw(format_args!(
            "Failed to set maxHeaderSize: The 'this' value is not a Server."
        )));
    }
    Ok(JSValue::UNDEFINED)
}

// `host_fn.wrap{3,4}` C-ABI shims: each forwards through `to_js_host_call`
// (= `host_fn::to_js_host_fn_result`) so a `JsError` becomes `.zero` with the
// exception left on the global. Signatures match the C++ callers in
// `node:http`/`node:https` (`bindings/NodeHTTP.cpp`).
//
// NOTE: these are plain `extern "C"` (NOT `#[bun_jsc::host_call]` / sysv64).
// The C++ declarations in
// NodeHTTP.cpp are bare `extern "C"` with no `SYSV_ABI`, so on Windows the
// caller uses Win64 ABI. Using `host_call` here forced sysv64 on the Rust
// side, scrambling the `server` argument and tripping the `is_object()` guard.
#[unsafe(export_name = "Server__setAppFlags")]
extern "C" fn server_set_app_flags_shim(
    global: &JSGlobalObject,
    server: JSValue,
    require_host_header: bool,
    use_strict_method_validation: bool,
    lenient_http_flags: u8,
    http_allow_half_open: bool,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        server_set_app_flags(
            global,
            server,
            require_host_header,
            use_strict_method_validation,
            lenient_http_flags,
            http_allow_half_open,
        ),
    )
}

#[unsafe(export_name = "Server__setOnClientError")]
extern "C" fn server_set_on_client_error_shim(
    global: &JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JSValue {
    host_fn::to_js_host_fn_result(global, server_set_on_client_error(global, server, callback))
}

#[unsafe(export_name = "Server__setOnConnection")]
extern "C" fn server_set_on_connection_shim(
    global: &JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JSValue {
    host_fn::to_js_host_fn_result(global, server_set_on_connection(global, server, callback))
}

#[unsafe(export_name = "Server__setMaxHTTPHeaderSize")]
extern "C" fn server_set_max_http_header_size_shim(
    global: &JSGlobalObject,
    server: JSValue,
    max_header_size: u64,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        server_set_max_http_header_size(global, server, max_header_size),
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
