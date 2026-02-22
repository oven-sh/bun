#include "ErrorCode.h"
#include "root.h"
#include "Secrets.h"
#include "mimalloc.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Identifier.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>
#include <mutex>
#include "ObjectBindings.h"

namespace Bun {

using namespace JSC;
using namespace WTF;

namespace Secrets {

JSValue Error::toJS(VM& vm, JSGlobalObject* globalObject) const
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Map error type to appropriate error code
    ErrorCode errorCode;
    switch (type) {
    case ErrorType::NotFound:
        errorCode = ErrorCode::ERR_SECRETS_NOT_FOUND;
        break;
    case ErrorType::AccessDenied:
        // Map specific macOS error codes to more specific error codes
        if (code == -25308) {
            errorCode = ErrorCode::ERR_SECRETS_INTERACTION_NOT_ALLOWED;
        } else if (code == -25293) {
            errorCode = ErrorCode::ERR_SECRETS_AUTH_FAILED;
        } else if (code == -25315) {
            errorCode = ErrorCode::ERR_SECRETS_INTERACTION_REQUIRED;
        } else if (code == -128) {
            errorCode = ErrorCode::ERR_SECRETS_USER_CANCELED;
        } else {
            errorCode = ErrorCode::ERR_SECRETS_ACCESS_DENIED;
        }
        break;
    case ErrorType::PlatformError:
        errorCode = ErrorCode::ERR_SECRETS_PLATFORM_ERROR;
        break;
    default:
        errorCode = ErrorCode::ERR_SECRETS_PLATFORM_ERROR;
        break;
    }

    // Include platform error code if available
    if (code != 0) {
        auto messageWithCode = makeString(message, " (code: "_s, String::number(code), ")"_s);
        RELEASE_AND_RETURN(scope, createError(globalObject, errorCode, messageWithCode));
    } else {
        RELEASE_AND_RETURN(scope, createError(globalObject, errorCode, message));
    }
}

}

// Options struct that will be passed through the threadpool
struct SecretsJobOptions {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(SecretsJobOptions);

    enum Operation {
        GET = 0,
        SET = 1,
        DELETE_OP = 2 // Named DELETE_OP to avoid conflict with Windows DELETE macro
    };

    Operation op;
    CString service; // UTF-8 encoded, thread-safe
    CString name; // UTF-8 encoded, thread-safe
    CString password; // UTF-8 encoded, thread-safe (only for SET)
    bool allowUnrestrictedAccess = false; // Controls security vs headless access (only for SET)

    // Results (filled in by threadpool)
    Secrets::Error error;
    std::optional<WTF::Vector<uint8_t>> resultPassword;
    bool deleted = false;

    SecretsJobOptions(Operation op, CString&& service, CString&& name, CString&& password, bool allowUnrestrictedAccess = false)
        : op(op)
        , service(service)
        , name(name)
        , password(password)
        , allowUnrestrictedAccess(allowUnrestrictedAccess)
    {
    }

    ~SecretsJobOptions()
    {
        if (password.length() > 0) {
            memsetSpan(password.mutableSpan(), 0);
        }

        if (resultPassword.has_value()) {
            memsetSpan(resultPassword.value().mutableSpan(), 0);
        }

        if (name.length() > 0) {
            memsetSpan(name.mutableSpan(), 0);
        }

        if (service.length() > 0) {
            memsetSpan(service.mutableSpan(), 0);
        }
    }

    static SecretsJobOptions* fromJS(JSGlobalObject* globalObject, ArgList args, Operation operation)
    {
        auto& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        String service;
        String name;
        String password;
        bool allowUnrestrictedAccess = false;

        const auto fromOptionsObject = [&]() -> bool {
            if (args.size() < 1) {
                Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "Expected options to be an object"_s);
                return false;
            }

            JSObject* options = args.at(0).getObject();
            if (!options) {
                Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "Expected options to be an object"_s);
                return false;
            }

            JSValue serviceValue = getIfPropertyExistsPrototypePollutionMitigation(globalObject, options, Identifier::fromString(vm, "service"_s));
            RETURN_IF_EXCEPTION(scope, false);

            JSValue nameValue = getIfPropertyExistsPrototypePollutionMitigation(globalObject, options, vm.propertyNames->name);
            RETURN_IF_EXCEPTION(scope, false);

            if (!serviceValue.isString() || !nameValue.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "Expected service and name to be strings"_s);
                return false;
            }

            if (operation == SET) {
                JSValue passwordValue = getIfPropertyExistsPrototypePollutionMitigation(globalObject, options, vm.propertyNames->value);
                RETURN_IF_EXCEPTION(scope, false);

                if (passwordValue.isString()) {
                    password = passwordValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                } else if (passwordValue.isUndefined() || passwordValue.isNull()) {
                    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "Expected 'value' to be a string. To delete the secret, call secrets.delete instead."_s);
                    return false;
                } else {
                    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "Expected 'value' to be a string"_s);
                    return false;
                }

                // Extract allowUnrestrictedAccess parameter (optional, defaults to false)
                JSValue allowUnrestrictedAccessValue = getIfPropertyExistsPrototypePollutionMitigation(globalObject, options, Identifier::fromString(vm, "allowUnrestrictedAccess"_s));
                RETURN_IF_EXCEPTION(scope, false);

                if (!allowUnrestrictedAccessValue.isUndefined()) {
                    allowUnrestrictedAccess = allowUnrestrictedAccessValue.toBoolean(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                }
            }

            service = serviceValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            name = nameValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);

            return true;
        };

        switch (operation) {
        case DELETE_OP:
        case SET: {
            if (args.size() > 2 && args.at(0).isString() && args.at(1).isString() && args.at(2).isString()) {
                service = args.at(0).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, nullptr);

                name = args.at(1).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, nullptr);

                password = args.at(2).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, nullptr);

                break;
            }

            if (!fromOptionsObject()) {
                RELEASE_AND_RETURN(scope, nullptr);
            }
            break;
        }

        case GET: {
            if (args.size() > 1 && args.at(0).isString() && args.at(1).isString()) {
                service = args.at(0).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, nullptr);

                name = args.at(1).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, nullptr);
                break;
            }

            if (!fromOptionsObject()) {
                RELEASE_AND_RETURN(scope, nullptr);
            }
            break;
        }

        default: {
            ASSERT_NOT_REACHED();
            break;
        }
        }

        scope.assertNoException();

        if (service.isEmpty() || name.isEmpty()) {
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "Expected service and name to not be empty"_s);
            RELEASE_AND_RETURN(scope, nullptr);
        }

        RELEASE_AND_RETURN(scope, new SecretsJobOptions(operation, service.utf8(), name.utf8(), password.utf8(), allowUnrestrictedAccess));
    }
};

// C interface implementation for Zig binding
extern "C" {

// Runs on the threadpool - does the actual platform API work
void Bun__SecretsJobOptions__runTask(SecretsJobOptions* opts, JSGlobalObject* global)
{
    // Already have CString fields, pass them directly to platform APIs
    switch (opts->op) {
    case SecretsJobOptions::GET: {
        auto result = Secrets::getPassword(opts->service, opts->name, opts->error);
        if (result.has_value()) {
            // Store as String for main thread (String is thread-safe to construct from CString)
            opts->resultPassword = WTF::move(result.value());
        }
        break;
    }

    case SecretsJobOptions::SET:
        opts->error = Secrets::setPassword(opts->service, opts->name, WTF::move(opts->password), opts->allowUnrestrictedAccess);
        break;

    case SecretsJobOptions::DELETE_OP:
        opts->deleted = Secrets::deletePassword(opts->service, opts->name, opts->error);
        break;
    }
}

// Runs on the main thread after threadpool completes - resolves the promise
void Bun__SecretsJobOptions__runFromJS(SecretsJobOptions* opts, JSGlobalObject* global, EncodedJSValue promiseValue)
{
    auto& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSPromise* promise = jsCast<JSPromise*>(JSValue::decode(promiseValue));

    if (opts->error.isError()) {
        if (opts->error.type == Secrets::ErrorType::NotFound) {
            if (opts->op == SecretsJobOptions::GET) {
                // For GET operations, NotFound resolves with null
                RELEASE_AND_RETURN(scope, promise->resolve(global, jsNull()));
            } else if (opts->op == SecretsJobOptions::DELETE_OP) {
                // For DELETE_OP operations, NotFound means we return false
                RELEASE_AND_RETURN(scope, promise->resolve(global, jsBoolean(false)));
            }
        }
        JSValue error = opts->error.toJS(vm, global);
        RETURN_IF_EXCEPTION(scope, );
        RELEASE_AND_RETURN(scope, promise->reject(vm, global, error));
    } else {
        // Success cases
        JSValue result;
        switch (opts->op) {
        case SecretsJobOptions::GET:
            if (opts->resultPassword.has_value()) {
                auto resultPassword = WTF::move(opts->resultPassword.value());
                result = jsString(vm, String::fromUTF8(resultPassword.span()));
                RETURN_IF_EXCEPTION(scope, );
                memsetSpan(resultPassword.mutableSpan(), 0);
            } else {
                result = jsNull();
            }
            break;

        case SecretsJobOptions::SET:
            result = jsUndefined();
            break;

        case SecretsJobOptions::DELETE_OP:
            result = jsBoolean(opts->deleted);
            break;
        }
        RETURN_IF_EXCEPTION(scope, );
        RELEASE_AND_RETURN(scope, promise->resolve(global, result));
    }
}

void Bun__SecretsJobOptions__deinit(SecretsJobOptions* opts)
{
    delete opts;
}

// Zig binding exports
void Bun__Secrets__scheduleJob(JSGlobalObject* global, SecretsJobOptions* opts, EncodedJSValue promise);

} // extern "C"

JSC_DEFINE_HOST_FUNCTION(secretsGet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "secrets.get requires an options object"_s);
        return JSValue::encode(jsUndefined());
    }

    auto* options = SecretsJobOptions::fromJS(globalObject, ArgList(callFrame), SecretsJobOptions::GET);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(options);

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Secrets__scheduleJob(globalObject, options, JSValue::encode(promise));

    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(secretsSet, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    SecretsJobOptions* options = SecretsJobOptions::fromJS(globalObject, ArgList(callFrame), SecretsJobOptions::SET);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(options);

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Secrets__scheduleJob(globalObject, options, JSValue::encode(promise));

    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(secretsDelete, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "secrets.delete requires an options object"_s);
        return JSValue::encode(jsUndefined());
    }

    auto* options = SecretsJobOptions::fromJS(globalObject, ArgList(callFrame), SecretsJobOptions::DELETE_OP);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(options);

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Secrets__scheduleJob(globalObject, options, JSValue::encode(promise));

    return JSValue::encode(promise);
}

JSObject* createSecretsObject(VM& vm, JSGlobalObject* globalObject)
{
    JSObject* object = constructEmptyObject(globalObject);

    object->putDirect(vm, vm.propertyNames->get,
        JSFunction::create(vm, globalObject, 1, "get"_s, secretsGet, ImplementationVisibility::Public),
        PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    object->putDirect(vm, vm.propertyNames->set,
        JSFunction::create(vm, globalObject, 2, "set"_s, secretsSet, ImplementationVisibility::Public),
        PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    object->putDirect(vm, vm.propertyNames->deleteKeyword,
        JSFunction::create(vm, globalObject, 1, "delete"_s, secretsDelete, ImplementationVisibility::Public),
        PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);

    return object;
}

} // namespace Bun

// Must be synced with secret_command.zig's SecretsCliResult
struct SecretsCliResult {
    int error_type;
    int error_code;
    char* error_message;
    char* value;
    size_t value_len;
    bool success;
};

extern "C" SYSV_ABI SecretsCliResult Bun__Secrets__setSync(
    const char* service, size_t service_len,
    const char* name, size_t name_len,
    const char* value, size_t value_len,
    bool allowUnrestrictedAccess)
{
    SecretsCliResult result = {};

    WTF::CString serviceCStr(std::span<const char>(service, service_len));
    WTF::CString nameCStr(std::span<const char>(name, name_len));
    WTF::CString valueCStr(std::span<const char>(value, value_len));

    auto err = Bun::Secrets::setPassword(serviceCStr, nameCStr, WTF::move(valueCStr), allowUnrestrictedAccess);

    // Zero sensitive data after use
    if (valueCStr.length() > 0) {
        memsetSpan(valueCStr.mutableSpan(), 0);
    }
    if (nameCStr.length() > 0) {
        memsetSpan(nameCStr.mutableSpan(), 0);
    }
    if (serviceCStr.length() > 0) {
        memsetSpan(serviceCStr.mutableSpan(), 0);
    }

    if (err.isError()) {
        result.error_type = static_cast<int>(err.type);
        result.error_code = err.code;
        if (!err.message.isEmpty()) {
            auto utf8 = err.message.utf8();
            char* msg = static_cast<char*>(mi_malloc(utf8.length() + 1));
            memcpy(msg, utf8.data(), utf8.length());
            msg[utf8.length()] = '\0';
            result.error_message = msg;
        }
        result.success = false;
    } else {
        result.success = true;
    }

    return result;
}

extern "C" SYSV_ABI SecretsCliResult Bun__Secrets__getSync(
    const char* service, size_t service_len,
    const char* name, size_t name_len)
{
    SecretsCliResult result = {};

    WTF::CString serviceCStr(std::span<const char>(service, service_len));
    WTF::CString nameCStr(std::span<const char>(name, name_len));

    Bun::Secrets::Error err;
    auto maybeValue = Bun::Secrets::getPassword(serviceCStr, nameCStr, err);

    if (err.type == Bun::Secrets::ErrorType::NotFound) {
        result.success = true;
        result.value = nullptr;
        result.value_len = 0;
        return result;
    }
    if (err.isError()) {
        result.error_type = static_cast<int>(err.type);
        result.error_code = err.code;
        if (!err.message.isEmpty()) {
            auto utf8 = err.message.utf8();
            char* msg = static_cast<char*>(mi_malloc(utf8.length() + 1));
            memcpy(msg, utf8.data(), utf8.length());
            msg[utf8.length()] = '\0';
            result.error_message = msg;
        }
        result.success = false;
    } else if (maybeValue.has_value()) {
        auto& valueVec = maybeValue.value();
        auto valueSpan = valueVec.mutableSpan();
        char* valueCopy = static_cast<char*>(mi_malloc(valueSpan.size() + 1));
        memcpy(valueCopy, valueSpan.data(), valueSpan.size());
        valueCopy[valueSpan.size()] = '\0';
        result.value = valueCopy;
        result.value_len = valueSpan.size();
        result.success = true;
        memsetSpan(valueSpan, 0);
    } else {
        result.success = true;
        result.value = nullptr;
        result.value_len = 0;
    }

    return result;
}

extern "C" SYSV_ABI SecretsCliResult Bun__Secrets__deleteSync(
    const char* service, size_t service_len,
    const char* name, size_t name_len)
{
    SecretsCliResult result = {};

    WTF::CString serviceCStr(std::span<const char>(service, service_len));
    WTF::CString nameCStr(std::span<const char>(name, name_len));

    Bun::Secrets::Error err;
    bool deleted = Bun::Secrets::deletePassword(serviceCStr, nameCStr, err);

    if (err.isError() && err.type != Bun::Secrets::ErrorType::NotFound) {
        result.error_type = static_cast<int>(err.type);
        result.error_code = err.code;
        if (!err.message.isEmpty()) {
            auto utf8 = err.message.utf8();
            char* msg = static_cast<char*>(mi_malloc(utf8.length() + 1));
            memcpy(msg, utf8.data(), utf8.length());
            msg[utf8.length()] = '\0';
            result.error_message = msg;
        }
        result.success = false;
    } else {
        result.success = deleted;
    }

    return result;
}

extern "C" SYSV_ABI void Bun__Secrets__freeResult(SecretsCliResult* result)
{
    if (result->error_message) {
        mi_free(result->error_message);
        result->error_message = nullptr;
    }
    if (result->value) {
        memset(result->value, 0, result->value_len);
        mi_free(result->value);
        result->value = nullptr;
    }
}
