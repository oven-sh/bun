#pragma once

#include "root.h"
#include <wtf/SIMDHelpers.h>

// Zig exports for visible width calculation
extern "C" size_t Bun__visibleWidthExcludeANSI_utf16(const uint16_t* ptr, size_t len, bool ambiguous_as_wide);
extern "C" size_t Bun__visibleWidthExcludeANSI_latin1(const uint8_t* ptr, size_t len);
extern "C" uint8_t Bun__codepointWidth(uint32_t cp, bool ambiguous_as_wide);

namespace Bun {
namespace ANSI {

// Check if a character is an ANSI escape sequence introducer
template<typename Char>
static inline bool isEscapeCharacter(Char c)
{
    switch (c) {
    case 0x1b: // ESC - escape
    case 0x9b: // CSI - control sequence introducer
    case 0x9d: // OSC - operating system command
    case 0x90: // DCS - device control string
    case 0x98: // SOS - start of string
    case 0x9e: // PM - privacy message
    case 0x9f: // APC - application program command
        return true;
    default:
        return false;
    }
}

// Find the first escape character in a string using SIMD
template<typename Char>
static const Char* findEscapeCharacter(const Char* start, const Char* end)
{
    static_assert(sizeof(Char) == 1 || sizeof(Char) == 2);
    using SIMDType = std::conditional_t<sizeof(Char) == 1, uint8_t, uint16_t>;

    constexpr size_t stride = SIMD::stride<SIMDType>;
    // Matches 0x10-0x1f and 0x90-0x9f. These characters have a high
    // probability of being escape characters.
    constexpr auto escMask = SIMD::splat<SIMDType>(static_cast<SIMDType>(~0b10001111U));
    constexpr auto escVector = SIMD::splat<SIMDType>(0b00010000);

    auto it = start;
    // Search for escape sequences using SIMD
    for (; end - it >= static_cast<ptrdiff_t>(stride); it += stride) {
        const auto chunk = SIMD::load(reinterpret_cast<const SIMDType*>(it));
        const auto chunkMasked = SIMD::bitAnd(chunk, escMask);
        const auto chunkIsEsc = SIMD::equal(chunkMasked, escVector);
        if (const auto index = SIMD::findFirstNonZeroIndex(chunkIsEsc))
            return it + *index;
    }

    // Check remaining characters
    for (; it != end; ++it) {
        if (isEscapeCharacter(*it))
            return it;
    }
    return nullptr;
}

// Consume an ANSI escape sequence that starts at `start`. Returns a pointer to
// the first byte immediately following the escape sequence.
//
// If the ANSI escape sequence is immediately followed by another escape
// sequence, this function will consume that one as well, and so on.
template<typename Char>
static const Char* consumeANSI(const Char* start, const Char* end)
{
    enum class State {
        start,
        gotEsc,
        ignoreNextChar,
        inCsi,
        inOsc,
        inOscGotEsc,
        needSt,
        needStGotEsc,
    };

    auto state = State::start;
    for (auto it = start; it != end; ++it) {
        const auto c = *it;
        switch (state) {
        case State::start:
            switch (c) {
            case 0x1b:
                state = State::gotEsc;
                break;
            case 0x9b:
                state = State::inCsi;
                break;
            case 0x9d:
                state = State::inOsc;
                break;
            // Other sequences terminated by ST, from ECMA-48, 5th ed.
            case 0x90: // device control string
            case 0x98: // start of string
            case 0x9e: // privacy message
            case 0x9f: // application program command
                state = State::needSt;
                break;
            default:
                return it;
            }
            break;

        case State::gotEsc:
            switch (c) {
            case '[':
                state = State::inCsi;
                break;
            // Two-byte XTerm sequences
            // https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
            case ' ':
            case '#':
            case '%':
            case '(':
            case ')':
            case '*':
            case '+':
            case '.':
            case '/':
                state = State::ignoreNextChar;
                break;
            case ']':
                state = State::inOsc;
                break;
            // Other sequences terminated by ST, from ECMA-48, 5th ed.
            case 'P': // device control string
            case 'X': // start of string
            case '^': // privacy message
            case '_': // application program command
                state = State::needSt;
                break;
            default:
                // Otherwise, assume this is a one-byte sequence
                state = State::start;
            }
            break;

        case State::ignoreNextChar:
            state = State::start;
            break;

        case State::inCsi:
            // ECMA-48, 5th ed. §5.4 d)
            if (c >= 0x40 && c <= 0x7e)
                state = State::start;
            break;

        case State::inOsc:
            switch (c) {
            case 0x1b:
                state = State::inOscGotEsc;
                break;
            case 0x9c: // ST
            case 0x07: // XTerm can also end OSC with 0x07
                state = State::start;
                break;
            }
            break;

        case State::inOscGotEsc:
            if (c == '\\')
                state = State::start;
            else
                state = State::inOsc;
            break;

        case State::needSt:
            switch (c) {
            case 0x1b:
                state = State::needStGotEsc;
                break;
            case 0x9c:
                state = State::start;
                break;
            }
            break;

        case State::needStGotEsc:
            if (c == '\\')
                state = State::start;
            else
                state = State::needSt;
            break;
        }
    }
    return end;
}

// ============================================================================
// Shared character decoding and width utilities
// ============================================================================

// Decode a single UTF-16 code unit (or surrogate pair) into a codepoint.
static inline char32_t decodeUTF16(const UChar* ptr, size_t available, size_t& outLen)
{
    UChar c = ptr[0];
    if (c >= 0xD800 && c <= 0xDBFF && available >= 2) {
        UChar c2 = ptr[1];
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
            outLen = 2;
            return 0x10000 + (((c - 0xD800) << 10) | (c2 - 0xDC00));
        }
    }
    outLen = 1;
    return static_cast<char32_t>(c);
}

// Get the terminal display width of a single codepoint.
static inline uint8_t codepointWidth(char32_t cp, bool ambiguousAsWide)
{
    return Bun__codepointWidth(cp, ambiguousAsWide);
}

// Get the visible width of a string, excluding ANSI escape codes.
template<typename Char>
static size_t stringWidth(const Char* start, size_t len, bool ambiguousAsWide = false)
{
    if (len == 0)
        return 0;
    if constexpr (sizeof(Char) == 1) {
        (void)ambiguousAsWide;
        return Bun__visibleWidthExcludeANSI_latin1(reinterpret_cast<const uint8_t*>(start), len);
    } else {
        return Bun__visibleWidthExcludeANSI_utf16(reinterpret_cast<const uint16_t*>(start), len, ambiguousAsWide);
    }
}

// Advance past one character (handling surrogate pairs for UTF-16).
template<typename Char>
static inline size_t charLength(const Char* it, const Char* end)
{
    if constexpr (sizeof(Char) == 1) {
        return 1;
    } else {
        if (*it >= 0xD800 && *it <= 0xDBFF && (end - it) >= 2 && it[1] >= 0xDC00 && it[1] <= 0xDFFF)
            return 2;
        return 1;
    }
}

// Decode a character and get its codepoint + length.
template<typename Char>
static inline char32_t decodeChar(const Char* it, const Char* end, size_t& outLen)
{
    if constexpr (sizeof(Char) == 1) {
        outLen = 1;
        return static_cast<char32_t>(static_cast<uint8_t>(*it));
    } else {
        return decodeUTF16(it, end - it, outLen);
    }
}

} // namespace ANSI
} // namespace Bun
