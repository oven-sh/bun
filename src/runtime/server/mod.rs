//! Port of src/runtime/server/server.zig
//!
//! cycle-5: un-gated `NewServer` struct + lifecycle skeleton (start/stop/listen),
//! `AnyServer` dispatch, `AnyRoute`, and the per-file submodules. JS callback
//! bodies (`on_request`, `on_upgrade`, `from_js`, …) and methods that need
//! `bun_uws` write/close surface stay `#[cfg(any())]`-gated inside each file.
//! The full Phase-A draft of every gated body is preserved in `server_body.rs`.

use core::ffi::c_void;
use std::rc::Rc;

use bun_aio::KeepAlive;
use bun_uws as uws;
use bun_uws_sys as uws_sys;

// ─── server-local jsc shim ───────────────────────────────────────────────────
// Extends `crate::jsc` (lib.rs shim) with the additional opaque types server
// drafts reference. `bun_jsc` is not yet a dep of `bun_runtime` (Cargo.toml has
// it commented out under TODO(b2-blocked)); once it is, replace this whole
// module with `pub use bun_jsc as jsc;` at the crate root and delete the
// per-file `use crate::server::jsc;` aliases.
// TODO(b2-blocked): bun_jsc::* — delete when `bun_jsc` is a dep.
pub mod jsc {
    pub use crate::jsc::*;
    pub use crate::webcore::jsc::{
        strong, CommonAbortReason, EventLoopHandle, JsRef, SystemError, Task, VirtualMachine,
    };
    macro_rules! opaque {
        ($($(#[$m:meta])* $name:ident),* $(,)?) => {
            $($(#[$m])* #[repr(transparent)] #[derive(Debug, Clone, Copy, Default)]
              pub struct $name(pub usize);)*
        };
    }
    // Types referenced by server drafts that the lib.rs/webcore shims don't provide.
    opaque!(
        ZigString, ZigException, JSPropertyIterator, ArrayBuffer, JSPromiseStrong,
        AnyTask, AsyncTaskTracker, JSBundler, BinaryType,
    );
    pub use crate::jsc::debugger::DebuggerId;
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
#[cfg(any())]
#[path = "server_body.rs"]
mod server_body;

// ─── write_status ────────────────────────────────────────────────────────────
pub fn write_status<const SSL: bool>(resp: &mut uws_sys::NewAppResponse<SSL>, status: u16) {
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
            AnyRoute::FrameworkRouter(_) => 0,
        }
    }

    pub fn ref_(&self) {
        // PERF(port): was inline switch — Rc::clone is the ref(); callers that
        // need an owned handle should `.clone()` instead. Kept for API parity.
        // TODO(port): audit call sites once Rc shape is final.
    }
    pub fn deref_(&self) {
        // Rc drop is the deref(); see ref_().
    }

    pub fn set_server(&self, _server: Option<AnyServer>) {
        // TODO(b2-blocked): StaticRoute/FileRoute/html_bundle::Route need
        // interior-mutable `server` cells before this can write through `&Rc`.
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
    Err(jsc::Strong<jsc::JSValue>),
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

    pub listen_callback: jsc::AnyTask,
    // allocator field dropped — global mimalloc per §Allocators
    pub poll_ref: KeepAlive,

    pub flags: ServerFlags,

    pub plugins: Option<Rc<ServePlugins>>,

    pub dev_server: Option<Box<crate::bake::DevServer::DevServer>>,

    /// Route → index in RouteList.cpp. User routes may be applied multiple
    /// times due to SNI, so we have to store them.
    pub user_routes: Vec<UserRoute<SSL, DEBUG>>,

    pub on_clienterror: jsc::Strong<jsc::JSValue>,

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
            + self.user_routes.len() * core::mem::size_of::<UserRoute<SSL, DEBUG>>()
    }

    pub fn h3_alt_svc(&self) -> Option<&[u8]> {
        if !Self::HAS_H3 || self.h3_listener.is_none() || self.h3_alt_svc.is_empty() {
            return None;
        }
        Some(&self.h3_alt_svc)
    }

    pub fn on_pending_request(&mut self) {
        self.pending_requests += 1;
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
        let Some(app) = self.app else { return 0 };
        // SAFETY: app is a live uws handle for the lifetime of any reachable Server.
        // TODO(b2-blocked): bun_uws_sys::App::num_connections — cycle-5-B fills this.
        let _ = app;
        0
    }

    pub fn has_active_web_sockets(&self) -> bool {
        self.config
            .websocket
            .as_ref()
            .is_some_and(|ws| ws.handler.active_connections > 0)
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
        if !self.has_listener() {
            return;
        }
        // TODO(b2-blocked): self.poll_ref.ref_(self.vm);
    }

    pub fn unref(&mut self) {
        // TODO(b2-blocked): self.poll_ref.unref(self.vm);
    }

    pub fn stop_listening(&mut self, abrupt: bool) {
        // httplog!("stopListening", .{});

        if let Some(listener) = self.listener.take() {
            // SAFETY: listener is a live FFI handle until take() nulls it.
            unsafe { (*listener).close() };
        }
        if Self::HAS_H3 {
            if let Some(h3_listener) = self.h3_listener.take() {
                // SAFETY: as above.
                unsafe { (*h3_listener).close() };
            }
        }

        // TODO(b2-blocked): notify_debugger(self) — needs bun_jsc::Debugger.

        if !self.flags.contains(ServerFlags::TERMINATED) {
            // TODO(b2-blocked): self.vm.event_loop().drain_tasks(); poll_ref.unref().
            self.flags.insert(ServerFlags::TERMINATED);
        }

        if let Some(app) = self.app {
            if abrupt {
                // SAFETY: app is a live uws handle.
                unsafe { (*app).close() };
            } else if !self.has_active_web_sockets() {
                // SAFETY: as above.
                unsafe { (*app).close_idle_connections() };
            }
        }
        if Self::HAS_H3 {
            if let Some(h3_app) = self.h3_app {
                // TODO(b2-blocked): bun_uws_sys::h3::App::{close, close_idle_connections}.
                let _ = (h3_app, abrupt);
            }
        }
    }

    pub fn stop(&mut self, abrupt: bool) {
        // TODO(b2-blocked): js_value.set_weak() / unprotect — needs bun_jsc::JsRef methods.
        self.stop_listening(abrupt);
        self.deinit_if_we_can();
    }

    pub fn deinit_if_we_can(&mut self) {
        // httplog!("deinitIfWeCan {p} {p} {} {} {}", ...);
        if self.pending_requests == 0
            && self.active_sockets_count() == 0
            && !self.has_listener()
            && !self.has_active_web_sockets()
            && !self.flags.contains(ServerFlags::DEINIT_SCHEDULED)
        {
            // TODO(b2-blocked): all_closed_promise.resolve() via
            // ServerAllConnectionsClosedTask; dev_server.deinit().
            self.schedule_deinit();
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
            return;
        }
        if self.config.is_development() {
            // TODO(b2-blocked): bun_analytics::Features::dev_server += 1;
        }
        self.listener = socket;
        // TODO(b2-blocked): vm.event_loop().enqueue_task(self.listen_callback).
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

    /// Full body lives in `server_body.rs::listen()` — depends on
    /// `bun_uws_sys::App::create/listen_with_config/listen_on_unix_socket`,
    /// `bun_jsc` exception throwing, and `bun_analytics`. cycle-5-B fills the
    /// uws side; un-gate once `bun_jsc` is a dep.
    #[cfg(any())]
    pub fn listen(&mut self) -> jsc::JSValue {
        compile_error!("see server_body.rs::listen")
    }

    /// Full body in `server_body.rs::init()` — config-driven app construction.
    #[cfg(any())]
    pub fn init(config: &mut ServerConfig, global: &jsc::JSGlobalObject) -> jsc::JsResult<*mut Self> {
        compile_error!("see server_body.rs::init")
    }
}

// `RequestContext` reaches back into its server via this; mirrors the
// field/method surface the per-request state machine needs without naming
// `NewServer` (avoids a generic-parameter cycle).
pub trait ServerLike {
    const SSL_ENABLED: bool;
    const DEBUG_MODE: bool;
    fn global_this(&self) -> *const jsc::JSGlobalObject;
    fn vm(&self) -> *const jsc::VirtualMachine;
    fn config(&self) -> &ServerConfig;
    fn on_request_complete(&mut self);
    fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer>;
}

impl<const SSL: bool, const DEBUG: bool> ServerLike for NewServer<SSL, DEBUG> {
    const SSL_ENABLED: bool = SSL;
    const DEBUG_MODE: bool = DEBUG;
    fn global_this(&self) -> *const jsc::JSGlobalObject { self.global_this }
    fn vm(&self) -> *const jsc::VirtualMachine { self.vm }
    fn config(&self) -> &ServerConfig { &self.config }
    fn on_request_complete(&mut self) { Self::on_request_complete(self) }
    fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> { self.dev_server.as_deref() }
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

/// Dispatch over the four `NewServer` monomorphizations.
/// Mirrors Zig's `inline switch (ptr.tag()) { inline else => |s| s.method() }`.
macro_rules! any_server_dispatch {
    ($self:expr, |$s:ident| $body:expr) => {{
        let this = $self;
        // SAFETY: ptr was produced by `AnyServer::from` for the matching tag
        // and is non-null while the server is alive.
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

    pub fn set_inspector_server_id(&self, id: jsc::DebuggerId) {
        any_server_dispatch!(self, |s| {
            s.inspector_server_id = id;
            // TODO(b2-blocked): dev_server.inspector_server_id = id once DevServer is real.
        })
    }

    pub fn plugins(&self) -> Option<&ServePlugins> {
        any_server_dispatch!(self, |s| s.plugins.as_deref())
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

    pub fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> {
        any_server_dispatch!(self, |s| s.dev_server.as_deref())
    }

    pub fn stop(&self, abrupt: bool) {
        any_server_dispatch!(self, |s| s.stop(abrupt))
    }

    pub fn num_subscribers(&self, topic: &[u8]) -> u32 {
        any_server_dispatch!(self, |s| match s.app {
            // SAFETY: app handle is live while AnyServer is held.
            Some(app) => unsafe { (*app).num_subscribers(topic) },
            None => 0,
        })
    }

    pub fn web_socket_handler(&self) -> Option<&mut WebSocketServerHandler> {
        any_server_dispatch!(self, |s| s.config.websocket.as_mut().map(|ws| &mut ws.handler))
    }
}

// ─── SavedRequest ────────────────────────────────────────────────────────────
pub struct SavedRequest {
    pub js_request: jsc::Strong<jsc::JSValue>,
    pub request: *mut crate::webcore::Request,
    pub ctx: AnyRequestContext,
    pub response: uws::AnyResponse,
}

// ─── ServerAllConnectionsClosedTask ──────────────────────────────────────────
pub struct ServerAllConnectionsClosedTask {
    pub global_object: *const jsc::JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub tracker: jsc::AsyncTaskTracker,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/server.zig (5193 lines)
//   confidence: low (cycle-5 struct + lifecycle un-gate)
//   notes:      NewServer/AnyServer/AnyRoute structs real; stop/stop_listening/
//               on_listen bodies real (uws calls only). listen()/init() and all
//               JS-facing host_fn bodies gated — preserved in server_body.rs.
//               Blocked on: bun_jsc dep (VirtualMachine/JsRef/Strong methods),
//               bun_uws_sys h3::App close/num_connections (cycle-5-B).
// ──────────────────────────────────────────────────────────────────────────
