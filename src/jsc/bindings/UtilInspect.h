#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// $cpp("UtilInspect.cpp", "createWellKnownPrototypes"): a Map from the built-in prototypes that
// util.inspect names without reading their `constructor` to those names.
JSC::JSValue createWellKnownPrototypes(Zig::GlobalObject*);
// $cpp("UtilInspect.cpp", "errorPrototype"): the Error.prototype of the realm.
JSC::JSValue errorPrototype(Zig::GlobalObject*);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

}
