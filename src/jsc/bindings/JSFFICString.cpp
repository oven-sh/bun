#include "root.h"

#include "JSFFICString.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <cmath>

extern "C" JSC::EncodedJSValue Bun__FFI__CString__transcode(JSC::JSGlobalObject*, JSC::EncodedJSValue ptr, JSC::EncodedJSValue byteOffset, JSC::EncodedJSValue byteLength);

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(callFFICString);
static JSC_DECLARE_HOST_FUNCTION(constructFFICString);

const ClassInfo JSFFICStringConstructor::s_info = { "CString"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSFFICStringConstructor) };

JSFFICStringConstructor::JSFFICStringConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, callFFICString, constructFFICString)
{
}

JSFFICStringConstructor* JSFFICStringConstructor::create(VM& vm, JSGlobalObject* globalObject)
{
    auto* structure = createStructure(vm, globalObject, globalObject->functionPrototype());
    JSFFICStringConstructor* constructor = new (NotNull, allocateCell<JSFFICStringConstructor>(vm)) JSFFICStringConstructor(vm, structure);
    constructor->finishCreation(vm);
    return constructor;
}

void JSFFICStringConstructor::finishCreation(VM& vm)
{
    Base::finishCreation(vm, 3, "CString"_s, PropertyAdditionMode::WithoutStructureTransition);
}

JSC_DEFINE_HOST_FUNCTION(callFFICString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructFFICString(globalObject, callFrame);
}

static inline bool isSafeIntegerValue(JSValue value)
{
    if (value.isInt32())
        return true;
    if (!value.isDouble())
        return false;
    double number = value.asDouble();
    return std::isfinite(number) && std::trunc(number) == number && std::abs(number) <= maxSafeInteger();
}

JSC_DEFINE_HOST_FUNCTION(constructFFICString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue ptrValue = callFrame->argument(0);
    JSValue byteOffset = callFrame->argument(1);
    JSValue byteLength = callFrame->argument(2);

    bool hasPointer = ptrValue.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!hasPointer)
        return JSValue::encode(jsEmptyString(vm));

    JSValue offsetArgument = byteOffset.toBoolean(globalObject) ? byteOffset : jsNumber(0);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue lengthArgument = isSafeIntegerValue(byteLength) ? byteLength : jsUndefined();
    JSValue transcoded = JSValue::decode(Bun__FFI__CString__transcode(globalObject, JSValue::encode(ptrValue), JSValue::encode(offsetArgument), JSValue::encode(lengthArgument)));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(transcoded);
}

}

extern "C" JSC::EncodedJSValue Bun__FFI__CStringConstructor(JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(defaultGlobalObject(globalObject)->JSFFICStringConstructor());
}
