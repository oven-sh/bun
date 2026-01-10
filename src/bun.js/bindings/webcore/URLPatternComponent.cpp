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
#include "URLPatternComponent.h"

#include "ExceptionOr.h"
#include "ScriptExecutionContext.h"
#include "URLPatternCanonical.h"
#include "URLPatternParser.h"
#include "URLPatternResult.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/RegExpObject.h>
#include <ranges>

namespace WebCore {
using namespace JSC;
namespace URLPatternUtilities {

URLPatternComponent::URLPatternComponent(String&& patternString, JSC::Strong<JSC::RegExp>&& regex, Vector<String>&& groupNameList, bool hasRegexpGroupsFromPartsList)
    : m_patternString(WTF::move(patternString))
    , m_regularExpression(WTF::move(regex))
    , m_groupNameList(WTF::move(groupNameList))
    , m_hasRegexGroupsFromPartList(hasRegexpGroupsFromPartsList)
{
}

// https://urlpattern.spec.whatwg.org/#compile-a-component
ExceptionOr<URLPatternComponent> URLPatternComponent::compile(Ref<JSC::VM> vm, StringView input, EncodingCallbackType type, const URLPatternStringOptions& options)
{
    auto maybePartList = URLPatternParser::parse(input, options, type);
    if (maybePartList.hasException())
        return maybePartList.releaseException();
    Vector<Part> partList = maybePartList.releaseReturnValue();

    auto [regularExpressionString, nameList] = generateRegexAndNameList(partList, options);

    OptionSet<JSC::Yarr::Flags> flags = { JSC::Yarr::Flags::UnicodeSets };
    if (options.ignoreCase)
        flags.add(JSC::Yarr::Flags::IgnoreCase);

    JSC::RegExp* regularExpression = JSC::RegExp::create(vm, regularExpressionString, flags);
    if (!regularExpression->isValid())
        return Exception { ExceptionCode::TypeError, "Unable to create RegExp object regular expression from provided URLPattern string."_s };

    String patternString = generatePatternString(partList, options);

    bool hasRegexGroups = partList.containsIf([](auto& part) {
        return part.type == PartType::Regexp;
    });

    return URLPatternComponent { WTF::move(patternString), JSC::Strong<JSC::RegExp> { vm, regularExpression }, WTF::move(nameList), hasRegexGroups };
}

// https://urlpattern.spec.whatwg.org/#protocol-component-matches-a-special-scheme
bool URLPatternComponent::matchSpecialSchemeProtocol(ScriptExecutionContext& context) const
{
    Ref vm = context.vm();
    JSC::JSLockHolder lock(vm);

    static constexpr std::array specialSchemeList { "ftp"_s, "file"_s, "http"_s, "https"_s, "ws"_s, "wss"_s };
    auto contextObject = context.globalObject();
    if (!contextObject)
        return false;
    auto protocolRegex = JSC::RegExpObject::create(vm, contextObject->regExpStructure(), m_regularExpression.get(), true);

    auto isSchemeMatch = std::ranges::find_if(specialSchemeList, [context = Ref { context }, &vm, &protocolRegex](const String& scheme) {
        auto maybeMatch = protocolRegex->exec(context->globalObject(), JSC::jsString(vm, scheme));
        return !maybeMatch.isNull();
    });

    return isSchemeMatch != specialSchemeList.end();
}

JSC::JSValue URLPatternComponent::componentExec(ScriptExecutionContext& context, StringView comparedString) const
{
    Ref vm = context.vm();
    JSC::JSLockHolder lock(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto contextObject = context.globalObject();
    if (!contextObject) {
        throwTypeError(contextObject, throwScope, "URLPattern execution requires a valid execution context"_s);
        return {};
    }
    auto regex = JSC::RegExpObject::create(vm, contextObject->regExpStructure(), m_regularExpression.get(), true);
    return regex->exec(contextObject, JSC::jsString(vm, comparedString));
}

// https://urlpattern.spec.whatwg.org/#create-a-component-match-result
URLPatternComponentResult URLPatternComponent::createComponentMatchResult(JSC::JSGlobalObject* globalObject, String&& input, const JSC::JSValue& execResult) const
{
    URLPatternComponentResult::GroupsRecord groups;

    Ref vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto lengthValue = execResult.get(globalObject, vm->propertyNames->length);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto length = lengthValue.toIntegerOrInfinity(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    ASSERT(length >= 0 && std::isfinite(length));

    for (unsigned index = 1; index < length; ++index) {
        auto match = execResult.get(globalObject, index);
        RETURN_IF_EXCEPTION(throwScope, {});

        Variant<std::monostate, String> value;
        if (!match.isNull() && !match.isUndefined()) {
            value = match.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        size_t groupIndex = index - 1;
        String groupName = groupIndex < m_groupNameList.size() ? m_groupNameList[groupIndex] : emptyString();
        groups.append(URLPatternComponentResult::NameMatchPair { WTF::move(groupName), WTF::move(value) });
    }

    return URLPatternComponentResult { !input.isEmpty() ? WTF::move(input) : emptyString(), WTF::move(groups) };
}

}
}
