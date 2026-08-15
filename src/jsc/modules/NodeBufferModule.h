#pragma once

#include "root.h"

#include "../bindings/JSBuffer.h"
#include "ErrorCode.h"
#include "JavaScriptCore/PageCount.h"
#include "NodeValidator.h"
#include "_NativeModule.h"
#include "wtf/SIMDUTF.h"
#include <limits>

namespace Zig {
using namespace WebCore;
using namespace JSC;

// Shared by buffer.isUtf8() and buffer.isAscii(). Node accepts a TypedArray (so not a
// DataView), an ArrayBuffer or a SharedArrayBuffer and throws ERR_INVALID_ARG_TYPE for
// anything else; only a detached ArrayBuffer is ERR_INVALID_STATE, a view whose buffer
// was detached has a byteLength of 0 and validates like any other empty input.
// https://github.com/nodejs/node/blob/v26.3.0/lib/buffer.js#L1415-L1429
// https://github.com/nodejs/node/blob/v26.3.0/src/node_buffer.cc#L1305-L1333
template<typename Validate>
static JSC::EncodedJSValue validateBytesOf(JSC::JSGlobalObject* globalObject, JSC::JSValue input, Validate validate)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    std::span<const uint8_t> bytes;
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(input); view && isTypedArrayType(view->type())) {
        bytes = view->span();
    } else if (auto* arrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(input)) {
        if (arrayBuffer->impl()->isDetached()) [[unlikely]] {
            // Thrown from C++ in Node too, so without the "Invalid state: " prefix Bun::ERR::INVALID_STATE adds.
            return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "Cannot validate on a detached buffer"_s);
        }
        bytes = arrayBuffer->impl()->span();
    } else {
        return Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, "input"_s, "ArrayBuffer, Buffer, or TypedArray"_s, input);
    }

    if (bytes.empty())
        return JSValue::encode(jsBoolean(true));

    return JSValue::encode(jsBoolean(validate(reinterpret_cast<const char*>(bytes.data()), bytes.size())));
}

// TODO: Add DOMJIT fast path
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isUtf8,
    (JSC::JSGlobalObject * lexicalGlobalObject,
        JSC::CallFrame* callframe))
{
    return validateBytesOf(lexicalGlobalObject, callframe->argument(0), [](const char* data, size_t length) {
        return simdutf::validate_utf8(data, length);
    });
}

// TODO: Add DOMJIT fast path
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isAscii,
    (JSC::JSGlobalObject * lexicalGlobalObject,
        JSC::CallFrame* callframe))
{
    return validateBytesOf(lexicalGlobalObject, callframe->argument(0), [](const char* data, size_t length) {
        return simdutf::validate_ascii(data, length);
    });
}

BUN_DECLARE_HOST_FUNCTION(jsFunctionResolveObjectURL);

BUN_DECLARE_HOST_FUNCTION(jsBufferTranscode);

JSC_DEFINE_CUSTOM_GETTER(jsGetter_INSPECT_MAX_BYTES, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    auto globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(jsNumber(globalObject->INSPECT_MAX_BYTES));
}

JSC_DEFINE_CUSTOM_SETTER(jsSetter_INSPECT_MAX_BYTES, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    auto globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto val = JSValue::decode(value);
    Bun::V::validateNumber(scope, globalObject, val, jsString(vm, String("INSPECT_MAX_BYTES"_s)), jsNumber(0), jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    globalObject->INSPECT_MAX_BYTES = val.asNumber();
    return JSValue::encode(jsUndefined());
}

DEFINE_NATIVE_MODULE(NodeBuffer)
{
    INIT_NATIVE_MODULE(NodeBuffer, 12);
    auto scope = DECLARE_THROW_SCOPE(vm);

    put(JSC::Identifier::fromString(vm, "Buffer"_s), globalObject->JSBufferConstructor());

    auto* slowBuffer = JSC::JSFunction::create(vm, globalObject, 0, "SlowBuffer"_s, WebCore::constructSlowBuffer, ImplementationVisibility::Public, NoIntrinsic, WebCore::constructSlowBuffer);
    slowBuffer->putDirect(vm, vm.propertyNames->prototype, globalObject->JSBufferPrototype(), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    put(JSC::Identifier::fromString(vm, "SlowBuffer"_s), slowBuffer);
    auto blobIdent = JSC::Identifier::fromString(vm, "Blob"_s);

    JSValue blobValue = globalObject->JSBlobConstructor();
    put(blobIdent, blobValue);

    put(JSC::Identifier::fromString(vm, "File"_s), globalObject->JSDOMFileConstructor());

    {
        auto name = Identifier::fromString(vm, "INSPECT_MAX_BYTES"_s);
        auto value = JSC::CustomGetterSetter::create(vm, jsGetter_INSPECT_MAX_BYTES, jsSetter_INSPECT_MAX_BYTES);
        auto attributes = PropertyAttribute::DontDelete | PropertyAttribute::CustomAccessor;
        if (!defaultObjectWasCached)
            defaultObject->putDirectCustomAccessor(vm, name, value, (unsigned)attributes);
        exportNames.append(name);
        // We cannot assign a custom getter/setter to ESM exports.
        exportValues.append(jsNumber(defaultGlobalObject(lexicalGlobalObject)->INSPECT_MAX_BYTES));
        __NATIVE_MODULE_ASSERT_INCR;
    }

    put(JSC::Identifier::fromString(vm, "kMaxLength"_s), JSC::jsNumber(Bun::Buffer::kMaxLength));
    put(JSC::Identifier::fromString(vm, "kStringMaxLength"_s), JSC::jsNumber(Bun::Buffer::kStringMaxLength));

    JSC::JSObject* constants = JSC::constructEmptyObject(lexicalGlobalObject, globalObject->objectPrototype(), 2);
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "MAX_LENGTH"_s), JSC::jsNumber(Bun::Buffer::MAX_LENGTH));
    constants->putDirect(vm, JSC::Identifier::fromString(vm, "MAX_STRING_LENGTH"_s), JSC::jsNumber(Bun::Buffer::MAX_STRING_LENGTH));

    put(JSC::Identifier::fromString(vm, "constants"_s), constants);

    JSC::Identifier atobI = JSC::Identifier::fromString(vm, "atob"_s);
    JSC::JSValue atobV = lexicalGlobalObject->get(globalObject, PropertyName(atobI));
    RETURN_IF_EXCEPTION(scope, );

    JSC::Identifier btoaI = JSC::Identifier::fromString(vm, "btoa"_s);
    JSC::JSValue btoaV = lexicalGlobalObject->get(globalObject, PropertyName(btoaI));
    RETURN_IF_EXCEPTION(scope, );

    put(atobI, atobV);
    put(btoaI, btoaV);

    auto* transcode = JSC::JSFunction::create(vm, globalObject, 3, "transcode"_s, jsBufferTranscode, ImplementationVisibility::Public, NoIntrinsic, jsBufferTranscode);

    put(JSC::Identifier::fromString(vm, "transcode"_s), transcode);

    auto* resolveObjectURL = JSC::JSFunction::create(vm, globalObject, 1, "resolveObjectURL"_s, jsFunctionResolveObjectURL, ImplementationVisibility::Public, NoIntrinsic, jsFunctionResolveObjectURL);

    put(JSC::Identifier::fromString(vm, "resolveObjectURL"_s), resolveObjectURL);

    put(JSC::Identifier::fromString(vm, "isAscii"_s), JSC::JSFunction::create(vm, globalObject, 1, "isAscii"_s, jsBufferConstructorFunction_isAscii, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isAscii));

    put(JSC::Identifier::fromString(vm, "isUtf8"_s), JSC::JSFunction::create(vm, globalObject, 1, "isUtf8"_s, jsBufferConstructorFunction_isUtf8, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
