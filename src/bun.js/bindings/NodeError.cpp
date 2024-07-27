#include "root.h"
#include "headers-handwritten.h"
#include "BunClientData.h"
#include "helpers.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/MakeString.h"
#include <cstdio>

JSC::EncodedJSValue JSC__JSValue__createTypeError(const ZigString* message, const ZigString* arg1, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue JSC__JSValue__createRangeError(const ZigString* message, const ZigString* arg1, JSC::JSGlobalObject* globalObject);

namespace Bun {

using namespace JSC;

JSC::JSValue createErrorWithCode(JSC::JSGlobalObject* globalObject, String message, ASCIILiteral code)
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* result = JSC::createError(globalObject, message);
    JSC::EnsureStillAliveScope ensureAlive(result);
    auto typeError = JSC::JSValue(result).asCell()->getObject();

    auto clientData = WebCore::clientData(vm);
    typeError->putDirect(vm, clientData->builtinNames().codePublicName(), jsString(vm, String(code)), 0);

    return typeError;
}

JSC::JSValue createTypeErrorWithCode(JSC::JSGlobalObject* globalObject, String message, ASCIILiteral code)
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* result = JSC::createTypeError(globalObject, message);
    JSC::EnsureStillAliveScope ensureAlive(result);
    auto typeError = JSC::JSValue(result).asCell()->getObject();

    auto clientData = WebCore::clientData(vm);
    typeError->putDirect(vm, clientData->builtinNames().codePublicName(), jsString(vm, String(code)), 0);

    return typeError;
}

JSC::JSValue createRangeErrorWithCode(JSC::JSGlobalObject* globalObject, String message, ASCIILiteral code)
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSObject* result = JSC::createRangeError(globalObject, message);
    JSC::EnsureStillAliveScope ensureAlive(result);
    auto typeError = JSC::JSValue(result).asCell()->getObject();

    auto clientData = WebCore::clientData(vm);
    typeError->putDirect(vm, clientData->builtinNames().codePublicName(), jsString(vm, String(code)), 0);

    return typeError;
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_INVALID_ARG_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto argCount = callFrame->argumentCount();
    if (argCount < 3) {
        JSC::throwTypeError(globalObject, scope, "requires 3 arguments"_s);
        return {};
    }

    auto arg_name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto expected_type = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto actual_value = callFrame->argument(2).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("The \""_s, arg_name, "\" argument must be of type "_s, expected_type, ". Recieved "_s, actual_value);
    return JSC::JSValue::encode(createTypeErrorWithCode(globalObject, message, "ERR_INVALID_ARG_TYPE"_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_OUT_OF_RANGE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto argCount = callFrame->argumentCount();
    if (argCount < 3) {
        JSC::throwTypeError(globalObject, scope, "requires 3 arguments"_s);
        return {};
    }

    auto arg_name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto range = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto input = callFrame->argument(2).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("The value of \""_s, arg_name, "\" is out of range. It must be "_s, range, ". Received "_s, input);
    return JSC::JSValue::encode(createRangeErrorWithCode(globalObject, message, "ERR_OUT_OF_RANGE"_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_IPC_DISCONNECTED, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return JSC::JSValue::encode(createErrorWithCode(globalObject, "IPC channel is already disconnected"_s, "ERR_IPC_DISCONNECTED"_s));
}

}
