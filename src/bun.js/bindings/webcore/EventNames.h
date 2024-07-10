/*
 * Copyright (C) 2005, 2007, 2015 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Jon Shier (jshier@iastate.edu)
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

// #include "ThreadGlobalData.h"
#include "EventTarget.h"
#include <array>
#include <functional>
#include <wtf/text/AtomString.h>

namespace WebCore {

#define DOM_EVENT_NAMES_FOR_EACH(macro)   \
    macro(error)                          \
        macro(abort)                      \
            macro(close)                  \
                macro(open)               \
                    macro(rename)         \
                        macro(message)    \
                            macro(change) \
                                macro(messageerror)

struct EventNames {
    WTF_MAKE_NONCOPYABLE(EventNames);
    WTF_MAKE_FAST_ALLOCATED;

public:
#define DOM_EVENT_NAMES_DECLARE(name) const AtomString name##Event;
    DOM_EVENT_NAMES_FOR_EACH(DOM_EVENT_NAMES_DECLARE)
#undef DOM_EVENT_NAMES_DECLARE

    // FIXME: The friend declaration to makeUnique below does not work in windows port.
    //
    // template<class T, class... Args>
    // friend typename std::_Unique_if<T>::_Single_object makeUnique(Args&&...);
    //
    // This create function should be deleted later and is only for keeping EventNames as private.
    // makeUnique should be used instead.
    //
    template<class... Args>
    static std::unique_ptr<EventNames> create(Args&&... args)
    {
        return std::unique_ptr<EventNames>(new EventNames(std::forward<Args>(args)...));
    }

    // FIXME: Inelegant to call these both event names and event types.
    // We should choose one term and stick to it.
    bool isWheelEventType(const AtomString& eventType) const;
    bool isGestureEventType(const AtomString& eventType) const;
    bool isTouchRelatedEventType(const AtomString& eventType, EventTarget&) const;
    bool isTouchScrollBlockingEventType(const AtomString& eventType) const;
#if ENABLE(GAMEPAD)
    bool isGamepadEventType(const AtomString& eventType) const;
#endif

    std::array<std::reference_wrapper<const AtomString>, 0> touchRelatedEventNames() const;
    std::array<std::reference_wrapper<const AtomString>, 0> extendedTouchRelatedEventNames() const;
    std::array<std::reference_wrapper<const AtomString>, 0> gestureEventNames() const;

private:
    EventNames(); // Private to prevent accidental call to EventNames() instead of eventNames().
    // friend class ThreadGlobalData; // Allow ThreadGlobalData to create the per-thread EventNames object.

    int dummy; // Needed to make initialization macro work.
};

const EventNames& eventNames();

inline bool EventNames::isGestureEventType(const AtomString& eventType) const
{
    return false; // eventType == gesturestartEvent || eventType == gesturechangeEvent || eventType == gestureendEvent;
}

inline bool EventNames::isTouchScrollBlockingEventType(const AtomString& eventType) const
{
    return false;
}

inline bool EventNames::isTouchRelatedEventType(const AtomString& eventType, EventTarget& target) const
{
    return false;
}

inline bool EventNames::isWheelEventType(const AtomString& eventType) const
{
    return false;
}

inline std::array<std::reference_wrapper<const AtomString>, 0> EventNames::touchRelatedEventNames() const
{
    return { {} };
}

inline std::array<std::reference_wrapper<const AtomString>, 0> EventNames::extendedTouchRelatedEventNames() const
{
    return { {} };
}

inline std::array<std::reference_wrapper<const AtomString>, 0> EventNames::gestureEventNames() const
{
    return { {} };
}

// inline std::array<std::reference_wrapper<const AtomString>, 13> EventNames::touchRelatedEventNames() const
// {
//     return { { touchstartEvent, touchmoveEvent, touchendEvent, touchcancelEvent, touchforcechangeEvent, pointeroverEvent, pointerenterEvent, pointerdownEvent, pointermoveEvent, pointerupEvent, pointeroutEvent, pointerleaveEvent, pointercancelEvent } };
// }

// inline std::array<std::reference_wrapper<const AtomString>, 16> EventNames::extendedTouchRelatedEventNames() const
// {
//     return { { touchstartEvent, touchmoveEvent, touchendEvent, touchcancelEvent, touchforcechangeEvent, pointeroverEvent, pointerenterEvent, pointerdownEvent, pointermoveEvent, pointerupEvent, pointeroutEvent, pointerleaveEvent, pointercancelEvent, mousedownEvent, mousemoveEvent, mouseupEvent } };
// }

// inline std::array<std::reference_wrapper<const AtomString>, 3> EventNames::gestureEventNames() const
// {
//     return { { gesturestartEvent, gesturechangeEvent, gestureendEvent } };
// }

} // namespace WebCore
