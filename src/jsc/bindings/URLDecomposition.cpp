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

namespace WebCore {

// https://url.spec.whatwg.org/#concept-url-origin
String URLDecomposition::origin() const
{
    auto fullURL = this->fullURL();

    // Only "ftp", "http", "https", "ws", and "wss" have a tuple origin. In particular
    // "ftps" is not a special scheme, so its origin is opaque ("null").
    if (fullURL.protocolIsInHTTPFamily() or fullURL.protocolIs("ftp"_s) or fullURL.protocolIs("ws"_s) or fullURL.protocolIs("wss"_s))
        return fullURL.protocolHostAndPort();
    if (fullURL.protocolIsBlob()) {
        const String& path = fullURL.path().toString();
        const URL subUrl { URL {}, path };
        // Only an inner "http" or "https" URL yields a tuple origin for a blob URL. The
        // spec also lists "file", but a file URL's own origin is opaque, so it still
        // serializes as "null".
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

// Scans `value` as the spec's host state would: returns the index of the first ':' that
// is outside an IPv6 '[...]' literal, or notFound if a terminator (/ ? #, plus \ for
// special URLs) or the end of the string comes first.
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

    // With a state override, a file URL's host goes through the file host state, which
    // never splits a trailing ":port" off the value; URL::setHost then rejects the whole
    // assignment because ':' is a forbidden host code point.
    if (fullURL.protocolIsFile()) {
        if (fullURL.setHost(value))
            setFullURL(fullURL);
        return;
    }

    // The host state fails on an empty host for special schemes.
    if (value.isEmpty() && fullURL.hasSpecialScheme())
        return;

    size_t separator = findHostPortSeparator(value, fullURL.hasSpecialScheme());
    if (separator == notFound) {
        // No port part. URL::setHost truncates the value at the terminator itself.
        if (fullURL.setHost(value))
            setFullURL(fullURL);
        return;
    }

    // A ':' with nothing before it fails the whole parse.
    auto hostPart = value.left(separator);
    if (hostPart.isEmpty())
        return;

    // The host state commits the new host before entering the port state, so a port that
    // then turns out to be empty, non-numeric, or out of range still leaves it in place.
    if (!fullURL.setHost(hostPart))
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
        if (fullURL.setHost(value))
            setFullURL(fullURL);
        return;
    }

    if (value.isEmpty() && fullURL.hasSpecialScheme())
        return;

    // Unlike the host state, the hostname state fails outright on a ':' outside an IPv6
    // literal, so both "a:1" and "[::1]:1" must leave the URL untouched.
    if (findHostPortSeparator(value, fullURL.hasSpecialScheme()) != notFound)
        return;

    if (fullURL.setHost(value))
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
        // https://infra.spec.whatwg.org/#ascii-tab-or-newline
        if (c == 0x0009 || c == 0x000A || c == 0x000D)
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
    // The port state fails on an empty buffer when a state override is given, which
    // happens when the whole input was removed as ASCII tab or newline.
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
    // Only the given value being the empty string clears the port. A value that merely
    // becomes empty once the parser strips ASCII tab/newline leaves the port state with
    // an empty buffer, which fails the parse without touching the port.
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
