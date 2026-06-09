//! Rust `async fn` support on the JS event loop.
//!
//! [`spawn`] pins a future into a single heap allocation and drives it with
//! the event loop's own task queue: every `Waker::wake` enqueues the task
//! (tag `task_tag::AsyncTask`) and `bun_runtime::dispatch::run_task` polls it
//! on the JS thread. There is no separate executor, reactor, or worker —
//! the event loop is the runtime.
//!
//! Futures are deliberately **not** `Send`: they may capture JS-thread-affine
//! state (`Strong`, `JsRef`, raw `JSValue` roots). The executor's matching
//! guarantee is that the future is polled *and dropped* only on the JS
//! thread, including the shutdown path — so `!Send` captures are sound by
//! construction. Wakers, by contrast, are `Send + Sync` and may fire from any
//! thread; a cross-thread wake performs the same MPSC push + loop wakeup as
//! every existing work-pool completion.
//!
//! ## Wake protocol
//!
//! The loop's queues do not deduplicate: enqueueing the same pointer twice
//! would poll freed or aliased state. `state` is a small CAS machine that
//! makes wakes idempotent — at most one enqueue (and therefore one embedded
//! [`ConcurrentTask`] node arming) is in flight at any time:
//!
//! ```text
//!  IDLE ──wake──▶ SCHEDULED ──dispatch──▶ RUNNING ──Ready──▶ COMPLETE
//!   ▲                 ▲                   │     │
//!   │                 │ (re-enqueue)      │     └─wake─▶ NOTIFIED ─┐
//!   └────Pending──────┴───────────────────┘            (after poll)┘
//! ```
//!
//! A queued-but-never-dispatched task at VM teardown is released by
//! [`AsyncTask::release_at_shutdown`] (wired into
//! `bun_runtime::dispatch::__bun_release_task_at_shutdown`), which drops the
//! future on the JS thread while JSC handles are still valid. A task parked
//! on an external event (state `IDLE`) at forced teardown follows the same
//! rules as every in-flight completion today: its keepalive prevents natural
//! exit, and abrupt termination leaks the box rather than touching a dead VM.
//!
//! ## Reference counts
//!
//! `refs` counts: +1 held by the task itself from spawn until a terminal
//! state (COMPLETE/CLOSED) is processed, +1 while the task sits in a queue,
//! +1 per live `Waker` clone. The future is dropped in place at the terminal
//! transition (always on the JS thread); after that the allocation is plain
//! bytes, so the last reference may safely be dropped — and the memory freed
//! — from any thread.

use core::future::Future;
use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::pin::Pin;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use core::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

use crate::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use crate::{JsEventLoop, Task};
use bun_io::KeepAlive;

// ─── state machine ───────────────────────────────────────────────────────────

/// Not queued, not running. A wake may transition to `SCHEDULED` and enqueue.
const IDLE: u32 = 0;
/// In a queue (local FIFO or concurrent MPSC). Wakes are no-ops.
const SCHEDULED: u32 = 1;
/// Being polled on the JS thread. A wake transitions to `NOTIFIED`.
const RUNNING: u32 = 2;
/// Woken while `RUNNING`; the poll exit re-enqueues instead of parking.
const NOTIFIED: u32 = 3;
/// The future returned `Ready` and was dropped. Wakes are no-ops.
const COMPLETE: u32 = 4;
/// Dropped without completing (shutdown release). Wakes are no-ops.
const CLOSED: u32 = 5;

// All atomics use `SeqCst`: wakes are orders of magnitude rarer than the
// loads/stores a poll performs, and the enqueue they guard already pays an
// MPSC push (and possibly a wakeup syscall). Weaken only with a benchmark.
const ORD: Ordering = Ordering::SeqCst;

// ─── task header ─────────────────────────────────────────────────────────────

/// Type-erased header of a spawned future. The concrete allocation is
/// `Storage<F>` (`#[repr(C)]`, header first), so a `*mut AsyncTask` is the
/// allocation pointer; `vtable` recovers the `F`-typed operations.
///
/// Cross-thread paths (wakers) touch only the atomic fields and the embedded
/// `concurrent` node, via per-field raw projections — never `&AsyncTask` /
/// `&mut AsyncTask` — so JS-thread mutation of the non-atomic fields
/// (`keep_alive`, the future payload) never aliases a live reference.
pub struct AsyncTask {
    state: AtomicU32,
    refs: AtomicU32,
    /// The owning loop, captured at spawn. Deliberately the specific
    /// `jsc::EventLoop` (not re-derived per wake): if spawnSync has swapped
    /// `vm.event_loop`, a wake must still target the regular loop — the task
    /// then runs after the swap-back, never inside the isolated loop.
    event_loop: JsEventLoop,
    js_thread: std::thread::ThreadId,
    /// Embedded envelope for cross-thread wakes. At most one enqueue is in
    /// flight (state machine), and the consumer copies a popped batch into
    /// the local FIFO before dispatching any task, so re-arming on a later
    /// wake can never race the MPSC iterator's read of `next`.
    concurrent: ConcurrentTask,
    keep_alive: KeepAlive,
    vtable: &'static VTable,
}

impl crate::Taskable for AsyncTask {
    const TAG: crate::TaskTag = crate::task_tag::AsyncTask;
}

/// `F`-typed operations, monomorphized once per [`spawn`] instantiation.
struct VTable {
    poll: for<'a, 'b> unsafe fn(*mut AsyncTask, &'a mut Context<'b>) -> Poll<()>,
    drop_future: unsafe fn(*mut AsyncTask),
    dealloc: unsafe fn(*mut AsyncTask),
}

#[repr(C)]
struct Storage<F: Future<Output = ()>> {
    header: AsyncTask,
    /// `Some` until the terminal transition drops the future in place.
    future: Option<F>,
}

unsafe fn poll_thunk<F: Future<Output = ()>>(
    this: *mut AsyncTask,
    cx: &mut Context<'_>,
) -> Poll<()> {
    let storage = this.cast::<Storage<F>>();
    // SAFETY: `RUNNING` is exclusive (single consumer dispatches, wakes only
    // flip atomics), so no other access to the future slot exists. Projecting
    // the field leaves the header's atomic fields untouched for racing wakers.
    let slot = unsafe { &mut (*storage).future };
    debug_assert!(slot.is_some(), "polled after terminal transition");
    // SAFETY: `slot` is `Some` until the terminal transition, which cannot
    // happen while we are `RUNNING`.
    let future = unsafe { slot.as_mut().unwrap_unchecked() };
    // SAFETY: pinned by construction — the storage allocation never moves
    // (heap-allocated at spawn, freed only by `dealloc_thunk`) and the future
    // is dropped in place by `drop_future_thunk`.
    unsafe { Pin::new_unchecked(future) }.poll(cx)
}

unsafe fn drop_future_thunk<F: Future<Output = ()>>(this: *mut AsyncTask) {
    // SAFETY: called exactly once, on the JS thread, at the terminal
    // transition; same exclusivity argument as `poll_thunk`. The raw place
    // assignment drops the previous `Some(F)` in place.
    unsafe { (*this.cast::<Storage<F>>()).future = None };
}

unsafe fn dealloc_thunk<F: Future<Output = ()>>(this: *mut AsyncTask) {
    // SAFETY: `this` was produced by `heap::into_raw(Box<Storage<F>>)` in
    // `spawn_raw`, and `refs` reached zero exactly once. The future slot is
    // already `None`, so the remaining drop is plain header bytes — safe from
    // any thread.
    unsafe { bun_core::heap::destroy(this.cast::<Storage<F>>()) };
}

// ─── effect layer (factored for headless tests) ──────────────────────────────

/// The executor's effects, separated from the wake/poll state machine so the
/// protocol is unit-testable without a live VM. Production uses
/// [`LoopSchedule`]; tests inject a recorder.
trait Schedule {
    /// Push onto the owning loop's JS-thread FIFO. JS thread only.
    unsafe fn enqueue_local(this: *mut AsyncTask);
    /// Push onto the concurrent MPSC queue + wake the loop. Any thread.
    unsafe fn enqueue_concurrent(this: *mut AsyncTask);
    /// Release the event-loop keepalive at a terminal transition. JS thread only.
    unsafe fn release_keep_alive(this: *mut AsyncTask);
}

/// Production effects: the real event loop.
struct LoopSchedule;

impl Schedule for LoopSchedule {
    unsafe fn enqueue_local(this: *mut AsyncTask) {
        // SAFETY: field read of the `Copy` handle; `event_loop` is immutable
        // after spawn.
        let event_loop = unsafe { (*this).event_loop };
        // Forms a transient `&mut jsc::EventLoop` inside the link impl — the
        // same re-entrant discipline as every task body that enqueues during
        // a tick (cf. `dispatch::run_task` arms running JS while the drain
        // loop's borrows exist).
        event_loop.enqueue_task(Task::init(this));
    }

    unsafe fn enqueue_concurrent(this: *mut AsyncTask) {
        // SAFETY: exclusive access to the embedded node — only the wake that
        // won the IDLE→SCHEDULED CAS reaches an enqueue, and any prior
        // enqueue's node was fully consumed before the task could return to
        // IDLE (see the field's doc comment).
        let node = unsafe { &mut (*this).concurrent };
        node.from(this, AutoDeinit::ManualDeinit);
        // SAFETY: same immutable-field read as `enqueue_local`.
        let event_loop = unsafe { (*this).event_loop };
        // `enqueue_task_concurrent` is the `&self` thread-safe surface:
        // lock-free MPSC push, then `us_wakeup_loop` (lost-wakeup-proof via
        // the loop's `pending_wakeups` handshake).
        event_loop.enqueue_task_concurrent(NonNull::from(node));
    }

    unsafe fn release_keep_alive(this: *mut AsyncTask) {
        // SAFETY: terminal transitions run on the JS thread only; no waker
        // touches `keep_alive`, so the field projection is exclusive.
        let keep_alive = unsafe { &mut (*this).keep_alive };
        keep_alive.unref(bun_io::js_vm_ctx());
    }
}

// ─── refcounting ─────────────────────────────────────────────────────────────

unsafe fn ref_inc(this: *mut AsyncTask) {
    // SAFETY: shared projection of the atomic field only.
    let refs = unsafe { &(*this).refs };
    let prev = refs.fetch_add(1, ORD);
    debug_assert!(prev < u32::MAX / 2, "AsyncTask refcount overflow");
}

unsafe fn ref_dec(this: *mut AsyncTask) {
    // SAFETY: shared projection of the atomic field only.
    let refs = unsafe { &(*this).refs };
    if refs.fetch_sub(1, ORD) == 1 {
        // SAFETY: immutable field, valid until dealloc — which is exactly
        // what this last-reference path performs, once.
        let vtable = unsafe { (*this).vtable };
        // SAFETY: `refs` hit zero: no queue slot, no waker, no task ref
        // remain; the future was dropped at the terminal transition.
        unsafe { (vtable.dealloc)(this) };
    }
}

// ─── wake ────────────────────────────────────────────────────────────────────

unsafe fn on_js_thread(this: *mut AsyncTask) -> bool {
    // SAFETY: `js_thread` is immutable after spawn.
    let js_thread = unsafe { (*this).js_thread };
    std::thread::current().id() == js_thread
}

unsafe fn wake_with<S: Schedule>(this: *mut AsyncTask) {
    // SAFETY: shared projection of the atomic field only.
    let state = unsafe { &(*this).state };
    let mut current = state.load(ORD);
    loop {
        match current {
            IDLE => match state.compare_exchange(IDLE, SCHEDULED, ORD, ORD) {
                Ok(_) => {
                    // Take the queue reference BEFORE enqueueing: once the
                    // task is visible to the consumer it may run, complete,
                    // and release while we are still here.
                    // SAFETY: caller holds a reference (waker or task ref),
                    // so `this` is live.
                    unsafe { ref_inc(this) };
                    // SAFETY: we won the CAS — sole enqueuer for this cycle.
                    if unsafe { on_js_thread(this) } {
                        // SAFETY: on the JS thread (just checked).
                        unsafe { S::enqueue_local(this) };
                    } else {
                        // SAFETY: any-thread surface.
                        unsafe { S::enqueue_concurrent(this) };
                    }
                    return;
                }
                Err(actual) => current = actual,
            },
            RUNNING => match state.compare_exchange(RUNNING, NOTIFIED, ORD, ORD) {
                // The poll exit observes NOTIFIED and re-enqueues; no queue
                // traffic from this thread.
                Ok(_) => return,
                Err(actual) => current = actual,
            },
            SCHEDULED | NOTIFIED | COMPLETE | CLOSED => return,
            _ => unreachable!("AsyncTask.state corrupted: {current}"),
        }
    }
}

// ─── waker vtable ────────────────────────────────────────────────────────────

fn raw_waker_vtable<S: Schedule>() -> &'static RawWakerVTable {
    // Nested fns can't capture the enclosing `S`; each takes it explicitly.
    unsafe fn clone_waker<S: Schedule>(data: *const ()) -> RawWaker {
        let this = data.cast_mut().cast::<AsyncTask>();
        // SAFETY: the cloned-from waker holds a reference, so `this` is live.
        unsafe { ref_inc(this) };
        RawWaker::new(data, raw_waker_vtable::<S>())
    }
    unsafe fn wake<S: Schedule>(data: *const ()) {
        let this = data.cast_mut().cast::<AsyncTask>();
        // SAFETY: this waker holds a reference (consumed below).
        unsafe { wake_with::<S>(this) };
        // SAFETY: consumes this waker's reference.
        unsafe { ref_dec(this) };
    }
    unsafe fn wake_by_ref<S: Schedule>(data: *const ()) {
        // SAFETY: this waker holds a reference for the duration of the call.
        unsafe { wake_with::<S>(data.cast_mut().cast::<AsyncTask>()) };
    }
    unsafe fn drop_waker(data: *const ()) {
        // SAFETY: releases this waker's reference.
        unsafe { ref_dec(data.cast_mut().cast::<AsyncTask>()) };
    }
    const {
        &RawWakerVTable::new(
            clone_waker::<S>,
            wake::<S>,
            wake_by_ref::<S>,
            drop_waker,
        )
    }
}

// ─── poll (dispatch entry) ───────────────────────────────────────────────────

unsafe fn poll_with<S: Schedule>(this: *mut AsyncTask) {
    // SAFETY: shared projection of the atomic field only.
    let state = unsafe { &(*this).state };
    // A queued task is dispatched exactly once (single consumer), and only
    // the dispatcher moves a task out of SCHEDULED — a plain swap suffices.
    let prev = state.swap(RUNNING, ORD);
    debug_assert_eq!(prev, SCHEDULED, "dispatched while not scheduled");

    // Borrowed waker: the queue reference we hold outlives this poll, so the
    // waker needs no refcount of its own; clones taken by the future go
    // through `clone_waker` and count normally. `ManuallyDrop` skips the
    // vtable drop that would release a reference we never took.
    let waker = ManuallyDrop::new(
        // SAFETY: vtable contract upheld by the fns in `raw_waker_vtable`;
        // `this` is live for the duration (queue ref).
        unsafe { Waker::from_raw(RawWaker::new(this.cast_const().cast::<()>(), raw_waker_vtable::<S>())) },
    );
    let mut cx = Context::from_waker(&waker);

    // SAFETY: immutable field.
    let vtable = unsafe { (*this).vtable };
    // SAFETY: state is RUNNING — exclusive future access (see `poll_thunk`).
    // The poll body may call into JS and re-enter the event loop through
    // TLS; we hold no `&`/`&mut` to any of it (raw projections only).
    match unsafe { (vtable.poll)(this, &mut cx) } {
        Poll::Ready(()) => {
            // SAFETY: terminal transition, JS thread, exclusive (RUNNING).
            unsafe { (vtable.drop_future)(this) };
            // SAFETY: JS thread; terminal transition runs once.
            unsafe { S::release_keep_alive(this) };
            // Wakes racing this store saw RUNNING (→ NOTIFIED, no enqueue) or
            // see COMPLETE (no-op); either way no queue traffic after this.
            state.store(COMPLETE, ORD);
            // SAFETY: releases the queue reference, then the task reference.
            unsafe { ref_dec(this) };
            // SAFETY: ditto — header stays valid until the final ref_dec.
            unsafe { ref_dec(this) };
        }
        Poll::Pending => {
            match state.compare_exchange(RUNNING, IDLE, ORD, ORD) {
                // Parked: a leaf future stored the waker. Release the queue
                // reference; outstanding wakers keep the task alive.
                // SAFETY: releases the queue reference.
                Ok(_) => unsafe { ref_dec(this) },
                Err(actual) => {
                    // Woken mid-poll. Keep the queue reference and go around
                    // again. Note: lands in the live FIFO, so a future that
                    // self-wakes every poll re-runs within the current tick
                    // (nextTick-like). Use [`yield_now`] judiciously.
                    debug_assert_eq!(actual, NOTIFIED);
                    state.store(SCHEDULED, ORD);
                    // SAFETY: poll runs on the JS thread.
                    unsafe { S::enqueue_local(this) };
                }
            }
        }
    }
}

unsafe fn release_with<S: Schedule>(this: *mut AsyncTask) {
    // SAFETY: shared projection of the atomic field only.
    let state = unsafe { &(*this).state };
    let prev = state.swap(CLOSED, ORD);
    debug_assert_eq!(prev, SCHEDULED, "shutdown release of a non-queued task");
    // SAFETY: immutable field.
    let vtable = unsafe { (*this).vtable };
    // SAFETY: JS thread (shutdown drain), exclusive — the task was queued, so
    // no poll is running and wakes are atomic-only.
    unsafe { (vtable.drop_future)(this) };
    // SAFETY: JS thread; terminal transition runs once.
    unsafe { S::release_keep_alive(this) };
    // SAFETY: releases the queue reference held since the enqueue, then the
    // task reference. Waker clones parked elsewhere release theirs later;
    // the header is plain bytes by then.
    unsafe { ref_dec(this) };
    // SAFETY: ditto.
    unsafe { ref_dec(this) };
}

impl AsyncTask {
    /// Poll the spawned future once. Called by `bun_runtime::dispatch::run_task`
    /// for `task_tag::AsyncTask`. ([`spawn`] performs the eager first poll
    /// through the same entry path, minus the queue hop.)
    ///
    /// # Safety
    /// `this` must be the live header of a `SCHEDULED` task popped from the
    /// event loop's FIFO, on the JS thread.
    pub unsafe fn run_from_js(this: *mut AsyncTask) {
        // SAFETY: per fn contract.
        unsafe { poll_with::<LoopSchedule>(this) };
    }

    /// Drop a queued-but-never-dispatched task at VM shutdown. Called by
    /// `bun_runtime::dispatch::__bun_release_task_at_shutdown`.
    ///
    /// # Safety
    /// `this` must be the live header of a queued (`SCHEDULED`) task drained
    /// from the event loop's queues during shutdown, on the JS thread, before
    /// JSC handle teardown (the future may hold `Strong`s).
    pub unsafe fn release_at_shutdown(this: *mut AsyncTask) {
        // SAFETY: per fn contract.
        unsafe { release_with::<LoopSchedule>(this) };
    }
}

// ─── spawn ───────────────────────────────────────────────────────────────────

/// Allocate the pinned task storage. Caller enqueues (state starts
/// `SCHEDULED` with refs = task + queue).
fn spawn_raw<F: Future<Output = ()> + 'static>(
    event_loop: JsEventLoop,
    keep_alive: KeepAlive,
    future: F,
) -> *mut AsyncTask {
    struct VTableOf<F>(PhantomData<F>);
    impl<F: Future<Output = ()> + 'static> VTableOf<F> {
        const VTABLE: VTable = VTable {
            poll: poll_thunk::<F>,
            drop_future: drop_future_thunk::<F>,
            dealloc: dealloc_thunk::<F>,
        };
    }
    let storage = bun_core::heap::into_raw(Box::new(Storage::<F> {
        header: AsyncTask {
            state: AtomicU32::new(SCHEDULED),
            refs: AtomicU32::new(2),
            event_loop,
            js_thread: std::thread::current().id(),
            concurrent: ConcurrentTask::default(),
            keep_alive,
            vtable: &VTableOf::<F>::VTABLE,
        },
        future: Some(future),
    }));
    storage.cast::<AsyncTask>()
}

/// Spawn a future onto the current thread's JS event loop.
///
/// **Eager, like a JS promise executor**: the first poll runs synchronously,
/// before `spawn` returns — code ahead of the first `.await` (scheduling pool
/// work, issuing I/O) executes immediately, exactly when a hand-rolled task
/// would have started it. When work begins is observable API surface; a
/// lazy first poll would silently defer it by a queue turn. Subsequent polls
/// are driven by wakes through the task queue.
///
/// JS thread only (panics otherwise, via [`JsEventLoop::current`]). The
/// future is polled and dropped on the JS thread; it may capture `!Send`
/// JS-thread state, which **must** be GC-rooted across `.await` points
/// (`Strong`/`JsRef` — never a bare `JSValue`). The pending task holds an
/// event-loop keepalive, so the process stays alive until it completes.
pub fn spawn<F>(future: F)
where
    F: Future<Output = ()> + 'static,
{
    let event_loop = JsEventLoop::current();
    let mut keep_alive = KeepAlive::init();
    keep_alive.ref_(bun_io::js_vm_ctx());
    let this = spawn_raw(event_loop, keep_alive, future);
    // SAFETY: freshly allocated SCHEDULED task on the JS thread — the eager
    // first poll consumes the SCHEDULED state exactly as a queue dispatch
    // would; the state machine does not distinguish the two entry paths.
    unsafe { poll_with::<LoopSchedule>(this) };
}

// ─── yield_now ───────────────────────────────────────────────────────────────

/// Cooperatively yield: wake immediately and return `Pending` once.
///
/// The re-poll happens within the **current** tick (the re-enqueue lands in
/// the live FIFO), so this yields to other queued tasks and microtasks — it
/// does not reach the I/O poll. A "yield past I/O" awaits a 0-deadline timer
/// instead (ships with the timer leaf future).
pub fn yield_now() -> YieldNow {
    YieldNow { yielded: false }
}

pub struct YieldNow {
    yielded: bool,
}

impl Future for YieldNow {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.yielded {
            Poll::Ready(())
        } else {
            self.yielded = true;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::{AtomicBool, AtomicUsize};
    use std::cell::Cell;
    use std::rc::Rc;

    // Pure-atomic test plumbing: `std::sync` locks are disallowed
    // workspace-wide, and `bun_threading`'s futex paths are FFI Miri can't
    // interpret — so both the test serializer and the enqueue recorder are
    // lock-free.

    /// Serializes tests (the recorder below is a process-global).
    struct SerialGuard;
    static SERIAL: AtomicBool = AtomicBool::new(false);
    impl SerialGuard {
        fn acquire() -> SerialGuard {
            while SERIAL.swap(true, Ordering::Acquire) {
                std::thread::yield_now();
            }
            SerialGuard
        }
    }
    impl Drop for SerialGuard {
        fn drop(&mut self) {
            SERIAL.store(false, Ordering::Release);
        }
    }

    /// Lock-free enqueue recorder: each slot is `addr | (local as usize)` —
    /// `AsyncTask` is pointer-aligned, so bit 0 is free for the path flag.
    const RECORD_CAP: usize = 64;
    static RECORDS: [AtomicUsize; RECORD_CAP] = [const { AtomicUsize::new(0) }; RECORD_CAP];
    static RECORD_LEN: AtomicUsize = AtomicUsize::new(0);

    fn record(this: *mut AsyncTask, local: bool) {
        let i = RECORD_LEN.fetch_add(1, Ordering::AcqRel);
        assert!(i < RECORD_CAP, "test recorder overflow");
        RECORDS[i].store(this.addr() | usize::from(local), Ordering::Release);
    }

    fn drain_enqueued() -> Vec<(usize, bool)> {
        let n = RECORD_LEN.swap(0, Ordering::AcqRel);
        (0..n)
            .map(|i| {
                let v = RECORDS[i].swap(0, Ordering::AcqRel);
                (v & !1, v & 1 == 1)
            })
            .collect()
    }

    struct TestSchedule;
    impl Schedule for TestSchedule {
        unsafe fn enqueue_local(this: *mut AsyncTask) {
            record(this, true);
        }
        unsafe fn enqueue_concurrent(this: *mut AsyncTask) {
            record(this, false);
        }
        unsafe fn release_keep_alive(_this: *mut AsyncTask) {}
    }

    /// Fabricated handle: `TestSchedule` never dispatches through it.
    fn dead_event_loop() -> JsEventLoop {
        // SAFETY: never dereferenced — every effect goes through TestSchedule.
        unsafe { JsEventLoop::new(crate::JsEventLoopKind::Jsc, core::ptr::null_mut::<()>()) }
    }

    fn test_spawn<F: Future<Output = ()> + 'static>(future: F) -> *mut AsyncTask {
        spawn_raw(dead_event_loop(), KeepAlive::init(), future)
    }

    unsafe fn state_of(this: *mut AsyncTask) -> u32 {
        // SAFETY: test holds the task ref.
        unsafe { &(*this).state }.load(ORD)
    }
    unsafe fn refs_of(this: *mut AsyncTask) -> u32 {
        // SAFETY: test holds the task ref.
        unsafe { &(*this).refs }.load(ORD)
    }

    /// `Pending` `n` times (waking itself each time), then `Ready`. Sets
    /// `dropped` from `Drop` so tests can observe the in-place future drop.
    struct Yields {
        left: u32,
        dropped: Rc<Cell<bool>>,
    }
    impl Future for Yields {
        type Output = ();
        fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
            if self.left == 0 {
                Poll::Ready(())
            } else {
                self.left -= 1;
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        }
    }
    impl Drop for Yields {
        fn drop(&mut self) {
            self.dropped.set(true);
        }
    }

    /// Pending forever; clones and stashes its waker like a leaf future.
    struct Park {
        waker_out: Rc<Cell<Option<Waker>>>,
    }
    impl Future for Park {
        type Output = ();
        fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
            self.waker_out.set(Some(cx.waker().clone()));
            Poll::Pending
        }
    }

    #[test]
    fn full_lifecycle_drives_to_completion_and_drops() {
        let _guard = SerialGuard::acquire();
        drain_enqueued();

        let dropped = Rc::new(Cell::new(false));
        let this = test_spawn(Yields {
            left: 2,
            dropped: Rc::clone(&dropped),
        });
        // Pump exactly like the dispatch arm would: poll whenever queued.
        // Yields wakes DURING the poll, exercising RUNNING→NOTIFIED→re-enqueue.
        let mut polls = 0u32;
        // The initial enqueue is the caller's job (spawn() does it in prod).
        // SAFETY: freshly spawned SCHEDULED task.
        unsafe { TestSchedule::enqueue_local(this) };
        loop {
            let batch = drain_enqueued();
            if batch.is_empty() {
                break;
            }
            // The state machine permits at most one outstanding enqueue.
            assert_eq!(batch.len(), 1);
            let (addr, local) = batch[0];
            assert_eq!(addr, this.addr());
            assert!(local, "all wakes here happen on the test (JS) thread");
            polls += 1;
            // SAFETY: queued task, single consumer (this loop).
            unsafe { poll_with::<TestSchedule>(this) };
        }
        assert_eq!(polls, 3, "initial poll + two yield re-polls");
        assert!(dropped.get(), "future dropped in place on Ready");
        // refs hit zero inside the last poll (queue + task refs released);
        // the allocation is gone — nothing further to assert through `this`.
    }

    #[test]
    fn parked_task_wakes_once_from_many_threads() {
        let _guard = SerialGuard::acquire();
        drain_enqueued();

        let waker_out = Rc::new(Cell::new(None));
        let this = test_spawn(Park {
            waker_out: Rc::clone(&waker_out),
        });
        // SAFETY: freshly spawned SCHEDULED task.
        unsafe { TestSchedule::enqueue_local(this) };
        drain_enqueued();
        // SAFETY: queued task, single consumer.
        unsafe { poll_with::<TestSchedule>(this) };
        // SAFETY: test owns the task ref.
        assert_eq!(unsafe { state_of(this) }, IDLE);
        let waker = waker_out.take().expect("Park stored its waker");
        // task ref + stored waker clone.
        // SAFETY: test owns the task ref.
        assert_eq!(unsafe { refs_of(this) }, 2);

        // Hammer wake from 8 foreign threads; exactly one enqueue may land.
        let barrier = std::sync::Barrier::new(8);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let waker = waker.clone();
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    for _ in 0..1000 {
                        waker.wake_by_ref();
                    }
                });
            }
        });
        let enqueued = drain_enqueued();
        assert_eq!(enqueued.len(), 1, "wake is idempotent while SCHEDULED");
        assert!(!enqueued[0].1, "foreign-thread wake takes the concurrent path");
        // SAFETY: test owns the task ref.
        assert_eq!(unsafe { state_of(this) }, SCHEDULED);

        // Complete it: poll Park again (it parks again), then drop wakers and
        // finish via a fresh wake → poll cycle is unnecessary — instead close
        // the cycle by polling (re-parks, releasing the queue ref) and
        // letting the waker drops free the task after a terminal transition.
        // SAFETY: queued task, single consumer.
        unsafe { poll_with::<TestSchedule>(this) };
        // Parked again with a fresh waker stored; release everything via the
        // shutdown path after a synthetic wake puts it back in the queue.
        let waker2 = waker_out.take().expect("Park stored a second waker");
        waker2.wake();
        let enqueued = drain_enqueued();
        assert_eq!(enqueued.len(), 1);
        // SAFETY: queued (SCHEDULED) task on the consumer thread.
        unsafe { release_with::<TestSchedule>(this) };
        // Remaining refs: the original `waker` clone (waker2 was consumed by
        // `wake()`). Dropping it frees the allocation (not observable here;
        // ASAN/LSan in CI assert it).
        drop(waker);
    }

    #[test]
    fn eager_first_poll_runs_without_queue_hop() {
        let _guard = SerialGuard::acquire();
        drain_enqueued();

        // `spawn` polls the fresh SCHEDULED task directly — no enqueue before
        // the first poll. Work ahead of the first await (here: Yields' wake)
        // must happen during that synchronous poll.
        let dropped = Rc::new(Cell::new(false));
        let this = test_spawn(Yields {
            left: 1,
            dropped: Rc::clone(&dropped),
        });
        // SAFETY: freshly spawned SCHEDULED task on the consumer thread —
        // the eager-poll entry path `spawn` uses.
        unsafe { poll_with::<TestSchedule>(this) };
        // The mid-poll self-wake re-enqueued it (the only enqueue so far).
        let enqueued = drain_enqueued();
        assert_eq!(enqueued.len(), 1, "eager poll itself never enqueues");
        assert!(!dropped.get());
        // SAFETY: queued task, single consumer.
        unsafe { poll_with::<TestSchedule>(this) };
        assert!(dropped.get(), "completed on the wake-driven second poll");
        assert!(drain_enqueued().is_empty());
    }

    #[test]
    fn wake_after_complete_is_noop() {
        let _guard = SerialGuard::acquire();
        drain_enqueued();

        let waker_out = Rc::new(Cell::new(None));
        let this = test_spawn(Park {
            waker_out: Rc::clone(&waker_out),
        });
        // SAFETY: freshly spawned SCHEDULED task.
        unsafe { TestSchedule::enqueue_local(this) };
        drain_enqueued();
        // SAFETY: queued task, single consumer.
        unsafe { poll_with::<TestSchedule>(this) };
        let waker = waker_out.take().expect("stored");

        // Drive to CLOSED via wake → shutdown release.
        waker.wake_by_ref();
        drain_enqueued();
        // SAFETY: queued (SCHEDULED) task on the consumer thread.
        unsafe { release_with::<TestSchedule>(this) };

        // The header is still alive (we hold `waker`); wakes must be no-ops.
        waker.wake_by_ref();
        waker.wake_by_ref();
        assert!(drain_enqueued().is_empty(), "wake after CLOSED is a no-op");
        drop(waker);
    }

    /// `Pending` (storing the waker) until `ready` is set, then `Ready`.
    struct ReadyWhen {
        ready: Rc<Cell<bool>>,
        dropped: Rc<Cell<bool>>,
        waker_out: Rc<Cell<Option<Waker>>>,
    }
    impl Future for ReadyWhen {
        type Output = ();
        fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
            if self.ready.get() {
                Poll::Ready(())
            } else {
                self.waker_out.set(Some(cx.waker().clone()));
                Poll::Pending
            }
        }
    }
    impl Drop for ReadyWhen {
        fn drop(&mut self) {
            self.dropped.set(true);
        }
    }

    #[test]
    fn wakes_racing_completion_never_enqueue_twice() {
        let _guard = SerialGuard::acquire();
        drain_enqueued();

        let ready = Rc::new(Cell::new(false));
        let dropped = Rc::new(Cell::new(false));
        let waker_out = Rc::new(Cell::new(None));
        let this = test_spawn(ReadyWhen {
            ready: Rc::clone(&ready),
            dropped: Rc::clone(&dropped),
            waker_out: Rc::clone(&waker_out),
        });
        // SAFETY: freshly spawned SCHEDULED task.
        unsafe { TestSchedule::enqueue_local(this) };
        drain_enqueued();
        // SAFETY: queued task, single consumer.
        unsafe { poll_with::<TestSchedule>(this) };
        let waker = waker_out.take().expect("stored");
        ready.set(true);

        // Foreign threads hammer wakes while the consumer thread performs the
        // Ready transition. The state machine must allow exactly ONE enqueue
        // (the one that moves IDLE→SCHEDULED); wakes during RUNNING coalesce
        // into NOTIFIED and wakes after COMPLETE are no-ops — so the future
        // is polled exactly once more, and never after it was dropped.
        let barrier = std::sync::Barrier::new(5);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                let waker = waker.clone();
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    for _ in 0..500 {
                        waker.wake_by_ref();
                    }
                });
            }
            barrier.wait();
            // Spin until the single enqueue lands, then dispatch it.
            while RECORD_LEN.load(Ordering::Acquire) == 0 {
                std::thread::yield_now();
            }
            drain_enqueued();
            // SAFETY: queued task, single consumer.
            unsafe { poll_with::<TestSchedule>(this) };
        });
        assert!(dropped.get(), "future dropped at the Ready transition");
        assert!(
            drain_enqueued().is_empty(),
            "no wake after COMPLETE may enqueue"
        );
        drop(waker);
    }

    #[test]
    fn last_waker_ref_dropped_off_thread_deallocs() {
        let _guard = SerialGuard::acquire();
        drain_enqueued();

        let waker_out = Rc::new(Cell::new(None));
        let this = test_spawn(Park {
            waker_out: Rc::clone(&waker_out),
        });
        // SAFETY: freshly spawned SCHEDULED task.
        unsafe { TestSchedule::enqueue_local(this) };
        drain_enqueued();
        // SAFETY: queued task, single consumer.
        unsafe { poll_with::<TestSchedule>(this) };
        let waker = waker_out.take().expect("stored");
        let keepalive_clone = waker.clone();

        // Re-queue (consumes `waker`), then close on the consumer thread.
        waker.wake();
        drain_enqueued();
        // SAFETY: queued (SCHEDULED) task on the consumer thread.
        unsafe { release_with::<TestSchedule>(this) };

        // The future is gone (dropped on the "JS" thread above); the header
        // is plain bytes. The LAST reference is dropped on a foreign thread,
        // which must be a valid place to free the allocation. Miri verifies
        // the cross-thread dealloc.
        std::thread::scope(|scope| {
            scope.spawn(move || drop(keepalive_clone));
        });
    }

    #[test]
    fn waker_clone_refcounts_balance() {
        let _guard = SerialGuard::acquire();
        drain_enqueued();

        let waker_out = Rc::new(Cell::new(None));
        let this = test_spawn(Park {
            waker_out: Rc::clone(&waker_out),
        });
        // SAFETY: freshly spawned SCHEDULED task.
        unsafe { TestSchedule::enqueue_local(this) };
        drain_enqueued();
        // SAFETY: queued task, single consumer.
        unsafe { poll_with::<TestSchedule>(this) };
        let waker = waker_out.take().expect("stored");
        // SAFETY: test owns the task ref.
        let baseline = unsafe { refs_of(this) };

        let clones: Vec<Waker> = (0..16).map(|_| waker.clone()).collect();
        // SAFETY: test owns the task ref.
        assert_eq!(unsafe { refs_of(this) }, baseline + 16);
        drop(clones);
        // SAFETY: test owns the task ref.
        assert_eq!(unsafe { refs_of(this) }, baseline);

        // Tear down: queue it, then release.
        waker.wake();
        drain_enqueued();
        // SAFETY: queued (SCHEDULED) task on the consumer thread.
        unsafe { release_with::<TestSchedule>(this) };
    }
}
