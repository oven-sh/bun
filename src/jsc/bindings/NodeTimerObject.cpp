
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

namespace Bun {
using namespace JSC;

static bool call(JSGlobalObject* globalObject, JSValue timerObject, JSValue callbackValue, JSValue argumentsValue, JSValue asyncContext)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue restoreAsyncContext {};
    JSC::InternalFieldTuple* asyncContextData = nullptr;

    if (!asyncContext.isUndefined()) {
        asyncContextData = globalObject->m_asyncContextData.get();
        restoreAsyncContext = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(vm, 0, asyncContext);
    }

    if (auto* promise = dynamicDowncast<JSPromise>(callbackValue)) {
        // This was a Bun.sleep() call
        promise->resolve(globalObject, vm, jsUndefined());
    } else {
        auto callData = JSC::getCallData(callbackValue);
        if (callData.type == CallData::Type::None) {
            Bun__reportUnhandledError(globalObject, JSValue::encode(createNotAFunctionError(globalObject, callbackValue)));
            if (asyncContextData) {
                asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
            }
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

    bool hadException = false;

    if (scope.exception()) [[unlikely]] {
        auto* exception = scope.exception();
        (void)scope.tryClearException();
        if (vm.isTerminationException(exception))
            Bun__VM__takeTerminationOutsideScript(globalObject);
        else
            Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
        hadException = true;
    }

    if (asyncContextData) {
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
    }

    return hadException;
}

// Returns true if an exception was thrown.
extern "C" bool Bun__JSTimeout__call(JSGlobalObject* globalObject, EncodedJSValue timerObject, EncodedJSValue callbackValue, EncodedJSValue argumentsValue, EncodedJSValue asyncContext)
{
    auto& vm = globalObject->vm();
    if (vm.hasPendingTerminationException() || WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]] {
        return true;
    }

    return call(globalObject, JSValue::decode(timerObject), JSValue::decode(callbackValue), JSValue::decode(argumentsValue), JSValue::decode(asyncContext));
}

}
