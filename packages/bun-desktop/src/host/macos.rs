use std::cell::Cell;
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicPtr, Ordering};
use std::time::Duration;

use block2::RcBlock;
use core_foundation_sys::base::{CFOptionFlags, kCFAllocatorDefault};
use core_foundation_sys::date::CFAbsoluteTimeGetCurrent;
use core_foundation_sys::filedescriptor::{
    CFFileDescriptorCallBack, CFFileDescriptorCreate, CFFileDescriptorCreateRunLoopSource,
    CFFileDescriptorEnableCallBacks, CFFileDescriptorRef, kCFFileDescriptorReadCallBack,
};
use core_foundation_sys::runloop::{
    CFRunLoopActivity, CFRunLoopAddObserver, CFRunLoopAddSource, CFRunLoopAddTimer,
    CFRunLoopGetMain, CFRunLoopObserverCreate, CFRunLoopObserverRef, CFRunLoopRunInMode,
    CFRunLoopSourceContext, CFRunLoopSourceCreate, CFRunLoopSourceSignal, CFRunLoopTimerCreate,
    CFRunLoopTimerRef, CFRunLoopTimerSetNextFireDate, CFRunLoopWakeUp, kCFRunLoopBeforeWaiting,
    kCFRunLoopCommonModes, kCFRunLoopDefaultMode,
};
use gpui::Platform;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
use objc2_foundation::{NSDate, NSDefaultRunLoopMode, NSPoint};

pub use super::unix::wake;
use super::{thread, unix};
use crate::{bridge, native, window};

pub const IS_REENTRANT: bool = true;
pub const RUNS_ON_ANY_THREAD: bool = false;

static JOBS: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

pub fn wake_ui() {
    // SAFETY: the source of `init`. Both functions may be called on any thread.
    unsafe {
        CFRunLoopSourceSignal(JOBS.load(Ordering::Relaxed).cast());
        CFRunLoopWakeUp(CFRunLoopGetMain());
    }
}

extern "C" fn has_jobs(_: *const c_void) {
    turn();
}

pub fn init() {
    unix::WAKE.open();
    let mut context = CFRunLoopSourceContext {
        version: 0,
        info: null_mut(),
        retain: None,
        release: None,
        copyDescription: None,
        equal: None,
        hash: None,
        schedule: None,
        cancel: None,
        perform: has_jobs,
    };
    // SAFETY: the context is copied, and the source is never released.
    unsafe {
        let source = CFRunLoopSourceCreate(kCFAllocatorDefault, 0, &raw mut context);
        CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
        JOBS.store(source.cast(), Ordering::Relaxed);
    }
}

/// From whichever run loop AppKit runs, once it has the thread to itself.
fn turn() {
    const RETRY: Duration = Duration::from_millis(1);
    if !IS_RUNNING.get() {
        return;
    }
    if super::running().is_none_or(|running| running.handle.is_borrowed()) {
        return arm(None, Some(RETRY));
    }
    crate::guard("fatal", (), || {
        autoreleasepool(|_| {
            super::turn();
            window::layers::flush();
        })
    });
    arm(None, super::time_until_next_turn());
}

fn run(is_launched: bool, timeout: Option<Duration>) {
    if is_launched {
        IS_RUNNING.set(true);
        arm(None, Some(Duration::ZERO));
        // SAFETY: on the main thread.
        return unsafe { msg_send![application(), run] };
    }
    let seconds = timeout.map_or(NEVER, |timeout| timeout.as_secs_f64());
    // SAFETY: as above.
    autoreleasepool(|_| unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, seconds, 1) });
}

/// Outside of menus and drags, and of everything that could not run again while `function` runs a loop of its own.
pub fn run_when_idle(function: impl FnOnce() + 'static) {
    let function = Cell::new(Some(function));
    let block = RcBlock::new(move || {
        let was_in_next_event = IS_IN_NEXT_EVENT.replace(false);
        let run = || {
            function
                .take()
                .into_iter()
                .try_for_each(crate::app::catch_exception)
        };
        crate::guard("error", (), || autoreleasepool(|_| bridge::report(run())));
        IS_IN_NEXT_EVENT.set(was_in_next_event);
    });
    // SAFETY: the block is copied, and runs on this thread.
    unsafe {
        CFRunLoopPerformBlock(
            CFRunLoopGetMain().cast(),
            kCFRunLoopDefaultMode.cast(),
            RcBlock::as_ptr(&block).cast(),
        );
        CFRunLoopWakeUp(CFRunLoopGetMain());
    }
}

unsafe extern "C" {
    fn CFRunLoopPerformBlock(run_loop: *mut c_void, mode: *const c_void, block: *const c_void);
}

/// For what runs a loop of its own without having returned an event.
pub fn leave_next_event() {
    IS_IN_NEXT_EVENT.set(false);
}

/// Timers ignore dates that are much later.
const NEVER: f64 = 4e9;

thread_local! {
    static SOURCE: Cell<CFFileDescriptorRef> = const { Cell::new(null_mut()) };
    static TIMER: Cell<CFRunLoopTimerRef> = const { Cell::new(null_mut()) };
    static FIRES_AT: Cell<f64> = const { Cell::new(NEVER) };
    static IS_RUNNING: Cell<bool> = const { Cell::new(false) };
    static IS_READY: Cell<bool> = const { Cell::new(false) };
    /// `wait` itself is what runs the run loop, and not a menu, a drag or a resize.
    static IS_IN_NEXT_EVENT: Cell<bool> = const { Cell::new(false) };
}

fn application() -> *mut AnyObject {
    // SAFETY: a class method without arguments, on the main thread.
    unsafe { msg_send![class!(GPUIApplication), sharedApplication] }
}

fn watch(fd: i32, callback: CFFileDescriptorCallBack) -> CFFileDescriptorRef {
    // SAFETY: the descriptor stays open, and what is created here is never released.
    unsafe {
        let descriptor = CFFileDescriptorCreate(kCFAllocatorDefault, fd, 0, callback, null());
        let source = CFFileDescriptorCreateRunLoopSource(kCFAllocatorDefault, descriptor, 0);
        CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
        descriptor
    }
}

/// For one call.
fn enable(descriptor: CFFileDescriptorRef) {
    // SAFETY: it came from `watch`.
    unsafe { CFFileDescriptorEnableCallBacks(descriptor, kCFFileDescriptorReadCallBack) };
}

extern "C" fn source_is_ready(_: CFFileDescriptorRef, _: CFOptionFlags, _: *mut c_void) {
    IS_READY.set(true);
}

extern "C" fn was_woken(descriptor: CFFileDescriptorRef, _: CFOptionFlags, _: *mut c_void) {
    unix::WAKE.clear();
    enable(descriptor);
}

extern "C" fn time_is_up(_: CFRunLoopTimerRef, _: *mut c_void) {
    IS_READY.set(true);
    FIRES_AT.set(NEVER);
    turn();
}

extern "C" fn before_waiting(_: CFRunLoopObserverRef, _: CFRunLoopActivity, _: *mut c_void) {
    if thread::exists() {
        return turn();
    }
    if !IS_READY.get() && !super::has_work() {
        return window::layers::flush();
    }
    if !IS_IN_NEXT_EVENT.get() {
        if super::can_tick() && (IS_READY.take() || bridge::has_events()) {
            super::tick();
        }
        return window::layers::flush();
    }
    post_empty_event();
}

/// Only an event makes `nextEventMatchingMask:` return.
pub fn post_empty_event() {
    let event = NSEvent::otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2(
        NSEventType::ApplicationDefined,
        NSPoint::ZERO,
        NSEventModifierFlags::empty(),
        0.,
        0,
        None,
        0,
        0,
        0,
    );
    if let Some(event) = event {
        // SAFETY: an `NSEvent` and a `BOOL`.
        unsafe { msg_send![application(), postEvent: &*event, atStart: true] }
    }
}

pub fn started(_: &dyn Platform) {
    if !thread::exists() {
        enable(watch(unix::WAKE.fd(), was_woken));
    }
    // SAFETY: neither callback has a context, and neither object is released.
    unsafe {
        let timer = CFRunLoopTimerCreate(
            kCFAllocatorDefault,
            NEVER,
            NEVER,
            0,
            0,
            time_is_up,
            null_mut(),
        );
        CFRunLoopAddTimer(CFRunLoopGetMain(), timer, kCFRunLoopCommonModes);
        TIMER.set(timer);
        let observer = CFRunLoopObserverCreate(
            kCFAllocatorDefault,
            kCFRunLoopBeforeWaiting,
            1,
            0,
            before_waiting,
            null_mut(),
        );
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
    }
}

/// Makes any run loop that AppKit runs notice `source` and the time.
pub fn arm(source: Option<isize>, timeout: Option<Duration>) {
    if let Some(source) = source {
        if SOURCE.get().is_null() {
            SOURCE.set(watch(source as i32, source_is_ready));
        }
        enable(SOURCE.get());
    }
    // SAFETY: the timer of `started`, which precedes every caller.
    unsafe {
        let date = timeout.map_or(NEVER, |timeout| {
            CFAbsoluteTimeGetCurrent() + timeout.as_secs_f64()
        });
        if (date - FIRES_AT.get()).abs() > 1e-4 {
            FIRES_AT.set(date);
            CFRunLoopTimerSetNextFireDate(TIMER.get(), date);
        }
    }
}

pub fn wait(
    platform: Option<&dyn Platform>,
    source: Option<isize>,
    timeout: &mut dyn FnMut() -> Option<Duration>,
) -> bool {
    const MAX_EVENTS: usize = 64;
    if thread::exists() {
        run(platform.is_some() && native::is_launched(), timeout());
        return false;
    }
    window::layers::flush();
    if platform.is_none() {
        return unix::poll(&unix::WAKE, source, timeout());
    }
    let first_timeout = timeout();
    arm(source, first_timeout);
    let was_in_next_event = IS_IN_NEXT_EVENT.get();
    let mut may_block = first_timeout != Some(Duration::ZERO);
    for _ in 0..MAX_EVENTS {
        let had_event = autoreleasepool(|_| {
            let until = if may_block {
                NSDate::distantFuture()
            } else {
                NSDate::distantPast()
            };
            IS_IN_NEXT_EVENT.set(true);
            // SAFETY: what `-[NSApplication run]` does.
            unsafe {
                let event: Option<Retained<NSEvent>> = msg_send![
                    application(),
                    nextEventMatchingMask: usize::MAX,
                    untilDate: &*until,
                    inMode: NSDefaultRunLoopMode,
                    dequeue: true
                ];
                IS_IN_NEXT_EVENT.set(false);
                if let Some(event) = &event {
                    let () = msg_send![application(), sendEvent: &**event];
                    let () = msg_send![application(), updateWindows];
                }
                event.is_some()
            }
        });
        may_block = false;
        if !had_event {
            break;
        }
    }
    IS_IN_NEXT_EVENT.set(was_in_next_event);
    IS_READY.take()
}

/// On the thread that runs JavaScript, if that is not the UI's.
pub fn wait_for_events(source: Option<isize>, timeout: Option<Duration>) {
    unix::poll(&unix::WAKE, source, timeout);
}
