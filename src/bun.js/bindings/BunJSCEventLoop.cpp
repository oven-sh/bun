#include "root.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/IncrementalSweeper.h>
extern "C" int Bun__JSC_onBeforeWait(JSC::VM* vm)
{
    if (vm->heap.hasAccess()) {
        vm->heap.stopIfNecessary();
        vm->heap.releaseAccess();
        return 1;
    }
    return 0;
}

extern "C" void Bun__JSC_onAfterWait(JSC::VM* vm)
{
    (void)vm;
    vm->heap.acquireAccess();
}
