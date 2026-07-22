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

namespace {

enum class TranscodeEncoding : uint8_t {
    Ascii,
    Latin1,
    Ucs2,
    Utf8,
    Unsupported,
};

// Mirrors Node's normalizeEncoding() + SupportedEncoding(): every encoding
// that doesn't resolve to ascii/latin1/ucs2/utf8 (including base64/hex and
// unknown labels) transcodes as U_ILLEGAL_ARGUMENT_ERROR.
static TranscodeEncoding parseTranscodeEncoding(const WTF::String& encoding)
{
    auto lowered = encoding.convertToASCIILowercase();
    if (lowered == "utf8"_s || lowered == "utf-8"_s)
        return TranscodeEncoding::Utf8;
    if (lowered == "ucs2"_s || lowered == "ucs-2"_s || lowered == "utf16le"_s || lowered == "utf-16le"_s)
        return TranscodeEncoding::Ucs2;
    if (lowered == "latin1"_s || lowered == "binary"_s)
        return TranscodeEncoding::Latin1;
    if (lowered == "ascii"_s)
        return TranscodeEncoding::Ascii;
    return TranscodeEncoding::Unsupported;
}

// WHATWG-style UTF-8 replacement decode (each maximal ill-formed subsequence
// becomes one U+FFFD), via WTF's implementation.
static void transcodeDecodeUtf8(std::span<const uint8_t> input, WTF::Vector<char16_t>& out)
{
    auto decoded = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const char8_t*>(input.data()), input.size() });
    out.reserveInitialCapacity(decoded.length());
    if (decoded.is8Bit()) {
        for (auto character : decoded.span8())
            out.append(character);
    } else {
        out.append(decoded.span16());
    }
}

// UTF-16LE units from raw bytes; lone surrogates (and, when requested, a
// trailing odd byte) are replaced with U+FFFD like ICU's pivot decode.
static void transcodeDecodeUcs2(std::span<const uint8_t> input, WTF::Vector<char16_t>& out, bool replaceTrailingOddByte)
{
    const size_t lengthInChars = input.size() / 2;
    size_t i = 0;
    while (i < lengthInChars) {
        const char16_t unit = static_cast<char16_t>(input[i * 2] | (input[i * 2 + 1] << 8));
        if (unit >= 0xD800 && unit <= 0xDBFF) {
            const char16_t nextUnit = i + 1 < lengthInChars
                ? static_cast<char16_t>(input[(i + 1) * 2] | (input[(i + 1) * 2 + 1] << 8))
                : 0;
            if (nextUnit >= 0xDC00 && nextUnit <= 0xDFFF) {
                out.append(unit);
                out.append(nextUnit);
                i += 2;
                continue;
            }
            out.append(0xFFFD);
            i++;
        } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
            out.append(0xFFFD);
            i++;
        } else {
            out.append(unit);
            i++;
        }
    }
    if (replaceTrailingOddByte && (input.size() & 1))
        out.append(0xFFFD);
}

// Encode UTF-16 units into a single-byte encoding: code points above
// maxCodePoint become '?', matching ICU's substitution behavior.
static void transcodeEncodeNarrow(const WTF::Vector<char16_t>& units, char16_t maxCodePoint, WTF::Vector<uint8_t>& out)
{
    for (size_t i = 0; i < units.size(); i++) {
        const char16_t unit = units[i];
        if (unit >= 0xD800 && unit <= 0xDBFF && i + 1 < units.size() && units[i + 1] >= 0xDC00 && units[i + 1] <= 0xDFFF) {
            // A full pair is one (unencodable) code point.
            out.append('?');
            i++;
            continue;
        }
        if (unit >= 0xD800 && unit <= 0xDFFF) {
            out.append('?');
            continue;
        }
        out.append(unit <= maxCodePoint ? static_cast<uint8_t>(unit) : '?');
    }
}

} // namespace

// Port of Node's buffer.transcode — the lib/buffer.js wrapper plus the icu
// binding (https://github.com/nodejs/node/blob/v25.2.1/src/node_i18n.cc#L187);
// ICU-converter paths reimplemented (macOS system ICU hides the ucnv API).
JSC_DEFINE_HOST_FUNCTION(jsBufferTranscode,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue sourceValue = callFrame->argument(0);
    auto* view = dynamicDowncast<JSC::JSUint8Array>(sourceValue);
    if (!view)
        return Bun::ERR::INVALID_ARG_INSTANCE(scope, globalObject, "source"_s, "Buffer or Uint8Array"_s, sourceValue);
    if (view->isDetached() || view->byteLength() == 0)
        RELEASE_AND_RETURN(scope, JSValue::encode(WebCore::createEmptyBuffer(globalObject)));

    // Coerce the encodings (which can run user toString) BEFORE snapshotting
    // the view's pointer/length — the coercion may detach or resize it.
    // Node's normalizeEncoding maps undefined/null/"" to utf8.
    auto parseEncodingArgument = [&](JSValue value) -> TranscodeEncoding {
        if (value.isUndefinedOrNull())
            return TranscodeEncoding::Utf8;
        auto string = value.toWTFString(globalObject);
        if (string.isEmpty())
            return TranscodeEncoding::Utf8;
        return parseTranscodeEncoding(string);
    };
    const auto fromEncoding = parseEncodingArgument(callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    const auto toEncoding = parseEncodingArgument(callFrame->argument(2));
    RETURN_IF_EXCEPTION(scope, {});

    if (view->isDetached()) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(WebCore::createEmptyBuffer(globalObject)));

    const size_t length = view->byteLength();
    if (length == 0)
        RELEASE_AND_RETURN(scope, JSValue::encode(WebCore::createEmptyBuffer(globalObject)));

    const std::span<const uint8_t> input { view->typedVector(), length };
    const auto* data = reinterpret_cast<const char*>(input.data());

    // Only these two ICU statuses are producible here.
    constexpr int32_t U_ILLEGAL_ARGUMENT_ERRNO = 1;
    constexpr int32_t U_INVALID_CHAR_FOUND_ERRNO = 10;

    int32_t errorCode = 0;
    ASCIILiteral errorName;
    WTF::Vector<uint8_t> result;

    if (fromEncoding == TranscodeEncoding::Unsupported || toEncoding == TranscodeEncoding::Unsupported) {
        errorCode = U_ILLEGAL_ARGUMENT_ERRNO;
        errorName = "U_ILLEGAL_ARGUMENT_ERROR"_s;
    } else if ((fromEncoding == TranscodeEncoding::Ascii || fromEncoding == TranscodeEncoding::Latin1)
        && toEncoding == TranscodeEncoding::Ucs2) {
        // Node's TranscodeLatin1ToUcs2: widen each byte to a UTF-16LE unit
        // (an ASCII source is treated as latin1 here, matching Node).
        result.grow(length * 2);
        // Latin1 -> UTF-16 cannot fail; every byte is a valid code unit.
        (void)simdutf::convert_latin1_to_utf16le(data, length, reinterpret_cast<char16_t*>(result.begin()));
    } else if (fromEncoding == TranscodeEncoding::Utf8 && toEncoding == TranscodeEncoding::Ucs2) {
        // Node's TranscodeUcs2FromUtf8: invalid UTF-8 fails.
        const size_t expected = simdutf::utf16_length_from_utf8(data, length);
        result.grow(expected * 2);
        const size_t actual = simdutf::convert_utf8_to_utf16le(data, length, reinterpret_cast<char16_t*>(result.begin()));
        if (actual == 0) {
            errorCode = U_INVALID_CHAR_FOUND_ERRNO;
            errorName = "U_INVALID_CHAR_FOUND"_s;
        } else {
            result.shrink(actual * 2);
        }
    } else if (fromEncoding == TranscodeEncoding::Ucs2 && toEncoding == TranscodeEncoding::Utf8) {
        // Node's TranscodeUtf8FromUcs2: lone surrogates fail; a trailing odd
        // byte is dropped.
        const size_t lengthInChars = length / 2;
        WTF::Vector<char16_t> sourceBuffer(lengthInChars);
        memcpy(sourceBuffer.begin(), data, lengthInChars * 2);
        const size_t expected = simdutf::utf8_length_from_utf16le(sourceBuffer.begin(), lengthInChars);
        result.grow(expected);
        const size_t actual = simdutf::convert_utf16le_to_utf8(sourceBuffer.begin(), lengthInChars, reinterpret_cast<char*>(result.begin()));
        if (actual == 0) {
            errorCode = U_INVALID_CHAR_FOUND_ERRNO;
            errorName = "U_INVALID_CHAR_FOUND"_s;
        } else {
            result.shrink(actual);
        }
    } else {
        // Decode to UTF-16, then encode to the target. The trailing odd byte
        // of a ucs2 source is dropped for narrow targets (Node floors the
        // char count) but replaced with U+FFFD for a ucs2 target (ICU pivot).
        WTF::Vector<char16_t> units;
        switch (fromEncoding) {
        case TranscodeEncoding::Latin1:
            units.reserveInitialCapacity(length);
            for (size_t i = 0; i < length; i++)
                units.append(input[i]);
            break;
        case TranscodeEncoding::Ascii:
            units.reserveInitialCapacity(length);
            for (size_t i = 0; i < length; i++)
                units.append(input[i] <= 0x7F ? static_cast<char16_t>(input[i]) : static_cast<char16_t>(0xFFFD));
            break;
        case TranscodeEncoding::Utf8:
            transcodeDecodeUtf8(input, units);
            break;
        case TranscodeEncoding::Ucs2:
            transcodeDecodeUcs2(input, units, toEncoding == TranscodeEncoding::Ucs2);
            break;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }

        switch (toEncoding) {
        case TranscodeEncoding::Latin1:
            transcodeEncodeNarrow(units, 0xFF, result);
            break;
        case TranscodeEncoding::Ascii:
            transcodeEncodeNarrow(units, 0x7F, result);
            break;
        case TranscodeEncoding::Ucs2:
            result.grow(units.size() * 2);
            memcpy(result.begin(), units.begin(), units.size() * 2);
            break;
        case TranscodeEncoding::Utf8: {
            // `units` never contains lone surrogates here (non-ucs2 sources
            // only), so this conversion cannot fail.
            const size_t expected = simdutf::utf8_length_from_utf16le(units.begin(), units.size());
            result.grow(expected);
            const size_t actual = simdutf::convert_utf16le_to_utf8(units.begin(), units.size(), reinterpret_cast<char*>(result.begin()));
            result.shrink(actual);
            break;
        }
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }

    if (errorCode != 0) {
        auto* error = JSC::createError(globalObject, makeString("Unable to transcode Buffer ["_s, errorName, "]"_s));
        error->putDirect(vm, JSC::Identifier::fromString(vm, "code"_s), JSC::jsString(vm, String(errorName)), 0);
        error->putDirect(vm, JSC::Identifier::fromString(vm, "errno"_s), JSC::jsNumber(errorCode), 0);
        throwException(globalObject, scope, error);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(WebCore::createBuffer(globalObject, result)));
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

    auto* transcode = JSC::JSFunction::create(vm, globalObject, 3, "transcode"_s, jsBufferTranscode, ImplementationVisibility::Public, NoIntrinsic, jsBufferTranscode);

    put(JSC::Identifier::fromString(vm, "transcode"_s), transcode);

    auto* resolveObjectURL = JSC::JSFunction::create(vm, globalObject, 1, "resolveObjectURL"_s, jsFunctionResolveObjectURL, ImplementationVisibility::Public, NoIntrinsic, jsFunctionResolveObjectURL);

    put(JSC::Identifier::fromString(vm, "resolveObjectURL"_s), resolveObjectURL);

    put(JSC::Identifier::fromString(vm, "isAscii"_s), JSC::JSFunction::create(vm, globalObject, 1, "isAscii"_s, jsBufferConstructorFunction_isAscii, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isAscii));

    put(JSC::Identifier::fromString(vm, "isUtf8"_s), JSC::JSFunction::create(vm, globalObject, 1, "isUtf8"_s, jsBufferConstructorFunction_isUtf8, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
