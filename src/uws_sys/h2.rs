//! HTTP/2 for `Bun.serve()`. Method names mirror NewApp/NewResponse (and h3) 1:1 so
//! callers (including the AnyResponse dispatch arms) see the same surface
//! regardless of transport. Requests are [`crate::h3::Request`]: both
//! transports hand C++ the same decoded header list.

use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::mem::ManuallyDrop;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::rc::Rc;
use std::time::Instant;

use bun_core::ffi::slice;
use bun_http_types::Method::Method;
use bun_http2::server;
use bun_ptr::{AnyRefCounted, RefPtr};

use crate::quic::Header;
use crate::response::{State, TCPResponse, WriteResult};
use crate::socket_group::VTable;
use crate::thunk::OpaqueHandle;
use crate::{
    AnyRequest, AnyResponse, CloseCode, Loop, SocketAddress, SocketGroup, thunk, us_socket_t,
};

pub use crate::h3::Request;

type Server = server::Server<Host>;
type Connection = server::Connection<Host>;
type Stream = server::Stream<Host>;

// ──────────────────────────────────────────────────────────────────────────
// Response
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct Response; }

impl Response {
    fn of<'a>(stream: &Rc<Stream>) -> &'a mut Self {
        Self::opaque_mut(Rc::as_ptr(stream).cast_mut().cast())
    }
    fn stream(&self) -> ManuallyDrop<Rc<Stream>> {
        // SAFETY: from `of`. Its connection holds it for as long as a handler may.
        ManuallyDrop::new(unsafe { Rc::from_raw(self.as_mut_ptr().cast()) })
    }

    pub fn end(&mut self, data: &[u8], _close_connection: bool) {
        self.stream().end(data)
    }
    pub(crate) fn try_end(&mut self, data: &[u8], total: usize, _close_connection: bool) -> bool {
        self.stream().try_end(data, total as u64)
    }
    pub fn end_without_body(&mut self, _close_connection: bool) {
        self.stream().end_without_body()
    }
    pub(crate) fn end_stream(&mut self, _close_connection: bool) {
        self.stream().end_stream()
    }
    pub(crate) fn end_send_file(&mut self, _write_offset: u64, _close_connection: bool) {
        self.stream().end_stream()
    }
    /// Streams share a connection; the TCP close-when-idle gate has no per-stream equivalent.
    pub(crate) fn close_if_done_and_marked(&mut self) {}
    pub(crate) fn write(&mut self, data: &[u8]) -> WriteResult {
        match self.stream().write(data) {
            Ok(len) => WriteResult::WantMore(len),
            Err(len) => WriteResult::Backpressure(len),
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
        self.stream().write_status(status)
    }
    pub fn write_header(&mut self, key: &[u8], value: &[u8]) {
        self.stream().write_header(key, value)
    }
    pub(crate) fn write_header_int(&mut self, key: &[u8], value: u64) {
        self.stream().write_header_int(key, value)
    }
    pub(crate) fn write_mark(&mut self) {
        self.stream().write_date()
    }
    pub(crate) fn mark_wrote_content_length_header(&mut self) {
        self.stream().mark(server::State::WROTE_CONTENT_LENGTH)
    }
    pub(crate) fn mark_wrote_date_header(&mut self) {
        self.stream().mark(server::State::WROTE_DATE)
    }
    pub(crate) fn write_continue(&mut self) {
        self.stream().write_continue()
    }
    pub(crate) fn write_informational(&mut self, _data: &[u8]) {
        // node:http (the only caller) never reaches HTTP/2; kept for AnyResponse dispatch parity.
    }
    pub(crate) fn flush_headers(&mut self, _immediate: bool) {
        self.stream().flush_headers()
    }
    /// The handler started consuming the request body: widen this stream's
    /// receive window from the small initial value.
    pub fn grow_request_window(&mut self) {
        self.stream().widen_receive_window()
    }
    pub(crate) fn pause(&mut self) {
        self.stream().pause()
    }
    pub(crate) fn resume(&mut self) {
        self.stream().resume()
    }
    pub fn timeout(&mut self, seconds: u8) {
        self.stream().set_timeout(seconds)
    }
    pub(crate) fn reset_timeout(&mut self) {
        self.stream().reset_timeout()
    }
    pub(crate) fn get_buffered_amount(&mut self) -> u64 {
        self.stream().buffered_amount() as u64
    }
    pub(crate) fn has_responded(&mut self) -> bool {
        !self.state().is_response_pending()
    }
    pub(crate) fn state(&mut self) -> State {
        State::from_bits_retain(self.stream().state().bits().into())
    }
    pub(crate) fn should_close_connection(&mut self) -> bool {
        self.state().is_http_connection_close()
    }
    /// True once the stream is retired (peer reset, connection closed, or
    /// `server.stop(true)` from inside the handler) even if onAborted was not
    /// armed yet; the handle stays valid until the current call unwinds.
    pub(crate) fn is_closed(&self) -> bool {
        self.stream().is_retired()
    }
    /// END_STREAM on the HEADERS frame, or `content-length: 0`.
    pub fn request_body_ended(&self) -> bool {
        self.stream().has_request_body_ended()
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
        TCPResponse::as_handle(self.stream().socket()?.0.cast()).get_remote_socket_info()
    }
    pub(crate) fn force_close(&mut self) {
        self.stream().abort()
    }

    pub(crate) fn on_writable<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(*mut UD, u64, &mut Response) -> bool + Copy + 'static,
    {
        let handler: server::OnWritable<Host> = |stream, offset, ud| {
            ud.is_null() || thunk::zst::<H>()(ud.cast(), offset, Self::of(stream))
        };
        self.stream().set_on_writable(Some(handler), ud.cast())
    }
    pub(crate) fn clear_on_writable(&mut self) {
        self.stream().set_on_writable(None, ptr::null_mut())
    }
    fn on_event<UD, H>(stream: &Rc<Stream>, ud: *mut c_void)
    where
        H: Fn(*mut UD, &mut Response) + Copy + 'static,
    {
        if !ud.is_null() {
            thunk::zst::<H>()(ud.cast(), Self::of(stream));
        }
    }
    pub(crate) fn on_aborted<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(*mut UD, &mut Response) + Copy + 'static,
    {
        (self.stream()).set_on_aborted(Some(Self::on_event::<UD, H>), ud.cast())
    }
    pub(crate) fn clear_aborted(&mut self) {
        self.stream().set_on_aborted(None, ptr::null_mut())
    }
    pub fn on_timeout<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(*mut UD, &mut Response) + Copy + 'static,
    {
        (self.stream()).set_on_timeout(Some(Self::on_event::<UD, H>), ud.cast())
    }
    pub(crate) fn clear_timeout(&mut self) {
        self.stream().set_on_timeout(None, ptr::null_mut())
    }
    pub(crate) fn on_data<UD, H>(&mut self, _handler: H, ud: *mut UD)
    where
        H: Fn(*mut UD, &mut Response, &[u8], bool) + Copy + 'static,
    {
        let handler: server::OnData<Host> = |stream, chunk, is_last, ud| {
            if !ud.is_null() {
                thunk::zst::<H>()(ud.cast(), Self::of(stream), chunk, is_last);
            }
        };
        self.stream().set_on_data(Some(handler), ud.cast())
    }
    pub(crate) fn clear_on_data(&mut self) {
        self.stream().set_on_data(None, ptr::null_mut())
    }
    pub(crate) fn corked<F: FnOnce()>(&mut self, f: F) {
        self.stream().cork(f)
    }
    pub(crate) fn run_corked_with_type<UD>(&mut self, handler: fn(&UD), ud: &UD) {
        self.corked(|| handler(ud))
    }
}

/// SAFETY: `key` and `value` have that many bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn uws_h2_res_write_header(
    res: &mut Response,
    key: *const u8,
    key_len: usize,
    value: *const u8,
    value_len: usize,
) {
    // SAFETY: forwarded.
    unsafe { res.write_header(slice(key, key_len), slice(value, value_len)) }
}

#[unsafe(no_mangle)]
extern "C" fn uws_h2_res_write_mark(res: &mut Response) {
    res.write_mark()
}

#[unsafe(no_mangle)]
extern "C" fn uws_h2_res_state(res: &mut Response) -> *mut server::State {
    res.stream().state.as_ptr()
}

// ──────────────────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct App; }
bun_opaque::opaque_ffi! { struct Router; }

const ANY: &str = "*";

fn route_method(method: Method) -> Option<&'static str> {
    Some(match method {
        Method::GET => "get",
        Method::POST => "post",
        Method::PUT => "put",
        Method::DELETE => "delete",
        Method::PATCH => "patch",
        Method::OPTIONS => "options",
        Method::HEAD => "head",
        Method::CONNECT => "connect",
        Method::TRACE => "trace",
        _ => return None,
    })
}

#[derive(Clone, Copy)]
struct Socket(*mut us_socket_t);

impl Socket {
    fn get<'a>(self) -> &'a mut us_socket_t {
        us_socket_t::opaque_mut(self.0)
    }

    /// `Http2SocketData::connection`
    fn connection_slot<'a>(self) -> &'a mut *const Connection {
        self.get().ext()
    }

    fn connection(self) -> ManuallyDrop<Rc<Connection>> {
        // SAFETY: from `on_adopt`, and `on_close` is the last event.
        ManuallyDrop::new(unsafe { Rc::from_raw(*self.connection_slot()) })
    }
}

impl server::Socket for Socket {
    fn write(self, bytes: &[u8]) -> usize {
        self.get().write(bytes).max(0) as usize
    }
    fn request_writable(self) {
        self.get().send_file_needs_more()
    }
    fn shutdown(self) {
        self.get().shutdown()
    }
    fn close(self) {
        self.get().close(CloseCode::normal)
    }
    fn set_timeout(self, seconds: u32) {
        self.get().set_timeout(seconds)
    }
}

struct Host {
    router: NonNull<Router>,
    date: &'static Cell<[u8; 29]>,
    schedule_drain: Cell<Option<(fn(*mut App), *mut App)>>,
}

impl Drop for Host {
    fn drop(&mut self) {
        // SAFETY: created in `Context::new`, destroyed once.
        unsafe { c::uws_h2_router_destroy(self.router.as_ptr()) }
    }
}

impl server::Host for Host {
    type Socket = Socket;
    type Field = Header;

    fn field(name: &[u8], value: &[u8]) -> Header {
        Header::init(name, value, None)
    }
    fn route(&self, stream: &Rc<Stream>, fields: &[Header]) -> bool {
        let (router, len) = (self.router.as_ptr(), fields.len() as c_uint);
        // SAFETY: what the fields point to lasts for the call.
        unsafe { c::uws_h2_router_route(router, Response::of(stream), fields.as_ptr(), len) }
    }
    fn date(&self) -> [u8; 29] {
        self.date.get()
    }
    fn max_header_size(&self) -> usize {
        c::BUN_DEFAULT_MAX_HTTP_HEADER_SIZE.load(Ordering::Relaxed)
    }
    fn schedule_drain(&self) {
        if let Some((cb, app)) = self.schedule_drain.get() {
            cb(app);
        }
    }
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// `uWS::Http2Context`
#[repr(C)]
struct Context {
    group: SocketGroup,
    on_adopt: unsafe extern "C" fn(&Context, *mut us_socket_t, *const u8, c_int, c_uint),
    close_all: extern "C" fn(&Context),
    close_idle: extern "C" fn(&Context, bool) -> usize,
    server: Rc<Server>,
}

impl Context {
    fn new(idle_timeout_s: u32) -> Rc<Self> {
        let host = Host {
            router: c::uws_h2_router_create(),
            date: c::uws_loop_date(),
            schedule_drain: Cell::new(None),
        };
        let context = Rc::new(Self {
            group: SocketGroup::default(),
            on_adopt: Self::on_adopt,
            close_all: Self::close_all,
            close_idle: Self::close_idle,
            server: Server::new(host, idle_timeout_s),
        });
        (context.group).init(Loop::get(), Some(&VTABLE), ptr::null_mut());
        context
    }

    fn connections(&self) -> impl Iterator<Item = Rc<Connection>> {
        self.group
            .sockets()
            .map(|socket| Rc::clone(&Socket(socket).connection()))
    }

    /// SAFETY: `data` has `len` bytes.
    unsafe extern "C" fn on_adopt(
        &self,
        socket: *mut us_socket_t,
        data: *const u8,
        len: c_int,
        preface_len: c_uint,
    ) {
        let socket = Socket(socket);
        let connection = Connection::new(Rc::clone(&self.server), socket, preface_len as usize);
        *socket.connection_slot() = Rc::into_raw(connection);
        if len > 0 {
            // SAFETY: forwarded.
            (socket.connection()).on_data(unsafe { slice(data, len as usize) });
        } else {
            socket.connection().flush();
        }
    }

    extern "C" fn close_all(&self) {
        Connection::close_all(self.connections());
    }

    extern "C" fn close_idle(&self, close_when_idle: bool) -> usize {
        Connection::close_idle(self.connections(), close_when_idle)
    }
}

static VTABLE: VTable = VTable {
    on_open: None,
    on_data: Some(on_data),
    on_fd: None,
    on_writable: Some(on_writable),
    on_close: Some(on_close),
    on_timeout: Some(on_timeout),
    on_long_timeout: None,
    on_end: Some(on_end),
    on_connect_error: None,
    on_connecting_error: None,
    on_handshake: None,
};

extern "C" fn on_data(socket: *mut us_socket_t, data: *mut u8, len: c_int) -> *mut us_socket_t {
    if !Socket(socket).get().is_shutdown() {
        // SAFETY: the loop lends what it read for the call.
        (Socket(socket).connection()).on_data(unsafe { slice(data, len as usize) });
    }
    socket
}

extern "C" fn on_writable(socket: *mut us_socket_t) -> *mut us_socket_t {
    Socket(socket).connection().on_writable();
    socket
}

extern "C" fn on_close(socket: *mut us_socket_t, _: c_int, _: *mut c_void) -> *mut us_socket_t {
    ManuallyDrop::into_inner(Socket(socket).connection()).on_close();
    c::uws_h2_socket_on_close(Socket(socket).get());
    socket
}

extern "C" fn on_timeout(socket: *mut us_socket_t) -> *mut us_socket_t {
    Socket(socket).connection().on_timeout();
    socket
}

extern "C" fn on_end(socket: *mut us_socket_t) -> *mut us_socket_t {
    Rc::clone(&Socket(socket).connection()).on_end();
    socket
}

/// It has to go right before its parent.
pub struct OwnedApp(Rc<Context>);

impl OwnedApp {
    /// Attach an HTTP/2 context to `parent`: its connections that negotiate
    /// "h2" via ALPN (or, without TLS, open with the prior-knowledge preface)
    /// are served by this app's routes. With `allow_http1 == false` the
    /// parent stops serving HTTP/1.x.
    pub fn new<const SSL: bool>(
        parent: &mut crate::app::App<SSL>,
        allow_http1: bool,
        idle_timeout_s: u32,
    ) -> Self {
        let context = Context::new(idle_timeout_s);
        let (parent, pointer) = (ptr::from_mut(parent).cast(), Rc::as_ptr(&context).cast());
        // SAFETY: `parent` is a live TemplatedApp<SSL>, which runs nothing once this is dropped.
        unsafe { c::uws_app_attach_http2(SSL.into(), parent, pointer, allow_http1) };
        Self(context)
    }

    pub fn as_ptr(&self) -> *mut App {
        Rc::as_ptr(&self.0).cast_mut().cast()
    }
}

impl Drop for OwnedApp {
    #[inline(never)]
    fn drop(&mut self) {
        self.0.close_all();
        self.0.server.cancel_drain();
    }
}

impl App {
    fn server(&self) -> &Rc<Server> {
        // SAFETY: from `OwnedApp::as_ptr`, which its holder keeps for as long as it uses this.
        &unsafe { &*self.as_mut_ptr().cast::<Context>() }.server
    }
    fn router(&mut self) -> &mut Router {
        Router::opaque_mut(self.server().host.router.as_ptr())
    }
    /// Streams parked on backpressure need another drain pass outside the
    /// current call; `cb` should arrange for [`drain`] to run soon.
    pub fn on_schedule_drain(&mut self, cb: fn(*mut App)) {
        (self.server().host.schedule_drain).set(Some((cb, self.as_mut_ptr())))
    }
    /// True if it has to run again, with no event to wait for.
    pub fn drain(&mut self) -> bool {
        Rc::clone(self.server()).drain()
    }
    pub fn clear_routes(&mut self) {
        c::uws_h2_router_clear(self.router())
    }

    fn route<UD, H>(which: &str, this: &mut App, pattern: &[u8], ud: *mut UD, _handler: H)
    where
        H: Fn(&UD, &mut Request, &mut Response) + Copy + 'static,
    {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn cb<UD, H>(res: *mut Response, req: *mut Request, p: *mut c_void)
        where
            H: Fn(&UD, &mut Request, &mut Response) + Copy + 'static,
        {
            // SAFETY: uWS callback contract — `res`/`req` live disjoint handles,
            // `p` is the registered `*mut UD` (non-null by route registration).
            unsafe {
                let Some(ud) = p.cast::<UD>().as_ref() else {
                    return;
                };
                thunk::zst::<H>()(ud, thunk::handle_mut(req), thunk::handle_mut(res));
            }
        }
        Self::route_raw(which, this, pattern, cb::<UD, H>, ud.cast());
    }

    /// `route` for an intrusively-refcounted `U` as the route userdata; see
    /// [`method_ref`](Self::method_ref).
    fn route_ref<U: AnyRefCounted + 'static, H>(
        which: &str,
        this: &mut App,
        pattern: &[u8],
        owner: &RefPtr<U>,
    ) where
        H: Fn(RefPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        extern "C" fn cb<U: AnyRefCounted + 'static, H>(
            res: *mut Response,
            req: *mut Request,
            p: *mut c_void,
        ) where
            H: Fn(RefPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
        {
            // SAFETY: `p` is the pointer registered with this thunk; the registrant holds a ref on it while the route is registered.
            let owner = unsafe { RefPtr::init_ref(p.cast::<U>()) };
            thunk::zst::<H>()(owner, AnyRequest::H3(req), AnyResponse::H2(res));
        }
        Self::route_raw(which, this, pattern, cb::<U, H>, owner.as_ptr().cast());
    }

    fn route_raw(which: &str, this: &mut App, pattern: &[u8], cb: c::Handler, ud: *mut c_void) {
        let (router, method, path) = (this.router(), which.as_ptr(), pattern.as_ptr());
        // SAFETY: a live handle and two slices.
        unsafe { c::uws_h2_router_add(router, method, which.len(), path, pattern.len(), cb, ud) }
    }

    pub fn head<UD, H>(&mut self, p: &[u8], ud: *mut UD, h: H)
    where
        H: Fn(&UD, &mut Request, &mut Response) + Copy + 'static,
    {
        self.method(Method::HEAD, p, ud, h);
    }

    pub fn any<UD, H>(&mut self, p: &[u8], ud: *mut UD, h: H)
    where
        H: Fn(&UD, &mut Request, &mut Response) + Copy + 'static,
    {
        Self::route(ANY, self, p, ud, h);
    }

    pub fn method<UD, H>(&mut self, m: Method, p: &[u8], ud: *mut UD, h: H)
    where
        H: Fn(&UD, &mut Request, &mut Response) + Copy + 'static,
    {
        if let Some(kind) = route_method(m) {
            Self::route(kind, self, p, ud, h);
        }
    }

    /// [`method`](Self::method) with an intrusively-refcounted `U` as the
    /// route userdata. The registrant keeps a ref on `owner` for as long as the
    /// route is registered, so the trampoline can hand the handler a ref of its own.
    pub fn method_ref<U: AnyRefCounted + 'static, H>(
        &mut self,
        m: Method,
        p: &[u8],
        _h: H,
        owner: &RefPtr<U>,
    ) where
        H: Fn(RefPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        if let Some(kind) = route_method(m) {
            Self::route_ref::<U, H>(kind, self, p, owner);
        }
    }

    /// [`any`](Self::any) counterpart of [`method_ref`](Self::method_ref).
    pub fn any_ref<U: AnyRefCounted + 'static, H>(&mut self, p: &[u8], _h: H, owner: &RefPtr<U>)
    where
        H: Fn(RefPtr<U>, AnyRequest, AnyResponse) + Copy + 'static,
    {
        Self::route_ref::<U, H>(ANY, self, p, owner);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C"
// ──────────────────────────────────────────────────────────────────────────

mod c {
    use super::*;

    pub(super) type Handler = extern "C" fn(*mut Response, *mut Request, *mut c_void);

    // Opaque handles in this module are `#[repr(C)]` with `UnsafeCell<[u8; 0]>`,
    // so `&T`/`&mut T` are ABI-identical to a non-null pointer. Shims whose
    // only pointer arg is the opaque handle (plus value types) are `safe fn`.
    // Shims with (ptr,len), nullable raw, *mut c_void ctx stay unsafe.
    unsafe extern "C" {
        pub(super) safe static BUN_DEFAULT_MAX_HTTP_HEADER_SIZE: AtomicUsize;
        pub(super) safe fn uws_loop_date() -> &'static Cell<[u8; 29]>;
        pub(super) fn uws_app_attach_http2(
            ssl: c_int,
            app: *mut crate::app::uws_app_t,
            context: *const c_void,
            allow_http1: bool,
        );
        pub(super) safe fn uws_h2_socket_on_close(socket: &mut us_socket_t);
        pub(super) safe fn uws_h2_router_create() -> NonNull<Router>;
        pub(super) fn uws_h2_router_destroy(router: *mut Router);
        pub(super) fn uws_h2_router_route(
            router: *mut Router,
            res: &mut Response,
            fields: *const Header,
            count: c_uint,
        ) -> bool;
        pub(super) safe fn uws_h2_router_clear(router: &mut Router);
        pub(super) fn uws_h2_router_add(
            router: &mut Router,
            method: *const u8,
            method_len: usize,
            pattern: *const u8,
            pattern_len: usize,
            handler: Handler,
            user_data: *mut c_void,
        );
    }
}
