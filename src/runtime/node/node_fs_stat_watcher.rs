use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicI32, AtomicPtr, Ordering};
use std::thread::{self, ThreadId};
use std::time::Instant;

use bun_aio::KeepAlive;
use bun_core::{Timespec, TimespecMockMode, ZBox, ZStr};
use bun_jsc::call_frame::ArgumentsSlice;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::node::PathLike;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, ConcurrentTask, JSGlobalObject, JSValue, JsRef, JsResult, Task,
    WorkPool, WorkPoolTask,
};
use bun_ptr::{RefPtr, ThreadSafeRefCount, ThreadSafeRefCounted};
use bun_str::strings;
use bun_sys::PosixStat;
use bun_threading::{Guarded, UnboundedQueue};

use crate::node::types::PathLikeExt;
use crate::node::{StatsBig, StatsSmall};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(StatWatcher, visible);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(StatWatcher, $($arg)*) };
}

/// `vm.timer` lives in `bun_runtime::RuntimeState` (b2-cycle); reach it through
/// the runtime-state slot like every other timer client in this crate.
#[inline]
fn timer_all<'a>() -> &'a mut crate::timer::All {
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`;
    // single JS thread, raw-ptr-per-field re-entry pattern (jsc_hooks.rs).
    unsafe { &mut (*crate::jsc_hooks::runtime_state()).timer }
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
    vm: *mut VirtualMachine,
    watchers: WatcherQueue,

    pub event_loop_timer: EventLoopTimer,

    ref_count: ThreadSafeRefCount<StatWatcherScheduler>,
}

type WatcherQueue = UnboundedQueue<StatWatcher>;

impl ThreadSafeRefCounted for StatWatcherScheduler {
    fn debug_name() -> &'static str {
        "StatWatcherScheduler"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut ThreadSafeRefCount<Self> {
        // SAFETY: caller contract — `this` is live.
        unsafe { ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self) {
        // SAFETY: last ref; exclusive.
        unsafe { Self::deinit(this) }
    }
}
bun_ptr::impl_thread_safe_any_ref_counted!(StatWatcherScheduler);

impl StatWatcherScheduler {
    #[inline]
    pub fn ref_(this: *mut Self) {
        // SAFETY: `this` is live (caller holds a ref or is constructing).
        unsafe { ThreadSafeRefCount::<Self>::ref_(this) }
    }
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and one ref is owned.
        unsafe { ThreadSafeRefCount::<Self>::deref(this) }
    }

    pub fn init(vm: *mut VirtualMachine) -> RefPtr<StatWatcherScheduler> {
        RefPtr::new(StatWatcherScheduler {
            current_interval: AtomicI32::new(0),
            task: WorkPoolTask {
                node: bun_threading::thread_pool::Node::default(),
                callback: Self::work_pool_callback,
            },
            main_thread: thread::current().id(),
            vm,
            watchers: WatcherQueue::default(),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::StatWatcherScheduler),
            ref_count: ThreadSafeRefCount::init(),
        })
    }

    // SAFETY: called only when ref_count reaches zero; `this` was Box-allocated by RefPtr::new
    unsafe fn deinit(this: *mut StatWatcherScheduler) {
        // SAFETY: last ref; exclusive.
        let this_ref = unsafe { &*this };
        bun_core::assertf!(
            this_ref.watchers.is_empty(),
            "destroying StatWatcherScheduler while it still has watchers",
        );
        // SAFETY: matches bun.destroy(this) — Box::from_raw drops the allocation
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn append(this: *mut Self, watcher: *mut StatWatcher) {
        // SAFETY: `this` is live (caller holds a ref); `watcher` is a live
        // intrusive-RC StatWatcher we ref() below.
        let this_ref = unsafe { &*this };
        let w = unsafe { &*watcher };
        log!("append new watcher {}", bstr::BStr::new(w.path.as_bytes()));
        debug_assert!(!w.closed);
        debug_assert!(w.next.load(Ordering::Relaxed).is_null());

        StatWatcher::ref_(watcher);
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
        // SAFETY: `this` is live (just ref'd).
        let this_ref = unsafe { &*this };
        this_ref.current_interval.store(interval, Ordering::Relaxed);

        if this_ref.main_thread == thread::current().id() {
            // we are in the main thread we can set the timer
            // SAFETY: main thread; `this` is live.
            unsafe { Self::set_timer(this, interval) };
            return;
        }
        // we are not in the main thread we need to schedule a task to set the timer
        Self::schedule_timer_update(this);
    }

    /// Set the timer (this function is not thread safe, should be called only from the main thread)
    ///
    /// # Safety
    /// Must be called on the main JS thread; `this` must be live.
    unsafe fn set_timer(this: *mut Self, interval: i32) {
        // SAFETY: caller contract.
        let this_ref = unsafe { &mut *this };
        // if the interval is 0 means that we stop the timer
        if interval == 0 {
            // if the timer is active we need to remove it
            if this_ref.event_loop_timer.state == EventLoopTimerState::ACTIVE {
                timer_all().remove(ptr::addr_of_mut!(this_ref.event_loop_timer));
            }
            return;
        }

        // reschedule the timer
        timer_all().update(
            ptr::addr_of_mut!(this_ref.event_loop_timer),
            &Timespec::ms_from_now(TimespecMockMode::AllowMockedTime, i64::from(interval)),
        );
    }

    /// Schedule a task to set the timer in the main thread
    fn schedule_timer_update(this: *mut Self) {
        struct Holder {
            scheduler: *mut StatWatcherScheduler,
            task: bun_event_loop::AnyTask::AnyTask,
        }

        fn update_timer(self_: *mut c_void) -> bun_event_loop::JsResult<()> {
            // SAFETY: self_ was Box::into_raw'd below; reclaim and drop at end of scope
            let self_ = unsafe { Box::from_raw(self_.cast::<Holder>()) };
            // SAFETY: `scheduler` is live — ref taken in `set_interval` is still held;
            // this runs on the main thread (enqueued via `enqueue_task_concurrent`).
            unsafe {
                StatWatcherScheduler::set_timer(self_.scheduler, (*self_.scheduler).get_interval());
            }
            Ok(())
        }

        let mut holder = Box::new(Holder {
            scheduler: this,
            task: bun_event_loop::AnyTask::AnyTask::default(),
        });
        holder.task = bun_event_loop::AnyTask::AnyTask {
            ctx: NonNull::new((&mut *holder as *mut Holder).cast()),
            callback: update_timer,
        };
        let holder_ptr = Box::into_raw(holder);
        // SAFETY: `this` is live (ref held by `set_interval`); `holder_ptr` is leaked
        // until `update_timer` reclaims it. Use addr_of_mut! to keep full provenance.
        unsafe {
            (*(*this).vm)
                .enqueue_task_concurrent(ConcurrentTask::create(Task::init(ptr::addr_of_mut!(
                    (*holder_ptr).task
                ))));
        }
    }

    pub fn timer_callback(&mut self) {
        // SAFETY: `vm` outlives the scheduler.
        let vm = unsafe { &*self.vm };
        let has_been_cleared = self.event_loop_timer.state == EventLoopTimerState::CANCELLED
            || vm.script_execution_status() != jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        self.event_loop_timer.heap = Default::default();

        if has_been_cleared {
            return;
        }

        WorkPool::schedule(ptr::addr_of_mut!(self.task));
    }

    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to StatWatcherScheduler.task; recover parent via offset_of
        let this: *mut StatWatcherScheduler = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(StatWatcherScheduler, task))
                .cast::<StatWatcherScheduler>()
        };
        // ref'd when the timer was scheduled
        // SAFETY: `this` is live for the scope; one ref (taken in `set_interval`) is
        // owned by this callback and released here.
        scopeguard::defer! { unsafe { StatWatcherScheduler::deref(this) }; }
        // SAFETY: this is alive — ref'd when the timer was scheduled
        let this_ref = unsafe { &*this };

        // Instant.now will not fail on our target platforms.
        let now = Instant::now();

        let batch = this_ref.watchers.pop_batch();
        log!("pop batch of {} watchers", batch.count);
        let mut iter = batch.iterator();
        let mut min_interval: i32 = i32::MAX;
        let mut closest_next_check: u64 = u64::try_from(min_interval).unwrap();
        let mut contain_watchers = false;
        loop {
            let watcher = iter.next();
            if watcher.is_null() {
                break;
            }
            // SAFETY: watcher is *mut StatWatcher from intrusive queue; alive because we hold a ref on it
            let w = unsafe { &mut *watcher };
            if w.closed {
                // SAFETY: we own the ref taken in `append`; `watcher` is the original raw ptr.
                unsafe { StatWatcher::deref(watcher) };
                continue;
            }
            contain_watchers = true;

            let time_since = u64::try_from(now.duration_since(w.last_check).as_nanos()).unwrap();
            let interval = u64::try_from(w.interval).unwrap() * 1_000_000;

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
            Self::set_interval(this, min_interval.min(i32::try_from(closest_next_check).unwrap()));
        } else {
            // we do not have watchers, we can stop the timer
            Self::set_interval(this, 0);
        }
    }
}

// TODO: make this a top-level struct
#[bun_jsc::JsClass]
pub struct StatWatcher {
    next: AtomicPtr<StatWatcher>, // INTRUSIVE link for UnboundedQueue

    ctx: *mut VirtualMachine,

    ref_count: ThreadSafeRefCount<StatWatcher>,

    /// Closed is set to true to tell the scheduler to remove from list and deref.
    closed: bool,
    path: ZBox, // owned NUL-terminated path; was `[:0]u8` allocSentinel'd + freed in deinit (Drop frees)
    persistent: bool,
    bigint: bool,
    interval: i32,
    last_check: Instant,

    global_this: *mut JSGlobalObject,

    this_value: JsRef,

    poll_ref: KeepAlive,

    last_stat: Guarded<PosixStat>,

    scheduler: RefPtr<StatWatcherScheduler>,
}

pub type Scheduler = StatWatcherScheduler;

impl ThreadSafeRefCounted for StatWatcher {
    fn debug_name() -> &'static str {
        "StatWatcher"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut ThreadSafeRefCount<Self> {
        // SAFETY: caller contract — `this` is live.
        unsafe { ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self) {
        // SAFETY: last ref; exclusive.
        unsafe { Self::deinit(this) }
    }
}
bun_ptr::impl_thread_safe_any_ref_counted!(StatWatcher);

// SAFETY: all four accessors route through the same `next: AtomicPtr<StatWatcher>`
// field; the atomic variants delegate to its `load`/`store`.
unsafe impl bun_threading::unbounded_queue::Node for StatWatcher {
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        // SAFETY: `item` is live per UnboundedQueue contract.
        unsafe { *(*item).next.get_mut() }
    }
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        // SAFETY: `item` is live per UnboundedQueue contract.
        unsafe { *(*item).next.get_mut() = ptr };
    }
    unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self {
        // SAFETY: `item` is live per UnboundedQueue contract.
        unsafe { (*item).next.load(ordering) }
    }
    unsafe fn atomic_store_next(item: *mut Self, ptr: *mut Self, ordering: Ordering) {
        // SAFETY: `item` is live per UnboundedQueue contract.
        unsafe { (*item).next.store(ptr, ordering) };
    }
}

/// `jsc.Codegen.JSStatWatcher` cached-slot accessors. The C++ side is emitted
/// by `src/codegen/generate-classes.ts` from `node.classes.ts` (`values:
/// ["listener", "prevStat"]`); bind the extern contract via the proc-macro so
/// the symbol names line up.
mod js {
    bun_jsc::codegen_cached_accessors!("StatWatcher"; listener, prevStat);
}

impl StatWatcher {
    /// Spec `RareData.nodeFSStatWatcherScheduler`. Body lives here (high tier)
    /// because `StatWatcherScheduler` cannot be named from `bun_jsc::rare_data`
    /// without a crate cycle; the slot in `RareData` is an erased
    /// `Option<NonNull<c_void>>` (§Dispatch).
    fn lazy_scheduler(vm: *mut VirtualMachine) -> RefPtr<StatWatcherScheduler> {
        // SAFETY: `vm` is the live per-thread VM (caller holds it).
        let slot = unsafe { (*vm).rare_data().node_fs_stat_watcher_scheduler_slot() };
        let raw = match *slot {
            Some(p) => p.as_ptr().cast::<StatWatcherScheduler>(),
            None => {
                let arc = StatWatcherScheduler::init(vm);
                let raw = arc.into_raw(); // VM owns this ref forever (Zig: never deref'd)
                // SAFETY: `vm` is live; re-borrow rare_data after `init` released its borrow.
                unsafe {
                    *(*vm).rare_data().node_fs_stat_watcher_scheduler_slot() =
                        NonNull::new(raw.cast());
                }
                raw
            }
        };
        // SAFETY: `raw` was produced by `RefPtr::into_raw` above (or on a prior
        // call) and the VM ref keeps it alive; bump the count for the caller's
        // `dupeRef()`.
        unsafe { RefPtr::init_ref(raw) }
    }

    #[inline]
    pub fn ref_(this: *mut Self) {
        // SAFETY: `this` is live (caller holds a ref).
        unsafe { ThreadSafeRefCount::<Self>::ref_(this) }
    }
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and one ref is owned.
        unsafe { ThreadSafeRefCount::<Self>::deref(this) }
    }

    pub fn event_loop(&self) -> *mut EventLoop {
        // SAFETY: `ctx` outlives the watcher.
        unsafe { (*self.ctx).event_loop() }
    }

    pub fn enqueue_task_concurrent(&self, task: *mut jsc::event_loop::ConcurrentTaskItem) {
        // SAFETY: `event_loop()` returns a live raw ptr; `enqueue_task_concurrent` takes `&self`.
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
    // Not `impl Drop` — this is a .classes.ts m_ctx payload with intrusive refcount;
    // teardown is driven by ref_count, and `finalize()` is the GC entry point.
    unsafe fn deinit(this: *mut StatWatcher) {
        log!("deinit {:x}", this as usize);

        // SAFETY: last ref; exclusive access
        let this_ref = unsafe { &mut *this };

        // SAFETY: `ctx` outlives the watcher.
        if unsafe { (*this_ref.ctx).test_isolation_enabled } {
            // SAFETY: `ctx` is live; main JS thread.
            unsafe {
                (*this_ref.ctx)
                    .rare_data()
                    .remove_stat_watcher_for_isolation(this as *mut c_void);
            }
        }
        this_ref.persistent = false;
        if cfg!(debug_assertions) {
            if this_ref.poll_ref.is_active() {
                debug_assert!(core::ptr::eq(VirtualMachine::get(), this_ref.ctx)); // We cannot unref() on another thread this way.
            }
        }
        this_ref.poll_ref.unref(VirtualMachine::event_loop_ctx(this_ref.ctx));
        this_ref.closed = true;
        // PORT NOTE: `JsRef::deinit()` was dropped — Strong's Drop on reassignment
        // handles teardown (JSRef.rs trailer).
        this_ref.this_value = JsRef::empty();
        // path freed by ZBox Drop below; scheduler RefPtr is leaked here intentionally
        // (its deref happened in `finalize()`, matching Zig's manual ref-pairing).

        // SAFETY: matches bun.default_allocator.destroy(this)
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !this.closed && !this.persistent {
            this.persistent = true;
            this.poll_ref.ref_(VirtualMachine::event_loop_ctx(this.ctx));
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
            this.poll_ref.unref(VirtualMachine::event_loop_ctx(this.ctx));
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Stops file watching but does not free the instance.
    pub fn close(&mut self) {
        if self.persistent {
            self.persistent = false;
        }
        self.poll_ref.unref(VirtualMachine::event_loop_ctx(self.ctx));
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
        // SAFETY: finalize runs on mutator thread during lazy sweep; `this` is the m_ctx payload
        let this_ref = unsafe { &mut *this };
        this_ref.this_value.finalize();
        this_ref.closed = true;
        this_ref.scheduler.deref();
        // SAFETY: `this` is the m_ctx payload raw ptr; we own the JS-side ref being released.
        unsafe { Self::deref(this) }; // but don't deinit until the scheduler drops its reference
    }

    fn initial_stat_success_on_main_thread(this: *mut StatWatcher) -> bun_event_loop::JsResult<()> {
        // SAFETY: balance the ref from createAndSchedule(); raw ptr captured (not `&self`).
        scopeguard::defer! { unsafe { StatWatcher::deref(this) }; }
        // SAFETY: this is alive — ref'd in InitialStatTask::create_and_schedule
        let this_ref = unsafe { &mut *this };
        if this_ref.closed {
            return Ok(());
        }

        let Some(js_this) = this_ref.this_value.try_get() else {
            return Ok(());
        };
        // SAFETY: `global_this` outlives the watcher.
        let global_this = unsafe { &*this_ref.global_this };

        let jsvalue = match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
            Ok(v) => v,
            Err(err) => {
                global_this.report_active_exception_as_unhandled(err);
                return Ok(());
            }
        };
        js::prev_stat_set_cached(js_this, global_this, jsvalue);

        StatWatcherScheduler::append(this_ref.scheduler.as_ptr(), this);
        Ok(())
    }

    fn initial_stat_error_on_main_thread(this: *mut StatWatcher) -> bun_event_loop::JsResult<()> {
        // SAFETY: balance the ref from createAndSchedule(); raw ptr captured (not `&self`).
        scopeguard::defer! { unsafe { StatWatcher::deref(this) }; }
        // SAFETY: this is alive — ref'd in InitialStatTask::create_and_schedule
        let this_ref = unsafe { &mut *this };
        if this_ref.closed {
            return Ok(());
        }

        let Some(js_this) = this_ref.this_value.try_get() else {
            return Ok(());
        };
        // SAFETY: `global_this` outlives the watcher.
        let global_this = unsafe { &*this_ref.global_this };
        let jsvalue = match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
            Ok(v) => v,
            Err(err) => {
                global_this.report_active_exception_as_unhandled(err);
                return Ok(());
            }
        };
        js::prev_stat_set_cached(js_this, global_this, jsvalue);

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
        let stat: bun_sys::Maybe<PosixStat> = restat_impl(self.path.as_zstr());
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
        Self::ref_(self as *mut StatWatcher); // Ensure it stays alive long enough to receive the callback.
        self.enqueue_task_concurrent(ConcurrentTask::from_callback(
            self as *mut StatWatcher,
            Self::swap_and_call_listener_on_main_thread,
        ));
    }

    /// After a restat found the file changed, this calls the listener function.
    fn swap_and_call_listener_on_main_thread(this: *mut StatWatcher) -> bun_event_loop::JsResult<()> {
        // SAFETY: balance the ref from restat(); raw ptr captured (not `&self`).
        scopeguard::defer! { unsafe { StatWatcher::deref(this) }; }
        // SAFETY: this is alive — ref'd in restat()
        let this_ref = unsafe { &mut *this };
        let Some(js_this) = this_ref.this_value.try_get() else {
            return Ok(());
        };
        // SAFETY: `global_this` outlives the watcher.
        let global_this = unsafe { &*this_ref.global_this };
        let prev_jsvalue = js::prev_stat_get_cached(js_this).unwrap_or(JSValue::UNDEFINED);
        let current_jsvalue =
            match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
                Ok(v) => v,
                Err(_) => return Ok(()), // TODO: properly propagate exception upwards
            };
        js::prev_stat_set_cached(js_this, global_this, current_jsvalue);

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

        let parts = [slice];
        // SAFETY: `FileSystem::instance()` is non-null after `bun_runtime::init()`.
        let top_level_dir = unsafe { (*bun_resolver::fs::FileSystem::instance()).top_level_dir };
        let file_path = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
            top_level_dir,
            &mut buf[..],
            &parts,
        );

        // allocSentinel + memcpy → owned NUL-terminated copy (ZBox)
        let alloc_file_path = ZBox::from_bytes(file_path);
        // errdefer free → ZBox Drop handles it

        let vm = args.global_this.bun_vm();
        let this = Box::new(StatWatcher {
            next: AtomicPtr::new(ptr::null_mut()),
            ctx: vm,
            ref_count: ThreadSafeRefCount::init(),
            closed: false,
            path: alloc_file_path,
            persistent: args.persistent,
            bigint: args.bigint,
            interval: 5.max(args.interval),
            // Instant.now will not fail on our target platforms.
            last_check: Instant::now(),
            global_this: args.global_this as *const JSGlobalObject as *mut JSGlobalObject,
            this_value: JsRef::empty(),
            poll_ref: KeepAlive::default(),
            // InitStatTask is responsible for setting this
            // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
            last_stat: Guarded::init(unsafe { core::mem::zeroed::<PosixStat>() }),
            scheduler: Self::lazy_scheduler(vm),
        });
        let this_ptr = Box::into_raw(this);
        // errdefer this.deinit()
        let guard = scopeguard::guard(this_ptr, |p| {
            // SAFETY: p was Box::into_raw'd above; on error path we own the only reference
            unsafe { Self::deinit(p) }
        });
        // SAFETY: this_ptr just leaked from Box; alive until deref drops it
        let this_ref = unsafe { &mut *this_ptr };

        if this_ref.persistent {
            this_ref.poll_ref.ref_(VirtualMachine::event_loop_ctx(this_ref.ctx));
        }

        // SAFETY: `this_ptr` is the freshly Box::into_raw'd payload; ownership of
        // the GC wrapper transfers to JSC. The intrusive refcount keeps the
        // native side alive independent of GC.
        let js_this = unsafe { StatWatcher::to_js_ptr(this_ptr, args.global_this) };
        this_ref.this_value = JsRef::init_strong(js_this, args.global_this);
        js::listener_set_cached(js_this, args.global_this, args.listener);
        // SAFETY: `vm` is live (main JS thread).
        if unsafe { (*vm).test_isolation_enabled } {
            // SAFETY: `vm` is live; rare_data borrows `&mut`.
            unsafe {
                (*vm).rare_data().add_stat_watcher_for_isolation(
                    this_ptr as *mut c_void,
                    // §Dispatch cold-path vtable — `bun_jsc::RareData` stores
                    // (ptr, close-fn) so it can fire close without naming StatWatcher.
                    |p| (*p.cast::<StatWatcher>()).close(),
                );
            }
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

pub struct Arguments<'a> {
    pub path: PathLike,
    pub listener: JSValue,

    pub persistent: bool,
    pub bigint: bool,
    pub interval: i32,

    pub global_this: &'a JSGlobalObject,
}

impl<'a> Arguments<'a> {
    pub fn from_js(
        global: &'a JSGlobalObject,
        arguments: &mut ArgumentsSlice,
    ) -> JsResult<Arguments<'a>> {
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
                        return Err(
                            global.throw_invalid_arguments(format_args!("interval must be a number"))
                        );
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
            global_this: global,
        })
    }

    pub fn create_stat_watcher(self) -> Result<JSValue, bun_core::Error> {
        let obj = StatWatcher::init(self)?;
        // SAFETY: obj just returned from init; alive
        Ok(unsafe { &*obj }
            .this_value
            .try_get()
            .unwrap_or(JSValue::UNDEFINED))
    }
}

pub struct InitialStatTask {
    // Zig: `watcher: *StatWatcher`. StatWatcher is intrusively ref-counted (ThreadSafeRefCount
    // m_ctx payload), NOT Arc-allocated. We hold the strong ref via `ref_()`/`deref()` and
    // keep the raw *mut, mirroring Zig's `*StatWatcher` aliasing intent.
    watcher: *mut StatWatcher,
    task: WorkPoolTask,
}

impl InitialStatTask {
    pub fn create_and_schedule(watcher: *mut StatWatcher) {
        // SAFETY: watcher is alive; we bump its intrusive refcount, held across task lifetime
        // (balanced by deref() in work_pool_callback's closed path or by the main-thread
        // initial_stat_*_on_main_thread callbacks).
        StatWatcher::ref_(watcher);
        let task = Box::new(InitialStatTask {
            watcher,
            task: WorkPoolTask {
                node: bun_threading::thread_pool::Node::default(),
                callback: Self::work_pool_callback,
            },
        });
        let task_ptr = Box::into_raw(task);
        // SAFETY: task_ptr leaked until work_pool_callback reclaims it. Use addr_of_mut! so the
        // field pointer inherits `task_ptr`'s full-Box provenance — `&mut (*task_ptr).task` would
        // narrow provenance to just the `task` field, making the later `.sub(offset_of!)` +
        // `Box::from_raw` in work_pool_callback out-of-provenance under Stacked Borrows.
        WorkPool::schedule(unsafe { ptr::addr_of_mut!((*task_ptr).task) });
    }

    unsafe fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to InitialStatTask.task; recover parent via offset_of. The incoming
        // pointer carries whole-allocation provenance (see addr_of_mut! in create_and_schedule),
        // which is required for both the `.sub(offset_of!)` and the subsequent `Box::from_raw`.
        let initial_stat_task: *mut InitialStatTask = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(InitialStatTask, task))
                .cast::<InitialStatTask>()
        };
        // SAFETY: matches bun.destroy(initial_stat_task) — reclaim Box, drop at end of scope.
        // `watcher` is a raw *mut (Copy), so dropping the Box does not touch the refcount.
        let initial_stat_task = unsafe { Box::from_raw(initial_stat_task) };
        let this: *mut StatWatcher = initial_stat_task.watcher;
        // SAFETY: `this` is kept alive by the intrusive ref taken in create_and_schedule. We only
        // need shared access here — `closed` is read-only, `path` is borrowed, and
        // `set_last_stat`/`enqueue_task_concurrent` take `&self` (mutation goes through
        // `Guarded`/atomics).
        let this_ref = unsafe { &*this };

        if this_ref.closed {
            // SAFETY: balance the ref() from createAndSchedule(); raw ptr (not `&self`).
            unsafe { StatWatcher::deref(this) };
            return;
        }

        let stat: bun_sys::Maybe<PosixStat> = restat_impl(this_ref.path.as_zstr());
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
        // ref ownership transferred to main-thread callback (initial_stat_*_on_main_thread
        // calls deref()). Nothing to forget — `watcher` is a raw pointer.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_stat_watcher.zig (577 lines)
//   confidence: medium
//   notes:      `vm.timer` reached via runtime_state() (b2-cycle); RefPtr +
//               ThreadSafeRefCount used directly (matches Zig RefCount mixin);
//               raw `*mut VirtualMachine`/`*mut JSGlobalObject` stored
//               (JSC_BORROW per LIFETIMES.tsv — VM/global outlive watcher).
// ──────────────────────────────────────────────────────────────────────────
