/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003-2017 Apple Inc. All rights reserved.
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

// #include "DOMWindow.h"
// #include "Document.h"
#include "EventNames.h"
#include "EventPath.h"
#include "EventTarget.h"
// #include "InspectorInstrumentation.h"
// #include "Performance.h"
// #include "UserGestureIndicator.h"
// #include "WorkerGlobalScope.h"
#include <wtf/HexNumber.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/TextStream.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Event);

ALWAYS_INLINE Event::Event(MonotonicTime createTime, const AtomString& type, IsTrusted isTrusted, CanBubble canBubble, IsCancelable cancelable, IsComposed composed)
    : m_isInitialized { !type.isNull() }
    , m_canBubble { canBubble == CanBubble::Yes }
    , m_cancelable { cancelable == IsCancelable::Yes }
    , m_composed { composed == IsComposed::Yes }
    , m_propagationStopped { false }
    , m_immediatePropagationStopped { false }
    , m_wasCanceled { false }
    , m_defaultHandled { false }
    , m_isDefaultEventHandlerIgnored { false }
    , m_isTrusted { isTrusted == IsTrusted::Yes }
    , m_isExecutingPassiveEventListener { false }
    , m_currentTargetIsInShadowTree { false }
    , m_eventPhase { NONE }
    , m_type { type }
    , m_createTime { createTime }
{
}

Event::Event(IsTrusted isTrusted)
    : Event { MonotonicTime::now(), {}, isTrusted, CanBubble::No, IsCancelable::No, IsComposed::No }
{
}

Event::Event(const AtomString& eventType, CanBubble canBubble, IsCancelable isCancelable, IsComposed isComposed)
    : Event { MonotonicTime::now(), eventType, IsTrusted::Yes, canBubble, isCancelable, isComposed }
{
    ASSERT(!eventType.isNull());
}

Event::Event(const AtomString& eventType, CanBubble canBubble, IsCancelable isCancelable, IsComposed isComposed, MonotonicTime timestamp, IsTrusted isTrusted)
    : Event { timestamp, eventType, isTrusted, canBubble, isCancelable, isComposed }
{
    ASSERT(!eventType.isNull());
}

Event::Event(const AtomString& eventType, const EventInit& initializer, IsTrusted isTrusted)
    : Event { MonotonicTime::now(), eventType, isTrusted,
        initializer.bubbles ? CanBubble::Yes : CanBubble::No,
        initializer.cancelable ? IsCancelable::Yes : IsCancelable::No,
        initializer.composed ? IsComposed::Yes : IsComposed::No }
{
    ASSERT(!eventType.isNull());
}

Event::~Event() = default;

Ref<Event> Event::create(const AtomString& type, CanBubble canBubble, IsCancelable isCancelable, IsComposed isComposed)
{
    return adoptRef(*new Event(type, canBubble, isCancelable, isComposed));
}

Ref<Event> Event::createForBindings()
{
    return adoptRef(*new Event);
}

Ref<Event> Event::create(const AtomString& type, const EventInit& initializer, IsTrusted isTrusted)
{
    return adoptRef(*new Event(type, initializer, isTrusted));
}

void Event::initEvent(const AtomString& eventTypeArg, bool canBubbleArg, bool cancelableArg)
{
    if (isBeingDispatched())
        return;

    m_isInitialized = true;
    m_propagationStopped = false;
    m_immediatePropagationStopped = false;
    m_wasCanceled = false;
    m_isTrusted = false;
    m_target = nullptr;
    m_type = eventTypeArg;
    m_canBubble = canBubbleArg;
    m_cancelable = cancelableArg;

    m_underlyingEvent = nullptr;
}

void Event::setTarget(RefPtr<EventTarget>&& target)
{
    if (m_target == target)
        return;

    m_target = WTF::move(target);
    if (m_target)
        receivedTarget();
}

void Event::setCurrentTarget(EventTarget* currentTarget, std::optional<bool> isInShadowTree)
{
    m_currentTarget = currentTarget;
    m_currentTargetIsInShadowTree = false; // m_currentTargetIsInShadowTree = isInShadowTree ? *isInShadowTree : (is<Node>(currentTarget) && downcast<Node>(*currentTarget).isInShadowTree());
}

void Event::setEventPath(const EventPath& path)
{
    m_eventPath = &path;
}

Vector<Ref<EventTarget>> Event::composedPath() const
{
    if (!m_eventPath)
        return Vector<Ref<EventTarget>>();
    return m_eventPath->computePathUnclosedToTarget(*m_currentTarget);
}

void Event::setUnderlyingEvent(Event* underlyingEvent)
{
    // Prohibit creation of a cycle by doing nothing if a cycle would be created.
    for (Event* event = underlyingEvent; event; event = event->underlyingEvent()) {
        if (event == this)
            return;
    }
    m_underlyingEvent = underlyingEvent;
}

DOMHighResTimeStamp Event::timeStampForBindings(ScriptExecutionContext& context) const
{
    // TODO:
    return 0.0;
    // Performance* performance = nullptr;
    // if (is<WorkerGlobalScope>(context))
    //     performance = &downcast<WorkerGlobalScope>(context).performance();
    // else if (auto* window = downcast<Document>(context).domWindow())
    //     performance = &window->performance();

    // if (!performance)
    //     return 0;

    // return std::max(performance->relativeTimeFromTimeOriginInReducedResolution(m_createTime), 0.);
}

void Event::resetBeforeDispatch()
{
    m_defaultHandled = false;
}

void Event::resetAfterDispatch()
{
    m_eventPath = nullptr;
    setCurrentTarget(nullptr);
    m_eventPhase = NONE;
    m_propagationStopped = false;
    m_immediatePropagationStopped = false;

    // InspectorInstrumentation::eventDidResetAfterDispatch(*this);
}

String Event::debugDescription() const
{
    return makeString(type(), " phase "_s, eventPhase(), bubbles() ? " bubbles "_s : " "_s, cancelable() ? "cancelable "_s : " "_s, "0x"_s, hex(reinterpret_cast<uintptr_t>(this), Lowercase));
}

TextStream& operator<<(TextStream& ts, const Event& event)
{
    ts << event.debugDescription();
    return ts;
}

} // namespace WebCore
