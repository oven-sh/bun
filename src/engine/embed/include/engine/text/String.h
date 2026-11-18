#pragma once

#include "engine/support/Function.h"
#include "engine/text/ExternalStringImpl.h"
#include "engine/text/StringView.h"
#include "engine/text/SymbolImpl.h"

namespace WTF {

// A counted reference to immutable characters, or null.
class String final {
    WTF_MAKE_TZONE_ALLOCATED(String);

public:
    static constexpr unsigned MaxLength = StringImpl::MaxLength;

    String() = default;

    String(StringImpl& string)
        : m_impl(string)
    {
    }

    String(StringImpl* string)
        : m_impl(string)
    {
    }

    String(const StaticStringImpl* string)
        : m_impl(adoptRef(StringImpl::fromStatic(*string)))
    {
    }

    String(Ref<StringImpl>&& string)
        : m_impl(WTF::move(string))
    {
    }

    String(RefPtr<StringImpl>&& string)
        : m_impl(WTF::move(string))
    {
    }

    String(Ref<ExternalStringImpl>&& string)
        : m_impl(WTF::move(string))
    {
    }

    String(Ref<AtomStringImpl>&& string)
        : m_impl(WTF::move(string))
    {
    }

    String(RefPtr<AtomStringImpl>&& string)
        : m_impl(WTF::move(string))
    {
    }

    ALWAYS_INLINE String(ASCIILiteral literal)
    {
        if (!literal.isEmpty())
            m_impl = StringImpl::createWithoutCopying(literal.span8());
        else if (!literal.isNull())
            m_impl = adoptRef(StringImpl::empty());
    }

    String(std::span<const Latin1Character> characters)
    {
        if (characters.data())
            m_impl = StringImpl::create(characters);
    }

    String(std::span<const char16_t> characters)
    {
        if (characters.data())
            m_impl = StringImpl::create(characters);
    }

    static String fromLatin1(const char* characters) { return byteCast<Latin1Character>(unsafeSpan(characters)); }

    // Null if the bytes are not UTF-8.
    static String fromUTF8(std::span<const char8_t>);
    static String fromUTF8(std::span<const Latin1Character> bytes) { return fromUTF8(byteCast<char8_t>(bytes)); }
    static String fromUTF8(std::span<const uint8_t> bytes) { return fromUTF8(byteCast<char8_t>(bytes)); }
    static String fromUTF8(std::span<const char> bytes) { return fromUTF8(byteCast<char8_t>(bytes)); }
    static String fromUTF8(const char* bytes) { return fromUTF8(unsafeSpan(bytes)); }

    // Null if the string cannot be allocated.
    static String tryFromUTF8ReplacingInvalidSequences(std::span<const char8_t>);
    static String fromUTF8ReplacingInvalidSequences(std::span<const char8_t>);
    static String fromUTF8ReplacingInvalidSequences(std::span<const Latin1Character> bytes) { return fromUTF8ReplacingInvalidSequences(byteCast<char8_t>(bytes)); }
    static String fromUTF8ReplacingInvalidSequences(std::span<const uint8_t> bytes) { return fromUTF8ReplacingInvalidSequences(byteCast<char8_t>(bytes)); }

    static String number(int);
    static String number(unsigned);
    static String number(long);
    static String number(unsigned long);
    static String number(long long);
    static String number(unsigned long long);
    static String number(double);

    template<IsStringStorageCharacter T> static String createUninitialized(unsigned length, std::span<T>& characters) { return StringImpl::createUninitialized(length, characters); }
    template<IsStringStorageCharacter T> static String tryCreateUninitialized(size_t length, std::span<T>& characters) { return StringImpl::tryCreateUninitialized(length, characters); }

    bool isNull() const { return !m_impl; }
    bool isEmpty() const { return !m_impl || m_impl->isEmpty(); }
    unsigned length() const { return m_impl ? m_impl->length() : 0; }
    bool is8Bit() const { return !m_impl || m_impl->is8Bit(); }
    unsigned sizeInBytes() const { return length() << !is8Bit(); }

    StringImpl* impl() const LIFETIME_BOUND { return m_impl.get(); }
    RefPtr<StringImpl> releaseImpl() { return WTF::move(m_impl); }

    std::span<const Latin1Character> span8() const LIFETIME_BOUND { return m_impl ? m_impl->span8() : std::span<const Latin1Character> {}; }
    std::span<const char16_t> span16() const LIFETIME_BOUND { return m_impl ? m_impl->span16() : std::span<const char16_t> {}; }

    // Zero past the end.
    char16_t codeUnitAt(unsigned index) const
    {
        auto characters = view();
        return index < characters.length() ? characters[index] : 0;
    }
    char16_t operator[](unsigned index) const { return codeUnitAt(index); }

    std::expected<UTF8CString, UTF8ConversionError> tryGetUTF8(ConversionMode mode = LenientConversion) const { return view().tryGetUTF8(mode); }
    UTF8CString utf8(ConversionMode mode = LenientConversion) const { return view().utf8(mode); }
    // What is not Latin-1 becomes `?`.
    Latin1CString latin1() const;

    size_t find(char16_t character, unsigned start = 0) const { return view().find(character, start); }
    size_t find(char character, unsigned start = 0) const { return view().find(character, start); }
    size_t find(ASCIILiteral literal, unsigned start = 0) const { return view().find(literal, start); }
    size_t find(StringView string, unsigned start = 0) const { return m_impl && string ? view().find(string, start) : notFound; }
    size_t findIgnoringASCIICase(StringView string, unsigned start = 0) const { return view().findIgnoringASCIICase(string, start); }
    size_t reverseFind(char16_t character, unsigned start = MaxLength) const { return view().reverseFind(character, start); }

    bool contains(char16_t character) const { return find(character) != notFound; }
    bool contains(ASCIILiteral literal) const { return find(literal) != notFound; }
    bool contains(StringView string) const { return find(string) != notFound; }

    bool startsWith(char16_t character) const { return view().startsWith(character); }
    bool endsWith(char16_t character) const { return view().endsWith(character); }
    ALWAYS_INLINE bool startsWith(StringView prefix) const { return view().startsWith(prefix); }
    ALWAYS_INLINE bool endsWith(StringView suffix) const { return view().endsWith(suffix); }
    bool startsWithIgnoringASCIICase(StringView prefix) const { return view().startsWithIgnoringASCIICase(prefix); }

    bool containsOnlyASCII() const { return view().containsOnlyASCII(); }
    bool containsOnlyLatin1() const { return is8Bit() || charactersAreAllLatin1(span16()); }
    template<bool matches(char16_t)> bool containsOnly() const
    {
        return view().find([](char16_t character) { return !matches(character); }) == notFound;
    }

    // Copies the characters.
    [[nodiscard]] String substring(unsigned start, unsigned length = MaxLength) const { return withPart(view().substring(start, length)); }
    [[nodiscard]] String left(unsigned length) const { return substring(0, length); }
    [[nodiscard]] ALWAYS_INLINE String trim(CodeUnitMatchFunction matches) const { return withPart(view().trim(matches)); }
    [[nodiscard]] String substringSharingImpl(unsigned start, unsigned length = MaxLength) const;

    [[nodiscard]] String convertToASCIILowercase() const;
    [[nodiscard]] String convertToASCIIUppercase() const;
    [[nodiscard]] String convertToUppercaseWithoutLocale() const;
    void convertTo16Bit();

    void split(char16_t separator, NOESCAPE const Invocable<void(StringView)> auto& function) const
    {
        for (auto part : view().split(separator))
            function(part);
    }

    [[nodiscard]] String isolatedCopy() const&;
    [[nodiscard]] String isolatedCopy() &&;

private:
    StringView view() const LIFETIME_BOUND { return m_impl.get(); }
    String withPart(StringView part) const { return part.length() == length() ? *this : part.toString(); }

    RefPtr<StringImpl> m_impl;
};

static_assert(sizeof(String) == sizeof(void*));

template<> struct VectorTraits<String> : MovableClassVectorTraits {};

namespace Detail {

// What a `String` or an `AtomString` has in memory, without a destructor to run at exit.
inline constexpr const StaticStringImpl* nullStringStorage = nullptr;
inline constexpr const StaticStringImpl* emptyStringStorage = &engine_empty_string;

}

inline const String& nullString() { return reinterpret_cast<const String&>(Detail::nullStringStorage); }
inline const String& emptyString() { return reinterpret_cast<const String&>(Detail::emptyStringStorage); }

inline bool operator!(const String& string) { return string.isNull(); }
inline bool operator==(const String& a, const String& b) { return equal(a.impl(), b.impl()); }
ALWAYS_INLINE bool operator==(const String& a, ASCIILiteral b) { return equal(a.impl(), b); }

inline bool equalIgnoringASCIICase(const String& a, ASCIILiteral b) { return !a.isNull() && equalIgnoringASCIICase(StringView { a }, b); }
inline bool equalLettersIgnoringASCIICase(const String& a, ASCIILiteral b) { return equalIgnoringASCIICase(a, b); }

[[nodiscard]] String makeStringByReplacingAll(const String&, char16_t target, char16_t replacement);
[[nodiscard]] String makeStringByReplacingAll(const String&, StringView target, StringView replacement);
[[nodiscard]] inline String makeStringByReplacingAll(const String& string, char16_t target, ASCIILiteral replacement)
{
    return makeStringByReplacingAll(string, std::span<const char16_t> { &target, 1 }, replacement);
}

String replaceUnpairedSurrogatesWithReplacementCharacter(String&&);

inline StringView::StringView(const String& string LIFETIME_BOUND)
    : StringView(string.impl())
{
}

inline String StringView::toString() const
{
    return visitCharacters([](auto characters) { return String { characters }; });
}

inline String StringView::toStringWithoutCopying() const
{
    return visitCharacters([](auto characters) { return StringImpl::createWithoutCopying(characters); });
}

// The symbols of `Symbol.for`, which belong to the thread.
class SymbolRegistry final {
public:
    Ref<RegisteredSymbolImpl> symbolForKey(const String& key) { return adoptRef(*engine_text_registered_symbol(*key.impl())); }
};

inline namespace StringLiterals {

inline String operator""_str(const char* characters, size_t)
{
    return ASCIILiteral::fromLiteralUnsafe(characters);
}

}

}

using WTF::emptyString;
using WTF::equalIgnoringASCIICase;
using WTF::equalLettersIgnoringASCIICase;
using WTF::makeStringByReplacingAll;
using WTF::nullString;
