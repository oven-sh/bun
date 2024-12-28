#include "root.h"
#include "BunReadableStreamDefaultControllerPrototype.h"
#include "BunReadableStreamDefaultController.h"
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamDefaultControllerPrototype::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultControllerPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->thisValue());
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.close called on incompatible object"_s);

    controller->close(globalObject);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeEnqueue, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->thisValue());
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.enqueue called on incompatible object"_s);

    JSValue chunk = callFrame->argument(0);
    return JSValue::encode(controller->enqueue(vm, globalObject, chunk));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeError, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->thisValue());
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.error called on incompatible object"_s);

    JSValue error = callFrame->argument(0);
    controller->error(globalObject, error);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamDefaultControllerPrototypeDesiredSizeGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(JSValue::decode(thisValue));
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.desiredSize called on incompatible object"_s);

    return JSValue::encode(controller->desiredSizeValue());
}

static const HashTableValue JSReadableStreamDefaultControllerPrototypeTableValues[] = {
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeClose, 0 } },
    { "enqueue"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeEnqueue, 1 } },
    { "error"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeError, 1 } },
    { "desiredSize"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsReadableStreamDefaultControllerPrototypeDesiredSizeGetter, nullptr } }
};

JSReadableStreamDefaultControllerPrototype* JSReadableStreamDefaultControllerPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    JSReadableStreamDefaultControllerPrototype* ptr = new (NotNull, allocateCell<JSReadableStreamDefaultControllerPrototype>(vm)) JSReadableStreamDefaultControllerPrototype(vm, structure);
    ptr->finishCreation(vm, globalObject);
    return ptr;
}

JSReadableStreamDefaultControllerPrototype::JSReadableStreamDefaultControllerPrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamDefaultControllerPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSReadableStreamDefaultControllerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

} // namespace Bun
