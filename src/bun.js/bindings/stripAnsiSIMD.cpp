#include "root.h"
#include "stripAnsiSIMD.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/SIMDHelpers.h>

namespace Bun {
using namespace WTF;

// Regex pattern from ansi-regex:
// The pattern has two main alternatives after the prefix:
// 1. OSC-style: (?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?ST
//    where ST = (?:\u0007|\u001B\u005C|\u009C)
// 2. CSI-style: (?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]

// Add back the OSC payload char class exactly as ansi-regex expects:
// [-a-zA-Z\d\/#&.:=?%@~_]
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
static inline bool isOSCChar(const CharacterType c)
{
    return c == '-' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '/' || c == '#' || c == '&' || c == '.' || c == ':' || c == '=' || c == '?' || c == '%' || c == '@' || c == '~' || c == '_';
}

template<typename CharacterType>
static inline bool isStringTerminator(const CharacterType c)
{
    return c == static_cast<CharacterType>(0x07) || c == static_cast<CharacterType>(0x9C);
}

template<typename CharacterType>
static inline bool isCSIFinalByte(const CharacterType c)
{
    return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'P') || (c >= 'R' && c <= 'T') || c == 'Z' || (c >= 'c' && c <= 'n') || (c >= 'q' && c <= 'u') || c == 'y' || c == '=' || c == '>' || c == '<' || c == '~';
}

template<typename CharacterType>
static inline bool isAlphaNumeric(const CharacterType c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
}

template<typename CharacterType>
static inline bool isDigit(const CharacterType c) { return c >= '0' && c <= '9'; }

template<typename CharacterType>
static inline bool oscPayloadMatches(const CharacterType* s, const CharacterType* e)
{
    // Form B: [a-zA-Z\d]+ ( ; [-…]* )*
    const CharacterType* p = s;
    if (p < e && isAlphaNumeric(*p)) {
        do {
            ++p;
        } while (p < e && isAlphaNumeric(*p));
        while (p < e && *p == static_cast<CharacterType>(';')) {
            ++p;
            while (p < e && isOSCChar(*p))
                ++p; // *
        }
        if (p == e) return true;
    }
    // Form A: ( ; [-…]+ )*
    p = s;
    while (p < e) {
        if (*p != static_cast<CharacterType>(';')) return false;
        ++p;
        if (p >= e || !isOSCChar(*p)) return false; // '+'
        do {
            ++p;
        } while (p < e && isOSCChar(*p));
    }
    return p == e;
}

template<typename CharacterType>
static const CharacterType* matchAnsiRegex(const CharacterType* const start, const CharacterType* const end)
{
    const CharacterType* p = start;
    if (p >= end || (*p != static_cast<CharacterType>(0x1B) && *p != static_cast<CharacterType>(0x9B)))
        return nullptr;

    const CharacterType escChar = *p;
    ++p;

    // For C1 CSI (0x9B), we start CSI parsing immediately
    if (escChar == static_cast<CharacterType>(0x9B)) {
        // CSI pattern: (?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])
        const CharacterType* q = p;
        const CharacterType* lastGood = nullptr;

        // zero-digits candidate - check if we can match a final byte immediately
        if (q < end && isCSIFinalByte(*q)) {
            lastGood = q;
        }

        // \d{1,4}
        int d = 0;
        while (q < end && isDigit(*q) && d < 4) {
            ++q;
            ++d;
            if (q < end && isCSIFinalByte(*q))
                lastGood = q;
        }

        // (;\d{0,4})*
        while (q < end && *q == static_cast<CharacterType>(';')) {
            ++q;
            if (q < end && isCSIFinalByte(*q))
                lastGood = q; // zero digits in this group
            int k = 0;
            while (q < end && isDigit(*q) && k < 4) {
                ++q;
                ++k;
                if (q < end && isCSIFinalByte(*q))
                    lastGood = q;
            }
        }

        if (lastGood)
            return lastGood + 1;
        return nullptr;
    }

    // For ESC (0x1B), we need to check what follows
    if (p >= end)
        return nullptr;

    // Check for CSI introducer '['
    if (*p == '[') {
        ++p;

        // Skip any private parameters (like ? ! > < =)
        while (p < end && (*p == '?' || *p == '!' || *p == '>' || *p == '<' || *p == '=')) {
            ++p;
        }

        // CSI pattern: (?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])
        const CharacterType* q = p;
        const CharacterType* lastGood = nullptr;

        // zero-digits candidate - check if we can match a final byte immediately
        if (q < end && isCSIFinalByte(*q)) {
            lastGood = q;
        }

        // \d{1,4}
        int d = 0;
        while (q < end && isDigit(*q) && d < 4) {
            ++q;
            ++d;
            if (q < end && isCSIFinalByte(*q))
                lastGood = q;
        }

        // (;\d{0,4})*
        while (q < end && *q == static_cast<CharacterType>(';')) {
            ++q;
            if (q < end && isCSIFinalByte(*q))
                lastGood = q; // zero digits in this group
            int k = 0;
            while (q < end && isDigit(*q) && k < 4) {
                ++q;
                ++k;
                if (q < end && isCSIFinalByte(*q))
                    lastGood = q;
            }
        }

        if (lastGood)
            return lastGood + 1;
    }

    // Check for OSC introducer ']'
    else if (*p == ']') {
        ++p;

        // Try incremental OSC payload validation
        const CharacterType* q = p;

        // First, find the terminator
        const CharacterType* terminator = nullptr;
        size_t terminatorLength = 0;
        while (q < end) {
            if (isStringTerminator(*q)) {
                terminator = q;
                terminatorLength = 1;
                break;
            }
            if (*q == static_cast<CharacterType>(0x1B) && q + 1 < end && q[1] == static_cast<CharacterType>('\\')) {
                terminator = q;
                terminatorLength = 2;
                break;
            }
            ++q;
        }

        if (terminator) {
            // Check for digit + semicolon quirk first
            if (p < terminator && isDigit(*p) && (p + 1) < terminator && p[1] == static_cast<CharacterType>(';')) {
                // strip-ansi quirk: prefer CSI for digit+semicolon pattern - don't handle as OSC
                // Let it fall through to other handling
            } else {
                // Incrementally validate the payload - consume until we hit invalid character
                const CharacterType* validEnd = p;

                // Form B: [a-zA-Z\d]+ ( ; [-…]* )*
                if (validEnd < terminator && isAlphaNumeric(*validEnd)) {
                    // Consume initial alphanumeric characters
                    while (validEnd < terminator && isAlphaNumeric(*validEnd))
                        ++validEnd;

                    // Consume (';' + OSC chars)*
                    while (validEnd < terminator && *validEnd == static_cast<CharacterType>(';')) {
                        ++validEnd;
                        while (validEnd < terminator && isOSCChar(*validEnd))
                            ++validEnd;
                    }

                    // If we consumed everything, it's a valid payload
                    if (validEnd == terminator) {
                        return terminator + terminatorLength;
                    }
                    // Otherwise, we consumed a partial valid prefix
                    return validEnd;
                }

                // Form A: ( ; [-…]+ )*
                validEnd = p;
                while (validEnd < terminator && *validEnd == static_cast<CharacterType>(';')) {
                    ++validEnd;
                    if (validEnd >= terminator || !isOSCChar(*validEnd)) break;
                    while (validEnd < terminator && isOSCChar(*validEnd))
                        ++validEnd;
                }

                if (validEnd == terminator) {
                    return terminator + terminatorLength;
                }

                // No valid pattern matched - consume just ESC] and return
                return p;
            }
        } else {
            // No terminator found - consume everything (incomplete OSC)
            return end;
        }
    }

    // Handle other escape sequences - single character escapes like \e(B, \e=, etc.
    else {
        // Single character escape sequences
        if (p < end) {
            CharacterType c = *p;
            // Check for common single-character escape sequences
            if (c == '(' || c == ')' || c == '*' || c == '+' || c == '=' || c == '>' || c == 'D' || c == 'E' || c == 'H' || c == 'M' || c == '7' || c == '8' || c == '#' || c == '%') {
                // For sequences like \e(B, \e)B, etc., consume one more character if present
                if ((c == '(' || c == ')' || c == '*' || c == '+' || c == '#' || c == '%') && (p + 1) < end) {
                    return p + 2; // ESC + char + next char
                } else {
                    return p + 1; // ESC + char
                }
            }
        }

        // If not a single-char escape, try prefix parsing for complex sequences
        // Consume prefix characters: []\()#;?
        while (p < end && (*p == '[' || *p == ']' || *p == '(' || *p == ')' || *p == '#' || *p == ';' || *p == '?'))
            ++p;

        const CharacterType* const afterPrefix = p;

        // Try CSI pattern after prefix
        {
            const CharacterType* q = afterPrefix;
            const CharacterType* lastGood = nullptr;

            // zero-digits candidate
            if (q < end && isCSIFinalByte(*q)) {
                lastGood = q;
            }

            // \d{1,4}
            int d = 0;
            while (q < end && isDigit(*q) && d < 4) {
                ++q;
                ++d;
                if (q < end && isCSIFinalByte(*q))
                    lastGood = q;
            }

            // (;\d{0,4})*
            while (q < end && *q == static_cast<CharacterType>(';')) {
                ++q;
                if (q < end && isCSIFinalByte(*q))
                    lastGood = q; // zero digits in this group
                int k = 0;
                while (q < end && isDigit(*q) && k < 4) {
                    ++q;
                    ++k;
                    if (q < end && isCSIFinalByte(*q))
                        lastGood = q;
                }
            }

            if (lastGood)
                return lastGood + 1;
        }

        // Try OSC pattern after prefix
        {
            const CharacterType* q = afterPrefix;
            while (q < end) {
                // BEL or ST (0x9C)
                if (isStringTerminator(*q)) {
                    if (q == afterPrefix || oscPayloadMatches(afterPrefix, q))
                        return q + 1;
                    break;
                }
                // ESC \ terminator
                if (*q == static_cast<CharacterType>(0x1B)) {
                    if (q + 1 < end && q[1] == static_cast<CharacterType>('\\')) {
                        // strip-ansi quirk: if payload starts with digit and then ';', prefer CSI (do NOT consume as OSC)
                        if (!(afterPrefix < q && isDigit(*afterPrefix) && (afterPrefix + 1) < q && afterPrefix[1] == static_cast<CharacterType>(';'))) {
                            if (q == afterPrefix || oscPayloadMatches(afterPrefix, q))
                                return q + 2;
                        }
                        break;
                    }
                }
                ++q;
            }
        }
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
