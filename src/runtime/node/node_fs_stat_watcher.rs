use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::thread::{self, ThreadId};
use std::time::Instant;

use bun_core::strings;
use bun_core::{Timespec, TimespecMockMode, ZBox, ZStr};
use bun_event_loop::ConcurrentTask::{ConcurrentTask, Task};
use bun_io::KeepAlive;
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::node::PathLike;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, WorkPool,
    WorkPoolTask,
};
use bun_paths::resolve_path::{self as Path, platform};
use bun_ptr::{BackRef, OwnedRef, ParentRef, RefPtr, ScopedRef, ThreadSafeRefCount};
use bun_resolver::fs;
use bun_sys::{self, PosixStat};
use bun_threading::unbounded_queue::BatchIterator;
use bun_threading::{Guarded, UnboundedQueue};

use crate::node::stat::{StatsBig, StatsSmall};
use crate::node::types::PathLikeExt;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(StatWatcher, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(StatWatcher, $($arg)*) };
}

fn stat_to_js_stats(
    global_this: &JSGlobalObject,
    stats: &PosixStat,
    bigint: bool,
) -> JsResult<JSValue> {
    if bigint {
        StatsBig::init(stats).to_js(global_this)
    } else {
        StatsSmall::init(stats).to_js(global_this)
    }
}

/// This is a singleton struct that contains the timer used to schedule re-stat calls.
#[derive(bun_ptr::ThreadSafeRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct StatWatcherScheduler {
    current_interval: AtomicI32,
    /// Set by `timer_callback` immediately before scheduling `work_pool_callback`
    /// on the thread pool, cleared by `work_pool_callback` once it has finished
    /// touching `watchers`. `shutdown_for_exit` spin-waits on this so it never
    /// races the work-pool thread for the queue.
    work_pool_in_flight: AtomicBool,
    /// Set by `shutdown_for_exit`. Once true, `work_pool_callback` stops
    /// rescheduling the timer (so no `Holder` task is left stranded in the
    /// concurrent-task queue at process exit).
    is_shutdown: AtomicBool,
    task: WorkPoolTask,
    main_thread: ThreadId,
    /// JS-thread uses only (`timer_callback`).
    vm: BackRef<VirtualMachine>,
    /// How the pool thread asks the JS thread to (re)arm the timer.
    loop_handle: bun_jsc::LoopHandle,
    watchers: WatcherQueue,

    pub(crate) event_loop_timer: EventLoopTimer,

    ref_count: ThreadSafeRefCount<StatWatcherScheduler>,
}

bun_event_loop::impl_timer_owner!(StatWatcherScheduler; from_timer_ptr => event_loop_timer);

/// The scheduler's queue of watchers. Every node in it is an
/// [`OwnedRef<StatWatcher>`]: `push` stores the ref it is given and
/// [`pop_batch`](Self::pop_batch) hands the same refs back out, so dropping a
/// popped watcher is how it leaves the scheduler.
#[derive(Default)]
struct WatcherQueue(UnboundedQueue<StatWatcher>);

impl WatcherQueue {
    fn push(&self, watcher: OwnedRef<StatWatcher>) {
        let node = watcher.as_non_null();
        // The queue holds the ref from here until `WatcherBatch::next` returns it.
        watcher.into_raw();
        self.0.push(node);
    }

    fn pop_batch(&self) -> WatcherBatch {
        WatcherBatch(self.0.pop_batch().iterator())
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// The watchers one [`WatcherQueue::pop_batch`] took out of the queue, each
/// yielded together with the ref the queue held on it.
struct WatcherBatch(BatchIterator<StatWatcher>);

impl Iterator for WatcherBatch {
    type Item = OwnedRef<StatWatcher>;

    fn next(&mut self) -> Option<OwnedRef<StatWatcher>> {
        let node = self.0.next();
        if node.is_null() {
            return None;
        }
        // SAFETY: every node in the queue was put there by `WatcherQueue::push`,
        // which stored the ref it was given; `pop_batch` unlinked this node, so
        // that ref has no other holder and is handed back here.
        Some(unsafe { OwnedRef::from_raw(node) })
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.0.batch.count, Some(self.0.batch.count))
    }
}

impl ExactSizeIterator for WatcherBatch {}

impl Drop for WatcherBatch {
    /// The nodes are already unlinked from the queue, so whatever a consumer
    /// did not take is released here rather than leaked.
    fn drop(&mut self) {
        self.by_ref().for_each(drop);
    }
}

// Intrusive `next`-link accessors for `UnboundedQueue<StatWatcher>`.
//
// SAFETY: all four route through the same `next: *mut StatWatcher` field; the
// atomic variants reinterpret it as `AtomicPtr<StatWatcher>` (same size/align,
// `addr_of!` preserves provenance).
unsafe impl bun_threading::Linked for StatWatcher {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

impl StatWatcherScheduler {
    /// # Safety
    /// `this` must point to a live `StatWatcherScheduler`.
    // Forwards `this` to the unsafe `ThreadSafeRefCount` helper without
    // dereferencing; not_unsafe_ptr_arg_deref is a false positive on
    // opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    #[inline]
    pub fn ref_(this: *mut Self) {
        // SAFETY: per fn contract.
        unsafe { ThreadSafeRefCount::<Self>::ref_(this) };
    }

    /// Borrow the per-thread `VirtualMachine` this scheduler is bound to.
    ///
    /// `vm` is a `BackRef` (JSC_BORROW): the VM owns the event loop / timer
    /// heap that drives this scheduler and outlives it.
    #[inline]
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    pub(crate) fn init(vm: *mut VirtualMachine) -> RefPtr<StatWatcherScheduler> {
        RefPtr::new(StatWatcherScheduler {
            current_interval: AtomicI32::new(0),
            work_pool_in_flight: AtomicBool::new(false),
            is_shutdown: AtomicBool::new(false),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::work_pool_callback,
            },
            main_thread: thread::current().id(),
            // JSC_BORROW: `vm` is the live per-thread VM (never null).
            vm: BackRef::from(core::ptr::NonNull::new(vm).expect("vm")),
            // SAFETY: `vm` is the live per-thread VM; this runs on its thread.
            loop_handle: unsafe { (*vm).loop_handle() },
            watchers: WatcherQueue::default(),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::StatWatcherScheduler),
            ref_count: ThreadSafeRefCount::init(),
        })
    }

    // Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
    // whose generated trait `destructor` upholds the sole-owner contract
    // (called only when ref_count reaches zero; `this` was Box-allocated by RefPtr::new).
    fn deinit(this: *mut StatWatcherScheduler) {
        // BACKREF — `this` is the live ref-counted scheduler (last ref); wrap
        // once so the field reads below go through safe `ParentRef` Deref.
        let this_ref = ParentRef::from(NonNull::new(this).expect("deinit: scheduler"));
        assert!(
            this_ref.watchers.is_empty(),
            "destroying StatWatcherScheduler while it still has watchers",
        );
        // SAFETY: refcount reached zero, so `this` is the sole remaining
        // reference; heap::take reclaims and drops the allocation.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// Queue `watcher`; the ref passed in becomes the queue's and is dropped
    /// once the pool finds the watcher closed (or at `shutdown_for_exit`).
    ///
    /// `this` must point to a live `StatWatcherScheduler` (caller holds a ref).
    pub(crate) fn append(this: *mut Self, watcher: OwnedRef<StatWatcher>) {
        log!(
            "append new watcher {}",
            bstr::BStr::new(watcher.path.as_bytes())
        );
        debug_assert!(!watcher.closed.load(Ordering::Relaxed));
        debug_assert!(watcher.next.is_null());
        let interval = watcher.interval;

        // BACKREF — `this` is live (caller holds a ref).
        let this_ref = ParentRef::from(NonNull::new(this).expect("append: scheduler"));
        log!("push watcher {:x}", watcher.as_ptr() as usize);
        this_ref.watchers.push(watcher);
        let current = this_ref.get_interval();
        if current == 0 || current > interval {
            // we are not running or the new watcher has a smaller interval
            Self::set_interval(this, interval);
        }
    }

    fn get_interval(&self) -> i32 {
        self.current_interval.load(Ordering::Relaxed)
    }

    /// Update the current interval and set the timer (this function is thread safe)
    fn set_interval(this: *mut Self, interval: i32) {
        // BACKREF — `this` is live (caller holds a ref); `ParentRef` Deref
        // gives safe `&Self` for the atomic store / thread-id check below.
        let this_ref = ParentRef::from(NonNull::new(this).expect("set_interval: scheduler"));
        this_ref.current_interval.store(interval, Ordering::Relaxed);

        if this_ref.main_thread == thread::current().id() {
            // we are in the main thread we can set the timer
            Self::set_timer(this, interval);
            return;
        }
        // we are not in the main thread we need to schedule a task to set the timer
        Self::schedule_timer_update(this);
    }

    /// Set the timer (this function is not thread safe, should be called only from the main thread)
    fn set_timer(this: *mut Self, interval: i32) {
        // jsc/runtime crate cycle: `vm.timer: api.Timer.All` lives in `RuntimeState` (this crate),
        // not as a value field on the low-tier `VirtualMachine`. Recover it via
        // the per-thread `runtime_state()` (single JS thread; see jsc_hooks.rs).
        // SAFETY: main-thread-only per fn contract; `runtime_state()` is non-null
        // after `bun_runtime::init()`. Raw-ptr-per-field re-entry pattern.
        let timer_all = unsafe { &mut (*crate::jsc_hooks::runtime_state()).timer };
        // SAFETY: `this` is live — the caller holds a ref (`set_interval`'s
        // BACKREF, or `update_timer`'s `ParentRef`).
        let elt = unsafe { core::ptr::addr_of_mut!((*this).event_loop_timer) };

        // if the interval is 0 means that we stop the timer
        if interval == 0 {
            // if the timer is active we need to remove it
            // SAFETY: `elt` is the live embedded EventLoopTimer.
            if unsafe { (*elt).state } == EventLoopTimerState::ACTIVE {
                timer_all.remove(elt);
            }
            return;
        }

        // reschedule the timer — this tag opts out of fake timers, so the
        // deadline lives in the real heap and must be in real-clock units.
        timer_all.update(
            elt,
            &Timespec::ms_from_now(TimespecMockMode::ForceRealTime, i64::from(interval)),
        );
    }

    /// Schedule a task to set the timer in the main thread
    fn schedule_timer_update(this: *mut Self) {
        let holder = Box::new(StatWatcherTimerUpdate {
            // SAFETY: `this` is the live ref'd scheduler (write provenance for
            // `set_timer`), kept alive across the hop by the watcher's RefPtr.
            scheduler: unsafe { ParentRef::from_raw_mut(this) },
        });
        // SAFETY: `this` is live (kept by the watcher's RefPtr across the hop).
        unsafe {
            let holder = bun_core::heap::into_raw(holder);
            let ct = ConcurrentTask::create(Task::new(
                <StatWatcherTimerUpdate as bun_event_loop::Taskable>::TAG,
                holder.cast::<()>(),
            ));
            // Posted from the counted pool task: the VM has not closed its handle.
            let bun_jsc::vm_handle::Posted::Queued = (*this).loop_handle.post_task(ct) else {
                unreachable!("VM handle closed with the stat scheduler's pool task outstanding");
            };
        }
    }

    pub(crate) fn timer_callback(&mut self) {
        let has_been_cleared = self.event_loop_timer.state == EventLoopTimerState::CANCELLED
            || self.vm().script_execution_status() != jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        self.event_loop_timer.heap = Default::default();

        if has_been_cleared || self.is_shutdown.load(Ordering::Relaxed) {
            return;
        }

        // `self.task` is an *intrusive* node in the WorkPool's Treiber stack.
        // Pushing it while a prior push is still linked (or `work_pool_callback`
        // is mid-run and has not yet cleared the flag) would overwrite
        // `self.task.node.next` and, with any other task interleaved between
        // the two pushes, form a cycle in the run queue. `Buffer::consume`
        // then fills a worker's 256-slot ring with repeated copies of every
        // node in the cycle, so any `AsyncFSTask` caught in it is dispatched
        // many times and runs on freed memory after the first completion
        // reaches `destroy()` on the JS thread (observed as a null-deref in
        // `NodeFS::rm` → `PathLike::slice`). `append()` can re-arm this timer
        // from `initial_stat_success_on_main_thread` while `self.task` is
        // still in flight, so guard here: if already in flight, re-arm the
        // one-shot timer and try again next fire. `work_pool_callback` clears
        // the flag on exit; the re-arm must be unconditional because its
        // `!contain_watchers` branch stores `current_interval = 0` directly
        // (no `set_interval` / no timer update) and can race an `append()`
        // that landed after its `pop_batch()`, which would otherwise leave a
        // live watcher with the timer disarmed. `.max(5)` matches the clamp
        // applied to every watcher interval in `StatWatcher::init`.
        if self.work_pool_in_flight.swap(true, Ordering::AcqRel) {
            let this = core::ptr::from_mut(self);
            Self::set_timer(this, self.get_interval().max(5));
            return;
        }

        // One ref is held across the work-pool hop (released by the
        // `ScopedRef` in `work_pool_callback`). Taken here, not in
        // `set_interval`, so the count exactly tracks "task in flight" instead
        // of accumulating one leak per `set_interval(0)` / re-arm.
        // SAFETY: `self` is live (`&mut self`).
        Self::ref_(core::ptr::from_mut(self));
        // The task is a field of this per-VM scheduler: counted, so the VM
        // waits for it (see `VmHandle::embedded_work_scheduled`).
        self.loop_handle.embedded_work_scheduled();
        WorkPool::schedule(&raw mut self.task);
    }

    /// Thread-pool callback (safe fn — coerces to the `WorkPoolTask.callback`
    /// field type at the struct-init site in `init`).
    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `task` points to `StatWatcherScheduler.task` — only ever
        // invoked by the thread pool against a scheduler it scheduled in
        // `timer_callback`, so provenance covers the full allocation.
        let this: *mut StatWatcherScheduler =
            unsafe { bun_core::from_field_ptr!(StatWatcherScheduler, task, task) };
        // ref'd when the work-pool task was scheduled
        // SAFETY: `this` is live; one ref (taken in `timer_callback`) is owned
        // by this callback and adopted here.
        let _ref_guard = unsafe { ScopedRef::<StatWatcherScheduler>::adopt(this) };
        // BACKREF — `this` is alive (ref'd when the timer was scheduled);
        // `ParentRef` Deref gives safe `&Self` for the queue/interval reads.
        let this_ref = ParentRef::from(NonNull::new(this).expect("work_pool_callback: scheduler"));

        // Instant.now will not fail on our target platforms.
        let now = Instant::now();

        let batch = this_ref.watchers.pop_batch();
        log!("pop batch of {} watchers", batch.len());
        let mut min_interval: i32 = i32::MAX;
        let mut closest_next_check: u64 = u64::try_from(min_interval).expect("int cast");
        let mut contain_watchers = false;
        // `watcher` is the queue's ref. R-2: shared access only, the JS thread
        // may be running `close()` or a posted hop on the same watcher.
        for watcher in batch {
            if watcher.closed.load(Ordering::Relaxed) {
                // Dropping the queue's ref is what removes a closed watcher.
                continue;
            }
            contain_watchers = true;

            let time_since = u64::try_from(now.duration_since(watcher.last_check.get()).as_nanos())
                .expect("int cast");
            let interval = u64::try_from(watcher.interval).expect("int cast") * 1_000_000;

            if time_since >= interval.saturating_sub(500) {
                watcher.last_check.set(now);
                StatWatcher::restat(&watcher);
            } else {
                closest_next_check = (interval - time_since).min(closest_next_check);
            }
            min_interval = min_interval.min(watcher.interval);
            log!("reinsert watcher {:x}", watcher.as_ptr() as usize);
            this_ref.watchers.push(watcher);
        }

        if this_ref.is_shutdown.load(Ordering::Relaxed) {
            // Do not enqueue an `update_timer` Holder onto a JS-thread queue
            // that will never tick again.
            this_ref.current_interval.store(0, Ordering::Relaxed);
        } else if contain_watchers {
            // choose the smallest interval or the closest time to the next check
            Self::set_interval(
                this,
                min_interval.min(i32::try_from(closest_next_check).expect("int cast")),
            );
        } else {
            // we do not have watchers, we can stop the timer
            this_ref.current_interval.store(0, Ordering::Relaxed);
        }
        // Publish the queue writes above before declaring the work-pool hop
        // finished; `shutdown_for_exit` Acquire-loads this and then drains.
        this_ref.work_pool_in_flight.store(false, Ordering::Release);
        let handle = this_ref.loop_handle.clone();
        drop(_ref_guard);
        handle.embedded_work_finished();
    }

    /// Drain every queued [`StatWatcher`] and release the per-VM scheduler ref
    /// stored in `RareData`. Runs on the JS thread during `global_exit` /
    /// worker shutdown, before JSC teardown, so each watcher can still be
    /// `close()`'d (downgrades its `JsRef` Strong) and so `finalize()` —
    /// reached from `lastChanceToFinalize` — drops the last ref.
    ///
    /// Without this the queue forms a refcount cycle at exit
    /// (`scheduler.watchers` → `StatWatcher` → `StatWatcher.scheduler`) and
    /// every still-queued watcher leaks.
    ///
    /// # Safety
    /// `vm` is the live per-thread VM. Must be called on the JS thread.
    pub(crate) unsafe fn shutdown_for_exit(vm: *mut VirtualMachine) {
        // SAFETY: per fn contract; main-thread only. Touch the raw `rare_data`
        // option directly so a never-used VM does not lazy-allocate `RareData`
        // here just to find an empty slot.
        let Some(rare) = (unsafe { &mut (*vm).rare_data }).as_deref_mut() else {
            return;
        };
        let Some(raw) = core::mem::take(rare.node_fs_stat_watcher_scheduler_slot()) else {
            return;
        };
        // SAFETY: the slot held the ref `lazy_scheduler` stored with
        // `into_raw()`, and `take` above emptied it, so this value is now that
        // ref's only holder.
        let this = unsafe { OwnedRef::<StatWatcherScheduler>::from_raw(raw.as_ptr().cast()) };
        debug_assert_eq!(this.main_thread, thread::current().id());

        this.is_shutdown.store(true, Ordering::Relaxed);
        // Disarm the event-loop timer so `timer_callback` cannot schedule a new
        // work-pool task after we've waited below.
        Self::set_timer(this.as_ptr(), 0);

        // Wait for any in-flight work-pool task to finish touching `watchers`.
        // The task is bounded (one stat per queued watcher) so this is a short
        // spin in the rare case it overlaps.
        while this.work_pool_in_flight.load(Ordering::Acquire) {
            core::hint::spin_loop();
        }

        // Each iteration drops the queue's ref on its watcher.
        for watcher in this.watchers.pop_batch() {
            if !watcher.closed.load(Ordering::Relaxed) {
                // Downgrade the `JsRef` Strong so the JS wrapper becomes
                // collectible at `lastChanceToFinalize`.
                watcher.close();
            }
        }

        // `this` drops here, releasing the RareData ref. The scheduler stays
        // alive until every remaining `StatWatcher::finalize` drops its
        // `RefPtr` during `lastChanceToFinalize`; the last of those brings the
        // count to zero.
    }
}

// TODO: make this a top-level struct
//
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). `closed` is
// `AtomicBool` because it is genuinely cross-thread (written by `close()` on
// the JS thread, read by the work-pool callback). `last_check` is `Cell`
// (worker-thread-only after init); `persistent`/`poll_ref`/`this_value` are
// JS-thread-only. Read-only-after-construction fields stay bare.
#[bun_jsc::JsClass(no_constructor)]
#[derive(bun_ptr::ThreadSafeRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct StatWatcher {
    pub(crate) next: bun_threading::Link<StatWatcher>, // INTRUSIVE link for UnboundedQueue

    /// JS-thread uses only.
    ctx: BackRef<VirtualMachine, bun_ptr::Mut>,
    /// How the pool thread delivers stat results to the VM.
    /// The pending pool→JS hop, if any (one at a time: the initial stat, then restats).
    pending_hop: Cell<u8>,
    loop_handle: bun_jsc::LoopHandle,

    ref_count: ThreadSafeRefCount<StatWatcher>,

    /// Set to tell the scheduler to drop its queue ref instead of re-queueing.
    closed: AtomicBool,
    path: ZBox, // owned NUL-terminated path; was `[:0]u8` allocSentinel'd + freed in deinit (Drop frees)
    persistent: Cell<bool>,
    bigint: bool,
    interval: i32,
    last_check: Cell<Instant>,

    // JSC_BORROW per LIFETIMES.tsv — global outlives every watcher; `BackRef`
    // gives safe `&JSGlobalObject` projection (Deref) at every read site.
    global_this: BackRef<JSGlobalObject>,

    this_value: JsCell<JsRef>,

    poll_ref: JsCell<KeepAlive>,

    last_stat: Guarded<PosixStat>,

    scheduler: RefPtr<StatWatcherScheduler>,
}

/// `jsc.Codegen.JSStatWatcher` — cached-value accessors generated from
/// `.classes.ts`. The C++ symbols are emitted by `generate-classes.ts`; this
/// module declares them locally so callers can write `js::listener_get_cached`
/// without depending on the placeholder type in `crate::generated_classes`.
mod js {
    use super::{JSGlobalObject, JSValue};

    // `safe fn` to match the `safe fn …CachedValue` declarations
    // `generate-classes.ts` emits in `generated_classes.rs` (avoids
    // `clashing_extern_declarations`). C++ side declares these with
    // `JSC_CALLCONV` (= SysV ABI on win-x64), so import via `jsc_abi_extern!`
    // — a plain `extern "C"` block here is the wrong ABI on Windows and
    // garbages the args (Win64 puts them in rcx/rdx/r8, callee reads rdi/rsi/rdx).
    bun_jsc::jsc_abi_extern! {
        safe fn StatWatcherPrototype__listenerSetCachedValue(
            this_value: JSValue,
            global: *mut JSGlobalObject,
            value: JSValue,
        );
        safe fn StatWatcherPrototype__listenerGetCachedValue(this_value: JSValue) -> JSValue;
        safe fn StatWatcherPrototype__prevStatSetCachedValue(
            this_value: JSValue,
            global: *mut JSGlobalObject,
            value: JSValue,
        );
        safe fn StatWatcherPrototype__prevStatGetCachedValue(this_value: JSValue) -> JSValue;
    }

    #[inline]
    pub(super) fn listener_set_cached(
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        StatWatcherPrototype__listenerSetCachedValue(this_value, global.as_mut_ptr(), value)
    }
    #[inline]
    pub(super) fn listener_get_cached(this_value: JSValue) -> Option<JSValue> {
        let v = StatWatcherPrototype__listenerGetCachedValue(this_value);
        if v.is_empty() { None } else { Some(v) }
    }

    pub(super) mod gc {
        pub(crate) mod prev_stat {
            use super::super::*;
            #[inline]
            pub(crate) fn set(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
                StatWatcherPrototype__prevStatSetCachedValue(this_value, global.as_mut_ptr(), value)
            }
            #[inline]
            pub(crate) fn get(this_value: JSValue) -> Option<JSValue> {
                let v = StatWatcherPrototype__prevStatGetCachedValue(this_value);
                if v.is_empty() { None } else { Some(v) }
            }
        }
    }
}

impl StatWatcher {
    /// Safe `&JSGlobalObject` accessor for the JSC_BORROW `global_this` back-pointer.
    #[inline]
    fn global_this(&self) -> &JSGlobalObject {
        // `BackRef` invariant: global outlives every `StatWatcher` (JSC_BORROW).
        self.global_this.get()
    }

    /// Spec `RareData.nodeFSStatWatcherScheduler`. Body lives here (high tier)
    /// because `StatWatcherScheduler` cannot be named from `bun_jsc::rare_data`
    /// without a crate cycle; the slot in `RareData` is an erased
    /// `Option<NonNull<c_void>>` (§Dispatch).
    fn lazy_scheduler(vm: *mut VirtualMachine) -> RefPtr<StatWatcherScheduler> {
        // SAFETY: `vm` is the live per-thread VM; called only from the JS thread.
        let slot = unsafe { (*vm).rare_data() }.node_fs_stat_watcher_scheduler_slot();
        let raw = match *slot {
            Some(p) => p.as_ptr().cast::<StatWatcherScheduler>(),
            None => {
                let arc = StatWatcherScheduler::init(vm);
                // The slot's ref; `shutdown_for_exit` takes it back out.
                let raw = arc.into_raw();
                // SAFETY: `vm` is live; reborrow rare_data after `init` to avoid
                // an aliasing `&mut RareData` across the call.
                *unsafe { (*vm).rare_data() }.node_fs_stat_watcher_scheduler_slot() =
                    core::ptr::NonNull::new(raw.cast());
                raw
            }
        };
        // SAFETY: `raw` was produced by `into_raw` above (or on a prior call) and
        // the VM ref keeps it alive; bump the count for the caller's `dupeRef()`.
        unsafe { RefPtr::init_ref(raw) }
    }

    #[inline]
    fn ctx_el_ctx(&self) -> bun_io::EventLoopCtx {
        // SAFETY: `self.ctx` is the live per-thread VM singleton backref.
        unsafe { VirtualMachine::event_loop_ctx(self.ctx.as_ptr()) }
    }

    /// Pool thread to JS thread: the posted task carries `watcher` (one ref),
    /// and [`take_hop_ref`](Self::take_hop_ref) is where that ref comes back
    /// out, in `run_hop` or, if the VM is torn down first, in `release_unrun`.
    /// Posted from counted (embedded) pool work, so the post always queues.
    fn post_to_js_thread(watcher: OwnedRef<Self>, hop: StatWatcherHop) {
        watcher.pending_hop.set(hop as u8);
        // Non-owning view for the post itself: the task's ref keeps the watcher
        // alive until `post_task` has queued the task, and `post_task` reads
        // nothing from the watcher after that point.
        let this = watcher.this_ptr();
        let task = ConcurrentTask::create(Task::init(watcher.into_raw()));
        let bun_jsc::vm_handle::Posted::Queued = this.loop_handle.post_task(task) else {
            unreachable!("VM handle closed with stat-watcher pool work outstanding");
        };
    }

    /// JS thread: the ref a [`post_to_js_thread`](Self::post_to_js_thread)
    /// task carries, back as a value.
    ///
    /// # Safety
    /// `this` is the pointer `post_to_js_thread` queued, taken off the queue
    /// exactly once (by `run_hop` or `release_unrun`).
    unsafe fn take_hop_ref(this: *mut StatWatcher) -> OwnedRef<Self> {
        // SAFETY: fn contract: `post_to_js_thread` moved exactly one ref into
        // the task behind `this`, and this is the task's only dequeue.
        unsafe { OwnedRef::from_raw(this) }
    }

    /// JS thread dispatch of a [`post_to_js_thread`](Self::post_to_js_thread)
    /// hop. The hop's ref is released when this returns.
    ///
    /// # Safety
    /// As [`take_hop_ref`](Self::take_hop_ref).
    pub(crate) unsafe fn run_hop(this: *mut StatWatcher) -> bun_event_loop::JsResult<()> {
        // SAFETY: fn contract.
        let watcher = unsafe { Self::take_hop_ref(this) };
        match watcher.pending_hop.get() {
            x if x == StatWatcherHop::InitialStatSuccess as u8 => {
                Self::initial_stat_success_on_main_thread(&watcher)
            }
            x if x == StatWatcherHop::InitialStatError as u8 => {
                Self::initial_stat_error_on_main_thread(&watcher)
            }
            _ => watcher.swap_and_call_listener_on_main_thread(),
        }
    }

    /// Copy the last stat by value.
    ///
    /// This field is sometimes set from aonther thread, so we should copy by
    /// value instead of referencing by pointer.
    fn get_last_stat(&self) -> PosixStat {
        let value = self.last_stat.lock();
        *value
        // unlock on Drop of guard
    }

    /// Set the last stat.
    fn set_last_stat(&self, stat: &PosixStat) {
        let mut value = self.last_stat.lock();
        *value = *stat;
        // unlock on Drop of guard
    }

    // Safe fn: reachable via the `#[ref_count(destroy = …)]` derive (whose
    // generated trait `destructor` upholds the sole-owner contract) and
    // the `errdefer` scopeguard in `do_watch` (which owns the only reference
    // on the error path). Not `impl Drop` — this is a `.classes.ts` m_ctx
    // payload with intrusive refcount; teardown is driven by ref_count, and
    // `finalize()` is the GC entry point.
    fn deinit(this: *mut StatWatcher) {
        log!("deinit {:x}", this as usize);

        // BACKREF — last ref; exclusive access. R-2: all field mutation goes
        // through Cell/JsCell/Atomic so shared `&` suffices; `ParentRef` Deref
        // collapses the per-site raw deref.
        let this_ref = ParentRef::from(NonNull::new(this).expect("deinit: watcher"));

        // Isolation-registry removal lives in `close()`, NOT here: the last
        // `deref` can happen on the work-pool thread (queue ref dropped in
        // `work_pool_callback` / `InitialStatTask`), where the thread-local
        // `active_handles()` is null and the removal would silently no-op,
        // leaving a dangling registry pointer. Every deinit of a registered
        // watcher is preceded by a JS-thread `close()` (the Strong `this_value`
        // self-ref keeps the wrapper alive until `close()` downgrades it, so
        // `finalize` cannot drop the wrapper ref first).
        this_ref.persistent.set(false);
        if cfg!(debug_assertions) {
            if this_ref.poll_ref.get().is_active() {
                debug_assert!(core::ptr::eq(VirtualMachine::get(), this_ref.ctx.as_ptr())); // We cannot unref() on another thread this way.
            }
        }
        let el_ctx = this_ref.ctx_el_ctx();
        this_ref.poll_ref.with_mut(|p| p.unref(el_ctx));
        this_ref.closed.store(true, Ordering::Relaxed);
        // `this_value.deinit()` handled by JsRef Drop below; explicit reset
        // drops the Strong before dealloc.
        this_ref.this_value.set(JsRef::empty());
        // `path` freed by ZBox Drop below.

        // SAFETY: the caller is the sole owner (refcount hit zero, or the
        // error-path scopeguard in `do_watch` holds the only reference);
        // heap::take reclaims and drops the allocation.
        drop(unsafe { bun_core::heap::take(this) });
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !this.closed.load(Ordering::Relaxed) && !this.persistent.get() {
            this.persistent.set(true);
            let el_ctx = this.ctx_el_ctx();
            this.poll_ref.with_mut(|p| p.ref_(el_ctx));
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unref(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.persistent.get() {
            this.persistent.set(false);
            let el_ctx = this.ctx_el_ctx();
            this.poll_ref.with_mut(|p| p.unref(el_ctx));
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Stops file watching but does not free the instance.
    ///
    /// Always runs on the JS thread (`do_close`, `stop_active_handles_for_vm_teardown`,
    /// `shutdown_for_exit`), so this is where the watcher leaves the
    /// isolation registry — `deinit` can fire on the work-pool thread where
    /// the thread-local registry is unreachable.
    pub(crate) fn close(&self) {
        // `ctx` is a `BackRef<VirtualMachine>` (JSC_BORROW); safe Deref.
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            handles.swap_remove(&crate::jsc_hooks::ActiveHandle::StatWatcher(NonNull::from(
                self,
            )));
        }
        if self.persistent.get() {
            self.persistent.set(false);
        }
        let el_ctx = self.ctx_el_ctx();
        self.poll_ref.with_mut(|p| p.unref(el_ctx));
        self.closed.store(true, Ordering::Relaxed);
        self.this_value.with_mut(|r| r.downgrade());
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_close(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.close();
        Ok(JSValue::UNDEFINED)
    }

    /// Releases the JS wrapper's ref; the watcher is only freed once the
    /// scheduler's queue (or an in-flight task) has dropped its ref too.
    pub(crate) fn finalize(self: Box<Self>) {
        log!("Finalize\n");
        bun_ptr::finalize_js_box(self, |this| {
            this.this_value.with_mut(|r| r.finalize());
            this.closed.store(true, Ordering::Relaxed);
            this.scheduler.deref();
        });
    }

    /// `watcher` is the hop's ref (held by `run_hop`); the scheduler's queue
    /// gets a clone of it. R-2: all field access via Cell/JsCell/Atomic.
    fn initial_stat_success_on_main_thread(
        watcher: &OwnedRef<Self>,
    ) -> bun_event_loop::JsResult<()> {
        if watcher.closed.load(Ordering::Relaxed) {
            return Ok(());
        }

        let Some(js_this) = watcher.this_value.get().try_get() else {
            return Ok(());
        };
        let global_this = watcher.global_this();

        // Propagate to the dispatcher rather than swallowing: a termination
        // exception is not cleared by `report_active_exception_as_unhandled`,
        // so swallowing it here leaves the VM with an exception pending and
        // the next queued task re-enters JS under a
        // `scope.assertNoException()` RELEASE_ASSERT.
        let jsvalue = stat_to_js_stats(global_this, &watcher.get_last_stat(), watcher.bigint)
            .map_err(Into::<bun_core::JsError>::into)?;
        js::gc::prev_stat::set(js_this, global_this, jsvalue);

        StatWatcherScheduler::append(watcher.scheduler.as_ptr(), watcher.clone());
        Ok(())
    }

    /// As [`initial_stat_success_on_main_thread`](Self::initial_stat_success_on_main_thread).
    /// R-2: the listener call below re-enters JS, which may call `do_close()`
    /// and form another `&Self`; everything here is shared access too.
    fn initial_stat_error_on_main_thread(watcher: &OwnedRef<Self>) -> bun_event_loop::JsResult<()> {
        if watcher.closed.load(Ordering::Relaxed) {
            return Ok(());
        }

        let Some(js_this) = watcher.this_value.get().try_get() else {
            return Ok(());
        };
        let global_this = watcher.global_this();
        let jsvalue = stat_to_js_stats(global_this, &watcher.get_last_stat(), watcher.bigint)
            .map_err(Into::<bun_core::JsError>::into)?;
        js::gc::prev_stat::set(js_this, global_this, jsvalue);

        let result = js::listener_get_cached(js_this).unwrap().call(
            global_this,
            JSValue::UNDEFINED,
            &[jsvalue, jsvalue],
        );

        // Append to the scheduler before propagating a listener error so the
        // watcher keeps running after a throwing listener (Node semantics).
        // `append` does not enter JS, so it is safe with an exception pending.
        if !watcher.closed.load(Ordering::Relaxed) {
            StatWatcherScheduler::append(watcher.scheduler.as_ptr(), watcher.clone());
        }

        // Propagate to the dispatcher: `report_error_or_terminate` reports a
        // regular throw as uncaught and stops the tick loop on termination.
        // Swallowing the error here leaves a termination exception on the VM
        // and the next queued task re-enters JS under a
        // `scope.assertNoException()` RELEASE_ASSERT.
        result.map(drop).map_err(Into::into)
    }

    /// Pool thread. `watcher` is the queue's ref; if the file changed, a clone
    /// of it is posted to the JS thread, which runs the listener and drops it.
    fn restat(watcher: &OwnedRef<Self>) {
        log!("recalling stat");
        let stat = restat_impl(&watcher.path);
        let res = match stat {
            Ok(res) => res,
            // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
            Err(_) => bun_core::ffi::zeroed::<PosixStat>(),
        };

        let last_stat = watcher.get_last_stat();

        // Ignore atime changes when comparing stats
        // Compare field-by-field to avoid false positives from padding bytes
        if res.dev == last_stat.dev
            && res.ino == last_stat.ino
            && res.mode == last_stat.mode
            && res.nlink == last_stat.nlink
            && res.uid == last_stat.uid
            && res.gid == last_stat.gid
            && res.rdev == last_stat.rdev
            && res.size == last_stat.size
            && res.blksize == last_stat.blksize
            && res.blocks == last_stat.blocks
            && res.mtim.sec == last_stat.mtim.sec
            && res.mtim.nsec == last_stat.mtim.nsec
            && res.ctim.sec == last_stat.ctim.sec
            && res.ctim.nsec == last_stat.ctim.nsec
            && res.birthtim.sec == last_stat.birthtim.sec
            && res.birthtim.nsec == last_stat.birthtim.nsec
        {
            return;
        }

        watcher.set_last_stat(&res);
        Self::post_to_js_thread(watcher.clone(), StatWatcherHop::Changed);
    }

    /// After a restat found the file changed, this calls the listener function.
    /// Runs under the hop's ref held by `run_hop`. R-2: the listener may call
    /// `do_close()` and form another `&Self`, and the pool thread may hold one
    /// through the queue's ref; everything here is shared access.
    fn swap_and_call_listener_on_main_thread(&self) -> bun_event_loop::JsResult<()> {
        if self.closed.load(Ordering::Relaxed) {
            return Ok(());
        }
        let Some(js_this) = self.this_value.get().try_get() else {
            return Ok(());
        };
        let global_this = self.global_this();
        let prev_jsvalue = js::gc::prev_stat::get(js_this).unwrap_or(JSValue::UNDEFINED);
        let current_jsvalue = stat_to_js_stats(global_this, &self.get_last_stat(), self.bigint)
            .map_err(Into::<bun_core::JsError>::into)?;
        js::gc::prev_stat::set(js_this, global_this, current_jsvalue);

        // Propagate to the dispatcher: `report_error_or_terminate` reports a
        // regular throw as uncaught and stops the tick loop on termination.
        // Swallowing the error here leaves a termination exception on the VM
        // and the next queued task re-enters JS under a
        // `scope.assertNoException()` RELEASE_ASSERT.
        js::listener_get_cached(js_this)
            .unwrap()
            .call(
                global_this,
                JSValue::UNDEFINED,
                &[current_jsvalue, prev_jsvalue],
            )
            .map(drop)
            .map_err(Into::into)
    }

    fn init(args: &Arguments) -> Result<*mut StatWatcher, crate::Error> {
        log!("init");

        let mut buf = bun_paths::path_buffer_pool::get();
        // guard puts back on Drop
        let mut slice = args.path.slice();
        if strings::starts_with(slice, b"file://") {
            slice = &slice[b"file://".len()..];
        }

        // SAFETY: `FileSystem::instance()` is initialized at process start
        // (`FileSystem::init` runs before any JS module loads).
        let top_level_dir = fs::FileSystem::get().top_level_dir;
        let parts: [&[u8]; 1] = [slice];
        let file_path =
            Path::join_abs_string_buf::<platform::Auto>(top_level_dir, &mut buf[..], &parts);

        // allocSentinel + memcpy → owned NUL-terminated copy (ZBox)
        let alloc_file_path = ZBox::from_bytes(file_path);
        // errdefer free → Drop handles it

        // `args.global_this` is a `BackRef` (JSC_BORROW); safe Deref.
        let vm = args.global_this.bun_vm_ptr();
        let this = Box::new(StatWatcher {
            next: bun_threading::Link::new(),
            // JSC_BORROW: `vm` is the live per-thread VM (never null); write provenance
            // for the `rare_data()` call in `deinit`.
            // SAFETY: `bun_vm_ptr()` is the live per-thread VM, non-null, outlives the watcher.
            ctx: unsafe { BackRef::from_raw_mut(vm) },
            pending_hop: Cell::new(0),
            // SAFETY: `vm` is the live per-thread VM; this runs on its thread.
            loop_handle: unsafe { (*vm).loop_handle() },
            ref_count: ThreadSafeRefCount::init(),
            closed: AtomicBool::new(false),
            path: alloc_file_path,
            persistent: Cell::new(args.persistent),
            bigint: args.bigint,
            interval: 5.max(args.interval),
            // Instant.now will not fail on our target platforms.
            last_check: Cell::new(Instant::now()),
            global_this: args.global_this,
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::default()),
            // InitStatTask is responsible for setting this
            // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
            last_stat: Guarded::init(bun_core::ffi::zeroed::<PosixStat>()),
            scheduler: Self::lazy_scheduler(vm),
        });
        let this_ptr = bun_core::heap::into_raw(this);
        // errdefer this.deinit() — `p` was heap-allocated above; on the error
        // path we own the only reference (sole-owner contract for `deinit`).
        let guard = scopeguard::guard(this_ptr, Self::deinit);
        // BACKREF — `this_ptr` just leaked from Box; alive until deref drops
        // it. R-2: all field mutation goes through Cell/JsCell so shared `&`
        // suffices (and `to_js_ptr` below creates the JS wrapper, after which
        // the codegen shim may form its own `&Self`). `ParentRef` Deref gives
        // that shared `&`.
        let this_ref = ParentRef::from(NonNull::new(this_ptr).expect("init: watcher"));

        if this_ref.persistent.get() {
            let el_ctx = this_ref.ctx_el_ctx();
            this_ref.poll_ref.with_mut(|p| p.ref_(el_ctx));
        }

        // SAFETY: `this_ptr` ownership transfers to the C++ wrapper (freed via
        // `StatWatcherClass__finalize`). `args.global_this` is a `BackRef`
        // (JSC_BORROW) — safe Deref to `&JSGlobalObject`.
        let js_this = unsafe { StatWatcher::to_js_ptr(this_ptr, &args.global_this) };
        this_ref
            .this_value
            .set(JsRef::init_strong(js_this, &args.global_this));
        js::listener_set_cached(js_this, &args.global_this, args.listener);
        // `ctx` is a `BackRef<VirtualMachine>` (JSC_BORROW); safe Deref.
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            bun_core::handle_oom(handles.put(
                crate::jsc_hooks::ActiveHandle::StatWatcher(
                    NonNull::new(this_ptr).expect("init: watcher"),
                ),
                (),
            ));
        }
        // SAFETY: `this_ptr` is the live watcher leaked from the `Box` above
        // (its initial ref now belongs to the JS wrapper); this takes the
        // initial-stat task's own ref on it.
        InitialStatTask::create_and_schedule(unsafe { OwnedRef::acquire(this_ptr) });

        Ok(scopeguard::ScopeGuard::into_inner(guard))
    }
}

// Shared by InitialStatTask::work_pool_callback and StatWatcher::restat — identical logic.
fn restat_impl(path: &ZStr) -> bun_sys::Maybe<PosixStat> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        if bun_sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return bun_sys::statx(path, bun_sys::STATX_MASK_FOR_STATS);
        }
    }
    bun_sys::stat(path).map(|r| PosixStat::init(&r))
}

pub struct Arguments {
    pub path: PathLike,
    pub(crate) listener: JSValue,

    pub(crate) persistent: bool,
    pub(crate) bigint: bool,
    pub(crate) interval: i32,

    // JSC_BORROW per LIFETIMES.tsv — global outlives the parsed `Arguments`;
    // `BackRef` gives safe `&JSGlobalObject` projection at every read site.
    pub global_this: BackRef<JSGlobalObject>,
}

impl Arguments {
    pub fn from_js(global: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Arguments> {
        let Some(path) = PathLike::from_js_with_allocator(global, arguments)? else {
            return Err(global
                .throw_invalid_arguments(format_args!("filename must be a string or TypedArray")));
        };

        let mut listener: JSValue = JSValue::ZERO;
        let mut persistent: bool = true;
        let mut bigint: bool = false;
        let mut interval: i32 = 5007;

        if let Some(options_or_callable) = arguments.next_eat() {
            // options
            if options_or_callable.is_object() {
                // default true
                persistent = options_or_callable
                    .get_boolean_strict(global, "persistent")?
                    .unwrap_or(true);

                // default false
                bigint = options_or_callable
                    .get_boolean_strict(global, "bigint")?
                    .unwrap_or(false);

                if let Some(interval_) = options_or_callable.get(global, "interval")? {
                    if !interval_.is_number() && !interval_.is_any_int() {
                        return Err(global
                            .throw_invalid_arguments(format_args!("interval must be a number")));
                    }
                    interval = interval_.coerce::<i32>(global)?;
                }
            }
        }

        if let Some(listener_) = arguments.next_eat() {
            if listener_.is_callable() {
                listener = listener_.with_async_context_if_needed(global);
            }
        }

        if listener.is_empty() {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected \"listener\" callback"))
            );
        }

        Ok(Arguments {
            path,
            listener,
            persistent,
            bigint,
            interval,
            global_this: BackRef::new(global),
        })
    }

    pub(crate) fn create_stat_watcher(self) -> Result<JSValue, crate::Error> {
        // BACKREF — `init` returns the live heap watcher (refcount==1);
        // `ParentRef` Deref gives safe field access for the `this_value` read.
        let obj = ParentRef::from(
            NonNull::new(StatWatcher::init(&self)?).expect("create_stat_watcher: init"),
        );
        Ok(obj.this_value.get().try_get().unwrap_or(JSValue::UNDEFINED))
    }
}

/// Which JS-thread continuation a posted [`StatWatcher`] hop runs.
#[repr(u8)]
#[derive(Clone, Copy)]
pub(crate) enum StatWatcherHop {
    InitialStatSuccess = 1,
    InitialStatError = 2,
    Changed = 3,
}

impl bun_event_loop::Taskable for StatWatcher {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::StatWatcherHop;
    /// A hop the pool posted: drop the ref it carries without running it.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract: `this` is the pointer `post_to_js_thread` queued
        // under this tag, and the queue is handing it out this once.
        drop(unsafe { StatWatcher::take_hop_ref(this) });
    }
}

pub(crate) struct InitialStatTask {
    /// The task's ref on the watcher: dropped here if the watcher was closed
    /// before the stat ran, otherwise handed to the result hop.
    watcher: OwnedRef<StatWatcher>,
    task: WorkPoolTask,
}

bun_threading::owned_task!(InitialStatTask, task);

impl InitialStatTask {
    fn create_and_schedule(watcher: OwnedRef<StatWatcher>) {
        // The watcher is a JS-owned m_ctx: counted, so its VM waits for this
        // (see `VmHandle::embedded_work_scheduled`).
        watcher.loop_handle.embedded_work_scheduled();
        WorkPool::schedule_new(InitialStatTask {
            watcher,
            task: WorkPoolTask::default(),
        });
    }

    // `owned_task!` requires `fn run_owned(self: Box<Self>)`; clippy::boxed_local
    // is a false positive on this macro contract.
    #[allow(clippy::boxed_local)]
    fn run_owned(self: Box<Self>) {
        let handle = self.watcher.loop_handle.clone();
        let _finished = scopeguard::guard((), |()| handle.embedded_work_finished());
        // Declared after `_finished` so that the closed path below drops the
        // ref before `embedded_work_finished()` runs. R-2: the JS thread may
        // run `close()` / `finalize()` on this watcher meanwhile; both sides
        // only take shared access.
        let watcher = self.watcher;

        if watcher.closed.load(Ordering::Relaxed) {
            return;
        }

        let stat = restat_impl(&watcher.path);
        match stat {
            Ok(ref res) => {
                // we store the stat, but do not call the callback
                watcher.set_last_stat(res);
                StatWatcher::post_to_js_thread(watcher, StatWatcherHop::InitialStatSuccess);
            }
            Err(_) => {
                // on enoent, eperm, we call cb with two zeroed stat objects
                // and store previous stat as a zeroed stat object, and then call the callback.
                // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
                watcher.set_last_stat(&bun_core::ffi::zeroed::<PosixStat>());
                StatWatcher::post_to_js_thread(watcher, StatWatcherHop::InitialStatError);
            }
        }
    }
}

pub(crate) struct StatWatcherTimerUpdate {
    // BACKREF — `scheduler` is the refcounted singleton, kept alive by
    // every `StatWatcher`'s `RefPtr<StatWatcherScheduler>`; the watcher
    // that drove this `set_interval` still holds one across the hop.
    scheduler: bun_ptr::ParentRef<StatWatcherScheduler, bun_ptr::Mut>,
}

impl StatWatcherTimerUpdate {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) {
        let interval = self.scheduler.get_interval();
        StatWatcherScheduler::set_timer(self.scheduler.as_mut_ptr(), interval);
    }
}

impl bun_event_loop::Taskable for StatWatcherTimerUpdate {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::StatWatcherTimerUpdate;
    /// The holder owns nothing (a non-owning scheduler ref); timers are
    /// already disarmed, so just drop it.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box `schedule_timer_update` posted.
        drop(unsafe { bun_core::heap::take(this) });
    }
}
