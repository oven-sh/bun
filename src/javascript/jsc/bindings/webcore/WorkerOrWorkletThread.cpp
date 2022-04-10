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

#include "config.h"
#include "WorkerOrWorkletThread.h"

#include "ThreadGlobalData.h"
#include "WorkerEventLoop.h"
#include "WorkerOrWorkletGlobalScope.h"
#include "WorkerOrWorkletScriptController.h"

#if PLATFORM(IOS_FAMILY)
#include "FloatingPointEnvironment.h"
#endif

#if USE(GLIB)
#include <wtf/glib/GRefPtr.h>
#endif

namespace WebCore {

Lock WorkerOrWorkletThread::s_workerOrWorkletThreadsLock;

Lock& WorkerOrWorkletThread::workerOrWorkletThreadsLock()
{
    return s_workerOrWorkletThreadsLock;
}

HashSet<WorkerOrWorkletThread*>& WorkerOrWorkletThread::workerOrWorkletThreads()
{
    ASSERT(workerOrWorkletThreadsLock().isHeld());
    static NeverDestroyed<HashSet<WorkerOrWorkletThread*>> workerOrWorkletThreads;
    return workerOrWorkletThreads;
}

static UniqueRef<WorkerRunLoop> constructRunLoop(WorkerThreadMode workerThreadMode)
{
    switch (workerThreadMode) {
    case WorkerThreadMode::UseMainThread:
        return makeUniqueRef<WorkerMainRunLoop>();
    case WorkerThreadMode::CreateNewThread:
        break;
    }
    return makeUniqueRef<WorkerDedicatedRunLoop>();
}

WorkerOrWorkletThread::WorkerOrWorkletThread(const String& inspectorIdentifier, WorkerThreadMode workerThreadMode)
    : m_inspectorIdentifier(inspectorIdentifier)
    , m_runLoop(constructRunLoop(workerThreadMode))
{
    Locker locker { workerOrWorkletThreadsLock() };
    workerOrWorkletThreads().add(this);
}

WorkerOrWorkletThread::~WorkerOrWorkletThread()
{
    Locker locker { workerOrWorkletThreadsLock() };
    ASSERT(workerOrWorkletThreads().contains(this));
    workerOrWorkletThreads().remove(this);
}

void WorkerOrWorkletThread::startRunningDebuggerTasks()
{
    ASSERT(!m_pausedForDebugger);
    m_pausedForDebugger = true;

    // FIXME: Add support for debugging workers running on the main thread.
    if (!is<WorkerDedicatedRunLoop>(m_runLoop.get()))
        return;

    MessageQueueWaitResult result;
    do {
        result = downcast<WorkerDedicatedRunLoop>(m_runLoop.get()).runInDebuggerMode(*m_globalScope);
    } while (result != MessageQueueTerminated && m_pausedForDebugger);
}

void WorkerOrWorkletThread::stopRunningDebuggerTasks()
{
    m_pausedForDebugger = false;
}

void WorkerOrWorkletThread::runEventLoop()
{
    // Does not return until terminated.
    if (is<WorkerDedicatedRunLoop>(m_runLoop.get()))
        downcast<WorkerDedicatedRunLoop>(m_runLoop.get()).run(m_globalScope.get());
}

void WorkerOrWorkletThread::workerOrWorkletThread()
{
    Ref protectedThis { *this };

    if (isMainThread()) {
        m_globalScope = createGlobalScope();
        if (!m_globalScope)
            return;

        downcast<WorkerMainRunLoop>(m_runLoop.get()).setGlobalScope(*m_globalScope);

        String exceptionMessage;
        evaluateScriptIfNecessary(exceptionMessage);

        callOnMainThread([evaluateCallback = WTFMove(m_evaluateCallback), message = WTFMove(exceptionMessage)] {
            if (evaluateCallback)
                evaluateCallback(message);
        });
        return;
    }

    // Propagate the mainThread's fenv to workers.
#if PLATFORM(IOS_FAMILY)
    FloatingPointEnvironment::singleton().propagateMainThreadEnvironment();
#endif

#if USE(GLIB)
    GRefPtr<GMainContext> mainContext = adoptGRef(g_main_context_new());
    g_main_context_push_thread_default(mainContext.get());
#endif

    WorkerOrWorkletScriptController* scriptController;
    {
        // Mutex protection is necessary to ensure that we don't change m_globalScope
        // while WorkerThread::stop() is accessing it. Note that WorkerThread::stop() can
        // be called before we've finished creating the WorkerGlobalScope.
        Locker locker { m_threadCreationAndGlobalScopeLock };
        m_globalScope = createGlobalScope();

        // When running out of memory, createGlobalScope() may return null because we could not allocate a JSC::VM.
        if (!m_globalScope) {
            WTFLogAlways("Error: Failed to create a WorkerOrWorkerGlobalScope.");
            return;
        }

        scriptController = m_globalScope->script();

        if (m_runLoop->terminated()) {
            // The worker was terminated before the thread had a chance to run. Since the context didn't exist yet,
            // forbidExecution() couldn't be called from stop().
            scriptController->scheduleExecutionTermination();
            scriptController->forbidExecution();
        }
    }

    if (shouldWaitForWebInspectorOnStartup()) {
        startRunningDebuggerTasks();

        // If the worker was somehow terminated while processing debugger commands.
        if (m_runLoop->terminated())
            scriptController->forbidExecution();
    }

    String exceptionMessage;
    evaluateScriptIfNecessary(exceptionMessage);

    callOnMainThread([evaluateCallback = WTFMove(m_evaluateCallback), message = exceptionMessage.isolatedCopy()] {
        if (evaluateCallback)
            evaluateCallback(message);
    });

    runEventLoop();

#if USE(GLIB)
    g_main_context_pop_thread_default(mainContext.get());
#endif

    RefPtr<Thread> protector = m_thread;

    ASSERT(m_globalScope->hasOneRef());

    RefPtr<WorkerOrWorkletGlobalScope> workerGlobalScopeToDelete;
    {
        // Mutex protection is necessary to ensure that we don't change m_globalScope
        // while WorkerThread::stop is accessing it.
        Locker locker { m_threadCreationAndGlobalScopeLock };

        // Delay the destruction of the WorkerGlobalScope context until after we've unlocked the
        // m_threadCreationAndWorkerGlobalScopeMutex. This is needed because destructing the
        // context will trigger the main thread to race against us to delete the WorkerThread
        // object, and the WorkerThread object owns the mutex we need to unlock after this.
        workerGlobalScopeToDelete = std::exchange(m_globalScope, nullptr);

        if (m_stoppedCallback)
            callOnMainThread(WTFMove(m_stoppedCallback));
    }

    // The below assignment will destroy the context, which will in turn notify messaging proxy.
    // We cannot let any objects survive past thread exit, because no other thread will run GC or otherwise destroy them.
    workerGlobalScopeToDelete = nullptr;

    // Clean up WebCore::ThreadGlobalData before WTF::Thread goes away!
    threadGlobalData().destroy();

    // Send the last WorkerThread Ref to be Deref'ed on the main thread.
    callOnMainThread([protectedThis = WTFMove(protectedThis)] { });

    // The thread object may be already destroyed from notification now, don't try to access "this".
    protector->detach();
}

void WorkerOrWorkletThread::start(Function<void(const String&)>&& evaluateCallback)
{
    // Mutex protection is necessary to ensure that m_thread is initialized when the thread starts.
    Locker locker { m_threadCreationAndGlobalScopeLock };

    if (m_thread)
        return;

    m_evaluateCallback = WTFMove(evaluateCallback);

    auto thread = createThread();

    // Force the Thread object to be initialized fully before storing it to m_thread (and becoming visible to other threads).
    WTF::storeStoreFence();

    m_thread = WTFMove(thread);
}

void WorkerOrWorkletThread::stop(Function<void()>&& stoppedCallback)
{
    // Mutex protection is necessary to ensure that m_workerGlobalScope isn't changed by
    // WorkerThread::workerThread() while we're accessing it. Note also that stop() can
    // be called before m_workerGlobalScope is fully created.
    if (!m_threadCreationAndGlobalScopeLock.tryLock()) {
        // The thread is still starting, spin the runloop and try again to avoid deadlocks if the worker thread
        // needs to interact with the main thread during startup.
        callOnMainThread([this, stoppedCallback = WTFMove(stoppedCallback)]() mutable {
            stop(WTFMove(stoppedCallback));
        });
        return;
    }
    Locker locker { AdoptLock, m_threadCreationAndGlobalScopeLock };

    // If the thread is suspended, resume it now so that we can dispatch the cleanup tasks below.
    if (m_isSuspended)
        resume();

    ASSERT(!m_stoppedCallback);
    m_stoppedCallback = WTFMove(stoppedCallback);

    // Ensure that tasks are being handled by thread event loop. If script execution weren't forbidden, a while(1) loop in JS could keep the thread alive forever.
    if (globalScope()) {
        globalScope()->script()->scheduleExecutionTermination();

        if (is<WorkerMainRunLoop>(m_runLoop.get())) {
            auto globalScope = std::exchange(m_globalScope, nullptr);
            globalScope->prepareForDestruction();
            globalScope->clearScript();
            m_runLoop->terminate();

            if (m_stoppedCallback)
                callOnMainThread(std::exchange(m_stoppedCallback, nullptr));
            return;
        }

        m_runLoop->postTaskAndTerminate({ ScriptExecutionContext::Task::CleanupTask, [] (ScriptExecutionContext& context ) {
            auto& globalScope = downcast<WorkerOrWorkletGlobalScope>(context);

            globalScope.prepareForDestruction();

            // Stick a shutdown command at the end of the queue, so that we deal
            // with all the cleanup tasks the databases post first.
            globalScope.postTask({ ScriptExecutionContext::Task::CleanupTask, [] (ScriptExecutionContext& context) {
                auto& globalScope = downcast<WorkerOrWorkletGlobalScope>(context);
                // It's not safe to call clearScript until all the cleanup tasks posted by functions initiated by WorkerThreadShutdownStartTask have completed.
                globalScope.clearScript();
            } });

        } });
        return;
    }
    m_runLoop->terminate();
}

void WorkerOrWorkletThread::suspend()
{
    m_isSuspended = true;
    if (is<WorkerMainRunLoop>(m_runLoop.get()))
        return;

    m_runLoop->postTask([&](ScriptExecutionContext&) {
        if (globalScope())
            globalScope()->suspend();

        m_suspensionSemaphore.wait();

        if (globalScope())
            globalScope()->resume();
    });
}

void WorkerOrWorkletThread::resume()
{
    ASSERT(m_isSuspended);
    m_isSuspended = false;
    if (is<WorkerMainRunLoop>(m_runLoop.get()))
        return;

    m_suspensionSemaphore.signal();
}

void WorkerOrWorkletThread::releaseFastMallocFreeMemoryInAllThreads()
{
    Locker locker { workerOrWorkletThreadsLock() };
    for (auto* workerOrWorkletThread : workerOrWorkletThreads()) {
        workerOrWorkletThread->runLoop().postTask([] (ScriptExecutionContext&) {
            WTF::releaseFastMallocFreeMemory();
        });
    }
}

} // namespace WebCore
