/*
 * Copyright (C) 2008-2020 Apple Inc. All rights reserved.
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

#include "WorkerRunLoop.h"
#include "WorkerThreadMode.h"
#include <wtf/Forward.h>
#include <wtf/Function.h>
#include <wtf/Lock.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/threads/BinarySemaphore.h>

namespace WTF {
class Thread;
}

namespace WebCore {

class WorkerDebuggerProxy;
class WorkerLoaderProxy;

class WorkerOrWorkletThread : public ThreadSafeRefCounted<WorkerOrWorkletThread> {
public:
    virtual ~WorkerOrWorkletThread();

    Thread* thread() const { return m_thread.get(); }

    virtual WorkerDebuggerProxy* workerDebuggerProxy() const = 0;
    virtual WorkerLoaderProxy& workerLoaderProxy() = 0;

    WorkerOrWorkletGlobalScope* globalScope() const { return m_globalScope.get(); }
    WorkerRunLoop& runLoop() { return m_runLoop; }

    void start(Function<void(const String&)>&& evaluateCallback = { });
    void stop(Function<void()>&& terminatedCallback = { });

    void startRunningDebuggerTasks();
    void stopRunningDebuggerTasks();

    void suspend();
    void resume();

    const String& inspectorIdentifier() const { return m_inspectorIdentifier; }

    static HashSet<WorkerOrWorkletThread*>& workerOrWorkletThreads() WTF_REQUIRES_LOCK(workerOrWorkletThreadsLock());
    static Lock& workerOrWorkletThreadsLock() WTF_RETURNS_LOCK(s_workerOrWorkletThreadsLock);
    static void releaseFastMallocFreeMemoryInAllThreads();

protected:
    explicit WorkerOrWorkletThread(const String& inspectorIdentifier, WorkerThreadMode = WorkerThreadMode::CreateNewThread);
    void workerOrWorkletThread();

    // Executes the event loop for the worker thread. Derived classes can override to perform actions before/after entering the event loop.
    virtual void runEventLoop();

private:
    virtual Ref<Thread> createThread() = 0;
    virtual RefPtr<WorkerOrWorkletGlobalScope> createGlobalScope() = 0;
    virtual void evaluateScriptIfNecessary(String&) { }
    virtual bool shouldWaitForWebInspectorOnStartup() const { return false; }

    static Lock s_workerOrWorkletThreadsLock;

    String m_inspectorIdentifier;
    Lock m_threadCreationAndGlobalScopeLock;
    RefPtr<WorkerOrWorkletGlobalScope> m_globalScope;
    RefPtr<Thread> m_thread;
    UniqueRef<WorkerRunLoop> m_runLoop;
    Function<void(const String&)> m_evaluateCallback;
    Function<void()> m_stoppedCallback;
    BinarySemaphore m_suspensionSemaphore;
    bool m_isSuspended { false };
    bool m_pausedForDebugger { false };
};

} // namespace WebCore
