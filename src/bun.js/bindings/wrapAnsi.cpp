#include "root.h"
#include "wrapAnsi.h"
#include "ANSIHelpers.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/Vector.h>
#include <cmath>

// Zig exports for visible width calculation
extern "C" size_t Bun__visibleWidthExcludeANSI_utf16(const uint16_t* ptr, size_t len, bool ambiguous_as_wide);
extern "C" size_t Bun__visibleWidthExcludeANSI_latin1(const uint8_t* ptr, size_t len);
extern "C" uint8_t Bun__codepointWidth(uint32_t cp, bool ambiguous_as_wide);

namespace Bun {
using namespace WTF;

// ============================================================================
// UTF-16 Decoding Utilities (needed for hard wrap with surrogate pairs)
// ============================================================================

static char32_t decodeUTF16(const UChar* ptr, size_t available, size_t& outLen)
{
    UChar c = ptr[0];

    // Check for surrogate pair
    if (c >= 0xD800 && c <= 0xDBFF && available >= 2) {
        UChar c2 = ptr[1];
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
            outLen = 2;
            return 0x10000 + (((c - 0xD800) << 10) | (c2 - 0xDC00));
        }
    }

    outLen = 1;
    return c;
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
// String Width Calculation (using Zig implementation)
// ============================================================================

template<typename Char>
static size_t stringWidth(const Char* start, const Char* end, bool ambiguousIsNarrow)
{
    size_t len = end - start;
    if (len == 0)
        return 0;

    if constexpr (sizeof(Char) == 1) {
        // 8-bit JSC strings are Latin1, not UTF-8
        // Note: Latin1 doesn't have ambiguous width characters (all are in U+0000-U+00FF)
        (void)ambiguousIsNarrow;
        return Bun__visibleWidthExcludeANSI_latin1(reinterpret_cast<const uint8_t*>(start), len);
    } else {
        return Bun__visibleWidthExcludeANSI_utf16(reinterpret_cast<const uint16_t*>(start), len, !ambiguousIsNarrow);
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

    void trimLeadingSpaces()
    {
        size_t removeCount = 0;
        bool inEscape = false;

        // Count leading spaces (preserving ANSI)
        for (size_t i = 0; i < m_data.size(); ++i) {
            Char c = m_data[i];
            if (c == 0x1b) {
                inEscape = true;
                continue;
            }
            if (inEscape) {
                if (c == 'm' || c == 0x07)
                    inEscape = false;
                continue;
            }
            if (c == ' ' || c == '\t')
                removeCount++;
            else
                break;
        }

        if (removeCount == 0)
            return;

        // Remove spaces while preserving ANSI codes
        Vector<Char> newData;
        newData.reserveCapacity(m_data.size() - removeCount);

        inEscape = false;
        size_t removed = 0;

        for (size_t i = 0; i < m_data.size(); ++i) {
            Char c = m_data[i];
            if (c == 0x1b) {
                inEscape = true;
                newData.append(c);
                continue;
            }
            if (inEscape) {
                if (c == 'm' || c == 0x07)
                    inEscape = false;
                newData.append(c);
                continue;
            }
            if ((c == ' ' || c == '\t') && removed < removeCount) {
                removed++;
                continue;
            }
            newData.append(c);
        }

        m_data = std::move(newData);
    }
};

// ============================================================================
// Word Wrapping Core Logic
// ============================================================================

template<typename Char>
static void wrapWord(Vector<Row<Char>>& rows, const Char* wordStart, const Char* wordEnd, size_t columns, const WrapAnsiOptions& options)
{
    bool isInsideEscape = false;
    bool isInsideLinkEscape = false;
    bool isInsideCsiEscape = false;
    size_t vis = rows.last().width(options.ambiguousIsNarrow);

    const Char* it = wordStart;
    while (it < wordEnd) {
        if (*it == 0x1b) {
            isInsideEscape = true;
            isInsideCsiEscape = false;
            // Check for hyperlink escape (OSC 8)
            if (wordEnd - it > 4) {
                if (it[1] == ']' && it[2] == '8' && it[3] == ';' && it[4] == ';')
                    isInsideLinkEscape = true;
            }
            // Check for CSI escape (ESC [)
            if (wordEnd - it > 1 && it[1] == '[')
                isInsideCsiEscape = true;
        }

        size_t charLen = 0;
        uint8_t charWidth = 0;

        if (!isInsideEscape) {
            char32_t cp;
            if constexpr (sizeof(Char) == 1) {
                // Latin1: each byte is one character, direct 1:1 mapping to U+0000-U+00FF
                charLen = 1;
                cp = static_cast<uint8_t>(*it);
            } else {
                cp = decodeUTF16(it, wordEnd - it, charLen);
            }
            charWidth = getVisibleWidth(cp, !options.ambiguousIsNarrow);
        } else {
            charLen = 1;
            charWidth = 0;
        }

        if (!isInsideEscape && vis + charWidth <= columns) {
            rows.last().append(it, it + charLen);
            vis += charWidth;
        } else if (!isInsideEscape) {
            // Character doesn't fit on current line, start a new line
            rows.append(Row<Char>());
            rows.last().append(it, it + charLen);
            vis = charWidth; // Start with the width of the character we just added
        } else {
            rows.last().append(*it);
        }

        if (isInsideEscape) {
            if (isInsideLinkEscape) {
                if (*it == 0x07) {
                    isInsideEscape = false;
                    isInsideLinkEscape = false;
                }
            } else if (isInsideCsiEscape) {
                // CSI sequence ends with a byte in 0x40-0x7E range
                // (excluding '[' which is the CSI introducer)
                if (*it >= 0x40 && *it <= 0x7E && *it != '[') {
                    isInsideEscape = false;
                    isInsideCsiEscape = false;
                }
            } else if (*it == 'm') {
                // Fallback for non-CSI SGR-like sequences
                isInsideEscape = false;
            }
            it++;
            continue;
        }

        if (vis == columns && it + charLen < wordEnd) {
            rows.append(Row<Char>());
            vis = 0;
        }

        it += charLen;
    }

    // Handle edge case: last row is only ANSI escape codes
    if (vis == 0 && !rows.last().m_data.isEmpty() && rows.size() > 1) {
        Row<Char> lastRow = std::move(rows.last());
        rows.removeLast();
        rows.last().append(lastRow);
    }
}

// Helper to check if a character ends a CSI escape sequence
// CSI sequences end with bytes in 0x40-0x7E range (excluding '[' which is the introducer)
template<typename Char>
static bool isCsiTerminator(Char c)
{
    return c >= 0x40 && c <= 0x7E && c != '[';
}

// Helper to check if a character ends an ANSI escape sequence
template<typename Char>
static bool isAnsiEscapeTerminator(Char c, bool isOscSequence)
{
    if (isOscSequence)
        return c == 0x07; // BEL terminates OSC sequences
    return isCsiTerminator(c); // CSI terminator
}

template<typename Char>
static void trimRowTrailingSpaces(Row<Char>& row, bool ambiguousIsNarrow)
{
    // Find last visible word
    auto span = row.m_data.span();
    const Char* data = span.data();
    size_t size = span.size();

    // Split by spaces and find last word with visible content
    size_t lastVisibleEnd = 0;
    size_t wordStart = 0;
    bool hasVisibleContent = false;

    for (size_t i = 0; i <= size; ++i) {
        if (i == size || data[i] == ' ') {
            if (wordStart < i) {
                size_t wordWidth = stringWidth(data + wordStart, data + i, ambiguousIsNarrow);
                if (wordWidth > 0) {
                    hasVisibleContent = true;
                    lastVisibleEnd = i;
                }
            }
            wordStart = i + 1;
        }
    }

    if (!hasVisibleContent) {
        // Keep only ANSI codes
        Vector<Char> ansiOnly;
        bool inEscape = false;
        bool inOscEscape = false;
        for (size_t i = 0; i < size; ++i) {
            if (data[i] == 0x1b || inEscape) {
                ansiOnly.append(data[i]);
                if (data[i] == 0x1b) {
                    inEscape = true;
                    inOscEscape = (i + 1 < size && data[i + 1] == ']');
                } else if (isAnsiEscapeTerminator(data[i], inOscEscape)) {
                    inEscape = false;
                    inOscEscape = false;
                }
            }
        }
        row.m_data = std::move(ansiOnly);
        return;
    }

    if (lastVisibleEnd < size) {
        // Collect trailing ANSI codes
        Vector<Char> trailingAnsi;
        bool inEscape = false;
        bool inOscEscape = false;
        for (size_t i = lastVisibleEnd; i < size; ++i) {
            if (data[i] == 0x1b || inEscape) {
                trailingAnsi.append(data[i]);
                if (data[i] == 0x1b) {
                    inEscape = true;
                    inOscEscape = (i + 1 < size && data[i + 1] == ']');
                } else if (isAnsiEscapeTerminator(data[i], inOscEscape)) {
                    inEscape = false;
                    inOscEscape = false;
                }
            }
        }

        row.m_data.shrink(lastVisibleEnd);
        row.m_data.appendVector(trailingAnsi);
    }
}

// ============================================================================
// SGR Code Parsing and Style Preservation
// ============================================================================

static constexpr uint32_t END_CODE = 39;

template<typename Char>
static std::optional<uint32_t> parseSgrCode(const Char* start, const Char* end)
{
    if (end - start < 3 || start[0] != 0x1b || start[1] != '[')
        return std::nullopt;

    uint32_t code = 0;
    for (const Char* it = start + 2; it < end; ++it) {
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

template<typename Char>
static std::pair<const Char*, const Char*> parseOsc8Url(const Char* start, const Char* end)
{
    // Format: ESC ] 8 ; ; url BEL
    if (end - start < 6)
        return { nullptr, nullptr };
    if (start[0] != 0x1b || start[1] != ']' || start[2] != '8' || start[3] != ';' || start[4] != ';')
        return { nullptr, nullptr };

    const Char* urlStart = start + 5;
    const Char* urlEnd = urlStart;

    while (urlEnd < end && *urlEnd != 0x07 && *urlEnd != 0x1b)
        urlEnd++;

    if (urlEnd == urlStart)
        return { nullptr, nullptr };

    return { urlStart, urlEnd };
}

static std::optional<uint32_t> getCloseCode(uint32_t code)
{
    switch (code) {
    case 1:
    case 2:
        return 22;
    case 3:
        return 23;
    case 4:
        return 24;
    case 5:
    case 6:
        return 25;
    case 7:
        return 27;
    case 8:
        return 28;
    case 9:
        return 29;
    }

    if (code >= 30 && code <= 37)
        return 39;
    if (code >= 40 && code <= 47)
        return 49;
    if (code >= 90 && code <= 97)
        return 39;
    if (code >= 100 && code <= 107)
        return 49;

    return std::nullopt;
}

template<typename Char>
static void joinRowsWithAnsiPreservation(const Vector<Row<Char>>& rows, StringBuilder& result)
{
    // First join all rows
    Vector<Char> joined;
    size_t totalSize = 0;
    for (const auto& row : rows)
        totalSize += row.m_data.size() + 1;

    joined.reserveCapacity(totalSize);

    for (size_t i = 0; i < rows.size(); ++i) {
        if (i > 0)
            joined.append(static_cast<Char>('\n'));
        joined.appendVector(rows[i].m_data);
    }

    // Process for ANSI style preservation
    std::optional<uint32_t> escapeCode;
    const Char* escapeUrl = nullptr;
    size_t escapeUrlLen = 0;

    for (size_t i = 0; i < joined.size(); ++i) {
        Char c = joined[i];
        result.append(static_cast<UChar>(c));

        if (c == 0x1b && i + 1 < joined.size()) {
            auto span = joined.span();
            // Parse ANSI sequence
            if (joined[i + 1] == '[') {
                if (auto code = parseSgrCode(span.data() + i, span.data() + span.size())) {
                    if (*code == END_CODE || *code == 0)
                        escapeCode = std::nullopt;
                    else
                        escapeCode = *code;
                }
            } else if (i + 4 < joined.size() && joined[i + 1] == ']' && joined[i + 2] == '8' && joined[i + 3] == ';' && joined[i + 4] == ';') {
                auto [urlStart, urlEnd] = parseOsc8Url(span.data() + i, span.data() + span.size());
                if (urlStart && urlEnd != urlStart) {
                    escapeUrl = urlStart;
                    escapeUrlLen = urlEnd - urlStart;
                } else {
                    escapeUrl = nullptr;
                    escapeUrlLen = 0;
                }
            }
        }

        // Check if next character is newline
        if (i + 1 < joined.size() && joined[i + 1] == '\n') {
            // Close styles before newline
            if (escapeUrl) {
                result.append("\x1b]8;;\x07"_s);
            }
            if (escapeCode) {
                if (auto closeCode = getCloseCode(*escapeCode)) {
                    result.append("\x1b["_s);
                    result.append(String::number(*closeCode));
                    result.append('m');
                }
            }
        } else if (c == '\n') {
            // Restore styles after newline
            if (escapeCode) {
                result.append("\x1b["_s);
                result.append(String::number(*escapeCode));
                result.append('m');
            }
            if (escapeUrl) {
                result.append("\x1b]8;;"_s);
                for (size_t j = 0; j < escapeUrlLen; ++j)
                    result.append(static_cast<UChar>(escapeUrl[j]));
                result.append(static_cast<UChar>(0x07));
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

    // Calculate word lengths using WTF::find for space detection
    Vector<size_t> wordLengths;
    auto lineSpan = std::span<const Char>(lineStart, lineEnd);
    size_t wordStartIdx = 0;
    while (wordStartIdx <= lineSpan.size()) {
        size_t spacePos = WTF::find(lineSpan, static_cast<Char>(' '), wordStartIdx);
        size_t wordEndIdx = (spacePos == WTF::notFound) ? lineSpan.size() : spacePos;

        if (wordStartIdx < wordEndIdx) {
            wordLengths.append(stringWidth(lineSpan.data() + wordStartIdx,
                lineSpan.data() + wordEndIdx,
                options.ambiguousIsNarrow));
        } else {
            wordLengths.append(0);
        }

        if (spacePos == WTF::notFound)
            break;
        wordStartIdx = wordEndIdx + 1;
    }

    // Start with empty first row
    rows.append(Row<Char>());

    // Process each word
    const Char* wordStart = lineStart;
    size_t wordIndex = 0;

    for (const Char* it = lineStart; it <= lineEnd; ++it) {
        if (it < lineEnd && *it != ' ')
            continue;

        const Char* wordEnd = it;

        if (options.trim)
            rows.last().trimLeadingSpaces();

        size_t rowLength = rows.last().width(options.ambiguousIsNarrow);

        if (wordIndex != 0) {
            if (rowLength >= columns && (!options.wordWrap || !options.trim)) {
                rows.append(Row<Char>());
                rowLength = 0;
            }

            if (rowLength > 0 || !options.trim) {
                rows.last().append(static_cast<Char>(' '));
                rowLength++;
            }
        }

        size_t wordLen = wordIndex < wordLengths.size() ? wordLengths[wordIndex] : 0;

        // Hard wrap mode
        if (options.hard && wordLen > columns) {
            size_t remainingColumns = columns > rowLength ? columns - rowLength : 0;
            size_t breaksStartingThisLine = 1 + (wordLen > remainingColumns ? (wordLen - remainingColumns - 1) / columns : 0);
            size_t breaksStartingNextLine = wordLen > 0 ? (wordLen - 1) / columns : 0;
            if (breaksStartingNextLine < breaksStartingThisLine)
                rows.append(Row<Char>());

            wrapWord(rows, wordStart, wordEnd, columns, options);
            wordStart = it + 1;
            wordIndex++;
            continue;
        }

        if (rowLength + wordLen > columns && rowLength > 0 && wordLen > 0) {
            if (!options.wordWrap && rowLength < columns) {
                wrapWord(rows, wordStart, wordEnd, columns, options);
                wordStart = it + 1;
                wordIndex++;
                continue;
            }

            rows.append(Row<Char>());
        }

        rowLength = rows.last().width(options.ambiguousIsNarrow);
        if (rowLength + wordLen > columns && !options.wordWrap) {
            wrapWord(rows, wordStart, wordEnd, columns, options);
            wordStart = it + 1;
            wordIndex++;
            continue;
        }

        rows.last().append(wordStart, wordEnd);
        wordStart = it + 1;
        wordIndex++;
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

    // Normalize \r\n to \n using WTF::findNextNewline
    Vector<Char> normalized;
    normalized.reserveCapacity(input.size());

    size_t pos = 0;
    while (pos < input.size()) {
        auto newline = WTF::findNextNewline(input, pos);
        if (newline.position == WTF::notFound) {
            // Append remaining content
            normalized.append(std::span { input.data() + pos, input.size() - pos });
            break;
        }
        // Append content before newline
        if (newline.position > pos)
            normalized.append(std::span { input.data() + pos, newline.position - pos });
        // Always append \n regardless of original (\r, \n, or \r\n)
        normalized.append(static_cast<Char>('\n'));
        pos = newline.position + newline.length;
    }

    // Process each line separately
    StringBuilder result;
    result.reserveCapacity(input.size() + input.size() / 10);

    auto span = normalized.span();
    const Char* lineStart = span.data();
    const Char* const dataEnd = span.data() + span.size();
    bool firstLine = true;

    while (lineStart <= dataEnd) {
        // Find next newline using WTF::find
        auto remaining = std::span<const Char>(lineStart, dataEnd);
        size_t nlPos = WTF::find(remaining, static_cast<Char>('\n'));
        const Char* lineEnd = (nlPos == WTF::notFound) ? dataEnd : lineStart + nlPos;

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

        lineStart = lineEnd + 1;
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
            columns = static_cast<size_t>(colsDouble);
    }

    // Parse options
    WrapAnsiOptions options;
    if (optionsValue.isObject()) {
        JSC::JSObject* optionsObj = optionsValue.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSC::JSValue hardValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "hard"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!hardValue.isUndefined())
            options.hard = hardValue.toBoolean(globalObject);

        JSC::JSValue wordWrapValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "wordWrap"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!wordWrapValue.isUndefined())
            options.wordWrap = wordWrapValue.toBoolean(globalObject);

        JSC::JSValue trimValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "trim"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!trimValue.isUndefined())
            options.trim = trimValue.toBoolean(globalObject);

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
