#include "root.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/IncrementalSweeper.h>

extern "C" int Bun__JSC_onBeforeWaitWithTimer(JSC::VM* vm, int hasTimer)
{
    if (vm->heap.hasAccess()) {
        if (hasTimer) {
            // TODO: this should pass the deadline based on the timeout passed to the event loop code.
            // So if you have a setTimeout() call thats happening in 2ms, we should never delay 2ms.
            // Also, all of the JSRunLoopTimer code should be using our TimerHeap from Zig.
            vm->heap.sweeper().doWork(*vm);
        }

        vm->heap.releaseAccess();
        return 1;
    }
    return 0;
}

extern "C" int Bun__JSC_onBeforeWait(JSC::VM* vm)
{
    return Bun__JSC_onBeforeWaitWithTimer(vm, 0);
}

extern "C" void Bun__JSC_onAfterWait(JSC::VM* vm)
{

    vm->heap.acquireAccess();
}
