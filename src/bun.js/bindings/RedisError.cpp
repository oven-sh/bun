#include "root.h"

#include "RedisError.h"

#include <array>
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorInstanceInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;
using namespace WTF;

static ASCIILiteral redisErrorCodeFromString(StringView view)
{
    static constexpr std::array<ASCIILiteral, 19> redisErrorCodes = {
        "ERR_REDIS_AUTHENTICATION_FAILED"_s,
        "ERR_REDIS_CONNECTION_CLOSED"_s,
        "ERR_REDIS_CONNECTION_TIMEOUT"_s,
        "ERR_REDIS_IDLE_TIMEOUT"_s,
        "ERR_REDIS_INVALID_ARGUMENT"_s,
        "ERR_REDIS_INVALID_ARRAY"_s,
        "ERR_REDIS_INVALID_BULK_STRING"_s,
        "ERR_REDIS_INVALID_COMMAND"_s,
        "ERR_REDIS_INVALID_DATABASE"_s,
        "ERR_REDIS_INVALID_ERROR_STRING"_s,
        "ERR_REDIS_INVALID_INTEGER"_s,
        "ERR_REDIS_INVALID_PASSWORD"_s,
        "ERR_REDIS_INVALID_RESPONSE"_s,
        "ERR_REDIS_INVALID_RESPONSE_TYPE"_s,
        "ERR_REDIS_INVALID_SIMPLE_STRING"_s,
        "ERR_REDIS_INVALID_STATE"_s,
        "ERR_REDIS_INVALID_USERNAME"_s,
        "ERR_REDIS_TLS_NOT_AVAILABLE"_s,
        "ERR_REDIS_TLS_UPGRADE_FAILED"_s,
    };

    for (auto code : redisErrorCodes) {
        if (view == code)
            return code;
    }

    return "ERR_REDIS_INVALID_RESPONSE"_s;
}

JSC_DEFINE_HOST_FUNCTION(RedisError_proto_toString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto thisVal = callFrame->thisValue();

    auto name = thisVal.get(globalObject, vm.propertyNames->name);
    RETURN_IF_EXCEPTION(scope, {});
    auto code = thisVal.get(globalObject, WebCore::builtinNames(vm).codePublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto message = thisVal.get(globalObject, vm.propertyNames->message);
    RETURN_IF_EXCEPTION(scope, {});

    String nameString = name.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String codeString = code.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String messageString = message.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsString(vm, makeString(nameString, " ["_s, codeString, "]: "_s, messageString)));
}

static JSObject* createRedisErrorPrototype(VM& vm, JSGlobalObject* globalObject)
{
    auto* prototype = JSC::constructEmptyObject(globalObject, globalObject->errorPrototype());
    prototype->putDirect(vm, vm.propertyNames->name, jsString(vm, String("RedisError"_s)), 0);
    prototype->putDirect(
        vm,
        vm.propertyNames->toString,
        JSC::JSFunction::create(vm, globalObject, 0, "toString"_s, RedisError_proto_toString, JSC::ImplementationVisibility::Private),
        0);
    return prototype;
}

Structure* createRedisErrorStructure(VM& vm, JSGlobalObject* globalObject)
{
    return ErrorInstance::createStructure(vm, globalObject, createRedisErrorPrototype(vm, globalObject));
}

JSObject* createRedisErrorInstance(VM& vm, JSGlobalObject* globalObject, JSValue message, ASCIILiteral code, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    Structure* structure;
    if (auto* zigGlobal = jsDynamicCast<Zig::GlobalObject*>(globalObject)) {
        structure = zigGlobal->m_RedisErrorStructure.getInitializedOnMainThread(globalObject);
    } else {
        structure = createRedisErrorStructure(vm, globalObject);
    }

    auto* error = ErrorInstance::create(globalObject, structure, message, options, nullptr, RuntimeType::TypeNothing, ErrorType::Error, true);
    RETURN_IF_EXCEPTION(scope, nullptr);
    error->putDirect(
        vm,
        WebCore::builtinNames(vm).codePublicName(),
        jsString(vm, String(code)),
        PropertyAttribute::DontDelete | PropertyAttribute::DontEnum | 0);
    return error;
}

JSC_DEFINE_HOST_FUNCTION(functionRedisErrorConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue message = callFrame->argumentCount() > 0 ? callFrame->uncheckedArgument(0) : jsEmptyString(vm);
    JSValue options = callFrame->argumentCount() > 1 ? callFrame->uncheckedArgument(1) : jsUndefined();
    if (!message.isString()) {
        message = message.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    ASCIILiteral code = "ERR_REDIS_INVALID_RESPONSE"_s;
    if (options.isObject()) {
        JSValue codeValue = options.get(globalObject, WebCore::builtinNames(vm).codePublicName());
        RETURN_IF_EXCEPTION(scope, {});
        if (!codeValue.isUndefined()) {
            auto* codeString = codeValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto view = codeString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            code = redisErrorCodeFromString(view);
        }
    }

    auto* error = createRedisErrorInstance(vm, globalObject, message, code, options);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(error));
}

JSObject* createRedisErrorConstructor(VM& vm, JSGlobalObject* globalObject)
{
    auto* constructor = JSFunction::create(
        vm,
        globalObject,
        2,
        "RedisError"_s,
        functionRedisErrorConstructor,
        ImplementationVisibility::Public,
        NoIntrinsic,
        functionRedisErrorConstructor);
    auto* structure = defaultGlobalObject(globalObject)->m_RedisErrorStructure.getInitializedOnMainThread(globalObject);
    auto* prototype = jsCast<JSObject*>(structure->storedPrototype());
    constructor->putDirect(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);
    prototype->putDirect(vm, vm.propertyNames->constructor, constructor, PropertyAttribute::DontEnum | 0);
    return constructor;
}

}
