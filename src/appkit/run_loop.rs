//! Sharing the main thread between Bun's kqueue loop and AppKit.
//!
//! Bun's event loop stays the outer loop. While AppKit is active the loop's
//! idle wait happens inside `-[NSApplication nextEventMatchingMask:…]`
//! instead of `kevent64`: the kqueue descriptor is registered as a
//! `CFFileDescriptor` run-loop source, so the wait ends as soon as the kqueue
//! has something (I/O, cross-thread wakeups), a UI event arrives, or a
//! `CFRunLoopTimer` armed for Bun's next timer fires. UI events are
//! dispatched right there with `sendEvent:`; then control returns to the
//! loop, which harvests the kqueue without blocking. See `park_cb` in
//! usockets' `epoll_kqueue.c`.
//!
//! JavaScript also runs *inside* that wait, from sources that are not
//! `NSEvent`s (an `MTKView` display timer, Apple Events, the main dispatch
//! queue). A run-loop observer asks the embedder before every sleep when Bun
//! next needs a turn ([`LoopHooks::next_due`]) and re-arms the timer, so a
//! `setTimeout` armed there still ends the wait on time. While AppKit runs a
//! tracking loop of its own inside `sendEvent:` (an open menu, a live resize)
//! the wake event just queues; Bun's timers and I/O resume when the gesture
//! ends. Bun's loop is never re-entered from in here.
//!
//! The loop sweeps this thread's allocator inline before calling `park_cb`,
//! and hands it to the scavenger only after it returns, because all of the
//! above runs JavaScript.
//!
//! This is one of the two modules in the crate with `unsafe` (the CF calls
//! and the C callbacks); the AppKit side uses the bindings.

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr;

use bun_core::Timespec;
use bun_uws_sys::Loop;

use crate::app::LoopHooks;
use crate::error::Result;
use crate::geometry::Point;
use crate::objc::appkit::{NSApplication, NSEvent};
use crate::objc::foundation::{NSDate, NSString};
use crate::objc::{
    AutoreleasePool, Bool, CFFileDescriptorContext, CFRunLoopTimerContext, Object, rt,
};

/// `NSEventTypeApplicationDefined`.
const APPLICATION_DEFINED: usize = 15;
/// `NSEventMaskAny`.
const ANY_EVENT: u64 = u64::MAX;
/// Marks the application-defined event we post to end a wait.
const WAKE_SUBTYPE: i16 = 0x4275;
/// `kCFFileDescriptorReadCallBack`.
const READ_CALLBACK: usize = 1;
/// `kCFRunLoopBeforeWaiting`.
const BEFORE_WAITING: usize = 1 << 5;
/// Past CoreAnimation's commit observer (2 000 000), so JavaScript run by a
/// display callback in the same pass is seen before the loop sleeps.
const OBSERVER_ORDER: isize = 3_000_000;
/// How often a busy (non-idle) tick still drains UI events.
const BUSY_DRAIN_INTERVAL_NS: u64 = 1_000_000;
/// UI events dispatched per park before Bun's loop gets a turn; the rest stay
/// queued and end the next wait at once.
const EVENTS_PER_PARK: u32 = 16;
/// A `CFAbsoluteTime` further off than any deadline (CF clamps it).
const NEVER: f64 = 1.0e12;
/// Seconds; see [`Park::arm_within`].
const REARM_SLACK: f64 = 0.000_25;

struct Park {
    app: NSApplication,
    /// The loop whose idle wait comes through here; the VM's, so it outlives us.
    loop_: *const Loop,
    kqueue_fd: i32,
    /// `CFFileDescriptorRef` over the loop's kqueue. Lives, with its run-loop
    /// source, for the rest of the process.
    fd_source: *mut c_void,
    /// Repeating `CFRunLoopTimerRef` in the common modes, re-armed for each
    /// wait's deadline; mach-time based, so immune to wall-clock steps.
    timer: *mut c_void,
    hooks: LoopHooks,
    default_mode: NSString,
    distant_past: NSDate,
    distant_future: NSDate,
    last_drain_ns: Cell<u64>,
    /// Set by `wake` so `pump` can tell its own wake event from a stale one
    /// left in the queue.
    woke: Cell<bool>,
    /// Inside `pump`: AppKit may be running JavaScript below us.
    in_pump: Cell<bool>,
    /// What `timer` is armed for, as a `CFAbsoluteTime`; `NEVER` when idle.
    armed: Cell<f64>,
}

thread_local! {
    static PARK: Cell<*const Park> = const { Cell::new(ptr::null()) };
    /// Drained and replaced at the top of every outermost park, so whatever
    /// AppKit autoreleases while Bun runs timers and I/O callbacks between
    /// two parks is freed at the next one: the pool `-[NSApplication run]`
    /// wraps around each event. Only swapped while it is the innermost pool
    /// this crate holds (see `park_cb`), so the swap never pops out of order.
    /// `ManuallyDrop` because thread-local destructors run inside `exit()`,
    /// possibly under live `_pool` locals; the process is going away then and
    /// nothing needs popping.
    static TICK_POOL: Cell<Option<ManuallyDrop<AutoreleasePool>>> = const { Cell::new(None) };
}

fn park() -> Option<&'static Park> {
    let p = PARK.get();
    // SAFETY: set once in `install` to a leaked allocation.
    (!p.is_null()).then(|| unsafe { &*p })
}

/// Routes the idle wait of `loop_` (this thread's loop) through AppKit from
/// now on. Idempotent.
pub(crate) fn install(loop_: &mut Loop, app: &NSApplication, hooks: LoopHooks) -> Result<()> {
    if park().is_none() {
        let cf = &rt().cf;
        let common_modes = crate::objc::foundation::common_run_loop_modes();
        let kqueue_fd = loop_.fd;
        let context = CFFileDescriptorContext {
            version: 0,
            info: ptr::null_mut(),
            retain: ptr::null(),
            release: ptr::null(),
            copy_description: ptr::null(),
        };
        // SAFETY: CF calls with valid arguments. The descriptor is not closed on
        // invalidate (Bun owns it), and the CF objects are intentionally never
        // released.
        let (fd_source, timer) = unsafe {
            let main = (cf.CFRunLoopGetMain)();
            let fd_source = (cf.CFFileDescriptorCreate)(
                ptr::null(),
                kqueue_fd,
                Bool::NO,
                on_kqueue_readable,
                &raw const context,
            );
            assert!(!fd_source.is_null(), "CFFileDescriptorCreate");
            let source = (cf.CFFileDescriptorCreateRunLoopSource)(ptr::null(), fd_source, 0);
            assert!(!source.is_null(), "CFFileDescriptorCreateRunLoopSource");
            (cf.CFRunLoopAddSource)(main, source, common_modes.as_obj());
            let timer = (cf.CFRunLoopTimerCreate)(
                ptr::null(),
                NEVER,
                NEVER,
                0,
                0,
                on_deadline,
                ptr::null(),
            );
            assert!(!timer.is_null(), "CFRunLoopTimerCreate");
            (cf.CFRunLoopAddTimer)(main, timer, common_modes.as_obj());
            let observer = (cf.CFRunLoopObserverCreate)(
                ptr::null(),
                BEFORE_WAITING,
                Bool::YES,
                OBSERVER_ORDER,
                before_waiting,
                ptr::null(),
            );
            assert!(!observer.is_null(), "CFRunLoopObserverCreate");
            (cf.CFRunLoopAddObserver)(main, observer, common_modes.as_obj());
            (fd_source, timer)
        };
        let park = Box::new(Park {
            app: app.clone(),
            loop_: ptr::from_mut(loop_),
            kqueue_fd,
            fd_source,
            timer,
            hooks,
            default_mode: crate::objc::foundation::default_run_loop_mode(),
            distant_past: NSDate::distant_past(),
            distant_future: NSDate::distant_future(),
            last_drain_ns: Cell::new(0),
            woke: Cell::new(false),
            in_pump: Cell::new(false),
            armed: Cell::new(NEVER),
        });
        PARK.set(Box::leak(park));
    }
    loop_.internal_loop_data.park_cb = Some(park_cb);
    Ok(())
}

/// Posts the application-defined event that makes a blocked
/// `nextEventMatchingMask:` return; once per wait, however many sources ask.
/// Safe to call when nothing is waiting.
pub(crate) fn wake() {
    let Some(park) = park() else { return };
    if park.woke.replace(true) {
        return;
    }
    if let Some(event) = NSEvent::other_event(
        APPLICATION_DEFINED,
        Point::default(),
        0,
        0.0,
        0,
        None,
        WAKE_SUBTYPE,
        0,
        0,
    ) {
        park.app.post_event(&event, true);
    }
}

impl Park {
    fn tick_depth(&self) -> i32 {
        // SAFETY: `loop_` is the VM's loop, alive for the rest of the process.
        unsafe { (*self.loop_).internal_loop_data.tick_depth }
    }

    fn now(&self) -> f64 {
        // SAFETY: no preconditions.
        unsafe { (rt().cf.CFAbsoluteTimeGetCurrent)() }
    }

    /// Arms the deadline timer for `at` (`NEVER` disarms). CF converts the
    /// date to mach time here, so a later clock step does not move it.
    fn arm(&self, at: f64) {
        if self.armed.replace(at) != at {
            // SAFETY: `timer` is the live CFRunLoopTimer created in `install`.
            unsafe { (rt().cf.CFRunLoopTimerSetNextFireDate)(self.timer, at) };
        }
    }

    /// Brings the deadline in to `timeout` from now if that is sooner (by more
    /// than the jitter of reading two clocks, so an unchanged deadline seen
    /// again from `before_waiting` costs nothing).
    fn arm_within(&self, timeout: &Timespec) {
        let at = self.now() + timeout.sec as f64 + timeout.nsec as f64 / 1e9;
        if at + REARM_SLACK < self.armed.get() {
            self.arm(at);
        }
    }

    fn enable_fd_callback(&self) {
        // SAFETY: `fd_source` is the live CFFileDescriptor created in `install`.
        unsafe { (rt().cf.CFFileDescriptorEnableCallBacks)(self.fd_source, READ_CALLBACK) };
    }
}

/// Ends the wait; inside a tracking loop the wake sits in the queue until the
/// gesture ends. Before the first wait it leaves a stale wake that `pump` skips.
unsafe extern "C" fn on_kqueue_readable(_f: *mut c_void, _types: usize, _info: *mut c_void) {
    wake();
}

unsafe extern "C" fn on_deadline(_timer: *mut c_void, _info: *mut c_void) {
    if let Some(park) = park() {
        park.armed.set(NEVER);
        if park.in_pump.get() {
            wake();
        }
    }
}

/// Runs before the run loop sleeps, in every mode. JavaScript that ran since
/// the wait began (a display-timer `onFrame`, an Apple Event) may have queued
/// a task, an immediate or an earlier timer than the one the wait was armed
/// for; ask, and bring the deadline in to match.
unsafe extern "C" fn before_waiting(_o: *mut c_void, _activity: usize, _info: *mut c_void) {
    let Some(park) = park() else { return };
    // A wake already queued ends the wait as soon as AppKit dequeues it;
    // re-arming for "now" until then would only spin a tracking loop.
    if !park.in_pump.get() || park.woke.get() {
        return;
    }
    if let Some(due) = (park.hooks.next_due)() {
        park.arm_within(&due);
    }
}

unsafe extern "C" fn park_cb(_loop: *mut Loop, timeout: *const Timespec) {
    let Some(park) = park() else { return };
    // SAFETY: timeout is null (forever) or points at the caller's timespec.
    let timeout = unsafe { timeout.as_ref() };
    let zero = timeout.is_some_and(|t| t.sec == 0 && t.nsec == 0);
    if park.in_pump.get() {
        // JavaScript that AppKit is running (a UI handler, `onFrame`, an Apple
        // Event) is waiting synchronously. Pumping again here would dispatch
        // events re-entrantly and could swallow the outer wait's wake, so wait
        // on the kqueue alone; the UI is frozen for a synchronous wait either way.
        if !zero {
            block_on_kqueue(park.kqueue_fd, timeout);
        }
        return;
    }
    (park.hooks.exit_if_requested)();
    // At the outermost tick, with the tick pool the innermost one this crate
    // holds (or none held at all), the previous tick's pool can be popped and
    // a fresh one left in place for everything up to the next park. Anything
    // else gets a scoped pool instead.
    let tick_pool = TICK_POOL.take();
    let swappable = match &tick_pool {
        Some(pool) => pool.is_innermost(),
        None => AutoreleasePool::live_count() == 0,
    };
    let _scoped = if swappable && park.tick_depth() == 1 && (park.hooks.outermost)() {
        drop(tick_pool.map(ManuallyDrop::into_inner));
        TICK_POOL.set(Some(ManuallyDrop::new(AutoreleasePool::new())));
        None
    } else {
        TICK_POOL.set(tick_pool);
        Some(AutoreleasePool::new())
    };
    if zero {
        drain(park);
    } else {
        wait(park, timeout);
    }
}

/// Runs `f` on the main run loop after `seconds`, from inside whatever is
/// running it then (our wait, or a tracking loop), the way an `MTKView`
/// display timer or an Apple Event handler runs. For tests of that path.
pub(crate) fn after(seconds: f64, f: Box<dyn FnOnce()>) {
    let Some(park) = park() else { return };
    let cf = &rt().cf;
    let info: *mut Box<dyn FnOnce()> = Box::into_raw(Box::new(f));
    let context = CFRunLoopTimerContext {
        version: 0,
        info: info.cast(),
        retain: ptr::null(),
        release: ptr::null(),
        copy_description: ptr::null(),
    };
    // SAFETY: a one-shot timer (interval 0) whose `info` is the leaked box;
    // `on_after` reclaims it exactly once and the run loop releases the timer
    // after it fires. CF copies the context struct.
    unsafe {
        let timer = (cf.CFRunLoopTimerCreate)(
            ptr::null(),
            park.now() + seconds,
            0.0,
            0,
            0,
            on_after,
            &raw const context,
        );
        assert!(!timer.is_null(), "CFRunLoopTimerCreate");
        (cf.CFRunLoopAddTimer)((cf.CFRunLoopGetMain)(), timer, park.default_mode.as_obj());
        (cf.CFRelease)(timer.cast_const());
    }
}

unsafe extern "C" fn on_after(_timer: *mut c_void, info: *mut c_void) {
    // SAFETY: `info` is the box leaked in `after`; a one-shot timer fires once.
    let f = unsafe { Box::from_raw(info.cast::<Box<dyn FnOnce()>>()) };
    let _pool = AutoreleasePool::new();
    f();
}

/// Blocks until the kqueue has something or `timeout` (None = forever)
/// passes, without dequeuing anything.
fn block_on_kqueue(fd: i32, timeout: Option<&Timespec>) {
    let ms = timeout.map_or(-1, |t| {
        t.sec
            .saturating_mul(1000)
            .saturating_add((t.nsec + 999_999) / 1_000_000)
            .clamp(0, i64::from(i32::MAX)) as i32
    });
    let mut pfd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    // SAFETY: one valid pollfd. Readiness, timeout and EINTR all just return;
    // the caller harvests the kqueue whichever it was.
    unsafe { libc::poll(&raw mut pfd, 1, ms) };
}

/// Dispatches whatever UI events are already queued without blocking.
pub(crate) fn poll() {
    let Some(park) = park() else { return };
    let _pool = AutoreleasePool::new();
    pump(park, &park.distant_past);
    park.last_drain_ns.set(monotonic_ns());
}

/// Non-blocking: dispatch whatever UI events are already queued. Rate limited
/// so a loop that never idles pays ~2µs per millisecond rather than per tick.
fn drain(park: &Park) {
    if monotonic_ns().wrapping_sub(park.last_drain_ns.get()) >= BUSY_DRAIN_INTERVAL_NS {
        poll();
    }
}

/// Blocks in AppKit until `timeout` (None = forever), a UI event, or kqueue
/// readiness; dispatches UI events that arrived.
fn wait(park: &Park, timeout: Option<&Timespec>) {
    // The kqueue was harvested after the previous park returned, so arming
    // here preserves harvest-then-arm (arming while still readable can lose
    // the edge).
    park.woke.set(false);
    park.enable_fd_callback();
    park.arm(NEVER);
    if let Some(timeout) = timeout {
        park.arm_within(timeout);
    }
    pump(park, &park.distant_future);
    park.arm(NEVER);
    park.last_drain_ns.set(monotonic_ns());
}

/// Runs `nextEventMatchingMask:` — until `deadline` for the first event and
/// without blocking for up to [`EVENTS_PER_PARK`] more — sending each event to
/// the application. Stops early at our wake event.
fn pump(park: &Park, deadline: &NSDate) {
    let was_in_pump = park.in_pump.replace(true);
    let mut deadline = deadline;
    let mut dispatched = 0u32;
    while let Some(event) = park
        .app
        .next_event(ANY_EVENT, Some(deadline), &park.default_mode, true)
    {
        deadline = &park.distant_past;
        if event.kind() == APPLICATION_DEFINED && event.subtype() == WAKE_SUBTYPE {
            if park.woke.replace(false) {
                break;
            }
            // A wake left over from an earlier park.
            continue;
        }
        park.app.send_event(&event);
        dispatched += 1;
        if dispatched == EVENTS_PER_PARK {
            break;
        }
    }
    if dispatched > 0 {
        park.app.update_windows();
    }
    park.in_pump.set(was_in_pump);
}

fn monotonic_ns() -> u64 {
    thread_local! { static START: std::time::Instant = std::time::Instant::now(); }
    START.with(|s| s.elapsed().as_nanos() as u64)
}
