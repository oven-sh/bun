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
#include <iterator>
#include <memory>
#include <span>
#include <utility>
#include <wtf/HashMap.h>
#include <wtf/text/StringHash.h>
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

    struct HeaderIndex {
        size_t index;

        bool isValid() const { return index != notFound; }
    };

    struct UncommonHeader {
        String key;
        String value;

        bool operator==(const UncommonHeader& other) const { return key == other.key && value == other.value; }
    };

    typedef Vector<CommonHeader, 2, CrashOnOverflow, 6> CommonHeadersVector;

    // The headers whose name has no HTTPHeaderName, in the order they were added. Past indexThreshold a hash index
    // finds a name, and remove() leaves a hole in the vector, so only this class sees the vector.
    class UncommonHeaderStore {
    public:
        class const_iterator {
        public:
            const UncommonHeader& operator*() const { return *m_position; }
            const UncommonHeader* operator->() const { return m_position; }
            const_iterator& operator++()
            {
                ++m_position;
                skipHoles();
                return *this;
            }
            bool operator==(std::default_sentinel_t) const { return m_position == m_end; }

        private:
            friend class UncommonHeaderStore;
            const_iterator(const UncommonHeader* position, const UncommonHeader* end)
                : m_position(position)
                , m_end(end)
            {
                skipHoles();
            }
            void skipHoles()
            {
                while (m_position != m_end && m_position->key.isNull())
                    ++m_position;
            }

            const UncommonHeader* m_position;
            const UncommonHeader* m_end;
        };

        UncommonHeaderStore() = default;
        // A copy starts without the index and without the holes.
        UncommonHeaderStore(const UncommonHeaderStore& other)
            : m_slots(other.m_slots)
        {
            if (usesIndex()) [[unlikely]]
                removeHoles(other.size());
        }
        UncommonHeaderStore(UncommonHeaderStore&&) = default;
        UncommonHeaderStore& operator=(const UncommonHeaderStore& other) { return *this = UncommonHeaderStore { other }; }
        UncommonHeaderStore& operator=(UncommonHeaderStore&&) = default;

        const_iterator begin() const { return { m_slots.begin(), m_slots.end() }; }
        std::default_sentinel_t end() const { return std::default_sentinel; }
        bool isEmpty() const { return m_slots.isEmpty(); }
        unsigned size() const { return m_index.isEmpty() ? m_slots.size() : m_index.size(); }
        size_t memoryCost() const;

        // The value stored for a name, or null. The pointer is good until the next append() or remove().
        template<typename NameType> const String* find(const NameType& name) const
        {
            if (usesIndex()) [[unlikely]]
                return findInIndex(name);
            for (auto& header : m_slots) {
                if (equalIgnoringASCIICase(header.key, name))
                    return &header.value;
            }
            return nullptr;
        }
        template<typename NameType> String* find(const NameType& name) { return const_cast<String*>(std::as_const(*this).find(name)); }
        // For a name that find() has just not found.
        void append(const String& name, const String& value)
        {
            ASSERT(!find(name));
            m_slots.append(UncommonHeader { name, value });
            if (usesIndex()) [[unlikely]]
                indexLastSlot();
        }
        bool remove(StringView name)
        {
            if (usesIndex()) [[unlikely]]
                return removeInIndex(name);
            return m_slots.removeFirstMatching([&](auto& header) {
                return equalIgnoringASCIICase(header.key, name);
            });
        }

    private:
        typedef HashMap<String, unsigned, ASCIICaseInsensitiveHash> Index;

        // With more slots than this, a hash index finds a name. Up to here a scan does: a small map has nothing to build or to hold for it.
        static constexpr unsigned indexThreshold = 64;

        bool usesIndex() const { return m_slots.size() > indexThreshold; }
        Index& index() const;
        // Out of line, so that the scans stay as small as they were without an index.
        NEVER_INLINE const String* findInIndex(StringView name) const;
        NEVER_INLINE bool removeInIndex(StringView name);
        NEVER_INLINE void indexLastSlot();
        // Takes the holes out, which leaves the given number of headers.
        NEVER_INLINE void removeHoles(unsigned names);

        // The headers and the holes. There is a hole only while usesIndex().
        Vector<UncommonHeader, 0, CrashOnOverflow, 0> m_slots;
        // Name to position in m_slots, built by the first lookup that usesIndex(). While it is empty, m_slots has no hole.
        mutable Index m_index;
    };

    // The Set-Cookie values in the order they were added. One pointer, because few maps have any.
    class SetCookieHeaders {
    public:
        SetCookieHeaders() = default;
        SetCookieHeaders(const SetCookieHeaders& other)
            : m_values(other.m_values ? makeUnique<Values>(*other.m_values) : nullptr)
        {
        }
        SetCookieHeaders(SetCookieHeaders&&) = default;
        SetCookieHeaders& operator=(const SetCookieHeaders& other) { return *this = SetCookieHeaders { other }; }
        SetCookieHeaders& operator=(SetCookieHeaders&&) = default;

        std::span<const String> span() const { return m_values ? m_values->span() : std::span<const String> {}; }
        bool isEmpty() const { return !size(); }
        unsigned size() const { return m_values ? m_values->size() : 0; }
        void append(const String& value) { values().append(value); }
        // Returns false if the list can't grow.
        bool tryAppend(const String& value);
        void clear() { m_values = nullptr; }

    private:
        typedef Vector<String, 4> Values;

        Values& values()
        {
            if (!m_values)
                m_values = makeUnique<Values>();
            return *m_values;
        }

        std::unique_ptr<Values> m_values;
    };

    class HTTPHeaderMapConstIterator {
    public:
        HTTPHeaderMapConstIterator(const HTTPHeaderMap& table, CommonHeadersVector::const_iterator commonHeadersIt, UncommonHeaderStore::const_iterator uncommonHeadersIt)
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

        bool operator==(std::default_sentinel_t) const
        {
            return m_commonHeadersIt == m_table.m_commonHeaders.end() && m_uncommonHeadersIt == std::default_sentinel;
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
        bool updateKeyValue(UncommonHeaderStore::const_iterator it)
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
        UncommonHeaderStore::const_iterator m_uncommonHeadersIt;
        KeyValue m_keyValue;
    };
    typedef HTTPHeaderMapConstIterator const_iterator;

    WEBCORE_EXPORT HTTPHeaderMap();

    bool isEmpty() const { return m_commonHeaders.isEmpty() && m_uncommonHeaders.isEmpty() && m_setCookieHeaders.isEmpty(); }
    int size() const { return m_commonHeaders.size() + m_uncommonHeaders.size() + m_setCookieHeaders.size(); }

    WEBCORE_EXPORT String get(const StringView name) const;
    WEBCORE_EXPORT void set(const String& name, const String& value);
    WEBCORE_EXPORT void add(const String& name, const String& value);
    WEBCORE_EXPORT bool contains(const StringView) const;
    WEBCORE_EXPORT int64_t indexOf(StringView name) const;
    WEBCORE_EXPORT bool remove(const StringView);
    WEBCORE_EXPORT bool removeUncommonHeader(const StringView);

    WEBCORE_EXPORT String getIndex(HeaderIndex index) const;
    WEBCORE_EXPORT bool setIndex(HeaderIndex index, const String& value);
    HeaderIndex indexOf(HTTPHeaderName name) const;

    WEBCORE_EXPORT String get(HTTPHeaderName) const;
    // Returns the Set-Cookie values joined with ", ", or nullopt if the result exceeds the max string length.
    WEBCORE_EXPORT std::optional<String> tryJoinSetCookieHeaders() const;
    void set(HTTPHeaderName, const String& value);
    void add(HTTPHeaderName, const String& value);
    // Returns false if the list of Set-Cookie values can't grow.
    bool tryAddSetCookie(const String& value);
    WEBCORE_EXPORT bool contains(HTTPHeaderName) const;
    WEBCORE_EXPORT bool remove(HTTPHeaderName);

    size_t memoryCost() const;

    // Instead of passing a string literal to any of these functions, just use a HTTPHeaderName instead.
    template<size_t length> String get(const char (&)[length]) const = delete;
    template<size_t length> void set(const char (&)[length], const String&) = delete;
    template<size_t length> bool contains(const char (&)[length]) = delete;
    template<size_t length> bool remove(const char (&)[length]) = delete;

    std::span<const String> getSetCookieHeaders() const { return m_setCookieHeaders.span(); }

    const CommonHeadersVector& commonHeaders() const { return m_commonHeaders; }
    const UncommonHeaderStore& uncommonHeaders() const { return m_uncommonHeaders; }

    const_iterator begin() const { return const_iterator(*this, m_commonHeaders.begin(), m_uncommonHeaders.begin()); }
    std::default_sentinel_t end() const { return std::default_sentinel; }

    void setUncommonHeader(const String& name, const String& value);
    void addUncommonHeaderCloneName(const StringView name, const String& value);
    WEBCORE_EXPORT String getUncommonHeader(const StringView name) const;
    // Looks the name up once. `newValue` gets the value stored for the name, or nullptr when there is none, and
    // returns the value to store. A null return leaves the map as it is.
    template<typename Functor> void updateUncommonHeader(const String& name, NOESCAPE const Functor& newValue)
    {
        String* stored = m_uncommonHeaders.find(name);
        const String* value = newValue(stored);
        if (!value)
            return;
        if (stored)
            *stored = *value;
        else
            m_uncommonHeaders.append(name, *value);
    }

private:
    CommonHeadersVector m_commonHeaders;
    UncommonHeaderStore m_uncommonHeaders;
    SetCookieHeaders m_setCookieHeaders;
};

} // namespace WebCore
