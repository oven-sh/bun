//! Port of src/runtime/server/server.zig
//!
//! cycle-5: un-gated `NewServer` struct + lifecycle skeleton (start/stop/listen),
//! `AnyServer` dispatch, `AnyRoute`, and the per-file submodules. JS callback
//! bodies (`on_request`, `on_upgrade`, `from_js`, …) and methods that need
//! `bun_uws` write/close surface stay ``-gated inside each file.
//! The full Phase-A draft of every gated body is preserved in `server_body.rs`.

use core::ffi::{c_char, c_int, c_void};
use core::sync::atomic::Ordering;
use std::rc::Rc;

use bun_aio::KeepAlive;
use bun_uws as uws;
use bun_uws_sys as uws_sys;
use bun_uws_sys::app::c as uws_app_c;

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
    pub use bun_jsc::virtual_machine::{ExceptionList, VirtualMachine};
    pub use bun_jsc::debugger::{AsyncTaskTracker, DebuggerId};
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

#[path = "InspectorBunFrontendDevServerAgent.rs"]
pub mod inspector_bun_frontend_dev_server_agent;

// Full Phase-A draft (4.3kL) — kept gated; bodies are pulled into the
// `_gated` blocks below as they are made to compile.

#[path = "server_body.rs"]
mod server_body;
pub use server_body::{GetOrStartLoadResult, ServePluginsCallback};

// ─── write_status ────────────────────────────────────────────────────────────
pub fn write_status<const SSL: bool>(resp: *mut uws_sys::NewAppResponse<SSL>, status: u16) {
    // SAFETY: resp is a live uws response handle for the duration of the
    // request callback (callers hold it from `AnyResponse::{SSL,TCP}`).
    let resp = unsafe { &mut *resp };
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

/// `bun_uws::SocketContext::BunSocketContextOptions` and
/// `bun_uws_sys::BunSocketContextOptions` are field-identical `#[repr(C)]`
/// duplicates (the former is a higher-level re-declaration). `SSLConfig::
/// as_usockets()` produces the `bun_uws` flavour while the `bun_uws_sys`
/// constructors consume the `_sys` flavour — bridge by bit-copy until the
/// upstream crates unify on a single definition.
#[inline]
fn to_sys_socket_options(
    opts: uws::SocketContext::BunSocketContextOptions,
) -> uws_sys::BunSocketContextOptions {
    // SAFETY: both are `#[repr(C)]`, `Copy`, and have an identical field
    // layout (see uws/lib.rs:1452 vs uws_sys/SocketContext.rs:22).
    unsafe { core::mem::transmute(opts) }
}

// ─── AnyRoute ────────────────────────────────────────────────────────────────
// PORT NOTE (§Pointers Rc/Arc default): Zig variants are `bun.ptr.RefCount`
// payloads. Default to `Rc<T>`; `html_bundle::Route` keeps `RefPtr` because it
// is recovered via raw `*mut` from uws callback userdata (FFI rule).
pub enum AnyRoute {
    /// Serve a static file — `"/robots.txt": new Response(...)`
    Static(Rc<StaticRoute>),
    /// Serve a file from disk
    File(Rc<FileRoute>),
    /// Bundle an HTML import — `"/": html`
    // TODO(port): *Route crosses FFI (uws userdata) → §Pointers says RefPtr.
    // `impl RefCounted for Route` is gated with the route-handler bodies; raw
    // ptr until that lands so the AnyRoute enum stays compilable.
    Html(*const html_bundle::Route),
    /// File-system routing.
    // TODO(b2-blocked): payload is `bake::FrameworkRouter::TypeIndex` (u8
    // newtype). bake::framework_router is stub-only; inline the index type
    // here and reconcile when bake un-gates.
    FrameworkRouter(u8),
}

impl AnyRoute {
    pub fn memory_cost(&self) -> usize {
        match self {
            AnyRoute::Static(r) => r.memory_cost(),
            AnyRoute::File(r) => r.memory_cost(),
            // SAFETY: Html ptr is a live RefCount-managed allocation while
            // held in a route table.
            AnyRoute::Html(r) => unsafe { (**r).memory_cost() },
            AnyRoute::FrameworkRouter(_) => core::mem::size_of::<crate::bake::FileSystemRouterType>(),
        }
    }

    pub fn ref_(&self) {
        match self {
            // Rc variants: callers that need an owned handle should `.clone()`
            // the Rc — this entry point exists for API parity with the Zig
            // `inline switch` and is a no-op for them (clone/drop is the ref/deref).
            AnyRoute::Static(_) | AnyRoute::File(_) => {}
            AnyRoute::Html(_p) => {
                // TODO(port): bump intrusive refcount once
                // `impl bun_ptr::RefCounted for html_bundle::Route` lands —
                // `unsafe { bun_ptr::IntrusiveRc::<html_bundle::Route>::ref_raw(*_p) }`.
                // Without this the HTMLBundle route may be freed while still
                // registered with uws (use-after-free) or leak.
            }
            AnyRoute::FrameworkRouter(_) => {}
        }
    }
    pub fn deref_(&self) {
        match self {
            AnyRoute::Static(_) | AnyRoute::File(_) => {}
            AnyRoute::Html(_p) => {
                // TODO(port): `unsafe { bun_ptr::IntrusiveRc::<html_bundle::Route>::deref_raw(*_p) }`
                // once `impl RefCounted for html_bundle::Route` lands. See ref_().
            }
            AnyRoute::FrameworkRouter(_) => {}
        }
    }

    pub fn set_server(&self, server: Option<AnyServer>) {
        match self {
            AnyRoute::Static(r) => r.server.set(server),
            AnyRoute::File(_r) => {
                // TODO(port): `_r.server.set(server)` — FileRoute.server Cell
                // exists but is private; expose a `pub fn set_server` (or make
                // the field `pub(super)`) in FileRoute.rs so the route learns
                // its owning server before `on_pending_request()` fires.
            }
            AnyRoute::Html(_p) => {
                // TODO(port): `unsafe { (**_p).server.set(server) }` —
                // html_bundle::Route.server Cell exists but is private; expose
                // a setter so the route can call back into the server.
                let _ = server;
            }
            AnyRoute::FrameworkRouter(_) => {} // Zig: no-op (server.zig:51-58).
        }
    }

    // from_js / from_options / html_route_from_js stay gated (JS callback bodies).
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
pub struct ServePlugins {
    pub plugins: Box<[Box<[u8]>]>,
    pub state: ServePluginsState,
    // TODO(port): `RefCount` field dropped — owned via `Rc<ServePlugins>` per
    // §Pointers Rc/Arc default. Revisit if FFI needs intrusive ref/deref.
}

pub enum ServePluginsState {
    Unqueued,
    // TODO(b2-blocked): `Pending(Vec<ServePluginsCallback>)` once JSBundler is real.
    Pending,
    Loaded(jsc::JSBundler),
    Err(jsc::Strong),
}

pub enum PluginsResult<'a> {
    Pending,
    Found(Option<&'a jsc::JSBundler>),
    Err(jsc::JSValue),
}

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
/// `fn NewServer(protocol_enum, development_kind) type` — Zig type-generator.
/// `SSL = (protocol == .https)`, `DEBUG = (development_kind == .debug)`, `HAS_H3 = SSL`.
pub struct NewServer<const SSL: bool, const DEBUG: bool> {
    pub app: Option<*mut uws_sys::NewApp<SSL>>,
    pub listener: Option<*mut uws_sys::app::ListenSocket<SSL>>,
    // TODO(port): conditional field — Zig `if (has_h3) ?*H3.App else void`.
    // Kept as Option; never set when !SSL.
    pub h3_app: Option<*mut uws_sys::h3::App>,
    pub h3_listener: Option<*mut uws_sys::h3::ListenSocket>,
    /// Cached `h3=":<port>"; ma=86400` for Alt-Svc on H1 responses; formatted
    /// once in onH3Listen so renderMetadata doesn't reformat per-request.
    pub h3_alt_svc: Box<[u8]>,
    pub js_value: jsc::JsRef,
    /// Potentially null before listen() is called, and once .destroy() is called.
    // TODO(port): LIFETIMES.tsv = STATIC → `&'static VirtualMachine`. Shim type
    // is opaque; raw ptr until bun_jsc::VirtualMachine is real.
    pub vm: *const jsc::VirtualMachine,
    pub global_this: *const jsc::JSGlobalObject,
    pub base_url_string_for_joining: Box<[u8]>,
    pub config: ServerConfig,
    pub pending_requests: usize,
    pub request_pool_allocator: *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, false>,
    // TODO(port): conditional field
    pub h3_request_pool_allocator: *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, true>,
    pub all_closed_promise: jsc::JSPromiseStrong,

    pub listen_callback: jsc::AnyTask::AnyTask,
    // allocator field dropped — global mimalloc per §Allocators
    pub poll_ref: KeepAlive,

    pub flags: ServerFlags,

    pub plugins: Option<Rc<ServePlugins>>,

    pub dev_server: Option<Box<crate::bake::DevServer::DevServer>>,

    /// Route → index in RouteList.cpp. User routes may be applied multiple
    /// times due to SNI, so we have to store them.
    pub user_routes: Vec<UserRoute<SSL, DEBUG>>,

    pub on_clienterror: jsc::StrongOptional,

    pub inspector_server_id: jsc::DebuggerId,
}

pub struct UserRoute<const SSL: bool, const DEBUG: bool> {
    pub id: u32,
    pub server: *const NewServer<SSL, DEBUG>,
    pub route: server_config::RouteDeclaration,
}

// PORT NOTE: Zig `UserRoute.deinit()` only freed `self.route`; RouteDeclaration
// drops automatically, so an explicit `impl Drop` would double-free.

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    pub const SSL_ENABLED: bool = SSL;
    pub const DEBUG_MODE: bool = DEBUG;
    pub const HAS_H3: bool = SSL;

    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
            + self.base_url_string_for_joining.len()
            + self.config.memory_cost()
            + self.dev_server.as_ref().map_or(0, |d| d.memory_cost())
    }

    pub fn h3_alt_svc(&self) -> Option<&[u8]> {
        if !Self::HAS_H3 || self.h3_alt_svc.is_empty() {
            return None;
        }
        Some(&self.h3_alt_svc)
    }

    pub fn on_pending_request(&mut self) {
        self.pending_requests += 1;
    }

    /// Dispatch the user `fetch` handler for an incoming request.
    // TODO(b2-blocked): full body in `server_body.rs::NewServer::on_request`
    // (server.zig:2720-2830) — depends on Request::new_/WebCore::Body and the
    // JS RouteList codegen extern. Until that wiring lands, fall through to a
    // 404 so the listen socket stays usable for smoke tests (matches the
    // `trampoline::on_request` behaviour).
    pub fn on_request(
        &mut self,
        _req: &mut uws_sys::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    pub fn on_static_request_complete(&mut self) {
        self.pending_requests -= 1;
        self.deinit_if_we_can();
    }

    pub fn on_request_complete(&mut self) {
        // TODO(b2-blocked): self.vm.event_loop().process_gc_timer();
        self.pending_requests -= 1;
        self.deinit_if_we_can();
    }

    pub fn active_sockets_count(&self) -> u32 {
        self.config
            .websocket
            .as_ref()
            .map_or(0, |ws| ws.handler.active_connections as u32)
    }

    pub fn has_active_web_sockets(&self) -> bool {
        self.active_sockets_count() > 0
    }

    pub fn has_listener(&self) -> bool {
        self.listener.is_some() || (Self::HAS_H3 && self.h3_listener.is_some())
    }

    pub fn set_idle_timeout(&mut self, seconds: core::ffi::c_uint) {
        self.config.idle_timeout = seconds.min(255) as u8;
    }

    pub fn set_flags(&mut self, require_host_header: bool, use_strict_method_validation: bool) {
        if let Some(app) = self.app {
            // SAFETY: app is a live uws handle while self is alive.
            unsafe { (*app).set_flags(require_host_header, use_strict_method_validation) };
        }
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        if let Some(app) = self.app {
            // SAFETY: app is a live uws handle while self is alive.
            unsafe { (*app).set_max_http_header_size(max_header_size) };
        }
    }

    pub fn ref_(&mut self) {
        if self.poll_ref.is_active() {
            return;
        }
        // TODO(b2-blocked): self.poll_ref.ref_(self.vm);
    }

    pub fn unref(&mut self) {
        // TODO(b2-blocked): self.poll_ref.unref(self.vm);
    }

    pub fn stop_listening(&mut self, abrupt: bool) {
        // httplog!("stopListening", .{});

        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener.take() {
                // Graceful: GOAWAY + drain via the still-open UDP socket; the
                // engine rejects new conns and the timer keeps in-flight streams
                // progressing until deinit. Abrupt: close the fd now.
                if !abrupt {
                    if let Some(_h3a) = self.h3_app {
                        // TODO(b2-blocked): bun_uws_sys::h3::App::close.
                    }
                } else {
                    // SAFETY: h3l is a live FFI handle until take() nulls it.
                    unsafe { (*h3l).close() };
                }
            }
        }

        let Some(listener) = self.listener.take() else {
            if Self::HAS_H3 && self.h3_app.is_some() {
                self.unref();
                // TODO(b2-blocked): self.notify_inspector_server_stopped().
                if abrupt {
                    self.flags.insert(ServerFlags::TERMINATED);
                }
            }
            return;
        };
        self.unref();

        // TODO(b2-blocked): if !SSL { self.vm.remove_listening_socket_for_watch_mode(listener.socket().fd()) }
        // TODO(b2-blocked): self.notify_inspector_server_stopped().

        if let server_config::Address::Unix(path) = &self.config.address {
            let bytes = path.to_bytes();
            if !bytes.is_empty() && bytes[0] != 0 {
                // SAFETY: CString guarantees NUL termination at `bytes.len()`.
                let z = unsafe { bun_str::ZStr::from_raw(bytes.as_ptr(), bytes.len()) };
                let _ = bun_sys::unlink(z);
            }
        }

        if !abrupt {
            // SAFETY: listener is a live FFI handle until take() nulled it above.
            unsafe { (*listener).close() };
        } else if !self.flags.contains(ServerFlags::TERMINATED) {
            if let Some(ws) = self.config.websocket.as_mut() {
                ws.handler.app = None;
            }
            self.flags.insert(ServerFlags::TERMINATED);
            // SAFETY: app is a live uws handle (set whenever listener was set).
            unsafe { (*self.app.unwrap()).close() };
        }
    }

    pub fn stop(&mut self, abrupt: bool) {
        // TODO(b2-blocked): js_value.set_weak() / unprotect — needs bun_jsc::JsRef methods.
        self.stop_listening(abrupt);
        self.deinit_if_we_can();
    }

    pub fn deinit_if_we_can(&mut self) {
        // httplog!("deinitIfWeCan {p} {p} {} {} {}", ...);

        // TODO(b2-blocked): first `if` block (server.zig:1600-1621) —
        // `ServerAllConnectionsClosedTask::schedule(..)` once
        // `bun_jsc::JSPromiseStrong::{has, value, create}` are real. Gates on
        // `!HAS_HANDLED_ALL_CLOSED_PROMISE && all_closed_promise.strong.has()`.

        if self.pending_requests == 0
            && !self.has_listener()
            && !self.has_active_web_sockets()
        {
            if let Some(ws) = self.config.websocket.as_mut() {
                ws.handler.app = None;
            }
            self.unref();

            // Detach DevServer. This is needed because there are aggressive
            // tests that check for DevServer memory soundness. Keeping the JS
            // binding alive should not pin `dev.memory_cost()` bytes.
            if let Some(dev) = self.dev_server.take() {
                if let Some(_app) = self.app {
                    // TODO(b2-blocked): bun_uws_sys::App::clear_routes.
                }
                drop(dev); // dev.deinit()
            }

            // Only free the memory if the JS reference has been freed too.
            // TODO(b2-blocked): bun_jsc::JsRef — gate on `self.js_value == .finalized`
            // once JsRef is the real enum (currently an opaque newtype).
            // self.schedule_deinit();
        }
    }

    pub fn schedule_deinit(&mut self) {
        if self.flags.contains(ServerFlags::DEINIT_SCHEDULED) {
            return;
        }
        self.flags.insert(ServerFlags::DEINIT_SCHEDULED);
        // TODO(b2-blocked): vm.enqueue_task_concurrent(AnyTask::new(self, deinit)).
    }

    pub fn on_listen(&mut self, socket: Option<*mut uws_sys::app::ListenSocket<SSL>>) {
        if socket.is_none() {
            return self.on_listen_failed();
        }
        self.listener = socket;
        // TODO(b2-blocked): vm.event_loop_handle = Async::Loop::get();
        // TODO(b2-blocked): if !SSL { vm.add_listening_socket_for_watch_mode(socket.fd()) }
    }

    /// Full body in `server_body.rs::on_listen_failed()` — drains BoringSSL
    /// error stack, formats the bind/listen failure, and `globalThis.throwValue`s
    /// it. Until that detailed formatting is ported, throw the spec's fallback
    /// message (server.zig:1933) so `listen()`'s `has_exception()` gate fires
    /// and the server is `deinit()`ed instead of silently coming up listenerless.
    #[cold]
    pub fn on_listen_failed(&mut self) {
        self.listener = None;
        // SAFETY: global_this is STATIC per LIFETIMES.tsv; non-null once init() ran.
        let global = unsafe { &*self.global_this };
        // TODO(b2-blocked): full error_instance (EADDRINUSE/EACCES/OpenSSL string)
        // per server.zig:1847-1952 — see server_body.rs::on_listen_failed.
        let _ = global.throw(format_args!("Failed to start server. Is port in use?"));
    }

    pub fn on_h3_listen(&mut self, socket: Option<*mut uws_sys::h3::ListenSocket>) {
        if !Self::HAS_H3 {
            return;
        }
        let Some(socket) = socket else { return };
        // SAFETY: socket is a live FFI handle for the duration of the listen callback.
        let port = unsafe { (*socket).get_local_port() };
        self.h3_listener = Some(socket);
        self.h3_alt_svc = format!("h3=\":{port}\"; ma=86400").into_bytes().into_boxed_slice();
        // TODO(b2-blocked): bun_analytics::Features::http3_server += 1;
    }

    // ─── deinit ──────────────────────────────────────────────────────────────
    /// Tear down the uws app handles and free the boxed server. Only called
    /// from `schedule_deinit`'s task or synchronously on listen-failure.
    pub fn deinit(this: *mut Self) {
        httplog!("deinit");
        // SAFETY: `this` was Box::into_raw'd in `init()` and is uniquely owned here.
        let this_ref = unsafe { &mut *this };

        // TODO(b2-blocked): notify_inspector_server_stopped() once Debugger
        // server-agent surface is real.

        if Self::HAS_H3 {
            if let Some(h3a) = this_ref.h3_app.take() {
                // SAFETY: live H3::App handle owned by this server.
                unsafe { uws_sys::h3::App::destroy(h3a) };
            }
        }
        if let Some(app) = this_ref.app.take() {
            // SAFETY: live uws App handle owned by this server.
            unsafe { uws_sys::NewApp::<SSL>::destroy(app) };
        }

        // SAFETY: paired with Box::into_raw in `init()`.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn set_using_custom_expect_handler(&mut self, value: bool) {
        if let Some(app) = self.app {
            // SAFETY: app is a live uws handle while self is alive.
            unsafe { ffi::NodeHTTP_setUsingCustomExpectHandler(SSL, app as *mut c_void, value) };
        }
    }

    // ─── init ────────────────────────────────────────────────────────────────
    /// Allocate and populate a `NewServer` from `config`. The config is moved
    /// into the server (left as `Default` in the caller's slot). Route
    /// registration and the listen socket happen later in `listen()`.
    pub fn init(config: &mut ServerConfig, global: &JSGlobalObject) -> JsResult<*mut Self>
    where
        Self: ServerPools<SSL, DEBUG>,
    {
        let base_url: Box<[u8]> =
            bun_str::strings::trim(config.base_url.href, b"/").to_vec().into_boxed_slice();
        // errdefer free(base_url) — Box drops on Err automatically

        // TODO(b2-blocked): bake::DevServer::init(DevServerInit { … }). The
        // bake crate's lifecycle is still gated; once it un-gates, populate
        // from `config.bake` here (server.zig:2086-2098).
        let dev_server: Option<Box<crate::bake::DevServer::DevServer>> = None;

        let server = Box::into_raw(Box::new(Self {
            global_this: global as *const _,
            config: core::mem::take(config),
            base_url_string_for_joining: base_url,
            vm: jsc::VirtualMachine::get() as *const _,
            dev_server,
            app: None,
            listener: None,
            h3_app: None,
            h3_listener: None,
            h3_alt_svc: Box::<[u8]>::default(),
            js_value: jsc::JsRef::empty(),
            pending_requests: 0,
            request_pool_allocator: <Self as ServerPools<SSL, DEBUG>>::request_pool(),
            h3_request_pool_allocator: <Self as ServerPools<SSL, DEBUG>>::h3_request_pool(),
            all_closed_promise: jsc::JSPromiseStrong::default(),
            listen_callback: jsc::AnyTask::AnyTask {
                ctx: None,
                callback: |_| Ok(()),
            },
            poll_ref: KeepAlive::default(),
            flags: ServerFlags::default(),
            plugins: None,
            user_routes: Vec::new(),
            on_clienterror: jsc::StrongOptional::empty(),
            inspector_server_id: jsc::DebuggerId::new(0),
        }));

        if SSL {
            bun_analytics::features::https_server.fetch_add(1, Ordering::Relaxed);
        } else {
            bun_analytics::features::http_server.fetch_add(1, Ordering::Relaxed);
        }

        Ok(server)
    }

    // ─── set_routes ──────────────────────────────────────────────────────────
    /// Register HTTP routes on `self.app` (and `h3_app` when present). Returns
    /// the JS `RouteList` value for codegen-backed user routes, or `.zero` when
    /// there are none.
    ///
    /// cycle-7: user-route registration, negative routes, websocket fallback,
    /// and the consolidated `/*` fallback are real. Static-route / DevServer /
    /// plugins / chrome-devtools paths stay narrowly gated where they touch
    /// not-yet-real surface (see inline `` blocks below); the
    /// bodies are preserved in `server_body.rs::set_routes`.
    fn set_routes(&mut self) -> JSValue {
        let mut route_list_value = JSValue::ZERO;
        // SAFETY: set_routes is only called after `self.app = Some(..)` in listen().
        let app = unsafe { &mut *self.app.unwrap() };
        let self_ptr: *mut Self = self;

        // --- 1. user_routes_to_build → user_routes + RouteList JS object ---
        if !self.config.user_routes_to_build.is_empty() {
            let mut to_build = core::mem::take(&mut self.config.user_routes_to_build);
            let _old = core::mem::replace(
                &mut self.user_routes,
                Vec::with_capacity(to_build.len()),
            );
            // TODO(b2-blocked): Bun__ServerRouteList__create(global, callbacks, paths, len)
            // once the .classes.ts codegen extern is wired. Until then user routes
            // still register on uws below; only the JS-side RouteList stays .zero.
            for (i, builder) in to_build.iter_mut().enumerate() {
                self.user_routes.push(UserRoute {
                    id: i as u32,
                    server: self_ptr,
                    route: core::mem::take(&mut builder.route),
                });
            }
            let _ = route_list_value; // stays ZERO until codegen extern lands
        }

        // --- 2. WebSocket handler app reference ---
        if let Some(websocket) = self.config.websocket.as_mut() {
            websocket.handler.app = Some(app as *mut _ as *mut c_void);
            websocket
                .handler
                .flags
                .set(web_socket_server_context::HandlerFlags::SSL, SSL);
            // TODO(b2-blocked): websocket.global_object = self.global_this once
            // WebSocketServerContext exposes the field mutably.
        }

        // --- 3. Compiled user routes + "/*" coverage tracking ---
        let mut star_covered_by_user_any = false;
        for user_route in self.user_routes.iter_mut() {
            let ud: *mut c_void = (user_route as *mut UserRoute<SSL, DEBUG>).cast();
            let path = user_route.route.path.as_bytes();
            let is_star = path == b"/*";
            match user_route.route.method {
                server_config::RouteMethod::Any => {
                    app.any(path, Some(trampoline::on_user_route_request::<SSL, DEBUG>), ud);
                    if is_star {
                        star_covered_by_user_any = true;
                    }
                }
                server_config::RouteMethod::Specific(m) => {
                    app.method(m, path, Some(trampoline::on_user_route_request::<SSL, DEBUG>), ud);
                }
            }
            // TODO(b2-blocked): mirror to h3_app + per-route ws() registration
            // (server_body.rs:3291-3335) once H3/ws trampolines are real.
        }

        // --- 4. Negative routes ---
        for route_path in self.config.negative_routes.iter() {
            let p = route_path.as_bytes();
            app.head(p, Some(trampoline::on_request::<SSL, DEBUG>), self_ptr as *mut c_void);
            app.any(p, Some(trampoline::on_request::<SSL, DEBUG>), self_ptr as *mut c_void);
        }

        // --- 5-8. Static routes / DevServer / plugins / chrome-devtools ---
        // TODO(b2-blocked): apply_static_route + DevServer.set_routes +
        // ServePlugins::init wiring (server_body.rs:3476-3641). Gated on
        // StaticRouteLike impls for StaticRoute/FileRoute/HTMLBundle (the
        // `apply_static_route` helper takes `&mut bun_uws::NewApp<SSL>` whereas
        // this stub holds `*mut bun_uws_sys::NewApp<SSL>`) and DevServer route
        // surface; the per-route uws registration shape is identical to the
        // user-route loop above and slots in here once those land.
        let _ = &self.config.static_routes;
        let _ = &self.dev_server;
        let _ = &self.plugins;

        // --- 9. Consolidated "/*" HTTP fallback ---
        if !star_covered_by_user_any {
            let ud = self_ptr as *mut c_void;
            if self.config.on_node_http_request.is_some() {
                app.any(b"/*", Some(trampoline::on_node_http_request::<SSL, DEBUG>), ud);
            } else if self.config.on_request.is_some() {
                app.any(b"/*", Some(trampoline::on_request::<SSL, DEBUG>), ud);
            } else {
                app.any(b"/*", Some(trampoline::on_404::<SSL, DEBUG>), ud);
            }
        }
        // TODO(b2-blocked): per-method "/*" complement fill when a
        // method-specific user route exists for "/*" (server_body.rs:3460-3486,
        // server.zig:2962-2976) — needs `bun_http::Method::Set`. The spec
        // tracks a `Method.Set` of "/*" coverage and registers per-method
        // complement handlers; this stub tracks only `star_covered_by_user_any`
        // and falls back to `app.any("/*", …)`. Dispatch is currently
        // equivalent because uWS routes the method-specific tree before `*`
        // (HttpRouter.h:255-277), BUT un-gating §5 (static routes) without
        // fixing this WILL clobber any static `.any` "/*" route via
        // `HttpRouter.h:283 remove(methods[0], pattern, priority)`.

        if self.config.on_node_http_request.is_some() {
            // SAFETY: app is a live uws handle.
            unsafe { ffi::NodeHTTP_assignOnNodeJSCompat(SSL, app as *mut _ as *mut c_void) };
        }

        route_list_value
    }

    // ─── listen ──────────────────────────────────────────────────────────────
    /// Create the uws `App<SSL>` (and optional H3 app), register routes via
    /// `set_routes()`, and bind the listen socket. On any failure the server
    /// is `deinit()`ed synchronously and `.zero` is returned with an exception
    /// pending on `global_this`.
    // TODO(port): make this return JsResult<JSValue> and let the caller errdefer-deinit.
    pub fn listen(this: *mut Self) -> JSValue {
        httplog!("listen");
        // PORT NOTE: reshaped for borrowck (PORTING.md §Forbidden — aliased
        // `&mut`). No long-lived `&mut Self` is held across re-derives from
        // `this`; each use site reborrows fresh and the borrow ends before the
        // next derive. The serverName / SNI loop extracts raw `(ptr, len)` so
        // no `&self.config` outlives the per-domain `set_routes()` call.
        //
        // SAFETY (applies to every `&*this` / `&mut *this` below): `this` was
        // produced by `init()` and is live for this call; only one reference
        // derived from it is alive at a time.

        // `global_this` is a `*const` raw-pointer field — read it once via a
        // short-lived `&*this`; the resulting `&JSGlobalObject` borrows a
        // separate STATIC allocation, not `*this`.
        let global = unsafe { &*(*this).global_this };

        let app: *mut uws_sys::NewApp<SSL>;
        let mut route_list_value = JSValue::ZERO;

        if SSL {
            bun_boringssl::load();
            let Some(ssl_options) =
                unsafe { &*this }.config.ssl_config.as_ref().map(|c| c.as_usockets())
            else {
                // unreachable in practice — fromJS guarantees ssl_config when SSL.
                let _ = global.throw(format_args!("Failed to create HTTPS server: missing tls config"));
                Self::deinit(this);
                return JSValue::ZERO;
            };

            app = match uws_sys::NewApp::<SSL>::create(to_sys_socket_options(ssl_options)) {
                Some(a) => a,
                None => {
                    if !global.has_exception() && !throw_ssl_error_if_necessary(global) {
                        let _ = global.throw(format_args!("Failed to create HTTP server"));
                    }
                    unsafe { (*this).app = None };
                    Self::deinit(this);
                    return JSValue::ZERO;
                }
            };
            unsafe { (*this).app = Some(app) };

            if Self::HAS_H3 && unsafe { &*this }.config.h3 {
                let idle_timeout = unsafe { &*this }.config.idle_timeout as u32;
                let h3 = match uws_sys::h3::App::create(to_sys_socket_options(ssl_options), idle_timeout) {
                    Some(a) => Some(a),
                    None => {
                        if !global.has_exception() {
                            let _ = global.throw(format_args!("Failed to create HTTP/3 server"));
                        }
                        Self::deinit(this);
                        return JSValue::ZERO;
                    }
                };
                unsafe { (*this).h3_app = h3 };
            }

            route_list_value = unsafe { &mut *this }.set_routes();

            // add serverName to the SSL context using the default ssl options
            // PORT NOTE: extract raw (ptr, len) so no `&self.config` borrow
            // outlives the `set_routes()` call below. set_routes() does not
            // touch `config.ssl_config`, so the bytes remain valid.
            let server_name_raw = unsafe { &*this }
                .config
                .ssl_config
                .as_ref()
                .and_then(|c| c.server_name.as_deref())
                .filter(|n| !n.to_bytes().is_empty())
                .map(|n| (n.as_ptr(), n.to_bytes().len()));
            if let Some((name_ptr, name_len)) = server_name_raw {
                // SAFETY: name_ptr/name_len were just extracted from the live
                // `config.ssl_config.server_name` CString; valid + NUL-terminated.
                let server_name = unsafe { core::ffi::CStr::from_ptr(name_ptr) };
                // SAFETY: app is the live handle just stored in self.app.
                if unsafe { (*app).add_server_name_with_options(server_name, to_sys_socket_options(ssl_options)) }.is_err() {
                    if !global.has_exception() && !throw_ssl_error_if_necessary(global) {
                        let _ = global.throw(format_args!(
                            "Failed to add serverName: {}",
                            bstr::BStr::new(server_name.to_bytes())
                        ));
                    }
                    Self::deinit(this);
                    return JSValue::ZERO;
                }
                if throw_ssl_error_if_necessary(global) {
                    Self::deinit(this);
                    return JSValue::ZERO;
                }

                // SAFETY: server_name is a CStr; ZStr::from_raw upholds the NUL invariant.
                let z = unsafe { bun_core::ZStr::from_raw(name_ptr.cast(), name_len) };
                // SAFETY: app is a live uws handle.
                unsafe { (*app).domain(z) };
                if throw_ssl_error_if_necessary(global) {
                    Self::deinit(this);
                    return JSValue::ZERO;
                }

                // Ensure routes are set for that domain name.
                let _ = unsafe { &mut *this }.set_routes();
            }

            // SNI: per-hostname contexts
            // PORT NOTE: iterate by index and reborrow `&*this` per iteration so
            // the `set_routes()` `&mut` at the bottom of the loop body never
            // overlaps an outstanding `&self.config.sni` borrow.
            let sni_len = unsafe { &*this }
                .config
                .sni
                .as_ref()
                .map_or(0, |s| s.slice().len());
            for i in 0..sni_len {
                let (name_ptr, name_len, sni_opts) = {
                    let cfg = unsafe { &*this };
                    let sni_ssl_config = &cfg.config.sni.as_ref().unwrap().slice()[i];
                    let Some(sni_name) = sni_ssl_config.server_name.as_deref() else { continue };
                    if sni_name.to_bytes().is_empty() {
                        continue;
                    }
                    (
                        sni_name.as_ptr(),
                        sni_name.to_bytes().len(),
                        to_sys_socket_options(sni_ssl_config.as_usockets()),
                    )
                };
                // SAFETY: name_ptr/name_len point into config.sni[i].server_name;
                // set_routes() does not mutate config.sni so the bytes are valid.
                let sni_name = unsafe { core::ffi::CStr::from_ptr(name_ptr) };
                // TODO(b2-blocked): h3_app.add_server_name_with_options(..) once
                // bun_uws_sys::h3 exposes a &CStr overload (currently &ZStr only).
                // SAFETY: app is a live uws handle.
                if unsafe { (*app).add_server_name_with_options(sni_name, sni_opts) }.is_err() {
                    if !global.has_exception() && !throw_ssl_error_if_necessary(global) {
                        let _ = global.throw(format_args!(
                            "Failed to add serverName: {}",
                            bstr::BStr::new(sni_name.to_bytes())
                        ));
                    }
                    Self::deinit(this);
                    return JSValue::ZERO;
                }
                // SAFETY: sni_name is a CStr; NUL invariant holds.
                let z = unsafe { bun_core::ZStr::from_raw(name_ptr.cast(), name_len) };
                // SAFETY: app is a live uws handle.
                unsafe { (*app).domain(z) };
                if throw_ssl_error_if_necessary(global) {
                    Self::deinit(this);
                    return JSValue::ZERO;
                }
                let _ = unsafe { &mut *this }.set_routes();
            }
        } else {
            app = match uws_sys::NewApp::<SSL>::create(uws_sys::BunSocketContextOptions::default()) {
                Some(a) => a,
                None => {
                    if !global.has_exception() {
                        let _ = global.throw(format_args!("Failed to create HTTP server"));
                    }
                    Self::deinit(this);
                    return JSValue::ZERO;
                }
            };
            unsafe { (*this).app = Some(app) };
            route_list_value = unsafe { &mut *this }.set_routes();
        }

        if unsafe { &*this }.config.on_node_http_request.is_some() {
            unsafe { &mut *this }.set_using_custom_expect_handler(true);
        }

        // PORT NOTE: scope a single `&mut *this` for the address match. The
        // listen_* trampolines re-derive `&mut *this` synchronously inside the
        // C callback, so `self_` (and anything borrowed from it) must not be
        // used after `listen_with_config` / `listen_on_unix_socket` returns —
        // every read happens before the call, and the binding is dropped at the
        // end of this block before the post-listen `has_exception()` check.
        {
        let self_ = unsafe { &mut *this };
        match &self_.config.address {
            server_config::Address::Tcp { port, hostname } => {
                let mut host: *const c_char = core::ptr::null();
                let mut host_buff = [0u8; 1025];

                if let Some(existing) = hostname.as_deref() {
                    let bytes = existing.to_bytes();
                    if bytes.len() > 2 && bytes[0] == b'[' {
                        // strip "[" and "]" from IPv6 literal
                        let inner = &bytes[1..bytes.len() - 1];
                        host_buff[..inner.len()].copy_from_slice(inner);
                        host_buff[inner.len()] = 0;
                        host = host_buff.as_ptr() as *const c_char;
                    } else {
                        host = existing.as_ptr();
                    }
                }

                if self_.config.h1 {
                    // SAFETY: app is a live uws handle owned by this server.
                    unsafe {
                        (*app).listen_with_config(
                            Some(trampoline::on_listen::<SSL, DEBUG>),
                            this as *mut c_void,
                            uws_app_c::uws_app_listen_config_t {
                                port: *port as c_int,
                                host,
                                options: self_.config.get_usockets_options(),
                            },
                        );
                    }
                }

                if Self::HAS_H3 {
                    if let Some(h3_app) = self_.h3_app {
                        // Same UDP port as the TCP listener so Alt-Svc works.
                        // PORT NOTE: `listener` was set synchronously by
                        // `on_listen` inside the h1 `listen_with_config` above;
                        // see the scope-level PORT NOTE re: `self_` re-derive.
                        let h3_port: u16 = match self_.listener {
                            // SAFETY: ls is a live uws ListenSocket FFI handle
                            // (just set by on_listen).
                            Some(ls) => (unsafe { (*ls).get_local_port() }) as u16,
                            None => *port,
                        };
                        let options = self_.config.get_usockets_options();
                        // SAFETY: h3_app is a live H3::App handle owned by this server.
                        unsafe { &mut *h3_app }.listen_with_config(
                            this,
                            |s: &mut Self, ls: Option<&mut uws_sys::h3::ListenSocket>| {
                                s.on_h3_listen(ls.map(|l| l as *mut _));
                            },
                            uws_sys::h3::ListenConfig { port: h3_port, host, options },
                        );
                        if self_.h3_listener.is_none() && !global.has_exception() {
                            let _ = global.throw(format_args!(
                                "Failed to listen on UDP port {h3_port} for HTTP/3"
                            ));
                            // post-match `has_exception()` check below handles
                            // deinit + return ZERO.
                        }
                        // TODO(b2-blocked): if !self_.config.h1 { vm.event_loop_handle = AsyncLoop::get() }
                        // — bun_jsc::VirtualMachine.event_loop_handle setter not yet exposed.
                    }
                }
            }
            server_config::Address::Unix(unix) => {
                if Self::HAS_H3 {
                    if let Some(h3a) = self_.h3_app.take() {
                        // QUIC over AF_UNIX is non-standard and Alt-Svc can't
                        // advertise it; drop the H3 listener instead of wiring
                        // an exotic transport nobody can reach.
                        bun_core::Output::warn(format_args!(
                            "h3: true with a unix socket — HTTP/3 listener skipped"
                        ));
                        // SAFETY: h3a is a live H3::App handle just taken from self_.h3_app.
                        unsafe { uws_sys::h3::App::destroy(h3a) };
                    }
                }
                // SAFETY: unix is a CString; NUL invariant holds for ZStr::from_raw.
                let z = unsafe {
                    bun_core::ZStr::from_raw(unix.as_ptr().cast(), unix.as_bytes().len())
                };
                // SAFETY: app is a live uws handle owned by this server.
                unsafe {
                    (*app).listen_on_unix_socket(
                        trampoline::on_listen_unix::<SSL, DEBUG>,
                        this as *mut c_void,
                        z,
                        self_.config.get_usockets_options(),
                    );
                }
            }
        }
        } // drop `self_` — invalidated by the listen-trampoline re-derive.

        if global.has_exception() {
            Self::deinit(this);
            return JSValue::ZERO;
        }

        unsafe { &mut *this }.ref_();

        // Starting up an HTTP server is a good time to GC.
        // SAFETY: vm is STATIC per LIFETIMES.tsv; the `&*this` borrow ends at `;`.
        let vm = unsafe { &*(*this).vm };
        if vm.aggressive_garbage_collection == jsc::virtual_machine::GCLevel::Aggressive {
            vm.auto_garbage_collect();
        } else {
            // SAFETY: event_loop() returns the VM's owned `*mut EventLoop`;
            // non-null while the VM is alive.
            unsafe { (*vm.event_loop()).perform_gc() };
        }

        route_list_value
    }
}

// ─── extern "C" trampolines ──────────────────────────────────────────────────
// Zig generated these per (UserData, handler) pair at comptime via
// `RouteHandler(..)`. Rust monomorphizes on the const-generic server params
// instead; the bodies downcast `user_data` and forward into the typed method.
mod trampoline {
    use super::*;
    use bun_uws_sys::{uws_res, ListenSocket as UwsListenSocket, Request as UwsRequest};

    pub extern "C" fn on_listen<const SSL: bool, const DEBUG: bool>(
        socket: *mut UwsListenSocket,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut NewServer<..>` passed to listen_with_config.
        let server = unsafe { &mut *(user_data as *mut NewServer<SSL, DEBUG>) };
        let socket = if socket.is_null() {
            None
        } else {
            Some(socket.cast::<uws_sys::app::ListenSocket<SSL>>())
        };
        server.on_listen(socket);
    }

    pub extern "C" fn on_listen_unix<const SSL: bool, const DEBUG: bool>(
        socket: *mut UwsListenSocket,
        _domain: *const c_char,
        _flags: i32,
        user_data: *mut c_void,
    ) {
        on_listen::<SSL, DEBUG>(socket, user_data);
    }

    pub extern "C" fn on_404<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        _req: *mut UwsRequest,
        _user_data: *mut c_void,
    ) {
        // SAFETY: res is a live uws response for the duration of the callback.
        let resp = unsafe { &mut *(res as *mut uws_sys::NewAppResponse<SSL>) };
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    pub extern "C" fn on_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut NewServer<..>` registered in set_routes.
        let _server = unsafe { &mut *(user_data as *mut NewServer<SSL, DEBUG>) };
        let _req = req;
        // TODO(b2-blocked): NewServer::on_request body (server_body.rs:2720-2830)
        // depends on Request::new_/WebCore::Body wiring inside bun_runtime that
        // is still gated. Until then route to 404 so the listen socket is usable
        // for smoke tests.
        on_404::<SSL, DEBUG>(res, req, user_data);
    }

    pub extern "C" fn on_user_route_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut UserRoute<..>` registered in set_routes.
        let route = unsafe { &*(user_data as *const UserRoute<SSL, DEBUG>) };
        // TODO(b2-blocked): NewServer::on_user_route_request body
        // (server_body.rs:3009-3040) — same blocker as on_request.
        on_request::<SSL, DEBUG>(res, req, route.server as *mut c_void);
    }

    pub extern "C" fn on_node_http_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // TODO(b2-blocked): NewServer::on_node_http_request body
        // (server_body.rs:2583-2720) — needs NodeHTTPResponse + Socket FFI.
        on_request::<SSL, DEBUG>(res, req, user_data);
    }
}

// ─── per-monomorphization request pools ──────────────────────────────────────
// Zig: `pub threadlocal var pool: ?*RequestContextStackAllocator = null` per
// `NewRequestContext(..)` instantiation. Rust generics cannot own statics, so
// declare one `OnceLock` per concrete (SSL, DEBUG, H3) combo at the call site
// and hand the leaked pointer back through a trait. PERF(port): was threadlocal
// — `Bun.serve` is single-threaded so a process-static is equivalent today;
// revisit if servers ever span worker threads.
pub trait ServerPools<const SSL: bool, const DEBUG: bool>: Sized {
    fn request_pool() -> *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, false>;
    fn h3_request_pool() -> *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, true>;
}

macro_rules! impl_server_pools {
    ($(($ssl:literal, $debug:literal)),* $(,)?) => {$(
        impl ServerPools<$ssl, $debug> for NewServer<$ssl, $debug> {
            fn request_pool() -> *mut request_context::RequestContextStackAllocator<Self, $ssl, $debug, false> {
                static POOL: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
                *POOL.get_or_init(|| {
                    Box::into_raw(Box::new(
                        request_context::RequestContextStackAllocator::<NewServer<$ssl, $debug>, $ssl, $debug, false>::init(),
                    )) as usize
                }) as *mut _
            }
            fn h3_request_pool() -> *mut request_context::RequestContextStackAllocator<Self, $ssl, $debug, true> {
                static POOL: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
                *POOL.get_or_init(|| {
                    Box::into_raw(Box::new(
                        request_context::RequestContextStackAllocator::<NewServer<$ssl, $debug>, $ssl, $debug, true>::init(),
                    )) as usize
                }) as *mut _
            }
        }
    )*};
}
impl_server_pools!((false, false), (true, false), (false, true), (true, true));

// ─── FFI ─────────────────────────────────────────────────────────────────────
mod ffi {
    use super::*;
    unsafe extern "C" {
        pub fn NodeHTTP_setUsingCustomExpectHandler(ssl: bool, app: *mut c_void, value: bool);
        pub fn NodeHTTP_assignOnNodeJSCompat(ssl: bool, app: *mut c_void);
    }
}

/// Drain the BoringSSL error queue; if non-empty, throw the top error on
/// `global` and return true. Mirrors `throwSSLErrorIfNecessary` in server.zig.
fn throw_ssl_error_if_necessary(global: &JSGlobalObject) -> bool {
    // SAFETY: FFI into BoringSSL; ERR_get_error reads the thread-local queue.
    let err_code = unsafe { bun_boringssl_sys::ERR_get_error() };
    if err_code != 0 {
        // SAFETY: ERR_clear_error has no preconditions.
        let _guard = scopeguard::guard((), |_| unsafe { bun_boringssl_sys::ERR_clear_error() });
        let _ = global.throw_value(crate::crypto::create_crypto_error(global, err_code));
        return true;
    }
    false
}

// `RequestContext` reaches back into its server via this; mirrors the
// field/method surface the per-request state machine needs without naming
// `NewServer` (avoids a generic-parameter cycle).
pub trait ServerLike {
    const SSL_ENABLED: bool;
    const DEBUG_MODE: bool;
    fn global_this(&self) -> &jsc::JSGlobalObject;
    fn vm(&self) -> &jsc::VirtualMachine;
    fn config(&self) -> &ServerConfig;
    fn on_request_complete(&mut self);
    fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer>;
    fn js_value(&self) -> &jsc::JsRef;
    fn h3_alt_svc(&self) -> Option<&[u8]>;
    fn terminated(&self) -> bool;
    /// Return `ctx` to the per-server HiveArray pool for the matching transport.
    /// Erased to `*mut c_void` so the trait stays object-safe and doesn't need
    /// to name `RequestContext<Self, ..>` (which would re-introduce the
    /// generic-parameter cycle this trait exists to break).
    fn release_request_context(&self, ctx: *mut c_void, is_h3: bool);
}

impl<const SSL: bool, const DEBUG: bool> ServerLike for NewServer<SSL, DEBUG> {
    const SSL_ENABLED: bool = SSL;
    const DEBUG_MODE: bool = DEBUG;
    // SAFETY: vm/global_this are STATIC refs (LIFETIMES.tsv); non-null for the
    // server's entire lifetime once `init()` runs.
    fn global_this(&self) -> &jsc::JSGlobalObject { unsafe { &*self.global_this } }
    fn vm(&self) -> &jsc::VirtualMachine { unsafe { &*self.vm } }
    fn config(&self) -> &ServerConfig { &self.config }
    fn on_request_complete(&mut self) { Self::on_request_complete(self) }
    fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> { self.dev_server.as_deref() }
    fn js_value(&self) -> &jsc::JsRef { &self.js_value }
    fn h3_alt_svc(&self) -> Option<&[u8]> { Self::h3_alt_svc(self) }
    fn terminated(&self) -> bool { self.flags.contains(ServerFlags::TERMINATED) }
    fn release_request_context(&self, ctx: *mut c_void, is_h3: bool) {
        // SAFETY: ctx was allocated from this exact pool by `prepare_js_request_context`;
        // it is `RequestContext<Self, SSL, DEBUG, is_h3>` by construction.
        unsafe {
            if is_h3 {
                (*self.h3_request_pool_allocator)
                    .put(&mut *(ctx as *mut request_context::RequestContext<Self, SSL, DEBUG, true>));
            } else {
                (*self.request_pool_allocator)
                    .put(&mut *(ctx as *mut request_context::RequestContext<Self, SSL, DEBUG, false>));
            }
        }
    }
}

// ─── Type aliases ────────────────────────────────────────────────────────────
pub type HTTPServer = NewServer<false, false>;
pub type HTTPSServer = NewServer<true, false>;
pub type DebugHTTPServer = NewServer<false, true>;
pub type DebugHTTPSServer = NewServer<true, true>;

// ─── AnyServer ───────────────────────────────────────────────────────────────
// PORT NOTE (§Dispatch): Zig used `bun.ptr.TaggedPointerUnion(...)`. The
// `bun_ptr::impl_tagged_ptr_union!` macro would impl a foreign trait for a
// foreign tuple type (orphan rule), so it can only be invoked from inside
// `bun_ptr`. Per §Dispatch ("store `(tag: u8, ptr: *mut ())` as two fields"),
// hand-roll the tag here. AnyServer is cold-path (per-request, not per-tick).
// PERF(port): was TaggedPointerUnion pack — 8→16 bytes; ~handful of instances.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AnyServerTag {
    HTTPServer = 0,
    HTTPSServer = 1,
    DebugHTTPServer = 2,
    DebugHTTPSServer = 3,
}

#[derive(Clone, Copy)]
pub struct AnyServer {
    pub tag: AnyServerTag,
    pub ptr: *mut (),
}

/// Dispatch over the four `NewServer` monomorphizations (shared `&` borrow).
/// Mirrors Zig's `inline switch (ptr.tag()) { inline else => |s| s.method() }`.
/// Read-only accessors MUST use this form so holding the returned reference
/// while calling another dispatch method does not materialize an aliasing
/// `&mut NewServer` (Stacked-Borrows UB).
macro_rules! any_server_dispatch {
    ($self:expr, |$s:ident| $body:expr) => {{
        let this = $self;
        // SAFETY: ptr was produced by `AnyServer::from` for the matching tag
        // and is non-null while the server is alive.
        match this.tag {
            AnyServerTag::HTTPServer => { let $s = unsafe { &*this.ptr.cast::<HTTPServer>() }; $body }
            AnyServerTag::HTTPSServer => { let $s = unsafe { &*this.ptr.cast::<HTTPSServer>() }; $body }
            AnyServerTag::DebugHTTPServer => { let $s = unsafe { &*this.ptr.cast::<DebugHTTPServer>() }; $body }
            AnyServerTag::DebugHTTPSServer => { let $s = unsafe { &*this.ptr.cast::<DebugHTTPSServer>() }; $body }
        }
    }};
}

/// Dispatch over the four `NewServer` monomorphizations (exclusive `&mut`
/// borrow). Only for callers that mutate server state — never use this for
/// read-only accessors (see `any_server_dispatch!`).
macro_rules! any_server_dispatch_mut {
    ($self:expr, |$s:ident| $body:expr) => {{
        let this = $self;
        // SAFETY: ptr was produced by `AnyServer::from` for the matching tag
        // and is non-null while the server is alive. Caller upholds that no
        // other reference into the same `NewServer` is live for this scope.
        match this.tag {
            AnyServerTag::HTTPServer => { let $s = unsafe { &mut *this.ptr.cast::<HTTPServer>() }; $body }
            AnyServerTag::HTTPSServer => { let $s = unsafe { &mut *this.ptr.cast::<HTTPSServer>() }; $body }
            AnyServerTag::DebugHTTPServer => { let $s = unsafe { &mut *this.ptr.cast::<DebugHTTPServer>() }; $body }
            AnyServerTag::DebugHTTPSServer => { let $s = unsafe { &mut *this.ptr.cast::<DebugHTTPSServer>() }; $body }
        }
    }};
}

impl AnyServer {
    pub fn from<const SSL: bool, const DEBUG: bool>(server: *const NewServer<SSL, DEBUG>) -> AnyServer {
        let tag = match (SSL, DEBUG) {
            (false, false) => AnyServerTag::HTTPServer,
            (true, false) => AnyServerTag::HTTPSServer,
            (false, true) => AnyServerTag::DebugHTTPServer,
            (true, true) => AnyServerTag::DebugHTTPSServer,
        };
        AnyServer { tag, ptr: server as *mut () }
    }

    pub fn vm(&self) -> *const jsc::VirtualMachine {
        any_server_dispatch!(self, |s| s.vm)
    }

    pub fn global_this(&self) -> *const jsc::JSGlobalObject {
        any_server_dispatch!(self, |s| s.global_this)
    }

    pub fn config(&self) -> &ServerConfig {
        any_server_dispatch!(self, |s| &s.config)
    }

    pub fn h3_alt_svc(&self) -> Option<&[u8]> {
        match self.tag {
            // SAFETY: tag matches; ptr is a live server while AnyServer is held.
            AnyServerTag::HTTPSServer => unsafe { &*self.ptr.cast::<HTTPSServer>() }.h3_alt_svc(),
            AnyServerTag::DebugHTTPSServer => unsafe { &*self.ptr.cast::<DebugHTTPSServer>() }.h3_alt_svc(),
            _ => None,
        }
    }

    pub fn inspector_server_id(&self) -> jsc::DebuggerId {
        any_server_dispatch!(self, |s| s.inspector_server_id)
    }

    pub fn set_inspector_server_id(&mut self, id: jsc::DebuggerId) {
        any_server_dispatch_mut!(self, |s| {
            s.inspector_server_id = id;
            // TODO(b2-blocked): dev_server.inspector_server_id = id once DevServer is real.
        })
    }

    pub fn plugins(&self) -> Option<&ServePlugins> {
        any_server_dispatch!(self, |s| s.plugins.as_deref())
    }

    pub fn on_pending_request(&mut self) {
        any_server_dispatch_mut!(self, |s| s.on_pending_request())
    }

    /// Dispatch the user `fetch` handler. Mirrors Zig `AnyServer.onRequest`
    /// (see `server.zig`): un-erase the SSL bool from the tag and downcast
    /// `AnyResponse` to the matching `NewAppResponse<SSL>` variant.
    pub fn on_request(&self, req: &mut uws_sys::Request, resp: uws::AnyResponse) {
        // SAFETY: ptr was produced by `AnyServer::from` for the matching tag
        // and is non-null while the server is alive; `assert_{no_,}ssl` upholds
        // the tag↔SSL invariant.
        match self.tag {
            AnyServerTag::HTTPServer => unsafe {
                (*self.ptr.cast::<HTTPServer>()).on_request(req, &mut *resp.assert_no_ssl())
            },
            AnyServerTag::HTTPSServer => unsafe {
                (*self.ptr.cast::<HTTPSServer>()).on_request(req, &mut *resp.assert_ssl())
            },
            AnyServerTag::DebugHTTPServer => unsafe {
                (*self.ptr.cast::<DebugHTTPServer>()).on_request(req, &mut *resp.assert_no_ssl())
            },
            AnyServerTag::DebugHTTPSServer => unsafe {
                (*self.ptr.cast::<DebugHTTPSServer>()).on_request(req, &mut *resp.assert_ssl())
            },
        }
    }

    pub fn on_request_complete(&mut self) {
        any_server_dispatch_mut!(self, |s| s.on_request_complete())
    }

    pub fn on_static_request_complete(&mut self) {
        any_server_dispatch_mut!(self, |s| s.on_static_request_complete())
    }

    pub fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> {
        any_server_dispatch!(self, |s| s.dev_server.as_deref())
    }

    pub fn stop(&mut self, abrupt: bool) {
        any_server_dispatch_mut!(self, |s| s.stop(abrupt))
    }

    pub fn num_subscribers(&self, topic: &[u8]) -> u32 {
        any_server_dispatch!(self, |s| match s.app {
            // SAFETY: app handle is live while AnyServer is held.
            Some(app) => unsafe { (*app).num_subscribers(topic) },
            None => 0,
        })
    }

    pub fn publish(
        &self,
        topic: &[u8],
        message: &[u8],
        opcode: uws::Opcode,
        compress: bool,
    ) -> bool {
        // PORT NOTE: callers (bake::DevServer) hold `bun_uws::Opcode`; the
        // underlying uws_sys app wants `bun_uws_sys::Opcode`. Both are
        // `#[repr(transparent)]` i32 newtypes with identical discriminants —
        // re-wrap by value rather than depending on a cross-crate `From` impl.
        let opcode = uws_sys::Opcode(opcode.0);
        any_server_dispatch!(self, |s| match s.app {
            // SAFETY: app handle is live while AnyServer is held.
            Some(app) => unsafe { (*app).publish(topic, message, opcode, compress) },
            None => false,
        })
    }

    pub fn web_socket_handler(&mut self) -> Option<&mut WebSocketServerHandler> {
        any_server_dispatch_mut!(self, |s| s.config.websocket.as_mut().map(|ws| &mut ws.handler))
    }
}

// ─── SavedRequest ────────────────────────────────────────────────────────────
pub struct SavedRequest {
    pub js_request: jsc::Strong,
    pub request: *mut crate::webcore::Request,
    pub ctx: AnyRequestContext,
    pub response: uws::AnyResponse,
}

impl SavedRequest {
    /// `SavedRequest.deinit` — full body in gated `server_body.rs` draft.
    pub fn deinit(&mut self) {
        todo!("blocked_on: server::SavedRequest::deinit body un-gate")
    }
}

// ─── ServerAllConnectionsClosedTask ──────────────────────────────────────────
pub struct ServerAllConnectionsClosedTask {
    pub global_object: *const jsc::JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub tracker: jsc::AsyncTaskTracker,
}

impl ServerAllConnectionsClosedTask {
    /// Spec server.zig `runFromJSThread` — resolve the `server.stop()` promise
    /// once uws reports all sockets closed, then `bun.destroy(self)`.
    pub fn run_from_js_thread(
        _this: *mut Self,
        _vm: &mut jsc::VirtualMachine,
    ) -> Result<(), jsc::JsTerminated> {
        todo!("blocked_on: ServerAllConnectionsClosedTask::run_from_js_thread body")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/server.zig (5193 lines)
//   confidence: low (cycle-7: init/listen/set_routes un-gated)
//   notes:      NewServer/AnyServer/AnyRoute structs real; stop/stop_listening/
//               on_listen bodies real (uws calls only). init() now constructs
//               the boxed server (per-monomorphization pool statics via
//               `impl_server_pools!`); listen() creates the uws::App<SSL>,
//               registers routes, and binds the listen socket; set_routes()
//               wires user/negative routes + the "/*" fallback through extern
//               "C" trampolines. Static-route/DevServer/H3-listen paths and
//               the on_request JS dispatch body remain narrowly gated where
//               they touch not-yet-real surface — full drafts preserved in
//               server_body.rs. Blocked on: bun_uws_sys::h3 listen trampoline,
//               bake::DevServer::init, .classes.ts RouteList codegen extern.
// ──────────────────────────────────────────────────────────────────────────
