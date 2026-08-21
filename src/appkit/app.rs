//! The shared `NSApplication`: start-up, activation, termination and the
//! application delegate.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_uws_sys::Loop;

use crate::menu::{self, MenuBar};
use crate::objc::appkit::{NSApplication, NSScreen, NSWindow};
use crate::objc::foundation::{NSProcessInfo, NSString};
use crate::objc::{self, AppEvents, AutoreleasePool, Delegate, Object};
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

/// Where application-level events go. Called on the main thread from inside
/// AppKit event dispatch.
pub trait AppSink {
    /// The user asked to quit. Return true to go ahead and close every window.
    fn before_quit(&self) -> bool;
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
}

thread_local! {
    static APP: Cell<Option<&'static App>> = const { Cell::new(None) };
}

impl App {
    /// Starts AppKit on this thread (once) and returns the application.
    ///
    /// `loop_` is this thread's usockets loop; its idle wait is routed through
    /// AppKit from now on. `policy` only applies on the first call.
    pub fn start(loop_: &mut Loop, policy: ActivationPolicy) -> Result<&'static App> {
        if let Some(app) = App::get() {
            return Ok(app);
        }
        objc::load()?;
        let _pool = AutoreleasePool::new();
        // No up-front WindowServer check: sandboxed and headless sessions
        // report no displays yet still run AppKit off screen, which is what
        // tests need. `has_display` tells callers which case they are in.
        let nsapp = NSApplication::shared();
        if !nsapp.set_activation_policy(policy.into()) {
            return Err(Error::ActivationPolicyRefused(policy));
        }

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
        }));
        APP.set(Some(app));

        run_loop::install(loop_, &app.nsapp);

        if app.has_display() {
            // `-run` performs the launch sequence an unbundled process
            // otherwise never gets (menu bar activation, `isRunning`). The
            // delegate stops it from `applicationDidFinishLaunching:` so it
            // returns straight away.
            app.nsapp.run();
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
        app.activate();
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

    /// The one entry point for Cmd-Q, the Quit menu item and `app.quit()`: asks the sink's
    /// `before_quit`, and unless it vetoes closes every window so the process winds down
    /// through Bun once nothing keeps it alive.
    pub fn request_quit(&self) {
        if self.sink().is_none_or(|sink| sink.before_quit()) {
            self.close_all_windows();
        }
    }

    fn close_all_windows(&self) {
        let _pool = AutoreleasePool::new();
        for object in self.nsapp.windows().iter() {
            if let Ok(window) = object.downcast::<NSWindow>() {
                window.close();
            }
        }
    }

    /// Whether any screen is attached. False over ssh, in launchd daemons and
    /// in sandboxes; windows still work there but are never composited.
    pub fn has_display(&self) -> bool {
        NSScreen::screens().count() > 0
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
    fn terminate_requested(&self) {
        if let Some(app) = App::get() {
            app.request_quit();
        }
    }

    fn did_finish_launching(&self) {
        if let Some(app) = App::get() {
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
