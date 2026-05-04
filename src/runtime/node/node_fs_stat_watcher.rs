use core::ffi::c_void;
use core::sync::atomic::{AtomicI32, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::{self, ThreadId};
use std::time::Instant;

use bun_aio::KeepAlive;
use bun_core::Output;
use bun_jsc::node::{PathLike, StatsBig, StatsSmall};
use bun_jsc::{
    self as jsc, AnyTask, CallFrame, ConcurrentTask, EventLoop, JSGlobalObject, JSValue, JsRef,
    JsResult, Task, VirtualMachine, WorkPoolTask,
};
use bun_jsc::call_frame::ArgumentsSlice;
use bun_paths::{self, resolve_path as Path};
use bun_ptr::IntrusiveArc;
use bun_resolver::fs;
use bun_runtime::api::timer::EventLoopTimer;
use bun_str::{self, strings, ZStr, ZString};
use bun_sys::{self, PosixStat};
use bun_threading::{Guarded, UnboundedQueue, WorkPool};

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
    vm: &'static VirtualMachine, // TODO(port): lifetime — JSC_BORROW per LIFETIMES.tsv
    watchers: WatcherQueue,

    event_loop_timer: EventLoopTimer,

    ref_count: AtomicU32, // TODO(port): bun.ptr.ThreadSafeRefCount — IntrusiveArc<Self> embedded count
}

type WatcherQueue = UnboundedQueue<StatWatcher, { core::mem::offset_of!(StatWatcher, next) }>;
// TODO(port): UnboundedQueue(StatWatcher, .next) — intrusive link via field offset

impl StatWatcherScheduler {
    pub fn ref_(&self) {
        // TODO(port): IntrusiveArc::ref_ — ThreadSafeRefCount.ref
        self.ref_count.fetch_add(1, Ordering::Relaxed);
    }
    pub fn deref(&self) {
        // TODO(port): IntrusiveArc::deref — ThreadSafeRefCount.deref → calls deinit() at 0
        if self.ref_count.fetch_sub(1, Ordering::AcqRel) == 1 {
            // SAFETY: last reference; matches Zig ThreadSafeRefCount semantics
            unsafe { Self::deinit(self as *const Self as *mut Self) };
        }
    }

    pub fn init(vm: &VirtualMachine) -> IntrusiveArc<StatWatcherScheduler> {
        // TODO(port): bun.ptr.RefPtr(StatWatcherScheduler) → IntrusiveArc<Self>
        IntrusiveArc::new(StatWatcherScheduler {
            current_interval: AtomicI32::new(0),
            task: WorkPoolTask {
                callback: Self::work_pool_callback,
            },
            main_thread: thread::current().id(),
            // TODO(port): lifetime — storing &VirtualMachine; VM outlives scheduler
            // SAFETY: VM outlives scheduler (JSC_BORROW per LIFETIMES.tsv)
            vm: unsafe { core::mem::transmute::<&VirtualMachine, &'static VirtualMachine>(vm) },
            watchers: WatcherQueue::default(),
            event_loop_timer: EventLoopTimer {
                next: bun_core::Timespec::EPOCH,
                tag: EventLoopTimer::Tag::StatWatcherScheduler,
                ..Default::default()
            },
            ref_count: AtomicU32::new(1),
        })
    }

    // SAFETY: called only when ref_count reaches zero; `this` was Box-allocated by IntrusiveArc::new
    unsafe fn deinit(this: *mut StatWatcherScheduler) {
        let this_ref = unsafe { &*this };
        bun_core::assertf!(
            this_ref.watchers.is_empty(),
            "destroying StatWatcherScheduler while it still has watchers",
        );
        // SAFETY: matches bun.destroy(this) — Box::from_raw drops the allocation
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn append(&self, watcher: *mut StatWatcher) {
        // SAFETY: watcher is a live IntrusiveArc-managed StatWatcher; we ref() it below
        let w = unsafe { &mut *watcher };
        log!("append new watcher {}", bstr::BStr::new(w.path.as_bytes()));
        debug_assert!(w.closed == false);
        debug_assert!(w.next.is_null());

        w.ref_();
        self.watchers.push(watcher);
        log!("push watcher {:x}", watcher as usize);
        let current = self.get_interval();
        if current == 0 || current > w.interval {
            // we are not running or the new watcher has a smaller interval
            self.set_interval(w.interval);
        }
    }

    fn get_interval(&self) -> i32 {
        self.current_interval.load(Ordering::Relaxed)
    }

    /// Update the current interval and set the timer (this function is thread safe)
    fn set_interval(&self, interval: i32) {
        self.ref_();
        self.current_interval.store(interval, Ordering::Relaxed);

        if self.main_thread == thread::current().id() {
            // we are in the main thread we can set the timer
            self.set_timer(interval);
            return;
        }
        // we are not in the main thread we need to schedule a task to set the timer
        self.schedule_timer_update();
    }

    /// Set the timer (this function is not thread safe, should be called only from the main thread)
    fn set_timer(&self, interval: i32) {
        // if the interval is 0 means that we stop the timer
        if interval == 0 {
            // if the timer is active we need to remove it
            if self.event_loop_timer.state == EventLoopTimer::State::ACTIVE {
                self.vm.timer.remove(&self.event_loop_timer);
            }
            return;
        }

        // reschedule the timer
        self.vm.timer.update(
            &self.event_loop_timer,
            &bun_core::Timespec::ms_from_now(bun_core::Timespec::AllowMockedTime, interval),
        );
    }

    /// Schedule a task to set the timer in the main thread
    fn schedule_timer_update(&self) {
        struct Holder {
            scheduler: Arc<StatWatcherScheduler>, // per LIFETIMES.tsv (SHARED) — held across Holder lifetime via this.ref()
            // TODO(port): TSV says Arc; underlying type is intrusively ref-counted. Phase B: reconcile with IntrusiveArc.
            task: AnyTask,
        }

        impl Holder {
            fn update_timer(self_: *mut Holder) {
                // SAFETY: self_ was Box::into_raw'd below; reclaim and drop at end of scope
                let self_ = unsafe { Box::from_raw(self_) };
                self_.scheduler.set_timer(self_.scheduler.get_interval());
            }
        }

        // TODO(port): this.ref() above already bumped the count; Arc::from here would double-count.
        // Phase B: switch to IntrusiveArc clone-from-raw to match Zig ref/deref pairing exactly.
        // SAFETY: self.ref_() bumped intrusive count above; reclaimed as Arc per LIFETIMES.tsv SHARED — see TODO for Phase B reconciliation
        let scheduler: Arc<StatWatcherScheduler> =
            unsafe { Arc::from_raw(self as *const StatWatcherScheduler) };
        let mut holder = Box::new(Holder {
            scheduler,
            task: AnyTask::default(),
        });
        holder.task = AnyTask::new::<Holder>(Holder::update_timer, &mut *holder as *mut Holder);
        let holder_ptr = Box::into_raw(holder);
        // SAFETY: holder_ptr is leaked until update_timer reclaims it
        self.vm.enqueue_task_concurrent(ConcurrentTask::create(Task::init(unsafe {
            &mut (*holder_ptr).task
        })));
    }

    pub fn timer_callback(&mut self) {
        let has_been_cleared = self.event_loop_timer.state == EventLoopTimer::State::CANCELLED
            || self.vm.script_execution_status() != jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state = EventLoopTimer::State::FIRED;
        self.event_loop_timer.heap = Default::default();

        if has_been_cleared {
            return;
        }

        WorkPool::schedule(&mut self.task);
    }

    pub fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to StatWatcherScheduler.task; recover parent via offset_of
        let this: *mut StatWatcherScheduler = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(StatWatcherScheduler, task))
                .cast::<StatWatcherScheduler>()
        };
        // SAFETY: this is alive — ref'd when the timer was scheduled
        let this = unsafe { &mut *this };
        // ref'd when the timer was scheduled
        let _deref_on_exit = scopeguard::guard((), |_| this.deref());
        // TODO(port): scopeguard borrows `this`; Phase B may need to restructure for borrowck
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref()`

        // Instant.now will not fail on our target platforms.
        let now = Instant::now();

        let mut batch = this.watchers.pop_batch();
        log!("pop batch of {} watchers", batch.count);
        let mut iter = batch.iterator();
        let mut min_interval: i32 = i32::MAX;
        let mut closest_next_check: u64 = u64::try_from(min_interval).unwrap();
        let mut contain_watchers = false;
        while let Some(watcher) = iter.next() {
            // SAFETY: watcher is *mut StatWatcher from intrusive queue; alive because we hold a ref on it
            let w = unsafe { &mut *watcher };
            if w.closed {
                w.deref();
                continue;
            }
            contain_watchers = true;

            // TODO(port): std.time.Instant.since returns ns u64; using Duration::as_nanos() (u128) checked-narrowed to u64
            let time_since = u64::try_from(now.duration_since(w.last_check).as_nanos()).unwrap();
            let interval = u64::try_from(w.interval).unwrap() * 1_000_000;

            if time_since >= interval.saturating_sub(500) {
                w.last_check = now;
                w.restat();
            } else {
                closest_next_check = (interval - time_since).min(closest_next_check);
            }
            min_interval = min_interval.min(w.interval);
            this.watchers.push(watcher);
            log!("reinsert watcher {:x}", watcher as usize);
        }

        if contain_watchers {
            // choose the smallest interval or the closest time to the next check
            this.set_interval(min_interval.min(i32::try_from(closest_next_check).unwrap()));
        } else {
            // we do not have watchers, we can stop the timer
            this.set_interval(0);
        }
    }
}

// TODO: make this a top-level struct
#[bun_jsc::JsClass]
pub struct StatWatcher {
    pub next: *mut StatWatcher, // INTRUSIVE link for UnboundedQueue

    ctx: &'static VirtualMachine, // TODO(port): lifetime — JSC_BORROW per LIFETIMES.tsv

    ref_count: AtomicU32, // TODO(port): bun.ptr.ThreadSafeRefCount — IntrusiveArc<Self> embedded count

    /// Closed is set to true to tell the scheduler to remove from list and deref.
    closed: bool,
    path: ZString, // owned NUL-terminated path; was `[:0]u8` allocSentinel'd + freed in deinit (Drop frees)
    persistent: bool,
    bigint: bool,
    interval: i32,
    last_check: Instant,

    global_this: &'static JSGlobalObject, // TODO(port): lifetime — JSC_BORROW per LIFETIMES.tsv

    this_value: JsRef,

    poll_ref: KeepAlive,

    last_stat: Guarded<PosixStat>, // private field (#last_stat in Zig)

    scheduler: IntrusiveArc<StatWatcherScheduler>, // TODO(port): bun.ptr.RefPtr(StatWatcherScheduler)
}

pub type Scheduler = StatWatcherScheduler;

// TODO(port): jsc.Codegen.JSStatWatcher — generated bindings module. The
// #[bun_jsc::JsClass] derive wires toJS/fromJS/fromJSDirect; cached prop
// getters/setters (listenerGetCached/listenerSetCached, gc.prevStat) are
// referenced via the generated `js` module below.
mod js {
    // TODO(port): generated by .classes.ts codegen — placeholder paths
    pub use bun_jsc::codegen::JSStatWatcher::*;
    pub mod gc {
        pub use bun_jsc::codegen::JSStatWatcher::gc::prev_stat;
    }
}

impl StatWatcher {
    pub fn ref_(&self) {
        // TODO(port): IntrusiveArc::ref_
        self.ref_count.fetch_add(1, Ordering::Relaxed);
    }
    pub fn deref(&self) {
        // TODO(port): IntrusiveArc::deref → calls deinit() at 0
        if self.ref_count.fetch_sub(1, Ordering::AcqRel) == 1 {
            // SAFETY: last reference
            unsafe { Self::deinit(self as *const Self as *mut Self) };
        }
    }

    pub fn event_loop(&self) -> &EventLoop {
        self.ctx.event_loop()
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTask) {
        self.event_loop().enqueue_task_concurrent(task);
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

        if this_ref.ctx.test_isolation_enabled {
            this_ref.ctx.rare_data().remove_stat_watcher_for_isolation(this);
        }
        this_ref.persistent = false;
        if cfg!(debug_assertions) {
            if this_ref.poll_ref.is_active() {
                debug_assert!(core::ptr::eq(VirtualMachine::get(), this_ref.ctx)); // We cannot unref() on another thread this way.
            }
        }
        this_ref.poll_ref.unref(this_ref.ctx);
        this_ref.closed = true;
        // this_value.deinit() handled by JsRef Drop below
        // path freed by ZString Drop below

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
            this.poll_ref.ref_(this.ctx);
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
            this.poll_ref.unref(this.ctx);
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Stops file watching but does not free the instance.
    pub fn close(&mut self) {
        if self.persistent {
            self.persistent = false;
        }
        self.poll_ref.unref(self.ctx);
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
        this_ref.deref(); // but don't deinit until the scheduler drops its reference
    }

    pub fn initial_stat_success_on_main_thread(this: *mut StatWatcher) {
        // SAFETY: this is alive — ref'd in InitialStatTask::create_and_schedule
        let this_ref = unsafe { &mut *this };
        let _deref_on_exit = scopeguard::guard((), |_| this_ref.deref()); // Balance the ref from createAndSchedule().
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref()`
        if this_ref.closed {
            return;
        }

        let Some(js_this) = this_ref.this_value.try_get() else {
            return;
        };
        let global_this = this_ref.global_this;

        let jsvalue = match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
            Ok(v) => v,
            Err(err) => return global_this.report_active_exception_as_unhandled(err),
        };
        js::gc::prev_stat::set(js_this, global_this, jsvalue);

        this_ref.scheduler.append(this);
    }

    pub fn initial_stat_error_on_main_thread(this: *mut StatWatcher) {
        // SAFETY: this is alive — ref'd in InitialStatTask::create_and_schedule
        let this_ref = unsafe { &mut *this };
        let _deref_on_exit = scopeguard::guard((), |_| this_ref.deref()); // Balance the ref from createAndSchedule().
        // PORT NOTE: reshaped for borrowck
        if this_ref.closed {
            return;
        }

        let Some(js_this) = this_ref.this_value.try_get() else {
            return;
        };
        let global_this = this_ref.global_this;
        let jsvalue = match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
            Ok(v) => v,
            Err(err) => return global_this.report_active_exception_as_unhandled(err),
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
            return;
        }
        this_ref.scheduler.append(this);
    }

    /// Called from any thread
    pub fn restat(&mut self) {
        log!("recalling stat");
        let stat: bun_sys::Result<PosixStat> = restat_impl(&self.path);
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
        self.ref_(); // Ensure it stays alive long enough to receive the callback.
        self.enqueue_task_concurrent(ConcurrentTask::from_callback(
            self as *mut StatWatcher,
            Self::swap_and_call_listener_on_main_thread,
        ));
    }

    /// After a restat found the file changed, this calls the listener function.
    pub fn swap_and_call_listener_on_main_thread(this: *mut StatWatcher) {
        // SAFETY: this is alive — ref'd in restat()
        let this_ref = unsafe { &mut *this };
        let _deref_on_exit = scopeguard::guard((), |_| this_ref.deref()); // Balance the ref from restat().
        // PORT NOTE: reshaped for borrowck
        let Some(js_this) = this_ref.this_value.try_get() else {
            return;
        };
        let global_this = this_ref.global_this;
        let prev_jsvalue = js::gc::prev_stat::get(js_this).unwrap_or(JSValue::UNDEFINED);
        let current_jsvalue =
            match stat_to_js_stats(global_this, &this_ref.get_last_stat(), this_ref.bigint) {
                Ok(v) => v,
                Err(_) => return, // TODO: properly propagate exception upwards
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
    }

    pub fn init(args: Arguments) -> Result<*mut StatWatcher, bun_core::Error> {
        // TODO(port): narrow error set
        log!("init");

        let buf = bun_paths::path_buffer_pool().get();
        // guard puts back on Drop
        let mut slice = args.path.slice();
        if strings::starts_with(slice, b"file://") {
            slice = &slice[b"file://".len()..];
        }

        let parts = [slice];
        let file_path = Path::join_abs_string_buf(
            fs::FileSystem::instance().top_level_dir,
            &mut *buf,
            &parts,
            Path::Platform::Auto,
        );

        // allocSentinel + memcpy → owned NUL-terminated copy (ZString)
        let alloc_file_path: ZString = ZStr::from_bytes(file_path);
        // errdefer free → Drop handles it

        let vm = args.global_this.bun_vm();
        let this = Box::new(StatWatcher {
            next: core::ptr::null_mut(),
            // TODO(port): lifetime — storing &VirtualMachine; VM outlives watcher
            // SAFETY: VM outlives watcher (JSC_BORROW per LIFETIMES.tsv)
            ctx: unsafe { core::mem::transmute::<&VirtualMachine, &'static VirtualMachine>(vm) },
            ref_count: AtomicU32::new(1),
            closed: false,
            path: alloc_file_path,
            persistent: args.persistent,
            bigint: args.bigint,
            interval: 5.max(args.interval),
            // Instant.now will not fail on our target platforms.
            last_check: Instant::now(),
            // TODO(port): lifetime — storing &JSGlobalObject
            // SAFETY: JSGlobalObject outlives watcher (JSC_BORROW per LIFETIMES.tsv)
            global_this: unsafe {
                core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(args.global_this)
            },
            this_value: JsRef::empty(),
            poll_ref: KeepAlive::default(),
            // InitStatTask is responsible for setting this
            // SAFETY: all-zero is a valid PosixStat (POD #[repr(C)])
            last_stat: Guarded::init(unsafe { core::mem::zeroed::<PosixStat>() }),
            scheduler: vm.rare_data().node_fs_stat_watcher_scheduler(vm),
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
            this_ref.poll_ref.ref_(this_ref.ctx);
        }

        let js_this = this_ref.to_js(this_ref.global_this);
        this_ref.this_value = JsRef::init_strong(js_this, this_ref.global_this);
        js::listener_set_cached(js_this, this_ref.global_this, args.listener);
        if vm.test_isolation_enabled {
            vm.rare_data().add_stat_watcher_for_isolation(this_ptr);
        }
        InitialStatTask::create_and_schedule(this_ptr);

        Ok(scopeguard::ScopeGuard::into_inner(guard))
    }
}

// PORT NOTE: hoisted from inline `if (isLinux and supports_statx) ... else brk: { ... }`
// at two call sites (InitialStatTask::work_pool_callback and StatWatcher::restat) — identical logic.
fn restat_impl(path: &ZStr) -> bun_sys::Result<PosixStat> {
    #[cfg(target_os = "linux")]
    {
        if bun_sys::supports_statx_on_linux().load(Ordering::Relaxed) {
            return bun_sys::statx(
                path,
                &[
                    bun_sys::StatxMask::Type,
                    bun_sys::StatxMask::Mode,
                    bun_sys::StatxMask::Nlink,
                    bun_sys::StatxMask::Uid,
                    bun_sys::StatxMask::Gid,
                    bun_sys::StatxMask::Atime,
                    bun_sys::StatxMask::Mtime,
                    bun_sys::StatxMask::Ctime,
                    bun_sys::StatxMask::Btime,
                    bun_sys::StatxMask::Ino,
                    bun_sys::StatxMask::Size,
                    bun_sys::StatxMask::Blocks,
                ],
            );
        }
    }
    match bun_sys::stat(path) {
        Ok(r) => Ok(PosixStat::init(&r)),
        Err(e) => Err(e),
    }
}

pub struct Arguments {
    pub path: PathLike,
    pub listener: JSValue,

    pub persistent: bool,
    pub bigint: bool,
    pub interval: i32,

    pub global_this: &'static JSGlobalObject, // TODO(port): lifetime — JSC_BORROW per LIFETIMES.tsv
}

impl Arguments {
    pub fn from_js(global: &JSGlobalObject, arguments: &mut ArgumentsSlice) -> JsResult<Arguments> {
        let Some(path) = PathLike::from_js_with_allocator(global, arguments)? else {
            return Err(global.throw_invalid_arguments("filename must be a string or TypedArray"));
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
                            global.throw_invalid_arguments("interval must be a number")
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
            return Err(global.throw_invalid_arguments("Expected \"listener\" callback"));
        }

        Ok(Arguments {
            path,
            listener,
            persistent,
            bigint,
            interval,
            // TODO(port): lifetime
            // SAFETY: JSGlobalObject outlives Arguments (JSC_BORROW per LIFETIMES.tsv)
            global_this: unsafe {
                core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global)
            },
        })
    }

    pub fn create_stat_watcher(self) -> Result<JSValue, bun_core::Error> {
        // TODO(port): narrow error set
        let obj = StatWatcher::init(self)?;
        // SAFETY: obj just returned from init; alive
        Ok(unsafe { &*obj }
            .this_value
            .try_get()
            .unwrap_or(JSValue::UNDEFINED))
    }
}

pub struct InitialStatTask {
    watcher: Arc<StatWatcher>, // per LIFETIMES.tsv (SHARED) — watcher.ref() held across task lifetime
    // TODO(port): TSV says Arc; underlying type is intrusively ref-counted (m_ctx payload). Phase B: reconcile with IntrusiveArc.
    task: WorkPoolTask,
}

impl InitialStatTask {
    pub fn create_and_schedule(watcher: *mut StatWatcher) {
        // SAFETY: watcher is alive; we bump its refcount below
        unsafe { &*watcher }.ref_();
        // TODO(port): Arc::from_raw here would assume Arc layout; Phase B switch to IntrusiveArc::from_raw
        let task = Box::new(InitialStatTask {
            // SAFETY: ref_() bumped intrusive count above; held across task lifetime per LIFETIMES.tsv SHARED — see TODO for Phase B IntrusiveArc reconciliation
            watcher: unsafe { Arc::from_raw(watcher) },
            task: WorkPoolTask {
                callback: Self::work_pool_callback,
            },
        });
        let task_ptr = Box::into_raw(task);
        // SAFETY: task_ptr leaked until work_pool_callback reclaims it
        WorkPool::schedule(unsafe { &mut (*task_ptr).task });
    }

    fn work_pool_callback(task: *mut WorkPoolTask) {
        // SAFETY: task points to InitialStatTask.task; recover parent via offset_of
        let initial_stat_task: *mut InitialStatTask = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(InitialStatTask, task))
                .cast::<InitialStatTask>()
        };
        // SAFETY: matches bun.destroy(initial_stat_task) — reclaim Box, drop at end of scope
        let initial_stat_task = unsafe { Box::from_raw(initial_stat_task) };
        // TODO(port): Arc<StatWatcher> Drop will decrement; Zig manually calls deref() on closed path
        // and otherwise relies on the main-thread callbacks to deref. Phase B: verify ref-count pairing.
        let this: *mut StatWatcher =
            Arc::as_ptr(&initial_stat_task.watcher) as *mut StatWatcher;
        // SAFETY: ref held by initial_stat_task.watcher
        let this_ref = unsafe { &mut *this };

        if this_ref.closed {
            this_ref.deref(); // Balance the ref() from createAndSchedule().
            // TODO(port): with Arc field this would double-deref on Drop. Phase B: IntrusiveArc.
            core::mem::forget(initial_stat_task.watcher);
            return;
        }

        let stat: bun_sys::Result<PosixStat> = restat_impl(&this_ref.path);
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
        // TODO(port): prevent Arc Drop from decrementing — ownership transferred to main-thread callback
        core::mem::forget(initial_stat_task.watcher);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_fs_stat_watcher.zig (577 lines)
//   confidence: medium
//   todos:      30
//   notes:      LIFETIMES.tsv mandates Arc<> for Holder.scheduler / InitialStatTask.watcher but both types use intrusive ThreadSafeRefCount + @fieldParentPtr + m_ctx — Phase B must reconcile (likely IntrusiveArc throughout). JSC_BORROW fields stored as &'static with transmute pending lifetime design.
// ──────────────────────────────────────────────────────────────────────────
