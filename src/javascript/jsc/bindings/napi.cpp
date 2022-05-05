
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
    JSC::JSValue thisValue = callFrame->thisValue();
    *argc = callFrame->argumentCount();
    *reinterpret_cast<JSC::EncodedJSValue**>(argv) = reinterpret_cast<JSC::EncodedJSValue*>(callFrame->addressOfArgumentsStart());
    if (thisValue && this_arg != nullptr) {
        *this_arg = reinterpret_cast<napi_value>(JSC::JSValue::encode(thisValue));
    }

    Zig::JSFFIFunction* ffiFunction = JSC::jsDynamicCast<Zig::JSFFIFunction*>(vm, JSC::JSValue(callFrame->jsCallee()));
    if (data != nullptr)
        *data = reinterpret_cast<void*>(ffiFunction->dataPtr);
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