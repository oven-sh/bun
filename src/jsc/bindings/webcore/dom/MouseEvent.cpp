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
 */

#include "config.h"
#include "MouseEvent.h"

#include "EventNames.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSEventTarget.h"
#include "JSEventTargetCustom.h"
#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <algorithm>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MouseEvent);

bool isAnyClick(const AtomString& eventType)
{
    return eventType == eventNames().clickEvent || eventType == eventNames().auxclickEvent;
}

bool isAnyClick(const Event& event)
{
    return isAnyClick(event.type());
}

Ref<MouseEvent> MouseEvent::create(const AtomString& type, const MouseEventInit& initializer)
{
    return adoptRef(*new MouseEvent(EventInterfaceType::MouseEvent, type, initializer, IsTrusted::No));
}

Ref<MouseEvent> MouseEvent::create(
    const AtomString& type,
    CanBubble canBubble,
    IsCancelable isCancelable,
    IsComposed isComposed,
    MonotonicTime timestamp,
    RefPtr<Window>&& view,
    int detail,
    const DoublePoint& screenLocation,
    const DoublePoint& windowLocation,
    double movementX,
    double movementY,
    OptionSet<Modifier> modifiers,
    MouseButton button,
    unsigned short buttons,
    RefPtr<EventTarget>&& relatedTarget,
    double force,
    SyntheticClickType syntheticClickType,
    const Vector<Ref<MouseEvent>>& coalescedEvents,
    const Vector<Ref<MouseEvent>>& predictedEvents,
    const std::optional<MouseEventInputSource>& inputSource,
    IsSimulated isSimulated,
    IsTrusted isTrusted
)
{
    return adoptRef(
        *new MouseEvent(
            EventInterfaceType::MouseEvent,
            type,
            canBubble,
            isCancelable,
            isComposed,
            timestamp,
            WTF::move(view),
            detail,
            screenLocation,
            windowLocation,
            movementX,
            movementY,
            modifiers,
            button,
            buttons,
            WTF::move(relatedTarget),
            force,
            syntheticClickType,
            coalescedEvents,
            predictedEvents,
            inputSource,
            isSimulated,
            isTrusted
        )
    );
}

Ref<MouseEvent> MouseEvent::create(
    const AtomString& eventType,
    CanBubble canBubble,
    IsCancelable isCancelable,
    IsComposed isComposed,
    MonotonicTime timestamp,
    RefPtr<Window>&& view,
    int detail,
    double screenX,
    double screenY,
    double clientX,
    double clientY,
    OptionSet<Modifier> modifiers,
    MouseButton button,
    unsigned short buttons,
    SyntheticClickType syntheticClickType,
    RefPtr<EventTarget>&& relatedTarget
)
{
    if (!std::isfinite(clientX))
        clientX = 0;
    if (!std::isfinite(clientY))
        clientY = 0;
    if (!std::isfinite(screenX))
        screenX = 0;
    if (!std::isfinite(screenY))
        screenY = 0;

    return adoptRef(
        *new MouseEvent(
            EventInterfaceType::MouseEvent,
            eventType,
            canBubble,
            isCancelable,
            isComposed,
            timestamp,
            WTF::move(view),
            detail,
            { screenX, screenY },
            { clientX, clientY },
            0,
            0,
            modifiers,
            button,
            buttons,
            syntheticClickType,
            WTF::move(relatedTarget)
        )
    );
}

Ref<MouseEvent> MouseEvent::createForBindings()
{
    return adoptRef(*new MouseEvent(EventInterfaceType::MouseEvent));
}

MouseEvent::MouseEvent(enum EventInterfaceType eventInterface)
    : MouseRelatedEvent(eventInterface)
{
}

MouseEvent::MouseEvent(
    enum EventInterfaceType eventInterface,
    const AtomString& eventType,
    CanBubble canBubble,
    IsCancelable isCancelable,
    IsComposed isComposed,
    MonotonicTime timestamp,
    RefPtr<Window>&& view,
    int detail,
    const DoublePoint& screenLocation,
    const DoublePoint& windowLocation,
    double movementX,
    double movementY,
    OptionSet<Modifier> modifiers,
    MouseButton button,
    unsigned short buttons,
    RefPtr<EventTarget>&& relatedTarget,
    double force,
    SyntheticClickType syntheticClickType,
    const Vector<Ref<MouseEvent>>& coalescedEvents,
    const Vector<Ref<MouseEvent>>& predictedEvents,
    const std::optional<MouseEventInputSource>& inputSource,
    IsSimulated isSimulated,
    IsTrusted isTrusted
)
    : MouseRelatedEvent(
        eventInterface,
        eventType,
        canBubble,
        isCancelable,
        isComposed,
        timestamp,
        WTF::move(view),
        detail,
        screenLocation,
        windowLocation,
        movementX,
        movementY,
        modifiers,
        isSimulated,
        isTrusted
    )
    , m_button(std::to_underlying(button == MouseButton::None ? MouseButton::Left : button))
    , m_buttons(buttons)
    , m_syntheticClickType(button == MouseButton::None ? SyntheticClickType::NoTap : syntheticClickType)
    , m_buttonDown(button != MouseButton::None)
    , m_relatedTarget(WTF::move(relatedTarget))
    , m_force(force)
    , m_coalescedEvents(coalescedEvents)
    , m_predictedEvents(predictedEvents)
    , m_inputSource(inputSource)
{
}

MouseEvent::MouseEvent(
    enum EventInterfaceType eventInterface,
    const AtomString& eventType,
    CanBubble canBubble,
    IsCancelable isCancelable,
    IsComposed isComposed,
    MonotonicTime timestamp,
    RefPtr<Window>&& view,
    int detail,
    const DoublePoint& screenLocation,
    const DoublePoint& clientLocation,
    double movementX,
    double movementY,
    OptionSet<Modifier> modifiers,
    MouseButton button,
    unsigned short buttons,
    SyntheticClickType syntheticClickType,
    RefPtr<EventTarget>&& relatedTarget
)
    : MouseRelatedEvent(
        eventInterface,
        eventType,
        canBubble,
        isCancelable,
        isComposed,
        timestamp,
        WTF::move(view),
        detail,
        screenLocation,
        { },
        movementX,
        movementY,
        modifiers,
        IsSimulated::No
    )
    , m_button(std::to_underlying(button == MouseButton::None ? MouseButton::Left : button))
    , m_buttons(buttons)
    , m_syntheticClickType(button == MouseButton::None ? SyntheticClickType::NoTap : syntheticClickType)
    , m_buttonDown(button != MouseButton::None)
    , m_relatedTarget(WTF::move(relatedTarget))
{
    initCoordinates(clientLocation);
}

MouseEvent::MouseEvent(
    enum EventInterfaceType eventInterface,
    const AtomString& eventType,
    const MouseEventInit& initializer,
    IsTrusted isTrusted
)
    : MouseRelatedEvent(eventInterface, eventType, initializer, isTrusted)
    , m_button(initializer.button == std::to_underlying(MouseButton::None) ? std::to_underlying(MouseButton::Left) : initializer.button)
    , m_buttons(initializer.buttons)
    , m_buttonDown(initializer.button != std::to_underlying(MouseButton::None))
    , m_relatedTarget(initializer.relatedTarget)
{
    initCoordinates({ initializer.clientX, initializer.clientY });
}

MouseEvent::~MouseEvent() = default;

void MouseEvent::initMouseEvent(
    const AtomString& type,
    bool canBubble,
    bool cancelable,
    RefPtr<Window>&& view,
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
)
{
    if (isBeingDispatched())
        return;

    if (!std::isfinite(clientX))
        clientX = 0;
    if (!std::isfinite(clientY))
        clientY = 0;
    if (!std::isfinite(screenX))
        screenX = 0;
    if (!std::isfinite(screenY))
        screenY = 0;

    initUIEvent(type, canBubble, cancelable, WTF::move(view), detail);

    setScreenLocation({ screenX, screenY });
    setModifierKeys(ctrlKey, altKey, shiftKey, metaKey);
    m_button = button == std::to_underlying(MouseButton::None) ? std::to_underlying(MouseButton::Left) : button;
    m_syntheticClickType = SyntheticClickType::NoTap;
    m_buttonDown = button != std::to_underlying(MouseButton::None);
    m_relatedTarget = WTF::move(relatedTarget);

    initCoordinates({ clientX, clientY });

    setIsSimulated(false);
}

bool MouseEvent::canTriggerActivationBehavior(const Event& event)
{
    if (!isAnyClick(event))
        return false;
    auto* mouseEvent = dynamicDowncast<MouseEvent>(event);
    return !mouseEvent || mouseEvent->button() != MouseButton::Right;
}

MouseButton MouseEvent::button() const
{
    return buttonFromShort(m_button);
}

unsigned MouseEvent::which() const
{
    // For the DOM, the return values for left, middle and right mouse buttons are 0, 1, 2, respectively.
    // For the Netscape "which" property, the return values for left, middle and right mouse buttons are 1, 2, 3, respectively.
    // So we must add 1.
    if (!m_buttonDown)
        return 0;
    return static_cast<unsigned>(m_button + 1);
}

RefPtr<Node> MouseEvent::toElement() const
{
    // MSIE extension - "the object toward which the user is moving the mouse pointer"
    RefPtr<EventTarget> target;
    auto& eventNames = WebCore::eventNames();
    if (type() == eventNames.mouseoutEvent || type() == eventNames.mouseleaveEvent)
        target = relatedTarget();
    else
        target = this->target();
    return dynamicDowncast<Node>(WTF::move(target));
}

RefPtr<Node> MouseEvent::fromElement() const
{
    // MSIE extension - "object from which activation or the mouse pointer is exiting during the event" (huh?)
    RefPtr<EventTarget> target;
    auto& eventNames = WebCore::eventNames();
    if (type() == eventNames.mouseoutEvent || type() == eventNames.mouseleaveEvent)
        target = this->target();
    else
        target = relatedTarget();
    return dynamicDowncast<Node>(WTF::move(target));
}

void MouseEvent::setRelatedTarget(RefPtr<EventTarget>&& relatedTarget)
{
    m_relatedTarget = WTF::move(relatedTarget);
}

} // namespace WebCore
