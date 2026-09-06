/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann <hausmann@kde.org>
 * Copyright (C) 2003, 2006, 2007, 2008, 2009, 2010, 2014 Apple Inc. All rights reserved.
 *           (C) 2006 Graham Dennis (graham.dennis@gmail.com)
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2012 Motorola Mobility Inc.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "DOMURL.h"

#include "NodeURLHelpers.h"
#include "URLSearchParams.h"

namespace WebCore {

inline DOMURL::DOMURL(URL&& completeURL)
    : m_url(WTF::move(completeURL))
    , m_initialURLCostForGC(static_cast<uint16_t>(std::min<size_t>(m_url.string().impl()->costDuringGC(), std::numeric_limits<uint16_t>::max())))
{
    ASSERT(m_url.isValid());
}

// The Exception message carries the input and its extra the raw base string
// (null if none was given); the JS error's message stays "Invalid URL" and
// they surface as `error.input` / `error.base` like Node's ERR_INVALID_URL
// (see createDOMException).
ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url)
{
    URL completeURL { url };
    if (!completeURL.isValid() || !Bun::hasValidParsedHost(completeURL, url))
        return Exception { InvalidURLError, url };
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const URL& base, const String& baseInput)
{
    ASSERT(base.isValid() || base.isNull());
    URL completeURL { base, url };
    if (!completeURL.isValid() || !Bun::hasValidParsedHost(completeURL, url))
        return Exception { InvalidURLError, url, baseInput };
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

// A null URL means the base did not parse or has an invalid host.
static URL parseBase(const String& base, DOMURL::BaseURLCache* cache)
{
    if (cache && cache->input == base) [[likely]]
        return cache->url;
    URL baseURL { base };
    if (!baseURL.isValid() || !Bun::hasValidParsedHost(baseURL, base))
        return {};
    if (cache) {
        cache->input = base;
        cache->url = baseURL;
    }
    return baseURL;
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const String& base, BaseURLCache* cache)
{
    URL baseURL = base.isNull() ? URL {} : parseBase(base, cache);
    if (!base.isNull() && !baseURL.isValid())
        return Exception { InvalidURLError, url, base };
    return create(url, baseURL, base);
}

DOMURL::~DOMURL() = default;

static URL parseInternal(const String& url, const String& base, DOMURL::BaseURLCache* cache)
{
    URL baseURL = base.isNull() ? URL {} : parseBase(base, cache);
    if (!base.isNull() && !baseURL.isValid())
        return {};
    URL result { baseURL, url };
    if (result.isValid() && !Bun::hasValidParsedHost(result, url))
        return {};
    return result;
}

RefPtr<DOMURL> DOMURL::parse(const String& url, const String& base, BaseURLCache* cache)
{
    auto completeURL = parseInternal(url, base, cache);
    if (!completeURL.isValid())
        return {};
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

bool DOMURL::canParse(const String& url, const String& base, BaseURLCache* cache)
{
    return parseInternal(url, base, cache).isValid();
}

ExceptionOr<void> DOMURL::setHref(const String& url)
{
    URL completeURL { URL {}, url };
    if (!completeURL.isValid() || !Bun::hasValidParsedHost(completeURL, url))
        return Exception { InvalidURLError, url };
    m_url = WTF::move(completeURL);
    m_searchParamsDirty = false;
    if (m_searchParams)
        m_searchParams->updateFromAssociatedURL();
    return {};
}

// The update steps invoked on URLSearchParams::{append,set,delete,sort} set
// m_searchParamsDirty instead of eagerly re-serializing m_url on every call so
// that N appends through url.searchParams stay O(N) instead of O(N^2). All
// reads of m_url (href/fullURL) call this first to reconcile.
void DOMURL::flushPendingSearchParamsUpdate() const
{
    if (!m_searchParamsDirty) [[likely]]
        return;
    m_searchParamsDirty = false;
    auto* self = const_cast<DOMURL*>(this);
    if (!self->m_searchParams)
        return;
    auto serialized = self->m_searchParams->toString();
    if (serialized.isEmpty())
        self->m_url.setQuery({});
    else
        self->m_url.setQuery(WTF::move(serialized));
}

URLSearchParams& DOMURL::searchParams()
{
    if (!m_searchParams)
        m_searchParams = URLSearchParams::create(search(), this);
    return *m_searchParams;
}

} // namespace WebCore
