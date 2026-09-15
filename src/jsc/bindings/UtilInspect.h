#pragma once

#include "root.h"

namespace Bun {

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

// internalBinding('util').getOwnNonIndexProperties(object, filter)
JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

// internalBinding('util').previewEntries(iterator, true), with a limit on how many entries it copies out
JSC_DECLARE_HOST_FUNCTION(jsFunctionPreviewEntries);

}
