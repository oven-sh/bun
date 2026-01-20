#pragma once

#include "root.h"
#include <wtf/SIMDHelpers.h>

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

} // namespace ANSI
} // namespace Bun
