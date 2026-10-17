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

static void LEGACY_NODELETE skipSpaces(StringView input, unsigned& startIndex)
{
    while (startIndex < input.length() && isASCIIWhitespaceWithoutFF(input[startIndex]))
        ++startIndex;
}

static bool LEGACY_NODELETE isQuotedStringTokenCharacter(char16_t c)
{
    return (c >= ' ' && c <= '~') || (c >= 0x80 && c <= 0xFF) || c == '\t';
}

using CharacterMeetsCondition = bool (*)(char16_t);

static StringView parseToken(StringView input, unsigned& startIndex, CharacterMeetsCondition characterMeetsCondition, bool skipTrailingWhitespace = false)
{
    unsigned inputLength = input.length();
    unsigned tokenStart = startIndex;
    unsigned& tokenEnd = startIndex;

    if (tokenEnd >= inputLength)
        return StringView();

    while (tokenEnd < inputLength && characterMeetsCondition(input[tokenEnd]))
        ++tokenEnd;

    if (tokenEnd == tokenStart)
        return StringView();
    if (skipTrailingWhitespace) {
        while (isASCIIWhitespaceWithoutFF(input[tokenEnd - 1]))
            --tokenEnd;
    }
    return input.substring(tokenStart, tokenEnd - tokenStart);
}

static bool LEGACY_NODELETE isNotQuoteOrBackslash(char16_t ch)
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
        parseToken(input, position, isNotQuoteOrBackslash);
        builder.append(input.substring(positionStart, position - positionStart));
        if (position >= inputLength)
            break;
        char16_t quoteOrBackslash = input[position++];
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

static bool LEGACY_NODELETE isNotForwardSlash(char16_t ch)
{
    return ch != '/';
}

static bool LEGACY_NODELETE isNotSemicolon(char16_t ch)
{
    return ch != ';';
}

static bool LEGACY_NODELETE isNotSemicolonOrEqualSign(char16_t ch)
{
    return ch != ';' && ch != '=';
}

bool ParsedContentType::parseContentType()
{
    unsigned index = 0;
    unsigned contentTypeLength = m_contentType.length();
    skipSpaces(m_contentType, index);
    if (index >= contentTypeLength)  {
        LOG_ERROR("Invalid Content-Type string '%s'", m_contentType.utf8());
        return false;
    }

    unsigned contentTypeStart = index;
    auto typeRange = parseToken(m_contentType, index, isNotForwardSlash);
    if (typeRange.isNull() || !isValidHTTPToken(typeRange)) {
        LOG_ERROR("Invalid Content-Type, invalid type value.");
        return false;
    }

    if (index >= contentTypeLength || m_contentType[index++] != '/') {
        LOG_ERROR("Invalid Content-Type, missing '/'.");
        return false;
    }

    auto subTypeRange = parseToken(m_contentType, index, isNotSemicolon, true);
    if (subTypeRange.isNull() || !isValidHTTPToken(subTypeRange)) {
        LOG_ERROR("Invalid Content-Type, invalid subtype value.");
        return false;
    }

    // There should not be any quoted strings until we reach the parameters.
    size_t semiColonIndex = m_contentType.find(';', contentTypeStart);
    if (semiColonIndex == notFound) {
        setContentType(m_contentType.substring(contentTypeStart, contentTypeLength - contentTypeStart));
        return true;
    }

    setContentType(m_contentType.substring(contentTypeStart, semiColonIndex - contentTypeStart));
    index = semiColonIndex + 1;
    while (true) {
        skipSpaces(m_contentType, index);
        auto keyRange = parseToken(m_contentType, index, isNotSemicolonOrEqualSign);
        if (index >= contentTypeLength)
            break;
        if (m_contentType[index] != '=' && m_contentType[index] != ';') {
            LOG_ERROR("Invalid Content-Type malformed parameter.");
            return false;
        }
        if (m_contentType[index++] == ';')
            continue;

        // Should we tolerate spaces here?
        String parameterValue;
        StringView valueRange;
        if (index < contentTypeLength && m_contentType[index] == '"') {
            parameterValue = collectHTTPQuotedString(m_contentType, index);
            parseToken(m_contentType, index, isNotSemicolon);
        } else
            valueRange = parseToken(m_contentType, index, isNotSemicolon, true);

        if (parameterValue.isNull()) {
            if (valueRange.isNull())
                continue;
            parameterValue = valueRange.toString();
        }

        if (!keyRange.isNull())
            setContentTypeParameter(keyRange.toString(), parameterValue);

        if (index >= contentTypeLength)
            return true;
    }

    return true;
}

std::optional<ParsedContentType> ParsedContentType::create(const String& contentType)
{
    ParsedContentType parsedContentType(contentType.trim(isASCIIWhitespaceWithoutFF<char16_t>));
    if (!parsedContentType.parseContentType())
        return std::nullopt;
    return { WTF::move(parsedContentType) };
}

bool isValidContentType(const String& contentType)
{
    return ParsedContentType::create(contentType) != std::nullopt;
}

ParsedContentType::ParsedContentType(const String& contentType)
    : m_contentType(contentType)
{
}

String ParsedContentType::charset() const
{
    return parameterValueForName("charset"_s);
}

void ParsedContentType::setCharset(String&& charset)
{
    m_parameterValues.set("charset"_s, WTF::move(charset));
}

String ParsedContentType::parameterValueForName(const String& name) const
{
    return m_parameterValues.get(name);
}

size_t ParsedContentType::parameterCount() const
{
    return m_parameterValues.size();
}

void ParsedContentType::setContentType(String&& contentRange)
{
    m_mimeType = StringView(WTF::move(contentRange)).trim(isASCIIWhitespaceWithoutFF<char16_t>).convertToASCIILowercase();
}

static bool LEGACY_NODELETE containsNonQuoteStringTokenCharacters(const String& input)
{
    for (unsigned index = 0; index < input.length(); ++index) {
        if (!isQuotedStringTokenCharacter(input[index]))
            return true;
    }
    return false;
}

void ParsedContentType::setContentTypeParameter(const String& keyName, const String& keyValue)
{
    String name = keyName;
    if (m_parameterValues.contains(name) || !isValidHTTPToken(name) || containsNonQuoteStringTokenCharacters(keyValue))
        return;
    // FIXME: Lowercasing after a contains check is almost certainly wrong. It means we overwrite
    // when the name is different in case.
    name = name.convertToASCIILowercase();
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

} // namespace WebCore
