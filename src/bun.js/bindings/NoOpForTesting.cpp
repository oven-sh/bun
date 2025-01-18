

#include "root.h"

#include "JavaScriptCore/CustomGetterSetter.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSObject.h"
#include <JavaScriptCore/JSFunction.h>

namespace Bun {
using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(functionNoop, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionCallback, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSObject* callback = jsCast<JSObject*>(callFrame->uncheckedArgument(0));
    JSC::CallData callData = JSC::getCallData(callback);
    return JSC::JSValue::encode(JSC::profiledCall(globalObject, ProfilingReason::API, callback, callData, JSC::jsUndefined(), JSC::MarkedArgumentBuffer()));
}

JSC_DEFINE_CUSTOM_GETTER(noop_getter, (JSGlobalObject*, EncodedJSValue, PropertyName))
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(noop_setter,
    (JSC::JSGlobalObject*, JSC::EncodedJSValue,
        JSC::EncodedJSValue, JSC::PropertyName))
{
    return true;
}

JSC::JSObject* createNoOpForTesting(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    JSC::JSObject* object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, String("function"_s)), 0, functionNoop, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, String("callback"_s)), 0, functionCallback, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectCustomAccessor(vm, JSC::Identifier::fromString(vm, String("getterSetter"_s)), JSC::CustomGetterSetter::create(vm, noop_getter, noop_setter), 0);
    return object;
}

}
