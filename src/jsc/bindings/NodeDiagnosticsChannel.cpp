#include "config.h"

#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// Called from node:diagnostics_channel when a subscriber is first added to any
// "tracing:module.*" channel. Flips a one-way de-opt flag so the native
// dynamic-import hook starts routing through the JS tracer.
JSC_DEFINE_HOST_FUNCTION(jsEnableModuleTracingSubscribers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    global->hasModuleTracingSubscribers = true;
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
