#pragma once

#include "root.h"

#include "../bindings/JSBuffer.h"
#include "ErrorCode.h"
#include "JavaScriptCore/PageCount.h"
#include "NodeValidator.h"
#include "_NativeModule.h"
#include "wtf/SIMDUTF.h"
#include "BufferEncodingType.h"
#include "JSBufferEncodingType.h"
#include <limits>
#include <unicode/utypes.h>

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

// The encodings buffer.transcode() can convert between, mirroring the subset
// ICU supports in Node's src/node_i18n.cc (ASCII, LATIN1, UCS2, UTF8).
enum class TranscodeEncoding : uint8_t {
    ASCII,
    Latin1,
    UCS2,
    UTF8,
    Unsupported,
};

static TranscodeEncoding toTranscodeEncoding(WebCore::BufferEncodingType encoding)
{
    switch (encoding) {
    case WebCore::BufferEncodingType::ascii:
        return TranscodeEncoding::ASCII;
    case WebCore::BufferEncodingType::latin1:
        return TranscodeEncoding::Latin1;
    case WebCore::BufferEncodingType::ucs2:
    case WebCore::BufferEncodingType::utf16le:
        return TranscodeEncoding::UCS2;
    case WebCore::BufferEncodingType::utf8:
        return TranscodeEncoding::UTF8;
    default:
        return TranscodeEncoding::Unsupported;
    }
}

// Node's buffer.transcode honors only string encoding arguments; any other
// value parses as the default BUFFER encoding, which then fails the supported
// check. Restricting to strings here also avoids running user toString() code
// that could detach the source view mid-call.
static TranscodeEncoding parseTranscodeEncoding(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto* string = dynamicDowncast<JSC::JSString>(value);
    if (!string) [[unlikely]]
        return TranscodeEncoding::Unsupported;

    const auto view = string->view(globalObject);
    auto parsed = WebCore::parseEnumerationFromView<WebCore::BufferEncodingType>(view);
    if (!parsed)
        return TranscodeEncoding::Unsupported;

    return toTranscodeEncoding(parsed.value());
}

// Mirrors the error Node throws from buffer.transcode: a generic Error whose
// message embeds the ICU status name, with matching `code` and `errno`.
static JSC::EncodedJSValue throwTranscodeError(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, UErrorCode status)
{
    auto& vm = JSC::getVM(globalObject);
    ASCIILiteral code = status == U_INVALID_CHAR_FOUND ? "U_INVALID_CHAR_FOUND"_s : "U_ILLEGAL_ARGUMENT_ERROR"_s;
    auto* error = createError(globalObject, makeString("Unable to transcode Buffer ["_s, code, "]"_s));
    error->putDirect(vm, JSC::Identifier::fromString(vm, "code"_s), JSC::jsString(vm, String(code)), 0);
    error->putDirect(vm, JSC::Identifier::fromString(vm, "errno"_s), JSC::jsNumber(static_cast<int32_t>(status)), 0);
    scope.throwException(globalObject, error);
    return {};
}

static void appendCodePoint(Vector<char16_t>& out, char32_t codePoint)
{
    if (codePoint <= 0xFFFF) {
        out.append(static_cast<char16_t>(codePoint));
        return;
    }
    codePoint -= 0x10000;
    out.append(static_cast<char16_t>(0xD800 + (codePoint >> 10)));
    out.append(static_cast<char16_t>(0xDC00 + (codePoint & 0x3FF)));
}

// UTF-8 -> UTF-16 decode that substitutes U+FFFD for ill-formed input using the
// Unicode "maximal subpart" rule (matching ICU's to-Unicode substitution, which
// is what Node's ICU generic path relies on). Only invoked on input simdutf has
// already rejected as invalid.
static Vector<char16_t> decodeUtf8Replacing(std::span<const uint8_t> input)
{
    Vector<char16_t> out;
    const size_t length = input.size();
    for (size_t i = 0; i < length;) {
        const uint8_t lead = input[i];
        if (lead < 0x80) {
            out.append(lead);
            i++;
            continue;
        }

        size_t continuations;
        char32_t codePoint;
        uint8_t lowerBound = 0x80;
        uint8_t upperBound = 0xBF;
        if (lead >= 0xC2 && lead <= 0xDF) {
            continuations = 1;
            codePoint = lead & 0x1F;
        } else if (lead == 0xE0) {
            continuations = 2;
            codePoint = lead & 0x0F;
            lowerBound = 0xA0;
        } else if (lead >= 0xE1 && lead <= 0xEC) {
            continuations = 2;
            codePoint = lead & 0x0F;
        } else if (lead == 0xED) {
            continuations = 2;
            codePoint = lead & 0x0F;
            upperBound = 0x9F;
        } else if (lead >= 0xEE && lead <= 0xEF) {
            continuations = 2;
            codePoint = lead & 0x0F;
        } else if (lead == 0xF0) {
            continuations = 3;
            codePoint = lead & 0x07;
            lowerBound = 0x90;
        } else if (lead >= 0xF1 && lead <= 0xF3) {
            continuations = 3;
            codePoint = lead & 0x07;
        } else if (lead == 0xF4) {
            continuations = 3;
            codePoint = lead & 0x07;
            upperBound = 0x8F;
        } else {
            out.append(0xFFFD);
            i++;
            continue;
        }

        size_t consumed = i + 1;
        bool valid = true;
        for (size_t k = 0; k < continuations; k++) {
            const uint8_t low = k == 0 ? lowerBound : 0x80;
            const uint8_t high = k == 0 ? upperBound : 0xBF;
            if (consumed >= length || input[consumed] < low || input[consumed] > high) {
                valid = false;
                break;
            }
            codePoint = (codePoint << 6) | (input[consumed] & 0x3F);
            consumed++;
        }

        if (!valid) {
            out.append(0xFFFD);
            i = consumed;
            continue;
        }

        appendCodePoint(out, codePoint);
        i = consumed;
    }
    return out;
}

// Decode source bytes into a UTF-16 pivot. ASCII bytes >= 0x80 become U+FFFD,
// matching ICU's us-ascii to-Unicode behavior used by Node's generic path (this
// helper feeds the generic path only; ASCII/LATIN1 -> UCS2 takes the dedicated
// simdutf path that treats ASCII as Latin-1, as Node does).
static Vector<char16_t> decodeToUtf16(TranscodeEncoding from, std::span<const uint8_t> source)
{
    Vector<char16_t> pivot;
    switch (from) {
    case TranscodeEncoding::ASCII:
        pivot.reserveInitialCapacity(source.size());
        for (uint8_t byte : source)
            pivot.append(byte < 0x80 ? static_cast<char16_t>(byte) : 0xFFFD);
        break;
    case TranscodeEncoding::Latin1: {
        pivot.grow(source.size());
        [[maybe_unused]] const size_t converted = simdutf::convert_latin1_to_utf16le(reinterpret_cast<const char*>(source.data()), source.size(), pivot.mutableSpan().data());
        break;
    }
    case TranscodeEncoding::UTF8: {
        const char* pointer = reinterpret_cast<const char*>(source.data());
        if (simdutf::validate_utf8(pointer, source.size())) {
            pivot.grow(simdutf::utf16_length_from_utf8(pointer, source.size()));
            [[maybe_unused]] const size_t converted = simdutf::convert_utf8_to_utf16le(pointer, source.size(), pivot.mutableSpan().data());
        } else {
            pivot = decodeUtf8Replacing(source);
        }
        break;
    }
    case TranscodeEncoding::UCS2: {
        const size_t lengthInChars = source.size() / sizeof(char16_t);
        pivot.grow(lengthInChars);
        memcpy(pivot.mutableSpan().data(), source.data(), lengthInChars * sizeof(char16_t));
        break;
    }
    default:
        break;
    }
    return pivot;
}

// Encode a UTF-16 pivot into the target encoding, substituting '?' for code
// points the target cannot represent (matching ICU's from-Unicode substitution).
static Vector<uint8_t> encodeFromUtf16(TranscodeEncoding to, std::span<const char16_t> pivot)
{
    Vector<uint8_t> out;
    switch (to) {
    case TranscodeEncoding::ASCII:
    case TranscodeEncoding::Latin1: {
        const char32_t maxCodePoint = to == TranscodeEncoding::ASCII ? 0x7F : 0xFF;
        out.reserveInitialCapacity(pivot.size());
        for (size_t i = 0; i < pivot.size();) {
            char32_t codePoint = pivot[i++];
            // Combine a surrogate pair so one supplementary code point maps to a
            // single substitution character rather than two.
            if (codePoint >= 0xD800 && codePoint <= 0xDBFF && i < pivot.size() && pivot[i] >= 0xDC00 && pivot[i] <= 0xDFFF)
                codePoint = 0x10000 + ((codePoint - 0xD800) << 10) + (pivot[i++] - 0xDC00);
            out.append(codePoint <= maxCodePoint ? static_cast<uint8_t>(codePoint) : '?');
        }
        break;
    }
    case TranscodeEncoding::UCS2:
        out.grow(pivot.size() * sizeof(char16_t));
        memcpy(out.mutableSpan().data(), pivot.data(), pivot.size() * sizeof(char16_t));
        break;
    case TranscodeEncoding::UTF8: {
        out.grow(simdutf::utf8_length_from_utf16le(pivot.data(), pivot.size()));
        const size_t length = simdutf::convert_utf16le_to_utf8(pivot.data(), pivot.size(), reinterpret_cast<char*>(out.mutableSpan().data()));
        out.shrink(length);
        break;
    }
    default:
        break;
    }
    return out;
}

// Node's generic Transcode() and TranscodeFromUcs2(): pivot through UTF-16 with
// '?' substitution. Always succeeds for the supported encodings.
static JSC::JSUint8Array* transcodeGeneric(JSC::JSGlobalObject* globalObject, TranscodeEncoding from, TranscodeEncoding to, std::span<const uint8_t> source)
{
    const Vector<char16_t> pivot = decodeToUtf16(from, source);
    const Vector<uint8_t> result = encodeFromUtf16(to, pivot.span());
    return WebCore::createBuffer(globalObject, result.span());
}

// Node's TranscodeLatin1ToUcs2(): ASCII/LATIN1 -> UCS2 via simdutf.
static JSC::JSUint8Array* transcodeLatin1ToUcs2(JSC::JSGlobalObject* globalObject, std::span<const uint8_t> source, UErrorCode* status)
{
    Vector<char16_t> result(source.size());
    const size_t length = simdutf::convert_latin1_to_utf16le(reinterpret_cast<const char*>(source.data()), source.size(), result.mutableSpan().data());
    if (!length) {
        *status = U_INVALID_CHAR_FOUND;
        return nullptr;
    }

    return WebCore::createBuffer(globalObject, reinterpret_cast<const uint8_t*>(result.span().data()), length * sizeof(char16_t));
}

// Node's TranscodeUcs2FromUtf8(): UTF8 -> UCS2 via simdutf.
static JSC::JSUint8Array* transcodeUcs2FromUtf8(JSC::JSGlobalObject* globalObject, std::span<const uint8_t> source, UErrorCode* status)
{
    const char* sourcePointer = reinterpret_cast<const char*>(source.data());
    Vector<char16_t> result(simdutf::utf16_length_from_utf8(sourcePointer, source.size()));
    const size_t length = simdutf::convert_utf8_to_utf16le(sourcePointer, source.size(), result.mutableSpan().data());
    if (!length) {
        *status = U_INVALID_CHAR_FOUND;
        return nullptr;
    }

    return WebCore::createBuffer(globalObject, reinterpret_cast<const uint8_t*>(result.span().data()), length * sizeof(char16_t));
}

// Node's TranscodeUtf8FromUcs2(): UCS2 -> UTF8 via simdutf.
static JSC::JSUint8Array* transcodeUtf8FromUcs2(JSC::JSGlobalObject* globalObject, std::span<const uint8_t> source, UErrorCode* status)
{
    const size_t lengthInChars = source.size() / sizeof(char16_t);
    Vector<char16_t> sourceChars(lengthInChars);
    memcpy(sourceChars.mutableSpan().data(), source.data(), lengthInChars * sizeof(char16_t));

    Vector<char> result(simdutf::utf8_length_from_utf16le(sourceChars.span().data(), lengthInChars));
    const size_t length = simdutf::convert_utf16le_to_utf8(sourceChars.span().data(), lengthInChars, result.mutableSpan().data());
    if (!length) {
        *status = U_INVALID_CHAR_FOUND;
        return nullptr;
    }

    return WebCore::createBuffer(globalObject, reinterpret_cast<const uint8_t*>(result.span().data()), length);
}

} // namespace

// buffer.transcode(source, fromEncoding, toEncoding). Ports the dispatch in
// Node's src/node_i18n.cc Transcode().
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_transcode,
    (JSGlobalObject * lexicalGlobalObject,
        CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue sourceValue = callFrame->argument(0);
    auto* source = dynamicDowncast<JSC::JSUint8Array>(sourceValue);
    if (!source) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE_INSTANCE(scope, lexicalGlobalObject, "source"_s, "Buffer or Uint8Array"_s, sourceValue);

    const size_t byteLength = source->byteLength();
    if (!byteLength)
        return JSValue::encode(WebCore::createEmptyBuffer(lexicalGlobalObject));

    const TranscodeEncoding fromEncoding = parseTranscodeEncoding(lexicalGlobalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    const TranscodeEncoding toEncoding = parseTranscodeEncoding(lexicalGlobalObject, callFrame->argument(2));
    RETURN_IF_EXCEPTION(scope, {});

    if (fromEncoding == TranscodeEncoding::Unsupported || toEncoding == TranscodeEncoding::Unsupported)
        return throwTranscodeError(scope, lexicalGlobalObject, U_ILLEGAL_ARGUMENT_ERROR);

    // Copy the source bytes so the conversion routines work on a stable,
    // aligned buffer (the UCS2 paths reinterpret these bytes as char16_t).
    Vector<uint8_t> sourceBytes(byteLength);
    memcpy(sourceBytes.mutableSpan().data(), source->typedVector(), byteLength);
    const std::span<const uint8_t> sourceSpan = sourceBytes.span();

    UErrorCode status = U_ZERO_ERROR;
    JSC::JSUint8Array* result = nullptr;
    switch (fromEncoding) {
    case TranscodeEncoding::ASCII:
    case TranscodeEncoding::Latin1:
        result = toEncoding == TranscodeEncoding::UCS2
            ? transcodeLatin1ToUcs2(lexicalGlobalObject, sourceSpan, &status)
            : transcodeGeneric(lexicalGlobalObject, fromEncoding, toEncoding, sourceSpan);
        break;
    case TranscodeEncoding::UTF8:
        result = toEncoding == TranscodeEncoding::UCS2
            ? transcodeUcs2FromUtf8(lexicalGlobalObject, sourceSpan, &status)
            : transcodeGeneric(lexicalGlobalObject, fromEncoding, toEncoding, sourceSpan);
        break;
    case TranscodeEncoding::UCS2:
        // UCS2 -> UTF8 takes the dedicated simdutf path; UCS2 -> UCS2/ASCII/LATIN1
        // pivot through the generic path.
        result = toEncoding == TranscodeEncoding::UTF8
            ? transcodeUtf8FromUcs2(lexicalGlobalObject, sourceSpan, &status)
            : transcodeGeneric(lexicalGlobalObject, fromEncoding, toEncoding, sourceSpan);
        break;
    default:
        break;
    }

    if (result)
        return JSValue::encode(result);

    return throwTranscodeError(scope, lexicalGlobalObject, status);
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

    put(JSC::Identifier::fromString(vm, "transcode"_s), JSC::JSFunction::create(vm, globalObject, 3, "transcode"_s, jsBufferConstructorFunction_transcode, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_transcode));

    auto* resolveObjectURL = JSC::JSFunction::create(vm, globalObject, 1, "resolveObjectURL"_s, jsFunctionResolveObjectURL, ImplementationVisibility::Public, NoIntrinsic, jsFunctionResolveObjectURL);

    put(JSC::Identifier::fromString(vm, "resolveObjectURL"_s), resolveObjectURL);

    put(JSC::Identifier::fromString(vm, "isAscii"_s), JSC::JSFunction::create(vm, globalObject, 1, "isAscii"_s, jsBufferConstructorFunction_isAscii, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isAscii));

    put(JSC::Identifier::fromString(vm, "isUtf8"_s), JSC::JSFunction::create(vm, globalObject, 1, "isUtf8"_s, jsBufferConstructorFunction_isUtf8, ImplementationVisibility::Public, NoIntrinsic, jsBufferConstructorFunction_isUtf8));
}

} // namespace Zig
