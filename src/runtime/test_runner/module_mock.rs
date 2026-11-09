use super::bun_test::{self, AddedInPhase};
use bun_jsc::JSGlobalObject;
use bun_jsc::virtual_machine::{TestOwner, VirtualMachine};

/// Also true inside a hook that a preload registered, because a preload's `beforeAll` runs once for all test files.
#[unsafe(no_mangle)]
extern "C" fn JSMock__isInPreload(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm();
    vm.is_in_preload() || is_in_hook_of_preload(vm)
}

/// `JSMock__isInPreload` for a caller that registers something for the test file, like a stub.
#[unsafe(no_mangle)]
extern "C" fn JSMock__registersForPreload(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm();
    match vm.test_owner {
        TestOwner::File => is_in_hook_of_preload(vm),
        TestOwner::Preload => true,
        TestOwner::FileThatRunsAgain => {
            let for_preload = is_in_hook_of_preload(vm);
            if !for_preload {
                note_registrant(global);
            }
            for_preload
        }
    }
}

fn is_in_hook_of_preload(vm: &VirtualMachine) -> bool {
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

/// Whether what the running code registers belongs to the whole run, because a preload is loading.
/// Otherwise it belongs to the test file, and the end of the file drops it.
///
/// Every place that registers something for a test file has to ask here. `--rerun-each` loads the
/// file again for each run and keeps what the file imports, so it learns here which of those
/// modules registered something and must be evaluated again.
#[inline]
pub(crate) fn registers_for_run(vm: &VirtualMachine) -> bool {
    match vm.test_owner {
        TestOwner::File => false,
        TestOwner::Preload => true,
        TestOwner::FileThatRunsAgain => {
            note_registrant(vm.global());
            false
        }
    }
}

/// Records the module whose top level is running, unless it is the test file.
/// `JSMock__replaceModuleOfTestFile` evicts it when the run ends.
#[cold]
#[inline(never)]
pub(crate) fn note_registrant(global: &JSGlobalObject) {
    bun_jsc::cpp::Bun__TestFile__noteRegistrant(global);
}

/// For a place that registers something for the test file and never asks whether a preload is loading.
#[inline]
pub(crate) fn did_register_for_file(vm: &VirtualMachine) {
    if vm.test_owner == TestOwner::FileThatRunsAgain {
        note_registrant(vm.global());
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__TestFile__didRegister(global: &JSGlobalObject) {
    did_register_for_file(global.bun_vm());
}
