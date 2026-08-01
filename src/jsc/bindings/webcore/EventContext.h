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

    enum class Type : uint8_t {
        Normal = 0,
        MouseOrFocus,
        Touch,
        Window,
    };

    EventContext(Type, Node*, EventTarget* currentTarget, EventTarget* origin, int closedShadowDepth);
    EventContext(Type, Node&, Node* currentTarget, EventTarget* origin, int closedShadowDepth);
    ~EventContext();

    Node* node() const { return m_node.get(); }
    EventTarget* currentTarget() const { return m_currentTarget.get(); }
    // bool isCurrentTargetInShadowTree() const { return m_currentTargetIsInShadowTree; }
    bool isCurrentTargetInShadowTree() const { return false; }
    EventTarget* target() const { return m_target.get(); }
    // int closedShadowDepth() const { return m_closedShadowDepth; }
    int closedShadowDepth() const { return 0; }

    void handleLocalEvents(Event&, EventInvokePhase) const;

    // bool isMouseOrFocusEventContext() const { return m_type == Type::MouseOrFocus; }
    bool isMouseOrFocusEventContext() const { return false; }
    // bool isTouchEventContext() const { return m_type == Type::Touch; }
    bool isTouchEventContext() const { return false; }
    // bool isWindowContext() const { return m_type == Type::Window; }
    bool isWindowContext() const { return false; }

    Node* relatedTarget() const { return m_relatedTarget.get(); }
    void setRelatedTarget(Node*);

#if ENABLE(TOUCH_EVENTS)
    enum TouchListType { Touches,
        TargetTouches,
        ChangedTouches };
    TouchList& touchList(TouchListType);
#endif

private:
    inline EventContext(Type, Node* currentNode, RefPtr<EventTarget>&& currentTarget, EventTarget* origin, int closedShadowDepth, bool currentTargetIsInShadowTree = false);

#if ENABLE(TOUCH_EVENTS)
    void initializeTouchLists();
#endif

#if ASSERT_ENABLED
    bool isUnreachableNode(EventTarget*) const;
#endif

    RefPtr<Node> m_node;
    RefPtr<EventTarget> m_currentTarget;
    RefPtr<EventTarget> m_target;
    RefPtr<Node> m_relatedTarget;
#if ENABLE(TOUCH_EVENTS)
    RefPtr<TouchList> m_touches;
    RefPtr<TouchList> m_targetTouches;
    RefPtr<TouchList> m_changedTouches;
#endif
    [[maybe_unused]] int m_closedShadowDepth { 0 };
    [[maybe_unused]] bool m_currentTargetIsInShadowTree { false };
    [[maybe_unused]] bool m_contextNodeIsFormElement { false };
    Type m_type { Type::Normal };
};

inline EventContext::EventContext(Type type, Node* node, RefPtr<EventTarget>&& currentTarget, EventTarget* origin, int closedShadowDepth, bool currentTargetIsInShadowTree)
    : m_node { node }
    , m_currentTarget { WTF::move(currentTarget) }
    , m_target { origin }
    , m_closedShadowDepth { closedShadowDepth }
    , m_currentTargetIsInShadowTree { currentTargetIsInShadowTree }
    , m_type { type }
{
    //     ASSERT(!isUnreachableNode(m_target.get()));
    // #if ENABLE(TOUCH_EVENTS)
    //     if (m_type == Type::Touch)
    //         initializeTouchLists();
    // #else
    //     ASSERT(m_type != Type::Touch);
    // #endif
}

inline EventContext::EventContext(Type type, Node* node, EventTarget* currentTarget, EventTarget* origin, int closedShadowDepth)
    : EventContext(type, node, RefPtr { currentTarget }, origin, closedShadowDepth)
{
    // ASSERT(!is<Node>(currentTarget));
}

// This variant avoids calling EventTarget::ref() which is a virtual function call.
inline EventContext::EventContext(Type type, Node& node, Node* currentTarget, EventTarget* origin, int closedShadowDepth)
    : EventContext(type, &node, RefPtr { currentTarget }, origin, closedShadowDepth, false)
{
    m_contextNodeIsFormElement = false;
    // m_contextNodeIsFormElement = is<HTMLFormElement>(node);
}

inline void EventContext::setRelatedTarget(Node* relatedTarget)
{
    ASSERT(!isUnreachableNode(relatedTarget));
    m_relatedTarget = relatedTarget;
}

// #if ENABLE(TOUCH_EVENTS)

// inline TouchList& EventContext::touchList(TouchListType type)
// {
//     switch (type) {
//     case Touches:
//         return *m_touches;
//     case TargetTouches:
//         return *m_targetTouches;
//     case ChangedTouches:
//         return *m_changedTouches;
//     }
//     ASSERT_NOT_REACHED();
//     return *m_touches;
// }

// #endif

} // namespace WebCore
