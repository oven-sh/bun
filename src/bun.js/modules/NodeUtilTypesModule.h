#pragma once

#include "BunClientData.h"
#include "_NativeModule.h"

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsError,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionGetWeakMapEntries,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionGetWeakSetEntries,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

namespace Zig {

// Hardcoded module "node:util/types"
DEFINE_NATIVE_MODULE_NOINLINE(NodeUtilTypes);

} // namespace Zig
