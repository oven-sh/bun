/*
 * Copyright (C) 2006-2025 Apple Inc. All rights reserved.
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

#pragma once

#include "ThreadTimers.h"
#include <wtf/AbstractCanMakeCheckedPtr.h>
#include <wtf/CurrentThread.h>
#include <wtf/Function.h>
#include <wtf/MonotonicTime.h>
#include <wtf/Noncopyable.h>
#include <wtf/RunLoop.h>
#include <wtf/Seconds.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/TypeTraits.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>

#if PLATFORM(IOS_FAMILY)
#include "WebCoreThread.h"
#endif

namespace WebCore {

class TimerAlignment : public CanMakeWeakPtr<TimerAlignment>, public AbstractCanMakeCheckedPtr {
public:
    virtual ~TimerAlignment() = default;
    virtual MonotonicTime alignedFireTime(bool hasReachedMaxNestingLevel, MonotonicTime) const = 0;
};

class TimerBase {
    WTF_MAKE_TZONE_ALLOCATED(TimerBase);
    WTF_MAKE_NONCOPYABLE(TimerBase);
public:
    WEBCORE_EXPORT TimerBase();
    WEBCORE_EXPORT virtual ~TimerBase();

    TimerBase(TimerBase&&) = delete;
    TimerBase& LEGACY_NODELETE operator=(TimerBase&&) = delete;

    WEBCORE_EXPORT void start(Seconds nextFireInterval, Seconds repeatInterval);

    void startRepeating(Seconds repeatInterval) { start(repeatInterval, repeatInterval); }
    void startOneShot(Seconds delay) { start(delay, 0_s); }

    WEBCORE_EXPORT void startOneShotBeforeDueTimers();

    inline void stop();
    inline bool isActive() const;

    MonotonicTime nextFireTime() const { return m_heapItemWithBitfields.pointer() ? m_heapItemWithBitfields.pointer()->time : MonotonicTime { }; }
    WEBCORE_EXPORT Seconds nextFireInterval() const;
    Seconds nextUnalignedFireInterval() const;
    Seconds repeatInterval() const { return m_repeatInterval; }

    void setTimerAlignment(TimerAlignment& alignment) { m_alignment = alignment; }
    TimerAlignment* timerAlignment() { return m_alignment.get(); }

    bool hasReachedMaxNestingLevel() const { return bitfields().hasReachedMaxNestingLevel; }
    void setHasReachedMaxNestingLevel(bool);

    void augmentFireInterval(Seconds delta) { setNextFireTime(m_heapItemWithBitfields.pointer()->time + delta); }
    void augmentRepeatInterval(Seconds delta) { augmentFireInterval(delta); m_repeatInterval += delta; }

    void didChangeAlignmentInterval();

    WEBCORE_EXPORT static void fireTimersInNestedEventLoop();

protected:
    struct TimerBitfields {
        uint8_t hasReachedMaxNestingLevel : 1 { false };
        uint8_t shouldRestartWhenTimerFires : 1 { false }; // DeferrableOneShotTimer
    };

    TimerBitfields bitfields() const { return std::bit_cast<TimerBitfields>(m_heapItemWithBitfields.type()); }
    void setBitfields(const TimerBitfields& bitfields) { return m_heapItemWithBitfields.setType(std::bit_cast<uint8_t>(bitfields)); }

private:
    virtual void fired() = 0;

    WEBCORE_EXPORT void stopSlowCase();

    void LEGACY_NODELETE checkConsistency() const;
    void LEGACY_NODELETE checkHeapIndex() const;

    void setNextFireTime(MonotonicTime);

    bool inHeap() const { return m_heapItemWithBitfields.pointer() && m_heapItemWithBitfields.pointer()->isInHeap(); }

    bool LEGACY_NODELETE hasValidHeapPosition() const;
    void updateHeapIfNeeded(MonotonicTime oldTime);

    void heapDecreaseKey();
    void heapDelete();
    void heapDeleteMin();
    void heapIncreaseKey();
    void heapInsert();
    void heapPop();
    void heapPopMin();
    static void heapDeleteNullMin(ThreadTimerHeap&);

    WeakPtr<TimerAlignment> m_alignment;
    MonotonicTime m_unalignedNextFireTime; // m_nextFireTime not considering alignment interval
    Seconds m_repeatInterval; // 0 if not repeating

    CompactRefPtrTuple<ThreadTimerHeapItem, uint8_t> m_heapItemWithBitfields;
#if ASSERT_ENABLED
    const uint32_t m_creationThreadID { currentThreadID() };
#endif

    friend class ThreadTimers;
    friend class TimerHeapLessThanFunction;
    friend class TimerHeapReference;
};

class Timer : public TimerBase {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(Timer, WEBCORE_EXPORT);
public:
    static void schedule(Seconds delay, Function<void()>&& function)
    {
        auto* timer = new Timer([] { });
        timer->m_function = [timer, function = WTF::move(function)] {
            function();
            delete timer;
        };
        timer->startOneShot(delay);
    }

    template<typename TimerFiredClass, typename TimerFiredBaseClass>
    requires (WTF::HasRefPtrMemberFunctions<TimerFiredClass> && WTF::HasThreadSafeWeakPtrFunctions<TimerFiredClass>)
    Timer(TimerFiredClass& object, void (TimerFiredBaseClass::*function)())
        : m_function([weakObject = ThreadSafeWeakPtr { object }, function] {
            if (RefPtr protectedObject = weakObject.get())
                (protectedObject.get()->*function)();
        })
    {
    }

    template<typename TimerFiredClass, typename TimerFiredBaseClass>
    requires (WTF::HasRefPtrMemberFunctions<TimerFiredClass> && !WTF::HasThreadSafeWeakPtrFunctions<TimerFiredClass> && WTF::HasWeakPtrFunctions<TimerFiredClass>)
    Timer(TimerFiredClass& object, void (TimerFiredBaseClass::*function)())
        : m_function([weakObject = WeakPtr { object }, function] {
            if (RefPtr protectedObject = weakObject.get())
                (protectedObject.get()->*function)();
        })
    {
    }

    template<typename TimerFiredClass, typename TimerFiredBaseClass>
    requires (WTF::HasCheckedPtrMemberFunctions<TimerFiredClass> && (!WTF::HasRefPtrMemberFunctions<TimerFiredClass> || (!WTF::HasWeakPtrFunctions<TimerFiredClass> && !WTF::HasThreadSafeWeakPtrFunctions<TimerFiredClass>)))
    Timer(TimerFiredClass& object, void (TimerFiredBaseClass::*function)())
        : m_function([checkedObject = CheckedRef { object }, function] {
            (checkedObject.ptr()->*function)();
        })
    {
    }

    Timer(Function<void()>&& function)
        : m_function(WTF::move(function))
    {
    }

private:
    void fired() override
    {
        m_function();
    }
    
    Function<void()> m_function;
};

inline void TimerBase::stop()
{
    if (m_heapItemWithBitfields.pointer())
        stopSlowCase();
}

inline bool TimerBase::isActive() const
{
    ASSERT(canCurrentThreadIDAccessThreadLocalData(m_creationThreadID));
    return static_cast<bool>(nextFireTime());
}

inline void TimerBase::setHasReachedMaxNestingLevel(bool value)
{
    auto values = bitfields();
    values.hasReachedMaxNestingLevel = value;
    setBitfields(values);
}

class DeferrableOneShotTimer : protected TimerBase {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(DeferrableOneShotTimer, WEBCORE_EXPORT);
public:
    template<typename TimerFiredClass>
    DeferrableOneShotTimer(TimerFiredClass& object, void (TimerFiredClass::*function)(), Seconds delay)
        : DeferrableOneShotTimer(std::bind(function, &object), delay)
    {
    }

    DeferrableOneShotTimer(Function<void()>&& function, Seconds delay)
        : m_function(WTF::move(function))
        , m_delay(delay)
    {
    }

    void restart()
    {
        // Setting this boolean is much more efficient than calling startOneShot
        // again, which might result in rescheduling the system timer which
        // can be quite expensive.

        if (isActive()) {
            setShouldRestartWhenTimerFires(true);
            return;
        }
        startOneShot(m_delay);
    }

    void stop()
    {
        setShouldRestartWhenTimerFires(false);
        TimerBase::stop();
    }

    using TimerBase::isActive;

private:
    void fired() override
    {
        if (bitfields().shouldRestartWhenTimerFires) {
            setShouldRestartWhenTimerFires(false);
            startOneShot(m_delay);
            return;
        }

        m_function();
    }

    void setShouldRestartWhenTimerFires(bool value)
    {
        auto values = bitfields();
        values.shouldRestartWhenTimerFires = value;
        setBitfields(values);
    }

    Function<void()> m_function;

    Seconds m_delay;
};

}
