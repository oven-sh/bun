//! HTTP/3 bindings. Method names mirror NewApp/NewResponse 1:1 so the
//! comptime callers in server.zig and the `inline else` arms in AnyResponse
//! see the same surface regardless of transport.

use core::ffi::{c_char, c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr;

use crate::response::{State, WriteResult};
use crate::socket_context::BunSocketContextOptions;
use crate::SocketAddress;

// ──────────────────────────────────────────────────────────────────────────
// ListenSocket
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct ListenSocket {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl ListenSocket {
    pub fn close(&mut self) {
        // SAFETY: self is a live FFI handle owned by uws
        unsafe { c::uws_h3_listen_socket_close(self) }
    }
    pub fn get_local_port(&mut self) -> i32 {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_listen_socket_port(self) }
    }
    pub fn get_local_address<'a>(&mut self, buf: &'a mut [u8]) -> Option<&'a [u8]> {
        // SAFETY: self is a live FFI handle; buf ptr/len valid for write
        let n = unsafe {
            c::uws_h3_listen_socket_local_address(
                self,
                buf.as_mut_ptr(),
                c_int::try_from(buf.len()).unwrap(),
            )
        };
        if n <= 0 {
            return None;
        }
        Some(&buf[..usize::try_from(n).unwrap()])
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Request
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct Request {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Request {
    pub fn is_ancient(&self) -> bool {
        false
    }
    pub fn get_yield(&mut self) -> bool {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_req_get_yield(self) }
    }
    pub fn set_yield(&mut self, y: bool) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_req_set_yield(self, y) }
    }
    pub fn url(&mut self) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; out-ptr is a valid local
        let n = unsafe { c::uws_h3_req_get_url(self, &mut p) };
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { core::slice::from_raw_parts(p, n) }
    }
    pub fn method(&mut self) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; out-ptr is a valid local
        let n = unsafe { c::uws_h3_req_get_method(self, &mut p) };
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { core::slice::from_raw_parts(p, n) }
    }
    pub fn header(&mut self, name: &[u8]) -> Option<&[u8]> {
        let mut p: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; name ptr/len valid for read; out-ptr is a valid local
        let n = unsafe { c::uws_h3_req_get_header(self, name.as_ptr(), name.len(), &mut p) };
        if n == 0 {
            None
        } else {
            // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
            Some(unsafe { core::slice::from_raw_parts(p, n) })
        }
    }
    pub fn date_for_header(&mut self, name: &[u8]) -> Option<u64> {
        // Cycle-break: parsing an HTTP date requires `bun_str::String` +
        // `jsc::VirtualMachine` (tier > 0). Low tier calls through a hook
        // registered at runtime init — see `crate::request::PARSE_DATE_HOOK`.
        self.header(name).and_then(crate::request::parse_date_via_hook)
    }
    pub fn query(&mut self, name: &[u8]) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; name ptr/len valid for read; out-ptr is a valid local
        let n = unsafe { c::uws_h3_req_get_query(self, name.as_ptr(), name.len(), &mut p) };
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { core::slice::from_raw_parts(p, n) }
    }
    pub fn parameter(&mut self, idx: u16) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; out-ptr is a valid local
        let n = unsafe { c::uws_h3_req_get_parameter(self, idx, &mut p) };
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { core::slice::from_raw_parts(p, n) }
    }
    pub fn for_each_header<Ctx>(
        &mut self,
        cb: fn(ctx: &mut Ctx, name: &[u8], value: &[u8]),
        ctx: *mut Ctx,
    ) {
        // TODO(port): Zig monomorphized `cb` at comptime into the C trampoline.
        // Rust cannot capture a runtime fn pointer inside a bare `extern "C" fn`
        // without const-fn-ptr generics (unstable) or a macro. Phase B: convert
        // call sites to `h3_for_each_header!(req, ctx, |ctx, n, v| ...)` macro.
        let _ = cb;
        unsafe extern "C" fn each<Ctx>(
            _n: *const u8,
            _nl: usize,
            _v: *const u8,
            _vl: usize,
            _ud: *mut c_void,
        ) {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // SAFETY: self is a live FFI handle; trampoline is `extern "C"`; ctx forwarded opaquely
        unsafe { c::uws_h3_req_for_each_header(self, each::<Ctx>, ctx.cast()) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Response
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct Response {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Response {
    pub fn end(&mut self, data: &[u8], close_connection: bool) {
        // SAFETY: self is a live FFI handle; data ptr/len valid for read
        unsafe { c::uws_h3_res_end(self, data.as_ptr(), data.len(), close_connection) }
    }
    pub fn try_end(&mut self, data: &[u8], total: usize, close_connection: bool) -> bool {
        // SAFETY: self is a live FFI handle; data ptr/len valid for read
        unsafe { c::uws_h3_res_try_end(self, data.as_ptr(), data.len(), total, close_connection) }
    }
    pub fn end_without_body(&mut self, close_connection: bool) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_end_without_body(self, close_connection) }
    }
    pub fn end_stream(&mut self, close_connection: bool) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_end_stream(self, close_connection) }
    }
    pub fn end_send_file(&mut self, write_offset: u64, close_connection: bool) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_end_sendfile(self, write_offset, close_connection) }
    }
    pub fn write(&mut self, data: &[u8]) -> WriteResult {
        let mut len: usize = data.len();
        // SAFETY: self is a live FFI handle; data ptr valid for read; len out-ptr is a valid local
        if unsafe { c::uws_h3_res_write(self, data.as_ptr(), &mut len) } {
            WriteResult::WantMore(len)
        } else {
            WriteResult::Backpressure(len)
        }
    }
    pub fn write_status(&mut self, status: &[u8]) {
        // SAFETY: self is a live FFI handle; status ptr/len valid for read
        unsafe { c::uws_h3_res_write_status(self, status.as_ptr(), status.len()) }
    }
    pub fn write_header(&mut self, key: &[u8], value: &[u8]) {
        // SAFETY: self is a live FFI handle; key/value ptr+len valid for read
        unsafe {
            c::uws_h3_res_write_header(self, key.as_ptr(), key.len(), value.as_ptr(), value.len())
        }
    }
    pub fn write_header_int(&mut self, key: &[u8], value: u64) {
        // SAFETY: self is a live FFI handle; key ptr/len valid for read
        unsafe { c::uws_h3_res_write_header_int(self, key.as_ptr(), key.len(), value) }
    }
    pub fn write_mark(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_write_mark(self) }
    }
    pub fn mark_wrote_content_length_header(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_mark_wrote_content_length_header(self) }
    }
    pub fn write_continue(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_write_continue(self) }
    }
    pub fn flush_headers(&mut self, immediate: bool) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_flush_headers(self, immediate) }
    }
    pub fn pause(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_pause(self) }
    }
    pub fn resume(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_resume(self) }
    }
    pub fn timeout(&mut self, seconds: u8) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_timeout(self, seconds) }
    }
    pub fn reset_timeout(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_reset_timeout(self) }
    }
    pub fn get_write_offset(&mut self) -> u64 {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_get_write_offset(self) }
    }
    pub fn override_write_offset(&mut self, off: u64) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_override_write_offset(self, off) }
    }
    pub fn get_buffered_amount(&mut self) -> u64 {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_get_buffered_amount(self) }
    }
    pub fn has_responded(&mut self) -> bool {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_has_responded(self) }
    }
    pub fn state(&mut self) -> State {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_state(self) }
    }
    pub fn should_close_connection(&mut self) -> bool {
        self.state().is_http_connection_close()
    }
    pub fn is_corked(&self) -> bool {
        false
    }
    pub fn uncork(&mut self) {}
    pub fn is_connect_request(&self) -> bool {
        false
    }
    pub fn prepare_for_sendfile(&mut self) {}
    pub fn mark_needs_more(&mut self) {}
    pub fn get_socket_data(&mut self) -> *mut c_void {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_get_socket_data(self) }
    }
    pub fn get_remote_socket_info(&mut self) -> Option<SocketAddress> {
        let mut port: i32 = 0;
        let mut is_ipv6: bool = false;
        let mut ip_ptr: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; out-ptrs are valid locals
        let len = unsafe {
            c::uws_h3_res_get_remote_address_info(self, &mut ip_ptr, &mut port, &mut is_ipv6)
        };
        if len == 0 {
            return None;
        }
        // SAFETY: uws returns a pointer+len pair valid while the response is alive
        let ip = unsafe { core::slice::from_raw_parts(ip_ptr, len) };
        // TODO(port): SocketAddress.ip is a borrowed slice in Zig; Rust field type TBD
        Some(SocketAddress { ip, port, is_ipv6 })
    }
    pub fn force_close(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_force_close(self) }
    }

    pub fn on_writable<UD>(
        &mut self,
        handler: fn(&mut UD, u64, &mut Response) -> bool,
        ud: *mut UD,
    ) {
        // TODO(port): comptime-fn trampoline — see note on `for_each_header`.
        let _ = handler;
        unsafe extern "C" fn cb<UD>(_r: *mut Response, _off: u64, _p: *mut c_void) -> bool {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // SAFETY: self is a live FFI handle; trampoline is `extern "C"`; ud forwarded opaquely
        unsafe { c::uws_h3_res_on_writable(self, Some(cb::<UD>), ud.cast()) }
    }
    pub fn clear_on_writable(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_res_clear_on_writable(self) }
    }
    pub fn on_aborted<UD>(&mut self, handler: fn(&mut UD, &mut Response), ud: *mut UD) {
        // TODO(port): comptime-fn trampoline — see note on `for_each_header`.
        let _ = handler;
        unsafe extern "C" fn cb<UD>(_r: *mut Response, _p: *mut c_void) {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // SAFETY: self is a live FFI handle; trampoline is `extern "C"`; ud forwarded opaquely
        unsafe { c::uws_h3_res_on_aborted(self, Some(cb::<UD>), ud.cast()) }
    }
    pub fn clear_aborted(&mut self) {
        // SAFETY: self is a live FFI handle; None clears the callback
        unsafe { c::uws_h3_res_on_aborted(self, None, ptr::null_mut()) }
    }
    pub fn on_timeout<UD>(&mut self, handler: fn(&mut UD, &mut Response), ud: *mut UD) {
        // TODO(port): comptime-fn trampoline — see note on `for_each_header`.
        let _ = handler;
        unsafe extern "C" fn cb<UD>(_r: *mut Response, _p: *mut c_void) {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // SAFETY: self is a live FFI handle; trampoline is `extern "C"`; ud forwarded opaquely
        unsafe { c::uws_h3_res_on_timeout(self, Some(cb::<UD>), ud.cast()) }
    }
    pub fn clear_timeout(&mut self) {
        // SAFETY: self is a live FFI handle; None clears the callback
        unsafe { c::uws_h3_res_on_timeout(self, None, ptr::null_mut()) }
    }
    pub fn on_data<UD>(
        &mut self,
        handler: fn(&mut UD, &mut Response, &[u8], bool),
        ud: *mut UD,
    ) {
        // TODO(port): comptime-fn trampoline — see note on `for_each_header`.
        let _ = handler;
        unsafe extern "C" fn cb<UD>(
            _r: *mut Response,
            _ptr: *const u8,
            _len: usize,
            _last: bool,
            _p: *mut c_void,
        ) {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // SAFETY: self is a live FFI handle; trampoline is `extern "C"`; ud forwarded opaquely
        unsafe { c::uws_h3_res_on_data(self, Some(cb::<UD>), ud.cast()) }
    }
    pub fn clear_on_data(&mut self) {
        // SAFETY: self is a live FFI handle; None clears the callback
        unsafe { c::uws_h3_res_on_data(self, None, ptr::null_mut()) }
    }
    pub fn corked(&mut self, handler: impl FnOnce()) {
        // H3 has no corking; the Zig version just calls the handler immediately.
        let _ = self;
        handler();
    }
    pub fn run_corked_with_type<UD>(&mut self, handler: fn(&mut UD), ud: *mut UD) {
        // TODO(port): comptime-fn trampoline — see note on `for_each_header`.
        let _ = handler;
        unsafe extern "C" fn cb<UD>(_p: *mut c_void) {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // SAFETY: self is a live FFI handle; trampoline is `extern "C"`; ud forwarded opaquely
        unsafe { c::uws_h3_res_cork(self, ud.cast(), cb::<UD>) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct App {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[derive(Copy, Clone)]
enum RouteKind {
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Head,
    Options,
    Connect,
    Trace,
    Any,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum AddServerNameError {
    #[error("FailedToAddServerName")]
    FailedToAddServerName,
}

impl App {
    pub fn create(opts: BunSocketContextOptions, idle_timeout_s: u32) -> Option<*mut App> {
        // SAFETY: opts is `#[repr(C)]` passed by value; uws owns the returned handle
        let p = unsafe { c::uws_h3_create_app(opts, idle_timeout_s) };
        if p.is_null() { None } else { Some(p) }
    }
    pub fn add_server_name_with_options(
        &mut self,
        hostname: &bun_core::ZStr,
        opts: BunSocketContextOptions,
    ) -> Result<(), AddServerNameError> {
        // SAFETY: self is a live FFI handle; hostname is NUL-terminated; opts passed by value
        if !unsafe { c::uws_h3_app_add_server_name(self, hostname.as_ptr().cast(), opts) } {
            return Err(AddServerNameError::FailedToAddServerName);
        }
        Ok(())
    }
    /// # Safety
    /// `this` must be a live App handle previously returned by `App::create`;
    /// it is freed by this call and must not be used afterwards.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract above
        unsafe { c::uws_h3_app_destroy(this) }
    }
    pub fn close(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_app_close(self) }
    }
    pub fn clear_routes(&mut self) {
        // SAFETY: self is a live FFI handle
        unsafe { c::uws_h3_app_clear_routes(self) }
    }

    fn route<UD>(
        which: RouteKind,
        this: &mut App,
        pattern: &[u8],
        ud: *mut UD,
        handler: fn(&mut UD, &mut Request, &mut Response),
    ) {
        // TODO(port): comptime-fn trampoline — see note on `for_each_header`.
        let _ = handler;
        unsafe extern "C" fn cb<UD>(_res: *mut Response, _req: *mut Request, _p: *mut c_void) {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // PERF(port): was comptime enum dispatch — profile in Phase B
        let f = match which {
            RouteKind::Get => c::uws_h3_app_get,
            RouteKind::Post => c::uws_h3_app_post,
            RouteKind::Put => c::uws_h3_app_put,
            RouteKind::Delete => c::uws_h3_app_delete,
            RouteKind::Patch => c::uws_h3_app_patch,
            RouteKind::Head => c::uws_h3_app_head,
            RouteKind::Options => c::uws_h3_app_options,
            RouteKind::Connect => c::uws_h3_app_connect,
            RouteKind::Trace => c::uws_h3_app_trace,
            RouteKind::Any => c::uws_h3_app_any,
        };
        // SAFETY: this is a live FFI handle; pattern ptr/len valid for read; trampoline is `extern "C"`
        unsafe { f(this, pattern.as_ptr(), pattern.len(), Some(cb::<UD>), ud.cast()) }
    }

    pub fn get<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Get, self, p, ud, h);
    }
    pub fn post<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Post, self, p, ud, h);
    }
    pub fn put<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Put, self, p, ud, h);
    }
    pub fn delete<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Delete, self, p, ud, h);
    }
    pub fn patch<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Patch, self, p, ud, h);
    }
    pub fn head<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Head, self, p, ud, h);
    }
    pub fn options<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Options, self, p, ud, h);
    }
    pub fn any<UD>(&mut self, p: &[u8], ud: *mut UD, h: fn(&mut UD, &mut Request, &mut Response)) {
        Self::route(RouteKind::Any, self, p, ud, h);
    }
    pub fn method<UD>(
        &mut self,
        m: bun_http_types::Method,
        p: &[u8],
        ud: *mut UD,
        h: fn(&mut UD, &mut Request, &mut Response),
    ) {
        use bun_http_types::Method as M;
        match m {
            M::GET => self.get(p, ud, h),
            M::POST => self.post(p, ud, h),
            M::PUT => self.put(p, ud, h),
            M::DELETE => self.delete(p, ud, h),
            M::PATCH => self.patch(p, ud, h),
            M::OPTIONS => self.options(p, ud, h),
            M::HEAD => self.head(p, ud, h),
            M::CONNECT => Self::route(RouteKind::Connect, self, p, ud, h),
            M::TRACE => Self::route(RouteKind::Trace, self, p, ud, h),
            _ => {}
        }
    }

    pub fn listen_with_config<UD>(
        &mut self,
        ud: *mut UD,
        handler: fn(&mut UD, Option<&mut ListenSocket>),
        config: ListenConfig,
    ) {
        // TODO(port): comptime-fn trampoline — see note on `for_each_header`.
        let _ = handler;
        unsafe extern "C" fn cb<UD>(_ls: *mut ListenSocket, _p: *mut c_void) {
            unimplemented!("TODO(port): comptime handler trampoline");
        }
        // SAFETY: self is a live FFI handle; config fields valid; trampoline is `extern "C"`
        unsafe {
            c::uws_h3_app_listen_with_config(
                self,
                config.host,
                config.port,
                config.options,
                Some(cb::<UD>),
                ud.cast(),
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ListenConfig
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct ListenConfig {
    pub port: u16,
    pub host: *const c_char,
    pub options: i32,
}

impl Default for ListenConfig {
    fn default() -> Self {
        Self { port: 0, host: ptr::null(), options: 0 }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C"
// ──────────────────────────────────────────────────────────────────────────

mod c {
    use super::*;

    pub type Handler =
        Option<unsafe extern "C" fn(*mut Response, *mut Request, *mut c_void)>;
    pub type ListenHandler =
        Option<unsafe extern "C" fn(*mut ListenSocket, *mut c_void)>;
    pub type HeaderCb =
        unsafe extern "C" fn(*const u8, usize, *const u8, usize, *mut c_void);

    unsafe extern "C" {
        pub fn uws_h3_create_app(opts: BunSocketContextOptions, idle_timeout_s: u32) -> *mut App;
        pub fn uws_h3_app_destroy(app: *mut App);
        pub fn uws_h3_app_close(app: *mut App);
        pub fn uws_h3_app_clear_routes(app: *mut App);
        pub fn uws_h3_app_add_server_name(
            app: *mut App,
            hostname: *const c_char,
            opts: BunSocketContextOptions,
        ) -> bool;
        pub fn uws_h3_res_write_continue(res: *mut Response);
        pub fn uws_h3_app_get(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_post(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_put(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_delete(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_patch(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_head(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_options(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_connect(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_trace(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_any(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_listen_with_config(
            app: *mut App,
            host: *const c_char,
            port: u16,
            options: i32,
            h: ListenHandler,
            ud: *mut c_void,
        );
        pub fn uws_h3_listen_socket_port(ls: *mut ListenSocket) -> i32;
        pub fn uws_h3_listen_socket_local_address(
            ls: *mut ListenSocket,
            buf: *mut u8,
            len: c_int,
        ) -> c_int;
        pub fn uws_h3_listen_socket_close(ls: *mut ListenSocket);

        pub fn uws_h3_res_state(res: *mut Response) -> State;
        pub fn uws_h3_res_end(res: *mut Response, p: *const u8, n: usize, close: bool);
        pub fn uws_h3_res_end_stream(res: *mut Response, close: bool);
        pub fn uws_h3_res_force_close(res: *mut Response);
        pub fn uws_h3_res_try_end(
            res: *mut Response,
            p: *const u8,
            n: usize,
            total: usize,
            close: bool,
        ) -> bool;
        pub fn uws_h3_res_end_without_body(res: *mut Response, close: bool);
        pub fn uws_h3_res_pause(res: *mut Response);
        pub fn uws_h3_res_resume(res: *mut Response);
        pub fn uws_h3_res_write_status(res: *mut Response, p: *const u8, n: usize);
        pub fn uws_h3_res_write_header(
            res: *mut Response,
            kp: *const u8,
            kn: usize,
            vp: *const u8,
            vn: usize,
        );
        pub fn uws_h3_res_write_header_int(res: *mut Response, kp: *const u8, kn: usize, v: u64);
        pub fn uws_h3_res_mark_wrote_content_length_header(res: *mut Response);
        pub fn uws_h3_res_write_mark(res: *mut Response);
        pub fn uws_h3_res_flush_headers(res: *mut Response, immediate: bool);
        pub fn uws_h3_res_write(res: *mut Response, p: *const u8, len: *mut usize) -> bool;
        pub fn uws_h3_res_get_write_offset(res: *mut Response) -> u64;
        pub fn uws_h3_res_override_write_offset(res: *mut Response, off: u64);
        pub fn uws_h3_res_has_responded(res: *mut Response) -> bool;
        pub fn uws_h3_res_get_buffered_amount(res: *mut Response) -> u64;
        pub fn uws_h3_res_reset_timeout(res: *mut Response);
        pub fn uws_h3_res_timeout(res: *mut Response, seconds: u8);
        pub fn uws_h3_res_end_sendfile(res: *mut Response, off: u64, close: bool);
        pub fn uws_h3_res_get_socket_data(res: *mut Response) -> *mut c_void;
        pub fn uws_h3_res_on_writable(
            res: *mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, u64, *mut c_void) -> bool>,
            ud: *mut c_void,
        );
        pub fn uws_h3_res_clear_on_writable(res: *mut Response);
        pub fn uws_h3_res_on_aborted(
            res: *mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *mut c_void)>,
            ud: *mut c_void,
        );
        pub fn uws_h3_res_on_timeout(
            res: *mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *mut c_void)>,
            ud: *mut c_void,
        );
        pub fn uws_h3_res_on_data(
            res: *mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *const u8, usize, bool, *mut c_void)>,
            ud: *mut c_void,
        );
        pub fn uws_h3_res_cork(
            res: *mut Response,
            ud: *mut c_void,
            cb: unsafe extern "C" fn(*mut c_void),
        );
        pub fn uws_h3_res_get_remote_address_info(
            res: *mut Response,
            ip: *mut *const u8,
            port: *mut i32,
            is_ipv6: *mut bool,
        ) -> usize;

        pub fn uws_h3_req_get_yield(req: *mut Request) -> bool;
        pub fn uws_h3_req_set_yield(req: *mut Request, y: bool);
        pub fn uws_h3_req_get_url(req: *mut Request, out: *mut *const u8) -> usize;
        pub fn uws_h3_req_get_method(req: *mut Request, out: *mut *const u8) -> usize;
        pub fn uws_h3_req_get_header(
            req: *mut Request,
            name: *const u8,
            len: usize,
            out: *mut *const u8,
        ) -> usize;
        pub fn uws_h3_req_get_query(
            req: *mut Request,
            name: *const u8,
            len: usize,
            out: *mut *const u8,
        ) -> usize;
        pub fn uws_h3_req_get_parameter(req: *mut Request, idx: u16, out: *mut *const u8) -> usize;
        pub fn uws_h3_req_for_each_header(req: *mut Request, cb: HeaderCb, ud: *mut c_void);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/h3.zig (434 lines)
//   confidence: medium
//   todos:      10
//   notes:      All `comptime handler: fn(...)` callback wrappers need a macro
//               or const-fn-ptr-generic in Phase B (Rust cannot bake a runtime
//               fn pointer into an `extern "C"` trampoline). `date_for_header`
//               reaches into bun_jsc/bun_str — possible layering violation.
// ──────────────────────────────────────────────────────────────────────────
