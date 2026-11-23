//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `on_open`/`on_data`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` shim those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. It replaces the
//! old `NewSocketHandler.configure`/`unsafeConfigure` machinery, which built
//! the same trampolines at runtime per `us_socket_context_t`.

use bun_ptr::{AnyRefCounted, RefPtr};
use core::ffi::{c_int, c_void};

use bun_uws::{ConnectingSocket, NewSocketHandler};
use bun_uws_sys::thunk::ExtSlot;
use bun_uws_sys::vtable::Handler as VHandler;
use bun_uws_sys::{us_bun_verify_error_t, us_socket_t};

use crate::api;
use crate::ipc as IPC;
use crate::socket::NativeRef;
use crate::valkey_jsc::js_valkey;
use bun_http_jsc::websocket_client;
use bun_http_jsc::websocket_client::websocket_upgrade_client;
use bun_sql_jsc::mysql;
use bun_sql_jsc::postgres;

use crate::dispatch::fold;

#[inline(always)]
fn wrap<const SSL: bool>(s: *mut us_socket_t) -> NewSocketHandler<SSL> {
    NewSocketHandler::<SSL>::from(s)
}

// ── SocketEvents / RefPtrHandler ────────────────────────────────────────────
/// A handler owns a ref: it can release the one that the ext slot stands for.
pub(crate) trait SocketEvents<const SSL: bool>: AnyRefCounted {
    const HAS_ON_OPEN: bool = false;
    const HAS_ON_END: bool = true;

    fn on_open(self: RefPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_data(self: RefPtr<Self>, s: NewSocketHandler<SSL>, data: &[u8]);
    fn on_writable(self: RefPtr<Self>, s: NewSocketHandler<SSL>);
    fn on_close(self: RefPtr<Self>, code: i32);
    fn on_timeout(self: RefPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_end(self: RefPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_connect_error(self: RefPtr<Self>, _s: NewSocketHandler<SSL>, _code: i32) {}
    fn on_handshake(
        self: RefPtr<Self>,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: us_bun_verify_error_t,
    );
}

pub(crate) struct RefPtrHandler<T, const SSL: bool>(core::marker::PhantomData<T>);

impl<T, const SSL: bool> VHandler for RefPtrHandler<T, SSL>
where
    T: SocketEvents<SSL> + 'static,
{
    type Ext = ExtSlot<T>;

    const HAS_ON_OPEN: bool = T::HAS_ON_OPEN;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = T::HAS_ON_END;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = ext.owner() else { return };
        this.on_open(wrap::<SSL>(s));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner() else { return };
        this.on_data(wrap::<SSL>(s), data);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner() else { return };
        this.on_writable(wrap::<SSL>(s));
    }
    fn on_close(ext: &mut Self::Ext, _: *mut us_socket_t, code: i32, _: Option<*mut c_void>) {
        let Some(this) = ext.owner() else { return };
        this.on_close(code);
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner() else { return };
        this.on_timeout(wrap::<SSL>(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner() else { return };
        this.on_end(wrap::<SSL>(s));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        let Some(this) = ext.owner() else { return };
        this.on_connect_error(wrap::<SSL>(s), code);
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let slot = ConnectingSocket::opaque_mut(c).ext::<ExtSlot<T>>();
        let Some(this) = slot.owner() else { return };
        this.on_connect_error(NewSocketHandler::<SSL>::from_connecting(c), code);
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = ext.owner() else { return };
        this.on_handshake(wrap::<SSL>(s), ok as i32, err);
    }
}

impl<const SSL: bool> SocketEvents<SSL> for websocket_upgrade_client::NewHttpUpgradeClient<SSL>
where
    Self: bun_http_jsc::websocket_client::websocket_proxy_tunnel::IntoUpgradeClientRef,
{
    const HAS_ON_OPEN: bool = true;

    fn on_open(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
        self.handle_open(s);
    }
    fn on_data(self: RefPtr<Self>, s: NewSocketHandler<SSL>, data: &[u8]) {
        self.handle_data(s, data);
    }
    fn on_writable(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
        self.handle_writable(s);
    }
    fn on_close(self: RefPtr<Self>, code: i32) {
        self.handle_close(code);
    }
    fn on_timeout(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
        self.handle_timeout(s);
    }
    fn on_end(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
        self.handle_end(s);
    }
    fn on_connect_error(self: RefPtr<Self>, s: NewSocketHandler<SSL>, code: i32) {
        self.handle_connect_error(s, code);
    }
    fn on_handshake(
        self: RefPtr<Self>,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        self.handle_handshake(s, ok, err);
    }
}

impl<const SSL: bool> SocketEvents<SSL> for websocket_client::WebSocket<SSL> {
    // No `on_open` / `on_connect_error` override — adoption of an already-connected socket.
    // No `on_end` override — the socket doesn't allow half-open, so uSockets closes it right after.
    const HAS_ON_END: bool = false;

    fn on_data(self: RefPtr<Self>, _s: NewSocketHandler<SSL>, data: &[u8]) {
        self.handle_data(data);
    }
    fn on_writable(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
        self.handle_writable(s);
    }
    fn on_close(self: RefPtr<Self>, code: i32) {
        self.handle_close(code);
    }
    fn on_timeout(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
        self.handle_timeout(s);
    }
    fn on_handshake(
        self: RefPtr<Self>,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        self.handle_handshake(s, ok, err);
    }
}

/// Forwards to the inherent `on_*` functions of a SQL driver's `SocketHandler<SSL>`.
macro_rules! impl_sql_socket_events {
    ($Owner:ty, $Handler:ty) => {
        impl<const SSL: bool> SocketEvents<SSL> for $Owner {
            const HAS_ON_OPEN: bool = true;

            fn on_open(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
                <$Handler>::on_open(&self, s);
            }
            fn on_data(self: RefPtr<Self>, s: NewSocketHandler<SSL>, data: &[u8]) {
                <$Handler>::on_data(&self, s, data);
            }
            fn on_writable(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
                <$Handler>::on_writable(&self, s);
            }
            fn on_close(self: RefPtr<Self>, _: i32) {
                <$Handler>::on_close(&self);
            }
            fn on_end(self: RefPtr<Self>, s: NewSocketHandler<SSL>) {
                <$Handler>::on_end(&self, s);
            }
            fn on_connect_error(self: RefPtr<Self>, s: NewSocketHandler<SSL>, code: i32) {
                <$Handler>::on_connect_error(&self, s, code);
            }
            fn on_handshake(
                self: RefPtr<Self>,
                s: NewSocketHandler<SSL>,
                ok: i32,
                err: us_bun_verify_error_t,
            ) {
                if SSL {
                    <$Handler>::on_handshake(&self, s, ok, err);
                }
            }
        }
    };
}

impl_sql_socket_events!(
    postgres::PostgresSQLConnection,
    postgres::postgres_sql_connection::SocketHandler<SSL>
);
impl_sql_socket_events!(
    mysql::js_my_sql_connection::JSMySQLConnection,
    mysql::js_my_sql_connection::SocketHandler<SSL>
);

// ── Bun.connect / Bun.listen ────────────────────────────────────────────────
/// Does not borrow the ext slot across a handler, which can empty it (`connect()` again).
pub(crate) struct BunSocket<const SSL: bool>;

impl<const SSL: bool> VHandler for BunSocket<SSL> {
    type Ext = ();

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(_: &mut (), s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        if let Some(ns) = NativeRef::<SSL>::of(s).cloned() {
            fold(ns.on_open(wrap(s)));
        }
    }
    fn on_data(_: &mut (), s: *mut us_socket_t, data: &[u8]) {
        if let Some(consumer) = NativeRef::<SSL>::of(s).consumer(|ns| ns.begin_read(wrap(s), data))
        {
            fold(consumer.on_data(data));
        }
    }
    fn on_writable(_: &mut (), s: *mut us_socket_t) {
        if let Some(consumer) = NativeRef::<SSL>::of(s).consumer(super::NewSocket::begin_drain) {
            fold(consumer.on_writable());
        }
    }
    fn on_close(_: &mut (), s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        // SAFETY: a losing candidate is closed without a dispatch.
        if let Some(ns) = unsafe { NativeRef::<SSL>::of(s).take() } {
            fold(ns.on_close(wrap(s), code, reason));
        }
    }
    fn on_timeout(_: &mut (), s: *mut us_socket_t) {
        if let Some(ns) = NativeRef::<SSL>::of(s).cloned() {
            fold(ns.on_timeout(wrap(s)));
        }
    }
    fn on_end(_: &mut (), s: *mut us_socket_t) {
        if let Some(ns) = NativeRef::<SSL>::of(s).cloned() {
            fold(ns.on_end(wrap(s)));
        }
    }
    fn on_connect_error(_: &mut (), s: *mut us_socket_t, code: i32) {
        // SAFETY: as in `on_close`.
        if let Some(ns) = unsafe { NativeRef::<SSL>::of(s).take() } {
            fold(ns.on_connect_error(wrap(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        // SAFETY: no candidate won.
        if let Some(ns) = unsafe { NativeRef::<SSL>::of_connecting(c).take() } {
            let socket = NewSocketHandler::from_connecting(c);
            fold(ns.on_connect_error(socket, code));
        }
    }
    fn on_handshake(_: &mut (), s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        if let Some(ns) = NativeRef::<SSL>::of(s).cloned() {
            fold(ns.on_handshake(wrap(s), ok as i32, err));
        }
    }
}

/// An accepted socket's first event. `on_create` fills its ext and re-stamps it `.bun_socket_{tcp,tls}`, so the rest go to `BunSocket`.
pub(crate) struct BunListener<const SSL: bool>;

impl<const SSL: bool> VHandler for BunListener<SSL> {
    // The ext slot is still uninitialized. The owner comes from `s.group().owner(Listener)`.
    type Ext = ();

    const HAS_ON_OPEN: bool = true;

    fn on_open(_: &mut (), s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref; `group()` is non-null for accepted sockets and `owner` was
        // stashed at listen time.
        let listener = us_socket_t::opaque_mut(s).group().owner::<api::Listener>();
        // on_create allocates the NewSocket, stashes it in ext, and
        // restamps kind → .bun_socket_*. Fire the user `open` handler
        // (markActive, ALPN, JS callback) before returning so the same
        // dispatch tick that accepted the fd sees an open socket — the
        // old `configure({onCreate, onOpen})` path did this in one
        // on_open call.
        //
        // SAFETY: `owner::<Listener>()` returns the back-pointer stashed by
        // `Listener::listen`; the listener strictly outlives every accepted
        // socket and is read-only here.
        let ns = api::Listener::on_create::<SSL>(unsafe { &*listener }, s);
        fold(ns.on_open(wrap::<SSL>(s)));
    }
}

/// An event that can close the socket takes the `Hold` of its dial.
pub(crate) struct Valkey<const SSL: bool>;

type ValkeyH<const SSL: bool> = js_valkey::SocketHandler<SSL>;

impl<const SSL: bool> VHandler for Valkey<SSL> {
    type Ext = ExtSlot<js_valkey::JSValkeyClient>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    // No `on_end`: half-open sockets are not allowed, so the close event follows.
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = ext.owner_ref() else { return };
        ValkeyH::<SSL>::on_open(this, wrap(s));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        if let Some(hold) = ext.owner_ref().and_then(|this| this.dial.hold()) {
            ValkeyH::<SSL>::on_data(&hold, wrap(s), data);
        }
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        if let Some(hold) = ext.owner_ref().and_then(|this| this.dial.hold()) {
            ValkeyH::<SSL>::on_writable(&hold, wrap(s));
        }
    }
    fn on_close(ext: &mut Self::Ext, _: *mut us_socket_t, _: i32, _: Option<*mut c_void>) {
        if let Some(dial) = ext.owner_ref().and_then(|this| this.dial.take()) {
            fold(ValkeyH::<SSL>::on_close(dial));
        }
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        if let Some(dial) = ext.owner_ref().and_then(|this| this.dial.take()) {
            fold(ValkeyH::<SSL>::on_connect_error(dial, wrap(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let ext = ConnectingSocket::opaque_mut(c).ext::<Self::Ext>();
        if let Some(dial) = ext.owner_ref().and_then(|this| this.dial.take()) {
            let socket = NewSocketHandler::from_connecting(c);
            fold(ValkeyH::<SSL>::on_connect_error(dial, socket, code));
        }
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        if SSL && let Some(hold) = ext.owner_ref().and_then(|this| this.dial.hold()) {
            fold(ValkeyH::<SSL>::on_handshake(&hold, wrap(s), ok as i32, err));
        }
    }
}

// ── HTTP client thread (fetch) ──────────────────────────────────────────────
/// Does not borrow the ext slot across a handler, which writes to it.
pub(crate) struct HTTPClient<const SSL: bool>;

// Each event is written out by hand; `HAS_ON_*` is simply left unset
// for events the upstream `Handler<SSL>` doesn't define.
type HttpH<const SSL: bool> = bun_http::http_context::Handler<SSL>;

impl<const SSL: bool> VHandler for HTTPClient<SSL> {
    type Ext = ();

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(_: &mut (), s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        HttpH::<SSL>::on_open(wrap::<SSL>(s));
    }
    fn on_data(_: &mut (), s: *mut us_socket_t, data: &[u8]) {
        HttpH::<SSL>::on_data(wrap::<SSL>(s), data);
    }
    fn on_writable(_: &mut (), s: *mut us_socket_t) {
        HttpH::<SSL>::on_writable(wrap::<SSL>(s));
    }
    fn on_close(_: &mut (), s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        HttpH::<SSL>::on_close(wrap::<SSL>(s), code, reason);
    }
    fn on_timeout(_: &mut (), s: *mut us_socket_t) {
        HttpH::<SSL>::on_timeout(wrap::<SSL>(s));
    }
    fn on_end(_: &mut (), s: *mut us_socket_t) {
        HttpH::<SSL>::on_end(wrap::<SSL>(s));
    }
    fn on_connect_error(_: &mut (), s: *mut us_socket_t, code: i32) {
        HttpH::<SSL>::on_connect_error(wrap::<SSL>(s), code);
    }
    fn on_connecting_error(cs: *mut ConnectingSocket, code: i32) {
        HttpH::<SSL>::on_connect_error(NewSocketHandler::<SSL>::from_connecting(cs), code);
    }
    fn on_handshake(_: &mut (), s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        HttpH::<SSL>::on_handshake(wrap::<SSL>(s), ok as i32, err);
    }
}

// ── WebSocket client ────────────────────────────────────────────────────────
pub(crate) type WSUpgradeClient<const SSL: bool> =
    websocket_upgrade_client::NewHttpUpgradeClient<SSL>;
pub(crate) type WSUpgrade<const SSL: bool> =
    RefPtrHandler<websocket_upgrade_client::NewHttpUpgradeClient<SSL>, SSL>;
pub(crate) type WSClient<const SSL: bool> = RefPtrHandler<websocket_client::WebSocket<SSL>, SSL>;

// ── SQL drivers ─────────────────────────────────────────────────────────────
pub(crate) type Postgres<const SSL: bool> = RefPtrHandler<postgres::PostgresSQLConnection, SSL>;
pub(crate) type MySQL<const SSL: bool> =
    RefPtrHandler<mysql::js_my_sql_connection::JSMySQLConnection, SSL>;

// ── Bun.spawn IPC / process.send() ──────────────────────────────────────────
// Ext is `*IPC.SendQueue` for both child-side `process.send` and parent-side
// `Bun.spawn({ipc})`. The IPC handlers are free functions, not
// methods on SendQueue, so we adapt manually here.
pub(crate) struct SpawnIPC;

use IPC::IPCHandlers::PosixSocket as IpcH;
type IpcS = NewSocketHandler<false>;

impl VHandler for SpawnIPC {
    type Ext = ExtSlot<IPC::SendQueue>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_FD: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;

    fn on_open(_ext: &mut Self::Ext, _s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {}
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_data(this, IpcS::from(s), data);
    }
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_fd(this, IpcS::from(s), fd);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_writable(this, IpcS::from(s));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_close(this, IpcS::from(s), code, reason);
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_timeout(this, IpcS::from(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_end(this, IpcS::from(s));
    }
}
