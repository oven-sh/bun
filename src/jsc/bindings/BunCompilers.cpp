#include "root.h"
#include <JavaScriptCore/InitializeThreading.h>

extern "C" NEVER_INLINE void Bun__installCompilers()
{
    JSC::installCompilers();
}

extern "C" NEVER_INLINE bool Bun__AOT__hasCompiler()
{
#if ENABLE(AOT)
    bool hasCompiler = true;
#else
    bool hasCompiler = false;
#endif
#if !OS(WINDOWS)
    asm volatile("" : "+r"(hasCompiler));
#endif
    return hasCompiler;
}
