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
    auto* entry = findEntry(eventType);
    if (!entry)
        return false;

    for (auto& eventListener : entry->listeners) {
        if (eventListener && !eventListener->isPassive())
            return true;
    }
    return false;
}

void EventListenerMap::clear()
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    for (auto& entry : m_entries) {
        for (auto& listener : entry.listeners) {
            if (listener)
                listener->markAsRemoved();
        }
    }

    m_entries.clear();
}

Vector<AtomString> EventListenerMap::eventTypes() const
{
    return m_entries.map([](auto& entry) {
        return entry.type;
    });
}

// Scans forward from slot 0 and from searchStart in turn. remove() passes the slot where it expects
// the listener, and the scan from slot 0 keeps a wrong guess within twice the cost of a plain scan.
// add() rejects a duplicate, so at most one listener matches.
static inline size_t findListener(const EventListenerVector& listeners, EventListener& listener, bool useCapture, size_t searchStart = 0)
{
    auto matches = [&](size_t index) {
        auto& registeredListener = listeners[index];
        return registeredListener && registeredListener->callback() == listener && registeredListener->useCapture() == useCapture;
    };

    size_t size = listeners.size();
    searchStart = std::min(searchStart, size);
    for (size_t low = 0, high = searchStart; low < searchStart || high < size; ++low, ++high) {
        if (high < size && matches(high))
            return high;
        if (low < searchStart && matches(low))
            return low;
    }
    return notFound;
}

RegisteredEventListener* EventListenerMap::add(const AtomString& eventType, Ref<EventListener>&& listener, const RegisteredEventListener::Options& options)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    if (auto* entry = findEntry(eventType)) {
        if (findListener(entry->listeners, listener, options.capture) != notFound)
            return nullptr; // Duplicate listener.
        auto registeredListener = RegisteredEventListener::create(WTF::move(listener), options);
        auto* result = registeredListener.ptr();
        entry->listeners.append(WTF::move(registeredListener));
        return result;
    }

    auto registeredListener = RegisteredEventListener::create(WTF::move(listener), options);
    auto* result = registeredListener.ptr();
    m_entries.append(Entry { eventType, EventListenerVector { WTF::move(registeredListener) } });
    return result;
}

void EventListenerMap::Entry::closeEmptySlots()
{
    unsigned listenerCount = 0;
    unsigned listenerCountBeforeSearchStart = 0;
    for (unsigned i = 0; i < listeners.size(); ++i) {
        if (!listeners[i])
            continue;
        if (i < searchStart)
            ++listenerCountBeforeSearchStart;
        if (listenerCount != i)
            listeners[listenerCount] = WTF::move(listeners[i]);
        ++listenerCount;
    }
    listeners.shrink(listenerCount);
    emptySlotCount = 0;
    searchStart = listenerCountBeforeSearchStart;
}

bool EventListenerMap::remove(const AtomString& eventType, EventListener& listener, bool useCapture)
{
    releaseAssertOrSetThreadUID();
    Locker locker { m_lock };

    for (unsigned i = 0; i < m_entries.size(); ++i) {
        auto& entry = m_entries[i];
        if (entry.type != eventType)
            continue;

        auto& listeners = entry.listeners;
        size_t index = findListener(listeners, listener, useCapture, entry.searchStart);
        if (index == notFound) [[unlikely]]
            return false;

        listeners[index]->markAsRemoved();
        if (listeners.size() - entry.emptySlotCount == 1) {
            m_entries.removeAt(i);
            return true;
        }

        if (index + 1 == listeners.size()) {
            // Nothing to shift. Another listener remains, so the loop ends.
            listeners.removeLast();
            while (!listeners.last()) {
                listeners.removeLast();
                --entry.emptySlotCount;
            }
            entry.searchStart = listeners.size() - 1;
            return true;
        }

        listeners[index] = nullptr;
        entry.searchStart = index + 1;
        // Closing the slots only when they are as many as the listeners keeps a removal O(1), amortized.
        if (++entry.emptySlotCount >= listeners.size() - entry.emptySlotCount)
            entry.closeEmptySlots();
        return true;
    }

    return false;
}

EventListenerMap::Entry* EventListenerMap::findEntry(const AtomString& eventType)
{
    for (auto& entry : m_entries) {
        if (entry.type == eventType)
            return &entry;
    }

    return nullptr;
}

EventListenerVector* EventListenerMap::find(const AtomString& eventType)
{
    auto* entry = findEntry(eventType);
    if (!entry)
        return nullptr;

    if (entry->emptySlotCount) {
        releaseAssertOrSetThreadUID();
        Locker locker { m_lock };
        entry->closeEmptySlots();
    }
    return &entry->listeners;
}

} // namespace WebCore
