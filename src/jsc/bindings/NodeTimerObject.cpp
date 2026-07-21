
#include "root.h"

#include "JavaScriptCore/InternalFieldTuple.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/Heap.h"
#include "ZigGlobalObject.h"

#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "JavaScriptCore/JSCJSValue.h"
#include "AsyncContextFrame.h"
#include "NodeAsyncHooks.h"
namespace Bun {
using namespace JSC;

static bool call(JSGlobalObject* globalObject, JSValue timerObject, JSValue callbackValue, JSValue argumentsValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // async_hooks: before/after events + execution async ids around the fire.
    // One flag load + branch when async_hooks id tracking was never enabled.
    auto* zigGlobal = defaultGlobalObject(globalObject);
    bool timerHooks = zigGlobal->asyncHooksTimerHooksEnabled;
    if (timerHooks) [[unlikely]] {
        emitAsyncHooksTimerEvent(zigGlobal, AsyncHooksTimerEvent::Before, timerObject);
        if (auto* exception = scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
            return true;
        }
    }

    JSValue restoreAsyncContext {};
    JSC::InternalFieldTuple* asyncContextData = nullptr;

    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(callbackValue)) {
        callbackValue = wrapper->callback.get();
        asyncContextData = globalObject->m_asyncContextData.get();
        restoreAsyncContext = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());
    }

    bool hadException = false;

    if (auto* promise = dynamicDowncast<JSPromise>(callbackValue)) {
        // This was a Bun.sleep() call
        promise->resolve(globalObject, vm, jsUndefined());
    } else {
        auto callData = JSC::getCallData(callbackValue);
        if (callData.type == CallData::Type::None) {
            // No early return: the async-context restore and the After emit
            // below must still run.
            Bun__reportUnhandledError(globalObject, JSValue::encode(createNotAFunctionError(globalObject, callbackValue)));
            hadException = true;
        } else {
            MarkedArgumentBuffer args;
            if (auto* butterfly = dynamicDowncast<JSCellButterfly>(argumentsValue)) {
                //  If it's a JSCellButterfly, there is more than 1 argument.
                unsigned length = butterfly->length();
                args.ensureCapacity(length);
                for (unsigned i = 0; i < length; ++i) {
                    args.append(butterfly->get(i));
                }
            } else if (!argumentsValue.isUndefined()) {
                // Otherwise, it's a single argument.
                args.append(argumentsValue);
            }

            JSC::profiledCall(globalObject, ProfilingReason::API, callbackValue, callData, timerObject, args);
        }
    }

    if (scope.exception()) [[unlikely]] {
        auto* exception = scope.exception();
        (void)scope.tryClearException();
        Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
        hadException = true;
    }

    if (asyncContextData) {
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
    }

    // Emitted after the unhandled-error report so an uncaughtException handler
    // still observes the timer's execution async id (node parity).
    if (timerHooks) [[unlikely]] {
        emitAsyncHooksTimerEvent(zigGlobal, AsyncHooksTimerEvent::After, timerObject);
        if (auto* exception = scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
            hadException = true;
        }
    }

    return hadException;
}

// Returns true if an exception was thrown.
extern "C" bool Bun__JSTimeout__call(JSGlobalObject* globalObject, EncodedJSValue timerObject, EncodedJSValue callbackValue, EncodedJSValue argumentsValue)
{
    auto& vm = globalObject->vm();
    if (vm.hasPendingTerminationException()) [[unlikely]] {
        return true;
    }

    return call(globalObject, JSValue::decode(timerObject), JSValue::decode(callbackValue), JSValue::decode(argumentsValue));
}

}
