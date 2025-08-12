#include "root.h"
#include "stripAnsiSIMD.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/SIMDHelpers.h>

namespace Bun {
using namespace WTF;

// Regex pattern from ansi-regex:
// [\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?(?:\u0007|\u001B\u005C|\u009C))|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))

template<typename CharacterType>
static inline bool isPrefixChar(const CharacterType c)
{
    // [[\]()#;?]*
    switch (c) {
    case '[':
    case ']':
    case '(':
    case ')':
    case '#':
    case ';':
    case '?':
        return true;
    default:
        return false;
    }
}

// Add back the OSC payload char class exactly as ansi-regex expects:
// [-a-zA-Z\d\/#&.:=?%@~_]
template<typename CharacterType>
static inline bool isOSCChar(const CharacterType c)
{
    return c == '-' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '/' || c == '#' || c == '&' || c == '.' || c == ':' || c == '=' || c == '?' || c == '%' || c == '@' || c == '~' || c == '_';
}

template<typename CharacterType>
static inline bool isStringTerminator(const CharacterType c)
{
    // BEL (0x07) or C1 ST (0x9C)
    return c == static_cast<CharacterType>(0x07) || c == static_cast<CharacterType>(0x9C);
}

template<typename CharacterType>
static inline bool isCSIFinalByte(const CharacterType c)
{
    // [\dA-PR-TZcf-nq-uy=><~]
    return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'P') || (c >= 'R' && c <= 'T') || c == 'Z' || (c >= 'c' && c <= 'n') || (c >= 'q' && c <= 'u') || c == 'y' || c == '=' || c == '>' || c == '<' || c == '~';
}

template<typename CharacterType>
static inline bool isAlphaNumeric(const CharacterType c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

template<typename CharacterType>
static inline bool isDigit(const CharacterType c)
{
    return c >= '0' && c <= '9';
}

template<typename CharacterType>
static const CharacterType* matchAnsiRegex(const CharacterType* const start, const CharacterType* const end)
{
    const CharacterType* p = start;

    // Must start with ESC (0x1B) or C1 CSI (0x9B)
    if (p >= end || (*p != static_cast<CharacterType>(0x1B) && *p != static_cast<CharacterType>(0x9B)))
        return nullptr;

    ++p;

    // Consume prefix: [[\]()#;?]*
    while (p < end && isPrefixChar(*p))
        ++p;

    const CharacterType* afterPrefix = p;

    // ---- Alternative 1: OSC-style with strict payload and required terminator ----
    // Structure:
    //    ( ( ; [oscChars]+ )* | ( [a-zA-Z\d]+ ( ; [oscChars]* )* ) )?  ( BEL | ESC\ | 0x9C )
    {
        const CharacterType* q = afterPrefix;

        // Immediate terminator allowed (empty payload)
        if (q < end) {
            if (isStringTerminator(*q))
                return q + 1;
            if (*q == static_cast<CharacterType>(0x1B) && q + 1 < end && q[1] == static_cast<CharacterType>('\\'))
                return q + 2; // ESC
        }

        // Try branch B: [a-zA-Z\d]+ ( ; [oscChars]* )*
        if (q < end && isAlphaNumeric(*q)) {
            do {
                ++q;
            } while (q < end && isAlphaNumeric(*q));
            while (q < end && *q == static_cast<CharacterType>(';')) {
                ++q; // ';'
                while (q < end && isOSCChar(*q))
                    ++q; // zero-or-more osc chars
            }
            if (q < end) {
                if (isStringTerminator(*q))
                    return q + 1;
                if (*q == static_cast<CharacterType>(0x1B) && q + 1 < end && q[1] == static_cast<CharacterType>('\\'))
                    return q + 2; // ESC
            }
        }

        // Try branch A: ( ; [oscChars]+ )*
        q = afterPrefix;
        bool sawAnyGroup = false;
        while (q < end && *q == static_cast<CharacterType>(';')) {
            const CharacterType* groupStart = q; // at ';'
            ++q; // consume ';'
            const CharacterType* before = q;
            while (q < end && isOSCChar(*q))
                ++q; // require at least one char
            if (q == before) {
                // This branch requires '+' after ';' — zero length breaks the branch.
                // Rewind to before this ';' and stop trying branch A.
                q = groupStart;
                break;
            }
            sawAnyGroup = true;
        }
        if (sawAnyGroup && q < end) {
            if (isStringTerminator(*q))
                return q + 1;
            if (*q == static_cast<CharacterType>(0x1B) && q + 1 < end && q[1] == static_cast<CharacterType>('\\'))
                return q + 2; // ESC
        }
        // If OSC payload doesn't satisfy the strict class or lacks a terminator, alt 1 fails.
    }

    // ---- Alternative 2: CSI/other with greedy optional digits and backtracking ----
    // (?:(?:\d{1,4}(?:;\d{0,4})*)? [\dA-PR-TZcf-nq-uy=><~])
    {
        const CharacterType* q = afterPrefix;

        // If next is a digit, try the greedy "digits present" path first (like JS regex does)
        if (q < end && isDigit(*q)) {
            const CharacterType* lastDigit = nullptr;

            // \d{1,4}
            int dcount = 0;
            while (q < end && isDigit(*q) && dcount < 4) {
                lastDigit = q;
                ++q;
                ++dcount;
            }
            // (;\d{0,4})*
            while (q < end && *q == static_cast<CharacterType>(';')) {
                ++q; // ';'
                int k = 0;
                while (q < end && isDigit(*q) && k < 4) {
                    lastDigit = q;
                    ++q;
                    ++k;
                }
            }

            // Prefer final byte immediately after the digits block
            if (q < end && isCSIFinalByte(*q))
                return q + 1;

            // Backtrack: the last digit might be a CSI final byte
            // This happens when we have patterns like \x1b]52;c where 'c' should be the final byte
            // but was consumed as part of the parameter
            if (lastDigit && isCSIFinalByte(*lastDigit))
                return lastDigit + 1;

            // Fall through to "no-digits" variant if something odd happened
        }

        // No digits present: final byte must be the very next char
        if (q < end && isCSIFinalByte(*q))
            return q + 1;
    }

    return nullptr;
}

template<typename CharacterType>
static inline bool isEscapeCharacter(const CharacterType c)
{
    return c == 0x1B || c == 0x9B;
}

// Helper to find ESC or CSI using SIMD
template<typename CharacterType, typename SIMDType = std::conditional_t<sizeof(CharacterType) == 1, uint8_t, uint16_t>>
static const CharacterType* findEscapeCharacter(const CharacterType* const start, const CharacterType* const end)
{
    constexpr size_t stride = SIMD::stride<SIMDType>;
    const auto escVector = SIMD::splat<SIMDType>(0x1B);
    const auto csiVector = SIMD::splat<SIMDType>(0x9B);

    const CharacterType* searchStart = start;

    // SIMD search in chunks
    while (searchStart + stride <= end) {
        const auto chunk = SIMD::load(reinterpret_cast<const SIMDType*>(searchStart));
        const auto escMask = SIMD::equal(chunk, escVector);
        const auto csiMask = SIMD::equal(chunk, csiVector);
        const auto combinedMask = SIMD::bitOr(escMask, csiMask);

        if (SIMD::isNonZero(combinedMask)) {
            // Found ESC or CSI in this chunk, find exact position
            for (size_t i = 0; i < stride && searchStart + i < end; i++) {
                if (isEscapeCharacter<CharacterType>(searchStart[i])) {
                    return searchStart + i;
                }
            }
        }
        searchStart += stride;
    }

    // Check remaining bytes/characters
    while (searchStart < end) {
        if (isEscapeCharacter<CharacterType>(*searchStart)) {
            return searchStart;
        }
        searchStart++;
    }

    return nullptr;
}

template<typename CharacterType>
static WTF::String stripAnsiSIMD(const std::span<const CharacterType> input, bool& hasAnsiSequences)
{
    if (input.empty()) {
        hasAnsiSequences = false;
        return String();
    }

    const CharacterType* const __restrict data = input.data();
    const CharacterType* cursor = data;
    const CharacterType* const end = data + input.size();

    StringBuilder result;
    bool foundValidAnsi = false;

    while (cursor < end) {
        // Find next ESC (0x1B) or C1 CSI (0x9B) character using SIMD
        const CharacterType* escPos = findEscapeCharacter(cursor, end);

        // If no ESC/CSI found
        if (!escPos) {
            // If we haven't found any valid ANSI sequences, return original
            if (!foundValidAnsi) {
                hasAnsiSequences = false;
                return String(); // Signal to use original
            }
            // Otherwise append the rest
            if (end > cursor) {
                result.append(std::span<const CharacterType>(cursor, end - cursor));
            }
            break;
        }

        // Lazily reserve capacity on first ESC found
        if (result.isEmpty()) {
            result.reserveCapacity(input.size());
        }

        // Append everything before the ESC/CSI
        if (escPos > cursor) {
            result.append(std::span<const CharacterType>(cursor, escPos - cursor));
        }

        // Try to match the ansi-regex pattern
        const CharacterType* matchEnd = matchAnsiRegex(escPos, end);

        if (matchEnd) {
            // Successfully matched an ANSI sequence, skip it
            foundValidAnsi = true;
            cursor = matchEnd;
        } else {
            // Not a valid ANSI sequence, keep the ESC character
            result.append(*escPos);
            cursor = escPos + 1;
        }
    }

    hasAnsiSequences = foundValidAnsi;
    return result.toString();
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunStripANSI, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue input = callFrame->argument(0);

    // Convert to JSString to get the view
    JSC::JSString* jsString = input.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Get StringView to avoid joining sliced strings
    auto view = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (view->isEmpty()) {
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    }

    bool hasAnsiSequences = false;
    WTF::String result;

    if (view->is8Bit()) {
        result = stripAnsiSIMD<LChar>(view->span8(), hasAnsiSequences);
    } else {
        result = stripAnsiSIMD<UChar>(view->span16(), hasAnsiSequences);
    }

    // If no ANSI sequences were found, return the original string
    if (!hasAnsiSequences) {
        return JSC::JSValue::encode(jsString);
    }

    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

}
