#pragma once

#include "engine/support/VectorTraits.h"
#include "engine/text/CString.h"
#include "engine/text/StringImpl.h"

#include <compare>
#include <expected>
#include <iterator>

extern "C" {
size_t engine_text_find(WTF::StringView, WTF::StringView needle, size_t start);
size_t engine_text_find_ignoring_ascii_case(WTF::StringView, WTF::StringView needle, size_t start);
size_t engine_text_find_last_unit(WTF::StringView, char16_t, size_t end);
bool engine_text_equal_ignoring_ascii_case(WTF::StringView, WTF::StringView);
int engine_text_compare(WTF::StringView, WTF::StringView);
size_t engine_text_write_utf8(WTF::StringView, char8_t* destination, size_t capacity);
}

namespace WTF {

// Borrowed characters of either width, or null. The exports of `bun_engine_embed` take it as `RawText`.
class StringView final {
    WTF_MAKE_TZONE_ALLOCATED(StringView);

public:
    constexpr StringView() = default;

    StringView(const void* characters LIFETIME_BOUND, unsigned length, bool is8Bit)
        : m_characters(characters)
        , m_length(length)
        , m_is8Bit(is8Bit)
    {
    }

    StringView(std::span<const Latin1Character> characters LIFETIME_BOUND)
        : StringView(characters.data(), lengthOf(characters), true)
    {
    }

    StringView(std::span<const char16_t> characters LIFETIME_BOUND)
        : StringView(characters.data(), lengthOf(characters), false)
    {
    }

    StringView(std::span<const char> latin1 LIFETIME_BOUND)
        : StringView(latin1.data(), lengthOf(latin1), true)
    {
    }

    StringView(ASCIILiteral literal)
        : StringView(literal.characters(), literal.length(), true)
    {
    }

    StringView(const StringImpl& string LIFETIME_BOUND)
        : StringView(string.rawCharacters(), string.length(), string.is8Bit())
    {
    }

    StringView(const StringImpl* string LIFETIME_BOUND)
    {
        if (string)
            *this = *string;
    }

    StringView(const String& string LIFETIME_BOUND);
    StringView(const AtomString& string LIFETIME_BOUND);

    static StringView fromLatin1(const char* characters) { return unsafeSpan(characters); }

    bool isNull() const { return !m_characters; }
    explicit operator bool() const { return m_characters; }
    bool isEmpty() const { return !m_length; }
    unsigned length() const { return m_length; }
    bool is8Bit() const { return m_is8Bit; }

    const void* rawCharacters() const { return m_characters; }

    std::span<const Latin1Character> span8() const
    {
        ASSERT(m_is8Bit);
        return { static_cast<const Latin1Character*>(m_characters), m_length };
    }

    std::span<const char16_t> span16() const
    {
        ASSERT(!m_is8Bit || !m_length);
        return { static_cast<const char16_t*>(m_characters), m_length };
    }

    template<IsStringStorageCharacter T> std::span<const T> span() const
    {
        if constexpr (sizeof(T) == 1)
            return span8();
        else
            return span16();
    }

    // Calls `function` with the span of the right type.
    ALWAYS_INLINE decltype(auto) visitCharacters(NOESCAPE const auto& function) const
    {
        if (m_is8Bit)
            return function(span8());
        return function(span16());
    }

    char16_t operator[](unsigned index) const
    {
        ASSERT_WITH_SECURITY_IMPLICATION(index < m_length);
        return m_is8Bit ? char16_t { span8()[index] } : span16()[index];
    }

    class CodeUnits;
    CodeUnits codeUnits() const;
    class CodePoints;
    CodePoints codePoints() const;
    // Leaves out what is empty.
    class SplitResult;
    SplitResult split(char16_t separator) const;

    bool containsOnlyASCII() const
    {
        return visitCharacters([](auto characters) { return charactersAreAllASCII(characters); });
    }

    String toString() const;
    String toStringWithoutCopying() const;
    AtomString toAtomString() const;
    String convertToASCIILowercase() const;
    AtomString convertToASCIILowercaseAtom() const;

    std::expected<UTF8CString, UTF8ConversionError> tryGetUTF8(ConversionMode = LenientConversion) const;
    UTF8CString utf8(ConversionMode = LenientConversion) const;

    template<IsStringStorageCharacter T> ALWAYS_INLINE void getCharacters(std::span<T> destination) const
    {
        visitCharacters([&](auto characters) ALWAYS_INLINE_LAMBDA { StringImpl::copyCharacters(destination, characters); });
    }

    StringView substring(unsigned start, unsigned length = std::numeric_limits<unsigned>::max()) const
    {
        if (start >= m_length)
            return ""_s;
        return { static_cast<const char*>(m_characters) + (static_cast<size_t>(start) << !m_is8Bit), std::min(length, m_length - start), m_is8Bit };
    }

    StringView left(unsigned length) const { return substring(0, length); }

    ALWAYS_INLINE StringView trim(CodeUnitMatchFunction matches) const
    {
        return visitCharacters([&](auto characters) ALWAYS_INLINE_LAMBDA -> StringView {
            while (!characters.empty() && matches(characters.front()))
                characters = characters.subspan(1);
            while (!characters.empty() && matches(characters.back()))
                characters = characters.first(characters.size() - 1);
            return characters;
        });
    }

    size_t find(char16_t character, unsigned start = 0) const
    {
        return visitCharacters([&](auto characters) { return WTF::find(characters, character, start); });
    }
    size_t find(char character, unsigned start = 0) const { return find(char16_t { Detail::codeOf(character) }, start); }
    size_t find(ASCIILiteral literal, unsigned start = 0) const { return find(StringView { literal }, start); }
    size_t find(StringView string, unsigned start = 0) const { return string.m_length > m_length ? notFound : engine_text_find(*this, string, start); }

    template<typename Predicate>
        requires std::is_invocable_r_v<bool, Predicate, char16_t>
    size_t find(NOESCAPE const Predicate& matches, unsigned start = 0) const
    {
        return visitCharacters([&](auto characters) { return WTF::find(characters, matches, start); });
    }

    size_t findIgnoringASCIICase(StringView string, unsigned start = 0) const { return engine_text_find_ignoring_ascii_case(*this, string, start); }

    // Up to and including `start`.
    size_t reverseFind(char16_t character, unsigned start = std::numeric_limits<unsigned>::max()) const { return engine_text_find_last_unit(*this, character, size_t { start } + 1); }

    bool contains(char16_t character) const { return find(character) != notFound; }
    bool contains(ASCIILiteral literal) const { return find(literal) != notFound; }
    bool contains(StringView string) const { return find(string) != notFound; }
    bool containsIgnoringASCIICase(StringView string) const { return findIgnoringASCIICase(string) != notFound; }

    bool startsWith(char16_t character) const { return m_length && (*this)[0] == character; }
    bool endsWith(char16_t character) const { return m_length && (*this)[m_length - 1] == character; }
    ALWAYS_INLINE bool startsWith(StringView prefix) const { return prefix.m_length <= m_length && hasAt(0, prefix); }
    ALWAYS_INLINE bool endsWith(StringView suffix) const { return suffix.m_length <= m_length && hasAt(m_length - suffix.m_length, suffix); }
    bool startsWithIgnoringASCIICase(StringView prefix) const
    {
        if (prefix.m_length > m_length || prefix.isEmpty())
            return prefix.isEmpty();
        return toASCIILower((*this)[0]) == toASCIILower(prefix[0]) && engine_text_equal_ignoring_ascii_case({ m_characters, prefix.m_length, m_is8Bit }, prefix);
    }

    // Null is equal to empty.
    friend ALWAYS_INLINE bool equal(StringView a, StringView b) { return a.m_length == b.m_length && (a.m_characters == b.m_characters || a.hasAt(0, b)); }
    friend ALWAYS_INLINE bool equal(StringView a, ASCIILiteral b) { return a.m_length == b.length() && a.hasAt(0, b); }

private:
    template<typename T> static unsigned lengthOf(std::span<const T> characters)
    {
        ASSERT_WITH_SECURITY_IMPLICATION(characters.size() <= StringImpl::MaxLength);
        return characters.size();
    }

    // There are as many characters from `start` on as `other` has.
    ALWAYS_INLINE bool hasAt(unsigned start, StringView other) const
    {
        if (m_is8Bit == other.m_is8Bit) [[likely]]
            return Detail::equalBytes(static_cast<const char*>(m_characters) + (static_cast<size_t>(start) << !other.m_is8Bit), other.m_characters, static_cast<size_t>(other.m_length) << !other.m_is8Bit);
        if (m_is8Bit)
            return Detail::equalCharacters(span8().data() + start, other.span16().data(), other.m_length);
        return Detail::equalCharacters(span16().data() + start, other.span8().data(), other.m_length);
    }

    const void* m_characters { nullptr };
    unsigned m_length { 0 };
    bool m_is8Bit { true };
};

static_assert(sizeof(StringView) == 16 && std::is_trivially_copyable_v<StringView>);

bool equal(StringView, StringView);
bool equal(StringView, ASCIILiteral);
inline bool equal(StringView a, std::span<const Latin1Character> b) { return equal(a, StringView { b }); }

ALWAYS_INLINE bool operator==(StringView a, StringView b) { return equal(a, b); }
ALWAYS_INLINE bool operator==(StringView a, ASCIILiteral b) { return equal(a, b); }

inline bool equalIgnoringASCIICase(StringView a, StringView b) { return a.length() == b.length() && a.startsWithIgnoringASCIICase(b); }
inline bool equalIgnoringASCIICase(StringView a, ASCIILiteral b) { return equalIgnoringASCIICase(a, StringView { b }); }
inline bool equalLettersIgnoringASCIICase(StringView a, ASCIILiteral b) { return equalIgnoringASCIICase(a, b); }

// By code unit.
inline std::strong_ordering codePointCompare(StringView a, StringView b) { return engine_text_compare(a, b) <=> 0; }
inline bool codePointCompareLessThan(StringView a, StringView b) { return engine_text_compare(a, b) < 0; }

inline StringView nullStringView() { return {}; }

class StringView::CodeUnits {
public:
    class Iterator {
    public:
        char16_t operator*() const { return m_view[m_index]; }
        Iterator& operator++()
        {
            ++m_index;
            return *this;
        }
        bool operator==(const Iterator& other) const { return m_index == other.m_index; }

    private:
        friend class CodeUnits;
        Iterator(StringView view, unsigned index)
            : m_view(view)
            , m_index(index)
        {
        }

        StringView m_view;
        unsigned m_index;
    };

    Iterator begin() const { return { m_view, 0 }; }
    Iterator end() const { return { m_view, m_view.length() }; }

private:
    friend class StringView;
    explicit CodeUnits(StringView view)
        : m_view(view)
    {
    }

    StringView m_view;
};

// A lone surrogate is itself.
class StringView::CodePoints {
public:
    class Iterator {
    public:
        char32_t operator*() const
        {
            char16_t first = m_view[m_index];
            return isAtPair() ? U16_GET_SUPPLEMENTARY(first, m_view[m_index + 1]) : first;
        }
        Iterator& operator++()
        {
            m_index += isAtPair() ? 2 : 1;
            return *this;
        }
        bool operator==(const Iterator& other) const { return m_index == other.m_index; }

    private:
        friend class CodePoints;
        Iterator(StringView view, unsigned index)
            : m_view(view)
            , m_index(index)
        {
        }

        bool isAtPair() const { return U16_IS_LEAD(m_view[m_index]) && m_index + 1 < m_view.length() && U16_IS_TRAIL(m_view[m_index + 1]); }

        StringView m_view;
        unsigned m_index;
    };

    Iterator begin() const { return { m_view, 0 }; }
    Iterator end() const { return { m_view, m_view.length() }; }
    Iterator codePointAt(unsigned index) const { return { m_view, index }; }

private:
    friend class StringView;
    explicit CodePoints(StringView view)
        : m_view(view)
    {
    }

    StringView m_view;
};

class StringView::SplitResult {
public:
    class Iterator {
    public:
        StringView operator*() const { return m_view.substring(m_start, m_end - m_start); }
        Iterator& operator++()
        {
            findFrom(m_end);
            return *this;
        }
        bool operator==(const Iterator& other) const { return m_start == other.m_start; }

    private:
        friend class SplitResult;
        Iterator(StringView view, char16_t separator, unsigned start)
            : m_view(view)
            , m_separator(separator)
        {
            findFrom(start);
        }

        void findFrom(unsigned start)
        {
            while (start < m_view.length() && m_view[start] == m_separator)
                ++start;
            m_start = start;
            m_end = std::min<size_t>(m_view.find(m_separator, start), m_view.length());
        }

        StringView m_view;
        char16_t m_separator;
        unsigned m_start;
        unsigned m_end;
    };

    Iterator begin() const { return { m_view, m_separator, 0 }; }
    Iterator end() const { return { m_view, m_separator, m_view.length() }; }

private:
    friend class StringView;
    SplitResult(StringView view, char16_t separator)
        : m_view(view)
        , m_separator(separator)
    {
    }

    StringView m_view;
    char16_t m_separator;
};

inline auto StringView::codeUnits() const -> CodeUnits { return CodeUnits { *this }; }
inline auto StringView::codePoints() const -> CodePoints { return CodePoints { *this }; }
inline auto StringView::split(char16_t separator) const -> SplitResult { return { *this, separator }; }

namespace Unicode {

template<typename T> struct ConversionResult {
    std::span<T> buffer;
};

// As many whole characters as fit.
inline ConversionResult<char8_t> convertReplacingInvalidSequences(std::span<const char16_t> source, std::span<char8_t> buffer)
{
    return { buffer.first(engine_text_write_utf8(source, buffer.data(), buffer.size())) };
}

}

}

using WTF::codePointCompare;
using WTF::codePointCompareLessThan;
using WTF::equal;
using WTF::equalIgnoringASCIICase;
using WTF::equalLettersIgnoringASCIICase;
using WTF::nullStringView;
