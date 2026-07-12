//! extern "C" surface for surviving C/C++ consumers (uWS headers, the
//! libuwsockets shims, quic.c, NodeTLS.cpp, JSNodeHTTPServerSocket, webview
//! backends). Signatures per docs/cabi.md §1 + §9.1 ("minimal surface");
//! includes the 3 helpers moved out of the SHIM (§9.3) and the 5 accessor
//! patches from §9.2 (us_socket_t / us_listen_socket_t / us_loop_t are opaque
//! to all surviving C/C++; only us_socket_group_t stays public repr(C)).
//!
//! `us_raw_root_certs` / `us_get_root_{extra,system}_cert_instances` /
//! `us_get_default_ca_store` are NOT exported here: root_certs*.cpp survive
//! as C++ TUs and keep those symbols (docs/cabi.md §1.7).
//!
//! Feature-gated OFF by default: with the C core still compiled in this
//! tree, these `#[no_mangle]` symbols would collide at link time. The
//! change that deletes the C flips the `cabi` feature on — and
//! must delete the identically-named `BUN_SOCKET_KIND_*` statics in
//! `src/uws_sys/SocketKind.rs` in the same change (duplicate Rust symbols).

use core::ffi::{CStr, c_char, c_int, c_uchar, c_uint, c_ushort, c_void};
use core::ptr;

use crate::connecting;
use crate::group::{SocketGroup, VTable};
use crate::handle::ListenSocket;
use crate::loop_::Loop;
use crate::socket::us_socket_t;
use crate::tls::Transport;
use crate::tls::context::{BunSocketContextOptions, SslCtx, create_bun_socket_error_t};
use crate::udp;
use crate::unsafe_core::{ext, ffi, io};
use crate::{LIBUS_SOCKET_DESCRIPTOR, SocketKind};

// ── opaque C types with no Rust-side definition ──────────────────────────────

/// `us_poll_t` — opaque here; the only surviving callers are quic.c's
/// `us_poll_fd`/`us_poll_change` on `us_udp_socket_poll` handles
/// (docs/cabi.md §3.4). Layout contract: `udp::Socket` (repr(C)) stores
/// the fd at offset 0 — asserted at [`us_poll_fd`].
#[repr(C)]
pub struct us_poll_t {
    _opaque: [u8; 0],
}

/// `uws_res_t` — C++ HttpResponse handle (identity-cast of us_socket_t).
#[repr(C)]
pub struct uws_res_t {
    _opaque: [u8; 0],
}

pub type LoopCb = unsafe extern "C" fn(*mut Loop);

// ── boundary helpers (length checks, nullable lowering) ─────────────────────

/// `(ptr, c_int len)` → byte slice; null/non-positive lengths become empty.
unsafe fn byte_slice<'a>(data: *const c_char, len: c_int) -> &'a [u8] {
    // SAFETY: caller passes a buffer valid for `len` bytes when non-null.
    unsafe { ext::c_slice(data.cast_mut().cast::<u8>(), usize::try_from(len).unwrap_or(0)) }
}

unsafe fn opt_cstr<'a>(p: *const c_char) -> Option<&'a CStr> {
    // SAFETY: caller passes a NUL-terminated string when non-null.
    (!p.is_null()).then(|| unsafe { CStr::from_ptr(p) })
}

fn opt_ctx(p: *mut SslCtx) -> Option<*mut SslCtx> {
    (!p.is_null()).then_some(p)
}

/// C++ passes the `BUN_SOCKET_KIND_*` statics; anything outside the closed
/// 0..=22 world is rejected (a rogue value in a `#[repr(u8)]` enum is UB).
fn kind_from_c(kind: c_uchar) -> Option<SocketKind> {
    (kind <= SocketKind::UwsWsTls as u8).then(|| SocketKind::from_u8(kind))
}

// ── §9.1 Loop (6) ─────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn us_create_loop(
    hint: *mut c_void,
    wakeup_cb: Option<LoopCb>,
    pre_cb: Option<LoopCb>,
    post_cb: Option<LoopCb>,
    ext_size: c_uint,
) -> *mut Loop {
    // SAFETY: seam allocates loop + ext and installs the runtime callbacks.
    unsafe { ffi::create_loop_raw(hint, wakeup_cb, pre_cb, post_cb, ext_size as usize) }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_loop_free(loop_: *mut Loop) {
    // SAFETY: caller passes a loop from us_create_loop, not yet freed.
    unsafe { ffi::free_loop_raw(loop_) }
}

/// Pointer just past `us_loop_t`, 16-aligned, stable for the loop lifetime
/// (uWS::LoopData lives there — hottest accessor in uWS). C: `loop + 1`.
#[unsafe(no_mangle)]
pub extern "C" fn us_loop_ext(loop_: *mut Loop) -> *mut c_void {
    const {
        assert!(core::mem::size_of::<Loop>() % crate::LIBUS_EXT_ALIGNMENT == 0);
    }
    // SAFETY: us_create_loop allocates ext_size bytes directly after the Loop.
    unsafe { loop_.add(1).cast::<c_void>() }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_loop_run(loop_: *mut Loop) {
    crate::loop_::wakeup::us_loop_run(loop_)
}

/// The ONLY thread-safe entry point (docs/cabi.md §9.3.4).
#[unsafe(no_mangle)]
pub extern "C" fn us_wakeup_loop(loop_: *mut Loop) {
    crate::loop_::wakeup::us_wakeup_loop(loop_)
}

/// C no-op (loop.c:920 — timers are controlled dynamically by socket count).
#[unsafe(no_mangle)]
pub extern "C" fn us_loop_integrate(_loop: *mut Loop) {}

// §9.2.5 quic.c loop-field accessors (us_loop_t is opaque to surviving C).

/// QUIC live-conn keep-alive (POSIX only — the libuv path holds a uv poll).
#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub extern "C" fn us_loop_poll_count_add(loop_: *mut Loop, delta: c_int) {
    // SAFETY: nonnull loop contract.
    unsafe { (*loop_).num_polls += delta };
}

#[unsafe(no_mangle)]
pub extern "C" fn us_internal_loop_quic_head(loop_: *mut Loop) -> *mut c_void {
    // SAFETY: nonnull loop contract.
    unsafe { (*loop_).internal_loop_data.quic_head }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_internal_loop_quic_head_set(loop_: *mut Loop, head: *mut c_void) {
    // SAFETY: nonnull loop contract.
    unsafe { (*loop_).internal_loop_data.quic_head = head };
}

/// Relative-µs engine deadline folded into the poll wait; -1 = none.
#[unsafe(no_mangle)]
pub extern "C" fn us_internal_loop_quic_next_tick_set(
    loop_: *mut Loop,
    relative_us: core::ffi::c_longlong,
) {
    // SAFETY: nonnull loop contract.
    unsafe { (*loop_).internal_loop_data.quic_next_tick_us = relative_us };
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn us_internal_loop_quic_timer(
    loop_: *mut Loop,
) -> *mut crate::backend::libuv::Timer {
    // SAFETY: nonnull loop contract.
    unsafe { (*loop_).internal_loop_data.quic_timer.cast() }
}

#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn us_internal_loop_quic_timer_set(
    loop_: *mut Loop,
    timer: *mut crate::backend::libuv::Timer,
) {
    // SAFETY: nonnull loop contract.
    unsafe { (*loop_).internal_loop_data.quic_timer = timer.cast() };
}

// ── §9.1 Poll (2) ────────────────────────────────────────────────────────────

/// Poll-first-member contract: the fd is at offset 0 of the handle. Only UDP
/// handles from [`us_udp_socket_poll`] qualify (quic.c is the sole surviving
/// caller — docs/cabi.md §3.4); `SocketHeader`'s fd offset is NOT part of
/// this contract and must not be passed here (use `us_socket_get_fd`). Registry
/// polls (`loop_::poll_registry`) are never C-visible — out of
/// contract for both `us_poll_*` fns.
#[unsafe(no_mangle)]
pub extern "C" fn us_poll_fd(p: *mut us_poll_t) -> LIBUS_SOCKET_DESCRIPTOR {
    const {
        assert!(core::mem::offset_of!(udp::Socket, fd) == 0);
    }
    // SAFETY: caller passes a live poll-first handle; fd is its first field.
    unsafe { *p.cast::<LIBUS_SOCKET_DESCRIPTOR>() }
}

/// Must be callable from inside poll dispatch. `events` are the per-platform
/// LIBUS_SOCKET_READABLE/WRITABLE values (docs/cabi.md §9.3.7).
#[unsafe(no_mangle)]
pub extern "C" fn us_poll_change(p: *mut us_poll_t, loop_: *mut Loop, events: c_int) {
    // SAFETY: caller passes a live poll-first handle registered with `loop_`.
    unsafe { ffi::poll_change_raw(p.cast::<c_void>(), loop_, events as u32) }
}

// ── §9.1 Timer (4, libuv/Windows only) ───────────────────────────────────────

#[cfg(windows)]
mod timer {
    use super::*;
    use crate::backend::libuv::Timer;

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn us_create_timer(
        loop_: *mut Loop,
        fallthrough: c_int,
        ext_size: c_uint,
    ) -> *mut Timer {
        // SAFETY: caller passes a live loop.
        unsafe { ffi::timer_create(loop_, fallthrough != 0, ext_size as usize) }
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn us_timer_set(
        t: *mut Timer,
        cb: Option<unsafe extern "C" fn(*mut Timer)>,
        ms: c_int,
        repeat_ms: c_int,
    ) {
        // SAFETY: caller passes a timer from us_create_timer.
        unsafe { ffi::timer_set(t, cb, ms, repeat_ms) }
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn us_timer_loop(t: *mut Timer) -> *mut Loop {
        // SAFETY: caller passes a live timer.
        unsafe { ffi::timer_loop(t) }
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn us_timer_close(t: *mut Timer, fallthrough: c_int) {
        // SAFETY: caller passes a live timer; not used after this call.
        unsafe { ffi::timer_close(t, fallthrough != 0) }
    }
}

// ── §9.1 Socket (24 + 3 moved from SHIM) ─────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_write(
    s: *mut us_socket_t,
    data: *const c_char,
    length: c_int,
) -> c_int {
    // SAFETY: nonnull socket contract; data valid for `length` bytes. Raw
    // entry: TLS writes can dispatch, so no `&mut` may span the call (C17).
    unsafe { crate::write::write(s, byte_slice(data, length)) }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_write2(
    s: *mut us_socket_t,
    header: *const c_char,
    header_length: c_int,
    payload: *const c_char,
    payload_length: c_int,
) -> c_int {
    // SAFETY: nonnull socket contract; both buffers valid for their lengths.
    // Raw entry: no `&mut` may span a dispatch-capable write (C17).
    unsafe {
        crate::write::write2(
            s,
            byte_slice(header, header_length),
            byte_slice(payload, payload_length),
        )
    }
}

/// Fires on_close synchronously; returns the (still-valid-until-postlude)
/// socket. Idempotent w.r.t. already-closed (C3, C6). `code`/`reason` pass
/// through to on_close verbatim.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_close(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    // SAFETY: nonnull socket contract; legal mid-dispatch (C17).
    unsafe { ffi::socket_close_raw(s, code, reason) }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_shutdown(s: *mut us_socket_t) {
    // Raw entry: the TLS shutdown path can fire on_handshake (C17).
    crate::socket::socket_shutdown(s);
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_shutdown_read(s: *mut us_socket_t) {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).shutdown_read() }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_is_closed(s: *mut us_socket_t) -> c_int {
    // SAFETY: nonnull socket contract; header readable until tick postlude (C6).
    unsafe { (*s).is_closed() as c_int }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_is_shut_down(s: *mut us_socket_t) -> c_int {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).is_shutdown() as c_int }
}

/// Ext address is stable for the socket's lifetime — adoption is in-place
/// (docs/design.md §Strategy 3), so the "except across adopt" caveat is gone.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_ext(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).ext_ptr().cast::<c_void>() }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group(s: *mut us_socket_t) -> *mut SocketGroup {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).raw_group() }
}

/// §9.2.1 group-list walk. Close-safe only if the caller caches the next
/// pointer before closing `s` (App.h::closeIdle does).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_next(s: *mut us_socket_t) -> *mut us_socket_t {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).next }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_timeout(s: *mut us_socket_t, seconds: c_uint) {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).set_timeout(seconds) }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_long_timeout(s: *mut us_socket_t, minutes: c_uint) {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).set_long_timeout(minutes) }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_pause(s: *mut us_socket_t) {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).pause() }
}

/// Resume must redeliver buffered TLS plaintext if any.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_resume(s: *mut us_socket_t) {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).resume() }
}

/// Writes 4 (v4) or 16 (v6) raw bytes; `*length` in/out (in = capacity);
/// `*length = 0` on failure/unix. Capacity < ip length yields `Ok` with an
/// EMPTY view, `buf` unwritten — never truncated, never `Err` (the verbatim
/// C quirk, socket.c:56-64; socket.rs `remote_address`).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_remote_address(
    s: *mut us_socket_t,
    buf: *mut c_char,
    length: *mut c_int,
) {
    // SAFETY: nonnull socket contract; buf valid for `*length` bytes.
    unsafe {
        let cap = usize::try_from(*length).unwrap_or(0);
        if buf.is_null() || cap == 0 {
            *length = 0;
            return;
        }
        let out = core::slice::from_raw_parts_mut(buf.cast::<u8>(), cap);
        match (*s).remote_address(out) {
            Ok(view) => *length = view.len() as c_int,
            Err(_) => *length = 0,
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_get_native_handle(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: nonnull socket contract.
    unsafe { (*s).get_native_handle().unwrap_or(ptr::null_mut()) }
}

/// POSIX no-op (socket.c:691 — libuv only: uv_ref on the socket's uv poll).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_ref(s: *mut us_socket_t) {
    #[cfg(windows)]
    // SAFETY: nonnull socket contract.
    unsafe {
        ffi::socket_uv_ref(s)
    };
    #[cfg(not(windows))]
    let _ = s;
}

/// POSIX no-op (socket.c:736 — libuv only: uv_unref).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_unref(s: *mut us_socket_t) {
    #[cfg(windows)]
    // SAFETY: nonnull socket contract.
    unsafe {
        ffi::socket_uv_unref(s)
    };
    #[cfg(not(windows))]
    let _ = s;
}

/// In-place re-stamp (no realloc); the return is ALWAYS the input pointer —
/// kept in the signature for ABI stability (docs/design.md §Strategy 3). Legal
/// mid-on_data; dispatch continues with the returned pointer.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_adopt(
    s: *mut us_socket_t,
    group: *mut SocketGroup,
    kind: c_uchar,
    old_ext_size: c_int,
    ext_size: c_int,
) -> *mut us_socket_t {
    let Some(kind) = kind_from_c(kind) else {
        return s;
    };
    // SAFETY: nonnull socket/group contract; adoption is in-place.
    unsafe {
        (*s).adopt(&mut *group, kind, old_ext_size, ext_size)
            .map_or(s, core::ptr::NonNull::as_ptr)
    }
}

/// C14: owns the fd only on success; frees the poll (not the fd) on failure.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_from_fd(
    group: *mut SocketGroup,
    kind: c_uchar,
    ssl_ctx: *mut SslCtx,
    socket_ext_size: c_int,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    ipc: c_int,
) -> *mut us_socket_t {
    let Some(kind) = kind_from_c(kind) else {
        return ptr::null_mut();
    };
    // SAFETY: nonnull group contract; ssl_ctx nullable.
    unsafe { (*group).from_fd(kind, opt_ctx(ssl_ctx), socket_ext_size, fd, ipc != 0) }
}

/// Plain sockets report 1 (socket.c:146 — the C ssl==NULL branch). Must be
/// `SSL_is_init_finished`, NOT the crate handshake state: JSHS isAuthorized()
/// probes the "init finished, on_handshake not yet fired" window, and a
/// failed handshake must report 0 (openssl.c:2029-2032).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_is_ssl_handshake_finished(s: *mut us_socket_t) -> c_int {
    // SAFETY: nonnull socket contract.
    unsafe {
        match &(*s).transport {
            Transport::Plain => 1,
            Transport::Tls(t) => (!t.ssl.is_null() && ffi::ssl_is_init_finished(t.ssl)) as c_int,
        }
    }
}

/// Distinguishes "finished" from "on_handshake already dispatched"; plain
/// sockets report 1 (socket.c:153).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_ssl_handshake_callback_has_fired(s: *mut us_socket_t) -> c_int {
    // SAFETY: nonnull socket contract.
    unsafe {
        match &(*s).transport {
            Transport::Plain => 1,
            Transport::Tls(t) => t.handshake_callback_fired as c_int,
        }
    }
}

/// Per-SNI-domain `user` from `us_listen_socket_add_server_name`, resolved
/// for this socket's negotiated servername; null if none.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_server_name_userdata(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: nonnull socket contract.
    unsafe { ffi::socket_server_name_userdata(s) }
}

/// Copies the RAW 4/16 address bytes into `buf`, sets `*port`, returns the
/// byte length; 0 on failure/unix socket. `dest`/`is_ipv6` are NOT written —
/// verbatim C quirk (socket.c:651; the SHIM caller does the formatting).
#[unsafe(no_mangle)]
pub extern "C" fn us_get_remote_address_info(
    buf: *mut c_char,
    s: *mut us_socket_t,
    _dest: *mut *const c_char,
    port: *mut c_int,
    _is_ipv6: *mut c_int,
) -> c_uint {
    if buf.is_null() {
        return 0;
    }
    // SAFETY: nonnull socket contract; buf valid for >= 16 bytes (C contract).
    unsafe {
        let out = core::slice::from_raw_parts_mut(buf.cast::<u8>(), 16);
        match (*s).remote_address(out) {
            // Empty view = getpeername failed/unix: return 0 with *port
            // untouched, matching the C early-return (socket.c:651-687).
            Ok(view) if !view.is_empty() => {
                *port = (*s).remote_port();
                view.len() as c_uint
            }
            _ => 0,
        }
    }
}

/// Same as [`us_get_remote_address_info`] for the local end (verbatim quirks
/// included).
#[unsafe(no_mangle)]
pub extern "C" fn us_get_local_address_info(
    buf: *mut c_char,
    s: *mut us_socket_t,
    _dest: *mut *const c_char,
    port: *mut c_int,
    _is_ipv6: *mut c_int,
) -> c_uint {
    if buf.is_null() {
        return 0;
    }
    // SAFETY: nonnull socket contract; buf valid for >= 16 bytes (C contract).
    unsafe {
        let out = core::slice::from_raw_parts_mut(buf.cast::<u8>(), 16);
        match (*s).local_address(out) {
            Ok(view) if !view.is_empty() => {
                *port = (*s).local_port();
                view.len() as c_uint
            }
            _ => 0,
        }
    }
}

// Moved from the SHIM (docs/cabi.md §9.3): the last C++ users of
// internal.h layout, now native.

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_get_fd(s: *mut us_socket_t) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: nonnull socket contract (SHIM: us_poll_fd(&s->p)).
    unsafe { (*s).fd }
}

/// SHIM body ported: closed-guard, then mark `last_write_failed` + arm R|W so
/// the next writable event re-fires on_writable.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_sendfile_needs_more(s: *mut us_socket_t) {
    // SAFETY: nonnull socket contract.
    unsafe {
        if (*s).is_closed() {
            return;
        }
        (*s).send_file_needs_more();
    }
}

/// Same body for non-SSL HttpResponse (uws_res_t is an identity cast of
/// us_socket_t).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_mark_needs_more_not_ssl(res: *mut uws_res_t) {
    us_socket_sendfile_needs_more(res.cast::<us_socket_t>());
}

// ── §9.1 Socket groups (8) ───────────────────────────────────────────────────

/// Initializes an embedded, zero-initialized group; does NOT link into the
/// loop (lazy on first socket); idempotent.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_init(
    group: *mut SocketGroup,
    loop_: *mut Loop,
    vtable: *const VTable,
    ext: *mut c_void,
) {
    // SAFETY: nonnull group contract; vtable is a C++ static (lives forever).
    unsafe {
        let vt: Option<&'static VTable> = vtable.as_ref();
        (*group).init(loop_, vt, ext);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_deinit(group: *mut SocketGroup) {
    // SAFETY: nonnull group previously passed to init; owner frees storage next.
    unsafe { SocketGroup::destroy(group) }
}

/// Raw-pointer seam (no `&mut SocketGroup` here): on_close fires synchronously
/// per socket and uWS handlers re-enter cabi on this same group mid-walk (C17).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_close_all(group: *mut SocketGroup) {
    crate::group::close_all_ex(group, true)
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_ext(group: *mut SocketGroup) -> *mut c_void {
    // SAFETY: nonnull group contract; ext is nullable (init contract), so
    // this reads the raw word rather than the non-null-asserting owner().
    unsafe { (*group).ext_raw() }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_loop(group: *mut SocketGroup) -> *mut Loop {
    // SAFETY: nonnull group contract (returns_nonnull after init).
    unsafe { (*group).get_loop() }
}

/// Live list head — caching a `us_listen_socket_t*` across ticks is a
/// documented UAF.
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_head_listen_socket(group: *mut SocketGroup) -> *mut ListenSocket {
    // SAFETY: nonnull group contract.
    unsafe { (*group).head_listen_sockets }
}

/// §9.2.1: live established-socket list head (same caching caveat as above).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_head_socket(group: *mut SocketGroup) -> *mut us_socket_t {
    // SAFETY: nonnull group contract.
    unsafe { (*group).head_sockets }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_listen(
    group: *mut SocketGroup,
    kind: c_uchar,
    ssl_ctx: *mut SslCtx,
    host: *const c_char,
    port: c_int,
    options: c_int,
    socket_ext_size: c_int,
    error: *mut c_int,
) -> *mut ListenSocket {
    let mut local_err: c_int = 0;
    let ls = match kind_from_c(kind) {
        // SAFETY: nonnull group contract; host nullable NUL-terminated.
        Some(kind) => unsafe {
            (*group).listen(
                kind,
                opt_ctx(ssl_ctx),
                opt_cstr(host),
                port,
                options,
                socket_ext_size,
                &mut local_err,
            )
        },
        None => {
            local_err = libc::EINVAL;
            ptr::null_mut()
        }
    };
    if !error.is_null() {
        // SAFETY: caller-owned out-param.
        unsafe { *error = local_err };
    }
    ls
}

/// `pathlen` supports abstract sockets (leading NUL).
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_group_listen_unix(
    group: *mut SocketGroup,
    kind: c_uchar,
    ssl_ctx: *mut SslCtx,
    path: *const c_char,
    pathlen: usize,
    options: c_int,
    socket_ext_size: c_int,
    error: *mut c_int,
) -> *mut ListenSocket {
    let mut local_err: c_int = 0;
    let ls = match kind_from_c(kind) {
        // SAFETY: nonnull group contract; path valid for pathlen bytes.
        Some(kind) => unsafe {
            (*group).listen_unix(
                kind,
                opt_ctx(ssl_ctx),
                ext::c_slice(path.cast_mut().cast::<u8>(), pathlen),
                options,
                socket_ext_size,
                &mut local_err,
            )
        },
        None => {
            local_err = libc::EINVAL;
            ptr::null_mut()
        }
    };
    if !error.is_null() {
        // SAFETY: caller-owned out-param.
        unsafe { *error = local_err };
    }
    ls
}

// ── §9.1 Listen sockets / SNI (7) ────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_close(ls: *mut ListenSocket) {
    // SAFETY: nonnull, still-linked listen socket contract.
    unsafe { (*ls).close() }
}

/// §9.2.2: drops the listener's loop keep-alive (HttpContext.h listen paths;
/// replaces the C++ `us_socket_unref(&ls->s)` embedded-first-member poke).
#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_unref(ls: *mut ListenSocket) {
    // ListenSocket is repr(C) header-first, so the cast is the C `&ls->s`.
    us_socket_unref(ls.cast::<us_socket_t>())
}

#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_next(ls: *mut ListenSocket) -> *mut ListenSocket {
    // SAFETY: listener list nodes are ListenSockets (header-first repr(C)).
    let s = unsafe { (*ls).get_socket() };
    // Closed listeners reuse `next` as the loop closed-chain link; C's
    // dedicated listener link would read NULL there (context.c:459).
    if s.is_closed() {
        return core::ptr::null_mut();
    }
    s.next.cast::<ListenSocket>()
}

#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_group(ls: *mut ListenSocket) -> *mut SocketGroup {
    // SAFETY: nonnull listen socket contract.
    unsafe { (*ls).get_socket().raw_group() }
}

/// `ssl_ctx` up_ref'd into the SNI tree; `user` opaque (uWS: HttpRouter*).
/// Returns 0 on success, nonzero on failure — App.h's `!= 0` rollback path
/// (openssl.c: 1 = duplicate pattern, -1 = listener has no default ctx; the
/// native bool collapses both onto 1).
#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_add_server_name(
    ls: *mut ListenSocket,
    hostname_pattern: *const c_char,
    ssl_ctx: *mut SslCtx,
    user: *mut c_void,
) -> c_int {
    // SAFETY: nonnull listen socket + NUL-terminated pattern contract.
    unsafe {
        if (*ls).add_server_name(CStr::from_ptr(hostname_pattern), ssl_ctx, user) {
            0
        } else {
            1
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_remove_server_name(
    ls: *mut ListenSocket,
    hostname_pattern: *const c_char,
) {
    // SAFETY: nonnull listen socket + NUL-terminated pattern contract.
    unsafe { (*ls).remove_server_name(CStr::from_ptr(hostname_pattern)) }
}

/// Returns an OWNED reference — caller must `us_internal_ssl_ctx_unref`.
#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_find_server_name_ctx(
    ls: *mut ListenSocket,
    hostname_pattern: *const c_char,
) -> *mut SslCtx {
    // SAFETY: nonnull listen socket + NUL-terminated pattern contract.
    unsafe { ffi::listen_socket_find_server_name_ctx(ls, hostname_pattern) }
}

/// Dynamic SNI resolver; callback contract per docs/cabi.md §4.3. A null
/// cb is a no-op (the native surface takes a non-optional resolver).
#[unsafe(no_mangle)]
pub extern "C" fn us_listen_socket_on_server_name(
    ls: *mut ListenSocket,
    cb: Option<
        unsafe extern "C" fn(
            *mut ListenSocket,
            *const c_char,
            *mut c_int,
            *mut us_socket_t,
        ) -> *mut SslCtx,
    >,
) {
    let Some(cb) = cb else { return };
    // SAFETY: fn-pointer transmute between ABI-identical pointer signatures
    // (us_socket_t*/SslCtx* vs c_void* — the frozen handle.rs erases them).
    unsafe {
        let native: extern "C" fn(
            *mut ListenSocket,
            *const c_char,
            *mut c_int,
            *mut c_void,
        ) -> *mut c_void = core::mem::transmute(cb);
        (*ls).on_server_name(native);
    }
}

// ── §9.1 SSL_CTX construction (3; root-cert fns stay in surviving C++ TUs) ──

/// Options BY VALUE (memcpy-shared with `uWS::SocketContextOptions`).
/// Caller owns one ref; frees the strdup'd passphrase itself.
#[unsafe(no_mangle)]
pub extern "C" fn us_ssl_ctx_from_options(
    options: BunSocketContextOptions,
    err: *mut create_bun_socket_error_t,
) -> *mut SslCtx {
    let mut e = create_bun_socket_error_t::none;
    let ctx = crate::tls::context::ssl_ctx_from_options(options, &mut e);
    if !err.is_null() {
        // SAFETY: caller-owned out-param.
        unsafe { *err = e };
    }
    ctx
}

/// `SSL_CTX_free` without OpenSSL headers.
#[unsafe(no_mangle)]
pub extern "C" fn us_internal_ssl_ctx_unref(ctx: *mut SslCtx) {
    crate::tls::context::ssl_ctx_unref(ctx)
}

/// Like from_options but without socket-layer callbacks (QUIC installs
/// lsquic's own).
#[unsafe(no_mangle)]
pub extern "C" fn us_ssl_ctx_build_raw(
    options: BunSocketContextOptions,
    err: *mut create_bun_socket_error_t,
) -> *mut SslCtx {
    let mut e = create_bun_socket_error_t::none;
    let ctx = crate::tls::context::ssl_ctx_build_raw(options, &mut e);
    if !err.is_null() {
        // SAFETY: caller-owned out-param.
        unsafe { *err = e };
    }
    ctx
}

// ── §9.1 UDP + packet buffer (6 — QUIC is the only surviving C consumer) ────

#[unsafe(no_mangle)]
pub extern "C" fn us_create_udp_socket(
    loop_: *mut Loop,
    data_cb: Option<unsafe extern "C" fn(*mut udp::Socket, *mut c_void, c_int)>,
    drain_cb: Option<unsafe extern "C" fn(*mut udp::Socket)>,
    close_cb: Option<unsafe extern "C" fn(*mut udp::Socket)>,
    recv_error_cb: Option<unsafe extern "C" fn(*mut udp::Socket, c_int)>,
    host: *const c_char,
    port: c_ushort,
    flags: c_int,
    err: *mut c_int,
    user: *mut c_void,
) -> *mut udp::Socket {
    // data/drain/close are non-null at every surviving call site; a null one
    // fails closed instead of storing a null fn ptr. recv_error_cb is NULL at
    // all three quic.c sites (quic.c:845/1203/1208; C null-guards at invoke,
    // loop.c:829/860) — lowered to a no-op for the non-optional native param.
    let (Some(data_cb), Some(drain_cb), Some(close_cb)) = (data_cb, drain_cb, close_cb) else {
        if !err.is_null() {
            // SAFETY: caller-owned out-param.
            unsafe { *err = libc::EINVAL };
        }
        return ptr::null_mut();
    };
    extern "C" fn recv_error_noop(_s: *mut udp::Socket, _errno: c_int) {}
    // SAFETY: fn-pointer transmutes between ABI-identical signatures (the C
    // header types the recv batch as void*, the crate as PacketBuffer*).
    unsafe {
        let data_cb: extern "C" fn(*mut udp::Socket, *mut udp::PacketBuffer, c_int) =
            core::mem::transmute(data_cb);
        let drain_cb: extern "C" fn(*mut udp::Socket) = core::mem::transmute(drain_cb);
        let close_cb: extern "C" fn(*mut udp::Socket) = core::mem::transmute(close_cb);
        let recv_error_cb: extern "C" fn(*mut udp::Socket, c_int) = match recv_error_cb {
            Some(cb) => core::mem::transmute(cb),
            None => recv_error_noop,
        };
        udp::Socket::create(
            loop_,
            data_cb,
            drain_cb,
            close_cb,
            recv_error_cb,
            host,
            port,
            flags,
            err.as_mut(),
            user,
        )
    }
}

/// Safe while iterating (QUIC teardown loops); close_cb fires before the
/// deferred free (C15).
#[unsafe(no_mangle)]
pub extern "C" fn us_udp_socket_close(s: *mut udp::Socket) {
    // SAFETY: nonnull udp socket contract.
    unsafe { (*s).close() }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_udp_socket_user(s: *mut udp::Socket) -> *mut c_void {
    // SAFETY: nonnull udp socket contract.
    unsafe { (*s).user() }
}

/// §9.2.5: the poll embedded first in `us_udp_socket_t` — replaces quic.c's
/// raw `(struct us_poll_t *) udp` cast (fd-at-offset-0 contract, §3.4/§3.6).
#[unsafe(no_mangle)]
pub extern "C" fn us_udp_socket_poll(s: *mut udp::Socket) -> *mut us_poll_t {
    s.cast::<us_poll_t>()
}

#[unsafe(no_mangle)]
pub extern "C" fn us_udp_packet_buffer_payload(
    buf: *mut udp::PacketBuffer,
    index: c_int,
) -> *mut c_char {
    // SAFETY: valid only during data_cb; index within the last recv batch.
    unsafe { (*buf).get_payload(index).as_mut_ptr().cast::<c_char>() }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_udp_packet_buffer_payload_length(
    buf: *mut udp::PacketBuffer,
    index: c_int,
) -> c_int {
    // SAFETY: valid only during data_cb; index within the last recv batch.
    unsafe { (*buf).get_payload(index).len() as c_int }
}

/// Cast to `struct sockaddr*` by the caller (sockaddr_storage per slot).
#[unsafe(no_mangle)]
pub extern "C" fn us_udp_packet_buffer_peer(
    buf: *mut udp::PacketBuffer,
    index: c_int,
) -> *mut c_char {
    // SAFETY: valid only during data_cb; index within the last recv batch.
    unsafe { ptr::from_mut((*buf).get_peer(index)).cast::<c_char>() }
}

// ── Raw-socket probe helpers (quic.c route probing; bsd.c:683/728 parity) ───

/// `*err` is zeroed up front, set to errno only on failure (bsd.c:683).
#[unsafe(no_mangle)]
pub extern "C" fn bsd_create_socket(
    domain: c_int,
    ty: c_int,
    protocol: c_int,
    err: *mut c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    if !err.is_null() {
        // SAFETY: caller-owned out-param.
        unsafe { *err = 0 };
    }
    match io::create_socket(domain, ty, protocol) {
        Ok(fd) => fd,
        Err(e) => {
            if !err.is_null() {
                // SAFETY: caller-owned out-param.
                unsafe { *err = e };
            }
            crate::LIBUS_SOCKET_ERROR
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn bsd_close_socket(fd: LIBUS_SOCKET_DESCRIPTOR) {
    io::close(fd, false)
}

// ── DNS bridge completion (loop.c:324-340; DNS-bridge contract C13) ──
// Consumed link-time by bun_runtime::dns_jsc (dns.rs declares both as two-arg
// extern "C"). The request pointer is unused: it was already stored on the
// socket by the connect path (loop.c:325 parity).

#[unsafe(no_mangle)]
pub extern "C" fn us_internal_dns_callback(
    socket: *mut connecting::ConnectingSocket,
    _addrinfo_req: *mut connecting::AddrinfoRequest,
) {
    connecting::dns_callback(socket);
}

#[unsafe(no_mangle)]
pub extern "C" fn us_internal_dns_callback_threadsafe(
    socket: *mut connecting::ConnectingSocket,
    _addrinfo_req: *mut connecting::AddrinfoRequest,
) {
    connecting::dns_callback_threadsafe(socket);
}

// ── §9.1 Data statics (kind ordinals consumed by C++ SocketKinds.h) ─────────

#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_DYNAMIC: u8 = SocketKind::Dynamic as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_HTTP: u8 = SocketKind::UwsHttp as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_HTTP_TLS: u8 = SocketKind::UwsHttpTls as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_WS: u8 = SocketKind::UwsWs as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_UWS_WS_TLS: u8 = SocketKind::UwsWsTls as u8;
#[unsafe(no_mangle)]
pub static BUN_SOCKET_KIND_BUN_SOCKET_TLS: u8 = SocketKind::BunSocketTls as u8;
