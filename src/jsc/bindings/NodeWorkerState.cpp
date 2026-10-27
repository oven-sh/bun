#include "root.h"
#include "NodeWorkerState.h"

#include "AddEventListenerOptions.h"
#include "Event.h"
#include "EventListener.h"
#include "EventNames.h"
#include "InternalModuleRegistry.h"
#include "JSBuffer.h"
#include "JSEventListener.h"
#include "JSMessagePort.h"
#include "MessagePortPipe.h"
#include "ScriptExecutionContext.h"
#include "StructuredSerializeOptions.h"
#include "WebCoreJSBuiltins.h"
#include "Worker.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/DeferTermination.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSMap.h>
#include <wtf/SetForScope.h>
#include <wtf/TZoneMallocInlines.h>

extern "C" void Bun__ConsoleObject__useWorkerStdio(JSC::JSGlobalObject*, bool hasOwnEnv, bool ownEnvNamesForceColor);

namespace Bun {

using namespace JSC;
using namespace WebCore;

WTF_MAKE_TZONE_ALLOCATED_IMPL(NodeWorkerState);

NodeWorkerState::NodeWorkerState() = default;
NodeWorkerState::~NodeWorkerState() = default;

class NodeWorkerPortListener final : public EventListener {
public:
    static Ref<NodeWorkerPortListener> create(NodeWorkerState::NodePort port)
    {
        return adoptRef(*new NodeWorkerPortListener(port));
    }

    bool operator==(const EventListener& other) const final { return this == &other; }

    void handleEvent(ScriptExecutionContext& context, Event& event) final
    {
        auto* globalObject = defaultGlobalObject(context.globalObject());
        auto* state = globalObject ? globalObject->nodeWorkerState() : nullptr;
        if (!state)
            return;
        Ref protectedThis { *this };
        state->didReceiveMessage(*globalObject, m_port, *this, context, event);
    }

private:
    explicit NodeWorkerPortListener(NodeWorkerState::NodePort port)
        : EventListener(NativeEventListenerType)
        , m_port(port)
    {
    }

    const NodeWorkerState::NodePort m_port;
};

void NodeWorkerState::listen(NodePort which, Ref<EventListener>&& listener)
{
    stopListening(which);
    m_listeners[which] = listener.copyRef();
    EventTarget& target = *m_ports[which];
    target.addEventListener(eventNames().messageEvent, WTF::move(listener), {});
}

void NodeWorkerState::stopListening(NodePort which)
{
    if (RefPtr listener = std::exchange(m_listeners[which], nullptr)) {
        EventTarget& target = *m_ports[which];
        target.removeEventListener(eventNames().messageEvent, *listener, {});
    }
}

void NodeWorkerState::takeFromParent(Zig::GlobalObject& globalObject, WorkerOptions& options)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(!globalObject.hasProcessObject());

    // No ends for a worker whose parent context had stopped (JSWorker.cpp): its console and its process.stdout / stderr are the process's, as for a thread that has no parent Worker.
    auto transferred = std::exchange(options.nodePorts, {});
    if (transferred.size() == NodePort::NodePortCount) [[likely]] {
        auto& context = *globalObject.scriptExecutionContext();
        for (unsigned i = 0; i < NodePort::NodePortCount; i++) {
            if (transferred[i].pipe)
                m_ports[i] = MessagePort::entangle(context, WTF::move(transferred[i]));
        }

        // node starts parentPort for the worker. It delivers once the entry has evaluated and a 'message' listener exists.
        auto& parent = *m_ports[NodePort::Parent];
        parent.holdStartUntilEntrySettled();
        parent.start();

        // Unref'd before the listener is added: neither the hub port nor an unread stdin keeps the thread alive.
        auto& hub = *m_ports[NodePort::Hub];
        hub.holdStartUntilEntrySettled();
        hub.jsUnref(&globalObject);
        listen(NodePort::Hub, NodeWorkerPortListener::create(NodePort::Hub));
        if (RefPtr stdinPort = m_ports[NodePort::Stdin]) {
            stdinPort->jsUnref(&globalObject);
            listen(NodePort::Stdin, NodeWorkerPortListener::create(NodePort::Stdin));
        }

        Bun__ConsoleObject__useWorkerStdio(&globalObject, m_hasOwnEnv, m_ownEnvNamesForceColor);
    }

    // Keeps the order of 1.4: an entry's process.nextTick callbacks run after its microtasks. Node does that for an ES module entry and runs them first for a CommonJS one.
    vm.setOnEachMicrotaskTick(nullptr);

    JSMap* environmentData = nullptr;
    JSValue workerData = takeWorkerDataFromParent(globalObject, options, environmentData);
    RETURN_IF_EXCEPTION(scope, );
    if (workerData)
        m_workerData.set(vm, &globalObject, workerData);
    if (environmentData)
        globalObject.setNodeWorkerEnvironmentData(environmentData);
}

void NodeWorkerState::entryDidSettle(Zig::GlobalObject& globalObject)
{
    if (std::exchange(m_entrySettled, true))
        return;

    if (RefPtr parent = m_ports[NodePort::Parent])
        parent->entrySettled();

    RefPtr hub = m_ports[NodePort::Hub];
    if (!hub)
        return;
    hub->entrySettled();
    if (!MessagePortPipe::queuedCount(hub->pipe()->state(hub->side())))
        return;

    // An entry that threw is about to stop the worker, so what postMessageToThread() sent meanwhile is answered on this stack and not by the loop. Not when the worker already asked to stop (an unhandled rejection of the entry): no script runs then, and the sender gets no answer, as in node.
    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    CLEAR_IF_EXCEPTION(scope);
    if (vm.hasPendingTerminationException())
        return;
    hub->deliverQueuedMessages();
    CLEAR_IF_EXCEPTION(scope);
}

void NodeWorkerState::didReceiveMessage(Zig::GlobalObject& globalObject, NodePort which, EventListener& receiver, ScriptExecutionContext& context, Event& event)
{
    RefPtr port = m_ports[which];
    if (which == NodePort::Stdout || which == NodePort::Stderr) {
        // The reader's ack of the message in flight releases what waits.
        auto& queue = m_consoleQueues[which - 1];
        if (!queue.inFlight)
            return;
        queue.removeInFlight();
        if (queue.segments.isEmpty() || !sendConsoleQueue(globalObject, which))
            port->jsUnref(&globalObject);
        return;
    }

    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    {
        // A termination in the middle of the build would leave the port with no reader.
        DeferTerminationForAWhile deferTermination { vm };
        if (which == NodePort::Stdin)
            stdioStream(globalObject, 0);
        else
            globalObject.internalModuleRegistry()->requireId(&globalObject, vm, InternalModuleRegistry::Field::InternalWorkerMessaging);
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (scope.tryClearException())
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(&globalObject, exception);
        return;
    }
    if (m_listeners[which] == &receiver) [[unlikely]]
        return;

    // What was built listens in this object's place, and a listener added during a dispatch does not get the event being dispatched.
    EventListenerVector listeners = port->eventListeners(eventNames().messageEvent);
    for (auto& registered : listeners) {
        if (!registered->wasRemoved())
            registered->callback().handleEvent(context, event);
    }
}

JSValue NodeWorkerState::stdioStream(Zig::GlobalObject& globalObject, unsigned fd)
{
    ASSERT(fd < 3);
    if (auto* stream = m_stdioStreams[fd].get())
        return stream;

    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    RefPtr port = m_ports[fd];
    // The `process` of a worker with no channels has no slot that comes here for fd 1 or 2.
    ASSERT(port || !fd);
    if (fd && !port) [[unlikely]]
        return jsUndefined();
    auto* queue = fd ? &m_consoleQueues[fd - 1] : nullptr;

    // A termination (node:vm's timeout) in the middle would drop what the console has waiting for the stream.
    DeferTerminationForAWhile deferTermination { vm };
    auto* build = JSFunction::create(vm, &globalObject, processObjectInternalsGetNodeWorkerStdioStreamCodeGenerator(vm), &globalObject);
    JSValue portWrapper = port ? toJS(&globalObject, &globalObject, *port) : jsUndefined();
    MarkedArgumentBuffer args;
    args.append(jsNumber(fd));
    args.append(portWrapper);
    // The next ack of the reader is for the message that the console has in flight. The stream waits for it ahead of its first writev.
    args.append(jsBoolean(queue && queue->inFlight));
    // A loop ref that a stream of an earlier build took is not the new stream's. What the new one takes while it is built stays.
    if (!fd && port)
        port->jsUnref(&globalObject);
    JSValue result;
    {
        // A console call from inside the build waits in the queue for the stream. It posts no message: the stream would not know of it, and would take its ack for the ack of a write of its own.
        SetForScope building { m_buildingStream[fd], true };
        result = JSC::profiledCall(&globalObject, ProfilingReason::API, build, JSC::getCallData(build), globalObject.globalThis(), args);
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        // No stream takes what such a call left waiting.
        if (queue && !m_buildingStream[fd] && !queue->inFlight && !queue->segments.isEmpty() && scope.tryClearException()) {
            sendConsoleQueue(globalObject, fd);
            throwException(&globalObject, scope, exception);
        }
        return {};
    }
    // A read of the stream from inside its build made it first. What this build made gets no listener: a write to it is not acked, and a read of it gets no data.
    if (auto* stream = m_stdioStreams[fd].get()) [[unlikely]]
        return stream;

    auto* built = dynamicDowncast<JSArray>(result);
    RELEASE_ASSERT(built && built->length() == 3);
    JSObject* stream = built->getIndexQuickly(0).getObject();
    JSObject* listener = built->getIndexQuickly(1).getObject();
    JSObject* write = built->getIndexQuickly(2).getObject();
    RELEASE_ASSERT(stream && (!port || (listener && listener->isCallable())) && (!fd || (write && write->isCallable())));

    // The stream's listener takes the place of this object's on the port. Native code puts it there, so that the build calls no method of the port: user code can replace those.
    if (port)
        listen(static_cast<NodePort>(fd), JSEventListener::create(*listener, *asObject(portWrapper), false, globalObject.world()));
    m_stdioStreams[fd].set(vm, &globalObject, stream);
    if (!fd)
        return stream;

    // The stream has the loop ref that the console held for a message in flight. Without one, its listener does not hold the loop.
    if (!queue->inFlight)
        port->jsUnref(&globalObject);
    m_stdioFlush[fd - 1].set(vm, &globalObject, listener);
    m_consoleWrite[fd - 1].set(vm, &globalObject, write);

    // What the console wrote behind that message goes through the stream, ahead of what the caller is about to write.
    ConsoleQueue waiting = std::exchange(*queue, {});
    waiting.removeInFlight();
    while (!waiting.segments.isEmpty()) {
        ConsoleSegment segment = waiting.segments.takeFirst();
        for (size_t call = 0; call < segment.ends.size(); call++) {
            writeConsoleToStream(globalObject, write, segment.output(call));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    return stream;
}

JSArray* NodeWorkerState::consoleChunks(Zig::GlobalObject& globalObject, const ConsoleQueue& queue, size_t count)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer chunks;
    for (auto& segment : queue.segments) {
        if (!count--)
            break;
        for (size_t call = 0; call < segment.ends.size(); call++) {
            auto output = segment.output(call);
            auto* chunk = JSUint8Array::createUninitialized(&globalObject, globalObject.typedArrayStructure(TypeUint8, false), output.size());
            RETURN_IF_EXCEPTION(scope, nullptr);
            memcpySpan(chunk->typedSpan(), output);
            chunks.append(chunk);
        }
    }
    if (chunks.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(&globalObject, scope);
        return nullptr;
    }
    RELEASE_AND_RETURN(scope, constructArray(&globalObject, static_cast<ArrayAllocationProfile*>(nullptr), chunks));
}

bool NodeWorkerState::postConsoleSegments(Zig::GlobalObject& globalObject, unsigned fd, size_t count)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    // Nothing here runs script. A termination that lands in it (node:vm's timeout) waits, so the caller knows whether the message left.
    DeferTerminationForAWhile deferTermination { vm };

    // The reader (makePortReadable in internal/worker/stdio) takes an array of chunks.
    bool posted = false;
    JSArray* payload = consoleChunks(globalObject, m_consoleQueues[fd - 1], count);
    if (!scope.exception()) [[likely]] {
        posted = !m_ports[fd]->postMessage(globalObject, payload, {}).hasException();
        (void)scope.exception();
    }
    // Out of memory, or the port is gone: a console call does not throw for that.
    CLEAR_IF_EXCEPTION(scope);
    return posted;
}

void NodeWorkerState::releaseConsoleQueue(Zig::GlobalObject& globalObject, unsigned fd)
{
    auto& queue = m_consoleQueues[fd - 1];
    if (queue.inFlight) {
        queue.removeInFlight();
        m_ports[fd]->jsUnref(&globalObject);
    }
    for (; !queue.segments.isEmpty(); queue.segments.removeFirst())
        postConsoleSegments(globalObject, fd, 1);
}

void NodeWorkerState::writeConsoleToStream(Zig::GlobalObject& globalObject, JSObject* write, std::span<const uint8_t> bytes)
{
    // A string, as the Console of node:console gives the stream.
    MarkedArgumentBuffer args;
    args.append(jsString(globalObject.vm(), String::fromUTF8ReplacingInvalidSequences(bytes)));
    JSC::profiledCall(&globalObject, ProfilingReason::API, write, JSC::getCallData(write), jsUndefined(), args);
}

void NodeWorkerState::writeConsole(Zig::GlobalObject& globalObject, unsigned fd, std::span<const uint8_t> bytes)
{
    ASSERT(fd == 1 || fd == 2);
    if (bytes.empty())
        return;

    if (JSObject* write = m_consoleWrite[fd - 1].get())
        return writeConsoleToStream(globalObject, write, bytes);

    if (!m_ports[fd]) [[unlikely]]
        return;
    auto& queue = m_consoleQueues[fd - 1];
    // Dropped when no segment can hold it, as when a message cannot be posted.
    if (!queue.append(bytes)) [[unlikely]]
        return;
    // A stream that is being built takes what waits. Not at an exit: nothing waits for an ack then.
    if (!queue.inFlight && (!m_buildingStream[fd] || m_isExiting))
        sendConsoleQueue(globalObject, fd);
}

bool NodeWorkerState::sendConsoleQueue(Zig::GlobalObject& globalObject, unsigned fd)
{
    auto& queue = m_consoleQueues[fd - 1];
    ASSERT(!queue.inFlight && !queue.segments.isEmpty());
    // No ack comes at an exit.
    if (m_isExiting) {
        releaseConsoleQueue(globalObject, fd);
        return false;
    }
    size_t count = queue.nextMessageSegments();
    if (!postConsoleSegments(globalObject, fd, count)) {
        queue.clear();
        return false;
    }

    // The port holds the loop while the message is in flight, so what waits behind it is not lost to an idle exit.
    queue.inFlight = count;
    if (!m_listeners[fd])
        listen(static_cast<NodePort>(fd), NodeWorkerPortListener::create(static_cast<NodePort>(fd)));
    m_ports[fd]->jsRef(&globalObject);
    return true;
}

void NodeWorkerState::flushStdioForExit(Zig::GlobalObject& globalObject)
{
    auto& vm = globalObject.vm();
    m_isExiting = true;
    for (unsigned fd = 1; fd <= 2; fd++) {
        if (JSObject* flush = m_stdioFlush[fd - 1].get()) {
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            MarkedArgumentBuffer args;
            JSC::profiledCall(&globalObject, ProfilingReason::API, flush, JSC::getCallData(flush), jsUndefined(), args);
            if (auto* exception = scope.exception()) [[unlikely]] {
                if (!scope.tryClearException())
                    return;
                Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(&globalObject, exception);
            }
            continue;
        }
        if (m_ports[fd])
            releaseConsoleQueue(globalObject, fd);
    }
}

template<typename Visitor>
void NodeWorkerState::visit(Visitor& visitor)
{
    visitor.append(m_workerData);
    visitor.append(m_stdioStreams.begin(), m_stdioStreams.end());
    visitor.append(m_stdioFlush.begin(), m_stdioFlush.end());
    visitor.append(m_consoleWrite.begin(), m_consoleWrite.end());
}

template void NodeWorkerState::visit(JSC::AbstractSlotVisitor&);
template void NodeWorkerState::visit(JSC::SlotVisitor&);

} // namespace Bun

// May leave an exception pending (NodeWorkerState::writeConsole).
extern "C" void Bun__NodeWorker__writeConsole(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t fd, const uint8_t* bytes, size_t length)
{
    // The worker's own global, also for a console call from a ShadowRealm or a node:vm context.
    auto* globalObject = defaultGlobalObject(JSC::getVM(lexicalGlobalObject));
    if (auto* nodeWorker = globalObject->nodeWorkerState())
        nodeWorker->writeConsole(*globalObject, fd, { bytes, length });
}
