#pragma once
#include "root.h"
#include <JavaScriptCore/IteratorOperations.h>

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

/**
 * True when `object` has the realm's iteratorResultObjectStructure: `{ value, done }` as two
 * plain data properties at iteratorResultObjectValuePropertyOffset and
 * iteratorResultObjectDonePropertyOffset. createIteratorResultObject, the `{ value, done }`
 * literals of the generator and Array/Map/Set/String iterator builtins, and the DFG/FTL
 * inlined next() all produce it. Any mutation of such an object (a getter, a deleted
 * property, a prototype change, freezing) transitions it to another structure, so a match
 * means no user code can observe the read.
 */
ALWAYS_INLINE bool isIteratorResultObject(JSC::JSGlobalObject* globalObject, JSC::JSObject* object)
{
    return object->structureID() == globalObject->iteratorResultObjectStructure()->id();
}

/**
 * `result.value` with the iteratorResultObjectStructure slot read as the fast path.
 * Equivalent to `result->get(globalObject, vm.propertyNames->value)`.
 */
ALWAYS_INLINE JSC::JSValue getIteratorResultValue(JSC::JSGlobalObject* globalObject, JSC::JSObject* result)
{
    if (isIteratorResultObject(globalObject, result)) [[likely]]
        return result->getDirect(JSC::iteratorResultObjectValuePropertyOffset);
    return result->get(globalObject, JSC::getVM(globalObject).propertyNames->value);
}

/**
 * `result.done` with the iteratorResultObjectStructure slot read as the fast path.
 * Equivalent to `result->get(globalObject, vm.propertyNames->done)`.
 */
ALWAYS_INLINE JSC::JSValue getIteratorResultDone(JSC::JSGlobalObject* globalObject, JSC::JSObject* result)
{
    if (isIteratorResultObject(globalObject, result)) [[likely]]
        return result->getDirect(JSC::iteratorResultObjectDonePropertyOffset);
    return result->get(globalObject, JSC::getVM(globalObject).propertyNames->done);
}

struct IteratorResult {
    JSC::JSValue done;
    JSC::JSValue value;
};

/**
 * Both fields of an iterator result with one structure check. Off the fast path this is
 * `get(done)` then `get(value)` (the IteratorComplete, IteratorValue order); if either
 * throws, the returned fields are empty and the exception is pending on the VM.
 */
ALWAYS_INLINE IteratorResult getIteratorResult(JSC::JSGlobalObject* globalObject, JSC::JSObject* result)
{
    if (isIteratorResultObject(globalObject, result)) [[likely]]
        return { result->getDirect(JSC::iteratorResultObjectDonePropertyOffset), result->getDirect(JSC::iteratorResultObjectValuePropertyOffset) };

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue done = result->get(globalObject, vm.propertyNames->done);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue value = result->get(globalObject, vm.propertyNames->value);
    RETURN_IF_EXCEPTION(scope, {});
    return { done, value };
}

}
