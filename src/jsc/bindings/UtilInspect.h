#pragma once

#include "root.h"

namespace Bun {

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// Node's `internalBinding('util').getOwnNonIndexProperties(object, filter)`.
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

}
