#pragma once

#include "root.h"

namespace Bun {

// Which own keys JSC__JSValue__forEachOwnProperty passes on. This enum must match OwnKeys in src/jsc/JSValue.rs.
enum class OwnKeys : uint8_t {
    // No index key: an Array, a typed array and a String object print those as their elements.
    Named = 0,
    All = 1,
};

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

}
