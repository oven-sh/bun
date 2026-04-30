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
// thread. See src/bun.js/web_worker.zig for the matching side of each entry point.
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

    MessageWithMessagePorts messageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() };

    this->postTaskToWorkerGlobalScope([message = WTF::move(messageWithMessagePorts)](auto& context) mutable {
        Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(context.jsGlobalObject());

        auto ports = MessagePort::entanglePorts(context, WTF::move(message.transferredPorts));
        auto event = MessageEvent::create(*globalObject, message.message.releaseNonNull(), nullptr, WTF::move(ports));

        globalObject->globalEventScope->dispatchEvent(event.event);
    });
    return {};
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

void Worker::postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&& task)
{
    {
        Locker lock(m_pendingTasksMutex);
        if (m_state.load() != State::Running) {
            // Worker VM not up yet (Pending) or already gone (Closed). In the
            // Closed case these tasks are dropped with the Worker; callers
            // that care (postMessage, getHeapSnapshot) check state first.
            m_pendingTasks.append(WTF::move(task));
            return;
        }
    }
    ScriptExecutionContext::postTaskTo(m_clientIdentifier, WTF::move(task));
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
    } else {
        thisContext->postTask([tasks = WTF::move(tasks)](auto& ctx) mutable {
            for (auto& task : tasks) {
                task(ctx);
            }
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
        JSC::JSObject* optionsObject = options.getObject();
        JSC::JSValue transferListValue = optionsObject->get(globalObject, vm.propertyNames->transfer);
        RETURN_IF_EXCEPTION(scope, {});
        if (transferListValue.isObject()) {
            JSC::JSObject* transferListObject = transferListValue.getObject();
            if (auto* transferListArray = dynamicDowncast<JSC::JSArray>(transferListObject)) {
                for (unsigned i = 0; i < transferListArray->length(); i++) {
                    JSC::JSValue transferListValue = transferListArray->get(globalObject, i);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (transferListValue.isObject()) {
                        JSC::JSObject* transferListObject = transferListValue.getObject();
                        transferList.append(JSC::Strong<JSC::JSObject>(vm, transferListObject));
                    }
                }
            }
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

    MessageWithMessagePorts messageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() };

    // By stable identifier — this runs on the worker thread, so don't touch
    // the parent's ScriptExecutionContext pointer directly.
    worker->postTaskToParent([message = messageWithMessagePorts, protectedThis = Ref { *worker }, ports](ScriptExecutionContext& context) mutable {
        Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(context.jsGlobalObject());

        auto ports = MessagePort::entanglePorts(context, WTF::move(message.transferredPorts));
        auto event = MessageEvent::create(*globalObject, message.message.releaseNonNull(), nullptr, WTF::move(ports));

        protectedThis->dispatchEvent(event.event);
    });

    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
