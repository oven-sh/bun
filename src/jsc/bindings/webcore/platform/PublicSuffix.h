/*
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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

#include <wtf/CrossThreadCopier.h>
#include <wtf/HashTraits.h>
#include <wtf/Packed.h>
#include <wtf/text/StringHash.h>

namespace WebCore {

class PublicSuffix {
public:
    static PublicSuffix fromRawString(String&& string) { return PublicSuffix(WTF::move(string)); }
    PublicSuffix() = default;
    bool isValid() const { return !m_string.isEmpty(); }
    const String& string() const LIFETIME_BOUND { return m_string; }
    PublicSuffix isolatedCopy() const { return fromRawString(crossThreadCopy(m_string)); }

    PublicSuffix(WTF::HashTableDeletedValueType)
        : m_string(WTF::HashTableDeletedValue) { }
    friend bool operator==(const PublicSuffix&, const PublicSuffix&) = default;
    bool operator==(ASCIILiteral other) const { return m_string == other; }
    bool isHashTableDeletedValue() const { return m_string.isHashTableDeletedValue(); }
    unsigned hash() const { return m_string.hash(); }
    struct PublicSuffixHash {
        static unsigned hash(const PublicSuffix& publicSuffix) { return ASCIICaseInsensitiveHash::hash(publicSuffix.m_string.impl()); }
        static bool equal(const PublicSuffix& a, const PublicSuffix& b) { return equalIgnoringASCIICase(a.string(), b.string()); }
        static const bool safeToCompareToEmptyOrDeleted = false;
    };

private:
    explicit PublicSuffix(String&& string) : m_string(WTF::move(string)) { }

    String m_string;
};

} // namespace WebCore

namespace WTF {

template<> struct DefaultHash<WebCore::PublicSuffix> : WebCore::PublicSuffix::PublicSuffixHash { };
template<> struct HashTraits<WebCore::PublicSuffix> : SimpleClassHashTraits<WebCore::PublicSuffix> { };

} // namespace WTF
