#include "root.h"
#include "BunClientData.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>

// It would be nicer to construct a DropAllLocks in us_loop_run_bun_tick (the only function that
// uses onBeforeWait and onAfterWait), but that code is in C. We use an optional as that lets us
// check whether it's initialized.
static thread_local std::optional<JSC::JSLock::DropAllLocks> drop_all_locks { std::nullopt };

extern "C" void WTFTimer__runIfImminent(void* bun_vm);

// Safe if VM is nullptr
extern "C" void Bun__JSC_onBeforeWait(JSC::VM* vm)
{
    ASSERT(!drop_all_locks.has_value());
    if (vm) {
        bool previouslyHadAccess = vm->heap.hasHeapAccess();
        drop_all_locks.emplace(*vm);
        if (previouslyHadAccess) {
            vm->heap.releaseAccess();
        }
    }
}

extern "C" void Bun__JSC_onAfterWait(JSC::VM* vm)
{
    if (vm) {
        vm->heap.acquireAccess();
        drop_all_locks.reset();
    }
}
