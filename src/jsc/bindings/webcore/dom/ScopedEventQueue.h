/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "GCReachableRef.h"
#include <wtf/Forward.h>
#include <wtf/Noncopyable.h>
#include <wtf/Ref.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>

namespace WebCore {

class Event;
class EventQueueScope;

class ScopedEventQueue {
    WTF_MAKE_TZONE_ALLOCATED(ScopedEventQueue);
    WTF_MAKE_NONCOPYABLE(ScopedEventQueue);
public:
    ScopedEventQueue() = default;

    static ScopedEventQueue& singleton();

    struct ScopedEvent {
        Ref<Event> event;
        GCReachableRef<Node> target;
    };
    void enqueueEvent(ScopedEvent&&);

private:
    void dispatchEvent(const ScopedEvent&) const;
    void dispatchAllEvents();
    void incrementScopingLevel() { ++m_scopingLevel; }
    void decrementScopingLevel();

    Vector<ScopedEvent> m_queuedEvents;
    unsigned m_scopingLevel { 0 };

    friend class EventQueueScope;
};

class EventQueueScope {
    WTF_MAKE_NONCOPYABLE(EventQueueScope);
public:
    EventQueueScope() { ScopedEventQueue::singleton().incrementScopingLevel(); }
    ~EventQueueScope() { ScopedEventQueue::singleton().decrementScopingLevel(); }
};

} // namespace WebCore
