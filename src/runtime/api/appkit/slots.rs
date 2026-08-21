//! The event-slot calling convention shared by `AppKitApp`, `AppKitWindow`
//! and `AppKitView`.

use core::cell::RefCell;

use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsRef};

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
    Returned(JSValue),
}

impl JsSlots {
    /// Holds the wrapper alive (an open window keeps itself open).
    pub(super) fn strong(this: JSValue, global: &JSGlobalObject) -> JsSlots {
        JsSlots {
            this_value: RefCell::new(JsRef::init_strong(this, global)),
            global: GlobalRef::new(global),
        }
    }

    /// Lets the wrapper be collected (the JavaScript view tree keeps mounted
    /// views alive).
    pub(super) fn weak(this: JSValue, global: &JSGlobalObject) -> JsSlots {
        JsSlots {
            this_value: RefCell::new(JsRef::init_weak(this)),
            global: GlobalRef::new(global),
        }
    }

    /// No wrapper yet; `bind` it once it exists.
    pub(super) fn empty(global: &JSGlobalObject) -> JsSlots {
        JsSlots {
            this_value: RefCell::new(JsRef::empty()),
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

    /// The singleton's wrapper now exists.
    pub(super) fn bind(&self, this: JSValue, global: &JSGlobalObject) {
        self.this_value.borrow_mut().set_strong(this, global);
    }

    /// Stop keeping the wrapper alive (the window closed); events still reach
    /// it while JavaScript holds it.
    pub(super) fn release(&self) {
        self.this_value.borrow_mut().downgrade();
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
        let global = self.global();
        let result = global
            .bun_vm()
            .event_loop_mut()
            .run_callback_with_result(callback, global, this, args);
        if result.is_empty() {
            SlotOutcome::Threw
        } else {
            SlotOutcome::Returned(result)
        }
    }

    /// Go ahead unless the handler returned exactly `false`; a handler that
    /// throws does not veto.
    pub(super) fn allows(&self, slot: fn(JSValue) -> Option<JSValue>, args: &[JSValue]) -> bool {
        !matches!(self.call(slot, args), SlotOutcome::Returned(v) if v.is_boolean() && !v.as_boolean())
    }
}
