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
#include "URLPatternConstructorStringParser.h"

#include "ExceptionOr.h"
#include "URLPatternCanonical.h"
#include "URLPatternComponent.h"
#include "URLPatternInit.h"
#include "URLPatternParser.h"
#include "URLPatternTokenizer.h"

namespace WebCore {
using namespace JSC;

URLPatternConstructorStringParser::URLPatternConstructorStringParser(String&& input)
    : m_input(WTF::move(input))
{
}

// https://urlpattern.spec.whatwg.org/#rewind
void URLPatternConstructorStringParser::rewind()
{
    m_tokenIndex = m_componentStart;
    m_tokenIncrement = 0;
}

// https://urlpattern.spec.whatwg.org/#get-a-safe-token
const URLPatternUtilities::Token& URLPatternConstructorStringParser::getSafeToken(size_t index) const
{
    if (index < m_tokenList.size())
        return m_tokenList[index];

    ASSERT(m_tokenList.last().type == URLPatternUtilities::TokenType::End);
    return m_tokenList.last();
}

// https://urlpattern.spec.whatwg.org/#is-a-non-special-pattern-char
bool URLPatternConstructorStringParser::isNonSpecialPatternCharacter(size_t index, char value) const
{
    auto token = getSafeToken(index);

    return token.value.length() == 1 && token.value[0] == value
        && (token.type == URLPatternUtilities::TokenType::Char
            || token.type == URLPatternUtilities::TokenType::EscapedChar
            || token.type == URLPatternUtilities::TokenType::InvalidChar);
}

// https://urlpattern.spec.whatwg.org/#is-a-search-prefix
bool URLPatternConstructorStringParser::isSearchPrefix() const
{
    if (isNonSpecialPatternCharacter(m_tokenIndex, '?'))
        return true;
    if (m_tokenList[m_tokenIndex].value != "?"_s)
        return false;

    if (m_tokenIndex == 0)
        return true;

    size_t previousIndex = m_tokenIndex - 1;
    auto previousToken = getSafeToken(previousIndex);
    if (previousToken.type == URLPatternUtilities::TokenType::Name
        || previousToken.type == URLPatternUtilities::TokenType::Regexp
        || previousToken.type == URLPatternUtilities::TokenType::Close
        || previousToken.type == URLPatternUtilities::TokenType::Asterisk) {
        return false;
    }
    return true;
}

// https://urlpattern.spec.whatwg.org/#next-is-authority-slashes
bool URLPatternConstructorStringParser::isAuthoritySlashesNext() const
{
    if (!isNonSpecialPatternCharacter(m_tokenIndex + 1, '/'))
        return false;
    if (!isNonSpecialPatternCharacter(m_tokenIndex + 2, '/'))
        return false;
    return true;
}

// https://urlpattern.spec.whatwg.org/#make-a-component-string
String URLPatternConstructorStringParser::makeComponentString() const
{
    const auto& token = m_tokenList[m_tokenIndex];

    auto componentStartToken = getSafeToken(m_componentStart);
    auto componentStartIndex = *componentStartToken.index;

    return m_input.substring(componentStartIndex, *token.index - componentStartIndex).toString();
}

static inline void setInitComponentFromState(URLPatternInit& init, URLPatternConstructorStringParserState state, String&& componentString)
{
    switch (state) {
    case URLPatternConstructorStringParserState::Protocol:
        init.protocol = WTF::move(componentString);
        break;
    case URLPatternConstructorStringParserState::Username:
        init.username = WTF::move(componentString);
        break;
    case URLPatternConstructorStringParserState::Password:
        init.password = WTF::move(componentString);
        break;
    case URLPatternConstructorStringParserState::Hostname:
        init.hostname = WTF::move(componentString);
        break;
    case URLPatternConstructorStringParserState::Port:
        init.port = WTF::move(componentString);
        break;
    case URLPatternConstructorStringParserState::Pathname:
        init.pathname = WTF::move(componentString);
        break;
    case URLPatternConstructorStringParserState::Search:
        init.search = WTF::move(componentString);
        break;
    case URLPatternConstructorStringParserState::Hash:
        init.hash = WTF::move(componentString);
        break;
    default:
        break;
    }
}

// https://urlpattern.spec.whatwg.org/#compute-protocol-matches-a-special-scheme-flag
ExceptionOr<void> URLPatternConstructorStringParser::computeProtocolMatchSpecialSchemeFlag(ScriptExecutionContext& context)
{
    Ref vm = context.vm();
    JSC::JSLockHolder lock(vm);

    auto maybeProtocolComponent = URLPatternUtilities::URLPatternComponent::compile(vm, makeComponentString(), EncodingCallbackType::Protocol, URLPatternUtilities::URLPatternStringOptions {});
    if (maybeProtocolComponent.hasException())
        return maybeProtocolComponent.releaseException();

    auto protocolComponent = maybeProtocolComponent.releaseReturnValue();
    m_protocolMatchesSpecialSchemeFlag = protocolComponent.matchSpecialSchemeProtocol(context);

    return {};
}

// https://urlpattern.spec.whatwg.org/#change-state
void URLPatternConstructorStringParser::changeState(URLPatternConstructorStringParserState newState, size_t skip)
{
    if (m_state != URLPatternConstructorStringParserState::Init
        && m_state != URLPatternConstructorStringParserState::Authority
        && m_state != URLPatternConstructorStringParserState::Done)
        setInitComponentFromState(m_result, m_state, makeComponentString());

    if (m_state != URLPatternConstructorStringParserState::Init && newState != URLPatternConstructorStringParserState::Done) {
        // Set init's hostname to empty if conditions are met.
        static constexpr std::array validStateConditionsForEmptyHostname { URLPatternConstructorStringParserState::Protocol, URLPatternConstructorStringParserState::Authority, URLPatternConstructorStringParserState::Username, URLPatternConstructorStringParserState::Password };
        static constexpr std::array validNewStateConditionsForEmptyHostname { URLPatternConstructorStringParserState::Port, URLPatternConstructorStringParserState::Pathname, URLPatternConstructorStringParserState::Search, URLPatternConstructorStringParserState::Hash };
        if (std::ranges::find(validStateConditionsForEmptyHostname, m_state) != validStateConditionsForEmptyHostname.end()
            && std::ranges::find(validNewStateConditionsForEmptyHostname, newState) != validNewStateConditionsForEmptyHostname.end()
            && m_result.hostname.isNull()) {
            m_result.hostname = emptyString();
        }
        // Set init's pathname to empty if conditions are met.
        static constexpr std::array validStateConditionsForEmptyPathname { URLPatternConstructorStringParserState::Protocol, URLPatternConstructorStringParserState::Authority, URLPatternConstructorStringParserState::Username, URLPatternConstructorStringParserState::Password, URLPatternConstructorStringParserState::Hostname, URLPatternConstructorStringParserState::Port };
        static constexpr std::array validNewStateConditionsForEmptyPathname { URLPatternConstructorStringParserState::Search, URLPatternConstructorStringParserState::Hash };
        if (std::ranges::find(validStateConditionsForEmptyPathname, m_state) != validStateConditionsForEmptyPathname.end()
            && std::ranges::find(validNewStateConditionsForEmptyPathname, newState) != validNewStateConditionsForEmptyPathname.end()
            && m_result.pathname.isNull()) {
            m_result.pathname = m_protocolMatchesSpecialSchemeFlag ? "/"_s : emptyString();
        }
        // Set init's search to empty if conditions are met.
        static constexpr std::array validStateConditionsForEmptySearch { URLPatternConstructorStringParserState::Protocol, URLPatternConstructorStringParserState::Authority, URLPatternConstructorStringParserState::Username, URLPatternConstructorStringParserState::Password, URLPatternConstructorStringParserState::Hostname, URLPatternConstructorStringParserState::Port, URLPatternConstructorStringParserState::Pathname };
        if (std::ranges::find(validStateConditionsForEmptySearch, m_state) != validStateConditionsForEmptySearch.end()
            && newState == URLPatternConstructorStringParserState::Hash
            && m_result.search.isNull()) {
            m_result.search = emptyString();
        }
    }

    m_state = newState;
    m_tokenIndex += skip;
    m_componentStart = m_tokenIndex;
    m_tokenIncrement = 0;
}

void URLPatternConstructorStringParser::updateState(ScriptExecutionContext& context)
{
    switch (m_state) {
    case URLPatternConstructorStringParserState::Init:
        // Look for protocol prefix.
        if (isNonSpecialPatternCharacter(m_tokenIndex, ':')) {
            rewind();
            m_state = URLPatternConstructorStringParserState::Protocol;
        }
        break;
    case URLPatternConstructorStringParserState::Protocol:
        // Look for protocol prefix.
        if (isNonSpecialPatternCharacter(m_tokenIndex, ':')) {
            auto maybeMatchesSpecialSchemeProtocol = computeProtocolMatchSpecialSchemeFlag(context);
            if (maybeMatchesSpecialSchemeProtocol.hasException())
                break; // FIXME: Return exceptions.
            auto nextState = URLPatternConstructorStringParserState::Pathname;
            auto skip = 1;
            if (isAuthoritySlashesNext()) {
                nextState = URLPatternConstructorStringParserState::Authority;
                skip = 3;
            } else if (m_protocolMatchesSpecialSchemeFlag)
                nextState = URLPatternConstructorStringParserState::Authority;
            changeState(nextState, skip);
        }
        break;
    case URLPatternConstructorStringParserState::Authority:
        // Look for identity terminator.
        if (isNonSpecialPatternCharacter(m_tokenIndex, '@')) {
            rewind();
            m_state = URLPatternConstructorStringParserState::Username;
        } else if (isNonSpecialPatternCharacter(m_tokenIndex, '/') || isSearchPrefix() || isNonSpecialPatternCharacter(m_tokenIndex, '#')) { // Look for pathname start, search prefix or hash prefix.
            rewind();
            m_state = URLPatternConstructorStringParserState::Hostname;
        }
        break;
    case URLPatternConstructorStringParserState::Username:
        // Look for password prefix.
        if (isNonSpecialPatternCharacter(m_tokenIndex, ':'))
            changeState(URLPatternConstructorStringParserState::Password, 1);
        // Look for identity terminator.
        else if (isNonSpecialPatternCharacter(m_tokenIndex, '@'))
            changeState(URLPatternConstructorStringParserState::Hostname, 1);
        break;
    case URLPatternConstructorStringParserState::Password:
        // Look for identity terminator.
        if (isNonSpecialPatternCharacter(m_tokenIndex, '@'))
            changeState(URLPatternConstructorStringParserState::Hostname, 1);
        break;
    case URLPatternConstructorStringParserState::Hostname:
        // Look for an IPv6 open.
        if (isNonSpecialPatternCharacter(m_tokenIndex, '['))
            ++m_hostnameIPv6BracketDepth;
        // Look for an IPv6 close.
        else if (isNonSpecialPatternCharacter(m_tokenIndex, ']') && m_hostnameIPv6BracketDepth > 0)
            --m_hostnameIPv6BracketDepth;
        // Look for port prefix.
        else if (isNonSpecialPatternCharacter(m_tokenIndex, ':') && !m_hostnameIPv6BracketDepth)
            changeState(URLPatternConstructorStringParserState::Port, 1);
        // Look for pathname start.
        else if (isNonSpecialPatternCharacter(m_tokenIndex, '/'))
            changeState(URLPatternConstructorStringParserState::Pathname, 0);
        // Look for search prefix.
        else if (isSearchPrefix())
            changeState(URLPatternConstructorStringParserState::Search, 1);
        // Look for hash prefix.
        else if (isNonSpecialPatternCharacter(m_tokenIndex, '#'))
            changeState(URLPatternConstructorStringParserState::Hash, 1);
        break;
    case URLPatternConstructorStringParserState::Port:
        // Look for pathname start.
        if (isNonSpecialPatternCharacter(m_tokenIndex, '/'))
            changeState(URLPatternConstructorStringParserState::Pathname, 0);
        else if (isSearchPrefix())
            changeState(URLPatternConstructorStringParserState::Search, 1);
        // Look for hash prefix.
        else if (isNonSpecialPatternCharacter(m_tokenIndex, '#'))
            changeState(URLPatternConstructorStringParserState::Hash, 1);
        break;
    case URLPatternConstructorStringParserState::Pathname:
        if (isSearchPrefix())
            changeState(URLPatternConstructorStringParserState::Search, 1);
        // Look for hash prefix.
        else if (isNonSpecialPatternCharacter(m_tokenIndex, '#'))
            changeState(URLPatternConstructorStringParserState::Hash, 1);
        break;
    case URLPatternConstructorStringParserState::Search:
        // Look for hash prefix.
        if (isNonSpecialPatternCharacter(m_tokenIndex, '#'))
            changeState(URLPatternConstructorStringParserState::Hash, 1);
        break;
    case URLPatternConstructorStringParserState::Hash:
        break;
    case URLPatternConstructorStringParserState::Done:
        ASSERT_NOT_REACHED();
        break;
    default:
        break;
    }
}

void URLPatternConstructorStringParser::performParse(ScriptExecutionContext& context)
{
    while (m_tokenIndex < m_tokenList.size()) {
        m_tokenIncrement = 1;

        if (m_tokenList[m_tokenIndex].type == URLPatternUtilities::TokenType::End) {
            if (m_state == URLPatternConstructorStringParserState::Init) {
                rewind();
                if (isNonSpecialPatternCharacter(m_tokenIndex, '#'))
                    changeState(URLPatternConstructorStringParserState::Hash, 1);
                else if (isSearchPrefix())
                    changeState(URLPatternConstructorStringParserState::Search, 1);
                else
                    changeState(URLPatternConstructorStringParserState::Pathname, 0);

                m_tokenIndex += m_tokenIncrement;
                continue;
            }
            if (m_state == URLPatternConstructorStringParserState::Authority) {
                rewind();
                m_state = URLPatternConstructorStringParserState::Hostname;
                m_tokenIndex += m_tokenIncrement;
                continue;
            }

            changeState(URLPatternConstructorStringParserState::Done, 0);
            break;
        }

        if (m_tokenList[m_tokenIndex].type == URLPatternUtilities::TokenType::Open) {
            ++m_groupDepth;
            ++m_tokenIndex;
            continue;
        }

        if (m_groupDepth) {
            if (m_tokenList[m_tokenIndex].type == URLPatternUtilities::TokenType::Close)
                --m_groupDepth;
            else {
                m_tokenIndex += m_tokenIncrement;
                continue;
            }
        }

        updateState(context);
        m_tokenIndex += m_tokenIncrement;
    }
    if (!m_result.hostname.isNull() && m_result.port.isNull())
        m_result.port = emptyString();
}

// https://urlpattern.spec.whatwg.org/#parse-a-constructor-string
ExceptionOr<URLPatternInit> URLPatternConstructorStringParser::parse(ScriptExecutionContext& context)
{
    auto maybeTokenList = URLPatternUtilities::Tokenizer(m_input, URLPatternUtilities::TokenizePolicy::Lenient).tokenize();
    if (maybeTokenList.hasException())
        return maybeTokenList.releaseException();
    m_tokenList = maybeTokenList.releaseReturnValue();

    performParse(context);

    return URLPatternInit { m_result };
}

}
