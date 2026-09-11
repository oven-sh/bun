/*
 * Copyright (C) 2006 Apple Inc.  All rights reserved.
 * Copyright (C) 2009 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "HTTPHeaderNames.h"
#include <utility>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// FIXME: Not every header fits into a map. Notably, multiple Set-Cookie header fields are needed to set multiple cookies.

// ASCII-lowercase a header name. Equivalent to String::convertToASCIILowercase
// but routes both the 8-bit and 16-bit paths through Highway SIMD kernels so
// the scan and copy don't depend on the build's -march. Returns the original
// String (no allocation) when it is already lowercase, matching the WTF
// behavior.
String lowercaseHeaderName(const String&);

// The value of one header, and the buffer that `append` grows.
//
// A name with a single value holds it in `m_string` and costs what a String
// costs. The second value for the same name moves into a StringBuilder, so N
// appends copy O(N) bytes in total instead of O(N^2): the builder over-allocates
// and writes each new value into the spare capacity. `string()` hands readers
// the combined value without a copy, as a substring of that buffer.
class HeaderValue {
public:
    HeaderValue() = default;
    HeaderValue(const String& value)
        : m_string(value)
    {
    }
    HeaderValue(String&& value)
        : m_string(WTF::move(value))
    {
    }

    // A copy takes the combined value but never the builder: two header maps
    // must not append into one buffer.
    HeaderValue(const HeaderValue& other)
        : m_string(other.string())
    {
    }
    HeaderValue& operator=(const HeaderValue& other)
    {
        *this = other.string();
        return *this;
    }
    HeaderValue(HeaderValue&&) = default;
    HeaderValue& operator=(HeaderValue&&) = default;

    HeaderValue& operator=(const String& value)
    {
        // Assign before dropping the builder. `value` can be the String the
        // builder owns, which is what `*this = other.string()` passes when a
        // HeaderValue is assigned to itself.
        m_string = value;
        m_builder = nullptr;
        return *this;
    }

    const String& string() const LIFETIME_BOUND { return m_builder ? m_builder->toStringPreserveCapacity() : m_string; }
    unsigned length() const { return m_builder ? m_builder->length() : m_string.length(); }

    // Returns false, and stores nothing, when the combined value does not fit in
    // a String. StringBuilder aborts the process on overflow, so the limit is
    // checked here instead and reported to the caller.
    bool append(ASCIILiteral delimiter, const String& value)
    {
        if (static_cast<uint64_t>(length()) + delimiter.length() + value.length() > String::MaxLength)
            return false;

        if (!m_builder) {
            m_builder = makeUnique<StringBuilder>();
            m_builder->append(as8Bit(m_string));
            m_string = {};
        }
        m_builder->append(delimiter, as8Bit(value));
        return true;
    }

    size_t memoryCost() const
    {
        if (!m_builder)
            return m_string.sizeInBytes();
        return sizeof(StringBuilder) + m_builder->capacity() * (m_builder->is8Bit() ? sizeof(Latin1Character) : sizeof(char16_t));
    }

    bool operator==(const HeaderValue& other) const { return string() == other.string(); }

private:
    // A stored header value holds only Latin-1 characters (isValidHTTPHeaderValue)
    // but the String can still be 16-bit. An 8-bit builder needs half the
    // buffer. It also never asks for a capacity that a StringImpl cannot hold:
    // the builder grows by doubling up to String::MaxLength, and a 16-bit
    // StringImpl holds a few characters less than that, which aborts.
    static String as8Bit(const String& value)
    {
        if (value.is8Bit())
            return value;
        return StringImpl::create8BitIfPossible(value.span16());
    }

    String m_string;
    std::unique_ptr<StringBuilder> m_builder;
};

class HTTPHeaderMap {
public:
    struct CommonHeader {
        HTTPHeaderName key;
        HeaderValue value;

        bool operator==(const CommonHeader& other) const { return key == other.key && value == other.value; }
    };

    struct UncommonHeader {
        String key;
        HeaderValue value;

        bool operator==(const UncommonHeader& other) const { return key == other.key && value == other.value; }
    };

    typedef Vector<CommonHeader, 2, CrashOnOverflow, 6> CommonHeadersVector;
    typedef Vector<UncommonHeader, 0, CrashOnOverflow, 0> UncommonHeadersVector;

    class HTTPHeaderMapConstIterator {
    public:
        HTTPHeaderMapConstIterator(const HTTPHeaderMap& table, CommonHeadersVector::const_iterator commonHeadersIt, UncommonHeadersVector::const_iterator uncommonHeadersIt, Vector<String, 0>::const_iterator setCookiesIter)
            : m_table(table)
            , m_commonHeadersIt(commonHeadersIt)
            , m_uncommonHeadersIt(uncommonHeadersIt)
        {
            if (!updateKeyValue(m_commonHeadersIt)) {
                updateKeyValue(m_uncommonHeadersIt);
            }
        }

        struct KeyValue {
            String key;
            std::optional<HTTPHeaderName> keyAsHTTPHeaderName;
            String value;

            String name() const
            {
                if (keyAsHTTPHeaderName) {
                    return WTF::httpHeaderNameDefaultCaseStringImpl(keyAsHTTPHeaderName.value());
                }

                return key;
            }
            String asciiLowerCaseName() const
            {
                if (keyAsHTTPHeaderName) {
                    return WTF::httpHeaderNameStringImpl(keyAsHTTPHeaderName.value());
                }

                return lowercaseHeaderName(key);
            }
        };

        const KeyValue* get() const
        {
            ASSERT(*this != m_table.end());
            return &m_keyValue;
        }
        const KeyValue& operator*() const { return *get(); }
        const KeyValue* operator->() const { return get(); }

        HTTPHeaderMapConstIterator& operator++()
        {

            if (m_commonHeadersIt != m_table.m_commonHeaders.end()) {
                if (updateKeyValue(++m_commonHeadersIt))
                    return *this;
            } else {
                ++m_uncommonHeadersIt;
            }

            updateKeyValue(m_uncommonHeadersIt);

            return *this;
        }

        bool operator!=(const HTTPHeaderMapConstIterator& other) const { return !(*this == other); }
        bool operator==(const HTTPHeaderMapConstIterator& other) const
        {
            return m_commonHeadersIt == other.m_commonHeadersIt && m_uncommonHeadersIt == other.m_uncommonHeadersIt;
        }

    private:
        bool updateKeyValue(CommonHeadersVector::const_iterator it)
        {
            if (it == m_table.commonHeaders().end())
                return false;
            m_keyValue.key = httpHeaderNameString(it->key).toStringWithoutCopying();
            m_keyValue.keyAsHTTPHeaderName = it->key;
            m_keyValue.value = it->value.string();
            return true;
        }
        bool updateKeyValue(UncommonHeadersVector::const_iterator it)
        {
            if (it == m_table.uncommonHeaders().end())
                return false;
            m_keyValue.key = it->key;
            m_keyValue.keyAsHTTPHeaderName = std::nullopt;
            m_keyValue.value = it->value.string();
            return true;
        }

        const HTTPHeaderMap& m_table;
        CommonHeadersVector::const_iterator m_commonHeadersIt;
        UncommonHeadersVector::const_iterator m_uncommonHeadersIt;
        KeyValue m_keyValue;
    };
    typedef HTTPHeaderMapConstIterator const_iterator;

    WEBCORE_EXPORT HTTPHeaderMap();

    bool isEmpty() const { return m_commonHeaders.isEmpty() && m_uncommonHeaders.isEmpty() && m_setCookieHeaders.isEmpty(); }
    int size() const { return m_commonHeaders.size() + m_uncommonHeaders.size() + m_setCookieHeaders.size(); }

    WEBCORE_EXPORT String get(const StringView name) const;
    WEBCORE_EXPORT void set(const String& name, const String& value);
    // The `add` overloads combine a repeated name into one value. They return
    // false, and store nothing, when that value does not fit in a String.
    WEBCORE_EXPORT bool add(const String& name, const String& value);
    WEBCORE_EXPORT bool contains(const StringView) const;
    WEBCORE_EXPORT int64_t indexOf(StringView name) const;
    WEBCORE_EXPORT bool remove(const StringView);
    WEBCORE_EXPORT bool removeUncommonHeader(const StringView);

    WEBCORE_EXPORT String get(HTTPHeaderName) const;
    void set(HTTPHeaderName, const String& value);
    bool add(HTTPHeaderName, const String& value);
    WEBCORE_EXPORT bool contains(HTTPHeaderName) const;
    WEBCORE_EXPORT bool remove(HTTPHeaderName);

    size_t memoryCost() const;

    // Instead of passing a string literal to any of these functions, just use a HTTPHeaderName instead.
    template<size_t length> String get(const char (&)[length]) const = delete;
    template<size_t length> void set(const char (&)[length], const String&) = delete;
    template<size_t length> bool contains(const char (&)[length]) = delete;
    template<size_t length> bool remove(const char (&)[length]) = delete;

    const Vector<String, 0>& getSetCookieHeaders() const { return m_setCookieHeaders; }

    const CommonHeadersVector& commonHeaders() const { return m_commonHeaders; }
    const UncommonHeadersVector& uncommonHeaders() const { return m_uncommonHeaders; }
    CommonHeadersVector& commonHeaders() { return m_commonHeaders; }
    UncommonHeadersVector& uncommonHeaders() { return m_uncommonHeaders; }
    Vector<String, 0>& getSetCookieHeaders() { return m_setCookieHeaders; }

    const_iterator begin() const { return const_iterator(*this, m_commonHeaders.begin(), m_uncommonHeaders.begin(), m_setCookieHeaders.begin()); }
    const_iterator end() const { return const_iterator(*this, m_commonHeaders.end(), m_uncommonHeaders.end(), m_setCookieHeaders.end()); }

    friend bool operator==(const HTTPHeaderMap& a, const HTTPHeaderMap& b)
    {
        if (a.m_commonHeaders.size() != b.m_commonHeaders.size() || a.m_uncommonHeaders.size() != b.m_uncommonHeaders.size() || a.m_setCookieHeaders.size() != b.m_setCookieHeaders.size())
            return false;

        for (auto& commonHeader : a.m_commonHeaders) {
            if (b.get(commonHeader.key) != commonHeader.value.string())
                return false;
        }

        for (auto& uncommonHeader : a.m_setCookieHeaders) {
            if (b.m_setCookieHeaders.find(uncommonHeader) == notFound)
                return false;
        }

        for (auto& uncommonHeader : a.m_uncommonHeaders) {
            if (b.getUncommonHeader(uncommonHeader.key) != uncommonHeader.value.string())
                return false;
        }

        return true;
    }

    friend bool operator!=(const HTTPHeaderMap& a, const HTTPHeaderMap& b)
    {
        return !(a == b);
    }

    void setUncommonHeader(const String& name, const String& value);
    bool addUncommonHeader(const String& name, const String& value);
    bool addUncommonHeaderCloneName(const StringView name, const String& value);

private:
    WEBCORE_EXPORT String getUncommonHeader(const StringView name) const;

    CommonHeadersVector m_commonHeaders;
    UncommonHeadersVector m_uncommonHeaders;
    Vector<String, 0> m_setCookieHeaders;
};

} // namespace WebCore
