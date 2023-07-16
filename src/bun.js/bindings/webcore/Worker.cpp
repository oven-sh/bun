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

// #include "ContentSecurityPolicy.h"
// #include "DedicatedWorkerGlobalScope.h"
#include "ErrorEvent.h"
#include "Event.h"
#include "EventNames.h"
// #include "InspectorInstrumentation.h"
// #include "LoaderStrategy.h"
// #include "PlatformStrategies.h"
#if ENABLE(WEB_RTC)
#include "RTCRtpScriptTransform.h"
#include "RTCRtpScriptTransformer.h"
#endif
// #include "ResourceResponse.h"
// #include "SecurityOrigin.h"
#include "StructuredSerializeOptions.h"
// #include "WorkerGlobalScopeProxy.h"
// #include "WorkerInitializationData.h"
// #include "WorkerScriptLoader.h"
// #include "WorkerThread.h"
#include <JavaScriptCore/IdentifiersFactory.h>
#include <JavaScriptCore/ScriptCallStack.h>
#include <wtf/HashSet.h>
#include <wtf/IsoMallocInlines.h>
#include <wtf/MainThread.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Scope.h>
#include "SerializedScriptValue.h"
#include "ScriptExecutionContext.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/DeferredWorkTimer.h"
#include "MessageEvent.h"
#include <JavaScriptCore/HashMapImplInlines.h>

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(Worker);

extern "C" void WebWorker__terminate(
    void* worker);

static Lock allWorkersLock;
static HashMap<ScriptExecutionContextIdentifier, Worker*>& allWorkers() WTF_REQUIRES_LOCK(allWorkersLock)
{
    static NeverDestroyed<HashMap<ScriptExecutionContextIdentifier, Worker*>> map;
    return map;
}

void Worker::networkStateChanged(bool isOnline)
{
    // Locker locker { allWorkersLock };
    // for (auto& contextIdentifier : allWorkers().keys()) {
    //     ScriptExecutionContext::postTaskTo(contextIdentifier, [isOnline](auto& context) {
    //         auto& globalScope = downcast<WorkerGlobalScope>(context);
    //         globalScope.setIsOnline(isOnline);
    //         globalScope.dispatchEvent(Event::create(isOnline ? eventNames().onlineEvent : eventNames().offlineEvent, Event::CanBubble::No, Event::IsCancelable::No));
    //     });
    // }
}

Worker::Worker(ScriptExecutionContext& context, WorkerOptions&& options)
    : EventTargetWithInlineData()
    , ContextDestructionObserver(&context)
    , m_options(WTFMove(options))
    , m_identifier("worker:" + Inspector::IdentifiersFactory::createIdentifier())
    , m_clientIdentifier(ScriptExecutionContext::generateIdentifier())
{
    // static bool addedListener;
    // if (!addedListener) {
    //     platformStrategies()->loaderStrategy()->addOnlineStateChangeListener(&networkStateChanged);
    //     addedListener = true;
    // }

    Locker locker { allWorkersLock };
    auto addResult = allWorkers().add(m_clientIdentifier, this);
    ASSERT_UNUSED(addResult, addResult.isNewEntry);
}

extern "C" void* WebWorker__create(
    Worker* worker,
    void* parent,
    BunString name,
    BunString url,
    BunString* errorMessage,
    uint32_t parentContextId,
    uint32_t contextId);

ExceptionOr<Ref<Worker>> Worker::create(ScriptExecutionContext& context, const String& urlInit, WorkerOptions&& options)
{
    auto worker = adoptRef(*new Worker(context, WTFMove(options)));

    WTF::String url = urlInit;
    if (url.startsWith("file://"_s)) {
        url = WTF::URL(url).fileSystemPath();
    }
    BunString urlStr = Bun::toString(url);
    BunString errorMessage = BunStringEmpty;
    BunString nameStr = Bun::toString(options.name);

    void* impl = WebWorker__create(
        worker.ptr(),
        jsCast<Zig::GlobalObject*>(context.jsGlobalObject())->bunVM(),
        nameStr,
        urlStr,
        &errorMessage,
        static_cast<uint32_t>(context.identifier()),
        static_cast<uint32_t>(worker->m_clientIdentifier));

    if (!impl) {
        return Exception { TypeError, Bun::toWTFString(errorMessage) };
    }

    worker->impl_ = impl;
    worker->m_workerCreationTime = MonotonicTime::now();

    return worker;
}

Worker::~Worker()
{
    {
        Locker locker { allWorkersLock };
        allWorkers().remove(m_clientIdentifier);
    }
    // m_contextProxy.workerObjectDestroyed();
}

ExceptionOr<void> Worker::postMessage(JSC::JSGlobalObject& state, JSC::JSValue messageValue, StructuredSerializeOptions&& options)
{
    if (m_wasTerminated)
        return Exception { InvalidStateError, "Worker has been terminated"_s };

    auto message = SerializedScriptValue::create(state, messageValue, WTFMove(options.transfer), SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (message.hasException())
        return message.releaseException();

    this->postTaskToWorkerGlobalScope([message = message.releaseReturnValue()](auto& context) {
        Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(context.jsGlobalObject());
        bool didFail = false;
        JSValue value = message->deserialize(*globalObject, globalObject, SerializationErrorMode::NonThrowing, &didFail);
        message->deref();

        if (didFail) {
            globalObject->eventTarget()->dispatchEvent(MessageEvent::create(eventNames().messageerrorEvent, MessageEvent::Init {}, MessageEvent::IsTrusted::Yes));
            return;
        }

        WebCore::MessageEvent::Init init;
        init.data = value;
        globalObject->eventTarget()->dispatchEvent(MessageEvent::create(eventNames().messageEvent, WTFMove(init), MessageEvent::IsTrusted::Yes));
    });
    return {};
}

void Worker::terminate()
{
    // m_contextProxy.terminateWorkerGlobalScope();
    m_wasTerminated = true;
    WebWorker__terminate(impl_);
}

// const char* Worker::activeDOMObjectName() const
// {
//     return "Worker";
// }

// void Worker::stop()
// {
//     terminate();
// }

// void Worker::suspend(ReasonForSuspension reason)
// {
//     if (reason == ReasonForSuspension::BackForwardCache) {
//         m_contextProxy.suspendForBackForwardCache();
//         m_isSuspendedForBackForwardCache = true;
//     }
// }

// void Worker::resume()
// {
//     if (m_isSuspendedForBackForwardCache) {
//         m_contextProxy.resumeForBackForwardCache();
//         m_isSuspendedForBackForwardCache = false;
//     }
// }

bool Worker::hasPendingActivity() const
{
    if (this->m_isOnline) {
        return !this->m_isClosing;
    }

    return !this->m_wasTerminated;
}

void Worker::dispatchEvent(Event& event)
{
    if (m_wasTerminated)
        return;

    EventTarget::dispatchEvent(event);
}

#if ENABLE(WEB_RTC)
void Worker::createRTCRtpScriptTransformer(RTCRtpScriptTransform& transform, MessageWithMessagePorts&& options)
{
    if (!scriptExecutionContext())
        return;

    m_contextProxy.postTaskToWorkerGlobalScope([transform = Ref { transform }, options = WTFMove(options)](auto& context) mutable {
        if (auto transformer = downcast<DedicatedWorkerGlobalScope>(context).createRTCRtpScriptTransformer(WTFMove(options)))
            transform->setTransformer(*transformer);
    });
}
#endif

void Worker::drainEvents()
{
    for (auto& task : m_pendingTasks)
        postTaskToWorkerGlobalScope(WTFMove(task));
    m_pendingTasks.clear();
}

void Worker::dispatchOnline(Zig::GlobalObject* workerGlobalObject)
{
    this->m_isOnline = true;
    auto tasks = std::exchange(this->m_pendingTasks, {});

    auto* ctx = scriptExecutionContext();
    if (ctx) {
        ScriptExecutionContext::postTaskTo(ctx->identifier(), [protectedThis = Ref { *this }](ScriptExecutionContext& context) -> void {
            if (protectedThis->hasEventListeners(eventNames().openEvent)) {
                auto event = Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No);
                protectedThis->dispatchEvent(event);
            }
        });
    }

    auto* thisContext = workerGlobalObject->scriptExecutionContext();
    if (!thisContext)
        return;

    for (auto& task : tasks) {
        task(*thisContext);
    }
    tasks.clear();
}
void Worker::dispatchError(WTF::String message)
{

    auto* ctx = scriptExecutionContext();
    if (!ctx)
        return;

    ScriptExecutionContext::postTaskTo(ctx->identifier(), [protectedThis = Ref { *this }, message = message.isolatedCopy()](ScriptExecutionContext& context) -> void {
        protectedThis->drainEvents();

        ErrorEvent::Init init;
        init.message = message;

        auto event = ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes);
        protectedThis->dispatchEvent(event);
    });
}
void Worker::dispatchExit()
{
    auto* ctx = scriptExecutionContext();
    if (!ctx)
        return;

    ScriptExecutionContext::postTaskTo(ctx->identifier(), [protectedThis = Ref { *this }](ScriptExecutionContext& context) -> void {
        protectedThis->m_isOnline = false;
        protectedThis->m_isClosing = true;

        if (protectedThis->hasEventListeners(eventNames().closeEvent)) {
            auto event = Event::create(eventNames().closeEvent, Event::CanBubble::No, Event::IsCancelable::No);
            protectedThis->dispatchEvent(event);
        }
    });
}

void Worker::postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&& task)
{
    if (!this->m_isOnline) {
        this->m_pendingTasks.append(WTFMove(task));
        return;
    }

    ScriptExecutionContext::postTaskTo(m_clientIdentifier, WTFMove(task));
}

void Worker::forEachWorker(const Function<Function<void(ScriptExecutionContext&)>()>& callback)
{
    Locker locker { allWorkersLock };
    for (auto& contextIdentifier : allWorkers().keys())
        ScriptExecutionContext::postTaskTo(contextIdentifier, callback());
}

extern "C" void WebWorker__dispatchExit(Zig::GlobalObject* globalObject, Worker* worker, int32_t exitCode)
{
    if (globalObject) {
        auto& vm = globalObject->vm();

        if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(globalObject->moduleLoader())) {
            auto id = JSC::Identifier::fromString(globalObject->vm(), "registry"_s);
            if (auto* registry = JSC::jsDynamicCast<JSC::JSMap*>(obj->getIfPropertyExists(globalObject, id))) {
                registry->clear(vm);
            }
        }
        gcUnprotect(globalObject);
        vm.deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
        vm.heap.reportAbandonedObjectGraph();
        WTF::releaseFastMallocFreeMemoryForThisThread();
        vm.notifyNeedTermination();
        vm.deferredWorkTimer->doWork(vm);
    }

    worker->dispatchExit();
}
extern "C" void WebWorker__dispatchOnline(Worker* worker, Zig::GlobalObject* globalObject)
{
    worker->dispatchOnline(globalObject);
}

extern "C" void WebWorker__dispatchError(Zig::GlobalObject* globalObject, Worker* worker, BunString message, EncodedJSValue errorValue)
{
    JSValue error = JSC::JSValue::decode(errorValue);
    ErrorEvent::Init init;
    init.message = Bun::toWTFString(message).isolatedCopy();
    init.error = error;
    init.cancelable = false;
    init.bubbles = false;

    globalObject->eventTarget()->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
    worker->dispatchError(Bun::toWTFString(message));
}

} // namespace WebCore
