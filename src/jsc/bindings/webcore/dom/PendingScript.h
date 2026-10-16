/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
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

#include "LoadableScript.h"
#include "LoadableScriptClient.h"
#include <wtf/CheckedPtr.h>
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/text/TextPosition.h>

namespace WebCore {

class CachedScript;
class PendingScriptClient;
class ScriptElement;

// A container for scripts which may be loaded and executed.
// This can hold LoadableScript and non external inline script.
class PendingScript final : public RefCounted<PendingScript>, public LoadableScriptClient {
public:
    static Ref<PendingScript> create(ScriptElement&, LoadableScript&);
    static Ref<PendingScript> create(ScriptElement&, TextPosition scriptStartPosition);

    virtual ~PendingScript();

    // LoadableScriptClient.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }

    TextPosition startingPosition() const { return m_startingPosition; }
    void setStartingPosition(const TextPosition& position) { m_startingPosition = position; }

    bool watchingForLoad() const { return needsLoading() && m_client; }

    ScriptElement& element() { return m_element.get(); }
    const ScriptElement& element() const { return m_element.get(); }

    LoadableScript* loadableScript() const;
    bool needsLoading() const { return loadableScript(); }

    bool isLoaded() const;
    bool hasError() const;

    void notifyFinished(LoadableScript&) override;

    void setClient(PendingScriptClient&);
    void clearClient();

private:
    PendingScript(ScriptElement&, LoadableScript&);
    PendingScript(ScriptElement&, TextPosition startingPosition);

    void notifyClientFinished();

    const Ref<ScriptElement> m_element;
    TextPosition m_startingPosition; // Only used for inline script tags.
    const RefPtr<LoadableScript> m_loadableScript;
    CheckedPtr<PendingScriptClient> m_client;
};

inline LoadableScript* PendingScript::loadableScript() const
{
    return m_loadableScript.get();
}

}
