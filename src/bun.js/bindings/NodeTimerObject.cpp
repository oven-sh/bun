
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

extern "C" void Bun__FakeTimers__trackPromise(JSGlobalObject*, EncodedJSValue);

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

    JSValue result = jsUndefined();

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
        if (auto* butterfly = jsDynamicCast<JSCellButterfly*>(argumentsValue)) {
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

        result = JSC::profiledCall(globalObject, ProfilingReason::API, callbackValue, callData, timerObject, args);
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

    // Track promise returns for fake timers async methods
    if (!hadException && result && result.isObject()) {
        auto* resultObject = result.getObject();
        if (resultObject && (jsDynamicCast<JSPromise*>(resultObject) || resultObject->isCallable())) {
            // Check if it has a 'then' method (thenable)
            auto thenValue = resultObject->get(globalObject, vm.propertyNames->then);
            if (thenValue.isCallable()) {
                Bun__FakeTimers__trackPromise(globalObject, JSValue::encode(result));
            }
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

// Helper to create Promise.all() for fake timers async methods
extern "C" EncodedJSValue Bun__FakeTimers__createPromiseAll(JSGlobalObject* globalObject, EncodedJSValue promisesArray, EncodedJSValue vitestObj)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    JSValue array = JSValue::decode(promisesArray);
    JSValue vitest = JSValue::decode(vitestObj);

    // Get Promise.all
    JSValue promiseConstructor = globalObject->promiseConstructor();
    JSValue promiseAll = promiseConstructor.get(globalObject, vm.propertyNames->all);

    if (scope.exception()) [[unlikely]] {
        scope.clearException();
        return JSValue::encode(jsUndefined());
    }

    // Call Promise.all(promisesArray)
    auto callData = JSC::getCallData(promiseAll);
    if (callData.type == CallData::Type::None) {
        return JSValue::encode(jsUndefined());
    }

    MarkedArgumentBuffer args;
    args.append(array);
    JSValue allPromise = JSC::call(globalObject, promiseAll, callData, promiseConstructor, args);

    if (scope.exception()) [[unlikely]] {
        scope.clearException();
        return JSValue::encode(jsUndefined());
    }

    // Chain .then(() => vitestObj)
    JSValue thenMethod = allPromise.get(globalObject, vm.propertyNames->then);
    if (scope.exception() || !thenMethod.isCallable()) [[unlikely]] {
        scope.clearException();
        return JSValue::encode(allPromise);
    }

    // Create a function that returns the vitest object
    auto returnVitestFn = JSFunction::create(vm, globalObject, 0, String(), [vitest](JSGlobalObject*, CallFrame*) -> EncodedJSValue {
        return JSValue::encode(vitest);
    });

    MarkedArgumentBuffer thenArgs;
    thenArgs.append(returnVitestFn);
    auto thenCallData = JSC::getCallData(thenMethod);
    JSValue result = JSC::call(globalObject, thenMethod, thenCallData, allPromise, thenArgs);

    if (scope.exception()) [[unlikely]] {
        scope.clearException();
        return JSValue::encode(allPromise);
    }

    return JSValue::encode(result);
}

}
