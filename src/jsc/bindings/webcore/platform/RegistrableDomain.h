/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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

#include "BlobURL.h"
#include "PublicSuffixStore.h"
#include "SecurityOriginData.h"
#include <wtf/HashTraits.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/URL.h>
#include <wtf/text/StringConcatenate.h>

namespace WebCore {

class RegistrableDomain {
    WTF_MAKE_TZONE_ALLOCATED_INLINE(RegistrableDomain);
public:
    RegistrableDomain() = default;

    explicit RegistrableDomain(const URL& url)
        : RegistrableDomain(registrableDomainFromHost(url))
    {
    }

    explicit RegistrableDomain(const SecurityOriginData& origin)
        : RegistrableDomain(registrableDomainFromHost(origin.host()))
    {
    }

    static RegistrableDomain fromRawString(String&& origin)
    {
        return RegistrableDomain(WTF::move(origin));
    }

    bool isEmpty() const { return m_registrableDomain.isEmpty() || m_registrableDomain == "nullOrigin"_s; }
    const String& string() const LIFETIME_BOUND { return m_registrableDomain; }

    friend bool operator==(const RegistrableDomain&, const RegistrableDomain&) = default;
    bool operator==(ASCIILiteral other) const { return m_registrableDomain == other; }

    bool matches(const URL& url) const
    {
        return matches(url.host());
    }

    bool matches(const SecurityOriginData& origin) const
    {
        return matches(origin.host());
    }

    RegistrableDomain isolatedCopy() const & { return RegistrableDomain { m_registrableDomain.isolatedCopy() }; }
    RegistrableDomain isolatedCopy() && { return RegistrableDomain { WTF::move(m_registrableDomain).isolatedCopy() }; }

    RegistrableDomain(WTF::HashTableDeletedValueType)
        : m_registrableDomain(WTF::HashTableDeletedValue) { }
    bool isHashTableDeletedValue() const { return m_registrableDomain.isHashTableDeletedValue(); }
    unsigned hash() const { return m_registrableDomain.hash(); }

    struct RegistrableDomainHash {
        static unsigned hash(const RegistrableDomain& registrableDomain) { return ASCIICaseInsensitiveHash::hash(registrableDomain.m_registrableDomain.impl()); }
        static bool equal(const RegistrableDomain& a, const RegistrableDomain& b) { return equalIgnoringASCIICase(a.string(), b.string()); }
        static const bool safeToCompareToEmptyOrDeleted = false;
    };

    static RegistrableDomain uncheckedCreateFromRegistrableDomainString(const String& domain)
    {
        return RegistrableDomain { String { domain } };
    }
    
    static RegistrableDomain uncheckedCreateFromHost(const String& host)
    {
        auto registrableDomain = PublicSuffixStore::singleton().topPrivatelyControlledDomain(host);
        if (registrableDomain.isEmpty())
            return uncheckedCreateFromRegistrableDomainString(host);
        return RegistrableDomain { WTF::move(registrableDomain) };
    }

private:
    explicit RegistrableDomain(String&& domain)
        : m_registrableDomain { domain.isEmpty() ? "nullOrigin"_s : WTF::move(domain) }
    {
    }

    bool matches(StringView host) const
    {
        if (host.isEmpty() && m_registrableDomain == "nullOrigin"_s)
            return true;
        if (!host.endsWith(m_registrableDomain))
            return false;
        if (host.length() == m_registrableDomain.length())
            return true;
        return host[host.length() - m_registrableDomain.length() - 1] == '.';
    }

    static inline String registrableDomainFromHost(const URL& url)
    {
        if (url.protocolIsBlob())
            return registrableDomainFromHost(BlobURL::getOriginURL(url).host().toString());

        return registrableDomainFromHost(url.host().toString());
    }

    static inline String registrableDomainFromHost(const String& host)
    {
        auto domain = PublicSuffixStore::singleton().topPrivatelyControlledDomain(host);
        if (host.isEmpty())
            domain = "nullOrigin"_s;
        else if (domain.isEmpty())
            domain = host;
        return domain;
    }

    String m_registrableDomain;
};

inline bool areRegistrableDomainsEqual(const URL& a, const URL& b)
{
    return RegistrableDomain(a).matches(b);
}

} // namespace WebCore

namespace WTF {
template<> struct DefaultHash<WebCore::RegistrableDomain> : WebCore::RegistrableDomain::RegistrableDomainHash { };
template<> struct HashTraits<WebCore::RegistrableDomain> : SimpleClassHashTraits<WebCore::RegistrableDomain> { };

template<> class StringTypeAdapter<WebCore::RegistrableDomain> : public StringTypeAdapter<String> {
public:
    StringTypeAdapter(const WebCore::RegistrableDomain& domain)
        : StringTypeAdapter<String>(domain.string())
    { }
};

} // namespace WTF
