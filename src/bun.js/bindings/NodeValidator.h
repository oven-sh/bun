#include "root.h"

#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "JavaScriptCore/JSCJSValue.h"

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsFunction_validateInteger, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateNumber, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateString, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateFiniteNumber, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_checkRangesOrGetDefault, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));

JSC::EncodedJSValue validateNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::JSValue name, JSC::JSValue min, JSC::JSValue max);
JSC::EncodedJSValue validateFiniteNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue number, JSC::JSValue name);

}

// validateFunction
