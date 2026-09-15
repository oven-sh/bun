//! The Windows loop's completion port, for I/O that Bun owns (pipes, the
//! console, process exit). Mirrors `packages/bun-usockets/src/internal/
//! eventing/iocp.h`.
#![cfg(windows)]

use core::ffi::{c_int, c_void};

use crate::Loop;

pub type HANDLE = *mut c_void;

/// `OVERLAPPED`.
#[repr(C)]
pub struct Overlapped {
    pub internal: usize,
    pub internal_high: usize,
    pub offset: u32,
    pub offset_high: u32,
    pub event: HANDLE,
}

/// `OVERLAPPED_ENTRY`: one dequeued completion packet.
#[repr(C)]
pub struct OverlappedEntry {
    pub completion_key: usize,
    pub overlapped: *mut Overlapped,
    pub internal: usize,
    pub bytes_transferred: u32,
}

pub type CompleteFn = unsafe extern "C" fn(*mut Loop, *mut Op, *mut OverlappedEntry);

/// `struct us_iocp_op`: anything that completes through the loop's port.
///
/// It is the first field of the struct that owns it, and its address is what
/// the kernel is given as the `OVERLAPPED` (or as the wait packet's context),
/// so the dequeued packet leads back to it. The owner must stay allocated, at
/// the same address, until `complete` has run for every packet it has in
/// flight: cancelling the I/O or closing the handle only asks for the
/// completion, it does not wait for it.
///
/// For overlapped I/O the NTSTATUS is `overlapped.internal` and the byte count
/// is `overlapped.internal_high`.
#[repr(C)]
pub struct Op {
    pub overlapped: Overlapped,
    pub complete: Option<CompleteFn>,
}

impl Op {
    pub const fn new(complete: CompleteFn) -> Self {
        Self {
            overlapped: Overlapped {
                internal: 0,
                internal_high: 0,
                offset: 0,
                offset_high: 0,
                event: core::ptr::null_mut(),
            },
            complete: Some(complete),
        }
    }

    /// The NTSTATUS of a completed overlapped operation.
    #[inline]
    pub fn status(&self) -> i32 {
        self.overlapped.internal as i32
    }

    /// The byte count of a completed overlapped operation.
    #[inline]
    pub fn bytes_transferred(&self) -> usize {
        self.overlapped.internal_high
    }
}

bun_opaque::opaque_ffi! {
    /// `struct us_iocp_wait`: delivers an [`Op`] once when a handle is signalled.
    pub struct Wait;
    /// `struct us_internal_afd_poll`: socket readiness for a poll Bun owns.
    pub struct SocketPoll;
}

pub const SOCKET_READABLE: c_int = 1;
pub const SOCKET_WRITABLE: c_int = 2;

unsafe extern "C" {
    /// The loop's completion port. Associate only handles Bun created: the
    /// association belongs to the file object, so it is shared with every other
    /// process holding the same handle and cannot be undone while I/O is pending.
    pub fn us_loop_iocp(loop_: *mut Loop) -> HANDLE;

    /// Call once the kernel has accepted an op that will post a packet (the
    /// call returned pending, or succeeded on a handle without
    /// `FILE_SKIP_COMPLETION_PORT_ON_SUCCESS`). The loop balances it when the
    /// packet is dequeued, and does not close the port while any are out.
    pub fn us_iocp_op_submitted(loop_: *mut Loop);

    pub fn us_iocp_wait_create(loop_: *mut Loop) -> *mut Wait;
    /// 0, or -1 if the wait could not be registered.
    pub fn us_iocp_wait_start(wait: *mut Wait, handle: HANDLE, op: *mut Op) -> c_int;
    /// Nonzero if the wait was removed before it fired: `complete` will not
    /// run. Zero if its packet was already dequeued or is about to be.
    pub fn us_iocp_wait_stop(wait: *mut Wait) -> c_int;
    pub fn us_iocp_wait_free(wait: *mut Wait);

    /// Readiness for a socket; `owner` is the tagged pointer handed back
    /// through `Bun__internal_dispatch_ready_poll`, with the readiness in
    /// `Loop::current_ready_event`. Null (with the Winsock error set) on failure.
    pub fn us_iocp_poll_socket(
        loop_: *mut Loop,
        owner: *mut c_void,
        socket: usize,
        events: c_int,
    ) -> *mut SocketPoll;
    pub fn us_iocp_poll_socket_change(loop_: *mut Loop, poll: *mut SocketPoll, events: c_int);
    /// The poll is released once the kernel is done with it; `owner` is not used again.
    pub fn us_iocp_poll_socket_stop(loop_: *mut Loop, poll: *mut SocketPoll);

    /// `WSAStartup`, once. Anything that reaches ws2_32 without going through uSockets calls it first.
    pub safe fn us_internal_winsock_ensure();
}
