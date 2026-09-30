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
extern "C" size_t Bun__stringSyntheticAllocationLimit;

namespace WebCore {
struct Latin1In16Bit {
    std::span<const char16_t> characters;
};
}

namespace WTF {
template<> class StringTypeAdapter<WebCore::Latin1In16Bit> {
public:
    StringTypeAdapter(WebCore::Latin1In16Bit string)
        : m_characters { string.characters }
    {
    }

    unsigned length() const { return m_characters.size(); }
    bool is8Bit() const { return true; }
    template<typename CharacterType> void writeTo(std::span<CharacterType> destination) const
    {
        StringImpl::copyCharacters(destination, m_characters);
    }

private:
    std::span<const char16_t> m_characters;
};
}

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

// Values are Latin-1 (isValidHTTPHeaderValue). The builder stays 8-bit: a 16-bit one can grow to a capacity StringImpl refuses, which aborts.
static void appendLatin1(StringBuilder& builder, ASCIILiteral delimiter, const String& value)
{
    if (!value.is8Bit() && value.containsOnlyLatin1()) [[unlikely]]
        builder.append(delimiter, Latin1In16Bit { value.span16() });
    else
        builder.append(delimiter, value);
}

// String::MaxLength, or the limit that a test lowered through bun:internal-for-testing.
static bool passesStringLimit(uint64_t length)
{
    return length > std::min<uint64_t>(String::MaxLength, Bun__stringSyntheticAllocationLimit);
}

static unsigned grownCapacity(unsigned capacity, unsigned required)
{
    return std::max<uint64_t>(required, std::min<uint64_t>(String::MaxLength, static_cast<uint64_t>(capacity) + capacity / 2));
}

ALWAYS_INLINE HTTPHeaderMap::AddResult HTTPHeaderMap::combine(String& stored, ASCIILiteral delimiter, const String& value)
{
    if (static_cast<uint64_t>(stored.length()) + delimiter.length() + value.length() >= growThreshold) [[unlikely]]
        return combineLong(stored, delimiter, value);

    String combined = tryMakeString(stored, delimiter, value);
    if (combined.isNull()) [[unlikely]]
        return combineLong(stored, delimiter, value);
    stored = WTF::move(combined);
    return AddResult::Stored;
}

NEVER_INLINE HTTPHeaderMap::AddResult HTTPHeaderMap::combineLong(String& stored, ASCIILiteral delimiter, const String& value)
{
    uint64_t combinedLength = static_cast<uint64_t>(stored.length()) + delimiter.length() + value.length();
    if (passesStringLimit(combinedLength)) [[unlikely]]
        return AddResult::ValueTooLong;

    auto* builder = m_growing.builderOf(stored);
    if (!builder) {
        if (m_growing.takeExactFitJoin()) {
            String combined = tryMakeString(stored, delimiter, value);
            if (!combined.isNull()) [[likely]] {
                stored = WTF::move(combined);
                return AddResult::Stored;
            }
        }
        builder = &m_growing.startBuilder();
        builder->reserveCapacity(grownCapacity(stored.length(), combinedLength));
        appendLatin1(*builder, ""_s, stored);
    } else if (combinedLength > builder->capacity()) {
        // Without this reference the builder can be the one owner of its buffer, and then it reallocates in place.
        stored = String();
        builder->reserveCapacity(grownCapacity(builder->capacity(), combinedLength));
    }

    appendLatin1(*builder, delimiter, value);
    stored = builder->toStringPreserveCapacity();
    return AddResult::Stored;
}

// A builder holds a reference to the last String it made, so no other String can have that address while the builder lives.
StringBuilder* HTTPHeaderMap::Growing::builderOf(const String& stored) const
{
    auto* list = builders();
    if (!list)
        return nullptr;
    for (auto& builder : *list) {
        if (builder.toStringPreserveCapacity().impl() == stored.impl())
            return &builder;
    }
    return nullptr;
}

StringBuilder& HTTPHeaderMap::Growing::startBuilder()
{
    if (!builders())
        m_bits = std::bit_cast<uintptr_t>(makeUnique<Builders>().release());
    builders()->append(StringBuilder {});
    return builders()->last();
}

NEVER_INLINE void HTTPHeaderMap::Growing::forget(const String& stored)
{
    auto* list = builders();
    list->removeFirstMatching([&](auto& builder) {
        return builder.toStringPreserveCapacity().impl() == stored.impl();
    });
    if (list->isEmpty()) {
        deleteBuilders();
        m_bits = exactFitJoins;
    }
}

NEVER_INLINE void HTTPHeaderMap::Growing::deleteBuilders()
{
    std::unique_ptr<Builders> list { builders() };
}

ALWAYS_INLINE void HTTPHeaderMap::replace(String& stored, const String& value)
{
    if (m_growing.builders() && stored.impl() != value.impl()) [[unlikely]]
        m_growing.forget(stored);
    stored = value;
}

NEVER_INLINE void HTTPHeaderMap::settleSlow()
{
    if (m_growing.builders()) {
        auto settleValue = [&](String& stored) {
            if (m_growing.builderOf(stored))
                stored = stored.is8Bit() ? String { stored.span8() } : String { stored.span16() };
        };
        for (auto& header : m_commonHeaders)
            settleValue(header.value);
        for (auto& header : m_uncommonHeaders)
            settleValue(header.value);
    }
    m_growing.reset();
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

    if (auto* builders = m_growing.builders()) [[unlikely]] {
        for (auto& builder : *builders)
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

    if (m_growing.builders()) [[unlikely]]
        m_growing.forget(getUncommonHeader(name));

    return m_uncommonHeaders.removeFirstMatching([&](auto& header) {
        return equalIgnoringASCIICase(header.key, name);
    });
}

std::optional<String> HTTPHeaderMap::tryJoinSetCookieHeaders() const
{
    unsigned count = m_setCookieHeaders.size();
    if (!count)
        return String();
    if (count == 1)
        return m_setCookieHeaders[0];

    uint64_t length = 2 * static_cast<uint64_t>(count - 1);
    for (auto& header : m_setCookieHeaders)
        length += header.length();
    if (passesStringLimit(length)) [[unlikely]]
        return std::nullopt;

    StringBuilder builder;
    builder.reserveCapacity(static_cast<unsigned>(length));
    appendLatin1(builder, ""_s, m_setCookieHeaders[0]);
    for (unsigned i = 1; i < count; ++i)
        appendLatin1(builder, ", "_s, m_setCookieHeaders[i]);
    return builder.toString();
}

String HTTPHeaderMap::get(HTTPHeaderName name) const
{
    // A join that no String can hold reads as absent here. FetchHeaders::get() throws for it.
    if (name == HTTPHeaderName::SetCookie)
        return tryJoinSetCookieHeaders().value_or(String());

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

    if (m_growing.builders()) [[unlikely]]
        m_growing.forget(get(name));

    return m_commonHeaders.removeFirstMatching([&](auto& header) {
        return header.key == name;
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
