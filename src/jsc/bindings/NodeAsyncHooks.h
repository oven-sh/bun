#pragma once

#include "config.h"
#include "ZigGlobalObject.h"
#include <wtf/PlatformCallingConventions.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsCleanupLater);
JSC_DECLARE_HOST_FUNCTION(jsSetAsyncHooksEnabled);
JSC_DECLARE_HOST_FUNCTION(jsSetImmediateAsyncHooksEmitter);

// Event kinds forwarded to internal/async_hooks' setImmediate sink. Must stay
// in sync with the constants in src/js/internal/async_hooks.ts.
enum class ImmediateAsyncHook : unsigned {
    Init = 0,
    Before = 1,
    After = 2,
    Destroy = 3,
};

// No-op unless async_hooks tracking has been turned on.
void emitImmediateAsyncHook(JSC::JSGlobalObject*, JSC::JSValue timer, ImmediateAsyncHook);

}
