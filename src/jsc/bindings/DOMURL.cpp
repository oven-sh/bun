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

// Platform ICU may predate Unicode 15.1/16.0 (node v26 uses ada::idna): apply the Unicode 16
// IDNA delta to the host span only when it contains a delta source code point. Returns a null
// String when no rewrite is needed (the common path). See NodeURL.cpp for the delta table.
static String applyIDNADeltaToURLAuthority(const String& urlString, StringView specialBaseScheme = {})
{
    // Percent-encoded delta sources are all-ASCII and intentionally excluded; the durable fix
    // is bundling Unicode-16 ICU data so the parser's own domain-to-ASCII handles it uniformly.
    if (urlString.is8Bit() || !urlString.length())
        return {};

    StringView view { urlString };

    // Mirror https://url.spec.whatwg.org/#concept-basic-url-parser steps 1/3 (strip C0/tab/CR/LF)
    // so an embedded tab in the scheme or `//` run does not defeat the special-scheme match below.
    auto isTabOrNewline = [](char16_t ch) { return ch == '\t' || ch == '\n' || ch == '\r'; };
    String stripped;
    if (view.find(isTabOrNewline) != notFound) {
        stripped = urlString.removeCharacters(isTabOrNewline);
        view = stripped;
    }
    size_t scan = 0;
    while (scan < view.length() && (view[scan] <= 0x20))
        scan++;

    // Only the six special schemes run IDNA (https://url.spec.whatwg.org/#special-scheme). The
    // special-authority-ignore-slashes state consumes any '/'|'\\' run after ':'; same-scheme-as-base
    // without "//" enters the relative state (path, not host). Scheme-relative "//" inherits base.
    auto isSlash = [](char16_t ch) { return ch == '/' || ch == '\\'; };
    // file: routes through file state/file slash state/file host state: only
    // exactly two slashes then a non-slash introduce a host; file:///x and
    // file:/x have an empty host and `x` is a path segment.
    auto locateAuthority = [&](size_t afterColon, bool isFile) -> size_t {
        const bool hasDoubleSlash = afterColon + 1 < view.length()
            && isSlash(view[afterColon]) && isSlash(view[afterColon + 1]);
        if (isFile) {
            if (!hasDoubleSlash)
                return notFound;
            size_t start = afterColon + 2;
            if (start < view.length() && isSlash(view[start]))
                return notFound;
            return start;
        }
        size_t start = afterColon;
        while (start < view.length() && isSlash(view[start]))
            start++;
        return start;
    };
    size_t authorityStart = notFound;
    if (!specialBaseScheme.isEmpty() && scan + 1 < view.length() && isSlash(view[scan]) && isSlash(view[scan + 1])) {
        authorityStart = locateAuthority(scan, equalLettersIgnoringASCIICase(specialBaseScheme, "file"_s));
    } else {
        size_t colon = view.find(':', scan);
        if (colon != notFound) {
            auto scheme = view.substring(scan, colon - scan);
            const bool isFile = equalLettersIgnoringASCIICase(scheme, "file"_s);
            if (equalLettersIgnoringASCIICase(scheme, "http"_s) || equalLettersIgnoringASCIICase(scheme, "https"_s)
                || equalLettersIgnoringASCIICase(scheme, "ws"_s) || equalLettersIgnoringASCIICase(scheme, "wss"_s)
                || equalLettersIgnoringASCIICase(scheme, "ftp"_s) || isFile) {
                size_t afterColon = colon + 1;
                const bool hasDoubleSlash = afterColon + 1 < view.length()
                    && isSlash(view[afterColon]) && isSlash(view[afterColon + 1]);
                // Same scheme as the base and no "//" → relative-state path,
                // not an authority; the delta must not touch it.
                if (!hasDoubleSlash && equalIgnoringASCIICase(scheme, specialBaseScheme))
                    return {};
                authorityStart = locateAuthority(afterColon, isFile);
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
    // host span after the last '@' gets the delta.
    size_t hostStart = authorityStart;
    auto authority = view.substring(authorityStart, authorityEnd - authorityStart);
    size_t at = authority.reverseFind('@');
    if (at != notFound)
        hostStart = authorityStart + at + 1;

    // A '['-prefixed host goes straight to the IPv6 parser and never runs
    // domain-to-ASCII; leave it untouched so the parser sees the original.
    if (hostStart < view.length() && view[hostStart] == '[')
        return {};

    // Port span must stay verbatim: the delta strips ignored-class code points, which would turn
    // an invalid non-digit port char into a valid port. Last ':' is the port separator here.
    auto hostAndPort = view.substring(hostStart, authorityEnd - hostStart);
    size_t portColon = hostAndPort.reverseFind(':');
    size_t hostEnd = portColon == notFound ? authorityEnd : hostStart + portColon;

    auto hostView = view.substring(hostStart, hostEnd - hostStart);
    if (!Bun::containsUnicode16IDNADeltaSource(hostView))
        return {};

    auto mappedHost = Bun::applyUnicode16IDNADelta(hostView.toString());
    StringBuilder builder;
    builder.append(view.left(hostStart));
    builder.append(mappedHost);
    builder.append(view.substring(hostEnd));
    return builder.toString();
}

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
    auto mapped = applyIDNADeltaToURLAuthority(url);
    URL completeURL { mapped.isNull() ? url : mapped };
    if (!completeURL.isValid() || !hasValidParsedHost(completeURL))
        return Exception { InvalidURLError, url };
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const URL& base, const String& baseInput)
{
    ASSERT(base.isValid() || base.isNull());
    auto mapped = applyIDNADeltaToURLAuthority(url, base.hasSpecialScheme() ? base.protocol() : StringView {});
    URL completeURL { base, mapped.isNull() ? url : mapped };
    if (!completeURL.isValid() || !hasValidParsedHost(completeURL))
        return Exception { InvalidURLError, url, baseInput };
    return adoptRef(*new DOMURL(WTF::move(completeURL)));
}

ExceptionOr<Ref<DOMURL>> DOMURL::create(const String& url, const String& base)
{
    auto mappedBase = applyIDNADeltaToURLAuthority(base);
    URL baseURL { mappedBase.isNull() ? base : mappedBase };
    if (!base.isNull() && (!baseURL.isValid() || !hasValidParsedHost(baseURL)))
        return Exception { InvalidURLError, url, base };
    return create(url, baseURL, base);
}

DOMURL::~DOMURL() = default;

static URL parseInternal(const String& url, const String& base)
{
    auto mappedBase = applyIDNADeltaToURLAuthority(base);
    URL baseURL { mappedBase.isNull() ? base : mappedBase };
    if (!base.isNull() && (!baseURL.isValid() || !hasValidParsedHost(baseURL)))
        return {};
    auto mapped = applyIDNADeltaToURLAuthority(url, baseURL.hasSpecialScheme() ? baseURL.protocol() : StringView {});
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

URLSearchParams& DOMURL::searchParams()
{
    if (!m_searchParams)
        m_searchParams = URLSearchParams::create(search(), this);
    return *m_searchParams;
}

} // namespace WebCore
