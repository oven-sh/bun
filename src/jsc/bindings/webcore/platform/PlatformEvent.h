/*
 * Copyright (C) 2011-2020 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <wtf/MonotonicTime.h>
#include <wtf/OptionSet.h>
#include <wtf/UUID.h>

namespace WebCore {

enum class EventHandling : uint8_t {
    DispatchedToDOM     = 1 << 0,
    DefaultPrevented    = 1 << 1,
    DefaultHandled      = 1 << 2,
};

enum class PlatformEventType : uint8_t {
    NoType = 0,

    // PlatformKeyboardEvent
    KeyDown,
    KeyUp,
    RawKeyDown,
    Char,

    // PlatformMouseEvent
    MouseMoved,
    MousePressed,
    MouseReleased,
    MouseForceChanged,
    MouseForceDown,
    MouseForceUp,
    MouseScroll,

    // PlatformWheelEvent
    Wheel,

#if ENABLE(TOUCH_EVENTS)
    // PlatformTouchEvent
    TouchStart,
    TouchMove,
    TouchEnd,
    TouchCancel,
    TouchForceChange,
#endif

#if ENABLE(MAC_GESTURE_EVENTS)
    // PlatformGestureEvent
    GestureStart,
    GestureChange,
    GestureEnd,
#endif
};

enum class PlatformEventModifier : uint8_t {
    AltKey      = 1 << 0,
    ControlKey  = 1 << 1,
    MetaKey     = 1 << 2,
    ShiftKey    = 1 << 3,
    CapsLockKey = 1 << 4,

    // Populated from native events on platforms with an AltGraph (AltGr) key
    // (Windows, GTK/X11); also set for JS-constructed events via initEvent.
    AltGraphKey = 1 << 5,
};


class PlatformEvent {
public:

    using Type = PlatformEventType;
    using Modifier = PlatformEventModifier;

    Type type() const { return m_type; }

    bool shiftKey() const { return m_modifiers.contains(Modifier::ShiftKey); }
    bool controlKey() const { return m_modifiers.contains(Modifier::ControlKey); }
    bool altKey() const { return m_modifiers.contains(Modifier::AltKey); }
    bool metaKey() const { return m_modifiers.contains(Modifier::MetaKey); }

    OptionSet<Modifier> modifiers() const { return m_modifiers; }

    MonotonicTime timestamp() const { return m_timestamp; }
    std::optional<WTF::UUID> authorizationToken() const { return m_authorizationToken; };

protected:
    PlatformEvent()
        : m_type(Type::NoType)
    {
    }

    explicit PlatformEvent(Type type)
        : m_type(type)
    {
    }

    PlatformEvent(Type type, OptionSet<Modifier> modifiers, MonotonicTime timestamp)
        : m_timestamp(timestamp)
        , m_type(type)
        , m_modifiers(modifiers)
    {
    }

    PlatformEvent(Type type, bool shiftKey, bool ctrlKey, bool altKey, bool metaKey, MonotonicTime timestamp)
        : m_timestamp(timestamp)
        , m_type(type)
    {
        if (shiftKey)
            m_modifiers.add(Modifier::ShiftKey);
        if (ctrlKey)
            m_modifiers.add(Modifier::ControlKey);
        if (altKey)
            m_modifiers.add(Modifier::AltKey);
        if (metaKey)
            m_modifiers.add(Modifier::MetaKey);
    }

    // Explicit protected destructor so that people don't accidentally
    // delete a PlatformEvent.
    ~PlatformEvent() = default;

    MonotonicTime m_timestamp;
    Type m_type;
    OptionSet<Modifier> m_modifiers;
    std::optional<WTF::UUID> m_authorizationToken;
};

} // namespace WebCore
