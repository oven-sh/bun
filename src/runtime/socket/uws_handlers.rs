//! Protocol v2 adapter for the `Bun.listen`/`Bun.connect` socket kinds.
//!
//! The core trampoline recovers the owner type-safely, holds a strong ref
//! across every handler call, and releases its ext-held owner ref exactly
//! once at the terminal (on_close / on_connect_error / silent SEMI_SOCKET
//! close) — so none of the old raw-ext machinery (`RawPtrHandler`,
//! `NsHandler`, `BunListener`, `SpawnIPC`) survives here: every other
//! consumer now owns its own `uws::Protocol` impl in its own crate.

use bun_usockets as uws;

use crate::api;

/// Extract the SSL-typed handle the legacy `NewSocket::on_*` methods expect
/// (kind stamp and `SSL` always agree for these kinds).
#[inline(always)]
fn sock<const SSL: bool>(s: uws::AnySocket) -> uws::NewSocketHandler<SSL> {
    uws::NewSocketHandler::<SSL> { socket: *s.socket() }
}

/// Rebuild the overloaded v1 close code (0/1/2 = self-initiated CloseCode,
/// >2 = real read/poll errno — contract C3) for `NewSocket::on_close`.
#[inline(always)]
fn wire_close_code(code: uws::CloseCode2, errno: i32) -> i32 {
    match code {
        uws::CloseCode2::Normal => 0,
        uws::CloseCode2::Failure => 1,
        uws::CloseCode2::FastShutdown => 2,
        uws::CloseCode2::Error => errno,
    }
}

/// Protocol v2 handler set for `api::NewSocket<SSL>`. The core-held dispatch
/// guard pins the owner for the whole handler frame, so `&Owner` is live;
/// `this_ptr_of` bridges to the legacy `ThisPtr`-shaped methods (still
/// invoked manually by the duplex / named-pipe / upgradeTLS-twin paths).
pub struct BunSocket<const SSL: bool>;

impl<const SSL: bool> uws::Protocol for BunSocket<SSL> {
    type Owner = api::NewSocket<SSL>;
    const KIND: uws::SocketKind = if SSL {
        uws::SocketKind::BunSocketTls
    } else {
        uws::SocketKind::BunSocketTcp
    };

    fn on_open(o: &Self::Owner, s: uws::AnySocket, _is_client: bool, _ip: &[u8]) {
        api::NewSocket::on_open(uws::this_ptr_of(o), sock::<SSL>(s));
    }
    fn on_data(o: &Self::Owner, s: uws::AnySocket, data: &mut [u8]) {
        api::NewSocket::on_data(uws::this_ptr_of(o), sock::<SSL>(s), data);
    }
    fn on_writable(o: &Self::Owner, s: uws::AnySocket) {
        api::NewSocket::on_writable(uws::this_ptr_of(o), sock::<SSL>(s));
    }
    fn on_close(o: &Self::Owner, s: uws::AnySocket, code: uws::CloseCode2, errno: i32) {
        // Legacy `on_close` consumes one ref (the convention shared with the
        // manual duplex/named-pipe/twin callers, which transfer a +1 in).
        // Take that ref here: core releases its OWN ext-held owner ref after
        // this returns, so the two conventions stay balanced.
        o.ref_();
        let _ = api::NewSocket::on_close(
            uws::this_ptr_of(o),
            sock::<SSL>(s),
            wire_close_code(code, errno),
            None,
        );
    }
    fn on_timeout(o: &Self::Owner, s: uws::AnySocket) {
        api::NewSocket::on_timeout(uws::this_ptr_of(o), sock::<SSL>(s));
    }
    fn on_end(o: &Self::Owner, s: uws::AnySocket) {
        api::NewSocket::on_end(uws::this_ptr_of(o), sock::<SSL>(s));
    }
    fn on_connect_error(o: &Self::Owner, err: uws::ConnectFailure) {
        // The owner-held handle is the only route to the socket here.
        let s = o.socket.get();
        let dns_error = s.dns_error();
        // Close FIRST, then notify — the handler may re-enter `connectInner`
        // synchronously (node:net autoSelectFamily); on Windows/libuv a new
        // attempt started before this half-open one is closed hangs. Safe:
        // SEMI_SOCKET / already-closed-connecting closes dispatch nothing (C1).
        s.close(uws::CloseCode::Failure);
        // Same +1 bridge as `on_close`: `handle_connect_error` consumes one
        // ref exactly when the owner-held handle is still attached
        // (`needs_deref`), and core releases its own ext ref after we return.
        if !s.is_detached() {
            o.ref_();
        }
        let _ = api::NewSocket::handle_connect_error(uws::this_ptr_of(o), err.errno, dns_error);
    }
    fn on_handshake(o: &Self::Owner, s: uws::AnySocket, ok: bool, err: uws::VerifyError) {
        let _ = api::NewSocket::on_handshake(uws::this_ptr_of(o), sock::<SSL>(s), ok as i32, err);
    }
    // on_long_timeout / on_fd: default no-ops (never armed for Bun sockets).
}
