#pragma once

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(functionBunPeek);
JSC_DECLARE_HOST_FUNCTION(functionBunPeekStatus);
JSC_DECLARE_HOST_FUNCTION(functionBunSleep);
JSC_DECLARE_HOST_FUNCTION(functionBunSleepThenCallback);
JSC_DECLARE_HOST_FUNCTION(functionBunEscapeHTML);
JSC_DECLARE_HOST_FUNCTION(functionBunDeepEquals);
JSC_DECLARE_HOST_FUNCTION(functionBunDeepMatch);
JSC_DECLARE_HOST_FUNCTION(functionBunNanoseconds);
JSC_DECLARE_HOST_FUNCTION(functionPathToFileURL);
JSC_DECLARE_HOST_FUNCTION(functionFileURLToPath);

JSC::JSValue createBunObject(Zig::GlobalObject* globalObject);
}
