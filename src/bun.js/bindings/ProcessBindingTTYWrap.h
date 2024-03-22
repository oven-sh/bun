#pragma once

#include "root.h"

namespace JSC {
class JSGlobalObject;
class JSValue;
}

namespace Bun {

JSC::JSValue createBunTTYFunctions(JSC::JSGlobalObject* globalObject);
JSC::JSValue createNodeTTYWrapObject(JSC::JSGlobalObject* globalObject);

JSC_DECLARE_HOST_FUNCTION(Process_functionInternalGetWindowSize);

}