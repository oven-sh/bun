/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 *           (C) 2007, 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2011 Andreas Kling (kling@webkit.org)
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
 *
 */

#include "config.h"
#include "EventListenerMap.h"

#include "AddEventListenerOptions.h"
#include "Event.h"
#include <wtf/MainThread.h>
#include <wtf/StdLibExtras.h>
#include <wtf/Vector.h>

namespace WebCore {

EventListenerMap::EventListenerMap() = default;

bool EventListenerMap::containsActive(const AtomString& eventType) const
{
    auto* listeners = find(eventType);
    if (!listeners)
        return false;

    for (auto& eventListener : *listeners) {
        if (!eventListener->isPassive())
            return true;
    }
    return false;
}

void EventListenerMap::clear()
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    for (auto& entry : m_entries) {
        for (auto& listener : entry.second)
            listener->markAsRemoved();
    }

    m_entries.clear();
    m_entryPositions.clear();
}

Vector<AtomString> EventListenerMap::eventTypes() const
{
    return m_entries.map([](auto& entry) {
        return entry.first;
    });
}

static inline size_t findListener(const EventListenerVector& listeners, EventListener& listener, bool useCapture)
{
    for (size_t i = 0; i < listeners.size(); ++i) {
        auto& registeredListener = listeners[i];
        if (registeredListener->callback() == listener && registeredListener->useCapture() == useCapture)
            return i;
    }
    return notFound;
}

RegisteredEventListener* EventListenerMap::add(const AtomString& eventType, Ref<EventListener>&& listener, const RegisteredEventListener::Options& options)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    if (auto* listeners = find(eventType)) {
        if (findListener(*listeners, listener, options.capture) != notFound)
            return nullptr; // Duplicate listener.
        auto registeredListener = RegisteredEventListener::create(WTF::move(listener), options);
        auto* result = registeredListener.ptr();
        listeners->append(WTF::move(registeredListener));
        return result;
    }

    auto registeredListener = RegisteredEventListener::create(WTF::move(listener), options);
    auto* result = registeredListener.ptr();
    m_entries.append({ eventType, EventListenerVector { WTF::move(registeredListener) } });

    if (!m_entryPositions.isEmpty())
        m_entryPositions.add(positionKey(eventType), static_cast<unsigned>(m_entries.size() - 1));
    else if (m_entries.size() > maxEntriesForLinearSearch) [[unlikely]] {
        m_entryPositions.reserveInitialCapacity(m_entries.size());
        for (unsigned i = 0; i < m_entries.size(); ++i)
            m_entryPositions.add(positionKey(m_entries[i].first), i);
    }

    return result;
}

static bool removeListenerFromVector(EventListenerVector& listeners, EventListener& listener, bool useCapture)
{
    size_t indexOfRemovedListener = findListener(listeners, listener, useCapture);
    if (indexOfRemovedListener == notFound) [[unlikely]]
        return false;

    listeners[indexOfRemovedListener]->markAsRemoved();
    listeners.removeAt(indexOfRemovedListener);
    return true;
}

bool EventListenerMap::remove(const AtomString& eventType, EventListener& listener, bool useCapture)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    size_t position = findEntryPosition(eventType);
    if (position == notFound)
        return false;

    bool wasRemoved = removeListenerFromVector(m_entries[position].second, listener, useCapture);
    if (m_entries[position].second.isEmpty())
        removeEntryAt(position);
    return wasRemoved;
}

// Fills the hole with the last entry instead of shifting, so removing a type is
// O(1). Nothing relies on the order of m_entries.
void EventListenerMap::removeEntryAt(size_t position)
{
    size_t last = m_entries.size() - 1;

    if (!m_entryPositions.isEmpty()) {
        m_entryPositions.remove(positionKey(m_entries[position].first));
        if (position != last)
            m_entryPositions.set(positionKey(m_entries[last].first), static_cast<unsigned>(position));
    }

    if (position != last)
        m_entries[position] = WTF::move(m_entries[last]);
    m_entries.removeLast();

    if (m_entries.size() < maxEntriesForLinearSearch / 2)
        m_entryPositions.clear();
}

size_t EventListenerMap::findEntryPosition(const AtomString& eventType) const
{
    if (!m_entryPositions.isEmpty()) {
        ASSERT(m_entryPositions.size() == m_entries.size());
        auto it = m_entryPositions.find(positionKey(eventType));
        return it == m_entryPositions.end() ? notFound : it->value;
    }

    for (size_t i = 0; i < m_entries.size(); ++i) {
        if (m_entries[i].first == eventType)
            return i;
    }
    return notFound;
}

EventListenerVector* EventListenerMap::find(const AtomString& eventType)
{
    size_t position = findEntryPosition(eventType);
    return position == notFound ? nullptr : &m_entries[position].second;
}

} // namespace WebCore
