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

// TODO: Add DOMJIT fast path
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isUtf8,
    (JSC::JSGlobalObject * lexicalGlobalObject,
        JSC::CallFrame* callframe))
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());

    auto buffer = callframe->argument(0);
    auto* bufferView = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    const char* ptr = nullptr;
    size_t byteLength = 0;
    if (bufferView) {
        if (UNLIKELY(bufferView->isDetached())) {
            throwTypeError(lexicalGlobalObject, throwScope,
                "ArrayBufferView is detached"_s);
            return {};
        }

        byteLength = bufferView->byteLength();

        if (byteLength == 0) {
            return JSValue::encode(jsBoolean(true));
        }

        ptr = reinterpret_cast<const char*>(bufferView->vector());
    } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(buffer)) {
        auto* impl = arrayBuffer->impl();

        if (!impl) {
            return JSValue::encode(jsBoolean(true));
        }

        if (UNLIKELY(impl->isDetached())) {
            return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject,
                "Cannot validate on a detached buffer"_s);
        }

        byteLength = impl->byteLength();

        if (byteLength == 0) {
            return JSValue::encode(jsBoolean(true));
        }

        ptr = reinterpret_cast<const char*>(impl->data());
    } else {
        Bun::throwError(lexicalGlobalObject, throwScope,
            Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "First argument must be an ArrayBufferView"_s);
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(simdutf::validate_utf8(ptr, byteLength))));
}

// TODO: Add DOMJIT fast path
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isAscii,
    (JSC::JSGlobalObject * lexicalGlobalObject,
        JSC::CallFrame* callframe))
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());

    auto buffer = callframe->argument(0);
    auto* bufferView = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
    const char* ptr = nullptr;
    size_t byteLength = 0;
    if (bufferView) {

        if (UNLIKELY(bufferView->isDetached())) {
            return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject,
                "Cannot validate on a detached buffer"_s);
        }

        byteLength = bufferView->byteLength();

        if (byteLength == 0) {
            return JSValue::encode(jsBoolean(true));
        }

        ptr = reinterpret_cast<const char*>(bufferView->vector());
    } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(buffer)) {
        auto* impl = arrayBuffer->impl();
        if (UNLIKELY(impl->isDetached())) {
            return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject,
                "Cannot validate on a detached buffer"_s);
        }

        if (!impl) {
            return JSValue::encode(jsBoolean(true));
        }

        byteLength = impl->byteLength();

        if (byteLength == 0) {
            return JSValue::encode(jsBoolean(true));
        }

        ptr = reinterpret_cast<const char*>(impl->data());
    } else {
        Bun::throwError(lexicalGlobalObject, throwScope,
            Bun::ErrorCode::ERR_INVALID_ARG_TYPE,
            "First argument must be an ArrayBufferView"_s);
        return {};
    }

    RELEASE_AND_RETURN(
        throwScope,
        JSValue::encode(jsBoolean(simdutf::validate_ascii(ptr, byteLength))));
}

BUN_DECLARE_HOST_FUNCTION(jsFunctionResolveObjectURL);

JSC_DEFINE_HOST_FUNCTION(jsFunctionNotImplemented,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    throwException(globalObject, scope,
        createError(globalObject, "Not implemented"_s));
    return {};
}

JSC_DEFINE_CUSTOM_GETTER(jsGetter_INSPECT_MAX_BYTES, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    auto globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(jsNumber(globalObject->INSPECT_MAX_BYTES));
}

JSC_DEFINE_CUSTOM_SETTER(jsSetter_INSPECT_MAX_BYTES, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    auto globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
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
    INIT_NATIVE_MODULE(12);

    put(JSC::Identifier::fromString(vm, "Buffer"_s),
        globalObject->JSBufferConstructor());

    auto* slowBuffer = JSC::JSFunction::create(
        vm, globalObject, 0, "SlowBuffer"_s, WebCore::constructSlowBuffer,
        ImplementationVisibility::Public, NoIntrinsic,
        WebCore::constructSlowBuffer);
    slowBuffer->putDirect(
        vm, vm.propertyNames->prototype, globalObject->JSBufferPrototype(),
        JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    put(JSC::Identifier::fromString(vm, "SlowBuffer"_s), slowBuffer);
    auto blobIdent = JSC::Identifier::fromString(vm, "Blob"_s);

    JSValue blobValue = globalObject->JSBlobConstructor();
    put(blobIdent, blobValue);

    put(JSC::Identifier::fromString(vm, "File"_s),
        globalObject->JSDOMFileConstructor());

    {
        auto name = Identifier::fromString(vm, "INSPECT_MAX_BYTES"_s);
        auto value = JSC::CustomGetterSetter::create(vm, jsGetter_INSPECT_MAX_BYTES, jsSetter_INSPECT_MAX_BYTES);
        auto attributes = PropertyAttribute::DontDelete | PropertyAttribute::CustomAccessor;
        defaultObject->putDirectCustomAccessor(vm, name, value, (unsigned)attributes);
        exportNames.append(name);
        exportValues.append(value);
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

    JSC::Identifier btoaI = JSC::Identifier::fromString(vm, "btoa"_s);
    JSC::JSValue btoaV = lexicalGlobalObject->get(globalObject, PropertyName(btoaI));

    put(atobI, atobV);
    put(btoaI, btoaV);

    auto* transcode = InternalFunction::createFunctionThatMasqueradesAsUndefined(
        vm, globalObject, 1, "transcode"_s, jsFunctionNotImplemented);

    put(JSC::Identifier::fromString(vm, "transcode"_s), transcode);

    auto* resolveObjectURL = JSC::JSFunction::create(
        vm, globalObject, 1, "resolveObjectURL"_s,
        jsFunctionResolveObjectURL,
        ImplementationVisibility::Public, NoIntrinsic,
        jsFunctionResolveObjectURL);

    put(JSC::Identifier::fromString(vm, "resolveObjectURL"_s), resolveObjectURL);

    put(JSC::Identifier::fromString(vm, "isAscii"_s),
        JSC::JSFunction::create(vm, globalObject, 1, "isAscii"_s,
            jsBufferConstructorFunction_isAscii,
            ImplementationVisibility::Public, NoIntrinsic,
            jsBufferConstructorFunction_isUtf8));

    put(JSC::Identifier::fromString(vm, "isUtf8"_s),
        JSC::JSFunction::create(vm, globalObject, 1, "isUtf8"_s,
            jsBufferConstructorFunction_isUtf8,
            ImplementationVisibility::Public, NoIntrinsic,
            jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
