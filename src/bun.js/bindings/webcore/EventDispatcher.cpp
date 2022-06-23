/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2022 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2010, 2011, 2012, 2013 Google Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "Event.h"
#include "EventDispatcher.h"

// #include "CompositionEvent.h"
#include "EventContext.h"
// #include "EventNames.h"
#include "EventPath.h"
// #include "Frame.h"
// #include "FrameLoader.h"
// #include "FrameView.h"
// #include "HTMLInputElement.h"
// #include "InputEvent.h"
// #include "KeyboardEvent.h"
// #include "Logging.h"
// #include "MouseEvent.h"
// #include "ScopedEventQueue.h"
// #include "ScriptDisallowedScope.h"
// #include "ShadowRoot.h"
// #include "TextEvent.h"
// #include "TouchEvent.h"
// #include <wtf/text/TextStream.h>

namespace WebCore {

// void EventDispatcher::dispatchScopedEvent(Node& node, Event& event)
// {
//     // Need to set the target here so the scoped event queue knows which node to dispatch to.
//     event.setTarget(EventPath::eventTargetRespectingTargetRules(node));
//     ScopedEventQueue::singleton().enqueueEvent(event);
// }

static void callDefaultEventHandlersInBubblingOrder(Event& event, const EventPath& path)
{
    if (path.isEmpty())
        return;

    // Non-bubbling events call only one default event handler, the one for the target.
    Ref rootNode { *path.contextAt(0).node() };
    rootNode->defaultEventHandler(event);
    ASSERT(!event.defaultPrevented());

    if (event.defaultHandled() || !event.bubbles())
        return;

    size_t size = path.size();
    for (size_t i = 1; i < size; ++i) {
        Ref currentNode { *path.contextAt(i).node() };
        currentNode->defaultEventHandler(event);
        ASSERT(!event.defaultPrevented());
        if (event.defaultHandled())
            return;
    }
}

// static bool isInShadowTree(EventTarget* target)
// {
//     return is<Node>(target) && downcast<Node>(*target).isInShadowTree();
// }

static void dispatchEventInDOM(Event& event, const EventPath& path)
{
    // Invoke capturing event listeners in the reverse order.
    for (size_t i = path.size(); i > 0; --i) {
        const EventContext& eventContext = path.contextAt(i - 1);
        if (eventContext.currentTarget() == eventContext.target())
            event.setEventPhase(Event::AT_TARGET);
        else
            event.setEventPhase(Event::CAPTURING_PHASE);
        eventContext.handleLocalEvents(event, EventTarget::EventInvokePhase::Capturing);
        if (event.propagationStopped())
            return;
    }

    // Invoke bubbling event listeners.
    size_t size = path.size();
    for (size_t i = 0; i < size; ++i) {
        const EventContext& eventContext = path.contextAt(i);
        if (eventContext.currentTarget() == eventContext.target())
            event.setEventPhase(Event::AT_TARGET);
        else if (event.bubbles())
            event.setEventPhase(Event::BUBBLING_PHASE);
        else
            continue;
        eventContext.handleLocalEvents(event, EventTarget::EventInvokePhase::Bubbling);
        if (event.propagationStopped())
            return;
    }
}

static bool shouldSuppressEventDispatchInDOM(Node& node, Event& event)
{
    return false;
    // if (!event.isTrusted())
    //     return false;

    // auto frame = node.document().frame();
    // if (!frame)
    //     return false;

    // if (!frame->mainFrame().loader().shouldSuppressTextInputFromEditing())
    //     return false;

    // if (is<TextEvent>(event)) {
    //     auto& textEvent = downcast<TextEvent>(event);
    //     return textEvent.isKeyboard() || textEvent.isComposition();
    // }

    // return is<CompositionEvent>(event) || is<InputEvent>(event) || is<KeyboardEvent>(event);
}

// static HTMLInputElement* findInputElementInEventPath(const EventPath& path)
// {
//     size_t size = path.size();
//     for (size_t i = 0; i < size; ++i) {
//         const EventContext& eventContext = path.contextAt(i);
//         if (is<HTMLInputElement>(eventContext.currentTarget()))
//             return downcast<HTMLInputElement>(eventContext.currentTarget());
//     }
//     return nullptr;
// }

void EventDispatcher::dispatchEvent(Node& node, Event& event)
{
    // ASSERT_WITH_SECURITY_IMPLICATION(ScriptDisallowedScope::InMainThread::isEventDispatchAllowedInSubtree(node));

    // LOG_WITH_STREAM(Events, stream << "EventDispatcher::dispatchEvent " << event << " on node " << node);

    Ref protectedNode { node };
    // RefPtr protectedView { node.document().view() };

    EventPath eventPath { node, event };

    std::optional<bool> shouldClearTargetsAfterDispatch;
    // for (size_t i = eventPath.size(); i > 0; --i) {
    //     const EventContext& eventContext = eventPath.contextAt(i - 1);
    //     // FIXME: We should also set shouldClearTargetsAfterDispatch to true if an EventTarget object in eventContext's touch target list
    //     // is a node and its root is a shadow root.
    //     if (eventContext.target()) {
    //         shouldClearTargetsAfterDispatch = isInShadowTree(eventContext.target()) || isInShadowTree(eventContext.relatedTarget());
    //         break;
    //     }
    // }

    // ChildNodesLazySnapshot::takeChildNodesLazySnapshot();

    event.resetBeforeDispatch();
    event.setTarget(node);
    // event.setTarget(EventPath::eventTargetRespectingTargetRules(node));
    if (!event.target())
        return;

    // InputElementClickState clickHandlingState;

    // bool isActivationEvent = event.type() == eventNames().clickEvent;
    // RefPtr inputForLegacyPreActivationBehavior = dynamicDowncast<HTMLInputElement>(node);
    // if (!inputForLegacyPreActivationBehavior && isActivationEvent && event.bubbles())
    //     inputForLegacyPreActivationBehavior = findInputElementInEventPath(eventPath);
    // if (inputForLegacyPreActivationBehavior)
    //     inputForLegacyPreActivationBehavior->willDispatchEvent(event, clickHandlingState);

    if (shouldSuppressEventDispatchInDOM(node, event))
        event.stopPropagation();

    if (!event.propagationStopped() && !eventPath.isEmpty()) {
        event.setEventPath(eventPath);
        dispatchEventInDOM(event, eventPath);
    }

    event.resetAfterDispatch();

    // if (clickHandlingState.stateful)
    //     inputForLegacyPreActivationBehavior->didDispatchClickEvent(event, clickHandlingState);

    // Call default event handlers. While the DOM does have a concept of preventing
    // default handling, the detail of which handlers are called is an internal
    // implementation detail and not part of the DOM.
    if (!event.defaultPrevented() && !event.defaultHandled() && !event.isDefaultEventHandlerIgnored()) {
        // FIXME: Not clear why we need to reset the target for the default event handlers.
        // We should research this, and remove this code if possible.
        auto* finalTarget = event.target();
        // event.setTarget(EventPath::eventTargetRespectingTargetRules(node));
        event.setTarget(node);
        callDefaultEventHandlersInBubblingOrder(event, eventPath);
        event.setTarget(finalTarget);
    }

    if (shouldClearTargetsAfterDispatch.value_or(false)) {
        event.setTarget(nullptr);
        event.setRelatedTarget(nullptr);
        // FIXME: We should also clear the event's touch target list.
    }
}

template<typename T>
static void dispatchEventWithType(const Vector<T*>& targets, Event& event)
{
    ASSERT(targets.size() >= 1);
    ASSERT(*targets.begin());

    EventPath eventPath { targets };
    event.setTarget(*targets.begin());
    event.setEventPath(eventPath);
    event.resetBeforeDispatch();
    dispatchEventInDOM(event, eventPath);
    event.resetAfterDispatch();
}

void EventDispatcher::dispatchEvent(const Vector<EventTarget*>& targets, Event& event)
{
    dispatchEventWithType<EventTarget>(targets, event);
}

}
