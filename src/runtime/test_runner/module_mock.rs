use super::bun_test::{self, AddedInPhase};
use bun_jsc::JSGlobalObject;

/// Also true inside a hook that a preload registered, because a preload's `beforeAll` runs once for all test files.
#[unsafe(no_mangle)]
extern "C" fn JSMock__isInPreload(global: &JSGlobalObject) -> bool {
    if global.bun_vm().is_in_preload.get() {
        return true;
    }
    let Some(buntest) = bun_test::clone_active_strong() else {
        return false;
    };
    if buntest.phase.get() != bun_test::Phase::Execution
        || buntest.execution.active_group().is_none()
    {
        return false;
    }
    buntest
        .get_current_state_data()
        .entry(&buntest)
        .is_some_and(|entry| buntest.entry_of(entry).added_in_phase == AddedInPhase::Preload)
}
