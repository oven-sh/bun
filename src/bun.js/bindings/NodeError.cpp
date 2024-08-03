#include "root.h"
#include "headers-handwritten.h"
#include "BunClientData.h"
#include "helpers.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/Symbol.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/text/MakeString.h"
#include "wtf/text/WTFString.h"
#include <cstdio>

JSC::EncodedJSValue JSC__JSValue__createTypeError(const ZigString* message, const ZigString* arg1, JSC::JSGlobalObject* globalObject);
JSC::EncodedJSValue JSC__JSValue__createRangeError(const ZigString* message, const ZigString* arg1, JSC::JSGlobalObject* globalObject);

extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue val_arg_name, JSC::EncodedJSValue val_expected_type, JSC::EncodedJSValue val_actual_value);
extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2, JSC::EncodedJSValue arg3);
extern "C" JSC::EncodedJSValue Bun__ERR_IPC_CHANNEL_CLOSED(JSC::JSGlobalObject* globalObject);
extern "C" JSC::EncodedJSValue Bun__ERR_UNHANDLED_REJECTION(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue reason);

namespace Bun {

using namespace JSC;

WTF::String JSValueToStringSafe(JSC::JSGlobalObject* globalObject, JSValue arg)
{
    ASSERT(!arg.isEmpty());
    if (!arg.isCell())
        return arg.toString(globalObject)->getString(globalObject);

    auto cell = arg.asCell();
    auto jstype = cell->type();

    if (jstype == JSC::JSType::StringType) {
        return cell->toStringInline(globalObject)->getString(globalObject);
    }
    if (jstype == JSC::JSType::SymbolType) {
        auto symbol = jsCast<Symbol*>(cell);
        auto result = symbol->tryGetDescriptiveString();
        if (result.has_value())
            return result.value();
    }
    return arg.toString(globalObject)->getString(globalObject);
}

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
    auto arg_name = callFrame->argument(0);
    auto expected_type = callFrame->argument(1);
    auto actual_value = callFrame->argument(2);
    return Bun__ERR_INVALID_ARG_TYPE(globalObject, JSValue::encode(arg_name), JSValue::encode(expected_type), JSValue::encode(actual_value));
}
extern "C" JSC::EncodedJSValue Bun__ERR_INVALID_ARG_TYPE(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue val_arg_name, JSC::EncodedJSValue val_expected_type, JSC::EncodedJSValue val_actual_value)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto arg_name = JSValue::decode(val_arg_name).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto expected_type = JSValue::decode(val_expected_type).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto actual_value = JSValueToStringSafe(globalObject, JSValue::decode(val_actual_value));
    RETURN_IF_EXCEPTION(scope, {});

    auto message = makeString("The \""_s, arg_name, "\" argument must be of type "_s, expected_type, ". Received "_s, actual_value);
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

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_SERVER_NOT_RUNNING, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return JSC::JSValue::encode(createErrorWithCode(globalObject, "Server is not running."_s, "ERR_SERVER_NOT_RUNNING"_s));
}

extern "C" JSC::EncodedJSValue Bun__ERR_MISSING_ARGS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2, JSC::EncodedJSValue arg3)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (arg1 == 0) {
        JSC::throwTypeError(globalObject, scope, "requires at least 1 argument"_s);
        return {};
    }

    auto name1 = JSValue::decode(arg1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (arg2 == 0) {
        // 1 arg name passed
        auto message = makeString("The \""_s, name1, "\" argument must be specified"_s);
        return JSC::JSValue::encode(createTypeErrorWithCode(globalObject, message, "ERR_MISSING_ARGS"_s));
    }

    auto name2 = JSValue::decode(arg2).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (arg3 == 0) {
        // 2 arg names passed
        auto message = makeString("The \""_s, name1, "\" and \""_s, name2, "\" arguments must be specified"_s);
        return JSC::JSValue::encode(createTypeErrorWithCode(globalObject, message, "ERR_MISSING_ARGS"_s));
    }

    auto name3 = JSValue::decode(arg3).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // 3 arg names passed
    auto message = makeString("The \""_s, name1, "\", \""_s, name2, "\", and \""_s, name3, "\" arguments must be specified"_s);
    return JSC::JSValue::encode(createTypeErrorWithCode(globalObject, message, "ERR_MISSING_ARGS"_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_IPC_CHANNEL_CLOSED, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return Bun__ERR_IPC_CHANNEL_CLOSED(globalObject);
}
extern "C" JSC::EncodedJSValue Bun__ERR_IPC_CHANNEL_CLOSED(JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(createErrorWithCode(globalObject, "Channel closed."_s, "ERR_IPC_CHANNEL_CLOSED"_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_SOCKET_BAD_TYPE, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return JSC::JSValue::encode(createTypeErrorWithCode(globalObject, "Bad socket type specified. Valid types are: udp4, udp6"_s, "ERR_SOCKET_BAD_TYPE"_s));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_ERR_UNHANDLED_REJECTION, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto argCount = callFrame->argumentCount();
    if (argCount < 1) {
        JSC::throwTypeError(globalObject, scope, "requires 3 arguments"_s);
        return {};
    }

    auto reason = callFrame->argument(0);
    return Bun__ERR_UNHANDLED_REJECTION(globalObject, JSValue::encode(reason));
}
extern "C" JSC::EncodedJSValue Bun__ERR_UNHANDLED_REJECTION(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encoded_reason)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // need to make sure this does not throw
    auto value = JSC::JSValue::decode(encoded_reason);
    ASSERT(!value.isEmpty());

    WTF::String string;
    do {
        if (!value.isCell()) {
            string = value.toString(globalObject)->getString(globalObject);
            break;
        }

        auto cell = value.asCell();
        auto jstype = cell->type();

        if (jstype == JSC::JSType::StringType) {
            string = cell->toStringInline(globalObject)->getString(globalObject);
            break;
        }
        if (jstype == JSC::JSType::SymbolType) {
            auto symbol = jsCast<Symbol*>(cell);
            auto result = symbol->tryGetDescriptiveString();
            if (result.has_value()) {
                string = result.value();
                break;
            }
        }
        auto jsstring = value.toStringOrNull(globalObject);
        if (!jsstring) {
            scope.clearException();
            jsstring = jsString(vm, String("[object Object]"_s));
        }
        string = jsstring->getString(globalObject);
    } while (0);

    auto message = makeString("This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason \""_s, string, "\"."_s);
    return JSC::JSValue::encode(createErrorWithCode(globalObject, message, "ERR_UNHANDLED_REJECTION"_s));
}

}
