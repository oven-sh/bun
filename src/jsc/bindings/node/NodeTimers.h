#pragma once

#include "root.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(functionSetTimeout);
JSC_DECLARE_HOST_FUNCTION(functionSetInterval);
JSC_DECLARE_HOST_FUNCTION(functionSetImmediate);
JSC_DECLARE_HOST_FUNCTION(functionClearTimeout);
JSC_DECLARE_HOST_FUNCTION(functionClearInterval);
JSC_DECLARE_HOST_FUNCTION(functionClearImmediate);

// Lazy property callbacks for the global object table: create setTimeout /
// setInterval / setImmediate with Node's `[util.promisify.custom]` accessor,
// which resolves to the node:timers/promises implementation on first read.
JSC::JSValue createSetTimeoutFunction(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue createSetIntervalFunction(JSC::VM&, JSC::JSObject* globalObject);
JSC::JSValue createSetImmediateFunction(JSC::VM&, JSC::JSObject* globalObject);

} // namespace Bun
