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

#include "StringSizeLimit.h"
#include "VectorSizeLimit.h"
#include <utility>
#include <wtf/text/StringView.h>

extern "C" size_t highway_index_of_first_ascii_upper(const uint8_t* input, size_t len);
extern "C" void highway_lower_ascii(const uint8_t* src, size_t len, uint8_t* dst);
extern "C" size_t highway_index_of_first_ascii_upper16(const uint16_t* input, size_t len);
extern "C" void highway_lower_ascii16(const uint16_t* src, size_t len, uint16_t* dst);

namespace WebCore {

String lowercaseHeaderName(const String& name)
{
    if (name.isEmpty())
        return name;

    // ASCII-only names may be stored as either 8-bit or 16-bit; handle both.
    // In each case scan for the first uppercase letter and, only if one exists,
    // allocate a same-width copy and lowercase it (matching
    // StringImpl::convertToASCIILowercase, which returns a 16-bit result for a
    // 16-bit input).
    if (name.is8Bit()) {
        auto span = name.span8();
        size_t length = span.size();
        if (highway_index_of_first_ascii_upper(byteCast<uint8_t>(span.data()), length) == length)
            return name;

        std::span<Latin1Character> data;
        String result = String::createUninitialized(static_cast<unsigned>(length), data);
        highway_lower_ascii(byteCast<uint8_t>(span.data()), length, byteCast<uint8_t>(data.data()));
        return result;
    }

    auto span = name.span16();
    size_t length = span.size();
    if (highway_index_of_first_ascii_upper16(reinterpret_cast<const uint16_t*>(span.data()), length) == length)
        return name;

    std::span<char16_t> data;
    String result = String::createUninitialized(static_cast<unsigned>(length), data);
    highway_lower_ascii16(reinterpret_cast<const uint16_t*>(span.data()), length, reinterpret_cast<uint16_t*>(data.data()));
    return result;
}

#if !ASSERT_ENABLED
static_assert(sizeof(HTTPHeaderMap) == 80, "every Headers object holds one of these");
#endif

HTTPHeaderMap::UncommonHeaderStore::Index& HTTPHeaderMap::UncommonHeaderStore::index() const
{
    if (m_index.isEmpty()) {
        m_index.reserveInitialCapacity(m_slots.size());
        for (unsigned i = 0; i < m_slots.size(); ++i)
            m_index.add(m_slots[i].key, i);
    }
    return m_index;
}

const String* HTTPHeaderMap::UncommonHeaderStore::findInIndex(StringView name) const
{
    auto& index = this->index();
    auto it = index.find<ASCIICaseInsensitiveStringViewHashTranslator>(name);
    return it == index.end() ? nullptr : &m_slots[it->value].value;
}

void HTTPHeaderMap::UncommonHeaderStore::indexLastSlot()
{
    if (!m_index.isEmpty())
        m_index.add(m_slots.last().key, m_slots.size() - 1);
}

void HTTPHeaderMap::UncommonHeaderStore::removeHoles(unsigned names)
{
    if (m_slots.size() == names)
        return;
    decltype(m_slots) headers;
    headers.reserveInitialCapacity(names);
    for (auto& slot : m_slots) {
        if (!slot.key.isNull())
            headers.append(WTF::move(slot));
    }
    m_slots = WTF::move(headers);
}

bool HTTPHeaderMap::UncommonHeaderStore::removeInIndex(StringView name)
{
    auto& index = this->index();
    auto it = index.find<ASCIICaseInsensitiveStringViewHashTranslator>(name);
    if (it == index.end())
        return false;
    // A hole keeps the names behind it at the positions that the index has for them.
    m_slots[it->value] = {};
    index.remove(it);

    // With more holes than names, one pass takes the holes out. The names move, so the index starts again.
    unsigned names = index.size();
    if (m_slots.size() - names > names) {
        removeHoles(names);
        index.clear();
    }
    return true;
}

size_t HTTPHeaderMap::UncommonHeaderStore::memoryCost() const
{
    size_t cost = m_slots.size() * sizeof(UncommonHeader) + m_index.capacity() * sizeof(KeyValuePair<String, unsigned>);
    for (auto& header : *this) {
        cost += header.key.sizeInBytes();
        cost += header.value.sizeInBytes();
    }
    return cost;
}

bool HTTPHeaderMap::SetCookieHeaders::tryAppend(const String& value)
{
    return Bun::tryAppendWithinLimit(values(), value);
}

HTTPHeaderMap::HTTPHeaderMap()
{
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
    cost += m_uncommonHeaders.memoryCost();
    cost += m_setCookieHeaders.size() * sizeof(String);
    for (auto& header : m_commonHeaders)
        cost += header.value.sizeInBytes();

    for (auto& header : m_setCookieHeaders.span())
        cost += header.sizeInBytes();

    return cost;
}

String HTTPHeaderMap::getUncommonHeader(const StringView name) const
{
    auto* stored = m_uncommonHeaders.find(name);
    return stored ? *stored : String();
}

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
    if (auto* stored = m_uncommonHeaders.find(name))
        *stored = value;
    else
        m_uncommonHeaders.append(name, value);
}

void HTTPHeaderMap::addUncommonHeaderCloneName(const StringView name, const String& value)
{
    if (auto* stored = m_uncommonHeaders.find(name))
        *stored = makeString(*stored, ", "_s, value);
    else
        m_uncommonHeaders.append(name.toString(), value);
}

void HTTPHeaderMap::add(const String& name, const String& value)
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        add(headerName, value);
        return;
    }
    if (auto* stored = m_uncommonHeaders.find(name))
        *stored = makeString(*stored, ", "_s, value);
    else
        m_uncommonHeaders.append(name, value);
}

bool HTTPHeaderMap::contains(const StringView name) const
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName))
        return contains(headerName);

    return !!m_uncommonHeaders.find(name);
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

    return m_uncommonHeaders.remove(name);
}

std::optional<String> HTTPHeaderMap::tryJoinSetCookieHeaders() const
{
    auto cookies = m_setCookieHeaders.span();
    size_t count = cookies.size();
    switch (count) {
    case 0:
        return String();
    case 1:
        return cookies[0];
    default:
        break;
    }

    uint64_t length = 2 * static_cast<uint64_t>(count - 1);
    for (const auto& header : cookies)
        length += header.length();
    if (Bun::exceedsStringLimit(length)) [[unlikely]]
        return std::nullopt;

    StringBuilder builder { OverflowPolicy::RecordOverflow };
    builder.reserveCapacity(static_cast<unsigned>(length));
    builder.append(cookies[0]);
    for (size_t i = 1; i < count; ++i) {
        builder.append(", "_s);
        builder.append(cookies[i]);
    }
    if (builder.hasOverflowed()) [[unlikely]]
        return std::nullopt;
    return builder.toString();
}

String HTTPHeaderMap::get(HTTPHeaderName name) const
{
    // If the joined value exceeds the max string length, treat the header as absent. FetchHeaders::get() throws instead.
    if (name == HTTPHeaderName::SetCookie)
        return tryJoinSetCookieHeaders().value_or(String());

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
    return (HeaderIndex) { .index = index };
}

String HTTPHeaderMap::getIndex(HTTPHeaderMap::HeaderIndex index) const
{
    if (index.index == notFound)
        return String();
    return m_commonHeaders[index.index].value;
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

    m_commonHeaders[index.index].value = value;
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

bool HTTPHeaderMap::tryAddSetCookie(const String& value)
{
    return m_setCookieHeaders.tryAppend(value);
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
