#pragma once

#include <compare>
#include <concepts>
#include <cstdint>

namespace WTF {

// A type of its own, so that Latin-1 text is not taken for bytes or for UTF-8.
struct Latin1Character {
    Latin1Character() = default;
    constexpr Latin1Character(std::integral auto code)
        : value(static_cast<uint8_t>(code))
    {
    }

    constexpr operator uint8_t() const { return value; }

    friend constexpr bool operator==(Latin1Character, Latin1Character) = default;
    friend constexpr auto operator<=>(Latin1Character, Latin1Character) = default;
    friend constexpr bool operator==(Latin1Character a, std::integral auto b) { return a.value == b; }
    friend constexpr auto operator<=>(Latin1Character a, std::integral auto b) { return a.value <=> b; }

    uint8_t value;
};

template<typename T>
concept IsStringStorageCharacter = std::same_as<T, Latin1Character> || std::same_as<T, char16_t>;

}

using WTF::Latin1Character;
