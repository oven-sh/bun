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
#include "ErrorCode.h"
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
#include <wtf/TZoneMallocInlines.h>
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

WTF_MAKE_TZONE_ALLOCATED_IMPL(Worker);

extern "C" void WebWorker__notifyNeedTermination(
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
    bool evalMode,
    StringImpl** argvPtr,
    size_t argvLen,
    bool defaultExecArgv,
    StringImpl** execArgvPtr,
    size_t execArgvLen,
    BunString* preloadModulesPtr,
    size_t preloadModulesLen);
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
        m_onlineClosingFlags = ClosingFlag;
        m_terminationFlags.fetch_or(TerminatedFlag);
        return false;
    }

    return true;
}

ExceptionOr<Ref<Worker>> Worker::create(ScriptExecutionContext& context, const String& urlInit, WorkerOptions&& options)
{
    auto worker = adoptRef(*new Worker(context, WTFMove(options)));

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
            // We need to replace the string inside preloadModuleStrings (this line replaces because
            // we are iterating by-ref). Otherwise, the string returned by fileSystemPath() will be
            // freed in this block, before it is used by Zig code.
            str = urlObject.fileSystemPath();
        }

        preloadModules.append(Bun::toString(str));
    }

    // try to ensure the cast from String* to StringImpl** is sane
    static_assert(sizeof(WTF::String) == sizeof(WTF::StringImpl*));
    std::span<WTF::StringImpl*> execArgv = worker->m_options.execArgv
                                               .transform([](Vector<String>& vec) -> std::span<WTF::StringImpl*> {
                                                   return { reinterpret_cast<WTF::StringImpl**>(vec.data()), vec.size() };
                                               })
                                               .value_or(std::span<WTF::StringImpl*> {});
    void* impl = WebWorker__create(
        worker.ptr(),
        bunVM(context.jsGlobalObject()),
        nameStr,
        urlStr,
        &errorMessage,
        static_cast<uint32_t>(context.identifier()),
        static_cast<uint32_t>(worker->m_clientIdentifier),
        worker->m_options.mini,
        worker->m_options.unref,
        worker->m_options.evalMode,
        reinterpret_cast<WTF::StringImpl**>(worker->m_options.argv.data()),
        worker->m_options.argv.size(),
        !worker->m_options.execArgv.has_value(),
        execArgv.data(),
        execArgv.size(),
        preloadModules.data(),
        preloadModules.size());
    // now referenced by Zig
    worker->ref();

    preloadModuleStrings.clear();

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
    if (m_terminationFlags & TerminatedFlag)
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
        auto event = MessageEvent::create(*globalObject, message.message.releaseNonNull(), nullptr, WTFMove(ports));

        globalObject->globalEventScope->dispatchEvent(event.event);
    });
    return {};
}

void Worker::terminate()
{
    // m_contextProxy.terminateWorkerGlobalScope();
    m_terminationFlags.fetch_or(TerminateRequestedFlag);
    WebWorker__notifyNeedTermination(impl_);
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

bool Worker::wasTerminated() const
{
    return m_terminationFlags & TerminatedFlag;
}

bool Worker::hasPendingActivity() const
{
    auto onlineClosingFlags = m_onlineClosingFlags.load();
    if (onlineClosingFlags & OnlineFlag) {
        return !(onlineClosingFlags & ClosingFlag);
    }

    return !(m_terminationFlags & TerminatedFlag);
}

bool Worker::isClosingOrTerminated() const
{
    return m_onlineClosingFlags & ClosingFlag;
}

void Worker::dispatchEvent(Event& event)
{
    if (!m_terminationFlags)
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

    m_onlineClosingFlags.fetch_or(OnlineFlag);
    auto* thisContext = workerGlobalObject->scriptExecutionContext();
    if (!thisContext) {
        return;
    }
    RELEASE_ASSERT(&thisContext->vm() == &workerGlobalObject->vm());
    RELEASE_ASSERT(thisContext == workerGlobalObject->globalEventScope->scriptExecutionContext());
}

void Worker::fireEarlyMessages(Zig::GlobalObject* workerGlobalObject)
{
    auto tasks = [&]() {
        Locker lock(this->m_pendingTasksMutex);
        return std::exchange(this->m_pendingTasks, {});
    }();
    auto* thisContext = workerGlobalObject->scriptExecutionContext();
    if (workerGlobalObject->globalEventScope->hasActiveEventListeners(eventNames().messageEvent)) {
        for (auto& task : tasks) {
            task(*thisContext);
        }
    } else {
        thisContext->postTask([tasks = WTFMove(tasks)](auto& ctx) mutable {
            for (auto& task : tasks) {
                task(ctx);
            }
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
        protectedThis->m_onlineClosingFlags = ClosingFlag;

        if (protectedThis->hasEventListeners(eventNames().closeEvent)) {
            auto event = CloseEvent::create(exitCode == 0, static_cast<unsigned short>(exitCode), exitCode == 0 ? "Worker terminated normally"_s : "Worker exited abnormally"_s);
            protectedThis->dispatchCloseEvent(event);
        }
        protectedThis->m_terminationFlags.fetch_or(TerminatedFlag);
    });
}

void Worker::postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&& task)
{
    if (!(m_onlineClosingFlags & OnlineFlag)) {
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
    // no longer referenced by Zig
    worker->deref();

    if (globalObject) {
        auto& vm = JSC::getVM(globalObject);
        vm.setHasTerminationRequest();

        {
            globalObject->esmRegistryMap()->clear(globalObject);
            globalObject->requireMap()->clear(globalObject);
            vm.deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
            gcUnprotect(globalObject);
            globalObject = nullptr;
        }

        vm.heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);

        vm.derefSuppressingSaferCPPChecking(); // NOLINT
        vm.derefSuppressingSaferCPPChecking(); // NOLINT
    }
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
    worker->dispatchError(message.toWTFString(BunString::ZeroCopy));
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

    if (auto* messagePort = jsDynamicCast<JSMessagePort*>(port)) {
        return JSC::JSValue::encode(messagePort->wrapped().tryTakeMessage(lexicalGlobalObject));
    } else if (jsDynamicCast<JSBroadcastChannel*>(port)) {
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
        auto ports = MessagePort::entanglePorts(*ScriptExecutionContext::getScriptExecutionContext(worker->clientIdentifier()), WTFMove(options.dataMessagePorts));
        RefPtr<WebCore::SerializedScriptValue> serialized = WTFMove(options.workerDataAndEnvironmentData);
        JSValue deserialized = serialized->deserialize(*globalObject, globalObject, WTFMove(ports));
        RETURN_IF_EXCEPTION(scope, {});
        // Should always be set to an Array of length 2 in the constructor in JSWorker.cpp
        auto* pair = jsCast<JSArray*>(deserialized);
        ASSERT(pair->length() == 2);
        ASSERT(pair->canGetIndexQuickly(0u));
        ASSERT(pair->canGetIndexQuickly(1u));
        workerData = pair->getIndexQuickly(0);
        RETURN_IF_EXCEPTION(scope, {});
        // it might not be a Map if the parent had not set up environmentData yet
        environmentData = jsDynamicCast<JSMap*>(pair->getIndexQuickly(1));
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
        auto event = MessageEvent::create(*globalObject, message.message.releaseNonNull(), nullptr, WTFMove(ports));

        protectedThis->dispatchEvent(event.event);
    });

    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
