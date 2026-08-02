/*
 * Copyright (C) 2010 Google Inc. All Rights Reserved.
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
 *
 */

#pragma once

#include "root.h"
#include "Event.h"

#include "Node.h"

namespace WebCore {

class EventContext {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(EventContext);

public:
    using EventInvokePhase = EventTarget::EventInvokePhase;

    EventContext(Node*, EventTarget* currentTarget, EventTarget* origin, int closedShadowDepth);
    ~EventContext();

    EventTarget* currentTarget() const { return m_currentTarget.get(); }
    bool isCurrentTargetInShadowTree() const { return false; }
    EventTarget* target() const { return m_target.get(); }
    int closedShadowDepth() const { return 0; }

private:
    RefPtr<Node> m_node;
    RefPtr<EventTarget> m_currentTarget;
    RefPtr<EventTarget> m_target;
    [[maybe_unused]] int m_closedShadowDepth { 0 };
    [[maybe_unused]] bool m_currentTargetIsInShadowTree { false };
};

inline EventContext::EventContext(Node* node, EventTarget* currentTarget, EventTarget* origin, int closedShadowDepth)
    : m_node { node }
    , m_currentTarget { currentTarget }
    , m_target { origin }
    , m_closedShadowDepth { closedShadowDepth }
{
}

} // namespace WebCore
