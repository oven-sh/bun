#![cfg(windows)]

//! Overlapped named-pipe handle class — the `uv_pipe_t` replacement: pair
//! creation for child stdio, server listen/accept, client connect, and the
//! read/write machinery, all delivered through the loop's completion
//! dispatch.
//!
//! Design decisions (each is a named project outcome, not an oversight):
//!
//! - **Direct overlapped reads.** Every read is a real `ReadFile` into the
//!   consumer's buffer; there is no zero-read readiness probe and no inline
//!   synchronous data read (libuv's model — deleted; see PIPE-30/31 skip
//!   rationale in the stage report). One read is in flight per handle at
//!   most — overlapping reads on a pipe deadlock in the kernel and would
//!   alias the single embedded request. // quirk: PIPE-33
//! - **`read_stop` parks instead of cancelling.** `CancelIoEx` on a pending
//!   pipe read can swallow concurrently-arriving bytes (kernel race — the
//!   IRP drains the pipe, then the cancel discards the copy). Stopping
//!   therefore only clears the delivery gate: the in-flight read keeps
//!   waiting, and a completion that lands while stopped is stashed and
//!   re-delivered on the next `read_start`. The user-facing guarantee of
//!   PIPE-36 (no callback after `read_stop`, stop is synchronously
//!   effective) is preserved; the cancel mechanism is deliberately not.
//!   // quirk: PIPE-32, PIPE-36
//! - **One write queue, strictly FIFO, one submission in flight.** Ordering
//!   lives in the per-handle queue (ADD-03 doctrine); the same queue
//!   discipline serializes worker-thread writes on non-overlapped handles,
//!   collapsing libuv's four write strategies into two. // quirk: PIPE-40,
//!   PIPE-41
//! - **Non-overlapped (inherited) handles run blocking I/O on the system
//!   pool** with the three-state cancellation handshake, so adopting stdio
//!   from cmd.exe-style parents works without a private thread pool.
//!   // quirk: PIPE-13, PIPE-34, PIPE-35
//! - **Shutdown keeps libuv v1.x flush semantics** (probe, pool flush, 50 ms
//!   EOF grace) — upstream v2 deleted the mechanism, but node's
//!   `socket.end()` / stdio-flush behavior on Windows depends on it.
//!   // quirk: PIPE-50, PIPE-51, PIPE-52

use core::ffi::c_void;
use core::mem;
use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};
// std Mutex (not bun_threading::Mutex): bun_threading pulls bun_alloc, which
// would break this crate's natively-linkable test binary (see Cargo.toml);
// the lock is only contended during read-cancellation handshakes.
#[allow(clippy::disallowed_types)]
use std::sync::Mutex;

use bun_windows_sys::kernel32::{
    CreateNamedPipeW, DuplicateHandle, FlushFileBuffers, PostQueuedCompletionStatus,
    QueueUserWorkItem, ReadFile, WT_EXECUTELONGFUNCTION, WriteFile,
};
use bun_windows_sys::ntdll::NtQueryInformationFile;
use bun_windows_sys::{
    BOOL, CancelSynchronousIo, CloseHandle, ConnectNamedPipe, CreateFileW, DUPLICATE_SAME_ACCESS,
    DWORD, FALSE, FILE_ACCESS_INFORMATION, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
    FILE_INFORMATION_CLASS, FILE_MODE_INFORMATION, FILE_PIPE_LOCAL_INFORMATION,
    FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SKIP_COMPLETION_PORT_ON_SUCCESS,
    FILE_SKIP_SET_EVENT_ON_HANDLE, FILE_SYNCHRONOUS_IO_ALERT, FILE_SYNCHRONOUS_IO_NONALERT,
    FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA, GENERIC_READ, GENERIC_WRITE, GetCurrentProcess,
    GetCurrentProcessId, GetCurrentThread, GetNamedPipeHandleStateW, HANDLE, INVALID_HANDLE_VALUE,
    IO_STATUS_BLOCK, NTSTATUS, OPEN_EXISTING, PIPE_ACCESS_DUPLEX, PIPE_ACCESS_INBOUND,
    PIPE_ACCESS_OUTBOUND, PIPE_NOWAIT, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
    PIPE_UNLIMITED_INSTANCES, PIPE_WAIT, RtlGenRandom, SECURITY_ATTRIBUTES,
    SetFileCompletionNotificationModes, SetNamedPipeHandleState, SwitchToThread, ULONG, WRITE_DAC,
    WaitNamedPipeW, Win32Error,
};

use crate::event_loop::Loop;
use crate::handle::HandleCore;
use crate::req::{Req, ReqKind};
use crate::timer::Timer;

/// In/out kernel buffer quota per instance; matches the historical read
/// chunk size the byte-mode model assumes. // quirk: PIPE-04
const PIPE_BUFFER_SIZE: DWORD = 65536;
/// Single-call I/O clamp (mirrors Linux MAX_RW_COUNT; DWORD-safe).
/// // quirk: PIPE-39
const MAX_RW_BYTES: usize = 0x7fff_f000;
/// Vectored-write count sanity bound (catches negative-int sign confusion in
/// marshalled buffer arrays). // quirk: PIPE-39
const MAX_WRITE_BUFS: usize = 1024 * 1024;
/// Post-shutdown grace for the peer's last data before force-closing.
/// // quirk: PIPE-51
const EOF_TIMEOUT_MS: u64 = 50;
/// Per-round `WaitNamedPipeW` timeout in the busy-connect worker.
/// // quirk: PIPE-27
const PIPE_BUSY_WAIT_MS: DWORD = 30_000;
/// Name-collision retry bound for pair creation. The seed is a real RNG, so
/// unlike libuv's constant-seed walk a long collision chain means something
/// is genuinely wrong. // quirk: PIPE-03
const MAX_NAME_ATTEMPTS: u32 = 64;

/// Read callback: `(loop re-lent, data, buffer the bytes landed in, n, err)`.
/// `err == SUCCESS` delivers `n >= 1` bytes; any other code delivers exactly
/// once with `n == 0` and stops reading (`BROKEN_PIPE` is the raw EOF shape
/// on pipes — consumers translate at their boundary). // quirk: PIPE-37
pub type PipeReadCb = unsafe fn(&mut Loop, *mut c_void, *mut u8, usize, Win32Error);
/// Write callback: `(loop, data, bytes written, err)`. Fires exactly once
/// per `write()`, including with `OPERATION_ABORTED` when the handle closes
/// before the write reaches the kernel.
pub type PipeWriteCb = unsafe fn(&mut Loop, *mut c_void, usize, Win32Error);
/// Connect callback. Always invoked asynchronously, including for
/// validation failures. // quirk: PIPE-29
pub type PipeConnectCb = unsafe fn(&mut Loop, *mut c_void, Win32Error);
/// Server connection callback: a client is ready for [`PipeHandle::accept`]
/// (`SUCCESS`), or an accept slot failed.
pub type PipeConnectionCb = unsafe fn(&mut Loop, *mut c_void, Win32Error);
/// Shutdown callback: queued writes flushed (or the reason they were not).
pub type PipeShutdownCb = unsafe fn(&mut Loop, *mut c_void, Win32Error);
/// Close callback, run from the endgame once every in-flight request
/// drained; only then may the owner free the handle box.
pub type PipeCloseCb = unsafe fn(&mut Loop, *mut c_void);

/// Backing for zero-length writes — a real operation through the completion
/// machinery, never a skipped no-op. // quirk: PIPE-44
static EMPTY_WRITE: u8 = 0;

// ───────────────────────── pair creation ─────────────────────────

/// How [`create_pair`] shapes each end. The server end is always overlapped
/// (it is the end this loop drives); the client end is the one handed to a
/// child or foreign runtime.
#[derive(Copy, Clone)]
pub struct PairOptions {
    pub server_readable: bool,
    pub server_writable: bool,
    pub client_readable: bool,
    pub client_writable: bool,
    pub client_overlapped: bool,
    pub client_inheritable: bool,
}

impl PairOptions {
    /// Both ends duplex + overlapped, nothing inheritable — the loopback
    /// shape used in-process.
    pub fn duplex() -> PairOptions {
        PairOptions {
            server_readable: true,
            server_writable: true,
            client_readable: true,
            client_writable: true,
            client_overlapped: true,
            client_inheritable: false,
        }
    }
}

/// Create an anonymous named-pipe pair `(server, client)` under
/// `\\?\pipe\LOCAL\` with the collision-retry naming scheme. Both handles
/// are raw and owned by the caller: adopt with [`PipeHandle::open`] or hand
/// to a child's stdio. On error nothing is leaked.
/// // quirk: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05
pub fn create_pair(opts: &PairOptions) -> Result<(HANDLE, HANDLE), Win32Error> {
    let mut server_access: DWORD = WRITE_DAC | FILE_FLAG_OVERLAPPED; // quirk: PIPE-59
    if opts.server_readable {
        server_access |= PIPE_ACCESS_INBOUND;
    }
    if opts.server_writable {
        // A writing server end also takes inbound access: CreateNamedPipe
        // grants FILE_READ_ATTRIBUTES only with it, and the shutdown probe
        // needs that right. // quirk: PIPE-06, PIPE-50
        server_access |= PIPE_ACCESS_OUTBOUND | PIPE_ACCESS_INBOUND;
    }
    let (server, name) = create_pair_server(server_access)?;

    // Cross-grant the attribute rights: a non-reading client still gets
    // FILE_READ_ATTRIBUTES (shutdown probe), a non-writing one still gets
    // FILE_WRITE_ATTRIBUTES (SetNamedPipeHandleState). // quirk: PIPE-05
    let mut client_access: DWORD = WRITE_DAC;
    client_access |= if opts.client_readable {
        GENERIC_READ
    } else {
        FILE_READ_ATTRIBUTES
    };
    client_access |= if opts.client_writable {
        GENERIC_WRITE
    } else {
        FILE_WRITE_ATTRIBUTES
    };

    let mut sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as DWORD,
        lpSecurityDescriptor: ptr::null_mut(),
        // Inheritability is atomic at creation — never the two-step
        // SetHandleInformation dance. // quirk: POLL-10
        bInheritHandle: opts.client_inheritable as BOOL,
    };
    // SAFETY: `name` is NUL-terminated and outlives the call; `sa` is a
    // valid local.
    let client = unsafe {
        CreateFileW(
            name.as_ptr(),
            client_access,
            0,
            &raw mut sa,
            OPEN_EXISTING,
            if opts.client_overlapped {
                FILE_FLAG_OVERLAPPED
            } else {
                0
            },
            ptr::null_mut(),
        )
    };
    if client == INVALID_HANDLE_VALUE {
        let err = Win32Error::get();
        // SAFETY: `server` was created above and not yet shared.
        unsafe { CloseHandle(server) };
        return Err(err);
    }

    #[cfg(debug_assertions)]
    // Guard against environment-injected mode weirdness on the fresh client.
    // // quirk: PIPE-07
    {
        let mut mode: DWORD = 0;
        // SAFETY: valid out-pointer; no user-name buffer requested.
        let ok = unsafe {
            GetNamedPipeHandleStateW(
                client,
                &raw mut mode,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
            )
        };
        debug_assert!(ok == 0 || mode == (PIPE_READMODE_BYTE | PIPE_WAIT));
    }

    // Both ends exist, so this cannot block; ERROR_PIPE_CONNECTED means the
    // client connected between create and here — success. // quirk: PIPE-07
    // SAFETY: `server` is a fresh pipe handle owned here.
    let ok = unsafe { ConnectNamedPipe(server, ptr::null_mut()) };
    if ok == 0 && Win32Error::get() != Win32Error::PIPE_CONNECTED {
        let err = Win32Error::get();
        // SAFETY: both handles created above, not yet shared.
        unsafe {
            CloseHandle(server);
            CloseHandle(client);
        }
        return Err(err);
    }
    Ok((server, client))
}

/// Generate-name + `CreateNamedPipeW` retry loop. PIPE_BUSY and
/// ACCESS_DENIED both mean "name collision" — but ACCESS_DENIED is also what
/// an AppContainer returns for an inaccessible namespace, so its retries are
/// capped at one and the cap resets whenever PIPE_BUSY proves the namespace
/// reachable. // quirk: PIPE-01, PIPE-02
fn create_pair_server(access: DWORD) -> Result<(HANDLE, Vec<u16>), Win32Error> {
    let pid = GetCurrentProcessId();
    let mut denied_budget = 1u32;
    for _ in 0..MAX_NAME_ATTEMPTS {
        let mut rand: u64 = 0;
        // The retry loop, not this seed, is the uniqueness mechanism — a
        // failed RNG only costs extra iterations. // quirk: PIPE-03
        // SAFETY: writes 8 bytes through a valid local out-pointer.
        let _ = unsafe { RtlGenRandom((&raw mut rand).cast::<c_void>(), 8) };
        // `LOCAL\` is required inside an AppContainer and meaningless (just
        // part of the name) outside one. // quirk: PIPE-02
        let name: Vec<u16> = format!(r"\\?\pipe\LOCAL\bun-{pid:08x}-{rand:016x}")
            .encode_utf16()
            .chain(core::iter::once(0))
            .collect();
        // SAFETY: `name` is NUL-terminated and outlives the call.
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                access | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                PIPE_BUFFER_SIZE,
                PIPE_BUFFER_SIZE,
                0,
                ptr::null_mut(),
            )
        }; // quirk: PIPE-04
        if handle != INVALID_HANDLE_VALUE {
            return Ok((handle, name));
        }
        match Win32Error::get() {
            Win32Error::PIPE_BUSY => denied_budget = 1, // quirk: PIPE-02
            Win32Error::ACCESS_DENIED => {
                if denied_budget == 0 {
                    return Err(Win32Error::ACCESS_DENIED);
                }
                denied_budget -= 1;
            }
            err => return Err(err),
        }
    }
    Err(Win32Error::PIPE_BUSY)
}

// ───────────────────── sync-I/O cancellation handshake ─────────────────────

/// Three-state cancellation handshake for blocking syscalls on system-pool
/// workers. `CancelSynchronousIo` only lands while the target thread is
/// inside its syscall, so a single call is a race; the interrupter spins
/// under the lock until the worker publishes "past blocking", and the worker
/// re-takes the lock after publishing so it cannot proceed to
/// completion-posting (and have its pool thread reused for new I/O) while a
/// stale cancel still targets it. // quirk: PIPE-35
// std Mutex: see the module-level import note (tier-0 test binary).
#[allow(clippy::disallowed_types)]
struct SyncIoState {
    /// `NOT_STARTED` = worker not yet at its syscall; `PAST` = worker past
    /// it (or pre-empted before it); anything else = the worker's duplicated
    /// thread-handle bits while it is (about to be) blocked.
    thread: AtomicUsize,
    lock: Mutex<()>,
}

#[allow(clippy::disallowed_types)] // std Mutex: see the struct note
impl SyncIoState {
    const NOT_STARTED: usize = 0;
    /// `INVALID_HANDLE_VALUE` bits.
    const PAST: usize = usize::MAX;

    fn new() -> SyncIoState {
        SyncIoState {
            thread: AtomicUsize::new(Self::NOT_STARTED),
            lock: Mutex::new(()),
        }
    }
}

#[allow(clippy::disallowed_types)]
fn lock_ignore_poison(m: &Mutex<()>) -> std::sync::MutexGuard<'_, ()> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Worker side: publish this thread as the cancellation target. Returns the
/// duplicated thread handle to pass to [`sync_io_exit`], or the error when
/// pre-empted / duplication failed (the caller posts it; no syscall ran).
fn sync_io_enter(state: &SyncIoState) -> Result<HANDLE, Win32Error> {
    let mut dup: HANDLE = ptr::null_mut();
    // GetCurrentThread() is a pseudo-handle; the interrupter needs a real
    // one. // quirk: PIPE-35
    // SAFETY: pseudo-handle duplication into a valid local out-pointer.
    let ok = unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            GetCurrentThread(),
            GetCurrentProcess(),
            &raw mut dup,
            0,
            FALSE,
            DUPLICATE_SAME_ACCESS,
        )
    };
    if ok == 0 {
        return Err(Win32Error::get());
    }
    let guard = lock_ignore_poison(&state.lock);
    if state.thread.load(Ordering::Acquire) == SyncIoState::PAST {
        // Interrupter pre-empted us before the syscall.
        drop(guard);
        // SAFETY: `dup` was duplicated above and is closed exactly once.
        unsafe { CloseHandle(dup) };
        return Err(Win32Error::OPERATION_ABORTED);
    }
    debug_assert_eq!(
        state.thread.load(Ordering::Relaxed),
        SyncIoState::NOT_STARTED
    );
    state
        .thread
        .store(dup.expose_provenance(), Ordering::Release);
    drop(guard);
    Ok(dup)
}

/// Worker side: mark the syscall finished and wait out any in-progress
/// interrupt spin before returning (lock handshake).
fn sync_io_exit(state: &SyncIoState, dup: HANDLE) {
    // The bare release store is what breaks the interrupter's spin (it holds
    // the lock while spinning, so the lock cannot be used for this).
    // // quirk: PIPE-35
    state.thread.store(SyncIoState::PAST, Ordering::Release);
    drop(lock_ignore_poison(&state.lock));
    // SAFETY: `dup` came from sync_io_enter; the interrupter no longer holds
    // it (the lock handshake above ordered us after its spin).
    unsafe { CloseHandle(dup) };
}

/// Loop side: force the worker past its blocking syscall (or pre-empt it
/// from ever entering). Idempotent; returns once the worker can no longer
/// touch the watched handle.
fn sync_io_interrupt(state: &SyncIoState) {
    let guard = lock_ignore_poison(&state.lock);
    let t = state.thread.load(Ordering::Acquire);
    if t == SyncIoState::NOT_STARTED {
        // Worker has not reached its syscall: pre-empt it.
        state.thread.store(SyncIoState::PAST, Ordering::Release);
    } else if t != SyncIoState::PAST {
        let thread: HANDLE = ptr::with_exposed_provenance_mut::<c_void>(t);
        // Spin until the worker acknowledges it is past blocking; a cancel
        // can miss (ERROR_NOT_FOUND) when the thread is between syscalls.
        // // quirk: PIPE-35
        while state.thread.load(Ordering::Acquire) != SyncIoState::PAST {
            // SAFETY: the worker closes its duplicated handle only after the
            // lock handshake, and we hold the lock — `thread` is live.
            unsafe { CancelSynchronousIo(thread) };
            SwitchToThread();
        }
    }
    drop(guard);
}

// ───────────────────────── request blocks ─────────────────────────

/// One queued/in-flight write. Heap-pinned; the kernel (or a pool worker)
/// owns it from submit until its completion is dispatched. `req` MUST stay
/// the first field — the dispatcher recovers the block from the OVERLAPPED.
#[repr(C)]
struct WriteReq {
    req: Req,
    next: *mut WriteReq,
    buf: *const u8,
    len: usize,
    /// Coalesced copy of a vectored write; keeps `buf` alive. // quirk: PIPE-42
    owned: Option<Box<[u8]>>,
    cb: Option<PipeWriteCb>,
    data: *mut c_void,
    /// Worker snapshots (the worker never touches `PipeHandle` memory).
    handle: HANDLE,
    iocp: HANDLE,
    sync: SyncIoState,
}

/// One in-flight connect. Heap-pinned; the busy-retry worker writes ONLY to
/// this block, never to the handle. // quirk: PIPE-28
#[repr(C)]
struct ConnectReq {
    req: Req,
    /// NUL-terminated snapshot of the target name (the handle's copy can be
    /// freed by close while the worker runs). // quirk: PIPE-28
    name: Vec<u16>,
    /// `name` re-spelled `\\.\...` for `WaitNamedPipeW`, which parses the
    /// path itself and rejects the `\\?\` no-parse prefix CreateFileW
    /// accepts (ERROR_BAD_PATHNAME). // quirk: PIPE-27
    wait_name: Vec<u16>,
    pipe_handle: HANDLE,
    readable: bool,
    writable: bool,
    cb: Option<PipeConnectCb>,
    data: *mut c_void,
    iocp: HANDLE,
}

/// One server accept slot: a pre-created instance with a pending overlapped
/// `ConnectNamedPipe`. Each instance handle has exactly one owner — this
/// slot until `accept()` transfers it to the new connection (no rotating
/// stash aliasing). // quirk: PIPE-22, PIPE-23
#[repr(C)]
struct AcceptSlot {
    req: Req,
    pipe_handle: HANDLE,
    idx: usize,
    /// `ConnectNamedPipe` in flight.
    armed: bool,
    /// Completed, awaiting `accept()`.
    connected: bool,
    /// Synchronous re-arm failure was delivered; slot is inert.
    parked: bool,
}

/// Heap block for a blocking read on the system pool. Allocated by submit,
/// written by the worker, read and freed by the dispatcher; only the `sync`
/// handshake is shared while the worker runs. // quirk: PIPE-34, PIPE-35
struct ReadWork {
    handle: HANDLE,
    buf: *mut u8,
    len: DWORD,
    iocp: HANDLE,
    /// The handle's read req OVERLAPPED, passed BY VALUE to
    /// `PostQueuedCompletionStatus`; the worker never dereferences it.
    overlapped: *mut bun_windows_sys::OVERLAPPED,
    sync: SyncIoState,
    bytes: DWORD,
    error: Win32Error,
}

/// Heap block for the pool `FlushFileBuffers` of a shutdown. The flush
/// result is deliberately ignored (libuv parity — a broken peer already
/// surfaced on the write path); the block exists for the cancellation
/// handshake and the post. // quirk: PIPE-50
struct ShutdownWork {
    handle: HANDLE,
    iocp: HANDLE,
    overlapped: *mut bun_windows_sys::OVERLAPPED,
    sync: SyncIoState,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ShutdownState {
    Idle,
    /// `shutdown()` called; waiting for the write queue to drain.
    Requested,
    /// Probe/flush in flight (or its completion queued).
    Flushing,
    Done,
}

// ───────────────────────── the handle ─────────────────────────

/// A named-pipe handle on the IOCP loop: a connection (pair end, accepted
/// client, connected client, adopted fd) or a server (bound + listening).
/// Heap-pinned by its owner for as long as it is active or has requests in
/// flight; destruction is the deferred endgame protocol — `close()` then
/// free only after the close callback. // quirk: LOOP-04, PIPE-54
#[repr(C)]
pub struct PipeHandle {
    core: HandleCore,
    handle: HANDLE,
    /// `false` = synchronous handle: all I/O detours through pool workers.
    /// Immutable per handle (overlappedness is fixed at creation).
    /// // quirk: PIPE-13
    overlapped_io: bool,
    /// Synchronous completions bypass the port and are funneled through the
    /// pending queue at the submit site. // quirk: PIPE-18
    sync_bypass: bool,
    readable: bool,
    writable: bool,
    server: bool,
    listening: bool,
    reading: bool,
    read_pending: bool,
    connect_pending: bool,
    /// Shutdown completed on a readable pipe: the EOF grace timer governs
    /// force-close. // quirk: PIPE-51
    eof_timer_active: bool,
    shutdown_state: ShutdownState,
    read_buf: *mut u8,
    read_len: usize,
    /// Snapshot of (buf, len) the in-flight read targets — `read_start`
    /// while a read is parked may retarget future reads, never this one.
    inflight_buf: *mut u8,
    inflight_len: usize,
    read_cb: Option<PipeReadCb>,
    read_data: *mut c_void,
    read_req: Req,
    read_work: *mut ReadWork,
    /// Completion that arrived while stopped: `(buffer, n, err)`, delivered
    /// (asynchronously) by the next `read_start`. // quirk: PIPE-32, PIPE-36
    stashed: Option<(*mut u8, usize, Win32Error)>,
    write_head: *mut WriteReq,
    write_tail: *mut WriteReq,
    write_inflight: *mut WriteReq,
    write_queue_size: usize,
    shutdown_req: Req,
    shutdown_cb: Option<PipeShutdownCb>,
    shutdown_data: *mut c_void,
    shutdown_work: *mut ShutdownWork,
    eof_timer: Timer,
    /// Bound server name, NUL-terminated; lives until the endgame (accept
    /// re-arms read it). // quirk: PIPE-54
    name: Option<Box<[u16]>>,
    connection_cb: Option<PipeConnectionCb>,
    connection_data: *mut c_void,
    // Box per slot is load-bearing: the kernel holds each slot req's
    // OVERLAPPED; a Vec reallocation would move it mid-flight.
    #[allow(clippy::vec_box)]
    accepts: Vec<Box<AcceptSlot>>,
    pending_accepts: usize,
    close_cb: Option<PipeCloseCb>,
    close_data: *mut c_void,
}

/// # Safety
/// `lp` must be a valid pinned loop that outlives the handle.
unsafe fn new_box(lp: *mut Loop) -> Box<PipeHandle> {
    let mut h = Box::new(PipeHandle {
        // SAFETY: fn contract — the loop outlives the handle; the box below
        // is the required heap pinning.
        core: unsafe { HandleCore::new(lp, pipe_endgame) },
        handle: INVALID_HANDLE_VALUE,
        overlapped_io: true,
        sync_bypass: false,
        readable: false,
        writable: false,
        server: false,
        listening: false,
        reading: false,
        read_pending: false,
        connect_pending: false,
        eof_timer_active: false,
        shutdown_state: ShutdownState::Idle,
        read_buf: ptr::null_mut(),
        read_len: 0,
        inflight_buf: ptr::null_mut(),
        inflight_len: 0,
        read_cb: None,
        read_data: ptr::null_mut(),
        read_req: Req::new(ReqKind::PipeRead, ptr::null_mut()),
        read_work: ptr::null_mut(),
        stashed: None,
        write_head: ptr::null_mut(),
        write_tail: ptr::null_mut(),
        write_inflight: ptr::null_mut(),
        write_queue_size: 0,
        shutdown_req: Req::new(ReqKind::PipeShutdown, ptr::null_mut()),
        shutdown_cb: None,
        shutdown_data: ptr::null_mut(),
        shutdown_work: ptr::null_mut(),
        eof_timer: Timer::new(),
        name: None,
        connection_cb: None,
        connection_data: ptr::null_mut(),
        accepts: Vec::new(),
        pending_accepts: 0,
        close_cb: None,
        close_data: ptr::null_mut(),
    });
    // The embedded reqs' owner back-pointer is the heap-pinned address.
    let hp: *mut PipeHandle = &raw mut *h;
    h.read_req = Req::new(ReqKind::PipeRead, hp.cast::<c_void>());
    h.shutdown_req = Req::new(ReqKind::PipeShutdown, hp.cast::<c_void>());
    h
}

impl PipeHandle {
    /// Create an idle handle for a later [`connect`](Self::connect) or
    /// [`bind`](Self::bind).
    ///
    /// # Safety
    /// `lp` must be a valid pinned loop that outlives the handle; the caller
    /// must keep the returned box alive until the close callback runs.
    pub unsafe fn new(lp: *mut Loop) -> Box<PipeHandle> {
        // SAFETY: forwarded fn contract.
        unsafe { new_box(lp) }
    }

    /// Adopt an existing pipe handle (pair end, inherited stdio, foreign
    /// runtime fd). Forces byte/wait read mode where permitted (tolerating
    /// read-only and message-mode handles), probes overlapped capability,
    /// derives readable/writable from the granted access mask, and attaches
    /// overlapped handles to the loop's port.
    ///
    /// Takes ownership of `handle` on success (close() releases it); on
    /// error the caller retains ownership. Callers adopting stdio fds 0-2
    /// must duplicate the handle first — close must be able to cancel I/O
    /// without killing the process's stdio. // quirk: PIPE-19
    ///
    /// # Safety
    /// `lp` must be a valid pinned loop outliving the handle; `handle` must
    /// be a valid pipe(-like) kernel handle owned by the caller, and no
    /// other owner may issue I/O on it once adopted.
    pub unsafe fn open(lp: *mut Loop, handle: HANDLE) -> Result<Box<PipeHandle>, Win32Error> {
        // SAFETY: fn contract — `handle` valid, `lp` valid and pinned.
        unsafe {
            set_pipe_mode_byte(handle)?; // quirk: PIPE-10, PIPE-11, PIPE-12
            let overlapped = probe_overlapped(handle)?; // quirk: PIPE-13

            // Direction from the granted access mask, never trial I/O.
            // // quirk: PIPE-15
            let mut access = FILE_ACCESS_INFORMATION::default();
            let mut iosb = IO_STATUS_BLOCK {
                Status: 0,
                Information: 0,
            };
            let status = NtQueryInformationFile(
                handle,
                &raw mut iosb,
                (&raw mut access).cast::<c_void>(),
                size_of::<FILE_ACCESS_INFORMATION>() as ULONG,
                FILE_INFORMATION_CLASS::FileAccessInformation,
            );
            if status != NTSTATUS::SUCCESS {
                return Err(Win32Error::from_ntstatus(status));
            }

            // No EMULATE_IOCP shim: a handle already bound to a foreign port
            // fails loudly here (recorded decision; PIPE-16). // quirk: PIPE-14
            let sync_bypass = if overlapped {
                attach_iocp(lp, handle)?
            } else {
                false
            };

            let mut h = new_box(lp);
            h.handle = handle;
            h.overlapped_io = overlapped;
            h.sync_bypass = sync_bypass;
            h.readable = access.AccessFlags & FILE_READ_DATA != 0;
            h.writable = access.AccessFlags & FILE_WRITE_DATA != 0;
            Ok(h)
        }
    }

    #[inline]
    pub fn raw_handle(&self) -> HANDLE {
        self.handle
    }
    #[inline]
    pub fn is_readable(&self) -> bool {
        self.readable
    }
    #[inline]
    pub fn is_writable(&self) -> bool {
        self.writable
    }
    #[inline]
    pub fn is_closing(&self) -> bool {
        self.core.is_closing()
    }
    /// Bytes accepted by `write()` whose completions have not yet
    /// dispatched (kernel-queued plus crate-queued). // quirk: PIPE-44
    #[inline]
    pub fn write_queue_size(&self) -> usize {
        self.write_queue_size
    }
    /// Connected clients awaiting [`accept`](Self::accept).
    #[inline]
    pub fn pending_accepts(&self) -> usize {
        self.pending_accepts
    }

    /// Drop the loop keep-alive without stopping I/O (close still holds the
    /// loop until the close callback).
    pub fn unref(&mut self) {
        self.core.unref();
    }
    /// Restore the keep-alive dropped by [`unref`](Self::unref).
    pub fn ref_(&mut self) {
        self.core.ref_();
    }

    // ── reading ──────────────────────────────────────────────────────────

    /// Start (or retarget) reading: every completion delivers into `buf` via
    /// `cb`. One read is in flight at a time; a parked in-flight read keeps
    /// targeting the buffer it was submitted with (the callback names the
    /// buffer for exactly this reason). `buf` must stay valid until the
    /// close callback, or until a callback fires after a later `read_start`
    /// with a different buffer. // quirk: PIPE-33
    ///
    /// # Safety
    /// `buf..buf+len` must be writable and unaliased for the duration above;
    /// `data` must be valid whenever the callback can run.
    pub unsafe fn read_start(
        &mut self,
        buf: *mut u8,
        len: usize,
        cb: PipeReadCb,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if buf.is_null() || len == 0 {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        let has_stash = self.stashed.is_some();
        if !has_stash && (self.handle == INVALID_HANDLE_VALUE || !self.readable) {
            return Err(Win32Error::PIPE_NOT_CONNECTED);
        }
        self.reading = true;
        self.read_cb = Some(cb);
        self.read_data = data;
        self.read_buf = buf;
        self.read_len = len.min(MAX_RW_BYTES); // quirk: PIPE-39
        self.core.start();
        let lp = self.core.loop_;
        let hp: *mut PipeHandle = self;
        if has_stash {
            // Deliver the parked completion asynchronously through the
            // normal dispatch path — never a synchronous callback.
            // // quirk: PIPE-32, PIPE-29
            debug_assert!(!self.read_pending);
            self.read_pending = true;
            self.core.req_submitted_uncounted();
            // SAFETY: the read req is free (no read in flight while a stash
            // exists) and lives inside the pinned handle.
            unsafe { (*lp).insert_pending(&raw mut self.read_req) };
        } else if !self.read_pending {
            // SAFETY: handle pinned, loop valid (init contract), not closing.
            unsafe { submit_read(lp, hp) };
        }
        Ok(())
    }

    /// Stop delivering read callbacks, synchronously. The in-flight read is
    /// NOT cancelled (cancellation can swallow concurrently-arriving bytes);
    /// it parks, and a completion landing while stopped is stashed for the
    /// next `read_start`. // quirk: PIPE-32, PIPE-36
    pub fn read_stop(&mut self) {
        debug_assert!(!self.core.is_closing());
        self.reading = false;
        if !self.core.is_closing() {
            self.core.stop();
        }
    }

    // ── writing ──────────────────────────────────────────────────────────

    /// Queue a write. Strict FIFO per handle, one kernel/worker submission
    /// in flight at a time. A single buffer is written zero-copy; vectored
    /// writes are coalesced into one owned allocation at call time (pipes
    /// have no scatter/gather WriteFile). Zero-length writes are real
    /// operations. `cb` fires exactly once. // quirk: ADD-03, PIPE-42, PIPE-44
    ///
    /// # Safety
    /// For a single-buffer write, `bufs[0]` must stay valid and unmodified
    /// until `cb` runs; coalesced (multi-buffer) writes are copied before
    /// return. `data` must be valid whenever `cb` can run.
    pub unsafe fn write(
        &mut self,
        bufs: &[&[u8]],
        cb: Option<PipeWriteCb>,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if self.shutdown_state != ShutdownState::Idle {
            // Write-after-shutdown: raw NO_DATA (consumers map to EPIPE).
            // // quirk: PIPE-37
            return Err(Win32Error::NO_DATA);
        }
        if self.handle == INVALID_HANDLE_VALUE || !self.writable {
            return Err(Win32Error::NO_DATA);
        }
        if bufs.len() > MAX_WRITE_BUFS {
            return Err(Win32Error::INVALID_PARAMETER); // quirk: PIPE-39
        }
        let mut total: usize = 0;
        for b in bufs {
            total = total
                .checked_add(b.len())
                .ok_or(Win32Error::INVALID_PARAMETER)?;
        }
        if total > MAX_RW_BYTES {
            return Err(Win32Error::INVALID_PARAMETER); // quirk: PIPE-39
        }

        let (buf, owned): (*const u8, Option<Box<[u8]>>) = if total == 0 {
            (&raw const EMPTY_WRITE, None) // quirk: PIPE-44
        } else if let [one] = bufs {
            (one.as_ptr(), None)
        } else {
            // quirk: PIPE-42
            let mut v: Vec<u8> = Vec::with_capacity(total);
            for b in bufs {
                v.extend_from_slice(b);
            }
            let boxed = v.into_boxed_slice();
            (boxed.as_ptr(), Some(boxed))
        };

        let hp: *mut PipeHandle = self;
        let wr = Box::into_raw(Box::new(WriteReq {
            req: Req::new(ReqKind::PipeWrite, hp.cast::<c_void>()),
            next: ptr::null_mut(),
            buf,
            len: total,
            owned,
            cb,
            data,
            handle: INVALID_HANDLE_VALUE,
            iocp: ptr::null_mut(),
            sync: SyncIoState::new(),
        }));
        // SAFETY: `wr` is a fresh heap block; queue links are handle-private.
        unsafe {
            if self.write_tail.is_null() {
                self.write_head = wr;
            } else {
                (*self.write_tail).next = wr;
            }
            self.write_tail = wr;
        }
        self.write_queue_size += total;
        // Every write holds the loop from enqueue to callback. // quirk: LOOP-25
        self.core.req_submitted();
        if self.write_inflight.is_null() {
            // SAFETY: handle pinned, loop valid, not closing.
            unsafe { submit_next_write(self.core.loop_, hp) };
        }
        Ok(())
    }

    // ── shutdown ─────────────────────────────────────────────────────────

    /// Flush-then-signal shutdown: waits for every queued write, probes
    /// whether the peer already drained the pipe buffer, otherwise flushes
    /// on the system pool, then fires `cb`. Writes after `shutdown` are
    /// rejected. On a readable pipe the handle stays open afterwards under a
    /// 50 ms EOF grace window. // quirk: PIPE-50, PIPE-51, PIPE-52
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run.
    pub unsafe fn shutdown(
        &mut self,
        cb: Option<PipeShutdownCb>,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if self.shutdown_state != ShutdownState::Idle {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        if self.handle == INVALID_HANDLE_VALUE || !self.writable {
            return Err(Win32Error::NO_DATA);
        }
        self.shutdown_state = ShutdownState::Requested;
        self.shutdown_cb = cb;
        self.shutdown_data = data;
        // The pending shutdown holds the loop until its callback.
        self.core.req_submitted();
        if self.write_inflight.is_null() && self.write_head.is_null() {
            let hp: *mut PipeHandle = self;
            // SAFETY: handle pinned, loop valid, not closing.
            unsafe { start_shutdown(self.core.loop_, hp) };
        }
        Ok(())
    }

    // ── server ───────────────────────────────────────────────────────────

    /// Claim `name` (UTF-16, no NULs) as a pipe server: creates the first
    /// instance with FIRST_PIPE_INSTANCE so an existing name fails with the
    /// raw ERROR_ACCESS_DENIED (consumers remap to EADDRINUSE) and a bad
    /// name with PATH_NOT_FOUND/INVALID_NAME (consumers remap to EACCES).
    /// // quirk: PIPE-21, PIPE-26
    pub fn bind(&mut self, name: &[u16]) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if self.server || self.handle != INVALID_HANDLE_VALUE || self.connect_pending {
            return Err(Win32Error::INVALID_PARAMETER); // quirk: PIPE-25
        }
        // Embedded NUL is a security boundary (C-string truncation), and the
        // name is copied with an explicit terminator. No length cap exists
        // on Windows. // quirk: PIPE-26
        if name.is_empty() || name.contains(&0) {
            return Err(Win32Error::INVALID_NAME);
        }
        let mut wname = name.to_vec();
        wname.push(0);
        // SAFETY: `wname` is NUL-terminated and outlives the call.
        let inst = unsafe {
            CreateNamedPipeW(
                wname.as_ptr(),
                PIPE_ACCESS_DUPLEX
                    | FILE_FLAG_OVERLAPPED
                    | WRITE_DAC
                    | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                PIPE_BUFFER_SIZE,
                PIPE_BUFFER_SIZE,
                0,
                ptr::null_mut(),
            )
        }; // quirk: PIPE-04
        if inst == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get());
        }
        // SAFETY: fresh instance handle; loop valid (init contract).
        let bypass = match unsafe { attach_iocp(self.core.loop_, inst) } {
            Ok(b) => b,
            Err(err) => {
                // SAFETY: `inst` created above, not yet shared.
                unsafe { CloseHandle(inst) };
                return Err(err);
            }
        };
        self.sync_bypass = bypass;
        self.server = true;
        self.name = Some(wname.into_boxed_slice());
        let hp: *mut PipeHandle = self;
        self.accepts.push(Box::new(AcceptSlot {
            req: Req::new(ReqKind::PipeAccept, hp.cast::<c_void>()),
            pipe_handle: inst,
            idx: 0,
            armed: false,
            connected: false,
            parked: false,
        }));
        Ok(())
    }

    /// Start accepting: pre-creates `pending_instances` instances (min 1,
    /// libuv default 4) each with a pending overlapped ConnectNamedPipe —
    /// named pipes have no real backlog, so without the pool concurrent
    /// connects fail PIPE_BUSY. Re-listen swaps the callback.
    /// // quirk: PIPE-22, PIPE-25
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run.
    pub unsafe fn listen(
        &mut self,
        pending_instances: u32,
        cb: PipeConnectionCb,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if !self.server {
            return Err(Win32Error::INVALID_PARAMETER); // quirk: PIPE-25
        }
        self.connection_cb = Some(cb);
        self.connection_data = data;
        if self.listening {
            return Ok(()); // quirk: PIPE-25 (re-listen swaps cb)
        }
        self.listening = true;
        self.core.start();
        let want = pending_instances.max(1) as usize;
        let hp: *mut PipeHandle = self;
        while self.accepts.len() < want {
            let idx = self.accepts.len();
            self.accepts.push(Box::new(AcceptSlot {
                req: Req::new(ReqKind::PipeAccept, hp.cast::<c_void>()),
                pipe_handle: INVALID_HANDLE_VALUE,
                idx,
                armed: false,
                connected: false,
                parked: false,
            }));
        }
        let lp = self.core.loop_;
        for idx in 0..want {
            // SAFETY: handle pinned, loop valid, slots heap-pinned in their
            // boxes.
            unsafe { queue_accept(lp, hp, idx) };
        }
        Ok(())
    }

    /// Take a connected client. The instance handle transfers to the new
    /// connection and a fresh instance is re-armed into the freed slot
    /// immediately. Errors with WSAEWOULDBLOCK when nothing is pending.
    /// // quirk: PIPE-22, PIPE-23
    pub fn accept(&mut self) -> Result<Box<PipeHandle>, Win32Error> {
        if !self.server {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        let Some(idx) = self.accepts.iter().position(|s| s.connected) else {
            return Err(Win32Error::WSAEWOULDBLOCK);
        };
        let inst = {
            let slot = &mut self.accepts[idx];
            slot.connected = false;
            mem::replace(&mut slot.pipe_handle, INVALID_HANDLE_VALUE)
        };
        self.pending_accepts -= 1;
        let lp = self.core.loop_;
        let hp: *mut PipeHandle = self;
        if !self.core.is_closing() {
            // SAFETY: handle pinned, loop valid, slot heap-pinned.
            unsafe { queue_accept(lp, hp, idx) }; // quirk: PIPE-22 re-arm
        }
        // The accepted instance inherits the server's byte mode, IOCP
        // association and completion modes. // quirk: PIPE-18
        // SAFETY: loop valid and pinned (init contract).
        let mut conn = unsafe { new_box(lp) };
        conn.handle = inst;
        conn.overlapped_io = true;
        conn.sync_bypass = self.sync_bypass;
        conn.readable = true;
        conn.writable = true;
        Ok(conn)
    }

    // ── client ───────────────────────────────────────────────────────────

    /// Connect to a pipe server by name. The result — including every
    /// validation failure — is delivered asynchronously via `cb`; when all
    /// instances are busy a system-pool worker retries `WaitNamedPipeW` +
    /// reopen for up to 30 s per round. // quirk: PIPE-27, PIPE-29
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run.
    pub unsafe fn connect(
        &mut self,
        name: &[u16],
        cb: Option<PipeConnectCb>,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            // Operations on a closing handle are a caller bug; the endgame
            // may already be queued, so no new request may be created.
            return Err(Win32Error::INVALID_HANDLE);
        }
        // Pre-checks deliver asynchronously. // quirk: PIPE-29, PIPE-25, PIPE-26
        let precheck = if self.server {
            Some(Win32Error::INVALID_PARAMETER)
        } else if self.handle != INVALID_HANDLE_VALUE || self.connect_pending {
            Some(Win32Error::PIPE_BUSY)
        } else if name.is_empty() || name.contains(&0) {
            Some(Win32Error::INVALID_NAME)
        } else {
            None
        };

        let mut wname = name.to_vec();
        wname.push(0); // quirk: PIPE-26, PIPE-28 (private snapshot)
        let mut wait_name = wname.clone();
        // `\\?\pipe\X` -> `\\.\pipe\X`: same object, but the only spelling
        // WaitNamedPipeW's own parser accepts. // quirk: PIPE-27
        if wait_name.starts_with(&[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16]) {
            wait_name[2] = b'.' as u16;
        }
        let lp = self.core.loop_;
        let hp: *mut PipeHandle = self;
        // SAFETY: loop valid (init contract).
        let iocp = unsafe { (*lp).iocp() };
        let cr = Box::into_raw(Box::new(ConnectReq {
            req: Req::new(ReqKind::PipeConnect, hp.cast::<c_void>()),
            name: wname,
            wait_name,
            pipe_handle: INVALID_HANDLE_VALUE,
            readable: false,
            writable: false,
            cb,
            data,
            iocp,
        }));
        self.connect_pending = true;
        self.core.req_submitted(); // the connect holds the loop // quirk: PIPE-27
        // SAFETY: `cr` is heap-pinned until its completion dispatches; the
        // loop is valid.
        unsafe {
            if let Some(err) = precheck {
                (*cr).req.set_error(err);
                (*lp).insert_pending(&raw mut (*cr).req); // quirk: PIPE-29
                return Ok(());
            }
            match open_named_pipe((*cr).name.as_ptr()) {
                Ok((ph, readable, writable)) => {
                    (*cr).pipe_handle = ph;
                    (*cr).readable = readable;
                    (*cr).writable = writable;
                    (*cr).req.set_success(0);
                    (*lp).insert_pending(&raw mut (*cr).req); // quirk: PIPE-29
                }
                Err(Win32Error::PIPE_BUSY) => {
                    // quirk: PIPE-27
                    if QueueUserWorkItem(
                        pipe_connect_thread_proc,
                        cr.cast::<c_void>(),
                        WT_EXECUTELONGFUNCTION,
                    ) == 0
                    {
                        (*cr).req.set_error(Win32Error::get());
                        (*lp).insert_pending(&raw mut (*cr).req);
                    }
                }
                Err(err) => {
                    (*cr).req.set_error(err);
                    (*lp).insert_pending(&raw mut (*cr).req); // quirk: PIPE-58
                }
            }
        }
        Ok(())
    }

    // ── close ────────────────────────────────────────────────────────────

    /// Begin the asynchronous close: interrupt blocked pool workers, close
    /// the OS handles (in-flight overlapped I/O completes with
    /// STATUS_CANCELLED and drains), fail every not-yet-submitted write with
    /// OPERATION_ABORTED, and settle a pending shutdown. `cb` runs from the
    /// loop once every request drained; only then may the owner free the
    /// box. No read callback fires after close. // quirk: PIPE-54, PIPE-24
    pub fn close(&mut self, cb: Option<PipeCloseCb>, data: *mut c_void) {
        self.close_cb = cb;
        self.close_data = data;
        self.reading = false;
        let lp = self.core.loop_;

        // 1. Force blocked pool workers past their syscalls so closing the
        //    handle below cannot race a fresh syscall on a recycled handle
        //    value. // quirk: PIPE-35, PIPE-54
        if !self.read_work.is_null() {
            // SAFETY: `read_work` is freed only by its completion dispatch,
            // which cannot run while we are on the loop thread.
            sync_io_interrupt(unsafe { &(*self.read_work).sync });
        }
        if !self.write_inflight.is_null() && !self.overlapped_io {
            // SAFETY: same liveness argument; only the `sync` field of a
            // worker-owned WriteReq is shared.
            sync_io_interrupt(unsafe { &(*self.write_inflight).sync });
        }
        if !self.shutdown_work.is_null() {
            // SAFETY: same liveness argument as `read_work`.
            sync_io_interrupt(unsafe { &(*self.shutdown_work).sync });
        }

        // 2. EOF grace timer. // quirk: PIPE-54
        if self.eof_timer_active {
            self.eof_timer_active = false;
            // SAFETY: loop valid (init contract).
            unsafe { (*lp).timer_stop(&mut self.eof_timer) };
        }

        // 3. Server instances: each pending ConnectNamedPipe completes
        //    aborted and its drain only balances the count. // quirk: PIPE-24
        for slot in &mut self.accepts {
            if slot.pipe_handle != INVALID_HANDLE_VALUE {
                // SAFETY: instance handles are owned by their slots, closed
                // exactly once here (accept() nulls before transfer).
                unsafe { CloseHandle(slot.pipe_handle) };
                slot.pipe_handle = INVALID_HANDLE_VALUE;
            }
            slot.connected = false;
        }
        self.pending_accepts = 0;

        // 4. Connection handle: pending overlapped reads/writes complete
        //    with STATUS_CANCELLED eventually; their request memory stays
        //    alive until each drain (endgame gating). // quirk: PIPE-54, LOOP-04
        if self.handle != INVALID_HANDLE_VALUE {
            // SAFETY: the handle is owned by this PipeHandle; workers are
            // past their syscalls (step 1).
            unsafe { CloseHandle(self.handle) };
            self.handle = INVALID_HANDLE_VALUE;
        }

        // 5. Not-yet-submitted writes complete-with-error through the
        //    pending funnel — every path completes. // quirk: PIPE-58
        let mut wr = self.write_head;
        self.write_head = ptr::null_mut();
        self.write_tail = ptr::null_mut();
        while !wr.is_null() {
            // SAFETY: queued (non-inflight) writes are loop-owned; each is
            // detached and inserted exactly once.
            unsafe {
                let next = (*wr).next;
                (*wr).next = ptr::null_mut();
                (*wr).req.set_error(Win32Error::OPERATION_ABORTED);
                (*lp).insert_pending(&raw mut (*wr).req);
                wr = next;
            }
        }

        // 6. A shutdown that never started flushing must still settle its
        //    callback slot.
        if self.shutdown_state == ShutdownState::Requested {
            self.shutdown_state = ShutdownState::Flushing;
            self.shutdown_req.set_error(Win32Error::OPERATION_ABORTED);
            // SAFETY: the shutdown req is free (never submitted) and lives
            // inside the pinned handle.
            unsafe { (*lp).insert_pending(&raw mut self.shutdown_req) };
        }

        // 7. A parked completion that was never re-delivered dies with the
        //    handle.
        self.stashed = None;

        self.core.close();
    }
}

// ───────────────────────── adoption helpers ─────────────────────────

/// Force `PIPE_READMODE_BYTE | PIPE_WAIT`, tolerating handles we lack write
/// access to as long as their current mode is usable. // quirk: PIPE-10
///
/// # Safety
/// `handle` must be a valid kernel handle.
unsafe fn set_pipe_mode_byte(handle: HANDLE) -> Result<(), Win32Error> {
    let mut mode: DWORD = PIPE_READMODE_BYTE | PIPE_WAIT;
    // SAFETY: valid local mode pointer; collection params unused for this
    // mode change.
    if unsafe { SetNamedPipeHandleState(handle, &raw mut mode, ptr::null_mut(), ptr::null_mut()) }
        != 0
    {
        return Ok(());
    }
    match Win32Error::get() {
        Win32Error::ACCESS_DENIED => {
            // Read-only handle (Chrome native messaging, Cygwin/Mintty):
            // accept the current mode unless it is PIPE_NOWAIT.
            // // quirk: PIPE-10, PIPE-11
            let mut current: DWORD = 0;
            // SAFETY: valid out-pointer; no user-name buffer requested.
            if unsafe {
                GetNamedPipeHandleStateW(
                    handle,
                    &raw mut current,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    0,
                )
            } == 0
            {
                return Err(Win32Error::get());
            }
            if current & PIPE_NOWAIT != 0 {
                return Err(Win32Error::ACCESS_DENIED); // quirk: PIPE-11
            }
            Ok(())
        }
        // Not actually a pipe (a disk file, …): the raw spelling of
        // ENOTSOCK. // quirk: PIPE-12
        Win32Error::INVALID_PARAMETER => Err(Win32Error::WSAENOTSOCK),
        err => Err(err),
    }
}

/// Overlapped-capability probe; overlappedness is immutable after creation,
/// and there is no Win32-level query. // quirk: PIPE-13
///
/// # Safety
/// `handle` must be a valid kernel handle.
unsafe fn probe_overlapped(handle: HANDLE) -> Result<bool, Win32Error> {
    let mut mode_info = FILE_MODE_INFORMATION::default();
    let mut iosb = IO_STATUS_BLOCK {
        Status: 0,
        Information: 0,
    };
    // SAFETY: valid out-pointers sized to the query.
    let status = unsafe {
        NtQueryInformationFile(
            handle,
            &raw mut iosb,
            (&raw mut mode_info).cast::<c_void>(),
            size_of::<FILE_MODE_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FileModeInformation,
        )
    };
    if status != NTSTATUS::SUCCESS {
        return Err(Win32Error::from_ntstatus(status));
    }
    Ok(mode_info.Mode & (FILE_SYNCHRONOUS_IO_ALERT | FILE_SYNCHRONOUS_IO_NONALERT) == 0)
}

/// Associate with the loop's port and request completion-mode shortcuts:
/// SKIP_SET_EVENT always (no waiters on the file object), SKIP on success so
/// synchronous completions are consumed at the submit site instead of
/// round-tripping through the port; SFCNM failure just disables the bypass.
/// // quirk: PIPE-18
///
/// # Safety
/// `lp` must be a valid pinned loop; `handle` a valid overlapped handle not
/// yet associated with any port.
unsafe fn attach_iocp(lp: *mut Loop, handle: HANDLE) -> Result<bool, Win32Error> {
    // SAFETY: fn contract.
    unsafe { (*lp).associate(handle, handle.expose_provenance())? };
    // SAFETY: opaque handle, by-value flags.
    let ok = unsafe {
        SetFileCompletionNotificationModes(
            handle,
            FILE_SKIP_SET_EVENT_ON_HANDLE | FILE_SKIP_COMPLETION_PORT_ON_SUCCESS,
        )
    };
    Ok(ok != 0)
}

/// Client-side open with the half-duplex degrade ladder: duplex →
/// read-only → write-only on ERROR_ACCESS_DENIED, cross-granting the
/// attribute rights the other direction's machinery needs. Returns
/// `(handle, readable, writable)`. // quirk: PIPE-09
///
/// # Safety
/// `name` must point at a NUL-terminated UTF-16 string.
unsafe fn open_named_pipe(name: *const u16) -> Result<(HANDLE, bool, bool), Win32Error> {
    // SAFETY: fn contract — `name` NUL-terminated; no other pointers.
    unsafe {
        let h = CreateFileW(
            name,
            GENERIC_READ | GENERIC_WRITE,
            0,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED,
            ptr::null_mut(),
        );
        if h != INVALID_HANDLE_VALUE {
            return Ok((h, true, true));
        }
        if Win32Error::get() == Win32Error::ACCESS_DENIED {
            let h = CreateFileW(
                name,
                GENERIC_READ | FILE_WRITE_ATTRIBUTES,
                0,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                ptr::null_mut(),
            );
            if h != INVALID_HANDLE_VALUE {
                return Ok((h, true, false));
            }
        }
        if Win32Error::get() == Win32Error::ACCESS_DENIED {
            let h = CreateFileW(
                name,
                GENERIC_WRITE | FILE_READ_ATTRIBUTES,
                0,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                ptr::null_mut(),
            );
            if h != INVALID_HANDLE_VALUE {
                return Ok((h, false, true));
            }
        }
        Err(Win32Error::get())
    }
}

// ───────────────────────── read machinery ─────────────────────────

/// Issue the (single) in-flight read for `h`. // quirk: PIPE-33
///
/// # Safety
/// `lp` and `h` must be valid and pinned; no read may be in flight; the
/// handle must be open and not closing.
unsafe fn submit_read(lp: *mut Loop, h: *mut PipeHandle) {
    // SAFETY: fn contract; interior pointers derive from the pinned handle
    // and stay valid until the completion drains (endgame gating).
    unsafe {
        debug_assert!(!(*h).read_pending);
        debug_assert!((*h).handle != INVALID_HANDLE_VALUE);
        (*h).read_pending = true;
        (*h).inflight_buf = (*h).read_buf;
        (*h).inflight_len = (*h).read_len;
        // Prime to STATUS_PENDING so the EOF timer's completed-probe can
        // never read stale success. // quirk: POLL-29, PIPE-51
        (*h).read_req.prime_pending();
        // Reads do not hold the loop — the ACTIVE (reading) handle does.
        (*h).core.req_submitted_uncounted();

        if (*h).overlapped_io {
            let r = ReadFile(
                (*h).handle,
                (*h).inflight_buf,
                (*h).inflight_len as DWORD,
                ptr::null_mut(),
                (*h).read_req.overlapped_ptr().cast::<c_void>(),
            );
            if r != 0 {
                if (*h).sync_bypass {
                    // Synchronous completion: no packet will come; the
                    // kernel already wrote status+bytes into the OVERLAPPED.
                    // // quirk: PIPE-18
                    (*lp).insert_pending(&raw mut (*h).read_req);
                }
            } else {
                let err = Win32Error::get();
                if err != Win32Error::IO_PENDING {
                    // Synchronous failure becomes an asynchronous completion
                    // — one delivery funnel. // quirk: PIPE-58
                    (*h).read_req.set_error(err);
                    (*lp).insert_pending(&raw mut (*h).read_req);
                }
            }
        } else {
            // Blocking read on the system pool, directly into the consumer
            // buffer (no zero-read; no loop-thread sync read).
            // // quirk: PIPE-13, PIPE-34, PIPE-35
            let work = Box::into_raw(Box::new(ReadWork {
                handle: (*h).handle,
                buf: (*h).inflight_buf,
                len: (*h).inflight_len as DWORD,
                iocp: (*lp).iocp(),
                overlapped: (*h).read_req.overlapped_ptr(),
                sync: SyncIoState::new(),
                bytes: 0,
                error: Win32Error::SUCCESS,
            }));
            (*h).read_work = work;
            if QueueUserWorkItem(
                pipe_read_thread_proc,
                work.cast::<c_void>(),
                WT_EXECUTELONGFUNCTION,
            ) == 0
            {
                (*h).read_work = ptr::null_mut();
                drop(Box::from_raw(work));
                (*h).read_req.set_error(Win32Error::get());
                (*lp).insert_pending(&raw mut (*h).read_req); // quirk: PIPE-58
            }
        }

        // Every queued read during the post-shutdown grace re-arms the EOF
        // window. // quirk: PIPE-51
        if (*h).eof_timer_active {
            eof_timer_start(lp, h);
        }
    }
}

/// Blocking-read worker (non-overlapped handles). Touches only its
/// `ReadWork` block. // quirk: PIPE-34, PIPE-35
unsafe extern "system" fn pipe_read_thread_proc(arg: *mut c_void) -> DWORD {
    // SAFETY: `arg` is the ReadWork leaked by submit_read; the worker owns
    // it exclusively (the loop thread only touches `sync`) until the post.
    unsafe {
        let work = arg.cast::<ReadWork>();
        // Out-params zeroed before the conditional syscall. // quirk: PIPE-34
        let mut bytes: DWORD = 0;
        let error;
        match sync_io_enter(&(*work).sync) {
            Err(err) => error = err,
            Ok(thread) => {
                if ReadFile(
                    (*work).handle,
                    (*work).buf,
                    (*work).len,
                    &raw mut bytes,
                    ptr::null_mut(),
                ) != 0
                {
                    error = Win32Error::SUCCESS;
                } else {
                    error = Win32Error::get();
                }
                sync_io_exit(&(*work).sync, thread);
            }
        }
        (*work).bytes = bytes;
        (*work).error = error;
        let iocp = (*work).iocp;
        let overlapped = (*work).overlapped;
        // After this post the loop thread owns the block again.
        PostQueuedCompletionStatus(iocp, 0, 0, overlapped);
    }
    0
}

/// Single delivery path for read completions: kernel packets, worker posts,
/// sync-failure pendings and stash re-deliveries.
pub(crate) fn process_pipe_read_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<PipeHandle>();
    // SAFETY: `data` was set at init to the heap-pinned PipeHandle, kept
    // alive until all reqs drain (endgame protocol); borrows are short-lived
    // and never held across the user callback.
    unsafe {
        (*h).read_pending = false;
        let work = mem::replace(&mut (*h).read_work, ptr::null_mut());
        (*h).core.req_completed_uncounted();
        if (*h).eof_timer_active {
            // Stopped on every completion; re-armed by the next submit.
            // // quirk: PIPE-51
            (*lp).timer_stop(&mut (*h).eof_timer);
        }

        // Resolve (delivery buffer, n, err) from the three sources.
        let (dbuf, n, err): (*mut u8, usize, Win32Error);
        if let Some((sbuf, sn, serr)) = (*h).stashed.take() {
            // Stash re-delivery injected by read_start. // quirk: PIPE-32
            debug_assert!(work.is_null());
            (dbuf, n, err) = (sbuf, sn, serr);
        } else if !work.is_null() {
            let w = Box::from_raw(work);
            // MORE_DATA = short-buffer message-mode read: the buffer IS
            // full; the remainder follows. // quirk: PIPE-10
            if w.error == Win32Error::SUCCESS || w.error == Win32Error::MORE_DATA {
                (dbuf, n, err) = (w.buf, w.bytes as usize, Win32Error::SUCCESS);
            } else {
                (dbuf, n, err) = (w.buf, 0, w.error);
            }
        } else {
            let status = (*req_ptr).status();
            // STATUS_BUFFER_OVERFLOW is the overlapped spelling of
            // MORE_DATA: warning severity, data present. // quirk: PIPE-10
            if (*req_ptr).success() || status == NTSTATUS::BUFFER_OVERFLOW {
                (dbuf, n, err) = (
                    (*h).inflight_buf,
                    (*req_ptr).bytes_transferred(),
                    Win32Error::SUCCESS,
                );
            } else {
                (dbuf, n, err) = ((*h).inflight_buf, 0, (*req_ptr).error());
            }
        }

        if (*h).core.is_closing() {
            // Close contract: no read callback after close. // quirk: PIPE-54
            return;
        }

        if err == Win32Error::OPERATION_ABORTED {
            // Cancellation is never user-visible (external CancelIoEx, EOF
            // force-close): transparently re-arm when still possible.
            // // quirk: PIPE-36, POLL-23
            if (*h).reading && !(*h).read_pending && (*h).handle != INVALID_HANDLE_VALUE {
                submit_read(lp, h);
            }
            return;
        }

        if err != Win32Error::SUCCESS {
            if !(*h).reading {
                // EOF/error while stopped parks like data does — delivered
                // by the next read_start. // quirk: PIPE-36
                (*h).stashed = Some((dbuf, 0, err));
                return;
            }
            // Delivered exactly once; reading stops but the flags are not
            // poisoned — read_start may re-arm (and will re-observe EOF).
            // // quirk: PIPE-37, PIPE-38
            (*h).reading = false;
            (*h).core.stop();
            if let Some(cb) = (*h).read_cb {
                cb(&mut *lp, (*h).read_data, dbuf, 0, err);
            }
            return;
        }

        if !(*h).reading {
            (*h).stashed = Some((dbuf, n, Win32Error::SUCCESS)); // quirk: PIPE-32
            return;
        }
        if n == 0 {
            // Zero-byte completion (zero-length message on an adopted
            // message-mode pipe): nothing to deliver; re-arm.
            if !(*h).read_pending && (*h).handle != INVALID_HANDLE_VALUE {
                submit_read(lp, h);
            }
            return;
        }
        if let Some(cb) = (*h).read_cb {
            cb(&mut *lp, (*h).read_data, dbuf, n, Win32Error::SUCCESS);
        }
        // The callback may have stopped, restarted (fresh read already
        // pending) or closed — re-derive everything; never two reads in
        // flight. // quirk: PIPE-33, POLL-27
        if (*h).reading
            && !(*h).read_pending
            && !(*h).core.is_closing()
            && (*h).handle != INVALID_HANDLE_VALUE
        {
            submit_read(lp, h);
        }
    }
}

// ───────────────────────── write machinery ─────────────────────────

/// Submit the queue head (one in flight at a time), or — when the queue has
/// drained — kick a deferred shutdown. // quirk: ADD-03, PIPE-41, PIPE-50
///
/// # Safety
/// `lp` and `h` valid and pinned; no write in flight; not closing.
unsafe fn submit_next_write(lp: *mut Loop, h: *mut PipeHandle) {
    // SAFETY: fn contract; the WriteReq is heap-pinned until its completion
    // dispatches.
    unsafe {
        debug_assert!((*h).write_inflight.is_null());
        let wr = (*h).write_head;
        if wr.is_null() {
            if (*h).shutdown_state == ShutdownState::Requested && !(*h).core.is_closing() {
                start_shutdown(lp, h); // quirk: PIPE-50 (after writes drain)
            }
            return;
        }
        (*h).write_head = (*wr).next;
        if (*h).write_head.is_null() {
            (*h).write_tail = ptr::null_mut();
        }
        (*wr).next = ptr::null_mut();
        (*h).write_inflight = wr;
        (*wr).handle = (*h).handle;
        (*wr).iocp = (*lp).iocp();
        (*wr).req.prime_pending();

        if (*h).overlapped_io {
            let r = WriteFile(
                (*wr).handle,
                (*wr).buf,
                (*wr).len as DWORD,
                ptr::null_mut(),
                (*wr).req.overlapped_ptr().cast::<c_void>(),
            );
            if r != 0 {
                if (*h).sync_bypass {
                    (*lp).insert_pending(&raw mut (*wr).req); // quirk: PIPE-18
                }
            } else {
                let err = Win32Error::get();
                if err != Win32Error::IO_PENDING {
                    (*wr).req.set_error(err);
                    (*lp).insert_pending(&raw mut (*wr).req); // quirk: PIPE-58
                }
            }
        } else {
            // The queue's single-in-flight discipline IS the serialization:
            // at most one worker thread per pipe, writes in order.
            // // quirk: PIPE-41
            if QueueUserWorkItem(
                pipe_write_thread_proc,
                wr.cast::<c_void>(),
                WT_EXECUTELONGFUNCTION,
            ) == 0
            {
                (*wr).req.set_error(Win32Error::get());
                (*lp).insert_pending(&raw mut (*wr).req);
            }
        }
    }
}

/// Blocking-write worker (non-overlapped handles). Owns its `WriteReq`
/// exclusively until the post; the loop thread touches only `sync`.
/// // quirk: PIPE-41, PIPE-35
unsafe extern "system" fn pipe_write_thread_proc(arg: *mut c_void) -> DWORD {
    // SAFETY: `arg` is the in-flight WriteReq; exclusive ownership per the
    // doc above.
    unsafe {
        let wr = arg.cast::<WriteReq>();
        let mut bytes: DWORD = 0;
        match sync_io_enter(&(*wr).sync) {
            Err(err) => (*wr).req.set_error(err),
            Ok(thread) => {
                if WriteFile(
                    (*wr).handle,
                    (*wr).buf,
                    (*wr).len as DWORD,
                    &raw mut bytes,
                    ptr::null_mut(),
                ) != 0
                {
                    (*wr).req.set_success(bytes as usize);
                } else {
                    (*wr).req.set_error(Win32Error::get());
                }
                sync_io_exit(&(*wr).sync, thread);
            }
        }
        let iocp = (*wr).iocp;
        let overlapped = (*wr).req.overlapped_ptr();
        PostQueuedCompletionStatus(iocp, 0, 0, overlapped);
    }
    0
}

/// Single delivery path for write completions (kernel, worker, close-failed
/// and sync-failure pendings).
pub(crate) fn process_pipe_write_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<PipeHandle>();
    // SAFETY: handle pinned until reqs drain (endgame protocol); the
    // WriteReq is exclusively loop-owned again once its completion is being
    // dispatched.
    unsafe {
        let wr = req_ptr.cast::<WriteReq>();
        if ptr::eq(wr, (*h).write_inflight) {
            (*h).write_inflight = ptr::null_mut();
        }
        debug_assert!((*h).write_queue_size >= (*wr).len);
        (*h).write_queue_size -= (*wr).len; // quirk: PIPE-44
        (*h).core.req_completed();

        let success = (*req_ptr).success();
        let bytes = if success {
            (*req_ptr).bytes_transferred()
        } else {
            0
        };
        let err = if success {
            Win32Error::SUCCESS
        } else {
            (*req_ptr).error()
        };
        let cb = (*wr).cb;
        let data = (*wr).data;
        drop(Box::from_raw(wr));
        if let Some(cb) = cb {
            // Write callbacks fire on every terminal path, including during
            // close (they are one-shot promises, unlike read callbacks).
            cb(&mut *lp, data, bytes, err);
        }
        // The callback may have written (already submitting) or closed.
        if !(*h).core.is_closing() && (*h).write_inflight.is_null() {
            submit_next_write(lp, h);
        }
    }
}

// ───────────────────────── shutdown machinery ─────────────────────────

/// Probe-then-flush, entered only once the write queue is empty.
/// // quirk: PIPE-50
///
/// # Safety
/// `lp`/`h` valid and pinned; shutdown Requested; no write in flight.
unsafe fn start_shutdown(lp: *mut Loop, h: *mut PipeHandle) {
    // SAFETY: fn contract; the shutdown req lives inside the pinned handle.
    unsafe {
        debug_assert_eq!((*h).shutdown_state, ShutdownState::Requested);
        debug_assert!((*h).write_inflight.is_null() && (*h).write_head.is_null());
        (*h).shutdown_state = ShutdownState::Flushing;

        // "All data read" == OutboundQuota == WriteQuotaAvailable: skip the
        // pool flush entirely. Needs FILE_READ_ATTRIBUTES — which the
        // creation-side access dances guarantee. // quirk: PIPE-50, PIPE-05, PIPE-06
        let mut info = FILE_PIPE_LOCAL_INFORMATION::default();
        let mut iosb = IO_STATUS_BLOCK {
            Status: 0,
            Information: 0,
        };
        let status = NtQueryInformationFile(
            (*h).handle,
            &raw mut iosb,
            (&raw mut info).cast::<c_void>(),
            size_of::<FILE_PIPE_LOCAL_INFORMATION>() as ULONG,
            FILE_INFORMATION_CLASS::FilePipeLocalInformation,
        );
        if status != NTSTATUS::SUCCESS {
            // The raw NTSTATUS travels on the req exactly as a kernel
            // completion would carry it. // quirk: LOOP-05
            (*h).shutdown_req.set_status(status);
            (*lp).insert_pending(&raw mut (*h).shutdown_req);
            return;
        }
        if info.OutboundQuota == info.WriteQuotaAvailable {
            (*h).shutdown_req.set_success(0);
            (*lp).insert_pending(&raw mut (*h).shutdown_req);
            return;
        }

        // FlushFileBuffers blocks until the peer drains the buffer — pool
        // worker, with the cancellation handshake for close. // quirk: PIPE-50
        let work = Box::into_raw(Box::new(ShutdownWork {
            handle: (*h).handle,
            iocp: (*lp).iocp(),
            overlapped: (*h).shutdown_req.overlapped_ptr(),
            sync: SyncIoState::new(),
        }));
        (*h).shutdown_work = work;
        (*h).shutdown_req.set_success(0);
        if QueueUserWorkItem(
            pipe_shutdown_thread_proc,
            work.cast::<c_void>(),
            WT_EXECUTELONGFUNCTION,
        ) == 0
        {
            (*h).shutdown_work = ptr::null_mut();
            drop(Box::from_raw(work));
            (*h).shutdown_req.set_error(Win32Error::get());
            (*lp).insert_pending(&raw mut (*h).shutdown_req);
        }
    }
}

/// Pool flush worker. The flush result is deliberately not consulted
/// (libuv parity; a dead peer already errored the write path) — the close
/// path overrides with OPERATION_ABORTED at process time. // quirk: PIPE-50
unsafe extern "system" fn pipe_shutdown_thread_proc(arg: *mut c_void) -> DWORD {
    // SAFETY: `arg` is the ShutdownWork leaked by start_shutdown; exclusive
    // to this worker (loop thread touches only `sync`) until the post.
    unsafe {
        let work = arg.cast::<ShutdownWork>();
        if let Ok(thread) = sync_io_enter(&(*work).sync) {
            FlushFileBuffers((*work).handle);
            sync_io_exit(&(*work).sync, thread);
        }
        let iocp = (*work).iocp;
        let overlapped = (*work).overlapped;
        PostQueuedCompletionStatus(iocp, 0, 0, overlapped);
    }
    0
}

pub(crate) fn process_pipe_shutdown_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<PipeHandle>();
    // SAFETY: handle pinned until reqs drain (endgame protocol).
    unsafe {
        (*h).shutdown_state = ShutdownState::Done;
        let work = mem::replace(&mut (*h).shutdown_work, ptr::null_mut());
        if !work.is_null() {
            drop(Box::from_raw(work));
        }
        (*h).core.req_completed();

        let err;
        if (*h).core.is_closing() {
            err = Win32Error::OPERATION_ABORTED; // close cancels the shutdown
        } else if !(*req_ptr).success() {
            err = (*req_ptr).error();
        } else {
            err = Win32Error::SUCCESS;
            if (*h).readable {
                // Keep the handle open for the peer's last data; the grace
                // timer force-closes if EOF never arrives. // quirk: PIPE-51
                (*h).eof_timer_active = true;
                if (*h).read_pending {
                    eof_timer_start(lp, h);
                }
            } else {
                // Write-only pipe: closing it IS the EOF signal.
                // // quirk: PIPE-51
                CloseHandle((*h).handle);
                (*h).handle = INVALID_HANDLE_VALUE;
            }
        }
        let cb = (*h).shutdown_cb.take();
        let data = (*h).shutdown_data;
        if let Some(cb) = cb {
            cb(&mut *lp, data, err);
        }
    }
}

// ───────────────────────── EOF grace timer ─────────────────────────

/// # Safety
/// `lp`/`h` valid and pinned.
unsafe fn eof_timer_start(lp: *mut Loop, h: *mut PipeHandle) {
    // SAFETY: fn contract; the timer slot lives inside the pinned handle.
    unsafe {
        (*lp).timer_start(
            &mut (*h).eof_timer,
            pipe_eof_timer_cb,
            h.cast::<c_void>(),
            EOF_TIMEOUT_MS,
            0,
        );
    }
}

/// The grace expired: force both ends off the pipe and report EOF — unless
/// the read completion is already sitting in the port's backlog.
/// // quirk: PIPE-51
unsafe fn pipe_eof_timer_cb(loop_: &mut Loop, data: *mut c_void) {
    let lp: *mut Loop = loop_;
    let h = data.cast::<PipeHandle>();
    // SAFETY: the timer is stopped at close and released in the endgame, so
    // `h` is live whenever this fires.
    unsafe {
        if (*h).core.is_closing() || !(*h).read_pending || (*h).handle == INVALID_HANDLE_VALUE {
            return;
        }
        // With a busy port the completion may be queued but not yet
        // dispatched — then do nothing; dispatch re-arms the timer.
        // // quirk: PIPE-51
        if (*h).read_req.completed_volatile() {
            return;
        }
        // Force both ends off the pipe; the parked read aborts and drains
        // silently (the abort arm above).
        CloseHandle((*h).handle);
        (*h).handle = INVALID_HANDLE_VALUE;
        (*h).eof_timer_active = false;
        let buf = (*h).inflight_buf;
        if (*h).reading {
            (*h).reading = false;
            (*h).core.stop();
            if let Some(cb) = (*h).read_cb {
                // BROKEN_PIPE is the raw read-side EOF shape. // quirk: PIPE-37
                cb(&mut *lp, (*h).read_data, buf, 0, Win32Error::BROKEN_PIPE);
            }
        } else {
            // Stopped reader: park the EOF for the next read_start (never a
            // callback while stopped). // quirk: PIPE-36
            (*h).stashed = Some((buf, 0, Win32Error::BROKEN_PIPE));
        }
    }
}

// ───────────────────────── accept machinery ─────────────────────────

/// (Re-)create slot `idx`'s instance if needed and post its overlapped
/// `ConnectNamedPipe`. Synchronous failures park the slot through the
/// pending funnel — delivered once, never silently busy-spun.
/// // quirk: PIPE-22, PIPE-58
///
/// # Safety
/// `lp`/`h` valid and pinned; the slot exists, is unarmed and unclaimed.
unsafe fn queue_accept(lp: *mut Loop, h: *mut PipeHandle, idx: usize) {
    // SAFETY: fn contract; slots are heap-pinned in their boxes and their
    // reqs stay alive until each completion drains.
    unsafe {
        let slot: *mut AcceptSlot = &raw mut *(&mut (*h).accepts)[idx];
        debug_assert!(!(*slot).armed && !(*slot).connected);
        if (*slot).pipe_handle == INVALID_HANDLE_VALUE {
            let name = (*h)
                .name
                .as_ref()
                .expect("queue_accept on unbound server")
                .as_ptr();
            // Later instances never pass FIRST_PIPE_INSTANCE. // quirk: PIPE-04
            let inst = CreateNamedPipeW(
                name,
                PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | WRITE_DAC,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                PIPE_BUFFER_SIZE,
                PIPE_BUFFER_SIZE,
                0,
                ptr::null_mut(),
            );
            if inst == INVALID_HANDLE_VALUE {
                park_accept(lp, h, slot, Win32Error::get());
                return;
            }
            match attach_iocp(lp, inst) {
                Ok(_) => {}
                Err(err) => {
                    CloseHandle(inst);
                    park_accept(lp, h, slot, err);
                    return;
                }
            }
            (*slot).pipe_handle = inst;
        }
        (*slot).req.prime_pending();
        (*slot).armed = true;
        // Parked accept IRPs do not hold the loop — LISTENING does.
        (*h).core.req_submitted_uncounted();
        let r = ConnectNamedPipe((*slot).pipe_handle, (*slot).req.overlapped_ptr());
        if r != 0 {
            // Effectively-synchronous success: with skip-on-success no
            // packet comes; funnel it. (Overlapped ConnectNamedPipe returns
            // 0 in practice — defensive.)
            (*slot).req.set_success(0);
            (*lp).insert_pending(&raw mut (*slot).req);
            return;
        }
        match Win32Error::get() {
            Win32Error::IO_PENDING => {}
            Win32Error::PIPE_CONNECTED => {
                // Client connected between create and connect: success.
                // // quirk: PIPE-07
                (*slot).req.set_success(0);
                (*lp).insert_pending(&raw mut (*slot).req);
            }
            err => {
                CloseHandle((*slot).pipe_handle);
                (*slot).pipe_handle = INVALID_HANDLE_VALUE;
                (*slot).req.set_error(err);
                (*lp).insert_pending(&raw mut (*slot).req); // quirk: PIPE-58
            }
        }
    }
}

/// Park a slot whose synchronous (re-)arm failed: one error delivery, no
/// retry spin (deviation from libuv's silent infinite re-arm — a persistent
/// CreateNamedPipe failure there busy-loops the loop thread).
///
/// # Safety
/// `lp`/`h`/`slot` valid and pinned; slot unarmed.
unsafe fn park_accept(lp: *mut Loop, h: *mut PipeHandle, slot: *mut AcceptSlot, err: Win32Error) {
    // SAFETY: fn contract; the slot req travels the pending queue once.
    unsafe {
        (*slot).parked = true;
        (*slot).req.set_error(err);
        (*h).core.req_submitted_uncounted();
        (*lp).insert_pending(&raw mut (*slot).req);
    }
}

pub(crate) fn process_pipe_accept_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<PipeHandle>();
    // SAFETY: handle and slots pinned until reqs drain (endgame protocol).
    unsafe {
        let slot = req_ptr.cast::<AcceptSlot>();
        (*slot).armed = false;
        (*h).core.req_completed_uncounted();

        if (*h).core.is_closing() {
            // close() already closed and INVALIDed every instance; this
            // drain only balances the count — free exactly once.
            // // quirk: PIPE-24
            return;
        }
        if (*slot).parked {
            (*slot).parked = false;
            let err = (*req_ptr).error();
            if let Some(cb) = (*h).connection_cb {
                cb(&mut *lp, (*h).connection_data, err);
            }
            return; // slot stays inert
        }
        if (*req_ptr).success() {
            (*slot).connected = true;
            (*h).pending_accepts += 1;
            if let Some(cb) = (*h).connection_cb {
                cb(&mut *lp, (*h).connection_data, Win32Error::SUCCESS);
            }
        } else {
            // Errored/aborted instance: discard it and re-arm once (libuv
            // parity); a sync re-arm failure parks via the funnel above.
            let idx = (*slot).idx;
            if (*slot).pipe_handle != INVALID_HANDLE_VALUE {
                CloseHandle((*slot).pipe_handle);
                (*slot).pipe_handle = INVALID_HANDLE_VALUE;
            }
            queue_accept(lp, h, idx);
        }
    }
}

// ───────────────────────── connect machinery ─────────────────────────

/// Busy-retry worker: wait for a listening instance, reopen, and on losing
/// the inherent reopen race yield and wait again. Writes ONLY to its
/// `ConnectReq`. // quirk: PIPE-27, PIPE-28
unsafe extern "system" fn pipe_connect_thread_proc(arg: *mut c_void) -> DWORD {
    // SAFETY: `arg` is the ConnectReq leaked by connect(); the worker owns
    // it exclusively until the post.
    unsafe {
        let cr = arg.cast::<ConnectReq>();
        let mut handle = INVALID_HANDLE_VALUE;
        while WaitNamedPipeW((*cr).wait_name.as_ptr(), PIPE_BUSY_WAIT_MS) != 0 {
            match open_named_pipe((*cr).name.as_ptr()) {
                Ok((ph, readable, writable)) => {
                    handle = ph;
                    (*cr).readable = readable;
                    (*cr).writable = writable;
                    break;
                }
                // Another client won the instance; wait for the next one.
                Err(_) => {
                    SwitchToThread();
                }
            }
        }
        if handle != INVALID_HANDLE_VALUE {
            (*cr).pipe_handle = handle;
            (*cr).req.set_success(0);
        } else {
            // WaitNamedPipeW's own failure/timeout is the reported error.
            (*cr).req.set_error(Win32Error::get());
        }
        let iocp = (*cr).iocp;
        let overlapped = (*cr).req.overlapped_ptr();
        PostQueuedCompletionStatus(iocp, 0, 0, overlapped);
    }
    0
}

pub(crate) fn process_pipe_connect_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<PipeHandle>();
    // SAFETY: handle pinned until reqs drain; the ConnectReq is exclusively
    // loop-owned again once its completion is dispatched.
    unsafe {
        let cr = req_ptr.cast::<ConnectReq>();
        (*h).connect_pending = false;
        (*h).core.req_completed();
        let cb = (*cr).cb;
        let data = (*cr).data;
        let mut err = if (*req_ptr).success() {
            Win32Error::SUCCESS
        } else {
            (*req_ptr).error()
        };
        if (*h).core.is_closing() {
            // Close raced the connect: release the fresh pipe and report
            // cancellation. // quirk: PIPE-28
            if (*cr).pipe_handle != INVALID_HANDLE_VALUE {
                CloseHandle((*cr).pipe_handle);
            }
            err = Win32Error::OPERATION_ABORTED;
        } else if err == Win32Error::SUCCESS {
            // Handle setup is deferred to the loop thread. // quirk: PIPE-28
            match finish_connect(lp, h, cr) {
                Ok(()) => {}
                Err(e) => {
                    CloseHandle((*cr).pipe_handle);
                    err = e;
                }
            }
        }
        drop(Box::from_raw(cr));
        if let Some(cb) = cb {
            cb(&mut *lp, data, err);
        }
    }
}

/// Loop-thread half of a successful connect: force byte mode, attach, adopt.
///
/// # Safety
/// `lp`/`h`/`cr` valid; `cr.pipe_handle` is a fresh connected pipe.
unsafe fn finish_connect(
    lp: *mut Loop,
    h: *mut PipeHandle,
    cr: *mut ConnectReq,
) -> Result<(), Win32Error> {
    // SAFETY: fn contract.
    unsafe {
        let ph = (*cr).pipe_handle;
        set_pipe_mode_byte(ph)?; // quirk: PIPE-10
        let overlapped = probe_overlapped(ph)?;
        // We opened it with FILE_FLAG_OVERLAPPED ourselves. // quirk: PIPE-13
        debug_assert!(overlapped);
        let bypass = attach_iocp(lp, ph)?; // quirk: PIPE-14, PIPE-18
        (*h).handle = ph;
        (*h).overlapped_io = overlapped;
        (*h).sync_bypass = bypass;
        (*h).readable = (*cr).readable;
        (*h).writable = (*cr).writable;
        Ok(())
    }
}

// ───────────────────────── endgame ─────────────────────────

/// All requests drained: release loop-side resources and fire the close
/// callback; the owner frees the box afterwards. // quirk: PIPE-54, LOOP-25
unsafe fn pipe_endgame(core: *mut HandleCore) {
    // SAFETY: the endgame drain passes the live, queued handle; `core` is
    // the first field of the #[repr(C)] PipeHandle.
    unsafe {
        let h = core.cast::<PipeHandle>();
        debug_assert!((*h).handle == INVALID_HANDLE_VALUE);
        debug_assert!((*h).write_head.is_null() && (*h).write_inflight.is_null());
        debug_assert!((*h).read_work.is_null() && (*h).shutdown_work.is_null());
        debug_assert!(!(*h).read_pending);
        let lp = (*h).core.loop_;
        (*lp).timer_release(&mut (*h).eof_timer);
        (*h).accepts.clear();
        (*h).name = None;
        let data = (*h).close_data;
        if let Some(cb) = (*h).close_cb.take() {
            cb(&mut *lp, data);
        }
    }
}

#[cfg(test)]
mod tests {
    use bun_windows_sys::{CreatePipe, DisconnectNamedPipe};

    use super::*;
    use crate::test_sync::serial;

    /// Shared recording context. Callbacks only RECORD (plus the scripted
    /// in-callback actions); every behavioral assertion runs after teardown
    /// so a failing assertion never panics across a live loop.
    struct Ctx {
        order: Vec<&'static str>,
        reads: Vec<u8>,
        read_errs: Vec<Win32Error>,
        read_fires: u32,
        writes: Vec<(usize, Win32Error)>,
        connects: Vec<Win32Error>,
        connections: Vec<Win32Error>,
        shutdowns: Vec<Win32Error>,
        closed: u32,
        handle: *mut PipeHandle,
        /// burst test: rolling pattern verification.
        pattern_pos: usize,
        pattern_ok: bool,
        /// shutdown test: read_stop once this many bytes accumulated (0 =
        /// never stop).
        stop_after: usize,
        /// close test: close the handle from inside the first read cb.
        close_in_read: bool,
    }

    impl Ctx {
        fn new() -> Ctx {
            Ctx {
                order: Vec::new(),
                reads: Vec::new(),
                read_errs: Vec::new(),
                read_fires: 0,
                writes: Vec::new(),
                connects: Vec::new(),
                connections: Vec::new(),
                shutdowns: Vec::new(),
                closed: 0,
                handle: ptr::null_mut(),
                pattern_pos: 0,
                pattern_ok: true,
                stop_after: 0,
                close_in_read: false,
            }
        }
    }

    unsafe fn on_close(_l: &mut Loop, d: *mut c_void) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.closed += 1;
            ctx.order.push("close");
        }
    }

    unsafe fn on_read(_l: &mut Loop, d: *mut c_void, buf: *mut u8, n: usize, err: Win32Error) {
        // SAFETY: `d` is the test Ctx; `buf[..n]` is the delivery the crate
        // just handed us; `handle` is the live boxed pipe when scripted.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.read_fires += 1;
            ctx.order.push("read");
            ctx.read_errs.push(err);
            if err == Win32Error::SUCCESS && n > 0 {
                ctx.reads
                    .extend_from_slice(core::slice::from_raw_parts(buf, n));
            }
            if ctx.close_in_read && ctx.read_fires == 1 {
                (*ctx.handle).close(Some(on_close), d);
            }
            if ctx.stop_after != 0 && ctx.reads.len() >= ctx.stop_after {
                ctx.stop_after = 0;
                (*ctx.handle).read_stop();
            }
        }
    }

    /// Burst-mode read cb: verifies the rolling byte pattern without
    /// storing 64 MiB.
    unsafe fn on_read_pattern(
        _l: &mut Loop,
        d: *mut c_void,
        buf: *mut u8,
        n: usize,
        err: Win32Error,
    ) {
        // SAFETY: `d` is the test Ctx; `buf[..n]` is the crate's delivery.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.read_fires += 1;
            ctx.read_errs.push(err);
            if err != Win32Error::SUCCESS {
                return;
            }
            let bytes = core::slice::from_raw_parts(buf, n);
            for &b in bytes {
                if b != (ctx.pattern_pos % 251) as u8 {
                    ctx.pattern_ok = false;
                }
                ctx.pattern_pos += 1;
            }
        }
    }

    unsafe fn on_write(_l: &mut Loop, d: *mut c_void, bytes: usize, err: Win32Error) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.order.push("write");
            ctx.writes.push((bytes, err));
        }
    }

    unsafe fn on_connect(_l: &mut Loop, d: *mut c_void, err: Win32Error) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.connects.push(err);
        }
    }

    unsafe fn on_connection(_l: &mut Loop, d: *mut c_void, err: Win32Error) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.connections.push(err);
        }
    }

    unsafe fn on_shutdown(_l: &mut Loop, d: *mut c_void, err: Win32Error) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.order.push("shutdown");
            ctx.shutdowns.push(err);
        }
    }

    fn unique_name(tag: &str) -> Vec<u16> {
        let mut rand: u64 = 0;
        // SAFETY: writes 8 bytes into a valid local.
        let _ = unsafe { RtlGenRandom((&raw mut rand).cast::<c_void>(), 8) };
        format!(
            r"\\?\pipe\LOCAL\bun-test-{tag}-{:08x}-{rand:016x}",
            GetCurrentProcessId()
        )
        .encode_utf16()
        .collect()
    }

    /// 1. Pair + echo round trip: write several patterns in BOTH directions
    /// (zero-copy single buffers, a coalesced vectored write, a zero-length
    /// write, and a larger-than-pipe-buffer chunk), read back exact bytes.
    /// // quirk: PIPE-01, PIPE-04, PIPE-05, PIPE-07, PIPE-15, PIPE-18,
    /// PIPE-42, PIPE-44
    #[test]
    fn pair_echo_round_trip() {
        let _guard = serial();
        let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and handles outlive the PipeHandles.
        let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
        let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
        let dir_ok = server.is_readable()
            && server.is_writable()
            && client.is_readable()
            && client.is_writable(); // quirk: PIPE-15

        let mut sctx = Ctx::new();
        let mut cctx = Ctx::new();
        let mut sbuf = vec![0u8; 64 * 1024];
        let mut cbuf = vec![0u8; 64 * 1024];
        let sd: *mut c_void = (&raw mut sctx).cast();
        let cd: *mut c_void = (&raw mut cctx).cast();
        // SAFETY: buffers and ctxs outlive the handles' close callbacks.
        unsafe {
            server
                .read_start(sbuf.as_mut_ptr(), sbuf.len(), on_read, sd)
                .unwrap();
            client
                .read_start(cbuf.as_mut_ptr(), cbuf.len(), on_read, cd)
                .unwrap();
        }

        // client → server: plain, vectored (coalesced), empty, big.
        let big: Vec<u8> = (0..200_000usize).map(|i| (i % 251) as u8).collect();
        let mut expect_s: Vec<u8> = Vec::new();
        expect_s.extend_from_slice(b"hello");
        expect_s.extend_from_slice(b"vec-a");
        expect_s.extend_from_slice(b"vec-b");
        expect_s.extend_from_slice(&big);
        let expect_c: Vec<u8> = b"pong".to_vec();
        // SAFETY: single-buffer sources (`big`) stay alive until their write
        // callbacks; vectored writes are copied at call time.
        unsafe {
            client.write(&[b"hello"], Some(on_write), cd).unwrap();
            client
                .write(&[b"vec-a", b"vec-b"], Some(on_write), cd)
                .unwrap(); // quirk: PIPE-42
            client.write(&[], Some(on_write), cd).unwrap(); // quirk: PIPE-44
            client.write(&[&big], Some(on_write), cd).unwrap();
            server.write(&[b"pong"], Some(on_write), sd).unwrap();
        }

        let deadline = loop_.now_ms() + 10_000;
        while (sctx.reads.len() < expect_s.len()
            || cctx.reads.len() < expect_c.len()
            || cctx.writes.len() < 4
            || sctx.writes.is_empty())
            && loop_.now_ms() < deadline
        {
            loop_.tick(Some(50));
        }

        let queue_after = client.write_queue_size();
        client.close(Some(on_close), cd);
        server.close(Some(on_close), sd);
        let deadline = loop_.now_ms() + 5_000;
        while (cctx.closed == 0 || sctx.closed == 0) && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        let alive_after = loop_.alive();
        drop(client);
        drop(server);
        drop(loop_);

        assert!(dir_ok, "pair ends must derive duplex from access mask");
        assert_eq!(sctx.reads, expect_s, "client→server bytes");
        assert_eq!(cctx.reads, expect_c, "server→client bytes");
        assert_eq!(
            cctx.writes,
            vec![
                (5, Win32Error::SUCCESS),
                (10, Win32Error::SUCCESS),
                (0, Win32Error::SUCCESS),
                (big.len(), Win32Error::SUCCESS),
            ],
            "client write completions in order with exact byte counts"
        );
        assert_eq!(sctx.writes, vec![(4, Win32Error::SUCCESS)]);
        assert_eq!(queue_after, 0, "write_queue_size returns to 0");
        assert_eq!(cctx.closed, 1);
        assert_eq!(sctx.closed, 1);
        assert!(!alive_after);
    }

    /// 2. Burst correctness under queue pressure: 64 MiB through a pair in
    /// 256 KiB chunks, all queued upfront — no loss, no reorder, every
    /// completion accounted. (Correctness under load, NOT a benchmark.)
    /// // quirk: ADD-03, PIPE-39, PIPE-44
    #[test]
    fn burst_64mib_no_loss_or_reorder() {
        let _guard = serial();
        const TOTAL: usize = 64 * 1024 * 1024;
        const CHUNK: usize = 256 * 1024;
        let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and handles outlive the PipeHandles.
        let mut reader = unsafe { PipeHandle::open(lp, sh).unwrap() };
        let mut writer = unsafe { PipeHandle::open(lp, ch).unwrap() };

        let src: Vec<u8> = (0..TOTAL).map(|i| (i % 251) as u8).collect();
        let mut rctx = Ctx::new();
        let mut wctx = Ctx::new();
        let mut rbuf = vec![0u8; 256 * 1024];
        let rd: *mut c_void = (&raw mut rctx).cast();
        let wd: *mut c_void = (&raw mut wctx).cast();
        // SAFETY: buffers/ctxs/src outlive the close callbacks.
        unsafe {
            reader
                .read_start(rbuf.as_mut_ptr(), rbuf.len(), on_read_pattern, rd)
                .unwrap();
            for chunk in src.chunks(CHUNK) {
                writer.write(&[chunk], Some(on_write), wd).unwrap();
            }
        }
        let queued_at_start = writer.write_queue_size();

        let deadline = loop_.now_ms() + 60_000;
        while (rctx.pattern_pos < TOTAL || wctx.writes.len() < TOTAL / CHUNK)
            && loop_.now_ms() < deadline
        {
            loop_.tick(Some(50));
        }

        let queue_after = writer.write_queue_size();
        writer.close(Some(on_close), wd);
        reader.close(Some(on_close), rd);
        let deadline = loop_.now_ms() + 5_000;
        while (wctx.closed == 0 || rctx.closed == 0) && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        let alive_after = loop_.alive();
        drop(writer);
        drop(reader);
        drop(loop_);

        assert_eq!(queued_at_start, TOTAL, "all chunks queued upfront");
        assert_eq!(rctx.pattern_pos, TOTAL, "every byte arrived");
        assert!(rctx.pattern_ok, "bytes arrived in submission order");
        assert_eq!(wctx.writes.len(), TOTAL / CHUNK);
        assert!(
            wctx.writes
                .iter()
                .all(|&(n, e)| n == CHUNK && e == Win32Error::SUCCESS),
            "every chunk completed fully: {:?}",
            wctx.writes.iter().take(4).collect::<Vec<_>>()
        );
        assert_eq!(queue_after, 0);
        assert!(!alive_after);
    }

    /// 3. EOF vs error classification + read_stop semantics: peer close →
    /// BROKEN_PIPE exactly once; DisconnectNamedPipe → PIPE_NOT_CONNECTED
    /// exactly once; no callback after read_stop, with the parked completion
    /// delivered by the next read_start. // quirk: PIPE-32, PIPE-36, PIPE-37,
    /// PIPE-38
    #[test]
    fn eof_error_classification_and_read_stop() {
        let _guard = serial();

        // (a) graceful peer close → data, then EOF shape once.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut cctx = Ctx::new();
            let mut sctx = Ctx::new();
            let mut buf = vec![0u8; 4096];
            let cd: *mut c_void = (&raw mut cctx).cast();
            let sd: *mut c_void = (&raw mut sctx).cast();
            // SAFETY: buffers/ctxs outlive the close callbacks.
            unsafe {
                client
                    .read_start(buf.as_mut_ptr(), buf.len(), on_read, cd)
                    .unwrap();
                server.write(&[b"bye"], Some(on_write), sd).unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while sctx.writes.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while cctx.read_errs.iter().all(|&e| e == Win32Error::SUCCESS)
                && loop_.now_ms() < deadline
            {
                loop_.tick(Some(50));
            }
            // Bounded quiet window: EOF must not double-fire.
            for _ in 0..10 {
                loop_.tick(Some(20));
            }
            let errs_after_first_eof = cctx.read_errs.clone();
            // EOF does not poison the flags: reading again re-observes it.
            // // quirk: PIPE-38
            // SAFETY: buffer/ctx still valid.
            unsafe {
                client
                    .read_start(buf.as_mut_ptr(), buf.len(), on_read, cd)
                    .unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while cctx.read_errs.len() < errs_after_first_eof.len() + 1 && loop_.now_ms() < deadline
            {
                loop_.tick(Some(50));
            }
            client.close(Some(on_close), cd);
            let deadline = loop_.now_ms() + 5_000;
            while (cctx.closed == 0 || sctx.closed == 0) && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(client);
            drop(server);
            drop(loop_);
            assert_eq!(cctx.reads, b"bye");
            assert_eq!(
                errs_after_first_eof
                    .iter()
                    .filter(|&&e| e == Win32Error::BROKEN_PIPE)
                    .count(),
                1,
                "EOF (BROKEN_PIPE) delivered exactly once: {errs_after_first_eof:?}"
            );
            assert_eq!(
                *errs_after_first_eof.last().unwrap(),
                Win32Error::BROKEN_PIPE
            );
            assert_eq!(
                *cctx.read_errs.last().unwrap(),
                Win32Error::BROKEN_PIPE,
                "re-reading after EOF re-observes EOF (flags not poisoned)"
            );
            assert!(!alive_after);
        }

        // (b) server-side DisconnectNamedPipe → error shape once.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handle outlive the PipeHandle; `sh` stays raw.
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut cctx = Ctx::new();
            let mut buf = vec![0u8; 4096];
            let cd: *mut c_void = (&raw mut cctx).cast();
            // SAFETY: buffer/ctx outlive the close callback.
            unsafe {
                client
                    .read_start(buf.as_mut_ptr(), buf.len(), on_read, cd)
                    .unwrap();
            }
            loop_.tick(Some(50)); // let the read park
            // SAFETY: `sh` is the raw server end owned by the test.
            let ok = unsafe { DisconnectNamedPipe(sh) };
            assert_ne!(ok, 0);
            let deadline = loop_.now_ms() + 5_000;
            while cctx.read_errs.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            for _ in 0..10 {
                loop_.tick(Some(20));
            }
            client.close(Some(on_close), cd);
            let deadline = loop_.now_ms() + 5_000;
            while cctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            drop(client);
            drop(loop_);
            // SAFETY: the test owns `sh`.
            unsafe { CloseHandle(sh) };
            assert_eq!(
                cctx.read_errs,
                vec![Win32Error::PIPE_NOT_CONNECTED],
                "disconnect classified once, as the raw disconnect error"
            );
            assert_eq!(cctx.closed, 1);
        }

        // (c) read_stop: no callback while stopped; the parked completion is
        // delivered by the next read_start.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut cctx = Ctx::new();
            let mut sctx = Ctx::new();
            let mut buf = vec![0u8; 4096];
            let cd: *mut c_void = (&raw mut cctx).cast();
            let sd: *mut c_void = (&raw mut sctx).cast();
            // SAFETY: buffers/ctxs outlive the close callbacks.
            unsafe {
                client
                    .read_start(buf.as_mut_ptr(), buf.len(), on_read, cd)
                    .unwrap();
                server.write(&[b"one"], Some(on_write), sd).unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while cctx.read_fires < 1 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            client.read_stop();
            // SAFETY: source outlives the write callback.
            unsafe { server.write(&[b"two"], Some(on_write), sd).unwrap() };
            // Bounded window: the parked completion must NOT surface.
            for _ in 0..10 {
                loop_.tick(Some(20));
            }
            let fires_while_stopped = cctx.read_fires;
            // SAFETY: buffer/ctx still valid.
            unsafe {
                client
                    .read_start(buf.as_mut_ptr(), buf.len(), on_read, cd)
                    .unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while cctx.reads.len() < 6 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            client.close(Some(on_close), cd);
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while (cctx.closed == 0 || sctx.closed == 0) && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(client);
            drop(server);
            drop(loop_);
            assert_eq!(fires_while_stopped, 1, "no callback after read_stop");
            assert_eq!(cctx.reads, b"onetwo", "parked bytes delivered on restart");
            assert!(!alive_after);
        }
    }

    /// 4. Write queue FIFO + completion accounting; the error path on a
    /// broken peer; close completes every queued write with an error.
    /// // quirk: ADD-03, PIPE-37, PIPE-58
    #[test]
    fn write_queue_fifo_broken_peer_and_close_aborts() {
        let _guard = serial();

        // (a) FIFO + exact accounting under queue pressure.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut sctx = Ctx::new();
            let mut cctx = Ctx::new();
            let mut rbuf = vec![0u8; 64 * 1024];
            let sd: *mut c_void = (&raw mut sctx).cast();
            let cd: *mut c_void = (&raw mut cctx).cast();
            // Eight distinct-length blocks; total ≫ pipe buffer.
            let blocks: Vec<Vec<u8>> = (0..8usize).map(|i| vec![i as u8; 32 * 1024 + i]).collect();
            let expect: Vec<u8> = blocks.concat();
            // SAFETY: buffers/ctxs/blocks outlive the close callbacks.
            unsafe {
                server
                    .read_start(rbuf.as_mut_ptr(), rbuf.len(), on_read, sd)
                    .unwrap();
                for b in &blocks {
                    client.write(&[b], Some(on_write), cd).unwrap();
                }
            }
            let deadline = loop_.now_ms() + 10_000;
            while (sctx.reads.len() < expect.len() || cctx.writes.len() < blocks.len())
                && loop_.now_ms() < deadline
            {
                loop_.tick(Some(50));
            }
            client.close(Some(on_close), cd);
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while (cctx.closed == 0 || sctx.closed == 0) && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            drop(client);
            drop(server);
            drop(loop_);
            assert_eq!(sctx.reads, expect, "blocks arrive in submission order");
            let lens: Vec<usize> = cctx.writes.iter().map(|&(n, _)| n).collect();
            assert_eq!(
                lens,
                (0..8usize).map(|i| 32 * 1024 + i).collect::<Vec<_>>(),
                "write callbacks fire in FIFO order with full byte counts"
            );
            assert!(cctx.writes.iter().all(|&(_, e)| e == Win32Error::SUCCESS));
        }

        // (b) broken peer: the reading end goes away → write cb gets the raw
        // EPIPE-family code.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handle outlive the PipeHandle; `sh` stays raw.
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut cctx = Ctx::new();
            let cd: *mut c_void = (&raw mut cctx).cast();
            // SAFETY: the test owns `sh`.
            unsafe { CloseHandle(sh) };
            // SAFETY: literal outlives the write callback.
            unsafe { client.write(&[b"doomed"], Some(on_write), cd).unwrap() };
            let deadline = loop_.now_ms() + 5_000;
            while cctx.writes.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            client.close(Some(on_close), cd);
            let deadline = loop_.now_ms() + 5_000;
            while cctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            drop(client);
            drop(loop_);
            assert_eq!(cctx.writes.len(), 1);
            let (n, err) = cctx.writes[0];
            assert_eq!(n, 0);
            assert!(
                err == Win32Error::NO_DATA || err == Win32Error::BROKEN_PIPE,
                "write to broken peer must classify as the raw EPIPE family, got {err:?}"
            ); // quirk: PIPE-37
        }

        // (c) close with one write in flight and three queued: every
        // callback fires with an error; close cb last; loop quiesces.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut cctx = Ctx::new();
            let mut sctx = Ctx::new();
            let cd: *mut c_void = (&raw mut cctx).cast();
            let sd: *mut c_void = (&raw mut sctx).cast();
            // Nobody reads: 100 KiB > pipe buffer, so the head write parks
            // in the kernel and the rest queue in the crate.
            let chunk = vec![0xABu8; 100 * 1024];
            // SAFETY: chunk outlives the close drain.
            unsafe {
                for _ in 0..4 {
                    client.write(&[&chunk], Some(on_write), cd).unwrap();
                }
            }
            loop_.tick(Some(20));
            let fired_before_close = cctx.writes.len();
            client.close(Some(on_close), cd);
            let deadline = loop_.now_ms() + 5_000;
            while cctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while sctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(client);
            drop(server);
            drop(loop_);
            assert_eq!(fired_before_close, 0, "writes must be parked at close");
            assert_eq!(
                cctx.writes.len(),
                4,
                "every queued write completes-with-error on close"
            );
            assert!(cctx.writes.iter().all(|&(_, e)| e != Win32Error::SUCCESS));
            assert_eq!(
                *cctx.order.last().unwrap(),
                "close",
                "close cb strictly after the failed write cbs: {:?}",
                cctx.order
            );
            assert_eq!(cctx.closed, 1);
            assert!(!alive_after);
        }
    }

    /// 5. Close protocol: in-flight read + queued writes all drain, close cb
    /// last, loop not alive after; close from inside the read callback.
    /// // quirk: PIPE-54, PIPE-24, LOOP-25, LOOP-27
    #[test]
    fn close_protocol_drains_everything() {
        let _guard = serial();

        // (a) in-flight read AND queued writes at close.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut cctx = Ctx::new();
            let mut sctx = Ctx::new();
            let mut buf = vec![0u8; 4096];
            let cd: *mut c_void = (&raw mut cctx).cast();
            let sd: *mut c_void = (&raw mut sctx).cast();
            let chunk = vec![0x42u8; 100 * 1024];
            // SAFETY: buffers/ctxs outlive the close drain.
            unsafe {
                client
                    .read_start(buf.as_mut_ptr(), buf.len(), on_read, cd)
                    .unwrap();
                for _ in 0..3 {
                    client.write(&[&chunk], Some(on_write), cd).unwrap();
                }
            }
            loop_.tick(Some(20));
            let reqs_at_close = client.core.reqs_pending();
            client.close(Some(on_close), cd);
            let closed_synchronously = cctx.closed != 0;
            let alive_while_closing = loop_.alive();
            let deadline = loop_.now_ms() + 5_000;
            while cctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while sctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(client);
            drop(server);
            drop(loop_);
            assert!(reqs_at_close >= 4, "read + 3 writes in flight at close");
            assert!(!closed_synchronously, "close must be asynchronous");
            assert!(alive_while_closing, "closing handle holds the loop");
            assert_eq!(cctx.writes.len(), 3, "every write settled");
            assert!(cctx.writes.iter().all(|&(_, e)| e != Win32Error::SUCCESS));
            assert_eq!(cctx.read_fires, 0, "no read cb after close");
            assert_eq!(*cctx.order.last().unwrap(), "close");
            assert!(!alive_after);
        }

        // (b) close from inside the read callback.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut cctx = Ctx::new();
            let mut sctx = Ctx::new();
            cctx.close_in_read = true;
            cctx.handle = &raw mut *client;
            let mut buf = vec![0u8; 4096];
            let cd: *mut c_void = (&raw mut cctx).cast();
            let sd: *mut c_void = (&raw mut sctx).cast();
            // SAFETY: buffers/ctxs outlive the close drain.
            unsafe {
                client
                    .read_start(buf.as_mut_ptr(), buf.len(), on_read, cd)
                    .unwrap();
                server.write(&[b"x"], Some(on_write), sd).unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while cctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while sctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(client);
            drop(server);
            drop(loop_);
            assert_eq!(cctx.read_fires, 1, "exactly the fire that closed");
            assert_eq!(cctx.reads, b"x");
            assert_eq!(cctx.closed, 1, "close-from-callback completes");
            assert!(!alive_after);
        }
    }

    /// 6. Server: bind + listen + accept for two sequential clients, the
    /// accept queue under simultaneous connects, and the PIPE_BUSY retry
    /// worker when the instance pool is exhausted.
    /// // quirk: PIPE-22, PIPE-23, PIPE-25, PIPE-27, PIPE-29
    #[test]
    fn listen_accept_and_busy_retry() {
        let _guard = serial();

        // (a)+(b) pool of 4: two sequential clients, then two simultaneous.
        {
            let name = unique_name("accept");
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives every handle below.
            let mut server = unsafe { PipeHandle::new(lp) };
            let mut sctx = Ctx::new();
            let sd: *mut c_void = (&raw mut sctx).cast();
            server.bind(&name).unwrap();
            // SAFETY: ctx outlives the server.
            unsafe { server.listen(4, on_connection, sd).unwrap() };

            // Sequential client 1, with data through the accepted side.
            let mut c1 = unsafe { PipeHandle::new(lp) };
            let mut c1ctx = Ctx::new();
            let c1d: *mut c_void = (&raw mut c1ctx).cast();
            // SAFETY: ctx outlives the client.
            unsafe { c1.connect(&name, Some(on_connect), c1d).unwrap() };
            let deadline = loop_.now_ms() + 5_000;
            while (c1ctx.connects.is_empty() || sctx.connections.is_empty())
                && loop_.now_ms() < deadline
            {
                loop_.tick(Some(50));
            }
            let mut conn1 = server.accept().unwrap();
            let mut conn1ctx = Ctx::new();
            let conn1d: *mut c_void = (&raw mut conn1ctx).cast();
            let mut conn1buf = vec![0u8; 4096];
            // SAFETY: buffers/ctxs outlive the close drains.
            unsafe {
                conn1
                    .read_start(conn1buf.as_mut_ptr(), conn1buf.len(), on_read, conn1d)
                    .unwrap();
                c1.write(&[b"first"], Some(on_write), c1d).unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while conn1ctx.reads.len() < 5 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }

            // Sequential client 2.
            let mut c2 = unsafe { PipeHandle::new(lp) };
            let mut c2ctx = Ctx::new();
            let c2d: *mut c_void = (&raw mut c2ctx).cast();
            // SAFETY: ctx outlives the client.
            unsafe { c2.connect(&name, Some(on_connect), c2d).unwrap() };
            let deadline = loop_.now_ms() + 5_000;
            while sctx.connections.len() < 2 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let mut conn2 = server.accept().unwrap();

            // Two simultaneous connects queue in the accept pool.
            let mut c3 = unsafe { PipeHandle::new(lp) };
            let mut c4 = unsafe { PipeHandle::new(lp) };
            let mut c3ctx = Ctx::new();
            let mut c4ctx = Ctx::new();
            let c3d: *mut c_void = (&raw mut c3ctx).cast();
            let c4d: *mut c_void = (&raw mut c4ctx).cast();
            // SAFETY: ctxs outlive the clients.
            unsafe {
                c3.connect(&name, Some(on_connect), c3d).unwrap();
                c4.connect(&name, Some(on_connect), c4d).unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while sctx.connections.len() < 4 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let queued = server.pending_accepts();
            let mut conn3 = server.accept().unwrap();
            let mut conn4 = server.accept().unwrap();
            let drained = server.pending_accepts();
            let empty = server.accept().err();

            let mut cl = [
                Ctx::new(),
                Ctx::new(),
                Ctx::new(),
                Ctx::new(),
                Ctx::new(),
                Ctx::new(),
                Ctx::new(),
                Ctx::new(),
                Ctx::new(),
            ];
            conn1.close(Some(on_close), (&raw mut cl[0]).cast());
            conn2.close(Some(on_close), (&raw mut cl[1]).cast());
            conn3.close(Some(on_close), (&raw mut cl[2]).cast());
            conn4.close(Some(on_close), (&raw mut cl[3]).cast());
            c1.close(Some(on_close), (&raw mut cl[4]).cast());
            c2.close(Some(on_close), (&raw mut cl[5]).cast());
            c3.close(Some(on_close), (&raw mut cl[6]).cast());
            c4.close(Some(on_close), (&raw mut cl[7]).cast());
            server.close(Some(on_close), (&raw mut cl[8]).cast());
            let deadline = loop_.now_ms() + 10_000;
            while cl.iter().any(|c| c.closed == 0) && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let all_closed = cl.iter().all(|c| c.closed == 1);
            let alive_after = loop_.alive();
            drop(conn1);
            drop(conn2);
            drop(conn3);
            drop(conn4);
            drop(c1);
            drop(c2);
            drop(c3);
            drop(c4);
            drop(server);
            drop(loop_);

            assert_eq!(c1ctx.connects, vec![Win32Error::SUCCESS]);
            assert_eq!(c2ctx.connects, vec![Win32Error::SUCCESS]);
            assert_eq!(c3ctx.connects, vec![Win32Error::SUCCESS]);
            assert_eq!(c4ctx.connects, vec![Win32Error::SUCCESS]);
            assert_eq!(sctx.connections, vec![Win32Error::SUCCESS; 4]);
            assert_eq!(conn1ctx.reads, b"first", "accepted connection carries data");
            assert_eq!(queued, 2, "simultaneous connects queue until accept");
            assert_eq!(drained, 0);
            assert_eq!(empty, Some(Win32Error::WSAEWOULDBLOCK));
            assert!(all_closed);
            assert!(!alive_after);
        }

        // (c) instance pool of 1: the second client hits PIPE_BUSY and the
        // retry worker converges once accept() re-arms a fresh instance.
        {
            let name = unique_name("busy");
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives every handle below.
            let mut server = unsafe { PipeHandle::new(lp) };
            let mut sctx = Ctx::new();
            let sd: *mut c_void = (&raw mut sctx).cast();
            server.bind(&name).unwrap();
            // SAFETY: ctx outlives the server.
            unsafe { server.listen(1, on_connection, sd).unwrap() };

            let mut a = unsafe { PipeHandle::new(lp) };
            let mut actx = Ctx::new();
            let ad: *mut c_void = (&raw mut actx).cast();
            // SAFETY: ctx outlives the client.
            unsafe { a.connect(&name, Some(on_connect), ad).unwrap() };
            let deadline = loop_.now_ms() + 5_000;
            while actx.connects.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }

            // No free instance now: B must take the busy-retry path.
            let mut b = unsafe { PipeHandle::new(lp) };
            let mut bctx = Ctx::new();
            let bd: *mut c_void = (&raw mut bctx).cast();
            // SAFETY: ctx outlives the client.
            unsafe { b.connect(&name, Some(on_connect), bd).unwrap() };
            for _ in 0..10 {
                loop_.tick(Some(20));
            }
            let b_connected_early = !bctx.connects.is_empty();

            // accept() re-arms a fresh instance; the retry worker converges.
            let mut conn_a = server.accept().unwrap();
            let deadline = loop_.now_ms() + 35_000;
            while bctx.connects.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let b_after = bctx.connects.clone();
            let mut conn_b = if server.pending_accepts() > 0 {
                server.accept().ok()
            } else {
                None
            };

            let mut cl = [Ctx::new(), Ctx::new(), Ctx::new(), Ctx::new(), Ctx::new()];
            a.close(Some(on_close), (&raw mut cl[0]).cast());
            b.close(Some(on_close), (&raw mut cl[1]).cast());
            conn_a.close(Some(on_close), (&raw mut cl[2]).cast());
            if let Some(h) = conn_b.as_mut() {
                h.close(Some(on_close), (&raw mut cl[3]).cast());
            } else {
                cl[3].closed = 1;
            }
            server.close(Some(on_close), (&raw mut cl[4]).cast());
            let deadline = loop_.now_ms() + 10_000;
            while cl.iter().any(|c| c.closed == 0) && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(conn_a);
            drop(conn_b);
            drop(a);
            drop(b);
            drop(server);
            drop(loop_);

            assert_eq!(actx.connects, vec![Win32Error::SUCCESS]);
            assert!(
                !b_connected_early,
                "B must be parked in the busy-retry worker while no instance listens"
            );
            assert_eq!(
                b_after,
                vec![Win32Error::SUCCESS],
                "busy retry converges after accept() re-arms"
            ); // quirk: PIPE-27, PIPE-22
            assert!(!alive_after);
        }
    }

    /// 7. Inherited non-overlapped handles (CreatePipe anonymous pipe):
    /// adoption detects synchronicity and direction, reads and writes work
    /// through the pool-worker fallback, and close interrupts a BLOCKED read
    /// worker promptly. // quirk: PIPE-13, PIPE-15, PIPE-34, PIPE-35, PIPE-41
    #[test]
    fn open_non_overlapped_inherited_fallback() {
        let _guard = serial();
        let mut rh: HANDLE = ptr::null_mut();
        let mut wh: HANDLE = ptr::null_mut();
        // SAFETY: valid out-pointers; default security/size.
        let ok = unsafe { CreatePipe(&raw mut rh, &raw mut wh, ptr::null_mut(), 0) };
        assert_ne!(ok, 0);

        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop and handles outlive the PipeHandles.
        let mut reader = unsafe { PipeHandle::open(lp, rh).unwrap() };
        let mut writer = unsafe { PipeHandle::open(lp, wh).unwrap() };
        let detect_ok = !reader.overlapped_io
            && !writer.overlapped_io
            && reader.readable
            && !reader.writable
            && writer.writable
            && !writer.readable; // quirk: PIPE-13, PIPE-15

        let mut rctx = Ctx::new();
        let mut wctx = Ctx::new();
        let mut buf = vec![0u8; 4096];
        let rd: *mut c_void = (&raw mut rctx).cast();
        let wd: *mut c_void = (&raw mut wctx).cast();
        // SAFETY: buffers/ctxs outlive the close drains.
        unsafe {
            reader
                .read_start(buf.as_mut_ptr(), buf.len(), on_read, rd)
                .unwrap();
            writer
                .write(&[b"sync pipe data"], Some(on_write), wd)
                .unwrap();
        }
        let deadline = loop_.now_ms() + 10_000;
        while (rctx.reads.len() < 14 || wctx.writes.is_empty()) && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        let got = rctx.reads.clone();
        let writes = wctx.writes.clone();

        // The re-armed read worker is now BLOCKED in ReadFile with no data
        // coming: close must force it past its syscall BEFORE returning —
        // otherwise CloseHandle races the worker's ReadFile on a recyclable
        // handle value. // quirk: PIPE-35
        let rw = reader.read_work;
        let close_started = loop_.now_ms();
        reader.close(Some(on_close), rd);
        // SAFETY: the work block is freed only when its completion
        // dispatches, which requires a tick; none has run since close().
        let worker_past_syscall_at_close_return = rw.is_null()
            || unsafe { (*rw).sync.thread.load(Ordering::Acquire) } == SyncIoState::PAST;
        writer.close(Some(on_close), wd);
        let deadline = loop_.now_ms() + 10_000;
        while (rctx.closed == 0 || wctx.closed == 0) && loop_.now_ms() < deadline {
            loop_.tick(Some(50));
        }
        let close_elapsed = loop_.now_ms() - close_started;
        let alive_after = loop_.alive();
        drop(reader);
        drop(writer);
        drop(loop_);

        assert!(detect_ok, "synchronicity + direction detection");
        assert!(
            worker_past_syscall_at_close_return,
            "close() returned while the read worker could still touch the handle"
        ); // quirk: PIPE-35
        assert_eq!(got, b"sync pipe data");
        assert_eq!(writes, vec![(14, Win32Error::SUCCESS)]);
        assert_eq!(rctx.closed, 1, "close with a blocked read worker hung");
        assert_eq!(wctx.closed, 1);
        assert!(
            close_elapsed < 9_000,
            "close took {close_elapsed}ms — the worker interrupt is broken"
        );
        assert!(!alive_after);
    }

    /// 9. Adoption and validation guards: a non-pipe handle is rejected as
    /// the raw not-a-socket shape; a handle already bound to a foreign port
    /// fails loudly (no EMULATE_IOCP shim — recorded decision); connect()
    /// validation failures deliver asynchronously, never from inside the
    /// call. // quirk: PIPE-12, PIPE-14, PIPE-16, PIPE-29
    #[test]
    fn adoption_and_validation_guards() {
        let _guard = serial();

        // (a) not-a-pipe (a regular disk file) → WSAENOTSOCK — the
        // pipe_connect_to_file shape. // quirk: PIPE-12
        {
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            let mut tmp = [0u16; 512];
            // SAFETY: valid out-buffer sized to the call (the extern
            // misdeclares the out param as LPCWSTR; pass a mut-derived ptr).
            let n = unsafe { bun_windows_sys::GetTempPathW(512, tmp.as_mut_ptr().cast_const()) }
                as usize;
            assert!(n > 0 && n < 480);
            let mut rand: u64 = 0;
            // SAFETY: writes 8 bytes into a valid local.
            let _ = unsafe { RtlGenRandom((&raw mut rand).cast::<c_void>(), 8) };
            let name: Vec<u16> = tmp[..n]
                .iter()
                .copied()
                .chain(format!("bun-iocp-pipe12-{rand:016x}.tmp").encode_utf16())
                .chain(core::iter::once(0))
                .collect();
            // SAFETY: NUL-terminated name; delete-on-close cleans up.
            let file = unsafe {
                CreateFileW(
                    name.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    ptr::null_mut(),
                    bun_windows_sys::CREATE_ALWAYS,
                    bun_windows_sys::FILE_FLAG_DELETE_ON_CLOSE,
                    ptr::null_mut(),
                )
            };
            assert_ne!(file, INVALID_HANDLE_VALUE);
            // SAFETY: loop valid; on error the caller keeps the handle.
            let err = unsafe { PipeHandle::open(lp, file) }.err();
            // SAFETY: the test owns `file` (open() failed, ownership stayed).
            unsafe { CloseHandle(file) };
            drop(loop_);
            assert_eq!(err, Some(Win32Error::WSAENOTSOCK));
        }

        // (b) handle already associated with another completion port: the
        // attach fails loudly instead of silently emulating.
        // // quirk: PIPE-14, PIPE-16
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop1 = Loop::new().unwrap();
            let mut loop2 = Loop::new().unwrap();
            let lp1: *mut Loop = &raw mut *loop1;
            // SAFETY: `ch` is a valid overlapped handle owned by the test.
            unsafe { loop2.associate(ch, 0).unwrap() };
            // SAFETY: loop valid; on error the caller keeps the handle.
            let err = unsafe { PipeHandle::open(lp1, ch) }.err();
            // SAFETY: the test owns both raw ends.
            unsafe {
                CloseHandle(ch);
                CloseHandle(sh);
            }
            drop(loop1);
            drop(loop2);
            assert!(
                err.is_some(),
                "adopting a foreign-port handle must fail loudly"
            );
        }

        // (c) connect() pre-check failures still deliver asynchronously.
        // // quirk: PIPE-29
        {
            let name = unique_name("precheck");
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop outlives the handles.
            let mut server = unsafe { PipeHandle::new(lp) };
            let mut sctx = Ctx::new();
            let sd: *mut c_void = (&raw mut sctx).cast();
            server.bind(&name).unwrap();
            // SAFETY: ctx outlives the server.
            unsafe { server.listen(1, on_connection, sd).unwrap() };
            // SAFETY: ctx outlives the server.
            unsafe { server.connect(&name, Some(on_connect), sd).unwrap() };
            let fired_inside_call = !sctx.connects.is_empty();
            let deadline = loop_.now_ms() + 5_000;
            while sctx.connects.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while sctx.closed == 0 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(server);
            drop(loop_);
            assert!(
                !fired_inside_call,
                "validation errors must never be delivered from inside connect()"
            );
            assert_eq!(sctx.connects, vec![Win32Error::INVALID_PARAMETER]);
            assert_eq!(sctx.closed, 1);
            assert!(!alive_after);
        }
    }

    /// 8. Shutdown sequencing: queued writes complete first; the flush
    /// blocks until the peer drains; writes after shutdown are rejected
    /// synchronously; the probe short-circuit completes without a peer
    /// action; the EOF grace timer force-closes a silent peer.
    /// // quirk: PIPE-50, PIPE-51, PIPE-52
    #[test]
    fn shutdown_flushes_then_signals() {
        let _guard = serial();

        // (a) flush path: peer stops reading mid-stream.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut sctx = Ctx::new();
            let mut cctx = Ctx::new();
            sctx.handle = &raw mut *server;
            sctx.stop_after = 64 * 1024; // park ~40-48 KiB unread
            let mut rbuf = vec![0u8; 8 * 1024];
            let sd: *mut c_void = (&raw mut sctx).cast();
            let cd: *mut c_void = (&raw mut cctx).cast();
            let a = vec![1u8; 96 * 1024];
            let b = vec![2u8; 16 * 1024];
            // SAFETY: buffers/ctxs/sources outlive the close drains.
            unsafe {
                server
                    .read_start(rbuf.as_mut_ptr(), rbuf.len(), on_read, sd)
                    .unwrap();
                client.write(&[&a], Some(on_write), cd).unwrap();
                client.write(&[&b], Some(on_write), cd).unwrap();
                client.shutdown(Some(on_shutdown), cd).unwrap();
            }
            // Writes after shutdown are rejected synchronously.
            // SAFETY: literal source.
            let rejected = unsafe { client.write(&[b"late"], Some(on_write), cd) };
            let deadline = loop_.now_ms() + 10_000;
            while cctx.writes.len() < 2 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            // Bounded window with ~48 KiB unread: the flush must NOT
            // complete while the peer is stopped.
            for _ in 0..10 {
                loop_.tick(Some(20));
            }
            let shutdown_fired_early = !cctx.shutdowns.is_empty();
            // Peer drains the rest; flush returns; shutdown completes.
            // SAFETY: buffer/ctx still valid.
            unsafe {
                server
                    .read_start(rbuf.as_mut_ptr(), rbuf.len(), on_read, sd)
                    .unwrap();
            }
            let deadline = loop_.now_ms() + 10_000;
            while cctx.shutdowns.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let total = sctx.reads.len();
            client.close(Some(on_close), cd);
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while (cctx.closed == 0 || sctx.closed == 0) && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(client);
            drop(server);
            drop(loop_);

            assert_eq!(rejected.err(), Some(Win32Error::NO_DATA));
            assert_eq!(
                cctx.writes,
                vec![
                    (96 * 1024, Win32Error::SUCCESS),
                    (16 * 1024, Win32Error::SUCCESS)
                ],
                "both queued writes complete before shutdown"
            );
            assert!(
                !shutdown_fired_early,
                "shutdown signaled while the peer still held unread data"
            ); // quirk: PIPE-50
            assert_eq!(cctx.shutdowns, vec![Win32Error::SUCCESS]);
            assert_eq!(
                cctx.order,
                vec!["write", "write", "shutdown", "close"],
                "flush-then-signal ordering (close cb last)"
            );
            assert_eq!(total, 96 * 1024 + 16 * 1024, "peer got every byte");
            assert!(!alive_after);
        }

        // (b) probe short-circuit (peer already drained) + the EOF grace
        // timer force-closing a silent peer.
        {
            let (sh, ch) = create_pair(&PairOptions::duplex()).unwrap();
            let mut loop_ = Loop::new().unwrap();
            let lp: *mut Loop = &raw mut *loop_;
            // SAFETY: loop/handles outlive the PipeHandles.
            let mut server = unsafe { PipeHandle::open(lp, sh).unwrap() };
            let mut client = unsafe { PipeHandle::open(lp, ch).unwrap() };
            let mut sctx = Ctx::new();
            let mut cctx = Ctx::new();
            let mut rbuf = vec![0u8; 4096];
            let mut cbuf = vec![0u8; 4096];
            let sd: *mut c_void = (&raw mut sctx).cast();
            let cd: *mut c_void = (&raw mut cctx).cast();
            // SAFETY: buffers/ctxs outlive the close drains.
            unsafe {
                server
                    .read_start(rbuf.as_mut_ptr(), rbuf.len(), on_read, sd)
                    .unwrap();
                client.write(&[b"tiny"], Some(on_write), cd).unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while sctx.reads.len() < 4 && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            // Everything drained: the probe completes the shutdown without
            // any further peer action. // quirk: PIPE-50
            // SAFETY: ctx valid.
            unsafe { client.shutdown(Some(on_shutdown), cd).unwrap() };
            let deadline = loop_.now_ms() + 5_000;
            while cctx.shutdowns.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            // EOF grace: reading a silent peer after shutdown force-closes
            // within the 50 ms window and reports EOF. // quirk: PIPE-51
            // SAFETY: buffer/ctx valid.
            unsafe {
                client
                    .read_start(cbuf.as_mut_ptr(), cbuf.len(), on_read, cd)
                    .unwrap();
            }
            let deadline = loop_.now_ms() + 5_000;
            while cctx.read_errs.is_empty() && loop_.now_ms() < deadline {
                loop_.tick(Some(20));
            }
            client.close(Some(on_close), cd);
            server.close(Some(on_close), sd);
            let deadline = loop_.now_ms() + 5_000;
            while (cctx.closed == 0 || sctx.closed == 0) && loop_.now_ms() < deadline {
                loop_.tick(Some(50));
            }
            let alive_after = loop_.alive();
            drop(client);
            drop(server);
            drop(loop_);

            assert_eq!(cctx.shutdowns, vec![Win32Error::SUCCESS]);
            assert_eq!(
                cctx.read_errs,
                vec![Win32Error::BROKEN_PIPE],
                "grace timer delivered EOF exactly once"
            );
            assert!(!alive_after);
        }
    }
}
