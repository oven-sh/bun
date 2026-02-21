#pragma once

#include "root.h"

#include "../bindings/JSBuffer.h"
#include "../bindings/JSBufferEncodingType.h"
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
    } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(buffer)) {
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
    auto* bufferView = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(buffer);
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
    } else if (auto* arrayBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(buffer)) {
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

// Transcode encoding enum - only the 4 encodings supported by Node.js transcode()
enum class TranscodeEncoding : uint8_t {
    ASCII,
    LATIN1,
    UTF8,
    UCS2, // UTF-16LE
};

static std::optional<TranscodeEncoding> parseTranscodeEncoding(JSC::JSGlobalObject& globalObject, JSValue value)
{
    auto encoding = parseEnumeration<BufferEncodingType>(globalObject, value);
    if (!encoding.has_value())
        return std::nullopt;

    switch (encoding.value()) {
    case BufferEncodingType::ascii:
        return TranscodeEncoding::ASCII;
    case BufferEncodingType::latin1:
        return TranscodeEncoding::LATIN1;
    case BufferEncodingType::utf8:
        return TranscodeEncoding::UTF8;
    case BufferEncodingType::ucs2:
    case BufferEncodingType::utf16le:
        return TranscodeEncoding::UCS2;
    default:
        return std::nullopt;
    }
}

// Transcode UTF-8 to single-byte encoding: codepoints > threshold become '?'
static JSC::JSUint8Array* transcodeUtf8ToSingleByte(JSC::JSGlobalObject* globalObject, const char* source, size_t sourceLength, uint32_t threshold)
{
    size_t outputLength = simdutf::utf32_length_from_utf8(source, sourceLength);
    auto* result = WebCore::createUninitializedBuffer(globalObject, outputLength);
    if (!result)
        return nullptr;

    auto* out = result->typedVector();

    size_t srcIdx = 0;
    size_t dstIdx = 0;
    while (srcIdx < sourceLength && dstIdx < outputLength) {
        uint8_t byte = static_cast<uint8_t>(source[srcIdx]);
        uint32_t codepoint;
        size_t seqLen;

        if (byte < 0x80) {
            codepoint = byte;
            seqLen = 1;
        } else if ((byte & 0xE0) == 0xC0) {
            seqLen = 2;
            if (srcIdx + seqLen > sourceLength) break;
            codepoint = (byte & 0x1F) << 6;
            codepoint |= (static_cast<uint8_t>(source[srcIdx + 1]) & 0x3F);
        } else if ((byte & 0xF0) == 0xE0) {
            seqLen = 3;
            if (srcIdx + seqLen > sourceLength) break;
            codepoint = (byte & 0x0F) << 12;
            codepoint |= (static_cast<uint8_t>(source[srcIdx + 1]) & 0x3F) << 6;
            codepoint |= (static_cast<uint8_t>(source[srcIdx + 2]) & 0x3F);
        } else if ((byte & 0xF8) == 0xF0) {
            seqLen = 4;
            if (srcIdx + seqLen > sourceLength) break;
            codepoint = (byte & 0x07) << 18;
            codepoint |= (static_cast<uint8_t>(source[srcIdx + 1]) & 0x3F) << 12;
            codepoint |= (static_cast<uint8_t>(source[srcIdx + 2]) & 0x3F) << 6;
            codepoint |= (static_cast<uint8_t>(source[srcIdx + 3]) & 0x3F);
        } else {
            codepoint = 0xFFFD;
            seqLen = 1;
        }

        out[dstIdx++] = (codepoint <= threshold) ? static_cast<uint8_t>(codepoint) : '?';
        srcIdx += seqLen;
    }

    return result;
}

static JSC::JSUint8Array* transcodeUtf8ToAscii(JSC::JSGlobalObject* globalObject, const char* source, size_t sourceLength)
{
    return transcodeUtf8ToSingleByte(globalObject, source, sourceLength, 0x7F);
}

static JSC::JSUint8Array* transcodeUtf8ToLatin1(JSC::JSGlobalObject* globalObject, const char* source, size_t sourceLength)
{
    return transcodeUtf8ToSingleByte(globalObject, source, sourceLength, 0xFF);
}

// Transcode UCS-2 to ASCII: each char16_t > 0x7F becomes '?'
static JSC::JSUint8Array* transcodeUcs2ToAscii(JSC::JSGlobalObject* globalObject, const char16_t* source, size_t charLength)
{
    auto* result = WebCore::createUninitializedBuffer(globalObject, charLength);
    if (!result)
        return nullptr;

    auto* out = result->typedVector();
    for (size_t i = 0; i < charLength; i++) {
        out[i] = (source[i] <= 0x7F) ? static_cast<uint8_t>(source[i]) : '?';
    }
    return result;
}

// Transcode UCS-2 to Latin-1: each char16_t > 0xFF becomes '?'
static JSC::JSUint8Array* transcodeUcs2ToLatin1(JSC::JSGlobalObject* globalObject, const char16_t* source, size_t charLength)
{
    auto* result = WebCore::createUninitializedBuffer(globalObject, charLength);
    if (!result)
        return nullptr;

    auto* out = result->typedVector();
    for (size_t i = 0; i < charLength; i++) {
        out[i] = (source[i] <= 0xFF) ? static_cast<uint8_t>(source[i]) : '?';
    }
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_transcode,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue sourceValue = callFrame->argument(0);

    // Validate source is Buffer or Uint8Array
    auto* sourceView = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(sourceValue);
    if (!sourceView) {
        Bun::ERR::INVALID_ARG_TYPE_INSTANCE(scope, globalObject,
            "source"_s, "Buffer"_s, "Uint8Array"_s, sourceValue);
        return {};
    }

    if (sourceView->isDetached()) [[unlikely]] {
        Bun::ERR::INVALID_STATE(scope, globalObject,
            "Cannot transcode a detached buffer"_s);
        return {};
    }

    const char* sourceData = reinterpret_cast<const char*>(sourceView->vector());
    size_t sourceLength = sourceView->byteLength();

    // Empty input → empty Buffer
    if (sourceLength == 0) {
        return JSValue::encode(WebCore::createEmptyBuffer(globalObject));
    }

    // Parse encodings
    auto fromEncoding = parseTranscodeEncoding(*globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    auto toEncoding = parseTranscodeEncoding(*globalObject, callFrame->argument(2));
    RETURN_IF_EXCEPTION(scope, {});

    if (!fromEncoding.has_value() || !toEncoding.has_value()) {
        throwException(globalObject, scope,
            createError(globalObject, "Unable to transcode Buffer [U_ILLEGAL_ARGUMENT_ERROR]"_s));
        return {};
    }

    auto from = fromEncoding.value();
    auto to = toEncoding.value();

    JSC::JSUint8Array* resultBuffer = nullptr;

    // Same encoding → copy
    if (from == to) {
        resultBuffer = WebCore::createBuffer(globalObject, reinterpret_cast<const uint8_t*>(sourceData), sourceLength);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(resultBuffer);
    }

    switch (from) {
    case TranscodeEncoding::ASCII:
    case TranscodeEncoding::LATIN1: {
        switch (to) {
        case TranscodeEncoding::UCS2: {
            // Latin1/ASCII → UCS-2: use simdutf
            auto* result = WebCore::createUninitializedBuffer(globalObject, sourceLength * 2);
            if (!result) {
                RETURN_IF_EXCEPTION(scope, {});
                return {};
            }
            (void)simdutf::convert_latin1_to_utf16le(sourceData, sourceLength,
                reinterpret_cast<char16_t*>(result->typedVector()));
            resultBuffer = result;
            break;
        }
        case TranscodeEncoding::UTF8: {
            // Latin1 → UTF-8: use simdutf
            size_t utf8Length = simdutf::utf8_length_from_latin1(sourceData, sourceLength);
            auto* result = WebCore::createUninitializedBuffer(globalObject, utf8Length);
            if (!result) {
                RETURN_IF_EXCEPTION(scope, {});
                return {};
            }
            (void)simdutf::convert_latin1_to_utf8(sourceData, sourceLength,
                reinterpret_cast<char*>(result->typedVector()));
            resultBuffer = result;
            break;
        }
        case TranscodeEncoding::ASCII: {
            // Latin1 → ASCII: clamp bytes > 0x7F to '?'
            auto* result = WebCore::createUninitializedBuffer(globalObject, sourceLength);
            if (!result) {
                RETURN_IF_EXCEPTION(scope, {});
                return {};
            }
            auto* out = result->typedVector();
            for (size_t i = 0; i < sourceLength; i++) {
                uint8_t byte = static_cast<uint8_t>(sourceData[i]);
                out[i] = (byte <= 0x7F) ? byte : '?';
            }
            resultBuffer = result;
            break;
        }
        case TranscodeEncoding::LATIN1: {
            // ASCII → Latin1: just copy (ASCII is a subset of Latin1)
            resultBuffer = WebCore::createBuffer(globalObject, reinterpret_cast<const uint8_t*>(sourceData), sourceLength);
            break;
        }
        }
        break;
    }
    case TranscodeEncoding::UTF8: {
        switch (to) {
        case TranscodeEncoding::UCS2: {
            // UTF-8 → UCS-2: use simdutf
            size_t utf16Length = simdutf::utf16_length_from_utf8(sourceData, sourceLength);
            auto* result = WebCore::createUninitializedBuffer(globalObject, utf16Length * sizeof(char16_t));
            if (!result) {
                RETURN_IF_EXCEPTION(scope, {});
                return {};
            }
            size_t actual = simdutf::convert_utf8_to_utf16le(sourceData, sourceLength,
                reinterpret_cast<char16_t*>(result->typedVector()));
            if (actual == 0 && sourceLength > 0) {
                throwException(globalObject, scope,
                    createError(globalObject, "Unable to transcode Buffer [U_INVALID_CHAR_FOUND]"_s));
                return {};
            }
            resultBuffer = result;
            break;
        }
        case TranscodeEncoding::ASCII: {
            resultBuffer = transcodeUtf8ToAscii(globalObject, sourceData, sourceLength);
            break;
        }
        case TranscodeEncoding::LATIN1: {
            resultBuffer = transcodeUtf8ToLatin1(globalObject, sourceData, sourceLength);
            break;
        }
        default:
            break;
        }
        break;
    }
    case TranscodeEncoding::UCS2: {
        const char16_t* utf16Data = reinterpret_cast<const char16_t*>(sourceData);
        size_t charLength = sourceLength / sizeof(char16_t);

        switch (to) {
        case TranscodeEncoding::UTF8: {
            // UCS-2 → UTF-8: use simdutf
            size_t utf8Length = simdutf::utf8_length_from_utf16le(utf16Data, charLength);
            auto* result = WebCore::createUninitializedBuffer(globalObject, utf8Length);
            if (!result) {
                RETURN_IF_EXCEPTION(scope, {});
                return {};
            }
            size_t actual = simdutf::convert_utf16le_to_utf8(utf16Data, charLength,
                reinterpret_cast<char*>(result->typedVector()));
            if (actual == 0 && charLength > 0) {
                throwException(globalObject, scope,
                    createError(globalObject, "Unable to transcode Buffer [U_INVALID_CHAR_FOUND]"_s));
                return {};
            }
            resultBuffer = result;
            break;
        }
        case TranscodeEncoding::ASCII: {
            resultBuffer = transcodeUcs2ToAscii(globalObject, utf16Data, charLength);
            break;
        }
        case TranscodeEncoding::LATIN1: {
            resultBuffer = transcodeUcs2ToLatin1(globalObject, utf16Data, charLength);
            break;
        }
        default:
            break;
        }
        break;
    }
    }

    if (!resultBuffer) {
        RETURN_IF_EXCEPTION(scope, {});
        throwException(globalObject, scope,
            createError(globalObject, "Unable to transcode Buffer [U_ILLEGAL_ARGUMENT_ERROR]"_s));
        return {};
    }

    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(resultBuffer);
}

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

    put(JSC::Identifier::fromString(vm, "transcode"_s), JSC::JSFunction::create(vm, globalObject, 3, "transcode"_s, jsFunction_transcode, ImplementationVisibility::Public, NoIntrinsic, jsFunction_transcode));

    auto* resolveObjectURL = JSC::JSFunction::create(vm, globalObject, 1, "resolveObjectURL"_s, jsFunctionResolveObjectURL, ImplementationVisibility::Public, NoIntrinsic, jsFunctionResolveObjectURL);

    put(JSC::Identifier::fromString(vm, "resolveObjectURL"_s), resolveObjectURL);

    put(JSC::Identifier::fromString(vm, "isAscii"_s), JSC::JSFunction::create(vm, globalObject, 1, "isAscii"_s, jsBufferConstructorFunction_isAscii, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isAscii));

    put(JSC::Identifier::fromString(vm, "isUtf8"_s), JSC::JSFunction::create(vm, globalObject, 1, "isUtf8"_s, jsBufferConstructorFunction_isUtf8, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
