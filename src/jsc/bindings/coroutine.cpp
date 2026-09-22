#include "root.h"

#include <JavaScriptCore/VM.h>

typedef void* (*BunMacroFunction)();

// TODO: figure out how to make coroutines work properly
// We tried using minicoro (https://github.com/edubart/minicoro)
// but it crashes when entering/exiting JavaScriptCore in "sanitizeStackForVMImpl"
// I don't want to block the release on this seldom-used feature of Bun
// we will just have stack overflow-risky macros for now.
extern "C" void Bun__startMacro(BunMacroFunction ctx, JSC::JSGlobalObject* globalObject)
{
    ctx();
}
