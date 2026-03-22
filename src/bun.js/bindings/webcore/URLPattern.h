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

#include "root.h"
#include "URLPatternComponent.h"
#include "URLPatternInit.h"
#include <wtf/Forward.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class ScriptExecutionContext;
struct URLPatternOptions;
struct URLPatternResult;
template<typename> class ExceptionOr;

enum class BaseURLStringType : bool { Pattern,
    URL };

namespace URLPatternUtilities {
class URLPatternComponent;
}

class URLPattern final : public RefCounted<URLPattern> {
    WTF_MAKE_TZONE_ALLOCATED(URLPattern);

public:
    using URLPatternInput = Variant<String, URLPatternInit>;

    static ExceptionOr<Ref<URLPattern>> create(ScriptExecutionContext&, URLPatternInput&&, String&& baseURL, URLPatternOptions&&);
    static ExceptionOr<Ref<URLPattern>> create(ScriptExecutionContext&, std::optional<URLPatternInput>&&, URLPatternOptions&&);

    using Compatible = Variant<String, URLPatternInit, RefPtr<URLPattern>>;
    static ExceptionOr<Ref<URLPattern>> create(ScriptExecutionContext&, Compatible&&, const String&);

    ~URLPattern();

    ExceptionOr<bool> test(ScriptExecutionContext&, std::optional<URLPatternInput>&&, String&& baseURL) const;

    ExceptionOr<std::optional<URLPatternResult>> exec(ScriptExecutionContext&, std::optional<URLPatternInput>&&, String&& baseURL) const;

    const String& protocol() const { return m_protocolComponent.patternString(); }
    const String& username() const { return m_usernameComponent.patternString(); }
    const String& password() const { return m_passwordComponent.patternString(); }
    const String& hostname() const { return m_hostnameComponent.patternString(); }
    const String& port() const { return m_portComponent.patternString(); }
    const String& pathname() const { return m_pathnameComponent.patternString(); }
    const String& search() const { return m_searchComponent.patternString(); }
    const String& hash() const { return m_hashComponent.patternString(); }

    bool hasRegExpGroups() const;

private:
    URLPattern();
    ExceptionOr<void> compileAllComponents(ScriptExecutionContext&, URLPatternInit&&, const URLPatternOptions&);
    ExceptionOr<std::optional<URLPatternResult>> match(ScriptExecutionContext&, Variant<URL, URLPatternInput>&&, String&& baseURLString) const;

    URLPatternUtilities::URLPatternComponent m_protocolComponent;
    URLPatternUtilities::URLPatternComponent m_usernameComponent;
    URLPatternUtilities::URLPatternComponent m_passwordComponent;
    URLPatternUtilities::URLPatternComponent m_hostnameComponent;
    URLPatternUtilities::URLPatternComponent m_pathnameComponent;
    URLPatternUtilities::URLPatternComponent m_portComponent;
    URLPatternUtilities::URLPatternComponent m_searchComponent;
    URLPatternUtilities::URLPatternComponent m_hashComponent;
};

}
