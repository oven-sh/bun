#pragma once
#include "root.h"
#include <JavaScriptCore/IteratorOperations.h>
#include <utility>

namespace Bun {

/**
 * This is `JSObject::getIfPropertyExists`, except it stops when it reaches globalObject->objectPrototype().
 *
 * This means that for a prototype pollution attack to work, they would need to modify the specific prototype instead of the generic one shared by most objects.
 *
 * This method also does not support index properties.
 */
JSC::JSValue getIfPropertyExistsPrototypePollutionMitigation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name);
/**
 * Same as `getIfPropertyExistsPrototypePollutionMitigation`, but uses
 * JSValue::ValueDeleted instead of `JSC::jsUndefined` to encode the lack of a
 * property. This is used by some JS bindings that want to distinguish between
 * the property not existing and the property being undefined.
 */
JSC::JSValue getIfPropertyExistsPrototypePollutionMitigationUnsafe(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name);

ALWAYS_INLINE JSC::JSValue getIfPropertyExistsPrototypePollutionMitigation(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name)
{
    return getIfPropertyExistsPrototypePollutionMitigation(JSC::getVM(globalObject), globalObject, object, name);
}

/**
 * Gets an own property only (no prototype chain lookup).
 * Returns jsUndefined() if property doesn't exist as own property.
 * This is the strictest form of property access - use for security-critical options.
 */
JSC::JSValue getOwnPropertyIfExists(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name);

// Whether `getIteratorResult` runs `get(value)` on a result whose `done` is true. IteratorStepValue never does.
enum class IteratorDoneValue : uint8_t {
    Read,
    Skip,
};

// `{ done, value }` of an iterator result: the inline slots when `result` has the realm's iteratorResultObjectStructure, else `get(done)` then `get(value)` (both empty if either throws).
ALWAYS_INLINE std::pair<JSC::JSValue, JSC::JSValue> getIteratorResult(JSC::JSGlobalObject* globalObject, JSC::JSObject* result, IteratorDoneValue doneValue = IteratorDoneValue::Read)
{
    if (result->structureID() == globalObject->iteratorResultObjectStructure()->id()) [[likely]]
        return { result->getDirect(JSC::iteratorResultObjectDonePropertyOffset), result->getDirect(JSC::iteratorResultObjectValuePropertyOffset) };

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue done = result->get(globalObject, vm.propertyNames->done);
    RETURN_IF_EXCEPTION(scope, {});
    if (doneValue == IteratorDoneValue::Skip && done.toBoolean(globalObject))
        return { done, JSC::jsUndefined() };
    JSC::JSValue value = result->get(globalObject, vm.propertyNames->value);
    RETURN_IF_EXCEPTION(scope, {});
    return { done, value };
}

}
