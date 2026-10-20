/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003-2024 Apple Inc. All rights reserved.
 * Copyright (C) 2017 Google Inc. All rights reserved.
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

#include "EventTarget.h"
#include "MouseEventInit.h"
#include "MouseEventTypes.h"
#include "MouseRelatedEvent.h"

namespace JSC {
class CallFrame;
class JSValue;
}

namespace WebCore {

class Node;

enum class SyntheticClickType : uint8_t;

bool isAnyClick(const AtomString& eventType);
bool isAnyClick(const Event&);

class MouseEvent : public MouseRelatedEvent {
    WTF_MAKE_TZONE_ALLOCATED(MouseEvent);
public:
    WEBCORE_EXPORT static Ref<MouseEvent> create(
        const AtomString& type,
        CanBubble,
        IsCancelable,
        IsComposed,
        MonotonicTime timestamp,
        RefPtr<Window>&&,
        int detail,
        const DoublePoint& screenLocation,
        const DoublePoint& windowLocation,
        double movementX,
        double movementY,
        OptionSet<Modifier>,
        MouseButton,
        unsigned short buttons,
        RefPtr<EventTarget>&& relatedTarget,
        double force,
        SyntheticClickType,
        const Vector<Ref<MouseEvent>>& coalescedEvents,
        const Vector<Ref<MouseEvent>>& predictedEvents,
        const std::optional<MouseEventInputSource>& inputSource = { },
        IsSimulated = IsSimulated::No,
        IsTrusted = IsTrusted::Yes
    );

    static Ref<MouseEvent> create(
        const AtomString& eventType,
        CanBubble,
        IsCancelable,
        IsComposed,
        MonotonicTime timestamp,
        RefPtr<Window>&&,
        int detail,
        double screenX,
        double screenY,
        double clientX,
        double clientY,
        OptionSet<Modifier>,
        MouseButton,
        unsigned short buttons,
        SyntheticClickType,
        RefPtr<EventTarget>&& relatedTarget
    );

    static Ref<MouseEvent> createForBindings();

    static Ref<MouseEvent> create(const AtomString& eventType, const MouseEventInit&);

    virtual ~MouseEvent();

    WEBCORE_EXPORT void initMouseEvent(
        const AtomString& type,
        bool canBubble,
        bool cancelable,
        RefPtr<Window>&&,
        int detail,
        double screenX,
        double screenY,
        double clientX,
        double clientY,
        bool ctrlKey,
        bool altKey,
        bool shiftKey,
        bool metaKey,
        int16_t button,
        RefPtr<EventTarget>&& relatedTarget
    );

    const std::optional<MouseEventInputSource>& inputSource() const LIFETIME_BOUND { return m_inputSource; }

    MouseButton button() const;
    int16_t buttonAsShort() const { return m_button; }
    unsigned short buttons() const { return m_buttons; }
    SyntheticClickType syntheticClickType() const { return m_syntheticClickType; }
    bool buttonDown() const { return m_buttonDown; }
    EventTarget* relatedTarget() const final { return m_relatedTarget.get(); }
    double force() const { return m_force; }
    void setForce(double force) { m_force = force; }

    WEBCORE_EXPORT virtual RefPtr<Node> toElement() const;
    WEBCORE_EXPORT virtual RefPtr<Node> fromElement() const;

    static bool canTriggerActivationBehavior(const Event&);

    unsigned which() const final;

    Vector<Ref<MouseEvent>> coalescedEvents() const { return m_coalescedEvents; }

    Vector<Ref<MouseEvent>> predictedEvents() const { return m_predictedEvents; }

protected:
    MouseEvent(
        enum EventInterfaceType,
        const AtomString& type,
        CanBubble,
        IsCancelable,
        IsComposed,
        MonotonicTime timestamp,
        RefPtr<Window>&&,
        int detail,
        const DoublePoint& screenLocation,
        const DoublePoint& windowLocation,
        double movementX,
        double movementY,
        OptionSet<Modifier>,
        MouseButton,
        unsigned short buttons,
        RefPtr<EventTarget>&& relatedTarget,
        double force,
        SyntheticClickType,
        const Vector<Ref<MouseEvent>>& coalescedEvents,
        const Vector<Ref<MouseEvent>>& predictedEvents,
        const std::optional<MouseEventInputSource>& inputSource,
        IsSimulated,
        IsTrusted
    );

    MouseEvent(
        enum EventInterfaceType,
        const AtomString& type,
        CanBubble,
        IsCancelable,
        IsComposed,
        MonotonicTime timestamp,
        RefPtr<Window>&&,
        int detail,
        const DoublePoint& screenLocation,
        const DoublePoint& clientLocation,
        double movementX,
        double movementY,
        OptionSet<Modifier>,
        MouseButton,
        unsigned short buttons,
        SyntheticClickType,
        RefPtr<EventTarget>&& relatedTarget
    );

    MouseEvent(enum EventInterfaceType, const AtomString& type, const MouseEventInit&, IsTrusted);

    explicit MouseEvent(enum EventInterfaceType);

private:
    bool isMouseEvent() const final { return true; }

    void setRelatedTarget(RefPtr<EventTarget>&&) final;

    int16_t m_button { std::to_underlying(MouseButton::Left) };
    unsigned short m_buttons { 0 };
    SyntheticClickType m_syntheticClickType { SyntheticClickType::NoTap };
    bool m_buttonDown { false };
    RefPtr<EventTarget> m_relatedTarget;
    double m_force { 0 };
    Vector<Ref<MouseEvent>> m_coalescedEvents;
    Vector<Ref<MouseEvent>> m_predictedEvents;
    std::optional<MouseEventInputSource> m_inputSource;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT_POLYMORPHIC(MouseEvent)
