#pragma once

#include "config.h"
#include "ZigGlobalObject.h"
#include <wtf/PlatformCallingConventions.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsCleanupLater);
JSC_DECLARE_HOST_FUNCTION(jsSetAsyncHooksEnabled);
JSC_DECLARE_HOST_FUNCTION(jsSetAsyncHooksTimerDispatch);

// Native timer lifecycle events forwarded to internal/async_hooks_tick's
// timerHookDispatch (installed via jsSetAsyncHooksTimerDispatch). Values must
// stay in sync with the JS switch.
enum class AsyncHooksTimerEvent : int32_t {
    InitImmediate = 1,
    InitTimeout = 2,
    InitInterval = 3,
    Before = 4,
    After = 5,
    Cleared = 6,
};

// Callers must have checked `global->asyncHooksTimerHooksEnabled` first.
// May leave a pending exception (termination); callers must check the scope.
void emitAsyncHooksTimerEvent(Zig::GlobalObject* global, AsyncHooksTimerEvent event, JSC::JSValue timer);

}
