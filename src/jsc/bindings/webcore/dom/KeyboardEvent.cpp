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
#include "KeyboardEvent.h"

#include "EventNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(KeyboardEvent);

bool KeyboardEvent::isEnterKeyKeydownEvent(Event& event)
{
    if (event.type() != eventNames().keydownEvent)
        return false;
    auto* keyboardEvent = dynamicDowncast<KeyboardEvent>(event);
    return keyboardEvent && keyboardEvent->keyIdentifier() == "Enter"_s;
}

inline KeyboardEvent::KeyboardEvent()
     : UIEventWithKeyState(EventInterfaceType::KeyboardEvent)
{
}

inline KeyboardEvent::KeyboardEvent(const AtomString& eventType, const Init& initializer, IsTrusted isTrusted)
    : UIEventWithKeyState(EventInterfaceType::KeyboardEvent, eventType, initializer, isTrusted)
    , m_key(initializer.key)
    , m_code(initializer.code)
    , m_keyIdentifier(initializer.keyIdentifier)
    , m_location(initializer.location)
    , m_repeat(initializer.repeat)
    , m_isComposing(initializer.isComposing)
    , m_charCode(initializer.charCode)
    , m_keyCode(initializer.keyCode)
    , m_which(initializer.which)
{
}

KeyboardEvent::~KeyboardEvent() = default;

Ref<KeyboardEvent> KeyboardEvent::createForBindings()
{
    return adoptRef(*new KeyboardEvent);
}

Ref<KeyboardEvent> KeyboardEvent::create(const AtomString& type, const Init& initializer, IsTrusted isTrusted)
{
    return adoptRef(*new KeyboardEvent(type, initializer, isTrusted));
}

void KeyboardEvent::initKeyboardEvent(const AtomString& type, bool canBubble, bool cancelable, RefPtr<Window>&& view,
    const AtomString& keyIdentifier, unsigned location, bool ctrlKey, bool altKey, bool shiftKey, bool metaKey)
{
    if (isBeingDispatched())
        return;

    initUIEvent(type, canBubble, cancelable, WTF::move(view), 0);

    m_keyIdentifier = keyIdentifier;
    m_location = location;

    setModifierKeys(ctrlKey, altKey, shiftKey, metaKey);

    m_charCode = std::nullopt;
    m_isComposing = false;
    m_keyCode = std::nullopt;
    m_repeat = false;
    m_which = std::nullopt;
    m_code = { };
    m_key = { };
}

int KeyboardEvent::keyCode() const
{
    return m_keyCode.value_or(0);
}

int KeyboardEvent::charCode() const
{
    return m_charCode.value_or(0);
}

unsigned KeyboardEvent::which() const
{
    // Netscape's "which" returns a virtual key code for keydown and keyup, and a character code for keypress.
    // That's exactly what IE's "keyCode" returns. So they are the same for keyboard events.
    if (m_which)
        return m_which.value();
    return static_cast<unsigned>(keyCode());
}

FocusEventData KeyboardEvent::focusEventData() const
{
    return { type(), keyIdentifier(), altKey() };
}

} // namespace WebCore
