//! Port of src/runtime/server/server.zig
//!
//! cycle-5: un-gated `NewServer` struct + lifecycle skeleton (start/stop/listen),
//! `AnyServer` dispatch, `AnyRoute`, and the per-file submodules. JS callback
//! bodies (`on_request`, `on_upgrade`, `from_js`, …) and methods that need
//! `bun_uws` write/close surface stay ``-gated inside each file.
//! The full Phase-A draft of every gated body is preserved in `server_body.rs`.

use core::ffi::{c_char, c_int, c_void};
use core::sync::atomic::Ordering;

/// Codegen `${ServerType}__create(ptr, global)` shim — one extern per
/// `(SSL, DEBUG)` monomorphization. Hand-dispatched until `.classes.ts`
/// Rust output lands.
pub(crate) fn server_js_create(
    ptr: *mut c_void,
    global: &jsc::JSGlobalObject,
    ssl: bool,
    debug: bool,
) -> jsc::JSValue {
    unsafe extern "C" {
        fn HTTPServer__create(ptr: *mut c_void, global: *const jsc::JSGlobalObject) -> jsc::JSValue;
        fn HTTPSServer__create(ptr: *mut c_void, global: *const jsc::JSGlobalObject) -> jsc::JSValue;
        fn DebugHTTPServer__create(ptr: *mut c_void, global: *const jsc::JSGlobalObject) -> jsc::JSValue;
        fn DebugHTTPSServer__create(ptr: *mut c_void, global: *const jsc::JSGlobalObject) -> jsc::JSValue;
    }
    // SAFETY: `ptr` is a fresh `NewServer<SSL,DEBUG>` heap allocation; the C++
    // wrapper takes ownership.
    unsafe {
        match (ssl, debug) {
            (false, false) => HTTPServer__create(ptr, global),
            (true, false) => HTTPSServer__create(ptr, global),
            (false, true) => DebugHTTPServer__create(ptr, global),
            (true, true) => DebugHTTPSServer__create(ptr, global),
        }
    }
}

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
    // Zig spec (server.zig:8-16) takes `?*Response` and no-ops on null. The
    // route handlers (`StaticRoute`/`FileRoute`) call here from completion
    // paths where the request may already be aborted/detached.
    if resp.is_null() {
        return;
    }
    // SAFETY: non-null checked above; resp is a live uws response handle for
    // the duration of the request callback (callers hold it from
    // `AnyResponse::{SSL,TCP}`).
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

// ─── AnyRoute ────────────────────────────────────────────────────────────────
// PORT NOTE (§Pointers): Zig variants are `bun.ptr.RefCount` payloads. All
// three concrete route types carry an intrusive `ref_count: Cell<u32>` and are
// heap-allocated via `Box::into_raw`; their pointers round-trip through uws
// callback userdata (`ctx: *mut c_void`), so `Rc<T>` is unsuitable (would add
// a second header and break the round-trip). Hold them as raw intrusive
// pointers — matches Zig `*StaticRoute` / `*FileRoute` / `*HTMLBundle.Route`.
pub enum AnyRoute {
    /// Serve a static file — `"/robots.txt": new Response(...)`
    Static(core::ptr::NonNull<StaticRoute>),
    /// Serve a file from disk
    File(core::ptr::NonNull<FileRoute>),
    /// Bundle an HTML import — `import html from "./index.html"; "/": html`
    Html(bun_ptr::RefPtr<html_bundle::Route>),
    /// Use file-system routing — `"/*": { dir: …, style: "nextjs-pages" }`
    FrameworkRouter(crate::bake::framework_router::TypeIndex),
}

impl AnyRoute {
    pub fn memory_cost(&self) -> usize {
        match self {
            // SAFETY: intrusive-refcounted ptr; live while held in the route table.
            AnyRoute::Static(p) => unsafe { p.as_ref() }.memory_cost(),
            // SAFETY: see above.
            AnyRoute::File(p) => unsafe { p.as_ref() }.memory_cost(),
            // SAFETY: RefPtr.data is a live NonNull while held in the route table.
            AnyRoute::Html(r) => unsafe { r.data.as_ref() }.memory_cost(),
            AnyRoute::FrameworkRouter(_) => core::mem::size_of::<crate::bake::FileSystemRouterType>(),
        }
    }

    pub fn ref_(&self) {
        match self {
            // SAFETY: intrusive-refcounted ptr; live while held in the route table.
            AnyRoute::Static(p) => unsafe { p.as_ref() }.ref_(),
            // SAFETY: see above.
            AnyRoute::File(p) => unsafe { p.as_ref() }.ref_(),
            AnyRoute::Html(r) => {
                // SAFETY: RefPtr.data is a live NonNull while held in the route table.
                unsafe { bun_ptr::RefCount::<html_bundle::Route>::ref_(r.data.as_ptr()) };
            }
            AnyRoute::FrameworkRouter(_) => {} // not reference counted
        }
    }
    pub fn deref_(&self) {
        match self {
            // SAFETY: intrusive refcount; ptr was Box::into_raw'd with rc=1.
            AnyRoute::Static(p) => unsafe { StaticRoute::deref_(p.as_ptr()) },
            // SAFETY: see above.
            AnyRoute::File(p) => unsafe { FileRoute::deref(p.as_ptr()) },
            AnyRoute::Html(r) => r.deref(),
            AnyRoute::FrameworkRouter(_) => {} // not reference counted
        }
    }

    pub fn set_server(&self, server: Option<AnyServer>) {
        match self {
            // SAFETY: intrusive-refcounted ptr; live while held in the route table.
            AnyRoute::Static(p) => unsafe { p.as_ref() }.server.set(server),
            // SAFETY: see above.
            AnyRoute::File(p) => unsafe { p.as_ref() }.set_server(server),
            // SAFETY: RefPtr.data is a live NonNull while held in the route table.
            AnyRoute::Html(r) => unsafe { r.data.as_ref() }.server.set(server),
            AnyRoute::FrameworkRouter(_) => {} // DevServer holds its own .server (server.zig:51-58)
        }
    }

    // from_js / from_options / html_route_from_js — bodies live in
    // `server_body.rs` (`impl AnyRoute { … }`); same crate, separate file.
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
pub struct ServePlugins {
    pub state: ServePluginsState,
    // TODO(port): `RefCount` field dropped — owned via `Rc<ServePlugins>` per
    // §Pointers Rc/Arc default. Revisit if FFI needs intrusive ref/deref.
}

pub enum ServePluginsState {
    /// Spec server.zig:316 — `.unqueued: []const []const u8`. The plugin path
    /// list is the variant payload; transitioning to `Pending`/`Loaded`
    /// consumes it (no parallel `plugins` field).
    Unqueued(Box<[Box<[u8]>]>),
    // TODO(b2-blocked): `Pending(Vec<ServePluginsCallback>)` once JSBundler is real.
    Pending,
    /// `*JSBundler.Plugin` — the C++ `BunPlugin` handle. Same payload type as
    /// `server_body::ServePluginsState::Loaded` so `GetOrStartLoadResult::Ready`
    /// (re-exported from server_body) can borrow it directly.
    Loaded(Box<crate::api::js_bundler::Plugin>),
    Err(jsc::Strong),
}

pub enum PluginsResult<'a> {
    Pending,
    Found(Option<&'a crate::api::js_bundler::Plugin>),
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

/// Const-generic adapter: `AnyResponse: From<*mut Response<SSL>>` is only
/// implemented for the two concrete `SSL` values (overlap rules forbid a
/// blanket impl alongside them), so dispatch at the call boundary.
#[inline]
fn any_response_from<const SSL: bool>(resp: *mut uws_sys::NewAppResponse<SSL>) -> uws::AnyResponse {
    // PORT NOTE: `*mut Response<SSL>` and `*mut Response<true|false>` are
    // distinct types to rustc; route through `.cast()` (the underlying handle
    // is opaque and layout-identical for both instantiations).
    if SSL {
        uws::AnyResponse::SSL(resp.cast())
    } else {
        uws::AnyResponse::TCP(resp.cast())
    }
}

/// HTTP/1 `RequestContext` for a given server monomorphization (Zig:
/// `RequestContext = NewRequestContext(ssl_enabled, debug_mode, ThisServer)`).
pub type ServerRequestContext<const SSL: bool, const DEBUG: bool> =
    request_context::RequestContext<NewServer<SSL, DEBUG>, SSL, DEBUG, false>;

/// `server.zig:CreateJsRequest`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CreateJsRequest {
    Yes,
    No,
    Bake,
}

/// `server.zig:PreparedRequest` — bundle of the JS-side `Request`, the heap
/// `webcore::Request`, and the per-request `RequestContext`. Only the HTTP/1
/// instantiation (`PreparedRequestFor(RequestContext)`) is materialized; H3
/// callers never `save()` (it `@compileError`s in Zig) and the H3 dispatch
/// path is private to `set_routes`.
pub struct PreparedRequest<const SSL: bool, const DEBUG: bool> {
    pub js_request: JSValue,
    pub request_object: *mut crate::webcore::Request,
    pub ctx: *mut ServerRequestContext<SSL, DEBUG>,
}

impl<const SSL: bool, const DEBUG: bool> PreparedRequest<SSL, DEBUG> {
    /// `server.zig:PreparedRequest.save` — used by DevServer to defer calling
    /// the JS handler until the bundle is actually ready.
    pub fn save(
        self,
        global: &jsc::JSGlobalObject,
        req: &mut uws_sys::Request,
        resp: *mut uws_sys::NewAppResponse<SSL>,
    ) -> SavedRequest {
        // By saving a request, all information from `req` must be
        // copied since the provided uws.Request will be re-used for
        // future requests (stack allocated).
        // SAFETY: `ctx`/`request_object` are the freshly-allocated
        // `RequestContext` slot and heap `Request` produced by
        // `prepare_js_request_context` for this frame; no other borrow is live.
        unsafe {
            (*self.ctx).to_async(
                req as *mut uws_sys::Request as *mut c_void,
                &mut *self.request_object,
            );
        }

        SavedRequest {
            js_request: jsc::StrongOptional::create(self.js_request, global),
            request: self.request_object,
            ctx: AnyRequestContext::init(self.ctx),
            response: any_response_from::<SSL>(resp),
        }
    }
}

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

    /// `server.zig:getURLAsString`.
    pub fn get_url_as_string(&self) -> Result<bun_str::String, bun_alloc::AllocError> {
        use bun_core::fmt::{URLFormatter, URLProto};
        use std::io::Write as _;
        let fmt = match &self.config.address {
            server_config::Address::Unix(unix) => {
                let unix = unix.to_bytes();
                if unix.len() > 1 && unix[0] == 0 {
                    // abstract domain socket, let's give it an "abstract" URL
                    URLFormatter { proto: URLProto::Abstract, hostname: Some(&unix[1..]), port: None }
                } else {
                    URLFormatter { proto: URLProto::Unix, hostname: Some(unix), port: None }
                }
            }
            server_config::Address::Tcp { port, hostname } => {
                let mut port = *port;
                if let Some(listener) = self.listener {
                    // SAFETY: listener is a live uws ListenSocket FFI handle until stop_listening() nulls it.
                    port = unsafe { (*listener).get_local_port() } as u16;
                } else if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener {
                        // SAFETY: h3 listener handle live until stop_listening() nulls it.
                        port = unsafe { (*h3l).get_local_port() } as u16;
                    }
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
        Ok(bun_str::String::clone_utf8(&buf))
    }

    /// `server.zig:jsValueAssertAlive`.
    pub fn js_value_assert_alive(&self) -> JSValue {
        debug_assert!(self.js_value.is_not_empty());
        self.js_value.try_get().expect("js_value alive")
    }

    /// Per-monomorphization static (Zig: `var did_send_idletimeout_warning_once = false;`).
    /// PORT NOTE: Rust statics cannot be const-generic; routed through a
    /// `&'static AtomicBool` so the four (SSL,DEBUG) instantiations share one
    /// flag — the warning is process-global by intent (printed at most once
    /// regardless of how many servers are running).
    fn did_send_idletimeout_warning_once() -> &'static core::sync::atomic::AtomicBool {
        static FLAG: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
        &FLAG
    }

    /// `server.zig:onTimeoutForIdleWarn` — generic over `Ctx::Resp`; the body
    /// ignores both arguments so a single non-generic shim suffices.
    fn on_timeout_for_idle_warn(_: *mut c_void, _: &mut uws_sys::NewAppResponse<SSL>) {
        if DEBUG && !Self::did_send_idletimeout_warning_once().load(Ordering::Relaxed) {
            if !crate::cli::Command::get().debug.silent {
                Self::did_send_idletimeout_warning_once().store(true, Ordering::Relaxed);
                bun_core::Output::warn(format_args!(
                    "Bun.serve() timed out a request after 10 seconds. Pass `idleTimeout` to configure."
                ));
            }
        }
    }

    /// `server.zig:shouldAddTimeoutHandlerForWarning`.
    fn should_add_timeout_handler_for_warning(&self) -> bool {
        if DEBUG {
            if !Self::did_send_idletimeout_warning_once().load(Ordering::Relaxed)
                && !crate::cli::Command::get().debug.silent
            {
                return !self.config.has_idle_timeout;
            }
        }
        false
    }

    /// `server.zig:prepareJsRequestContext` — the HTTP/1 instantiation
    /// (`Ctx == RequestContext`). The `Ctx`-generic `prepareJsRequestContextFor`
    /// is folded directly: const-generic `bool` cannot select an associated
    /// `Req`/`Resp` type in stable Rust without specialization, and the only
    /// other instantiation (H3) populates url/headers eagerly via a separate
    /// codepath. The bake/saved-request callers reached through `AnyServer`
    /// are HTTP/1-only by construction (`PreparedRequest::save` is
    /// `@compileError`'d for H3 in Zig).
    pub fn prepare_js_request_context(
        this: *mut Self,
        req: &mut uws_sys::Request,
        resp: *mut uws_sys::NewAppResponse<SSL>,
        should_deinit_context: Option<*mut bool>,
        create_js_request: CreateJsRequest,
        method: Option<bun_http_types::Method::Method>,
    ) -> Option<PreparedRequest<SSL, DEBUG>> {
        jsc::mark_binding!();
        // SAFETY: `this`/`resp` are live for the duration of the uWS callback;
        // re-borrowed disjointly below to avoid stacking `&mut` across the
        // `ctx.create()` call (which stores `this` as a backref).
        let server = unsafe { &mut *this };
        let resp_ref = unsafe { &mut *resp };

        // We need to register the handler immediately since uSockets will not buffer.
        //
        // We first validate the self-reported request body length so that
        // we avoid needing to worry as much about what memory to free.
        // (RFC 9114 §4.2 transfer-encoding check is H3-only — skipped here.)

        let request_body_length: Option<usize> = 'len: {
            if bun_http_types::Method::Method::which(req.method())
                .unwrap_or(bun_http_types::Method::Method::OPTIONS)
                .has_request_body()
            {
                let len: usize = if let Some(cl) = req.header(b"content-length") {
                    bun_str::strings::parse_int::<usize>(cl, 10).unwrap_or(0)
                } else {
                    0
                };

                // Abort the request very early.
                if len > server.config.max_request_body_size {
                    resp_ref.write_status(b"413 Request Entity Too Large");
                    resp_ref.end_without_body(true);
                    return None;
                }

                break 'len Some(len);
            }
            None
        };

        server.on_pending_request();

        // PORT NOTE: `vm.eventLoop().debug.enter()/exit()` is debug-build
        // re-entrancy bookkeeping; routed through cfg(debug_assertions).
        let vm_ptr = server.vm as *mut jsc::VirtualMachine;
        #[cfg(debug_assertions)]
        // SAFETY: vm backref is live for the server's lifetime.
        unsafe { (*(*vm_ptr).event_loop()).debug.enter() };
        let _dbg_guard = scopeguard::guard((), move |_| {
            #[cfg(debug_assertions)]
            // SAFETY: see above.
            unsafe { (*(*vm_ptr).event_loop()).debug.exit() };
            let _ = vm_ptr;
        });
        req.set_yield(false);
        resp_ref.timeout(server.config.idle_timeout);

        // Since we do timeouts by default, we should tell the user when
        // this happens - but limit it to only warn once.
        if server.should_add_timeout_handler_for_warning() {
            // We need to pass it a pointer, any pointer should do.
            resp_ref.on_timeout(
                Self::on_timeout_for_idle_warn,
                Self::did_send_idletimeout_warning_once().as_ptr() as *mut c_void,
            );
        }

        // SAFETY: `request_pool_allocator` points at a process-static (or
        // server-owned) `HiveArray::Fallback`; valid for the server's lifetime.
        let ctx_slot = bun_core::handle_oom(unsafe { (*server.request_pool_allocator).try_get() });
        // SAFETY: `try_get` hands out an uninitialized slot; `create()` fully
        // initializes it via `MaybeUninit::write`.
        let ctx_uninit = unsafe {
            &mut *(ctx_slot as *mut core::mem::MaybeUninit<ServerRequestContext<SSL, DEBUG>>)
        };
        ServerRequestContext::<SSL, DEBUG>::create(
            ctx_uninit,
            this,
            req as *mut uws_sys::Request as *mut c_void,
            any_response_from::<SSL>(resp),
            should_deinit_context,
            method,
        );
        // SAFETY: fully initialized by `create()`.
        let ctx: *mut ServerRequestContext<SSL, DEBUG> = ctx_slot;
        let ctx_mut = unsafe { &mut *ctx };

        // SAFETY: `jsc_vm` set in VM init; valid for the JS thread's lifetime.
        unsafe { (*(*vm_ptr).jsc_vm).deprecated_report_extra_memory(core::mem::size_of::<ServerRequestContext<SSL, DEBUG>>()) };

        // Allocate the pooled body slot. `init_request_body_value` returns a
        // type-erased `*mut Body::Value::HiveRef` (the hook lives in `bun_jsc`
        // which cannot name `bun_runtime` types); cast back here.
        let mut body_init = crate::webcore::body::Value::Null;
        // SAFETY: vm backref live; hook contract documented on `init_request_body_value`.
        let body_hive: *mut crate::webcore::body::HiveRef = unsafe {
            (*vm_ptr).init_request_body_value(&mut body_init as *mut _ as *mut c_void)
        }
        .cast();
        // SAFETY: `init_request_body_value` returns a freshly-initialized
        // hive slot (`ref_count = 1`); never null on success.
        let body_value: *mut crate::webcore::body::Value =
            unsafe { core::ptr::addr_of_mut!((*body_hive).value) };
        ctx_mut.request_body = core::ptr::NonNull::new(body_value);

        // SAFETY: `global_this` set in `init()`; outlives the server.
        let global = unsafe { &*server.global_this };
        let signal = jsc::AbortSignal::new(global);
        // SAFETY: `AbortSignal::new` returns a +1-ref'd non-null pointer.
        ctx_mut.signal = core::ptr::NonNull::new(signal);
        unsafe { (*signal).pending_activity_ref() };

        // SAFETY: `signal.ref_()` bumps the intrusive count and returns +1.
        let signal_ref = unsafe { jsc::AbortSignalRef::adopt((*signal).ref_()) };
        // PORT NOTE: in Zig the +1 from `body.ref()` is *moved into*
        // `Request.init(..., body.ref())` so the JS Request and the
        // RequestContext share one hive slot. `webcore::Request.body` is
        // currently `Box<BodyValue>` (see Request.rs:95) and cannot adopt the
        // hive ref yet, so we deliberately do NOT bump `(*body_hive).ref_()`
        // here — doing so without an owner would leak the slot on every
        // request. The hive slot's initial ref_count=1 is held by
        // `ctx.request_body` and released in `RequestContext::deinit`.
        let _ = body_hive;
        // TODO(port): `Request.body` is currently `Box<BodyValue>` (see
        // Request.rs:95) — Zig stores `*Body.Value.HiveRef` so the request
        // and the RequestContext share one body slot. Until that field is
        // re-typed, the JS `Request.body` and `ctx.request_body` diverge
        // (body data buffered into `ctx` won't surface on `request.body`).
        // The bake path (the only caller through `AnyServer`) does not read
        // `request.body`, so this is not observable there.
        //
        // PORT NOTE (ownership): `Request::new` is `bun.TrivialNew` — the heap
        // allocation is handed to the JS GC via `to_js`/`to_js_for_bake` (C++
        // wrapper finalizer frees it), or, for `CreateJsRequest::No`, retained
        // by `ctx.request_weakref` until `RequestContext::deinit` releases it.
        let request_object: *mut crate::webcore::Request =
            Box::into_raw(crate::webcore::Request::new(crate::webcore::Request::init(
                ctx_mut.method,
                AnyRequestContext::init(ctx),
                SSL,
                Some(signal_ref),
                Box::new(crate::webcore::body::Value::Null),
            )));
        // SAFETY: freshly allocated; uniquely owned here.
        ctx_mut.request_weakref = bun_ptr::WeakPtr::init_ref(unsafe { &mut *request_object });

        // (H3 eager-url/header population is unreachable on this path.)

        if DEBUG {
            ctx_mut.flags.set_is_web_browser_navigation('brk: {
                if let Some(fetch_dest) = req.header(b"sec-fetch-dest") {
                    if fetch_dest == b"document" {
                        break 'brk true;
                    }
                }
                false
            });
        }

        if let Some(req_len) = request_body_length {
            ctx_mut.request_body_content_len = req_len;
            let is_transfer_encoding = req.header(b"transfer-encoding").is_some();
            ctx_mut.flags.set_is_transfer_encoding(is_transfer_encoding);
            if req_len > 0 || is_transfer_encoding {
                // we defer pre-allocating the body until we receive the first chunk
                // that way if the client is lying about how big the body is or the client aborts
                // we don't waste memory
                // SAFETY: `body_value` is the freshly-initialized hive payload.
                unsafe {
                    *body_value =
                        crate::webcore::body::Value::Locked(crate::webcore::body::PendingValue {
                            task: Some(ctx as *mut c_void),
                            global: global as *const _,
                            on_start_buffering: Some(
                                ServerRequestContext::<SSL, DEBUG>::on_start_buffering_callback,
                            ),
                            on_start_streaming: Some(
                                ServerRequestContext::<SSL, DEBUG>::on_start_streaming_request_body_callback,
                            ),
                            on_readable_stream_available: Some(
                                ServerRequestContext::<SSL, DEBUG>::on_request_body_readable_stream_available,
                            ),
                            ..Default::default()
                        });
                }
                ctx_mut.flags.set_is_waiting_for_request_body(true);

                resp_ref.on_data(
                    |u: *mut ServerRequestContext<SSL, DEBUG>,
                     _: &mut uws_sys::NewAppResponse<SSL>,
                     chunk: &[u8],
                     last: bool| {
                        ServerRequestContext::<SSL, DEBUG>::on_buffered_body_chunk(u, chunk, last)
                    },
                    ctx,
                );
            }
        }

        Some(PreparedRequest {
            js_request: match create_js_request {
                // SAFETY: `request_object` is the freshly-allocated heap
                // `Request`; ownership transfers to the JS wrapper.
                CreateJsRequest::Yes => unsafe { (*request_object).to_js(global) },
                CreateJsRequest::Bake => match unsafe { (*request_object).to_js_for_bake(global) } {
                    Ok(v) => v,
                    Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
                    Err(_) => return None,
                },
                CreateJsRequest::No => JSValue::ZERO,
            },
            request_object,
            ctx,
        })
    }

    /// `server.zig:onSavedRequest` — invoke the user's route handler for a
    /// request that was deferred (bake bundle-then-serve flow).
    pub fn on_saved_request<const ARG_COUNT: usize>(
        this: *mut Self,
        req: SavedRequestUnion<'_>,
        resp: *mut uws_sys::NewAppResponse<SSL>,
        callback: JSValue,
        extra_args: [JSValue; ARG_COUNT],
    ) {
        let prepared: PreparedRequest<SSL, DEBUG> = match &req {
            SavedRequestUnion::Stack(r) => {
                // PORT NOTE: reshaped for borrowck — decouple the inner
                // `&mut uws::Request` lifetime from the `req` match guard.
                let r = *r as *const uws::Request as *mut uws_sys::Request;
                match Self::prepare_js_request_context(
                    this,
                    // SAFETY: stack uws::Request still alive for this frame.
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
            SavedRequestUnion::Saved(data) => PreparedRequest {
                js_request: data
                    .js_request
                    .get()
                    .expect("Request was unexpectedly freed"),
                request_object: data.request,
                // SAFETY: `SavedRequest` was produced by `PreparedRequest::save`
                // for this exact (SSL,DEBUG) monomorphization, so the erased
                // `AnyRequestContext` payload is `ServerRequestContext<SSL,DEBUG>`.
                ctx: data
                    .ctx
                    .get::<ServerRequestContext<SSL, DEBUG>>()
                    .expect("ctx tag mismatch"),
            },
        };
        let ctx = prepared.ctx;

        debug_assert!(!callback.is_empty());
        // PERF(port): Zig built `[1+N]JSValue` on the stack via comptime concat;
        // stable Rust forbids `ARG_COUNT + 1` in const-generic array lengths.
        // The conservative GC scan reaches the heap allocation as well as the
        // stack, so a small Vec is sound.
        let mut args: Vec<JSValue> = Vec::with_capacity(ARG_COUNT + 1);
        args.push(prepared.js_request);
        args.extend_from_slice(&extra_args);

        // SAFETY: `this` is the live server backref for this request.
        let server = unsafe { &*this };
        let global = unsafe { &*server.global_this };
        let response_value = match callback.call(global, server.js_value_assert_alive(), &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        let is_stack = matches!(req, SavedRequestUnion::Stack(_));
        let request_object = prepared.request_object;
        let _detach_guard = scopeguard::guard((), move |_| {
            if is_stack {
                // uWS request will not live longer than this function
                // SAFETY: `request_object` is the heap allocation produced by
                // `Request::new` (or saved by `PreparedRequest::save`); kept
                // alive by `ctx.request_weakref` for the request's lifetime.
                unsafe { (*request_object).request_context.detach_request() };
            }
        });

        // SAFETY: `ctx` was just allocated (or saved) by this server; no other
        // borrow is live across this scope.
        let ctx_mut = unsafe { &mut *ctx };
        let original_state = ctx_mut.defer_deinit_until_callback_completes;
        let mut should_deinit_context = false;
        ctx_mut.defer_deinit_until_callback_completes = Some(&mut should_deinit_context);
        ctx_mut.on_response(server, prepared.js_request, response_value);
        // SAFETY: re-borrow after `on_response` returned (which may have run
        // arbitrary JS but cannot free `ctx` while `defer_deinit_...` is set).
        unsafe { (*ctx).defer_deinit_until_callback_completes = original_state };

        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        if should_deinit_context {
            // SAFETY: see above; `on_response` set the deferred flag instead of
            // freeing in-place.
            unsafe { (*ctx).deinit() };
            return;
        }

        // SAFETY: ctx not yet freed (should_deinit_context == false).
        if unsafe { (*ctx).should_render_missing() } {
            unsafe { (*ctx).render_missing() };
            return;
        }

        // The request is asynchronous, and all information from `req` must be copied
        // since the provided uws.Request will be re-used for future requests (stack allocated).
        match req {
            SavedRequestUnion::Stack(r) => {
                // SAFETY: `r` is the live stack `uws::Request`; `request_object`
                // is the heap `Request` kept alive by `ctx.request_weakref`.
                unsafe {
                    (*ctx).to_async(
                        r as *const uws::Request as *mut c_void,
                        &mut *request_object,
                    )
                };
            }
            SavedRequestUnion::Saved(_) => {} // info already copied
        }
    }

    /// `server.zig:handleRequest` — common tail of `on_request` /
    /// `on_user_route_request`: hand the user-handler's return value to the
    /// `RequestContext`, then either tear down synchronously or transition to
    /// the async path.
    fn handle_request(
        this: *mut Self,
        should_deinit_context: &mut bool,
        prepared: PreparedRequest<SSL, DEBUG>,
        req: &mut uws_sys::Request,
        response_value: JSValue,
    ) {
        let ctx = prepared.ctx;
        let request_object = prepared.request_object;

        // uWS request will not live longer than this function
        let _detach_guard = scopeguard::guard((), move |_| {
            // SAFETY: `request_object` is the heap allocation produced by
            // `Request::new`; kept alive by `ctx.request_weakref` until
            // `RequestContext::deinit` releases it.
            unsafe { (*request_object).request_context.detach_request() };
        });

        // SAFETY: `ctx` was allocated by `prepare_js_request_context` for this
        // frame; no other borrow is live across this scope.
        unsafe { (*ctx).on_response(&*this, prepared.js_request, response_value) };
        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        // SAFETY: re-borrow after `on_response` returned (which may have run
        // arbitrary JS but cannot free `ctx` while `defer_deinit_…` is set).
        unsafe { (*ctx).defer_deinit_until_callback_completes = None };

        if *should_deinit_context {
            // SAFETY: `on_response` set the deferred flag instead of freeing
            // in-place; we own the slot now.
            unsafe { (*ctx).deinit() };
            return;
        }

        // SAFETY: ctx not yet freed (should_deinit_context == false).
        if unsafe { (*ctx).should_render_missing() } {
            unsafe { (*ctx).render_missing() };
            return;
        }

        // The request is asynchronous, and all information from `req` must be
        // copied since the provided uws.Request will be re-used for future
        // requests (stack allocated).
        // SAFETY: `req`/`request_object` live for this frame; `ctx` not freed.
        unsafe {
            (*ctx).to_async(
                req as *mut uws_sys::Request as *mut c_void,
                &mut *request_object,
            );
        }
    }

    /// `server.zig:onRequest` — dispatch the user `fetch` handler.
    pub fn on_request(
        this: *mut Self,
        req: &mut uws_sys::Request,
        resp: *mut uws_sys::NewAppResponse<SSL>,
    ) {
        let mut should_deinit_context = false;
        let Some(prepared) = Self::prepare_js_request_context(
            this,
            req,
            resp,
            Some(&mut should_deinit_context),
            CreateJsRequest::Yes,
            None,
        ) else {
            return;
        };

        // SAFETY: `this` is the live server backref for this request.
        let server = unsafe { &*this };
        let on_request = server
            .config
            .on_request
            .as_ref()
            .map(|s| s.get())
            .unwrap_or(JSValue::ZERO);
        debug_assert!(!on_request.is_empty());

        let global = unsafe { &*server.global_this };
        let js_value = server.js_value_assert_alive();
        let response_value = match on_request.call(
            global,
            js_value,
            &[prepared.js_request, js_value],
        ) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        Self::handle_request(this, &mut should_deinit_context, prepared, req, response_value);
    }

    /// `server.zig:onUserRouteRequest` — dispatch a per-route handler
    /// (`routes: { "/path": handler }`).
    pub fn on_user_route_request(
        user_route: *const UserRoute<SSL, DEBUG>,
        req: &mut uws_sys::Request,
        resp: *mut uws_sys::NewAppResponse<SSL>,
    ) {
        // SAFETY: `user_route` is the live entry in `server.user_routes` whose
        // address was registered as the uws callback userdata.
        let user_route = unsafe { &*user_route };
        let server = user_route.server as *mut Self;
        let index = user_route.id;

        let mut should_deinit_context = false;
        let Some(mut prepared) = Self::prepare_js_request_context(
            server,
            req,
            resp,
            Some(&mut should_deinit_context),
            CreateJsRequest::No,
            match &user_route.route.method {
                server_config::RouteMethod::Any => None,
                server_config::RouteMethod::Specific(m) => Some(*m),
            },
        ) else {
            return;
        };

        // SAFETY: `server` is the live backref stored in `user_route`.
        let server_ref = unsafe { &*server };
        let global = unsafe { &*server_ref.global_this };
        let server_js = server_ref.js_value_assert_alive();
        let server_request_list = Self::js_route_list_get_cached(server_js)
            .expect("routeList cached value missing");
        let response_value = bun_jsc::host_fn::from_js_host_call(global, || {
            // SAFETY: FFI — `Bun__ServerRouteList__callRoute` is the
            // generated C++ dispatcher; all pointer args are live for this
            // frame, `js_request` is an out-param overwritten in place.
            unsafe {
                Bun__ServerRouteList__callRoute(
                    global,
                    index,
                    prepared.request_object,
                    server_js,
                    server_request_list,
                    &mut prepared.js_request,
                    req,
                )
            }
        })
        .unwrap_or_else(|err| global.take_exception(err));

        Self::handle_request(
            server,
            &mut should_deinit_context,
            prepared,
            req,
            response_value,
        );
    }

    /// `js.routeListGetCached` — read back the codegen'd `WriteBarrier` slot.
    fn js_route_list_get_cached(server_js: JSValue) -> Option<JSValue> {
        match (SSL, DEBUG) {
            (false, false) => route_list_cached::http::route_list_get_cached(server_js),
            (true, false) => route_list_cached::https::route_list_get_cached(server_js),
            (false, true) => route_list_cached::debug_http::route_list_get_cached(server_js),
            (true, true) => route_list_cached::debug_https::route_list_get_cached(server_js),
        }
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
            bun_str::strings::trim(&config.base_uri, b"/").to_vec().into_boxed_slice();
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

            app = match uws_sys::NewApp::<SSL>::create(ssl_options) {
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
                let h3 = match uws_sys::h3::App::create(ssl_options, idle_timeout) {
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
                if unsafe { (*app).add_server_name_with_options(server_name, ssl_options) }.is_err() {
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
                        sni_ssl_config.as_usockets(),
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

        // PORT NOTE: the listen_* trampolines re-derive `&mut *this` synchronously
        // inside the C callback (writing `self.listener` / `self.h3_listener`).
        // Under Stacked Borrows, holding any `&*this` / `&mut *this` across a
        // listen call would have its tag popped by that re-derive and become UB
        // on the next access. So: hoist every config read into a local via a
        // short-lived `&*this` BEFORE the call, drop the borrow, call listen,
        // then re-derive fresh for each post-listen field access.
        let mut host_buff = [0u8; 1025];
        // Extract (discriminant, raw payload) and drop the `&*this` borrow at `;`.
        // The raw pointers reference `config.address`'s CString backing storage,
        // which the trampolines never touch (they only write `listener`/
        // `h3_listener`), so the bytes remain valid through the listen calls.
        enum Addr { Tcp { port: u16, host: *const c_char }, Unix { ptr: *const u8, len: usize } }
        let (addr, h1, options) = {
            let cfg = unsafe { &(*this).config };
            let addr = match &cfg.address {
                server_config::Address::Tcp { port, hostname } => {
                    let mut host: *const c_char = core::ptr::null();
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
                    Addr::Tcp { port: *port, host }
                }
                server_config::Address::Unix(unix) => Addr::Unix {
                    ptr: unix.as_ptr().cast(),
                    len: unix.as_bytes().len(),
                },
            };
            (addr, cfg.h1, cfg.get_usockets_options())
        };

        match addr {
            Addr::Tcp { port, host } => {
                if h1 {
                    // SAFETY: app is a live uws handle owned by this server. No
                    // `&*this` is live across this call; the trampoline's
                    // `&mut *this` is the sole borrow while it runs.
                    unsafe {
                        (*app).listen_with_config(
                            Some(trampoline::on_listen::<SSL, DEBUG>),
                            this as *mut c_void,
                            uws_app_c::uws_app_listen_config_t {
                                port: port as c_int,
                                host,
                                options,
                            },
                        );
                    }
                }

                if Self::HAS_H3 {
                    // Re-derive: `listener` was just written by `on_listen`.
                    if let Some(h3_app) = unsafe { (*this).h3_app } {
                        // Same UDP port as the TCP listener so Alt-Svc works.
                        let h3_port: u16 = match unsafe { (*this).listener } {
                            // SAFETY: ls is a live uws ListenSocket FFI handle
                            // (just set by on_listen).
                            Some(ls) => (unsafe { (*ls).get_local_port() }) as u16,
                            None => port,
                        };
                        // SAFETY: h3_app is a live H3::App handle owned by this
                        // server. No `&*this` is live across this call; the h3
                        // trampoline's `&mut *this` is the sole borrow while it
                        // runs (the closure is capture-less).
                        unsafe { &mut *h3_app }.listen_with_config(
                            this,
                            |s: &mut Self, ls: Option<&mut uws_sys::h3::ListenSocket>| {
                                s.on_h3_listen(ls.map(|l| l as *mut _));
                            },
                            uws_sys::h3::ListenConfig { port: h3_port, host, options },
                        );
                        // Re-derive: `h3_listener` was just written by `on_h3_listen`.
                        if unsafe { (*this).h3_listener }.is_none() && !global.has_exception() {
                            let _ = global.throw(format_args!(
                                "Failed to listen on UDP port {h3_port} for HTTP/3"
                            ));
                            // post-match `has_exception()` check below handles
                            // deinit + return ZERO.
                        }
                        // TODO(b2-blocked): if !h1 { vm.event_loop_handle = AsyncLoop::get() }
                        // — bun_jsc::VirtualMachine.event_loop_handle setter not yet exposed.
                    }
                }
            }
            Addr::Unix { ptr, len } => {
                if Self::HAS_H3 {
                    if let Some(h3a) = unsafe { (*this).h3_app.take() } {
                        // QUIC over AF_UNIX is non-standard and Alt-Svc can't
                        // advertise it; drop the H3 listener instead of wiring
                        // an exotic transport nobody can reach.
                        bun_core::Output::warn(format_args!(
                            "h3: true with a unix socket — HTTP/3 listener skipped"
                        ));
                        // SAFETY: h3a is a live H3::App handle just taken from self.h3_app.
                        unsafe { uws_sys::h3::App::destroy(h3a) };
                    }
                }
                // SAFETY: ptr/len reference `config.address`'s CString; NUL
                // invariant holds for ZStr::from_raw.
                let z = unsafe { bun_core::ZStr::from_raw(ptr, len) };
                // SAFETY: app is a live uws handle owned by this server. No
                // `&*this` is live across this call.
                unsafe {
                    (*app).listen_on_unix_socket(
                        trampoline::on_listen_unix::<SSL, DEBUG>,
                        this as *mut c_void,
                        z,
                        options,
                    );
                }
            }
        }

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

// ─── route-list codegen externs ──────────────────────────────────────────────
unsafe extern "C" {
    /// Generated C++ dispatcher (RouteList.cpp): wraps the JS Request object,
    /// resolves URL params for `:id`-style segments, and invokes the route
    /// callback at `index`.
    fn Bun__ServerRouteList__callRoute(
        global_object: *const jsc::JSGlobalObject,
        index: u32,
        request_ptr: *mut crate::webcore::Request,
        server_object: jsc::JSValue,
        route_list_object: jsc::JSValue,
        request_object: *mut jsc::JSValue,
        req: *mut uws_sys::Request,
    ) -> jsc::JSValue;
}

/// Per-type cached-accessor shims for the `routeList` `WriteBarrier` slot.
/// `codegen_cached_accessors!` emits `route_list_{get,set}_cached` wrapping
/// `${T}Prototype__routeList{Get,Set}CachedValue` (generate-classes.ts).
mod route_list_cached {
    pub mod http { bun_jsc::codegen_cached_accessors!("HTTPServer"; routeList); }
    pub mod https { bun_jsc::codegen_cached_accessors!("HTTPSServer"; routeList); }
    pub mod debug_http { bun_jsc::codegen_cached_accessors!("DebugHTTPServer"; routeList); }
    pub mod debug_https { bun_jsc::codegen_cached_accessors!("DebugHTTPSServer"; routeList); }
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
        // SAFETY: user_data is the `*mut NewServer<..>` registered in set_routes;
        // req/res are live uws handles for the duration of the callback.
        NewServer::<SSL, DEBUG>::on_request(
            user_data.cast(),
            unsafe { &mut *req },
            res.cast(),
        );
    }

    pub extern "C" fn on_user_route_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut UserRoute<..>` registered in set_routes;
        // req/res are live uws handles for the duration of the callback.
        NewServer::<SSL, DEBUG>::on_user_route_request(
            user_data.cast::<UserRoute<SSL, DEBUG>>(),
            unsafe { &mut *req },
            res.cast(),
        );
    }

    pub extern "C" fn on_node_http_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // TODO(port): `NewServer::on_node_http_request` body
        // (server_body.rs:3246-3433) needs `NodeHTTPResponse` + Socket FFI.
        // The node:http compat path registers this only when
        // `config.on_node_http_request` is set; until that body lands the
        // plain `fetch` handler is the closest behavioural match.
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
    /// Raw mutable pointer to the VM. Exists so callers that genuinely need
    /// `&mut VirtualMachine` (e.g. `drain_microtasks`, unhandled-rejection
    /// hooks) can go raw→raw instead of `&T as *const T as *mut T`, which
    /// trips `invalid_reference_casting`.
    fn vm_mut(&self) -> *mut jsc::VirtualMachine;
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
    fn vm_mut(&self) -> *mut jsc::VirtualMachine { self.vm as *mut jsc::VirtualMachine }
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

    /// `server.zig:3591` — wraps a stack-lifetime µWS request into a
    /// JS-visible `Request` + heap `RequestContext` so it can outlive the
    /// handler frame (used by bake's deferred bundling path).
    pub fn prepare_and_save_js_request_context(
        &self,
        req: &mut uws::Request,
        resp: uws::AnyResponse,
        global: &jsc::JSGlobalObject,
        method: Option<bun_http::Method>,
    ) -> jsc::JsResult<Option<SavedRequest>> {
        // PORT NOTE: hand-dispatched (the macro can't bind a per-arm `resp`
        // type). `uws::Request` and `uws_sys::Request` are the same opaque
        // FFI handle re-exported through two crates.
        // SAFETY: ptr was produced by `AnyServer::from` for the matching tag
        // and is non-null while the server is alive.
        let req: &mut uws_sys::Request = req;
        Ok(match self.tag {
            AnyServerTag::HTTPServer => {
                let s = self.ptr.cast::<HTTPServer>();
                let r = resp.assert_no_ssl();
                let Some(p) = HTTPServer::prepare_js_request_context(
                    s, req, r, None, CreateJsRequest::Bake, method,
                ) else { return Ok(None) };
                Some(p.save(global, req, r))
            }
            AnyServerTag::HTTPSServer => {
                let s = self.ptr.cast::<HTTPSServer>();
                let r = resp.assert_ssl();
                let Some(p) = HTTPSServer::prepare_js_request_context(
                    s, req, r, None, CreateJsRequest::Bake, method,
                ) else { return Ok(None) };
                Some(p.save(global, req, r))
            }
            AnyServerTag::DebugHTTPServer => {
                let s = self.ptr.cast::<DebugHTTPServer>();
                let r = resp.assert_no_ssl();
                let Some(p) = DebugHTTPServer::prepare_js_request_context(
                    s, req, r, None, CreateJsRequest::Bake, method,
                ) else { return Ok(None) };
                Some(p.save(global, req, r))
            }
            AnyServerTag::DebugHTTPSServer => {
                let s = self.ptr.cast::<DebugHTTPSServer>();
                let r = resp.assert_ssl();
                let Some(p) = DebugHTTPSServer::prepare_js_request_context(
                    s, req, r, None, CreateJsRequest::Bake, method,
                ) else { return Ok(None) };
                Some(p.save(global, req, r))
            }
        })
    }

    /// `server.zig:3574` — invoke the user's route handler for a request that
    /// was deferred (bake bundle-then-serve flow).
    pub fn on_saved_request<const EXTRA_ARG_COUNT: usize>(
        &self,
        req: SavedRequestUnion<'_>,
        resp: uws::AnyResponse,
        callback: jsc::JSValue,
        extra_args: [jsc::JSValue; EXTRA_ARG_COUNT],
    ) {
        // SAFETY: ptr was produced by `AnyServer::from` for the matching tag
        // and is non-null while the server is alive.
        match self.tag {
            AnyServerTag::HTTPServer => HTTPServer::on_saved_request(
                self.ptr.cast(), req, resp.assert_no_ssl(), callback, extra_args,
            ),
            AnyServerTag::HTTPSServer => HTTPSServer::on_saved_request(
                self.ptr.cast(), req, resp.assert_ssl(), callback, extra_args,
            ),
            AnyServerTag::DebugHTTPServer => DebugHTTPServer::on_saved_request(
                self.ptr.cast(), req, resp.assert_no_ssl(), callback, extra_args,
            ),
            AnyServerTag::DebugHTTPSServer => DebugHTTPSServer::on_saved_request(
                self.ptr.cast(), req, resp.assert_ssl(), callback, extra_args,
            ),
        }
    }

    /// Mutable handle to the DevServer (when configured). HTMLBundle's request
    /// path mutates DevServer state (`respond_for_html_bundle`).
    pub fn dev_server_mut(&self) -> Option<&mut crate::bake::DevServer::DevServer> {
        any_server_dispatch_mut!(self, |s| s.dev_server.as_deref_mut())
    }

    /// Returns:
    /// - `Ready(None)` if no plugin has to be loaded
    /// - `Err` if there is a cached failure. Currently, this requires restarting the entire server.
    /// - `Pending` if `callback` was stored. It will call `on_plugins_resolved` or `on_plugins_rejected` later.
    pub fn get_or_load_plugins(
        &self,
        _callback: ServePluginsCallback<'_>,
    ) -> GetOrStartLoadResult<'_> {
        // PORT NOTE: `mod.rs::ServePlugins` and `server_body::ServePlugins` are
        // mid-reconciliation duplicates. The mod.rs state machine is simpler
        // (no Pending callback list), so map directly.
        any_server_dispatch!(self, |s| match s.plugins.as_deref() {
            None => GetOrStartLoadResult::Ready(None),
            Some(p) => match &p.state {
                ServePluginsState::Unqueued(_) | ServePluginsState::Pending => {
                    // TODO(port): once `ServePlugins::get_or_start_load` lands on
                    // the unified type, store `_callback` and kick the loader.
                    GetOrStartLoadResult::Pending
                }
                // server.zig:349 `.loaded => |plugins| return .{ .ready = plugins }`
                ServePluginsState::Loaded(b) => GetOrStartLoadResult::Ready(Some(b.as_ref())),
                ServePluginsState::Err(_) => GetOrStartLoadResult::Err,
            },
        })
    }

    pub fn append_static_route(
        &self,
        path: &[u8],
        route: AnyRoute,
        method: server_config::MethodOptional,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        any_server_dispatch_mut!(self, |s| s.config.append_static_route(path, route, method))
    }

    pub fn reload_static_routes(&self) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set — full body in server_body.rs:1764
        // (rebuilds the uws router from `config.static_routes`).
        any_server_dispatch!(self, |s| Ok(!s.flags.contains(ServerFlags::TERMINATED)))
    }

    pub fn get_url_as_string(&self) -> Result<bun_str::String, bun_alloc::AllocError> {
        any_server_dispatch!(self, |s| s.get_url_as_string())
    }
}

// ─── http_server_agent ───────────────────────────────────────────────────────
/// `jsc.Debugger.HTTPServerAgent.{notifyServerStarted, notifyServerStopped,
/// notifyServerRoutesUpdated}` — the FFI plumbing lives in
/// `bun_jsc::http_server_agent`; the bodies live here because they reach into
/// `AnyServer`/`ServerConfig` (forward dep from `bun_jsc`'s point of view).
pub mod http_server_agent {
    use super::{any_server_dispatch, AnyRoute, AnyServer, AnyServerTag};
    use super::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};
    use bun_jsc::debugger::DebuggerId;
    use bun_jsc::http_server_agent::{
        HTTPServerAgent, InspectorHTTPServerAgent, Route, RouteType,
    };
    use bun_str::String as BunString;

    /// `HTTPServerAgent.zig:notifyServerStarted`.
    pub fn notify_server_started(this: &mut HTTPServerAgent, mut instance: AnyServer) {
        let Some(agent) = this.agent else { return };
        this.next_server_id = DebuggerId::new(this.next_server_id.get() + 1);
        instance.set_inspector_server_id(this.next_server_id);
        let url = bun_core::handle_oom(instance.get_url_as_string());

        // SAFETY: `agent` is a non-null C++ InspectorHTTPServerAgent handle
        // (set via `Bun__HTTPServerAgent__setEnabled`); `vm()` is the live
        // process VM backref.
        unsafe {
            InspectorHTTPServerAgent::notify_server_started(
                agent.as_ptr(),
                this.next_server_id,
                (*instance.vm()).hot_reload_counter as i32,
                &url,
                bun_core::Timespec::now_allow_mocked_time().ms() as f64,
                instance.ptr.cast(),
            );
        }
        // PORT NOTE: `BunString` derefs in `Drop`.
    }

    /// `HTTPServerAgent.zig:notifyServerStopped`.
    pub fn notify_server_stopped(this: &HTTPServerAgent, server: AnyServer) {
        let Some(agent) = this.agent else { return };
        // SAFETY: `agent` is a live C++ handle (see above).
        unsafe {
            InspectorHTTPServerAgent::notify_server_stopped(
                agent.as_ptr(),
                server.inspector_server_id(),
                bun_core::time::milli_timestamp() as f64,
            );
        }
    }

    /// `HTTPServerAgent.zig:notifyServerRoutesUpdated`.
    pub fn notify_server_routes_updated(
        this: &HTTPServerAgent,
        server: AnyServer,
    ) -> Result<(), bun_alloc::AllocError> {
        let Some(agent) = this.agent else { return Ok(()) };
        let config = server.config();
        let mut routes: Vec<Route> = Vec::new();
        let mut max_id: u32 = 0;

        // PORT NOTE: Zig's `inline switch (server.userRoutes()) { inline else => |list| ... }`
        // monomorphized over the four `*UserRoute<SSL,DEBUG>` slice types.
        // Dispatch through the same macro the rest of `AnyServer` uses.
        any_server_dispatch!(&server, |s| {
            routes
                .try_reserve(s.user_routes.len())
                .map_err(|_| bun_alloc::AllocError)?;
            for user_route in &s.user_routes {
                max_id = max_id.max(user_route.id);
                routes.push(Route {
                    route_id: user_route.id as i32,
                    path: BunString::init(user_route.route.path.to_bytes()),
                    r#type: RouteType::Api,
                    ..Default::default()
                });
            }
        });

        for entry in &config.static_routes {
            max_id += 1;
            routes.push(Route {
                route_id: max_id as i32,
                path: BunString::init(&*entry.path),
                r#type: match &entry.route {
                    AnyRoute::Html(_) => RouteType::Html,
                    AnyRoute::Static(_) => RouteType::Static,
                    _ => RouteType::Default,
                },
                file_path: match &entry.route {
                    // SAFETY: RefPtr.data is a live NonNull while held in the
                    // route table; `.bundle` (IntrusiveRc) derefs to the live
                    // HTMLBundle whose `path` outlives this borrow.
                    AnyRoute::Html(r) => {
                        BunString::init(&*unsafe { r.data.as_ref() }.bundle.path)
                    }
                    _ => BunString::EMPTY,
                },
                ..Default::default()
            });
        }

        // SAFETY: `agent` is a live C++ handle; `vm()` is the live process VM.
        unsafe {
            InspectorHTTPServerAgent::notify_server_routes_updated(
                agent.as_ptr(),
                server.inspector_server_id(),
                (*server.vm()).hot_reload_counter as i32,
                &mut routes,
            );
        }
        // `Vec<Route>` drops → each `Route` drops (derefs path/file_path/etc.).
        Ok(())
    }
}

// ─── SavedRequest ────────────────────────────────────────────────────────────
pub struct SavedRequest {
    /// Spec server.zig:3261 — `jsc.Strong.Optional`. May be `.empty` until
    /// `prepare_js_request_context` populates it; `deinit` must tolerate the
    /// empty state.
    pub js_request: jsc::StrongOptional,
    pub request: *mut crate::webcore::Request,
    pub ctx: AnyRequestContext,
    pub response: uws::AnyResponse,
}

impl SavedRequest {
    /// Spec server.zig `SavedRequest.deinit` — release the JS strong ref and
    /// drop the request-context refcount. `request`/`response` are non-owning.
    pub fn deinit(&mut self) {
        self.js_request.deinit();
        self.ctx.deref();
    }
}

/// `server.zig:SavedRequest.Union`.
pub enum SavedRequestUnion<'a> {
    /// Direct pointer to a µWebSockets request that is still on the stack.
    Stack(&'a mut uws::Request),
    /// Heap-allocated copy that persists beyond the initial handler frame.
    Saved(SavedRequest),
}

// ─── ServerAllConnectionsClosedTask ──────────────────────────────────────────
pub struct ServerAllConnectionsClosedTask {
    pub global_object: *const jsc::JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub tracker: jsc::AsyncTaskTracker,
}

impl bun_event_loop::Taskable for ServerAllConnectionsClosedTask {
    const TAG: bun_event_loop::TaskTag =
        bun_event_loop::task_tag::ServerAllConnectionsClosedTask;
}

impl ServerAllConnectionsClosedTask {
    /// Spec server.zig `schedule` — `bun.TrivialNew` heap-allocates `this`,
    /// then `vm.eventLoop().enqueueTask(jsc.Task.init(ptr))`.
    pub fn schedule(this: Self, vm: &mut jsc::VirtualMachine) {
        let ptr = Box::into_raw(Box::new(this));
        vm.enqueue_task(bun_event_loop::Task::init(ptr));
    }

    /// Spec server.zig `runFromJSThread` — resolve the `server.stop()` promise
    /// once uws reports all sockets closed, then `bun.destroy(self)`.
    pub fn run_from_js_thread(
        this: *mut Self,
        vm: &mut jsc::VirtualMachine,
    ) -> Result<(), jsc::JsTerminated> {
        httplog!("ServerAllConnectionsClosedTask runFromJSThread");

        // SAFETY: `this` was `Box::into_raw`'d in `schedule()`; reclaim
        // ownership and move out of the Box (Zig: `bun.destroy(this)` after
        // copying the fields it still needs onto the stack).
        let this = *unsafe { Box::from_raw(this) };
        // SAFETY: `global_object` is the per-VM JSGlobalObject, kept alive for
        // the VM's lifetime; the task is only dispatched on that VM's JS thread.
        let global_object: &jsc::JSGlobalObject = unsafe { &*this.global_object };
        let tracker = this.tracker;
        tracker.will_dispatch(global_object);
        let _guard =
            scopeguard::guard((), move |_| tracker.did_dispatch(global_object));

        // Zig: `var promise = this.promise; defer promise.deinit();` —
        // `JSPromiseStrong`'s Drop releases the strong handle on scope exit.
        let mut promise = this.promise;

        if !vm.is_shutting_down() {
            promise.resolve(global_object, JSValue::UNDEFINED)?;
        }
        Ok(())
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
