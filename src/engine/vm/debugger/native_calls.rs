//! Entries that tell the debugger of a call before they go on to those of native functions.

use bun_engine_bytecode::Specialization::{self, Call, Construct};
use bun_engine_macros::native_abi;

use crate::{CallFrame, CellType, Cx, Executable, JsFunction, NativeExecutable, Vm, call};

fn usual_entry(vm: &Vm, executable: &Executable, specialization: Specialization) -> usize {
    match (executable.downcast::<NativeExecutable>(), specialization) {
        (Some(_), Call) => (vm.hooks().native_call_entry)(vm, executable.intrinsic()),
        (Some(_), Construct) => call::native_construct_entry(),
        (None, Call) => call::internal_function_call_entry(),
        (None, Construct) => call::internal_function_construct_entry(),
    }
}

impl Vm {
    pub(crate) fn watches_native_calls(&self) -> bool {
        self.services.debugger.watches_native_calls.get()
    }

    /// For all native functions, and those to come. What a compiler has put in the place of a call goes unnoticed.
    pub fn set_watches_native_calls(&self, watches: bool) {
        if self.services.debugger.watches_native_calls.replace(watches) == watches {
            return;
        }
        self.internal_function_executable()
            .watch_calls(self, watches);
        (self.heap).for_each_live::<NativeExecutable>(|it| it.watch_calls(self, watches));
    }
}

impl Executable {
    /// Leaves an entry alone that was made for this one.
    pub(crate) fn watch_calls(&self, vm: &Vm, watches: bool) {
        for (specialization, watched) in [
            (Call, call::watched_call_entry()),
            (Construct, call::watched_construct_entry()),
        ] {
            let usual = usual_entry(vm, self, specialization);
            let (old, new) = if watches {
                (usual, watched)
            } else {
                (watched, usual)
            };
            if self.entry(specialization) == old {
                // SAFETY: each leads to the function.
                unsafe { self.install(specialization, new, None) };
            }
        }
    }
}

/// The address to go on at.
#[native_abi]
pub(crate) unsafe fn will_call_native_function(
    vm: &Vm,
    frame: &CallFrame,
    specialization: u32,
) -> usize {
    let callee = frame.callee();
    if let Some(global) = frame.realm() {
        // SAFETY: called from generated code, which is inside a call that has the `Cx`.
        let cx = unsafe { Cx::from_global(global) };
        cx.notify_debugger(|cx, debugger| debugger.will_call_native_function(cx, frame));
    }
    let executable = match callee.cell_type() {
        CellType::Function => callee.cast::<JsFunction>().executable(),
        _ => vm.internal_function_executable(),
    };
    let specialization = if specialization == 0 { Call } else { Construct };
    usual_entry(vm, &executable, specialization)
}
