#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

// `bun:python` (src/js/bun/python.ts)
JSC::JSValue createPythonNamespace(Zig::GlobalObject*);

// `import json from "python:json"`, `require("python:os.path")`: the name behind the prefix, or a null view.
WTF::StringView pythonModuleNameOfSpecifier(WTF::StringView specifier);
// The module that `import name` gives in Python, or an exception: Python's.
JSC::JSValue importPythonModule(Zig::GlobalObject*, WTF::StringView name, bool isRequire);

// Before anything that may start Python. (BunPythonStdlib.cpp)
void installPythonStandardLibrary();

// The same. The modules of the standard library that are written in C++ here. (python/BunPythonModules.cpp)
void registerPythonModules();

} // namespace Bun
