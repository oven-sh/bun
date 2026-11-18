#pragma once

#include "engine/support/Assertions.h"
#include "engine/text/Latin1Character.h"

#include <cstddef>
#include <span>
#include <string_view>

namespace WTF {

// ASCII in static memory that a zero byte follows, or null. The layout of `bun_engine_vm::AsciiLiteral`.
class ASCIILiteral final {
public:
    constexpr ASCIILiteral() = default;
    constexpr ASCIILiteral(std::nullptr_t) {}

    template<size_t size>
    consteval ASCIILiteral(const char (&literal)[size])
        : ASCIILiteral(literal, size)
    {
    }

    static constexpr ASCIILiteral fromLiteralUnsafe(const char* characters)
    {
        return { characters, __builtin_strlen(characters) + 1 };
    }

    constexpr bool isNull() const { return !m_size; }
    constexpr bool isEmpty() const { return m_size <= 1; }
    constexpr size_t length() const { return m_size ? m_size - 1 : 0; }

    constexpr const char* characters() const { return m_characters; }
    constexpr operator const char*() const { return m_characters; }
    constexpr std::span<const char> span() const { return { m_characters, length() }; }
    std::span<const Latin1Character> span8() const { return { reinterpret_cast<const Latin1Character*>(m_characters), length() }; }

    constexpr char operator[](size_t index) const
    {
        ASSERT(index < m_size);
        return m_characters[index];
    }

    friend constexpr bool operator==(ASCIILiteral a, ASCIILiteral b)
    {
        return std::string_view(a.m_characters, a.m_size) == std::string_view(b.m_characters, b.m_size);
    }

private:
    constexpr ASCIILiteral(const char* characters, size_t size)
        : m_characters(characters)
        , m_size(size)
    {
        ASSERT(!characters[size - 1]);
#if ASSERT_ENABLED
        for (char character : span())
            ASSERT(!(character & 0x80));
#endif
    }

    const char* m_characters { nullptr };
    // Counts the zero byte.
    size_t m_size { 0 };
};

inline namespace StringLiterals {

consteval ASCIILiteral operator""_s(const char* characters, size_t)
{
    return ASCIILiteral::fromLiteralUnsafe(characters);
}

constexpr std::span<const char> operator""_span(const char* characters, size_t length)
{
    return { characters, length };
}

inline std::span<const Latin1Character> operator""_span8(const char* characters, size_t length)
{
    return { reinterpret_cast<const Latin1Character*>(characters), length };
}

}

}

using WTF::ASCIILiteral;
using namespace WTF::StringLiterals;
