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

#include "InternalModuleRegistry.h"
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
#include "GlobalEventScope.h"
#include "CloseEvent.h"
#include "JSDOMConvertObject.h"
#include "JSDOMConvertSequences.h"
#include "JSMessagePort.h"
#include "JSMessageChannel.h"
#include "JSWorker.h"
#include "MessagePortPipe.h"
#include "JSBroadcastChannel.h"
#include "JSStructuredSerializeOptions.h"
#include "BunClientData.h"

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Worker);

Worker::Worker(ScriptExecutionContext& context, WorkerOptions&& options)
    : ActiveDOMObject(&context)
    , m_name(options.name)
    , m_contextProxy(WorkerMessagingProxy::create(*this, context, WTF::move(options)))
{
}

ExceptionOr<Ref<Worker>> Worker::create(ScriptExecutionContext& context, const String& urlInit, WorkerOptions&& options)
{
    ASSERT(context.isContextThread());

    String url = urlInit;
    if (url.startsWith("file://"_s)) {
        WTF::URL urlObject { url };
        if (!urlObject.isValid())
            return Exception { TypeError, makeString("Invalid file URL: \""_s, urlInit, '"') };
        url = urlObject.fileSystemPath();
    }

    auto worker = adoptRef(*new Worker(context, WTF::move(options)));
    worker->suspendIfNeeded();

    auto started = worker->m_contextProxy->startWorkerGlobalScope(url);
    if (started.hasException())
        return started.releaseException();
    return worker;
}

Worker::~Worker()
{
    m_contextProxy->workerObjectDestroyed();
}

// As in WebCore and Node: a message for a worker that has terminated is serialized (transfer
// side effects still happen) and then dropped by the proxy; it is not an error.
ExceptionOr<void> Worker::postMessage(JSC::JSGlobalObject& state, JSC::JSValue messageValue, StructuredSerializeOptions&& options)
{
    Vector<RefPtr<MessagePort>> ports;
    auto serialized = SerializedScriptValue::create(state, messageValue, WTF::move(options.transfer), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException())
        return serialized.releaseException();

    auto disentangledPorts = MessagePort::disentanglePorts(WTF::move(ports));
    if (disentangledPorts.hasException())
        return disentangledPorts.releaseException();

    m_contextProxy->postMessageToWorkerGlobalScope(MessageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() });
    return {};
}

void Worker::terminate()
{
    m_wasTerminated = true;
    m_contextProxy->terminateWorkerGlobalScope();
}

void Worker::stop()
{
    terminate();
}

bool Worker::virtualHasPendingActivity() const
{
    return m_contextProxy->hasPendingActivity();
}

void Worker::setKeepAlive(bool keepAlive)
{
    m_contextProxy->setKeepAlive(keepAlive);
}

void Worker::dispatchEvent(Event& event)
{
    if (m_wasTerminated || !m_contextProxy->hasPendingActivity())
        return;
    EventTargetWithInlineData::dispatchEvent(event);
}

void Worker::dispatchCloseEvent(Event& event)
{
    EventTargetWithInlineData::dispatchEvent(event);
}

// ---- Worker-thread side: hooks the native thread object calls, and the script-facing functions that
//      run inside a worker (parentPort.postMessage, workerData, receiveMessageOnPort, ...).

// The proxy of the worker whose global scope runs on `bunVM`'s thread, or null on the main thread.
extern "C" WorkerMessagingProxy* WebWorker__getMessagingProxy(void* bunVM);

// Node runs a worker's preloads and its entry point inside the callback of the first message on the worker's
// internal port. So a node worker hears nothing from its parent before that callback has returned: behind the
// first turn of the entry point (WebWorker__entrySettled), or where a preload first waits for the event loop
// (EventLoop::wait_for_node_worker_preload). The ports that the start sequence holds start at the first of the
// two, and their pipes deliver what the parent posted meanwhile in tasks of their own, behind the microtasks
// and ticks of the turn that just ran.
extern "C" void WebWorker__releaseHeldPorts(Zig::GlobalObject* globalObject)
{
    globalObject->releaseNodeWorkerPorts();
}

// The entry module just finished (or failed) its top-level evaluation. Flush the worker_threads
// hub's deferred cross-thread deliveries: node's bootstrap runs the synchronous CJS main before any
// port delivery, so a routed message must not observe "no listeners" while the entry that registers
// them is still loading. Runs on every post-evaluation path so a buffered postMessageToThread never
// leaves its sender's Atomics.waitAsync unresolved.
extern "C" void WebWorker__entrySettled(Zig::GlobalObject* globalObject)
{
    globalObject->releaseNodeWorkerPorts();
    auto* hook = globalObject->nodeWorkerEntryEvaluatedHook();
    if (!hook)
        return;
    globalObject->setNodeWorkerEntryEvaluatedHook(nullptr);
    auto& vm = JSC::getVM(globalObject);
    // On failure paths (entry threw / TLA rejected) an exception may already be pending; the hook
    // can't observe it and shutdown reports it either way.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    CLEAR_IF_EXCEPTION(scope);
    if (vm.hasPendingTerminationException())
        return;
    JSC::MarkedArgumentBuffer args;
    JSC::call(globalObject, hook, args, "entryEvaluated hook"_s);
    CLEAR_IF_EXCEPTION(scope);
}

extern "C" void WebWorker__workerThreadStarted(WorkerMessagingProxy* proxy)
{
    proxy->workerThreadStarted();
}

extern "C" void WebWorker__workerGlobalScopeStarted(WorkerMessagingProxy* proxy, Zig::GlobalObject* globalObject)
{
    WebWorker__entrySettled(globalObject);
    proxy->workerGlobalScopeStarted(*globalObject);
}

extern "C" void WebWorker__workerGlobalScopeDestroyed(WorkerMessagingProxy* proxy, int32_t exitCode, bool stoppedByParent)
{
    proxy->workerGlobalScopeDestroyed(exitCode, stoppedByParent);
}

extern "C" void WebWorker__parentContextWillDestroy(WorkerMessagingProxy* proxy)
{
    proxy->parentContextWillDestroy();
}

extern "C" void WebWorker__postOutOfMemoryError(WorkerMessagingProxy* proxy)
{
    proxy->postOutOfMemoryErrorToWorkerObject();
}

extern "C" void WebWorker__postFailedToStartError(WorkerMessagingProxy* proxy)
{
    proxy->postFailedToStartErrorToWorkerObject();
}

// An uncaught error inside the worker: dispatch 'error' on the worker's own global scope, then report
// it to the Worker object.
extern "C" void WebWorker__dispatchError(Zig::GlobalObject* globalObject, WorkerMessagingProxy* proxy, BunString message, JSC::EncodedJSValue errorValue)
{
    JSC::JSValue error = JSC::JSValue::decode(errorValue);
    String messageStr = message.transferToWTFString();
    ErrorEvent::Init init;
    init.message = messageStr;
    init.error = error;
    init.cancelable = false;
    init.bubbles = false;
    globalObject->globalEventScope->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
    proxy->postErrorToWorkerObject(*globalObject, messageStr, error);
}

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
        // node: `undefined` when the queue is empty, otherwise `{ message }` — built
        // here so a posted `undefined`/falsy value is distinguishable from "empty".
        bool hadMessage = false;
        JSValue message = messagePort->wrapped().tryTakeMessage(lexicalGlobalObject, hadMessage);
        RETURN_IF_EXCEPTION(scope, {});
        if (!hadMessage)
            return JSC::JSValue::encode(jsUndefined());
        auto* result = JSC::constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 1);
        Bun::putDirectNamed(vm, result, "message"_s, message);
        return JSC::JSValue::encode(result);
    } else if (dynamicDowncast<JSBroadcastChannel>(port)) {
        // TODO: support broadcast channels
        return JSC::JSValue::encode(jsUndefined());
    }

    return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "The \"port\" argument must be a MessagePort instance"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsMessagePortIsActive, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto port = callFrame->argument(0);
    if (auto* messagePort = dynamicDowncast<JSMessagePort>(port)) {
        auto& wrapped = messagePort->wrapped();
        bool active = (wrapped.isDetached() == false) && wrapped.pipe()->isOtherSideOpen(wrapped.side());
        return JSC::JSValue::encode(jsBoolean(active));
    }
    return JSC::JSValue::encode(jsBoolean(false));
}

// Primitives are a documented no-op for both.
JSC_DEFINE_HOST_FUNCTION(jsFunctionMarkAsUncloneable, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    if (auto* object = callFrame->argument(0).getObject())
        markAsUncloneable(lexicalGlobalObject->vm(), *object);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionMarkAsUntransferable, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    if (auto* object = callFrame->argument(0).getObject())
        markAsUntransferable(lexicalGlobalObject->vm(), *object);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsMarkedAsUntransferable, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    auto* object = callFrame->argument(0).getObject();
    return JSC::JSValue::encode(jsBoolean(object && !!object->getDirect(vm, builtinNames(vm).isUntransferablePrivateName())));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionSetEntryEvaluatedHook, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    if (auto* hook = callFrame->argument(0).getObject())
        defaultGlobalObject(lexicalGlobalObject)->setNodeWorkerEntryEvaluatedHook(hook);
    return JSC::JSValue::encode(jsUndefined());
}

JSValue createNodeWorkerThreadsBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue workerData = jsNull();
    JSValue threadId = jsNumber(0);
    JSValue threadName = jsEmptyString(vm);
    JSValue parentPort = jsUndefined();
    JSValue hubPort = jsUndefined();
    JSMap* environmentData = nullptr;

    auto* proxy = WebWorker__getMessagingProxy(globalObject->bunVM());
    if (proxy) {
        auto& options = proxy->options();
        RefPtr<WebCore::SerializedScriptValue> serialized = WTF::move(options.workerDataAndEnvironmentData);
        // `workerDataAndEnvironmentData` is moved-from on the first call. If
        // this binding is created twice (lazy-init re-entry), `serialized` is
        // null and `->deserialize` would UB → garbage → SIGTRAP at the
        // uncheckedDowncast below (#53748 darwin). Guard both: skip the
        // deserialize on second call (workerData stays jsUndefined), and use a
        // checked cast so a non-Array deserialize result doesn't trap.
        if (serialized) {
            auto ports = MessagePort::entanglePorts(*globalObject->scriptExecutionContext(), WTF::move(options.dataMessagePorts));
            JSValue deserialized = serialized->deserialize(*globalObject, globalObject, WTF::move(ports));
            RETURN_IF_EXCEPTION(scope, {});
            // Should always be set to an Array of length 2 in the constructor in JSWorker.cpp
            if (auto* pair = dynamicDowncast<JSArray>(deserialized)) {
                ASSERT(pair->length() == 2);
                ASSERT(pair->canGetIndexQuickly(0u));
                ASSERT(pair->canGetIndexQuickly(1u));
                workerData = pair->getIndexQuickly(0);
                RETURN_IF_EXCEPTION(scope, {});
                auto environmentDataValue = pair->getIndexQuickly(1);
                // it might not be a Map if the parent had not set up environmentData yet
                environmentData = environmentDataValue ? dynamicDowncast<JSMap>(environmentDataValue) : nullptr;
                RETURN_IF_EXCEPTION(scope, {});
            } else {
                ASSERT_NOT_REACHED_WITH_MESSAGE("createNodeWorkerThreadsBinding: deserialized is not JSArray");
            }
        }

        // The worker's ends of the channels that its parent's node:worker_threads Worker made. Taken once, like
        // workerData. The stdio port and parentPort are held from before script has them (WebWorker__releaseHeldPorts).
        // The postMessageToThread port is not: what it delivers waits in node:worker_threads until the entry point
        // has evaluated, and is handled there on every path that ends the start (internal/worker/messaging).
        if (options.nodePorts[WorkerOptions::Stdio].pipe) {
            auto& context = *globalObject->scriptExecutionContext();
            Ref stdio = MessagePort::entangle(context, WTF::move(options.nodePorts[WorkerOptions::Stdio]));
            Ref parent = MessagePort::entangle(context, WTF::move(options.nodePorts[WorkerOptions::Parent]));
            Ref hub = MessagePort::entangle(context, WTF::move(options.nodePorts[WorkerOptions::Hub]));
            stdio->holdStart();
            parent->holdStart();
            // process.stdin, process.stdout and process.stderr are made over the stdio port on first use (BunProcess.cpp).
            JSValue stdioPort = toJS(globalObject, globalObject, stdio.get());
            RETURN_IF_EXCEPTION(scope, {});
            globalObject->setNodeWorkerStdioPort(stdioPort.getObject(), options.nodeStdin);
            parentPort = toJS(globalObject, globalObject, parent.get());
            RETURN_IF_EXCEPTION(scope, {});
            hubPort = toJS(globalObject, globalObject, hub.get());
            RETURN_IF_EXCEPTION(scope, {});
            globalObject->holdNodeWorkerPorts({ WTF::move(stdio), WTF::move(parent) });
        }

        // Main thread starts at 1
        threadId = jsNumber(proxy->workerContextIdentifier() - 1);
        // isolatedCopy: this JSString lives in the worker heap; it must own a
        // worker-local impl so its GC deref never races m_options.name's
        // (non-atomic) refcount on the parent thread.
        threadName = jsString(vm, options.name.isolatedCopy());
    }
    if (!environmentData) {
        environmentData = JSMap::create(vm, globalObject->mapStructure());
        RETURN_IF_EXCEPTION(scope, {});
    }
    ASSERT(environmentData);
    globalObject->setNodeWorkerEnvironmentData(environmentData);

    bool isNodeWorker = proxy && proxy->options().kind == WorkerOptions::Kind::Node;

    JSObject* array = constructEmptyArray(globalObject, nullptr, 17);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 0, workerData);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 1, threadId);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 2, JSFunction::create(vm, globalObject, 1, "receiveMessageOnPort"_s, jsReceiveMessageOnPort, ImplementationVisibility::Public, NoIntrinsic));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 3, environmentData);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 4, threadName);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 5, JSFunction::create(vm, globalObject, 1, "isMessagePortActive"_s, jsMessagePortIsActive, ImplementationVisibility::Public, NoIntrinsic));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 6, JSFunction::create(vm, globalObject, 1, "markAsUntransferable"_s, jsFunctionMarkAsUntransferable, ImplementationVisibility::Public, NoIntrinsic));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 7, JSFunction::create(vm, globalObject, 1, "isMarkedAsUntransferable"_s, jsFunctionIsMarkedAsUntransferable, ImplementationVisibility::Public, NoIntrinsic));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 8, JSFunction::create(vm, globalObject, 1, "markAsUncloneable"_s, jsFunctionMarkAsUncloneable, ImplementationVisibility::Public, NoIntrinsic));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 9, JSFunction::create(vm, globalObject, 1, "setEntryEvaluatedHook"_s, jsFunctionSetEntryEvaluatedHook, ImplementationVisibility::Public, NoIntrinsic));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 10, jsBoolean(isNodeWorker));
    RETURN_IF_EXCEPTION(scope, {});
    // A worker that node:worker_threads made: parentPort, and the port to the main thread's postMessageToThread hub.
    array->putDirectIndex(globalObject, 11, parentPort);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 12, hubPort);
    RETURN_IF_EXCEPTION(scope, {});
    // The intrinsic constructors, so worker_threads keeps working when user code
    // replaces globalThis.MessagePort etc. before the module loads (#40268).
    array->putDirectIndex(globalObject, 13, JSMessagePort::getConstructor(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 14, JSMessageChannel::getConstructor(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 15, JSBroadcastChannel::getConstructor(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 16, JSWorker::getConstructor(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return array;
}

JSValue createNodeWorkerConstructor(Zig::GlobalObject* globalObject)
{
    return JSWorker::getConstructor(globalObject->vm(), globalObject);
}

// A node:worker_threads worker loads node:worker_threads before preloads and the entry
// point (it takes the ports of the parent's Worker and rebinds process stdio over them),
// as Node runs its worker bootstrap before user code. Throws like require() would.
extern "C" void Bun__Worker__loadNodeWorkerThreadsModule(Zig::GlobalObject* globalObject)
{
    BUN_LOAD_INTERNAL_MODULE(globalObject, NodeWorkerThreads, "native:Cpp:Worker.cpp:createNodeWorkerConstructor");
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionPostMessage,
    (JSC::JSGlobalObject * leixcalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = leixcalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Zig::GlobalObject* globalObject = dynamicDowncast<Zig::GlobalObject>(leixcalGlobalObject);
    if (!globalObject) [[unlikely]]
        return JSValue::encode(jsUndefined());

    auto* proxy = WebWorker__getMessagingProxy(globalObject->bunVM());
    if (!proxy)
        return JSValue::encode(jsUndefined());

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue options = callFrame->argument(1);

    Vector<JSC::Strong<JSC::JSObject>> transferList;

    // postMessage(message, sequence<object>) and postMessage(message, { transfer })
    // overloads. Both are converted per WebIDL before serializing, so an invalid
    // transfer list throws a TypeError without detaching anything.
    if (!options.isUndefinedOrNull()) {
        bool isSequence = hasIteratorMethod(globalObject, options);
        RETURN_IF_EXCEPTION(scope, {});
        if (isSequence) {
            transferList = convert<IDLSequence<IDLObject>>(*globalObject, options);
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            auto serializeOptions = convertDictionary<StructuredSerializeOptions>(*globalObject, options);
            RETURN_IF_EXCEPTION(scope, {});
            transferList = WTF::move(serializeOptions.transfer);
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(transferList), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    RETURN_IF_EXCEPTION(scope, {});
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, scope, serialized.releaseException());
        RELEASE_AND_RETURN(scope, {});
    }
    RETURN_IF_EXCEPTION(scope, {});

    ExceptionOr<Vector<TransferredMessagePort>> disentangledPorts = MessagePort::disentanglePorts(WTF::move(ports));
    if (disentangledPorts.hasException()) {
        WebCore::propagateException(*globalObject, scope, disentangledPorts.releaseException());
        RELEASE_AND_RETURN(scope, {});
    }
    RETURN_IF_EXCEPTION(scope, {});

    proxy->postMessageToWorkerObject(MessageWithMessagePorts { serialized.releaseReturnValue(), disentangledPorts.releaseReturnValue() });

    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
