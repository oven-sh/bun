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
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/DeferredWorkTimer.h>
#include "MessageEvent.h"
#include "BunWorkerGlobalScope.h"
#include "CloseEvent.h"
#include "JSMessagePort.h"
#include "JSBroadcastChannel.h"

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(Worker);

extern "C" void WebWorker__requestTerminate(
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
    , m_identifier(makeString("worker:"_s, Inspector::IdentifiersFactory::createIdentifier()))
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
extern "C" bool WebWorker__updatePtr(void* worker, Worker* ptr);
extern "C" void* WebWorker__create(
    Worker* worker,
    void* parent,
    BunString name,
    BunString url,
    BunString* errorMessage,
    uint32_t parentContextId,
    uint32_t contextId,
    bool miniMode,
    bool unrefByDefault,
    StringImpl* argvPtr,
    uint32_t argvLen,
    StringImpl* execArgvPtr,
    uint32_t execArgvLen);
extern "C" void WebWorker__setRef(
    void* worker,
    bool ref);

void Worker::setKeepAlive(bool keepAlive)
{
    WebWorker__setRef(impl_, keepAlive);
}

bool Worker::updatePtr()
{
    if (!WebWorker__updatePtr(impl_, this)) {
        m_wasTerminated = true;
        m_isClosing = true;
        m_isOnline = false;
        return false;
    }

    return true;
}

ExceptionOr<Ref<Worker>> Worker::create(ScriptExecutionContext& context, const String& urlInit, WorkerOptions&& options)
{
    auto worker = adoptRef(*new Worker(context, WTFMove(options)));

    WTF::String url = urlInit;
    if (url.startsWith("file://"_s)) {
        url = WTF::URL(url).fileSystemPath();
    }
    BunString urlStr = Bun::toString(url);
    BunString errorMessage = BunStringEmpty;
    BunString nameStr = Bun::toString(worker->m_options.name);

    bool miniMode = worker->m_options.bun.mini;
    bool unrefByDefault = worker->m_options.bun.unref;

    Vector<String>* argv = worker->m_options.bun.argv.get();
    Vector<String>* execArgv = worker->m_options.bun.execArgv.get();

    void* impl = WebWorker__create(
        worker.ptr(),
        jsCast<Zig::GlobalObject*>(context.jsGlobalObject())->bunVM(),
        nameStr,
        urlStr,
        &errorMessage,
        static_cast<uint32_t>(context.identifier()),
        static_cast<uint32_t>(worker->m_clientIdentifier),
        miniMode,
        unrefByDefault,
        argv ? reinterpret_cast<StringImpl*>(argv->data()) : nullptr,
        argv ? static_cast<uint32_t>(argv->size()) : 0,
        execArgv ? reinterpret_cast<StringImpl*>(execArgv->data()) : nullptr,
        execArgv ? static_cast<uint32_t>(execArgv->size()) : 0);

    if (!impl) {
        return Exception { TypeError, errorMessage.toWTFString(BunString::ZeroCopy) };
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

    Vector<RefPtr<MessagePort>> ports;
    auto serialized = SerializedScriptValue::create(state, messageValue, WTFMove(options.transfer), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException())
        return serialized.releaseException();

    ExceptionOr<Vector<TransferredMessagePort>> disentangledPorts = MessagePort::disentanglePorts(WTFMove(ports));
    if (disentangledPorts.hasException()) {
        return disentangledPorts.releaseException();
    }

    MessageWithMessagePorts messageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() };

    this->postTaskToWorkerGlobalScope([message = messageWithMessagePorts](auto& context) mutable {
        Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(context.jsGlobalObject());

        auto ports = MessagePort::entanglePorts(context, WTFMove(message.transferredPorts));
        auto event = MessageEvent::create(*globalObject, message.message.releaseNonNull(), std::nullopt, WTFMove(ports));

        globalObject->globalEventScope.dispatchEvent(event.event);
    });
    return {};
}

void Worker::terminate()
{
    // m_contextProxy.terminateWorkerGlobalScope();
    m_wasTerminated = true;
    WebWorker__requestTerminate(impl_);
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
    if (!m_wasTerminated)
        EventTargetWithInlineData::dispatchEvent(event);
}

// The close event gets dispatched even if m_wasTerminated is true.
// This allows new wt.Worker().terminate() to actually resolve
void Worker::dispatchCloseEvent(Event& event)
{
    EventTargetWithInlineData::dispatchEvent(event);
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
    Locker lock(this->m_pendingTasksMutex);
    for (auto& task : m_pendingTasks)
        postTaskToWorkerGlobalScope(WTFMove(task));
    m_pendingTasks.clear();
}

void Worker::dispatchOnline(Zig::GlobalObject* workerGlobalObject)
{
    auto* ctx = scriptExecutionContext();
    if (ctx) {
        ScriptExecutionContext::postTaskTo(ctx->identifier(), [protectedThis = Ref { *this }](ScriptExecutionContext& context) -> void {
            if (protectedThis->hasEventListeners(eventNames().openEvent)) {
                auto event = Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No);
                protectedThis->dispatchEvent(event);
            }
        });
    }

    Locker lock(this->m_pendingTasksMutex);

    this->m_isOnline = true;
    auto* thisContext = workerGlobalObject->scriptExecutionContext();
    if (!thisContext) {
        return;
    }
    RELEASE_ASSERT(&thisContext->vm() == &workerGlobalObject->vm());
    RELEASE_ASSERT(thisContext == workerGlobalObject->globalEventScope.scriptExecutionContext());

    if (workerGlobalObject->globalEventScope.hasActiveEventListeners(eventNames().messageEvent)) {
        auto tasks = std::exchange(this->m_pendingTasks, {});
        lock.unlockEarly();
        for (auto& task : tasks) {
            task(*thisContext);
        }
    } else {
        auto tasks = std::exchange(this->m_pendingTasks, {});
        lock.unlockEarly();

        thisContext->postTask([tasks = WTFMove(tasks)](auto& ctx) mutable {
            for (auto& task : tasks) {
                task(ctx);
            }
            tasks.clear();
        });
    }
}
void Worker::dispatchError(WTF::String message)
{

    auto* ctx = scriptExecutionContext();
    if (!ctx)
        return;

    ScriptExecutionContext::postTaskTo(ctx->identifier(), [protectedThis = Ref { *this }, message = message.isolatedCopy()](ScriptExecutionContext& context) -> void {
        ErrorEvent::Init init;
        init.message = message;

        auto event = ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes);
        protectedThis->dispatchEvent(event);
    });
}
void Worker::dispatchExit(int32_t exitCode)
{
    auto* ctx = scriptExecutionContext();
    if (!ctx)
        return;

    ScriptExecutionContext::postTaskTo(ctx->identifier(), [exitCode, protectedThis = Ref { *this }](ScriptExecutionContext& context) -> void {
        protectedThis->m_isOnline = false;
        protectedThis->m_isClosing = true;

        if (protectedThis->hasEventListeners(eventNames().closeEvent)) {
            auto event = CloseEvent::create(exitCode == 0, static_cast<unsigned short>(exitCode), exitCode == 0 ? "Worker terminated normally"_s : "Worker exited abnormally"_s);
            protectedThis->dispatchCloseEvent(event);
        }
        protectedThis->m_wasTerminated = true;
    });
}

void Worker::postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&& task)
{
    if (!this->m_isOnline) {
        Locker lock(this->m_pendingTasksMutex);
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

    worker->dispatchExit(exitCode);

    if (globalObject) {
        JSC::VM& vm = globalObject->vm();
        vm.setHasTerminationRequest();

        while (!vm.hasOneRef())
            vm.deref();

        vm.deref();
    }
}
extern "C" void WebWorker__dispatchOnline(Worker* worker, Zig::GlobalObject* globalObject)
{
    worker->dispatchOnline(globalObject);
}

extern "C" void WebWorker__dispatchError(Zig::GlobalObject* globalObject, Worker* worker, BunString message, JSC::EncodedJSValue errorValue)
{
    JSValue error = JSC::JSValue::decode(errorValue);
    ErrorEvent::Init init;
    init.message = message.toWTFString(BunString::ZeroCopy).isolatedCopy();
    init.error = error;
    init.cancelable = false;
    init.bubbles = false;

    globalObject->globalEventScope.dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
    worker->dispatchError(message.toWTFString(BunString::ZeroCopy));
}

extern "C" WebCore::Worker* WebWorker__getParentWorker(void*);

JSC_DEFINE_HOST_FUNCTION(jsReceiveMessageOnPort, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(lexicalGlobalObject, scope, "receiveMessageOnPort needs 1 argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto port = callFrame->argument(0);

    if (!port.isObject()) {
        throwTypeError(lexicalGlobalObject, scope, "the \"port\" argument must be a MessagePort instance"_s);
        return JSC::JSValue::encode(jsUndefined());
    }

    if (auto* messagePort = jsDynamicCast<JSMessagePort*>(port)) {
        return JSC::JSValue::encode(messagePort->wrapped().tryTakeMessage(lexicalGlobalObject));
    } else if (auto* broadcastChannel = jsDynamicCast<JSBroadcastChannel*>(port)) {
        // TODO: support broadcast channels
        return JSC::JSValue::encode(jsUndefined());
    }

    throwTypeError(lexicalGlobalObject, scope, "the \"port\" argument must be a MessagePort instance"_s);
    return JSC::JSValue::encode(jsUndefined());
}

JSValue createNodeWorkerThreadsBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue workerData = jsUndefined();
    JSValue threadId = jsNumber(0);

    if (auto* worker = WebWorker__getParentWorker(globalObject->bunVM())) {
        auto& options = worker->options();
        if (worker && options.bun.data) {
            auto ports = MessagePort::entanglePorts(*ScriptExecutionContext::getScriptExecutionContext(worker->clientIdentifier()), WTFMove(options.bun.dataMessagePorts));
            RefPtr<WebCore::SerializedScriptValue> serialized = WTFMove(options.bun.data);
            JSValue deserialized = serialized->deserialize(*globalObject, globalObject, WTFMove(ports));
            RETURN_IF_EXCEPTION(scope, {});
            workerData = deserialized;
        }

        // Main thread starts at 1
        threadId = jsNumber(worker->clientIdentifier() - 1);
    }

    JSArray* array = constructEmptyArray(globalObject, nullptr, 3);

    array->putByIndexInline(globalObject, (unsigned)0, workerData, false);
    array->putByIndexInline(globalObject, (unsigned)1, threadId, false);
    array->putByIndexInline(globalObject, (unsigned)2, JSFunction::create(vm, globalObject, 1, "receiveMessageOnPort"_s, jsReceiveMessageOnPort, ImplementationVisibility::Public, NoIntrinsic), false);

    return array;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionPostMessage,
    (JSC::JSGlobalObject * leixcalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = leixcalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Zig::GlobalObject* globalObject = jsDynamicCast<Zig::GlobalObject*>(leixcalGlobalObject);
    if (UNLIKELY(!globalObject))
        return JSValue::encode(jsUndefined());

    Worker* worker = WebWorker__getParentWorker(globalObject->bunVM());
    if (worker == nullptr)
        return JSValue::encode(jsUndefined());

    ScriptExecutionContext* context = worker->scriptExecutionContext();

    if (!context)
        return JSValue::encode(jsUndefined());

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue options = callFrame->argument(1);

    Vector<JSC::Strong<JSC::JSObject>> transferList;

    if (options.isObject()) {
        JSC::JSObject* optionsObject = options.getObject();
        JSC::JSValue transferListValue = optionsObject->get(globalObject, vm.propertyNames->transfer);
        if (transferListValue.isObject()) {
            JSC::JSObject* transferListObject = transferListValue.getObject();
            if (auto* transferListArray = jsDynamicCast<JSC::JSArray*>(transferListObject)) {
                for (unsigned i = 0; i < transferListArray->length(); i++) {
                    JSC::JSValue transferListValue = transferListArray->get(globalObject, i);
                    if (transferListValue.isObject()) {
                        JSC::JSObject* transferListObject = transferListValue.getObject();
                        transferList.append(JSC::Strong<JSC::JSObject>(vm, transferListObject));
                    }
                }
            }
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTFMove(transferList), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        return JSValue::encode(jsUndefined());
    }

    ExceptionOr<Vector<TransferredMessagePort>> disentangledPorts = MessagePort::disentanglePorts(WTFMove(ports));
    if (disentangledPorts.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        return JSValue::encode(jsUndefined());
    }

    MessageWithMessagePorts messageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() };

    ScriptExecutionContext::postTaskTo(context->identifier(), [message = messageWithMessagePorts, protectedThis = Ref { *worker }, ports](ScriptExecutionContext& context) mutable {
        Zig::GlobalObject* globalObject = jsCast<Zig::GlobalObject*>(context.jsGlobalObject());

        auto ports = MessagePort::entanglePorts(context, WTFMove(message.transferredPorts));
        auto event = MessageEvent::create(*globalObject, message.message.releaseNonNull(), std::nullopt, WTFMove(ports));

        protectedThis->dispatchEvent(event.event);
    });

    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
