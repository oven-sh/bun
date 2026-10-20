/*
 * Copyright (C) 2017 Yusuke Suzuki <utatane.tea@gmail.com>
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

#include "CachedScriptFetcher.h"
#include "ResourceLoaderOptions.h"
#include "ScriptType.h"

namespace WebCore {

class ScriptElementCachedScriptFetcher : public CachedScriptFetcher {
public:
    static const ASCIILiteral defaultCrossOriginModeForModule;

    virtual CachedResourceHandle<CachedResource> requestModuleResource(Document&, const URL& sourceURL, FetchOptionsDestination, String&& integrity, std::optional<ServiceWorkersMode>, const URL& referrer) const;

    virtual ScriptType scriptType() const = 0;
    bool isClassicScript() const { return scriptType() == ScriptType::Classic; }
    bool isModuleScript() const { return scriptType() == ScriptType::Module; }
    bool isImportMap() const { return scriptType() == ScriptType::ImportMap; }
    bool isSpeculationRules() const { return scriptType() == ScriptType::SpeculationRules; }

    const String& crossOriginMode() const LIFETIME_BOUND { return m_crossOriginMode; }

protected:
    ScriptElementCachedScriptFetcher(const AtomString& nonce, ReferrerPolicy policy, RequestPriority fetchPriority, const AtomString& crossOriginMode, const AtomString& charset, const AtomString& initiatorType, bool isInUserAgentShadowTree)
        : CachedScriptFetcher(nonce, policy, fetchPriority, charset, initiatorType, isInUserAgentShadowTree)
        , m_crossOriginMode(crossOriginMode)
    {
    }

private:
    const AtomString m_crossOriginMode;
};

} // namespace WebCore
