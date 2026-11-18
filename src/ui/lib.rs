//! Windows, input and the services of the system, through the UI library of `bun:desktop`.

use core::cell::{Cell, RefCell};
use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

use bun_jsc::strong::StrongCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult, Strong};

#[path = "../dom/abi.rs"]
mod abi;
pub use abi::accessibility::{Action as AccessibilityAction, TREE_OF_IMAGE};
pub use abi::{FontSetting, Rect, Region};
pub mod protocol;
#[macro_use]
pub mod value;

pub mod clipboard;
pub mod data;
pub mod dom;
mod generated_bindgen;
pub mod image;
pub mod later;
pub mod preferences;
pub mod queue;
pub mod script;
pub mod surfaces;

use protocol::{Command, Maybe, Outcome, SystemCommand, SystemEvent, Text, Ui, WindowEvent};
use value::IntoJs;

unsafe extern "C" {
    /// Null if it has thrown.
    safe fn Bun__Desktop__load(global: &JSGlobalObject) -> Option<&'static Ui>;
    safe fn Bun__Desktop__process(global: &JSGlobalObject) -> JSValue;
}

// `trim: { remove }` can take them out of an executable that keeps `bun:desktop`.
unsafe extern "Rust" {
    #[link_name = "__bun_desktop_has_http_client"]
    pub safe fn has_http_client() -> bool;
    #[link_name = "__bun_desktop_can_start_programs"]
    pub safe fn can_start_programs() -> bool;
}

static UI: OnceLock<&'static Ui> = OnceLock::new();

thread_local! {
    static OWNER: ManuallyDrop<StrongCell> = ManuallyDrop::default();
    static RELEASES: ManuallyDrop<RefCell<Vec<Box<dyn FnOnce()>>>> = ManuallyDrop::default();
    static SLOTS: ManuallyDrop<RefCell<Vec<*const ()>>> = const { ManuallyDrop::new(RefCell::new(Vec::new())) };
    static WORKER: Cell<Worker> = const { Cell::new(Worker::Unknown) };
}

#[derive(Clone, Copy, PartialEq)]
enum Worker {
    Unknown,
    Runs,
    HasEnded,
}

/// A pointer of each thread. Every thread of the process pays for what a `thread_local!` holds, so these are on the heap.
pub struct Slot<T>(AtomicUsize, PhantomData<fn() -> T>);

impl<T> Slot<T> {
    pub const fn empty() -> Self {
        Slot(AtomicUsize::new(0), PhantomData)
    }

    #[inline]
    fn get(&self) -> *const T {
        let place = self.0.load(Ordering::Relaxed);
        SLOTS.with(|it| {
            it.borrow()
                .get(place)
                .map_or(core::ptr::null(), |it| it.cast())
        })
    }

    #[cold]
    fn set(&self, value: *const T) {
        fn set(place: &AtomicUsize, value: *const ()) {
            static LAST: AtomicUsize = AtomicUsize::new(0);
            if place.load(Ordering::Relaxed) == 0 {
                let next = LAST.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = place.compare_exchange(0, next, Ordering::Relaxed, Ordering::Relaxed);
            }
            let place = place.load(Ordering::Relaxed);
            SLOTS.with(|it| {
                let mut slots = it.borrow_mut();
                if slots.is_empty() {
                    at_end_of_worker(|| {});
                }
                if slots.len() <= place {
                    slots.resize(place + 1, core::ptr::null());
                }
                slots[place] = value;
            });
        }
        set(&self.0, value.cast());
    }

    /// Returns the value, and what destroys it.
    fn fill(&'static self) -> (*const T, impl FnOnce())
    where
        T: Default,
    {
        let value = bun_core::heap::into_raw(Box::<T>::default());
        self.set(value);
        let release = move || {
            self.set(core::ptr::null());
            // SAFETY: from `into_raw`. The callers call this where no reference is left.
            unsafe { bun_core::heap::destroy(value) };
        };
        (value, release)
    }
}

fn is_worker() -> bool {
    VirtualMachine::get_or_null().is_some_and(|it| it.worker_ref().is_some())
}

/// The VM is gone by then.
pub fn at_end_of_worker(step: impl FnOnce() + 'static) {
    add_step_at_end_of_worker(Box::new(step));
}

fn add_step_at_end_of_worker(step: Box<dyn FnOnce()>) {
    struct Steps(RefCell<Vec<Box<dyn FnOnce()>>>);
    impl Drop for Steps {
        fn drop(&mut self) {
            WORKER.set(Worker::HasEnded);
            self.0.take().into_iter().for_each(|it| it());
            SLOTS.with(|it| it.take());
        }
    }
    thread_local! {
        static STEPS: Steps = const { Steps(RefCell::new(Vec::new())) };
    }
    if WORKER.get() == Worker::Unknown && is_worker() {
        WORKER.set(Worker::Runs);
    }
    if WORKER.get() == Worker::Runs {
        STEPS.with(|it| it.0.borrow_mut().push(step));
    }
}

/// A thread-local that destructors can use. It is dropped [`at_end_of_worker`].
pub struct Lasting<T>(Slot<T>);

impl<T: Default + 'static> Lasting<T> {
    pub const fn empty() -> Self {
        Lasting(Slot::empty())
    }

    #[inline]
    pub fn with<R>(&'static self, steps: impl FnOnce(&T) -> R) -> R {
        let temporary;
        let mut value = self.0.get();
        if value.is_null() {
            if WORKER.get() == Worker::HasEnded {
                temporary = T::default();
                value = &raw const temporary;
            } else {
                value = self.fill();
            }
        }
        // SAFETY: it lives until the thread ends, or else until this function returns.
        steps(unsafe { &*value })
    }

    #[cold]
    fn fill(&'static self) -> *const T {
        let (value, release) = self.0.fill();
        at_end_of_worker(release);
        value
    }
}

/// What `slot` has for the global object of this thread's VM. `bun test --isolate` makes a new one for each file.
pub fn state<T: Default>(slot: &'static Slot<T>) -> &'static T {
    let global = main_global();
    if OWNER.with(|it| it.get()) != Some(global.to_js_value()) {
        change_owner(global);
    }
    let mut value = slot.get();
    if value.is_null() {
        let release;
        (value, release) = slot.fill();
        release_later(global, Box::new(release));
    }
    // SAFETY: the global object is replaced between the turns of the event loop.
    unsafe { &*value }
}

fn release_everything() {
    RELEASES
        .with(|it| it.take())
        .into_iter()
        .for_each(|release| release());
}

#[cold]
fn release_later(global: &JSGlobalObject, release: Box<dyn FnOnce()>) {
    extern "C" fn at_exit(_: *mut core::ffi::c_void) {
        release_everything();
    }
    if RELEASES.with(|it| it.borrow().is_empty()) && is_worker() {
        // SAFETY: a safe function takes any argument.
        unsafe {
            (global.bun_vm().rare_data()).push_cleanup_hook(global, core::ptr::null_mut(), at_exit);
        }
    }
    RELEASES.with(|it| it.borrow_mut().push(release));
}

#[cold]
fn change_owner(global: &JSGlobalObject) {
    let had_one = OWNER.with(|it| it.is_some());
    OWNER.with(|it| it.set(Strong::create(global.to_js_value(), global)));
    release_everything();
    if let (true, Some(ui)) = (had_one, loaded()) {
        let _ = (ui.perform)(Command::ShutDown { is_exiting: false });
    }
}

/// Declares `fn $name() -> &'static $type`, which is [`state`].
#[macro_export]
macro_rules! state {
    ($visibility:vis fn $name:ident() -> $type:ty) => {
        $visibility fn $name() -> &'static $type {
            static SLOT: $crate::Slot<$type> = $crate::Slot::empty();
            $crate::state(&SLOT)
        }
    };
}

/// That of the app, whichever page is calling.
pub fn main_global() -> &'static JSGlobalObject {
    VirtualMachine::get().global()
}

#[derive(Clone, Copy)]
pub struct Listeners {
    pub started: fn() -> JsResult<()>,
    pub system: fn(SystemEvent) -> JsResult<()>,
    pub window: fn(u32, WindowEvent) -> JsResult<()>,
}

#[derive(Default)]
struct Session {
    listeners: Cell<Option<Listeners>>,
    is_started: Cell<bool>,
    is_accessory: Cell<bool>,
    is_app_headless: Cell<bool>,
    holds: Cell<u32>,
    keep_alive: bun_io::JsKeepAlive,
}

state!(fn session() -> Session);

pub fn listen(listeners: Listeners) {
    session().listeners.set(Some(listeners));
}

pub fn process() -> JSValue {
    Bun__Desktop__process(main_global())
}

/// From `process.env`, which the app may have changed.
pub fn environment(global: &JSGlobalObject, name: &str) -> JsResult<Option<Vec<u8>>> {
    let Some(all) = process().get(global, "env")?.filter(|it| it.is_object()) else {
        return Ok(None);
    };
    match all.get(global, name)? {
        Some(value) => Ok(Some(value.to_utf8(global)?.to_vec())),
        None => Ok(None),
    }
}

pub fn is_headless(global: &JSGlobalObject) -> JsResult<bool> {
    Ok(session().is_app_headless.get()
        || environment(global, "BUN_DESKTOP_HEADLESS")?.as_deref() == Some(b"1"))
}

/// In the process of a page, which does not have the environment of the app.
pub fn set_app_headless(is_headless: bool) {
    session().is_app_headless.set(is_headless);
}

pub fn loaded() -> Option<&'static Ui> {
    UI.get().copied()
}

/// Enough for fonts, images and surfaces that are in no window. Needs no display.
pub fn renderer(global: &JSGlobalObject) -> JsResult<&'static Ui> {
    if let Some(ui) = loaded() {
        return Ok(ui);
    }
    let ui = bun_jsc::from_js_host_call_generic(global, || Bun__Desktop__load(global))?;
    ui.map(|ui| *UI.get_or_init(|| ui)).ok_or(JsError::Thrown)
}

fn start_command(global: &JSGlobalObject) -> JsResult<Command> {
    Ok(Command::Start {
        is_headless: is_headless(global)?,
        is_accessory: session().is_accessory.get(),
    })
}

pub fn start(global: &JSGlobalObject) -> JsResult<&'static Ui> {
    if !global.bun_vm().is_main_thread.get() {
        return Err(global.throw(format_args!("bun:desktop is not available in a Worker")));
    }
    let (ui, session) = (renderer(global)?, session());
    if !session.is_started.get() {
        check(global, (ui.perform)(start_command(global)?))?;
        if session.is_accessory.get() {
            let command = Command::System(SystemCommand::ShowInDock(false));
            check(global, (ui.perform)(command))?;
        }
        session.is_started.set(true);
        if let Some(listeners) = session.listeners.get() {
            (listeners.started)()?;
        }
    }
    Ok(ui)
}

pub fn is_started() -> bool {
    session().is_started.get()
}

/// The app does not notice, and this thread does not wait.
pub fn start_with(global: &JSGlobalObject, command: Command) -> JsResult<()> {
    let ui = renderer(global)?;
    (ui.tell)(start_command(global)?);
    (ui.tell)(command);
    Ok(())
}

/// An app that is not in the Dock.
pub fn set_accessory(global: &JSGlobalObject, is_accessory: bool) -> JsResult<()> {
    session().is_accessory.set(is_accessory);
    if !is_started() {
        return Ok(());
    }
    tell(
        global,
        Command::System(SystemCommand::ShowInDock(!is_accessory)),
    )
}

fn prepared(global: &JSGlobalObject, command: &Command) -> JsResult<&'static Ui> {
    match command {
        Command::Surface { .. } | Command::KeyWasHandled => renderer(global),
        _ => start(global),
    }
}

/// Does not wait. A failure becomes a warning.
pub fn tell(global: &JSGlobalObject, command: Command) -> JsResult<()> {
    (prepared(global, &command)?.tell)(command);
    Ok(())
}

pub fn perform(global: &JSGlobalObject, command: Command) -> JsResult<()> {
    check(global, (prepared(global, &command)?.perform)(command))
}

pub fn check(global: &JSGlobalObject, failure: Maybe<Text>) -> JsResult<()> {
    match failure.get() {
        Some(reason) => Err(global.throw(format_args!("{}", &*reason))),
        None => Ok(()),
    }
}

impl<T> Outcome<T> {
    pub fn or_throw(self, global: &JSGlobalObject) -> JsResult<T> {
        self.get()
            .map_err(|reason| global.throw(format_args!("{}", &*reason)))
    }
}

/// The process goes on until there was a [`release`] for each.
pub fn hold() {
    let session = session();
    if session.holds.replace(session.holds.get() + 1) == 0 {
        session.keep_alive.ref_(bun_io::js_vm_ctx());
    }
}

pub fn release() {
    let session = session();
    session.holds.set(session.holds.get().saturating_sub(1));
    if session.holds.get() == 0 {
        session.keep_alive.unref(bun_io::js_vm_ctx());
    }
}

pub fn warn(global: &JSGlobalObject, message: &str) -> JsResult<()> {
    let (message, kind) = (message.into_js(global)?, "DesktopWarning".into_js(global)?);
    global.emit_warning(message, kind, JSValue::UNDEFINED, JSValue::UNDEFINED)
}

/// For where nobody is left to catch it.
pub fn report(global: &JSGlobalObject, result: JsResult<()>) -> JsResult<()> {
    match result {
        Err(error) if error != JsError::Terminated => {
            bun_jsc::task::report_error_or_terminate(global, error).map_err(|_| JsError::Terminated)
        }
        result => result,
    }
}
