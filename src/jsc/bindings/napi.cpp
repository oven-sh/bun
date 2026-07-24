#include "BunProcess.h"
#include "headers.h"
#include "node_api.h"
#include "root.h"
#include "JavaScriptCore/ConstructData.h"

#include "JavaScriptCore/DateInstance.h"
#include "JavaScriptCore/JSCast.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/SourceCode.h"
#include "js_native_api.h"
#include "napi_handle_scope.h"
#include "napi_macros.h"
#include "napi_finalizer.h"
#include "napi_type_tag.h"

#include "helpers.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <wtf/text/ExternalStringImpl.h>
#include <wtf/text/StringCommon.h>
#include <wtf/text/StringImpl.h>
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <wtf/text/StringView.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>
#include <span>
#include "BufferEncodingType.h"
#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/BytecodeIndex.h>
#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/ClassInfo.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/ExceptionScope.h>
#include <JavaScriptCore/FunctionConstructor.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/InitializeThreading.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include "JSFFIFunction.h"
#include <JavaScriptCore/JavaScript.h>
#include "napi.h"
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/StringObject.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include "ScriptExecutionContext.h"

#include "../modules/ObjectModule.h"

#include <JavaScriptCore/JSSourceCode.h>
#include "napi_external.h"
#include "wtf/Assertions.h"
#include "wtf/Compiler.h"
#include "wtf/NakedPtr.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSCommonJSModule.h"
#include "wtf/text/ASCIIFastPath.h"
#include "JavaScriptCore/WeakInlines.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/TZoneMallocInlines.h>
#include "AsyncContextFrame.h"

using namespace JSC;
using namespace Zig;

// Every NAPI function should use this at the start. It does the following:
// - if NAPI_VERBOSE is 1, log that the function was called
// - if env is nullptr, return napi_invalid_arg
// - if there is a pending exception, return napi_pending_exception
// No do..while is used as this declares a variable that other macros need to use
#define NAPI_PREAMBLE(_env)                                             \
    NAPI_LOG_CURRENT_FUNCTION;                                          \
    NAPI_CHECK_ARG(_env, _env);                                         \
    /* You should not use this throw scope directly -- if you need */   \
    /* to throw or clear exceptions, make your own scope */             \
    auto napi_preamble_throw_scope__ = DECLARE_THROW_SCOPE(_env->vm()); \
    NAPI_RETURN_IF_EXCEPTION(_env)

// Only use this for functions that need their own throw or catch scope. Functions that call into
// JS code that might throw should use NAPI_RETURN_IF_EXCEPTION.
#define NAPI_PREAMBLE_NO_THROW_SCOPE(_env) \
    do {                                   \
        NAPI_LOG_CURRENT_FUNCTION;         \
        NAPI_CHECK_ARG(_env, _env);        \
    } while (0)

// Like NAPI_PREAMBLE but does NOT return napi_pending_exception when the env
// has a stashed napi_throw* exception. Mirrors Node.js's CHECK_ENV_NOT_IN_GC
// for pure value constructors/accessors that are safe to call while an
// exception is pending. Still declares a throw scope so NAPI_RETURN_SUCCESS
// can assert and VM-level exceptions from JSC internals are caught.
#define NAPI_PREAMBLE_NO_PENDING_CHECK(_env)                            \
    NAPI_LOG_CURRENT_FUNCTION;                                          \
    NAPI_CHECK_ARG(_env, _env);                                         \
    auto napi_preamble_throw_scope__ = DECLARE_THROW_SCOPE(_env->vm()); \
    NAPI_RETURN_IF_VM_EXCEPTION(_env)

// Return an error code if arg is null. Only use for input validation.
#define NAPI_CHECK_ARG(_env, arg)                               \
    do {                                                        \
        if ((arg) == nullptr) [[unlikely]] {                    \
            return napi_set_last_error(_env, napi_invalid_arg); \
        }                                                       \
    } while (0)

// Assert that the environment is not performing garbage collection
#define NAPI_CHECK_ENV_NOT_IN_GC(_env) \
    do {                               \
        (_env)->checkGC();             \
    } while (0)

// Return the specified code if condition is false. Only use for input validation.
#define NAPI_RETURN_EARLY_IF_FALSE(_env, condition, code) \
    do {                                                  \
        if (!(condition)) {                               \
            return napi_set_last_error(_env, code);       \
        }                                                 \
    } while (0)

// Node's CHECK_TO_OBJECT: ToObject coerces primitives and throws on
// null/undefined; on failure the TypeError is left pending and the call
// returns napi_object_expected. Callers must have run NAPI_PREAMBLE first
// (which already bailed for an env-stashed napi_throw* exception). Declares
// `_result` in the enclosing scope.
#define NAPI_CHECK_TO_OBJECT(_env, _globalObject, _result, _src) \
    JSObject* _result = (_src).toObject((_globalObject));        \
    RETURN_IF_EXCEPTION(napi_preamble_throw_scope__,             \
        napi_set_last_error((_env), napi_object_expected))

// Return an error code if an exception was thrown after NAPI_PREAMBLE
#define NAPI_RETURN_IF_VM_EXCEPTION(_env) RETURN_IF_EXCEPTION(napi_preamble_throw_scope__, napi_set_last_error((_env), napi_pending_exception))

#define NAPI_RETURN_IF_EXCEPTION_WITH_SCOPE(_env, _scope)                                   \
    do {                                                                                    \
        RETURN_IF_EXCEPTION((_scope), napi_set_last_error((_env), napi_pending_exception)); \
        if ((_env)->hasPendingException()) {                                                \
            return napi_set_last_error((_env), napi_pending_exception);                     \
        }                                                                                   \
    } while (0)

#define NAPI_RETURN_IF_EXCEPTION(_env) NAPI_RETURN_IF_EXCEPTION_WITH_SCOPE((_env), napi_preamble_throw_scope__)

// Return indicating that no error occurred in a NAPI function, and an exception is not expected
#define NAPI_RETURN_SUCCESS(_env)                        \
    do {                                                 \
        napi_preamble_throw_scope__.assertNoException(); \
        return napi_set_last_error(_env, napi_ok);       \
    } while (0)

// Return indicating that no error occurred in a NAPI function, unless an exception was thrown and not caught
#define NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(_env) \
    do {                                           \
        NAPI_RETURN_IF_EXCEPTION(_env);            \
        return napi_set_last_error(_env, napi_ok); \
    } while (0)

// Usage: `return napi_set_last_error(napi_ok);`
//
// Sets the global extended error info to indicate the passed-in status, and then returns it.
// All NAPI functions should call this in all places where they return, even if there is no error,
// because the extended error info should always reflect the most recent API call. The only
// exception is napi_get_last_error_info, which should return napi_ok without overwriting the
// extended error info.
//
// Usually, you should use the above macros instead of this function.
//
// This is not part of Node-API, it's a convenience function for Bun.
extern "C" napi_status napi_set_last_error(napi_env env, napi_status status)
{
    if (env) {
        // napi_get_last_error_info will fill in the other fields if they are requested
        env->m_lastNapiErrorInfo.error_code = status;
    }
    return status;
}

// Clear the last error info, similar to Node.js's implementation.
// This is used by functions that need to clear error state safely.
extern "C" napi_status napi_clear_last_error(napi_env env)
{
    if (env) {
        env->m_lastNapiErrorInfo.error_code = napi_ok;
        env->m_lastNapiErrorInfo.engine_error_code = 0;
        env->m_lastNapiErrorInfo.engine_reserved = nullptr;
        env->m_lastNapiErrorInfo.error_message = nullptr;
    }
    return napi_ok;
}

extern "C" napi_status
napi_get_last_error_info(napi_env env, const napi_extended_error_info** result)
{
    // does not use NAPI_PREAMBLE as we don't want to skip the rest of this if there is an exception
    NAPI_LOG_CURRENT_FUNCTION;
    if (!env) {
        return napi_invalid_arg;
    }
    NAPI_CHECK_ARG(env, result);

    constexpr napi_status last_status = napi_would_deadlock;

    constexpr const char* error_messages[] = {
        nullptr, // napi_ok
        "Invalid argument",
        "An object was expected",
        "A string was expected",
        "A string or symbol was expected",
        "A function was expected",
        "A number was expected",
        "A boolean was expected",
        "An array was expected",
        "Unknown failure",
        "An exception is pending",
        "The async work item was cancelled",
        "napi_escape_handle already called on scope",
        "Invalid handle scope usage",
        "Invalid callback scope usage",
        "Thread-safe function queue is full",
        "Thread-safe function handle is closing",
        "A bigint was expected",
        "A date was expected",
        "An arraybuffer was expected",
        "A detachable arraybuffer was expected",
        "Main thread would deadlock",
    };

    static_assert(std::size(error_messages) == last_status + 1,
        "error_messages array does not cover all status codes");

    napi_status status = env->m_lastNapiErrorInfo.error_code;
    if (status >= 0 && status <= last_status) {
        env->m_lastNapiErrorInfo.error_message = error_messages[status];
    } else {
        env->m_lastNapiErrorInfo.error_message = nullptr;
    }

    *result = &env->m_lastNapiErrorInfo;

    // return without napi_return_status as that would overwrite the error info
    return napi_ok;
}

JSC::SourceCode generateSourceCode(WTF::String keyString, JSC::VM& vm, JSC::JSObject* object, JSC::JSGlobalObject* globalObject)
{
    JSC::JSArray* exportKeys = ownPropertyKeys(globalObject, object, PropertyNameMode::StringsAndSymbols, DontEnumPropertiesMode::Include);
    JSC::Identifier ident = JSC::Identifier::fromString(vm, "__BunTemporaryGlobal"_s);
    WTF::StringBuilder sourceCodeBuilder = WTF::StringBuilder();
    // TODO: handle symbol collision
    sourceCodeBuilder.append("\nvar  $$NativeModule = globalThis['__BunTemporaryGlobal']; console.log($$NativeModule); globalThis['__BunTemporaryGlobal'] = null;\n if (!$$NativeModule) { throw new Error('Assertion failure: Native module not found'); }\n\n"_s);

    for (unsigned i = 0; i < exportKeys->length(); i++) {
        auto key = exportKeys->getIndexQuickly(i);
        if (key.isSymbol()) {
            continue;
        }
        auto named = key.toWTFString(globalObject);
        sourceCodeBuilder.append(""_s);
        // TODO: handle invalid identifiers
        sourceCodeBuilder.append("export var "_s);
        sourceCodeBuilder.append(named);
        sourceCodeBuilder.append(" = $$NativeModule."_s);
        sourceCodeBuilder.append(named);
        sourceCodeBuilder.append(";\n"_s);
    }
    globalObject->putDirect(vm, ident, object, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum);
    return JSC::makeSource(sourceCodeBuilder.toString(), JSC::SourceOrigin(), JSC::SourceTaintedOrigin::Untainted, keyString, WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
}

void Napi::NapiRefWeakHandleOwner::finalize(JSC::Handle<JSC::Unknown>, void* context)
{
    auto* weakValue = reinterpret_cast<NapiRef*>(context);
    weakValue->callFinalizer();
}

void Napi::NapiRefSelfDeletingWeakHandleOwner::finalize(JSC::Handle<JSC::Unknown>, void* context)
{
    auto* weakValue = reinterpret_cast<NapiRef*>(context);
    weakValue->callFinalizer();
    delete weakValue;
}

void NAPICallFrame::extract(size_t* argc, napi_value* argv, napi_value* this_arg, void** data, Zig::GlobalObject* globalObject)
{

    if (this_arg != nullptr) {
        *this_arg = ::toNapi(m_callFrame->thisValue(), globalObject);
    }

    if (data != nullptr) {
        *data = dataPtr();
    }

    size_t maxArgc = 0;
    if (argc != nullptr) {
        maxArgc = *argc;
        *argc = m_callFrame->argumentCount();
    }

    if (argv != nullptr) {
        for (size_t i = 0; i < maxArgc; i++) {
            // OK if we overflow argumentCount(), because argument() returns JS undefined
            // for OOB which is what we want
            argv[i] = ::toNapi(m_callFrame->argument(i), globalObject);
        }
    }
}

napi_status Napi::defineProperty(napi_env env, JSC::JSObject* to, const napi_property_descriptor& property, JSC::ThrowScope& scope)
{
    Zig::GlobalObject* globalObject = env->globalObject();
    JSC::VM& vm = JSC::getVM(globalObject);
    void* dataPtr = property.data;

    JSC::Identifier propertyName;
    if (property.utf8name != nullptr) {
        auto span = std::span { reinterpret_cast<const Latin1Character*>(property.utf8name), strlen(property.utf8name) };
        propertyName = JSC::Identifier::fromString(vm, WTF::String::fromUTF8ReplacingInvalidSequences(span).isolatedCopy());
    } else {
        if (!property.name) {
            return napi_name_expected;
        }
        JSValue nameValue = toJS(property.name);
        if (!nameValue.isString() && !nameValue.isSymbol()) {
            return napi_name_expected;
        }
        propertyName = nameValue.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, napi_pending_exception);
    }

    const uint32_t attributes = static_cast<uint32_t>(property.attributes);
    const bool enumerable = attributes & static_cast<uint32_t>(napi_enumerable);
    const bool configurable = attributes & static_cast<uint32_t>(napi_configurable);
    const bool writable = attributes & static_cast<uint32_t>(napi_writable);

    PropertyDescriptor descriptor;
    napi_status failureStatus = napi_invalid_arg;

    if (property.getter != nullptr || property.setter != nullptr) {
        if (property.getter) {
            auto name = makeString("get "_s, propertyName.isSymbol() ? String() : propertyName.string());
            descriptor.setGetter(NapiClass::create(vm, env, name, property.getter, dataPtr, 0, nullptr));
        }
        if (property.setter) {
            auto name = makeString("set "_s, propertyName.isSymbol() ? String() : propertyName.string());
            descriptor.setSetter(NapiClass::create(vm, env, name, property.setter, dataPtr, 0, nullptr));
        }
    } else if (property.method != nullptr) {
        WTF::String name;
        if (!propertyName.isSymbol()) {
            name = propertyName.string();
        }
        descriptor.setValue(NapiClass::create(vm, env, name, property.method, dataPtr, 0, nullptr));
        descriptor.setWritable(writable);
        failureStatus = napi_generic_failure;
    } else {
        JSC::JSValue value = toJS(property.value);
        if (value.isEmpty()) {
            value = JSC::jsUndefined();
        }
        descriptor.setValue(value);
        descriptor.setWritable(writable);
    }

    descriptor.setEnumerable(enumerable);
    descriptor.setConfigurable(configurable);

    bool success = to->methodTable()->defineOwnProperty(to, globalObject, propertyName, descriptor, false);
    RETURN_IF_EXCEPTION(scope, napi_pending_exception);
    if (!success) {
        return failureStatus;
    }
    return napi_ok;
}

extern "C" napi_status napi_set_property(napi_env env, napi_value target,
    napi_value key, napi_value value)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, target);
    NAPI_CHECK_ARG(env, key);
    NAPI_CHECK_ARG(env, value);

    JSValue targetValue = toJS(target);

    auto globalObject = toJS(env);
    NAPI_CHECK_TO_OBJECT(env, globalObject, object, targetValue);

    auto keyProp = toJS(key);

    PutPropertySlot slot(object, false);

    Identifier identifier = keyProp.toPropertyKey(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    JSValue jsValue = toJS(value);

    (void)object->putInline(globalObject, identifier, jsValue, slot);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_set_element(napi_env env, napi_value object_,
    uint32_t index, napi_value value_)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object_);
    NAPI_CHECK_ARG(env, value_);

    JSValue object = toJS(object_);
    JSValue value = toJS(value_);
    NAPI_RETURN_EARLY_IF_FALSE(env, !object.isEmpty() && !value.isEmpty(), napi_invalid_arg);

    auto globalObject = toJS(env);
    NAPI_CHECK_TO_OBJECT(env, globalObject, jsObject, object);

    (void)jsObject->putByIndexInline(globalObject, index, value, false);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_has_element(napi_env env, napi_value object_,
    uint32_t index, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object_);
    NAPI_CHECK_ARG(env, result);

    JSValue object = toJS(object_);
    NAPI_RETURN_EARLY_IF_FALSE(env, !object.isEmpty(), napi_invalid_arg);

    auto globalObject = toJS(env);
    NAPI_CHECK_TO_OBJECT(env, globalObject, jsObject, object);

    bool has_property = jsObject->hasProperty(globalObject, index);
    NAPI_RETURN_IF_EXCEPTION(env);
    *result = has_property;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_has_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, key);

    auto globalObject = toJS(env);
    NAPI_CHECK_TO_OBJECT(env, globalObject, target, toJS(object));

    auto keyProp = toJS(key);
    JSC::PropertyName name = keyProp.toPropertyKey(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    bool hasProperty = target->hasProperty(globalObject, name);
    NAPI_RETURN_IF_EXCEPTION(env);
    *result = hasProperty;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_date_value(napi_env env, napi_value value, double* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);

    JSValue jsValue = toJS(value);

    auto* date = dynamicDowncast<JSC::DateInstance>(jsValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, date != nullptr, napi_date_expected);

    *result = date->internalNumber();
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_property(napi_env env, napi_value object,
    napi_value key, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, key);
    NAPI_CHECK_ARG(env, result);

    auto globalObject = toJS(env);

    NAPI_CHECK_TO_OBJECT(env, globalObject, target, toJS(object));
    JSC::EnsureStillAliveScope ensureAlive(target);

    auto keyProp = toJS(key);
    JSC::EnsureStillAliveScope ensureAlive2(keyProp);
    PropertySlot slot(target, PropertySlot::InternalMethodType::Get);
    auto propertyName = keyProp.toPropertyKey(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    const auto index = parseIndex(propertyName);

    bool hasProperty = index ? target->getPropertySlot(globalObject, *index, slot)
                             : target->getNonIndexPropertySlot(globalObject, propertyName, slot);

    NAPI_RETURN_IF_EXCEPTION(env);

    if (!hasProperty) {
        *result = toNapi(jsUndefined(), globalObject);
    } else {
        JSValue resultValue = slot.getValue(globalObject, propertyName);
        NAPI_RETURN_IF_EXCEPTION(env);
        *result = toNapi(resultValue, globalObject);
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_delete_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, key);

    auto globalObject = toJS(env);

    NAPI_CHECK_TO_OBJECT(env, globalObject, target, toJS(object));

    auto keyProp = toJS(key);
    auto name = JSC::PropertyName(keyProp.toPropertyKey(globalObject));
    NAPI_RETURN_IF_EXCEPTION(env);

    auto deleteResult = target->deleteProperty(globalObject, name);

    NAPI_RETURN_IF_EXCEPTION(env);

    if (result) [[likely]] {
        *result = deleteResult;
    }
    // we checked for an exception above
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_has_own_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, key);
    NAPI_CHECK_ARG(env, result);

    auto globalObject = toJS(env);

    NAPI_CHECK_TO_OBJECT(env, globalObject, target, toJS(object));

    JSValue keyProp = toJS(key);
    NAPI_RETURN_EARLY_IF_FALSE(env, keyProp.isString() || keyProp.isSymbol(), napi_name_expected);

    auto name = JSC::PropertyName(keyProp.toPropertyKey(globalObject));
    NAPI_RETURN_IF_EXCEPTION(env);

    bool hasOwnProperty = target->hasOwnProperty(globalObject, name);
    NAPI_RETURN_IF_EXCEPTION(env);
    *result = hasOwnProperty;
    NAPI_RETURN_SUCCESS(env);
}

// For ASCII input (the common case), avoids UTF-8 decoding overhead by going
// directly through Identifier::fromString(VM&, span<Latin1>), which uses the
// span for a hash lookup in the atom string table without creating an
// intermediate WTF::String. If the atom already exists, no copy occurs at all.
// If the atom does not exist and gets inserted into the table, the characters
// are cloned because we cannot guarantee the lifetime of the input span.
JSC::Identifier identifierFromUtf8(JSC::VM& vm, const char* utf8Name)
{
    size_t utf8Len = strlen(utf8Name);
    std::span<const Latin1Character> utf8Span { reinterpret_cast<const Latin1Character*>(utf8Name), utf8Len };
    return WTF::charactersAreAllASCII(utf8Span)
        ? JSC::Identifier::fromString(vm, utf8Span)
        : JSC::Identifier::fromString(vm, WTF::String::fromUTF8(utf8Span));
}

extern "C" napi_status napi_set_named_property(napi_env env, napi_value object,
    const char* utf8name,
    napi_value value)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, utf8name);
    // TODO find a way to permit empty strings
    NAPI_RETURN_EARLY_IF_FALSE(env, *utf8name, napi_invalid_arg);
    NAPI_CHECK_ARG(env, value);

    auto globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);
    NAPI_CHECK_TO_OBJECT(env, globalObject, target, toJS(object));

    JSValue jsValue = toJS(value);
    JSC::EnsureStillAliveScope ensureAlive(jsValue);
    JSC::EnsureStillAliveScope ensureAlive2(target);

    auto name = identifierFromUtf8(vm, utf8name);
    PutPropertySlot slot(target, false);

    target->putInline(globalObject, name, jsValue, slot);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_create_arraybuffer(napi_env env,
    size_t byte_length, void** data,
    napi_value* result)

{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);

    RefPtr<ArrayBuffer> arrayBuffer = ArrayBuffer::tryCreate(byte_length, 1);
    if (!arrayBuffer) {
        return napi_set_last_error(env, napi_generic_failure);
    }

    auto* jsArrayBuffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), WTF::move(arrayBuffer));
    NAPI_RETURN_IF_EXCEPTION(env);

    if (data && jsArrayBuffer->impl()) [[likely]] {
        *data = jsArrayBuffer->impl()->data();
    }
    *result = toNapi(jsArrayBuffer, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_is_buffer(napi_env env, napi_value value, bool* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    auto jsValue = toJS(value);
    // Despite documentation, Node.js's version of this function returns true for all kinds of
    // TypedArray, not just Uint8Array
    *result = jsValue.isCell() && isTypedArrayTypeIncludingDataView(jsValue.asCell()->type());
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_is_typedarray(napi_env env, napi_value value, bool* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    auto jsValue = toJS(value);
    *result = jsValue.isCell() && isTypedArrayType(jsValue.asCell()->type());
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_has_named_property(napi_env env, napi_value object,
    const char* utf8Name,
    bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, utf8Name);
    NAPI_CHECK_ARG(env, result);

    auto globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);

    NAPI_CHECK_TO_OBJECT(env, globalObject, target, toJS(object));

    JSC::Identifier propertyName = identifierFromUtf8(vm, utf8Name);

    PropertySlot slot(target, PropertySlot::InternalMethodType::HasProperty);
    *result = target->getPropertySlot(globalObject, propertyName, slot);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}
extern "C" napi_status napi_get_named_property(napi_env env, napi_value object,
    const char* utf8Name,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, utf8Name);
    NAPI_CHECK_ARG(env, result);

    auto globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);

    NAPI_CHECK_TO_OBJECT(env, globalObject, target, toJS(object));

    JSC::Identifier propertyName = identifierFromUtf8(vm, utf8Name);

    *result = toNapi(target->get(globalObject, propertyName), globalObject);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" size_t Bun__napi_module_register_count;
void Napi::executePendingNapiModule(Zig::GlobalObject* globalObject)
{
    JSC::VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    ASSERT(globalObject->m_pendingNapiModule);

    auto& mod = *globalObject->m_pendingNapiModule;
    Ref<NapiEnv> env = globalObject->makeNapiEnv(mod);
    auto keyStr = WTF::String::fromUTF8(mod.nm_modname);
    JSValue pendingNapiModule = globalObject->m_pendingNapiModuleAndExports[0].get();
    JSObject* object = (pendingNapiModule && pendingNapiModule.isObject()) ? pendingNapiModule.getObject()
                                                                           : nullptr;

    JSC::Strong<JSC::JSObject> strongExportsObject;

    if (!object) {
        auto* exportsObject = JSC::constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        object = Bun::JSCommonJSModule::create(globalObject, keyStr, exportsObject, false, jsUndefined());
        strongExportsObject = { vm, exportsObject };
    } else {
        JSValue exportsObject = object->get(globalObject, WebCore::builtinNames(vm).exportsPublicName());
        RETURN_IF_EXCEPTION(scope, void());

        // Convert exports to object, matching Node.js behavior.
        // This throws for null/undefined and creates wrapper objects for primitives.
        JSObject* exports = exportsObject.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        ASSERT(exports);
        strongExportsObject = { vm, exports };
    }

    JSC::Strong<JSC::JSObject> strongObject = { vm, object };

    Bun::NapiHandleScope handleScope(globalObject);
    JSValue resultValue;

    if (mod.nm_register_func) {
        resultValue = toJS(mod.nm_register_func(env.ptr(), toNapi(JSValue(strongExportsObject.get()), globalObject)));
    } else {
        JSValue errorInstance = createError(globalObject, makeString("Module has no declared entry point."_s));
        globalObject->m_pendingNapiModuleAndExports[0].set(vm, globalObject, errorInstance);
        return;
    }

    RETURN_IF_EXCEPTION(scope, void());

    if (resultValue.isEmpty()) {
        JSValue errorInstance = createError(globalObject, makeString("Node-API module \""_s, keyStr, "\" returned an error"_s));
        globalObject->m_pendingNapiModuleAndExports[0].set(vm, globalObject, errorInstance);
        return;
    }

    if (!resultValue.isObject()) {
        JSValue errorInstance = createError(globalObject, makeString("Expected Node-API module \""_s, keyStr, "\" to return an exports object"_s));
        globalObject->m_pendingNapiModuleAndExports[0].set(vm, globalObject, errorInstance);
        return;
    }

    auto* meta = new Bun::NapiModuleMeta(globalObject->m_pendingNapiModuleDlopenHandle);

    // TODO: think about the finalizer here
    Bun::NapiExternal* napi_external = Bun::NapiExternal::create(vm, globalObject->NapiExternalStructure(), meta, nullptr, nullptr, env.ptr());

    bool success = resultValue.getObject()->putDirect(vm, WebCore::builtinNames(vm).napiDlopenHandlePrivateName(), napi_external, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    ASSERT(success);

    globalObject->m_pendingNapiModuleDlopenHandle = nullptr;

    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/node_api.cc#L734-L742
    // https://github.com/oven-sh/bun/issues/1288
    if (!scope.exception() && strongExportsObject && strongExportsObject.get() != resultValue) {
        PutPropertySlot slot(strongObject.get(), false);
        strongObject->put(strongObject.get(), globalObject, WebCore::builtinNames(vm).exportsPublicName(), resultValue, slot);
        RETURN_IF_EXCEPTION(scope, void());
    }

    globalObject->m_pendingNapiModuleAndExports[1].set(vm, globalObject, object);
}

extern "C" void napi_module_register(napi_module* mod)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject();
    JSC::VM& vm = JSC::getVM(globalObject);
    // Increment this one even if the module is invalid so that functionDlopen
    // knows that napi_module_register was attempted
    globalObject->napiModuleRegisterCallCount++;

    // Append to vector to accumulate ALL module registrations during dlopen
    if (mod && mod->nm_register_func) {
        globalObject->m_pendingNapiModules.append(*mod);
        // Increment the counter to signal that a module registered itself
        Bun__napi_module_register_count++;
    } else {
        JSValue errorInstance = createError(globalObject, makeString("Module has no declared entry point."_s));
        globalObject->m_pendingNapiModuleAndExports[0].set(vm, globalObject, errorInstance);
    }
}

static void wrap_cleanup(napi_env env, void* data, void* hint)
{
    auto* ref = reinterpret_cast<NapiRef*>(data);
    ASSERT(ref->boundCleanup != nullptr);
    ref->boundCleanup->deactivate(*env);
    ref->boundCleanup = nullptr;
    ref->callFinalizer();
}

static inline NapiRef* getWrapContentsIfExists(VM& vm, JSGlobalObject* globalObject, JSObject* object)
{
    if (auto* napi_instance = dynamicDowncast<NapiPrototype>(object)) {
        return napi_instance->napiRef;
    } else {
        JSValue contents = object->getDirect(vm, WebCore::builtinNames(vm).napiWrappedContentsPrivateName());
        if (contents.isEmpty()) {
            return nullptr;
        } else {
            // jsCast asserts: we should not have stored anything but a NapiExternal here
            return static_cast<NapiRef*>(uncheckedDowncast<Bun::NapiExternal>(contents)->value());
        }
    }
}

extern "C" napi_status napi_wrap(napi_env env,
    napi_value js_object,
    void* native_object,
    napi_finalize finalize_cb,

    // Typically when wrapping a class instance, a finalize callback should be
    // provided that simply deletes the native instance that is received as the
    // data argument to the finalize callback.
    void* finalize_hint,

    napi_ref* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, js_object);

    auto* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);
    JSValue jsc_value = toJS(js_object);
    JSObject* jsc_object = jsc_value.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsc_object, napi_object_expected);

    // NapiPrototype has an inline field to store a napi_ref, so we use that if we can
    auto* napi_instance = dynamicDowncast<NapiPrototype>(jsc_object);

    const JSC::Identifier& propertyName = WebCore::builtinNames(vm).napiWrappedContentsPrivateName();

    // if this is nonnull then the object has already been wrapped
    NapiRef* existing_wrap = getWrapContentsIfExists(vm, globalObject, jsc_object);
    NAPI_RETURN_EARLY_IF_FALSE(env, existing_wrap == nullptr, napi_invalid_arg);

    // create a new weak reference (refcount 0)
    auto* ref = new NapiRef(*env, 0, Bun::NapiFinalizer { finalize_cb, finalize_hint });
    // In case the ref's finalizer is never called, we'll add a finalizer to execute on exit.
    const auto& bound_cleanup = env->addFinalizer(wrap_cleanup, native_object, ref);
    ref->boundCleanup = &bound_cleanup;
    ref->nativeObject = native_object;

    if (napi_instance) {
        napi_instance->napiRef = ref;
    } else {
        // wrap the ref in an external so that it can serve as a JSValue
        auto* external = Bun::NapiExternal::create(JSC::getVM(globalObject), globalObject->NapiExternalStructure(), ref, nullptr, nullptr, env);
        jsc_object->putDirect(vm, propertyName, JSValue(external));
    }

    if (result) {
        ref->weakValueRef.set(jsc_value, Napi::NapiRefWeakHandleOwner::weakValueHandleOwner(), ref);
        *result = toNapi(ref);
    } else {
        ref->weakValueRef.set(jsc_value, Napi::NapiRefSelfDeletingWeakHandleOwner::weakValueHandleOwner(), ref);
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_remove_wrap(napi_env env, napi_value js_object,
    void** result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, js_object);

    JSValue jsc_value = toJS(js_object);
    JSObject* jsc_object = jsc_value.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsc_object, napi_object_expected);
    // may be null
    auto* napi_instance = dynamicDowncast<NapiPrototype>(jsc_object);

    Zig::GlobalObject* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);
    NapiRef* ref = getWrapContentsIfExists(vm, globalObject, jsc_object);
    NAPI_RETURN_EARLY_IF_FALSE(env, ref, napi_invalid_arg);

    if (napi_instance) {
        napi_instance->napiRef = nullptr;
    } else {
        const JSC::Identifier& propertyName = WebCore::builtinNames(vm).napiWrappedContentsPrivateName();
        jsc_object->deleteProperty(globalObject, propertyName);
    }

    if (result) {
        *result = ref->nativeObject;
    }

    ref->finalizer.clear();

    // don't delete the ref: if weak, it'll delete itself when the JS object is deleted;
    // if strong, native addon needs to clean it up.
    // the external is garbage collected.
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_unwrap(napi_env env, napi_value js_object,
    void** result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, js_object);
    NAPI_CHECK_ARG(env, result);

    JSValue jsc_value = toJS(js_object);
    JSObject* jsc_object = jsc_value.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsc_object, napi_object_expected);

    Zig::GlobalObject* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);
    NapiRef* ref = getWrapContentsIfExists(vm, globalObject, jsc_object);
    NAPI_RETURN_EARLY_IF_FALSE(env, ref, napi_invalid_arg);

    *result = ref->nativeObject;

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_function(napi_env env, const char* utf8name,
    size_t length, napi_callback cb,
    void* data, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, cb);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);
    auto name = WTF::String();

    if (utf8name != nullptr) {
        name = WTF::String::fromUTF8({ utf8name, length == NAPI_AUTO_LENGTH ? strlen(utf8name) : length });
    }

    auto function = NapiClass::create(vm, env, name, cb, data, 0, nullptr);

    ASSERT(function->isCallable());
    *result = toNapi(JSValue(function), globalObject);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_cb_info(
    napi_env env, // [in] NAPI environment handle
    napi_callback_info cbinfo, // [in] Opaque callback-info handle
    size_t* argc, // [in-out] Specifies the size of the provided argv array
                  // and receives the actual count of args.
    napi_value* argv, // [out] Array of values
    napi_value* this_arg, // [out] Receives the JS 'this' arg for the call
    void** data) // [out] Receives the data pointer for the callback
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, cbinfo);

    auto* callFrame = reinterpret_cast<NAPICallFrame*>(cbinfo);
    Zig::GlobalObject* globalObject = toJS(env);

    callFrame->extract(argc, argv, this_arg, data, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status
napi_define_properties(napi_env env, napi_value object, size_t property_count,
    const napi_property_descriptor* properties)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    NAPI_RETURN_IF_EXCEPTION_WITH_SCOPE(env, throwScope);
    NAPI_CHECK_ARG(env, object);
    NAPI_RETURN_EARLY_IF_FALSE(env, properties || property_count == 0, napi_invalid_arg);

    JSValue objectValue = toJS(object);
    JSC::JSObject* objectObject = objectValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, objectObject, napi_object_expected);

    for (size_t i = 0; i < property_count; i++) {
        napi_status status = Napi::defineProperty(env, objectObject, properties[i], throwScope);

        RETURN_IF_EXCEPTION(throwScope, napi_set_last_error(env, napi_pending_exception));
        if (status != napi_ok) {
            return napi_set_last_error(env, status);
        }
    }

    throwScope.release();
    return napi_set_last_error(env, napi_ok);
}

static JSC::ErrorInstance* createErrorWithCode(JSC::VM& vm, JSC::JSGlobalObject* globalObject, const WTF::String& code, const WTF::String& message, JSC::ErrorType type)
{
    // no napi functions permit a null message, they must check before calling this function and
    // return the right error code
    ASSERT(!message.isNull());

    // we don't call JSC::createError() as it asserts the message is not an empty string ""
    auto* error = JSC::ErrorInstance::create(vm, globalObject->errorStructure(type), message, JSValue(), nullptr, RuntimeType::TypeNothing, type);
    if (!code.isNull()) {
        error->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), JSC::jsString(vm, code), 0);
    }

    return error;
}

// used to implement napi_throw_*_error
static napi_status throwErrorWithCStrings(napi_env env, const char* code_utf8, const char* msg_utf8, JSC::ErrorType type)
{
    auto* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);

    if (!msg_utf8) {
        return napi_set_last_error(env, napi_invalid_arg);
    }

    WTF::String code = code_utf8 ? WTF::String::fromUTF8(code_utf8) : WTF::String();
    WTF::String message = WTF::String::fromUTF8(msg_utf8);

    JSC::ErrorInstance* error = createErrorWithCode(vm, globalObject, code, message, type);
    env->scheduleException(error);
    return napi_set_last_error(env, napi_ok);
}

// code must be a string or nullptr (no code)
// msg must be a string
//
// Matches Node.js, where napi_create_error is a pure value producer that
// does not check the VM exception state on entry. Bun previously used a
// throw scope + RETURN_IF_EXCEPTION here, so a *pre-existing* VM exception
// made napi_create_error return napi_pending_exception. That broke
// node-addon-api's `Error::New(env)` during env cleanup: the helper calls
// napi_is_exception_pending (which Bun deliberately skips the VM check for
// during cleanup, so it reports "no pending exception"), then falls through
// to napi_create_error; when a prior finalizer left a VM exception on the
// scope, the mismatch tripped NAPI_FATAL_IF_FAILED -> napi_fatal_error ->
// panic. See #30286 and #22259.
//
// We use a TopExceptionScope (not a throw scope) so a pre-existing exception
// does not force an early return. But we must NOT leave a *new* exception
// pending either: getString() resolves rope strings and can throw
// OutOfMemoryError, and returning napi_ok with an unchecked exception on the
// VM crashes later. So we clear only what our own string resolution / error
// construction raised, leaving any pre-existing exception untouched (matching
// Node.js, which never disturbs the caller's pending exception) and never
// clearing a termination exception (which must keep unwinding).
static napi_status createErrorWithNapiValues(napi_env env, napi_value code, napi_value message, JSC::ErrorType type, napi_value* result)
{
    auto* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, message);
    JSValue js_code = toJS(code);
    JSValue js_message = toJS(message);
    NAPI_RETURN_EARLY_IF_FALSE(env,
        js_message.isString() && (js_code.isEmpty() || js_code.isString()),
        napi_string_expected);

    JSC::Exception* preExisting = scope.exception();
    auto wtf_code = js_code.isEmpty() ? WTF::String() : js_code.getString(globalObject);
    auto wtf_message = js_message.getString(globalObject);

    *result = toNapi(
        createErrorWithCode(vm, globalObject, wtf_code, wtf_message, type),
        globalObject);

    if (scope.exception() && scope.exception() != preExisting)
        scope.clearExceptionExceptTermination();
    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_throw_error(napi_env env,
    const char* code,
    const char* msg)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    return throwErrorWithCStrings(env, code, msg, JSC::ErrorType::Error);
}

extern "C" napi_status napi_create_reference(napi_env env, napi_value value,
    uint32_t initial_refcount,
    napi_ref* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);

    JSC::JSValue val = toJS(value);

    bool can_be_weak = true;

    if (!(val.isObject() || val.isCallable() || val.isSymbol())) {
        NAPI_RETURN_EARLY_IF_FALSE(env, env->napiModule().nm_version == NAPI_VERSION_EXPERIMENTAL, napi_invalid_arg);
        can_be_weak = false;
    }

    auto* ref = new NapiRef(*env, initial_refcount, Bun::NapiFinalizer {});
    ref->setValueInitial(val, can_be_weak);

    *result = toNapi(ref);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" void napi_set_ref(NapiRef* ref, JSC::EncodedJSValue val_)
{
    NAPI_LOG_CURRENT_FUNCTION;
    JSC::JSValue val = JSC::JSValue::decode(val_);
    if (val) {
        ref->strongRef.set(JSC::getVM(&*ref->globalObject), val);
    } else {
        ref->strongRef.clear();
    }
}

extern "C" napi_status napi_add_finalizer(napi_env env, napi_value js_object,
    void* native_object,
    napi_finalize finalize_cb,
    void* finalize_hint,
    napi_ref* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, js_object);
    NAPI_CHECK_ARG(env, finalize_cb);
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::JSValue objectValue = toJS(js_object);
    JSC::JSObject* object = objectValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, object, napi_object_expected);

    if (result) {
        // If they're expecting a Ref, use the ref.
        auto* ref = new NapiRef(*env, 0, Bun::NapiFinalizer { finalize_cb, finalize_hint });
        // TODO(@heimskr): consider detecting whether the value can't be weak, as we do in napi_create_reference.
        ref->setValueInitial(object, true);
        ref->nativeObject = native_object;
        *result = toNapi(ref);
    } else {
        // Otherwise, it's cheaper to just call .addFinalizer.
        vm.heap.addFinalizer(object, [env = WTF::Ref<NapiEnv>(*env), finalize_cb, native_object, finalize_hint](JSCell* cell) -> void {
            NAPI_LOG("finalizer %p", finalize_hint);
            env->doFinalizer(finalize_cb, native_object, finalize_hint);
        });
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status node_api_post_finalizer(napi_env env,
    napi_finalize finalize_cb,
    void* finalize_data,
    void* finalize_hint)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, finalize_cb);
    napi_internal_enqueue_finalizer(env, finalize_cb, finalize_data, finalize_hint);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_reference_unref(napi_env env, napi_ref ref,
    uint32_t* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, ref);

    NapiRef* napiRef = toJS(ref);

    if (napiRef->refCount == 0) {
        return napi_set_last_error(env, napi_generic_failure);
    }

    napiRef->unref();
    if (result) [[likely]] {
        *result = napiRef->refCount;
    }
    NAPI_RETURN_SUCCESS(env);
}

// Attempts to get a referenced value. If the reference is weak,
// the value might no longer be available, in that case the call
// is still successful but the result is NULL.
extern "C" napi_status napi_get_reference_value(napi_env env, napi_ref ref,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, ref);
    NAPI_CHECK_ARG(env, result);
    NapiRef* napiRef = toJS(ref);
    *result = toNapi(napiRef->value(), toJS(env));

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_reference_ref(napi_env env, napi_ref ref,
    uint32_t* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, ref);
    NapiRef* napiRef = toJS(ref);
    napiRef->ref();
    if (result) [[likely]] {
        *result = napiRef->refCount;
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_delete_reference(napi_env env, napi_ref ref)
{
    // This function must be callable from finalizers that run while the
    // garbage collector is sweeping: deleting the reference returned by
    // napi_wrap is documented to be done from the finalize callback, and
    // node-addon-api's ObjectWrap destructor relies on that. Node declares
    // napi_delete_reference with node_api_basic_env and deliberately omits
    // both CHECK_ENV_NOT_IN_GC and the pending-exception check, so we must
    // not use NAPI_CHECK_ENV_NOT_IN_GC or the throw-scope preamble here.
    // Deleting the NapiRef mid-sweep is safe: its WeakImpl is already in the
    // Finalized state, so clearing it only marks it Deallocated.
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ARG(env, ref);
    NapiRef* napiRef = toJS(ref);
    delete napiRef;
    return napi_clear_last_error(env);
}

extern "C" napi_status napi_is_detached_arraybuffer(napi_env env,
    napi_value arraybuffer,
    bool* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, arraybuffer);
    NAPI_CHECK_ARG(env, result);

    // Node computes IsArrayBuffer() && WasDetached() and always returns
    // napi_ok; a non-ArrayBuffer (including SharedArrayBuffer) yields false.
    JSC::JSArrayBuffer* jsArrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(toJS(arraybuffer));
    *result = jsArrayBuffer && !jsArrayBuffer->isShared() && jsArrayBuffer->impl()->isDetached();
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_detach_arraybuffer(napi_env env,
    napi_value arraybuffer)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, arraybuffer);
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::JSArrayBuffer* jsArrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(toJS(arraybuffer));
    // V8's IsArrayBuffer() is false for SharedArrayBuffer; JSC uses the same
    // cell type for both, so reject shared buffers here to match Node instead
    // of returning napi_ok for a buffer that was never neutralized.
    NAPI_RETURN_EARLY_IF_FALSE(env, jsArrayBuffer && !jsArrayBuffer->isShared(), napi_arraybuffer_expected);

    auto* arrayBuffer = jsArrayBuffer->impl();
    // Node then requires IsDetachable(). Detaching an already-detached buffer
    // is a no-op in both engines, so treat that as success.
    NAPI_RETURN_EARLY_IF_FALSE(env, arrayBuffer->isDetached() || arrayBuffer->isDetachable(), napi_detachable_arraybuffer_expected);
    if (!arrayBuffer->isDetached()) {
        arrayBuffer->detach(vm);
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_adjust_external_memory(napi_env env,
    int64_t change_in_bytes,
    int64_t* adjusted_value)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, adjusted_value);

    // V8 tracks this via an atomic int64 (wrapping on overflow) and Node never
    // returns an error here; do the add in unsigned space so overflow wraps
    // instead of hitting signed-overflow UB.
    env->m_externalMemory = static_cast<int64_t>(
        static_cast<uint64_t>(env->m_externalMemory) + static_cast<uint64_t>(change_in_bytes));
    if (change_in_bytes > 0) {
        toJS(env)->vm().heap.deprecatedReportExtraMemory(static_cast<size_t>(change_in_bytes));
    }
    *adjusted_value = env->m_externalMemory;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_is_exception_pending(napi_env env, bool* result)
{
    // NAPI_PREAMBLE is not used here: this function must execute when there is a
    // pending exception, including during cleanup.
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    // First check if the environment has a pending exception
    *result = env->hasPendingException();

    // If no exception is pending in the environment, check the VM's exception state
    // but only if it's safe to access the VM (not during cleanup)
    if (!*result && !env->isFinishingFinalizers()) {
        auto globalObject = toJS(env);
        if (globalObject) {
            auto& vm = JSC::getVM(globalObject);
            // Use a catch scope instead of throw scope for safety during cleanup
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            *result = scope.exception() != nullptr;
        }
    }

    return napi_clear_last_error(env);
}

extern "C" napi_status napi_get_and_clear_last_exception(napi_env env,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);

    if (!result) [[unlikely]] {
        return napi_set_last_error(env, napi_invalid_arg);
    }

    auto globalObject = toJS(env);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(JSC::getVM(globalObject));
    if (scope.exception()) [[unlikely]] {
        *result = toNapi(JSValue(scope.exception()->value()), globalObject);
    } else if (std::optional<JSValue> pending = env->pendingException()) {
        *result = toNapi(pending.value(), globalObject);
        env->clearPendingException();
    } else {
        *result = toNapi(JSC::jsUndefined(), globalObject);
    }
    (void)scope.tryClearException();

    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_fatal_exception(napi_env env,
    napi_value err)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, err);
    auto globalObject = toJS(env);
    JSValue value = toJS(err);

    Bun__reportUnhandledError(globalObject, JSValue::encode(value));

    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_throw(napi_env env, napi_value error)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    if (env->isFinishingFinalizers()) {
        return napi_set_last_error(env, env->napiModule().nm_version >= 10 ? napi_cannot_run_js : napi_pending_exception);
    }
    NAPI_CHECK_ARG(env, error);
    env->scheduleException(toJS(error));
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status node_api_symbol_for(napi_env env,
    const char* utf8description,
    size_t length, napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    auto* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    if (utf8description == nullptr) {
        if (length == 0) {
            utf8description = "";
        } else {
            NAPI_CHECK_ARG(env, utf8description);
        }
    }

    auto description = WTF::String::fromUTF8({ utf8description, length == NAPI_AUTO_LENGTH ? strlen(utf8description) : length });
    *result = toNapi(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(description)), globalObject);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status node_api_create_syntax_error(napi_env env,
    napi_value code,
    napi_value msg,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    return createErrorWithNapiValues(env, code, msg, JSC::ErrorType::SyntaxError, result);
}

extern "C" napi_status node_api_throw_syntax_error(napi_env env,
    const char* code,
    const char* msg)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    return throwErrorWithCStrings(env, code, msg, JSC::ErrorType::SyntaxError);
}

extern "C" napi_status napi_throw_type_error(napi_env env, const char* code,
    const char* msg)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    return throwErrorWithCStrings(env, code, msg, JSC::ErrorType::TypeError);
}

extern "C" napi_status napi_create_type_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    return createErrorWithNapiValues(env, code, msg, JSC::ErrorType::TypeError, result);
}

extern "C" JS_EXPORT napi_status
node_api_create_external_string_latin1(napi_env env,
    char* str,
    size_t length,
    napi_finalize finalize_callback,
    void* finalize_hint,
    napi_value* result,
    bool* copied)
{
    // https://nodejs.org/api/n-api.html#node_api_create_external_string_latin1
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, str);
    NAPI_CHECK_ARG(env, result);
    // Reject while a napi exception is pending before adopting str, so the caller
    // cleanly retains ownership (matches napi_create_external_buffer/_arraybuffer).
    NAPI_RETURN_EARLY_IF_FALSE(env, !env->hasPendingException(), napi_pending_exception);

    length = length == NAPI_AUTO_LENGTH ? strlen(str) : length;
    Zig::GlobalObject* globalObject = toJS(env);

    if (copied) {
        *copied = false;
    }

    // WTF::ExternalStringImpl does not allow zero-length strings; match Node.js/V8 by
    // returning the empty string and disposing the caller's buffer immediately.
    if (length == 0) {
        *result = toNapi(JSC::jsEmptyString(JSC::getVM(globalObject)), globalObject);
        env->doFinalizer(finalize_callback, str, finalize_hint);
        NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
    }

    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ reinterpret_cast<const Latin1Character*>(str), static_cast<unsigned int>(length) }, finalize_hint, [finalize_callback, env](void* hint, void* str, unsigned length) {
        NAPI_LOG("latin1 string finalizer");
        env->doFinalizer(finalize_callback, str, hint);
    });

    JSString* out = JSC::jsString(JSC::getVM(globalObject), WTF::String(WTF::move(impl)));
    ensureStillAliveHere(out);
    *result = toNapi(out, globalObject);
    ensureStillAliveHere(out);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status
node_api_create_external_string_utf16(napi_env env,
    char16_t* str,
    size_t length,
    napi_finalize finalize_callback,
    void* finalize_hint,
    napi_value* result,
    bool* copied)
{
    // https://nodejs.org/api/n-api.html#node_api_create_external_string_utf16
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, str);
    NAPI_CHECK_ARG(env, result);
    // Reject while a napi exception is pending before adopting str, so the caller
    // cleanly retains ownership (matches napi_create_external_buffer/_arraybuffer).
    NAPI_RETURN_EARLY_IF_FALSE(env, !env->hasPendingException(), napi_pending_exception);

    length = length == NAPI_AUTO_LENGTH ? std::char_traits<char16_t>::length(str) : length;
    Zig::GlobalObject* globalObject = toJS(env);

    if (copied) {
        *copied = false;
    }

    // WTF::ExternalStringImpl does not allow zero-length strings; match Node.js/V8 by
    // returning the empty string and disposing the caller's buffer immediately.
    if (length == 0) {
        *result = toNapi(JSC::jsEmptyString(JSC::getVM(globalObject)), globalObject);
        env->doFinalizer(finalize_callback, str, finalize_hint);
        NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
    }

    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(str), static_cast<unsigned int>(length) }, finalize_hint, [finalize_callback, env](void* hint, void* str, unsigned length) {
        NAPI_LOG("utf16 string finalizer");
        env->doFinalizer(finalize_callback, str, hint);
    });

    JSString* out = JSC::jsString(JSC::getVM(globalObject), WTF::String(WTF::move(impl)));
    ensureStillAliveHere(out);
    *result = toNapi(out, globalObject);
    ensureStillAliveHere(out);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status node_api_create_property_key_latin1(napi_env env, const char* str, size_t length, napi_value* result)
{
    // EXPERIMENTAL
    // This is semantically correct but it may not have the performance benefit intended for node_api_create_property_key_latin1
    // TODO(@190n) use jsAtomString or something
    NAPI_LOG_CURRENT_FUNCTION;
    return napi_create_string_latin1(env, str, length, result);
}

extern "C" JS_EXPORT napi_status node_api_create_property_key_utf16(napi_env env, const char16_t* str, size_t length, napi_value* result)
{
    // EXPERIMENTAL
    // This is semantically correct but it may not have the performance benefit intended for node_api_create_property_key_utf16
    // TODO(@190n) use jsAtomString or something
    NAPI_LOG_CURRENT_FUNCTION;
    return napi_create_string_utf16(env, str, length, result);
}

extern "C" JS_EXPORT napi_status node_api_create_property_key_utf8(napi_env env, const char* str, size_t length, napi_value* result)
{
    // EXPERIMENTAL
    // This is semantically correct but it may not have the performance benefit intended for node_api_create_property_key_utf8
    // TODO(@190n) use jsAtomString or something
    NAPI_LOG_CURRENT_FUNCTION;
    return napi_create_string_utf8(env, str, length, result);
}

extern "C" JS_EXPORT napi_status node_api_create_buffer_from_arraybuffer(napi_env env,
    napi_value arraybuffer,
    size_t byte_offset,
    size_t byte_length,
    napi_value* result)
{
    NAPI_LOG_CURRENT_FUNCTION;
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    auto* globalObject = toJS(env);
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    NAPI_RETURN_IF_EXCEPTION_WITH_SCOPE(env, scope);
    NAPI_CHECK_ARG(env, arraybuffer);
    NAPI_CHECK_ARG(env, result);

    JSC::JSArrayBuffer* jsArrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(toJS(arraybuffer));
    NAPI_RETURN_EARLY_IF_FALSE(env, jsArrayBuffer, napi_arraybuffer_expected);

    auto* impl = jsArrayBuffer->impl();

    if (!impl || byte_offset + byte_length > impl->byteLength()) [[unlikely]] {
        auto* error = createErrorWithCode(JSC::getVM(globalObject), globalObject, "ERR_OUT_OF_RANGE"_s, "The byte offset + length is out of range"_s, JSC::ErrorType::RangeError);
        RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
        env->scheduleException(error);
        return napi_set_last_error(env, napi_pending_exception);
    }

    auto* subclassStructure = globalObject->JSBufferSubclassStructure();
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(globalObject, subclassStructure, impl, byte_offset, byte_length);
    RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));

    *result = toNapi(uint8Array, globalObject);

    return napi_set_last_error(env, napi_ok);
}

extern "C" JS_EXPORT napi_status node_api_get_module_file_name(napi_env env,
    const char** result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, result);
    *result = env->filename;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status node_api_set_prototype(napi_env env,
    napi_value object, napi_value value)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, object);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSObject* obj = toJS(object).getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, obj, napi_object_expected);

    // JSC's setPrototypeDirect asserts prototype.isObject() || prototype.isNull();
    // reject primitives here rather than reaching the engine assertion.
    JSValue protoValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, protoValue.isObject() || protoValue.isNull(), napi_invalid_arg);

    bool didSet = obj->setPrototype(vm, globalObject, protoValue, false);
    NAPI_RETURN_IF_EXCEPTION(env);
    NAPI_RETURN_EARLY_IF_FALSE(env, didSet, napi_generic_failure);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status node_api_create_object_with_properties(napi_env env,
    napi_value prototype_or_null,
    napi_value* property_names,
    napi_value* property_values,
    size_t property_count,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    if (property_count > 0) {
        NAPI_CHECK_ARG(env, property_names);
        NAPI_CHECK_ARG(env, property_values);
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    for (size_t i = 0; i < property_count; i++) {
        JSValue name = toJS(property_names[i]);
        NAPI_RETURN_EARLY_IF_FALSE(env, !name.isEmpty() && (name.isString() || name.isSymbol()), napi_name_expected);
    }

    JSValue prototype = prototype_or_null ? toJS(prototype_or_null) : jsNull();
    NAPI_RETURN_EARLY_IF_FALSE(env, prototype.isObject() || prototype.isNull(), napi_invalid_arg);
    JSObject* obj;
    if (prototype.isObject()) {
        obj = constructEmptyObject(globalObject, prototype.getObject());
    } else {
        obj = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    }
    JSC::EnsureStillAliveScope ensureAlive(obj);

    for (size_t i = 0; i < property_count; i++) {
        auto name = JSC::PropertyName(toJS(property_names[i]).toPropertyKey(globalObject));
        NAPI_RETURN_IF_EXCEPTION(env);
        JSValue value = toJS(property_values[i]);
        obj->putDirectMayBeIndex(globalObject, name, value.isEmpty() ? jsUndefined() : value);
        NAPI_RETURN_IF_EXCEPTION(env);
    }

    *result = toNapi(obj, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status node_api_is_sharedarraybuffer(napi_env env,
    napi_value value, bool* result)
{
    NAPI_LOG_CURRENT_FUNCTION;
    NAPI_CHECK_ARG(env, env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    auto* jsArrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(toJS(value));
    *result = jsArrayBuffer && jsArrayBuffer->isShared();
    return napi_set_last_error(env, napi_ok);
}

extern "C" JS_EXPORT napi_status node_api_create_sharedarraybuffer(napi_env env,
    size_t byte_length, void** data, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    RefPtr<ArrayBuffer> arrayBuffer = ArrayBuffer::tryCreate(byte_length, 1);
    if (!arrayBuffer) {
        return napi_set_last_error(env, napi_generic_failure);
    }
    arrayBuffer->makeShared();

    auto* jsArrayBuffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(ArrayBufferSharingMode::Shared), WTF::move(arrayBuffer));
    NAPI_RETURN_IF_EXCEPTION(env);

    if (data && jsArrayBuffer->impl()) [[likely]] {
        *data = jsArrayBuffer->impl()->data();
    }
    *result = toNapi(jsArrayBuffer, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

typedef void (*node_api_noenv_finalize)(void* finalize_data, void* finalize_hint);

// SharedArrayBuffer backing stores can outlive the creating napi_env (they
// may be posted to other agents), so Node-API specifies a finalizer with no
// env parameter. This destructor mirrors NapiExternalBufferDestructor but
// calls a (data, hint) callback directly instead of routing through
// NapiEnv::doFinalizer.
class NapiNoEnvExternalBufferDestructor final : public SharedTask<void(void*)> {
public:
    NapiNoEnvExternalBufferDestructor(node_api_noenv_finalize cb, void* hint)
        : m_cb(cb)
        , m_hint(hint)
    {
    }

    void run(void* data) override
    {
        if (m_armed && m_cb) {
            m_cb(data, m_hint);
        }
    }

    void arm() { m_armed = true; }

private:
    node_api_noenv_finalize m_cb;
    void* m_hint;
    bool m_armed { false };
};

extern "C" JS_EXPORT napi_status node_api_create_external_sharedarraybuffer(napi_env env,
    void* external_data, size_t byte_length,
    node_api_noenv_finalize finalize_cb, void* finalize_hint,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_RETURN_EARLY_IF_FALSE(env, !env->hasPendingException(), napi_pending_exception);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    Ref<NapiNoEnvExternalBufferDestructor> destructor = adoptRef(*new NapiNoEnvExternalBufferDestructor(finalize_cb, finalize_hint));
    auto* destructorPtr = destructor.ptr();
    auto arrayBuffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(external_data), byte_length }, WTF::move(destructor));
    arrayBuffer->makeShared();

    auto* buffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(ArrayBufferSharingMode::Shared), WTF::move(arrayBuffer));
    destructorPtr->arm();

    *result = toNapi(buffer, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    return createErrorWithNapiValues(env, code, msg, JSC::ErrorType::Error, result);
}
extern "C" napi_status napi_throw_range_error(napi_env env, const char* code,
    const char* msg)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    return throwErrorWithCStrings(env, code, msg, JSC::ErrorType::RangeError);
}

extern "C" napi_status napi_object_freeze(napi_env env, napi_value object_value)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object_value);
    JSC::JSValue value = toJS(object_value);
    NAPI_RETURN_EARLY_IF_FALSE(env, value.isObject(), napi_object_expected);

    Zig::GlobalObject* globalObject = toJS(env);

    JSC::JSObject* object = uncheckedDowncast<JSC::JSObject>(value);
    objectConstructorFreeze(globalObject, object);
    NAPI_RETURN_IF_EXCEPTION(env);

    NAPI_RETURN_SUCCESS(env);
}
extern "C" napi_status napi_object_seal(napi_env env, napi_value object_value)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object_value);
    JSC::JSValue value = toJS(object_value);
    NAPI_RETURN_EARLY_IF_FALSE(env, value.isObject(), napi_object_expected);

    Zig::GlobalObject* globalObject = toJS(env);

    JSC::JSObject* object = uncheckedDowncast<JSC::JSObject>(value);
    objectConstructorSeal(globalObject, object);
    NAPI_RETURN_IF_EXCEPTION(env);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_global(napi_env env, napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    Zig::GlobalObject* globalObject = toJS(env);
    // TODO change to global? or find another way to avoid JSGlobalProxy
    *result = toNapi(globalObject->globalThis(), globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_range_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    return createErrorWithNapiValues(env, code, msg, JSC::ErrorType::RangeError, result);
}

extern "C" napi_status napi_get_new_target(napi_env env,
    napi_callback_info cbinfo,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    // handle:
    // - if they call this function when it was originally a getter/setter call
    // - if they call this function without a result
    NAPI_CHECK_ARG(env, cbinfo);
    NAPI_CHECK_ARG(env, result);

    auto* callFrame = reinterpret_cast<NAPICallFrame*>(cbinfo);
    JSC::JSValue newTarget = callFrame->newTarget();
    *result = toNapi(newTarget, toJS(env));
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_dataview(napi_env env, size_t length,
    napi_value arraybuffer,
    size_t byte_offset,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    Zig::GlobalObject* globalObject = toJS(env);
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    NAPI_RETURN_IF_EXCEPTION_WITH_SCOPE(env, scope);
    NAPI_CHECK_ARG(env, arraybuffer);
    NAPI_CHECK_ARG(env, result);
    JSValue arraybufferValue = toJS(arraybuffer);
    auto arraybufferPtr = dynamicDowncast<JSC::JSArrayBuffer>(arraybufferValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, arraybufferPtr, napi_arraybuffer_expected);

    if (byte_offset + length > arraybufferPtr->impl()->byteLength()) {
        napi_throw_range_error(env, "ERR_NAPI_INVALID_DATAVIEW_ARGS", "byte_offset + byte_length should be less than or equal to the size in bytes of the array passed in");
        return napi_set_last_error(env, napi_pending_exception);
    }

    auto dataView = JSC::DataView::create(arraybufferPtr->impl(), byte_offset, length);
    *result = toNapi(dataView->wrap(globalObject, globalObject), globalObject);
    RELEASE_AND_RETURN(scope, napi_set_last_error(env, napi_ok));
}

static JSC::TypedArrayType getTypedArrayTypeFromNAPI(napi_typedarray_type type)
{
    switch (type) {
    case napi_int8_array:
        return JSC::TypedArrayType::TypeInt8;
    case napi_uint8_array:
        return JSC::TypedArrayType::TypeUint8;
    case napi_uint8_clamped_array:
        return JSC::TypedArrayType::TypeUint8Clamped;
    case napi_int16_array:
        return JSC::TypedArrayType::TypeInt16;
    case napi_uint16_array:
        return JSC::TypedArrayType::TypeUint16;
    case napi_int32_array:
        return JSC::TypedArrayType::TypeInt32;
    case napi_uint32_array:
        return JSC::TypedArrayType::TypeUint32;
    case napi_float32_array:
        return JSC::TypedArrayType::TypeFloat32;
    case napi_float64_array:
        return JSC::TypedArrayType::TypeFloat64;
    case napi_bigint64_array:
        return JSC::TypedArrayType::TypeBigInt64;
    case napi_biguint64_array:
        return JSC::TypedArrayType::TypeBigUint64;
    case napi_float16_array:
        return JSC::TypedArrayType::TypeFloat16;
    default:
        ASSERT_NOT_REACHED_WITH_MESSAGE("Unexpected napi_typedarray_type");
    }
}

static JSC::JSArrayBufferView* createArrayBufferView(
    Zig::GlobalObject* globalObject,
    napi_typedarray_type type,
    RefPtr<ArrayBuffer>&& arrayBuffer,
    size_t byteOffset,
    size_t length)
{
    Structure* structure = globalObject->typedArrayStructure(getTypedArrayTypeFromNAPI(type), arrayBuffer->isResizableOrGrowableShared());
    switch (type) {
    case napi_int8_array:
        return JSC::JSInt8Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_uint8_array:
        return JSC::JSUint8Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_uint8_clamped_array:
        return JSC::JSUint8ClampedArray::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_int16_array:
        return JSC::JSInt16Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_uint16_array:
        return JSC::JSUint16Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_int32_array:
        return JSC::JSInt32Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_uint32_array:
        return JSC::JSUint32Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_float32_array:
        return JSC::JSFloat32Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_float64_array:
        return JSC::JSFloat64Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_bigint64_array:
        return JSC::JSBigInt64Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_biguint64_array:
        return JSC::JSBigUint64Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    case napi_float16_array:
        return JSC::JSFloat16Array::create(globalObject, structure, WTF::move(arrayBuffer), byteOffset, length);
    default:
        ASSERT_NOT_REACHED_WITH_MESSAGE("Unexpected napi_typedarray_type");
    }
}

extern "C" napi_status napi_create_typedarray(
    napi_env env,
    napi_typedarray_type type,
    size_t length,
    napi_value arraybuffer,
    size_t byte_offset,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    Zig::GlobalObject* globalObject = toJS(env);
    NAPI_CHECK_ARG(env, arraybuffer);
    NAPI_CHECK_ARG(env, result);
    JSValue arraybufferValue = toJS(arraybuffer);
    auto arraybufferPtr = dynamicDowncast<JSC::JSArrayBuffer>(arraybufferValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, arraybufferPtr, napi_arraybuffer_expected);
    switch (type) {
    case napi_int8_array:
    case napi_uint8_array:
    case napi_uint8_clamped_array:
    case napi_int16_array:
    case napi_uint16_array:
    case napi_int32_array:
    case napi_uint32_array:
    case napi_float32_array:
    case napi_float64_array:
    case napi_bigint64_array:
    case napi_biguint64_array:
    case napi_float16_array: {
        break;
    }
    default: {
        napi_set_last_error(env, napi_invalid_arg);
        return napi_invalid_arg;
    }
    }

    JSC::JSArrayBufferView* view = createArrayBufferView(globalObject, type, arraybufferPtr->impl(), byte_offset, length);
    NAPI_RETURN_IF_EXCEPTION(env);
    *result = toNapi(view, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

namespace Zig {

// Walk the prototype chain collecting property names without touching JSC's
// per-Structure own-keys cache. JSC::allPropertyKeys() stores the chain-walked
// list there, poisoning Reflect.ownKeys/Object.keys for same-shaped objects.
static JSArray* collectInheritedPropertyKeys(JSGlobalObject* globalObject, JSObject* object, PropertyNameMode propertyNameMode, DontEnumPropertiesMode dontEnumPropertiesMode)
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertyNameArrayBuilder properties(vm, propertyNameMode, PrivateSymbolMode::Exclude);
    object->getPropertyNames(globalObject, properties, dontEnumPropertiesMode);
    RETURN_IF_EXCEPTION(scope, nullptr);

    unsigned numProperties = properties.size();
    JSArray* keys = JSArray::create(vm, globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), numProperties);
    for (unsigned i = 0; i < numProperties; i++) {
        const auto& identifier = properties[i];
        JSValue key;
        if (propertyNameMode != PropertyNameMode::Strings && identifier.isSymbol()) {
            ASSERT(!identifier.isPrivateName());
            key = Symbol::create(vm, static_cast<SymbolImpl&>(*identifier.impl()));
        } else {
            key = jsOwnedString(vm, identifier.string());
        }
        keys->putDirectIndex(globalObject, i, key);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return keys;
}

extern "C" napi_status napi_get_all_property_names(
    napi_env env, napi_value objectNapi, napi_key_collection_mode key_mode,
    napi_key_filter key_filter, napi_key_conversion key_conversion,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, objectNapi);

    auto globalObject = toJS(env);
    auto objectValue = toJS(objectNapi);
    NAPI_CHECK_TO_OBJECT(env, globalObject, object, objectValue);

    NAPI_RETURN_EARLY_IF_FALSE(env,
        key_mode == napi_key_include_prototypes || key_mode == napi_key_own_only,
        napi_invalid_arg);
    NAPI_RETURN_EARLY_IF_FALSE(env,
        key_conversion == napi_key_keep_numbers || key_conversion == napi_key_numbers_to_strings,
        napi_invalid_arg);

    // Always request non-enumerable properties from JSC; whether to exclude them is decided by
    // key_filter (napi_key_enumerable) in the filter loop below. JSC only supports Exclude when
    // PropertyNameMode is Strings, so passing Exclude with Symbols/StringsAndSymbols trips an assert.
    DontEnumPropertiesMode jsc_key_mode = DontEnumPropertiesMode::Include;
    PropertyNameMode jsc_property_mode = PropertyNameMode::StringsAndSymbols;
    if (key_filter & napi_key_skip_symbols) {
        jsc_property_mode = PropertyNameMode::Strings;
    } else if (key_filter & napi_key_skip_strings) {
        jsc_property_mode = PropertyNameMode::Symbols;
    }

    JSArray* exportKeys = nullptr;
    if (key_mode == napi_key_include_prototypes) {
        exportKeys = collectInheritedPropertyKeys(globalObject, object, jsc_property_mode, jsc_key_mode);
    } else {
        exportKeys = ownPropertyKeys(globalObject, object, jsc_property_mode, jsc_key_mode);
    }

    NAPI_RETURN_IF_EXCEPTION(env);

    constexpr auto filter_by_any_descriptor = static_cast<napi_key_filter>(napi_key_enumerable | napi_key_writable | napi_key_configurable);
    // avoid expensive iteration if they don't care whether keys are enumerable, writable, or configurable
    if (key_filter & filter_by_any_descriptor) {
        JSArray* filteredKeys = JSArray::create(JSC::getVM(globalObject), globalObject->originalArrayStructureForIndexingType(ArrayWithContiguous), 0);
        for (unsigned i = 0; i < exportKeys->getArrayLength(); i++) {
            JSValue key = exportKeys->get(globalObject, i);
            auto propKey = key.toPropertyKey(globalObject);
            PropertyDescriptor desc;

            JSObject* owner = object;
            if (key_mode == napi_key_include_prototypes) {
                // Climb up the prototype chain to find inherited properties
                while (!owner->getOwnPropertyDescriptor(globalObject, propKey, desc)) {
                    JSObject* proto = owner->getPrototype(globalObject).getObject();
                    if (!proto) {
                        break;
                    }
                    owner = proto;
                }
            } else {
                owner->getOwnPropertyDescriptor(globalObject, propKey, desc);
            }

            // V8 never applies ONLY_WRITABLE/ONLY_CONFIGURABLE to Proxy keys
            // (FilterProxyKeys checks enumerable only) or to a String wrapper's
            // character indices (StringWrapperElementsAccessor adds them unfiltered).
            bool exempt_attr_filter = false;
            JSC::JSType owner_type = owner->type();
            if (owner_type == JSC::ProxyObjectType) {
                exempt_attr_filter = true;
            } else if (owner_type == JSC::StringObjectType || owner_type == JSC::DerivedStringObjectType) {
                if (auto index = parseIndex(propKey)) {
                    exempt_attr_filter = *index < uncheckedDowncast<StringObject>(owner)->internalValue()->length();
                }
            }

            bool include = true;
            if (key_filter & napi_key_enumerable) {
                include = include && desc.enumerable();
            }
            if (key_filter & napi_key_writable) {
                // V8's ONLY_WRITABLE filters on the ReadOnly attribute; accessor
                // descriptors never carry it, so they always pass.
                include = include && (exempt_attr_filter || desc.isAccessorDescriptor() || desc.writable());
            }
            if (key_filter & napi_key_configurable) {
                include = include && (exempt_attr_filter || desc.configurable());
            }

            if (include) {
                filteredKeys->push(globalObject, key);
            }
        }
        exportKeys = filteredKeys;
    }

    // JSC property enumeration always yields string keys for array indices;
    // convert canonical index strings back to numbers for napi_key_keep_numbers.
    if (key_conversion == napi_key_keep_numbers) {
        unsigned length = exportKeys->getArrayLength();
        for (unsigned i = 0; i < length; i++) {
            JSValue key = exportKeys->getDirectIndex(globalObject, i);
            if (!key.isString())
                continue;
            auto keyStr = asString(key)->value(globalObject);
            NAPI_RETURN_IF_EXCEPTION(env);
            if (auto* impl = keyStr->impl()) {
                if (auto index = parseIndex(*impl)) {
                    exportKeys->putDirectIndex(globalObject, i, jsNumber(*index));
                    NAPI_RETURN_IF_EXCEPTION(env);
                }
            }
        }
    }

    *result = toNapi(JSValue(exportKeys), globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_define_class(napi_env env,
    const char* utf8name,
    size_t length,
    napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, utf8name);
    NAPI_CHECK_ARG(env, constructor);
    NAPI_RETURN_EARLY_IF_FALSE(env, properties || property_count == 0, napi_invalid_arg);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);
    size_t len = length;
    if (len == NAPI_AUTO_LENGTH) {
        len = strlen(utf8name);
    }
    auto name = WTF::String::fromUTF8(std::span { utf8name, len }).isolatedCopy();
    napi_status propertyStatus = napi_ok;
    NapiClass* napiClass = NapiClass::create(vm, env, name, constructor, data, property_count, properties, &propertyStatus);
    JSValue value = JSValue(napiClass);
    JSC::EnsureStillAliveScope ensureStillAlive1(value);
    NAPI_RETURN_IF_EXCEPTION(env);
    if (propertyStatus != napi_ok) {
        return napi_set_last_error(env, propertyStatus);
    }
    if (data != nullptr) {
        napiClass->dataPtr() = data;
    }

    *result = toNapi(value, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_coerce_to_string(napi_env env, napi_value value,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);

    JSC::JSValue jsValue = toJS(value);
    JSC::EnsureStillAliveScope ensureStillAlive(jsValue);

    // .toString() can throw
    JSValue resultValue = JSValue(jsValue.toString(globalObject));
    NAPI_RETURN_IF_EXCEPTION(env);

    JSC::EnsureStillAliveScope ensureStillAlive1(resultValue);
    *result = toNapi(resultValue, globalObject);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_coerce_to_bool(napi_env env, napi_value value, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);

    JSValue jsValue = toJS(value);
    // might throw
    bool nativeBool = jsValue.toBoolean(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    *result = toNapi(JSC::jsBoolean(nativeBool), globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_coerce_to_number(napi_env env, napi_value value, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);

    JSValue jsValue = toJS(value);
    // might throw
    double nativeNumber = jsValue.toNumber(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    *result = toNapi(JSC::jsNumber(nativeNumber), globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_coerce_to_object(napi_env env, napi_value value, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);

    JSValue jsValue = toJS(value);
    // might throw
    JSObject* obj = jsValue.toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    *result = toNapi(obj, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_property_names(napi_env env, napi_value object,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, result);
    JSValue jsValue = toJS(object);
    Zig::GlobalObject* globalObject = toJS(env);
    NAPI_CHECK_TO_OBJECT(env, globalObject, jsObject, jsValue);

    JSC::EnsureStillAliveScope ensureStillAlive(jsObject);
    JSValue value = collectInheritedPropertyKeys(globalObject, jsObject, PropertyNameMode::Strings, DontEnumPropertiesMode::Exclude);
    NAPI_RETURN_IF_EXCEPTION(env);
    JSC::EnsureStillAliveScope ensureStillAlive1(value);

    *result = toNapi(value, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_buffer(napi_env env, size_t length,
    void** data,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();

    // In Node.js, napi_create_buffer is uninitialized memory.
    auto* uint8Array = JSC::JSUint8Array::createUninitialized(globalObject, subclassStructure, length);
    NAPI_RETURN_IF_EXCEPTION(env);

    if (data != nullptr) {
        // Node.js' code looks like this:
        //    *data = node::Buffer::Data(buffer);
        // That means they unconditionally update the data pointer.
        *data = length > 0 ? uint8Array->typedVector() : nullptr;
    }

    *result = toNapi(uint8Array, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

// SharedTask subclass with an armed flag so that the destructor can be
// armed only after the wrapping JS object (JSUint8Array / JSArrayBuffer)
// is successfully created. If creation throws, the destructor runs
// disarmed and skips finalize_cb so the caller retains ownership.
class NapiExternalBufferDestructor final : public SharedTask<void(void*)> {
public:
    NapiExternalBufferDestructor(WTF::Ref<NapiEnv>&& env, napi_finalize cb, void* hint)
        : m_env(WTF::move(env))
        , m_cb(cb)
        , m_hint(hint)
    {
    }

    void run(void* data) override
    {
        if (m_armed) {
            NAPI_LOG("external buffer finalizer");
            m_env->doFinalizer(m_cb, data, m_hint);
        }
    }

    void arm() { m_armed = true; }

private:
    WTF::Ref<NapiEnv> m_env;
    napi_finalize m_cb;
    void* m_hint;
    bool m_armed { false };
};

extern "C" napi_status napi_create_external_buffer(napi_env env, size_t length,
    void* data,
    napi_finalize finalize_cb,
    void* finalize_hint,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();

    if (data == nullptr || length == 0) {

        // TODO: is there a way to create a detached uint8 array?
        auto arrayBuffer = JSC::ArrayBuffer::createUninitialized(0, 1);
        auto* buffer = JSC::JSUint8Array::create(globalObject, subclassStructure, WTF::move(arrayBuffer), 0, 0);
        NAPI_RETURN_IF_EXCEPTION(env);
        buffer->existingBuffer()->detach(vm);

        vm.heap.addFinalizer(buffer, [env = WTF::Ref<NapiEnv>(*env), finalize_cb, data, finalize_hint](JSCell* cell) -> void {
            NAPI_LOG("external buffer finalizer (empty buffer)");
            env->doFinalizer(finalize_cb, data, finalize_hint);
        });

        *result = toNapi(buffer, globalObject);
        NAPI_RETURN_SUCCESS(env);
    }

    // Uses NapiExternalBufferDestructor instead of createSharedTask because
    // JSUint8Array::create can throw, and we must not call finalize_cb on failure.
    Ref<NapiExternalBufferDestructor> destructor = adoptRef(*new NapiExternalBufferDestructor(WTF::Ref<NapiEnv>(*env), finalize_cb, finalize_hint));
    // Get pointer before using WTF::move
    auto* destructorPtr = destructor.ptr();
    auto arrayBuffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(data), length }, WTF::move(destructor));

    auto* buffer = JSC::JSUint8Array::create(globalObject, subclassStructure, WTF::move(arrayBuffer), 0, length);
    NAPI_RETURN_IF_EXCEPTION(env);

    // Arm only after successful creation: if create threw, the destructor
    // runs disarmed and skips finalize_cb (caller retains ownership).
    destructorPtr->arm();

    *result = toNapi(buffer, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_external_arraybuffer(napi_env env, void* external_data, size_t byte_length,
    napi_finalize finalize_cb, void* finalize_hint, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    // Uses NapiExternalBufferDestructor instead of createSharedTask so that
    // finalize_cb is only invoked once JSArrayBuffer::create has succeeded.
    // Per the Node-API contract, the caller retains ownership of
    // external_data when this function fails, so calling finalize_cb on a
    // failure path would cause a double-free. JSArrayBuffer::create(vm, ...)
    // currently asserts on OOM rather than throwing, so there is no
    // reachable failure between createFromBytes and arm() today; the
    // pattern is kept for parity with napi_create_external_buffer and to
    // guard any future early return added in between.
    Ref<NapiExternalBufferDestructor> destructor = adoptRef(*new NapiExternalBufferDestructor(WTF::Ref<NapiEnv>(*env), finalize_cb, finalize_hint));
    // Get pointer before using WTF::move
    auto* destructorPtr = destructor.ptr();
    auto arrayBuffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(external_data), byte_length }, WTF::move(destructor));

    auto* buffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(ArrayBufferSharingMode::Default), WTF::move(arrayBuffer));
    // Arm only after successful creation so that if a future change makes
    // create() throw, the destructor runs disarmed and skips finalize_cb.
    destructorPtr->arm();

    *result = toNapi(buffer, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_double(napi_env env, double value,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    // The addon controls every bit of `value`; an impure NaN must not be
    // NaN-boxed as-is or it decodes as a forged JSValue (see PureNaN.h).
    *result = toNapi(jsNumber(purifyNaN(value)), toJS(env));
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_double(napi_env env, napi_value value,
    double* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isNumber(), napi_number_expected);

    *result = jsValue.asNumber();
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_int32(napi_env env, napi_value value, int32_t* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isNumber(), napi_number_expected);

    *result = jsValue.isInt32() ? jsValue.asInt32() : JSC::toInt32(jsValue.asDouble());
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_uint32(napi_env env, napi_value value, uint32_t* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isNumber(), napi_number_expected);

    *result = jsValue.isUInt32() ? jsValue.asUInt32() : JSC::toUInt32(jsValue.asNumber());
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_int64(napi_env env, napi_value value, int64_t* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isNumber(), napi_number_expected);

    double js_number = jsValue.asNumber();
    if (isfinite(js_number)) {
        // upper is 2^63 exactly, not 2^63-1, as the latter can't be represented exactly
        constexpr double lower = std::numeric_limits<int64_t>::min(), upper = 1ull << 63;
        if (js_number >= upper) {
            *result = std::numeric_limits<int64_t>::max();
        } else if (js_number <= lower) {
            *result = std::numeric_limits<int64_t>::min();
        } else {
            // safe
            *result = static_cast<int64_t>(js_number);
        }
    } else {
        *result = 0;
    }

    NAPI_RETURN_SUCCESS(env);
}

// must match Encoding in src/runtime/node/types.rs, which matches WebCore::BufferEncodingType
enum class NapiStringEncoding : uint8_t {
    utf8 = static_cast<uint8_t>(WebCore::BufferEncodingType::utf8),
    utf16 = static_cast<uint8_t>(WebCore::BufferEncodingType::utf16le),
    latin1 = static_cast<uint8_t>(WebCore::BufferEncodingType::latin1),
};

template<NapiStringEncoding...>
struct BufferElement {
    using Type = char;
};

template<>
struct BufferElement<NapiStringEncoding::utf16> {
    using Type = char16_t;
};

template<NapiStringEncoding EncodeTo>
napi_status napi_get_value_string_any_encoding(napi_env env, napi_value napiValue, typename BufferElement<EncodeTo>::Type* buf, size_t bufsize, size_t* writtenPtr)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, napiValue);
    JSValue jsValue = toJS(napiValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isString(), napi_string_expected);

    Zig::GlobalObject* globalObject = toJS(env);
    JSString* jsString = jsValue.toString(globalObject);
    NAPI_RETURN_IF_VM_EXCEPTION(env);
    const auto view = jsString->view(globalObject);
    NAPI_RETURN_IF_VM_EXCEPTION(env);

    if (buf == nullptr) {
        // they just want to know the length
        NAPI_CHECK_ARG(env, writtenPtr);
        switch (EncodeTo) {
        case NapiStringEncoding::utf8:
            if (view->is8Bit()) {
                *writtenPtr = Bun__encoding__byteLengthLatin1AsUTF8(view->span8().data(), view->length());
            } else {
                *writtenPtr = Bun__encoding__byteLengthUTF16AsUTF8(view->span16().data(), view->length());
            }
            break;
        case NapiStringEncoding::utf16:
            [[fallthrough]];
        case NapiStringEncoding::latin1:
            // if the string's encoding is the same as the destination encoding, this is trivially correct
            // if we are converting UTF-16 to Latin-1, then we do so by truncating each code unit, so the length is the same
            // if we are converting Latin-1 to UTF-16, then we do so by extending each code unit, so the length is also the same
            *writtenPtr = view->length();
            break;
        }
        return napi_set_last_error(env, napi_ok);
    }

    if (bufsize == 0) [[unlikely]] {
        if (writtenPtr) *writtenPtr = 0;
        return napi_set_last_error(env, napi_ok);
    }

    // An over-large bufsize (in particular NAPI_AUTO_LENGTH == SIZE_MAX) means the
    // caller promises the buffer is big enough for the whole string; Node forwards
    // such sizes to V8's WriteUtf8V2, which simply stops at the end of the string.
    // Clamp to the worst-case number of code units the encoder can produce so that
    // `bufsize - 1` (and `2 * (bufsize - 1)` for UTF-16, which would otherwise wrap
    // around size_t) stays within the destination the caller actually guarantees.
    // The encoders already stop at min(input, output), so this never changes how
    // many code units get written for buffers that really are this large.
    const size_t max_encoded_units = EncodeTo == NapiStringEncoding::utf8
        // Latin-1 → UTF-8 expands at most 2x per byte; UTF-16 → UTF-8 at most 3x per code unit
        ? (view->is8Bit() ? 2 : 3) * static_cast<size_t>(view->length())
        // latin1/utf16 destinations: at most one code unit per source code unit
        : static_cast<size_t>(view->length());
    if (bufsize - 1 > max_encoded_units) [[unlikely]] {
        bufsize = max_encoded_units + 1;
    }

    size_t written;
    std::span<unsigned char> writable_byte_slice(reinterpret_cast<unsigned char*>(buf),
        EncodeTo == NapiStringEncoding::utf16
            // don't write encoded text to the last element of the destination buffer
            // since we need to put a null terminator there
            ? 2 * (bufsize - 1)
            : bufsize - 1);
    if (view->is8Bit()) {
        const auto span = view->span8();
        if constexpr (EncodeTo == NapiStringEncoding::utf16) {

            // pass subslice to work around Bun__encoding__writeLatin1 asserting that the output has room
            written = Bun__encoding__writeLatin1(span.data(),
                std::min(static_cast<size_t>(span.size()), bufsize),
                writable_byte_slice.data(),
                writable_byte_slice.size(),
                static_cast<uint8_t>(EncodeTo));
        } else {
            written = Bun__encoding__writeLatin1(span.data(), span.size(), writable_byte_slice.data(), writable_byte_slice.size(), static_cast<uint8_t>(EncodeTo));
        }
    } else {
        const auto span = view->span16();
        written = Bun__encoding__writeUTF16(span.data(), span.size(), writable_byte_slice.data(), writable_byte_slice.size(), static_cast<uint8_t>(EncodeTo));
    }

    // convert bytes to code units
    if constexpr (EncodeTo == NapiStringEncoding::utf16) {
        written /= 2;
    }

    if (writtenPtr != nullptr) {
        *writtenPtr = written;
    }

    if (written < bufsize) {
        buf[written] = '\0';
    }

    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_get_value_string_utf8(napi_env env,
    napi_value napiValue, char* buf,
    size_t bufsize,
    size_t* writtenPtr)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    // this function does set_last_error
    return napi_get_value_string_any_encoding<NapiStringEncoding::utf8>(env, napiValue, buf, bufsize, writtenPtr);
}

extern "C" napi_status napi_get_value_string_latin1(napi_env env, napi_value napiValue, char* buf, size_t bufsize, size_t* writtenPtr)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    // this function does set_last_error
    return napi_get_value_string_any_encoding<NapiStringEncoding::latin1>(env, napiValue, buf, bufsize, writtenPtr);
}

extern "C" napi_status napi_get_value_string_utf16(napi_env env, napi_value napiValue, char16_t* buf, size_t bufsize, size_t* writtenPtr)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    // this function does set_last_error
    return napi_get_value_string_any_encoding<NapiStringEncoding::utf16>(env, napiValue, buf, bufsize, writtenPtr);
}

extern "C" napi_status napi_get_value_bool(napi_env env, napi_value value, bool* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isBoolean(), napi_boolean_expected);

    *result = jsValue.asBoolean();
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_element(napi_env env, napi_value objectValue,
    uint32_t index, napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, objectValue);
    JSValue jsValue = toJS(objectValue);
    auto globalObject = toJS(env);
    NAPI_CHECK_TO_OBJECT(env, globalObject, jsObject, jsValue);

    JSValue element = jsObject->getIndex(globalObject, index);
    NAPI_RETURN_IF_EXCEPTION(env);

    *result = toNapi(element, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_delete_element(napi_env env, napi_value objectValue,
    uint32_t index, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, objectValue);
    JSValue jsValue = toJS(objectValue);
    auto globalObject = toJS(env);
    NAPI_CHECK_TO_OBJECT(env, globalObject, jsObject, jsValue);

    bool deleteResult = jsObject->methodTable()->deletePropertyByIndex(jsObject, globalObject, index);
    NAPI_RETURN_IF_EXCEPTION(env);
    if (result) [[likely]] {
        *result = deleteResult;
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_object(napi_env env, napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSValue value = JSValue(NapiPrototype::create(vm, globalObject->NapiPrototypeStructure()));

    *result = toNapi(value, globalObject);
    JSC::EnsureStillAliveScope ensureStillAlive(value);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_external(napi_env env, void* data,
    napi_finalize finalize_cb,
    void* finalize_hint,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    auto* structure = globalObject->NapiExternalStructure();
    JSValue value = Bun::NapiExternal::create(vm, structure, data, finalize_hint, finalize_cb, env);
    JSC::EnsureStillAliveScope ensureStillAlive(value);
    *result = toNapi(value, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_typeof(napi_env env, napi_value val,
    napi_valuetype* result)
{
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, val);
    NAPI_CHECK_ARG(env, result);

    JSValue value = toJS(val);
    if (value.isEmpty()) {
        *result = napi_object;
        return napi_clear_last_error(env);
    }

    if (value.isCell()) {
        JSCell* cell = value.asCell();

        switch (cell->type()) {
        case JSC::JSFunctionType:
        case JSC::InternalFunctionType:
            *result = napi_function;
            return napi_clear_last_error(env);

        case JSC::ObjectType:
            if (dynamicDowncast<Bun::NapiExternal>(value)) {
                *result = napi_external;
                return napi_clear_last_error(env);
            }

            if (dynamicDowncast<AsyncContextFrame>(value)) {
                *result = napi_function;
                return napi_clear_last_error(env);
            }

            *result = napi_object;
            return napi_clear_last_error(env);

        case JSC::HeapBigIntType:
            *result = napi_bigint;
            return napi_clear_last_error(env);
        case JSC::DerivedStringObjectType:
        case JSC::StringObjectType:
            *result = napi_object;
            return napi_clear_last_error(env);
        case JSC::StringType:
            *result = napi_string;
            return napi_clear_last_error(env);
        case JSC::SymbolType:
            *result = napi_symbol;
            return napi_clear_last_error(env);

        case JSC::FinalObjectType:
        case JSC::ArrayType:
        case JSC::DerivedArrayType:
            *result = napi_object;
            return napi_clear_last_error(env);

        default: {
            if (cell->isCallable() || cell->isConstructor()) {
                *result = napi_function;
                return napi_clear_last_error(env);
            }

            if (cell->isObject()) {
                *result = napi_object;
                return napi_clear_last_error(env);
            }

            break;
        }
        }
    }

    if (value.isNumber()) {
        *result = napi_number;
        return napi_clear_last_error(env);
    }

    if (value.isUndefined()) {
        *result = napi_undefined;
        return napi_clear_last_error(env);
    }

    if (value.isNull()) {
        *result = napi_null;
        return napi_clear_last_error(env);
    }

    if (value.isBoolean()) {
        *result = napi_boolean;
        return napi_clear_last_error(env);
    }

    // Unexpected type, report an error in debug mode
    ASSERT_NOT_REACHED_WITH_MESSAGE("unknown type passed to napi_typeof");
    return napi_set_last_error(env, napi_generic_failure);
}

static_assert(std::is_same_v<JSBigInt::Digit, uint64_t>, "All NAPI bigint functions assume that bigint words are 64 bits");
#if USE(BIGINT32)
#error All NAPI bigint functions assume that BIGINT32 is disabled
#endif

extern "C" napi_status napi_get_value_bigint_int64(napi_env env, napi_value value, int64_t* result, bool* lossless)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, lossless);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isHeapBigInt(), napi_bigint_expected);

    // toBigInt64 can throw if the value is not a bigint. we have already checked, so we shouldn't
    // hit an exception here and it's okay to assert at the end
    *result = jsValue.toBigInt64(toJS(env));

    JSBigInt* bigint = jsValue.asHeapBigInt();
    auto length = bigint->length();
    uint64_t digit = length > 0 ? bigint->digit(0) : 0;

    if (length > 1) {
        *lossless = false;
    } else if (bigint->sign()) {
        // negative
        // lossless if numeric value is >= -2^63,
        // for which digit will be <= 2^63
        *lossless = (digit <= (1ull << 63));
    } else {
        // positive
        // lossless if numeric value is <= 2^63 - 1
        *lossless = (digit <= static_cast<uint64_t>(INT64_MAX));
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_bigint_uint64(napi_env env, napi_value value, uint64_t* result, bool* lossless)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, lossless);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isHeapBigInt(), napi_bigint_expected);

    // toBigInt64 can throw if the value is not a bigint. we have already checked, so we shouldn't
    // hit an exception here and it's okay to assert at the end
    *result = jsValue.toBigUInt64(toJS(env));
    NAPI_RETURN_IF_VM_EXCEPTION(env);

    // bigint to uint64 conversion is lossless if and only if there aren't multiple digits and the
    // value is positive
    JSBigInt* bigint = jsValue.asHeapBigInt();
    *lossless = (bigint->length() <= 1 && bigint->sign() == false);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_bigint_words(napi_env env,
    napi_value value,
    int* sign_bit,
    size_t* word_count,
    uint64_t* words)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, word_count);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isHeapBigInt(), napi_bigint_expected);
    // If both sign_bit and words are nullptr, we're just querying the word count
    // However, if exactly one of them is nullptr, we have an invalid argument
    NAPI_RETURN_EARLY_IF_FALSE(env, (sign_bit == nullptr && words == nullptr) || (sign_bit && words), napi_invalid_arg);

    JSC::JSBigInt* bigInt = jsValue.asHeapBigInt();

    // Return ok in this case
    if (sign_bit == nullptr && words == nullptr) {
        *word_count = bigInt->length();
        NAPI_RETURN_SUCCESS(env);
    }

    std::span<uint64_t> writable_words(words, *word_count);
    *sign_bit = static_cast<int>(bigInt->sign());

    // Always set word_count to the actual number of words needed
    size_t actual_word_count = bigInt->length();
    // Copy as many words as fit in the provided buffer
    bigInt->toWordsArray(writable_words);
    *word_count = actual_word_count;

    ensureStillAliveHere(bigInt);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_external(napi_env env, napi_value value,
    void** result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);
    auto* external = dynamicDowncast<Bun::NapiExternal>(toJS(value));
    NAPI_RETURN_EARLY_IF_FALSE(env, external, napi_invalid_arg);

    *result = external->value();
    NAPI_RETURN_SUCCESS(env);
}

// TODO: make this per addon instead of globally shared for ALL addons
extern "C" napi_status napi_get_instance_data(napi_env env,
    void** data)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, data);

    *data = env->instanceData;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_run_script(napi_env env, napi_value script,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    Zig::GlobalObject* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    NAPI_RETURN_IF_EXCEPTION_WITH_SCOPE(env, throwScope);
    NAPI_CHECK_ARG(env, script);
    NAPI_CHECK_ARG(env, result);
    JSValue scriptValue = toJS(script);
    NAPI_RETURN_EARLY_IF_FALSE(env, scriptValue.isString(), napi_string_expected);

    WTF::String code = scriptValue.getString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, napi_set_last_error(env, napi_pending_exception));

    JSC::SourceCode sourceCode = makeSource(code, SourceOrigin(), SourceTaintedOrigin::Untainted);

    NakedPtr<Exception> returnedException;
    JSValue value = JSC::evaluate(globalObject, sourceCode, globalObject->globalThis(), returnedException);

    if (returnedException) {
        env->scheduleException(returnedException.get());
        return napi_set_last_error(env, napi_pending_exception);
    }

    ASSERT(!value.isEmpty());
    *result = toNapi(value, globalObject);

    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_set_instance_data(napi_env env,
    void* data,
    napi_finalize finalize_cb,
    void* finalize_hint)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);

    env->instanceData = data;
    env->instanceDataFinalizer = Bun::NapiFinalizer { finalize_cb, finalize_hint };

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_bigint_uint64(napi_env env, uint64_t value, napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, result);
    auto* globalObject = toJS(env);
    auto* bigint = JSBigInt::createFrom(globalObject, value);
    NAPI_RETURN_IF_VM_EXCEPTION(env);
    *result = toNapi(bigint, globalObject);
    ensureStillAliveHere(bigint);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_bigint_int64(napi_env env, int64_t value, napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ARG(env, result);
    auto* globalObject = toJS(env);
    auto* bigint = JSBigInt::createFrom(globalObject, value);
    NAPI_RETURN_IF_VM_EXCEPTION(env);
    *result = toNapi(bigint, globalObject);
    ensureStillAliveHere(bigint);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_bigint_words(napi_env env,
    int sign_bit,
    size_t word_count,
    const uint64_t* words,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    Zig::GlobalObject* globalObject = toJS(env);
    auto& vm = env->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    NAPI_RETURN_IF_EXCEPTION_WITH_SCOPE(env, scope);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, words);
    // JSBigInt::createWithLength's size argument is unsigned int.
    NAPI_RETURN_EARLY_IF_FALSE(env, word_count <= UINT_MAX, napi_invalid_arg);

    // we check INT_MAX here because it won't reject any bigints that should be able to be created
    // (as the true limit is much lower), and one Node.js test expects an exception instead of
    // napi_invalid_arg in case the length is INT_MAX
    if (word_count >= INT_MAX) {
        // we use this error as the error from creating a massive bigint literal is simply
        // "RangeError: Out of memory"
        JSC::throwOutOfMemoryError(globalObject, scope);
        RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
    }

    std::span<const uint64_t> words_span(words, word_count);

    // throws RangeError if size is larger than JSC's limit
    auto* bigint = JSBigInt::createFromWords(globalObject, words_span, sign_bit != 0);
    RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
    ASSERT(bigint);

    *result = toNapi(bigint, globalObject);

    ensureStillAliveHere(bigint);
    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_create_symbol(napi_env env, napi_value description,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::JSValue descriptionValue = toJS(description);
    if (descriptionValue && !descriptionValue.isUndefinedOrNull()) {
        NAPI_RETURN_EARLY_IF_FALSE(env, descriptionValue.isString(), napi_string_expected);

        WTF::String descriptionString = descriptionValue.getString(globalObject);
        NAPI_RETURN_IF_VM_EXCEPTION(env);

        if (descriptionString.length() > 0) {
            *result = toNapi(JSC::Symbol::createWithDescription(vm, descriptionString),
                globalObject);
            NAPI_RETURN_SUCCESS(env);
        }
        // TODO handle empty string?
    }

    auto* symbol = JSC::Symbol::create(vm);
    *result = toNapi(symbol, globalObject);
    ensureStillAliveHere(symbol);
    NAPI_RETURN_SUCCESS(env);
}

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/js_native_api_v8.cc#L2904-L2930
extern "C" napi_status napi_new_instance(napi_env env, napi_value constructor,
    size_t argc, const napi_value* argv,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, constructor);
    NAPI_RETURN_EARLY_IF_FALSE(env, argc == 0 || argv, napi_invalid_arg);
    NAPI_CHECK_ARG(env, result);
    JSValue constructorValue = toJS(constructor);
    // Node.js's CHECK_TO_FUNCTION tests v8::Value::IsFunction() and returns
    // napi_invalid_arg (not napi_function_expected) for non-callables.
    NAPI_RETURN_EARLY_IF_FALSE(env, constructorValue.isCallable(), napi_invalid_arg);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::CallData constructData = getConstructData(constructorValue);
    if (constructData.type == JSC::CallData::Type::None) [[unlikely]] {
        // Callable but not constructible (e.g. arrow functions): Node.js lets V8
        // throw "is not a constructor" and returns napi_pending_exception.
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwException(globalObject, scope, JSC::createNotAConstructorError(globalObject, constructorValue));
        return napi_set_last_error(env, napi_pending_exception);
    }

    JSC::MarkedArgumentBuffer args;
    args.fill(vm, argc, [&](JSValue* buffer) {
        gcSafeMemcpy<JSValue>(buffer, reinterpret_cast<const JSValue*>(argv), sizeof(JSValue) * argc);
    });

    auto value = construct(globalObject, constructorValue, constructData, args);
    *result = toNapi(value, globalObject);

    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_instanceof(napi_env env, napi_value object, napi_value constructor, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, result);

    *result = false;

    NAPI_CHECK_ARG(env, constructor);

    Zig::GlobalObject* globalObject = toJS(env);

    JSValue objectValue = toJS(object);
    JSValue constructorValue = toJS(constructor);
    JSC::JSObject* constructorObject = constructorValue.toObject(globalObject);
    RETURN_IF_EXCEPTION(napi_preamble_throw_scope__, napi_set_last_error(env, napi_object_expected));

    if (!constructorObject->isCallable()) {
        napi_throw_type_error(env, "ERR_NAPI_CONS_FUNCTION", "Constructor must be a function");
        return napi_set_last_error(env, napi_function_expected);
    }

    *result = constructorObject->hasInstance(globalObject, objectValue);
    RETURN_IF_EXCEPTION(napi_preamble_throw_scope__, napi_set_last_error(env, napi_generic_failure));

    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_call_function(napi_env env, napi_value recv,
    napi_value func, size_t argc,
    const napi_value* argv,
    napi_value* result)
{
    if (env->throwPendingException()) {
        return napi_set_last_error(env, napi_pending_exception);
    }

    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, recv);
    NAPI_RETURN_EARLY_IF_FALSE(env, argc == 0 || argv, napi_invalid_arg);
    NAPI_CHECK_ARG(env, func);
    JSValue funcValue = toJS(func);
    // Ideally, funcValue is never of type AsyncContextFrame, as that type
    // should never be exposed to user-code. To preserve async local storage
    // contexts across napi_threadsafe_callback, AsyncContextFrame is created.
    // An alternative here would be to unwrap the frame on the native side
    // (ThreadSafeFunction in src/runtime/napi/napi_body.rs), but doing the work
    // assigning and restoring the global state is not trivial there.
    // Most, if not all, threadsafe callbacks will not pass the callback to JS,
    // they will just call it with this function.
    NAPI_RETURN_EARLY_IF_FALSE(env, funcValue.isCallable() || dynamicDowncast<AsyncContextFrame>(funcValue), napi_invalid_arg);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::MarkedArgumentBuffer args;
    args.fill(vm, argc, [&](JSValue* buffer) {
        gcSafeMemcpy<JSValue>(buffer, reinterpret_cast<const JSValue*>(argv), sizeof(JSValue) * argc);
    });

    JSValue thisValue = toJS(recv);
    if (thisValue.isEmpty()) {
        thisValue = JSC::jsUndefined();
    }

    JSValue res = AsyncContextFrame::call(globalObject, funcValue, thisValue, args);

    if (result) {
        if (res.isEmpty()) {
            *result = toNapi(JSC::jsUndefined(), globalObject);
        } else {
            *result = toNapi(res, globalObject);
        }
    }
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_type_tag_object(napi_env env, napi_value value, const napi_type_tag* type_tag)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, type_tag);
    Zig::GlobalObject* globalObject = toJS(env);
    JSObject* js_object = toJS(value).getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, js_object, napi_object_expected);
    JSValue napiTypeTagValue = globalObject->napiTypeTags()->get(js_object);

    auto* existing_tag = dynamicDowncast<Bun::NapiTypeTag>(napiTypeTagValue);
    // cannot tag an object that is already tagged
    NAPI_RETURN_EARLY_IF_FALSE(env, existing_tag == nullptr, napi_invalid_arg);

    auto& vm = JSC::getVM(globalObject);
    auto* new_tag = Bun::NapiTypeTag::create(vm, globalObject->NapiTypeTagStructure(), *type_tag);
    globalObject->napiTypeTags()->set(vm, js_object, new_tag);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_check_object_type_tag(napi_env env, napi_value value, const napi_type_tag* type_tag, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, type_tag);
    Zig::GlobalObject* globalObject = toJS(env);
    JSObject* js_object = toJS(value).getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, js_object, napi_object_expected);

    bool match = false;
    auto* found_tag = dynamicDowncast<Bun::NapiTypeTag>(globalObject->napiTypeTags()->get(js_object));
    if (found_tag && found_tag->matches(*type_tag)) {
        match = true;
    }
    if (result) [[likely]] {
        *result = match;
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status napi_add_env_cleanup_hook(napi_env env,
    void (*function)(void*),
    void* data)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    if (function) {
        env->addCleanupHook(function, data);
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status napi_add_async_cleanup_hook(napi_env env,
    napi_async_cleanup_hook function,
    void* data, napi_async_cleanup_hook_handle* handle_out)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);
    if (function) {
        napi_async_cleanup_hook_handle handle = env->addAsyncCleanupHook(function, data);
        if (handle_out) {
            *handle_out = handle;
        }
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status napi_remove_env_cleanup_hook(napi_env env,
    void (*function)(void*),
    void* data)
{
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);

    // Always attempt removal like Node.js (no VM terminating check)
    // Node.js has no such check in RemoveEnvironmentCleanupHook
    // See: node/src/api/hooks.cc:142-143
    if (function != nullptr) [[likely]] {
        env->removeCleanupHook(function, data);
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status napi_remove_async_cleanup_hook(napi_async_cleanup_hook_handle handle)
{
    // Node.js returns napi_invalid_arg for NULL handle
    // See: node/src/node_api.cc:849-855
    if (handle == nullptr) {
        return napi_invalid_arg;
    }

    napi_env env = handle->env;
    NAPI_PREAMBLE_NO_PENDING_CHECK(env);

    // Always attempt removal like Node.js (no VM terminating check)
    // Node.js has no such check in napi_remove_async_cleanup_hook
    env->removeAsyncCleanupHook(handle);

    NAPI_RETURN_SUCCESS(env);
}

extern "C" void napi_internal_cleanup_env_cpp(napi_env env)
{
    env->cleanup();
}

extern "C" bool NapiEnv__registerThreadSafeFunction(napi_env env, void* tsfn)
{
    return env->registerThreadSafeFunction(tsfn);
}

extern "C" void NapiEnv__unregisterThreadSafeFunction(napi_env env, void* tsfn)
{
    env->unregisterThreadSafeFunction(tsfn);
}

extern "C" void napi_internal_remove_finalizer(napi_env env, napi_finalize callback, void* hint, void* data)
{
    env->removeFinalizer(callback, hint, data);
}

extern "C" void napi_internal_check_gc(napi_env env)
{
    env->checkGC();
}

extern "C" bool NapiEnv__hasPendingException(napi_env env)
{
    if (env->hasPendingException()) {
        return true;
    }
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(env->vm());
    return scope.exception() != nullptr;
}

extern "C" uint32_t napi_internal_get_version(napi_env env)
{
    return env->napiModule().nm_version;
}

extern "C" JSGlobalObject* NapiEnv__globalObject(napi_env env)
{
    return env->globalObject();
}

extern "C" bool NapiEnv__getAndClearPendingException(napi_env env, JSC::EncodedJSValue* exception)
{
    if (std::optional<JSC::JSValue> pending = env->pendingException()) {
        *exception = JSValue::encode(*pending);
        env->clearPendingException();
        return true;
    }

    return false;
}

extern "C" void NapiEnv__ref(napi_env env)
{
    env->ref();
}

extern "C" void NapiEnv__deref(napi_env env)
{
    env->deref();
}

}

// Defined out-of-line so its uses of DECLARE_TOP_EXCEPTION_SCOPE (whose
// ctor/dtor are JS_EXPORT_PRIVATE when ENABLE_EXCEPTION_SCOPE_VERIFICATION
// is on) are confined to a single TU instead of inlined into every
// translation unit that includes napi.h.
void NapiEnv::clearExceptionsBetweenFinalizers()
{
    // VM::clearException (via TopExceptionScope::clearException) also
    // resets m_needExceptionCheck bookkeeping, so a leaked exception
    // from one finalizer does not trip debug asserts in the next.
    DECLARE_TOP_EXCEPTION_SCOPE(m_vm).clearException();
    m_pendingException.clear();
}
