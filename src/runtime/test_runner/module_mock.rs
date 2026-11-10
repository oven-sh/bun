use super::bun_test::{self, AddedInPhase};
use bun_core::strings;
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

/// A file that the run was asked for, or that has had its turn. Its body registers tests, so an import must not evaluate it again.
/// False in a Worker, which has no runner.
#[unsafe(no_mangle)]
extern "C" fn JSMock__isTestFile(key: &bun_core::String) -> bool {
    let Some(runner) = super::jest::Jest::runner() else {
        return false;
    };
    if let Some(path) = key.as_utf8() {
        return runner.is_test_file(path);
    }
    // Not ASCII. A path that the runner resolved fits in a path buffer.
    let mut buf = bun_paths::path_buffer_pool::get();
    let encoded = if key.is_utf16() {
        strings::copy_utf16_into_utf8(&mut buf[..], key.utf16())
    } else {
        strings::copy_latin1_into_utf8(&mut buf[..], key.latin1())
    };
    encoded.read == key.length() && runner.is_test_file(&buf[..encoded.written])
}
