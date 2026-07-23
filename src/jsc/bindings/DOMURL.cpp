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

namespace Bun {
bool hasValidPunycodeHost(WTF::StringView);
bool containsUnicode16IDNADeltaSource(WTF::StringView);
WTF::String applyUnicode16IDNADelta(const WTF::String&);
}

namespace WebCore {

// The WHATWG parser (WebKit) fast-paths all-ASCII hosts without validating
// xn-- labels; Node's ada rejects invalid punycode in special-scheme hosts.
static bool hasValidParsedHost(const URL& url)
{
    // Cheap accept first: hosts without an invalid xn-- label are always fine.
    if (Bun::hasValidPunycodeHost(url.host()))
        return true;
    // Non-special schemes have opaque hosts and skip IDNA entirely.
    return !url.hasSpecialScheme();
}

// WebKit's URLParser runs the host through the platform ICU, whose
// IdnaMappingTable can predate Unicode 15.1/16.0 (node v26 semantics via
// ada::idna): old data rejects U+180E outright and maps U+1E9E to "ss".
// When the authority component of `urlString` contains a delta source code
// point, return a copy with the Unicode 16 delta applied to the host span
// only (path/query/fragment are percent-encoded by the parser and must stay
// untouched). Returns a null String when no rewrite is needed, which is the
// case for every URL that stays on the common path.
static String applyIDNADeltaToURLAuthority(const String& urlString, bool baseHasSpecialScheme = false)
{
    if (urlString.is8Bit() || !urlString.length())
        return {};

    StringView view { urlString };

    // The URL parser strips tab/CR/LF/leading-C0 before locating anything.
    size_t scan = 0;
    while (scan < view.length() && (view[scan] <= 0x20))
        scan++;

    // Non-special-scheme URLs have opaque hosts and never run IDNA (the host
    // is UTF-8 percent-encoded verbatim), so only the six special schemes are
    // eligible. For those, the WHATWG parser's special-authority-ignore-slashes
    // state consumes any run of '/' and '\\' (including zero) after the colon
    // and parses whatever follows as the host, so `http:host`, `http:/host`
    // and `http:\\\\host` all reach IDNA. A scheme-relative "//" inherits the
    // base's scheme, which the caller gates.
    auto isSlash = [](char16_t ch) { return ch == '/' || ch == '\\'; };
    size_t authorityStart = notFound;
    if (baseHasSpecialScheme && scan + 1 < view.length() && isSlash(view[scan]) && isSlash(view[scan + 1])) {
        authorityStart = scan + 2;
        while (authorityStart < view.length() && isSlash(view[authorityStart]))
            authorityStart++;
    } else {
        size_t colon = view.find(':', scan);
        if (colon != notFound) {
            auto scheme = view.substring(scan, colon - scan);
            if (equalLettersIgnoringASCIICase(scheme, "http"_s) || equalLettersIgnoringASCIICase(scheme, "https"_s)
                || equalLettersIgnoringASCIICase(scheme, "ws"_s) || equalLettersIgnoringASCIICase(scheme, "wss"_s)
                || equalLettersIgnoringASCIICase(scheme, "ftp"_s) || equalLettersIgnoringASCIICase(scheme, "file"_s)) {
                authorityStart = colon + 1;
                while (authorityStart < view.length() && isSlash(view[authorityStart]))
                    authorityStart++;
            }
        }
    }
    if (authorityStart == notFound)
        return {};

    // The authority ends at the first path/query/fragment terminator;
    // backslash terminates it for special schemes and never appears in a
    // valid host, so treating it as a terminator is safe for both kinds.
    size_t authorityEnd = view.length();
    for (size_t i = authorityStart; i < view.length(); i++) {
        char16_t ch = view[i];
        if (ch == '/' || ch == '?' || ch == '#' || ch == '\\') {
            authorityEnd = i;
            break;
        }
    }

    // Userinfo is percent-encoded, not IDNA-mapped, in node too: only the
    // host[:port] span after the last '@' gets the delta. The port is ASCII
    // digits, which the delta maps to themselves.
    size_t hostStart = authorityStart;
    auto authority = view.substring(authorityStart, authorityEnd - authorityStart);
    size_t at = authority.reverseFind('@');
    if (at != notFound)
        hostStart = authorityStart + at + 1;

    auto hostView = view.substring(hostStart, authorityEnd - hostStart);
    if (!Bun::containsUnicode16IDNADeltaSource(hostView))
        return {};

    auto mappedHost = Bun::applyUnicode16IDNADelta(hostView.toString());
    StringBuilder builder;
    builder.append(view.left(hostStart));
    builder.append(mappedHost);
    builder.append(view.substring(authorityEnd));
    return builder.toString();
}

inline DOMURL::DOMURL(URL&& completeURL)
    : m_url(WTF::move(completeURL))
    , m_initialURLCostForGC(static_cast<uint16_t>(std::min<size_t>(m_url.string().impl()->costDuringGC(), std::numeric_limits<uint16_t>::max())))
{
    ASSERT(m_url.isValid());
}

// The Exception message carries the input; the JS error's message stays
// "Invalid URL" and the input surfaces as `error.input` like Node's
// ERR_INVALID_URL (see createDOMException).
ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url)
{
    auto mapped = applyIDNADeltaToURLAuthority(url);
    URL completeURL { mapped.isNull() ? url : mapped };
    if (!completeURL.isValid() || !hasValidParsedHost(completeURL))
        return Exception { InvalidURLError, url };
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const URL& base)
{
    ASSERT(base.isValid() || base.isNull());
    auto mapped = applyIDNADeltaToURLAuthority(url, base.hasSpecialScheme());
    URL completeURL { base, mapped.isNull() ? url : mapped };
    if (!completeURL.isValid() || !hasValidParsedHost(completeURL))
        return Exception { InvalidURLError, url };
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const String& base)
{
    auto mappedBase = applyIDNADeltaToURLAuthority(base);
    URL baseURL { mappedBase.isNull() ? base : mappedBase };
    if (!base.isNull() && (!baseURL.isValid() || !hasValidParsedHost(baseURL)))
        return Exception { InvalidURLError, url };
    return create(url, baseURL);
}

DOMURL::~DOMURL() = default;

static URL parseInternal(const String& url, const String& base)
{
    auto mappedBase = applyIDNADeltaToURLAuthority(base);
    URL baseURL { mappedBase.isNull() ? base : mappedBase };
    if (!base.isNull() && (!baseURL.isValid() || !hasValidParsedHost(baseURL)))
        return {};
    auto mapped = applyIDNADeltaToURLAuthority(url, baseURL.hasSpecialScheme());
    URL result { baseURL, mapped.isNull() ? url : mapped };
    if (result.isValid() && !hasValidParsedHost(result))
        return {};
    return result;
}

RefPtr<DOMURL> DOMURL::parse(const String& url, const String& base)
{
    auto completeURL = parseInternal(url, base);
    if (!completeURL.isValid())
        return {};
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

bool DOMURL::canParse(const String& url, const String& base)
{
    return parseInternal(url, base).isValid();
}

ExceptionOr<void> DOMURL::setHref(const String& url)
{
    auto mapped = applyIDNADeltaToURLAuthority(url);
    URL completeURL { URL {}, mapped.isNull() ? url : mapped };
    if (!completeURL.isValid() || !hasValidParsedHost(completeURL)) {

        return Exception { InvalidURLError, url };
    }
    m_url = WTF::move(completeURL);
    m_searchParamsDirty = false;
    if (m_searchParams)
        m_searchParams->updateFromAssociatedURL();
    return {};
}

// The update steps invoked on URLSearchParams::{append,set,delete,sort} set
// m_searchParamsDirty instead of eagerly re-serializing m_url on every call so
// that N appends through url.searchParams stay O(N) instead of O(N^2). All
// reads of m_url (href/toJSON/fullURL) call this first to reconcile.
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
