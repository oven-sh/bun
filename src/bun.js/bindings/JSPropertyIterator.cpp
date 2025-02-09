#include "root.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSType.h"
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
    bool isSpecialProxy = false;
    static JSPropertyIterator* create(JSC::VM& vm, RefPtr<JSC::PropertyNameArrayData> data)
    {
        return new JSPropertyIterator(vm, data);
    }

    WTF_MAKE_FAST_ALLOCATED;
};

extern "C" JSPropertyIterator* Bun__JSPropertyIterator__create(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, size_t* count, bool own_properties_only, bool only_non_index_properties)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue value = JSValue::decode(encodedValue);
    JSC::JSObject* object = value.getObject();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertyNameArray array(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);

    if (UNLIKELY(object->hasNonReifiedStaticProperties())) {
        object->reifyAllStaticProperties(globalObject);
    }

#if OS(WINDOWS)
    if (UNLIKELY(object->type() == JSC::ProxyObjectType)) {
        // Check if we're actually iterating through the JSEnvironmentVariableMap's proxy.
        auto* zigGlobal = defaultGlobalObject(globalObject);
        if (zigGlobal->m_processEnvObject.isInitialized()) {
            if (object == zigGlobal->m_processEnvObject.get(zigGlobal)) {
                object->methodTable()->getOwnPropertyNames(
                    object,
                    globalObject,
                    array,
                    DontEnumPropertiesMode::Exclude);
                RETURN_IF_EXCEPTION(scope, nullptr);

                *count = array.size();
                if (array.size() == 0) {
                    return nullptr;
                }

                auto* iter = JSPropertyIterator::create(vm, array.releaseData());
                iter->isSpecialProxy = true;
                return iter;
            }
        }
    }
#endif

    if (own_properties_only) {
        if (only_non_index_properties) {
            object->getOwnNonIndexPropertyNames(globalObject, array, DontEnumPropertiesMode::Exclude);
        } else {
            object->methodTable()->getOwnPropertyNames(object, globalObject, array, DontEnumPropertiesMode::Exclude);
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

static EncodedJSValue getOwnProxyObject(JSPropertyIterator* iter, JSObject* object, const JSC::Identifier& prop, BunString* propertyName)
{
    auto& vm = iter->vm;
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty, nullptr);
    auto* globalObject = object->globalObject();
    if (!object->methodTable()->getOwnPropertySlot(object, globalObject, prop, slot)) {
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result = slot.getValue(globalObject, prop);
    RETURN_IF_EXCEPTION(scope, {});

    *propertyName = Bun::toString(prop.impl());
    return JSValue::encode(result);
}

extern "C" EncodedJSValue Bun__JSPropertyIterator__getNameAndValue(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, BunString* propertyName, size_t i)
{
    const auto& prop = iter->properties->propertyNameVector()[i];
    if (UNLIKELY(iter->isSpecialProxy)) {
        return getOwnProxyObject(iter, object, prop, propertyName);
    }

    auto& vm = iter->vm;
    auto scope = DECLARE_THROW_SCOPE(vm);
    // This has to be get because we may need to call on prototypes
    // If we meant for this to only run for own keys, the property name would not be included in the array.
    PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
    if (!object->getPropertySlot(globalObject, prop, slot)) {
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
    if (UNLIKELY(iter->isSpecialProxy)) {
        return getOwnProxyObject(iter, object, prop, propertyName);
    }
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
