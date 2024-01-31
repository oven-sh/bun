
#include "node_api.h"
#include "root.h"
#include "ZigGlobalObject.h"
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
#include <JavaScriptCore/HashMapImpl.h>
#include <JavaScriptCore/HashMapImplInlines.h>
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
#include <JavaScriptCore/JSWeakValue.h>
#include "napi.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/BigIntObject.h>
#include "ScriptExecutionContext.h"
#include "Strong.h"

#include "../modules/ObjectModule.h"

#include <JavaScriptCore/JSSourceCode.h>
#include "napi_external.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/FunctionPrototype.h>

// #include <iostream>
using namespace JSC;
using namespace Zig;

#define NAPI_VERBOSE 0

#if NAPI_VERBOSE
#include <stdio.h>
#define NAPI_PREMABLE \
    printf("[napi.cpp:%d] %s\n", __LINE__, __PRETTY_FUNCTION__);
#else

#endif // NAPI_VERBOSE
#ifndef NAPI_PREMABLE
#define NAPI_PREMABLE
#endif

namespace Napi {

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

}

// #include <csignal>
#define NAPI_OBJECT_EXPECTED napi_object_expected

class NapiRefWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final
    {
        auto* weakValue = reinterpret_cast<NapiRef*>(context);

        auto finalizer = weakValue->finalizer;
        if (finalizer.finalize_cb) {
            weakValue->finalizer.finalize_cb = nullptr;
            finalizer.call(weakValue->globalObject.get(), weakValue->data);
        }
    }
};

static NapiRefWeakHandleOwner& weakValueHandleOwner()
{
    static NeverDestroyed<NapiRefWeakHandleOwner> jscWeakValueHandleOwner;
    return jscWeakValueHandleOwner;
}

void NapiFinalizer::call(JSC::JSGlobalObject* globalObject, void* data)
{
    if (this->finalize_cb) {
        NAPI_PREMABLE
        this->finalize_cb(reinterpret_cast<napi_env>(globalObject), data, this->finalize_hint);
    }
}

void NapiRef::ref()
{
    ++refCount;
    if (refCount == 1 && weakValueRef.isSet()) {
        auto& vm = globalObject.get()->vm();
        if (weakValueRef.isString()) {
            strongRef.set(vm, JSC::JSValue(weakValueRef.string()));
        } else if (weakValueRef.isObject()) {
            strongRef.set(vm, JSC::JSValue(weakValueRef.object()));
        } else {
            strongRef.set(vm, weakValueRef.primitive());
        }

        weakValueRef.clear();
    }
}

void NapiRef::unref()
{
    bool clear = refCount == 1;
    refCount = refCount > 0 ? refCount - 1 : 0;
    if (clear) {
        if (JSC::JSValue val = strongRef.get()) {

            if (val.isString()) {
                weakValueRef.setString(val.toString(globalObject.get()), weakValueHandleOwner(), this);
            } else if (val.isObject()) {
                weakValueRef.setObject(val.getObject(), weakValueHandleOwner(), this);
            } else {
                weakValueRef.setPrimitive(val);
            }
        }
        strongRef.clear();
    }
}

void NapiRef::clear()
{
    this->finalizer.call(this->globalObject.get(), this->data);
    this->globalObject.clear();
    this->weakValueRef.clear();
    this->strongRef.clear();
}

// namespace Napi {
// class Reference
// }

extern "C" Zig::GlobalObject* Bun__getDefaultGlobal();

WTF_MAKE_ISO_ALLOCATED_IMPL(NapiRef);

static uint32_t getPropertyAttributes(napi_property_attributes attributes)
{
    uint32_t result = 0;
    if (!(attributes & napi_key_configurable)) {
        result |= JSC::PropertyAttribute::DontDelete;
    }

    if (!(attributes & napi_key_enumerable)) {
        result |= JSC::PropertyAttribute::DontEnum;
    }

    if (!(attributes & napi_key_writable)) {
        // result |= JSC::PropertyAttribute::ReadOnly;
    }

    return result;
}

static uint32_t getPropertyAttributes(napi_property_descriptor prop)
{
    uint32_t result = getPropertyAttributes(prop.attributes);

    // if (!(prop.getter && !prop.setter)) {
    //     result |= JSC::PropertyAttribute::ReadOnly;
    // }

    return result;
}

class NAPICallFrame {
public:
    NAPICallFrame(const JSC::ArgList args, void* dataPtr)
        : m_args(args)
        , m_dataPtr(dataPtr)
    {
    }

    JSC::JSValue thisValue() const
    {
        return m_args.at(0);
    }

    static constexpr uintptr_t NAPICallFramePtrTag = static_cast<uint64_t>(1) << 63;

    static bool isNAPICallFramePtr(uintptr_t ptr)
    {
        return ptr & NAPICallFramePtrTag;
    }

    static uintptr_t tagNAPICallFramePtr(uintptr_t ptr)
    {
        return ptr | NAPICallFramePtrTag;
    }

    static napi_callback_info toNapiCallbackInfo(NAPICallFrame& frame)
    {
        return reinterpret_cast<napi_callback_info>(tagNAPICallFramePtr(reinterpret_cast<uintptr_t>(&frame)));
    }

    static std::optional<NAPICallFrame*> get(JSC::CallFrame* callFrame)
    {
        uintptr_t ptr = reinterpret_cast<uintptr_t>(callFrame);
        if (!isNAPICallFramePtr(ptr)) {
            return std::nullopt;
        }

        ptr &= ~NAPICallFramePtrTag;
        return { reinterpret_cast<NAPICallFrame*>(ptr) };
    }

    ALWAYS_INLINE const JSC::ArgList& args() const
    {
        return m_args;
    }

    ALWAYS_INLINE void* dataPtr() const
    {
        return m_dataPtr;
    }

    static void extract(NAPICallFrame& callframe, size_t* argc, // [in-out] Specifies the size of the provided argv array
                                                                // and receives the actual count of args.
        napi_value* argv, // [out] Array of values
        napi_value* this_arg, // [out] Receives the JS 'this' arg for the call
        void** data)
    {
        if (this_arg != nullptr) {
            *this_arg = toNapi(callframe.thisValue());
        }

        if (data != nullptr) {
            *data = callframe.dataPtr();
        }

        size_t maxArgc = 0;
        if (argc != nullptr) {
            maxArgc = *argc;
            *argc = callframe.args().size() - 1;
        }

        if (argv != nullptr) {
            size_t realArgCount = callframe.args().size() - 1;

            size_t overflow = maxArgc > realArgCount ? maxArgc - realArgCount : 0;
            realArgCount = realArgCount < maxArgc ? realArgCount : maxArgc;

            if (realArgCount > 0) {
                memcpy(argv, callframe.args().data() + 1, sizeof(napi_value) * realArgCount);
                argv += realArgCount;
            }

            if (overflow > 0) {
                while (overflow--) {
                    *argv = toNapi(jsUndefined());
                    argv++;
                }
            }
        }
    }

    JSC::JSValue newTarget;

private:
    const JSC::ArgList m_args;
    void* m_dataPtr;
};

#define ADDRESS_OF_THIS_VALUE_IN_CALLFRAME(callframe) callframe->addressOfArgumentsStart() - 1

class NAPIFunction : public JSC::JSFunction {

public:
    using Base = JSC::JSFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSC::EncodedJSValue call(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
    {
        ASSERT(jsCast<NAPIFunction*>(callframe->jsCallee()));
        auto* function = static_cast<NAPIFunction*>(callframe->jsCallee());
        auto* env = toNapi(globalObject);
        auto* callback = reinterpret_cast<napi_callback>(function->m_method.get());
        JSC::VM& vm = globalObject->vm();

        MarkedArgumentBufferWithSize<12> args;
        size_t argc = callframe->argumentCount() + 1;
        args.fill(vm, argc, [&](auto* slot) {
            memcpy(slot, ADDRESS_OF_THIS_VALUE_IN_CALLFRAME(callframe), sizeof(JSC::JSValue) * argc);
        });
        NAPICallFrame frame(JSC::ArgList(args), function->m_dataPtr);

        auto scope = DECLARE_THROW_SCOPE(vm);

        auto result = callback(env, NAPICallFrame::toNapiCallbackInfo(frame));

        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(toJS(result)));
    }

    NAPIFunction(JSC::VM& vm, JSC::NativeExecutable* exec, JSGlobalObject* globalObject, Structure* structure, JSC::NativeFunction method, void* dataPtr)
        : Base(vm, exec, globalObject, structure)
        , m_method(method)
        , m_dataPtr(dataPtr)
    {
    }

    static NAPIFunction* create(JSC::VM& vm, Zig::GlobalObject* globalObject, unsigned length, const WTF::String& name, JSC::NativeFunction method, void* dataPtr)
    {

        auto* structure = globalObject->NAPIFunctionStructure();
        NativeExecutable* executable = vm.getHostFunction(&NAPIFunction::call, ImplementationVisibility::Public, &NAPIFunction::call, name);
        NAPIFunction* functionObject = new (NotNull, JSC::allocateCell<NAPIFunction>(vm)) NAPIFunction(vm, executable, globalObject, structure, method, dataPtr);
        functionObject->finishCreation(vm, executable, length, name);
        return functionObject;
    }

    void* m_dataPtr = nullptr;
    JSC::NativeFunction m_method = nullptr;

    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NAPIFunction, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNAPIFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNAPIFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNAPIFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNAPIFunction = std::forward<decltype(space)>(space); });
    }

    DECLARE_EXPORT_INFO;

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        ASSERT(globalObject);
        return Structure::create(vm, globalObject, prototype, TypeInfo(JSFunctionType, StructureFlags), info());
    }
};

const JSC::ClassInfo NAPIFunction::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NAPIFunction) };

Structure* Zig::createNAPIFunctionStructure(VM& vm, JSC::JSGlobalObject* globalObject)
{
    ASSERT(globalObject);
    auto* prototype = globalObject->functionPrototype();
    return NAPIFunction::createStructure(vm, globalObject, prototype);
}

static void defineNapiProperty(Zig::GlobalObject* globalObject, JSC::JSObject* to, void* inheritedDataPtr, napi_property_descriptor property, bool isInstance, JSC::ThrowScope& scope)
{
    JSC::VM& vm = globalObject->vm();
    void* dataPtr = property.data;
    if (!dataPtr) {
        dataPtr = inheritedDataPtr;
    }

    auto getPropertyName = [&]() -> JSC::Identifier {
        if (property.utf8name != nullptr) {
            size_t len = strlen(property.utf8name);
            if (len > 0) {
                return JSC::Identifier::fromString(vm, WTF::String::fromUTF8(property.utf8name, len).isolatedCopy());
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
        JSC::JSValue value;
        auto method = reinterpret_cast<Zig::FFIFunction>(property.method);

        auto* function = NAPIFunction::create(vm, globalObject, 1, propertyName.isSymbol() ? String() : propertyName.string(), method, dataPtr);
        value = JSC::JSValue(function);

        to->putDirect(vm, propertyName, value, getPropertyAttributes(property));
        return;
    }

    if (property.getter != nullptr || property.setter != nullptr) {

        JSC::JSObject* getter = nullptr;
        JSC::JSObject* setter = nullptr;
        auto getterProperty = reinterpret_cast<FFIFunction>(property.getter);
        auto setterProperty = reinterpret_cast<FFIFunction>(property.setter);

        if (getterProperty) {
            getter = NAPIFunction::create(vm, globalObject, 0, makeString("get "_s, propertyName.isSymbol() ? String() : propertyName.string()), getterProperty, dataPtr);
        } else {
            JSC::JSNativeStdFunction* getterFunction = JSC::JSNativeStdFunction::create(
                globalObject->vm(), globalObject, 0, String(), [](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
                    return JSC::JSValue::encode(JSC::jsUndefined());
                });
            getter = getterFunction;
        }

        if (setterProperty) {
            setter = NAPIFunction::create(vm, globalObject, 1, makeString("set "_s, propertyName.isSymbol() ? String() : propertyName.string()), setterProperty, dataPtr);
        } else {
            JSC::JSNativeStdFunction* setterFunction = JSC::JSNativeStdFunction::create(
                globalObject->vm(), globalObject, 1, String(), [](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
                    return JSC::JSValue::encode(JSC::jsBoolean(true));
                });
            setter = setterFunction;
        }

        auto getterSetter = JSC::GetterSetter::create(vm, globalObject, getter, setter);
        to->putDirectAccessor(globalObject, propertyName, getterSetter, JSC::PropertyAttribute::Accessor | 0);
    } else {
        JSC::JSValue value = toJS(property.value);

        if (value.isEmpty()) {
            value = JSC::jsUndefined();
        }

        to->putDirect(vm, propertyName, value, getPropertyAttributes(property));
    }
}

extern "C" napi_status napi_set_property(napi_env env, napi_value target,
    napi_value key, napi_value value)
{
    NAPI_PREMABLE

    if (UNLIKELY(!env || !target || !key)) {
        return napi_invalid_arg;
    }

    auto globalObject = toJS(env);
    auto& vm = globalObject->vm();
    auto* object = toJS(target).getObject();
    if (!object) {
        return napi_object_expected;
    }

    auto keyProp = toJS(key);

    auto scope = DECLARE_CATCH_SCOPE(vm);
    PutPropertySlot slot(object, true);
    Identifier identifier = keyProp.toPropertyKey(globalObject);
    JSValue jsValue = toJS(value);

    object->put(object, globalObject, identifier, jsValue, slot);
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    scope.clearException();
    return napi_ok;
}
extern "C" napi_status napi_has_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREMABLE

    if (UNLIKELY(!object || !env)) {
        return napi_invalid_arg;
    }

    auto globalObject = toJS(env);
    auto& vm = globalObject->vm();
    auto* target = toJS(object).getObject();
    if (!target) {
        return napi_object_expected;
    }

    auto keyProp = toJS(key);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    *result = target->hasProperty(globalObject, keyProp.toPropertyKey(globalObject));
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    scope.clearException();
    return napi_ok;
}
extern "C" napi_status napi_get_property(napi_env env, napi_value object,
    napi_value key, napi_value* result)
{
    NAPI_PREMABLE

    auto globalObject = toJS(env);
    auto& vm = globalObject->vm();

    auto* target = toJS(object).getObject();
    if (!target) {
        return napi_object_expected;
    }
    JSC::EnsureStillAliveScope ensureAlive(target);

    auto keyProp = toJS(key);
    JSC::EnsureStillAliveScope ensureAlive2(keyProp);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    *result = toNapi(target->getIfPropertyExists(globalObject, keyProp.toPropertyKey(globalObject)));
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    scope.clearException();
    return napi_ok;
}

extern "C" napi_status napi_delete_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREMABLE

    auto globalObject = toJS(env);
    auto& vm = globalObject->vm();

    auto* target = toJS(object).getObject();
    if (!target) {
        return napi_object_expected;
    }

    auto keyProp = toJS(key);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    *result = toNapi(target->deleteProperty(globalObject, JSC::PropertyName(keyProp.toPropertyKey(globalObject))));
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    scope.clearException();
    return napi_ok;
}
extern "C" napi_status napi_has_own_property(napi_env env, napi_value object,
    napi_value key, bool* result)
{
    NAPI_PREMABLE

    auto globalObject = toJS(env);
    auto& vm = globalObject->vm();

    auto* target = toJS(object).getObject();
    if (!target) {
        return napi_object_expected;
    }

    auto keyProp = toJS(key);
    auto scope = DECLARE_CATCH_SCOPE(vm);
    *result = toNapi(target->hasOwnProperty(globalObject, JSC::PropertyName(keyProp.toPropertyKey(globalObject))));
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    scope.clearException();
    return napi_ok;
}

extern "C" napi_status napi_set_named_property(napi_env env, napi_value object,
    const char* utf8name,
    napi_value value)
{
    NAPI_PREMABLE

    auto globalObject = toJS(env);
    auto target = toJS(object).getObject();
    auto& vm = globalObject->vm();
    if (UNLIKELY(!target)) {
        return napi_object_expected;
    }

    if (UNLIKELY(utf8name == nullptr || !*utf8name)) {
        return napi_invalid_arg;
    }

    JSC::JSValue jsValue = toJS(value);
    JSC::EnsureStillAliveScope ensureAlive(jsValue);
    JSC::EnsureStillAliveScope ensureAlive2(target);

    auto nameStr = WTF::String::fromUTF8(utf8name, strlen(utf8name));
    auto identifier = JSC::Identifier::fromString(vm, WTFMove(nameStr));

    auto scope = DECLARE_CATCH_SCOPE(vm);
    PutPropertySlot slot(target, true);

    target->put(target, globalObject, identifier, jsValue, slot);
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);
    scope.clearException();
    return napi_ok;
}

extern "C" napi_status napi_create_arraybuffer(napi_env env,
    size_t byte_length, void** data,
    napi_value* result)

{
    NAPI_PREMABLE

    JSC::JSGlobalObject* globalObject = toJS(env);
    if (UNLIKELY(!globalObject || !result)) {
        return napi_invalid_arg;
    }

    auto& vm = globalObject->vm();

    auto scope = DECLARE_CATCH_SCOPE(vm);

    // Node probably doesn't create uninitialized array buffers
    // but the node-api docs don't specify whether memory is initialized or not.
    RefPtr<ArrayBuffer> arrayBuffer = ArrayBuffer::tryCreateUninitialized(byte_length, 1);

    if (!arrayBuffer) {
        return napi_invalid_arg;
    }

    auto* jsArrayBuffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), WTFMove(arrayBuffer));
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    if (LIKELY(data && jsArrayBuffer->impl())) {
        *data = jsArrayBuffer->impl()->data();
    }
    *result = toNapi(jsArrayBuffer);
    return napi_ok;
}

// This is more efficient than using WTF::String::FromUTF8
// it doesn't copy the string
// but it's only safe to use if we are not setting a property
// because we can't guarantee the lifetime of it
#define PROPERTY_NAME_FROM_UTF8(identifierName) \
    size_t utf8Len = strlen(utf8name);          \
    JSC::PropertyName identifierName = LIKELY(charactersAreAllASCII(reinterpret_cast<const LChar*>(utf8name), utf8Len)) ? JSC::PropertyName(JSC::Identifier::fromString(vm, WTF::String(WTF::StringImpl::createWithoutCopying(utf8name, utf8Len)))) : JSC::PropertyName(JSC::Identifier::fromString(vm, WTF::String::fromUTF8(utf8name)));

extern "C" napi_status napi_has_named_property(napi_env env, napi_value object,
    const char* utf8name,
    bool* result)
{
    NAPI_PREMABLE

    auto globalObject = toJS(env);
    auto& vm = globalObject->vm();

    auto* target = toJS(object).getObject();
    if (UNLIKELY(!target)) {
        return napi_object_expected;
    }

    PROPERTY_NAME_FROM_UTF8(name);

    auto scope = DECLARE_CATCH_SCOPE(vm);
    *result = !!target->getIfPropertyExists(globalObject, name);
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    scope.clearException();
    return napi_ok;
}
extern "C" napi_status napi_get_named_property(napi_env env, napi_value object,
    const char* utf8name,
    napi_value* result)
{
    NAPI_PREMABLE

    auto globalObject = toJS(env);
    auto& vm = globalObject->vm();

    auto* target = toJS(object).getObject();
    if (UNLIKELY(!target)) {
        return napi_object_expected;
    }

    PROPERTY_NAME_FROM_UTF8(name);

    auto scope = DECLARE_CATCH_SCOPE(vm);
    *result = toNapi(target->getIfPropertyExists(globalObject, name));
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    scope.clearException();
    return napi_ok;
}

#if !COMPILER(MSVC)
__attribute__((visibility("default")))
#endif
extern "C" napi_status
node_api_create_external_string_latin1(napi_env env,
    char* str,
    size_t length,
    napi_finalize finalize_callback,
    void* finalize_hint,
    napi_value* result,
    bool* copied)
{
    // https://nodejs.org/api/n-api.html#node_api_create_external_string_latin1
    if (UNLIKELY(!str || !result)) {
        return napi_invalid_arg;
    }

    length = length == NAPI_AUTO_LENGTH ? strlen(str) : length;
    WTF::ExternalStringImpl& impl = WTF::ExternalStringImpl::create(reinterpret_cast<LChar*>(str), static_cast<unsigned int>(length), finalize_hint, [finalize_callback](void* hint, void* str, unsigned length) {
        if (finalize_callback) {
#if NAPI_VERBOSE
            printf("[napi] string finalize_callback\n");
#endif
            finalize_callback(reinterpret_cast<napi_env>(Bun__getDefaultGlobal()), nullptr, hint);
        }
    });
    JSGlobalObject* globalObject = toJS(env);
    // globalObject is allowed to be null here
    if (UNLIKELY(!globalObject)) {
        globalObject = Bun__getDefaultGlobal();
    }

    JSString* out = JSC::jsString(globalObject->vm(), WTF::String(impl));
    ensureStillAliveHere(out);
    *result = toNapi(out);
    ensureStillAliveHere(out);

    return napi_ok;
}

#if !COMPILER(MSVC)
__attribute__((visibility("default")))
#endif

extern "C" napi_status
node_api_create_external_string_utf16(napi_env env,
    char16_t* str,
    size_t length,
    napi_finalize finalize_callback,
    void* finalize_hint,
    napi_value* result,
    bool* copied)
{
    // https://nodejs.org/api/n-api.html#node_api_create_external_string_utf16
    if (UNLIKELY(!str || !result)) {
        return napi_invalid_arg;
    }

    length = length == NAPI_AUTO_LENGTH ? std::char_traits<char16_t>::length(str) : length;
    WTF::ExternalStringImpl& impl = WTF::ExternalStringImpl::create(reinterpret_cast<UChar*>(str), static_cast<unsigned int>(length), finalize_hint, [finalize_callback](void* hint, void* str, unsigned length) {
#if NAPI_VERBOSE
        printf("[napi] string finalize_callback\n");
#endif

        if (finalize_callback) {
            finalize_callback(reinterpret_cast<napi_env>(Bun__getDefaultGlobal()), nullptr, hint);
        }
    });
    JSGlobalObject* globalObject = toJS(env);
    // globalObject is allowed to be null here
    if (UNLIKELY(!globalObject)) {
        globalObject = Bun__getDefaultGlobal();
    }

    JSString* out = JSC::jsString(globalObject->vm(), WTF::String(impl));
    ensureStillAliveHere(out);
    *result = toNapi(out);
    ensureStillAliveHere(out);

    return napi_ok;
}

extern "C" void napi_module_register(napi_module* mod)
{
    auto* globalObject = Bun__getDefaultGlobal();
    JSC::VM& vm = globalObject->vm();
    auto keyStr = WTF::String::fromUTF8(mod->nm_modname);
    globalObject->napiModuleRegisterCallCount++;
    JSValue pendingNapiModule = globalObject->pendingNapiModule;
    JSObject* object = (pendingNapiModule && pendingNapiModule.isObject()) ? pendingNapiModule.getObject()
                                                                           : nullptr;

    if (!object) {
        object = JSC::constructEmptyObject(globalObject);
    } else {
        globalObject->pendingNapiModule = JSC::JSValue();
    }

    EnsureStillAliveScope ensureAlive(object);
    JSValue resultValue = toJS(mod->nm_register_func(toNapi(globalObject), toNapi(object)));

    EnsureStillAliveScope ensureAlive2(resultValue);
    if (resultValue.isEmpty()) {
        JSValue errorInstance = createError(globalObject, makeString("Node-API module \""_s, keyStr, "\" returned an error"_s));
        globalObject->pendingNapiModule = errorInstance;
        vm.writeBarrier(globalObject, errorInstance);
        EnsureStillAliveScope ensureAlive(globalObject->pendingNapiModule);
        return;
    }

    if (!resultValue.isObject()) {
        JSValue errorInstance = createError(globalObject, makeString("Expected Node-API module \""_s, keyStr, "\" to return an exports object"_s));
        globalObject->pendingNapiModule = errorInstance;
        vm.writeBarrier(globalObject, errorInstance);
        EnsureStillAliveScope ensureAlive(globalObject->pendingNapiModule);
        return;
    }

    // std::cout << "loaded " << mod->nm_modname << std::endl;

    auto source = JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(generateObjectModuleSourceCode(
                                                 globalObject,
                                                 object),
            JSC::SourceOrigin(), keyStr));

    // Add it to the ESM registry
    globalObject->moduleLoader()->provideFetch(globalObject, JSC::jsString(vm, WTFMove(keyStr)), WTFMove(source));

    globalObject->pendingNapiModule = object;
    vm.writeBarrier(globalObject, object);
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
    NAPI_PREMABLE

    JSValue value = toJS(js_object);
    if (!value || value.isUndefinedOrNull()) {
        return napi_object_expected;
    }

    auto* globalObject = toJS(env);
    auto& vm = globalObject->vm();

    NapiRef** refPtr = nullptr;
    if (auto* val = jsDynamicCast<NapiPrototype*>(value)) {
        refPtr = &val->napiRef;
    } else if (auto* val = jsDynamicCast<NapiClass*>(value)) {
        refPtr = &val->napiRef;
    }

    if (!refPtr) {
        return napi_object_expected;
    }

    if (*refPtr) {
        // Calling napi_wrap() a second time on an object will return an error.
        // To associate another native instance with the object, use
        // napi_remove_wrap() first.
        return napi_invalid_arg;
    }

    auto clientData = WebCore::clientData(vm);

    auto* ref = new NapiRef(globalObject, 0);
    ref->weakValueRef.setObject(value.getObject(), weakValueHandleOwner(), ref);

    if (finalize_cb) {
        ref->finalizer.finalize_cb = finalize_cb;
        ref->finalizer.finalize_hint = finalize_hint;
    }

    if (native_object) {
        ref->data = native_object;
    }

    *refPtr = ref;

    if (result) {
        *result = toNapi(ref);
    }

    return napi_ok;
}

extern "C" napi_status napi_remove_wrap(napi_env env, napi_value js_object,
    void** result)
{
    NAPI_PREMABLE

    JSValue value = toJS(js_object);
    if (!value || value.isUndefinedOrNull()) {
        return napi_object_expected;
    }

    auto* globalObject = toJS(env);
    auto& vm = globalObject->vm();
    NapiRef** refPtr = nullptr;
    if (auto* val = jsDynamicCast<NapiPrototype*>(value)) {
        refPtr = &val->napiRef;
    } else if (auto* val = jsDynamicCast<NapiClass*>(value)) {
        refPtr = &val->napiRef;
    }

    if (!refPtr) {
        return napi_object_expected;
    }

    if (!(*refPtr)) {
        // not sure if this should succeed or return an error
        return napi_ok;
    }

    auto* ref = *refPtr;
    *refPtr = nullptr;

    if (result) {
        *result = ref->data;
    }
    delete ref;

    return napi_ok;
}

extern "C" napi_status napi_unwrap(napi_env env, napi_value js_object,
    void** result)
{
    NAPI_PREMABLE

    JSValue value = toJS(js_object);

    if (!value.isObject()) {
        return NAPI_OBJECT_EXPECTED;
    }
    auto* globalObject = toJS(env);

    NapiRef* ref = nullptr;
    if (auto* val = jsDynamicCast<NapiPrototype*>(value)) {
        ref = val->napiRef;
    } else if (auto* val = jsDynamicCast<NapiClass*>(value)) {
        ref = val->napiRef;
    } else {
        ASSERT(false);
    }

    if (ref && result) {
        *result = ref ? ref->data : nullptr;
    }

    return napi_ok;
}

extern "C" napi_status napi_create_function(napi_env env, const char* utf8name,
    size_t length, napi_callback cb,
    void* data, napi_value* result)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto name = WTF::String();

    if (utf8name != nullptr) {
        name = WTF::String::fromUTF8(utf8name, length == NAPI_AUTO_LENGTH ? strlen(utf8name) : length);
    }

    auto method = reinterpret_cast<Zig::FFIFunction>(cb);
    auto* function = NAPIFunction::create(vm, globalObject, length, name, method, data);

    if (result != nullptr) {
        *result = toNapi(JSC::JSValue(function));
    }

    return napi_ok;
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
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::CallFrame* callFrame = reinterpret_cast<JSC::CallFrame*>(cbinfo);

    if (NAPICallFrame* frame = NAPICallFrame::get(callFrame).value_or(nullptr)) {
        NAPICallFrame::extract(*frame, argc, argv, this_arg, data);
        return napi_ok;
    }

    auto inputArgsCount = argc == nullptr ? 0 : *argc;

    // napi expects arguments to be copied into the argv array.
    if (inputArgsCount > 0) {
        auto outputArgsCount = callFrame->argumentCount();
        auto argsToCopy = inputArgsCount < outputArgsCount ? inputArgsCount : outputArgsCount;
        *argc = argsToCopy;

        memcpy(argv, callFrame->addressOfArgumentsStart(), argsToCopy * sizeof(JSC::JSValue));

        for (size_t i = outputArgsCount; i < inputArgsCount; i++) {
            argv[i] = toNapi(JSC::jsUndefined());
        }
    }

    JSC::JSValue thisValue = callFrame->thisValue();

    if (this_arg != nullptr) {
        *this_arg = toNapi(thisValue);
    }

    if (data != nullptr) {
        JSC::JSValue callee = JSC::JSValue(callFrame->jsCallee());

        if (Zig::JSFFIFunction* ffiFunction = JSC::jsDynamicCast<Zig::JSFFIFunction*>(callee)) {
            *data = ffiFunction->dataPtr;
        } else if (auto* proto = JSC::jsDynamicCast<NapiPrototype*>(callee)) {
            NapiRef* ref = proto->napiRef;
            if (ref) {
                *data = ref->data;
            }
        } else if (auto* proto = JSC::jsDynamicCast<NapiClass*>(callee)) {
            void* local = proto->dataPtr;
            if (!local) {
                NapiRef* ref = nullptr;
                if (ref) {
                    *data = ref->data;
                }
            } else {
                *data = local;
            }
        } else if (auto* proto = JSC::jsDynamicCast<NapiPrototype*>(thisValue)) {
            NapiRef* ref = proto->napiRef;
            if (ref) {
                *data = ref->data;
            }
        } else if (auto* proto = JSC::jsDynamicCast<NapiClass*>(thisValue)) {
            void* local = proto->dataPtr;
            if (!local) {
                NapiRef* ref = nullptr;
                if (ref) {
                    *data = ref->data;
                }
            } else {
                *data = local;
            }
        } else if (auto* proto = JSC::jsDynamicCast<Bun::NapiExternal*>(thisValue)) {
            *data = proto->value();
        } else {
            *data = nullptr;
        }
    }

    return napi_ok;
}

extern "C" napi_status
napi_define_properties(napi_env env, napi_value object, size_t property_count,
    const napi_property_descriptor* properties)
{
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue objectValue = toJS(object);
    JSC::JSObject* objectObject = objectValue.getObject();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!objectObject) {
        return NAPI_OBJECT_EXPECTED;
    }

    void* inheritedDataPtr = nullptr;
    if (NapiPrototype* proto = jsDynamicCast<NapiPrototype*>(objectValue)) {
        inheritedDataPtr = proto->napiRef ? proto->napiRef->data : nullptr;
    } else if (NapiClass* proto = jsDynamicCast<NapiClass*>(objectValue)) {
        inheritedDataPtr = proto->dataPtr;
    }

    for (size_t i = 0; i < property_count; i++) {
        defineNapiProperty(globalObject, objectObject, inheritedDataPtr, properties[i], true, throwScope);

        RETURN_IF_EXCEPTION(throwScope, napi_generic_failure);
    }

    throwScope.release();

    return napi_ok;
}

extern "C" napi_status napi_throw_error(napi_env env,
    const char* code,
    const char* msg)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);

    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto message = msg != nullptr ? WTF::String::fromUTF8(msg) : "Error"_s;
    auto error = JSC::createError(globalObject, message);
    JSC::throwException(globalObject, throwScope, error);
    return napi_ok;
}

extern "C" napi_status napi_create_reference(napi_env env, napi_value value,
    uint32_t initial_refcount,
    napi_ref* result)
{
    NAPI_PREMABLE
    JSC::JSValue val = toJS(value);

    if (!val || !val.isObject()) {
        return napi_object_expected;
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSObject* jsObject = val.getObject();
    NapiPrototype* object = jsDynamicCast<NapiPrototype*>(jsObject);
    if (object && object->napiRef) {
        *result = toNapi(object->napiRef);
        return napi_ok;
    }

    NapiClass* object2 = jsDynamicCast<NapiClass*>(jsObject);
    if (object2 && object2->napiRef) {
        *result = toNapi(object2->napiRef);
        return napi_ok;
    }

    auto* ref = new NapiRef(globalObject, initial_refcount);
    if (initial_refcount > 0) {
        ref->strongRef.set(globalObject->vm(), val);
    } else {
        if (val.isString()) {
            ref->weakValueRef.setString(val.toString(globalObject), weakValueHandleOwner(), ref);
        } else if (val.isObject()) {
            ref->weakValueRef.setObject(val.getObject(), weakValueHandleOwner(), ref);
        } else {
            ref->weakValueRef.setPrimitive(val);
        }
    }

    if (object) {
        object->napiRef = ref;
    } else if (object2) {
        object2->napiRef = ref;
    }

    *result = toNapi(ref);

    return napi_ok;
}

extern "C" void napi_set_ref(NapiRef* ref, JSC__JSValue val_)
{
    NAPI_PREMABLE
    JSC::JSValue val = JSC::JSValue::decode(val_);
    if (val) {
        ref->strongRef.set(ref->globalObject->vm(), val);
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
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue objectValue = toJS(js_object);
    JSC::JSObject* object = objectValue.getObject();
    if (!object) {
        return napi_object_expected;
    }

    vm.heap.addFinalizer(object, [=](JSCell* cell) -> void {
#if NAPI_VERBOSE
        printf("napi_add_finalizer: %p\n", finalize_hint);
#endif
        finalize_cb(env, native_object, finalize_hint);
    });

    return napi_ok;
}

extern "C" napi_status napi_reference_unref(napi_env env, napi_ref ref,
    uint32_t* result)
{
    NAPI_PREMABLE
    NapiRef* napiRef = toJS(ref);
    napiRef->unref();
    *result = napiRef->refCount;
    return napi_ok;
}

// Attempts to get a referenced value. If the reference is weak,
// the value might no longer be available, in that case the call
// is still successful but the result is NULL.
extern "C" napi_status napi_get_reference_value(napi_env env, napi_ref ref,
    napi_value* result)
{
    NAPI_PREMABLE
    NapiRef* napiRef = toJS(ref);
    *result = toNapi(napiRef->value());

    return napi_ok;
}

extern "C" JSC__JSValue napi_get_reference_value_internal(NapiRef* napiRef)
{
    NAPI_PREMABLE
    return JSC::JSValue::encode(napiRef->value());
}

extern "C" napi_status napi_reference_ref(napi_env env, napi_ref ref,
    uint32_t* result)
{
    NAPI_PREMABLE
    NapiRef* napiRef = toJS(ref);
    napiRef->ref();
    *result = napiRef->refCount;
    return napi_ok;
}

extern "C" napi_status napi_delete_reference(napi_env env, napi_ref ref)
{
    NAPI_PREMABLE
    NapiRef* napiRef = toJS(ref);
    delete napiRef;
    return napi_ok;
}

extern "C" void napi_delete_reference_internal(napi_ref ref)
{
    NAPI_PREMABLE
    NapiRef* napiRef = toJS(ref);
    delete napiRef;
}

extern "C" napi_status napi_is_detached_arraybuffer(napi_env env,
    napi_value arraybuffer,
    bool* result)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(toJS(arraybuffer));
    if (UNLIKELY(!jsArrayBuffer)) {
        return napi_arraybuffer_expected;
    }

    auto arrayBuffer = jsArrayBuffer->impl();

    *result = arrayBuffer->isDetached();
    return napi_ok;
}

extern "C" napi_status napi_detach_arraybuffer(napi_env env,
    napi_value arraybuffer)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(toJS(arraybuffer));
    if (UNLIKELY(!jsArrayBuffer)) {
        return napi_arraybuffer_expected;
    }

    auto arrayBuffer = jsArrayBuffer->impl();

    if (arrayBuffer->isDetached()) {
        return napi_ok;
    }

    arrayBuffer->detach(vm);

    return napi_ok;
}

extern "C" napi_status napi_adjust_external_memory(napi_env env,
    int64_t change_in_bytes,
    int64_t* adjusted_value)
{
    NAPI_PREMABLE
    if (change_in_bytes > 0) {
        toJS(env)->vm().heap.deprecatedReportExtraMemory(change_in_bytes);
    }
    *adjusted_value = toJS(env)->vm().heap.extraMemorySize();
    return napi_ok;
}

extern "C" napi_status napi_is_exception_pending(napi_env env, bool* result)
{
    NAPI_PREMABLE
    auto globalObject = toJS(env);
    *result = globalObject->vm().exceptionForInspection() != nullptr;
    return napi_ok;
}
extern "C" napi_status napi_get_and_clear_last_exception(napi_env env,
    napi_value* result)
{
    NAPI_PREMABLE
    auto globalObject = toJS(env);
    *result = toNapi(JSC::JSValue(globalObject->vm().lastException()));
    globalObject->vm().clearLastException();
    return napi_ok;
}

extern "C" napi_status napi_fatal_exception(napi_env env,
    napi_value err)
{
    NAPI_PREMABLE
    auto globalObject = toJS(env);
    JSC::JSValue value = toJS(err);
    JSC::JSObject* obj = value.getObject();
    if (UNLIKELY(obj == nullptr || !obj->isErrorInstance())) {
        return napi_invalid_arg;
    }

    Bun__reportUnhandledError(globalObject, JSValue::encode(value));

    return napi_ok;
}

extern "C" napi_status napi_throw(napi_env env, napi_value error)
{
    NAPI_PREMABLE
    auto globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = toJS(error);
    if (value) {
        JSC::throwException(globalObject, throwScope, value);
    } else {
        JSC::throwException(globalObject, throwScope, JSC::createError(globalObject, "Error (via napi)"_s));
    }

    return napi_ok;
}

extern "C" napi_status node_api_symbol_for(napi_env env,
    const char* utf8description,
    size_t length, napi_value* result)
{
    NAPI_PREMABLE
    auto* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    if (UNLIKELY(!result || !utf8description)) {
        return napi_invalid_arg;
    }

    auto description = WTF::String::fromUTF8(utf8description, length == NAPI_AUTO_LENGTH ? strlen(utf8description) : length);
    *result = toNapi(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(description)));

    return napi_ok;
}

extern "C" napi_status node_api_create_syntax_error(napi_env env,
    napi_value code,
    napi_value msg,
    napi_value* result)
{
    NAPI_PREMABLE
    if (UNLIKELY(!result)) {
        return napi_invalid_arg;
    }

    JSValue messageValue = toJS(msg);
    JSValue codeValue = toJS(code);
    auto globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto* err = messageValue && !messageValue.isUndefinedOrNull() ? createSyntaxError(globalObject, messageValue.toWTFString(globalObject)) : createSyntaxError(globalObject);
    if (codeValue && !codeValue.isUndefinedOrNull()) {
        err->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), codeValue, 0);
    }

    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(err));
    return napi_ok;
}

extern "C" napi_status node_api_throw_syntax_error(napi_env env,
    const char* code,
    const char* msg)
{
    NAPI_PREMABLE

    auto message = msg ? WTF::String::fromUTF8(msg) : String();
    auto globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto* err = createSyntaxError(globalObject, message);
    if (code) {
        err->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), JSC::jsString(vm, String::fromUTF8(code)), 0);
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    scope.throwException(globalObject, err);
    return napi_ok;
}

extern "C" napi_status napi_throw_type_error(napi_env env, const char* code,
    const char* msg)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);

    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto message = WTF::String::fromUTF8(msg);
    auto error = JSC::createTypeError(globalObject, message);
    JSC::throwException(globalObject, throwScope, error);
    return napi_ok;
}

extern "C" napi_status napi_create_type_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue codeValue = toJS(code);
    JSC::JSValue messageValue = toJS(msg);

    auto error = JSC::createTypeError(globalObject, messageValue.toWTFString(globalObject));
    if (codeValue) {
        error->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), codeValue, 0);
    }

    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(error));
    return napi_ok;
}

extern "C" napi_status napi_create_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue codeValue = toJS(code);
    JSC::JSValue messageValue = toJS(msg);

    WTF::String message = messageValue.toWTFString(globalObject);
    if (message.isEmpty()) {
        message = "Error"_s;
    }

    auto* error = JSC::createError(globalObject, message);
    if (codeValue) {
        error->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), codeValue, 0);
    }

    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(error));
    return napi_ok;
}
extern "C" napi_status napi_throw_range_error(napi_env env, const char* code,
    const char* msg)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);

    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto message = WTF::String::fromUTF8(msg);
    auto error = JSC::createRangeError(globalObject, message);
    JSC::throwException(globalObject, throwScope, error);
    return napi_ok;
}

extern "C" napi_status napi_object_freeze(napi_env env, napi_value object_value)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::EncodedJSValue encodedValue = reinterpret_cast<JSC::EncodedJSValue>(object_value);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value.isObject()) {
        return NAPI_OBJECT_EXPECTED;
    }

    JSC::JSObject* object = JSC::jsCast<JSC::JSObject*>(value);
    if (!hasIndexedProperties(object->indexingType())) {
        object->freeze(vm);
    }

    RELEASE_AND_RETURN(throwScope, napi_ok);
}
extern "C" napi_status napi_object_seal(napi_env env, napi_value object_value)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::EncodedJSValue encodedValue = reinterpret_cast<JSC::EncodedJSValue>(object_value);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);

    if (UNLIKELY(!value.isObject())) {
        return NAPI_OBJECT_EXPECTED;
    }

    JSC::JSObject* object = JSC::jsCast<JSC::JSObject*>(value);
    if (!hasIndexedProperties(object->indexingType())) {
        object->seal(vm);
    }

    RELEASE_AND_RETURN(throwScope, napi_ok);
}

extern "C" napi_status napi_get_global(napi_env env, napi_value* result)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    *result = reinterpret_cast<napi_value>(globalObject->globalThis());
    return napi_ok;
}

extern "C" napi_status napi_create_range_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
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
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    // handle:
    // - if they call this function when it was originally a getter/setter call
    // - if they call this function without a result
    if (UNLIKELY(result == nullptr || cbinfo == nullptr)) {
        return napi_invalid_arg;
    }

    CallFrame* callFrame = reinterpret_cast<JSC::CallFrame*>(cbinfo);

    if (NAPICallFrame* frame = NAPICallFrame::get(callFrame).value_or(nullptr)) {
        *result = toNapi(frame->newTarget);
        return napi_ok;
    }

    JSC::JSValue newTarget = callFrame->newTarget();
    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(newTarget));
    return napi_ok;
}

extern "C" napi_status napi_create_dataview(napi_env env, size_t length,
    napi_value arraybuffer,
    size_t byte_offset,
    napi_value* result)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::EncodedJSValue encodedArraybuffer = reinterpret_cast<JSC::EncodedJSValue>(arraybuffer);
    auto arraybufferValue = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(JSC::JSValue::decode(encodedArraybuffer));
    if (!arraybufferValue) {
        return napi_arraybuffer_expected;
    }
    auto dataView = JSC::DataView::create(arraybufferValue->impl(), byte_offset, length);

    if (result != nullptr) {
        *result = reinterpret_cast<napi_value>(dataView->wrap(globalObject, globalObject));
    }

    return napi_ok;
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

JSC_DEFINE_HOST_FUNCTION(NapiClass_ConstructorFunction,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* constructorTarget = asObject(callFrame->jsCallee());
    JSObject* newTarget = asObject(callFrame->newTarget());
    NapiClass* napi = jsDynamicCast<NapiClass*>(constructorTarget);
    while (!napi && constructorTarget) {
        constructorTarget = constructorTarget->getPrototypeDirect().getObject();
        napi = jsDynamicCast<NapiClass*>(constructorTarget);
    }

    if (UNLIKELY(!napi)) {
        JSC::throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "NapiClass constructor called on an object that is not a NapiClass"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    NapiPrototype* prototype = JSC::jsDynamicCast<NapiPrototype*>(napi->getIfPropertyExists(globalObject, vm.propertyNames->prototype));
    RETURN_IF_EXCEPTION(scope, {});

    if (!prototype) {
        JSC::throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "NapiClass constructor is missing the prototype"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    auto* subclass = prototype->subclass(globalObject, newTarget);
    RETURN_IF_EXCEPTION(scope, {});
    callFrame->setThisValue(subclass);

    size_t count = callFrame->argumentCount();
    MarkedArgumentBufferWithSize<12> args;
    size_t argc = callFrame->argumentCount() + 1;
    args.fill(vm, argc, [&](auto* slot) {
        memcpy(slot, ADDRESS_OF_THIS_VALUE_IN_CALLFRAME(callFrame), sizeof(JSC::JSValue) * argc);
    });
    NAPICallFrame frame(JSC::ArgList(args), nullptr);
    frame.newTarget = newTarget;

    auto result = napi->constructor()(globalObject, reinterpret_cast<JSC::CallFrame*>(NAPICallFrame::toNapiCallbackInfo(frame)));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(frame.thisValue()));
}

NapiClass* NapiClass::create(VM& vm, Zig::GlobalObject* globalObject, const char* utf8name,
    size_t length,
    napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties)
{
    WTF::String name = WTF::String::fromUTF8(utf8name, length).isolatedCopy();
    NativeExecutable* executable = vm.getHostFunction(NapiClass_ConstructorFunction, ImplementationVisibility::Public, NapiClass_ConstructorFunction, name);
    Structure* structure = globalObject->NapiClassStructure();
    NapiClass* napiClass = new (NotNull, allocateCell<NapiClass>(vm)) NapiClass(vm, executable, globalObject, structure);
    napiClass->finishCreation(vm, executable, length, name, constructor, data, property_count, properties);
    return napiClass;
}

void NapiClass::finishCreation(VM& vm, NativeExecutable* executable, unsigned length, const String& name, napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties)
{
    Base::finishCreation(vm, executable, length, name);
    ASSERT(inherits(info()));
    this->m_constructor = reinterpret_cast<FFIFunction>(constructor);
    auto globalObject = reinterpret_cast<Zig::GlobalObject*>(this->globalObject());

    // toStringTag + "prototype"
    // size_t staticPropertyCount = 2;
    // prototype always has "constructor",
    size_t prototypePropertyCount = 2;

    this->putDirect(vm, vm.propertyNames->name, jsString(vm, name), JSC::PropertyAttribute::DontEnum | 0);

    auto clientData = WebCore::clientData(vm);

    for (size_t i = 0; i < property_count; i++) {
        const napi_property_descriptor& property = properties[i];
        // staticPropertyCount += property.attributes & napi_static ? 1 : 0;
        prototypePropertyCount += property.attributes & napi_static ? 0 : 1;
    }

    NapiPrototype* prototype = NapiPrototype::create(vm, globalObject->NapiPrototypeStructure());

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    for (size_t i = 0; i < property_count; i++) {
        const napi_property_descriptor& property = properties[i];

        if (property.attributes & napi_static) {
            defineNapiProperty(globalObject, this, nullptr, property, true, throwScope);
        } else {
            defineNapiProperty(globalObject, prototype, nullptr, property, false, throwScope);
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
    DontEnumPropertiesMode jsc_key_mode = key_mode == napi_key_include_prototypes ? DontEnumPropertiesMode::Include : DontEnumPropertiesMode::Exclude;
    PropertyNameMode jsc_property_mode = PropertyNameMode::StringsAndSymbols;
    if (key_filter == napi_key_skip_symbols) {
        jsc_property_mode = PropertyNameMode::Strings;
    } else if (key_filter == napi_key_skip_strings) {
        jsc_property_mode = PropertyNameMode::Symbols;
    }

    auto globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    auto objectValue = toJS(objectNapi);
    auto* object = objectValue.getObject();
    if (!object) {
        return NAPI_OBJECT_EXPECTED;
    }

    JSC::JSArray* exportKeys = ownPropertyKeys(globalObject, object, jsc_property_mode, jsc_key_mode);
    // TODO: filter
    *result = toNapi(JSC::JSValue::encode(exportKeys));
    return napi_ok;
}

static napi_extended_error_info last_error_info;

extern "C" napi_status
napi_get_last_error_info(napi_env env, const napi_extended_error_info** result)
{
    NAPI_PREMABLE
    auto globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto lastException = vm.lastException();
    if (!lastException) {
        last_error_info = {
            "",
            nullptr,
            404,
            napi_generic_failure
        };
        *result = &last_error_info;
        return napi_ok;
    }

    last_error_info = {
        lastException->value().toWTFString(globalObject).utf8().data(),
        lastException,
        69420,
        napi_generic_failure
    };
    *result = &last_error_info;

    return napi_ok;
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
    NAPI_PREMABLE

    if (utf8name == nullptr) {
        return napi_invalid_arg;
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    size_t len = length;
    if (len == NAPI_AUTO_LENGTH) {
        len = strlen(utf8name);
    }
    NapiClass* napiClass = NapiClass::create(vm, globalObject, utf8name, len, constructor, data, property_count, properties);
    JSC::JSValue value = JSC::JSValue(napiClass);
    JSC::EnsureStillAliveScope ensureStillAlive1(value);
    if (data != nullptr) {
        napiClass->dataPtr = data;
    }

    *result = toNapi(value);
    return napi_ok;
}

extern "C" napi_status napi_coerce_to_string(napi_env env, napi_value value,
    napi_value* result)
{
    NAPI_PREMABLE
    if (UNLIKELY(result == nullptr || value == nullptr || env == nullptr)) {
        return napi_invalid_arg;
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue jsValue = toJS(value);
    JSC::EnsureStillAliveScope ensureStillAlive(jsValue);

    // .toString() can throw
    JSC::JSValue resultValue = JSC::JSValue(jsValue.toString(globalObject));
    JSC::EnsureStillAliveScope ensureStillAlive1(resultValue);
    *result = toNapi(resultValue);

    if (UNLIKELY(scope.exception())) {
        *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(JSC::jsUndefined()));
        return napi_generic_failure;
    }
    scope.clearException();
    return napi_ok;
}

extern "C" napi_status napi_get_property_names(napi_env env, napi_value object,
    napi_value* result)
{
    NAPI_PREMABLE
    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue jsValue = toJS(object);
    if (!jsValue || !jsValue.isObject()) {
        return napi_invalid_arg;
    }

    auto scope = DECLARE_CATCH_SCOPE(vm);
    JSC::EnsureStillAliveScope ensureStillAlive(jsValue);
    JSC::JSValue value = JSC::ownPropertyKeys(globalObject, jsValue.getObject(), PropertyNameMode::Strings, DontEnumPropertiesMode::Include);
    if (UNLIKELY(scope.exception())) {
        *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(JSC::jsUndefined()));
        return napi_generic_failure;
    }
    scope.clearException();
    JSC::EnsureStillAliveScope ensureStillAlive1(value);

    *result = toNapi(value);

    return napi_ok;
}

extern "C" napi_status napi_create_external_buffer(napi_env env, size_t length,
    void* data,
    napi_finalize finalize_cb,
    void* finalize_hint,
    napi_value* result)
{
    NAPI_PREMABLE
    if (UNLIKELY(result == nullptr)) {
        return napi_invalid_arg;
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    auto arrayBuffer = ArrayBuffer::createFromBytes(data, length, createSharedTask<void(void*)>([globalObject, finalize_hint, finalize_cb](void* p) {
#if NAPI_VERBOSE
        printf("[napi] buffer finalize_callback\n");
#endif
        if (finalize_cb != nullptr) {
            finalize_cb(toNapi(globalObject), p, finalize_hint);
        }
    }));
    auto* subclassStructure = globalObject->JSBufferSubclassStructure();

    auto* buffer = JSC::JSUint8Array::create(globalObject, subclassStructure, WTFMove(arrayBuffer), 0, length);

    *result = toNapi(buffer);
    return napi_ok;
}

extern "C" napi_status napi_create_external_arraybuffer(napi_env env, void* external_data, size_t byte_length,
    napi_finalize finalize_cb, void* finalize_hint, napi_value* result)
{
    NAPI_PREMABLE

    if (UNLIKELY(result == nullptr)) {
        return napi_invalid_arg;
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    auto arrayBuffer = ArrayBuffer::createFromBytes(external_data, byte_length, createSharedTask<void(void*)>([globalObject, finalize_hint, finalize_cb](void* p) {
#if NAPI_VERBOSE
        printf("[napi] arraybuffer finalize_callback\n");
#endif
        if (finalize_cb != nullptr) {
            finalize_cb(toNapi(globalObject), p, finalize_hint);
        }
    }));

    auto* buffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(ArrayBufferSharingMode::Shared), WTFMove(arrayBuffer));

    *result = toNapi(buffer);

    return napi_ok;
}

extern "C" napi_status napi_create_double(napi_env env, double value,
    napi_value* result)
{
    NAPI_PREMABLE
    if (UNLIKELY(result == nullptr)) {
        return napi_invalid_arg;
    }

    *result = toNapi(jsDoubleNumber(value));
    return napi_ok;
}

extern "C" napi_status napi_get_value_double(napi_env env, napi_value value,
    double* result)
{
    NAPI_PREMABLE

    auto* globalObject = toJS(env);
    JSC::JSValue jsValue = toJS(value);

    if (UNLIKELY(result == nullptr || !globalObject)) {
        return napi_invalid_arg;
    }

    if (UNLIKELY(!jsValue || !jsValue.isNumber())) {
        return napi_number_expected;
    }

    auto scope = DECLARE_CATCH_SCOPE(globalObject->vm());

    *result = jsValue.toNumber(globalObject);

    if (UNLIKELY(scope.exception())) {
        scope.clearException();
        return napi_generic_failure;
    }

    return napi_ok;
}

extern "C" napi_status napi_get_value_string_utf8(napi_env env,
    napi_value napiValue, char* buf,
    size_t bufsize,
    size_t* writtenPtr)
{
    NAPI_PREMABLE

    JSGlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSValue jsValue = toJS(napiValue);
    if (!jsValue || !jsValue.isString()) {
        return napi_string_expected;
    }

    JSString* jsString = jsValue.toStringOrNull(globalObject);
    if (UNLIKELY(!jsString)) {
        return napi_generic_failure;
    }

    size_t length = jsString->length();
    auto viewWithUnderlyingString = jsString->viewWithUnderlyingString(globalObject);
    auto view = viewWithUnderlyingString.view;

    if (buf == nullptr) {
        if (writtenPtr != nullptr) {
            if (view.is8Bit()) {
                *writtenPtr = Bun__encoding__byteLengthLatin1(view.characters8(), length, static_cast<uint8_t>(WebCore::BufferEncodingType::utf8));
            } else {
                *writtenPtr = Bun__encoding__byteLengthUTF16(view.characters16(), length, static_cast<uint8_t>(WebCore::BufferEncodingType::utf8));
            }
        }

        return napi_ok;
    }

    if (UNLIKELY(bufsize == 0)) {
        *writtenPtr = 0;
        return napi_ok;
    }

    if (UNLIKELY(bufsize == NAPI_AUTO_LENGTH)) {
        *writtenPtr = 0;
        buf[0] = '\0';
        return napi_ok;
    }

    size_t written;
    if (view.is8Bit()) {
        written = Bun__encoding__writeLatin1(view.characters8(), view.length(), reinterpret_cast<unsigned char*>(buf), bufsize - 1, static_cast<uint8_t>(WebCore::BufferEncodingType::utf8));
    } else {
        written = Bun__encoding__writeUTF16(view.characters16(), view.length(), reinterpret_cast<unsigned char*>(buf), bufsize - 1, static_cast<uint8_t>(WebCore::BufferEncodingType::utf8));
    }

    if (writtenPtr != nullptr) {
        *writtenPtr = written;
    }

    if (written < bufsize) {
        buf[written] = '\0';
    }

    return napi_ok;
}

extern "C" napi_status napi_get_element(napi_env env, napi_value objectValue,
    uint32_t index, napi_value* result)
{
    NAPI_PREMABLE

    JSValue jsValue = toJS(objectValue);
    if (UNLIKELY(!env || !jsValue || !jsValue.isObject())) {
        return napi_invalid_arg;
    }

    JSObject* object = jsValue.getObject();

    auto scope = DECLARE_THROW_SCOPE(object->vm());
    JSValue element = object->getIndex(toJS(env), index);
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    if (result) {
        *result = toNapi(element);
    }

    return napi_ok;
}

extern "C" napi_status napi_delete_element(napi_env env, napi_value objectValue,
    uint32_t index, bool* result)
{
    NAPI_PREMABLE

    JSValue jsValue = toJS(objectValue);
    if (UNLIKELY(!env || !jsValue || !jsValue.isObject())) {
        return napi_invalid_arg;
    }

    JSObject* object = jsValue.getObject();

    auto scope = DECLARE_THROW_SCOPE(object->vm());
    *result = JSObject::deletePropertyByIndex(object, toJS(env), index);
    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    return napi_ok;
}

extern "C" napi_status napi_create_object(napi_env env, napi_value* result)
{
    NAPI_PREMABLE

    if (UNLIKELY(result == nullptr || env == nullptr)) {
        return napi_invalid_arg;
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSValue value = JSValue(NapiPrototype::create(vm, globalObject->NapiPrototypeStructure()));

    *result = toNapi(value);
    JSC::EnsureStillAliveScope ensureStillAlive(value);

    return napi_ok;
}
extern "C" napi_status napi_create_external(napi_env env, void* data,
    napi_finalize finalize_cb,
    void* finalize_hint,
    napi_value* result)
{
    NAPI_PREMABLE
    if (UNLIKELY(result == nullptr)) {
        return napi_invalid_arg;
    }

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    auto* structure = globalObject->NapiExternalStructure();
    JSValue value = Bun::NapiExternal::create(vm, structure, data, finalize_hint, reinterpret_cast<void*>(finalize_cb));
    JSC::EnsureStillAliveScope ensureStillAlive(value);
    *result = toNapi(value);
    return napi_ok;
}

extern "C" napi_status napi_typeof(napi_env env, napi_value val,
    napi_valuetype* result)
{
    NAPI_PREMABLE

    if (UNLIKELY(result == nullptr))
        return napi_invalid_arg;

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue value = toJS(val);

    if (value.isEmpty()) {
        // This can happen
        *result = napi_undefined;
        return napi_ok;
    }

    if (value.isCell()) {
        JSC::JSCell* cell = value.asCell();

        switch (cell->type()) {
        case JSC::JSFunctionType:
        case JSC::InternalFunctionType:
            *result = napi_function;
            return napi_ok;

        case JSC::ObjectType:
            if (JSC::jsDynamicCast<Bun::NapiExternal*>(value)) {
                *result = napi_external;
                return napi_ok;
            }

            *result = napi_object;
            return napi_ok;

        case JSC::HeapBigIntType:
            *result = napi_bigint;
            return napi_ok;
        case JSC::DerivedStringObjectType:
        case JSC::StringObjectType:
        case JSC::StringType:
            *result = napi_string;
            return napi_ok;
        case JSC::SymbolType:
            *result = napi_symbol;
            return napi_ok;

        case JSC::FinalObjectType:
        case JSC::ArrayType:
        case JSC::DerivedArrayType:
            *result = napi_object;
            return napi_ok;

        default: {
            if (cell->isCallable() || cell->isConstructor()) {
                *result = napi_function;
                return napi_ok;
            }

            if (cell->isObject()) {
                *result = napi_object;
                return napi_ok;
            }

            break;
        }
        }
    }

    if (value.isNumber()) {
        *result = napi_number;
        return napi_ok;
    }

    if (value.isUndefined()) {
        *result = napi_undefined;
        return napi_ok;
    }

    if (value.isNull()) {
        *result = napi_null;
        return napi_ok;
    }

    if (value.isBoolean()) {
        *result = napi_boolean;
        return napi_ok;
    }

    return napi_generic_failure;
}

extern "C" napi_status napi_get_value_bigint_words(napi_env env,
    napi_value value,
    int* sign_bit,
    size_t* word_count,
    uint64_t* words)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);

    JSC::JSValue jsValue = toJS(value);
    if (UNLIKELY(!jsValue.isBigInt()))
        return napi_invalid_arg;

    JSC::JSBigInt* bigInt = jsValue.asHeapBigInt();
    if (UNLIKELY(!bigInt))
        return napi_invalid_arg;

    if (UNLIKELY(word_count == nullptr))
        return napi_invalid_arg;

    size_t available_words = *word_count;
    *word_count = bigInt->length();

    // If both sign_bit and words are nullptr, we're just querying the word count
    // Return ok in this case
    if (sign_bit == nullptr) {
        // However, if one of them is nullptr, we have an invalid argument
        if (UNLIKELY(words != nullptr))
            return napi_invalid_arg;

        return napi_ok;
    } else if (UNLIKELY(words == nullptr))
        return napi_invalid_arg; // If sign_bit is not nullptr, words must not be nullptr

    *sign_bit = (int)bigInt->sign();

    size_t len = *word_count;
    for (size_t i = 0; i < available_words && i < len; i++)
        words[i] = bigInt->digit(i);

    return napi_ok;
}

extern "C" napi_status napi_get_value_external(napi_env env, napi_value value,
    void** result)
{
    NAPI_PREMABLE

    if (UNLIKELY(result == nullptr)) {
        return napi_invalid_arg;
    }

    auto* external = jsDynamicCast<Bun::NapiExternal*>(toJS(value));
    if (UNLIKELY(!external)) {
        return napi_invalid_arg;
    }

    *result = external->value();
    return napi_ok;
}

// TODO: make this per addon instead of globally shared for ALL addons
extern "C" napi_status napi_get_instance_data(napi_env env,
    void** data)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    if (UNLIKELY(data == nullptr)) {
        return napi_invalid_arg;
    }

    *data = globalObject->napiInstanceData;
    return napi_ok;
}

extern "C" napi_status napi_set_instance_data(napi_env env,
    void* data,
    napi_finalize finalize_cb,
    void* finalize_hint)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    if (data)
        globalObject->napiInstanceData = data;

    globalObject->napiInstanceDataFinalizer = reinterpret_cast<void*>(finalize_cb);
    globalObject->napiInstanceDataFinalizerHint = finalize_hint;

    return napi_ok;
}

extern "C" napi_status napi_create_bigint_words(napi_env env,
    int sign_bit,
    size_t word_count,
    const uint64_t* words,
    napi_value* result)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();
    auto* bigint = JSC::JSBigInt::tryCreateWithLength(vm, word_count);
    if (UNLIKELY(!bigint)) {
        return napi_generic_failure;
    }

    // TODO: verify sign bit is consistent
    bigint->setSign(sign_bit);

    if (words != nullptr) {
        const uint64_t* word = words;
        // TODO: add fast path that uses memcpy here instead of setDigit
        // we need to add this to JSC. V8 has this optimization
        for (size_t i = 0; i < word_count; i++) {
            bigint->setDigit(i, *word++);
        }
    }

    *result = toNapi(bigint);
    return napi_ok;
}

extern "C" napi_status napi_create_symbol(napi_env env, napi_value description,
    napi_value* result)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    if (UNLIKELY(result == nullptr || globalObject == nullptr)) {
        return napi_invalid_arg;
    }

    JSC::JSValue descriptionValue = toJS(description);
    if (descriptionValue && !descriptionValue.isUndefinedOrNull()) {
        if (!descriptionValue.isString()) {
            return napi_string_expected;
        }

        JSC::JSString* descriptionString = descriptionValue.toStringOrNull(globalObject);
        if (UNLIKELY(!descriptionString)) {
            return napi_generic_failure;
        }

        if (descriptionString->length() > 0) {
            *result = toNapi(JSC::Symbol::createWithDescription(vm, descriptionString->value(globalObject)));
            return napi_ok;
        }
    }

    *result = toNapi(JSC::Symbol::create(vm));
    return napi_ok;
}

extern "C" napi_status napi_call_function(napi_env env, napi_value recv_napi,
    napi_value func_napi, size_t argc,
    const napi_value* argv,
    napi_value* result_ptr)
{
    NAPI_PREMABLE

    Zig::GlobalObject* globalObject = toJS(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue funcValue = toJS(func_napi);

    if (UNLIKELY(!funcValue.isCell()))
        return napi_function_expected;

    JSC::CallData callData = getCallData(funcValue);
    if (UNLIKELY(callData.type == JSC::CallData::Type::None))
        return napi_function_expected;

    JSC::MarkedArgumentBuffer args;
    if (argc > 0 && LIKELY(argv != nullptr)) {
        auto end = argv + argc;
        for (auto it = argv; it != end; ++it) {
            args.append(toJS(*it));
        }
    }

    JSC::JSValue thisValue = toJS(recv_napi);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (thisValue.isEmpty()) {
        thisValue = JSC::jsUndefined();
    }
    JSC::JSValue result = call(globalObject, funcValue, callData, thisValue, args);

    if (result_ptr) {
        if (result.isEmpty()) {
            *result_ptr = toNapi(JSC::jsUndefined());
        } else {
            *result_ptr = toNapi(result);
        }
    }

    RETURN_IF_EXCEPTION(scope, napi_generic_failure);

    RELEASE_AND_RETURN(scope, napi_ok);
}
