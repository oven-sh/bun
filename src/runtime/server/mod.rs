//! Port of src/runtime/server/server.zig
//!
//! cycle-5: un-gated `NewServer` struct + lifecycle skeleton (start/stop/listen),
//! `AnyServer` dispatch, `AnyRoute`, and the per-file submodules. JS callback
//! bodies (`on_request`, `on_upgrade`, `from_js`, …) and methods that need
//! `bun_uws` write/close surface stay ``-gated inside each file.
//! The full Phase-A draft of every gated body is preserved in `server_body.rs`.

use bun_collections::{ByteVecExt, VecExt};
use core::ffi::{c_char, c_int, c_void};
use core::sync::atomic::Ordering;

/// Codegen `${ServerType}__create(global, ptr)` shim — one extern per
/// `(SSL, DEBUG)` monomorphization. Routes through the
/// `crate::generated_classes::js_*Server::to_js` wrappers (which own the
/// canonical extern decl) instead of redeclaring the symbols here.
pub(crate) fn server_js_create(
    ptr: *mut c_void,
    global: &jsc::JSGlobalObject,
    ssl: bool,
    debug: bool,
) -> jsc::JSValue {
    use crate::generated_classes as gc;
    // `ptr` is a fresh `NewServer<SSL,DEBUG>` heap allocation; the C++
    // wrapper takes ownership. Cast through the concrete monomorphization
    // each codegen module is typed against.
    match (ssl, debug) {
        (false, false) => gc::js_HTTPServer::to_js(ptr.cast(), global),
        (true, false) => gc::js_HTTPSServer::to_js(ptr.cast(), global),
        (false, true) => gc::js_DebugHTTPServer::to_js(ptr.cast(), global),
        (true, true) => gc::js_DebugHTTPSServer::to_js(ptr.cast(), global),
    }
}

use bun_io::KeepAlive;
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

// `server_body.rs` holds the large method bodies (`on_request`, `on_upgrade`,
// route setup, …) split out to keep this module declaration file readable.

#[path = "server_body.rs"]
mod server_body;
pub use server_body::{
    AnyUserRouteList, BunInfo, GetOrStartLoadResult, PreparedRequestFor, ServePluginsCallback,
    ServerInitContext,
};

// ─── write_status ────────────────────────────────────────────────────────────
pub fn write_status<const SSL: bool>(resp: *mut uws_sys::NewAppResponse<SSL>, status: u16) {
    // Zig spec (server.zig:8-16) takes `?*Response` and no-ops on null. The
    // route handlers (`StaticRoute`/`FileRoute`) call here from completion
    // paths where the request may already be aborted/detached.
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
// PORT NOTE (§Pointers): Zig variants are `bun.ptr.RefCount` payloads. All
// three concrete route types carry an intrusive `ref_count: Cell<u32>` and are
// heap-allocated via `heap::alloc`; their pointers round-trip through uws
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
    // `Static`/`File` payloads are intrusive-refcounted heap allocations whose
    // +1 ref is held by the route table for the entire lifetime of this
    // `AnyRoute` value, so the `BackRef` invariant (pointee outlives holder)
    // is satisfied for any borrow scoped to `&self`. Wrapping the `NonNull`
    // in a transient `BackRef` centralises the deref under that invariant
    // instead of repeating a raw `NonNull::as_ref` per arm.
    pub fn memory_cost(&self) -> usize {
        match self {
            AnyRoute::Static(p) => bun_ptr::BackRef::from(*p).memory_cost(),
            AnyRoute::File(p) => bun_ptr::BackRef::from(*p).memory_cost(),
            AnyRoute::Html(r) => r.data().memory_cost(),
            AnyRoute::FrameworkRouter(_) => {
                core::mem::size_of::<crate::bake::FileSystemRouterType>()
            }
        }
    }

    pub fn ref_(&self) {
        match self {
            AnyRoute::Static(p) => bun_ptr::BackRef::from(*p).ref_(),
            AnyRoute::File(p) => bun_ptr::BackRef::from(*p).ref_(),
            AnyRoute::Html(r) => {
                // SAFETY: RefPtr keeps the pointee live while held in the route table.
                unsafe { bun_ptr::RefCount::<html_bundle::Route>::ref_(r.as_ptr()) };
            }
            AnyRoute::FrameworkRouter(_) => {} // not reference counted
        }
    }
    pub fn deref_(&self) {
        match self {
            // SAFETY: intrusive refcount; ptr was heap-allocated with rc=1.
            AnyRoute::Static(p) => unsafe { StaticRoute::deref_(p.as_ptr()) },
            // SAFETY: see above.
            AnyRoute::File(p) => unsafe { FileRoute::deref(p.as_ptr()) },
            AnyRoute::Html(r) => r.deref(),
            AnyRoute::FrameworkRouter(_) => {} // not reference counted
        }
    }

    pub fn set_server(&self, server: Option<AnyServer>) {
        match self {
            AnyRoute::Static(p) => bun_ptr::BackRef::from(*p).server.set(server),
            AnyRoute::File(p) => bun_ptr::BackRef::from(*p).set_server(server),
            AnyRoute::Html(r) => r.data().server.set(server),
            AnyRoute::FrameworkRouter(_) => {} // DevServer holds its own .server (server.zig:51-58)
        }
    }

    // from_js / from_options / html_route_from_js — bodies live in
    // `server_body.rs` (`impl AnyRoute { … }`); same crate, separate file.
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
// Full state machine + intrusive refcount lives in `server_body.rs` (the
// `*mut ServePlugins` is smuggled through `JSValue::then` as a promise context,
// so `Rc` is unsuitable). Re-exported here for `AnyServer` callers.
pub use server_body::{PluginsResult, ServePlugins, ServePluginsState};

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
    // LIFETIMES.tsv = STATIC → `&'static VirtualMachine`. `BackRef` for safe
    // `Deref` while keeping the struct `'static` (process-lifetime VM).
    pub vm: bun_ptr::BackRef<jsc::VirtualMachine>,
    pub global_this: *const jsc::JSGlobalObject,
    /// Packed `bun.ptr.TaggedPointerUnion` wire-format `AnyServer` for this
    /// server (`u49` heap addr | `u15` variant tag), computed once in
    /// [`Self::init`]. The C++ `node:http` request path needs it on every
    /// request to reconstruct `AnyServer`; it's a pure function of the (stable)
    /// heap address and the const variant tag, so cache it rather than
    /// recompute `AnyServer::from(self).to_packed()` in the per-request prologue.
    pub any_server_packed: usize,
    /// Lazily-filled cache of the interned JS method-name string per HTTP
    /// method token. The `node:http` request prologue reads this so each request
    /// after the first for a given method skips the FFI hop into
    /// `Bun__HTTPMethod__toJS`. Indexed by `Method as usize`; a slot holds
    /// [`JSValue::ZERO`] until filled. The cached value is one of the global
    /// object's GC-rooted common strings (visited by `CommonStrings::visit`), so
    /// it stays live for as long as this server's global object — which always
    /// outlives the server itself.
    pub method_name_cache: [core::cell::Cell<jsc::JSValue>; N_HTTP_METHODS],
    pub base_url_string_for_joining: Box<[u8]>,
    pub config: ServerConfig,
    pub pending_requests: usize,
    pub request_pool: *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, false>,
    /// Zig: `if (has_h3) *H3RequestContext.RequestContextStackAllocator else void`.
    /// Null until the H3 listen path runs (`HAS_H3 && config.h3`); never
    /// allocated when `!SSL`. Kept as a raw nullable pointer rather than a
    /// conditional field so the struct stays uniform across monomorphizations.
    pub h3_request_pool: *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, true>,
    pub all_closed_promise: jsc::JSPromiseStrong,

    pub listen_callback: jsc::AnyTask::AnyTask,
    // allocator field dropped — global mimalloc per §Allocators
    pub poll_ref: KeepAlive,

    pub flags: ServerFlags,

    /// Intrusively-refcounted plugin state. Stored as a `BackRef` (not `Rc`)
    /// because (a) the same `*mut ServePlugins` is smuggled through
    /// `JSValue::then` as a promise context and (b) `ServePlugins` is mutated
    /// through any owner (Zig spec uses `*ServePlugins` everywhere). The
    /// counted ref held here is released in `Drop for NewServer`.
    pub plugins: Option<bun_ptr::BackRef<ServePlugins>>,

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

impl<const SSL: bool, const DEBUG: bool> Drop for NewServer<SSL, DEBUG> {
    fn drop(&mut self) {
        // Spec server.zig:deinit — `if (this.plugins) |p| p.deref()`. The
        // remaining owned fields (config, base_url, h3_alt_svc, dev_server,
        // user_routes, all_closed_promise, on_clienterror) drop automatically.
        if let Some(p) = self.plugins.take() {
            // SAFETY: `plugins` carries the `heap::alloc` provenance from
            // `ServePlugins::init`; this releases the server's counted ref.
            unsafe { ServePlugins::deref_(p.as_ptr()) };
        }
    }
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
                std::ptr::from_mut::<uws_sys::Request>(req).cast::<c_void>(),
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

/// RAII: on drop, detaches the borrowed stack `uws::Request` from the heap
/// `webcore::Request` — the Rust spelling of Zig's
/// `defer request_object.request_context.detachRequest();` so the JS request
/// object never dangles a pointer past the uWS frame it borrowed.
pub(crate) struct DetachRequestOnDrop(*mut crate::webcore::Request);

impl DetachRequestOnDrop {
    /// # Safety
    /// `request_object` must point to a live heap `webcore::Request` (the one
    /// produced by `Request::new` / `PreparedRequest::save`) and remain valid
    /// for the guard's lifetime — kept alive by `ctx.request_weakref`.
    #[inline]
    pub(crate) unsafe fn new(request_object: *mut crate::webcore::Request) -> Self {
        Self(request_object)
    }
}

impl Drop for DetachRequestOnDrop {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: per `new()` contract — `self.0` is the heap allocation
        // produced by `Request::new`; kept alive by `ctx.request_weakref`
        // until `RequestContext::deinit` releases it.
        unsafe { (*self.0).request_context.detach_request() };
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    pub const SSL_ENABLED: bool = SSL;
    pub const DEBUG_MODE: bool = DEBUG;
    pub const HAS_H3: bool = SSL;

    // ── raw-field accessors ──────────────────────────────────────────────────

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
    pub fn vm(&self) -> &jsc::VirtualMachine {
        self.vm.get()
    }

    /// Shared borrow of the intrusively-refcounted [`ServePlugins`] this
    /// server holds a counted ref on (see field doc). Centralises the
    /// `Option<NonNull>` deref so callers (`AnyServer::plugins`,
    /// `get_plugins`) read it as a plain `Option<&T>`.
    ///
    /// # Safety (encapsulated)
    /// `plugins` is set once from `ServePlugins::init` (heap-allocated, +1
    /// ref) and released only in `Drop for NewServer`, so while `Some` the
    /// pointee is live for `&self`'s duration. Single-threaded JS context;
    /// no `&mut ServePlugins` is live across a `&self` borrow.
    #[inline(always)]
    pub fn plugins_ref(&self) -> Option<&ServePlugins> {
        // `BackRef::get` encapsulates the deref under the counted-ref invariant.
        self.plugins.as_ref().map(bun_ptr::BackRef::get)
    }

    /// Raw mutable pointer to the process-static VM. Returned as `*mut` (not
    /// `&mut`) because the VM is mutated across re-entrant JS callbacks
    /// (`drain_microtasks`, event-loop ticks) while other `&VirtualMachine`
    /// borrows may be live; handing out `&mut` here would alias.
    ///
    /// Routes through [`jsc::VirtualMachine::get_mut_ptr`] (the thread-local
    /// raw `*mut`) rather than casting `self.vm` — the field is `*const`
    /// derived from a `&'static VirtualMachine`, so casting it to `*mut` would
    /// carry read-only Stacked-Borrows provenance and make any write through
    /// the result UB.
    #[inline(always)]
    pub fn vm_mut(&self) -> *mut jsc::VirtualMachine {
        debug_assert!(core::ptr::eq(
            self.vm.as_ptr(),
            jsc::VirtualMachine::get_mut_ptr()
        ));
        jsc::VirtualMachine::get_mut_ptr()
    }

    /// Raw pointer to the process-static H1 request pool. Returned as `*mut`
    /// (not `&mut`) because the pool is mutated through both `&self`
    /// (`release_request_context`) and request-dispatch paths; a `&mut`
    /// accessor would alias across re-entrant request handling.
    #[inline]
    pub fn request_pool_ptr(
        &self,
    ) -> *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, false> {
        self.request_pool
    }

    /// Raw pointer to the process-static H3 request pool, or **null** if this
    /// server never opened an H3 listener. See `request_pool_ptr` for why this
    /// is `*mut`, not `&mut`.
    #[inline]
    pub fn h3_request_pool_ptr(
        &self,
    ) -> *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, true> {
        self.h3_request_pool
    }

    // ─────────────────────────────────────────────────────────────────────────

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
    pub fn get_url_as_string(&self) -> Result<bun_core::String, bun_alloc::AllocError> {
        use bun_core::fmt::{URLFormatter, URLProto};
        use std::io::Write as _;
        let fmt = match &self.config.address {
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
                if let Some(listener) = self.listener {
                    // S012: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
                    port = bun_opaque::opaque_deref_mut(listener).get_local_port() as u16;
                } else if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener {
                        // S012: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                        port = bun_opaque::opaque_deref_mut(h3l).get_local_port() as u16;
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
        Ok(bun_core::String::clone_utf8(&buf))
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
        should_deinit_context: Option<request_context::DeferDeinitFlag>,
        create_js_request: CreateJsRequest,
        method: Option<bun_http_types::Method::Method>,
    ) -> Option<PreparedRequest<SSL, DEBUG>> {
        jsc::mark_binding!();
        // SAFETY: `this`/`resp` are live for the duration of the uWS callback;
        // re-borrowed disjointly below to avoid stacking `&mut` across the
        // `ctx.create()` call (which stores `this` as a backref).
        let server = unsafe { &mut *this };
        // S008: `Response<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        let resp_ref = bun_opaque::opaque_deref_mut(resp);

        // We need to register the handler immediately since uSockets will not buffer.
        //
        // We first validate the self-reported request body length so that
        // we avoid needing to worry as much about what memory to free.
        // (RFC 9114 §4.2 transfer-encoding check is H3-only — skipped here.)

        // Resolve once, reuse for both `has_request_body()` here and the
        // forward to `RequestContext::create` below. Zig parses inline at both
        // sites; with `Method::which` now a length-gated match (316a83f) the
        // second call is cheap, but the resolved value is also what `create`
        // wants — passing `None` made it parse a second time.
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
        // re-entrancy bookkeeping; `Debug::enter_scope` is the RAII pairing
        // (no-op enter/exit in release builds).
        let vm_ptr = server.vm_mut();
        // SAFETY: vm backref is live for the server's lifetime; `event_loop()`
        // returns the VM-owned `*mut EventLoop` whose `debug` field outlives
        // this frame.
        let _dbg_guard = unsafe {
            bun_jsc::event_loop::Debug::enter_scope(core::ptr::addr_of_mut!(
                (*(*vm_ptr).event_loop()).debug
            ))
        };
        req.set_yield(false);
        resp_ref.timeout(server.config.idle_timeout);

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

        // SAFETY: `request_pool` points at a process-static (or
        // server-owned) `HiveArray::Fallback`; valid for the server's lifetime.
        let ctx_slot = unsafe { (*server.request_pool).try_get() };
        // SAFETY: `try_get` hands out an uninitialized slot; `create()` fully
        // initializes it via `MaybeUninit::write`.
        let ctx_uninit = unsafe {
            &mut *ctx_slot.cast::<core::mem::MaybeUninit<ServerRequestContext<SSL, DEBUG>>>()
        };
        ServerRequestContext::<SSL, DEBUG>::create(
            ctx_uninit,
            this,
            std::ptr::from_mut::<uws_sys::Request>(req).cast::<c_void>(),
            any_response_from::<SSL>(resp),
            should_deinit_context,
            method,
        );
        // SAFETY: fully initialized by `create()`.
        let ctx: *mut ServerRequestContext<SSL, DEBUG> = ctx_slot;
        let ctx_mut = unsafe { &mut *ctx };

        // `VirtualMachine::jsc_vm()` is the safe accessor for the JSC VM
        // (set in VM init; valid for the JS thread's lifetime).
        server
            .vm()
            .jsc_vm()
            .deprecated_report_extra_memory(
                core::mem::size_of::<ServerRequestContext<SSL, DEBUG>>(),
            );

        // Allocate the pooled body slot. `hive_alloc` is the typed front-end
        // for the type-erased `init_request_body_value` hook (the hook lives
        // in `bun_jsc` which cannot name `bun_runtime` types).
        // SAFETY: vm backref live for the JS thread's lifetime.
        let body_hive = crate::webcore::body::hive_alloc(
            unsafe { &mut *vm_ptr },
            crate::webcore::body::Value::Null,
        );
        // SAFETY: hive_alloc returns a freshly-initialized hive slot
        // (`ref_count = 1`); live until refcount drops to zero.
        let body_value: *mut crate::webcore::body::Value =
            unsafe { core::ptr::addr_of_mut!((*body_hive.as_ptr()).value) };
        ctx_mut.request_body = core::ptr::NonNull::new(body_value);

        let global = server.global_this();
        let signal = jsc::AbortSignal::new(global);
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe deref.
        ctx_mut.signal = core::ptr::NonNull::new(signal);
        bun_opaque::opaque_deref_mut(signal).pending_activity_ref();

        // SAFETY: `signal.ref_()` bumps the intrusive count and returns +1.
        let signal_ref =
            unsafe { jsc::AbortSignalRef::adopt(bun_opaque::opaque_deref_mut(signal).ref_()) };
        // Zig: `.body = body.ref()` — bump once so the JS Request shares the
        // same hive slot as `ctx.request_body` (streamed bytes buffered into
        // the ctx surface on `request.body`/`request.json()`). Paired with
        // `HiveRef::unref` in `Request::finalize`.
        // SAFETY: `body_hive` is live (ref_count >= 1).
        let body_for_req: core::ptr::NonNull<crate::webcore::body::HiveRef> =
            unsafe { core::ptr::NonNull::from((*body_hive.as_ptr()).ref_()) };
        // PORT NOTE (ownership): `Request::new` is `bun.TrivialNew` — the heap
        // allocation is handed to the JS GC via `to_js`/`to_js_for_bake` (C++
        // wrapper finalizer frees it), or, for `CreateJsRequest::No`, retained
        // by `ctx.request_weakref` until `RequestContext::deinit` releases it.
        let request_object: *mut crate::webcore::Request =
            bun_core::heap::into_raw(crate::webcore::Request::new(crate::webcore::Request::init(
                ctx_mut.method,
                AnyRequestContext::init(ctx),
                SSL,
                Some(signal_ref),
                body_for_req,
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
                            task: Some(ctx.cast::<c_void>()),
                            global: std::ptr::from_ref(global),
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
                CreateJsRequest::Bake => {
                    match unsafe { (*request_object).to_js_for_bake(global) } {
                        Ok(v) => v,
                        Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
                        Err(_) => return None,
                    }
                }
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
        let global = server.global_this();
        let response_value = match callback.call(global, server.js_value_assert_alive(), &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        let is_stack = matches!(req, SavedRequestUnion::Stack(_));
        let request_object = prepared.request_object;
        // uWS request will not live longer than this function — only detach
        // when it's the stack-allocated original (a saved request already
        // copied everything it needs).
        // SAFETY: `request_object` is kept alive by `ctx.request_weakref` for
        // the request's lifetime.
        let _detach_guard = is_stack.then(|| unsafe { DetachRequestOnDrop::new(request_object) });

        // SAFETY: `ctx` was just allocated (or saved) by this server; no other
        // borrow is live across this scope.
        let ctx_mut = unsafe { &mut *ctx };
        let original_state = ctx_mut.defer_deinit_until_callback_completes;
        let should_deinit_context = core::cell::Cell::new(false);
        ctx_mut.defer_deinit_until_callback_completes =
            Some(bun_ptr::BackRef::new(&should_deinit_context));
        ctx_mut.on_response(server, prepared.js_request, response_value);
        // SAFETY: re-borrow after `on_response` returned (which may have run
        // arbitrary JS but cannot free `ctx` while `defer_deinit_...` is set).
        unsafe { (*ctx).defer_deinit_until_callback_completes = original_state };

        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        if should_deinit_context.get() {
            // SAFETY: see above; `on_response` set the deferred flag instead of
            // freeing in-place. `ctx` is not accessed after this returns.
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
                        std::ptr::from_ref::<uws::Request>(r)
                            .cast_mut()
                            .cast::<c_void>(),
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
    ///
    /// `should_deinit_context` is the same `Cell<bool>` already stored in
    /// `ctx.defer_deinit_until_callback_completes` by
    /// `prepare_js_request_context`; `&Cell` (shared) and the stored `BackRef`
    /// can coexist under Stacked Borrows, so no raw-pointer dance is needed.
    fn handle_request(
        this: *mut Self,
        should_deinit_context: &core::cell::Cell<bool>,
        prepared: PreparedRequest<SSL, DEBUG>,
        req: &mut uws_sys::Request,
        response_value: JSValue,
    ) {
        let ctx = prepared.ctx;
        let request_object = prepared.request_object;

        // uWS request will not live longer than this function
        // SAFETY: `request_object` is the heap allocation produced by
        // `Request::new`; kept alive by `ctx.request_weakref` until
        // `RequestContext::deinit` releases it.
        let _detach_guard = unsafe { DetachRequestOnDrop::new(request_object) };

        // SAFETY: `ctx` was allocated by `prepare_js_request_context` for this
        // frame; no other borrow is live across this scope.
        unsafe { (*ctx).on_response(&*this, prepared.js_request, response_value) };
        // Reference in the stack here in case it is not for whatever reason
        prepared.js_request.ensure_still_alive();

        // SAFETY: re-borrow after `on_response` returned (which may have run
        // arbitrary JS but cannot free `ctx` while `defer_deinit_…` is set).
        unsafe { (*ctx).defer_deinit_until_callback_completes = None };

        if should_deinit_context.get() {
            // SAFETY: `on_response` set the deferred flag instead of freeing
            // in-place; we own the slot now. `ctx` is not accessed after this.
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
                std::ptr::from_mut::<uws_sys::Request>(req).cast::<c_void>(),
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
        let should_deinit_context = core::cell::Cell::new(false);
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

        // SAFETY: `this` is the live server backref for this request.
        let server = unsafe { &*this };
        let on_request = server
            .config
            .on_request
            .as_ref()
            .map(|s| s.get())
            .unwrap_or(JSValue::ZERO);
        debug_assert!(!on_request.is_empty());

        let global = server.global_this();
        let js_value = server.js_value_assert_alive();
        let response_value =
            match on_request.call(global, js_value, &[prepared.js_request, js_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

        Self::handle_request(this, &should_deinit_context, prepared, req, response_value);
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
        let server = user_route.server.cast_mut();
        let index = user_route.id;

        let should_deinit_context = core::cell::Cell::new(false);
        let Some(mut prepared) = Self::prepare_js_request_context(
            server,
            req,
            resp,
            Some(bun_ptr::BackRef::new(&should_deinit_context)),
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
        let global = server_ref.global_this();
        let server_js = server_ref.js_value_assert_alive();
        let server_request_list =
            Self::js_route_list_get_cached(server_js).expect("routeList cached value missing");
        let response_value = bun_jsc::host_fn::from_js_host_call(global, || {
            Bun__ServerRouteList__callRoute(
                global,
                index,
                prepared.request_object,
                server_js,
                server_request_list,
                &mut prepared.js_request,
                core::ptr::from_mut(req).cast::<c_void>(),
            )
        })
        .unwrap_or_else(|err| global.take_exception(err));

        Self::handle_request(
            server,
            &should_deinit_context,
            prepared,
            req,
            response_value,
        );
    }

    /// `server.zig:onNodeHTTPRequest` — node:http compat path; thin wrapper
    /// over [`Self::on_node_http_request_with_upgrade_ctx`] with no WS upgrade.
    pub fn on_node_http_request(
        this: *mut Self,
        req: &mut uws_sys::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        jsc::mark_binding!();
        Self::on_node_http_request_with_upgrade_ctx(this, req, resp, core::ptr::null_mut());
    }

    /// `server.zig:onNodeHTTPRequestWithUpgradeCtx` — invoke the JS-side
    /// `node:http` request handler (`NodeHTTPServer__onRequest_{http,https}`),
    /// then drive the returned promise / [`NodeHTTPResponse`] through the same
    /// completion / abort / error paths the Zig spec encodes.
    ///
    /// PORT NOTE: receiver is `*mut Self` (not `&mut self`) — the body
    /// re-enters JS (`drain_microtasks`, `then2`) which may call back into
    /// other server methods, so a long-lived `&mut Self` would alias. Each use
    /// site below derives a short-lived borrow that ends before the next
    /// re-entry point.
    pub fn on_node_http_request_with_upgrade_ctx(
        this: *mut Self,
        req: &mut uws_sys::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
        upgrade_ctx: *mut uws_sys::WebSocketUpgradeContext,
    ) {
        use bun_http_jsc::method_jsc::MethodJsc as _;
        use node_http_response::Flags as NhrFlags;

        // SAFETY: `this` is the live server backref registered as the uws
        // userdata; only one borrow derived from it is alive at a time.
        unsafe { (*this).on_pending_request() };
        // Read-only access goes through `BackRef` (safe `Deref`); each use
        // materialises a fresh short-lived `&Self`, so the JS-reentrant calls
        // below never see an outstanding shared borrow.
        let this_ref = bun_ptr::BackRef::from(
            core::ptr::NonNull::new(this).expect("on_node_http_request: this non-null"),
        );
        let vm = this_ref.vm_mut();
        // SAFETY: `vm.event_loop()` returns the live VM-owned `*mut EventLoop`.
        let _dbg = unsafe {
            jsc::event_loop::Debug::enter_scope(core::ptr::addr_of_mut!(
                (*(*vm).event_loop()).debug
            ))
        };
        req.set_yield(false);
        resp.timeout(this_ref.config.idle_timeout);

        let global = this_ref.global_this();
        let this_object = this_ref.js_value.try_get().unwrap_or(JSValue::UNDEFINED);

        // Compute the JS method-name string up front so the FFI closure
        // doesn't need to reborrow `req` (it's already `&mut`-borrowed below).
        // Memoised per-method on the server: `Method::to_js` returns the global
        // object's GC-rooted common string, which is the same JSValue for every
        // request, so only the first request for a given method pays the FFI hop
        // into `Bun__HTTPMethod__toJS`. (`get(..)` falls back to a fresh intern
        // if a future method variant ever indexes past the cache.)
        let method_string = match bun_http::Method::find(req.method()) {
            Some(m) => match this_ref.method_name_cache.get(m as usize) {
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
        // Zig: `this.config.onNodeHTTPRequest` (raw JSValue, may be `.zero`).
        let callback = this_ref
            .config
            .on_node_http_request
            .as_ref()
            .map(|s| s.get())
            .unwrap_or(JSValue::ZERO);
        // C++ forwards `any_server` to `NodeHTTPResponse::create`, which
        // unpacks it via `any_server_from_packed` (bits 49..64 = variant tag);
        // a raw `*mut Self` would zero those bits and trip the dispatch
        // `unreachable!`, so the `TaggedPointerUnion` wire format is needed.
        // Computed once in `init()` (stable heap address) — just load it.
        let any_server_packed = this_ref.any_server_packed;

        let mut node_http_response: *mut NodeHTTPResponse = core::ptr::null_mut();
        let mut is_async = false;

        let on_request_ffi = if SSL {
            ffi::NodeHTTPServer__onRequest_https
        } else {
            ffi::NodeHTTPServer__onRequest_http
        };
        let result: JSValue = bun_jsc::host_fn::from_js_host_call(global, || {
            on_request_ffi(
                any_server_packed,
                global,
                this_object,
                callback,
                method_string,
                req,
                std::ptr::from_mut::<uws_sys::NewAppResponse<SSL>>(resp).cast(),
                upgrade_ctx.cast(),
                &mut node_http_response,
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
                    // SAFETY: `vm` is the process-static VirtualMachine.
                    unsafe { (*vm).drain_microtasks() };
                    status = promise.status();
                }

                match status {
                    jsc::js_promise::Status::Fulfilled => {
                        global.handle_rejected_promises();
                        break 'brk HttpResult::Success;
                    }
                    jsc::js_promise::Status::Rejected => {
                        promise.set_handled(global.vm());
                        break 'brk HttpResult::Rejection(promise.result(global.vm()));
                    }
                    jsc::js_promise::Status::Pending => {
                        global.handle_rejected_promises();
                        if !node_http_response.is_null() {
                            // SAFETY: out-param written by `on_request_ffi`;
                            // owned ref held until `deref()` below.
                            let nhr = unsafe { &mut *node_http_response };
                            // Single `Cell` load for all three flag checks (no
                            // re-entry between them) — Zig reads the packed field once.
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
                            // PORT NOTE: `#[host_fn(export = …)]` emits its
                            // C-ABI shim as `__jsc_host_<fn>`; the export name
                            // is link-only.
                            result.then2(
                                global,
                                strong_self,
                                node_http_response::__jsc_host_node_http_request_on_resolve,
                                node_http_response::__jsc_host_node_http_request_on_reject,
                            );
                            is_async = true;
                        }

                        break 'brk HttpResult::Pending;
                    }
                }
            }

            HttpResult::Success
        };

        match &http_result {
            HttpResult::Exception(err) | HttpResult::Rejection(err) => {
                // SAFETY: `vm` is the process-static VirtualMachine.
                let _ = unsafe { &mut *vm }.uncaught_exception(
                    global,
                    *err,
                    matches!(http_result, HttpResult::Rejection(_)),
                );

                if !node_http_response.is_null() {
                    // SAFETY: see `nhr` above.
                    let nhr = unsafe { &mut *node_http_response };
                    let nhr_flags = nhr.flags.get();
                    if !nhr_flags.contains(NhrFlags::UPGRADED) {
                        if let Some(raw) = nhr.raw_response.get() {
                            if !nhr_flags.contains(NhrFlags::REQUEST_HAS_COMPLETED)
                                && raw.state().is_response_pending()
                            {
                                // PORT NOTE: matches server.zig:2173 verbatim.
                                // The Zig spec writes a 500 status when
                                // `isHttpStatusCalled()` is *true* and
                                // `endStream`s otherwise; NodeHTTPResponse.zig:680
                                // uses the inverted predicate. The port tracks
                                // the spec — if the spec is wrong it must be
                                // fixed there, not silently inverted here.
                                if raw.state().is_http_status_called() {
                                    raw.write_status(b"500 Internal Server Error");
                                    raw.end_without_body(true);
                                } else {
                                    raw.end_stream(true);
                                }
                            }
                        }
                    }
                    nhr.on_request_complete();
                }
            }
            HttpResult::Success | HttpResult::Pending => {}
        }

        if !node_http_response.is_null() {
            // SAFETY: see `nhr` above.
            let nhr = unsafe { &mut *node_http_response };
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
                        // SAFETY: `vm` is the process-static VirtualMachine.
                        nhr.maybe_stop_reading_body(unsafe { &mut *vm }, this_value);
                    }
                }
            }
        }

        // PORT NOTE: Zig `defer` cleanup, hoisted out of scopeguards (no early
        // returns above). Reverse-decl order: strong_promise, drain, deref.
        strong_promise.deinit();
        if needs_to_drain {
            // SAFETY: `vm` is the process-static VirtualMachine.
            unsafe { (*vm).drain_microtasks() };
        }
        if !is_async && !node_http_response.is_null() {
            // SAFETY: out-param ref taken in C++; synchronous path drops it.
            unsafe { &mut *node_http_response }.deref();
        }
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

    /// `js.gc.routeList.set` — write the codegen'd `WriteBarrier<Unknown>`
    /// slot on the per-type C++ wrapper so route JS objects stay GC-rooted.
    pub fn js_gc_route_list_set(server_js: JSValue, global: &JSGlobalObject, route_list: JSValue) {
        match (SSL, DEBUG) {
            (false, false) => {
                route_list_cached::http::route_list_set_cached(server_js, global, route_list)
            }
            (true, false) => {
                route_list_cached::https::route_list_set_cached(server_js, global, route_list)
            }
            (false, true) => {
                route_list_cached::debug_http::route_list_set_cached(server_js, global, route_list)
            }
            (true, true) => {
                route_list_cached::debug_https::route_list_set_cached(server_js, global, route_list)
            }
        }
    }

    /// Wrap an already-heap-allocated server pointer in its JS object.
    /// Ownership transfers to the C++ wrapper (freed via `finalize`).
    pub fn ptr_to_js(this: *mut Self, global: &JSGlobalObject) -> JSValue {
        server_js_create(this.cast(), global, SSL, DEBUG)
    }

    // `on_reload_from_zig` body lives in `server_body.rs` (`impl NewServer { … }`);
    // same crate, separate file. Kept there alongside `on_reload`/`reload_static_routes`
    // so the Zig diff stays side-by-side.

    pub fn on_static_request_complete(&mut self) {
        self.pending_requests -= 1;
        self.deinit_if_we_can();
    }

    #[inline]
    pub fn on_request_complete(&mut self) {
        // SAFETY: `vm_mut()` is the process-static `*mut VirtualMachine` (non-null
        // for the server's lifetime); `.event_loop()` returns the VM-owned
        // `*mut EventLoop`. Single-threaded JS context, no aliasing `&mut`.
        unsafe { (*(*self.vm_mut()).event_loop()).process_gc_timer() };
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
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            bun_opaque::opaque_deref_mut(app)
                .set_flags(require_host_header, use_strict_method_validation);
        }
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        if let Some(app) = self.app {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            bun_opaque::opaque_deref_mut(app).set_max_http_header_size(max_header_size);
        }
    }

    pub fn ref_(&mut self) {
        if self.poll_ref.is_active() {
            return;
        }
        self.poll_ref
            .ref_(jsc::VirtualMachine::event_loop_ctx(self.vm.as_ptr()));
    }

    pub fn unref(&mut self) {
        self.poll_ref
            .unref(jsc::VirtualMachine::event_loop_ctx(self.vm.as_ptr()));
    }

    pub fn stop_listening(&mut self, abrupt: bool) {
        // httplog!("stopListening", .{});

        if Self::HAS_H3 {
            if let Some(h3l) = self.h3_listener.take() {
                // Graceful: GOAWAY + drain via the still-open UDP socket; the
                // engine rejects new conns and the timer keeps in-flight streams
                // progressing until deinit. Abrupt: close the fd now.
                if !abrupt {
                    if let Some(h3a) = self.h3_app {
                        // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                        bun_opaque::opaque_deref_mut(h3a).close();
                    }
                } else {
                    // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                    bun_opaque::opaque_deref_mut(h3l).close();
                }
            }
        }

        let Some(listener) = self.listener.take() else {
            if Self::HAS_H3 && self.h3_app.is_some() {
                self.unref();
                self.notify_inspector_server_stopped();
                if abrupt {
                    self.flags.insert(ServerFlags::TERMINATED);
                }
            }
            return;
        };
        self.unref();

        if !SSL {
            // SAFETY: `listener` is a live uws ListenSocket FFI handle just taken
            // from `self.listener`; deref'd once to read the socket fd. `vm` is a
            // STATIC ref (see `ServerLike::vm_mut`) — non-null for the server's
            // lifetime, so the raw→`&mut` deref is sound.
            unsafe {
                let fd = (*listener).socket().fd();
                (*self.vm_mut()).remove_listening_socket_for_watch_mode(fd);
            }
        }
        self.notify_inspector_server_stopped();

        if let server_config::Address::Unix(path) = &self.config.address {
            let bytes = path.as_bytes();
            if !bytes.is_empty() && bytes[0] != 0 {
                let _ = bun_sys::unlink(path.as_zstr());
            }
        }

        if !abrupt {
            // S012: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            bun_opaque::opaque_deref_mut(listener).close();
        } else if !self.flags.contains(ServerFlags::TERMINATED) {
            if let Some(ws) = self.config.websocket.as_mut() {
                ws.handler.app = None;
            }
            self.flags.insert(ServerFlags::TERMINATED);
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            bun_opaque::opaque_deref_mut(self.app.unwrap()).close();
        }
    }

    pub fn stop(&mut self, abrupt: bool) {
        if self.js_value.is_not_empty() {
            self.js_value.downgrade();
        }
        if self.config.allow_hot && !self.config.id.is_empty() {
            // `hot_map()` is reached via the thread-local VM singleton (raw ptr
            // deref) and does not borrow `self`, so it cannot overlap with the
            // `&self.config.id` borrow.
            // SAFETY: `vm_mut()` is the non-null process-static VM pointer.
            unsafe {
                if let Some(hot) = (*self.vm_mut()).hot_map() {
                    hot.remove(&self.config.id);
                }
            }
        }

        self.stop_listening(abrupt);
        self.deinit_if_we_can();
    }

    #[inline]
    pub fn deinit_if_we_can(&mut self) {
        httplog!(
            "deinitIfWeCan. requests={}, listener={}, websockets={}, has_handled_all_closed_promise={}, all_closed_promise={}, has_js_deinited={}",
            self.pending_requests,
            if self.listener.is_none() {
                "null"
            } else {
                "some"
            },
            if self.has_active_web_sockets() {
                "active"
            } else {
                "no"
            },
            self.flags
                .contains(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE),
            if self.all_closed_promise.has_value() {
                "has"
            } else {
                "no"
            },
            matches!(self.js_value, jsc::JsRef::Finalized),
        );

        let vm = self.vm_mut();

        if self.pending_requests == 0
            && !self.has_listener()
            && !self.has_active_web_sockets()
            && !self
                .flags
                .contains(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE)
            && self.all_closed_promise.has_value()
        {
            httplog!("schedule other promise");
            // use a flag here instead of `this.all_closed_promise.get().isHandled(vm)` to prevent the race condition of this block being called
            // again before the task has run.
            self.flags
                .insert(ServerFlags::HAS_HANDLED_ALL_CLOSED_PROMISE);

            let global = self.global_this();
            // SAFETY: `vm` is the process-static `*mut VirtualMachine` (non-null
            // for the server's lifetime); single-threaded JS context, no aliasing
            // `&mut`.
            let vm_ref = unsafe { &mut *vm };
            ServerAllConnectionsClosedTask::schedule(
                ServerAllConnectionsClosedTask {
                    global_object: self.global_this,
                    // Duplicate the Strong handle so that we can hold two independent strong references to it.
                    promise: jsc::JSPromiseStrong::from_value(
                        self.all_closed_promise.value(),
                        global,
                    ),
                    tracker: jsc::AsyncTaskTracker::init(vm_ref),
                },
                vm_ref,
            );
        }
        if self.pending_requests == 0 && !self.has_listener() && !self.has_active_web_sockets() {
            if let Some(ws) = self.config.websocket.as_mut() {
                ws.handler.app = None;
            }
            self.unref();

            // Detach DevServer. This is needed because there are aggressive
            // tests that check for DevServer memory soundness. Keeping the JS
            // binding alive should not pin `dev.memory_cost()` bytes.
            if let Some(dev) = self.dev_server.take() {
                if let Some(app) = self.app {
                    // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(app).clear_routes();
                }
                drop(dev); // dev.deinit()
            }

            // Only free the memory if the JS reference has been freed too.
            if matches!(self.js_value, jsc::JsRef::Finalized) {
                self.schedule_deinit();
            }
        }
    }

    pub fn schedule_deinit(&mut self) {
        if self.flags.contains(ServerFlags::DEINIT_SCHEDULED) {
            httplog!("scheduleDeinit (again)");
            return;
        }
        self.flags.insert(ServerFlags::DEINIT_SCHEDULED);
        httplog!("scheduleDeinit");

        // SAFETY: `vm_mut()` is the process-static `*mut VirtualMachine` (non-null
        // for the server's lifetime); single-threaded JS context, no aliasing `&mut`.
        let vm = unsafe { &mut *self.vm_mut() };

        if !self.flags.contains(ServerFlags::TERMINATED) {
            // App.close can cause finalizers to run.
            // scheduleDeinit can be called inside a finalizer.
            // Therefore, we split it into two tasks.
            self.flags.insert(ServerFlags::TERMINATED);
            // PORT NOTE: Zig `AnyTask.New(App, App.close).init(app)` — Rust
            // `AnyTask` stores an erased fn-ptr directly (the `New` shim cannot
            // take a comptime fn value on stable Rust).
            let app = self.app.unwrap();
            let task = bun_core::heap::into_raw(Box::new(bun_event_loop::AnyTask::AnyTask {
                ctx: core::ptr::NonNull::new(app.cast()),
                callback: |ctx: *mut core::ffi::c_void| {
                    // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(ctx.cast::<uws_sys::NewApp<SSL>>()).close();
                    Ok(())
                },
            }));
            vm.enqueue_task(bun_event_loop::Task::init(task));
        }

        let task = bun_core::heap::into_raw(Box::new(bun_event_loop::AnyTask::AnyTask {
            ctx: core::ptr::NonNull::new(std::ptr::from_mut::<Self>(self).cast()),
            callback: |ctx: *mut core::ffi::c_void| {
                Self::deinit(ctx.cast::<Self>());
                Ok(())
            },
        }));
        vm.enqueue_task(bun_event_loop::Task::init(task));
    }

    pub fn on_listen(&mut self, socket: Option<*mut uws_sys::app::ListenSocket<SSL>>) {
        let Some(socket) = socket else {
            return self.on_listen_failed();
        };
        self.listener = Some(socket);
        // SAFETY: `vm_mut()` is the process-static `*mut VirtualMachine` (non-null
        // for the server's lifetime); single-threaded JS context.
        unsafe { (*self.vm_mut()).event_loop_handle = Some(bun_io::Loop::get()) };
        if !SSL {
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            let fd = bun_opaque::opaque_deref_mut(socket).socket().fd();
            // SAFETY: `vm` is a STATIC ref (see `ServerLike::vm_mut`) — non-null
            // for the server's lifetime, so the raw→`&mut` deref is sound.
            unsafe { (*self.vm_mut()).add_listening_socket_for_watch_mode(fd) };
        }
    }

    /// Build the bind/listen failure as a `SystemError` (so JS sees
    /// `err.code`/`err.syscall`) and `globalThis.throwValue` it. The BoringSSL
    /// error-stack drain (server.zig:1847-1906) is still TODO; the EADDRINUSE/
    /// EACCES paths below cover the node:http `server.listen` error contract.
    #[cold]
    pub fn on_listen_failed(&mut self) {
        self.listener = None;
        let global = self.global_this();

        let error_instance = match &self.config.address {
            server_config::Address::Tcp { port, hostname } => {
                // Zig `Environment.isLinux` is `os.tag == .linux`, which is
                // also true for Android targets (Zig encodes Android as
                // linux+android-abi). Rust's `target_os = "linux"` excludes
                // Android, so match both explicitly.
                #[cfg(any(target_os = "linux", target_os = "android"))]
                if bun_sys::get_errno(-1i32) == bun_sys::E::EACCES {
                    let host = hostname
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
                match bun_sys::get_errno(-1i32) {
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

    pub fn on_h3_listen(&mut self, socket: Option<*mut uws_sys::h3::ListenSocket>) {
        if !Self::HAS_H3 {
            return;
        }
        let Some(socket) = socket else { return };
        // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
        let port = bun_opaque::opaque_deref_mut(socket).get_local_port();
        self.h3_listener = Some(socket);
        self.h3_alt_svc = format!("h3=\":{port}\"; ma=86400")
            .into_bytes()
            .into_boxed_slice();
        // PORT NOTE: spec increments `Analytics.Features.http3_server`; that
        // counter is not (yet) declared in `bun_analytics` (the Zig side
        // dropped it too — see analytics.zig). No-op until it is.
    }

    // ─── deinit ──────────────────────────────────────────────────────────────
    /// Tear down the uws app handles and free the boxed server. Only called
    /// from `schedule_deinit`'s task or synchronously on listen-failure.
    pub fn deinit(this: *mut Self) {
        httplog!("deinit");
        // SAFETY: `this` was heap-allocated in `init()` and is uniquely owned here.
        let this_ref = unsafe { &mut *this };

        // This should've already been handled in stop_listening; however, when
        // the JS VM terminates, it hypothetically might not call stop_listening.
        this_ref.notify_inspector_server_stopped();

        // PORT NOTE: owned-field cleanup (all_closed_promise / user_routes /
        // config / on_clienterror / h3_alt_svc / dev_server / plugins) is
        // handled by the heap::take drop below — see `impl Drop for NewServer`.
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

        // SAFETY: paired with heap::alloc in `init()`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn set_using_custom_expect_handler(&mut self, value: bool) {
        if let Some(app) = self.app {
            ffi::NodeHTTP_setUsingCustomExpectHandler(SSL, app.cast::<c_void>(), value);
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
        let base_url: Box<[u8]> = bun_core::trim(&config.base_uri, b"/")
            .to_vec()
            .into_boxed_slice();
        // errdefer free(base_url) — Box drops on Err automatically

        let server = bun_core::heap::into_raw(Box::new(Self {
            global_this: std::ptr::from_ref(global),
            // Set below, once the server has its final (stable) heap address.
            any_server_packed: 0,
            method_name_cache: [const { core::cell::Cell::new(JSValue::ZERO) }; N_HTTP_METHODS],
            config: core::mem::take(config),
            base_url_string_for_joining: base_url,
            vm: bun_ptr::BackRef::new(jsc::VirtualMachine::get()),
            dev_server: None,
            app: None,
            listener: None,
            h3_app: None,
            h3_listener: None,
            h3_alt_svc: Box::<[u8]>::default(),
            js_value: jsc::JsRef::empty(),
            pending_requests: 0,
            request_pool: <Self as ServerPools<SSL, DEBUG>>::request_pool(),
            // Zig gates this on `comptime has_h3` (server.zig:1827) so plain
            // HTTP servers never allocate the ~816 KB H3 pool. We go one step
            // further and defer to the H3-listen path (`listen()` below) so
            // HTTPS servers that don't enable `config.h3` don't pay either.
            h3_request_pool: core::ptr::null_mut(),
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
            inspector_server_id: jsc::DebuggerId::init(0),
        }));

        // The packed `AnyServer` is a pure function of the (now-stable) heap
        // address and the const variant tag; cache it so the per-request
        // `node:http` prologue is a plain field load instead of a tag match +
        // `TaggedPointer::init`.
        // SAFETY: `server` is the freshly-boxed `*mut Self`; uniquely owned here.
        unsafe {
            (*server).any_server_packed = AnyServer::from(server.cast_const()).to_packed() as usize;
        }

        // PORT NOTE: Zig captured `&config.bake.?` then did `.config = config.*`,
        // so the bake options (and the arena that backs `root`) live in
        // `(*server).config.bake` for the server's lifetime. Initialise
        // DevServer AFTER the server box exists so the `Options::arena` borrow
        // points into the heap-allocated config rather than the caller's
        // (since-moved) stack slot. `errdefer if (dev_server) |d| d.deinit()`
        // — `Box<Self>` drop on Err frees the half-built server.
        // SAFETY: `server` is the freshly-boxed `*mut Self`; uniquely owned here.
        if let Some(bake_options) = unsafe { &mut (*server).config.bake } {
            let broadcast = unsafe {
                (*server)
                    .config
                    .broadcast_console_log_from_browser_to_server_for_bake
            };
            let dev = match crate::bake::DevServer::init(crate::bake::DevServer::Options {
                arena: &bake_options.arena,
                root: bake_options.root,
                // SAFETY: per-thread VM singleton; STATIC lifetime.
                vm: jsc::VirtualMachine::get(),
                // LAYERING: `UserOptions` carries the `bake_body` shapes;
                // `DevServer::Options` consumes the keystone shapes. In Zig
                // these are one type — `From` impls in `bake/mod.rs` bridge
                // until the duplicates are collapsed.
                framework: core::mem::take(&mut bake_options.framework).into(),
                bundler_options: core::mem::take(&mut bake_options.bundler_options).into(),
                broadcast_console_log_from_browser_to_server: broadcast,
                dump_sources: crate::bake::DevServer::Options::DEFAULT_DUMP_SOURCES,
                dump_state_on_crash: None,
            }) {
                Ok(d) => d,
                Err(e) => {
                    // SAFETY: paired with heap::alloc above.
                    drop(unsafe { bun_core::heap::take(server) });
                    return Err(e);
                }
            };
            // SAFETY: `server` is uniquely owned here.
            unsafe { (*server).dev_server = Some(dev) };
        }

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
    fn set_routes(&mut self) -> JSValue {
        use bun_http_types::Method as http_method;
        let mut route_list_value = JSValue::ZERO;
        // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        // set_routes is only called after `self.app = Some(..)` in listen().
        let app = bun_opaque::opaque_deref_mut(self.app.unwrap());
        let self_ptr: *mut Self = self;
        let any_server = AnyServer::from(self_ptr.cast_const());
        // PORT NOTE: reshaped for borrowck — `dev_server` is `Option<Box<..>>`;
        // snapshot the raw `*mut DevServer` so per-iteration `&mut` derives
        // don't conflict with `&mut self.config` / `&mut self.user_routes`.
        let dev_server: Option<*mut crate::bake::DevServer::DevServer> = self
            .dev_server
            .as_deref_mut()
            .map(|d| std::ptr::from_mut(d));

        // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
        // Only enable this when we're using the dev server.
        let mut should_add_chrome_devtools_json_route = DEBUG
            && self.config.allow_hot
            && dev_server.is_some()
            && self
                .config
                .enable_chrome_devtools_automatic_workspace_folders;
        const CHROME_DEVTOOLS_ROUTE: &[u8] = b"/.well-known/appspecific/com.chrome.devtools.json";

        // --- 1. user_routes_to_build → user_routes + RouteList JS object ---
        if !self.config.user_routes_to_build.is_empty() {
            let mut to_build = core::mem::take(&mut self.config.user_routes_to_build);
            let len = to_build.len();
            let _old = core::mem::replace(&mut self.user_routes, Vec::with_capacity(len));
            // Scratch arrays for the C++ factory. `ZigString` borrows the
            // route-path heap bytes; those bytes move (by pointer) into
            // `self.user_routes` below and stay live across the FFI call.
            let mut paths: Vec<bun_core::ZigString> = Vec::with_capacity(len);
            let mut callbacks: Vec<JSValue> = Vec::with_capacity(len);
            for (i, builder) in to_build.iter_mut().enumerate() {
                paths.push(bun_core::ZigString::init(builder.route.path.as_bytes()));
                callbacks.push(builder.callback.get());
                self.user_routes.push(UserRoute {
                    id: i as u32,
                    server: self_ptr,
                    route: core::mem::take(&mut builder.route),
                });
            }
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
            // C++ factory has re-rooted them inside the RouteList object,
            // matching server.zig's `for (..) builder.deinit()` ordering.
            drop(to_build);
        }

        // --- 2. WebSocket handler app reference ---
        if let Some(websocket) = self.config.websocket.as_mut() {
            websocket.global_object = self.global_this;
            websocket.handler.app = Some(std::ptr::from_mut(app).cast::<c_void>());
            websocket
                .handler
                .flags
                .set(web_socket_server_context::HandlerFlags::SSL, SSL);
        }

        // --- 3. Register compiled user routes & track "/*" coverage ---
        let mut star_methods_covered_by_user = http_method::Set::empty();
        let mut has_any_user_route_for_star_path = false;
        let mut has_any_ws_route_for_star_path = false;

        // PORT NOTE: reshaped for borrowck — `app.ws(..)` reads `to_behavior()`
        // (borrows `self.config.websocket`) while iterating `self.user_routes`.
        // Snapshot as a `BackRef` (pointee = `self.config.websocket`, which is
        // pinned in the server allocation and outlives every use below — the
        // BackRef invariant) so the two `&mut self.*` accesses do not overlap
        // from rustc's POV. Replaces the `Option<*mut _>` + per-site
        // `unsafe { &*p }` pattern with one safe accessor.
        let websocket_ptr: Option<bun_ptr::BackRef<WebSocketServerContext>> =
            self.config.websocket.as_ref().map(bun_ptr::BackRef::new);

        for user_route in self.user_routes.iter_mut() {
            let ud: *mut c_void = std::ptr::from_mut::<UserRoute<SSL, DEBUG>>(user_route).cast();
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
                    app.any(
                        path,
                        Some(trampoline::on_user_route_request::<SSL, DEBUG>),
                        ud,
                    );
                    if Self::HAS_H3 {
                        if let Some(h3_app) = self.h3_app {
                            // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                            bun_opaque::opaque_deref_mut(h3_app).any(
                                path,
                                ud.cast::<UserRoute<SSL, DEBUG>>(),
                                Self::on_h3_user_route_request,
                            );
                        }
                    }
                    if is_star_path {
                        star_methods_covered_by_user = http_method::Set::all();
                    }
                    if let Some(websocket) = websocket_ptr {
                        if is_star_path {
                            has_any_ws_route_for_star_path = true;
                        }
                        app.ws(
                            path,
                            ud,
                            1, // id 1 means is a user route
                            ServerWebSocket::behavior::<Self, SSL>(websocket.to_behavior()),
                        );
                    }
                }
                server_config::RouteMethod::Specific(method_val) => {
                    app.method(
                        method_val,
                        path,
                        Some(trampoline::on_user_route_request::<SSL, DEBUG>),
                        ud,
                    );
                    if Self::HAS_H3 {
                        if let Some(h3_app) = self.h3_app {
                            // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                            bun_opaque::opaque_deref_mut(h3_app).method(
                                method_val,
                                path,
                                ud.cast::<UserRoute<SSL, DEBUG>>(),
                                Self::on_h3_user_route_request,
                            );
                        }
                    }
                    if is_star_path {
                        star_methods_covered_by_user.insert(method_val);
                    }
                    // Setup user websocket in the route if needed.
                    if let Some(websocket) = websocket_ptr {
                        // Websocket upgrade is a GET request
                        if method_val == http_method::Method::GET {
                            app.ws(
                                path,
                                ud,
                                1, // id 1 means is a user route
                                ServerWebSocket::behavior::<Self, SSL>(websocket.to_behavior()),
                            );
                        }
                    }
                }
            }
        }

        // --- 4. Register negative routes ---
        for route_path in self.config.negative_routes.iter() {
            let p = route_path.as_bytes();
            app.head(
                p,
                Some(trampoline::on_request::<SSL, DEBUG>),
                self_ptr.cast(),
            );
            app.any(
                p,
                Some(trampoline::on_request::<SSL, DEBUG>),
                self_ptr.cast(),
            );
            if Self::HAS_H3 {
                if let Some(h3_app) = self.h3_app {
                    // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                    let h3_app = bun_opaque::opaque_deref_mut(h3_app);
                    h3_app.head(p, self_ptr, Self::on_h3_request);
                    h3_app.any(p, self_ptr, Self::on_h3_request);
                }
            }
        }

        // --- 5. Register static routes & track "/*" coverage ---
        let mut needs_plugins = dev_server.is_some();
        let mut has_static_route_for_star_path = false;

        for entry in &self.config.static_routes {
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

            match &entry.route {
                AnyRoute::Static(p) => {
                    server_config::apply_static_route::<SSL, StaticRoute>(
                        any_server,
                        app,
                        p.as_ptr(),
                        &entry.path,
                        entry.method,
                    );
                    if Self::HAS_H3 {
                        if let Some(h3_app) = self.h3_app {
                            server_config::apply_static_route_h3::<StaticRoute>(
                                any_server,
                                // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                                bun_opaque::opaque_deref_mut(h3_app),
                                p.as_ptr(),
                                &entry.path,
                                entry.method,
                            );
                        }
                    }
                }
                AnyRoute::File(p) => {
                    server_config::apply_static_route::<SSL, FileRoute>(
                        any_server,
                        app,
                        p.as_ptr(),
                        &entry.path,
                        entry.method,
                    );
                    if Self::HAS_H3 {
                        if let Some(h3_app) = self.h3_app {
                            server_config::apply_static_route_h3::<FileRoute>(
                                any_server,
                                // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                                bun_opaque::opaque_deref_mut(h3_app),
                                p.as_ptr(),
                                &entry.path,
                                entry.method,
                            );
                        }
                    }
                }
                AnyRoute::Html(r) => {
                    server_config::apply_static_route::<SSL, html_bundle::Route>(
                        any_server,
                        app,
                        r.as_ptr(),
                        &entry.path,
                        entry.method,
                    );
                    if Self::HAS_H3 {
                        if let Some(h3_app) = self.h3_app {
                            server_config::apply_static_route_h3::<html_bundle::Route>(
                                any_server,
                                // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                                bun_opaque::opaque_deref_mut(h3_app),
                                r.as_ptr(),
                                &entry.path,
                                entry.method,
                            );
                        }
                    }
                    if let Some(dev) = dev_server {
                        // SAFETY: `dev` is the live `*mut DevServer` snapshotted
                        // from `self.dev_server` above; no other `&mut` to it
                        // is live in this loop.
                        bun_core::handle_oom(
                            unsafe { &mut *dev }
                                .html_router
                                .put(&entry.path, r.as_ptr()),
                        );
                    }
                    needs_plugins = true;
                }
                AnyRoute::FrameworkRouter(_) => {}
            }
        }

        // --- 6. Initialize plugins if needed ---
        if needs_plugins && self.plugins.is_none() {
            // SAFETY: `vm_mut()` is the process-static `*mut VirtualMachine`
            // (non-null for the server's lifetime); single-threaded JS context.
            // PORT NOTE: Zig reads `serve_plugins` by reference (server.zig:2917);
            // cloning here (not `.take()`) so subsequent `Bun.serve()` calls in
            // the same process — and `DevServer`'s tailwind-hack probe of the
            // same field — still see the bunfig-configured plugin list.
            if let Some(serve_plugins_config) = jsc::VirtualMachine::get()
                .transpiler
                .options
                .serve_plugins
                .as_ref()
            {
                if !serve_plugins_config.is_empty() {
                    self.plugins =
                        core::ptr::NonNull::new(ServePlugins::init(serve_plugins_config.clone()))
                            .map(bun_ptr::BackRef::from);
                }
            }
        }

        // --- 7. Debug-mode specific routes ---
        if DEBUG {
            app.get(
                b"/bun:info",
                Some(trampoline::on_bun_info_request::<SSL, DEBUG>),
                self_ptr.cast(),
            );
        }

        // Snapshot "/*" coverage from user/static routes before DevServer
        // (which is H1-only and not mirrored to the H3 router) marks it full.
        let h3_star_covered = star_methods_covered_by_user;

        // --- 8. Handle DevServer routes & track "/*" coverage ---
        let mut has_dev_server_for_star_path = false;
        if let Some(dev) = dev_server {
            // dev.setRoutes might register its own "/*" HTTP handler
            // SAFETY: `dev` is the live `*mut DevServer` snapshotted from
            // `self.dev_server` above; `self_ptr` is the live server. The two
            // allocations are disjoint so the `&mut` borrows do not alias.
            has_dev_server_for_star_path = bun_core::handle_oom(
                unsafe { &mut *dev }.set_routes::<SSL, DEBUG>(unsafe { &mut *self_ptr }),
            );
            if has_dev_server_for_star_path {
                // Assume dev server "/*" covers all methods if it exists
                star_methods_covered_by_user = http_method::Set::all();
            }
        }

        // Setup user websocket fallback route aka fetch function; if fetch is
        // not provided will respond with 403.
        if !has_any_ws_route_for_star_path {
            if let Some(websocket) = websocket_ptr {
                app.ws(
                    b"/*",
                    self_ptr.cast(),
                    0, // id 0 means is a fallback route and ctx is the server
                    ServerWebSocket::behavior::<Self, SSL>(websocket.to_behavior()),
                );
            }
        }

        // --- 9. Consolidated "/*" HTTP fallback registration ---
        let ud = self_ptr.cast::<c_void>();
        let has_node_http = self.config.on_node_http_request.is_some();
        let has_on_request = self.config.on_request.is_some();
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
                if has_node_http {
                    app.method(
                        method_to_cover,
                        b"/*",
                        Some(trampoline::on_node_http_request::<SSL, DEBUG>),
                        ud,
                    );
                } else if has_on_request {
                    app.method(
                        method_to_cover,
                        b"/*",
                        Some(trampoline::on_request::<SSL, DEBUG>),
                        ud,
                    );
                } else {
                    app.method(
                        method_to_cover,
                        b"/*",
                        Some(trampoline::on_404::<SSL, DEBUG>),
                        ud,
                    );
                }
            }
        } else if has_node_http {
            app.any(
                b"/*",
                Some(trampoline::on_node_http_request::<SSL, DEBUG>),
                ud,
            );
        } else if has_on_request {
            app.any(b"/*", Some(trampoline::on_request::<SSL, DEBUG>), ud);
        } else {
            app.any(b"/*", Some(trampoline::on_404::<SSL, DEBUG>), ud);
        }

        // H3 fallback — same three-way as H1 above, but driven by user/static
        // "/*" coverage only (DevServer routes are not mirrored to H3).
        if Self::HAS_H3 {
            if let Some(h3_app) = self.h3_app {
                // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                let h3_app = bun_opaque::opaque_deref_mut(h3_app);
                if h3_star_covered == http_method::Set::all() {
                    // user/static "/*" already covers every method
                } else if has_any_user_route_for_star_path || has_static_route_for_star_path {
                    for m in !h3_star_covered {
                        if has_on_request {
                            h3_app.method(m, b"/*", self_ptr, Self::on_h3_request);
                        } else {
                            h3_app.method(m, b"/*", self_ptr, Self::on_h3_404);
                        }
                    }
                } else if has_on_request {
                    h3_app.any(b"/*", self_ptr, Self::on_h3_request);
                } else {
                    h3_app.any(b"/*", self_ptr, Self::on_h3_404);
                }
            }
        }

        if should_add_chrome_devtools_json_route {
            app.get(
                CHROME_DEVTOOLS_ROUTE,
                Some(trampoline::on_chrome_devtools_json_request::<SSL, DEBUG>),
                ud,
            );
        }

        // If onNodeHTTPRequest is configured, it might be needed for Node.js
        // compatibility layer for specific Node API routes, even if it's not
        // the main "/*" handler.
        if has_node_http {
            ffi::NodeHTTP_assignOnNodeJSCompat(SSL, std::ptr::from_mut(app).cast::<c_void>());
        }

        route_list_value
    }

    // ─── listen ──────────────────────────────────────────────────────────────
    /// Create the uws `App<SSL>` (and optional H3 app), register routes via
    /// `set_routes()`, and bind the listen socket. On any failure the server
    /// is `deinit()`ed synchronously and `.zero` is returned with an exception
    /// pending on `global_this`.
    // TODO(port): make this return JsResult<JSValue> and let the caller errdefer-deinit.
    pub fn listen(this: *mut Self) -> JSValue
    where
        Self: ServerPools<SSL, DEBUG>,
    {
        httplog!("listen");
        // PORT NOTE: reshaped for borrowck (PORTING.md §Forbidden — aliased
        // `&mut`). No long-lived `&mut Self` is held across re-derives from
        // `this`; each use site reborrows fresh and the borrow ends before the
        // next derive. The serverName / SNI loop extracts raw `(ptr, len)` so
        // no `&self.config` outlives the per-domain `set_routes()` call.
        //
        // SAFETY (applies to every `&mut *this` below): `this` was produced by
        // `init()` and is live for this call; only one reference derived from
        // it is alive at a time. Read-only access goes through `this_ref`
        // (`BackRef<Self>`) — each `Deref` materialises a fresh short-lived
        // `&Self` from the same raw provenance, so the listen-trampoline /
        // `set_routes()` `&mut *this` re-derives never overlap an outstanding
        // shared borrow.
        let this_ref = bun_ptr::BackRef::from(
            core::ptr::NonNull::new(this).expect("listen: this non-null (from init())"),
        );

        // `global_this()` returns a borrow of the separate STATIC allocation,
        // not `*this`.
        let global = this_ref.global_this();

        let app: *mut uws_sys::NewApp<SSL>;
        let mut route_list_value = JSValue::ZERO;

        if SSL {
            bun_boringssl::load();
            let Some(ssl_options) = this_ref.config.ssl_config.as_ref().map(|c| c.as_usockets())
            else {
                // unreachable in practice — fromJS guarantees ssl_config when SSL.
                let _ = global.throw(format_args!(
                    "Failed to create HTTPS server: missing tls config"
                ));
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

            if Self::HAS_H3 && this_ref.config.h3 {
                let idle_timeout = this_ref.config.idle_timeout as u32;
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
                // SAFETY: `this` is the live boxed server; uniquely owned here.
                unsafe {
                    (*this).h3_app = h3;
                    // Lazily materialize the ~816 KB H3 request pool now that
                    // we know an H3 listener will actually exist (Zig:
                    // server.zig:1827-1836, gated on `comptime has_h3`).
                    (*this).h3_request_pool = <Self as ServerPools<SSL, DEBUG>>::h3_request_pool();
                }
            }

            route_list_value = unsafe { &mut *this }.set_routes();

            // add serverName to the SSL context using the default ssl options
            // PORT NOTE: extract raw (ptr, len) so no `&self.config` borrow
            // outlives the `set_routes()` call below. set_routes() does not
            // touch `config.ssl_config`, so the bytes remain valid.
            let server_name_raw = this_ref
                .config
                .ssl_config
                .as_ref()
                .and_then(|c| c.server_name_cstr())
                .filter(|n| !n.to_bytes().is_empty())
                .map(|n| (n.as_ptr(), n.to_bytes().len()));
            if let Some((name_ptr, name_len)) = server_name_raw {
                // SAFETY: name_ptr/name_len were just extracted from the live
                // `config.ssl_config.server_name` CString; valid + NUL-terminated.
                let server_name = unsafe { bun_core::ffi::cstr(name_ptr) };
                // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                if bun_opaque::opaque_deref_mut(app)
                    .add_server_name_with_options(server_name, ssl_options)
                    .is_err()
                {
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
                // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                bun_opaque::opaque_deref_mut(app).domain(z);
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
            let sni_len = this_ref.config.sni.as_ref().map_or(0, |s| s.slice().len());
            for i in 0..sni_len {
                let (name_ptr, name_len, sni_opts) = {
                    let cfg = this_ref.get();
                    let sni_ssl_config = &cfg.config.sni.as_ref().unwrap().slice()[i];
                    let Some(sni_name) = sni_ssl_config.server_name_cstr() else {
                        continue;
                    };
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
                let sni_name = unsafe { bun_core::ffi::cstr(name_ptr) };
                // SAFETY: sni_name is a CStr; NUL invariant holds for ZStr.
                let z = unsafe { bun_core::ZStr::from_raw(name_ptr.cast(), name_len) };

                if Self::HAS_H3 {
                    if let Some(h3_app) = this_ref.h3_app {
                        // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                        if bun_opaque::opaque_deref_mut(h3_app)
                            .add_server_name_with_options(z, sni_opts)
                            .is_err()
                        {
                            if !global.has_exception() {
                                let _ = global.throw(format_args!(
                                    "Failed to add serverName \"{}\" for HTTP/3",
                                    bstr::BStr::new(sni_name.to_bytes())
                                ));
                            }
                            Self::deinit(this);
                            return JSValue::ZERO;
                        }
                    }
                }
                // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                if bun_opaque::opaque_deref_mut(app)
                    .add_server_name_with_options(sni_name, sni_opts)
                    .is_err()
                {
                    if !global.has_exception() && !throw_ssl_error_if_necessary(global) {
                        let _ = global.throw(format_args!(
                            "Failed to add serverName: {}",
                            bstr::BStr::new(sni_name.to_bytes())
                        ));
                    }
                    Self::deinit(this);
                    return JSValue::ZERO;
                }
                // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                bun_opaque::opaque_deref_mut(app).domain(z);
                if throw_ssl_error_if_necessary(global) {
                    Self::deinit(this);
                    return JSValue::ZERO;
                }
                let _ = unsafe { &mut *this }.set_routes();
            }
        } else {
            app = match uws_sys::NewApp::<SSL>::create(uws_sys::BunSocketContextOptions::default())
            {
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

        if this_ref.config.on_node_http_request.is_some() {
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
        // The raw pointers reference `config.address`'s backing storage,
        // which the trampolines never touch (they only write `listener`/
        // `h3_listener`), so the bytes remain valid through the listen calls.
        enum Addr {
            Tcp { port: u16, host: *const c_char },
            Unix { ptr: *const u8, len: usize },
        }
        let (addr, h1, options) = {
            let cfg = &this_ref.get().config;
            let addr = match &cfg.address {
                server_config::Address::Tcp { port, hostname } => {
                    let mut host: *const c_char = core::ptr::null();
                    if let Some(existing) = hostname.as_deref() {
                        let bytes = existing.as_bytes();
                        if bytes.len() > 2 && bytes[0] == b'[' {
                            // strip "[" and "]" from IPv6 literal
                            let inner = &bytes[1..bytes.len() - 1];
                            host_buff[..inner.len()].copy_from_slice(inner);
                            host_buff[inner.len()] = 0;
                            host = host_buff.as_ptr().cast::<c_char>();
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
                // diverges from Zig: makes port:0 reliable for H3.
                // With `{port: 0, h3: true}` we bind TCP:0 (kernel picks N),
                // then must bind UDP:N for QUIC so Alt-Svc works. UDP:N may
                // already be held by an unrelated process. When the user asked
                // for "any port" (0), close TCP:N and retry the whole TCP+UDP
                // bind so the kernel picks a fresh N. Never retry a
                // user-specified non-zero port.
                let max_attempts: u8 = if Self::HAS_H3 && h1 && port == 0 {
                    3
                } else {
                    1
                };
                let mut attempt: u8 = 0;
                loop {
                    attempt += 1;
                    if h1 {
                        // SAFETY: app is a live uws handle owned by this server. No
                        // `&*this` is live across this call; the trampoline's
                        // `&mut *this` is the sole borrow while it runs.
                        unsafe {
                            (*app).listen_with_config(
                                Some(trampoline::on_listen::<SSL, DEBUG>),
                                this.cast::<c_void>(),
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
                        if let Some(h3_app) = this_ref.h3_app {
                            // Same UDP port as the TCP listener so Alt-Svc works.
                            let h3_port: u16 = match this_ref.listener {
                                // SAFETY: ls is a live uws ListenSocket FFI handle
                                // (just set by on_listen).
                                Some(ls) => {
                                    bun_opaque::opaque_deref_mut(ls).get_local_port() as u16
                                }
                                None => port,
                            };
                            // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                            // No `&*this` is live across this call; the h3
                            // trampoline's `&mut *this` is the sole borrow while it
                            // runs (the closure is capture-less).
                            bun_opaque::opaque_deref_mut(h3_app).listen_with_config(
                                this,
                                |s: &mut Self, ls: Option<&mut uws_sys::h3::ListenSocket>| {
                                    s.on_h3_listen(ls.map(|l| std::ptr::from_mut(l)));
                                },
                                uws_sys::h3::ListenConfig {
                                    port: h3_port,
                                    host,
                                    options,
                                },
                            );
                            // Re-derive: `h3_listener` was just written by `on_h3_listen`.
                            if this_ref.h3_listener.is_none() {
                                if attempt < max_attempts {
                                    // UDP:N is taken — release TCP:N so the next
                                    // attempt gets a fresh kernel-chosen port.
                                    // Only retry if TCP actually succeeded.
                                    if let Some(ls) = unsafe { (*this).listener.take() } {
                                        bun_opaque::opaque_deref_mut(ls).close();
                                        continue;
                                    }
                                }
                                if !global.has_exception() {
                                    let _ = global.throw(format_args!(
                                        "Failed to listen on UDP port {h3_port} for HTTP/3"
                                    ));
                                    // post-match `has_exception()` check below handles
                                    // deinit + return ZERO.
                                }
                            }
                            if !this_ref.config.h1 {
                                // SAFETY: per-thread VM singleton; no aliasing `&mut`.
                                jsc::VirtualMachine::get().as_mut().event_loop_handle =
                                    Some(bun_io::Loop::get());
                            }
                        }
                    }
                    break;
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
                // SAFETY: ptr/len reference `config.address`'s ZBox; NUL
                // sentinel at `ptr[len]` holds for ZStr::from_raw.
                let z = unsafe { bun_core::ZStr::from_raw(ptr, len) };
                // SAFETY: app is a live uws handle owned by this server. No
                // `&*this` is live across this call.
                unsafe {
                    (*app).listen_on_unix_socket(
                        trampoline::on_listen_unix::<SSL, DEBUG>,
                        this.cast::<c_void>(),
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
        let vm = this_ref.vm();
        if vm.aggressive_garbage_collection == jsc::virtual_machine::GCLevel::Aggressive {
            vm.auto_garbage_collect();
        } else {
            // SAFETY: event_loop() returns the VM's owned `*mut EventLoop`;
            // non-null while the VM is alive.
            vm.event_loop_ref().perform_gc();
        }

        route_list_value
    }
}

// ─── route-list codegen externs ──────────────────────────────────────────────
// Canonical decls live in `server_body.rs` (shared with the H3 path); reuse
// them here instead of redeclaring with a divergent `req` pointer type.
use server_body::{Bun__ServerRouteList__callRoute, Bun__ServerRouteList__create};

/// Per-type cached-accessor shims for the `routeList` `WriteBarrier` slot.
/// `codegen_cached_accessors!` emits `route_list_{get,set}_cached` wrapping
/// `${T}Prototype__routeList{Get,Set}CachedValue` (generate-classes.ts).
mod route_list_cached {
    pub mod http {
        bun_jsc::codegen_cached_accessors!("HTTPServer"; routeList);
    }
    pub mod https {
        bun_jsc::codegen_cached_accessors!("HTTPSServer"; routeList);
    }
    pub mod debug_http {
        bun_jsc::codegen_cached_accessors!("DebugHTTPServer"; routeList);
    }
    pub mod debug_https {
        bun_jsc::codegen_cached_accessors!("DebugHTTPSServer"; routeList);
    }
}

// ─── extern "C" trampolines ──────────────────────────────────────────────────
// Zig generated these per (UserData, handler) pair at comptime via
// `RouteHandler(..)`. Rust monomorphizes on the const-generic server params
// instead; the bodies downcast `user_data` and forward into the typed method.
mod trampoline {
    use super::*;
    use bun_uws_sys::{ListenSocket as UwsListenSocket, Request as UwsRequest, uws_res};

    pub extern "C" fn on_listen<const SSL: bool, const DEBUG: bool>(
        socket: *mut UwsListenSocket,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut NewServer<..>` passed to listen_with_config.
        let server = unsafe { bun_ptr::callback_ctx::<NewServer<SSL, DEBUG>>(user_data) };
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
        // S008: `Response<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        let resp = bun_opaque::opaque_deref_mut(res.cast::<uws_sys::NewAppResponse<SSL>>());
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    pub extern "C" fn on_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // user_data is the `*mut NewServer<..>` registered in set_routes.
        // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
        NewServer::<SSL, DEBUG>::on_request(
            user_data.cast(),
            bun_opaque::opaque_deref_mut(req),
            res.cast(),
        );
    }

    pub extern "C" fn on_user_route_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // user_data is the `*mut UserRoute<..>` registered in set_routes.
        // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
        NewServer::<SSL, DEBUG>::on_user_route_request(
            user_data.cast::<UserRoute<SSL, DEBUG>>(),
            bun_opaque::opaque_deref_mut(req),
            res.cast(),
        );
    }

    pub extern "C" fn on_node_http_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // user_data is the `*mut NewServer<..>` registered in set_routes.
        // S008: `Request` / `Response<SSL>` are ZST opaques — safe deref.
        NewServer::<SSL, DEBUG>::on_node_http_request(
            user_data.cast(),
            bun_opaque::opaque_deref_mut(req),
            bun_opaque::opaque_deref_mut(res.cast::<uws_sys::NewAppResponse<SSL>>()),
        );
    }

    pub extern "C" fn on_bun_info_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut NewServer<..>` registered in set_routes.
        // S008: `Request` / `Response<SSL>` are ZST opaques — safe deref.
        unsafe {
            (*user_data.cast::<NewServer<SSL, DEBUG>>()).on_bun_info_request(
                bun_opaque::opaque_deref_mut(req),
                bun_opaque::opaque_deref_mut(res.cast::<uws_sys::NewAppResponse<SSL>>()),
            )
        };
    }

    pub extern "C" fn on_chrome_devtools_json_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut NewServer<..>` registered in set_routes.
        // S008: `Request` / `Response<SSL>` are ZST opaques — safe deref.
        unsafe {
            (*user_data.cast::<NewServer<SSL, DEBUG>>()).on_chrome_dev_tools_json_request(
                bun_opaque::opaque_deref_mut(req),
                bun_opaque::opaque_deref_mut(res.cast::<uws_sys::NewAppResponse<SSL>>()),
            )
        };
    }
}

// ─── per-monomorphization request pools ──────────────────────────────────────
// Zig: `pub threadlocal var pool: ?*RequestContextStackAllocator = null` per
// `NewRequestContext(..)` instantiation. Rust generics cannot own statics, so
// declare one `thread_local!` per concrete (SSL, DEBUG, H3) combo via macro and
// hand the leaked pointer back through a trait.
//
// THREAD-SAFETY: this MUST be thread-local, not process-global. `hive_array::
// Fallback::{get,put,claim}` take `&mut self` with no internal synchronization;
// a process-static would race when two `Bun.serve` instances run on distinct
// Worker threads (each Worker has its own event loop and may host a server).
// The Zig spec used `threadlocal` for exactly this reason — preserve it.
pub trait ServerPools<const SSL: bool, const DEBUG: bool>: Sized {
    fn request_pool() -> *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, false>;
    fn h3_request_pool()
    -> *mut request_context::RequestContextStackAllocator<Self, SSL, DEBUG, true>;
}

macro_rules! impl_server_pools {
    ($(($ssl:literal, $debug:literal)),* $(,)?) => {$(
        impl ServerPools<$ssl, $debug> for NewServer<$ssl, $debug> {
            fn request_pool() -> *mut request_context::RequestContextStackAllocator<Self, $ssl, $debug, false> {
                type Pool = request_context::RequestContextStackAllocator<NewServer<$ssl, $debug>, $ssl, $debug, false>;
                thread_local! {
                    // Zig: `threadlocal var pool: ?*RequestContextStackAllocator = null`
                    static POOL: core::cell::Cell<*mut Pool> =
                        const { core::cell::Cell::new(core::ptr::null_mut()) };
                }
                POOL.with(|cell| {
                    let mut p = cell.get();
                    if p.is_null() {
                        // `Box::new(Pool::init())` builds the ~816 KB pool on
                        // the stack and `memcpy`s it into the heap (no NRVO);
                        // `new_boxed` writes only the 256 B bitset in place.
                        p = Pool::new_boxed().as_ptr();
                        cell.set(p);
                    }
                    p
                })
            }
            fn h3_request_pool() -> *mut request_context::RequestContextStackAllocator<Self, $ssl, $debug, true> {
                type Pool = request_context::RequestContextStackAllocator<NewServer<$ssl, $debug>, $ssl, $debug, true>;
                thread_local! {
                    static POOL: core::cell::Cell<*mut Pool> =
                        const { core::cell::Cell::new(core::ptr::null_mut()) };
                }
                POOL.with(|cell| {
                    let mut p = cell.get();
                    if p.is_null() {
                        p = Pool::new_boxed().as_ptr();
                        cell.set(p);
                    }
                    p
                })
            }
        }
    )*};
}
impl_server_pools!((false, false), (true, false), (false, true), (true, true));

// ─── FFI ─────────────────────────────────────────────────────────────────────
mod ffi {
    use super::*;
    // `*mut *mut NodeHTTPResponse` is an out-param: C++ writes back the
    // Rust-allocated pointer (via `NodeHTTPResponse__createForJS`) without ever
    // dereferencing the struct itself. The ctypes lint fires because the struct
    // has Rust-layout fields (Vec, Cell, …); irrelevant for an opaque handle.
    #[allow(improper_ctypes)]
    unsafe extern "C" {
        // `app` is the opaque `uws::App<SSL>*`; C++ only flips a flag / assigns a
        // handler. Callers pass the live `self.app` handle, so no precondition.
        pub safe fn NodeHTTP_setUsingCustomExpectHandler(ssl: bool, app: *mut c_void, value: bool);
        pub safe fn NodeHTTP_assignOnNodeJSCompat(ssl: bool, app: *mut c_void);

        /// `src/jsc/bindings/NodeHTTP.cpp` — constructs the JS
        /// `IncomingMessage`/`ServerResponse` pair, allocates a
        /// [`NodeHTTPResponse`] (returned via `node_response_ptr` with one ref
        /// taken), and invokes `callback(req, res)`. The plain-HTTP and HTTPS
        /// monomorphizations differ only in the `Response<SSL>` opaque type.
        ///
        /// `&JSGlobalObject` / `&mut *mut _` discharge the deref'd-param
        /// preconditions; `request`/`response`/`upgrade_ctx` are opaque uws
        /// handles (module-private — sole caller passes live pointers).
        pub safe fn NodeHTTPServer__onRequest_http(
            any_server: usize,
            global: &jsc::JSGlobalObject,
            this_value: jsc::JSValue,
            callback: jsc::JSValue,
            method_string: jsc::JSValue,
            request: *mut uws_sys::Request,
            response: *mut c_void, // *uws.NewApp(false).Response
            upgrade_ctx: *mut c_void,
            node_response_ptr: &mut *mut NodeHTTPResponse,
        ) -> jsc::JSValue;

        pub safe fn NodeHTTPServer__onRequest_https(
            any_server: usize,
            global: &jsc::JSGlobalObject,
            this_value: jsc::JSValue,
            callback: jsc::JSValue,
            method_string: jsc::JSValue,
            request: *mut uws_sys::Request,
            response: *mut c_void, // *uws.NewApp(true).Response
            upgrade_ctx: *mut c_void,
            node_response_ptr: &mut *mut NodeHTTPResponse,
        ) -> jsc::JSValue;
    }
}

/// Drain the BoringSSL error queue; if non-empty, throw the top error on
/// `global` and return true. Mirrors `throwSSLErrorIfNecessary` in server.zig.
fn throw_ssl_error_if_necessary(global: &JSGlobalObject) -> bool {
    let err_code = bun_boringssl_sys::ERR_get_error();
    if err_code != 0 {
        let _ = global.throw_value(crate::crypto::create_crypto_error(global, err_code));
        // PORT NOTE: Zig had `defer ERR_clear_error()`; no early return
        // between there and here, so a tail call is equivalent.
        bun_boringssl_sys::ERR_clear_error();
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
    // These trait-method forwards are on the per-request hot path (called via
    // `RequestContext::server.vm()` etc.). Without `#[inline]` a generic trait
    // impl is not eligible for cross-crate inlining at all, so each accessor
    // would compile to a real `call` even though the inherent method it
    // forwards to is itself one instruction. Zig has no trait layer here.
    #[inline(always)]
    fn global_this(&self) -> &jsc::JSGlobalObject {
        Self::global_this(self)
    }
    #[inline(always)]
    fn vm(&self) -> &jsc::VirtualMachine {
        Self::vm(self)
    }
    #[inline(always)]
    fn vm_mut(&self) -> *mut jsc::VirtualMachine {
        Self::vm_mut(self)
    }
    #[inline(always)]
    fn config(&self) -> &ServerConfig {
        &self.config
    }
    #[inline]
    fn on_request_complete(&mut self) {
        Self::on_request_complete(self)
    }
    #[inline]
    fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> {
        self.dev_server.as_deref()
    }
    #[inline(always)]
    fn js_value(&self) -> &jsc::JsRef {
        &self.js_value
    }
    #[inline]
    fn h3_alt_svc(&self) -> Option<&[u8]> {
        Self::h3_alt_svc(self)
    }
    #[inline(always)]
    fn terminated(&self) -> bool {
        self.flags.contains(ServerFlags::TERMINATED)
    }
    fn release_request_context(&self, ctx: *mut c_void, is_h3: bool) {
        // SAFETY: ctx was allocated from this exact pool by `prepare_js_request_context`;
        // it is `RequestContext<Self, SSL, DEBUG, is_h3>` by construction.
        unsafe {
            if is_h3 {
                (*self.h3_request_pool).put(&raw mut *ctx.cast::<request_context::RequestContext<
                    Self,
                    SSL,
                    DEBUG,
                    true,
                >>());
            } else {
                (*self.request_pool).put(&raw mut *ctx.cast::<request_context::RequestContext<
                    Self,
                    SSL,
                    DEBUG,
                    false,
                >>());
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

impl AnyServer {
    // ─── tag-checked downcasts ───────────────────────────────────────────────
    // Centralize the `unsafe { &*self.ptr.cast() }` pattern that the dispatch
    // macro and `h3_alt_svc` open-coded. Each accessor debug-asserts the tag
    // so a mismatched call trips in debug builds rather than silently aliasing
    // the wrong monomorphization.
    //
    // No `&mut`-returning variants: dispatch-mut bodies re-enter JS
    // (`on_request`, `get_or_load_plugins`, `stop`, …) which can observe the
    // same server through another `AnyServer` handle, so a safe
    // `fn(&self) -> &mut NewServer` accessor would invite overlapping `&mut`
    // under Stacked Borrows. `any_server_dispatch_mut!` keeps its inline
    // `unsafe` with the existing caller-upheld exclusivity contract.

    #[inline(always)]
    fn as_http(&self) -> &HTTPServer {
        debug_assert!(matches!(self.tag, AnyServerTag::HTTPServer));
        // SAFETY: `ptr` was produced by `AnyServer::from::<false, false>` and
        // is non-null while the server is alive (heap-allocated `NewServer`,
        // freed only after all `AnyServer` handles are dropped).
        unsafe { &*self.ptr.cast::<HTTPServer>() }
    }

    #[inline(always)]
    fn as_https(&self) -> &HTTPSServer {
        debug_assert!(matches!(self.tag, AnyServerTag::HTTPSServer));
        // SAFETY: tag-matched non-null `NewServer<true, false>`; see `as_http`.
        unsafe { &*self.ptr.cast::<HTTPSServer>() }
    }

    #[inline(always)]
    fn as_debug_http(&self) -> &DebugHTTPServer {
        debug_assert!(matches!(self.tag, AnyServerTag::DebugHTTPServer));
        // SAFETY: tag-matched non-null `NewServer<false, true>`; see `as_http`.
        unsafe { &*self.ptr.cast::<DebugHTTPServer>() }
    }

    #[inline(always)]
    fn as_debug_https(&self) -> &DebugHTTPSServer {
        debug_assert!(matches!(self.tag, AnyServerTag::DebugHTTPSServer));
        // SAFETY: tag-matched non-null `NewServer<true, true>`; see `as_http`.
        unsafe { &*self.ptr.cast::<DebugHTTPSServer>() }
    }
}

/// Dispatch over the four `NewServer` monomorphizations (shared `&` borrow).
/// Mirrors Zig's `inline switch (ptr.tag()) { inline else => |s| s.method() }`.
/// Read-only accessors MUST use this form so holding the returned reference
/// while calling another dispatch method does not materialize an aliasing
/// `&mut NewServer` (Stacked-Borrows UB).
macro_rules! any_server_dispatch {
    ($self:expr, |$s:ident| $body:expr) => {{
        let this = $self;
        match this.tag {
            AnyServerTag::HTTPServer => {
                let $s = this.as_http();
                $body
            }
            AnyServerTag::HTTPSServer => {
                let $s = this.as_https();
                $body
            }
            AnyServerTag::DebugHTTPServer => {
                let $s = this.as_debug_http();
                $body
            }
            AnyServerTag::DebugHTTPSServer => {
                let $s = this.as_debug_https();
                $body
            }
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
            AnyServerTag::HTTPServer => {
                let $s = unsafe { &mut *this.ptr.cast::<HTTPServer>() };
                $body
            }
            AnyServerTag::HTTPSServer => {
                let $s = unsafe { &mut *this.ptr.cast::<HTTPSServer>() };
                $body
            }
            AnyServerTag::DebugHTTPServer => {
                let $s = unsafe { &mut *this.ptr.cast::<DebugHTTPServer>() };
                $body
            }
            AnyServerTag::DebugHTTPSServer => {
                let $s = unsafe { &mut *this.ptr.cast::<DebugHTTPSServer>() };
                $body
            }
        }
    }};
}

/// Dispatch over the four `NewServer` monomorphizations, simultaneously
/// downcasting an [`uws::AnyResponse`] to the matching `*mut Response<SSL>`.
///
/// Binds `$s: *mut NewServer<SSL, DEBUG>` (raw, NOT `&`/`&mut` — the target
/// fns take `this: *mut Self` and may re-enter JS) and `$r: *mut
/// uws_sys::Response<SSL>`. Tag↔SSL invariant is enforced by
/// `assert_ssl`/`assert_no_ssl` (panics on `AnyResponse::H3`, matching the
/// hand-written arms this replaces). The body is monomorphized four times, so
/// `NewServer::method($s, …, $r, …)` infers `<SSL, DEBUG>` from `$s`.
macro_rules! any_server_dispatch_resp {
    ($self:expr, $resp:expr, |$s:ident, $r:ident| $body:expr) => {{
        let this = $self;
        let __resp = $resp;
        // SAFETY: ptr was produced by `AnyServer::from` for the matching tag
        // and is non-null while the server is alive.
        match this.tag {
            AnyServerTag::HTTPServer => {
                let $s = this.ptr.cast::<HTTPServer>();
                let $r = __resp.assert_no_ssl();
                $body
            }
            AnyServerTag::HTTPSServer => {
                let $s = this.ptr.cast::<HTTPSServer>();
                let $r = __resp.assert_ssl();
                $body
            }
            AnyServerTag::DebugHTTPServer => {
                let $s = this.ptr.cast::<DebugHTTPServer>();
                let $r = __resp.assert_no_ssl();
                $body
            }
            AnyServerTag::DebugHTTPSServer => {
                let $s = this.ptr.cast::<DebugHTTPSServer>();
                let $r = __resp.assert_ssl();
                $body
            }
        }
    }};
}

impl AnyServer {
    pub fn from<const SSL: bool, const DEBUG: bool>(
        server: *const NewServer<SSL, DEBUG>,
    ) -> AnyServer {
        let tag = match (SSL, DEBUG) {
            (false, false) => AnyServerTag::HTTPServer,
            (true, false) => AnyServerTag::HTTPSServer,
            (false, true) => AnyServerTag::DebugHTTPServer,
            (true, true) => AnyServerTag::DebugHTTPSServer,
        };
        AnyServer {
            tag,
            ptr: server.cast::<()>().cast_mut(),
        }
    }

    /// Re-pack into the Zig `bun.ptr.TaggedPointerUnion` wire format
    /// (`u49` ptr | `u15` tag) for the C++ FFI boundary. Inverse of
    /// [`NodeHTTPResponse::any_server_from_packed`]. Tag values mirror Zig's
    /// `1024 - typeBaseName-index` assignment (declaration order in
    /// `AnyServer.Ptr = TaggedPointerUnion(.{HTTP, HTTPS, DebugHTTP, DebugHTTPS})`).
    pub fn to_packed(self) -> u64 {
        let tag: u16 = match self.tag {
            AnyServerTag::HTTPServer => 1024,
            AnyServerTag::HTTPSServer => 1023,
            AnyServerTag::DebugHTTPServer => 1022,
            AnyServerTag::DebugHTTPSServer => 1021,
        };
        // `TaggedPtr::to()` bit-casts the full packed word through `*mut c_void`.
        bun_ptr::TaggedPointer::init(self.ptr, tag).to() as u64
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
    pub fn vm(&self) -> &jsc::VirtualMachine {
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
    pub fn config(&self) -> &ServerConfig {
        any_server_dispatch!(self, |s| &s.config)
    }

    pub fn h3_alt_svc(&self) -> Option<&[u8]> {
        match self.tag {
            AnyServerTag::HTTPSServer => self.as_https().h3_alt_svc(),
            AnyServerTag::DebugHTTPSServer => self.as_debug_https().h3_alt_svc(),
            _ => None,
        }
    }

    pub fn inspector_server_id(&self) -> jsc::DebuggerId {
        any_server_dispatch!(self, |s| s.inspector_server_id)
    }

    pub fn set_inspector_server_id(&mut self, id: jsc::DebuggerId) {
        any_server_dispatch_mut!(self, |s| {
            s.inspector_server_id = id;
            if let Some(dev_server) = s.dev_server.as_deref_mut() {
                dev_server.inspector_server_id = id;
            }
        })
    }

    pub fn plugins(&self) -> Option<&ServePlugins> {
        any_server_dispatch!(self, |s| s.plugins_ref())
    }

    pub fn get_plugins(&self) -> PluginsResult<'_> {
        any_server_dispatch!(self, |s| s.get_plugins())
    }

    pub fn on_pending_request(&mut self) {
        any_server_dispatch_mut!(self, |s| s.on_pending_request())
    }

    /// Dispatch the user `fetch` handler. Mirrors Zig `AnyServer.onRequest`
    /// (see `server.zig`): un-erase the SSL bool from the tag and downcast
    /// `AnyResponse` to the matching `NewAppResponse<SSL>` variant.
    pub fn on_request(&self, req: &mut uws_sys::Request, resp: uws::AnyResponse) {
        any_server_dispatch_resp!(self, resp, |s, r| NewServer::on_request(s, req, r))
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
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` via
            // `bun_opaque::opaque_deref_mut` (const-asserted ZST/align-1).
            Some(app) => bun_opaque::opaque_deref_mut(app).num_subscribers(topic),
            // PORT NOTE: Zig spec uses `app.?` (panic on null). Defensive 0
            // here for the post-stop window; assert in debug to catch misuse.
            None => {
                debug_assert!(false, "num_subscribers on server with no app");
                0
            }
        })
    }

    pub fn publish(
        &self,
        topic: &[u8],
        message: &[u8],
        opcode: uws::Opcode,
        compress: bool,
    ) -> bool {
        any_server_dispatch!(self, |s| match s.app {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` via
            // `bun_opaque::opaque_deref_mut` (const-asserted ZST/align-1).
            Some(app) =>
                bun_opaque::opaque_deref_mut(app).publish(topic, message, opcode, compress),
            // PORT NOTE: Zig spec uses `app.?` (panic on null). Defensive false
            // here for the post-stop window; assert in debug to catch misuse.
            None => {
                debug_assert!(false, "publish on server with no app");
                false
            }
        })
    }

    pub fn web_socket_handler(&mut self) -> Option<&mut WebSocketServerHandler> {
        any_server_dispatch_mut!(self, |s| s
            .config
            .websocket
            .as_mut()
            .map(|ws| &mut ws.handler))
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

    /// `server.zig:3574` — invoke the user's route handler for a request that
    /// was deferred (bake bundle-then-serve flow).
    pub fn on_saved_request<const EXTRA_ARG_COUNT: usize>(
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
        callback: ServePluginsCallback<'_>,
    ) -> GetOrStartLoadResult<'_> {
        any_server_dispatch_mut!(self, |s| s.get_or_load_plugins(callback))
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
        any_server_dispatch_mut!(self, |s| s.reload_static_routes())
    }

    pub fn get_url_as_string(&self) -> Result<bun_core::String, bun_alloc::AllocError> {
        any_server_dispatch!(self, |s| s.get_url_as_string())
    }
}

// ─── http_server_agent ───────────────────────────────────────────────────────
/// `jsc.Debugger.HTTPServerAgent.{notifyServerStarted, notifyServerStopped,
/// notifyServerRoutesUpdated}` — the FFI plumbing lives in
/// `bun_jsc::http_server_agent`; the bodies live here because they reach into
/// `AnyServer`/`ServerConfig` (forward dep from `bun_jsc`'s point of view).
pub mod http_server_agent {
    use super::{AnyRoute, AnyServer, AnyServerTag};
    use super::{DebugHTTPSServer, DebugHTTPServer, HTTPSServer, HTTPServer};
    use bun_core::String as BunString;
    use bun_jsc::debugger::DebuggerId;
    use bun_jsc::http_server_agent::{HTTPServerAgent, InspectorHTTPServerAgent, Route, RouteType};

    /// `HTTPServerAgent.zig:notifyServerStarted`.
    pub fn notify_server_started(this: &mut HTTPServerAgent, mut instance: AnyServer) {
        let Some(agent) = this.agent else { return };
        this.next_server_id = DebuggerId::init(this.next_server_id.get() + 1);
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
        let Some(agent) = this.agent else {
            return Ok(());
        };
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
                    path: BunString::init(user_route.route.path.as_bytes()),
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
                    AnyRoute::Html(r) => BunString::init(&*r.data().bundle.path),
                    _ => BunString::EMPTY,
                },
                ..Default::default()
            });
        }

        // SAFETY: `agent` is a live C++ handle.
        unsafe {
            InspectorHTTPServerAgent::notify_server_routes_updated(
                agent.as_ptr(),
                server.inspector_server_id(),
                server.vm().hot_reload_counter as i32,
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
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ServerAllConnectionsClosedTask;
}

impl ServerAllConnectionsClosedTask {
    /// Spec server.zig `schedule` — `bun.TrivialNew` heap-allocates `this`,
    /// then `vm.eventLoop().enqueueTask(jsc.Task.init(ptr))`.
    pub fn schedule(this: Self, vm: &mut jsc::VirtualMachine) {
        let ptr = bun_core::heap::into_raw(Box::new(this));
        vm.enqueue_task(bun_event_loop::Task::init(ptr));
    }

    /// Spec server.zig `runFromJSThread` — resolve the `server.stop()` promise
    /// once uws reports all sockets closed, then `bun.destroy(self)`.
    pub fn run_from_js_thread(
        this: *mut Self,
        vm: &mut jsc::VirtualMachine,
    ) -> Result<(), jsc::JsTerminated> {
        httplog!("ServerAllConnectionsClosedTask runFromJSThread");

        // SAFETY: `this` was `heap::alloc`'d in `schedule()`; reclaim
        // ownership and move out of the Box (Zig: `bun.destroy(this)` after
        // copying the fields it still needs onto the stack).
        let this = *unsafe { bun_core::heap::take(this) };
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST handle — safe
        // `*const → &` via `opaque_deref` (set from the live per-VM global in
        // `schedule()`; the task is only dispatched on that VM's JS thread).
        let global_object: &jsc::JSGlobalObject = bun_opaque::opaque_deref(this.global_object);
        let _dispatch = this.tracker.dispatch(global_object);

        // Zig: `var promise = this.promise; defer promise.deinit();` —
        // `JSPromiseStrong`'s Drop releases the strong handle on scope exit.
        let mut promise = this.promise;

        if !vm.is_shutting_down() {
            promise.resolve(global_object, JSValue::UNDEFINED)?;
        }
        Ok(())
    }
}
