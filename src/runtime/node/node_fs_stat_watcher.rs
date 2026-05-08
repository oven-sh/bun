use core::ffi::c_void;
use core::sync::atomic::{AtomicI32, Ordering};
use std::thread::{self, ThreadId};
use std::time::Instant;

use bun_aio::KeepAlive;
use bun_core::{Timespec, TimespecMockMode, ZBox, ZStr};
use bun_event_loop::AnyTask::AnyTask;
use bun_event_loop::ConcurrentTask::{ConcurrentTask, Task};
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::node::PathLike;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, WorkPool, WorkPoolTask,
};
use bun_paths::resolve_path::{self as Path, platform};
use bun_ptr::{RefPtr, ThreadSafeRefCount, ThreadSafeRefCounted};
use bun_resolver::fs;
use bun_str::strings;
use bun_sys::{self, PosixStat};
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
pub struct StatWatcherScheduler {
    current_interval: AtomicI32,
    task: WorkPoolTask,
    main_thread: ThreadId,
    // JSC_BORROW per LIFETIMES.tsv — VM outlives the scheduler. Stored raw so we
    // can recover `&mut` for `rare_data()` / `enqueue_task_concurrent` without
    // an `&self → &mut` UB cast.
    vm: *mut VirtualMachine,
    watchers: WatcherQueue,

    pub event_loop_timer: EventLoopTimer,

    ref_count: ThreadSafeRefCount<StatWatcherScheduler>,
}

impl ThreadSafeRefCounted for StatWatcherScheduler {
    fn debug_name() -> &'static str {
        "StatWatcherScheduler"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut ThreadSafeRefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self) {
        // SAFETY: refcount hit 0; allocation came from RefPtr::new (heap::alloc).
        unsafe { Self::deinit(this) };
    }
}
bun_ptr::impl_thread_safe_any_ref_counted!(StatWatcherScheduler);

type WatcherQueue = UnboundedQueue<StatWatcher>;

// Intrusive `next`-link accessors for `UnboundedQueue<StatWatcher>` (Zig:
// `UnboundedQueue(StatWatcher, .next)` reflected on `@field(item, "next")`).
//
// SAFETY: all four route through the same `next: *mut StatWatcher` field; the
// atomic variants reinterpret it as `AtomicPtr<StatWatcher>` (same size/align,
// `addr_of!` preserves provenance).
unsafe impl bun_threading::unbounded_queue::Node for StatWatcher {
    #[inline]
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        unsafe { (*item).next }
    }
    #[inline]
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        unsafe { (*item).next = ptr }
    }
    #[inline]
    unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self {
        unsafe {
            (*core::ptr::addr_of!((*item).next).cast::<core::sync::atomic::AtomicPtr<Self>>())
                .load(ordering)
        }
    }
    #[inline]
    unsafe fn atomic_store_next(item: *mut Self, ptr: *mut Self, ordering: Ordering) {
        unsafe {
            (*core::ptr::addr_of!((*item).next).cast::<core::sync::atomic::AtomicPtr<Self>>())
                .store(ptr, ordering)
        }
    }
}

/// RAII owner of one outstanding [`StatWatcherScheduler`] ref. Adopts a ref
/// taken elsewhere (e.g. by [`StatWatcherScheduler::set_interval`]) and
/// releases it on Drop. Replaces Zig `defer this.deref()`.
#[must_use = "dropping immediately releases the adopted ref"]
struct SchedulerRefGuard(*mut StatWatcherScheduler);

impl SchedulerRefGuard {
    /// Take ownership of a ref the caller already holds (no bump).
    ///
    /// # Safety
    /// `ptr` must point to a live `StatWatcherScheduler` and the caller must
    /// own one outstanding ref, which is transferred to the returned guard.
    #[inline]
    unsafe fn adopt(ptr: *mut StatWatcherScheduler) -> Self {
        Self(ptr)
    }
}

impl Drop for SchedulerRefGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `adopt` contract — `self.0` is live and we own one ref.
        unsafe { ThreadSafeRefCount::<StatWatcherScheduler>::deref(self.0) };
    }
}

/// RAII owner of one outstanding [`StatWatcher`] ref. Adopts a ref taken
/// elsewhere (e.g. by `InitialStatTask::create_and_schedule` or
/// [`StatWatcher::restat`]) and releases it on Drop. Replaces Zig
/// `defer this.deref()`. Holds a raw pointer so no `&`/`&mut StatWatcher` is
/// live across the potential free in `deref`.
#[must_use = "dropping immediately releases the adopted ref"]
struct WatcherRefGuard(*mut StatWatcher);

impl WatcherRefGuard {
    /// Take ownership of a ref the caller already holds (no bump).
    ///
    /// # Safety
    /// `ptr` must point to a live `StatWatcher` and the caller must own one
    /// outstanding ref, which is transferred to the returned guard.
    #[inline]
    unsafe fn adopt(ptr: *mut StatWatcher) -> Self {
        Self(ptr)
    }
}

impl Drop for WatcherRefGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `adopt` contract — `self.0` is live and we own one ref.
        unsafe { ThreadSafeRefCount::<StatWatcher>::deref(self.0) };
    }
}

impl StatWatcherScheduler {
    #[inline]
    pub fn ref_(this: *mut Self) {
        // SAFETY: caller guarantees `this` is live.
        unsafe { ThreadSafeRefCount::<Self>::ref_(this) };
    }
    #[inline]
    pub fn deref(this: *mut Self) {
        // SAFETY: caller guarantees `this` is live and owns one ref.
        unsafe { ThreadSafeRefCount::<Self>::deref(this) };
    }

    pub fn init(vm: *mut VirtualMachine) -> RefPtr<StatWatcherScheduler> {
        RefPtr::new(StatWatcherScheduler {
            current_interval: AtomicI32::new(0),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::work_pool_callback,
            },
            main_thread: thread::current().id(),
            vm,
            watchers: WatcherQueue::default(),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::StatWatcherScheduler),
            ref_count: ThreadSafeRefCount::init(),
        })
    }

    // SAFETY: called only when ref_count reaches zero; `this` was Box-allocated by RefPtr::new.
    unsafe fn deinit(this: *mut StatWatcherScheduler) {
        // SAFETY: last reference; exclusive access.
        let this_ref = unsafe { &*this };
        bun_core::assertf!(
            this_ref.watchers.is_empty(),
            "destroying StatWatcherScheduler while it still has watchers",
        );
        // SAFETY: matches Zig `bun.destroy(this)` — heap::take drops the allocation.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn append(this: *mut Self, watcher: *mut StatWatcher) {
        // SAFETY: watcher is a live ref-counted StatWatcher; we ref() it below.
        let w = unsafe { &mut *watcher };
        log!("append new watcher {}", bstr::BStr::new(w.path.as_bytes()));
        debug_assert!(!w.closed);
        debug_assert!(w.next.is_null());

        StatWatcher::ref_(watcher);
        // SAFETY: `this` is live (caller holds a ref).
        let this_ref = unsafe { &*this };
        this_ref.watchers.push(watcher);
        log!("push watcher {:x}", watcher as usize);
        let current = this_ref.get_interval();
        if current == 0 || current > w.interval {
            // we are not running or the new watcher has a smaller interval
            Self::set_interval(this, w.interval);
        }
    }

    fn get_interval(&self) -> i32 {
        self.current_interval.load(Ordering::Relaxed)
    }

    /// Update the current interval and set the timer (this function is thread safe)
    fn set_interval(this: *mut Self, interval: i32) {
        Self::ref_(this);
        // SAFETY: `this` is live (caller holds a ref).
        let this_ref = unsafe { &*this };
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
        // b2-cycle: `vm.timer: api.Timer.All` lives in `RuntimeState` (this crate),
        // not as a value field on the low-tier `VirtualMachine`. Recover it via
        // the per-thread `runtime_state()` (single JS thread; see jsc_hooks.rs).
        // SAFETY: main-thread-only per fn contract; `runtime_state()` is non-null
        // after `bun_runtime::init()`. Raw-ptr-per-field re-entry pattern.
        let timer_all = unsafe { &mut (*crate::jsc_hooks::runtime_state()).timer };
        // SAFETY: `this` is live (ref'd in `set_interval`).
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

        // reschedule the timer
        timer_all.update(
            elt,
            &Timespec::ms_from_now(TimespecMockMode::AllowMockedTime, i64::from(interval)),
        );
    }

    /// Schedule a task to set the timer in the main thread
    fn schedule_timer_update(this: *mut Self) {
        struct Holder {
            // The outstanding ref on `scheduler` was already taken by
            // `set_interval`'s `ref_()`; this raw pointer borrows it. The Zig
            // never deref'd here either — the work-pool callback's
            // `defer this.deref()` balances it.
            scheduler: *mut StatWatcherScheduler,
            task: AnyTask,
        }

        fn update_timer(self_: *mut c_void) -> bun_event_loop::JsResult<()> {
            // SAFETY: `self_` was heap-allocated below; reclaim and drop at end of scope.
            let self_ = unsafe { bun_core::heap::take(self_.cast::<Holder>()) };
            // SAFETY: `scheduler` is kept alive by the ref taken in `set_interval`.
            let interval = unsafe { (*self_.scheduler).get_interval() };
            StatWatcherScheduler::set_timer(self_.scheduler, interval);
            Ok(())
        }

        // Leak FIRST, then derive `ctx` from the leaked pointer. Deriving `ctx` from a
        // `&mut *box` reborrow and then re-dereffing the Box (or calling `heap::alloc`)
        // would create a sibling Unique borrow under Stacked Borrows that pops the tag
        // backing `ctx`; `update_timer` would then `heap::take` an out-of-provenance
        // pointer. With this ordering, `ctx` and `holder_ptr` share the same SRW tag and
        // `heap::take(ctx)` satisfies the "must originate from `heap::alloc`" contract.
        let holder_ptr = bun_core::heap::into_raw(Box::new(Holder {
            scheduler: this,
            task: AnyTask::default(),
        }));
        // SAFETY: `holder_ptr` was just `heap::alloc`'d and is exclusively owned here
        // until `update_timer` reclaims it; `vm` is the live per-thread VM (JSC_BORROW).
        // `addr_of_mut!` so the field pointer inherits whole-Box provenance.
        unsafe {
            (*holder_ptr).task = AnyTask {
                ctx: core::ptr::NonNull::new(holder_ptr.cast()),
                callback: update_timer,
            };
            (*(*(*this).vm).event_loop()).enqueue_task_concurrent(ConcurrentTask::create(
                Task::init(core::ptr::addr_of_mut!((*holder_ptr).task)),
            ));
        }
    }

    pub fn timer_callback(&mut self) {
        // SAFETY: `vm` is the live per-thread VM (JSC_BORROW).
        let has_been_cleared = self.event_loop_timer.state == EventLoopTimerState::CANCELLED
            || unsafe { (*self.vm).script_execution_status() } != jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        self.event_loop_timer.heap = Default::default();

        if has_been_cleared {
            return;
        }

        WorkPool::schedule(&raw mut self.task);
    }

    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: `task` points to `StatWatcherScheduler.task`; recover parent via offset_of.
        let this: *mut StatWatcherScheduler = unsafe {
            task.cast::<u8>()
                .sub(core::mem::offset_of!(StatWatcherScheduler, task))
                .cast::<StatWatcherScheduler>()
        };
        // ref'd when the timer was scheduled
        // SAFETY: `this` is live; one ref (taken in `set_interval`) is owned by
        // this callback and adopted here.
        let _ref_guard = unsafe { SchedulerRefGuard::adopt(this) };
        // SAFETY: `this` is alive — ref'd when the timer was scheduled.
        let this_ref = unsafe { &*this };

        // Instant.now will not fail on our target platforms.
        let now = Instant::now();

        let batch = this_ref.watchers.pop_batch();
        log!("pop batch of {} watchers", batch.count);
        let mut iter = batch.iterator();
        let mut min_interval: i32 = i32::MAX;
        let mut closest_next_check: u64 = u64::try_from(min_interval).expect("int cast");
        let mut contain_watchers = false;
        loop {
            let watcher = iter.next();
            if watcher.is_null() {
                break;
            }
            // SAFETY: `watcher` is a live `*mut StatWatcher` from the intrusive
            // queue; alive because we hold a ref on it (taken in `append`).
            let w = unsafe { &mut *watcher };
            if w.closed {
                // SAFETY: we own the ref taken in `append`.
                unsafe { ThreadSafeRefCount::<StatWatcher>::deref(watcher) };
                continue;
            }
            contain_watchers = true;

            let time_since = u64::try_from(now.duration_since(w.last_check).as_nanos()).expect("int cast");
            let interval = u64::try_from(w.interval).expect("int cast") * 1_000_000;

            if time_since >= interval.saturating_sub(500) {
                w.last_check = now;
                w.restat();
            } else {
                closest_next_check = (interval - time_since).min(closest_next_check);
            }
            min_interval = min_interval.min(w.interval);
            this_ref.watchers.push(watcher);
            log!("reinsert watcher {:x}", watcher as usize);
        }

        if contain_watchers {
            // choose the smallest interval or the closest time to the next check
            Self::set_interval(this, min_interval.min(i32::try_from(closest_next_check).expect("int cast")));
        } else {
            // we do not have watchers, we can stop the timer
            Self::set_interval(this, 0);
        }
    }
}

// TODO: make this a top-level struct
#[bun_jsc::JsClass(no_constructor)]
pub struct StatWatcher {
    pub next: *mut StatWatcher, // INTRUSIVE link for UnboundedQueue

    // JSC_BORROW per LIFETIMES.tsv — VM outlives the watcher. Stored raw so we
    // can recover `&mut` for `rare_data()` without an `&self → &mut` UB cast.
    ctx: *mut VirtualMachine,

    ref_count: ThreadSafeRefCount<StatWatcher>,

    /// Closed is set to true to tell the scheduler to remove from list and deref.
    closed: bool,
    path: ZBox, // owned NUL-terminated path; was `[:0]u8` allocSentinel'd + freed in deinit (Drop frees)
    persistent: bool,
    bigint: bool,
    interval: i32,
    last_check: Instant,

    // JSC_BORROW per LIFETIMES.tsv.
    global_this: *mut JSGlobalObject,

    this_value: JsRef,

    poll_ref: KeepAlive,

    last_stat: Guarded<PosixStat>, // private field (#last_stat in Zig)

    scheduler: RefPtr<StatWatcherScheduler>,
}

pub type Scheduler = StatWatcherScheduler;

impl ThreadSafeRefCounted for StatWatcher {
    fn debug_name() -> &'static str {
        "StatWatcher"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut ThreadSafeRefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self) {
        // SAFETY: refcount hit 0; allocation came from heap::alloc in `init`.
        unsafe { Self::deinit(this) };
    }
}
bun_ptr::impl_thread_safe_any_ref_counted!(StatWatcher);

/// `jsc.Codegen.JSStatWatcher` — cached-value accessors generated from
/// `.classes.ts`. The C++ symbols are emitted by `generate-classes.ts`; this
/// module declares them locally so callers can write `js::listener_get_cached`
/// without depending on the placeholder type in `crate::generated_classes`.
mod js {
    use super::{JSGlobalObject, JSValue};

    unsafe extern "C" {
        fn StatWatcherPrototype__listenerSetCachedValue(
            this_value: JSValue,
            global: *mut JSGlobalObject,
            value: JSValue,
        );
        fn StatWatcherPrototype__listenerGetCachedValue(this_value: JSValue) -> JSValue;
        fn StatWatcherPrototype__prevStatSetCachedValue(
            this_value: JSValue,
            global: *mut JSGlobalObject,
            value: JSValue,
        );
        fn StatWatcherPrototype__prevStatGetCachedValue(this_value: JSValue) -> JSValue;
    }

    #[inline]
    pub fn listener_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        // SAFETY: codegen guarantees the symbol; `global` is live.
        unsafe { StatWatcherPrototype__listenerSetCachedValue(this_value, global.as_mut_ptr(), value) }
    }
    #[inline]
    pub fn listener_get_cached(this_value: JSValue) -> Option<JSValue> {
        // SAFETY: codegen guarantees the symbol; returns ZERO when unset.
        let v = unsafe { StatWatcherPrototype__listenerGetCachedValue(this_value) };
        if v.is_empty() { None } else { Some(v) }
    }

    pub mod gc {
        pub mod prev_stat {
            use super::super::*;
            #[inline]
            pub fn set(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
                // SAFETY: codegen guarantees the symbol; `global` is live.
                unsafe {
                    StatWatcherPrototype__prevStatSetCachedValue(this_value, global.as_mut_ptr(), value)
                }
            }
            #[inline]
            pub fn get(this_value: JSValue) -> Option<JSValue> {
                // SAFETY: codegen guarantees the symbol; returns ZERO when unset.
                let v = unsafe { StatWatcherPrototype__prevStatGetCachedValue(this_value) };
                if v.is_empty() { None } else { Some(v) }
            }
        }
    }
}

impl StatWatcher {
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
                let raw = arc.into_raw(); // VM owns this ref forever (Zig: never deref'd)
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
    pub fn ref_(this: *mut Self) {
        // SAFETY: caller guarantees `this` is live.
        unsafe { ThreadSafeRefCount::<Self>::ref_(this) };
    }
    #[inline]
    pub fn deref(this: *mut Self) {
        // SAFETY: caller guarantees `this` is live and owns one ref.
        unsafe { ThreadSafeRefCount::<Self>::deref(this) };
    }

    #[inline]
    fn ctx_el_ctx(&self) -> bun_aio::EventLoopCtx {
        VirtualMachine::event_loop_ctx(self.ctx)
    }

    pub fn event_loop(&self) -> *mut EventLoop {
        // SAFETY: `ctx` is the live per-thread VM (JSC_BORROW).
        unsafe { (*self.ctx).event_loop() }
    }

    pub fn enqueue_task_concurrent(&self, task: *mut bun_event_loop::ConcurrentTask::ConcurrentTask) {
        // SAFETY: `event_loop()` returns the VM's live self-pointer.
        unsafe { (*self.event_loop()).enqueue_task_concurrent(task) };
    }

    /// Copy the last stat by value.
    ///
    /// This field is sometimes set from aonther thread, so we should copy by
    /// value instead of referencing by pointer.
    pub fn get_last_stat(&self) -> PosixStat {
        let value = self.last_stat.lock();
        *value
        // unlock on Drop of guard
    }

    /// Set the last stat.
    pub fn set_last_stat(&self, stat: &PosixStat) {
        let mut value = self.last_stat.lock();
        *value = *stat;
        // unlock on Drop of guard
    }

    // SAFETY: called only when ref_count reaches zero; `this` was Box-allocated.
    // Not `impl Drop` — this is a `.classes.ts` m_ctx payload with intrusive
    // refcount; teardown is driven by ref_count, and `finalize()` is the GC
    // entry point.
    unsafe fn deinit(this: *mut StatWatcher) {
        log!("deinit {:x}", this as usize);

        // SAFETY: last ref; exclusive access.
        let this_ref = unsafe { &mut *this };

        // SAFETY: `ctx` is the live per-thread VM (JSC_BORROW).
        if unsafe { (*this_ref.ctx).test_isolation_enabled } {
            // SAFETY: `ctx` is live; called on the JS thread.
            unsafe { (*this_ref.ctx).rare_data() }
                .remove_stat_watcher_for_isolation(this.cast::<c_void>());
        }
        this_ref.persistent = false;
        if cfg!(debug_assertions) {
            if this_ref.poll_ref.is_active() {
                debug_assert!(core::ptr::eq(VirtualMachine::get(), this_ref.ctx)); // We cannot unref() on another thread this way.
            }
        }
        this_ref.poll_ref.unref(this_ref.ctx_el_ctx());
        this_ref.closed = true;
        // `this_value.deinit()` handled by JsRef Drop below; explicit reset for
        // parity with the Zig (drops the Strong before dealloc).
        this_ref.this_value = JsRef::empty();
        // `path` freed by ZBox Drop below.

        // SAFETY: matches Zig `bun.default_allocator.destroy(this)`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !this.closed && !this.persistent {
            this.persistent = true;
            this.poll_ref.ref_(this.ctx_el_ctx());
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.persistent {
            this.persistent = false;
            this.poll_ref.unref(this.ctx_el_ctx());
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Stops file watching but does not free the instance.
    pub fn close(&mut self) {
        if self.persistent {
            self.persistent = false;
        }
        self.poll_ref.unref(self.ctx_el_ctx());
        self.closed = true;
        self.this_value.downgrade();
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_close(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.close();
        Ok(JSValue::UNDEFINED)
    }

    /// If the scheduler is not using this, free instantly, otherwise mark for being freed.
    pub fn finalize(this: *mut Self) {
        log!("Finalize\n");
        // SAFETY: finalize runs on the mutator thread during lazy sweep; `this`
        // is the m_ctx payload.
        let this_ref = unsafe { &mut *this };
        this_ref.this_value.finalize();
        this_ref.closed = true;
        this_ref.scheduler.deref();
        // but don't deinit until the scheduler drops its reference
        Self::deref(this);
    }

    pub fn initial_stat_success_on_main_thread(
        this: *mut StatWatcher,
    ) -> bun_event_loop::JsResult<()> {
        // SAFETY: balance the ref from createAndSchedule(); raw ptr captured (not `&self`).
        let _ref_guard = unsafe { WatcherRefGuard::adopt(this) };
        // SAFETY: `this` is alive — ref'd in InitialStatTask::create_and_schedule.
        let this_ref = unsafe { &mut *this };
        if this_ref.closed {
            return Ok(());
        }

        let Some(js_this) = this_ref.this_value.try_get() else {
            return Ok(());
        };
        // SAFETY: JSC_BORROW; live for the watcher's lifetime.
        let global_this = unsafe { &*this_ref.global_this };

        let jsvalue = match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
            Ok(v) => v,
            Err(err) => {
                global_this.report_active_exception_as_unhandled(err);
                return Ok(());
            }
        };
        js::gc::prev_stat::set(js_this, global_this, jsvalue);

        StatWatcherScheduler::append(this_ref.scheduler.as_ptr(), this);
        Ok(())
    }

    pub fn initial_stat_error_on_main_thread(
        this: *mut StatWatcher,
    ) -> bun_event_loop::JsResult<()> {
        // SAFETY: balance the ref from createAndSchedule(); raw ptr captured (not `&self`).
        let _ref_guard = unsafe { WatcherRefGuard::adopt(this) };
        // SAFETY: `this` is alive — ref'd in InitialStatTask::create_and_schedule.
        let this_ref = unsafe { &mut *this };
        if this_ref.closed {
            return Ok(());
        }

        let Some(js_this) = this_ref.this_value.try_get() else {
            return Ok(());
        };
        // SAFETY: JSC_BORROW; live for the watcher's lifetime.
        let global_this = unsafe { &*this_ref.global_this };
        let jsvalue = match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
            Ok(v) => v,
            Err(err) => {
                global_this.report_active_exception_as_unhandled(err);
                return Ok(());
            }
        };
        js::gc::prev_stat::set(js_this, global_this, jsvalue);

        let result = js::listener_get_cached(js_this).unwrap().call(
            global_this,
            JSValue::UNDEFINED,
            &[jsvalue, jsvalue],
        );
        if let Err(err) = result {
            global_this.report_active_exception_as_unhandled(err);
        }

        if this_ref.closed {
            return Ok(());
        }
        StatWatcherScheduler::append(this_ref.scheduler.as_ptr(), this);
        Ok(())
    }

    /// Called from any thread
    pub fn restat(&mut self) {
        log!("recalling stat");
        let stat = restat_impl(&self.path);
        let res = match stat {
            Ok(res) => res,
            // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
            Err(_) => unsafe { core::mem::zeroed::<PosixStat>() },
        };

        let last_stat = self.get_last_stat();

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

        self.set_last_stat(&res);
        // Capture the raw pointer before the `&self` autoref of
        // `enqueue_task_concurrent` is taken — `self as *mut _` is an `&mut`
        // reborrow and would otherwise overlap that immutable borrow (E0502).
        let this_ptr: *mut StatWatcher = self;
        Self::ref_(this_ptr); // Ensure it stays alive long enough to receive the callback.
        self.enqueue_task_concurrent(ConcurrentTask::from_callback(
            this_ptr,
            Self::swap_and_call_listener_on_main_thread,
        ));
    }

    /// After a restat found the file changed, this calls the listener function.
    pub fn swap_and_call_listener_on_main_thread(
        this: *mut StatWatcher,
    ) -> bun_event_loop::JsResult<()> {
        // SAFETY: balance the ref from restat(); raw ptr captured (not `&self`).
        let _ref_guard = unsafe { WatcherRefGuard::adopt(this) };
        // SAFETY: `this` is alive — ref'd in restat().
        let this_ref = unsafe { &mut *this };
        let Some(js_this) = this_ref.this_value.try_get() else {
            return Ok(());
        };
        // SAFETY: JSC_BORROW; live for the watcher's lifetime.
        let global_this = unsafe { &*this_ref.global_this };
        let prev_jsvalue = js::gc::prev_stat::get(js_this).unwrap_or(JSValue::UNDEFINED);
        let current_jsvalue =
            match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
                Ok(v) => v,
                Err(_) => return Ok(()), // TODO: properly propagate exception upwards
            };
        js::gc::prev_stat::set(js_this, global_this, current_jsvalue);

        let result = js::listener_get_cached(js_this).unwrap().call(
            global_this,
            JSValue::UNDEFINED,
            &[current_jsvalue, prev_jsvalue],
        );
        if let Err(err) = result {
            global_this.report_active_exception_as_unhandled(err);
        }
        Ok(())
    }

    pub fn init(args: Arguments) -> Result<*mut StatWatcher, bun_core::Error> {
        log!("init");

        let mut buf = bun_paths::path_buffer_pool::get();
        // guard puts back on Drop
        let mut slice = args.path.slice();
        if strings::starts_with(slice, b"file://") {
            slice = &slice[b"file://".len()..];
        }

        // SAFETY: `FileSystem::instance()` is initialized at process start
        // (`FileSystem::init` runs before any JS module loads).
        let top_level_dir = unsafe { (*fs::FileSystem::instance()).top_level_dir };
        let parts: [&[u8]; 1] = [slice];
        let file_path =
            Path::join_abs_string_buf::<platform::Auto>(top_level_dir, &mut buf[..], &parts);

        // allocSentinel + memcpy → owned NUL-terminated copy (ZBox)
        let alloc_file_path = ZBox::from_bytes(file_path);
        // errdefer free → Drop handles it

        // SAFETY: `args.global_this` is live (caller holds it).
        let vm = unsafe { (*args.global_this).bun_vm_ptr() };
        let this = Box::new(StatWatcher {
            next: core::ptr::null_mut(),
            ctx: vm,
            ref_count: ThreadSafeRefCount::init(),
            closed: false,
            path: alloc_file_path,
            persistent: args.persistent,
            bigint: args.bigint,
            interval: 5.max(args.interval),
            // Instant.now will not fail on our target platforms.
            last_check: Instant::now(),
            global_this: args.global_this,
            this_value: JsRef::empty(),
            poll_ref: KeepAlive::default(),
            // InitStatTask is responsible for setting this
            // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
            last_stat: Guarded::init(unsafe { core::mem::zeroed::<PosixStat>() }),
            scheduler: Self::lazy_scheduler(vm),
        });
        let this_ptr = bun_core::heap::into_raw(this);
        // errdefer this.deinit()
        let guard = scopeguard::guard(this_ptr, |p| {
            // SAFETY: `p` was heap-allocated above; on the error path we own the only reference.
            unsafe { Self::deinit(p) }
        });
        // SAFETY: `this_ptr` just leaked from Box; alive until deref drops it.
        let this_ref = unsafe { &mut *this_ptr };

        if this_ref.persistent {
            this_ref.poll_ref.ref_(this_ref.ctx_el_ctx());
        }

        // SAFETY: `args.global_this` is live; `this_ptr` ownership transfers to the
        // C++ wrapper (freed via `StatWatcherClass__finalize`).
        let js_this = unsafe { StatWatcher::to_js_ptr(this_ptr, &*args.global_this) };
        this_ref.this_value = JsRef::init_strong(js_this, unsafe { &*args.global_this });
        js::listener_set_cached(js_this, unsafe { &*args.global_this }, args.listener);
        // SAFETY: `vm` is the live per-thread VM.
        if unsafe { (*vm).test_isolation_enabled } {
            // SAFETY: `vm` is live; JS thread.
            unsafe { (*vm).rare_data() }.add_stat_watcher_for_isolation(
                this_ptr.cast::<c_void>(),
                // §Dispatch cold-path vtable — `bun_jsc::RareData` stores
                // (ptr, close-fn) so it can fire close without naming StatWatcher.
                |p| unsafe { (*p.cast::<StatWatcher>()).close() },
            );
        }
        InitialStatTask::create_and_schedule(this_ptr);

        Ok(scopeguard::ScopeGuard::into_inner(guard))
    }
}

// PORT NOTE: hoisted from inline `if (isLinux and supports_statx) ... else brk: { ... }`
// at two call sites (InitialStatTask::work_pool_callback and StatWatcher::restat) — identical logic.
fn restat_impl(path: &ZStr) -> bun_sys::Maybe<PosixStat> {
    #[cfg(target_os = "linux")]
    {
        if bun_sys::SUPPORTS_STATX_ON_LINUX.load(Ordering::Relaxed) {
            return bun_sys::statx(path, bun_sys::STATX_MASK_FOR_STATS);
        }
    }
    bun_sys::stat(path).map(|r| PosixStat::init(&r))
}

pub struct Arguments {
    pub path: PathLike,
    pub listener: JSValue,

    pub persistent: bool,
    pub bigint: bool,
    pub interval: i32,

    // JSC_BORROW per LIFETIMES.tsv.
    pub global_this: *mut JSGlobalObject,
}

impl Arguments {
    pub fn from_js(global: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Arguments> {
        let Some(path) = PathLike::from_js_with_allocator(global, arguments)? else {
            return Err(global.throw_invalid_arguments(format_args!(
                "filename must be a string or TypedArray"
            )));
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
            global_this: global.as_mut_ptr(),
        })
    }

    pub fn create_stat_watcher(self) -> Result<JSValue, bun_core::Error> {
        let obj = StatWatcher::init(self)?;
        // SAFETY: `obj` just returned from init; alive (refcount==1).
        Ok(unsafe { &*obj }
            .this_value
            .try_get()
            .unwrap_or(JSValue::UNDEFINED))
    }
}

pub struct InitialStatTask {
    // Zig: `watcher: *StatWatcher`. StatWatcher is intrusively ref-counted
    // (ThreadSafeRefCount m_ctx payload). We hold the strong ref via
    // `ref_()`/`deref()` and keep the raw `*mut`, mirroring Zig's
    // `*StatWatcher` aliasing intent.
    watcher: *mut StatWatcher,
    task: WorkPoolTask,
}

bun_threading::owned_task!(InitialStatTask, task);

impl InitialStatTask {
    pub fn create_and_schedule(watcher: *mut StatWatcher) {
        // SAFETY: `watcher` is alive; we bump its intrusive refcount, held across
        // the task lifetime (balanced by `deref()` in run_owned's closed path or
        // by the main-thread `initial_stat_*_on_main_thread` callbacks).
        StatWatcher::ref_(watcher);
        WorkPool::schedule_new(InitialStatTask {
            watcher,
            task: WorkPoolTask::default(),
        });
    }

    fn run_owned(self: Box<Self>) {
        // `watcher` is a raw `*mut` (Copy), so dropping the Box does not touch
        // the refcount; matches Zig `bun.destroy(initial_stat_task)`.
        let this: *mut StatWatcher = self.watcher;
        // SAFETY: `this` is kept alive by the intrusive ref taken in
        // `create_and_schedule`. We only need shared access here — `closed` is
        // read-only, `path` is borrowed, and `set_last_stat`/
        // `enqueue_task_concurrent` take `&self` (mutation goes through
        // `Guarded`/atomics). The main thread may concurrently run
        // `close()`/`finalize()` after `init()` returns the watcher to JS, so
        // materializing `&mut` would alias their `&mut self` across threads.
        let this_ref = unsafe { &*this };

        if this_ref.closed {
            // Balance the ref() from createAndSchedule().
            StatWatcher::deref(this);
            return;
        }

        let stat = restat_impl(&this_ref.path);
        match stat {
            Ok(ref res) => {
                // we store the stat, but do not call the callback
                this_ref.set_last_stat(res);
                this_ref.enqueue_task_concurrent(ConcurrentTask::from_callback(
                    this,
                    StatWatcher::initial_stat_success_on_main_thread,
                ));
            }
            Err(_) => {
                // on enoent, eperm, we call cb with two zeroed stat objects
                // and store previous stat as a zeroed stat object, and then call the callback.
                // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
                this_ref.set_last_stat(&unsafe { core::mem::zeroed::<PosixStat>() });
                this_ref.enqueue_task_concurrent(ConcurrentTask::from_callback(
                    this,
                    StatWatcher::initial_stat_error_on_main_thread,
                ));
            }
        }
        // ref ownership transferred to main-thread callback
        // (`initial_stat_*_on_main_thread` calls deref()). Nothing to forget —
        // `watcher` is a raw pointer.
    }
}

// ported from: src/runtime/node/node_fs_stat_watcher.zig
