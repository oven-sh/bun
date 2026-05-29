//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `on_open`/`on_data`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` shim those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. It replaces the
//! old `NewSocketHandler.configure`/`unsafeConfigure` machinery, which built
//! the same trampolines at runtime per `us_socket_context_t`.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_uws::{ConnectingSocket, NewSocketHandler};
use bun_uws_sys::thunk;
use bun_uws_sys::thunk::ExtSlot;
use bun_uws_sys::vtable::Handler as VHandler;
use bun_uws_sys::{CloseCode, us_bun_verify_error_t, us_socket_t};

use crate::api;
use crate::valkey_jsc::js_valkey;
use bun_http_jsc::websocket_client;
use bun_http_jsc::websocket_client::websocket_upgrade_client;
use bun_jsc::ipc as IPC;
use bun_sql_jsc::mysql;
use bun_sql_jsc::postgres;

#[inline]
fn swallow<R: Swallow>(result: R) {
    result.swallow();
}

trait Swallow {
    fn swallow(self);
}
impl Swallow for () {
    #[inline]
    fn swallow(self) {}
}
impl<E> Swallow for Result<(), E> {
    #[inline]
    fn swallow(self) {
        let _ = self;
    }
}

pub trait SocketEvents<const SSL: bool> {
    fn on_open(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_data(&mut self, _s: NewSocketHandler<SSL>, _data: &[u8]) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_writable(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_close(
        &mut self,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_timeout(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_long_timeout(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_end(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_connect_error(&mut self, _s: NewSocketHandler<SSL>, _code: i32) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_handshake(
        &mut self,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: us_bun_verify_error_t,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_fd(&mut self, _s: NewSocketHandler<SSL>, _fd: c_int) -> bun_jsc::JsResult<()> {
        Ok(())
    }
}

pub struct PtrHandler<T, const SSL: bool>(core::marker::PhantomData<T>);

#[inline(always)]
fn wrap<const SSL: bool>(s: *mut us_socket_t) -> NewSocketHandler<SSL> {
    NewSocketHandler::<SSL>::from(s)
}

impl<T, const SSL: bool> VHandler for PtrHandler<T, SSL>
where
    T: SocketEvents<SSL> + 'static,
{
    /// `?*T` — the slot lives in C-allocated (`calloc`) memory; the trampoline
    /// hands it to us by `&mut`. `ExtSlot<T>` (vs. raw `Option<NonNull<T>>`)
    /// encodes the non-re-entrancy contract so `owner_mut()` is a safe call.
    type Ext = ExtSlot<T>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;
    const HAS_ON_FD: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_open(wrap::<SSL>(s)));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_data(wrap::<SSL>(s), data));
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_writable(wrap::<SSL>(s)));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_close(wrap::<SSL>(s), code, reason));
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_timeout(wrap::<SSL>(s)));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_long_timeout(wrap::<SSL>(s)));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_end(wrap::<SSL>(s)));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        let this = ext.get();
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        // SAFETY: snapshot of the ext slot taken before close; unique heap
        // owner, single-threaded dispatch (same contract as `ExtSlot::owner_mut`,
        // but the slot storage may have been freed by `close` so we deref the
        // snapshot rather than re-borrowing `ext`).
        if let Some(t) = unsafe { thunk::ext_owner(&this) } {
            swallow(t.on_connect_error(wrap::<SSL>(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let Some(this) = ConnectingSocket::opaque_mut(c)
            .ext::<ExtSlot<T>>()
            .owner_mut()
        else {
            return;
        };
        swallow(this.on_connect_error(NewSocketHandler::<SSL>::from_connecting(c), code));
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_handshake(wrap::<SSL>(s), ok as i32, err));
    }
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_fd(wrap::<SSL>(s), fd));
    }
}

pub trait RawSocketEvents<const SSL: bool>: Sized {
    const HAS_ON_OPEN: bool = false;

    unsafe fn on_open(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_data(_this: *mut Self, _s: NewSocketHandler<SSL>, _data: &[u8]) {}
    unsafe fn on_writable(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_close(
        _this: *mut Self,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: *mut c_void,
    ) {
    }
    unsafe fn on_timeout(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_long_timeout(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_end(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_connect_error(_this: *mut Self, _s: NewSocketHandler<SSL>, _code: i32) {}
    unsafe fn on_handshake(
        _this: *mut Self,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: bun_uws::us_bun_verify_error_t,
    ) {
    }
}

pub struct RawPtrHandler<T, const SSL: bool>(core::marker::PhantomData<T>);

impl<T, const SSL: bool> VHandler for RawPtrHandler<T, SSL>
where
    T: RawSocketEvents<SSL> + 'static,
{
    type Ext = Option<NonNull<T>>;

    const HAS_ON_OPEN: bool = T::HAS_ON_OPEN;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = *ext else { return };
        // SAFETY: ext slot holds the unique heap owner; single-threaded dispatch.
        unsafe { T::on_open(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_data(this.as_ptr(), wrap::<SSL>(s), data) };
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_writable(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe {
            T::on_close(
                this.as_ptr(),
                wrap::<SSL>(s),
                code,
                reason.unwrap_or(core::ptr::null_mut()),
            )
        };
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_timeout(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_long_timeout(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_end(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close first, then notify — see `PtrHandler::on_connect_error`.
        let this = *ext;
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        if let Some(t) = this {
            // SAFETY: see `on_open`.
            unsafe { T::on_connect_error(t.as_ptr(), wrap::<SSL>(s), code) };
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let Some(this) = *ConnectingSocket::opaque_mut(c).ext::<Option<NonNull<T>>>() else {
            return;
        };
        // SAFETY: see `on_open`.
        unsafe {
            T::on_connect_error(
                this.as_ptr(),
                NewSocketHandler::<SSL>::from_connecting(c),
                code,
            )
        };
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_handshake(this.as_ptr(), wrap::<SSL>(s), ok as i32, err) };
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_upgrade_client::NewHttpUpgradeClient<SSL> {
    const HAS_ON_OPEN: bool = true;

    unsafe fn on_open(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: caller upholds the `RawSocketEvents` contract — `this` is the
        // live unique ext-slot owner under single-threaded dispatch; `handle_*`
        // has the same precondition on `this`.
        unsafe { Self::handle_open(this, s) }
    }
    unsafe fn on_data(this: *mut Self, s: NewSocketHandler<SSL>, data: &[u8]) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_data(this, s, data) }
    }
    unsafe fn on_writable(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_writable(this, s) }
    }
    unsafe fn on_close(this: *mut Self, s: NewSocketHandler<SSL>, code: i32, reason: *mut c_void) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_close(this, s, code, reason) }
    }
    unsafe fn on_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_timeout(this, s) }
    }
    unsafe fn on_long_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_timeout(this, s) }
    }
    unsafe fn on_end(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_end(this, s) }
    }
    unsafe fn on_connect_error(this: *mut Self, s: NewSocketHandler<SSL>, code: i32) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_connect_error(this, s, code) }
    }
    unsafe fn on_handshake(
        this: *mut Self,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        // SAFETY: see `on_open`.
        unsafe { Self::handle_handshake(this, s, ok, err) }
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_client::WebSocket<SSL> {
    // Zig: no `onOpen` decl — adoption of an already-connected socket.

    unsafe fn on_data(this: *mut Self, _s: NewSocketHandler<SSL>, data: &[u8]) {
        // SAFETY: caller upholds the `RawSocketEvents` contract — `this` points
        // to the live unique ext-slot owner under single-threaded dispatch, so
        // it is valid to forward/dereference here.
        unsafe { Self::handle_data(this, data) }
    }
    unsafe fn on_writable(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_data`.
        unsafe { (*this).handle_writable(s) }
    }
    unsafe fn on_close(this: *mut Self, s: NewSocketHandler<SSL>, code: i32, reason: *mut c_void) {
        // SAFETY: see `on_data`.
        unsafe { (*this).handle_close(s, code, reason) }
    }
    unsafe fn on_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_data`.
        unsafe { (*this).handle_timeout(s) }
    }
    unsafe fn on_long_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_data`.
        unsafe { (*this).handle_timeout(s) }
    }
    unsafe fn on_end(this: *mut Self, s: NewSocketHandler<SSL>) {
        // SAFETY: see `on_data`.
        unsafe { (*this).handle_end(s) }
    }
    unsafe fn on_connect_error(this: *mut Self, s: NewSocketHandler<SSL>, code: i32) {
        // SAFETY: see `on_data`.
        unsafe { (*this).handle_connect_error(s, code) }
    }
    unsafe fn on_handshake(
        this: *mut Self,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        // SAFETY: see `on_data`.
        unsafe { (*this).handle_handshake(s, ok, err) }
    }
}

macro_rules! impl_ns_socket_events_forward {
    ($Owner:ty, $Handler:ty) => {
        impl<const SSL: bool> NsSocketEvents<$Owner, SSL> for $Handler {
            fn on_open(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_open(this, s));
                Ok(())
            }
            fn on_data(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                data: &[u8],
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_data(this, s, data));
                Ok(())
            }
            fn on_writable(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_writable(this, s));
                Ok(())
            }
            fn on_close(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
                reason: Option<*mut c_void>,
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_close(this, s, code, reason));
                Ok(())
            }
            fn on_timeout(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_timeout(this, s));
                Ok(())
            }
            fn on_end(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_end(this, s));
                Ok(())
            }
            fn on_connect_error(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_connect_error(this, s, code));
                Ok(())
            }
            fn on_handshake(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                ok: i32,
                err: us_bun_verify_error_t,
            ) -> bun_jsc::JsResult<()> {
                if let Some(f) = Self::ON_HANDSHAKE {
                    swallow(f(this, s, ok, err));
                }
                Ok(())
            }
        }
    };
}

impl_ns_socket_events_forward!(
    postgres::PostgresSQLConnection,
    postgres::postgres_sql_connection::SocketHandler<SSL>
);
impl_ns_socket_events_forward!(
    mysql::js_my_sql_connection::JSMySQLConnection,
    mysql::js_my_sql_connection::SocketHandler<SSL>
);
impl_ns_socket_events_forward!(js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>);

pub type BunSocket<const SSL: bool> = RawPtrHandler<api::NewSocket<SSL>, SSL>;

pub struct BunListener<const SSL: bool>;

impl<const SSL: bool> VHandler for BunListener<SSL>
where
    api::NewSocket<SSL>: RawSocketEvents<SSL>,
{
    // No `Ext` decl — owner comes from `s.group().owner(Listener)`.
    type Ext = ();
    const HAS_EXT: bool = false;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open_no_ext(s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
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
        let ns = api::Listener::on_create::<SSL>(unsafe { &*listener }, wrap::<SSL>(s));
        // SAFETY: `on_create` returns a freshly-boxed `NewSocket`; the `*mut`
        // `on_*` methods hold no `&mut NewSocket` across re-entrant JS calls.
        unsafe { api::NewSocket::on_open(ns, wrap::<SSL>(s)) };
    }
    // Accepted sockets reach the remaining events as `.bun_socket_*` once
    // on_create has restamped them; if anything fires before that, route to
    // the freshly stashed NewSocket.
    fn on_close_no_ext(s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<NonNull<api::NewSocket<SSL>>>>()
        {
            // SAFETY: `ns` is the live heap `NewSocket` stashed by `on_create`;
            // dispatch is single-threaded. The raw-pointer `on_*` may free it,
            // so dispatch via `*mut` only — never form `&mut NewSocket`.
            // Applies to every ext-slot read in this impl.
            swallow(unsafe { api::NewSocket::on_close(ns.as_ptr(), wrap::<SSL>(s), code, reason) });
        }
    }
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<NonNull<api::NewSocket<SSL>>>>()
        {
            // SAFETY: see `on_close_no_ext`.
            unsafe { api::NewSocket::on_data(ns.as_ptr(), wrap::<SSL>(s), data) };
        }
    }
    fn on_writable_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<NonNull<api::NewSocket<SSL>>>>()
        {
            // SAFETY: see `on_close_no_ext`.
            unsafe { api::NewSocket::on_writable(ns.as_ptr(), wrap::<SSL>(s)) };
        }
    }
    fn on_end_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<NonNull<api::NewSocket<SSL>>>>()
        {
            // SAFETY: see `on_close_no_ext`.
            unsafe { api::NewSocket::on_end(ns.as_ptr(), wrap::<SSL>(s)) };
        }
    }
    fn on_timeout_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<NonNull<api::NewSocket<SSL>>>>()
        {
            // SAFETY: see `on_close_no_ext`.
            unsafe { api::NewSocket::on_timeout(ns.as_ptr(), wrap::<SSL>(s)) };
        }
    }
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<NonNull<api::NewSocket<SSL>>>>()
        {
            // SAFETY: see `on_close_no_ext`.
            swallow(unsafe {
                api::NewSocket::on_handshake(ns.as_ptr(), wrap::<SSL>(s), ok as i32, err)
            });
        }
    }
}

pub trait NsSocketEvents<Owner, const SSL: bool> {
    fn on_open(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_data(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _data: &[u8],
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_writable(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_close(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_timeout(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_long_timeout(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_end(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_connect_error(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _code: i32,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    /// Zig guarded this with `@TypeOf(H.onHandshake) != @TypeOf(null)` — i.e.
    /// some adapters explicitly set `onHandshake = null`. Default no-op covers
    /// that case.
    fn on_handshake(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: us_bun_verify_error_t,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
}

pub struct NsHandler<Owner, H, const SSL: bool>(core::marker::PhantomData<(Owner, H)>);

impl<Owner, H, const SSL: bool> VHandler for NsHandler<Owner, H, SSL>
where
    Owner: 'static,
    H: NsSocketEvents<Owner, SSL> + 'static,
{
    type Ext = ExtSlot<Owner>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_open(this, wrap::<SSL>(s)));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_data(this, wrap::<SSL>(s), data));
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_writable(this, wrap::<SSL>(s)));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_close(this, wrap::<SSL>(s), code, reason));
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_timeout(this, wrap::<SSL>(s)));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_long_timeout(this, wrap::<SSL>(s)));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_end(this, wrap::<SSL>(s)));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close before notify — see PtrHandler::on_connect_error.
        let this = ext.get();
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        // SAFETY: snapshot of the ext slot taken before close; unique heap
        // owner, single-threaded dispatch (same contract as `ExtSlot::owner_mut`).
        if let Some(t) = unsafe { thunk::ext_owner(&this) } {
            swallow(H::on_connect_error(t, wrap::<SSL>(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let Some(this) = ConnectingSocket::opaque_mut(c)
            .ext::<ExtSlot<Owner>>()
            .owner_mut()
        else {
            return;
        };
        swallow(H::on_connect_error(
            this,
            NewSocketHandler::<SSL>::from_connecting(c),
            code,
        ));
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_handshake(this, wrap::<SSL>(s), ok as i32, err));
    }
}

pub struct HTTPClient<const SSL: bool>;

type HttpH<const SSL: bool> = bun_http::http_context::Handler<SSL>;

impl<const SSL: bool> VHandler for HTTPClient<SSL> {
    type Ext = Option<NonNull<c_void>>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // The word read out is a packed `ActiveSocket` tagged-pointer value,
        // not dereferenced here.
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_open(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_data(owner.as_ptr(), wrap::<SSL>(s), data);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_writable(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_close(owner.as_ptr(), wrap::<SSL>(s), code, reason);
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_timeout(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_long_timeout(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_end(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close before notify — see PtrHandler::on_connect_error. SEMI_SOCKET
        // close skips dispatch, so the tagged owner survives the close.
        let owner = *ext;
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        let Some(owner) = owner else { return };
        HttpH::<SSL>::on_connect_error(owner.as_ptr(), wrap::<SSL>(s), code);
    }
    fn on_connecting_error(cs: *mut ConnectingSocket, code: i32) {
        let Some(owner) = *ConnectingSocket::opaque_mut(cs).ext::<Option<NonNull<c_void>>>() else {
            return;
        };
        HttpH::<SSL>::on_connect_error(
            owner.as_ptr(),
            NewSocketHandler::<SSL>::from_connecting(cs),
            code,
        );
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_handshake(owner.as_ptr(), wrap::<SSL>(s), ok as i32, err);
    }
}

// ── WebSocket client ────────────────────────────────────────────────────────
pub type WSUpgrade<const SSL: bool> =
    RawPtrHandler<websocket_upgrade_client::NewHttpUpgradeClient<SSL>, SSL>;
pub type WSClient<const SSL: bool> = RawPtrHandler<websocket_client::WebSocket<SSL>, SSL>;

// ── SQL drivers ─────────────────────────────────────────────────────────────
pub type Postgres<const SSL: bool> = NsHandler<
    postgres::PostgresSQLConnection,
    postgres::postgres_sql_connection::SocketHandler<SSL>,
    SSL,
>;
pub type MySQL<const SSL: bool> = NsHandler<
    mysql::js_my_sql_connection::JSMySQLConnection,
    mysql::js_my_sql_connection::SocketHandler<SSL>,
    SSL,
>;
pub type Valkey<const SSL: bool> =
    NsHandler<js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>, SSL>;

pub struct SpawnIPC;

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
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_data(this, IpcS::from(s), data);
    }
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_fd(this, IpcS::from(s), fd);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_writable(this, IpcS::from(s));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_close(this, IpcS::from(s), code, reason);
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_timeout(this, IpcS::from(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_end(this, IpcS::from(s));
    }
}

// ported from: src/runtime/socket/uws_handlers.zig
