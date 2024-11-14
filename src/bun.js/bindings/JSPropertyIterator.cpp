

#include "root.h"

#include "JavaScriptCore/EnumerationMode.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "wtf/Assertions.h"
#include "wtf/FastMalloc.h"
#include "headers-handwritten.h"

namespace Bun {
using namespace JSC;

class JSPropertyIterator {
public:
    JSPropertyIterator(JSC::VM& m_vm, RefPtr<JSC::PropertyNameArrayData> m_properties)
        : vm(m_vm)
        , properties(m_properties)
    {
    }

    RefPtr<JSC::PropertyNameArrayData> properties;
    Ref<JSC::VM> vm;
    static JSPropertyIterator* create(JSC::VM& vm, RefPtr<JSC::PropertyNameArrayData> data)
    {
        return new JSPropertyIterator(vm, data);
    }

    WTF_MAKE_FAST_ALLOCATED;
};

extern "C" JSPropertyIterator* Bun__JSPropertyIterator__create(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, size_t* count)
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSValue value = JSValue::decode(encodedValue);
    JSC::JSObject* object = value.getObject();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertyNameArray array(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    object->getPropertyNames(globalObject, array, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, nullptr);

    *count = array.size();
    if (array.size() == 0) {
        return nullptr;
    }

    return JSPropertyIterator::create(vm, array.releaseData());
}

extern "C" EncodedJSValue Bun__JSPropertyIterator__getNameAndValue(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, BunString* propertyName, size_t i)
{
    const auto& prop = iter->properties->propertyNameVector()[i];

    auto scope = DECLARE_THROW_SCOPE(iter->vm);
    JSValue result = object->get(globalObject, prop);

    RETURN_IF_EXCEPTION(scope, {});

    *propertyName = Bun::toString(prop.impl());
    return JSValue::encode(result);
}

extern "C" void Bun__JSPropertyIterator__getName(JSPropertyIterator* iter, BunString* propertyName, size_t i)
{
    const auto& prop = iter->properties->propertyNameVector()[i];
    *propertyName = Bun::toString(prop.impl());
}

extern "C" void Bun__JSPropertyIterator__deinit(JSPropertyIterator* iter)
{
    delete iter;
}

}
