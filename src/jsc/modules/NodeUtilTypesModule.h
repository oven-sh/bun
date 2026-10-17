#pragma once

#include "BunClientData.h"
#include "_NativeModule.h"

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsError,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDeepStrictEqual,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionPartialDeepStrictEqual,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsMapIterator,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSetIterator,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAsyncFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsGeneratorFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe));

namespace Zig {

// Hardcoded module "node:util/types"
DEFINE_NATIVE_MODULE_NOINLINE(NodeUtilTypes);

} // namespace Zig
