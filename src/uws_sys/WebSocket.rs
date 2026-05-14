use core::ffi::{c_int, c_uint, c_ushort, c_void};
use core::marker::{PhantomData, PhantomPinned};

use crate as uws;
use crate::app::uws_app_t;
use crate::thunk;
use crate::{Opcode, Request, SendStatus, Socket, WebSocketUpgradeContext, uws_res};

// ─────────────────────────────────────────────────────────────────────────────
// NewWebSocket(comptime ssl_flag) type → opaque handle, monomorphized on SSL
// ─────────────────────────────────────────────────────────────────────────────

/// Opaque uWS WebSocket handle, parameterized by the SSL flag passed to the C
/// shims. In Zig this is `NewWebSocket(ssl_flag)` returning `opaque {}`.
#[repr(C)]
pub struct NewWebSocket<const SSL_FLAG: i32> {
    _p: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl<const SSL_FLAG: i32> NewWebSocket<SSL_FLAG> {
    /// Reborrow as the un-parameterized handle type. Both `NewWebSocket<_>` and
    /// `RawWebSocket` are `#[repr(C)]` opaque ZSTs over `UnsafeCell<[u8; 0]>`,
    /// so this is a same-address, same-layout reborrow with no `noalias`
    /// implications.
    #[inline]
    pub fn raw(&mut self) -> &mut RawWebSocket {
        // SAFETY: layout-identical opaque ZSTs (see doc comment); the reborrow
        // covers zero bytes and `UnsafeCell` suppresses `noalias`.
        unsafe { &mut *std::ptr::from_mut::<Self>(self).cast::<RawWebSocket>() }
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
            p.cast::<T>().as_mut()
        }
    }

    pub fn close(&mut self) {
        c::uws_ws_close(SSL_FLAG, self.raw())
    }

    pub fn send(&mut self, message: &[u8], opcode: Opcode) -> SendStatus {
        // SAFETY: self.raw() is a live uWS-owned socket; ptr+len from &[u8].
        unsafe {
            c::uws_ws_send(
                SSL_FLAG,
                self.raw(),
                message.as_ptr(),
                message.len(),
                opcode,
            )
        }
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
        self.raw().memory_cost(SSL_FLAG)
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
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn wrap<C>(user_data: *mut c_void) {
            // SAFETY: user_data is &mut (ptr, fn) on the caller's stack frame,
            // which outlives the synchronous uws_ws_cork call.
            let data = unsafe { bun_core::callback_ctx::<(*mut C, fn(&mut C))>(user_data) };
            // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
            (data.1)(unsafe { &mut *data.0 });
        }
        let mut data: (*mut C, fn(&mut C)) = (std::ptr::from_mut::<C>(ctx), callback);
        // `data` lives on this stack frame for the duration of the synchronous
        // uws_ws_cork call; the shim only forwards the pointer back to `wrap`.
        c::uws_ws_cork(
            SSL_FLAG,
            self.raw(),
            Some(wrap::<C>),
            (&raw mut data).cast::<c_void>(),
        )
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
        u32::try_from(c::uws_ws_get_buffered_amount(SSL_FLAG, self.raw())).unwrap()
    }

    pub fn get_remote_address<'a>(&mut self, buf: &'a mut [u8]) -> &'a mut [u8] {
        let mut ptr: *mut u8 = core::ptr::null_mut();
        let len = c::uws_ws_get_remote_address(SSL_FLAG, self.raw(), &mut ptr);
        // SAFETY: uWS returns a pointer+len into its internal buffer.
        let src = unsafe { bun_core::ffi::slice(ptr, len) };
        buf[..len].copy_from_slice(src);
        &mut buf[..len]
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RawWebSocket
// ─────────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct RawWebSocket; }

impl RawWebSocket {
    pub fn memory_cost(&mut self, ssl_flag: i32) -> usize {
        c::uws_ws_memory_cost(ssl_flag, self)
    }

    /// They're the same memory address.
    ///
    /// Equivalent to:
    ///
    ///   (struct us_socket_t *)socket
    pub fn as_socket(&mut self) -> *mut Socket {
        std::ptr::from_mut::<RawWebSocket>(self).cast::<Socket>()
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
        // TODO(port): lifetime — returning an unbounded `&mut` is a placeholder; Phase
        // B should scope this to the callback frame or return *mut T.
        let (ssl, ws) = self.split();
        unsafe { c::uws_ws_get_user_data(ssl, ws).cast::<T>().as_mut() }
    }

    /// Raw user-data pointer cast to `*mut T` (NULL if unset).
    ///
    /// PORT NOTE (noalias re-entrancy): the `WebSocketHandler` dispatch
    /// trampolines use this instead of `as_::<T>()` so the handler frame holds
    /// a raw `*mut T`, not a `noalias` `&mut T`. A JS callback fired from inside
    /// the handler can re-derive `&mut T` via the JS wrapper's `m_ptr` (e.g.
    /// `ws.close()` → `on_close` → `flags.set_closed(true)`); a live `noalias`
    /// `&mut T` across that call lets LLVM dead-store the re-entrant write.
    ///
    /// Safe: `uws_ws_get_user_data` is a `safe fn` (opaque-handle + scalar
    /// args) and raw-pointer `cast` is safe; only the eventual *dereference*
    /// requires the caller's "user data was set to a `*mut T`" guarantee.
    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        let (ssl, ws) = self.split();
        c::uws_ws_get_user_data(ssl, ws).cast::<T>()
    }

    /// (ssl_flag, &mut socket) pair for the C shims that take both.
    ///
    /// `RawWebSocket` is an opaque `UnsafeCell<[u8; 0]>` — `&mut` carries no
    /// `noalias`, dereferences zero bytes, and uWS guarantees the pointer is
    /// non-null for a live `AnyWebSocket`. The unbounded lifetime is harmless
    /// for the same reason: there are no bytes for it to claim validity over.
    #[inline]
    fn split<'a>(self) -> (i32, &'a mut RawWebSocket) {
        let (ssl, p) = match self {
            AnyWebSocket::Ssl(p) => (1, p),
            AnyWebSocket::Tcp(p) => (0, p),
        };
        // S012: `RawWebSocket` is an `opaque_ffi!` ZST — route the
        // `*mut → &mut` deref through the const-asserted safe accessor.
        (ssl, RawWebSocket::opaque_mut(p))
    }

    pub fn memory_cost(self) -> usize {
        let (ssl, ws) = self.split();
        ws.memory_cost(ssl)
    }

    pub fn close(self) {
        let (ssl, ws) = self.split();
        c::uws_ws_close(ssl, ws)
    }

    pub fn send(self, message: &[u8], opcode: Opcode, compress: bool, fin: bool) -> SendStatus {
        let (ssl, ws) = self.split();
        // SAFETY: `ws` is a live uWS-owned socket (S012 opaque); ptr+len from &[u8].
        unsafe {
            c::uws_ws_send_with_options(
                ssl,
                ws,
                message.as_ptr(),
                message.len(),
                opcode,
                compress,
                fin,
            )
        }
    }

    pub fn send_last_fragment(self, message: &[u8], compress: bool) -> SendStatus {
        let (ssl, ws) = self.split();
        // SAFETY: `ws` is a live uWS-owned socket (S012 opaque); ptr+len from &[u8].
        unsafe { c::uws_ws_send_last_fragment(ssl, ws, message.as_ptr(), message.len(), compress) }
    }

    pub fn end(self, code: i32, message: &[u8]) {
        let (ssl, ws) = self.split();
        // SAFETY: `ws` is a live uWS-owned socket (S012 opaque); ptr+len from &[u8].
        unsafe { c::uws_ws_end(ssl, ws, code, message.as_ptr(), message.len()) }
    }

    // TODO(port): comptime-callback monomorphization — see NewWebSocket::cork.
    pub fn cork<C>(self, ctx: &mut C, callback: fn(&mut C)) {
        // Safe fn item: nested local thunk, only coerced to the C-ABI
        // fn-pointer type passed to C; body wraps its raw-ptr ops explicitly.
        extern "C" fn wrap<C>(user_data: *mut c_void) {
            // SAFETY: user_data points at a stack tuple alive for the duration
            // of the synchronous uws_ws_cork call.
            let data = unsafe { bun_core::callback_ctx::<(*mut C, fn(&mut C))>(user_data) };
            // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
            (data.1)(unsafe { &mut *data.0 });
        }
        let mut data: (*mut C, fn(&mut C)) = (std::ptr::from_mut::<C>(ctx), callback);
        let ud = (&raw mut data).cast::<c_void>();
        let (ssl, ws) = self.split();
        // `data` lives on this stack frame for the duration of the synchronous
        // uws_ws_cork call; the shim only forwards `ud` back to `wrap`.
        c::uws_ws_cork(ssl, ws, Some(wrap::<C>), ud)
    }

    pub fn subscribe(self, topic: &[u8]) -> bool {
        let (ssl, ws) = self.split();
        // SAFETY: `ws` is a live uWS-owned socket (S012 opaque); ptr+len from &[u8].
        unsafe { c::uws_ws_subscribe(ssl, ws, topic.as_ptr(), topic.len()) }
    }

    pub fn unsubscribe(self, topic: &[u8]) -> bool {
        let (ssl, ws) = self.split();
        // SAFETY: `ws` is a live uWS-owned socket (S012 opaque); ptr+len from &[u8].
        unsafe { c::uws_ws_unsubscribe(ssl, ws, topic.as_ptr(), topic.len()) }
    }

    pub fn is_subscribed(self, topic: &[u8]) -> bool {
        let (ssl, ws) = self.split();
        // SAFETY: `ws` is a live uWS-owned socket (S012 opaque); ptr+len from &[u8].
        unsafe { c::uws_ws_is_subscribed(ssl, ws, topic.as_ptr(), topic.len()) }
    }

    // getTopicsAsJSArray — deleted: *_jsc alias (see PORTING.md). Lives in
    // bun_runtime::socket::uws_jsc as an extension on AnyWebSocket.

    // pub fn iterate_topics(self) {
    //     return uws_ws_iterate_topics(ssl_flag, self.raw(), callback, user_data);
    // }

    pub fn publish(self, topic: &[u8], message: &[u8], opcode: Opcode, compress: bool) -> bool {
        let (ssl, ws) = self.split();
        // SAFETY: `ws` is a live uWS-owned socket (S012 opaque); ptr+len from &[u8].
        unsafe {
            c::uws_ws_publish_with_options(
                ssl,
                ws,
                topic.as_ptr(),
                topic.len(),
                message.as_ptr(),
                message.len(),
                opcode,
                compress,
            )
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
        // S012: `NewApp<SSL>` is a ZST opaque — route the `*mut → &mut` deref
        // through `bun_opaque::opaque_deref_mut` (caller still vouches that
        // `app` is the matching `uws_app_t*`; the `ssl` flag selects the
        // const-generic instantiation).
        if ssl {
            uws::NewApp::<true>::publish_with_options(
                bun_opaque::opaque_deref_mut(app.cast::<uws::NewApp<true>>()),
                topic,
                message,
                opcode,
                compress,
            )
        } else {
            uws::NewApp::<false>::publish_with_options(
                bun_opaque::opaque_deref_mut(app.cast::<uws::NewApp<false>>()),
                topic,
                message,
                opcode,
                compress,
            )
        }
    }

    pub fn get_buffered_amount(self) -> usize {
        let (ssl, ws) = self.split();
        c::uws_ws_get_buffered_amount(ssl, ws)
    }

    pub fn get_remote_address<'a>(self, buf: &'a mut [u8]) -> &'a mut [u8] {
        let (ssl_flag, ws) = self.split();
        let mut ptr: *mut u8 = core::ptr::null_mut();
        let len = c::uws_ws_get_remote_address(ssl_flag, ws, &mut ptr);
        // SAFETY: uWS returns a pointer+len into its internal buffer.
        let src = unsafe { bun_core::ffi::slice(ptr, len) };
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
    unsafe extern "C" fn(
        *mut c_void,
        *mut uws_res,
        *mut Request,
        *mut WebSocketUpgradeContext,
        usize,
    ),
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
/// PORT NOTE (noalias re-entrancy): the `on_*` methods take `this: *mut Self`,
/// NOT `&mut self`. The handler body re-enters JS (`ws.send()`, `ws.close()`,
/// promise callbacks…); JS can call back into this same socket via the wrapper
/// object's `m_ptr`, re-deriving a `&mut Self` and mutating its fields. A live
/// `noalias` `&mut Self` argument carried through the dispatch frame would
/// alias that re-entrant borrow (Stacked-Borrows UB) and let LLVM dead-store
/// the re-entrant write. Implementors materialise short-lived `&mut *this`
/// reborrows only — none spanning a JS callback.
pub trait WebSocketHandler: Sized + 'static {
    const HAS_ON_MESSAGE: bool = true;
    const HAS_ON_DRAIN: bool = true;
    const HAS_ON_PING: bool = true;
    const HAS_ON_PONG: bool = true;

    /// # Safety
    /// `this` is the live `*mut Self` from the socket's user-data slot;
    /// JS-thread only.
    unsafe fn on_open(this: *mut Self, ws: AnyWebSocket);
    /// # Safety
    /// See `on_open`.
    unsafe fn on_message(this: *mut Self, ws: AnyWebSocket, message: &[u8], opcode: Opcode);
    /// # Safety
    /// See `on_open`.
    unsafe fn on_drain(this: *mut Self, ws: AnyWebSocket);
    /// # Safety
    /// See `on_open`.
    unsafe fn on_ping(this: *mut Self, ws: AnyWebSocket, message: &[u8]);
    /// # Safety
    /// See `on_open`.
    unsafe fn on_pong(this: *mut Self, ws: AnyWebSocket, message: &[u8]);
    /// # Safety
    /// See `on_open`.
    unsafe fn on_close(this: *mut Self, ws: AnyWebSocket, code: i32, message: &[u8]);
}

/// Server type that handles the HTTP→WS upgrade. Replaces Zig's
/// `comptime ServerType` parameter to `WebSocketBehavior.Wrap`.
pub trait WebSocketUpgradeServer<const SSL: bool>: Sized + 'static {
    // TODO(port): `*NewApp(is_ssl).Response` — exact Rust type pending App.rs port.
    /// # Safety
    /// `this` is the raw user-data pointer passed to `uws_ws()` at registration
    /// time, cast to `*mut Self`. **Its actual pointee type is discriminated by
    /// `id`** — `Bun.serve` registers `*mut UserRoute` for `id == 1` and
    /// `*mut Self` for `id == 0` (see `runtime/server/mod.rs`). Implementers
    /// MUST dispatch on `id` *before* dereferencing `this`; the trampoline
    /// deliberately forwards the raw pointer (no `&mut Self` is ever
    /// materialized) so that the wrong-typed reference is never created when
    /// `id != 0`.
    unsafe fn on_websocket_upgrade(
        this: *mut Self,
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
        if SSL {
            AnyWebSocket::Ssl(raw_ws)
        } else {
            AnyWebSocket::Tcp(raw_ws)
        }
    }

    // The `on_*` trampolines below are stored as fn-pointer values in
    // `WebSocketBehavior`; a safe `extern "C" fn` item coerces to the
    // `Option<unsafe extern "C" fn(..)>` field type. Each body already scopes
    // its own proof block around the `T::on_*` dispatch / `thunk::c_slice`.
    pub extern "C" fn on_open(raw_ws: *mut RawWebSocket) {
        let ws = Self::make_ws(raw_ws);
        // `*mut T` (not `&mut T`) — no `noalias` borrow held across the
        // re-entrant handler. User data was set to *mut T at upgrade time.
        let this = ws.as_ptr::<T>();
        if this.is_null() {
            return;
        }
        // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
        unsafe { T::on_open(this, ws) };
    }

    pub extern "C" fn on_message(
        raw_ws: *mut RawWebSocket,
        message: *const u8,
        length: usize,
        opcode: Opcode,
    ) {
        let ws = Self::make_ws(raw_ws);
        let this = ws.as_ptr::<T>();
        if this.is_null() {
            return;
        }
        // SAFETY: user data was set to *mut T at upgrade time; `message[..length]` valid.
        unsafe { T::on_message(this, ws, thunk::c_slice(message, length), opcode) };
    }

    pub extern "C" fn on_drain(raw_ws: *mut RawWebSocket) {
        let ws = Self::make_ws(raw_ws);
        let this = ws.as_ptr::<T>();
        if this.is_null() {
            return;
        }
        // SAFETY: see `on_open`.
        unsafe { T::on_drain(this, ws) };
    }

    pub extern "C" fn on_ping(raw_ws: *mut RawWebSocket, message: *const u8, length: usize) {
        let ws = Self::make_ws(raw_ws);
        let this = ws.as_ptr::<T>();
        if this.is_null() {
            return;
        }
        // SAFETY: user data was set to *mut T at upgrade time; `message[..length]` valid.
        unsafe { T::on_ping(this, ws, thunk::c_slice(message, length)) };
    }

    pub extern "C" fn on_pong(raw_ws: *mut RawWebSocket, message: *const u8, length: usize) {
        let ws = Self::make_ws(raw_ws);
        let this = ws.as_ptr::<T>();
        if this.is_null() {
            return;
        }
        // SAFETY: user data was set to *mut T at upgrade time; `message[..length]` valid.
        unsafe { T::on_pong(this, ws, thunk::c_slice(message, length)) };
    }

    pub extern "C" fn on_close(
        raw_ws: *mut RawWebSocket,
        code: i32,
        message: *const u8,
        length: usize,
    ) {
        let ws = Self::make_ws(raw_ws);
        let this = ws.as_ptr::<T>();
        if this.is_null() {
            return;
        }
        // SAFETY: user data was set to *mut T at upgrade time; `message[..length]` valid when non-null.
        unsafe { T::on_close(this, ws, code, thunk::c_slice(message, length)) };
    }

    pub extern "C" fn on_upgrade(
        ptr: *mut c_void,
        res: *mut uws_res,
        req: *mut Request,
        context: *mut WebSocketUpgradeContext,
        id: usize,
    ) {
        // SAFETY: `ptr` is the user-data passed to `uws_ws()` at registration
        // time; uWS passes non-null req/context valid for the duration of the
        // upgrade callback. We forward `ptr` as a *raw* `*mut Server` without
        // creating a `&mut Server` — the actual pointee type is discriminated
        // by `id` inside the implementer (see trait docs), and materializing a
        // typed reference here would be UB when `id` selects a different type.
        if ptr.is_null() {
            return;
        }
        unsafe {
            Server::on_websocket_upgrade(
                ptr.cast::<Server>(),
                res.cast::<uws::NewAppResponse<SSL>>(),
                thunk::handle_mut(req),
                thunk::handle_mut(context),
                id,
            );
        }
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
            message: if T::HAS_ON_MESSAGE {
                Some(Self::on_message)
            } else {
                None
            },
            drain: if T::HAS_ON_DRAIN {
                Some(Self::on_drain)
            } else {
                None
            },
            ping: if T::HAS_ON_PING {
                Some(Self::on_ping)
            } else {
                None
            },
            pong: if T::HAS_ON_PONG {
                Some(Self::on_pong)
            } else {
                None
            },
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

    // `RawWebSocket` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` —
    // `&RawWebSocket`/`&mut RawWebSocket` are ABI-identical to a non-null
    // pointer with no `readonly`/`noalias`. Shims whose only pointer argument
    // is the socket itself (plus value types) are `safe fn`; (ptr,len) shims
    // and out-param shims stay unsafe.
    unsafe extern "C" {
        pub safe fn uws_ws_memory_cost(ssl: i32, ws: &mut RawWebSocket) -> usize;
        pub fn uws_ws(
            ssl: i32,
            app: *mut uws_app_t,
            ctx: *mut c_void,
            pattern: *const u8,
            pattern_len: usize,
            id: usize,
            behavior: *const WebSocketBehavior,
        );
        pub safe fn uws_ws_get_user_data(ssl: i32, ws: &mut RawWebSocket) -> *mut c_void;
        pub safe fn uws_ws_close(ssl: i32, ws: &mut RawWebSocket);
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
        // safe: cork is synchronous — `user_data` is passed straight back to
        // `handler` without being dereferenced by the C++ shim itself, so the
        // call has no preconditions beyond the live opaque handle. Mirrors
        // `uws_res_cork`.
        pub safe fn uws_ws_cork(
            ssl: i32,
            ws: &mut RawWebSocket,
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
        pub safe fn uws_ws_get_buffered_amount(ssl: i32, ws: &mut RawWebSocket) -> usize;
        // Out-param `dest` is `&mut *mut u8` (non-null, valid for write); the C
        // shim only stores a pointer into socket-owned storage and returns its
        // length — no read-through precondition, so `safe fn`.
        pub safe fn uws_ws_get_remote_address(
            ssl: i32,
            ws: &mut RawWebSocket,
            dest: &mut *mut u8,
        ) -> usize;
        pub safe fn uws_ws_get_remote_address_as_text(
            ssl: i32,
            ws: &mut RawWebSocket,
            dest: &mut *mut u8,
        ) -> usize;
    }
}

// ported from: src/uws_sys/WebSocket.zig
