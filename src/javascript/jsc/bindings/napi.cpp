
#include "node_api.h"
#include "root.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/JSCellInlines.h"
#include "wtf/text/ExternalStringImpl.h"
#include "wtf/text/StringCommon.h"
#include "wtf/text/StringImpl.h"
#include "JavaScriptCore/JSMicrotask.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "wtf/text/StringView.h"
#include "wtf/text/StringBuilder.h"
#include "wtf/text/WTFString.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/CallFrame.h"
#include "JavaScriptCore/CallFrameInlines.h"
#include "JavaScriptCore/ClassInfo.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/CodeCache.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/HashMapImpl.h"
#include "JavaScriptCore/HashMapImplInlines.h"
#include "JavaScriptCore/Heap.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/InitializeThreading.h"
#include "JavaScriptCore/IteratorOperations.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayBuffer.h"
#include "JavaScriptCore/JSArrayBuffer.h"
#include "JSFFIFunction.h"

#include <iostream>
using namespace JSC;

// namespace Napi {
// class Reference
// }

extern "C" Zig::GlobalObject* Bun__getDefaultGlobal();

extern "C" void napi_module_register(napi_module* mod)
{

    auto* globalObject = Bun__getDefaultGlobal();
    JSC::VM& vm = globalObject->vm();
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject);
    auto result = reinterpret_cast<JSC::EncodedJSValue>(
        mod->nm_register_func(reinterpret_cast<napi_env>(globalObject), reinterpret_cast<napi_value>(JSC::JSValue::encode(JSC::JSValue(object)))));

    auto keyString = WTF::String::fromUTF8(mod->nm_modname);
    JSC::JSString* key = JSC::jsString(vm, keyString);

    JSC::JSArray* exportKeys = ownPropertyKeys(globalObject, object, PropertyNameMode::StringsAndSymbols, DontEnumPropertiesMode::Include, std::nullopt);
    auto symbol = vm.symbolRegistry().symbolForKey("__BunTemporaryGlobal"_s);
    JSC::Identifier ident = JSC::Identifier::fromUid(symbol);
    WTF::StringBuilder sourceCodeBuilder = WTF::StringBuilder();
    // TODO: handle symbol collision
    sourceCodeBuilder.append("var $$TempSymbol = Symbol.for('__BunTemporaryGlobal'), $$NativeModule = globalThis[$$TempSymbol]; globalThis[$$TempSymbol] = null;\n if (!$$NativeModule) { throw new Error('Assertion failure: Native module not found'); }\n\n"_s);

    for (unsigned i = 0; i < exportKeys->length(); i++) {
        auto key = exportKeys->getIndexQuickly(i);
        if (key.isSymbol()) {
            continue;
        }
        auto keyString = key.toWTFString(globalObject);
        sourceCodeBuilder.append(""_s);
        // TODO: handle invalid identifiers
        sourceCodeBuilder.append("export var "_s);
        sourceCodeBuilder.append(keyString);
        sourceCodeBuilder.append(" = $$NativeModule."_s);
        sourceCodeBuilder.append(keyString);
        sourceCodeBuilder.append(";\n"_s);
    }
    auto sourceCode = JSC::makeSource(sourceCodeBuilder.toString(), JSC::SourceOrigin(), keyString, WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
    globalObject->putDirect(vm, ident, object, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum);
    globalObject->moduleLoader()->provideFetch(globalObject, key, WTFMove(sourceCode));
    auto promise = globalObject->moduleLoader()->loadAndEvaluateModule(globalObject, key, jsUndefined(), jsUndefined());
    vm.drainMicrotasks();
    promise->result(vm);
}

extern "C" napi_status napi_create_function(napi_env env, const char* utf8name,
    size_t length, napi_callback cb,
    void* data, napi_value* result)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();
    auto name = WTF::String::fromUTF8(utf8name, length);
    // std::cout << "napi_create_function: " << utf8name << std::endl;
    auto function = Zig::JSFFIFunction::create(vm, globalObject, 1, name, reinterpret_cast<Zig::FFIFunction>(cb));
    function->dataPtr = data;
    JSC::JSValue functionValue = JSC::JSValue(function);
    *reinterpret_cast<JSC::EncodedJSValue*>(result) = JSC::JSValue::encode(functionValue);
    return napi_ok;
}

extern "C" napi_status napi_get_cb_info(
    napi_env env, // [in] NAPI environment handle
    napi_callback_info cbinfo, // [in] Opaque callback-info handle
    size_t* argc, // [in-out] Specifies the size of the provided argv array
                  // and receives the actual count of args.
    napi_value* argv, // [out] Array of values
    napi_value* this_arg, // [out] Receives the JS 'this' arg for the call
    void** data)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();
    JSC::CallFrame* callFrame = reinterpret_cast<JSC::CallFrame*>(cbinfo);

    auto inputArgsCount = argc == nullptr ? 0 : *argc;

    if (inputArgsCount > 0) {
        auto outputArgsCount = callFrame->argumentCount();
        auto argsToCopy = inputArgsCount < outputArgsCount ? inputArgsCount : outputArgsCount;
        *argc = argsToCopy;

        memcpy(argv, callFrame->addressOfArgumentsStart(), argsToCopy * sizeof(JSC::JSValue));
        auto argv_ptr = argv[outputArgsCount];
        for (size_t i = outputArgsCount; i < inputArgsCount; i++) {
            argv[i] = reinterpret_cast<napi_value>(JSC::JSValue::encode(JSC::jsUndefined()));
        }
    }

    if (this_arg != nullptr) {
        JSC::JSValue thisValue = callFrame->thisValue();
        *this_arg = reinterpret_cast<napi_value>(JSC::JSValue::encode(thisValue));
    }

    if (data != nullptr) {
        Zig::JSFFIFunction* ffiFunction = JSC::jsDynamicCast<Zig::JSFFIFunction*>(vm, JSC::JSValue(callFrame->jsCallee()));
        *data = reinterpret_cast<void*>(ffiFunction->dataPtr);
    }

    return napi_ok;
}

extern "C" napi_status napi_throw_error(napi_env env,
    const char* code,
    const char* msg)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);

    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto message = WTF::String::fromUTF8(msg);
    auto error = JSC::createError(globalObject, message);
    JSC::throwException(globalObject, throwScope, error);
    return napi_ok;
}

extern "C" napi_status napi_create_reference(napi_env env, napi_value value,
    uint32_t initial_refcount,
    napi_ref* result)
{

    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::Strong<JSC::Unknown> data = { globalObject->vm(), JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(value)) };
    *reinterpret_cast<JSC::Strong<JSC::Unknown>*>(result) = data;
    return napi_ok;
}

extern "C" napi_status napi_is_detached_arraybuffer(napi_env env,
    napi_value arraybuffer,
    bool* result)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    JSC::EncodedJSValue encodedValue = reinterpret_cast<JSC::EncodedJSValue>(arraybuffer);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value.isObject()) {
        return napi_arraybuffer_expected;
    }

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(vm, value);
    if (!jsArrayBuffer) {
        return napi_arraybuffer_expected;
    }

    auto arrayBuffer = jsArrayBuffer->impl();

    *result = arrayBuffer->isDetached();
    return napi_ok;
}

extern "C" napi_status napi_detach_arraybuffer(napi_env env,
    napi_value arraybuffer)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    JSC::EncodedJSValue encodedValue = reinterpret_cast<JSC::EncodedJSValue>(arraybuffer);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value.isObject()) {
        return napi_arraybuffer_expected;
    }

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(vm, value);
    if (!jsArrayBuffer) {
        return napi_arraybuffer_expected;
    }

    auto arrayBuffer = jsArrayBuffer->impl();

    if (arrayBuffer->isDetached()) {
        return napi_ok;
    }

    arrayBuffer->detach(vm);

    return napi_ok;
}

extern "C" napi_status napi_throw(napi_env env, napi_value error)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(error));
    JSC::throwException(globalObject, throwScope, value);
    return napi_ok;
}

extern "C" napi_status napi_throw_type_error(napi_env env, const char* code,
    const char* msg)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);

    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto message = WTF::String::fromUTF8(msg);
    auto error = JSC::createTypeError(globalObject, message);
    JSC::throwException(globalObject, throwScope, error);
    return napi_ok;
}
extern "C" napi_status napi_throw_range_error(napi_env env, const char* code,
    const char* msg)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);

    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto message = WTF::String::fromUTF8(msg);
    auto error = JSC::createRangeError(globalObject, message);
    JSC::throwException(globalObject, throwScope, error);
    return napi_ok;
}

extern "C" napi_status napi_object_freeze(napi_env env, napi_value object_value)
{

    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::EncodedJSValue encodedValue = reinterpret_cast<JSC::EncodedJSValue>(object_value);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value.isObject()) {
        return napi_object_expected;
    }

    JSC::JSObject* object = JSC::jsCast<JSC::JSObject*>(value);
    if (!hasIndexedProperties(object->indexingType())) {
        object->freeze(vm);
    }

    RELEASE_AND_RETURN(throwScope, napi_ok);
}
extern "C" napi_status napi_object_seal(napi_env env, napi_value object_value)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::EncodedJSValue encodedValue = reinterpret_cast<JSC::EncodedJSValue>(object_value);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value.isObject()) {
        return napi_object_expected;
    }

    JSC::JSObject* object = JSC::jsCast<JSC::JSObject*>(value);
    if (!hasIndexedProperties(object->indexingType())) {
        object->seal(vm);
    }

    RELEASE_AND_RETURN(throwScope, napi_ok);
}

extern "C" napi_status napi_get_global(napi_env env, napi_value* result)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();
    *result = reinterpret_cast<napi_value>(globalObject->globalThis());
    return napi_ok;
}

extern "C" napi_status napi_create_range_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    JSC::EncodedJSValue encodedCode = reinterpret_cast<JSC::EncodedJSValue>(code);
    JSC::JSValue codeValue = JSC::JSValue::decode(encodedCode);

    JSC::EncodedJSValue encodedMessage = reinterpret_cast<JSC::EncodedJSValue>(msg);
    JSC::JSValue messageValue = JSC::JSValue::decode(encodedMessage);

    auto error = JSC::createRangeError(globalObject, messageValue.toWTFString(globalObject));
    *result = reinterpret_cast<napi_value>(error);
    return napi_ok;
}

extern "C" napi_status napi_get_new_target(napi_env env,
    napi_callback_info cbinfo,
    napi_value* result)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    CallFrame* callFrame = reinterpret_cast<JSC::CallFrame*>(cbinfo);
    JSC::JSValue newTarget = callFrame->newTarget();
    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(newTarget));
    return napi_ok;
}

extern "C" napi_status napi_create_dataview(napi_env env, size_t length,
    napi_value arraybuffer,
    size_t byte_offset,
    napi_value* result)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::EncodedJSValue encodedArraybuffer = reinterpret_cast<JSC::EncodedJSValue>(arraybuffer);
    auto arraybufferValue = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(vm, JSC::JSValue::decode(encodedArraybuffer));
    if (!arraybufferValue) {
        return napi_invalid_arg;
    }
    auto dataView = JSC::DataView::create(arraybufferValue->impl(), byte_offset, length);
    *result = reinterpret_cast<napi_value>(dataView->wrap(globalObject, globalObject));
    return napi_ok;
}