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
#include "URLPattern.h"

#include "ExceptionOr.h"
#include "ScriptExecutionContext.h"
#include "URLPatternCanonical.h"
#include "URLPatternConstructorStringParser.h"
#include "URLPatternInit.h"
#include "URLPatternOptions.h"
#include "URLPatternParser.h"
#include "URLPatternResult.h"
#include <JavaScriptCore/RegExp.h>
#include <wtf/RefCounted.h>
#include <wtf/URL.h>
#include <wtf/URLParser.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace WebCore {
using namespace JSC;

// https://urlpattern.spec.whatwg.org/#process-a-base-url-string
static String processBaseURLString(StringView input, BaseURLStringType type)
{
    if (type != BaseURLStringType::Pattern)
        return input.toString();

    return URLPatternUtilities::escapePatternString(input);
}

// https://urlpattern.spec.whatwg.org/#hostname-pattern-is-an-ipv6-address
static bool isHostnamePatternIPv6(StringView hostname)
{
    if (hostname.length() < 2)
        return false;
    if (hostname[0] == '[')
        return true;
    if (hostname[0] == '{' && hostname[1] == '[')
        return true;
    if (hostname[0] == '\\' && hostname[1] == '[')
        return true;
    return false;
}

URLPattern::URLPattern() = default;

// https://urlpattern.spec.whatwg.org/#process-a-urlpatterninit
static ExceptionOr<URLPatternInit> processInit(URLPatternInit&& init, BaseURLStringType type, String&& protocol = {}, String&& username = {}, String&& password = {}, String&& hostname = {}, String&& port = {}, String&& pathname = {}, String&& search = {}, String&& hash = {})
{
    URLPatternInit result { WTF::move(protocol), WTF::move(username), WTF::move(password), WTF::move(hostname), WTF::move(port), WTF::move(pathname), WTF::move(search), WTF::move(hash), {} };

    URL baseURL;

    if (!init.baseURL.isNull()) {
        baseURL = URL(init.baseURL);

        if (!baseURL.isValid())
            return Exception { ExceptionCode::TypeError, "Invalid baseURL."_s };

        if (init.protocol.isNull())
            result.protocol = processBaseURLString(baseURL.protocol(), type);

        if (type != BaseURLStringType::Pattern
            && init.protocol.isNull()
            && init.hostname.isNull()
            && init.port.isNull()
            && init.username.isNull())
            result.username = processBaseURLString(baseURL.user(), type);

        if (type != BaseURLStringType::Pattern
            && init.protocol.isNull()
            && init.hostname.isNull()
            && init.port.isNull()
            && init.username.isNull()
            && init.password.isNull())
            result.password = processBaseURLString(baseURL.password(), type);

        if (init.protocol.isNull()
            && init.hostname.isNull()) {
            result.hostname = processBaseURLString(!baseURL.host().isNull() ? baseURL.host() : StringView { emptyString() }, type);
        }

        if (init.protocol.isNull()
            && init.hostname.isNull()
            && init.port.isNull()) {
            auto port = baseURL.port();
            result.port = port ? String::number(*port) : emptyString();
        }

        if (init.protocol.isNull()
            && init.hostname.isNull()
            && init.port.isNull()
            && init.pathname.isNull()) {
            result.pathname = processBaseURLString(baseURL.path(), type);
        }

        if (init.protocol.isNull()
            && init.hostname.isNull()
            && init.port.isNull()
            && init.pathname.isNull()
            && init.search.isNull()) {
            result.search = processBaseURLString(baseURL.hasQuery() ? baseURL.query() : StringView { emptyString() }, type);
        }

        if (init.protocol.isNull()
            && init.hostname.isNull()
            && init.port.isNull()
            && init.pathname.isNull()
            && init.search.isNull()
            && init.hash.isNull()) {
            result.hash = processBaseURLString(baseURL.hasFragmentIdentifier() ? baseURL.fragmentIdentifier() : StringView { emptyString() }, type);
        }
    }

    if (!init.protocol.isNull()) {
        auto protocolResult = canonicalizeProtocol(init.protocol, type);

        if (protocolResult.hasException())
            return protocolResult.releaseException();

        result.protocol = protocolResult.releaseReturnValue();
    }

    if (!init.username.isNull())
        result.username = canonicalizeUsername(init.username, type);

    if (!init.password.isNull())
        result.password = canonicalizePassword(init.password, type);

    if (!init.hostname.isNull()) {
        auto hostResult = canonicalizeHostname(init.hostname, type);

        if (hostResult.hasException())
            return hostResult.releaseException();

        result.hostname = hostResult.releaseReturnValue();
    }

    if (!init.port.isNull()) {
        auto portResult = canonicalizePort(init.port, result.protocol, type);

        if (portResult.hasException())
            return portResult.releaseException();

        result.port = portResult.releaseReturnValue();
    }

    if (!init.pathname.isNull()) {
        result.pathname = init.pathname;

        if (!baseURL.isNull() && !baseURL.hasOpaquePath() && !isAbsolutePathname(result.pathname, type)) {
            auto baseURLPath = processBaseURLString(baseURL.path(), type);
            size_t slashIndex = baseURLPath.reverseFind('/');

            if (slashIndex != notFound)
                result.pathname = makeString(StringView { baseURLPath }.left(slashIndex + 1), result.pathname);
        }
        auto pathResult = processPathname(result.pathname, result.protocol, type);

        if (pathResult.hasException())
            return pathResult.releaseException();

        result.pathname = pathResult.releaseReturnValue();
    }

    if (!init.search.isNull()) {
        auto queryResult = canonicalizeSearch(init.search, type);

        if (queryResult.hasException())
            return queryResult.releaseException();

        result.search = queryResult.releaseReturnValue();
    }

    if (!init.hash.isNull()) {
        auto fragmentResult = canonicalizeHash(init.hash, type);

        if (fragmentResult.hasException())
            return fragmentResult.releaseException();

        result.hash = fragmentResult.releaseReturnValue();
    }

    return result;
}

// https://urlpattern.spec.whatwg.org/#url-pattern-create
ExceptionOr<Ref<URLPattern>> URLPattern::create(ScriptExecutionContext& context, URLPatternInput&& input, String&& baseURL, URLPatternOptions&& options)
{
    URLPatternInit init;

    if (std::holds_alternative<String>(input) && !std::get<String>(input).isNull()) {
        auto maybeInit = URLPatternConstructorStringParser(WTF::move(std::get<String>(input))).parse(context);
        if (maybeInit.hasException())
            return maybeInit.releaseException();
        init = maybeInit.releaseReturnValue();

        if (baseURL.isNull() && init.protocol.isEmpty())
            return Exception { ExceptionCode::TypeError, "Relative constructor string must have additional baseURL argument."_s };
        init.baseURL = WTF::move(baseURL);
    } else if (std::holds_alternative<URLPatternInit>(input)) {
        if (!baseURL.isNull())
            return Exception { ExceptionCode::TypeError, "Constructor with a URLPatternInit should have a null baseURL argument."_s };
        init = std::get<URLPatternInit>(input);
    }

    auto maybeProcessedInit = processInit(WTF::move(init), BaseURLStringType::Pattern);

    if (maybeProcessedInit.hasException())
        return maybeProcessedInit.releaseException();

    auto processedInit = maybeProcessedInit.releaseReturnValue();
    if (!processedInit.protocol)
        processedInit.protocol = "*"_s;
    if (!processedInit.username)
        processedInit.username = "*"_s;
    if (!processedInit.password)
        processedInit.password = "*"_s;
    if (!processedInit.hostname)
        processedInit.hostname = "*"_s;
    if (!processedInit.pathname)
        processedInit.pathname = "*"_s;
    if (!processedInit.search)
        processedInit.search = "*"_s;
    if (!processedInit.hash)
        processedInit.hash = "*"_s;
    if (!processedInit.port)
        processedInit.port = "*"_s;

    if (auto parsedPort = parseInteger<uint16_t>(processedInit.port, 10, WTF::ParseIntegerWhitespacePolicy::Disallow)) {
        if (WTF::URLParser::isSpecialScheme(processedInit.protocol) && isDefaultPortForProtocol(*parsedPort, processedInit.protocol))
            processedInit.port = emptyString();
    }

    Ref result = adoptRef(*new URLPattern);

    auto maybeCompileException = result->compileAllComponents(context, WTF::move(processedInit), options);
    if (maybeCompileException.hasException())
        return maybeCompileException.releaseException();

    return result;
}

// https://urlpattern.spec.whatwg.org/#urlpattern-initialize
ExceptionOr<Ref<URLPattern>> URLPattern::create(ScriptExecutionContext& context, std::optional<URLPatternInput>&& input, URLPatternOptions&& options)
{
    if (!input)
        input = URLPatternInit {};

    return create(context, WTF::move(*input), String {}, WTF::move(options));
}

// https://urlpattern.spec.whatwg.org/#build-a-url-pattern-from-a-web-idl-value
ExceptionOr<Ref<URLPattern>> URLPattern::create(ScriptExecutionContext& context, Compatible&& value, const String& baseURL)
{
    return switchOn(WTF::move(value), [&](RefPtr<URLPattern>&& pattern) -> ExceptionOr<Ref<URLPattern>> { return pattern.releaseNonNull(); }, [&](URLPatternInit&& init) -> ExceptionOr<Ref<URLPattern>> { return URLPattern::create(context, WTF::move(init), {}, {}); }, [&](String&& string) -> ExceptionOr<Ref<URLPattern>> { return URLPattern::create(context, WTF::move(string), String { baseURL }, {}); });
}

URLPattern::~URLPattern() = default;

// https://urlpattern.spec.whatwg.org/#dom-urlpattern-test
ExceptionOr<bool> URLPattern::test(ScriptExecutionContext& context, std::optional<URLPatternInput>&& input, String&& baseURL) const
{
    if (!input)
        input = URLPatternInit {};

    auto maybeResult = match(context, WTF::move(*input), WTF::move(baseURL));
    if (maybeResult.hasException())
        return maybeResult.releaseException();

    return !!maybeResult.returnValue();
}

// https://urlpattern.spec.whatwg.org/#dom-urlpattern-exec
ExceptionOr<std::optional<URLPatternResult>> URLPattern::exec(ScriptExecutionContext& context, std::optional<URLPatternInput>&& input, String&& baseURL) const
{
    if (!input)
        input = URLPatternInit {};

    return match(context, WTF::move(*input), WTF::move(baseURL));
}

ExceptionOr<void> URLPattern::compileAllComponents(ScriptExecutionContext& context, URLPatternInit&& processedInit, const URLPatternOptions& options)
{
    Ref vm = context.vm();
    JSC::JSLockHolder lock(vm);

    auto maybeProtocolComponent = URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.protocol, EncodingCallbackType::Protocol, URLPatternUtilities::URLPatternStringOptions {});
    if (maybeProtocolComponent.hasException())
        return maybeProtocolComponent.releaseException();
    m_protocolComponent = maybeProtocolComponent.releaseReturnValue();

    auto maybeUsernameComponent = URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.username, EncodingCallbackType::Username, URLPatternUtilities::URLPatternStringOptions {});
    if (maybeUsernameComponent.hasException())
        return maybeUsernameComponent.releaseException();
    m_usernameComponent = maybeUsernameComponent.releaseReturnValue();

    auto maybePasswordComponent = URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.password, EncodingCallbackType::Password, URLPatternUtilities::URLPatternStringOptions {});
    if (maybePasswordComponent.hasException())
        return maybePasswordComponent.releaseException();
    m_passwordComponent = maybePasswordComponent.releaseReturnValue();

    auto hostnameEncodingCallbackType = isHostnamePatternIPv6(processedInit.hostname) ? EncodingCallbackType::IPv6Host : EncodingCallbackType::Host;
    auto maybeHostnameComponent = URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.hostname, hostnameEncodingCallbackType, URLPatternUtilities::URLPatternStringOptions { .delimiterCodepoint = "."_s });
    if (maybeHostnameComponent.hasException())
        return maybeHostnameComponent.releaseException();
    m_hostnameComponent = maybeHostnameComponent.releaseReturnValue();

    auto maybePortComponent = URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.port, EncodingCallbackType::Port, URLPatternUtilities::URLPatternStringOptions {});
    if (maybePortComponent.hasException())
        return maybePortComponent.releaseException();
    m_portComponent = maybePortComponent.releaseReturnValue();

    URLPatternUtilities::URLPatternStringOptions compileOptions { .ignoreCase = options.ignoreCase };

    auto maybePathnameComponent = m_protocolComponent.matchSpecialSchemeProtocol(context)
        ? URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.pathname, EncodingCallbackType::Path, URLPatternUtilities::URLPatternStringOptions { "/"_s, "/"_s, options.ignoreCase })
        : URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.pathname, EncodingCallbackType::OpaquePath, compileOptions);
    if (maybePathnameComponent.hasException())
        return maybePathnameComponent.releaseException();
    m_pathnameComponent = maybePathnameComponent.releaseReturnValue();

    auto maybeSearchComponent = URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.search, EncodingCallbackType::Search, compileOptions);
    if (maybeSearchComponent.hasException())
        return maybeSearchComponent.releaseException();
    m_searchComponent = maybeSearchComponent.releaseReturnValue();

    auto maybeHashComponent = URLPatternUtilities::URLPatternComponent::compile(vm, processedInit.hash, EncodingCallbackType::Hash, compileOptions);
    if (maybeHashComponent.hasException())
        return maybeHashComponent.releaseException();
    m_hashComponent = maybeHashComponent.releaseReturnValue();

    return {};
}

static inline void matchHelperAssignInputsFromURL(const URL& input, String& protocol, String& username, String& password, String& hostname, String& port, String& pathname, String& search, String& hash)
{
    protocol = input.protocol().toString();
    username = input.user();
    password = input.password();
    hostname = input.host().toString();
    port = input.port() ? String::number(*input.port()) : emptyString();
    pathname = input.path().toString();
    search = input.query().toString();
    hash = input.fragmentIdentifier().toString();
}

static inline void matchHelperAssignInputsFromInit(const URLPatternInit& input, String& protocol, String& username, String& password, String& hostname, String& port, String& pathname, String& search, String& hash)
{
    protocol = input.protocol;
    username = input.username;
    password = input.password;
    hostname = input.hostname;
    port = input.port;
    pathname = input.pathname;
    search = input.search;
    hash = input.hash;
}

// https://urlpattern.spec.whatwg.org/#url-pattern-match
ExceptionOr<std::optional<URLPatternResult>> URLPattern::match(ScriptExecutionContext& context, Variant<URL, URLPatternInput>&& input, String&& baseURLString) const
{
    URLPatternResult result;
    String protocol, username, password, hostname, port, pathname, search, hash;

    if (URL* inputURL = std::get_if<URL>(&input)) {
        ASSERT(!inputURL->isEmpty() && inputURL->isValid());
        matchHelperAssignInputsFromURL(*inputURL, protocol, username, password, hostname, port, pathname, search, hash);
        result.inputs = Vector<URLPatternInput> { String { inputURL->string() } };
    } else {
        URLPatternInput* inputPattern = std::get_if<URLPatternInput>(&input);
        result.inputs.append(*inputPattern);

        auto hasError = WTF::switchOn(*inputPattern, [&](const URLPatternInit& value) -> ExceptionOr<bool> {
            if (!baseURLString.isNull())
                return Exception { ExceptionCode::TypeError, "Base URL string is provided with a URLPatternInit. If URLPatternInit is provided, please use URLPatternInit.baseURL property instead"_s };

            URLPatternInit initCopy = value;
            auto maybeResult = processInit(WTF::move(initCopy), BaseURLStringType::URL);
            if (maybeResult.hasException())
                return true;

            matchHelperAssignInputsFromInit(maybeResult.releaseReturnValue(), protocol, username, password, hostname, port, pathname, search, hash);
            return false; }, [&](const String& value) -> ExceptionOr<bool> {
            URL baseURL;
            if (!baseURLString.isNull()) {
                baseURL = URL { baseURLString };
                if (!baseURL.isValid())
                    return true;
                result.inputs.append(baseURLString);
            }
            URL url { baseURL, value };
            if (!url.isValid())
                return true;

            matchHelperAssignInputsFromURL(url, protocol, username, password, hostname, port, pathname, search, hash);
            return false; });

        if (hasError.hasException())
            return hasError.releaseException();
        if (hasError.returnValue())
            return { std::nullopt };
    }

    auto protocolExecResult = m_protocolComponent.componentExec(context, protocol);
    if (protocolExecResult.isNull() || protocolExecResult.isUndefined())
        return { std::nullopt };

    auto* globalObject = context.globalObject();
    if (!globalObject)
        return { std::nullopt };
    result.protocol = m_protocolComponent.createComponentMatchResult(globalObject, WTF::move(protocol), protocolExecResult);

    auto usernameExecResult = m_usernameComponent.componentExec(context, username);
    if (usernameExecResult.isNull() || usernameExecResult.isUndefined())
        return { std::nullopt };
    result.username = m_usernameComponent.createComponentMatchResult(globalObject, WTF::move(username), usernameExecResult);

    auto passwordExecResult = m_passwordComponent.componentExec(context, password);
    if (passwordExecResult.isNull() || passwordExecResult.isUndefined())
        return { std::nullopt };
    result.password = m_passwordComponent.createComponentMatchResult(globalObject, WTF::move(password), passwordExecResult);

    auto hostnameExecResult = m_hostnameComponent.componentExec(context, hostname);
    if (hostnameExecResult.isNull() || hostnameExecResult.isUndefined())
        return { std::nullopt };
    result.hostname = m_hostnameComponent.createComponentMatchResult(globalObject, WTF::move(hostname), hostnameExecResult);

    auto pathnameExecResult = m_pathnameComponent.componentExec(context, pathname);
    if (pathnameExecResult.isNull() || pathnameExecResult.isUndefined())
        return { std::nullopt };
    result.pathname = m_pathnameComponent.createComponentMatchResult(globalObject, WTF::move(pathname), pathnameExecResult);

    auto portExecResult = m_portComponent.componentExec(context, port);
    if (portExecResult.isNull() || portExecResult.isUndefined())
        return { std::nullopt };
    result.port = m_portComponent.createComponentMatchResult(globalObject, WTF::move(port), portExecResult);

    auto searchExecResult = m_searchComponent.componentExec(context, search);
    if (searchExecResult.isNull() || searchExecResult.isUndefined())
        return { std::nullopt };
    result.search = m_searchComponent.createComponentMatchResult(globalObject, WTF::move(search), searchExecResult);

    auto hashExecResult = m_hashComponent.componentExec(context, hash);
    if (hashExecResult.isNull() || hashExecResult.isUndefined())
        return { std::nullopt };
    result.hash = m_hashComponent.createComponentMatchResult(globalObject, WTF::move(hash), hashExecResult);

    return { result };
}

// https://urlpattern.spec.whatwg.org/#url-pattern-has-regexp-groups
bool URLPattern::hasRegExpGroups() const
{
    return m_protocolComponent.hasRegexGroupsFromPartList()
        || m_usernameComponent.hasRegexGroupsFromPartList()
        || m_passwordComponent.hasRegexGroupsFromPartList()
        || m_hostnameComponent.hasRegexGroupsFromPartList()
        || m_pathnameComponent.hasRegexGroupsFromPartList()
        || m_portComponent.hasRegexGroupsFromPartList()
        || m_searchComponent.hasRegexGroupsFromPartList()
        || m_hashComponent.hasRegexGroupsFromPartList();
}

}
