#pragma once

#include "root.h"
#include <JavaScriptCore/SyntheticModuleRecord.h>
#include <Python.h>

namespace Bun::Python {

// Generate module source code for importing Python files as ES modules
// If isMainEntry is true, __name__ will be "__main__", otherwise it's derived from the filename
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generatePythonModuleSourceCode(JSC::JSGlobalObject* globalObject, const WTF::String& filePath, bool isMainEntry);

// Generate module source code for importing Python builtin modules (e.g., "python:pathlib")
JSC::SyntheticSourceProvider::SyntheticSourceGenerator
generatePythonBuiltinModuleSourceCode(JSC::JSGlobalObject* globalObject, const WTF::String& moduleName);

JSC::JSValue toJS(JSC::JSGlobalObject* globalObject, PyObject* value);
PyObject* fromJS(JSC::JSGlobalObject* globalObject, JSC::JSValue value);

// Ensure Python is initialized
void ensurePythonInitialized();

} // namespace Bun::Python
