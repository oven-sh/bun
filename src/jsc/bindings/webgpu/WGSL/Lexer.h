/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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

#include "SourceSpan.h"
#include <wtf/text/StringParsingBuffer.h>

namespace WGSL {

enum class TokenType : uint32_t;

struct Token;

template<typename T>
class Lexer {
public:
    Lexer(std::span<const T> code)
        : m_code { code }
        , m_current { m_code.hasCharactersRemaining() ? m_code[0] : T { } }
    {
    }

    Vector<Token> lex();
    bool NODELETE isAtEndOfFile() const;

private:
    Token nextToken();
    Token lexNumber();
    unsigned currentOffset() const { return m_currentPosition.offset; }
    unsigned currentTokenLength() const { return currentOffset() - m_tokenStartingPosition.offset; }

    Token NODELETE makeToken(TokenType);
    Token NODELETE makeFloatToken(TokenType, double);
    Token NODELETE makeIntegerToken(TokenType, int64_t);
    Token NODELETE makeIdentifierToken(String&&);

    T NODELETE shift(unsigned = 1);
    T NODELETE peek(unsigned = 0);
    void NODELETE newLine();
    bool NODELETE skipBlockComments();
    bool NODELETE skipLineComment();
    bool NODELETE skipWhitespaceAndComments();

    StringParsingBuffer<T> m_code;
    T m_current;
    SourcePosition m_currentPosition { 1, 0, 0 };
    SourcePosition m_tokenStartingPosition { 0, 0, 0 };
};

}
