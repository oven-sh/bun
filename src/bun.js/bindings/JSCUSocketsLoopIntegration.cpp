#include "root.h"
#include "JavaScriptCore/VM.h"

// On Linux, signals are used to suspend/resume threads in JavaScriptCore
// When `.acquireAccess` is called, the signal might be raised.
// This causes issues with LLDB which might catch the signal.
// So we want to avoid that, we really only want this code to be executed when the debugger is attached
// But it's pretty hard to tell if LLDB is attached or not, so we just disable this code on Linux when in debug mode
#ifndef ACQUIRE_RELEASE_HEAP_ACCESS
#if OS(DARWIN)
#define ACQUIRE_RELEASE_HEAP_ACCESS 1
#else
#ifndef BUN_DEBUG
#define ACQUIRE_RELEASE_HEAP_ACCESS 1
#endif
#endif
#endif

extern "C" void bun_on_tick_before(JSC::VM* vm)
{
#if ACQUIRE_RELEASE_HEAP_ACCESS
    // vm->heap.releaseAccess();
#endif
}
extern "C" void bun_on_tick_after(JSC::VM* vm)
{
#if ACQUIRE_RELEASE_HEAP_ACCESS
    // vm->heap.acquireAccess();
#endif
}