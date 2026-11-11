use super::bun_test::{self, AddedInPhase, ExecutionEntry};
use bun_jsc::{JSGlobalObject, JSValue, Strong};

/// Also true inside a hook that a preload registered, because a preload's `beforeAll` runs once for all test files.
#[unsafe(no_mangle)]
extern "C" fn JSMock__isInPreload(global: &JSGlobalObject) -> bool {
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
    buntest
        .get_current_state_data()
        .entry(buntest)
        .is_some_and(|entry| entry.added_in_phase == AddedInPhase::Preload)
}

/// The test or hook callback that the runner is calling, until that call returns: not while its microtasks drain.
/// Empty in a `describe()` body, in a Worker and outside `bun test`.
#[unsafe(no_mangle)]
extern "C" fn JSMock__callbackOnStack() -> JSValue {
    let Some(buntest_strong) = bun_test::clone_active_strong() else {
        return JSValue::ZERO;
    };
    let Some(on_stack) = buntest_strong.get().execution.on_stack.get() else {
        return JSValue::ZERO;
    };
    // SAFETY: arena-owned entry, alive for the lifetime of BunTest.
    let entry = unsafe { &*on_stack.entry.cast::<ExecutionEntry>() };
    entry.callback.as_ref().map_or(JSValue::ZERO, Strong::get)
}
