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
#include <wtf/text/WTFString.h>

namespace WebCore {

// FIXME: Not every header fits into a map. Notably, multiple Set-Cookie header fields are needed to set multiple cookies.

class HTTPHeaderMap {
public:
    struct CommonHeader {
        HTTPHeaderName key;
        String value;

        CommonHeader isolatedCopy() const & { return { key, value.isolatedCopy() }; }
        CommonHeader isolatedCopy() && { return { key, WTF::move(value).isolatedCopy() }; }
        template<class Encoder> void encode(Encoder &) const;
        template<class Decoder> static std::optional<CommonHeader> decode(Decoder &);

        bool operator==(const CommonHeader &other) const { return key == other.key && value == other.value; }
    };

    struct HeaderIndex {
        size_t index;
        bool isCommon;

        bool isValid() const { return index != notFound; }
    };

    struct UncommonHeader {
        String key;
        String value;

        UncommonHeader isolatedCopy() const & { return { key.isolatedCopy(), value.isolatedCopy() }; }
        UncommonHeader isolatedCopy() && { return { WTF::move(key).isolatedCopy(), WTF::move(value).isolatedCopy() }; }
        template<class Encoder> void encode(Encoder &) const;
        template<class Decoder> static std::optional<UncommonHeader> decode(Decoder &);

        bool operator==(const UncommonHeader &other) const { return key == other.key && value == other.value; }
    };

    typedef Vector<CommonHeader, 0, CrashOnOverflow, 6> CommonHeadersVector;
    typedef Vector<UncommonHeader, 0, CrashOnOverflow, 0> UncommonHeadersVector;

    class HTTPHeaderMapConstIterator {
    public:
        HTTPHeaderMapConstIterator(const HTTPHeaderMap &table, CommonHeadersVector::const_iterator commonHeadersIt, UncommonHeadersVector::const_iterator uncommonHeadersIt, Vector<String, 0>::const_iterator setCookiesIter)
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

                return key.convertToASCIILowercase();
            }
        };

        const KeyValue *get() const
        {
            ASSERT(*this != m_table.end());
            return &m_keyValue;
        }
        const KeyValue &operator*() const { return *get(); }
        const KeyValue *operator->() const { return get(); }

        HTTPHeaderMapConstIterator &operator++()
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

        bool operator!=(const HTTPHeaderMapConstIterator &other) const { return !(*this == other); }
        bool operator==(const HTTPHeaderMapConstIterator &other) const
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

        const HTTPHeaderMap &m_table;
        CommonHeadersVector::const_iterator m_commonHeadersIt;
        UncommonHeadersVector::const_iterator m_uncommonHeadersIt;
        KeyValue m_keyValue;
    };
    typedef HTTPHeaderMapConstIterator const_iterator;

    WEBCORE_EXPORT HTTPHeaderMap();

    // Gets a copy of the data suitable for passing to another thread.
    WEBCORE_EXPORT HTTPHeaderMap isolatedCopy() const &;
    WEBCORE_EXPORT HTTPHeaderMap isolatedCopy() &&;

    bool isEmpty() const { return m_commonHeaders.isEmpty() && m_uncommonHeaders.isEmpty() && m_setCookieHeaders.isEmpty(); }
    int size() const { return m_commonHeaders.size() + m_uncommonHeaders.size() + m_setCookieHeaders.size(); }

    void clear()
    {
        m_commonHeaders.clear();
        m_uncommonHeaders.clear();
    }

    void shrinkToFit()
    {
        m_commonHeaders.shrinkToFit();
        m_uncommonHeaders.shrinkToFit();
    }

    WEBCORE_EXPORT String get(const StringView name) const;
    WEBCORE_EXPORT void set(const String &name, const String &value);
    WEBCORE_EXPORT void add(const String &name, const String &value);
    WEBCORE_EXPORT void append(const String &name, const String &value);
    WEBCORE_EXPORT bool contains(const StringView) const;
    WEBCORE_EXPORT int64_t indexOf(StringView name) const;
    WEBCORE_EXPORT bool remove(const StringView);
    WEBCORE_EXPORT bool removeUncommonHeader(const StringView);

    WEBCORE_EXPORT String getIndex(HeaderIndex index) const;
    WEBCORE_EXPORT bool setIndex(HeaderIndex index, const String &value);
    HeaderIndex indexOf(const String &name) const;
    HeaderIndex indexOf(HTTPHeaderName name) const;

#if USE(CF)
    void set(CFStringRef name, const String &value);
#ifdef __OBJC__
    void set(NSString *name, const String &value)
    {
        set((__bridge CFStringRef)name, value);
    }
#endif
#endif

    WEBCORE_EXPORT String get(HTTPHeaderName) const;
    void set(HTTPHeaderName, const String &value);
    void add(HTTPHeaderName, const String &value);
    bool addIfNotPresent(HTTPHeaderName, const String &);
    WEBCORE_EXPORT bool contains(HTTPHeaderName) const;
    WEBCORE_EXPORT bool remove(HTTPHeaderName);

    size_t memoryCost() const;

    // Instead of passing a string literal to any of these functions, just use a HTTPHeaderName instead.
    template<size_t length> String get(const char (&)[length]) const = delete;
    template<size_t length> void set(const char (&)[length], const String &) = delete;
    template<size_t length> bool contains(const char (&)[length]) = delete;
    template<size_t length> bool remove(const char (&)[length]) = delete;

    const Vector<String, 0> &getSetCookieHeaders() const { return m_setCookieHeaders; }

    const CommonHeadersVector &commonHeaders() const { return m_commonHeaders; }
    const UncommonHeadersVector &uncommonHeaders() const { return m_uncommonHeaders; }
    CommonHeadersVector &commonHeaders() { return m_commonHeaders; }
    UncommonHeadersVector &uncommonHeaders() { return m_uncommonHeaders; }
    Vector<String, 0> &getSetCookieHeaders() { return m_setCookieHeaders; }

    const_iterator begin() const { return const_iterator(*this, m_commonHeaders.begin(), m_uncommonHeaders.begin(), m_setCookieHeaders.begin()); }
    const_iterator end() const { return const_iterator(*this, m_commonHeaders.end(), m_uncommonHeaders.end(), m_setCookieHeaders.end()); }

    friend bool operator==(const HTTPHeaderMap &a, const HTTPHeaderMap &b)
    {
        if (a.m_commonHeaders.size() != b.m_commonHeaders.size() || a.m_uncommonHeaders.size() != b.m_uncommonHeaders.size() || a.m_setCookieHeaders.size() != b.m_setCookieHeaders.size())
            return false;

        for (auto &commonHeader : a.m_commonHeaders) {
            if (b.get(commonHeader.key) != commonHeader.value)
                return false;
        }

        for (auto &uncommonHeader : a.m_setCookieHeaders) {
            if (b.m_setCookieHeaders.find(uncommonHeader) == notFound)
                return false;
        }

        for (auto &uncommonHeader : a.m_uncommonHeaders) {
            if (b.getUncommonHeader(uncommonHeader.key) != uncommonHeader.value)
                return false;
        }

        return true;
    }

    friend bool operator!=(const HTTPHeaderMap &a, const HTTPHeaderMap &b)
    {
        return !(a == b);
    }

    template<class Encoder> void encode(Encoder &) const;
    template<class Decoder> [[nodiscard]] static bool decode(Decoder &, HTTPHeaderMap &);
    void setUncommonHeader(const String &name, const String &value);
    void setUncommonHeaderCloneName(const StringView name, const String &value);

private:
    WEBCORE_EXPORT String getUncommonHeader(const StringView name) const;

    CommonHeadersVector m_commonHeaders;
    UncommonHeadersVector m_uncommonHeaders;
    Vector<String, 0> m_setCookieHeaders;
};

template<class Encoder>
void HTTPHeaderMap::CommonHeader::encode(Encoder &encoder) const
{
    encoder << key;
    encoder << value;
}

template<class Decoder>
auto HTTPHeaderMap::CommonHeader::decode(Decoder &decoder) -> std::optional<CommonHeader>
{
    HTTPHeaderName name;
    if (!decoder.decode(name))
        return std::nullopt;
    String value;
    if (!decoder.decode(value))
        return std::nullopt;

    return CommonHeader { name, WTF::move(value) };
}

template<class Encoder>
void HTTPHeaderMap::UncommonHeader::encode(Encoder &encoder) const
{
    encoder << key;
    encoder << value;
}

template<class Decoder>
auto HTTPHeaderMap::UncommonHeader::decode(Decoder &decoder) -> std::optional<UncommonHeader>
{
    String name;
    if (!decoder.decode(name))
        return std::nullopt;
    String value;
    if (!decoder.decode(value))
        return std::nullopt;

    return UncommonHeader { WTF::move(name), WTF::move(value) };
}

template<class Encoder>
void HTTPHeaderMap::encode(Encoder &encoder) const
{
    encoder << m_commonHeaders;
    encoder << m_uncommonHeaders;
}

template<class Decoder>
bool HTTPHeaderMap::decode(Decoder &decoder, HTTPHeaderMap &headerMap)
{
    if (!decoder.decode(headerMap.m_commonHeaders))
        return false;

    if (!decoder.decode(headerMap.m_uncommonHeaders))
        return false;

    return true;
}

} // namespace WebCore
