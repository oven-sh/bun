#pragma once

#include "root.h"
#include <JavaScriptCore/JSType.h>
#include <JavaScriptCore/PropertyNameArray.h>

namespace Bun {

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

// Adds the own keys of `object` without its index keys. `names` is in a mode without index
// keys (NonIndexStrings, NonIndexStringsAndSymbols or Symbols): JSC then builds no name for an
// element, a character of a String object or a mapped argument, and a Proxy with no ownKeys
// trap hands the mode to its target. A key from anywhere else is added as it is: an ownKeys
// trap can return "0".
// An ordinary object, an array and a typed array have no other keys in their hook than
// getOwnNonIndexPropertyNames() gives, so they do not pay for the indirect call.
ALWAYS_INLINE void collectOwnNonIndexKeys(JSC::JSObject* object, JSC::JSGlobalObject* globalObject, JSC::PropertyNameArrayBuilder& names, JSC::DontEnumPropertiesMode mode)
{
    ASSERT(!names.includeIndexedProperties());
    if (JSC::isTypedArrayType(object->type()) || !object->structure()->typeInfo().overridesGetOwnPropertyNames())
        object->getOwnNonIndexPropertyNames(globalObject, names, mode);
    else
        object->methodTable()->getOwnPropertyNames(object, globalObject, names, mode);
}

}
