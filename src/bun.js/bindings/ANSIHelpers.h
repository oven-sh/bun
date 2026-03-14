#pragma once

#include "root.h"
#include <wtf/SIMDHelpers.h>
#include <span>
#include <unicode/utf16.h>

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

// SIMD comparison against exact escape character values. Used to refine
// the broad range match (0x10-0x1F / 0x90-0x9F) to only actual escape
// introducers: 0x1B, 0x90, 0x98, 0x9B, 0x9D, 0x9E, 0x9F. Also includes 0x9C
// (C1 ST — a terminator, not an introducer) so callers tokenizing ANSI by
// skipping to the next interesting byte will stop at standalone ST too.
template<typename SIMDType>
static auto exactEscapeMatch(std::conditional_t<sizeof(SIMDType) == 1, simde_uint8x16_t, simde_uint16x8_t> chunk)
{
    if constexpr (sizeof(SIMDType) == 1)
        return SIMD::equal<0x1b, 0x90, 0x98, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f>(chunk);
    else
        return SIMD::equal<u'\x1b', u'\x90', u'\x98', u'\x9b', u'\x9c', u'\x9d', u'\x9e', u'\x9f'>(chunk);
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
        if (SIMD::findFirstNonZeroIndex(chunkIsEsc)) {
            // Broad mask matched 0x10-0x1F / 0x90-0x9F. Refine with exact
            // escape character comparison to filter out false positives.
            const auto exactMatch = exactEscapeMatch<SIMDType>(chunk);
            if (const auto exactIndex = SIMD::findFirstNonZeroIndex(exactMatch))
                return it + *exactIndex;
        }
    }

    // Check remaining characters (include 0x9c to match SIMD behavior)
    for (; it != end; ++it) {
        if (isEscapeCharacter(*it) || *it == 0x9c)
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
// UTF-16 surrogate pair decoding — thin wrapper over ICU's U16_NEXT
// ============================================================================
static inline char32_t decodeUTF16(const UChar* p, size_t available, size_t& outLen)
{
    size_t i = 0;
    char32_t cp;
    U16_NEXT(p, i, available, cp);
    outLen = i;
    return cp;
}

// ============================================================================
// SIMD: index of first code unit NOT in [0x20, 0x7E] (or span.size() if none)
// ============================================================================
// Range check via wrapping subtract + unsigned compare:
//   c in [0x20, 0x7E]  <=>  (c - 0x20) <= 0x5E unsigned
// Any lane with (c - 0x20) > 0x5E is out of range.
//
// Returns an index rather than a bool so callers can:
//   1. Take a fast path if the whole string qualifies (index == size)
//   2. Take a fast path if the requested operation lies inside the prefix
//   3. Fast-forward past the proven-ASCII prefix without re-checking each byte
//
// Lane = uint8_t for Latin-1, uint16_t for UTF-16.
template<typename Lane>
static size_t firstNonAsciiPrintable(std::span<const Lane> input)
{
    static_assert(sizeof(Lane) == 1 || sizeof(Lane) == 2);
    constexpr size_t stride = SIMD::stride<Lane>;
    const auto v20 = SIMD::splat<Lane>(static_cast<Lane>(0x20));
    const auto v5E = SIMD::splat<Lane>(static_cast<Lane>(0x5E));
    const Lane* const data = input.data();
    const Lane* const end = data + input.size();
    const Lane* it = data;
    for (; static_cast<size_t>(end - it) >= stride; it += stride) {
        auto chunk = SIMD::load(it);
        auto shifted = SIMD::sub(chunk, v20);
        auto oob = SIMD::greaterThan(shifted, v5E);
        if (auto idx = SIMD::findFirstNonZeroIndex(oob))
            return static_cast<size_t>(it - data) + *idx;
    }
    for (; it != end; ++it) {
        Lane c = *it;
        if (static_cast<Lane>(c - 0x20) > 0x5E)
            return static_cast<size_t>(it - data);
    }
    return input.size();
}

// ============================================================================
// SGR (Select Graphic Rendition) open → close code mapping
// ============================================================================
// Shared by sliceAnsi and wrapAnsi for ANSI style tracking across boundaries.
// Returns the SGR reset code for a given open code, or 0 if unknown.
static inline uint32_t sgrCloseCode(uint32_t openCode)
{
    // Densely-packed case ranges — LLVM lowers this to a jump table.
    switch (openCode) {
    case 1:
    case 2:
        return 22; // bold, dim
    case 3:
        return 23; // italic
    case 4:
        return 24; // underline
    case 5:
    case 6:
        return 25; // blink
    case 7:
        return 27; // inverse
    case 8:
        return 28; // hidden
    case 9:
        return 29; // strikethrough
    // Foreground colors (basic + extended + bright)
    case 30:
    case 31:
    case 32:
    case 33:
    case 34:
    case 35:
    case 36:
    case 37:
    case 38: // 256/truecolor foreground introducer
    case 90:
    case 91:
    case 92:
    case 93:
    case 94:
    case 95:
    case 96:
    case 97:
        return 39;
    // Background colors (basic + extended + bright)
    case 40:
    case 41:
    case 42:
    case 43:
    case 44:
    case 45:
    case 46:
    case 47:
    case 48: // 256/truecolor background introducer
    case 100:
    case 101:
    case 102:
    case 103:
    case 104:
    case 105:
    case 106:
    case 107:
        return 49;
    case 53:
        return 55; // overline
    default:
        return 0; // Unknown → caller uses full reset
    }
}

static inline bool isSgrEndCode(uint32_t code)
{
    switch (code) {
    case 0:
    case 22:
    case 23:
    case 24:
    case 25:
    case 27:
    case 28:
    case 29:
    case 39:
    case 49:
    case 55:
        return true;
    default:
        return false;
    }
}

} // namespace ANSI
} // namespace Bun
