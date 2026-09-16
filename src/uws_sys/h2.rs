//! HTTP/2 bindings. Method names mirror NewApp/NewResponse (and h3) 1:1 so
//! callers (including the AnyResponse dispatch arms) see the same surface
//! regardless of transport. Requests are [`crate::h3::Request`]: both
//! transports hand C++ the same decoded header list.

use core::ffi::c_void;
use core::ptr;

use crate::SocketAddress;
use crate::response::{State, WriteResult};
use crate::thunk;
use crate::{AnyRequest, AnyResponse};
use bun_ptr::ThisPtr;

pub use crate::h3::Request;

// ──────────────────────────────────────────────────────────────────────────
// Response
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct Response; }

impl Response {
    pub fn end(&mut self, data: &[u8], close_connection: bool) {
        // SAFETY: self is a live FFI handle; data ptr/len valid for read
        unsafe { c::uws_h2_res_end(self, data.as_ptr(), data.len(), close_connection) }
    }
    pub(crate) fn try_end(&mut self, data: &[u8], total: usize, close_connection: bool) -> bool {
        // SAFETY: self is a live FFI handle; data ptr/len valid for read
        unsafe { c::uws_h2_res_try_end(self, data.as_ptr(), data.len(), total, close_connection) }
    }
    pub fn end_without_body(&mut self, close_connection: bool) {
        c::uws_h2_res_end_without_body(self, close_connection)
    }
    pub(crate) fn end_stream(&mut self, close_connection: bool) {
        c::uws_h2_res_end_stream(self, close_connection)
    }
    pub(crate) fn end_send_file(&mut self, write_offset: u64, close_connection: bool) {
        c::uws_h2_res_end_sendfile(self, write_offset, close_connection)
    }
    /// Streams share a connection; the TCP close-when-idle gate has no per-stream equivalent.
    pub(crate) fn close_if_done_and_marked(&mut self) {}
    pub(crate) fn write(&mut self, data: &[u8]) -> WriteResult {
        let mut len: usize = data.len();
        // SAFETY: self is a live FFI handle; data ptr valid for read; len out-ptr is a valid local
        if unsafe { c::uws_h2_res_write(self, data.as_ptr(), &raw mut len) } {
            WriteResult::WantMore(len)
        } else {
            WriteResult::Backpressure(len)
        }
    }
    pub(crate) fn try_write_body(&mut self, data: &[u8], _is_first: bool) -> usize {
        // node:http (the only caller) never reaches HTTP/2; fall through to
        // the copying write for AnyResponse dispatch parity.
        let _ = self.write(data);
        data.len()
    }
    pub(crate) fn spill_body(&mut self, data: &[u8]) {
        let _ = self.write(data);
    }
    pub fn write_status(&mut self, status: &[u8]) {
        // SAFETY: self is a live FFI handle; status ptr/len valid for read
        unsafe { c::uws_h2_res_write_status(self, status.as_ptr(), status.len()) }
    }
    pub fn write_header(&mut self, key: &[u8], value: &[u8]) {
        // SAFETY: self is a live FFI handle; key/value ptr+len valid for read
        unsafe {
            c::uws_h2_res_write_header(self, key.as_ptr(), key.len(), value.as_ptr(), value.len())
        }
    }
    pub(crate) fn write_header_int(&mut self, key: &[u8], value: u64) {
        // SAFETY: self is a live FFI handle; key ptr/len valid for read
        unsafe { c::uws_h2_res_write_header_int(self, key.as_ptr(), key.len(), value) }
    }
    pub(crate) fn write_mark(&mut self) {
        c::uws_h2_res_write_mark(self)
    }
    pub(crate) fn mark_wrote_content_length_header(&mut self) {
        c::uws_h2_res_mark_wrote_content_length_header(self)
    }
    pub(crate) fn mark_wrote_date_header(&mut self) {
        c::uws_h2_res_mark_wrote_date_header(self)
    }
    pub(crate) fn write_continue(&mut self) {
        c::uws_h2_res_write_continue(self)
    }
    pub(crate) fn write_informational(&mut self, _data: &[u8]) {
        // node:http (the only caller) never reaches HTTP/2; kept for AnyResponse dispatch parity.
    }
    pub(crate) fn flush_headers(&mut self, immediate: bool) {
        c::uws_h2_res_flush_headers(self, immediate)
    }
    /// The handler started consuming the request body: widen this stream's
    /// receive window from the small initial value.
    pub fn grow_request_window(&mut self) {
        c::uws_h2_res_grow_request_window(self)
    }
    pub(crate) fn pause(&mut self) {
        c::uws_h2_res_pause(self)
    }
    pub(crate) fn resume(&mut self) {
        c::uws_h2_res_resume(self)
    }
    pub fn timeout(&mut self, seconds: u8) {
        c::uws_h2_res_timeout(self, seconds)
    }
    pub(crate) fn reset_timeout(&mut self) {
        c::uws_h2_res_reset_timeout(self)
    }
    pub(crate) fn get_buffered_amount(&mut self) -> u64 {
        c::uws_h2_res_get_buffered_amount(self)
    }
    pub(crate) fn has_responded(&mut self) -> bool {
        c::uws_h2_res_has_responded(self)
    }
    pub(crate) fn state(&mut self) -> State {
        c::uws_h2_res_state(self)
    }
    pub(crate) fn should_close_connection(&mut self) -> bool {
        self.state().is_http_connection_close()
    }
    /// True once the stream is retired (peer reset, connection closed, or
    /// `server.stop(true)` from inside the handler) even if onAborted was not
    /// armed yet; the handle stays valid until the current call unwinds.
    pub(crate) fn is_closed(&self) -> bool {
        c::uws_h2_res_is_closed(self)
    }
    /// END_STREAM on the HEADERS frame, or `content-length: 0`.
    pub fn request_body_ended(&self) -> bool {
        c::uws_h2_res_request_body_ended(self)
    }
    pub(crate) fn is_corked(&self) -> bool {
        false
    }
    pub(crate) fn uncork(&mut self) {}
    pub(crate) fn is_connect_request(&self) -> bool {
        false
    }
    pub(crate) fn prepare_for_sendfile(&mut self) {}
    pub(crate) fn mark_needs_more(&mut self) {}
    pub(crate) fn get_remote_socket_info(&mut self) -> Option<SocketAddress> {
        let mut port: i32 = 0;
        let mut is_ipv6: bool = false;
        let mut ip_ptr: *const u8 = ptr::null();
        let len = c::uws_h2_res_get_remote_address_info(self, &mut ip_ptr, &mut port, &mut is_ipv6);
        if len == 0 {
            return None;
        }
        // SAFETY: uws returns a pointer+len pair valid until the next address lookup
        // on this thread; copied before returning.
        let ip = unsafe { bun_core::ffi::slice(ip_ptr, len) };
        Some(SocketAddress::new(ip, port, is_ipv6))
    }
    pub(crate) fn force_close(&mut self) {
        c::uws_h2_res_force_close(self)
    }

    pub(crate) fn on_writable<UD, H>(&mut self, _handler: H, ud: *mut UD)
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
        c::uws_h2_res_on_writable(self, Some(cb::<UD, H>), ud.cast())
    }
    pub(crate) fn clear_on_writable(&mut self) {
        c::uws_h2_res_clear_on_writable(self)
    }
    pub(crate) fn on_aborted<UD, H>(&mut self, _handler: H, ud: *mut UD)
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
        c::uws_h2_res_on_aborted(self, Some(cb::<UD, H>), ud.cast())
    }
    pub(crate) fn clear_aborted(&mut self) {
        c::uws_h2_res_on_aborted(self, None, ptr::null_mut())
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
        c::uws_h2_res_on_timeout(self, Some(cb::<UD, H>), ud.cast())
    }
    pub(crate) fn clear_timeout(&mut self) {
        c::uws_h2_res_on_timeout(self, None, ptr::null_mut())
    }
    pub(crate) fn on_data<UD, H>(&mut self, _handler: H, ud: *mut UD)
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
        c::uws_h2_res_on_data(self, Some(cb::<UD, H>), ud.cast())
    }
    pub(crate) fn clear_on_data(&mut self) {
        c::uws_h2_res_on_data(self, None, ptr::null_mut())
    }
    pub(crate) fn corked<F: FnOnce()>(&mut self, f: F) {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr op explicitly.
        extern "C" fn handle<F: FnOnce()>(user_data: *mut c_void) {
            // SAFETY: user_data points at a stack `ManuallyDrop<F>` valid for this synchronous call.
            let f = unsafe { core::ptr::read(user_data.cast::<F>()) };
            f();
        }
        let mut f = core::mem::ManuallyDrop::new(f);
        c::uws_h2_res_cork(self, (&raw mut *f).cast::<c_void>(), handle::<F>);
    }
    pub(crate) fn run_corked_with_type<UD>(&mut self, handler: fn(*mut UD), ud: *mut UD) {
        // cork is synchronous, so we stack-allocate the (handler, ud) pair and
        // recover it inside the trampoline — same shape as H1's
        // `Response::run_corked_with_type` so `AnyResponse` can dispatch uniformly.
        type Ctx<UD> = (fn(*mut UD), *mut UD);
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD>(p: *mut c_void) {
            // SAFETY: p points at a stack Ctx<UD> valid for this synchronous call.
            let ctx = unsafe { &*p.cast::<Ctx<UD>>() };
            (ctx.0)(ctx.1);
        }
        let mut ctx: Ctx<UD> = (handler, ud);
        c::uws_h2_res_cork(self, (&raw mut ctx).cast(), cb::<UD>)
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

impl RouteKind {
    fn from_method(m: bun_http_types::Method::Method) -> Option<RouteKind> {
        use bun_http_types::Method::Method as M;
        Some(match m {
            M::GET => RouteKind::Get,
            M::POST => RouteKind::Post,
            M::PUT => RouteKind::Put,
            M::DELETE => RouteKind::Delete,
            M::PATCH => RouteKind::Patch,
            M::OPTIONS => RouteKind::Options,
            M::HEAD => RouteKind::Head,
            M::CONNECT => RouteKind::Connect,
            M::TRACE => RouteKind::Trace,
            _ => return None,
        })
    }
}

/// Stamps one `pub fn $name<UD, H>(&mut self, p, ud, h)` per HTTP verb,
/// each forwarding to [`App::route`] with the matching [`RouteKind`].
/// `connect`/`trace` are intentionally omitted — exposed only via
/// [`App::method`].
macro_rules! h2_route_methods {
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
    /// Attach an HTTP/2 context to `parent`: its connections that negotiate
    /// "h2" via ALPN (or, without TLS, open with the prior-knowledge preface)
    /// are served by this app's routes. With `allow_http1 == false` the
    /// parent stops serving HTTP/1.x.
    pub fn create<const SSL: bool>(
        parent: &mut crate::app::App<SSL>,
        allow_http1: bool,
        idle_timeout_s: u32,
    ) -> Option<*mut App> {
        // SAFETY: parent is a live TemplatedApp<SSL>; uws owns the returned handle
        let p = unsafe {
            c::uws_h2_create_app(
                i32::from(SSL),
                std::ptr::from_mut(parent).cast::<crate::app::uws_app_t>(),
                allow_http1,
                idle_timeout_s,
            )
        };
        if p.is_null() { None } else { Some(p) }
    }
    /// # Safety
    /// `this` must be a live App handle previously returned by `App::create`;
    /// it is freed by this call and must not be used afterwards.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract above
        unsafe { c::uws_h2_app_destroy(this) }
    }
    /// Streams parked on backpressure need another drain pass outside the
    /// current call; `cb(user, ctx)` should arrange for [`drain`] to run soon.
    pub fn on_schedule_drain(
        &mut self,
        cb: unsafe extern "C" fn(user: *mut c_void, ctx: *mut c_void),
        user: *mut c_void,
    ) {
        // SAFETY: live handle; cb/user are stored and invoked on this thread.
        unsafe { c::uws_h2_app_on_schedule_drain(self, cb, user) }
    }
    /// Returns true if more streams are still queued (keep the task).
    pub fn drain(&mut self) -> bool {
        c::uws_h2_app_drain(self)
    }
    pub fn clear_routes(&mut self) {
        c::uws_h2_app_clear_routes(self)
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
        Self::route_raw(which, this, pattern, Some(cb::<UD, H>), ud.cast());
    }

    /// `route` for an intrusively-refcounted `U` as the route userdata; see
    /// [`method_this`](Self::method_this).
    fn route_this<U: 'static, H>(which: RouteKind, this: &mut App, pattern: &[u8], ud: ThisPtr<U>)
    where
        H: Fn(ThisPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        extern "C" fn cb<U: 'static, H>(res: *mut Response, req: *mut Request, p: *mut c_void)
        where
            H: Fn(ThisPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
        {
            // SAFETY: `p` is the `ThisPtr` registered with this thunk; the registrant holds a ref on it while the route is registered.
            let this = unsafe { ThisPtr::new(p.cast::<U>()) };
            thunk::zst::<H>()(this, AnyRequest::H3(req), AnyResponse::H2(res));
        }
        Self::route_raw(which, this, pattern, Some(cb::<U, H>), ud.as_ptr().cast());
    }

    fn route_raw(
        which: RouteKind,
        this: &mut App,
        pattern: &[u8],
        cb: c::Handler,
        ud: *mut c_void,
    ) {
        let f = match which {
            RouteKind::Get => c::uws_h2_app_get,
            RouteKind::Post => c::uws_h2_app_post,
            RouteKind::Put => c::uws_h2_app_put,
            RouteKind::Delete => c::uws_h2_app_delete,
            RouteKind::Patch => c::uws_h2_app_patch,
            RouteKind::Head => c::uws_h2_app_head,
            RouteKind::Options => c::uws_h2_app_options,
            RouteKind::Connect => c::uws_h2_app_connect,
            RouteKind::Trace => c::uws_h2_app_trace,
            RouteKind::Any => c::uws_h2_app_any,
        };
        // SAFETY: this is a live FFI handle; pattern ptr/len valid for read; trampoline is `extern "C"`
        unsafe { f(this, pattern.as_ptr(), pattern.len(), cb, ud) }
    }

    h2_route_methods! {
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
        if let Some(kind) = RouteKind::from_method(m) {
            Self::route(kind, self, p, ud, h);
        }
    }

    /// [`method`](Self::method) with an intrusively-refcounted `U` as the
    /// route userdata. The registrant keeps a ref on `this` for as long as the
    /// route is registered, so the trampoline can hand the handler a `ThisPtr`.
    pub fn method_this<U: 'static, H>(
        &mut self,
        m: bun_http_types::Method::Method,
        p: &[u8],
        _h: H,
        this: ThisPtr<U>,
    ) where
        H: Fn(ThisPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        if let Some(kind) = RouteKind::from_method(m) {
            Self::route_this::<U, H>(kind, self, p, this);
        }
    }

    /// [`any`](Self::any) counterpart of [`method_this`](Self::method_this).
    pub fn any_this<U: 'static, H>(&mut self, p: &[u8], _h: H, this: ThisPtr<U>)
    where
        H: Fn(ThisPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        Self::route_this::<U, H>(RouteKind::Any, self, p, this);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C"
// ──────────────────────────────────────────────────────────────────────────

mod c {
    use super::*;

    pub(super) type Handler =
        Option<unsafe extern "C" fn(*mut Response, *mut Request, *mut c_void)>;

    // Opaque handles in this module are `#[repr(C)]` with `UnsafeCell<[u8; 0]>`,
    // so `&T`/`&mut T` are ABI-identical to a non-null pointer. Shims whose
    // only pointer arg is the opaque handle (plus value types) are `safe fn`.
    // Shims with (ptr,len), nullable raw, *mut c_void ctx stay unsafe.
    unsafe extern "C" {
        pub(super) fn uws_h2_create_app(
            ssl: i32,
            parent: *mut crate::app::uws_app_t,
            allow_http1: bool,
            idle_timeout_s: u32,
        ) -> *mut App;
        pub(super) fn uws_h2_app_destroy(app: *mut App);
        pub(super) fn uws_h2_app_on_schedule_drain(
            app: *mut App,
            cb: unsafe extern "C" fn(user: *mut c_void, ctx: *mut c_void),
            user: *mut c_void,
        );
        pub(super) safe fn uws_h2_app_drain(app: &mut App) -> bool;
        pub(super) safe fn uws_h2_app_clear_routes(app: &mut App);
        pub(super) safe fn uws_h2_res_write_continue(res: &mut Response);
        pub(super) fn uws_h2_app_get(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_post(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_put(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_delete(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_patch(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_head(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_options(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_connect(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_trace(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) fn uws_h2_app_any(
            app: *mut App,
            p: *const u8,
            n: usize,
            h: Handler,
            ud: *mut c_void,
        );
        pub(super) safe fn uws_h2_res_state(res: &mut Response) -> State;
        pub(super) fn uws_h2_res_end(res: *mut Response, p: *const u8, n: usize, close: bool);
        pub(super) safe fn uws_h2_res_end_stream(res: &mut Response, close: bool);
        pub(super) safe fn uws_h2_res_force_close(res: &mut Response);
        pub(super) safe fn uws_h2_res_is_closed(res: &Response) -> bool;
        pub(super) safe fn uws_h2_res_request_body_ended(res: &Response) -> bool;
        pub(super) fn uws_h2_res_try_end(
            res: *mut Response,
            p: *const u8,
            n: usize,
            total: usize,
            close: bool,
        ) -> bool;
        pub(super) safe fn uws_h2_res_end_without_body(res: &mut Response, close: bool);
        pub(super) safe fn uws_h2_res_grow_request_window(res: &mut Response);
        pub(super) safe fn uws_h2_res_pause(res: &mut Response);
        pub(super) safe fn uws_h2_res_resume(res: &mut Response);
        pub(super) fn uws_h2_res_write_status(res: *mut Response, p: *const u8, n: usize);
        pub(super) fn uws_h2_res_write_header(
            res: *mut Response,
            kp: *const u8,
            kn: usize,
            vp: *const u8,
            vn: usize,
        );
        pub(super) fn uws_h2_res_write_header_int(
            res: *mut Response,
            kp: *const u8,
            kn: usize,
            v: u64,
        );
        pub(super) safe fn uws_h2_res_mark_wrote_content_length_header(res: &mut Response);
        pub(super) safe fn uws_h2_res_mark_wrote_date_header(res: &mut Response);
        pub(super) safe fn uws_h2_res_write_mark(res: &mut Response);
        pub(super) safe fn uws_h2_res_flush_headers(res: &mut Response, immediate: bool);
        pub(super) fn uws_h2_res_write(res: *mut Response, p: *const u8, len: *mut usize) -> bool;
        pub(super) safe fn uws_h2_res_has_responded(res: &mut Response) -> bool;
        pub(super) safe fn uws_h2_res_get_buffered_amount(res: &mut Response) -> u64;
        pub(super) safe fn uws_h2_res_reset_timeout(res: &mut Response);
        pub(super) safe fn uws_h2_res_timeout(res: &mut Response, seconds: u8);
        pub(super) safe fn uws_h2_res_end_sendfile(res: &mut Response, off: u64, close: bool);
        // safe: `&mut Response` is ABI-identical to a non-null `*mut`;
        // `cb`/`ud` are stored opaquely (never dereferenced by the C++ shim
        // itself) — no preconditions on this call. Mirrors `uws_res_on_*`.
        pub(super) safe fn uws_h2_res_on_writable(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, u64, *mut c_void) -> bool>,
            ud: *mut c_void,
        );
        pub(super) safe fn uws_h2_res_clear_on_writable(res: &mut Response);
        pub(super) safe fn uws_h2_res_on_aborted(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *mut c_void)>,
            ud: *mut c_void,
        );
        pub(super) safe fn uws_h2_res_on_timeout(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *mut c_void)>,
            ud: *mut c_void,
        );
        pub(super) safe fn uws_h2_res_on_data(
            res: &mut Response,
            cb: Option<unsafe extern "C" fn(*mut Response, *const u8, usize, bool, *mut c_void)>,
            ud: *mut c_void,
        );
        // safe: cork is synchronous — `ud` is passed straight back to `cb`
        // without being dereferenced by the C++ shim itself, so the call has
        // no preconditions beyond the live opaque handle.
        pub(super) safe fn uws_h2_res_cork(
            res: &mut Response,
            ud: *mut c_void,
            cb: unsafe extern "C" fn(*mut c_void),
        );
        // Out-params are `&mut` (non-null, valid for write); the C shim only
        // stores into them and returns a length — no read-through precondition.
        pub(super) safe fn uws_h2_res_get_remote_address_info(
            res: &mut Response,
            ip: &mut *const u8,
            port: &mut i32,
            is_ipv6: &mut bool,
        ) -> usize;
    }
}
