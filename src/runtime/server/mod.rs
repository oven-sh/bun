//! `Bun.serve()`: `NewServer` struct + lifecycle (start/stop/listen),
//! `AnyServer` dispatch, `AnyRoute`, and per-file submodules.

use core::any::Any;
use core::cell::{Cell, OnceCell};
use core::ffi::{c_char, c_int, c_void};
use core::sync::atomic::Ordering;

use bun_core::scoped::{ScopedCell as _, ScopedFlag as _};
use bun_io::KeepAlive;
use bun_uws as uws;
use bun_uws_sys as uws_sys;
use bun_uws_sys::app::c as uws_app_c;

use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsCellRefExt as _, JsResult};
use bun_ptr::AsCtxPtr;

use crate::socket::listener::Connections;
use crate::webcore::Request;

// ─── server-local jsc re-export ──────────────────────────────────────────────
// `bun_jsc` is now a dep; forward to it. `AsyncTaskTracker` lives under
// `bun_jsc::debugger`, surfaced flat here for the server drafts that import it.
pub(crate) mod jsc {
    pub(crate) use crate::jsc::*;
    pub(crate) use bun_jsc::debugger::{AsyncTaskTracker, DebuggerId};
    pub(crate) use bun_jsc::virtual_machine::{ExceptionList, VirtualMachine};
}

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "HTTPStatusText.rs"]
pub(crate) mod http_status_text;
pub(crate) use http_status_text as HTTPStatusText;

#[path = "RangeRequest.rs"]
pub(crate) mod range_request;
pub(crate) use range_request as RangeRequest;

#[path = "WebSocketServerContext.rs"]
pub(crate) mod web_socket_server_context;
pub(crate) use web_socket_server_context::Handler as WebSocketServerHandler;

#[path = "ServerConfig.rs"]
pub(crate) mod server_config;
pub(crate) use server_config::{ServerConfig, ServerTls};

#[path = "PendingRequest.rs"]
pub(crate) mod pending_request;
pub(crate) use pending_request::{PendingRequest, Served};

#[path = "StaticRoute.rs"]
pub(crate) mod static_route;
pub(crate) use static_route::StaticRoute;

#[path = "FileRoute.rs"]
pub(crate) mod file_route;
pub(crate) use file_route::FileRoute;

#[path = "DirectoryRoute.rs"]
pub(crate) mod directory_route;
pub(crate) use directory_route::DirectoryRoute;

#[path = "DevErrorPage.rs"]
pub(crate) mod dev_error_page;
pub(crate) use dev_error_page::DevErrorPage;

#[path = "FileResponseStream.rs"]
pub(crate) mod file_response_stream;
pub(crate) use file_response_stream::FileResponseStream;

#[path = "HTMLBundle.rs"]
pub(crate) mod html_bundle;
pub(crate) use html_bundle::HTMLBundle;

#[path = "ServerWebSocket.rs"]
pub(crate) mod server_web_socket;
pub(crate) use server_web_socket::ServerWebSocket;

#[path = "NodeHTTPResponse.rs"]
pub(crate) mod node_http_response;
pub(crate) use node_http_response::NodeHTTPResponse;

#[path = "RequestContext.rs"]
pub(crate) mod request_context;
pub(crate) use request_context::RequestContext as NewRequestContext;

#[path = "AnyRequestContext.rs"]
pub(crate) mod any_request_context;
pub(crate) use any_request_context::AnyRequestContext;

/// Run `$body` once for each attached multiplexed app (`h3_app`, then
/// `h2_app`) as `$mux`. A macro rather than
/// a closure because the two apps are different types.
macro_rules! for_each_mux_app {
    ($self:expr, |$mux:ident| $body:block) => {{
        if Self::HAS_H3 {
            if let Some(app) = $self.h3_app() {
                // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                let $mux = bun_opaque::opaque_deref_mut(app);
                $body
            }
        }
        if let Some(app) = $self.h2_app() {
            // S008: `h2::App` is an `opaque_ffi!` ZST — safe deref.
            let $mux = bun_opaque::opaque_deref_mut(app);
            $body
        }
    }};
}

// `server_body.rs` holds the large method bodies (`on_request`, `upgrade`,
// route setup, …) split out to keep this module declaration file readable.

#[path = "server_body.rs"]
pub(crate) mod server_body;
pub(crate) use server_body::{GetOrStartLoadResult, ServePluginsCallback};

// ─── write_status ────────────────────────────────────────────────────────────
pub(crate) fn write_status(resp: uws::AnyResponse, status: u16) {
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
pub(crate) enum AnyRoute {
    /// Serve a static file — `"/robots.txt": new Response(...)`
    Static(bun_ptr::RefPtr<StaticRoute>),
    /// Serve a file from disk
    File(bun_ptr::RefPtr<FileRoute>),
    /// Serve a directory tree — `"/static/*": { dir: "./public" }`
    Directory(bun_ptr::RefPtr<DirectoryRoute>),
    /// Bundle an HTML import — `import html from "./index.html"; "/": html`
    Html(bun_ptr::RefPtr<html_bundle::Route>),
    /// Use file-system routing — `"/*": { dir: …, style: "nextjs-pages" }`
    FrameworkRouter,
}

impl AnyRoute {
    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            AnyRoute::Static(r) => r.memory_cost(),
            AnyRoute::File(r) => r.memory_cost(),
            AnyRoute::Directory(r) => r.memory_cost(),
            AnyRoute::Html(r) => r.memory_cost(),
            AnyRoute::FrameworkRouter => core::mem::size_of::<crate::bake::FileSystemRouterType>(),
        }
    }

    // from_js / from_options / html_route_from_js — bodies live in
    // `server_body.rs` (`impl AnyRoute { … }`); same crate, separate file.
}

// ─── ServePlugins ────────────────────────────────────────────────────────────
// Full state machine + intrusive refcount lives in `server_body.rs` (the
// `*mut ServePlugins` is smuggled through `JSValue::then` as a promise context,
// so `Rc` is unsuitable). Re-exported here for `AnyServer` callers.
pub(crate) use server_body::ServePlugins;

/// How much of a server is still in use, from the facts their owners report ([`NewServer::phase`]).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Phase {
    Listening,
    /// No listener. A request, connection, WebSocket or the HTTP/3 transport still holds the event loop.
    Stopping,
    /// `stop()`'s promise (node:http: 'close') resolves and the loop ref goes. Only parked requests are left.
    Closed,
    /// Nothing can dispatch a handler any more, so the wrapper goes weak and the server drops its ref on itself.
    Drained,
}

// ─── NewServer ───────────────────────────────────────────────────────────────
/// Number of HTTP method tokens — must match the variant count of
/// `bun_http_types::Method::Method` (`ACL`..`UNSUBSCRIBE`). Sizes
/// [`NewServer::method_name_cache`]; the lookup falls back to a fresh intern if
/// a future variant ever pushes the index past the end, so this is a perf knob,
/// not a correctness invariant.
const N_HTTP_METHODS: usize = 36;

bun_jsc::impl_abort_handle_owner!(
    [const SSL: bool, const DEBUG: bool] NewServer<SSL, DEBUG>,
    abort_handle,
    |this, cause| {
        let connections = match cause {
            bun_jsc::AbortCause::ContextStopped(bun_jsc::StopReason::VmTeardown) => {
                Connections::CloseAsThreadEnds
            }
            _ => Connections::Close,
        };
        // SAFETY: trait contract — `this` is live (armed ⇒ not deinit'd).
        unsafe { &*this }.stop(connections)
    }
);

#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::schedule_deinit)]
pub(crate) struct NewServer<const SSL: bool, const DEBUG: bool> {
    /// The JS wrapper holds one ref, `open_ref` another.
    ref_count: bun_ptr::RefCount<Self>,
    /// Held from `listen()` until the server is drained: uWS and in-flight requests hold raw pointers to it.
    open_ref: Cell<Option<bun_ptr::RefPtr<Self>>>,
    app: JsCell<Option<uws_sys::app::OwnedApp<SSL>>>,
    listener: JsCell<Option<uws_sys::app::OwnedListenSocket<SSL>>>,
    h3_app: JsCell<Option<uws_sys::h3::OwnedApp<SSL>>>,
    /// Attached to `app` when `config.http2`; serves connections that
    /// negotiate "h2" (ALPN) or open with the cleartext preface.
    h2_app: JsCell<Option<uws_sys::h2::OwnedApp>>,
    pub(crate) h3_listener: core::cell::Cell<Option<*mut uws_sys::h3::ListenSocket>>,
    /// `h3_listener` after a graceful stop. It lives as long as `h3_app`, and a
    /// later abrupt stop closes the connections that are still draining through it.
    pub(crate) h3_draining_listener: core::cell::Cell<Option<*mut uws_sys::h3::ListenSocket>>,
    /// Cached `h3=":<port>"; ma=86400` for Alt-Svc on H1 responses; formatted
    /// once in onH3Listen so renderMetadata doesn't reformat per-request.
    pub(crate) h3_alt_svc: JsCell<Box<[u8]>>,
    pub(crate) js_value: JsCell<jsc::JsRef>,
    /// Potentially null before listen() is called, and once .destroy() is called.
    // LIFETIMES.tsv = STATIC → `&'static VirtualMachine`. `BackRef` for safe
    // `Deref` while keeping the struct `'static` (process-lifetime VM).
    pub(crate) vm: bun_ptr::BackRef<jsc::VirtualMachine>,
    pub global_this: *const jsc::JSGlobalObject,
    /// Packed tagged-pointer wire-format `AnyServer` for this
    /// server (`u49` heap addr | `u15` variant tag), computed once in
    /// [`Self::init`]. The C++ `node:http` request path needs it on every
    /// request to reconstruct `AnyServer`; it's a pure function of the (stable)
    /// heap address and the const variant tag, so cache it rather than
    /// recompute `AnyServer::from(self).to_packed()` in the per-request prologue.
    pub(crate) any_server_packed: usize,
    /// Lazily-filled cache of the interned JS method-name string per HTTP
    /// method token. The `node:http` request prologue reads this so each request
    /// after the first for a given method skips the FFI hop into
    /// `Bun__HTTPMethod__toJS`. Indexed by `Method as usize`; a slot holds
    /// [`JSValue::ZERO`] until filled. The cached value is one of the global
    /// object's GC-rooted common strings (visited by `CommonStrings::visit`), so
    /// it stays live for as long as this server's global object — which always
    /// outlives the server itself.
    pub(crate) method_name_cache: [core::cell::Cell<jsc::JSValue>; N_HTTP_METHODS],
    pub(crate) base_url_string_for_joining: JsCell<Box<[u8]>>,
    pub(crate) config: JsCell<ServerConfig>,
    pending_requests: core::cell::Cell<u32>,
    /// Live HTTP connections (accepted, not yet closed or upgraded), fed by
    /// the uWS filter in [`NewServer::listen`]. Any of them can still dispatch
    /// a handler, so the wrapper stays `Strong` until this drains
    /// ([`NewServer::is_drained`]); for Bun.serve it also holds the
    /// graceful-stop promise open ([`NewServer::is_closed`]).
    active_connection_count: core::cell::Cell<u32>,
    /// The connections in `active_connection_count` that don't hold the loop: node:http ones that don't read and have nothing left to send. A parked request puts its connection in this state, which can outlive the request, so uWS keeps it per connection.
    idle_connection_count: core::cell::Cell<u32>,
    /// The node:http requests in `pending_requests` that are parked (`NodeHTTPResponse::update_parked`).
    parked_request_count: core::cell::Cell<u32>,
    /// Live `ServerWebSocket` count. Lives on the server (not the websocket
    /// context) so a reload's context swap cannot reset it, and sits in a
    /// `Cell` because the open/close accounting arrives through shared
    /// `AnyServer` handles on the JS thread.
    active_websocket_count: core::cell::Cell<u32>,
    /// Set while a frame applies a phase or closes sockets. Reports that arrive meanwhile wait for that frame, and `schedule_deinit` doesn't free the server under it.
    phase_held: core::cell::Cell<bool>,
    /// Armed while listening: the server stops with the context that started it.
    pub(crate) abort_handle: jsc::AbortHandle,
    /// The context of the script that started the server: what a request makes before its
    /// handler runs (its `AbortSignal`) belongs to it.
    pub(crate) context: core::cell::Cell<jsc::ContextId>,
    pub(crate) request_pool: bun_ptr::BackRef<RequestPool<SSL, DEBUG, false>>,
    /// Null until `listen()` creates an HTTP/2 or HTTP/3 app.
    pub(crate) mux_request_pool: core::cell::Cell<*const RequestPool<SSL, DEBUG, true>>,
    /// Authoritative GC root for the `server.stop()` promise. Lazily filled by
    /// `get_all_closed_promise`; read in `apply_phase` (which can run
    /// after the wrapper is collected, so a wrapper-traced slot would not
    /// suffice — this Strong is what keeps the cell live across that window).
    /// A `.then(cb)` can reach the wrapper, so `apply_phase` moves the Strong into the task that resolves the promise.
    pub(crate) all_closed_promise: JsCell<jsc::JSPromiseStrong>,

    pub poll_ref: KeepAlive,

    terminated: core::cell::Cell<bool>,

    /// Shared plugin state; also passed through `JSValue::then` as a promise context.
    pub(crate) plugins: JsCell<Option<bun_ptr::RefPtr<ServePlugins>>>,

    pub(crate) dev_server: JsCell<Option<Box<crate::bake::DevServer::DevServer>>>,

    /// Route → index in RouteList.cpp. uWS route handlers keep pointers into this Vec.
    pub(crate) user_routes: JsCell<Vec<UserRoute<SSL, DEBUG>>>,

    /// Raw shadow of the wrapper's `m_onClientError` WriteBarrier slot.
    /// `JSValue::ZERO` when unset; written by `set_on_client_error`.
    pub(crate) on_clienterror: core::cell::Cell<JSValue>,

    /// node:http: the callbacks of every `req.socket._handle` of this server. The wrapper's `socketHandlers` slot keeps their cell alive.
    pub(crate) node_socket_config:
        JsCell<Option<Box<crate::socket::node_http_socket::AcceptedSocketConfig>>>,

    pub(crate) inspector_server_id: core::cell::Cell<jsc::DebuggerId>,

    /// Callbacks for the `ws` package's sockets, set by its first upgrade on this server. Boxed
    /// because every such `ServerWebSocket` points at it. The wrapper's `wsPackageHandlers` slot
    /// keeps the callbacks alive.
    pub(crate) ws_package_handler: JsCell<Option<Box<WebSocketServerHandler>>>,

    /// Requests that `drop` aborts call back through their own pointers.
    _pin: core::marker::PhantomPinned,
}

pub(crate) struct UserRoute<const SSL: bool, const DEBUG: bool> {
    pub(crate) id: u32,
    pub(crate) server: *mut NewServer<SSL, DEBUG>,
    pub(crate) route: server_config::RouteDeclaration,
}

impl<const SSL: bool, const DEBUG: bool> Drop for NewServer<SSL, DEBUG> {
    fn drop(&mut self) {
        // Stopping the server did these, unless the VM ended first.
        self.notify_inspector_server_stopped();
        self.abort_handle.leave();

        self.listener.set(None);
        // Destroying an app closes nothing.
        self.terminate(false);
        self.h3_app.set(None);
        if let Some(h2_app) = self.h2_app.take() {
            // A drain may still be queued for it.
            self.vm()
                .event_loop()
                .deferred_tasks
                .unregister_task(core::ptr::NonNull::new(h2_app.as_ptr().cast::<c_void>()));
        }
        self.app.set(None);

        // Before `config`, which owns the arena the dev server's transpilers borrow.
        drop(self.dev_server.take());
        if let Some(plugins) = self.plugins.get() {
            // SAFETY: the intrusive refcount permits mutation through any owner. Each server has its
            // own `ServePlugins`, so no other `&mut` to it is live while the server is being freed.
            unsafe { &mut *plugins.as_ptr() }
                .forget_server(AnyServer::from(std::ptr::from_ref::<Self>(self)));
        }
        // The remaining owned fields (config, base_url, h3_alt_svc,
        // user_routes, all_closed_promise) drop automatically.
    }
}

// `UserRoute` needs no explicit `impl Drop`: every field drops automatically.

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

/// The `RequestContext` of a server monomorphization. `MUX`: HTTP/2 or HTTP/3.
pub(crate) type ServerRequestContext<const SSL: bool, const DEBUG: bool, const MUX: bool> =
    request_context::RequestContext<SSL, DEBUG, MUX>;

/// A `Request` while the uWS callback that lent it a `uws::Request` is on the stack.
pub(crate) struct DispatchedRequest<'a>(pub(super) jsc::WrapperGuard<'a, Request>);

impl<'a> core::ops::Deref for DispatchedRequest<'a> {
    type Target = jsc::WrapperGuard<'a, Request>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DispatchedRequest<'_> {
    /// `call` makes the wrapper, stores it in its second argument and returns what the handler returned.
    fn call_route(
        request: bun_ptr::RefPtr<Request>,
        global: &jsc::JSGlobalObject,
        call: impl FnOnce(bun_ptr::RefPtr<Request>, &mut JSValue) -> JSValue,
    ) -> (Self, JSValue) {
        let (native, mut js) = (request.as_non_null(), JSValue::ZERO);
        let response_value = jsc::from_js_host_call(global, || call(request, &mut js))
            .unwrap_or_else(|err| global.take_exception(err));
        // SAFETY: `js` holds the ref.
        let this = Self(unsafe { jsc::WrapperGuard::from_parts(js, native) });
        (this, response_value)
    }
}

impl Drop for DispatchedRequest<'_> {
    fn drop(&mut self) {
        self.request_context.get().detach_request();
    }
}

impl DispatchedRequest<'_> {
    /// Used by DevServer to defer calling
    /// the JS handler until the bundle is actually ready.
    fn save<const SSL: bool, const DEBUG: bool>(
        self,
        dispatch: &request_context::Dispatch<SSL, DEBUG, false>,
        global: &jsc::JSGlobalObject,
        req: &mut uws_sys::Request,
        resp: uws::AnyResponse,
    ) -> SavedRequest {
        let ctx = AnyRequestContext::init(&raw const **dispatch);
        // Before `to_async`, which releases the context of a request that is already aborted.
        let ctx = any_request_context::AnyRequestContextRef::new(ctx);
        // By saving a request, all information from `req` must be
        // copied since the provided uws.Request will be re-used for
        // future requests (stack allocated).
        dispatch.to_async(
            std::ptr::from_mut::<uws_sys::Request>(req).cast::<c_void>(),
            &self,
        );

        SavedRequest {
            js_request: jsc::Strong::create(self.to_js(), global),
            request: bun_ptr::BackRef::new(&self),
            ctx,
            response: resp,
        }
    }
}

impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    pub(crate) const HAS_H3: bool = SSL;

    // ── raw-field accessors ──────────────────────────────────────────────────

    /// `global_this` is a STATIC backref (LIFETIMES.tsv) set in `init()`;
    /// non-null and outlives the server. S008: `JSGlobalObject` is an
    /// `opaque_ffi!` ZST, so the `*const → &` deref is safe via
    /// `bun_opaque::opaque_deref` (const-asserted ZST/align-1).
    #[inline(always)]
    pub(crate) fn global_this(&self) -> &jsc::JSGlobalObject {
        bun_opaque::opaque_deref(self.global_this)
    }

    /// `vm` is a STATIC backref (LIFETIMES.tsv) set in `init()` from
    /// `VirtualMachine::get()`; non-null for the server's lifetime.
    #[inline(always)]
    pub(crate) fn vm(&self) -> &jsc::VirtualMachine {
        self.vm.get()
    }

    // ─────────────────────────────────────────────────────────────────────────

    pub(crate) fn memory_cost(&self) -> usize {
        self.base_url_string_for_joining.get().len()
            + self.config.get().memory_cost()
            + self
                .dev_server
                .get()
                .as_ref()
                .map_or(0, |d| d.memory_cost())
    }

    pub(crate) fn h3_alt_svc(&self) -> Option<&[u8]> {
        if !Self::HAS_H3 || self.h3_alt_svc.get().is_empty() {
            return None;
        }
        Some(self.h3_alt_svc.get())
    }

    /// Build the server's base URL string (`http(s)://host:port/`, or a
    /// `unix://`/abstract-socket URL) from the configured listen address.
    pub(crate) fn get_url_as_string(&self) -> bun_core::String {
        use bun_core::fmt::{URLFormatter, URLProto};
        let fmt = match &self.config.get().address {
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
                if let Some(listener) = self.listener() {
                    // S012: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
                    port = bun_opaque::opaque_deref_mut(listener)
                        .get_local_port()
                        .unwrap_or(port);
                } else if Self::HAS_H3 {
                    if let Some(h3l) = self.h3_listener.get() {
                        // S012: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                        port = bun_opaque::opaque_deref_mut(h3l)
                            .get_local_port()
                            .unwrap_or(port);
                    }
                }
                URLFormatter {
                    proto: if SSL { URLProto::Https } else { URLProto::Http },
                    hostname: hostname.as_ref().map(|h| h.as_bytes()),
                    port: Some(port),
                }
            }
        };

        bun_core::String::create_format(format_args!("{fmt}"))
    }

    /// Return the server's JS object, asserting that the weak ref is still
    /// alive (callers must only use this while the server JS object is kept
    /// alive elsewhere).
    pub(crate) fn js_value_assert_alive(&self) -> JSValue {
        debug_assert!(self.js_value.get().is_not_empty());
        self.js_value.try_get().expect("js_value alive")
    }

    /// Returns the wrapper while it is alive (`Strong` or `Weak`) and its VM may still run script,
    /// else `None`. It stays `Strong` — the WriteBarrier root of the handler shadows — until the
    /// server is drained (no listener, request, connection or websocket left; TCP connections count
    /// from accept), so nothing dispatches through a wrapper the GC may have collected. A VM whose
    /// script gate has closed (a worker that called `process.exit()` or was asked to terminate, still
    /// draining the current loop tick before its stop phase closes the listener) must not have a
    /// request built for it either; uWS requires every dispatched request to be answered or
    /// adopted, so dispatch trampolines answer 503+close on `None`.
    pub(crate) fn js_value_for_dispatch(&self) -> Option<JSValue> {
        if !self.vm().script_allowed() {
            return None;
        }
        debug_assert!(
            self.js_value.get().is_strong() || self.js_value.try_get().is_none(),
            "a socket outlived the server's connection accounting"
        );
        self.js_value.try_get()
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
/// `*shadow`. Every call site already holds a live wrapper (the new one on
/// serve, `this` on reload / setOnClientError), so `server_js`
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
    /// The VM's pool of this server's `RequestContext`s.
    fn request_pool_for<const MUX: bool>(&self) -> *const RequestPool<SSL, DEBUG, MUX> {
        if MUX {
            debug_assert!(
                !self.mux_request_pool.get().is_null(),
                "HTTP/2 or HTTP/3 request dispatched but mux_request_pool was never allocated"
            );
            self.mux_request_pool.get().cast()
        } else {
            self.request_pool.as_const_ptr().cast()
        }
    }

    /// Invoke the user's route handler for a
    /// request that was deferred (bake bundle-then-serve flow).
    ///
    /// # Safety
    /// `resp` must be the live response handle for the request being resumed.
    fn on_saved_request<const ARG_COUNT: usize>(
        &self,
        req: SavedRequestUnion<'_>,
        resp: uws::AnyResponse,
        callback: JSValue,
        extra_args: [JSValue; ARG_COUNT],
    ) {
        // Same gate as the network trampolines: the saved request's
        // `pending_requests` increment keeps the wrapper `Strong` (so it is
        // never `Finalized` here), but the VM's script gate can have closed
        // while the bundle was being built.
        let Some(server_js) = self.js_value_for_dispatch() else {
            server_body::respond_stopped_503(resp);
            return;
        };
        let global = self.global_this();
        let (request, ctx) = match &req {
            SavedRequestUnion::Stack(r) => {
                // reshaped for borrowck — decouple the inner
                // `&mut uws::Request` lifetime from the `req` match guard.
                let r = std::ptr::from_ref::<uws::Request>(*r).cast_mut();
                let Some((request, ctx)) = Self::prepare_js_request_context::<false>(
                    self.as_ctx_ptr(),
                    uws::AnyRequest::H1(r),
                    resp,
                    None,
                    None,
                ) else {
                    return;
                };
                (DispatchedRequest(request.wrap_for_bake(global)), ctx)
            }
            SavedRequestUnion::Saved(data) => (
                // SAFETY: `save` wrapped `request` in `js_request`.
                DispatchedRequest(unsafe {
                    jsc::WrapperGuard::from_parts(data.js_request.get(), data.request.into())
                }),
                // SAFETY: `data.ctx` holds a ref.
                request_context::Dispatch::new(unsafe {
                    &*data
                        .ctx
                        .get::<ServerRequestContext<SSL, DEBUG, false>>()
                        .expect("ctx tag mismatch")
                }),
            ),
        };

        debug_assert!(!callback.is_empty());
        // PERF: stable Rust forbids `ARG_COUNT + 1` in const-generic array lengths.
        // The conservative GC scan reaches the heap allocation as well as the
        // stack, so a small Vec is sound.
        let mut args: Vec<JSValue> = Vec::with_capacity(ARG_COUNT + 1);
        args.push(request.to_js());
        args.extend_from_slice(&extra_args);

        let _entered = self.vm().enter_event_loop_scope_without_checkpoint();
        let response_value = match callback.call(global, server_js, &args) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        let Some(ctx) = ServerRequestContext::respond(ctx, self, request.to_js(), response_value)
        else {
            return;
        };

        // The request is asynchronous, and all information from `req` must be copied
        // since the provided uws.Request will be re-used for future requests (stack allocated).
        match req {
            SavedRequestUnion::Stack(r) => {
                ctx.to_async(
                    std::ptr::from_ref::<uws::Request>(r)
                        .cast_mut()
                        .cast::<c_void>(),
                    &request,
                );
            }
            SavedRequestUnion::Saved(_) => {} // info already copied
        }
    }

    /// Invoke the JS-side
    /// `node:http` request handler (`NodeHTTPServer__onRequest_{http,https}`),
    /// then drive the returned promise / [`NodeHTTPResponse`] through the
    /// completion / abort / error paths.
    pub(crate) fn on_node_http_request(
        &self,
        req: &mut uws_sys::Request,
        resp: &mut uws_sys::NewAppResponse<SSL>,
    ) {
        use bun_http_jsc::method_jsc::MethodJsc as _;
        use node_http_response::Flags as NhrFlags;

        jsc::mark_binding!();

        if self.js_value_for_dispatch().is_none() {
            server_body::respond_stopped_503(any_response_from::<SSL>(resp));
            return;
        }
        let vm = self.vm();
        let _entered = vm.enter_event_loop_scope_without_checkpoint();
        // The listener and what it starts continue the script that made the server.
        let _context = vm.enter_context(self.context.get());
        req.set_yield(false);

        let global = self.global_this();

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
        let callback = self.config.get().on_node_http_request;
        // C++ forwards `any_server` to `NodeHTTPResponse::create`, which
        // unpacks it via `any_server_from_packed` (bits 49..64 = variant tag);
        // a raw `*mut Self` would zero those bits and trip the dispatch
        // `unreachable!`, so the packed tagged-pointer wire format is needed.
        // Computed once in `init()` (stable heap address) — just load it.
        let any_server_packed = self.any_server_packed;

        let mut node_http_response = None;

        let on_request_ffi = if SSL {
            ffi::NodeHTTPServer__onRequest_https
        } else {
            ffi::NodeHTTPServer__onRequest_http
        };
        let result: JSValue = bun_jsc::host_fn::from_js_host_call(global, || {
            on_request_ffi(
                any_server_packed,
                global,
                callback,
                method_string,
                req,
                std::ptr::from_mut::<uws_sys::NewAppResponse<SSL>>(resp).cast(),
                &mut node_http_response,
            )
        })
        .unwrap_or_else(|err| global.take_exception(err));

        let Some(nhr) = node_http_response else {
            // The request never reached the handler: an exception (in practice
            // a termination request landing in the header conversion) unwound
            // before the response object existed. Nothing adopted the response;
            // answer it natively as above.
            if !result.is_empty() && !result.is_termination_exception() {
                let _ = self.vm().uncaught_exception(global, result, false);
            }
            server_body::respond_stopped_503(any_response_from::<SSL>(resp));
            return;
        };
        nhr.flags
            .set(nhr.flags.get().difference(NhrFlags::IN_LISTENER));

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
                    vm.drain_microtasks();
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
                        let over = NhrFlags::REQUEST_HAS_COMPLETED | NhrFlags::SOCKET_CLOSED;
                        if nhr.flags.get().intersects(over) {
                            break 'brk HttpResult::Success;
                        }

                        let strong_self = nhr.get_this_value();
                        if strong_self.is_empty_or_undefined_or_null() {
                            break 'brk HttpResult::Success;
                        }

                        nhr.promise
                            .set(Some((core::mem::take(&mut strong_promise), nhr.clone())));
                        result.then2(
                            global,
                            strong_self,
                            crate::generated_bindgen::node_http_response::Bun__NodeHTTPRequest__onResolve,
                            crate::generated_bindgen::node_http_response::Bun__NodeHTTPRequest__onReject,
                        );

                        break 'brk HttpResult::Pending;
                    }
                }
            }

            HttpResult::Success
        };

        match &http_result {
            HttpResult::Exception(err) | HttpResult::Rejection(err) => {
                let _ = self.vm().uncaught_exception(
                    global,
                    *err,
                    matches!(http_result, HttpResult::Rejection(_)),
                );

                nhr.on_dispatch_threw();
            }
            HttpResult::Success | HttpResult::Pending => {}
        }

        let nhr_flags = nhr.flags.get();
        if let Some(raw) = nhr.reader() {
            if !nhr_flags.contains(NhrFlags::REQUEST_HAS_COMPLETED)
                && raw.state().is_response_pending()
            {
                nhr.set_on_aborted_handler();
            }
            // If we ended the response without attaching an ondata handler, we discard the body read stream
            else if !matches!(http_result, HttpResult::Pending) {
                let this_value = nhr.get_this_value();
                nhr.maybe_stop_reading_body(this_value);
            }
        }

        drop(strong_promise);
        if needs_to_drain {
            vm.drain_microtasks();
        }
    }

    fn js_route_list_get_cached(server_js: JSValue) -> Option<JSValue> {
        server_js_cached!(SSL, DEBUG, route_list_get_cached(server_js))
    }

    // `js_gc_route_list_set` and the per-callback slot setters live with the
    // `slot_setter!` invocations below.

    pub(crate) fn set_node_http_flags(&self, lenient_http_flags: u8, http_allow_half_open: bool) {
        if let Some(app) = self.app() {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            bun_opaque::opaque_deref_mut(app).set_flags(lenient_http_flags, http_allow_half_open);
        }
    }

    pub(crate) fn set_max_http_header_size(&self, max_header_size: u64) {
        if let Some(app) = self.app() {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            bun_opaque::opaque_deref_mut(app).set_max_http_header_size(max_header_size);
        }
    }

    pub(crate) fn set_max_headers_count(&self, max_headers_count: u32) {
        if let Some(app) = self.app() {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            bun_opaque::opaque_deref_mut(app).set_max_headers_count(max_headers_count);
        }
    }

    // ─── lifecycle ───────────────────────────────────────────────────────────

    fn on_pending_request(&self) {
        self.pending_requests.set(self.pending_requests.get() + 1);
    }

    #[inline]
    fn on_request_complete(&self) {
        self.pending_requests.set(self.pending_requests.get() - 1);
        self.apply_phase();
    }

    /// A parked node:http request holds neither the loop nor `stop()`. Its connection reports `-3` next, which applies the phase.
    pub(crate) fn note_request_parked(&self, parked: bool) {
        let count = self.parked_request_count.get();
        self.parked_request_count
            .set(if parked { count + 1 } else { count - 1 });
    }

    fn note_connection_idle(&self, idle: bool) {
        let count = self.idle_connection_count.get();
        // `AsyncSocketData::filteredParked` pairs every -3 with one +3 or -4.
        debug_assert!(idle || count > 0);
        self.idle_connection_count.set(if idle {
            count + 1
        } else {
            count.saturating_sub(1)
        });
    }

    /// uWS filter. `+2`: accepted, before any TLS handshake. `-2`: closed, handed to another owner (a WebSocket, the socket of 'connect' / 'upgrade'), or only lingering. `-3`: a node:http connection becomes idle (it doesn't read and has nothing to send). `+3`: it has bytes to send or reads again. `-4`: it closes idle.
    extern "C" fn on_connection_filter(
        _socket: *mut uws_sys::us_socket_t,
        opened: i32,
        user_data: *mut c_void,
    ) {
        // SAFETY: `user_data` is the `*mut Self` registered in `listen()`; the server outlives every socket in its app.
        let this = unsafe { &*user_data.cast::<Self>() };
        let connections = &this.active_connection_count;
        match opened {
            2 => {
                connections.set(connections.get().saturating_add(1));
                return;
            }
            3 => {
                this.note_connection_idle(false);
                // With a listener open, the loop ref is the user's to drop (`server.unref()`).
                if !this.has_listener() {
                    this.ref_();
                }
                return;
            }
            -3 => this.note_connection_idle(true),
            -4 => {
                this.note_connection_idle(false);
                connections.set(connections.get().saturating_sub(1));
            }
            -2 => connections.set(connections.get().saturating_sub(1)),
            _ => return,
        }
        this.apply_phase();
    }

    /// quic.cpp closed the HTTP/3 UDP socket and the last QUIC connection is gone ([`Self::has_open_h3_transport`]).
    extern "C" fn on_h3_released(user_data: *mut c_void) {
        // SAFETY: `user_data` is the `*mut Self` registered in `listen()`, and quic.cpp drops the
        // hook before it frees the app's context, so the server is alive. This can run inside
        // lsquic's `process_conns`: `apply_phase` reads cells and queues tasks, it doesn't
        // enter the engine. Under the H3 close calls in `stop_listening` it returns at once.
        unsafe { &*user_data.cast::<Self>() }.apply_phase();
    }

    /// Returns true if the HTTP/3 app still has its UDP socket or a QUIC connection. [`Self::on_h3_released`] runs when both are gone.
    fn has_open_h3_transport(&self) -> bool {
        Self::HAS_H3
            && self
                .h3_app()
                // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                .is_some_and(|h3a| !bun_opaque::opaque_deref_mut(h3a).is_released())
    }

    pub(crate) fn has_listener(&self) -> bool {
        self.listener().is_some() || (Self::HAS_H3 && self.h3_listener.get().is_some())
    }

    fn phase(&self) -> Phase {
        if self.has_listener() {
            return Phase::Listening;
        }
        let requests = self.pending_requests.get();
        let connections = self.active_connection_count.get();
        if requests > self.parked_request_count.get()
            || connections > self.idle_connection_count.get()
            || self.active_websocket_count.get() > 0
            || self.has_open_h3_transport()
        {
            Phase::Stopping
        } else if requests > 0 || connections > 0 {
            Phase::Closed
        } else {
            Phase::Drained
        }
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.phase() >= Phase::Closed
    }

    pub(crate) fn is_drained(&self) -> bool {
        self.phase() == Phase::Drained
    }

    pub(crate) fn ref_(&self) {
        // Nothing would unref a closed server again, so a ref taken now would pin the process.
        if !self.is_closed() {
            self.poll_ref.ref_(self.vm.loop_ctx());
        }
    }

    pub(crate) fn unref(&self) {
        self.poll_ref.unref(self.vm.loop_ctx());
    }

    /// Runs `close`, which closes sockets whose close callbacks report back to this server. The caller runs `apply_phase` afterwards.
    fn while_closing<R>(&self, close: impl FnOnce() -> R) -> R {
        let _held = self.phase_held.set_for_scope(true);
        close()
    }

    fn with_websocket_handler(&self, update: impl FnOnce(&mut WebSocketServerHandler)) {
        self.config.with_mut(|config| {
            if let Some(ws) = config.websocket.as_mut() {
                update(&mut ws.handler);
            }
        });
    }

    /// Closes the listener, every connection and every WebSocket now. `thread_ends`: see `thread_ends` in libusockets.h.
    fn terminate(&self, thread_ends: bool) {
        if self.terminated.replace(true) {
            return;
        }
        self.with_websocket_handler(|handler| handler.app = None);
        if let Some(app) = self.app() {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            let app = bun_opaque::opaque_deref_mut(app);
            self.while_closing(|| {
                if thread_ends {
                    app.close_as_thread_ends()
                } else {
                    app.close()
                }
            });
        }
        // Not before the close: `on_close` reaches `on_websocket_closed` through `handler.server`.
        self.with_websocket_handler(|handler| handler.server = None);
    }

    fn stop_listening(&self, connections: Connections) {
        let abrupt = connections != Connections::Keep;
        // A graceful stop leaves connections open, and this handle is how their context's stop reaches them.
        if abrupt {
            self.abort_handle.leave();
        }

        if Self::HAS_H3 {
            let h3l = self.h3_listener.take();
            // Graceful: GOAWAY, then the open UDP socket drains the connections. Abrupt: close the fd now.
            self.while_closing(|| {
                if !abrupt {
                    if let (Some(h3l), Some(h3a)) = (h3l, self.h3_app()) {
                        // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                        bun_opaque::opaque_deref_mut(h3a).close();
                        self.h3_draining_listener.set(Some(h3l));
                    }
                } else if let Some(h3l) = h3l.or_else(|| self.h3_draining_listener.take()) {
                    // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                    bun_opaque::opaque_deref_mut(h3l).close();
                }
            });
        }

        let listener = self.listener.take();
        // A graceful stop keeps the loop ref until `Phase::Closed`: on Windows uv_run skips I/O with zero ref'd handles.
        if abrupt {
            self.unref();
        }
        self.notify_inspector_server_stopped();

        let was_listening = listener.is_some();
        if let Some(listener) = listener {
            if !SSL {
                let fd = bun_opaque::opaque_deref_mut(listener.as_ptr())
                    .socket()
                    .fd();
                self.vm().remove_listening_socket_for_watch_mode(fd);
            }
            match &self.config.get().address {
                // The socket file of an inherited descriptor belongs to the process that bound it.
                server_config::Address::Unix(path) if self.config.get().listen_fd.is_none() => {
                    let bytes = path.as_bytes();
                    if !bytes.is_empty() && bytes[0] != 0 {
                        let _ = bun_sys::unlink(path.as_zstr());
                    }
                }
                server_config::Address::Unix(_) | server_config::Address::Tcp { .. } => {}
            }
        }

        if abrupt {
            self.terminate(connections == Connections::CloseAsThreadEnds);
        } else if was_listening
            // Node's `close()` sweeps idle connections once, from JS, and a response that completes later keeps its connection.
            && !self.config.get().is_node_http_server
            && let Some(app) = self.app()
        {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
            self.while_closing(|| bun_opaque::opaque_deref_mut(app).close_idle_connections(true));
        }
    }

    /// `CloseAsThreadEnds`: the abrupt stop of a server whose thread ends (see `thread_ends` in libusockets.h).
    pub(crate) fn stop(&self, connections: Connections) {
        if self.config.get().allow_hot && !self.config.get().id.is_empty() {
            if let Some(hot) = self.vm().hot_map() {
                hot.remove(&self.config.get().id);
            }
        }

        self.stop_listening(connections);
        self.apply_phase();
    }

    /// Does what [`Self::phase`] allows. Whoever reports that a listener, request, connection or WebSocket is gone calls this.
    #[inline]
    pub(crate) fn apply_phase(&self) {
        if !self.has_listener() && !self.phase_held.get() {
            self.apply_phase_without_listener();
        }
    }

    #[cold]
    #[optimize(size)]
    fn apply_phase_without_listener(&self) {
        let phase = self.phase();
        if phase < Phase::Closed {
            return;
        }
        // `drop(dev)` can report completed requests, and `schedule_deinit` must not free `self` in this frame.
        let _held = self.phase_held.raise_for_scope();

        // At VM shutdown no tick would run the task.
        if self.all_closed_promise.get().has_value() && !self.vm().is_shutting_down() {
            let vm_ref = self.vm();
            ServerAllConnectionsClosedTask::schedule(
                ServerAllConnectionsClosedTask {
                    global_object: self.global_this,
                    promise: self.all_closed_promise.with_mut(|promise| promise.take()),
                    tracker: jsc::AsyncTaskTracker::init(vm_ref),
                    context: self.context.get(),
                },
                vm_ref,
            );
        }
        self.unref();

        if phase == Phase::Drained {
            self.abort_handle.leave();
            // The wrapper is the handlers' only GC root.
            self.js_value.with_mut(|js_value| js_value.downgrade());
            self.with_websocket_handler(|handler| {
                handler.app = None;
                handler.server = None;
            });
            self.ws_package_handler.with_mut(|handler| {
                if let Some(handler) = handler.as_mut() {
                    handler.app = None;
                    handler.server = None;
                }
            });

            // Keeping the JS binding alive should not pin `dev.memory_cost()` bytes.
            if let Some(dev) = self.dev_server.take() {
                if let Some(app) = self.app() {
                    // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(app).clear_routes();
                }
                drop(dev);
            }

            drop(self.open_ref.take());
        }
    }

    /// The last ref is gone: the JS wrapper is collected and the server is drained.
    fn schedule_deinit(this: *mut Self) {
        // SAFETY: `this` stays allocated until it is destroyed below or by the task.
        let server = unsafe { &*this };

        if server.vm().is_shutting_down() {
            // No more ticks.
            if !server.phase_held.get() {
                // SAFETY: the box from `init`, and the last ref is gone.
                unsafe { bun_core::heap::destroy(this) };
            }
            return;
        }

        server.vm().enqueue_task(bun_event_loop::Task::init(
            this.cast::<ServerDeinitTask<SSL, DEBUG>>(),
        ));
    }

    pub(crate) fn on_listen(
        &self,
        listened: Result<uws_sys::app::OwnedListenSocket<SSL>, uws_sys::app::ListenError>,
    ) {
        let listener = match listened {
            Ok(listener) => listener,
            Err(failure) => return self.on_listen_failed(failure),
        };
        let socket = listener.as_ptr();
        self.listener.set(Some(listener));
        // `None` for a unix socket.
        if let Some(port) = bun_opaque::opaque_deref_mut(socket).get_local_port() {
            self.base_url_string_for_joining
                .set(self.config.get().base_url_string_for_joining(Some(port)));
        }
        self.vm().event_loop_handle.set(Some(bun_io::Loop::get()));
        if !SSL {
            // S008: `app::ListenSocket<SSL>` is a ZST opaque — safe deref.
            let fd = bun_opaque::opaque_deref_mut(socket).socket().fd();
            self.vm().add_listening_socket_for_watch_mode(fd);
        }
    }

    #[cold]
    fn on_listen_failed(&self, failure: uws_sys::app::ListenError) {
        use crate::socket::uws_jsc::{ListenApi, ListenTarget, throw_listen_error};
        let config = self.config.get();
        let target = match (config.listen_fd, &config.address) {
            (Some(_), _) => ListenTarget::Fd,
            (None, server_config::Address::Tcp { port, hostname }) => ListenTarget::Tcp {
                hostname: hostname.as_ref().map(|hostname| hostname.as_bytes()),
                port: *port,
            },
            (None, server_config::Address::Unix(path)) => ListenTarget::Unix(path.as_bytes()),
        };
        let _ = throw_listen_error(self.global_this(), ListenApi::BunServe, &target, failure);
    }

    pub(crate) fn on_h3_listen(&self, socket: Option<*mut uws_sys::h3::ListenSocket>) {
        if !Self::HAS_H3 {
            return;
        }
        let Some(socket) = socket else { return };
        // S008: `h3::ListenSocket` is an `opaque_ffi!` ZST — safe deref.
        let port = bun_opaque::opaque_deref_mut(socket).get_local_port();
        self.h3_listener.set(Some(socket));
        if let Some(port) = port {
            self.h3_alt_svc.set(
                format!("h3=\":{port}\"; ma=86400")
                    .into_bytes()
                    .into_boxed_slice(),
            );
            // With `http1: false` this is the only listener.
            self.base_url_string_for_joining
                .set(self.config.get().base_url_string_for_joining(Some(port)));
        }
        // An `http3_server` feature counter is not (yet) declared in
        // `bun_analytics`. No-op until it is.
    }

    pub(crate) fn app(&self) -> Option<*mut uws_sys::NewApp<SSL>> {
        self.app.get().as_ref().map(|app| app.as_ptr())
    }

    pub(crate) fn listener(&self) -> Option<*mut uws_sys::app::ListenSocket<SSL>> {
        self.listener.get().as_ref().map(|socket| socket.as_ptr())
    }

    pub(crate) fn h2_app(&self) -> Option<*mut uws_sys::h2::App> {
        self.h2_app.get().as_ref().map(|app| app.as_ptr())
    }

    pub(crate) fn h3_app(&self) -> Option<*mut uws_sys::h3::App> {
        self.h3_app.get().as_ref().map(|app| app.as_ptr())
    }

    pub(crate) fn set_using_custom_expect_handler(&self, value: bool) {
        if let Some(app) = self.app() {
            ffi::NodeHTTP_setUsingCustomExpectHandler(SSL, app.cast::<c_void>(), value);
        }
    }

    // ─── init ────────────────────────────────────────────────────────────────
    /// Allocate and populate a `NewServer` from `config`. The config is moved
    /// into the server (left as `Default` in the caller's slot). Route
    /// registration and the listen socket happen later in `listen()`.
    pub(crate) fn init(
        config: &mut ServerConfig,
        global: &JSGlobalObject,
    ) -> JsResult<bun_ptr::AliasableBox<Self>> {
        let base_url = config.base_url_string_for_joining(None);

        let mut owner = bun_ptr::AliasableBox::new(Self {
            ref_count: bun_ptr::RefCount::init(),
            open_ref: Cell::new(None),
            global_this: std::ptr::from_ref(global),
            // Set below, once the server has its final (stable) heap address.
            any_server_packed: 0,
            method_name_cache: [const { core::cell::Cell::new(JSValue::ZERO) }; N_HTTP_METHODS],
            config: JsCell::new(core::mem::take(config)),
            base_url_string_for_joining: JsCell::new(base_url),
            vm: bun_ptr::BackRef::new(jsc::VirtualMachine::get()),
            dev_server: JsCell::new(None),
            app: JsCell::new(None),
            listener: JsCell::new(None),
            h3_app: JsCell::new(None),
            h2_app: JsCell::new(None),
            h3_listener: core::cell::Cell::new(None),
            h3_draining_listener: core::cell::Cell::new(None),
            h3_alt_svc: JsCell::new(Box::<[u8]>::default()),
            js_value: JsCell::new(jsc::JsRef::empty()),
            pending_requests: core::cell::Cell::new(0),
            active_connection_count: core::cell::Cell::new(0),
            idle_connection_count: core::cell::Cell::new(0),
            parked_request_count: core::cell::Cell::new(0),
            active_websocket_count: core::cell::Cell::new(0),
            phase_held: core::cell::Cell::new(false),
            abort_handle: jsc::AbortHandle::for_owner::<Self>(),
            context: core::cell::Cell::new(jsc::ContextId::default()),
            request_pool: crate::jsc_hooks::request_pools(global.bun_vm()).get(),
            mux_request_pool: core::cell::Cell::new(core::ptr::null()),
            all_closed_promise: JsCell::new(jsc::JSPromiseStrong::default()),
            poll_ref: KeepAlive::default(),
            terminated: core::cell::Cell::new(false),
            plugins: JsCell::new(None),
            user_routes: JsCell::new(Vec::new()),
            on_clienterror: core::cell::Cell::new(JSValue::ZERO),
            node_socket_config: JsCell::new(None),
            inspector_server_id: core::cell::Cell::new(jsc::DebuggerId::init(0)),
            ws_package_handler: JsCell::new(None),
            _pin: core::marker::PhantomPinned,
        });

        // The packed `AnyServer` is a pure function of the (now-stable) heap
        // address and the const variant tag; cache it so the per-request
        // `node:http` prologue is a plain field load instead of a tag match +
        // `TaggedPtr::init`.
        owner.any_server_packed = AnyServer::from(owner.as_ptr().cast_const()).to_packed() as usize;

        // The bake options (`root`, and the arena the transpilers live in) are in
        // `owner.config.bake` for the server's lifetime. Initialise
        // DevServer AFTER the server box exists so the `Options::arena` borrow
        // points into the heap-allocated config rather than the caller's
        // (since-moved) stack slot. On Err, dropping `owner` frees the
        // half-built server.
        owner.init_dev_server()?;

        if SSL {
            bun_analytics::features::https_server.fetch_add(1, Ordering::Relaxed);
        } else {
            bun_analytics::features::http_server.fetch_add(1, Ordering::Relaxed);
        }

        Ok(owner)
    }

    /// Creates the DevServer from `self.config.bake`, which must already be at its final heap address.
    fn init_dev_server(&self) -> JsResult<()> {
        // SAFETY: JS thread only; both callers hold no other borrow of the config.
        let config = unsafe { self.config.get_mut() };
        let Some(bake_options) = &mut config.bake else {
            return Ok(());
        };
        let mut dev = crate::bake::DevServer::init(crate::bake::DevServer::Options {
            arena: &bake_options.arena,
            root: bake_options.root.as_zstr(),
            // SAFETY: per-thread VM singleton; STATIC lifetime.
            vm: jsc::VirtualMachine::get(),
            framework: core::mem::take(&mut bake_options.framework),
            bundler_options: core::mem::take(&mut bake_options.bundler_options),
            broadcast_console_log_from_browser_to_server: config
                .broadcast_console_log_from_browser_to_server_for_bake,
        })?;
        // A reload gets here after `set_inspector_server_id` ran.
        dev.inspector_server_id = self.inspector_server_id.get();
        self.dev_server.set(Some(dev));
        Ok(())
    }

    /// Registers a static route on the HTTP/1 app and on the attached HTTP/2 and HTTP/3 apps.
    fn register_static_route<T: server_config::StaticRouteLike>(
        &self,
        route: &bun_ptr::RefPtr<T>,
        entry: &server_config::StaticRouteEntry,
        path_has_user_head_route: bool,
    ) {
        let server = AnyServer::from(std::ptr::from_ref(self));
        let (path, method) = (&entry.path[..], entry.method);
        // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref. `listen()` set it.
        let app = bun_opaque::opaque_deref_mut(self.app().unwrap());
        server_config::apply_static_route(
            server,
            app,
            route,
            path,
            method,
            path_has_user_head_route,
        );
        for_each_mux_app!(self, |mux| {
            server_config::apply_static_route(
                server,
                mux,
                route,
                path,
                method,
                path_has_user_head_route,
            );
        });
    }

    // ─── set_routes ──────────────────────────────────────────────────────────
    /// Register HTTP routes on `self.app` (and `h2_app`/`h3_app` when present). Returns
    /// the JS `RouteList` value for codegen-backed user routes, or `.zero` when
    /// there are none.
    #[optimize(size)]
    fn set_routes(&self) -> JSValue {
        use bun_http_types::Method as http_method;
        let mut route_list_value = JSValue::ZERO;
        // S008: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        // set_routes is only called after `self.app` is set in listen().
        let app = bun_opaque::opaque_deref_mut(self.app().unwrap());
        let self_ptr: *mut Self = self.as_ctx_ptr();
        let any_server = AnyServer::from(self_ptr.cast_const());
        // Raw, so that each use below derives its own `&mut DevServer`.
        let dev_server: Option<*mut crate::bake::DevServer::DevServer> = self
            .dev_server
            .with_mut(|dev| dev.as_deref_mut().map(std::ptr::from_mut));

        // https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/ecosystem/automatic_workspace_folders.md
        // Only enable this when we're using the dev server.
        let mut should_add_chrome_devtools_json_route = DEBUG
            && self.config.get().allow_hot
            && dev_server.is_some()
            && self
                .config
                .get()
                .enable_chrome_devtools_automatic_workspace_folders;
        const CHROME_DEVTOOLS_ROUTE: &[u8] = b"/.well-known/appspecific/com.chrome.devtools.json";

        // --- 1. user_routes_to_build → user_routes + RouteList JS object ---
        if !self.config.get().user_routes_to_build.is_empty() {
            let mut to_build = self
                .config
                .with_mut(|config| core::mem::take(&mut config.user_routes_to_build));
            let len = to_build.len();
            let mut user_routes = Vec::with_capacity(len);
            let mut callbacks: Vec<JSValue> = Vec::with_capacity(len);
            for (i, builder) in to_build.iter_mut().enumerate() {
                callbacks.push(builder.callback.get());
                user_routes.push(UserRoute {
                    id: i as u32,
                    server: self_ptr,
                    route: core::mem::take(&mut builder.route),
                });
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
        self.config.with_mut(|config| {
            if let Some(websocket) = config.websocket.as_mut() {
                websocket.handler.app = Some(bun_ptr::BackRef::new(app.web_sockets()));
                websocket.handler.server = Some(any_server);
            }
        });

        // --- 3. Register compiled user routes & track "/*" coverage ---
        let mut has_any_method_route_for_star_path = false;
        let mut has_any_ws_route_for_star_path = false;

        let websocket_ptr = self.config.get().websocket.as_ref();
        let user_routes = self.user_routes.get();

        for user_route in user_routes {
            let ud: *mut c_void = core::ptr::from_ref(user_route).cast_mut().cast();
            let path = user_route.route.path.as_bytes();
            let is_star_path = path == b"/*";
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
                    for_each_mux_app!(self, |mux| {
                        mux.any(
                            path,
                            ud.cast::<UserRoute<SSL, DEBUG>>(),
                            Self::on_mux_user_route_request,
                        );
                    });
                    if is_star_path {
                        has_any_method_route_for_star_path = true;
                    }
                    if let Some(websocket) = websocket_ptr {
                        if is_star_path {
                            has_any_ws_route_for_star_path = true;
                        }
                        app.ws::<Self, ServerWebSocket>(
                            path,
                            ud,
                            1, // id 1 means is a user route
                            websocket.to_behavior(),
                            self_ptr.cast::<c_void>(),
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
                    for_each_mux_app!(self, |mux| {
                        mux.method(
                            method_val,
                            path,
                            ud.cast::<UserRoute<SSL, DEBUG>>(),
                            Self::on_mux_user_route_request,
                        );
                    });
                    // Setup user websocket in the route if needed.
                    if let Some(websocket) = websocket_ptr {
                        // Websocket upgrade is a GET request
                        if method_val == http_method::Method::GET {
                            app.ws::<Self, ServerWebSocket>(
                                path,
                                ud,
                                1, // id 1 means is a user route
                                websocket.to_behavior(),
                                self_ptr.cast::<c_void>(),
                            );
                        }
                    }
                }
            }
        }

        // --- 4. Register negative routes ---
        // A `false` route means "fall through to the default handler": same
        // handler as the `/*` fallback in step 9. H2/H3 stay on on_mux_request,
        // which already falls back to on_mux_404 when on_request is empty.
        let default_h1 = if !self.config.get().on_node_http_request.is_empty() {
            trampoline::on_node_http_request::<SSL, DEBUG>
        } else if !self.config.get().on_request.is_empty() {
            trampoline::on_request::<SSL, DEBUG>
        } else {
            trampoline::on_404::<SSL, DEBUG>
        };
        for route_path in self.config.get().negative_routes.iter() {
            let p = route_path.as_bytes();
            app.head(p, Some(default_h1), self_ptr.cast());
            app.any(p, Some(default_h1), self_ptr.cast());
            for_each_mux_app!(self, |mux| {
                mux.head(p, self_ptr, Self::on_mux_request);
                mux.any(p, self_ptr, Self::on_mux_request);
            });
        }

        // --- 5. Register static routes & track "/*" coverage ---
        let mut needs_plugins = dev_server.is_some();

        for entry in &self.config.get().static_routes {
            if &*entry.path == b"/*" && matches!(entry.method, server_config::MethodOptional::Any) {
                has_any_method_route_for_star_path = true;
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
            let path_has_user_head_route =
                user_routes.iter().any(|route| match &route.route.method {
                    server_config::RouteMethod::Specific(method) => {
                        *method == http_method::Method::HEAD
                            && route.route.path.as_bytes() == &*entry.path
                    }
                    server_config::RouteMethod::Any => false,
                });

            match &entry.route {
                AnyRoute::Static(r) => {
                    self.register_static_route(r, entry, path_has_user_head_route);
                }
                AnyRoute::File(r) => {
                    self.register_static_route(r, entry, path_has_user_head_route);
                }
                AnyRoute::Directory(r) => {
                    self.register_static_route(r, entry, path_has_user_head_route);
                }
                AnyRoute::Html(r) => {
                    self.register_static_route(r, entry, path_has_user_head_route);
                    if let Some(dev) = dev_server {
                        // SAFETY: `dev` is the live `*mut DevServer` snapshotted
                        // from `self.dev_server` above; no other `&mut` to it
                        // is live in this loop.
                        bun_core::handle_oom(
                            unsafe { &mut *dev }.html_router.put(&entry.path, r.clone()),
                        );
                    }
                    needs_plugins = true;
                }
                AnyRoute::FrameworkRouter => {}
            }
        }

        // --- 6. Initialize plugins if needed ---
        if needs_plugins && self.plugins.get().is_none() {
            // Cloning here (not `.take()`) so subsequent `Bun.serve()` calls in
            // the same process — and `DevServer`'s tailwind-hack probe of the
            // same field — still see the bunfig-configured plugin list.
            let vm = jsc::VirtualMachine::get();
            let names = vm
                .transpiler
                .get()
                .options
                .serve_plugins
                .clone()
                .unwrap_or_default();
            // `load_and_resolve_plugins` adds the plugins of `bake.config.ts`.
            if !names.is_empty() || vm.bake_config_plugins.get().has() {
                self.plugins.set(Some(ServePlugins::init(names)));
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
        // (which is H1-only and not mirrored to the H2/H3 routers) marks it full.
        let mux_has_any_method_route_for_star_path = has_any_method_route_for_star_path;

        // --- 8. Handle DevServer routes & track "/*" coverage ---
        if let Some(dev) = dev_server {
            // dev.setRoutes might register its own "/*" HTTP handler
            // SAFETY: `dev` is the live `*mut DevServer` snapshotted from
            // `self.dev_server` above; no other `&mut` to it is live.
            let has_dev_server_for_star_path =
                bun_core::handle_oom(unsafe { &mut *dev }.set_routes::<SSL, DEBUG>(self));
            if has_dev_server_for_star_path {
                // Assume dev server "/*" covers all methods if it exists
                has_any_method_route_for_star_path = true;
            }
        }

        // Setup user websocket fallback route aka fetch function; if fetch is
        // not provided will respond with 403.
        if !has_any_ws_route_for_star_path {
            if let Some(websocket) = websocket_ptr {
                app.ws::<Self, ServerWebSocket>(
                    b"/*",
                    self_ptr.cast(),
                    0, // id 0 means is a fallback route and ctx is the server
                    websocket.to_behavior(),
                    self_ptr.cast::<c_void>(),
                );
            }
        }

        // --- 9. Consolidated "/*" HTTP fallback registration ---
        let ud = self_ptr.cast::<c_void>();
        // An any-method route runs after a "/*" route for one method: it takes the other methods and the requests that route yields.
        if !has_any_method_route_for_star_path {
            app.any(b"/*", Some(default_h1), ud);
        }

        // H2/H3 fallback: the same, but only user and static "/*" routes count (DevServer routes are not mirrored to H2/H3).
        if !mux_has_any_method_route_for_star_path {
            let has_on_request = !self.config.get().on_request.is_empty();
            for_each_mux_app!(self, |mux| {
                if has_on_request {
                    mux.any(b"/*", self_ptr, Self::on_mux_request);
                } else {
                    mux.any(b"/*", self_ptr, Self::on_mux_404);
                }
            });
        }

        if should_add_chrome_devtools_json_route {
            app.get(
                CHROME_DEVTOOLS_ROUTE,
                Some(trampoline::on_chrome_devtools_json_request::<SSL, DEBUG>),
                ud,
            );
        }

        // Idempotent, so re-running set_routes on reload() is fine.
        if self.config.get().is_node_http_server {
            ffi::NodeHTTP_assignOnNodeJSCompat(SSL, std::ptr::from_mut(app).cast::<c_void>());
        }

        route_list_value
    }

    // ─── listen ──────────────────────────────────────────────────────────────
    /// `config.http2`: attach an HTTP/2 context to `app`. On failure an
    /// exception is pending and `false` returned.
    fn attach_http2(&self, app: *mut uws_sys::NewApp<SSL>) -> bool {
        let (http2, is_node_http, http1, idle_timeout, max_request_body_size, has_dev_server) = {
            let cfg = self.config.get();
            (
                cfg.http2,
                cfg.is_node_http_server || !cfg.on_node_http_request.is_empty(),
                cfg.http1,
                u32::from(cfg.idle_timeout),
                cfg.max_request_body_size as u64,
                self.dev_server.get().is_some(),
            )
        };
        if !http2 {
            return true;
        }
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
                return false;
            }
            bun_core::warn!("http2: true is ignored {}", why);
            return true;
        }
        // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        let Some(h2) = create_http2_app::<SSL>(
            bun_opaque::opaque_deref_mut(app),
            http1,
            idle_timeout,
            max_request_body_size,
        ) else {
            let global = self.global_this();
            if !global.has_exception() {
                let _ = global.throw(format_args!("Failed to create HTTP/2 server"));
            }
            return false;
        };
        // Streams parked on socket backpressure by a JS-driven write get their
        // next drain pass from the event loop's deferred task queue (after the
        // current task and its microtasks), like the HTTP/1 sink's auto-flush.
        extern "C" fn schedule_h2_drain(app: *mut c_void, _ctx: *mut c_void) {
            extern "C" fn drain(app: *mut c_void) -> bool {
                // S012: `h2::App` is an `opaque_ffi!` ZST — safe deref.
                let queued = bun_opaque::opaque_deref_mut(app.cast::<uws_sys::h2::App>()).drain();
                let vm = jsc::VirtualMachine::get();
                // It resumes parked streams: a `pull()`, or a promise that script awaits.
                vm.deferred_task_called_js.set(true);
                if queued {
                    // That script wrote to another connection.
                    vm.event_loop().deferred_tasks.count_as_posted();
                }
                queued
            }
            jsc::VirtualMachine::get()
                .event_loop()
                .deferred_tasks
                .post_task(core::ptr::NonNull::new(app), drain);
        }
        bun_opaque::opaque_deref_mut(h2.as_ptr())
            .on_schedule_drain(schedule_h2_drain, h2.as_ptr().cast::<c_void>());
        self.h2_app.set(Some(h2));
        self.init_mux_request_pool();
        true
    }

    fn init_mux_request_pool(&self) {
        let pool = crate::jsc_hooks::request_pools(self.vm()).get();
        self.mux_request_pool.set(pool.as_const_ptr());
    }

    /// Create the uws `App<SSL>` (and optional H2/H3 apps), register routes via
    /// `set_routes()`, and bind the listen socket. A failure leaves an exception pending.
    pub(crate) fn listen(
        owner: bun_ptr::AliasableBox<Self>,
    ) -> Option<(bun_ptr::RefPtr<Self>, JSValue)> {
        let this = owner.as_ptr();
        let this_ref = bun_ptr::BackRef::from(owner.as_non_null());

        // `global_this()` returns a borrow of the separate STATIC allocation,
        // not `*this`.
        let global = this_ref.global_this();

        match &this_ref.config.get().address {
            server_config::Address::Tcp {
                hostname: Some(hostname),
                ..
            } => {
                let hostname = hostname.as_bytes();
                if !bun_dns::is_valid_hostname(bun_core::ip_address::strip_ipv6_brackets(hostname))
                {
                    let _ = global.throw_value(crate::dns_jsc::answer_jsc::not_a_hostname_error(
                        global, hostname,
                    ));
                    return None;
                }
            }
            server_config::Address::Tcp { hostname: None, .. }
            | server_config::Address::Unix(_) => {}
        }

        let app: *mut uws_sys::NewApp<SSL>;
        let route_list_value;

        if SSL {
            bun_boringssl::load();
            // The options point into `config.tls`, which nothing below replaces.
            let (default_ctx, ssl_options) = match &this_ref.config.get().tls {
                ServerTls::Context(ctx) => (Some(ctx.clone()), None),
                ServerTls::Options { default, .. } => {
                    let options = default.as_usockets();
                    (create_ssl_ctx(&options), Some(options))
                }
                ServerTls::Off => (None, None),
            };
            let Some(default_ctx) = default_ctx else {
                if !global.has_exception() && !throw_ssl_error_if_necessary(global) {
                    let _ = global.throw(format_args!("Failed to create HTTP server"));
                }
                return None;
            };
            let owned = uws_sys::app::OwnedApp::<SSL>::new(Some(&default_ctx));
            app = owned.as_ptr();
            this_ref.app.set(Some(owned));

            if let Some(ssl_options) = ssl_options
                .as_ref()
                .filter(|_| Self::HAS_H3 && this_ref.config.get().http3)
            {
                let idle_timeout = this_ref.config.get().idle_timeout as u32;
                let max_request_body_size = this_ref.config.get().max_request_body_size as u64;
                let h3 = match create_http3_app(ssl_options, idle_timeout, max_request_body_size) {
                    Some(a) => Some(a),
                    None => {
                        if !global.has_exception() {
                            let _ = global.throw(format_args!("Failed to create HTTP/3 server"));
                        }
                        return None;
                    }
                };
                this_ref.h3_app.set(h3);
                this_ref.init_mux_request_pool();
            }
            if !this_ref.attach_http2(app) {
                return None;
            }

            route_list_value = this_ref.set_routes();

            if let ServerTls::Options {
                default,
                server_names,
            } = &this_ref.config.get().tls
            {
                // Its own name selects the default context ahead of a wildcard entry.
                if let Some(server_name) = default
                    .server_name_cstr()
                    .filter(|name| !name.to_bytes().is_empty())
                {
                    // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(app).add_server_name(
                        server_name,
                        &default_ctx,
                        false,
                    );
                }

                for server_name in server_names {
                    let Some(name) = server_name
                        .server_name_cstr()
                        .filter(|name| !name.to_bytes().is_empty())
                    else {
                        continue;
                    };
                    let options = server_name.as_usockets();

                    if Self::HAS_H3 {
                        if let Some(h3_app) = this_ref.h3_app() {
                            // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                            if bun_opaque::opaque_deref_mut(h3_app)
                                .add_server_name_with_options(
                                    bun_core::ZStr::from_cstr(name),
                                    &options,
                                )
                                .is_err()
                            {
                                if !global.has_exception() {
                                    let _ = global.throw(format_args!(
                                        "Failed to add serverName \"{}\" for HTTP/3",
                                        bstr::BStr::new(name.to_bytes())
                                    ));
                                }
                                return None;
                            }
                        }
                    }
                    // A build that succeeds can still leave errors queued.
                    let Some(ctx) =
                        create_ssl_ctx(&options).filter(|_| !throw_ssl_error_if_necessary(global))
                    else {
                        if !global.has_exception() && !throw_ssl_error_if_necessary(global) {
                            let _ = global.throw(format_args!(
                                "Failed to add serverName: {}",
                                bstr::BStr::new(name.to_bytes())
                            ));
                        }
                        return None;
                    };
                    // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
                    bun_opaque::opaque_deref_mut(app).add_server_name(name, &ctx, true);
                }
            }
        } else {
            let owned = uws_sys::app::OwnedApp::<SSL>::new(None);
            app = owned.as_ptr();
            this_ref.app.set(Some(owned));
            if !this_ref.attach_http2(app) {
                return None;
            }
            route_list_value = this_ref.set_routes();
        }

        // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        bun_opaque::opaque_deref_mut(app).filter(Self::on_connection_filter, this.cast::<c_void>());
        if Self::HAS_H3 {
            if let Some(h3_app) = this_ref.h3_app() {
                // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(h3_app)
                    .on_released(Self::on_h3_released, this.cast::<c_void>());
            }
        }

        bun_opaque::opaque_deref_mut(app).set_idle_timeout(this_ref.config.get().idle_timeout);
        if this_ref.config.get().is_node_http_server {
            this_ref.set_using_custom_expect_handler(true);
        } else {
            bun_opaque::opaque_deref_mut(app)
                .set_max_request_body_size(this_ref.config.get().max_request_body_size as u64);
        }

        // Owns the bracket-stripped copy of an IPv6 literal hostname; `host`
        // points into it, so it has to outlive the listen calls below.
        let mut stripped_hostname: Option<bun_core::ZBox> = None;
        // `host` and the path reference `config.address`'s backing storage, which `on_listen` and `on_h3_listen` never touch.
        enum Addr<'a> {
            Tcp { port: u16, host: *const c_char },
            Unix(&'a bun_core::ZStr),
            Fd(i32),
        }
        let (addr, tcp, options) = {
            let cfg = this_ref.config.get();
            let addr = match (cfg.listen_fd, &cfg.address) {
                (Some(fd), _) => Addr::Fd(fd),
                (None, server_config::Address::Tcp { port, hostname }) => {
                    let mut host: *const c_char = core::ptr::null();
                    if let Some(existing) = hostname.as_deref() {
                        let bytes = existing.as_bytes();
                        let bare = bun_core::ip_address::strip_ipv6_brackets(bytes);
                        host = if bare.len() == bytes.len() {
                            existing.as_ptr()
                        } else {
                            stripped_hostname
                                .insert(bun_core::ZBox::from_bytes(bare))
                                .as_ptr()
                        };
                    }
                    Addr::Tcp { port: *port, host }
                }
                (None, server_config::Address::Unix(unix)) => Addr::Unix(unix.as_zstr()),
            };
            (addr, cfg.http1 || cfg.http2, cfg.get_usockets_options())
        };

        match addr {
            Addr::Fd(fd) => {
                // 511 is net.Server's default backlog. S012: `NewApp<SSL>` is a ZST opaque — safe deref.
                let fd = fd as uws_sys::LIBUS_SOCKET_DESCRIPTOR;
                this_ref.on_listen(bun_opaque::opaque_deref_mut(app).listen_fd(fd, options));
            }
            Addr::Tcp { port, host } => {
                // With `{port: 0, http3: true}` we bind TCP:0 (kernel picks N),
                // then must bind UDP:N for QUIC so Alt-Svc works. UDP:N may
                // already be held by an unrelated process. When the user asked
                // for "any port" (0), keep TCP:N and repeat the whole TCP+UDP
                // bind, so that the kernel picks another N each time, also
                // where a whole range of UDP ports is taken. Never retry a
                // user-specified non-zero port.
                const MAX_REFUSED_PORTS: usize = 256;
                let mut refused_ports = Vec::new();
                loop {
                    if tcp {
                        // SAFETY: app is a live uws handle owned by this server.
                        let listened = unsafe {
                            (*app).listen_with_config(uws_app_c::uws_app_listen_config_t {
                                port: port as c_int,
                                host,
                                options,
                            })
                        };
                        this_ref.on_listen(listened);
                    }

                    if Self::HAS_H3 {
                        if let Some(h3_app) = this_ref.h3_app() {
                            // Same UDP port as the TCP listener so Alt-Svc works.
                            let h3_port: u16 = match this_ref.listener() {
                                // SAFETY: ls is a live uws ListenSocket FFI handle
                                // (just set by on_listen).
                                Some(ls) => bun_opaque::opaque_deref_mut(ls)
                                    .get_local_port()
                                    .unwrap_or(port),
                                None => port,
                            };
                            // S008: `h3::App` is an `opaque_ffi!` ZST — safe deref.
                            bun_opaque::opaque_deref_mut(h3_app).listen_with_config(
                                this,
                                |s: &Self, ls: Option<&mut uws_sys::h3::ListenSocket>| {
                                    s.on_h3_listen(ls.map(std::ptr::from_mut));
                                },
                                &uws_sys::h3::ListenConfig {
                                    port: h3_port,
                                    host,
                                    options,
                                },
                            );
                            if this_ref.h3_listener.get().is_none() {
                                // Only retry if TCP actually succeeded.
                                if tcp
                                    && port == 0
                                    && refused_ports.len() < MAX_REFUSED_PORTS
                                    && let Some(ls) = this_ref.listener.take()
                                {
                                    refused_ports.push(ls);
                                    continue;
                                }
                                if !global.has_exception() {
                                    let _ = global.throw(format_args!(
                                        "Failed to listen on UDP port {h3_port} for HTTP/3"
                                    ));
                                }
                            }
                            if !tcp {
                                jsc::VirtualMachine::get()
                                    .event_loop_handle
                                    .set(Some(bun_io::Loop::get()));
                            }
                        }
                    }
                    break;
                }
            }
            Addr::Unix(path) => {
                if Self::HAS_H3 {
                    if let Some(_h3_app) = this_ref.h3_app.take() {
                        // QUIC over AF_UNIX is non-standard and Alt-Svc can't
                        // advertise it; drop the H3 listener instead of wiring
                        // an exotic transport nobody can reach.
                        bun_core::warn!("http3: true with a unix socket — HTTP/3 listener skipped");
                    }
                }
                // SAFETY: app is a live uws handle owned by this server.
                let listened = unsafe { (*app).listen_on_unix_socket(path, options) };
                this_ref.on_listen(listened);
            }
        }

        if global.has_exception() {
            return None;
        }

        debug_assert!(this_ref.has_listener());
        let server = bun_ptr::RefPtr::from(owner);
        server.open_ref.set(Some(server.clone()));
        this_ref.ref_();

        // NOTE: the "starting an HTTP server is a good time to GC" nudge runs
        // from the caller (`serve_with!` in BunObject.rs) after the handler
        // callbacks are rooted in the wrapper's WriteBarrier slots; see
        // `gc_hint_after_listen` below.

        Some((server, route_list_value))
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
        if vm.aggressive_garbage_collection.get() == jsc::virtual_machine::GCLevel::Aggressive {
            vm.auto_garbage_collect();
        } else {
            vm.event_loop().perform_gc();
        }
    }
}

// ─── route-list codegen externs ──────────────────────────────────────────────
use server_body::Bun__ServerRouteList__create;

#[inline(never)]
fn create_http2_app<const SSL: bool>(
    parent: &mut uws_sys::app::App<SSL>,
    allow_http1: bool,
    idle_timeout_s: u32,
    max_request_body_size: u64,
) -> Option<uws_sys::h2::OwnedApp> {
    bun_removable_features::removable_definition!(ServeHttp2, create_http2_app::<SSL>);
    uws_sys::h2::OwnedApp::new::<SSL>(parent, allow_http1, idle_timeout_s, max_request_body_size)
}

#[inline(never)]
fn create_http3_app<const SSL: bool>(
    options: &uws_sys::BunSocketContextOptions,
    idle_timeout_s: u32,
    max_request_body_size: u64,
) -> Option<uws_sys::h3::OwnedApp<SSL>> {
    bun_removable_features::removable_definition!(Http3, create_http3_app::<SSL>);
    uws_sys::h3::OwnedApp::new(options, idle_timeout_s, max_request_body_size)
}

/// `(SSL, DEBUG)` → the generated `js_*Server` module of that class.
macro_rules! server_js_cached {
    ($ssl:expr, $debug:expr, $fn:ident($($arg:expr),* $(,)?)) => {
        match ($ssl, $debug) {
            (false, false) => $crate::generated_bindgen::server::js_HTTPServer::$fn($($arg),*),
            (true, false) => $crate::generated_bindgen::server::js_HTTPSServer::$fn($($arg),*),
            (false, true) => $crate::generated_bindgen::server::js_DebugHTTPServer::$fn($($arg),*),
            (true, true) => $crate::generated_bindgen::server::js_DebugHTTPSServer::$fn($($arg),*),
        }
    };
}
pub(crate) use server_js_cached;

// Dispatch reads from the shadow JSValue fields, not the wrapper slots, so
// only the slot setter is generated here. The slot is the GC-traced root; the
// shadow is the hot-path read.
macro_rules! slot_setter {
    ($set_fn:ident, $set_cached:ident) => {
        pub(crate) fn $set_fn(server_js: JSValue, global: &JSGlobalObject, v: JSValue) {
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
        on_node_http_request_set_cached
    );
    slot_setter!(js_gc_on_client_error_set, on_client_error_set_cached);
    slot_setter!(js_gc_socket_handlers_set, socket_handlers_set_cached);
    slot_setter!(js_gc_socket_data_set, socket_data_set_cached);
    slot_setter!(js_gc_ws_on_open_set, ws_on_open_set_cached);
    slot_setter!(js_gc_ws_on_message_set, ws_on_message_set_cached);
    slot_setter!(js_gc_ws_on_close_set, ws_on_close_set_cached);
    slot_setter!(js_gc_ws_on_drain_set, ws_on_drain_set_cached);
    slot_setter!(js_gc_ws_on_error_set, ws_on_error_set_cached);
    slot_setter!(js_gc_ws_on_ping_set, ws_on_ping_set_cached);
    slot_setter!(js_gc_ws_on_pong_set, ws_on_pong_set_cached);
    slot_setter!(
        js_gc_ws_package_handlers_set,
        ws_package_handlers_set_cached
    );

    /// Stores `handlers` (`{ message, ping, pong, drain, close }`) on the first call. Later calls
    /// are no-ops. The object is private to `ws.ts`, so user code can't modify it.
    fn init_ws_package_handlers(&self, global: &JSGlobalObject, handlers: JSValue) -> JsResult<()> {
        if self.ws_package_handler.get().is_some() {
            return Ok(());
        }
        let (Some(server_js), Some(app)) = (self.js_value_for_dispatch(), self.app()) else {
            return Ok(());
        };
        if !handlers.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("handlers must be an object")));
        }
        let mut handler = WebSocketServerHandler::from_js(global, handlers)?;
        handler.app = Some(bun_ptr::BackRef::new(
            bun_opaque::opaque_deref_mut(app).web_sockets(),
        ));
        handler.server = Some(AnyServer::from(std::ptr::from_ref::<Self>(self)));
        Self::js_gc_ws_package_handlers_set(server_js, global, handlers);
        self.ws_package_handler.set(Some(Box::new(handler)));
        Ok(())
    }

    /// The context for `ws` sockets with these options. The app creates it on first use and owns it.
    fn ws_package_context(
        &self,
        behavior: uws::WebSocketBehavior,
    ) -> Option<bun_ptr::BackRef<uws::WebSocketUpgradeContext>> {
        // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        let web_sockets = bun_opaque::opaque_deref_mut(self.app()?).web_sockets();
        Some(web_sockets.context::<server_web_socket::WsPackageSocket>(core::ptr::null(), behavior))
    }

    /// Mirror all 7 `Handler.on_*` shadows into the wrapper's `m_wsOn*`
    /// WriteBarrier slots, applying the async-context wrap (deferred from
    /// `Handler::from_js` so the wrapped fn is rooted the moment it exists).
    /// Writes all slots unconditionally — `JSValue::ZERO` clears, so a reload
    /// that omits a callback drops the previous root. Same contract as
    /// [`wrap_handler_slot`]; called after `wrap` in `serve()` and after
    /// the websocket-context swap in `apply_reload`; dispatch keeps
    /// reading the shadow.
    pub(crate) fn write_ws_handler_slots(&self, server_js: JSValue, global: &JSGlobalObject) {
        // No websocket config: route a throwaway ZERO through each slot so a
        // transition to "no websocket" drops the previous roots. Redundant on
        // initial serve (slots default ZERO) — `serve()` gates this call on
        // `websocket.is_some()` — but the doc'd contract is "writes all slots
        // unconditionally" so a future call site can't leave stale roots behind.
        let mut zeros = [JSValue::ZERO; 7];
        self.config.with_mut(|config| {
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
}

// ─── extern "C" trampolines ──────────────────────────────────────────────────
// Monomorphized on the const-generic server params;
// the bodies downcast `user_data` and forward into the typed method.
mod trampoline {
    use super::*;
    use bun_uws_sys::{Request as UwsRequest, uws_res};

    pub(super) extern "C" fn on_404<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        _req: *mut UwsRequest,
        _user_data: *mut c_void,
    ) {
        // S008: `Response<SSL>` is a ZST opaque — safe `*mut → &mut` deref.
        let resp = bun_opaque::opaque_deref_mut(res.cast::<uws_sys::NewAppResponse<SSL>>());
        resp.write_status(b"404 Not Found");
        resp.end(b"", false);
    }

    pub(super) extern "C" fn on_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // user_data is the `*mut NewServer<..>` registered in set_routes.
        NewServer::<SSL, DEBUG>::on_request::<false>(
            user_data.cast(),
            uws::AnyRequest::H1(req),
            any_response_from::<SSL>(res.cast()),
            None,
        );
    }

    pub(super) extern "C" fn on_user_route_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        NewServer::<SSL, DEBUG>::on_user_route_request::<false>(
            // SAFETY: user_data is the `*mut UserRoute<..>` registered in set_routes, a live entry of `server.user_routes`.
            unsafe { &*user_data.cast::<UserRoute<SSL, DEBUG>>() },
            uws::AnyRequest::H1(req),
            any_response_from::<SSL>(res.cast()),
            None,
        );
    }

    pub(super) extern "C" fn on_node_http_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // SAFETY: user_data is the `*mut NewServer<..>` registered in set_routes.
        let server = unsafe { &*user_data.cast::<NewServer<SSL, DEBUG>>() };
        // S008: `Request` / `Response<SSL>` are ZST opaques — safe deref.
        server.on_node_http_request(
            bun_opaque::opaque_deref_mut(req),
            bun_opaque::opaque_deref_mut(res.cast::<uws_sys::NewAppResponse<SSL>>()),
        );
    }

    pub(super) extern "C" fn on_bun_info_request<const SSL: bool, const DEBUG: bool>(
        res: *mut uws_res,
        req: *mut UwsRequest,
        user_data: *mut c_void,
    ) {
        // What leaves with the route alone is about as much as the smallest group of the trimmable link. Below that it leaves with the command line, under that name, or stays.
        if bun_removable_features::is_removed(bun_removable_features::Feature::BunInfo) {
            bun_opaque::opaque_deref_mut(req).set_yield(true);
            return;
        }
        // SAFETY: user_data is the `*mut NewServer<..>` registered in set_routes.
        // S008: `Request` / `Response<SSL>` are ZST opaques — safe deref.
        unsafe {
            (*user_data.cast::<NewServer<SSL, DEBUG>>()).on_bun_info_request(
                bun_opaque::opaque_deref_mut(req),
                bun_opaque::opaque_deref_mut(res.cast::<uws_sys::NewAppResponse<SSL>>()),
            )
        };
    }

    pub(super) extern "C" fn on_chrome_devtools_json_request<const SSL: bool, const DEBUG: bool>(
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
type RequestPool<const SSL: bool, const DEBUG: bool, const MUX: bool> =
    request_context::RequestContextStackAllocator<SSL, DEBUG, MUX>;

trait AnyRequestPool: Any {
    fn is_in_use(&self) -> bool;
}

impl<T: 'static, const N: usize> AnyRequestPool for bun_collections::hive_array::Fallback<T, N> {
    fn is_in_use(&self) -> bool {
        Self::is_in_use(self)
    }
}

/// Shared by a VM's servers, and made when the first of a kind needs it.
#[derive(Default)]
pub(crate) struct RequestPools([OnceCell<Box<dyn AnyRequestPool>>; 8]);

impl RequestPools {
    fn get<const SSL: bool, const DEBUG: bool, const MUX: bool>(
        &self,
    ) -> bun_ptr::BackRef<RequestPool<SSL, DEBUG, MUX>> {
        let index = usize::from(SSL) + 2 * usize::from(DEBUG) + 4 * usize::from(MUX);
        let pool: &dyn Any =
            &**self.0[index].get_or_init(|| RequestPool::<SSL, DEBUG, MUX>::new_boxed());
        bun_ptr::BackRef::new(pool.downcast_ref().expect("one type per index"))
    }
}

impl Drop for RequestPools {
    fn drop(&mut self) {
        for pool in self.0.iter_mut().filter_map(OnceCell::take) {
            // A request the VM ended under (`process.exit()` in a handler) can't drop without it.
            if pool.is_in_use() {
                bun_core::asan::ignore_object(Box::into_raw(pool).cast());
            }
        }
    }
}

// ─── FFI ─────────────────────────────────────────────────────────────────────
mod ffi {
    use super::*;
    // `node_response_ptr` is an out-param: C++ writes back the
    // Rust-allocated pointer (via `NodeHTTPResponse__createForJS`) without ever
    // dereferencing the struct itself. The ctypes lint fires because the struct
    // has Rust-layout fields (Vec, Cell, …); irrelevant for an opaque handle.
    #[allow(improper_ctypes)]
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
        /// `IncomingMessage`/`ServerResponse` pair, allocates a
        /// [`NodeHTTPResponse`] (returned via `node_response_ptr` with one ref
        /// taken), and invokes `callback(req, res)`. The plain-HTTP and HTTPS
        /// monomorphizations differ only in the `Response<SSL>` opaque type.
        ///
        /// `&JSGlobalObject` / `&mut Option<_>` discharge the deref'd-param
        /// preconditions; `request`/`response` are opaque uws
        /// handles (module-private — sole caller passes live pointers).
        pub(super) safe fn NodeHTTPServer__onRequest_http(
            any_server: usize,
            global: &jsc::JSGlobalObject,
            callback: jsc::JSValue,
            method_string: jsc::JSValue,
            request: *mut uws_sys::Request,
            response: *mut c_void, // *uws.NewApp(false).Response
            node_response_ptr: &mut Option<bun_ptr::RefPtr<NodeHTTPResponse>>,
        ) -> jsc::JSValue;

        pub(super) safe fn NodeHTTPServer__onRequest_https(
            any_server: usize,
            global: &jsc::JSGlobalObject,
            callback: jsc::JSValue,
            method_string: jsc::JSValue,
            request: *mut uws_sys::Request,
            response: *mut c_void, // *uws.NewApp(true).Response
            node_response_ptr: &mut Option<bun_ptr::RefPtr<NodeHTTPResponse>>,
        ) -> jsc::JSValue;
    }
}

/// Servers with the same options share a context, unless it reads files. `None` leaves BoringSSL's error queued for `throw_ssl_error_if_necessary`.
fn create_ssl_ctx(
    options: &uws_sys::BunSocketContextOptions,
) -> Option<bun_boringssl_sys::OwnedSslCtx> {
    let mut err = uws::create_bun_socket_error_t::none;
    // A context from the cache builds nothing, so an error that another call left queued would pass for this one's.
    bun_boringssl_sys::ERR_clear_error();
    crate::api::SSLContextCache::SSLContextCache::get_or_create_for_server(options, &mut err)
}

/// Drain the BoringSSL error queue; if non-empty, throw the top error on
/// `global` and return true.
fn throw_ssl_error_if_necessary(global: &JSGlobalObject) -> bool {
    let err_code = bun_boringssl_sys::ERR_get_error();
    if err_code != 0 {
        let _ = global.throw_value(crate::crypto::create_crypto_error(global, err_code));
        return true;
    }
    false
}

// `RequestContext` reaches back into its server via this; mirrors the
// field/method surface the per-request state machine needs without naming
// `NewServer` (avoids a generic-parameter cycle).
// What a `RequestContext` asks of its server.
impl<const SSL: bool, const DEBUG: bool> NewServer<SSL, DEBUG> {
    /// The context of the script that made the server: what a request starts continues it.
    #[inline]
    pub(crate) fn context(&self) -> &jsc::ScriptExecutionContext {
        self.vm().context_of(self.context.get())
    }
    #[inline(always)]
    pub(crate) fn config(&self) -> &ServerConfig {
        self.config.get()
    }
    #[inline]
    pub(crate) fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> {
        self.dev_server.get().as_deref()
    }
    #[inline(always)]
    pub(crate) fn js_value(&self) -> &jsc::JsRef {
        self.js_value.get()
    }
    #[inline(always)]
    pub(crate) fn terminated(&self) -> bool {
        self.terminated.get()
    }
    /// Returns `ctx` to the pool `prepare_js_request_context` took it from.
    pub(crate) fn release_request_context<const MUX: bool>(
        &self,
        ctx: *mut ServerRequestContext<SSL, DEBUG, MUX>,
    ) {
        // SAFETY: the pool is the VM's and outlives the server, and `ctx` is one of its slots.
        unsafe { (*self.request_pool_for::<MUX>()).put(ctx) };
    }
}

// ─── Type aliases ────────────────────────────────────────────────────────────
pub(crate) type HTTPServer = NewServer<false, false>;
pub(crate) type HTTPSServer = NewServer<true, false>;
pub(crate) type DebugHTTPServer = NewServer<false, true>;
pub(crate) type DebugHTTPSServer = NewServer<true, true>;

// ─── AnyServer ───────────────────────────────────────────────────────────────
// §Dispatch: the
// `bun_ptr::impl_tagged_ptr_union!` macro would impl a foreign trait for a
// foreign tuple type (orphan rule), so it can only be invoked from inside
// `bun_ptr`. Per §Dispatch ("store `(tag: u8, ptr: *mut ())` as two fields"),
// hand-roll the tag here. AnyServer is cold-path (per-request, not per-tick).
// Two fields cost 16 bytes vs 8 for a packed tagged pointer; ~handful of instances.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum AnyServerTag {
    HTTPServer = 0,
    HTTPSServer = 1,
    DebugHTTPServer = 2,
    DebugHTTPSServer = 3,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct AnyServer {
    pub(crate) tag: AnyServerTag,
    pub ptr: *mut (),
}

impl AnyServer {
    // ─── tag-checked downcasts ───────────────────────────────────────────────
    // Centralize the `unsafe { &*self.ptr.cast() }` pattern that the dispatch
    // macro and `h3_alt_svc` open-coded. Each accessor debug-asserts the tag
    // so a mismatched call trips in debug builds rather than silently aliasing
    // the wrong monomorphization.

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

impl AnyServer {
    pub(crate) fn from<const SSL: bool, const DEBUG: bool>(
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

    /// Re-pack into the tagged-pointer wire format
    /// (`u49` ptr | `u15` tag) for the C++ FFI boundary. Inverse of
    /// [`NodeHTTPResponse::any_server_from_packed`]. Tag values are
    /// `1024 - index` in declaration order
    /// (HTTP, HTTPS, DebugHTTP, DebugHTTPS).
    pub(crate) fn to_packed(self) -> u64 {
        let tag: u16 = match self.tag {
            AnyServerTag::HTTPServer => 1024,
            AnyServerTag::HTTPSServer => 1023,
            AnyServerTag::DebugHTTPServer => 1022,
            AnyServerTag::DebugHTTPSServer => 1021,
        };
        // `TaggedPtr::to()` bit-casts the full packed word through `*mut c_void`.
        bun_ptr::TaggedPtr::init(self.ptr, tag).to() as u64
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

    /// The context of the script that made the server.
    #[inline]
    pub(crate) fn context_id(&self) -> jsc::ContextId {
        any_server_dispatch!(self, |s| s.context.get())
    }

    /// Shared borrow of the per-process `JSGlobalObject`. Routes through
    /// [`NewServer::global_this`] (same SAFETY contract: never-null backref,
    /// never moved or freed while any `NewServer` exists).
    #[inline]
    pub(crate) fn global_this(&self) -> &jsc::JSGlobalObject {
        any_server_dispatch!(self, |s| s.global_this())
    }

    #[inline]
    pub(crate) fn config(&self) -> &ServerConfig {
        any_server_dispatch!(self, |s| s.config.get())
    }

    /// Whether a route of the `routes` option, or a static route, has exactly this path.
    pub(crate) fn has_route(&self, path: &[u8]) -> bool {
        any_server_dispatch!(self, |s| {
            s.user_routes
                .get()
                .iter()
                .any(|r| r.route.path.as_bytes() == path)
                || s.config
                    .get()
                    .static_routes
                    .iter()
                    .any(|r| &*r.path == path)
        })
    }

    #[inline]
    pub(crate) fn terminated(&self) -> bool {
        any_server_dispatch!(self, |s| s.terminated.get())
    }

    /// Same gate as [`NewServer::js_value_for_dispatch`].
    #[inline]
    pub(crate) fn js_value_for_dispatch(&self) -> Option<JSValue> {
        any_server_dispatch!(self, |s| s.js_value_for_dispatch())
    }

    /// See [`NewServer::init_ws_package_handlers`].
    pub(crate) fn init_ws_package_handlers(
        &self,
        global: &jsc::JSGlobalObject,
        handlers: JSValue,
    ) -> jsc::JsResult<()> {
        any_server_dispatch!(self, |s| s.init_ws_package_handlers(global, handlers))
    }

    /// `None` before `init_ws_package_handlers`, and after the server has drained, because it no
    /// longer counts open WebSockets.
    pub(crate) fn ws_package_handler(&self) -> Option<bun_ptr::BackRef<WebSocketServerHandler>> {
        any_server_dispatch!(self, |s| s
            .ws_package_handler
            .get()
            .as_deref()
            .filter(|handler| handler.server.is_some())
            .map(bun_ptr::BackRef::new))
    }

    /// See [`NewServer::ws_package_context`].
    pub(crate) fn ws_package_context(
        &self,
        behavior: uws::WebSocketBehavior,
    ) -> Option<bun_ptr::BackRef<uws::WebSocketUpgradeContext>> {
        any_server_dispatch!(self, |s| s.ws_package_context(behavior))
    }

    pub(crate) fn h3_alt_svc(&self) -> Option<&[u8]> {
        match self.tag {
            AnyServerTag::HTTPSServer => self.as_https().h3_alt_svc(),
            AnyServerTag::DebugHTTPSServer => self.as_debug_https().h3_alt_svc(),
            _ => None,
        }
    }

    pub(crate) fn inspector_server_id(&self) -> jsc::DebuggerId {
        any_server_dispatch!(self, |s| s.inspector_server_id.get())
    }

    fn on_websocket_opened(&self) {
        any_server_dispatch!(self, |s| s
            .active_websocket_count
            .set(s.active_websocket_count.get().saturating_add(1)));
    }

    fn on_websocket_closed(&self) {
        any_server_dispatch!(self, |s| {
            s.active_websocket_count
                .set(s.active_websocket_count.get().saturating_sub(1));
            s.apply_phase();
        })
    }

    pub(crate) fn set_inspector_server_id(&self, id: jsc::DebuggerId) {
        any_server_dispatch!(self, |s| {
            s.inspector_server_id.set(id);
            s.dev_server.with_mut(|dev_server| {
                if let Some(dev_server) = dev_server.as_deref_mut() {
                    dev_server.inspector_server_id = id;
                }
            });
        })
    }

    fn on_pending_request(&self) {
        any_server_dispatch!(self, |s| s.on_pending_request())
    }

    /// Calls the `fetch` handler for an HTTP/1 request.
    pub(crate) fn on_request(&self, req: &mut uws_sys::Request, resp: uws::AnyResponse) {
        any_server_dispatch!(self, |s| NewServer::on_request::<false>(
            s.as_ctx_ptr(),
            uws::AnyRequest::H1(req),
            resp,
            None
        ))
    }

    fn on_request_complete(&self) {
        any_server_dispatch!(self, |s| s.on_request_complete())
    }

    pub(crate) fn note_request_parked(&self, parked: bool) {
        any_server_dispatch!(self, |s| s.note_request_parked(parked))
    }

    pub(crate) fn num_subscribers(&self, topic: &[u8]) -> u32 {
        any_server_dispatch!(self, |s| match s.app() {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` via
            // `bun_opaque::opaque_deref_mut` (const-asserted ZST/align-1).
            Some(app) => bun_opaque::opaque_deref_mut(app)
                .web_sockets()
                .num_subscribers(topic),
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
        any_server_dispatch!(self, |s| match s.app() {
            // S012: `NewApp<SSL>` is a ZST opaque — safe `*mut → &mut` via
            // `bun_opaque::opaque_deref_mut` (const-asserted ZST/align-1).
            Some(app) => bun_opaque::opaque_deref_mut(app)
                .web_sockets()
                .publish(topic, message, opcode, compress),
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
        Ok(any_server_dispatch!(self, |s| {
            let Some((request, ctx)) = NewServer::prepare_js_request_context::<false>(
                s.as_ctx_ptr(),
                uws::AnyRequest::H1(req),
                resp,
                method,
                None,
            ) else {
                return Ok(None);
            };
            Some(DispatchedRequest(request.wrap_for_bake(global)).save(&ctx, global, req, resp))
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
        any_server_dispatch!(self, |s| {
            s.on_saved_request(req, resp, callback, extra_args)
        })
    }

    /// Mutable handle to the DevServer (when configured). HTMLBundle's request
    /// path mutates DevServer state (`respond_for_html_bundle`).
    #[allow(clippy::mut_from_ref)] // dispatched through the tagged raw `self.ptr`
    pub(crate) fn dev_server_mut(&self) -> Option<&mut crate::bake::DevServer::DevServer> {
        // SAFETY: JS thread only; callers hold no other borrow of the DevServer.
        any_server_dispatch!(self, |s| unsafe { s.dev_server.get_mut() }.as_deref_mut())
    }

    /// Returns:
    /// - `Ready(None)` if no plugin has to be loaded
    /// - `Err` if there is a cached failure. Currently, this requires restarting the entire server.
    /// - `Pending` if `callback` was stored. It will call `on_plugins_resolved` or `on_plugins_rejected` later.
    pub(crate) fn get_or_load_plugins(
        &self,
        callback: ServePluginsCallback<'_>,
    ) -> GetOrStartLoadResult<'_> {
        any_server_dispatch!(self, |s| s.get_or_load_plugins(callback))
    }

    pub(crate) fn append_static_route(
        &self,
        path: &[u8],
        route: AnyRoute,
        method: server_config::MethodOptional,
    ) {
        any_server_dispatch!(self, |s| s
            .config
            .with_mut(|config| config.append_static_route(path, route, method)))
    }

    pub(crate) fn reload_static_routes(&self) {
        any_server_dispatch!(self, |s| s.reload_static_routes())
    }

    pub(crate) fn get_url_as_string(&self) -> bun_core::String {
        any_server_dispatch!(self, |s| s.get_url_as_string())
    }
}

// ─── http_server_agent ───────────────────────────────────────────────────────
/// `jsc.Debugger.HTTPServerAgent.{notifyServerStarted, notifyServerStopped,
/// notifyServerRoutesUpdated}` — the FFI plumbing lives in
/// `bun_jsc::http_server_agent`; the bodies live here because they reach into
/// `AnyServer`/`ServerConfig` (forward dep from `bun_jsc`'s point of view).
pub(crate) mod http_server_agent {
    use super::{AnyRoute, AnyServer, AnyServerTag};

    use bun_core::StringView;
    use bun_jsc::debugger::DebuggerId;
    use bun_jsc::http_server_agent::{HTTPServerAgent, InspectorHTTPServerAgent, Route, RouteType};

    /// Assign the server a fresh inspector id and tell the C++ inspector
    /// agent (if attached) that it started, passing its URL and start time.
    pub(crate) fn notify_server_started(this: &HTTPServerAgent, instance: AnyServer) {
        let Some(agent) = this.agent.get() else {
            return;
        };
        this.next_server_id
            .set(DebuggerId::init(this.next_server_id.get().get() + 1));
        instance.set_inspector_server_id(this.next_server_id.get());
        let url = instance.get_url_as_string();

        // SAFETY: `agent` is a non-null C++ InspectorHTTPServerAgent handle
        // (set via `Bun__HTTPServerAgent__setEnabled`).
        unsafe {
            InspectorHTTPServerAgent::notify_server_started(
                agent.as_ptr(),
                this.next_server_id.get(),
                instance.vm().hot_reload_counter.get() as i32,
                &url,
                bun_core::time::milli_timestamp() as f64,
                instance.ptr.cast(),
            );
        }
    }

    /// Tell the C++ inspector agent (if attached) that the server stopped,
    /// stamped with the current time.
    pub(crate) fn notify_server_stopped(this: &HTTPServerAgent, server: AnyServer) {
        let Some(agent) = this.agent.get() else {
            return;
        };
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
        let Some(agent) = this.agent.get() else {
            return Ok(());
        };
        let config = server.config();
        let mut routes: Vec<Route<'_>> = Vec::new();
        let mut max_id: u32 = 0;

        // Monomorphized over the four `UserRoute<SSL,DEBUG>` slice types.
        // Dispatch through the same macro the rest of `AnyServer` uses.
        any_server_dispatch!(&server, |s| {
            routes
                .try_reserve(s.user_routes.get().len())
                .map_err(|_| bun_alloc::AllocError)?;
            for user_route in s.user_routes.get() {
                max_id = max_id.max(user_route.id);
                routes.push(Route {
                    route_id: user_route.id as i32,
                    path: StringView::from_bytes(user_route.route.path.as_bytes()),
                    r#type: RouteType::Api,
                    ..Default::default()
                });
            }
        });

        for entry in &config.static_routes {
            max_id += 1;
            routes.push(Route {
                route_id: max_id as i32,
                path: StringView::from_bytes(&entry.path),
                r#type: match &entry.route {
                    AnyRoute::Html(_) => RouteType::Html,
                    AnyRoute::Static(_) => RouteType::Static,
                    _ => RouteType::Default,
                },
                file_path: match &entry.route {
                    AnyRoute::Html(r) => StringView::from_bytes(&r.bundle.path),
                    _ => StringView::EMPTY,
                },
                ..Default::default()
            });
        }

        InspectorHTTPServerAgent::notify_server_routes_updated(
            agent.as_ptr(),
            server.inspector_server_id(),
            server.vm().hot_reload_counter.get() as i32,
            &mut routes,
        );
        Ok(())
    }
}

// ─── SavedRequest ────────────────────────────────────────────────────────────
pub(crate) struct SavedRequest {
    pub(crate) js_request: jsc::Strong,
    /// What `js_request` wraps.
    pub(crate) request: bun_ptr::BackRef<crate::webcore::Request>,
    pub(crate) ctx: any_request_context::AnyRequestContextRef,
    pub(crate) response: uws::AnyResponse,
}

pub(crate) enum SavedRequestUnion<'a> {
    /// Direct pointer to a µWebSockets request that is still on the stack.
    Stack(&'a mut uws::Request),
    /// Heap-allocated copy that persists beyond the initial handler frame.
    Saved(&'a SavedRequest),
}

/// Frees the server outside the finalizer that can drop the last ref. Same pointer as the server, one tag per monomorphization.
#[repr(transparent)]
pub(crate) struct ServerDeinitTask<const SSL: bool, const DEBUG: bool>(NewServer<SSL, DEBUG>);

impl<const SSL: bool, const DEBUG: bool> bun_event_loop::Taskable for ServerDeinitTask<SSL, DEBUG> {
    const TAG: bun_event_loop::TaskTag = match (SSL, DEBUG) {
        (false, false) => bun_event_loop::task_tag::HTTPServerDeinit,
        (true, false) => bun_event_loop::task_tag::HTTPSServerDeinit,
        (false, true) => bun_event_loop::task_tag::DebugHTTPServerDeinit,
        (true, true) => bun_event_loop::task_tag::DebugHTTPSServerDeinit,
    };
    /// Frees nothing: a server whose deinit is still queued when its VM stops stays allocated.
    unsafe fn release_unrun(_: *mut Self) {}
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl<const SSL: bool, const DEBUG: bool> ServerDeinitTask<SSL, DEBUG> {
    /// # Safety
    /// `this` is the unique owning server pointer `schedule_deinit` queued.
    pub(crate) unsafe fn run(this: *mut Self) {
        let vm = jsc::VirtualMachine::get();
        if vm.uws_loop().internal_loop_data.is_ticking() {
            // A listener turned the event loop, and the app's handler that called it goes on afterwards.
            return vm
                .event_loop()
                .enqueue_task_for_outermost_tick(bun_event_loop::Task::init(this));
        }
        // SAFETY: caller contract.
        unsafe { bun_core::heap::destroy(this) };
    }
}

// ─── ServerAllConnectionsClosedTask ──────────────────────────────────────────
pub(crate) struct ServerAllConnectionsClosedTask {
    pub(crate) global_object: *const jsc::JSGlobalObject,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) tracker: jsc::AsyncTaskTracker,
    /// The context of the script that made the server: `stop()`'s promise (and node:http's
    /// `'close'`, which waits on it) is settled for that script.
    pub(crate) context: jsc::ContextId,
}

impl bun_event_loop::BoxedTask for ServerAllConnectionsClosedTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ServerAllConnectionsClosedTask;
    /// A `server.stop()` whose all-closed notification will not run: drop the
    /// promise handle with the box.
    fn release_unrun(self: Box<Self>) {}
    fn context(&self) -> bun_event_loop::ContextId {
        self.context
    }
}

impl ServerAllConnectionsClosedTask {
    pub(crate) fn schedule(this: Self, vm: &jsc::VirtualMachine) {
        vm.enqueue_task(bun_event_loop::Task::from_boxed(Box::new(this)));
    }

    /// Resolve the `server.stop()` promise
    /// once uws reports all sockets closed.
    pub(crate) fn run_from_js_thread(&mut self) -> JsResult<()> {
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST handle — safe
        // `*const → &` via `opaque_deref` (set from the live per-VM global in
        // `schedule()`; the task is only dispatched on that VM's JS thread).
        let global_object: &jsc::JSGlobalObject = bun_opaque::opaque_deref(self.global_object);
        let _dispatch = self.tracker.dispatch(global_object);

        self.promise.resolve(global_object, JSValue::UNDEFINED)
    }
}
