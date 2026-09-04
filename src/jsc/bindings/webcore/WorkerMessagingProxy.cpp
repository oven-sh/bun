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

#include "config.h"
#include "WorkerMessagingProxy.h"

#include "BunClientData.h"
#include "GlobalEventScope.h"
#include "CloseEvent.h"
#include "ErrorCode.h"
#include "ErrorEvent.h"
#include "EventNames.h"
#include "MessageEvent.h"
#include "MessagePort.h"
#include "SerializedScriptValue.h"
#include "Worker.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSPromise.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(WorkerMessagingProxy);

// ---- The native thread object (src/jsc/web_worker.rs) --------------------------------------------
extern "C" {

// Allocates the thread object holding one ref for the caller, takes the keep-alive on the parent
// event loop, and spawns the thread. Null (with errorMessage set) if nothing was started.
void* WebWorker__create(
    WorkerMessagingProxy*,
    void* parentVM,
    const BunString* name,
    const BunString* url,
    BunString* errorMessage,
    uint32_t parentContextId,
    uint32_t contextId,
    bool miniMode,
    bool unrefByDefault,
    bool evalMode,
    bool isNodeWorker,
    StringImpl** argvPtr,
    size_t argvLen,
    bool defaultExecArgv,
    StringImpl** execArgvPtr,
    size_t execArgvLen,
    BunString* preloadModulesPtr,
    size_t preloadModulesLen);
// Raise a TerminationException in the worker VM at its next safepoint and wake its loop. Any thread.
void WebWorker__requestTermination(void*);
// Toggle the keep-alive this worker holds on the parent event loop. Parent thread.
void WebWorker__setRef(void*, bool);
// Release that keep-alive. Parent thread.
void WebWorker__releaseParentPollRef(void*);
// Block until the OS thread has exited. Parent thread, after the worker reported destroyed or was
// asked to terminate by an exiting parent.
void WebWorker__join(void*);
// Drop one ref on the thread object; the last one frees it.
void WebWorker__deref(void*);

} // extern "C"

WorkerMessagingProxy::WorkerMessagingProxy(Worker& workerObject, ScriptExecutionContext& parentContext, WorkerOptions&& options)
    : m_scriptExecutionContext(&parentContext)
    , m_workerObject(&workerObject)
    , m_loaderContextIdentifier(parentContext.identifier())
    , m_loaderLoopKind(parentContext.currentLoopKind())
    , m_workerContextIdentifier(ScriptExecutionContext::generateIdentifier())
    , m_options(WTF::move(options))
{
    ASSERT(parentContext.isContextThread());
}

Ref<WorkerMessagingProxy> WorkerMessagingProxy::create(Worker& workerObject, ScriptExecutionContext& parentContext, WorkerOptions&& options)
{
    return adoptRef(*new WorkerMessagingProxy(workerObject, parentContext, WTF::move(options)));
}

WorkerMessagingProxy::~WorkerMessagingProxy()
{
    ASSERT(!m_workerObject);
    ASSERT(!m_workerThread);
    ASSERT(!m_scriptExecutionContext || m_scriptExecutionContext->isContextThread());
}

// ---- WorkerGlobalScopeProxy (parent thread) ------------------------------------------------------

ExceptionOr<void> WorkerMessagingProxy::startWorkerGlobalScope(const String& scriptURL)
{
    ASSERT(m_scriptExecutionContext && m_scriptExecutionContext->isContextThread());
    ASSERT(!m_workerThread);

    // Constructed on a context whose active objects were already stopped: the Worker was stopped
    // at birth (suspendIfNeeded -> stop -> terminate) and there is nothing to start.
    if (m_askedToTerminate) {
        m_state.store(State::Closed);
        m_scriptExecutionContext = nullptr;
        return {};
    }

    Vector<BunString> preloadModules;
    preloadModules.reserveInitialCapacity(m_options.preloadModules.size());
    for (auto& str : m_options.preloadModules) {
        if (str.startsWith("file://"_s)) {
            WTF::URL urlObject = WTF::URL(str);
            if (!urlObject.isValid())
                return Exception { TypeError, makeString("Invalid file URL: \""_s, str, '"') };
            str = urlObject.fileSystemPath();
        }
        preloadModules.append(Bun::toString(str));
    }

    static_assert(sizeof(WTF::String) == sizeof(WTF::StringImpl*));
    std::span<WTF::StringImpl*> execArgv = m_options.execArgv
                                               .transform([](Vector<String>& vec) -> std::span<WTF::StringImpl*> {
                                                   return { reinterpret_cast<WTF::StringImpl**>(vec.begin()), vec.size() };
                                               })
                                               .value_or(std::span<WTF::StringImpl*> {});

    // The thread holds a ref on the proxy until releaseWorkerThread().
    ref();
    BunString errorMessage = BunStringEmpty;
    BunString name = Bun::toString(m_options.name);
    BunString url = Bun::toString(scriptURL);
    m_workerThread = WebWorker__create(
        this,
        WebCore::clientData(m_scriptExecutionContext->vm())->bunVM,
        &name,
        &url,
        &errorMessage,
        m_loaderContextIdentifier,
        m_workerContextIdentifier,
        m_options.mini,
        m_options.unref,
        m_options.evalMode,
        m_options.kind == WorkerOptions::Kind::Node,
        reinterpret_cast<WTF::StringImpl**>(m_options.argv.begin()),
        m_options.argv.size(),
        !m_options.execArgv.has_value(),
        execArgv.data(),
        execArgv.size(),
        preloadModules.begin(),
        preloadModules.size());
    m_options.preloadModules.clear();

    if (!m_workerThread) {
        m_state.store(State::Closed);
        deref();
        return Exception { TypeError, errorMessage.transferToWTFString() };
    }
    return {};
}

void WorkerMessagingProxy::terminateWorkerGlobalScope()
{
    if (m_askedToTerminate)
        return;
    m_askedToTerminate = true;
    if (m_workerThread)
        WebWorker__requestTermination(m_workerThread);
}

void WorkerMessagingProxy::setKeepAlive(bool keepAlive)
{
    if (m_askedToTerminate || m_keepAliveReleased || !m_workerThread)
        return;
    WebWorker__setRef(m_workerThread, keepAlive);
}

void WorkerMessagingProxy::workerObjectDestroyed()
{
    ASSERT(!m_scriptExecutionContext || m_scriptExecutionContext->isContextThread());
    m_workerObject = nullptr;
    terminateWorkerGlobalScope();
}

void WorkerMessagingProxy::postMessageToWorkerGlobalScope(MessageWithMessagePorts&& message)
{
    {
        Locker locker { m_toWorker.lock };
        // A terminated (or terminating) worker drains nothing more: drop, as a closed port does.
        auto state = m_state.load();
        if (state == State::Closing || state == State::Closed)
            return;
        m_toWorker.queue.append(WTF::move(message));
        // Before Running the inbox is only buffered; workerGlobalScopeStarted() schedules the first
        // drain on the worker thread. One drain task in flight at a time.
        if (m_state.load() != State::Running || m_toWorker.drainScheduled)
            return;
        m_toWorker.drainScheduled = true;
    }
    bool posted = ScriptExecutionContext::postTaskTo(m_workerContextIdentifier, BunLoopKind::Regular, [protectedThis = Ref { *this }](ScriptExecutionContext& context) {
        protectedThis->drainMessagesToWorkerGlobalScope(context);
    });
    if (!posted) {
        Locker locker { m_toWorker.lock };
        m_toWorker.drainScheduled = false;
    }
}

bool WorkerMessagingProxy::postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&& task)
{
    {
        Locker lock { m_pendingTasksLock };
        switch (m_state.load()) {
        case State::Pending:
            m_pendingTasks.append(WTF::move(task));
            return true;
        case State::Running:
            break;
        case State::Closing:
        case State::Closed:
            return false;
        }
    }
    return ScriptExecutionContext::postTaskTo(m_workerContextIdentifier, BunLoopKind::Regular, WTF::move(task));
}

uint64_t WorkerMessagingProxy::registerCrossVMRequest(JSC::VM& vm, JSC::JSPromise* promise)
{
    uint64_t id = m_nextRequestId.fetch_add(1);
    Locker lock { m_pendingTasksLock };
    m_pendingCrossVMRequests.add(id, JSC::Strong<JSC::JSPromise>(vm, promise));
    return id;
}

JSC::Strong<JSC::JSPromise> WorkerMessagingProxy::takeCrossVMRequest(uint64_t id)
{
    Locker lock { m_pendingTasksLock };
    return m_pendingCrossVMRequests.take(id);
}

void WorkerMessagingProxy::rejectAllCrossVMRequests()
{
    HashMap<uint64_t, JSC::Strong<JSC::JSPromise>> pending;
    {
        Locker lock { m_pendingTasksLock };
        pending = std::exchange(m_pendingCrossVMRequests, {});
    }
    // A parent whose own VM is being stopped settles nothing more (and could not build the error:
    // its termination is pending); the Strong handles just drop.
    if (pending.isEmpty() || !m_scriptExecutionContext || m_scriptExecutionContext->isJSExecutionForbidden())
        return;
    auto* globalObject = defaultGlobalObject(m_scriptExecutionContext->globalObject());
    auto& vm = JSC::getVM(globalObject);
    for (auto& entry : pending) {
        // Empty only if a (recoverable, e.g. test-timeout) termination is pending on this VM.
        auto* error = Bun::createError(globalObject, Bun::ErrorCode::ERR_WORKER_NOT_RUNNING, "Worker instance not running"_s);
        if (!error)
            return;
        entry.value->reject(vm, error);
    }
}

// ---- Inbox drain (both directions) ---------------------------------------------------------------
//
// Mirrors MessagePortPipe::drainAndDispatch and Node's MessagePort::OnMessage: one task drains a
// bounded batch of messages, running microtasks after each so queueMicrotask/Promise callbacks
// observe them one at a time, then yields to the loop and reports whether more remain. The budget is
// a fixed count rather than "everything that was queued when the drain began": with a producer on
// another thread that snapshot can be arbitrarily large, and the receiving loop's timers and I/O
// wait behind it. `UntilEmpty` is for the sender having exited: the queue is finite and everything
// in it precedes 'close'. Worker inboxes never change owner, so up to a budget's worth is moved out
// under one lock acquisition and dispatched uncontended; the queue itself is only swapped out whole
// when it fits the budget, so a continuation never has to hand a tail back.
enum class DrainBudget { Bounded,
    UntilEmpty };
static constexpr size_t drainBatchLimit = 1024;

template<typename Dispatch>
static bool drainInbox(WorkerMessagingProxy::MessageInbox& inbox, Zig::GlobalObject& globalObject, ScriptExecutionContext& context, DrainBudget budget, Dispatch&& dispatch)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    size_t remaining = budget == DrainBudget::UntilEmpty ? std::numeric_limits<size_t>::max() : drainBatchLimit;

    while (true) {
        Deque<MessageWithMessagePorts> batch;
        {
            Locker locker { inbox.lock };
            if (inbox.queue.isEmpty()) {
                inbox.drainScheduled = false;
                return false;
            }
            if (!remaining)
                return true; // budget spent, messages left
            if (inbox.queue.size() <= remaining)
                batch = std::exchange(inbox.queue, {});
            else {
                for (size_t i = 0; i < remaining; ++i)
                    batch.append(inbox.queue.takeFirst());
            }
        }
        if (budget == DrainBudget::Bounded)
            remaining -= batch.size();

        while (!batch.isEmpty()) {
            // The receiving VM is being stopped: nothing more is delivered (the
            // rest is dropped with the proxy).
            if (context.isJSExecutionForbidden())
                return false;
            auto message = batch.takeFirst();
            auto ports = MessagePort::entanglePorts(context, WTF::move(message.transferredPorts));
            // message port post message steps (7.3): if deserializing throws, catch it and fire messageerror.
            auto event = MessageEvent::create(globalObject, message.message.releaseNonNull(), nullptr, WTF::move(ports));
            if (scope.exception()) [[unlikely]] {
                if (vm.hasPendingTerminationException())
                    return false;
                scope.clearException();
                dispatch(MessageEvent::create(eventNames().messageerrorEvent, MessageEvent::Init { {}, jsNull() }, MessageEvent::IsTrusted::Yes));
            } else
                dispatch(event->event);
            bool terminating = globalObject.drainMicrotasks();
            RETURN_IF_EXCEPTION(scope, false);
            if (terminating)
                return false; // termination pending
        }
    }
}

void WorkerMessagingProxy::drainMessagesToWorkerGlobalScope(ScriptExecutionContext& context)
{
    auto& globalObject = *defaultGlobalObject(context.globalObject());
    bool more = drainInbox(m_toWorker, globalObject, context, DrainBudget::Bounded, [&](Event& event) {
        globalObject.globalEventScope->dispatchEvent(event);
    });
    if (more) {
        // Budget spent with messages left: continue after the loop has polled,
        // or a producer faster than this drain starves timers and I/O for good.
        context.postTaskAfterYield([protectedThis = Ref { *this }](ScriptExecutionContext& context) {
            protectedThis->drainMessagesToWorkerGlobalScope(context);
        });
    }
}

void WorkerMessagingProxy::drainMessagesToWorkerObject(ScriptExecutionContext& context, DrainBudget budget)
{
    if (!m_workerObject) {
        Locker locker { m_toParent.lock };
        m_toParent.queue.clear();
        m_toParent.drainScheduled = false;
        return;
    }
    Ref workerObject = *m_workerObject;
    auto& globalObject = *defaultGlobalObject(context.globalObject());
    bool more = drainInbox(m_toParent, globalObject, context, budget, [&](Event& event) {
        workerObject->dispatchEvent(event);
    });
    if (more) {
        context.postTaskAfterYield([protectedThis = Ref { *this }](ScriptExecutionContext& context) {
            protectedThis->drainMessagesToWorkerObject(context, DrainBudget::Bounded);
        });
    }
}

// ---- WorkerObjectProxy / WorkerReportingProxy (worker thread) -----------------------------------

void WorkerMessagingProxy::workerThreadStarted()
{
    // Posted before the entry point loads, so it reaches the parent ahead of anything the entry's
    // top-level code posts (node's bootstrap sends UP_AND_RUNNING before it evaluates the entry).
    // The state stays Pending: a task or message a parent-side 'online' handler posts is queued and
    // delivered by workerGlobalScopeStarted() once the entry has evaluated.
    ScriptExecutionContext::postTaskTo(m_loaderContextIdentifier, m_loaderLoopKind, [protectedThis = Ref { *this }](ScriptExecutionContext&) {
        RefPtr workerObject = protectedThis->m_workerObject;
        if (!workerObject || !workerObject->hasEventListeners(eventNames().openEvent))
            return;
        workerObject->dispatchEvent(Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No));
    });
}

void WorkerMessagingProxy::workerGlobalScopeStarted(Zig::GlobalObject& workerGlobalObject)
{
    auto& context = *workerGlobalObject.scriptExecutionContext();
    ASSERT(context.identifier() == m_workerContextIdentifier);

    // Pending -> Running under the lock postTaskToWorkerGlobalScope() takes, so a task is either
    // queued here (and run below) or posted directly, never lost.
    Deque<Function<void(ScriptExecutionContext&)>> pendingTasks;
    {
        Locker lock { m_pendingTasksLock };
        m_state.store(State::Running);
        pendingTasks = std::exchange(m_pendingTasks, {});
    }

    // Tasks and messages that arrived while Pending. If the entry module installed a 'message'
    // listener they run now; otherwise on the next tick, so a listener added right after startup
    // (the common `parentPort.on('message')` in an async callback) still sees them.
    auto deliver = [protectedThis = Ref { *this }, pendingTasks = WTF::move(pendingTasks)](ScriptExecutionContext& context) mutable {
        for (auto& task : pendingTasks)
            task(context);
        {
            Locker locker { protectedThis->m_toWorker.lock };
            if (protectedThis->m_toWorker.queue.isEmpty() || protectedThis->m_toWorker.drainScheduled)
                return;
            protectedThis->m_toWorker.drainScheduled = true;
        }
        protectedThis->drainMessagesToWorkerGlobalScope(context);
    };
    if (workerGlobalObject.globalEventScope->hasActiveEventListeners(eventNames().messageEvent))
        deliver(context);
    else
        context.postTask(WTF::move(deliver));
}

void WorkerMessagingProxy::postMessageToWorkerObject(MessageWithMessagePorts&& message)
{
    {
        Locker locker { m_toParent.lock };
        m_toParent.queue.append(WTF::move(message));
        if (m_toParent.drainScheduled)
            return;
        m_toParent.drainScheduled = true;
    }
    bool posted = ScriptExecutionContext::postTaskTo(m_loaderContextIdentifier, m_loaderLoopKind, [protectedThis = Ref { *this }](ScriptExecutionContext& context) {
        protectedThis->drainMessagesToWorkerObject(context, DrainBudget::Bounded);
    });
    if (!posted) {
        Locker locker { m_toParent.lock };
        m_toParent.drainScheduled = false;
    }
}

void WorkerMessagingProxy::postMessageErrorToWorkerObject(String&& message)
{
    ScriptExecutionContext::postTaskTo(m_loaderContextIdentifier, m_loaderLoopKind, [protectedThis = Ref { *this }, message = WTF::move(message).isolatedCopy()](ScriptExecutionContext&) {
        RefPtr workerObject = protectedThis->m_workerObject;
        if (!workerObject)
            return;
        ErrorEvent::Init init;
        init.message = message;
        workerObject->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
    });
}

bool WorkerMessagingProxy::postSerializedErrorToWorkerObject(Zig::GlobalObject& workerGlobalObject, JSC::JSValue value)
{
    // Top of the worker's error-dispatch stack: neither the structured clone (which can run script
    // through getters even in NonThrowing mode) nor the `code` read may leave an exception behind.
    auto& vm = JSC::getVM(&workerGlobalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto serialized = SerializedScriptValue::create(workerGlobalObject, value, SerializationForStorage::No, SerializationErrorMode::NonThrowing);
    CLEAR_IF_EXCEPTION(scope);
    if (!serialized)
        return false;

    // Structured clone keeps only the standard Error fields; Node's worker 'error' event also
    // preserves a string `error.code` (lib/internal/error_serdes.js).
    String errorCode;
    if (value.isObject()) {
        JSC::JSValue codeValue = value.getObject()->getIfPropertyExists(&workerGlobalObject, WebCore::builtinNames(vm).codePublicName());
        if (!scope.exception() && codeValue && codeValue.isString())
            errorCode = codeValue.toWTFString(&workerGlobalObject);
        CLEAR_IF_EXCEPTION(scope);
    }

    return ScriptExecutionContext::postTaskTo(m_loaderContextIdentifier, m_loaderLoopKind, [protectedThis = Ref { *this }, serialized = serialized.releaseNonNull(), errorCode = WTF::move(errorCode).isolatedCopy()](ScriptExecutionContext& context) {
        RefPtr workerObject = protectedThis->m_workerObject;
        if (!workerObject)
            return;
        auto* globalObject = context.globalObject();
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSC::JSValue deserialized = serialized->deserialize(*globalObject, globalObject, SerializationErrorMode::NonThrowing);
        CLEAR_AND_RETURN_IF_EXCEPTION(scope, );
        if (!errorCode.isNull()) {
            if (auto* errorObject = deserialized.getObject())
                errorObject->putDirect(vm, WebCore::builtinNames(vm).codePublicName(), JSC::jsString(vm, errorCode));
        }
        ErrorEvent::Init init;
        init.error = deserialized;
        workerObject->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
    });
}

void WorkerMessagingProxy::postErrorToWorkerObject(Zig::GlobalObject& workerGlobalObject, const String& message, JSC::JSValue error)
{
    switch (m_options.kind) {
    case WorkerOptions::Kind::Web:
        postMessageErrorToWorkerObject(String { message });
        return;
    case WorkerOptions::Kind::Node:
        if (!postSerializedErrorToWorkerObject(workerGlobalObject, error))
            postMessageErrorToWorkerObject(String { message });
        return;
    }
}

void WorkerMessagingProxy::workerGlobalScopeDestroyed(int32_t exitCode, bool stoppedByParent)
{
    // Last thing the worker thread does with this object. If the parent context is gone the task is
    // dropped and the proxy (with the thread's ref on it) leaks; the parent's own exit path
    // (parentContextWillDestroy) is what normally prevents that.
    ScriptExecutionContext::postTaskTo(m_loaderContextIdentifier, m_loaderLoopKind, [protectedThis = Ref { *this }, exitCode, stoppedByParent](ScriptExecutionContext&) {
        protectedThis->workerGlobalScopeDestroyedInternal(exitCode, stoppedByParent);
    });
}

// ---- Back on the parent thread -------------------------------------------------------------------

void WorkerMessagingProxy::releaseWorkerThread()
{
    ASSERT(!m_scriptExecutionContext || m_scriptExecutionContext->isContextThread());
    void* workerThread = std::exchange(m_workerThread, nullptr);
    if (!workerThread)
        return;
    if (!std::exchange(m_keepAliveReleased, true))
        WebWorker__releaseParentPollRef(workerThread);
    WebWorker__join(workerThread);
    WebWorker__deref(workerThread);
    m_state.store(State::Closed);
    // The ref startWorkerGlobalScope() took on behalf of the thread.
    deref();
}

void WorkerMessagingProxy::workerGlobalScopeDestroyedInternal(int32_t exitCode, bool stoppedByParent)
{
    ASSERT(m_scriptExecutionContext && m_scriptExecutionContext->isContextThread());
    Ref protectedThis { *this };

    // node:worker_threads: a worker stopped by its parent once it was running reports 1 unless it
    // called process.exit() itself (a process.exitCode it merely set is not used, as in Node). The
    // Web Worker's 'close' event keeps 0 for that case (documented).
    if (m_options.kind == WorkerOptions::Kind::Node && stoppedByParent)
        exitCode = 1;

    // Closing while 'close' dispatches so handlers observe threadId == -1 / !isOnline() but a
    // postMessage() from inside them is still accepted and dropped (browser/Node behaviour).
    {
        Locker lock { m_pendingTasksLock };
        m_state.store(State::Closing);
        m_pendingTasks.clear();
    }
    rejectAllCrossVMRequests();

    // Everything the worker posted before it exited is delivered before 'close' (Node: before
    // 'exit'); the thread is gone, so the queue is finite. A bounded drain still queued behind this
    // task then finds it empty.
    drainMessagesToWorkerObject(*m_scriptExecutionContext, DrainBudget::UntilEmpty);

    if (RefPtr workerObject = m_workerObject; workerObject && workerObject->hasEventListeners(eventNames().closeEvent)) {
        auto event = CloseEvent::create(exitCode == 0, static_cast<unsigned short>(exitCode), exitCode == 0 ? "Worker terminated normally"_s : "Worker exited abnormally"_s);
        workerObject->dispatchCloseEvent(event);
    }

    releaseWorkerThread();
    m_scriptExecutionContext = nullptr;
}

void WorkerMessagingProxy::parentContextWillDestroy()
{
    ASSERT(m_scriptExecutionContext && m_scriptExecutionContext->isContextThread());
    // Usually already asked by the parent's stop phase (Worker::stop); a Worker whose object lives
    // on another context of this thread (e.g. a ShadowRealm global) is only asked here.
    terminateWorkerGlobalScope();
    if (!m_workerThread) {
        m_scriptExecutionContext = nullptr;
        return;
    }
    Ref protectedThis { *this };
    {
        Locker lock { m_pendingTasksLock };
        m_state.store(State::Closing);
        m_pendingTasks.clear();
        m_pendingCrossVMRequests.clear();
    }
    releaseWorkerThread();
    m_scriptExecutionContext = nullptr;
}

} // namespace WebCore
