#pragma once

#include "root.h"

#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace Bun {

// How many builtins this process loaded from an embedded bytecode cache instead of parsing.
// Exposed to `bun:internal-for-testing`.
BUN_DECLARE_HOST_FUNCTION(Bun__builtinModuleBytecodeDecodedCount);

// The bundled source of the JS builtin with this InternalModuleRegistry id: a view into the
// linked blob in release builds, the file under BUN_DYNAMIC_JS_LOAD_PATH in debug builds.
// Null for native modules. The runtime and the bytecode cache generator both read through
// here, so a build's cache entries are always keyed on the bytes that build parses.
WTF::String builtinModuleSource(unsigned moduleId);

// `(function (){ ... })` under the `builtin://` origin it is keyed on. The runtime and the
// generator share this so the SourceCodeKey cannot drift between them.
JSC::SourceCode builtinModuleSourceCode(const WTF::String& source, const WTF::String& moduleName, const WTF::String& urlString);

// Compiles a builtin in builtin parse mode, which is what lets the `@`-prefixed intrinsics
// through the lexer. The runtime's fallback path and the generator both use it.
JSC::UnlinkedFunctionExecutable* createBuiltinModuleExecutable(JSC::VM&, const JSC::SourceCode&, const WTF::String& moduleName);

// Decode the embedded bytecode cache entry for a builtin, if this executable carries one
// and it still matches the source. Null when there is nothing usable, in which case the
// caller compiles from source.
JSC::UnlinkedFunctionExecutable* decodeBuiltinModuleBytecode(JSC::JSGlobalObject*, JSC::VM&, const JSC::SourceCode&, const WTF::String& moduleName, unsigned moduleId);

} // namespace Bun
