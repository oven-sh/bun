#pragma once

#include "root.h"

namespace Bun {

// True if the console formatter prints the index keys of such an object as its content: the elements of an Array or a typed array, the text of a String object.
inline bool printsIndexKeysAsContent(JSC::JSType type)
{
    return type == JSC::ArrayType || type == JSC::DerivedArrayType || JSC::isTypedArrayType(type) || type == JSC::StringObjectType || type == JSC::DerivedStringObjectType;
}

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

}
