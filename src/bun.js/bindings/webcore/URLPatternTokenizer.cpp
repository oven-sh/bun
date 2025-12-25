/*
 * Copyright (C) 2024 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "URLPatternTokenizer.h"

#include "ExceptionOr.h"
#include "URLPatternParser.h"
#include <unicode/utf16.h>
#include <wtf/text/MakeString.h>

namespace WebCore {
namespace URLPatternUtilities {

bool Token::isNull() const
{
    if (!index) {
        ASSERT(value.isNull());
        return true;
    }
    return false;
}

// https://urlpattern.spec.whatwg.org/#get-the-next-code-point
void Tokenizer::getNextCodePoint()
{
    m_codepoint = m_input[m_nextIndex++];

    if (m_input.is8Bit() || !U16_IS_LEAD(m_codepoint) || m_nextIndex >= m_input.length())
        return;

    auto next = m_input[m_nextIndex];
    if (!U16_IS_TRAIL(next))
        return;

    m_nextIndex++;
    m_codepoint = U16_GET_SUPPLEMENTARY(m_codepoint, next);
}

// https://urlpattern.spec.whatwg.org/#seek-and-get-the-next-code-point
void Tokenizer::seekNextCodePoint(size_t index)
{
    m_nextIndex = index;
    getNextCodePoint();
}

// https://urlpattern.spec.whatwg.org/#add-a-token
void Tokenizer::addToken(TokenType currentType, size_t nextPosition, size_t valuePosition, size_t valueLength)
{
    m_tokenList.append(Token { currentType, m_index, m_input.substring(valuePosition, valueLength) });
    m_index = nextPosition;
}

// https://urlpattern.spec.whatwg.org/#add-a-token-with-default-length
void Tokenizer::addToken(TokenType currentType, size_t nextPosition, size_t valuePosition)
{
    addToken(currentType, nextPosition, valuePosition, nextPosition - valuePosition);
}

// https://urlpattern.spec.whatwg.org/#add-a-token-with-default-position-and-length
void Tokenizer::addToken(TokenType currentType)
{
    addToken(currentType, m_nextIndex, m_index);
}

// https://urlpattern.spec.whatwg.org/#process-a-tokenizing-error
ExceptionOr<void> Tokenizer::processTokenizingError(size_t nextPosition, size_t valuePosition, const String& callerErrorInfo)
{
    if (m_policy == TokenizePolicy::Strict)
        return Exception { ExceptionCode::TypeError, callerErrorInfo };

    ASSERT(m_policy == TokenizePolicy::Lenient);

    addToken(TokenType::InvalidChar, nextPosition, valuePosition);

    return {};
}

Tokenizer::Tokenizer(StringView input, TokenizePolicy tokenizerPolicy)
    : m_input(input)
    , m_policy(tokenizerPolicy)
{
}

// https://urlpattern.spec.whatwg.org/#tokenize
ExceptionOr<Vector<Token>> Tokenizer::tokenize()
{
    ExceptionOr<void> maybeException;

    while (m_index < m_input.length()) {
        if (m_policy == TokenizePolicy::Strict && maybeException.hasException())
            return maybeException.releaseException();

        seekNextCodePoint(m_index);

        if (m_codepoint == '*') {
            addToken(TokenType::Asterisk);
            continue;
        }

        if (m_codepoint == '+' || m_codepoint == '?') {
            addToken(TokenType::OtherModifier);
            continue;
        }

        if (m_codepoint == '\\') {
            if (m_index == m_input.length() - 1) {
                maybeException = processTokenizingError(m_nextIndex, m_index, "No character is provided after escape."_s);
                continue;
            }

            auto escapedIndex = m_nextIndex;
            getNextCodePoint();

            addToken(TokenType::EscapedChar, m_nextIndex, escapedIndex);
            continue;
        }

        if (m_codepoint == '{') {
            addToken(TokenType::Open);
            continue;
        }

        if (m_codepoint == '}') {
            addToken(TokenType::Close);
            continue;
        }

        if (m_codepoint == ':') {
            auto namePosition = m_nextIndex;
            auto nameStart = namePosition;

            while (namePosition < m_input.length()) {
                seekNextCodePoint(namePosition);

                bool isValidCodepoint = isValidNameCodepoint(m_codepoint, namePosition == nameStart ? IsFirst::Yes : IsFirst::No);

                if (!isValidCodepoint)
                    break;

                namePosition = m_nextIndex;
            }

            if (namePosition <= nameStart) {
                maybeException = processTokenizingError(nameStart, m_index, makeString("Name position "_s, String::number(namePosition), " is less than name start "_s, String::number(nameStart)));
                continue;
            }

            addToken(TokenType::Name, namePosition, nameStart);
            continue;
        }

        if (m_codepoint == '(') {
            int depth = 1;
            auto regexPosition = m_nextIndex;
            auto regexStart = regexPosition;
            bool hasError = false;

            while (regexPosition < m_input.length()) {
                seekNextCodePoint(regexPosition);

                if (!isASCII(m_codepoint)) {
                    maybeException = processTokenizingError(regexStart, m_index, "Current codepoint is not ascii"_s);
                    hasError = true;
                    break;
                }

                if (regexPosition == regexStart && m_codepoint == '?') {
                    maybeException = processTokenizingError(regexStart, m_index, "Regex cannot start with modifier."_s);
                    hasError = true;
                    break;
                }

                if (m_codepoint == '\\') {
                    if (regexPosition == m_input.length() - 1) {
                        maybeException = processTokenizingError(regexStart, m_index, "No character is provided after escape."_s);
                        hasError = true;
                        break;
                    }

                    getNextCodePoint();

                    if (!isASCII(m_codepoint)) {
                        maybeException = processTokenizingError(regexStart, m_index, "Current codepoint is not ascii"_s);
                        hasError = true;
                        break;
                    }

                    regexPosition = m_nextIndex;
                    continue;
                }

                if (m_codepoint == ')') {
                    depth = depth - 1;

                    if (!depth) {
                        regexPosition = m_nextIndex;
                        break;
                    }
                }

                if (m_codepoint == '(') {
                    depth = depth + 1;

                    if (regexPosition == m_input.length() - 1) {
                        maybeException = processTokenizingError(regexStart, m_index, "No closing token is provided by end of string."_s);
                        hasError = true;
                        break;
                    }

                    int temporaryPosition = m_nextIndex;
                    getNextCodePoint();

                    if (m_codepoint != '?') {
                        maybeException = processTokenizingError(regexStart, m_index, "Required OtherModifier token is not provided in regex."_s);
                        hasError = true;
                        break;
                    }

                    m_nextIndex = temporaryPosition;
                }

                regexPosition = m_nextIndex;
            }

            if (hasError)
                continue;

            if (depth) {
                maybeException = processTokenizingError(regexStart, m_index, "Current open token does not have a corresponding close token."_s);
                continue;
            }

            auto regexLength = regexPosition - regexStart - 1;

            if (!regexLength)
                maybeException = processTokenizingError(regexStart, m_index, "Regex length is zero."_s);

            addToken(TokenType::Regexp, regexPosition, regexStart, regexLength);
            continue;
        }

        addToken(TokenType::Char);
    }

    addToken(TokenType::End, m_index, m_index);
    return WTF::move(m_tokenList);
}

} // namespace URLPatternUtilities
} // namespace WebCore
