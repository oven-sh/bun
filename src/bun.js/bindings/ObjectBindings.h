#pragma once
#include "root.h"

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

}
