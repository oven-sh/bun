#include "root.h"
#include <JavaScriptCore/InitializeThreading.h>

// Takes the place of BunCompilers.cpp in bun-slim, the runtime for executables whose code was compiled ahead of time. Nothing in it
// refers to JavaScriptCore's compilers, so the linker drops them. It keeps the compiler of regular expressions, which is small: the
// build of a program has not seen the patterns that it puts together at run time.
extern "C" void Bun__installCompilers()
{
    JSC::installRegExpCompiler();
}

extern "C" bool Bun__AOT__hasCompiler()
{
    return false;
}
