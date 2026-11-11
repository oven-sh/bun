use super::bun_test::{self, AddedInPhase, ExecutionEntry};
use bun_jsc::JSGlobalObject;

#[derive(Clone, Copy)]
enum Asks {
    /// A call that the running code makes.
    Call,
    /// The load of a module. Its imports load after the callback that asked for it has returned, so the stack can't name their owner.
    ModuleLoad,
}

fn is_preload(global: &JSGlobalObject, asks: Asks) -> bool {
    let vm = global.bun_vm();
    if vm.is_in_preload {
        return true;
    }
    // The runner belongs to the main thread.
    if vm.worker_ref().is_some() {
        return false;
    }
    let Some(buntest_strong) = bun_test::clone_active_strong() else {
        return false;
    };
    let buntest = buntest_strong.get();
    if buntest.phase != bun_test::Phase::Execution
        || buntest.execution.active_group_ref().is_none()
    {
        return false;
    }
    let is_of_preload = |entry: &mut ExecutionEntry| entry.added_in_phase == AddedInPhase::Preload;
    // A group of one sequence, which most module loads run in, is answered here, ahead of the costlier lookup below.
    if let Some(entry) = buntest.get_current_state_data().entry(buntest) {
        return is_of_preload(entry);
    }
    match asks {
        Asks::Call => buntest
            .get_caller_state_data()
            .entry(buntest)
            .is_some_and(is_of_preload),
        Asks::ModuleLoad => false,
    }
}

/// Also true inside a hook that a preload registered, because a preload's `beforeAll` runs once for all test files.
/// In a concurrent group, only while the hook's callback is on the stack.
#[unsafe(no_mangle)]
extern "C" fn JSMock__isInPreload(global: &JSGlobalObject) -> bool {
    is_preload(global, Asks::Call)
}

/// `JSMock__isInPreload` for the code that books who loads a module. In a concurrent group, no hook owns a load.
#[unsafe(no_mangle)]
extern "C" fn JSMock__isModuleLoadOfPreload(global: &JSGlobalObject) -> bool {
    is_preload(global, Asks::ModuleLoad)
}
