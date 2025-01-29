#include "root.h"

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/Heap.h>
#include "ZigGlobalObject.h"

extern "C" void WTFTimer__runIfImminent(void* bunVM);

extern "C" int Bun__JSC_onBeforeWait(JSC::VM* vm)
{
    if (vm->heap.hasAccess()) {
        WTFTimer__runIfImminent(Bun::vm(*vm));
        vm->heap.releaseAccess();
        return 1;
    }
    return 0;
}

extern "C" void Bun__JSC_onAfterWait(JSC::VM* vm)
{
    vm->heap.acquireAccess();
    WTFTimer__runIfImminent(Bun::vm(*vm));
}
