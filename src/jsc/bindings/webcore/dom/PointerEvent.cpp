/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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

#include "config.h"
#include "PointerEvent.h"

#include "EventNames.h"
#include "MouseEventTypes.h"
#include "Node.h"
#include "PointerEventTypeNames.h"
#include "Window.h"
#include <numbers>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(PointerEvent);

AtomString PointerEvent::typeFromMouseEventType(const AtomString& mouseEventType)
{
    auto& names = eventNames();
    if (mouseEventType == names.auxclickEvent)
        return names.auxclickEvent;
    if (mouseEventType == names.clickEvent)
        return names.clickEvent;
    if (mouseEventType == names.contextmenuEvent)
        return names.contextmenuEvent;
    if (mouseEventType == names.mousedownEvent)
        return names.pointerdownEvent;
    if (mouseEventType == names.mouseoverEvent)
        return names.pointeroverEvent;
    if (mouseEventType == names.mouseenterEvent)
        return names.pointerenterEvent;
    if (mouseEventType == names.mousemoveEvent)
        return names.pointermoveEvent;
    if (mouseEventType == names.mouseleaveEvent)
        return names.pointerleaveEvent;
    if (mouseEventType == names.mouseoutEvent)
        return names.pointeroutEvent;
    if (mouseEventType == names.mouseupEvent)
        return names.pointerupEvent;

    return nullAtom();
}

RefPtr<PointerEvent> PointerEvent::create(MouseButton button, const MouseEvent& mouseEvent, PointerID pointerId, const String& pointerType)
{
    auto type = typeFromMouseEventType(mouseEvent.type());
    if (type.isEmpty())
        return nullptr;

    return create(type, button, mouseEvent, pointerId, pointerType);
}

Ref<PointerEvent> PointerEvent::create(const AtomString& type, MouseButton button, const MouseEvent& mouseEvent, PointerID pointerId, const String& pointerType)
{
    return create(type, button, mouseEvent, pointerId, pointerType, typeCanBubble(type), typeIsCancelable(type));
}

Ref<PointerEvent> PointerEvent::create(const AtomString& type, MouseButton button, const MouseEvent& mouseEvent, PointerID pointerId, const String& pointerType, CanBubble canBubble, IsCancelable isCancelable)
{
    return adoptRef(*new PointerEvent(type, button, mouseEvent, pointerId, pointerType, canBubble, isCancelable, typeIsComposed(type)));
}

Ref<PointerEvent> PointerEvent::create(const AtomString& type, PointerID pointerId, const String& pointerType, IsPrimary isPrimary)
{
    return adoptRef(*new PointerEvent(type, pointerId, pointerType, isPrimary));
}

PointerEvent::PointerEvent()
    : MouseEvent(EventInterfaceType::PointerEvent)
{
}

// Calculated in accordance with https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle.
auto PointerEvent::angleFromTilt(long tiltX, long tiltY) -> PointerEventAngle
{
    const double tiltXRadians = tiltX * radiansPerDegreeDouble;
    const double tiltYRadians = tiltY * radiansPerDegreeDouble;
    double azimuthAngle = 0;

    if (!tiltX && tiltY)
        azimuthAngle = tiltY > 0 ? piOverTwoDouble : 3 * piOverTwoDouble;
    else if (tiltX && !tiltY)
        azimuthAngle = tiltX < 0 ? std::numbers::pi : azimuthAngle;
    else if (abs(tiltX) == 90 || abs(tiltY) == 90)
        azimuthAngle = 0;
    else {
        azimuthAngle = atan2(tan(tiltYRadians), tan(tiltXRadians));
        azimuthAngle = azimuthAngle < 0 ? azimuthAngle + radiansPerTurnDouble : azimuthAngle;
    }

    double altitudeAngle = 0;

    if (abs(tiltX) == 90 || abs(tiltY) == 90)
        altitudeAngle = 0;
    else if (!tiltX)
        altitudeAngle = piOverTwoDouble - abs(tiltYRadians);
    else if (!tiltY)
        altitudeAngle = piOverTwoDouble - abs(tiltXRadians);
    else
        altitudeAngle =  atan(1.0 / sqrt(pow(tan(tiltXRadians), 2) + pow(tan(tiltYRadians), 2)));

    return { altitudeAngle, azimuthAngle };
}

// This algorithm is equivalent to the one provided in https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle.
auto PointerEvent::tiltFromAngle(double altitudeAngle, double azimuthAngle) -> PointerEventTilt
{
    double tiltXRadians = WTF::areEssentiallyEqual(altitudeAngle, 0.0) ? cos(azimuthAngle) * piOverTwoDouble : atan(cos(azimuthAngle) / tan(altitudeAngle));
    double tiltYRadians = WTF::areEssentiallyEqual(altitudeAngle, 0.0) ? sin(azimuthAngle) * piOverTwoDouble : atan(sin(azimuthAngle) / tan(altitudeAngle));

    return { static_cast<long>(round(tiltXRadians * degreesPerRadianDouble)), static_cast<long>(round(tiltYRadians * degreesPerRadianDouble)) };
}

PointerEvent::PointerEvent(const AtomString& type, Init&& initializer, IsTrusted isTrusted)
    : MouseEvent(EventInterfaceType::PointerEvent, type, initializer, isTrusted)
    , m_pointerId(static_cast<PointerID>(initializer.pointerId))
    , m_width(initializer.width)
    , m_height(initializer.height)
    , m_pressure(initializer.pressure)
    , m_tangentialPressure(initializer.tangentialPressure)
    , m_tiltX(initializer.tiltX)
    , m_tiltY(initializer.tiltY)
    , m_twist(initializer.twist)
    , m_altitudeAngle(initializer.altitudeAngle)
    , m_azimuthAngle(initializer.azimuthAngle)
    , m_pointerType(initializer.pointerType)
    , m_isPrimary(initializer.isPrimary)
    , m_fractionalCoordinatesAllowed(fractionalCoordinatesAllowedForType(type))
    , m_coalescedEvents(initializer.coalescedEvents)
    , m_predictedEvents(initializer.predictedEvents)
{
    // A pair of components is complete when both or no values have been initialized to non-default values.
    bool tiltComponentsComplete = !initializer.tiltX == !initializer.tiltY;
    bool angleComponentsComplete = !initializer.azimuthAngle == (initializer.altitudeAngle == piOverTwoDouble);

    PointerEventAngle angle = angleFromTilt(m_tiltX, m_tiltY);
    PointerEventTilt tilt = tiltFromAngle(m_altitudeAngle, m_azimuthAngle);

    m_altitudeAngle = angleComponentsComplete ? angle.altitudeAngle : m_altitudeAngle;
    m_azimuthAngle = angleComponentsComplete ? angle.azimuthAngle : m_azimuthAngle;
    m_tiltX = tiltComponentsComplete ? tilt.tiltX : m_tiltX;
    m_tiltY = tiltComponentsComplete ? tilt.tiltY : m_tiltY;
}

static Vector<Ref<PointerEvent>> createCoalescedPointerEvents(const AtomString& type, MouseButton button, const MouseEvent& mouseEvent, PointerID pointerId, const String& pointerType)
{
    if (type != eventNames().pointermoveEvent)
        return { };

    // Populated in accordance with the https://www.w3.org/TR/pointerevents3/#populating-and-maintaining-the-coalesced-and-predicted-events-lists spec.

    Vector<Ref<PointerEvent>> result;
    for (Ref coalescedMouseEvent : mouseEvent.coalescedEvents()) {
        Ref pointerEvent = PointerEvent::create(type, button, coalescedMouseEvent.get(), pointerId, pointerType, Event::CanBubble::No, Event::IsCancelable::No);
        result.append(WTF::move(pointerEvent));
    }

    return result;
}

static Vector<Ref<PointerEvent>> createPredictedPointerEvents(const AtomString& type, MouseButton button, const MouseEvent& mouseEvent, PointerID pointerId, const String& pointerType)
{
    if (type != eventNames().pointermoveEvent)
        return { };

    // Populated in accordance with the https://www.w3.org/TR/pointerevents3/#populating-and-maintaining-the-coalesced-and-predicted-events-lists spec.

    Vector<Ref<PointerEvent>> result;
    for (Ref predictedMouseEvent : mouseEvent.predictedEvents()) {
        Ref pointerEvent = PointerEvent::create(type, button, predictedMouseEvent.get(), pointerId, pointerType, Event::CanBubble::No, Event::IsCancelable::No);
        result.append(WTF::move(pointerEvent));
    }

    return result;
}

PointerEvent::PointerEvent(
    const AtomString& type,
    MouseButton button,
    const MouseEvent& mouseEvent,
    PointerID pointerId,
    const String& pointerType,
    CanBubble canBubble,
    IsCancelable isCancelable,
    IsComposed isComposed
)
    : MouseEvent(
        EventInterfaceType::PointerEvent,
        type,
        canBubble,
        isCancelable,
        isComposed,
        mouseEvent.timeStamp(),
        mouseEvent.view(),
        mouseEvent.detail(),
        mouseEvent.screenLocation(),
        mouseEvent.clientLocation(),
        mouseEvent.movementX(),
        mouseEvent.movementY(),
        mouseEvent.modifierKeys(),
        button,
        mouseEvent.buttons(),
        mouseEvent.relatedTarget(),
        0,
        mouseEvent.syntheticClickType(),
        { },
        { },
        mouseEvent.inputSource(),
        mouseEvent.isSimulated() ? IsSimulated::Yes : IsSimulated::No,
        mouseEvent.isTrusted() ? IsTrusted::Yes : IsTrusted::No
    )
    , m_pointerId(pointerId)
    // MouseEvent is a misnomer in this context, and can represent events from a pressure sensitive input device if the pointer type is "Pen" or "Touch".
    // If it does represent a pressure sensitive input device, we consult MouseEvent::force() for the event pressure, else we fall back to spec defaults.
    , m_pressure(pointerType != mousePointerEventType() ? std::clamp(mouseEvent.force(), 0., 1.) : pressureForPressureInsensitiveInputDevices(buttons()))
    , m_pointerType(pointerType)
    , m_isPrimary(true)
    , m_fractionalCoordinatesAllowed(fractionalCoordinatesAllowedForType(type))
    , m_coalescedEvents(createCoalescedPointerEvents(type, button, mouseEvent, pointerId, pointerType))
    , m_predictedEvents(createPredictedPointerEvents(type, button, mouseEvent, pointerId, pointerType))
{
}

PointerEvent::PointerEvent(const AtomString& type, PointerID pointerId, const String& pointerType, IsPrimary isPrimary)
    : MouseEvent(
        EventInterfaceType::PointerEvent,
        type,
        typeCanBubble(type),
        typeIsCancelable(type),
        typeIsComposed(type),
        MonotonicTime::now(),
        nullptr,
        0,
        { },
        { },
        0,
        0,
        { },
        buttonForType(type),
        buttonsForType(type),
        SyntheticClickType::NoTap,
        nullptr
    )
    , m_pointerId(pointerId)
    // FIXME: This may be wrong because we can create an event from a pressure sensitive device.
    // We don't have a backing MouseEvent to consult pressure/force information from, though, so let's do the next best thing.
    , m_pressure(pressureForPressureInsensitiveInputDevices(buttons()))
    , m_pointerType(pointerType)
    , m_isPrimary(isPrimary == IsPrimary::Yes)
    , m_fractionalCoordinatesAllowed(fractionalCoordinatesAllowedForType(type))
{
}

PointerEvent::~PointerEvent() = default;

Vector<Ref<PointerEvent>> PointerEvent::getCoalescedEvents() const
{
#if ASSERT_ENABLED
    if (isTrusted()) {
        auto& names = eventNames();
        if (type() == names.pointermoveEvent)
            ASSERT(!m_coalescedEvents.isEmpty(), "Trusted pointermove events must have more than zero coalesced events.");
        else
            ASSERT(m_coalescedEvents.isEmpty(), "Trusted non-pointermove events must have zero coalesced events.");

        auto timestampsAreMonotonicallyIncreasing = std::ranges::is_sorted(m_coalescedEvents, [](const auto& previousEvent, const auto& newEvent) {
            return previousEvent->timeStamp() <= newEvent->timeStamp();
        });

        ASSERT(timestampsAreMonotonicallyIncreasing, "Coalesced event timestamps are not monotonically increasing.");

        auto canBubbleOrIsCancelable = std::ranges::any_of(m_coalescedEvents, [](const auto& event) {
            return event->bubbles() || event->cancelable();
        });

        ASSERT(!canBubbleOrIsCancelable, "Coalesced events must not bubble and must not be cancelable.");
    }
#endif

    return m_coalescedEvents;
}

Vector<Ref<PointerEvent>> PointerEvent::getPredictedEvents() const
{
#if ASSERT_ENABLED
    if (isTrusted()) {
        auto& names = eventNames();
        if (type() != names.pointermoveEvent)
            ASSERT(m_predictedEvents.isEmpty(), "Trusted non-pointermove events must have zero predicted events.");

        auto timestampsAreMonotonicallyIncreasing = std::ranges::is_sorted(m_predictedEvents, [](const auto& previousEvent, const auto& newEvent) {
            return previousEvent->timeStamp() <= newEvent->timeStamp();
        });

        ASSERT(timestampsAreMonotonicallyIncreasing, "Predicted event timestamps are not monotonically increasing.");

        if (!m_predictedEvents.isEmpty())
            ASSERT(m_predictedEvents.first()->timeStamp() >= this->timeStamp(), "Predicted events must have a timestamp greater than or equal to the dispatched event.");

        auto canBubbleOrIsCancelable = std::ranges::any_of(m_predictedEvents, [](const auto& event) {
            return event->bubbles() || event->cancelable();
        });

        ASSERT(!canBubbleOrIsCancelable, "Predicted events must not bubble and must not be cancelable.");
    }
#endif

    return m_predictedEvents;
}

void PointerEvent::receivedTarget()
{
    if (!isTrusted())
        return;

    for (Ref coalescedEvent : m_coalescedEvents)
        coalescedEvent->setTarget(this->target());

    for (Ref predictedEvent : m_predictedEvents)
        predictedEvent->setTarget(this->target());
}

bool PointerEvent::fractionalCoordinatesAllowedForType(const AtomString& type)
{
    return !(type == eventNames().auxclickEvent
        || type == eventNames().clickEvent
        || type == eventNames().contextmenuEvent);
}

double PointerEvent::adjustedCoordinateForType(double coordinate) const
{
    if (fractionalCoordinatesAllowed())
        return coordinate;

    return std::floor(coordinate);
}

double PointerEvent::offsetX()
{
    if (isSimulated())
        return 0;

    return adjustedCoordinateForType(offsetLocation().x());
}

double PointerEvent::offsetY()
{
    if (isSimulated())
        return 0;

    return adjustedCoordinateForType(offsetLocation().y());
}

} // namespace WebCore
