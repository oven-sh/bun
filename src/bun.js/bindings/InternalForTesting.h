#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsFunction_arrayBufferViewHasBuffer);
JSC_DECLARE_HOST_FUNCTION(jsFunction_hasReifiedStatic);
JSC_DECLARE_HOST_FUNCTION(jsFunction_lsanDoLeakCheck);

}
