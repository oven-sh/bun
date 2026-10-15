/*
 * Copyright (C) 2001 Peter Kelly (pmk@post.com)
 * Copyright (C) 2001 Tobias Anton (anton@stud.fbi.fh-darmstadt.de)
 * Copyright (C) 2006 Samuel Weinig (sam.weinig@gmail.com)
 * Copyright (C) 2003-2021 Apple Inc. All rights reserved.
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

#include "config.h"
#include "RegisteredEventListener.h"

#include "AbortSignal.h"
#include "EventTarget.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(EventListenerAbortAlgorithm);

EventListenerAbortAlgorithm::EventListenerAbortAlgorithm(AbortSignal& signal, EventTarget& target, const AtomString& eventType, RegisteredEventListener& listener)
    : m_signal(signal)
    , m_target(target)
    , m_eventType(eventType)
    , m_listener(listener)
{
    signal.addAlgorithm(*this);
}

EventListenerAbortAlgorithm::~EventListenerAbortAlgorithm()
{
    unlink();
}

void EventListenerAbortAlgorithm::unlink()
{
    if (isOnList())
        m_signal.removeAlgorithm(*this);
}

void EventListenerAbortAlgorithm::run()
{
    ASSERT(!isOnList());
    RefPtr target = m_target.get();
    if (!target)
        return;
    // Copies: removeEventListener() still uses its arguments after it has freed m_listener.
    auto eventType = m_eventType;
    Ref callback = m_listener.callback();
    bool capture = m_listener.useCapture();
    target->removeEventListener(eventType, callback, capture);
}

RegisteredEventListener::~RegisteredEventListener() = default;

void RegisteredEventListener::removeOnAbort(AbortSignal& signal, EventTarget& target, const AtomString& eventType)
{
    ASSERT(!m_abortAlgorithm);
    m_abortAlgorithm = makeUnique<EventListenerAbortAlgorithm>(signal, target, eventType, *this);
}

void RegisteredEventListener::markAsRemoved()
{
    m_wasRemoved = true;
    if (m_abortAlgorithm)
        m_abortAlgorithm->unlink();
}

} // namespace WebCore
