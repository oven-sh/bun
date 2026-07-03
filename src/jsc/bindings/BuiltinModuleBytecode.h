#pragma once

#include "root.h"

#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace Bun {

// How many builtins this process loaded from an embedded bytecode cache instead of parsing.
// Exposed to `bun:internal-for-testing`.
BUN_DECLARE_HOST_FUNCTION(Bun__builtinModuleBytecodeDecodedCount);

// The canonical specifier for a JS builtin, e.g. "node:net". Null for native modules.
WTF::String builtinModuleName(unsigned moduleId);

// The bundled source of a JS builtin. Debug builds read it off disk so that editing
// `src/js` does not require relinking; release builds return the baked-in literal. Null for
// native modules and out-of-range ids.
WTF::String builtinModuleSource(unsigned moduleId);

// `(function (){ ... })` with the `builtin://` origin the bytecode cache is keyed on. The
// runtime and the cache generator both go through here, so the SourceCodeKey cannot drift
// between them.
JSC::SourceCode builtinModuleSourceCode(JSC::VM&, unsigned moduleId, const WTF::String& source);

// Compiles a builtin in builtin parse mode, which is what lets the `@`-prefixed intrinsics
// through the lexer. Both the runtime's fallback path and the cache generator use it.
JSC::UnlinkedFunctionExecutable* createBuiltinModuleExecutable(JSC::VM&, const JSC::SourceCode&, const WTF::String& moduleName);

// Decode the embedded bytecode cache entry for a builtin, if the standalone executable
// carries one and it still matches this binary's source. Null when there is nothing usable,
// in which case the caller compiles from source.
JSC::UnlinkedFunctionExecutable* decodeBuiltinModuleBytecode(JSC::JSGlobalObject*, JSC::VM&, const JSC::SourceCode&, const WTF::String& moduleName, unsigned moduleId);

} // namespace Bun
