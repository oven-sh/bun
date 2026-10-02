#include "V8Template.h"
#include "V8Name.h"
#include "V8Value.h"
#include "shim/FunctionTemplate.h"
#include "shim/ObjectTemplate.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Template)

ASSERT_V8_ENUM_MATCHES(PropertyAttribute, None)
ASSERT_V8_ENUM_MATCHES(PropertyAttribute, ReadOnly)
ASSERT_V8_ENUM_MATCHES(PropertyAttribute, DontEnum)
ASSERT_V8_ENUM_MATCHES(PropertyAttribute, DontDelete)

namespace v8 {

JSC::EncodedJSValue Template::DummyCallback(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    ASSERT_NOT_REACHED();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

void Template::Set(Local<Name> name, Local<Data> value, PropertyAttribute attributes)
{
    JSC::JSCell* cell = localToCell();
    auto& vm = cell->vm();
    JSC::JSValue jsName = name->localToJSValue();
    JSC::JSValue jsValue = value->localToJSValue();

    if (auto* ot = dynamicDowncast<shim::ObjectTemplate>(cell)) {
        ot->addProperty(vm, jsName, jsValue, static_cast<unsigned>(attributes));
        return;
    }
    if (auto* ft = dynamicDowncast<shim::FunctionTemplate>(cell)) {
        ft->addProperty(vm, jsName, jsValue, static_cast<unsigned>(attributes));
        return;
    }
    RELEASE_ASSERT_NOT_REACHED("Template::Set called on unknown template type");
}

void Template::SetNativeDataProperty(
    Local<Name> name,
    AccessorNameGetterCallback getter,
    AccessorNameSetterCallback setter,
    Local<Value> data,
    PropertyAttribute attribute,
    SideEffectType,
    SideEffectType)
{
    JSC::JSCell* cell = localToCell();
    auto& vm = cell->vm();
    JSC::JSValue jsName = name->localToJSValue();
    JSC::JSValue jsData = data.IsEmpty() ? JSC::jsUndefined() : data->localToJSValue();

    if (auto* ot = dynamicDowncast<shim::ObjectTemplate>(cell)) {
        ot->addAccessor(vm, jsName, getter, setter, jsData, static_cast<unsigned>(attribute));
        return;
    }
    if (auto* ft = dynamicDowncast<shim::FunctionTemplate>(cell)) {
        ft->addAccessor(vm, jsName, getter, setter, jsData, static_cast<unsigned>(attribute));
        return;
    }
    RELEASE_ASSERT_NOT_REACHED("Template::SetNativeDataProperty called on unknown template type");
}

} // namespace v8
