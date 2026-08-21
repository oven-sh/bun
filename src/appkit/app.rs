//! The shared `NSApplication`: start-up, activation, termination and the
//! application delegate.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_core::Timespec;
use bun_uws_sys::Loop;

use crate::menu::{self, MenuBar};
use crate::objc::appkit::{NSApplication, NSRunningApplication, NSScreen};
use crate::objc::foundation::{NSObject, NSProcessInfo, NSString};
use crate::objc::{self, AppEvents, AutoreleasePool, Delegate};
use crate::{Error, Result, named_enum, run_loop};

named_enum! {
    /// `NSApplicationActivationPolicy`.
    pub enum ActivationPolicy {
        /// Dock icon and menu bar.
        Regular = "regular",
        /// No Dock icon; can still show windows and a status item.
        Accessory = "accessory",
        /// No UI at all (`NSApplicationActivationPolicyProhibited`).
        Prohibited = "background",
    }
}

impl From<ActivationPolicy> for objc::appkit::ActivationPolicy {
    fn from(p: ActivationPolicy) -> Self {
        match p {
            ActivationPolicy::Regular => Self::Regular,
            ActivationPolicy::Accessory => Self::Accessory,
            ActivationPolicy::Prohibited => Self::Prohibited,
        }
    }
}

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
    /// stack: the place to end the process after [`AppSink::quit`].
    pub exit_if_requested: fn(),
}

/// Where application-level events go. Called on the main thread from inside
/// AppKit event dispatch.
pub trait AppSink {
    /// The user asked to quit. Return false to veto.
    fn before_quit(&self) -> bool;
    /// A quit that `before_quit` allowed and no window's `should_close`
    /// refused; every window is closed by now. This runs inside AppKit event
    /// dispatch, so record the request and end the process from
    /// [`LoopHooks::exit_if_requested`].
    fn quit(&self);
    /// AppKit is terminating the process now (`applicationWillTerminate:`,
    /// after an accepted Quit menu item, Dock Quit or logout) and calls
    /// `exit` when this returns: run the embedder's exit path here.
    fn exit_now(&self);
    /// The Dock icon was clicked while the app was running; `has_visible_windows` as AppKit
    /// reports it.
    fn reopened(&self, has_visible_windows: bool);
    /// A menu item built with [`menu::Action::Callback`] was chosen.
    fn menu_item(&self, id: u32);
}

/// The process-wide application object. Lives for the rest of the process
/// once [`App::start`] succeeds.
pub struct App {
    nsapp: NSApplication,
    delegate: Delegate<dyn AppEvents>,
    name: RefCell<String>,
    sink: RefCell<Option<Rc<dyn AppSink>>>,
    menu_bar: RefCell<MenuBar>,
    /// Inside our own `-[NSApplication run]` during start-up.
    launching: Cell<bool>,
    /// A quit got past every veto; later requests are no-ops.
    quitting: Cell<bool>,
    /// The `NSProcessInfo` activity that keeps App Nap off while a window is
    /// open or the embedder asked to stay responsive; see [`App::set_responsive`].
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
    /// running. `hooks` and `policy` only apply on the first call. Nothing is
    /// activated: the first `Window::show`, `Window::focus` or
    /// [`App::activate`] does that.
    pub fn start(
        loop_: &mut Loop,
        hooks: LoopHooks,
        policy: ActivationPolicy,
    ) -> Result<&'static App> {
        if let Some(app) = App::get() {
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
        if !nsapp.set_activation_policy(policy.into()) {
            return Err(Error::ActivationPolicyRefused(policy));
        }
        run_loop::install(loop_, &nsapp, hooks)?;

        let delegate = Delegate::app(Box::new(Handler));
        nsapp.set_delegate(Some(delegate.as_nsobject()));

        let name = process_name();
        let menu_bar = MenuBar::standard(&nsapp, delegate.as_nsobject(), &name);
        nsapp.set_main_menu(Some(menu_bar.nsmenu()));

        let app: &'static App = Box::leak(Box::new(App {
            nsapp,
            delegate,
            name: RefCell::new(name),
            sink: RefCell::new(None),
            menu_bar: RefCell::new(menu_bar),
            launching: Cell::new(false),
            quitting: Cell::new(false),
            activity: RefCell::new(None),
        }));
        APP.set(Some(app));

        if launched {
            run_loop::poll();
        } else if app.has_display() {
            // `-run` performs the launch sequence an unbundled process
            // otherwise never gets (menu bar activation, `isRunning`). The
            // delegate stops it from `applicationDidFinishLaunching:` so it
            // returns straight away.
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

    pub fn set_sink(&self, sink: Box<dyn AppSink>) {
        *self.sink.borrow_mut() = Some(Rc::from(sink));
    }

    pub fn name(&self) -> String {
        self.name.borrow().clone()
    }

    /// The name used in the default menus ("About <name>", "Quit <name>"). `None` restores the
    /// process name.
    pub fn set_name(&self, name: Option<&str>) {
        *self.name.borrow_mut() = name.map_or_else(process_name, str::to_owned);
        if !self.menu_bar.borrow().is_custom() {
            self.set_menu(None);
        }
    }

    /// Replaces the menu bar. `None` installs the standard App/Edit/View/Window menus.
    pub fn set_menu(&self, spec: Option<&[menu::Menu]>) {
        let delegate = self.delegate.as_nsobject();
        let bar = match spec {
            Some(menus) => MenuBar::custom(delegate, menus),
            None => MenuBar::standard(&self.nsapp, delegate, &self.name.borrow()),
        };
        self.nsapp.set_main_menu(Some(bar.nsmenu()));
        *self.menu_bar.borrow_mut() = bar;
    }

    pub fn set_activation_policy(&self, policy: ActivationPolicy) -> Result<()> {
        if self.nsapp.set_activation_policy(policy.into()) {
            Ok(())
        } else {
            Err(Error::ActivationPolicyRefused(policy))
        }
    }

    /// Brings the application to the front.
    pub fn activate(&self) {
        self.nsapp.activate_ignoring_other_apps(true);
    }

    pub fn hide(&self) {
        self.nsapp.hide(None);
    }

    pub fn unhide(&self) {
        self.nsapp.unhide(None);
    }

    /// Text on the Dock tile; empty clears it.
    pub fn set_badge(&self, text: &str) {
        let _pool = AutoreleasePool::new();
        let label = (!text.is_empty()).then(|| NSString::from(text));
        self.nsapp.dock_tile().set_badge_label(label.as_ref());
    }

    /// Whether the effective appearance is a dark one.
    pub fn is_dark(&self) -> bool {
        let _pool = AutoreleasePool::new();
        let name = self.nsapp.effective_appearance().name().to_string_lossy();
        bun_core::strings::contains(name.as_bytes(), b"Dark")
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
                        &NSString::from("Bun.AppKit window open"),
                    ));
            }
        }
    }

    /// The one entry point for Cmd-Q, the Quit menu item, the Dock's Quit, a
    /// logout and `app.quit()`. The sink's `before_quit` can veto; then every
    /// window this crate created that is still open (on screen, hidden or
    /// minimized) is asked through its `should_close`, and those that agree
    /// close. If none refused, the sink's `quit` is told to end the process
    /// and this returns true; once that has happened further calls return
    /// true without asking again.
    pub fn request_quit(&self) -> bool {
        if self.quitting.get() {
            return true;
        }
        let sink = self.sink();
        if sink.as_ref().is_some_and(|sink| !sink.before_quit()) {
            return false;
        }
        let _pool = AutoreleasePool::new();
        if !crate::window::close_all() {
            return false;
        }
        self.quitting.set(true);
        if let Some(sink) = sink {
            sink.quit();
        }
        true
    }

    /// Whether a quit has been accepted and the process is on its way out.
    pub fn is_quitting(&self) -> bool {
        self.quitting.get()
    }

    /// `-[NSApplication terminate:]`, what the Quit menu item, the Dock and a
    /// logout send: `applicationShouldTerminate:` and, if nothing vetoes,
    /// `applicationWillTerminate:` then `exit`.
    pub fn terminate(&self) {
        self.nsapp.terminate(None);
    }

    /// Runs `f` after `seconds` from inside AppKit's wait, the way a display
    /// timer or an Apple Event handler would run. Test support.
    pub fn run_after(&self, seconds: f64, f: Box<dyn FnOnce()>) {
        run_loop::after(seconds, f);
    }

    /// Whether any screen is attached. False over ssh, in launchd daemons and
    /// in sandboxes; windows still work there but are never composited.
    pub fn has_display(&self) -> bool {
        NSScreen::screens().count() > 0
    }

    /// [`App::has_display`] without starting the application: loads the
    /// frameworks if needed and asks `NSScreen`.
    pub fn query_display() -> Result<bool> {
        objc::load()?;
        let _pool = AutoreleasePool::new();
        Ok(NSScreen::screens().count() > 0)
    }

    /// Cloned out so no `RefCell` borrow is held while the sink runs JS.
    fn sink(&self) -> Option<Rc<dyn AppSink>> {
        self.sink.borrow().clone()
    }
}

/// `-[NSProcessInfo processName]`, the name AppKit itself falls back to.
fn process_name() -> String {
    NSProcessInfo::process_info()
        .process_name()
        .to_string_lossy()
}

struct Handler;

impl AppEvents for Handler {
    fn terminate_requested(&self) -> bool {
        App::get().is_some_and(App::request_quit)
    }

    fn will_terminate(&self) {
        if let Some(sink) = App::get().and_then(App::sink) {
            sink.exit_now();
        }
    }

    fn did_finish_launching(&self) {
        if let Some(app) = App::get()
            && app.launching.get()
        {
            // `stop:` only flags `-run` to return after the next event; the
            // wake event is that event.
            app.nsapp.stop(None);
            run_loop::wake();
        }
    }

    fn reopened(&self, has_visible_windows: bool) {
        if let Some(sink) = App::get().and_then(App::sink) {
            sink.reopened(has_visible_windows);
        }
    }

    fn menu_item(&self, id: u32) {
        if let Some(sink) = App::get().and_then(App::sink) {
            sink.menu_item(id);
        }
    }
}
