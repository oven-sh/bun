#pragma once

namespace Bun {

JSC::Structure* createUtilInspectOptionsStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

JSC_DECLARE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties);

}
