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
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateBoolean, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validatePort, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateAbortSignal, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateArray, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateInt32, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateUint32, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateSignalName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateEncoding, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validatePlainFunction, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateUndefined, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));
JSC_DEFINE_HOST_FUNCTION(jsFunction_validateBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame));

namespace V {

JSC::EncodedJSValue validateInteger(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::JSValue name, JSC::JSValue min, JSC::JSValue max);
JSC::EncodedJSValue validateInteger(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, ASCIILiteral name, JSC::JSValue min, JSC::JSValue max);
JSC::EncodedJSValue validateNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue value, JSC::JSValue name, JSC::JSValue min, JSC::JSValue max);
JSC::EncodedJSValue validateNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, JSValue min, JSValue max);
JSC::EncodedJSValue validateFiniteNumber(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSC::JSValue number, JSC::JSValue name);
JSC::EncodedJSValue validateString(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name);
JSC::EncodedJSValue validateString(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name);
JSC::EncodedJSValue validateArray(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name, JSValue minLength);
JSC::EncodedJSValue validateArray(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, JSValue minLength);
JSC::EncodedJSValue validateUint32(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, JSValue name, JSValue positive);
JSC::EncodedJSValue validateUint32(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, JSValue value, ASCIILiteral name, JSValue positive);

}

}
