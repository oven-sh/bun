#![cfg(windows)]

//! Overlapped request blocks — the unit of IOCP completion.
//!
//! Every overlapped submission embeds a [`Req`] whose `OVERLAPPED` is handed
//! to the kernel. The kernel owns that memory until the completion packet is
//! dequeued (or provably suppressed) — dropping the containing allocation
//! earlier is silent corruption, which is why handle teardown is the deferred
//! endgame protocol in `handle.rs`, never a synchronous free.
//! // quirk: LOOP-04

use core::ffi::c_void;
use core::ptr;

use bun_windows_sys::{NTSTATUS, OVERLAPPED, Win32Error, ntstatus_from_win32};

/// What a dequeued completion is dispatched as. Grows as handle classes are
/// implemented; every variant added must be handled in `Loop::dispatch`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ReqKind {
    /// Loop wakeup posted by `Loop::wake` (the only packet posted with a
    /// null `lpOverlapped` is also a wakeup, from foreign posters).
    Wakeup,
    /// AFD socket-poll completion (fast or slow path); `data` is the owning
    /// `AfdPoll`.
    Poll,
    /// Pipe read completion (overlapped or worker-posted); `data` is the
    /// owning `PipeHandle`.
    PipeRead,
    /// Pipe write completion; the `Req` is the first field of a `WriteReq`
    /// and `data` is the owning `PipeHandle`.
    PipeWrite,
    /// Pipe connect completion; the `Req` is the first field of a
    /// `ConnectReq` and `data` is the owning `PipeHandle`.
    PipeConnect,
    /// Server accept (`ConnectNamedPipe`) completion; the `Req` is the first
    /// field of an `AcceptSlot` and `data` is the owning `PipeHandle`.
    PipeAccept,
    /// Pipe shutdown (flush probe / worker) completion; `data` is the owning
    /// `PipeHandle`.
    PipeShutdown,
    /// Fs-event (`ReadDirectoryChangesW`) completion; `data` is the owning
    /// `FsEventHandle`.
    FsEvent,
    /// Console read completion (raw wait wake, cooked worker post,
    /// short-circuit or sync failure); `data` is the owning `TtyHandle`.
    TtyRead,
    /// Console write completion (the write already ran synchronously); the
    /// `Req` is the first field of a `TtyWriteReq` and `data` is the owning
    /// `TtyHandle`. // quirk: TTY-24
    TtyWrite,
    /// Console shutdown settle; `data` is the owning `TtyHandle`.
    /// // quirk: TTY-47
    TtyShutdown,
    /// Child-process exit notification posted by the thread-pool wait
    /// registration; `data` is the owning `ProcessHandle`. // quirk: PROC-45
    ProcessExit,
    /// Signal-watcher completion posted by the console-ctrl handler thread
    /// or a synthetic dispatch; `data` is the owning `SignalHandle`.
    /// // quirk: SIGEV-02, SIGEV-10
    Signal,
}

/// An overlapped request. `overlapped` MUST stay the first field: the
/// dispatcher recovers `*mut Req` directly from `lpOverlapped`.
#[repr(C)]
pub struct Req {
    overlapped: OVERLAPPED,
    kind: ReqKind,
    /// Owner back-pointer, set at init; meaning is per-kind.
    data: *mut c_void,
    /// Intrusive link for the loop's pending queue (self-posted requests and
    /// synchronous-failure completions travel through it, never through the
    /// kernel). Null when not queued.
    next_pending: *mut Req,
}

impl Req {
    pub fn new(kind: ReqKind, data: *mut c_void) -> Req {
        Req {
            // `Internal = 0` is STATUS_SUCCESS — a coherent status even if
            // the request is dispatched without the kernel writing one.
            // quirk: LOOP-05
            overlapped: OVERLAPPED {
                Internal: 0,
                InternalHigh: 0,
                Offset: 0,
                OffsetHigh: 0,
                hEvent: ptr::null_mut(),
            },
            kind,
            data,
            next_pending: ptr::null_mut(),
        }
    }

    #[inline]
    pub fn kind(&self) -> ReqKind {
        self.kind
    }

    #[inline]
    pub fn data(&self) -> *mut c_void {
        self.data
    }

    /// The `OVERLAPPED*` to pass to the kernel for this request. The caller
    /// is asserting the containing allocation outlives the operation.
    #[inline]
    pub fn overlapped_ptr(&mut self) -> *mut OVERLAPPED {
        &raw mut self.overlapped
    }

    /// Recover the request from a dequeued completion's `lpOverlapped`.
    ///
    /// # Safety
    /// `lp` must be non-null (null entries are pure wakeups and must be
    /// filtered before this — `container_of(NULL)` is garbage, not null;
    /// // quirk: LOOP-03) and must point at the `overlapped` field of a live
    /// `Req` submitted to this loop.
    #[inline]
    pub unsafe fn from_overlapped<'a>(lp: *mut OVERLAPPED) -> &'a mut Req {
        debug_assert!(!lp.is_null());
        // SAFETY: fn contract — `lp` points at the `overlapped` field of a
        // live Req, which is the first field of a #[repr(C)] struct.
        unsafe { &mut *lp.cast::<Req>() }
    }

    /// The operation's final NTSTATUS. The kernel stores it in
    /// `OVERLAPPED.Internal`; reading it here avoids a `GetOverlappedResult`
    /// syscall per completion, and self-posted requests write the same field
    /// so consumers cannot tell the two apart. // quirk: LOOP-05
    #[inline]
    pub fn status(&self) -> NTSTATUS {
        NTSTATUS(self.overlapped.Internal as u32)
    }

    #[inline]
    pub fn success(&self) -> bool {
        bun_windows_sys::NT_SUCCESS(self.status())
    }

    /// Bytes transferred, from `OVERLAPPED.InternalHigh`.
    #[inline]
    pub fn bytes_transferred(&self) -> usize {
        self.overlapped.InternalHigh
    }

    /// Record a Win32 error on a request that will be completed locally
    /// (synchronous submit failure, fabricated completion). Stored as the
    /// warning-severity wrapped NTSTATUS so `status()`/error extraction see
    /// exactly what a kernel completion would carry. // quirk: OS-49, POLL-28
    #[inline]
    pub fn set_error(&mut self, error: Win32Error) {
        self.overlapped.Internal = ntstatus_from_win32(error).0 as usize;
    }

    /// Record a raw NTSTATUS on a request that will be completed locally —
    /// exactly the value the kernel would have written had the submission
    /// gone asynchronous, so dispatch cannot tell the two apart.
    /// // quirk: POLL-28, LOOP-05
    #[inline]
    pub fn set_status(&mut self, status: NTSTATUS) {
        self.overlapped.Internal = status.0 as usize;
    }

    #[inline]
    pub fn set_success(&mut self, bytes: usize) {
        self.overlapped.Internal = 0;
        self.overlapped.InternalHigh = bytes;
    }

    /// Re-initialize the OVERLAPPED for a fresh submission, priming the
    /// status to STATUS_PENDING so stale state can never read as completed
    /// and [`completed_volatile`](Self::completed_volatile) is meaningful
    /// from the moment of submit. // quirk: POLL-29, PIPE-51
    #[inline]
    pub fn prime_pending(&mut self) {
        self.overlapped = OVERLAPPED {
            Internal: NTSTATUS::PENDING.0 as usize,
            InternalHigh: 0,
            Offset: 0,
            OffsetHigh: 0,
            hEvent: ptr::null_mut(),
        };
    }

    /// `HasOverlappedIoCompleted`: whether a final status has replaced the
    /// primed STATUS_PENDING. Volatile — the kernel writes `Internal` from
    /// arbitrary context while the operation is in flight. Only meaningful
    /// after [`prime_pending`](Self::prime_pending). // quirk: PIPE-51
    #[inline]
    pub fn completed_volatile(&self) -> bool {
        // SAFETY: reads a plain integer field through a valid pointer; the
        // concurrent kernel write is the documented OVERLAPPED protocol.
        let status = unsafe { ptr::read_volatile(&raw const self.overlapped.Internal) };
        status != NTSTATUS::PENDING.0 as usize
    }

    /// The recorded error as a Win32 code: unwraps locally-recorded statuses;
    /// kernel NTSTATUSes go through `RtlNtStatusToDosError`.
    pub fn error(&self) -> Win32Error {
        let status = self.status();
        match bun_windows_sys::ntwin32_unwrap(status) {
            Some(code) => code,
            None => Win32Error::from_ntstatus(status),
        }
    }

    #[inline]
    pub(crate) fn take_next_pending(&mut self) -> *mut Req {
        core::mem::replace(&mut self.next_pending, ptr::null_mut())
    }

    #[inline]
    pub(crate) fn set_next_pending(&mut self, next: *mut Req) {
        self.next_pending = next;
    }

    /// Debug-only list-scan accessor (LOOP-14 double-insert check).
    #[cfg(debug_assertions)]
    #[inline]
    pub(crate) fn next_pending_ptr(&self) -> *mut Req {
        self.next_pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlapped_is_first_field() {
        let mut req = Req::new(ReqKind::Wakeup, ptr::null_mut());
        let req_addr = (&raw mut req).addr();
        let ov_addr = req.overlapped_ptr().addr();
        assert_eq!(req_addr, ov_addr);
        // And the round trip recovers the same request.
        let lp = req.overlapped_ptr();
        let back = unsafe { Req::from_overlapped(lp) };
        assert_eq!((&raw mut *back).addr(), req_addr);
        assert_eq!(back.kind(), ReqKind::Wakeup);
    }

    #[test]
    fn local_error_reads_back_like_a_kernel_completion() {
        // quirk: OS-49, LOOP-05
        let mut req = Req::new(ReqKind::Wakeup, ptr::null_mut());
        assert!(req.success());
        req.set_error(Win32Error::OPERATION_ABORTED);
        assert!(!req.success());
        assert_eq!(req.status().0, 0x8007_03E3); // 995 wrapped, warning severity
        assert_eq!(req.error(), Win32Error::OPERATION_ABORTED);
        req.set_success(42);
        assert!(req.success());
        assert_eq!(req.bytes_transferred(), 42);
    }
}
