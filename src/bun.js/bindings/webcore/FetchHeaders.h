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

#pragma once

#include "ExceptionOr.h"
#include "HTTPHeaderMap.h"
#include <variant>
#include <wtf/HashTraits.h>
#include <wtf/Vector.h>

namespace WebCore {

class ScriptExecutionContext;

DECLARE_ALLOCATOR_WITH_HEAP_IDENTIFIER(FetchHeaders);

class FetchHeaders : public RefCounted<FetchHeaders> {
    WTF_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(FetchHeaders);

public:
    enum class Guard {
        None,
        Immutable,
        Request,
        RequestNoCors,
        Response
    };

    using Init = std::variant<Vector<Vector<String>>, Vector<KeyValuePair<String, String>>>;
    static ExceptionOr<Ref<FetchHeaders>> create(std::optional<Init>&&);

    static Ref<FetchHeaders> create(Guard guard = Guard::None, HTTPHeaderMap&& headers = {}) { return adoptRef(*new FetchHeaders { guard, WTFMove(headers) }); }
    static Ref<FetchHeaders> create(const FetchHeaders& headers) { return adoptRef(*new FetchHeaders { headers }); }

    ExceptionOr<void> append(const String& name, const String& value);
    ExceptionOr<void> remove(const String&);
    ExceptionOr<String> get(const String&) const;
    ExceptionOr<bool> has(const String&) const;
    ExceptionOr<void> set(const String& name, const String& value);
    ExceptionOr<void> set(const HTTPHeaderName name, const String& value);

    ExceptionOr<void> fill(const Init&);
    ExceptionOr<void> fill(const FetchHeaders&);
    void filterAndFill(const HTTPHeaderMap&, Guard);

    size_t memoryCost() const;

    inline uint32_t size()
    {
        return m_headers.size();
    }

    inline uint32_t sizeAfterJoiningSetCookieHeader()
    {
        return m_headers.commonHeaders().size() + m_headers.uncommonHeaders().size() + (m_headers.getSetCookieHeaders().size() > 0);
    }

    String fastGet(HTTPHeaderName name) const { return m_headers.get(name); }
    bool fastHas(HTTPHeaderName name) const { return m_headers.contains(name); }
    bool fastRemove(HTTPHeaderName name) { return m_headers.remove(name); }
    void fastSet(HTTPHeaderName name, const String& value) { m_headers.set(name, value); }

    const Vector<String, 0>& getSetCookieHeaders() const { return m_headers.getSetCookieHeaders(); }

    class Iterator {
    public:
        explicit Iterator(FetchHeaders&);
        Iterator(FetchHeaders&, bool lowerCaseKeys);
        std::optional<KeyValuePair<String, String>> next();

    private:
        Ref<FetchHeaders> m_headers;
        size_t m_currentIndex { 0 };
        Vector<String> m_keys;
        uint64_t m_updateCounter { 0 };
        size_t m_cookieIndex { 0 };
        bool m_lowerCaseKeys { true };
    };
    Iterator createIterator(bool lowerCaseKeys = true)
    {
        return Iterator(*this, lowerCaseKeys);
    }

    Iterator createIterator(const ScriptExecutionContext* context)
    {
        return Iterator(*this, true);
    }

    void setInternalHeaders(HTTPHeaderMap&& headers) { m_headers = WTFMove(headers); }
    const HTTPHeaderMap& internalHeaders() const { return m_headers; }

    void setGuard(Guard);
    Guard guard() const { return m_guard; }

    FetchHeaders(Guard, HTTPHeaderMap&&);
    explicit FetchHeaders(const FetchHeaders&);

    uint64_t m_updateCounter { 0 };

private:
    Guard m_guard;
    HTTPHeaderMap m_headers;
};

inline FetchHeaders::FetchHeaders(Guard guard, HTTPHeaderMap&& headers)
    : m_guard(guard)
    , m_headers(WTFMove(headers))
{
}

inline FetchHeaders::FetchHeaders(const FetchHeaders& other)
    : RefCounted<FetchHeaders>()
    , m_guard(other.m_guard)
    , m_headers(other.m_headers)
{
}

inline void FetchHeaders::setGuard(Guard guard)
{
    ASSERT(!m_headers.size());
    m_guard = guard;
}

} // namespace WebCore

namespace WTF {

template<> struct EnumTraits<WebCore::FetchHeaders::Guard> {
    using values = EnumValues<
        WebCore::FetchHeaders::Guard,
        WebCore::FetchHeaders::Guard::None,
        WebCore::FetchHeaders::Guard::Immutable,
        WebCore::FetchHeaders::Guard::Request,
        WebCore::FetchHeaders::Guard::RequestNoCors,
        WebCore::FetchHeaders::Guard::Response>;
};

}
