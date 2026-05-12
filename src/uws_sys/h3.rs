//! HTTP/3 bindings. Method names mirror NewApp/NewResponse 1:1 so the
//! comptime callers in server.zig and the `inline else` arms in AnyResponse
//! see the same surface regardless of transport.

use core::ffi::{c_char, c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::ptr;

use crate::SocketAddress;
use crate::response::{State, WriteResult};
use crate::socket_context::BunSocketContextOptions;
use crate::thunk;

// ──────────────────────────────────────────────────────────────────────────
// ListenSocket
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct ListenSocket; }

impl ListenSocket {
    pub fn close(&mut self) {
        c::uws_h3_listen_socket_close(self)
    }
    pub fn get_local_port(&mut self) -> i32 {
        c::uws_h3_listen_socket_port(self)
    }
    pub fn get_local_address<'a>(&mut self, buf: &'a mut [u8]) -> Option<&'a [u8]> {
        // SAFETY: self is a live FFI handle; buf ptr/len valid for write
        let n = unsafe {
            c::uws_h3_listen_socket_local_address(
                self,
                buf.as_mut_ptr(),
                c_int::try_from(buf.len()).expect("int cast"),
            )
        };
        if n <= 0 {
            return None;
        }
        Some(&buf[..usize::try_from(n).expect("int cast")])
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Request
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct Request; }

impl Request {
    pub fn is_ancient(&self) -> bool {
        false
    }
    pub fn get_yield(&mut self) -> bool {
        c::uws_h3_req_get_yield(self)
    }
    pub fn set_yield(&mut self, y: bool) {
        c::uws_h3_req_set_yield(self, y)
    }
    pub fn url(&mut self) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        let n = c::uws_h3_req_get_url(self, &mut p);
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { bun_core::ffi::slice(p, n) }
    }
    pub fn method(&mut self) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        let n = c::uws_h3_req_get_method(self, &mut p);
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { bun_core::ffi::slice(p, n) }
    }
    pub fn header(&mut self, name: &[u8]) -> Option<&[u8]> {
        let mut p: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; name ptr/len valid for read; out-ptr is a valid local
        let n = unsafe { c::uws_h3_req_get_header(self, name.as_ptr(), name.len(), &raw mut p) };
        if n == 0 {
            None
        } else {
            // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
            Some(unsafe { bun_core::ffi::slice(p, n) })
        }
    }
    pub fn query(&mut self, name: &[u8]) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        // SAFETY: self is a live FFI handle; name ptr/len valid for read; out-ptr is a valid local
        let n = unsafe { c::uws_h3_req_get_query(self, name.as_ptr(), name.len(), &raw mut p) };
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { bun_core::ffi::slice(p, n) }
    }
    pub fn parameter(&mut self, idx: u16) -> &[u8] {
        let mut p: *const u8 = ptr::null();
        let n = c::uws_h3_req_get_parameter(self, idx, &mut p);
        // SAFETY: uws returns a pointer+len pair valid for the lifetime of the request
        unsafe { bun_core::ffi::slice(p, n) }
    }
    /// Iterate all request headers.
    ///
    /// Zig takes `comptime cb` and bakes it into the trampoline at
    /// monomorphization time. Rust models this by requiring `H` to be a
    /// zero-sized type (function item or capture-less closure): the trampoline
    /// is monomorphized over `H` and conjures the ZST inside, so the user
    /// handler is baked in with no runtime storage.
    pub fn for_each_header<Ctx, H>(&mut self, _cb: H, ctx: *mut Ctx)
    where
        H: Fn(&mut Ctx, &[u8], &[u8]) + Copy + 'static,
    {
        // Safe fn item: nested local, only ever coerced to the C-ABI fn-pointer
        // type passed to C — never callable by name from safe Rust. Body wraps
        // its raw-ptr ops explicitly.
        extern "C" fn each<Ctx, H>(
            n: *const u8,
            nl: usize,
            v: *const u8,
            vl: usize,
            ud: *mut c_void,
        ) where
            H: Fn(&mut Ctx, &[u8], &[u8]) + Copy + 'static,
        {
            // SAFETY: synchronous header iteration — `ud` is the unique `&mut Ctx`
            // we registered, (ptr,len) pairs valid for this call, `H` is a ZST.
            unsafe {
                let Some(ctx) = thunk::user_mut::<Ctx>(ud) else {
                    return;
                };
                thunk::zst::<H>()(ctx, thunk::c_slice(n, nl), thunk::c_slice(v, vl));
            }
        }
        c::uws_h3_req_for_each_header(self, each::<Ctx, H>, ctx.cast())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Response
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct Response; }

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
        c::uws_h3_res_end_without_body(self, close_connection)
    }
    pub fn end_stream(&mut self, close_connection: bool) {
        c::uws_h3_res_end_stream(self, close_connection)
    }
    pub fn end_send_file(&mut self, write_offset: u64, close_connection: bool) {
        c::uws_h3_res_end_sendfile(self, write_offset, close_connection)
    }
    pub fn write(&mut self, data: &[u8]) -> WriteResult {
        let mut len: usize = data.len();
        // SAFETY: self is a live FFI handle; data ptr valid for read; len out-ptr is a valid local
        if unsafe { c::uws_h3_res_write(self, data.as_ptr(), &raw mut len) } {
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
        c::uws_h3_res_write_mark(self)
    }
    pub fn mark_wrote_content_length_header(&mut self) {
        c::uws_h3_res_mark_wrote_content_length_header(self)
    }
    pub fn write_continue(&mut self) {
        c::uws_h3_res_write_continue(self)
    }
    pub fn flush_headers(&mut self, immediate: bool) {
        c::uws_h3_res_flush_headers(self, immediate)
    }
    pub fn pause(&mut self) {
        c::uws_h3_res_pause(self)
    }
    pub fn resume_(&mut self) {
        c::uws_h3_res_resume(self)
    }
    #[inline]
    pub fn resume(&mut self) {
        self.resume_()
    }
    pub fn timeout(&mut self, seconds: u8) {
        c::uws_h3_res_timeout(self, seconds)
    }
    pub fn reset_timeout(&mut self) {
        c::uws_h3_res_reset_timeout(self)
    }
    pub fn get_write_offset(&mut self) -> u64 {
        c::uws_h3_res_get_write_offset(self)
    }
    pub fn override_write_offset(&mut self, off: u64) {
        c::uws_h3_res_override_write_offset(self, off)
    }
    pub fn get_buffered_amount(&mut self) -> u64 {
        c::uws_h3_res_get_buffered_amount(self)
    }
    pub fn has_responded(&mut self) -> bool {
        c::uws_h3_res_has_responded(self)
    }
    pub fn state(&mut self) -> State {
        c::uws_h3_res_state(self)
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
        c::uws_h3_res_get_socket_data(self)
    }
    pub fn get_remote_socket_info(&mut self) -> Option<SocketAddress<'_>> {
        let mut port: i32 = 0;
        let mut is_ipv6: bool = false;
        let mut ip_ptr: *const u8 = ptr::null();
        let len = c::uws_h3_res_get_remote_address_info(self, &mut ip_ptr, &mut port, &mut is_ipv6);
        if len == 0 {
            return None;
        }
        // SAFETY: uws returns a pointer+len pair valid while the response is alive
        let ip = unsafe { bun_core::ffi::slice(ip_ptr, len) };
        // TODO(port): SocketAddress.ip is a borrowed slice in Zig; Rust field type TBD
        Some(SocketAddress { ip, port, is_ipv6 })
    }
    pub fn force_close(&mut self) {
        c::uws_h3_res_force_close(self)
    }

    pub fn on_writable<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(&mut UD, u64, &mut Response) -> bool + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD, H>(r: *mut Response, off: u64, p: *mut c_void) -> bool
        where
            H: Fn(&mut UD, u64, &mut Response) -> bool + Copy + 'static,
        {
            // SAFETY: uWS callback contract — `r` live, `p` is the registered `*mut UD`.
            unsafe {
                let Some(ud) = thunk::user_mut::<UD>(p) else {
                    return true;
                };
                thunk::zst::<H>()(ud, off, thunk::handle_mut(r))
            }
        }
        c::uws_h3_res_on_writable(self, Some(cb::<UD, H>), ud.cast())
    }
    pub fn clear_on_writable(&mut self) {
        c::uws_h3_res_clear_on_writable(self)
    }
    pub fn on_aborted<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(&mut UD, &mut Response) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD, H>(r: *mut Response, p: *mut c_void)
        where
            H: Fn(&mut UD, &mut Response) + Copy + 'static,
        {
            // SAFETY: uWS callback contract — `r` live, `p` is the registered `*mut UD`.
            unsafe {
                let Some(ud) = thunk::user_mut::<UD>(p) else {
                    return;
                };
                thunk::zst::<H>()(ud, thunk::handle_mut(r));
            }
        }
        c::uws_h3_res_on_aborted(self, Some(cb::<UD, H>), ud.cast())
    }
    pub fn clear_aborted(&mut self) {
        c::uws_h3_res_on_aborted(self, None, ptr::null_mut())
    }
    pub fn on_timeout<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(&mut UD, &mut Response) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD, H>(r: *mut Response, p: *mut c_void)
        where
            H: Fn(&mut UD, &mut Response) + Copy + 'static,
        {
            // SAFETY: uWS callback contract — `r` live, `p` is the registered `*mut UD`.
            unsafe {
                let Some(ud) = thunk::user_mut::<UD>(p) else {
                    return;
                };
                thunk::zst::<H>()(ud, thunk::handle_mut(r));
            }
        }
        c::uws_h3_res_on_timeout(self, Some(cb::<UD, H>), ud.cast())
    }
    pub fn clear_timeout(&mut self) {
        c::uws_h3_res_on_timeout(self, None, ptr::null_mut())
    }
    pub fn on_data<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(&mut UD, &mut Response, &[u8], bool) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD, H>(
            r: *mut Response,
            chunk_ptr: *const u8,
            len: usize,
            last: bool,
            p: *mut c_void,
        ) where
            H: Fn(&mut UD, &mut Response, &[u8], bool) + Copy + 'static,
        {
            // SAFETY: uWS callback contract — `r` live, `chunk_ptr[..len]` valid,
            // `p` is the registered `*mut UD`.
            unsafe {
                let Some(ud) = thunk::user_mut::<UD>(p) else {
                    return;
                };
                thunk::zst::<H>()(
                    ud,
                    thunk::handle_mut(r),
                    thunk::c_slice(chunk_ptr, len),
                    last,
                );
            }
        }
        c::uws_h3_res_on_data(self, Some(cb::<UD, H>), ud.cast())
    }
    pub fn clear_on_data(&mut self) {
        c::uws_h3_res_on_data(self, None, ptr::null_mut())
    }
    pub fn corked(&mut self, handler: impl FnOnce()) {
        // H3 has no corking; the Zig version just calls the handler immediately.
        let _ = self;
        handler();
    }
    pub fn run_corked_with_type<UD>(&mut self, handler: fn(*mut UD), ud: *mut UD) {
        // cork is synchronous, so we stack-allocate the (handler, ud) pair and
        // recover it inside the trampoline — same shape as H1's
        // `Response::run_corked_with_type` so `AnyResponse` can dispatch uniformly.
        type Ctx<UD> = (fn(*mut UD), *mut UD);
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD>(p: *mut c_void) {
            // SAFETY: p points at a stack Ctx<UD> valid for this synchronous call.
            let ctx = unsafe { &*p.cast::<Ctx<UD>>() };
            // PERF(port): was @call(.always_inline)
            (ctx.0)(ctx.1);
        }
        let mut ctx: Ctx<UD> = (handler, ud);
        c::uws_h3_res_cork(self, (&raw mut ctx).cast(), cb::<UD>)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct App; }

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

#[derive(Debug, strum::IntoStaticStr)]
pub enum AddServerNameError {
    FailedToAddServerName,
}
bun_core::impl_tag_error!(AddServerNameError);

/// Stamps one `pub fn $name<UD, H>(&mut self, p, ud, h)` per HTTP verb,
/// each forwarding to [`App::route`] with the matching [`RouteKind`].
/// `connect`/`trace` are intentionally omitted — h3 exposes those only via
/// [`App::method`], matching h3.zig.
macro_rules! h3_route_methods {
    ($($name:ident => $kind:ident),* $(,)?) => {$(
        pub fn $name<UD, H>(&mut self, p: &[u8], ud: *mut UD, h: H)
        where
            H: Fn(&mut UD, &mut Request, &mut Response) + Copy + 'static,
        {
            Self::route(RouteKind::$kind, self, p, ud, h);
        }
    )*};
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
        c::uws_h3_app_close(self)
    }
    pub fn clear_routes(&mut self) {
        c::uws_h3_app_clear_routes(self)
    }

    fn route<UD, H>(which: RouteKind, this: &mut App, pattern: &[u8], ud: *mut UD, _handler: H)
    where
        H: Fn(&mut UD, &mut Request, &mut Response) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD, H>(res: *mut Response, req: *mut Request, p: *mut c_void)
        where
            H: Fn(&mut UD, &mut Request, &mut Response) + Copy + 'static,
        {
            // SAFETY: uWS callback contract — `res`/`req` live disjoint handles,
            // `p` is the registered `*mut UD` (non-null by route registration).
            unsafe {
                let Some(ud) = thunk::user_mut::<UD>(p) else {
                    return;
                };
                thunk::zst::<H>()(ud, thunk::handle_mut(req), thunk::handle_mut(res));
            }
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
        unsafe {
            f(
                this,
                pattern.as_ptr(),
                pattern.len(),
                Some(cb::<UD, H>),
                ud.cast(),
            )
        }
    }

    h3_route_methods! {
        get     => Get,
        post    => Post,
        put     => Put,
        delete  => Delete,
        patch   => Patch,
        head    => Head,
        options => Options,
        any     => Any,
    }

    pub fn method<UD, H>(&mut self, m: bun_http_types::Method::Method, p: &[u8], ud: *mut UD, h: H)
    where
        H: Fn(&mut UD, &mut Request, &mut Response) + Copy + 'static,
    {
        use bun_http_types::Method::Method as M;
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

    pub fn listen_with_config<UD, H>(&mut self, ud: *mut UD, _handler: H, config: ListenConfig)
    where
        H: Fn(&mut UD, Option<&mut ListenSocket>) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD, H>(ls: *mut ListenSocket, p: *mut c_void)
        where
            H: Fn(&mut UD, Option<&mut ListenSocket>) + Copy + 'static,
        {
            // SAFETY: uWS callback contract — `p` is the registered `*mut UD`;
            // `ls` (when non-null) is a live listen-socket for this call.
            unsafe {
                let Some(ud) = thunk::user_mut::<UD>(p) else {
                    return;
                };
                thunk::zst::<H>()(ud, ls.as_mut());
            }
        }
        // SAFETY: self is a live FFI handle; config fields valid; trampoline is `extern "C"`
        unsafe {
            c::uws_h3_app_listen_with_config(
                self,
                config.host,
                config.port,
                config.options,
                Some(cb::<UD, H>),
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
        Self {
            port: 0,
            host: ptr::null(),
            options: 0,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C"
// ──────────────────────────────────────────────────────────────────────────

mod c {
    use super::*;

    pub type Handler = Option<unsafe extern "C" fn(*mut Response, *mut Request, *mut c_void)>;
    pub type ListenHandler = Option<unsafe extern "C" fn(*mut ListenSocket, *mut c_void)>;
    pub type HeaderCb = unsafe extern "C" fn(*const u8, usize, *const u8, usize, *mut c_void);

    // Opaque handles in this module are `#[repr(C)]` with `UnsafeCell<[u8; 0]>`,
    // so `&T`/`&mut T` are ABI-identical to a non-null pointer. Shims whose
    // only pointer arg is the opaque handle (plus value types) are `safe fn`.
    // Shims with (ptr,len), nullable raw, *mut c_void ctx stay unsafe.
    unsafe extern "C" {
        pub fn uws_h3_create_app(opts: BunSocketContextOptions, idle_timeout_s: u32) -> *mut App;
        pub fn uws_h3_app_destroy(app: *mut App);
        pub safe fn uws_h3_app_close(app: &mut App);
        pub safe fn uws_h3_app_clear_routes(app: &mut App);
        pub fn uws_h3_app_add_server_name(
            app: *mut App,
            hostname: *const c_char,
            opts: BunSocketContextOptions,
        ) -> bool;
        pub safe fn uws_h3_res_write_continue(res: &mut Response);
        pub fn uws_h3_app_get(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_post(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_put(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_delete(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub fn uws_h3_app_patch(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_head(app: *mut App, p: *const u8, n: usize, h: Handler, ud: *mut c_void);
        pub fn uws_h3_app_options(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub fn uws_h3_app_connect(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
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
        pub safe fn uws_h3_listen_socket_port(ls: &mut ListenSocket) -> i32;
        pub fn uws_h3_listen_socket_local_address(
            ls: *mut ListenSocket,
            buf: *mut u8,
            len: c_int,
        ) -> c_int;
        pub safe fn uws_h3_listen_socket_close(ls: &mut ListenSocket);

        pub safe fn uws_h3_res_state(res: &mut Response) -> State;
        pub fn uws_h3_res_end(res: *mut Response, p: *const u8, n: usize, close: bool);
        pub safe fn uws_h3_res_end_stream(res: &mut Response, close: bool);
        pub safe fn uws_h3_res_force_close(res: &mut Response);
        pub fn uws_h3_res_try_end(
            res: *mut Response,
            p: *const u8,
            n: usize,
            total: usize,
            close: bool,
        ) -> bool;
        pub safe fn uws_h3_res_end_without_body(res: &mut Response, close: bool);
        pub safe fn uws_h3_res_pause(res: &mut Response);
        pub safe fn uws_h3_res_resume(res: &mut Response);
        pub fn uws_h3_res_write_status(res: *mut Response, p: *const u8, n: usize);
        pub fn uws_h3_res_write_header(
            res: *mut Response,
            kp: *const u8,
            kn: usize,
            vp: *const u8,
            vn: usize,
        );
        pub fn uws_h3_res_write_header_int(res: *mut Response, kp: *const u8, kn: usize, v: u64);
        pub safe fn uws_h3_res_mark_wrote_content_length_header(res: &mut Response);
        pub safe fn uws_h3_res_write_mark(res: &mut Response);
        pub safe fn uws_h3_res_flush_headers(res: &mut Response, immediate: bool);
        pub fn uws_h3_res_write(res: *mut Response, p: *const u8, len: *mut usize) -> bool;
        pub safe fn uws_h3_res_get_write_offset(res: &mut Response) -> u64;
        pub safe fn uws_h3_res_override_write_offset(res: &mut Response, off: u64);
        pub safe fn uws_h3_res_has_responded(res: &mut Response) -> bool;
        pub safe fn uws_h3_res_get_buffered_amount(res: &mut Response) -> u64;
        pub safe fn uws_h3_res_reset_timeout(res: &mut Response);
        pub safe fn uws_h3_res_timeout(res: &mut Response, seconds: u8);
        pub safe fn uws_h3_res_end_sendfile(res: &mut Response, off: u64, close: bool);
        pub safe fn uws_h3_res_get_socket_data(res: &mut Response) -> *mut c_void;
        // safe: `&mut Response` is ABI-identical to a non-null `*mut`;
        // `cb`/`ud` are stored opaquely (never dereferenced by the C++ shim
        // itself) — no preconditions on this call. Mirrors `uws_res_on_*`.
        pub safe fn uws_h3_res_on_writable(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, u64, *mut c_void) -> bool>,
            ud: *mut c_void,
        );
        pub safe fn uws_h3_res_clear_on_writable(res: &mut Response);
        pub safe fn uws_h3_res_on_aborted(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *mut c_void)>,
            ud: *mut c_void,
        );
        pub safe fn uws_h3_res_on_timeout(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *mut c_void)>,
            ud: *mut c_void,
        );
        pub safe fn uws_h3_res_on_data(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *const u8, usize, bool, *mut c_void)>,
            ud: *mut c_void,
        );
        // safe: cork is synchronous — `ud` is passed straight back to `cb`
        // without being dereferenced by the C++ shim itself, so the call has
        // no preconditions beyond the live opaque handle.
        pub safe fn uws_h3_res_cork(
            res: &mut Response,
            ud: *mut c_void,
            cb: unsafe extern "C" fn(*mut c_void),
        );
        // Out-params are `&mut` (non-null, valid for write); the C shim only
        // stores into them and returns a length — no read-through precondition.
        pub safe fn uws_h3_res_get_remote_address_info(
            res: &mut Response,
            ip: &mut *const u8,
            port: &mut i32,
            is_ipv6: &mut bool,
        ) -> usize;

        pub safe fn uws_h3_req_get_yield(req: &mut Request) -> bool;
        pub safe fn uws_h3_req_set_yield(req: &mut Request, y: bool);
        // Out-param `out` is `&mut *const u8` (non-null, valid for write); the C
        // shim only stores a pointer into request-owned storage and returns its
        // length — no read-through precondition, so `safe fn`.
        pub safe fn uws_h3_req_get_url(req: &mut Request, out: &mut *const u8) -> usize;
        pub safe fn uws_h3_req_get_method(req: &mut Request, out: &mut *const u8) -> usize;
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
        pub safe fn uws_h3_req_get_parameter(
            req: &mut Request,
            idx: u16,
            out: &mut *const u8,
        ) -> usize;
        // safe: synchronous header iteration — `ud` is forwarded opaquely to
        // `cb` without being dereferenced by the C++ shim itself; `cb` is a
        // by-value fn pointer. No preconditions beyond the live opaque handle.
        pub safe fn uws_h3_req_for_each_header(req: &mut Request, cb: HeaderCb, ud: *mut c_void);
    }
}

// ported from: src/uws_sys/h3.zig
