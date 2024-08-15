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

#include "ActiveDOMObject.h"
// #include "Blob.h"
// #include "BlobURL.h"
// #include "MemoryCache.h"
// #include "PublicURLManager.h"
// #include "ResourceRequest.h"
#include "ScriptExecutionContext.h"
// #include "SecurityOrigin.h"
#include "URLSearchParams.h"
#include <wtf/MainThread.h>

class URLRegistrable {
public:
};

class Blob {
public:
};

namespace WebCore {

static inline String redact(const String& input)
{
    if (input.contains('@'))
        return "<redacted>"_s;

    return makeString('"', input, '"');
}

inline DOMURL::DOMURL(URL&& completeURL)
    : m_url(WTFMove(completeURL))
{
    ASSERT(m_url.isValid());
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url)
{
    URL completeURL { url };
    if (!completeURL.isValid())
        return Exception { TypeError, makeString(redact(url), " cannot be parsed as a URL."_s) };
    return adoptRef(*new DOMURL(WTFMove(completeURL)));
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const URL& base)
{
    ASSERT(base.isValid() || base.isNull());
    URL completeURL { base, url };
    if (!completeURL.isValid())
        return Exception { TypeError, makeString(redact(url), " cannot be parsed as a URL."_s) };
    return adoptRef(*new DOMURL(WTFMove(completeURL)));
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const String& base)
{
    URL baseURL { base };
    if (!base.isNull() && !baseURL.isValid())
        return Exception { TypeError, makeString(redact(url), " cannot be parsed as a URL against "_s, redact(base)) };
    return create(url, baseURL);
}

DOMURL::~DOMURL() = default;

static URL parseInternal(const String& url, const String& base)
{
    URL baseURL { base };
    if (!base.isNull() && !baseURL.isValid())
        return {};
    return { baseURL, url };
}

RefPtr<DOMURL> DOMURL::parse(const String& url, const String& base)
{
    auto completeURL = parseInternal(url, base);
    if (!completeURL.isValid())
        return {};
    return adoptRef(*new DOMURL(WTFMove(completeURL)));
}

bool DOMURL::canParse(const String& url, const String& base)
{
    return parseInternal(url, base).isValid();
}

ExceptionOr<void> DOMURL::setHref(const String& url)
{
    URL completeURL { URL {}, url };
    if (!completeURL.isValid()) {

        return Exception { TypeError, makeString(redact(url), " cannot be parsed as a URL."_s) };
    }
    m_url = WTFMove(completeURL);
    if (m_searchParams)
        m_searchParams->updateFromAssociatedURL();
    return {};
}

String DOMURL::createObjectURL(ScriptExecutionContext& scriptExecutionContext, Blob& blob)
{
    UNUSED_PARAM(blob);
    UNUSED_PARAM(scriptExecutionContext);
    return String();
    // return createPublicURL(scriptExecutionContext, blob);
}

String DOMURL::createPublicURL(ScriptExecutionContext& scriptExecutionContext, URLRegistrable& registrable)
{
    // URL publicURL = BlobURL::createPublicURL(scriptExecutionContext.securityOrigin());
    // if (publicURL.isEmpty())
    //     return String();

    // scriptExecutionContext.publicURLManager().registerURL(publicURL, registrable);

    // return publicURL.string();
    UNUSED_PARAM(scriptExecutionContext);
    UNUSED_PARAM(registrable);
    return String();
}

URLSearchParams& DOMURL::searchParams()
{
    if (!m_searchParams)
        m_searchParams = URLSearchParams::create(search(), this);
    return *m_searchParams;
}

void DOMURL::revokeObjectURL(ScriptExecutionContext& scriptExecutionContext, const String& urlString)
{
    // URL url { urlString };
    // ResourceRequest request(url);
    // request.setDomainForCachePartition(scriptExecutionContext.domainForCachePartition());

    // MemoryCache::removeRequestFromSessionCaches(scriptExecutionContext, request);

    // scriptExecutionContext.publicURLManager().revoke(url);
    UNUSED_PARAM(scriptExecutionContext);
    UNUSED_PARAM(urlString);
}

} // namespace WebCore
