/*
 * Copyright (C) 2008-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Google Inc. All Rights Reserved.
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

#include "MessageWithMessagePorts.h"
#include "ScriptExecutionContext.h"
#include "WorkerOptions.h"
#include <JavaScriptCore/Strong.h>
#include <wtf/Deque.h>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/ThreadSafeRefCounted.h>

namespace JSC {
class JSGlobalObject;
class JSPromise;
class JSValue;
class VM;
}

namespace Zig {
class GlobalObject;
}

namespace WebCore {

class Event;
class Worker;

// The only object shared between a Worker (parent thread, script-visible) and the thread that runs
// its global scope. Created with the Worker; outlives both the Worker object and the thread.
//
// Refs: the Worker object's Ref member, the worker thread (taken before it is spawned, dropped on the
// parent thread by workerGlobalScopeDestroyedInternal() or by the parent's own exit path once it has
// joined the thread), and transient Refs captured by posted tasks. The last deref is therefore always
// on the parent thread. If the parent context is already gone when the thread finishes, nothing runs
// workerGlobalScopeDestroyedInternal() and the proxy is deliberately leaked (as upstream does).
//
// Everything a task posted from the worker thread wants to do to the Worker object goes through
// m_workerObject on the parent thread, which workerObjectDestroyed() nulls first.
enum class DrainBudget;

class WorkerMessagingProxy final : public ThreadSafeRefCounted<WorkerMessagingProxy> {
    WTF_MAKE_TZONE_ALLOCATED(WorkerMessagingProxy);

public:
    enum class State : uint8_t {
        Pending, // created; worker thread starting up
        Running, // workerGlobalScopeStarted() has run on the worker thread
        Closing, // workerGlobalScopeDestroyedInternal() is dispatching 'close' on the parent
        Closed, // the thread is joined and released; nothing further will happen
    };

    static Ref<WorkerMessagingProxy> create(Worker&, ScriptExecutionContext& parentContext, WorkerOptions&&);
    ~WorkerMessagingProxy();

    // -- WorkerGlobalScopeProxy (parent thread) --------------------------------------------------
    ExceptionOr<void> startWorkerGlobalScope(const String& scriptURL);
    void terminateWorkerGlobalScope();
    void postMessageToWorkerGlobalScope(MessageWithMessagePorts&&);
    // Queued while Pending, posted while Running, refused (false) once Closing.
    bool postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&&);
    void setKeepAlive(bool);
    void workerObjectDestroyed();
    // The parent context is exiting: the thread has been asked to stop; wait for it and release what
    // workerGlobalScopeDestroyedInternal() would have released. Parent thread.
    void parentContextWillDestroy();

    bool hasPendingActivity() const { return m_state.load() != State::Closed; }
    bool isOnline() const { return m_state.load() == State::Running; }
    bool isClosingOrClosed() const { return m_state.load() >= State::Closing; }

    uint64_t registerCrossVMRequest(JSC::VM&, JSC::JSPromise*);
    JSC::Strong<JSC::JSPromise> takeCrossVMRequest(uint64_t id);

    // -- WorkerObjectProxy / WorkerReportingProxy (worker thread) ---------------------------------
    void workerGlobalScopeStarted(Zig::GlobalObject&);
    void postMessageToWorkerObject(MessageWithMessagePorts&&);
    void postErrorToWorkerObject(Zig::GlobalObject&, const String& message, JSC::JSValue error);
    // The thread's global scope, VM and per-thread state are gone; only the OS thread remains.
    // stoppedByParent: it stopped because it was asked to and never called process.exit() itself.
    void workerGlobalScopeDestroyed(int32_t exitCode, bool stoppedByParent);
    void drainMessagesToWorkerGlobalScope(ScriptExecutionContext&);

    // -- Either thread ---------------------------------------------------------------------------
    WorkerOptions& options() { return m_options; }
    ScriptExecutionContextIdentifier workerContextIdentifier() const { return m_workerContextIdentifier; }

    struct MessageInbox {
        Lock lock;
        Deque<MessageWithMessagePorts> queue WTF_GUARDED_BY_LOCK(lock);
        bool drainScheduled WTF_GUARDED_BY_LOCK(lock) { false };
    };

private:
    WorkerMessagingProxy(Worker&, ScriptExecutionContext& parentContext, WorkerOptions&&);

    void workerGlobalScopeDestroyedInternal(int32_t exitCode, bool stoppedByParent);
    void releaseWorkerThread();
    void drainMessagesToWorkerObject(ScriptExecutionContext&, DrainBudget);
    void rejectAllCrossVMRequests();
    void postMessageErrorToWorkerObject(String&& message);
    bool postSerializedErrorToWorkerObject(Zig::GlobalObject&, JSC::JSValue error);

    // Parent thread only.
    RefPtr<ScriptExecutionContext> m_scriptExecutionContext;
    Worker* m_workerObject;
    bool m_askedToTerminate { false };
    bool m_keepAliveReleased { false };

    const ScriptExecutionContextIdentifier m_loaderContextIdentifier;
    // The parent loop that was current at `new Worker()`: a macro that creates a worker and awaits
    // it is the one that hears from it.
    const BunLoopKind m_loaderLoopKind;
    const ScriptExecutionContextIdentifier m_workerContextIdentifier;
    WorkerOptions m_options;

    // The native thread object (src/jsc/web_worker.rs). Holds one ref on it from
    // startWorkerGlobalScope() until releaseWorkerThread().
    void* m_workerThread { nullptr };

    std::atomic<State> m_state { State::Pending };

    // Pending -> Running happens under this lock so a task posted while Pending is either queued here
    // (and run by workerGlobalScopeStarted) or posted directly, never lost.
    Lock m_pendingTasksLock;
    Deque<Function<void(ScriptExecutionContext&)>> m_pendingTasks WTF_GUARDED_BY_LOCK(m_pendingTasksLock);
    HashMap<uint64_t, JSC::Strong<JSC::JSPromise>> m_pendingCrossVMRequests WTF_GUARDED_BY_LOCK(m_pendingTasksLock);
    std::atomic<uint64_t> m_nextRequestId { 1 };

    MessageInbox m_toWorker;
    MessageInbox m_toParent;
};

} // namespace WebCore
