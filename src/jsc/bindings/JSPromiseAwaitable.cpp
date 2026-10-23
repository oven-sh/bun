#include "root.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSPromisePrototype.h>

// Spec PromiseResolve(%Promise%, value): what `await value` waits on. undefined: nothing to wait on.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSC__JSPromise__awaitable(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, bool adoptThenables)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSObject* object = JSC::JSValue::decode(encodedValue).getObject();
    if (!object)
        return JSC::JSValue::encode(JSC::jsUndefined());
    auto* promise = dynamicDowncast<JSC::JSPromise>(object);
    if (promise) {
        // The fast path of PromiseResolve, without the call.
        if (promise->realm() == globalObject && JSC::promiseSpeciesWatchpointIsValid(vm, promise)) [[likely]]
            return encodedValue;
    } else if (!adoptThenables || JSC::isDefinitelyNonThenable(object, globalObject))
        return JSC::JSValue::encode(JSC::jsUndefined());

    JSC::JSPromise* awaited = JSC::JSPromise::resolvedPromise(globalObject, object);
    RETURN_IF_EXCEPTION(scope, {});
    if (awaited == object)
        return JSC::JSValue::encode(awaited);
    // The caller observes the adopter; a `then` getter that threw already rejected it.
    awaited->markAsHandled();
    // `then` is not callable: the object is not a thenable.
    if (!promise && awaited->status() == JSC::JSPromise::Status::Fulfilled)
        return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(awaited);
}
