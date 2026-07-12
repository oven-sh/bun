//! Write path: write/write2/raw_write(v)/write_check_error/flush, sendfile
//! marker, IPC fd write (SCM_RIGHTS). Implements docs/semantics.md §4:
//! ENOBUFS/ENOMEM are would-block (return 0), <0 is fatal, no MSG_MORE;
//! on_writable fires after kernel drain; the paused bit resets on pool reuse
//! (contract C7). The JS stream buffer (`us_socket_stream_buffer_t`) is NOT
//! here — it lives above the core (docs/design.md §Resolved design decisions).

use core::ffi::c_void;

#[cfg(not(windows))]
use bun_core::Fd;

use crate::backend::Events;
use crate::socket::{SocketFlags, SocketHeader, is_shut_down_full};
use crate::tls::{TlsState, Transport};
use crate::unsafe_core::{ext, io};

/// `us_iovec_t` — layout == POSIX iovec.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct UsIoVec {
    pub base: *const c_void,
    pub len: usize,
}

/// C7: the C surface was `int`-bounded; cap one submission at i32::MAX so
/// the returned `i32` can never wrap. A clamped submission always arms
/// backpressure, so the unreported tail reads as a short write to retry.
const MAX_WRITE_LEN: usize = i32::MAX as usize;

/// Returns `(clamped slice, whether clamping occurred)`.
#[inline]
fn clamp_len(data: &[u8]) -> (&[u8], bool) {
    if data.len() > MAX_WRITE_LEN {
        (&data[..MAX_WRITE_LEN], true)
    } else {
        (data, false)
    }
}

/// R4.7: POSIX checks EWOULDBLOCK ONLY (the `|| EAGAIN` is commented out
/// upstream; equal on all currently-supported POSIX targets).
#[cfg(not(windows))]
#[inline]
fn is_would_block(err: isize) -> bool {
    err == -(libc::EWOULDBLOCK as isize)
}

/// R4.2: transient kernel resource exhaustion on a healthy connection —
/// NOT fatal (commit-fc865b39 behavior).
#[cfg(not(windows))]
#[inline]
fn is_transient_send_error(err: isize) -> bool {
    err == -(libc::ENOBUFS as isize) || err == -(libc::ENOMEM as isize)
}

#[cfg(windows)]
const WSAEWOULDBLOCK: isize = 10035;
#[cfg(windows)]
const WSAENOBUFS: isize = 10055;

#[cfg(windows)]
#[inline]
fn is_would_block(err: isize) -> bool {
    err == -WSAEWOULDBLOCK
}

#[cfg(windows)]
#[inline]
fn is_transient_send_error(err: isize) -> bool {
    err == -WSAENOBUFS
}

/// Raw `*mut TlsState` behind the transport box (stable address; C6). The
/// header borrow ends here so callees may re-derive `&mut SocketHeader` (C17).
#[inline]
fn tls_state(s: *mut SocketHeader) -> Option<*mut TlsState> {
    match &mut ext::header_mut(s).transport {
        Transport::Tls(t) => Some(&raw mut **t),
        Transport::Plain => None,
    }
}

/// OQ-2 quirk (ported verbatim): absolute R|W set — re-arms READABLE even on
/// a paused socket. `IS_PAUSED` stays set, so a later resume's R restore is a
/// no-op for the bit it thinks it is restoring.
#[inline]
fn poll_change_read_write(s: *mut SocketHeader) {
    crate::socket::poll_change(s, Events::READABLE | Events::WRITABLE);
}

/// Short/failed write: `last_write_failed = 1` + poll R|W. The next writable
/// dispatch clears the flag BEFORE on_writable; if the handler does not
/// write-and-fail again, W is disarmed (R4.9 — the entire backpressure protocol).
#[inline]
fn mark_backpressure(s: *mut SocketHeader) {
    ext::header_mut(s)
        .flags
        .set(SocketFlags::LAST_WRITE_FAILED, true);
    poll_change_read_write(s);
}

/// Plaintext write; TLS-encrypts when the transport is Tls. Returns bytes
/// accepted (0..len); 0 = would-block; never negative on this path.
pub(crate) fn write(s: *mut SocketHeader, data: &[u8]) -> i32 {
    let (data, clamped) = clamp_len(data);
    // R4.1: TLS routes before the closed/shut-down gate (the SSL layer does
    // its own gating; ENOBUFS mapping surfaces there per C7).
    if let Some(tls) = tls_state(s) {
        let written = TlsState::write(tls, s, data);
        // C7: a full clamped write still reads short to the caller — arm W.
        if clamped && written == data.len() as i32 && !ext::header_mut(s).is_closed() {
            mark_backpressure(s);
        }
        return written;
    }
    if ext::header_mut(s).is_closed() || is_shut_down_full(s) {
        return 0;
    }
    let fd = ext::header_mut(s).fd;
    let written = io::send(fd, data);
    // R4.1: fatal errors (EPIPE/ECONNRESET) are indistinguishable from
    // would-block here; the error surfaces later as an error/HUP event.
    if written != data.len() as isize || clamped {
        mark_backpressure(s);
    }
    if written < 0 { 0 } else { written as i32 }
}

/// Vectored 2-part write (frame header + body, no copy).
pub(crate) fn write2(s: *mut SocketHeader, first: &[u8], second: &[u8]) -> i32 {
    // R4.3: no TLS branch — write2 on a TLS socket writes ciphertext-layer
    // bytes raw (callers only use it on plain sockets).
    if ext::header_mut(s).is_closed() || is_shut_down_full(s) {
        return 0;
    }
    let requested = first.len().saturating_add(second.len());
    let (first, _) = clamp_len(first);
    let second = &second[..second.len().min(MAX_WRITE_LEN - first.len())];
    let clamped = first.len() + second.len() != requested;
    let total = first.len() as isize + second.len() as isize;
    let fd = ext::header_mut(s).fd;
    let written = io::write2(fd, first, second);
    if written != total || clamped {
        // OQ-3 quirk (ported verbatim): write2 does NOT set
        // last_write_failed, unlike every other write variant.
        poll_change_read_write(s);
    }
    if written < 0 { 0 } else { written as i32 }
}

/// Raw write bypassing TLS framing.
pub(crate) fn raw_write(s: *mut SocketHeader, data: &[u8]) -> i32 {
    // R4.4: gate on the TCP-level shutdown bit only, deliberately NOT the
    // TLS-aware is_shut_down_full — the TLS layer flushes close_notify
    // through here after SSL_shutdown already marked the SSL side shut down.
    {
        let h = ext::header_mut(s);
        if h.is_closed() || h.is_shut_down_raw() {
            return 0;
        }
    }
    let (data, clamped) = clamp_len(data);
    let fd = ext::header_mut(s).fd;
    let written = io::send(fd, data);
    if written != data.len() as isize || clamped {
        mark_backpressure(s);
    }
    if written < 0 { 0 } else { written as i32 }
}

/// One writev; plain-TCP only.
pub(crate) fn raw_writev(s: *mut SocketHeader, iov: &[UsIoVec]) -> i32 {
    // R4.5: same weaker TCP-level gate as raw_write.
    {
        let h = ext::header_mut(s);
        if h.is_closed() || h.is_shut_down_raw() {
            return 0;
        }
    }
    // Total over ALL iovecs; io::writev caps the submitted count at IOV_MAX
    // (1024), so an over-long call always reads as short and arms W (R4.5).
    let total = iov.iter().fold(0u64, |a, v| a.saturating_add(v.len as u64));
    let fd = ext::header_mut(s).fd;
    let written = io::writev(fd, iov);
    // C7: saturate the i32 report; an under-reported write must also read as
    // short so the caller retries the unreported tail.
    let reported = written.min(i32::MAX as isize);
    if written < 0 || written as u64 != total || reported != written {
        mark_backpressure(s);
    }
    if written < 0 { 0 } else { reported as i32 }
}

/// Write that also reports a fatal non-EWOULDBLOCK send error (node:net).
/// Returns `(written, fatal)`; `fatal` is only ever true on the plain path.
pub(crate) fn write_check_error(s: *mut SocketHeader, data: &[u8]) -> (i32, bool) {
    if ext::header_mut(s).is_closed() || is_shut_down_full(s) {
        return (0, false);
    }
    if matches!(ext::header_mut(s).transport, Transport::Tls(_)) {
        // R4.2: TLS errors propagate through the SSL layer; keep that path.
        return (write(s, data), false);
    }
    let (data, clamped) = clamp_len(data);
    let fd = ext::header_mut(s).fd;
    let written = io::send(fd, data);
    if written < 0 {
        if is_would_block(written) || is_transient_send_error(written) {
            mark_backpressure(s);
            return (0, false);
        }
        // R4.2: fatal (EPIPE/ECONNRESET) — report it and do NOT arm
        // writable; a retry can never succeed.
        return (0, true);
    }
    if written != data.len() as isize || clamped {
        mark_backpressure(s);
    }
    (written as i32, false)
}

/// Flush pending kernel corking. R4.6: clears TCP_CORK on Linux, no-op
/// elsewhere; gated on !us_socket_is_shut_down only (no closed gate, verbatim).
pub(crate) fn flush(s: *mut SocketHeader) {
    if !is_shut_down_full(s) {
        io::socket_flush(ext::header_mut(s).fd);
    }
}

/// Mark a short sendfile(2): set `last_write_failed`, arm R|W so the next
/// writable event re-fires on_writable (R4.8; the sendfile syscall itself
/// lives outside the core).
pub(crate) fn sendfile_needs_more(s: *mut SocketHeader) {
    if ext::header_mut(s).is_closed() {
        return;
    }
    mark_backpressure(s);
}

/// Write + SCM_RIGHTS fd pass (SpawnIpc; C14). Contract (R4.10): if the
/// return value < data.len() the fd was NOT transferred and the caller must
/// retry the whole (data, fd) pair.
#[cfg(not(windows))]
pub(crate) fn write_fd(s: *mut SocketHeader, data: &[u8], fd: Fd) -> i32 {
    if ext::header_mut(s).is_closed() || is_shut_down_full(s) {
        return 0;
    }
    let (data, clamped) = clamp_len(data);
    let sock_fd = ext::header_mut(s).fd;
    let sent = io::send_with_fd(sock_fd, data, fd.native());
    if sent != data.len() as isize || clamped {
        mark_backpressure(s);
    }
    if sent < 0 { 0 } else { sent as i32 }
}
