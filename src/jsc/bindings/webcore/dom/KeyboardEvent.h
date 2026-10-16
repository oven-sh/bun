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

#include "EventModifierInit.h"
#include "FocusEventData.h"
#include "UIEventWithKeyState.h"

namespace WebCore {

class Node;

struct FocusEventData;

class KeyboardEvent final : public UIEventWithKeyState {
    WTF_MAKE_TZONE_ALLOCATED(KeyboardEvent);
public:
    enum KeyLocationCode {
        DOM_KEY_LOCATION_STANDARD = 0x00,
        DOM_KEY_LOCATION_LEFT = 0x01,
        DOM_KEY_LOCATION_RIGHT = 0x02,
        DOM_KEY_LOCATION_NUMPAD = 0x03
    };

    static Ref<KeyboardEvent> createForBindings();

    struct Init : public EventModifierInit {
        String key;
        String code;
        unsigned location;
        bool repeat;
        bool isComposing;

        // Legacy.
        AtomString keyIdentifier;
        unsigned charCode;
        unsigned keyCode;
        unsigned which;
    };

    static Ref<KeyboardEvent> create(const AtomString& type, const Init&, IsTrusted = IsTrusted::No);

    virtual ~KeyboardEvent();
    
    WEBCORE_EXPORT void initKeyboardEvent(const AtomString& type, bool canBubble, bool cancelable, RefPtr<Window>&&,
        const AtomString& keyIdentifier, unsigned location,
        bool ctrlKey, bool altKey, bool shiftKey, bool metaKey);

    static bool isEnterKeyKeydownEvent(Event&);

    const String& key() const LIFETIME_BOUND { return m_key; }
    const String& code() const LIFETIME_BOUND { return m_code; }
    const AtomString& keyIdentifier() const LIFETIME_BOUND { return m_keyIdentifier; }
    unsigned location() const { return m_location; }
    bool repeat() const { return m_repeat; }

    WEBCORE_EXPORT int keyCode() const; // key code for keydown and keyup, character for keypress
    WEBCORE_EXPORT int charCode() const; // character code for keypress, 0 for keydown and keyup

    unsigned which() const final;

    bool isComposing() const { return m_isComposing; }

    FocusEventData LEGACY_NODELETE focusEventData() const;

private:
    KeyboardEvent();
    KeyboardEvent(const AtomString&, const Init&, IsTrusted = IsTrusted::No);

    String m_key;
    String m_code;
    AtomString m_keyIdentifier;
    unsigned m_location { DOM_KEY_LOCATION_STANDARD };
    bool m_repeat { false };
    bool m_isComposing { false };
    std::optional<unsigned> m_charCode;
    std::optional<unsigned> m_keyCode;
    std::optional<unsigned> m_which;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT(KeyboardEvent)
