#![cfg(windows)]

//! The IOCP event loop core: completion collection and dispatch, the pending
//! request queue, the endgame drain, wakeups, and liveness accounting.
//!
//! Ordering doctrine: the completion port orders *completions*, not data —
//! two operations on one handle may complete out of submission order, and
//! posted packets interleave arbitrarily with kernel completions. Data
//! ordering lives in per-handle write queues; the single-consumer dequeue
//! below is the only ordering-preserving model. // quirk: ADD-03

use core::ffi::c_void;
use core::ptr;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_windows_sys::kernel32::{
    CreateIoCompletionPort, GetQueuedCompletionStatusEx, QueryPerformanceCounter,
    QueryPerformanceFrequency,
};
use bun_windows_sys::{
    CloseHandle, DWORD, HANDLE, INFINITE, OVERLAPPED_ENTRY, Win32Error, kernel32::GetLastError,
};

use crate::handle::HandleCore;
use crate::req::{Req, ReqKind};
use crate::timer::{Timer, TimerCb, Timers};

/// Completions dequeued per `GetQueuedCompletionStatusEx` call.
const COMPLETION_BATCH: usize = 128; // quirk: LOOP-01

/// Post a completion packet or die: every engine post is a delivery
/// contract (a latched flag, a pending req, a stolen-packet re-post) whose
/// silent loss wedges a protocol forever. The assert reads only the local
/// return — a successful post may free the owner immediately.
/// (`wake_all_loops` in init.rs is the one deliberate best-effort post.)
pub(crate) fn post_or_die(
    iocp: bun_windows_sys::HANDLE,
    bytes: u32,
    key: usize,
    overlapped: *mut bun_windows_sys::OVERLAPPED,
    what: &str,
) {
    // SAFETY: caller passes a live port + a pinned/immortal OVERLAPPED.
    let ok = unsafe {
        bun_windows_sys::kernel32::PostQueuedCompletionStatus(iocp, bytes, key, overlapped)
    };
    assert!(
        ok != 0,
        "{what} completion post failed: {:?}",
        bun_windows_sys::Win32Error::get()
    );
}

/// Post-poll pending-drain rounds before yielding back to poll (with a zero
/// timeout when work remains): completion callbacks synchronously start I/O
/// that completes instantly, and an unbounded drain starves polling entirely.
/// // quirk: LOOP-13
const PENDING_DRAIN_ROUNDS: usize = 8;

/// Phase hook. Receives the loop (re-lent) plus the context it was set with.
pub type HookFn = unsafe fn(&mut Loop, *mut c_void);

/// One `tick()`'s outcome.
#[derive(Copy, Clone, Debug, Default)]
pub struct TickResult {
    /// Kernel completions dispatched.
    pub dispatched: usize,
    /// Timer callbacks fired.
    pub timers_fired: usize,
    /// `stop()` was observed (flag is consumed).
    pub stopped: bool,
}

pub struct Loop {
    iocp: HANDLE,
    /// Handles started+ref'd, plus one per closing handle. // quirk: LOOP-27
    active_handles: u32,
    /// Overlapped requests in flight.
    active_reqs: u32,
    /// Requests completed locally (self-posted or synchronous submit
    /// failures), dispatched by `process_pending` without a kernel round
    /// trip. Intrusive singly-linked FIFO. // quirk: POLL-28
    pending_head: *mut Req,
    pending_tail: *mut Req,
    /// Closing handles whose requests have drained, LIFO. // quirk: LOOP-26
    endgame_head: *mut HandleCore,
    /// Coalesces wakeups: only the 0→1 transition posts a packet.
    wakeup_pending: AtomicBool,
    /// The wakeup packet's request. Pinned inside the (heap-pinned) loop for
    /// the lifetime of any posted packet. // quirk: LOOP-04
    wakeup_req: Req,
    /// QPC ticks per millisecond, cached (the frequency is fixed at boot).
    qpf_per_ms: i64,
    /// AFD poll peer sockets, one slot per MSAFD provider. 3-state: 0 =
    /// never tried, INVALID_SOCKET = tried-and-failed (never retried), else
    /// a valid conduit associated with this port. // quirk: POLL-05, POLL-08
    pub(crate) poll_peer_sockets:
        [bun_windows_sys::ws2_32::SOCKET; bun_windows_sys::ws2_32::MSAFD_PROVIDER_IDS.len()],
    /// Base sockets with a live `AfdPoll` watcher. Two watchers on one
    /// socket kick each other's Exclusive IRPs in an endless cancel war, so
    /// init refuses duplicates instead of busylooping. // quirk: POLL-37
    pub(crate) poll_watched_sockets: Vec<bun_windows_sys::ws2_32::SOCKET>,
    timers: Timers,
    /// `stop()` requested; consumed by the next `tick()`.
    stop_flag: bool,
    /// Runs at the top of every tick, before I/O collection.
    pre_hook: Option<(HookFn, *mut c_void)>,
    /// Runs near the end of every tick, after dispatch.
    post_hook: Option<(HookFn, *mut c_void)>,
    /// Runs only when the tick is about to block (nonzero wait): the GC
    /// safepoint slot.
    before_wait_hook: Option<(HookFn, *mut c_void)>,
}

impl Loop {
    /// Creates the loop. Boxed: the kernel holds pointers into the loop
    /// (`wakeup_req`) while packets are in flight, so the allocation must
    /// never move.
    pub fn new() -> Result<Box<Loop>, Win32Error> {
        crate::init::process_init();
        // Concurrency value 1: single-consumer dequeue is the only
        // ordering-preserving model. // quirk: LOOP-06, ADD-03
        // SAFETY: documented create-new-port argument shape; no pointers.
        let iocp = unsafe {
            CreateIoCompletionPort(bun_windows_sys::INVALID_HANDLE_VALUE, ptr::null_mut(), 0, 1)
        };
        if iocp.is_null() {
            return Err(Win32Error::from_raw(GetLastError() as u16));
        }
        let mut freq: i64 = 0;
        // SAFETY: writes through a valid local out-pointer; cannot fail on XP+.
        unsafe { QueryPerformanceFrequency(&raw mut freq) };
        let mut loop_ = Box::new(Loop {
            iocp,
            active_handles: 0,
            active_reqs: 0,
            pending_head: ptr::null_mut(),
            pending_tail: ptr::null_mut(),
            endgame_head: ptr::null_mut(),
            wakeup_pending: AtomicBool::new(false),
            wakeup_req: Req::new(ReqKind::Wakeup, ptr::null_mut()),
            qpf_per_ms: freq / 1000,
            poll_peer_sockets: [0; bun_windows_sys::ws2_32::MSAFD_PROVIDER_IDS.len()],
            poll_watched_sockets: Vec::new(),
            timers: Timers::new(),
            stop_flag: false,
            pre_hook: None,
            post_hook: None,
            before_wait_hook: None,
        });
        let self_ptr: *mut Loop = &raw mut *loop_;
        loop_.wakeup_req = Req::new(ReqKind::Wakeup, self_ptr.cast::<c_void>());
        // Register only when fully constructed: registered ports are always
        // valid for the resume waker. // quirk: LOOP-39
        crate::init::register_loop(iocp);
        Ok(loop_)
    }

    /// Associate `handle` with this loop's completion port. All overlapped
    /// completions on it will be dequeued by this loop. Irrevocable for the
    /// life of the handle.
    ///
    /// # Safety
    /// `handle` must be a valid, overlapped-capable kernel handle owned by
    /// the caller for at least as long as I/O is submitted on it.
    pub unsafe fn associate(&mut self, handle: HANDLE, key: usize) -> Result<(), Win32Error> {
        // SAFETY: opaque handles passed through to the kernel, which
        // validates them; no application-side dereference.
        let r = unsafe { CreateIoCompletionPort(handle, self.iocp, key, 0) };
        if r.is_null() {
            return Err(Win32Error::from_raw(GetLastError() as u16));
        }
        Ok(())
    }

    #[inline]
    pub fn iocp(&self) -> HANDLE {
        self.iocp
    }

    /// Monotonic milliseconds (QPC scaled with integer math — no
    /// double-precision drift; deliberate deviation from libuv’s double
    /// scaling). // quirk: LOOP-48
    #[inline]
    pub fn now_ms(&self) -> u64 {
        let mut count: i64 = 0;
        // SAFETY: writes through a valid local out-pointer; cannot fail on XP+.
        unsafe { QueryPerformanceCounter(&raw mut count) };
        (count / self.qpf_per_ms) as u64
    }

    // ── liveness ──────────────────────────────────────────────────────────

    pub(crate) fn active_handles_inc(&mut self) {
        self.active_handles += 1;
    }
    pub(crate) fn active_handles_dec(&mut self) {
        debug_assert!(self.active_handles > 0);
        // Saturating like the POSIX twin (jsc event_loop update_counts):
        // Bun's virtual keep-alive refs and the engine's accounting can
        // momentarily disagree during teardown; a wrap would pin alive()
        // true forever. Debug builds still assert the imbalance.
        self.active_handles = self.active_handles.saturating_sub(1);
    }
    pub(crate) fn active_reqs_inc(&mut self) {
        self.active_reqs += 1;
    }
    pub(crate) fn active_reqs_dec(&mut self) {
        debug_assert!(self.active_reqs > 0);
        self.active_reqs -= 1;
    }

    #[inline]
    pub fn active_handles(&self) -> u32 {
        self.active_handles
    }

    /// External keep-alive (DNS in-flight, FilePoll-style consumers): a unit
    /// of "work exists" with no handle object behind it.
    pub fn add_active(&mut self) {
        self.active_handles_inc();
    }
    pub fn sub_active(&mut self) {
        self.active_handles_dec();
    }

    /// Pending requests and queued endgames count as work: a callback that
    /// queues follow-up right before the alive check must not see the loop
    /// exit. // quirk: LOOP-20
    pub fn alive(&self) -> bool {
        self.active_handles > 0
            || self.active_reqs > 0
            || !self.pending_head.is_null()
            || !self.endgame_head.is_null()
    }

    // ── wakeup ────────────────────────────────────────────────────────────

    /// Wake the loop from any thread. Coalesced atomic 0→1 test-and-set:
    /// only the winning caller posts, and the packet is the loop-embedded
    /// request, not a NULL packet — it dispatches through the normal req
    /// path. // quirk: LOOP-29, LOOP-30
    ///
    /// # Safety
    /// The loop allocation must still be alive (callers hold it via the
    /// owner's synchronization; this is the only cross-thread entry point).
    pub unsafe fn wake(this: *mut Loop) {
        // SAFETY: caller guarantees the loop is alive (fn contract); the
        // wakeup_req lives inside the pinned loop allocation.
        unsafe {
            // Only the 0→1 transition posts; the flag is cleared by the
            // dispatcher before invoking wakeup processing, so a wake racing
            // the dispatch posts a fresh packet rather than being lost.
            if (*this)
                .wakeup_pending
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                let overlapped = (*this).wakeup_req.overlapped_ptr();
                // Posting can only fail for invalid port/OOM of the queue —
                // both unrecoverable for a loop wakeup.
                // `wakeup_pending` is CAS-latched: a lost post makes the loop
                // permanently unwakeable and wedges the close protocol's
                // wakeup_in_flight() wait.
                post_or_die((*this).iocp, 0, 0, overlapped, "loop wakeup");
            }
        }
    }

    /// Whether a posted wakeup packet has not yet been dequeued. The async
    /// close protocol must wait for in-flight packets before teardown.
    /// // quirk: LOOP-32
    pub fn wakeup_in_flight(&self) -> bool {
        self.wakeup_pending.load(Ordering::Acquire)
    }

    /// Dispatch arm for the wakeup packet. Cleared at dispatch time, BEFORE
    /// any further processing: a `wake()` racing this (or sent from a
    /// callback) must post a fresh packet, not coalesce into one being
    /// consumed. // quirk: LOOP-31
    pub(crate) fn consume_wakeup(&mut self) {
        self.wakeup_pending.store(false, Ordering::Release);
    }

    // ── pending queue ─────────────────────────────────────────────────────

    /// Queue a locally-completed request for dispatch on the next
    /// `process_pending`. Single error-delivery funnel: synchronous submit
    /// failures call `req.set_error(..)` then this, so callers observe every
    /// failure asynchronously, exactly like a kernel completion.
    /// // quirk: POLL-28
    ///
    /// # Safety
    /// `req` must stay alive until dispatched; it must not already be queued.
    pub unsafe fn insert_pending(&mut self, req: *mut Req) {
        // SAFETY: caller guarantees `req` outlives its dispatch and is not
        // already queued (fn contract); links are loop-private.
        unsafe {
            debug_assert!(!req.is_null());
            // Double-queuing corrupts the intrusive list silently; scan in
            // debug builds. // quirk: LOOP-14
            #[cfg(debug_assertions)]
            {
                let mut cur = self.pending_head;
                while !cur.is_null() {
                    debug_assert!(
                        !core::ptr::eq(cur, req),
                        "request inserted into the pending queue twice"
                    );
                    cur = (*cur).next_pending_ptr();
                }
            }
            (*req).set_next_pending(ptr::null_mut());
            if self.pending_tail.is_null() {
                self.pending_head = req;
            } else {
                (*self.pending_tail).set_next_pending(req);
            }
            self.pending_tail = req;
        }
    }

    /// Dispatch all currently-queued pending requests (snapshot-and-null
    /// drain). Requests inserted by
    /// the callbacks themselves land in a fresh queue and are NOT dispatched
    /// in this round // quirk: LOOP-12 — the run loop bounds successive rounds to keep poll
    /// from starving. Returns the number dispatched.
    pub fn process_pending(&mut self) -> usize {
        // Snapshot: re-entrant inserts build a new list.
        let mut cur = core::mem::replace(&mut self.pending_head, ptr::null_mut());
        self.pending_tail = ptr::null_mut();
        let mut n = 0;
        while !cur.is_null() {
            // SAFETY: insert_pending's contract — alive until dispatched.
            let req = unsafe { &mut *cur };
            cur = req.take_next_pending();
            crate::dispatch::dispatch(self, req);
            n += 1;
        }
        n
    }

    #[inline]
    pub fn has_pending(&self) -> bool {
        !self.pending_head.is_null()
    }

    // ── endgames ──────────────────────────────────────────────────────────

    pub(crate) fn endgame_push(&mut self, handle: *mut HandleCore) {
        // SAFETY: only called from HandleCore::want_endgame with a live,
        // heap-pinned handle (the embedder pins it while closing).
        unsafe {
            (*handle).endgame_next = self.endgame_head;
        }
        self.endgame_head = handle;
    }

    /// Drain endgames to exhaustion: a close callback that closes more
    /// handles (whose endgames become ready synchronously) has them processed
    /// in the same phase, so close cascades don't take one iteration each.
    /// LIFO — close-callback order is unspecified. // quirk: LOOP-26
    pub fn process_endgames(&mut self) {
        while !self.endgame_head.is_null() {
            let handle = self.endgame_head;
            // SAFETY: queued handles are live until their endgame runs
            // (LOOP-25 protocol); the list is loop-private.
            self.endgame_head = unsafe { (*handle).endgame_next };
            // SAFETY: same liveness guarantee; run_endgame consumes the
            // handle's queued state exactly once.
            unsafe {
                (*handle).endgame_next = ptr::null_mut();
                HandleCore::run_endgame(handle);
            }
        }
    }

    #[inline]
    pub fn has_endgames(&self) -> bool {
        !self.endgame_head.is_null()
    }

    // ── poll ──────────────────────────────────────────────────────────────

    /// Block for completions for up to `timeout_ms` (`None` = forever), then
    /// dispatch everything dequeued. Returns the number of completions
    /// dispatched (0 = timeout or pure wakeup).
    ///
    /// GQCSEx can return up to a scheduler tick (~15.6 ms) BEFORE the
    /// requested timeout; the deadline is recomputed and the wait re-armed
    /// until reached, with a growing pad from the third round so a
    /// fast-spinning kernel can't busy-loop us. Timers must therefore never
    /// fire early through this path. // quirk: LOOP-02
    pub fn poll_once(&mut self, timeout_ms: Option<u64>) -> usize {
        let deadline = timeout_ms.map(|t| self.now_ms() + t);
        let mut remaining: DWORD = match timeout_ms {
            None => INFINITE,
            Some(t) => t.min(INFINITE as u64 - 1) as DWORD,
        };
        let mut repeat: u32 = 0;
        loop {
            let mut entries: [OVERLAPPED_ENTRY; COMPLETION_BATCH] = [OVERLAPPED_ENTRY {
                lpCompletionKey: 0,
                lpOverlapped: ptr::null_mut(),
                Internal: 0,
                dwNumberOfBytesTransferred: 0,
            };
                COMPLETION_BATCH];
            let mut count: u32 = 0;
            // SAFETY: entries/count are valid locals sized to the call.
            let ok = unsafe {
                GetQueuedCompletionStatusEx(
                    self.iocp,
                    entries.as_mut_ptr(),
                    COMPLETION_BATCH as u32,
                    &raw mut count,
                    remaining,
                    0,
                )
            };
            if ok != 0 {
                let mut dispatched = 0;
                for entry in &entries[..count as usize] {
                    // Null lpOverlapped is a pure wakeup from a foreign
                    // poster — its only effect was ending the wait.
                    // quirk: LOOP-03
                    if entry.lpOverlapped.is_null() {
                        continue;
                    }
                    // SAFETY: every non-null completion on this port was
                    // submitted through a `Req` (LOOP-03 filter above).
                    let req = unsafe { Req::from_overlapped(entry.lpOverlapped) };
                    let internal = crate::dispatch::is_internal(req.kind());
                    crate::dispatch::dispatch(self, req);
                    if !internal {
                        dispatched += 1;
                    }
                }
                return dispatched;
            }

            let err = GetLastError();
            // A non-timeout dequeue failure means the port itself is broken
            // (bad handle, corrupted state): retrying would spin forever on
            // the same error. Die loudly. // quirk: LOOP-07
            assert!(err == 258, "GetQueuedCompletionStatusEx: {err}"); // WAIT_TIMEOUT
            let Some(deadline) = deadline else {
                // Infinite wait "timing out" — re-arm.
                continue;
            };
            let now = self.now_ms();
            if now >= deadline {
                return 0;
            }
            // Early return: recompute, padding later rounds. // quirk: LOOP-02
            repeat += 1;
            let pad = if repeat >= 2 { repeat as u64 } else { 0 };
            remaining = (deadline - now + pad).min(INFINITE as u64 - 1) as DWORD;
        }
    }

    // ── timers ────────────────────────────────────────────────────────────

    /// Arm `timer` to fire `cb(loop, data)` after `timeout_ms`, then every
    /// `repeat_ms` (0 = one-shot). Re-arming replaces the deadline.
    pub fn timer_start(
        &mut self,
        timer: &mut Timer,
        cb: TimerCb,
        data: *mut c_void,
        timeout_ms: u64,
        repeat_ms: u64,
    ) {
        let now = self.now_ms();
        self.timers
            .start(timer, cb, data, now, timeout_ms, repeat_ms);
    }

    pub fn timer_stop(&mut self, timer: &mut Timer) {
        self.timers.stop(timer);
    }

    /// Release the timer's loop slot; the handle is dead afterwards.
    pub fn timer_release(&mut self, timer: &mut Timer) {
        self.timers.release(timer);
    }

    pub fn timer_armed(&self, timer: &Timer) -> bool {
        self.timers.armed(timer)
    }

    /// Fire every timer due now. Callbacks receive the loop re-lent, so they
    /// may arm/stop timers and drive the loop freely.
    pub fn run_timers(&mut self) -> usize {
        let now = self.now_ms();
        // Two-phase: collect everything due NOW, then dispatch. A
        // zero-timeout timer restarted from its own callback lands in the
        // heap for the NEXT pass — otherwise it busy-loops the process while
        // the millisecond clock stands still. Stops/restarts from earlier
        // callbacks in the batch void later collected entries via the
        // generation re-check. // quirk: LOOP-44
        let mut due = Vec::new();
        while let Some(d) = self.timers.pop_due(now) {
            due.push(d);
        }
        let mut fired = 0;
        for d in due {
            if !self.timers.is_current(d.slot, d.generation) {
                continue;
            }
            fired += 1;
            // SAFETY: the embedder guarantees `data` valid while armed.
            unsafe { (d.cb)(self, d.data) };
        }
        fired
    }

    // ── hooks ─────────────────────────────────────────────────────────────

    pub fn set_pre_hook(&mut self, hook: Option<(HookFn, *mut c_void)>) {
        self.pre_hook = hook;
    }
    pub fn set_post_hook(&mut self, hook: Option<(HookFn, *mut c_void)>) {
        self.post_hook = hook;
    }
    /// The GC-safepoint slot: runs only when a tick is about to block.
    pub fn set_before_wait_hook(&mut self, hook: Option<(HookFn, *mut c_void)>) {
        self.before_wait_hook = hook;
    }

    #[inline]
    fn run_hook(&mut self, hook: Option<(HookFn, *mut c_void)>) {
        if let Some((f, ctx)) = hook {
            // SAFETY: hook setters' contract — ctx valid while installed.
            unsafe { f(self, ctx) };
        }
    }

    /// Make the next (or current, if blocking) `tick` return promptly with
    /// `stopped = true`. Consumed (reset) by exactly one tick. // quirk: LOOP-21
    pub fn stop(&mut self) {
        self.stop_flag = true;
        let this: *mut Loop = self;
        // SAFETY: `self` is live.
        unsafe { Loop::wake(this) };
    }

    // ── tick ──────────────────────────────────────────────────────────────

    /// One loop iteration: pre hook → pending drain → (before-wait hook if
    /// blocking) → poll with the timeout folded against the next timer
    /// deadline → due timers → bounded pending drain → post hook → endgames.
    ///
    /// Timers dispatch INSIDE the pre/post bracket (the POSIX backend's
    /// ordering, deliberately converged on). Endgames run near the end of
    /// the iteration, never before poll. `timeout_ms` is the caller's
    /// maximum wait: `None` = until work arrives; `Some(0)` = non-blocking.
    /// // quirk: LOOP-28, LOOP-13
    pub fn tick(&mut self, timeout_ms: Option<u64>) -> TickResult {
        let mut result = TickResult::default();
        self.run_hook(self.pre_hook);

        // Work queued before the iteration (sync-failure completions).
        self.process_pending();

        // Fold the next timer deadline into the wait; queued work or a stop
        // request forces a non-blocking poll.
        let now = self.now_ms();
        let timer_due = self.timers.next_due_in(now);
        let mut wait = match (timeout_ms, timer_due) {
            (Some(t), Some(d)) => Some(t.min(d)),
            (Some(t), None) => Some(t),
            (None, Some(d)) => Some(d),
            (None, None) => None,
        };
        // Queued endgames are a zero-timeout condition like pending reqs
        // (uv_backend_timeout parity — a blocking wait must never start
        // while a close is waiting to finish). // quirk: LOOP-19
        if self.has_pending() || self.has_endgames() || self.stop_flag {
            wait = Some(0);
        }

        if wait != Some(0) {
            self.run_hook(self.before_wait_hook);
            // The hook may have produced work or stopped the loop.
            if self.has_pending() || self.has_endgames() || self.stop_flag {
                wait = Some(0);
            }
        }

        result.dispatched = self.poll_once(wait);
        result.timers_fired = self.run_timers();

        // Completion callbacks start I/O that completes instantly; drain a
        // bounded number of rounds, then leave the rest for the next tick
        // (which will poll with a zero timeout — `has_pending` above).
        // quirk: LOOP-13
        for _ in 0..PENDING_DRAIN_ROUNDS {
            if self.process_pending() == 0 {
                break;
            }
        }

        self.run_hook(self.post_hook);
        self.process_endgames(); // quirk: LOOP-28
        result.stopped = core::mem::replace(&mut self.stop_flag, false);
        result
    }
}

impl Drop for Loop {
    fn drop(&mut self) {
        debug_assert!(
            !self.alive(),
            "loop dropped with live work (handles={}, reqs={})",
            self.active_handles,
            self.active_reqs
        );
        // Unregister FIRST so the resume waker can't post to a dying port.
        // quirk: LOOP-37
        crate::init::unregister_loop(self.iocp);
        // Close the AFD peer conduits before their port; the cache's
        // sentinel states (0 / INVALID_SOCKET) are not sockets. // quirk: POLL-08
        for &peer in self.poll_peer_sockets.iter() {
            if peer != 0 && peer != bun_windows_sys::ws2_32::INVALID_SOCKET {
                // SAFETY: peer sockets are loop-owned and closed exactly once
                // here; no poll IRPs remain (`!self.alive()` asserted above).
                unsafe { bun_windows_sys::ws2_32::closesocket(peer) };
            }
        }
        // SAFETY: the port handle is owned by this loop and closed once.
        unsafe { CloseHandle(self.iocp) };
    }
}
