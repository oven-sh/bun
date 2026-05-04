//! Socket event dispatch. `loop.c` calls these `us_dispatch_*` exports for
//! every readable/writable/close/etc; we switch on `s->kind` and direct-call
//! the right Rust handler with the ext already typed. C++ kinds (uWS) and
//! `.dynamic` go through `s->group->vtable`.
//!
//! This file is the ONLY place that knows the kind→handler mapping. Adding a
//! kind to `SocketKind` forces a compile error here until every event has an
//! arm — no silent fallthrough.

use core::ffi::{c_int, c_void};

use enum_map::EnumMap;

use bun_uws::{self as uws, us_bun_verify_error_t, us_socket_t, ConnectingSocket, SocketKind};
// TODO(port): confirm exact path for SocketGroup::VTable in bun_uws
use bun_uws::socket_group::VTable;
use bun_uws_sys::vtable;

use super::uws_handlers as handlers;

// (Zig had a `comptime { _ = us_dispatch_*; }` force-reference block here to
// keep the exports in the link even if nothing in Zig calls them. Rust links
// every `#[no_mangle] pub extern "C"` symbol unconditionally, so it is dropped.)

/// kind → vtable. Rust kinds get a comptime-generated `Trampolines<H>` vtable
/// (so the call is *still* indirect by one pointer, but the table itself is
/// `.rodata` and there's exactly one per kind — not one per connection). C++
/// kinds use the per-group vtable since the handler closure differs per App.
///
/// `Invalid` is intentionally null so a missed `kind` stamp crashes here
/// instead of dispatching into the wrong handler.
// PERF(port): Zig built this at comptime into .rodata. `LazyLock` adds a
// once-init branch; once `vtable::make` is `const fn` and EnumMap supports
// const construction, switch to a plain `static`/`const`.
static TABLES: std::sync::LazyLock<EnumMap<SocketKind, Option<&'static VTable>>> =
    std::sync::LazyLock::new(|| {
        let mut t: EnumMap<SocketKind, Option<&'static VTable>> = EnumMap::default();

        // Bun.connect / Bun.listen
        t[SocketKind::BunSocketTcp] = Some(vtable::make::<handlers::BunSocket<false>>());
        t[SocketKind::BunSocketTls] = Some(vtable::make::<handlers::BunSocket<true>>());
        t[SocketKind::BunListenerTcp] = Some(vtable::make::<handlers::BunListener<false>>());
        t[SocketKind::BunListenerTls] = Some(vtable::make::<handlers::BunListener<true>>());

        // HTTP client thread
        t[SocketKind::HttpClient] = Some(vtable::make::<handlers::HTTPClient<false>>());
        t[SocketKind::HttpClientTls] = Some(vtable::make::<handlers::HTTPClient<true>>());

        // WebSocket client
        t[SocketKind::WsClientUpgrade] = Some(vtable::make::<handlers::WSUpgrade<false>>());
        t[SocketKind::WsClientUpgradeTls] = Some(vtable::make::<handlers::WSUpgrade<true>>());
        t[SocketKind::WsClient] = Some(vtable::make::<handlers::WSClient<false>>());
        t[SocketKind::WsClientTls] = Some(vtable::make::<handlers::WSClient<true>>());

        // SQL drivers
        t[SocketKind::Postgres] = Some(vtable::make::<handlers::Postgres<false>>());
        t[SocketKind::PostgresTls] = Some(vtable::make::<handlers::Postgres<true>>());
        t[SocketKind::Mysql] = Some(vtable::make::<handlers::MySQL<false>>());
        t[SocketKind::MysqlTls] = Some(vtable::make::<handlers::MySQL<true>>());
        t[SocketKind::Valkey] = Some(vtable::make::<handlers::Valkey<false>>());
        t[SocketKind::ValkeyTls] = Some(vtable::make::<handlers::Valkey<true>>());

        // IPC
        t[SocketKind::SpawnIpc] = Some(vtable::make::<handlers::SpawnIPC>());

        t
    });

#[inline]
fn vt(s: *mut us_socket_t) -> &'static VTable {
    // SAFETY: `s` is non-null — loop.c only dispatches live sockets.
    let s = unsafe { &*s };
    let kind = s.kind();
    match kind {
        SocketKind::Invalid => {
            // TODO(port): bun.Output.panic formatting (group={*})
            panic!("us_socket_t with kind=invalid (group={:p})", s.raw_group())
        }
        // Per-group vtable: uWS C++ installs a different `HttpContext<SSL>*`
        // closure per server, so the table can't be static per kind.
        SocketKind::Dynamic
        | SocketKind::UwsHttp
        | SocketKind::UwsHttpTls
        | SocketKind::UwsWs
        | SocketKind::UwsWsTls => {
            // SAFETY: raw_group() is non-null for any socket with a valid kind.
            unsafe { (*s.raw_group()).vtable.expect("group vtable") }
        }
        _ => TABLES[kind].expect("kind vtable"),
    }
}

#[inline]
fn vtc(c: *mut ConnectingSocket) -> &'static VTable {
    // SAFETY: `c` is non-null — loop.c only dispatches live connecting sockets.
    let c = unsafe { &*c };
    let kind = c.kind();
    match kind {
        SocketKind::Invalid => {
            // TODO(port): bun.Output.panic formatting
            panic!("us_connecting_socket_t with kind=invalid")
        }
        SocketKind::Dynamic
        | SocketKind::UwsHttp
        | SocketKind::UwsHttpTls
        | SocketKind::UwsWs
        | SocketKind::UwsWsTls => {
            // SAFETY: raw_group() is non-null for any socket with a valid kind.
            unsafe { (*c.raw_group()).vtable.expect("group vtable") }
        }
        _ => TABLES[kind].expect("kind vtable"),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_open(
    s: *mut us_socket_t,
    is_client: c_int,
    ip: *mut u8,
    ip_len: c_int,
) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_open { f(s, is_client, ip, ip_len) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_data(
    s: *mut us_socket_t,
    data: *mut u8,
    len: c_int,
) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_data { f(s, data, len) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_fd { f(s, fd) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_writable(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_writable { f(s) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_close(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_close { f(s, code, reason) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_timeout { f(s) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_long_timeout { f(s) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_end(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_end { f(s) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_connect_error(s: *mut us_socket_t, code: c_int) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_connect_error { f(s, code) } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_connecting_error(
    c: *mut ConnectingSocket,
    code: c_int,
) -> *mut ConnectingSocket {
    if let Some(f) = vtc(c).on_connecting_error { f(c, code) } else { c }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_handshake(
    s: *mut us_socket_t,
    ok: c_int,
    err: us_bun_verify_error_t,
) {
    if let Some(f) = vt(s).on_handshake {
        f(s, ok, err, core::ptr::null_mut());
    }
}

/// Ciphertext tap for `socket.upgradeTLS()` — fires on the `[raw, _]` half of
/// the returned pair before decryption. Only `bun_socket_tls` ever sets the
/// `ssl_raw_tap` bit, so this isn't part of the per-kind vtable.
#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_ssl_raw_tap(
    s: *mut us_socket_t,
    data: *mut u8,
    len: c_int,
) -> *mut us_socket_t {
    // SAFETY: `s` is non-null per loop.c contract.
    debug_assert!(unsafe { (*s).kind() } == SocketKind::BunSocketTls);
    // TODO(port): confirm path for `bun.jsc.API.NewSocket(true)` (TLS socket payload type)
    type TLSSocket = bun_jsc::api::NewSocket<true>;
    // SAFETY: ext slot for BunSocketTls always holds a non-null *mut TLSSocket
    // (stamped at construction); deref of both the slot and the pointer is sound.
    let tls: &mut TLSSocket = unsafe { &mut **(*s).ext::<*mut TLSSocket>() };
    if let Some(raw) = tls.twin {
        // SAFETY: `data` points to `len` readable bytes from the TLS BIO; loop.c
        // guarantees the buffer outlives this call.
        let slice = unsafe {
            core::slice::from_raw_parts(data, usize::try_from(len).expect("len >= 0"))
        };
        raw.on_data(<TLSSocket as uws::SocketWrapper>::Socket::from(s), slice);
        // TODO(port): verify `TLSSocket::Socket::from(s)` path — Zig: `TLSSocket.Socket.from(s)`
    }
    s
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/uws_dispatch.zig (142 lines)
//   confidence: medium
//   todos:      4
//   notes:      TABLES uses LazyLock (Zig was comptime .rodata); VTable/NewSocket import paths need Phase-B confirmation
// ──────────────────────────────────────────────────────────────────────────
