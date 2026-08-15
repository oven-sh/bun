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

#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include "JSWorker.h"
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
    m_stdioSink[0].clear();
    m_stdioSink[1].clear();
}

void Worker::setStdioSink(JSC::VM& vm, int fd, JSC::JSObject* sink, bool captureOnly)
{
    ASSERT(fd == 1 || fd == 2);
    if (sink)
        m_stdioSink[fd - 1].set(vm, sink);
    else
        m_stdioSink[fd - 1].clear();
    m_stdioCaptureOnly[fd - 1] = sink && captureOnly;
}

extern "C" void Bun__VirtualMachine__writeStdio(void* bunVM, int fd, const uint8_t* bytes, size_t length);

void Worker::deliverStdio(ScriptExecutionContext& context, int fd, std::span<const uint8_t> bytes, bool wantsAck)
{
    ASSERT(fd == 1 || fd == 2);
    auto* globalObject = defaultGlobalObject(context.globalObject());
    JSC::JSObject* sink = m_stdioSink[fd - 1].get();
    if (sink) {
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto reportUnlessTerminating = [&](JSC::Exception* exception) {
            if (vm.isTerminationException(exception))
                return;
            (void)scope.tryClearException();
            globalObject->reportUncaughtExceptionAtEventLoop(globalObject, exception);
        };
        JSC::MarkedArgumentBuffer args;
        if (bytes.empty())
            args.append(JSC::jsNull());
        else {
            auto* chunk = JSC::JSUint8Array::create(globalObject, globalObject->JSBufferSubclassStructure(), bytes.size());
            if (auto* exception = scope.exception()) [[unlikely]] {
                reportUnlessTerminating(exception);
                return;
            }
            memcpySpan(chunk->typedSpan(), bytes);
            args.append(chunk);
        }
        JSC::call(globalObject, sink, JSC::getCallData(sink), JSC::jsUndefined(), args);
        if (auto* exception = scope.exception()) [[unlikely]] {
            reportUnlessTerminating(exception);
            return;
        }
        // The stream's _read() acks as it wants more.
        if (m_stdioCaptureOnly[fd - 1])
            return;
    }
    if (!bytes.empty())
        Bun__VirtualMachine__writeStdio(globalObject->bunVM(), fd, bytes.data(), bytes.size());
    if (!sink && wantsAck)
        ackStdio(fd);
}

void Worker::ackStdio(int fd)
{
    m_contextProxy->postTaskToWorkerGlobalScope([fd](ScriptExecutionContext& context) {
        auto* globalObject = defaultGlobalObject(context.globalObject());
        JSC::JSObject* handler = globalObject->nodeWorkerStdioAckHandler();
        if (!handler)
            return;
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (scope.exception()) [[unlikely]]
            return; // the worker is being stopped
        JSC::MarkedArgumentBuffer args;
        args.append(JSC::jsNumber(fd));
        JSC::call(globalObject, handler, JSC::getCallData(handler), JSC::jsUndefined(), args);
        if (auto* exception = scope.exception(); exception && !vm.isTerminationException(exception)) [[unlikely]] {
            (void)scope.tryClearException();
            globalObject->reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
    });
}

// ---- Worker-thread side: hooks the native thread object calls, and the script-facing functions that
//      run inside a worker (parentPort.postMessage, workerData, receiveMessageOnPort, ...).

// The proxy of the worker whose global scope runs on `bunVM`'s thread, or null on the main thread.
extern "C" WorkerMessagingProxy* WebWorker__getMessagingProxy(void* bunVM);

// The entry module just finished (or failed) its top-level evaluation. Flush the worker_threads
// hub's deferred cross-thread deliveries: node's bootstrap runs the synchronous CJS main before any
// port delivery, so a routed message must not observe "no listeners" while the entry that registers
// them is still loading. Runs on every post-evaluation path so a buffered postMessageToThread never
// leaves its sender's Atomics.waitAsync unresolved.
extern "C" void WebWorker__entrySettled(Zig::GlobalObject* globalObject)
{
    // parentPort starts delivering now (whatever the parent posted meanwhile is buffered in the pipe).
    globalObject->nodeWorkerEntryDidSettle();
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

// An uncaught error inside the worker: dispatch 'error' on the worker's own global scope, then report
// it to the Worker object.
extern "C" void WebWorker__dispatchError(Zig::GlobalObject* globalObject, WorkerMessagingProxy* proxy, BunString* message, JSC::EncodedJSValue errorValue)
{
    JSC::JSValue error = JSC::JSValue::decode(errorValue);
    String messageStr = message->transferToWTFString();
    ErrorEvent::Init init;
    init.message = messageStr;
    init.error = error;
    init.cancelable = false;
    init.bubbles = false;
    globalObject->globalEventScope->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
    proxy->postErrorToWorkerObject(*globalObject, messageStr, error);
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionSetParentPort);
JSC_DECLARE_HOST_FUNCTION(jsFunctionSetStdioSink);
JSC_DECLARE_HOST_FUNCTION(jsFunctionWorkerStdioWrite);
JSC_DECLARE_HOST_FUNCTION(jsFunctionSetStdioAckHandler);
JSC_DECLARE_HOST_FUNCTION(jsFunctionStdioAck);
JSC_DECLARE_HOST_FUNCTION(jsFunctionRefEventLoop);
JSC_DECLARE_HOST_FUNCTION(jsFunctionSetStdioDiverted);

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
        result->putDirect(vm, JSC::Identifier::fromString(vm, "message"_s), message);
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

// markAsUncloneable/markAsUntransferable tag objects with a DontEnum JSC private name
// (node uses a v8 Private): invisible to and unforgeable from user JS, and not removable,
// so marking cannot be undone. Primitives are a documented no-op.
static void markObjectWithPrivateName(JSC::VM& vm, JSC::JSValue value, const JSC::Identifier& privateName)
{
    JSC::JSObject* object = value.getObject();
    if (!object || object->getDirect(vm, privateName))
        return;
    object->putDirect(vm, privateName, JSC::jsBoolean(true), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | 0);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionMarkAsUncloneable, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    markObjectWithPrivateName(vm, callFrame->argument(0), builtinNames(vm).isUncloneablePrivateName());
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionMarkAsUntransferable, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    markObjectWithPrivateName(vm, callFrame->argument(0), builtinNames(vm).isUntransferablePrivateName());
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
    JSMap* environmentData = nullptr;

    auto* proxy = WebWorker__getMessagingProxy(globalObject->bunVM());
    if (proxy) {
        auto& options = proxy->options();
        auto ports = MessagePort::entanglePorts(*globalObject->scriptExecutionContext(), WTF::move(options.dataMessagePorts));
        RefPtr<WebCore::SerializedScriptValue> serialized = WTF::move(options.workerDataAndEnvironmentData);
        // `workerDataAndEnvironmentData` is moved-from on the first call. If
        // this binding is created twice (lazy-init re-entry), `serialized` is
        // null and `->deserialize` would UB → garbage → SIGTRAP at the
        // uncheckedDowncast below (#53748 darwin). Guard both: skip the
        // deserialize on second call (workerData stays jsUndefined), and use a
        // checked cast so a non-Array deserialize result doesn't trap.
        if (serialized) {
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

    JSObject* array = constructEmptyArray(globalObject, nullptr, 18);
    RETURN_IF_EXCEPTION(scope, {});
    array->putDirectIndex(globalObject, 0, workerData);
    array->putDirectIndex(globalObject, 1, threadId);
    array->putDirectIndex(globalObject, 2, JSFunction::create(vm, globalObject, 1, "receiveMessageOnPort"_s, jsReceiveMessageOnPort, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 3, environmentData);
    array->putDirectIndex(globalObject, 4, threadName);
    array->putDirectIndex(globalObject, 5, JSFunction::create(vm, globalObject, 1, "isMessagePortActive"_s, jsMessagePortIsActive, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 6, JSFunction::create(vm, globalObject, 1, "markAsUntransferable"_s, jsFunctionMarkAsUntransferable, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 7, JSFunction::create(vm, globalObject, 1, "isMarkedAsUntransferable"_s, jsFunctionIsMarkedAsUntransferable, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 8, JSFunction::create(vm, globalObject, 1, "markAsUncloneable"_s, jsFunctionMarkAsUncloneable, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 9, JSFunction::create(vm, globalObject, 1, "setEntryEvaluatedHook"_s, jsFunctionSetEntryEvaluatedHook, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 10, jsBoolean(isNodeWorker));
    array->putDirectIndex(globalObject, 11, JSFunction::create(vm, globalObject, 1, "setParentPort"_s, jsFunctionSetParentPort, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 12, JSFunction::create(vm, globalObject, 4, "setStdioSink"_s, jsFunctionSetStdioSink, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 13, JSFunction::create(vm, globalObject, 3, "workerStdioWrite"_s, jsFunctionWorkerStdioWrite, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 14, JSFunction::create(vm, globalObject, 1, "setStdioAckHandler"_s, jsFunctionSetStdioAckHandler, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 15, JSFunction::create(vm, globalObject, 2, "stdioAck"_s, jsFunctionStdioAck, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 16, JSFunction::create(vm, globalObject, 1, "refEventLoop"_s, jsFunctionRefEventLoop, ImplementationVisibility::Public, NoIntrinsic));
    array->putDirectIndex(globalObject, 17, JSFunction::create(vm, globalObject, 2, "setStdioDiverted"_s, jsFunctionSetStdioDiverted, ImplementationVisibility::Public, NoIntrinsic));
    return array;
}

// worker_threads (worker side): register the transferred port as this thread's parentPort.
JSC_DEFINE_HOST_FUNCTION(jsFunctionSetParentPort, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* port = dynamicDowncast<JSMessagePort>(callFrame->argument(0));
    if (!port)
        return JSValue::encode(jsUndefined());
    globalObject->setNodeParentPort(&port->wrapped());
    return JSValue::encode(jsUndefined());
}

// Parent side: worker_threads' Worker installs the function that feeds worker.stdout / worker.stderr.
// setStdioSink(webWorker, fd, sink | undefined, captureOnly)
JSC_DEFINE_HOST_FUNCTION(jsFunctionSetStdioSink, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* worker = dynamicDowncast<JSWorker>(callFrame->argument(0));
    JSValue fdValue = callFrame->argument(1);
    int fd = fdValue.isInt32() ? fdValue.asInt32() : 0;
    if (!worker || (fd != 1 && fd != 2))
        return JSValue::encode(jsUndefined());
    JSValue sink = callFrame->argument(2);
    worker->wrapped().setStdioSink(vm, fd, sink.isCallable() ? sink.getObject() : nullptr, callFrame->argument(3).toBoolean(lexicalGlobalObject));
    return JSValue::encode(jsUndefined());
}

// Worker side: process.stdout / process.stderr writes travel the same way console output does; null ends
// that stream on the parent; wantsAck asks the parent to ack once it has taken it (the last chunk of a batch).
// Returns whether an ack will come. workerStdioWrite(fd, chunk: Uint8Array | null, wantsAck)
JSC_DEFINE_HOST_FUNCTION(jsFunctionWorkerStdioWrite, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue fdValue = callFrame->argument(0);
    int fd = fdValue.isInt32() ? fdValue.asInt32() : 0;
    auto* chunk = dynamicDowncast<JSC::JSUint8Array>(callFrame->argument(1));
    bool endOfStream = callFrame->argument(1).isNull();
    if ((!chunk && !endOfStream) || (fd != 1 && fd != 2))
        return JSValue::encode(jsBoolean(false));
    std::span<const uint8_t> bytes = chunk ? chunk->span() : std::span<const uint8_t> {};
    if (bytes.empty() && !endOfStream)
        return JSValue::encode(jsBoolean(false));
    bool wantsAck = callFrame->argument(2).toBoolean(lexicalGlobalObject);
    if (auto* proxy = WebWorker__getMessagingProxy(globalObject->bunVM()); proxy && proxy->options().kind == WorkerOptions::Kind::Node) {
        proxy->postStdioToWorkerObject(fd, bytes, wantsAck, endOfStream);
        return JSValue::encode(jsBoolean(wantsAck));
    }
    if (chunk)
        Bun__VirtualMachine__writeStdio(globalObject->bunVM(), fd, bytes.data(), bytes.size());
    return JSValue::encode(jsBoolean(false));
}

// Worker side: the function told when the parent has taken a stream's pending writes. setStdioAckHandler(fn)
JSC_DEFINE_HOST_FUNCTION(jsFunctionSetStdioAckHandler, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSValue handler = callFrame->argument(0);
    defaultGlobalObject(lexicalGlobalObject)->setNodeWorkerStdioAckHandler(handler.isCallable() ? handler.getObject() : nullptr);
    return JSValue::encode(jsUndefined());
}

// Parent side: worker.stdout / worker.stderr wants more. stdioAck(webWorker, fd)
JSC_DEFINE_HOST_FUNCTION(jsFunctionStdioAck, (JSGlobalObject*, CallFrame* callFrame))
{
    auto* worker = dynamicDowncast<JSWorker>(callFrame->argument(0));
    JSValue fdValue = callFrame->argument(1);
    int fd = fdValue.isInt32() ? fdValue.asInt32() : 0;
    if (worker && (fd == 1 || fd == 2))
        worker->wrapped().ackStdio(fd);
    return JSValue::encode(jsUndefined());
}

extern "C" void Bun__eventLoop__refKeepAlive(void* bunVM, int delta);

// Worker side: its process.stdout / stderr stream has writes queued (or no longer has). setStdioDiverted(fd, on)
JSC_DEFINE_HOST_FUNCTION(jsFunctionSetStdioDiverted, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSValue fdValue = callFrame->argument(0);
    int fd = fdValue.isInt32() ? fdValue.asInt32() : 0;
    if (auto* proxy = WebWorker__getMessagingProxy(defaultGlobalObject(lexicalGlobalObject)->bunVM()); proxy && (fd == 1 || fd == 2))
        proxy->setStdioDiverted(fd, callFrame->argument(1).toBoolean(lexicalGlobalObject));
    return JSValue::encode(jsUndefined());
}

// Worker side: keep the thread alive while a write's completion is outstanding. refEventLoop(+1 | -1)
JSC_DEFINE_HOST_FUNCTION(jsFunctionRefEventLoop, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    JSValue delta = callFrame->argument(0);
    if (delta.isInt32() && delta.asInt32())
        Bun__eventLoop__refKeepAlive(defaultGlobalObject(lexicalGlobalObject)->bunVM(), delta.asInt32() > 0 ? 1 : -1);
    return JSValue::encode(jsUndefined());
}

// Runs node's per-thread bootstrap (internal/worker/bootstrap) in a node:worker_threads worker
// before its preloads and entry point. False with the exception pending if it threw.
extern "C" bool WebWorker__bootstrapNodeWorker(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::Field::InternalWorkerBootstrap);
    return !scope.exception();
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
