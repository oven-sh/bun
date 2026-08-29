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
use bun_ptr::{BackRef, RefPtr, ThisPtr, ThreadSafeRefCount};
use bun_resolver::fs;
use bun_sys::{self, PosixStat};
use bun_threading::Guarded;

use crate::generated_classes::js_StatWatcher as js;
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
pub struct StatWatcherScheduler {
    current_interval: AtomicI32,
    /// Set by `timer_callback` immediately before scheduling a [`StatPassTask`]
    /// on the thread pool, cleared by that task once it has finished touching
    /// `watchers`. `shutdown_for_exit` spin-waits on this so it never races the
    /// work-pool thread for the queue.
    work_pool_in_flight: AtomicBool,
    /// Set by `shutdown_for_exit`. Once true, the stat pass stops
    /// rescheduling the timer (so no `StatWatcherTimerUpdate` is left stranded
    /// in the concurrent-task queue at process exit).
    is_shutdown: AtomicBool,
    main_thread: ThreadId,
    /// JS-thread uses only (`timer_callback`).
    vm: BackRef<VirtualMachine>,
    /// The watchers waiting for their next re-stat. One ref each, taken by
    /// `append`; released by the stat pass that finds the watcher closed, or by
    /// `shutdown_for_exit`.
    watchers: Guarded<Vec<RefPtr<StatWatcher>>>,

    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,

    ref_count: ThreadSafeRefCount<StatWatcherScheduler>,
}

bun_event_loop::impl_timer_owner!(StatWatcherScheduler; from_timer_ptr => event_loop_timer);

impl Drop for StatWatcherScheduler {
    fn drop(&mut self) {
        assert!(
            self.watchers.get_mut().is_empty(),
            "destroying StatWatcherScheduler while it still has watchers",
        );
    }
}

impl StatWatcherScheduler {
    pub(crate) fn init(vm: &VirtualMachine) -> RefPtr<StatWatcherScheduler> {
        RefPtr::new(StatWatcherScheduler {
            current_interval: AtomicI32::new(0),
            work_pool_in_flight: AtomicBool::new(false),
            is_shutdown: AtomicBool::new(false),
            main_thread: thread::current().id(),
            vm: BackRef::new(vm),
            watchers: Guarded::init(Vec::new()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::StatWatcherScheduler,
            )),
            ref_count: ThreadSafeRefCount::init(),
        })
    }

    /// JS thread. Takes over `watcher` (one ref) until a stat pass finds it
    /// closed.
    pub(crate) fn append(&self, watcher: RefPtr<StatWatcher>) {
        log!(
            "append new watcher {}",
            bstr::BStr::new(watcher.path.as_bytes())
        );
        debug_assert!(!watcher.closed.load(Ordering::Relaxed));
        debug_assert_eq!(self.main_thread, thread::current().id());
        let interval = watcher.interval;
        log!("push watcher {:x}", watcher.as_ptr() as usize);
        self.watchers.lock().push(watcher);
        let current = self.get_interval();
        if current == 0 || current > interval {
            // we are not running or the new watcher has a smaller interval
            self.current_interval.store(interval, Ordering::Relaxed);
            self.set_timer(interval);
        }
    }

    fn get_interval(&self) -> i32 {
        self.current_interval.load(Ordering::Relaxed)
    }

    /// Set the timer (this function is not thread safe, should be called only from the main thread)
    fn set_timer(&self, interval: i32) {
        let timer_all = crate::jsc_hooks::timer_all_mut();

        // if the interval is 0 means that we stop the timer
        if interval == 0 {
            // if the timer is active we need to remove it
            if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
                timer_all.remove(self.event_loop_timer.as_ptr());
            }
            return;
        }

        // reschedule the timer — this tag opts out of fake timers, so the
        // deadline lives in the real heap and must be in real-clock units.
        timer_all.update(
            self.event_loop_timer.as_ptr(),
            &Timespec::ms_from_now(TimespecMockMode::ForceRealTime, i64::from(interval)),
        );
    }

    /// Pool thread: schedule a task to set the timer in the main thread.
    fn schedule_timer_update(this: &RefPtr<StatWatcherScheduler>, ticket: &bun_jsc::Ticket) {
        let holder = Box::new(StatWatcherTimerUpdate {
            scheduler: this.clone(),
        });
        ticket.post(ConcurrentTask::create(Task::from_boxed(holder)));
    }

    pub(crate) fn timer_callback(this: ThisPtr<StatWatcherScheduler>) {
        let has_been_cleared = this.event_loop_timer.get().state == EventLoopTimerState::CANCELLED
            || this.vm.script_execution_status() != jsc::ScriptExecutionStatus::Running;

        this.event_loop_timer.with_mut(|t| {
            t.state = EventLoopTimerState::FIRED;
            t.heap = Default::default();
        });

        if has_been_cleared || this.is_shutdown.load(Ordering::Relaxed) {
            return;
        }

        // Only one stat pass may be out on the pool at a time: a second pass
        // would race the first for `watchers` and post a second timer update.
        // `append()` can re-arm this timer from
        // `initial_stat_success_on_main_thread` while a pass is still in
        // flight, so guard here: if one is, re-arm the one-shot timer and try
        // again next fire. The pass clears the flag on exit; the re-arm must be
        // unconditional because its `!contain_watchers` branch stores
        // `current_interval = 0` directly (no timer update) and can race an
        // `append()` that landed after it took the queue, which would otherwise
        // leave a live watcher with the timer disarmed. `.max(5)` matches the
        // clamp applied to every watcher interval in `StatWatcher::init`.
        if this.work_pool_in_flight.swap(true, Ordering::AcqRel) {
            this.set_timer(this.get_interval().max(5));
            return;
        }

        // One ref is held across the work-pool hop by the pass itself, so the
        // count exactly tracks "task in flight".
        WorkPool::schedule_new(StatPassTask {
            scheduler: RefPtr::from_this(this),
            ticket: this.vm.ticket(),
            task: WorkPoolTask::default(),
        });
    }

    /// Drain every queued [`StatWatcher`] and release the per-thread scheduler
    /// ref stored in the runtime state. Runs on the JS thread during
    /// `global_exit` / worker shutdown, before JSC teardown, so each watcher
    /// can still be `close()`'d (downgrades its `JsRef` Strong) and so
    /// `finalize()` — reached from `lastChanceToFinalize` — drops the last ref.
    ///
    /// Without this the queue forms a refcount cycle at exit
    /// (`scheduler.watchers` → `StatWatcher` → `StatWatcher.scheduler`) and
    /// every still-queued watcher leaks.
    pub(crate) fn shutdown_for_exit() {
        let Some(Some(this)) = crate::jsc_hooks::with_stat_watcher_scheduler(Option::take) else {
            return;
        };
        debug_assert_eq!(this.main_thread, thread::current().id());

        this.is_shutdown.store(true, Ordering::Relaxed);
        // Disarm the event-loop timer so `timer_callback` cannot schedule a new
        // work-pool task after we've waited below.
        this.set_timer(0);

        // Wait for any in-flight work-pool task to finish touching `watchers`.
        // The task is bounded (one stat per queued watcher) so this is a short
        // wait in the rare case it overlaps.
        while this.work_pool_in_flight.load(Ordering::Acquire) {
            thread::yield_now();
        }

        let batch = core::mem::take(&mut *this.watchers.lock());
        for watcher in batch {
            if !watcher.closed.load(Ordering::Relaxed) {
                // Downgrade the `JsRef` Strong so the JS wrapper becomes
                // collectible at `lastChanceToFinalize`.
                watcher.close();
            }
        }

        // The scheduler stays alive until the last remaining `StatWatcher`
        // (each holds a `scheduler` ref) is freed.
        drop(this);
    }
}

/// One periodic stat pass over the scheduler's watchers, run on the work pool.
/// Owns the scheduler ref that marks "pass in flight".
struct StatPassTask {
    scheduler: RefPtr<StatWatcherScheduler>,
    ticket: bun_jsc::Ticket,
    task: WorkPoolTask,
}

bun_threading::owned_task!(StatPassTask, task);

impl StatPassTask {
    #[allow(clippy::boxed_local)]
    fn run_owned(self: Box<Self>) {
        let StatPassTask {
            scheduler: this,
            ticket,
            task: _,
        } = *self;

        // Instant.now will not fail on our target platforms.
        let now = Instant::now();

        let batch = core::mem::take(&mut *this.watchers.lock());
        log!("pop batch of {} watchers", batch.len());
        let mut min_interval: i32 = i32::MAX;
        let mut closest_next_check: u64 = u64::try_from(min_interval).expect("int cast");
        let mut contain_watchers = false;
        let mut kept: Vec<RefPtr<StatWatcher>> = Vec::with_capacity(batch.len());
        for watcher in batch {
            if watcher.closed.load(Ordering::Relaxed) {
                continue;
            }
            contain_watchers = true;

            let time_since = u64::try_from(now.duration_since(watcher.last_check.get()).as_nanos())
                .expect("int cast");
            let interval = u64::try_from(watcher.interval).expect("int cast") * 1_000_000;

            if time_since >= interval.saturating_sub(500) {
                watcher.last_check.set(now);
                StatWatcher::restat(&watcher, &ticket);
            } else {
                closest_next_check = (interval - time_since).min(closest_next_check);
            }
            min_interval = min_interval.min(watcher.interval);
            log!("reinsert watcher {:x}", watcher.as_ptr() as usize);
            kept.push(watcher);
        }
        {
            let mut queue = this.watchers.lock();
            kept.append(&mut queue);
            *queue = kept;
        }

        if this.is_shutdown.load(Ordering::Relaxed) {
            // Do not enqueue a `StatWatcherTimerUpdate` onto a JS-thread queue
            // that will never tick again.
            this.current_interval.store(0, Ordering::Relaxed);
        } else if contain_watchers {
            // choose the smallest interval or the closest time to the next check
            let interval = min_interval.min(i32::try_from(closest_next_check).expect("int cast"));
            this.current_interval.store(interval, Ordering::Relaxed);
            StatWatcherScheduler::schedule_timer_update(&this, &ticket);
        } else {
            // we do not have watchers, we can stop the timer
            this.current_interval.store(0, Ordering::Relaxed);
        }
        // Publish the queue writes above before declaring the work-pool hop
        // finished; `shutdown_for_exit` Acquire-loads this and then drains.
        this.work_pool_in_flight.store(false, Ordering::Release);
        drop(this);
        drop(ticket);
    }
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). `closed` is
// `AtomicBool` because it is genuinely cross-thread (written by `close()` on
// the JS thread, read by the stat pass). `last_check` is `Cell`
// (worker-thread-only after init); `persistent`/`poll_ref`/`this_value` are
// JS-thread-only. Read-only-after-construction fields stay bare.
#[bun_jsc::JsClass(no_constructor)]
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct StatWatcher {
    /// JS-thread uses only.
    ctx: BackRef<VirtualMachine>,

    ref_count: ThreadSafeRefCount<StatWatcher>,

    /// Closed is set to true to tell the scheduler to remove from list and deref.
    closed: AtomicBool,
    path: ZBox,
    persistent: Cell<bool>,
    bigint: bool,
    interval: i32,
    last_check: Cell<Instant>,

    global_this: BackRef<JSGlobalObject>,

    this_value: JsCell<JsRef>,

    poll_ref: JsCell<KeepAlive>,

    last_stat: Guarded<PosixStat>,

    /// One ref on the per-thread scheduler; released when the watcher is freed.
    scheduler: RefPtr<StatWatcherScheduler>,
}

impl Drop for StatWatcher {
    /// Runs when the last ref goes — possibly on the work-pool thread (a stat
    /// pass or `InitialStatTask` dropping the ref it held). Isolation-registry
    /// removal and the poll unref therefore live in `close()`, which every
    /// registered watcher reaches on the JS thread first: the Strong
    /// `this_value` self-ref keeps the wrapper alive until `close()`
    /// downgrades it, so `finalize` cannot drop the wrapper ref before then.
    fn drop(&mut self) {
        log!("deinit {:x}", core::ptr::from_ref(self) as usize);
        self.persistent.set(false);
        if self.poll_ref.get().is_active() {
            // We cannot unref() on another thread this way.
            debug_assert!(core::ptr::eq(
                VirtualMachine::get(),
                self.ctx.as_const_ptr()
            ));
            let el_ctx = self.ctx.loop_ctx();
            self.poll_ref.with_mut(|p| p.unref(el_ctx));
        }
        self.closed.store(true, Ordering::Relaxed);
        self.this_value.set(JsRef::empty());
    }
}

impl StatWatcher {
    /// The per-thread scheduler, created on first use; the returned ref is the
    /// caller's.
    fn lazy_scheduler(vm: &VirtualMachine) -> RefPtr<StatWatcherScheduler> {
        crate::jsc_hooks::with_stat_watcher_scheduler(|slot| {
            slot.get_or_insert_with(|| StatWatcherScheduler::init(vm))
                .clone()
        })
        .expect("fs.watchFile before the runtime state is installed")
    }

    /// Pool thread → JS thread: `hop` runs there and consumes `this`; a VM
    /// tearing down releases it from its queue instead.
    fn post_to_js_thread(
        this: RefPtr<StatWatcher>,
        hop: StatWatcherHopKind,
        ticket: &bun_jsc::Ticket,
    ) {
        let hop = Box::new(StatWatcherHop {
            watcher: this,
            kind: hop,
        });
        ticket.post(ConcurrentTask::create(Task::from_boxed(hop)));
    }

    /// Copy the last stat by value.
    ///
    /// This field is sometimes set from aonther thread, so we should copy by
    /// value instead of referencing by pointer.
    fn get_last_stat(&self) -> PosixStat {
        *self.last_stat.lock()
    }

    /// Set the last stat.
    fn set_last_stat(&self, stat: &PosixStat) {
        *self.last_stat.lock() = *stat;
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !this.closed.load(Ordering::Relaxed) && !this.persistent.get() {
            this.persistent.set(true);
            let el_ctx = this.ctx.loop_ctx();
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
            let el_ctx = this.ctx.loop_ctx();
            this.poll_ref.with_mut(|p| p.unref(el_ctx));
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Stops file watching but does not free the instance.
    ///
    /// Always runs on the JS thread (`do_close`, `stop_active_handles_for_vm_teardown`,
    /// `shutdown_for_exit`), so this is where the watcher leaves the
    /// isolation registry — the last ref can go on the work-pool thread where
    /// the thread-local registry is unreachable.
    pub(crate) fn close(&self) {
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            handles.swap_remove(&crate::jsc_hooks::ActiveHandle::StatWatcher(NonNull::from(
                self,
            )));
        }
        if self.persistent.get() {
            self.persistent.set(false);
        }
        let el_ctx = self.ctx.loop_ctx();
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

    /// The scheduler holds its own ref; `closed` tells it to drop it.
    pub(crate) fn finalize(&self) {
        log!("Finalize\n");
        self.this_value.with_mut(|r| r.finalize());
        self.closed.store(true, Ordering::Relaxed);
    }

    fn initial_stat_success_on_main_thread(
        this: &RefPtr<StatWatcher>,
    ) -> bun_event_loop::JsResult<()> {
        if this.closed.load(Ordering::Relaxed) {
            return Ok(());
        }

        let Some(js_this) = this.this_value.get().try_get() else {
            return Ok(());
        };
        let global_this = this.global_this.get();

        // Propagated to the task fold: reporting here would leave a
        // termination pending for the next queued task's JS entry.
        let jsvalue = stat_to_js_stats(global_this, &this.get_last_stat(), this.bigint)?;
        js::prev_stat_set_cached(js_this, global_this, jsvalue);

        this.scheduler.append(this.clone());
        Ok(())
    }

    fn initial_stat_error_on_main_thread(
        this: &RefPtr<StatWatcher>,
    ) -> bun_event_loop::JsResult<()> {
        if this.closed.load(Ordering::Relaxed) {
            return Ok(());
        }

        let Some(js_this) = this.this_value.get().try_get() else {
            return Ok(());
        };
        let global_this = this.global_this.get();
        let jsvalue = stat_to_js_stats(global_this, &this.get_last_stat(), this.bigint)?;
        js::prev_stat_set_cached(js_this, global_this, jsvalue);

        // R-2: `call()` re-enters JS, which may call `do_close()` → fresh
        // `&Self` from m_ctx; everything here is shared access.
        let result = js::listener_get_cached(js_this).unwrap().call(
            global_this,
            JSValue::UNDEFINED,
            &[jsvalue, jsvalue],
        );

        // Append to the scheduler before propagating a listener error so the
        // watcher keeps running after a throwing listener (Node semantics).
        // `append` does not enter JS, so it is safe with an exception pending.
        if !this.closed.load(Ordering::Relaxed) {
            this.scheduler.append(this.clone());
        }

        // Propagate to the dispatcher: `report_error_or_terminate` reports a
        // regular throw as uncaught and stops the tick loop on termination.
        // Swallowing the error here leaves a termination exception on the VM
        // and the next queued task re-enters JS under a
        // `scope.assertNoException()` RELEASE_ASSERT.
        result.map(drop)
    }

    /// Pool thread (the scheduler's pass).
    fn restat(this: &RefPtr<StatWatcher>, ticket: &bun_jsc::Ticket) {
        log!("recalling stat");
        let stat = restat_impl(&this.path);
        let res = match stat {
            Ok(res) => res,
            Err(_) => bun_core::ffi::zeroed::<PosixStat>(),
        };

        let last_stat = this.get_last_stat();

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

        this.set_last_stat(&res);
        Self::post_to_js_thread(this.clone(), StatWatcherHopKind::Changed, ticket);
    }

    /// After a restat found the file changed, this calls the listener function.
    fn swap_and_call_listener_on_main_thread(
        this: &RefPtr<StatWatcher>,
    ) -> bun_event_loop::JsResult<()> {
        if this.closed.load(Ordering::Relaxed) {
            return Ok(());
        }
        let Some(js_this) = this.this_value.get().try_get() else {
            return Ok(());
        };
        let global_this = this.global_this.get();
        let prev_jsvalue = js::prev_stat_get_cached(js_this).unwrap_or(JSValue::UNDEFINED);
        let current_jsvalue = stat_to_js_stats(global_this, &this.get_last_stat(), this.bigint)?;
        js::prev_stat_set_cached(js_this, global_this, current_jsvalue);

        // Propagate to the dispatcher: `report_error_or_terminate` reports a
        // regular throw as uncaught and stops the tick loop on termination.
        // Swallowing the error here leaves a termination exception on the VM
        // and the next queued task re-enters JS under a
        // `scope.assertNoException()` RELEASE_ASSERT.
        // R-2: `call()` re-enters JS, which may call `do_close()`; shared
        // access only.
        js::listener_get_cached(js_this)
            .unwrap()
            .call(
                global_this,
                JSValue::UNDEFINED,
                &[current_jsvalue, prev_jsvalue],
            )
            .map(drop)
    }

    fn init(args: &Arguments) -> Result<JSValue, crate::Error> {
        log!("init");

        let mut buf = bun_paths::path_buffer_pool::get();
        let mut slice = args.path.slice();
        if strings::starts_with(slice, b"file://") {
            slice = &slice[b"file://".len()..];
        }

        let top_level_dir = fs::FileSystem::get().top_level_dir;
        let parts: [&[u8]; 1] = [slice];
        let file_path =
            Path::join_abs_string_buf::<platform::Auto>(top_level_dir, &mut buf[..], &parts);

        let alloc_file_path = ZBox::from_bytes(file_path);

        let global_this: &JSGlobalObject = &args.global_this;
        let vm = global_this.bun_vm();
        let watcher = RefPtr::new(StatWatcher {
            ctx: BackRef::new(vm),
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
            last_stat: Guarded::init(bun_core::ffi::zeroed::<PosixStat>()),
            scheduler: Self::lazy_scheduler(vm),
        });

        if watcher.persistent.get() {
            let el_ctx = watcher.ctx.loop_ctx();
            watcher.poll_ref.with_mut(|p| p.ref_(el_ctx));
        }

        // The initial ref becomes the JS wrapper's (released by
        // `StatWatcherClass__finalize` → `finalize`). R-2: from here on the
        // codegen shim may form its own `&Self`, so everything below is shared
        // access through `this`.
        let this: ThisPtr<StatWatcher> = watcher.into_this_ptr();
        let js_this = StatWatcher::to_js_nonnull(
            NonNull::new(this.as_ptr()).expect("RefPtr is non-null"),
            global_this,
        );
        this.this_value
            .set(JsRef::init_strong(js_this, global_this));
        js::listener_set_cached(js_this, global_this, args.listener);
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            bun_core::handle_oom(handles.put(
                crate::jsc_hooks::ActiveHandle::StatWatcher(
                    NonNull::new(this.as_ptr()).expect("RefPtr is non-null"),
                ),
                (),
            ));
        }
        InitialStatTask::create_and_schedule(RefPtr::from_this(this));

        Ok(js_this)
    }
}

// Shared by InitialStatTask::run_owned and StatWatcher::restat — identical logic.
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
    pub path: PathLike<'static>,
    pub(crate) listener: JSValue,

    pub(crate) persistent: bool,
    pub(crate) bigint: bool,
    pub(crate) interval: i32,

    // JSC_BORROW — global outlives the parsed `Arguments`; `BackRef` gives
    // safe `&JSGlobalObject` projection at every read site.
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
        StatWatcher::init(&self)
    }
}

/// Which JS-thread continuation a posted [`StatWatcherHop`] runs.
#[derive(Clone, Copy)]
pub(crate) enum StatWatcherHopKind {
    InitialStatSuccess,
    InitialStatError,
    Changed,
}

/// A pool → JS thread continuation for one watcher (`task_tag::StatWatcherHop`).
/// Owns one ref on the watcher, released when it has run or is released unrun.
pub(crate) struct StatWatcherHop {
    watcher: RefPtr<StatWatcher>,
    kind: StatWatcherHopKind,
}

impl StatWatcherHop {
    /// JS thread dispatch of the hop.
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) -> bun_event_loop::JsResult<()> {
        let result = match self.kind {
            StatWatcherHopKind::InitialStatSuccess => {
                StatWatcher::initial_stat_success_on_main_thread(&self.watcher)
            }
            StatWatcherHopKind::InitialStatError => {
                StatWatcher::initial_stat_error_on_main_thread(&self.watcher)
            }
            StatWatcherHopKind::Changed => {
                StatWatcher::swap_and_call_listener_on_main_thread(&self.watcher)
            }
        };
        drop(self);
        result
    }

    /// VM teardown release of a queued hop (JS thread): drop the hop's ref.
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn release_unrun(self: Box<Self>) {
        drop(self);
    }
}

pub(crate) struct InitialStatTask {
    /// One ref, handed on to the JS-thread hop (or released here if the
    /// watcher was closed before the pool got to it).
    watcher: RefPtr<StatWatcher>,
    ticket: bun_jsc::Ticket,
    task: WorkPoolTask,
}

bun_threading::owned_task!(InitialStatTask, task);

impl InitialStatTask {
    /// JS thread.
    fn create_and_schedule(watcher: RefPtr<StatWatcher>) {
        // The watcher is a JS-owned m_ctx; its VM waits for this ticket.
        let ticket = watcher.ctx.ticket();
        WorkPool::schedule_new(InitialStatTask {
            watcher,
            ticket,
            task: WorkPoolTask::default(),
        });
    }

    // `owned_task!` requires `fn run_owned(self: Box<Self>)`; clippy::boxed_local
    // is a false positive on this macro contract.
    #[allow(clippy::boxed_local)]
    fn run_owned(self: Box<Self>) {
        let InitialStatTask {
            watcher: this,
            ticket,
            task: _,
        } = *self;
        // The main thread may concurrently run `close()`/`finalize()` after
        // `init()` returned the watcher to JS; both are shared access (R-2), as
        // is everything here (`closed` is atomic, `set_last_stat` locks).

        if this.closed.load(Ordering::Relaxed) {
            return;
        }

        let stat = restat_impl(&this.path);
        match stat {
            Ok(ref res) => {
                // we store the stat, but do not call the callback
                this.set_last_stat(res);
                StatWatcher::post_to_js_thread(
                    this,
                    StatWatcherHopKind::InitialStatSuccess,
                    &ticket,
                );
            }
            Err(_) => {
                // on enoent, eperm, we call cb with two zeroed stat objects
                // and store previous stat as a zeroed stat object, and then call the callback.
                this.set_last_stat(&bun_core::ffi::zeroed::<PosixStat>());
                StatWatcher::post_to_js_thread(this, StatWatcherHopKind::InitialStatError, &ticket);
            }
        }
    }
}

/// Pool → JS thread: re-arm the scheduler's timer for its current interval
/// (`task_tag::StatWatcherTimerUpdate`). Owns one scheduler ref.
pub(crate) struct StatWatcherTimerUpdate {
    scheduler: RefPtr<StatWatcherScheduler>,
}

impl StatWatcherTimerUpdate {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) {
        let interval = self.scheduler.get_interval();
        self.scheduler.set_timer(interval);
    }

    /// Timers are already disarmed; just drop the ref.
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn release_unrun(self: Box<Self>) {
        drop(self);
    }
}
