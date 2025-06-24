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
 *
 */

#pragma once

#include "config.h"

#include "DOMHighResTimeStamp.h"
#include "EventInit.h"
#include "EventInterfaces.h"
#include "EventOptions.h"
#include "ExceptionOr.h"
#include "ScriptWrappable.h"
#include <wtf/MonotonicTime.h>
#include <wtf/TypeCasts.h>
#include <wtf/text/AtomString.h>

namespace WTF {
class TextStream;
}

namespace WebCore {

class EventPath;
class EventTarget;
class ScriptExecutionContext;

class Event : public ScriptWrappable, public RefCounted<Event> {
    WTF_MAKE_TZONE_ALLOCATED(Event);

public:
    using IsTrusted = EventIsTrusted;
    using CanBubble = EventCanBubble;
    using IsCancelable = EventIsCancelable;
    using IsComposed = EventIsComposed;

    enum PhaseType : uint8_t {
        NONE = 0,
        CAPTURING_PHASE = 1,
        AT_TARGET = 2,
        BUBBLING_PHASE = 3
    };

    WEBCORE_EXPORT static Ref<Event> create(const AtomString& type, CanBubble, IsCancelable, IsComposed = IsComposed::No);
    static Ref<Event> createForBindings();
    static Ref<Event> create(const AtomString& type, const EventInit&, IsTrusted = IsTrusted::No);

    virtual ~Event();

    WEBCORE_EXPORT void initEvent(const AtomString& type, bool canBubble, bool cancelable);

    bool isInitialized() const { return m_isInitialized; }

    const AtomString& type() const { return m_type; }
    void setType(const AtomString& type) { m_type = type; }

    EventTarget* target() const { return m_target.get(); }
    void setTarget(RefPtr<EventTarget>&&);

    EventTarget* currentTarget() const { return m_currentTarget.get(); }
    void setCurrentTarget(EventTarget*, std::optional<bool> isInShadowTree = std::nullopt);
    bool currentTargetIsInShadowTree() const { return m_currentTargetIsInShadowTree; }

    unsigned short eventPhase() const { return m_eventPhase; }
    void setEventPhase(PhaseType phase) { m_eventPhase = phase; }

    bool bubbles() const { return m_canBubble; }
    bool cancelable() const { return m_cancelable; }
    bool composed() const { return m_composed; }

    DOMHighResTimeStamp timeStampForBindings(ScriptExecutionContext&) const;
    MonotonicTime timeStamp() const { return m_createTime; }

    void setEventPath(const EventPath&);
    Vector<Ref<EventTarget>> composedPath() const;

    void stopPropagation() { m_propagationStopped = true; }
    void stopImmediatePropagation() { m_immediatePropagationStopped = true; }

    bool isTrusted() const { return m_isTrusted; }
    void setUntrusted() { m_isTrusted = false; }

    bool legacyReturnValue() const { return !m_wasCanceled; }
    void setLegacyReturnValue(bool);

    virtual EventInterface eventInterface() const { return EventInterfaceType; }

    virtual bool isBeforeTextInsertedEvent() const { return false; }
    virtual bool isBeforeUnloadEvent() const { return false; }
    virtual bool isClipboardEvent() const { return false; }
    virtual bool isCompositionEvent() const { return false; }
    virtual bool isErrorEvent() const { return false; }
    virtual bool isFocusEvent() const { return false; }
    virtual bool isInputEvent() const { return false; }
    virtual bool isKeyboardEvent() const { return false; }
    virtual bool isMouseEvent() const { return false; }
    virtual bool isPointerEvent() const { return false; }
    virtual bool isTextEvent() const { return false; }
    virtual bool isTouchEvent() const { return false; }
    virtual bool isUIEvent() const { return false; }
    virtual bool isVersionChangeEvent() const { return false; }
    virtual bool isWheelEvent() const { return false; }

    bool propagationStopped() const { return m_propagationStopped || m_immediatePropagationStopped; }
    bool immediatePropagationStopped() const { return m_immediatePropagationStopped; }

    void resetBeforeDispatch();
    void resetAfterDispatch();

    bool defaultPrevented() const { return m_wasCanceled; }
    void preventDefault();

    bool defaultHandled() const { return m_defaultHandled; }
    void setDefaultHandled() { m_defaultHandled = true; }

    bool isDefaultEventHandlerIgnored() const { return m_isDefaultEventHandlerIgnored; }
    void setIsDefaultEventHandlerIgnored() { m_isDefaultEventHandlerIgnored = true; }

    void setInPassiveListener(bool value) { m_isExecutingPassiveEventListener = value; }

    bool cancelBubble() const { return propagationStopped(); }
    void setCancelBubble(bool);

    Event* underlyingEvent() const { return m_underlyingEvent.get(); }
    void setUnderlyingEvent(Event*);

    // Returns true if the dispatch flag is set.
    // https://dom.spec.whatwg.org/#dispatch-flag
    bool isBeingDispatched() const { return eventPhase(); }

    virtual EventTarget* relatedTarget() const { return nullptr; }
    virtual void setRelatedTarget(EventTarget*) {}

    virtual String debugDescription() const;

protected:
    explicit Event(IsTrusted = IsTrusted::No);
    Event(const AtomString& type, CanBubble, IsCancelable, IsComposed = IsComposed::No);
    Event(const AtomString& type, CanBubble, IsCancelable, IsComposed, MonotonicTime timestamp, IsTrusted isTrusted = IsTrusted::Yes);
    Event(const AtomString& type, const EventInit&, IsTrusted);

    virtual void receivedTarget() {}

private:
    explicit Event(MonotonicTime createTime, const AtomString& type, IsTrusted, CanBubble, IsCancelable, IsComposed);

    void setCanceledFlagIfPossible();

    unsigned m_isInitialized : 1;
    unsigned m_canBubble : 1;
    unsigned m_cancelable : 1;
    unsigned m_composed : 1;

    unsigned m_propagationStopped : 1;
    unsigned m_immediatePropagationStopped : 1;
    unsigned m_wasCanceled : 1;
    unsigned m_defaultHandled : 1;
    unsigned m_isDefaultEventHandlerIgnored : 1;
    unsigned m_isTrusted : 1;
    unsigned m_isExecutingPassiveEventListener : 1;
    unsigned m_currentTargetIsInShadowTree : 1;

    unsigned m_eventPhase : 2;

    AtomString m_type;

    RefPtr<EventTarget> m_currentTarget;
    const EventPath* m_eventPath { nullptr };
    RefPtr<EventTarget> m_target;
    MonotonicTime m_createTime;

    RefPtr<Event> m_underlyingEvent;
};

inline void Event::preventDefault()
{
    setCanceledFlagIfPossible();
}

inline void Event::setLegacyReturnValue(bool returnValue)
{
    if (!returnValue)
        setCanceledFlagIfPossible();
}

// https://dom.spec.whatwg.org/#set-the-canceled-flag
inline void Event::setCanceledFlagIfPossible()
{
    if (m_cancelable && !m_isExecutingPassiveEventListener)
        m_wasCanceled = true;
    // FIXME: Specification suggests we log something to the console when preventDefault is called but
    // doesn't do anything because the event is not cancelable or is executing passive event listeners.
}

inline void Event::setCancelBubble(bool cancel)
{
    if (cancel)
        m_propagationStopped = true;
}

WTF::TextStream& operator<<(WTF::TextStream&, const Event&);

} // namespace WebCore

#define SPECIALIZE_TYPE_TRAITS_EVENT(ToValueTypeName)                                       \
    SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ToValueTypeName)                                  \
    static bool isType(const WebCore::Event& event) { return event.is##ToValueTypeName(); } \
    SPECIALIZE_TYPE_TRAITS_END()
