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

#include "wtf/text/StringToIntegerConversion.h"

namespace WebCore {

String URLDecomposition::origin() const
{
    auto fullURL = this->fullURL();
    auto protocol = fullURL.protocol();
    auto host = fullURL.host();
    auto port = fullURL.port();

    if (protocol == "file"_s)
        return "file://"_s;

    if (protocol.isEmpty() && host.isEmpty())
        return {};

    if (!port)
        return makeString(protocol, "://", host);

    return makeString(protocol, "://", host, ':', static_cast<uint32_t>(*port));
}

String URLDecomposition::protocol() const
{
    auto fullURL = this->fullURL();
    if (WTF::protocolIsJavaScript(fullURL.string()))
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
    if (fullURL.host().isEmpty() || fullURL.cannotBeABaseURL() || fullURL.protocolIs("file"_s))
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
    if (fullURL.host().isEmpty() || fullURL.cannotBeABaseURL() || fullURL.protocolIs("file"_s))
        return;
    fullURL.setPassword(password);
    setFullURL(fullURL);
}

String URLDecomposition::host() const
{
    return fullURL().hostAndPort();
}

static unsigned countASCIIDigits(StringView string)
{
    unsigned length = string.length();
    for (unsigned count = 0; count < length; ++count) {
        if (!isASCIIDigit(string[count]))
            return count;
    }
    return length;
}

void URLDecomposition::setHost(StringView value)
{
    auto fullURL = this->fullURL();
    if (value.isEmpty() && !fullURL.protocolIs("file"_s) && fullURL.hasSpecialScheme())
        return;

    size_t separator = value.reverseFind(':');
    if (!separator)
        return;

    if (fullURL.cannotBeABaseURL() || !fullURL.canSetHostOrPort())
        return;

    // No port if no colon or rightmost colon is within the IPv6 section.
    size_t ipv6Separator = value.reverseFind(']');
    if (separator == notFound || (ipv6Separator != notFound && ipv6Separator > separator))
        fullURL.setHost(value);
    else {
        // Multiple colons are acceptable only in case of IPv6.
        if (value.find(':') != separator && ipv6Separator == notFound)
            return;
        unsigned portLength = countASCIIDigits(value.substring(separator + 1));
        if (!portLength) {
            fullURL.setHost(value.substring(0, separator));
        } else {
            auto portNumber = parseInteger<uint16_t>(value.substring(separator + 1, portLength));
            if (portNumber && WTF::isDefaultPortForProtocol(*portNumber, fullURL.protocol()))
                fullURL.setHostAndPort(value.substring(0, separator));
            else
                fullURL.setHostAndPort(value.substring(0, separator + 1 + portLength));
        }
    }
    if (fullURL.isValid())
        setFullURL(fullURL);
}

String URLDecomposition::hostname() const
{
    return fullURL().host().toString();
}

static StringView removeAllLeadingSolidusCharacters(StringView string)
{
    unsigned i;
    unsigned length = string.length();
    for (i = 0; i < length; ++i) {
        if (string[i] != '/')
            break;
    }
    return string.substring(i);
}

void URLDecomposition::setHostname(StringView value)
{
    auto fullURL = this->fullURL();
    auto host = removeAllLeadingSolidusCharacters(value);
    if (host.isEmpty() && !fullURL.protocolIs("file"_s) && fullURL.hasSpecialScheme())
        return;
    if (fullURL.cannotBeABaseURL() || !fullURL.canSetHostOrPort())
        return;
    fullURL.setHost(host);
    if (fullURL.isValid())
        setFullURL(fullURL);
}

String URLDecomposition::port() const
{
    auto port = fullURL().port();
    if (!port)
        return emptyString();
    return String::number(*port);
}

// Outer optional is whether we could parse at all. Inner optional is "no port specified".
static std::optional<std::optional<uint16_t>> parsePort(StringView string, StringView protocol)
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
    if (!foundDigit || WTF::isDefaultPortForProtocol(static_cast<uint16_t>(port), protocol))
        return std::optional<uint16_t> { std::nullopt };
    return { { static_cast<uint16_t>(port) } };
}

void URLDecomposition::setPort(StringView value)
{
    auto fullURL = this->fullURL();
    if (fullURL.host().isEmpty() || fullURL.cannotBeABaseURL() || fullURL.protocolIs("file"_s) || !fullURL.canSetHostOrPort())
        return;
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
    if (fullURL.cannotBeABaseURL() || !fullURL.canSetPathname())
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
        String newSearch = value;
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
