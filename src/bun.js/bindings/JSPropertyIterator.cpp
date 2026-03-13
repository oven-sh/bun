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
    JSPropertyIterator(JSC::VM& m_vm, RefPtr<JSC::PropertyNameArray> m_properties)
        : vm(m_vm)
        , properties(m_properties)
    {
    }

    RefPtr<JSC::PropertyNameArray> properties;
    Ref<JSC::VM> vm;
    bool isSpecialProxy = false;
    static JSPropertyIterator* create(JSC::VM& vm, RefPtr<JSC::PropertyNameArray> data)
    {
        return new JSPropertyIterator(vm, data);
    }

    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(JSPropertyIterator);
};

extern "C" JSPropertyIterator* Bun__JSPropertyIterator__create(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, size_t* count, bool own_properties_only, bool only_non_index_properties)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue value = JSValue::decode(encodedValue);
    JSC::JSObject* object = value.getObject();
    ASSERT(object);
    ASSERT(count);

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertyNameArrayBuilder array(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);

    if (object->hasNonReifiedStaticProperties()) [[unlikely]] {
        object->reifyAllStaticProperties(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

#if OS(WINDOWS)
    if (object->type() == JSC::ProxyObjectType) [[unlikely]] {
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
    auto& vm = iter->vm;
    auto scope = DECLARE_THROW_SCOPE(vm);

    const auto& prop = iter->properties->propertyNameVector()[i];
    if (iter->isSpecialProxy) [[unlikely]] {
        RELEASE_AND_RETURN(scope, getOwnProxyObject(iter, object, prop, propertyName));
    }

    // This has to be get because we may need to call on prototypes
    // If we meant for this to only run for own keys, the property name would not be included in the array.
    PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
    if (!object->getPropertySlot(globalObject, prop, slot)) {
        RELEASE_AND_RETURN(scope, {});
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result = slot.getValue(globalObject, prop);
    RETURN_IF_EXCEPTION(scope, {});

    *propertyName = Bun::toString(prop.impl());
    return JSValue::encode(result);
}

extern "C" EncodedJSValue Bun__JSPropertyIterator__getNameAndValueNonObservable(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, BunString* propertyName, size_t i)
{
    auto& vm = iter->vm;
    auto scope = DECLARE_THROW_SCOPE(vm);

    const auto& prop = iter->properties->propertyNameVector()[i];
    if (iter->isSpecialProxy) [[unlikely]] {
        RELEASE_AND_RETURN(scope, getOwnProxyObject(iter, object, prop, propertyName));
    }

    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, vm.ptr());
    auto has = object->getNonIndexPropertySlot(globalObject, prop, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!has) {
        return {};
    }
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
