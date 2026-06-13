#pragma once

#include "root.h"
#include "BunGlobalObject.h"

namespace JSC {
class JSGlobalObject;
class JSValue;
}

namespace Bun {

JSC::JSValue createBunTTYFunctions(Bun::GlobalObject* globalObject);
JSC::JSValue createNodeTTYWrapObject(JSC::JSGlobalObject* globalObject);

JSC_DECLARE_HOST_FUNCTION(Process_functionInternalGetWindowSize);

}
