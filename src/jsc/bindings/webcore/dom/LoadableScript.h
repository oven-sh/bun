/*
 * Copyright (C) 2016 Apple, Inc. All rights reserved.
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

#pragma once

#include "ScriptElementCachedScriptFetcher.h"
#include <wtf/CheckedRef.h>
#include <wtf/WeakHashCountedSet.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class LoadableScriptClient;
class ScriptElement;

struct LoadableScriptConsoleMessage;
struct LoadableScriptError;

enum class LoadableScriptErrorType : uint8_t;

class LoadableScript : public ScriptElementCachedScriptFetcher {
public:
    using ConsoleMessage = LoadableScriptConsoleMessage;
    using Error = LoadableScriptError;
    using ErrorType = LoadableScriptErrorType;

    virtual ~LoadableScript();

    virtual bool isLoaded() const = 0;
    virtual bool hasError() const = 0;
    virtual std::optional<Error> takeError() = 0;
    virtual bool wasCanceled() const = 0;
    virtual bool isInlineModule() const = 0;

    virtual void execute(ScriptElement&) = 0;

    void addClient(LoadableScriptClient&);
    void removeClient(LoadableScriptClient&);

protected:
    LoadableScript(const AtomString& nonce, ReferrerPolicy, RequestPriority, const AtomString& crossOriginMode, const AtomString& charset, const AtomString& initiatorType, bool isInUserAgentShadowTree);

    void notifyClientFinished();

private:
    WeakHashCountedSet<LoadableScriptClient> m_clients;
};

}
