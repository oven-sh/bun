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
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED_WITH_HEAP_IDENTIFIER(FetchHeaders, FetchHeaders);

public:
    enum class Guard : uint8_t {
        None,
        Immutable,
        Request,
        RequestNoCors,
        Response
    };

    using Init = Variant<Vector<Vector<String>>, Vector<KeyValuePair<String, String>>>;
    static ExceptionOr<Ref<FetchHeaders>> create(std::optional<Init>&&);

    static Ref<FetchHeaders> create(Guard guard = Guard::None, HTTPHeaderMap&& headers = {}) { return adoptRef(*new FetchHeaders { guard, WTF::move(headers) }); }
    static Ref<FetchHeaders> create(const FetchHeaders& headers) { return adoptRef(*new FetchHeaders { headers }); }

    ExceptionOr<void> append(const String& name, const String& value);
    ExceptionOr<void> remove(const StringView);
    ExceptionOr<String> get(const StringView) const;
    ExceptionOr<bool> has(const StringView) const;
    ExceptionOr<void> set(const String& name, const String& value);
    ExceptionOr<void> set(const HTTPHeaderName name, const String& value);

    ExceptionOr<void> fill(const Init&);
    ExceptionOr<void> fill(const FetchHeaders&);

    size_t memoryCost() const;

    inline uint32_t size() const
    {
        return internalHeaders().size();
    }

    inline uint32_t sizeAfterJoiningSetCookieHeader() const
    {
        return internalHeaders().commonHeaders().size() + internalHeaders().uncommonHeaders().size() + (internalHeaders().getSetCookieHeaders().size() > 0);
    }

    String fastGet(HTTPHeaderName name) const { return internalHeaders().get(name); }
    bool fastHas(HTTPHeaderName name) const { return internalHeaders().contains(name); }
    bool fastRemove(HTTPHeaderName name)
    {
        ++m_nativeRemovals;
        return m_headers.willChange().remove(name);
    }

    const Vector<String, 0>& getSetCookieHeaders() const { return internalHeaders().getSetCookieHeaders(); }

    class Iterator {
    public:
        explicit Iterator(FetchHeaders&);
        Iterator(FetchHeaders&, bool lowerCaseKeys);
        Iterator(Iterator&&) = default;
        std::optional<KeyValuePair<String, String>> next();

        // Points into the headers: valid until they change or nextEntry() is called again.
        struct Entry {
            const String* key { nullptr };
            const String* value { nullptr };
            std::optional<HTTPHeaderName> name;
        };
        const Entry* nextEntry();

    private:
        void collectEntries();

        Ref<FetchHeaders> m_headers;
        size_t m_currentIndex { 0 };
        // Sorted by key, then the Set-Cookie headers in the order they were added.
        Vector<Entry> m_entries;
        Vector<String> m_lowercasedKeys;
        uint64_t m_updateCounter { 0 };
        uint16_t m_nativeRemovals { 0 };
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

    void setInternalHeaders(HTTPHeaderMap&& headers) { m_headers.willChange() = WTF::move(headers); }
    const HTTPHeaderMap& internalHeaders() const { return m_headers.get(); }

    void setGuard(Guard);
    Guard guard() const { return m_guard; }

    FetchHeaders(Guard, HTTPHeaderMap&&);
    explicit FetchHeaders(const FetchHeaders&);

private:
    // An iterator points into the map while the counter stands still, so the one way to a map that can be changed moves it.
    class CountedHeaderMap {
    public:
        explicit CountedHeaderMap(HTTPHeaderMap map)
            : m_map(WTF::move(map))
        {
        }

        const HTTPHeaderMap& get() const { return m_map; }
        HTTPHeaderMap& willChange()
        {
            ++m_updateCounter;
            return m_map;
        }
        uint64_t updateCounter() const { return m_updateCounter; }

    private:
        HTTPHeaderMap m_map;
        uint64_t m_updateCounter { 0 };
    };

    Guard m_guard;
    // How often fastRemove() ran. An iterator compares it with the counter to tell that nothing else changed the map.
    uint16_t m_nativeRemovals { 0 };
    CountedHeaderMap m_headers;
};

inline FetchHeaders::FetchHeaders(Guard guard, HTTPHeaderMap&& headers)
    : m_guard(guard)
    , m_headers(WTF::move(headers))
{
}

inline FetchHeaders::FetchHeaders(const FetchHeaders& other)
    : RefCounted<FetchHeaders>()
    , m_guard(other.m_guard)
    , m_headers(other.internalHeaders())
{
}

inline void FetchHeaders::setGuard(Guard guard)
{
    ASSERT(!internalHeaders().size());
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
