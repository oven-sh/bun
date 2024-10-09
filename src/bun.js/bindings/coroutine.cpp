#include "root.h"

// #include "mimalloc.h"
#include <JavaScriptCore/VM.h>

// #define MCO_API
// #define MCO_MALLOC mi_malloc
// #define MCO_FREE mi_free
// #define MCO_USE_ASM

// #define MINICORO_IMPL
// #include "minicoro.h"

typedef void* (*BunMacroFunction)();

// thread_local JSC::JSGlobalObject* globalObjectToUse;
// static void Bun__enterMacro(mco_coro* coro)
// {
//     JSC::VM& vm = globalObjectToUse->vm();
//     JSC::JSLockHolder lock(vm);
//     reinterpret_cast<BunMacroFunction>(coro->user_data)();
//     JSC::sanitizeStackForVM(vm);
//     mco_yield(coro);
// }

// TODO: figure out how to make coroutines work properly
// We tried using minicoro (https://github.com/edubart/minicoro)
// but it crashes when entering/exiting JavaScriptCore in "sanitizeStackForVMImpl"
// I don't want to block the release on this seldom-used feature of Bun
// we will just have stack overflow-risky macros for now.
extern "C" void Bun__startMacro(BunMacroFunction ctx, JSC::JSGlobalObject* globalObject)
{
    // globalObjectToUse = globalObject;
    // JSC::JSLockHolder lock(globalObject->vm());
    ctx();
    // mco_coro* co;
    // mco_desc desc = mco_desc_init(Bun__enterMacro, 1024 * 1024 * 2);
    // desc.user_data = ctx;
    // mco_result res = mco_create(&co, &desc);
    // mco_resume(co);
    // mco_destroy(co);
}
