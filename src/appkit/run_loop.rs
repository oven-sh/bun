//! Sharing the main thread between Bun's kqueue loop and AppKit.
//!
//! Bun's event loop stays the outer loop. While AppKit is active the loop's
//! idle wait happens inside `-[NSApplication nextEventMatchingMask:…]`
//! instead of `kevent64`: the kqueue descriptor is registered as a
//! `CFFileDescriptor` run-loop source, so the wait ends as soon as the kqueue
//! has something (I/O, timers folded into the timeout, cross-thread wakeups),
//! a UI event arrives, or the timeout passes. UI events are dispatched right
//! there with `sendEvent:`; then control returns to the loop, which harvests
//! the kqueue without blocking. See `park_cb` in usockets' `epoll_kqueue.c`.
//! The loop sweeps this thread's allocator inline before calling it, and hands
//! it to the scavenger only after it returns, because dispatching UI events
//! (and Apple Events inside the wait) runs JavaScript.
//!
//! This is one of the two modules in the crate with `unsafe` (the CF calls
//! and the C callbacks); the AppKit side uses the bindings.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;

use bun_uws_sys::Loop;

use crate::geometry::Point;
use crate::objc::appkit::{NSApplication, NSEvent};
use crate::objc::foundation::{NSDate, NSString};
use crate::objc::{AutoreleasePool, Bool, CFFileDescriptorContext, Object, rt};

/// `NSEventTypeApplicationDefined`.
const APPLICATION_DEFINED: usize = 15;
/// `NSEventMaskAny`.
const ANY_EVENT: u64 = u64::MAX;
/// Marks the application-defined event we post to end a wait.
const WAKE_SUBTYPE: i16 = 0x4275;
/// `kCFFileDescriptorReadCallBack`.
const READ_CALLBACK: usize = 1;
/// How often a busy (non-idle) tick still drains UI events.
const BUSY_DRAIN_INTERVAL_NS: u64 = 1_000_000;

struct Park {
    app: NSApplication,
    /// `CFFileDescriptorRef` over the loop's kqueue. Lives, with its run-loop
    /// source, for the rest of the process.
    fd_source: *mut c_void,
    default_mode: NSString,
    distant_past: NSDate,
    distant_future: NSDate,
    last_drain_ns: Cell<u64>,
    /// Set by the CF callback so `pump` can tell its own wake event from a
    /// stale one left in the queue.
    woke: Cell<bool>,
}

thread_local! {
    static PARK: Cell<*const Park> = const { Cell::new(ptr::null()) };
}

fn park() -> Option<&'static Park> {
    let p = PARK.get();
    // SAFETY: set once in `install` to a leaked allocation.
    (!p.is_null()).then(|| unsafe { &*p })
}

/// Routes the idle wait of `loop_` (this thread's loop) through AppKit from
/// now on. Idempotent.
pub(crate) fn install(loop_: &mut Loop, app: &NSApplication) {
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
        // invalidate (Bun owns it), and both CF objects are intentionally never
        // released.
        let fd_source = unsafe {
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
            (cf.CFRunLoopAddSource)((cf.CFRunLoopGetMain)(), source, common_modes.as_obj());
            fd_source
        };
        let park = Box::new(Park {
            app: app.clone(),
            fd_source,
            default_mode: crate::objc::foundation::default_run_loop_mode(),
            distant_past: NSDate::distant_past(),
            distant_future: NSDate::distant_future(),
            last_drain_ns: Cell::new(0),
            woke: Cell::new(false),
        });
        PARK.set(Box::leak(park));
    }
    loop_.internal_loop_data.park_cb = Some(park_cb);
}

/// Posts the application-defined event that makes a blocked
/// `nextEventMatchingMask:` return. Safe to call when nothing is waiting.
pub(crate) fn wake() {
    let Some(park) = park() else { return };
    park.woke.set(true);
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

unsafe extern "C" fn on_kqueue_readable(_f: *mut c_void, _types: usize, _info: *mut c_void) {
    // Never runs JS: it only ends the wait. If AppKit is inside a tracking
    // loop the event sits in the queue until that ends.
    wake();
}

unsafe extern "C" fn park_cb(_loop: *mut Loop, timeout: *const bun_core::Timespec) {
    let Some(park) = park() else { return };
    // SAFETY: timeout is null (forever) or points at the caller's timespec.
    let timeout = unsafe { timeout.as_ref() };
    match timeout {
        Some(t) if t.sec == 0 && t.nsec == 0 => drain(park),
        _ => wait(park, timeout),
    }
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
/// readiness; dispatches any UI events that arrived.
fn wait(park: &Park, timeout: Option<&bun_core::Timespec>) {
    let _pool = AutoreleasePool::new();
    // The kqueue was harvested after the previous park returned, so arming
    // here preserves harvest-then-arm (arming while still readable can lose
    // the edge).
    park.woke.set(false);
    // SAFETY: fd_source is the live CFFileDescriptor created in `install`.
    unsafe { (rt().cf.CFFileDescriptorEnableCallBacks)(park.fd_source, READ_CALLBACK) };
    let deadline = timeout.map(|t| NSDate::seconds_from_now(t.sec as f64 + t.nsec as f64 / 1e9));
    pump(park, deadline.as_ref().unwrap_or(&park.distant_future));
    park.last_drain_ns.set(monotonic_ns());
}

/// Runs `nextEventMatchingMask:` — until `deadline` for the first event and
/// without blocking for the rest — sending each event to the application.
/// Stops early at our wake event.
fn pump(park: &Park, deadline: &NSDate) {
    let mut deadline = deadline;
    let mut dispatched = false;
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
        dispatched = true;
    }
    if dispatched {
        park.app.update_windows();
    }
}

fn monotonic_ns() -> u64 {
    thread_local! { static START: std::time::Instant = std::time::Instant::now(); }
    START.with(|s| s.elapsed().as_nanos() as u64)
}
