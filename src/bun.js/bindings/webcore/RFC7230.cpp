/*
 * Copyright (C) 2017-2022 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "RFC7230.h"

#include <wtf/ASCIICType.h>
#include <wtf/text/StringView.h>

namespace RFC7230 {

bool isTokenCharacter(char16_t c)
{
    return isASCIIAlpha(c) || isASCIIDigit(c)
        || c == '!' || c == '#' || c == '$'
        || c == '%' || c == '&' || c == '\''
        || c == '*' || c == '+' || c == '-'
        || c == '.' || c == '^' || c == '_'
        || c == '`' || c == '|' || c == '~';
}

bool isDelimiter(char16_t c)
{
    return c == '(' || c == ')' || c == ','
        || c == '/' || c == ':' || c == ';'
        || c == '<' || c == '=' || c == '>'
        || c == '?' || c == '@' || c == '['
        || c == '\\' || c == ']' || c == '{'
        || c == '}' || c == '"';
}

static bool isVisibleCharacter(char16_t c)
{
    return isTokenCharacter(c) || isDelimiter(c);
}

template<size_t min, size_t max>
static bool isInRange(char16_t c)
{
    return c >= min && c <= max;
}

static bool isOBSText(char16_t c)
{
    return isInRange<0x80, 0xFF>(c);
}

static bool isQuotedTextCharacter(char16_t c)
{
    return isTabOrSpace(c)
        || c == 0x21
        || isInRange<0x23, 0x5B>(c)
        || isInRange<0x5D, 0x7E>(c)
        || isOBSText(c);
}

bool isQuotedPairSecondOctet(char16_t c)
{
    return isTabOrSpace(c)
        || isVisibleCharacter(c)
        || isOBSText(c);
}

bool isCommentText(char16_t c)
{
    return isTabOrSpace(c)
        || isInRange<0x21, 0x27>(c)
        || isInRange<0x2A, 0x5B>(c)
        || isInRange<0x5D, 0x7E>(c)
        || isOBSText(c);
}

bool isValidName(StringView name)
{
    if (!name.length())
        return false;
    for (size_t i = 0; i < name.length(); ++i) {
        if (!isTokenCharacter(name[i]))
            return false;
    }
    return true;
}

bool isValidValue(StringView value)
{
    enum class State {
        OptionalWhitespace,
        Token,
        QuotedString,
        Comment,
    };
    State state = State::OptionalWhitespace;
    size_t commentDepth = 0;
    bool hadNonWhitespace = false;

    for (size_t i = 0; i < value.length(); ++i) {
        char16_t c = value[i];
        switch (state) {
        case State::OptionalWhitespace:
            if (isTabOrSpace(c))
                continue;
            hadNonWhitespace = true;
            if (isTokenCharacter(c)) {
                state = State::Token;
                continue;
            }
            if (c == '"') {
                state = State::QuotedString;
                continue;
            }
            if (c == '(') {
                ASSERT(!commentDepth);
                ++commentDepth;
                state = State::Comment;
                continue;
            }
            return false;

        case State::Token:
            if (isTokenCharacter(c))
                continue;
            state = State::OptionalWhitespace;
            continue;
        case State::QuotedString:
            if (c == '"') {
                state = State::OptionalWhitespace;
                continue;
            }
            if (c == '\\') {
                ++i;
                if (i == value.length())
                    return false;
                if (!isQuotedPairSecondOctet(value[i]))
                    return false;
                continue;
            }
            if (!isQuotedTextCharacter(c))
                return false;
            continue;
        case State::Comment:
            if (c == '(') {
                ++commentDepth;
                continue;
            }
            if (c == ')') {
                --commentDepth;
                if (!commentDepth)
                    state = State::OptionalWhitespace;
                continue;
            }
            if (c == '\\') {
                ++i;
                if (i == value.length())
                    return false;
                if (!isQuotedPairSecondOctet(value[i]))
                    return false;
                continue;
            }
            if (!isCommentText(c))
                return false;
            continue;
        }
    }

    switch (state) {
    case State::OptionalWhitespace:
    case State::Token:
        return hadNonWhitespace;
    case State::QuotedString:
    case State::Comment:
        // Unclosed comments or quotes are invalid values.
        break;
    }
    return false;
}

} // namespace RFC7230
