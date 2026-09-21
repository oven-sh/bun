/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
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

#pragma once

#include "ContextDestructionObserver.h"
#include "TaskSource.h"
#include <atomic>
#include <wtf/Assertions.h>
#include <wtf/CurrentThread.h>
#include <wtf/Forward.h>
#include <wtf/Function.h>
#include <wtf/RefCounted.h>

namespace WebCore {

class WEBCORE_EXPORT ActiveDOMObject : public ContextDestructionObserver {
public:
    // Must be called exactly once after construction: an object created on a context whose active
    // objects are already stopped is stop()ped right away.
    void suspendIfNeeded();
    void assertSuspendIfNeededWasCalled() const;

    // This function is used by JS bindings to determine if the JS wrapper should be kept alive or not.
    // Also read on the GC thread (JS*Owner::isReachableFromOpaqueRoots), concurrently with the mutator.
    bool hasPendingActivity() const { return m_pendingActivityInstanceCount.load(std::memory_order_relaxed) || virtualHasPendingActivity(); }

    // This function must not have a side effect of creating an ActiveDOMObject.
    // That means it must not result in calls to arbitrary JavaScript.
    // It can, however, have a side effect of deleting an ActiveDOMObject.
    virtual void stop();

    template<class T>
    class PendingActivity : public RefCounted<PendingActivity<T>> {
    public:
        explicit PendingActivity(T& thisObject)
            : m_thisObject(thisObject)
        {
            m_thisObject->m_pendingActivityInstanceCount.fetch_add(1, std::memory_order_relaxed);
        }

        ~PendingActivity()
        {
            ASSERT(m_thisObject->m_pendingActivityInstanceCount.load(std::memory_order_relaxed) > 0);
            m_thisObject->m_pendingActivityInstanceCount.fetch_sub(1, std::memory_order_relaxed);
        }

    private:
        const Ref<T> m_thisObject;
    };

    template<class T> Ref<PendingActivity<T>> makePendingActivity(T& thisObject)
    {
        ASSERT(&thisObject == this);
        return adoptRef(*new PendingActivity<T>(thisObject));
    }

    bool isContextStopped() const;

    template<typename T, typename Task>
    static void queueTaskKeepingObjectAlive(T& object, TaskSource source, Task&& task)
    {
        auto activity = object.ActiveDOMObject::makePendingActivity(object);
        object.queueTaskInEventLoop(source, [protectedObject = Ref { object }, activity = WTF::move(activity), task = WTF::move(task)]() mutable {
            task(protectedObject.get());
        });
    }

protected:
    explicit ActiveDOMObject(ScriptExecutionContext*);
    virtual ~ActiveDOMObject();

private:
    // This is used by subclasses to indicate that they have pending activity, meaning that they would
    // like the JS wrapper to stay alive (because they may still fire JS events).
    virtual bool virtualHasPendingActivity() const { return false; }

    void queueTaskInEventLoop(TaskSource, Function<void()>&&);

    std::atomic<uint64_t> m_pendingActivityInstanceCount { 0 };
#if ASSERT_ENABLED
    bool m_suspendIfNeededWasCalled { false };
    const uint32_t m_creationThreadID { currentThreadID() };
#endif
};

#if !ASSERT_ENABLED

inline void ActiveDOMObject::assertSuspendIfNeededWasCalled() const
{
}

#endif

} // namespace WebCore
