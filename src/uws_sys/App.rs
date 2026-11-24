use core::ffi::{c_char, c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;
use std::rc::Rc;

use bun_core::ZStr;
use bun_http_types::Method::Method;

use crate::http1::Routes;
use crate::request::Handler;
use crate::response::Response;
use crate::socket_context::BunSocketContextOptions;
use crate::web_socket::{UpgradeRoute, WebSocketHandler, WebSocketUpgradeServer, WebSockets};
use crate::{
    AnyRequest, AnyResponse, ListenSocket as UwsListenSocket, Request, WebSocketBehavior, thunk,
    us_socket_t, uws_res,
};
use bun_ptr::{AnyRefCounted, RefPtr};

// This file provides Rust bindings for the uWebSockets App class.
// It wraps the C API exposed in libuwsockets.cpp which provides a C interface
// to the C++ uWebSockets library defined in App.h.
//
// The architecture is:
// 1. App.h - C++ uWebSockets library with TemplatedApp<SSL> class
//    - Defines the main TemplatedApp<bool SSL> template class
//    - Provides HTTP server functionality with SSL/non-SSL variants
//    - Handles server name (SNI) support for SSL contexts
//    - Provides listen() methods for binding to ports/unix sockets
//
// 2. libuwsockets.cpp - C wrapper functions that call the C++ methods
//    - Exposes C functions like uws_create_app(), uws_app_close(), etc.
//    - Handles SSL/non-SSL branching with if(ssl) checks
//    - Converts between C types (char*, size_t) and C++ types (string_view)
//    - Manages memory and object lifetime for C callers
//    - Provides callback wrappers that convert C function pointers to C++ lambdas
//
// 3. App.rs - Rust bindings that call the C wrapper functions
//    - App<const SSL: bool> generic struct parameterized by SSL boolean
//    - Methods like close() call corresponding C functions
//    - Type-safe wrappers around raw C pointers and function calls
//    - Converts Rust slices to C pointer/length pairs
//    - Provides compile-time SSL flag selection via SSL as i32
//
// This layered approach allows Rust code to use high-performance uWebSockets
// functionality while maintaining memory safety and Rust's type system benefits.
// The C layer handles the impedance mismatch between Rust and C++, while the
// Rust layer provides idiomatic APIs for Rust developers.

/// Opaque handle to a uWS::TemplatedApp<SSL>. Always used via `*mut App<SSL>`.
#[repr(C)]
pub struct App<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

pub struct OwnedApp<const SSL: bool> {
    app: NonNull<App<SSL>>,
    _web_sockets: Rc<WebSockets>,
    _routes: Rc<Routes>,
}

impl<const SSL: bool> OwnedApp<SSL> {
    pub fn new(opts: &BunSocketContextOptions) -> Option<Self> {
        let (web_sockets, routes) = (Rc::<WebSockets>::default(), Rc::<Routes>::default());
        // SAFETY: FFI call; uws_create_app returns null on failure.
        let app = unsafe {
            c::uws_create_app(
                App::<SSL>::SSL_FLAG,
                *opts,
                Rc::as_ptr(&web_sockets).cast(),
                Rc::as_ptr(&routes).cast(),
            )
        };
        Some(Self {
            app: NonNull::new(app.cast())?,
            _web_sockets: web_sockets,
            _routes: routes,
        })
    }

    pub fn as_ptr(&self) -> *mut App<SSL> {
        self.app.as_ptr()
    }
}

impl<const SSL: bool> Drop for OwnedApp<SSL> {
    #[inline(never)]
    fn drop(&mut self) {
        // SAFETY: created in `new` with the same flag, destroyed once.
        unsafe { c::uws_app_destroy(App::<SSL>::SSL_FLAG, self.as_ptr().cast()) }
    }
}

impl<const SSL: bool> App<SSL> {
    const SSL_FLAG: i32 = SSL as i32;

    /// `&mut uws_app_s` view of self for `safe fn` shims. Both types are
    /// `#[repr(C)]` opaque ZSTs with `UnsafeCell<[u8; 0]>`, so the cast is a
    /// no-op and the reference is ABI-identical to a non-null pointer.
    #[inline]
    fn as_raw(&mut self) -> &mut uws_app_s {
        // SAFETY: `App<SSL>` and `uws_app_s` are layout-identical opaque ZSTs
        // over the same C++ object; the borrow reborrows `&mut self`.
        unsafe { &mut *std::ptr::from_mut::<Self>(self).cast::<uws_app_s>() }
    }

    pub fn close(&mut self) {
        c::uws_app_close(Self::SSL_FLAG, self.as_raw())
    }

    pub fn web_sockets(&mut self) -> &WebSockets {
        // SAFETY: `OwnedApp` owns both.
        unsafe { &*c::uws_app_web_sockets(Self::SSL_FLAG, self.as_raw()).cast() }
    }

    fn routes(&mut self) -> &Routes {
        // SAFETY: `OwnedApp` owns both.
        unsafe { &*c::uws_app_routes(Self::SSL_FLAG, self.as_raw()).cast() }
    }

    /// Close every HTTP connection that is idle (no request being received, no
    /// response in flight). With `close_when_idle`, connections that are busy
    /// right now are additionally marked to close as soon as their in-flight
    /// work completes. Never touches WebSockets or the listen socket.
    /// Returns the number of connections closed.
    pub fn close_idle_connections(&mut self, close_when_idle: bool) -> usize {
        c::uws_app_close_idle(Self::SSL_FLAG, self.as_raw(), i32::from(close_when_idle))
    }

    pub fn set_flags(
        &mut self,
        require_host_header: bool,
        use_strict_method_validation: bool,
        lenient_http_flags: u8,
        http_allow_half_open: bool,
    ) {
        c::uws_app_set_flags(
            Self::SSL_FLAG,
            self.as_raw(),
            require_host_header,
            use_strict_method_validation,
            lenient_http_flags,
            http_allow_half_open,
        )
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        c::uws_app_set_max_http_header_size(Self::SSL_FLAG, self.as_raw(), max_header_size)
    }

    pub fn set_max_headers_count(&mut self, max_headers_count: u32) {
        c::uws_app_set_max_headers_count(Self::SSL_FLAG, self.as_raw(), max_headers_count)
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

    pub fn on_client_error(
        &mut self,
        handler: extern "C" fn(*mut c_void, c_int, *mut us_socket_t, u8, *mut u8, c_int),
        user_data: *mut c_void,
    ) {
        // Callers receive the raw C args and slice raw_packet manually.
        c::uws_app_set_on_clienterror(Self::SSL_FLAG, self.as_raw(), handler, user_data)
    }

    pub fn listen_with_config(
        &mut self,
        handler: c::uws_listen_handler,
        user_data: *mut c_void,
        config: c::uws_app_listen_config_t,
    ) {
        // Callers supply the C-ABI shim directly.
        // SAFETY: self is a valid app; config.host (if non-null) is NUL-terminated and outlives the call.
        unsafe {
            c::uws_app_listen_with_config(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                config.host,
                u16::try_from(config.port).expect("int cast"),
                config.options,
                handler,
                user_data,
            )
        }
    }

    pub fn listen_on_unix_socket(
        &mut self,
        handler: extern "C" fn(*mut UwsListenSocket, *const c_char, i32, *mut c_void),
        user_data: *mut c_void,
        domain_name: &ZStr,
        flags: i32,
    ) {
        // Callers supply the C-ABI shim directly.
        // SAFETY: self is a valid app; domain_name is NUL-terminated.
        unsafe {
            c::uws_app_listen_domain_with_options(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                domain_name.as_ptr().cast(),
                domain_name.len(),
                flags,
                handler,
                user_data,
            )
        }
    }

    pub fn add_server_name_with_options(
        &mut self,
        hostname_pattern: &core::ffi::CStr,
        opts: &BunSocketContextOptions,
        apply_client_cert_policy: bool,
    ) -> Result<(), AddServerNameError> {
        // SAFETY: self is a valid app; hostname_pattern is NUL-terminated.
        let rc = unsafe {
            c::uws_add_server_name_with_options(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                hostname_pattern.as_ptr(),
                *opts,
                i32::from(apply_client_cert_policy),
            )
        };
        if rc != 0 {
            return Err(AddServerNameError::FailedToAddServerName);
        }
        Ok(())
    }

    /// Register a connection filter: `handler` is invoked with the raw
    /// `us_socket_t*` and `1` when an HTTP connection is opened (for TLS, when
    /// its handshake completes) and `-1` when it closes.
    pub fn filter(
        &mut self,
        handler: extern "C" fn(*mut us_socket_t, i32, *mut c_void),
        user_data: *mut c_void,
    ) {
        c::uws_filter(Self::SSL_FLAG, self.as_raw(), Some(handler), user_data)
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

    // HTTP response object for handling HTTP responses.
    //
    // This wraps the uWS HttpResponse template class from HttpResponse.h, providing
    // methods for writing response data, setting headers, handling timeouts, and
    // managing the response lifecycle. The response object supports both regular
    // HTTP responses and chunked transfer encoding, and can handle large data
    // writes by automatically splitting them into appropriately sized chunks.
    //
    // Key features:
    // - Write response data with automatic chunking for large payloads
    // - Set HTTP status codes and headers
    // - Handle response timeouts and aborted requests
    // - Support for WebSocket upgrades
    // - Cork/uncork functionality for efficient batched writes
    // - Automatic handling of Connection: close semantics
    //
    // Rust inherent associated types are unstable; callers name
    // `crate::response::Response<{SSL as i32}>` / `crate::web_socket::WebSocket<{SSL as i32}>`
    // directly.
}

/// Opaque listen socket handle, parameterized by SSL to match `App<SSL>`.
#[repr(C)]
pub struct ListenSocket<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

pub struct OwnedListenSocket<const SSL: bool>(crate::OwnedListenSocket);

impl<const SSL: bool> OwnedListenSocket<SSL> {
    /// SAFETY: `socket` is from an app's listen callback, and this drops before the loop frees it.
    pub unsafe fn from_raw(socket: *mut UwsListenSocket) -> Option<Self> {
        NonNull::new(socket).map(|socket| Self(crate::OwnedListenSocket(socket)))
    }

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

bun_opaque::opaque_ffi! { pub struct uws_app_s; }
pub(crate) type uws_app_t = uws_app_s;

#[allow(non_camel_case_types)]
pub mod c {
    use super::*;

    pub(crate) type uws_listen_handler = Option<extern "C" fn(*mut UwsListenSocket, *mut c_void)>;
    // The C++ shim hands the filter the uws_res_t*, which for HTTP server
    // sockets is the raw us_socket_t* — typed as such so callers outside this
    // crate can name the handler signature.
    pub(crate) type uws_filter_handler = Option<extern "C" fn(*mut us_socket_t, i32, *mut c_void)>;

    unsafe extern "C" {
        pub(crate) safe fn uws_app_close(ssl: i32, app: &mut uws_app_s);
        pub(crate) safe fn uws_app_web_sockets(ssl: i32, app: &mut uws_app_s) -> *const c_void;
        pub(crate) safe fn uws_app_routes(ssl: i32, app: &mut uws_app_s) -> *const c_void;
        pub(crate) safe fn uws_app_close_idle(
            ssl: i32,
            app: &mut uws_app_s,
            close_when_idle: i32,
        ) -> usize;
        // safe: `&mut uws_app_s` is ABI-identical to a non-null `*mut`;
        // `handler`/`user_data` are stored opaquely (never dereferenced by the
        // C++ shim itself) — no preconditions on this call.
        pub(crate) safe fn uws_app_set_on_clienterror(
            ssl: c_int,
            app: &mut uws_app_s,
            handler: extern "C" fn(*mut c_void, c_int, *mut us_socket_t, u8, *mut u8, c_int),
            user_data: *mut c_void,
        );
        pub(crate) fn uws_create_app(
            ssl: i32,
            options: BunSocketContextOptions,
            web_sockets: *const c_void,
            routes: *const c_void,
        ) -> *mut uws_app_t;
        pub(crate) fn uws_app_destroy(ssl: i32, app: *mut uws_app_t);
        pub(crate) safe fn uws_app_set_flags(
            ssl: i32,
            app: &mut uws_app_t,
            require_host_header: bool,
            use_strict_method_validation: bool,
            lenient_http_flags: u8,
            http_allow_half_open: bool,
        );
        pub(crate) safe fn uws_app_set_max_http_header_size(
            ssl: i32,
            app: &mut uws_app_t,
            max_header_size: u64,
        );
        pub(crate) safe fn uws_app_set_max_headers_count(
            ssl: i32,
            app: &mut uws_app_t,
            max_headers_count: u32,
        );
        pub(crate) fn uws_app_listen_with_config(
            ssl: i32,
            app: *mut uws_app_t,
            host: *const c_char,
            port: u16,
            options: i32,
            handler: uws_listen_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_add_server_name_with_options(
            ssl: i32,
            app: *mut uws_app_t,
            hostname_pattern: *const c_char,
            options: BunSocketContextOptions,
            apply_client_cert_policy: c_int,
        ) -> i32;
        pub(crate) safe fn uws_filter(
            ssl: i32,
            app: &mut uws_app_t,
            handler: uws_filter_handler,
            user_data: *mut c_void,
        );

        pub(crate) fn uws_app_listen_domain_with_options(
            ssl_flag: c_int,
            app: *mut uws_app_t,
            domain: *const c_char,
            pathlen: usize,
            flags: i32,
            handler: extern "C" fn(*mut UwsListenSocket, *const c_char, i32, *mut c_void),
            user_data: *mut c_void,
        );
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct uws_app_listen_config_t {
        pub port: c_int,
        pub host: *const c_char,
        pub options: c_int,
    }
}
