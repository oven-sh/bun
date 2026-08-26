//! How native code enters a script function, and the event-slot calling
//! convention of `AppKitView`.

use core::cell::RefCell;

use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsError, JsRef};

/// Calls `function` the way every native-to-script entry here does. Reached
/// from inside running script (a comparator during a bridged send, a
/// delegate method or a view's handler under a test body): a plain call, so
/// promise jobs and ticks wait for that script to finish, and what it throws
/// goes to `threw`. Reached from the loop (an AppKit event, a timer, a
/// handed-over call): a callback entry, which reports what it throws and
/// ends with a microtask checkpoint. `None` when it threw.
pub(super) fn enter(
    global: &JSGlobalObject,
    function: JSValue,
    this: JSValue,
    args: &[JSValue],
    threw: impl FnOnce(&JSGlobalObject, JsError),
) -> Option<JSValue> {
    let result = if global.vm().is_entered() {
        if global.has_exception() {
            return None;
        }
        match function.call(global, this, args) {
            Ok(result) => result,
            Err(err) => {
                threw(global, err);
                return None;
            }
        }
    } else {
        global
            .bun_vm()
            .event_loop_mut()
            .run_callback_with_result(function, global, this, args)
    };
    bun_appkit::App::after_callout();
    (!result.is_empty()).then_some(result)
}

/// [`enter`]'s `threw` for a listener: reported as uncaught, the caller carries on.
pub(super) fn report(global: &JSGlobalObject, err: JsError) {
    let _ = bun_jsc::task::report_error_or_terminate(global, err);
}

/// The JavaScript wrapper of a native object. Events read the cached `on*`
/// slot off the wrapper and, if it holds a function, run it through the event
/// loop with the wrapper as `this`.
pub(super) struct JsSlots {
    this_value: RefCell<JsRef>,
    global: GlobalRef,
}

/// What running a slot came to.
pub(super) enum SlotOutcome {
    /// No live wrapper, or the slot holds no function.
    Skipped,
    /// The handler threw (already reported) or the VM is stopping.
    Threw,
    Returned,
}

impl JsSlots {
    /// Lets the wrapper be collected (the JavaScript view tree keeps mounted
    /// views alive).
    pub(super) fn weak(this: JSValue, global: &JSGlobalObject) -> JsSlots {
        JsSlots {
            this_value: RefCell::new(JsRef::init_weak(this)),
            global: GlobalRef::new(global),
        }
    }

    pub(super) fn global(&self) -> &JSGlobalObject {
        &self.global
    }

    /// The wrapper, while it is alive.
    pub(super) fn this(&self) -> Option<JSValue> {
        self.this_value.borrow().try_get()
    }

    /// The wrapper was collected; no further calls.
    pub(super) fn finalize(&self) {
        self.this_value.borrow_mut().finalize();
    }

    /// Runs the function in `slot` with `args`.
    pub(super) fn call(
        &self,
        slot: fn(JSValue) -> Option<JSValue>,
        args: &[JSValue],
    ) -> SlotOutcome {
        let Some(this) = self.this_value.borrow().try_get() else {
            return SlotOutcome::Skipped;
        };
        let Some(callback) = slot(this).filter(|c| c.is_callable()) else {
            return SlotOutcome::Skipped;
        };
        match enter(self.global(), callback, this, args, report) {
            None => SlotOutcome::Threw,
            Some(_) => SlotOutcome::Returned,
        }
    }
}
