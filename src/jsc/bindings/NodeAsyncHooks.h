#include "config.h"
#include "ZigGlobalObject.h"
#include <wtf/PlatformCallingConventions.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsSetAsyncHooksEnabled);
JSC_DECLARE_HOST_FUNCTION(jsSetAsyncHooksTimerDispatch);

enum class AsyncHooksTimerLifecycleEvent : uint8_t {
    TimeoutInit = 0,
    ImmediateInit = 1,
    Destroy = 2,
};

extern "C" void Bun__AsyncHooks__emitTimerLifecycle(
    JSC::JSGlobalObject*, JSC::EncodedJSValue timer, uint64_t asyncHooksId,
    AsyncHooksTimerLifecycleEvent event);

}
