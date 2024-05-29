#include "root.h"

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

extern "C" void Bun__JSTimeout__call(JSC::EncodedJSValue encodedTimeoutValue, JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(vm.hasPendingTerminationException())) {
        return;
    }

    WebCore::JSTimeout* timeout = jsCast<WebCore::JSTimeout*>(JSC::JSValue::decode(encodedTimeoutValue));

    JSCell* callbackCell = timeout->m_callback.get().asCell();
    switch (callbackCell->type()) {
    case JSC::JSPromiseType: {
        // This was a Bun.sleep() call
        auto promise = jsCast<JSPromise*>(callbackCell);
        promise->resolve(globalObject, jsUndefined());
        break;
    }

    default: {
        MarkedArgumentBuffer args;
        if (timeout->m_arguments) {
            JSValue argumentsValue = timeout->m_arguments.get();
            auto* butterfly = jsDynamicCast<JSImmutableButterfly*>(argumentsValue);

            //  If it's a JSImmutableButterfly, there is more than 1 argument.
            if (butterfly) {
                unsigned length = butterfly->length();
                args.ensureCapacity(length);
                for (unsigned i = 0; i < length; ++i) {
                    args.append(butterfly->get(i));
                }
            } else {
                // Otherwise, it's a single argument.
                args.append(argumentsValue);
            }
        }

        AsyncContextFrame::call(globalObject, JSValue(callbackCell), JSValue(timeout), ArgList(args));
    }
    }

    if (UNLIKELY(scope.exception())) {
        auto* exception = scope.exception();
        scope.clearException();
        Bun__reportUnhandledError(globalObject, JSValue::encode(exception));
    }
}

}
