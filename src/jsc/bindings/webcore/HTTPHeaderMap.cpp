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
#include <wtf/text/MakeString.h>
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
        if (highway_index_of_first_ascii_upper(span.data(), length) == length)
            return name;

        std::span<Latin1Character> data;
        String result = String::createUninitialized(static_cast<unsigned>(length), data);
        highway_lower_ascii(span.data(), length, data.data());
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

HTTPHeaderMap::HTTPHeaderMap()
{
}

// Values are Latin-1 (isValidHTTPHeaderValue). A 16-bit builder can grow to a capacity StringImpl refuses, which aborts.
static String as8Bit(const String& value)
{
    if (value.is8Bit())
        return value;
    return StringImpl::create8BitIfPossible(value.span16());
}

static unsigned grownCapacity(unsigned capacity, unsigned required)
{
    return std::max<uint64_t>(required, std::min<uint64_t>(String::MaxLength, static_cast<uint64_t>(capacity) + capacity / 2));
}

ALWAYS_INLINE HTTPHeaderMap::AddResult HTTPHeaderMap::combine(String& stored, ASCIILiteral delimiter, const String& value)
{
    if (static_cast<uint64_t>(stored.length()) + delimiter.length() + value.length() < growThreshold) [[likely]] {
        stored = makeString(stored, delimiter, value);
        return AddResult::Stored;
    }
    return combineLong(stored, delimiter, value);
}

NEVER_INLINE HTTPHeaderMap::AddResult HTTPHeaderMap::combineLong(String& stored, ASCIILiteral delimiter, const String& value)
{
    uint64_t combinedLength = static_cast<uint64_t>(stored.length()) + delimiter.length() + value.length();
    if (combinedLength > String::MaxLength)
        return AddResult::ValueTooLong;

    String appended = as8Bit(value);
    auto* builder = builderOf(stored);
    if (!builder) {
        // The join that passes the threshold stays exact-fit, so a value that stops there keeps no spare room.
        if (stored.length() < growThreshold) {
            stored = makeString(stored, delimiter, value);
            return AddResult::Stored;
        }
        if (!m_growing.builders)
            m_growing.builders = makeUnique<Vector<StringBuilder, 1>>();
        m_growing.builders->append(StringBuilder {});
        builder = &m_growing.builders->last();
        builder->reserveCapacity(grownCapacity(stored.length(), combinedLength));
        builder->append(as8Bit(stored));
    } else if (combinedLength > builder->capacity()) {
        // Without this reference the builder can be the one owner of its buffer, and then it reallocates in place.
        stored = String();
        builder->reserveCapacity(grownCapacity(builder->capacity(), combinedLength));
    }

    builder->append(delimiter, appended);
    stored = builder->toStringPreserveCapacity();
    return AddResult::Stored;
}

// A builder holds a reference to the last String it made, so no other String can have that address while the builder lives.
StringBuilder* HTTPHeaderMap::builderOf(const String& stored)
{
    if (!m_growing.builders)
        return nullptr;
    for (auto& builder : *m_growing.builders) {
        if (builder.toStringPreserveCapacity().impl() == stored.impl())
            return &builder;
    }
    return nullptr;
}

ALWAYS_INLINE void HTTPHeaderMap::forget(const String& stored)
{
    if (m_growing.builders) [[unlikely]]
        forgetSlow(stored);
}

NEVER_INLINE void HTTPHeaderMap::forgetSlow(const String& stored)
{
    m_growing.builders->removeFirstMatching([&](auto& builder) {
        return builder.toStringPreserveCapacity().impl() == stored.impl();
    });
    if (m_growing.builders->isEmpty())
        m_growing.builders = nullptr;
}

ALWAYS_INLINE void HTTPHeaderMap::replace(String& stored, const String& value)
{
    if (m_growing.builders && stored.impl() != value.impl()) [[unlikely]]
        forgetSlow(stored);
    stored = value;
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

    if (m_growing.builders) [[unlikely]] {
        for (auto& builder : *m_growing.builders)
            cost += sizeof(StringBuilder) + (builder.capacity() - builder.length()) * (builder.is8Bit() ? sizeof(Latin1Character) : sizeof(char16_t));
    }

    return cost;
}

String HTTPHeaderMap::getUncommonHeader(const StringView name) const
{
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    return index != notFound ? m_uncommonHeaders[index].value : String();
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
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    if (index == notFound)
        m_uncommonHeaders.append(UncommonHeader { name, value });
    else
        replace(m_uncommonHeaders[index].value, value);
}

HTTPHeaderMap::AddResult HTTPHeaderMap::addUncommonHeader(const String& name, const String& value)
{
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    if (index == notFound) {
        m_uncommonHeaders.append(UncommonHeader { name, value });
        return AddResult::Stored;
    }
    return combine(m_uncommonHeaders[index].value, ", "_s, value);
}

HTTPHeaderMap::AddResult HTTPHeaderMap::addUncommonHeaderCloneName(const StringView name, const String& value)
{
    auto index = m_uncommonHeaders.findIf([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
    if (index == notFound) {
        std::span<Latin1Character> ptr;
        auto nameCopy = WTF::String::createUninitialized(name.length(), ptr);
        memcpy(ptr.data(), name.span8().data(), name.length());
        m_uncommonHeaders.append(UncommonHeader { nameCopy, value });
        return AddResult::Stored;
    }
    return combine(m_uncommonHeaders[index].value, ", "_s, value);
}

HTTPHeaderMap::AddResult HTTPHeaderMap::add(const String& name, const String& value)
{
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName))
        return add(headerName, value);

    return addUncommonHeader(name, value);
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
        if (!equalIgnoringASCIICase(header.key, name))
            return false;
        forget(header.value);
        return true;
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
        replace(m_commonHeaders[index].value, value);
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
        if (header.key != name)
            return false;
        forget(header.value);
        return true;
    });
}

HTTPHeaderMap::AddResult HTTPHeaderMap::add(HTTPHeaderName name, const String& value)
{
    if (name == HTTPHeaderName::SetCookie) {
        m_setCookieHeaders.append(value);
        return AddResult::Stored;
    }

    auto index = m_commonHeaders.findIf([&](auto& header) {
        return header.key == name;
    });
    if (index == notFound) {
        m_commonHeaders.append(CommonHeader { name, value });
        return AddResult::Stored;
    }
    return combine(m_commonHeaders[index].value, name == HTTPHeaderName::Cookie ? "; "_s : ", "_s, value);
}

} // namespace WebCore
