#include "root.h"

#if ENABLE(AOT)

#include "GeneratedTextDecoder.h"
#include "JSTextEncoder.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <array>
#include <cstring>
#include <span>
#include <wtf/SIMDUTF.h>
#include <wtf/text/ASCIIFastPath.h>
#include <wtf/text/StringImpl.h>

// Compiled code calls these instead of TextEncoder.prototype.encode and TextDecoder.prototype.decode.

JSC_DECLARE_HOST_FUNCTION(jsTextDecoderPrototypeFunction_decode);
JSC_DECLARE_HOST_FUNCTION(AOT__TextDecoder__decode);
JSC_DECLARE_HOST_FUNCTION(AOT__TextEncoder__encode);
extern "C" bool TextDecoder__startsUTF8(const void* decoder, bool* removesByteOrderMark, bool* replacesInvalidBytes);

namespace WebCore {
JSC_DECLARE_HOST_FUNCTION(jsTextEncoderPrototypeFunction_encode);
}

namespace Bun {

static size_t encodeWithReplacement(std::span<const char16_t> units, std::span<uint8_t> output)
{
    size_t length = 0;
    auto append = [&](uint32_t byte) {
        RELEASE_ASSERT(length < output.size());
        output[length++] = static_cast<uint8_t>(byte);
    };
    for (size_t i = 0; i < units.size(); ++i) {
        char32_t character = units[i];
        if (U16_IS_SURROGATE(character)) {
            if (U16_IS_SURROGATE_LEAD(character) && i + 1 < units.size() && U16_IS_TRAIL(units[i + 1]))
                character = U16_GET_SUPPLEMENTARY(character, units[++i]);
            else
                character = 0xfffd;
        }
        if (character < 0x80) {
            append(character);
            continue;
        }
        if (character < 0x800)
            append(0xc0 | character >> 6);
        else {
            if (character < 0x10000)
                append(0xe0 | character >> 12);
            else {
                append(0xf0 | character >> 18);
                append(0x80 | (character >> 12 & 0x3f));
            }
            append(0x80 | (character >> 6 & 0x3f));
        }
        append(0x80 | (character & 0x3f));
    }
    return length;
}

static JSC::JSUint8Array* createBytes(JSC::JSGlobalObject* globalObject, size_t length)
{
    return JSC::JSUint8Array::createUninitialized(globalObject, globalObject->typedArrayStructure(JSC::TypeUint8, false), length);
}

static JSC::JSUint8Array* encodeUTF8(JSC::JSGlobalObject* globalObject, std::span<const Latin1Character> characters)
{
    size_t length = WTF::charactersAreAllASCII(characters) ? characters.size() : simdutf::utf8_length_from_latin1(reinterpret_cast<const char*>(characters.data()), characters.size());
    JSC::JSUint8Array* bytes = createBytes(globalObject, length);
    if (!bytes) [[unlikely]]
        return nullptr;
    if (length == characters.size()) {
        memcpy(bytes->typedVector(), characters.data(), length);
        return bytes;
    }
    size_t written = simdutf::convert_latin1_to_utf8(reinterpret_cast<const char*>(characters.data()), characters.size(), reinterpret_cast<char*>(bytes->typedVector()));
    RELEASE_ASSERT(written == length);
    return bytes;
}

static JSC::JSUint8Array* encodeUTF8(JSC::JSGlobalObject* globalObject, std::span<const char16_t> units)
{
    constexpr size_t maxStackEncodedUnits = 128;
    constexpr size_t maxBytesPerCodeUnit = 3;
    auto encode = [&](std::span<uint8_t> output) {
        auto result = simdutf::convert_utf16le_to_utf8_with_errors(units.data(), units.size(), reinterpret_cast<char*>(output.data()));
        return result.error == simdutf::SUCCESS ? result.count : encodeWithReplacement(units, output);
    };
    if (units.size() <= maxStackEncodedUnits) {
        std::array<uint8_t, maxStackEncodedUnits * maxBytesPerCodeUnit> output;
        size_t length = encode(output);
        JSC::JSUint8Array* bytes = createBytes(globalObject, length);
        if (bytes) [[likely]]
            memcpy(bytes->typedVector(), output.data(), length);
        return bytes;
    }
    size_t length = simdutf::utf8_length_from_utf16le_with_replacement(units.data(), units.size()).count;
    JSC::JSUint8Array* bytes = createBytes(globalObject, length);
    if (!bytes) [[unlikely]]
        return nullptr;
    size_t written = encode({ bytes->typedVector(), length });
    RELEASE_ASSERT(written == length);
    return bytes;
}

static bool hasFixedUnsharedBytes(JSC::JSUint8Array* view)
{
    return !view->hasArrayBuffer() || (!view->isShared() && !view->isDetached() && !view->isResizableOrGrowableShared());
}

static ALWAYS_INLINE bool isContinuation(uint8_t byte)
{
    return static_cast<int8_t>(byte) < -0x40;
}

// https://encoding.spec.whatwg.org/#utf-8-decoder: the number of bytes of a sequence that is invalid or ends early.
static NEVER_INLINE size_t invalidSequenceLength(std::span<const uint8_t> bytes)
{
    uint8_t lead = bytes[0];
    size_t needed = lead < 0xc2 || lead > 0xf4 ? 0 : lead < 0xe0 ? 1
        : lead < 0xf0                                            ? 2
                                                                 : 3;
    uint8_t least = lead == 0xe0 ? 0xa0 : lead == 0xf0 ? 0x90
                                                       : 0x80;
    uint8_t greatest = lead == 0xed ? 0x9f : lead == 0xf4 ? 0x8f
                                                          : 0xbf;
    size_t length = 1;
    for (; length <= needed && length < bytes.size() && bytes[length] >= least && bytes[length] <= greatest; ++length) {
        least = 0x80;
        greatest = 0xbf;
    }
    return length;
}

static size_t decodeWithReplacement(std::span<const uint8_t> bytes, std::span<char16_t> output, bool& hasInvalidByte)
{
    RELEASE_ASSERT(output.size() >= bytes.size());
    constexpr size_t minVectorizedBytes = 16;
    constexpr unsigned maxVectorizedPrefixes = 2;
    char16_t* unit = output.data();
    const uint8_t* byte = bytes.data();
    const uint8_t* end = byte + bytes.size();
    unsigned vectorizedPrefixes = 0;
    auto decodeValidPrefix = [&] {
        size_t left = end - byte;
        if (left < minVectorizedBytes || vectorizedPrefixes++ >= maxVectorizedPrefixes)
            return;
        auto* characters = reinterpret_cast<const char*>(byte);
        auto result = simdutf::convert_utf8_to_utf16le_with_errors(characters, left, unit);
        bool isValid = result.error == simdutf::SUCCESS;
        unit += isValid ? result.count : simdutf::utf16_length_from_utf8(characters, result.count);
        byte = isValid ? end : byte + result.count;
    };
    decodeValidPrefix();
    while (byte < end) {
        uint32_t lead = *byte;
        size_t left = end - byte;
        if (lead < 0x80) {
            *unit++ = static_cast<char16_t>(lead);
            ++byte;
            continue;
        }
        if (lead < 0xe0) {
            if (lead >= 0xc2 && left > 1 && isContinuation(byte[1])) [[likely]] {
                *unit++ = static_cast<char16_t>((lead & 0x1f) << 6 | (byte[1] & 0x3f));
                byte += 2;
                continue;
            }
        } else if (lead < 0xf0) {
            if (left > 2 && isContinuation(byte[1]) && isContinuation(byte[2])) [[likely]] {
                uint32_t character = (lead & 0xf) << 12 | (byte[1] & 0x3f) << 6 | (byte[2] & 0x3f);
                if (character >= 0x800 && (character & 0xf800) != 0xd800) [[likely]] {
                    *unit++ = static_cast<char16_t>(character);
                    byte += 3;
                    continue;
                }
            }
        } else if (left > 3 && isContinuation(byte[1]) && isContinuation(byte[2]) && isContinuation(byte[3])) {
            uint32_t character = (lead - 0xf0) << 18 | (byte[1] & 0x3f) << 12 | (byte[2] & 0x3f) << 6 | (byte[3] & 0x3f);
            if (character - 0x10000 < 0x100000) [[likely]] {
                *unit++ = U16_LEAD(character);
                *unit++ = U16_TRAIL(character);
                byte += 4;
                continue;
            }
        }
        hasInvalidByte = true;
        *unit++ = 0xfffd;
        byte += invalidSequenceLength({ byte, left });
        for (; byte < end && isContinuation(*byte); ++byte)
            *unit++ = 0xfffd;
        decodeValidPrefix();
    }
    return unit - output.data();
}

static JSC::JSString* tryDecodeUTF8(JSC::VM& vm, std::span<const uint8_t> bytes, bool replacesInvalidBytes)
{
    constexpr size_t maxStackDecodedBytes = 256;
    if (bytes.empty())
        return JSC::jsEmptyString(vm);
    if (bytes.size() > String::MaxLength)
        return nullptr;
    if (WTF::charactersAreAllASCII(byteCast<Latin1Character>(bytes)))
        return JSC::jsString(vm, String(byteCast<Latin1Character>(bytes)));
    if (bytes.size() <= maxStackDecodedBytes) {
        std::array<char16_t, maxStackDecodedBytes> output;
        bool hasInvalidByte = false;
        size_t length = decodeWithReplacement(bytes, output, hasInvalidByte);
        if (hasInvalidByte && !replacesInvalidBytes)
            return nullptr;
        return JSC::jsString(vm, String(std::span { output }.first(length)));
    }
    auto* characters = reinterpret_cast<const char*>(bytes.data());
    if (!simdutf::validate_utf8(characters, bytes.size()))
        return nullptr;
    std::span<char16_t> units;
    RefPtr<StringImpl> impl = StringImpl::tryCreateUninitialized(simdutf::utf16_length_from_utf8(characters, bytes.size()), units);
    if (!impl) [[unlikely]]
        return nullptr;
    size_t written = simdutf::convert_valid_utf8_to_utf16le(characters, bytes.size(), units.data());
    RELEASE_ASSERT(written == units.size());
    return JSC::jsString(vm, String(impl.releaseNonNull()));
}

} // namespace Bun

JSC_DEFINE_HOST_FUNCTION(AOT__TextEncoder__encode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::JSValue input = callFrame->argument(0);
    if (!input.isString() || !dynamicDowncast<WebCore::JSTextEncoder>(callFrame->thisValue())) [[unlikely]]
        return WebCore::jsTextEncoderPrototypeFunction_encode(globalObject, callFrame);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto view = JSC::asString(input)->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSUint8Array* bytes = view->is8Bit() ? Bun::encodeUTF8(globalObject, view->span8()) : Bun::encodeUTF8(globalObject, view->span16());
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(bytes);
}

JSC_DEFINE_HOST_FUNCTION(AOT__TextDecoder__decode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* decoder = dynamicDowncast<Bun::Bindgen::Generated::JSTextDecoder>(callFrame->thisValue());
    auto* view = dynamicDowncast<JSC::JSUint8Array>(callFrame->argument(0));
    bool removesByteOrderMark = false;
    bool replacesInvalidBytes = false;
    if (decoder && view && Bun::hasFixedUnsharedBytes(view) && callFrame->argument(1).isUndefinedOrNull() && TextDecoder__startsUTF8(decoder->payload(), &removesByteOrderMark, &replacesInvalidBytes)) [[likely]] {
        std::span<const uint8_t> bytes { view->typedVector(), view->length() };
        constexpr std::array<uint8_t, 3> byteOrderMark { 0xef, 0xbb, 0xbf };
        if (removesByteOrderMark && bytes.size() >= byteOrderMark.size() && !memcmp(bytes.data(), byteOrderMark.data(), byteOrderMark.size()))
            bytes = bytes.subspan(byteOrderMark.size());
        JSC::JSString* text = Bun::tryDecodeUTF8(JSC::getVM(globalObject), bytes, replacesInvalidBytes);
        JSC::ensureStillAliveHere(view);
        if (text)
            return JSC::JSValue::encode(text);
    }
    return jsTextDecoderPrototypeFunction_decode(globalObject, callFrame);
}

#endif // ENABLE(AOT)
