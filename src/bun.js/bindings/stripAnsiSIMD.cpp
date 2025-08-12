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
    return c == '[' || c == ']' || c == '(' || c == ')' || c == '#' || c == ';' || c == '?';
}

template<typename CharacterType>
static inline bool isOSCChar(const CharacterType c)
{
    // [-a-zA-Z\d\/#&.:=?%@~_]
    return c == '-' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '/' || c == '#' || c == '&' || c == '.' || c == ':' || c == '=' || c == '?' || c == '%' || c == '@' || c == '~' || c == '_';
}

template<typename CharacterType>
static inline bool isCSIFinalByte(const CharacterType c)
{
    // [\dA-PR-TZcf-nq-uy=><~]
    return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'P') || (c >= 'R' && c <= 'T') || c == 'Z' || (c >= 'c' && c <= 'n') || (c >= 'q' && c <= 'u') || c == 'y' || c == '=' || c == '>' || c == '<' || c == '~';
}

template<typename CharacterType>
static inline bool isDigit(const CharacterType c)
{
    return c >= '0' && c <= '9';
}

// Helper to parse CSI parameter digits
// Matches: \d{1,4}(?:;\d{0,4})*
template<typename CharacterType>
static const CharacterType* parseCSIParameters(const CharacterType* cursor, const CharacterType* const end)
{
    // Optional: \d{1,4}
    int digitCount = 0;
    while (cursor < end && isDigit(*cursor) && digitCount < 4) {
        cursor++;
        digitCount++;
    }

    // Optional: (?:;\d{0,4})*
    // But don't consume a semicolon unless it leads to valid content
    while (cursor < end && *cursor == ';') {
        const CharacterType* beforeSemi = cursor;
        cursor++; // tentatively consume semicolon
        
        // Consume optional digits after semicolon
        digitCount = 0;
        while (cursor < end && isDigit(*cursor) && digitCount < 4) {
            cursor++;
            digitCount++;
        }
        
        // Check if this position is valid for a CSI sequence to end
        // If not, backtrack to before the semicolon
        if (cursor >= end) {
            // At end - the last consumed char might be a valid final byte
            if (digitCount > 0 && isCSIFinalByte(*(cursor - 1))) {
                // Valid: ended with a digit that's also a final byte
                break;
            } else {
                // Invalid: ended with just semicolon or incomplete params
                cursor = beforeSemi;
                break;
            }
        }
        // If we have more content, continue the loop to process more semicolon groups
    }

    return cursor;
}

template<typename CharacterType>
static const CharacterType* matchAnsiRegex(const CharacterType* const start, const CharacterType* const end)
{
    const CharacterType* cursor = start;

    // Must start with ESC (0x1B) or C1 CSI (0x9B)
    if (cursor >= end || (*cursor != 0x1B && *cursor != 0x9B)) {
        return nullptr;
    }
    cursor++;

    // Skip optional prefix characters [[\]()#;?]*
    while (cursor < end && isPrefixChar(*cursor)) {
        cursor++;
    }

    // Now we have two possible patterns to match
    // The regex uses alternation (|) so either pattern can match
    // CSI pattern is often shorter, so regex engines typically try it first

    // Save position after prefix for both pattern attempts
    const CharacterType* const afterPrefix = cursor;

    // The regex alternation order matters: OSC pattern is listed first in the regex,
    // but CSI often matches first due to regex engine optimization
    // We need to try CSI first to match the actual behavior
    
    const CharacterType* pattern2End = nullptr;

    // Try Pattern 2: CSI sequences first
    // (?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])
    {
        // First check if we have an immediate CSI final byte (handles \x1b]0, \x1b[A, etc.)
        if (afterPrefix < end && isCSIFinalByte(*afterPrefix)) {
            // For digits, try to consume more to see if we get a longer match
            if (isDigit(*afterPrefix)) {
                const CharacterType* greedyCursor = parseCSIParameters(afterPrefix, end);
                if (greedyCursor < end && isCSIFinalByte(*greedyCursor)) {
                    // Found a longer match with parameters
                    pattern2End = greedyCursor + 1;
                } else if (greedyCursor > afterPrefix) {
                    // Consumed parameters but no final byte after - use all consumed
                    pattern2End = greedyCursor;
                } else {
                    // No parameters consumed, use the digit as final byte
                    pattern2End = afterPrefix + 1;
                }
            } else {
                // Non-digit final byte, match immediately
                pattern2End = afterPrefix + 1;
            }
        } else {
            // No immediate final byte, try parsing parameters
            const CharacterType* pattern2Cursor = parseCSIParameters(afterPrefix, end);
            
            if (pattern2Cursor < end && isCSIFinalByte(*pattern2Cursor)) {
                pattern2End = pattern2Cursor + 1;
            } else if (pattern2Cursor > afterPrefix) {
                // Consumed parameters but no final byte - use all consumed
                pattern2End = pattern2Cursor;
            }
        }
    }
    
    // Try Pattern 1: OSC-like sequences with terminators
    // (?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?(?:\u0007|\u001B\u005C|\u009C))
    const CharacterType* pattern1End = nullptr;
    {
        const CharacterType* pattern1Cursor = afterPrefix;

        // The OSC content is optional, but we need a terminator
        // Try to scan until we find a terminator or invalid character
        while (pattern1Cursor < end) {
            CharacterType ch = *pattern1Cursor;

            // Check for terminators
            if (ch == 0x07 || ch == 0x9C) { // BEL or String Terminator
                pattern1End = pattern1Cursor + 1;
                break;
            }
            if (ch == 0x1B && pattern1Cursor + 1 < end && pattern1Cursor[1] == '\\') { // ESC\
                pattern1End = pattern1Cursor + 2;
                break;
            }

            // Check if this is a valid OSC character or semicolon
            if (ch == ';' || isOSCChar(ch)) {
                pattern1Cursor++;
            } else {
                // Invalid character for OSC, this pattern fails
                break;
            }
        }
    }

    // Return the longer match (OSC is usually longer when both match)
    if (pattern1End && pattern2End) {
        size_t len1 = pattern1End - start;
        size_t len2 = pattern2End - start;
        return len1 > len2 ? pattern1End : pattern2End;
    }
    if (pattern2End) {
        return pattern2End;
    }
    if (pattern1End) {
        return pattern1End;
    }

    // Neither pattern matched
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
