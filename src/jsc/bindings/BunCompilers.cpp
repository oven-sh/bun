#include "root.h"
#include <JavaScriptCore/InitializeThreading.h>

extern "C" void Bun__installCompilers()
{
    JSC::installCompilers();
}

extern "C" bool Bun__AOT__hasCompiler()
{
#if ENABLE(AOT)
    return true;
#else
    return false;
#endif
}
