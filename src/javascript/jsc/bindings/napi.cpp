
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
#include "JavaScriptCore/JavaScript.h"
#include "JavaScriptCore/JSWeakValue.h"
#include "napi.h"
#include "JavaScriptCore/GetterSetter.h"

#include <iostream>
using namespace JSC;
using namespace Zig;

class NapiRefWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final
    {
        auto* weakValue = reinterpret_cast<NapiRef*>(context);
        weakValue->clear();
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
        this->finalize_cb(reinterpret_cast<napi_env>(globalObject), this->finalize_hint, data);
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
        JSC::JSValue val = strongRef.get();
        if (val.isString()) {
            weakValueRef.setString(val.toString(globalObject.get()), weakValueHandleOwner(), this);
        } else if (val.isObject()) {
            weakValueRef.setObject(val.getObject(), weakValueHandleOwner(), this);
        } else {
            weakValueRef.setPrimitive(val);
        }
        strongRef.clear();
    }
}

void NapiRef::clear()
{
    this->finalizer.call(this->globalObject.get(), nullptr);
    this->globalObject.clear();
    this->weakValueRef.clear();
    this->strongRef.clear();
}

// namespace Napi {
// class Reference
// }
#define StackAllocatedCallFramePointerTag 62
typedef struct StackAllocatedCallFrame {
    void* dataPtr;
    JSC::EncodedJSValue thisValue;
    // this is "bar" in:
    //  set foo(bar)
    JSC::EncodedJSValue argument1;
} StackAllocatedCallFrame;

extern "C" Zig::GlobalObject*
Bun__getDefaultGlobal();

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
        result |= JSC::PropertyAttribute::ReadOnly;
    }

    return result;
}

static uint32_t getPropertyAttributes(napi_property_descriptor prop)
{
    uint32_t result = getPropertyAttributes(prop.attributes);

    if (!(prop.getter && !prop.setter)) {
        result |= JSC::PropertyAttribute::ReadOnly;
    }

    if (prop.method) {
        result |= JSC::PropertyAttribute::Function;
    }

    return result;
}

const ClassInfo NapiClass::s_info = { "Function"_s, &NapiClass::Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiClass) };

static void defineNapiProperty(Zig::GlobalObject* globalObject, JSC::JSObject* to, napi_property_descriptor property)
{
    JSC::VM& vm = globalObject->vm();
    void* dataPtr = property.data;
    auto is_static = !!(property.attributes & napi_static);
    WTF::String nameStr;
    if (property.utf8name != nullptr) {
        nameStr = WTF::String::fromUTF8(property.utf8name);
    } else if (property.name) {
        nameStr = toJS(property.name).toWTFString(globalObject);
    }

    auto propertyName = JSC::PropertyName(JSC::Identifier::fromString(vm, nameStr));

    if (property.method) {
        auto function = Zig::JSFFIFunction::create(vm, globalObject, 1, nameStr, reinterpret_cast<Zig::FFIFunction>(property.method));
        function->dataPtr = dataPtr;
        JSC::JSValue value = JSC::JSValue(function);

        to->putDirect(vm, Identifier::fromString(vm, nameStr), value, getPropertyAttributes(property));
        return;
    }

    if (property.getter != nullptr || property.setter != nullptr) {
        JSC::JSValue getter = {};
        JSC::JSValue setter = {};

        if (property.getter) {
            auto callGetter = property.getter;
            auto function = Zig::JSFFIFunction::create(vm, globalObject, 0, nameStr, reinterpret_cast<Zig::FFIFunction>(property.getter));
            function->dataPtr = dataPtr;
            getter = JSC::JSValue(function);
        }

        if (property.setter) {
            auto callGetter = property.setter;
            auto function = Zig::JSFFIFunction::create(vm, globalObject, 1, nameStr, reinterpret_cast<Zig::FFIFunction>(property.setter));
            function->dataPtr = dataPtr;
            getter = JSC::JSValue(function);
        }

        auto getterSetter = JSC::GetterSetter::create(vm, globalObject, getter, setter);
        to->putDirect(vm, propertyName, getterSetter, getPropertyAttributes(property) | JSC::PropertyAttribute::Accessor);

    } else {
        // TODO: is dataPtr allowed when given a value?
        JSC::JSValue value = JSC::jsUndefined();

        if (property.value) {
            value = toJS(property.value);
        }

        to->putDirect(vm, propertyName, value, getPropertyAttributes(property));
    }
}

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

extern "C" napi_status napi_wrap(napi_env env,
    napi_value js_object,
    void* native_object,
    napi_finalize finalize_cb,
    void* finalize_hint,
    napi_ref* result)
{
    if (!toJS(js_object).isObject()) {
        return napi_object_expected;
    }

    auto* globalObject = toJS(env);
    auto& vm = globalObject->vm();
    auto* val = toJS(js_object).getObject();
    auto clientData = WebCore::clientData(vm);

    if (native_object) {
        uintptr_t ref_ptr = reinterpret_cast<uintptr_t>(native_object);
        double ref_double = bitwise_cast<double>(ref_ptr);
        val->putDirect(vm, clientData->builtinNames().passwordPrivateName(), JSC::jsNumber(ref_double), JSC::PropertyAttribute::DontEnum | 0);
    }

    if (result) {
        auto* ref = new NapiRef(globalObject, 0);
        auto clientData = WebCore::clientData(vm);
        if (finalize_cb) {
            ref->finalizer.finalize_cb = finalize_cb;
            ref->finalizer.finalize_hint = finalize_hint;
        }
        *result = reinterpret_cast<napi_ref>(ref);
    }

    return napi_ok;
}

extern "C" napi_status napi_unwrap(napi_env env, napi_value js_object,
    void** result)
{
    if (!toJS(js_object).isObject()) {
        return napi_object_expected;
    }
    auto* globalObject = toJS(env);
    auto& vm = globalObject->vm();
    auto* object = toJS(js_object).getObject();
    auto clientData = WebCore::clientData(vm);

    if (result) {
        JSC::JSValue priv = object->getDirect(vm, clientData->builtinNames().passwordPrivateName());
        if (priv.isNumber()) {
            uintptr_t ref_ptr = bitwise_cast<uintptr_t>(priv.asNumber());
            *result = reinterpret_cast<void*>(ref_ptr);
        } else {
            *result = nullptr;
        }
    }

    return napi_ok;
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
    auto inputArgsCount = argc == nullptr ? 0 : *argc;
    JSC::CallFrame* callFrame = reinterpret_cast<JSC::CallFrame*>(cbinfo);

    // napi expects arguments to be copied into the argv array.
    if (inputArgsCount > 0) {
        auto outputArgsCount = callFrame->argumentCount();
        auto argsToCopy = inputArgsCount < outputArgsCount ? inputArgsCount : outputArgsCount;
        *argc = argsToCopy;

        memcpy(argv, callFrame->addressOfArgumentsStart(), argsToCopy * sizeof(JSC::JSValue));

        // If the user didn't provide expected number of args, we need to fill the rest with undefined.
        // TODO: can we use memset() here?
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
        JSC::JSValue callee = JSC::JSValue(callFrame->jsCallee());
        if (Zig::JSFFIFunction* ffiFunction = JSC::jsDynamicCast<Zig::JSFFIFunction*>(callee)) {
            *data = reinterpret_cast<void*>(ffiFunction->dataPtr);
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
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue objectValue = JSC::JSValue(reinterpret_cast<JSC::EncodedJSValue>(object));
    JSC::JSObject* objectObject = objectValue.getObject();
    if (!objectObject) {
        return napi_object_expected;
    }

    for (size_t i = 0; i < property_count; i++) {
        defineNapiProperty(globalObject, objectObject, properties[i]);
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

    JSC::JSValue val = toJS(value);

    if (!val.isObject()) {
        return napi_object_expected;
    }

    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    auto* ref = new NapiRef(toJS(env), initial_refcount);

    auto clientData = WebCore::clientData(vm);

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

    uintptr_t ref_ptr = reinterpret_cast<uintptr_t>(ref);
    double ref_double = bitwise_cast<double>(ref_ptr);
    val.getObject()->putDirect(vm, clientData->builtinNames().passwordPrivateName(), JSC::jsNumber(ref_double), JSC::PropertyAttribute::DontEnum | 0);

    *result = toNapi(ref);

    return napi_ok;
}

extern "C" napi_status napi_reference_unref(napi_env env, napi_ref ref,
    uint32_t* result)
{
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
    NapiRef* napiRef = toJS(ref);
    *result = toNapi(napiRef->value());
    return napi_ok;
}

extern "C" napi_status napi_reference_ref(napi_env env, napi_ref ref,
    uint32_t* result)
{
    NapiRef* napiRef = toJS(ref);
    napiRef->ref();
    *result = napiRef->refCount;
    return napi_ok;
}

extern "C" napi_status napi_delete_reference(napi_env env, napi_ref ref)
{
    NapiRef* napiRef = toJS(ref);
    napiRef->~NapiRef();
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

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(value);
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

    JSC::JSArrayBuffer* jsArrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(value);
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

extern "C" napi_status napi_create_type_error(napi_env env, napi_value code,
    napi_value msg,
    napi_value* result)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    JSC::JSValue codeValue = JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(code));
    JSC::JSValue messageValue = JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(msg));

    auto error = JSC::createTypeError(globalObject, messageValue.toWTFString(globalObject));
    if (codeValue) {
        error->putDirect(vm, Identifier::fromString(vm, "code"_s), codeValue, 0);
    }

    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(error));
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

    if (UNLIKELY(!value.isObject())) {
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
    // handle:
    // - if they call this function when it was originally a getter/setter call
    // - if they call this function without a result
    if (UNLIKELY(result == nullptr || cbinfo == nullptr)) {
        return napi_invalid_arg;
    }

    if (reinterpret_cast<size_t>(cbinfo) & (static_cast<size_t>(1) << StackAllocatedCallFramePointerTag)) {
        // This is a stack allocated call frame, so we can't get the new target.
        // We'll just return undefined.
        // TODO: verify this is what napi does too
        *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(JSC::jsUndefined()));
        return napi_ok;
    }

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

NapiClass* NapiClass::create(VM& vm, Zig::GlobalObject* globalObject, const char* utf8name,
    size_t length,
    napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties)
{
    WTF::String name = WTF::String::fromUTF8(utf8name, length);
    NativeExecutable* executable = vm.getHostFunction(reinterpret_cast<FFIFunction>(constructor), JSC::NoIntrinsic, callHostFunctionAsConstructor, nullptr, name);

    Structure* structure = globalObject->NapiClassStructure();
    NapiClass* napiClass = new (NotNull, allocateCell<NapiClass>(vm)) NapiClass(vm, executable, globalObject, structure);
    napiClass->finishCreation(vm, executable, length, name, constructor, data, property_count, properties);
    return napiClass;
}

CallData NapiClass::getConstructData(JSCell* cell)
{
    auto construct = JSC::jsCast<NapiClass*>(cell)->constructor();
    if (!construct) {
        return NapiClass::Base::getConstructData(cell);
    }

    CallData constructData;
    constructData.type = CallData::Type::Native;
    constructData.native.function = construct;
    return constructData;
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

    JSC::JSObject* prototype = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), prototypePropertyCount);

    for (size_t i = 0; i < property_count; i++) {
        const napi_property_descriptor& property = properties[i];

        if (property.attributes & napi_static) {
            defineNapiProperty(globalObject, this, property);
        } else {
            defineNapiProperty(globalObject, prototype, property);
        }
    }

    this->putDirect(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | 0);
    prototype->putDirect(vm, vm.propertyNames->constructor, this, JSC::PropertyAttribute::DontEnum | 0);
    prototype->putDirect(vm, clientData->builtinNames().passwordPrivateName(), JSC::jsNumber(0), JSC::PropertyAttribute::DontEnum | 0);
}
}

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

    auto globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    auto objectValue = JSC::JSValue::decode(reinterpret_cast<EncodedJSValue>(objectNapi));
    auto* object = objectValue.getObject();
    if (!object) {
        return napi_object_expected;
    }

    JSC::JSArray* exportKeys = ownPropertyKeys(globalObject, object, jsc_property_mode, jsc_key_mode, std::nullopt);
    // TODO: filter
    *result = toNapi(JSC::JSValue::encode(exportKeys));
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
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    NapiClass* napiClass = NapiClass::create(vm, globalObject, utf8name, length, constructor, data, property_count, properties);
    JSC::JSValue value = JSC::JSValue(napiClass);
    if (data != nullptr) {
        napiClass->dataPtr = data;
    }

    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(value));
    return napi_ok;
}

extern "C" napi_status napi_coerce_to_string(napi_env env, napi_value value,
    napi_value* result)
{
    if (UNLIKELY(result == nullptr)) {
        return napi_invalid_arg;
    }

    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(env);
    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_CATCH_SCOPE(vm);
    JSC::JSValue jsValue = JSC::JSValue::decode(reinterpret_cast<JSC::EncodedJSValue>(value));

    // .toString() can throw
    JSC::JSValue resultValue = JSC::JSValue(jsValue.toString(globalObject));
    *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(resultValue));

    if (UNLIKELY(scope.exception())) {
        *result = reinterpret_cast<napi_value>(JSC::JSValue::encode(JSC::jsUndefined()));
        return napi_generic_failure;
    }
    scope.clearException();
    return napi_ok;
}