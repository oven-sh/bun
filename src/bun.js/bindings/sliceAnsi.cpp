#include "root.h"
#include "sliceAnsi.h"
#include "ANSIHelpers.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/Vector.h>

// Zig exports for visible width and grapheme break
extern "C" uint8_t Bun__codepointWidth(uint32_t cp, bool ambiguous_as_wide);
extern "C" bool Bun__graphemeBreak(uint32_t cp1, uint32_t cp2, uint8_t* state);
extern "C" bool Bun__isEmojiPresentation(uint32_t cp);

namespace Bun {
using namespace WTF;

// ============================================================================
// UTF-16 Decoding
// ============================================================================

static char32_t decodeUTF16Pair(const UChar* ptr, size_t available, size_t& outLen)
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

// ============================================================================
// Grapheme-aware Visible Width (matching visible.zig GraphemeState)
// ============================================================================

struct GraphemeWidthState {
    uint32_t firstCp = 0;
    uint32_t lastCp = 0;
    uint16_t nonEmojiWidth = 0;
    uint8_t baseWidth = 0;
    uint8_t count = 0;
    bool emojiBase = false;
    bool keycap = false;
    bool regionalIndicator = false;
    bool skinTone = false;
    bool zwj = false;
    bool vs15 = false;
    bool vs16 = false;

    void reset(uint32_t cp, bool ambiguousIsWide)
    {
        firstCp = cp;
        lastCp = cp;
        count = 1;
        keycap = (cp == 0x20E3);
        regionalIndicator = (cp >= 0x1F1E6 && cp <= 0x1F1FF);
        skinTone = (cp >= 0x1F3FB && cp <= 0x1F3FF);
        zwj = (cp == 0x200D);
        vs15 = false;
        vs16 = false;

        uint8_t w = Bun__codepointWidth(cp, ambiguousIsWide);
        baseWidth = w;
        nonEmojiWidth = w;
        emojiBase = Bun__isEmojiPresentation(cp);
    }

    void add(uint32_t cp, bool ambiguousIsWide)
    {
        lastCp = cp;
        if (count < 255)
            count++;
        keycap = keycap || (cp == 0x20E3);
        regionalIndicator = regionalIndicator || (cp >= 0x1F1E6 && cp <= 0x1F1FF);
        skinTone = skinTone || (cp >= 0x1F3FB && cp <= 0x1F3FF);
        zwj = zwj || (cp == 0x200D);
        vs15 = vs15 || (cp == 0xFE0E);
        vs16 = vs16 || (cp == 0xFE0F);

        uint8_t w = Bun__codepointWidth(cp, ambiguousIsWide);
        if (w > 0) {
            uint16_t newWidth = nonEmojiWidth + w;
            nonEmojiWidth = newWidth < 1023 ? newWidth : 1023;
        }
    }

    uint8_t width() const
    {
        if (count == 0)
            return 0;
        if (regionalIndicator && count >= 2)
            return 2;
        if (keycap)
            return 2;
        if (regionalIndicator)
            return 1;
        if (emojiBase && (skinTone || zwj))
            return 2;
        if (vs15 || vs16) {
            if (baseWidth == 2)
                return 2;
            if (vs16) {
                if ((firstCp >= 0x30 && firstCp <= 0x39) || firstCp == 0x23 || firstCp == 0x2A)
                    return 1;
                if (firstCp < 0x80)
                    return 1;
                return 2;
            }
            return 1;
        }
        return nonEmojiWidth > 255 ? 255 : static_cast<uint8_t>(nonEmojiWidth);
    }
};

// ============================================================================
// ANSI Code Tracking
//
// We store complete ANSI escape sequences as opaque units. When we encounter
// a "close" or "reset" sequence, we remove the corresponding "open" sequences.
// This avoids complex parsing of multi-parameter SGR codes.
// ============================================================================

struct AnsiCodeEntry {
    Vector<UChar, 16> sequence;
};

struct AnsiStyleState {
    Vector<AnsiCodeEntry> activeCodes;

    // Record an ANSI escape sequence seen before the slice start.
    // We track it so we can re-emit active styles at the slice boundary.
    template<typename Char>
    void recordEscape(const Char* start, const Char* end)
    {
        ptrdiff_t len = end - start;
        if (len < 2)
            return;

        // Determine if this is a CSI sequence
        const Char* it = start;
        bool isCsi = false;

        if (*it == 0x1b && len >= 3 && *(it + 1) == '[') {
            isCsi = true;
            it += 2;
        } else if (*it == 0x9b) {
            isCsi = true;
            it += 1;
        }

        if (isCsi) {
            // Find the final byte
            const Char* paramStart = it;
            while (it < end && !(*it >= 0x40 && *it <= 0x7e))
                ++it;
            if (it >= end)
                return;

            if (*it == 'm') {
                // SGR sequence - apply reduce/filter logic
                uint32_t firstParam = 0;
                bool hasParam = false;
                for (const Char* p = paramStart; p < it; ++p) {
                    if (*p >= '0' && *p <= '9') {
                        firstParam = firstParam * 10 + (*p - '0');
                        hasParam = true;
                    } else {
                        break;
                    }
                }
                if (!hasParam)
                    firstParam = 0;

                if (firstParam == 0) {
                    activeCodes.clear();
                    return;
                }

                switch (firstParam) {
                case 22:
                    removeFirstParamInRange(1, 2);
                    return;
                case 23:
                    removeFirstParam(3);
                    return;
                case 24:
                    removeFirstParam(4);
                    return;
                case 25:
                    removeFirstParamInRange(5, 6);
                    return;
                case 27:
                    removeFirstParam(7);
                    return;
                case 28:
                    removeFirstParam(8);
                    return;
                case 29:
                    removeFirstParam(9);
                    return;
                case 39:
                    removeFirstParamInRange(30, 38);
                    removeFirstParamInRange(90, 97);
                    return;
                case 49:
                    removeFirstParamInRange(40, 48);
                    removeFirstParamInRange(100, 107);
                    return;
                }
            }
            // Non-SGR CSI or SGR "open" code: fall through to store
        }

        // Store the complete escape sequence (SGR opens + non-SGR CSI + OSC + etc.)
        AnsiCodeEntry entry;
        for (const Char* p = start; p < end; ++p)
            entry.sequence.append(static_cast<UChar>(*p));
        activeCodes.append(std::move(entry));
    }

    void emitActiveCodes(StringBuilder& result) const
    {
        for (const auto& entry : activeCodes) {
            auto span = entry.sequence.span();
            result.append(std::span { span.data(), span.size() });
        }
    }

private:
    // Extract the first numeric parameter from a stored sequence
    static uint32_t getFirstParam(const AnsiCodeEntry& entry)
    {
        auto span = entry.sequence.span();
        size_t i = 0;
        // Skip ESC [  or C1 CSI
        for (; i < span.size(); ++i) {
            if (span[i] == '[' || span[i] == 0x9b) {
                i++;
                break;
            }
        }
        uint32_t code = 0;
        bool found = false;
        for (; i < span.size(); ++i) {
            UChar c = span[i];
            if (c >= '0' && c <= '9') {
                code = code * 10 + (c - '0');
                found = true;
            } else {
                break;
            }
        }
        return found ? code : 0;
    }

    void removeFirstParam(uint32_t code)
    {
        activeCodes.removeAllMatching([code](const AnsiCodeEntry& entry) {
            return getFirstParam(entry) == code;
        });
    }

    void removeFirstParamInRange(uint32_t low, uint32_t high)
    {
        activeCodes.removeAllMatching([low, high](const AnsiCodeEntry& entry) {
            auto code = getFirstParam(entry);
            return code >= low && code <= high;
        });
    }
};

// ============================================================================
// Core sliceAnsi Implementation
// ============================================================================

template<typename Char>
static WTF::String sliceAnsiImpl(std::span<const Char> input, int64_t startIdx, int64_t endIdx)
{
    if (input.empty())
        return emptyString();

    const bool ambiguousIsWide = false;
    const Char* data = input.data();
    const Char* const dataEnd = data + input.size();

    // First pass: compute total visible width if we need to resolve negative indices
    size_t totalWidth = 0;
    if (startIdx < 0 || endIdx < 0) {
        const Char* p = data;
        uint32_t prevCp = 0;
        bool hasPrev = false;
        uint8_t breakState = 0;
        GraphemeWidthState graphemeState;

        while (p < dataEnd) {
            if (ANSI::isEscapeCharacter(*p)) {
                p = ANSI::consumeANSI(p, dataEnd);
                continue;
            }

            size_t charLen = 0;
            char32_t cp;
            if constexpr (sizeof(Char) == 1) {
                charLen = 1;
                cp = static_cast<uint8_t>(*p);
            } else {
                cp = decodeUTF16Pair(p, dataEnd - p, charLen);
            }

            if (hasPrev) {
                if (Bun__graphemeBreak(prevCp, cp, &breakState)) {
                    totalWidth += graphemeState.width();
                    graphemeState.reset(cp, ambiguousIsWide);
                } else {
                    graphemeState.add(cp, ambiguousIsWide);
                }
            } else {
                graphemeState.reset(cp, ambiguousIsWide);
            }

            prevCp = cp;
            hasPrev = true;
            p += charLen;
        }
        if (hasPrev)
            totalWidth += graphemeState.width();

        if (startIdx < 0) {
            startIdx = static_cast<int64_t>(totalWidth) + startIdx;
            if (startIdx < 0)
                startIdx = 0;
        }
        if (endIdx < 0) {
            endIdx = static_cast<int64_t>(totalWidth) + endIdx;
            if (endIdx < 0)
                endIdx = 0;
        }
    }

    if (startIdx >= endIdx)
        return emptyString();

    size_t start = static_cast<size_t>(startIdx);
    size_t end = static_cast<size_t>(endIdx);

    // Second pass: collect the slice
    //
    // Phases:
    //   Phase 1 (before start): Track active SGR styles. Skip visible chars.
    //   Phase 2 (start..end):   Emit active styles prefix, then emit all
    //                           chars and ANSI codes encountered.
    //   Phase 3 (after end):    Continue emitting ANSI codes only until we
    //                           hit the next visible character, then stop.

    StringBuilder result;
    result.reserveCapacity(input.size());

    AnsiStyleState styleState;
    size_t visiblePos = 0;
    bool includeStarted = false;
    bool visibleEndReached = false;

    const Char* p = data;
    uint32_t prevCp = 0;
    bool hasPrev = false;
    uint8_t breakState = 0;
    GraphemeWidthState graphemeState;
    const Char* graphemeStart = p;

    auto flushGrapheme = [&](uint8_t width) {
        size_t newPos = visiblePos + width;

        if (!includeStarted) {
            if (newPos > start) {
                includeStarted = true;
                styleState.emitActiveCodes(result);
                for (const Char* q = graphemeStart; q < p; ++q)
                    result.append(static_cast<UChar>(*q));
            }
        } else if (!visibleEndReached) {
            for (const Char* q = graphemeStart; q < p; ++q)
                result.append(static_cast<UChar>(*q));
        }

        visiblePos = newPos;
        if (visiblePos >= end)
            visibleEndReached = true;
    };

    while (p < dataEnd) {
        // Check for ANSI escape sequence
        if (ANSI::isEscapeCharacter(*p)) {
            // Flush pending grapheme before processing escape
            if (hasPrev) {
                flushGrapheme(graphemeState.width());
                hasPrev = false;
                graphemeState = GraphemeWidthState {};
                breakState = 0;
            }

            const Char* escStart = p;
            const Char* after = ANSI::consumeANSI(p, dataEnd);

            if (!includeStarted) {
                // Phase 1: track style state
                styleState.recordEscape(escStart, after);
            } else {
                // Phase 2 or 3: emit ANSI codes
                for (const Char* q = escStart; q < after; ++q)
                    result.append(static_cast<UChar>(*q));
            }

            p = after;
            graphemeStart = p;
            continue;
        }

        // If we've already consumed enough visible chars (Phase 3),
        // the next visible character means we stop.
        if (visibleEndReached)
            break;

        // Decode codepoint
        size_t charLen = 0;
        char32_t cp;
        if constexpr (sizeof(Char) == 1) {
            charLen = 1;
            cp = static_cast<uint8_t>(*p);
        } else {
            cp = decodeUTF16Pair(p, dataEnd - p, charLen);
        }

        if (hasPrev) {
            if (Bun__graphemeBreak(prevCp, cp, &breakState)) {
                flushGrapheme(graphemeState.width());
                graphemeStart = p;
                graphemeState.reset(cp, ambiguousIsWide);
            } else {
                graphemeState.add(cp, ambiguousIsWide);
            }
        } else {
            graphemeStart = p;
            graphemeState.reset(cp, ambiguousIsWide);
        }

        prevCp = cp;
        hasPrev = true;
        p += charLen;
    }

    // Flush final grapheme (if we haven't hit end yet)
    if (hasPrev && !visibleEndReached)
        flushGrapheme(graphemeState.width());

    // If we never started including (no visible chars crossed the start boundary)
    // but start == 0, emit accumulated ANSI codes (they're at position 0).
    if (!includeStarted && start == 0) {
        styleState.emitActiveCodes(result);
    }

    return result.toString();
}

// ============================================================================
// JavaScript Binding
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunSliceAnsi, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue inputValue = callFrame->argument(0);
    JSC::JSValue startValue = callFrame->argument(1);
    JSC::JSValue endValue = callFrame->argument(2);

    JSC::JSString* jsString = inputValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (view->isEmpty())
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));

    // Parse start index (default 0)
    int64_t startIdx = 0;
    if (!startValue.isUndefined()) {
        double d = startValue.toIntegerOrInfinity(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (std::isfinite(d))
            startIdx = static_cast<int64_t>(d);
        else if (d > 0)
            return JSC::JSValue::encode(JSC::jsEmptyString(vm));
        // -Infinity → 0
    }

    // Parse end index (default: end of string)
    int64_t endIdx = INT64_MAX;
    if (!endValue.isUndefined()) {
        double d = endValue.toIntegerOrInfinity(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (std::isfinite(d)) {
            endIdx = static_cast<int64_t>(d);
        } else if (d < 0) {
            return JSC::JSValue::encode(JSC::jsEmptyString(vm));
        }
        // +Infinity → INT64_MAX (effectively to end)
    }

    WTF::String result;
    if (view->is8Bit()) {
        result = sliceAnsiImpl<Latin1Character>(view->span8(), startIdx, endIdx);
    } else {
        result = sliceAnsiImpl<UChar>(view->span16(), startIdx, endIdx);
    }

    if (result.isEmpty())
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

} // namespace Bun
