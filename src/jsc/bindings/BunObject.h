#pragma once

#include "root.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(functionBunPeek);
JSC_DECLARE_HOST_FUNCTION(functionBunPeekStatus);
JSC_DECLARE_HOST_FUNCTION(functionBunSleep);
JSC_DECLARE_HOST_FUNCTION(functionBunDeepEquals);
JSC_DECLARE_HOST_FUNCTION(functionBunDeepMatch);
JSC_DECLARE_HOST_FUNCTION(functionBunNanoseconds);
JSC_DECLARE_HOST_FUNCTION(functionPathToFileURL);
JSC_DECLARE_HOST_FUNCTION(functionFileURLToPath);

JSC::JSValue constructBunFetchObject(JSC::VM& vm, JSC::JSObject* bunObject);
JSC::JSObject* createBunObject(JSC::VM& vm, JSC::JSObject* globalObject);

// `Bun.concatArrayBuffers`: single-allocation concatenation of an array of
// ArrayBuffer/ArrayBufferView values; also used by the Web Streams consumers.
JSC::EncodedJSValue flattenArrayOfBuffersIntoArrayBufferOrUint8Array(JSC::JSGlobalObject*, JSC::JSValue arrayValue, size_t maxLength, bool asUint8Array);

JSC::JSObject* BunShell(JSC::JSGlobalObject* globalObject);
JSC::JSValue ShellError(JSC::JSGlobalObject* globalObject);

}
