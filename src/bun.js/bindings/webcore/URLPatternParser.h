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

#include "URLPatternTokenizer.h"
#include <wtf/text/StringBuilder.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

enum class EncodingCallbackType : uint8_t;
template<typename> class ExceptionOr;

namespace URLPatternUtilities {

struct Token;
enum class TokenType : uint8_t;

enum class PartType : uint8_t { FixedText,
    Regexp,
    SegmentWildcard,
    FullWildcard };
enum class Modifier : uint8_t { None,
    Optional,
    ZeroOrMore,
    OneOrMore };
enum class IsFirst : bool { No,
    Yes };

struct Part {
    PartType type;
    String value;
    Modifier modifier;
    String name {};
    String prefix {};
    String suffix {};
};

struct URLPatternStringOptions {
    String delimiterCodepoint {};
    String prefixCodepoint {};
    bool ignoreCase { false };
};

class URLPatternParser {
public:
    URLPatternParser(EncodingCallbackType, String&& segmentWildcardRegexp);
    ExceptionOr<void> performParse(const URLPatternStringOptions&);

    void setTokenList(Vector<Token>&& tokenList) { m_tokenList = WTF::move(tokenList); }
    static ExceptionOr<Vector<Part>> parse(StringView, const URLPatternStringOptions&, EncodingCallbackType);

private:
    Token tryToConsumeToken(TokenType);
    Token tryToConsumeRegexOrWildcardToken(const Token&);
    Token tryToConsumeModifierToken();

    String consumeText();
    ExceptionOr<Token> consumeRequiredToken(TokenType);

    ExceptionOr<void> maybeAddPartFromPendingFixedValue();
    ExceptionOr<void> addPart(String&& prefix, const Token& nameToken, const Token& regexpOrWildcardToken, String&& suffix, const Token& modifierToken);

    bool isDuplicateName(StringView) const;

    Vector<Part> takePartList() { return std::exchange(m_partList, {}); }

    Vector<Token> m_tokenList;
    Vector<Part> m_partList;
    EncodingCallbackType m_callbackType;
    String m_segmentWildcardRegexp;
    StringBuilder m_pendingFixedValue;
    size_t m_index { 0 };
    int m_nextNumericName { 0 };
};

// FIXME: Consider moving functions to somewhere generic, perhaps refactor Part to its own class.
String generateSegmentWildcardRegexp(const URLPatternStringOptions&);
String escapeRegexString(StringView);
ASCIILiteral convertModifierToString(Modifier);
std::pair<String, Vector<String>> generateRegexAndNameList(const Vector<Part>& partList, const URLPatternStringOptions&);
String generatePatternString(const Vector<Part>& partList, const URLPatternStringOptions&);
String escapePatternString(StringView input);
bool isValidNameCodepoint(char16_t codepoint, URLPatternUtilities::IsFirst);

} // namespace URLPatternUtilities
} // namespace WebCore
