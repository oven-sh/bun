

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
#include "ObjectBindings.h"

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

extern "C" JSPropertyIterator* Bun__JSPropertyIterator__create(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, size_t* count, bool own_properties_only, bool only_non_index_properties)
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSValue value = JSValue::decode(encodedValue);
    JSC::JSObject* object = value.getObject();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertyNameArray array(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);

    if (own_properties_only) {
        if (only_non_index_properties) {
            object->getOwnNonIndexPropertyNames(globalObject, array, DontEnumPropertiesMode::Exclude);
        } else {
            object->getOwnPropertyNames(object, globalObject, array, DontEnumPropertiesMode::Exclude);
        }
    } else {
        object->getPropertyNames(globalObject, array, DontEnumPropertiesMode::Exclude);
    }
    RETURN_IF_EXCEPTION(scope, nullptr);

    *count = array.size();
    if (array.size() == 0) {
        return nullptr;
    }

    return JSPropertyIterator::create(vm, array.releaseData());
}

extern "C" size_t Bun__JSPropertyIterator__getLongestPropertyName(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object)
{
    size_t longest = 0;
    for (const auto& prop : iter->properties->propertyNameVector()) {
        if (prop.length() > longest) {
            longest = prop.length();
        }
    }

    return longest;
}

extern "C" EncodedJSValue Bun__JSPropertyIterator__getNameAndValue(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, BunString* propertyName, size_t i)
{
    const auto& prop = iter->properties->propertyNameVector()[i];
    auto& vm = iter->vm;
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
    if (!object->getOwnPropertySlot(object, globalObject, prop, slot)) {
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result = slot.getValue(globalObject, prop);
    RETURN_IF_EXCEPTION(scope, {});

    *propertyName = Bun::toString(prop.impl());
    return JSValue::encode(result);
}

extern "C" EncodedJSValue Bun__JSPropertyIterator__getNameAndValueNonObservable(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, BunString* propertyName, size_t i)
{
    const auto& prop = iter->properties->propertyNameVector()[i];
    auto& vm = iter->vm;
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, vm.ptr());
    if (!object->getNonIndexPropertySlot(globalObject, prop, slot)) {
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});

    if (slot.isAccessor() || slot.isCustom()) {
        return {};
    }

    JSValue result = slot.getPureResult();
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
