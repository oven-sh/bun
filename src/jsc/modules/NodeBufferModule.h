#pragma once

#include "root.h"

#include "../bindings/JSBuffer.h"
#include "ErrorCode.h"
#include "JavaScriptCore/PageCount.h"
#include "NodeValidator.h"
#include "_NativeModule.h"
#include "wtf/SIMDUTF.h"
#include "../bindings/JSBufferEncodingType.h"
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
    auto* bufferView = dynamicDowncast<JSC::JSArrayBufferView>(buffer);
    const char* ptr = nullptr;
    size_t byteLength = 0;
    if (bufferView) {
        if (bufferView->isDetached()) [[unlikely]] {
            throwTypeError(lexicalGlobalObject, throwScope,
                "ArrayBufferView is detached"_s);
            return {};
        }

        byteLength = bufferView->byteLength();

        if (byteLength == 0) {
            return JSValue::encode(jsBoolean(true));
        }

        ptr = reinterpret_cast<const char*>(bufferView->vector());
    } else if (auto* arrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(buffer)) {
        auto* impl = arrayBuffer->impl();

        if (!impl) {
            return JSValue::encode(jsBoolean(true));
        }

        if (impl->isDetached()) [[unlikely]] {
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
    auto* bufferView = dynamicDowncast<JSC::JSArrayBufferView>(buffer);
    const char* ptr = nullptr;
    size_t byteLength = 0;
    if (bufferView) {

        if (bufferView->isDetached()) [[unlikely]] {
            return Bun::ERR::INVALID_STATE(throwScope, lexicalGlobalObject,
                "Cannot validate on a detached buffer"_s);
        }

        byteLength = bufferView->byteLength();

        if (byteLength == 0) {
            return JSValue::encode(jsBoolean(true));
        }

        ptr = reinterpret_cast<const char*>(bufferView->vector());
    } else if (auto* arrayBuffer = dynamicDowncast<JSC::JSArrayBuffer>(buffer)) {
        auto* impl = arrayBuffer->impl();
        if (impl->isDetached()) [[unlikely]] {
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

// node:buffer transcode(): re-encode a Buffer or Uint8Array from one
// character encoding to another, mirroring Node's buffer.transcode(). The
// supported encodings are ascii, latin1, utf8 and utf16le (ucs2); conversion
// routes through UTF-16, and code points the target encoding cannot
// represent are replaced with '?'.

static bool transcodeParseEncoding(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue value, BufferEncodingType& outEncoding)
{
    auto* string = value.toStringOrNull(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    const auto& view = string->view(globalObject);
    auto parsed = parseEnumerationFromView<BufferEncodingType>(view);
    if (!parsed)
        return false;
    switch (parsed.value()) {
    case BufferEncodingType::ascii:
    case BufferEncodingType::latin1:
    case BufferEncodingType::utf8:
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le:
        outEncoding = parsed.value();
        return true;
    default:
        return false;
    }
}

static WTF::Vector<char16_t> transcodeDecodeToUTF16(std::span<const uint8_t> source, BufferEncodingType encoding)
{
    WTF::Vector<char16_t> utf16;
    switch (encoding) {
    case BufferEncodingType::utf8: {
        size_t capacity = simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(source.data()), source.size());
        utf16.grow(capacity);
        size_t written = capacity > 0
            ? simdutf::convert_utf8_to_utf16le(reinterpret_cast<const char*>(source.data()), source.size(), utf16.mutableSpan().data())
            : 0;
        utf16.shrink(written);
        break;
    }
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le: {
        size_t units = source.size() / 2;
        utf16.grow(units);
        if (units > 0)
            memcpy(utf16.mutableSpan().data(), source.data(), units * 2);
        break;
    }
    case BufferEncodingType::latin1:
    case BufferEncodingType::ascii: {
        utf16.grow(source.size());
        for (size_t i = 0; i < source.size(); i++)
            utf16[i] = source[i];
        break;
    }
    default:
        break;
    }
    return utf16;
}

static WTF::Vector<uint8_t> transcodeEncodeFromUTF16(std::span<const char16_t> utf16, BufferEncodingType encoding)
{
    WTF::Vector<uint8_t> output;
    switch (encoding) {
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le: {
        output.grow(utf16.size() * 2);
        if (!utf16.empty())
            memcpy(output.mutableSpan().data(), utf16.data(), utf16.size() * 2);
        break;
    }
    case BufferEncodingType::utf8: {
        size_t capacity = simdutf::utf8_length_from_utf16le(utf16.data(), utf16.size());
        output.grow(capacity);
        size_t written = capacity > 0
            ? simdutf::convert_utf16le_to_utf8(utf16.data(), utf16.size(), reinterpret_cast<char*>(output.mutableSpan().data()))
            : 0;
        output.shrink(written);
        break;
    }
    case BufferEncodingType::latin1:
    case BufferEncodingType::ascii: {
        const char16_t maxCodePoint = encoding == BufferEncodingType::ascii ? 0x7F : 0xFF;
        output.reserveCapacity(utf16.size());
        for (size_t i = 0; i < utf16.size(); i++) {
            char16_t unit = utf16[i];
            if ((unit & 0xFC00) == 0xD800 && i + 1 < utf16.size() && (utf16[i + 1] & 0xFC00) == 0xDC00) {
                // A surrogate pair encodes a supplementary code point, which
                // never fits in latin1 or ascii.
                output.append('?');
                i++;
                continue;
            }
            bool isSurrogate = (unit & 0xF800) == 0xD800;
            output.append(!isSurrogate && unit <= maxCodePoint ? static_cast<uint8_t>(unit) : '?');
        }
        break;
    }
    default:
        break;
    }
    return output;
}

static JSC::JSUint8Array* transcodeBuffer(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, std::span<const uint8_t> source, BufferEncodingType fromEncoding, BufferEncodingType toEncoding)
{
    if (source.empty())
        return createUninitializedBuffer(globalObject, 0);

    auto utf16 = transcodeDecodeToUTF16(source, fromEncoding);
    auto bytes = transcodeEncodeFromUTF16(utf16.span(), toEncoding);

    auto* result = createUninitializedBuffer(globalObject, bytes.size());
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!bytes.isEmpty())
        memcpy(result->typedVector(), bytes.span().data(), bytes.size());
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsBufferModuleFunction_transcode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue sourceValue = callFrame->argument(0);
    JSC::JSValue fromValue = callFrame->argument(1);
    JSC::JSValue toValue = callFrame->argument(2);

    auto* sourceView = dynamicDowncast<JSC::JSUint8Array>(sourceValue);
    if (!sourceView) [[unlikely]]
        return Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, "source"_s, "Buffer or Uint8Array"_s, sourceValue);

    BufferEncodingType fromEncoding = BufferEncodingType::utf8;
    BufferEncodingType toEncoding = BufferEncodingType::utf8;
    bool fromValid = transcodeParseEncoding(globalObject, scope, fromValue, fromEncoding);
    RETURN_IF_EXCEPTION(scope, {});
    bool toValid = transcodeParseEncoding(globalObject, scope, toValue, toEncoding);
    RETURN_IF_EXCEPTION(scope, {});
    if (!fromValid || !toValid) [[unlikely]] {
        throwException(globalObject, scope, createError(globalObject, "Unable to transcode Buffer [U_ILLEGAL_ARGUMENT_ERROR]"_s));
        return {};
    }

    std::span<const uint8_t> source;
    if (!sourceView->isDetached() && sourceView->byteLength() > 0)
        source = std::span<const uint8_t>(sourceView->typedVector(), sourceView->byteLength());

    auto* result = transcodeBuffer(globalObject, scope, source, fromEncoding, toEncoding);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

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
    INIT_NATIVE_MODULE(12);
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

    auto* transcode = JSC::JSFunction::create(vm, globalObject, 3, "transcode"_s, jsBufferModuleFunction_transcode, ImplementationVisibility::Public, NoIntrinsic, jsBufferModuleFunction_transcode);

    put(JSC::Identifier::fromString(vm, "transcode"_s), transcode);

    auto* resolveObjectURL = JSC::JSFunction::create(vm, globalObject, 1, "resolveObjectURL"_s, jsFunctionResolveObjectURL, ImplementationVisibility::Public, NoIntrinsic, jsFunctionResolveObjectURL);

    put(JSC::Identifier::fromString(vm, "resolveObjectURL"_s), resolveObjectURL);

    put(JSC::Identifier::fromString(vm, "isAscii"_s), JSC::JSFunction::create(vm, globalObject, 1, "isAscii"_s, jsBufferConstructorFunction_isAscii, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isAscii));

    put(JSC::Identifier::fromString(vm, "isUtf8"_s), JSC::JSFunction::create(vm, globalObject, 1, "isUtf8"_s, jsBufferConstructorFunction_isUtf8, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
