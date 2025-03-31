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
#include <JavaScriptCore/ExceptionScope.h>
#include <JavaScriptCore/FunctionConstructor.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/InitializeThreading.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include "JSFFIFunction.h"
#include <JavaScriptCore/JavaScript.h>
#include "napi.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include "ScriptExecutionContext.h"
#include "Strong.h"

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
#include <wtf/TZoneMallocInlines.h>

using namespace JSC;
using namespace Zig;

// Every NAPI function should use this at the start. It does the following:
// - if NAPI_VERBOSE is 1, log that the function was called
// - if env is nullptr, return napi_invalid_arg
// - if there is a pending exception, return napi_pending_exception
// No do..while is used as this declares a variable that other macros need to use
#define NAPI_PREAMBLE(_env)                                                   \
    NAPI_LOG_CURRENT_FUNCTION;                                                \
    NAPI_CHECK_ARG(_env, _env);                                               \
    /* You should not use this throw scope directly -- if you need */         \
    /* to throw or clear exceptions, make your own scope */                   \
    auto napi_preamble_throw_scope__ = DECLARE_THROW_SCOPE(toJS(_env)->vm()); \
    NAPI_RETURN_IF_EXCEPTION(_env)

// Every NAPI function should use this at the start. It does the following:
// - if NAPI_VERBOSE is 1, log that the function was called
// - if env is nullptr, return napi_invalid_arg
// - if there is a pending exception, return napi_pending_exception
// No do..while is used as this declares a variable that other macros need to use
#define NAPI_PREAMBLE(_env)                                                   \
    NAPI_LOG_CURRENT_FUNCTION;                                                \
    NAPI_CHECK_ARG(_env, _env);                                               \
    /* You should not use this throw scope directly -- if you need */         \
    /* to throw or clear exceptions, make your own scope */                   \
    auto napi_preamble_throw_scope__ = DECLARE_THROW_SCOPE(toJS(_env)->vm()); \
    NAPI_RETURN_IF_EXCEPTION(_env)

// Only use this for functions that need their own throw or catch scope. Functions that call into
// JS code that might throw should use NAPI_RETURN_IF_EXCEPTION.
#define NAPI_PREAMBLE_NO_THROW_SCOPE(_env) \
    do {                                   \
        NAPI_LOG_CURRENT_FUNCTION;         \
        NAPI_CHECK_ARG(_env, _env);        \
    } while (0)

// Return an error code if arg is null. Only use for input validation.
#define NAPI_CHECK_ARG(_env, arg)                               \
    do {                                                        \
        if (UNLIKELY((arg) == nullptr)) {                       \
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

// Return an error code if an exception was thrown after NAPI_PREAMBLE
#define NAPI_RETURN_IF_EXCEPTION(_env) RETURN_IF_EXCEPTION(napi_preamble_throw_scope__, napi_set_last_error(_env, napi_pending_exception))

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

static uint32_t getPropertyAttributes(napi_property_descriptor prop)
{
    uint32_t result = 0;
    const uint32_t attributes = static_cast<uint32_t>(prop.attributes);

    if (!(attributes & static_cast<napi_property_attributes>(napi_key_configurable))) {
        result |= JSC::PropertyAttribute::DontDelete;
    }

    if (!(attributes & static_cast<napi_property_attributes>(napi_key_enumerable))) {
        result |= JSC::PropertyAttribute::DontEnum;
    }

    if (!(attributes & napi_key_writable || prop.setter != nullptr)) {
        result |= JSC::PropertyAttribute::ReadOnly;
    }

    return result;
}

class NAPICallFrame {
public:
    NAPICallFrame(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, void* dataPtr, JSValue storedNewTarget)
        : NAPICallFrame(globalObject, callFrame, dataPtr)
    {
        m_storedNewTarget = storedNewTarget;
        m_isConstructorCall = !m_storedNewTarget.isEmpty();
    }

    NAPICallFrame(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, void* dataPtr)
        : m_callFrame(callFrame)
        , m_dataPtr(dataPtr)
    {
        // Node-API function calls always run in "sloppy mode," even if the JS side is in strict
        // mode. So if `this` is null or undefined, we use globalThis instead; otherwise, we convert
        // `this` to an object.
        // TODO change to global? or find another way to avoid JSGlobalProxy
        JSC::JSObject* jscThis = globalObject->globalThis();
        if (!m_callFrame->thisValue().isUndefinedOrNull()) {
            auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
            jscThis = m_callFrame->thisValue().toObject(globalObject);
            // https://tc39.es/ecma262/#sec-toobject
            // toObject only throws for undefined and null, which we checked for
            scope.assertNoException();
        }
        m_callFrame->setThisValue(jscThis);
    }

    JSValue thisValue() const
    {
        return m_callFrame->thisValue();
    }

    napi_callback_info toNapi()
    {
        return reinterpret_cast<napi_callback_info>(this);
    }

    ALWAYS_INLINE void* dataPtr() const
    {
        return m_dataPtr;
    }

    void extract(size_t* argc, // [in-out] Specifies the size of the provided argv array
                               // and receives the actual count of args.
        napi_value* argv, // [out] Array of values
        napi_value* this_arg, // [out] Receives the JS 'this' arg for the call
        void** data, Zig::GlobalObject* globalObject)
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

    JSValue newTarget()
    {
        if (!m_isConstructorCall) {
            return JSValue();
        }

        if (m_storedNewTarget.isUndefined()) {
            // napi_get_new_target:
            // "This API returns the new.target of the constructor call. If the current callback
            // is not a constructor call, the result is NULL."
            // they mean a null pointer, not JavaScript null
            return JSValue();
        } else {
            return m_storedNewTarget;
        }
    }

private:
    JSC::CallFrame* m_callFrame;
    void* m_dataPtr;
    JSValue m_storedNewTarget;
    bool m_isConstructorCall = false;
};

static void defineNapiProperty(napi_env env, JSC::JSObject* to, napi_property_descriptor property, bool isInstance, JSC::ThrowScope& scope)
{
    Zig::GlobalObject* globalObject = env->globalObject();
    JSC::VM& vm = JSC::getVM(globalObject);
    void* dataPtr = property.data;

    auto getPropertyName = [&]() -> JSC::Identifier {
        if (property.utf8name != nullptr) {
            size_t len = strlen(property.utf8name);
            if (len > 0) {
                return JSC::Identifier::fromString(vm, WTF::String::fromUTF8({ property.utf8name, len }).isolatedCopy());
            }
        }

        if (!property.name) {
            throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "Property name is required"_s));
            return JSC::Identifier();
        }

        JSValue nameValue = toJS(property.name);
        return nameValue.toPropertyKey(globalObject);
    };

    JSC::Identifier propertyName = getPropertyName();
    if (!propertyName.isSymbol() && propertyName.isEmpty()) {
        return;
    }

    if (property.method) {
        WTF::String name;
        if (!propertyName.isSymbol()) {
            name = propertyName.string();
        }

        JSValue value = NapiClass::create(vm, env, name, property.method, dataPtr, 0, nullptr);
        to->putDirect(vm, propertyName, value, getPropertyAttributes(property));
        return;
    }

    if (property.getter != nullptr || property.setter != nullptr) {
        JSC::JSObject* getter = nullptr;
        JSC::JSObject* setter = nullptr;

        if (property.getter) {
            auto name = makeString("get "_s, propertyName.isSymbol() ? String() : propertyName.string());
            getter = NapiClass::create(vm, env, name, property.getter, dataPtr, 0, nullptr);
        } else {
            JSC::JSNativeStdFunction* getterFunction = JSC::JSNativeStdFunction::create(
                JSC::getVM(globalObject), globalObject, 0, String(), [](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
                    return JSValue::encode(JSC::jsUndefined());
                });
            getter = getterFunction;
        }

        if (property.setter) {
            auto name = makeString("set "_s, propertyName.isSymbol() ? String() : propertyName.string());
            setter = NapiClass::create(vm, env, name, property.setter, dataPtr, 0, nullptr);
        }

        auto getterSetter = JSC::GetterSetter::create(vm, globalObject, getter, setter);
        to->putDirectAccessor(globalObject, propertyName, getterSetter, PropertyAttribute::Accessor | getPropertyAttributes(property));
    } else {
        JSC::JSValue value = toJS(property.value);

        if (value.isEmpty()) {
            value = JSC::jsUndefined();
        }

        PropertyDescriptor descriptor(value, getPropertyAttributes(property));
        to->methodTable()->defineOwnProperty(to, globalObject, propertyName, descriptor, false);
    }
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
    auto* object = targetValue.toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    auto keyProp = toJS(key);

    PutPropertySlot slot(object, false);

    Identifier identifier = keyProp.toPropertyKey(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    JSValue jsValue = toJS(value);

    // Ignoring the return value matches JS sloppy mode
    (void)object->methodTable()->put(object, globalObject, identifier, jsValue, slot);
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

    JSObject* jsObject = object.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsObject, napi_array_expected);

    jsObject->methodTable()->putByIndex(jsObject, toJS(env), index, value, false);
    NAPI_RETURN_IF_EXCEPTION(env);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_has_element(napi_env env, napi_value object_,
    uint32_t index, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object_);
    NAPI_CHECK_ARG(env, result);

    JSValue object = toJS(object_);
    NAPI_RETURN_EARLY_IF_FALSE(env, !object.isEmpty(), napi_invalid_arg);

    JSObject* jsObject = object.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsObject, napi_array_expected);

    bool has_property = jsObject->hasProperty(toJS(env), index);
    *result = has_property;

    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_has_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, key);

    auto globalObject = toJS(env);
    auto* target = toJS(object).toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    auto keyProp = toJS(key);
    *result = target->hasProperty(globalObject, keyProp.toPropertyKey(globalObject));
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_get_date_value(napi_env env, napi_value value, double* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);

    JSValue jsValue = toJS(value);

    auto* date = jsDynamicCast<JSC::DateInstance*>(jsValue);
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

    auto* target = toJS(object).toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);
    JSC::EnsureStillAliveScope ensureAlive(target);

    auto keyProp = toJS(key);
    JSC::EnsureStillAliveScope ensureAlive2(keyProp);
    *result = toNapi(target->get(globalObject, keyProp.toPropertyKey(globalObject)), globalObject);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_delete_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object);
    NAPI_CHECK_ARG(env, key);

    auto globalObject = toJS(env);

    auto* target = toJS(object).toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    auto keyProp = toJS(key);
    auto deleteResult = target->deleteProperty(globalObject, keyProp.toPropertyKey(globalObject));
    NAPI_RETURN_IF_EXCEPTION(env);

    if (LIKELY(result)) {
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

    auto* target = toJS(object).toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    JSValue keyProp = toJS(key);
    NAPI_RETURN_EARLY_IF_FALSE(env, keyProp.isString() || keyProp.isSymbol(), napi_name_expected);

    *result = target->hasOwnProperty(globalObject, JSC::PropertyName(keyProp.toPropertyKey(globalObject)));
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
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
    auto target = toJS(object).toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    JSValue jsValue = toJS(value);
    JSC::EnsureStillAliveScope ensureAlive(jsValue);
    JSC::EnsureStillAliveScope ensureAlive2(target);

    auto nameStr = WTF::String::fromUTF8({ utf8name, strlen(utf8name) });
    auto identifier = JSC::Identifier::fromString(vm, WTFMove(nameStr));

    PutPropertySlot slot(target, false);

    target->methodTable()->put(target, globalObject, identifier, jsValue, slot);
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

    // Node probably doesn't create uninitialized array buffers
    // but the node-api docs don't specify whether memory is initialized or not.
    RefPtr<ArrayBuffer> arrayBuffer = ArrayBuffer::tryCreateUninitialized(byte_length, 1);
    if (!arrayBuffer) {
        return napi_set_last_error(env, napi_generic_failure);
    }

    auto* jsArrayBuffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), WTFMove(arrayBuffer));
    NAPI_RETURN_IF_EXCEPTION(env);

    if (LIKELY(data && jsArrayBuffer->impl())) {
        *data = jsArrayBuffer->impl()->data();
    }
    *result = toNapi(jsArrayBuffer, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_is_buffer(napi_env env, napi_value value, bool* result)
{
    NAPI_PREAMBLE(env);
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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);

    auto jsValue = toJS(value);
    *result = jsValue.isCell() && isTypedArrayType(jsValue.asCell()->type());
    NAPI_RETURN_SUCCESS(env);
}

// This is more efficient than using WTF::String::FromUTF8
// it doesn't copy the string
// but it's only safe to use if we are not setting a property
// because we can't guarantee the lifetime of it
#define PROPERTY_NAME_FROM_UTF8(identifierName)                                                                                  \
    size_t utf8Len = strlen(utf8Name);                                                                                           \
    WTF::String nameString = LIKELY(WTF::charactersAreAllASCII(std::span { reinterpret_cast<const LChar*>(utf8Name), utf8Len })) \
        ? WTF::String(WTF::StringImpl::createWithoutCopying({ utf8Name, utf8Len }))                                              \
        : WTF::String::fromUTF8(utf8Name);                                                                                       \
    JSC::PropertyName identifierName = JSC::Identifier::fromString(vm, nameString);

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

    JSObject* target = toJS(object).toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    PROPERTY_NAME_FROM_UTF8(name);

    PropertySlot slot(target, PropertySlot::InternalMethodType::HasProperty);
    *result = target->getPropertySlot(globalObject, name, slot);
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

    JSObject* target = toJS(object).toObject(globalObject);
    NAPI_RETURN_IF_EXCEPTION(env);

    PROPERTY_NAME_FROM_UTF8(name);

    *result = toNapi(target->get(globalObject, name), globalObject);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, str);
    NAPI_CHECK_ARG(env, result);

    length = length == NAPI_AUTO_LENGTH ? strlen(str) : length;
    // WTF::ExternalStringImpl does not allow creating empty strings, so we have this limitation for now.
    NAPI_RETURN_EARLY_IF_FALSE(env, length > 0, napi_invalid_arg);
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ reinterpret_cast<const LChar*>(str), static_cast<unsigned int>(length) }, finalize_hint, [finalize_callback, env](void* hint, void* str, unsigned length) {
        if (finalize_callback) {
            NAPI_LOG("latin1 string finalizer");
            finalize_callback(env, str, hint);
        }
    });
    Zig::GlobalObject* globalObject = toJS(env);

    JSString* out = JSC::jsString(JSC::getVM(globalObject), WTF::String(impl.get()));
    ensureStillAliveHere(out);
    *result = toNapi(out, globalObject);
    ensureStillAliveHere(out);

    if (copied) {
        *copied = false;
    }

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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, str);
    NAPI_CHECK_ARG(env, result);

    length = length == NAPI_AUTO_LENGTH ? std::char_traits<char16_t>::length(str) : length;
    // WTF::ExternalStringImpl does not allow creating empty strings, so we have this limitation for now.
    NAPI_RETURN_EARLY_IF_FALSE(env, length > 0, napi_invalid_arg);
    Ref<WTF::ExternalStringImpl> impl = WTF::ExternalStringImpl::create({ reinterpret_cast<const UChar*>(str), static_cast<unsigned int>(length) }, finalize_hint, [finalize_callback, env](void* hint, void* str, unsigned length) {
        if (finalize_callback) {
            NAPI_LOG("utf16 string finalizer");
            finalize_callback(env, str, hint);
        }
    });
    Zig::GlobalObject* globalObject = toJS(env);

    JSString* out = JSC::jsString(JSC::getVM(globalObject), WTF::String(impl.get()));
    ensureStillAliveHere(out);
    *result = toNapi(out, globalObject);
    ensureStillAliveHere(out);

    NAPI_RETURN_SUCCESS(env);
}
extern "C" size_t Bun__napi_module_register_count;
extern "C" void napi_module_register(napi_module* mod)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject();
    napi_env env = globalObject->makeNapiEnv(*mod);
    JSC::VM& vm = JSC::getVM(globalObject);
    auto keyStr = WTF::String::fromUTF8(mod->nm_modname);
    globalObject->napiModuleRegisterCallCount++;
    Bun__napi_module_register_count++;
    JSValue pendingNapiModule = globalObject->m_pendingNapiModuleAndExports[0].get();
    JSObject* object = (pendingNapiModule && pendingNapiModule.isObject()) ? pendingNapiModule.getObject()
                                                                           : nullptr;

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::Strong<JSC::JSObject> strongExportsObject;

    if (!object) {
        auto* exportsObject = JSC::constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, void());

        object = Bun::JSCommonJSModule::create(globalObject, keyStr, exportsObject, false, jsUndefined());
        strongExportsObject = { vm, exportsObject };
    } else {
        JSValue exportsObject = object->getIfPropertyExists(globalObject, WebCore::builtinNames(vm).exportsPublicName());
        RETURN_IF_EXCEPTION(scope, void());

        if (exportsObject && exportsObject.isObject()) {
            strongExportsObject = { vm, exportsObject.getObject() };
        }
    }

    JSC::Strong<JSC::JSObject> strongObject = { vm, object };

    Bun::NapiHandleScope handleScope(globalObject);
    JSValue resultValue;

    if (mod->nm_register_func) {
        resultValue = toJS(mod->nm_register_func(env, toNapi(object, globalObject)));
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
    Bun::NapiExternal* napi_external = Bun::NapiExternal::create(vm, globalObject->NapiExternalStructure(), meta, nullptr, env, nullptr);

    bool success = resultValue.getObject()->putDirect(vm, WebCore::builtinNames(vm).napiDlopenHandlePrivateName(), napi_external, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    ASSERT(success);

    globalObject->m_pendingNapiModuleDlopenHandle = nullptr;

    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/node_api.cc#L734-L742
    // https://github.com/oven-sh/bun/issues/1288
    if (!scope.exception() && strongExportsObject && strongExportsObject.get() != resultValue) {
        PutPropertySlot slot(strongObject.get(), false);
        strongObject->put(strongObject.get(), globalObject, WebCore::builtinNames(vm).exportsPublicName(), resultValue, slot);
    }

    globalObject->m_pendingNapiModuleAndExports[1].set(vm, globalObject, object);
}

static void wrap_cleanup(napi_env env, void* data, void* hint)
{
    auto* ref = reinterpret_cast<NapiRef*>(data);
    ASSERT(ref->boundCleanup != nullptr);
    ref->boundCleanup->deactivate(env);
    ref->boundCleanup = nullptr;
    ref->callFinalizer();
}

static inline NapiRef* getWrapContentsIfExists(VM& vm, JSGlobalObject* globalObject, JSObject* object)
{
    if (auto* napi_instance = jsDynamicCast<NapiPrototype*>(object)) {
        return napi_instance->napiRef;
    } else {
        JSValue contents = object->getDirect(vm, WebCore::builtinNames(vm).napiWrappedContentsPrivateName());
        if (contents.isEmpty()) {
            return nullptr;
        } else {
            // jsCast asserts: we should not have stored anything but a NapiExternal here
            return static_cast<NapiRef*>(jsCast<Bun::NapiExternal*>(contents)->value());
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
    auto* napi_instance = jsDynamicCast<NapiPrototype*>(jsc_object);

    const JSC::Identifier& propertyName = WebCore::builtinNames(vm).napiWrappedContentsPrivateName();

    // if this is nonnull then the object has already been wrapped
    NapiRef* existing_wrap = getWrapContentsIfExists(vm, globalObject, jsc_object);
    NAPI_RETURN_EARLY_IF_FALSE(env, existing_wrap == nullptr, napi_invalid_arg);

    // create a new weak reference (refcount 0)
    auto* ref = new NapiRef(env, 0, Bun::NapiFinalizer { finalize_cb, finalize_hint });
    // In case the ref's finalizer is never called, we'll add a finalizer to execute on exit.
    const auto& bound_cleanup = env->addFinalizer(wrap_cleanup, native_object, ref);
    ref->boundCleanup = &bound_cleanup;
    ref->nativeObject = native_object;

    if (napi_instance) {
        napi_instance->napiRef = ref;
    } else {
        // wrap the ref in an external so that it can serve as a JSValue
        auto* external = Bun::NapiExternal::create(JSC::getVM(globalObject), globalObject->NapiExternalStructure(), ref, nullptr, env, nullptr);
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
    auto* napi_instance = jsDynamicCast<NapiPrototype*>(jsc_object);

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
    NAPI_PREAMBLE(env);
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
    NAPI_CHECK_ARG(env, object);
    NAPI_RETURN_EARLY_IF_FALSE(env, properties || property_count == 0, napi_invalid_arg);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSValue objectValue = toJS(object);
    JSC::JSObject* objectObject = objectValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, objectObject, napi_object_expected);

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    for (size_t i = 0; i < property_count; i++) {
        defineNapiProperty(env, objectObject, properties[i], true, throwScope);

        RETURN_IF_EXCEPTION(throwScope, napi_set_last_error(env, napi_pending_exception));
    }

    throwScope.release();
    return napi_set_last_error(env, napi_ok);
}

static JSC::ErrorInstance* createErrorWithCode(JSC::JSGlobalObject* globalObject, const WTF::String& code, const WTF::String& message, JSC::ErrorType type)
{
    // no napi functions permit a null message, they must check before calling this function and
    // return the right error code
    ASSERT(!message.isNull());

    auto& vm = JSC::getVM(globalObject);

    // we don't call JSC::createError() as it asserts the message is not an empty string ""
    auto* error = JSC::ErrorInstance::create(JSC::getVM(globalObject), globalObject->errorStructure(type), message, JSValue(), nullptr, RuntimeType::TypeNothing, type);
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
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!msg_utf8) {
        return napi_set_last_error(env, napi_invalid_arg);
    }

    WTF::String code = code_utf8 ? WTF::String::fromUTF8(code_utf8) : WTF::String();
    WTF::String message = WTF::String::fromUTF8(msg_utf8);

    auto* error = createErrorWithCode(globalObject, code, message, type);
    scope.throwException(globalObject, error);
    return napi_set_last_error(env, napi_ok);
}

// code must be a string or nullptr (no code)
// msg must be a string
// never calls toString, never throws
static napi_status createErrorWithNapiValues(napi_env env, napi_value code, napi_value message, JSC::ErrorType type, napi_value* result)
{
    auto* globalObject = toJS(env);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RETURN_IF_EXCEPTION(scope, napi_pending_exception);

    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, message);
    JSValue js_code = toJS(code);
    JSValue js_message = toJS(message);
    NAPI_RETURN_EARLY_IF_FALSE(env,
        js_message.isString() && (js_code.isEmpty() || js_code.isString()),
        napi_string_expected);

    auto wtf_code = js_code.isEmpty() ? WTF::String() : js_code.getString(globalObject);
    RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
    auto wtf_message = js_message.getString(globalObject);
    RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));

    *result = toNapi(
        createErrorWithCode(globalObject, wtf_code, wtf_message, type),
        globalObject);
    RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);

    JSC::JSValue val = toJS(value);

    bool can_be_weak = true;

    if (!(val.isObject() || val.isCallable() || val.isSymbol())) {
        NAPI_RETURN_EARLY_IF_FALSE(env, env->napiModule().nm_version == NAPI_VERSION_EXPERIMENTAL, napi_invalid_arg);
        can_be_weak = false;
    }

    auto* ref = new NapiRef(env, initial_refcount, Bun::NapiFinalizer {});
    ref->setValueInitial(val, can_be_weak);

    *result = toNapi(ref);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" void napi_set_ref(NapiRef* ref, JSC__JSValue val_)
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
    NAPI_PREAMBLE(env);
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
        auto* ref = new NapiRef(env, 0, Bun::NapiFinalizer { finalize_cb, finalize_hint });
        // TODO(@heimskr): consider detecting whether the value can't be weak, as we do in napi_create_reference.
        ref->setValueInitial(object, true);
        ref->nativeObject = native_object;
        *result = toNapi(ref);
    } else {
        // Otherwise, it's cheaper to just call .addFinalizer.
        vm.heap.addFinalizer(object, [env, finalize_cb, native_object, finalize_hint](JSCell* cell) -> void {
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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, finalize_cb);
    napi_internal_enqueue_finalizer(env, finalize_cb, finalize_data, finalize_hint);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_reference_unref(napi_env env, napi_ref ref,
    uint32_t* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, ref);

    NapiRef* napiRef = toJS(ref);
    napiRef->unref();
    if (LIKELY(result)) {
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
    NAPI_PREAMBLE(env);
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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, ref);
    NapiRef* napiRef = toJS(ref);
    napiRef->ref();
    if (LIKELY(result)) {
        *result = napiRef->refCount;
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_delete_reference(napi_env env, napi_ref ref)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, ref);
    NapiRef* napiRef = toJS(ref);
    delete napiRef;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_is_detached_arraybuffer(napi_env env,
    napi_value arraybuffer,
    bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, arraybuffer);
    NAPI_CHECK_ARG(env, result);

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(toJS(arraybuffer));
    NAPI_RETURN_EARLY_IF_FALSE(env, jsArrayBuffer, napi_arraybuffer_expected);

    auto* arrayBuffer = jsArrayBuffer->impl();
    *result = arrayBuffer->isDetached();
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_detach_arraybuffer(napi_env env,
    napi_value arraybuffer)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(toJS(arraybuffer));
    NAPI_RETURN_EARLY_IF_FALSE(env, jsArrayBuffer, napi_arraybuffer_expected);

    auto* arrayBuffer = jsArrayBuffer->impl();
    if (!arrayBuffer->isDetached() && arrayBuffer->isDetachable()) {
        arrayBuffer->detach(vm);
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_adjust_external_memory(napi_env env,
    int64_t change_in_bytes,
    int64_t* adjusted_value)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, adjusted_value);

    JSC::Heap& heap = toJS(env)->vm().heap;

    if (change_in_bytes > 0) {
        heap.deprecatedReportExtraMemory(change_in_bytes);
    }
    *adjusted_value = heap.extraMemorySize();
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_is_exception_pending(napi_env env, bool* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    auto globalObject = toJS(env);
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    *result = scope.exception() != nullptr;
    // skip macros as they assume we made a throw scope in the preamble
    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_get_and_clear_last_exception(napi_env env,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);

    if (UNLIKELY(!result)) {
        return napi_set_last_error(env, napi_invalid_arg);
    }

    auto globalObject = toJS(env);
    auto scope = DECLARE_CATCH_SCOPE(JSC::getVM(globalObject));
    if (scope.exception()) {
        *result = toNapi(JSValue(scope.exception()->value()), globalObject);
    } else {
        *result = toNapi(JSC::jsUndefined(), globalObject);
    }
    scope.clearException();

    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_fatal_exception(napi_env env,
    napi_value err)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, err);
    auto globalObject = toJS(env);
    JSValue value = toJS(err);
    JSC::JSObject* obj = value.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, obj && obj->isErrorInstance(), napi_invalid_arg);

    Bun__reportUnhandledError(globalObject, JSValue::encode(value));

    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_throw(napi_env env, napi_value error)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    auto globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue value = toJS(error);
    if (value) {
        JSC::throwException(globalObject, throwScope, value);
    } else {
        JSC::throwException(globalObject, throwScope, JSC::createError(globalObject, "Error (via napi)"_s));
    }

    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status node_api_symbol_for(napi_env env,
    const char* utf8description,
    size_t length, napi_value* result)
{
    NAPI_PREAMBLE(env);
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
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::JSObject* object = JSC::jsCast<JSC::JSObject*>(value);
    // TODO is this check necessary?
    if (!hasIndexedProperties(object->indexingType())) {
        object->freeze(vm);
    }

    NAPI_RETURN_SUCCESS(env);
}
extern "C" napi_status napi_object_seal(napi_env env, napi_value object_value)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, object_value);
    JSC::JSValue value = toJS(object_value);
    NAPI_RETURN_EARLY_IF_FALSE(env, value.isObject(), napi_object_expected);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::JSObject* object = JSC::jsCast<JSC::JSObject*>(value);
    // TODO is this check necessary?
    if (!hasIndexedProperties(object->indexingType())) {
        object->seal(vm);
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_global(napi_env env, napi_value* result)
{
    NAPI_PREAMBLE(env);
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
    NAPI_PREAMBLE(env);
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
    RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
    NAPI_CHECK_ARG(env, arraybuffer);
    NAPI_CHECK_ARG(env, result);
    JSValue arraybufferValue = toJS(arraybuffer);
    auto arraybufferPtr = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(arraybufferValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, arraybufferPtr, napi_arraybuffer_expected);

    if (byte_offset + length > arraybufferPtr->impl()->byteLength()) {
        JSC::throwRangeError(globalObject, scope, "byteOffset exceeds source ArrayBuffer byteLength"_s);
        RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
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
        return JSC::JSInt8Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_uint8_array:
        return JSC::JSUint8Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_uint8_clamped_array:
        return JSC::JSUint8ClampedArray::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_int16_array:
        return JSC::JSInt16Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_uint16_array:
        return JSC::JSUint16Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_int32_array:
        return JSC::JSInt32Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_uint32_array:
        return JSC::JSUint32Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_float32_array:
        return JSC::JSFloat32Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_float64_array:
        return JSC::JSFloat64Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_bigint64_array:
        return JSC::JSBigInt64Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
    case napi_biguint64_array:
        return JSC::JSBigUint64Array::create(globalObject, structure, WTFMove(arrayBuffer), byteOffset, length);
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
    NAPI_RETURN_IF_EXCEPTION(env);
    NAPI_CHECK_ARG(env, arraybuffer);
    NAPI_CHECK_ARG(env, result);
    JSValue arraybufferValue = toJS(arraybuffer);
    auto arraybufferPtr = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(arraybufferValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, arraybufferPtr, napi_arraybuffer_expected);
    JSC::JSArrayBufferView* view = createArrayBufferView(globalObject, type, arraybufferPtr->impl(), byte_offset, length);
    NAPI_RETURN_IF_EXCEPTION(env);
    *result = toNapi(view, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

namespace Zig {
template<typename Visitor>
void NapiClass::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    NapiClass* thisObject = jsCast<NapiClass*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(NapiClass);

template<bool ConstructCall>
JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue NapiClass_ConstructorFunction(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* constructorTarget = asObject(callFrame->jsCallee());
    NapiClass* napi = jsDynamicCast<NapiClass*>(constructorTarget);
    while (!napi && constructorTarget) {
        constructorTarget = constructorTarget->getPrototypeDirect().getObject();
        napi = jsDynamicCast<NapiClass*>(constructorTarget);
    }

    if (UNLIKELY(!napi)) {
        JSC::throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "NapiClass constructor called on an object that is not a NapiClass"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSValue newTarget;

    if constexpr (ConstructCall) {
        NapiPrototype* prototype = JSC::jsDynamicCast<NapiPrototype*>(napi->getIfPropertyExists(globalObject, vm.propertyNames->prototype));
        RETURN_IF_EXCEPTION(scope, {});

        if (!prototype) {
            JSC::throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "NapiClass constructor is missing the prototype"_s));
            return JSValue::encode(JSC::jsUndefined());
        }

        newTarget = callFrame->newTarget();
        auto* subclass = prototype->subclass(globalObject, asObject(newTarget));
        RETURN_IF_EXCEPTION(scope, {});
        callFrame->setThisValue(subclass);
    }

    NAPICallFrame frame(globalObject, callFrame, napi->dataPtr(), newTarget);
    Bun::NapiHandleScope handleScope(jsCast<Zig::GlobalObject*>(globalObject));

    JSValue ret = toJS(napi->constructor()(napi->env(), frame.toNapi()));
    napi_set_last_error(napi->env(), napi_ok);
    RETURN_IF_EXCEPTION(scope, {});
    if (ret.isEmpty()) {
        ret = jsUndefined();
    }
    if constexpr (ConstructCall) {
        RELEASE_AND_RETURN(scope, JSValue::encode(frame.thisValue()));
    } else {
        RELEASE_AND_RETURN(scope, JSValue::encode(ret));
    }
}

NapiClass* NapiClass::create(VM& vm, napi_env env, WTF::String name,
    napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties)
{
    NativeExecutable* executable = vm.getHostFunction(
        // for normal call
        NapiClass_ConstructorFunction<false>,
        ImplementationVisibility::Public,
        // for constructor call
        NapiClass_ConstructorFunction<true>, name);
    Structure* structure = env->globalObject()->NapiClassStructure();
    NapiClass* napiClass = new (NotNull, allocateCell<NapiClass>(vm)) NapiClass(vm, executable, env, structure, data);
    napiClass->finishCreation(vm, executable, name, constructor, data, property_count, properties);
    return napiClass;
}

void NapiClass::finishCreation(VM& vm, NativeExecutable* executable, const String& name, napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties)
{
    Base::finishCreation(vm, executable, 0, name);
    ASSERT(inherits(info()));
    this->m_constructor = constructor;
    auto globalObject = reinterpret_cast<Zig::GlobalObject*>(this->globalObject());

    this->putDirect(vm, vm.propertyNames->name, jsString(vm, name), JSC::PropertyAttribute::DontEnum | 0);

    NapiPrototype* prototype = NapiPrototype::create(vm, globalObject->NapiPrototypeStructure());

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    for (size_t i = 0; i < property_count; i++) {
        const napi_property_descriptor& property = properties[i];

        if (property.attributes & napi_static) {
            defineNapiProperty(m_env, this, property, true, throwScope);
        } else {
            defineNapiProperty(m_env, prototype, property, false, throwScope);
        }

        if (throwScope.exception())
            break;
    }

    this->putDirect(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | 0);
    prototype->putDirect(vm, vm.propertyNames->constructor, this, JSC::PropertyAttribute::DontEnum | 0);
}
}

const ClassInfo NapiClass::s_info = { "Function"_s, &NapiClass::Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiClass) };
const ClassInfo NapiPrototype::s_info = { "Object"_s, &NapiPrototype::Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiPrototype) };

extern "C" napi_status napi_get_all_property_names(
    napi_env env, napi_value objectNapi, napi_key_collection_mode key_mode,
    napi_key_filter key_filter, napi_key_conversion key_conversion,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, objectNapi);
    auto objectValue = toJS(objectNapi);
    auto* object = objectValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, object, napi_object_expected);

    DontEnumPropertiesMode jsc_key_mode = key_mode == napi_key_include_prototypes ? DontEnumPropertiesMode::Include : DontEnumPropertiesMode::Exclude;
    PropertyNameMode jsc_property_mode = PropertyNameMode::StringsAndSymbols;
    // TODO verify changing == to & is correct
    if (key_filter & napi_key_skip_symbols) {
        jsc_property_mode = PropertyNameMode::Strings;
    } else if (key_filter & napi_key_skip_strings) {
        jsc_property_mode = PropertyNameMode::Symbols;
    } else {
        // JSC requires key mode to be Include if property mode is StringsAndSymbols
        jsc_key_mode = DontEnumPropertiesMode::Include;
    }

    auto globalObject = toJS(env);

    JSArray* exportKeys = nullptr;
    if (key_mode == napi_key_include_prototypes) {
        exportKeys = allPropertyKeys(globalObject, object, jsc_property_mode, jsc_key_mode);
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
            PropertyDescriptor desc;

            if (key_mode == napi_key_include_prototypes) {
                // Climb up the prototype chain to find inherited properties
                JSObject* current_object = object;
                while (!current_object->getOwnPropertyDescriptor(globalObject, key.toPropertyKey(globalObject), desc)) {
                    JSObject* proto = current_object->getPrototype(JSC::getVM(globalObject), globalObject).getObject();
                    if (!proto) {
                        break;
                    }
                    current_object = proto;
                }
            } else {
                object->getOwnPropertyDescriptor(globalObject, key.toPropertyKey(globalObject), desc);
            }

            bool include = true;
            if (key_filter & napi_key_enumerable) {
                include = include && desc.enumerable();
            }
            if (key_filter & napi_key_writable) {
                include = include && desc.writable();
            }
            if (key_filter & napi_key_configurable) {
                include = include && desc.configurable();
            }

            if (include) {
                filteredKeys->push(globalObject, key);
            }
        }
        exportKeys = filteredKeys;
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
    NapiClass* napiClass = NapiClass::create(vm, env, name, constructor, data, property_count, properties);
    JSValue value = JSValue(napiClass);
    JSC::EnsureStillAliveScope ensureStillAlive1(value);
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
    JSObject* jsObject = jsValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsObject, napi_object_expected);

    Zig::GlobalObject* globalObject = toJS(env);

    JSC::EnsureStillAliveScope ensureStillAlive(jsValue);
    JSValue value = JSC::allPropertyKeys(globalObject, jsObject, PropertyNameMode::Strings, DontEnumPropertiesMode::Exclude);
    NAPI_RETURN_IF_EXCEPTION(env);
    JSC::EnsureStillAliveScope ensureStillAlive1(value);

    *result = toNapi(value, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_external_buffer(napi_env env, size_t length,
    void* data,
    napi_finalize finalize_cb,
    void* finalize_hint,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);

    auto arrayBuffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(data), length }, createSharedTask<void(void*)>([env, finalize_hint, finalize_cb](void* p) {
        NAPI_LOG("external buffer finalizer");
        env->doFinalizer(finalize_cb, p, finalize_hint);
    }));
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();

    auto* buffer = JSC::JSUint8Array::create(globalObject, subclassStructure, WTFMove(arrayBuffer), 0, length);

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

    auto arrayBuffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(external_data), byte_length }, createSharedTask<void(void*)>([env, finalize_hint, finalize_cb](void* p) {
        NAPI_LOG("external ArrayBuffer finalizer");
        env->doFinalizer(finalize_cb, p, finalize_hint);
    }));

    auto* buffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(ArrayBufferSharingMode::Default), WTFMove(arrayBuffer));

    *result = toNapi(buffer, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_double(napi_env env, double value,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    *result = toNapi(jsNumber(value), toJS(env));
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_double(napi_env env, napi_value value,
    double* result)
{
    NAPI_PREAMBLE(env);
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
    NAPI_PREAMBLE(env);
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
    NAPI_PREAMBLE(env);
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
    NAPI_PREAMBLE(env);
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

// must match src/bun.js/node/types.zig#Encoding, which matches WebCore::BufferEncodingType
enum class NapiStringEncoding : uint8_t {
    utf8 = static_cast<uint8_t>(WebCore::BufferEncodingType::utf8),
    utf16le = static_cast<uint8_t>(WebCore::BufferEncodingType::utf16le),
    latin1 = static_cast<uint8_t>(WebCore::BufferEncodingType::latin1),
};

template<NapiStringEncoding...>
struct BufferElement {
    using Type = char;
};

template<>
struct BufferElement<NapiStringEncoding::utf16le> {
    using Type = char16_t;
};

template<NapiStringEncoding EncodeTo>
napi_status napi_get_value_string_any_encoding(napi_env env, napi_value napiValue, typename BufferElement<EncodeTo>::Type* buf, size_t bufsize, size_t* writtenPtr)
{
    NAPI_CHECK_ARG(env, napiValue);
    JSValue jsValue = toJS(napiValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isString(), napi_string_expected);

    Zig::GlobalObject* globalObject = toJS(env);
    String view = jsValue.asCell()->getString(globalObject);
    size_t length = view.length();

    if (buf == nullptr) {
        // they just want to know the length
        NAPI_CHECK_ARG(env, writtenPtr);
        switch (EncodeTo) {
        case NapiStringEncoding::utf8:
            if (view.is8Bit()) {
                *writtenPtr = Bun__encoding__byteLengthLatin1AsUTF8(view.span8().data(), length);
            } else {
                *writtenPtr = Bun__encoding__byteLengthUTF16AsUTF8(view.span16().data(), length);
            }
            break;
        case NapiStringEncoding::utf16le:
            [[fallthrough]];
        case NapiStringEncoding::latin1:
            // if the string's encoding is the same as the destination encoding, this is trivially correct
            // if we are converting UTF-16 to Latin-1, then we do so by truncating each code unit, so the length is the same
            // if we are converting Latin-1 to UTF-16, then we do so by extending each code unit, so the length is also the same
            *writtenPtr = length;
            break;
        }
        return napi_set_last_error(env, napi_ok);
    }

    if (UNLIKELY(bufsize == 0)) {
        if (writtenPtr) *writtenPtr = 0;
        return napi_set_last_error(env, napi_ok);
    }

    if (UNLIKELY(bufsize == NAPI_AUTO_LENGTH)) {
        if (writtenPtr) *writtenPtr = 0;
        buf[0] = '\0';
        return napi_set_last_error(env, napi_ok);
    }

    size_t written;
    std::span<unsigned char> writable_byte_slice(reinterpret_cast<unsigned char*>(buf),
        EncodeTo == NapiStringEncoding::utf16le
            // don't write encoded text to the last element of the destination buffer
            // since we need to put a null terminator there
            ? 2 * (bufsize - 1)
            : bufsize - 1);
    if (view.is8Bit()) {
        if constexpr (EncodeTo == NapiStringEncoding::utf16le) {
            // pass subslice to work around Bun__encoding__writeLatin1 asserting that the output has room
            written = Bun__encoding__writeLatin1(view.span8().data(),
                std::min(static_cast<size_t>(view.span8().size()), bufsize),
                writable_byte_slice.data(),
                writable_byte_slice.size(),
                static_cast<uint8_t>(EncodeTo));
        } else {
            written = Bun__encoding__writeLatin1(view.span8().data(), view.length(), writable_byte_slice.data(), writable_byte_slice.size(), static_cast<uint8_t>(EncodeTo));
        }
    } else {
        written = Bun__encoding__writeUTF16(view.span16().data(), view.length(), writable_byte_slice.data(), writable_byte_slice.size(), static_cast<uint8_t>(EncodeTo));
    }

    // convert bytes to code units
    if constexpr (EncodeTo == NapiStringEncoding::utf16le) {
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
    return napi_get_value_string_any_encoding<NapiStringEncoding::utf16le>(env, napiValue, buf, bufsize, writtenPtr);
}

extern "C" napi_status napi_get_value_bool(napi_env env, napi_value value, bool* result)
{
    NAPI_PREAMBLE(env);
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
    JSObject* jsObject = jsValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsObject, napi_object_expected);

    JSValue element = jsObject->getIndex(toJS(env), index);
    NAPI_RETURN_IF_EXCEPTION(env);

    *result = toNapi(element, toJS(env));
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_delete_element(napi_env env, napi_value objectValue,
    uint32_t index, bool* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, objectValue);
    JSValue jsValue = toJS(objectValue);
    JSObject* jsObject = jsValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, jsObject, napi_object_expected);

    if (LIKELY(result)) {
        *result = jsObject->methodTable()->deletePropertyByIndex(jsObject, toJS(env), index);
    }
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_create_object(napi_env env, napi_value* result)
{
    NAPI_PREAMBLE(env);
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
    JSValue value = Bun::NapiExternal::create(vm, structure, data, finalize_hint, env, finalize_cb);
    JSC::EnsureStillAliveScope ensureStillAlive(value);
    *result = toNapi(value, globalObject);
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_typeof(napi_env env, napi_value val,
    napi_valuetype* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    JSValue value = toJS(val);
    if (value.isEmpty()) {
        // This can happen
        *result = napi_undefined;
        NAPI_RETURN_SUCCESS(env);
    }

    if (value.isCell()) {
        JSCell* cell = value.asCell();

        switch (cell->type()) {
        case JSC::JSFunctionType:
        case JSC::InternalFunctionType:
            *result = napi_function;
            NAPI_RETURN_SUCCESS(env);

        case JSC::ObjectType:
            if (JSC::jsDynamicCast<Bun::NapiExternal*>(value)) {
                *result = napi_external;
                NAPI_RETURN_SUCCESS(env);
            }

            *result = napi_object;
            NAPI_RETURN_SUCCESS(env);

        case JSC::HeapBigIntType:
            *result = napi_bigint;
            NAPI_RETURN_SUCCESS(env);
        case JSC::DerivedStringObjectType:
        case JSC::StringObjectType:
        case JSC::StringType:
            *result = napi_string;
            NAPI_RETURN_SUCCESS(env);
        case JSC::SymbolType:
            *result = napi_symbol;
            NAPI_RETURN_SUCCESS(env);

        case JSC::FinalObjectType:
        case JSC::ArrayType:
        case JSC::DerivedArrayType:
            *result = napi_object;
            NAPI_RETURN_SUCCESS(env);

        default: {
            if (cell->isCallable() || cell->isConstructor()) {
                *result = napi_function;
                NAPI_RETURN_SUCCESS(env);
            }

            if (cell->isObject()) {
                *result = napi_object;
                NAPI_RETURN_SUCCESS(env);
            }

            break;
        }
        }
    }

    if (value.isNumber()) {
        *result = napi_number;
        NAPI_RETURN_SUCCESS(env);
    }

    if (value.isUndefined()) {
        *result = napi_undefined;
        NAPI_RETURN_SUCCESS(env);
    }

    if (value.isNull()) {
        *result = napi_null;
        NAPI_RETURN_SUCCESS(env);
    }

    if (value.isBoolean()) {
        *result = napi_boolean;
        NAPI_RETURN_SUCCESS(env);
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
    NAPI_PREAMBLE(env);
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
    uint64_t digit = bigint->length() > 0 ? bigint->digit(0) : 0;

    if (bigint->length() > 1) {
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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, lossless);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isHeapBigInt(), napi_bigint_expected);

    // toBigInt64 can throw if the value is not a bigint. we have already checked, so we shouldn't
    // hit an exception here and it's okay to assert at the end
    *result = jsValue.toBigUInt64(toJS(env));

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
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, value);
    NAPI_CHECK_ARG(env, word_count);
    JSValue jsValue = toJS(value);
    NAPI_RETURN_EARLY_IF_FALSE(env, jsValue.isHeapBigInt(), napi_bigint_expected);
    // If both sign_bit and words are nullptr, we're just querying the word count
    // However, if exactly one of them is nullptr, we have an invalid argument
    NAPI_RETURN_EARLY_IF_FALSE(env, (sign_bit == nullptr && words == nullptr) || (sign_bit && words), napi_invalid_arg);

    JSC::JSBigInt* bigInt = jsValue.asHeapBigInt();

    size_t available_words = *word_count;
    *word_count = bigInt->length();

    // Return ok in this case
    if (sign_bit == nullptr && words == nullptr) {
        NAPI_RETURN_SUCCESS(env);
    }

    *sign_bit = (int)bigInt->sign();

    size_t len = *word_count;
    for (size_t i = 0; i < available_words && i < len; i++) {
        words[i] = bigInt->digit(i);
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_get_value_external(napi_env env, napi_value value,
    void** result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, value);
    auto* external = jsDynamicCast<Bun::NapiExternal*>(toJS(value));
    NAPI_RETURN_EARLY_IF_FALSE(env, external, napi_invalid_arg);

    *result = external->value();
    NAPI_RETURN_SUCCESS(env);
}

// TODO: make this per addon instead of globally shared for ALL addons
extern "C" napi_status napi_get_instance_data(napi_env env,
    void** data)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, data);

    *data = env->instanceData;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_run_script(napi_env env, napi_value script,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ARG(env, script);
    NAPI_CHECK_ARG(env, result);
    JSValue scriptValue = toJS(script);
    NAPI_RETURN_EARLY_IF_FALSE(env, scriptValue.isString(), napi_string_expected);

    Zig::GlobalObject* globalObject = toJS(env);

    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    WTF::String code = scriptValue.getString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, napi_set_last_error(env, napi_pending_exception));

    JSC::SourceCode sourceCode = makeSource(code, SourceOrigin(), SourceTaintedOrigin::Untainted);

    NakedPtr<Exception> returnedException;
    JSValue value = JSC::evaluate(globalObject, sourceCode, globalObject->globalThis(), returnedException);

    if (returnedException) {
        throwScope.throwException(globalObject, returnedException);
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
    NAPI_PREAMBLE(env);

    env->instanceData = data;
    env->instanceDataFinalizer = Bun::NapiFinalizer { finalize_cb, finalize_hint };

    NAPI_RETURN_SUCCESS(env);
}

extern "C" napi_status napi_create_bigint_words(napi_env env,
    int sign_bit,
    size_t word_count,
    const uint64_t* words,
    napi_value* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_CHECK_ARG(env, words);
    // JSBigInt::createWithLength's size argument is unsigned int.
    NAPI_RETURN_EARLY_IF_FALSE(env, word_count <= UINT_MAX, napi_invalid_arg);

    Zig::GlobalObject* globalObject = toJS(env);
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));

    // we check INT_MAX here because it won't reject any bigints that should be able to be created
    // (as the true limit is much lower), and one Node.js test expects an exception instead of
    // napi_invalid_arg in case the length is INT_MAX
    if (word_count >= INT_MAX) {
        // we use this error as the error from creating a massive bigint literal is simply
        // "RangeError: Out of memory"
        JSC::throwOutOfMemoryError(globalObject, scope);
        RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
    }

    // JSBigInt requires there are no leading zeroes in the words array, but native modules may have
    // passed an array containing leading zeroes. so we have to cut those off.
    while (word_count > 0 && words[word_count - 1] == 0) {
        word_count--;
    }

    if (word_count == 0) {
        auto* bigint = JSBigInt::createZero(globalObject);
        RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
        *result = toNapi(bigint, globalObject);
        return napi_set_last_error(env, napi_ok);
    }

    // throws RangeError if size is larger than JSC's limit
    auto* bigint = JSBigInt::createWithLength(globalObject, word_count);
    RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
    ASSERT(bigint);

    bigint->setSign(sign_bit != 0);

    const uint64_t* current_word = words;
    // TODO: add fast path that uses memcpy here instead of setDigit
    // we need to add this to JSC. V8 has this optimization
    for (size_t i = 0; i < word_count; i++) {
        bigint->setDigit(i, *current_word++);
    }

    *result = toNapi(bigint, globalObject);
    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_create_symbol(napi_env env, napi_value description,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ENV_NOT_IN_GC(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::JSValue descriptionValue = toJS(description);
    if (descriptionValue && !descriptionValue.isUndefinedOrNull()) {
        NAPI_RETURN_EARLY_IF_FALSE(env, descriptionValue.isString(), napi_string_expected);

        WTF::String descriptionString = descriptionValue.getString(globalObject);
        NAPI_RETURN_IF_EXCEPTION(env);

        if (descriptionString.length() > 0) {
            *result = toNapi(JSC::Symbol::createWithDescription(vm, descriptionString),
                globalObject);
            NAPI_RETURN_SUCCESS(env);
        }
        // TODO handle empty string?
    }

    *result = toNapi(JSC::Symbol::create(vm), globalObject);
    NAPI_RETURN_SUCCESS(env);
}

// https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/src/js_native_api_v8.cc#L2904-L2930
extern "C" napi_status napi_new_instance(napi_env env, napi_value constructor,
    size_t argc, const napi_value* argv,
    napi_value* result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    NAPI_RETURN_EARLY_IF_FALSE(env, argc == 0 || argv, napi_invalid_arg);
    JSValue constructorValue = toJS(constructor);
    JSC::JSObject* constructorObject = constructorValue.getObject();
    NAPI_RETURN_EARLY_IF_FALSE(env, constructorObject, napi_function_expected);
    JSC::CallData constructData = getConstructData(constructorObject);
    NAPI_RETURN_EARLY_IF_FALSE(env, constructData.type != JSC::CallData::Type::None, napi_function_expected);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::MarkedArgumentBuffer args;
    args.fill(vm, argc, [&](JSValue* buffer) {
        gcSafeMemcpy<JSValue>(buffer, reinterpret_cast<const JSValue*>(argv), sizeof(JSValue) * argc);
    });

    auto value = construct(globalObject, constructorObject, constructData, args);
    *result = toNapi(value, globalObject);
    NAPI_RETURN_SUCCESS_UNLESS_EXCEPTION(env);
}

extern "C" napi_status napi_instanceof(napi_env env, napi_value object, napi_value constructor, bool* result)
{
    NAPI_PREAMBLE_NO_THROW_SCOPE(env);
    NAPI_CHECK_ARG(env, result);

    Zig::GlobalObject* globalObject = toJS(env);

    JSValue objectValue = toJS(object);
    JSValue constructorValue = toJS(constructor);
    JSC::JSObject* constructorObject = constructorValue.getObject();

    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));

    if (!constructorObject || !constructorValue.isConstructor()) {
        throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "Constructor must be a function"_s));
        return napi_set_last_error(env, napi_pending_exception);
    }

    if (UNLIKELY(!constructorObject->structure()->typeInfo().implementsHasInstance())) {
        *result = false;
    } else {
        *result = constructorObject->hasInstance(globalObject, objectValue);
    }

    return napi_set_last_error(env, napi_ok);
}

extern "C" napi_status napi_call_function(napi_env env, napi_value recv_napi,
    napi_value func_napi, size_t argc,
    const napi_value* argv,
    napi_value* result_ptr)
{
    NAPI_PREAMBLE(env);
    NAPI_RETURN_EARLY_IF_FALSE(env, argc == 0 || argv, napi_invalid_arg);
    JSValue funcValue = toJS(func_napi);
    NAPI_RETURN_EARLY_IF_FALSE(env, funcValue.isObject(), napi_function_expected);
    JSC::CallData callData = getCallData(funcValue);
    NAPI_RETURN_EARLY_IF_FALSE(env, callData.type != JSC::CallData::Type::None, napi_function_expected);

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = JSC::getVM(globalObject);

    JSC::MarkedArgumentBuffer args;
    args.fill(vm, argc, [&](JSValue* buffer) {
        gcSafeMemcpy<JSValue>(buffer, reinterpret_cast<const JSValue*>(argv), sizeof(JSValue) * argc);
    });

    JSValue thisValue = toJS(recv_napi);
    if (thisValue.isEmpty()) {
        thisValue = JSC::jsUndefined();
    }
    JSValue result = call(globalObject, funcValue, callData, thisValue, args);

    if (result_ptr) {
        if (result.isEmpty()) {
            *result_ptr = toNapi(JSC::jsUndefined(), globalObject);
        } else {
            *result_ptr = toNapi(result, globalObject);
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

    auto* existing_tag = jsDynamicCast<Bun::NapiTypeTag*>(globalObject->napiTypeTags()->get(js_object));
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
    auto* found_tag = jsDynamicCast<Bun::NapiTypeTag*>(globalObject->napiTypeTags()->get(js_object));
    if (found_tag && found_tag->matches(*type_tag)) {
        match = true;
    }
    if (LIKELY(result)) {
        *result = match;
    }
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
    NAPI_CHECK_ARG(env, result);

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(toJS(arraybuffer));
    NAPI_RETURN_EARLY_IF_FALSE(env, jsArrayBuffer, napi_arraybuffer_expected);

    auto* globalObject = toJS(env);
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));

    if (byte_offset + byte_length > jsArrayBuffer->impl()->byteLength()) {
        JSC::throwRangeError(globalObject, scope, "byteOffset exceeds source ArrayBuffer byteLength"_s);
        RETURN_IF_EXCEPTION(scope, napi_set_last_error(env, napi_pending_exception));
    }

    auto* subclassStructure = globalObject->JSBufferSubclassStructure();
    JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(globalObject, subclassStructure, byte_length);
    void* destination = uint8Array->vector();
    const void* source = reinterpret_cast<const char*>(jsArrayBuffer->impl()->data()) + byte_offset;
    memmove(destination, source, byte_length);

    *result = toNapi(uint8Array, globalObject);
    scope.release();
    return napi_set_last_error(env, napi_ok);
}

extern "C" JS_EXPORT napi_status node_api_get_module_file_name(napi_env env,
    const char** result)
{
    NAPI_PREAMBLE(env);
    NAPI_CHECK_ARG(env, result);
    *result = env->filename;
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status napi_add_env_cleanup_hook(napi_env env,
    void (*function)(void*),
    void* data)
{
    NAPI_PREAMBLE(env);
    if (function) {
        env->addCleanupHook(function, data);
    }
    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status napi_add_async_cleanup_hook(napi_env env,
    napi_async_cleanup_hook function,
    void* data, napi_async_cleanup_hook_handle* handle_out)
{
    NAPI_PREAMBLE(env);
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
    NAPI_PREAMBLE(env);

    if (LIKELY(function != nullptr) && !env->globalObject()->vm().hasTerminationRequest()) {
        env->removeCleanupHook(function, data);
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" JS_EXPORT napi_status napi_remove_async_cleanup_hook(napi_async_cleanup_hook_handle handle)
{
    ASSERT(handle != nullptr);
    napi_env env = handle->env;

    NAPI_PREAMBLE(env);

    if (!env->globalObject()->vm().hasTerminationRequest()) {
        env->removeAsyncCleanupHook(handle);
    }

    NAPI_RETURN_SUCCESS(env);
}

extern "C" void napi_internal_cleanup_env_cpp(napi_env env)
{
    env->cleanup();
}

extern "C" void napi_internal_remove_finalizer(napi_env env, napi_finalize callback, void* hint, void* data)
{
    env->removeFinalizer(callback, hint, data);
}

extern "C" void napi_internal_check_gc(napi_env env)
{
    env->checkGC();
}

extern "C" uint32_t napi_internal_get_version(napi_env env)
{
    return env->napiModule().nm_version;
}

extern "C" JSGlobalObject* NapiEnv__globalObject(napi_env env)
{
    return env->globalObject();
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(NapiRef);

void NapiRef::ref()
{
    NAPI_LOG("ref %p %u -> %u", this, refCount, refCount + 1);
    ++refCount;
    if (refCount == 1 && !weakValueRef.isClear()) {
        auto& vm = globalObject.get()->vm();
        strongRef.set(vm, weakValueRef.get());

        // isSet() will return always true after being set once
        // We cannot rely on isSet() to check if the value is set we need to use isClear()
        // .setString/.setObject/.setPrimitive will assert fail if called more than once (even after clear())
        // We should not clear the weakValueRef here because we need to keep it if we call NapiRef::unref()
        // so we can call the finalizer
    }
}

void NapiRef::unref()
{
    NAPI_LOG("unref %p %u -> %u", this, refCount, refCount - 1);
    bool clear = refCount == 1;
    refCount = refCount > 0 ? refCount - 1 : 0;
    if (clear && !m_isEternal) {
        // we still dont clean weakValueRef so we can ref it again using NapiRef::ref() if the GC didn't collect it
        // and use it to call the finalizer when GC'd
        strongRef.clear();
    }
}

void NapiRef::clear()
{
    NAPI_LOG("ref clear %p", this);
    finalizer.call(env, nativeObject);
    globalObject.clear();
    weakValueRef.clear();
    strongRef.clear();
}

NapiWeakValue::~NapiWeakValue()
{
    clear();
}

void NapiWeakValue::clear()
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    case WeakTypeTag::String: {
        m_value.string.clear();
        break;
    }
    default: {
        break;
    }
    }

    m_tag = WeakTypeTag::NotSet;
}

bool NapiWeakValue::isClear() const
{
    return m_tag == WeakTypeTag::NotSet;
}

void NapiWeakValue::setPrimitive(JSValue value)
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    case WeakTypeTag::String: {
        m_value.string.clear();
        break;
    }
    default: {
        break;
    }
    }
    m_tag = WeakTypeTag::Primitive;
    m_value.primitive = value;
}

void NapiWeakValue::set(JSValue value, WeakHandleOwner& owner, void* context)
{
    if (value.isCell()) {
        auto* cell = value.asCell();
        if (cell->isString()) {
            setString(jsCast<JSString*>(cell), owner, context);
        } else {
            setCell(cell, owner, context);
        }
    } else {
        setPrimitive(value);
    }
}

void NapiWeakValue::setCell(JSCell* cell, WeakHandleOwner& owner, void* context)
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    case WeakTypeTag::String: {
        m_value.string.clear();
        break;
    }
    default: {
        break;
    }
    }

    m_value.cell = JSC::Weak<JSCell>(cell, &owner, context);
    m_tag = WeakTypeTag::Cell;
}

void NapiWeakValue::setString(JSString* string, WeakHandleOwner& owner, void* context)
{
    switch (m_tag) {
    case WeakTypeTag::Cell: {
        m_value.cell.clear();
        break;
    }
    default: {
        break;
    }
    }

    m_value.string = JSC::Weak<JSString>(string, &owner, context);
    m_tag = WeakTypeTag::String;
}
