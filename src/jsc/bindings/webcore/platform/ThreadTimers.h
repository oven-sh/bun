/*
 * Copyright (C) 2006 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Google Inc. All rights reserved.
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
 */

#ifndef ThreadTimers_h
#define ThreadTimers_h

#include <wtf/CheckedPtr.h>
#include <wtf/MonotonicTime.h>
#include <wtf/Noncopyable.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/Vector.h>

namespace WebCore {

class SharedTimer;
class ThreadTimers;
class TimerBase;

struct ThreadTimerHeapItem;
using ThreadTimerHeap = Vector<Ref<ThreadTimerHeapItem>>;
    
// A collection of timers per thread. Kept in ThreadGlobalData.
class ThreadTimers {
    WTF_MAKE_TZONE_ALLOCATED(ThreadTimers);
    WTF_MAKE_NONCOPYABLE(ThreadTimers);
public:
    ThreadTimers();

    // Fire timers for this length of time, and then quit to let the run loop process user input events.
    static constexpr auto maxDurationOfFiringTimers { 16_ms };

    // On a thread different then main, we should set the thread's instance of the SharedTimer.
    void setSharedTimer(SharedTimer*);

    ThreadTimerHeap& timerHeap() LIFETIME_BOUND { return m_timerHeap; }

    void updateSharedTimer();
    void fireTimersInNestedEventLoop();
    void LEGACY_NODELETE breakFireLoopForRenderingUpdate();

    unsigned nextHeapInsertionCount() { return m_currentHeapInsertionOrder++; }

private:
    void sharedTimerFiredInternal();
    void fireTimersInNestedEventLoopInternal();

    ThreadTimerHeap m_timerHeap;
    CheckedPtr<SharedTimer> m_sharedTimer; // External object, can be a run loop on a worker thread. Normally set/reset by worker thread.
    bool m_firingTimers { false };
    bool m_shouldBreakFireLoopForRenderingUpdate { false };
    unsigned m_currentHeapInsertionOrder { 0 };
    MonotonicTime m_pendingSharedTimerFireTime;
};

struct ThreadTimerHeapItem : ThreadSafeRefCounted<ThreadTimerHeapItem> {
    WTF_MAKE_COMPACT_TZONE_ALLOCATED(ThreadTimerHeapItem);

public:
    static RefPtr<ThreadTimerHeapItem> create(TimerBase&, MonotonicTime, unsigned);

    bool hasTimer() const { return m_timer; }
    TimerBase& timer();
    void clearTimer();

    ThreadTimerHeap& timerHeap() const;

    unsigned heapIndex() const;
    void setHeapIndex(unsigned newIndex);
    void setNotInHeap() { m_heapIndex = invalidHeapIndex; }

    bool isInHeap() const { return m_heapIndex != invalidHeapIndex; }
    bool isFirstInHeap() const { return !m_heapIndex; }

    MonotonicTime time;
    unsigned insertionOrder { 0 };

private:
    ThreadTimers& m_threadTimers;
    TimerBase* m_timer { nullptr };
    unsigned m_heapIndex { invalidHeapIndex };

    static const unsigned invalidHeapIndex = static_cast<unsigned>(-1);

    ThreadTimerHeapItem(TimerBase&, MonotonicTime, unsigned);
};

inline TimerBase& ThreadTimerHeapItem::timer()
{
    ASSERT(m_timer);
    return *m_timer;
}

inline void ThreadTimerHeapItem::clearTimer()
{
    ASSERT(!isInHeap());
    m_timer = nullptr;
}

inline unsigned ThreadTimerHeapItem::heapIndex() const
{
    ASSERT(m_heapIndex != invalidHeapIndex);
    return static_cast<unsigned>(m_heapIndex);
}

inline void ThreadTimerHeapItem::setHeapIndex(unsigned newIndex)
{
    ASSERT(newIndex != invalidHeapIndex);
    m_heapIndex = newIndex;
}

inline ThreadTimerHeap& ThreadTimerHeapItem::timerHeap() const
{
    return m_threadTimers.timerHeap();
}

}

#endif
