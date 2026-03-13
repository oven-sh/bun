#include "ObjectBindings.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/PropertySlot.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

using namespace JSC;

// this function does prototype lookups but stops at the object prototype,
// preventing a class of vulnerabilities where a badly written parser
// mutates `globalThis.Object.prototype`.
//
// TODO: this function sometimes returns false positives.
// see test cases in test-fs-rm.js where the `force` argument needs to throw
// when it is `undefined`, but implementing that code makes cases where `force`
// is omitted will make it think it is defined.
static bool getNonIndexPropertySlotPrototypePollutionMitigation(JSC::VM& vm, JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    // This method only supports non-index PropertyNames.
    ASSERT(!parseIndex(propertyName));
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* objectPrototype = nullptr;
    while (true) {
        Structure* structure = object->structureID().decode();
        if (!TypeInfo::overridesGetOwnPropertySlot(object->inlineTypeFlags())) [[likely]] {
            auto has = object->getOwnNonIndexPropertySlot(vm, structure, propertyName, slot);
            RETURN_IF_EXCEPTION(scope, false);
            if (has) return true;
        } else {
            bool hasSlot = structure->classInfoForCells()->methodTable.getOwnPropertySlot(object, globalObject, propertyName, slot);
            RETURN_IF_EXCEPTION(scope, false);
            if (hasSlot)
                return true;
            if (slot.isVMInquiry() && slot.isTaintedByOpaqueObject()) [[unlikely]]
                return false;
            if (object->type() == ProxyObjectType && slot.internalMethodType() == PropertySlot::InternalMethodType::HasProperty)
                return false;
        }
        JSValue prototype;
        if (!structure->typeInfo().overridesGetPrototype() || slot.internalMethodType() == PropertySlot::InternalMethodType::VMInquiry) [[likely]]
            prototype = object->getPrototypeDirect();
        else {
            prototype = object->getPrototype(globalObject);
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
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::decode(JSC::JSValue::ValueDeleted);
    }

    scope.assertNoExceptionExceptTermination();
    RETURN_IF_EXCEPTION(scope, {});
    JSValue value = propertySlot.getValue(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

JSC::JSValue getIfPropertyExistsPrototypePollutionMitigation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto propertySlot = PropertySlot(object, PropertySlot::InternalMethodType::Get);
    auto isDefined = getNonIndexPropertySlotPrototypePollutionMitigation(vm, object, globalObject, name, propertySlot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isDefined) return JSC::jsUndefined();
    JSValue value = propertySlot.getValue(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

JSC::JSValue getOwnPropertyIfExists(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty, nullptr);
    if (!object->methodTable()->getOwnPropertySlot(object, globalObject, name, slot)) {
        RETURN_IF_EXCEPTION(scope, {});
        return JSC::jsUndefined();
    }
    RETURN_IF_EXCEPTION(scope, {});
    JSValue value = slot.getValue(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

}
