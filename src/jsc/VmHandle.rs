//! The door out of a VM's thread: [`Ticket`] and [`VmHandle`].
//!
//! Invariant: *a VM is destroyed only after everything that left its thread has
//! come back.* Anything that runs on, or is referenced from, another thread on
//! behalf of a VM holds a [`Ticket`] for it. Creating a ticket counts it;
//! dropping it uncounts it; the VM's teardown ([`VmHandle::close_and_wait`])
//! forbids script, cancels what it can, and then *waits* — servicing its queue
//! so returning work is released on this thread with the heap alive — until no
//! ticket is outstanding, and only then destroys the JSC VM, the loops and the
//! `VirtualMachine`. So no thread can hold anything of a VM's while it is being
//! destroyed, whatever the work captured (VM state, JS buffers, atom strings,
//! arena memory) and whether or not its author thought about teardown.
//!
//! Counting *is* holding the ticket: there is no separate register/finished
//! call to forget. A ticket also carries which of the VM's loops its completion
//! belongs on, and posting through it cannot fail — there is no "VM already
//! gone" case for work that holds one.
//!
//! [`VmHandle`] is the uncounted form: what something that merely *refers* to a
//! VM from elsewhere holds (another context's message queue, a JSC helper
//! thread, the process-wide child waiter, a file-watcher thread). It cannot
//! reach the VM; it can post to it — deliver-or-refuse, WebKit's
//! `postTaskTo(identifier)`. Long-lived holders (a JS-owned object, a struct
//! the VM frees) hold this and never a ticket: a ticket freed only *after* the
//! wait would deadlock it, and the debug build's wait names any such holder.
//!
//! The raw thread-crossing primitives (the work pool, the HTTP thread, thread
//! spawning) are not called from VM code except through a type that embeds a
//! ticket (`bun_jsc::Job`, or a struct holding a `Ticket` for its in-flight
//! duration); `test/internal/source-lints/vm-thread-door.test.ts` freezes the
//! set of call sites and of `unsafe impl Send/Sync` in the VM crates so a new
//! path around the door needs a justification rather than a reviewer's luck.

#[cfg(debug_assertions)]
use core::panic::Location;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use std::sync::Arc;

use bun_threading::{Condvar, Guarded};

use crate::event_loop::EventLoop;
use crate::virtual_machine::VirtualMachine;
use bun_event_loop::ConcurrentTask::ConcurrentTask as ConcurrentTaskItem;

pub use bun_event_loop::Posted;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum State {
    /// Normal operation.
    Open = 0,
    /// The VM is going away — a parent's `terminate()` (from its thread) or
    /// this thread's own exit: native code enters no more script. Tickets are
    /// still issued and posts still accepted, so work already running comes
    /// back and follow-on work it starts is counted like any other.
    Stopping = 1,
    /// Teardown is waiting for outstanding tickets. Ticket holders post as
    /// before (their completions are released on the JS thread as they
    /// arrive); no new ticket is issued to another thread; a [`VmHandle`]'s
    /// posts are still delivered (and released).
    Draining = 2,
    /// No ticket is outstanding and none can be created: nothing off-thread
    /// reaches the VM any more. Weak posts are refused.
    Closed = 3,
}

/// Which of the VM's two embedded loops a completion belongs to, fixed when
/// the ticket is taken on the JS thread (work started while a macro runs
/// completes into the macro loop); a weak poster passes the kind its JS-side
/// initiator captured the same way (C++ `BunLoopKind`). `Bun.spawnSync`'s
/// isolated loop is not one of these: its producers post through that loop's
/// own [`JsPoster`].
///
/// [`JsPoster`]: bun_event_loop::JsPoster
#[repr(u8)] // C++: `BunLoopKind` (BunLoopKind.h)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoopKind {
    Regular = 0,
    Macro = 1,
}

/// `state` (read by every native→JS entry on the JS thread) and `vm`, on
/// their own cache line: the counters after it are RMW'd by pool / HTTP
/// threads on every completion.
#[cfg_attr(
    any(
        target_arch = "x86_64",
        target_arch = "aarch64",
        target_arch = "powerpc64"
    ),
    repr(align(64))
)]
#[cfg_attr(target_arch = "s390x", repr(align(128)))]
struct ReadMostly {
    state: AtomicU8,
    /// The VM. Dereferenced by a ticket holder (the VM outlives every ticket),
    /// by a weak accessor inside the `active` gate before `Closed`, or on the
    /// JS thread.
    vm: *mut VirtualMachine,
}

pub struct Shared {
    hot: ReadMostly,
    /// Outstanding [`Ticket`]s. Teardown waits for zero.
    tickets: AtomicU32,
    /// Threads currently inside a weak `post`/keep-alive/wake. `Closed` is
    /// published and then this is waited to zero (the Dekker pair), so a weak
    /// access either finished before close returned or saw `Closed`.
    active: AtomicU32,
    /// The tearing-down JS thread sleeps here; ticket drops and posts notify
    /// it once draining has begun.
    drained: (Guarded<()>, Condvar),
    #[cfg(debug_assertions)]
    debug: DebugState,
}

/// Debug builds: the JS thread's id, where every live ticket was taken (so a
/// wait that does not end can say who it is waiting for), and the test gate.
#[cfg(debug_assertions)]
struct DebugState {
    js_thread: std::thread::ThreadId,
    live: Guarded<LiveTickets>,
    /// Test suite only — see [`test_gate`].
    gate: core::sync::atomic::AtomicBool,
}

#[cfg(debug_assertions)]
#[derive(Default)]
struct LiveTickets {
    next_id: u64,
    at: bun_collections::HashMap<u64, &'static Location<'static>>,
}

// SAFETY: `vm` is dereferenced only under the discipline in the module doc
// (ticket held ⇒ VM alive; weak ⇒ inside the `active` gate before `Closed`);
// everything else is atomics / sync primitives.
unsafe impl Send for Shared {}
// SAFETY: as above.
unsafe impl Sync for Shared {}

// Orderings: two store→load (Dekker) pairs need `SeqCst` on all four
// operations — `Ticket::drop`'s `tickets` decrement / `state` load against the
// wait's `Draining` store / `tickets` load, and `enter`'s `active` increment /
// `state` load against the wait's `Closed` store / `active` load. Everything
// on `state`, `tickets` and `active` is `SeqCst` so no site has to argue which
// pair it is in; the cost is in the RMWs, not the ordering.
impl Shared {
    #[inline]
    fn state(&self) -> State {
        match self.hot.state.load(Ordering::SeqCst) {
            0 => State::Open,
            1 => State::Stopping,
            2 => State::Draining,
            _ => State::Closed,
        }
    }

    #[inline]
    fn loop_of(&self, kind: LoopKind) -> &EventLoop {
        // SAFETY: caller holds a ticket or is inside the weak gate before
        // `Closed`; the VM and both embedded loops are alive.
        unsafe {
            match kind {
                LoopKind::Regular => &(*self.hot.vm).regular_event_loop,
                LoopKind::Macro => &(*self.hot.vm).macro_event_loop,
            }
        }
    }

    fn notify(&self) {
        let _g = self.drained.0.lock();
        self.drained.1.notify_all();
    }

    /// Push + wake; while draining, also wake the waiting teardown (it sleeps
    /// on the condvar, not on the loop).
    fn deliver(&self, kind: LoopKind, task: NonNull<ConcurrentTaskItem>) {
        let el = self.loop_of(kind);
        el.concurrent_tasks.push(task);
        if self.state() >= State::Draining {
            self.notify();
        } else {
            el.wakeup();
        }
    }

    fn add_keep_alive(&self, kind: LoopKind, delta: i32) {
        let el = self.loop_of(kind);
        let _ = el.concurrent_ref.fetch_add(delta, Ordering::SeqCst);
        el.wakeup();
    }
}

// ── Ticket ────────────────────────────────────────────────────────────────

/// One unit of "something of this VM's is on another thread". See the module
/// doc. `Send + Sync`; obtain on the JS thread with [`VirtualMachine::ticket`]
/// (or by cloning one you hold, on any thread), keep it in the in-flight
/// operation — never in a JS-owned or VM-owned object — and drop it when the
/// operation's last touch of the VM's memory from another thread is done
/// (normally: right after posting the completion).
pub struct Ticket {
    shared: Arc<Shared>,
    kind: LoopKind,
    #[cfg(debug_assertions)]
    id: u64,
}

impl Ticket {
    #[track_caller]
    fn issue(shared: &Arc<Shared>, kind: LoopKind) -> Ticket {
        shared.tickets.fetch_add(1, Ordering::SeqCst);
        #[cfg(debug_assertions)]
        let id = {
            let mut live = shared.debug.live.lock();
            let id = live.next_id;
            live.next_id += 1;
            live.at.insert(id, Location::caller());
            id
        };
        Ticket {
            shared: Arc::clone(shared),
            kind,
            #[cfg(debug_assertions)]
            id,
        }
    }

    /// Queue `task` on the loop this ticket was taken for and wake it. Any
    /// thread. Cannot fail: the VM waits for this ticket before it goes.
    ///
    /// The JS thread may consume `task` — and free whatever it points into —
    /// before this returns, so `self` must not live inside that memory: move
    /// the ticket out of the work's struct first, post, then drop it.
    pub fn post(&self, task: NonNull<ConcurrentTaskItem>) {
        test_gate::before_ticket_post(self);
        debug_assert!(
            self.shared.state() != State::Closed,
            "ticket post after its VM closed (a ticket was created after the wait)"
        );
        self.shared.deliver(self.kind, task);
    }

    /// Release a keep-alive taken on the VM's loop (any thread).
    pub fn unref_keep_alive(&self) {
        self.shared.add_keep_alive(self.kind, -1);
    }

    /// Whether the VM is still running script (not stopping). What an
    /// off-thread body checks before doing work whose only consumer is
    /// script; either way it posts its completion back.
    #[inline]
    pub fn script_allowed(&self) -> bool {
        self.shared.state() == State::Open
    }

    /// Whether the VM has begun its final wait: work it has not started yet is
    /// no longer wanted (Node `uv_cancel`s queued work at the same point) —
    /// hand it straight back.
    #[inline]
    pub fn cancelled(&self) -> bool {
        self.shared.state() >= State::Draining
    }
}

impl Clone for Ticket {
    /// One more ticket for the same VM and loop (any thread).
    #[track_caller]
    fn clone(&self) -> Ticket {
        Ticket::issue(&self.shared, self.kind)
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        self.shared.debug.live.lock().at.remove(&self.id);
        if self.shared.tickets.fetch_sub(1, Ordering::SeqCst) == 1
            && self.shared.state() >= State::Draining
        {
            self.shared.notify();
        }
    }
}

// ── VmHandle (uncounted) ──────────────────────────────────────────────────

/// See the module documentation. `repr(transparent)` over the `Arc` so a
/// `*const Shared` can cross FFI (C++ / napi hold references).
#[derive(Clone)]
#[repr(transparent)]
pub struct VmHandle(Arc<Shared>);

/// RAII: one unit of `active`. While held, `close_and_wait` cannot return.
struct Access<'a>(&'a Shared);
impl Drop for Access<'_> {
    fn drop(&mut self) {
        if self.0.active.fetch_sub(1, Ordering::SeqCst) == 1 && self.0.state() == State::Closed {
            self.0.notify();
        }
    }
}

impl VmHandle {
    /// JS thread, at VM creation.
    pub(crate) fn new(vm: *mut VirtualMachine) -> Self {
        VmHandle(Arc::new(Shared {
            hot: ReadMostly {
                state: AtomicU8::new(State::Open as u8),
                vm,
            },
            tickets: AtomicU32::new(0),
            active: AtomicU32::new(0),
            drained: (Guarded::new(()), Condvar::new()),
            #[cfg(debug_assertions)]
            debug: DebugState {
                js_thread: std::thread::current().id(),
                live: Default::default(),
                gate: core::sync::atomic::AtomicBool::new(false),
            },
        }))
    }

    #[inline]
    fn enter(&self) -> Option<Access<'_>> {
        self.0.active.fetch_add(1, Ordering::SeqCst);
        let a = Access(&self.0);
        (self.0.state() != State::Closed).then_some(a)
    }

    // ── any-thread API ─────────────────────────────────────────────────────

    /// Queue `task` on the VM's `kind` loop and wake it, or hand it back if
    /// the VM is closed. For posters that hold no ticket (their payload is
    /// their own to free on refusal).
    pub fn post(&self, kind: LoopKind, task: NonNull<ConcurrentTaskItem>) -> Posted {
        test_gate::weak_post(&self.0, task, |task| {
            let Some(_a) = self.enter() else {
                return Posted::Refused(task);
            };
            self.0.deliver(kind, task);
            Posted::Queued
        })
    }

    /// Ask the VM, from another thread, to poll its pending-module queue
    /// ([`Task::poll_pending_modules`](bun_event_loop::Task::poll_pending_modules));
    /// dropped if the VM is closed.
    pub fn post_poll_pending_modules(&self, kind: LoopKind) {
        let ct = ConcurrentTaskItem::create(bun_event_loop::Task::poll_pending_modules());
        if let Posted::Refused(ct) = self.post(kind, ct) {
            // SAFETY: refused ⇒ never queued; the carrier `create` boxed is
            // ours again and this task's payload is null (owns nothing).
            unsafe { ConcurrentTaskItem::release_refused(ct) };
        }
    }

    /// Queue a C++ `EventLoopTask` on the VM's `kind` loop from another
    /// thread (WebCore's `postTaskTo` / `postTaskConcurrently`), or delete it
    /// unrun if the VM is closed.
    ///
    /// # Safety
    /// `task` is a live heap `WebCore::EventLoopTask` the caller hands over.
    pub unsafe fn post_cpp_task(&self, kind: LoopKind, task: *mut crate::cpp_task::CppTask) {
        unsafe extern "C" {
            fn Bun__deleteEventLoopTask(task: *mut crate::cpp_task::CppTask);
        }
        let ct = ConcurrentTaskItem::create(bun_event_loop::Task::init(task));
        if let Posted::Refused(ct) = self.post(kind, ct) {
            // SAFETY: refused ⇒ we own both boxes.
            unsafe {
                drop(bun_core::heap::take(ct.as_ptr()));
                Bun__deleteEventLoopTask(task);
            }
        }
    }

    /// Adjust the VM's keep-alive from another thread (no-op once closed).
    pub fn add_keep_alive(&self, kind: LoopKind, delta: i32) {
        if let Some(_a) = self.enter() {
            self.0.add_keep_alive(kind, delta);
        }
    }

    /// The VM is going away: `Open → Stopping` (idempotent; never reopens).
    /// Any thread — a parent's `terminate()` calls it at request time, as
    /// Node's `Environment::ExitEnv` sets `is_stopping` from the requesting
    /// thread; this thread's own exit path calls it via
    /// `VirtualMachine::forbid_script`.
    pub fn stop(&self) {
        let _ = self.0.hot.state.compare_exchange(
            State::Open as u8,
            State::Stopping as u8,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    /// [`stop`](Self::stop), raise a JSC `TerminationException` in the VM at
    /// its next safepoint, and wake its loop. Any thread (a parent's
    /// `worker.terminate()`); no-op once the VM is closed.
    pub fn request_termination(&self) {
        self.stop();
        if let Some(_a) = self.enter() {
            // SAFETY: inside the gate before `Closed` ⇒ the VM is alive;
            // `notify_need_termination` is thread-safe (VMTraps). Raw field
            // read, no `&VirtualMachine` formed off-thread.
            unsafe { (*(*self.0.hot.vm).jsc_vm.cast_const()).notify_need_termination() };
            self.0.loop_of(LoopKind::Regular).wakeup();
        }
    }

    /// Wake the VM's loop (no-op once closed). Any thread.
    pub fn wake(&self) {
        if let Some(_a) = self.enter() {
            self.0.loop_of(LoopKind::Regular).wakeup();
        }
    }

    /// May native code call into user JS / settle its promises right now?
    /// (Node's `can_call_into_js()`.) Any thread; meaningful on the JS thread.
    #[inline]
    pub fn script_allowed(&self) -> bool {
        self.0.state() == State::Open
    }

    pub(crate) fn tickets_outstanding(&self) -> u32 {
        self.0.tickets.load(Ordering::SeqCst)
    }

    // ── JS-thread API ─────────────────────────────────────────────────────

    #[cfg(debug_assertions)]
    pub(crate) fn assert_js_thread(&self) {
        debug_assert_eq!(std::thread::current().id(), self.0.debug.js_thread);
    }
    #[cfg(not(debug_assertions))]
    #[inline(always)]
    pub(crate) fn assert_js_thread(&self) {}

    /// Teardown, phase B of `VirtualMachine::teardown` (JS thread, script
    /// forbidden, everything cancellable cancelled): wait until no ticket is outstanding, calling `service`
    /// (release everything queued, on this thread, heap alive) whenever
    /// something may have arrived; then refuse weak accessors and wait out any
    /// mid-call. After this returns nothing off-thread can reach the VM.
    ///
    /// Unbounded by design: a job that cannot be cancelled makes this take as
    /// long as the job (as Node's environment cleanup does). Every wake source
    /// (ticket drop, post) notifies the condvar; the 1 s timeout is a backstop
    /// and the debug build's cadence for naming the outstanding tickets.
    pub(crate) fn close_and_wait(&self, mut service: impl FnMut()) {
        self.assert_js_thread();
        let s = &*self.0;
        s.hot.state.store(State::Draining as u8, Ordering::SeqCst);
        test_gate::draining(self);
        #[cfg(debug_assertions)]
        let started = std::time::Instant::now();
        #[cfg(debug_assertions)]
        let mut next_report = test_gate::first_report_secs(self);
        loop {
            service();
            let mut g = s.drained.0.lock();
            if !s.loop_of(LoopKind::Regular).concurrent_tasks.is_empty()
                || !s.loop_of(LoopKind::Macro).concurrent_tasks.is_empty()
            {
                continue;
            }
            if s.tickets.load(Ordering::SeqCst) == 0 {
                s.hot.state.store(State::Closed as u8, Ordering::SeqCst);
                break;
            }
            let _ = s.drained.1.timed_wait_guarded(&mut g, 1_000_000_000);
            drop(g);
            #[cfg(debug_assertions)]
            {
                let secs = started.elapsed().as_secs();
                if secs >= next_report {
                    next_report = secs + 10;
                    self.dump_outstanding(secs);
                }
            }
        }
        if s.active.load(Ordering::SeqCst) != 0 {
            let mut g = s.drained.0.lock();
            while s.active.load(Ordering::SeqCst) != 0 {
                s.drained.1.wait_guarded(&mut g);
            }
        }
        // A weak post that entered before `Closed` was published.
        service();
    }

    #[cfg(debug_assertions)]
    fn dump_outstanding(&self, secs: u64) {
        let live = self.0.debug.live.lock();
        let mut sites: Vec<(&'static str, u32)> =
            live.at.values().map(|l| (l.file(), l.line())).collect();
        sites.sort_unstable();
        let w = bun_core::output::error_writer();
        let _ = writeln!(
            w,
            "[vm] teardown has waited {secs}s for {} ticket(s) still held off-thread:",
            sites.len()
        );
        for run in sites.chunk_by(|a, b| a == b) {
            let _ = writeln!(
                w,
                "[vm]   {}× taken at {}:{}",
                run.len(),
                run[0].0,
                run[0].1
            );
        }
        let _ = w.flush();
    }
}

impl VirtualMachine {
    /// JS thread: a ticket for work about to leave this thread — this VM, and
    /// the loop it is currently ticking. Hold it in the in-flight operation
    /// and drop it after the completion is posted. Infallible until the wait
    /// has finished (after which nothing on this thread starts off-thread work).
    #[track_caller]
    #[inline]
    pub fn ticket(&self) -> Ticket {
        let h = self.handle_ref();
        h.assert_js_thread();
        debug_assert!(
            h.0.state() != State::Closed,
            "off-thread work started after the VM finished draining"
        );
        Ticket::issue(&h.0, self.current_loop_kind())
    }
}

/// JS thread: [`VirtualMachine::current_loop_kind`] for C++ (`BunLoopKind`),
/// captured by the initiator of work whose completion is posted weakly.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VM__currentLoopKind(vm: &VirtualMachine) -> LoopKind {
    vm.current_loop_kind()
}

// ── Test suite only: deterministic late completions ───────────────────────
//
// `BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE` (first-level worker VMs; builds with
// debug assertions): a post from another thread is held until the worker's
// teardown has begun waiting, so it always arrives *during* the wait — the
// ticketed path (queued, released on the JS thread, then the wait ends) and
// the weak path (queued-and-released while draining, or refused once closed)
// run with their real preconditions every time instead of only when they lose
// the race. Each is named on stderr. The parked thread keeps whatever locks it
// holds (the fetch tasklet's mutex, a streaming body's buffer lock), so a row
// whose worker then blocks on that same lock never reaches teardown: a hang
// under the gate, not in production.
#[cfg(debug_assertions)]
mod test_gate {
    use super::{Ordering, Posted, Shared, State, Ticket, VmHandle};
    type Task = core::ptr::NonNull<super::ConcurrentTaskItem>;

    impl VmHandle {
        pub(crate) fn arm_test_gate(&self) {
            self.0.debug.gate.store(true, Ordering::Relaxed);
        }
    }
    fn on(s: &Shared) -> bool {
        s.debug.gate.load(Ordering::Relaxed)
    }
    fn armed(s: &Shared) -> bool {
        on(s) && std::thread::current().id() != s.debug.js_thread
    }
    fn park_until_draining(s: &Shared) {
        let mut g = s.drained.0.lock();
        while s.state() < State::Draining {
            s.drained.1.wait_guarded(&mut g);
        }
    }
    /// One line at a time: pool threads report concurrently.
    static SAY: bun_threading::Mutex = bun_threading::Mutex::new();
    fn say(what: core::fmt::Arguments<'_>) {
        let _g = SAY.lock_guard();
        // The poster can be a thread Bun never set up for output (a JSC helper).
        bun_core::output::Source::configure_thread();
        let w = bun_core::output::error_writer();
        let _ = writeln!(w, "[vm] {what}");
        let _ = w.flush();
    }

    pub(super) fn before_ticket_post(t: &Ticket) {
        if armed(&t.shared) {
            park_until_draining(&t.shared);
            let l = *t
                .shared
                .debug
                .live
                .lock()
                .at
                .get(&t.id)
                .expect("live ticket");
            say(format_args!(
                "late completion from {}:{}",
                l.file(),
                l.line()
            ));
        }
    }
    pub(super) fn weak_post(s: &Shared, task: Task, post: impl FnOnce(Task) -> Posted) -> Posted {
        if !armed(s) {
            return post(task);
        }
        park_until_draining(s);
        // SAFETY: handed over by the caller and not yet queued anywhere.
        let tag = unsafe { task.as_ref() }.task.tag;
        let r = post(task);
        let outcome = match r {
            Posted::Queued => "released by the wait",
            Posted::Refused(_) => "refused",
        };
        say(format_args!("late post: {} ({outcome})", tag.name()));
        r
    }
    /// The wait began: parked posts go now.
    pub(super) fn draining(h: &VmHandle) {
        if on(&h.0) {
            h.0.notify();
        }
    }
    /// The gate's tests read the outstanding-ticket dump; everyone else only
    /// after a wait long enough to be worth explaining even on a slow build.
    pub(super) fn first_report_secs(h: &VmHandle) -> u64 {
        if on(&h.0) { 2 } else { 10 }
    }
}
#[cfg(not(debug_assertions))]
mod test_gate {
    use super::{Posted, Shared, Ticket, VmHandle};
    type Task = core::ptr::NonNull<super::ConcurrentTaskItem>;
    impl VmHandle {
        #[inline(always)]
        pub(crate) fn arm_test_gate(&self) {}
    }
    #[inline(always)]
    pub(super) fn before_ticket_post(_: &Ticket) {}
    #[inline(always)]
    pub(super) fn weak_post(_: &Shared, task: Task, post: impl FnOnce(Task) -> Posted) -> Posted {
        post(task)
    }
    #[inline(always)]
    pub(super) fn draining(_: &VmHandle) {}
}

// ── C++ holds references ──────────────────────────────────────────────────
//
// `*const Shared` (`BunVmHandleRef`) is one strong count on the Arc behind a
// [`VmHandle`] — what a long-lived C++ holder (JSVMClientData, NapiEnv) keeps
// and posts through. C++ work bound for another thread (WebCrypto's
// `EventLoopTaskNoContext`) is carried by a Rust task that holds the ticket
// (`ConcurrentCppTask`), so no ticket crosses the FFI.

/// A `VmHandle` view over a reference C++ holds, for the duration of one call.
pub struct BorrowedRef(core::mem::ManuallyDrop<VmHandle>);
impl core::ops::Deref for BorrowedRef {
    type Target = VmHandle;
    fn deref(&self) -> &VmHandle {
        &self.0
    }
}

impl VmHandle {
    /// Hand C++ one strong count on this handle.
    pub fn into_ref(self) -> *const Shared {
        Arc::into_raw(self.0)
    }

    /// # Safety
    /// `r` is a live reference obtained from [`VmHandle::into_ref`] that its
    /// holder keeps for the duration.
    pub unsafe fn borrow_ref(r: *const Shared) -> BorrowedRef {
        // SAFETY: fn contract; ManuallyDrop leaves the holder's count untouched.
        BorrowedRef(core::mem::ManuallyDrop::new(VmHandle(unsafe {
            Arc::from_raw(r)
        })))
    }

    /// # Safety
    /// `r` came from [`VmHandle::into_ref`] and its holder gives the count up here.
    pub unsafe fn from_ref(r: *const Shared) -> VmHandle {
        // SAFETY: fn contract.
        VmHandle(unsafe { Arc::from_raw(r) })
    }
}

/// JS thread: a reference to `vm`'s handle for C++ to keep (`release` when done).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VmHandle__retain(vm: &VirtualMachine) -> *const Shared {
    vm.handle().into_ref()
}

/// Any thread: one more reference on the same handle.
///
/// # Safety
/// `r` is a live reference its holder keeps for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__retainRef(r: *const Shared) -> *const Shared {
    // SAFETY: fn contract.
    unsafe { VmHandle::borrow_ref(r) }.clone().into_ref()
}

/// Any thread: give a reference up.
///
/// # Safety
/// `r` came from `Bun__VmHandle__retain*` and is not used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__release(r: *const Shared) {
    // SAFETY: fn contract.
    drop(unsafe { VmHandle::from_ref(r) });
}

/// Any thread: post a C++ task to the VM's `kind` loop through a reference and
/// give the reference up (queued, or deleted unrun if the VM is closed).
///
/// # Safety
/// `r` came from `Bun__VmHandle__retain*` and is not used afterwards; `task` is
/// a live heap `WebCore::EventLoopTask` handed over.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__postAndRelease(
    r: *const Shared,
    task: *mut crate::cpp_task::CppTask,
    kind: LoopKind,
) {
    // SAFETY: fn contract.
    let handle = unsafe { VmHandle::from_ref(r) };
    // SAFETY: fn contract.
    unsafe { handle.post_cpp_task(kind, task) };
}

/// JS thread: adjust this VM's keep-alive directly.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__eventLoop__refKeepAlive(vm: &VirtualMachine, delta: core::ffi::c_int) {
    if delta > 0 {
        vm.event_loop_shared().ref_keep_alive();
    } else {
        vm.event_loop_shared().unref_keep_alive();
    }
}

/// Any thread: adjust the keep-alive on the VM's `kind` loop (no-op once the
/// VM is closed).
///
/// # Safety
/// `r` is a live reference its holder keeps for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__refKeepAlive(
    r: *const Shared,
    kind: LoopKind,
    delta: core::ffi::c_int,
) {
    // SAFETY: fn contract.
    unsafe { VmHandle::borrow_ref(r) }.add_keep_alive(kind, delta.signum());
}

/// Any thread: Node's `can_call_into_js()`.
///
/// # Safety
/// `r` is a live reference its holder keeps for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__scriptAllowed(r: *const Shared) -> bool {
    // SAFETY: fn contract.
    unsafe { VmHandle::borrow_ref(r) }.script_allowed()
}

/// The address of this handle's state byte, for C++ to test
/// `*addr == BUN_VM_HANDLE_STATE_OPEN` inline on its native→JS entries.
///
/// # Safety
/// `r` is a live reference.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__stateAddress(r: *const Shared) -> *const AtomicU8 {
    // SAFETY: fn contract; `hot.state` lives in the Arc payload `r` points at.
    unsafe { &raw const (*r).hot.state }
}

// C++ (BunClientData.h) hard-codes this value.
const _: () = assert!(State::Open as u8 == 0);

// ── Producers that serve either a JS VM or a MiniEventLoop ────────────────
//
// fs.cp (also used by the shell), shell builtins, zlib run on the work pool
// for whichever loop created them. For the JS case the work holds a ticket; a
// MiniEventLoop (bundler / shell / install threads) is owned by its thread and
// outlives the work it schedules, so its concurrent queue is posted to directly.

/// Where an off-thread completion goes: a JS VM (through a ticket the work
/// holds) or a mini event loop. Captured on the owning thread when the work is
/// created; dropped when the work is done with the loop. Cloning the JS arm
/// takes one more ticket.
pub enum ConcurrentPoster {
    Js(Ticket),
    Mini(bun_ptr::BackRef<bun_event_loop::MiniEventLoop::MiniEventLoop, bun_ptr::Mut>),
}

impl Clone for ConcurrentPoster {
    #[track_caller]
    fn clone(&self) -> Self {
        match self {
            ConcurrentPoster::Js(t) => ConcurrentPoster::Js(t.clone()),
            ConcurrentPoster::Mini(m) => ConcurrentPoster::Mini(*m),
        }
    }
}

impl ConcurrentPoster {
    /// Owning thread: for a JS loop, take a ticket on its VM; for a mini loop,
    /// post directly.
    #[track_caller]
    pub fn from_event_loop_handle(h: &bun_event_loop::EventLoopHandle) -> Self {
        match h {
            bun_event_loop::EventLoopHandle::Js { owner } => {
                // SAFETY: a `Js` handle is only formed on its VM's thread from
                // the live VM (`EventLoopHandle::init` contract).
                let vm = unsafe { &*owner.bun_vm().cast::<VirtualMachine>() };
                ConcurrentPoster::Js(vm.ticket())
            }
            bun_event_loop::EventLoopHandle::Mini(mini) => ConcurrentPoster::Mini(*mini),
        }
    }

    pub fn is_js(&self) -> bool {
        matches!(self, ConcurrentPoster::Js(..))
    }

    /// Post a JS-loop `ConcurrentTask`. Panics (debug) if this poster is `Mini`.
    pub fn post_js(&self, task: NonNull<ConcurrentTaskItem>) {
        match self {
            ConcurrentPoster::Js(t) => t.post(task),
            ConcurrentPoster::Mini(_) => debug_assert!(false, "post_js on a Mini poster"),
        }
    }

    /// Post a mini-loop task (the mini loop outlives its work).
    pub fn post_mini(
        &self,
        task: NonNull<bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext>,
    ) {
        match self {
            ConcurrentPoster::Mini(mini) => {
                let mut mini = *mini;
                // SAFETY: per `EventLoopHandle::Mini` invariant — the mini loop is
                // alive for as long as work it created runs; its concurrent queue
                // push is thread-safe.
                unsafe { mini.get_mut() }.enqueue_task_concurrent(task);
            }
            ConcurrentPoster::Js(..) => debug_assert!(false, "post_mini on a Js poster"),
        }
    }
}

// ── Erased form for crates below bun_jsc (spawn, bundler) ─────────────────

struct PosterData {
    handle: VmHandle,
    kind: LoopKind,
}

unsafe fn poster_post(data: *const (), task: NonNull<ConcurrentTaskItem>) -> Posted {
    // SAFETY: `data` is a leaked `Arc<PosterData>` pointer (see `to_js_poster`).
    let d = unsafe { &*data.cast::<PosterData>() };
    d.handle.post(d.kind, task)
}
unsafe fn poster_clone(data: *const ()) -> *const () {
    // SAFETY: as above; bump the Arc count and hand out the same pointer.
    unsafe { Arc::increment_strong_count(data.cast::<PosterData>()) };
    data
}
unsafe fn poster_drop(data: *const ()) {
    // SAFETY: as above; balances `into_raw`/`increment_strong_count`.
    unsafe { drop(Arc::from_raw(data.cast::<PosterData>())) };
}
static POSTER_VTABLE: bun_event_loop::JsPosterVTable = bun_event_loop::JsPosterVTable {
    post: poster_post,
    clone: poster_clone,
    drop: poster_drop,
};

impl VmHandle {
    /// An erased weak poster for `kind`, for code that cannot name `VmHandle`.
    pub fn to_js_poster(&self, kind: LoopKind) -> bun_event_loop::JsPoster {
        let data = Arc::into_raw(Arc::new(PosterData {
            handle: self.clone(),
            kind,
        }))
        .cast::<()>();
        // SAFETY: `data`/vtable pair as documented on `JsPoster::from_raw`.
        unsafe { bun_event_loop::JsPoster::from_raw(data, &POSTER_VTABLE) }
    }
}

impl VirtualMachine {
    /// JS thread: an erased weak poster for the current loop of this VM.
    pub fn js_poster(&self) -> bun_event_loop::JsPoster {
        self.handle_ref().to_js_poster(self.current_loop_kind())
    }
}

// ── Isolated event loops (Bun.spawnSync) ──────────────────────────────────
//
// spawnSync runs a third, heap-allocated `EventLoop` on the JS thread while it
// blocks; process exits (waiter thread) and pool completions for that call
// must land on *its* concurrent queue, not the VM's. It gets its own small
// weak poster with the same gate discipline, closed before the loop is freed.
// The VM cannot tear down under it: its creator drives it synchronously.

/// Opaque outside this crate: the poster of a spawnSync isolated loop.
pub struct IsolatedPosterInner {
    open: core::sync::atomic::AtomicBool,
    active: AtomicU32,
    event_loop: *const EventLoop,
}
// SAFETY: `event_loop` is dereferenced only under the gate (open && counted).
unsafe impl Send for IsolatedPosterInner {}
// SAFETY: as above.
unsafe impl Sync for IsolatedPosterInner {}

impl IsolatedPosterInner {
    pub(crate) fn new(event_loop: *const EventLoop) -> Arc<Self> {
        Arc::new(Self {
            open: core::sync::atomic::AtomicBool::new(true),
            active: AtomicU32::new(0),
            event_loop,
        })
    }

    /// JS thread, before the isolated loop is freed: refuse further posts and
    /// wait out anyone mid-post.
    pub(crate) fn close(&self) {
        self.open.store(false, Ordering::SeqCst);
        while self.active.load(Ordering::SeqCst) != 0 {
            core::hint::spin_loop();
        }
    }

    pub(crate) fn post(&self, task: NonNull<ConcurrentTaskItem>) -> Posted {
        self.active.fetch_add(1, Ordering::SeqCst);
        let open = self.open.load(Ordering::SeqCst);
        if open {
            // SAFETY: gate held and open ⇒ the isolated loop is alive.
            let el = unsafe { &*self.event_loop };
            el.concurrent_tasks.push(task);
            el.wakeup();
        }
        self.active.fetch_sub(1, Ordering::SeqCst);
        if open {
            Posted::Queued
        } else {
            Posted::Refused(task)
        }
    }

    pub(crate) fn to_js_poster(this: &Arc<Self>) -> bun_event_loop::JsPoster {
        let data = Arc::into_raw(Arc::clone(this)).cast::<()>();
        // SAFETY: data/vtable pair per `JsPoster::from_raw`.
        unsafe { bun_event_loop::JsPoster::from_raw(data, &ISOLATED_POSTER_VTABLE) }
    }
}

unsafe fn isolated_post(data: *const (), task: NonNull<ConcurrentTaskItem>) -> Posted {
    // SAFETY: leaked Arc<IsolatedPosterInner>.
    unsafe { &*data.cast::<IsolatedPosterInner>() }.post(task)
}
unsafe fn isolated_clone(data: *const ()) -> *const () {
    // SAFETY: as above.
    unsafe { Arc::increment_strong_count(data.cast::<IsolatedPosterInner>()) };
    data
}
unsafe fn isolated_drop(data: *const ()) {
    // SAFETY: as above.
    unsafe { drop(Arc::from_raw(data.cast::<IsolatedPosterInner>())) };
}
static ISOLATED_POSTER_VTABLE: bun_event_loop::JsPosterVTable = bun_event_loop::JsPosterVTable {
    post: isolated_post,
    clone: isolated_clone,
    drop: isolated_drop,
};
