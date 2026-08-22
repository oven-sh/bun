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

/**
 * `{ done, value }` of an iterator result object.
 *
 * When `result` has the realm's iteratorResultObjectStructure, both are plain data properties
 * at iteratorResultObjectDonePropertyOffset / iteratorResultObjectValuePropertyOffset and the
 * two slots are read directly. createIteratorResultObject, the `{ value, done }` literals of the
 * generator and Array/Map/Set/String iterator builtins, and the DFG-inlined next() all produce
 * that structure. Any mutation (a getter, a delete, a prototype change, a freeze) transitions the
 * object to another structure, so on a match no user code can observe the read.
 *
 * Otherwise this is `get(done)` then `get(value)`. If either throws, both values are empty and
 * the exception is pending on the VM.
 */
ALWAYS_INLINE std::pair<JSC::JSValue, JSC::JSValue> getIteratorResult(JSC::JSGlobalObject* globalObject, JSC::JSObject* result)
{
    if (result->structureID() == globalObject->iteratorResultObjectStructure()->id()) [[likely]]
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
