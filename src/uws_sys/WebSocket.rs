use core::ffi::{c_int, c_uint, c_ushort, c_void};
use core::marker::{PhantomData, PhantomPinned};

use bun_uws_sys as uws;
use bun_uws_sys::{Opcode, Request, SendStatus, Socket, WebSocketUpgradeContext, uws_res};
use crate::app::uws_app_t;

// ─────────────────────────────────────────────────────────────────────────────
// NewWebSocket(comptime ssl_flag) type → opaque handle, monomorphized on SSL
// ─────────────────────────────────────────────────────────────────────────────

/// Opaque uWS WebSocket handle, parameterized by the SSL flag passed to the C
/// shims. In Zig this is `NewWebSocket(ssl_flag)` returning `opaque {}`.
#[repr(C)]
pub struct NewWebSocket<const SSL_FLAG: i32> {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl<const SSL_FLAG: i32> NewWebSocket<SSL_FLAG> {
    #[inline]
    pub fn raw(&mut self) -> *mut RawWebSocket {
        self as *mut Self as *mut RawWebSocket
    }

    /// Cast the C-side user data pointer to `&mut T`.
    ///
    /// # Safety
    /// Caller must guarantee the user data was set to a `*mut T` for this socket.
    #[inline]
    pub unsafe fn as_<T>(&mut self) -> Option<&mut T> {
        // SAFETY: mirrors Zig `@setRuntimeSafety(false)` + ptrCast/alignCast of
        // the opaque user-data pointer. Caller upholds the type invariant.
        unsafe {
            let p = c::uws_ws_get_user_data(SSL_FLAG, self.raw());
            (p as *mut T).as_mut()
        }
    }

    pub fn close(&mut self) {
        // SAFETY: self.raw() is a live uWS-owned socket.
        unsafe { c::uws_ws_close(SSL_FLAG, self.raw()) }
    }

    pub fn send(&mut self, message: &[u8], opcode: Opcode) -> SendStatus {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe { c::uws_ws_send(SSL_FLAG, self.raw(), message.as_ptr(), message.len(), opcode) }
    }

    pub fn send_with_options(
        &mut self,
        message: &[u8],
        opcode: Opcode,
        compress: bool,
        fin: bool,
    ) -> SendStatus {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe {
            c::uws_ws_send_with_options(
                SSL_FLAG,
                self.raw(),
                message.as_ptr(),
                message.len(),
                opcode,
                compress,
                fin,
            )
        }
    }

    pub fn memory_cost(&mut self) -> usize {
        // SAFETY: self.raw() is a valid live socket.
        unsafe { (*self.raw()).memory_cost(SSL_FLAG) }
    }

    pub fn send_last_fragment(&mut self, message: &[u8], compress: bool) -> SendStatus {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe {
            c::uws_ws_send_last_fragment(
                SSL_FLAG,
                self.raw(),
                message.as_ptr(),
                message.len(),
                compress,
            )
        }
    }

    pub fn end(&mut self, code: i32, message: &[u8]) {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe { c::uws_ws_end(SSL_FLAG, self.raw(), code, message.as_ptr(), message.len()) }
    }

    /// Run `callback(ctx)` while the socket is corked.
    ///
    /// Zig: `cork(ctx: anytype, comptime callback: anytype)` — the callback is
    /// monomorphized into an `extern "C"` trampoline. Rust cannot const-generic
    /// over a fn value, so we tunnel `(ctx, callback)` through the user-data
    /// pointer instead.
    // TODO(port): comptime-callback monomorphization — Phase B may want a
    // per-callsite `extern "C" fn` to avoid the indirect call.
    pub fn cork<C>(&mut self, ctx: &mut C, callback: fn(&mut C)) {
        unsafe extern "C" fn wrap<C>(user_data: *mut c_void) {
            // SAFETY: user_data is &mut (ptr, fn) on the caller's stack frame,
            // which outlives the synchronous uws_ws_cork call.
            let data = unsafe { &mut *(user_data as *mut (*mut C, fn(&mut C))) };
            // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
            (data.1)(unsafe { &mut *data.0 });
        }
        let mut data: (*mut C, fn(&mut C)) = (ctx as *mut C, callback);
        // SAFETY: self.raw() is a live uWS-owned socket; `data` lives on this
        // stack frame for the duration of the synchronous uws_ws_cork call.
        unsafe {
            c::uws_ws_cork(
                SSL_FLAG,
                self.raw(),
                Some(wrap::<C>),
                &mut data as *mut _ as *mut c_void,
            )
        }
    }

    pub fn subscribe(&mut self, topic: &[u8]) -> bool {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe { c::uws_ws_subscribe(SSL_FLAG, self.raw(), topic.as_ptr(), topic.len()) }
    }

    pub fn unsubscribe(&mut self, topic: &[u8]) -> bool {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe { c::uws_ws_unsubscribe(SSL_FLAG, self.raw(), topic.as_ptr(), topic.len()) }
    }

    pub fn is_subscribed(&mut self, topic: &[u8]) -> bool {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe { c::uws_ws_is_subscribed(SSL_FLAG, self.raw(), topic.as_ptr(), topic.len()) }
    }

    // getTopicsAsJSArray: use AnyWebSocket::get_topics_as_js_array (src/runtime/socket/uws_jsc.rs)

    pub fn publish(&mut self, topic: &[u8], message: &[u8]) -> bool {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe {
            c::uws_ws_publish(
                SSL_FLAG,
                self.raw(),
                topic.as_ptr(),
                topic.len(),
                message.as_ptr(),
                message.len(),
            )
        }
    }

    pub fn publish_with_options(
        &mut self,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> bool {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe {
            c::uws_ws_publish_with_options(
                SSL_FLAG,
                self.raw(),
                topic.as_ptr(),
                topic.len(),
                message.as_ptr(),
                message.len(),
                opcode,
                compress,
            )
        }
    }

    pub fn get_buffered_amount(&mut self) -> u32 {
        // TODO(port): C decl returns usize but Zig wrapper types this as u32 —
        // verify which is correct in Phase B.
        // SAFETY: self.raw() is a live uWS-owned socket.
        u32::try_from(unsafe { c::uws_ws_get_buffered_amount(SSL_FLAG, self.raw()) }).unwrap()
    }

    pub fn get_remote_address<'a>(&mut self, buf: &'a mut [u8]) -> &'a mut [u8] {
        let mut ptr: *mut u8 = core::ptr::null_mut();
        let len = unsafe { c::uws_ws_get_remote_address(SSL_FLAG, self.raw(), &mut ptr) };
        // SAFETY: uWS returns a pointer+len into its internal buffer.
        let src = unsafe { core::slice::from_raw_parts(ptr, len) };
        buf[..len].copy_from_slice(src);
        &mut buf[..len]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RawWebSocket
// ─────────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct RawWebSocket {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl RawWebSocket {
    pub fn memory_cost(&mut self, ssl_flag: i32) -> usize {
        // SAFETY: `self` is a live uWS-owned socket.
        unsafe { c::uws_ws_memory_cost(ssl_flag, self) }
    }

    /// They're the same memory address.
    ///
    /// Equivalent to:
    ///
    ///   (struct us_socket_t *)socket
    pub fn as_socket(&mut self) -> *mut Socket {
        self as *mut RawWebSocket as *mut Socket
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AnyWebSocket
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub enum AnyWebSocket {
    Ssl(*mut RawWebSocket),
    Tcp(*mut RawWebSocket),
}

impl AnyWebSocket {
    #[inline]
    pub fn raw(self) -> *mut RawWebSocket {
        match self {
            AnyWebSocket::Ssl(p) => p,
            AnyWebSocket::Tcp(p) => p,
        }
    }

    /// # Safety
    /// Caller must guarantee the user data was set to a `*mut T` for this socket.
    #[inline]
    pub unsafe fn as_<T>(self) -> Option<&'static mut T> {
        // SAFETY: see NewWebSocket::as_. Lifetime is tied to the C-owned socket
        // (effectively 'static from Rust's view; uWS frees on close).
        // TODO(port): lifetime — returning &'static mut is a placeholder; Phase
        // B should scope this to the callback frame or return *mut T.
        unsafe {
            match self {
                AnyWebSocket::Ssl(p) => (c::uws_ws_get_user_data(1, p) as *mut T).as_mut(),
                AnyWebSocket::Tcp(p) => (c::uws_ws_get_user_data(0, p) as *mut T).as_mut(),
            }
        }
    }

    pub fn memory_cost(self) -> usize {
        // SAFETY: `p` is a live uWS-owned socket for the lifetime of self.
        match self {
            AnyWebSocket::Ssl(p) => unsafe { (*p).memory_cost(1) },
            AnyWebSocket::Tcp(p) => unsafe { (*p).memory_cost(0) },
        }
    }

    pub fn close(self) {
        let ssl_flag = matches!(self, AnyWebSocket::Ssl(_)) as i32;
        // SAFETY: self.raw() is a live uWS-owned socket.
        unsafe { c::uws_ws_close(ssl_flag, self.raw()) }
    }

    pub fn send(self, message: &[u8], opcode: Opcode, compress: bool, fin: bool) -> SendStatus {
        // SAFETY: `p` is a live uWS-owned socket; ptr+len from &[u8].
        match self {
            AnyWebSocket::Ssl(p) => unsafe {
                c::uws_ws_send_with_options(1, p, message.as_ptr(), message.len(), opcode, compress, fin)
            },
            AnyWebSocket::Tcp(p) => unsafe {
                c::uws_ws_send_with_options(0, p, message.as_ptr(), message.len(), opcode, compress, fin)
            },
        }
    }

    pub fn send_last_fragment(self, message: &[u8], compress: bool) -> SendStatus {
        // SAFETY: `p` is a live uWS-owned socket; ptr+len from &[u8].
        match self {
            AnyWebSocket::Tcp(p) => unsafe {
                c::uws_ws_send_last_fragment(0, p, message.as_ptr(), message.len(), compress)
            },
            AnyWebSocket::Ssl(p) => unsafe {
                c::uws_ws_send_last_fragment(1, p, message.as_ptr(), message.len(), compress)
            },
        }
    }

    pub fn end(self, code: i32, message: &[u8]) {
        // SAFETY: `p` is a live uWS-owned socket; ptr+len from &[u8].
        match self {
            AnyWebSocket::Tcp(p) => unsafe {
                c::uws_ws_end(0, p, code, message.as_ptr(), message.len())
            },
            AnyWebSocket::Ssl(p) => unsafe {
                c::uws_ws_end(1, p, code, message.as_ptr(), message.len())
            },
        }
    }

    // TODO(port): comptime-callback monomorphization — see NewWebSocket::cork.
    pub fn cork<C>(self, ctx: &mut C, callback: fn(&mut C)) {
        unsafe extern "C" fn wrap<C>(user_data: *mut c_void) {
            // SAFETY: user_data points at a stack tuple alive for the duration
            // of the synchronous uws_ws_cork call.
            let data = unsafe { &mut *(user_data as *mut (*mut C, fn(&mut C))) };
            // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
            (data.1)(unsafe { &mut *data.0 });
        }
        let mut data: (*mut C, fn(&mut C)) = (ctx as *mut C, callback);
        let ud = &mut data as *mut _ as *mut c_void;
        // SAFETY: `p` is a live uWS-owned socket; `data` lives on this stack
        // frame for the duration of the synchronous uws_ws_cork call.
        match self {
            AnyWebSocket::Ssl(p) => unsafe { c::uws_ws_cork(1, p, Some(wrap::<C>), ud) },
            AnyWebSocket::Tcp(p) => unsafe { c::uws_ws_cork(0, p, Some(wrap::<C>), ud) },
        }
    }

    pub fn subscribe(self, topic: &[u8]) -> bool {
        // SAFETY: `p` is a live uWS-owned socket; ptr+len from &[u8].
        match self {
            AnyWebSocket::Ssl(p) => unsafe {
                c::uws_ws_subscribe(1, p, topic.as_ptr(), topic.len())
            },
            AnyWebSocket::Tcp(p) => unsafe {
                c::uws_ws_subscribe(0, p, topic.as_ptr(), topic.len())
            },
        }
    }

    pub fn unsubscribe(self, topic: &[u8]) -> bool {
        // SAFETY: `p` is a live uWS-owned socket; ptr+len from &[u8].
        match self {
            AnyWebSocket::Ssl(p) => unsafe {
                c::uws_ws_unsubscribe(1, p, topic.as_ptr(), topic.len())
            },
            AnyWebSocket::Tcp(p) => unsafe {
                c::uws_ws_unsubscribe(0, p, topic.as_ptr(), topic.len())
            },
        }
    }

    pub fn is_subscribed(self, topic: &[u8]) -> bool {
        // SAFETY: `p` is a live uWS-owned socket; ptr+len from &[u8].
        match self {
            AnyWebSocket::Ssl(p) => unsafe {
                c::uws_ws_is_subscribed(1, p, topic.as_ptr(), topic.len())
            },
            AnyWebSocket::Tcp(p) => unsafe {
                c::uws_ws_is_subscribed(0, p, topic.as_ptr(), topic.len())
            },
        }
    }

    // getTopicsAsJSArray — deleted: *_jsc alias (see PORTING.md). Lives in
    // bun_runtime::socket::uws_jsc as an extension on AnyWebSocket.

    // pub fn iterate_topics(self) {
    //     return uws_ws_iterate_topics(ssl_flag, self.raw(), callback, user_data);
    // }

    pub fn publish(self, topic: &[u8], message: &[u8], opcode: Opcode, compress: bool) -> bool {
        // SAFETY: `p` is a live uWS-owned socket; ptr+len from &[u8].
        match self {
            AnyWebSocket::Ssl(p) => unsafe {
                c::uws_ws_publish_with_options(
                    1, p, topic.as_ptr(), topic.len(), message.as_ptr(), message.len(), opcode, compress,
                )
            },
            AnyWebSocket::Tcp(p) => unsafe {
                c::uws_ws_publish_with_options(
                    0, p, topic.as_ptr(), topic.len(), message.as_ptr(), message.len(), opcode, compress,
                )
            },
        }
    }

    pub fn publish_with_options(
        ssl: bool,
        app: *mut c_void,
        topic: &[u8],
        message: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> bool {
        // Zig: switch (ssl) { inline else => |tls| uws.NewApp(tls).publishWithOptions(...) }
        if ssl {
            uws::NewApp::<true>::publish_with_options(
                // SAFETY: caller guarantees `app` is the matching uws_app_t*.
                unsafe { &mut *(app as *mut uws::NewApp<true>) },
                topic, message, opcode, compress,
            )
        } else {
            uws::NewApp::<false>::publish_with_options(
                // SAFETY: caller guarantees `app` is the matching uws_app_t*.
                unsafe { &mut *(app as *mut uws::NewApp<false>) },
                topic, message, opcode, compress,
            )
        }
    }

    pub fn get_buffered_amount(self) -> usize {
        // SAFETY: `p` is a live uWS-owned socket.
        match self {
            AnyWebSocket::Ssl(p) => unsafe { c::uws_ws_get_buffered_amount(1, p) },
            AnyWebSocket::Tcp(p) => unsafe { c::uws_ws_get_buffered_amount(0, p) },
        }
    }

    pub fn get_remote_address<'a>(self, buf: &'a mut [u8]) -> &'a mut [u8] {
        let (ssl_flag, p) = match self {
            AnyWebSocket::Ssl(p) => (1, p),
            AnyWebSocket::Tcp(p) => (0, p),
        };
        let mut ptr: *mut u8 = core::ptr::null_mut();
        // SAFETY: `p` is a live uWS-owned socket; out-param is a valid *mut *mut u8.
        let len = unsafe { c::uws_ws_get_remote_address(ssl_flag, p, &mut ptr) };
        // SAFETY: uWS returns a pointer+len into its internal buffer.
        let src = unsafe { core::slice::from_raw_parts(ptr, len) };
        buf[..len].copy_from_slice(src);
        &mut buf[..len]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketBehavior
// ─────────────────────────────────────────────────────────────────────────────

pub type uws_websocket_handler = Option<unsafe extern "C" fn(*mut RawWebSocket)>;
pub type uws_websocket_message_handler =
    Option<unsafe extern "C" fn(*mut RawWebSocket, *const u8, usize, Opcode)>;
pub type uws_websocket_close_handler =
    Option<unsafe extern "C" fn(*mut RawWebSocket, i32, *const u8, usize)>;
pub type uws_websocket_upgrade_handler = Option<
    unsafe extern "C" fn(*mut c_void, *mut uws_res, *mut Request, *mut WebSocketUpgradeContext, usize),
>;
pub type uws_websocket_ping_pong_handler =
    Option<unsafe extern "C" fn(*mut RawWebSocket, *const u8, usize)>;

#[repr(C)]
pub struct WebSocketBehavior {
    pub compression: c::uws_compress_options_t,
    pub max_payload_length: c_uint,
    pub idle_timeout: c_ushort,
    pub max_backpressure: c_uint,
    pub close_on_backpressure_limit: bool,
    pub reset_idle_timeout_on_send: bool,
    pub send_pings_automatically: bool,
    pub max_lifetime: c_ushort,
    pub upgrade: uws_websocket_upgrade_handler,
    pub open: uws_websocket_handler,
    pub message: uws_websocket_message_handler,
    pub drain: uws_websocket_handler,
    pub ping: uws_websocket_ping_pong_handler,
    pub pong: uws_websocket_ping_pong_handler,
    pub close: uws_websocket_close_handler,
}

impl Default for WebSocketBehavior {
    fn default() -> Self {
        Self {
            compression: 0,
            max_payload_length: u32::MAX,
            idle_timeout: 120,
            max_backpressure: 1024 * 1024,
            close_on_backpressure_limit: false,
            reset_idle_timeout_on_send: true,
            send_pings_automatically: true,
            max_lifetime: 0,
            upgrade: None,
            open: None,
            message: None,
            drain: None,
            ping: None,
            pong: None,
            close: None,
        }
    }
}

/// User-data type stored on a uWS WebSocket. Replaces Zig's `comptime Type`
/// parameter to `WebSocketBehavior.Wrap`.
///
/// `HAS_ON_*` consts replace `@hasDecl(Type, "...")` — set to `false` to leave
/// the corresponding C callback `null`.
pub trait WebSocketHandler: Sized + 'static {
    const HAS_ON_MESSAGE: bool = true;
    const HAS_ON_DRAIN: bool = true;
    const HAS_ON_PING: bool = true;
    const HAS_ON_PONG: bool = true;

    fn on_open(&mut self, ws: AnyWebSocket);
    fn on_message(&mut self, ws: AnyWebSocket, message: &[u8], opcode: Opcode);
    fn on_drain(&mut self, ws: AnyWebSocket);
    fn on_ping(&mut self, ws: AnyWebSocket, message: &[u8]);
    fn on_pong(&mut self, ws: AnyWebSocket, message: &[u8]);
    fn on_close(&mut self, ws: AnyWebSocket, code: i32, message: &[u8]);
}

/// Server type that handles the HTTP→WS upgrade. Replaces Zig's
/// `comptime ServerType` parameter to `WebSocketBehavior.Wrap`.
pub trait WebSocketUpgradeServer<const SSL: bool>: Sized + 'static {
    // TODO(port): `*NewApp(is_ssl).Response` — exact Rust type pending App.rs port.
    fn on_websocket_upgrade(
        &mut self,
        res: *mut uws::NewAppResponse<SSL>,
        req: &mut Request,
        context: &mut WebSocketUpgradeContext,
        id: usize,
    );
}

/// Zig: `WebSocketBehavior.Wrap(ServerType, Type, ssl)` — a type containing
/// `extern "C"` trampolines that downcast user-data and forward to `Type`'s
/// methods, plus `apply()` to fill a `WebSocketBehavior`.
pub struct Wrap<Server, T, const SSL: bool>(PhantomData<(Server, T)>);

impl<Server, T, const SSL: bool> Wrap<Server, T, SSL>
where
    Server: WebSocketUpgradeServer<SSL>,
    T: WebSocketHandler,
{
    #[inline(always)]
    fn make_ws(raw_ws: *mut RawWebSocket) -> AnyWebSocket {
        // Zig: @unionInit(AnyWebSocket, if (ssl) "ssl" else "tcp", @ptrCast(raw_ws))
        if SSL { AnyWebSocket::Ssl(raw_ws) } else { AnyWebSocket::Tcp(raw_ws) }
    }

    pub unsafe extern "C" fn on_open(raw_ws: *mut RawWebSocket) {
        let ws = Self::make_ws(raw_ws);
        // SAFETY: user data was set to *mut T at upgrade time.
        let this = unsafe { ws.as_::<T>() }.unwrap();
        // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
        this.on_open(ws);
    }

    pub unsafe extern "C" fn on_message(
        raw_ws: *mut RawWebSocket,
        message: *const u8,
        length: usize,
        opcode: Opcode,
    ) {
        let ws = Self::make_ws(raw_ws);
        let this = unsafe { ws.as_::<T>() }.unwrap();
        let msg: &[u8] = if length > 0 {
            // SAFETY: uWS guarantees `message` is valid for `length` bytes.
            unsafe { core::slice::from_raw_parts(message, length) }
        } else {
            b""
        };
        this.on_message(ws, msg, opcode);
    }

    pub unsafe extern "C" fn on_drain(raw_ws: *mut RawWebSocket) {
        let ws = Self::make_ws(raw_ws);
        let this = unsafe { ws.as_::<T>() }.unwrap();
        this.on_drain(ws);
    }

    pub unsafe extern "C" fn on_ping(raw_ws: *mut RawWebSocket, message: *const u8, length: usize) {
        let ws = Self::make_ws(raw_ws);
        let this = unsafe { ws.as_::<T>() }.unwrap();
        let msg: &[u8] = if length > 0 {
            // SAFETY: uWS guarantees `message` is valid for `length` bytes.
            unsafe { core::slice::from_raw_parts(message, length) }
        } else {
            b""
        };
        this.on_ping(ws, msg);
    }

    pub unsafe extern "C" fn on_pong(raw_ws: *mut RawWebSocket, message: *const u8, length: usize) {
        let ws = Self::make_ws(raw_ws);
        let this = unsafe { ws.as_::<T>() }.unwrap();
        let msg: &[u8] = if length > 0 {
            // SAFETY: uWS guarantees `message` is valid for `length` bytes.
            unsafe { core::slice::from_raw_parts(message, length) }
        } else {
            b""
        };
        this.on_pong(ws, msg);
    }

    pub unsafe extern "C" fn on_close(
        raw_ws: *mut RawWebSocket,
        code: i32,
        message: *const u8,
        length: usize,
    ) {
        let ws = Self::make_ws(raw_ws);
        let this = unsafe { ws.as_::<T>() }.unwrap();
        let msg: &[u8] = if length > 0 && !message.is_null() {
            // SAFETY: uWS guarantees `message` is valid for `length` bytes when non-null.
            unsafe { core::slice::from_raw_parts(message, length) }
        } else {
            b""
        };
        this.on_close(ws, code, msg);
    }

    pub unsafe extern "C" fn on_upgrade(
        ptr: *mut c_void,
        res: *mut uws_res,
        req: *mut Request,
        context: *mut WebSocketUpgradeContext,
        id: usize,
    ) {
        // SAFETY: `ptr` is the *Server passed to uws_ws() at registration time.
        let server = unsafe { &mut *(ptr as *mut Server) };
        server.on_websocket_upgrade(
            res as *mut uws::NewAppResponse<SSL>,
            // SAFETY: uWS passes non-null req/context valid for the duration of
            // the upgrade callback.
            unsafe { &mut *req },
            // SAFETY: see above.
            unsafe { &mut *context },
            id,
        );
    }

    pub fn apply(behavior: WebSocketBehavior) -> WebSocketBehavior {
        WebSocketBehavior {
            compression: behavior.compression,
            max_payload_length: behavior.max_payload_length,
            idle_timeout: behavior.idle_timeout,
            max_backpressure: behavior.max_backpressure,
            close_on_backpressure_limit: behavior.close_on_backpressure_limit,
            reset_idle_timeout_on_send: behavior.reset_idle_timeout_on_send,
            send_pings_automatically: behavior.send_pings_automatically,
            max_lifetime: behavior.max_lifetime,
            upgrade: Some(Self::on_upgrade),
            open: Some(Self::on_open),
            message: if T::HAS_ON_MESSAGE { Some(Self::on_message) } else { None },
            drain: if T::HAS_ON_DRAIN { Some(Self::on_drain) } else { None },
            ping: if T::HAS_ON_PING { Some(Self::on_ping) } else { None },
            pong: if T::HAS_ON_PONG { Some(Self::on_pong) } else { None },
            close: Some(Self::on_close),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// extern "C" — raw uWS bindings
// ─────────────────────────────────────────────────────────────────────────────

pub mod c {
    use super::*;

    pub type uws_compress_options_t = i32;

    unsafe extern "C" {
        pub fn uws_ws_memory_cost(ssl: i32, ws: *mut RawWebSocket) -> usize;
        pub fn uws_ws(
            ssl: i32,
            app: *mut uws_app_t,
            ctx: *mut c_void,
            pattern: *const u8,
            pattern_len: usize,
            id: usize,
            behavior: *const WebSocketBehavior,
        );
        pub fn uws_ws_get_user_data(ssl: i32, ws: *mut RawWebSocket) -> *mut c_void;
        pub fn uws_ws_close(ssl: i32, ws: *mut RawWebSocket);
        pub fn uws_ws_send(
            ssl: i32,
            ws: *mut RawWebSocket,
            message: *const u8,
            length: usize,
            opcode: Opcode,
        ) -> SendStatus;
        pub fn uws_ws_send_with_options(
            ssl: i32,
            ws: *mut RawWebSocket,
            message: *const u8,
            length: usize,
            opcode: Opcode,
            compress: bool,
            fin: bool,
        ) -> SendStatus;
        pub fn uws_ws_send_fragment(
            ssl: i32,
            ws: *mut RawWebSocket,
            message: *const u8,
            length: usize,
            compress: bool,
        ) -> SendStatus;
        pub fn uws_ws_send_first_fragment(
            ssl: i32,
            ws: *mut RawWebSocket,
            message: *const u8,
            length: usize,
            compress: bool,
        ) -> SendStatus;
        pub fn uws_ws_send_first_fragment_with_opcode(
            ssl: i32,
            ws: *mut RawWebSocket,
            message: *const u8,
            length: usize,
            opcode: Opcode,
            compress: bool,
        ) -> SendStatus;
        pub fn uws_ws_send_last_fragment(
            ssl: i32,
            ws: *mut RawWebSocket,
            message: *const u8,
            length: usize,
            compress: bool,
        ) -> SendStatus;
        pub fn uws_ws_end(
            ssl: i32,
            ws: *mut RawWebSocket,
            code: i32,
            message: *const u8,
            length: usize,
        );
        pub fn uws_ws_cork(
            ssl: i32,
            ws: *mut RawWebSocket,
            handler: Option<unsafe extern "C" fn(*mut c_void)>,
            user_data: *mut c_void,
        );
        pub fn uws_ws_subscribe(
            ssl: i32,
            ws: *mut RawWebSocket,
            topic: *const u8,
            length: usize,
        ) -> bool;
        pub fn uws_ws_unsubscribe(
            ssl: i32,
            ws: *mut RawWebSocket,
            topic: *const u8,
            length: usize,
        ) -> bool;
        pub fn uws_ws_is_subscribed(
            ssl: i32,
            ws: *mut RawWebSocket,
            topic: *const u8,
            length: usize,
        ) -> bool;
        pub fn uws_ws_iterate_topics(
            ssl: i32,
            ws: *mut RawWebSocket,
            callback: Option<unsafe extern "C" fn(*const u8, usize, *mut c_void)>,
            user_data: *mut c_void,
        );
        // uws_ws_get_topics_as_js_array: see src/runtime/socket/uws_jsc.rs
        pub fn uws_ws_publish(
            ssl: i32,
            ws: *mut RawWebSocket,
            topic: *const u8,
            topic_length: usize,
            message: *const u8,
            message_length: usize,
        ) -> bool;
        pub fn uws_ws_publish_with_options(
            ssl: i32,
            ws: *mut RawWebSocket,
            topic: *const u8,
            topic_length: usize,
            message: *const u8,
            message_length: usize,
            opcode: Opcode,
            compress: bool,
        ) -> bool;
        pub fn uws_ws_get_buffered_amount(ssl: i32, ws: *mut RawWebSocket) -> usize;
        pub fn uws_ws_get_remote_address(
            ssl: i32,
            ws: *mut RawWebSocket,
            dest: *mut *mut u8,
        ) -> usize;
        pub fn uws_ws_get_remote_address_as_text(
            ssl: i32,
            ws: *mut RawWebSocket,
            dest: *mut *mut u8,
        ) -> usize;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/WebSocket.zig (362 lines)
//   confidence: medium-high
//   todos:      5
//   notes:      Wrap uses traits (WebSocketHandler/WebSocketUpgradeServer) for @hasDecl; cork() tunnels (ctx,fn) via user_data instead of comptime monomorphization; NewApp/NewAppResponse types pending App.rs port
// ──────────────────────────────────────────────────────────────────────────
