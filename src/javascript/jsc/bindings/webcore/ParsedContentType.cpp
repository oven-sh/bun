 /*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2012 Intel Corporation. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "ParsedContentType.h"

#include "HTTPParsers.h"
#include <wtf/text/CString.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

static void skipSpaces(StringView input, unsigned& startIndex)
{
    while (startIndex < input.length() && isHTTPSpace(input[startIndex]))
        ++startIndex;
}

static bool isQuotedStringTokenCharacter(UChar c)
{
    return (c >= ' ' && c <= '~') || (c >= 0x80 && c <= 0xFF) || c == '\t';
}

static bool isTokenCharacter(UChar c)
{
    return isASCII(c) && c > ' ' && c != '"' && c != '(' && c != ')' && c != ',' && c != '/' && (c < ':' || c > '@') && (c < '[' || c > ']');
}

using CharacterMeetsCondition = bool (*)(UChar);

static StringView parseToken(StringView input, unsigned& startIndex, CharacterMeetsCondition characterMeetsCondition, Mode mode, bool skipTrailingWhitespace = false)
{
    unsigned inputLength = input.length();
    unsigned tokenStart = startIndex;
    unsigned& tokenEnd = startIndex;

    if (tokenEnd >= inputLength)
        return StringView();

    while (tokenEnd < inputLength && characterMeetsCondition(input[tokenEnd])) {
        if (mode == Mode::Rfc2045 && !isTokenCharacter(input[tokenEnd]))
            break;
        ++tokenEnd;
    }

    if (tokenEnd == tokenStart)
        return StringView();
    if (skipTrailingWhitespace) {
        if (mode == Mode::Rfc2045) {
            while (input[tokenEnd - 1] == ' ')
                --tokenEnd;
        } else {
            while (isHTTPSpace(input[tokenEnd - 1]))
                --tokenEnd;
        }
    }
    return input.substring(tokenStart, tokenEnd - tokenStart);
}

static bool isNotQuoteOrBackslash(UChar ch)
{
    return ch != '"' && ch != '\\';
}

static String collectHTTPQuotedString(StringView input, unsigned& startIndex)
{
    ASSERT(input[startIndex] == '"');
    unsigned inputLength = input.length();
    unsigned& position = startIndex;
    position++;
    StringBuilder builder;
    while (true) {
        unsigned positionStart = position;
        parseToken(input, position, isNotQuoteOrBackslash, Mode::MimeSniff);
        builder.append(input.substring(positionStart, position - positionStart));
        if (position >= inputLength)
            break;
        UChar quoteOrBackslash = input[position++];
        if (quoteOrBackslash == '\\') {
            if (position >= inputLength) {
                builder.append(quoteOrBackslash);
                break;
            }
            builder.append(input[position++]);
        } else {
            ASSERT(quoteOrBackslash == '"');
            break;
        }

    }
    return builder.toString();
}

static bool containsNonTokenCharacters(StringView input, Mode mode)
{
    if (mode == Mode::MimeSniff)
        return !isValidHTTPToken(input);
    for (unsigned index = 0; index < input.length(); ++index) {
        if (!isTokenCharacter(input[index]))
            return true;
    }
    return false;
}

static StringView parseQuotedString(StringView input, unsigned& startIndex)
{
    unsigned inputLength = input.length();
    unsigned quotedStringStart = startIndex + 1;
    unsigned& quotedStringEnd = startIndex;

    if (quotedStringEnd >= inputLength)
        return StringView();

    if (input[quotedStringEnd++] != '"' || quotedStringEnd >= inputLength)
        return StringView();

    bool lastCharacterWasBackslash = false;
    char currentCharacter;
    while ((currentCharacter = input[quotedStringEnd++]) != '"' || lastCharacterWasBackslash) {
        if (quotedStringEnd >= inputLength)
            return StringView();
        if (currentCharacter == '\\' && !lastCharacterWasBackslash) {
            lastCharacterWasBackslash = true;
            continue;
        }
        if (lastCharacterWasBackslash)
            lastCharacterWasBackslash = false;
    }
    if (input[quotedStringEnd - 1] == '"')
        quotedStringEnd++;
    return input.substring(quotedStringStart, quotedStringEnd - quotedStringStart);
}

// From http://tools.ietf.org/html/rfc2045#section-5.1:
//
// content := "Content-Type" ":" type "/" subtype
//            *(";" parameter)
//            ; Matching of media type and subtype
//            ; is ALWAYS case-insensitive.
//
// type := discrete-type / composite-type
//
// discrete-type := "text" / "image" / "audio" / "video" /
//                  "application" / extension-token
//
// composite-type := "message" / "multipart" / extension-token
//
// extension-token := ietf-token / x-token
//
// ietf-token := <An extension token defined by a
//                standards-track RFC and registered
//                with IANA.>
//
// x-token := <The two characters "X-" or "x-" followed, with
//             no intervening white space, by any token>
//
// subtype := extension-token / iana-token
//
// iana-token := <A publicly-defined extension token. Tokens
//                of this form must be registered with IANA
//                as specified in RFC 2048.>
//
// parameter := attribute "=" value
//
// attribute := token
//              ; Matching of attributes
//              ; is ALWAYS case-insensitive.
//
// value := token / quoted-string
//
// token := 1*<any (US-ASCII) CHAR except SPACE, CTLs,
//             or tspecials>
//
// tspecials :=  "(" / ")" / "<" / ">" / "@" /
//               "," / ";" / ":" / "\" / <">
//               "/" / "[" / "]" / "?" / "="
//               ; Must be in quoted-string,
//               ; to use within parameter values

static bool isNotForwardSlash(UChar ch)
{
    return ch != '/';
}

static bool isNotSemicolon(UChar ch)
{
    return ch != ';';
}

static bool isNotSemicolonOrEqualSign(UChar ch)
{
    return ch != ';' && ch != '=';
}

static bool containsNewline(UChar ch)
{
    return ch == '\r' || ch == '\n';
}

bool ParsedContentType::parseContentType(Mode mode)
{
    if (mode == Mode::Rfc2045 && m_contentType.find(containsNewline) != notFound)
        return false;
    unsigned index = 0;
    unsigned contentTypeLength = m_contentType.length();
    skipSpaces(m_contentType, index);
    if (index >= contentTypeLength)  {
        LOG_ERROR("Invalid Content-Type string '%s'", m_contentType.ascii().data());
        return false;
    }

    unsigned contentTypeStart = index;
    auto typeRange = parseToken(m_contentType, index, isNotForwardSlash, mode);
    if (typeRange.isNull() || containsNonTokenCharacters(typeRange, mode)) {
        LOG_ERROR("Invalid Content-Type, invalid type value.");
        return false;
    }

    if (index >= contentTypeLength || m_contentType[index++] != '/') {
        LOG_ERROR("Invalid Content-Type, missing '/'.");
        return false;
    }

    auto subTypeRange = parseToken(m_contentType, index, isNotSemicolon, mode, mode == Mode::MimeSniff);
    if (subTypeRange.isNull() || containsNonTokenCharacters(subTypeRange, mode)) {
        LOG_ERROR("Invalid Content-Type, invalid subtype value.");
        return false;
    }

    // There should not be any quoted strings until we reach the parameters.
    size_t semiColonIndex = m_contentType.find(';', contentTypeStart);
    if (semiColonIndex == notFound) {
        setContentType(m_contentType.substring(contentTypeStart, contentTypeLength - contentTypeStart), mode);
        return true;
    }

    setContentType(m_contentType.substring(contentTypeStart, semiColonIndex - contentTypeStart), mode);
    index = semiColonIndex + 1;
    while (true) {
        skipSpaces(m_contentType, index);
        auto keyRange = parseToken(m_contentType, index, isNotSemicolonOrEqualSign, mode);
        if (mode == Mode::Rfc2045 && (keyRange.isNull() || index >= contentTypeLength)) {
            LOG_ERROR("Invalid Content-Type parameter name.");
            return false;
        }

        // Should we tolerate spaces here?
        if (mode == Mode::Rfc2045) {
            if (index >= contentTypeLength || m_contentType[index++] != '=') {
                LOG_ERROR("Invalid Content-Type malformed parameter.");
                return false;
            }
        } else {
            if (index >= contentTypeLength)
                break;
            if (m_contentType[index] != '=' && m_contentType[index] != ';') {
                LOG_ERROR("Invalid Content-Type malformed parameter.");
                return false;
            }
            if (m_contentType[index++] == ';')
                continue;
        }

        // Should we tolerate spaces here?
        String parameterValue;
        StringView valueRange;
        if (index < contentTypeLength && m_contentType[index] == '"') {
            if (mode == Mode::MimeSniff) {
                parameterValue = collectHTTPQuotedString(m_contentType, index);
                parseToken(m_contentType, index, isNotSemicolon, mode);
            } else
                valueRange = parseQuotedString(m_contentType, index);
        } else
            valueRange = parseToken(m_contentType, index, isNotSemicolon, mode, mode == Mode::MimeSniff);

        if (parameterValue.isNull()) {
            if (valueRange.isNull()) {
                if (mode == Mode::MimeSniff)
                    continue;
                LOG_ERROR("Invalid Content-Type, invalid parameter value.");
                return false;
            }
            parameterValue = valueRange.toString();
        }

        // Should we tolerate spaces here?
        if (mode == Mode::Rfc2045 && index < contentTypeLength && m_contentType[index++] != ';') {
            LOG_ERROR("Invalid Content-Type, invalid character at the end of key/value parameter.");
            return false;
        }

        if (!keyRange.isNull())
            setContentTypeParameter(keyRange.toString(), parameterValue, mode);

        if (index >= contentTypeLength)
            return true;
    }

    return true;
}

std::optional<ParsedContentType> ParsedContentType::create(const String& contentType, Mode mode)
{
    ParsedContentType parsedContentType(mode == Mode::Rfc2045 ? contentType : stripLeadingAndTrailingHTTPSpaces(contentType));
    if (!parsedContentType.parseContentType(mode))
        return std::nullopt;
    return { WTFMove(parsedContentType) };
}

bool isValidContentType(const String& contentType, Mode mode)
{
    return ParsedContentType::create(contentType, mode) != std::nullopt;
}

ParsedContentType::ParsedContentType(const String& contentType)
    : m_contentType(contentType)
{
}

String ParsedContentType::charset() const
{
    return parameterValueForName("charset");
}

void ParsedContentType::setCharset(String&& charset)
{
    m_parameterValues.set("charset"_s, WTFMove(charset));
}

String ParsedContentType::parameterValueForName(const String& name) const
{
    return m_parameterValues.get(name);
}

size_t ParsedContentType::parameterCount() const
{
    return m_parameterValues.size();
}

void ParsedContentType::setContentType(StringView contentRange, Mode mode)
{
    m_mimeType = contentRange.toString();
    if (mode == Mode::MimeSniff)
        m_mimeType = stripLeadingAndTrailingHTTPSpaces(m_mimeType).convertToASCIILowercase();
    else
        m_mimeType = m_mimeType.stripWhiteSpace();
}

static bool containsNonQuoteStringTokenCharacters(const String& input)
{
    for (unsigned index = 0; index < input.length(); ++index) {
        if (!isQuotedStringTokenCharacter(input[index]))
            return true;
    }
    return false;
}

void ParsedContentType::setContentTypeParameter(const String& keyName, const String& keyValue, Mode mode)
{
    String name = keyName;
    if (mode == Mode::MimeSniff) {
        if (m_parameterValues.contains(name) || !isValidHTTPToken(name) || containsNonQuoteStringTokenCharacters(keyValue))
            return;
        name = name.convertToASCIILowercase();
    }
    m_parameterValues.set(name, keyValue);
    m_parameterNames.append(name);
}

String ParsedContentType::serialize() const
{
    StringBuilder builder;
    builder.append(m_mimeType);
    for (auto& name : m_parameterNames) {
        builder.append(';');
        builder.append(name);
        builder.append('=');
        String value = m_parameterValues.get(name);
        if (value.isEmpty() || !isValidHTTPToken(value)) {
            builder.append('"');
            for (unsigned index = 0; index < value.length(); ++index) {
                auto ch = value[index];
                if (ch == '\\' || ch =='"')
                    builder.append('\\');
                builder.append(ch);
            }
            builder.append('"');
        } else
            builder.append(value);
    }
    return builder.toString();
}

}
