#include "root.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "helpers.h"
#include "JSBufferEncodingType.h"
#include "JSDOMExceptionHandling.h"
#include "wtf/SIMDUTF.h"
#include <JavaScriptCore/JSTypedArrays.h>
#include <array>

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

// The code points that ICU's default callback skips when the target cannot encode them. IS_DEFAULT_IGNORABLE_CODE_POINT: https://github.com/unicode-org/icu/blob/release-78.3/icu4c/source/common/ucnv_err.cpp#L68-L86
static constexpr std::pair<char32_t, char32_t> transcodeSkippedRanges[] = {
    { 0x00AD, 0x00AD },
    { 0x034F, 0x034F },
    { 0x061C, 0x061C },
    { 0x115F, 0x115F },
    { 0x1160, 0x1160 },
    { 0x17B4, 0x17B5 },
    { 0x180B, 0x180F },
    { 0x200B, 0x200F },
    { 0x202A, 0x202E },
    { 0x2060, 0x206F },
    { 0x3164, 0x3164 },
    { 0xFE00, 0xFE0F },
    { 0xFEFF, 0xFEFF },
    { 0xFFA0, 0xFFA0 },
    { 0xFFF0, 0xFFF8 },
    { 0x1BCA0, 0x1BCA3 },
    { 0x1D173, 0x1D17A },
    { 0xE0000, 0xE0FFF },
};

static constexpr bool transcodeSkipsUnmappable(char32_t codePoint)
{
    for (const auto& [first, last] : transcodeSkippedRanges) {
        if (codePoint >= first && codePoint <= last)
            return true;
    }
    return false;
}

// One bit for each UTF-16 unit that can start a code point of those ranges: a BMP code point of one, or a lead surrogate of one.
static constexpr std::array<uint64_t, 1024> transcodeSkippedStarts = [] {
    std::array<uint64_t, 1024> bits {};
    for (const auto& [first, last] : transcodeSkippedRanges) {
        const bool isBMP = U_IS_BMP(first);
        for (char32_t unit = isBMP ? first : U16_LEAD(first); unit <= (isBMP ? last : U16_LEAD(last)); ++unit)
            bits[unit >> 6] |= uint64_t { 1 } << (unit & 63);
    }
    return bits;
}();

// One step of transcodeEncodeNarrow: writes the byte of source[i], if it has one.
static ALWAYS_INLINE void transcodeEncodeNarrowUnit(const char16_t* source, size_t i, size_t length, char16_t maxCodePoint, uint8_t* bytes, size_t& written)
{
    const char16_t unit = source[i];
    // A trail surrogate writes nothing: its lead wrote the byte of the pair.
    if (U16_IS_TRAIL(unit)) [[unlikely]]
        return;
    if ((transcodeSkippedStarts[unit >> 6] >> (unit & 63)) & 1) [[unlikely]] {
        // Skipped, unless the target has this code point (U+00AD in latin1) or this lead surrogate starts a pair outside the ranges.
        if (unit > maxCodePoint && (!U16_IS_LEAD(unit) || (i + 1 < length && U16_IS_TRAIL(source[i + 1]) && transcodeSkipsUnmappable(U16_GET_SUPPLEMENTARY(unit, source[i + 1])))))
            return;
    }
    bytes[written++] = unit <= maxCodePoint ? static_cast<uint8_t>(unit) : '?';
}

// Encode well-formed UTF-16 into a single-byte encoding as ICU's converter does with '?' for its substitution character.
// A code point above maxCodePoint becomes '?', or nothing when ICU skips it: https://github.com/unicode-org/icu/blob/release-78.3/icu4c/source/common/ucnv_err.cpp#L174-L185
// Overwrites `units`. Returns nullptr with an exception pending when the result cannot be allocated.
static JSC::JSUint8Array* transcodeEncodeNarrow(JSGlobalObject* globalObject, WTF::Vector<char16_t>& units, char16_t maxCodePoint)
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
    // Substitution path: simdutf conversions are strict, so each unit is handled here.
    // The bytes overwrite the front of `units`: a step reads its unit before it writes at most one byte.
    const size_t length = units.size();
    const char16_t* const source = units.begin();
    auto* const bytes = reinterpret_cast<uint8_t*>(units.begin());
    size_t written = 0;
    size_t i = 0;
    // Two units in a step. The compiler unrolled the loop that this replaces and does not unroll this one: a step of one unit takes 1.5 times as long.
    for (; i + 1 < length; i += 2) {
        transcodeEncodeNarrowUnit(source, i, length, maxCodePoint, bytes, written);
        transcodeEncodeNarrowUnit(source, i + 1, length, maxCodePoint, bytes, written);
    }
    if (i < length)
        transcodeEncodeNarrowUnit(source, i, length, maxCodePoint, bytes, written);
    // A surrogate pair or a skipped code point leaves fewer bytes than the bulk attempt allocated.
    if (!result || written != length) {
        result = WebCore::createUninitializedBuffer(globalObject, written);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    if (written)
        memcpy(result->typedVector(), bytes, written);
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

    // Another thread can write to shared bytes between the passes below. The copy is a Buffer so that no return path has to free it.
    if (view->isShared()) [[unlikely]] {
        auto* copy = WebCore::createUninitializedBuffer(globalObject, length);
        RETURN_IF_EXCEPTION(scope, {});
        memcpy(copy->typedVector(), view->typedVector(), length);
        view = copy;
    }
    JSC::EnsureStillAliveScope keepAlive { view };
    const std::span<const uint8_t> input { view->typedVector(), length };
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
