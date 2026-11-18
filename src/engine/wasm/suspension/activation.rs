//! The calls from native code that can be suspended.

use core::cell::Cell;
use core::ptr;

use bun_engine_vm::{JsPromise, Vm};

use crate::prelude::*;

pub(super) struct Activation {
    /// The innermost when the call was made.
    outer_entry_frame: usize,
    promise: Gc<JsPromise>,
    is_suspended: Cell<bool>,
}

/// The address of an `Activation`, which is on the stack, or zero.
#[derive(Default)]
struct Innermost(Cell<usize>);

impl Activation {
    /// `call` enters generated code once. `None` if that was suspended.
    pub(super) fn run<T>(
        cx: &mut Cx,
        promise: Gc<JsPromise>,
        call: impl FnOnce(&mut Cx) -> T,
    ) -> Option<T> {
        let activation = Activation {
            outer_entry_frame: cx.top_entry_frame(),
            promise,
            is_suspended: Cell::new(false),
        };
        let innermost = cx.extension::<Innermost>();
        let outer = (innermost.0).replace((&raw const activation).expose_provenance());
        let result = call(cx);
        innermost.0.set(outer);
        (!activation.is_suspended.get()).then_some(result)
    }

    /// For what returns before `run` does.
    pub(super) fn innermost<'a>(vm: &Vm) -> Option<&'a Activation> {
        let address = vm.existing_extension::<Innermost>()?.0.get();
        // SAFETY: `run` has not returned, and whoever asks is called by it.
        unsafe { ptr::with_exposed_provenance::<Activation>(address).as_ref() }
    }

    /// Whether no other native code has called generated code since.
    pub(super) fn has_made_last_entry(&self, vm: &Vm) -> bool {
        vm.outer_entry_frame() == Some(self.outer_entry_frame)
    }

    /// Returns the promise that is still to be settled.
    pub(super) fn suspend(&self) -> Value {
        self.is_suspended.set(true);
        self.promise.into()
    }
}
