/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003, 2005, 2006, 2008, 2013 Apple Inc. All rights reserved.
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
#include "MouseRelatedEvent.h"

#include "EventNames.h"
#include "MouseEventInit.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MouseRelatedEvent);

// FIXME: Remove this variant.
MouseRelatedEvent::MouseRelatedEvent()
    : UIEventWithKeyState(EventInterfaceType::Invalid)
{
}

MouseRelatedEvent::MouseRelatedEvent(enum EventInterfaceType eventInterface)
    : UIEventWithKeyState(eventInterface)
{
}

MouseRelatedEvent::MouseRelatedEvent(enum EventInterfaceType eventInterface, const AtomString& eventType, CanBubble canBubble, IsCancelable isCancelable, IsComposed isComposed,
    MonotonicTime timestamp, RefPtr<Window>&& view, int detail,
    const DoublePoint& screenLocation, const DoublePoint& windowLocation, double movementX, double movementY, OptionSet<Modifier> modifiers, IsSimulated isSimulated, IsTrusted isTrusted)
    : UIEventWithKeyState(eventInterface, eventType, canBubble, isCancelable, isComposed, timestamp, WTF::move(view), detail, modifiers, isTrusted)
        , m_movementX(movementX)
        , m_movementY(movementY)
        , m_screenLocation(screenLocation)
        , m_isSimulated(isSimulated == IsSimulated::Yes)
{
    init(m_isSimulated, windowLocation);
}

MouseRelatedEvent::MouseRelatedEvent(enum EventInterfaceType eventInterface, const AtomString& type, IsCancelable isCancelable, MonotonicTime timestamp, RefPtr<Window>&& view, const DoublePoint& globalLocation, OptionSet<Modifier> modifiers)
    : MouseRelatedEvent(eventInterface, type, CanBubble::Yes, isCancelable, IsComposed::Yes, timestamp,
        WTF::move(view), 0, globalLocation, globalLocation /* Converted in init */, 0, 0, modifiers, IsSimulated::No)
{
}

MouseRelatedEvent::MouseRelatedEvent(enum EventInterfaceType eventInterface, const AtomString& eventType, const MouseEventInit& initializer, IsTrusted isTrusted)
    : UIEventWithKeyState(eventInterface, eventType, initializer, isTrusted)
        , m_movementX(initializer.movementX)
        , m_movementY(initializer.movementY)
        , m_screenLocation(DoublePoint(initializer.screenX, initializer.screenY))
{
    auto screenX = initializer.screenX;
    auto screenY = initializer.screenY;

    if (!std::isfinite(screenX))
        screenX = 0;
    if (!std::isfinite(screenY))
        screenY = 0;

    setScreenLocation({ screenX, screenY });

    init(false, DoublePoint::zero());
}

MouseRelatedEvent::MouseRelatedEvent(enum EventInterfaceType eventInterface, const AtomString& eventType, const EventModifierInit& initializer, IsTrusted isTrusted)
    : UIEventWithKeyState(eventInterface, eventType, initializer, isTrusted)
{
    init(false, DoublePoint::zero());
}

static inline bool isMoveEventType(const AtomString& eventType)
{
    auto& eventNames = WebCore::eventNames();
    return eventType == eventNames.mousemoveEvent
        || eventType == eventNames.pointermoveEvent
        || eventType == eventNames.touchmoveEvent;
}

void MouseRelatedEvent::init(bool isSimulated, const DoublePoint& windowLocation)
{
    if (!isSimulated)
        m_clientLocation = windowLocation;

    if (!isConstructedFromInitializer() && !isMoveEventType(type())) {
        m_movementX = 0;
        m_movementY = 0;
    }
}

void MouseRelatedEvent::initCoordinates(const DoublePoint& clientLocation)
{
    m_clientLocation = clientLocation;
}

static double LEGACY_NODELETE finiteValue(double value)
{
    return std::isfinite(value) ? value : 0;
}

int MouseRelatedEvent::layerX()
{
    return clampTo<int>(finiteValue(pageLocation().x()));
}

int MouseRelatedEvent::layerY()
{
    return clampTo<int>(finiteValue(pageLocation().y()));
}

double MouseRelatedEvent::offsetX()
{
    if (isSimulated())
        return 0;

    return std::round(offsetLocation().x());
}

double MouseRelatedEvent::offsetY()
{
    if (isSimulated())
        return 0;

    return std::round(offsetLocation().y());
}

double MouseRelatedEvent::pageX() const
{
    return std::floor(pageLocation().x());
}

double MouseRelatedEvent::pageY() const
{
    return std::floor(pageLocation().y());
}

double MouseRelatedEvent::screenX() const
{
    // FIXME: Determine whether or not we should restrict the range of this value
    // now that screenX is a double instead of an integer.
    return std::floor(finiteValue(m_screenLocation.x()));
}

double MouseRelatedEvent::screenY() const
{
    // FIXME: Determine whether or not we should restrict the range of this value
    // now that screenY is a double instead of an integer.
    return std::floor(finiteValue(m_screenLocation.y()));
}

double MouseRelatedEvent::clientX() const
{
    // FIXME: Determine whether or not we should restrict the range of this value
    // now that clientX is a double instead of an integer.
    return std::floor(finiteValue(m_clientLocation.x()));
}

double MouseRelatedEvent::clientY() const
{
    // FIXME: Determine whether or not we should restrict the range of this value
    // now that clientY is a double instead of an integer.
    return std::floor(finiteValue(m_clientLocation.y()));
}

} // namespace WebCore
