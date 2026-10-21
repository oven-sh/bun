#pragma once

#include "root.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(functionSetTimeout);
JSC_DECLARE_HOST_FUNCTION(functionSetInterval);
JSC_DECLARE_HOST_FUNCTION(functionSetImmediate);
JSC_DECLARE_HOST_FUNCTION(functionClearTimeout);
JSC_DECLARE_HOST_FUNCTION(functionClearInterval);
JSC_DECLARE_HOST_FUNCTION(functionClearImmediate);

// setImmediate(callFrame->argument(first), ...the arguments after it), for a host function that
// takes a callback and its arguments after arguments of its own.
JSC::EncodedJSValue setImmediateFromCallFrame(JSC::JSGlobalObject*, JSC::CallFrame*, unsigned first);

// Lazy property callbacks for the global object table: create setTimeout /
// setInterval / setImmediate with Node's `[util.promisify.custom]` accessor,
// which resolves to the node:timers/promises implementation on first read.
JSC::JSValue createSetTimeoutFunction(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue createSetIntervalFunction(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue createSetImmediateFunction(JSC::VM&, JSC::JSObject* globalObject);

} // namespace Bun
