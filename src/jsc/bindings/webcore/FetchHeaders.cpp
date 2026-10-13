/*
 * Copyright (C) 2016 Canon Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted, provided that the following conditions
 * are required to be met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Canon Inc. nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY CANON INC. AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL CANON INC. AND ITS CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "FetchHeaders.h"
#include "HTTPHeaderNames.h"

#include "HTTPParsers.h"
#include "wtf/DebugHeap.h"
#include <algorithm>
#include <array>

namespace WebCore {

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(FetchHeaders);

// https://fetch.spec.whatwg.org/#concept-headers-remove-privileged-no-cors-request-headers
static void removePrivilegedNoCORSRequestHeaders(HTTPHeaderMap& headers)
{
    headers.remove(HTTPHeaderName::Range);
}

// String::trim takes a function pointer and dispatches through
// StringImpl::trimMatchedCharacters, which is an indirect call per probed
// character. Header values are almost always already free of leading/trailing
// HTTP whitespace, so do a cheap inline check on the first/last code unit and
// only fall back to the real trim when something actually needs stripping.
static inline String trimHTTPSpaceIfNeeded(const String& value)
{
    if (value.isEmpty() || (!isHTTPSpace(value[0]) && !isHTTPSpace(value[value.length() - 1])))
        return value;
    return value.trim(isHTTPSpace);
}

// Like trimHTTPSpaceIfNeeded, but avoids the ref-count round-trip on the
// returned String in the common no-trim case by aliasing the input. When a trim
// is actually needed, the trimmed result is parked in `storage` (which must
// outlive the returned reference) and a reference to it is returned.
static inline const String& trimHTTPSpaceIfNeeded(const String& value, String& storage)
{
    if (value.isEmpty() || (!isHTTPSpace(value[0]) && !isHTTPSpace(value[value.length() - 1])))
        return value;
    storage = value.trim(isHTTPSpace);
    return storage;
}

static ExceptionOr<bool> canWriteHeader(const HTTPHeaderName name, const String& value, const String& combinedValue, FetchHeaders::Guard guard)
{
    ASSERT(value.isEmpty() || (!isHTTPSpace(value[0]) && !isHTTPSpace(value[value.length() - 1])));
    if (!isValidHTTPHeaderValue((value)))
        return Exception { TypeError, makeString("Header '"_s, httpHeaderNameString(name), "' has invalid value"_s) };
    if (guard == FetchHeaders::Guard::Immutable)
        return Exception { TypeError, "Headers object's guard is 'immutable'"_s };
    return true;
}

static ExceptionOr<bool> canWriteHeader(const String& name, const String& value, const String& combinedValue, FetchHeaders::Guard guard)
{
    if (!isValidHTTPToken(name))
        return Exception { TypeError, makeString("Invalid header name: '"_s, name, "'"_s) };
    ASSERT(value.isEmpty() || (!isHTTPSpace(value[0]) && !isHTTPSpace(value[value.length() - 1])));
    if (!isValidHTTPHeaderValue((value)))
        return Exception { TypeError, makeString("Header '"_s, name, "' has invalid value"_s) };
    if (guard == FetchHeaders::Guard::Immutable)
        return Exception { TypeError, "Headers object's guard is 'immutable'"_s };
    return true;
}

static ExceptionOr<void> appendToHeaderMap(const String& name, const String& value, HTTPHeaderMap& headers, FetchHeaders::Guard guard)
{
    // The common path here is a brand-new header with no leading/trailing HTTP
    // whitespace. Avoid taking ownership (and the atomic ref-count round-trip
    // that comes with it) of the value String unless we actually have to trim
    // or merge with an existing header.
    String trimStorage;
    const String& normalizedValue = trimHTTPSpaceIfNeeded(value, trimStorage);
    String combinedTemp;
    const String* valueToSet = &normalizedValue;
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        auto index = headers.indexOf(headerName);

        if (headerName != HTTPHeaderName::SetCookie) {
            if (index.isValid()) {
                auto existing = headers.getIndex(index);
                if (headerName == HTTPHeaderName::Cookie) {
                    combinedTemp = makeString(existing, "; "_s, normalizedValue);
                } else {
                    combinedTemp = makeString(existing, ", "_s, normalizedValue);
                }
                valueToSet = &combinedTemp;
            }
        }

        auto canWriteResult = canWriteHeader(headerName, normalizedValue, *valueToSet, guard);

        if (canWriteResult.hasException())
            return canWriteResult.releaseException();
        if (!canWriteResult.releaseReturnValue())
            return {};

        if (headerName != HTTPHeaderName::SetCookie) {
            if (!headers.setIndex(index, *valueToSet))
                headers.set(headerName, *valueToSet);
        } else {
            headers.add(headerName, normalizedValue);
        }

        return {};
    }
    auto index = headers.indexOf(name);
    if (index.isValid()) {
        combinedTemp = makeString(headers.getIndex(index), ", "_s, normalizedValue);
        valueToSet = &combinedTemp;
    }
    auto canWriteResult = canWriteHeader(name, normalizedValue, *valueToSet, guard);
    if (canWriteResult.hasException())
        return canWriteResult.releaseException();
    if (!canWriteResult.releaseReturnValue())
        return {};

    if (!headers.setIndex(index, *valueToSet))
        headers.set(name, *valueToSet);

    // if (guard == FetchHeaders::Guard::RequestNoCors)
    //     removePrivilegedNoCORSRequestHeaders(headers);

    return {};
}

static ExceptionOr<void> appendToHeaderMap(const HTTPHeaderMap::HTTPHeaderMapConstIterator::KeyValue& header, HTTPHeaderMap& headers, FetchHeaders::Guard guard)
{
    String trimStorage;
    const String& normalizedValue = trimHTTPSpaceIfNeeded(header.value, trimStorage);
    auto canWriteResult = canWriteHeader(header.key, normalizedValue, header.value, guard);
    if (canWriteResult.hasException())
        return canWriteResult.releaseException();
    if (!canWriteResult.releaseReturnValue())
        return {};
    if (header.keyAsHTTPHeaderName)
        headers.add(header.keyAsHTTPHeaderName.value(), header.value);
    else
        headers.add(header.key, header.value);

    return {};
}

// https://fetch.spec.whatwg.org/#concept-headers-fill
static ExceptionOr<void> fillHeaderMap(HTTPHeaderMap& headers, const FetchHeaders::Init& headersInit, FetchHeaders::Guard guard)
{
    if (std::holds_alternative<Vector<Vector<String>>>(headersInit)) {
        auto& sequence = std::get<Vector<Vector<String>>>(headersInit);
        for (auto& header : sequence) {
            if (header.size() != 2)
                return Exception { TypeError, "Header sub-sequence must contain exactly two items"_s };
            auto result = appendToHeaderMap(header[0], header[1], headers, guard);
            if (result.hasException())
                return result.releaseException();
        }
    } else {
        auto& record = std::get<Vector<KeyValuePair<String, String>>>(headersInit);
        for (auto& header : record) {
            auto result = appendToHeaderMap(header.key, header.value, headers, guard);
            if (result.hasException())
                return result.releaseException();
        }
    }

    return {};
}

ExceptionOr<Ref<FetchHeaders>> FetchHeaders::create(std::optional<Init>&& headersInit)
{
    HTTPHeaderMap headers;

    if (headersInit) {
        auto result = fillHeaderMap(headers, *headersInit, Guard::None);
        if (result.hasException())
            return result.releaseException();
    }

    return adoptRef(*new FetchHeaders { Guard::None, WTF::move(headers) });
}

ExceptionOr<void> FetchHeaders::fill(const Init& headerInit)
{
    ++m_updateCounter;
    return fillHeaderMap(m_headers, headerInit, m_guard);
}

ExceptionOr<void> FetchHeaders::fill(const FetchHeaders& otherHeaders)
{
    if (this->size() == 0) {
        HTTPHeaderMap headers;
        headers.commonHeaders().appendVector(otherHeaders.m_headers.commonHeaders());
        headers.uncommonHeaders().appendVector(otherHeaders.m_headers.uncommonHeaders());
        headers.getSetCookieHeaders().appendVector(otherHeaders.m_headers.getSetCookieHeaders());
        setInternalHeaders(WTF::move(headers));
        return {};
    }

    ++m_updateCounter;
    for (auto& header : otherHeaders.m_headers) {
        auto result = appendToHeaderMap(header, m_headers, m_guard);
        if (result.hasException())
            return result.releaseException();
    }

    return {};
}

ExceptionOr<void> FetchHeaders::append(const String& name, const String& value)
{
    ++m_updateCounter;
    return appendToHeaderMap(name, value, m_headers, m_guard);
}

// https://fetch.spec.whatwg.org/#dom-headers-delete
ExceptionOr<void> FetchHeaders::remove(const StringView name)
{
    ASSERT_WITH_MESSAGE(m_guard == FetchHeaders::Guard::None, "We don't use guards in Bun");

    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        ++m_updateCounter;
        m_headers.remove(headerName);
        return {};
    }

    if (!isValidHTTPToken(name))
        return Exception { TypeError, makeString("Invalid header name: '"_s, name, "'"_s) };

    ++m_updateCounter;
    m_headers.removeUncommonHeader(name);

    return {};
}

size_t FetchHeaders::memoryCost() const
{
    return m_headers.memoryCost() + sizeof(*this);
}

ExceptionOr<String> FetchHeaders::get(const StringView name) const
{
    auto result = m_headers.get(name);
    if (result.isEmpty()) {
        if (!isValidHTTPToken(name))
            return Exception { TypeError, makeString("Invalid header name: '"_s, name, "'"_s) };
    }

    return result;
}

ExceptionOr<bool> FetchHeaders::has(const StringView name) const
{
    bool has = m_headers.contains(name);
    if (!has) {
        if (!isValidHTTPToken(name))
            return Exception { TypeError, makeString("Invalid header name: '"_s, name, '"') };
    }
    return has;
}

ExceptionOr<void> FetchHeaders::set(const HTTPHeaderName name, const String& value)
{
    String normalizedValue = trimHTTPSpaceIfNeeded(value);
    auto canWriteResult = canWriteHeader(name, normalizedValue, normalizedValue, m_guard);
    if (canWriteResult.hasException())
        return canWriteResult.releaseException();
    if (!canWriteResult.releaseReturnValue())
        return {};

    ++m_updateCounter;
    m_headers.set(name, normalizedValue);

    if (m_guard == FetchHeaders::Guard::RequestNoCors)
        removePrivilegedNoCORSRequestHeaders(m_headers);

    return {};
}

ExceptionOr<void> FetchHeaders::set(const String& name, const String& value)
{
    String normalizedValue = trimHTTPSpaceIfNeeded(value);
    auto canWriteResult = canWriteHeader(name, normalizedValue, normalizedValue, m_guard);
    if (canWriteResult.hasException())
        return canWriteResult.releaseException();
    if (!canWriteResult.releaseReturnValue())
        return {};

    ++m_updateCounter;
    m_headers.set(name, normalizedValue);

    if (m_guard == FetchHeaders::Guard::RequestNoCors)
        removePrivilegedNoCORSRequestHeaders(m_headers);

    return {};
}

// Where each known name stands among the known names when they are sorted in lowercase.
static const std::array<uint8_t, numHTTPHeaderNames>& lowercaseHeaderNameRanks()
{
    static const std::array<uint8_t, numHTTPHeaderNames> ranks = [] {
        std::array<uint8_t, numHTTPHeaderNames> sorted;
        for (unsigned i = 0; i < numHTTPHeaderNames; ++i)
            sorted[i] = i;
        std::sort(sorted.begin(), sorted.end(), [](uint8_t a, uint8_t b) {
            return WTF::codePointCompareLessThan(WTF::httpHeaderNameStringImpl(static_cast<HTTPHeaderName>(a)), WTF::httpHeaderNameStringImpl(static_cast<HTTPHeaderName>(b)));
        });
        std::array<uint8_t, numHTTPHeaderNames> result;
        for (unsigned i = 0; i < numHTTPHeaderNames; ++i)
            result[sorted[i]] = i;
        return result;
    }();
    return ranks;
}

void FetchHeaders::Iterator::collectEntries()
{
    auto& map = m_headers->m_headers;
    bool hasSetCookie = !map.getSetCookieHeaders().isEmpty();
    m_entries.shrink(0);
    m_entries.reserveCapacity(map.commonHeaders().size() + map.uncommonHeaders().size() + (hasSetCookie ? 1 : 0));
    m_lowercasedKeys.shrink(0);

    if (m_lowerCaseKeys) {
        for (auto& header : map.commonHeaders())
            m_entries.unsafeAppendWithoutCapacityCheck(Entry { &WTF::httpHeaderNameStringImpl(header.key), &header.value, header.key });
        for (auto& header : map.uncommonHeaders()) {
            String lowercased = lowercaseHeaderName(header.key);
            const String* key = &header.key;
            if (lowercased.impl() != header.key.impl()) {
                // Room for all of them before the first: the entries point at its elements.
                m_lowercasedKeys.reserveCapacity(map.uncommonHeaders().size());
                m_lowercasedKeys.unsafeAppendWithoutCapacityCheck(WTF::move(lowercased));
                key = &m_lowercasedKeys.last();
            }
            m_entries.unsafeAppendWithoutCapacityCheck(Entry { key, &header.value, std::nullopt });
        }
        auto& ranks = lowercaseHeaderNameRanks();
        std::sort(m_entries.begin(), m_entries.end(), [&](const Entry& a, const Entry& b) {
            if (a.name && b.name)
                return ranks[static_cast<size_t>(*a.name)] < ranks[static_cast<size_t>(*b.name)];
            return WTF::codePointCompareLessThan(*a.key, *b.key);
        });
    } else {
        for (auto& header : map.commonHeaders())
            m_entries.unsafeAppendWithoutCapacityCheck(Entry { &WTF::httpHeaderNameDefaultCaseStringImpl(header.key), &header.value, header.key });
        for (auto& header : map.uncommonHeaders())
            m_entries.unsafeAppendWithoutCapacityCheck(Entry { &header.key, &header.value, std::nullopt });
        std::sort(m_entries.begin(), m_entries.end(), [](const Entry& a, const Entry& b) {
            return WTF::codePointCompareLessThan(*a.key, *b.key);
        });
    }
    if (hasSetCookie)
        m_entries.unsafeAppendWithoutCapacityCheck(Entry {});

    m_currentIndex += m_cookieIndex;
    if (hasSetCookie) {
        size_t setCookieKeyIndex = m_entries.size() - 1;
        if (m_currentIndex < setCookieKeyIndex)
            m_cookieIndex = 0;
        else {
            m_cookieIndex = std::min(m_currentIndex - setCookieKeyIndex, map.getSetCookieHeaders().size());
            m_currentIndex -= m_cookieIndex;
        }
    } else
        m_cookieIndex = 0;

    m_updateCounter = m_headers->m_updateCounter;
}

const FetchHeaders::Iterator::Entry* FetchHeaders::Iterator::nextEntry()
{
    if (m_entries.isEmpty() || m_updateCounter != m_headers->m_updateCounter)
        collectEntries();

    auto& setCookieHeaders = m_headers->m_headers.getSetCookieHeaders();

    while (m_currentIndex < m_entries.size()) {
        auto& entry = m_entries[m_currentIndex];

        if (!entry.key) {
            if (m_cookieIndex < setCookieHeaders.size()) {
                m_setCookieEntry.value = &setCookieHeaders[m_cookieIndex++];
                return &m_setCookieEntry;
            }
            m_currentIndex++;
            continue;
        }

        m_currentIndex++;
        if (!entry.value->isNull())
            return &entry;
    }

    return nullptr;
}

std::optional<KeyValuePair<String, String>> FetchHeaders::Iterator::next()
{
    auto* entry = nextEntry();
    if (!entry)
        return std::nullopt;
    return KeyValuePair<String, String> { *entry->key, *entry->value };
}

FetchHeaders::Iterator::Iterator(FetchHeaders& headers, bool lowerCaseKeys = true)
    : m_headers(headers)
    , m_setCookieEntry { &WTF::httpHeaderNameStringImpl(HTTPHeaderName::SetCookie), nullptr, HTTPHeaderName::SetCookie }
{
    m_cookieIndex = 0;
    m_lowerCaseKeys = lowerCaseKeys;
}

} // namespace WebCore
