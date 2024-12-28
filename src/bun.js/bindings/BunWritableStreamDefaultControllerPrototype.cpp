#include "root.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>
#include "JSAbortController.h"

#include "BunWritableStreamDefaultControllerPrototype.h"
#include "BunWritableStreamDefaultController.h"
#include "JSAbortSignal.h"
#include "IDLTypes.h"
#include "DOMJITIDLType.h"
#include "JSDOMBinding.h"
#include "BunStreamInlines.h"
#include "ZigGlobalObject.h"
#include "BunWritableStream.h"
#include "AbortSignal.h"
namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultControllerErrorFunction, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultController* controller = jsDynamicCast<JSWritableStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller)) {
        scope.throwException(globalObject, createTypeError(globalObject, "WritableStreamDefaultController.prototype.error called on non-WritableStreamDefaultController"_s));
        return {};
    }

    return JSValue::encode(controller->error(globalObject, callFrame->argument(0)));
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultControllerGetSignal, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSWritableStreamDefaultController*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        scope.throwException(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStreamDefaultController.prototype.signal called on non-WritableStreamDefaultController"_s));
        return {};
    }

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto& abortSignal = thisObject->signal();

    return JSValue::encode(WebCore::toJS(lexicalGlobalObject, globalObject, abortSignal));
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultControllerGetDesiredSize, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSWritableStreamDefaultController*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        scope.throwException(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStreamDefaultController.prototype.desiredSize called on non-WritableStreamDefaultController"_s));
        return {};
    }

    switch (thisObject->stream()->state()) {
    case JSWritableStream::State::Errored:
        return JSValue::encode(jsNull());
    case JSWritableStream::State::Closed:
        return JSValue::encode(jsNumber(0));
    default:
        return JSValue::encode(jsNumber(thisObject->getDesiredSize()));
    }
}

static const HashTableValue JSWritableStreamDefaultControllerPrototypeTableValues[] = {
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultControllerErrorFunction, 1 } },
    { "signal"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultControllerGetSignal, 0 } },
    { "desiredSize"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultControllerGetDesiredSize, 0 } },
};

JSWritableStreamDefaultControllerPrototype* JSWritableStreamDefaultControllerPrototype::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSWritableStreamDefaultControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSWritableStreamDefaultControllerPrototype>(vm)) JSWritableStreamDefaultControllerPrototype(vm, structure);
    ptr->finishCreation(vm, globalObject);
    return ptr;
}

void JSWritableStreamDefaultControllerPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWritableStreamDefaultController::info(), JSWritableStreamDefaultControllerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const JSC::ClassInfo JSWritableStreamDefaultControllerPrototype::s_info = {
    "WritableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultControllerPrototype)
};

} // namespace Bun
