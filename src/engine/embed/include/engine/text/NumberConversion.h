#pragma once

#include "engine/text/StringView.h"

#include <array>
#include <optional>

extern "C" {
size_t engine_number_write_shortest(double, char (&buffer)[32]);
bool engine_number_parse_integer(WTF::StringView, uint8_t radix, uint8_t surroundings, bool isSigned, uint64_t& bits);
}

namespace WTF {

namespace Detail {

struct ShortestDigits {
    explicit ShortestDigits(double number)
        : length(engine_number_write_shortest(number, buffer))
    {
    }

    std::span<const Latin1Character> span() const LIFETIME_BOUND { return { byteCast<Latin1Character>(buffer), length }; }

    char buffer[32];
    size_t length;
};

inline constexpr auto powersOfTen = [] {
    std::array<uint64_t, 20> powers { 1 };
    for (size_t i = 1; i < powers.size(); ++i)
        powers[i] = powers[i - 1] * 10;
    return powers;
}();

constexpr unsigned decimalLength(uint64_t number)
{
    // 1233 / 4096 is a little less than log10(2).
    unsigned guess = std::bit_width(number | 1) * 1233 >> 12;
    return guess + ((number | 1) >= powersOfTen[guess]);
}

// `bun_engine_number::Surroundings`.
enum Surroundings : uint8_t { Nothing,
    WhiteSpace,
    WhiteSpaceBeforeAnythingAfter };

template<typename Integer> std::optional<Integer> parseInteger(StringView string, uint8_t base, Surroundings surroundings)
{
    uint64_t bits;
    if (!engine_number_parse_integer(string, base, surroundings, std::is_signed_v<Integer>, bits))
        return std::nullopt;
    auto value = static_cast<std::conditional_t<std::is_signed_v<Integer>, int64_t, uint64_t>>(bits);
    if (!std::in_range<Integer>(value))
        return std::nullopt;
    return static_cast<Integer>(value);
}

}

enum class ParseIntegerWhitespacePolicy : bool { Disallow,
    Allow };
enum class TrailingJunkPolicy : bool { Disallow,
    Allow };

template<typename Integer>
std::optional<Integer> parseInteger(StringView string, uint8_t base = 10, ParseIntegerWhitespacePolicy whitespace = ParseIntegerWhitespacePolicy::Allow)
{
    return Detail::parseInteger<Integer>(string, base, whitespace == ParseIntegerWhitespacePolicy::Allow ? Detail::WhiteSpace : Detail::Nothing);
}

template<typename Integer, typename T>
std::optional<Integer> parseInteger(std::span<const T> characters, uint8_t base, TrailingJunkPolicy junk)
{
    return Detail::parseInteger<Integer>(characters, base, junk == TrailingJunkPolicy::Allow ? Detail::WhiteSpaceBeforeAnythingAfter : Detail::WhiteSpace);
}

template<typename Integer>
std::optional<Integer> parseIntegerAllowingTrailingJunk(StringView string, uint8_t base = 10)
{
    return Detail::parseInteger<Integer>(string, base, Detail::WhiteSpaceBeforeAnythingAfter);
}

struct HexNumberBuffer {
    std::span<const Latin1Character> span() const LIFETIME_BOUND { return std::span { buffer }.last(length); }

    std::array<Latin1Character, 16> buffer;
    unsigned length;
};

// In uppercase.
inline HexNumberBuffer hex(auto number, unsigned minimumDigits = 0)
{
    HexNumberBuffer result;
    result.length = 0;
    uint64_t rest = Detail::codeOf(number);
    do {
        result.buffer[result.buffer.size() - ++result.length] = "0123456789ABCDEF"[rest & 0xF];
        rest >>= 4;
    } while ((rest || result.length < minimumDigits) && result.length < result.buffer.size());
    return result;
}

}

using WTF::hex;
using WTF::parseInteger;
using WTF::parseIntegerAllowingTrailingJunk;
