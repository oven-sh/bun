/*
 * Copyright (C) 2015-2021 Apple Inc. All rights reserved.
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
#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class ScriptExecutionContext;

// https://w3c.github.io/clipboard-apis/#clipboard-interface
// The async methods live on the JS wrapper (they call Bun's Rust clipboard
// backend); the impl object only provides the EventTarget identity that
// `copy`/`paste` events are fired at.
class Clipboard final : public RefCounted<Clipboard>, public ContextDestructionObserver, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(Clipboard);

public:
    static Ref<Clipboard> create(ScriptExecutionContext* context) { return adoptRef(*new Clipboard(context)); }
    ~Clipboard();

    // The runtime projection of the spec's clipboard events: there is no
    // document or focused element, so successful operations fire at this
    // EventTarget (`navigator.clipboard`), matching `clipboardchange`.
    void fireClipboardEvent(const AtomString& type);

    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    EventTargetInterface eventTargetInterface() const final { return ClipboardEventTargetInterfaceType; }

    using RefCounted::deref;
    using RefCounted::ref;

private:
    explicit Clipboard(ScriptExecutionContext*);

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
};

} // namespace WebCore
