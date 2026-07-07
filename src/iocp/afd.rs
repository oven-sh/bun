#![cfg(windows)]

//! AFD socket-poll backend: level-triggered socket readiness as IOCP
//! completions, via `IOCTL_AFD_POLL` issued straight to the kernel's
//! Auxiliary Function Driver — the only IOCP-compatible readiness primitive
//! Windows has. // quirk: POLL-01
//!
//! Design invariants (each completion-side decision below leans on them):
//!
//! - AFD is level-triggered *at IRP arrival*: the driver checks the socket's
//!   latched poll state when a poll IRP arrives and completes it immediately
//!   if any requested condition already holds — conditions arising while no
//!   IRP is pending are latched, not lost. Each IRP is one-shot, so the
//!   emulation re-arms after every completion. // quirk: POLL-04
//! - An IRP must be pending whenever user code runs in response to a poll
//!   event (re-arm BEFORE callback — Bun's shipped libuv patch): an RST
//!   landing during the callback then completes the fresh IRP instead of
//!   silently latching until the next loop iteration. // quirk: POLL-26
//! - Two alternating requests per handle are necessary and sufficient to
//!   change the event set mid-flight; the `mask_events` algebra suppresses
//!   the double-report when a replacement kicks its predecessor.
//!   // quirk: POLL-15, POLL-16
//! - Spurious readiness is part of the contract: consumers MUST tolerate
//!   would-block reads after a READABLE report (the early re-arm slightly
//!   increases duplicates — accepted cost). // quirk: POLL-25
//!
//! `POLLPRI`/`AFD_POLL_RECEIVE_EXPEDITED` is deliberately not surfaced (no
//! consumer; TCP OOB is dead) // quirk: POLL-20. Modern Wine implements
//! `IOCTL_AFD_POLL` for exactly this usage pattern, but its AFD is a
//! reimplementation — PollState timing may differ when debugging Wine
//! reports. // quirk: POLL-47

use core::cell::UnsafeCell;
use core::ffi::{c_int, c_long, c_uint, c_ulong, c_void};
use core::mem::MaybeUninit;
use core::ptr;

use bun_windows_sys::kernel32::QueueUserWorkItem;
use bun_windows_sys::ntdll::NtDeviceIoControlFile;
use bun_windows_sys::ws2_32::{
    FIONBIO, INVALID_SOCKET, MSAFD_PROVIDER_IDS, SIO_BASE_HANDLE, SIO_BSP_HANDLE_POLL,
    SO_PROTOCOL_INFOW, SOCKET, SOCKET_ERROR, SOL_SOCKET, TIMEVAL, WSA_FLAG_NO_HANDLE_INHERIT,
    WSA_FLAG_OVERLAPPED, WSAGetLastError, WSAIoctl, WSAPROTOCOL_INFOW, WSASocketW, closesocket,
    getsockopt, ioctlsocket, select,
};
use bun_windows_sys::{
    AFD_POLL_ABORT, AFD_POLL_ACCEPT, AFD_POLL_ALL, AFD_POLL_CONNECT_FAIL, AFD_POLL_DISCONNECT,
    AFD_POLL_HANDLE_INFO, AFD_POLL_INFO, AFD_POLL_LOCAL_CLOSE, AFD_POLL_RECEIVE, AFD_POLL_SEND,
    DWORD, HANDLE, IO_STATUS_BLOCK, IOCTL_AFD_POLL, NTSTATUS, OVERLAPPED, ULONG, Win32Error,
};

use crate::event_loop::Loop;
use crate::handle::HandleCore;
use crate::req::{Req, ReqKind};

// Watcher event bits (single byte; composes with plain bitwise ops — "needs
// re-arm" is always derived from (events, submitted_1, submitted_2), never
// cached). // quirk: POLL-49
pub const POLL_READABLE: u8 = 1;
pub const POLL_WRITABLE: u8 = 2;
pub const POLL_DISCONNECT: u8 = 4;
const POLL_ALL_EVENTS: u8 = POLL_READABLE | POLL_WRITABLE | POLL_DISCONNECT;

/// Poll callback: `(loop re-lent, data, triggered events, error)`. On a
/// genuine poll error the watcher is already disarmed, `events` is 0 and
/// `error` is the raw Win32 code (the crate never produces an errno —
/// consumers translate once at their boundary). // quirk: SOCK-58
pub type PollCb = unsafe fn(&mut Loop, *mut c_void, u8, Win32Error);
/// Close callback, run from the endgame once both request slots drained.
pub type PollCloseCb = unsafe fn(&mut Loop, *mut c_void);

const AFD_POLL_INFO_ZERO: AFD_POLL_INFO = AFD_POLL_INFO {
    Timeout: 0,
    NumberOfHandles: 0,
    Exclusive: 0,
    Handles: [AFD_POLL_HANDLE_INFO {
        Handle: ptr::null_mut(),
        Events: 0,
        Status: NTSTATUS(0),
    }],
};

const OVERLAPPED_ZERO: OVERLAPPED = OVERLAPPED {
    Internal: 0,
    InternalHigh: 0,
    Offset: 0,
    OffsetHigh: 0,
    hEvent: ptr::null_mut(),
};

/// Immortal scratch the kernel writes at completion of fire-and-forget
/// cancel polls — possibly long after every frame that knew about the IRP
/// returned, and after the watcher itself was freed; only a process-static
/// is a safe output buffer. Concurrent garbage writes into it are harmless
/// by design. // quirk: POLL-34
struct ImmortalCell<T>(UnsafeCell<T>);
// SAFETY: the cells are written by the kernel (cancel-poll output / IOSB) and
// primed by racing submitters; Rust code never reads their contents, so the
// scratch carries no data anybody consumes.
unsafe impl<T> Sync for ImmortalCell<T> {}

static AFD_POLL_INFO_DUMMY: ImmortalCell<AFD_POLL_INFO> =
    ImmortalCell(UnsafeCell::new(AFD_POLL_INFO_ZERO));

/// The cancel poll's OVERLAPPED. Its `hEvent` is the address 1: a null event
/// with the low tag bit set, so `msafd_poll` passes `Event = NULL,
/// ApcContext = NULL` and the I/O manager queues NO completion packet —
/// without suppression the packet's `lpOverlapped` would point here and the
/// dispatcher would cast it to a garbage `Req`. (libuv allocates a real
/// never-waited event for Win32-level compatibility; at the NT level the
/// event is optional, so we skip the allocation.) // quirk: POLL-33
static OVERLAPPED_DUMMY: ImmortalCell<OVERLAPPED> = ImmortalCell(UnsafeCell::new(OVERLAPPED {
    Internal: 0,
    InternalHigh: 0,
    Offset: 0,
    OffsetHigh: 0,
    hEvent: ptr::without_provenance_mut(1),
}));

/// Heap block handed to the system-pool worker: its private input snapshot
/// plus its result slot. Allocated by submit, written by the worker, read
/// and freed by the dispatcher — the worker never touches `AfdPoll` memory,
/// so the loop thread's `&mut` borrows never alias worker accesses.
/// // quirk: POLL-38
struct SlowWork {
    socket: SOCKET,
    events: u8,
    iocp: HANDLE,
    /// The slot req's OVERLAPPED address, passed BY VALUE to
    /// `PostQueuedCompletionStatus`; the worker never dereferences it.
    overlapped: *mut OVERLAPPED,
    /// `SUCCESS` + `reported`, or the `select()` error.
    error: Win32Error,
    reported: u8,
}

/// `{u_int fd_count; SOCKET fd_array[1]}` — `select()` only reads the
/// `{count, array}` ABI prefix, so a one-slot set is valid. // quirk: POLL-40
#[repr(C)]
struct SingleFdSet {
    fd_count: c_uint,
    fd_array: [SOCKET; 1],
}

/// One AFD poll watcher. Heap-pinned by its owner (`init` returns a `Box`)
/// for as long as it is active or has requests in flight: the kernel writes
/// into the embedded reqs' OVERLAPPEDs and `afd_poll_info_X` until each
/// completion is dequeued, which is why destruction is gated on BOTH slots
/// draining through the endgame protocol. // quirk: POLL-35, LOOP-04
#[repr(C)]
pub struct AfdPoll {
    core: HandleCore,
    /// The base (LSP-unwrapped) socket every poll targets. The user keeps
    /// doing I/O on their wrapper — same kernel FCB, so readiness agrees.
    /// // quirk: POLL-11
    socket: SOCKET,
    /// Fast-mode conduit (loop-owned cache entry; never closed here).
    peer_socket: SOCKET,
    /// select()-on-thread fallback for non-MSAFD providers. // quirk: POLL-38
    slow: bool,
    events: u8,
    cb: Option<PollCb>,
    data: *mut c_void,
    close_cb: Option<PollCloseCb>,
    req_1: Req,
    req_2: Req,
    afd_poll_info_1: AFD_POLL_INFO,
    afd_poll_info_2: AFD_POLL_INFO,
    submitted_events_1: u8,
    submitted_events_2: u8,
    mask_events_1: u8,
    mask_events_2: u8,
    slow_work_1: *mut SlowWork,
    slow_work_2: *mut SlowWork,
}

impl AfdPoll {
    /// Create a watcher for `socket` on `loop_`. Puts the socket in
    /// non-blocking mode, unwraps LSP layering to the base handle, and
    /// classifies the provider: MSAFD providers poll via AFD through a
    /// per-loop peer socket; anything else degrades to the `select()` slow
    /// path. Fails with `ERROR_ALREADY_EXISTS` if the loop already watches
    /// this base socket (two watchers kick each other's Exclusive IRPs into
    /// a busyloop). // quirk: POLL-37
    ///
    /// # Safety
    /// `loop_` must be a valid pinned loop that outlives the watcher. The
    /// caller owns `socket` and must keep it open while polling is active,
    /// and must keep the returned box alive until the close callback runs.
    pub unsafe fn init(loop_: *mut Loop, socket: SOCKET) -> Result<Box<AfdPoll>, Win32Error> {
        // SAFETY: fn contract — `loop_` valid and pinned, `socket` owned by
        // the caller; winsock calls only read/write valid locals.
        unsafe {
            // Non-blocking on the caller's behalf, on the wrapper socket so
            // it propagates down any LSP chain. // quirk: POLL-13
            let mut yes: c_ulong = 1;
            if ioctlsocket(socket, FIONBIO, &raw mut yes) == SOCKET_ERROR {
                return Err(wsa_error());
            }

            let base = unwrap_base_socket(socket);

            if (*loop_).poll_watched_sockets.contains(&base) {
                return Err(Win32Error::ALREADY_EXISTS); // quirk: POLL-37
            }

            // Identify the bottom provider; a dead/invalid socket surfaces
            // here, at init, not on a later completion. // quirk: POLL-14
            let mut info = MaybeUninit::<WSAPROTOCOL_INFOW>::zeroed();
            let mut len = size_of::<WSAPROTOCOL_INFOW>() as c_int;
            if getsockopt(
                base,
                SOL_SOCKET,
                SO_PROTOCOL_INFOW,
                info.as_mut_ptr().cast::<u8>(),
                &raw mut len,
            ) != 0
            {
                return Err(wsa_error());
            }
            let info = info.assume_init();

            let peer = peer_socket_for(loop_, &info);
            let slow = peer == INVALID_SOCKET; // quirk: POLL-38

            let mut handle = Box::new(AfdPoll {
                core: HandleCore::new(loop_, poll_endgame),
                socket: base,
                peer_socket: peer,
                slow,
                events: 0,
                cb: None,
                data: ptr::null_mut(),
                close_cb: None,
                req_1: Req::new(ReqKind::Poll, ptr::null_mut()),
                req_2: Req::new(ReqKind::Poll, ptr::null_mut()),
                afd_poll_info_1: AFD_POLL_INFO_ZERO,
                afd_poll_info_2: AFD_POLL_INFO_ZERO,
                submitted_events_1: 0,
                submitted_events_2: 0,
                mask_events_1: 0,
                mask_events_2: 0,
                slow_work_1: ptr::null_mut(),
                slow_work_2: ptr::null_mut(),
            });
            // The reqs' owner back-pointer is the heap-pinned final address.
            let hp: *mut AfdPoll = &raw mut *handle;
            handle.req_1 = Req::new(ReqKind::Poll, hp.cast::<c_void>());
            handle.req_2 = Req::new(ReqKind::Poll, hp.cast::<c_void>());

            (*loop_).poll_watched_sockets.push(base);
            Ok(handle)
        }
    }

    /// Start or change the watched event set (uv_poll_start/`us_poll_change`
    /// semantics): replaces `events`/`cb`/`data`; `events == 0` is stop. Only
    /// the missing delta is submitted — an in-flight request whose mask
    /// already covers `events` is reused as-is. Safe to call from inside the
    /// poll callback. // quirk: POLL-27, POLL-36
    pub fn set(&mut self, events: u8, cb: PollCb, data: *mut c_void) {
        debug_assert!(!self.core.is_closing());
        debug_assert!(events & !POLL_ALL_EVENTS == 0);
        self.events = events;
        self.cb = Some(cb);
        self.data = data;
        if events == 0 {
            self.core.stop();
            return;
        }
        self.core.start();
        if self.events & !(self.submitted_events_1 | self.submitted_events_2) != 0 {
            let lp = self.core.loop_;
            let hp: *mut AfdPoll = self;
            // SAFETY: `self` is live (we're in a method) and the loop
            // outlives the handle (init contract).
            unsafe { submit_poll_req(lp, hp) };
        }
    }

    /// Stop watching. Clears the event mask but does NOT cancel the in-flight
    /// IRP: it keeps watching, its eventual completion is filtered to
    /// nothing, and a later `set` whose mask it covers reuses it. This is
    /// what makes "close the fd right after stop" safe. // quirk: POLL-36
    pub fn stop(&mut self) {
        debug_assert!(!self.core.is_closing());
        self.events = 0;
        self.core.stop();
    }

    /// Drop this watcher's loop keep-alive without stopping it: events keep
    /// flowing, but an otherwise-idle loop may exit. uSockets registers
    /// every poll unref'd — only timers and explicit refs keep its loop
    /// alive. Close still holds the loop until the close callback.
    pub fn unref(&mut self) {
        self.core.unref();
    }

    /// Restore the loop keep-alive dropped by [`unref`](Self::unref).
    pub fn ref_(&mut self) {
        self.core.ref_();
    }

    /// Begin the asynchronous close. Pending fast-path IRPs are forced to
    /// complete by a dummy EXCLUSIVE poll on the watched socket itself
    /// (`CancelIoEx` cannot reach them — they were issued through the peer);
    /// slow-path workers are waited out (bounded by the select safety
    /// timeout). `close_cb` runs from the loop once both request slots have
    /// drained; only then may the owner free the box.
    /// // quirk: POLL-32, POLL-42, POLL-35
    pub fn close(&mut self, close_cb: Option<PollCloseCb>) {
        self.events = 0;
        self.close_cb = close_cb;

        if (self.submitted_events_1 | self.submitted_events_2) != 0 && !self.slow {
            // All three knobs are load-bearing: Exclusive kicks the pending
            // polls for this socket's FCB, the infinite timeout keeps the
            // cancel from completing itself without kicking anything, and
            // ALL events make it match regardless of mask. Stack INPUT is
            // safe (METHOD_BUFFERED copies it at submit); the OUTPUT and
            // OVERLAPPED are immortal statics. Fire-and-forget: the IRP may
            // linger until the socket closes, its packet is suppressed, and
            // failure only means the pending polls drain when the socket
            // does. // quirk: POLL-32, POLL-33, POLL-34, POLL-18
            let mut cancel = AFD_POLL_INFO {
                Timeout: i64::MAX,
                NumberOfHandles: 1,
                Exclusive: 1,
                Handles: [AFD_POLL_HANDLE_INFO {
                    Handle: ptr::with_exposed_provenance_mut::<c_void>(self.socket),
                    Events: AFD_POLL_ALL,
                    Status: NTSTATUS(0),
                }],
            };
            // SAFETY: `cancel` is a valid local (copied by the I/O manager at
            // submit); output/overlapped are 'static; the socket is still
            // open (close precedes the owner releasing it).
            unsafe {
                msafd_poll(
                    self.socket,
                    &raw mut cancel,
                    AFD_POLL_INFO_DUMMY.0.get(),
                    OVERLAPPED_DUMMY.0.get(),
                );
            }
        }

        // The same-socket guard ends at close: no new IRPs will target this
        // socket from this watcher. // quirk: POLL-37
        // SAFETY: the loop outlives the handle (init contract).
        unsafe {
            let lp = self.core.loop_;
            if let Some(i) = (*lp)
                .poll_watched_sockets
                .iter()
                .position(|&s| s == self.socket)
            {
                (*lp).poll_watched_sockets.swap_remove(i);
            }
        }

        self.core.close();
    }
}

#[inline]
fn wsa_error() -> Win32Error {
    Win32Error::from_raw(WSAGetLastError() as u16)
}

/// Unwrap LSP layering to the base AFD socket. `SIO_BASE_HANDLE` goes
/// straight to the bottom; Komodia-family LSPs break it deliberately but not
/// `SIO_BSP_HANDLE_POLL`, which peels one layer — alternate the two, bounded
/// (real chains are short; the bound defends against a hostile LSP loop).
/// Total failure is tolerated: the provider check then decides fast vs slow
/// on the wrapper. // quirk: POLL-11, POLL-12
unsafe fn unwrap_base_socket(socket: SOCKET) -> SOCKET {
    let mut current = socket;
    for _ in 0..8 {
        // SAFETY: WSAIoctl writes a SOCKET-sized out value through valid
        // local pointers.
        if let Some(base) = unsafe { wsa_ioctl_get_socket(current, SIO_BASE_HANDLE) } {
            debug_assert!(base != 0 && base != INVALID_SOCKET);
            return base;
        }
        // SAFETY: same as above.
        match unsafe { wsa_ioctl_get_socket(current, SIO_BSP_HANDLE_POLL) } {
            Some(next) if next != current && next != 0 && next != INVALID_SOCKET => current = next,
            _ => break,
        }
    }
    current
}

/// # Safety
/// `s` must be a socket the caller owns; the ioctl writes one SOCKET.
unsafe fn wsa_ioctl_get_socket(s: SOCKET, code: DWORD) -> Option<SOCKET> {
    let mut out: SOCKET = INVALID_SOCKET;
    let mut bytes: DWORD = 0;
    // SAFETY: out/bytes are valid locals sized to the request; no overlapped.
    let r = unsafe {
        WSAIoctl(
            s,
            code,
            ptr::null_mut(),
            0,
            (&raw mut out).cast::<c_void>(),
            size_of::<SOCKET>() as DWORD,
            &raw mut bytes,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if r == 0 { Some(out) } else { None }
}

/// The per-(loop, provider) peer socket every fast poll is issued through.
/// A handle can be associated with exactly one IOCP forever, so the user's
/// socket can't deliver completions to this loop — but AFD lets one AFD
/// handle poll a *different* socket, with the completion delivered through
/// the issuing handle's association. // quirk: POLL-05
///
/// # Safety
/// `lp` must be a valid pinned loop.
unsafe fn peer_socket_for(lp: *mut Loop, info: &WSAPROTOCOL_INFOW) -> SOCKET {
    // Whitelist: only MSAFD sockets are AFD handles that understand
    // IOCTL_AFD_POLL; other providers (SAN, replacing VPN/AV providers,
    // AF_HYPERV) get the slow path. // quirk: POLL-07
    let Some(index) = MSAFD_PROVIDER_IDS
        .iter()
        .position(|g| *g == info.ProviderId)
    else {
        return INVALID_SOCKET;
    };
    // SAFETY: fn contract — `lp` valid; the cache slot is loop-private.
    unsafe {
        // 3-state cache: 0 = never tried, INVALID_SOCKET = tried-and-failed
        // (a broken provider is never hammered with retries), else valid.
        // // quirk: POLL-08
        let cached = (*lp).poll_peer_sockets[index];
        if cached != 0 {
            return cached;
        }
        let created = create_peer_socket(lp, info);
        (*lp).poll_peer_sockets[index] = created;
        created
    }
}

/// # Safety
/// `lp` must be a valid pinned loop.
unsafe fn create_peer_socket(lp: *mut Loop, info: &WSAPROTOCOL_INFOW) -> SOCKET {
    // From the watched socket's own (base) catalog entry — bypasses any LSP
    // layered on the default chain — overlapped, and never inheritable
    // (atomic at creation; no SetHandleInformation race).
    // // quirk: POLL-06, POLL-10
    let mut info_copy = *info;
    // SAFETY: `info_copy` is a valid local WSAPROTOCOL_INFOW.
    let sock = unsafe {
        WSASocketW(
            info.iAddressFamily,
            info.iSocketType,
            info.iProtocol,
            &raw mut info_copy,
            0,
            WSA_FLAG_OVERLAPPED | WSA_FLAG_NO_HANDLE_INHERIT,
        )
    };
    if sock == INVALID_SOCKET {
        return INVALID_SOCKET;
    }
    // The key is never consulted — dispatch is purely by OVERLAPPED pointer.
    // On association failure the socket is useless as a conduit: close it.
    // // quirk: POLL-09
    // SAFETY: fn contract — `lp` valid; `sock` is a fresh overlapped socket.
    if unsafe { (*lp).associate(ptr::with_exposed_provenance_mut::<c_void>(sock), sock) }.is_err() {
        // SAFETY: `sock` was created above and not yet shared.
        unsafe { closesocket(sock) };
        return INVALID_SOCKET;
    }
    sock
}

/// Map watcher bits to AFD request bits. READABLE implies ACCEPT, DISCONNECT
/// and ABORT (an RST must wake a read so it observes ECONNRESET);
/// DISCONNECT-only deliberately carries no ABORT (libuv parity — RST is not
/// reported to a DISCONNECT-only watcher); WRITABLE implies CONNECT_FAIL
/// (select()'s exceptfds behavior: a failed connect reports writable).
/// // quirk: POLL-19
fn afd_events_from(events: u8) -> ULONG {
    let mut afd: ULONG = 0;
    if events & POLL_READABLE != 0 {
        afd |= AFD_POLL_RECEIVE | AFD_POLL_DISCONNECT | AFD_POLL_ACCEPT | AFD_POLL_ABORT;
    } else if events & POLL_DISCONNECT != 0 {
        afd |= AFD_POLL_DISCONNECT;
    }
    if events & POLL_WRITABLE != 0 {
        afd |= AFD_POLL_SEND | AFD_POLL_CONNECT_FAIL;
    }
    afd
}

/// Map completed AFD bits back to watcher bits: RECEIVE/ACCEPT/DISCONNECT/
/// ABORT are readable (DISCONNECT additionally sets POLL_DISCONNECT);
/// SEND/CONNECT_FAIL are writable. // quirk: POLL-21
fn events_from_afd(afd: ULONG) -> u8 {
    let mut events = 0u8;
    if afd & (AFD_POLL_RECEIVE | AFD_POLL_DISCONNECT | AFD_POLL_ACCEPT | AFD_POLL_ABORT) != 0 {
        events |= POLL_READABLE;
        if afd & AFD_POLL_DISCONNECT != 0 {
            events |= POLL_DISCONNECT;
        }
    }
    if afd & (AFD_POLL_SEND | AFD_POLL_CONNECT_FAIL) != 0 {
        events |= POLL_WRITABLE;
    }
    events
}

/// Issue `IOCTL_AFD_POLL` through `socket`. The OVERLAPPED's Internal pair
/// doubles as the IO_STATUS_BLOCK (primed to STATUS_PENDING so stale state
/// can never read as completed); a tagged `hEvent` (low bit set) routes
/// `ApcContext = NULL` so NO completion packet is posted — every
/// fire-and-forget submission must suppress its packet. Returns the
/// submission NTSTATUS: SUCCESS and PENDING both mean "a packet will arrive"
/// for untagged submissions, because the conduit never gets
/// skip-completion-port mode. // quirk: POLL-29, POLL-30, POLL-31, POLL-33, POLL-43
///
/// # Safety
/// `info_in`/`info_out`/`overlapped` must be valid for the kernel to read or
/// write; `info_out` and `overlapped` must stay valid until the IRP
/// completes (for suppressed submissions that can be arbitrarily later —
/// pass immortal statics).
unsafe fn msafd_poll(
    socket: SOCKET,
    info_in: *mut AFD_POLL_INFO,
    info_out: *mut AFD_POLL_INFO,
    overlapped: *mut OVERLAPPED,
) -> NTSTATUS {
    // SAFETY: fn contract — all pointers valid for the operation's lifetime;
    // the OVERLAPPED prefix is layout-compatible with IO_STATUS_BLOCK.
    unsafe {
        let iosb = overlapped.cast::<IO_STATUS_BLOCK>();
        let raw_event = (*overlapped).hEvent;
        let (event, apc_context) = if raw_event.addr() & 1 != 0 {
            (raw_event.map_addr(|a| a & !1), ptr::null_mut())
        } else {
            (raw_event, overlapped.cast::<c_void>())
        };
        (*iosb).Status = NTSTATUS::PENDING.0 as usize;
        NtDeviceIoControlFile(
            ptr::with_exposed_provenance_mut::<c_void>(socket),
            event,
            ptr::null_mut(),
            apc_context,
            iosb,
            IOCTL_AFD_POLL,
            info_in.cast::<c_void>(),
            size_of::<AFD_POLL_INFO>() as ULONG,
            info_out.cast::<c_void>(),
            size_of::<AFD_POLL_INFO>() as ULONG,
        )
    }
}

/// Submit a poll request into a free slot, or return if both are busy (the
/// latest submission was Exclusive and is kicking the other; the tail
/// re-check after that completion submits the delta). Submitting slot X
/// suppresses from the OTHER slot everything the new request now covers —
/// the algebra that prevents double-reporting when a replacement kicks its
/// predecessor. // quirk: POLL-15, POLL-16
///
/// # Safety
/// `lp` and `h` must be valid and pinned; the handle must not be closing.
unsafe fn submit_poll_req(lp: *mut Loop, h: *mut AfdPoll) {
    // SAFETY: fn contract; all interior pointers derive from the pinned
    // handle and stay valid while the kernel holds them (endgame gating).
    unsafe {
        let events = (*h).events;
        let (req, info): (*mut Req, *mut AFD_POLL_INFO) = if (*h).submitted_events_1 == 0 {
            (*h).submitted_events_1 = events;
            (*h).mask_events_1 = 0;
            (*h).mask_events_2 = events;
            (&raw mut (*h).req_1, &raw mut (*h).afd_poll_info_1)
        } else if (*h).submitted_events_2 == 0 {
            (*h).submitted_events_2 = events;
            (*h).mask_events_1 = events;
            (*h).mask_events_2 = 0;
            (&raw mut (*h).req_2, &raw mut (*h).afd_poll_info_2)
        } else {
            return;
        };

        *(*req).overlapped_ptr() = OVERLAPPED_ZERO; // quirk: POLL-29
        if (*h).slow {
            // Slow-path workers DO hold the loop: a system-pool thread must
            // never post to a port the loop already closed. // quirk: POLL-42
            (*h).core.req_submitted();
        } else {
            // Fast AFD IRPs do not hold the loop — an unref'd watcher with a
            // parked IRP must let the loop exit (libuv never registers poll
            // reqs). The endgame still waits for the drain.
            (*h).core.req_submitted_uncounted();
        }

        if !(*h).slow {
            // Exclusive=TRUE makes any other pending poll for the same
            // TARGET socket (kernel FCB) return — cancel-by-resubmit; the
            // infinite timeout keeps AFD from ever timing the poll out
            // itself. // quirk: POLL-17, POLL-18
            (*info).Exclusive = 1;
            (*info).NumberOfHandles = 1;
            (*info).Timeout = i64::MAX;
            (*info).Handles[0] = AFD_POLL_HANDLE_INFO {
                Handle: ptr::with_exposed_provenance_mut::<c_void>((*h).socket),
                Events: afd_events_from(events),
                Status: NTSTATUS(0),
            };
            let status = msafd_poll((*h).peer_socket, info, info, (*req).overlapped_ptr());
            if status != NTSTATUS::SUCCESS && status != NTSTATUS::PENDING {
                // Synchronous failure becomes an asynchronous completion via
                // the pending queue — one error-delivery funnel; the slot
                // stays "in flight" until dispatched. // quirk: POLL-28
                (*req).set_status(status);
                (*lp).insert_pending(req);
            }
        } else {
            let work = Box::into_raw(Box::new(SlowWork {
                socket: (*h).socket,
                events,
                iocp: (*lp).iocp(),
                overlapped: (*req).overlapped_ptr(),
                error: Win32Error::SUCCESS,
                reported: 0,
            }));
            if core::ptr::eq(req, &raw mut (*h).req_1) {
                (*h).slow_work_1 = work;
            } else {
                (*h).slow_work_2 = work;
            }
            // The SYSTEM pool, not a Bun pool: the crate stays tier-0 and the
            // 3-minute select can't starve runtime workers. // quirk: POLL-38
            if QueueUserWorkItem(
                slow_poll_thread_proc,
                work.cast::<c_void>(),
                bun_windows_sys::kernel32::WT_EXECUTELONGFUNCTION,
            ) == 0
            {
                // Capture before the dealloc below can clobber last-error.
                let err = Win32Error::get();
                if core::ptr::eq(req, &raw mut (*h).req_1) {
                    (*h).slow_work_1 = ptr::null_mut();
                } else {
                    (*h).slow_work_2 = ptr::null_mut();
                }
                drop(Box::from_raw(work));
                (*req).set_error(err);
                (*lp).insert_pending(req); // quirk: POLL-28
            }
        }
    }
}

/// Slow-path worker, on a system-pool thread: one bounded `select()` on the
/// snapshot, result posted back as a completion packet. The select times out
/// after 3 minutes so a socket closed under it cannot hang the watcher
/// forever (a timeout completes with no events and the tail re-polls).
/// // quirk: POLL-38, POLL-39
unsafe extern "system" fn slow_poll_thread_proc(arg: *mut c_void) -> DWORD {
    // SAFETY: `arg` is the SlowWork leaked by submit; the worker owns it
    // exclusively until the completion packet is posted, and touches nothing
    // else.
    unsafe {
        let work = &mut *arg.cast::<SlowWork>();

        let mut rfds = SingleFdSet {
            fd_count: 0,
            fd_array: [work.socket],
        };
        let mut wfds = SingleFdSet {
            fd_count: 0,
            fd_array: [work.socket],
        };
        let mut efds = SingleFdSet {
            fd_count: 0,
            fd_array: [work.socket],
        };
        if work.events & POLL_READABLE != 0 {
            rfds.fd_count = 1;
        }
        if work.events & POLL_WRITABLE != 0 {
            // exceptfds because a failed non-blocking connect is signaled
            // via the except set, mirrored to writable below — the
            // select()-side spelling of AFD_POLL_CONNECT_FAIL.
            // // quirk: POLL-40, POLL-21
            wfds.fd_count = 1;
            efds.fd_count = 1;
        }
        let timeout = TIMEVAL {
            tv_sec: 3 * 60 as c_long,
            tv_usec: 0,
        };

        let r = select(
            1,
            (&raw mut rfds).cast::<c_void>(),
            (&raw mut wfds).cast::<c_void>(),
            (&raw mut efds).cast::<c_void>(),
            &raw const timeout,
        );
        if r == SOCKET_ERROR {
            // Recorded on THIS request's block — upstream libuv writes the
            // error to req_1 even when req_2 failed (latent since 2012); do
            // not copy that. // quirk: POLL-41
            work.error = wsa_error();
        } else {
            work.error = Win32Error::SUCCESS;
            let mut reported = 0u8;
            if r > 0 {
                if rfds.fd_count > 0 {
                    debug_assert!(rfds.fd_array[0] == work.socket);
                    reported |= POLL_READABLE;
                }
                if wfds.fd_count > 0 || efds.fd_count > 0 {
                    reported |= POLL_WRITABLE;
                }
            }
            work.reported = reported;
        }

        let iocp = work.iocp;
        let overlapped = work.overlapped;
        // After this post the loop thread owns the block again; the worker
        // must not touch it (or the overlapped) afterwards.
        crate::event_loop::post_or_die(iocp, 0, 0, overlapped, "afd poll");
        0
    }
}

/// Process one completed poll request — the single delivery path for kernel
/// completions, slow-path posts, and locally-failed submissions.
pub(crate) fn process_poll_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<AfdPoll>();
    // SAFETY: `data` was set at init to the heap-pinned AfdPoll, which the
    // endgame protocol keeps alive until both slots drain (// quirk: POLL-35);
    // borrows of the handle and loop are short-lived and never held across
    // the user callback (// quirk: POLL-27).
    unsafe {
        // Resolve the completed slot, free it, take its suppression mask.
        let (mask, info, slow_work) = if core::ptr::eq(req_ptr, &raw mut (*h).req_1) {
            (*h).submitted_events_1 = 0;
            let work = core::mem::replace(&mut (*h).slow_work_1, ptr::null_mut());
            ((*h).mask_events_1, &raw mut (*h).afd_poll_info_1, work)
        } else {
            debug_assert!(core::ptr::eq(req_ptr, &raw mut (*h).req_2));
            (*h).submitted_events_2 = 0;
            let work = core::mem::replace(&mut (*h).slow_work_2, ptr::null_mut());
            ((*h).mask_events_2, &raw mut (*h).afd_poll_info_2, work)
        };
        // May queue the endgame when this was the last in-flight request of
        // a closing handle; the endgame itself runs later, from the loop.
        // Accounting mirrors submit: only slow-path requests held the loop.
        // // quirk: POLL-35
        if (*h).slow {
            (*h).core.req_completed();
        } else {
            (*h).core.req_completed_uncounted();
        }

        // Mode-specific result extraction.
        let mut error: Option<Win32Error> = None;
        let mut deliver: u8 = 0;
        let mut rearm_before_cb = false;

        // Genuine errors dispatch even when the subscribed mask is empty
        // (a stopped watcher still learns its socket died — epoll parity,
        // USOCKETS_EVENTING_CONTRACT hazard 8; deliberate deviation from
        // libuv's `events != 0` error gate). Only a CLOSING handle is past
        // delivery — its contract is the close callback.
        let deliverable = !(*h).core.is_closing();

        if !(*h).slow {
            let status = (*req_ptr).status();
            if !(*req_ptr).success() {
                // Cancelled/kicked IRPs (Exclusive replacement, handle close,
                // external CancelIoEx) re-arm silently below — cancellation
                // is "re-arm", never an error. // quirk: POLL-23
                if status != NTSTATUS::CANCELLED
                    && status != NTSTATUS::REQUEST_ABORTED
                    && deliverable
                {
                    error = Some((*req_ptr).error());
                }
            } else if (*info).NumberOfHandles >= 1 {
                // A kicked IRP can also complete "successfully" with zero
                // handles — silent. // quirk: POLL-17
                let afd = (*info).Handles[0].Events;
                // Filter to what's still wanted minus what the OTHER
                // (replacement) request will re-report. // quirk: POLL-16
                deliver = events_from_afd(afd) & (*h).events & !mask;

                if afd & AFD_POLL_LOCAL_CLOSE != 0 {
                    // The watched socket was closed locally: its handle value
                    // can be recycled, so continuing to poll would watch the
                    // wrong socket. Stop — guarded, because the handle may
                    // already be closing when this drains (double-stop would
                    // corrupt the loop's accounting). // quirk: POLL-22
                    (*h).events = 0;
                    if (*h).core.is_active() && !(*h).core.is_closing() {
                        (*h).core.stop();
                    }
                }
                rearm_before_cb = true;
            }
        } else if !slow_work.is_null() {
            let work = Box::from_raw(slow_work);
            if work.error != Win32Error::SUCCESS {
                if deliverable {
                    error = Some(work.error);
                }
            } else {
                deliver = work.reported & (*h).events & !mask; // quirk: POLL-16
                rearm_before_cb = true;
            }
        } else {
            // QueueUserWorkItem failed synchronously; the error traveled on
            // the req through the pending queue. // quirk: POLL-28
            debug_assert!(!(*req_ptr).success());
            if deliverable {
                error = Some((*req_ptr).error());
            }
        }

        if let Some(err) = error {
            // Disarm BEFORE the callback: resubmitting after a genuine error
            // would spin (the same error completes immediately, forever).
            // The callback may legitimately restart the watcher.
            // // quirk: POLL-24
            (*h).events = 0;
            if let Some(cb) = (*h).cb {
                cb(&mut *lp, (*h).data, 0, err);
            }
        } else if rearm_before_cb {
            // Re-arm BEFORE invoking the callback so an IRP is pending while
            // user code runs: a transition (e.g. RST from an in-process
            // loopback peer) landing during the callback completes the fresh
            // IRP and its packet is already queued when anything next polls
            // the IOCP. Safe because AFD is level-triggered at IRP arrival —
            // early re-arm loses nothing, and double-reports are absorbed by
            // the mask algebra above. // quirk: POLL-26, POLL-04
            if (*h).events & !((*h).submitted_events_1 | (*h).submitted_events_2) != 0 {
                submit_poll_req(lp, h);
            }
            if deliver != 0 {
                if let Some(cb) = (*h).cb {
                    cb(&mut *lp, (*h).data, deliver, Win32Error::SUCCESS);
                }
            }
        }

        // The callback may have called set/stop/close — re-derive from
        // current state, never from anything cached across it. This re-submit
        // covers the filtered/no-events path and a mask the callback changed
        // while both slots were busy; the close endgame is queued by
        // req_completed above. // quirk: POLL-27, POLL-23
        if !(*h).core.is_closing()
            && (*h).events & !((*h).submitted_events_1 | (*h).submitted_events_2) != 0
        {
            submit_poll_req(lp, h);
        }
    }
}

/// Endgame: both slots have drained (asserted), the handle is releasable.
/// Nothing OS-side to free — the watched socket belongs to the embedder and
/// the peer conduit to the loop. // quirk: POLL-35
unsafe fn poll_endgame(core: *mut HandleCore) {
    // SAFETY: the endgame drain passes the live, queued handle; `core` is the
    // first field of the #[repr(C)] AfdPoll.
    unsafe {
        let h = core.cast::<AfdPoll>();
        debug_assert!((*h).submitted_events_1 == 0 && (*h).submitted_events_2 == 0);
        let lp = (*h).core.loop_;
        let data = (*h).data;
        if let Some(cb) = (*h).close_cb.take() {
            cb(&mut *lp, data);
        }
    }
}
#[cfg(test)]
mod tests {
    use std::sync::Once;

    use bun_windows_sys::OVERLAPPED_ENTRY;
    use bun_windows_sys::kernel32::GetQueuedCompletionStatusEx;
    use bun_windows_sys::ws2_32::{
        AF_INET, IPPROTO_TCP, LINGER, SO_LINGER, SOCK_STREAM, WSADATA, WSAStartup, accept, bind,
        connect, getsockname, in_addr, listen, send, setsockopt, sockaddr_in,
    };

    use super::*;
    use crate::test_sync::serial;

    fn wsa_startup() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let mut data = MaybeUninit::<WSADATA>::zeroed();
            // SAFETY: valid out-pointer; winsock 2.2 always available.
            let r = unsafe { WSAStartup(0x0202, data.as_mut_ptr()) };
            assert_eq!(r, 0);
        });
    }

    fn tcp_socket() -> SOCKET {
        // SAFETY: no pointers besides the null protocol info.
        let s = unsafe {
            WSASocketW(
                AF_INET,
                SOCK_STREAM,
                IPPROTO_TCP,
                ptr::null_mut(),
                0,
                WSA_FLAG_OVERLAPPED | WSA_FLAG_NO_HANDLE_INHERIT,
            )
        };
        assert_ne!(s, INVALID_SOCKET);
        s
    }

    /// Connected loopback TCP pair `(accepted, client)`.
    fn loopback_pair() -> (SOCKET, SOCKET) {
        wsa_startup();
        // SAFETY: standard winsock loopback plumbing over valid locals.
        unsafe {
            let listener = tcp_socket();
            let mut addr = sockaddr_in {
                sin_family: AF_INET as u16,
                sin_port: 0,
                sin_addr: in_addr {
                    s_addr: 0x7f00_0001u32.to_be(),
                },
                sin_zero: [0; 8],
            };
            let addr_len = size_of::<sockaddr_in>() as c_int;
            assert_eq!(bind(listener, (&raw const addr).cast(), addr_len), 0);
            let mut len = addr_len;
            assert_eq!(
                getsockname(listener, (&raw mut addr).cast(), &raw mut len),
                0
            );
            assert_eq!(listen(listener, 1), 0);
            let client = tcp_socket();
            assert_eq!(connect(client, (&raw const addr).cast(), addr_len), 0);
            let accepted = accept(listener, ptr::null_mut(), ptr::null_mut());
            assert_ne!(accepted, INVALID_SOCKET);
            closesocket(listener);
            (accepted, client)
        }
    }

    fn send_byte(s: SOCKET) {
        // SAFETY: one-byte send from a static buffer.
        let n = unsafe { send(s, b"x".as_ptr().cast::<c_void>(), 1, 0) };
        assert_eq!(n, 1);
    }

    /// SO_LINGER{1,0} + closesocket: the close sends RST, not FIN.
    fn rst_close(s: SOCKET) {
        let linger = LINGER {
            l_onoff: 1,
            l_linger: 0,
        };
        // SAFETY: valid local option buffer; `s` is owned by the test.
        unsafe {
            assert_eq!(
                setsockopt(
                    s,
                    SOL_SOCKET,
                    SO_LINGER,
                    (&raw const linger).cast::<u8>(),
                    size_of::<LINGER>() as c_int,
                ),
                0
            );
            closesocket(s);
        }
    }

    /// Shared recording context. Callbacks only RECORD — every behavioral
    /// assertion runs after teardown, so a failing assertion never panics
    /// across a live loop (whose Drop would double-panic into a process
    /// abort and eat the real failure message).
    #[repr(C)]
    struct Ctx {
        closed: bool,
        handle: *mut AfdPoll,
        peer: SOCKET,
        fires: u32,
        events_seen: Vec<u8>,
        errors_seen: Vec<Win32Error>,
        probe_ok: bool,
    }

    impl Ctx {
        fn new() -> Ctx {
            Ctx {
                closed: false,
                handle: ptr::null_mut(),
                peer: INVALID_SOCKET,
                fires: 0,
                events_seen: Vec::new(),
                errors_seen: Vec::new(),
                probe_ok: false,
            }
        }
    }

    /// `close_cb` receives the handle's `data`, i.e. the ctx.
    unsafe fn mark_closed(_l: &mut Loop, d: *mut c_void) {
        // SAFETY: `d` is the test Ctx (repr(C), `closed` first).
        unsafe { (*d.cast::<Ctx>()).closed = true };
    }

    /// Record-only poll callback; variants below add per-test behavior.
    unsafe fn record_cb(_l: &mut Loop, d: *mut c_void, events: u8, err: Win32Error) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.fires += 1;
            ctx.events_seen.push(events);
            ctx.errors_seen.push(err);
        }
    }

    /// Record + stop the watcher (single-shot observation).
    unsafe fn record_stop_cb(l: &mut Loop, d: *mut c_void, events: u8, err: Win32Error) {
        // SAFETY: `d` is the test Ctx; `handle` is the live boxed poll.
        unsafe {
            record_cb(l, d, events, err);
            let ctx = &mut *d.cast::<Ctx>();
            (*ctx.handle).stop();
        }
    }

    fn drain_closed(loop_: &mut Loop, ctx: &Ctx, ms: u64) {
        let deadline = loop_.now_ms() + ms;
        while !ctx.closed && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
    }

    /// THE gate: an AFD poll IRP must be
    /// pending whenever user code runs in response to a poll event. Inside
    /// the first callback the peer RSTs the connection, and a zero-timeout
    /// GQCS probe on the loop's port — WITHOUT re-entering dispatch — must
    /// observe a completion for the re-armed poll. Deleting the
    /// rearm-before-callback ordering makes the probe time out
    /// deterministically: with no IRP pending, the transition only latches
    /// in AFD's PollState and no packet can arrive until after the callback
    /// returns. // quirk: POLL-26
    #[test]
    fn irp_pending_during_callback() {
        let _guard = serial();
        unsafe fn cb(l: &mut Loop, d: *mut c_void, events: u8, err: Win32Error) {
            // SAFETY: `d` is the test Ctx; `handle` is the live boxed poll.
            unsafe {
                record_cb(l, d, events, err);
                let ctx = &mut *d.cast::<Ctx>();
                if ctx.fires == 1 {
                    rst_close(ctx.peer);
                    // The reqs' OVERLAPPEDs are their first fields (repr(C)).
                    let r1 = (&raw mut (*ctx.handle).req_1).cast::<OVERLAPPED>();
                    let r2 = (&raw mut (*ctx.handle).req_2).cast::<OVERLAPPED>();
                    let deadline = l.now_ms() + 5_000;
                    while l.now_ms() < deadline && !ctx.probe_ok {
                        let mut entries = [OVERLAPPED_ENTRY {
                            lpCompletionKey: 0,
                            lpOverlapped: ptr::null_mut(),
                            Internal: 0,
                            dwNumberOfBytesTransferred: 0,
                        }; 4];
                        let mut n: u32 = 0;
                        let ok = GetQueuedCompletionStatusEx(
                            l.iocp(),
                            entries.as_mut_ptr(),
                            entries.len() as u32,
                            &raw mut n,
                            0,
                            0,
                        );
                        if ok == 0 {
                            continue;
                        }
                        for e in &entries[..n as usize] {
                            // Re-post everything stolen so the loop still
                            // dispatches it after this callback returns. A
                            // lost re-post silently drops a stolen packet —
                            // die loudly.
                            crate::event_loop::post_or_die(
                                l.iocp(),
                                e.dwNumberOfBytesTransferred,
                                e.lpCompletionKey,
                                e.lpOverlapped,
                                "afd re-post",
                            );
                            if e.lpOverlapped == r1 || e.lpOverlapped == r2 {
                                ctx.probe_ok = true;
                            }
                        }
                    }
                } else {
                    (*ctx.handle).stop();
                }
            }
        }

        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        ctx.peer = b;
        poll.set(POLL_READABLE, cb, (&raw mut ctx).cast::<c_void>());
        send_byte(b);

        let deadline = loop_.now_ms() + 10_000;
        while ctx.fires < 2 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        // SAFETY: watcher closed; the test owns `a` (`b` closed by the RST).
        unsafe { closesocket(a) };

        assert!(ctx.closed);
        assert!(!loop_.alive());
        assert!(
            ctx.probe_ok,
            "no re-armed completion surfaced during the callback — \
             the IRP-pending-during-callback ordering is broken"
        );
        // The re-posted packet still delivered normally on the next tick.
        assert_eq!(ctx.events_seen, vec![POLL_READABLE, POLL_READABLE]);
        assert_eq!(ctx.errors_seen, vec![Win32Error::SUCCESS; 2]);
    }

    /// Level-trigger bookkeeping: stop + restart with a changed mask from
    /// inside the callback (test-poll-closesocket shape). The replacement
    /// request kicks the in-flight one; the kicked completion must be
    /// swallowed/masked, never double-fired. Exact callback counts asserted.
    /// // quirk: POLL-16, POLL-15, POLL-27, POLL-23
    #[test]
    fn restart_inside_callback_no_double_fire() {
        let _guard = serial();
        unsafe fn cb(l: &mut Loop, d: *mut c_void, events: u8, err: Win32Error) {
            // SAFETY: `d` is the test Ctx; `handle` is the live boxed poll.
            unsafe {
                record_cb(l, d, events, err);
                let ctx = &mut *d.cast::<Ctx>();
                if ctx.fires == 1 {
                    // uv_poll_stop + uv_poll_start with a wider mask while
                    // the pre-callback re-arm is still in flight.
                    (*ctx.handle).stop();
                    (*ctx.handle).set(POLL_READABLE | POLL_WRITABLE, cb, d);
                } else {
                    (*ctx.handle).stop();
                }
            }
        }

        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        poll.set(POLL_READABLE, cb, (&raw mut ctx).cast::<c_void>());
        send_byte(b);

        let deadline = loop_.now_ms() + 5_000;
        while ctx.fires < 2 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        // Bounded no-fire window: the socket is still readable AND writable,
        // but the watcher is stopped — any further fire is a double-report.
        for _ in 0..10 {
            loop_.tick(Some(20));
        }
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        // SAFETY: watcher closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }

        assert!(ctx.closed);
        assert!(!loop_.alive());
        assert_eq!(
            ctx.events_seen,
            vec![POLL_READABLE, POLL_READABLE | POLL_WRITABLE],
            "exactly two callbacks: R, then R|W after the in-callback restart"
        );
        assert_eq!(ctx.errors_seen, vec![Win32Error::SUCCESS; 2]);
    }

    /// Delivered events are masked to the subscription: a socket that is
    /// readable AND writable reports only the subscribed direction.
    /// // quirk: POLL-19, POLL-21, POLL-16
    #[test]
    fn delivery_masked_to_subscription() {
        let _guard = serial();
        for &(subscribe, expect) in &[
            (POLL_READABLE, POLL_READABLE),
            (POLL_WRITABLE, POLL_WRITABLE),
        ] {
            let (a, b) = loopback_pair();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop and socket outlive the watcher.
            let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
            let mut ctx = Ctx::new();
            ctx.handle = &raw mut *poll;
            // The socket is always writable (empty send buffer); make it
            // readable too so the READABLE run proves W is filtered out and
            // vice versa.
            send_byte(b);
            poll.set(subscribe, record_stop_cb, (&raw mut ctx).cast::<c_void>());

            let deadline = loop_.now_ms() + 5_000;
            while ctx.fires == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            poll.close(Some(mark_closed));
            drain_closed(&mut loop_, &ctx, 5_000);
            // SAFETY: watcher closed; the test owns both sockets.
            unsafe {
                closesocket(a);
                closesocket(b);
            }

            assert!(ctx.closed);
            assert!(!loop_.alive());
            assert_eq!(ctx.events_seen, vec![expect], "subscribed {subscribe:#x}");
            assert_eq!(ctx.errors_seen, vec![Win32Error::SUCCESS]);
        }
    }

    /// Close with IRPs in flight: the endgame must not run until both slots
    /// drain. Scenario (a) closes with both slots busy and verifies deferral
    /// + loop liveness; scenario (b) closes with a single PARKED IRP on an
    /// idle socket — only the dummy exclusive cancel can complete it, so
    /// close converging at all proves the cancel machinery.
    /// // quirk: POLL-35, POLL-32, POLL-33, POLL-34
    #[test]
    fn close_with_in_flight_irps_gates_endgame() {
        let _guard = serial();

        // (a) Both slots busy at close.
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        poll.set(POLL_READABLE, record_cb, (&raw mut ctx).cast::<c_void>());
        // Widening the mask occupies the second slot while the first is
        // still in flight.
        poll.set(
            POLL_READABLE | POLL_WRITABLE,
            record_cb,
            (&raw mut ctx).cast::<c_void>(),
        );
        let reqs_at_close = poll.core.reqs_pending();
        poll.close(Some(mark_closed));
        let closed_synchronously = ctx.closed || poll.core.is_closed();
        let alive_while_closing = loop_.alive();
        drain_closed(&mut loop_, &ctx, 5_000);
        let reqs_after = poll.core.reqs_pending();
        let closed_state = poll.core.is_closed();
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: watcher closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }
        assert_eq!(reqs_at_close, 2);
        assert!(!closed_synchronously, "close must be asynchronous");
        assert!(alive_while_closing, "closing handle holds the loop");
        assert!(ctx.closed);
        assert_eq!(reqs_after, 0);
        assert!(closed_state);
        assert!(!alive_after);

        // (b) One parked IRP on an idle socket: nothing will ever complete
        // it except the cancel poll.
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        poll.set(POLL_READABLE, record_cb, (&raw mut ctx).cast::<c_void>());
        let reqs_at_close = poll.core.reqs_pending();
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: watcher closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }
        assert_eq!(reqs_at_close, 1);
        assert!(ctx.closed, "parked IRP was never cancelled — close hung");
        assert!(!alive_after);
        assert_eq!(ctx.fires, 0, "no spurious delivery during close");
    }

    /// Peer RST surfaces as READABLE (ABORT maps to readable, so the
    /// consumer's read observes ECONNRESET — POSIX poll parity), with no
    /// error; a graceful FIN adds POLL_DISCONNECT when subscribed.
    /// // quirk: POLL-19, POLL-21
    #[test]
    fn rst_and_fin_classification() {
        let _guard = serial();
        // (subscription, peer action: true = RST / false = FIN, expected)
        let cases: [(u8, bool, u8); 2] = [
            (POLL_READABLE, true, POLL_READABLE),
            (
                POLL_READABLE | POLL_DISCONNECT,
                false,
                POLL_READABLE | POLL_DISCONNECT,
            ),
        ];
        for &(subscribe, rst, expect) in &cases {
            let (a, b) = loopback_pair();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop and socket outlive the watcher.
            let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
            let mut ctx = Ctx::new();
            ctx.handle = &raw mut *poll;
            poll.set(subscribe, record_stop_cb, (&raw mut ctx).cast::<c_void>());
            if rst {
                rst_close(b);
            } else {
                // SAFETY: plain close sends FIN; the test owns `b`.
                unsafe { closesocket(b) };
            }
            let deadline = loop_.now_ms() + 5_000;
            while ctx.fires == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            poll.close(Some(mark_closed));
            drain_closed(&mut loop_, &ctx, 5_000);
            // SAFETY: watcher closed; the test owns `a`.
            unsafe { closesocket(a) };

            assert!(ctx.closed);
            assert!(!loop_.alive());
            assert_eq!(
                ctx.events_seen,
                vec![expect],
                "subscribed {subscribe:#x} rst={rst}"
            );
            assert_eq!(ctx.errors_seen, vec![Win32Error::SUCCESS]);
        }
    }

    /// A mask change that kicks a parked, unsatisfied IRP (Exclusive
    /// replacement) must be silent: the kicked completion (STATUS_CANCELLED)
    /// is swallowed and re-armed, never surfaced as a poll error.
    /// // quirk: POLL-23, POLL-17
    #[test]
    fn mask_change_kick_is_silent() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        // Slot 1 parks (idle socket, readable-side conditions unsatisfied).
        poll.set(
            POLL_READABLE,
            record_stop_cb,
            (&raw mut ctx).cast::<c_void>(),
        );
        loop_.tick(Some(50));
        // Widen by DISCONNECT only: the replacement also parks, and the
        // kicked slot-1 completion has nothing satisfied to report.
        poll.set(
            POLL_READABLE | POLL_DISCONNECT,
            record_stop_cb,
            (&raw mut ctx).cast::<c_void>(),
        );
        // Bounded window for the kicked completion to drain: no callback.
        for _ in 0..10 {
            loop_.tick(Some(20));
        }
        let fires_before_send = ctx.fires;
        // The watcher must still be armed: real data now delivers.
        send_byte(b);
        let deadline = loop_.now_ms() + 5_000;
        while ctx.fires == 0 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: watcher closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }
        assert_eq!(fires_before_send, 0, "kicked IRP surfaced as a callback");
        assert_eq!(ctx.events_seen, vec![POLL_READABLE]);
        assert_eq!(ctx.errors_seen, vec![Win32Error::SUCCESS]);
        assert!(ctx.closed);
        assert!(!alive_after);
    }

    /// An externally cancelled IRP (CancelIoEx on the conduit — exactly what
    /// another component sharing the peer could do) completes with
    /// STATUS_CANCELLED: it must be swallowed AND transparently re-armed, so
    /// the watcher keeps working — never surfaced as an error.
    /// // quirk: POLL-23
    #[test]
    fn external_cancel_is_swallowed_and_rearmed() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        // Slot 1 parks (idle socket).
        poll.set(
            POLL_READABLE,
            record_stop_cb,
            (&raw mut ctx).cast::<c_void>(),
        );
        loop_.tick(Some(50));
        // Cancel the parked IRP out from under the watcher.
        let r1 = (&raw mut poll.req_1).cast::<OVERLAPPED>();
        // SAFETY: the peer socket is a live kernel handle; r1 is the parked
        // request's OVERLAPPED.
        let ok = unsafe {
            bun_windows_sys::kernel32::CancelIoEx(
                ptr::with_exposed_provenance_mut::<c_void>(poll.peer_socket),
                r1,
            )
        };
        assert_ne!(ok, 0, "CancelIoEx did not match the parked IRP");
        // Bounded window for the cancelled completion: no callback, and the
        // tail must have re-armed (a fresh IRP pending again).
        for _ in 0..10 {
            loop_.tick(Some(20));
        }
        let fires_after_cancel = ctx.fires;
        let rearmed = poll.core.reqs_pending();
        // Still armed: real data delivers.
        send_byte(b);
        let deadline = loop_.now_ms() + 5_000;
        while ctx.fires == 0 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: watcher closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }
        assert_eq!(
            fires_after_cancel, 0,
            "cancelled IRP surfaced as a callback"
        );
        assert_eq!(rearmed, 1, "cancelled IRP was not transparently re-armed");
        assert_eq!(ctx.events_seen, vec![POLL_READABLE]);
        assert_eq!(ctx.errors_seen, vec![Win32Error::SUCCESS]);
        assert!(ctx.closed);
        assert!(!alive_after);
    }

    /// Closing the watched socket while an IRP is pending completes it with
    /// AFD_POLL_LOCAL_CLOSE: the watcher stops itself (its handle value can
    /// be recycled by a new socket) and no callback fires. // quirk: POLL-22
    #[test]
    fn local_close_stops_watcher() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        poll.set(POLL_READABLE, record_cb, (&raw mut ctx).cast::<c_void>());
        let active_after_start = poll.core.is_active();
        // SAFETY: closing the WATCHED socket out from under the poll is the
        // scenario under test.
        unsafe { closesocket(a) };
        let deadline = loop_.now_ms() + 5_000;
        while poll.core.is_active() && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        let stopped_by_local_close = !poll.core.is_active();
        let reqs_after_stop = poll.core.reqs_pending();

        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: the test owns `b`.
        unsafe { closesocket(b) };

        assert!(active_after_start);
        assert!(
            stopped_by_local_close,
            "LOCAL_CLOSE did not stop the watcher"
        );
        assert_eq!(reqs_after_stop, 0);
        assert_eq!(ctx.fires, 0);
        assert!(ctx.closed);
        assert!(!alive_after);
    }

    /// A submission that fails (dead target socket) is reported exactly
    /// once, asynchronously, with the watcher disarmed first — never
    /// synchronously from set() and never as a resubmit spin.
    /// // quirk: POLL-28, POLL-24
    #[test]
    fn submit_failure_reports_async_error_once() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        // Kill the target between init and start: the AFD submission now
        // fails (synchronously or as an immediate error completion — both
        // funnel through the same dispatch).
        // SAFETY: the test owns `a`.
        unsafe { closesocket(a) };
        poll.set(POLL_READABLE, record_cb, (&raw mut ctx).cast::<c_void>());
        let fires_inside_set = ctx.fires;

        let deadline = loop_.now_ms() + 5_000;
        while ctx.fires == 0 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        // Disarmed: no error spin over a bounded window.
        for _ in 0..10 {
            loop_.tick(Some(20));
        }
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: the test owns `b`.
        unsafe { closesocket(b) };

        assert_eq!(
            fires_inside_set, 0,
            "errors must never be delivered from inside set()"
        );
        assert_eq!(ctx.fires, 1, "the error is reported exactly once (no spin)");
        assert_eq!(ctx.events_seen, vec![0]);
        assert_ne!(ctx.errors_seen[0], Win32Error::SUCCESS);
        assert!(ctx.closed);
        assert!(!alive_after);
    }

    /// Hazard 8 (USOCKETS_EVENTING_CONTRACT): a genuine poll error
    /// dispatches even when the subscribed mask is empty — a stopped
    /// watcher still learns its socket died (epoll parity; deliberate
    /// deviation from libuv's `events != 0` error gate).
    #[test]
    fn error_dispatches_even_when_stopped() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        // Dead target: the submission fails, its error completion is queued.
        // SAFETY: the test owns `a`.
        unsafe { closesocket(a) };
        poll.set(POLL_READABLE, record_cb, (&raw mut ctx).cast::<c_void>());
        // Stop before the error completion is dispatched: mask is now 0.
        poll.stop();
        let deadline = loop_.now_ms() + 5_000;
        while ctx.fires == 0 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: the test owns `b`.
        unsafe { closesocket(b) };

        assert_eq!(ctx.fires, 1, "stopped watcher must still receive the error");
        assert_eq!(ctx.events_seen, vec![0]);
        assert_ne!(ctx.errors_seen[0], Win32Error::SUCCESS);
        assert!(ctx.closed);
        assert!(!alive_after);
    }

    /// The select()-on-thread slow path (forced — a real non-MSAFD provider
    /// cannot be fabricated in CI): readable and writable delivery, the
    /// filtered completion after stop, and a stall-free close once the
    /// worker drained. // quirk: POLL-38, POLL-39, POLL-40
    #[test]
    fn slow_path_select_fallback() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        poll.slow = true;
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;

        // Readable first, so the worker's select returns immediately (a
        // close while a worker blocks would stall up to the 3-minute safety
        // timeout — POLL-42, deliberately not exercised here).
        send_byte(b);
        poll.set(
            POLL_READABLE,
            record_stop_cb,
            (&raw mut ctx).cast::<c_void>(),
        );
        let deadline = loop_.now_ms() + 10_000;
        while ctx.fires == 0 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        // Drain the pre-callback re-arm's worker; its completion is filtered
        // to nothing after the in-callback stop(). The watcher is stopped
        // and requests drained here, so the loop is quiescent and asserting
        // is safe.
        let deadline = loop_.now_ms() + 10_000;
        while poll.core.reqs_pending() != 0 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        assert_eq!(poll.core.reqs_pending(), 0);
        assert_eq!(ctx.events_seen, vec![POLL_READABLE]);

        // Writable delivery through the wfds/efds mapping.
        poll.set(
            POLL_WRITABLE,
            record_stop_cb,
            (&raw mut ctx).cast::<c_void>(),
        );
        let deadline = loop_.now_ms() + 10_000;
        while ctx.fires < 2 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        let deadline = loop_.now_ms() + 10_000;
        while poll.core.reqs_pending() != 0 && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        assert_eq!(poll.core.reqs_pending(), 0);
        assert_eq!(ctx.events_seen, vec![POLL_READABLE, POLL_WRITABLE]);
        assert_eq!(ctx.errors_seen, vec![Win32Error::SUCCESS; 2]);

        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 10_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: watcher closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }
        assert!(ctx.closed);
        assert!(!alive_after);
        assert_eq!(ctx.fires, 2, "stopped watcher must not fire again");
    }

    /// Keep-alive contract for the uSockets surface: an unref'd ACTIVE
    /// watcher — even with its IRP permanently in flight (rearm-before-
    /// callback) — must NOT hold the loop; closing it must (until the close
    /// callback). // quirk: LOOP-27
    #[test]
    fn unref_active_poll_does_not_hold_loop() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        poll.set(POLL_READABLE, record_cb, (&raw mut ctx).cast::<c_void>());
        let alive_started = loop_.alive();
        let reqs_in_flight = poll.core.reqs_pending();
        poll.unref();
        let alive_unref = loop_.alive();
        poll.ref_();
        let alive_reref = loop_.alive();
        poll.unref();
        poll.close(Some(mark_closed));
        let alive_closing = loop_.alive();
        drain_closed(&mut loop_, &ctx, 5_000);
        let alive_after = loop_.alive();
        drop(poll);
        drop(loop_);
        // SAFETY: watcher closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }
        assert!(alive_started);
        assert_eq!(reqs_in_flight, 1, "an IRP is pending while started");
        assert!(
            !alive_unref,
            "unref'd watcher (parked IRP) must not hold the loop"
        );
        assert!(alive_reref);
        assert!(
            alive_closing,
            "closing holds the loop until the close callback"
        );
        assert!(ctx.closed);
        assert!(!alive_after);
        assert_eq!(ctx.fires, 0);
    }

    /// Two watchers on one socket busyloop (Exclusive cancel war); init
    /// refuses the duplicate; after close the socket may be watched again.
    /// // quirk: POLL-37
    #[test]
    fn duplicate_watcher_rejected() {
        let _guard = serial();
        let (a, b) = loopback_pair();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and socket outlive the watcher.
        let mut poll = unsafe { AfdPoll::init(lp, a).unwrap() };
        // SAFETY: same loop, same socket — must be refused.
        let dup_err = unsafe { AfdPoll::init(lp, a) }.err();
        assert_eq!(dup_err, Some(Win32Error::ALREADY_EXISTS));

        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *poll;
        poll.set(POLL_READABLE, record_cb, (&raw mut ctx).cast::<c_void>());
        poll.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx, 5_000);
        assert!(ctx.closed);

        // SAFETY: previous watcher fully closed above.
        let again = unsafe { AfdPoll::init(lp, a) };
        assert!(again.is_ok(), "socket must be watchable again after close");
        let mut again = again.unwrap();
        let mut ctx2 = Ctx::new();
        ctx2.handle = &raw mut *again;
        again.set(POLL_READABLE, record_cb, (&raw mut ctx2).cast::<c_void>());
        again.close(Some(mark_closed));
        drain_closed(&mut loop_, &ctx2, 5_000);
        let alive_after = loop_.alive();
        drop(again);
        drop(poll);
        drop(loop_);
        // SAFETY: watchers closed; the test owns both sockets.
        unsafe {
            closesocket(a);
            closesocket(b);
        }
        assert!(ctx2.closed);
        assert!(!alive_after);
    }
}
