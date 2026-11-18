#pragma once

#include "engine/api/Layout.h"
#include "engine/support/Noncopyable.h"
#include "engine/support/RefPtr.h"
#include "engine/text/StringCommon.h"
#include "engine/text/StringHasher.h"
#include "engine/text/TextForward.h"

#include <atomic>
#include <bit>
#include <limits>

namespace WTF {
class StaticStringImpl;
}

// A function that returns a string returns a reference to it.
extern "C" {
extern const WTF::StaticStringImpl engine_empty_string;
void engine_text_destroy(WTF::StringImpl*);
unsigned engine_text_compute_hash(const WTF::StringImpl&);
void engine_text_set_never_atomize(WTF::StringImpl&);
size_t engine_text_shared_cost(const WTF::StringImpl&);
WTF::StringImpl* engine_text_borrow_latin1(const WTF::Latin1Character*, size_t length) RETURNS_NONNULL;
WTF::StringImpl* engine_text_borrow_utf16(const char16_t*, size_t length) RETURNS_NONNULL;
WTF::StringImpl* engine_text_shared_substring(const WTF::StringImpl&, unsigned start, unsigned length) RETURNS_NONNULL;
WTF::StringImpl* engine_text_isolated_copy(const WTF::StringImpl&) RETURNS_NONNULL;
}

namespace WTF {

// `bun_engine_text::StringImpl`.
class StringImpl {
    WTF_MAKE_NONCOPYABLE(StringImpl);

public:
    static constexpr unsigned MaxLength = Engine::Layout::maxStringLength;

    template<typename T> static constexpr bool isValidLength(size_t length)
    {
        return length <= std::min<size_t>(MaxLength, (std::numeric_limits<unsigned>::max() - sizeof(StringImpl)) / sizeof(T));
    }

    static StringImpl* empty() RETURNS_NONNULL { return fromStatic(engine_empty_string); }
    static StringImpl* fromStatic(const StaticStringImpl& string) RETURNS_NONNULL { return reinterpret_cast<StringImpl*>(const_cast<StaticStringImpl*>(&string)); }

    static Ref<StringImpl> create(std::span<const Latin1Character>);
    static Ref<StringImpl> create(std::span<const char16_t>);

    // The characters outlive the string.
    static Ref<StringImpl> createWithoutCopying(std::span<const Latin1Character> characters) { return adoptRef(*engine_text_borrow_latin1(characters.data(), characters.size())); }
    static Ref<StringImpl> createWithoutCopying(std::span<const char16_t> characters) { return adoptRef(*engine_text_borrow_utf16(characters.data(), characters.size())); }
    static Ref<StringImpl> createWithoutCopying(std::span<const char> characters) { return createWithoutCopying(byteCast<Latin1Character>(characters)); }

    static Ref<StringImpl> createSubstringSharingImpl(StringImpl& string, unsigned start, unsigned length) { return adoptRef(*engine_text_shared_substring(string, start, length)); }

    // The caller writes all of `characters` before anything reads the string.
    template<IsStringStorageCharacter T> static RefPtr<StringImpl> tryCreateUninitialized(size_t length, std::span<T>& characters);
    template<IsStringStorageCharacter T> static Ref<StringImpl> createUninitialized(size_t length, std::span<T>& characters);

    unsigned length() const { return m_length; }
    bool isEmpty() const { return !m_length; }
    bool is8Bit() const { return m_hashAndFlags & s_is8Bit; }

    const void* rawCharacters() const LIFETIME_BOUND { return m_characters; }

    std::span<const Latin1Character> span8() const LIFETIME_BOUND
    {
        ASSERT(is8Bit());
        return { static_cast<const Latin1Character*>(m_characters), m_length };
    }

    std::span<const char16_t> span16() const LIFETIME_BOUND
    {
        ASSERT(!is8Bit() || isEmpty());
        return { static_cast<const char16_t*>(m_characters), m_length };
    }

    char16_t operator[](unsigned index) const
    {
        ASSERT_WITH_SECURITY_IMPLICATION(index < m_length);
        return is8Bit() ? char16_t { span8()[index] } : span16()[index];
    }

    bool startsWith(char16_t character) const { return m_length && (*this)[0] == character; }

    bool isAtom() const { return m_hashAndFlags & s_isAtom; }
    bool isArrayIndexAtom() const { return m_hashAndFlags & s_isArrayIndex; }
    bool isSymbol() const { return m_hashAndFlags & s_isSymbol; }
    bool isExternal() const { return (m_hashAndFlags & s_bufferMask) == s_externalBuffer; }
    bool isSubString() const { return (m_hashAndFlags & s_bufferMask) == s_substringBuffer; }
    bool canBecomeAtom() const { return !(m_hashAndFlags & s_neverAtomize); }
    void setNeverAtomize() { engine_text_set_never_atomize(*this); }

    bool hasHash() const { return m_hashAndFlags >> s_flagCount; }
    unsigned hash() const { return hasHash() ? existingHash() : engine_text_compute_hash(*this); }
    unsigned existingHash() const
    {
        ASSERT(hasHash());
        return m_hashAndFlags >> s_flagCount;
    }
    inline unsigned existingSymbolAwareHash() const;

    size_t costDuringGC() const { return engine_text_shared_cost(*this); }

    bool isStatic() const { return m_refCount.load(std::memory_order_relaxed) & s_isStatic; }
    uint32_t refCount() const { return m_refCount.load(std::memory_order_relaxed) / s_refCountIncrement; }
    bool hasOneRef() const { return m_refCount.load(std::memory_order_acquire) == s_refCountIncrement; }
    bool hasAtLeastOneRef() const { return m_refCount.load(std::memory_order_relaxed); }

    ALWAYS_INLINE void ref()
    {
        // The rotation takes the flag to the top: one comparison finds both static strings and counts at the limit.
        uint32_t count = m_refCount.load(std::memory_order_relaxed);
        if (std::rotr(count, 1) <= s_refCountLimit / s_refCountIncrement) [[likely]]
            m_refCount.fetch_add(s_refCountIncrement, std::memory_order_relaxed);
        else
            RELEASE_ASSERT(count & s_isStatic);
    }

    ALWAYS_INLINE void deref()
    {
        uint32_t count = m_refCount.load(std::memory_order_relaxed);
        if (count & s_isStatic)
            return;
        if (count == s_refCountIncrement || m_refCount.fetch_sub(s_refCountIncrement, std::memory_order_release) == s_refCountIncrement)
            engine_text_destroy(this);
    }

    Ref<StringImpl> isolatedCopy() const { return adoptRef(*engine_text_isolated_copy(*this)); }

    template<typename T> static ALWAYS_INLINE void copyCharacters(std::span<T> destination, std::span<const T> source) { copyElements(destination, source); }
    static void copyCharacters(std::span<char16_t> destination, std::span<const Latin1Character> source) { copyElements(destination, source); }
    static void copyCharacters(std::span<Latin1Character> destination, std::span<const char16_t> source)
    {
        ASSERT(charactersAreAllLatin1(source));
        copyElements(destination, source);
    }

    // `notFound` if `source` has a lone surrogate. `destination` has room for three bytes per code unit.
    static size_t tryConvertUTF16ToUTF8(std::span<const char16_t> source, std::span<char8_t> destination);
    // False unless `source` is valid and fills `destination`.
    static bool tryConvertUTF8ToUTF16(std::span<const char8_t> source, std::span<char16_t> destination);

protected:
    ~StringImpl() = default;

private:
    friend class StaticStringImpl;
    friend class SymbolImpl;

    static constexpr unsigned s_flagCount = Engine::Layout::stringFlagCount;
    static constexpr unsigned s_bufferMask = Engine::Layout::stringBufferMask;
    static constexpr unsigned s_substringBuffer = Engine::Layout::substringBuffer;
    static constexpr unsigned s_externalBuffer = Engine::Layout::externalBuffer;
    static constexpr unsigned s_is8Bit = Engine::Layout::stringIsLatin1;
    static constexpr unsigned s_didReportCost = Engine::Layout::stringDidReportCost;
    static constexpr unsigned s_isAtom = Engine::Layout::stringIsAtom;
    static constexpr unsigned s_isSymbol = Engine::Layout::stringIsSymbol;
    static constexpr unsigned s_neverAtomize = Engine::Layout::stringIsNeverAtomized;
    static constexpr unsigned s_isArrayIndex = Engine::Layout::stringIsArrayIndex;

    static constexpr uint32_t s_isStatic = Engine::Layout::stringIsStatic;
    static constexpr uint32_t s_refCountIncrement = Engine::Layout::stringRefCountIncrement;
    static constexpr uint32_t s_refCountLimit = Engine::Layout::stringRefCountLimit;

    // Characters of the same allocation start in what would be padding.
    static constexpr size_t s_tailOffset = Engine::Layout::StringImpl_tail;
    template<typename T> T* tail() { return reinterpret_cast<T*>(reinterpret_cast<char*>(this) + s_tailOffset); }

    StringImpl(unsigned length, unsigned flags)
        : m_refCount(s_refCountIncrement)
        , m_length(length)
        , m_characters(tail<char>())
        , m_hashAndFlags(flags)
    {
        static_assert(offsetof(StringImpl, m_length) == Engine::Layout::StringImpl_length);
        static_assert(offsetof(StringImpl, m_characters) == Engine::Layout::StringImpl_data);
        static_assert(offsetof(StringImpl, m_hashAndFlags) == Engine::Layout::StringImpl_flags);
    }

    std::atomic<uint32_t> m_refCount;
    unsigned m_length;
    const void* m_characters;
    // Only the thread that the string belongs to writes it, and the bits that other threads ask for stay as they are.
    unsigned m_hashAndFlags;
};

// `bun_engine_text::StaticString`.
class StaticStringImpl {
    WTF_MAKE_NONCOPYABLE(StaticStringImpl);

public:
    explicit consteval StaticStringImpl(ASCIILiteral literal)
        : StaticStringImpl(literal, 0)
    {
    }

    operator StringImpl&() const { return *StringImpl::fromStatic(*this); }

private:
    friend class SymbolImpl;

    consteval StaticStringImpl(ASCIILiteral literal, unsigned kind)
        : m_length(literal.length())
        , m_characters(literal.characters())
        , m_hashAndFlags(StringHasher::computeLiteralHash(literal.span()) << StringImpl::s_flagCount | StringImpl::s_is8Bit | StringImpl::s_didReportCost | kind)
    {
    }

    [[maybe_unused]] uint32_t m_refCount { StringImpl::s_isStatic };
    [[maybe_unused]] unsigned m_length;
    [[maybe_unused]] const char* m_characters;
    [[maybe_unused]] unsigned m_hashAndFlags;
};

static_assert(sizeof(StringImpl) == Engine::Layout::sizeOfStringImpl && sizeof(StaticStringImpl) == Engine::Layout::sizeOfStaticString);

#define MAKE_STATIC_STRING_IMPL(literal) ([] {                 \
    static constexpr WTF::StaticStringImpl string { literal }; \
    return &string;                                            \
}())

template<IsStringStorageCharacter T> ALWAYS_INLINE RefPtr<StringImpl> StringImpl::tryCreateUninitialized(size_t length, std::span<T>& characters)
{
    characters = {};
    if (!length)
        return adoptRef(empty());
    if (!isValidLength<T>(length)) [[unlikely]]
        return nullptr;
    void* memory = FastMalloc::tryMalloc(std::max(s_tailOffset + length * sizeof(T), sizeof(StringImpl)));
    if (!memory) [[unlikely]]
        return nullptr;
    auto* string = new (NotNull, memory) StringImpl(length, sizeof(T) == 1 ? s_is8Bit : 0);
    characters = { string->template tail<T>(), length };
    return adoptRef(string);
}

template<IsStringStorageCharacter T> inline Ref<StringImpl> StringImpl::createUninitialized(size_t length, std::span<T>& characters)
{
    auto string = tryCreateUninitialized(length, characters);
    if (!string) [[unlikely]]
        Support__outOfMemory();
    return string.releaseNonNull();
}

bool equal(const StringImpl&, const StringImpl&);

// Null is equal to null alone.
inline bool equal(const StringImpl* a, const StringImpl* b)
{
    return a == b || (a && b && equal(*a, *b));
}

ALWAYS_INLINE bool equal(const StringImpl* a, std::span<const Latin1Character> b)
{
    if (!a || !b.data())
        return !a && !b.data();
    if (a->length() != b.size())
        return false;
    if (a->is8Bit()) [[likely]]
        return Detail::equalCharacters(a->span8().data(), b.data(), b.size());
    return Detail::equalCharacters(a->span16().data(), b.data(), b.size());
}

ALWAYS_INLINE bool equal(const StringImpl* a, ASCIILiteral b) { return equal(a, b.span8()); }

}

using WTF::equal;
using WTF::StaticStringImpl;
