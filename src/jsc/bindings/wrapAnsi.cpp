#include "root.h"
#include "wrapAnsi.h"
#include "ANSIHelpers.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/Vector.h>
#include <wtf/MathExtras.h>
#include <cmath>

// Native exports (implemented in stringWidth.cpp) for visible width calculation
extern "C" size_t Bun__visibleWidthExcludeANSI_utf16(const uint16_t* ptr, size_t len, bool ambiguous_as_wide);
extern "C" size_t Bun__visibleWidthExcludeANSI_latin1(const uint8_t* ptr, size_t len, bool ambiguous_as_wide);
extern "C" uint8_t Bun__codepointWidth(uint32_t cp, bool ambiguous_as_wide);
extern "C" bool Bun__graphemeBreak(uint32_t cp1, uint32_t cp2, uint8_t* state);

namespace Bun {
using namespace WTF;

// UTF-16 decoding and codepoint width are in ANSIHelpers.h (shared with
// sliceAnsi.cpp). The local wrapper here just delegates to keep existing
// call sites unchanged.
static inline char32_t decodeUTF16(const UChar* ptr, size_t available, size_t& outLen)
{
    return ANSI::decodeUTF16(ptr, available, outLen);
}

static inline uint8_t getVisibleWidth(char32_t cp, bool ambiguousIsWide)
{
    return Bun__codepointWidth(cp, ambiguousIsWide);
}

// Options for wrapping
struct WrapAnsiOptions {
    bool hard = false;
    bool wordWrap = true;
    bool trim = true;
    bool ambiguousIsNarrow = true;
};

// ============================================================================
// String Width Calculation
// ============================================================================

template<typename Char>
static size_t stringWidth(const Char* start, const Char* end, bool ambiguousIsNarrow)
{
    size_t len = end - start;
    if (len == 0)
        return 0;

    if constexpr (sizeof(Char) == 1) {
        // 8-bit JSC strings are Latin1, not UTF-8; U+00A1-U+00FF holds East
        // Asian Ambiguous codepoints (§ ° ± ×), so the flag applies here too.
        return Bun__visibleWidthExcludeANSI_latin1(reinterpret_cast<const uint8_t*>(start), len, !ambiguousIsNarrow);
    } else {
        return Bun__visibleWidthExcludeANSI_utf16(reinterpret_cast<const uint16_t*>(start), len, !ambiguousIsNarrow);
    }
}

// A word may begin with ANSI escape sequences whose code units are all ASCII
// (ESC, '[', digits, 'm'), hiding the codepoint that actually lands on the seam.
// Skip them before classifying; a word not starting with ESC never enters the scan.
template<typename Char>
static inline const Char* skipLeadingAnsi(const Char* start, const Char* end)
{
    if (start < end && ANSI::isEscapeCharacter(*start))
        return ANSI::consumeANSI(start, end);
    return start;
}

// True when a grapheme cluster boundary always precedes the word's first codepoint
// (worst-case predecessor: the separator space). A word-initial cluster-fusing
// codepoint (combining mark, ZWJ, VS16, keycap) makes row widths non-additive.
template<typename Char>
static inline bool wordStartsNewCluster(const Char* wordStart, const Char* wordEnd)
{
    wordStart = skipLeadingAnsi(wordStart, wordEnd);
    if (wordStart >= wordEnd)
        return true;
    char32_t cp;
    if constexpr (sizeof(Char) == 1) {
        cp = static_cast<char32_t>(static_cast<uint8_t>(*wordStart));
    } else {
        size_t cpLen;
        cp = decodeUTF16(reinterpret_cast<const UChar*>(wordStart), wordEnd - wordStart, cpLen);
    }
    if (cp < 0x80)
        return true;
    uint8_t state = 0;
    return Bun__graphemeBreak(' ', cp, &state);
}

// Without a separator space the row's trailing content is the word's real
// predecessor, and a trailing escape can hide a cluster-fusing codepoint
// (e.g. a Prepend): only an ASCII/ASCII seam keeps row widths additive.
template<typename Char>
static inline bool wordSeamIsAscii(Char rowTail, const Char* wordStart, const Char* wordEnd)
{
    wordStart = skipLeadingAnsi(wordStart, wordEnd);
    if (wordStart >= wordEnd)
        return true;
    return static_cast<char32_t>(rowTail) < 0x80 && static_cast<char32_t>(*wordStart) < 0x80;
}

// Return the separator space that ends the word starting at `start` (or
// `end`). An escape sequence is opaque — a space inside its payload (an OSC
// hyperlink URL, a CSI intermediate byte) does not separate words.
template<typename Char>
static const Char* findWordSeparator(const Char* start, const Char* end)
{
    const auto nextSpace = [end](const Char* from) {
        size_t pos = WTF::find(std::span<const Char>(from, end), static_cast<Char>(' '));
        return pos == WTF::notFound ? end : from + pos;
    };
    const Char* space = nextSpace(start);
    for (const Char* it = start;;) {
        const Char* esc = ANSI::findEscapeCharacter(it, space);
        if (!esc)
            return space;
        // findEscapeCharacter also stops at the standalone C1 ST (0x9c),
        // which introduces nothing; consumeANSI leaves it in place.
        const Char* after = ANSI::consumeANSI(esc, end);
        it = after > esc ? after : esc + 1;
        // Re-scan for a separator only when the escape swallowed the last one.
        if (it > space)
            space = nextSpace(it);
    }
}

// ============================================================================
// Row Management (using WTF::Vector)
// ============================================================================

template<typename Char>
class Row {
public:
    Vector<Char> m_data;

    void append(Char c)
    {
        m_data.append(c);
    }

    void append(const Char* start, const Char* end)
    {
        m_data.append(std::span { start, end });
    }

    void append(const Row& other)
    {
        m_data.appendVector(other.m_data);
    }

    size_t width(bool ambiguousIsNarrow) const
    {
        if (m_data.isEmpty())
            return 0;
        auto span = m_data.span();
        return stringWidth(span.data(), span.data() + span.size(), ambiguousIsNarrow);
    }

    size_t trimLeadingSpaces()
    {
        if (m_leadingTrimComplete)
            return 0;

        auto span = m_data.mutableSpan();
        Char* const data = span.data();
        const size_t size = span.size();
        size_t read = m_trimScanOffset;
        size_t write = m_trimScanOffset;
        size_t removedWidth = 0;

        while (read < size) {
            Char c = data[read];
            if (ANSI::isEscapeCharacter(c)) {
                // Keep the whole sequence; only the separator spaces around it go.
                const size_t seqLen = ANSI::consumeANSI(data + read, data + size) - (data + read);
                if (write != read)
                    memmove(data + write, data + read, seqLen * sizeof(Char));
                read += seqLen;
                write += seqLen;
            } else if (c == ' ' || c == '\t') {
                if (c == ' ')
                    removedWidth++;
                read++;
            } else {
                m_leadingTrimComplete = true;
                break;
            }
        }

        if (write != read) {
            while (read < size) {
                data[write] = data[read];
                write++;
                read++;
            }
            m_data.shrink(write);
        }

        m_trimScanOffset = write;
        return removedWidth;
    }

    size_t m_trimScanOffset = 0;
    bool m_leadingTrimComplete = false;
};

// ============================================================================
// Word Wrapping Core Logic
// ============================================================================

template<typename Char>
static void wrapWord(Vector<Row<Char>>& rows, const Char* wordStart, const Char* wordEnd, size_t columns, const WrapAnsiOptions& options)
{
    size_t vis = rows.last().width(options.ambiguousIsNarrow);

    const Char* it = wordStart;
    while (it < wordEnd) {
        // An escape sequence is zero-width and never split across rows.
        if (ANSI::isEscapeCharacter(*it)) {
            const Char* seqEnd = ANSI::consumeANSI(it, wordEnd);
            rows.last().append(it, seqEnd);
            it = seqEnd;
            continue;
        }

        size_t charLen = 1;
        char32_t cp;
        if constexpr (sizeof(Char) == 1) {
            // Latin1: each byte is one character, direct 1:1 mapping to U+0000-U+00FF
            cp = static_cast<uint8_t>(*it);
        } else {
            cp = decodeUTF16(it, wordEnd - it, charLen);
        }
        uint8_t charWidth = getVisibleWidth(cp, !options.ambiguousIsNarrow);

        if (vis + charWidth > columns) {
            // Character doesn't fit on current line, start a new line
            rows.append(Row<Char>());
            vis = 0;
        }
        rows.last().append(it, it + charLen);
        vis += charWidth;
        it += charLen;

        if (vis == columns && it < wordEnd) {
            rows.append(Row<Char>());
            vis = 0;
        }
    }

    // Handle edge case: last row is only ANSI escape codes
    if (vis == 0 && !rows.last().m_data.isEmpty() && rows.size() > 1) {
        Row<Char> lastRow = std::move(rows.last());
        rows.removeLast();
        rows.last().append(lastRow);
    }
}

template<typename Char>
static void trimRowTrailingSpaces(Row<Char>& row, bool ambiguousIsNarrow)
{
    auto span = row.m_data.span();
    const Char* const data = span.data();
    const Char* const end = data + span.size();

    // Find the end of the last space-delimited word with visible content
    const Char* lastVisibleEnd = data;
    for (const Char* wordStart = data;;) {
        const Char* wordEnd = findWordSeparator(wordStart, end);
        if (stringWidth(wordStart, wordEnd, ambiguousIsNarrow) > 0)
            lastVisibleEnd = wordEnd;
        if (wordEnd == end)
            break;
        wordStart = wordEnd + 1;
    }

    if (lastVisibleEnd == end)
        return;

    // wrap-ansi's stringVisibleTrimSpacesRight: past the last visible word only
    // the separator spaces go; escapes and zero-width text stay.
    Vector<Char> tail;
    for (const Char* it = lastVisibleEnd; it != end;) {
        if (ANSI::isEscapeCharacter(*it)) {
            const Char* seqEnd = ANSI::consumeANSI(it, end);
            tail.append(std::span { it, seqEnd });
            it = seqEnd;
        } else {
            if (*it != ' ')
                tail.append(*it);
            ++it;
        }
    }

    row.m_data.shrink(lastVisibleEnd - data);
    row.m_data.appendVector(tail);
}

// ============================================================================
// SGR Code Parsing and Style Preservation
// ============================================================================

static constexpr uint32_t END_CODE = 39;

// Parse a CSI parameter body (after the introducer) as a single numeric SGR
// code: digits followed by the final byte 'm'.
template<typename Char>
static std::optional<uint32_t> parseSgrCode(const Char* body, const Char* end)
{
    uint32_t code = 0;
    for (const Char* it = body; it < end; ++it) {
        Char c = *it;
        if (c >= '0' && c <= '9') {
            code = code * 10 + (c - '0');
        } else if (c == 'm') {
            return code;
        } else {
            break;
        }
    }

    return std::nullopt;
}

// A hyperlink is OSC 8: introducer, "8;", params, ';', URI, then BEL / ESC \ /
// C1 ST. `link` covers "params;URI" so id= params are kept when re-opening;
// an empty URI closes the current link.
template<typename Char>
struct HyperlinkState {
    const Char* link = nullptr;
    size_t linkLen = 0;
};

// Classify the single escape sequence at `seq` and return its end (never
// less than seq + 1): an SGR CSI (ESC [ or 0x9b) opens/closes a style, a
// terminated OSC 8 (ESC ] or 0x9d) opens/closes a hyperlink, and the
// payload of any other sequence is skipped so its bytes are never re-parsed.
// Terminators follow ANSI::consumeANSI: ESC re-introduces a new sequence
// (this one ends before it), CAN/SUB abort with the byte consumed.
template<typename Char>
static const Char* trackEscape(const Char* seq, const Char* end, std::optional<uint32_t>& escapeCode, HyperlinkState<Char>& hyperlink)
{
    const Char* body;
    bool isCsi = false;
    bool isOsc = false;
    switch (static_cast<char32_t>(*seq)) {
    case 0x1b: {
        if (end - seq < 2)
            return end;
        const Char next = seq[1];
        body = seq + 2;
        if (next == '[') {
            isCsi = true;
        } else if (next == ']') {
            isOsc = true;
        } else if (next == 'P' || next == 'X' || next == '^' || next == '_') {
            // DCS / SOS / PM / APC control string
        } else if (next >= 0x20 && next <= 0x2f) {
            // nF: ESC, intermediate byte, one more code unit (an ESC there aborts it).
            return (end - seq >= 3 && body[0] != 0x1b) ? seq + 3 : body;
        } else if (next >= 0x30 && next <= 0x7e) {
            return body; // Fe / Fs two-byte sequence (ESC 7, ESC c)
        } else {
            return seq + 1; // lone ESC: the next byte cannot continue a sequence
        }
        break;
    }
    case 0x9b:
        isCsi = true;
        body = seq + 1;
        break;
    case 0x9d:
        isOsc = true;
        body = seq + 1;
        break;
    case 0x90:
    case 0x98:
    case 0x9e:
    case 0x9f:
        body = seq + 1; // C1 DCS / SOS / PM / APC control string
        break;
    default:
        return seq + 1; // standalone C1 ST (0x9c) introduces nothing
    }

    if (isCsi) {
        // ECMA-48 §5.4: parameters until a final byte in [0x40, 0x7E]; ESC,
        // CAN, SUB and the C1 ST abort the sequence.
        const Char* seqEnd = end;
        for (const Char* it = body; it < end; ++it) {
            const char32_t c = static_cast<char32_t>(*it);
            if (c == 0x1b) {
                seqEnd = it;
                break;
            }
            if ((c >= 0x40 && c <= 0x7e) || c == 0x18 || c == 0x1a || c == 0x9c) {
                seqEnd = it + 1;
                break;
            }
        }
        if (auto code = parseSgrCode(body, seqEnd)) {
            if (*code == END_CODE || *code == 0)
                escapeCode = std::nullopt;
            else
                escapeCode = *code;
        }
        return seqEnd;
    }

    // OSC ends at BEL; OSC and the control strings end at ST (C1 0x9c or
    // ESC \). ESC otherwise, CAN and SUB abort the string (VT510: the payload
    // is discarded), so only a terminated OSC 8 updates the hyperlink.
    const Char* seqEnd = end;
    const Char* payloadEnd = end;
    bool terminated = false;
    for (const Char* it = body; it < end; ++it) {
        const char32_t c = static_cast<char32_t>(*it);
        if (c == 0x1b) {
            payloadEnd = it;
            terminated = it + 1 < end && it[1] == '\\';
            seqEnd = terminated ? it + 2 : it;
            break;
        }
        if ((isOsc && c == 0x07) || c == 0x9c) {
            payloadEnd = it;
            seqEnd = it + 1;
            terminated = true;
            break;
        }
        if (c == 0x18 || c == 0x1a) {
            payloadEnd = it;
            seqEnd = it + 1;
            break;
        }
    }

    if (!isOsc || !terminated || payloadEnd - body < 2 || body[0] != '8' || body[1] != ';')
        return seqEnd;

    const Char* params = body + 2;
    const Char* uri = params;
    while (uri < payloadEnd && *uri != ';')
        ++uri;
    if (uri == payloadEnd)
        return seqEnd; // malformed: no URI field
    ++uri;
    if (uri == payloadEnd) {
        hyperlink.link = nullptr;
        hyperlink.linkLen = 0;
    } else {
        hyperlink.link = params;
        hyperlink.linkLen = payloadEnd - params;
    }
    return seqEnd;
}

// One table for every SGR-tracking API: the shared close-code map in
// ANSIHelpers.h (also used by sliceAnsi). 0 there means "no close known".
static std::optional<uint32_t> getCloseCode(uint32_t code)
{
    const uint32_t close = ANSI::sgrCloseCode(code);
    return close ? std::optional<uint32_t>(close) : std::nullopt;
}

template<typename Char>
static void joinRowsWithAnsiPreservation(const Vector<Row<Char>>& rows, StringBuilder& result)
{
    std::optional<uint32_t> escapeCode;
    HyperlinkState<Char> hyperlink;

    for (size_t rowIndex = 0; rowIndex < rows.size(); ++rowIndex) {
        if (rowIndex > 0) {
            result.append('\n');
            // Restore styles after newline (only open codes; close/unknown codes
            // have no close mapping and are not re-emitted, matching npm wrap-ansi)
            if (escapeCode && getCloseCode(*escapeCode)) {
                result.append("\x1b["_s);
                result.append(String::number(*escapeCode));
                result.append('m');
            }
            if (hyperlink.link) {
                result.append("\x1b]8;"_s);
                result.append(std::span<const Char>(hyperlink.link, hyperlink.linkLen));
                result.append(static_cast<UChar>(0x07));
            }
        }

        auto span = rows[rowIndex].m_data.span();
        const Char* it = span.data();
        const Char* const end = it + span.size();
        while (it != end) {
            const Char* esc = ANSI::findEscapeCharacter(it, end);
            if (!esc) {
                result.append(std::span<const Char>(it, end));
                break;
            }
            const Char* seqEnd = trackEscape(esc, end, escapeCode, hyperlink);
            result.append(std::span<const Char>(it, seqEnd));
            it = seqEnd;
        }

        if (rowIndex + 1 < rows.size()) {
            // Close styles before newline
            if (hyperlink.link)
                result.append("\x1b]8;;\x07"_s);
            if (escapeCode) {
                if (auto closeCode = getCloseCode(*escapeCode)) {
                    result.append("\x1b["_s);
                    result.append(String::number(*closeCode));
                    result.append('m');
                }
            }
        }
    }
}

// ============================================================================
// Main Line Processing
// ============================================================================

template<typename Char>
static void processLine(const Char* lineStart, const Char* lineEnd, size_t columns, const WrapAnsiOptions& options, Vector<Row<Char>>& rows)
{
    // Handle empty or whitespace-only strings with trim
    if (options.trim) {
        const Char* trimStart = lineStart;
        const Char* trimEnd = lineEnd;
        while (trimStart < trimEnd && (*trimStart == ' ' || *trimStart == '\t'))
            trimStart++;
        while (trimEnd > trimStart && (*(trimEnd - 1) == ' ' || *(trimEnd - 1) == '\t'))
            trimEnd--;
        if (trimStart >= trimEnd)
            return;
    }

    // Start with empty first row
    rows.append(Row<Char>());

    size_t lastRowWidth = 0;
    bool lastRowWidthDirty = false;

    const auto placeWord = [&](const Char* wordStart, const Char* wordEnd, size_t wordIndex) {
        if (options.trim) {
            size_t removedWidth = rows.last().trimLeadingSpaces();
            if (!lastRowWidthDirty)
                lastRowWidth = removedWidth < lastRowWidth ? lastRowWidth - removedWidth : 0;
        }

        if (lastRowWidthDirty) {
            lastRowWidth = rows.last().width(options.ambiguousIsNarrow);
            lastRowWidthDirty = false;
        }

        size_t rowLength = lastRowWidth;
        bool spacePrecedesWord = true;
        Char rowTail = static_cast<Char>(' ');

        if (wordIndex != 0) {
            if (rowLength >= columns && (!options.wordWrap || !options.trim)) {
                rows.append(Row<Char>());
                rowLength = 0;
            }

            if (rowLength > 0 || !options.trim) {
                rows.last().append(static_cast<Char>(' '));
                rowLength++;
            } else if (!rows.last().m_data.isEmpty()) {
                spacePrecedesWord = false;
                rowTail = rows.last().m_data.last();
            }
        }

        size_t wordLen = stringWidth(wordStart, wordEnd, options.ambiguousIsNarrow);

        // Hard wrap mode
        if (options.hard && wordLen > columns) {
            size_t remainingColumns = columns > rowLength ? columns - rowLength : 0;
            size_t breaksStartingThisLine = 1 + (wordLen > remainingColumns ? (wordLen - remainingColumns - 1) / columns : 0);
            size_t breaksStartingNextLine = wordLen > 0 ? (wordLen - 1) / columns : 0;
            if (breaksStartingNextLine < breaksStartingThisLine)
                rows.append(Row<Char>());

            wrapWord(rows, wordStart, wordEnd, columns, options);
            lastRowWidthDirty = true;
            return;
        }

        if (rowLength + wordLen > columns && rowLength > 0 && wordLen > 0) {
            if (!options.wordWrap && rowLength < columns) {
                wrapWord(rows, wordStart, wordEnd, columns, options);
                lastRowWidthDirty = true;
                return;
            }

            rows.append(Row<Char>());
            rowLength = 0;
        }

        if (rowLength + wordLen > columns && !options.wordWrap) {
            wrapWord(rows, wordStart, wordEnd, columns, options);
            lastRowWidthDirty = true;
            return;
        }

        rows.last().append(wordStart, wordEnd);
        if (spacePrecedesWord ? wordStartsNewCluster(wordStart, wordEnd) : wordSeamIsAscii(rowTail, wordStart, wordEnd))
            lastRowWidth = rowLength + wordLen;
        else
            lastRowWidthDirty = true;
    };

    const Char* wordStart = lineStart;
    for (size_t wordIndex = 0;; ++wordIndex) {
        const Char* wordEnd = findWordSeparator(wordStart, lineEnd);
        placeWord(wordStart, wordEnd, wordIndex);
        if (wordEnd == lineEnd)
            break;
        wordStart = wordEnd + 1;
    }

    // Trim trailing whitespace from rows if needed
    if (options.trim) {
        for (auto& row : rows)
            trimRowTrailingSpaces(row, options.ambiguousIsNarrow);
    }
}

// ============================================================================
// Main Implementation
// ============================================================================

template<typename Char>
static WTF::String wrapAnsiImpl(std::span<const Char> input, size_t columns, const WrapAnsiOptions& options)
{
    if (columns == 0 || input.empty()) {
        // Return copy of input
        StringBuilder result;
        result.reserveCapacity(input.size());
        for (auto c : input)
            result.append(static_cast<UChar>(c));
        return result.toString();
    }

    // Process each line separately. \n, a bare \r and a \r\n pair each
    // break a line and are emitted as one \n — callers (Claude Code's
    // wrap-text) map wrapped output back to the original text by relying on
    // every \r becoming a break.
    StringBuilder result;
    result.reserveCapacity(input.size() + input.size() / 10);

    const Char* lineStart = input.data();
    const Char* const dataEnd = input.data() + input.size();
    bool firstLine = true;

    while (true) {
        auto remaining = std::span<const Char>(lineStart, dataEnd);
        size_t brPos = WTF::notFound;
        for (size_t k = 0; k < remaining.size(); ++k) {
            if (remaining[k] == '\n' || remaining[k] == '\r') {
                brPos = k;
                break;
            }
        }
        const Char* lineEnd = (brPos == WTF::notFound) ? dataEnd : lineStart + brPos;

        // Add newline between input lines
        if (!firstLine)
            result.append('\n');
        firstLine = false;

        // Process this input line
        Vector<Row<Char>> lineRows;
        processLine(lineStart, lineEnd, columns, options, lineRows);

        // Join and append this line's rows with ANSI preservation
        if (!lineRows.isEmpty()) {
            joinRowsWithAnsiPreservation(lineRows, result);
        }

        if (lineEnd == dataEnd)
            break;
        // A \r\n pair is one break: step over both.
        lineStart = (*lineEnd == '\r' && lineEnd + 1 != dataEnd && *(lineEnd + 1) == '\n') ? lineEnd + 2 : lineEnd + 1;
    }

    return result.toString();
}

// ============================================================================
// JavaScript Binding
// ============================================================================

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunWrapAnsi, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get arguments
    JSC::JSValue inputValue = callFrame->argument(0);
    JSC::JSValue columnsValue = callFrame->argument(1);
    JSC::JSValue optionsValue = callFrame->argument(2);

    // Convert input to string
    JSC::JSString* jsString = inputValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (view->isEmpty())
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));

    // Get columns
    size_t columns = 0;
    if (!columnsValue.isUndefined()) {
        double colsDouble = columnsValue.toIntegerOrInfinity(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        // Only set columns if positive and finite (negative values would wrap to huge size_t)
        if (colsDouble > 0 && std::isfinite(colsDouble))
            columns = truncateDoubleToUint64(colsDouble);
    }

    // Parse options
    WrapAnsiOptions options;
    if (optionsValue.isObject()) {
        JSC::JSObject* optionsObj = optionsValue.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSC::JSValue hardValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "hard"_s));
        RETURN_IF_EXCEPTION(scope, {});
        options.hard = hardValue.toBoolean(globalObject);

        // wordWrap and trim default on: only an explicit `false` disables them
        // (wrap-ansi's `!== false`); other falsy values keep the default.
        JSC::JSValue wordWrapValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "wordWrap"_s));
        RETURN_IF_EXCEPTION(scope, {});
        options.wordWrap = !wordWrapValue.isFalse();

        JSC::JSValue trimValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "trim"_s));
        RETURN_IF_EXCEPTION(scope, {});
        options.trim = !trimValue.isFalse();

        JSC::JSValue ambiguousValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "ambiguousIsNarrow"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!ambiguousValue.isUndefined())
            options.ambiguousIsNarrow = ambiguousValue.toBoolean(globalObject);
    }

    // Process based on encoding
    WTF::String result;
    if (view->is8Bit()) {
        result = wrapAnsiImpl<Latin1Character>(view->span8(), columns, options);
    } else {
        result = wrapAnsiImpl<UChar>(view->span16(), columns, options);
    }

    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

} // namespace Bun
