use super::bun_test;
use bun_jsc::JSGlobalObject;

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
    bun_test::in_preload_hook(|_| true)
}
