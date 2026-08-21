
#include "root.h"

#include "JavaScriptCore/InternalFieldTuple.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/Heap.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"

#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "JavaScriptCore/JSCJSValue.h"
#include "AsyncContextFrame.h"
#include "NodeAsyncHooks.h"

namespace Bun {
using namespace JSC;

enum class PendingException : uint8_t {
    None,
    // Handed to the unhandled error path; JS may be entered again.
    Reported,
    // A termination, handed to the VM's stop path; nothing may enter JS again.
    Terminated,
};

template<typename Scope>
static PendingException takePendingException(JSGlobalObject* globalObject, VM& vm, Scope& scope)
{
    auto* exception = scope.exception();
    if (!exception) [[likely]] {
        return PendingException::None;
    }
    (void)scope.tryClearException();
    if (vm.isTerminationException(exception)) {
        Bun__VM__takeTerminationOutsideScript(globalObject);
        return PendingException::Terminated;
    }
    Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
    return PendingException::Reported;
}

static bool call(JSGlobalObject* globalObject, JSValue timerObject, JSValue callbackValue, JSValue argumentsValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    emitImmediateAsyncHook(globalObject, timerObject, ImmediateAsyncHook::Before);
    if (takePendingException(globalObject, vm, scope) != PendingException::None) [[unlikely]] {
        return true;
    }

    JSValue restoreAsyncContext {};
    JSC::InternalFieldTuple* asyncContextData = nullptr;

    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(callbackValue)) {
        callbackValue = wrapper->callback.get();
        asyncContextData = globalObject->m_asyncContextData.get();
        restoreAsyncContext = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());
    }

    if (auto* promise = dynamicDowncast<JSPromise>(callbackValue)) {
        // This was a Bun.sleep() call
        promise->resolve(globalObject, vm, jsUndefined());
    } else {
        auto callData = JSC::getCallData(callbackValue);
        if (callData.type == CallData::Type::None) {
            Bun__reportUnhandledError(globalObject, JSValue::encode(createNotAFunctionError(globalObject, callbackValue)));
            return true;
        }

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

    auto pending = takePendingException(globalObject, vm, scope);
    bool hadException = pending != PendingException::None;

    // Take any pending exception between the two: entering JS again with one
    // still set is illegal, and after a termination nothing may enter JS at all.
    if (pending != PendingException::Terminated) {
        emitImmediateAsyncHook(globalObject, timerObject, ImmediateAsyncHook::After);
        pending = takePendingException(globalObject, vm, scope);
        hadException |= pending != PendingException::None;
    }
    if (pending != PendingException::Terminated) {
        emitImmediateAsyncHook(globalObject, timerObject, ImmediateAsyncHook::Destroy);
        hadException |= takePendingException(globalObject, vm, scope) != PendingException::None;
    }

    if (asyncContextData) {
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
    }

    return hadException;
}

// Returns true if an exception was thrown.
extern "C" bool Bun__JSTimeout__call(JSGlobalObject* globalObject, EncodedJSValue timerObject, EncodedJSValue callbackValue, EncodedJSValue argumentsValue)
{
    auto& vm = globalObject->vm();
    if (vm.hasPendingTerminationException() || WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]] {
        return true;
    }

    return call(globalObject, JSValue::decode(timerObject), JSValue::decode(callbackValue), JSValue::decode(argumentsValue));
}

}
