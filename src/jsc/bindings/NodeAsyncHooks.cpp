#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/ArgList.h"

#include "NodeAsyncHooks.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksTimerDispatch, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto dispatch = callFrame->argument(0);
    if (auto* function = dispatch.getObject(); function && function->isCallable()) {
        global->m_asyncHooksTimerDispatch.set(vm, global, function);
    } else {
        global->m_asyncHooksTimerDispatch.clear();
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" void Bun__AsyncHooks__emitTimerLifecycle(
    JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedTimer, uint64_t asyncHooksId,
    AsyncHooksTimerLifecycleEvent event)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto* dispatch = global->m_asyncHooksTimerDispatch.get();
    if (!dispatch) [[likely]]
        return;

    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(static_cast<uint8_t>(event)));
    args.append(JSC::JSValue::decode(encodedTimer));
    args.append(JSC::jsNumber(static_cast<double>(asyncHooksId)));
    JSC::call(globalObject, dispatch, JSC::getCallData(dispatch), JSC::jsUndefined(), args);
    if (auto* exception = scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        Bun__reportUnhandledError(globalObject, JSC::JSValue::encode(exception));
    }
}

// This is called when AsyncLocalStorage is constructed.
JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    globalObject->setAsyncContextTrackingEnabled(callFrame->uncheckedArgument(0).toBoolean(globalObject));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
