/*
 * Copyright (C) 2014-2020 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "URLDecomposition.h"

#include "NodeURLHelpers.h"

namespace WebCore {

// Like the URL constructor (DOMURL.cpp), reject special-scheme hosts whose
// xn-- labels fail UTS #46; the WHATWG setters fail silently, so refuse the
// commit instead of throwing.
static bool hasAcceptableHost(const WTF::URL& url)
{
    return Bun::hasValidPunycodeHost(url.host()) || !url.hasSpecialScheme();
}

static bool setHostChecked(WTF::URL& url, StringView host)
{
    return url.setHost(host) && hasAcceptableHost(url);
}

// https://infra.spec.whatwg.org/#ascii-tab-or-newline; the URL parser removes these before parsing.
static bool isASCIITabOrNewline(char16_t c)
{
    return c == 0x0009 || c == 0x000A || c == 0x000D;
}

// https://url.spec.whatwg.org/#concept-url-origin
String URLDecomposition::origin() const
{
    auto fullURL = this->fullURL();

    // Not protocolIsInFTPFamily(): "ftps" is not a special scheme, so its origin is opaque.
    if (fullURL.protocolIsInHTTPFamily() or fullURL.protocolIs("ftp"_s) or fullURL.protocolIs("ws"_s) or fullURL.protocolIs("wss"_s))
        return fullURL.protocolHostAndPort();
    if (fullURL.protocolIsBlob()) {
        const String& path = fullURL.path().toString();
        const URL subUrl { URL {}, path };
        // The spec also lists "file" here, but a file URL's own origin is opaque anyway.
        if (subUrl.isValid() && subUrl.protocolIsInHTTPFamily())
            return subUrl.protocolHostAndPort();
    }
    return "null"_s;
}

String URLDecomposition::protocol() const
{
    auto fullURL = this->fullURL();
    if (fullURL.protocolIsJavaScript())
        return "javascript:"_s;
    return makeString(fullURL.protocol(), ':');
}

void URLDecomposition::setProtocol(StringView value)
{
    URL copy = fullURL();
    copy.setProtocol(value);
    setFullURL(copy);
}

String URLDecomposition::username() const
{
    return fullURL().encodedUser().toString();
}

void URLDecomposition::setUsername(StringView user)
{
    auto fullURL = this->fullURL();
    if (fullURL.host().isEmpty() || fullURL.protocolIsFile())
        return;
    fullURL.setUser(user);
    setFullURL(fullURL);
}

String URLDecomposition::password() const
{
    return fullURL().encodedPassword().toString();
}

void URLDecomposition::setPassword(StringView password)
{
    auto fullURL = this->fullURL();
    if (fullURL.host().isEmpty() || fullURL.protocolIsFile())
        return;
    fullURL.setPassword(password);
    setFullURL(fullURL);
}

String URLDecomposition::host() const
{
    return fullURL().hostAndPort();
}

// Index of the ':' where the spec's host state would enter the port state, or notFound.
static size_t findHostPortSeparator(StringView value, bool isSpecial)
{
    bool insideBrackets = false;
    for (unsigned i = 0; i < value.length(); ++i) {
        auto c = value[i];
        if (c == ':' && !insideBrackets)
            return i;
        if (c == '/' || c == '?' || c == '#' || (isSpecial && c == '\\'))
            return notFound;
        if (c == '[')
            insideBrackets = true;
        else if (c == ']')
            insideBrackets = false;
    }
    return notFound;
}

// https://url.spec.whatwg.org/#dom-url-host
void URLDecomposition::setHost(StringView value)
{
    auto fullURL = this->fullURL();
    if (fullURL.hasOpaquePath())
        return;

    // The file host state has no port state, so any ':' in the value fails the whole assignment.
    if (fullURL.protocolIsFile()) {
        if (setHostChecked(fullURL, value))
            setFullURL(fullURL);
        return;
    }

    // The host state fails on an empty host for special schemes.
    if (value.isEmpty() && fullURL.hasSpecialScheme())
        return;

    size_t separator = findHostPortSeparator(value, fullURL.hasSpecialScheme());
    if (separator == notFound) {
        // No port part. URL::setHost truncates the value at the terminator itself.
        if (setHostChecked(fullURL, value))
            setFullURL(fullURL);
        return;
    }

    // A ':' with nothing before it fails the whole parse.
    auto hostPart = value.left(separator);
    if (hostPart.containsOnly<isASCIITabOrNewline>())
        return;

    // The host is committed before the port is parsed, so an invalid port keeps the old one.
    if (!setHostChecked(fullURL, hostPart))
        return;
    if (auto port = parsePort(value.substring(separator + 1), fullURL.protocol()))
        fullURL.setPort(*port);
    if (fullURL.isValid())
        setFullURL(fullURL);
}

String URLDecomposition::hostname() const
{
    return fullURL().host().toString();
}

// https://url.spec.whatwg.org/#dom-url-hostname
void URLDecomposition::setHostname(StringView value)
{
    auto fullURL = this->fullURL();
    if (fullURL.hasOpaquePath())
        return;

    if (fullURL.protocolIsFile()) {
        if (setHostChecked(fullURL, value))
            setFullURL(fullURL);
        return;
    }

    if (value.isEmpty() && fullURL.hasSpecialScheme())
        return;

    // Unlike the host state, the hostname state fails on a ':' instead of parsing a port.
    if (findHostPortSeparator(value, fullURL.hasSpecialScheme()) != notFound)
        return;

    if (setHostChecked(fullURL, value))
        setFullURL(fullURL);
}

String URLDecomposition::port() const
{
    auto port = fullURL().port();
    if (!port)
        return emptyString();
    return String::number(*port);
}

std::optional<std::optional<uint16_t>> URLDecomposition::parsePort(StringView string, StringView protocol)
{
    // https://url.spec.whatwg.org/#port-state with state override given.
    uint32_t port { 0 };
    bool foundDigit = false;
    for (size_t i = 0; i < string.length(); ++i) {
        auto c = string[i];
        if (isASCIITabOrNewline(c))
            continue;
        if (isASCIIDigit(c)) {
            port = port * 10 + c - '0';
            foundDigit = true;
            if (port > std::numeric_limits<uint16_t>::max())
                return std::nullopt;
            continue;
        }
        if (!foundDigit)
            return std::nullopt;
        break;
    }
    // With a state override, an empty buffer (e.g. the input was all tab/newline) is a failure.
    if (!foundDigit)
        return std::nullopt;
    if (WTF::isDefaultPortForProtocol(static_cast<uint16_t>(port), protocol))
        return std::optional<uint16_t> { std::nullopt };
    return { { static_cast<uint16_t>(port) } };
}

// https://url.spec.whatwg.org/#dom-url-port
void URLDecomposition::setPort(StringView value)
{
    auto fullURL = this->fullURL();
    if (fullURL.host().isEmpty() || fullURL.protocolIsFile())
        return;
    // Only a literally empty value clears the port; "\t\n" reaches parsePort and fails instead.
    if (value.isEmpty()) {
        fullURL.setPort(std::nullopt);
        setFullURL(fullURL);
        return;
    }
    auto port = parsePort(value, fullURL.protocol());
    if (!port)
        return;
    fullURL.setPort(*port);
    setFullURL(fullURL);
}

String URLDecomposition::pathname() const
{
    return fullURL().path().toString();
}

void URLDecomposition::setPathname(StringView value)
{
    auto fullURL = this->fullURL();
    if (fullURL.hasOpaquePath())
        return;
    fullURL.setPath(value);
    setFullURL(fullURL);
}

String URLDecomposition::search() const
{
    auto fullURL = this->fullURL();
    return fullURL.query().isEmpty() ? emptyString() : fullURL.queryWithLeadingQuestionMark().toString();
}

void URLDecomposition::setSearch(const String& value)
{
    auto fullURL = this->fullURL();
    if (value.isEmpty()) {
        // If the given value is the empty string, set url's query to null.
        fullURL.setQuery({});
    } else {
        // Make sure that '#' in the query does not leak to the hash.
        fullURL.setQuery(makeStringByReplacingAll(value, '#', "%23"_s));
    }
    setFullURL(fullURL);
}

String URLDecomposition::hash() const
{
    auto fullURL = this->fullURL();
    return fullURL.fragmentIdentifier().isEmpty() ? emptyString() : fullURL.fragmentIdentifierWithLeadingNumberSign().toString();
}

void URLDecomposition::setHash(StringView value)
{
    auto fullURL = this->fullURL();
    if (value.isEmpty())
        fullURL.removeFragmentIdentifier();
    else
        fullURL.setFragmentIdentifier(value.startsWith('#') ? value.substring(1) : value);
    setFullURL(fullURL);
}

}
