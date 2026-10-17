#include "root.h"
#include <JavaScriptCore/InitializeThreading.h>

extern "C" void Bun__installCompilers()
{
    JSC::installRegExpCompiler();
}

extern "C" bool Bun__AOT__hasCompiler()
{
    return false;
}
