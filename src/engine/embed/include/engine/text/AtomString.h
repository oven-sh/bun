#pragma once

#include "engine/text/String.h"

namespace WTF {

// A counted reference to an atom or a symbol, or null.
class AtomString final {
    WTF_MAKE_TZONE_ALLOCATED(AtomString);

public:
    AtomString() = default;

    AtomString(std::span<const Latin1Character> characters)
        : m_string(AtomStringImpl::add(characters))
    {
    }

    AtomString(std::span<const char16_t> characters)
        : m_string(AtomStringImpl::add(characters))
    {
    }

    AtomString(ASCIILiteral literal)
    {
        if (!literal.isNull())
            m_string = AtomStringImpl::add(literal);
    }

    AtomString(UniquedStringImpl* string)
        : m_string(string)
    {
    }

    AtomString(Ref<AtomStringImpl>&& atom)
        : m_string(WTF::move(atom))
    {
    }

    AtomString(RefPtr<AtomStringImpl>&& atom)
        : m_string(WTF::move(atom))
    {
    }

    AtomString(StringImpl* string)
        : m_string(AtomStringImpl::add(string))
    {
    }

    explicit AtomString(const String& string)
        : m_string(AtomStringImpl::add(string.impl()))
    {
    }

    explicit AtomString(String&& string)
        : m_string(AtomStringImpl::add(string.releaseImpl()))
    {
    }

    // Null if the bytes are not UTF-8.
    static AtomString fromUTF8(std::span<const char> bytes)
    {
        if (charactersAreAllASCII(bytes))
            return byteCast<Latin1Character>(bytes);
        return AtomString { String::fromUTF8(bytes) };
    }

    operator const String&() const LIFETIME_BOUND { return m_string; }
    const String& string() const LIFETIME_BOUND { return m_string; }

    AtomStringImpl* impl() const LIFETIME_BOUND { return static_cast<AtomStringImpl*>(m_string.impl()); }
    RefPtr<AtomStringImpl> releaseImpl() { return adoptRef(static_cast<AtomStringImpl*>(m_string.releaseImpl().leakRef())); }

    bool isNull() const { return m_string.isNull(); }
    bool isEmpty() const { return m_string.isEmpty(); }
    unsigned length() const { return m_string.length(); }
    bool is8Bit() const { return m_string.is8Bit(); }
    std::span<const Latin1Character> span8() const LIFETIME_BOUND { return m_string.span8(); }
    std::span<const char16_t> span16() const LIFETIME_BOUND { return m_string.span16(); }

private:
    String m_string;
};

template<> struct VectorTraits<AtomString> : SimpleClassVectorTraits {};


inline bool operator==(const AtomString& a, const AtomString& b) { return a.impl() == b.impl(); }
inline bool operator==(const AtomString& a, const String& b) { return a.string() == b; }
ALWAYS_INLINE bool operator==(const AtomString& a, ASCIILiteral b) { return a.string() == b; }

inline StringView::StringView(const AtomString& string LIFETIME_BOUND)
    : StringView(string.string())
{
}

inline AtomString StringView::toAtomString() const
{
    return visitCharacters([](auto characters) { return AtomString { characters }; });
}

}

