//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.

use core::ffi::c_void;
use core::mem::offset_of;

use bun_collections::ArrayHashMap;
use bun_core::timespec; // TODO(port): confirm crate for `bun.timespec`
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_str::String as BunString;
use bun_threading::Mutex; // TODO(port): confirm crate for `bun.Mutex`
use bun_uws::Loop as UwsLoop;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

// Re-exports (thin — do NOT inline target bodies)
pub use bun_event_loop::EventLoopTimer;
pub use super::timeout_object::TimeoutObject;
pub use super::immediate_object::ImmediateObject;
pub use super::timer_object_internals::TimerObjectInternals;
/// A timer created by WTF code and invoked by Bun's event loop
pub use super::wtf_timer::WTFTimer;
pub use super::date_header_timer::DateHeaderTimer;
pub use super::event_loop_delay_monitor::EventLoopDelayMonitor;

use bun_jsc::jest::bun_test::FakeTimers;

/// TimeoutMap is map of i32 to nullable Timeout structs
/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
/// When Timeout is null, it means the tasks have been scheduled but not yet executed.
/// Timeouts are enqueued as a task to be run on the next tick of the task queue
/// The task queue runs after the event loop tasks have been run
/// Therefore, there is a race condition where you cancel the task after it has already been enqueued
/// In that case, it shouldn't run. It should be skipped.
pub type TimeoutMap = ArrayHashMap<i32, *mut EventLoopTimer>;

// TODO(port): `heap.Intrusive(EventLoopTimer, void, EventLoopTimer.less)` — the
// Zig type-returning fn takes a comptime comparator. In Rust, encode the
// comparator via a trait impl on `EventLoopTimer` (or a const fn ptr param) in
// `bun_io::heap`.
pub type TimerHeap = bun_io::heap::Intrusive<EventLoopTimer>;

// We split up the map here to avoid storing an extra "repeat" boolean
#[derive(Default)]
pub struct Maps {
    pub set_timeout: TimeoutMap,
    pub set_interval: TimeoutMap,
    pub set_immediate: TimeoutMap,
}

impl Maps {
    #[inline]
    pub fn get(&mut self, kind: Kind) -> &mut TimeoutMap {
        match kind {
            Kind::SetTimeout => &mut self.set_timeout,
            Kind::SetInterval => &mut self.set_interval,
            Kind::SetImmediate => &mut self.set_immediate,
        }
    }
}

pub struct All {
    pub last_id: i32,
    pub lock: Mutex,
    pub thread_id: std::thread::ThreadId,
    pub timers: TimerHeap,
    pub active_timer_count: i32,
    #[cfg(windows)]
    pub uv_timer: uv::Timer,
    /// Whether we have emitted a warning for passing a negative timeout duration
    pub warned_negative_number: bool,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    pub warned_not_number: bool,
    /// Incremented when timers are scheduled or rescheduled. See doc comment on
    /// TimerObjectInternals.epoch.
    pub epoch: u32, // Zig u25 — stored in u32, masked to 25 bits on increment (see `update`)
    pub immediate_ref_count: i32,
    #[cfg(windows)]
    pub uv_idle: uv::uv_idle_t,

    // Event loop delay monitoring (not exposed to JS)
    pub event_loop_delay: EventLoopDelayMonitor,

    pub fake_timers: FakeTimers,

    // We split up the map here to avoid storing an extra "repeat" boolean
    pub maps: Maps,

    /// Updates the "Date" header.
    pub date_header_timer: DateHeaderTimer,
}

impl All {
    pub fn init() -> Self {
        Self {
            last_id: 1,
            lock: Mutex::default(),
            thread_id: std::thread::current().id(),
            timers: TimerHeap::default(),
            active_timer_count: 0,
            #[cfg(windows)]
            // SAFETY: all-zero is a valid uv::Timer (C struct, initialized later via uv_timer_init)
            uv_timer: unsafe { core::mem::zeroed() },
            warned_negative_number: false,
            warned_not_number: false,
            epoch: 0,
            immediate_ref_count: 0,
            #[cfg(windows)]
            // SAFETY: all-zero is a valid uv_idle_t (C struct, initialized later via uv_idle_init)
            uv_idle: unsafe { core::mem::zeroed() },
            event_loop_delay: EventLoopDelayMonitor::default(),
            fake_timers: FakeTimers::default(),
            maps: Maps::default(),
            date_header_timer: DateHeaderTimer::default(),
        }
    }

    pub fn insert(&mut self, timer: *mut EventLoopTimer) {
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        // TODO(port): Mutex lock/unlock — if `bun_threading::Mutex` returns an RAII guard, use that instead.
        self.insert_lock_held(timer);
    }

    fn insert_lock_held(&mut self, timer: *mut EventLoopTimer) {
        #[cfg(feature = "ci_assert")]
        debug_assert!(self.lock.try_lock() == false);
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer
        let timer_ref = unsafe { &mut *timer };
        if self.fake_timers.is_active() && timer_ref.tag.allow_fake_timers() {
            self.fake_timers.timers.insert(timer);
            timer_ref.state = EventLoopTimerState::ACTIVE;
            timer_ref.in_heap = InHeap::Fake;
        } else {
            self.timers.insert(timer);
            timer_ref.state = EventLoopTimerState::ACTIVE;
            timer_ref.in_heap = InHeap::Regular;

            #[cfg(windows)]
            {
                // SAFETY: `self` is the `timer` field of a `VirtualMachine`
                let vm = unsafe {
                    &mut *((self as *mut Self as *mut u8)
                        .sub(offset_of!(VirtualMachine, timer))
                        .cast::<VirtualMachine>())
                };
                self.ensure_uv_timer(vm);
            }
        }
    }

    pub fn remove(&mut self, timer: *mut EventLoopTimer) {
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        self.remove_lock_held(timer);
    }

    fn remove_lock_held(&mut self, timer: *mut EventLoopTimer) {
        #[cfg(feature = "ci_assert")]
        debug_assert!(self.lock.try_lock() == false);
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer
        let timer_ref = unsafe { &mut *timer };
        match timer_ref.in_heap {
            InHeap::None => {
                #[cfg(feature = "ci_assert")]
                debug_assert!(false); // can't remove a timer that was not inserted
            }
            InHeap::Regular => self.timers.remove(timer),
            InHeap::Fake => self.fake_timers.timers.remove(timer),
        }
        timer_ref.in_heap = InHeap::None;
        timer_ref.state = EventLoopTimerState::CANCELLED;
    }

    /// Remove the EventLoopTimer if necessary.
    pub fn update(&mut self, timer: *mut EventLoopTimer, time: &timespec) {
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer
        let timer_ref = unsafe { &mut *timer };
        if timer_ref.state == EventLoopTimerState::ACTIVE {
            self.remove_lock_held(timer);
        }

        #[cfg(feature = "ci_assert")]
        {
            if core::ptr::eq(&timer_ref.next, time) {
                panic!("timer.next == time. For threadsafety reasons, time and timer.next must always be a different pointer.");
            }
        }

        timer_ref.next = *time;
        if let Some(flags) = timer_ref.js_timer_internals_flags() {
            // Zig: `epoch: u25` with `+%= 1` — wrap at 2^25 to preserve modular ordering used by EventLoopTimer.less.
            self.epoch = self.epoch.wrapping_add(1) & ((1 << 25) - 1);
            flags.epoch = self.epoch;
        }

        self.insert_lock_held(timer);
    }

    #[cfg(windows)]
    fn ensure_uv_timer(&mut self, vm: &mut VirtualMachine) {
        if self.uv_timer.data.is_null() {
            self.uv_timer.init(vm.uv_loop());
            self.uv_timer.data = vm as *mut VirtualMachine as *mut c_void;
            self.uv_timer.unref();
        }

        if let Some(timer) = self.timers.peek() {
            uv::uv_update_time(vm.uv_loop());
            let now = timespec::now(timespec::Mode::ForceRealTime);
            let wait = if timer.next.greater(&now) {
                timer.next.duration(&now)
            } else {
                timespec { nsec: 0, sec: 0 }
            };

            // minimum 1ms
            // https://github.com/nodejs/node/blob/f552c86fecd6c2ba9e832ea129b731dd63abdbe2/src/env.cc#L1512
            let wait_ms = wait.ms_unsigned().max(1);

            self.uv_timer.start(wait_ms, 0, Self::on_uv_timer);

            if self.active_timer_count > 0 {
                self.uv_timer.ref_();
            } else {
                self.uv_timer.unref();
            }
        }
    }

    #[cfg(windows)]
    pub extern "C" fn on_uv_timer(uv_timer_t: *mut uv::Timer) {
        // SAFETY: uv_timer_t points to All.uv_timer; All is the `timer` field of VirtualMachine
        let all = unsafe {
            &mut *((uv_timer_t as *mut u8)
                .sub(offset_of!(All, uv_timer))
                .cast::<All>())
        };
        // SAFETY: `all` is the `timer` field of a VirtualMachine
        let vm = unsafe {
            &mut *((all as *mut All as *mut u8)
                .sub(offset_of!(VirtualMachine, timer))
                .cast::<VirtualMachine>())
        };
        all.drain_timers(vm);
        all.ensure_uv_timer(vm);
    }

    pub fn increment_immediate_ref(&mut self, delta: i32) {
        let old = self.immediate_ref_count;
        let new = old + delta;
        self.immediate_ref_count = new;
        // SAFETY: `self` is the `timer` field of a `VirtualMachine`
        let vm = unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(offset_of!(VirtualMachine, timer))
                .cast::<VirtualMachine>())
        };

        if old <= 0 && new > 0 {
            #[cfg(windows)]
            {
                if self.uv_idle.data.is_null() {
                    self.uv_idle.init(uv::Loop::get());
                    self.uv_idle.data = vm as *mut VirtualMachine as *mut c_void;
                }

                // Matches Node.js behavior
                extern "C" fn cb(_: *mut uv::uv_idle_t) {
                    // prevent libuv from polling forever
                }
                self.uv_idle.start(cb);
            }
            #[cfg(not(windows))]
            {
                vm.uws_loop().ref_();
            }
        } else if old > 0 && new <= 0 {
            #[cfg(windows)]
            {
                if !self.uv_idle.data.is_null() {
                    self.uv_idle.stop();
                }
            }
            #[cfg(not(windows))]
            {
                vm.uws_loop().unref();
            }
        }
    }

    pub fn increment_timer_ref(&mut self, delta: i32) {
        // SAFETY: `self` is the `timer` field of a `VirtualMachine`
        let vm = unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(offset_of!(VirtualMachine, timer))
                .cast::<VirtualMachine>())
        };

        let old = self.active_timer_count;
        let new = old + delta;

        if cfg!(debug_assertions) {
            debug_assert!(new >= 0);
        }

        self.active_timer_count = new;

        if old <= 0 && new > 0 {
            #[cfg(windows)]
            {
                self.uv_timer.ref_();
            }
            #[cfg(not(windows))]
            {
                vm.uws_loop().ref_();
            }
        } else if old > 0 && new <= 0 {
            #[cfg(windows)]
            {
                self.uv_timer.unref();
            }
            #[cfg(not(windows))]
            {
                vm.uws_loop().unref();
            }
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__Timer__getNextID() -> i32 {
        let vm = VirtualMachine::get();
        vm.timer.last_id = vm.timer.last_id.wrapping_add(1);
        vm.timer.last_id
    }

    fn is_date_timer_active(&self) -> bool {
        self.date_header_timer.event_loop_timer.state == EventLoopTimerState::ACTIVE
    }

    pub fn update_date_header_timer_if_necessary(&mut self, loop_: &UwsLoop, vm: &mut VirtualMachine) {
        if loop_.should_enable_date_header_timer() {
            if !self.is_date_timer_active() {
                self.date_header_timer.enable(
                    vm,
                    // Be careful to avoid adding extra calls to bun.timespec.now()
                    // when it's not needed.
                    &timespec::now(timespec::Mode::AllowMockedTime),
                );
            }
        } else {
            // don't un-schedule it here.
            // it's better to wake up an extra 1 time after a second idle
            // than to have to check a date potentially on every single HTTP request.
        }
    }

    pub fn get_timeout(&mut self, spec: &mut timespec, vm: &mut VirtualMachine) -> bool {
        // On POSIX, if there are pending immediate tasks, use a zero timeout
        // so epoll/kqueue returns immediately without the overhead of writing
        // to the eventfd via wakeup().
        #[cfg(unix)]
        {
            if vm.event_loop.immediate_tasks.len() > 0 {
                *spec = timespec { nsec: 0, sec: 0 };
                return true;
            }
        }

        // lsquic's earliest_adv_tick (set by us_quic_loop_process from
        // loop_post). Folded into the epoll timeout instead of arming a
        // timerfd, so scheduling is free.
        #[cfg(unix)]
        let quic_us: Option<i64> = 'us: {
            let Some(loop_) = vm.event_loop_handle else { break 'us None };
            if loop_.internal_loop_data.quic_head.is_null() {
                break 'us None;
            }
            Some(loop_.internal_loop_data.quic_next_tick_us)
        };
        #[cfg(not(unix))]
        let quic_us: Option<i64> = None;

        let mut maybe_now: Option<timespec> = None;
        while let Some(min) = self.timers.peek() {
            let now = match maybe_now {
                Some(n) => n,
                None => {
                    let real_now = timespec::now(timespec::Mode::AllowMockedTime);
                    maybe_now = Some(real_now);
                    real_now
                }
            };

            match now.order(&min.next) {
                core::cmp::Ordering::Greater | core::cmp::Ordering::Equal => {
                    // Side-effect: potentially call the StopIfNecessary timer.
                    if min.tag == EventLoopTimerTag::WTFTimer {
                        let _ = self.timers.delete_min();
                        min.fire(&now, vm);
                        continue;
                    }

                    *spec = timespec { nsec: 0, sec: 0 };
                    return true;
                }
                core::cmp::Ordering::Less => {
                    *spec = min.next.duration(&now);
                    if let Some(us) = quic_us {
                        if us >= 0 {
                            Self::clamp_to_quic(spec, us);
                        }
                    }
                    return true;
                }
            }
        }

        if let Some(us) = quic_us {
            if us >= 0 {
                *spec = timespec {
                    sec: i64::try_from(us / US_PER_S).unwrap(),
                    nsec: i64::try_from((us % US_PER_S) * NS_PER_US).unwrap(),
                };
                return true;
            }
        }
        false
    }

    fn clamp_to_quic(spec: &mut timespec, us: i64) {
        let cur_us = (spec.sec as i64) * US_PER_S + spec.nsec / NS_PER_US;
        if us < cur_us {
            *spec = timespec {
                sec: i64::try_from(us / US_PER_S).unwrap(),
                nsec: i64::try_from((us % US_PER_S) * NS_PER_US).unwrap(),
            };
        }
    }

    // Getting the current time is expensive on certain platforms.
    // We don't want to call it when there are no timers.
    // And when we do call it, we want to be sure we only call it once.
    // and we do NOT want to hold the lock while the timer is running it's code.
    // This function has to be thread-safe.
    fn next(&mut self, has_set_now: &mut bool, now: &mut timespec) -> Option<*mut EventLoopTimer> {
        self.lock.lock();
        let _guard = scopeguard::guard((), |_| self.lock.unlock());

        if let Some(timer) = self.timers.peek() {
            if !*has_set_now {
                *now = timespec::now(timespec::Mode::AllowMockedTime);
                *has_set_now = true;
            }
            if timer.next.greater(now) {
                return None;
            }

            let deleted = self.timers.delete_min().expect("peek succeeded");
            debug_assert!(core::ptr::eq(deleted, timer));

            return Some(timer as *mut EventLoopTimer);
        }
        None
    }

    pub fn drain_timers(&mut self, vm: &mut VirtualMachine) {
        // Set in next().
        let mut now: timespec = timespec { sec: 0, nsec: 0 }; // TODO(port): Zig used `undefined`; zero-init is fine since guarded by has_set_now
        // Split into a separate variable to avoid increasing the size of the timespec type.
        let mut has_set_now: bool = false;

        while let Some(t) = self.next(&mut has_set_now, &mut now) {
            // SAFETY: `t` was just popped from the intrusive heap and is live
            unsafe { (*t).fire(&now, vm) };
        }
    }

    fn warn_invalid_countdown(global_this: &JSGlobalObject, countdown: f64, warning_type: TimeoutWarning) {
        const SUFFIX: &str = ".\nTimeout duration was set to 1.";

        let warning_string = match warning_type {
            TimeoutWarning::TimeoutOverflowWarning => {
                if countdown.is_finite() {
                    BunString::create_format(format_args!(
                        "{countdown} does not fit into a 32-bit signed integer{SUFFIX}"
                    ))
                } else {
                    // -Infinity is handled by TimeoutNegativeWarning
                    BunString::ascii(const_format::concatcp!(
                        "Infinity does not fit into a 32-bit signed integer",
                        SUFFIX
                    ))
                }
            }
            TimeoutWarning::TimeoutNegativeWarning => {
                if countdown.is_finite() {
                    BunString::create_format(format_args!("{countdown} is a negative number{SUFFIX}"))
                } else {
                    BunString::ascii(const_format::concatcp!("-Infinity is a negative number", SUFFIX))
                }
            }
            // std.fmt gives us "nan" but Node.js wants "NaN".
            TimeoutWarning::TimeoutNaNWarning => {
                debug_assert!(countdown.is_nan());
                BunString::ascii(const_format::concatcp!("NaN is not a number", SUFFIX))
            }
        };
        let warning_type_string = BunString::create_atom_if_possible(<&'static str>::from(warning_type));
        // Emitting a warning should never interrupt execution, but the emit path calls
        // into user-observable JS (process.nextTick, getters, etc.) which can throw.
        // Swallowing error.JSError alone leaves the exception pending on the VM and
        // trips assertExceptionPresenceMatches in the host-call wrapper, so clear it.
        let warning_js = match warning_string.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => {
                let _ = global_this.clear_exception_except_termination();
                return;
            }
        };
        let warning_type_js = match warning_type_string.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => {
                let _ = global_this.clear_exception_except_termination();
                return;
            }
        };
        if global_this
            .emit_warning(warning_js, warning_type_js, JSValue::UNDEFINED, JSValue::UNDEFINED)
            .is_err()
        {
            let _ = global_this.clear_exception_except_termination();
        }
    }

    /// Convert an arbitrary JavaScript value to a number of milliseconds used to schedule a timer.
    fn js_value_to_countdown(
        &mut self,
        global_this: &JSGlobalObject,
        countdown: JSValue,
        overflow_behavior: CountdownOverflowBehavior,
        warn: bool,
    ) -> JsResult<u32> {
        // TODO(port): Zig return type is `u31`; using u32 here, callers must respect the [0, i32::MAX] range.
        // We don't deal with nesting levels directly
        // but we do set the minimum timeout to be 1ms for repeating timers
        let countdown_double = countdown.to_number(global_this)?;
        let countdown_int: u32 = match overflow_behavior {
            CountdownOverflowBehavior::Clamp => {
                // std.math.lossyCast(u31, countdown_double): saturating cast to [0, i32::MAX]
                // Rust `as` saturates float→int; clamp upper to u31 max.
                (countdown_double as u32).min(i32::MAX as u32)
                // TODO(port): verify NaN→0 behavior matches std.math.lossyCast
            }
            CountdownOverflowBehavior::OneMs => {
                if !(countdown_double >= 1.0 && countdown_double <= i32::MAX as f64) {
                    if warn {
                        if countdown_double > i32::MAX as f64 {
                            Self::warn_invalid_countdown(global_this, countdown_double, TimeoutWarning::TimeoutOverflowWarning);
                        } else if countdown_double < 0.0 && !self.warned_negative_number {
                            self.warned_negative_number = true;
                            Self::warn_invalid_countdown(global_this, countdown_double, TimeoutWarning::TimeoutNegativeWarning);
                        } else if !countdown.is_undefined()
                            && countdown.is_number()
                            && countdown_double.is_nan()
                            && !self.warned_not_number
                        {
                            self.warned_not_number = true;
                            Self::warn_invalid_countdown(global_this, countdown_double, TimeoutWarning::TimeoutNaNWarning);
                        }
                    }
                    1
                } else {
                    countdown_double as u32
                }
            }
        };

        Ok(countdown_int)
    }

    /// Bun.sleep
    /// a setTimeout that uses a promise instead of a callback, and interprets the countdown
    /// slightly differently for historical reasons (see jsValueToCountdown)
    pub fn sleep(global: &JSGlobalObject, promise: JSValue, countdown: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!promise.is_empty() && !countdown.is_empty());
        let vm = global.bun_vm();
        let id = vm.timer.last_id;
        vm.timer.last_id = vm.timer.last_id.wrapping_add(1);

        let countdown_int = vm.timer.js_value_to_countdown(global, countdown, CountdownOverflowBehavior::Clamp, true)?;
        let wrapped_promise = promise.with_async_context_if_needed(global);
        TimeoutObject::init(global, id, Kind::SetTimeout, countdown_int, wrapped_promise, JSValue::UNDEFINED)
    }

    pub fn set_immediate(global: &JSGlobalObject, callback: JSValue, arguments: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty());
        let vm = global.bun_vm();
        let id = vm.timer.last_id;
        vm.timer.last_id = vm.timer.last_id.wrapping_add(1);

        let wrapped_callback = callback.with_async_context_if_needed(global);
        ImmediateObject::init(global, id, wrapped_callback, arguments)
    }

    pub fn set_timeout(
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty() && !countdown.is_empty());
        let vm = global.bun_vm();
        let id = vm.timer.last_id;
        vm.timer.last_id = vm.timer.last_id.wrapping_add(1);

        let wrapped_callback = callback.with_async_context_if_needed(global);
        let countdown_int = global.bun_vm().timer.js_value_to_countdown(global, countdown, CountdownOverflowBehavior::OneMs, true)?;
        TimeoutObject::init(global, id, Kind::SetTimeout, countdown_int, wrapped_callback, arguments)
    }

    pub fn set_interval(
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
        countdown: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        debug_assert!(!callback.is_empty() && !arguments.is_empty() && !countdown.is_empty());
        let vm = global.bun_vm();
        let id = vm.timer.last_id;
        vm.timer.last_id = vm.timer.last_id.wrapping_add(1);

        let wrapped_callback = callback.with_async_context_if_needed(global);
        let countdown_int = global.bun_vm().timer.js_value_to_countdown(global, countdown, CountdownOverflowBehavior::OneMs, true)?;
        TimeoutObject::init(global, id, Kind::SetInterval, countdown_int, wrapped_callback, arguments)
    }

    fn remove_timer_by_id(&mut self, id: i32) -> Option<*mut TimeoutObject> {
        if let Some(entry) = self.maps.set_timeout.fetch_swap_remove(&id) {
            // SAFETY: entry.value points to EventLoopTimer embedded in a TimeoutObject
            debug_assert!(unsafe { (*entry.value).tag } == EventLoopTimerTag::TimeoutObject);
            // SAFETY: entry.value points to TimeoutObject.event_loop_timer
            return Some(unsafe {
                (entry.value as *mut u8)
                    .sub(offset_of!(TimeoutObject, event_loop_timer))
                    .cast::<TimeoutObject>()
            });
        } else if let Some(entry) = self.maps.set_interval.fetch_swap_remove(&id) {
            // SAFETY: entry.value points to a live EventLoopTimer embedded in a TimeoutObject
            debug_assert!(unsafe { (*entry.value).tag } == EventLoopTimerTag::TimeoutObject);
            // SAFETY: entry.value points to TimeoutObject.event_loop_timer
            return Some(unsafe {
                (entry.value as *mut u8)
                    .sub(offset_of!(TimeoutObject, event_loop_timer))
                    .cast::<TimeoutObject>()
            });
        }
        None
    }

    pub fn clear_timer(timer_id_value: JSValue, global_this: &JSGlobalObject, kind: Kind) -> JsResult<()> {
        bun_jsc::mark_binding!();

        let vm = global_this.bun_vm();

        let timer: Option<*mut TimerObjectInternals> = 'brk: {
            if timer_id_value.is_int32() {
                // Immediates don't have numeric IDs in Node.js so we only have to look up timeouts and intervals
                let Some(t) = vm.timer.remove_timer_by_id(timer_id_value.as_int32()) else {
                    return Ok(());
                };
                // SAFETY: t is a valid TimeoutObject pointer
                break 'brk Some(unsafe { &mut (*t).internals } as *mut TimerObjectInternals);
            } else if timer_id_value.is_string_literal() {
                let string = timer_id_value.to_bun_string(global_this)?;
                // Custom parseInt logic. I've done this because Node.js is very strict about string
                // parameters to this function: they can't have leading whitespace, trailing
                // characters, signs, or even leading zeroes. None of the readily-available string
                // parsing functions are this strict. The error case is to just do nothing (not
                // clear any timer).
                //
                // The reason is that in Node.js this function's parameter is used for an array
                // lookup, and array[0] is the same as array['0'] in JS but not the same as array['00'].
                let parsed: i32 = 'parsed: {
                    let mut accumulator: i32 = 0;
                    // We can handle all encodings the same way since the only permitted characters
                    // are ASCII.
                    // TODO(port): Zig used `inline else` over string.encoding() to call
                    // `.latin1()` / `.utf8()` / `.utf16()` via @field+@tagName. Expanded by hand;
                    // a small macro on bun_str::String could de-duplicate this in Phase B.
                    macro_rules! parse_slice {
                        ($slice:expr) => {{
                            let slice = $slice;
                            for (i, &c) in slice.iter().enumerate() {
                                let c = c as u32;
                                if c < ('0' as u32) || c > ('9' as u32) {
                                    // Non-digit characters are not allowed
                                    return Ok(());
                                } else if i == 0 && c == ('0' as u32) {
                                    // Leading zeroes are not allowed
                                    return Ok(());
                                }
                                // Fail on overflow
                                accumulator = match accumulator.checked_mul(10) {
                                    Some(v) => v,
                                    None => return Ok(()),
                                };
                                accumulator = match accumulator.checked_add(i32::try_from(c - '0' as u32).unwrap()) {
                                    Some(v) => v,
                                    None => return Ok(()),
                                };
                            }
                        }};
                    }
                    match string.encoding() {
                        bun_str::Encoding::Latin1 => parse_slice!(string.latin1()),
                        bun_str::Encoding::Utf8 => parse_slice!(string.utf8()),
                        bun_str::Encoding::Utf16 => parse_slice!(string.utf16()),
                    }
                    break 'parsed accumulator;
                };
                let Some(t) = vm.timer.remove_timer_by_id(parsed) else {
                    return Ok(());
                };
                // SAFETY: t is a valid TimeoutObject pointer
                break 'brk Some(unsafe { &mut (*t).internals } as *mut TimerObjectInternals);
            }

            if let Some(timeout) = TimeoutObject::from_js(timer_id_value) {
                // clearImmediate should be a noop if anything other than an Immediate is passed to it.
                if kind != Kind::SetImmediate {
                    break 'brk Some(&mut timeout.internals as *mut TimerObjectInternals);
                } else {
                    return Ok(());
                }
            } else if let Some(immediate) = ImmediateObject::from_js(timer_id_value) {
                // setImmediate can only be cleared by clearImmediate, not by clearTimeout or clearInterval.
                if kind == Kind::SetImmediate {
                    break 'brk Some(&mut immediate.internals as *mut TimerObjectInternals);
                } else {
                    return Ok(());
                }
            } else {
                break 'brk None;
            }
        };

        let Some(timer) = timer else { return Ok(()) };
        // SAFETY: timer points to a live TimerObjectInternals
        unsafe { (*timer).cancel(vm) };
        Ok(())
    }

    pub fn clear_immediate(global_this: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        Self::clear_timer(id, global_this, Kind::SetImmediate)?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn clear_timeout(global_this: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        Self::clear_timer(id, global_this, Kind::SetTimeout)?;
        Ok(JSValue::UNDEFINED)
    }

    pub fn clear_interval(global_this: &JSGlobalObject, id: JSValue) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        Self::clear_timer(id, global_this, Kind::SetInterval)?;
        Ok(JSValue::UNDEFINED)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__internal_drainTimers(vm: *mut VirtualMachine) {
    // SAFETY: called from C++ with a valid VirtualMachine
    let vm = unsafe { &mut *vm };
    vm.timer.drain_timers(vm);
    // PORT NOTE: reshaped for borrowck — Zig passes `&vm.timer` and `vm` separately.
}

// TODO(port): proc-macro — Zig used `jsc.host_fn.wrapN(...)` to generate C-ABI
// shims and `@export` them under these names. In Rust, a `#[bun_jsc::host_fn]`
// attribute (or a dedicated wrapN! macro) should emit the equivalent
// `#[unsafe(no_mangle)] extern "C"` thunks:
//   Bun__Timer__setImmediate  -> All::set_immediate
//   Bun__Timer__sleep         -> All::sleep
//   Bun__Timer__setTimeout    -> All::set_timeout
//   Bun__Timer__setInterval   -> All::set_interval
//   Bun__Timer__clearImmediate-> All::clear_immediate
//   Bun__Timer__clearTimeout  -> All::clear_timeout
//   Bun__Timer__clearInterval -> All::clear_interval
//   Bun__Timer__getNextID     -> All::Bun__Timer__getNextID (already #[no_mangle] above)

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
enum TimeoutWarning {
    TimeoutOverflowWarning,
    TimeoutNegativeWarning,
    TimeoutNaNWarning,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
enum CountdownOverflowBehavior {
    /// If the countdown overflows the range of int32_t, use a countdown of 1ms instead. Behavior of `setTimeout` and friends.
    OneMs,
    /// If the countdown overflows the range of int32_t, clamp to the nearest value within the range. Behavior of `Bun.sleep`.
    Clamp,
}

#[repr(u8)] // TODO(port): Zig is enum(u2)
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Kind {
    SetTimeout = 0,
    SetInterval = 1,
    SetImmediate = 2,
}

impl Kind {
    pub fn big(self) -> KindBig {
        // SAFETY: Kind and KindBig share discriminant values 0..=2
        unsafe { core::mem::transmute::<u32, KindBig>(self as u32) }
    }
}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum KindBig {
    SetTimeout = 0,
    SetInterval = 1,
    SetImmediate = 2,
}

// this is sized to be the same as one pointer
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ID {
    pub id: i32,
    pub kind: KindBig,
}

impl Default for ID {
    fn default() -> Self {
        Self { id: 0, kind: KindBig::SetTimeout }
    }
}

impl ID {
    #[inline]
    pub fn async_id(self) -> u64 {
        // SAFETY: ID is #[repr(C)] {i32, u32-repr enum} = 8 bytes = u64
        unsafe { core::mem::transmute::<ID, u64>(self) }
    }

    pub fn repeats(self) -> bool {
        self.kind == KindBig::SetInterval
    }
}

pub mod internal_bindings {
    use super::*;

    /// Node.js has some tests that check whether timers fire at the right time. They check this
    /// with the internal binding `getLibuvNow()`, which returns an integer in milliseconds. This
    /// works because `getLibuvNow()` is also the clock that their timers implementation uses to
    /// choose when to schedule timers.
    ///
    /// I've tried changing those tests to use `performance.now()` or `Date.now()`. But that always
    /// introduces spurious failures, because neither of those functions use the same clock that the
    /// timers implementation uses (for Bun this is `bun.timespec.now()`), so the tests end up
    /// thinking that the timing is wrong (this also happens when I run the modified test in
    /// Node.js). So the best course of action is for Bun to also expose a function that reveals the
    /// clock that is used to schedule timers.
    #[bun_jsc::host_fn]
    pub fn timer_clock_ms(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let _ = global_this;
        let _ = call_frame;
        let now = timespec::now(timespec::Mode::AllowMockedTime).ms();
        Ok(JSValue::js_number_from_int64(now))
    }
}

// std.time constants
const US_PER_S: i64 = 1_000_000;
const NS_PER_US: i64 = 1_000;

// TODO(port): these enum types live in EventLoopTimer.zig; referenced here for
// field access. Phase B should import them from `bun_event_loop::EventLoopTimer`.
use bun_event_loop::event_loop_timer::{
    InHeap, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/Timer.zig (703 lines)
//   confidence: medium
//   todos:      11
//   notes:      Mutex API is lock()/unlock() placeholder; @fieldParentPtr→offset_of! for VirtualMachine.timer; jsc.host_fn.wrapN exports need proc-macro; u25 epoch masked into u32, u31 widened to u32; string-encoding inline-else expanded via macro_rules.
// ──────────────────────────────────────────────────────────────────────────
