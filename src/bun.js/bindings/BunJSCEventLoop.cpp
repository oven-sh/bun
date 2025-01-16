#include "root.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>

extern "C" int Bun__JSC_onBeforeWait(JSC::VM* vm)
{
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
