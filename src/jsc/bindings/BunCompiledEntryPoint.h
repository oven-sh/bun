#pragma once

#include "root.h"

#if ENABLE(AOT)

#include <JavaScriptCore/AOTModuleHost.h>

namespace Bun {

// An entry point that is not compiled is the one import of the module `bun:main`. These stand for that module above a compiled one.
bool isImportOfMainModule(JSC::JSGlobalObject*, JSC::AOT::ModuleID);
void runMainModule(JSC::JSGlobalObject*, JSC::AOT::ModuleID entryPoint);

} // namespace Bun

#endif // ENABLE(AOT)
