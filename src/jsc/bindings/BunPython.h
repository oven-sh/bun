#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

// `bun:python` (src/js/bun/python.ts)
JSC::JSValue createPythonNamespace(Zig::GlobalObject*);

// Before anything that may start Python. (BunPythonStdlib.cpp)
void installPythonStandardLibrary();

// The same. The modules of the standard library that are written in C++ here. (python/BunPythonModules.cpp)
void registerPythonModules();

} // namespace Bun
