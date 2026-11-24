use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::{CStr, c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr;
use core::sync::atomic::AtomicUsize;
use std::rc::Rc;

use bun_boringssl_sys::OwnedSslCtx;
use bun_core::{ZBox, ZStr};
use bun_http_types::Method::Method;
use bun_http1::request::RequestOptions;

use crate::http1::events::{NODE_TCP, NODE_TLS, TCP, TLS};
use crate::http1::{Connection, Routes};
use crate::request::Handler;
use crate::response::Response;
use crate::socket_context::BunSocketContextOptions;
use crate::web_socket::{UpgradeRoute, WebSocketHandler, WebSocketUpgradeServer, WebSockets};
use crate::{
    AnyRequest, AnyResponse, ListenSocket as UwsListenSocket, Loop, Request, SocketGroup,
    SocketKind, SslCtx, WebSocketBehavior, create_bun_socket_error_t, thunk, us_socket_t, uws_res,
};
use bun_ptr::{AnyRefCounted, RefPtr};

#[derive(Clone, Copy)]
pub enum ConnectionChange {
    /// Before the TLS handshake.
    Accepted,
    /// It has closed, or become a WebSocket.
    Gone,
    /// At the end of its input, with nothing left to send.
    TunnelIdle,
    TunnelBusy,
    IdleTunnelGone,
}

type OnConnectionChange = fn(*mut c_void, ConnectionChange);
type OnOpen = fn(*mut c_void, &mut us_socket_t);
type OnClientError = fn(*mut c_void, &mut us_socket_t, u8, &[u8]);

/// Behind a pointer, so that a program without HTTP/2 can be trimmed.
pub(crate) trait Http2App {
    /// `preface_len` bytes of the preface came before `data`.
    fn adopt(&self, res: &uws_res, preface_len: usize, data: &[u8]);
    fn close_all(&self);
    fn close_idle(&self, close_when_idle: bool) -> usize;
}

pub(crate) struct Http2 {
    pub(crate) app: Rc<dyn Http2App>,
    pub(crate) allows_http1: bool,
}

pub(crate) struct Context {
    group: SocketGroup,
    /// The connection whose read is being parsed.
    pub(crate) reading: Cell<*const uws_res>,
    pub(crate) request_options: Cell<RequestOptions>,
    pub(crate) answers_expect: Cell<bool>,
    pub(crate) allows_half_open: Cell<bool>,
    pub(crate) rejects_unauthorized: bool,
    pub(crate) routes: Routes,
    pub(crate) http2: OnceCell<Http2>,
    on_connection_change: Cell<Option<(OnConnectionChange, *mut c_void)>>,
    pub(crate) on_open: Cell<Option<(OnOpen, *mut c_void)>>,
    pub(crate) on_client_error: Cell<Option<(OnClientError, *mut c_void)>>,
    web_sockets: WebSockets,
    ssl_ctx: Option<OwnedSslCtx>,
    /// For listeners to come.
    server_names: RefCell<Vec<(ZBox, OwnedSslCtx)>>,
}

impl Context {
    pub(crate) fn report(&self, change: ConnectionChange) {
        if let Some((handler, user_data)) = self.on_connection_change.get() {
            handler(user_data, change);
        }
    }

    fn update_request_options(&self, f: impl FnOnce(&mut RequestOptions)) {
        let mut options = self.request_options.get();
        f(&mut options);
        self.request_options.set(options);
    }

    fn close_idle_connections(&self, close_when_idle: bool) -> usize {
        let (loop_data, mut closed) = (&Loop::get().internal_loop_data, 0);
        // A close handler can close the others.
        let connections: Vec<_> = self.group.sockets().map(uws_res::of).collect();
        loop_data.keeping_closed_sockets(|| {
            for res in (connections.iter()).filter(|res| !res.is_closed_or_upgraded()) {
                if res.close_if_idle() {
                    closed += 1;
                } else if close_when_idle {
                    res.close_when_idle();
                }
            }
        });
        if close_when_idle && self.group.low_prio_count.get() != 0 {
            let group = &self.group;
            (loop_data.low_priority_sockets())
                .filter(|&socket| ptr::eq(us_socket_t::opaque_mut(socket).group(), group))
                .for_each(|socket| uws_res::of(socket).close_when_idle());
        }
        let http2 = self.http2.get();
        closed + http2.map_or(0, |http2| http2.app.close_idle(close_when_idle))
    }
}

/// Opaque handle to the [`Context`] of an [`OwnedApp`]. Always used via `*mut App<SSL>`.
#[repr(C)]
pub struct App<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

pub struct OwnedApp<const SSL: bool>(Rc<Context>);

impl<const SSL: bool> OwnedApp<SSL> {
    pub fn new(opts: &BunSocketContextOptions) -> Option<Self> {
        let ssl_ctx = match SSL {
            true => Some(opts.create_ssl_context(&mut create_bun_socket_error_t::none)?),
            false => None,
        };
        let context = Rc::new(Context {
            group: SocketGroup::default(),
            reading: Cell::new(ptr::null()),
            request_options: Cell::new(RequestOptions {
                max_header_size: 0,
                max_headers_count: 0,
                requires_host: true,
                has_strict_methods: false,
                has_lenient_values: false,
                has_lenient_transfer_encoding: false,
            }),
            answers_expect: Cell::new(true),
            allows_half_open: Cell::new(false),
            rejects_unauthorized: opts.request_cert != 0 && opts.reject_unauthorized != 0,
            routes: Routes::default(),
            http2: OnceCell::new(),
            on_connection_change: Cell::new(None),
            on_open: Cell::new(None),
            on_client_error: Cell::new(None),
            web_sockets: WebSockets::default(),
            ssl_ctx,
            server_names: RefCell::default(),
        });
        let (vtable, owner) = (if SSL { &TLS } else { &TCP }, Rc::as_ptr(&context));
        (context.group).init(Loop::get(), Some(vtable), owner.cast_mut().cast());
        Some(Self(context))
    }

    pub fn as_ptr(&self) -> *mut App<SSL> {
        Rc::as_ptr(&self.0).cast_mut().cast()
    }
}

impl<const SSL: bool> App<SSL> {
    const SOCKET_KIND: SocketKind = match SSL {
        true => SocketKind::UwsHttpTls,
        false => SocketKind::UwsHttp,
    };

    fn context(&self) -> &Context {
        // SAFETY: from `OwnedApp::as_ptr`, which its holder keeps for as long as it uses this.
        unsafe { &*self._p.get().cast() }
    }

    /// The listeners too.
    pub fn close(&mut self) {
        let context = self.context();
        context.group.close_all();
        context.web_sockets.close();
        if let Some(http2) = context.http2.get() {
            http2.app.close_all();
        }
    }

    pub fn web_sockets(&mut self) -> &WebSockets {
        &self.context().web_sockets
    }

    fn routes(&mut self) -> &Routes {
        &self.context().routes
    }

    pub fn enable_node_http(&mut self) {
        let group = &self.context().group;
        debug_assert!(group.head_listen_sockets.get().is_null());
        (group.vtable).set(Some(if SSL { &NODE_TLS } else { &NODE_TCP }));
    }

    pub fn set_using_custom_expect_handler(&mut self, value: bool) {
        self.context().answers_expect.set(!value);
    }

    pub(crate) fn attach_http2(&mut self, http2: Http2) {
        let context = self.context();
        debug_assert!(context.http2.get().is_none() && context.server_names.borrow().is_empty());
        let http2 = context.http2.get_or_init(|| http2);
        if SSL && let Some(ssl_ctx) = &context.ssl_ctx {
            // SAFETY: a live `SSL_CTX`.
            unsafe { us_ssl_ctx_enable_http2_alpn(ssl_ctx.as_ptr(), http2.allows_http1.into()) };
        }
    }

    /// Close every HTTP connection that is idle (no request being received, no
    /// response in flight). With `close_when_idle`, connections that are busy
    /// right now are additionally marked to close as soon as their in-flight
    /// work completes. Never touches WebSockets or the listen socket.
    /// Returns the number of connections closed.
    pub fn close_idle_connections(&mut self, close_when_idle: bool) -> usize {
        self.context().close_idle_connections(close_when_idle)
    }

    pub fn set_flags(
        &mut self,
        require_host_header: bool,
        use_strict_method_validation: bool,
        lenient_http_flags: u8,
        http_allow_half_open: bool,
    ) {
        self.context().update_request_options(|options| {
            options.requires_host = require_host_header;
            options.has_strict_methods = use_strict_method_validation;
            options.has_lenient_values = lenient_http_flags & 1 != 0;
            options.has_lenient_transfer_encoding = lenient_http_flags & 2 != 0;
        });
        self.context().allows_half_open.set(http_allow_half_open);
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        (self.context()).update_request_options(|options| options.max_header_size = max_header_size)
    }

    pub fn set_max_headers_count(&mut self, max_headers_count: u32) {
        (self.context())
            .update_request_options(|options| options.max_headers_count = max_headers_count)
    }

    pub fn clear_routes(&mut self) {
        let routes = self.routes();
        routes.requests.clear();
        routes.upgrades.take();
    }

    // ─────────────────────────────────────────────────────────────────────
    // RouteHandler
    //
    // Rust cannot accept a `fn` as a const-generic parameter, so a type-safe
    // shim cannot be monomorphized here without a macro. We expose the raw
    // C handler type directly; callers supply their own `extern "C" fn` (or a
    // future `route_handler!` macro generates one). The shape of that shim is:
    //
    //   extern "C" fn handle<U, const SSL: bool>(
    //       res: *mut uws_res,
    //       req: *mut Request,
    //       user_data: *mut c_void,
    //   ) {
    //       let user_data = unsafe { &mut *(user_data as *mut U) };
    //       HANDLER(user_data, unsafe { &mut *req }, unsafe { &mut *(res as *mut Response<SSL>) });
    //   }
    // ─────────────────────────────────────────────────────────────────────

    pub fn any(
        &mut self,
        pattern: &[u8],
        handler: Handler<uws_res, Request>,
        user_data: *mut c_void,
    ) {
        (self.routes().requests).add(None, pattern, handler, user_data);
    }

    pub fn method(
        &mut self,
        method_: Method,
        pattern: &[u8],
        handler: Handler<uws_res, Request>,
        user_data: *mut c_void,
    ) {
        (self.routes().requests).add(Some(method_), pattern, handler, user_data);
    }

    /// [`method`](Self::method) with an intrusively-refcounted `U` as the
    /// route userdata. The registrant keeps a ref on `owner` for as long as the
    /// route is registered, so the trampoline can hand the handler a ref of its own.
    pub fn method_ref<U: AnyRefCounted + 'static, H>(
        &mut self,
        method_: Method,
        pattern: &[u8],
        _handler: H,
        owner: &RefPtr<U>,
    ) where
        H: Fn(RefPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        self.method(
            method_,
            pattern,
            Self::route_ref_thunk::<U, H>,
            owner.as_ptr().cast(),
        );
    }

    /// [`any`](Self::any) counterpart of [`method_ref`](Self::method_ref).
    pub fn any_ref<U: AnyRefCounted + 'static, H>(
        &mut self,
        pattern: &[u8],
        _handler: H,
        owner: &RefPtr<U>,
    ) where
        H: Fn(RefPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        self.any(
            pattern,
            Self::route_ref_thunk::<U, H>,
            owner.as_ptr().cast(),
        );
    }

    extern "C" fn route_ref_thunk<U: AnyRefCounted + 'static, H>(
        resp: *mut uws_res,
        req: *mut Request,
        user_data: *mut c_void,
    ) where
        H: Fn(RefPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        let resp = Response::<SSL>::res_to_any(resp);
        // SAFETY: `user_data` is the pointer registered with this thunk; the registrant holds a ref on it while the route is registered.
        let owner = unsafe { RefPtr::init_ref(user_data.cast::<U>()) };
        thunk::zst::<H>()(owner, AnyRequest::H1(req), resp)
    }

    /// Only for `node:http`.
    pub fn on_client_error(&mut self, handler: OnClientError, user_data: *mut c_void) {
        (self.context().on_client_error).set(Some((handler, user_data)));
    }

    /// On failure, `errno` says why.
    pub fn listen(
        &mut self,
        host: Option<&ZStr>,
        port: u16,
        options: c_int,
    ) -> Option<OwnedListenSocket<SSL>> {
        let context = self.context();
        let listener = context.group.listen(
            Self::SOCKET_KIND,
            context.ssl_ctx.as_ref().map(OwnedSslCtx::as_ptr),
            host.filter(|host| !host.is_empty()),
            port.into(),
            // The client speaks first.
            options | crate::LIBUS_LISTEN_DEFER_ACCEPT,
            size_of::<Connection>() as c_int,
            &mut 0,
        );
        Some(self.set_up(listener?))
    }

    /// On failure, `errno` says why.
    pub fn listen_on_unix_socket(
        &mut self,
        path: &ZStr,
        options: c_int,
    ) -> Option<OwnedListenSocket<SSL>> {
        let context = self.context();
        let listener = context.group.listen_unix(
            Self::SOCKET_KIND,
            context.ssl_ctx.as_ref().map(OwnedSslCtx::as_ptr),
            path.as_bytes(),
            options,
            size_of::<Connection>() as c_int,
            &mut 0,
        );
        Some(self.set_up(listener?))
    }

    fn set_up(&self, listener: crate::OwnedListenSocket) -> OwnedListenSocket<SSL> {
        let socket = UwsListenSocket::opaque_mut(listener.as_ptr());
        socket.get_socket().unref();
        if SSL {
            for (name, ssl_ctx) in &*self.context().server_names.borrow() {
                socket.add_server_name(name, ssl_ctx.as_ptr());
            }
        }
        OwnedListenSocket(listener)
    }

    pub fn add_server_name_with_options(
        &mut self,
        hostname_pattern: &CStr,
        opts: &BunSocketContextOptions,
        apply_client_cert_policy: bool,
    ) -> Result<(), AddServerNameError> {
        let context = self.context();
        debug_assert!(SSL && context.group.head_listen_sockets.get().is_null());
        let ssl_ctx = (opts.create_ssl_context(&mut create_bun_socket_error_t::none))
            .ok_or(AddServerNameError::FailedToAddServerName)?;
        // SAFETY: a live `SSL_CTX`.
        unsafe {
            if apply_client_cert_policy {
                let (requests, rejects) = (opts.request_cert, opts.reject_unauthorized);
                us_ssl_ctx_set_sni_policy(ssl_ctx.as_ptr(), requests, rejects);
            }
            if let Some(http2) = context.http2.get() {
                us_ssl_ctx_enable_http2_alpn(ssl_ctx.as_ptr(), http2.allows_http1.into());
            }
        }
        let name = ZBox::from_bytes(hostname_pattern.to_bytes());
        context.server_names.borrow_mut().push((name, ssl_ctx));
        Ok(())
    }

    pub fn on_connection_change(&mut self, handler: OnConnectionChange, user_data: *mut c_void) {
        (self.context().on_connection_change).set(Some((handler, user_data)));
    }

    /// Only for `node:http`. With TLS, after the handshake.
    pub fn on_open(&mut self, handler: OnOpen, user_data: *mut c_void) {
        self.context().on_open.set(Some((handler, user_data)));
    }

    /// Calls with the same `context_key` share one context. It keeps the first call's `T` and
    /// the last call's settings. The key is only compared, never dereferenced.
    #[inline(never)]
    pub fn ws<Server: WebSocketUpgradeServer<SSL>, T: WebSocketHandler>(
        &mut self,
        pattern: &[u8],
        ctx: *mut c_void,
        id: usize,
        behavior: WebSocketBehavior,
        context_key: *const c_void,
    ) {
        let context = self.web_sockets().context::<T>(context_key, behavior);
        let route = UpgradeRoute::new::<Server, SSL>(ctx, context, id);
        (self.routes().upgrades.borrow_mut()).add(Some(Method::GET), pattern, route);
    }
}

/// Opaque listen socket handle, parameterized by SSL to match `App<SSL>`.
#[repr(C)]
pub struct ListenSocket<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

pub struct OwnedListenSocket<const SSL: bool>(crate::OwnedListenSocket);

impl<const SSL: bool> OwnedListenSocket<SSL> {
    pub fn as_ptr(&self) -> *mut ListenSocket<SSL> {
        self.0.as_ptr().cast()
    }
}

impl<const SSL: bool> ListenSocket<SSL> {
    #[inline]
    pub fn get_local_port(&mut self) -> Option<u16> {
        // S008: opaque ZST cast as above.
        bun_opaque::opaque_deref_mut(std::ptr::from_mut::<Self>(self).cast::<UwsListenSocket>())
            .get_local_port()
    }

    pub fn socket(&mut self) -> crate::socket::NewSocketHandler<SSL> {
        // SAFETY: ListenSocket<SSL> is layout-identical to us_socket_t on the C side
        // (a listen socket IS a us_socket_t).
        crate::socket::NewSocketHandler::<SSL>::from(std::ptr::from_mut::<Self>(self).cast())
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum AddServerNameError {
    FailedToAddServerName,
}
bun_core::impl_tag_error!(AddServerNameError);

unsafe extern "C" {
    pub(crate) safe static BUN_DEFAULT_MAX_HTTP_HEADER_SIZE: AtomicUsize;
    fn us_ssl_ctx_set_sni_policy(ctx: *mut SslCtx, request_cert: c_int, reject_unauthorized: c_int);
    fn us_ssl_ctx_enable_http2_alpn(ctx: *mut SslCtx, allow_http1: c_int);
}
