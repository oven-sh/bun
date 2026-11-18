#pragma once

#include "engine/support/BitSet.h"
#include "engine/support/Span.h"
#include "engine/text/ASCIICType.h"
#include "engine/text/ASCIILiteral.h"

#include <cstring>
#include <unicode/utf16.h>
#include <unicode/utf8.h>
#include <unicode/utypes.h>

// Operations on spans of characters.

extern "C" {
bool engine_text_is_ascii8(const void*, size_t length);
bool engine_text_is_ascii16(const char16_t*, size_t length);
bool engine_text_fits_latin1(const char16_t*, size_t length);
size_t engine_text_find_unit8(const void*, size_t length, uint8_t, size_t start);
size_t engine_text_find_unit16(const void*, size_t length, char16_t, size_t start);
bool engine_text_equal_bytes(const void*, const void*, size_t size);
bool engine_text_equal_across_widths(const WTF::Latin1Character*, const char16_t*, size_t length);
void engine_text_widen(char16_t* destination, const WTF::Latin1Character* source, size_t length);
void engine_text_narrow(WTF::Latin1Character* destination, const char16_t* source, size_t length);
}

namespace WTF {

using CodeUnitMatchFunction = bool (*)(char16_t);

namespace Detail {

template<size_t width> ALWAYS_INLINE bool equalEnds(const char* a, const char* b, size_t size)
{
    return !__builtin_memcmp(a, b, width) && !__builtin_memcmp(a + size - width, b + size - width, width);
}

ALWAYS_INLINE bool equalBytes(const void* first, const void* second, size_t size)
{
    if (!size)
        return true;
    if (__builtin_constant_p(size))
        return !__builtin_memcmp(first, second, size);
    auto* a = static_cast<const char*>(first);
    auto* b = static_cast<const char*>(second);
    if (a[0] != b[0])
        return false;
    if (size < 4)
        return a[size / 2] == b[size / 2] && a[size - 1] == b[size - 1];
    if (size <= 8)
        return equalEnds<4>(a, b, size);
    if (size <= 16)
        return equalEnds<8>(a, b, size);
    if (size <= 32)
        return equalEnds<16>(a, b, size);
    return engine_text_equal_bytes(a, b, size);
}

template<typename T> ALWAYS_INLINE bool equalCharacters(const T* a, const T* b, size_t length) { return equalBytes(a, b, length * sizeof(T)); }
ALWAYS_INLINE bool equalCharacters(const Latin1Character* a, const char16_t* b, size_t length) { return engine_text_equal_across_widths(a, b, length); }
ALWAYS_INLINE bool equalCharacters(const char16_t* a, const Latin1Character* b, size_t length) { return engine_text_equal_across_widths(b, a, length); }

template<size_t width> ALWAYS_INLINE void copyEnds(char* __restrict destination, const char* __restrict source, size_t size)
{
    __builtin_memcpy(destination, source, width);
    __builtin_memcpy(destination + size - width, source + size - width, width);
}

ALWAYS_INLINE void copyBytes(void* __restrict to, const void* __restrict from, size_t size)
{
    auto* destination = static_cast<char*>(to);
    auto* source = static_cast<const char*>(from);
    if (__builtin_constant_p(size) || size > 32) {
        if (size)
            __builtin_memcpy(destination, source, size);
    } else if (size >= 16)
        copyEnds<16>(destination, source, size);
    else if (size >= 8)
        copyEnds<8>(destination, source, size);
    else if (size >= 4)
        copyEnds<4>(destination, source, size);
    else if (size) {
        destination[0] = source[0];
        destination[size / 2] = source[size / 2];
        destination[size - 1] = source[size - 1];
    }
}

inline void widen(char16_t* __restrict destination, const Latin1Character* __restrict source, size_t length)
{
    if (length > 8)
        return engine_text_widen(destination, source, length);
    std::copy_n(source, length, destination);
}

}

inline std::span<const char> unsafeSpan(const char* string) { return { string, string ? strlen(string) : 0 }; }
inline std::span<const char8_t> unsafeSpan(const char8_t* string) { return byteCast<char8_t>(unsafeSpan(byteCast<char>(string))); }

inline std::span<const char8_t> nonNullEmptyUTF8Span() { return { u8"", 0 }; }

template<typename T> inline bool charactersAreAllASCII(std::span<const T> characters)
{
    if constexpr (sizeof(T) == 1)
        return engine_text_is_ascii8(characters.data(), characters.size());
    else
        return engine_text_is_ascii16(characters.data(), characters.size());
}

inline bool charactersAreAllLatin1(std::span<const char16_t> characters) { return engine_text_fits_latin1(characters.data(), characters.size()); }

constexpr BitSet<256> makeLatin1CharacterBitSet(ASCIILiteral characters)
{
    BitSet<256> set;
    for (char character : characters.span())
        set.set(character);
    return set;
}

template<typename T, typename U>
    requires(sizeof(T) <= 2 && sizeof(U) == sizeof(T) && (std::integral<U> || std::same_as<U, Latin1Character>))
inline size_t find(std::span<const T> characters, U character, size_t start = 0)
{
    using Lane = typename SizedUnsignedTrait<sizeof(T)>::Type;
    auto* lanes = reinterpret_cast<const Lane*>(characters.data());
    auto wanted = static_cast<Lane>(character);
    if (start + 16 / sizeof(Lane) > characters.size()) {
        for (; start < characters.size(); ++start) {
            if (lanes[start] == wanted)
                return start;
        }
        return notFound;
    }
    if constexpr (sizeof(T) == 1)
        return engine_text_find_unit8(lanes, characters.size(), wanted, start);
    else
        return engine_text_find_unit16(lanes, characters.size(), wanted, start);
}

inline size_t find(std::span<const char16_t> characters, Latin1Character character, size_t start = 0)
{
    return find(characters, static_cast<char16_t>(character), start);
}

inline size_t find(std::span<const Latin1Character> characters, char16_t character, size_t start = 0)
{
    return isLatin1(character) ? find(characters, Latin1Character { character }, start) : notFound;
}

template<typename T, typename Predicate>
    requires std::is_invocable_r_v<bool, Predicate, T>
inline size_t find(std::span<const T> characters, NOESCAPE const Predicate& matches, size_t start = 0)
{
    for (size_t i = start; i < characters.size(); ++i) {
        if (matches(characters[i]))
            return i;
    }
    return notFound;
}

template<typename T> ALWAYS_INLINE void copyElements(std::span<T> destination, std::span<const T> source)
{
    RELEASE_ASSERT(destination.size() >= source.size());
    Detail::copyBytes(destination.data(), source.data(), source.size_bytes());
}

inline void copyElements(std::span<char16_t> destination, std::span<const Latin1Character> source)
{
    RELEASE_ASSERT(destination.size() >= source.size());
    Detail::widen(destination.data(), source.data(), source.size());
}

inline void copyElements(std::span<uint16_t> destination, std::span<const uint8_t> source)
{
    copyElements(spanReinterpretCast<char16_t>(destination), byteCast<Latin1Character>(source));
}

// Keeps the low byte of each code unit.
inline void copyElements(std::span<Latin1Character> destination, std::span<const char16_t> source)
{
    RELEASE_ASSERT(destination.size() >= source.size());
    engine_text_narrow(destination.data(), source.data(), source.size());
}

}

using WTF::charactersAreAllASCII;
using WTF::find;
using WTF::makeLatin1CharacterBitSet;
using WTF::unsafeSpan;
