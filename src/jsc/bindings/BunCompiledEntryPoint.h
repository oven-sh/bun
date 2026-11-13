#pragma once

#include "root.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSString.h>

#if ENABLE(AOT)
#include <JavaScriptCore/AOTModuleHost.h>
#endif

extern "C" bool Bun__VM__shouldLookForServerBehindBunMain(void*);

namespace Bun {

// When the entry point has evaluated, the host looks at its exports for a server to start: `export default { fetch }`.
// An entry point that is not compiled is the one import of the module `bun:main`. moduleLoaderEvaluate() evaluates that module
// with evaluateEntryPointWrapper(), which then looks.
bool isRegisteredEntryPointWrapper(Zig::GlobalObject*, JSC::JSModuleLoader*, JSC::JSValue moduleRecord);
JSC::JSValue evaluateEntryPointWrapper(Zig::GlobalObject*, JSC::JSModuleLoader*, JSC::JSValue key, JSC::JSValue moduleRecord, RefPtr<JSC::ScriptFetcher>&&, JSC::JSValue sentValue, JSC::JSValue resumeMode);

ALWAYS_INLINE bool isEntryPointWrapper(Zig::GlobalObject* globalObject, JSC::JSModuleLoader* moduleLoader, JSC::JSValue key, JSC::JSValue moduleRecord)
{
    // Asked for every module that evaluates in front of the entry point: nearly all have a key of another length.
    return Bun__VM__shouldLookForServerBehindBunMain(globalObject->bunVM()) && key.isString() && asString(key)->length() == "bun:main"_s.length() && isRegisteredEntryPointWrapper(globalObject, moduleLoader, moduleRecord);
}

#if ENABLE(AOT)
// A compiled entry point has no `bun:main` above it. The compiled program asks for the same look with these.
bool isMainModuleImport(JSC::JSGlobalObject*, JSC::AOT::ModuleID);
void didEvaluateMainModule(JSC::JSGlobalObject*, JSC::AOT::ModuleID entryPoint);
#endif

} // namespace Bun
