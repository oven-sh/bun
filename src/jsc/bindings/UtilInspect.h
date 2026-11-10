#pragma once

#include "root.h"

#include <JavaScriptCore/PropertyNameArray.h>

namespace Bun {

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

// What that function lists: the own keys of `object` that are not array indices, of the kinds the builder takes.
void getOwnNonIndexPropertyNames(JSC::JSGlobalObject*, JSC::JSObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);

}
