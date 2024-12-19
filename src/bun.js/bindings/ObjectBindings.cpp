#include "ObjectBindings.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/PropertySlot.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

using namespace JSC;

static bool getNonIndexPropertySlotPrototypePollutionMitigation(JSC::VM& vm, JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    // This method only supports non-index PropertyNames.
    ASSERT(!parseIndex(propertyName));

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* objectPrototype = nullptr;
    while (true) {
        Structure* structure = object->structureID().decode();
        if (LIKELY(!TypeInfo::overridesGetOwnPropertySlot(object->inlineTypeFlags()))) {
            if (object->getOwnNonIndexPropertySlot(vm, structure, propertyName, slot))
                return true;
        } else {
            bool hasSlot = structure->classInfoForCells()->methodTable.getOwnPropertySlot(object, globalObject, propertyName, slot);
            RETURN_IF_EXCEPTION(scope, false);
            if (hasSlot)
                return true;
            if (UNLIKELY(slot.isVMInquiry() && slot.isTaintedByOpaqueObject()))
                return false;
            if (object->type() == ProxyObjectType && slot.internalMethodType() == PropertySlot::InternalMethodType::HasProperty)
                return false;
        }
        JSValue prototype;
        if (LIKELY(!structure->typeInfo().overridesGetPrototype() || slot.internalMethodType() == PropertySlot::InternalMethodType::VMInquiry))
            prototype = object->getPrototypeDirect();
        else {
            prototype = object->getPrototype(vm, globalObject);
            RETURN_IF_EXCEPTION(scope, false);
        }
        if (!prototype.isObject())
            return false;
        object = asObject(prototype);
        // -- If we reach the object prototype, we stop.
        if (objectPrototype == nullptr) {
            objectPrototype = globalObject->objectPrototype();
        }
        if (object == objectPrototype) {
            return false;
        }
    }

    return false;
}

// Returns empty for exception, returns deleted if not found.
// Be careful when handling the return value.
JSC::JSValue getIfPropertyExistsPrototypePollutionMitigationUnsafe(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto propertySlot = PropertySlot(object, PropertySlot::InternalMethodType::Get);
    auto isDefined = getNonIndexPropertySlotPrototypePollutionMitigation(vm, object, globalObject, name, propertySlot);

    if (!isDefined) {
        return JSValue::decode(JSC::JSValue::ValueDeleted);
    }

    scope.assertNoException();
    JSValue value = propertySlot.getValue(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

JSC::JSValue getIfPropertyExistsPrototypePollutionMitigation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto propertySlot = PropertySlot(object, PropertySlot::InternalMethodType::Get);
    auto isDefined = getNonIndexPropertySlotPrototypePollutionMitigation(vm, object, globalObject, name, propertySlot);

    if (!isDefined) {
        return JSC::jsUndefined();
    }

    scope.assertNoException();
    JSValue value = propertySlot.getValue(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

}
