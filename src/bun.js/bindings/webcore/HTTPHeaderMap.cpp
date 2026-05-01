/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 * Copyright (C) 2022 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "HTTPHeaderMap.h"

#include <utility>
#include <wtf/CrossThreadCopier.h>
#include <wtf/text/StringView.h>

namespace WebCore {

HTTPHeaderMap::HTTPHeaderMap()
{
}

HTTPHeaderMap HTTPHeaderMap::isolatedCopy() const&
{
    HTTPHeaderMap map;
    map.m_commonHeaders = crossThreadCopy(m_commonHeaders);
    map.m_uncommonHeaders = crossThreadCopy(m_uncommonHeaders);
    map.m_setCookieHeaders = crossThreadCopy(m_setCookieHeaders);
    return map;
}

HTTPHeaderMap HTTPHeaderMap::isolatedCopy() &&
{
    HTTPHeaderMap map;
    map.m_commonHeaders = crossThreadCopy(WTF::move(m_commonHeaders));
    map.m_uncommonHeaders = crossThreadCopy(WTF::move(m_uncommonHeaders));
    map.m_setCookieHeaders = crossThreadCopy(WTF::move(m_setCookieHeaders));
    return map;
}

String HTTPHeaderMap::get(const StringView name) const
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName))
        return get(headerName);

    return getUncommonHeader(name);
}

size_t HTTPHeaderMap::memoryCost() const
{
    size_t cost = m_commonHeaders.size() * sizeof(CommonHeader);
    cost += m_uncommonHeaders.size() * sizeof(UncommonHeader);
    cost += m_setCookieHeaders.size() * sizeof(String);
    for (auto& header : m_commonHeaders)
        cost += header.value.sizeInBytes();

    for (auto& header : m_uncommonHeaders) {
        cost += header.key.sizeInBytes();
        cost += header.value.sizeInBytes();
    }

    for (auto& header : m_setCookieHeaders)
        cost += header.sizeInBytes();

    return cost;
}

String HTTPHeaderMap::getUncommonHeader(const StringView name) const
{
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    return index != notFound ? m_uncommonHeaders[index].value : String();
}

#if USE(CF)

void HTTPHeaderMap::set(CFStringRef name, const String& value)
{
    // Fast path: avoid constructing a temporary String in the common header case.
    if (auto* nameCharacters = CFStringGetCStringPtr(name, kCFStringEncodingASCII)) {
        unsigned length = CFStringGetLength(name);
        HTTPHeaderName headerName;
        if (findHTTPHeaderName(StringView(nameCharacters, length), headerName))
            set(headerName, value);
        else
            setUncommonHeader(String(nameCharacters, length), value);

        return;
    }

    set(String(name), value);
}

#endif // USE(CF)

void HTTPHeaderMap::set(const String& name, const String& value)
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        set(headerName, value);
        return;
    }

    setUncommonHeader(name, value);
}

void HTTPHeaderMap::setUncommonHeader(const String& name, const String& value)
{
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    if (index == notFound)
        m_uncommonHeaders.append(UncommonHeader { name, value });
    else
        m_uncommonHeaders[index].value = value;
}

void HTTPHeaderMap::setUncommonHeaderCloneName(const StringView name, const String& value)
{
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    if (index == notFound) {
        std::span<Latin1Character> ptr;
        auto nameCopy = WTF::String::createUninitialized(name.length(), ptr);
        memcpy(ptr.data(), name.span8().data(), name.length());
        m_uncommonHeaders.append(UncommonHeader { nameCopy, value });
    } else
        m_uncommonHeaders[index].value = value;
}

void HTTPHeaderMap::add(const String& name, const String& value)
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        add(headerName, value);
        return;
    }
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    if (index == notFound)
        m_uncommonHeaders.append(UncommonHeader { name, value });
    else
        m_uncommonHeaders[index].value = makeString(m_uncommonHeaders[index].value, ", "_s, value);
}

void HTTPHeaderMap::append(const String& name, const String& value)
{
    ASSERT(!contains(name));

    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        if (headerName == HTTPHeaderName::SetCookie)
            m_setCookieHeaders.append(value);
        else
            m_commonHeaders.append(CommonHeader { headerName, value });
    } else {
        m_uncommonHeaders.append(UncommonHeader { name, value });
    }
}

bool HTTPHeaderMap::addIfNotPresent(HTTPHeaderName headerName, const String& value)
{
    if (contains(headerName))
        return false;

    m_commonHeaders.append(CommonHeader { headerName, value });
    return true;
}

bool HTTPHeaderMap::contains(const StringView name) const
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName))
        return contains(headerName);

    return m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    }) != notFound;
}

bool HTTPHeaderMap::remove(const StringView name)
{

    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName))
        return remove(headerName);

    return removeUncommonHeader(name);
}

bool HTTPHeaderMap::removeUncommonHeader(const StringView name)
{
#if ASSERT_ENABLED
    HTTPHeaderName headerName;
    ASSERT(!findHTTPHeaderName(name, headerName));
#endif

    return m_uncommonHeaders.removeFirstMatching([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
}

String HTTPHeaderMap::get(HTTPHeaderName name) const
{
    if (name == HTTPHeaderName::SetCookie) {
        unsigned count = m_setCookieHeaders.size();
        switch (count) {
        case 0:
            return String();
        case 1:
            return m_setCookieHeaders[0];
        default: {
            StringBuilder builder;
            builder.reserveCapacity(m_setCookieHeaders[0].length() * count + (count - 1));
            builder.append(m_setCookieHeaders[0]);
            for (unsigned i = 1; i < count; ++i) {
                builder.append(", "_s);
                builder.append(m_setCookieHeaders[i]);
            }
            return builder.toString();
        }
        }
    }

    auto index = m_commonHeaders.findIf([&](auto& header) {
        return header.key == name;
    });
    return index != notFound ? m_commonHeaders[index].value : String();
}

HTTPHeaderMap::HeaderIndex HTTPHeaderMap::indexOf(HTTPHeaderName name) const
{
    auto index = m_commonHeaders.findIf([&](auto& header) {
        return header.key == name;
    });
    return (HeaderIndex) { .index = index, .isCommon = true };
}

HTTPHeaderMap::HeaderIndex HTTPHeaderMap::indexOf(const String& name) const
{
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    return (HeaderIndex) { .index = index, .isCommon = false };
}

String HTTPHeaderMap::getIndex(HTTPHeaderMap::HeaderIndex index) const
{
    if (index.index == notFound)
        return String();
    if (index.isCommon)
        return m_commonHeaders[index.index].value;
    return m_uncommonHeaders[index.index].value;
}
void HTTPHeaderMap::set(HTTPHeaderName name, const String& value)
{
    if (name == HTTPHeaderName::SetCookie) {
        m_setCookieHeaders.clear();
        m_setCookieHeaders.append(value);
        return;
    }

    auto index = m_commonHeaders.findIf([&](auto& header) {
        return header.key == name;
    });
    if (index == notFound)
        m_commonHeaders.append(CommonHeader { name, value });
    else
        m_commonHeaders[index].value = value;
}

bool HTTPHeaderMap::setIndex(HTTPHeaderMap::HeaderIndex index, const String& value)
{
    if (!index.isValid())
        return false;

    if (index.isCommon) {
        m_commonHeaders[index.index].value = value;
    } else {
        m_uncommonHeaders[index.index].value = value;
    }
    return true;
}

bool HTTPHeaderMap::contains(HTTPHeaderName name) const
{
    if (name == HTTPHeaderName::SetCookie)
        return !m_setCookieHeaders.isEmpty();

    return m_commonHeaders.findIf([&](auto& header) {
        return header.key == name;
    }) != notFound;
}

bool HTTPHeaderMap::remove(HTTPHeaderName name)
{
    if (name == HTTPHeaderName::SetCookie) {
        bool any = m_setCookieHeaders.size() > 0;
        m_setCookieHeaders.clear();
        return any;
    }

    return m_commonHeaders.removeFirstMatching([&](auto& header) {
        return header.key == name;
    });
}

void HTTPHeaderMap::add(HTTPHeaderName name, const String& value)
{
    if (name == HTTPHeaderName::SetCookie) {
        m_setCookieHeaders.append(value);
        return;
    }

    auto index = m_commonHeaders.findIf([&](auto& header) {
        return header.key == name;
    });
    if (index != notFound)
        m_commonHeaders[index].value = makeString(m_commonHeaders[index].value, name == HTTPHeaderName::Cookie ? "; "_s : ", "_s, value);
    else
        m_commonHeaders.append(CommonHeader { name, value });
}

} // namespace WebCore
