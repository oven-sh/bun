//! Port of src/runtime/server/server.zig

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_aio::{KeepAlive, Loop as AsyncLoop};
use bun_alloc::AllocError;
use bun_boringssl as boringssl;
use bun_collections::{HashMap, TaggedPtrUnion};
use bun_core::{self as core_, analytics, fmt as bun_fmt, Global, Output};
use bun_http::{self as http, Method, MimeType};
use bun_http_jsc::method_jsc::MethodJsc as _;
use bun_jsc::{
    self as jsc, host_fn, ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSValue, JsError,
    JsRef, JsResult, Node, StringJsc as _, Strong, StrongOptional, SysErrorJsc as _, SystemError,
    VirtualMachine,
};
use crate::webcore::{self as WebCore, AbortSignal, AnyBlob, Blob, Body, CookieMap, FetchHeaders, Request, Response};
use crate::webcore::fetch as Fetch;
use bun_jsc::Debugger::{AsyncTaskTracker, DebuggerId};
use bun_jsc::{StringJsc as _, ZigStringJsc as _};
use crate::api::{js_bundler as JSBundler, SocketAddress};
use crate::api::js_bundler::PluginJscExt as _;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::response::HeadersRef;
use bun_logger as logger;
use bun_paths as paths;
use bun_ptr::{IntrusiveRc, RefPtr};
use bun_str::{self as bstr, strings, String as BunString, ZStr, ZigString};
use bun_sys as sys;
use bun_url::URL;
use bun_uws::{self as uws, AnyResponse, AnyWebSocket, Opcode, ResponseKind, WebSocketUpgradeContext};
use bun_uws_sys as uws_sys;
use crate::bake::{self as bake};
use crate::bake::dev_server::{self as dev_server_mod, DevServer};
use crate::bake::framework_router as FrameworkRouter;
use bun_paths::fs::FileSystem;
use bun_standalone_graph::StandaloneModuleGraph;
use bun_jsc::uuid::UUID;
use bun_wyhash::hash;
use ::bstr::BStr;

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
pub use super::web_socket_server_context::WebSocketServerContext;
pub use super::http_status_text as HTTPStatusText;
pub use super::html_bundle::{self as html_bundle, HTMLBundle};
// TODO: rename to StaticBlobRoute? the html bundle is sometimes a static route
pub use super::static_route::StaticRoute;
pub use super::file_route::FileRoute;
pub use super::file_response_stream::FileResponseStream;
pub use super::range_request as RangeRequest;
pub use super::server_config::{self as server_config, ServerConfig};
pub use super::server_web_socket::ServerWebSocket;
pub use super::node_http_response::NodeHTTPResponse;
pub use super::any_request_context::AnyRequestContext;
pub use super::request_context::RequestContext as NewRequestContext;

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
        should_deinit_context: Option<*mut bool>,
        method: Option<http::Method>,
    );
    fn on_response(&mut self, server: &Self::Server, request_value: JSValue, response_value: JSValue);
    fn deinit(&mut self);
    fn should_render_missing(&self) -> bool;
    fn render_missing(&mut self);
    fn to_async(&mut self, req: &mut Self::Req, request_object: &mut Request);
    fn ctx_method(&self) -> http::Method;
    fn set_upgrade_context(&mut self, ctx: Option<*mut WebSocketUpgradeContext>);
    fn defer_deinit_ptr(&mut self) -> &mut Option<*mut bool>;
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
    fn on_request_body_readable_stream_available(this: *mut c_void, stream: JSValue);
}

impl<ThisServer, const SSL: bool, const DBG: bool, const H3: bool> RequestCtxOps
    for NewRequestContext<ThisServer, SSL, DBG, H3>
where
    Self: RequestCtx,
    ThisServer: super::ServerLike + 'static,
    super::request_context::TransportFor<SSL, H3>: super::request_context::Transport,
    Self: crate::api::native_promise_context::NativePromiseContextType
        + super::request_context::RequestContextHostFns,
{
    type Server = ThisServer;
    #[inline]
    fn create_in(
        slot: *mut Self,
        server: *const ThisServer,
        req: &mut Self::Req,
        resp: &mut Self::Resp,
        should_deinit_context: Option<*mut bool>,
        method: Option<http::Method>,
    ) {
        // SAFETY: `slot` points at a fresh HiveArray pool entry; treat as
        // MaybeUninit for in-place construction.
        let slot = unsafe { &mut *(slot as *mut core::mem::MaybeUninit<Self>) };
        let any_resp = RespLike::to_any_response(resp);
        Self::create(slot, server, req as *mut _ as *mut _, any_resp, should_deinit_context, method);
    }
    #[inline]
    fn on_response(&mut self, server: &ThisServer, rq: JSValue, rv: JSValue) { Self::on_response(self, server, rq, rv) }
    #[inline]
    fn deinit(&mut self) { Self::deinit(self) }
    #[inline]
    fn should_render_missing(&self) -> bool { Self::should_render_missing(self) }
    #[inline]
    fn render_missing(&mut self) { Self::render_missing(self) }
    #[inline]
    fn to_async(&mut self, req: &mut Self::Req, ro: &mut Request) { Self::to_async(self, req as *mut _ as *mut _, ro) }
    #[inline]
    fn ctx_method(&self) -> http::Method { self.method }
    #[inline]
    fn set_upgrade_context(&mut self, c: Option<*mut WebSocketUpgradeContext>) { self.upgrade_context = c }
    #[inline]
    fn defer_deinit_ptr(&mut self) -> &mut Option<*mut bool> { &mut self.defer_deinit_until_callback_completes }
    #[inline]
    fn set_request_body(&mut self, body: Option<NonNull<BodyValue>>) { self.request_body = body }
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
        // and pairs the unref in RequestContext cleanup (`shim::signal_unref`).
        self.signal = NonNull::new(sig);
    }
    #[inline]
    fn set_request_weakref(&mut self, req: *mut Request) {
        // SAFETY: req is a freshly-boxed Request; live for the request duration.
        self.request_weakref = bun_ptr::WeakPtr::<Request>::init_ref(unsafe { &mut *req });
    }
    #[inline]
    fn clear_req(&mut self) { self.req = None }
    #[inline]
    fn set_is_web_browser_navigation(&mut self, v: bool) { self.flags.set_is_web_browser_navigation(v) }
    #[inline]
    fn set_request_body_content_len(&mut self, len: usize) { self.request_body_content_len = len }
    #[inline]
    fn set_is_transfer_encoding(&mut self, v: bool) { self.flags.set_is_transfer_encoding(v) }
    #[inline]
    fn set_is_waiting_for_request_body(&mut self, v: bool) { self.flags.set_is_waiting_for_request_body(v) }
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
            super::request_context::TransportFor<SSL_, H3_>: super::request_context::Transport,
            NewRequestContext<S, SSL_, DBG_, H3_>:
                crate::api::native_promise_context::NativePromiseContextType
                    + super::request_context::RequestContextHostFns,
        {
            NewRequestContext::<S, SSL_, DBG_, H3_>::on_buffered_body_chunk(ctx, chunk, last);
        }
        RespLike::to_any_response(resp).on_data(handler::<ThisServer, SSL, DBG, H3>, self as *mut Self);
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
    fn on_request_body_readable_stream_available(this: *mut c_void, stream: JSValue) {
        Self::on_request_body_readable_stream_available(this, stream)
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
    #[inline] fn header(&mut self, name: &[u8]) -> Option<&[u8]> { uws_sys::Request::header(self, name) }
    #[inline] fn method(&mut self) -> &[u8] { uws_sys::Request::method(self) }
    #[inline] fn url(&mut self) -> &[u8] { uws_sys::Request::url(self) }
    #[inline] fn set_yield(&mut self, y: bool) { uws_sys::Request::set_yield(self, y) }
}
impl ReqLike for uws_sys::h3::Request {
    #[inline] fn header(&mut self, name: &[u8]) -> Option<&[u8]> { uws_sys::h3::Request::header(self, name) }
    #[inline] fn method(&mut self) -> &[u8] { uws_sys::h3::Request::method(self) }
    #[inline] fn url(&mut self) -> &[u8] { uws_sys::h3::Request::url(self) }
    #[inline] fn set_yield(&mut self, y: bool) { uws_sys::h3::Request::set_yield(self, y) }
}

pub trait RespLike {
    fn write_status(&mut self, status: &[u8]);
    fn end_without_body(&mut self, close_connection: bool);
    fn timeout(&mut self, seconds: u8);
    fn on_timeout_warn(&mut self, ud: *mut c_void);
    fn to_any_response(&mut self) -> uws::AnyResponse;
}
impl<const SSL: bool> RespLike for uws_sys::NewAppResponse<SSL> {
    #[inline] fn write_status(&mut self, s: &[u8]) { uws_sys::NewAppResponse::<SSL>::write_status(self, s) }
    #[inline] fn end_without_body(&mut self, c: bool) { uws_sys::NewAppResponse::<SSL>::end_without_body(self, c) }
    #[inline] fn timeout(&mut self, s: u8) { uws_sys::NewAppResponse::<SSL>::timeout(self, s) }
    #[inline] fn on_timeout_warn(&mut self, ud: *mut c_void) {
        // The dev-mode idle-timeout warning ignores both args; the user-data
        // pointer is an opaque sentinel (any non-null value satisfies uWS).
        uws_sys::NewAppResponse::<SSL>::on_timeout(
            self,
            |_: *mut c_void, _: &mut uws_sys::NewAppResponse<SSL>| on_timeout_for_idle_warn(),
            ud,
        );
    }
    #[inline] fn to_any_response(&mut self) -> uws::AnyResponse {
        // SAFETY: NewAppResponse<true>/NewAppResponse<false> are the only two
        // monomorphizations; cast through the matching `From` arm. The const
        // bool is checked at compile time so only one branch is reachable.
        if SSL {
            uws::AnyResponse::from(self as *mut Self as *mut uws_sys::NewAppResponse<true>)
        } else {
            uws::AnyResponse::from(self as *mut Self as *mut uws_sys::NewAppResponse<false>)
        }
    }
}
impl RespLike for uws_sys::h3::Response {
    #[inline] fn write_status(&mut self, s: &[u8]) { uws_sys::h3::Response::write_status(self, s) }
    #[inline] fn end_without_body(&mut self, c: bool) { uws_sys::h3::Response::end_without_body(self, c) }
    #[inline] fn timeout(&mut self, s: u8) { uws_sys::h3::Response::timeout(self, s) }
    #[inline] fn on_timeout_warn(&mut self, ud: *mut c_void) {
        uws_sys::h3::Response::on_timeout(
            self,
            |_: &mut c_void, _: &mut uws_sys::h3::Response| on_timeout_for_idle_warn(),
            ud,
        );
    }
    #[inline] fn to_any_response(&mut self) -> uws::AnyResponse { uws::AnyResponse::from(self as *mut Self) }
}

// Local shim: `SystemError` lives upstream and lacks `Default`; this builds the
// Zig field-default shape (`errno=0`, `fd=c_int::MIN`, strings empty).
#[inline]
fn system_error_default() -> SystemError {
    SystemError {
        errno: 0,
        code: BunString::empty(),
        message: BunString::empty(),
        path: BunString::empty(),
        syscall: BunString::empty(),
        hostname: BunString::empty(),
        fd: c_int::MIN,
        dest: BunString::empty(),
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
)
where
    H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
{
    debug_assert_eq!(core::mem::size_of::<H>(), 0, "handler must be a ZST fn item");
    // SAFETY: H is a zero-sized fn item — conjuring it is sound; ud/req/res
    // were registered by the matching `*_ctx` call below and outlive the route.
    let h: H = unsafe { core::mem::zeroed() };
    let ctx = unsafe { &mut *(ud as *mut T) };
    let req = unsafe { &mut *(req as *mut uws::Request) };
    let resp = unsafe { &mut *(res as *mut uws_sys::NewAppResponse<SSL>) };
    h(ctx, req, resp);
}

impl<const SSL: bool> AppRouteExt<SSL> for uws_sys::NewApp<SSL> {
    fn get_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.get(pattern, Some(_route_tramp::<T, H, SSL>), ctx as *mut c_void);
    }
    fn head_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.head(pattern, Some(_route_tramp::<T, H, SSL>), ctx as *mut c_void);
    }
    fn any_ctx<T, H>(&mut self, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.any(pattern, Some(_route_tramp::<T, H, SSL>), ctx as *mut c_void);
    }
    fn method_ctx<T, H>(&mut self, m: http::Method, pattern: &[u8], ctx: *mut T, _h: H)
    where
        H: Fn(&mut T, &mut uws::Request, &mut uws_sys::NewAppResponse<SSL>) + Copy + 'static,
    {
        self.method(m, pattern, Some(_route_tramp::<T, H, SSL>), ctx as *mut c_void);
    }
}

pub type ServerRequestContext<const SSL: bool, const DEBUG: bool> =
    NewRequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, false>;
pub type ServerH3RequestContext<const SSL: bool, const DEBUG: bool> =
    NewRequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, true>;
pub type ServerPreparedRequest<'a, const SSL: bool, const DEBUG: bool> =
    PreparedRequestFor<'a, ServerRequestContext<SSL, DEBUG>>;

// `TypeList` impl for `AnyServer`'s `TaggedPtrUnion` (Zig comptime reflection).
// PORT NOTE: local marker struct so `TypeList`/`UnionMember` impls satisfy
// orphan rules — `bun_ptr::impl_tagged_ptr_union!` would impl on a tuple,
// which is foreign even when every element is local.
pub struct AnyServerTypes;
impl bun_ptr::tagged_pointer::TypeList for AnyServerTypes {
    const LEN: usize = 4;
    const MIN_TAG: bun_ptr::tagged_pointer::TagType = 1024 - 3;
    fn type_name_from_tag(tag: bun_ptr::tagged_pointer::TagType) -> Option<&'static str> {
        match tag {
            1024 => Some("HTTPServer"),
            1023 => Some("HTTPSServer"),
            1022 => Some("DebugHTTPServer"),
            1021 => Some("DebugHTTPSServer"),
            _ => None,
        }
    }
}
impl bun_ptr::tagged_pointer::UnionMember<AnyServerTypes> for HTTPServer {
    const TAG: bun_ptr::tagged_pointer::TagType = 1024;
    const NAME: &'static str = "HTTPServer";
}
impl bun_ptr::tagged_pointer::UnionMember<AnyServerTypes> for HTTPSServer {
    const TAG: bun_ptr::tagged_pointer::TagType = 1023;
    const NAME: &'static str = "HTTPSServer";
}
impl bun_ptr::tagged_pointer::UnionMember<AnyServerTypes> for DebugHTTPServer {
    const TAG: bun_ptr::tagged_pointer::TagType = 1022;
    const NAME: &'static str = "DebugHTTPServer";
}
impl bun_ptr::tagged_pointer::UnionMember<AnyServerTypes> for DebugHTTPSServer {
    const TAG: bun_ptr::tagged_pointer::TagType = 1021;
    const NAME: &'static str = "DebugHTTPSServer";
}

// ─── BunInfo (CYCLEBREAK move-in from bun_core::Global) ──────────────────────
// Spec: src/bun_core/Global.zig:195-210. `generate()` builds the struct and
// hands it to `JSON.toAST`, which reflects over fields at comptime. Rust has no
// `@typeInfo`, so this is the hand-expanded reflection output (cf.
// `bun_interchange::json::ToAst` derive sketch, json.rs:808-824): an `E.Object`
// with `bun_version` (string) + `platform` (nested `E.Object` of `os`/`arch`/
// `version`, enums emitted as `@tagName` strings).
pub mod BunInfo {
    use bun_analytics::generate_header::generate_platform;
    use bun_analytics::schema::analytics::{Architecture, OperatingSystem, Platform};
    use bun_core::Global;
    use bun_js_parser::ast::e::EString;
    use bun_js_parser::{Expr, E, G};
    use bun_logger::Loc;

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
        let platform_props: Vec<G::Property> = vec![
            prop(b"os", str_expr(os_tag_name(info.platform.os))),
            prop(b"arch", str_expr(arch_tag_name(info.platform.arch))),
            prop(b"version", str_expr(info.platform.version)),
        ];
        let platform_expr = Expr::init(
            E::Object {
                properties: G::PropertyList::move_from_list(platform_props),
                is_single_line: false,
                ..E::Object::default()
            },
            Loc::EMPTY,
        );

        let root_props: Vec<G::Property> = vec![
            prop(b"bun_version", str_expr(info.bun_version)),
            prop(b"platform", platform_expr),
        ];
        Ok(Expr::init(
            E::Object {
                properties: G::PropertyList::move_from_list(root_props),
                is_single_line: false,
                ..E::Object::default()
            },
            Loc::EMPTY,
        ))
    }
}

// ─── write_status ────────────────────────────────────────────────────────────
pub fn write_status<const SSL: bool>(resp_ptr: Option<&mut uws_sys::NewAppResponse<SSL>>, status: u16) {
    if let Some(resp) = resp_ptr {
        if let Some(text) = HTTPStatusText::get(status) {
            resp.write_status(text);
        } else {
            let mut status_text_buf = [0u8; 48];
            let mut cursor = &mut status_text_buf[..];
            write!(cursor, "{} HM", status).expect("unreachable");
            let written = 48 - cursor.len();
            resp.write_status(&status_text_buf[..written]);
        }
    }
}

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

        let Some(path_js) = argument.get(init_ctx.global, b"path")? else { return Ok(None); };
        let mut path_string = BunString::from_js(path_js, init_ctx.global)?;
        let _path_string_guard = scopeguard::guard((), |_| path_string.deref());
        let mut path = Node::PathOrFileDescriptor::Path(
            Node::PathLike::from_bun_string(init_ctx.global, &mut path_string, false)?,
        );
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

        let Some(headers_js) = argument.get(init_ctx.global, b"headers")? else { return Ok(None); };
        let fetch_headers = FetchHeaders::create_from_js(init_ctx.global, headers_js)?;
        let _fh_guard = scopeguard::guard(fetch_headers.as_ref(), |fh| {
            if let Some(h) = fh { h.deref(); }
        });
        if init_ctx.global.has_exception() {
            return Err(JsError::Thrown);
        }

        let route = Self::from_options(init_ctx.global, fetch_headers.as_deref(), &mut path)?;

        if is_index_route {
            return Ok(Some(route));
        }

        let mut methods = bun_http_types::Method::Optional::Method(bun_http_types::Method::Set::empty());
        methods.insert(Method::GET);
        methods.insert(Method::HEAD);

        init_ctx.user_routes.push(server_config::StaticRouteEntry {
            path: builder.into_boxed_slice(),
            route: route.into_mod_any_route(),
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
        let _index_guard = scopeguard::guard((), |_| index.deinit());

        let Some(files) = argument.get_array(init_ctx.global, b"files")? else { return Ok(None); };
        let mut iter = files.array_iterator(init_ctx.global)?;
        let mut html_route: Option<AnyRoute> = None;
        while let Some(file_entry) = iter.next()? {
            if let Some(item) = Self::bundled_html_manifest_item_from_js(file_entry, index.slice(), init_ctx)? {
                html_route = Some(item);
            }
        }

        Ok(html_route)
    }

    /// Convert this Phase-A `server_body::AnyRoute` to the variant-isomorphic
    /// `super::AnyRoute` (mod.rs) used by `StaticRouteEntry`.
    fn into_mod_any_route(self) -> super::AnyRoute {
        match self {
            AnyRoute::Static(p) => super::AnyRoute::Static(p),
            AnyRoute::File(p) => super::AnyRoute::File(p),
            AnyRoute::Html(refptr) => super::AnyRoute::Html(refptr),
            AnyRoute::FrameworkRouter(idx) => super::AnyRoute::FrameworkRouter(idx),
        }
    }

    pub fn from_options(
        global: &JSGlobalObject,
        headers: Option<&FetchHeaders>,
        path: &mut Node::PathOrFileDescriptor,
    ) -> JsResult<AnyRoute> {
        // The file/static route doesn't ref it.
        let blob = Blob::find_or_create_file_from_path(path, global, false);

        if blob.needs_to_read_file() {
            // Throw a more helpful error upfront if the file does not exist.
            //
            // In production, you do NOT want to find out that all the assets
            // are 404'ing when the user goes to the route. You want to find
            // that out immediately so that the health check on startup fails
            // and the process exits with a non-zero status code.
            if let Some(store) = blob.store() {
                if let Some(store_path) = store.get_path() {
                    // PORT NOTE: `sys::exists_at_type` takes `&ZStr`; the store
                    // path is a borrowed byte slice. NUL-terminate into a path
                    // buffer for the syscall.
                    let mut buf = bun_paths::PathBuffer::default();
                    let zpath = bun_paths::z(store_path, &mut buf);
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

            // SAFETY: init_from_blob returns a freshly Box::into_raw'd FileRoute (rc=1).
            return Ok(AnyRoute::File(unsafe {
                NonNull::new_unchecked(FileRoute::init_from_blob(
                    blob,
                    super::file_route::InitOptions { server: None, status_code: 200, headers },
                ))
            }));
        }

        // SAFETY: init_from_any_blob returns a freshly Box::into_raw'd StaticRoute (rc=1).
        Ok(AnyRoute::Static(unsafe {
            NonNull::new_unchecked(StaticRoute::init_from_any_blob(
                &AnyBlob::Blob(blob),
                super::static_route::InitFromBytesOptions { server: None, headers, ..Default::default() },
            ))
        }))
    }

    pub fn html_route_from_js(
        argument: JSValue,
        init_ctx: &mut ServerInitContext,
    ) -> JsResult<Option<AnyRoute>> {
        use std::collections::hash_map::Entry as StdEntry;
        if let Some(html_bundle) = <HTMLBundle as bun_jsc::JsClass>::from_js(argument) {
            let entry = init_ctx.dedupe_html_bundle_map.entry(html_bundle as *const _);
            // PERF(port): was bun.handleOom — Rust HashMap aborts on OOM
            return Ok(Some(match entry {
                StdEntry::Vacant(v) => {
                    let route = html_bundle::Route::init(html_bundle);
                    let dup = route.dupe_ref();
                    v.insert(route);
                    AnyRoute::Html(dup)
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

                let style: FrameworkRouter::Style = if let Some(style_js) = argument.get(global, b"style")? {
                    FrameworkRouter::Style::from_js(style_js, global)?
                } else {
                    FrameworkRouter::Style::NextjsPages
                };
                // errdefer style.deinit() — Style impls Drop; `?` drops it on the error path

                if !strings::ends_with(path, b"/*") {
                    return Err(global.throw_invalid_arguments(
                        format_args!("To mount a directory, make sure the path ends in `/*`"),
                    ));
                }

                // trim the /*
                // SAFETY: `path` is a route key owned by `init_ctx`
                // (`ServerInitContext.user_routes` / `js_string_allocations`)
                // and outlives the `framework_router_list` it is pushed into —
                // identical to the borrow `StringRefList::track` returns for
                // `relative_root`. The `&'static` on `FileSystemRouterType`
                // fields is the Phase-A erasure of that owner lifetime.
                let prefix: &'static [u8] = if path.len() == 2 {
                    b"/"
                } else {
                    unsafe { &*(&path[..path.len() - 2] as *const [u8]) }
                };
                static IGNORE_DIRS: &[&[u8]] = &[b"node_modules", b".git"];
                static EXTENSIONS: &[&[u8]] = &[b".tsx", b".jsx"];
                init_ctx.framework_router_list.push(bake::FileSystemRouterType {
                    root: relative_root,
                    style,
                    prefix,
                    // TODO: customizable framework option.
                    entry_client: Some(b"bun-framework-react/client.tsx"),
                    entry_server: b"bun-framework-react/server.tsx",
                    ignore_underscores: true,
                    ignore_dirs: IGNORE_DIRS,
                    extensions: EXTENSIONS,
                    allow_layouts: true,
                });

                // `@typeInfo(FrameworkRouter.Type.Index).@"enum".tag_type` → the index newtype's MAX.
                let limit = FrameworkRouter::TypeIndex::MAX as usize;
                if init_ctx.framework_router_list.len() > limit {
                    return Err(global.throw_invalid_arguments(
                        format_args!("Too many framework routers. Maximum is {}.", limit),
                    ));
                }
                return Ok(Some(AnyRoute::FrameworkRouter(FrameworkRouter::TypeIndex::init(
                    u8::try_from(init_ctx.framework_router_list.len() - 1).unwrap(),
                ))));
            }
        }

        if let Some(file_route) = FileRoute::from_js(global, argument)? {
            // SAFETY: from_js returns a freshly Box::into_raw'd FileRoute (rc=1).
            return Ok(Some(AnyRoute::File(unsafe { NonNull::new_unchecked(file_route) })));
        }
        match StaticRoute::from_js(global, argument)? {
            // SAFETY: from_js returns a freshly Box::into_raw'd StaticRoute (rc=1).
            Some(s) => Ok(Some(AnyRoute::Static(unsafe { NonNull::new_unchecked(s) }))),
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
    /// Raw `*mut` because the route is stored in `ServePluginsState::Pending.html_bundle_routes`
    /// and later mutated via `on_plugins_resolved`/`on_plugins_rejected`. A `&Route` would not
    /// carry write provenance, making the later `&mut *route` deref UB. Callers pass `&mut self`,
    /// which coerces to `*mut` here.
    HtmlBundleRoute(*mut html_bundle::Route),
    DevServer(&'a DevServer),
}

impl ServePlugins {
    pub fn init(plugins: Box<[Box<[u8]>]>) -> *mut ServePlugins {
        Box::into_raw(Box::new(ServePlugins {
            ref_count: core::cell::Cell::new(1),
            state: ServePluginsState::Unqueued(plugins),
        }))
    }

    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// Decrement the intrusive refcount, freeing the allocation when it hits zero.
    ///
    /// Takes a raw pointer (not `&self`) so the original `Box::into_raw` provenance
    /// from [`ServePlugins::init`] is preserved for the final `Box::from_raw` — going
    /// through `&self` would narrow provenance to read-only and make the drop UB.
    ///
    /// SAFETY: `this` must originate from [`ServePlugins::init`] and the caller must
    /// hold a counted reference.
    pub unsafe fn deref_(this: *const Self) {
        // SAFETY: caller contract — `this` is live while refcount > 0
        let rc = unsafe { &(*this).ref_count };
        let n = rc.get() - 1;
        rc.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; `this` carries the Box::into_raw provenance from init()
            unsafe { drop(Box::from_raw(this as *mut Self)) };
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
                ServePluginsState::Pending { html_bundle_routes, dev_server, .. } => {
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
                                    || dev_server.map(|p| p.as_ptr() as *const _) == Some(server as *const _)
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
        let ServePluginsState::Unqueued(plugin_list) = &self.state else { unreachable!() };
        // PORT NOTE: reshaped for borrowck — clone the slice refs so we can mutate self.state below
        let plugin_list: Vec<_> = plugin_list.iter().collect();
        // SAFETY: `bun_vm()` returns the JS-thread singleton; `transpiler.options` is
        // process-lifetime once VM is initialized.
        let bunfig_path: &[u8] = unsafe { &(*global.bun_vm()).transpiler.options.bunfig_path };
        let bunfig_folder: &[u8] =
            bun_paths::resolve_path::dirname::<bun_paths::resolve_path::platform::Auto>(bunfig_path);

        self.ref_();
        let this_ptr: *const Self = self;
        // SAFETY: `self` originates from a `*mut ServePlugins` (Box::into_raw in init()); the
        // raw pointer preserves that provenance for the paired deref_ on scope exit.
        let _deref_guard = scopeguard::guard((), move |_| unsafe { Self::deref_(this_ptr) });

        let plugin = JSBundler::Plugin::create(global, bun_jsc::BunPluginTarget::Browser);
        // SAFETY: `Plugin::create` returns a freshly-boxed `*mut Plugin` (single owner).
        let plugin: Box<JSBundler::Plugin> = unsafe { Box::from_raw(plugin) };
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

        // SAFETY: `bun_vm()` returns a live raw `*mut VirtualMachine`;
        // `event_loop()` returns a live raw `*mut EventLoop`. Reborrowed for
        // each call so no aliased `&mut` outlives the statement.
        unsafe { (*(*global.bun_vm()).event_loop()).enter() };
        let result = jsc::host_fn::from_js_host_call(global, || {
            match &self.state {
                ServePluginsState::Pending { plugin, .. } => plugin.as_ref(),
                _ => unreachable!(),
            }
            .load_and_resolve_plugins_for_serve(plugin_js_array, bunfig_folder_bunstr)
        })?;
        // SAFETY: see `enter()` above.
        unsafe { (*(*global.bun_vm()).event_loop()).exit() };

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
                        if let ServePluginsState::Pending { promise: pending_promise, .. } = &mut self.state {
                            pending_promise.set(global, promise_value);
                        }
                        promise_value.then(global, self as *mut Self, __jsc_host_on_resolve_impl, __jsc_host_on_reject_impl);
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
        let ServePluginsState::Pending { plugin, dev_server, html_bundle_routes, promise } =
            mem::replace(&mut self.state, ServePluginsState::Err)
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
            // SAFETY: route was ref'd when stored
            let route_ref = unsafe { &mut *route };
            route_ref.on_plugins_resolved(Some(plugin_ref)); // bun.handleOom — aborts on OOM
            // SAFETY: paired with the `ref_` taken when the route was pushed.
            unsafe { bun_ptr::RefCount::<html_bundle::Route>::deref(route) };
        }
        if let Some(mut server) = dev_server {
            // SAFETY: dev_server outlives plugin load (stored as a back-reference
            // by `get_or_start_load`; the owning Box<DevServer> is held by the
            // server instance, which itself holds a counted ref on `self`).
            bun_core::handle_oom(unsafe { server.as_mut() }.on_plugins_resolved(
                Some(plugin_ref as *const JSBundler::Plugin as *mut JSBundler::Plugin),
            ));
        }
    }

    pub fn handle_on_reject(&mut self, global: &JSGlobalObject, err: JSValue) {
        debug_assert!(matches!(self.state, ServePluginsState::Pending { .. }));
        let ServePluginsState::Pending { plugin, dev_server, html_bundle_routes, promise } =
            mem::replace(&mut self.state, ServePluginsState::Err)
        else {
            unreachable!()
        };
        drop(plugin); // pending.plugin.deinit()
        drop(promise); // Zig: promise.deinit() — Drop on JscStrong releases the slot.

        self.state = ServePluginsState::Err;

        for route in html_bundle_routes {
            // SAFETY: route was ref'd when stored
            let _ = unsafe { &mut *route }.on_plugins_rejected();
            // SAFETY: route was ref'd when stored; pair with that ref
            unsafe { bun_ptr::RefCount::<html_bundle::Route>::deref(route) };
        }
        if let Some(mut server) = dev_server {
            // SAFETY: dev_server outlives plugin load
            bun_core::handle_oom(unsafe { server.as_mut() }.on_plugins_rejected());
        }

        Output::err_generic("Failed to load plugins for Bun.serve:", ());
        // SAFETY: bun_vm() returns a non-null *mut to the active VM
        unsafe { &mut *global.bun_vm() }.run_error_handler(err, None);
    }
}

impl Drop for ServePlugins {
    fn drop(&mut self) {
        match &self.state {
            ServePluginsState::Unqueued(_) => {}
            ServePluginsState::Pending { .. } => debug_assert!(false), // should have one ref while pending!
            ServePluginsState::Loaded(_) => {} // Box<Plugin> drops
            ServePluginsState::Err => {}
        }
    }
}

#[bun_jsc::host_fn(export = "BunServe__onResolvePlugins")]
pub fn on_resolve_impl(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    ctx_log!("onResolve");

    let [plugins_result, plugins_js] = callframe.arguments_as_array::<2>();
    let plugins = plugins_js.as_promise_ptr::<ServePlugins>();
    // SAFETY: `plugins` was Box::into_raw'd and ref()'d before .then(); deref pairs with that ref
    let _guard = scopeguard::guard((), move |_| unsafe { ServePlugins::deref_(plugins) });
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
    // SAFETY: `plugins` was Box::into_raw'd and ref()'d before .then(); deref pairs with that ref
    let _guard = scopeguard::guard((), move |_| unsafe { ServePlugins::deref_(plugins) });
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
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum Protocol { Http, Https }
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum DevelopmentKind { Debug, Production }

bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    pub struct ServerFlags: u8 {
        const DEINIT_SCHEDULED = 1 << 0;
        const TERMINATED = 1 << 1;
        const HAS_HANDLED_ALL_CLOSED_PROMISE = 1 << 2;
    }
}

/// `fn NewServer(protocol_enum, development_kind) type` — Zig type-generator.
/// SSL = (protocol == .https), DEBUG = (development_kind == .debug).
/// HAS_H3 = SSL.
pub struct NewServer<const SSL: bool, const DEBUG: bool> {
    pub app: Option<*mut uws::NewApp<SSL>>,
    pub listener: Option<*mut uws::ListenSocket>,
    // TODO(port): conditional field — `if (has_h3) ?*H3.App else void`. Kept as Option; never set when !SSL.
    pub h3_app: Option<*mut uws::H3::App>,
    pub h3_listener: Option<*mut uws::H3::ListenSocket>,
    /// Cached `h3=":<port>"; ma=86400` value for Alt-Svc on H1 responses;
    /// formatted once in onH3Listen so renderMetadata doesn't reformat.
    /// Stored as a plain owned byte string — the only consumer
    /// (`renderMetadata` via [`h3_alt_svc`]) takes a `&[u8]` length-delimited
    /// header value, so the Zig `[:0]const u8` sentinel is not load-bearing.
    pub h3_alt_svc: Box<[u8]>, // empty when !SSL
    pub js_value: JsRef,
    /// Potentially null before listen() is called, and once .destroy() is called.
    pub vm: &'static VirtualMachine::VirtualMachine,
    pub global_this: *const JSGlobalObject,
    pub base_url_string_for_joining: Box<[u8]>,
    pub config: ServerConfig,
    pub pending_requests: usize,
    pub request_pool_allocator: *mut RequestContextStackAllocator<SSL, DEBUG, false>,
    // TODO(port): conditional field
    pub h3_request_pool_allocator: *mut RequestContextStackAllocator<SSL, DEBUG, true>,
    pub all_closed_promise: jsc::JSPromiseStrong,

    pub listen_callback: jsc::AnyTask::AnyTask,
    // allocator field dropped — global mimalloc
    pub poll_ref: KeepAlive,

    pub flags: ServerFlags,

    /// Intrusively-refcounted plugin state. Stored as a raw pointer (not
    /// `Rc`) because (a) the same `*mut ServePlugins` is smuggled through
    /// `JSValue::then` as a promise context and (b) `ServePlugins` is mutated
    /// through any owner (Zig spec uses `*ServePlugins` everywhere). The
    /// counted ref held here is released in `Drop for NewServer`.
    pub plugins: Option<NonNull<ServePlugins>>,

    pub dev_server: Option<Box<DevServer>>,

    /// These associate a route to the index in RouteList.cpp.
    /// User routes may get applied multiple times due to SNI.
    /// So we have to store it.
    pub user_routes: Vec<UserRoute<SSL, DEBUG>>,

    pub on_clienterror: jsc::StrongOptional,

    pub inspector_server_id: DebuggerId,
}

// TODO(port): RequestContextStackAllocator is defined in RequestContext.zig; placeholder generic
pub type RequestContextStackAllocator<const SSL: bool, const DEBUG: bool, const H3: bool> =
    super::request_context::RequestContextStackAllocator<NewServer<SSL, DEBUG>, SSL, DEBUG, H3>;

pub struct UserRoute<const SSL: bool, const DEBUG: bool> {
    pub id: u32,
    pub server: *const NewServer<SSL, DEBUG>,
    pub route: server_config::RouteDeclaration,
}

// PORT NOTE: Zig UserRoute.deinit() only freed `self.route`; RouteDeclaration impls Drop,
// so an explicit `impl Drop for UserRoute` would double-free. Field drops automatically.

pub enum CreateJsRequest { Yes, No, Bake }

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
            js_request: Strong::create(self.js_request, global),
            request: self.request_object,
            ctx: AnyRequestContext::init(self.ctx as *const Ctx),
            response: RespLike::to_any_response(resp),
        }
    }
}

// PORT NOTE (layering): `ServerLike` is the trait `RequestContext<ThisServer,..>`
// bounds on. mod.rs implements it for its own `NewServer`; this draft module
// has a parallel `NewServer` (Phase-A duplication) that needs the same impl so
// `ServerRequestContext<SSL,DEBUG>` (= `RequestContext<server_body::NewServer,..>`)
// can call `create`/`on_response`/`deinit`/etc.
impl<const SSL: bool, const DEBUG: bool> super::ServerLike for NewServer<SSL, DEBUG> {
    const SSL_ENABLED: bool = SSL;
    const DEBUG_MODE: bool = DEBUG;
    fn global_this(&self) -> &jsc::JSGlobalObject { unsafe { &*self.global_this } }
    fn vm(&self) -> &jsc::VirtualMachine { self.vm }
    fn vm_mut(&self) -> *mut jsc::VirtualMachine { jsc::VirtualMachine::get() }
    fn config(&self) -> &ServerConfig { &self.config }
    fn on_request_complete(&mut self) { Self::on_request_complete(self) }
    fn dev_server(&self) -> Option<&DevServer> { self.dev_server.as_deref() }
    fn js_value(&self) -> &jsc::JsRef { &self.js_value }
    fn h3_alt_svc(&self) -> Option<&[u8]> { Self::h3_alt_svc(self) }
    fn terminated(&self) -> bool { self.flags.contains(ServerFlags::TERMINATED) }
    fn release_request_context(&self, ctx: *mut c_void, is_h3: bool) {
        // SAFETY: ctx was allocated from this exact pool by `prepare_js_request_context`.
        unsafe {
            if is_h3 {
                (*self.h3_request_pool_allocator)
                    .put(&mut *(ctx as *mut ServerH3RequestContext<SSL, DEBUG>));
            } else {
                (*self.request_pool_allocator)
                    .put(&mut *(ctx as *mut ServerRequestContext<SSL, DEBUG>));
            }
        }
    }
}

// `WebSocketUpgradeServer<SSL>` so `ServerWebSocket::behavior::<Self, SSL>` and
// `app.ws(...)` accept `*mut Self` / `*mut UserRoute<..>` as the upgrade ctx.
impl<const SSL: bool, const DEBUG: bool> uws_sys::WebSocketUpgradeServer<SSL>
    for NewServer<SSL, DEBUG>
{
    fn on_websocket_upgrade(
        &mut self,
        res: *mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws_sys::Request,
        context: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        // SAFETY: uWS passes a live response handle for the upgrade callback.
        Self::on_web_socket_upgrade(self, unsafe { &mut *res }, req, context, id);
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    /// Construct the cross-module `super::AnyServer` back-reference. Routes
    /// (StaticRoute/FileRoute/HTMLBundle) store this so they can call back
    /// into `on_pending_request` / `on_static_request_complete`.
    ///
    /// PORT NOTE: `super::AnyServer` dispatches by casting `ptr` to
    /// `super::NewServer<SSL,DEBUG>`. This module's `NewServer` is a Phase-A
    /// duplicate that is not yet field-layout-identical. Until the two structs
    /// are unified, callbacks routed through `super::AnyServer` from routes
    /// owned by THIS server type are incorrect — but no such route is
    /// constructed by `set_routes` here yet (the static-route table belongs to
    /// `super::NewServer`). The correct value is still produced for tag/ptr.
    /// TODO(port): unify server_body::NewServer with super::NewServer (draft dissolution).
    #[inline]
    fn as_any_server(&self) -> super::AnyServer {
        let tag = match (SSL, DEBUG) {
            (false, false) => super::AnyServerTag::HTTPServer,
            (true, false) => super::AnyServerTag::HTTPSServer,
            (false, true) => super::AnyServerTag::DebugHTTPServer,
            (true, true) => super::AnyServerTag::DebugHTTPSServer,
        };
        super::AnyServer { tag, ptr: self as *const Self as *mut () }
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    pub const SSL_ENABLED: bool = SSL;
    pub const DEBUG_MODE: bool = DEBUG;
    const HAS_H3: bool = SSL;

    // PORT NOTE: Zig's `pub const App = …` etc. are inherent associated types,
    // which are unstable in Rust. Module-level aliases `ServerApp<SSL>`,
    // `ServerRequestContext<SSL,DEBUG>`, `ServerH3RequestContext<SSL,DEBUG>`,
    // `ServerPreparedRequest<'a,SSL,DEBUG>` are used instead.

    // TODO(port): codegen — `js` is selected from JSDebugHTTPServer/JSHTTPServer/JSDebugHTTPSServer/JSHTTPSServer
    // The from_js/to_js/to_js_direct fns are provided by #[bun_jsc::JsClass] codegen.

    // TODO(port): host_fn.wrapInstanceMethod — these become #[bun_jsc::host_fn(method)] attributes
    // on the underlying fns. doStop -> stop_from_js, dispose -> dispose_from_js, doUpgrade -> on_upgrade,
    // doPublish -> publish, doReload -> on_reload, doFetch -> on_fetch, doRequestIP -> request_ip,
    // doTimeout -> timeout

    /// SAFETY: `self.vm` is the per-thread singleton (`&'static`); reborrow exclusively
    /// for the duration of one mutating call. Caller must not hold another `&mut VirtualMachine`.
    #[inline]
    fn vm_mut(&self) -> &mut jsc::virtual_machine::VirtualMachine {
        // SAFETY: see fn doc — singleton VM, single-threaded JS runtime.
        // Go through VirtualMachine::get() (returns *mut) rather than casting
        // through the stored `&'static` to avoid invalid_reference_casting.
        unsafe { &mut *jsc::virtual_machine::VirtualMachine::get() }
    }

    pub fn get_plugins(&self) -> PluginsResult<'_> {
        match self.plugins {
            None => PluginsResult::Found(None),
            // SAFETY: `plugins` holds a counted ref; live while `self` is.
            Some(p) => match unsafe { &(*p.as_ptr()).state } {
                ServePluginsState::Unqueued(_) | ServePluginsState::Pending { .. } => PluginsResult::Pending,
                ServePluginsState::Loaded(plugin) => PluginsResult::Found(Some(plugin.as_ref())),
                ServePluginsState::Err => PluginsResult::Err,
            },
        }
    }

    pub fn get_plugins_async(
        &mut self,
        _bundle: &mut html_bundle::HTMLBundleRoute,
        _raw_plugins: &[&[u8]],
        _bunfig_path: &[u8],
    ) {
        // PORT NOTE: `getPluginsAsync` does not exist on `ThisServer` in
        // server.zig — it's only referenced from `AnyServer.getPluginsAsync`
        // (server.zig:3442), which dispatches to a method that the Zig source
        // never defines (dead path; bundle-side wiring in HTMLBundle.zig calls
        // `getOrLoadPlugins` instead). Mirror that by routing through
        // `get_or_load_plugins` with the html-bundle callback.
        // TODO(port): wire `loadAndResolvePluginsForHtmlBundle` once the
        // HTMLBundle-side caller is ported and the actual contract is clear.
        let _ = self.get_or_load_plugins(ServePluginsCallback::HtmlBundleRoute(_bundle));
    }

    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub fn get_or_load_plugins(&mut self, callback: ServePluginsCallback<'_>) -> GetOrStartLoadResult<'_> {
        if let Some(p) = self.plugins {
            // SAFETY: globalThis outlives the server
            let global = unsafe { &*self.global_this };
            // SAFETY: `plugins` holds a counted ref produced by
            // `ServePlugins::init` (Box::into_raw); intrusive refcount permits
            // mutation through any owner. No other `&mut ServePlugins` is live
            // on this (single-threaded) JS thread for the call's duration.
            return match unsafe { &mut *p.as_ptr() }.get_or_start_load(global, callback) {
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
    pub fn do_subscriber_count(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        if arguments.len < 1 {
            return Err(global.throw_not_enough_arguments("subscriberCount", 1, 0));
        }

        if arguments.ptr[0].is_empty_or_undefined_or_null() {
            return Err(global.throw_invalid_arguments(
                format_args!("subscriberCount requires a topic name as a string"),
            ));
        }

        let topic = arguments.ptr[0].to_slice(global)?;

        if topic.slice().is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        // SAFETY: self.app is Some and points to a live uws App for the lifetime of any JS-reachable Server
        Ok(JSValue::js_number(f64::from(unsafe { &mut *self.app.unwrap() }.num_subscribers(topic.slice()))))
    }

    // `#[bun_jsc::JsClass]` emits the C-ABI `*Class__construct` shim that calls
    // this directly via `host_fn_construct_result` — no `#[host_fn]` attribute.
    pub fn constructor(global: &JSGlobalObject, _: &CallFrame) -> JsResult<*mut Self> {
        Err(global.throw2("Server() is not a constructor", ()))
    }

    pub fn js_value_assert_alive(&self) -> JSValue {
        debug_assert!(self.js_value.is_not_empty());
        self.js_value.try_get().unwrap()
    }

    pub fn request_ip(&self, request: &Request) -> JsResult<JSValue> {
        if matches!(self.config.address, server_config::Address::Unix(_)) {
            return Ok(JSValue::NULL);
        }
        let Some(info) = request.request_context.get_remote_socket_info() else {
            return Ok(JSValue::NULL);
        };
        crate::socket::socket_address::SocketAddress::create_dto(
            // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW per LIFETIMES.tsv)
            unsafe { &*self.global_this },
            &info.ip,
            u16::try_from(info.port).unwrap(),
            info.is_ipv6,
        )
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
            + self.base_url_string_for_joining.len()
            + self.config.memory_cost()
            + self.dev_server.as_ref().map_or(0, |dev| dev.memory_cost())
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
            // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
            return Err(unsafe { &*self.global_this }.throw(format_args!("timeout() requires a number")));
        }
        let value = seconds.to_int32() as c_uint;

        if let Some(request) = <Request as bun_jsc::JsClass>::from_js(arguments[0]) {
            // SAFETY: from_js returns a live *mut Request
            let _ = unsafe { &mut *request }.request_context.set_timeout(value);
        } else if let Some(response) = <NodeHTTPResponse as bun_jsc::JsClass>::from_js(arguments[0]) {
            // SAFETY: from_js returns a live *mut NodeHTTPResponse
            unsafe { &mut *response }.set_timeout((value % 255) as u8);
        } else {
            // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
            return Err(unsafe { &*self.global_this }
                .throw_invalid_arguments(format_args!("timeout() requires a Request object")));
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn set_idle_timeout(&mut self, seconds: c_uint) {
        self.config.idle_timeout = seconds.min(255) as u8;
    }

    pub fn set_flags(&mut self, require_host_header: bool, use_strict_method_validation: bool) {
        if let Some(app) = self.app {
            // SAFETY: FFI handle
            unsafe { &mut *app }.set_flags(require_host_header, use_strict_method_validation);
        }
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        if let Some(app) = self.app {
            // SAFETY: FFI handle
            unsafe { &mut *app }.set_max_http_header_size(max_header_size);
        }
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

        let app = self.app.unwrap() as *mut c_void;

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
                (AnyWebSocket::publish_with_options(SSL, app, topic_slice.slice(), buffer.slice(), uws_sys::Opcode::Binary, compress) as i32)
                    * ((buffer.len as u32 & 0x7FFF_FFFF) as i32), // @intCast(@as(u31, @truncate(buffer.len)))
            )));
        }

        {
            let js_string = message_value.to_js_string(global)?;
            // SAFETY: to_js_string returns a non-null *mut JSString on Ok
            let view = unsafe { &*js_string }.view(global);
            let slice = view.to_slice();
            let _keep = jsc::EnsureStillAlive(message_value);

            let buffer = slice.slice();
            return Ok(JSValue::js_number(f64::from(
                // if 0, return 0
                // else return number of bytes sent
                (AnyWebSocket::publish_with_options(SSL, app, topic_slice.slice(), buffer, uws_sys::Opcode::Text, compress) as i32)
                    * ((buffer.len() as u32 & 0x7FFF_FFFF) as i32),
            )));
        }
    }

    pub fn on_upgrade(
        &mut self,
        global: &JSGlobalObject,
        object: JSValue,
        optional: Option<JSValue>,
    ) -> JsResult<JSValue> {
        use super::node_http_response::Flags as NodeHTTPResponseFlags;
        use bun_jsc::HTTPHeaderName;
        use bun_str::ZigStringSlice;

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
            if node_http_response.flags.contains(NodeHTTPResponseFlags::ENDED)
                || node_http_response.flags.contains(NodeHTTPResponseFlags::SOCKET_CLOSED)
            {
                return Ok(JSValue::FALSE);
            }

            let mut data_value = JSValue::ZERO;

            // if we converted a HeadersInit to a Headers object, we need to free it
            let fetch_headers_to_deref: core::cell::Cell<Option<*mut FetchHeaders>> = core::cell::Cell::new(None);
            let _fh_guard = scopeguard::guard(&fetch_headers_to_deref, |cell| {
                if let Some(fh) = cell.get() {
                    // SAFETY: created via FetchHeaders::create_from_js below
                    unsafe { &mut *fh }.deref();
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
                        return Err(global.throw_invalid_arguments(format_args!("upgrade options must be an object")));
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

                        let fetch_headers_to_use: *mut FetchHeaders = match fetch_headers_from_js(headers_value, global) {
                            Some(h) => h,
                            None => 'brk: {
                                if headers_value.is_object() {
                                    if let Some(fetch_headers) = FetchHeaders::create_from_js(global, headers_value)? {
                                        fetch_headers_to_deref.set(Some(fetch_headers.as_ptr()));
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
                        // SAFETY: fetch_headers_to_use is non-null from either branch above
                        let fetch_headers_to_use = unsafe { &mut *fetch_headers_to_use };

                        if global.has_exception() {
                            return Err(JsError::Thrown);
                        }

                        if let Some(protocol) = fetch_headers_to_use.fast_get(HTTPHeaderName::SecWebSocketProtocol) {
                            // Clone before fastRemove frees the backing StringImpl.
                            sec_websocket_protocol_owned = protocol.to_slice_clone();
                            sec_websocket_protocol = ZigString::init(sec_websocket_protocol_owned.slice());
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use.fast_remove(HTTPHeaderName::SecWebSocketProtocol);
                        }

                        if let Some(extensions) = fetch_headers_to_use.fast_get(HTTPHeaderName::SecWebSocketExtensions) {
                            // Clone before fastRemove frees the backing StringImpl.
                            sec_websocket_extensions_owned = extensions.to_slice_clone();
                            sec_websocket_extensions = ZigString::init(sec_websocket_extensions_owned.slice());
                            // Remove from headers so it's not written twice (once here and once by upgrade())
                            fetch_headers_to_use.fast_remove(HTTPHeaderName::SecWebSocketExtensions);
                        }
                        if let Some(raw_response) = node_http_response.raw_response {
                            // we must write the status first so that 200 OK isn't written
                            raw_response.write_status(b"101 Switching Protocols");
                            fetch_headers_to_use.to_uws_response(ResponseKind::from(SSL, false), raw_response.socket() as *mut c_void);
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
            return Err(global.throw_invalid_arguments(format_args!("upgrade requires a Request object")));
        };
        // SAFETY: from_js returns a live *mut Request
        let request = unsafe { &mut *request };

        let Some(upgrader_ptr) = request.request_context.get::<ServerRequestContext<SSL, DEBUG>>() else {
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
        let mut sec_websocket_key_owned = bun_str::ZigStringSlice::empty();
        let _k = scopeguard::guard((), |_| sec_websocket_key_owned.deinit());
        let mut sec_websocket_protocol_owned = bun_str::ZigStringSlice::empty();
        let _p = scopeguard::guard((), |_| sec_websocket_protocol_owned.deinit());
        let mut sec_websocket_extensions_owned = bun_str::ZigStringSlice::empty();
        let _e = scopeguard::guard((), |_| sec_websocket_extensions_owned.deinit());

        if let Some(head) = request.get_fetch_headers() {
            use jsc::HTTPHeaderName;
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
            // SAFETY: BACKREF; uws::Request is live while RequestContext.req is Some.
            let r = unsafe { &mut *req_ptr };
            if sec_websocket_key_str.len == 0 {
                sec_websocket_key_str = ZigString::init(r.header(b"sec-websocket-key").unwrap_or(b""));
            }
            if sec_websocket_protocol.len == 0 {
                sec_websocket_protocol = ZigString::init(r.header(b"sec-websocket-protocol").unwrap_or(b""));
            }
            if sec_websocket_extensions.len == 0 {
                sec_websocket_extensions = ZigString::init(r.header(b"sec-websocket-extensions").unwrap_or(b""));
            }
        }

        if sec_websocket_key_str.len == 0 {
            return Ok(JSValue::FALSE);
        }
        if sec_websocket_protocol.len > 0 { sec_websocket_protocol.mark_utf8(); }
        if sec_websocket_extensions.len > 0 { sec_websocket_extensions.mark_utf8(); }

        let mut data_value = JSValue::ZERO;
        let mut fetch_headers_to_deref: Option<*mut FetchHeaders> = None;
        let _fh_guard = scopeguard::guard((), |_| {
            if let Some(fh) = fetch_headers_to_deref { unsafe { (*fh).deref() } }
        });
        let mut fetch_headers_to_use: Option<*mut FetchHeaders> = None;

        if let Some(opts) = optional {
            'getter: {
                if opts.is_empty_or_undefined_or_null() { break 'getter; }
                if !opts.is_object() {
                    return Err(global.throw_invalid_arguments(format_args!("upgrade options must be an object")));
                }
                if let Some(v) = opts.fast_get(global, jsc::BuiltinName::Data)? { data_value = v; }
                if global.has_exception() { return Err(JsError::Thrown); }

                if let Some(headers_value) = opts.fast_get(global, jsc::BuiltinName::Headers)? {
                    if headers_value.is_empty_or_undefined_or_null() { break 'getter; }
                    use jsc::HTTPHeaderName;
                    let fh: *mut FetchHeaders = match fetch_headers_from_js(headers_value, global) {
                        Some(h) => h,
                        None => {
                            if headers_value.is_object() {
                                if let Some(created) = FetchHeaders::create_from_js(global, headers_value)? {
                                    fetch_headers_to_deref = Some(created);
                                    created
                                } else if !global.has_exception() {
                                    return Err(global.throw_invalid_arguments(format_args!(
                                        "upgrade options.headers must be a Headers or an object"
                                    )));
                                } else { return Err(JsError::Thrown); }
                            } else if !global.has_exception() {
                                return Err(global.throw_invalid_arguments(format_args!(
                                    "upgrade options.headers must be a Headers or an object"
                                )));
                            } else { return Err(JsError::Thrown); }
                        }
                    };
                    fetch_headers_to_use = Some(fh);
                    if global.has_exception() { return Err(JsError::Thrown); }

                    // SAFETY: fh is a live FetchHeaders (either from JS or freshly created).
                    let fh = unsafe { &mut *fh };
                    if let Some(p) = fh.fast_get(HTTPHeaderName::SecWebSocketProtocol) {
                        sec_websocket_protocol_owned.deinit();
                        sec_websocket_protocol_owned = p.to_slice_clone();
                        sec_websocket_protocol = ZigString::init(sec_websocket_protocol_owned.slice());
                        fh.fast_remove(HTTPHeaderName::SecWebSocketProtocol);
                    }
                    if let Some(e) = fh.fast_get(HTTPHeaderName::SecWebSocketExtensions) {
                        sec_websocket_extensions_owned.deinit();
                        sec_websocket_extensions_owned = e.to_slice_clone();
                        sec_websocket_extensions = ZigString::init(sec_websocket_extensions_owned.slice());
                        fh.fast_remove(HTTPHeaderName::SecWebSocketExtensions);
                    }
                }
                if global.has_exception() { return Err(JsError::Thrown); }
            }
        }

        // SAFETY: upgrader_ptr is live (ref_() above)
        let upgrader = unsafe { &mut *upgrader_ptr };
        // Option getters may have run a re-entrant server.upgrade(req).
        if upgrader.is_aborted_or_ended() || upgrader.did_upgrade_web_socket() {
            return Ok(JSValue::FALSE);
        }

        let cookies_to_write = upgrader.cookies.take();
        let _cookies_guard = scopeguard::guard((), |_| {
            if let Some(c) = &cookies_to_write { c.deref() }
        });

        // Write status, custom headers, and cookies in one place
        if fetch_headers_to_use.is_some() || cookies_to_write.is_some() {
            resp.write_status(b"101 Switching Protocols");
            if let Some(h) = fetch_headers_to_use {
                // SAFETY: h is a live FetchHeaders (see above).
                unsafe { (*h).to_uws_response(ResponseKind::from(SSL, false), resp.socket() as *mut c_void) };
            }
            if let Some(c) = &cookies_to_write {
                c.write(global, ResponseKind::from(SSL, false), resp.socket() as *mut c_void)?;
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

        let proto_str = sec_websocket_protocol.to_slice();
        let _ps = scopeguard::guard((), |_| proto_str.deinit());
        let ext_str = sec_websocket_extensions.to_slice();
        let _es = scopeguard::guard((), |_| ext_str.deinit());

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
            upgrade_ctx,
        );

        Ok(JSValue::TRUE)
    }

    pub fn on_reload_from_zig(&mut self, new_config: &mut ServerConfig, global: &JSGlobalObject) {
        httplog!("onReload");

        // SAFETY: app is set when reload is called
        unsafe { &mut *self.app.unwrap() }.clear_routes();
        if Self::HAS_H3 {
            if let Some(h3a) = self.h3_app { unsafe { &mut *h3a }.clear_routes(); }
        }

        // only reload those two, but ignore if they're not specified.
        // PORT NOTE: Zig compared `JSValue` handles directly; here `Option<Strong>`
        // wraps a `Strong` that owns its handle, so identity comparison is
        // approximated by checking the new handler is set (non-undefined).
        if new_config.on_request.as_ref().map_or(false, |s| !s.get().is_undefined()) {
            // Old Strong drops (releases) when overwritten.
            self.config.on_request = new_config.on_request.take();
        }
        if new_config.on_node_http_request.is_some() {
            self.config.on_node_http_request = new_config.on_node_http_request.take();
        }
        if new_config.on_error.as_ref().map_or(false, |s| !s.get().is_undefined()) {
            self.config.on_error = new_config.on_error.take();
        }

        if let Some(mut ws) = new_config.websocket.take() {
            ws.handler.flags.set(super::web_socket_server_context::HandlerFlags::SSL, SSL);
            if !ws.handler.on_message.is_empty() || !ws.handler.on_open.is_empty() {
                if let Some(old_ws) = &self.config.websocket {
                    old_ws.handler.unprotect();
                }
                ws.global_object = global as *const _;
                // Zig assigns `ws.*` (move).
                self.config.websocket = Some(ws);
            } else {
                // We don't replace the existing websocket config here, but
                // the new one was already protected in WebSocketServerContext.onCreate.
                // Unprotect the discarded handlers so they don't leak.
                ws.handler.unprotect();
            }
        }

        // These get re-applied when we set the static routes again.
        if let Some(dev_server) = &mut self.dev_server {
            // Prevent a use-after-free in the hash table keys.
            dev_server.html_router.map.clear();
            dev_server.html_router.fallback = None;
        }

        // PORT NOTE: StaticRouteEntry impls Drop; assigning over static_routes deinits the old ones.
        self.config.static_routes = mem::take(&mut new_config.static_routes);

        // Zig: per-element `allocator.free(route)` then free the slice — `Vec<Box<[u8]>>`
        // drops both on assignment.
        self.config.negative_routes = mem::take(&mut new_config.negative_routes);

        if new_config.had_routes_object {
            // PORT NOTE: UserRouteBuilder drops on assignment.
            self.config.user_routes_to_build = mem::take(&mut new_config.user_routes_to_build);
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

        if self.inspector_server_id.0 != 0 {
            if let Some(debugger) = &self.vm.debugger {
                bun_core::handle_oom(http_server_agent_notify_routes_updated(
                    &debugger.http_server_agent,
                    self.inspector_server_id,
                    &self.user_routes,
                    &self.config.static_routes,
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
        unsafe { &mut *self.app.unwrap() }.clear_routes();
        if Self::HAS_H3 {
            if let Some(h3a) = self.h3_app { unsafe { &mut *h3a }.clear_routes(); }
        }
        let route_list_value = self.set_routes();
        if !route_list_value.is_empty() {
            if let Some(server_js_value) = self.js_value.try_get() {
                if !server_js_value.is_empty() {
                    Self::js_gc_route_list_set(server_js_value, unsafe { &*self.global_this }, route_list_value);
                }
            }
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn on_reload(&mut self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global.throw_type_error(format_args!(
                "Not enough arguments to 'reload'. Expected 1, got 0."
            )));
        }

        // SAFETY: bun_vm() returns the live per-thread VM singleton.
        let mut args_slice = jsc::ArgumentsSlice::init(unsafe { &*global.bun_vm() }, arguments);

        let mut new_config = ServerConfig::from_js(global, &mut args_slice, server_config::FromJSOptions {
            allow_bake_config: false,
            is_fetch_required: true,
            has_user_routes: !self.user_routes.is_empty(),
        })?;
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
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ZigString::init(b"fetch() requires the server to have a fetch handler").to_error_instance(ctx),
            ));
        }

        let arguments_buf = callframe.arguments_old::<2>();
        let arguments = arguments_buf.slice();
        if arguments.is_empty() {
            let fetch_error = Fetch::FETCH_ERROR_NO_ARGS;
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ZigString::init(fetch_error.as_bytes()).to_error_instance(ctx),
            ));
        }

        let mut headers: Option<HeadersRef> = None;
        let mut method = Method::GET;
        // SAFETY: bun_vm() returns the live per-thread VM singleton.
        let mut args = jsc::ArgumentsSlice::init(unsafe { &*ctx.bun_vm() }, arguments);

        let first_arg = args.next_eat().unwrap();
        let mut body = BodyValue::Null;
        let mut existing_request: Request;
        // TODO: set Host header
        // TODO: set User-Agent header
        // TODO: unify with fetch() implementation.
        if first_arg.is_string() {
            let url_zig_str = arguments[0].to_slice(ctx)?;
            let temp_url_str = url_zig_str.slice();

            if temp_url_str.is_empty() {
                let fetch_error = Fetch::FETCH_ERROR_BLANK_URL;
                return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ZigString::init(fetch_error.as_bytes()).to_error_instance(ctx),
                ));
            }

            let mut url = URL::parse(temp_url_str);

            // Both branches produce a heap-owned buffer that `url.href` borrows.
            // `bun.String.cloneUTF8(url.href)` below makes its own copy, so this
            // buffer must be freed before we leave the block.
            let owned_url_buf: Vec<u8> = if url.hostname.is_empty() {
                strings::append(&self.base_url_string_for_joining, url.pathname)
                    .map_err(|_| ctx.throw_out_of_memory())?
                    .into_vec()
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
                        // SAFETY: cast_ returns a live FetchHeaders*; adopt holds one ref.
                        // TODO(port): cast_ does not bump the refcount; this matches Zig's
                        // borrow-then-pass-to-init2 which transfers ownership.
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

            existing_request = Request::init2(
                BunString::clone_utf8(url.href),
                headers,
                // PERF(port): Zig routes through `vm.initRequestBodyValue` (HiveRef pool);
                // Box matches the `Request::init2` signature until that hook is type-erased.
                Box::new(body),
                method,
            );
        } else if let Some(request_) = first_arg
            .is_object()
            .then(|| <Request as bun_jsc::JsClass>::from_js(first_arg))
            .flatten()
        {
            // SAFETY: JsClass::from_js returns a live *mut Request.
            unsafe { (*request_).clone_into(ctx, &mut existing_request)? };
        } else {
            // SAFETY: FFI call into JSC C API; `ctx` is a live JSGlobalObject and
            // `first_arg.as_ref()` produces a valid `JSValueRef`.
            let js_type = unsafe { jsc::c_api::JSValueGetType(ctx.as_ptr(), first_arg.as_ref()) } as usize;
            let fetch_error = Fetch::FETCH_TYPE_ERROR_STRINGS
                .get(js_type)
                .copied()
                .unwrap_or(Fetch::FETCH_TYPE_ERROR_STRINGS[0]);
            let err = jsc::ErrorCode::INVALID_ARG_TYPE.fmt(ctx, format_args!("{}", fetch_error));
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(ctx, err));
        }

        let mut request = Box::new(existing_request);

        debug_assert!(self.config.on_request.is_some()); // confirmed above
        // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
        let global_this = unsafe { &*self.global_this };
        let on_request = self.config.on_request.as_ref().unwrap().get();
        let response_value = match on_request.call(
            global_this,
            self.js_value_assert_alive(),
            &[request.to_js(global_this)],
        ) {
            Ok(v) => v,
            Err(err) => global_this.take_exception(err),
        };

        if response_value.is_any_error() {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(ctx, response_value));
        }

        if response_value.is_empty_or_undefined_or_null() {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ZigString::init(b"fetch() returned an empty value").to_error_instance(ctx),
            ));
        }

        if response_value.as_any_promise().is_some() {
            return Ok(response_value);
        }

        if let Some(resp) = <Response as bun_jsc::JsClass>::from_js(response_value) {
            // SAFETY: `from_js` returns a live `*mut Response` (owned by its
            // JS wrapper, which `response_value` keeps alive).
            unsafe { (*resp).set_url(request.url.clone()) };
        }
        Ok(JSPromise::resolved_promise_value(ctx, response_value))
    }

    #[bun_jsc::host_fn(method)]
    pub fn close_idle_connections(&mut self, _global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        if self.app.is_none() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: self.app checked Some above; FFI handle alive until App::destroy in deinit()
        unsafe { &mut *self.app.unwrap() }.close_idle_connections();
        Ok(JSValue::UNDEFINED)
    }

    pub fn stop_from_js(&mut self, abruptly: Option<JSValue>) -> JSValue {
        // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
        let rc = self.get_all_closed_promise(unsafe { &*self.global_this });

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
            // SAFETY: listener is a live uws ListenSocket FFI handle until stop_listening() nulls it
            return JSValue::js_number(unsafe { &mut *listener }.get_local_port() as f64);
        }
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener {
                // SAFETY: h3_listener is a live H3 ListenSocket FFI handle until stop_listening() nulls it
                return JSValue::js_number(unsafe { &mut *h3l }.get_local_port() as f64);
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
                let mut value = BunString::clone_utf8(unix.as_bytes());
                let r = value.to_js(global)?;
                value.deref();
                Ok(r)
            }
            server_config::Address::Tcp { port: tcp_port, .. } => {
                let mut port: u16 = *tcp_port;

                if let Some(listener) = self.listener {
                    // SAFETY: listener is a live uws ListenSocket FFI handle until stop_listening() nulls it
                    let listener = unsafe { &mut *listener };
                    port = u16::try_from(listener.get_local_port()).unwrap();

                    let mut buf = [0u8; 64];
                    let Some(address_bytes) = listener.socket::<SSL>().local_address(&mut buf) else {
                        return Ok(JSValue::NULL);
                    };
                    let mut addr = match SocketAddress::init(address_bytes, port) {
                        Ok(a) => a,
                        Err(_) => {
                            #[cold] fn cold() {}
                            cold();
                            return Ok(JSValue::NULL);
                        }
                    };
                    // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
                    return addr.into_dto(unsafe { &*self.global_this });
                }
                if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener {
                        // SAFETY: h3_listener is a live H3 ListenSocket FFI handle until stop_listening() nulls it
                        let h3l = unsafe { &mut *h3l };
                        port = u16::try_from(h3l.get_local_port()).unwrap();
                        let mut buf = [0u8; 64];
                        let Some(address_bytes) = h3l.get_local_address(&mut buf) else {
                            return Ok(JSValue::NULL);
                        };
                        let mut addr = match SocketAddress::init(address_bytes, port) {
                            Ok(a) => a,
                            Err(_) => {
                                #[cold] fn cold() {}
                                cold();
                                return Ok(JSValue::NULL);
                            }
                        };
                        // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
                        return addr.into_dto(unsafe { &*self.global_this });
                    }
                }
                let _ = port;
                Ok(JSValue::NULL)
            }
        }
    }

    pub fn get_url_as_string(&self) -> Result<BunString, AllocError> {
        let fmt = match &self.config.address {
            server_config::Address::Unix(unix) => 'brk: {
                let unix_bytes = unix.as_bytes();
                if unix_bytes.len() > 1 && unix_bytes[0] == 0 {
                    // abstract domain socket, let's give it an "abstract" URL
                    break 'brk bun_fmt::URLFormatter {
                        proto: bun_fmt::URLProto::Abstract,
                        hostname: Some(&unix_bytes[1..]),
                        port: None,
                    };
                }
                bun_fmt::URLFormatter {
                    proto: bun_fmt::URLProto::Unix,
                    hostname: Some(unix_bytes),
                    port: None,
                }
            }
            server_config::Address::Tcp { port: tcp_port, hostname } => 'blk: {
                let mut port: u16 = *tcp_port;
                if let Some(listener) = self.listener {
                    // SAFETY: listener is a live uws ListenSocket FFI handle until stop_listening() nulls it
                    port = u16::try_from(unsafe { &mut *listener }.get_local_port()).unwrap();
                } else if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener {
                        // SAFETY: h3_listener is a live H3 ListenSocket FFI handle until stop_listening() nulls it
                        port = u16::try_from(unsafe { &mut *h3l }.get_local_port()).unwrap();
                    }
                }
                break 'blk bun_fmt::URLFormatter {
                    proto: if SSL { bun_fmt::URLProto::Https } else { bun_fmt::URLProto::Http },
                    hostname: hostname.as_ref().map(|h| h.as_bytes()),
                    port: Some(port),
                };
            }
        };

        let mut buf = Vec::new();
        write!(&mut buf, "{}", fmt).map_err(|_| AllocError)?;
        Ok(BunString::clone_utf8(&buf))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_url(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let mut url = self.get_url_as_string().map_err(|_| global.throw_out_of_memory())?;
        let r = bun_string_jsc::to_jsdomurl(&mut url, global);
        url.deref();
        Ok(r)
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
                // SAFETY: listener is a live uws ListenSocket FFI handle until stop_listening() nulls it
                if let Some(addr) = unsafe { &mut *listener }.socket::<SSL>().remote_address(&mut buf[..1024]) {
                    if !addr.is_empty() {
                        return jsc::bun_string_jsc::create_utf8_for_js(global, addr);
                    }
                }
            }
            {
                match &self.config.address {
                    server_config::Address::Tcp { hostname, .. } => {
                        if let Some(hostname) = hostname {
                            return jsc::bun_string_jsc::create_utf8_for_js(global, hostname.as_bytes());
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

    pub fn on_static_request_complete(&mut self) {
        self.pending_requests -= 1;
        self.deinit_if_we_can();
    }

    pub fn on_request_complete(&mut self) {
        // SAFETY: event_loop() returns a live *mut EventLoop owned by the VM singleton.
        unsafe { &mut *self.vm.event_loop() }.process_gc_timer();
        self.pending_requests -= 1;
        self.deinit_if_we_can();
    }

    pub fn finalize(this: *mut Self) {
        httplog!("finalize");
        // SAFETY: called from JSC finalizer on mutator thread
        let this = unsafe { &mut *this };
        this.js_value.finalize();
        this.deinit_if_we_can();
    }

    pub fn active_sockets_count(&self) -> u32 {
        let Some(websocket) = &self.config.websocket else { return 0 };
        websocket.handler.active_connections as u32
    }

    pub fn has_active_web_sockets(&self) -> bool {
        self.active_sockets_count() > 0
    }

    /// True while either the TCP listen socket or (h1: false) the QUIC
    /// listen socket is bound. The lifecycle code uses this rather than
    /// `this.listener != null` so an h3-only server is still treated as
    /// running.
    pub fn has_listener(&self) -> bool {
        if self.listener.is_some() { return true; }
        if Self::HAS_H3 && self.h3_listener.is_some() { return true; }
        false
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

    pub fn deinit_if_we_can(&mut self) {
        if cfg!(debug_assertions) {
            httplog!(
                "deinitIfWeCan. requests={}, listener={}, websockets={}, has_handled_all_closed_promise={}, all_closed_promise={}, has_js_deinited={}",
                self.pending_requests,
                if self.listener.is_none() { "null" } else { "some" },
                if self.has_active_web_sockets() { "active" } else { "no" },
                self.flags.contains(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE),
                if self.all_closed_promise.has_value() { "has" } else { "no" },
                matches!(self.js_value, JsRef::Finalized),
            );
        }

        // SAFETY: bun_vm() returns the live per-thread VM singleton.
        let vm = unsafe { &mut *unsafe { &*self.global_this }.bun_vm() };

        if self.pending_requests == 0
            && !self.has_listener()
            && !self.has_active_web_sockets()
            && !self.flags.contains(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE)
            && self.all_closed_promise.has_value()
        {
            httplog!("schedule other promise");

            // use a flag here instead of `this.all_closed_promise.get().isHandled(vm)` to prevent the race condition of this block being called
            // again before the task has run.
            self.flags.insert(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE);

            // Duplicate the Strong handle so that we can hold two independent strong references to it.
            // PORT NOTE: reshaped for borrowck — Zig writes a fresh Strong then re-seats `set()`;
            // here we move the old handle out and create a second Strong from the same JSValue.
            // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
            let global_this = unsafe { &*self.global_this };
            let promise_value = self.all_closed_promise.value();
            let dup = mem::replace(
                &mut self.all_closed_promise,
                jsc::JSPromiseStrong::init(global_this),
            );
            // Restore the original promise value into the freshly-initted slot.
            self.all_closed_promise.set(global_this, promise_value);
            ServerAllConnectionsClosedTask::schedule(
                ServerAllConnectionsClosedTask {
                    global_object: unsafe { &*self.global_this },
                    promise: dup,
                    tracker: AsyncTaskTracker::init(vm),
                },
                vm,
            );
        }
        if self.pending_requests == 0 && !self.has_listener() && !self.has_active_web_sockets() {
            if let Some(ws) = &mut self.config.websocket {
                ws.handler.app = None;
            }
            self.unref();

            // Detach DevServer. This is needed because there are aggressive
            // tests that check for DevServer memory soundness. This reveals
            // a larger problem, that it seems that some objects like Server
            // should be detachable from their JSValue, so that when the
            // native handle is done, keeping the JS binding doesn't use
            // `this.memoryCost()` bytes.
            if let Some(dev) = self.dev_server.take() {
                if let Some(app) = self.app {
                    unsafe { &mut *app }.clear_routes();
                }
                drop(dev);
            }

            // Only free the memory if the JS reference has been freed too
            if matches!(self.js_value, JsRef::Finalized) {
                self.schedule_deinit();
            }
        }
    }

    pub fn stop_listening(&mut self, abrupt: bool) {
        httplog!("stopListening");
        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener.take() {
                // Graceful: GOAWAY + drain via the still-open UDP socket;
                // the engine rejects new conns and the timer keeps in-flight
                // streams progressing until deinit. Abrupt: close the fd now.
                if !abrupt {
                    if let Some(h3a) = self.h3_app { unsafe { &mut *h3a }.close(); }
                } else {
                    unsafe { &mut *h3l }.close();
                }
            }
        }
        let Some(listener) = self.listener.take() else {
            if Self::HAS_H3 {
                if self.h3_app.is_some() {
                    self.unref();
                    self.notify_inspector_server_stopped();
                    if abrupt {
                        self.flags.insert(ServerFlags::TERMINATED);
                    }
                }
            }
            return;
        };
        self.unref();

        if !SSL {
            // SAFETY: vm is the per-thread singleton; obtain *mut via VirtualMachine::get().
            unsafe { &mut *jsc::virtual_machine::VirtualMachine::get() }
                .remove_listening_socket_for_watch_mode(unsafe { &mut *listener }.socket::<SSL>().fd());
        }

        self.notify_inspector_server_stopped();

        if let server_config::Address::Unix(path) = &self.config.address {
            let path_bytes = path.as_bytes();
            if !path_bytes.is_empty() && path_bytes[0] != 0 {
                // SAFETY: CString guarantees a NUL terminator after as_bytes(); ZStr::from_raw bounds are met.
                let _ = sys::unlink(unsafe { ZStr::from_raw(path_bytes.as_ptr(), path_bytes.len()) });
            }
        }

        if !abrupt {
            unsafe { &mut *listener }.close();
        } else if !self.flags.contains(ServerFlags::TERMINATED) {
            if let Some(ws) = &mut self.config.websocket {
                ws.handler.app = None;
            }
            self.flags.insert(ServerFlags::TERMINATED);
            unsafe { &mut *self.app.unwrap() }.close();
        }
    }

    pub fn stop(&mut self, abrupt: bool) {
        if self.js_value.is_not_empty() {
            self.js_value.downgrade();
        }
        if self.config.allow_hot && !self.config.id.is_empty() {
            // SAFETY: bun_vm() returns the per-thread singleton VM pointer.
            if let Some(hot) = unsafe { &mut *(&*self.global_this).bun_vm() }.hot_map() {
                hot.remove(&self.config.id);
            }
        }

        self.stop_listening(abrupt);
        self.deinit_if_we_can();
    }

    pub fn schedule_deinit(&mut self) {
        if self.flags.contains(ServerFlags::DEINIT_SCHEDULED) {
            httplog!("scheduleDeinit (again)");
            return;
        }
        self.flags.insert(ServerFlags::DEINIT_SCHEDULED);
        httplog!("scheduleDeinit");

        if !self.flags.contains(ServerFlags::TERMINATED) {
            // App.close can cause finalizers to run.
            // scheduleDeinit can be called inside a finalizer.
            // Therefore, we split it into two tasks.
            self.flags.insert(ServerFlags::TERMINATED);
            // Zig: jsc.AnyTask.New(App, App.close).init(this.app.?)
            let task = Box::new(jsc::AnyTask::AnyTask {
                ctx: NonNull::new(self.app.unwrap().cast::<c_void>()),
                callback: |p| {
                    // SAFETY: ctx was stored from a live *mut ServerApp<SSL> above
                    unsafe { (*p.cast::<ServerApp<SSL>>()).close() };
                    Ok(())
                },
            });
            self.vm_mut().enqueue_task(jsc::Task::init(Box::into_raw(task)));
        }

        // Zig: jsc.AnyTask.New(ThisServer, deinit).init(this)
        let task = Box::new(jsc::AnyTask::AnyTask {
            ctx: NonNull::new((self as *mut Self).cast::<c_void>()),
            callback: |p| {
                Self::deinit(p.cast::<Self>());
                Ok(())
            },
        });
        self.vm_mut().enqueue_task(jsc::Task::init(Box::into_raw(task)));
    }

    fn notify_inspector_server_stopped(&mut self) {
        if self.inspector_server_id.get() != 0 {
            #[cold] fn cold() {}
            cold();
            if let Some(debugger) = &self.vm_mut().debugger {
                cold();
                // PORT NOTE (layering): the Zig `HTTPServerAgent.notifyServerStopped`
                // takes `AnyServer` and unpacks `inspector_server_id` itself.
                // The Rust `bun_jsc` tier can't name `AnyServer`, so the
                // tier-hoisted free fn takes `(agent_ptr, server_id, timestamp)`
                // directly — call it with the bits we have.
                if let Some(agent) = debugger.http_server_agent.agent {
                    // SAFETY: agent is a live C++ InspectorHTTPServerAgent while
                    // the debugger is attached.
                    unsafe {
                        bun_jsc::http_server_agent::notify_server_stopped(
                            agent.as_ptr(),
                            self.inspector_server_id,
                            bun_core::time::milli_timestamp() as f64,
                        );
                    }
                }
                self.inspector_server_id = DebuggerId::new(0);
            }
        }
    }

    pub fn deinit(this: *mut Self) {
        httplog!("deinit");
        // SAFETY: called from scheduled task; this was Box::into_raw'd in init()
        let this = unsafe { &mut *this };

        // This should've already been handled in stopListening
        // However, when the JS VM terminates, it hypothetically might not call stopListening
        this.notify_inspector_server_stopped();

        // PORT NOTE: owned-field cleanup (all_closed_promise / user_routes / config /
        // on_clienterror / h3_alt_svc / dev_server) is handled by the
        // Box::from_raw drop below. `plugins` is intrusively-refcounted and
        // released explicitly here (its `NonNull` field has no `Drop`).
        if let Some(p) = this.plugins.take() {
            // SAFETY: counted ref taken in `set_routes`; pairs with init's count=1.
            unsafe { ServePlugins::deref_(p.as_ptr()) };
        }
        if Self::HAS_H3 {
            if let Some(h3a) = this.h3_app.take() {
                // SAFETY: FFI destroy; h3a is a live H3::App handle owned by this server
                unsafe { uws::H3::App::destroy(h3a) };
            }
        }
        if let Some(app) = this.app.take() {
            // SAFETY: FFI destroy; app is a live uws App handle owned by this server
            unsafe { ServerApp::<SSL>::destroy(app) };
        }

        // SAFETY: this was Box::into_raw'd in init()
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn init(config: &mut ServerConfig, global: &JSGlobalObject) -> JsResult<*mut Self> {
        let base_url: Box<[u8]> = strings::trim(&config.base_uri, b"/").into();
        // errdefer free(base_url) — Box drops on Err automatically

        let dev_server: Option<Box<DevServer>> = if let Some(bake_options) = config.bake.take() {
            // PORT NOTE: `framework`/`bundler_options` are moved out of
            // `config.bake` (Zig copied the whole struct by value into the
            // server first, then read fields out of it). The arena that backs
            // `root` lives inside `bake_options.arena`; DevServer borrows it
            // for `'static` (arena outlives DevServer per Zig comment).
            let broadcast = config.broadcast_console_log_from_browser_to_server_for_bake;
            // Destructure via ManuallyDrop so UserOptions::drop doesn't run on
            // the moved-out fields (Zig moved by value; Rust UserOptions has Drop).
            let bake_options = mem::ManuallyDrop::new(bake_options);
            // SAFETY: `bake_options.arena` is moved into DevServer (transitively)
            // and outlives every borrow of `root`; lifetime erased to `'static`
            // per the same Phase-A convention used in `bake_body::UserOptions`.
            let arena: &'static bake::Arena = unsafe { &*(&bake_options.arena as *const _) };
            let root: &'static ZStr = bake_options.root;
            // SAFETY: bake_options is ManuallyDrop'd; these are the only reads.
            let framework = unsafe { core::ptr::read(&bake_options.framework) };
            let bundler_options = unsafe { core::ptr::read(&bake_options.bundler_options) };
            Some(dev_server_mod::init(dev_server_mod::Options {
                arena,
                root,
                vm: unsafe { &*jsc::VirtualMachine::get() },
                framework,
                bundler_options,
                broadcast_console_log_from_browser_to_server: broadcast,
                dump_sources: dev_server_mod::Options::DEFAULT_DUMP_SOURCES,
                dump_state_on_crash: None,
            })?)
        } else {
            None
        };
        // errdefer dev_server.deinit() — Box<DevServer> drops on Err automatically

        let server = Box::into_raw(Box::new(Self {
            global_this: global,
            config: mem::take(config),
            base_url_string_for_joining: base_url,
            // SAFETY: VirtualMachine::get() returns the live per-thread singleton
            vm: unsafe { &*VirtualMachine::VirtualMachine::get() },
            dev_server,
            // defaults:
            app: None,
            listener: None,
            h3_app: None,
            h3_listener: None,
            h3_alt_svc: Box::default(),
            js_value: JsRef::empty(),
            pending_requests: 0,
            // TODO(port): RequestContext.pool is a per-monomorphization threadlocal in Zig;
            // Rust thread_local! cannot be generic. Leak a fresh Fallback for now until the
            // ThisServerImpl::request_pool() trait shim is wired through.
            request_pool_allocator: Box::leak(Box::new(
                RequestContextStackAllocator::<SSL, DEBUG, false>::init(),
            )),
            h3_request_pool_allocator: Box::leak(Box::new(
                RequestContextStackAllocator::<SSL, DEBUG, true>::init(),
            )),
            all_closed_promise: jsc::JSPromiseStrong::default(),
            listen_callback: jsc::AnyTask::AnyTask::default(),
            poll_ref: KeepAlive::default(),
            flags: ServerFlags::default(),
            plugins: None,
            user_routes: Vec::new(),
            on_clienterror: jsc::StrongOptional::empty(),
            inspector_server_id: DebuggerId::new(0),
        }));

        // TODO(port): RequestContext.pool is a process-global static; pool_get_or_init() above
        // replaces the `if pool == null { create }` block.

        if SSL {
            analytics::Features::HTTPS_SERVER.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        } else {
            analytics::Features::HTTP_SERVER.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        }

        Ok(server)
    }

    #[cold]
    fn on_listen_failed(&mut self) {
        httplog!("onListenFailed");

        // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
        let global = unsafe { &*self.global_this };

        let mut error_instance = JSValue::ZERO;
        let mut output_buf = [0u8; 4096];

        if SSL {
            output_buf[0] = 0;
            let mut written: usize = 0;
            // SAFETY: FFI call into BoringSSL; no preconditions
            let mut ssl_error = unsafe { boringssl::c::ERR_get_error() };
            while ssl_error != 0 && written < output_buf.len() {
                if written > 0 {
                    output_buf[written] = b'\n';
                    written += 1;
                }

                // SAFETY: FFI call into BoringSSL; ssl_error is a valid packed error code
                let reason_ptr = unsafe { ERR_reason_error_string(ssl_error) };
                if !reason_ptr.is_null() {
                    // SAFETY: BoringSSL returns a NUL-terminated static string
                    let reason = unsafe { core::ffi::CStr::from_ptr(reason_ptr) }.to_bytes();
                    if reason.is_empty() {
                        break;
                    }
                    output_buf[written..written + reason.len()].copy_from_slice(reason);
                    written += reason.len();
                }

                // SAFETY: FFI call into BoringSSL; ssl_error is a valid packed error code
                let reason_ptr = unsafe { ERR_func_error_string(ssl_error) };
                if !reason_ptr.is_null() {
                    // SAFETY: BoringSSL returns a NUL-terminated static string
                    let reason = unsafe { core::ffi::CStr::from_ptr(reason_ptr) }.to_bytes();
                    if !reason.is_empty() {
                        output_buf[written..written + 5].copy_from_slice(b" via ");
                        written += 5;
                        output_buf[written..written + reason.len()].copy_from_slice(reason);
                        written += reason.len();
                    }
                }

                // SAFETY: FFI call into BoringSSL; ssl_error is a valid packed error code
                let reason_ptr = unsafe { ERR_lib_error_string(ssl_error) };
                if !reason_ptr.is_null() {
                    // SAFETY: BoringSSL returns a NUL-terminated static string
                    let reason = unsafe { core::ffi::CStr::from_ptr(reason_ptr) }.to_bytes();
                    if !reason.is_empty() {
                        output_buf[written] = b' ';
                        written += 1;
                        output_buf[written..written + reason.len()].copy_from_slice(reason);
                        written += reason.len();
                    }
                }

                // SAFETY: FFI call into BoringSSL; no preconditions
                ssl_error = unsafe { boringssl::c::ERR_get_error() };
            }

            if written > 0 {
                let message = &output_buf[0..written];
                error_instance = global.create_error_instance(format_args!("OpenSSL {}", BStr::new(message)));
                // SAFETY: FFI call into BoringSSL; no preconditions
                unsafe { boringssl::c::ERR_clear_error() };
            }
        }

        if error_instance.is_empty() {
            match &self.config.address {
                server_config::Address::Tcp { port, hostname } => 'error_set: {
                    #[cfg(target_os = "linux")]
                    {
                        let rc: i32 = -1;
                        let code = sys::get_errno(rc);
                        if code == sys::E::EACCES {
                            let mut cursor = &mut output_buf[..];
                            let msg = match write!(
                                cursor,
                                "permission denied {}:{}",
                                BStr::new(
                                    hostname.as_deref().map(|h| h.to_bytes()).unwrap_or(b"0.0.0.0")
                                ),
                                port
                            ) {
                                Ok(_) => {
                                    let n = 4096 - cursor.len();
                                    &output_buf[..n]
                                }
                                Err(_) => b"Failed to start server",
                            };
                            error_instance = (SystemError {
                                message: BunString::init(msg),
                                code: BunString::static_(b"EACCES"),
                                syscall: BunString::static_(b"listen"),
                                ..system_error_default()
                            })
                            .to_error_instance(global);
                            break 'error_set;
                        }
                    }
                    let mut cursor = &mut output_buf[..];
                    let msg = match write!(cursor, "Failed to start server. Is port {} in use?", port) {
                        Ok(_) => {
                            let n = 4096 - cursor.len();
                            &output_buf[..n]
                        }
                        Err(_) => b"Failed to start server",
                    };
                    error_instance = (SystemError {
                        message: BunString::init(msg),
                        code: BunString::static_(b"EADDRINUSE"),
                        syscall: BunString::static_(b"listen"),
                        ..system_error_default()
                    })
                    .to_error_instance(global);
                    let _ = hostname; // suppress unused on non-linux
                }
                server_config::Address::Unix(unix) => match sys::get_errno(-1i32) {
                    sys::E::SUCCESS => {
                        let mut cursor = &mut output_buf[..];
                        let msg = match write!(
                            cursor,
                            "Failed to listen on unix socket {}",
                            bun_fmt::QuotedFormatter { text: unix.as_bytes() }
                        ) {
                            Ok(_) => {
                                let n = 4096 - cursor.len();
                                &output_buf[..n]
                            }
                            Err(_) => b"Failed to start server",
                        };
                        error_instance = (SystemError {
                            message: BunString::init(msg),
                            code: BunString::static_(b"EADDRINUSE"),
                            syscall: BunString::static_(b"listen"),
                            ..system_error_default()
                        })
                        .to_error_instance(global);
                    }
                    e => {
                        let mut sys_err = sys::Error::from_code(e, sys::Tag::listen);
                        sys_err.path = unix.as_bytes().to_vec().into_boxed_slice();
                        error_instance = sys_err.to_js(global);
                    }
                },
            }
        }

        error_instance.ensure_still_alive();
        let _ = global.throw_value(error_instance);
    }

    pub fn on_listen(&mut self, socket: Option<*mut uws::ListenSocket>) {
        let Some(socket) = socket else {
            return self.on_listen_failed();
        };

        self.listener = Some(socket);
        self.vm_mut().event_loop_handle = Some(AsyncLoop::get());
        if !SSL {
            self.vm_mut().add_listening_socket_for_watch_mode(unsafe { &mut *socket }.socket::<SSL>().fd());
        }
    }

    pub fn h3_alt_svc(&self) -> Option<&[u8]> {
        if !Self::HAS_H3 { return None; }
        if self.h3_alt_svc.is_empty() { None } else { Some(&self.h3_alt_svc) }
    }

    pub fn on_h3_listen(&mut self, socket: Option<*mut uws::H3::ListenSocket>) {
        if !Self::HAS_H3 { unreachable!(); }
        self.h3_listener = socket;
        if let Some(s) = socket {
            let mut buf = Vec::new();
            // SAFETY: `s` is the live H3 listen-socket FFI handle just stored in
            // `h3_listener`; uws owns it until `stop_listening()`.
            match write!(&mut buf, "h3=\":{}\"; ma=86400", unsafe { &mut *s }.get_local_port()) {
                Ok(_) => self.h3_alt_svc = buf.into_boxed_slice(),
                Err(_) => self.h3_alt_svc = Box::default(),
            }
        }
    }

    pub fn on_h3_request(&mut self, req: &mut uws::H3::Request, resp: &mut uws::H3::Response) {
        if !Self::HAS_H3 { unreachable!(); }
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
        if !Self::HAS_H3 { unreachable!(); }
        Self::on_user_route_request_for::<ServerH3RequestContext<SSL, DEBUG>>(user_route, req, resp);
    }

    pub fn on_h3_404(_this: &mut Self, _req: &mut uws::H3::Request, resp: &mut uws::H3::Response) {
        if !Self::HAS_H3 { unreachable!(); }
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    pub fn ref_(&mut self) {
        if self.poll_ref.is_active() { return; }
        self.poll_ref.ref_(bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js));
    }

    pub fn unref(&mut self) {
        if !self.poll_ref.is_active() { return; }
        self.poll_ref.unref(bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js));
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

    pub fn on_bun_info_request(&mut self, req: &mut uws::Request, resp: &mut uws_sys::NewAppResponse<SSL>) {
        jsc::mark_binding!();
        self.pending_requests += 1;
        let _guard = scopeguard::guard((), |_| self.pending_requests -= 1);
        req.set_yield(false);
        // PERF(port): was stack-fallback alloc

        let buffer_writer = bun_js_printer::BufferWriter::init();
        let mut writer = bun_js_printer::BufferPrinter::init(buffer_writer);
        let source = logger::Source::init_empty_file(b"info.json");
        // SAFETY: `VirtualMachine::get()` is only called from the JS thread after VM init.
        let transpiler = unsafe { &(*VirtualMachine::VirtualMachine::get()).transpiler };
        let _ = bun_js_printer::print_json(
            &mut writer,
            BunInfo::generate(transpiler).expect("unreachable"),
            &source,
            bun_js_printer::PrintJsonOptions { mangled_props: None, ..Default::default() },
        );

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", &MimeType::JSON.value);
        resp.write_header(b"Cache-Control", b"public, max-age=3600");
        resp.write_header_int(b"Age", 0);
        let buffer = writer.ctx.written();
        resp.end(buffer, false);
    }

    pub fn on_pending_request(&mut self) {
        self.pending_requests += 1;
    }

    pub fn on_node_http_request_with_upgrade_ctx(
        &mut self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        upgrade_ctx: Option<&mut WebSocketUpgradeContext>,
    ) {
        self.on_pending_request();
        #[cfg(debug_assertions)]
        unsafe { (*self.vm.event_loop()).debug.enter() };
        let _dbg_guard = scopeguard::guard((), |_| {
            #[cfg(debug_assertions)]
            unsafe { (*self.vm.event_loop()).debug.exit() };
        });
        req.set_yield(false);
        resp.timeout(self.config.idle_timeout);

        // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
        let global = unsafe { &*self.global_this };
        let this_object: JSValue = self.js_value.try_get().unwrap_or(JSValue::UNDEFINED);
        // SAFETY: per-thread singleton VM; obtain *mut via VirtualMachine::get() to
        // avoid invalid_reference_casting on the stored `&'static`.
        let vm: *mut jsc::virtual_machine::VirtualMachine = jsc::virtual_machine::VirtualMachine::get();

        let mut node_http_response_raw: *mut NodeHTTPResponse = core::ptr::null_mut();
        let mut is_async = false;
        // PORT NOTE: Zig used `defer` for cleanup. There are no early returns
        // between here and the end of this fn, so the scopeguards have been
        // flattened to explicit cleanup at the bottom (avoids borrowck conflicts
        // from closure-captured `&mut` state).

        let on_node_http_request_fn = if SSL {
            NodeHTTPServer__onRequest_https
        } else {
            NodeHTTPServer__onRequest_http
        };

        let result: JSValue = match jsc::from_js_host_call(global, || unsafe {
            on_node_http_request_fn(
                self as *mut Self as usize,
                global,
                this_object,
                self.config.on_node_http_request.as_ref().map(|s| s.get()).unwrap_or(JSValue::UNDEFINED),
                if let Some(method) = http::Method::find(req.method()) {
                    method.to_js(global)
                } else {
                    JSValue::UNDEFINED
                },
                req,
                resp as *mut _ as *mut c_void,
                upgrade_ctx.map(|c| c as *mut _).unwrap_or(core::ptr::null_mut()),
                &mut node_http_response_raw,
            )
        }) {
            Ok(v) => v,
            Err(_) => global.take_exception(JsError::Thrown),
        };
        let node_http_response: Option<*mut NodeHTTPResponse> =
            (!node_http_response_raw.is_null()).then_some(node_http_response_raw);

        enum HTTPResult {
            Rejection(JSValue),
            Exception(JSValue),
            Success,
            Pending(JSValue),
        }
        let mut strong_promise = StrongOptional::empty();
        let mut needs_to_drain = true;

        let http_result: HTTPResult = 'brk: {
            if let Some(err) = result.to_error() {
                break 'brk HTTPResult::Exception(err);
            }

            if let Some(promise) = result.as_any_promise() {
                if promise.status() == jsc::js_promise::Status::Pending {
                    strong_promise.set(global, result);
                    needs_to_drain = false;
                    // SAFETY: see `vm` decl above — singleton VM.
                    unsafe { &mut *vm }.drain_microtasks();
                }

                match promise.status() {
                    jsc::js_promise::Status::Fulfilled => {
                        global.handle_rejected_promises();
                        break 'brk HTTPResult::Success;
                    }
                    jsc::js_promise::Status::Rejected => {
                        promise.set_handled(global.vm());
                        break 'brk HTTPResult::Rejection(promise.result(global.vm()));
                    }
                    jsc::js_promise::Status::Pending => {
                        global.handle_rejected_promises();
                        if let Some(node_response) = node_http_response {
                            let node_response = unsafe { &mut *node_response };
                            if node_response.flags.contains(super::node_http_response::Flags::REQUEST_HAS_COMPLETED)
                                || node_response.flags.contains(super::node_http_response::Flags::SOCKET_CLOSED)
                                || node_response.flags.contains(super::node_http_response::Flags::UPGRADED)
                            {
                                strong_promise.deinit();
                                break 'brk HTTPResult::Success;
                            }

                            let strong_self = node_response.get_this_value();

                            if strong_self.is_empty_or_undefined_or_null() {
                                strong_promise.deinit();
                                break 'brk HTTPResult::Success;
                            }

                            node_response.promise = mem::replace(&mut strong_promise, StrongOptional::empty());
                            // TODO: properly propagate exception upwards
                            result.then2(
                                global,
                                strong_self,
                                super::node_http_response::Bun__NodeHTTPRequest__onResolve,
                                super::node_http_response::Bun__NodeHTTPRequest__onReject,
                            );
                            is_async = true;
                        }

                        break 'brk HTTPResult::Pending(result);
                    }
                }
            }

            HTTPResult::Success
        };

        match &http_result {
            HTTPResult::Exception(err) | HTTPResult::Rejection(err) => {
                // SAFETY: see `vm` decl above — singleton VM.
                let _ = unsafe { &mut *vm }.uncaught_exception(global, *err, matches!(http_result, HTTPResult::Rejection(_)));

                if let Some(node_response) = node_http_response {
                    let node_response = unsafe { &mut *node_response };
                    if !node_response.flags.contains(super::node_http_response::Flags::UPGRADED) && node_response.raw_response.is_some() {
                        let raw_response = node_response.raw_response.unwrap();
                        if !node_response.flags.contains(super::node_http_response::Flags::REQUEST_HAS_COMPLETED) && raw_response.state().is_response_pending() {
                            if raw_response.state().is_http_status_called() {
                                raw_response.write_status(b"500 Internal Server Error");
                                raw_response.end_without_body(true);
                            } else {
                                raw_response.end_stream(true);
                            }
                        }
                    }
                    node_response.on_request_complete();
                }
            }
            HTTPResult::Success => {}
            HTTPResult::Pending(_) => {}
        }

        if let Some(node_response) = node_http_response {
            // SAFETY: node_response is a live NodeHTTPResponse held by the ref taken above
            let node_response = unsafe { &mut *node_response };
            if !node_response.flags.contains(super::node_http_response::Flags::UPGRADED) && node_response.raw_response.is_some() {
                let raw_response = node_response.raw_response.unwrap();
                if !node_response.flags.contains(super::node_http_response::Flags::REQUEST_HAS_COMPLETED) && raw_response.state().is_response_pending() {
                    node_response.set_on_aborted_handler();
                }
                // If we ended the response without attaching an ondata handler, we discard the body read stream
                else if !matches!(http_result, HTTPResult::Pending(_)) {
                    // SAFETY: see `vm` decl above — singleton VM.
                    node_response.maybe_stop_reading_body(unsafe { &mut *vm }, node_response.get_this_value());
                }
            }
        }

        // PORT NOTE: Zig `defer` cleanup, hoisted out of scopeguards (see comment above).
        // Drop order matches reverse-declaration: strong_promise, drain, node_http_response.
        strong_promise.deinit();
        if needs_to_drain {
            // SAFETY: see `vm` decl above — singleton VM.
            unsafe { &mut *vm }.drain_microtasks();
        }
        if !is_async {
            if let Some(node_response) = node_http_response {
                // SAFETY: node_response was returned by NodeHTTPServer__onRequest_* with a ref;
                // synchronous path drops that ref here (intrusive refcount)
                unsafe { &mut *node_response }.deref();
            }
        }
    }

    pub fn on_node_http_request(&mut self, req: &mut uws::Request, resp: &mut uws_sys::NewAppResponse<SSL>) {
        jsc::mark_binding!();
        self.on_node_http_request_with_upgrade_ctx(req, resp, None);
    }

    pub fn set_using_custom_expect_handler(&mut self, value: bool) {
        // SAFETY: FFI call; self.app is Some and points to a live uws App while server is reachable
        unsafe { NodeHTTP_setUsingCustomExpectHandler(SSL, self.app.unwrap() as *mut c_void, value) };
    }

    fn on_timeout_for_idle_warn(_: *mut c_void, _: Option<*mut c_void>) {
        // Registration is gated on `should_add_timeout_handler_for_warning`
        // (which already checks `DEBUG`), so this is reachable only in
        // debug-mode servers; the body matches the Zig spec.
        if DEBUG { on_timeout_for_idle_warn(); }
    }

    fn should_add_timeout_handler_for_warning(&self) -> bool {
        if DEBUG {
            if !did_send_idletimeout_warning_once().load(core::sync::atomic::Ordering::Relaxed)
                && !crate::cli::Command::get().debug.silent
            {
                return !self.config.has_idle_timeout;
            }
        }
        false
    }

    pub fn on_user_route_request(
        user_route: &mut UserRoute<SSL, DEBUG>,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        Self::on_user_route_request_for::<ServerRequestContext<SSL, DEBUG>>(user_route, req, resp);
    }

    fn on_user_route_request_for<Ctx: RequestCtxOps<Server = Self>>(
        user_route: &mut UserRoute<SSL, DEBUG>,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
    ) {
        // SAFETY: server backref outlives user_route
        let server_ptr = user_route.server as *mut Self;
        let server = unsafe { &mut *server_ptr };
        let index = user_route.id;

        let mut should_deinit_context = false;
        let Some(mut prepared) = server.prepare_js_request_context_for::<Ctx>(
            req,
            resp,
            Some(&mut should_deinit_context),
            CreateJsRequest::No,
            match user_route.route.method {
                server_config::RouteMethod::Any => None,
                server_config::RouteMethod::Specific(m) => Some(m),
            },
        ) else { return };

        // SAFETY: `server_ptr` outlives `prepared`; reborrow to break the
        // exclusive lifetime tie between `prepared` and `server`.
        let server = unsafe { &mut *server_ptr };
        let server_request_list = Self::js_route_list_get_cached(server.js_value_assert_alive()).unwrap();
        let call_route = if Ctx::IS_H3 { Bun__ServerRouteList__callRouteH3 } else { Bun__ServerRouteList__callRoute };
        // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
        let global = unsafe { &*server.global_this };
        let response_value = match jsc::from_js_host_call(global, || unsafe {
            call_route(
                global,
                index,
                prepared.request_object,
                server.js_value_assert_alive(),
                server_request_list,
                &mut prepared.js_request,
                req as *mut _ as *mut c_void,
            )
        }) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        server.handle_request_for::<Ctx>(&mut should_deinit_context, prepared, req, response_value);
    }

    fn handle_request(
        &mut self,
        should_deinit_context: &mut bool,
        prepared: ServerPreparedRequest<'_, SSL, DEBUG>,
        req: &mut uws::Request,
        response_value: JSValue,
    ) {
        self.handle_request_for::<ServerRequestContext<SSL, DEBUG>>(should_deinit_context, prepared, req, response_value);
    }

    fn handle_request_for<Ctx: RequestCtxOps<Server = Self>>(
        &mut self,
        should_deinit_context: &mut bool,
        prepared: PreparedRequestFor<'_, Ctx>,
        req: &mut Ctx::Req,
        response_value: JSValue,
    ) {
        let ctx = prepared.ctx;
        let request_object_ptr: *mut Request = prepared.request_object;
        let _detach_guard = scopeguard::guard((), |_| {
            // uWS request will not live longer than this function
            // SAFETY: request_object outlives this stack frame (boxed on the request).
            unsafe { (*request_object_ptr).request_context.detach_request() };
        });

        RequestCtxOps::on_response(ctx, self, prepared.js_request, response_value);
        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        *RequestCtxOps::defer_deinit_ptr(ctx) = None;

        if *should_deinit_context {
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

    pub fn on_request(&mut self, req: &mut uws::Request, resp: &mut uws_sys::NewAppResponse<SSL>) {
        self.on_request_for::<ServerRequestContext<SSL, DEBUG>>(req, resp);
    }

    fn on_request_for<Ctx: RequestCtxOps<Server = Self>>(
        &mut self,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
    ) {
        let self_ptr: *mut Self = self;
        let mut should_deinit_context = false;
        let Some(prepared) = self.prepare_js_request_context_for::<Ctx>(
            req,
            resp,
            Some(&mut should_deinit_context),
            CreateJsRequest::Yes,
            None,
        ) else { return };

        // SAFETY: `prepared` borrows into `*self` but the fields touched below
        // (`config.on_request`, `global_this`, `js_value`) are disjoint from
        // the request/ctx allocations it references. Reborrow to satisfy NLL.
        let this = unsafe { &mut *self_ptr };
        debug_assert!(this.config.on_request.is_some());

        // SAFETY: global_this set in init() and outlives ThisServer (JSC_BORROW)
        let global = unsafe { &*this.global_this };
        let js_value = this.js_value_assert_alive();
        let on_request_fn = this.config.on_request.as_ref().map(|s| s.get()).unwrap_or(JSValue::UNDEFINED);
        let response_value = match on_request_fn.call(
            global,
            js_value,
            &[prepared.js_request, js_value],
        ) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        this.handle_request_for::<Ctx>(&mut should_deinit_context, prepared, req, response_value);
    }

    pub fn on_saved_request<const ARG_COUNT: usize>(
        &mut self,
        mut req: SavedRequestUnion,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        callback: JSValue,
        extra_args: [JSValue; ARG_COUNT],
    ) {
        let self_ptr: *mut Self = self;
        let prepared: ServerPreparedRequest<'_, SSL, DEBUG> = match &mut req {
            SavedRequestUnion::Stack(r) => {
                // Reborrow the inner `&mut uws::Request` as a raw *mut to decouple
                // its lifetime from the `req` borrow used by the match guard.
                let r: *mut uws::Request = *r;
                match self.prepare_js_request_context(
                    // SAFETY: stack uws::Request still alive
                    unsafe { &mut *r },
                    resp,
                    None,
                    CreateJsRequest::Bake,
                    None,
                ) {
                    Some(p) => p,
                    None => return,
                }
            }
            SavedRequestUnion::Saved(data) => PreparedRequestFor {
                js_request: {
                    let v = data.js_request.get();
                    assert!(!v.is_empty(), "Request was unexpectedly freed");
                    v
                },
                // SAFETY: SavedRequest.request was Box-allocated by
                // `prepare_js_request_context_for` and lives until ctx deinit.
                request_object: unsafe { &mut *data.request },
                // SAFETY: SavedRequest.ctx was tagged as this server's
                // `ServerRequestContext<SSL,DEBUG>` by `PreparedRequestFor::save`.
                ctx: unsafe {
                    &mut *data
                        .ctx
                        .get::<ServerRequestContext<SSL, DEBUG>>()
                        .expect("SavedRequest ctx tag mismatch")
                },
            },
        };
        let ctx_ptr: *mut ServerRequestContext<SSL, DEBUG> = prepared.ctx;
        let request_object_ptr: *mut Request = prepared.request_object;
        let js_request = prepared.js_request;

        debug_assert!(!callback.is_empty());
        // PORT NOTE: Zig used `[1 + extra_args.len]jsc.JSValue` (comptime). Stable
        // Rust forbids `ARG_COUNT + 1` in const generics; use a small Vec — the
        // conservative GC scan covers the heap allocation as well as the stack.
        let mut args: Vec<JSValue> = Vec::with_capacity(ARG_COUNT + 1);
        args.push(js_request);
        args.extend_from_slice(&extra_args);
        // SAFETY: `prepared` borrows into `*self` (request/ctx allocations) but the
        // fields touched below (`global_this`, `js_value`) are disjoint. Reborrow
        // through a raw pointer to satisfy NLL — same pattern as `on_request_for`.
        let this = unsafe { &*self_ptr };
        let global = unsafe { &*this.global_this };
        let response_value = match callback.call(global, this.js_value_assert_alive(), &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        let is_stack = matches!(req, SavedRequestUnion::Stack(_));
        let _detach_guard = scopeguard::guard((), |_| {
            if is_stack {
                // uWS request will not live longer than this function
                // SAFETY: see request_object_ptr above.
                unsafe { (*request_object_ptr).request_context.detach_request() };
            }
        });

        // SAFETY: ctx_ptr/self_ptr are live for the request's duration; the
        // borrows held by `prepared` were dropped above.
        let ctx = unsafe { &mut *ctx_ptr };
        let original_state = mem::take(RequestCtxOps::defer_deinit_ptr(ctx));
        let mut should_deinit_context = false;
        *RequestCtxOps::defer_deinit_ptr(ctx) = Some(&mut should_deinit_context);
        RequestCtxOps::on_response(ctx, unsafe { &*self_ptr }, js_request, response_value);
        *RequestCtxOps::defer_deinit_ptr(ctx) = original_state;

        // Reference in the stack here in case it is not for whatever reason
        js_request.ensure_still_alive();

        if should_deinit_context {
            RequestCtxOps::deinit(ctx);
            return;
        }

        if RequestCtxOps::should_render_missing(ctx) {
            RequestCtxOps::render_missing(ctx);
            return;
        }

        // The request is asynchronous, and all information from `req` must be copied
        // since the provided uws.Request will be re-used for future requests (stack allocated).
        match req {
            SavedRequestUnion::Stack(r) => {
                RequestCtxOps::to_async(ctx, r, unsafe { &mut *request_object_ptr });
            }
            SavedRequestUnion::Saved(_) => {} // info already copied
        }
    }

    pub fn prepare_js_request_context(
        &mut self,
        req: &mut uws::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        should_deinit_context: Option<&mut bool>,
        create_js_request: CreateJsRequest,
        method: Option<http::Method>,
    ) -> Option<ServerPreparedRequest<'_, SSL, DEBUG>> {
        self.prepare_js_request_context_for::<ServerRequestContext<SSL, DEBUG>>(req, resp, should_deinit_context, create_js_request, method)
    }

    fn prepare_js_request_context_for<Ctx: RequestCtxOps<Server = Self>>(
        &mut self,
        req: &mut Ctx::Req,
        resp: &mut Ctx::Resp,
        should_deinit_context: Option<&mut bool>,
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

        let request_body_length: Option<usize> = 'request_body_length: {
            if http::Method::which(ReqLike::method(req)).unwrap_or(http::Method::OPTIONS).has_request_body() {
                let len: usize = 'brk: {
                    if let Some(content_length) = ReqLike::header(req, b"content-length") {
                        // Parse ASCII decimal directly off the byte slice — header bytes are not
                        // guaranteed UTF-8, and PORTING.md forbids from_utf8 on network bytes.
                        break 'brk bun_str::strings::parse_int::<usize>(content_length, 10).unwrap_or(0);
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

        #[cfg(debug_assertions)]
        unsafe { (*self.vm.event_loop()).debug.enter() };
        let _dbg_guard = scopeguard::guard((), |_| {
            #[cfg(debug_assertions)]
            unsafe { (*self.vm.event_loop()).debug.exit() };
        });
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
                did_send_idletimeout_warning_once().as_ptr() as *mut c_void,
            );
        }

        // SAFETY: both allocators hand out `*mut RequestContext<_, SSL, DEBUG, _>`; the
        // const-bool H3 parameter only affects associated consts/types, not layout, so
        // reinterpreting the slot pointer as the caller's `Ctx` monomorphization is sound.
        let ctx_slot: *mut Ctx = unsafe {
            if Ctx::IS_H3 {
                bun_core::handle_oom((*self.h3_request_pool_allocator).try_get()).cast()
            } else {
                bun_core::handle_oom((*self.request_pool_allocator).try_get()).cast()
            }
        }; // bun.handleOom — aborts on OOM
        let self_ptr: *const Self = self;
        Ctx::create_in(
            ctx_slot,
            self_ptr,
            req,
            resp,
            should_deinit_context.map(|r| r as *mut bool),
            method,
        );
        // SAFETY: ctx_slot was just initialized by create_in.
        let ctx = unsafe { &mut *ctx_slot };
        // SAFETY: jsc_vm is a live *mut VM while the JS thread is running
        // SAFETY: `jsc_vm` is the live JSC VM owned by the per-thread VirtualMachine.
        unsafe { &*self.vm.jsc_vm }.deprecated_report_extra_memory(mem::size_of::<Ctx>());

        // `vm.initRequestBodyValue(.{ .Null = {} })` — type-erased through the
        // RuntimeHooks vtable. The returned ptr is the `.value` field of a
        // `Body::Value::HiveRef` slot.
        let mut body_init = BodyValue::Null;
        let body_ptr = self
            .vm_mut()
            .init_request_body_value(&mut body_init as *mut BodyValue as *mut c_void)
            as *mut BodyValue;
        ctx.set_request_body(NonNull::new(body_ptr));

        let signal = AbortSignal::new(unsafe { &*self.global_this });
        ctx.set_signal(signal);
        // SAFETY: AbortSignal::new returns a +1-ref'd C++ opaque.
        unsafe { (*signal).pending_activity_ref() };

        // SAFETY: signal is a live AbortSignal; ref_() bumps for Request's copy.
        let _signal_for_req = unsafe { (*signal).ref_() };
        // TODO(port): Request.body field is `Box<BodyValue>` but the body is
        // hive-pooled (intrusive ref shared with ctx.request_body). Until that
        // field migrates to `*mut BodyValue`, allocate a fresh Null body for
        // the Request — the streaming body lives on `ctx.request_body`.
        let request_object_box = Request::new(Request::init(
            ctx.ctx_method(),
            AnyRequestContext::init(ctx as *const Ctx),
            SSL,
            // TODO(port): Request::init takes `Option<Arc<AbortSignal>>` but
            // signal is a raw +1 C++ ref. Pass None until the field type
            // unifies on `*mut AbortSignal` (matches Zig `signal.ref()`).
            None,
            Box::new(BodyValue::Null),
        ));
        let request_object: &mut Request =
            // SAFETY: leak so the ctx (which outlives this stack frame) can
            // hold the borrow; Request is freed via ctx.deinit's request_weakref.
            unsafe { &mut *Box::into_raw(request_object_box) };
        ctx.set_request_weakref(request_object);

        // The lazy `getRequest()` path that backs Request.url / .headers
        // is `*uws.Request`-typed; for HTTP/3 we populate both eagerly so
        // the rest of the pipeline never needs to know which transport
        // delivered the bytes.
        if Ctx::IS_H3 {
            // SAFETY: create_from_h3 returns a +1-ref FetchHeaders; adopt into RAII wrapper.
            request_object.set_fetch_headers(Some(unsafe {
                crate::webcore::response::HeadersRef::adopt(
                    FetchHeaders::create_from_h3(req as *mut _ as *mut c_void),
                )
            }));
            let path = ReqLike::url(req);
            if !path.is_empty() && path[0] == b'/' {
                if let Some(host) = ReqLike::header(req, b"host") {
                    let fmt = bun_fmt::HostFormatter { is_https: true, host, port: None };
                    let mut s = Vec::new();
                    write!(&mut s, "https://{}{}", fmt, BStr::new(path)).ok();
                    request_object.url = BunString::clone_utf8(&s);
                } else {
                    request_object.url = BunString::clone_utf8(path);
                }
            } else {
                request_object.url = BunString::clone_utf8(path);
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
                        task: ctx_slot as *mut c_void,
                        global: self.global_this,
                        on_start_buffering: Some(Ctx::on_start_buffering_callback),
                        on_start_streaming: Some(Ctx::on_start_streaming_request_body_callback),
                        on_readable_stream_available: Some(Ctx::on_request_body_readable_stream_available),
                        ..Default::default()
                    });
                }
                ctx.set_is_waiting_for_request_body(true);
                ctx.arm_on_data(resp);
            }
        }

        Some(PreparedRequestFor {
            js_request: match create_js_request {
                CreateJsRequest::Yes => request_object.to_js(unsafe { &*self.global_this }),
                CreateJsRequest::Bake => match request_object.to_js_for_bake(unsafe { &*self.global_this }) {
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
        // SAFETY: server backref outlives user_route
        let server_ptr = this.server as *mut Self;
        let index = this.id;

        let mut should_deinit_context = false;
        // SAFETY: server_ptr is live for the request's duration; re-borrowed
        // disjointly below to avoid the &mut held inside `prepared`.
        let Some(mut prepared) = (unsafe { &mut *server_ptr }).prepare_js_request_context(req, resp, Some(&mut should_deinit_context), CreateJsRequest::No, method) else { return };
        prepared.ctx.upgrade_context = Some(upgrade_ctx); // set the upgrade context
        let server_js = unsafe { &*server_ptr }.js_value_assert_alive();
        let server_request_list = Self::js_route_list_get_cached(server_js).unwrap();
        let global = unsafe { &*(*server_ptr).global_this };
        let response_value = match jsc::from_js_host_call(global, || unsafe {
            Bun__ServerRouteList__callRoute(
                global,
                index,
                prepared.request_object,
                server_js,
                server_request_list,
                &mut prepared.js_request,
                req as *mut _ as *mut c_void,
            )
        }) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        unsafe { &mut *server_ptr }.handle_request(&mut should_deinit_context, prepared, req, response_value);
    }

    pub fn on_web_socket_upgrade(
        &mut self,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        req: &mut uws::Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        jsc::mark_binding!();
        if id == 1 {
            // This is actually a UserRoute if id is 1 so it's safe to cast
            // SAFETY: uws passes the UserRoute* as the context when id == 1
            let user_route = unsafe { &mut *(self as *mut Self as *mut UserRoute<SSL, DEBUG>) };
            Self::upgrade_web_socket_user_route(user_route, resp, req, upgrade_ctx, None);
            return;
        }
        // Access `this` as *ThisServer only if id is 0
        debug_assert!(id == 0);
        if self.config.on_node_http_request.is_some() {
            self.on_node_http_request_with_upgrade_ctx(req, resp, Some(upgrade_ctx));
            return;
        }
        if self.config.on_request.is_none() {
            // require fetch method to be set otherwise we dont know what route to call
            // this should be the fallback in case no route is provided to upgrade
            resp.write_status(b"403 Forbidden");
            resp.end_without_body(true);
            return;
        }
        self.pending_requests += 1;
        req.set_yield(false);
        // SAFETY: handle_oom aborts on failure; pointer is non-null and owns a fresh pool slot.
        let ctx_slot = unsafe { bun_core::handle_oom((*self.request_pool_allocator).try_get()) };
        let mut should_deinit_context = false;
        let self_ptr: *mut Self = self;
        <ServerRequestContext<SSL, DEBUG> as RequestCtxOps>::create_in(
            ctx_slot,
            self_ptr,
            req,
            resp,
            Some(&mut should_deinit_context),
            None,
        );
        // SAFETY: ctx_slot was just initialized by create_in.
        let ctx = unsafe { &mut *ctx_slot };

        let mut body_init = BodyValue::Null;
        let body_ptr = self
            .vm_mut()
            .init_request_body_value(&mut body_init as *mut BodyValue as *mut c_void)
            as *mut BodyValue;
        ctx.request_body = NonNull::new(body_ptr);

        let signal = AbortSignal::new(unsafe { &*self.global_this });
        // SAFETY: AbortSignal::new returns a +1-ref'd C++ opaque.
        unsafe { (*signal).pending_activity_ref() };
        // SAFETY: signal is live; ref_() bumps for Request's copy.
        let _ = unsafe { (*signal).ref_() };
        let request_object_box = Request::new(Request::init(
            ctx.method,
            AnyRequestContext::init(ctx as *const _),
            SSL,
            None,
            Box::new(BodyValue::Null),
        ));
        ctx.upgrade_context = Some(upgrade_ctx);
        let request_object: &mut Request =
            // SAFETY: leaked so the ctx (which outlives this stack frame) can
            // hold the borrow; freed via ctx.deinit's request_weakref.
            unsafe { &mut *Box::into_raw(request_object_box) };
        ctx.request_weakref = bun_ptr::WeakPtr::<Request>::init_ref(request_object);

        // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
        let global = unsafe { &*self.global_this };
        let args = [
            request_object.to_js(global),
            self.js_value_assert_alive(),
        ];
        let request_value = args[0];
        request_value.ensure_still_alive();

        let response_value = match self.config.on_request.as_ref().unwrap().get().call(global, self.js_value_assert_alive(), &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };
        let request_object_ptr: *mut Request = request_object;
        let _detach_guard = scopeguard::guard((), |_| {
            // uWS request will not live longer than this function
            // SAFETY: see request_object above.
            unsafe { (*request_object_ptr).request_context.detach_request() };
        });

        // SAFETY: self_ptr is live for the request's duration; the &mut held
        // by ctx.create's BACKREF aliases disjoint fields.
        ctx.on_response(unsafe { &*self_ptr }, request_value, response_value);

        ctx.defer_deinit_until_callback_completes = None;

        if should_deinit_context {
            ctx.deinit();
            return;
        }

        if ctx.should_render_missing() {
            ctx.render_missing();
            return;
        }

        ctx.to_async(req, request_object);
    }

    // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
    fn on_chrome_dev_tools_json_request(
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
            let main = self.vm.main;
            let len = main.len().min(buffer.len());
            break 'brk hash(strings::copy_lowercase(&main[..len], &mut buffer[..len])).to_ne_bytes();
        };

        // And then we use a hash of their project root directory:
        let second_hash_segment: [u8; 8] = 'brk: {
            let mut buffer = paths::path_buffer_pool::get();
            let root = &self.dev_server.as_ref().unwrap().root;
            let len = root.len().min(buffer.len());
            break 'brk hash(strings::copy_lowercase(&root[..len], &mut buffer[..len])).to_ne_bytes();
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
            bun_fmt::format_json_string_utf8(&self.dev_server.as_ref().unwrap().root, Default::default()),
            uuid,
        )
        .ok();

        resp.write_status(b"200 OK");
        resp.write_header(b"Content-Type", b"application/json");
        resp.end(&json_string, resp.should_close_connection());
    }

    fn set_routes(&mut self) -> JSValue {
        let mut route_list_value = JSValue::ZERO;
        // SAFETY: self.app is Some and points to a live uws App; set_routes is only called after init().
        // Keep the raw `*mut` (`app_ptr`) for FFI/handler storage that needs write provenance, and
        // a shared `&` (`app`) for the route-registration helpers below which only need read access.
        let app_ptr = self.app.unwrap();
        // Reborrow per call site — `set_routes` interleaves `app` mutation with
        // `&mut self` access (config, user_routes, dev_server), so a single
        // long-lived `&mut *app_ptr` would alias.
        macro_rules! app { () => { unsafe { &mut *app_ptr } } }
        let any_server: super::AnyServer = self.as_any_server();
        let dev_server = self.dev_server.as_deref_mut();

        // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
        // Only enable this when we're using the dev server.
        let mut should_add_chrome_devtools_json_route = DEBUG
            && self.config.allow_hot
            && dev_server.is_some()
            && self.config.enable_chrome_devtools_automatic_workspace_folders;
        const CHROME_DEVTOOLS_ROUTE: &[u8] = b"/.well-known/appspecific/com.chrome.devtools.json";

        // --- 1. Handle user_routes_to_build (dynamic JS routes) ---
        // (This part remains conceptually the same: populate this.user_routes and route_list_value
        //  Crucially, ServerConfig.fromJS must ensure `route.method` is correctly .specific or .any)
        if !self.config.user_routes_to_build.is_empty() {
            let mut user_routes_to_build_list = mem::take(&mut self.config.user_routes_to_build);
            let old_user_routes = mem::replace(
                &mut self.user_routes,
                Vec::with_capacity(user_routes_to_build_list.len()),
            );
            // old_user_routes drops at scope end (RouteDeclaration impls Drop)
            let _ = old_user_routes;
            let mut paths_zig: Vec<ZigString> = Vec::with_capacity(user_routes_to_build_list.len());
            // GC-safe: each callback JSValue is read from a `Strong` (already rooted), so a
            // plain Vec is sufficient for the contiguous-buffer FFI hand-off below.
            // TODO(port): if/when callbacks are no longer Strong-held, switch to a scoped
            // MarkedArgumentBuffer (closure-style API) so heap storage stays GC-rooted.
            let mut callbacks_js: Vec<JSValue> = Vec::with_capacity(user_routes_to_build_list.len());

            for (i, builder) in user_routes_to_build_list.iter_mut().enumerate() {
                paths_zig.push(ZigString::init(builder.route.path.to_bytes()));
                callbacks_js.push(builder.callback.get());
                // PERF(port): was assume_capacity
                self.user_routes.push(UserRoute {
                    id: i as u32,
                    server: self,
                    route: mem::take(&mut builder.route), // Mark as moved
                });
            }
            // SAFETY: FFI into JSC; global_this is JSC_BORROW; callbacks_js/paths_zig point to
            // len-contiguous buffers valid for the duration of the call.
            route_list_value = unsafe {
                Bun__ServerRouteList__create(
                    &*self.global_this,
                    callbacks_js.as_mut_ptr(),
                    paths_zig.as_mut_ptr(),
                    user_routes_to_build_list.len(),
                )
            };
            // PORT NOTE: UserRouteBuilder cleanup is RAII (Drop) in Rust.
            drop(user_routes_to_build_list);
        }

        // --- 2. Setup WebSocket handler's app reference ---
        if let Some(websocket) = &mut self.config.websocket {
            websocket.global_object = self.global_this;
            // SAFETY: `app_ptr` is the original `*mut uws::NewApp<SSL>` stored in `self.app`;
            // the websocket handler later calls mutating uWS methods through it, so we must
            // preserve write provenance instead of routing through the `&` borrow.
            websocket.handler.app = Some(app_ptr as *mut c_void);
            websocket.handler.flags.set(super::web_socket_server_context::HandlerFlags::SSL, SSL);
        }

        // --- 3. Register compiled user routes (this.user_routes) & Track "/*" Coverage ---
        let mut star_methods_covered_by_user = MethodSet::empty();
        let mut has_any_user_route_for_star_path = false; // True if "/*" path appears in user_routes at all
        let mut has_any_ws_route_for_star_path = false;

        for user_route in &mut self.user_routes {
            let is_star_path = user_route.route.path.to_bytes() == b"/*";
            if is_star_path {
                has_any_user_route_for_star_path = true;
            }

            if should_add_chrome_devtools_json_route {
                if user_route.route.path.to_bytes() == CHROME_DEVTOOLS_ROUTE
                    || user_route.route.path.to_bytes().starts_with(b"/.well-known/")
                {
                    should_add_chrome_devtools_json_route = false;
                }
            }

            // Register HTTP routes
            match user_route.route.method {
                server_config::RouteMethod::Any => {
                    app!().any_ctx(user_route.route.path.to_bytes(), user_route, Self::on_user_route_request);
                    if Self::HAS_H3 {
                        if let Some(h3_app) = self.h3_app {
                            unsafe { &mut *h3_app }.any(user_route.route.path.to_bytes(), user_route as *mut _, Self::on_h3_user_route_request);
                        }
                    }
                    if is_star_path {
                        star_methods_covered_by_user = MethodSet::all();
                    }

                    if let Some(websocket) = &self.config.websocket {
                        if is_star_path {
                            has_any_ws_route_for_star_path = true;
                        }
                        app!().ws(
                            user_route.route.path.to_bytes(),
                            user_route as *mut _ as *mut c_void,
                            1, // id 1 means is a user route
                            ServerWebSocket::behavior::<Self, SSL>(websocket.to_behavior()),
                        );
                    }
                }
                server_config::RouteMethod::Specific(method_val) => {
                    // method_val is HTTP.Method here
                    app!().method_ctx(method_val, user_route.route.path.to_bytes(), user_route, Self::on_user_route_request);
                    if Self::HAS_H3 {
                        if let Some(h3_app) = self.h3_app {
                            unsafe { &mut *h3_app }.method(method_val, user_route.route.path.to_bytes(), user_route as *mut _, Self::on_h3_user_route_request);
                        }
                    }
                    if is_star_path {
                        star_methods_covered_by_user.insert(method_val);
                    }

                    // Setup user websocket in the route if needed.
                    if let Some(websocket) = &self.config.websocket {
                        // Websocket upgrade is a GET request
                        if method_val == Method::GET {
                            app!().ws(
                                user_route.route.path.to_bytes(),
                                user_route as *mut _ as *mut c_void,
                                1, // id 1 means is a user route
                                ServerWebSocket::behavior::<Self, SSL>(websocket.to_behavior()),
                            );
                        }
                    }
                }
            }
        }

        // --- 4. Register negative routes ---
        for route_path in &self.config.negative_routes {
            app!().head_ctx(route_path.to_bytes(), self, Self::on_request);
            app!().any_ctx(route_path.to_bytes(), self, Self::on_request);
            if Self::HAS_H3 {
                if let Some(h3_app) = self.h3_app {
                    let h3_app = unsafe { &mut *h3_app };
                    h3_app.head(route_path.to_bytes(), self as *mut _, Self::on_h3_request);
                    h3_app.any(route_path.to_bytes(), self as *mut _, Self::on_h3_request);
                }
            }
        }

        // --- 5. Register static routes & Track "/*" Coverage ---
        let mut needs_plugins = dev_server.is_some();
        let mut has_static_route_for_star_path = false;

        if !self.config.static_routes.is_empty() {
            for entry in &mut self.config.static_routes {
                if &*entry.path == b"/*" {
                    has_static_route_for_star_path = true;
                    match &entry.method {
                        server_config::MethodOptional::Any => {
                            star_methods_covered_by_user = MethodSet::all();
                        }
                        server_config::MethodOptional::Method(method) => {
                            star_methods_covered_by_user |= *method;
                        }
                    }
                }

                if should_add_chrome_devtools_json_route {
                    if &*entry.path == CHROME_DEVTOOLS_ROUTE || entry.path.starts_with(b"/.well-known/") {
                        should_add_chrome_devtools_json_route = false;
                    }
                }

                match &entry.route {
                    crate::server::AnyRoute::Static(static_route) => {
                        server_config::apply_static_route::<SSL, StaticRoute>(
                            any_server, app!(), static_route.as_ptr(), &entry.path, entry.method,
                        );
                        if Self::HAS_H3 {
                            if let Some(h3_app) = self.h3_app {
                                server_config::apply_static_route_h3::<StaticRoute>(
                                    any_server, unsafe { &mut *h3_app }, static_route.as_ptr(),
                                    &entry.path, entry.method,
                                );
                            }
                        }
                    }
                    crate::server::AnyRoute::File(file_route) => {
                        server_config::apply_static_route::<SSL, FileRoute>(
                            any_server, app!(), file_route.as_ptr(), &entry.path, entry.method,
                        );
                        if Self::HAS_H3 {
                            if let Some(h3_app) = self.h3_app {
                                server_config::apply_static_route_h3::<FileRoute>(
                                    any_server, unsafe { &mut *h3_app }, file_route.as_ptr(),
                                    &entry.path, entry.method,
                                );
                            }
                        }
                    }
                    crate::server::AnyRoute::Html(html_bundle_route) => {
                        if let Some(dev_server) = self.dev_server.as_deref_mut() {
                            // SAFETY: RefPtr.data is a live NonNull while in the route table.
                            let bundle = unsafe { (*html_bundle_route.data.as_ptr()).html_bundle() };
                            bun_core::handle_oom(dev_server.html_router.put(&entry.path, bundle));
                        } else {
                            server_config::apply_static_route::<SSL, html_bundle::Route>(
                                any_server, app!(), html_bundle_route.data.as_ptr(),
                                &entry.path, entry.method,
                            );
                            if Self::HAS_H3 {
                                if let Some(h3_app) = self.h3_app {
                                    server_config::apply_static_route_h3::<html_bundle::Route>(
                                        any_server, unsafe { &mut *h3_app },
                                        html_bundle_route.data.as_ptr(),
                                        &entry.path, entry.method,
                                    );
                                }
                            }
                        }
                        needs_plugins = true;
                    }
                    crate::server::AnyRoute::FrameworkRouter(_) => {}
                }
            }
        }

        // --- 6. Initialize plugins if needed ---
        if needs_plugins && self.plugins.is_none() {
            if let Some(serve_plugins_config) = &self.vm.transpiler.options.serve_plugins {
                if !serve_plugins_config.is_empty() {
                    // SAFETY: `ServePlugins::init` Box-allocates and returns the
                    // sole owning ref (count = 1); never null.
                    self.plugins = Some(unsafe {
                        NonNull::new_unchecked(ServePlugins::init(serve_plugins_config.clone()))
                    });
                }
            }
        }

        // --- 7. Debug mode specific routes ---
        if DEBUG {
            app!().get_ctx(b"/bun:info", self, Self::on_bun_info_request);
        }

        // Snapshot "/*" coverage from user/static routes before DevServer
        // (which is H1-only and not mirrored to the H3 router) marks it
        // as full.
        let h3_star_covered = star_methods_covered_by_user;

        // --- 8. Handle DevServer routes & Track "/*" Coverage ---
        let mut has_dev_server_for_star_path = false;
        if self.dev_server.is_some() {
            // dev.setRoutes might register its own "/*" HTTP handler
            // PORT NOTE: `DevServer::set_routes` is monomorphized over
            // `super::NewServer<SSL,DEBUG>` (mod.rs's struct). This module's
            // `NewServer` is the Phase-A duplicate; until they unify, route
            // through the type-erased `app_ptr` directly via a local helper.
            // TODO(port): once server_body::NewServer == super::NewServer,
            // call `dev.set_routes::<SSL,DEBUG>(self)` directly.
            has_dev_server_for_star_path = bun_core::handle_oom(
                self.dev_server.as_deref_mut().unwrap().set_routes_erased::<SSL>(app_ptr, any_server),
            );
            if has_dev_server_for_star_path {
                // Assume dev server "/*" covers all methods if it exists
                star_methods_covered_by_user = MethodSet::all();
            }
        }

        // Setup user websocket fallback route aka fetch function if fetch is not provided will respond with 403.
        if !has_any_ws_route_for_star_path {
            if let Some(websocket) = &self.config.websocket {
                app!().ws(
                    b"/*",
                    self as *mut _ as *mut c_void,
                    0,
                    ServerWebSocket::behavior::<Self, SSL>(websocket.to_behavior()),
                );
            }
        }

        // --- 9. Consolidated "/*" HTTP Fallback Registration ---
        if star_methods_covered_by_user == MethodSet::all() {
            // User/Static/Dev has already provided a "/*" handler for ALL methods.
            // No further global "/*" HTTP fallback needed.
        } else if has_any_user_route_for_star_path || has_static_route_for_star_path || has_dev_server_for_star_path {
            // A "/*" route exists, but doesn't cover all methods.
            // Apply the global handler to the *remaining* methods for "/*".
            // So we flip the bits for the methods that are not covered by the user/static/dev routes
            star_methods_covered_by_user = !star_methods_covered_by_user;
            for method_to_cover in star_methods_covered_by_user.iter() {
                if self.config.on_node_http_request.is_none() {
                    if self.config.on_request.is_none() {
                        app!().method_ctx(method_to_cover, b"/*", self, Self::on404);
                    } else {
                        app!().method_ctx(method_to_cover, b"/*", self, Self::on_request);
                    }
                } else {
                    app!().method_ctx(method_to_cover, b"/*", self, Self::on_node_http_request);
                }
            }
        } else {
            if self.config.on_node_http_request.is_none() {
                if self.config.on_request.is_none() {
                    app!().any_ctx(b"/*", self, Self::on404);
                } else {
                    app!().any_ctx(b"/*", self, Self::on_request);
                }
            } else {
                app!().any_ctx(b"/*", self, Self::on_node_http_request);
            }
        }

        // H3 fallback — same three-way as H1 above, but driven by
        // user/static "/*" coverage only (DevServer routes are not mirrored
        // to H3). h3_app.any("/*") would overwrite a user .any "/*"
        // mirrored above, so skip when coverage is already full;
        // for method-specific "/*" routes fill the complement per method.
        if Self::HAS_H3 {
            if let Some(h3_app) = self.h3_app {
                let h3_app = unsafe { &mut *h3_app };
                if h3_star_covered == MethodSet::all() {
                    // user/static "/*" already covers every method
                } else if has_any_user_route_for_star_path || has_static_route_for_star_path {
                    let mut uncovered = h3_star_covered;
                    uncovered = !uncovered;
                    for m in uncovered.iter() {
                        if self.config.on_request.is_some() {
                            h3_app.method(m, b"/*", self as *mut _, Self::on_h3_request);
                        } else {
                            h3_app.method(m, b"/*", self as *mut _, Self::on_h3_404);
                        }
                    }
                } else if self.config.on_request.is_some() {
                    h3_app.any(b"/*", self as *mut _, Self::on_h3_request);
                } else {
                    h3_app.any(b"/*", self as *mut _, Self::on_h3_404);
                }
            }
        }

        if should_add_chrome_devtools_json_route {
            app!().get_ctx(CHROME_DEVTOOLS_ROUTE, self, Self::on_chrome_dev_tools_json_request);
        }

        // If onNodeHTTPRequest is configured, it might be needed for Node.js compatibility layer
        // for specific Node API routes, even if it's not the main "/*" handler.
        if self.config.on_node_http_request.is_some() {
            // SAFETY: FFI registers Node-compat routes on the uWS app and needs write access;
            // pass the original `*mut` (`app_ptr`) rather than the narrowed `&` borrow.
            unsafe { NodeHTTP_assignOnNodeJSCompat(SSL, app_ptr as *mut c_void) };
        }

        route_list_value
    }

    pub fn on404(_this: &mut Self, req: &mut uws::Request, resp: &mut uws_sys::NewAppResponse<SSL>) {
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

    // TODO: make this return JSError!void, and do not deinitialize on synchronous failure, to allow errdefer in caller scope
    pub fn listen(&mut self) -> JSValue {
        httplog!("listen");
        let app: *mut ServerApp<SSL>;
        let global = unsafe { &*self.global_this };
        let mut route_list_value = JSValue::ZERO;
        if SSL {
            boringssl::load();
            // PORT NOTE: take a raw pointer so the immutable `ssl_config` borrow
            // doesn't span the `self.set_routes()` (`&mut self`) calls below.
            // The config slot is never reallocated for the lifetime of `listen()`.
            let ssl_config_ptr: *const server_config::SSLConfig =
                self.config.ssl_config.as_ref().expect("Assertion failure: ssl_config") as *const _;
            // SAFETY: see PORT NOTE — config slot stable across set_routes().
            let ssl_config = unsafe { &*ssl_config_ptr };
            // SAFETY: bun_uws::BunSocketContextOptions and bun_uws_sys::BunSocketContextOptions
            // are both #[repr(C)] mirrors of us_bun_socket_context_options_t.
            let ssl_options: bun_uws_sys::BunSocketContextOptions =
                unsafe { core::mem::transmute(ssl_config.as_usockets()) };

            app = match ServerApp::<SSL>::create(ssl_options) {
                Some(a) => a,
                None => {
                    if !global.has_exception() {
                        if !throw_ssl_error_if_necessary(global) {
                            let _ = global.throw(format_args!("Failed to create HTTP server"));
                        }
                    }
                    self.app = None;
                    Self::deinit(self);
                    return JSValue::ZERO;
                }
            };

            self.app = Some(app);

            if Self::HAS_H3 {
                if self.config.h3 {
                    self.h3_app = match uws::H3::App::create(ssl_options, u32::from(self.config.idle_timeout)) {
                        Some(a) => Some(a),
                        None => {
                            if !global.has_exception() {
                                let _ = global.throw(format_args!("Failed to create HTTP/3 server"));
                            }
                            Self::deinit(self);
                            return JSValue::ZERO;
                        }
                    };
                }
            }

            route_list_value = self.set_routes();

            // SAFETY: see PORT NOTE on ssl_config_ptr — reborrow after &mut self call.
            let ssl_config = unsafe { &*ssl_config_ptr };
            // add serverName to the SSL context using default ssl options
            if let Some(server_name_cstr) = ssl_config.server_name.as_deref() {
                let server_name = server_name_cstr.to_bytes();
                if !server_name.is_empty() {
                    if unsafe { &mut *app }.add_server_name_with_options(server_name_cstr, ssl_options).is_err() {
                        if !global.has_exception() {
                            if !throw_ssl_error_if_necessary(global) {
                                let _ = global.throw(format_args!("Failed to add serverName: {}", BStr::new(server_name)));
                            }
                        }
                        Self::deinit(self);
                        return JSValue::ZERO;
                    }
                    if throw_ssl_error_if_necessary(global) {
                        Self::deinit(self);
                        return JSValue::ZERO;
                    }

                    // SAFETY: CStr guarantees a NUL at .to_bytes().len().
                    unsafe { &mut *app }.domain(unsafe { ZStr::from_raw(server_name_cstr.as_ptr() as *const u8, server_name.len()) });
                    if throw_ssl_error_if_necessary(global) {
                        Self::deinit(self);
                        return JSValue::ZERO;
                    }

                    // Ensure the routes are set for that domain name.
                    let _ = self.set_routes();
                }
            }

            // apply SNI routes if any
            // PORT NOTE: snapshot SNI list as a raw slice so the loop body's
            // `self.set_routes()` (&mut self) doesn't conflict with the iterator.
            // `config.sni` storage is never reallocated during `listen()`.
            let sni_slice: &[server_config::SSLConfig] = match &self.config.sni {
                Some(sni) => unsafe { core::slice::from_raw_parts(sni.slice().as_ptr(), sni.slice().len()) },
                None => &[],
            };
            {
                for sni_ssl_config in sni_slice {
                    let sni_name_cstr = sni_ssl_config.server_name.as_deref().unwrap();
                    let sni_servername = sni_name_cstr.to_bytes();
                    // SAFETY: same #[repr(C)] mirror as `ssl_options` above.
                    let sni_opts: bun_uws_sys::BunSocketContextOptions =
                        unsafe { core::mem::transmute(sni_ssl_config.as_usockets()) };
                    if !sni_servername.is_empty() {
                        if Self::HAS_H3 {
                            if let Some(h3a) = self.h3_app {
                                // SAFETY: CStr guarantees a NUL at .to_bytes().len().
                                let sni_zstr = unsafe { ZStr::from_raw(sni_name_cstr.as_ptr() as *const u8, sni_servername.len()) };
                                if unsafe { &mut *h3a }.add_server_name_with_options(sni_zstr, sni_opts).is_err() {
                                    if !global.has_exception() {
                                        let _ = global.throw(format_args!("Failed to add serverName \"{}\" for HTTP/3", BStr::new(sni_servername)));
                                    }
                                    Self::deinit(self);
                                    return JSValue::ZERO;
                                }
                            }
                        }
                        if unsafe { &mut *app }.add_server_name_with_options(sni_name_cstr, sni_opts).is_err() {
                            if !global.has_exception() {
                                if !throw_ssl_error_if_necessary(global) {
                                    let _ = global.throw(format_args!("Failed to add serverName: {}", BStr::new(sni_servername)));
                                }
                            }
                            Self::deinit(self);
                            return JSValue::ZERO;
                        }

                        // SAFETY: CStr guarantees a NUL at .to_bytes().len().
                        unsafe { &mut *app }.domain(unsafe { ZStr::from_raw(sni_name_cstr.as_ptr() as *const u8, sni_servername.len()) });

                        if throw_ssl_error_if_necessary(global) {
                            Self::deinit(self);
                            return JSValue::ZERO;
                        }

                        // Ensure the routes are set for that domain name.
                        let _ = self.set_routes();
                    }
                }
            }
        } else {
            app = match ServerApp::<SSL>::create(Default::default()) {
                Some(a) => a,
                None => {
                    if !global.has_exception() {
                        let _ = global.throw(format_args!("Failed to create HTTP server"));
                    }
                    Self::deinit(self);
                    return JSValue::ZERO;
                }
            };
            self.app = Some(app);

            route_list_value = self.set_routes();
        }

        if self.config.on_node_http_request.is_some() {
            self.set_using_custom_expect_handler(true);
        }

        match &self.config.address {
            server_config::Address::Tcp { port, hostname } => {
                let tcp_port = *port;
                let mut host: Option<*const c_char> = None;
                let mut host_buff = [0u8; 1025]; // [1024:0]u8

                if let Some(existing) = hostname.as_deref() {
                    let hb = existing.to_bytes();
                    if hb.len() > 2 && hb[0] == b'[' {
                        // remove "[" and "]" from hostname
                        let inner = &hb[1..hb.len() - 1];
                        host_buff[..inner.len()].copy_from_slice(inner);
                        host_buff[inner.len()] = 0;
                        host = Some(host_buff.as_ptr() as *const c_char);
                    } else {
                        host = Some(existing.as_ptr());
                    }
                }

                if self.config.h1 {
                    extern "C" fn on_listen_cb<const SSL: bool, const DEBUG: bool>(
                        socket: *mut uws_sys::ListenSocket,
                        user_data: *mut c_void,
                    ) {
                        // SAFETY: user_data is the `*mut NewServer<..>` passed to listen_with_config.
                        let server = unsafe { &mut *(user_data as *mut NewServer<SSL, DEBUG>) };
                        server.on_listen(if socket.is_null() { None } else { Some(socket) });
                    }
                    // SAFETY: app is a live uws App FFI handle owned by this server
                    unsafe { &mut *app }.listen_with_config(
                        Some(on_listen_cb::<SSL, DEBUG>),
                        self as *mut Self as *mut c_void,
                        uws_sys::app::c::uws_app_listen_config_t {
                            port: tcp_port as c_int,
                            host: host.unwrap_or(core::ptr::null()),
                            options: self.config.get_usockets_options(),
                        },
                    );
                }

                if Self::HAS_H3 {
                    if let Some(h3_app) = self.h3_app {
                        // Same UDP port as the TCP listener so Alt-Svc works.
                        let h3_port: u16 = if let Some(ls) = self.listener {
                            // SAFETY: listener is a live uws ListenSocket FFI handle (just set by on_listen)
                            u16::try_from(unsafe { &mut *ls }.get_local_port()).unwrap()
                        } else {
                            tcp_port
                        };
                        let h3_options = self.config.get_usockets_options();
                        // SAFETY: h3_app is a live H3::App FFI handle owned by this server
                        unsafe { &mut *h3_app }.listen_with_config(
                            self as *mut Self,
                            |s: &mut Self, ls: Option<&mut uws::H3::ListenSocket>| {
                                s.on_h3_listen(ls.map(|l| l as *mut _));
                            },
                            uws::H3::ListenConfig {
                                port: h3_port,
                                host: host.unwrap_or(core::ptr::null()),
                                options: h3_options,
                            },
                        );
                        if self.h3_listener.is_none() {
                            if !global.has_exception() {
                                let _ = global.throw(format_args!("Failed to listen on UDP port {} for HTTP/3", h3_port));
                            }
                            Self::deinit(self);
                            return JSValue::ZERO;
                        }
                        if !self.config.h1 {
                            self.vm_mut().event_loop_handle = Some(AsyncLoop::get());
                        }
                    }
                }
            }
            server_config::Address::Unix(unix) => {
                if Self::HAS_H3 {
                    if let Some(h3a) = self.h3_app.take() {
                        // QUIC over AF_UNIX is non-standard and Alt-Svc can't
                        // advertise it. Drop the H3 listener rather than wire
                        // an exotic transport nobody can reach.
                        Output::warn(format_args!("h3: true with a unix socket — HTTP/3 listener skipped"));
                        // SAFETY: FFI destroy; h3a is a live H3::App handle just taken from this.h3_app
                        unsafe { uws::H3::App::destroy(h3a) };
                    }
                }
                extern "C" fn on_listen_unix_cb<const SSL: bool, const DEBUG: bool>(
                    socket: *mut uws_sys::ListenSocket,
                    _domain: *const c_char,
                    _flags: i32,
                    user_data: *mut c_void,
                ) {
                    // SAFETY: user_data is the `*mut NewServer<..>` passed to listen_on_unix_socket.
                    let server = unsafe { &mut *(user_data as *mut NewServer<SSL, DEBUG>) };
                    server.on_listen(if socket.is_null() { None } else { Some(socket) });
                }
                // SAFETY: `unix` is a CString — bytes are NUL-terminated with no interior NUL.
                let unix_z = unsafe {
                    ZStr::from_raw(unix.as_bytes().as_ptr(), unix.as_bytes().len())
                };
                // SAFETY: app is a live uws App FFI handle owned by this server
                unsafe { &mut *app }.listen_on_unix_socket(
                    on_listen_unix_cb::<SSL, DEBUG>,
                    self as *mut Self as *mut c_void,
                    unix_z,
                    self.config.get_usockets_options(),
                );
            }
        }

        if global.has_exception() {
            Self::deinit(self);
            return JSValue::ZERO;
        }

        self.ref_();

        // Starting up an HTTP server is a good time to GC
        if self.vm.aggressive_garbage_collection == jsc::virtual_machine::GCLevel::Aggressive {
            self.vm.auto_garbage_collect();
        } else {
            // SAFETY: event_loop() returns a live *mut EventLoop owned by the VM.
            unsafe { (*self.vm.event_loop()).perform_gc() };
        }

        route_list_value
    }

    pub fn on_client_error_callback(&mut self, socket: &mut uws::Socket, error_code: u8, raw_packet: &[u8]) {
        let Some(callback) = self.on_clienterror.get() else { return };
        {
            let is_ssl = SSL;
            let global = unsafe { &*self.global_this };
            let node_socket = match jsc::from_js_host_call(global, || unsafe {
                Bun__createNodeHTTPServerSocketForClientError(is_ssl, socket as *mut _ as *mut c_void, global)
            }) {
                Ok(v) => v,
                Err(_) => return,
            };
            if node_socket.is_undefined_or_null() {
                return;
            }

            let error_code_value = JSValue::js_number(error_code as f64);
            let raw_packet_value = match ArrayBuffer::create_buffer(global, raw_packet) {
                Ok(v) => v,
                Err(_) => return, // TODO: properly propagate exception upwards
            };
            // SAFETY: bun_vm()/event_loop() return live raw pointers tied to the global.
            let event_loop = unsafe { &mut *(*global.bun_vm()).event_loop() };
            event_loop.enter();
            let _exit_guard = scopeguard::guard((), |_| event_loop.exit());
            if let Err(err) = callback.call(
                global,
                JSValue::UNDEFINED,
                &[JSValue::from(is_ssl), node_socket, error_code_value, raw_packet_value],
            ) {
                global.report_active_exception_as_unhandled(err);
            }
        }
    }

    /// `js.gc.routeList.set` — write the codegen'd `WriteBarrier<Unknown>`
    /// slot on the per-type C++ wrapper so route JS objects stay GC-rooted.
    pub fn js_gc_route_list_set(server_js: JSValue, global: &JSGlobalObject, route_list: JSValue) {
        match (SSL, DEBUG) {
            (false, false) => http_server_cached::route_list_set_cached(server_js, global, route_list),
            (true, false) => https_server_cached::route_list_set_cached(server_js, global, route_list),
            (false, true) => debug_http_server_cached::route_list_set_cached(server_js, global, route_list),
            (true, true) => debug_https_server_cached::route_list_set_cached(server_js, global, route_list),
        }
    }

    /// Wrap an already-heap-allocated server pointer in its JS object.
    /// Ownership transfers to the C++ wrapper (freed via `finalize`).
    pub fn ptr_to_js(this: *mut Self, global: &JSGlobalObject) -> JSValue {
        // PORT NOTE: routes through the `JsClass::to_js` impl below; that impl
        // currently `Box::into_raw`s its by-value receiver. To avoid a
        // move/double-own, call the codegen extern directly once it lands;
        // until then, the by-value path takes a bitwise read of `*this` and
        // hands it back to the same heap slot, so use the codegen `to_js`
        // shim that accepts a raw pointer.
        super::server_js_create(this.cast(), global, SSL, DEBUG)
    }
    /// `js.routeListGetCached` — read back the codegen'd `WriteBarrier` slot.
    fn js_route_list_get_cached(server_js: JSValue) -> Option<JSValue> {
        match (SSL, DEBUG) {
            (false, false) => http_server_cached::route_list_get_cached(server_js),
            (true, false) => https_server_cached::route_list_get_cached(server_js),
            (false, true) => debug_http_server_cached::route_list_get_cached(server_js),
            (true, true) => debug_https_server_cached::route_list_get_cached(server_js),
        }
    }
}

// Per-type cached-accessor shims for the `routeList` `WriteBarrier` slot.
// `codegen_cached_accessors!` emits `route_list_{get,set}_cached` wrapping
// `${T}Prototype__routeList{Get,Set}CachedValue` (generate-classes.ts).
mod http_server_cached { bun_jsc::codegen_cached_accessors!("HTTPServer"; routeList); }
mod https_server_cached { bun_jsc::codegen_cached_accessors!("HTTPSServer"; routeList); }
mod debug_http_server_cached { bun_jsc::codegen_cached_accessors!("DebugHTTPServer"; routeList); }
mod debug_https_server_cached { bun_jsc::codegen_cached_accessors!("DebugHTTPSServer"; routeList); }

// ─── SavedRequest ────────────────────────────────────────────────────────────
pub struct SavedRequest {
    pub js_request: Strong,
    /// Heap `*mut Request` (Box-allocated by `prepare_js_request_context_for`).
    /// Raw because the saved request outlives the borrow scope of `prepared`.
    pub request: *mut Request,
    pub ctx: AnyRequestContext,
    pub response: uws::AnyResponse,
}

impl Drop for SavedRequest {
    fn drop(&mut self) {
        // js_request: Strong impls Drop (deallocates HandleSlot); do not double-free here.
        // Only the intrusive-refcount deref on ctx is a non-field-ownership side effect.
        self.ctx.deref();
    }
}

pub enum SavedRequestUnion<'a> {
    /// Direct pointer to a µWebSockets request that is still on the stack.
    /// Used for synchronous request handling where the request can be processed
    /// immediately within the current call frame. This avoids heap allocation
    /// and is more efficient for simple, fast operations.
    Stack(&'a mut uws::Request),

    /// A heap-allocated copy of the request data that persists beyond the
    /// initial request handler. Used when request processing needs to be
    /// deferred (e.g., async operations, waiting for framework initialization).
    /// Contains strong references to JavaScript objects and all context needed
    /// to complete the request later.
    Saved(SavedRequest),
}

// ─── ServerAllConnectionsClosedTask ──────────────────────────────────────────
pub struct ServerAllConnectionsClosedTask {
    pub global_object: &'static JSGlobalObject, // JSC_BORROW
    pub promise: jsc::JSPromiseStrong,
    pub tracker: AsyncTaskTracker,
}

impl bun_event_loop::Taskable for ServerAllConnectionsClosedTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ServerAllConnectionsClosedTask;
}

impl ServerAllConnectionsClosedTask {
    pub fn schedule(this: ServerAllConnectionsClosedTask, vm: &jsc::virtual_machine::VirtualMachine) {
        let ptr = Box::into_raw(Box::new(this));
        // SAFETY: event_loop() returns a live *mut EventLoop owned by the VM.
        unsafe { (*vm.event_loop()).enqueue_task(jsc::Task::init(ptr)) };
    }

    pub fn run_from_js_thread(this: *mut Self, vm: &jsc::virtual_machine::VirtualMachine) -> Result<(), jsc::JsTerminated> {
        httplog!("ServerAllConnectionsClosedTask runFromJSThread");

        // SAFETY: ptr was Box::into_raw'd in schedule()
        let this = unsafe { Box::from_raw(this) };
        let global_object = this.global_object;
        let tracker = this.tracker;
        tracker.will_dispatch(global_object);
        let _guard = scopeguard::guard((), |_| tracker.did_dispatch(global_object));

        let mut promise = this.promise;
        // promise drops at scope end

        if !vm.is_shutting_down() {
            promise.resolve(global_object, JSValue::UNDEFINED)?;
        }
        Ok(())
    }
}

// ─── Type aliases ────────────────────────────────────────────────────────────
pub type HTTPServer = NewServer<false, false>;
pub type HTTPSServer = NewServer<true, false>;
pub type DebugHTTPServer = NewServer<false, true>;
pub type DebugHTTPSServer = NewServer<true, true>;

// JsClass impls for the four server monomorphizations. The `#[bun_jsc::JsClass]`
// proc-macro normally emits these (binding to `{Type}__fromJS`/`{Type}__create`
// generated by .classes.ts codegen); hand-written extern decls until that
// codegen targets Rust directly.
macro_rules! impl_server_jsclass {
    ($ty:ident, $from_js:ident, $from_js_direct:ident, $create:ident, $get_ctor:ident) => {
        const _: () = {
            unsafe extern "C" {
                fn $from_js(value: JSValue) -> Option<NonNull<$ty>>;
                fn $from_js_direct(value: JSValue) -> Option<NonNull<$ty>>;
                fn $create(ptr: *mut $ty, global: *const JSGlobalObject) -> JSValue;
                fn $get_ctor(global: *const JSGlobalObject) -> JSValue;
            }
            impl bun_jsc::JsClass for $ty {
                fn from_js(value: JSValue) -> Option<*mut Self> {
                    // SAFETY: thin FFI forward into generated `${T}__fromJS`.
                    unsafe { $from_js(value) }.map(|p| p.as_ptr())
                }
                fn from_js_direct(value: JSValue) -> Option<*mut Self> {
                    // SAFETY: thin FFI forward into generated `${T}__fromJSDirect`.
                    unsafe { $from_js_direct(value) }.map(|p| p.as_ptr())
                }
                fn to_js(self, global: &JSGlobalObject) -> JSValue {
                    // SAFETY: `${T}__create` takes ownership of the heap ptr.
                    unsafe { $create(Box::into_raw(Box::new(self)), global) }
                }
                fn get_constructor(global: &JSGlobalObject) -> JSValue {
                    // SAFETY: thin FFI forward.
                    unsafe { $get_ctor(global) }
                }
            }
        };
    };
}
impl_server_jsclass!(HTTPServer, HTTPServer__fromJS, HTTPServer__fromJSDirect, HTTPServer__create, HTTPServer__getConstructor);
impl_server_jsclass!(HTTPSServer, HTTPSServer__fromJS, HTTPSServer__fromJSDirect, HTTPSServer__create, HTTPSServer__getConstructor);
impl_server_jsclass!(DebugHTTPServer, DebugHTTPServer__fromJS, DebugHTTPServer__fromJSDirect, DebugHTTPServer__create, DebugHTTPServer__getConstructor);
impl_server_jsclass!(DebugHTTPSServer, DebugHTTPSServer__fromJS, DebugHTTPSServer__fromJSDirect, DebugHTTPSServer__create, DebugHTTPSServer__getConstructor);


// ─── AnyServer ───────────────────────────────────────────────────────────────
#[derive(Clone, Copy)]
pub struct AnyServer {
    pub ptr: TaggedPtrUnion<AnyServerTypes>,
}

pub enum AnyUserRouteList<'a> {
    HTTPServer(&'a [UserRoute<false, false>]),
    HTTPSServer(&'a [UserRoute<true, false>]),
    DebugHTTPServer(&'a [UserRoute<false, true>]),
    DebugHTTPSServer(&'a [UserRoute<true, true>]),
}

macro_rules! any_server_dispatch {
    ($self:expr, |$s:ident| $body:expr) => {
        match $self.ptr.tag() {
            // SAFETY: tag was just checked; as_unchecked yields the matching live *mut.
            t if t == <TaggedPtrUnion<_>>::case::<HTTPServer>() => { let $s = unsafe { &mut *$self.ptr.as_unchecked::<HTTPServer>() }; $body }
            t if t == <TaggedPtrUnion<_>>::case::<HTTPSServer>() => { let $s = unsafe { &mut *$self.ptr.as_unchecked::<HTTPSServer>() }; $body }
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPServer>() => { let $s = unsafe { &mut *$self.ptr.as_unchecked::<DebugHTTPServer>() }; $body }
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPSServer>() => { let $s = unsafe { &mut *$self.ptr.as_unchecked::<DebugHTTPSServer>() }; $body }
            _ => unreachable!("Invalid pointer tag"),
        }
    };
}

impl AnyServer {
    pub fn user_routes(&self) -> AnyUserRouteList<'_> {
        match self.ptr.tag() {
            // SAFETY: tag was just checked; as_unchecked yields the matching live *mut.
            t if t == <TaggedPtrUnion<_>>::case::<HTTPServer>() => AnyUserRouteList::HTTPServer(&unsafe { &*self.ptr.as_unchecked::<HTTPServer>() }.user_routes),
            t if t == <TaggedPtrUnion<_>>::case::<HTTPSServer>() => AnyUserRouteList::HTTPSServer(&unsafe { &*self.ptr.as_unchecked::<HTTPSServer>() }.user_routes),
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPServer>() => AnyUserRouteList::DebugHTTPServer(&unsafe { &*self.ptr.as_unchecked::<DebugHTTPServer>() }.user_routes),
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPSServer>() => AnyUserRouteList::DebugHTTPSServer(&unsafe { &*self.ptr.as_unchecked::<DebugHTTPSServer>() }.user_routes),
            _ => unreachable!("Invalid pointer tag"),
        }
    }

    pub fn get_url_as_string(&self) -> Result<BunString, AllocError> {
        any_server_dispatch!(self, |s| s.get_url_as_string())
    }

    pub fn vm(&self) -> &'static jsc::virtual_machine::VirtualMachine {
        any_server_dispatch!(self, |s| s.vm)
    }

    /// Cached `h3=":<port>"; ma=86400` for Alt-Svc on H1/H2 responses, or
    /// None when the server has no H3 listener. Static/file/HTML routes
    /// emit it via this so browsers discover the QUIC endpoint regardless
    /// of which response path produced the body.
    pub fn h3_alt_svc(&self) -> Option<&[u8]> {
        match self.ptr.tag() {
            // SAFETY: tag was just checked; as_unchecked yields the matching live *mut.
            t if t == <TaggedPtrUnion<_>>::case::<HTTPSServer>() => unsafe { &*self.ptr.as_unchecked::<HTTPSServer>() }.h3_alt_svc(),
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPSServer>() => unsafe { &*self.ptr.as_unchecked::<DebugHTTPSServer>() }.h3_alt_svc(),
            _ => None,
        }
    }

    pub fn set_inspector_server_id(&self, id: DebuggerId) {
        any_server_dispatch!(self, |s| {
            s.inspector_server_id = id;
            if let Some(dev_server) = &mut s.dev_server {
                dev_server.inspector_server_id = id;
            }
        })
    }

    pub fn inspector_server_id(&self) -> DebuggerId {
        any_server_dispatch!(self, |s| s.inspector_server_id)
    }

    pub fn plugins(&self) -> Option<&ServePlugins> {
        // SAFETY: `plugins` holds a counted ref; live while the server is.
        any_server_dispatch!(self, |s| s.plugins.map(|p| unsafe { &*p.as_ptr() }))
    }

    pub fn get_plugins(&self) -> PluginsResult<'_> {
        any_server_dispatch!(self, |s| s.get_plugins())
    }

    pub fn load_and_resolve_plugins(
        &self,
        bundle: &mut html_bundle::HTMLBundleRoute,
        raw_plugins: &[&[u8]],
        bunfig_path: &[u8],
    ) {
        any_server_dispatch!(self, |s| s.get_plugins_async(bundle, raw_plugins, bunfig_path))
    }

    /// Returns:
    /// - .ready if no plugin has to be loaded
    /// - .err if there is a cached failure. Currently, this requires restarting the entire server.
    /// - .pending if `callback` was stored. It will call `onPluginsResolved` or `onPluginsRejected` later.
    pub fn get_or_load_plugins(&self, callback: ServePluginsCallback<'_>) -> GetOrStartLoadResult<'_> {
        any_server_dispatch!(self, |s| s.get_or_load_plugins(callback))
    }

    pub fn reload_static_routes(&self) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        any_server_dispatch!(self, |s| s.reload_static_routes())
    }

    pub fn append_static_route(
        &self,
        path: &[u8],
        route: super::AnyRoute,
        method: server_config::MethodOptional,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        any_server_dispatch!(self, |s| s.append_static_route(path, route, method))
    }

    pub fn global_this(&self) -> &JSGlobalObject {
        any_server_dispatch!(self, |s| unsafe { &*s.global_this })
    }

    pub fn config(&self) -> &ServerConfig {
        any_server_dispatch!(self, |s| &s.config)
    }

    /// SAFETY: derives `&mut ServerConfig` through `&self` via the erased
    /// `AnyServer` pointer; two calls alias the same handler. Caller must not
    /// hold another live `&mut Handler` (resolver-style accessor).
    pub unsafe fn web_socket_handler(&self) -> Option<&mut super::web_socket_server_context::Handler> {
        let server_config: &mut ServerConfig = any_server_dispatch!(self, |s| &mut s.config);
        server_config.websocket.as_mut().map(|ws| &mut ws.handler)
    }

    pub fn on_request(&self, req: &mut uws::Request, resp: uws::AnyResponse) {
        match self.ptr.tag() {
            // SAFETY: tag was just checked; as_unchecked yields the matching live *mut.
            t if t == <TaggedPtrUnion<_>>::case::<HTTPServer>() => unsafe { &mut *self.ptr.as_unchecked::<HTTPServer>() }.on_request(req, unsafe { &mut *resp.assert_no_ssl() }),
            t if t == <TaggedPtrUnion<_>>::case::<HTTPSServer>() => unsafe { &mut *self.ptr.as_unchecked::<HTTPSServer>() }.on_request(req, unsafe { &mut *resp.assert_ssl() }),
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPServer>() => unsafe { &mut *self.ptr.as_unchecked::<DebugHTTPServer>() }.on_request(req, unsafe { &mut *resp.assert_no_ssl() }),
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPSServer>() => unsafe { &mut *self.ptr.as_unchecked::<DebugHTTPSServer>() }.on_request(req, unsafe { &mut *resp.assert_ssl() }),
            _ => unreachable!("Invalid pointer tag"),
        }
    }

    pub fn from<T>(server: &T) -> AnyServer
    where
        T: bun_ptr::tagged_pointer::UnionMember<AnyServerTypes>,
    {
        AnyServer { ptr: TaggedPtrUnion::init(server as *const T) }
    }

    pub fn on_pending_request(&self) {
        any_server_dispatch!(self, |s| s.on_pending_request())
    }

    pub fn on_request_complete(&self) {
        any_server_dispatch!(self, |s| s.on_request_complete())
    }

    pub fn on_static_request_complete(&self) {
        any_server_dispatch!(self, |s| s.on_static_request_complete())
    }

    pub fn publish(&self, topic: &[u8], message: &[u8], opcode: Opcode, compress: bool) -> bool {
        // bun_uws::Opcode and bun_uws_sys::Opcode are both `#[repr(transparent)] struct(i32)`;
        // map by inner value (no transmute — see PORTING.md §Forbidden).
        let sys_opcode = uws_sys::Opcode(opcode.0);
        any_server_dispatch!(self, |s| unsafe { &mut *s.app.unwrap() }.publish(topic, message, sys_opcode, compress))
    }

    pub fn on_saved_request<const EXTRA_ARG_COUNT: usize>(
        &self,
        req: SavedRequestUnion,
        resp: uws::AnyResponse,
        callback: JSValue,
        extra_args: [JSValue; EXTRA_ARG_COUNT],
    ) {
        match self.ptr.tag() {
            // SAFETY: tag was just checked; as_unchecked yields the matching live *mut. AnyResponse variant matches SSL flag.
            t if t == <TaggedPtrUnion<_>>::case::<HTTPServer>() => unsafe { &mut *self.ptr.as_unchecked::<HTTPServer>() }.on_saved_request(req, unsafe { &mut *resp.assert_no_ssl() }, callback, extra_args),
            t if t == <TaggedPtrUnion<_>>::case::<HTTPSServer>() => unsafe { &mut *self.ptr.as_unchecked::<HTTPSServer>() }.on_saved_request(req, unsafe { &mut *resp.assert_ssl() }, callback, extra_args),
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPServer>() => unsafe { &mut *self.ptr.as_unchecked::<DebugHTTPServer>() }.on_saved_request(req, unsafe { &mut *resp.assert_no_ssl() }, callback, extra_args),
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPSServer>() => unsafe { &mut *self.ptr.as_unchecked::<DebugHTTPSServer>() }.on_saved_request(req, unsafe { &mut *resp.assert_ssl() }, callback, extra_args),
            _ => unreachable!("Invalid pointer tag"),
        }
    }

    pub fn prepare_and_save_js_request_context(
        &self,
        req: &mut uws::Request,
        resp: uws::AnyResponse,
        global: &JSGlobalObject,
        method: Option<http::Method>,
    ) -> JsResult<Option<SavedRequest<'_>>> {
        Ok(match self.ptr.tag() {
            // SAFETY: tag was just checked; as_unchecked yields the matching live *mut. AnyResponse variant matches SSL flag.
            t if t == <TaggedPtrUnion<_>>::case::<HTTPServer>() => {
                let s = unsafe { &mut *self.ptr.as_unchecked::<HTTPServer>() };
                let r = unsafe { &mut *resp.assert_no_ssl() };
                let Some(p) = s.prepare_js_request_context(req, r, None, CreateJsRequest::Bake, method) else { return Ok(None); };
                Some(p.save(global, req, unsafe { &mut *resp.assert_no_ssl() }))
            }
            t if t == <TaggedPtrUnion<_>>::case::<HTTPSServer>() => {
                let s = unsafe { &mut *self.ptr.as_unchecked::<HTTPSServer>() };
                let r = unsafe { &mut *resp.assert_ssl() };
                let Some(p) = s.prepare_js_request_context(req, r, None, CreateJsRequest::Bake, method) else { return Ok(None); };
                Some(p.save(global, req, unsafe { &mut *resp.assert_ssl() }))
            }
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPServer>() => {
                let s = unsafe { &mut *self.ptr.as_unchecked::<DebugHTTPServer>() };
                let r = unsafe { &mut *resp.assert_no_ssl() };
                let Some(p) = s.prepare_js_request_context(req, r, None, CreateJsRequest::Bake, method) else { return Ok(None); };
                Some(p.save(global, req, unsafe { &mut *resp.assert_no_ssl() }))
            }
            t if t == <TaggedPtrUnion<_>>::case::<DebugHTTPSServer>() => {
                let s = unsafe { &mut *self.ptr.as_unchecked::<DebugHTTPSServer>() };
                let r = unsafe { &mut *resp.assert_ssl() };
                let Some(p) = s.prepare_js_request_context(req, r, None, CreateJsRequest::Bake, method) else { return Ok(None); };
                Some(p.save(global, req, unsafe { &mut *resp.assert_ssl() }))
            }
            _ => unreachable!("Invalid pointer tag"),
        })
    }

    pub fn num_subscribers(&self, topic: &[u8]) -> u32 {
        any_server_dispatch!(self, |s| unsafe { &mut *s.app.unwrap() }.num_subscribers(topic))
    }

    pub fn dev_server(&self) -> Option<&bake::dev_server::DevServer> {
        any_server_dispatch!(self, |s| s.dev_server.as_deref())
    }
}

// ─── Exported fns ────────────────────────────────────────────────────────────
#[unsafe(no_mangle)]
pub extern "C" fn Server__setIdleTimeout(server: JSValue, seconds: JSValue, global: &JSGlobalObject) {
    match server_set_idle_timeout_(server, seconds, global) {
        Ok(()) => {}
        Err(JsError::Thrown) => {}
        Err(JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory_value();
        }
        Err(JsError::Terminated) => {}
    }
}

pub fn server_set_idle_timeout_(server: JSValue, seconds: JSValue, global: &JSGlobalObject) -> JsResult<()> {
    if !server.is_object() {
        return Err(global.throw(format_args!("Failed to set timeout: The 'this' value is not a Server.")));
    }

    if !seconds.is_number() {
        return Err(global.throw(format_args!("Failed to set timeout: The provided value is not of type 'number'.")));
    }
    let value = seconds.to_int32() as c_uint;
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
        return Err(global.throw(format_args!("Failed to set timeout: The 'this' value is not a Server.")));
    }
    Ok(())
}

pub fn server_set_on_client_error_(global: &JSGlobalObject, server: JSValue, callback: JSValue) -> JsResult<JSValue> {
    if !server.is_object() {
        return Err(global.throw(format_args!("Failed to set clientError: The 'this' value is not a Server.")));
    }

    if !callback.is_function() {
        return Err(global.throw(format_args!("Failed to set clientError: The provided value is not a function.")));
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
                        let this = unsafe { &mut *(user_data as *mut $T) };
                        let packet: &[u8] = if raw_packet_len > 0 {
                            unsafe { core::slice::from_raw_parts(raw_packet, raw_packet_len as usize) }
                        } else {
                            &[]
                        };
                        this.on_client_error_callback(unsafe { &mut *socket }, error_code, packet);
                    }
                    unsafe { &mut *app }.on_client_error(thunk, (this as *mut $T).cast::<c_void>());
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
        return Err(global.throw(format_args!("Failed to set requireHostHeader: The 'this' value is not a Server.")));
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
        return Err(global.throw(format_args!("Failed to set timeout: The 'this' value is not a Server.")));
    }
    Ok(JSValue::UNDEFINED)
}

pub fn server_set_max_http_header_size_(
    global: &JSGlobalObject,
    server: JSValue,
    max_header_size: u64,
) -> JsResult<JSValue> {
    if !server.is_object() {
        return Err(global.throw(format_args!("Failed to set maxHeaderSize: The 'this' value is not a Server.")));
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
        return Err(global.throw(format_args!("Failed to set maxHeaderSize: The 'this' value is not a Server.")));
    }
    Ok(JSValue::UNDEFINED)
}

// `host_fn.wrap{3,4}` C-ABI shims: each forwards through `to_js_host_call`
// (= `host_fn::to_js_host_fn_result`) so a `JsError` becomes `.zero` with the
// exception left on the global. Signatures match the C++ callers in
// `node:http`/`node:https` (`bindings/BunJSCHost.cpp`).
#[bun_jsc::host_call]
#[unsafe(export_name = "Server__setAppFlags")]
fn server_set_app_flags_shim(
    global: *mut JSGlobalObject,
    server: JSValue,
    require_host_header: bool,
    use_strict_method_validation: bool,
) -> JSValue {
    // SAFETY: `global` is a live JSC global supplied by the C++ caller.
    let global = unsafe { &*global };
    host_fn::to_js_host_fn_result(
        global,
        server_set_app_flags_(global, server, require_host_header, use_strict_method_validation),
    )
}

#[bun_jsc::host_call]
#[unsafe(export_name = "Server__setOnClientError")]
fn server_set_on_client_error_shim(
    global: *mut JSGlobalObject,
    server: JSValue,
    callback: JSValue,
) -> JSValue {
    // SAFETY: `global` is a live JSC global supplied by the C++ caller.
    let global = unsafe { &*global };
    host_fn::to_js_host_fn_result(global, server_set_on_client_error_(global, server, callback))
}

#[bun_jsc::host_call]
#[unsafe(export_name = "Server__setMaxHTTPHeaderSize")]
fn server_set_max_http_header_size_shim(
    global: *mut JSGlobalObject,
    server: JSValue,
    max_header_size: u64,
) -> JSValue {
    // SAFETY: `global` is a live JSC global supplied by the C++ caller.
    let global = unsafe { &*global };
    host_fn::to_js_host_fn_result(
        global,
        server_set_max_http_header_size_(global, server, max_header_size),
    )
}

// ─── HTTPServerAgent event body (runtime-tier) ───────────────────────────────
//
// `jsc.Debugger.HTTPServerAgent.notifyServerRoutesUpdated` (HTTPServerAgent.zig)
// reaches into `AnyServer`/`ServerConfig`, which live in this crate; the FFI
// pointer + `Route` payload type live in `bun_jsc::http_server_agent`. The
// event body therefore lives here and consumes the lower-crate types.
fn http_server_agent_notify_routes_updated<const SSL: bool, const DEBUG: bool>(
    agent: &http_server_agent::HTTPServerAgent,
    server_id: http_server_agent::ServerId,
    user_routes: &[UserRoute<SSL, DEBUG>],
    static_routes: &[server_config::StaticRouteEntry],
) -> Result<(), bun_alloc::AllocError> {
    let Some(handle) = agent.agent else { return Ok(()) };

    let mut routes: Vec<http_server_agent::Route> = Vec::new();
    let mut max_id: u32 = 0;

    for user_route in user_routes {
        max_id = max_id.max(user_route.id);
        routes.push(http_server_agent::Route {
            route_id: user_route.id as http_server_agent::RouteId,
            path: BunString::init(user_route.route.path.to_bytes()),
            r#type: http_server_agent::RouteType::Api,
            ..Default::default()
        });
    }

    for entry in static_routes {
        max_id += 1;
        let (rtype, file_path) = match &entry.route {
            super::AnyRoute::Html(html) => (
                http_server_agent::RouteType::Html,
                // SAFETY: RefPtr.data is a live NonNull while in the route table;
                // the inner `bundle` RefPtr is likewise live for the route's lifetime.
                BunString::init(unsafe { &(*html.data.as_ref().bundle.data.as_ptr()).path }),
            ),
            super::AnyRoute::Static(_) => (http_server_agent::RouteType::Static, BunString::EMPTY),
            _ => (http_server_agent::RouteType::Default, BunString::EMPTY),
        };
        routes.push(http_server_agent::Route {
            route_id: max_id as http_server_agent::RouteId,
            path: BunString::init(&entry.path),
            r#type: rtype,
            file_path,
            ..Default::default()
        });
    }

    // SAFETY: `VirtualMachine::get()` is the JS-thread singleton.
    let hot_reload_id =
        unsafe { (*jsc::virtual_machine::VirtualMachine::get()).hot_reload_counter } as http_server_agent::HotReloadId;
    // SAFETY: `handle` is a live C++ `InspectorHTTPServerAgent` (set via
    // `Bun__HTTPServerAgent__setEnabled`); `routes` borrowed for the FFI call.
    unsafe {
        InspectorHTTPServerAgent::notify_server_routes_updated(
            handle.as_ptr(),
            server_id,
            hot_reload_id,
            &mut routes,
        );
    }
    // `routes` (and each `Route`'s BunStrings) drop here per `impl Drop for Route`.
    Ok(())
}

// ─── Externs ─────────────────────────────────────────────────────────────────
// C++-implemented (bindings/BunServer.cpp). Declared here (not `bun_jsc`)
// because the signatures name `bun_runtime` types (`NodeHTTPResponse`,
// `uws::Request`) — moving them down would create a forward dependency.
// Pointee types lack #[repr(C)] but are only passed by pointer.
#[allow(improper_ctypes)]
unsafe extern "C" {
    fn NodeHTTPServer__onRequest_http(
        any_server: usize,
        global: *const JSGlobalObject,
        this: JSValue,
        callback: JSValue,
        method_string: JSValue,
        request: *mut uws::Request,
        response: *mut c_void, // *uws.NewApp(false).Response
        upgrade_ctx: *mut WebSocketUpgradeContext,
        node_response_ptr: *mut *mut NodeHTTPResponse,
    ) -> JSValue;

    fn NodeHTTPServer__onRequest_https(
        any_server: usize,
        global: *const JSGlobalObject,
        this: JSValue,
        callback: JSValue,
        method_string: JSValue,
        request: *mut uws::Request,
        response: *mut c_void, // *uws.NewApp(true).Response
        upgrade_ctx: *mut WebSocketUpgradeContext,
        node_response_ptr: *mut *mut NodeHTTPResponse,
    ) -> JSValue;

    fn Bun__createNodeHTTPServerSocketForClientError(
        is_ssl: bool,
        socket: *mut c_void,
        global: *const JSGlobalObject,
    ) -> JSValue;

    fn Bun__ServerRouteList__callRoute(
        global: *const JSGlobalObject,
        index: u32,
        request_ptr: *mut Request,
        server_object: JSValue,
        route_list_object: JSValue,
        request_object: *mut JSValue,
        req: *mut c_void, // *uws.Request
    ) -> JSValue;

    fn Bun__ServerRouteList__callRouteH3(
        global: *const JSGlobalObject,
        index: u32,
        request_ptr: *mut Request,
        server_object: JSValue,
        route_list_object: JSValue,
        request_object: *mut JSValue,
        req: *mut c_void,
    ) -> JSValue;

    fn Bun__ServerRouteList__create(
        global: *const JSGlobalObject,
        callbacks: *mut JSValue,
        paths: *mut ZigString,
        paths_length: usize,
    ) -> JSValue;

    fn NodeHTTP_assignOnNodeJSCompat(ssl: bool, app: *mut c_void);
    fn NodeHTTP_setUsingCustomExpectHandler(ssl: bool, app: *mut c_void, value: bool);
}

fn throw_ssl_error_if_necessary(global: &JSGlobalObject) -> bool {
    // SAFETY: FFI call into BoringSSL; no preconditions
    let err_code = unsafe { bun_boringssl_sys::ERR_get_error() };
    if err_code != 0 {
        // SAFETY: FFI call into BoringSSL; no preconditions
        let _guard = scopeguard::guard((), |_| unsafe { bun_boringssl_sys::ERR_clear_error() });
        let _ = global.throw_value(crate::crypto::create_crypto_error(global, err_code));
        return true;
    }
    false
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/server.zig (3855 lines)
//   confidence: medium
//   todos:      40
//   notes:      NewServer comptime type-generator → const-generic struct<SSL,DEBUG>; conditional H3 fields kept as Option (loses void elision); ServePlugins/AnyServer use intrusive refcount + tagged-ptr (Rc placeholder is wrong — Phase B: IntrusiveRc); .classes.ts codegen (js.gc.routeList) stubbed; many uws callback registrations need fn-pointer adapters; deinit() relies on Box::from_raw to drop owned fields (do NOT re-add per-field .deinit())
// ──────────────────────────────────────────────────────────────────────────
