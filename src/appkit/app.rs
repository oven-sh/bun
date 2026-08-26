//! The shared `NSApplication`: start-up, the launch handshake with the
//! script's application delegate, and App Nap. Everything else the
//! application does (activation, the Dock badge, termination) is a message
//! the script sends it through the bridge.

use core::cell::{Cell, RefCell};

use bun_core::Timespec;
use bun_uws_sys::Loop;

use crate::objc::appkit::{NSApplication, NSRunningApplication, NSScreen};
use crate::objc::foundation::{NSObject, NSProcessInfo, NSString};
use crate::objc::{self, AutoreleasePool};
use crate::{DynObject, Error, Result, run_loop};

/// `NSActivityUserInitiatedAllowingIdleSystemSleep`: not App Nap eligible, so
/// timers and I/O keep their latency with no window on screen; the display
/// and the system may still sleep.
const ACTIVITY_OPTIONS: u64 = 0x00FF_FFFF & !(1 << 20);

/// What the embedding event loop hands over so that its timers stay on time
/// while AppKit waits for events. All are called on the main thread and must
/// not block.
#[derive(Clone, Copy)]
pub struct LoopHooks {
    /// How long until the embedder next needs a turn: zero when it has queued
    /// work, otherwise the time to its earliest timer, or `None`. Called from
    /// inside AppKit before the run loop sleeps; must not run JavaScript.
    pub next_due: fn() -> Option<Timespec>,
    /// Whether the loop is being driven from the top of the thread, with no
    /// JavaScript (and so no foreign code that might hold an autorelease pool)
    /// on the stack above it.
    pub outermost: fn() -> bool,
    /// Called at the top of every idle wait, with no AppKit frame on the
    /// stack: the place to end the process after an accepted quit.
    pub exit_if_requested: fn(),
    /// An Objective-C exception raised while AppKit waited for or dispatched
    /// an event (an [`Error::Exception`]), for the embedder to surface the
    /// way it surfaces one from a send; the loop carries on.
    pub report: fn(Error),
}

/// The process-wide application object. Lives for the rest of the process
/// once [`App::start`] succeeds. Its delegate and menu bar are the script's,
/// built through the bridge.
pub struct App {
    nsapp: NSApplication,
    /// Inside our own `-[NSApplication run]` during start-up.
    launching: Cell<bool>,
    /// The `NSProcessInfo` activity that keeps App Nap off while the
    /// embedder asks to stay responsive; see [`App::set_responsive`].
    activity: RefCell<Option<NSObject>>,
}

thread_local! {
    static APP: Cell<Option<&'static App>> = const { Cell::new(None) };
}

impl App {
    /// Starts AppKit on this thread (once) and returns the application.
    ///
    /// `loop_` is this thread's usockets loop; its idle wait is routed through
    /// AppKit from now on, with `hooks` keeping the embedder's side of it
    /// running. `delegate` becomes the application delegate. The caller must
    /// have arranged for [`App::launched`] to be called when
    /// `NSApplicationDidFinishLaunchingNotification` is posted, which on a
    /// machine with a display happens before this returns. `delegate` is
    /// `None` only where the caller could not make one, off the main thread,
    /// which is refused first. `hooks` only applies on the first call; a
    /// later call installs the new delegate on the running application. The
    /// activation policy is the caller's to set beforehand; nothing is
    /// activated.
    pub fn start(
        loop_: &mut Loop,
        hooks: LoopHooks,
        delegate: Option<&DynObject>,
    ) -> Result<&'static App> {
        objc::main_thread()?;
        let delegate = delegate.ok_or(Error::WrongThread)?;
        if let Some(app) = App::get() {
            let _pool = AutoreleasePool::new();
            delegate.with(|d| app.nsapp.set_delegate(Some(d)))?;
            return Ok(app);
        }
        objc::load()?;
        let _pool = AutoreleasePool::new();
        // No up-front WindowServer check: sandboxed and headless sessions
        // report no displays yet still run AppKit off screen, which is what
        // tests need. `has_display` tells callers which case they are in.
        let nsapp = NSApplication::shared();
        // A native addon (SDL, GLFW, a hand-rolled loop) may have launched the
        // shared application already; then the launch below is skipped and its
        // delegate and main menu are replaced.
        let launched =
            nsapp.is_running() || NSRunningApplication::current().is_finished_launching();
        run_loop::install(loop_, &nsapp, hooks)?;
        delegate.with(|d| nsapp.set_delegate(Some(d)))?;

        let app: &'static App = Box::leak(Box::new(App {
            nsapp,
            launching: Cell::new(false),
            activity: RefCell::new(None),
        }));
        APP.set(Some(app));

        if launched {
            run_loop::poll();
        } else if has_display() {
            // `-run` performs the launch sequence an unbundled process
            // otherwise never gets (menu bar activation, `isRunning`).
            // `launched`, on the did-finish-launching notification, stops
            // it so it returns straight away.
            app.launching.set(true);
            app.nsapp.run();
            app.launching.set(false);
        } else {
            // Without a WindowServer connection (sandbox, daemon) AppKit never
            // delivers `applicationDidFinishLaunching:`, so `-run` would block
            // for ever; the synchronous half of the launch is all there is.
            app.nsapp.finish_launching();
            // The first `nextEventMatchingMask:` does the rest of the launch
            // work (tens of ms headless) before it starts timing its wait, so
            // take that hit now rather than in the first timer's park.
            run_loop::poll();
        }
        Ok(app)
    }

    /// The application if [`App::start`] has run on this thread.
    #[inline]
    pub fn get() -> Option<&'static App> {
        APP.get()
    }

    /// For `NSApplicationDidFinishLaunchingNotification`: ends the `-run`
    /// [`App::start`] is inside, so that start-up returns. A no-op at any
    /// other time.
    pub fn launched(&self) {
        if self.launching.get() {
            // `stop:` only flags `-run` to return after the next event; the
            // wake event is that event.
            self.nsapp.stop(None);
            run_loop::wake();
        }
    }

    /// Keeps App Nap off (timers and I/O keep their latency in the
    /// background) while `on`; lets the system nap the process otherwise.
    pub fn set_responsive(&self, on: bool) {
        let mut activity = self.activity.borrow_mut();
        if on == activity.is_some() {
            return;
        }
        let _pool = AutoreleasePool::new();
        let info = NSProcessInfo::process_info();
        match activity.take() {
            Some(token) => info.end_activity(&token),
            None => {
                *activity =
                    Some(info.begin_activity(
                        ACTIVITY_OPTIONS,
                        &NSString::from("bun:appkit window open"),
                    ));
            }
        }
    }

    /// Runs `f` after `seconds` from inside AppKit's wait, the way a display
    /// timer or an Apple Event handler would run. Test support.
    pub fn run_after(&self, seconds: f64, f: Box<dyn FnOnce()>) {
        run_loop::after(seconds, f);
    }

    /// The embedder ran JavaScript from a callout AppKit made; ends the idle
    /// wait now if that left work due. Free when nothing is waiting.
    pub fn after_callout() {
        run_loop::after_callout();
    }

    /// What the event pump has done so far. Test support.
    pub fn run_loop_stats(&self) -> crate::RunLoopStats {
        run_loop::stats().unwrap_or_default()
    }
}

/// Whether any screen is attached. False over ssh, in launchd daemons and
/// in sandboxes; windows still work there but are never composited. Views
/// are built before `App::start` as often as after, so this asks AppKit
/// directly rather than the app; the frameworks must be loaded.
pub(crate) fn has_display() -> bool {
    let _pool = AutoreleasePool::new();
    NSScreen::screens().count() > 0
}
