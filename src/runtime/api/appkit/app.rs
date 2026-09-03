//! The `AppKitApp` singleton: what the script's `app` object cannot do with
//! plain sends. It starts `NSApplication` with the script's delegate, holds
//! the process open (and App Nap off) while the script asks, and ends the
//! process for an accepted quit at the top of the next loop turn. Activation,
//! the Dock badge, appearance and the quit sequence itself are the script's,
//! over the bridge.

use core::cell::{Cell, RefCell};

use bun_appkit::App;
use bun_appkit::app::LoopHooks;
use bun_appkit::dynamic::{self, Receiver};
use bun_core::Timespec;
use bun_io::KeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::conv::{self, JsStr};
use super::slots;

struct State {
    keep_alive: RefCell<KeepAlive>,
    /// The script holds the process open: a window is open or a keep-alive
    /// token is outstanding.
    held: Cell<bool>,
    /// A quit passed every veto; the process exits at the next loop turn.
    quit_requested: Cell<bool>,
}

thread_local! {
    static STATE: State = State {
        keep_alive: RefCell::new(KeepAlive::init()),
        held: Cell::new(false),
        quit_requested: Cell::new(false),
    };
}

/// Holds the process open, and App Nap off, exactly while the script asks
/// or an accepted quit is waiting for the next loop turn to exit.
fn sync_keep_alive(state: &State) {
    let wanted = state.held.get() || state.quit_requested.get();
    let mut keep_alive = state.keep_alive.borrow_mut();
    if wanted {
        keep_alive.ref_(bun_io::js_vm_ctx());
    } else {
        keep_alive.unref(bun_io::js_vm_ctx());
    }
    if let Some(app) = App::get() {
        app.set_responsive(wanted);
    }
}

/// The running application, or a JavaScript error if the script has not
/// started it on this thread yet.
fn started(global: &JSGlobalObject) -> JsResult<&'static App> {
    App::get().ok_or_else(|| {
        global.throw(format_args!(
            "the AppKit application has not been started on this thread"
        ))
    })
}

/// [`LoopHooks::next_due`]: zero while tasks or immediates are queued,
/// otherwise the time to the earliest armed timer (either heap) or QUIC
/// tick. Peeks only; runs nothing.
fn next_due() -> Option<Timespec> {
    let vm = VirtualMachine::get();
    let event_loop = vm.event_loop_mut();
    let has_pending = !event_loop.immediate_tasks.is_empty()
        || !event_loop.next_immediate_tasks.is_empty()
        || event_loop.has_pending_tasks();
    let quic_next_tick_us = {
        let ild = &vm.uws_loop_mut().internal_loop_data;
        (!ild.quic_head.is_null()).then_some(ild.quic_next_tick_us)
    };
    crate::jsc_hooks::timer_all_mut().peek_next_due(has_pending, quic_next_tick_us)
}

/// [`LoopHooks::outermost`]: no JavaScript frame is on the stack (so no
/// native code JavaScript called into can be holding an autorelease pool
/// across this park), and the loop is not inside `EventLoop::enter`.
fn outermost() -> bool {
    let vm = VirtualMachine::get();
    !vm.jsc_vm().is_entered() && vm.event_loop_mut().entered_event_loop_count == 0
}

/// [`LoopHooks::exit_if_requested`]: a quit that got past every veto ends
/// the process here, at the top of a loop turn, so no AppKit frame is on
/// the stack while exit handlers and finalizers run.
fn exit_if_requested() {
    if STATE.with(|state| state.quit_requested.get()) {
        exit_now();
    }
}

/// [`LoopHooks::report`]: an Objective-C exception AppKit's event dispatch
/// raised, reported as an uncaught `ERR_OBJC_EXCEPTION`; the loop goes on.
fn report(err: bun_appkit::Error) {
    let global = VirtualMachine::get().global();
    slots::report(global, conv::throw(global, err));
}

/// `process.exit(process.exitCode)`.
fn exit_now() {
    let global = VirtualMachine::get().global();
    let code = global.bun_vm().as_mut().exit_handler.exit_code;
    crate::node::process::exit(global, code);
}

/// The native half of `app`: NSApplication start-up and process lifetime.
#[bun_jsc::JsClass(no_constructor)]
pub struct AppKitApp {}

impl AppKitApp {
    /// Creates the singleton's JavaScript wrapper.
    pub(super) fn create(global: &JSGlobalObject) -> JSValue {
        bun_jsc::JsClass::to_js(AppKitApp {}, global)
    }

    /// `start(delegate)`: brings AppKit up with the script's application
    /// delegate (the script set the activation policy just before). A
    /// second call (the module loaded again under a replaced global object
    /// finds AppKit already up) only installs the new delegate.
    pub fn start(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // `null` only off the main thread, where the script makes no delegate
        // and the start is refused for the thread before the delegate matters.
        let delegate = conv::objc_object(frame.argument(0)).map(|d| d.object());
        let loop_ = global.bun_vm().uws_loop_mut();
        let hooks = LoopHooks {
            next_due,
            outermost,
            exit_if_requested,
            report,
        };
        conv::check(global, App::start(loop_, hooks, delegate))?;
        STATE.with(sync_keep_alive);
        Ok(JSValue::UNDEFINED)
    }

    /// `started`: whether [`start`](Self::start) has run on this thread,
    /// under this global object or one the module was loaded into earlier.
    pub fn get_started(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(App::get().is_some()))
    }

    /// For `NSApplicationDidFinishLaunchingNotification`; see [`App::launched`].
    pub fn launched(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if let Some(app) = App::get() {
            app.launched();
        }
        Ok(JSValue::UNDEFINED)
    }

    /// A quit got past every veto: hold the process until the next loop
    /// turn and exit there, outside AppKit's event dispatch.
    pub fn quit_accepted(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        STATE.with(|state| {
            state.quit_requested.set(true);
            sync_keep_alive(state);
        });
        VirtualMachine::get().event_loop_mut().wakeup();
        Ok(JSValue::UNDEFINED)
    }

    /// `process.exit(process.exitCode)` now: for `applicationWillTerminate:`
    /// (AppKit calls `exit` when that returns) and for a quit before
    /// anything started AppKit.
    pub fn exit_now(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        exit_now();
        Ok(JSValue::UNDEFINED)
    }

    /// `hold(on)`: whether the script wants the process kept open (a window
    /// is open, `app.keepAlive`, an `app.retain()` token).
    pub fn hold(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let on = conv::boolean(global, frame.argument(0), format_args!("hold"))?;
        STATE.with(|state| {
            state.held.set(on);
            sync_keep_alive(state);
        });
        Ok(JSValue::UNDEFINED)
    }

    /// Hooks for `bun:internal-for-testing`; `op` picks one.
    pub fn testing(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let op = JsStr::new(global, frame.argument(0), format_args!("op"))?.to_utf8();
        match op.as_str() {
            // Every compiled Objective-C binding checked against the loaded
            // frameworks; one string per mismatch.
            "verifyBindings" => {
                let problems = conv::check(global, bun_appkit::verify_bindings_in_bun())?;
                let array = JSValue::create_empty_array(global, problems.len())?;
                for (i, p) in problems.iter().enumerate() {
                    let s = bun_jsc::StringJsc::to_js(
                        &bun_core::String::clone_utf8(p.as_bytes()),
                        global,
                    )?;
                    array.put_index(global, i as u32, s)?;
                }
                Ok(array)
            }
            // Runs `callback` after `ms` from inside AppKit's wait rather than
            // from Bun's timer heap, like a display timer or an Apple Event.
            "runInsideWait" => {
                let app = started(global)?;
                let ms = conv::number(global, frame.argument(1), format_args!("ms"))?;
                let callback = frame.argument(2);
                if !callback.is_callable() {
                    return Err(
                        global.throw_invalid_arguments(format_args!("callback must be a function"))
                    );
                }
                let callback = bun_jsc::Strong::create(callback, global);
                app.run_after(
                    ms / 1000.0,
                    Box::new(move || {
                        let global = VirtualMachine::get().global();
                        slots::enter(
                            global,
                            callback.get(),
                            JSValue::UNDEFINED,
                            &[],
                            slots::report,
                        );
                    }),
                );
                Ok(JSValue::UNDEFINED)
            }
            // `{ waits, dispatched, wakes, staleWakes, handOffs }`: what the event
            // pump has done since the application started.
            "runLoopStats" => {
                let stats = started(global)?.run_loop_stats();
                let object = JSValue::create_empty_object(global, 5);
                for (name, value) in [
                    (&b"waits"[..], stats.waits),
                    (b"dispatched", stats.dispatched),
                    (b"wakes", stats.wakes),
                    (b"staleWakes", stats.stale_wakes),
                    (b"handOffs", stats.hand_offs),
                ] {
                    object.put(global, name, JSValue::js_number(value as f64));
                }
                Ok(object)
            }
            // How the bridge sends `selector` (argument 2) to the handle in
            // argument 1: "libffi" or "invocation".
            "sendPath" => {
                let sel =
                    JsStr::new(global, frame.argument(2), format_args!("selector"))?.to_utf8();
                let path = |receiver| dynamic::signature(receiver, &sel).map(|sig| sig.path());
                let value = frame.argument(1);
                let path = if let Some(o) = conv::objc_object(value) {
                    conv::check(global, path(Receiver::Object(o.object())))?
                } else if let Some(c) = conv::objc_class(value) {
                    conv::check(global, path(Receiver::Class(&c.class())))?
                } else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "sendPath: expected an ObjCObject or ObjCClass"
                    )));
                };
                let name = match path {
                    dynamic::Path::Libffi => "libffi",
                    dynamic::Path::Invocation => "invocation",
                };
                bun_jsc::StringJsc::to_js(&bun_core::String::static_(name.as_bytes()), global)
            }
            other => {
                Err(global.throw_invalid_arguments(format_args!("unknown testing op \"{other}\"")))
            }
        }
    }
}
