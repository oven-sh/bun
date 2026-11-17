// The C++ half of src/jsc/bindgen/callback.rs.
#include "root.h"
#include "AbortSignal.h"
#include "JSAbortAlgorithm.h"
#include "JSAbortSignal.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/NullGetterFunction.h>

namespace Bun::Bindgen {
using namespace JSC;
using WebCore::AbortSignal;

static AbortSignal& signalIn(EncodedJSValue signal)
{
    return uncheckedDowncast<WebCore::JSAbortSignal>(JSValue::decode(signal).asCell())->wrapped();
}

extern "C" void Bun__Bindgen__reactToPromise(JSGlobalObject* globalObject, EncodedJSValue promise, EncodedJSValue onFulfilled, EncodedJSValue onRejected)
{
    // Without a handler the result is passed on to a promise, and there is none.
    auto handler = [&](EncodedJSValue encoded) {
        JSValue given = JSValue::decode(encoded);
        return given.isUndefined() ? JSValue(globalObject->nullGetterFunction()) : given;
    };
    uncheckedDowncast<JSPromise>(JSValue::decode(promise).asCell())->performPromiseThenExported(getVM(globalObject), globalObject, handler(onFulfilled), handler(onRejected), jsUndefined());
}

extern "C" EncodedJSValue Bun__Bindgen__promiseResolve(JSGlobalObject* globalObject, EncodedJSValue value)
{
    return JSValue::encode(JSPromise::resolvedPromise(globalObject, JSValue::decode(value)));
}

extern "C" EncodedJSValue Bun__Bindgen__getCommonProperty(JSGlobalObject* globalObject, EncodedJSValue value, uint8_t property)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& names = *vm.propertyNames;
    const Identifier* properties[] = { &names.iteratorSymbol, &names.asyncIteratorSymbol, &names.next, &names.returnKeyword, &names.done, &names.value };
    JSValue result = JSValue::decode(value).get(globalObject, *properties[property]);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

extern "C" bool Bun__Bindgen__isSafeToRecurse(JSGlobalObject* globalObject)
{
    return getVM(globalObject).isSafeToRecurse();
}

extern "C" void Bun__Bindgen__detach(JSGlobalObject* globalObject, EncodedJSValue value)
{
    auto* buffer = dynamicDowncast<JSArrayBuffer>(JSValue::decode(value));
    if (buffer && buffer->impl()->isDetachable())
        buffer->impl()->detach(getVM(globalObject));
}

extern "C" void Bun__Bindgen__signalAbort(JSGlobalObject* globalObject, EncodedJSValue signal, EncodedJSValue reason)
{
    Ref protectedSignal { signalIn(signal) };
    if (JSValue::decode(reason).isUndefined())
        protectedSignal->signalAbort(globalObject, WebCore::CommonAbortReason::UserAbort);
    else
        protectedSignal->signalAbort(JSValue::decode(reason));
}

extern "C" uint32_t Bun__Bindgen__addAbortAlgorithm(EncodedJSValue signal, EncodedJSValue algorithm)
{
    JSObject* callback = asObject(JSValue::decode(algorithm));
    return AbortSignal::addAbortAlgorithmToSignal(signalIn(signal), WebCore::JSAbortAlgorithm::create(callback->vm(), callback));
}

extern "C" void Bun__Bindgen__removeAbortAlgorithm(EncodedJSValue signal, uint32_t id)
{
    AbortSignal::removeAbortAlgorithmFromSignal(signalIn(signal), id);
}

extern "C" EncodedJSValue Bun__Bindgen__createDependentSignal(JSGlobalObject* globalObject, const EncodedJSValue* sources, size_t count)
{
    auto* realm = defaultGlobalObject(globalObject);
    Vector<RefPtr<AbortSignal>> signals;
    for (auto source : unsafeMakeSpan(sources, count))
        signals.append(&signalIn(source));
    return JSValue::encode(WebCore::toJSNewlyCreated(globalObject, realm, AbortSignal::any(*realm->currentScriptExecutionContext(), signals)));
}

} // namespace Bun::Bindgen
