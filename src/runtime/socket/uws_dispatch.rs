//! Socket event dispatch. `loop.c` calls these `us_dispatch_*` exports for
//! every readable/writable/close/etc; we switch on `s->kind` and direct-call
//! the right Rust handler with the ext already typed. C++ kinds (uWS) and
//! `.dynamic` go through `s->group->vtable`.
//!
//! This file is the ONLY place that knows the kind→handler mapping. Adding a
//! kind to `SocketKind` forces a compile error here until every event has an
//! arm — no silent fallthrough.

use core::ffi::{c_int, c_void};

use bun_uws::{self as uws, NewSocketHandler};
// `SocketKind` / `us_bun_verify_error_t` must come from `bun_uws_sys` — that's
// what `us_socket_t::kind()` and the `VTable` callback signatures use. The
// `bun_uws` crate defines its own (distinct) mirrors of both; mixing them is a
// type error.
use bun_uws_sys::socket_group::VTable;
use bun_uws_sys::{us_bun_verify_error_t, us_socket_t, vtable, ConnectingSocket, SocketKind};

use super::uws_handlers as handlers;
use handlers::SocketEvents;

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
// once-init branch; once `vtable::make` is `const fn`, switch to a plain
// `static`/`const`.
//
// PORT NOTE: Zig used `std.EnumArray(SocketKind, ?*const VTable)`. `SocketKind`
// is `#[repr(u8)]` with dense 0..N discriminants (see uws/lib.rs), so a plain
// array indexed by `kind as usize` is the exact equivalent — no `enum_map`
// derive needed on the upstream type.
const SOCKET_KIND_COUNT: usize = SocketKind::UwsWsTls as usize + 1;

static TABLES: std::sync::LazyLock<[Option<&'static VTable>; SOCKET_KIND_COUNT]> =
    std::sync::LazyLock::new(|| {
        let mut t: [Option<&'static VTable>; SOCKET_KIND_COUNT] = [None; SOCKET_KIND_COUNT];

        // Bun.connect / Bun.listen
        t[SocketKind::BunSocketTcp as usize] = Some(vtable::make::<handlers::BunSocket<false>>());
        t[SocketKind::BunSocketTls as usize] = Some(vtable::make::<handlers::BunSocket<true>>());
        t[SocketKind::BunListenerTcp as usize] = Some(vtable::make::<handlers::BunListener<false>>());
        t[SocketKind::BunListenerTls as usize] = Some(vtable::make::<handlers::BunListener<true>>());

        // HTTP client thread
        t[SocketKind::HttpClient as usize] = Some(vtable::make::<handlers::HTTPClient<false>>());
        t[SocketKind::HttpClientTls as usize] = Some(vtable::make::<handlers::HTTPClient<true>>());

        // WebSocket client
        t[SocketKind::WsClientUpgrade as usize] = Some(vtable::make::<handlers::WSUpgrade<false>>());
        t[SocketKind::WsClientUpgradeTls as usize] = Some(vtable::make::<handlers::WSUpgrade<true>>());
        t[SocketKind::WsClient as usize] = Some(vtable::make::<handlers::WSClient<false>>());
        t[SocketKind::WsClientTls as usize] = Some(vtable::make::<handlers::WSClient<true>>());

        // SQL drivers
        t[SocketKind::Postgres as usize] = Some(vtable::make::<handlers::Postgres<false>>());
        t[SocketKind::PostgresTls as usize] = Some(vtable::make::<handlers::Postgres<true>>());
        t[SocketKind::Mysql as usize] = Some(vtable::make::<handlers::MySQL<false>>());
        t[SocketKind::MysqlTls as usize] = Some(vtable::make::<handlers::MySQL<true>>());
        t[SocketKind::Valkey as usize] = Some(vtable::make::<handlers::Valkey<false>>());
        t[SocketKind::ValkeyTls as usize] = Some(vtable::make::<handlers::Valkey<true>>());

        // IPC
        t[SocketKind::SpawnIpc as usize] = Some(vtable::make::<handlers::SpawnIPC>());

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
        _ => TABLES[kind as usize].expect("kind vtable"),
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
        _ => TABLES[kind as usize].expect("kind vtable"),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_open(
    s: *mut us_socket_t,
    is_client: c_int,
    ip: *mut u8,
    ip_len: c_int,
) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_open { unsafe { f(s, is_client, ip, ip_len) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_data(
    s: *mut us_socket_t,
    data: *mut u8,
    len: c_int,
) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_data { unsafe { f(s, data, len) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_fd(s: *mut us_socket_t, fd: c_int) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_fd { unsafe { f(s, fd) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_writable(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_writable { unsafe { f(s) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_close(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_close { unsafe { f(s, code, reason) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_timeout { unsafe { f(s) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_long_timeout(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_long_timeout { unsafe { f(s) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_end(s: *mut us_socket_t) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_end { unsafe { f(s) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_connect_error(s: *mut us_socket_t, code: c_int) -> *mut us_socket_t {
    if let Some(f) = vt(s).on_connect_error { unsafe { f(s, code) } } else { s }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_connecting_error(
    c: *mut ConnectingSocket,
    code: c_int,
) -> *mut ConnectingSocket {
    if let Some(f) = vtc(c).on_connecting_error { unsafe { f(c, code) } } else { c }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_dispatch_handshake(
    s: *mut us_socket_t,
    ok: c_int,
    err: us_bun_verify_error_t,
) {
    if let Some(f) = vt(s).on_handshake {
        unsafe { f(s, ok, err, core::ptr::null_mut()) };
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
    // `bun.jsc.API.NewSocket(true)` → the runtime-local `socket::NewSocket<true>`.
    type TLSSocket = super::NewSocket<true>;
    // SAFETY: ext slot for BunSocketTls always holds a non-null *mut TLSSocket
    // (stamped at construction); deref of both the slot and the pointer is sound.
    let tls: &mut TLSSocket = unsafe { &mut **(*s).ext::<*mut TLSSocket>() };
    if let Some(raw) = tls.twin {
        // SAFETY: `data` points to `len` readable bytes from the TLS BIO; loop.c
        // guarantees the buffer outlives this call.
        let slice = unsafe {
            core::slice::from_raw_parts(data, usize::try_from(len).expect("len >= 0"))
        };
        // Zig: `raw.onData(TLSSocket.Socket.from(s), data[..])` where
        // `Socket = uws.NewSocketHandler(ssl)`. SAFETY: `twin` is the unique
        // heap owner of the `[raw, _]` half; dispatch is single-threaded.
        let _ = unsafe { &mut *raw }.on_data(NewSocketHandler::<true>::from(s), slice);
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
