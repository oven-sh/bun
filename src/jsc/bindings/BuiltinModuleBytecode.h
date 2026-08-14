#pragma once

#include "root.h"

#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace Bun {

// Number of builtins this process loaded from an embedded bytecode cache instead of parsing.
BUN_DECLARE_HOST_FUNCTION(Bun__builtinModuleBytecodeDecodedCount);

// InternalModuleRegistry (the runtime) and Bun__generateBuiltinModuleBytecode (the
// `--compile --bytecode` generator) both compile builtins through the three functions
// below. That is what keeps the SourceCodeKey an entry was written under identical to the
// one it is looked up with.

// Null for native modules.
WTF::String builtinModuleSource(unsigned moduleId);

JSC::SourceCode builtinModuleSourceCode(const WTF::String& source, const WTF::String& moduleName, const WTF::String& urlString);

// Builtin parse mode: the only mode whose lexer accepts the `@`-prefixed intrinsics.
JSC::UnlinkedFunctionExecutable* createBuiltinModuleExecutable(JSC::VM&, const JSC::SourceCode&, const WTF::String& moduleName);

// Null unless this executable embeds an entry for the builtin and it still matches `source`.
JSC::UnlinkedFunctionExecutable* decodeBuiltinModuleBytecode(JSC::JSGlobalObject*, JSC::VM&, const JSC::SourceCode&, const WTF::String& moduleName, unsigned moduleId);

} // namespace Bun
