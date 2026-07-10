//! UDP socket layer.
//!
//! Ports `packages/bun-usockets/src/udp.c`. Public `us_udp_*` functions are
//! thin wrappers over the `bsd_*` layer plus poll lifecycle management.

use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::mem::MaybeUninit;
use core::ptr;

use crate::bsd::{
    LIBUS_SOCKET_ERROR, bsd_addr_get_ip, bsd_addr_get_ip_length, bsd_addr_get_port,
    bsd_close_socket, bsd_connect_udp_socket, bsd_create_udp_socket, bsd_disconnect_udp_socket,
    bsd_local_addr, bsd_remote_addr, bsd_sendmmsg, bsd_socket_broadcast,
    bsd_socket_multicast_interface, bsd_socket_multicast_loopback, bsd_socket_set_membership,
    bsd_socket_set_source_specific_membership, bsd_socket_ttl_multicast, bsd_socket_ttl_unicast,
    bsd_udp_packet_buffer_local_ip, bsd_udp_packet_buffer_payload,
    bsd_udp_packet_buffer_payload_length, bsd_udp_packet_buffer_peer,
    bsd_udp_packet_buffer_truncated, bsd_udp_setup_sendbuf, udp_recvbuf, udp_sendbuf,
};
use crate::eventing::{
    LIBUS_SOCKET_READABLE, LIBUS_SOCKET_WRITABLE, us_create_poll, us_poll_change, us_poll_fd,
    us_poll_free, us_poll_init, us_poll_start_rc, us_poll_stop,
};
use crate::types::{
    LIBUS_SEND_BUFFER_LENGTH, LIBUS_SOCKET_DESCRIPTOR, POLL_TYPE_UDP, bsd_addr_t, sockaddr_storage,
    us_loop_t, us_poll_t, us_udp_socket_t,
};

/// Public handle to a UDP receive buffer — opaque in `libusockets.h`, in
/// practice the same allocation as `struct udp_recvbuf`.
pub type us_udp_packet_buffer_t = udp_recvbuf;

// `MSG_DONTWAIT` — defined by libc on POSIX; bsd.h defines it as 0 on Windows.
#[cfg(not(windows))]
const MSG_DONTWAIT: c_int = libc::MSG_DONTWAIT;
#[cfg(windows)]
const MSG_DONTWAIT: c_int = 0;

// ── errno thread-local (read + write) ───────────────────────────────────────
#[inline(always)]
unsafe fn errno_ptr() -> *mut c_int {
    unsafe extern "C" {
        #[cfg_attr(
            any(target_os = "macos", target_os = "ios", target_os = "freebsd"),
            link_name = "__error"
        )]
        #[cfg_attr(target_os = "linux", link_name = "__errno_location")]
        #[cfg_attr(target_os = "android", link_name = "__errno")]
        #[cfg_attr(windows, link_name = "_errno")]
        fn __errno() -> *mut c_int;
    }
    // SAFETY: returns a valid thread-local int* for the calling thread.
    unsafe { __errno() }
}

#[inline(always)]
unsafe fn errno() -> c_int {
    // SAFETY: errno_ptr always returns a valid thread-local pointer.
    unsafe { *errno_ptr() }
}

#[inline(always)]
unsafe fn set_errno(e: c_int) {
    // SAFETY: errno_ptr always returns a valid thread-local pointer.
    unsafe { *errno_ptr() = e }
}

// `us_udp_socket_t.p` is the first field at offset 0; `&socket` is a valid `&poll`.
#[inline(always)]
fn as_poll(s: *mut us_udp_socket_t) -> *mut us_poll_t {
    s.cast()
}

// ═══════════════════════════════════════════════════════════════════════════
// Packet-buffer accessors — thunks to the bsd layer
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_packet_buffer_local_ip(
    buf: *mut us_udp_packet_buffer_t,
    index: c_int,
    ip: *mut c_char,
) -> c_int {
    // SAFETY: `buf` is the opaque public alias of `udp_recvbuf`.
    unsafe { bsd_udp_packet_buffer_local_ip(buf, index, ip) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_packet_buffer_peer(
    buf: *mut us_udp_packet_buffer_t,
    index: c_int,
) -> *mut c_char {
    // SAFETY: `buf` is the opaque public alias of `udp_recvbuf`.
    unsafe { bsd_udp_packet_buffer_peer(buf, index) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_packet_buffer_payload(
    buf: *mut us_udp_packet_buffer_t,
    index: c_int,
) -> *mut c_char {
    // SAFETY: `buf` is the opaque public alias of `udp_recvbuf`.
    unsafe { bsd_udp_packet_buffer_payload(buf, index) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_packet_buffer_payload_length(
    buf: *mut us_udp_packet_buffer_t,
    index: c_int,
) -> c_int {
    // SAFETY: `buf` is the opaque public alias of `udp_recvbuf`.
    unsafe { bsd_udp_packet_buffer_payload_length(buf, index) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_packet_buffer_truncated(
    buf: *mut us_udp_packet_buffer_t,
    index: c_int,
) -> c_int {
    // SAFETY: `buf` is the opaque public alias of `udp_recvbuf`.
    unsafe { bsd_udp_packet_buffer_truncated(buf, index) }
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket operations
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_send(
    s: *mut us_udp_socket_t,
    mut payloads: *mut *mut c_void,
    mut lengths: *mut usize,
    mut addresses: *mut *mut c_void,
    mut num: c_int,
) -> c_int {
    if num == 0 {
        return 0;
    }
    // SAFETY: caller guarantees `s` is a live UDP socket; `p` is its first field.
    // The loop's `send_buf` is a malloc'd LIBUS_SEND_BUFFER_LENGTH-byte block so
    // it is suitably aligned for `udp_sendbuf`.
    #[allow(clippy::cast_ptr_alignment)]
    let (fd, buf, loop_) = unsafe {
        let fd = us_poll_fd(as_poll(s));
        let loop_ = (*s).loop_;
        let buf = (*loop_).data.send_buf.cast::<udp_sendbuf>();
        (fd, buf, loop_)
    };

    let mut total_sent: c_int = 0;
    while total_sent < num {
        // SAFETY: `buf` is the loop's owned LIBUS_SEND_BUFFER_LENGTH-byte scratch;
        // the three parallel arrays have at least `num` remaining entries.
        let count = unsafe {
            bsd_udp_setup_sendbuf(
                buf,
                LIBUS_SEND_BUFFER_LENGTH,
                payloads,
                lengths,
                addresses,
                num,
            )
        };
        // SAFETY: `count <= num`; advance the parallel-array cursors in step.
        unsafe {
            payloads = payloads.add(count as usize);
            lengths = lengths.add(count as usize);
            addresses = addresses.add(count as usize);
        }
        num -= count;
        // SAFETY: `fd` is the socket's live descriptor; `buf` was just populated.
        let sent = unsafe { bsd_sendmmsg(fd, buf, MSG_DONTWAIT) };
        if sent < 0 {
            return sent;
        }
        total_sent += sent;
        if 0 <= sent && sent < num {
            // Not all packets sent — re-arm WRITABLE so the drain callback fires.
            // SAFETY: `s` casts to its leading poll; `loop_` owns it.
            unsafe {
                us_poll_change(
                    as_poll(s),
                    loop_,
                    LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
                );
            }
        }
    }
    total_sent
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_bound_port(s: *mut us_udp_socket_t) -> c_int {
    // SAFETY: caller guarantees `s` is a live UDP socket.
    unsafe { (*s).port as c_int }
}

/// Shared body of `us_udp_socket_bound_ip` / `us_udp_socket_remote_ip`.
#[inline(always)]
unsafe fn copy_socket_ip(
    s: *mut us_udp_socket_t,
    buf: *mut c_char,
    length: *mut c_int,
    fetch: unsafe extern "C" fn(LIBUS_SOCKET_DESCRIPTOR, *mut bsd_addr_t) -> c_int,
) {
    // SAFETY: `s` is live; `addr` is a stack local filled by `fetch`;
    // `length` is a valid in/out pointer (in = capacity, out = bytes written).
    unsafe {
        let mut addr: bsd_addr_t = MaybeUninit::zeroed().assume_init();
        let addr_p = &raw mut addr;
        if fetch(us_poll_fd(as_poll(s)), addr_p) != 0 || *length < bsd_addr_get_ip_length(addr_p) {
            *length = 0;
        } else {
            *length = bsd_addr_get_ip_length(addr_p);
            ptr::copy_nonoverlapping(
                bsd_addr_get_ip(addr_p).cast::<u8>(),
                buf.cast::<u8>(),
                *length as usize,
            );
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_bound_ip(
    s: *mut us_udp_socket_t,
    buf: *mut c_char,
    length: *mut c_int,
) {
    // SAFETY: forwards to the shared helper with the local-address fetcher.
    unsafe { copy_socket_ip(s, buf, length, bsd_local_addr) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_remote_ip(
    s: *mut us_udp_socket_t,
    buf: *mut c_char,
    length: *mut c_int,
) {
    // SAFETY: forwards to the shared helper with the peer-address fetcher.
    unsafe { copy_socket_ip(s, buf, length, bsd_remote_addr) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_user(udp: *mut us_udp_socket_t) -> *mut c_void {
    // SAFETY: caller guarantees `udp` is a live UDP socket.
    unsafe { (*udp).user }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_close(s: *mut us_udp_socket_t) {
    // SAFETY: `s` is live; after this call it stays allocated with `closed=1`
    // on the loop's `closed_udp_head` list until `us_internal_free_closed_sockets`.
    unsafe {
        let loop_ = (*s).loop_;
        let p = as_poll(s);
        us_poll_stop(p, loop_);
        bsd_close_socket(us_poll_fd(p));
        (*s).set_closed(true);
        // Push-front onto the deferred-free list.
        (*s).next = (*loop_).data.closed_udp_head;
        (*loop_).data.closed_udp_head = s;
        // Invoke user callback last — it may re-enter arbitrary code.
        if let Some(on_close) = (*s).on_close {
            on_close(s);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_set_broadcast(
    s: *mut us_udp_socket_t,
    enabled: c_int,
) -> c_int {
    // SAFETY: `s` is live; `&s->p` is its leading poll.
    unsafe { bsd_socket_broadcast(us_poll_fd(as_poll(s)), enabled) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_set_ttl_unicast(
    s: *mut us_udp_socket_t,
    ttl: c_int,
) -> c_int {
    // SAFETY: `s` is live; `&s->p` is its leading poll.
    unsafe { bsd_socket_ttl_unicast(us_poll_fd(as_poll(s)), ttl) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_set_ttl_multicast(
    s: *mut us_udp_socket_t,
    ttl: c_int,
) -> c_int {
    // SAFETY: `s` is live; `&s->p` is its leading poll.
    unsafe { bsd_socket_ttl_multicast(us_poll_fd(as_poll(s)), ttl) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_connect(
    s: *mut us_udp_socket_t,
    host: *const c_char,
    port: c_ushort,
) -> c_int {
    // SAFETY: `s` is live; host/port are forwarded to the bsd layer.
    unsafe { bsd_connect_udp_socket(us_poll_fd(as_poll(s)), host, port as c_int) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_disconnect(s: *mut us_udp_socket_t) -> c_int {
    // SAFETY: `s` is live; `&s->p` is its leading poll.
    unsafe { bsd_disconnect_udp_socket(us_poll_fd(as_poll(s))) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_set_multicast_loopback(
    s: *mut us_udp_socket_t,
    enabled: c_int,
) -> c_int {
    // SAFETY: `s` is live; `&s->p` is its leading poll.
    unsafe { bsd_socket_multicast_loopback(us_poll_fd(as_poll(s)), enabled) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_set_multicast_interface(
    s: *mut us_udp_socket_t,
    addr: *const sockaddr_storage,
) -> c_int {
    // SAFETY: `s` is live; `addr` is borrowed by the bsd layer.
    unsafe { bsd_socket_multicast_interface(us_poll_fd(as_poll(s)), addr) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_set_membership(
    s: *mut us_udp_socket_t,
    addr: *const sockaddr_storage,
    iface: *const sockaddr_storage,
    drop: c_int,
) -> c_int {
    // SAFETY: `s` is live; `addr`/`iface` are borrowed by the bsd layer.
    unsafe { bsd_socket_set_membership(us_poll_fd(as_poll(s)), addr, iface, drop) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_udp_socket_set_source_specific_membership(
    s: *mut us_udp_socket_t,
    source: *const sockaddr_storage,
    group: *const sockaddr_storage,
    iface: *const sockaddr_storage,
    drop: c_int,
) -> c_int {
    // SAFETY: `s` is live; all address pointers are borrowed by the bsd layer.
    unsafe {
        bsd_socket_set_source_specific_membership(
            us_poll_fd(as_poll(s)),
            source,
            group,
            iface,
            drop,
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Construction
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_udp_socket(
    loop_: *mut us_loop_t,
    data_cb: Option<unsafe extern "C" fn(*mut us_udp_socket_t, *mut c_void, c_int)>,
    drain_cb: Option<unsafe extern "C" fn(*mut us_udp_socket_t)>,
    close_cb: Option<unsafe extern "C" fn(*mut us_udp_socket_t)>,
    recv_error_cb: Option<unsafe extern "C" fn(*mut us_udp_socket_t, c_int)>,
    host: *const c_char,
    port: c_ushort,
    flags: c_int,
    err: *mut c_int,
    user: *mut c_void,
) -> *mut us_udp_socket_t {
    // SAFETY: `loop_` is a live loop; on success the returned allocation is
    // owned by the caller and freed via `us_poll_free` after `us_udp_socket_close`.
    unsafe {
        let fd = bsd_create_udp_socket(host, port as c_int, flags, err);
        if fd == LIBUS_SOCKET_ERROR {
            return ptr::null_mut();
        }

        let ext_size: c_int = 0;
        let fallthrough: c_int = 0;

        // Allocates size_of(us_poll_t)+size_of(us_udp_socket_t) bytes; the tail
        // slack is intentional and matches the C for deallocation symmetry.
        let p = us_create_poll(
            loop_,
            fallthrough,
            (size_of::<us_udp_socket_t>() as c_int + ext_size) as c_uint,
        );
        us_poll_init(p, fd, POLL_TYPE_UDP);
        if us_poll_start_rc(p, loop_, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE) != 0 {
            let saved_errno = errno();
            bsd_close_socket(fd);
            us_poll_free(p, loop_);
            if !err.is_null() {
                *err = saved_errno;
            }
            set_errno(saved_errno);
            return ptr::null_mut();
        }

        // `us_create_poll` returned a malloc'd block sized for `us_udp_socket_t`
        // with `p` as its first field; malloc guarantees 16-byte alignment.
        #[allow(clippy::cast_ptr_alignment)]
        let udp = p.cast::<us_udp_socket_t>();

        // Cache the bound port once.
        let mut tmp: bsd_addr_t = MaybeUninit::zeroed().assume_init();
        bsd_local_addr(fd, &raw mut tmp);
        (*udp).port = bsd_addr_get_port(&raw mut tmp) as u16;
        (*udp).loop_ = loop_;

        // There is no UDP socket context, only user data.
        (*udp).user = user;

        (*udp).bits = 0; // closed = 0, connected = 0
        (*udp).on_data = data_cb;
        (*udp).on_drain = drain_cb;
        (*udp).on_close = close_cb;
        (*udp).on_recv_error = recv_error_cb;
        (*udp).next = ptr::null_mut();

        udp
    }
}
