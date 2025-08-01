
#include "root.h"

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

WTF::String decodeURIComponentSIMD(std::span<const uint8_t> input)
{
    ASSERT_WITH_MESSAGE(simdutf::validate_ascii(reinterpret_cast<const char*>(input.data()), input.size()), "Input is not ASCII");

    const std::span<const LChar> lchar = { reinterpret_cast<const LChar*>(input.data()), input.size() };

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

    return String(lchar);

slow_path:
    StringBuilder result;
    result.reserveCapacity(input.size());
    result.append(std::span<const LChar>(reinterpret_cast<const LChar*>(input.data()), cursor - input.data()));

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
            const uint8_t* lookAhead = cursor;
            while (lookAhead + stride <= end) {
                auto chunk = SIMD::load(lookAhead);
                if (SIMD::isNonZero(SIMD::equal(chunk, percentVector))) {
                    break;
                }
                lookAhead += stride;
            }

            // Append everything up to lookAhead
            result.append(std::span<const LChar>(reinterpret_cast<const LChar*>(cursor), lookAhead - cursor));
            cursor = lookAhead;

            // Handle remaining bytes until next % or end
            while (cursor < end && *cursor != '%') {
                cursor++;
            }
            if (cursor > lookAhead) {
                result.append(std::span<const LChar>(reinterpret_cast<const LChar*>(lookAhead), cursor - lookAhead));
            }
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

        if (!string.is8Bit()) {
            const auto span = string.span16();
            size_t expected_length = simdutf::latin1_length_from_utf16(span.size());
            std::span<LChar> ptr;
            WTF::String convertedString = WTF::String::tryCreateUninitialized(expected_length, ptr);
            if (convertedString.isNull()) [[unlikely]] {
                throwVMError(globalObject, scope, createOutOfMemoryError(globalObject));
                return {};
            }

            auto result = simdutf::convert_utf16le_to_latin1_with_errors(span.data(), span.size(), reinterpret_cast<char*>(ptr.data()));

            if (result.error) {
                scope.throwException(globalObject, createRangeError(globalObject, "Invalid character in input"_s));
                return {};
            }
            string = convertedString;
        }

        auto span = string.span8();
        auto&& output = decodeURIComponentSIMD(span);
        return JSC::JSValue::encode(JSC::jsString(vm, output));
    }

    JSC::JSArrayBufferView* view = jsDynamicCast<JSC::JSArrayBufferView*>(input);
    if (!view) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    auto span = view->span();
    auto&& output = decodeURIComponentSIMD(span);
    return JSC::JSValue::encode(JSC::jsString(vm, output));
}
}
