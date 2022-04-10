/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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

#include "TaskSource.h"
#include <wtf/Function.h>
#include <wtf/RefCounted.h>
#include <wtf/StdLibExtras.h>
#include <wtf/WeakHashSet.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

class ActiveDOMCallbackMicrotask;
class EventLoopTaskGroup;
class EventTarget;
class MicrotaskQueue;
class ScriptExecutionContext;

class EventLoopTask {
    WTF_MAKE_NONCOPYABLE(EventLoopTask);
    WTF_MAKE_FAST_ALLOCATED;

public:
    virtual ~EventLoopTask() = default;

    TaskSource taskSource() { return m_taskSource; }
    virtual void execute() = 0;

    EventLoopTaskGroup* group() const { return m_group.get(); }

protected:
    EventLoopTask(TaskSource, EventLoopTaskGroup&);

private:
    const TaskSource m_taskSource;
    WeakPtr<EventLoopTaskGroup> m_group;
};

// https://html.spec.whatwg.org/multipage/webappapis.html#event-loop
class EventLoop : public RefCounted<EventLoop>, public CanMakeWeakPtr<EventLoop> {
public:
    virtual ~EventLoop() = default;

    typedef Function<void ()> TaskFunction;
    void queueTask(std::unique_ptr<EventLoopTask>&&);

    // https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-microtask
    void queueMicrotask(std::unique_ptr<EventLoopTask>&&);

    // https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint
    void performMicrotaskCheckpoint();
    virtual MicrotaskQueue& microtaskQueue() = 0;

    void resumeGroup(EventLoopTaskGroup&);
    void stopGroup(EventLoopTaskGroup&);

    void registerGroup(EventLoopTaskGroup&);
    void unregisterGroup(EventLoopTaskGroup&);
    void stopAssociatedGroupsIfNecessary();

protected:
    EventLoop() = default;
    void run();
    void clearAllTasks();

private:
    void scheduleToRunIfNeeded();
    virtual void scheduleToRun() = 0;
    virtual bool isContextThread() const = 0;

    // Use a global queue instead of multiple task queues since HTML5 spec allows UA to pick arbitrary queue.
    Vector<std::unique_ptr<EventLoopTask>> m_tasks;
    WeakHashSet<EventLoopTaskGroup> m_associatedGroups;
    WeakHashSet<EventLoopTaskGroup> m_groupsWithSuspendedTasks;
    bool m_isScheduledToRun { false };
};

class EventLoopTaskGroup : public CanMakeWeakPtr<EventLoopTaskGroup> {
    WTF_MAKE_NONCOPYABLE(EventLoopTaskGroup);
    WTF_MAKE_FAST_ALLOCATED;

public:
    EventLoopTaskGroup(EventLoop& eventLoop)
        : m_eventLoop(eventLoop)
    {
        eventLoop.registerGroup(*this);
    }

    ~EventLoopTaskGroup()
    {
        if (auto* eventLoop = m_eventLoop.get())
            eventLoop->unregisterGroup(*this);
    }

    bool hasSameEventLoopAs(EventLoopTaskGroup& otherGroup)
    {
        ASSERT(m_eventLoop);
        return m_eventLoop == otherGroup.m_eventLoop;
    }

    bool matchesTask(EventLoopTask& task) const
    {
        auto* group = task.group();
        return group == this;
    }

    // Marks the group as ready to stop but it won't actually be stopped
    // until all groups in this event loop are ready to stop.
    void markAsReadyToStop()
    {
        if (isReadyToStop() || isStoppedPermanently())
            return;

        bool wasSuspended = isSuspended();
        m_state = State::ReadyToStop;
        if (auto* eventLoop = m_eventLoop.get())
            eventLoop->stopAssociatedGroupsIfNecessary();

        if (wasSuspended && !isStoppedPermanently()) {
            // We we get marked as ready to stop while suspended (happens when a CachedPage gets destroyed) then the
            // queued tasks will never be able to run (since tasks don't run while suspended and we will never resume).
            // As a result, we can simply discard our tasks and stop permanently.
            stopAndDiscardAllTasks();
        }
    }

    // This gets called by the event loop when all groups in the EventLoop as ready to stop.
    void stopAndDiscardAllTasks()
    {
        ASSERT(isReadyToStop());
        m_state = State::Stopped;
        if (auto* eventLoop = m_eventLoop.get())
            eventLoop->stopGroup(*this);
    }

    void suspend()
    {
        ASSERT(!isStoppedPermanently());
        ASSERT(!isReadyToStop());
        m_state = State::Suspended;
        // We don't remove suspended tasks to preserve the ordering.
        // EventLoop::run checks whether each task's group is suspended or not.
    }

    void resume()
    {
        ASSERT(!isStoppedPermanently());
        ASSERT(!isReadyToStop());
        m_state = State::Running;
        if (auto* eventLoop = m_eventLoop.get())
            eventLoop->resumeGroup(*this);
    }

    bool isStoppedPermanently() const { return m_state == State::Stopped; }
    bool isSuspended() const { return m_state == State::Suspended; }
    bool isReadyToStop() const { return m_state == State::ReadyToStop; }

    void queueTask(std::unique_ptr<EventLoopTask>&&);
    WEBCORE_EXPORT void queueTask(TaskSource, EventLoop::TaskFunction&&);

    // https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-microtask
    WEBCORE_EXPORT void queueMicrotask(EventLoop::TaskFunction&&);
    MicrotaskQueue& microtaskQueue() { return m_eventLoop->microtaskQueue(); }

    // https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint
    void performMicrotaskCheckpoint();

    void runAtEndOfMicrotaskCheckpoint(EventLoop::TaskFunction&&);

private:
    enum class State : uint8_t { Running, Suspended, ReadyToStop, Stopped };

    WeakPtr<EventLoop> m_eventLoop;
    State m_state { State::Running };
};

inline EventLoopTask::EventLoopTask(TaskSource source, EventLoopTaskGroup& group)
    : m_taskSource(source)
    , m_group(group)
{ }

} // namespace WebCore
