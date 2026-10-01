#include "root.h"
#include <JavaScriptCore/InitializeThreading.h>

// The only reference to JavaScriptCore's compilers (the JIT tiers and the ahead-of-time compiler). It is a separate object file so
// that an executable can be linked without them: bun-slim has BunCompilersRegExpOnly.cpp in its place. See JSC::CompilerHooks, and
// where JSCInitialize() calls this.
// (Not a weak symbol that is left undefined: an ELF linker does not take an object out of an archive for a weak reference, so
// a build that links from an archive would silently have no JIT.)
extern "C" void Bun__installCompilers()
{
    JSC::installCompilers();
}

extern "C" bool Bun__AOT__hasCompiler()
{
    return true;
}
