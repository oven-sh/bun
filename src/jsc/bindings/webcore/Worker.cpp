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
#include "Worker.h"

#include "ErrorCode.h"
#include "ErrorEvent.h"
#include "Event.h"
#include "EventNames.h"
#include "StructuredSerializeOptions.h"
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/ScriptCallStack.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/Scope.h>
#include "SerializedScriptValue.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include "MessageEvent.h"
#include "BunWorkerGlobalScope.h"
#include "CloseEvent.h"
#include "JSMessagePort.h"
#include "JSBroadcastChannel.h"

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Worker);

// ---- Zig FFI -----------------------------------------------------------------------------------
// The Zig WebWorker struct is owned by this Worker (freed in ~Worker) and drives the worker
// thread. See src/jsc/web_worker.zig for the matching side of each entry point.
extern "C" {

// Allocate the Zig WebWorker, take a keep-alive on the parent event loop, and spawn the worker
// thread. Returns null (and sets errorMessage) on any failure; nothing needs cleanup in that case.
void* WebWorker__create(
    Worker* worker,
    void* parent,
    BunString name,
    BunString url,
    BunString* errorMessage,
    uint32_t parentContextId,
    uint32_t contextId,
    bool miniMode,
    bool unrefByDefault,
    bool evalMode,
    StringImpl** argvPtr,
    size_t argvLen,
    bool defaultExecArgv,
    StringImpl** execArgvPtr,
    size_t execArgvLen,
    BunString* preloadModulesPtr,
    size_t preloadModulesLen);

// worker.terminate() — set requested_terminate, raise TerminationException in the worker VM,
// wake the worker loop. Parent thread only.
void WebWorker__notifyNeedTermination(void* worker);

// worker.ref()/.unref() — toggle the keep-alive on the parent event loop. Parent thread only.
void WebWorker__setRef(void* worker, bool ref);

// Release the keep-alive on the parent event loop. Called from the close task on the parent
// thread.
void WebWorker__releaseParentPollRef(void* worker);

// Free the Zig WebWorker struct. Called from ~Worker.
void WebWorker__destroy(void* worker);

} // extern "C"
// -------------------------------------------------------------------------------------------------

Worker::Worker(ScriptExecutionContext& context, WorkerOptions&& options)
    : EventTargetWithInlineData()
    , ContextDestructionObserver(&context)
    , m_options(WTF::move(options))
    , m_parentContextId(context.identifier())
    , m_clientIdentifier(ScriptExecutionContext::generateIdentifier())
{
}

ExceptionOr<Ref<Worker>> Worker::create(ScriptExecutionContext& context, const String& urlInit, WorkerOptions&& options)
{
    auto worker = adoptRef(*new Worker(context, WTF::move(options)));

    WTF::String url = urlInit;
    if (url.startsWith("file://"_s)) {
        WTF::URL urlObject = WTF::URL(url);
        if (urlObject.isValid()) {
// On Windows, WTF::URL::fileSystemPath handles UNC paths
// (`file://server/share/etc` -> `\\server\share\etc`), so the host check
// only runs on posix systems. This matches `Bun.fileURLToPath`.
#if !OS(WINDOWS)
            if (urlObject.host().length() > 0 && urlObject.host() != "localhost"_s) [[unlikely]] {
#if OS(DARWIN)
                return Exception { TypeError, "File URL host must be \"localhost\" or empty on darwin"_s };
#else
                return Exception { TypeError, "File URL host must be \"localhost\" or empty on linux"_s };
#endif
            }
#endif
            url = urlObject.fileSystemPath();
        } else {
            return Exception { TypeError, makeString("Invalid file URL: \""_s, urlInit, '"') };
        }
    }
    BunString urlStr = Bun::toString(url);
    BunString errorMessage = BunStringEmpty;
    BunString nameStr = Bun::toString(worker->m_options.name);

    auto& preloadModuleStrings = worker->m_options.preloadModules;
    Vector<BunString> preloadModules;
    preloadModules.reserveInitialCapacity(preloadModuleStrings.size());
    for (auto& str : preloadModuleStrings) {
        if (str.startsWith("file://"_s)) {
            WTF::URL urlObject = WTF::URL(str);
            if (!urlObject.isValid()) {
                return Exception { TypeError, makeString("Invalid file URL: \""_s, str, '"') };
            }
#if !OS(WINDOWS)
            if (urlObject.host().length() > 0 && urlObject.host() != "localhost"_s) [[unlikely]] {
#if OS(DARWIN)
                return Exception { TypeError, "File URL host must be \"localhost\" or empty on darwin"_s };
#else
                return Exception { TypeError, "File URL host must be \"localhost\" or empty on linux"_s };
#endif
            }
#endif
            // Replace in-place so the storage outlives the BunString borrow below.
            str = urlObject.fileSystemPath();
        }
        preloadModules.append(Bun::toString(str));
    }

    // try to ensure the cast from String* to StringImpl** is sane
    static_assert(sizeof(WTF::String) == sizeof(WTF::StringImpl*));
    std::span<WTF::StringImpl*> execArgv = worker->m_options.execArgv
                                               .transform([](Vector<String>& vec) -> std::span<WTF::StringImpl*> {
                                                   return { reinterpret_cast<WTF::StringImpl**>(vec.begin()), vec.size() };
                                               })
                                               .value_or(std::span<WTF::StringImpl*> {});

    // Take the worker-thread-held ref BEFORE spawning. The spawned thread will
    // eventually call dispatchExit(), whose posted task (running back on THIS
    // thread) drops this ref. If creation fails below we drop it ourselves.
    worker->ref();

    void* impl = WebWorker__create(
        worker.ptr(),
        bunVM(context.jsGlobalObject()),
        nameStr,
        urlStr,
        &errorMessage,
        static_cast<uint32_t>(worker->m_parentContextId),
        static_cast<uint32_t>(worker->m_clientIdentifier),
        worker->m_options.mini,
        worker->m_options.unref,
        worker->m_options.evalMode,
        reinterpret_cast<WTF::StringImpl**>(worker->m_options.argv.begin()),
        worker->m_options.argv.size(),
        !worker->m_options.execArgv.has_value(),
        execArgv.data(),
        execArgv.size(),
        preloadModules.begin(),
        preloadModules.size());

    preloadModuleStrings.clear();

    if (!impl) {
        worker->m_state.store(State::Closed);
        worker->deref(); // undo the thread-held ref above
        return Exception { TypeError, errorMessage.toWTFString(BunString::ZeroCopy) };
    }

    // Parent-thread-only field; the close task can't run until we return to
    // the event loop, so it's safe to set after the thread has been spawned.
    worker->impl_ = impl;

    return worker;
}

Worker::~Worker()
{
    if (impl_) {
        WebWorker__destroy(impl_);
    }
}

bool Worker::postTaskToParent(Function<void(ScriptExecutionContext&)>&& task)
{
    // By stable identifier, not pointer — postTaskTo locks the global map and
    // returns false if the parent context is gone. Safe from any thread.
    return ScriptExecutionContext::postTaskTo(m_parentContextId, WTF::move(task));
}

// ---- Parent-thread API ------------------------------------------------------

ExceptionOr<void> Worker::postMessage(JSC::JSGlobalObject& state, JSC::JSValue messageValue, StructuredSerializeOptions&& options)
{
    if (m_state.load() == State::Closed)
        return Exception { InvalidStateError, "Worker has been terminated"_s };

    Vector<RefPtr<MessagePort>> ports;
    auto serialized = SerializedScriptValue::create(state, messageValue, WTF::move(options.transfer), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException())
        return serialized.releaseException();

    ExceptionOr<Vector<TransferredMessagePort>> disentangledPorts = MessagePort::disentanglePorts(WTF::move(ports));
    if (disentangledPorts.hasException()) {
        return disentangledPorts.releaseException();
    }

    enqueueToWorker(MessageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() });
    return {};
}

void Worker::enqueueToWorker(MessageWithMessagePorts&& message)
{
    {
        Locker locker { m_toWorker.lock };
        m_toWorker.queue.append(WTF::move(message));
        // If the worker isn't Running yet, just buffer; fireEarlyMessages()
        // drains the inbox on the worker thread once it is. If Closing/
        // Closed, also buffer (dropped with the Worker) — postMessage()
        // already rejects on Closed, so only the close-handler window lands
        // here. If a drain is already scheduled, don't double-schedule.
        // drainScheduled is only set/cleared under the lock so the
        // load/store pair is not a race.
        if (m_state.load() != State::Running || m_toWorker.drainScheduled.load(std::memory_order_relaxed))
            return;
        m_toWorker.drainScheduled.store(true, std::memory_order_relaxed);
    }
    bool posted = ScriptExecutionContext::postTaskTo(m_clientIdentifier, [protectedThis = Ref { *this }](ScriptExecutionContext& context) {
        protectedThis->drainToWorker(context);
    });
    if (!posted) {
        Locker locker { m_toWorker.lock };
        m_toWorker.drainScheduled.store(false, std::memory_order_relaxed);
    }
}

void Worker::enqueueToParent(MessageWithMessagePorts&& message)
{
    {
        Locker locker { m_toParent.lock };
        m_toParent.queue.append(WTF::move(message));
        if (m_toParent.drainScheduled.load(std::memory_order_relaxed))
            return;
        m_toParent.drainScheduled.store(true, std::memory_order_relaxed);
    }
    // By stable identifier — this runs on the worker thread, so don't touch
    // the parent's ScriptExecutionContext pointer directly.
    bool posted = postTaskToParent([protectedThis = Ref { *this }](ScriptExecutionContext& context) {
        protectedThis->drainToParent(context);
    });
    if (!posted) {
        Locker locker { m_toParent.lock };
        m_toParent.drainScheduled.store(false, std::memory_order_relaxed);
    }
}

// Shared drain loop for the two inboxes. Mirrors MessagePortPipe's
// drainAndDispatch (and Node's MessagePort::OnMessage): one task drains up to
// max(initial queue size, 1000) messages, running microtasks between each so
// queueMicrotask/Promise callbacks observe messages one at a time, then
// yields and reschedules if more remain.
//
// Unlike MessagePortPipe, Worker sides never transfer, so we don't need to
// re-check port identity each iteration — which lets us swap the whole inbox
// into a local deque under the lock and dispatch without contending with the
// sender. A sustained producer (e.g. a tight postMessage loop) would otherwise
// make every per-message pop a contended acquire.
template<typename Dispatch>
static inline bool drainInbox(Worker::MessageInbox& inbox, Zig::GlobalObject* globalObject, ScriptExecutionContext& context, Dispatch&& dispatch)
{
    size_t limit;
    Deque<MessageWithMessagePorts> batch;
    {
        Locker locker { inbox.lock };
        if (inbox.queue.isEmpty()) {
            inbox.drainScheduled.store(false, std::memory_order_relaxed);
            return false;
        }
        limit = std::max<size_t>(inbox.queue.size(), 1000);
        batch = std::exchange(inbox.queue, {});
    }

    while (true) {
        while (!batch.isEmpty()) {
            if (limit-- == 0) {
                // Yield to the rest of the event loop. Return the undrained
                // tail to the front of the inbox so it stays ahead of
                // anything enqueued concurrently; caller reschedules.
                Locker locker { inbox.lock };
                while (!batch.isEmpty())
                    inbox.queue.prepend(batch.takeLast());
                return true;
            }
            auto message = batch.takeFirst();

            auto ports = MessagePort::entanglePorts(context, WTF::move(message.transferredPorts));
            auto event = MessageEvent::create(*context.jsGlobalObject(), message.message.releaseNonNull(), nullptr, WTF::move(ports));
            dispatch(event.event);

            if (globalObject->drainMicrotasks()) {
                // Termination pending. Drop the rest — dispatch is a no-op
                // once m_terminateRequested is set (drainToParent), and the
                // worker thread is tearing down (drainToWorker).
                return false;
            }
        }

        // Batch exhausted — see if more arrived while we were dispatching.
        Locker locker { inbox.lock };
        if (inbox.queue.isEmpty()) {
            inbox.drainScheduled.store(false, std::memory_order_relaxed);
            return false;
        }
        if (limit == 0)
            return true; // budget spent; caller reschedules
        batch = std::exchange(inbox.queue, {});
    }
}

void Worker::drainToWorker(ScriptExecutionContext& context)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(context.jsGlobalObject());
    if (!globalObject) {
        Locker locker { m_toWorker.lock };
        m_toWorker.drainScheduled.store(false, std::memory_order_relaxed);
        return;
    }
    bool reschedule = drainInbox(m_toWorker, globalObject, context, [&](Event& event) {
        globalObject->globalEventScope->dispatchEvent(event);
    });
    if (reschedule) {
        ScriptExecutionContext::postTaskTo(m_clientIdentifier, [protectedThis = Ref { *this }](ScriptExecutionContext& ctx) {
            protectedThis->drainToWorker(ctx);
        });
    }
}

void Worker::drainToParent(ScriptExecutionContext& context)
{
    auto* globalObject = defaultGlobalObject(context.jsGlobalObject());
    if (!globalObject) {
        Locker locker { m_toParent.lock };
        m_toParent.drainScheduled.store(false, std::memory_order_relaxed);
        return;
    }
    bool reschedule = drainInbox(m_toParent, globalObject, context, [&](Event& event) {
        dispatchEvent(event);
    });
    if (reschedule) {
        postTaskToParent([protectedThis = Ref { *this }](ScriptExecutionContext& c) {
            protectedThis->drainToParent(c);
        });
    }
}

void Worker::terminate()
{
    if (m_terminateRequested.exchange(true))
        return;
    WebWorker__notifyNeedTermination(impl_);
}

void Worker::setKeepAlive(bool keepAlive)
{
    // Once terminate() has been called or the close task has started, the
    // worker no longer participates in the parent's liveness — the close
    // task is the last thing to touch parent_poll_ref.
    if (m_terminateRequested.load() || m_state.load() >= State::Closing)
        return;
    WebWorker__setRef(impl_, keepAlive);
}

void Worker::dispatchEvent(Event& event)
{
    // Suppress user-visible events once terminate() has been called or the
    // worker has closed. The close event itself bypasses this (dispatchExit
    // calls EventTargetWithInlineData::dispatchEvent directly) so that
    // `await worker.terminate()` still resolves.
    if (m_terminateRequested.load() || m_state.load() == State::Closed)
        return;
    EventTargetWithInlineData::dispatchEvent(event);
}

bool Worker::postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&& task)
{
    {
        Locker lock(m_pendingTasksMutex);
        switch (m_state.load()) {
        case State::Pending:
            // Worker VM not up yet; queue for fireEarlyMessages().
            m_pendingTasks.append(WTF::move(task));
            return true;
        case State::Running:
            break;
        case State::Closing:
        case State::Closed:
            // Worker VM is gone; drop immediately (silent no-op).
            // postMessage() goes through enqueueToWorker(), not here — the
            // only user is getHeapSnapshot().
            return false;
        }
    }
    return ScriptExecutionContext::postTaskTo(m_clientIdentifier, WTF::move(task));
}

// ---- Worker-thread entry points ---------------------------------------------

void Worker::dispatchOnline(Zig::GlobalObject* workerGlobalObject)
{
    postTaskToParent([protectedThis = Ref { *this }](ScriptExecutionContext&) {
        if (protectedThis->hasEventListeners(eventNames().openEvent)) {
            auto event = Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No);
            protectedThis->dispatchEvent(event);
        }
    });

    auto* thisContext = workerGlobalObject->scriptExecutionContext();
    if (!thisContext) {
        return;
    }
    RELEASE_ASSERT(&thisContext->vm() == &workerGlobalObject->vm());
    RELEASE_ASSERT(thisContext == workerGlobalObject->globalEventScope->scriptExecutionContext());

    // Pending→Running under the same lock postTaskToWorkerGlobalScope uses, so
    // a message post racing this transition either queues (drained below by
    // fireEarlyMessages) or posts directly — never both, never neither.
    Locker lock(m_pendingTasksMutex);
    m_state.store(State::Running);
}

// Kick off the first drain of messages that arrived before the worker was
// online. A parent enqueue that observed State::Running (set in
// dispatchOnline, which runs just before fireEarlyMessages) may have already
// scheduled one — drainScheduled, set under the inbox lock, arbitrates.
static inline void workerScheduleInitialDrain(Worker& worker, Worker::MessageInbox& inbox, ScriptExecutionContext& ctx)
{
    {
        Locker locker { inbox.lock };
        if (inbox.queue.isEmpty() || inbox.drainScheduled.load(std::memory_order_relaxed))
            return;
        inbox.drainScheduled.store(true, std::memory_order_relaxed);
    }
    worker.drainToWorker(ctx);
}

void Worker::fireEarlyMessages(Zig::GlobalObject* workerGlobalObject)
{
    auto tasks = [&]() {
        Locker lock(m_pendingTasksMutex);
        return std::exchange(m_pendingTasks, {});
    }();
    auto* thisContext = workerGlobalObject->scriptExecutionContext();

    if (workerGlobalObject->globalEventScope->hasActiveEventListeners(eventNames().messageEvent)) {
        for (auto& task : tasks) {
            task(*thisContext);
        }
        workerScheduleInitialDrain(*this, m_toWorker, *thisContext);
    } else {
        thisContext->postTask([tasks = WTF::move(tasks), protectedThis = Ref { *this }](auto& ctx) mutable {
            for (auto& task : tasks) {
                task(ctx);
            }
            workerScheduleInitialDrain(protectedThis.get(), protectedThis->m_toWorker, ctx);
        });
    }
}

void Worker::dispatchErrorWithMessage(WTF::String message)
{
    postTaskToParent([protectedThis = Ref { *this }, message = message.isolatedCopy()](ScriptExecutionContext&) {
        ErrorEvent::Init init;
        init.message = message;

        auto event = ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes);
        protectedThis->dispatchEvent(event);
    });
}

bool Worker::dispatchErrorWithValue(Zig::GlobalObject* workerGlobalObject, JSValue value)
{
    auto serialized = SerializedScriptValue::create(*workerGlobalObject, value, SerializationForStorage::No, SerializationErrorMode::NonThrowing);
    if (!serialized)
        return false;

    return postTaskToParent([protectedThis = Ref { *this }, serialized](ScriptExecutionContext& context) {
        auto* globalObject = context.globalObject();
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        ErrorEvent::Init init;
        JSValue deserialized = serialized->deserialize(*globalObject, globalObject, SerializationErrorMode::NonThrowing);
        RETURN_IF_EXCEPTION(scope, );
        init.error = deserialized;

        auto event = ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes);
        protectedThis->dispatchEvent(event);
    });
}

bool Worker::dispatchExit(int32_t exitCode)
{
    // Runs on the worker thread after its JSC VM has been torn down. Post the
    // close event to the parent; that task additionally releases parent_poll_ref
    // and drops the worker-thread-held ref (both parent-thread-only operations).
    //
    // If posting fails — parent context no longer exists (nested worker whose
    // middle thread has already torn down) — the ref and poll are intentionally
    // leaked: dropping the ref here would run ~Worker → ~EventTarget on the
    // worker thread and trip EventListenerMap's single-thread assert. Parent
    // teardown implies process shutdown (or at least that nothing observes the
    // leak), so this is bounded. The proper fix is for a worker to stop+join
    // its sub-workers before tearing down its own context.
    return postTaskToParent([exitCode, protectedThis = Ref { *this }](ScriptExecutionContext&) {
        // Closing → dispatch 'close' → Closed. The split lets 'close'/'exit'
        // handlers observe threadId == -1 and isOnline() == false while
        // postMessage() (gated only on Closed) still accepts and drops the
        // message, matching browser/Node and pre-refactor behaviour.
        protectedThis->m_state.store(State::Closing);

        if (protectedThis->hasEventListeners(eventNames().closeEvent)) {
            auto event = CloseEvent::create(exitCode == 0, static_cast<unsigned short>(exitCode), exitCode == 0 ? "Worker terminated normally"_s : "Worker exited abnormally"_s);
            protectedThis->EventTargetWithInlineData::dispatchEvent(event);
        }

        protectedThis->m_state.store(State::Closed);
        WebWorker__releaseParentPollRef(protectedThis->impl_);
        // Drop the ref taken in create(). protectedThis keeps us alive across
        // this line; its own deref happens at lambda destruction on the parent
        // thread, so ~Worker never runs on the worker thread.
        protectedThis->deref();
    });
}

// ---- extern "C" shims (called from Zig) -------------------------------------

extern "C" void WebWorker__teardownJSCVM(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    vm.setHasTerminationRequest();

    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        globalObject->moduleLoader()->clearAll();
        globalObject->requireMap()->clear(globalObject);
        scope.exception(); // TODO: handle or assert none?
        vm.deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
        gcUnprotect(globalObject);
        globalObject = nullptr;
    }

    vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);

    vm.derefSuppressingSaferCPPChecking(); // NOLINT
    vm.derefSuppressingSaferCPPChecking(); // NOLINT
}

extern "C" void WebWorker__dispatchExit(Worker* worker, int32_t exitCode)
{
    worker->dispatchExit(exitCode);
}

extern "C" void WebWorker__dispatchOnline(Worker* worker, Zig::GlobalObject* globalObject)
{
    worker->dispatchOnline(globalObject);
}

extern "C" void WebWorker__fireEarlyMessages(Worker* worker, Zig::GlobalObject* globalObject)
{
    worker->fireEarlyMessages(globalObject);
}

extern "C" void WebWorker__dispatchError(Zig::GlobalObject* globalObject, Worker* worker, BunString message, JSC::EncodedJSValue errorValue)
{
    JSValue error = JSC::JSValue::decode(errorValue);
    ErrorEvent::Init init;
    init.message = message.toWTFString(BunString::ZeroCopy).isolatedCopy();
    init.error = error;
    init.cancelable = false;
    init.bubbles = false;

    globalObject->globalEventScope->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
    switch (worker->options().kind) {
    case WorkerOptions::Kind::Web:
        return worker->dispatchErrorWithMessage(message.toWTFString(BunString::ZeroCopy));
    case WorkerOptions::Kind::Node:
        if (!worker->dispatchErrorWithValue(globalObject, error)) {
            // If serialization threw an error, use the string instead
            worker->dispatchErrorWithMessage(message.toWTFString(BunString::ZeroCopy));
        }
        return;
    }
}

extern "C" WebCore::Worker* WebWorker__getParentWorker(void* bunVM);

JSC_DEFINE_HOST_FUNCTION(jsReceiveMessageOnPort, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(lexicalGlobalObject, scope, "receiveMessageOnPort needs 1 argument"_s);
        return {};
    }

    auto port = callFrame->argument(0);

    if (!port.isObject()) {
        return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"port\" argument must be a MessagePort instance"_s);
    }

    if (auto* messagePort = dynamicDowncast<JSMessagePort>(port)) {
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(messagePort->wrapped().tryTakeMessage(lexicalGlobalObject)));
    } else if (dynamicDowncast<JSBroadcastChannel>(port)) {
        // TODO: support broadcast channels
        return JSC::JSValue::encode(jsUndefined());
    }

    return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"port\" argument must be a MessagePort instance"_s);
}

JSValue createNodeWorkerThreadsBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue workerData = jsNull();
    JSValue threadId = jsNumber(0);
    JSMap* environmentData = nullptr;

    if (auto* worker = WebWorker__getParentWorker(globalObject->bunVM())) {
        auto& options = worker->options();
        auto ports = MessagePort::entanglePorts(*ScriptExecutionContext::getScriptExecutionContext(worker->clientIdentifier()), WTF::move(options.dataMessagePorts));
        RefPtr<WebCore::SerializedScriptValue> serialized = WTF::move(options.workerDataAndEnvironmentData);
        JSValue deserialized = serialized->deserialize(*globalObject, globalObject, WTF::move(ports));
        RETURN_IF_EXCEPTION(scope, {});
        // Should always be set to an Array of length 2 in the constructor in JSWorker.cpp
        auto* pair = uncheckedDowncast<JSArray>(deserialized);
        ASSERT(pair->length() == 2);
        ASSERT(pair->canGetIndexQuickly(0u));
        ASSERT(pair->canGetIndexQuickly(1u));
        workerData = pair->getIndexQuickly(0);
        RETURN_IF_EXCEPTION(scope, {});
        auto environmentDataValue = pair->getIndexQuickly(1);
        // it might not be a Map if the parent had not set up environmentData yet
        environmentData = environmentDataValue ? dynamicDowncast<JSMap>(environmentDataValue) : nullptr;
        RETURN_IF_EXCEPTION(scope, {});

        // Main thread starts at 1
        threadId = jsNumber(worker->clientIdentifier() - 1);
    }
    if (!environmentData) {
        environmentData = JSMap::create(vm, globalObject->mapStructure());
        RETURN_IF_EXCEPTION(scope, {});
    }
    ASSERT(environmentData);
    globalObject->setNodeWorkerEnvironmentData(environmentData);

    JSObject* array = constructEmptyArray(globalObject, nullptr, 4);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 0, workerData);
    array->putDirectIndex(globalObject, 1, threadId);
    array->putDirectIndex(globalObject, 2, JSFunction::create(vm, globalObject, 1, "receiveMessageOnPort"_s, jsReceiveMessageOnPort, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 3, environmentData);
    return array;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionPostMessage,
    (JSC::JSGlobalObject * leixcalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = leixcalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Zig::GlobalObject* globalObject = dynamicDowncast<Zig::GlobalObject>(leixcalGlobalObject);
    if (!globalObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    Worker* worker = WebWorker__getParentWorker(globalObject->bunVM());
    if (worker == nullptr)
        return JSValue::encode(jsUndefined());

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue options = callFrame->argument(1);

    Vector<JSC::Strong<JSC::JSObject>> transferList;

    if (options.isObject()) {
        JSC::JSValue transferListValue;
        // postMessage(message, sequence<object>) overload — second argument is the transfer list itself.
        bool isSequence = hasIteratorMethod(globalObject, options);
        RETURN_IF_EXCEPTION(scope, {});
        if (isSequence) {
            transferListValue = options;
        } else {
            // postMessage(message, { transfer }) overload.
            JSC::JSObject* optionsObject = options.getObject();
            transferListValue = optionsObject->get(globalObject, vm.propertyNames->transfer);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (transferListValue.isObject()) {
            forEachInIterable(globalObject, transferListValue, [&transferList](JSC::VM& vm, JSC::JSGlobalObject*, JSC::JSValue nextValue) {
                if (nextValue.isObject()) {
                    transferList.append(JSC::Strong<JSC::JSObject>(vm, nextValue.getObject()));
                }
            });
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(transferList), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, scope, serialized.releaseException());
        RELEASE_AND_RETURN(scope, {});
    }
    scope.assertNoException();

    ExceptionOr<Vector<TransferredMessagePort>> disentangledPorts = MessagePort::disentanglePorts(WTF::move(ports));
    if (disentangledPorts.hasException()) {
        WebCore::propagateException(*globalObject, scope, disentangledPorts.releaseException());
        RELEASE_AND_RETURN(scope, {});
    }
    scope.assertNoException();

    worker->enqueueToParent(MessageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() });

    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
