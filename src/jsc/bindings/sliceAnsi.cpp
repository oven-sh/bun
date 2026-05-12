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
extern "C" size_t Bun__visibleWidthExcludeANSI_latin1(const uint8_t* ptr, size_t len);
extern "C" size_t Bun__visibleWidthExcludeANSI_utf16(const uint16_t* ptr, size_t len, bool ambiguous_as_wide);

namespace Bun {
using namespace WTF;

// Shared SIMD/SGR helpers live in ANSIHelpers.h. We keep a local
// GraphemeWidthState mirror of visible.zig's GraphemeState because these are
// called per-codepoint in the hot loop — extern-call overhead would hurt more
// than the ~80 lines of duplication. Drift is caught by tests that assert
// Bun.stringWidth(s) == width of Bun.sliceAnsi(s, 0, N) for edge cases.

// ============================================================================
// Grapheme-aware Visible Width (mirrors visible.zig GraphemeState; see above)
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
            return 1; // Single (unpaired) regional indicator is width 1 — matches visible.zig
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
        // Match visible.zig GraphemeState.width() exactly: return accumulated width
        // (may be 0 for zero-width-only clusters like U+200B ZWSP).
        return static_cast<uint8_t>(nonEmojiWidth);
    }
};

// ============================================================================
// SGR Style State Tracking
// ============================================================================
// ANSI::sgrCloseCode / ANSI::isSgrEndCode are in ANSIHelpers.h (shared with wrapAnsi).
using ANSI::isSgrEndCode;
using ANSI::sgrCloseCode;

// Style state: maps endCode -> openCode string
// This matches the upstream approach using a Map<endCode, openCode>
struct SgrStyleState {
    // We store entries as (endCode, openCodeString) pairs
    // where endCode is the SGR code that closes this style
    struct Entry {
        String endCode; // e.g. "\x1b[39m"
        String openCode; // e.g. "\x1b[31m"
    };

    // Typical terminal output has 1-4 concurrently-active styles; use inline
    // capacity to avoid heap allocation for the common case.
    Vector<Entry, 4> entries;

    void applyReset()
    {
        entries.clear();
    }

    void applyEnd(const String& endCodeStr)
    {
        entries.removeAllMatching([&](const Entry& e) {
            return e.endCode == endCodeStr;
        });
    }

    void applyStart(const String& openCodeStr, const String& endCodeStr)
    {
        // Remove existing entry with same endCode, then add new one
        entries.removeAllMatching([&](const Entry& e) {
            return e.endCode == endCodeStr;
        });
        entries.append(Entry { endCodeStr, openCodeStr });
    }

    void emitOpenCodes(StringBuilder& result) const
    {
        for (const auto& e : entries)
            result.append(e.openCode);
    }

    void emitCloseCodes(StringBuilder& result) const
    {
        // Emit in reverse order (matching upstream undoAnsiCodes)
        for (size_t i = entries.size(); i > 0; --i)
            result.append(entries[i - 1].endCode);
    }

    bool isEmpty() const { return entries.isEmpty(); }
};

static String makeSgrCode(bool isC1, uint32_t code)
{
    StringBuilder sb;
    if (isC1) {
        sb.append(static_cast<UChar>(0x9b));
    } else {
        sb.append("\x1b["_s);
    }
    sb.append(String::number(code));
    sb.append('m');
    return sb.toString();
}

// Build "\e[a;b;c;...m" (or C1 "\x9b a;b;...m") from a short span of params.
// Max 5 params (truecolor 38;2;R;G;B) — no heap, all on stack.
static String makeSgrCodeMulti(bool isC1, std::span<const uint32_t> codes)
{
    StringBuilder sb;
    if (isC1) {
        sb.append(static_cast<UChar>(0x9b));
    } else {
        sb.append("\x1b["_s);
    }
    for (size_t i = 0; i < codes.size(); ++i) {
        if (i > 0)
            sb.append(';');
        sb.append(String::number(codes[i]));
    }
    sb.append('m');
    return sb.toString();
}

// ============================================================================
// SGR parameter parsing — fixed-size stack storage, no heap.
// ============================================================================
// CSI parameters are bounded: ECMA-48 specifies 16, xterm accepts ~30. We cap
// at 32. Anything beyond that is either corrupt or adversarial — we stop
// parsing and mark overflow; callers treat overflowed sequences as opaque
// (no style tracking, just pass-through/skip). Zero heap allocation for all
// real-world SGR.
struct SgrParams {
    static constexpr size_t kMax = 32;
    uint32_t data[kMax];
    size_t count = 0;
    bool overflow = false;
    bool hasColon = false; // 38:2:R:G:B style — whole sequence is opaque

    uint32_t operator[](size_t i) const { return data[i]; }
    size_t size() const { return count; }
    bool isEmpty() const { return count == 0; }
};

// Parse directly from the input Char buffer — no intermediate UChar copy.
template<typename Char>
static SgrParams parseSgrParams(const Char* paramStart, const Char* paramEnd)
{
    SgrParams out;
    uint32_t current = 0;
    bool hasDigit = false;

    for (const Char* p = paramStart; p < paramEnd; ++p) {
        Char c = *p;
        if (c >= '0' && c <= '9') {
            // Clamp to prevent overflow on pathological "99999999999" params.
            // Valid SGR codes are 0-107 plus 256-color indices 0-255.
            if (current < 100000) current = current * 10 + (c - '0');
            hasDigit = true;
        } else if (c == ';' || c == ':') {
            if (c == ':') out.hasColon = true;
            if (out.count >= SgrParams::kMax) {
                out.overflow = true;
                return out;
            }
            out.data[out.count++] = hasDigit ? current : 0;
            current = 0;
            hasDigit = false;
        } else {
            break; // non-parameter character
        }
    }
    if (hasDigit || out.count == 0) {
        if (out.count >= SgrParams::kMax) {
            out.overflow = true;
            return out;
        }
        out.data[out.count++] = current;
    }
    return out;
}

// Apply an SGR sequence to style state, decomposing multi-parameter codes
template<typename Char>
static void applySgrToState(SgrStyleState& state, const Char* seqStart, const Char* seqEnd)
{
    // Determine prefix type (C1 or ESC[)
    bool isC1 = false;
    const Char* paramStart;

    if (*seqStart == 0x9b) {
        isC1 = true;
        paramStart = seqStart + 1;
    } else {
        // ESC [
        paramStart = seqStart + 2;
    }

    // Find the 'm' terminator and extract parameter string
    const Char* paramEnd = seqEnd - 1; // points to 'm'

    // Parse params directly from input — no intermediate buffer, no heap.
    SgrParams params = parseSgrParams(paramStart, paramEnd);
    bool hasColon = params.hasColon;
    // Overflowed param count → treat as opaque unknown sequence (pass through
    // but don't track state). Matches the hasColon handling below.
    if (params.overflow) hasColon = true;

    if (hasColon) {
        // Treat the whole sequence as opaque - store as a start with appropriate end code
        uint32_t firstParam = params.isEmpty() ? 0 : params[0];
        uint32_t closeCode = sgrCloseCode(firstParam);
        String endStr = closeCode ? makeSgrCode(false, closeCode) : "\x1b[0m"_s;
        // Build open code string from original sequence
        StringBuilder openSb;
        for (const Char* p = seqStart; p < seqEnd; ++p)
            openSb.append(static_cast<UChar>(*p));
        state.applyStart(openSb.toString(), endStr);
        return;
    }

    // Empty params = reset
    if (params.isEmpty()) {
        state.applyReset();
        return;
    }

    size_t i = 0;
    while (i < params.size()) {
        uint32_t code = params[i];

        if (code == 0) {
            state.applyReset();
            i++;
            continue;
        }

        // Extended foreground (38) or background (48)
        if (code == 38 || code == 48) {
            uint32_t defaultClose = (code == 38) ? 39 : 49;
            String endStr = makeSgrCode(false, defaultClose);

            if (i + 1 < params.size()) {
                uint32_t colorType = params[i + 1];
                if (colorType == 5 && i + 2 < params.size()) {
                    // 256-color: 38;5;N — 3 params on stack.
                    const uint32_t seq[3] = { code, 5, params[i + 2] };
                    state.applyStart(makeSgrCodeMulti(isC1, seq), endStr);
                    i += 3;
                    continue;
                }
                if (colorType == 2 && i + 4 < params.size()) {
                    // Truecolor: 38;2;R;G;B — 5 params on stack.
                    const uint32_t seq[5] = { code, 2, params[i + 2], params[i + 3], params[i + 4] };
                    state.applyStart(makeSgrCodeMulti(isC1, seq), endStr);
                    i += 5;
                    continue;
                }
            }
            // Fallback: just 38 or 48 alone
            state.applyStart(makeSgrCode(isC1, code), endStr);
            i++;
            continue;
        }

        // Check if this is an end code
        if (isSgrEndCode(code)) {
            state.applyEnd(makeSgrCode(false, code));
            i++;
            continue;
        }

        // It's a start code
        uint32_t closeCode = sgrCloseCode(code);
        if (closeCode) {
            state.applyStart(makeSgrCode(isC1, code), makeSgrCode(false, closeCode));
        } else {
            // Unknown code - use reset as close
            state.applyStart(makeSgrCode(isC1, code), "\x1b[0m"_s);
        }
        i++;
    }
}

// Check if an SGR token should be included after the end boundary
// (Only if it has closing effect and no new start codes)
static bool shouldIncludeSgrAfterEnd(const SgrParams& params, const SgrStyleState& activeStyles)
{
    bool hasStartFragment = false;
    bool hasClosingEffect = false;

    for (size_t i = 0; i < params.size(); ++i) {
        uint32_t code = params[i];

        if (code == 0) {
            if (!activeStyles.isEmpty())
                hasClosingEffect = true;
            continue;
        }

        if (isSgrEndCode(code)) {
            // Check if we have an active style with this end code
            String endStr = makeSgrCode(false, code);
            for (const auto& e : activeStyles.entries) {
                if (e.endCode == endStr) {
                    hasClosingEffect = true;
                    break;
                }
            }
            continue;
        }

        // Extended color sequences
        if (code == 38 || code == 48) {
            hasStartFragment = true;
            // Skip sub-parameters
            if (i + 1 < params.size()) {
                uint32_t colorType = params[i + 1];
                if (colorType == 5 && i + 2 < params.size()) {
                    i += 2;
                } else if (colorType == 2 && i + 4 < params.size()) {
                    i += 4;
                }
            }
            continue;
        }

        // Any other non-end code is a start
        hasStartFragment = true;
    }

    return hasClosingEffect && !hasStartFragment;
}

// ============================================================================
// ANSI Sequence Parsing for Tokenization
// ============================================================================

enum class TokenType {
    Character,
    Sgr,
    Hyperlink,
    Control,
};

struct HyperlinkInfo {
    bool isOpen = false;
    // closePrefix: the prefix to use when closing this hyperlink
    // terminator: the terminator character/sequence
    String closePrefix;
    String terminator;
};

// Parse CSI sequence: returns end pointer, or nullptr if not a valid CSI
template<typename Char>
static const Char* parseCsi(const Char* start, const Char* end, bool& isSgr, bool& isCanonicalSgr)
{
    const Char* it = start;
    isSgr = false;
    isCanonicalSgr = true;

    // Determine start of parameters
    if (*it == 0x1b) {
        if (end - it < 2 || *(it + 1) != '[')
            return nullptr;
        it += 2;
    } else if (*it == 0x9b) {
        it += 1;
    } else {
        return nullptr;
    }

    // Scan parameters and find final byte
    while (it < end) {
        Char c = *it;

        // Final byte: 0x40-0x7E
        if (c >= 0x40 && c <= 0x7E) {
            isSgr = (c == 'm' && isCanonicalSgr);
            return it + 1;
        }

        // CSI parameter byte: 0x30-0x3F
        if (c >= 0x30 && c <= 0x3F) {
            // SGR only allows digits, semicolons, colons
            if (!(c >= '0' && c <= '9') && c != ';' && c != ':') {
                isCanonicalSgr = false;
            }
            it++;
            continue;
        }

        // CSI intermediate byte: 0x20-0x2F
        if (c >= 0x20 && c <= 0x2F) {
            isCanonicalSgr = false;
            it++;
            continue;
        }

        // Invalid byte for CSI - sequence is malformed
        return it; // Return pointer to the malformed byte (treated as control up to here)
    }

    // Unterminated CSI - consume everything
    return end;
}

// Parse hyperlink: ESC]8;...;url TERMINATOR
template<typename Char>
static const Char* parseHyperlink(const Char* start, const Char* end, bool& isOpen, StringBuilder& codeBuilder, String& closePrefix, String& terminator)
{
    const Char* it = start;
    bool isEscOsc = false;

    if (*it == 0x1b && end - it >= 4 && *(it + 1) == ']' && *(it + 2) == '8' && *(it + 3) == ';') {
        isEscOsc = true;
        it += 4; // past "ESC]8;"
    } else if (*it == 0x9d && end - it >= 3 && *(it + 1) == '8' && *(it + 2) == ';') {
        it += 3; // past "C1_OSC 8;"
    } else {
        return nullptr;
    }

    // Find the semicolon separating params from URI
    const Char* uriStart = nullptr;
    {
        const Char* p = it;
        while (p < end && *p != ';')
            p++;
        if (p >= end)
            return nullptr; // no semicolon found - not a valid hyperlink
        uriStart = p + 1;
    }

    // Find terminator (BEL, ESC\, or C1 ST)
    const Char* p = uriStart;
    while (p < end) {
        if (*p == 0x07) {
            // BEL terminator
            isOpen = (p > uriStart); // empty URI = close
            for (const Char* q = start; q <= p; ++q)
                codeBuilder.append(static_cast<UChar>(*q));
            if (isEscOsc) {
                closePrefix = "\x1b]8;;"_s;
            } else {
                StringBuilder cpb;
                cpb.append(static_cast<UChar>(0x9d));
                cpb.append("8;;"_s);
                closePrefix = cpb.toString();
            }
            {
                UChar bel = 0x07;
                terminator = String(std::span<const UChar>(&bel, 1));
            }
            return p + 1;
        }
        if (*p == 0x1b && p + 1 < end && *(p + 1) == '\\') {
            // ESC\ terminator (ST)
            isOpen = (p > uriStart);
            for (const Char* q = start; q <= p + 1; ++q)
                codeBuilder.append(static_cast<UChar>(*q));
            if (isEscOsc) {
                closePrefix = "\x1b]8;;"_s;
            } else {
                StringBuilder cpb;
                cpb.append(static_cast<UChar>(0x9d));
                cpb.append("8;;"_s);
                closePrefix = cpb.toString();
            }
            terminator = "\x1b\\"_s;
            return p + 2;
        }
        if (*p == 0x9c) {
            // C1 ST terminator
            isOpen = (p > uriStart);
            for (const Char* q = start; q <= p; ++q)
                codeBuilder.append(static_cast<UChar>(*q));
            if (isEscOsc) {
                closePrefix = "\x1b]8;;"_s;
            } else {
                StringBuilder cpb;
                cpb.append(static_cast<UChar>(0x9d));
                cpb.append("8;;"_s);
                closePrefix = cpb.toString();
            }
            {
                UChar st = 0x9c;
                terminator = String(std::span<const UChar>(&st, 1));
            }
            return p + 1;
        }
        p++;
    }

    return nullptr; // unterminated hyperlink
}

// Parse control string (OSC, DCS, SOS, PM, APC, standalone ST)
template<typename Char>
static const Char* parseControlString(const Char* start, const Char* end)
{
    const Char* it = start;
    Char c = *it;

    bool needST = false;
    bool supportsBel = false;

    if (c == 0x1b) {
        if (end - it < 2)
            return nullptr;
        Char next = *(it + 1);
        switch (next) {
        case ']':
            it += 2;
            needST = true;
            supportsBel = true;
            break;
        case 'P': // DCS
        case 'X': // SOS
        case '^': // PM
        case '_': // APC
            it += 2;
            needST = true;
            break;
        case '\\': // standalone ST
            return it + 2;
        default:
            return nullptr;
        }
    } else if (c == 0x9d) { // C1 OSC
        it += 1;
        needST = true;
        supportsBel = true;
    } else if (c == 0x90 || c == 0x98 || c == 0x9e || c == 0x9f) { // C1 DCS/SOS/PM/APC
        it += 1;
        needST = true;
    } else if (c == 0x9c) { // standalone C1 ST
        return it + 1;
    } else {
        return nullptr;
    }

    if (needST) {
        while (it < end) {
            if (supportsBel && *it == 0x07)
                return it + 1;
            if (*it == 0x1b && it + 1 < end && *(it + 1) == '\\')
                return it + 2;
            if (*it == 0x9c)
                return it + 1;
            it++;
        }
        // Unterminated control string — DO NOT consume to EOF. A single C1
        // byte (0x90, 0x98, 0x9E, 0x9F) or malformed ESC-sequence should not
        // swallow the rest of the string (DoS vector; also inconsistent with
        // Bun.stringWidth which treats these as standalone width-0 controls).
        // Instead, return nullptr so the caller treats the introducer as a
        // single visible char (which will be width 0 via codepointWidth).
        return nullptr;
    }

    return nullptr;
}

// Try to parse an ANSI sequence at position. Returns type and end pointer.
template<typename Char>
static const Char* tryParseAnsi(const Char* start, const Char* end, TokenType& type, bool& isSgr, bool& isCanonicalSgr, bool& isHyperlinkOpen, StringBuilder& hyperlinkCodeBuilder, String& hyperlinkClosePrefix, String& hyperlinkTerminator)
{
    Char c = *start;

    // Try hyperlink first (for ESC and C1 OSC)
    if (c == 0x1b || c == 0x9d) {
        const Char* hlEnd = parseHyperlink(start, end, isHyperlinkOpen, hyperlinkCodeBuilder, hyperlinkClosePrefix, hyperlinkTerminator);
        if (hlEnd) {
            type = TokenType::Hyperlink;
            return hlEnd;
        }
    }

    // Try control string (OSC, DCS, SOS, PM, APC, ST)
    if (c == 0x1b || c == 0x9d || c == 0x90 || c == 0x98 || c == 0x9e || c == 0x9f || c == 0x9c) {
        const Char* ctrlEnd = parseControlString(start, end);
        if (ctrlEnd) {
            type = TokenType::Control;
            return ctrlEnd;
        }
    }

    // Try CSI
    if (c == 0x1b || c == 0x9b) {
        const Char* csiEnd = parseCsi(start, end, isSgr, isCanonicalSgr);
        if (csiEnd) {
            if (isSgr) {
                type = TokenType::Sgr;
            } else {
                type = TokenType::Control;
            }
            return csiEnd;
        }
    }

    return nullptr;
}

// ============================================================================
// Resolve [start, end) from doubles against a known totalWidth.
// ============================================================================
// Matches JSC's stringSlice<double> (StringPrototypeInlines.h): clamp in
// double space (exact since totalW << 2^53), cast only after range-verified.
struct SliceBounds {
    size_t start, end;
    bool cutStart, cutEnd, empty;
};
static SliceBounds resolveSliceBounds(double startD, double endD, size_t totalW)
{
    double from = startD < 0 ? static_cast<double>(totalW) + startD : startD;
    double to = endD < 0 ? static_cast<double>(totalW) + endD : endD;
    if (from < 0) from = 0;
    if (to > static_cast<double>(totalW)) to = static_cast<double>(totalW);
    if (!(to > from)) return { 0, 0, false, false, true }; // also catches NaN
    size_t s = static_cast<size_t>(from), e = static_cast<size_t>(to);
    return { s, e, s > 0, e < totalW, false };
}

// ============================================================================
// totalWidth pre-pass — ONLY used when start or end is negative.
// ============================================================================
// Inline grapheme tracking mirrors the main emit walk. For non-negative
// indices (the 99% case), we skip this entirely and emit in one pass.
template<typename Char>
static size_t computeTotalWidth(std::span<const Char> input, size_t asciiPrefix, bool ambiguousIsWide)
{
    const Char* data = input.data();
    const Char* const dataEnd = data + input.size();

    // ASCII prefix contributes 1 col per char. The char AT asciiPrefix might
    // join to the last ASCII char, so we seed grapheme state from it but must
    // avoid double-counting: reserve the last char's contribution until its
    // cluster finalizes (which may include joiners that change the width).
    size_t totalW = asciiPrefix > 0 ? asciiPrefix - 1 : 0; // all but last ASCII
    uint32_t prevCp = 0;
    bool hasPrev = false;
    uint8_t breakState = 0;
    GraphemeWidthState gs;
    if (asciiPrefix > 0) {
        prevCp = static_cast<uint32_t>(data[asciiPrefix - 1]);
        hasPrev = true;
        gs.reset(prevCp, ambiguousIsWide);
    }

    const Char* p = data + asciiPrefix;
    while (p < dataEnd) {
        if (ANSI::isEscapeCharacter(*p) || *p == 0x9c) {
            TokenType type;
            bool a, b, c;
            StringBuilder d;
            String e, f;
            if (const Char* after = tryParseAnsi(p, dataEnd, type, a, b, c, d, e, f)) {
                p = after;
                continue;
            }
        }
        size_t charLen;
        char32_t cp;
        if constexpr (sizeof(Char) == 1) {
            charLen = 1;
            cp = static_cast<uint8_t>(*p);
        } else {
            cp = ANSI::decodeUTF16(p, dataEnd - p, charLen);
        }

        bool shouldBreak;
        if (!hasPrev)
            shouldBreak = true;
        else if (prevCp == 0x0D && cp == 0x0A)
            shouldBreak = false;
        else if (prevCp == 0x0D || prevCp == 0x0A || cp == 0x0D || cp == 0x0A) {
            shouldBreak = true;
            breakState = 0;
        } else
            shouldBreak = Bun__graphemeBreak(prevCp, cp, &breakState);

        if (shouldBreak) {
            if (hasPrev) totalW += gs.width();
            gs.reset(cp, ambiguousIsWide);
        } else {
            gs.add(cp, ambiguousIsWide);
        }
        prevCp = cp;
        hasPrev = true;
        p += charLen;
    }
    if (hasPrev) totalW += gs.width();
    return totalW;
}

// ============================================================================
// Single-pass streaming emit with inline grapheme clustering.
// ============================================================================
// ONE walk of the input. No Vector. No pre-pass for non-negative indices.
//
// Core invariant: `position` advances ONLY at cluster boundaries (when a new
// cluster starts), so it's always correct at decision points. Inside a
// cluster, position stays fixed at the cluster's start column.
//
// The only lookahead: a tiny buffer for ANSI seen between consecutive visible
// chars, because "is the next visible char a continuation?" decides whether
// that ANSI is inside a cluster (emit unfiltered) or past-end (filter to
// close-only). The buffer holds at most a few short spans (typically 0-1).
//
// `end == SIZE_MAX` means unbounded (endD was +Inf) — we emit to EOF.
template<typename Char>
static WTF::String emitSliceStreaming(
    std::span<const Char> input, size_t asciiPrefix,
    size_t start, size_t end,
    StringView ellipsis, size_t ellipsisWidth,
    bool cutStartForEllipsis, // start > 0 before any ellipsis budget applied
    bool cutEndKnown, bool cutEndHint, // cutEndHint valid iff cutEndKnown
    bool ambiguousIsWide)
{
    const Char* data = input.data();
    const Char* const dataEnd = data + input.size();
    const bool endUnbounded = (end == SIZE_MAX);

    StringBuilder result;
    result.reserveCapacity(input.size());

    SgrStyleState activeStyles;
    bool activeHyperlink = false;
    String activeHyperlinkClosePrefix, activeHyperlinkTerminator, activeHyperlinkCode;

    // Column where the NEXT new cluster starts. Correct at all breaks.
    size_t position = 0;
    bool include = false;

    // Inline grapheme state — replaces the old visibleChars Vector.
    uint32_t prevVisCp = 0;
    bool hasPrev = false;
    uint8_t breakState = 0;
    GraphemeWidthState gs;

    // Pending ANSI: sequences seen since the last visible char. Flushed when
    // the NEXT visible char reveals whether they're inside a continuation
    // (flush all) or past a break (filter close-only). Tiny: at most a few
    // spans between adjacent visible chars.
    struct Pending {
        const Char* start;
        const Char* end;
        TokenType type;
        bool hlOpen;
    };
    Vector<Pending, 4> pending;
    // Captured hyperlink parse state per pending Hyperlink entry (indexed separately).
    Vector<std::tuple<String, String, String>, 2> pendingHl; // code, closePrefix, terminator

    auto flushPending = [&](bool filterCloseOnly) {
        size_t hlIdx = 0;
        for (auto& pa : pending) {
            bool emit = false;
            switch (pa.type) {
            case TokenType::Sgr: {
                if (filterCloseOnly) {
                    // Close-only pass-through (upstream slice-ansi compat).
                    // Parse directly from input bytes — no UChar copy, no heap.
                    const Char* ps = (*pa.start == 0x9b) ? pa.start + 1 : pa.start + 2;
                    SgrParams params = parseSgrParams(ps, pa.end - 1);
                    // Overflow/colon: can't safely determine close effect → skip.
                    if (params.overflow || params.hasColon) break;
                    if (!shouldIncludeSgrAfterEnd(params, activeStyles)) break;
                }
                applySgrToState(activeStyles, pa.start, pa.end);
                emit = true;
                break;
            }
            case TokenType::Hyperlink: {
                bool isClose = !pa.hlOpen;
                if (filterCloseOnly && (!isClose || !activeHyperlink)) {
                    hlIdx++;
                    break;
                }
                if (pa.hlOpen) {
                    activeHyperlink = true;
                    auto& [code, cp, term] = pendingHl[hlIdx];
                    activeHyperlinkCode = code;
                    activeHyperlinkClosePrefix = cp;
                    activeHyperlinkTerminator = term;
                } else {
                    activeHyperlink = false;
                }
                hlIdx++;
                emit = true;
                break;
            }
            case TokenType::Control:
                if (!filterCloseOnly) emit = true;
                break;
            default:
                break;
            }
            if (emit)
                result.append(std::span { pa.start, static_cast<size_t>(pa.end - pa.start) });
        }
        pending.clear();
        pendingHl.clear();
    };

    // ------------------------------------------------------------------------
    // Ellipsis budget resolution. cutStart is known immediately. cutEnd may
    // need lazy detection (non-negative indices, finite end).
    // ------------------------------------------------------------------------
    bool needStartEllipsis = false;
    bool needEndEllipsis = false;
    size_t ellipsisEndBudget = 0; // how much we shrank `end` by for end ellipsis
    if (ellipsisWidth > 0) {
        if (cutStartForEllipsis && ellipsisWidth < (endUnbounded ? SIZE_MAX - start : end - start)) {
            needStartEllipsis = true;
            start += ellipsisWidth;
        }
        if (cutEndKnown && cutEndHint && ellipsisWidth < (end - start)) {
            needEndEllipsis = true;
            end -= ellipsisWidth;
        } else if (!cutEndKnown && !endUnbounded && ellipsisWidth < (end - start)) {
            // Lazy cutEnd: speculatively budget for end ellipsis. If the walk
            // reaches EOF without hitting `end` (no cut), we unwind: append
            // the speculative zone's content (stored separately) instead of
            // the ellipsis. specZone below handles this.
            needEndEllipsis = true; // tentative
            ellipsisEndBudget = ellipsisWidth;
            end -= ellipsisWidth;
        }
        if (cutEndKnown && (cutStartForEllipsis || cutEndHint) && !needStartEllipsis && !needEndEllipsis)
            return ellipsis.toString(); // degenerate: range too small
    }
    // Speculative zone: when cutEnd is unknown and we've budgeted for an
    // ellipsis, content in cols [end, end+ellipsisEndBudget) goes here. If
    // we later detect cutEnd (more input past the zone) → discard, emit
    // ellipsis. If EOF reached first (no cut) → flush specZone, no ellipsis.
    StringBuilder specZone;
    bool inSpecZone = false;
    const size_t specEnd = (ellipsisEndBudget > 0) ? end + ellipsisEndBudget : end;

    // ------------------------------------------------------------------------
    // ASCII prefix fast-forward: every char is width 1, no ANSI, always a
    // break. We can skip directly to `start` (minus 1 to seed gs correctly).
    // ------------------------------------------------------------------------
    {
        // Stop fast-forward one short of the prefix end so the last ASCII char
        // enters the main loop to seed gs/prevVisCp (in case the char after it
        // is a combining mark).
        size_t ffEnd = asciiPrefix > 0 ? asciiPrefix - 1 : 0;
        size_t ffTo = std::min(start, ffEnd);
        // We CAN'T jump past `start` cleanly (need emitOpens on the transition),
        // so fast-forward to min(start, ffEnd) and let the loop handle the rest.
        position = ffTo;
        // No gs/prevVisCp update needed: ffTo < ffEnd means all chars up to ffTo
        // are ASCII breaks; gs state before the loop doesn't matter since the
        // first visible char in the loop is also a break.
    }

    const Char* p = data + position;
    bool sawCutEnd = false; // set true if we break due to position >= specEnd

    // Visible-codepoint processing, extracted so it can be called from both
    // the SIMD-skipped tight loop and the false-positive fallback. Returns
    // false if we should stop (past end).
    auto processVisibleCp = [&](char32_t cp, size_t charLen) -> bool {
        bool shouldBreak;
        if (!hasPrev)
            shouldBreak = true;
        else if (prevVisCp == 0x0D && cp == 0x0A)
            shouldBreak = false;
        else if (prevVisCp == 0x0D || prevVisCp == 0x0A || cp == 0x0D || cp == 0x0A) {
            shouldBreak = true;
            breakState = 0;
        } else
            shouldBreak = Bun__graphemeBreak(prevVisCp, cp, &breakState);

        if (shouldBreak) {
            if (hasPrev) position += gs.width();

            if (!endUnbounded && position >= specEnd) {
                sawCutEnd = true;
                flushPending(/*filterCloseOnly=*/true);
                return false; // signal break
            }

            if (!include && position >= start) {
                include = true;
                activeStyles.emitOpenCodes(result);
                if (needStartEllipsis) result.append(ellipsis);
                if (activeHyperlink) result.append(activeHyperlinkCode);
            }
            if (include) {
                flushPending(/*filterCloseOnly=*/false);
                if (!endUnbounded && position >= end && ellipsisEndBudget > 0) {
                    if (!inSpecZone) inSpecZone = true;
                    specZone.append(std::span { p, charLen });
                } else {
                    result.append(std::span { p, charLen });
                }
            } else {
                pending.clear();
                pendingHl.clear();
            }
            gs.reset(cp, ambiguousIsWide);
        } else {
            // JOIN: continuation, position unchanged. Pending is inside cluster.
            if (include) {
                flushPending(/*filterCloseOnly=*/false);
                if (inSpecZone)
                    specZone.append(std::span { p, charLen });
                else
                    result.append(std::span { p, charLen });
            } else {
                pending.clear();
                pendingHl.clear();
            }
            gs.add(cp, ambiguousIsWide);
        }
        prevVisCp = cp;
        hasPrev = true;
        p += charLen;
        return true;
    };

    // ------------------------------------------------------------------------
    // Main walk with SIMD skip-ahead.
    // ------------------------------------------------------------------------
    // findEscapeCharacter uses a SIMD mask matching 0x10-0x1F and 0x90-0x9F.
    // We use it to skip over long runs of visible chars without per-byte
    // ANSI checks. False positives (e.g. 0x10, 0x9A) fall through and get
    // processed as visible chars. 0x9C (C1 ST) IS caught by the SIMD mask
    // but its scalar tail loop uses isEscapeCharacter (which excludes 0x9C)
    // — we add an explicit check for it.
    //
    // For long ANSI-colored ASCII text (the common case), this turns N
    // per-byte scalar checks into N/16 SIMD iterations (+ a short tail).
    while (p < dataEnd) {
        // Bound the scan horizon. We never need to look past col specEnd+2
        // (the +2 is slop for the leave-one-behind char + one grapheme joiner).
        // Without this, `\e[0m` + 100k ASCII chars sliced at [0, 50) would
        // SIMD-scan all 100k bytes looking for the next escape, even though we
        // stop emitting at col 50. This caps both findEscapeCharacter AND
        // firstNonAsciiPrintable at O(slice-length) instead of O(input-length).
        // If hasPrev, the current cluster's width (≤ 2) is not yet committed
        // to `position`, so budget a couple extra cols for the pending finalize.
        const Char* scanEnd;
        if (endUnbounded) {
            scanEnd = dataEnd;
        } else {
            size_t budget = (specEnd > position ? specEnd - position : 0) + 4;
            scanEnd = (static_cast<size_t>(dataEnd - p) <= budget) ? dataEnd : p + budget;
        }

        // SIMD: find next potential escape byte (mask: 0x10-0x1F, 0x90-0x9F).
        const Char* nextEsc = ANSI::findEscapeCharacter(p, scanEnd);
        const Char* runEnd = nextEsc ? nextEsc : scanEnd;

        // --------------------------------------------------------------------
        // Bulk-process the ASCII-printable prefix of this visible run.
        // --------------------------------------------------------------------
        // Within [p, runEnd), SIMD-find the first byte NOT in [0x20, 0x7E].
        // Everything before it is width-1, no decode, no grapheme joining.
        // Run length is already capped by scanEnd, so this scan is O(budget).
        {
            using SIMDLane = std::conditional_t<sizeof(Char) == 1, uint8_t, uint16_t>;
            size_t asciiLen = ANSI::firstNonAsciiPrintable(
                std::span { reinterpret_cast<const SIMDLane*>(p), static_cast<size_t>(runEnd - p) });

            // Bulk-process asciiLen - 1 chars. Leave the LAST char for the
            // per-char loop so it properly seeds gs/prevVisCp without
            // double-counting its width in position. (After bulk, position
            // points at the last char's column; the per-char loop's break
            // handling for that char correctly advances position by its
            // cluster width when the NEXT break happens.)
            //
            // ASCII-printable never joins to ASCII-printable via graphemeBreak,
            // so bulk-processing N-1 chars as width-1 clusters is safe. The
            // Nth char might have a combining mark attached (from the non-ASCII
            // tail) — handled by going through processVisibleCp.
            size_t bulkN = (asciiLen > 1) ? asciiLen - 1 : 0;
            if (bulkN > 0) {
                // Finalize any pending cluster first (first ASCII is a break).
                if (hasPrev) {
                    position += gs.width();
                    hasPrev = false;
                    if (!endUnbounded && position >= specEnd) {
                        sawCutEnd = true;
                        flushPending(/*filterCloseOnly=*/true);
                        goto walkDone;
                    }
                }
                // position now = column of the first ASCII char.
                // Advance through pre-include (cols before start).
                if (!include && position < start) {
                    size_t skipN = std::min(start - position, bulkN);
                    p += skipN;
                    position += skipN;
                    bulkN -= skipN;
                }
                if (bulkN > 0 && !include && position >= start) {
                    include = true;
                    activeStyles.emitOpenCodes(result);
                    if (needStartEllipsis) result.append(ellipsis);
                    if (activeHyperlink) result.append(activeHyperlinkCode);
                }
                if (bulkN > 0 && include) {
                    flushPending(/*filterCloseOnly=*/false);
                    // How many can we emit before specEnd?
                    size_t emitN = endUnbounded ? bulkN
                                                : std::min(static_cast<size_t>(specEnd > position ? specEnd - position : 0), bulkN);
                    if (emitN > 0) {
                        // Split at spec zone boundary [end, specEnd).
                        if (ellipsisEndBudget > 0 && position < end && !endUnbounded) {
                            size_t toMain = std::min(end - position, emitN);
                            result.append(std::span { p, toMain });
                            if (emitN > toMain) {
                                inSpecZone = true;
                                specZone.append(std::span { p + toMain, emitN - toMain });
                            }
                        } else if (inSpecZone || (!endUnbounded && position >= end)) {
                            inSpecZone = true;
                            specZone.append(std::span { p, emitN });
                        } else {
                            result.append(std::span { p, emitN });
                        }
                        p += emitN;
                        position += emitN;
                        bulkN -= emitN;
                    }
                    if (!endUnbounded && position >= specEnd) {
                        sawCutEnd = true;
                        goto walkDone;
                    }
                }
                // Skip any remaining pre-include chars.
                p += bulkN;
                position += bulkN;
                // hasPrev stays false; the next char (last ASCII) enters
                // processVisibleCp fresh and seeds gs correctly.
            }
        }

        // Per-char processing for the non-ASCII tail of the run (if any).
        // This handles CJK (width 2), emoji, combining marks, etc.
        while (p < runEnd) {
            size_t charLen;
            char32_t cp;
            if constexpr (sizeof(Char) == 1) {
                charLen = 1;
                cp = static_cast<uint8_t>(*p);
            } else {
                cp = ANSI::decodeUTF16(p, dataEnd - p, charLen);
            }
            if (!processVisibleCp(cp, charLen)) goto walkDone;
        }

        if (p >= dataEnd) break;

        // p is at a byte the escape-SIMD mask matched. Verify & parse.
        if (ANSI::isEscapeCharacter(*p) || *p == 0x9c) {
            TokenType type = TokenType::Character;
            bool isSgr = false, isCanon = false, hlOpen = false;
            StringBuilder hlCode;
            String hlCP, hlTerm;
            const Char* after = tryParseAnsi(p, dataEnd, type, isSgr, isCanon, hlOpen, hlCode, hlCP, hlTerm);
            if (after) {
                if (!include) {
                    switch (type) {
                    case TokenType::Sgr:
                        applySgrToState(activeStyles, p, after);
                        break;
                    case TokenType::Hyperlink:
                        if (hlOpen) {
                            activeHyperlink = true;
                            activeHyperlinkCode = hlCode.toString();
                            activeHyperlinkClosePrefix = hlCP;
                            activeHyperlinkTerminator = hlTerm;
                        } else
                            activeHyperlink = false;
                        break;
                    default:
                        break;
                    }
                } else {
                    pending.append(Pending { p, after, type, hlOpen });
                    if (type == TokenType::Hyperlink)
                        pendingHl.append(std::make_tuple(hlCode.toString(), hlCP, hlTerm));
                }
                p = after;
                continue;
            }
        }

        // SIMD false positive: process as a single visible char.
        {
            size_t charLen;
            char32_t cp;
            if constexpr (sizeof(Char) == 1) {
                charLen = 1;
                cp = static_cast<uint8_t>(*p);
            } else {
                cp = ANSI::decodeUTF16(p, dataEnd - p, charLen);
            }
            if (!processVisibleCp(cp, charLen)) goto walkDone;
        }
    }
walkDone:;

    // Natural EOF (loop completed without breaking early at past-end).
    // Finalize the last cluster's width contribution, then flush trailing
    // pending ANSI. Match old Step 5 semantics: isPastEnd for trailing ANSI
    // is `position >= end` where position reflects the LAST visible char.
    // (If we broke early via sawCutEnd, pending was already flushed there
    // with close-only filtering; we don't re-finalize.)
    if (!sawCutEnd) {
        if (hasPrev) position += gs.width();
        // Trailing ANSI: if position >= end, it's post-cut → filter. Use the
        // ORIGINAL end bound (specEnd includes the spec zone; for filtering,
        // what matters is whether position exceeds the USER'S requested end,
        // which is `specEnd` when no ellipsis budget, or `end + budget` when
        // there is one — same thing).
        bool trailingPastEnd = !endUnbounded && position >= specEnd;
        if (include) flushPending(/*filterCloseOnly=*/trailingPastEnd);
    }

    if (!include) return emptyString();

    // Resolve lazy cutEnd: if we budgeted a spec zone and sawCutEnd → cut.
    // Otherwise (EOF reached without exceeding specEnd) → no cut, flush zone.
    if (ellipsisEndBudget > 0) {
        if (sawCutEnd) {
            // Cut confirmed: discard spec zone, keep ellipsis budget (emit ellipsis).
        } else {
            // No cut: append spec zone content, cancel ellipsis.
            result.append(specZone);
            needEndEllipsis = false;
        }
    }

    if (activeHyperlink) {
        result.append(activeHyperlinkClosePrefix);
        result.append(activeHyperlinkTerminator);
    }
    if (needEndEllipsis) result.append(ellipsis);
    activeStyles.emitCloseCodes(result);
    return result.toString();
}

template<typename Char>
static WTF::String sliceAnsiImpl(std::span<const Char> input, double startD, double endD, StringView ellipsis, size_t ellipsisWidth, bool ambiguousIsWide)
{
    if (input.empty())
        return emptyString();

    const Char* data = input.data();

    // No-op fast path: slice(s) / slice(s, 0) / slice(s, 0, undefined) with no
    // ellipsis. Returning null tells the JS binding to reuse the input JSString
    // (zero-copy). This check costs ~nothing and avoids the full-string walk for
    // the identity case regardless of content (ANSI, emoji, whatever).
    if (startD == 0 && !std::isfinite(endD) && endD > 0 && ellipsisWidth == 0)
        return WTF::String();

    // ========================================================================
    // SIMD fast path: printable-ASCII prefix → direct substring
    // ========================================================================
    // Bound the scan: we only need to know if the prefix covers the REQUESTED
    // range. For `"a".repeat(1M)` sliced at [0, 50), scanning past ~52 chars
    // is waste — we'll either find a non-ASCII byte (slow path) or reach the
    // cap (fast-path eligible). For negative indices or unbounded end, scan
    // the whole input (we need totalW for index resolution anyway).
    // +2 slop: one for the leave-one-behind char, one for a possible joiner.
    using SIMDLane = std::conditional_t<sizeof(Char) == 1, uint8_t, uint16_t>;
    size_t prefixScanLen = input.size();
    if (startD >= 0 && endD >= 0 && std::isfinite(endD)) {
        double cap = endD + 2;
        if (cap < static_cast<double>(input.size()))
            prefixScanLen = static_cast<size_t>(cap);
    }
    const size_t asciiPrefix = ANSI::firstNonAsciiPrintable(
        std::span { reinterpret_cast<const SIMDLane*>(data), prefixScanLen });

    // wholeStringAscii means the ENTIRE input is ASCII-printable — only
    // knowable when we scanned the whole thing. If we capped the scan and the
    // prefix fills the cap, we can't claim wholeStringAscii; instead we rely
    // on sliceInsidePrefix (which is true since endD < asciiPrefix).
    const bool wholeStringAscii = (prefixScanLen == input.size()) && (asciiPrefix == input.size());
    // Strict `<`: char at asciiPrefix might be a combining mark joining to
    // the last ASCII char — slice ending there needs the full path.
    const bool sliceInsidePrefix = (startD >= 0 && endD >= 0 && endD < static_cast<double>(asciiPrefix));
    if (wholeStringAscii || sliceInsidePrefix) {
        const size_t totalW = wholeStringAscii ? input.size() : asciiPrefix;
        SliceBounds b = resolveSliceBounds(startD, endD, totalW);
        if (b.empty) return emptyString();
        const bool cutEnd = wholeStringAscii ? b.cutEnd : true;
        if (!b.cutStart && !cutEnd)
            return WTF::String(); // null → zero-copy
        size_t st = b.start, en = b.end;
        if (ellipsisWidth > 0) {
            bool doStart = b.cutStart && ellipsisWidth < (en - st);
            if (doStart) st += ellipsisWidth;
            bool doEnd = cutEnd && ellipsisWidth < (en - st);
            if (doEnd) en -= ellipsisWidth;
            if (!doStart && !doEnd) return ellipsis.toString();
            StringView content(std::span { data + st, en - st });
            if (doStart && doEnd) return makeString(ellipsis, content, ellipsis);
            if (doStart) return makeString(ellipsis, content);
            return makeString(content, ellipsis);
        }
        return WTF::String(std::span { data + st, en - st });
    }

    // ========================================================================
    // Single-pass streaming emit (no Vector, inline grapheme clustering)
    // ========================================================================
    // Non-negative indices (99% case): ONE walk of input. totalWidth never
    //   computed; cutEnd detected lazily via the speculative zone.
    // Negative indices (rare): ONE width pre-pass + ONE emit walk.

    size_t start, end;
    bool cutEndKnown, cutEndHint;
    if (startD >= 0 && !(endD < 0)) {
        // Fast dispatch: no pre-pass. startD/endD are integer-valued doubles
        // (from toIntegerOrInfinity). Infinity and large finite values mean
        // "past any reasonable string width" — treat as unbounded.
        if (!std::isfinite(startD) || startD > static_cast<double>(input.size()) * 2)
            return emptyString(); // start past any possible width (max 2 cols/unit)
        start = static_cast<size_t>(startD);
        if (!std::isfinite(endD) || endD > static_cast<double>(input.size()) * 2) {
            end = SIZE_MAX; // unbounded
            cutEndKnown = true;
            cutEndHint = false; // emitting to EOF, never cut
        } else {
            end = static_cast<size_t>(endD);
            if (end <= start) return emptyString();
            cutEndKnown = false;
            cutEndHint = false; // detect lazily
        }
    } else {
        // Negative index: need totalWidth. ONE pre-pass.
        size_t totalW = computeTotalWidth<Char>(input, asciiPrefix, ambiguousIsWide);
        SliceBounds b = resolveSliceBounds(startD, endD, totalW);
        if (b.empty) return emptyString();
        start = b.start;
        end = b.end;
        cutEndKnown = true;
        cutEndHint = b.cutEnd;
    }

    return emitSliceStreaming<Char>(input, asciiPrefix, start, end,
        ellipsis, ellipsisWidth, /*cutStartForEllipsis=*/start > 0, cutEndKnown, cutEndHint,
        ambiguousIsWide);
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

    // Index parsing matches String.prototype.slice (StringPrototypeInlines.h):
    // keep as double, resolve/clamp in double space, cast only after the range
    // is proven to be in [0, totalWidth] which fits exactly in double. No UB,
    // no bespoke int64 clamping needed.
    double startD = startValue.isUndefined() ? 0.0
                                             : startValue.toIntegerOrInfinity(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // Default end is +Infinity ("to the end of the string").
    double endD = endValue.isUndefined() ? std::numeric_limits<double>::infinity()
                                         : endValue.toIntegerOrInfinity(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // 4th argument overloads (checked in order, no coercion):
    //   string  → ellipsis shorthand
    //   boolean → ambiguousIsNarrow shorthand (avoids {} allocation for the
    //             common case of just toggling ambiguous width)
    //   object  → { ellipsis?, ambiguousIsNarrow? }
    // 5th argument (only meaningful when 4th is string or undefined):
    //   boolean → ambiguousIsNarrow. Lets callers pass both ellipsis AND
    //             ambiguousIsNarrow without an object:
    //             sliceAnsi(s, 0, n, "…", false)
    //
    // Hold the JSString* (GC-rooted as a call argument) and its SafeView so
    // the underlying characters stay alive for the duration of sliceAnsiImpl.
    // No WTF::String materialization — we pass a zero-copy StringView.
    JSC::JSString* ellipsisJS = nullptr;
    bool ambiguousIsWide = false; // default: narrow (matches stringWidth/wrapAnsi)
    JSC::JSValue arg4 = callFrame->argument(3);
    if (arg4.isString()) {
        ellipsisJS = arg4.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        // 5th arg: ambiguousIsNarrow. Only checked on the string-ellipsis path
        // (object path has the option built in; boolean-4th conflicts).
        JSC::JSValue arg5 = callFrame->argument(4);
        if (arg5.isBoolean()) ambiguousIsWide = !arg5.asBoolean();
    } else if (arg4.isBoolean()) {
        // Boolean 4th → ambiguousIsNarrow only (no ellipsis).
        ambiguousIsWide = !arg4.asBoolean();
    } else if (arg4.isObject()) {
        JSC::JSObject* opts = arg4.getObject();
        JSC::JSValue e = opts->get(globalObject, JSC::Identifier::fromString(vm, "ellipsis"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (e.isString()) {
            ellipsisJS = e.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        JSC::JSValue a = opts->get(globalObject, JSC::Identifier::fromString(vm, "ambiguousIsNarrow"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!a.isUndefined()) ambiguousIsWide = !a.toBoolean(globalObject);
    } else if (arg4.isUndefined()) {
        // No 4th arg: still check 5th for ambiguousIsNarrow.
        // Enables sliceAnsi(s, a, b, undefined, false) for consistency.
        JSC::JSValue arg5 = callFrame->argument(4);
        if (arg5.isBoolean()) ambiguousIsWide = !arg5.asBoolean();
    }
    auto ellipsisSafeView = ellipsisJS ? ellipsisJS->view(globalObject) : decltype(ellipsisJS->view(globalObject)) {};
    RETURN_IF_EXCEPTION(scope, {});
    StringView ellipsis = ellipsisJS ? StringView(ellipsisSafeView) : StringView();

    size_t ellipsisWidth = 0;
    if (!ellipsis.isEmpty()) {
        ellipsisWidth = ellipsis.is8Bit()
            ? Bun__visibleWidthExcludeANSI_latin1(reinterpret_cast<const uint8_t*>(ellipsis.span8().data()), ellipsis.length())
            : Bun__visibleWidthExcludeANSI_utf16(reinterpret_cast<const uint16_t*>(ellipsis.span16().data()), ellipsis.length(), ambiguousIsWide);
    }

    WTF::String result;
    if (view->is8Bit()) {
        result = sliceAnsiImpl<Latin1Character>(view->span8(), startD, endD, ellipsis, ellipsisWidth, ambiguousIsWide);
    } else {
        result = sliceAnsiImpl<UChar>(view->span16(), startD, endD, ellipsis, ellipsisWidth, ambiguousIsWide);
    }

    // null → no-op fast path hit: return the input JSString unchanged (zero-copy).
    if (result.isNull())
        return JSC::JSValue::encode(jsString);
    if (result.isEmpty())
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));
    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

} // namespace Bun
