/*
 * Copyright (C) 2016-2024 Apple Inc. All rights reserved.
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
#include "SimulatedClick.h"

#include "DOMClientData.h"
#include "Document.h"
#include "Element.h"
#include "EventNames.h"
#include "MouseEvent.h"
#include "NodeDocument.h"
#include "PointerEvent.h"
#include "PointerID.h"
#include "Window.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

// Whether a simulated click acts like a click of the primary mouse button (e.g. the press action of assistive
// technologies), or is a click that no pointing device produced (e.g. keyboard activation or element.click()).
enum class SimulatedPointingDevice : bool { None, Mouse };

class SimulatedMouseEvent : public MouseEvent {
    WTF_MAKE_TZONE_ALLOCATED(SimulatedMouseEvent);
public:
    static Ref<SimulatedMouseEvent> create(const AtomString& eventType, RefPtr<Window>&& view, RefPtr<Event>&& underlyingEvent, SimulatedClickSource source, SimulatedPointingDevice device)
    {
        return adoptRef(*new SimulatedMouseEvent(eventType, WTF::move(view), WTF::move(underlyingEvent), source, device));
    }

private:
    SimulatedMouseEvent(
        const AtomString& eventType,
        RefPtr<Window>&& view,
        RefPtr<Event>&& underlyingEvent,
        SimulatedClickSource source,
        SimulatedPointingDevice device
    )
        : MouseEvent(
            EventInterfaceType::MouseEvent,
            eventType,
            CanBubble::Yes,
            IsCancelable::Yes,
            IsComposed::Yes,
            underlyingEvent ? underlyingEvent->timeStamp() : MonotonicTime::now(),
            WTF::move(view),
            detailForDevice(device),
            { },
            { },
            0,
            0,
            modifiersFromUnderlyingEvent(underlyingEvent),
            MouseButton::Left,
            buttonsForDevice(eventType, device),
            nullptr,
            0,
            SyntheticClickType::NoTap,
            { },
            { },
            std::nullopt,
            IsSimulated::Yes,
            source == SimulatedClickSource::UserAgent ? IsTrusted::Yes : IsTrusted::No
        )
    {
        setUnderlyingEvent(underlyingEvent.get());

        if (RefPtr mouseEvent = dynamicDowncast<MouseEvent>(this->underlyingEvent())) {
            setScreenLocation(mouseEvent->screenLocation());
            initCoordinates(mouseEvent->clientLocation());
        }
    }

    static OptionSet<Modifier> modifiersFromUnderlyingEvent(const RefPtr<Event>& underlyingEvent)
    {
        RefPtr keyStateEvent = findEventWithKeyState(underlyingEvent.get());
        if (!keyStateEvent)
            return { };
        return keyStateEvent->modifierKeys();
    }

    static int detailForDevice(SimulatedPointingDevice device)
    {
        // The click count of a single click. Pages commonly treat a click with a detail of 0 as one that no pointing device
        // produced, like keyboard activation.
        return device == SimulatedPointingDevice::Mouse ? 1 : 0;
    }

    static unsigned short buttonsForDevice(const AtomString& eventType, SimulatedPointingDevice device)
    {
        if (device == SimulatedPointingDevice::None)
            return 0;

        // The primary button is pressed from pointerdown and mousedown until pointerup and mouseup.
        auto& eventNames = WebCore::eventNames();
        return eventType == eventNames.pointerdownEvent || eventType == eventNames.mousedownEvent ? 1 : 0;
    }
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(SimulatedMouseEvent);

// https://www.w3.org/TR/pointerevents3/#pointerevent-interface
class SimulatedPointerEvent final : public PointerEvent {
    WTF_MAKE_TZONE_ALLOCATED(SimulatedPointerEvent);
public:
    static Ref<SimulatedPointerEvent> create(const AtomString& type, const SimulatedMouseEvent& event, RefPtr<Event>&& underlyingEvent, SimulatedPointingDevice device)
    {
        return adoptRef(*new SimulatedPointerEvent(type, event, WTF::move(underlyingEvent), device));
    }

private:
    // If the device type cannot be detected by the user agent, then the value MUST be an empty string.
    static constexpr auto nonPointingDevicePointerType = ASCIILiteral { ""_s };

    // The pointerId value of -1 MUST be reserved and used to indicate events that were generated by something other than a pointing device.
    static constexpr auto nonPointingDevicePointerID = static_cast<PointerID>(-1);

    SimulatedPointerEvent(const AtomString& type, const SimulatedMouseEvent& event, RefPtr<Event>&& underlyingEvent, SimulatedPointingDevice device)
        : PointerEvent(
            type,
            MouseButton::Left,
            event,
            device == SimulatedPointingDevice::Mouse ? mousePointerID : nonPointingDevicePointerID,
            device == SimulatedPointingDevice::Mouse ? mousePointerEventType() : String { nonPointingDevicePointerType },
            PointerEvent::typeCanBubble(type),
            PointerEvent::typeIsCancelable(type),
            PointerEvent::typeIsComposed(type)
        )
    {
        setUnderlyingEvent(underlyingEvent.get());

        if (RefPtr pointerEvent = dynamicDowncast<PointerEvent>(this->underlyingEvent())) {
            setScreenLocation(pointerEvent->screenLocation());
            initCoordinates(pointerEvent->clientLocation());
        }
    }
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(SimulatedPointerEvent);

static void simulateMouseEvent(const AtomString& eventType, Element& element, Event* underlyingEvent, SimulatedClickSource source, SimulatedPointingDevice device)
{
    element.dispatchEvent(SimulatedMouseEvent::create(eventType, element.document().window(), underlyingEvent, source, device));
}

// Returns whether the event was canceled.
static bool simulatePointerEvent(const AtomString& eventType, Element& element, Event* underlyingEvent, SimulatedClickSource source, SimulatedPointingDevice device)
{
    Ref mouseEvent = SimulatedMouseEvent::create(eventType, element.document().window(), underlyingEvent, source, device);
    Ref pointerEvent = SimulatedPointerEvent::create(eventType, mouseEvent.get(), underlyingEvent, device);

    element.dispatchEvent(pointerEvent.get());
    return pointerEvent->defaultPrevented();
}

bool simulateClick(Element& element, Event* underlyingEvent, SimulatedClickMouseEventOptions mouseEventOptions, SimulatedClickVisualOptions visualOptions, SimulatedClickSource creationOptions)
{
    if (element.isDisabledFormControl())
        return false;

    auto& elementsDispatchingSimulatedClicks = domClientData(element.document().vm()).elementsDispatchingSimulatedClicks();
    if (!elementsDispatchingSimulatedClicks.add(element).isNewEntry)
        return false;

    // A simulated click with mouse down and up events (e.g. the press action of assistive technologies) acts as a
    // click of the primary mouse button, so dispatch the same events as one, like other browsers do. Pages commonly rely on
    // these, e.g. by acting on pointerdown rather than click, or by treating a click with a detail of 0 as keyboard activation.
    auto device = mouseEventOptions == SendMouseUpDownEvents ? SimulatedPointingDevice::Mouse : SimulatedPointingDevice::None;

    auto& eventNames = WebCore::eventNames();
    // Canceling pointerdown prevents the compatibility mouse events, but not click.
    bool pointerDownWasCanceled = false;
    if (device == SimulatedPointingDevice::Mouse) {
        pointerDownWasCanceled = simulatePointerEvent(eventNames.pointerdownEvent, element, underlyingEvent, creationOptions, device);
        if (!pointerDownWasCanceled)
            simulateMouseEvent(eventNames.mousedownEvent, element, underlyingEvent, creationOptions, device);
    }
    if (device == SimulatedPointingDevice::Mouse || visualOptions == ShowPressedLook)
        element.setActive(true);
    if (device == SimulatedPointingDevice::Mouse) {
        simulatePointerEvent(eventNames.pointerupEvent, element, underlyingEvent, creationOptions, device);
        if (!pointerDownWasCanceled)
            simulateMouseEvent(eventNames.mouseupEvent, element, underlyingEvent, creationOptions, device);
    }
    element.setActive(false);

    simulatePointerEvent(eventNames.clickEvent, element, underlyingEvent, creationOptions, device);

    elementsDispatchingSimulatedClicks.remove(element);
    return true;
}

} // namespace WebCore
