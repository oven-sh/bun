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

static JSC::JSString* tryDecodeUTF8(JSC::VM& vm, std::span<const uint8_t> bytes, bool replacesInvalidBytes)
{
    if (bytes.empty())
        return JSC::jsEmptyString(vm);
    if (replacesInvalidBytes || WTF::charactersAreAllASCII(byteCast<Latin1Character>(bytes))) {
        String text = String::tryFromUTF8ReplacingInvalidSequences(byteCast<char8_t>(bytes));
        return text.isNull() ? nullptr : JSC::jsString(vm, WTF::move(text));
    }
    std::span<char16_t> units;
    RefPtr<StringImpl> impl = StringImpl::tryCreateUninitialized(simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(bytes.data()), bytes.size()), units);
    if (!impl || !StringImpl::tryConvertUTF8ToUTF16(byteCast<char8_t>(bytes), units))
        return nullptr;
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
