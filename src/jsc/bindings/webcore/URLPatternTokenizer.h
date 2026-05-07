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

#pragma once

#include <wtf/text/StringView.h>

namespace WebCore {

template<typename> class ExceptionOr;

namespace URLPatternUtilities {

enum class TokenType : uint8_t { Open,
    Close,
    Regexp,
    Name,
    Char,
    EscapedChar,
    OtherModifier,
    Asterisk,
    End,
    InvalidChar };
enum class TokenizePolicy : bool { Strict,
    Lenient };

struct Token {
    TokenType type;
    std::optional<size_t> index;
    StringView value;

    bool isNull() const;
};

class Tokenizer {
public:
    Tokenizer(StringView input, TokenizePolicy tokenizerPolicy);

    ExceptionOr<Vector<Token>> tokenize();

private:
    StringView m_input;
    TokenizePolicy m_policy { TokenizePolicy::Strict };
    Vector<Token> m_tokenList;
    size_t m_index { 0 };
    size_t m_nextIndex { 0 };
    char32_t m_codepoint;

    void getNextCodePoint();
    void seekNextCodePoint(size_t index);

    void addToken(TokenType currentType, size_t nextPosition, size_t valuePosition, size_t valueLength);
    void addToken(TokenType currentType, size_t nextPosition, size_t valuePosition);
    void addToken(TokenType currentType);

    ExceptionOr<void> processTokenizingError(size_t nextPosition, size_t valuePosition, const String&);
};

} // namespace URLPatternUtilities
} // namespace WebCore
