#include "root.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "JavaScriptCore/JSCJSValue.h"

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateInteger, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));

//
//

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateBounds, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
