#include "root.h"
#include <JavaScriptCore/InitializeThreading.h>

extern "C" NEVER_INLINE void Bun__installCompilers()
{
    JSC::installCompilers();
}

extern "C" NEVER_INLINE bool Bun__AOT__hasCompiler()
{
#if ENABLE(AOT)
    uint32_t hasCompiler = 3;
#else
    uint32_t hasCompiler = 0;
#endif
    asm volatile("" : "+r"(hasCompiler));
    return hasCompiler;
}
