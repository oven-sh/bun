#pragma once

#include "engine/support/Assertions.h"
#include "engine/text/Latin1Character.h"

#include <type_traits>

// Classes of ASCII characters, whatever the locale. What is not ASCII is in none of them and has no case.

namespace WTF {

namespace Detail {

template<typename T> constexpr auto codeOf(T character) { return static_cast<std::make_unsigned_t<T>>(character); }
constexpr uint8_t codeOf(Latin1Character character) { return character.value; }

template<char first, char last, typename T> constexpr bool isBetween(T character)
{
    return codeOf(character) - static_cast<unsigned>(first) <= static_cast<unsigned>(last - first);
}

}

template<typename T> constexpr bool isASCII(T character) { return Detail::codeOf(character) < 0x80; }
template<typename T> constexpr bool isLatin1(T character) { return Detail::codeOf(character) < 0x100; }
template<typename T> constexpr bool isASCIIDigit(T character) { return Detail::isBetween<'0', '9'>(character); }
template<typename T> constexpr bool isASCIILower(T character) { return Detail::isBetween<'a', 'z'>(character); }
template<typename T> constexpr bool isASCIIUpper(T character) { return Detail::isBetween<'A', 'Z'>(character); }
template<typename T> constexpr bool isASCIIAlpha(T character) { return isASCIILower(Detail::codeOf(character) | 0x20u); }
template<typename T> constexpr bool isASCIIAlphanumeric(T character) { return isASCIIDigit(character) || isASCIIAlpha(character); }
template<typename T> constexpr bool isASCIIHexDigit(T character) { return isASCIIDigit(character) || Detail::isBetween<'a', 'f'>(Detail::codeOf(character) | 0x20u); }
template<typename T> constexpr bool isTabOrSpace(T character) { return character == ' ' || character == '\t'; }

// https://infra.spec.whatwg.org/#ascii-whitespace
template<typename T> constexpr bool isASCIIWhitespace(T character)
{
    return character == ' ' || character == '\n' || character == '\t' || character == '\r' || character == '\f';
}

template<typename T> constexpr T toASCIILower(T character) { return static_cast<T>(character | (isASCIIUpper(character) << 5)); }
template<typename T> constexpr T toASCIIUpper(T character) { return static_cast<T>(character & ~(isASCIILower(character) << 5)); }

template<typename T> constexpr uint8_t toASCIIHexValue(T digit)
{
    ASSERT(isASCIIHexDigit(digit));
    return static_cast<uint8_t>((digit & 0xF) + (isASCIIDigit(digit) ? 0 : 9));
}

template<typename T> constexpr uint8_t toASCIIHexValue(T high, T low)
{
    return static_cast<uint8_t>(toASCIIHexValue(high) << 4 | toASCIIHexValue(low));
}

}

using WTF::isASCII;
using WTF::isASCIIAlpha;
using WTF::isASCIIAlphanumeric;
using WTF::isASCIIDigit;
using WTF::isASCIIHexDigit;
using WTF::isASCIILower;
using WTF::isASCIIUpper;
using WTF::isASCIIWhitespace;
using WTF::isLatin1;
using WTF::isTabOrSpace;
using WTF::toASCIIHexValue;
using WTF::toASCIILower;
using WTF::toASCIIUpper;
