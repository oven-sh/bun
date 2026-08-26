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
#include <wtf/text/AtomString.h>

namespace WebCore {

#define DOM_EVENT_NAMES_FOR_EACH(macro)                      \
    macro(error)                                             \
        macro(abort)                                         \
            macro(close)                                     \
                macro(copy)                                  \
                    macro(paste)                             \
                        macro(open)                          \
                            macro(rename)                    \
                                macro(message)               \
                                    macro(change)            \
                                        macro(messageerror)  \
                                            macro(handshake) \
                                                macro(resourcetimingbufferfull)

struct EventNames {
    WTF_MAKE_NONCOPYABLE(EventNames);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(EventNames);

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

private:
    EventNames(); // Private to prevent accidental call to EventNames() instead of eventNames().
    // friend class ThreadGlobalData; // Allow ThreadGlobalData to create the per-thread EventNames object.

    [[maybe_unused]] int dummy; // Needed to make initialization macro work.
};

const EventNames& eventNames();

inline bool EventNames::isWheelEventType(const AtomString& eventType) const
{
    return false;
}

} // namespace WebCore
