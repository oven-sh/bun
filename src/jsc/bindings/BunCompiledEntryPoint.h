#pragma once

#include "root.h"

namespace JSC {
class JSModuleLoader;
}

namespace Zig {
class GlobalObject;
}

namespace Bun {

// After the record of a compiled entry point has been evaluated: what the module `bun:main` does for an entry point that is not compiled.
void lookForServerInEntryPoint(Zig::GlobalObject*, JSC::JSModuleLoader*, JSC::JSValue moduleRecord);

} // namespace Bun
