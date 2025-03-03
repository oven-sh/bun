/*
 * Copyright (C) 2020 Alexey Shvayka <shvaikalesh@gmail.com>.
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
#include "EventTargetInterfaces.h"
#include "ScriptExecutionContext.h"
#include <wtf/RefCounted.h>

namespace WebCore {

class EventTargetConcrete final : public RefCounted<EventTargetConcrete>, public EventTargetWithInlineData, private ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(EventTargetConcrete);

public:
    static Ref<EventTargetConcrete> create(ScriptExecutionContext&);

    bool hasEventTargetData() const { return true; }

    using RefCounted::deref;
    using RefCounted::ref;

private:
    explicit EventTargetConcrete(ScriptExecutionContext&);

    EventTargetInterface eventTargetInterface() const final { return EventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
};

} // namespace WebCore
