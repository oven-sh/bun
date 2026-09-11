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
#include "VectorSizeLimit.h"
#include <unicode/utf16.h>
#include <wtf/URLParser.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace WebCore {

// Like the URL constructor (DOMURL.cpp), reject special-scheme hosts whose
// xn-- labels fail UTS #46; the WHATWG setters fail silently, so refuse the
// commit instead of throwing.
static bool hasAcceptableHost(const WTF::URL& url)
{
    return Bun::hasValidPunycodeHost(url.host()) || !url.hasSpecialScheme();
}

// The WTF::URL setters build the new serialization with makeString(), which
// aborts when the result is longer than String::MaxLength. URLParser then aborts
// when percent-encoding makes its output longer than that. The setters below
// work out an upper bound of the result's length first and throw
// ERR_STRING_TOO_LONG instead, as Node.js does.
// Bun__stringSyntheticAllocationLimit lowers the bound so that tests reach it.
static size_t maximumURLLength()
{
    return std::min<size_t>(String::MaxLength, Bun__stringSyntheticAllocationLimit);
}

// Cheap test that no setter can make the URL too long with this value, so that
// only a huge value is ever scanned. One UTF-16 code unit becomes at most nine
// characters ("%XX" for each of three UTF-8 bytes). The constant covers what a
// setter writes besides the value: separators, a port, and the IDNA buffer.
static bool isShortEnough(const URL& url, StringView value)
{
    return url.string().length() + 9 * static_cast<size_t>(value.length()) + WTF::URLParser::hostnameBufferLength + 16 <= maximumURLLength();
}

// Whether url.string() still has a valid length after a setter replaces
// `removedLength` of its characters with `addedLength` new ones.
static bool fits(const URL& url, size_t removedLength, size_t addedLength)
{
    ASSERT(removedLength <= url.string().length());
    return url.string().length() - removedLength + addedLength <= maximumURLLength();
}

// The length of `characters` after the URL parser has percent-encoded, as UTF-8,
// every code point that is not ASCII and every ASCII character in the set.
template<typename CharacterType, typename EncodeSet>
static size_t percentEncodedLength(std::span<const CharacterType> characters, const EncodeSet& isInEncodeSet)
{
    size_t length = 0;
    for (size_t i = 0; i < characters.size(); ++i) {
        auto character = characters[i];
        if (isASCII(character))
            length += isInEncodeSet(character) ? 3 : 1;
        else if constexpr (sizeof(CharacterType) == 1)
            length += 6;
        else if (character < 0x800)
            length += 6;
        else if (U16_IS_LEAD(character) && i + 1 < characters.size() && U16_IS_TRAIL(characters[i + 1])) {
            length += 12;
            ++i;
        } else {
            // Three UTF-8 bytes. The parser writes an unpaired surrogate as "%EF%BF%BD".
            length += 9;
        }
    }
    return length;
}

template<typename EncodeSet>
static size_t percentEncodedLength(StringView string, const EncodeSet& isInEncodeSet)
{
    if (string.is8Bit())
        return percentEncodedLength(string.span8(), isInEncodeSet);
    return percentEncodedLength(string.span16(), isInEncodeSet);
}

// For a setter that replaces `removedLength` characters of url.string() with
// the percent-encoded `value` and at most `separatorsLength` more characters.
template<typename EncodeSet>
static bool fitsPercentEncoded(const URL& url, size_t removedLength, size_t separatorsLength, StringView value, const EncodeSet& isInEncodeSet)
{
    // Encoding never makes the value shorter, so a value that is too long as it is needs no scan.
    return fits(url, removedLength, separatorsLength + value.length())
        && fits(url, removedLength, separatorsLength + percentEncodedLength(value, isInEncodeSet));
}

// https://url.spec.whatwg.org/#c0-control-percent-encode-set
static bool isInC0ControlEncodeSet(char16_t character)
{
    return character < ' ' || character == 0x7F;
}

// https://url.spec.whatwg.org/#fragment-percent-encode-set
static bool isInFragmentEncodeSet(char16_t character)
{
    return isInC0ControlEncodeSet(character) || character == ' ' || character == '"' || character == '<' || character == '>' || character == '`';
}

// https://url.spec.whatwg.org/#query-percent-encode-set
static bool isInQueryEncodeSet(char16_t character)
{
    return isInC0ControlEncodeSet(character) || character == ' ' || character == '"' || character == '#' || character == '<' || character == '>';
}

// https://url.spec.whatwg.org/#special-query-percent-encode-set
static bool isInSpecialQueryEncodeSet(char16_t character)
{
    return isInQueryEncodeSet(character) || character == '\'';
}

// https://url.spec.whatwg.org/#path-percent-encode-set
static bool isInPathEncodeSet(char16_t character)
{
    return isInQueryEncodeSet(character) || character == '?' || character == '^' || character == '`' || character == '{' || character == '}';
}

// https://url.spec.whatwg.org/#userinfo-percent-encode-set
static bool isInUserInfoEncodeSet(char16_t character)
{
    return isInPathEncodeSet(character) || character == '/' || character == ':' || character == ';' || character == '=' || character == '@' || (character >= '[' && character <= ']') || character == '|';
}

// For URL::setHost() and URL::setHostAndPort(), which replace the host with
// `value` and write at most `separatorsLength` characters around it.
static bool hostFits(const URL& url, StringView value, size_t separatorsLength)
{
    bool isSpecial = url.hasSpecialScheme();
    // Both take the host only up to the first character that ends one.
    size_t end = value.find([isSpecial](char16_t character) {
        return character == '/' || character == '?' || character == '#' || (character == '\\' && isSpecial);
    });
    StringView host = end == notFound ? value : value.left(end);
    // An opaque host is percent-encoded and otherwise kept as it is.
    if (!isSpecial)
        return fitsPercentEncoded(url, url.host().length(), separatorsLength, host, isInC0ControlEncodeSet);
    // Both copy a special host into a Vector<char16_t> (appendEncodedHostname() in wtf/URL.cpp).
    if (host.length() > Bun::maxVectorSize<char16_t>())
        return false;
    // A special host is never longer than it was, except when IDNA or the IPv4
    // and IPv6 serializers rewrite it. IDNA writes into a buffer of
    // hostnameBufferLength characters, and the host is invalid when it does not fit.
    return fits(url, url.host().length(), separatorsLength + std::max<size_t>(host.length(), WTF::URLParser::hostnameBufferLength));
}

String URLDecomposition::origin() const
{
    auto fullURL = this->fullURL();

    if (fullURL.protocolIsInHTTPFamily() or fullURL.protocolIsInFTPFamily() or fullURL.protocolIs("ws"_s) or fullURL.protocolIs("wss"_s))
        return fullURL.protocolHostAndPort();
    if (fullURL.protocolIsBlob()) {
        const String& path = fullURL.path().toString();
        const URL subUrl { URL {}, path };
        if (subUrl.isValid()) {
            if (subUrl.protocolIsInHTTPFamily() or subUrl.protocolIsInFTPFamily() or subUrl.protocolIs("ws"_s) or subUrl.protocolIs("wss"_s) or subUrl.protocolIsFile())
                return subUrl.protocolHostAndPort();
        }
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

ExceptionOr<void> URLDecomposition::setProtocol(StringView value)
{
    URL copy = fullURL();
    if (!isShortEnough(copy, value)) [[unlikely]] {
        // URL::setProtocol() takes the value up to the first ':' as the scheme. It
        // gives a special URL only another special scheme, and "https" is the longest.
        size_t schemeLength = std::min<size_t>(value.find(':'), value.length());
        if (!fits(copy, copy.protocol().length(), copy.hasSpecialScheme() ? std::min<size_t>(schemeLength, 5) : schemeLength))
            return Exception { ExceptionCode::StringTooLongError };
    }
    copy.setProtocol(value);
    setFullURL(copy);
    return {};
}

String URLDecomposition::username() const
{
    return fullURL().encodedUser().toString();
}

ExceptionOr<void> URLDecomposition::setUsername(StringView user)
{
    auto fullURL = this->fullURL();
    if (fullURL.host().isEmpty() || fullURL.protocolIsFile())
        return {};
    // URL::setUser() writes at most '@' after the user.
    if (!isShortEnough(fullURL, user) && !fitsPercentEncoded(fullURL, fullURL.encodedUser().length(), 1, user, isInUserInfoEncodeSet)) [[unlikely]]
        return Exception { ExceptionCode::StringTooLongError };
    fullURL.setUser(user);
    setFullURL(fullURL);
    return {};
}

String URLDecomposition::password() const
{
    return fullURL().encodedPassword().toString();
}

ExceptionOr<void> URLDecomposition::setPassword(StringView password)
{
    auto fullURL = this->fullURL();
    if (fullURL.host().isEmpty() || fullURL.protocolIsFile())
        return {};
    // URL::setPassword() writes at most ':' before the password and '@' after it.
    if (!isShortEnough(fullURL, password) && !fitsPercentEncoded(fullURL, fullURL.encodedPassword().length(), 2, password, isInUserInfoEncodeSet)) [[unlikely]]
        return Exception { ExceptionCode::StringTooLongError };
    fullURL.setPassword(password);
    setFullURL(fullURL);
    return {};
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

ExceptionOr<void> URLDecomposition::setHost(StringView value)
{
    auto fullURL = this->fullURL();
    if (value.isEmpty() && !fullURL.protocolIsFile() && fullURL.hasSpecialScheme())
        return {};

    size_t separator = value.reverseFind(':');
    if (!separator)
        return {};

    if (fullURL.hasOpaquePath())
        return {};

    // Every branch below hands a prefix of `value` to URL::setHost() or
    // URL::setHostAndPort(). They write "//" before the host when the URL had no
    // authority, and setHostAndPort() writes at most ":65535" after it.
    if (!isShortEnough(fullURL, value) && !hostFits(fullURL, value, 2 + 6)) [[unlikely]]
        return Exception { ExceptionCode::StringTooLongError };

    // No port if no colon or rightmost colon is within the IPv6 section.
    size_t ipv6Separator = value.reverseFind(']');
    if (separator == notFound || (ipv6Separator != notFound && ipv6Separator > separator))
        fullURL.setHost(value);
    else {
        // Multiple colons are acceptable only in case of IPv6.
        if (value.find(':') != separator && ipv6Separator == notFound)
            return {};
        unsigned portLength = countASCIIDigits(value.substring(separator + 1));
        if (!portLength) {
            fullURL.setHost(value.left(separator));
        } else {
            auto portNumber = parseInteger<uint16_t>(value.substring(separator + 1, portLength));
            if (portNumber && WTF::isDefaultPortForProtocol(*portNumber, fullURL.protocol()))
                fullURL.setHostAndPort(value.left(separator));
            else
                fullURL.setHostAndPort(value.left(separator + 1 + portLength));
        }
    }
    if (fullURL.isValid() && hasAcceptableHost(fullURL))
        setFullURL(fullURL);
    return {};
}

String URLDecomposition::hostname() const
{
    return fullURL().host().toString();
}

ExceptionOr<void> URLDecomposition::setHostname(StringView host)
{
    auto fullURL = this->fullURL();
    if (host.isEmpty() && !fullURL.protocolIsFile() && fullURL.hasSpecialScheme())
        return {};
    if (fullURL.hasOpaquePath())
        return {};
    // URL::setHost() writes "//" before the host when the URL had no authority.
    if (!isShortEnough(fullURL, host) && !hostFits(fullURL, host, 2)) [[unlikely]]
        return Exception { ExceptionCode::StringTooLongError };
    fullURL.setHost(host);
    if (fullURL.isValid() && hasAcceptableHost(fullURL))
        setFullURL(fullURL);
    return {};
}

String URLDecomposition::port() const
{
    auto port = fullURL().port();
    if (!port)
        return emptyString();
    return String::number(*port);
}

// Outer optional is whether we could parse at all. Inner optional is "no port specified".
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
    if (!foundDigit || WTF::isDefaultPortForProtocol(static_cast<uint16_t>(port), protocol))
        return std::optional<uint16_t> { std::nullopt };
    return { { static_cast<uint16_t>(port) } };
}

ExceptionOr<void> URLDecomposition::setPort(StringView value)
{
    auto fullURL = this->fullURL();
    if (fullURL.host().isEmpty() || fullURL.protocolIsFile())
        return {};
    auto port = parsePort(value, fullURL.protocol());
    if (!port)
        return {};
    // URL::setPort() writes at most ":65535".
    if (!isShortEnough(fullURL, value) && !fits(fullURL, 0, 6)) [[unlikely]]
        return Exception { ExceptionCode::StringTooLongError };
    fullURL.setPort(*port);
    setFullURL(fullURL);
    return {};
}

String URLDecomposition::pathname() const
{
    return fullURL().path().toString();
}

ExceptionOr<void> URLDecomposition::setPathname(StringView value)
{
    auto fullURL = this->fullURL();
    if (fullURL.hasOpaquePath())
        return {};
    // URL::setPath() writes at most "/" and "/." before the path.
    if (!isShortEnough(fullURL, value) && !fitsPercentEncoded(fullURL, fullURL.path().length(), 3, value, isInPathEncodeSet)) [[unlikely]]
        return Exception { ExceptionCode::StringTooLongError };
    fullURL.setPath(value);
    setFullURL(fullURL);
    return {};
}

String URLDecomposition::search() const
{
    auto fullURL = this->fullURL();
    return fullURL.query().isEmpty() ? emptyString() : fullURL.queryWithLeadingQuestionMark().toString();
}

ExceptionOr<void> URLDecomposition::setSearch(const String& value)
{
    auto fullURL = this->fullURL();
    if (value.isEmpty()) {
        // If the given value is the empty string, set url's query to null.
        fullURL.setQuery({});
    } else {
        // URL::setQuery() writes '?' before a value that does not start with one.
        // The query percent-encode set holds the '#' that is replaced below.
        if (!isShortEnough(fullURL, value) && !fitsPercentEncoded(fullURL, fullURL.queryWithLeadingQuestionMark().length(), 1, value, fullURL.hasSpecialScheme() ? isInSpecialQueryEncodeSet : isInQueryEncodeSet)) [[unlikely]]
            return Exception { ExceptionCode::StringTooLongError };
        // Make sure that '#' in the query does not leak to the hash.
        fullURL.setQuery(makeStringByReplacingAll(value, '#', "%23"_s));
    }
    setFullURL(fullURL);
    return {};
}

String URLDecomposition::hash() const
{
    auto fullURL = this->fullURL();
    return fullURL.fragmentIdentifier().isEmpty() ? emptyString() : fullURL.fragmentIdentifierWithLeadingNumberSign().toString();
}

ExceptionOr<void> URLDecomposition::setHash(StringView value)
{
    auto fullURL = this->fullURL();
    if (value.isEmpty())
        fullURL.removeFragmentIdentifier();
    else {
        auto identifier = value.startsWith('#') ? value.substring(1) : value;
        // URL::setFragmentIdentifier() writes '#' before the identifier.
        if (!isShortEnough(fullURL, identifier) && !fitsPercentEncoded(fullURL, fullURL.fragmentIdentifierWithLeadingNumberSign().length(), 1, identifier, isInFragmentEncodeSet)) [[unlikely]]
            return Exception { ExceptionCode::StringTooLongError };
        fullURL.setFragmentIdentifier(identifier);
    }
    setFullURL(fullURL);
    return {};
}

}
