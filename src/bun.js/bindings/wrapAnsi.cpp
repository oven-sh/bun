#include "root.h"
#include "wrapAnsi.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/SIMDHelpers.h>
#include <vector>

// Zig exports for visible width calculation
extern "C" size_t Bun__visibleWidthExcludeANSI_utf8(const uint8_t* ptr, size_t len, bool ambiguous_as_wide);
extern "C" size_t Bun__visibleWidthExcludeANSI_utf16(const uint16_t* ptr, size_t len, bool ambiguous_as_wide);
extern "C" size_t Bun__visibleWidthExcludeANSI_latin1(const uint8_t* ptr, size_t len);
extern "C" uint8_t Bun__codepointWidth(uint32_t cp, bool ambiguous_as_wide);

namespace Bun {
using namespace WTF;

// ============================================================================
// UTF-8/UTF-16 Decoding Utilities (needed for hard wrap)
// ============================================================================

static inline uint8_t utf8SequenceLength(uint8_t byte)
{
    if (byte < 0x80)
        return 1;
    if ((byte & 0xE0) == 0xC0)
        return 2;
    if ((byte & 0xF0) == 0xE0)
        return 3;
    if ((byte & 0xF8) == 0xF0)
        return 4;
    return 1; // Invalid, treat as 1
}

static char32_t decodeUTF8(const Latin1Character* ptr, size_t available, size_t& outLen)
{
    uint8_t byte = static_cast<uint8_t>(ptr[0]);

    if (byte < 0x80) {
        outLen = 1;
        return byte;
    }

    uint8_t seqLen = utf8SequenceLength(byte);
    if (seqLen > available) {
        outLen = 1;
        return 0xFFFD; // Replacement character
    }

    char32_t cp = 0;
    switch (seqLen) {
    case 2:
        cp = ((byte & 0x1F) << 6) | (ptr[1] & 0x3F);
        break;
    case 3:
        cp = ((byte & 0x0F) << 12) | ((ptr[1] & 0x3F) << 6) | (ptr[2] & 0x3F);
        break;
    case 4:
        cp = ((byte & 0x07) << 18) | ((ptr[1] & 0x3F) << 12) | ((ptr[2] & 0x3F) << 6) | (ptr[3] & 0x3F);
        break;
    default:
        outLen = 1;
        return 0xFFFD;
    }

    outLen = seqLen;
    return cp;
}

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
// ANSI Escape Sequence Detection (based on stripANSI.cpp)
// ============================================================================

template<typename Char>
static inline bool isEscapeCharacter(Char c)
{
    switch (c) {
    case 0x1b: // ESC
    case 0x9b: // CSI
    case 0x9d: // OSC
    case 0x90: // DCS
    case 0x98: // SOS
    case 0x9e: // PM
    case 0x9f: // APC
        return true;
    default:
        return false;
    }
}

template<typename Char>
static const Char* findEscapeCharacter(const Char* start, const Char* end)
{
    static_assert(sizeof(Char) == 1 || sizeof(Char) == 2);
    using SIMDType = std::conditional_t<sizeof(Char) == 1, uint8_t, uint16_t>;

    constexpr size_t stride = SIMD::stride<SIMDType>;
    constexpr auto escMask = SIMD::splat<SIMDType>(static_cast<SIMDType>(~0b10001111U));
    constexpr auto escVector = SIMD::splat<SIMDType>(0b00010000);

    auto it = start;
    for (; end - it >= static_cast<ptrdiff_t>(stride); it += stride) {
        const auto chunk = SIMD::load(reinterpret_cast<const SIMDType*>(it));
        const auto chunkMasked = SIMD::bitAnd(chunk, escMask);
        const auto chunkIsEsc = SIMD::equal(chunkMasked, escVector);
        if (const auto index = SIMD::findFirstNonZeroIndex(chunkIsEsc))
            return it + *index;
    }

    for (; it != end; ++it) {
        if (isEscapeCharacter(*it))
            return it;
    }
    return nullptr;
}

// Consume an ANSI escape sequence, returning pointer to first byte after it
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
            case 0x90:
            case 0x98:
            case 0x9e:
            case 0x9f:
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
            case 'P':
            case 'X':
            case '^':
            case '_':
                state = State::needSt;
                break;
            default:
                state = State::start;
            }
            break;

        case State::ignoreNextChar:
            state = State::start;
            break;

        case State::inCsi:
            if (c >= 0x40 && c <= 0x7e)
                state = State::start;
            break;

        case State::inOsc:
            switch (c) {
            case 0x1b:
                state = State::inOscGotEsc;
                break;
            case 0x9c:
            case 0x07:
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
// String Width Calculation (using Zig implementation)
// ============================================================================

template<typename Char>
static size_t stringWidth(const Char* start, const Char* end, bool ambiguousIsNarrow)
{
    size_t len = end - start;
    if (len == 0)
        return 0;

    if constexpr (sizeof(Char) == 1) {
        return Bun__visibleWidthExcludeANSI_utf8(reinterpret_cast<const uint8_t*>(start), len, !ambiguousIsNarrow);
    } else {
        return Bun__visibleWidthExcludeANSI_utf16(reinterpret_cast<const uint16_t*>(start), len, !ambiguousIsNarrow);
    }
}

// ============================================================================
// Row Management (using std::vector)
// ============================================================================

template<typename Char>
class Row {
public:
    std::vector<Char> m_data;

    void append(Char c)
    {
        m_data.push_back(c);
    }

    void append(const Char* start, const Char* end)
    {
        m_data.insert(m_data.end(), start, end);
    }

    void append(const Row& other)
    {
        m_data.insert(m_data.end(), other.m_data.begin(), other.m_data.end());
    }

    size_t width(bool ambiguousIsNarrow) const
    {
        if (m_data.empty())
            return 0;
        return stringWidth(m_data.data(), m_data.data() + m_data.size(), ambiguousIsNarrow);
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
        std::vector<Char> newData;
        newData.reserve(m_data.size() - removeCount);

        inEscape = false;
        size_t removed = 0;

        for (size_t i = 0; i < m_data.size(); ++i) {
            Char c = m_data[i];
            if (c == 0x1b) {
                inEscape = true;
                newData.push_back(c);
                continue;
            }
            if (inEscape) {
                if (c == 'm' || c == 0x07)
                    inEscape = false;
                newData.push_back(c);
                continue;
            }
            if ((c == ' ' || c == '\t') && removed < removeCount) {
                removed++;
                continue;
            }
            newData.push_back(c);
        }

        m_data = std::move(newData);
    }
};

// ============================================================================
// Word Wrapping Core Logic
// ============================================================================

template<typename Char>
static void wrapWord(std::vector<Row<Char>>& rows, const Char* wordStart, const Char* wordEnd, size_t columns, const WrapAnsiOptions& options)
{
    bool isInsideEscape = false;
    bool isInsideLinkEscape = false;
    size_t vis = rows.back().width(options.ambiguousIsNarrow);

    const Char* it = wordStart;
    while (it < wordEnd) {
        if (*it == 0x1b) {
            isInsideEscape = true;
            // Check for hyperlink escape
            if (wordEnd - it > 4) {
                if (it[1] == ']' && it[2] == '8' && it[3] == ';' && it[4] == ';')
                    isInsideLinkEscape = true;
            }
        }

        size_t charLen = 0;
        uint8_t charWidth = 0;

        if (!isInsideEscape) {
            char32_t cp;
            if constexpr (sizeof(Char) == 1) {
                cp = decodeUTF8(it, wordEnd - it, charLen);
            } else {
                cp = decodeUTF16(it, wordEnd - it, charLen);
            }
            charWidth = getVisibleWidth(cp, !options.ambiguousIsNarrow);
        } else {
            charLen = 1;
            charWidth = 0;
        }

        if (!isInsideEscape && vis + charWidth <= columns) {
            rows.back().append(it, it + charLen);
        } else if (!isInsideEscape) {
            rows.push_back(Row<Char>());
            rows.back().append(it, it + charLen);
            vis = 0;
        } else {
            rows.back().append(*it);
        }

        if (isInsideEscape) {
            if (isInsideLinkEscape) {
                if (*it == 0x07) {
                    isInsideEscape = false;
                    isInsideLinkEscape = false;
                }
            } else if (*it == 'm') {
                isInsideEscape = false;
            }
            it++;
            continue;
        }

        vis += charWidth;

        if (vis == columns && it + charLen < wordEnd) {
            rows.push_back(Row<Char>());
            vis = 0;
        }

        it += charLen;
    }

    // Handle edge case: last row is only ANSI escape codes
    if (vis == 0 && !rows.back().m_data.empty() && rows.size() > 1) {
        Row<Char> lastRow = std::move(rows.back());
        rows.pop_back();
        rows.back().append(lastRow);
    }
}

template<typename Char>
static void trimRowTrailingSpaces(Row<Char>& row, bool ambiguousIsNarrow)
{
    // Find last visible word
    const Char* data = row.m_data.data();
    size_t size = row.m_data.size();

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
        std::vector<Char> ansiOnly;
        bool inEscape = false;
        for (size_t i = 0; i < size; ++i) {
            if (data[i] == 0x1b || inEscape) {
                ansiOnly.push_back(data[i]);
                if (data[i] == 0x1b)
                    inEscape = true;
                else if (data[i] == 'm' || data[i] == 0x07)
                    inEscape = false;
            }
        }
        row.m_data = std::move(ansiOnly);
        return;
    }

    if (lastVisibleEnd < size) {
        // Collect trailing ANSI codes
        std::vector<Char> trailingAnsi;
        bool inEscape = false;
        for (size_t i = lastVisibleEnd; i < size; ++i) {
            if (data[i] == 0x1b || inEscape) {
                trailingAnsi.push_back(data[i]);
                if (data[i] == 0x1b)
                    inEscape = true;
                else if (data[i] == 'm' || data[i] == 0x07)
                    inEscape = false;
            }
        }

        row.m_data.resize(lastVisibleEnd);
        row.m_data.insert(row.m_data.end(), trailingAnsi.begin(), trailingAnsi.end());
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
static void joinRowsWithAnsiPreservation(const std::vector<Row<Char>>& rows, StringBuilder& result)
{
    // First join all rows
    std::vector<Char> joined;
    size_t totalSize = 0;
    for (const auto& row : rows)
        totalSize += row.m_data.size() + 1;

    joined.reserve(totalSize);

    for (size_t i = 0; i < rows.size(); ++i) {
        if (i > 0)
            joined.push_back(static_cast<Char>('\n'));
        joined.insert(joined.end(), rows[i].m_data.begin(), rows[i].m_data.end());
    }

    // Process for ANSI style preservation
    std::optional<uint32_t> escapeCode;
    const Char* escapeUrl = nullptr;
    size_t escapeUrlLen = 0;

    for (size_t i = 0; i < joined.size(); ++i) {
        Char c = joined[i];
        result.append(static_cast<UChar>(c));

        if (c == 0x1b && i + 1 < joined.size()) {
            // Parse ANSI sequence
            if (joined[i + 1] == '[') {
                if (auto code = parseSgrCode(joined.data() + i, joined.data() + joined.size())) {
                    if (*code == END_CODE || *code == 0)
                        escapeCode = std::nullopt;
                    else
                        escapeCode = *code;
                }
            } else if (i + 4 < joined.size() && joined[i + 1] == ']' && joined[i + 2] == '8' && joined[i + 3] == ';' && joined[i + 4] == ';') {
                auto [urlStart, urlEnd] = parseOsc8Url(joined.data() + i, joined.data() + joined.size());
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
static void processLine(const Char* lineStart, const Char* lineEnd, size_t columns, const WrapAnsiOptions& options, std::vector<Row<Char>>& rows)
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

    // Calculate word lengths
    std::vector<size_t> wordLengths;
    const Char* wordStart = lineStart;
    for (const Char* it = lineStart; it <= lineEnd; ++it) {
        if (it == lineEnd || *it == ' ') {
            if (wordStart < it) {
                wordLengths.push_back(stringWidth(wordStart, it, options.ambiguousIsNarrow));
            } else {
                wordLengths.push_back(0);
            }
            wordStart = it + 1;
        }
    }

    // Start with empty first row
    rows.push_back(Row<Char>());

    // Process each word
    wordStart = lineStart;
    size_t wordIndex = 0;

    for (const Char* it = lineStart; it <= lineEnd; ++it) {
        if (it < lineEnd && *it != ' ')
            continue;

        const Char* wordEnd = it;

        if (options.trim)
            rows.back().trimLeadingSpaces();

        size_t rowLength = rows.back().width(options.ambiguousIsNarrow);

        if (wordIndex != 0) {
            if (rowLength >= columns && (!options.wordWrap || !options.trim)) {
                rows.push_back(Row<Char>());
                rowLength = 0;
            }

            if (rowLength > 0 || !options.trim) {
                rows.back().append(static_cast<Char>(' '));
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
                rows.push_back(Row<Char>());

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

            rows.push_back(Row<Char>());
        }

        rowLength = rows.back().width(options.ambiguousIsNarrow);
        if (rowLength + wordLen > columns && !options.wordWrap) {
            wrapWord(rows, wordStart, wordEnd, columns, options);
            wordStart = it + 1;
            wordIndex++;
            continue;
        }

        rows.back().append(wordStart, wordEnd);
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

    // Normalize \r\n to \n
    std::vector<Char> normalized;
    normalized.reserve(input.size());

    for (size_t i = 0; i < input.size(); ++i) {
        if (i + 1 < input.size() && input[i] == '\r' && input[i + 1] == '\n') {
            normalized.push_back(static_cast<Char>('\n'));
            i++; // Skip next char
        } else {
            normalized.push_back(input[i]);
        }
    }

    // Process each line separately
    StringBuilder result;
    result.reserveCapacity(input.size() + input.size() / 10);

    const Char* lineStart = normalized.data();
    const Char* const dataEnd = normalized.data() + normalized.size();
    bool firstLine = true;

    for (const Char* it = normalized.data(); it <= dataEnd; ++it) {
        if (it < dataEnd && *it != '\n')
            continue;

        // Add newline between input lines
        if (!firstLine)
            result.append('\n');
        firstLine = false;

        // Process this input line
        std::vector<Row<Char>> lineRows;
        processLine(lineStart, it, columns, options, lineRows);

        // Join and append this line's rows with ANSI preservation
        if (!lineRows.empty()) {
            joinRowsWithAnsiPreservation(lineRows, result);
        }

        lineStart = it + 1;
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
        columns = static_cast<size_t>(columnsValue.toIntegerOrInfinity(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
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
