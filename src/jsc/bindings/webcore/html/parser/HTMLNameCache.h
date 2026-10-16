/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "QualifiedName.h"
#include <wtf/Noncopyable.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

class HTMLNameCache {
    WTF_MAKE_TZONE_ALLOCATED(HTMLNameCache);
    WTF_MAKE_NONCOPYABLE(HTMLNameCache);
public:
    HTMLNameCache() = default;

    ALWAYS_INLINE QualifiedName makeAttributeQualifiedName(std::span<const char16_t> string)
    {
        return makeQualifiedName(string);
    }

    ALWAYS_INLINE QualifiedName makeAttributeQualifiedName(std::span<const Latin1Character> string)
    {
        return makeQualifiedName(string);
    }

    ALWAYS_INLINE AtomString makeAttributeValue(std::span<const char16_t> string)
    {
        return makeAtomString(string);
    }

    ALWAYS_INLINE AtomString makeAttributeValue(std::span<const Latin1Character> string)
    {
        return makeAtomString(string);
    }

    ALWAYS_INLINE void clear()
    {
        // FIXME (webkit.org/b/230019): We should try to find more opportunities to clear this cache without hindering this performance optimization.
        m_atomStringCache.fill({ });
        m_qualifiedNameCache.fill({ });
    }

private:
    template<typename CharacterType>
    ALWAYS_INLINE AtomString makeAtomString(std::span<const CharacterType> string)
    {
        if (string.empty())
            return emptyAtom();

        if (string.size() > maxStringLengthForCache)
            return AtomString(string);

        auto& slot = atomStringCacheSlot(string.front(), string.back(), string.size());
        if (!equal(slot.impl(), string)) {
            AtomString result { string };
            slot = result;
            return result;
        }

        return slot;
    }

    template<typename CharacterType>
    ALWAYS_INLINE QualifiedName makeQualifiedName(std::span<const CharacterType> string)
    {
        if (string.empty())
            return nullQName();

        if (string.size() > maxStringLengthForCache)
            return QualifiedName(nullAtom(), AtomString(string), nullAtom());

        auto& slot = qualifiedNameCacheSlot(string.front(), string.back(), string.size());
        if (!slot || !equal(slot->m_localName.impl(), string)) {
            QualifiedName result(nullAtom(), AtomString(string), nullAtom());
            slot = result.impl();
            return result;
        }

        return *slot;
    }

    ALWAYS_INLINE static size_t slotIndex(char16_t firstCharacter, char16_t lastCharacter, char16_t length, size_t capacity)
    {
        unsigned hash = (firstCharacter << 6) ^ ((lastCharacter << 14) ^ firstCharacter);
        hash += (hash >> 14) + (length << 14);
        hash ^= hash << 14;
        return (hash + (hash >> 6)) % capacity;
    }

    ALWAYS_INLINE AtomString& atomStringCacheSlot(char16_t firstCharacter, char16_t lastCharacter, char16_t length)
    {
        auto index = slotIndex(firstCharacter, lastCharacter, length, atomStringCacheCapacity);
        return m_atomStringCache[index];
    }

    ALWAYS_INLINE RefPtr<QualifiedName::QualifiedNameImpl>& qualifiedNameCacheSlot(char16_t firstCharacter, char16_t lastCharacter, char16_t length)
    {
        auto index = slotIndex(firstCharacter, lastCharacter, length, qualifiedNameCacheCapacity);
        return m_qualifiedNameCache[index];
    }

    static constexpr auto maxStringLengthForCache = 36;
    static constexpr auto atomStringCacheCapacity = 2048;
    static constexpr auto qualifiedNameCacheCapacity = 512;

    using AtomStringCache = std::array<AtomString, atomStringCacheCapacity>;
    using QualifiedNameCache = std::array<RefPtr<QualifiedName::QualifiedNameImpl>, qualifiedNameCacheCapacity>;

    AtomStringCache m_atomStringCache;
    QualifiedNameCache m_qualifiedNameCache;
};

} // namespace WebCore
