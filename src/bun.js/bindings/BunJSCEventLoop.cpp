#include "root.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>

extern "C" int Bun__JSC_onBeforeWait(JSC::VM* vm)
{
    // TODO: use JSC timers, run the incremental sweeper.
    // That will fix this.
    // In the meantime, we're disabling this due to https://github.com/oven-sh/bun/issues/14982
    if (vm->heap.hasAccess()) {
        vm->heap.releaseAccess();
        return 1;
    }
    return 0;
}

extern "C" void Bun__JSC_onAfterWait(JSC::VM* vm)
{
    vm->heap.acquireAccess();
}
