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

JSC_DECLARE_HOST_FUNCTION(jsFunctionIsExternal);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsDate);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsArgumentsObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsBigIntObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsBooleanObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsNumberObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsStringObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsSymbolObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsNativeError);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsRegExp);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsAsyncFunction);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsGeneratorFunction);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsGeneratorObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsPromise);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsMap);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsSet);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsWeakMap);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsWeakSet);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsArrayBuffer);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsDataView);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsSharedArrayBuffer);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsProxy);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsModuleNamespaceObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsAnyArrayBuffer);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsBoxedPrimitive);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsArrayBufferView);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsTypedArray);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsUint8Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsUint8ClampedArray);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsUint16Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsUint32Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsInt8Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsInt16Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsInt32Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsFloat16Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsFloat32Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsFloat64Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsBigInt64Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsBigUint64Array);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsKeyObject);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsCryptoKey);
JSC_DECLARE_HOST_FUNCTION(jsFunctionIsEventTarget);

namespace Zig {

// Hardcoded module "node:util/types"
DEFINE_NATIVE_MODULE_NOINLINE(NodeUtilTypes);

} // namespace Zig
