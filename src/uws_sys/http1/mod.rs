//! The HTTP/1 connections of a server. Derives from uWebSockets (LICENSE.md).

pub(crate) mod events;
pub(crate) mod node;
mod response;

use core::cell::{Cell, RefCell, UnsafeCell};
use core::ffi::{c_char, c_void};
use core::mem::{MaybeUninit, offset_of};
use core::ptr;

use bun_http_types::Method::Method;
use bun_http_types::router::{Parameters, Router};
use bun_http1::request::{Request, RequestParser};

use crate::app::{ConnectionChange, Context};
use crate::async_socket::{AsyncSocket, SocketData};
use crate::request::{self, Routed};
use crate::response::State;
use crate::web_socket::UpgradeRoute;
use crate::{SocketKind, us_socket_t, uws_res};

pub(crate) type OnWritable = fn(&uws_res, u64, *mut c_void) -> bool;
pub(crate) type OnEvent = fn(&uws_res, *mut c_void);
pub(crate) type OnData = fn(&uws_res, &[u8], bool, *mut c_void);

/// The ext of the socket. Never dropped: the close event empties it, under calls that still use it. HttpResponse.h mirrors the start.
#[repr(C)]
pub(crate) struct Connection {
    socket: SocketData,
    state: Cell<State>,
    received_since_timeout: Cell<u32>,
    idle_timeout: Cell<u8>,
    /// How much of HTTP/2's preface was held back, until the protocol is decided.
    preface_len: Cell<Option<u8>>,
    is_node: Cell<bool>,
    is_idle: Cell<bool>,
    is_idle_tunnel: Cell<bool>,
    is_vacated: Cell<bool>,
    user_data: Cell<*mut c_void>,
    writable_user_data: Cell<*mut c_void>,
    on_writable: Cell<Option<OnWritable>>,
    on_aborted: Cell<Option<OnEvent>>,
    on_data: Cell<Option<OnData>>,
    on_timeout: Cell<Option<OnEvent>>,
    http: MaybeUninit<Http>,
}

/// What another protocol writes over.
struct Http {
    parser: UnsafeCell<RequestParser>,
    /// How much of the body `end` and `try_end` have written.
    offset: Cell<u64>,
    /// 0 unless `node:http` waits for the rest of a request.
    request_start_ms: Cell<u64>,
    /// The last chunk, with the trailer section.
    last_chunk: Cell<Box<[u8]>>,
    verify_error: Cell<*const c_char>,
    /// Pipelined ones of `node:http`, until they get the connection.
    queued_responses: Cell<u32>,
    has_complete_head: Cell<bool>,
    has_reported_request_timeout: Cell<bool>,
    handshake: Cell<Handshake>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Handshake {
    Pending,
    Failed,
    Complete,
    Verified,
}

pub(crate) const VACATED_OFFSET: usize = offset_of!(Connection, http);
pub(crate) const VACATED_LEN: usize = size_of::<Http>();

const _: () = assert!(offset_of!(Connection, socket.node_socket) == 0);
const _: () = assert!(offset_of!(Connection, state) == 48);
// With the socket, it fills a block of 320 bytes.
const _: () = assert!(size_of::<Connection>() <= 240);

impl Connection {
    fn new(is_node: bool, default_max_head_len: usize) -> Self {
        Self {
            socket: SocketData::default(),
            state: Cell::new(State::empty()),
            received_since_timeout: Cell::new(0),
            idle_timeout: Cell::new(10),
            preface_len: Cell::new(Some(0)),
            is_node: Cell::new(is_node),
            is_idle: Cell::new(false),
            is_idle_tunnel: Cell::new(false),
            is_vacated: Cell::new(false),
            user_data: Cell::new(ptr::null_mut()),
            writable_user_data: Cell::new(ptr::null_mut()),
            on_writable: Cell::new(None),
            on_aborted: Cell::new(None),
            on_data: Cell::new(None),
            on_timeout: Cell::new(None),
            http: MaybeUninit::new(Http {
                parser: UnsafeCell::new(RequestParser::new(default_max_head_len)),
                offset: Cell::new(0),
                request_start_ms: Cell::new(0),
                last_chunk: Cell::default(),
                verify_error: Cell::new(ptr::null()),
                queued_responses: Cell::new(0),
                has_complete_head: Cell::new(false),
                has_reported_request_timeout: Cell::new(false),
                handshake: Cell::new(Handshake::Pending),
            }),
        }
    }

    fn http(&self) -> &Http {
        assert!(!self.is_vacated.get());
        // SAFETY: from `new`, and not written over.
        unsafe { self.http.assume_init_ref() }
    }

    /// Any of them.
    fn has(&self, flags: State) -> bool {
        self.state.get().intersects(flags)
    }

    fn mark(&self, flags: State) {
        self.state.update(|state| state | flags);
    }

    fn unmark(&self, flags: State) {
        self.state.update(|state| state - flags);
    }

    fn with_parser<R>(&self, f: impl FnOnce(&mut RequestParser) -> R) -> R {
        // SAFETY: neither `f` nor the read, while it borrows the parser, calls out.
        f(unsafe { &mut *self.http().parser.get() })
    }

    fn is_tunnel(&self) -> bool {
        self.with_parser(|parser| parser.is_tunnel)
    }

    fn is_receiving_request(&self) -> bool {
        self.with_parser(|parser| parser.has_incomplete_body() || parser.has_partial_head())
    }

    fn begin_response(&self) {
        self.http().offset.set(0);
        (self.state).update(|state| state & State::OF_CONNECTION | State::HTTP_RESPONSE_PENDING);
        self.is_idle.set(false);
    }

    fn end_response(&self) {
        self.clear_response_handlers();
        // The body of a request to `node:http` outlives its response.
        if !self.is_node.get() {
            self.on_data.set(None);
        }
        self.unmark(State::HTTP_RESPONSE_PENDING);
        self.is_idle.set(self.http().queued_responses.get() == 0);
    }

    fn clear_response_handlers(&self) {
        self.on_writable.set(None);
        self.writable_user_data.set(ptr::null_mut());
        self.on_aborted.set(None);
        self.on_timeout.set(None);
    }

    fn closes_after_response(&self) -> bool {
        self.has(State::HTTP_CONNECTION_CLOSE | State::HTTP_NODE_CLOSE_AFTER_DRAIN)
            || (self.has(State::HTTP_NODE_RECEIVED_FIN) && self.http().queued_responses.get() == 0)
            || (self.has(State::HTTP_CLOSE_WHEN_IDLE) && self.is_idle.get())
    }

    /// RFC 9112 §9.6: nothing that arrives now is a request.
    fn is_draining_before_close(&self) -> bool {
        self.has(State::HTTP_CONNECTION_CLOSE) && !self.has(State::HTTP_RESPONSE_PENDING)
    }

    fn free_buffers(&self) {
        self.with_parser(RequestParser::release);
        self.http().last_chunk.take();
    }

    fn vacate(&self) {
        self.free_buffers();
        self.is_vacated.set(true);
    }
}

impl uws_res {
    pub fn of<'a>(socket: *mut us_socket_t) -> &'a Self {
        Self::opaque_ref(socket.cast())
    }

    pub(crate) fn socket(&self) -> &AsyncSocket {
        AsyncSocket::opaque_ref(self.as_mut_ptr().cast())
    }

    fn raw<'a>(&self) -> &'a mut us_socket_t {
        self.socket().raw()
    }

    fn connection(&self) -> &Connection {
        // SAFETY: as in `AsyncSocket::data`.
        unsafe { &*self.raw().ext_ptr().cast() }
    }

    fn context<'a>(&self) -> &'a Context {
        assert!(!self.connection().is_vacated.get());
        // SAFETY: it is still in the group of one, which its server drops in a task or at exit, once no connection or request is left.
        unsafe { &*self.raw().group().owner() }
    }

    fn is_being_read(&self) -> bool {
        ptr::eq(self.context().reading.get(), self)
    }

    pub(crate) fn is_closed_or_upgraded(&self) -> bool {
        self.is_closed() || self.connection().is_vacated.get()
    }

    pub(crate) fn is_ssl(&self) -> bool {
        self.raw().kind() == SocketKind::UwsHttpTls
    }

    fn report_gone(&self) {
        let change = match self.connection().is_idle_tunnel.get() {
            true => ConnectionChange::IdleTunnelGone,
            false => ConnectionChange::Gone,
        };
        self.context().report(change);
    }

    /// With the 101 corked. The caller writes at `VACATED_OFFSET`.
    pub(crate) fn vacate_for_web_socket(&self) {
        let connection = self.connection();
        connection.mark(State::HTTP_END_CALLED);
        connection.end_response();
        self.report_gone();
        connection.vacate();
    }

    /// The caller writes at `VACATED_OFFSET`, and reports the close to what this returns.
    pub(crate) fn vacate_for_http2<'a>(&self) -> &'a Context {
        let context = self.context();
        self.socket().uncork_without_sending();
        self.socket().clear_buffer();
        self.connection().vacate();
        context
    }
}

#[repr(C)]
pub(crate) struct Bytes {
    data: *const u8,
    len: usize,
}

impl From<&[u8]> for Bytes {
    fn from(bytes: &[u8]) -> Self {
        Self {
            data: bytes.as_ptr(),
            len: bytes.len(),
        }
    }
}

/// LTO does not inline a function that returns `Bytes`: clang and rustc give it different types.
pub(crate) type Out<'a> = &'a mut MaybeUninit<Bytes>;

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__target(request: &Request<'_>, out: Out<'_>) {
    out.write(request.target().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__afterHead(request: &Request<'_>, out: Out<'_>) {
    out.write(request.after_head().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__isHttp10(request: &Request<'_>) -> bool {
    request.is_http_1_0()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__nextField(
    request: &Request<'_>,
    index: &mut usize,
    name: Out<'_>,
    value: Out<'_>,
) -> bool {
    request.field_at(*index).is_some_and(|field| {
        *index += 1;
        name.write(field.name.into());
        value.write(field.value.into());
        true
    })
}

#[unsafe(no_mangle)]
extern "C" fn Bun__RouteParameters__at(parameters: &Parameters<'_>, index: usize, out: Out<'_>) {
    out.write(parameters.get(index).copied().unwrap_or_default().into());
}

#[derive(Default)]
pub(crate) struct Routes {
    pub(crate) requests: request::Routes<uws_res, crate::Request>,
    /// They go first.
    pub(crate) upgrades: RefCell<Router<UpgradeRoute>>,
}

impl Routes {
    fn find_upgrade<'a>(
        &self,
        path: &'a [u8],
        request: &mut Routed<'a, &Request<'_>>,
    ) -> Option<UpgradeRoute> {
        let upgrades = self.upgrades.borrow();
        if upgrades.is_empty() || request.head.field(b"sec-websocket-key")?.len() != 24 {
            return None;
        }
        upgrades.find(Method::GET, path, 0, &mut request.parameters)
    }

    /// False if no handler took it.
    fn dispatch(&self, response: &uws_res, head: &Request<'_>, answers_expect: bool) -> bool {
        let Some(method) = Method::find_uppercase(head.method()) else {
            return false;
        };
        let write_continue = || {
            if answers_expect && head.field(b"expect") == Some(b"100-continue") {
                response.write_continue();
            }
        };
        let (path, mut request) = (head.path(), Routed::new(method, head));
        if method == Method::GET
            && let Some(upgrade) = self.find_upgrade(path, &mut request)
        {
            write_continue();
            let handle = crate::Request::opaque_mut(ptr::from_mut(&mut request).cast());
            upgrade.run(response.as_mut_ptr(), handle);
            debug_assert!(!request.has_yielded.get());
            return true;
        }
        (self.requests).dispatch(path, response.as_mut_ptr(), &mut request, write_continue)
    }
}
