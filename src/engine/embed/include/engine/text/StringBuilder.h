#pragma once

#include "engine/text/StringConcatenate.h"

namespace WTF::Detail {

// `bun_engine_text::StringBuilder`.
struct StringBuilderState {
    void* characters;
    size_t length;
    // The one for the other width is zero.
    size_t capacity8;
    size_t capacity16;
    bool is8Bit;
    bool hasOverflowed;
    bool isAllocated;
    void* scratch;
    size_t scratchSize;
};

}

extern "C" void engine_text_builder_clear(WTF::Detail::StringBuilderState&);

namespace WTF {

enum class OverflowPolicy : uint8_t { CrashOnOverflow,
    RecordOverflow };

class StringBuilder {
    WTF_MAKE_NONCOPYABLE(StringBuilder);
    WTF_MAKE_TZONE_ALLOCATED(StringBuilder);

public:
    StringBuilder() = default;

    explicit StringBuilder(OverflowPolicy policy)
        : m_overflowPolicy(policy)
    {
    }

    StringBuilder(StringBuilder&&);

    ~StringBuilder()
    {
        if (m_state.isAllocated)
            engine_text_builder_clear(m_state);
    }

    void clear()
    {
        engine_text_builder_clear(m_state);
        m_string = {};
    }

    void didOverflow();
    bool hasOverflowed() const { return m_state.hasOverflowed; }

    bool isEmpty() const { return !m_state.length && !hasOverflowed(); }
    bool is8Bit() const { return m_state.is8Bit; }

    unsigned length() const
    {
        RELEASE_ASSERT(!hasOverflowed());
        return m_state.length;
    }

    unsigned capacity() const
    {
        RELEASE_ASSERT(!hasOverflowed());
        return m_state.capacity8 | m_state.capacity16;
    }

    std::span<const Latin1Character> span8() const LIFETIME_BOUND
    {
        ASSERT(is8Bit());
        return { static_cast<const Latin1Character*>(m_state.characters), m_state.length };
    }

    ALWAYS_INLINE void append(Latin1Character character)
    {
        if (hasRoom<Latin1Character>(1)) [[likely]]
            *extend<Latin1Character>(1) = character;
        else
            appendSlowly(character);
    }

    ALWAYS_INLINE void append(char16_t character)
    {
        if (hasRoom<char16_t>(1))
            *extend<char16_t>(1) = character;
        else if (isLatin1(character) && hasRoom<Latin1Character>(1)) [[likely]]
            *extend<Latin1Character>(1) = character;
        else
            appendSlowly(character);
    }

    ALWAYS_INLINE void append(char character) { append(Latin1Character { character }); }

    ALWAYS_INLINE void append(ASCIILiteral literal)
    {
        if (hasRoom<Latin1Character>(literal.length())) [[likely]]
            Detail::copyBytes(extend<Latin1Character>(literal.length()), literal.characters(), literal.length());
        else
            append(literal.span8());
    }

    void append(std::span<const Latin1Character>);
    void append(std::span<const char16_t>);
    void append(StringView);
    void append(const String&);
    void append(const AtomString& string) { append(string.string()); }

    void append(const char*) = delete;
    void append(uint8_t) = delete;

    template<typename... Types> ALWAYS_INLINE void append(const Types&... values) { appendAdapted(Detail::AdapterFor<Types>(values)...); }

    void appendQuotedJSONString(const String&);

    void reserveCapacity(unsigned capacity);
    void shrink(unsigned length);
    void shrinkToFit();

    const String& toString() & LIFETIME_BOUND
    {
        shrinkToFit();
        RELEASE_ASSERT(!hasOverflowed());
        return m_string;
    }

    String toString() &&;

private:
    // `count` is far from the limit of its type.
    template<typename T> ALWAYS_INLINE bool hasRoom(size_t count) const { return m_state.length + count <= (sizeof(T) == 1 ? m_state.capacity8 : m_state.capacity16); }

    // The caller writes all of the characters.
    template<typename T> ALWAYS_INLINE T* extend(size_t count)
    {
        ASSERT(hasRoom<T>(count));
        return static_cast<T*>(m_state.characters) + std::exchange(m_state.length, m_state.length + count);
    }

    // These return false after an overflow.
    bool grow(size_t count);
    bool widen(size_t count);
    bool checkForOverflow();

    void appendSlowly(char16_t);
    bool isSharingString() const { return !m_state.isAllocated && m_state.characters != m_scratch; }
    void share(String&&);

    void appendAdapted(auto&&... adapters)
    {
        size_t count = Detail::totalLength(adapters...);
        if (Detail::are8Bit(adapters...) && (hasRoom<Latin1Character>(count) || (is8Bit() && grow(count)))) [[likely]]
            Detail::writeAll(extend<Latin1Character>(count), adapters...);
        else
            appendAdapted16(count, adapters...);
    }

    NEVER_INLINE void appendAdapted16(size_t count, auto&... adapters)
    {
        if (count && (hasRoom<char16_t>(count) || widen(count)))
            Detail::writeAll(extend<char16_t>(count), adapters...);
    }

    Detail::StringBuilderState m_state { m_scratch, 0, sizeof(m_scratch), 0, true, false, false, m_scratch, sizeof(m_scratch) };
    // What toString() has returned or what was appended first. It has the characters until more are appended.
    String m_string;
    OverflowPolicy m_overflowPolicy { OverflowPolicy::CrashOnOverflow };
    alignas(char16_t) char m_scratch[126];
};

}

using WTF::OverflowPolicy;
