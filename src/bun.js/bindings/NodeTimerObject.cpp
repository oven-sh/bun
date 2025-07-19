
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
namespace Bun {
using namespace JSC;

static bool call(JSGlobalObject* globalObject, JSValue timerObject, JSValue callbackValue, JSValue argumentsValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_CATCH_SCOPE(vm);

    JSValue restoreAsyncContext {};
    JSC::InternalFieldTuple* asyncContextData = nullptr;

    if (auto* wrapper = jsDynamicCast<AsyncContextFrame*>(callbackValue)) {
        callbackValue = wrapper->callback.get();
        asyncContextData = globalObject->m_asyncContextData.get();
        restoreAsyncContext = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());
    }

    if (auto* promise = jsDynamicCast<JSPromise*>(callbackValue)) {
        // This was a Bun.sleep() call
        promise->resolve(globalObject, jsUndefined());
    } else {
        auto callData = JSC::getCallData(callbackValue);
        if (callData.type == CallData::Type::None) {
            Bun__reportUnhandledError(globalObject, JSValue::encode(createNotAFunctionError(globalObject, callbackValue)));
            return true;
        }

        MarkedArgumentBuffer args;
        if (auto* butterfly = jsDynamicCast<JSImmutableButterfly*>(argumentsValue)) {
            //  If it's a JSImmutableButterfly, there is more than 1 argument.
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

    bool hadException = false;

    if (scope.exception()) [[unlikely]] {
        auto* exception = scope.exception();
        scope.clearException();
        Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
        hadException = true;
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
    if (vm.hasPendingTerminationException()) [[unlikely]] {
        return true;
    }

    return call(globalObject, JSValue::decode(timerObject), JSValue::decode(callbackValue), JSValue::decode(argumentsValue));
}

}
