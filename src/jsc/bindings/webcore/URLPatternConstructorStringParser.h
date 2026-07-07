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

#include "ScriptExecutionContext.h"
#include "URLPatternInit.h"

namespace WebCore {

template<typename> class ExceptionOr;

enum class EncodingCallbackType : uint8_t;

namespace URLPatternUtilities {
struct Token;
enum class TokenType : uint8_t;
struct URLPatternStringOptions;
struct URLPatternInit;
}

enum class URLPatternConstructorStringParserState : uint8_t { Init,
    Protocol,
    Authority,
    Username,
    Password,
    Hostname,
    Port,
    Pathname,
    Search,
    Hash,
    Done };

class URLPatternConstructorStringParser {
public:
    explicit URLPatternConstructorStringParser(String&& input);
    ExceptionOr<URLPatternInit> parse(ScriptExecutionContext&);

private:
    void performParse(ScriptExecutionContext&);
    void rewind();
    const URLPatternUtilities::Token& getSafeToken(size_t index) const;
    bool isNonSpecialPatternCharacter(size_t index, char value) const;
    bool isSearchPrefix() const;
    bool isAuthoritySlashesNext() const;
    String makeComponentString() const;
    void changeState(URLPatternConstructorStringParserState, size_t skip);
    void updateState(ScriptExecutionContext&);
    ExceptionOr<void> computeProtocolMatchSpecialSchemeFlag(ScriptExecutionContext&);

    StringView m_input;
    Vector<URLPatternUtilities::Token> m_tokenList;
    URLPatternInit m_result;
    size_t m_componentStart { 0 };
    size_t m_tokenIndex { 0 };
    size_t m_tokenIncrement { 1 };
    size_t m_groupDepth { 0 };
    int m_hostnameIPv6BracketDepth { 0 };
    bool m_protocolMatchesSpecialSchemeFlag { false };
    URLPatternConstructorStringParserState m_state { URLPatternConstructorStringParserState::Init };
};

}
