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
#include <bit>
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

class HTTPHeaderMap {
public:
    struct CommonHeader {
        HTTPHeaderName key;
        String value;

        bool operator==(const CommonHeader& other) const { return key == other.key && value == other.value; }
    };

    struct UncommonHeader {
        String key;
        String value;

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
            m_keyValue.value = it->value;
            return true;
        }
        bool updateKeyValue(UncommonHeadersVector::const_iterator it)
        {
            if (it == m_table.uncommonHeaders().end())
                return false;
            m_keyValue.key = it->key;
            m_keyValue.keyAsHTTPHeaderName = std::nullopt;
            m_keyValue.value = it->value;
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
    // ValueTooLong: the combined value would pass String::MaxLength, and the stored value stays as it is.
    enum class [[nodiscard]] AddResult : uint8_t {
        Stored,
        ValueTooLong,
    };
    WEBCORE_EXPORT AddResult add(const String& name, const String& value);
    WEBCORE_EXPORT bool contains(const StringView) const;
    WEBCORE_EXPORT int64_t indexOf(StringView name) const;
    WEBCORE_EXPORT bool remove(const StringView);
    WEBCORE_EXPORT bool removeUncommonHeader(const StringView);

    WEBCORE_EXPORT String get(HTTPHeaderName) const;
    // The Set-Cookie values joined by ", ". nullopt when the join would pass String::MaxLength.
    WEBCORE_EXPORT std::optional<String> tryJoinSetCookieHeaders() const;
    void set(HTTPHeaderName, const String& value);
    AddResult add(HTTPHeaderName, const String& value);
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

    // For a map with no entries: no name is compared and no value is joined.
    void appendEntriesOf(const HTTPHeaderMap& other)
    {
        ASSERT(isEmpty());
        m_commonHeaders.appendVector(other.m_commonHeaders);
        m_uncommonHeaders.appendVector(other.m_uncommonHeaders);
        m_setCookieHeaders.appendVector(other.m_setCookieHeaders);
    }

    // A producer that adds a whole list calls this at its end: no value keeps spare room, and the count of joins starts again.
    void settle()
    {
        if (!m_growing.isZero()) [[unlikely]]
            settleSlow();
    }

    const_iterator begin() const { return const_iterator(*this, m_commonHeaders.begin(), m_uncommonHeaders.begin(), m_setCookieHeaders.begin()); }
    const_iterator end() const { return const_iterator(*this, m_commonHeaders.end(), m_uncommonHeaders.end(), m_setCookieHeaders.end()); }

    friend bool operator==(const HTTPHeaderMap& a, const HTTPHeaderMap& b)
    {
        if (a.m_commonHeaders.size() != b.m_commonHeaders.size() || a.m_uncommonHeaders.size() != b.m_uncommonHeaders.size() || a.m_setCookieHeaders.size() != b.m_setCookieHeaders.size())
            return false;

        for (auto& commonHeader : a.m_commonHeaders) {
            if (b.get(commonHeader.key) != commonHeader.value)
                return false;
        }

        for (auto& uncommonHeader : a.m_setCookieHeaders) {
            if (b.m_setCookieHeaders.find(uncommonHeader) == notFound)
                return false;
        }

        for (auto& uncommonHeader : a.m_uncommonHeaders) {
            if (b.getUncommonHeader(uncommonHeader.key) != uncommonHeader.value)
                return false;
        }

        return true;
    }

    friend bool operator!=(const HTTPHeaderMap& a, const HTTPHeaderMap& b)
    {
        return !(a == b);
    }

    void setUncommonHeader(const String& name, const String& value);
    AddResult addUncommonHeader(const String& name, const String& value);
    AddResult addUncommonHeaderCloneName(const StringView name, const String& value);
    WEBCORE_EXPORT String getUncommonHeader(const StringView name) const;

private:
    // A join that gives a value under this length is one exact-fit string.
    static constexpr unsigned growThreshold = 4096;
    // A map makes this many exact-fit joins past growThreshold. After them a value grows in a builder: N joins copy O(N) bytes.
    static constexpr uintptr_t exactFitJoins = 8;

    // One word: the count of exact-fit joins past growThreshold, or the builders of the values that grow. A copy of the map starts at zero.
    class Growing {
    public:
        using Builders = Vector<StringBuilder, 1>;

        Growing() = default;
        Growing(const Growing&)
        {
        }
        Growing(Growing&& other)
            : m_bits { std::exchange(other.m_bits, 0) }
        {
        }
        Growing& operator=(const Growing&)
        {
            reset();
            return *this;
        }
        Growing& operator=(Growing&& other)
        {
            reset();
            m_bits = std::exchange(other.m_bits, 0);
            return *this;
        }
        ~Growing() { reset(); }

        bool isZero() const { return !m_bits; }
        Builders* builders() const { return m_bits > exactFitJoins ? std::bit_cast<Builders*>(m_bits) : nullptr; }
        StringBuilder* builderOf(const String& stored) const;
        bool takeExactFitJoin()
        {
            if (m_bits >= exactFitJoins)
                return false;
            m_bits++;
            return true;
        }
        StringBuilder& startBuilder();
        void forget(const String& stored);
        void reset()
        {
            if (m_bits > exactFitJoins) [[unlikely]]
                deleteBuilders();
            m_bits = 0;
        }

    private:
        void deleteBuilders();

        uintptr_t m_bits { 0 };
    };

    // Every add function joins a repeated name here.
    AddResult combine(String& stored, ASCIILiteral delimiter, const String& value);
    AddResult combineLong(String& stored, ASCIILiteral delimiter, const String& value);
    void replace(String& stored, const String& value);
    void settleSlow();

    CommonHeadersVector m_commonHeaders;
    UncommonHeadersVector m_uncommonHeaders;
    Vector<String, 0> m_setCookieHeaders;
    Growing m_growing;
};

} // namespace WebCore
