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
            return 2; // Single regional indicator is also width 2 (matching upstream)
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
        // Match upstream getGraphemeWidth behavior:
        // - Returns 2 if any codepoint is fullwidth
        // - Returns 1 otherwise (default)
        if (nonEmojiWidth >= 2)
            return 2;
        return 1;
    }
};

// ============================================================================
// ANSI Token Types & Parsing
// ============================================================================

// SGR open->close mapping (matching ansi-styles codes)
static uint32_t sgrCloseCode(uint32_t openCode)
{
    switch (openCode) {
    case 1:
    case 2:
        return 22;
    case 3:
        return 23;
    case 4:
        return 24;
    case 53:
        return 55;
    case 7:
        return 27;
    case 8:
        return 28;
    case 9:
        return 29;
    default:
        break;
    }

    if ((openCode >= 30 && openCode <= 37) || (openCode >= 90 && openCode <= 97))
        return 39;
    if ((openCode >= 40 && openCode <= 47) || (openCode >= 100 && openCode <= 107))
        return 49;

    // Extended color (38, 48) - handled in multi-param parsing
    if (openCode == 38)
        return 39;
    if (openCode == 48)
        return 49;

    return 0; // Unknown -> use reset
}

static bool isSgrEndCode(uint32_t code)
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

// Style state: maps endCode -> openCode string
// This matches the upstream approach using a Map<endCode, openCode>
struct SgrStyleState {
    // We store entries as (endCode, openCodeString) pairs
    // where endCode is the SGR code that closes this style
    struct Entry {
        String endCode; // e.g. "\x1b[39m"
        String openCode; // e.g. "\x1b[31m"
    };

    Vector<Entry> entries;

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

static String makeSgrCodeMulti(bool isC1, const Vector<uint32_t>& codes)
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

// Parse CSI parameters into individual numbers
static Vector<uint32_t> parseSgrParams(const UChar* paramStart, const UChar* paramEnd)
{
    Vector<uint32_t> params;
    uint32_t current = 0;
    bool hasDigit = false;

    for (const UChar* p = paramStart; p < paramEnd; ++p) {
        if (*p >= '0' && *p <= '9') {
            current = current * 10 + (*p - '0');
            hasDigit = true;
        } else if (*p == ';') {
            params.append(hasDigit ? current : 0);
            current = 0;
            hasDigit = false;
        } else if (*p == ':') {
            // Colon-separated parameters (e.g. 38:2:R:G:B) - skip for style tracking,
            // but we still store the whole sequence as an opaque open code
            params.append(hasDigit ? current : 0);
            current = 0;
            hasDigit = false;
        } else {
            break; // non-parameter character
        }
    }
    if (hasDigit || params.isEmpty())
        params.append(current);
    return params;
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

    // Convert params to UChar for parsing
    Vector<UChar> paramBuf;
    for (const Char* p = paramStart; p < paramEnd; ++p)
        paramBuf.append(static_cast<UChar>(*p));

    auto paramSpan = paramBuf.span();
    Vector<uint32_t> params = parseSgrParams(paramSpan.data(), paramSpan.data() + paramSpan.size());

    // Check if any param uses colon separators (opaque extended color)
    bool hasColon = false;
    for (const Char* p = paramStart; p < paramEnd; ++p) {
        if (*p == ':') {
            hasColon = true;
            break;
        }
    }

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
                    // 256-color: 38;5;N
                    Vector<uint32_t> openParams;
                    openParams.append(code);
                    openParams.append(5);
                    openParams.append(params[i + 2]);
                    state.applyStart(makeSgrCodeMulti(isC1, openParams), endStr);
                    i += 3;
                    continue;
                }
                if (colorType == 2 && i + 4 < params.size()) {
                    // Truecolor: 38;2;R;G;B
                    Vector<uint32_t> openParams;
                    openParams.append(code);
                    openParams.append(2);
                    openParams.append(params[i + 2]);
                    openParams.append(params[i + 3]);
                    openParams.append(params[i + 4]);
                    state.applyStart(makeSgrCodeMulti(isC1, openParams), endStr);
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
static bool shouldIncludeSgrAfterEnd(const Vector<uint32_t>& params, const SgrStyleState& activeStyles)
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
        return end; // unterminated
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
// Visible Character Info (for grapheme segmentation)
// ============================================================================

struct VisibleCharInfo {
    char32_t codepoint;
    uint8_t visibleWidth; // Width of this character (or 0 if grapheme continuation)
    bool isGraphemeContinuation;
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

    // ========================================================================
    // Step 1: Collect visible characters (stripping ANSI)
    // ========================================================================

    Vector<VisibleCharInfo> visibleChars;
    {
        const Char* p = data;
        while (p < dataEnd) {
            if (ANSI::isEscapeCharacter(*p) || *p == 0x9c) {
                // Try to parse as a recognized ANSI sequence
                // Note: 0x9C (C1 ST) is also a control character that should be consumed
                TokenType type;
                bool isSgr, isCanonicalSgr, isHyperlinkOpen;
                StringBuilder hlCodeBuilder;
                String hlClosePrefix, hlTerminator;
                const Char* after = tryParseAnsi(p, dataEnd, type, isSgr, isCanonicalSgr, isHyperlinkOpen, hlCodeBuilder, hlClosePrefix, hlTerminator);
                if (after) {
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
                cp = decodeUTF16Pair(p, dataEnd - p, charLen);
            }

            visibleChars.append(VisibleCharInfo { cp, 1, false });
            p += charLen;
        }
    }

    // ========================================================================
    // Step 2: Apply grapheme segmentation to visible characters
    // ========================================================================

    if (!visibleChars.isEmpty()) {
        // Reconstruct visible string from codepoints, then apply grapheme breaking
        uint32_t prevCp = 0;
        bool hasPrev = false;
        uint8_t breakState = 0;
        GraphemeWidthState graphemeState;

        size_t graphemeStartIdx = 0;

        for (size_t i = 0; i < visibleChars.size(); ++i) {
            char32_t cp = visibleChars[i].codepoint;

            if (hasPrev) {
                // Handle CR/LF manually since the grapheme breaker excludes control chars.
                // GB3: CR × LF (no break)
                // GB4: (Control | CR | LF) ÷ (break after)
                // GB5: ÷ (Control | CR | LF) (break before)
                bool shouldBreak;
                if (prevCp == 0x0D && cp == 0x0A) {
                    shouldBreak = false; // GB3: CR × LF
                } else if (prevCp == 0x0D || prevCp == 0x0A || cp == 0x0D || cp == 0x0A) {
                    shouldBreak = true; // GB4/GB5
                    breakState = 0; // Reset grapheme break state after control chars
                } else {
                    shouldBreak = Bun__graphemeBreak(prevCp, cp, &breakState);
                }
                if (shouldBreak) {
                    // End previous grapheme, compute its width
                    uint8_t w = graphemeState.width();
                    visibleChars[graphemeStartIdx].visibleWidth = w;
                    for (size_t j = graphemeStartIdx + 1; j < i; ++j) {
                        visibleChars[j].visibleWidth = 0;
                        visibleChars[j].isGraphemeContinuation = true;
                    }
                    graphemeStartIdx = i;
                    graphemeState.reset(cp, ambiguousIsWide);
                } else {
                    graphemeState.add(cp, ambiguousIsWide);
                }
            } else {
                graphemeState.reset(cp, ambiguousIsWide);
            }
            prevCp = cp;
            hasPrev = true;
        }
        // Finalize last grapheme
        if (hasPrev) {
            uint8_t w = graphemeState.width();
            visibleChars[graphemeStartIdx].visibleWidth = w;
            for (size_t j = graphemeStartIdx + 1; j < visibleChars.size(); ++j) {
                visibleChars[j].visibleWidth = 0;
                visibleChars[j].isGraphemeContinuation = true;
            }
        }
    }

    // ========================================================================
    // Step 3: Compute total visible width if needed for negative indices
    // ========================================================================

    size_t totalWidth = 0;
    if (startIdx < 0 || endIdx < 0) {
        for (const auto& vc : visibleChars)
            totalWidth += vc.visibleWidth;

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

    // ========================================================================
    // Step 4: Build a "has continuation ahead" map for handling ANSI codes
    //         that appear between grapheme continuation characters
    // ========================================================================

    // We need to know, for each position in the original string, whether
    // the next visible character is a grapheme continuation. This tells us
    // whether to include ANSI codes that appear between grapheme parts.

    // ========================================================================
    // Step 5: Walk through the original string, applying slice logic
    // ========================================================================

    StringBuilder result;
    result.reserveCapacity(input.size());

    SgrStyleState activeStyles;
    bool activeHyperlink = false;
    String activeHyperlinkClosePrefix;
    String activeHyperlinkTerminator;
    String activeHyperlinkCode;

    size_t position = 0; // current visible width position
    bool include = false; // are we currently including characters?
    size_t visibleCharIdx = 0;

    // Build a map: for each token position, is there a continuation character ahead?
    // We do this by pre-scanning ahead for each ANSI token.

    const Char* p = data;
    while (p < dataEnd) {
        // Check for ANSI sequence (including 0x9C which is C1 ST)
        if (ANSI::isEscapeCharacter(*p) || *p == 0x9c) {
            TokenType type = TokenType::Character;
            bool isSgr = false, isCanonicalSgr = false, isHyperlinkOpen = false;
            StringBuilder hlCodeBuilder;
            String hlClosePrefix, hlTerminator;
            const Char* after = tryParseAnsi(p, dataEnd, type, isSgr, isCanonicalSgr, isHyperlinkOpen, hlCodeBuilder, hlClosePrefix, hlTerminator);

            if (after) {
                bool isPastEnd = (end != static_cast<size_t>(INT64_MAX)) && position >= end;

                // Check if next visible character is a grapheme continuation
                // (meaning this ANSI code is inside a grapheme cluster)
                bool continuationAhead = false;
                if (visibleCharIdx < visibleChars.size()) {
                    // The next visible char hasn't been consumed yet
                    continuationAhead = visibleChars[visibleCharIdx].isGraphemeContinuation;
                } else {
                    // Look ahead in remaining visible chars
                    // We're past all visible chars
                }

                if (isPastEnd && type != TokenType::Character && continuationAhead) {
                    isPastEnd = false;
                }

                switch (type) {
                case TokenType::Sgr: {
                    // Parse SGR params for shouldIncludeSgrAfterEnd check
                    if (isPastEnd) {
                        // Extract params from the sequence
                        const Char* paramStart;
                        if (*p == 0x9b)
                            paramStart = p + 1;
                        else
                            paramStart = p + 2;
                        Vector<UChar> paramBuf;
                        for (const Char* q = paramStart; q < after - 1; ++q)
                            paramBuf.append(static_cast<UChar>(*q));
                        auto paramSpan2 = paramBuf.span();
                        Vector<uint32_t> params = parseSgrParams(paramSpan2.data(), paramSpan2.data() + paramSpan2.size());

                        if (!shouldIncludeSgrAfterEnd(params, activeStyles)) {
                            p = after;
                            continue;
                        }
                    }

                    applySgrToState(activeStyles, p, after);
                    if (include) {
                        for (const Char* q = p; q < after; ++q)
                            result.append(static_cast<UChar>(*q));
                    }
                    break;
                }
                case TokenType::Hyperlink: {
                    bool isClose = !isHyperlinkOpen;
                    if (isPastEnd && (isClose == false || !activeHyperlink)) {
                        p = after;
                        continue;
                    }

                    if (isHyperlinkOpen) {
                        activeHyperlink = true;
                        activeHyperlinkClosePrefix = hlClosePrefix;
                        activeHyperlinkTerminator = hlTerminator;
                        activeHyperlinkCode = hlCodeBuilder.toString();
                    } else {
                        activeHyperlink = false;
                    }

                    if (include) {
                        for (const Char* q = p; q < after; ++q)
                            result.append(static_cast<UChar>(*q));
                    }
                    break;
                }
                case TokenType::Control: {
                    if (!isPastEnd && include) {
                        for (const Char* q = p; q < after; ++q)
                            result.append(static_cast<UChar>(*q));
                    }
                    break;
                }
                default:
                    break;
                }

                p = after;
                continue;
            }
        }

        // It's a visible character
        bool isPastEnd = (end != static_cast<size_t>(INT64_MAX)) && position >= end;

        // Get grapheme info for this visible character
        bool isGraphemeContinuation = false;
        uint8_t visibleWidth = 1;
        if (visibleCharIdx < visibleChars.size()) {
            isGraphemeContinuation = visibleChars[visibleCharIdx].isGraphemeContinuation;
            visibleWidth = visibleChars[visibleCharIdx].visibleWidth;
            visibleCharIdx++;
        }

        // If past end and not a continuation, we're done
        if (isPastEnd && !isGraphemeContinuation)
            break;

        // Decode the character
        size_t charLen;
        if constexpr (sizeof(Char) == 1) {
            charLen = 1;
        } else {
            char32_t cp = decodeUTF16Pair(p, dataEnd - p, charLen);
            (void)cp;
        }

        // Check if we should start including
        if (!include && position >= start && !isGraphemeContinuation) {
            include = true;
            // Emit active styles
            activeStyles.emitOpenCodes(result);
            if (activeHyperlink) {
                result.append(activeHyperlinkCode);
            }
        }

        if (include) {
            for (size_t i = 0; i < charLen; ++i)
                result.append(static_cast<UChar>(p[i]));
        }

        position += visibleWidth;
        p += charLen;
    }

    if (!include)
        return emptyString();

    // Close active hyperlink
    if (activeHyperlink) {
        result.append(activeHyperlinkClosePrefix);
        result.append(activeHyperlinkTerminator);
    }

    // Close active styles
    activeStyles.emitCloseCodes(result);

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
