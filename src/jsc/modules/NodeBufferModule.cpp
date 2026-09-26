#include "root.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "helpers.h"
#include "JSBuffer.h"
#include "JSBufferEncodingType.h"
#include "JSDOMExceptionHandling.h"
#include "wtf/SIMDUTF.h"
#include <JavaScriptCore/JSTypedArrays.h>

namespace WebCore {
JSC::JSUint8Array* createUninitializedBuffer(JSC::JSGlobalObject*, size_t);
JSC::JSUint8Array* createEmptyBuffer(JSC::JSGlobalObject*);
}

using namespace JSC;

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

// Decode the source bytes into well-formed UTF-16 for the pivot paths.
// Returns false when the decoded string cannot be allocated.
static bool transcodeDecodeToUtf16(std::span<const uint8_t> input, TranscodeEncoding fromEncoding, bool replaceTrailingOddByte, WTF::Vector<char16_t>& units)
{
    const auto* data = reinterpret_cast<const char*>(input.data());
    switch (fromEncoding) {
    case TranscodeEncoding::Latin1:
        if (!units.tryGrow(input.size())) [[unlikely]]
            return false;
        (void)simdutf::convert_latin1_to_utf16le(data, input.size(), units.begin());
        break;
    case TranscodeEncoding::Ascii: {
        if (!units.tryGrow(input.size())) [[unlikely]]
            return false;
        (void)simdutf::convert_latin1_to_utf16le(data, input.size(), units.begin());
        // ICU's ascii converter substitutes non-ASCII bytes with U+FFFD;
        // simdutf has no substituting decode, so fix up only when needed.
        if (!simdutf::validate_ascii(data, input.size())) {
            for (auto& unit : units) {
                if (unit > 0x7F)
                    unit = 0xFFFD;
            }
        }
        break;
    }
    case TranscodeEncoding::Utf8: {
        // WHATWG-style replacement decode (each maximal ill-formed
        // subsequence becomes one U+FFFD), via WTF's implementation.
        auto decoded = Zig::convertUTF8ToString(std::span { reinterpret_cast<const unsigned char*>(input.data()), input.size() });
        if (decoded.isNull() && !input.empty()) [[unlikely]]
            return false;
        if (!units.tryGrow(decoded.length())) [[unlikely]]
            return false;
        if (decoded.is8Bit())
            (void)simdutf::convert_latin1_to_utf16le(reinterpret_cast<const char*>(decoded.span8().data()), decoded.length(), units.begin());
        else
            memcpy(units.begin(), decoded.span16().data(), decoded.length() * 2);
        break;
    }
    case TranscodeEncoding::Ucs2: {
        // Lone surrogates are replaced with U+FFFD like ICU's pivot decode;
        // the trailing odd byte of the source is dropped for narrow targets
        // (Node floors the char count) but replaced for a ucs2 target.
        const size_t lengthInChars = input.size() / 2;
        const bool replacesOddByte = replaceTrailingOddByte && (input.size() & 1);
        if (!units.tryGrow(lengthInChars + replacesOddByte)) [[unlikely]]
            return false;
        memcpy(units.begin(), input.data(), lengthInChars * 2);
        simdutf::to_well_formed_utf16le(units.begin(), lengthInChars, units.begin());
        if (replacesOddByte)
            units.last() = 0xFFFD;
        break;
    }
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
    return true;
}

// Encode well-formed UTF-16 into a single-byte encoding: code points above
// maxCodePoint become '?', matching ICU's substitution behavior.
// Returns nullptr with an exception pending when the result cannot be allocated.
static JSC::JSUint8Array* transcodeEncodeNarrow(JSGlobalObject* globalObject, const WTF::Vector<char16_t>& units, char16_t maxCodePoint)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::JSUint8Array* result = nullptr;

    // Fast path: a latin1 target with in-range contents converts in bulk.
    if (maxCodePoint == 0xFF) {
        result = WebCore::createUninitializedBuffer(globalObject, units.size());
        RETURN_IF_EXCEPTION(scope, nullptr);
        auto converted = simdutf::convert_utf16le_to_latin1_with_errors(units.begin(), units.size(), reinterpret_cast<char*>(result->typedVector()));
        if (converted.error == simdutf::error_code::SUCCESS)
            return result;
    }
    // Substitution path: simdutf conversions are strict, so out-of-range
    // code points ('?' in ICU) are handled per unit.
    constexpr auto writesByte = [](char16_t unit) { return !U16_IS_TRAIL(unit); };
    size_t length = 0;
    for (const char16_t unit : units)
        length += writesByte(unit);
    // A surrogate pair writes one '?', so a source with pairs needs a shorter result than the bulk attempt allocated.
    if (!result || length != units.size()) {
        result = WebCore::createUninitializedBuffer(globalObject, length);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    const std::span<uint8_t> out = result->typedSpan();
    size_t written = 0;
    for (const char16_t unit : units) {
        if (writesByte(unit))
            out[written++] = unit <= maxCodePoint ? static_cast<uint8_t>(unit) : '?';
    }
    ASSERT(written == out.size());
    return result;
}

} // namespace

BUN_DECLARE_HOST_FUNCTION(jsBufferTranscode);

// Port of Node's buffer.transcode; ICU-converter paths implemented over simdutf (macOS system
// ICU hides the ucnv API). https://github.com/nodejs/node/blob/main/src/node_i18n.cc
BUN_DEFINE_HOST_FUNCTION(jsBufferTranscode,
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

    WTF::Vector<uint8_t> storage;
    const std::span<const uint8_t> input = Bun::stableBytes(globalObject, scope, std::span<const uint8_t> { view->typedVector(), length }, view->isShared(), storage);
    RETURN_IF_EXCEPTION(scope, {});
    const auto* data = reinterpret_cast<const char*>(input.data());

    // Only these two ICU statuses are producible here.
    constexpr int32_t U_ILLEGAL_ARGUMENT_ERRNO = 1;
    constexpr int32_t U_INVALID_CHAR_FOUND_ERRNO = 10;

    int32_t errorCode = 0;
    ASCIILiteral errorName;
    // An allocation that fails throws RangeError: Out of memory. Node's ICU paths have an INT32_MAX limit and report U_ILLEGAL_ARGUMENT_ERROR: https://github.com/nodejs/node/blob/v26.3.0/src/node_i18n.cc#L158-L163
    JSC::JSUint8Array* result = nullptr;

    if (fromEncoding == TranscodeEncoding::Unsupported || toEncoding == TranscodeEncoding::Unsupported) {
        errorCode = U_ILLEGAL_ARGUMENT_ERRNO;
        errorName = "U_ILLEGAL_ARGUMENT_ERROR"_s;
    } else if ((fromEncoding == TranscodeEncoding::Ascii || fromEncoding == TranscodeEncoding::Latin1)
        && toEncoding == TranscodeEncoding::Ucs2) {
        // Node's TranscodeLatin1ToUcs2: widen each byte to a UTF-16LE unit
        // (an ASCII source is treated as latin1 here, matching Node).
        result = WebCore::createUninitializedBuffer(globalObject, length * 2);
        RETURN_IF_EXCEPTION(scope, {});
        // Latin1 -> UTF-16 cannot fail; every byte is a valid code unit.
        (void)simdutf::convert_latin1_to_utf16le(data, length, reinterpret_cast<char16_t*>(result->typedVector()));
    } else if (fromEncoding == TranscodeEncoding::Utf8 && toEncoding == TranscodeEncoding::Ucs2) {
        // Node's TranscodeUcs2FromUtf8: invalid UTF-8 fails.
        const size_t expected = simdutf::utf16_length_from_utf8(data, length);
        result = WebCore::createUninitializedBuffer(globalObject, expected * 2);
        RETURN_IF_EXCEPTION(scope, {});
        const size_t actual = simdutf::convert_utf8_to_utf16le(data, length, reinterpret_cast<char16_t*>(result->typedVector()));
        // A shared source can change between the two passes. This keeps unwritten bytes out of the result; it does not bound the writes.
        if (actual == 0 || actual != expected) {
            errorCode = U_INVALID_CHAR_FOUND_ERRNO;
            errorName = "U_INVALID_CHAR_FOUND"_s;
        }
    } else if (fromEncoding == TranscodeEncoding::Ucs2 && toEncoding == TranscodeEncoding::Utf8) {
        // Node's TranscodeUtf8FromUcs2: lone surrogates fail; a trailing odd
        // byte is dropped.
        const size_t lengthInChars = length / 2;
        WTF::Vector<char16_t> sourceBuffer;
        if (!sourceBuffer.tryGrow(lengthInChars)) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        memcpy(sourceBuffer.begin(), data, lengthInChars * 2);
        const size_t expected = simdutf::utf8_length_from_utf16le(sourceBuffer.begin(), lengthInChars);
        result = WebCore::createUninitializedBuffer(globalObject, expected);
        RETURN_IF_EXCEPTION(scope, {});
        const size_t actual = simdutf::convert_utf16le_to_utf8(sourceBuffer.begin(), lengthInChars, reinterpret_cast<char*>(result->typedVector()));
        // Node also fails a source of one byte, which has no units: https://github.com/nodejs/node/blob/v26.3.0/src/node_i18n.cc#L249-L252
        if (actual == 0 || actual != expected) {
            errorCode = U_INVALID_CHAR_FOUND_ERRNO;
            errorName = "U_INVALID_CHAR_FOUND"_s;
        }
    } else {
        // Decode to well-formed UTF-16, then encode to the target.
        WTF::Vector<char16_t> units;
        if (!transcodeDecodeToUtf16(input, fromEncoding, /* replaceTrailingOddByte */ toEncoding == TranscodeEncoding::Ucs2, units)) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        switch (toEncoding) {
        case TranscodeEncoding::Latin1:
            result = transcodeEncodeNarrow(globalObject, units, 0xFF);
            RETURN_IF_EXCEPTION(scope, {});
            break;
        case TranscodeEncoding::Ascii:
            result = transcodeEncodeNarrow(globalObject, units, 0x7F);
            RETURN_IF_EXCEPTION(scope, {});
            break;
        case TranscodeEncoding::Ucs2:
            result = WebCore::createUninitializedBuffer(globalObject, units.size() * 2);
            RETURN_IF_EXCEPTION(scope, {});
            memcpy(result->typedVector(), units.begin(), units.size() * 2);
            break;
        case TranscodeEncoding::Utf8: {
            // `units` is well-formed UTF-16, so this conversion cannot fail.
            const size_t expected = simdutf::utf8_length_from_utf16le(units.begin(), units.size());
            result = WebCore::createUninitializedBuffer(globalObject, expected);
            RETURN_IF_EXCEPTION(scope, {});
            const size_t actual = simdutf::convert_utf16le_to_utf8(units.begin(), units.size(), reinterpret_cast<char*>(result->typedVector()));
            RELEASE_ASSERT(actual == expected);
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

    return JSValue::encode(result);
}
