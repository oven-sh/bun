use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr;

use bun_str::ZStr;
use bun_http::Method;

use crate::{
    us_socket_t, uws_res, ListenSocket as UwsListenSocket, Opcode, Request, SocketHandler,
    WebSocketBehavior,
};
use crate::socket_context::BunSocketContextOptions;
use crate::response::Response;
use crate::web_socket::{c::uws_ws, WebSocket};

// This file provides Rust bindings for the uWebSockets App class.
// It wraps the C API exposed in libuwsockets.cpp which provides a C interface
// to the C++ uWebSockets library defined in App.h.
//
// The architecture is:
// 1. App.h - C++ uWebSockets library with TemplatedApp<SSL> class
//    - Defines the main TemplatedApp<bool SSL> template class
//    - Provides HTTP/WebSocket server functionality with SSL/non-SSL variants
//    - Contains WebSocketBehavior struct for configuring WebSocket handlers
//    - Implements routing methods (get, post, put, delete, etc.)
//    - Manages WebSocket contexts, topic trees for pub/sub, and compression
//    - Handles server name (SNI) support for SSL contexts
//    - Provides listen() methods for binding to ports/unix sockets
//
// 2. libuwsockets.cpp - C wrapper functions that call the C++ methods
//    - Exposes C functions like uws_create_app(), uws_app_get(), etc.
//    - Handles SSL/non-SSL branching with if(ssl) checks
//    - Converts between C types (char*, size_t) and C++ types (string_view)
//    - Manages memory and object lifetime for C callers
//    - Provides callback wrappers that convert C function pointers to C++ lambdas
//    - Functions like uws_app_connect(), uws_app_trace() mirror C++ methods
//
// 3. App.rs - Rust bindings that call the C wrapper functions
//    - App<const SSL: bool> generic struct parameterized by SSL boolean
//    - Methods like create(), destroy(), close() call corresponding C functions
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
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl<const SSL: bool> App<SSL> {
    pub const IS_SSL: bool = SSL;
    const SSL_FLAG: i32 = SSL as i32;

    pub fn close(&mut self) {
        // SAFETY: self is a valid *mut uws_app_s (opaque C++ app); ssl flag matches construction.
        unsafe { c::uws_app_close(Self::SSL_FLAG, self as *mut Self as *mut uws_app_s) }
    }

    pub fn close_idle_connections(&mut self) {
        // SAFETY: self is a valid *mut uws_app_s.
        unsafe { c::uws_app_close_idle(Self::SSL_FLAG, self as *mut Self as *mut uws_app_s) }
    }

    pub fn create(opts: BunSocketContextOptions) -> Option<*mut Self> {
        // SAFETY: FFI call; uws_create_app returns null on failure.
        let app = unsafe { c::uws_create_app(Self::SSL_FLAG, opts) };
        if app.is_null() {
            None
        } else {
            Some(app.cast::<Self>())
        }
    }

    /// # Safety
    /// `this` must be a live app handle from [`App::create`]. Caller must not use it after.
    // TODO(port): FFI destroy — caller must not use after; opaque #[repr(C)] handle, not Drop.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` is a valid *mut uws_app_s; ssl flag matches construction.
        unsafe { c::uws_app_destroy(Self::SSL_FLAG, this.cast::<uws_app_t>()) }
    }

    pub fn set_flags(&mut self, require_host_header: bool, use_strict_method_validation: bool) {
        // SAFETY: self is a valid *mut uws_app_t.
        unsafe {
            c::uws_app_set_flags(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                require_host_header,
                use_strict_method_validation,
            )
        }
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        // SAFETY: self is a valid *mut uws_app_t.
        unsafe {
            c::uws_app_set_max_http_header_size(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                max_header_size,
            )
        }
    }

    pub fn clear_routes(&mut self) {
        // SAFETY: self is a valid *mut uws_app_t.
        unsafe { c::uws_app_clear_routes(Self::SSL_FLAG, self as *mut Self as *mut uws_app_t) }
    }

    pub fn publish_with_options(
        &mut self,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> bool {
        // SAFETY: self is a valid *mut uws_app_t; slices are valid for the call.
        unsafe {
            c::uws_publish(
                SSL as i32,
                self as *mut Self as *mut uws_app_t,
                topic.as_ptr(),
                topic.len(),
                message.as_ptr(),
                message.len(),
                opcode,
                compress,
            )
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // RouteHandler
    //
    // Zig's `RouteHandler(comptime UserDataType, comptime handler)` generated a
    // unique `extern "C" fn handle(...)` per (UserDataType, handler) pair at
    // comptime, downcasting `user_data: ?*anyopaque` and calling `handler` with
    // `.always_inline`.
    //
    // Rust cannot accept a `fn` as a const-generic parameter, so the type-safe
    // shim cannot be monomorphized here without a macro. Phase A exposes the raw
    // C handler type directly; callers supply their own `extern "C" fn` (or a
    // Phase-B `route_handler!` macro generates one). The shape of that shim is:
    //
    //   extern "C" fn handle<U, const SSL: bool>(
    //       res: *mut uws_res,
    //       req: *mut Request,
    //       user_data: *mut c_void,
    //   ) {
    //       let user_data = unsafe { &mut *(user_data as *mut U) };
    //       HANDLER(user_data, unsafe { &mut *req }, unsafe { &mut *(res as *mut Response<SSL>) });
    //   }
    //
    // TODO(port): proc-macro or trait-based comptime handler dispatch (RouteHandler).
    // PERF(port): was @call(.always_inline) on the user handler — profile in Phase B.
    // ─────────────────────────────────────────────────────────────────────

    pub fn get(&mut self, pattern: &[u8], handler: c::uws_method_handler, user_data: *mut c_void) {
        // SAFETY: self is a valid app; pattern outlives the call (uWS copies it).
        unsafe {
            c::uws_app_get(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn post(&mut self, pattern: &[u8], handler: c::uws_method_handler, user_data: *mut c_void) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_post(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn options(
        &mut self,
        pattern: &[u8],
        handler: c::uws_method_handler,
        user_data: *mut c_void,
    ) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_options(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn delete(
        &mut self,
        pattern: &[u8],
        handler: c::uws_method_handler,
        user_data: *mut c_void,
    ) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_delete(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn patch(
        &mut self,
        pattern: &[u8],
        handler: c::uws_method_handler,
        user_data: *mut c_void,
    ) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_patch(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn put(&mut self, pattern: &[u8], handler: c::uws_method_handler, user_data: *mut c_void) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_put(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn head(&mut self, pattern: &[u8], handler: c::uws_method_handler, user_data: *mut c_void) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_head(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn connect(
        &mut self,
        pattern: &[u8],
        handler: c::uws_method_handler,
        user_data: *mut c_void,
    ) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_connect(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn trace(
        &mut self,
        pattern: &[u8],
        handler: c::uws_method_handler,
        user_data: *mut c_void,
    ) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_trace(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn method(
        &mut self,
        method_: Method,
        pattern: &[u8],
        handler: c::uws_method_handler,
        user_data: *mut c_void,
    ) {
        match method_ {
            Method::GET => self.get(pattern, handler, user_data),
            Method::POST => self.post(pattern, handler, user_data),
            Method::PUT => self.put(pattern, handler, user_data),
            Method::DELETE => self.delete(pattern, handler, user_data),
            Method::PATCH => self.patch(pattern, handler, user_data),
            Method::OPTIONS => self.options(pattern, handler, user_data),
            Method::HEAD => self.head(pattern, handler, user_data),
            Method::CONNECT => self.connect(pattern, handler, user_data),
            Method::TRACE => self.trace(pattern, handler, user_data),
            _ => {}
        }
    }

    pub fn any(&mut self, pattern: &[u8], handler: c::uws_method_handler, user_data: *mut c_void) {
        // SAFETY: see get().
        unsafe {
            c::uws_app_any(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr(),
                pattern.len(),
                handler,
                user_data,
            )
        }
    }

    pub fn domain(&mut self, pattern: &ZStr) {
        // SAFETY: pattern is NUL-terminated; self is a valid app.
        unsafe {
            c::uws_app_domain(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                pattern.as_ptr().cast(),
            )
        }
    }

    pub fn run(&mut self) {
        // SAFETY: self is a valid app.
        unsafe { c::uws_app_run(Self::SSL_FLAG, self as *mut Self as *mut uws_app_t) }
    }

    pub fn listen(
        &mut self,
        port: i32,
        handler: extern "C" fn(*mut UwsListenSocket, c::uws_app_listen_config_t, *mut c_void),
        user_data: *mut c_void,
    ) {
        // TODO(port): Zig generated a type-safe Wrapper.handle per (UserData, handler) at
        // comptime, casting user_data and ListenSocket. Phase B: macro-generate the shim.
        // PERF(port): was @call(.always_inline) on the user handler.
        // SAFETY: self is a valid app.
        unsafe {
            c::uws_app_listen(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                port,
                Some(handler),
                user_data,
            )
        }
    }

    pub fn on_client_error(
        &mut self,
        handler: extern "C" fn(*mut c_void, c_int, *mut us_socket_t, u8, *mut u8, c_int),
        user_data: *mut c_void,
    ) {
        // TODO(port): Zig wrapped the C callback to slice raw_packet[0..max(len,0)] and pass
        // a typed UserData. Phase B: macro-generate the shim; for now callers slice manually.
        // PERF(port): was @call(.always_inline) on the user handler.
        // SAFETY: self is a valid app; handler/user_data outlive the app.
        unsafe {
            c::uws_app_set_on_clienterror(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_s,
                handler,
                user_data,
            )
        }
    }

    pub fn listen_with_config(
        &mut self,
        handler: c::uws_listen_handler,
        user_data: *mut c_void,
        config: c::uws_app_listen_config_t,
    ) {
        // TODO(port): Zig generated a type-safe Wrapper.handle per (UserData, handler) at
        // comptime. Phase B: macro-generate the shim.
        // PERF(port): was @call(.always_inline) on the user handler.
        // SAFETY: self is a valid app; config.host (if non-null) is NUL-terminated and outlives the call.
        unsafe {
            c::uws_app_listen_with_config(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                config.host,
                u16::try_from(config.port).unwrap(),
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
        // TODO(port): Zig generated a type-safe Wrapper.handle per (UserData, handler) at
        // comptime (ignoring domain/flags args, casting socket). Phase B: macro-generate.
        // PERF(port): was @call(.always_inline) on the user handler.
        // SAFETY: self is a valid app; domain_name is NUL-terminated.
        unsafe {
            c::uws_app_listen_domain_with_options(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                domain_name.as_ptr().cast(),
                domain_name.len(),
                flags,
                handler,
                user_data,
            )
        }
    }

    pub fn constructor_failed(&mut self) -> bool {
        // SAFETY: self is a valid app.
        unsafe { c::uws_constructor_failed(Self::SSL_FLAG, self as *mut Self as *mut uws_app_t) }
    }

    pub fn num_subscribers(&mut self, topic: &[u8]) -> u32 {
        // SAFETY: self is a valid app; topic valid for the call.
        unsafe {
            c::uws_num_subscribers(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                topic.as_ptr(),
                topic.len(),
            )
        }
    }

    pub fn publish(
        &mut self,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> bool {
        // SAFETY: self is a valid app; slices valid for the call.
        unsafe {
            c::uws_publish(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                topic.as_ptr(),
                topic.len(),
                message.as_ptr(),
                message.len(),
                opcode,
                compress,
            )
        }
    }

    pub fn get_native_handle(&mut self) -> *mut c_void {
        // SAFETY: self is a valid app.
        unsafe { c::uws_get_native_handle(Self::SSL_FLAG, self as *mut Self as *mut c_void) }
    }

    pub fn remove_server_name(&mut self, hostname_pattern: &core::ffi::CStr) {
        // SAFETY: self is a valid app; hostname_pattern is NUL-terminated.
        unsafe {
            c::uws_remove_server_name(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                hostname_pattern.as_ptr(),
            )
        }
    }

    pub fn add_server_name(&mut self, hostname_pattern: &core::ffi::CStr) {
        // SAFETY: self is a valid app; hostname_pattern is NUL-terminated.
        unsafe {
            c::uws_add_server_name(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                hostname_pattern.as_ptr(),
            )
        }
    }

    pub fn add_server_name_with_options(
        &mut self,
        hostname_pattern: &core::ffi::CStr,
        opts: BunSocketContextOptions,
    ) -> Result<(), AddServerNameError> {
        // SAFETY: self is a valid app; hostname_pattern is NUL-terminated.
        let rc = unsafe {
            c::uws_add_server_name_with_options(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                hostname_pattern.as_ptr(),
                opts,
            )
        };
        if rc != 0 {
            return Err(AddServerNameError::FailedToAddServerName);
        }
        Ok(())
    }

    pub fn missing_server_name(
        &mut self,
        handler: c::uws_missing_server_handler,
        user_data: *mut c_void,
    ) {
        // SAFETY: self is a valid app.
        unsafe {
            c::uws_missing_server_name(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                handler,
                user_data,
            )
        }
    }

    pub fn filter(&mut self, handler: c::uws_filter_handler, user_data: *mut c_void) {
        // SAFETY: self is a valid app.
        unsafe {
            c::uws_filter(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                handler,
                user_data,
            )
        }
    }

    pub fn ws(&mut self, pattern: &[u8], ctx: *mut c_void, id: usize, behavior_: WebSocketBehavior) {
        let mut behavior = behavior_;
        // SAFETY: self is a valid app; pattern valid for the call; behavior is stack-local.
        unsafe {
            uws_ws(
                Self::SSL_FLAG,
                self as *mut Self as *mut uws_app_t,
                ctx,
                pattern.as_ptr(),
                pattern.len(),
                id,
                &mut behavior,
            )
        }
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
    // TODO(port): Zig exposed `Response` and `WebSocket` as nested associated types
    // (App<SSL>::Response). Rust inherent associated types are unstable; callers use
    // `crate::response::Response<{SSL as i32}>` / `crate::web_socket::WebSocket<{SSL as i32}>`
    // directly until Phase B picks a stable encoding (trait assoc type or type alias).
}

/// Opaque listen socket handle, parameterized by SSL to match `App<SSL>`.
///
/// TODO(port): in Zig this was a nested `App<SSL>::ListenSocket` opaque. Rust cannot
/// nest type definitions inside an `impl`; defined at module level instead.
#[repr(C)]
pub struct ListenSocket<const SSL: bool> {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl<const SSL: bool> ListenSocket<SSL> {
    #[inline]
    pub fn close(&mut self) {
        // SAFETY: ListenSocket<SSL> is layout-identical to crate::ListenSocket (both opaque).
        unsafe { (*(self as *mut Self as *mut UwsListenSocket)).close() }
    }

    #[inline]
    pub fn get_local_port(&mut self) -> i32 {
        // SAFETY: opaque cast as above.
        unsafe { (*(self as *mut Self as *mut UwsListenSocket)).get_local_port() }
    }

    pub fn socket(&mut self) -> SocketHandler<SSL> {
        // SAFETY: opaque cast; SocketHandler::from accepts *mut us_socket_t-compatible ptr.
        unsafe { SocketHandler::<SSL>::from((self as *mut Self).cast()) }
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum AddServerNameError {
    #[error("FailedToAddServerName")]
    FailedToAddServerName,
}

impl From<AddServerNameError> for bun_core::Error {
    fn from(e: AddServerNameError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

#[repr(C)]
pub struct uws_app_s {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}
pub type uws_app_t = uws_app_s;

#[allow(non_camel_case_types)]
pub mod c {
    use super::*;

    pub type uws_listen_handler =
        Option<extern "C" fn(*mut UwsListenSocket, *mut c_void)>;
    pub type uws_method_handler =
        Option<extern "C" fn(*mut uws_res, *mut Request, *mut c_void)>;
    pub type uws_filter_handler =
        Option<extern "C" fn(*mut uws_res, i32, *mut c_void)>;
    pub type uws_missing_server_handler =
        Option<extern "C" fn(*const c_char, *mut c_void)>;

    unsafe extern "C" {
        pub fn uws_app_close(ssl: i32, app: *mut uws_app_s);
        pub fn uws_app_close_idle(ssl: i32, app: *mut uws_app_s);
        pub fn uws_app_set_on_clienterror(
            ssl: c_int,
            app: *mut uws_app_s,
            handler: extern "C" fn(*mut c_void, c_int, *mut us_socket_t, u8, *mut u8, c_int),
            user_data: *mut c_void,
        );
        pub fn uws_create_app(ssl: i32, options: BunSocketContextOptions) -> *mut uws_app_t;
        pub fn uws_app_destroy(ssl: i32, app: *mut uws_app_t);
        pub fn uws_app_set_flags(
            ssl: i32,
            app: *mut uws_app_t,
            require_host_header: bool,
            use_strict_method_validation: bool,
        );
        pub fn uws_app_set_max_http_header_size(ssl: i32, app: *mut uws_app_t, max_header_size: u64);
        pub fn uws_app_get(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_post(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_options(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_delete(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_patch(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_put(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_head(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_connect(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_trace(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_any(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub fn uws_app_run(ssl: i32, app: *mut uws_app_t);
        pub fn uws_app_domain(ssl: i32, app: *mut uws_app_t, domain: *const c_char);
        pub fn uws_app_listen(
            ssl: i32,
            app: *mut uws_app_t,
            port: i32,
            handler: Option<
                extern "C" fn(*mut UwsListenSocket, uws_app_listen_config_t, *mut c_void),
            >,
            user_data: *mut c_void,
        );
        pub fn uws_app_listen_with_config(
            ssl: i32,
            app: *mut uws_app_t,
            host: *const c_char,
            port: u16,
            options: i32,
            handler: uws_listen_handler,
            user_data: *mut c_void,
        );
        pub fn uws_constructor_failed(ssl: i32, app: *mut uws_app_t) -> bool;
        pub fn uws_num_subscribers(
            ssl: i32,
            app: *mut uws_app_t,
            topic: *const u8,
            topic_length: usize,
        ) -> c_uint;
        pub fn uws_publish(
            ssl: i32,
            app: *mut uws_app_t,
            topic: *const u8,
            topic_length: usize,
            message: *const u8,
            message_length: usize,
            opcode: Opcode,
            compress: bool,
        ) -> bool;
        pub fn uws_get_native_handle(ssl: i32, app: *mut c_void) -> *mut c_void;
        pub fn uws_remove_server_name(
            ssl: i32,
            app: *mut uws_app_t,
            hostname_pattern: *const c_char,
        );
        pub fn uws_add_server_name(ssl: i32, app: *mut uws_app_t, hostname_pattern: *const c_char);
        pub fn uws_add_server_name_with_options(
            ssl: i32,
            app: *mut uws_app_t,
            hostname_pattern: *const c_char,
            options: BunSocketContextOptions,
        ) -> i32;
        pub fn uws_missing_server_name(
            ssl: i32,
            app: *mut uws_app_t,
            handler: uws_missing_server_handler,
            user_data: *mut c_void,
        );
        pub fn uws_filter(
            ssl: i32,
            app: *mut uws_app_t,
            handler: uws_filter_handler,
            user_data: *mut c_void,
        );

        pub fn uws_app_listen_domain_with_options(
            ssl_flag: c_int,
            app: *mut uws_app_t,
            domain: *const c_char,
            pathlen: usize,
            flags: i32,
            handler: extern "C" fn(*mut UwsListenSocket, *const c_char, i32, *mut c_void),
            user_data: *mut c_void,
        );

        pub fn uws_app_clear_routes(ssl_flag: c_int, app: *mut uws_app_t);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct uws_app_listen_config_t {
        pub port: c_int,
        pub host: *const c_char,
        pub options: c_int,
    }

    impl uws_app_listen_config_t {
        // Zig has no default for `port` (only `host = null`, `options = 0`); `.{}` is illegal there.
        // Provide a required-port constructor instead of `Default` to avoid inventing port=0.
        pub const fn new(port: c_int) -> Self {
            Self {
                port,
                host: ptr::null(),
                options: 0,
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/App.zig (466 lines)
//   confidence: medium
//   todos:      8
//   notes:      comptime per-handler extern "C" shims (RouteHandler/listen wrappers) deferred to Phase B macro; Response/WebSocket/ListenSocket nested types hoisted to module level; destroy() is unsafe *mut Self per FFI-destroy rule; uws_app_listen_config_t has new(port) not Default (Zig requires port)
// ──────────────────────────────────────────────────────────────────────────
