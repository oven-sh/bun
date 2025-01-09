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

namespace WebCore {

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(FetchHeaders);

// https://fetch.spec.whatwg.org/#concept-headers-remove-privileged-no-cors-request-headers
static void removePrivilegedNoCORSRequestHeaders(HTTPHeaderMap& headers)
{
    headers.remove(HTTPHeaderName::Range);
}

static ExceptionOr<bool> canWriteHeader(const HTTPHeaderName name, const String& value, const String& combinedValue, FetchHeaders::Guard guard)
{
    ASSERT(value.isEmpty() || (!isHTTPSpace(value[0]) && !isHTTPSpace(value[value.length() - 1])));
    if (!isValidHTTPHeaderValue((value)))
        return Exception { TypeError, makeString("Header '"_s, name, "' has invalid value: '"_s, value, "'"_s) };
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
        return Exception { TypeError, makeString("Header '"_s, name, "' has invalid value: '"_s, value, "'"_s) };
    if (guard == FetchHeaders::Guard::Immutable)
        return Exception { TypeError, "Headers object's guard is 'immutable'"_s };
    return true;
}

static ExceptionOr<void> appendToHeaderMap(const String& name, const String& value, HTTPHeaderMap& headers, FetchHeaders::Guard guard)
{
    String normalizedValue = value.trim(isHTTPSpace);
    String combinedValue = normalizedValue;
    HTTPHeaderName headerName;
    if (findHTTPHeaderName(name, headerName)) {
        auto index = headers.indexOf(headerName);

        if (headerName != HTTPHeaderName::SetCookie) {
            if (index.isValid()) {
                auto existing = headers.getIndex(index);
                if (headerName == HTTPHeaderName::Cookie) {
                    combinedValue = makeString(existing, "; "_s, normalizedValue);
                } else {
                    combinedValue = makeString(existing, ", "_s, normalizedValue);
                }
            }
        }

        auto canWriteResult = canWriteHeader(headerName, normalizedValue, combinedValue, guard);

        if (canWriteResult.hasException())
            return canWriteResult.releaseException();
        if (!canWriteResult.releaseReturnValue())
            return {};

        if (headerName != HTTPHeaderName::SetCookie) {
            if (!headers.setIndex(index, combinedValue))
                headers.set(headerName, combinedValue);
        } else {
            headers.add(headerName, normalizedValue);
        }

        return {};
    }
    auto index = headers.indexOf(name);
    if (index.isValid()) {
        combinedValue = makeString(headers.getIndex(index), ", "_s, normalizedValue);
    }
    auto canWriteResult = canWriteHeader(name, normalizedValue, combinedValue, guard);
    if (canWriteResult.hasException())
        return canWriteResult.releaseException();
    if (!canWriteResult.releaseReturnValue())
        return {};

    if (!headers.setIndex(index, combinedValue))
        headers.set(name, combinedValue);

    // if (guard == FetchHeaders::Guard::RequestNoCors)
    //     removePrivilegedNoCORSRequestHeaders(headers);

    return {};
}

static ExceptionOr<void> appendToHeaderMap(const HTTPHeaderMap::HTTPHeaderMapConstIterator::KeyValue& header, HTTPHeaderMap& headers, FetchHeaders::Guard guard)
{
    String normalizedValue = header.value.trim(isHTTPSpace);
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

    return adoptRef(*new FetchHeaders { Guard::None, WTFMove(headers) });
}

ExceptionOr<void> FetchHeaders::fill(const Init& headerInit)
{
    return fillHeaderMap(m_headers, headerInit, m_guard);
}

ExceptionOr<void> FetchHeaders::fill(const FetchHeaders& otherHeaders)
{
    if (this->size() == 0) {
        HTTPHeaderMap headers;
        headers.commonHeaders().appendVector(otherHeaders.m_headers.commonHeaders());
        headers.uncommonHeaders().appendVector(otherHeaders.m_headers.uncommonHeaders());
        headers.getSetCookieHeaders().appendVector(otherHeaders.m_headers.getSetCookieHeaders());
        setInternalHeaders(WTFMove(headers));
        m_updateCounter++;
        return {};
    }

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
    if (!isValidHTTPToken(name))
        return Exception { TypeError, makeString("Invalid header name: '"_s, name, "'"_s) };
    if (m_guard == FetchHeaders::Guard::Immutable)
        return Exception { TypeError, "Headers object's guard is 'immutable'"_s };
    if (m_guard == FetchHeaders::Guard::Request && isForbiddenHeaderName(name))
        return {};
    if (m_guard == FetchHeaders::Guard::RequestNoCors && !isNoCORSSafelistedRequestHeaderName(name) && !isPriviledgedNoCORSRequestHeaderName(name))
        return {};
    if (m_guard == FetchHeaders::Guard::Response && isForbiddenResponseHeaderName(name))
        return {};

    ++m_updateCounter;
    m_headers.remove(name);

    if (m_guard == FetchHeaders::Guard::RequestNoCors)
        removePrivilegedNoCORSRequestHeaders(m_headers);

    return {};
}

size_t FetchHeaders::memoryCost() const
{
    return m_headers.memoryCost() + sizeof(*this);
}

ExceptionOr<String> FetchHeaders::get(const StringView name) const
{
    if (!isValidHTTPToken(name))
        return Exception { TypeError, makeString("Invalid header name: '"_s, name, "'"_s) };
    return m_headers.get(name);
}

ExceptionOr<bool> FetchHeaders::has(const StringView name) const
{
    if (!isValidHTTPToken(name))
        return Exception { TypeError, makeString("Invalid header name: '"_s, name, '"') };
    return m_headers.contains(name);
}

ExceptionOr<void> FetchHeaders::set(const HTTPHeaderName name, const String& value)
{
    String normalizedValue = value.trim(isHTTPSpace);
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
    String normalizedValue = value.trim(isHTTPSpace);
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

void FetchHeaders::filterAndFill(const HTTPHeaderMap& headers, Guard guard)
{
    for (auto& header : headers) {
        String normalizedValue = header.value.trim(isHTTPSpace);
        auto canWriteResult = canWriteHeader(header.key, normalizedValue, header.value, guard);
        if (canWriteResult.hasException())
            continue;
        if (!canWriteResult.releaseReturnValue())
            continue;
        if (header.keyAsHTTPHeaderName)
            m_headers.add(header.keyAsHTTPHeaderName.value(), header.value);
        else
            m_headers.add(header.key, header.value);
    }
}

std::optional<KeyValuePair<String, String>> FetchHeaders::Iterator::next()
{
    if (m_keys.isEmpty() || m_updateCounter != m_headers->m_updateCounter) {
        bool hasSetCookie = !m_headers->getSetCookieHeaders().isEmpty();
        m_keys.resize(0);
        m_keys.reserveCapacity(m_headers->m_headers.size() + (hasSetCookie ? 1 : 0));
        if (m_lowerCaseKeys) {
            for (auto& header : m_headers->m_headers)
                m_keys.unsafeAppendWithoutCapacityCheck(header.asciiLowerCaseName());
        } else {
            for (auto& header : m_headers->m_headers)
                m_keys.unsafeAppendWithoutCapacityCheck(header.name());
        }
        std::sort(m_keys.begin(), m_keys.end(), WTF::codePointCompareLessThan);
        if (hasSetCookie)
            m_keys.unsafeAppendWithoutCapacityCheck(String());

        m_currentIndex += m_cookieIndex;
        if (hasSetCookie) {
            size_t setCookieKeyIndex = m_keys.size() - 1;
            if (m_currentIndex < setCookieKeyIndex)
                m_cookieIndex = 0;
            else {
                m_cookieIndex = std::min(m_currentIndex - setCookieKeyIndex, m_headers->getSetCookieHeaders().size());
                m_currentIndex -= m_cookieIndex;
            }
        } else
            m_cookieIndex = 0;

        m_updateCounter = m_headers->m_updateCounter;
    }

    auto& setCookieHeaders = m_headers->m_headers.getSetCookieHeaders();

    while (m_currentIndex < m_keys.size()) {
        auto key = m_keys[m_currentIndex];

        if (key.isNull()) {
            if (m_cookieIndex < setCookieHeaders.size()) {
                String value = setCookieHeaders[m_cookieIndex++];
                return KeyValuePair<String, String> { WTF::httpHeaderNameStringImpl(HTTPHeaderName::SetCookie), WTFMove(value) };
            }
            m_currentIndex++;
            continue;
        }

        m_currentIndex++;
        auto value = m_headers->m_headers.get(key);
        if (!value.isNull())
            return KeyValuePair<String, String> { WTFMove(key), WTFMove(value) };
    }

    return std::nullopt;
}

FetchHeaders::Iterator::Iterator(FetchHeaders& headers, bool lowerCaseKeys = true)
    : m_headers(headers)
{
    m_cookieIndex = 0;
    m_lowerCaseKeys = lowerCaseKeys;
}

} // namespace WebCore
