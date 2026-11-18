#pragma once

#include "engine/support/RefCounted.h"
#include "engine/support/RefPtr.h"
#include "engine/text/StringCommon.h"
#include "engine/text/TextForward.h"

namespace WTF {

// Either turns a lone surrogate into U+FFFD.
enum ConversionMode : uint8_t {
    LenientConversion,
    StrictConversionReplacingUnpairedSurrogatesWithFFFD,
};

enum class UTF8ConversionError : uint8_t { OutOfMemory };

// Bytes that a zero byte follows.
class CStringBuffer final : public RefCounted<CStringBuffer> {
public:
    static RefPtr<CStringBuffer> tryCreateUninitialized(size_t length);
    static Ref<CStringBuffer> create(std::span<const char>);

    size_t length() const { return m_length; }
    char* data() LIFETIME_BOUND { return reinterpret_cast<char*>(this + 1); }

private:
    explicit CStringBuffer(size_t length)
        : m_length(length)
    {
        data()[length] = 0;
    }

    const size_t m_length;
};

// A string for C interfaces, or null. The type of its characters names the encoding: UTF-8, Latin-1, or `char` for ASCII.
template<typename T> class CString final {
    WTF_MAKE_TZONE_ALLOCATED(CString);

public:
    CString() = default;

    CString(ASCIILiteral literal)
        : CString(byteCast<T>(literal.span()))
    {
    }

    explicit CString(std::span<const T> characters)
    {
        if (characters.data())
            m_buffer = CStringBuffer::create(byteCast<char>(characters));
    }

    // Null if there is no memory.
    static CString tryCreateUninitialized(size_t length, std::span<T>& characters)
    {
        CString result;
        result.m_buffer = CStringBuffer::tryCreateUninitialized(length);
        characters = spanConstCast<T>(result.span());
        return result;
    }

    bool isNull() const { return !m_buffer; }
    friend bool operator==(const CString& a, const CString& b) { return a.isNull() == b.isNull() && equalSpans(a.span(), b.span()); }
    bool isEmpty() const { return !length(); }
    size_t length() const { return m_buffer ? m_buffer->length() : 0; }

    const T* data() const LIFETIME_BOUND { return m_buffer ? byteCast<T>(m_buffer->data()) : nullptr; }
    const char* legacyCStringPointer() const LIFETIME_BOUND
        requires std::same_as<T, char8_t>
    {
        return byteCast<char>(data());
    }

    std::span<const T> span() const LIFETIME_BOUND { return { data(), length() }; }
    std::span<const T> spanIncludingNullTerminator() const LIFETIME_BOUND { return { data(), m_buffer ? m_buffer->length() + 1 : 0 }; }

    // Copies the characters if another string shares them.
    std::span<T> mutableSpan() LIFETIME_BOUND
    {
        if (m_buffer && !m_buffer->hasOneRef())
            *this = CString { span() };
        return spanConstCast<T>(span());
    }

private:
    RefPtr<CStringBuffer> m_buffer;
};

}

using WTF::ConversionMode;
using WTF::LenientConversion;
using WTF::StrictConversionReplacingUnpairedSurrogatesWithFFFD;
using WTF::UTF8ConversionError;
