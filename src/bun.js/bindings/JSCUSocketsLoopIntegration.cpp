#include "root.h"
#include "JavaScriptCore/VM.h"

extern "C" void bun_on_tick_before(JSC::VM* vm)
{
    // Let the GC do some work while we are idle
    vm->heap.releaseAccess();
}
extern "C" void bun_on_tick_after(JSC::VM* vm)
{
    vm->heap.acquireAccess();
}