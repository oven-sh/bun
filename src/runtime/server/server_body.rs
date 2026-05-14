//! Port of src/runtime/server/server.zig

use bun_collections::VecExt;
use core::ffi::{c_char, c_int, c_void};
use core::mem;
use core::ptr::NonNull;
use std::io::Write as _;

use crate::api::js_bundler::PluginJscExt as _;
use crate::api::{SocketAddress, js_bundler as JSBundler};
use crate::bake::dev_server::{self as dev_server_mod, DevServer};
use crate::bake::framework_router as FrameworkRouter;
use crate::bake::{self as bake};
use crate::node::types::PathLikeExt as _;
use crate::webcore::BlobExt;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::fetch as Fetch;
use crate::webcore::response::HeadersRef;
use crate::webcore::{
    self as WebCore, AbortSignal, AnyBlob, Blob, Body, FetchHeaders, Request, Response,
};
use ::bstr::BStr;
use bun_alloc::AllocError;
use bun_boringssl as boringssl;
use bun_collections::HashMap;
use bun_core::{self as core_, Global, Output, analytics, fmt as bun_fmt};
use bun_core::{self as bstr, String as BunString, ZStr, ZigString, strings};
use bun_http::{self as http, Method, MimeType};
use bun_http_jsc::method_jsc::MethodJsc as _;
use bun_io::{KeepAlive, Loop as AsyncLoop};
use bun_jsc::Debugger::{AsyncTaskTracker, DebuggerId};
use bun_jsc::uuid::UUID;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, GlobalRef, JSGlobalObject, JSPromise, JSValue, JsError,
    JsRef, JsResult, Node, StringJsc as _, Strong, StrongOptional, SysErrorJsc as _, SystemError,
    VirtualMachine, host_fn,
};
use bun_jsc::{StringJsc as _, ZigStringJsc as _};
use bun_paths as paths;
use bun_ptr::{IntrusiveRc, RefPtr};
use bun_resolver::fs::FileSystem;
use bun_standalone_graph::StandaloneModuleGraph;
use bun_sys as sys;
use bun_url::URL;
use bun_uws::{
    self as uws, AnyResponse, AnyWebSocket, Opcode, ResponseKind, WebSocketUpgradeContext,
};
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

use bun_boringssl_sys::{ERR_func_error_string, ERR_lib_error_string, ERR_reason_error_string};
use bun_jsc::bun_string_jsc;
use bun_jsc::http_server_agent::{self, InspectorHTTPServerAgent};

// ─── Re-exports ──────────────────────────────────────────────────────────────
pub use super::html_bundle::{self as html_bundle, HTMLBundle};
pub use super::http_status_text as HTTPStatusText;
pub use super::web_socket_server_context::WebSocketServerContext;
// TODO: rename to StaticBlobRoute? the html bundle is sometimes a static route
pub use super::any_request_context::AnyRequestContext;
pub use super::file_response_stream::FileResponseStream;
pub use super::file_route::FileRoute;
pub use super::node_http_response::NodeHTTPResponse;
pub use super::range_request as RangeRequest;
pub use super::request_context::{DeferDeinitFlag, RequestContext as NewRequestContext};
pub use super::server_config::{self as server_config, ServerConfig};
pub use super::server_web_socket::ServerWebSocket;
pub use super::static_route::StaticRoute;

// ─── RequestCtx trait ────────────────────────────────────────────────────────
// PORT NOTE: Zig's `NewRequestContext` exposes `Req`/`Resp`/`http3` as comptime
// associated decls on the generated type. Stable Rust has no inherent
// associated types, so the per-monomorphization handle types are surfaced via
// this local trait. Only `IS_H3` is consumed for control flow; `Req`/`Resp`
// are erased to `c_void` to match `super::request_context::{Req, Resp}`.
pub trait RequestCtx: super::any_request_context::CtxKind {
    type Req: ReqLike;
    type Resp: RespLike;
    const IS_H3: bool;
}
impl<ThisServer, const SSL: bool, const DBG: bool> RequestCtx
    for NewRequestContext<ThisServer, SSL, DBG, false>
where
    NewRequestContext<ThisServer, SSL, DBG, false>: super::any_request_context::CtxKind,
{
    type Req = uws_sys::Request;
    type Resp = uws_sys::NewAppResponse<SSL>;
    const IS_H3: bool = false;
}
impl<ThisServer, const SSL: bool, const DBG: bool> RequestCtx
    for NewRequestContext<ThisServer, SSL, DBG, true>
where
    NewRequestContext<ThisServer, SSL, DBG, true>: super::any_request_context::CtxKind,
{
    type Req = uws_sys::h3::Request;
    type Resp = uws_sys::h3::Response;
    const IS_H3: bool = true;
}

/// Field/method surface needed on the generic `Ctx` so the bodies of
/// `handle_request_for` / `prepare_js_request_context_for` / `on_saved_request`
/// can be written without naming the concrete `RequestContext<_, SSL, DBG, H3>`
/// type. Implemented via blanket impl below for every `NewRequestContext<..>`.
#[allow(clippy::too_many_arguments)]
pub trait RequestCtxOps: RequestCtx {
    type Server;
    fn create_in(
        slot: *mut Self,
        server: *const Self::Server,
        req: &mut Self::Req,
        resp: &mut Self::Resp,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<http::Method>,
    );
    fn on_response(
        &mut self,
        server: &Self::Server,
        request_value: JSValue,
        response_value: JSValue,
    );
    fn deinit(&mut self);
    fn should_render_missing(&self) -> bool;
    fn render_missing(&mut self);
    fn to_async(&mut self, req: &mut Self::Req, request_object: &mut Request);
    fn ctx_method(&self) -> http::Method;
    fn set_upgrade_context(&mut self, ctx: Option<*mut WebSocketUpgradeContext>);
    fn defer_deinit_ptr(&mut self) -> &mut Option<DeferDeinitFlag>;
    fn set_request_body(&mut self, body: Option<NonNull<BodyValue>>);
    fn request_body_mut(&mut self) -> Option<&mut BodyValue>;
    fn set_signal(&mut self, sig: *mut AbortSignal);
    fn set_request_weakref(&mut self, req: *mut Request);
    fn clear_req(&mut self);
    fn set_is_web_browser_navigation(&mut self, v: bool);
    fn set_request_body_content_len(&mut self, len: usize);
    fn set_is_transfer_encoding(&mut self, v: bool);
    fn set_is_waiting_for_request_body(&mut self, v: bool);
    fn arm_on_data(&mut self, resp: &mut Self::Resp);
    // body-streaming callback hooks (type-erased, stored on `Body::PendingValue`)
    fn on_start_buffering_callback(this: *mut c_void);
    fn on_start_streaming_request_body_callback(this: *mut c_void) -> WebCore::DrainResult;
    fn on_request_body_readable_stream_available(
        this: *mut c_void,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    );
}

impl<ThisServer, const SSL: bool, const DBG: bool, const H3: bool> RequestCtxOps
    for NewRequestContext<ThisServer, SSL, DBG, H3>
where
    Self: RequestCtx,
    ThisServer: super::ServerLike + 'static,
{
    type Server = ThisServer;
    #[inline]
    fn create_in(
        slot: *mut Self,
        server: *const ThisServer,
        req: &mut Self::Req,
        resp: &mut Self::Resp,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<http::Method>,
    ) {
        // SAFETY: `slot` points at a fresh HiveArray pool entry; treat as
        // MaybeUninit for in-place construction.
        let slot = unsafe { &mut *slot.cast::<core::mem::MaybeUninit<Self>>() };
        let any_resp = RespLike::to_any_response(resp);
        Self::create(
            slot,
            server,
            std::ptr::from_mut(req).cast(),
            any_resp,
            should_deinit_context,
            method,
        );
    }
    #[inline]
    fn on_response(&mut self, server: &ThisServer, rq: JSValue, rv: JSValue) {
        Self::on_response(self, server, rq, rv)
    }
    #[inline]
    fn deinit(&mut self) {
        Self::deinit(self)
    }
    #[inline]
    fn should_render_missing(&self) -> bool {
        Self::should_render_missing(self)
    }
    #[inline]
    fn render_missing(&mut self) {
        Self::render_missing(self)
    }
    #[inline]
    fn to_async(&mut self, req: &mut Self::Req, ro: &mut Request) {
        Self::to_async(self, std::ptr::from_mut(req).cast(), ro)
    }
    #[inline]
    fn ctx_method(&self) -> http::Method {
        self.method
    }
    #[inline]
    fn set_upgrade_context(&mut self, c: Option<*mut WebSocketUpgradeContext>) {
        self.upgrade_context = c
    }
    #[inline]
    fn defer_deinit_ptr(&mut self) -> &mut Option<DeferDeinitFlag> {
        &mut self.defer_deinit_until_callback_completes
    }
    #[inline]
    fn set_request_body(&mut self, body: Option<NonNull<BodyValue>>) {
        self.request_body = body
    }
    #[inline]
    fn request_body_mut(&mut self) -> Option<&mut BodyValue> {
        // SAFETY: request_body points at a live HiveRef<Value> slot owned by the
        // VM's hive allocator while the RequestContext holds a ref.
        self.request_body.map(|p| unsafe { &mut *p.as_ptr() })
    }
    #[inline]
    fn set_signal(&mut self, sig: *mut AbortSignal) {
        // `AbortSignal::new` returns a raw +1 ref to a C++-refcounted opaque;
        // `RequestContext.signal` stores it as `Option<NonNull<AbortSignal>>`
        // and pairs the unref in RequestContext cleanup (`shim::signal_release`,
        // which drops both the pending-activity count and the intrusive ref).
        self.signal = NonNull::new(sig);
    }
    #[inline]
    fn set_request_weakref(&mut self, req: *mut Request) {
        // SAFETY: req is a freshly-boxed Request; live for the request duration.
        self.request_weakref = bun_ptr::WeakPtr::<Request>::init_ref(unsafe { &mut *req });
    }
    #[inline]
    fn clear_req(&mut self) {
        self.req = None
    }
    #[inline]
    fn set_is_web_browser_navigation(&mut self, v: bool) {
        self.flags.set_is_web_browser_navigation(v)
    }
    #[inline]
    fn set_request_body_content_len(&mut self, len: usize) {
        self.request_body_content_len = len
    }
    #[inline]
    fn set_is_transfer_encoding(&mut self, v: bool) {
        self.flags.set_is_transfer_encoding(v)
    }
    #[inline]
    fn set_is_waiting_for_request_body(&mut self, v: bool) {
        self.flags.set_is_waiting_for_request_body(v)
    }
    #[inline]
    fn arm_on_data(&mut self, resp: &mut Self::Resp) {
        // PORT NOTE: route via the type-erased `AnyResponse::on_data` so the
        // body stays generic over `Ctx::Resp` (H1 SSL/TCP/H3).
        fn handler<S, const SSL_: bool, const DBG_: bool, const H3_: bool>(
            ctx: *mut NewRequestContext<S, SSL_, DBG_, H3_>,
            chunk: &[u8],
            last: bool,
        ) where
            S: super::ServerLike + 'static,
        {
            NewRequestContext::<S, SSL_, DBG_, H3_>::on_buffered_body_chunk(ctx, chunk, last);
        }
        RespLike::to_any_response(resp).on_data(
            handler::<ThisServer, SSL, DBG, H3>,
            std::ptr::from_mut::<Self>(self),
        );
    }
    #[inline]
    fn on_start_buffering_callback(this: *mut c_void) {
        Self::on_start_buffering_callback(this)
    }
    #[inline]
    fn on_start_streaming_request_body_callback(this: *mut c_void) -> WebCore::DrainResult {
        Self::on_start_streaming_request_body_callback(this)
    }
    #[inline]
    fn on_request_body_readable_stream_available(
        this: *mut c_void,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    ) {
        Self::on_request_body_readable_stream_available(this, global_this, readable)
    }
}

// PORT NOTE: local request/response trait so generic `Ctx::Req` / `Ctx::Resp`
// call sites can dispatch to either uWS HTTP/1 or HTTP/3 handle types without
// touching `bun_uws_sys`. Only the surface `prepare_js_request_context_for`
// actually needs is exposed.
pub trait ReqLike {
    fn header(&mut self, name: &[u8]) -> Option<&[u8]>;
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

pub trait RespLike {
    fn write_status(&mut self, status: &[u8]);
    fn end_without_body(&mut self, close_connection: bool);
    fn timeout(&mut self, seconds: u8);
    fn on_timeout_warn(&mut self, ud: *mut c_void);
    fn to_any_response(&mut self) -> uws::AnyResponse;
}
impl<const SSL: bool> RespLike for uws_sys::NewAppResponse<SSL> {
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

// Module-level type aliases replacing the unstable inherent associated types
// (`pub type App = …` inside `impl NewServer`).
pub type ServerApp<const SSL: bool> = uws::NewApp<SSL>;

// PORT NOTE: `bun_http` re-exports only the `Method` enum, not the sibling
// `Set` type alias from `bun_http_types::Method`. Surface it locally so the
// route-coverage bitset matches the Zig `HTTP.Method.Set` spelling.
pub(crate) type MethodSet = bun_http_types::Method::Set;

// ─── AppRouteExt ────────────────────────────────────────────────────────────
// Local typed shim over `uws_sys::NewApp::{get,head,any,method}` whose
// upstream signatures take a raw `extern "C" fn(*mut uws_res, *mut Request,
// *mut c_void)` + opaque user-data. Zig generated a per-(ctx,handler)
// trampoline at comptime; we recover that here by monomorphising on the
// ZST fn-item type `H` so the user-data slot carries only the context.
pub(crate) trait AppRouteExt<const SSL: bool> {
    fn get_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static;
    fn head_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static;
    fn any_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static;
    fn method_ctx<T, H>(&mut self, m: http::Method, pattern: &[u8], ctx: *mut T, h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static;
}

#[inline]
extern "C" fn _route_tramp<T, H, const SSL: bool>(
    res: *mut uws_sys::uws_res,
    req: *mut uws_sys::Request,
    ud: *mut c_void,
) where
    H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
{
    use bun_uws_sys::thunk;
    // SAFETY: uWS route callback contract — `ud`/`req`/`res` were registered by
    // the matching `*_ctx` call below and are live disjoint pointers for the
    // duration of the call; `H` is a ZST fn item (compile-asserted in
    // `thunk::zst`). Consolidates the open-coded `&mut *cast` derefs into the
    // audited `thunk::*` primitives so the invariant is documented once (S005).
    unsafe {
        let Some(ctx) = thunk::user_mut::<T>(ud) else {
            return;
        };
        thunk::zst::<H>()(
            ctx,
            thunk::handle_mut(req.cast::<uws::Request>()),
            thunk::handle_mut(res.cast::<uws_sys::NewAppResponse<SSL>>()),
        );
    }
}

impl<const SSL: bool> AppRouteExt<SSL> for uws_sys::NewApp<SSL> {
    fn get_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.get(
            pattern,
            Some(_route_tramp::<T, H, SSL>),
            ctx.cast::<c_void>(),
        );
    }
    fn head_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.head(
            pattern,
            Some(_route_tramp::<T, H, SSL>),
            ctx.cast::<c_void>(),
        );
    }
    fn any_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.any(
            pattern,
            Some(_route_tramp::<T, H, SSL>),
            ctx.cast::<c_void>(),
        );
    }
    fn method_ctx<T, H>(&mut self, m: http::Method, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.method(
            m,
            pattern,
            Some(_route_tramp::<T, H, SSL>),
            ctx.cast::<c_void>(),
        );
    }
}

pub type ServerRequestContext<const SSL: bool, const DEBUG: bool> =
    NewRequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, false>;
pub type ServerH3RequestContext<const SSL: bool, const DEBUG: bool> =
    NewRequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, true>;
pub type ServerPreparedRequest<'a, const SSL: bool, const DEBUG: bool> =
    PreparedRequestFor<'a, ServerRequestContext<SSL, DEBUG>>;

// ─── BunInfo (moved from bun_core::Global) ───────────────────────────────────
// Spec: src/bun_core/Global.zig:195-210. `generate()` builds the struct and
// hands it to `JSON.toAST`, which reflects over fields at comptime. Rust has no
// `@typeInfo`, so this is the hand-expanded reflection output (cf.
// `bun_parsers::json::ToAst` derive sketch, json.rs:808-824): an `E.Object`
// with `bun_version` (string) + `platform` (nested `E.Object` of `os`/`arch`/
// `version`, enums emitted as `@tagName` strings).
pub mod BunInfo {
    use bun_analytics::generate_header::generate_platform;
    use bun_analytics::schema::analytics::{Architecture, OperatingSystem, Platform};
    use bun_ast::Loc;
    use bun_ast::e::EString;
    use bun_ast::{E, Expr, G};
    use bun_core::Global;

    pub struct BunInfo {
        pub bun_version: &'static [u8],
        pub platform: Platform,
    }

    fn os_tag_name(os: OperatingSystem) -> &'static [u8] {
        match os {
            OperatingSystem::_none => b"_none",
            OperatingSystem::linux => b"linux",
            OperatingSystem::macos => b"macos",
            OperatingSystem::windows => b"windows",
            OperatingSystem::wsl => b"wsl",
            OperatingSystem::android => b"android",
            OperatingSystem::freebsd => b"freebsd",
        }
    }

    fn arch_tag_name(arch: Architecture) -> &'static [u8] {
        match arch {
            Architecture::_none => b"_none",
            Architecture::x64 => b"x64",
            Architecture::arm => b"arm",
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

    /// Zig: `pub fn generate(comptime Bundler: type, _: Bundler, allocator) !JSAst.Expr`.
    /// `Bundler` is an unused comptime witness; `allocator` maps onto the
    /// global expr `Store` used by `Expr::init`.
    pub fn generate<B>(_transpiler: B) -> Result<Expr, bun_core::Error> {
        let info = BunInfo {
            bun_version: Global::package_json_version.as_bytes(),
            platform: generate_platform::for_os(),
        };

        // `JSON.toAST(allocator, BunInfo, info)` — hand-expanded:
        let platform_props = bun_alloc::AstAlloc::vec_from_iter([
            prop(b"os", str_expr(os_tag_name(info.platform.os))),
            prop(b"arch", str_expr(arch_tag_name(info.platform.arch))),
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

pub use super::write_status;

// ─── AnyRoute ────────────────────────────────────────────────────────────────
// PORT NOTE: enum + `memory_cost`/`set_server`/`ref_`/`deref_` live in
// `super` (mod.rs). The `impl` block below adds the JS-facing constructors
// (`from_js`/`from_options`/…) on the same type — same crate, split by file.
pub use super::AnyRoute;

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
        let mut path_string = BunString::from_js(path_js, init_ctx.global)?;
        let mut path = Node::PathOrFileDescriptor::Path(Node::PathLike::from_bun_string(
            init_ctx.global,
            &mut path_string,
            false,
        )?);
        // PORT NOTE: Zig `defer path_string.deref()`. `from_bun_string` clones
        // the bytes (or bumps the WTF ref) into the PathLike payload, so we can
        // release the source ref immediately — `bun_core::String` has no `Drop`.
        path_string.deref();
        // path is dropped at scope end

        // Construct the route by stripping paths above the root.
        //
        //    "./index-abc.js" -> "/index-abc.js"
        //    "../index-abc.js" -> "/index-abc.js"
        //    "/index-abc.js" -> "/index-abc.js"
        //    "index-abc.js" -> "/index-abc.js"
        //
        let path_slice = path.path().slice();
        let cwd: &[u8] = if StandaloneModuleGraph::is_bun_standalone_file_path(path_slice) {
            // Zig: targetBasePublicPath(Environment.os, "root/") — comptime concat,
            // exposed as a const on the Rust side.
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
        if init_ctx.global.has_exception() {
            return Err(JsError::Thrown);
        }

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
    ///
    /// See ./src/bundler/HTMLImportManifest.zig
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
        // `ZigStringSlice` impls `Drop` — freed at scope end.

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

    pub fn from_options(
        global: &JSGlobalObject,
        headers: Option<&FetchHeaders>,
        path: &mut Node::PathOrFileDescriptor,
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
                    // PORT NOTE: `sys::exists_at_type` takes `&ZStr`; the store
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

            return Ok(AnyRoute::File(
                NonNull::new(FileRoute::init_from_blob(
                    blob,
                    super::file_route::InitOptions {
                        server: None,
                        status_code: 200,
                        headers,
                    },
                ))
                .expect("FileRoute::init_from_blob returns a fresh heap allocation"),
            ));
        }

        Ok(AnyRoute::Static(
            NonNull::new(StaticRoute::init_from_any_blob(
                AnyBlob::Blob(blob),
                super::static_route::InitFromBytesOptions {
                    server: None,
                    headers,
                    ..Default::default()
                },
            ))
            .expect("StaticRoute::init_from_any_blob returns a fresh heap allocation"),
        ))
    }

    pub fn html_route_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        use bun_collections::zig_hash_map::MapEntry as StdEntry;
        if let Some(html_bundle) = <HTMLBundle as bun_jsc::JsClass>::from_js(argument) {
            let entry = init_ctx
                .dedupe_html_bundle_map
                .entry(html_bundle.cast_const());
            // PERF(port): was bun.handleOom — Rust HashMap aborts on OOM
            return Ok(Some(match entry {
                StdEntry::Vacant(v) => {
                    // Zig stores the rc=1 `Route::init(..)` in the map and
                    // returns that same value to the caller (the map slot is a
                    // non-owning borrow, freed by `dedupe_html_bundle_map.deinit`
                    // *without* deref). `RefPtr<T>` has no `Drop`, so a bit-copy
                    // here keeps the net refcount at 1 — bumping for the map
                    // slot would leak +1 per first-seen HTMLBundle.
                    let route = html_bundle::Route::init(html_bundle);
                    // SAFETY: `route.data` is the just-allocated NonNull (rc=1);
                    // wrap without bumping so the map slot stays non-owning
                    // (`RefPtr<T>` has no `Drop`; this is the bit-copy Zig did).
                    let borrowed = unsafe { RefPtr::from_raw(route.as_ptr()) };
                    v.insert(borrowed);
                    AnyRoute::Html(route)
                }
                StdEntry::Occupied(o) => AnyRoute::Html(o.get().dupe_ref()),
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

                let style: FrameworkRouter::Style =
                    if let Some(style_js) = argument.get(global, b"style")? {
                        FrameworkRouter::Style::from_js(style_js, global)?
                    } else {
                        FrameworkRouter::Style::NextjsPages
                    };
                // errdefer style.deinit() — Style impls Drop; `?` drops it on the error path

                if !strings::ends_with(path, b"/*") {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "To mount a directory, make sure the path ends in `/*`"
                    )));
                }

                // trim the /*
                // PORT NOTE: `FileSystemRouterType` fields are `Cow<'static,[u8]>`.
                // Zig stored a borrow into the route key (arena-backed). Rather
                // than erasing the lifetime through a raw-pointer round-trip
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
            return Ok(Some(AnyRoute::File(
                NonNull::new(file_route)
                    .expect("FileRoute::from_js returns a fresh heap allocation"),
            )));
        }
        match StaticRoute::from_js(global, argument)? {
            Some(s) => Ok(Some(AnyRoute::Static(
                NonNull::new(s).expect("StaticRoute::from_js returns a fresh heap allocation"),
            ))),
            None => Ok(None),
        }
    }
}

pub struct ServerInitContext<'a> {
    // TODO(port): arena removed in non-AST crate; if needed for bulk-free, reintroduce bumpalo
    pub dedupe_html_bundle_map: HashMap<*const HTMLBundle, RefPtr<html_bundle::Route>>,
    pub js_string_allocations: bake::StringRefList,
    pub global: &'a JSGlobalObject,
    pub framework_router_list: Vec<bake::FileSystemRouterType>,
    pub user_routes: &'a mut Vec<server_config::StaticRouteEntry>,
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
/// State machine to handle loading plugins asynchronously. This structure is not thread-safe.
pub struct ServePlugins {
    state: ServePluginsState,
    ref_count: core::cell::Cell<u32>,
}

// TODO(port): Reference count is incremented while there are other objects waiting on plugin loads.
// Maps to bun_ptr::IntrusiveRc<ServePlugins> — *ServePlugins crosses FFI as promise context ptr.

pub enum ServePluginsState {
    Unqueued(Box<[Box<[u8]>]>),
    Pending {
        /// Promise may be empty if the plugin load finishes synchronously.
        plugin: Box<JSBundler::Plugin>,
        promise: jsc::JSPromiseStrong,
        html_bundle_routes: Vec<*mut html_bundle::Route>,
        // TODO(port): LIFETIMES.tsv classifies this BORROW_PARAM → Option<&'a DevServer>;
        // threading <'a> through ServePluginsState/ServePlugins deferred to Phase B.
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

pub enum ServePluginsCallback<'a> {
    /// Raw `*mut` because the route is stored in
    /// `ServePluginsState::Pending.html_bundle_routes` and later resolved via
    /// `on_plugins_resolved`/`on_plugins_rejected`. R-2: those now take `&self`
    /// (mutation goes through `Cell`/`JsCell`), so the `*mut` spelling is
    /// signature-only; callers pass `Route::as_ctx_ptr(&self)`.
    HtmlBundleRoute(*mut html_bundle::Route),
    DevServer(&'a DevServer),
}

impl ServePlugins {
    pub fn init(plugins: Box<[Box<[u8]>]>) -> *mut ServePlugins {
        bun_core::heap::into_raw(Box::new(ServePlugins {
            ref_count: core::cell::Cell::new(1),
            state: ServePluginsState::Unqueued(plugins),
        }))
    }

    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// Bump the refcount and return an RAII guard that derefs on `Drop`.
    ///
    /// # Safety
    /// `this` must originate from [`ServePlugins::init`] (carry `heap::alloc`
    /// write provenance) so the eventual `deref_` can free it. Do **not** derive
    /// `this` from a `&Self`/`&mut Self` reborrow — under Stacked Borrows that
    /// pointer is invalidated by later writes through the reference and cannot
    /// be used to deallocate.
    #[inline]
    unsafe fn guard_ref(this: *mut Self) -> ServePluginsRef {
        // SAFETY: caller contract — `this` is live.
        unsafe { (*this).ref_() };
        ServePluginsRef(this)
    }

    /// Decrement the intrusive refcount, freeing the allocation when it hits zero.
    ///
    /// Takes the raw `*mut` (not `&self`) so the original `heap::alloc` provenance
    /// from [`ServePlugins::init`] is preserved for the final `heap::take` — going
    /// through `&self` would narrow provenance to read-only and make the drop UB.
    ///
    /// SAFETY: `this` must originate from [`ServePlugins::init`] and the caller must
    /// hold a counted reference.
    pub unsafe fn deref_(this: *mut Self) {
        // SAFETY: caller contract — `this` is live while refcount > 0
        let rc = unsafe { &(*this).ref_count };
        let n = rc.get() - 1;
        rc.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; `this` carries the heap::alloc provenance from init()
            unsafe { drop(bun_core::heap::take(this)) };
        }
    }

    pub fn get_or_start_load(
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
                            // SAFETY: caller passed a live `&mut Route` coerced to `*mut`; we
                            // bump its intrusive refcount before storing so it outlives the
                            // pending state. Write provenance is preserved for the later
                            // `&mut *route` in handle_on_resolve/handle_on_reject.
                            unsafe { bun_ptr::RefCount::<html_bundle::Route>::ref_(route) };
                            html_bundle_routes.push(route);
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
        // PORT NOTE: split out of the loop so the `Loaded` arm's borrow of
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
        // PORT NOTE: reshaped for borrowck — clone the slice refs so we can mutate self.state below
        let plugin_list: Vec<_> = plugin_list.iter().collect();
        let bunfig_path: &[u8] = &global.bun_vm().transpiler.options.bunfig_path;
        let bunfig_folder: &[u8] = bun_paths::resolve_path::dirname::<
            bun_paths::resolve_path::platform::Auto,
        >(bunfig_path);

        // NOTE: the keep-alive ref/deref pair (Zig: `this.ref(); defer this.deref()`)
        // lives in the caller (`get_or_load_plugins`), which holds the heap-allocated
        // `*mut ServePlugins` directly. Deriving the guard's pointer from `&mut self`
        // here would give it a tag that is invalidated by the writes to `self.state`
        // below (Stacked Borrows), making the eventual `heap::take` in `deref_` UB.

        let plugin = JSBundler::Plugin::create(global, bun_jsc::BunPluginTarget::Browser);
        // SAFETY: `Plugin::create` returns a freshly-boxed `*mut Plugin` (single owner).
        let plugin: Box<JSBundler::Plugin> = unsafe { bun_core::heap::take(plugin) };
        // PERF(port): was stack-fallback alloc
        let mut bunstring_array: Vec<BunString> = Vec::with_capacity(plugin_list.len());
        for raw_plugin in &plugin_list {
            bunstring_array.push(BunString::init(&***raw_plugin));
        }
        let plugin_js_array = bun_string_jsc::to_js_array(global, &bunstring_array)?;
        let bunfig_folder_bunstr = jsc::bun_string_jsc::create_utf8_for_js(global, bunfig_folder)?;

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

    pub fn handle_on_resolve(&mut self) {
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
        drop(promise); // Zig: promise.deinit() — Drop on JscStrong releases the slot.

        self.state = ServePluginsState::Loaded(plugin);
        let plugin_ref = match &self.state {
            ServePluginsState::Loaded(p) => &**p,
            _ => unreachable!(),
        };

        for route in html_bundle_routes {
            // BACKREF: route was ref'd when stored (intrusive +1 keeps it alive
            // for this call). R-2: `on_plugins_resolved` takes `&self`.
            let route_nn = NonNull::new(route).expect("html_bundle::Route ref'd when stored");
            // Spec server.zig:457 — `bun.handleOom(route.onPluginsResolved(plugin))`
            bun_core::handle_oom(
                bun_ptr::BackRef::from(route_nn)
                    .on_plugins_resolved(Some(NonNull::from(plugin_ref))),
            );
            // SAFETY: paired with the `ref_` taken when the route was pushed.
            unsafe { bun_ptr::RefCount::<html_bundle::Route>::deref(route) };
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

    pub fn handle_on_reject(&mut self, global: &JSGlobalObject, err: JSValue) {
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
        drop(promise); // Zig: promise.deinit() — Drop on JscStrong releases the slot.

        self.state = ServePluginsState::Err;

        for route in html_bundle_routes {
            // BACKREF: route was ref'd when stored (intrusive +1 keeps it alive
            // for this call). R-2: `on_plugins_rejected` takes `&self`.
            let route_nn = NonNull::new(route).expect("html_bundle::Route ref'd when stored");
            bun_core::handle_oom(bun_ptr::BackRef::from(route_nn).on_plugins_rejected());
            // SAFETY: route was ref'd when stored; pair with that ref
            unsafe { bun_ptr::RefCount::<html_bundle::Route>::deref(route) };
        }
        if let Some(mut server) = dev_server {
            // SAFETY: dev_server outlives plugin load
            bun_core::handle_oom(unsafe { server.as_mut() }.on_plugins_rejected());
        }

        Output::err_generic("Failed to load plugins for Bun.serve:", ());
        global.bun_vm().as_mut().run_error_handler(err, None);
    }
}

/// RAII owner of one counted reference to a [`ServePlugins`]. Drops the
/// reference via [`ServePlugins::deref_`] on scope exit — the Rust spelling of
/// Zig's `defer this.deref()`.
///
/// Holds the raw `*mut` from [`ServePlugins::init`] so the final `heap::take`
/// has write/dealloc provenance over the whole allocation. Never construct this
/// from a pointer derived through `&ServePlugins` — that yields a SharedReadOnly
/// tag under Stacked Borrows and freeing through it is UB.
struct ServePluginsRef(*mut ServePlugins);

impl ServePluginsRef {
    /// Adopt an existing +1 reference (no increment).
    ///
    /// # Safety
    /// Caller must own one counted reference to `ptr`, and `ptr` must carry the
    /// `heap::alloc` provenance from [`ServePlugins::init`].
    #[inline]
    unsafe fn adopt(ptr: *mut ServePlugins) -> Self {
        Self(ptr)
    }
}

impl Drop for ServePluginsRef {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: constructed via `adopt`/`guard_ref` with a live counted ref.
        unsafe { ServePlugins::deref_(self.0) };
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
pub fn on_resolve_impl(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onResolve");

    let [plugins_result, plugins_js] = callframe.arguments_as_array::<2>();
    let plugins = plugins_js.as_promise_ptr::<ServePlugins>();
    // SAFETY: `plugins` was heap-allocated and ref()'d before .then(); deref pairs with that ref
    let _guard = unsafe { ServePluginsRef::adopt(plugins) };
    plugins_result.ensure_still_alive();

    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_resolve();

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(export = "BunServe__onRejectPlugins")]
pub fn on_reject_impl(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onReject");

    let [error_js, plugin_js] = callframe.arguments_as_array::<2>();
    let plugins = plugin_js.as_promise_ptr::<ServePlugins>();
    // SAFETY: `plugins` was heap-allocated and ref()'d before .then(); deref pairs with that ref
    let _guard = unsafe { ServePluginsRef::adopt(plugins) };
    // SAFETY: pointer was passed via .then() above
    unsafe { &mut *plugins }.handle_on_reject(global, error_js);

    Ok(JSValue::UNDEFINED)
}

#[inline]
fn fetch_headers_from_js(value: JSValue, global: &JSGlobalObject) -> Option<*mut FetchHeaders> {
    FetchHeaders::cast_(value, global.vm()).map(|p| p.as_ptr())
}

/// Per-process latch for the dev-mode idle-timeout warning. The Zig source
/// declares a `var` per-monomorphization static inside `NewServer`, but the
/// warning is gated on `DEBUG && !silent` and only fires once globally, so a
/// single shared `AtomicBool` matches user-visible behavior.
#[inline]
fn did_send_idletimeout_warning_once() -> &'static core::sync::atomic::AtomicBool {
    static FLAG: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
    &FLAG
}

/// Body of `onTimeoutForIdleWarn` (server.zig) — emits the once-only dev-mode
/// warning. Factored out as a free fn so the `RespLike::on_timeout_warn`
/// closures (which cannot name `NewServer<SSL,DEBUG>`) can call it.
fn on_timeout_for_idle_warn() {
    if !did_send_idletimeout_warning_once().swap(true, core::sync::atomic::Ordering::Relaxed)
        && !crate::cli::Command::get().debug.silent
    {
        Output::pretty_errorln(
            "<r><yellow>[Bun.serve]<r><d>:<r> request timed out after 10 seconds. Pass <d><cyan>`idleTimeout`<r> to configure.",
        );
        Output::flush();
    }
}

// ─── PluginsResult ───────────────────────────────────────────────────────────
pub enum PluginsResult<'a> {
    Pending,
    Found(Option<&'a JSBundler::Plugin>),
    Err,
}

// ─── NewServer ───────────────────────────────────────────────────────────────
// ─── NewServer (canonical type lives in mod.rs) ──────────────────────────────
// PORT NOTE (unification): the struct, `ServerFlags`, `UserRoute`,
// `CreateJsRequest`, `PreparedRequest`, `SavedRequest`, `SavedRequestUnion`,
// `ServerAllConnectionsClosedTask`, `AnyServer` and the four type aliases are
// defined once in `super` (mod.rs). This file contributes additional inherent
// methods on the same type — there is no separate Phase-A struct.
pub use super::{
    AnyServer, AnyServerTag, CreateJsRequest, DebugHTTPSServer, DebugHTTPServer, HTTPSServer,
    HTTPServer, NewServer, PreparedRequest, SavedRequest, SavedRequestUnion,
    ServerAllConnectionsClosedTask, ServerFlags, UserRoute,
};

/// `fn PreparedRequestFor(comptime Ctx: type) type` — generic over the
/// per-transport `RequestContext` so the same body serves HTTP/1 and HTTP/3.
/// `super::PreparedRequest<SSL,DEBUG>` is the HTTP/1-concrete instantiation
/// used by the bake/saved-request path; the generic form here is only reached
/// from the `_for<Ctx>` dispatch helpers below.
pub struct PreparedRequestFor<'a, Ctx> {
    pub js_request: JSValue,
    pub request_object: &'a mut Request,
    pub ctx: &'a mut Ctx,
}

impl<'a, Ctx: RequestCtxOps> PreparedRequestFor<'a, Ctx> {
    /// This is used by DevServer for deferring calling the JS handler
    /// to until the bundle is actually ready.
    pub fn save(
        self,
        global: &JSGlobalObject,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
    ) -> SavedRequest {
        // Zig: `if (comptime Ctx.is_h3) @compileError("PreparedRequest.save is HTTP/1-only")`
        debug_assert!(!Ctx::IS_H3, "PreparedRequest.save is HTTP/1-only");
        // By saving a request, all information from `req` must be
        // copied since the provided uws.Request will be re-used for
        // future requests (stack allocated).
        RequestCtxOps::to_async(self.ctx, req, self.request_object);

        SavedRequest {
            js_request: StrongOptional::create(self.js_request, global),
            request: self.request_object,
            ctx: AnyRequestContext::init(std::ptr::from_ref::<Ctx>(self.ctx)),
            response: RespLike::to_any_response(resp),
        }
    }
}

// `WebSocketUpgradeServer<SSL>` so `ServerWebSocket::behavior::<Self, SSL>` and
// `app.ws(...)` accept `*mut Self` / `*mut UserRoute<..>` as the upgrade ctx.
impl<const SSL: bool, const DEBUG: bool> uws_sys::web_socket::WebSocketUpgradeServer<SSL>
    for NewServer<SSL, DEBUG>
where
    // PORT NOTE: see the bounded `impl NewServer` below for why these are
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
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST — safe deref.
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

    /// `server.zig:notifyInspectorServerStopped`. Unbounded so `deinit()` (in
    /// the unbounded `impl NewServer` in mod.rs) can call it without naming
    /// the per-transport `RequestContext` bounds.
    pub(super) fn notify_inspector_server_stopped(&mut self) {
        if self.inspector_server_id.get() != 0 {
            bun_core::hint::cold();
            if let Some(debugger) = &self.vm().as_mut().debugger {
                bun_core::hint::cold();
                // PORT NOTE (layering): `HTTPServerAgent.notifyServerStopped`
                // takes `AnyServer` in Zig and unpacks `inspector_server_id`
                // itself. The Rust port hoists that wrapper to
                // `super::http_server_agent` so this crate-tier call doesn't
                // re-declare the C ABI.
                super::http_server_agent::notify_server_stopped(
                    &debugger.http_server_agent,
                    self.as_any_server(),
                );
                // Spec: only clear the id once the agent has been notified, so a
                // call that races a not-yet-attached debugger leaves the id set
                // for a later retry (server.zig:1738-1749).
                self.inspector_server_id = DebuggerId::init(0);
            }
        }
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG>
where
    // PORT NOTE (const-generic dispatch): `RequestContextHostFns` (the host-fn
    // export table) is blanket-impl'd per (SSL,DBG,H3) tuple in
    // `RequestContext.rs` for `ThisServer: ServerLike`; restating it here lets
    // method bodies name `<NewRequestContext<..> as RequestContextHostFns>::ON_*`
    // without each method repeating the bound.
    NewRequestContext<Self, SSL, DEBUG, false>: super::request_context::RequestContextHostFns,
    NewRequestContext<Self, SSL, DEBUG, true>: super::request_context::RequestContextHostFns,
{
    pub fn get_plugins(&self) -> PluginsResult<'_> {
        match self.plugins_ref() {
            None => PluginsResult::Found(None),
            Some(p) => match &p.state {
                ServePluginsState::Unqueued(_) | ServePluginsState::Pending { .. } => {
                    PluginsResult::Pending
                }
                ServePluginsState::Loaded(plugin) => PluginsResult::Found(Some(plugin.as_ref())),
                ServePluginsState::Err => PluginsResult::Err,
            },
        }
    }

    // PORT NOTE: `getPluginsAsync` is referenced from `AnyServer.loadAndResolvePlugins`
    // (server.zig:3440-3447) but never defined on `ThisServer`. Zig's lazy
    // compilation means the dispatch arm is dead. The Rust port omits both the
    // method and the `AnyServer` dispatcher rather than guess a contract that
    // would silently change behavior if a caller is later wired up. The live
    // HTMLBundle path goes through `get_or_load_plugins`.

    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub fn get_or_load_plugins(
        &mut self,
        callback: ServePluginsCallback<'_>,
    ) -> GetOrStartLoadResult<'_> {
        if let Some(p) = self.plugins {
            let global = self.global();
            // Keep `*p` alive across re-entrant JS in `load_and_resolve_plugins`
            // (Zig: `this.ref(); defer this.deref()`). The guard is built from the
            // heap-allocated `*mut` directly so its provenance survives the
            // `&mut *p` reborrow below and remains valid for `heap::take` on drop.
            //
            // SAFETY: `p` was produced by `ServePlugins::init` (heap::alloc) and is
            // live while held in `self.plugins`.
            let _deref_guard = unsafe { ServePlugins::guard_ref(p.as_ptr()) };
            // SAFETY: `plugins` holds a counted ref produced by
            // `ServePlugins::init` (heap::alloc); intrusive refcount permits
            // mutation through any owner. No other `&mut ServePlugins` is live
            // on this (single-threaded) JS thread for the call's duration.
            return match unsafe { &mut *p.as_ptr() }.get_or_start_load(&global, callback) {
                Ok(r) => r,
                Err(JsError::Thrown) | Err(JsError::Terminated) => {
                    panic!("unhandled exception from ServePlugins.getStartOrLoad")
                }
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            };
        }
        // no plugins
        GetOrStartLoadResult::Ready(None)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_subscriber_count(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        if arguments.len < 1 {
            return Err(global.throw_not_enough_arguments("subscriberCount", 1, 0));
        }

        if arguments.ptr[0].is_empty_or_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!(
                "subscriberCount requires a topic name as a string"
            )));
        }

        let topic = arguments.ptr[0].to_slice(global)?;

        if topic.slice().is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        Ok(JSValue::js_number(f64::from(
            self.app_mut().num_subscribers(topic.slice()),
        )))
    }

    // ── host_fn.wrapInstanceMethod hand-expansions ───────────────────────
    //
    // PORT NOTE: Zig's `host_fn.wrapInstanceMethod(ThisServer, "name", false)`
    // is a comptime type-directed argument decoder (see host_fn.zig:493-648).
    // The `#[bun_jsc::host_fn(method)]` proc-macro that will eventually
    // replace it hasn't landed, so the per-type decode arms used by the
    // server (`ZigString`, `JSValue`, `?JSValue`, `*WebCore.Request`) are
    // open-coded here. They mirror the Zig branches exactly: same error
    // messages, same undefined/null handling, same eat order.

    /// `pub const doStop = host_fn.wrapInstanceMethod(ThisServer, "stopFromJS", false)`
    #[bun_jsc::host_fn(method)]
    pub fn do_stop(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        // ?jsc.JSValue
        let abruptly = iter.next_eat();
        Ok(self.stop_from_js(abruptly))
    }

    /// `pub const dispose = host_fn.wrapInstanceMethod(ThisServer, "disposeFromJS", false)`
    #[bun_jsc::host_fn(method)]
    pub fn dispose(
        &mut self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self.dispose_from_js())
    }

    /// `pub const doUpgrade = host_fn.wrapInstanceMethod(ThisServer, "onUpgrade", false)`
    #[bun_jsc::host_fn(method)]
    pub fn do_upgrade(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<4>();
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
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
    pub fn do_publish(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<5>();
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        // jsc.ZigString
        let topic_value = iter
            .next_eat()
            .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))?;
        if topic_value.is_undefined_or_null() {
            return Err(global.throw_invalid_arguments(format_args!("Expected string")));
        }
        let topic = ZigString::from(topic_value.get_zig_string(global)?);
        // jsc.JSValue
        let message_value = iter
            .next_eat()
            .ok_or_else(|| global.throw_invalid_arguments(format_args!("Missing argument")))?;
        // ?jsc.JSValue
        let compress_value = iter.next_eat();
        self.publish(global, topic, message_value, compress_value)
    }

    /// `pub const doRequestIP = host_fn.wrapInstanceMethod(ThisServer, "requestIP", false)`
    #[bun_jsc::host_fn(method)]
    pub fn do_request_ip(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<2>();
        let mut iter = jsc::ArgumentsSlice::init(global.bun_vm_ref(), args.slice());
        // *jsc.WebCore.Request
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
    pub fn do_reload(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.on_reload(global, callframe)
    }

    /// `pub const doFetch = onFetch`
    #[inline]
    pub fn do_fetch(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.on_fetch(global, callframe)
    }

    /// `pub const doTimeout = timeout`
    #[inline]
    pub fn do_timeout(
        &mut self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.timeout(global, callframe)
    }

    pub fn request_ip(&self, request: &Request) -> JsResult<JSValue> {
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
    pub fn timeout(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments_buf = callframe.arguments_old::<2>();
        let arguments = arguments_buf.slice();
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
            // SAFETY: from_js returns a live *mut Request
            let _ = unsafe { &mut *request }.request_context.set_timeout(value);
        } else if let Some(response) = <NodeHTTPResponse as bun_jsc::JsClass>::from_js(arguments[0])
        {
            // SAFETY: from_js returns a live *mut NodeHTTPResponse
            unsafe { &mut *response }.set_timeout((value % 255) as u8);
        } else {
            return Err(self
                .global()
                .throw_invalid_arguments(format_args!("timeout() requires a Request object")));
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn append_static_route(
        &mut self,
        path: &[u8],
        route: super::AnyRoute,
        method: server_config::MethodOptional,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.config.append_static_route(path, route, method)
    }

    pub fn publish(
        &mut self,
        global: &JSGlobalObject,
        topic: ZigString,
        message_value: JSValue,
        compress_value: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if self.config.websocket.is_none() {
            return Ok(JSValue::js_number(0.0));
        }

        let app = self.app.unwrap().cast::<c_void>();

        if topic.len == 0 {
            httplog!("publish() topic invalid");
            return Err(global.throw(format_args!("publish requires a topic string")));
        }

        let topic_slice = topic.to_slice();
        if topic_slice.slice().is_empty() {
            return Err(global.throw(format_args!("publish requires a non-empty topic")));
        }

        // https://github.com/ziglang/zig/issues/24563
        let compress_js = compress_value.unwrap_or(JSValue::TRUE);
        let compress = compress_js.to_boolean();

        if let Some(buffer) = message_value.as_array_buffer(global) {
            return Ok(JSValue::js_number(f64::from(
                // if 0, return 0
                // else return number of bytes sent
                (AnyWebSocket::publish_with_options(
                    SSL,
                    app,
                    topic_slice.slice(),
                    buffer.slice(),
                    uws_sys::Opcode::Binary,
                    compress,
                ) as i32)
                    * ((buffer.len as u32 & 0x7FFF_FFFF) as i32), // @intCast(@as(u31, @truncate(buffer.len)))
            )));
        }

        {
            let js_string = message_value.to_js_string(global)?;
            let view = js_string.view(global);
            let slice = view.to_slice();
            // Spec keeps `js_string` alive (server.zig:748), not `message_value`:
            // when the input was not already a JSString, `to_js_string` allocates
            // a fresh GC cell that is *not* reachable from `message_value`, so a
            // GC during `publish_with_options` could otherwise reclaim the bytes
            // `slice` borrows.
            let buffer = slice.slice();
            let result = (AnyWebSocket::publish_with_options(
                SSL,
                app,
                topic_slice.slice(),
                buffer,
                uws_sys::Opcode::Text,
                compress,
            ) as i32)
                * ((buffer.len() as u32 & 0x7FFF_FFFF) as i32);
            js_string.ensure_still_alive();
            // if 0, return 0
            // else return number of bytes sent
            return Ok(JSValue::js_number(f64::from(result)));
        }
    }

    pub fn on_upgrade(
        &mut self,
        global: &JSGlobalObject,
        object: JSValue,
        optional: Option<JSValue>,
    ) -> JsResult<JSValue> {
        use super::node_http_response::Flags as NodeHTTPResponseFlags;
        use bun_core::ZigStringSlice;
        use bun_jsc::HTTPHeaderName;

        if self.config.websocket.is_none() {
            return Err(global.throw_invalid_arguments(format_args!(
                "To enable websocket support, set the \"websocket\" object in Bun.serve({{}})"
            )));
        }

        if self.flags.contains(ServerFlags::TERMINATED) {
            return Ok(JSValue::FALSE);
        }

        if let Some(node_http_response) = <NodeHTTPResponse as bun_jsc::JsClass>::from_js(object) {
            // SAFETY: from_js returns a live *mut NodeHTTPResponse
            let node_http_response = unsafe { &mut *node_http_response };
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

            let mut sec_websocket_protocol = ZigString::EMPTY;
            let mut sec_websocket_extensions = ZigString::EMPTY;

            // Owned backing storage for the above when they come from options.headers.
            // fastGet returns a ZigString that borrows from the header map entry's
            // StringImpl, which fastRemove then frees — so we must copy the bytes
            // before removing the entry.
            let mut sec_websocket_protocol_owned = ZigStringSlice::EMPTY;
            let mut sec_websocket_extensions_owned = ZigStringSlice::EMPTY;

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

                    if global.has_exception() {
                        return Err(JsError::Thrown);
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
                                    if !global.has_exception() {
                                        return Err(global.throw_invalid_arguments(format_args!(
                                            "upgrade options.headers must be a Headers or an object"
                                        )));
                                    }
                                    return Err(JsError::Thrown);
                                }
                            };
                        // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                        let fetch_headers_to_use =
                            bun_opaque::opaque_deref_mut(fetch_headers_to_use);

                        if global.has_exception() {
                            return Err(JsError::Thrown);
                        }

                        if let Some(protocol) =
                            fetch_headers_to_use.fast_get(HTTPHeaderName::SecWebSocketProtocol)
                        {
                            // Clone before fastRemove frees the backing StringImpl.
                            sec_websocket_protocol_owned = protocol.to_slice_clone();
                            sec_websocket_protocol =
                                ZigString::init(sec_websocket_protocol_owned.slice());
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use.fast_remove(HTTPHeaderName::SecWebSocketProtocol);
                        }

                        if let Some(extensions) =
                            fetch_headers_to_use.fast_get(HTTPHeaderName::SecWebSocketExtensions)
                        {
                            // Clone before fastRemove frees the backing StringImpl.
                            sec_websocket_extensions_owned = extensions.to_slice_clone();
                            sec_websocket_extensions =
                                ZigString::init(sec_websocket_extensions_owned.slice());
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use
                                .fast_remove(HTTPHeaderName::SecWebSocketExtensions);
                        }
                        if let Some(raw_response) = node_http_response.raw_response.get() {
                            // we must write the status first so that 200 OK isn't written
                            raw_response.write_status(b"101 Switching Protocols");
                            fetch_headers_to_use.to_uws_response(
                                ResponseKind::from(SSL, false),
                                raw_response.socket().cast::<c_void>(),
                            );
                        }
                    }

                    if global.has_exception() {
                        return Err(JsError::Thrown);
                    }
                }
            }
            return Ok(JSValue::from(node_http_response.upgrade(
                data_value,
                sec_websocket_protocol,
                sec_websocket_extensions,
            )));
        }

        let Some(request) = <Request as bun_jsc::JsClass>::from_js(object) else {
            return Err(
                global.throw_invalid_arguments(format_args!("upgrade requires a Request object"))
            );
        };
        // SAFETY: from_js returns a live *mut Request
        let request = unsafe { &mut *request };

        let Some(upgrader_ptr) = request
            .request_context
            .get::<ServerRequestContext<SSL, DEBUG>>()
        else {
            return Ok(JSValue::FALSE);
        };
        // SAFETY: tagged pointer just matched this monomorphization.
        let upgrader = unsafe { &mut *upgrader_ptr };

        if upgrader.is_aborted_or_ended() {
            return Ok(JSValue::FALSE);
        }

        if upgrader.upgrade_context.is_none()
            || upgrader.upgrade_context.map(|p| p as usize) == Some(usize::MAX)
        {
            return Ok(JSValue::FALSE);
        }

        let resp = upgrader.resp.unwrap();
        let upgrade_ctx = upgrader.upgrade_context.unwrap();

        // Keep the upgrader alive across option getters below, which run
        // arbitrary user JS. A re-entrant server.upgrade(req) from a getter
        // would otherwise be able to deref this context out from under us.
        upgrader.ref_();
        let _upgrader_guard = scopeguard::guard(upgrader_ptr, |p| unsafe { (*p).deref() });

        let mut sec_websocket_key_str = ZigString::EMPTY;
        let mut sec_websocket_protocol = ZigString::EMPTY;
        let mut sec_websocket_extensions = ZigString::EMPTY;

        // Owned backing storage for sec_websocket_* — see server.zig:910 comment.
        // `ZigStringSlice` impls `Drop`; reassignment drops the previous value.
        let mut sec_websocket_key_owned = bun_core::ZigStringSlice::empty();
        let mut sec_websocket_protocol_owned = bun_core::ZigStringSlice::empty();
        let mut sec_websocket_extensions_owned = bun_core::ZigStringSlice::empty();

        // PORT NOTE: `FetchHeaders::fast_get` takes `&mut self` (FFI signature
        // is `*mut`), so go through the `BodyMixin` accessor which yields a
        // `NonNull` instead of the inherent `&FetchHeaders` getter.
        if let Some(head) = crate::webcore::body::BodyMixin::get_fetch_headers(request) {
            use jsc::HTTPHeaderName;
            // `head` is a live, intrusively-refcounted C++ handle owned by
            // `request.headers`. `FetchHeaders` is an opaque ZST FFI handle
            // (S008) — safe `*mut → &mut` via `opaque_deref_mut`.
            let head = bun_opaque::opaque_deref_mut(head.as_ptr());
            if let Some(key) = head.fast_get(HTTPHeaderName::SecWebSocketKey) {
                sec_websocket_key_owned = key.to_slice_clone();
                sec_websocket_key_str = ZigString::init(sec_websocket_key_owned.slice());
            }
            if let Some(proto) = head.fast_get(HTTPHeaderName::SecWebSocketProtocol) {
                sec_websocket_protocol_owned = proto.to_slice_clone();
                sec_websocket_protocol = ZigString::init(sec_websocket_protocol_owned.slice());
            }
            if let Some(ext) = head.fast_get(HTTPHeaderName::SecWebSocketExtensions) {
                sec_websocket_extensions_owned = ext.to_slice_clone();
                sec_websocket_extensions = ZigString::init(sec_websocket_extensions_owned.slice());
            }
        }

        // SAFETY: upgrader_ptr is live (ref_() above)
        let upgrader = unsafe { &mut *upgrader_ptr };
        if let Some(req_ptr) = upgrader.req {
            // PORT NOTE: `RequestContext.req` is type-erased to `*mut c_void`
            // (RequestContext.rs:82). `server.upgrade()` is HTTP/1-only — H3
            // contexts have a distinct generic param and `request_context.get`
            // above would have returned None — so the concrete `Req` is always
            // `uws_sys::Request` here.
            // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref
            // (BACKREF; live while RequestContext.req is Some).
            let r = bun_opaque::opaque_deref_mut(req_ptr.cast::<uws_sys::Request>());
            if sec_websocket_key_str.len == 0 {
                sec_websocket_key_str =
                    ZigString::init(r.header(b"sec-websocket-key").unwrap_or(b""));
            }
            if sec_websocket_protocol.len == 0 {
                sec_websocket_protocol =
                    ZigString::init(r.header(b"sec-websocket-protocol").unwrap_or(b""));
            }
            if sec_websocket_extensions.len == 0 {
                sec_websocket_extensions =
                    ZigString::init(r.header(b"sec-websocket-extensions").unwrap_or(b""));
            }
        }

        if sec_websocket_key_str.len == 0 {
            return Ok(JSValue::FALSE);
        }
        if sec_websocket_protocol.len > 0 {
            sec_websocket_protocol.mark_utf8();
        }
        if sec_websocket_extensions.len > 0 {
            sec_websocket_extensions.mark_utf8();
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
                if global.has_exception() {
                    return Err(JsError::Thrown);
                }

                if let Some(headers_value) = opts.fast_get(global, jsc::BuiltinName::Headers)? {
                    if headers_value.is_empty_or_undefined_or_null() {
                        break 'getter;
                    }
                    use jsc::HTTPHeaderName;
                    let fh: *mut FetchHeaders = match fetch_headers_from_js(headers_value, global) {
                        Some(h) => h,
                        None => {
                            if headers_value.is_object() {
                                if let Some(created) =
                                    FetchHeaders::create_from_js(global, headers_value)?
                                {
                                    *fetch_headers_to_deref = Some(created.as_ptr());
                                    created.as_ptr()
                                } else if !global.has_exception() {
                                    return Err(global.throw_invalid_arguments(format_args!(
                                        "upgrade options.headers must be a Headers or an object"
                                    )));
                                } else {
                                    return Err(JsError::Thrown);
                                }
                            } else if !global.has_exception() {
                                return Err(global.throw_invalid_arguments(format_args!(
                                    "upgrade options.headers must be a Headers or an object"
                                )));
                            } else {
                                return Err(JsError::Thrown);
                            }
                        }
                    };
                    fetch_headers_to_use = Some(fh);
                    if global.has_exception() {
                        return Err(JsError::Thrown);
                    }

                    // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                    let fh = bun_opaque::opaque_deref_mut(fh);
                    if let Some(p) = fh.fast_get(HTTPHeaderName::SecWebSocketProtocol) {
                        sec_websocket_protocol_owned = p.to_slice_clone();
                        sec_websocket_protocol =
                            ZigString::init(sec_websocket_protocol_owned.slice());
                        fh.fast_remove(HTTPHeaderName::SecWebSocketProtocol);
                    }
                    if let Some(e) = fh.fast_get(HTTPHeaderName::SecWebSocketExtensions) {
                        sec_websocket_extensions_owned = e.to_slice_clone();
                        sec_websocket_extensions =
                            ZigString::init(sec_websocket_extensions_owned.slice());
                        fh.fast_remove(HTTPHeaderName::SecWebSocketExtensions);
                    }
                }
                if global.has_exception() {
                    return Err(JsError::Thrown);
                }
            }
        }

        // SAFETY: upgrader_ptr is live (ref_() above)
        let upgrader = unsafe { &mut *upgrader_ptr };
        // Option getters may have run a re-entrant server.upgrade(req).
        if upgrader.is_aborted_or_ended() || upgrader.did_upgrade_web_socket() {
            return Ok(JSValue::FALSE);
        }

        // `CookieMapRef` releases the moved-out ref on every exit path of this
        // scope (including the `?` below) once `cookies_to_write` drops.
        let mut cookies_to_write = upgrader.cookies.take();

        // Write status, custom headers, and cookies in one place
        if fetch_headers_to_use.is_some() || cookies_to_write.is_some() {
            resp.write_status(b"101 Switching Protocols");
            if let Some(h) = fetch_headers_to_use {
                // S008: `FetchHeaders` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(h).to_uws_response(
                    ResponseKind::from(SSL, false),
                    resp.socket().cast::<c_void>(),
                );
            }
            if let Some(c) = cookies_to_write.as_mut() {
                c.write(
                    global,
                    ResponseKind::from(SSL, false),
                    resp.socket().cast::<c_void>(),
                )?;
            }
        }

        // --- After this point, do not throw an exception
        // See https://github.com/oven-sh/bun/issues/1339
        upgrader.upgrade_context = Some(usize::MAX as *mut WebSocketUpgradeContext);
        let signal = upgrader.signal.take();
        upgrader.resp = None;
        request.request_context = AnyRequestContext::NULL;
        upgrader.request_weakref.deref();

        data_value.ensure_still_alive();
        let ws = ServerWebSocket::init(
            &mut self.config.websocket.as_mut().unwrap().handler,
            data_value,
            signal,
        );
        data_value.ensure_still_alive();

        // `ZigString::Slice` impls `Drop` — freed at scope exit.
        let proto_str = sec_websocket_protocol.to_slice();
        let ext_str = sec_websocket_extensions.to_slice();

        resp.clear_aborted();
        resp.clear_on_data();
        resp.clear_on_writable();
        resp.clear_timeout();

        upgrader.deref();

        resp.upgrade(
            ws,
            sec_websocket_key_str.slice(),
            proto_str.slice(),
            ext_str.slice(),
            // S008: `WebSocketUpgradeContext` is an `opaque_ffi!` ZST — safe
            // deref (`upgrade_ctx` checked non-null / non-sentinel above,
            // server.zig:899; the uWS HttpContext owns it for the request's
            // duration).
            Some(bun_opaque::opaque_deref_mut(upgrade_ctx)),
        );

        Ok(JSValue::TRUE)
    }

    /// `server.zig:onReloadFromZig`. Swaps the live server's mutable
    /// configuration (handlers, websocket, routes) with `new_config` and
    /// re-registers routes on the uws app(s). Ownership of moved-in fields
    /// transfers to `self.config`; the caller's `new_config` is left in a
    /// valid-but-emptied state (`ServerConfig`'s `Drop` then frees whatever
    /// was *not* taken — e.g. a websocket block we declined to adopt).
    pub fn on_reload_from_zig(&mut self, new_config: &mut ServerConfig, global: &JSGlobalObject) {
        httplog!("onReload");

        // SAFETY: `on_reload` is only reachable while the server is running
        // (`self.app` set in `listen()`).
        self.app_mut().clear_routes();
        if Self::HAS_H3 {
            if let Some(h3a) = self.h3_app {
                bun_opaque::opaque_deref_mut(h3a).clear_routes();
            }
        }

        // Only reload `on_request` / `on_error` when the new config actually
        // specifies one. `Option<Strong>` drops the old handle (= JSValue.unprotect()).
        if new_config
            .on_request
            .as_ref()
            .is_some_and(|s| !s.get().is_undefined())
        {
            self.config.on_request = new_config.on_request.take();
        }
        // Zig server.zig:1108: `if (this.config.onNodeHTTPRequest != new_config.onNodeHTTPRequest)`
        // — swap on any change, *including* clearing to `.zero` when the reload
        // config omits the handler, so subsequent `on_web_socket_upgrade` /
        // `set_routes` stop routing through the node:http path. `take()` yields
        // `None` when the new config omitted it; assignment drops the old Strong.
        if self.config.on_node_http_request.as_ref().map(Strong::get)
            != new_config.on_node_http_request.as_ref().map(Strong::get)
        {
            self.config.on_node_http_request = new_config.on_node_http_request.take();
        }
        if new_config
            .on_error
            .as_ref()
            .is_some_and(|s| !s.get().is_undefined())
        {
            self.config.on_error = new_config.on_error.take();
        }

        if let Some(mut ws) = new_config.websocket.take() {
            ws.handler
                .flags
                .set(super::web_socket_server_context::HandlerFlags::SSL, SSL);
            if !ws.handler.on_message.is_empty() || !ws.handler.on_open.is_empty() {
                if let Some(old_ws) = self.config.websocket.as_ref() {
                    old_ws.unprotect();
                }
                ws.global_object = global;
                self.config.websocket = Some(ws);
            } else {
                // Not adopting it: release the protections taken in
                // `WebSocketServerContext::on_create` so the handlers don't leak.
                ws.unprotect();
            }
        }

        // These get re-applied when we set the static routes again.
        if let Some(dev_server) = self.dev_server.as_deref_mut() {
            // Prevent a use-after-free in the hash table keys.
            dev_server.html_router.clear();
            dev_server.html_router.fallback = None;
        }

        // PORT NOTE: Zig drains+frees `this.config.static_routes` then assigns
        // `new_config.static_routes`. `Vec<StaticRouteEntry>` impls `Drop`, so
        // a move-assign performs the same free.
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
            if let Some(server_js_value) = self.js_value.try_get() {
                if !server_js_value.is_empty() {
                    Self::js_gc_route_list_set(server_js_value, global, route_list_value);
                }
            }
        }

        if self.inspector_server_id.get() != 0 {
            if let Some(debugger) = self.vm().as_mut().debugger.as_deref_mut() {
                bun_core::handle_oom(super::http_server_agent::notify_server_routes_updated(
                    &mut debugger.http_server_agent,
                    self.as_any_server(),
                ));
            }
        }
    }

    pub fn reload_static_routes(&mut self) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        if self.app.is_none() {
            // Static routes will get cleaned up when the server is stopped
            return Ok(false);
        }
        self.config = self.config.clone_for_reloading_static_routes()?;
        self.app_mut().clear_routes();
        if Self::HAS_H3 {
            if let Some(h3a) = self.h3_app {
                bun_opaque::opaque_deref_mut(h3a).clear_routes();
            }
        }
        let route_list_value = self.set_routes();
        if !route_list_value.is_empty() {
            if let Some(server_js_value) = self.js_value.try_get() {
                if !server_js_value.is_empty() {
                    Self::js_gc_route_list_set(server_js_value, &self.global(), route_list_value);
                }
            }
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn on_reload(
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
                has_user_routes: !self.user_routes.is_empty(),
            },
        )?;
        if global.has_exception() {
            drop(new_config);
            return Err(JsError::Thrown);
        }

        self.on_reload_from_zig(&mut new_config, global);

        Ok(self.js_value.try_get().unwrap_or(JSValue::UNDEFINED))
    }

    #[bun_jsc::host_fn(method)]
    pub fn on_fetch(&mut self, ctx: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if self.config.on_request.is_none() {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ZigString::init(b"fetch() requires the server to have a fetch handler")
                        .to_error_instance(ctx),
                ),
            );
        }

        let arguments_buf = callframe.arguments_old::<2>();
        let arguments = arguments_buf.slice();
        if arguments.is_empty() {
            let fetch_error = Fetch::FETCH_ERROR_NO_ARGS;
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ZigString::init(fetch_error.as_bytes()).to_error_instance(ctx),
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
            let url_zig_str = arguments[0].to_slice(ctx)?;
            let temp_url_str = url_zig_str.slice();

            if temp_url_str.is_empty() {
                let fetch_error = Fetch::FETCH_ERROR_BLANK_URL;
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        ctx,
                        ZigString::init(fetch_error.as_bytes()).to_error_instance(ctx),
                    ),
                );
            }

            let mut url = URL::parse(temp_url_str);

            // Both branches produce a heap-owned buffer that `url.href` borrows.
            // `bun.String.cloneUTF8(url.href)` below makes its own copy, so this
            // buffer must be freed before we leave the block.
            let owned_url_buf: Vec<u8> = if url.hostname.is_empty() {
                strings::append(&self.base_url_string_for_joining, url.pathname).into_vec()
            } else {
                temp_url_str.to_vec()
            };
            url = URL::parse(&owned_url_buf);

            if arguments.len() >= 2 && arguments[1].is_object() {
                let opts = arguments[1];
                if let Some(method_) = opts.fast_get(ctx, jsc::BuiltinName::Method)? {
                    let slice_ = method_.to_slice(ctx)?;
                    method = Method::which(slice_.slice()).unwrap_or(method);
                }

                if let Some(headers_) = opts.fast_get(ctx, jsc::BuiltinName::Headers)? {
                    if let Some(headers__) = FetchHeaders::cast_(headers_, ctx.vm()) {
                        // PORT NOTE: `cast_` returns a *borrow* of the JS
                        // wrapper's `Ref<FetchHeaders>` without bumping the
                        // refcount. Zig stores it directly in
                        // `Request.#headers` (server.zig:1296) and
                        // `Request.finalizeWithoutDeinit` later calls
                        // `headers.deref()` — same alloc/free pairing as
                        // `HeadersRef::adopt` + `Drop`. Kept 1:1 with the
                        // spec; FetchHeaders has no `ref()` FFI.
                        // SAFETY: `headers__` is live (rooted by `headers_`).
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
                                ZigString::init(b"fetch() received invalid body").to_error_instance(ctx),
                            ));
                        }
                    }
                }
            }

            Box::new(Request::init2(
                BunString::clone_utf8(url.href),
                headers,
                // Zig: `bun.handleOom(this.vm.initRequestBodyValue(body))` —
                // moves `body` into the per-VM hive pool (ref_count = 1).
                crate::webcore::body::hive_alloc(self.vm().as_mut(), body),
                method,
            ))
        } else if let Some(request_) = first_arg
            .is_object()
            .then(|| <Request as bun_jsc::JsClass>::from_js(first_arg))
            .flatten()
        {
            // SAFETY: JsClass::from_js returns a live *mut Request.
            // PORT NOTE: Zig `request_.cloneInto(&existing_request, alloc, ctx, false)`
            // wrote into a default-initialized `var existing_request: Request = .{}`.
            // `Request::clone()` (Request.rs:1627) seeds a fully-initialized
            // sentinel and calls `clone_into(.., preserve_url=false)` — same
            // observable result without taking `&mut` to uninitialized memory.
            unsafe { (*request_).clone(ctx)? }
        } else {
            // SAFETY: FFI call into JSC C API; `ctx` is a live JSGlobalObject and
            // `first_arg.as_ref()` produces a valid `JSValueRef`.
            let js_type =
                unsafe { jsc::c_api::JSValueGetType(ctx.as_ptr(), first_arg.as_ref()) } as usize;
            let fetch_error = Fetch::FETCH_TYPE_ERROR_STRINGS
                .get(js_type)
                .copied()
                .unwrap_or(Fetch::FETCH_TYPE_ERROR_STRINGS[0]);
            let err = jsc::ErrorCode::INVALID_ARG_TYPE.fmt(ctx, format_args!("{}", fetch_error));
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(ctx, err),
            );
        };

        // Zig: `var request = Request.new(existing_request)` → raw
        // `*Request` (TrivialNew). `Request::to_js` stores `self as *mut
        // Request` into the JS wrapper, which adopts ownership and frees the
        // allocation in its GC finalizer. Relinquish the `Box` here so the
        // local going out of scope does not also drop it (double-free / UAF).
        let request: *mut Request = bun_core::heap::into_raw(existing_request);

        debug_assert!(self.config.on_request.is_some()); // confirmed above
        let global_this = self.global();
        let on_request = self.config.on_request.as_ref().unwrap().get();
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
                    ZigString::init(b"fetch() returned an empty value").to_error_instance(ctx),
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
    pub fn close_idle_connections(
        &mut self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.app.is_none() {
            return Ok(JSValue::UNDEFINED);
        }
        self.app_mut().close_idle_connections();
        Ok(JSValue::UNDEFINED)
    }

    pub fn stop_from_js(&mut self, abruptly: Option<JSValue>) -> JSValue {
        let rc = self.get_all_closed_promise(&self.global());

        if self.has_listener() {
            let abrupt = 'brk: {
                if let Some(val) = abruptly {
                    if val.is_boolean() && val.to_boolean() {
                        break 'brk true;
                    }
                }
                false
            };
            self.stop(abrupt);
        }

        rc
    }

    pub fn dispose_from_js(&mut self) -> JSValue {
        if self.has_listener() {
            self.stop(true);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_port(&self, _: &JSGlobalObject) -> JSValue {
        if matches!(self.config.address, server_config::Address::Unix(_)) {
            return JSValue::UNDEFINED;
        }

        if let Some(listener) = self.listener {
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            return JSValue::js_number(
                bun_opaque::opaque_deref_mut(listener).get_local_port() as f64
            );
        }
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener {
                // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                return JSValue::js_number(
                    bun_opaque::opaque_deref_mut(h3l).get_local_port() as f64
                );
            }
        }
        match &self.config.address {
            server_config::Address::Tcp { port, .. } => JSValue::js_number(*port as f64),
            server_config::Address::Unix(_) => unreachable!(),
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_id(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        jsc::bun_string_jsc::create_utf8_for_js(global, &self.config.id)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pending_requests(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number((self.pending_requests as u32 & 0x7FFF_FFFF) as i32 as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pending_web_sockets(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_number((self.active_sockets_count() as u32 & 0x7FFF_FFFF) as i32 as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_address(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.config.address {
            server_config::Address::Unix(unix) => {
                let value = BunString::clone_utf8(unix.as_bytes());
                // Zig: `defer value.deref();` — must release the cloned ref even
                // on the `to_js` error path.
                let value = scopeguard::guard(value, |v| v.deref());
                value.to_js(global)
            }
            server_config::Address::Tcp { port: tcp_port, .. } => {
                let mut port: u16 = *tcp_port;

                if let Some(listener) = self.listener {
                    // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
                    let listener = bun_opaque::opaque_deref_mut(listener);
                    port = u16::try_from(listener.get_local_port()).expect("int cast");

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
                        port = u16::try_from(h3l.get_local_port()).expect("int cast");
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
    pub fn get_url(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let mut url = self
            .get_url_as_string()
            .map_err(|_| global.throw_out_of_memory())?;
        // `to_jsdomurl` may throw (invalid URL → JS TypeError); deref the
        // backing string on both Ok/Err paths, then propagate.
        let r = bun_string_jsc::to_jsdomurl(&mut url, global);
        url.deref();
        r
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_hostname(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): narrow error set
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
                        return jsc::bun_string_jsc::create_utf8_for_js(global, addr);
                    }
                }
            }
            {
                match &self.config.address {
                    server_config::Address::Tcp { hostname, .. } => {
                        if let Some(hostname) = hostname {
                            return jsc::bun_string_jsc::create_utf8_for_js(
                                global,
                                hostname.as_bytes(),
                            );
                        } else {
                            return BunString::static_(b"localhost").to_js(global);
                        }
                    }
                    server_config::Address::Unix(_) => unreachable!(),
                }
            }
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_protocol(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let _ = self;
        if SSL {
            BunString::static_(b"https").to_js(global)
        } else {
            BunString::static_(b"http").to_js(global)
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_development(_this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(DEBUG)
    }

    pub fn finalize(self: Box<Self>) {
        httplog!("finalize");
        // `deinit_if_we_can` may defer the actual free (pending requests still
        // hold a ref), so hand ownership back to the raw teardown path.
        let this = bun_core::heap::release(self);
        this.js_value.finalize();
        this.deinit_if_we_can();
    }

    pub fn get_all_closed_promise(&mut self, global: &JSGlobalObject) -> JSValue {
        if !self.has_listener() && self.pending_requests == 0 {
            return JSPromise::resolved_promise(global, JSValue::UNDEFINED).to_js();
        }
        let prom = &mut self.all_closed_promise;
        if prom.has_value() {
            return prom.value();
        }
        *prom = jsc::JSPromiseStrong::init(global);
        prom.value()
    }

    // `notify_inspector_server_stopped` lives in the unbounded impl block
    // above so the unbounded `deinit()` (mod.rs) can call it.

    pub fn on_h3_request(&mut self, req: &mut uws::H3::Request, resp: &mut uws::H3::Response) {
        if !Self::HAS_H3 {
            unreachable!();
        }
        if self.config.on_request.is_none() {
            return Self::on_h3_404(self, req, resp);
        }
        self.on_request_for::<ServerH3RequestContext<SSL, DEBUG>>(req, resp);
    }

    pub fn on_h3_user_route_request(
        user_route: &mut UserRoute<SSL, DEBUG>,
        req: &mut uws::H3::Request,
        resp: &mut uws::H3::Response,
    ) {
        if !Self::HAS_H3 {
            unreachable!();
        }
        Self::on_user_route_request_for::<ServerH3RequestContext<SSL, DEBUG>>(
            user_route, req, resp,
        );
    }

    pub fn on_h3_404(_this: &mut Self, _req: &mut uws::H3::Request, resp: &mut uws::H3::Response) {
        if !Self::HAS_H3 {
            unreachable!();
        }
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(&mut self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.ref_();
        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(&mut self, _: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let this_value = callframe.this();
        self.unref();
        Ok(this_value)
    }

    pub fn on_bun_info_request(
        &mut self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        jsc::mark_binding!();
        self.pending_requests += 1;
        req.set_yield(false);
        // PERF(port): was stack-fallback alloc

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
        self.pending_requests -= 1;
    }

    // `on_chrome_dev_tools_json_request` is defined once below (next to
    // `on404`); a second copy here was a concurrent-port duplicate and has
    // been removed.

    fn on_user_route_request_for<Ctx: RequestCtxOps<Server = Self>>(
        user_route: &mut UserRoute<SSL, DEBUG>,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
    ) {
        // SAFETY: server backref outlives user_route
        let server_ptr = user_route.server.cast_mut();
        let server = unsafe { &mut *server_ptr };
        let index = user_route.id;

        let should_deinit_context = core::cell::Cell::new(false);
        let Some(mut prepared) = server.prepare_js_request_context_for::<Ctx>(
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::No,
            match user_route.route.method {
                server_config::RouteMethod::Any => None,
                server_config::RouteMethod::Specific(m) => Some(m),
            },
        ) else {
            return;
        };

        // SAFETY: `server_ptr` outlives `prepared`; reborrow to break the
        // exclusive lifetime tie between `prepared` and `server`.
        let server = unsafe { &mut *server_ptr };
        let server_request_list =
            Self::js_route_list_get_cached(server.js_value_assert_alive()).unwrap();
        let call_route = if Ctx::IS_H3 {
            Bun__ServerRouteList__callRouteH3
        } else {
            Bun__ServerRouteList__callRoute
        };
        let global = server.global_this();
        let response_value = match jsc::from_js_host_call(global, || {
            call_route(
                global,
                index,
                prepared.request_object,
                server.js_value_assert_alive(),
                server_request_list,
                &mut prepared.js_request,
                std::ptr::from_mut(req).cast::<c_void>(),
            )
        }) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        server.handle_request_for::<Ctx>(&should_deinit_context, prepared, req, response_value);
    }

    fn handle_request_for<Ctx: RequestCtxOps<Server = Self>>(
        &mut self,
        should_deinit_context: &core::cell::Cell<bool>,
        prepared: PreparedRequestFor<'_, Ctx>,
        req: &mut Ctx::Req,
        response_value: JSValue,
    ) {
        let ctx = prepared.ctx;
        let request_object_ptr: *mut Request = prepared.request_object;
        scopeguard::defer! {
            // uWS request will not live longer than this function
            // SAFETY: request_object outlives this stack frame (boxed on the request).
            unsafe { (*request_object_ptr).request_context.detach_request() };
        }

        RequestCtxOps::on_response(ctx, self, prepared.js_request, response_value);
        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        *RequestCtxOps::defer_deinit_ptr(ctx) = None;

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
        RequestCtxOps::to_async(ctx, req, prepared.request_object);
    }

    fn on_request_for<Ctx: RequestCtxOps<Server = Self>>(
        &mut self,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
    ) {
        let self_ptr: *mut Self = self;
        let should_deinit_context = core::cell::Cell::new(false);
        let Some(prepared) = self.prepare_js_request_context_for::<Ctx>(
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            CreateJsRequest::Yes,
            None,
        ) else {
            return;
        };

        // SAFETY: `prepared` borrows into `*self` but the fields touched below
        // (`config.on_request`, `global_this`, `js_value`) are disjoint from
        // the request/ctx allocations it references. Reborrow to satisfy NLL.
        let this = unsafe { &mut *self_ptr };
        debug_assert!(this.config.on_request.is_some());

        let global = this.global_this();
        let js_value = this.js_value_assert_alive();
        let on_request_fn = this
            .config
            .on_request
            .as_ref()
            .map(|s| s.get())
            .unwrap_or(JSValue::UNDEFINED);
        let response_value =
            match on_request_fn.call(global, js_value, &[prepared.js_request, js_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

        this.handle_request_for::<Ctx>(&should_deinit_context, prepared, req, response_value);
    }

    fn prepare_js_request_context_for<Ctx: RequestCtxOps<Server = Self>>(
        &mut self,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
        should_deinit_context: Option<DeferDeinitFlag>,
        create_js_request: CreateJsRequest,
        method: Option<http::Method>,
    ) -> Option<PreparedRequestFor<'_, Ctx>> {
        jsc::mark_binding!();

        // We need to register the handler immediately since uSockets will not buffer.
        //
        // We first validate the self-reported request body length so that
        // we avoid needing to worry as much about what memory to free.
        // RFC 9114 §4.2: an HTTP/3 message containing a transfer-encoding
        // header field is malformed.
        if Ctx::IS_H3 {
            if ReqLike::header(req, b"transfer-encoding").is_some() {
                RespLike::write_status(resp, b"400 Bad Request");
                RespLike::end_without_body(resp, false);
                return None;
            }
        }

        // Resolve once, reuse for both `has_request_body()` and the forward to
        // `Ctx::create`. Zig (server.zig:2438) parses inline at both sites and
        // forwards the unresolved `method` arg, so `create` parsed again.
        let method = method.or_else(|| http::Method::which(ReqLike::method(req)));

        let request_body_length: Option<usize> = 'request_body_length: {
            if method.unwrap_or(http::Method::OPTIONS).has_request_body() {
                let len: usize = 'brk: {
                    if let Some(content_length) = ReqLike::header(req, b"content-length") {
                        break 'brk bun_http_types::parse_content_length(content_length);
                    }
                    0
                };

                // Abort the request very early. For H3 a per-request error
                // is a stream error (RFC 9114 §4.1.2); close_connection
                // would CONNECTION_CLOSE every sibling stream on the conn.
                if len > self.config.max_request_body_size {
                    RespLike::write_status(resp, b"413 Request Entity Too Large");
                    RespLike::end_without_body(resp, !Ctx::IS_H3);
                    return None;
                }

                break 'request_body_length Some(len);
            }
            None
        };

        self.on_pending_request();

        // SAFETY: vm.event_loop() returns the live VM-owned `*mut EventLoop`.
        let _dbg_guard = unsafe {
            jsc::event_loop::Debug::enter_scope(core::ptr::addr_of_mut!(
                (*self.vm_ref().event_loop()).debug
            ))
        };
        ReqLike::set_yield(req, false);
        RespLike::timeout(resp, self.config.idle_timeout);

        // Since we do timeouts by default, we should tell the user when
        // this happens - but limit it to only warn once.
        if self.should_add_timeout_handler_for_warning() {
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

        let self_ptr: *const Self = self;
        // SAFETY: both allocators hand out `*mut RequestContext<_, SSL, DEBUG, _>`; the
        // const-bool H3 parameter only affects associated consts/types, not layout, so
        // reinterpreting the slot pointer as the caller's `Ctx` monomorphization is sound.
        //
        // `claim()` reserves the slot as a `HiveSlot`; `create_in` does
        // `MaybeUninit::write` placement-new through the slot's stable
        // address, after which `assume_init()` consumes the token.
        // `RequestContext` carries the heaviest drop glue in the codebase, so
        // a panic inside `create_in` (or `to_any_response`) now releases the
        // slot via `HiveSlot::drop` without running `RequestContext::drop` on
        // garbage.
        let ctx_slot: *mut Ctx = unsafe {
            if Ctx::IS_H3 {
                debug_assert!(
                    !self.h3_request_pool.is_null(),
                    "H3 request dispatched but h3_request_pool was never allocated (listen() H3 path not taken)"
                );
                let slot = (*self.h3_request_pool).claim();
                Ctx::create_in(
                    slot.addr().as_ptr().cast(),
                    self_ptr,
                    req,
                    resp,
                    should_deinit_context,
                    method,
                );
                // SAFETY: `create_in` fully initialized the slot via `MaybeUninit::write`.
                slot.assume_init().as_ptr().cast()
            } else {
                let slot = (*self.request_pool).claim();
                Ctx::create_in(
                    slot.addr().as_ptr().cast(),
                    self_ptr,
                    req,
                    resp,
                    should_deinit_context,
                    method,
                );
                // SAFETY: `create_in` fully initialized the slot via `MaybeUninit::write`.
                slot.assume_init().as_ptr().cast()
            }
        };
        // SAFETY: ctx_slot was just initialized by create_in.
        let ctx = unsafe { &mut *ctx_slot };
        // `VirtualMachine::jsc_vm()` is the safe accessor for the JSC VM
        // owned by the per-thread VirtualMachine.
        self.vm_ref()
            .jsc_vm()
            .deprecated_report_extra_memory(mem::size_of::<Ctx>());

        // `vm.initRequestBodyValue(.{ .Null = {} })` — typed wrapper over the
        // type-erased RuntimeHooks vtable. Returns `NonNull<HiveRef>` with
        // `ref_count = 1` (held by `ctx.request_body`).
        let body_hive = crate::webcore::body::hive_alloc(self.vm().as_mut(), BodyValue::Null);
        // SAFETY: hive_alloc returns a freshly-initialized hive slot; live until
        // its refcount drops to zero (released in `RequestContext::deinit` and
        // `Request::finalize`).
        let body_ptr: *mut BodyValue =
            unsafe { core::ptr::addr_of_mut!((*body_hive.as_ptr()).value) };
        ctx.set_request_body(NonNull::new(body_ptr));

        let signal = AbortSignal::new(&self.global());
        ctx.set_signal(signal);
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe deref.
        bun_opaque::opaque_deref_mut(signal).pending_activity_ref();

        // Zig: `.signal = signal.ref()` — bump once for the Request's owned
        // copy and adopt into RAII so it pairs with `Request::Drop`'s unref.
        // SAFETY: `signal` is live; `ref_()` returns the same non-null ptr +1.
        let signal_for_req = unsafe { jsc::AbortSignalRef::adopt((*signal).ref_()) };
        // Zig: `.body = body.ref()` — bump once so the JS Request shares the
        // same hive slot as `ctx.request_body` (streamed bytes buffered into
        // the ctx surface on `request.body`/`request.json()`). Paired with
        // `HiveRef::unref` in `Request::finalize`.
        // SAFETY: `body_hive` is live (ref_count >= 1).
        let body_for_req: NonNull<crate::webcore::body::HiveRef> =
            unsafe { NonNull::from((*body_hive.as_ptr()).ref_()) };
        let request_object_box = Request::new(Request::init(
            ctx.ctx_method(),
            AnyRequestContext::init(std::ptr::from_ref::<Ctx>(ctx)),
            SSL,
            Some(signal_for_req),
            body_for_req,
        ));
        let request_object: &mut Request =
            // SAFETY: leak so the ctx (which outlives this stack frame) can
            // hold the borrow; Request is freed via ctx.deinit's request_weakref.
            unsafe { &mut *bun_core::heap::into_raw(request_object_box) };
        ctx.set_request_weakref(request_object);

        // The lazy `getRequest()` path that backs Request.url / .headers
        // is `*uws.Request`-typed; for HTTP/3 we populate both eagerly so
        // the rest of the pipeline never needs to know which transport
        // delivered the bytes.
        if Ctx::IS_H3 {
            // SAFETY: create_from_h3 returns a +1-ref FetchHeaders; adopt into RAII wrapper.
            request_object.set_fetch_headers(Some(unsafe {
                crate::webcore::response::HeadersRef::adopt(FetchHeaders::create_from_h3(
                    std::ptr::from_mut(req).cast::<c_void>(),
                ))
            }));
            // PORT NOTE: `ReqLike::{url,header}` both borrow `&mut req`; the
            // returned slices alias the same uWS-owned header buffer. Snapshot
            // `host` into an owned buffer first so the second borrow for `url`
            // is unconflicted.
            let host: Option<Vec<u8>> = ReqLike::header(req, b"host").map(|h| h.to_vec());
            let path = ReqLike::url(req);
            if !path.is_empty() && path[0] == b'/' {
                if let Some(host) = host.as_deref() {
                    let fmt = bun_fmt::HostFormatter {
                        is_https: true,
                        host,
                        port: None,
                    };
                    let mut s = Vec::new();
                    write!(&mut s, "https://{}{}", fmt, BStr::new(path)).ok();
                    request_object.url.set(BunString::clone_utf8(&s));
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
            let is_te = ReqLike::header(req, b"transfer-encoding").is_some();
            ctx.set_is_transfer_encoding(is_te);
            // HTTP/3 (RFC 9114 §4.2.2): Content-Length is optional and
            // Transfer-Encoding is forbidden; the body is terminated by
            // the QUIC stream FIN, so always arm onData for body methods.
            if req_len > 0 || is_te || Ctx::IS_H3 {
                // we defer pre-allocating the body until we receive the first chunk
                // that way if the client is lying about how big the body is or the client aborts
                // we don't waste memory
                if let Some(body) = ctx.request_body_mut() {
                    *body = BodyValue::Locked(crate::webcore::body::PendingValue {
                        task: Some(ctx_slot.cast::<c_void>()),
                        global: self.global_this,
                        on_start_buffering: Some(Ctx::on_start_buffering_callback),
                        on_start_streaming: Some(Ctx::on_start_streaming_request_body_callback),
                        on_readable_stream_available: Some(
                            Ctx::on_request_body_readable_stream_available,
                        ),
                        ..Default::default()
                    });
                }
                ctx.set_is_waiting_for_request_body(true);
                ctx.arm_on_data(resp);
            }
        }

        Some(PreparedRequestFor {
            js_request: match create_js_request {
                CreateJsRequest::Yes => request_object.to_js(&self.global()),
                CreateJsRequest::Bake => match request_object.to_js_for_bake(&self.global()) {
                    Ok(v) => v,
                    Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                    Err(_) => return None,
                },
                CreateJsRequest::No => JSValue::ZERO,
            },
            request_object,
            ctx,
        })
    }

    fn upgrade_web_socket_user_route(
        this: &mut UserRoute<SSL, DEBUG>,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws::Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        method: Option<http::Method>,
    ) {
        // BACKREF: `UserRoute.server` is set at construction from the owning
        // `NewServer` (which outlives every `UserRoute` in its `user_routes`
        // vec); non-null by invariant.
        let server_ref = bun_ptr::BackRef::from(
            NonNull::new(this.server.cast_mut()).expect("UserRoute.server set at construction"),
        );
        let server_ptr = server_ref.as_ptr();
        let index = this.id;

        let should_deinit_context = core::cell::Cell::new(false);
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
        unsafe { (*prepared.ctx).upgrade_context = Some(upgrade_ctx) };
        // BACKREF: `server_ref` outlives this request (see decl above).
        let server_js = server_ref.js_value_assert_alive();
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
            prepared,
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
    pub unsafe fn on_web_socket_upgrade(
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
            // intermediate `&mut Self` was ever created.
            let user_route = unsafe { &mut *this.cast::<UserRoute<SSL, DEBUG>>() };
            Self::upgrade_web_socket_user_route(user_route, resp, req, upgrade_ctx, None);
            return;
        }
        // Access `this` as *ThisServer only if id is 0
        debug_assert!(id == 0);
        let self_ptr: *mut Self = this;
        // SAFETY: for `id == 0` the registered user-data IS `*mut Self`
        // (mod.rs `app.ws("/*", self_ptr, 0, ..)`); live for the request's
        // duration.
        let this = unsafe { &mut *self_ptr };
        if this.config.on_node_http_request.is_some() {
            // PORT NOTE: receiver is `*mut Self` (mod.rs) — the callee re-enters
            // JS, so a long-lived `&mut self` here would alias on callback.
            Self::on_node_http_request_with_upgrade_ctx(self_ptr, req, resp, upgrade_ctx);
            return;
        }
        if this.config.on_request.is_none() {
            // require fetch method to be set otherwise we dont know what route to call
            // this should be the fallback in case no route is provided to upgrade
            resp.write_status(b"403 Forbidden");
            resp.end_without_body(true);
            return;
        }
        this.pending_requests += 1;
        req.set_yield(false);
        // SAFETY: pointer is non-null and owns a fresh pool slot.
        let ctx_slot = unsafe { (*this.request_pool).get() };
        let should_deinit_context = core::cell::Cell::new(false);
        <ServerRequestContext<SSL, DEBUG> as RequestCtxOps>::create_in(
            ctx_slot,
            self_ptr,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
            None,
        );
        // SAFETY: ctx_slot was just initialized by create_in.
        let ctx = unsafe { &mut *ctx_slot };

        let body_hive = crate::webcore::body::hive_alloc(this.vm().as_mut(), BodyValue::Null);
        // SAFETY: hive_alloc returns a freshly-initialized hive slot; live until
        // its refcount drops to zero.
        let body_ptr: *mut BodyValue =
            unsafe { core::ptr::addr_of_mut!((*body_hive.as_ptr()).value) };
        ctx.request_body = NonNull::new(body_ptr);

        let signal = AbortSignal::new(&this.global());
        // Zig: `ctx.signal = signal; signal.pendingActivityRef();` — the
        // RequestContext owns one ref so aborts during the WS-upgrade fallback
        // fetch path propagate.
        ctx.signal = NonNull::new(signal);
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe deref.
        bun_opaque::opaque_deref_mut(signal).pending_activity_ref();
        // Zig: `.signal = signal.ref()` — bump once for the Request's copy and
        // adopt into RAII so it pairs with `Request::Drop`'s unref.
        // SAFETY: `signal` is live; `ref_()` returns the same non-null ptr +1.
        let signal_for_req = unsafe { jsc::AbortSignalRef::adopt((*signal).ref_()) };
        // Zig: `.body = body.ref()` — bump once so the JS Request shares the
        // same hive slot as `ctx.request_body`. Paired unref in
        // `Request::finalize`.
        // SAFETY: `body_hive` is live (ref_count >= 1).
        let body_for_req: NonNull<crate::webcore::body::HiveRef> =
            unsafe { NonNull::from((*body_hive.as_ptr()).ref_()) };
        let request_object_box = Request::new(Request::init(
            ctx.method,
            AnyRequestContext::init(std::ptr::from_ref(ctx)),
            SSL,
            Some(signal_for_req),
            body_for_req,
        ));
        ctx.upgrade_context = Some(upgrade_ctx);
        let request_object: &mut Request =
            // SAFETY: leaked so the ctx (which outlives this stack frame) can
            // hold the borrow; freed via ctx.deinit's request_weakref.
            unsafe { &mut *bun_core::heap::into_raw(request_object_box) };
        ctx.request_weakref = bun_ptr::WeakPtr::<Request>::init_ref(request_object);

        // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
        let global = this.global();
        let args = [request_object.to_js(&global), this.js_value_assert_alive()];
        let request_value = args[0];
        request_value.ensure_still_alive();

        let response_value = match this.config.on_request.as_ref().unwrap().get().call(
            &global,
            this.js_value_assert_alive(),
            &args,
        ) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };
        let request_object_ptr: *mut Request = request_object;
        scopeguard::defer! {
            // uWS request will not live longer than this function
            // SAFETY: see request_object above.
            unsafe { (*request_object_ptr).request_context.detach_request() };
        }

        // SAFETY: self_ptr is live for the request's duration; the &mut held
        // by ctx.create's BACKREF aliases disjoint fields.
        ctx.on_response(unsafe { &*self_ptr }, request_value, response_value);

        ctx.defer_deinit_until_callback_completes = None;

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
            request_object,
        );
    }

    // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
    pub(super) fn on_chrome_dev_tools_json_request(
        &mut self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        if cfg!(debug_assertions) {
            // PORT NOTE: scoped_log! expands each arg twice (ANSI/no-ANSI branches);
            // copy to owned buffers so the two `&req` borrows in the expansion
            // don't overlap with the returned slice lifetimes.
            let m = req.method().to_vec();
            let u = req.url().to_vec();
            httplog!("{} - {}", BStr::new(&m), BStr::new(&u));
        }

        let authorized = 'brk: {
            if self.dev_server.is_none() {
                break 'brk false;
            }

            if let Some(address) = resp.get_remote_socket_info() {
                // IPv4 loopback addresses
                if address.ip.starts_with(b"127.") {
                    break 'brk true;
                }
                // IPv6 loopback addresses
                if address.ip.starts_with(b"::ffff:127.")
                    || address.ip.starts_with(b"::1")
                    || address.ip == b"0:0:0:0:0:0:0:1"
                {
                    break 'brk true;
                }
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
        write!(
            &mut json_string,
            "{{ \"workspace\": {{ \"root\": {}, \"uuid\": \"{}\" }} }}",
            bun_fmt::format_json_string_utf8(
                &self.dev_server.as_ref().unwrap().root,
                Default::default()
            ),
            uuid,
        )
        .ok();

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", b"application/json");
        resp.end(&json_string, resp.should_close_connection());
    }

    pub fn on404(
        _this: &mut Self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        if cfg!(debug_assertions) {
            // PORT NOTE: see on_chrome_dev_tools_json_request — scoped_log! double-evaluates args.
            let m = req.method().to_vec();
            let u = req.url().to_vec();
            httplog!("{} - {} 404", BStr::new(&m), BStr::new(&u));
        }

        resp.write_status(b"404 Not Found");

        // Rely on browser default page for now.
        resp.end(b"", false);
    }

    pub fn on_client_error_callback(
        &mut self,
        socket: &mut uws::Socket,
        error_code: u8,
        raw_packet: &[u8],
    ) {
        let Some(callback) = self.on_clienterror.get() else {
            return;
        };
        {
            let is_ssl = SSL;
            let global = self.global();
            let node_socket = match jsc::from_js_host_call(&global, || {
                Bun__createNodeHTTPServerSocketForClientError(
                    is_ssl,
                    std::ptr::from_mut(socket).cast::<c_void>(),
                    &global,
                )
            }) {
                Ok(v) => v,
                Err(_) => return,
            };
            if node_socket.is_undefined_or_null() {
                return;
            }

            let error_code_value = JSValue::js_number(error_code as f64);
            let raw_packet_value = match ArrayBuffer::create_buffer(&global, raw_packet) {
                Ok(v) => v,
                Err(_) => return, // TODO: properly propagate exception upwards
            };
            // SAFETY: event_loop() returns a live raw pointer tied to the global.
            let _scope =
                unsafe { jsc::event_loop::EventLoop::enter_scope(global.bun_vm().event_loop()) };
            if let Err(err) = callback.call(
                &global,
                JSValue::UNDEFINED,
                &[
                    JSValue::from(is_ssl),
                    node_socket,
                    error_code_value,
                    raw_packet_value,
                ],
            ) {
                global.report_active_exception_as_unhandled(err);
            }
        }
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

pub enum AnyUserRouteList<'a> {
    HTTPServer(&'a [UserRoute<false, false>]),
    HTTPSServer(&'a [UserRoute<true, false>]),
    DebugHTTPServer(&'a [UserRoute<false, true>]),
    DebugHTTPSServer(&'a [UserRoute<true, true>]),
}

// ─── Exported fns ────────────────────────────────────────────────────────────
#[unsafe(no_mangle)]
pub extern "C" fn Server__setIdleTimeout(
    server: JSValue,
    seconds: JSValue,
    global: &JSGlobalObject,
) {
    match server_set_idle_timeout_(server, seconds, global) {
        Ok(()) => {}
        Err(JsError::Thrown) => {}
        Err(JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory_value();
        }
        Err(JsError::Terminated) => {}
    }
}

pub fn server_set_idle_timeout_(
    server: JSValue,
    seconds: JSValue,
    global: &JSGlobalObject,
) -> JsResult<()> {
    if !server.is_object() {
        return Err(global.throw(format_args!(
            "Failed to set timeout: The 'this' value is not a Server."
        )));
    }

    if !seconds.is_number() {
        return Err(global.throw(format_args!(
            "Failed to set timeout: The provided value is not of type 'number'."
        )));
    }
    let value = seconds.to_u32();
    // SAFETY: as_ returned a non-null *mut to a live server.
    if let Some(this) = server.as_::<HTTPServer>() {
        unsafe { &mut *this }.set_idle_timeout(value);
    } else if let Some(this) = server.as_::<HTTPSServer>() {
        unsafe { &mut *this }.set_idle_timeout(value);
    } else if let Some(this) = server.as_::<DebugHTTPServer>() {
        unsafe { &mut *this }.set_idle_timeout(value);
    } else if let Some(this) = server.as_::<DebugHTTPSServer>() {
        unsafe { &mut *this }.set_idle_timeout(value);
    } else {
        return Err(global.throw(format_args!(
            "Failed to set timeout: The 'this' value is not a Server."
        )));
    }
    Ok(())
}

pub fn server_set_on_client_error_(
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
            if let Some(this) = server.as_::<$T>() {
                // SAFETY: as_ returned a non-null *mut to a live server.
                let this = unsafe { &mut *this };
                if let Some(app) = this.app {
                    this.on_clienterror.deinit();
                    this.on_clienterror = StrongOptional::create(callback, global);
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
                        // uWS socket; raw_packet/raw_packet_len describe a valid (possibly empty) buffer.
                        let this = unsafe { &mut *user_data.cast::<$T>() };
                        let packet: &[u8] = if raw_packet_len > 0 {
                            unsafe { bun_core::ffi::slice(raw_packet, raw_packet_len as usize) }
                        } else {
                            &[]
                        };
                        // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                        this.on_client_error_callback(bun_opaque::opaque_deref_mut(socket), error_code, packet);
                    }
                    // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(app).on_client_error(thunk, core::ptr::from_mut::<$T>(this).cast::<c_void>());
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

pub fn server_set_app_flags_(
    global: &JSGlobalObject,
    server: JSValue,
    require_host_header: bool,
    use_strict_method_validation: bool,
) -> JsResult<JSValue> {
    if !server.is_object() {
        return Err(global.throw(format_args!(
            "Failed to set requireHostHeader: The 'this' value is not a Server."
        )));
    }

    // SAFETY: as_ returned a non-null *mut to a live server.
    if let Some(this) = server.as_::<HTTPServer>() {
        unsafe { &mut *this }.set_flags(require_host_header, use_strict_method_validation);
    } else if let Some(this) = server.as_::<HTTPSServer>() {
        unsafe { &mut *this }.set_flags(require_host_header, use_strict_method_validation);
    } else if let Some(this) = server.as_::<DebugHTTPServer>() {
        unsafe { &mut *this }.set_flags(require_host_header, use_strict_method_validation);
    } else if let Some(this) = server.as_::<DebugHTTPSServer>() {
        unsafe { &mut *this }.set_flags(require_host_header, use_strict_method_validation);
    } else {
        return Err(global.throw(format_args!(
            "Failed to set timeout: The 'this' value is not a Server."
        )));
    }
    Ok(JSValue::UNDEFINED)
}

pub fn server_set_max_http_header_size_(
    global: &JSGlobalObject,
    server: JSValue,
    max_header_size: u64,
) -> JsResult<JSValue> {
    if !server.is_object() {
        return Err(global.throw(format_args!(
            "Failed to set maxHeaderSize: The 'this' value is not a Server."
        )));
    }

    // SAFETY: as_ returned a non-null *mut to a live server.
    if let Some(this) = server.as_::<HTTPServer>() {
        unsafe { &mut *this }.set_max_http_header_size(max_header_size);
    } else if let Some(this) = server.as_::<HTTPSServer>() {
        unsafe { &mut *this }.set_max_http_header_size(max_header_size);
    } else if let Some(this) = server.as_::<DebugHTTPServer>() {
        unsafe { &mut *this }.set_max_http_header_size(max_header_size);
    } else if let Some(this) = server.as_::<DebugHTTPSServer>() {
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
// Zig's `wrap{3,4}` emits `callconv(.c)` and the C++ declarations in
// NodeHTTP.cpp are bare `extern "C"` with no `SYSV_ABI`, so on Windows the
// caller uses Win64 ABI. Using `host_call` here forced sysv64 on the Rust
// side, scrambling the `server` argument and tripping the `is_object()` guard.
#[unsafe(export_name = "Server__setAppFlags")]
extern "C" fn server_set_app_flags_shim(
    global: &JSGlobalObject,
    server: JSValue,
    require_host_header: bool,
    use_strict_method_validation: bool,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        server_set_app_flags_(
            global,
            server,
            require_host_header,
            use_strict_method_validation,
        ),
    )
}

#[unsafe(export_name = "Server__setOnClientError")]
extern "C" fn server_set_on_client_error_shim(
    global: &JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        server_set_on_client_error_(global, server, callback),
    )
}

#[unsafe(export_name = "Server__setMaxHTTPHeaderSize")]
extern "C" fn server_set_max_http_header_size_shim(
    global: &JSGlobalObject,
    server: JSValue,
    max_header_size: u64,
) -> JSValue {
    host_fn::to_js_host_fn_result(
        global,
        server_set_max_http_header_size_(global, server, max_header_size),
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
    // `uws::Socket*` handed to `on_client_error_callback` by the uws dispatcher.
    safe fn Bun__createNodeHTTPServerSocketForClientError(
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
        paths: *mut ZigString,
        paths_length: usize,
    ) -> JSValue;

    safe fn NodeHTTP_assignOnNodeJSCompat(ssl: bool, app: *mut c_void);
    safe fn NodeHTTP_setUsingCustomExpectHandler(ssl: bool, app: *mut c_void, value: bool);
}
