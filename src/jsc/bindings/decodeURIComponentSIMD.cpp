
#include "root.h"

#include "BunString.h"
#include <wtf/text/WTFString.h>
#include <wtf/SIMDHelpers.h>
#include <wtf/SIMDUTF.h>
namespace Bun {
using namespace WTF;

ALWAYS_INLINE static uint8_t hexToInt(uint8_t c)
{
    if (c >= '0' && c <= '9')
        return c - '0';
    if (c >= 'A' && c <= 'F')
        return c - 'A' + 10;
    if (c >= 'a' && c <= 'f')
        return c - 'a' + 10;
    return 255; // Invalid
}

ALWAYS_INLINE static void appendLiteralRun(StringBuilder& result, std::span<const uint8_t> bytes, bool inputIsASCII)
{
    if (bytes.empty())
        return;
    const std::span<const Latin1Character> chars = { reinterpret_cast<const Latin1Character*>(bytes.data()), bytes.size() };
    if (inputIsASCII) {
        result.append(chars);
        return;
    }
    result.append(WTF::String::fromUTF8ReplacingInvalidSequences(chars));
}

WTF::String decodeURIComponentSIMD(std::span<const uint8_t> input)
{
    const bool inputIsASCII = simdutf::validate_ascii(reinterpret_cast<const char*>(input.data()), input.size());

    const std::span<const Latin1Character> lchar = { reinterpret_cast<const Latin1Character*>(input.data()), input.size() };

    // Fast path - check if there are any % characters at all
    const uint8_t* cursor = reinterpret_cast<const uint8_t*>(input.data());
    const uint8_t* end = cursor + input.size();

    constexpr size_t stride = SIMD::stride<uint8_t>;
    constexpr char16_t replacementChar = 0xFFFD;

    auto percentVector = SIMD::splat<uint8_t>('%');

    // Check 16 bytes at a time
    for (; cursor + stride <= end; cursor += stride) {
        auto chunk = SIMD::load(cursor);
        if (SIMD::isNonZero(SIMD::equal(chunk, percentVector))) {
            goto slow_path;
        }
    }

    // Check any remaining bytes
    while (cursor < end) {
        if (*cursor == '%')
            goto slow_path;
        cursor++;
    }

    if (inputIsASCII)
        return String(lchar);
    return String::fromUTF8ReplacingInvalidSequences(lchar);

slow_path:
    while (cursor < end && *cursor != '%') {
        cursor++;
    }
    StringBuilder result;
    result.reserveCapacity(input.size());
    appendLiteralRun(result, input.first(static_cast<size_t>(cursor - input.data())), inputIsASCII);

    while (cursor < end) {
        if (*cursor == '%') {
            if (cursor + 2 >= end) {
                result.append(replacementChar);
                cursor++;
                continue;
            }

            uint8_t highNibble = hexToInt(cursor[1]);
            uint8_t lowNibble = hexToInt(cursor[2]);

            if (highNibble > 15 || lowNibble > 15) {
                result.append(replacementChar);
                cursor += (cursor + 2 < end) ? 3 : 1;
                continue;
            }

            uint8_t byte = (highNibble << 4) | lowNibble;

            // Start of UTF-8 sequence
            if ((byte & 0x80) == 0) {
                // ASCII
                result.append(byte);
                cursor += 3;
            } else if ((byte & 0xE0) == 0xC0) {
                // 2-byte sequence
                uint32_t value = byte & 0x1F;
                cursor += 3;

                // Get second byte
                if (cursor + 2 >= end || *cursor != '%') {
                    result.append(replacementChar);
                    continue;
                }

                highNibble = hexToInt(cursor[1]);
                lowNibble = hexToInt(cursor[2]);
                if (highNibble > 15 || lowNibble > 15) {
                    result.append(replacementChar);
                    continue;
                }
                byte = (highNibble << 4) | lowNibble;
                if ((byte & 0xC0) != 0x80) {
                    result.append(replacementChar);
                    continue;
                }
                value = (value << 6) | (byte & 0x3F);
                cursor += 3;

                // Check for overlong encoding
                if (value < 0x80 || value > 0x7FF) {
                    result.append(replacementChar);
                    continue;
                }

                result.append(static_cast<char16_t>(value));
            } else if ((byte & 0xF0) == 0xE0) {
                // 3-byte sequence
                uint32_t value = byte & 0x0F;
                cursor += 3;

                // Get second byte
                if (cursor + 2 >= end || *cursor != '%') {
                    result.append(replacementChar);
                    continue;
                }
                highNibble = hexToInt(cursor[1]);
                lowNibble = hexToInt(cursor[2]);
                if (highNibble > 15 || lowNibble > 15) {
                    result.append(replacementChar);
                    continue;
                }
                byte = (highNibble << 4) | lowNibble;
                if ((byte & 0xC0) != 0x80) {
                    result.append(replacementChar);
                    continue;
                }
                value = (value << 6) | (byte & 0x3F);
                cursor += 3;

                // Get third byte
                if (cursor + 2 >= end || *cursor != '%') {
                    result.append(replacementChar);
                    continue;
                }
                highNibble = hexToInt(cursor[1]);
                lowNibble = hexToInt(cursor[2]);
                if (highNibble > 15 || lowNibble > 15) {
                    result.append(replacementChar);
                    continue;
                }
                byte = (highNibble << 4) | lowNibble;
                if ((byte & 0xC0) != 0x80) {
                    result.append(replacementChar);
                    continue;
                }
                value = (value << 6) | (byte & 0x3F);
                cursor += 3;

                // Check for overlong encoding and surrogate range
                if (value < 0x800 || value > 0xFFFF || (value >= 0xD800 && value <= 0xDFFF) || // Surrogate range check
                    (byte == 0xE0 && (value & 0x1F00) == 0)) // Overlong check for E0
                {
                    result.append(replacementChar);
                    continue;
                }

                result.append(static_cast<char16_t>(value));
            } else if ((byte & 0xF8) == 0xF0) {
                // 4-byte sequence -> surrogate pair
                uint32_t value = byte & 0x07;
                cursor += 3;

                // Get second byte
                if (cursor + 2 >= end || *cursor != '%') {
                    result.append(replacementChar);
                    continue;
                }
                highNibble = hexToInt(cursor[1]);
                lowNibble = hexToInt(cursor[2]);
                if (highNibble > 15 || lowNibble > 15) {
                    result.append(replacementChar);
                    continue;
                }
                byte = (highNibble << 4) | lowNibble;
                if ((byte & 0xC0) != 0x80) {
                    result.append(replacementChar);
                    continue;
                }
                value = (value << 6) | (byte & 0x3F);
                cursor += 3;

                // Get third byte
                if (cursor + 2 >= end || *cursor != '%') {
                    result.append(replacementChar);
                    continue;
                }
                highNibble = hexToInt(cursor[1]);
                lowNibble = hexToInt(cursor[2]);
                if (highNibble > 15 || lowNibble > 15) {
                    result.append(replacementChar);
                    continue;
                }
                byte = (highNibble << 4) | lowNibble;
                if ((byte & 0xC0) != 0x80) {
                    result.append(replacementChar);
                    continue;
                }
                value = (value << 6) | (byte & 0x3F);
                cursor += 3;

                // Get fourth byte
                if (cursor + 2 >= end || *cursor != '%') {
                    result.append(replacementChar);
                    continue;
                }
                highNibble = hexToInt(cursor[1]);
                lowNibble = hexToInt(cursor[2]);
                if (highNibble > 15 || lowNibble > 15) {
                    result.append(replacementChar);
                    continue;
                }
                byte = (highNibble << 4) | lowNibble;
                if ((byte & 0xC0) != 0x80) {
                    result.append(replacementChar);
                    continue;
                }
                value = (value << 6) | (byte & 0x3F);
                cursor += 3;

                // Check for overlong encoding and maximum valid code point
                if (value < 0x10000 || value > 0x10FFFF || (byte == 0xF0 && (value & 0x040000) == 0) || // Overlong check for F0
                    (byte == 0xF4 && value > 0x10FFFF)) // Max code point check
                {
                    result.append(replacementChar);
                    continue;
                }

                // Convert to surrogate pair
                value -= 0x10000;
                result.append(static_cast<char16_t>(0xD800 | (value >> 10)));
                result.append(static_cast<char16_t>(0xDC00 | (value & 0x3FF)));
            } else {
                result.append(replacementChar);
                cursor += (cursor + 2 < end) ? 3 : 1;
            }
            continue;
        } else {
            // Look ahead for next % using SIMD
            const uint8_t* runStart = cursor;
            const uint8_t* lookAhead = cursor;
            while (lookAhead + stride <= end) {
                auto chunk = SIMD::load(lookAhead);
                if (SIMD::isNonZero(SIMD::equal(chunk, percentVector))) {
                    break;
                }
                lookAhead += stride;
            }
            cursor = lookAhead;

            // Handle remaining bytes until next % or end
            while (cursor < end && *cursor != '%') {
                cursor++;
            }
            appendLiteralRun(result, std::span<const uint8_t>(runStart, static_cast<size_t>(cursor - runStart)), inputIsASCII);
        }
    }

    return result.toString();
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDecodeURIComponentSIMD, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{

    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue input = callFrame->argument(0);
    if (input.isString()) {
        auto string = input.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        // decodeURIComponentSIMD consumes UTF-8 bytes, like the ServerRouteList and CookieMap callers.
        UTF8View utf8View(string);
        auto&& output = decodeURIComponentSIMD(utf8View.bytes());
        return JSC::JSValue::encode(JSC::jsString(vm, output));
    }

    JSC::JSArrayBufferView* view = dynamicDowncast<JSC::JSArrayBufferView>(input);
    if (!view) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    auto span = view->span();
    auto&& output = decodeURIComponentSIMD(span);
    return JSC::JSValue::encode(JSC::jsString(vm, output));
}
}
