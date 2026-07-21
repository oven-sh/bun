#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/ArgList.h"

#include "ZigGlobalObject.h"
#include "NodeAsyncHooks.h"

namespace Bun {

using namespace JSC;

// `cleanupLayer` is called by js if we set async context in a way we may not
// clear it, specifically within AsyncLocalStorage.prototype.enterWith.  this
// function will not clear the async context until the next tick's microtask,
// where it must inherit the context that scheduled that callback.
JSC_DEFINE_HOST_FUNCTION(jsCleanupLater, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 0);
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    global->asyncHooksNeedsCleanup = true;
    global->resetOnEachMicrotaskTick();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// This is called when AsyncLocalStorage is constructed.
JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    globalObject->setAsyncContextTrackingEnabled(callFrame->uncheckedArgument(0).toBoolean(globalObject));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// Called once, when internal/async_hooks_tick enables async id tracking.
// Installs the JS dispatch that receives native timer schedule/fire/clear
// events (see NodeTimers.cpp and NodeTimerObject.cpp).
JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksTimerDispatch, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    if (auto* dispatch = callFrame->uncheckedArgument(0).getObject()) {
        global->setAsyncHooksTimerDispatch(dispatch);
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

void emitAsyncHooksTimerEvent(Zig::GlobalObject* global, AsyncHooksTimerEvent event, JSC::JSValue timer)
{
    auto* dispatch = global->asyncHooksTimerDispatch();
    if (!dispatch) [[unlikely]]
        return;
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto callData = JSC::getCallData(dispatch);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]]
        return;
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(static_cast<int32_t>(event)));
    args.append(timer);
    JSC::profiledCall(global, JSC::ProfilingReason::API, dispatch, callData, JSC::jsUndefined(), args);
    // The JS dispatch treats throwing user hooks as fatal (print + exit(1));
    // anything still pending here is termination/OOM, left for the caller.
    scope.release();
}

}
