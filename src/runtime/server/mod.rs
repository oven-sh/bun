//! `Bun.serve()`: `NewServer` struct + lifecycle (start/stop/listen),
//! `AnyServer` dispatch, `AnyRoute`, and per-file submodules.

use bun_collections::VecExt;
use core::ffi::{c_char, c_int, c_void};
use core::sync::atomic::Ordering;

/// Codegen `${ServerType}__create(global, ptr)` shim — one extern per
/// `(SSL, DEBUG)` monomorphization. Routes through the
/// `crate::generated_classes::js_*Server::to_js` wrappers (which own the
/// canonical extern decl) instead of redeclaring the symbols here.
fn server_js_create(
    ptr: *mut c_void,
    global: &jsc::JSGlobalObject,
    ssl: bool,
    debug: bool,
) -> jsc::JSValue {
    use crate::generated_classes as gc;
    // `ptr` is a `NewServer<SSL,DEBUG>` whose ref the C++ wrapper takes
    // over (released via `finalize`). Cast through the concrete monomorphization
    // each codegen module is typed against.
    match (ssl, debug) {
        (false, false) => gc::js_HTTPServer::to_js(ptr.cast(), global),
        (true, false) => gc::js_HTTPSServer::to_js(ptr.cast(), global),
        (false, true) => gc::js_DebugHTTPServer::to_js(ptr.cast(), global),
        (true, true) => gc::js_DebugHTTPSServer::to_js(ptr.cast(), global),
    }
}

use bun_io::KeepAlive;
use bun_ptr::{JsCell, RefPtr, ThisPtr};
use bun_uws as uws;
use bun_uws_sys as uws_sys;
use bun_uws_sys::app::c as uws_app_c;
use core::cell::Cell;
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

// ─── httplog ─────────────────────────────────────────────────────────────────
// Output.scoped(.Server, .visible) — debug-build no-op until bun_output wires.
macro_rules! httplog {
    ($($arg:tt)*) => {{
        #[cfg(debug_assertions)]
        { let _ = format_args!($($arg)*); }
    }};
}

// ─── server-local jsc re-export ──────────────────────────────────────────────
// `bun_jsc` is now a dep; forward to it. `AsyncTaskTracker` lives under
// `bun_jsc::debugger`, surfaced flat here for the server drafts that import it.
pub mod jsc {
    pub use crate::jsc::*;
    pub use bun_jsc::debugger::{AsyncTaskTracker, DebuggerId};
    pub use bun_jsc::virtual_machine::{ExceptionList, VirtualMachine};
}

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "HTTPStatusText.rs"]
pub mod http_status_text;
pub use http_status_text as HTTPStatusText;

#[path = "RangeRequest.rs"]
pub mod range_request;
pub use range_request as RangeRequest;

#[path = "WebSocketServerContext.rs"]
pub mod web_socket_server_context;
pub use web_socket_server_context::{Handler as WebSocketServerHandler, WebSocketServerContext};

#[path = "ServerConfig.rs"]
pub mod server_config;
pub use server_config::ServerConfig;

#[path = "StaticRoute.rs"]
pub mod static_route;
pub use static_route::StaticRoute;

#[path = "FileRoute.rs"]
pub mod file_route;
pub use file_route::FileRoute;

#[path = "DirectoryRoute.rs"]
pub mod directory_route;
pub use directory_route::DirectoryRoute;

#[path = "DevErrorPage.rs"]
pub mod dev_error_page;
pub use dev_error_page::DevErrorPage;

#[path = "FileResponseStream.rs"]
pub mod file_response_stream;
pub use file_response_stream::FileResponseStream;

#[path = "HTMLBundle.rs"]
pub mod html_bundle;
pub use html_bundle::HTMLBundle;

#[path = "ServerWebSocket.rs"]
pub mod server_web_socket;
pub use server_web_socket::ServerWebSocket;

#[path = "NodeHTTPResponse.rs"]
pub mod node_http_response;
pub use node_http_response::NodeHTTPResponse;

#[path = "RequestContext.rs"]
pub mod request_context;
pub use request_context::RequestContext as NewRequestContext;

#[path = "AnyRequestContext.rs"]
pub mod any_request_context;
pub use any_request_context::AnyRequestContext;

/// Run `$body` once for each attached multiplexed app (`h3_app`, then
/// `h2_app`) with `$mux: &mut impl server_config::MuxApp`. A macro rather than
/// a closure because the two apps are different types.
macro_rules! for_each_mux_app {
    ($self:expr, |$mux:ident| $body:block) => {{
        #[allow(unused_imports)]
        use server_config::MuxApp as _;
        if let Some($mux) = $self.h3_app_mut() {
            $body
        }
        if let Some($mux) = $self.h2_app_mut() {
            $body
        }
    }};
}

// `server_body.rs` holds the large method bodies (`on_request`, `on_upgrade`,
// route setup, …) split out to keep this module declaration file readable.

#[path = "server_body.rs"]
pub mod server_body;
pub use server_body::{GetOrStartLoadResult, ServePluginsCallback};

// ─── write_status ────────────────────────────────────────────────────────────
pub(crate) fn write_status<const SSL: bool>(resp: *mut uws_sys::NewAppResponse<SSL>, status: u16) {
    // The route handlers (`StaticRoute`/`FileRoute`) call here from completion
    // paths where the request may already be aborted/detached, so no-op on null.
    if resp.is_null() {
        return;
    }
    // S008: `Response<SSL>` is a ZST opaque — safe `*mut → &mut` deref
    // (non-null checked above).
    let resp = bun_opaque::opaque_deref_mut(resp);
    if let Some(text) = HTTPStatusText::get(status) {
        resp.write_status(text);
    } else {
        use std::io::Write as _;
        let mut buf = [0u8; 48];
        let mut cursor = &mut buf[..];
        write!(cursor, "{} HM", status).expect("unreachable");
        let written = 48 - cursor.len();
        resp.write_status(&buf[..written]);
    }
}

// ─── AnyRoute ────────────────────────────────────────────────────────────────
/// The route table's ref on each route.
pub enum AnyRoute {
    /// Serve a static file — `"/robots.txt": new Response(...)`
    Static(bun_ptr::RefPtr<StaticRoute>),
    /// Serve a file from disk
    File(bun_ptr::RefPtr<FileRoute>),
    /// Serve a directory tree — `"/static/*": { dir: "./public" }`
    Directory(bun_ptr::RefPtr<DirectoryRoute>),
    /// Bundle an HTML import — `import html from "./index.html"; "/": html`
    Html(bun_ptr::RefPtr<html_bundle::Route>),
    /// Use file-system routing — `"/*": { dir: …, style: "nextjs-pages" }`
    FrameworkRouter(crate::bake::framework_router::TypeIndex),
}

impl AnyRoute {
    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            AnyRoute::Static(r) => r.memory_cost(),
            AnyRoute::File(r) => r.memory_cost(),
            AnyRoute::Directory(r) => r.memory_cost(),
            AnyRoute::Html(r) => r.memory_cost(),
            AnyRoute::FrameworkRouter(_) => {
                core::mem::size_of::<crate::bake::FileSystemRouterType>()
            }
        }
    }

    // from_js / from_options / html_route_from_js — bodies live in
    // `server_body.rs` (`impl AnyRoute { … }`); same crate, separate file.
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
// Full state machine (intrusively refcounted; a `ThisPtr<ServePlugins>` rides
// through `JSValue::then` as the promise context) lives in `server_body.rs`.
pub use server_body::ServePlugins;

// ─── ServerFlags ─────────────────────────────────────────────────────────────
bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    pub struct ServerFlags: u8 {
        const DEINIT_SCHEDULED            = 1 << 0;
        const TERMINATED                  = 1 << 1;
        const HAS_HANDLED_ALL_CLOSED_PROMISE = 1 << 2;
    }
}

// ─── NewServer ───────────────────────────────────────────────────────────────
/// Number of HTTP method tokens — must match the variant count of
/// `bun_http_types::Method::Method` (`ACL`..`UNSUBSCRIBE`). Sizes
/// [`NewServer::method_name_cache`]; the lookup falls back to a fresh intern if
/// a future variant ever pushes the index past the end, so this is a perf knob,
/// not a correctness invariant.
const N_HTTP_METHODS: usize = 36;

#[derive(bun_ptr::CellRefCounted)]
pub struct NewServer<const SSL: bool, const DEBUG: bool> {
    /// Held by: the creator (`init()` → `serve()`), then the JS wrapper's
    /// `m_ctx` (released in `finalize`); and [`Self::self_ref`].
    ref_count: Cell<u32>,
    /// The uWS app's route / filter / ws registrations carry a `ThisPtr<Self>`
    /// as their user-data: this ref is taken when the app is created in
    /// `listen()` and released by `teardown()` right after the app is destroyed.
    self_ref: JsCell<Option<RefPtr<Self>>>,
    pub(crate) app: JsCell<Option<uws_sys::app::OwnedApp<SSL>>>,
    pub(crate) listener: Cell<Option<NonNull<uws_sys::app::ListenSocket<SSL>>>>,
    // Never set when !SSL.
    pub(crate) h3_app: JsCell<Option<uws_sys::h3::OwnedApp>>,
    /// Attached to `app` when `config.http2`; serves connections that
    /// negotiate "h2" (ALPN) or open with the cleartext preface.
    pub(crate) h2_app: JsCell<Option<uws_sys::h2::OwnedApp>>,
    pub(crate) h3_listener: Cell<Option<NonNull<uws_sys::h3::ListenSocket>>>,
    /// Cached `h3=":<port>"; ma=86400` for Alt-Svc on H1 responses; formatted
    /// once in onH3Listen so renderMetadata doesn't reformat per-request.
    pub(crate) h3_alt_svc: JsCell<Box<[u8]>>,
    pub(crate) js_value: JsCell<jsc::JsRef>,
    // LIFETIMES.tsv = STATIC → `&'static VirtualMachine`. `BackRef` for safe
    // `Deref` while keeping the struct `'static` (process-lifetime VM).
    pub(crate) vm: bun_ptr::BackRef<jsc::VirtualMachine>,
    pub global_this: *const jsc::JSGlobalObject,
    /// Lazily-filled cache of the interned JS method-name string per HTTP
    /// method token. The `node:http` request prologue reads this so each request
    /// after the first for a given method skips the FFI hop into
    /// `Bun__HTTPMethod__toJS`. Indexed by `Method as usize`; a slot holds
    /// [`JSValue::ZERO`] until filled. The cached value is one of the global
    /// object's GC-rooted common strings (visited by `CommonStrings::visit`), so
    /// it stays live for as long as this server's global object — which always
    /// outlives the server itself.
    pub(crate) method_name_cache: [Cell<jsc::JSValue>; N_HTTP_METHODS],
    pub(crate) base_url_string_for_joining: Box<[u8]>,
    pub(crate) config: JsCell<ServerConfig>,
    pub(crate) pending_requests: Cell<usize>,
    /// Live HTTP connections (accepted, not yet closed or upgraded), fed by
    /// the uWS filter in [`NewServer::listen`]. Any of them can still dispatch
    /// a handler, so the wrapper stays `Strong` until this drains
    /// ([`NewServer::is_drained`]); for Bun.serve it also holds the
    /// graceful-stop promise open ([`NewServer::is_closed`]).
    pub(crate) active_connection_count: Cell<u32>,
    /// Live `ServerWebSocket` count. Lives on the server (not the websocket
    /// context) so a reload's context swap cannot reset it.
    pub(crate) active_websocket_count: Cell<u32>,
    /// Set across [`NewServer::deinit_if_we_can`] and the synchronous
    /// `app.close()` drains in `stop_listening`; lets a nested call (reached
    /// via a callback the body fires) early-return instead of re-running the
    /// downgrade/teardown while the outer frame is mid-way through it.
    deinit_running: Cell<bool>,
    pub(crate) request_pool:
        &'static request_context::RequestContextStackAllocator<Self, SSL, DEBUG, false>,
    /// `None` until `listen()` creates an HTTP/2 or HTTP/3 app.
    pub(crate) mux_request_pool: Cell<
        Option<&'static request_context::RequestContextStackAllocator<Self, SSL, DEBUG, true>>,
    >,
    /// Authoritative GC root for the `server.stop()` promise. Lazily filled by
    /// `get_all_closed_promise`; read in `deinit_if_we_can` (which can run
    /// after the wrapper is collected, so a wrapper-traced slot would not
    /// suffice — this Strong is what keeps the cell live across that window).
    /// The cycle through a user `.then(cb)` is broken by resolving the
    /// promise in `deinit_if_we_can`, after which the Strong is dropped.
    pub(crate) all_closed_promise: JsCell<jsc::JSPromiseStrong>,

    pub poll_ref: JsCell<KeepAlive>,

    pub(crate) flags: Cell<ServerFlags>,

    /// The server's counted ref on the plugin state; released in `Drop`.
    pub(crate) plugins: JsCell<Option<RefPtr<ServePlugins>>>,

    pub(crate) dev_server: JsCell<Option<Box<crate::bake::DevServer::DevServer>>>,

    /// Route → index in RouteList.cpp. User routes may be applied multiple
    /// times due to SNI, so we have to store them. Each is its own allocation:
    /// its address is the uWS route user-data.
    pub(crate) user_routes: JsCell<Vec<bun_ptr::OwnedThis<UserRoute<SSL, DEBUG>>>>,

    /// Raw shadow of the wrapper's `m_onClientError` WriteBarrier slot.
    /// `JSValue::ZERO` when unset; written by `server_set_on_client_error`.
    pub(crate) on_clienterror: Cell<JSValue>,

    /// Raw shadow of the wrapper's `m_onConnection` WriteBarrier slot.
    /// `JSValue::ZERO` when unset; written by `server_set_on_connection`.
    pub(crate) on_connection: Cell<JSValue>,

    pub(crate) inspector_server_id: Cell<jsc::DebuggerId>,
}

pub struct UserRoute<const SSL: bool, const DEBUG: bool> {
    pub(crate) id: u32,
    /// The server owns this route (in `user_routes`) and outlives it.
    pub(crate) server: bun_ptr::BackRef<NewServer<SSL, DEBUG>, bun_ptr::Root>,
    pub(crate) route: server_config::RouteDeclaration,
}

impl<const SSL: bool, const DEBUG: bool> Drop for NewServer<SSL, DEBUG> {
    fn drop(&mut self) {
        httplog!("deinit");
        // The apps' registrations point at `self` / `user_routes`; gone first.
        drop(self.h3_app.replace(None));
        self.drop_h2_app();
        drop(self.app.replace(None));
        // Before `config`, which owns the arena the dev server's transpilers and views live in.
        drop(self.dev_server.replace(None));
        // The remaining owned fields (config, base_url, h3_alt_svc,
        // user_routes, all_closed_promise) drop automatically.
        if let Some(p) = self.plugins.replace(None) {
            p.forget_server(AnyServer::from(&*self));
        }
    }
}

/// Const-generic adapter: `AnyResponse: From<*mut Response<SSL>>` is only
/// implemented for the two concrete `SSL` values (overlap rules forbid a
/// blanket impl alongside them), so dispatch at the call boundary.
#[inline]
fn any_response_from<const SSL: bool>(resp: *mut uws_sys::NewAppResponse<SSL>) -> uws::AnyResponse {
    // `*mut Response<SSL>` and `*mut Response<true|false>` are
    // distinct types to rustc; route through `.cast()` (the underlying handle
    // is opaque and layout-identical for both instantiations).
    if SSL {
        uws::AnyResponse::SSL(resp.cast())
    } else {
        uws::AnyResponse::TCP(resp.cast())
    }
}

/// HTTP/1 `RequestContext` for a given server monomorphization.
pub type ServerRequestContext<const SSL: bool, const DEBUG: bool> =
    request_context::RequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, false>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CreateJsRequest {
    Yes,
    No,
    Bake,
}

/// Bundle of the JS-side `Request`, the heap `webcore::Request`, and the
/// per-request `RequestContext` (`Ctx`: HTTP/1 or HTTP/3 flavour).
pub struct PreparedRequestFor<Ctx> {
    pub(crate) js_request: JSValue,
    /// The `Request` allocation's root pointer, for the C++ route-list call
    /// that wraps it. The `Request` itself is reached through
    /// `ctx.request_weakref`, which pins it for the request's lifetime.
    pub(crate) request_ptr: NonNull<crate::webcore::Request>,
    /// Self-owned (refcounted, pool-slot token inside); outlives the dispatch
    /// frame that holds this.
    pub ctx: bun_ptr::BackRef<Ctx>,
}

/// The HTTP/1 instantiation; H3 callers never `save()`.
pub type PreparedRequest<const SSL: bool, const DEBUG: bool> =
    PreparedRequestFor<ServerRequestContext<SSL, DEBUG>>;

impl<const SSL: bool, const DEBUG: bool> PreparedRequest<SSL, DEBUG> {
    /// The heap `Request`, while the context still holds it.
    #[inline]
    pub(crate) fn request(&self) -> Option<&crate::webcore::Request> {
        self.ctx.get().request_weakref.get().peek()
    }

    /// Detach the borrowed stack `uws::Request` from the heap `Request` so the
    /// JS object never dangles a pointer past the uWS frame it borrowed.
    #[inline]
    fn detach_uws_request(ctx: &ServerRequestContext<SSL, DEBUG>) {
        if let Some(request) = ctx.request_weakref.get().peek() {
            request.request_context.get().detach_request();
        }
    }

    /// `ctx.to_async(..)` (which also detaches the stack `uws::Request`), or —
    /// if the `Request` is already gone — just arm the abort handler.
    #[inline]
    fn to_async(ctx: &ServerRequestContext<SSL, DEBUG>, req: *mut c_void) {
        match ctx.request_weakref.get().peek() {
            Some(request) => ctx.to_async(req, request),
            None => ctx.set_abort_handler(),
        }
    }

    /// Used by DevServer to defer calling
    /// the JS handler until the bundle is actually ready.
    pub(crate) fn save(
        self,
        global: &jsc::JSGlobalObject,
        req: &mut uws_sys::Request,
        resp: *mut uws_sys::NewAppResponse<SSL>,
    ) -> SavedRequest {
        // By saving a request, all information from `req` must be
        // copied since the provided uws.Request will be re-used for
        // future requests (stack allocated).
        let ctx = self.ctx.get();
        Self::to_async(
            ctx,
            std::ptr::from_mut::<uws_sys::Request>(req).cast::<c_void>(),
        );

        SavedRequest {
            js_request: jsc::StrongOptional::create(self.js_request, global),
            request: ctx.request_weakref.get().clone(),
            request_ptr: self.request_ptr,
            ctx: AnyRequestContext::init(self.ctx.as_const_ptr()),
            response: any_response_from::<SSL>(resp),
        }
    }
}

/// The `(request, response)` handles of an HTTP/1 route callback on `App<SSL>`.
#[inline]
fn h1_parts<'a, const SSL: bool>(
    req: uws_sys::AnyRequest,
    resp: uws::AnyResponse,
) -> (&'a mut uws_sys::Request, *mut uws_sys::NewAppResponse<SSL>) {
    let uws_sys::AnyRequest::H1(req) = req else {
        unreachable!("H1 route dispatched a non-H1 request")
    };
    let resp: *mut uws_sys::NewAppResponse<SSL> = match resp {
        uws::AnyResponse::SSL(r) => r.cast(),
        uws::AnyResponse::TCP(r) => r.cast(),
        uws::AnyResponse::H3(_) | uws::AnyResponse::H2(_) => {
            unreachable!("H1 route dispatched an H2/H3 response")
        }
    };
    // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
    (bun_opaque::opaque_deref_mut(req), resp)
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    pub(crate) const HAS_H3: bool = SSL;

    // ── accessors ────────────────────────────────────────────────────────────

    /// `global_this` is a STATIC backref (LIFETIMES.tsv) set in `init()`;
    /// non-null and outlives the server. S008: `JSGlobalObject` is an
    /// `opaque_ffi!` ZST, so the `*const → &` deref is safe via
    /// `bun_opaque::opaque_deref` (const-asserted ZST/align-1).
    #[inline(always)]
    pub fn global_this(&self) -> &jsc::JSGlobalObject {
        bun_opaque::opaque_deref(self.global_this)
    }

    /// `vm` is a STATIC backref (LIFETIMES.tsv) set in `init()` from
    /// `VirtualMachine::get()`; non-null for the server's lifetime.
    #[inline(always)]
    pub(crate) fn vm(&self) -> &jsc::VirtualMachine {
        self.vm.get()
    }

    /// The dispatch handle the uWS registrations carry; available while the
    /// app exists (`listen()` .. `teardown()`).
    #[inline]
    fn this_ptr(&self) -> ThisPtr<Self> {
        self.self_ref
            .get()
            .as_ref()
            .expect("server app is live")
            .this_ptr()
    }

    /// The live uWS app handle, if created (`listen()`) and not yet torn down.
    #[inline]
    pub(crate) fn app_ptr(&self) -> Option<*mut uws_sys::NewApp<SSL>> {
        self.app.get().as_ref().map(uws_sys::app::OwnedApp::as_ptr)
    }

    /// `&mut` view of the live uWS app (an opaque ZST handle — S008).
    #[inline]
    pub(crate) fn app_mut(&self) -> Option<&mut uws_sys::NewApp<SSL>> {
        self.app_ptr().map(bun_opaque::opaque_deref_mut)
    }

    #[inline]
    pub(crate) fn h3_app_ptr(&self) -> Option<*mut uws_sys::h3::App> {
        if !Self::HAS_H3 {
            return None;
        }
        self.h3_app
            .get()
            .as_ref()
            .map(uws_sys::h3::OwnedApp::as_ptr)
    }

    /// `&mut` view of the live H3 app (an `opaque_ffi!` ZST handle — S008).
    #[inline]
    pub(crate) fn h3_app_mut(&self) -> Option<&mut uws_sys::h3::App> {
        self.h3_app_ptr().map(bun_opaque::opaque_deref_mut)
    }

    #[inline]
    pub(crate) fn h2_app_ptr(&self) -> Option<*mut uws_sys::h2::App> {
        self.h2_app
            .get()
            .as_ref()
            .map(uws_sys::h2::OwnedApp::as_ptr)
    }

    /// `&mut` view of the live H2 app (an `opaque_ffi!` ZST handle — S008).
    #[inline]
    pub(crate) fn h2_app_mut(&self) -> Option<&mut uws_sys::h2::App> {
        self.h2_app_ptr().map(bun_opaque::opaque_deref_mut)
    }

    /// Destroy the H2 app; a drain may still be queued for it.
    fn drop_h2_app(&self) {
        if let Some(h2a) = self.h2_app.replace(None) {
            self.vm()
                .event_loop_ref()
                .deferred_tasks
                .unregister_task(NonNull::new(h2a.as_ptr().cast::<c_void>()));
            drop(h2a);
        }
    }

    /// S012: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
    #[inline]
    pub(crate) fn listener_mut(&self) -> Option<&mut uws_sys::app::ListenSocket<SSL>> {
        self.listener
            .get()
            .map(|l| bun_opaque::opaque_deref_mut(l.as_ptr()))
    }

    /// S012: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
    #[inline]
    pub(crate) fn h3_listener_mut(&self) -> Option<&mut uws_sys::h3::ListenSocket> {
        if !Self::HAS_H3 {
            return None;
        }
        self.h3_listener
            .get()
            .map(|l| bun_opaque::opaque_deref_mut(l.as_ptr()))
    }

    #[inline]
    pub(crate) fn config(&self) -> &ServerConfig {
        self.config.get()
    }

    #[inline]
    fn insert_flags(&self, f: ServerFlags) {
        self.flags.set(self.flags.get() | f);
    }

    #[inline]
    fn has_flags(&self, f: ServerFlags) -> bool {
        self.flags.get().contains(f)
    }

    /// Clear the websocket handler's app/server back-links.
    fn detach_websocket_handler(&self, app: bool, server: bool) {
        self.config.with_mut(|c| {
            if let Some(ws) = c.websocket.as_mut() {
                if app {
                    ws.handler.app = None;
                }
                if server {
                    ws.handler.server = None;
                }
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────

    pub(crate) fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
            + self.base_url_string_for_joining.len()
            + self.config().memory_cost()
            + self
                .dev_server
                .get()
                .as_ref()
                .map_or(0, |d| d.memory_cost())
    }

    pub(crate) fn h3_alt_svc(&self) -> Option<&[u8]> {
        let alt = self.h3_alt_svc.get();
        if !Self::HAS_H3 || alt.is_empty() {
            return None;
        }
        Some(alt)
    }

    pub(crate) fn on_pending_request(&self) {
        self.pending_requests.set(self.pending_requests.get() + 1);
    }

    /// uWS filter: `+2` at TCP accept (before any TLS handshake), `-2` on
    /// `HttpContext::onClose` / `HttpResponse::upgrade()` — see
    /// `AsyncSocketData::filteredAccept`. Feeds [`Self::active_connection_count`].
    fn on_connection_filter(this: ThisPtr<Self>, _socket: *mut uws_sys::us_socket_t, opened: i32) {
        // Count from accept (2 / -2), not from open (1 / -1): a TLS socket accepted but still
        // handshaking is a connection too — it will dispatch once the handshake completes.
        match opened {
            2 => {
                this.note_connection_opened();
                return;
            }
            -2 => {}
            _ => return,
        }
        if this.note_connection_closed() && !this.has_listener() && !this.deinit_running.get() {
            this.deinit_if_we_can();
        }
    }

    /// Build the server's base URL string (`http(s)://host:port/`, or a
    /// `unix://`/abstract-socket URL) from the configured listen address.
    /// Errors only on allocation failure.
    pub(crate) fn get_url_as_string(&self) -> Result<bun_core::String, bun_alloc::AllocError> {
        use bun_core::fmt::{URLFormatter, URLProto};
        use std::io::Write as _;
        let config = self.config();
        let fmt = match &config.address {
            server_config::Address::Unix(unix) => {
                let unix = unix.as_bytes();
                if unix.len() > 1 && unix[0] == 0 {
                    // abstract domain socket, let's give it an "abstract" URL
                    URLFormatter {
                        proto: URLProto::Abstract,
                        hostname: Some(&unix[1..]),
                        port: None,
                    }
                } else {
                    URLFormatter {
                        proto: URLProto::Unix,
                        hostname: Some(unix),
                        port: None,
                    }
                }
            }
            server_config::Address::Tcp { port, hostname } => {
                let mut port = *port;
                if let Some(listener) = self.listener_mut() {
                    port = listener.get_local_port().unwrap_or(port);
                } else if let Some(h3l) = self.h3_listener_mut() {
                    port = h3l.get_local_port().unwrap_or(port);
                }
                URLFormatter {
                    proto: if SSL { URLProto::Https } else { URLProto::Http },
                    hostname: hostname.as_ref().map(|h| h.as_bytes()),
                    port: Some(port),
                }
            }
        };

        let mut buf = Vec::new();
        write!(&mut buf, "{}", fmt).map_err(|_| bun_alloc::AllocError)?;
        Ok(bun_core::String::clone_utf8(&buf))
    }

    /// Return the server's JS object, asserting that the weak ref is still
    /// alive (callers must only use this while the server JS object is kept
    /// alive elsewhere).
    pub(crate) fn js_value_assert_alive(&self) -> JSValue {
        let js_value = self.js_value.get();
        debug_assert!(js_value.is_not_empty());
        js_value.try_get().expect("js_value alive")
    }

    /// Returns the wrapper while it is alive (`Strong` or `Weak`) and its VM may still run script,
    /// else `None`. It stays `Strong` — the WriteBarrier root of the handler shadows — until the
    /// server is drained (no listener, request, HTTP/1 connection or websocket left; connections count
    /// from accept), so nothing dispatches through a wrapper the GC may have collected. A VM whose
    /// script gate has closed (a worker that called `process.exit()` or was asked to terminate, still
    /// draining the current loop tick before its stop phase closes the listener) must not have a
    /// request built for it either; uWS requires every dispatched request to be answered or
    /// adopted, so dispatch trampolines answer 503+close on `None`.
    pub(crate) fn js_value_for_dispatch(&self) -> Option<JSValue> {
        if !self.vm().script_allowed() {
            return None;
        }
        let js_value = self.js_value.get();
        // HTTP/3 connections are not counted yet, so a stream on one can still arrive after the drain.
        debug_assert!(
            self.h3_app.get().is_some() || js_value.is_strong() || js_value.try_get().is_none(),
            "a socket outlived the server's connection accounting"
        );
        js_value.try_get()
    }
}

/// gcProtect every handler callback `ServerConfig::from_js` / `Handler::from_js`
/// stored as a raw-`JSValue` shadow, for the window between those being moved
/// into an unscanned heap box (`init()`'s `mem::take` on serve,
/// `self.config.websocket = Some(ws)` on reload) and the `wrap_handler_slot`
/// writes. Returns an RAII array whose `Drop` unprotects on every exit path.
/// `JSValue::ZERO` slots are cheap no-ops on both sides (the C++
/// `gcProtect`/`gcUnprotect` early-return on non-cells), so there is no need
/// to branch on `is_empty()`.
pub(crate) fn protect_handler_shadows(config: &ServerConfig) -> [bun_jsc::js_value::Protected; 10] {
    let ws = config.websocket.as_ref().map(|w| &w.handler);
    let z = JSValue::ZERO;
    [
        config.on_request,
        config.on_error,
        config.on_node_http_request,
        ws.map_or(z, |h| h.on_open),
        ws.map_or(z, |h| h.on_message),
        ws.map_or(z, |h| h.on_close),
        ws.map_or(z, |h| h.on_drain),
        ws.map_or(z, |h| h.on_error),
        ws.map_or(z, |h| h.on_ping),
        ws.map_or(z, |h| h.on_pong),
    ]
    .map(JSValue::protected)
}

/// Single point of truth for "wrap a handler callback and mirror it into the
/// wrapper's WriteBarrier slot". If `*shadow` is unset (empty/undefined/null),
/// normalize it to `ZERO` and clear the slot; otherwise apply the
/// async-context wrap and write the wrapped fn into both the slot and
/// `*shadow`. Every call site already holds a live wrapper (`ptr_to_js` on
/// serve, `callframe.this()` on reload / setOnClientError), so `server_js`
/// is always valid. Keeping the is-empty check, the wrap step, and the
/// shadow↔slot pairing in one helper is what stops the serve / reload / ws /
/// clientError sites from drifting.
#[inline]
pub(crate) fn wrap_handler_slot(
    shadow: &mut JSValue,
    server_js: JSValue,
    global: &JSGlobalObject,
    set: fn(JSValue, &JSGlobalObject, JSValue),
) {
    let v = if shadow.is_empty_or_undefined_or_null() {
        JSValue::ZERO
    } else {
        shadow.with_async_context_if_needed(global)
    };
    set(server_js, global, v);
    *shadow = v;
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    /// Per-monomorphization static.
    /// Rust statics cannot be const-generic; routed through a
    /// `&'static AtomicBool` so the four (SSL,DEBUG) instantiations share one
    /// flag — the warning is process-global by intent (printed at most once
    /// regardless of how many servers are running).
    fn did_send_idletimeout_warning_once() -> &'static core::sync::atomic::AtomicBool {
        static FLAG: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
        &FLAG
    }

    /// The body ignores both arguments so a single non-generic shim suffices.
    fn on_timeout_for_idle_warn(_: *mut c_void, _: &mut uws_sys::NewAppResponse<SSL>) {
        if DEBUG && !Self::did_send_idletimeout_warning_once().load(Ordering::Relaxed) {
            if !crate::cli::Command::get().debug.silent {
                Self::did_send_idletimeout_warning_once().store(true, Ordering::Relaxed);
                bun_core::warn!(
                    "Bun.serve() timed out a request after 10 seconds. Pass `idleTimeout` to configure."
                );
            }
        }
    }

    fn should_add_timeout_handler_for_warning(&self) -> bool {
        if DEBUG {
            if !Self::did_send_idletimeout_warning_once().load(Ordering::Relaxed)
                && !crate::cli::Command::get().debug.silent
            {
                return !self.config().has_idle_timeout;
            }
        }
        false
    }

    /// The HTTP/1 instantiation
    /// (`Ctx == RequestContext`). The `Ctx`-generic `prepareJsRequestContextFor`
    /// is folded directly: const-generic `bool` cannot select an associated
    /// `Req`/`Resp` type in stable Rust without specialization, and the only
    /// other instantiation (H3) populates url/headers eagerly via a separate
    /// codepath. The bake/saved-request callers reached through `AnyServer`
    /// are HTTP/1-only by construction.
    fn prepare_js_request_context(
        this: ThisPtr<Self>,
        req: &mut uws_sys::Request,
        resp: *mut uws_sys::NewAppResponse<SSL>,
        should_deinit_context: Option<request_context::DeferDeinitFlag>,
        create_js_request: CreateJsRequest,
        method: Option<bun_http_types::Method::Method>,
    ) -> Option<PreparedRequest<SSL, DEBUG>> {
        jsc::mark_binding!();
        let server = this.get();
        // S008: `Response<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        let resp_ref = bun_opaque::opaque_deref_mut(resp);

        // We need to register the handler immediately since uSockets will not buffer.
        //
        // We first validate the self-reported request body length so that
        // we avoid needing to worry as much about what memory to free.
        // (RFC 9114 §4.2 transfer-encoding check is H3-only — skipped here.)

        // Resolve once, reuse for both `has_request_body()` here and the
        // forward to `RequestContext::init` below.
        let method = method.or_else(|| bun_http_types::Method::Method::which(req.method()));

        let request_body_length: Option<usize> = 'len: {
            if method
                .unwrap_or(bun_http_types::Method::Method::OPTIONS)
                .has_request_body()
            {
                let len: usize = if let Some(cl) = req.header(b"content-length") {
                    bun_http_types::parse_content_length(cl)
                } else {
                    0
                };

                // Abort the request very early.
                if len > server.config().max_request_body_size {
                    resp_ref.write_status(b"413 Request Entity Too Large");
                    resp_ref.end_without_body(true);
                    return None;
                }

                break 'len Some(len);
            }
            None
        };

        server.on_pending_request();

        req.set_yield(false);
        resp_ref.timeout(server.config().idle_timeout);

        // Since we do timeouts by default, we should tell the user when
        // this happens - but limit it to only warn once.
        if server.should_add_timeout_handler_for_warning() {
            // We need to pass it a pointer, any pointer should do.
            resp_ref.on_timeout(
                Self::on_timeout_for_idle_warn,
                Self::did_send_idletimeout_warning_once()
                    .as_ptr()
                    .cast::<c_void>(),
            );
        }

        let global = server.global_this();
        let is_transfer_encoding = request_body_length.is_some() && req.has_transfer_encoding();
        let expects_body =
            matches!(request_body_length, Some(len) if len > 0 || is_transfer_encoding);
        let mut prepared = Self::create_request_context::<ServerRequestContext<SSL, DEBUG>>(
            this,
            req,
            any_response_from::<SSL>(resp),
            should_deinit_context,
            method,
            expects_body,
        );
        let ctx_ref = prepared.ctx.get();
        let Some(request_object) = prepared.request() else {
            unreachable!("just created");
        };

        // (H3 eager-url/header population is unreachable on this path.)

        if DEBUG {
            ctx_ref.flags.set_is_web_browser_navigation('brk: {
                if let Some(fetch_dest) = req.header(b"sec-fetch-dest") {
                    if fetch_dest == b"document" {
                        break 'brk true;
                    }
                }
                false
            });
        }

        if let Some(req_len) = request_body_length {
            ctx_ref.request_body_content_len.set(req_len);
            ctx_ref.flags.set_is_transfer_encoding(is_transfer_encoding);
            if expects_body {
                ctx_ref.flags.set_is_waiting_for_request_body(true);

                resp_ref.on_data(
                    |u: *mut ServerRequestContext<SSL, DEBUG>,
                     _: &mut uws_sys::NewAppResponse<SSL>,
                     chunk: &[u8],
                     last: bool| {
                        ServerRequestContext::<SSL, DEBUG>::on_buffered_body_chunk(u, chunk, last)
                    },
                    ctx_ref.as_ctx_ptr(),
                );
            }
        }

        let js_request = match create_js_request {
            CreateJsRequest::Yes => request_object.to_js(global),
            CreateJsRequest::Bake => match request_object.to_js_for_bake(global) {
                Ok(v) => v,
                Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
                Err(_) => return None,
            },
            CreateJsRequest::No => JSValue::ZERO,
        };
        prepared.js_request = js_request;
        Some(prepared)
    }

    /// Invoke the user's route handler for a
    /// request that was deferred (bake bundle-then-serve flow).
    fn on_saved_request<const ARG_COUNT: usize>(
        this: ThisPtr<Self>,
        req: SavedRequestUnion<'_>,
        resp: *mut uws_sys::NewAppResponse<SSL>,
        callback: JSValue,
        extra_args: [JSValue; ARG_COUNT],
    ) {
        // Same gate as the network trampolines: the saved request's
        // `pending_requests` increment keeps the wrapper `Strong` (so it is
        // never `Finalized` here), but the VM's script gate can have closed
        // while the bundle was being built.
        let Some(server_js) = this.js_value_for_dispatch() else {
            server_body::respond_stopped_503(bun_opaque::opaque_deref_mut(resp));
            return;
        };
        let prepared: PreparedRequest<SSL, DEBUG> = match &req {
            SavedRequestUnion::Stack(r) => {
                // reshaped for borrowck — decouple the inner
                // `&mut uws::Request` lifetime from the `req` match guard.
                let r = std::ptr::from_ref::<uws::Request>(*r).cast_mut();
                match Self::prepare_js_request_context(
                    this,
                    // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
                    bun_opaque::opaque_deref_mut(r),
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
                js_request: data
                    .js_request
                    .get()
                    .expect("Request was unexpectedly freed"),
                request_ptr: data.request_ptr,
                // `SavedRequest` was produced by `PreparedRequest::save`
                // for this exact (SSL,DEBUG) monomorphization, so the erased
                // `AnyRequestContext` payload is `ServerRequestContext<SSL,DEBUG>`;
                // the saved request's ref keeps it alive.
                ctx: data
                    .ctx
                    .get_ref::<ServerRequestContext<SSL, DEBUG>>()
                    .map(bun_ptr::BackRef::new)
                    .expect("ctx tag mismatch"),
            },
        };

        debug_assert!(!callback.is_empty());
        // PERF: stable Rust forbids `ARG_COUNT + 1` in const-generic array lengths.
        // The conservative GC scan reaches the heap allocation as well as the
        // stack, so a small Vec is sound.
        let mut args: Vec<JSValue> = Vec::with_capacity(ARG_COUNT + 1);
        args.push(prepared.js_request);
        args.extend_from_slice(&extra_args);

        let server = this.get();
        let _entered = server.vm().enter_event_loop_scope_without_checkpoint();
        let global = server.global_this();
        let response_value = match callback.call(global, server_js, &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        // The uWS request will not live longer than this function: on every
        // exit below it is detached from the `Request` — only when it's the
        // stack-allocated original (a saved request already copied everything).
        let is_stack = matches!(req, SavedRequestUnion::Stack(_));
        let ctx_ref = prepared.ctx.get();

        let original_state = ctx_ref.defer_deinit_until_callback_completes.get();
        let should_deinit_context = Cell::new(false);
        ctx_ref
            .defer_deinit_until_callback_completes
            .set(Some(bun_ptr::BackRef::new(&should_deinit_context)));
        ctx_ref.on_response(server, prepared.js_request, response_value);
        ctx_ref
            .defer_deinit_until_callback_completes
            .set(original_state);

        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        if should_deinit_context.get() {
            if is_stack {
                PreparedRequest::<SSL, DEBUG>::detach_uws_request(ctx_ref);
            }
            ctx_ref.deinit();
            return;
        }

        if ctx_ref.should_render_missing() {
            if is_stack {
                PreparedRequest::<SSL, DEBUG>::detach_uws_request(ctx_ref);
            }
            ctx_ref.render_missing();
            return;
        }

        // The request is asynchronous, and all information from `req` must be copied
        // since the provided uws.Request will be re-used for future requests (stack allocated).
        match req {
            SavedRequestUnion::Stack(r) => {
                PreparedRequest::<SSL, DEBUG>::to_async(
                    ctx_ref,
                    std::ptr::from_ref::<uws::Request>(r)
                        .cast_mut()
                        .cast::<c_void>(),
                );
            }
            SavedRequestUnion::Saved(_) => {} // info already copied
        }
    }

    /// Common tail of `on_request` /
    /// `on_user_route_request`: hand the user-handler's return value to the
    /// `RequestContext`, then either tear down synchronously or transition to
    /// the async path.
    ///
    /// `should_deinit_context` is the same `Cell<bool>` already stored in
    /// `ctx.defer_deinit_until_callback_completes` by
    /// `prepare_js_request_context`.
    fn handle_request(
        &self,
        should_deinit_context: &Cell<bool>,
        prepared: &PreparedRequest<SSL, DEBUG>,
        req: &mut uws_sys::Request,
        response_value: JSValue,
    ) {
        let ctx_ref = prepared.ctx.get();

        // The uWS request will not live longer than this function: on every
        // exit below it is detached from the `Request`.
        ctx_ref.on_response(self, prepared.js_request, response_value);
        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        ctx_ref.defer_deinit_until_callback_completes.set(None);

        if should_deinit_context.get() {
            PreparedRequest::<SSL, DEBUG>::detach_uws_request(ctx_ref);
            ctx_ref.deinit();
            return;
        }

        if ctx_ref.should_render_missing() {
            PreparedRequest::<SSL, DEBUG>::detach_uws_request(ctx_ref);
            ctx_ref.render_missing();
            return;
        }

        // The request is asynchronous, and all information from `req` must be
        // copied since the provided uws.Request will be re-used for future
        // requests (stack allocated).
        PreparedRequest::<SSL, DEBUG>::to_async(
            ctx_ref,
            std::ptr::from_mut::<uws_sys::Request>(req).cast::<c_void>(),
        );
        prepared.js_request.ensure_still_alive();
    }

    /// Dispatch the user `fetch` handler.
    fn on_request(
        this: ThisPtr<Self>,
        req: &mut uws_sys::Request,
        resp: *mut uws_sys::NewAppResponse<SSL>,
    ) {
        // Idle keep-alive sockets aren't counted in pending_requests, so the
        // wrapper can have been finalized before this fires. Refuse and close
        // rather than dispatching with a stale handler shadow.
        let Some(js_value) = this.js_value_for_dispatch() else {
            server_body::respond_stopped_503(bun_opaque::opaque_deref_mut(resp));
            return;
        };
        let should_deinit_context = Cell::new(false);
        let Some(prepared) = Self::prepare_js_request_context(
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
        let on_request = server.config().on_request;
        debug_assert!(!on_request.is_empty());

        let global = server.global_this();
        let response_value =
            match on_request.call(global, js_value, &[prepared.js_request, js_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

        server.handle_request(&should_deinit_context, &prepared, req, response_value);
    }

    /// Route-callback form of [`Self::on_request`].
    fn on_request_route(this: ThisPtr<Self>, req: uws_sys::AnyRequest, resp: uws::AnyResponse) {
        let (req, resp) = h1_parts::<SSL>(req, resp);
        Self::on_request(this, req, resp);
    }

    /// Dispatch a per-route handler
    /// (`routes: { "/path": handler }`).
    fn on_user_route_request(
        user_route: ThisPtr<UserRoute<SSL, DEBUG>>,
        req: uws_sys::AnyRequest,
        resp: uws::AnyResponse,
    ) {
        let (req, resp) = h1_parts::<SSL>(req, resp);
        let server = user_route.server;
        let index = user_route.id;

        let Some(server_js) = server.js_value_for_dispatch() else {
            server_body::respond_stopped_503(bun_opaque::opaque_deref_mut(resp));
            return;
        };

        let should_deinit_context = Cell::new(false);
        let method = user_route.route.method.specific();
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

        let server_ref = server.get();
        let _entered = server_ref.vm().enter_event_loop_scope_without_checkpoint();
        let global = server_ref.global_this();
        let server_request_list =
            Self::js_route_list_get_cached(server_js).expect("routeList cached value missing");
        let response_value = bun_jsc::host_fn::from_js_host_call(global, || {
            Bun__ServerRouteList__callRoute(
                global,
                index,
                prepared.request_ptr.as_ptr(),
                server_js,
                server_request_list,
                &mut prepared.js_request,
                core::ptr::from_mut(req).cast::<c_void>(),
            )
        })
        .unwrap_or_else(|err| global.take_exception(err));

        server_ref.handle_request(&should_deinit_context, &prepared, req, response_value);
    }

    /// node:http compat path; thin wrapper
    /// over [`Self::on_node_http_request_with_upgrade_ctx`] with no WS upgrade.
    pub(crate) fn on_node_http_request(
        this: ThisPtr<Self>,
        req: uws_sys::AnyRequest,
        resp: uws::AnyResponse,
    ) {
        jsc::mark_binding!();
        let (req, resp) = h1_parts::<SSL>(req, resp);
        // `upgrade_ctx` null is valid (no upgrade).
        this.on_node_http_request_with_upgrade_ctx(
            req,
            bun_opaque::opaque_deref_mut(resp),
            core::ptr::null_mut(),
        );
    }

    /// Invoke the JS-side
    /// `node:http` request handler (`NodeHTTPServer__onRequest_{http,https}`),
    /// then drive the returned promise / [`NodeHTTPResponse`] through the
    /// completion / abort / error paths.
    fn on_node_http_request_with_upgrade_ctx(
        &self,
        req: &mut uws_sys::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        upgrade_ctx: *mut uws_sys::WebSocketUpgradeContext,
    ) {
        use bun_http_jsc::method_jsc::MethodJsc as _;
        use node_http_response::Flags as NhrFlags;

        if self.js_value_for_dispatch().is_none() {
            server_body::respond_stopped_503(resp);
            return;
        }
        self.on_pending_request();
        let vm = self.vm();
        let _entered = vm.enter_event_loop_scope_without_checkpoint();
        req.set_yield(false);
        resp.timeout(self.config().idle_timeout);

        let global = self.global_this();
        let this_object = self.js_value.get().try_get().unwrap_or(JSValue::UNDEFINED);

        // Compute the JS method-name string up front so the FFI closure
        // doesn't need to reborrow `req` (it's already `&mut`-borrowed below).
        // Memoised per-method on the server: `Method::to_js` returns the global
        // object's GC-rooted common string, which is the same JSValue for every
        // request, so only the first request for a given method pays the FFI hop
        // into `Bun__HTTPMethod__toJS`. (`get(..)` falls back to a fresh intern
        // if a future method variant ever indexes past the cache.)
        let method_string = match bun_http::Method::find(req.method()) {
            Some(m) => match self.method_name_cache.get(m as usize) {
                Some(slot) => {
                    let cached = slot.get();
                    if cached == JSValue::ZERO {
                        let v = m.to_js(global);
                        slot.set(v);
                        v
                    } else {
                        cached
                    }
                }
                None => m.to_js(global),
            },
            None => JSValue::UNDEFINED,
        };
        let callback = self.config().on_node_http_request;

        let (nhr, node_response_object, has_body) = NodeHTTPResponse::create(
            AnyServer::from(self),
            global,
            req,
            any_response_from::<SSL>(resp),
            upgrade_ctx,
        );
        let mut is_async = false;

        let on_request_ffi = if SSL {
            ffi::NodeHTTPServer__onRequest_https
        } else {
            ffi::NodeHTTPServer__onRequest_http
        };
        let result: JSValue = bun_jsc::host_fn::from_js_host_call(global, || {
            on_request_ffi(
                global,
                this_object,
                callback,
                method_string,
                req,
                std::ptr::from_mut::<uws_sys::NewAppResponse<SSL>>(resp).cast(),
                node_response_object,
                has_body,
            )
        })
        .unwrap_or_else(|err| global.take_exception(err));

        enum HttpResult {
            Rejection(JSValue),
            Exception(JSValue),
            Success,
            Pending,
        }
        let mut strong_promise = jsc::StrongOptional::empty();
        let mut needs_to_drain = true;

        let http_result = 'brk: {
            if let Some(err) = result.to_error() {
                break 'brk HttpResult::Exception(err);
            }

            if let Some(promise) = result.as_any_promise() {
                // One `status()` read; only re-read after `drain_microtasks`
                // (which can settle a pending promise) actually runs.
                let mut status = promise.status();
                if status == jsc::js_promise::Status::Pending {
                    strong_promise.set(global, result);
                    needs_to_drain = false;
                    vm.as_mut().drain_microtasks();
                    // The drain ran script: an exception it left (a termination
                    // request landing in it) ends this dispatch like a throw
                    // from the handler; nothing below may enter script over it.
                    if global.has_exception() {
                        break 'brk HttpResult::Exception(
                            global.take_error(bun_jsc::JsError::Thrown),
                        );
                    }
                    status = promise.status();
                }

                match status {
                    jsc::js_promise::Status::Fulfilled => {
                        let _ = global.handle_rejected_promises();
                        break 'brk HttpResult::Success;
                    }
                    jsc::js_promise::Status::Rejected => {
                        promise.set_handled(global.vm());
                        break 'brk HttpResult::Rejection(promise.result(global.vm()));
                    }
                    jsc::js_promise::Status::Pending => {
                        let _ = global.handle_rejected_promises();
                        // Single `Cell` load for all three flag checks (no
                        // re-entry between them).
                        let nhr_flags = nhr.flags.get();
                        if nhr_flags.contains(NhrFlags::REQUEST_HAS_COMPLETED)
                            || nhr_flags.contains(NhrFlags::SOCKET_CLOSED)
                            || nhr_flags.contains(NhrFlags::UPGRADED)
                        {
                            strong_promise.deinit();
                            break 'brk HttpResult::Success;
                        }

                        let strong_self = nhr.get_this_value();
                        if strong_self.is_empty_or_undefined_or_null() {
                            strong_promise.deinit();
                            break 'brk HttpResult::Success;
                        }

                        nhr.promise.set(core::mem::replace(
                            &mut strong_promise,
                            jsc::StrongOptional::empty(),
                        ));
                        // `#[host_fn(export = …)]` emits its
                        // C-ABI shim as `__jsc_host_<fn>`; the export name
                        // is link-only.
                        result.then2(
                            global,
                            strong_self,
                            node_http_response::__jsc_host_node_http_request_on_resolve,
                            node_http_response::__jsc_host_node_http_request_on_reject,
                        );
                        is_async = true;

                        break 'brk HttpResult::Pending;
                    }
                }
            }

            HttpResult::Success
        };

        match &http_result {
            HttpResult::Exception(err) | HttpResult::Rejection(err) => {
                let _ = vm.as_mut().uncaught_exception(
                    global,
                    *err,
                    matches!(http_result, HttpResult::Rejection(_)),
                );

                let nhr_flags = nhr.flags.get();
                if !nhr_flags.contains(NhrFlags::UPGRADED) {
                    if let Some(raw) = nhr.raw_response.get() {
                        if !nhr_flags.contains(NhrFlags::REQUEST_HAS_COMPLETED)
                            && raw.state().is_response_pending()
                        {
                            if raw.state().is_http_status_called() {
                                raw.write_status(b"500 Internal Server Error");
                                raw.end_without_body(true);
                            } else {
                                raw.end_stream(true);
                            }
                        }
                    }
                }
                // The handler threw before `res.end()`; we just ended (or
                // will never end) the raw response above. Mark ENDED so
                // `on_request_complete()` → `mark_request_as_done()` runs
                // and releases the `IS_REQUEST_PENDING` ref (one of the
                // initial 3). Without this the box leaks: the later
                // `on_abort` socket-close path early-returns once
                // `REQUEST_HAS_COMPLETED` is set and never balances it.
                nhr.flags.set(nhr.flags.get() | NhrFlags::ENDED);
                nhr.on_request_complete();
            }
            HttpResult::Success | HttpResult::Pending => {}
        }

        let nhr_flags = nhr.flags.get();
        if !nhr_flags.contains(NhrFlags::UPGRADED) {
            if let Some(raw) = nhr.raw_response.get() {
                if !nhr_flags.contains(NhrFlags::REQUEST_HAS_COMPLETED)
                    && raw.state().is_response_pending()
                {
                    nhr.set_on_aborted_handler();
                }
                // If we ended the response without attaching an ondata handler, we discard the body read stream
                else if !matches!(http_result, HttpResult::Pending) {
                    let this_value = nhr.get_this_value();
                    nhr.maybe_stop_reading_body(vm.as_mut(), this_value);
                }
            }
            if nhr_flags.contains(NhrFlags::TUNNELED) {
                // Raw 'upgrade'/'connect' handoff: the exchange left HTTP, so
                // release the pending-request accounting now - a half-open
                // tunnel never closes, which stranded `pending_requests`.
                nhr.mark_request_as_done_if_necessary();
            }
        } else if nhr_flags.contains(NhrFlags::IS_REQUEST_PENDING) {
            // The socket was adopted by the WebSocket context inside the
            // handler; `raw_response` is gone and no further uws abort/end
            // callback will fire on it, so the IS_REQUEST_PENDING ref
            // (one of the initial 3) would otherwise strand and leak the
            // box. Release it now and balance the server's
            // pending-request counter via `mark_request_as_done()`.
            // `should_request_be_pending()` returns false once UPGRADED
            // is set, so this reaches `mark_request_as_done()`.
            nhr.on_request_complete();
        }

        // Cleanup, hoisted out of scopeguards (no early
        // returns above). Reverse-decl order: strong_promise, drain, deref.
        strong_promise.deinit();
        if needs_to_drain {
            vm.as_mut().drain_microtasks();
        }
        if is_async {
            // Our ref now belongs to the pending promise's reactions
            // (`node_http_request_on_resolve` / `_on_reject` release it).
            let _ = nhr.into_raw();
        } else {
            drop(nhr);
        }
    }

    fn js_route_list_get_cached(server_js: JSValue) -> Option<JSValue> {
        server_js_cached!(SSL, DEBUG, route_list_get_cached(server_js))
    }

    // `js_gc_route_list_set` and the per-callback slot setters live with the
    // `slot_setter!` invocations below (alongside `cached_values`).

    /// Wrap the server in its JS object. The C++ wrapper takes over `this`'s
    /// ref (released via `finalize`).
    pub(crate) fn ptr_to_js(this: RefPtr<Self>, global: &JSGlobalObject) -> JSValue {
        server_js_create(this.into_raw().cast(), global, SSL, DEBUG)
    }

    // `on_reload_from_zig` body lives in `server_body.rs` (`impl NewServer { … }`);
    // same crate, separate file, alongside `on_reload`/`reload_static_routes`.

    pub(crate) fn on_static_request_complete(&self) {
        self.on_request_complete();
    }

    #[inline]
    pub(crate) fn on_request_complete(&self) {
        self.pending_requests.set(self.pending_requests.get() - 1);
        self.deinit_if_we_can();
    }

    pub(crate) fn active_sockets_count(&self) -> u32 {
        self.active_websocket_count.get()
    }

    pub(crate) fn has_active_connections(&self) -> bool {
        self.active_connection_count.get() > 0
    }

    pub(crate) fn note_connection_opened(&self) {
        self.active_connection_count
            .set(self.active_connection_count.get().saturating_add(1));
    }

    /// Returns true when this close drained the last live HTTP connection.
    pub(crate) fn note_connection_closed(&self) -> bool {
        let prev = self.active_connection_count.get();
        if prev == 0 {
            return false;
        }
        let remaining = prev - 1;
        self.active_connection_count.set(remaining);
        remaining == 0
    }

    fn note_websocket_opened(&self) {
        self.active_websocket_count
            .set(self.active_websocket_count.get().saturating_add(1));
    }

    /// Returns true when this close drained the last live websocket.
    fn note_websocket_closed(&self) -> bool {
        let prev = self.active_websocket_count.get();
        // Guard underflow: a `close` reaching us without a matching `open`
        // (double-close on the JS side) must not wrap and return `true`.
        if prev == 0 {
            return false;
        }
        let remaining = prev - 1;
        self.active_websocket_count.set(remaining);
        remaining == 0
    }

    pub(crate) fn has_active_web_sockets(&self) -> bool {
        self.active_sockets_count() > 0
    }

    /// What the `stop()` promise (node:http: the `'close'` event) and the
    /// loop unref wait for. Bun.serve waits for open HTTP connections too;
    /// node:http's `server.close()` reports closed without them (Node's own
    /// `net.Server` waits for every connection — pre-existing divergence),
    /// so there they only pin the wrapper via [`Self::is_drained`].
    pub(crate) fn is_closed(&self) -> bool {
        self.pending_requests.get() == 0
            && !self.has_listener()
            && !self.has_active_web_sockets()
            && (self.config().is_node_http_server || !self.has_active_connections())
    }

    /// Nothing is left that can dispatch a handler: [`Self::is_closed`] and
    /// no open HTTP connection. The wrapper may only go `Weak` from here on
    /// (see [`Self::js_value_for_dispatch`]).
    pub(crate) fn is_drained(&self) -> bool {
        self.is_closed() && !self.has_active_connections()
    }

    pub(crate) fn has_listener(&self) -> bool {
        self.listener.get().is_some() || (Self::HAS_H3 && self.h3_listener.get().is_some())
    }

    pub(crate) fn set_flags(
        &self,
        require_host_header: bool,
        use_strict_method_validation: bool,
        lenient_http_flags: u8,
        http_allow_half_open: bool,
    ) {
        if let Some(app) = self.app_mut() {
            app.set_flags(
                require_host_header,
                use_strict_method_validation,
                lenient_http_flags,
                http_allow_half_open,
            );
        }
    }

    pub(crate) fn set_max_http_header_size(&self, max_header_size: u64) {
        if let Some(app) = self.app_mut() {
            app.set_max_http_header_size(max_header_size);
        }
    }

    pub fn ref_event_loop(&self) {
        if self.poll_ref.get().is_active() {
            return;
        }
        self.poll_ref.with_mut(|p| p.ref_(self.vm.loop_ctx()));
    }

    pub(crate) fn unref_event_loop(&self) {
        self.poll_ref.with_mut(|p| p.unref(self.vm.loop_ctx()));
    }

    pub(crate) fn stop_listening(&self, abrupt: bool) {
        // httplog!("stopListening", .{});

        crate::jsc_hooks::ActiveHandle::Server(AnyServer::from(self)).unregister();

        if let Some(h3l) = self.h3_listener.take() {
            // Graceful: GOAWAY + drain via the still-open UDP socket; the
            // engine rejects new conns and the timer keeps in-flight streams
            // progressing until deinit. Abrupt: close the fd now.
            if !abrupt {
                if let Some(h3a) = self.h3_app_mut() {
                    h3a.close();
                }
            } else {
                // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(h3l.as_ptr()).close();
            }
        }

        let already_terminated = self.has_flags(ServerFlags::TERMINATED);
        let Some(listener) = self.listener.take() else {
            if self.h3_app_ptr().is_some() {
                self.unref_event_loop();
                self.notify_inspector_server_stopped();
                if abrupt {
                    self.insert_flags(ServerFlags::TERMINATED);
                }
            }
            // An earlier graceful stop already took the listener. An abrupt
            // stop still has to tear down surviving connections; gated on the
            // pre-call `TERMINATED` so the H3 arm's insert above does not
            // mask the TCP teardown.
            if abrupt && !already_terminated {
                self.unref_event_loop();
                self.detach_websocket_handler(true, false);
                self.insert_flags(ServerFlags::TERMINATED);
                if let Some(app) = self.app_mut() {
                    self.deinit_running.set(true);
                    app.close();
                    self.deinit_running.set(false);
                }
                self.detach_websocket_handler(false, true);
            }
            return;
        };
        // S012: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
        let listener = bun_opaque::opaque_deref_mut(listener.as_ptr());
        if abrupt || self.is_closed() {
            self.unref_event_loop();
        }
        // A graceful stop with work in flight keeps the ref (deinit_if_we_can
        // unrefs when the drain completes): on Windows uv_run skips I/O with
        // zero ref'd handles, so unrefing here wedged server.close() teardown.

        if !SSL {
            let fd = listener.socket().fd();
            self.vm()
                .as_mut()
                .remove_listening_socket_for_watch_mode(fd);
        }
        self.notify_inspector_server_stopped();

        if let server_config::Address::Unix(path) = &self.config().address {
            let bytes = path.as_bytes();
            if !bytes.is_empty() && bytes[0] != 0 {
                let _ = bun_sys::unlink(path.as_zstr());
            }
        }

        if !abrupt {
            listener.close();
            // Close idle keep-alive connections now and mark busy ones to
            // close once their in-flight work completes; open websockets are
            // untouched and drain on their own. Each close reaches
            // `on_connection_filter(-2)` synchronously, so hold the guard so
            // that path skips its `deinit_if_we_can` — `stop()` runs it right
            // after this returns.
            //
            // node:http servers are exempt: Node's `close()` sweeps idle
            // connections exactly once (the JS layer already called
            // `closeIdleConnections()`), and a connection whose response
            // completes after `close()` stays keep-alive until its timeout
            // reaps it — verified against Node v26.
            if !self.config().is_node_http_server {
                if let Some(app) = self.app_mut() {
                    self.deinit_running.set(true);
                    let _closed = app.close_idle_connections(true);
                    self.deinit_running.set(false);
                }
            }
        } else if !self.has_flags(ServerFlags::TERMINATED) {
            self.detach_websocket_handler(true, false);
            self.insert_flags(ServerFlags::TERMINATED);
            // `app.close()` synchronously drains every open websocket; their
            // `on_close` defers call `on_websocket_closed`, which would run
            // `deinit_if_we_can` mid-drain. Hold the re-entrance guard across
            // the drain so that nested call early-returns — `stop()` runs
            // `deinit_if_we_can` itself right after this returns.
            self.deinit_running.set(true);
            self.app_mut().expect("server app is live").close();
            self.deinit_running.set(false);
            // Only clear after the drain — `on_close` defers reach
            // `on_websocket_closed` through `handler.server`, so wiping it
            // earlier would strand the live-socket count and the idle pass
            // would never see it drained.
            self.detach_websocket_handler(false, true);
        }
    }

    pub(crate) fn stop(&self, abrupt: bool) {
        {
            let config = self.config();
            if config.allow_hot && !config.id.is_empty() {
                if let Some(hot) = self.vm().as_mut().hot_map() {
                    hot.remove(&config.id);
                }
            }
        }

        self.stop_listening(abrupt);
        self.deinit_if_we_can();
    }

    #[inline]
    pub(crate) fn deinit_if_we_can(&self) {
        // Re-entrance guard. The websocket-close / connection-close triggers
        // can land here while an outer frame is inside one of the synchronous
        // `app.close()` drains. The body is idempotent, so the outer call will
        // finish the work — skip the nested run.
        if self.deinit_running.get() {
            return;
        }
        self.deinit_running.set(true);
        // Cleared inline at the tail (no early returns below). A panic
        // mid-body leaves the flag set — acceptable, the idle pass panicking
        // means this server is unrecoverable anyway.

        httplog!(
            "deinitIfWeCan. requests={}, listener={}, connections={}, websockets={}, has_handled_all_closed_promise={}, all_closed_promise={}, has_js_deinited={}",
            self.pending_requests.get(),
            if self.listener.get().is_none() {
                "null"
            } else {
                "some"
            },
            self.active_connection_count.get(),
            if self.has_active_web_sockets() {
                "active"
            } else {
                "no"
            },
            self.has_flags(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE),
            if self.all_closed_promise.get().has_value() {
                "has"
            } else {
                "no"
            },
            matches!(self.js_value.get(), jsc::JsRef::Finalized),
        );

        let closed = self.is_closed();
        if closed
            && !self.has_flags(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE)
            && self.all_closed_promise.get().has_value()
            // `ServerAllConnectionsClosedTask::run_from_js_thread` early-returns
            // (without resolving the promise) when the VM is shutting down —
            // see the `if !vm.is_shutting_down()` gate there. Skip the
            // allocation entirely so a `Server::finalize()` that fires during
            // `lastChanceToFinalize()` doesn't strand a `Box` (and its
            // `JSPromiseStrong`) that no event-loop tick will ever drain.
            && !self.vm().is_shutting_down()
        {
            httplog!("schedule other promise");
            // use a flag here instead of `this.all_closed_promise.get().isHandled(vm)` to prevent the race condition of this block being called
            // again before the task has run.
            self.insert_flags(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE);

            let global = self.global_this();
            let vm_ref = jsc::VirtualMachine::get_mut();
            ServerAllConnectionsClosedTask::schedule(
                ServerAllConnectionsClosedTask {
                    global_object: self.global_this,
                    // Duplicate the Strong handle so that we can hold two independent strong references to it.
                    promise: jsc::JSPromiseStrong::from_value(
                        self.all_closed_promise.get().value(),
                        global,
                    ),
                    tracker: jsc::AsyncTaskTracker::init(vm_ref),
                },
                vm_ref,
            );
        }
        if closed {
            self.unref_event_loop();
        }
        if self.is_drained() {
            // No handler is dispatched from here on (`js_value_for_dispatch`), so the wrapper —
            // the handlers' only GC root — may become collectible.
            self.js_value.with_mut(|v| v.downgrade());
            self.detach_websocket_handler(true, true);

            // Detach DevServer. This is needed because there are aggressive
            // tests that check for DevServer memory soundness. Keeping the JS
            // binding alive should not pin `dev.memory_cost()` bytes.
            if let Some(dev) = self.dev_server.replace(None) {
                if let Some(app) = self.app_mut() {
                    app.clear_routes();
                }
                drop(dev); // dev.deinit()
            }

            // Only free the memory if the JS reference has been freed too.
            if matches!(self.js_value.get(), jsc::JsRef::Finalized) {
                self.schedule_deinit();
            }
        }
        self.deinit_running.set(false);
    }

    pub(crate) fn schedule_deinit(&self) {
        if self.has_flags(ServerFlags::DEINIT_SCHEDULED) {
            httplog!("scheduleDeinit (again)");
            return;
        }
        self.insert_flags(ServerFlags::DEINIT_SCHEDULED);
        httplog!("scheduleDeinit");

        let vm = self.vm().as_mut();
        if vm.is_shutting_down() {
            // No more ticks; `finalize()` tears down via `DEINIT_SCHEDULED` instead.
            return;
        }

        if !self.has_flags(ServerFlags::TERMINATED) {
            // App.close can cause finalizers to run.
            // scheduleDeinit can be called inside a finalizer.
            // Therefore, we split it into two tasks.
            self.insert_flags(ServerFlags::TERMINATED);
            let app = self.app_ptr().expect("server app is live");
            vm.enqueue_task(bun_event_loop::ManagedTask::ManagedTask::new(app, |app| {
                // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                bun_opaque::opaque_deref_mut(app).close();
                Ok(())
            }));
        }

        // The queued task holds its own ref; `self_ref` stays (the app's
        // registrations are live) until the task's `teardown()` releases it.
        let this = self
            .self_ref
            .get()
            .as_ref()
            .expect("server app is live")
            .clone();
        vm.enqueue_task(bun_event_loop::ManagedTask::ManagedTask::new_boxed(
            Box::new(DeinitTask(this)),
        ));
    }

    pub(crate) fn on_listen(&self, socket: Option<NonNull<uws_sys::app::ListenSocket<SSL>>>) {
        let Some(socket) = socket else {
            return self.on_listen_failed();
        };
        self.listener.set(Some(socket));
        let vm = self.vm().as_mut();
        vm.event_loop_handle = Some(bun_io::Loop::get());
        if !SSL {
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            let fd = bun_opaque::opaque_deref_mut(socket.as_ptr()).socket().fd();
            vm.add_listening_socket_for_watch_mode(fd);
        }
    }

    /// Build the bind/listen failure as a `SystemError` (so JS sees
    /// `err.code`/`err.syscall`) and `globalThis.throwValue` it. The BoringSSL
    /// error-stack drain is still TODO; the EADDRINUSE/
    /// EACCES paths below cover the node:http `server.listen` error contract.
    #[cold]
    pub(crate) fn on_listen_failed(&self) {
        self.listener.set(None);
        let global = self.global_this();

        let error_instance = match &self.config().address {
            server_config::Address::Tcp {
                port,
                hostname: _hostname,
            } => {
                // Rust's `target_os = "linux"` excludes
                // Android, so match both explicitly.
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    let errno = bun_sys::last_error();
                    if errno == bun_sys::E::EACCES {
                        let host = _hostname
                            .as_ref()
                            .map(|h| h.as_bytes())
                            .unwrap_or(b"0.0.0.0");
                        let err = jsc::SystemError {
                            message: bun_core::String::create_format(format_args!(
                                "permission denied {}:{}",
                                bstr::BStr::new(host),
                                port
                            )),
                            code: bun_core::String::static_("EACCES"),
                            syscall: bun_core::String::static_("listen"),
                            ..Default::default()
                        };
                        let _ = global.throw_value(err.to_error_instance(global));
                        return;
                    }
                    // e.g. ENOSPC from epoll_ctl(EPOLL_CTL_ADD). Linux-only because
                    // on other platforms errno is not reliably preserved through
                    // the C++/callback chain to here; see PR #30364.
                    if errno != bun_sys::E::SUCCESS && errno != bun_sys::E::EADDRINUSE {
                        let err = jsc::SystemError::from(
                            bun_sys::Error::from_code(errno, bun_sys::Tag::listen)
                                .to_system_error(),
                        );
                        let _ = global.throw_value(err.to_error_instance(global));
                        return;
                    }
                }
                jsc::SystemError {
                    message: bun_core::String::create_format(format_args!(
                        "Failed to start server. Is port {} in use?",
                        port
                    )),
                    code: bun_core::String::static_("EADDRINUSE"),
                    syscall: bun_core::String::static_("listen"),
                    ..Default::default()
                }
                .to_error_instance(global)
            }
            server_config::Address::Unix(unix) => {
                let unix = unix.as_bytes();
                match bun_sys::last_error() {
                    bun_sys::E::SUCCESS => jsc::SystemError {
                        message: bun_core::String::create_format(format_args!(
                            "Failed to listen on unix socket {}",
                            bun_core::fmt::QuotedFormatter { text: unix }
                        )),
                        code: bun_core::String::static_("EADDRINUSE"),
                        syscall: bun_core::String::static_("listen"),
                        ..Default::default()
                    }
                    .to_error_instance(global),
                    e => jsc::SystemError::from(
                        bun_sys::Error::from_code(e, bun_sys::Tag::listen)
                            .with_path(unix)
                            .to_system_error(),
                    )
                    .to_error_instance(global),
                }
            }
        };

        error_instance.ensure_still_alive();
        let _ = global.throw_value(error_instance);
    }

    pub(crate) fn on_h3_listen(&self, socket: Option<NonNull<uws_sys::h3::ListenSocket>>) {
        if !Self::HAS_H3 {
            return;
        }
        let Some(socket) = socket else { return };
        // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
        let port = bun_opaque::opaque_deref_mut(socket.as_ptr()).get_local_port();
        self.h3_listener.set(Some(socket));
        if let Some(port) = port {
            self.h3_alt_svc.set(
                format!("h3=\":{port}\"; ma=86400")
                    .into_bytes()
                    .into_boxed_slice(),
            );
        }
        // An `http3_server` feature counter is not (yet) declared in
        // `bun_analytics`. No-op until it is.
    }

    // ─── teardown ────────────────────────────────────────────────────────────
    /// Destroy the uws app handles and hand back the ref they held (if still
    /// held); dropping it releases it, which may free `self`. Called from
    /// `schedule_deinit`'s task, on listen-failure, or from `finalize()` at VM
    /// shutdown.
    pub(super) fn teardown(&self) -> Option<RefPtr<Self>> {
        httplog!("teardown");
        // This should've already been handled in stop_listening; however, when
        // the JS VM terminates, it hypothetically might not call stop_listening.
        self.notify_inspector_server_stopped();
        crate::jsc_hooks::ActiveHandle::Server(AnyServer::from(self)).unregister();

        drop(self.h3_app.replace(None));
        self.drop_h2_app();
        drop(self.app.replace(None));
        self.self_ref.replace(None)
    }

    pub(crate) fn set_using_custom_expect_handler(&self, value: bool) {
        if let Some(app) = self.app_ptr() {
            ffi::NodeHTTP_setUsingCustomExpectHandler(SSL, app.cast::<c_void>(), value);
        }
    }

    // ─── init ────────────────────────────────────────────────────────────────
    /// Allocate and populate a `NewServer` from `config`. The config is moved
    /// into the server (left as `Default` in the caller's slot). Route
    /// registration and the listen socket happen later in `listen()`.
    pub(crate) fn init(config: &mut ServerConfig, global: &JSGlobalObject) -> JsResult<RefPtr<Self>>
    where
        Self: ServerPools<SSL, DEBUG>,
    {
        let base_url: Box<[u8]> = bun_core::trim(&config.base_uri, b"/")
            .to_vec()
            .into_boxed_slice();

        let server = RefPtr::new(Self {
            ref_count: Cell::new(1),
            self_ref: JsCell::new(None),
            global_this: std::ptr::from_ref(global),
            method_name_cache: [const { Cell::new(JSValue::ZERO) }; N_HTTP_METHODS],
            config: JsCell::new(core::mem::take(config)),
            base_url_string_for_joining: base_url,
            vm: bun_ptr::BackRef::new(jsc::VirtualMachine::get()),
            dev_server: JsCell::new(None),
            app: JsCell::new(None),
            listener: Cell::new(None),
            h3_app: JsCell::new(None),
            h2_app: JsCell::new(None),
            h3_listener: Cell::new(None),
            h3_alt_svc: JsCell::new(Box::<[u8]>::default()),
            js_value: JsCell::new(jsc::JsRef::empty()),
            pending_requests: Cell::new(0),
            active_connection_count: Cell::new(0),
            active_websocket_count: Cell::new(0),
            deinit_running: Cell::new(false),
            request_pool: <Self as ServerPools<SSL, DEBUG>>::request_pool(),
            // Servers that enable neither HTTP/2 nor HTTP/3 never allocate the
            // ~816 KB mux pool; `listen()` materializes it on demand.
            mux_request_pool: Cell::new(None),
            all_closed_promise: JsCell::new(jsc::JSPromiseStrong::default()),
            poll_ref: JsCell::new(KeepAlive::default()),
            flags: Cell::new(ServerFlags::default()),
            plugins: JsCell::new(None),
            user_routes: JsCell::new(Vec::new()),
            on_clienterror: Cell::new(JSValue::ZERO),
            on_connection: Cell::new(JSValue::ZERO),
            inspector_server_id: Cell::new(jsc::DebuggerId::init(0)),
        });

        // The bake options (and the arena that backs `root`) live in
        // `server.config.bake` for the server's lifetime. Initialise
        // DevServer AFTER the server exists so the `Options::arena` borrow
        // points into the heap-allocated config rather than the caller's
        // (since-moved) stack slot. On Err, releasing the ref frees the
        // half-built server.
        let dev = server.config.with_mut(|config| {
            let Some(bake_options) = &mut config.bake else {
                return Ok(None);
            };
            crate::bake::DevServer::init(crate::bake::DevServer::Options {
                arena: &bake_options.arena,
                root: bake_options.root,
                vm: jsc::VirtualMachine::get(),
                // LAYERING: `UserOptions` carries the `bake_body` shapes;
                // `DevServer::Options` consumes the keystone shapes;
                // `From` impls in `bake/mod.rs` bridge
                // until the duplicates are collapsed.
                framework: core::mem::take(&mut bake_options.framework).into(),
                bundler_options: core::mem::take(&mut bake_options.bundler_options).into(),
                broadcast_console_log_from_browser_to_server: config
                    .broadcast_console_log_from_browser_to_server_for_bake,
            })
            .map(Some)
        });
        match dev {
            Ok(dev) => server.dev_server.set(dev),
            Err(e) => {
                drop(server);
                return Err(e);
            }
        }

        if SSL {
            bun_analytics::features::https_server.fetch_add(1, Ordering::Relaxed);
        } else {
            bun_analytics::features::http_server.fetch_add(1, Ordering::Relaxed);
        }

        Ok(server)
    }

    // ─── set_routes ──────────────────────────────────────────────────────────
    /// Register HTTP routes on `self.app` (and `h2_app`/`h3_app` when present). Returns
    /// the JS `RouteList` value for codegen-backed user routes, or `.zero` when
    /// there are none.
    fn set_routes(&self) -> JSValue {
        use bun_http_types::Method as http_method;
        let mut route_list_value = JSValue::ZERO;
        // set_routes is only called after `self.app` is created in listen().
        let app = self.app_mut().expect("server app is live");
        let this = self.this_ptr();
        let any_server = AnyServer::from(self);
        let has_dev_server = self.dev_server.get().is_some();

        // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
        // Only enable this when we're using the dev server.
        let mut should_add_chrome_devtools_json_route = DEBUG
            && self.config().allow_hot
            && has_dev_server
            && self
                .config()
                .enable_chrome_devtools_automatic_workspace_folders;
        const CHROME_DEVTOOLS_ROUTE: &[u8] = b"/.well-known/appspecific/com.chrome.devtools.json";

        // --- 1. user_routes_to_build → user_routes + RouteList JS object ---
        if !self.config().user_routes_to_build.is_empty() {
            let mut to_build = self
                .config
                .with_mut(|c| core::mem::take(&mut c.user_routes_to_build));
            let len = to_build.len();
            let mut callbacks: Vec<JSValue> = Vec::with_capacity(len);
            let mut user_routes = Vec::with_capacity(len);
            for (i, builder) in to_build.iter_mut().enumerate() {
                callbacks.push(builder.callback.get());
                user_routes.push(bun_ptr::OwnedThis::new(UserRoute {
                    id: i as u32,
                    server: this.into(),
                    route: core::mem::take(&mut builder.route),
                }));
            }
            self.user_routes.set(user_routes);
            // Scratch array for the C++ factory; borrows the route paths now
            // owned by `self.user_routes` (validated ASCII by ServerConfig).
            let mut paths: Vec<bun_core::EncodedSlice<'_>> = self
                .user_routes
                .get()
                .iter()
                .map(|r| bun_core::EncodedSlice::latin1(r.route.path.as_bytes()))
                .collect();
            // `global_this` is the live VM global; scratch slices are valid for
            // `len` elements; C++ copies paths/callbacks into the returned JS
            // object so the borrows end at return.
            route_list_value = Bun__ServerRouteList__create(
                self.global_this,
                callbacks.as_mut_ptr(),
                paths.as_mut_ptr(),
                len,
            );
            // `to_build` (and its `Strong` callbacks) drops here — AFTER the
            // C++ factory has re-rooted them inside the RouteList object.
            drop(to_build);
        }

        // --- 2. WebSocket handler app reference ---
        self.config.with_mut(|c| {
            if let Some(websocket) = c.websocket.as_mut() {
                websocket.handler.app = Some(std::ptr::from_mut(app).cast::<c_void>());
                websocket.handler.server = Some(any_server);
                websocket
                    .handler
                    .flags
                    .set(web_socket_server_context::HandlerFlags::SSL, SSL);
            }
        });

        // --- 3. Register compiled user routes & track "/*" coverage ---
        let mut star_methods_covered_by_user = http_method::Set::empty();
        let mut has_any_user_route_for_star_path = false;
        let mut has_any_ws_route_for_star_path = false;

        let ws_behavior: Option<uws_sys::WebSocketBehavior> =
            self.config().websocket.as_ref().map(|ws| ws.to_behavior());

        for user_route in self.user_routes.get().iter() {
            let ud = user_route.this_ptr();
            let path = user_route.route.path.as_bytes();
            let is_star_path = path == b"/*";
            if is_star_path {
                has_any_user_route_for_star_path = true;
            }
            if should_add_chrome_devtools_json_route
                && (path == CHROME_DEVTOOLS_ROUTE || path.starts_with(b"/.well-known/"))
            {
                should_add_chrome_devtools_json_route = false;
            }

            // Register HTTP routes
            match user_route.route.method {
                server_config::RouteMethod::Any => {
                    app.any_this(path, Self::on_user_route_request, ud);
                    for_each_mux_app!(self, |mux| {
                        mux.any_this(path, Self::on_mux_user_route_request, ud);
                    });
                    if is_star_path {
                        star_methods_covered_by_user = http_method::Set::all();
                    }
                    if let Some(behavior) = &ws_behavior {
                        if is_star_path {
                            has_any_ws_route_for_star_path = true;
                        }
                        // id 1 means is a user route
                        app.ws_this::<UserRoute<SSL, DEBUG>, ServerWebSocket>(
                            path, ud, 1, behavior,
                        );
                    }
                }
                server_config::RouteMethod::Specific(method_val) => {
                    app.method_this(method_val, path, Self::on_user_route_request, ud);
                    for_each_mux_app!(self, |mux| {
                        mux.method_this(method_val, path, Self::on_mux_user_route_request, ud);
                    });
                    if is_star_path {
                        star_methods_covered_by_user.insert(method_val);
                    }
                    // Setup user websocket in the route if needed.
                    if let Some(behavior) = &ws_behavior {
                        // Websocket upgrade is a GET request
                        if method_val == http_method::Method::GET {
                            app.ws_this::<UserRoute<SSL, DEBUG>, ServerWebSocket>(
                                path, ud, 1, behavior,
                            );
                        }
                    }
                }
            }
        }

        // --- 4. Register negative routes ---
        // A `false` route means "fall through to the default handler": same
        // ladder as the `/*` fallback in step 9. H2/H3 stay on on_mux_request,
        // which already falls back to on_mux_404 when on_request is empty.
        let has_node_http = !self.config().on_node_http_request.is_empty();
        let has_on_request = !self.config().on_request.is_empty();
        // The default handler for a method (or `None` = any) on `path`.
        let fallback_h1 =
            |app: &mut uws_sys::NewApp<SSL>, method: Option<http_method::Method>, path: &[u8]| {
                macro_rules! reg {
                    ($h:expr) => {
                        match method {
                            Some(m) => app.method_this(m, path, $h, this),
                            None => app.any_this(path, $h, this),
                        }
                    };
                }
                if has_node_http {
                    reg!(Self::on_node_http_request)
                } else if has_on_request {
                    reg!(Self::on_request_route)
                } else {
                    reg!(Self::on_404)
                }
            };
        for route_path in self.config().negative_routes.iter() {
            let p = route_path.as_bytes();
            fallback_h1(app, Some(http_method::Method::HEAD), p);
            fallback_h1(app, None, p);
            for_each_mux_app!(self, |mux| {
                mux.method_this(http_method::Method::HEAD, p, Self::on_mux_request, this);
                mux.any_this(p, Self::on_mux_request, this);
            });
        }

        // --- 5. Register static routes & track "/*" coverage ---
        let mut needs_plugins = has_dev_server;
        let mut has_static_route_for_star_path = false;

        for entry in &self.config().static_routes {
            if &*entry.path == b"/*" {
                has_static_route_for_star_path = true;
                match &entry.method {
                    server_config::MethodOptional::Any => {
                        star_methods_covered_by_user = http_method::Set::all();
                    }
                    server_config::MethodOptional::Method(method) => {
                        star_methods_covered_by_user |= *method;
                    }
                }
            }
            if should_add_chrome_devtools_json_route
                && (&*entry.path == CHROME_DEVTOOLS_ROUTE
                    || entry.path.starts_with(b"/.well-known/"))
            {
                should_add_chrome_devtools_json_route = false;
            }

            // An explicit HEAD handler route must stay the HEAD handler for its
            // path: uWS keeps the last registration for a method and path, and
            // static routes register after user routes.
            let path_has_user_head_route = self.user_routes.get().iter().any(|route| match &route
                .route
                .method
            {
                server_config::RouteMethod::Specific(method) => {
                    *method == http_method::Method::HEAD
                        && route.route.path.as_bytes() == &*entry.path
                }
                server_config::RouteMethod::Any => false,
            });

            macro_rules! apply {
                ($T:ty, $r:expr) => {{
                    server_config::apply_static_route::<SSL, $T>(
                        any_server,
                        app,
                        $r.this_ptr(),
                        &entry.path,
                        entry.method,
                        path_has_user_head_route,
                    );
                    for_each_mux_app!(self, |mux| {
                        server_config::apply_static_route_mux::<$T, _>(
                            any_server,
                            mux,
                            $r.this_ptr(),
                            &entry.path,
                            entry.method,
                            path_has_user_head_route,
                        );
                    });
                }};
            }
            match &entry.route {
                AnyRoute::Static(r) => apply!(StaticRoute, r),
                AnyRoute::File(r) => apply!(FileRoute, r),
                AnyRoute::Directory(r) => apply!(DirectoryRoute, r),
                AnyRoute::Html(r) => {
                    apply!(html_bundle::Route, r);
                    self.dev_server.with_mut(|dev| {
                        if let Some(dev) = dev {
                            bun_core::handle_oom(
                                dev.html_router.put(&entry.path, r.this_ptr().into()),
                            );
                        }
                    });
                    needs_plugins = true;
                }
                AnyRoute::FrameworkRouter(_) => {}
            }
        }

        // --- 6. Initialize plugins if needed ---
        if needs_plugins && self.plugins.get().is_none() {
            // Cloning here (not `.take()`) so subsequent `Bun.serve()` calls in
            // the same process — and `DevServer`'s tailwind-hack probe of the
            // same field — still see the bunfig-configured plugin list.
            if let Some(serve_plugins_config) = jsc::VirtualMachine::get()
                .transpiler
                .options
                .serve_plugins
                .as_ref()
            {
                if !serve_plugins_config.is_empty() {
                    self.plugins
                        .set(Some(ServePlugins::init(serve_plugins_config.clone())));
                }
            }
        }

        // --- 7. Debug-mode specific routes ---
        if DEBUG {
            app.method_this(
                http_method::Method::GET,
                b"/bun:info",
                Self::on_bun_info_request,
                this,
            );
        }

        // Snapshot "/*" coverage from user/static routes before DevServer
        // (which is H1-only and not mirrored to the H2/H3 routers) marks it full.
        let mux_star_covered = star_methods_covered_by_user;

        // --- 8. Handle DevServer routes & track "/*" coverage ---
        let mut has_dev_server_for_star_path = false;
        if has_dev_server {
            // dev.setRoutes might register its own "/*" HTTP handler
            has_dev_server_for_star_path = self.dev_server.with_mut(|dev| {
                bun_core::handle_oom(
                    dev.as_deref_mut()
                        .expect("checked above")
                        .set_routes::<SSL, DEBUG>(self),
                )
            });
            if has_dev_server_for_star_path {
                // Assume dev server "/*" covers all methods if it exists
                star_methods_covered_by_user = http_method::Set::all();
            }
        }

        // Setup user websocket fallback route aka fetch function; if fetch is
        // not provided will respond with 403.
        if !has_any_ws_route_for_star_path {
            if let Some(behavior) = &ws_behavior {
                // id 0 means is a fallback route and ctx is the server
                app.ws_this::<Self, ServerWebSocket>(b"/*", this, 0, behavior);
            }
        }

        // --- 9. Consolidated "/*" HTTP fallback registration ---
        if star_methods_covered_by_user == http_method::Set::all() {
            // User/Static/Dev has already provided a "/*" handler for ALL methods.
            // No further global "/*" HTTP fallback needed.
        } else if has_any_user_route_for_star_path
            || has_static_route_for_star_path
            || has_dev_server_for_star_path
        {
            // A "/*" route exists, but doesn't cover all methods. Apply the
            // global handler to the *remaining* methods for "/*".
            for method_to_cover in !star_methods_covered_by_user {
                fallback_h1(app, Some(method_to_cover), b"/*");
            }
        } else {
            fallback_h1(app, None, b"/*");
        }

        // H2/H3 fallback — same three-way as H1 above, but driven by user/static
        // "/*" coverage only (DevServer routes are not mirrored to H2/H3).
        for_each_mux_app!(self, |mux| {
            // The default handler for a method (or `None` = any) on "/*".
            macro_rules! fallback_mux {
                ($method:expr) => {
                    match ($method, has_on_request) {
                        (Some(m), true) => mux.method_this(m, b"/*", Self::on_mux_request, this),
                        (Some(m), false) => mux.method_this(m, b"/*", Self::on_mux_404, this),
                        (None, true) => mux.any_this(b"/*", Self::on_mux_request, this),
                        (None, false) => mux.any_this(b"/*", Self::on_mux_404, this),
                    }
                };
            }
            if mux_star_covered == http_method::Set::all() {
                // user/static "/*" already covers every method
            } else if has_any_user_route_for_star_path || has_static_route_for_star_path {
                for m in !mux_star_covered {
                    fallback_mux!(Some(m));
                }
            } else {
                fallback_mux!(None::<http_method::Method>);
            }
        });

        if should_add_chrome_devtools_json_route {
            app.method_this(
                http_method::Method::GET,
                CHROME_DEVTOOLS_ROUTE,
                Self::on_chrome_dev_tools_json_request,
                this,
            );
        }

        // Idempotent, so re-running set_routes on reload() is fine.
        if self.config().is_node_http_server {
            ffi::NodeHTTP_assignOnNodeJSCompat(SSL, std::ptr::from_mut(app).cast::<c_void>());
        }

        route_list_value
    }

    fn on_404(_this: ThisPtr<Self>, _req: uws_sys::AnyRequest, resp: uws::AnyResponse) {
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    /// Throw `msg` unless an exception (or a BoringSSL error) is already
    /// pending, then tear the half-built server down. `listen()`'s failure tail.
    #[cold]
    fn fail_listen(
        this: ThisPtr<Self>,
        msg: core::fmt::Arguments<'_>,
        check_ssl_error: bool,
    ) -> JSValue {
        let global = this.global_this();
        if !global.has_exception() && !(check_ssl_error && throw_ssl_error_if_necessary(global)) {
            let _ = global.throw(msg);
        }
        drop(this.teardown());
        JSValue::ZERO
    }

    /// `config.http2`: attach an HTTP/2 context to `app`. On failure returns
    /// the message for `fail_listen` (empty when an exception is already
    /// pending).
    fn attach_http2(&self) -> Result<(), &'static str>
    where
        Self: ServerPools<SSL, DEBUG>,
    {
        let (http2, is_node_http, http1, idle_timeout) = {
            let cfg = self.config();
            (
                cfg.http2,
                cfg.is_node_http_server || !cfg.on_node_http_request.is_empty(),
                cfg.http1,
                u32::from(cfg.idle_timeout),
            )
        };
        if !http2 {
            return Ok(());
        }
        let has_dev_server = self.dev_server.get().is_some();
        // node:http compat servers and DevServer's HMR/asset routes are HTTP/1-only.
        if is_node_http || has_dev_server {
            let why = if has_dev_server {
                "while the development server (HTML imports with HMR) is active"
            } else {
                "for node:http servers"
            };
            if !http1 {
                let _ = self.global_this().throw_invalid_arguments(format_args!(
                    "http1: false with http2: true is not supported {why}"
                ));
                return Err("");
            }
            bun_core::warn!("http2: true is ignored {}", why);
            return Ok(());
        }
        let app = self.app_mut().expect("created before attach_http2");
        let Some(h2) = uws_sys::h2::OwnedApp::create::<SSL>(app, http1, idle_timeout) else {
            return Err("Failed to create HTTP/2 server");
        };
        // Streams parked on socket backpressure by a JS-driven write get their
        // next drain pass from the event loop's deferred task queue (after the
        // current task and its microtasks), like the HTTP/1 sink's auto-flush.
        extern "C" fn schedule_h2_drain(app: *mut c_void, _ctx: *mut c_void) {
            extern "C" fn drain(app: *mut c_void) -> bool {
                // S012: `h2::App` is an `opaque_ffi!` ZST — safe deref.
                // Stay registered while streams are still queued.
                bun_opaque::opaque_deref_mut(app.cast::<uws_sys::h2::App>()).drain()
            }
            jsc::VirtualMachine::get()
                .event_loop_ref()
                .deferred_tasks
                .post_task(NonNull::new(app), drain);
        }
        let h2_ptr = h2.as_ptr();
        bun_opaque::opaque_deref_mut(h2_ptr)
            .on_schedule_drain(schedule_h2_drain, h2_ptr.cast::<c_void>());
        self.h2_app.set(Some(h2));
        if self.mux_request_pool.get().is_none() {
            self.mux_request_pool
                .set(Some(<Self as ServerPools<SSL, DEBUG>>::mux_request_pool()));
        }
        Ok(())
    }

    // ─── listen ──────────────────────────────────────────────────────────────
    /// Create the uws `App<SSL>` (and optional H2/H3 apps), register routes via
    /// `set_routes()`, and bind the listen socket. On any failure the apps are
    /// torn down synchronously and `.zero` is returned with an exception
    /// pending on `global_this`; the caller still owns its ref.
    pub(crate) fn listen(this: ThisPtr<Self>) -> JSValue
    where
        Self: ServerPools<SSL, DEBUG>,
    {
        httplog!("listen");
        // `set_routes()` and the listen callbacks mutate `config` through its
        // `JsCell`, so nothing below holds a `&ServerConfig` across them: each
        // read re-derives, and names/addresses are copied out first.
        let server = this.get();
        let global = server.global_this();

        let bad_hostname: Option<Vec<u8>> = match &server.config().address {
            server_config::Address::Tcp {
                hostname: Some(hostname),
                ..
            } if !bun_dns::is_valid_hostname(strip_ipv6_brackets(hostname.as_bytes())) => {
                Some(hostname.as_bytes().to_vec())
            }
            _ => None,
        };
        if let Some(hostname) = bad_hostname {
            let _ = global.throw_value(crate::dns_jsc::cares_jsc::not_a_hostname_error(
                global, &hostname,
            ));
            return Self::fail_listen(this, format_args!(""), false);
        }

        let route_list_value;

        if SSL {
            bun_boringssl::load();
            let Some(ssl_options) = server.config().ssl_config.as_ref().map(|c| c.as_usockets())
            else {
                // unreachable in practice — fromJS guarantees ssl_config when SSL.
                return Self::fail_listen(
                    this,
                    format_args!("Failed to create HTTPS server: missing tls config"),
                    false,
                );
            };

            let Some(app) = uws_sys::app::OwnedApp::<SSL>::create(&ssl_options) else {
                return Self::fail_listen(this, format_args!("Failed to create HTTP server"), true);
            };
            server.app.set(Some(app));
            server.self_ref.set(Some(RefPtr::from_this(this)));

            if Self::HAS_H3 && server.config().http3 {
                let idle_timeout = server.config().idle_timeout as u32;
                let Some(h3) = uws_sys::h3::OwnedApp::create(&ssl_options, idle_timeout) else {
                    return Self::fail_listen(
                        this,
                        format_args!("Failed to create HTTP/3 server"),
                        false,
                    );
                };
                server.h3_app.set(Some(h3));
                server
                    .mux_request_pool
                    .set(Some(<Self as ServerPools<SSL, DEBUG>>::mux_request_pool()));
            }
            if let Err(msg) = server.attach_http2() {
                return Self::fail_listen(this, format_args!("{msg}"), false);
            }

            route_list_value = server.set_routes();
            let app = server.app_mut().expect("just created");

            // add serverName to the SSL context using the default ssl options
            let server_name: Option<std::ffi::CString> = server
                .config()
                .ssl_config
                .as_ref()
                .and_then(|c| c.server_name_cstr())
                .filter(|n| !n.to_bytes().is_empty())
                .map(core::ffi::CStr::to_owned);
            if let Some(server_name) = server_name.as_deref() {
                if app
                    .add_server_name_with_options(server_name, &ssl_options, false)
                    .is_err()
                {
                    return Self::fail_listen(
                        this,
                        format_args!(
                            "Failed to add serverName: {}",
                            bstr::BStr::new(server_name.to_bytes())
                        ),
                        true,
                    );
                }
                if throw_ssl_error_if_necessary(global) {
                    return Self::fail_listen(this, format_args!(""), false);
                }

                app.domain(bun_core::ZStr::from_cstr(server_name));
                if throw_ssl_error_if_necessary(global) {
                    return Self::fail_listen(this, format_args!(""), false);
                }

                // Ensure routes are set for that domain name.
                let _ = server.set_routes();
            }

            // SNI: per-hostname contexts
            let sni_len = server.config().sni.as_ref().map_or(0, |s| s.slice().len());
            for i in 0..sni_len {
                let named = {
                    let sni = server.config().sni.as_ref().expect("counted above");
                    let sni_ssl_config = &sni.slice()[i];
                    sni_ssl_config
                        .server_name_cstr()
                        .filter(|n| !n.to_bytes().is_empty())
                        .map(|n| (n.to_owned(), sni_ssl_config.as_usockets()))
                };
                let Some((sni_name, sni_opts)) = named else {
                    continue;
                };
                let z = bun_core::ZStr::from_cstr(&sni_name);

                if let Some(h3_app) = server.h3_app_mut() {
                    if h3_app.add_server_name_with_options(z, &sni_opts).is_err() {
                        return Self::fail_listen(
                            this,
                            format_args!(
                                "Failed to add serverName \"{}\" for HTTP/3",
                                bstr::BStr::new(sni_name.to_bytes())
                            ),
                            false,
                        );
                    }
                }
                if app
                    .add_server_name_with_options(&sni_name, &sni_opts, true)
                    .is_err()
                {
                    return Self::fail_listen(
                        this,
                        format_args!(
                            "Failed to add serverName: {}",
                            bstr::BStr::new(sni_name.to_bytes())
                        ),
                        true,
                    );
                }
                app.domain(z);
                if throw_ssl_error_if_necessary(global) {
                    return Self::fail_listen(this, format_args!(""), false);
                }
                let _ = server.set_routes();
            }
        } else {
            let Some(app) =
                uws_sys::app::OwnedApp::<SSL>::create(&uws_sys::BunSocketContextOptions::default())
            else {
                return Self::fail_listen(
                    this,
                    format_args!("Failed to create HTTP server"),
                    false,
                );
            };
            server.app.set(Some(app));
            server.self_ref.set(Some(RefPtr::from_this(this)));
            if let Err(msg) = server.attach_http2() {
                return Self::fail_listen(this, format_args!("{msg}"), false);
            }
            route_list_value = server.set_routes();
        }

        let app = server.app_mut().expect("just created");
        app.filter_this(Self::on_connection_filter, this);

        if server.config().is_node_http_server {
            server.set_using_custom_expect_handler(true);
        }

        // Copy the address out of `config`: the listen callbacks run
        // synchronously inside the calls below.
        enum Addr {
            Tcp {
                port: u16,
                host: Option<bun_core::ZBox>,
            },
            Unix(bun_core::ZBox),
        }
        let (addr, tcp, options) = {
            let config = server.config();
            let addr = match &config.address {
                server_config::Address::Tcp { port, hostname } => Addr::Tcp {
                    port: *port,
                    host: hostname.as_deref().map(|existing| {
                        let bytes = existing.as_bytes();
                        let bare = strip_ipv6_brackets(bytes);
                        if bare.len() == bytes.len() {
                            bun_core::ZBox::from_bytes(bytes)
                        } else {
                            bun_core::ZBox::from_bytes(bare)
                        }
                    }),
                },
                server_config::Address::Unix(unix) => {
                    Addr::Unix(bun_core::ZBox::from_bytes(unix.as_bytes()))
                }
            };
            (
                addr,
                config.http1 || config.http2,
                config.get_usockets_options(),
            )
        };

        match &addr {
            Addr::Tcp { port, host } => {
                let port = *port;
                let host: *const c_char = host.as_ref().map_or(core::ptr::null(), |h| h.as_ptr());
                // With `{port: 0, http3: true}` we bind TCP:0 (kernel picks N),
                // then must bind UDP:N for QUIC so Alt-Svc works. UDP:N may
                // already be held by an unrelated process. When the user asked
                // for "any port" (0), close TCP:N and retry the whole TCP+UDP
                // bind so the kernel picks a fresh N. Never retry a
                // user-specified non-zero port.
                let max_attempts: u8 = if Self::HAS_H3 && tcp && port == 0 {
                    3
                } else {
                    1
                };
                let mut attempt: u8 = 0;
                loop {
                    attempt += 1;
                    if tcp {
                        app.listen_with_config_this(
                            |s: ThisPtr<Self>, socket| s.on_listen(socket),
                            this,
                            uws_app_c::uws_app_listen_config_t {
                                port: port as c_int,
                                host,
                                options,
                            },
                        );
                    }

                    if let Some(h3_app) = server.h3_app_mut() {
                        // Same UDP port as the TCP listener so Alt-Svc works.
                        let h3_port: u16 = match server.listener_mut() {
                            Some(ls) => ls.get_local_port().unwrap_or(port),
                            None => port,
                        };
                        h3_app.listen_with_config_this(
                            this,
                            |s: ThisPtr<Self>, ls| s.on_h3_listen(ls),
                            &uws_sys::h3::ListenConfig {
                                port: h3_port,
                                host,
                                options,
                            },
                        );
                        if server.h3_listener.get().is_none() {
                            if attempt < max_attempts {
                                // UDP:N is taken — release TCP:N so the next
                                // attempt gets a fresh kernel-chosen port.
                                // Only retry if TCP actually succeeded.
                                if let Some(ls) = server.listener.take() {
                                    bun_opaque::opaque_deref_mut(ls.as_ptr()).close();
                                    continue;
                                }
                            }
                            if !global.has_exception() {
                                let _ = global.throw(format_args!(
                                    "Failed to listen on UDP port {h3_port} for HTTP/3"
                                ));
                                // post-match `has_exception()` check below handles
                                // teardown + return ZERO.
                            }
                        }
                        if !tcp {
                            jsc::VirtualMachine::get().as_mut().event_loop_handle =
                                Some(bun_io::Loop::get());
                        }
                    }
                    break;
                }
            }
            Addr::Unix(unix) => {
                if let Some(h3a) = server.h3_app.replace(None) {
                    // QUIC over AF_UNIX is non-standard and Alt-Svc can't
                    // advertise it; drop the H3 listener instead of wiring
                    // an exotic transport nobody can reach.
                    bun_core::warn!("http3: true with a unix socket — HTTP/3 listener skipped");
                    drop(h3a);
                }
                app.listen_on_unix_socket_this(
                    |s: ThisPtr<Self>, socket| s.on_listen(socket),
                    this,
                    unix.as_zstr(),
                    options,
                );
            }
        }

        if global.has_exception() {
            drop(this.teardown());
            return JSValue::ZERO;
        }

        server.ref_event_loop();

        // NOTE: the "starting an HTTP server is a good time to GC" nudge runs
        // from the caller (`serve_with!` in BunObject.rs) after the handler
        // callbacks are rooted in the wrapper's WriteBarrier slots; see
        // `gc_hint_after_listen` below.

        route_list_value
    }

    /// The server-just-started GC nudge, split out of `listen()` so
    /// `serve_with!` can run it after the wrapper's handler slots are
    /// populated. Between `init()` (which `mem::take`s `config` into the
    /// heap-boxed `NewServer`) and the slot writes, a Proxy- or
    /// accessor-backed options object's fresh handler fn is held only by the
    /// unscanned heap box, so collecting there would free a fn we then write
    /// into the slot and dispatch into.
    pub(crate) fn gc_hint_after_listen(&self) {
        let vm = self.vm();
        if vm.aggressive_garbage_collection == jsc::virtual_machine::GCLevel::Aggressive {
            vm.auto_garbage_collect();
        } else {
            vm.event_loop_ref().perform_gc();
        }
    }
}

/// The queued second half of `schedule_deinit` (holds its own ref).
struct DeinitTask<const SSL: bool, const DEBUG: bool>(RefPtr<NewServer<SSL, DEBUG>>);

impl<const SSL: bool, const DEBUG: bool> bun_event_loop::ManagedTask::RunOnce
    for DeinitTask<SSL, DEBUG>
{
    fn run(self) -> JsResult<()> {
        drop(self.0.teardown());
        drop(self.0);
        Ok(())
    }

    /// The VM is going away without running us (nor, maybe, the `close` task
    /// queued ahead of us): close and tear down all the same so the server and
    /// its app do not outlive it.
    fn cancelled(self) {
        if let Some(app) = self.0.app_mut() {
            app.close();
        }
        let _ = Self::run(self);
    }
}

// ─── route-list codegen externs ──────────────────────────────────────────────
// Canonical decls live in `server_body.rs` (shared with the H3 path); reuse
// them here instead of redeclaring with a divergent `req` pointer type.
use server_body::{Bun__ServerRouteList__callRoute, Bun__ServerRouteList__create};

/// Per-type cached-accessor shims for the server `WriteBarrier` value slots.
/// `codegen_cached_accessors!` emits `${snake}_{get,set}_cached` wrapping
/// `${T}Prototype__${prop}{Get,Set}CachedValue` (generate-classes.ts).
mod cached_values {
    macro_rules! per_type {
        ($ty:literal) => {
            bun_jsc::codegen_cached_accessors!(
                $ty; routeList, onRequest, onError, onNodeHTTPRequest, onClientError, onConnection,
                wsOnOpen, wsOnMessage, wsOnClose, wsOnDrain, wsOnError, wsOnPing, wsOnPong
            );
        };
    }
    pub(super) mod http {
        per_type!("HTTPServer");
    }
    pub(super) mod https {
        per_type!("HTTPSServer");
    }
    pub(super) mod debug_http {
        per_type!("DebugHTTPServer");
    }
    pub(super) mod debug_https {
        per_type!("DebugHTTPSServer");
    }
}

/// `(SSL, DEBUG)` → per-type `cached_values` submodule dispatch for the
/// codegen'd `${snake}_{get,set}_cached` accessors.
macro_rules! server_js_cached {
    ($ssl:expr, $debug:expr, $fn:ident($($arg:expr),* $(,)?)) => {
        match ($ssl, $debug) {
            (false, false) => $crate::server::cached_values::http::$fn($($arg),*),
            (true, false) => $crate::server::cached_values::https::$fn($($arg),*),
            (false, true) => $crate::server::cached_values::debug_http::$fn($($arg),*),
            (true, true) => $crate::server::cached_values::debug_https::$fn($($arg),*),
        }
    };
}
pub(crate) use server_js_cached;

// Dispatch reads from the shadow JSValue fields, not the wrapper slots, so
// only the slot setter is generated here. The slot is the GC-traced root; the
// shadow is the hot-path read.
macro_rules! slot_setter {
    ($set_fn:ident, $set_cached:ident) => {
        pub fn $set_fn(server_js: JSValue, global: &JSGlobalObject, v: JSValue) {
            server_js_cached!(SSL, DEBUG, $set_cached(server_js, global, v))
        }
    };
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    slot_setter!(js_gc_route_list_set, route_list_set_cached);
    slot_setter!(js_gc_on_request_set, on_request_set_cached);
    slot_setter!(js_gc_on_error_set, on_error_set_cached);
    slot_setter!(
        js_gc_on_node_http_request_set,
        on_node_h_t_t_p_request_set_cached
    );
    slot_setter!(js_gc_on_client_error_set, on_client_error_set_cached);
    slot_setter!(js_gc_on_connection_set, on_connection_set_cached);
    slot_setter!(js_gc_ws_on_open_set, ws_on_open_set_cached);
    slot_setter!(js_gc_ws_on_message_set, ws_on_message_set_cached);
    slot_setter!(js_gc_ws_on_close_set, ws_on_close_set_cached);
    slot_setter!(js_gc_ws_on_drain_set, ws_on_drain_set_cached);
    slot_setter!(js_gc_ws_on_error_set, ws_on_error_set_cached);
    slot_setter!(js_gc_ws_on_ping_set, ws_on_ping_set_cached);
    slot_setter!(js_gc_ws_on_pong_set, ws_on_pong_set_cached);

    /// Mirror all 7 `Handler.on_*` shadows into the wrapper's `m_wsOn*`
    /// WriteBarrier slots, applying the async-context wrap (deferred from
    /// `Handler::from_js` so the wrapped fn is rooted the moment it exists).
    /// Writes all slots unconditionally — `JSValue::ZERO` clears, so a reload
    /// that omits a callback drops the previous root. Same contract as
    /// [`wrap_handler_slot`]; called after `ptr_to_js` in `serve()` and after
    /// the websocket-context swap in `on_reload_from_zig`; dispatch keeps
    /// reading the shadow.
    pub(crate) fn write_ws_handler_slots(&self, server_js: JSValue, global: &JSGlobalObject) {
        // No websocket config: route a throwaway ZERO through each slot so a
        // transition to "no websocket" drops the previous roots. Redundant on
        // initial serve (slots default ZERO) — `serve()` gates this call on
        // `websocket.is_some()` — but the doc'd contract is "writes all slots
        // unconditionally" so a future call site can't leave stale roots behind.
        self.config.with_mut(|config| {
            let mut zeros = [JSValue::ZERO; 7];
            let [open, message, close, drain, error, ping, pong] = match config.websocket.as_mut() {
                Some(ws) => {
                    let h = &mut ws.handler;
                    [
                        &mut h.on_open,
                        &mut h.on_message,
                        &mut h.on_close,
                        &mut h.on_drain,
                        &mut h.on_error,
                        &mut h.on_ping,
                        &mut h.on_pong,
                    ]
                }
                None => zeros.each_mut(),
            };
            wrap_handler_slot(open, server_js, global, Self::js_gc_ws_on_open_set);
            wrap_handler_slot(message, server_js, global, Self::js_gc_ws_on_message_set);
            wrap_handler_slot(close, server_js, global, Self::js_gc_ws_on_close_set);
            wrap_handler_slot(drain, server_js, global, Self::js_gc_ws_on_drain_set);
            wrap_handler_slot(error, server_js, global, Self::js_gc_ws_on_error_set);
            wrap_handler_slot(ping, server_js, global, Self::js_gc_ws_on_ping_set);
            wrap_handler_slot(pong, server_js, global, Self::js_gc_ws_on_pong_set);
        });
    }

    /// [`wrap_handler_slot`] for the three request-handler shadows in `config`.
    pub(crate) fn write_request_handler_slots(&self, server_js: JSValue, global: &JSGlobalObject) {
        self.config.with_mut(|config| {
            wrap_handler_slot(
                &mut config.on_request,
                server_js,
                global,
                Self::js_gc_on_request_set,
            );
            wrap_handler_slot(
                &mut config.on_error,
                server_js,
                global,
                Self::js_gc_on_error_set,
            );
            wrap_handler_slot(
                &mut config.on_node_http_request,
                server_js,
                global,
                Self::js_gc_on_node_http_request_set,
            );
        });
    }
}

// ─── per-monomorphization request pools ──────────────────────────────────────
// Rust generics cannot own statics, so
// declare one `thread_local!` per concrete (SSL, DEBUG, H3) combo via macro and
// hand the leaked pool back through a trait.
//
// THREAD-SAFETY: this MUST be thread-local, not process-global. `hive_array::
// Fallback` has no internal synchronization; a process-static would race when
// two `Bun.serve` instances run on distinct Worker threads (each Worker has
// its own event loop and may host a server).
pub trait ServerPools<const SSL: bool, const DEBUG: bool>: Sized + 'static {
    fn request_pool()
    -> &'static request_context::RequestContextStackAllocator<Self, SSL, DEBUG, false>;
    fn mux_request_pool()
    -> &'static request_context::RequestContextStackAllocator<Self, SSL, DEBUG, true>;
}

macro_rules! impl_server_pools {
    ($(($ssl:literal, $debug:literal)),* $(,)?) => {$(
        impl ServerPools<$ssl, $debug> for NewServer<$ssl, $debug> {
            fn request_pool() -> &'static request_context::RequestContextStackAllocator<Self, $ssl, $debug, false> {
                type Pool = request_context::RequestContextStackAllocator<NewServer<$ssl, $debug>, $ssl, $debug, false>;
                thread_local! {
                    // `new_boxed` writes only the 256 B bitset in place
                    // (the ~816 KB slot buffer stays uninitialized).
                    static POOL: &'static Pool = Box::leak(Pool::new_boxed());
                }
                POOL.with(|p| *p)
            }
            fn mux_request_pool() -> &'static request_context::RequestContextStackAllocator<Self, $ssl, $debug, true> {
                type Pool = request_context::RequestContextStackAllocator<NewServer<$ssl, $debug>, $ssl, $debug, true>;
                thread_local! {
                    static POOL: &'static Pool = Box::leak(Pool::new_boxed());
                }
                POOL.with(|p| *p)
            }
        }
    )*};
}
impl_server_pools!((false, false), (true, false), (false, true), (true, true));

// ─── FFI ─────────────────────────────────────────────────────────────────────
mod ffi {
    use super::*;
    unsafe extern "C" {
        // `app` is the opaque `uws::App<SSL>*`; C++ only flips a flag / assigns a
        // handler. Callers pass the live `self.app` handle, so no precondition.
        pub(super) safe fn NodeHTTP_setUsingCustomExpectHandler(
            ssl: bool,
            app: *mut c_void,
            value: bool,
        );
        pub(super) safe fn NodeHTTP_assignOnNodeJSCompat(ssl: bool, app: *mut c_void);

        /// `src/jsc/bindings/NodeHTTP.cpp` — constructs the JS
        /// `IncomingMessage` argument list around the `NodeHTTPResponse` the
        /// caller created and invokes `callback(req, res)`. The plain-HTTP and
        /// HTTPS monomorphizations differ only in the `Response<SSL>` opaque type.
        ///
        /// `&JSGlobalObject`/`&mut uws_sys::Request` discharge the deref'd-param
        /// preconditions; `response` is the opaque uws handle (module-private —
        /// sole caller passes the live pointer).
        pub(super) safe fn NodeHTTPServer__onRequest_http(
            global: &jsc::JSGlobalObject,
            this_value: jsc::JSValue,
            callback: jsc::JSValue,
            method_string: jsc::JSValue,
            request: &mut uws_sys::Request,
            response: *mut c_void, // *uws.NewApp(false).Response
            node_response_object: jsc::JSValue,
            has_body: bool,
        ) -> jsc::JSValue;

        pub(super) safe fn NodeHTTPServer__onRequest_https(
            global: &jsc::JSGlobalObject,
            this_value: jsc::JSValue,
            callback: jsc::JSValue,
            method_string: jsc::JSValue,
            request: &mut uws_sys::Request,
            response: *mut c_void, // *uws.NewApp(true).Response
            node_response_object: jsc::JSValue,
            has_body: bool,
        ) -> jsc::JSValue;
    }
}

/// `Bun.serve({ hostname: "[::1]" })`: uSockets wants the IPv6 literal bare.
fn strip_ipv6_brackets(hostname: &[u8]) -> &[u8] {
    if let [b'[', inner @ .., b']'] = hostname {
        if bun_core::ip_address::to_ip_address(inner).is_some_and(|ip| ip.is_ipv6()) {
            return inner;
        }
    }
    hostname
}

/// Drain the BoringSSL error queue; if non-empty, throw the top error on
/// `global` and return true.
fn throw_ssl_error_if_necessary(global: &JSGlobalObject) -> bool {
    let err_code = bun_boringssl_sys::ERR_get_error();
    if err_code != 0 {
        let _ = global.throw_value(crate::crypto::create_crypto_error(global, err_code));
        bun_boringssl_sys::ERR_clear_error();
        return true;
    }
    false
}

// `RequestContext` reaches back into its server via this; mirrors the
// field/method surface the per-request state machine needs without naming
// `NewServer` (avoids a generic-parameter cycle).
pub trait ServerLike {
    fn global_this(&self) -> &jsc::JSGlobalObject;
    fn vm(&self) -> &jsc::VirtualMachine;
    fn config(&self) -> &ServerConfig;
    fn on_request_complete(&self);
    fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer>;
    fn js_value(&self) -> &jsc::JsRef;
    fn h3_alt_svc(&self) -> Option<&[u8]>;
    fn terminated(&self) -> bool;
}

impl<const SSL: bool, const DEBUG: bool> ServerLike for NewServer<SSL, DEBUG> {
    // These trait-method forwards are on the per-request hot path (called via
    // `RequestContext::server.vm()` etc.). Without `#[inline]` a generic trait
    // impl is not eligible for cross-crate inlining at all, so each accessor
    // would compile to a real `call` even though the inherent method it
    // forwards to is itself one instruction.
    #[inline(always)]
    fn global_this(&self) -> &jsc::JSGlobalObject {
        Self::global_this(self)
    }
    #[inline(always)]
    fn vm(&self) -> &jsc::VirtualMachine {
        Self::vm(self)
    }
    #[inline(always)]
    fn config(&self) -> &ServerConfig {
        Self::config(self)
    }
    #[inline]
    fn on_request_complete(&self) {
        Self::on_request_complete(self)
    }
    #[inline]
    fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> {
        self.dev_server.get().as_deref()
    }
    #[inline(always)]
    fn js_value(&self) -> &jsc::JsRef {
        self.js_value.get()
    }
    #[inline]
    fn h3_alt_svc(&self) -> Option<&[u8]> {
        Self::h3_alt_svc(self)
    }
    #[inline(always)]
    fn terminated(&self) -> bool {
        self.has_flags(ServerFlags::TERMINATED)
    }
}

// ─── Type aliases ────────────────────────────────────────────────────────────
pub type HTTPServer = NewServer<false, false>;
pub type HTTPSServer = NewServer<true, false>;
pub type DebugHTTPServer = NewServer<false, true>;
pub type DebugHTTPSServer = NewServer<true, true>;

// ─── AnyServer ───────────────────────────────────────────────────────────────
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnyServerTag {
    HTTPServer = 0,
    HTTPSServer = 1,
    DebugHTTPServer = 2,
    DebugHTTPSServer = 3,
}

/// Back-reference to one of the four `NewServer` monomorphizations. Held by
/// the routes, request contexts, websockets and `NodeHTTPResponse`s a server
/// creates — all of which it outlives (it is freed only once drained).
#[derive(Clone, Copy)]
pub enum AnyServer {
    HTTPServer(bun_ptr::BackRef<HTTPServer>),
    HTTPSServer(bun_ptr::BackRef<HTTPSServer>),
    DebugHTTPServer(bun_ptr::BackRef<DebugHTTPServer>),
    DebugHTTPSServer(bun_ptr::BackRef<DebugHTTPSServer>),
}

impl PartialEq for AnyServer {
    fn eq(&self, other: &Self) -> bool {
        core::ptr::eq(self.as_opaque_ptr(), other.as_opaque_ptr())
    }
}
impl Eq for AnyServer {}
impl core::hash::Hash for AnyServer {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.as_opaque_ptr().hash(state);
    }
}

/// Dispatch over the four `NewServer` monomorphizations (`$s: &NewServer<..>`).
macro_rules! any_server_dispatch {
    ($self:expr, |$s:ident| $body:expr) => {{
        match $self {
            AnyServer::HTTPServer(s) => {
                let $s: &$crate::server::HTTPServer = s.get();
                $body
            }
            AnyServer::HTTPSServer(s) => {
                let $s: &$crate::server::HTTPSServer = s.get();
                $body
            }
            AnyServer::DebugHTTPServer(s) => {
                let $s: &$crate::server::DebugHTTPServer = s.get();
                $body
            }
            AnyServer::DebugHTTPSServer(s) => {
                let $s: &$crate::server::DebugHTTPSServer = s.get();
                $body
            }
        }
    }};
}

/// Dispatch over the four `NewServer` monomorphizations, simultaneously
/// downcasting an [`uws::AnyResponse`] to the matching `*mut Response<SSL>`.
///
/// Binds `$s: ThisPtr<NewServer<SSL, DEBUG>>` and `$r: *mut
/// uws_sys::Response<SSL>`. Tag↔SSL invariant is enforced by
/// `assert_ssl`/`assert_no_ssl` (panics on `AnyResponse::H3`).
macro_rules! any_server_dispatch_resp {
    ($self:expr, $resp:expr, |$s:ident, $r:ident| $body:expr) => {{
        let __resp = $resp;
        match $self {
            AnyServer::HTTPServer(s) => {
                let $s = s.get().this_ptr();
                let $r = __resp.assert_no_ssl();
                $body
            }
            AnyServer::HTTPSServer(s) => {
                let $s = s.get().this_ptr();
                let $r = __resp.assert_ssl();
                $body
            }
            AnyServer::DebugHTTPServer(s) => {
                let $s = s.get().this_ptr();
                let $r = __resp.assert_no_ssl();
                $body
            }
            AnyServer::DebugHTTPSServer(s) => {
                let $s = s.get().this_ptr();
                let $r = __resp.assert_ssl();
                $body
            }
        }
    }};
}

impl AnyServer {
    pub(crate) fn from<const SSL: bool, const DEBUG: bool>(
        server: &NewServer<SSL, DEBUG>,
    ) -> AnyServer {
        // `NewServer<SSL, DEBUG>` *is* the alias named in each arm; the cast
        // only renames the const parameters rustc cannot unify syntactically.
        let p = NonNull::from(server);
        match (SSL, DEBUG) {
            (false, false) => AnyServer::HTTPServer(p.cast::<HTTPServer>().into()),
            (true, false) => AnyServer::HTTPSServer(p.cast::<HTTPSServer>().into()),
            (false, true) => AnyServer::DebugHTTPServer(p.cast::<DebugHTTPServer>().into()),
            (true, true) => AnyServer::DebugHTTPSServer(p.cast::<DebugHTTPSServer>().into()),
        }
    }

    /// The server's address as an opaque token (inspector / hot-map keys).
    #[inline]
    pub(crate) fn as_opaque_ptr(&self) -> *mut () {
        match self {
            AnyServer::HTTPServer(s) => s.as_const_ptr().cast::<()>().cast_mut(),
            AnyServer::HTTPSServer(s) => s.as_const_ptr().cast::<()>().cast_mut(),
            AnyServer::DebugHTTPServer(s) => s.as_const_ptr().cast::<()>().cast_mut(),
            AnyServer::DebugHTTPSServer(s) => s.as_const_ptr().cast::<()>().cast_mut(),
        }
    }

    /// Shared borrow of the process-static VM. Routes through
    /// [`NewServer::vm`], which centralizes the SAFETY invariant (`vm` is a
    /// STATIC backref set in `init()`; non-null for the server's lifetime).
    ///
    /// `vm`/`global_this` are read several times per request from
    /// `NodeHTTPResponse` host_fns via `self.server`. The `vm` field is at
    /// the same byte offset across all four `NewServer<SSL,DEBUG>`
    /// monomorphizations, so `any_server_dispatch!` collapses to a single
    /// load under inlining; without `#[inline]` it stays a 4-arm tag match
    /// behind a real `call`.
    #[inline]
    pub(crate) fn vm(&self) -> &jsc::VirtualMachine {
        any_server_dispatch!(self, |s| s.vm())
    }

    /// Shared borrow of the per-process `JSGlobalObject`. Routes through
    /// [`NewServer::global_this`] (same SAFETY contract: never-null backref,
    /// never moved or freed while any `NewServer` exists).
    #[inline]
    pub fn global_this(&self) -> &jsc::JSGlobalObject {
        any_server_dispatch!(self, |s| s.global_this())
    }

    #[inline]
    pub(crate) fn config(&self) -> &ServerConfig {
        any_server_dispatch!(self, |s| s.config())
    }

    /// Same gate as [`NewServer::js_value_for_dispatch`].
    #[inline]
    pub(crate) fn js_value_for_dispatch(&self) -> Option<JSValue> {
        any_server_dispatch!(self, |s| s.js_value_for_dispatch())
    }

    pub(crate) fn h3_alt_svc(&self) -> Option<&[u8]> {
        match self {
            AnyServer::HTTPSServer(s) => s.get().h3_alt_svc(),
            AnyServer::DebugHTTPSServer(s) => s.get().h3_alt_svc(),
            _ => None,
        }
    }

    pub(crate) fn inspector_server_id(&self) -> jsc::DebuggerId {
        any_server_dispatch!(self, |s| s.inspector_server_id.get())
    }

    fn on_websocket_opened(&self) {
        any_server_dispatch!(self, |s| s.note_websocket_opened());
    }

    /// Decrement the live-socket count and, when the last socket drained on
    /// an already-stopped server, run the idle pass so the `JsRef` downgrade
    /// (and deferred deinit) that was held back by the open sockets fires.
    ///
    /// Skipped while still listening (the idle pass would no-op). Re-entrance
    /// during the abrupt-stop synchronous drain is handled by the
    /// `deinit_running` guard inside `deinit_if_we_can` itself — gating on
    /// `TERMINATED` here also blocked the post-`stop(true)` close defer that
    /// must fire the downgrade when `stop` was called from inside a close
    /// handler (the socket whose handler ran decrements only after `stop`
    /// returns, so `stop`'s own idle pass still sees it live).
    fn on_websocket_closed(&self) {
        any_server_dispatch!(self, |s| {
            if s.note_websocket_closed() && !s.has_listener() {
                s.deinit_if_we_can();
            }
        });
    }

    pub(crate) fn set_inspector_server_id(&self, id: jsc::DebuggerId) {
        any_server_dispatch!(self, |s| {
            s.inspector_server_id.set(id);
            s.dev_server.with_mut(|dev| {
                if let Some(dev_server) = dev.as_deref_mut() {
                    dev_server.inspector_server_id = id;
                }
            });
        })
    }

    pub(crate) fn on_pending_request(&self) {
        any_server_dispatch!(self, |s| s.on_pending_request())
    }

    /// Dispatch the user `fetch` handler:
    /// un-erase the SSL bool from the tag and downcast
    /// `AnyResponse` to the matching `NewAppResponse<SSL>` variant.
    pub(crate) fn on_request(&self, req: &mut uws_sys::Request, resp: uws::AnyResponse) {
        any_server_dispatch_resp!(self, resp, |s, r| NewServer::on_request(s, req, r))
    }

    pub(crate) fn on_request_complete(&self) {
        any_server_dispatch!(self, |s| s.on_request_complete())
    }

    pub(crate) fn on_static_request_complete(&self) {
        any_server_dispatch!(self, |s| s.on_static_request_complete())
    }

    pub(crate) fn stop(&self, abrupt: bool) {
        any_server_dispatch!(self, |s| s.stop(abrupt))
    }

    pub(crate) fn num_subscribers(&self, topic: &[u8]) -> u32 {
        any_server_dispatch!(self, |s| match s.app_mut() {
            Some(app) => app.num_subscribers(topic),
            // Defensive 0
            // here for the post-stop window; assert in debug to catch misuse.
            None => {
                debug_assert!(false, "num_subscribers on server with no app");
                0
            }
        })
    }

    pub(crate) fn publish(
        &self,
        topic: &[u8],
        message: &[u8],
        opcode: uws::Opcode,
        compress: bool,
    ) -> uws::SendStatus {
        any_server_dispatch!(self, |s| match s.app_mut() {
            Some(app) => app.publish(topic, message, opcode, compress),
            // Defensive for the post-stop window; assert in debug to catch misuse.
            None => {
                debug_assert!(false, "publish on server with no app");
                uws::SendStatus::Dropped
            }
        })
    }

    /// Wraps a stack-lifetime µWS request into a
    /// JS-visible `Request` + heap `RequestContext` so it can outlive the
    /// handler frame (used by bake's deferred bundling path).
    pub(crate) fn prepare_and_save_js_request_context(
        &self,
        req: &mut uws::Request,
        resp: uws::AnyResponse,
        global: &jsc::JSGlobalObject,
        method: Option<bun_http::Method>,
    ) -> jsc::JsResult<Option<SavedRequest>> {
        let req: &mut uws_sys::Request = req;
        Ok(any_server_dispatch_resp!(self, resp, |s, r| {
            let Some(p) = NewServer::prepare_js_request_context(
                s,
                req,
                r,
                None,
                CreateJsRequest::Bake,
                method,
            ) else {
                return Ok(None);
            };
            Some(p.save(global, req, r))
        }))
    }

    /// Invoke the user's route handler for a request that
    /// was deferred (bake bundle-then-serve flow).
    pub(crate) fn on_saved_request<const EXTRA_ARG_COUNT: usize>(
        &self,
        req: SavedRequestUnion<'_>,
        resp: uws::AnyResponse,
        callback: jsc::JSValue,
        extra_args: [jsc::JSValue; EXTRA_ARG_COUNT],
    ) {
        any_server_dispatch_resp!(self, resp, |s, r| {
            NewServer::on_saved_request(s, req, r, callback, extra_args)
        })
    }

    /// Run `f` on the DevServer (when configured). HTMLBundle's request path
    /// mutates DevServer state (`respond_for_html_bundle`).
    pub(crate) fn with_dev_server_mut<R>(
        &self,
        f: impl FnOnce(&mut crate::bake::DevServer::DevServer) -> R,
    ) -> Option<R> {
        any_server_dispatch!(self, |s| s
            .dev_server
            .with_mut(|dev| dev.as_deref_mut().map(f)))
    }

    /// Returns:
    /// - `Ready(None)` if no plugin has to be loaded
    /// - `Err` if there is a cached failure. Currently, this requires restarting the entire server.
    /// - `Pending` if `callback` was stored. It will call `on_plugins_resolved` or `on_plugins_rejected` later.
    pub(crate) fn get_or_load_plugins(
        &self,
        callback: ServePluginsCallback,
    ) -> GetOrStartLoadResult<'_> {
        any_server_dispatch!(self, |s| s.get_or_load_plugins(callback))
    }

    pub(crate) fn append_static_route(
        &self,
        path: &[u8],
        route: AnyRoute,
        method: server_config::MethodOptional,
    ) -> Result<(), crate::Error> {
        any_server_dispatch!(self, |s| s
            .config
            .with_mut(|c| c.append_static_route(path, route, method)))
    }

    pub(crate) fn reload_static_routes(&self) -> Result<bool, crate::Error> {
        any_server_dispatch!(self, |s| s.reload_static_routes())
    }

    pub(crate) fn get_url_as_string(&self) -> Result<bun_core::String, bun_alloc::AllocError> {
        any_server_dispatch!(self, |s| s.get_url_as_string())
    }
}

// ─── http_server_agent ───────────────────────────────────────────────────────
/// `jsc.Debugger.HTTPServerAgent.{notifyServerStarted, notifyServerStopped,
/// notifyServerRoutesUpdated}` — the FFI plumbing lives in
/// `bun_jsc::http_server_agent`; the bodies live here because they reach into
/// `AnyServer`/`ServerConfig` (forward dep from `bun_jsc`'s point of view).
pub(crate) mod http_server_agent {
    use super::{AnyRoute, AnyServer};

    use bun_core::String as BunString;
    use bun_jsc::debugger::DebuggerId;
    use bun_jsc::http_server_agent::{HTTPServerAgent, InspectorHTTPServerAgent, Route, RouteType};

    /// Assign the server a fresh inspector id and tell the C++ inspector
    /// agent (if attached) that it started, passing its URL and start time.
    pub(crate) fn notify_server_started(this: &mut HTTPServerAgent, instance: AnyServer) {
        let Some(agent) = this.agent else { return };
        this.next_server_id = DebuggerId::init(this.next_server_id.get() + 1);
        instance.set_inspector_server_id(this.next_server_id);
        let url = bun_core::handle_oom(instance.get_url_as_string());

        InspectorHTTPServerAgent::notify_server_started(
            agent.as_ptr(),
            this.next_server_id,
            instance.vm().hot_reload_counter as i32,
            &url,
            bun_core::time::milli_timestamp() as f64,
            instance.as_opaque_ptr() as usize,
        );
    }

    /// Tell the C++ inspector agent (if attached) that the server stopped,
    /// stamped with the current time.
    pub(crate) fn notify_server_stopped(this: &HTTPServerAgent, server: AnyServer) {
        let Some(agent) = this.agent else { return };
        InspectorHTTPServerAgent::notify_server_stopped(
            agent.as_ptr(),
            server.inspector_server_id(),
            bun_core::time::milli_timestamp() as f64,
        );
    }

    /// Rebuild the route list from the server's config and send it to the
    /// C++ inspector agent (if attached). Errors only on allocation failure.
    pub(crate) fn notify_server_routes_updated(
        this: &HTTPServerAgent,
        server: AnyServer,
    ) -> Result<(), bun_alloc::AllocError> {
        let Some(agent) = this.agent else {
            return Ok(());
        };
        let config = server.config();
        let mut routes: Vec<Route> = Vec::new();
        let mut max_id: u32 = 0;

        // Monomorphized over the four `UserRoute<SSL,DEBUG>` slice types.
        // Dispatch through the same macro the rest of `AnyServer` uses.
        any_server_dispatch!(server, |s| {
            let user_routes = s.user_routes.get();
            routes
                .try_reserve(user_routes.len())
                .map_err(|_| bun_alloc::AllocError)?;
            for user_route in user_routes {
                max_id = max_id.max(user_route.id);
                routes.push(Route {
                    route_id: user_route.id as i32,
                    path: BunString::from_bytes(user_route.route.path.as_bytes()),
                    r#type: RouteType::Api,
                    ..Default::default()
                });
            }
        });

        for entry in &config.static_routes {
            max_id += 1;
            routes.push(Route {
                route_id: max_id as i32,
                path: BunString::from_bytes(&entry.path),
                r#type: match &entry.route {
                    AnyRoute::Html(_) => RouteType::Html,
                    AnyRoute::Static(_) => RouteType::Static,
                    _ => RouteType::Default,
                },
                file_path: match &entry.route {
                    AnyRoute::Html(r) => BunString::from_bytes(&r.bundle.path),
                    _ => BunString::EMPTY,
                },
                ..Default::default()
            });
        }

        InspectorHTTPServerAgent::notify_server_routes_updated(
            agent.as_ptr(),
            server.inspector_server_id(),
            server.vm().hot_reload_counter as i32,
            &mut routes,
        );
        // `Vec<Route>` drops → each `Route` drops (derefs path/file_path/etc.).
        Ok(())
    }
}

// ─── SavedRequest ────────────────────────────────────────────────────────────
pub struct SavedRequest {
    /// May be `.empty` until
    /// `prepare_js_request_context` populates it; `deinit` must tolerate the
    /// empty state.
    pub(crate) js_request: jsc::StrongOptional,
    /// Weak: `js_request` keeps the Request itself alive.
    pub(crate) request: crate::webcore::request::WeakRef,
    pub(crate) request_ptr: NonNull<crate::webcore::Request>,
    pub ctx: AnyRequestContext,
    pub(crate) response: uws::AnyResponse,
}

impl SavedRequest {
    /// The saved `Request`, unless its owner already finalized it.
    pub(crate) fn request(&self) -> Option<&crate::webcore::Request> {
        self.request.peek()
    }

    /// Release the JS strong ref and
    /// drop the request-context refcount. `response` is non-owning.
    pub(crate) fn deinit(&mut self) {
        self.js_request.deinit();
        self.ctx.deref();
    }
}

pub(crate) enum SavedRequestUnion<'a> {
    /// Direct pointer to a µWebSockets request that is still on the stack.
    Stack(&'a mut uws::Request),
    /// Heap-allocated copy that persists beyond the initial handler frame.
    Saved(SavedRequest),
}

// ─── ServerAllConnectionsClosedTask ──────────────────────────────────────────
pub struct ServerAllConnectionsClosedTask {
    pub(crate) global_object: *const jsc::JSGlobalObject,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) tracker: jsc::AsyncTaskTracker,
}

impl ServerAllConnectionsClosedTask {
    pub(crate) fn schedule(this: Self, vm: &mut jsc::VirtualMachine) {
        vm.enqueue_task(bun_event_loop::Task::new(
            bun_event_loop::task_tag::ServerAllConnectionsClosedTask,
            bun_core::heap::into_raw(Box::new(this)).cast(),
        ));
    }

    /// A `server.stop()` whose all-closed notification will not run: drop the
    /// promise handle with the box.
    pub(crate) fn release_unrun(self) {}

    /// Resolve the `server.stop()` promise
    /// once uws reports all sockets closed.
    pub(crate) fn run_from_js_thread(mut self) -> JsResult<()> {
        httplog!("ServerAllConnectionsClosedTask runFromJSThread");

        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST handle — safe
        // `*const → &` via `opaque_deref` (set from the live per-VM global in
        // `schedule()`; the task is only dispatched on that VM's JS thread).
        let global_object: &jsc::JSGlobalObject = bun_opaque::opaque_deref(self.global_object);
        let _dispatch = self.tracker.dispatch(global_object);

        // `JSPromiseStrong`'s Drop runs when `self` falls out of scope.
        self.promise.resolve(global_object, JSValue::UNDEFINED)?;
        Ok(())
    }
}
