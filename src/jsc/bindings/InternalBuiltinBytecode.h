#pragma once

#include "root.h"
#include <JavaScriptCore/UnlinkedFunctionExecutable.h>

namespace Bun {

// Precompiled JSC bytecode for the builtin JS modules (src/js), embedded at
// build time by scripts/build (release, host==target, POSIX). At load time
// InternalModuleRegistry decodes a module's top-level UnlinkedFunctionExecutable
// from this blob instead of parsing its source; any mismatch falls back to the
// source path.
namespace BuiltinBytecode {

// Called once at startup when BUN_GENERATE_BUILTIN_BYTECODE=<path> is set: the
// build runs the just-linked binary with this env var to produce the blob that
// is then embedded into the final link. Writes the blob and exits the process.
void generateBlobAndExit(JSC::JSGlobalObject*, JSC::VM&, const char* path);

// nullptr when there is no embedded blob, the module has no entry, or the
// entry does not decode against `source` (source/version/codegen-mode mismatch).
JSC::UnlinkedFunctionExecutable* tryDecode(JSC::JSGlobalObject*, JSC::VM&, const JSC::SourceCode&, const WTF::String& moduleName, unsigned moduleIndex);

struct Stats {
    bool available;
    unsigned hits;
    unsigned misses;
};
Stats stats();

} // namespace BuiltinBytecode

JSC_DECLARE_HOST_FUNCTION(jsBuiltinBytecodeCacheStats);
} // namespace Bun
