use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr;

use bun_core::ZStr;
use bun_http_types::Method::Method;

use crate::socket_context::BunSocketContextOptions;
use crate::web_socket::c::uws_ws;
use crate::{
    ListenSocket as UwsListenSocket, Opcode, Request, WebSocketBehavior, us_socket_t, uws_res,
};

/// Opaque handle to a uWS::TemplatedApp<SSL>. Always used via `*mut App<SSL>`.
#[repr(C)]
pub struct App<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

/// Zig name compatibility (`uws.NewApp(ssl)`).
pub type NewApp<const SSL: bool> = App<SSL>;

macro_rules! uws_app_route_methods {
    ($($name:ident => $cfn:ident),* $(,)?) => {$(
        pub fn $name(
            &mut self,
            pattern: &[u8],
            handler: c::uws_method_handler,
            user_data: *mut c_void,
        ) {
            // SAFETY: self is a valid app; pattern outlives the call (uWS copies it).
            unsafe {
                c::$cfn(
                    Self::SSL_FLAG,
                    std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                    pattern.as_ptr(),
                    pattern.len(),
                    handler,
                    user_data,
                )
            }
        }
    )*};
}

impl<const SSL: bool> App<SSL> {
    pub const IS_SSL: bool = SSL;
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

    pub fn close_idle_connections(&mut self) {
        c::uws_app_close_idle(Self::SSL_FLAG, self.as_raw())
    }

    pub fn create(opts: &BunSocketContextOptions) -> Option<*mut Self> {
        // SAFETY: FFI call; uws_create_app returns null on failure.
        let app = unsafe { c::uws_create_app(Self::SSL_FLAG, *opts) };
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
        c::uws_app_set_flags(
            Self::SSL_FLAG,
            self.as_raw(),
            require_host_header,
            use_strict_method_validation,
        )
    }

    pub fn set_max_http_header_size(&mut self, max_header_size: u64) {
        c::uws_app_set_max_http_header_size(Self::SSL_FLAG, self.as_raw(), max_header_size)
    }

    pub fn clear_routes(&mut self) {
        c::uws_app_clear_routes(Self::SSL_FLAG, self.as_raw())
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
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                topic.as_ptr(),
                topic.len(),
                message.as_ptr(),
                message.len(),
                opcode,
                compress,
            )
        }
    }

    uws_app_route_methods! {
        get     => uws_app_get,
        post    => uws_app_post,
        options => uws_app_options,
        delete  => uws_app_delete,
        patch   => uws_app_patch,
        put     => uws_app_put,
        head    => uws_app_head,
        connect => uws_app_connect,
        trace   => uws_app_trace,
        any     => uws_app_any,
    }

    /// Alias matching uWS C++ `del()` naming (Rust `delete` is not reserved, but callers
    /// porting from uWS expect `del`).
    #[inline]
    pub fn del(&mut self, pattern: &[u8], handler: c::uws_method_handler, user_data: *mut c_void) {
        self.delete(pattern, handler, user_data)
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

    pub fn domain(&mut self, pattern: &ZStr) {
        // SAFETY: pattern is NUL-terminated; self is a valid app.
        unsafe {
            c::uws_app_domain(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                pattern.as_ptr().cast(),
            )
        }
    }

    pub fn run(&mut self) {
        c::uws_app_run(Self::SSL_FLAG, self.as_raw())
    }

    pub fn listen(
        &mut self,
        port: i32,
        handler: extern "C" fn(*mut UwsListenSocket, *mut c_void),
        user_data: *mut c_void,
    ) {
        // TODO(port): Zig generated a type-safe Wrapper.handle per (UserData, handler) at
        // comptime, casting user_data and ListenSocket. Macro-generate the shim.
        // PERF(port): was @call(.always_inline) on the user handler.
        c::uws_app_listen(
            Self::SSL_FLAG,
            self.as_raw(),
            port,
            Some(handler),
            user_data,
        )
    }

    pub fn on_client_error(
        &mut self,
        handler: extern "C" fn(*mut c_void, c_int, *mut us_socket_t, u8, *mut u8, c_int),
        user_data: *mut c_void,
    ) {
        // TODO(port): Zig wrapped the C callback to slice raw_packet[0..max(len,0)] and pass
        // a typed UserData. Macro-generate the shim; for now callers slice manually.
        // PERF(port): was @call(.always_inline) on the user handler.
        c::uws_app_set_on_clienterror(Self::SSL_FLAG, self.as_raw(), handler, user_data)
    }

    pub fn listen_with_config(
        &mut self,
        handler: c::uws_listen_handler,
        user_data: *mut c_void,
        config: c::uws_app_listen_config_t,
    ) {
        // TODO(port): Zig generated a type-safe Wrapper.handle per (UserData, handler) at
        // comptime. Macro-generate the shim.
        // PERF(port): was @call(.always_inline) on the user handler.
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
        // TODO(port): Zig generated a type-safe Wrapper.handle per (UserData, handler) at
        // comptime (ignoring domain/flags args, casting socket). Macro-generate the shim.
        // PERF(port): was @call(.always_inline) on the user handler.
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

    pub fn constructor_failed(&mut self) -> bool {
        c::uws_constructor_failed(Self::SSL_FLAG, self.as_raw())
    }

    pub fn num_subscribers(&mut self, topic: &[u8]) -> u32 {
        // SAFETY: self is a valid app; topic valid for the call.
        unsafe {
            c::uws_num_subscribers(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
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
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
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
        c::uws_get_native_handle(Self::SSL_FLAG, self.as_raw())
    }

    pub fn remove_server_name(&mut self, hostname_pattern: &core::ffi::CStr) {
        // SAFETY: self is a valid app; hostname_pattern is NUL-terminated.
        unsafe {
            c::uws_remove_server_name(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                hostname_pattern.as_ptr(),
            )
        }
    }

    pub fn add_server_name(&mut self, hostname_pattern: &core::ffi::CStr) {
        // SAFETY: self is a valid app; hostname_pattern is NUL-terminated.
        unsafe {
            c::uws_add_server_name(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                hostname_pattern.as_ptr(),
            )
        }
    }

    pub fn add_server_name_with_options(
        &mut self,
        hostname_pattern: &core::ffi::CStr,
        opts: &BunSocketContextOptions,
    ) -> Result<(), AddServerNameError> {
        // SAFETY: self is a valid app; hostname_pattern is NUL-terminated.
        let rc = unsafe {
            c::uws_add_server_name_with_options(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                hostname_pattern.as_ptr(),
                *opts,
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
        c::uws_missing_server_name(Self::SSL_FLAG, self.as_raw(), handler, user_data)
    }

    pub fn filter(&mut self, handler: c::uws_filter_handler, user_data: *mut c_void) {
        c::uws_filter(Self::SSL_FLAG, self.as_raw(), handler, user_data)
    }

    pub fn ws(
        &mut self,
        pattern: &[u8],
        ctx: *mut c_void,
        id: usize,
        behavior_: WebSocketBehavior,
    ) {
        let behavior = behavior_;
        // SAFETY: self is a valid app; pattern valid for the call; behavior is stack-local.
        unsafe {
            uws_ws(
                Self::SSL_FLAG,
                std::ptr::from_mut::<Self>(self).cast::<uws_app_t>(),
                ctx,
                pattern.as_ptr(),
                pattern.len(),
                id,
                &raw const behavior,
            )
        }
    }
}

#[repr(C)]
pub struct ListenSocket<const SSL: bool> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl<const SSL: bool> ListenSocket<SSL> {
    #[inline]
    pub fn close(&mut self) {
        // S008: ListenSocket<SSL> is layout-identical to crate::ListenSocket
        // (both ZST opaques) — safe deref via `opaque_deref_mut`.
        bun_opaque::opaque_deref_mut(std::ptr::from_mut::<Self>(self).cast::<UwsListenSocket>())
            .close()
    }

    #[inline]
    pub fn get_local_port(&mut self) -> i32 {
        // S008: opaque ZST cast as above.
        bun_opaque::opaque_deref_mut(std::ptr::from_mut::<Self>(self).cast::<UwsListenSocket>())
            .get_local_port()
    }

    pub fn socket(&mut self) -> crate::socket::NewSocketHandler<SSL> {
        // SAFETY: ListenSocket<SSL> is layout-identical to us_socket_t on the C side
        // (a listen socket IS a us_socket_t); Zig does `.from(@ptrCast(this))`.
        crate::socket::NewSocketHandler::<SSL>::from(std::ptr::from_mut::<Self>(self).cast())
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum AddServerNameError {
    FailedToAddServerName,
}
bun_core::impl_tag_error!(AddServerNameError);

bun_core::named_error_set!(AddServerNameError);

bun_opaque::opaque_ffi! { pub struct uws_app_s; }
pub type uws_app_t = uws_app_s;

#[allow(non_camel_case_types)]
pub mod c {
    use super::*;

    pub(crate) type uws_listen_handler = Option<extern "C" fn(*mut UwsListenSocket, *mut c_void)>;
    pub(crate) type uws_method_handler =
        Option<extern "C" fn(*mut uws_res, *mut Request, *mut c_void)>;
    pub(crate) type uws_filter_handler = Option<extern "C" fn(*mut uws_res, i32, *mut c_void)>;
    pub(crate) type uws_missing_server_handler = Option<extern "C" fn(*const c_char, *mut c_void)>;

    unsafe extern "C" {
        pub(crate) safe fn uws_app_close(ssl: i32, app: &mut uws_app_s);
        pub(crate) safe fn uws_app_close_idle(ssl: i32, app: &mut uws_app_s);
        // safe: `&mut uws_app_s` is ABI-identical to a non-null `*mut`;
        // `handler`/`user_data` are stored opaquely (never dereferenced by the
        // C++ shim itself) — no preconditions on this call.
        pub(crate) safe fn uws_app_set_on_clienterror(
            ssl: c_int,
            app: &mut uws_app_s,
            handler: extern "C" fn(*mut c_void, c_int, *mut us_socket_t, u8, *mut u8, c_int),
            user_data: *mut c_void,
        );
        pub(crate) fn uws_create_app(ssl: i32, options: BunSocketContextOptions) -> *mut uws_app_t;
        pub(crate) fn uws_app_destroy(ssl: i32, app: *mut uws_app_t);
        pub(crate) safe fn uws_app_set_flags(
            ssl: i32,
            app: &mut uws_app_t,
            require_host_header: bool,
            use_strict_method_validation: bool,
        );
        pub(crate) safe fn uws_app_set_max_http_header_size(
            ssl: i32,
            app: &mut uws_app_t,
            max_header_size: u64,
        );
        pub(crate) fn uws_app_get(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_post(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_options(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_delete(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_patch(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_put(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_head(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_connect(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_trace(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) fn uws_app_any(
            ssl: i32,
            app: *mut uws_app_t,
            pattern: *const u8,
            pattern_len: usize,
            handler: uws_method_handler,
            user_data: *mut c_void,
        );
        pub(crate) safe fn uws_app_run(ssl: i32, app: &mut uws_app_t);
        pub(crate) fn uws_app_domain(ssl: i32, app: *mut uws_app_t, domain: *const c_char);
        // safe: handle-only + value `port`; `handler`/`user_data` are stored
        // opaquely — no preconditions on this call.
        pub(crate) safe fn uws_app_listen(
            ssl: i32,
            app: &mut uws_app_t,
            port: i32,
            handler: uws_listen_handler,
            user_data: *mut c_void,
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
        pub(crate) safe fn uws_constructor_failed(ssl: i32, app: &mut uws_app_t) -> bool;
        pub(crate) fn uws_num_subscribers(
            ssl: i32,
            app: *mut uws_app_t,
            topic: *const u8,
            topic_length: usize,
        ) -> c_uint;
        pub(crate) fn uws_publish(
            ssl: i32,
            app: *mut uws_app_t,
            topic: *const u8,
            topic_length: usize,
            message: *const u8,
            message_length: usize,
            opcode: Opcode,
            compress: bool,
        ) -> bool;
        pub(crate) safe fn uws_get_native_handle(ssl: i32, app: &mut uws_app_s) -> *mut c_void;
        pub(crate) fn uws_remove_server_name(
            ssl: i32,
            app: *mut uws_app_t,
            hostname_pattern: *const c_char,
        );
        pub(crate) fn uws_add_server_name(
            ssl: i32,
            app: *mut uws_app_t,
            hostname_pattern: *const c_char,
        );
        pub(crate) fn uws_add_server_name_with_options(
            ssl: i32,
            app: *mut uws_app_t,
            hostname_pattern: *const c_char,
            options: BunSocketContextOptions,
        ) -> i32;
        pub(crate) safe fn uws_missing_server_name(
            ssl: i32,
            app: &mut uws_app_t,
            handler: uws_missing_server_handler,
            user_data: *mut c_void,
        );
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

        pub(crate) safe fn uws_app_clear_routes(ssl_flag: c_int, app: &mut uws_app_t);
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

// ported from: src/uws_sys/App.zig
