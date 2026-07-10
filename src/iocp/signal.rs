#![cfg(windows)]

//! Signal watcher handle class — the `uv_signal_t` replacement: console
//! ctrl events (and synthetic signals like SIGWINCH) fanned out to per-loop
//! watchers through one process-global registry.
//!
//! Windows has no kernel signals. The only delivery source is the console
//! ctrl handler — registered ONCE at process init and never unregistered
//! (unhooking from inside a handler thread deadlocks the console host, and a
//! CTRL_CLOSE thread may be parked in `Sleep(INFINITE)` at any shutdown
//! point). The handler runs on OS-injected threads, so the dispatch path is
//! allocation-free and loop-state-free: registry lock, per-handle atomics,
//! and `PostQueuedCompletionStatus` of a pre-embedded request — nothing
//! else. // quirk: SIGEV-01, SIGEV-02, SIGEV-17
//!
//! Design decisions (named project outcomes, not oversights):
//!
//! - **`pending_signum != 0` ⟺ exactly one completion is in flight.** The
//!   one-shot suppression flag is checked BEFORE the pending swap (libuv
//!   swaps first, which can re-set `pending_signum` without posting during
//!   a one-shot's own callback — stranding `uv__signal_close` waiting on a
//!   packet that was never posted). Close gates its endgame on this
//!   invariant. // quirk: SIGEV-10, SIGEV-13, SIGEV-14
//! - **`stop()` resets one-shot state.** libuv's Windows backend leaves
//!   `ONE_SHOT`/`ONE_SHOT_DISPATCHED` sticky across stop/start, so a
//!   restarted watcher after a dispatched one-shot never fires again; the
//!   Unix backend clears both — we follow Unix. // quirk: SIGEV-13
//! - **Same-signum restart updates the one-shot mode too** (libuv swaps only
//!   the callback). The watcher never leaves the registry, so no pending
//!   signal is lost in a `signum == 0` window. // quirk: SIGEV-12
//! - **In-callback restarts are never auto-stopped.** A one-shot delivery
//!   auto-stops after its callback only if the watcher's start generation is
//!   unchanged — a callback that stopped/restarted the handle owns the new
//!   registration. // quirk: SIGEV-13
//! - **Signal completions never hold the loop open** (`active_reqs` is not
//!   taken): an unref'd watcher with an undelivered signal must not pin the
//!   loop, matching libuv (signal reqs are never registered).
//! - **Division of labor** per the ledger: kill-side emulation stays in
//!   `process.rs` (`kill_pid` / `ProcessHandle::kill` — TerminateProcess,
//!   never console events); CRT `raise()` and in-process exceptions never
//!   reach watchers; CTRL_C only exists while console input has
//!   ENABLE_PROCESSED_INPUT — raw-mode stdin (tty.rs) turns Ctrl-C into a
//!   key event, not SIGINT. // quirk: SIGEV-21

use core::ffi::c_void;
use core::mem;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicI32, Ordering};
// std Mutex/Once (not bun_threading): bun_threading pulls bun_alloc, which
// would break this crate's natively-linkable test binary (see Cargo.toml);
// the registry lock guards rare events (watcher start/stop, signal arrival).
#[allow(clippy::disallowed_types)]
use std::sync::{Mutex, Once};

use bun_windows_sys::kernel32::SetConsoleCtrlHandler;
use bun_windows_sys::{
    BOOL, CTRL_BREAK_EVENT, CTRL_C_EVENT, CTRL_CLOSE_EVENT, DWORD, FALSE, HANDLE, INFINITE,
    OVERLAPPED, Sleep, TRUE, Win32Error,
};

use crate::event_loop::Loop;
use crate::handle::HandleCore;
use crate::process::SIGINT;
use crate::req::{Req, ReqKind};

// ── signal numbers ──────────────────────────────────────────────────────────

// Receive-side signal numbers, Linux-compatible values per libuv's table
// (include/uv/win.h:70-102). The kill-side constants (SIGINT/SIGQUIT/
// SIGKILL/SIGTERM) live in process.rs and are shared, never redefined.
// // quirk: SIGEV-07
pub const SIGHUP: i32 = 1;
/// Windows-CRT-only signal Node exposes for CTRL_BREAK. // quirk: SIGEV-03
pub const SIGBREAK: i32 = 21;
pub const SIGWINCH: i32 = 28;
/// Validation limit derived from the table — NOT the CRT's NSIG (23), which
/// would reject SIGWINCH. Shared with `process.rs` kill validation.
/// // quirk: SIGEV-07, PROC-51
pub(crate) const NSIG: i32 = SIGWINCH + 1;

// ── callback types ──────────────────────────────────────────────────────────

/// Signal callback: `(loop re-lent, data, signum)`. Bursts coalesce — one
/// callback may represent several arrivals. // quirk: SIGEV-10
pub type SignalCb = unsafe fn(&mut Loop, *mut c_void, i32);
/// Close callback, run from the endgame once the in-flight completion (if
/// any) drained; only then may the owner free the handle box.
pub type SignalCloseCb = unsafe fn(&mut Loop, *mut c_void);

// ── process-global registry ─────────────────────────────────────────────────

/// One started watcher: the signum it watches plus the handle address
/// (exposed provenance; doubles as removal identity). Entries exist exactly
/// while the watcher is started — start inserts, stop removes, both under
/// the registry lock the dispatcher takes. // quirk: SIGEV-09
struct RegEntry {
    signum: i32,
    handle: usize,
}

#[allow(clippy::disallowed_types)] // std Mutex: see the module-level import note
static REGISTRY: Mutex<Vec<RegEntry>> = Mutex::new(Vec::new());

#[allow(clippy::disallowed_types)] // std Mutex: see the module-level import note
fn lock_registry() -> std::sync::MutexGuard<'static, Vec<RegEntry>> {
    REGISTRY.lock().unwrap_or_else(|p| p.into_inner())
}

// ── the handle ──────────────────────────────────────────────────────────────

/// A signal watcher on the IOCP loop. Heap-pinned by its owner while started
/// or closing; destruction is the deferred endgame protocol — `close()` then
/// free only after the close callback. Watchers for signums Windows can
/// never raise (SIGTERM, SIGKILL, ...) are accepted and simply never fire.
/// // quirk: SIGEV-08, LOOP-25
#[repr(C)]
pub struct SignalHandle {
    core: HandleCore,
    /// The single embedded completion token the dispatcher posts. Its
    /// OVERLAPPED is never written after init (`Internal = 0` reads as
    /// success), so the handler thread only passes its address.
    req: Req,
    /// Coalescing + in-flight marker: swapped to the signum at dispatch,
    /// back to 0 at processing. Nonzero ⟺ one completion is posted and not
    /// yet drained — the close gate. // quirk: SIGEV-10, SIGEV-14
    pending_signum: AtomicI32,
    /// One-shot mode; read by the dispatcher under the registry lock.
    one_shot: AtomicBool,
    /// Set by the dispatcher when a one-shot fires so later arrivals are
    /// suppressed until the loop processes + stops it. // quirk: SIGEV-13
    one_shot_dispatched: AtomicBool,
    /// The owning loop's completion port, captured at creation: the handler
    /// thread may not touch loop state. // quirk: SIGEV-02
    iocp: HANDLE,
    /// Watched signum; 0 = stopped. Loop-thread only.
    signum: i32,
    /// Bumped on every successful start; the delivery path re-checks it
    /// after the user callback so an in-callback restart is never
    /// auto-stopped. Loop-thread only.
    generation: u32,
    /// `close()` found a posted-but-undrained completion and took a
    /// synthetic req count for it; the drain releases it. Loop-thread only.
    /// // quirk: SIGEV-14
    close_counted_inflight: bool,
    cb: Option<SignalCb>,
    data: *mut c_void,
    close_cb: Option<SignalCloseCb>,
    close_data: *mut c_void,
}

impl SignalHandle {
    /// Create an idle watcher for a later [`start`](Self::start).
    ///
    /// # Safety
    /// `lp` must be a valid pinned loop that outlives the handle; the caller
    /// must keep the returned box alive until the close callback runs.
    pub unsafe fn new(lp: *mut Loop) -> Box<SignalHandle> {
        let mut h = Box::new(SignalHandle {
            // SAFETY: fn contract — the loop outlives the handle; the box is
            // the required heap pinning.
            core: unsafe { HandleCore::new(lp, signal_endgame) },
            req: Req::new(ReqKind::Signal, ptr::null_mut()),
            pending_signum: AtomicI32::new(0),
            one_shot: AtomicBool::new(false),
            one_shot_dispatched: AtomicBool::new(false),
            // SAFETY: fn contract — `lp` is valid; the port handle is
            // immutable for the loop's lifetime.
            iocp: unsafe { (*lp).iocp() },
            signum: 0,
            generation: 0,
            close_counted_inflight: false,
            cb: None,
            data: ptr::null_mut(),
            close_cb: None,
            close_data: ptr::null_mut(),
        });
        // The embedded req's owner back-pointer is the heap-pinned address.
        let hp: *mut SignalHandle = &raw mut *h;
        h.req = Req::new(ReqKind::Signal, hp.cast::<c_void>());
        h
    }

    #[inline]
    pub fn is_closing(&self) -> bool {
        self.core.is_closing()
    }
    /// Watching (started and not stopped/closed).
    #[inline]
    pub fn is_started(&self) -> bool {
        self.signum != 0
    }
    /// The watched signum (0 = stopped).
    #[inline]
    pub fn signum(&self) -> i32 {
        self.signum
    }

    /// Drop the loop keep-alive without stopping the watch (close still
    /// holds the loop until the close callback).
    pub fn unref(&mut self) {
        self.core.unref();
    }
    /// Restore the keep-alive dropped by [`unref`](Self::unref).
    pub fn ref_(&mut self) {
        self.core.ref_();
    }

    /// Start watching `signum`. `one_shot` delivers at most one callback and
    /// then stops the watcher. Any `0 < signum < NSIG` is accepted — signums
    /// Windows cannot raise (SIGTERM, SIGKILL, ...) register fine and never
    /// fire, the cross-platform contract Node relies on. Restarting on the
    /// SAME signum short-circuits (callback/data/mode swap, no registry
    /// churn) so no pending signal is lost; a different signum stops first.
    /// // quirk: SIGEV-07, SIGEV-08, SIGEV-12
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run (until stop/close).
    pub unsafe fn start(
        &mut self,
        signum: i32,
        one_shot: bool,
        cb: SignalCb,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if signum <= 0 || signum >= NSIG {
            return Err(Win32Error::INVALID_PARAMETER);
        }

        if signum == self.signum {
            // Same-signum restart: swap the delivery parameters in place —
            // the watcher never leaves the registry, so there is no window
            // where a concurrent dispatch misses it. The mode flags flip
            // under the registry lock the dispatcher reads them under.
            // // quirk: SIGEV-12
            {
                let _reg = lock_registry();
                self.one_shot.store(one_shot, Ordering::Release);
                self.one_shot_dispatched.store(false, Ordering::Release);
            }
            self.cb = Some(cb);
            self.data = data;
            self.generation = self.generation.wrapping_add(1);
            return Ok(());
        }

        if self.signum != 0 {
            // Infallible by design: teardown is a pure registry op.
            // // quirk: SIGEV-15
            self.stop();
        }

        self.cb = Some(cb);
        self.data = data;
        self.signum = signum;
        self.generation = self.generation.wrapping_add(1);
        {
            let mut reg = lock_registry();
            self.one_shot.store(one_shot, Ordering::Release);
            self.one_shot_dispatched.store(false, Ordering::Release);
            reg.push(RegEntry {
                signum,
                handle: ptr::from_mut(self).expose_provenance(),
            });
        }
        self.core.start();
        Ok(())
    }

    /// Stop watching, synchronously and infallibly: a pure registry removal
    /// (the process-wide ctrl handler is never unhooked). An in-flight
    /// completion is swallowed at its drain via the signum re-check. One-
    /// shot state resets with the registration (deviation: libuv's Windows
    /// backend leaves it sticky, so a restarted watcher never fires again;
    /// its Unix backend clears it — we follow Unix). // quirk: SIGEV-15,
    /// SIGEV-11, SIGEV-13
    pub fn stop(&mut self) {
        if self.signum == 0 {
            return;
        }
        {
            let mut reg = lock_registry();
            let me = ptr::from_mut(self).expose_provenance();
            let i = reg.iter().position(|e| e.handle == me);
            debug_assert!(i.is_some(), "started watcher missing from registry");
            if let Some(i) = i {
                reg.swap_remove(i);
            }
            self.one_shot.store(false, Ordering::Release);
            self.one_shot_dispatched.store(false, Ordering::Release);
        }
        self.signum = 0;
        self.core.stop();
    }

    /// Begin the asynchronous close. The watcher is stopped (no new posts);
    /// a posted-but-undrained completion defers the endgame until it
    /// arrives — the packet references this handle's memory. `cb` runs from
    /// the loop once drained; only then may the owner free the box. No
    /// signal callback fires after close. // quirk: SIGEV-14, LOOP-25
    pub fn close(&mut self, cb: Option<SignalCloseCb>, data: *mut c_void) {
        self.stop();
        self.close_cb = cb;
        self.close_data = data;
        // After stop() the dispatcher can no longer touch pending_signum
        // (the entry is gone; removal and dispatch serialize on the registry
        // lock), so this load is stable: nonzero means exactly one packet is
        // still queued for this loop. Count it so the endgame waits.
        // // quirk: SIGEV-14
        if self.pending_signum.load(Ordering::Acquire) != 0 {
            debug_assert!(!self.close_counted_inflight);
            self.close_counted_inflight = true;
            self.core.req_submitted_uncounted();
        }
        self.core.close();
    }
}

// ── process-global dispatch ─────────────────────────────────────────────────

/// Dispatch `signum` to every active watcher in every loop; returns whether
/// any watcher consumed it (the ctrl handler's TRUE/FALSE — with no watcher
/// the default action proceeds and the process dies, the POSIX-default
/// emulation Node's "exit on Ctrl-C unless a listener exists" rides on).
///
/// Safe to call from any thread — including OS-injected ctrl-handler
/// threads: only the registry lock, per-handle atomics, and a completion
/// post happen here. Also the synthetic-injection entry: tty's resize
/// detection feeds SIGWINCH through it, and watchers can't tell synthetic
/// from real. // quirk: SIGEV-02, SIGEV-04, SIGEV-09, SIGEV-16
pub fn dispatch_signal(signum: i32) -> bool {
    let reg = lock_registry();
    let mut dispatched = false;
    for entry in reg.iter() {
        if entry.signum != signum {
            continue;
        }
        let h: *mut SignalHandle = ptr::with_exposed_provenance_mut(entry.handle);
        // SAFETY: entries are inserted by start() and removed by stop()
        // under this lock, and a started handle is heap-pinned until close
        // (which stops first) — so `h` is live. Only atomics, the immutable
        // `iocp` handle, and the embedded req's *address* are touched; no
        // reference is formed. // quirk: SIGEV-02
        unsafe {
            // A dispatched one-shot stays suppressed until processed —
            // checked BEFORE the pending swap so `pending_signum != 0`
            // always means a completion is in flight (libuv swaps first,
            // which can strand close() waiting on a never-posted packet
            // when the signal repeats during the one-shot's own callback).
            // A suppressed one-shot does not count as dispatched (libuv
            // parity): a second Ctrl-C past a consumed `once` watcher takes
            // the default action. // quirk: SIGEV-13, SIGEV-14
            if (*h).one_shot_dispatched.load(Ordering::Acquire) {
                continue;
            }
            let prev = (*h).pending_signum.swap(signum, Ordering::AcqRel);
            if prev == 0 {
                // First arrival since the last drain: post the embedded
                // token. Bursts coalesce; exactly one completion is ever in
                // flight per watcher. A failed post would silently drop the
                // signal AND wedge the close gate — die loudly.
                // // quirk: SIGEV-10, SIGEV-19
                let overlapped = (&raw mut (*h).req).cast::<OVERLAPPED>();
                crate::event_loop::post_or_die((*h).iocp, 0, 0, overlapped, "signal");
            }
            dispatched = true;
            if (*h).one_shot.load(Ordering::Acquire) {
                (*h).one_shot_dispatched.store(true, Ordering::Release);
            }
        }
    }
    dispatched
}

// ── completion processing (loop side) ───────────────────────────────────────

/// Single delivery path for signal completions.
pub(crate) fn process_signal_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let h = req.data().cast::<SignalHandle>();
    // SAFETY: `data` was set at creation to the heap-pinned SignalHandle,
    // kept alive until close (endgame protocol); access is raw-pointer only
    // and no borrow is held across the user callback.
    unsafe {
        if mem::replace(&mut (*h).close_counted_inflight, false) {
            // close() counted this in-flight packet; its drain unblocks the
            // endgame. // quirk: SIGEV-14
            (*h).core.req_completed_uncounted();
        }
        let dispatched = (*h).pending_signum.swap(0, Ordering::AcqRel);
        debug_assert!(
            dispatched != 0,
            "signal completion without a pending signum"
        );

        if (*h).core.is_closing() {
            // Close contract: no callback after close; the drain above only
            // unblocked the endgame.
            return;
        }
        // Stop or stop+restart while the completion was in flight desyncs
        // the dispatched signum from the watched one: deliver only on
        // match, silently swallow otherwise. // quirk: SIGEV-11
        if dispatched != (*h).signum {
            return;
        }

        let auto_stop = (*h).one_shot.load(Ordering::Acquire);
        let generation = (*h).generation;
        if let Some(cb) = (*h).cb {
            cb(&mut *lp, (*h).data, dispatched);
        }
        // One-shot delivered: stop — unless the callback already stopped,
        // closed, or restarted the watcher (the generation re-check; a
        // restart owns a fresh registration this delivery must not kill).
        // // quirk: SIGEV-13
        if auto_stop && !(*h).core.is_closing() && (*h).generation == generation {
            (*h).stop();
        }
    }
}

/// All requests drained: fire the close callback; the owner frees the box.
unsafe fn signal_endgame(core: *mut HandleCore) {
    // SAFETY: the endgame drain passes the live, queued handle; `core` is
    // the first field of the #[repr(C)] SignalHandle.
    unsafe {
        let h = core.cast::<SignalHandle>();
        debug_assert_eq!((*h).signum, 0);
        debug_assert_eq!((*h).pending_signum.load(Ordering::Acquire), 0);
        debug_assert!(!(*h).close_counted_inflight);
        let lp = (*h).core.loop_;
        let data = (*h).close_data;
        if let Some(cb) = (*h).close_cb.take() {
            cb(&mut *lp, data);
        }
    }
}

// ── console ctrl handler ────────────────────────────────────────────────────

/// What the ctrl handler does after (maybe) dispatching. The TRUE/FALSE
/// return drives Windows' handler chain: FALSE reaches the default handler,
/// which calls ExitProcess — the POSIX "default action" emulation.
/// // quirk: SIGEV-04
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum CtrlOutcome {
    /// Return TRUE: a watcher consumed the signal; the process lives.
    Handled,
    /// Return FALSE: pass to the next/default handler.
    Chain,
    /// CTRL_CLOSE with a SIGHUP watcher: wedge this handler thread forever —
    /// the OS kills the process the moment the handler returns, and the
    /// (~5 s, system-controlled) grace window exists only while it is still
    /// running. The loop uses that window to run SIGHUP callbacks.
    /// // quirk: SIGEV-05
    BlockForever,
}

/// The pure decision table, separated from the extern handler so the
/// mapping and return-value coupling are unit-testable with an injected
/// dispatcher. `dispatch` is invoked at most once, and never for
/// CTRL_LOGOFF/CTRL_SHUTDOWN — those are deliberately unmapped (session
/// teardown kills the process regardless; no useful grace semantics exist),
/// as are unknown event types. // quirk: SIGEV-03, SIGEV-06
fn ctrl_decision(ctrl_type: DWORD, mut dispatch: impl FnMut(i32) -> bool) -> CtrlOutcome {
    match ctrl_type {
        CTRL_C_EVENT => {
            if dispatch(SIGINT) {
                CtrlOutcome::Handled
            } else {
                CtrlOutcome::Chain
            }
        }
        CTRL_BREAK_EVENT => {
            if dispatch(SIGBREAK) {
                CtrlOutcome::Handled
            } else {
                CtrlOutcome::Chain
            }
        }
        CTRL_CLOSE_EVENT => {
            if dispatch(SIGHUP) {
                CtrlOutcome::BlockForever
            } else {
                CtrlOutcome::Chain
            }
        }
        _ => CtrlOutcome::Chain,
    }
}

/// Runs on an OS-injected thread for each console event; multiple events
/// run handlers concurrently. Handlers registered later by the embedder run
/// BEFORE this one (the chain is LIFO). // quirk: SIGEV-02, SIGEV-03
unsafe extern "system" fn console_ctrl_handler(ctrl_type: DWORD) -> BOOL {
    match ctrl_decision(ctrl_type, dispatch_signal) {
        CtrlOutcome::Handled => TRUE,
        CtrlOutcome::Chain => FALSE,
        CtrlOutcome::BlockForever => {
            Sleep(INFINITE);
            TRUE // unreachable by design // quirk: SIGEV-05
        }
    }
}

// ── process-wide init ───────────────────────────────────────────────────────

/// The tty resize callback: synthesizes SIGWINCH through the watcher
/// registry — the one resize mechanism (tty detects, signal fans out).
/// Thread-safe per the TtyResizeCb contract: dispatch only takes the
/// registry lock + atomics + a completion post. // quirk: SIGEV-16, TTY-52
unsafe fn sigwinch_bridge() {
    dispatch_signal(SIGWINCH);
}

/// Process-wide signal initialization, idempotent; runs from
/// [`process_init`](crate::init::process_init) (first loop creation).
/// Registers the console ctrl handler exactly once — failure is fatal, like
/// libuv's `abort()`: the process could not honor its documented signal
/// semantics — and never unregisters it (watcher add/remove are pure
/// registry ops; unhooking can deadlock against a running handler thread).
/// // quirk: SIGEV-01, SIGEV-15, SIGEV-17
pub(crate) fn signals_init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let ok = SetConsoleCtrlHandler(Some(console_ctrl_handler), TRUE);
        assert!(ok != 0, "SetConsoleCtrlHandler: {:?}", Win32Error::get());
        // Console resizes ARE SIGWINCH: route tty's resize detection through
        // the same dispatch fan-out. The startup size snapshot in
        // console_init suppresses a spurious first delivery. // quirk: SIGEV-16
        crate::tty::set_resize_callback(Some(sigwinch_bridge));
    });
}

#[cfg(test)]
mod tests {
    use std::io::Write as _;

    use bun_windows_sys::kernel32::GetConsoleScreenBufferInfo;
    use bun_windows_sys::{
        AllocConsole, CONSOLE_SCREEN_BUFFER_INFO, COORD, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT,
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, FlushConsoleInputBuffer, GENERIC_READ,
        GENERIC_WRITE, INVALID_HANDLE_VALUE, OPEN_EXISTING, SMALL_RECT,
    };

    use super::*;
    use crate::process::{SIGKILL, SIGQUIT, SIGTERM};
    use crate::test_sync::serial;
    use crate::tty::{TtyHandle, TtyMode, TtyReadData, console_init};

    // Console APIs needed only by the fixtures (kept out of the production
    // extern surface). // quirk: SIGEV-21
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GenerateConsoleCtrlEvent(dwCtrlEvent: DWORD, dwProcessGroupId: DWORD) -> BOOL;
        fn SetConsoleScreenBufferSize(hConsoleOutput: HANDLE, dwSize: COORD) -> BOOL;
    }

    /// `ExitProcess` code the DEFAULT ctrl handler kills with — the observable
    /// proof that our handler returned FALSE and chained. // quirk: SIGEV-04
    const STATUS_CONTROL_C_EXIT: i32 = 0xC000_013Au32 as i32;

    // ── recording context + scripted in-callback actions ──────────────────

    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    enum Action {
        None,
        /// Stop the sibling watcher from inside the callback.
        StopSibling,
        /// Close the own handle from inside the callback.
        CloseSelf,
        /// Call dispatch_signal from inside the callback, recording its
        /// return.
        DispatchSelf(i32),
        /// Restart the own handle on the same signum, repeating (the
        /// short-circuit path).
        RestartSelfRepeating(i32),
        /// Full stop + start on the given signum, repeating.
        StopThenStartRepeating(i32),
    }

    struct Ctx {
        fired: Vec<i32>,
        closed: u32,
        in_cb_dispatch: Vec<bool>,
        handle: *mut SignalHandle,
        sibling: *mut SignalHandle,
        action: Action,
    }

    impl Ctx {
        fn new() -> Ctx {
            Ctx {
                fired: Vec::new(),
                closed: 0,
                in_cb_dispatch: Vec::new(),
                handle: ptr::null_mut(),
                sibling: ptr::null_mut(),
                action: Action::None,
            }
        }
    }

    unsafe fn on_signal(_l: &mut Loop, d: *mut c_void, signum: i32) {
        // SAFETY: `d` is the test Ctx; `handle`/`sibling` are live boxed
        // watchers whenever a scripted action references them.
        unsafe {
            let ctx = &mut *d.cast::<Ctx>();
            ctx.fired.push(signum);
            match mem::replace(&mut ctx.action, Action::None) {
                Action::None => {}
                Action::StopSibling => (*ctx.sibling).stop(),
                Action::CloseSelf => (*ctx.handle).close(Some(on_close), d),
                Action::DispatchSelf(s) => ctx.in_cb_dispatch.push(dispatch_signal(s)),
                Action::RestartSelfRepeating(s) => {
                    (*ctx.handle).start(s, false, on_signal, d).unwrap();
                }
                Action::StopThenStartRepeating(s) => {
                    (*ctx.handle).stop();
                    (*ctx.handle).start(s, false, on_signal, d).unwrap();
                }
            }
        }
    }

    unsafe fn on_close(_l: &mut Loop, d: *mut c_void) {
        // SAFETY: `d` is the test Ctx.
        unsafe {
            (*d.cast::<Ctx>()).closed += 1;
        }
    }

    /// Tick until `cond` or the deadline; assertions live at the call site.
    fn tick_until(loop_: &mut Loop, ms: u64, mut cond: impl FnMut() -> bool) {
        let deadline = loop_.now_ms() + ms;
        while !cond() && loop_.now_ms() < deadline {
            loop_.tick(Some(25));
        }
    }

    fn close_and_drain(loop_: &mut Loop, h: &mut SignalHandle, ctx_ptr: *mut Ctx) {
        // SAFETY: ctx outlives the drain (caller owns it on the stack).
        let before = unsafe { (*ctx_ptr).closed };
        h.close(Some(on_close), ctx_ptr.cast());
        // SAFETY: same.
        tick_until(loop_, 5_000, || unsafe { (*ctx_ptr).closed > before });
    }

    // ── unit tests (injected dispatch; no real console events) ────────────

    /// One signal-number table: the receive-side values, the shared NSIG
    /// limit, range rejection, and the silent acceptance of unraisable
    /// signums (SIGTERM/SIGKILL watchers register and never fire — incl.
    /// the deliberate SIGKILL asymmetry vs Unix). // quirk: SIGEV-07, SIGEV-08
    #[test]
    fn signal_table_and_validation() {
        let _guard = serial();
        assert_eq!(SIGHUP, 1);
        assert_eq!(SIGINT, 2);
        assert_eq!(SIGBREAK, 21);
        assert_eq!(SIGWINCH, 28);
        assert_eq!(NSIG, 29);

        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();

        for bad in [0, -3, NSIG, 100] {
            // SAFETY: ctx outlives the watcher.
            let err = unsafe { w.start(bad, false, on_signal, d) }.unwrap_err();
            assert_eq!(err, Win32Error::INVALID_PARAMETER, "signum {bad}");
        }
        assert!(!w.is_started());

        // Unraisable signums register silently; stop is infallible and
        // idempotent.
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGTERM, false, on_signal, d) }.unwrap();
        assert!(w.is_started());
        assert_eq!(w.signum(), SIGTERM);
        w.stop();
        w.stop();
        assert!(!w.is_started());
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGKILL, false, on_signal, d) }.unwrap();
        w.stop();

        close_and_drain(&mut loop_, &mut w, &raw mut ctx);
        // SAFETY: ctx outlives the watcher.
        let err = unsafe { w.start(SIGINT, false, on_signal, d) }.unwrap_err();
        assert_eq!(err, Win32Error::INVALID_HANDLE, "start after close");
        assert_eq!(ctx.fired, Vec::<i32>::new());
        assert_eq!(ctx.closed, 1);
        assert!(!loop_.alive());
    }

    /// The complete ctrl-event decision table with an injected dispatcher:
    /// event→signum mapping, the dispatched↔return coupling, the CTRL_CLOSE
    /// grace wedge, and that LOGOFF/SHUTDOWN/unknown NEVER reach dispatch.
    /// // quirk: SIGEV-03, SIGEV-04, SIGEV-05, SIGEV-06
    #[test]
    fn ctrl_decision_table() {
        fn run(ty: DWORD, handled: bool) -> (CtrlOutcome, Vec<i32>) {
            let mut seen = Vec::new();
            let outcome = ctrl_decision(ty, |s| {
                seen.push(s);
                handled
            });
            (outcome, seen)
        }

        assert_eq!(
            run(CTRL_C_EVENT, true),
            (CtrlOutcome::Handled, vec![SIGINT])
        );
        assert_eq!(run(CTRL_C_EVENT, false), (CtrlOutcome::Chain, vec![SIGINT]));
        assert_eq!(
            run(CTRL_BREAK_EVENT, true),
            (CtrlOutcome::Handled, vec![SIGBREAK])
        );
        assert_eq!(
            run(CTRL_BREAK_EVENT, false),
            (CtrlOutcome::Chain, vec![SIGBREAK])
        );
        assert_eq!(
            run(CTRL_CLOSE_EVENT, true),
            (CtrlOutcome::BlockForever, vec![SIGHUP])
        );
        assert_eq!(
            run(CTRL_CLOSE_EVENT, false),
            (CtrlOutcome::Chain, vec![SIGHUP])
        );
        // Deliberately unmapped: no dispatch call at all. // quirk: SIGEV-06
        assert_eq!(run(CTRL_LOGOFF_EVENT, true), (CtrlOutcome::Chain, vec![]));
        assert_eq!(run(CTRL_SHUTDOWN_EVENT, true), (CtrlOutcome::Chain, vec![]));
        assert_eq!(run(99, true), (CtrlOutcome::Chain, vec![]));
    }

    /// One dispatch fans out to every watcher of that signum across ALL
    /// loops; other signums stay quiet; the return value reports whether
    /// anyone consumed it. // quirk: SIGEV-09, SIGEV-04
    #[test]
    fn dispatch_fans_out_across_loops_and_signums() {
        let _guard = serial();
        let mut loop_a = Loop::new().unwrap();
        let mut loop_b = Loop::new().unwrap();
        let lpa: *mut Loop = &raw mut *loop_a;
        let lpb: *mut Loop = &raw mut *loop_b;

        // SAFETY: loops outlive the watchers (all three blocks).
        let mut w1 = unsafe { SignalHandle::new(lpa) };
        // SAFETY: as above.
        let mut w2 = unsafe { SignalHandle::new(lpb) };
        // SAFETY: as above.
        let mut w3 = unsafe { SignalHandle::new(lpa) };
        let mut c1 = Ctx::new();
        let mut c2 = Ctx::new();
        let mut c3 = Ctx::new();
        // SAFETY: ctxs outlive the watchers.
        unsafe {
            w1.start(SIGINT, false, on_signal, (&raw mut c1).cast())
                .unwrap();
            w2.start(SIGINT, false, on_signal, (&raw mut c2).cast())
                .unwrap();
            w3.start(SIGBREAK, false, on_signal, (&raw mut c3).cast())
                .unwrap();
        }

        assert!(dispatch_signal(SIGINT), "two watchers consume SIGINT");
        assert!(!dispatch_signal(SIGQUIT), "no SIGQUIT watcher anywhere");

        tick_until(&mut loop_a, 5_000, || !c1.fired.is_empty());
        tick_until(&mut loop_b, 5_000, || !c2.fired.is_empty());
        assert_eq!(c1.fired, vec![SIGINT]);
        assert_eq!(c2.fired, vec![SIGINT]);
        assert_eq!(c3.fired, Vec::<i32>::new(), "SIGBREAK watcher quiet");

        close_and_drain(&mut loop_a, &mut w1, &raw mut c1);
        close_and_drain(&mut loop_b, &mut w2, &raw mut c2);
        close_and_drain(&mut loop_a, &mut w3, &raw mut c3);
        assert!(!loop_a.alive());
        assert!(!loop_b.alive());
    }

    /// A burst before the loop runs coalesces into ONE callback (exactly one
    /// completion in flight per watcher); the next arrival after the drain
    /// posts fresh. // quirk: SIGEV-10
    #[test]
    fn burst_coalesces_to_one_completion() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ctx = Ctx::new();
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGINT, false, on_signal, (&raw mut ctx).cast()) }.unwrap();

        assert!(dispatch_signal(SIGINT));
        assert!(dispatch_signal(SIGINT));
        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || !ctx.fired.is_empty());
        // Bounded settle: prove no SECOND callback arrives for the burst.
        for _ in 0..10 {
            loop_.tick(Some(10));
        }
        assert_eq!(ctx.fired, vec![SIGINT], "burst coalesced");

        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || ctx.fired.len() >= 2);
        assert_eq!(ctx.fired, vec![SIGINT, SIGINT], "re-armed after drain");

        close_and_drain(&mut loop_, &mut w, &raw mut ctx);
        assert!(!loop_.alive());
    }

    /// One-shot: a single delivery auto-stops the watcher; a dispatch from
    /// INSIDE its own callback is suppressed (and not counted as handled —
    /// the second Ctrl-C past a consumed `once` takes the default action),
    /// and the close protocol still drains cleanly afterwards — the
    /// pending⟺in-flight invariant the check-before-swap order preserves.
    /// // quirk: SIGEV-13, SIGEV-14, SIGEV-04
    #[test]
    fn one_shot_delivers_once_then_parks() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *w;
        ctx.action = Action::DispatchSelf(SIGINT);
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGINT, true, on_signal, (&raw mut ctx).cast()) }.unwrap();

        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || !ctx.fired.is_empty());
        for _ in 0..10 {
            loop_.tick(Some(10));
        }
        assert_eq!(ctx.fired, vec![SIGINT], "one-shot fired exactly once");
        assert_eq!(
            ctx.in_cb_dispatch,
            vec![false],
            "in-callback repeat is suppressed and unconsumed"
        );
        assert!(!w.is_started(), "one-shot auto-stopped");
        assert!(!dispatch_signal(SIGINT), "registry empty after auto-stop");

        close_and_drain(&mut loop_, &mut w, &raw mut ctx);
        assert_eq!(ctx.closed, 1, "close drains despite the in-cb dispatch");
        assert!(!loop_.alive());
    }

    /// Same-signum restart short-circuits: callback/data/mode swap with the
    /// watcher never leaving the registry (no lost-signal window), including
    /// flipping repeating → one-shot. // quirk: SIGEV-12
    #[test]
    fn restart_same_signum_swaps_callback_without_stop_window() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ca = Ctx::new();
        let mut cb_ = Ctx::new();
        // SAFETY: ctxs outlive the watcher.
        unsafe {
            w.start(SIGINT, false, on_signal, (&raw mut ca).cast())
                .unwrap();
            w.start(SIGINT, false, on_signal, (&raw mut cb_).cast())
                .unwrap();
        }
        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || !cb_.fired.is_empty());
        assert_eq!(ca.fired, Vec::<i32>::new(), "old delivery target replaced");
        assert_eq!(cb_.fired, vec![SIGINT]);

        // Flip to one-shot via the same short-circuit (deviation: libuv
        // swaps only the callback).
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGINT, true, on_signal, (&raw mut cb_).cast()) }.unwrap();
        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || cb_.fired.len() >= 2);
        assert_eq!(cb_.fired, vec![SIGINT, SIGINT]);
        assert!(!w.is_started(), "now one-shot: parked after delivery");

        close_and_drain(&mut loop_, &mut w, &raw mut cb_);
        assert!(!loop_.alive());
    }

    /// Stop (or stop+restart on another signum) while a completion is in
    /// flight: the stale packet is swallowed by the signum re-check, and the
    /// new registration delivers normally. // quirk: SIGEV-11
    #[test]
    fn stale_completion_after_restart_swallowed() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ctx = Ctx::new();
        let d: *mut c_void = (&raw mut ctx).cast();
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGINT, false, on_signal, d) }.unwrap();

        assert!(dispatch_signal(SIGINT)); // packet in flight, not yet drained
        w.stop();
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGBREAK, false, on_signal, d) }.unwrap();

        for _ in 0..10 {
            loop_.tick(Some(10));
        }
        assert_eq!(ctx.fired, Vec::<i32>::new(), "stale SIGINT swallowed");

        assert!(dispatch_signal(SIGBREAK));
        tick_until(&mut loop_, 5_000, || !ctx.fired.is_empty());
        assert_eq!(ctx.fired, vec![SIGBREAK]);

        close_and_drain(&mut loop_, &mut w, &raw mut ctx);
        assert!(!loop_.alive());
    }

    /// Two watchers on one signum, one loop: the first callback stops the
    /// second watcher mid-dispatch — its already-posted completion is
    /// swallowed, and later dispatches no longer reach it (the in-callback-
    /// stop discipline). // quirk: SIGEV-09, SIGEV-11
    #[test]
    fn stop_from_sibling_callback_suppresses_pending_delivery() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watchers (both blocks).
        let mut w1 = unsafe { SignalHandle::new(lp) };
        // SAFETY: as above.
        let mut w2 = unsafe { SignalHandle::new(lp) };
        let mut c1 = Ctx::new();
        let mut c2 = Ctx::new();
        c1.sibling = &raw mut *w2;
        c1.action = Action::StopSibling;
        // Registration order = post order = single-consumer dequeue order:
        // w1's callback runs before w2's packet dispatches. // quirk: ADD-03
        // SAFETY: ctxs outlive the watchers.
        unsafe {
            w1.start(SIGINT, false, on_signal, (&raw mut c1).cast())
                .unwrap();
            w2.start(SIGINT, false, on_signal, (&raw mut c2).cast())
                .unwrap();
        }

        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || !c1.fired.is_empty());
        for _ in 0..10 {
            loop_.tick(Some(10));
        }
        assert_eq!(c1.fired, vec![SIGINT]);
        assert_eq!(
            c2.fired,
            Vec::<i32>::new(),
            "stopped sibling's posted packet swallowed"
        );
        assert!(!w2.is_started());

        assert!(dispatch_signal(SIGINT), "w1 still consumes");
        tick_until(&mut loop_, 5_000, || c1.fired.len() >= 2);
        assert_eq!(c1.fired, vec![SIGINT, SIGINT]);
        assert_eq!(c2.fired, Vec::<i32>::new(), "removed from the registry");

        close_and_drain(&mut loop_, &mut w1, &raw mut c1);
        close_and_drain(&mut loop_, &mut w2, &raw mut c2);
        assert!(!loop_.alive());
    }

    /// Liveness accounting: an unref'd watcher never holds the loop open; a
    /// close (even from inside the watcher's own callback) holds it until
    /// the endgame, then releases. // quirk: LOOP-27
    #[test]
    fn unref_close_in_callback_and_liveness() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *w;
        ctx.action = Action::CloseSelf;
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGINT, false, on_signal, (&raw mut ctx).cast()) }.unwrap();

        assert!(loop_.alive(), "started+ref'd watcher holds the loop");
        w.unref();
        assert!(!loop_.alive(), "unref'd watcher does not hold the loop");
        w.ref_();
        assert!(loop_.alive());
        w.unref();

        // Close from inside the callback: delivery still completes, the
        // close keep-alive holds the loop until the endgame drains.
        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || ctx.closed > 0);
        assert_eq!(ctx.fired, vec![SIGINT]);
        assert_eq!(ctx.closed, 1);
        assert!(!loop_.alive());
        assert!(!dispatch_signal(SIGINT), "closed watcher unreachable");
    }

    /// Close with a posted-but-undrained completion: the endgame is DEFERRED
    /// until the packet drains (it references handle memory), no signal
    /// callback fires after close, and the loop quiesces. // quirk: SIGEV-14
    #[test]
    fn close_with_inflight_completion_defers_endgame() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ctx = Ctx::new();
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGINT, false, on_signal, (&raw mut ctx).cast()) }.unwrap();

        assert!(dispatch_signal(SIGINT)); // packet posted, not drained
        w.close(Some(on_close), (&raw mut ctx).cast());
        assert!(loop_.alive(), "closing handle keeps the loop alive");
        loop_.process_endgames();
        assert_eq!(
            ctx.closed, 0,
            "endgame deferred behind the in-flight packet"
        );

        tick_until(&mut loop_, 5_000, || ctx.closed > 0);
        assert_eq!(ctx.fired, Vec::<i32>::new(), "no callback after close");
        assert_eq!(ctx.closed, 1);
        assert!(!loop_.alive());
    }

    /// A callback that restarts its own watcher owns the new registration:
    /// the one-shot auto-stop must not kill it (generation re-check), for
    /// both the short-circuit restart and a full stop+start on another
    /// signum — where stop also resets the one-shot latch (libuv-win leaves
    /// it sticky and the watcher never fires again). // quirk: SIGEV-13
    #[test]
    fn restart_in_callback_not_auto_stopped() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &raw mut *loop_;

        // Phase 1: one-shot whose callback short-circuit-restarts itself as
        // repeating on the SAME signum.
        // SAFETY: loop outlives the watcher.
        let mut w = unsafe { SignalHandle::new(lp) };
        let mut ctx = Ctx::new();
        ctx.handle = &raw mut *w;
        ctx.action = Action::RestartSelfRepeating(SIGINT);
        // SAFETY: ctx outlives the watcher.
        unsafe { w.start(SIGINT, true, on_signal, (&raw mut ctx).cast()) }.unwrap();
        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || !ctx.fired.is_empty());
        assert!(w.is_started(), "in-callback restart survives the auto-stop");
        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || ctx.fired.len() >= 2);
        assert_eq!(ctx.fired, vec![SIGINT, SIGINT], "repeating after restart");
        close_and_drain(&mut loop_, &mut w, &raw mut ctx);

        // Phase 2: one-shot whose callback fully stops then starts on a
        // DIFFERENT signum.
        // SAFETY: the loop outlives this watcher too.
        let mut w2 = unsafe { SignalHandle::new(lp) };
        let mut ctx2 = Ctx::new();
        ctx2.handle = &raw mut *w2;
        ctx2.action = Action::StopThenStartRepeating(SIGBREAK);
        // SAFETY: ctx outlives the watcher.
        unsafe { w2.start(SIGINT, true, on_signal, (&raw mut ctx2).cast()) }.unwrap();
        assert!(dispatch_signal(SIGINT));
        tick_until(&mut loop_, 5_000, || !ctx2.fired.is_empty());
        assert!(w2.is_started());
        assert_eq!(w2.signum(), SIGBREAK);
        assert!(dispatch_signal(SIGBREAK), "fresh registration dispatches");
        tick_until(&mut loop_, 5_000, || ctx2.fired.len() >= 2);
        assert_eq!(ctx2.fired, vec![SIGINT, SIGBREAK]);
        close_and_drain(&mut loop_, &mut w2, &raw mut ctx2);
        assert!(!loop_.alive());
    }

    // ───────────────── real-console fixtures (children) ────────────────────

    fn wz(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(core::iter::once(0)).collect()
    }

    /// Open a console device, falling back to AllocConsole for exotic
    /// runners; the parent spawns us with CREATE_NEW_CONSOLE so this console
    /// is fresh and ISOLATED — ctrl events generated here reach no other
    /// process, never the test runner.
    fn open_console_device(name: &str) -> HANDLE {
        let n = wz(name);
        // SAFETY: NUL-terminated name; handles owned by the fixture for the
        // process lifetime.
        let mut h = unsafe {
            CreateFileW(
                n.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        if h == INVALID_HANDLE_VALUE {
            AllocConsole();
            // SAFETY: as above.
            h = unsafe {
                CreateFileW(
                    n.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    ptr::null_mut(),
                    OPEN_EXISTING,
                    0,
                    ptr::null_mut(),
                )
            };
        }
        h
    }

    fn sig_report(failures: &mut Vec<String>, name: &str, ok: bool, detail: &str) {
        // Direct stdout writes bypass libtest capture, reaching the parent's
        // pipe deterministically.
        let mut out = std::io::stdout().lock();
        if ok {
            let _ = writeln!(out, "SIGFIX OK {name}");
        } else {
            let _ = writeln!(out, "SIGFIX FAIL {name}: {detail}");
            failures.push(format!("{name}: {detail}"));
        }
        let _ = out.flush();
    }

    unsafe fn fix_on_tty_read(
        _l: &mut Loop,
        _d: *mut c_void,
        _data: TtyReadData,
        _err: Win32Error,
    ) {
    }

    unsafe fn fix_on_tty_close(_l: &mut Loop, d: *mut c_void) {
        // SAFETY: `d` is the fixture's close counter.
        unsafe {
            *d.cast::<u32>() += 1;
        }
    }

    const PHASE_MS: u64 = 20_000;

    /// Real-console suite: registration through delivery with REAL ctrl
    /// events, plus SIGWINCH end-to-end through tty's resize detection. Runs
    /// in a CREATE_NEW_CONSOLE child spawned by `console_ctrl_fixture_suite`;
    /// every check emits an explicit SIGFIX marker the parent asserts on.
    /// // quirk: SIGEV-01, SIGEV-02, SIGEV-03, SIGEV-04, SIGEV-16
    #[test]
    #[ignore = "console fixture: executed in a CREATE_NEW_CONSOLE child by console_ctrl_fixture_suite"]
    fn ctrl_fixture() {
        let mut failures: Vec<String> = Vec::new();
        macro_rules! check {
            ($name:expr, $cond:expr) => {
                sig_report(&mut failures, $name, $cond, &format!("at line {}", line!()))
            };
            ($name:expr, $cond:expr, $detail:expr) => {
                sig_report(&mut failures, $name, $cond, &$detail)
            };
        }

        // CREATE_NEW_PROCESS_GROUP ancestry can leave Ctrl-C IGNORED
        // (implicit SetConsoleCtrlHandler(NULL, TRUE)); clear the flag so
        // delivery is unconditional.
        SetConsoleCtrlHandler(None, FALSE);

        let conout = open_console_device("CONOUT$");
        let conin = open_console_device("CONIN$");
        check!(
            "console-available",
            conout != INVALID_HANDLE_VALUE && conin != INVALID_HANDLE_VALUE
        );
        assert!(
            failures.is_empty(),
            "no console in fixture child: {failures:?}"
        );

        let mut loop_ = Loop::new().unwrap(); // registers the ctrl handler + SIGWINCH bridge
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watchers (both blocks).
        let mut wint = unsafe { SignalHandle::new(lp) };
        // SAFETY: as above.
        let mut wbrk = unsafe { SignalHandle::new(lp) };
        let mut cint = Ctx::new();
        let mut cbrk = Ctx::new();
        // SAFETY: ctxs outlive the watchers.
        unsafe {
            wint.start(SIGINT, false, on_signal, (&raw mut cint).cast())
                .unwrap();
            wbrk.start(SIGBREAK, false, on_signal, (&raw mut cbrk).cast())
                .unwrap();
        }

        // 1. Real CTRL_C: group id 0 = every process on THIS console (only
        //    us — the console is fresh).
        // SAFETY: by-value arguments.
        let ok = unsafe { GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) };
        check!(
            "generate-ctrl-c",
            ok != 0,
            format!("{:?}", Win32Error::get())
        );
        tick_until(&mut loop_, PHASE_MS, || !cint.fired.is_empty());
        check!(
            "ctrl-c-delivered",
            cint.fired.first() == Some(&SIGINT),
            format!("{:?}", cint.fired)
        );
        check!(
            "ctrl-c-only-sigint",
            cbrk.fired.is_empty(),
            format!("{:?}", cbrk.fired)
        );

        // 2. Real CTRL_BREAK → SIGBREAK.
        // SAFETY: by-value arguments.
        let ok = unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, 0) };
        check!(
            "generate-ctrl-break",
            ok != 0,
            format!("{:?}", Win32Error::get())
        );
        tick_until(&mut loop_, PHASE_MS, || !cbrk.fired.is_empty());
        check!(
            "ctrl-break-delivered",
            cbrk.fired.first() == Some(&SIGBREAK),
            format!("{:?}", cbrk.fired)
        );

        // 3. Still running ⇒ the handler returned TRUE for consumed events
        //    (default termination never ran). // quirk: SIGEV-04
        check!("survived-handled-events", true);

        // 4. SIGWINCH end-to-end: tty raw read drains the real
        //    WINDOW_BUFFER_SIZE record posted by the buffer resize, the
        //    resize callback (the bridge) synthesizes SIGWINCH, the watcher
        //    fires. // quirk: SIGEV-16
        console_init();
        // SAFETY: live console input handle (clean slate for the raw read).
        unsafe { FlushConsoleInputBuffer(conin) };
        // SAFETY: loop outlives the watcher.
        let mut wwin = unsafe { SignalHandle::new(lp) };
        let mut cwin = Ctx::new();
        // SAFETY: ctx outlives the watcher.
        unsafe {
            wwin.start(SIGWINCH, false, on_signal, (&raw mut cwin).cast())
                .unwrap();
        }
        // SAFETY: conin is a live console input handle owned by the fixture.
        let mut tty = unsafe { TtyHandle::open(lp, conin) }.expect("tty open");
        tty.set_mode(TtyMode::Raw).expect("raw mode");
        let mut rbuf = [0u8; 64];
        let mut tty_closed: u32 = 0;
        // SAFETY: rbuf and the ctx outlive the read.
        unsafe {
            tty.read_start(
                rbuf.as_mut_ptr(),
                rbuf.len(),
                fix_on_tty_read,
                ptr::null_mut(),
            )
        }
        .expect("read_start");

        let mut info = CONSOLE_SCREEN_BUFFER_INFO {
            dwSize: COORD { X: 0, Y: 0 },
            dwCursorPosition: COORD { X: 0, Y: 0 },
            wAttributes: 0,
            srWindow: SMALL_RECT {
                Left: 0,
                Top: 0,
                Right: 0,
                Bottom: 0,
            },
            dwMaximumWindowSize: COORD { X: 0, Y: 0 },
        };
        // SAFETY: valid out-pointer; conout is a live screen-buffer handle.
        let ok = unsafe { GetConsoleScreenBufferInfo(conout, &raw mut info) };
        check!("query-screen-size", ok != 0);
        // SAFETY: by-value COORD; widening the buffer posts the record.
        let ok = unsafe {
            SetConsoleScreenBufferSize(
                conout,
                COORD {
                    X: info.dwSize.X + 1,
                    Y: info.dwSize.Y,
                },
            )
        };
        check!("resize-buffer", ok != 0, format!("{:?}", Win32Error::get()));
        tick_until(&mut loop_, PHASE_MS, || !cwin.fired.is_empty());
        check!(
            "sigwinch-resize-delivered",
            cwin.fired.first() == Some(&SIGWINCH),
            format!("{:?}", cwin.fired)
        );

        // 5. Clean teardown: everything closes, the loop quiesces.
        tty.read_stop().expect("read_stop");
        tty.close(Some(fix_on_tty_close), (&raw mut tty_closed).cast());
        tick_until(&mut loop_, PHASE_MS, || tty_closed > 0);
        close_and_drain(&mut loop_, &mut wint, &raw mut cint);
        close_and_drain(&mut loop_, &mut wbrk, &raw mut cbrk);
        close_and_drain(&mut loop_, &mut wwin, &raw mut cwin);
        check!(
            "close-clean",
            tty_closed == 1 && cint.closed == 1 && cbrk.closed == 1 && cwin.closed == 1
        );
        check!("loop-idle-after-close", !loop_.alive());

        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "SIGFIX DONE failures={}", failures.len());
        let _ = out.flush();
        assert!(failures.is_empty(), "fixture failures: {failures:?}");
    }

    /// Default-action child: NO SIGINT watcher (a SIGBREAK watcher proves an
    /// unrelated watcher does not mark CTRL_C handled). The handler returns
    /// FALSE, the chain reaches the default handler, and the process MUST
    /// die with STATUS_CONTROL_C_EXIT — asserted by the parent on the exit
    /// code. // quirk: SIGEV-04
    #[test]
    #[ignore = "console fixture: executed in a CREATE_NEW_CONSOLE child by console_ctrl_default_action_suite"]
    fn ctrl_default_fixture() {
        SetConsoleCtrlHandler(None, FALSE);
        let conout = open_console_device("CONOUT$");
        assert_ne!(conout, INVALID_HANDLE_VALUE, "no console in fixture child");

        let mut loop_ = Loop::new().unwrap(); // registers the ctrl handler
        let lp: *mut Loop = &raw mut *loop_;
        // SAFETY: loop outlives the watcher.
        let mut wbrk = unsafe { SignalHandle::new(lp) };
        let mut cbrk = Ctx::new();
        // SAFETY: ctx outlives the watcher.
        unsafe {
            wbrk.start(SIGBREAK, false, on_signal, (&raw mut cbrk).cast())
                .unwrap();
        }

        {
            let mut out = std::io::stdout().lock();
            let _ = writeln!(out, "SIGDFL READY");
            let _ = out.flush();
        }
        // SAFETY: by-value arguments; the fresh console isolates the event.
        let ok = unsafe { GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) };
        assert_ne!(ok, 0, "GenerateConsoleCtrlEvent: {:?}", Win32Error::get());

        // The default handler should ExitProcess us mid-wait. Surviving the
        // window is the failure the parent diagnoses via this marker (its
        // exit-code assertion fails too).
        let deadline = loop_.now_ms() + PHASE_MS;
        while loop_.now_ms() < deadline {
            loop_.tick(Some(100));
        }
        {
            let mut out = std::io::stdout().lock();
            let _ = writeln!(out, "SIGDFL FAIL survived");
            let _ = out.flush();
        }
        close_and_drain(&mut loop_, &mut wbrk, &raw mut cbrk);
    }

    // ───────────────── fixture spawners (parents) ──────────────────────────

    /// Spawn the test binary into a FRESH console running exactly one
    /// ignored fixture test, with a bounded wait. The new console is what
    /// makes real ctrl events safe: group id 0 targets only that console's
    /// processes, so the runner is unreachable.
    fn spawn_console_fixture(test_path: &str) -> (std::process::ExitStatus, String, String) {
        let exe = std::env::current_exe().expect("current_exe");
        // std::process::Command: this tier-0 crate cannot depend on
        // bun_spawn_sys (it would break the natively-linkable test binary),
        // and the child is our own test executable.
        #[allow(clippy::disallowed_types)]
        let mut cmd = std::process::Command::new(exe);
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            cmd.args([
                "--ignored",
                "--exact",
                test_path,
                "--nocapture",
                "--test-threads=1",
            ])
            .creation_flags(CREATE_NEW_CONSOLE)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        }
        let mut child = cmd.spawn().expect("spawn console fixture child");

        // Drain both pipes concurrently with the wait so a verbose fixture
        // cannot fill the anonymous-pipe buffer and deadlock on write.
        use std::io::Read as _;
        let out_pipe = child.stdout.take();
        let err_pipe = child.stderr.take();
        let out_th = std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut p) = out_pipe {
                let _ = p.read_to_string(&mut s);
            }
            s
        });
        let err_th = std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut p) = err_pipe {
                let _ = p.read_to_string(&mut s);
            }
            s
        });

        // Bounded wait: a deadlocked fixture must fail, not hang the suite.
        let start = std::time::Instant::now();
        let status = loop {
            match child.try_wait().expect("try_wait") {
                Some(st) => break st,
                None => {
                    if start.elapsed() > std::time::Duration::from_secs(240) {
                        let _ = child.kill();
                        let _ = child.wait();
                        panic!("console fixture child timed out (>240s)");
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        };
        let stdout = out_th.join().unwrap_or_default();
        let stderr = err_th.join().unwrap_or_default();
        (status, stdout, stderr)
    }

    /// Parent of `ctrl_fixture`: real registration + delivery + survival +
    /// SIGWINCH, asserted via explicit markers — never a silent skip.
    #[test]
    fn console_ctrl_fixture_suite() {
        let (status, stdout, stderr) = spawn_console_fixture("signal::tests::ctrl_fixture");

        let fails: Vec<&str> = stdout
            .lines()
            .filter(|l| l.starts_with("SIGFIX FAIL"))
            .collect();
        assert!(
            fails.is_empty(),
            "fixture reported failures: {fails:#?}\n--- child stderr ---\n{stderr}"
        );
        assert!(
            stdout.contains("SIGFIX DONE failures=0"),
            "fixture did not complete\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
        );
        // Load-bearing markers, spot-asserted so a vanished check cannot
        // pass unnoticed (each is a mutation target).
        for marker in [
            "console-available",
            "generate-ctrl-c",
            "ctrl-c-delivered",
            "ctrl-c-only-sigint",
            "generate-ctrl-break",
            "ctrl-break-delivered",
            "survived-handled-events",
            "query-screen-size",
            "resize-buffer",
            "sigwinch-resize-delivered",
            "close-clean",
            "loop-idle-after-close",
        ] {
            assert!(
                stdout.contains(&format!("SIGFIX OK {marker}")),
                "missing fixture marker {marker:?}\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
            );
        }
        assert!(
            status.success(),
            "fixture child exited with {status:?}\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
        );
    }

    /// Parent of `ctrl_default_fixture`: with no SIGINT watcher the handler
    /// chains (returns FALSE) and the DEFAULT handler terminates the child
    /// with STATUS_CONTROL_C_EXIT — the POSIX-default-action emulation.
    /// // quirk: SIGEV-04
    #[test]
    fn console_ctrl_default_action_suite() {
        let (status, stdout, stderr) = spawn_console_fixture("signal::tests::ctrl_default_fixture");

        assert!(
            stdout.contains("SIGDFL READY"),
            "fixture never armed\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
        );
        assert!(
            !stdout.contains("SIGDFL FAIL survived"),
            "child survived an unhandled CTRL_C\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
        );
        assert_eq!(
            status.code(),
            Some(STATUS_CONTROL_C_EXIT),
            "child not killed by the default handler\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
        );
    }

    /// A zero-req close queues an endgame with no completion packet; the
    /// wait fold must treat it as runnable work (uv_backend_timeout parity)
    /// or a blocking tick strands the close forever. // quirk: LOOP-19
    #[test]
    fn queued_endgame_forces_zero_timeout_tick() {
        let _guard = serial();
        let mut loop_ = Loop::new().unwrap();
        let lp: *mut Loop = &mut *loop_;
        // SAFETY: lp is the live loop above.
        let mut h = unsafe { SignalHandle::new(lp) };
        unsafe fn on_close(_l: &mut Loop, data: *mut c_void) {
            // SAFETY: data is the test's live flag.
            unsafe { (*data.cast::<core::cell::Cell<bool>>()).set(true) };
        }
        let closed = core::cell::Cell::new(false);
        // Zero-req close: endgame queued, nothing else can wake the port.
        h.close(Some(on_close), (&raw const closed).cast_mut().cast());
        // Un-timed tick: hangs forever here without the endgame wait fold.
        loop_.tick(None);
        assert!(closed.get(), "endgame ran inside the blocking tick");
        // `h` drops after the endgame — same ownership as close_and_drain.
    }
}
