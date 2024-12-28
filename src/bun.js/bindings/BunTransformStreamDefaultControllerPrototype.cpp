#include "root.h"

#include <JavaScriptCore/Lookup.h>
#include "BunTransformStreamDefaultControllerPrototype.h"
#include "BunTransformStreamDefaultController.h"

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsTransformStreamDefaultControllerDesiredSize);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerEnqueue);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerError);
static JSC_DECLARE_HOST_FUNCTION(jsTransformStreamDefaultControllerTerminate);

static const JSC::HashTableValue JSTransformStreamDefaultControllerPrototypeTableValues[] = {
    { "enqueue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerEnqueue, 1 } },
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerError, 1 } },
    { "terminate"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerTerminate, 0 } },
    { "desiredSize"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamDefaultControllerDesiredSize, 0 } },
};

const JSC::ClassInfo JSTransformStreamDefaultControllerPrototype::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultControllerPrototype) };

JSTransformStreamDefaultControllerPrototype::JSTransformStreamDefaultControllerPrototype(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

JSTransformStreamDefaultControllerPrototype* JSTransformStreamDefaultControllerPrototype::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    structure->setMayBePrototype(true);
    JSTransformStreamDefaultControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSTransformStreamDefaultControllerPrototype>(vm))
        JSTransformStreamDefaultControllerPrototype(vm, structure);
    ptr->finishCreation(vm, globalObject);
    return ptr;
}

void JSTransformStreamDefaultControllerPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, info(), JSTransformStreamDefaultControllerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamDefaultControllerDesiredSize, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSTransformStreamDefaultController*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    // Return the desired size per spec
    return JSValue::encode(jsNumber(0)); // Placeholder
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerEnqueue, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* controller = jsDynamicCast<JSTransformStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    JSValue chunk = callFrame->argument(0);

    if (!controller->enqueue(globalObject, chunk))
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerError, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* controller = jsDynamicCast<JSTransformStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    controller->error(vm, globalObject, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerTerminate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* controller = jsDynamicCast<JSTransformStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    controller->terminate(globalObject);
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
