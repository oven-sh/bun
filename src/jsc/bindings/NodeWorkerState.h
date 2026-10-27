#pragma once

#include "root.h"
#include "MessagePort.h"
#include "WorkerOptions.h"
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/TZoneMalloc.h>

namespace Zig {
class GlobalObject;
}

namespace WebCore {
class Event;
class EventListener;
}

namespace Bun {

// The worker side of a node:worker_threads Worker: what its parent sent, and the stdio that the worker builds over it on first use. Only the default global of such a worker has one.
class NodeWorkerState {
    WTF_MAKE_TZONE_ALLOCATED(NodeWorkerState);
    WTF_MAKE_NONCOPYABLE(NodeWorkerState);

public:
    using NodePort = WebCore::WorkerOptions::NodePort;

    NodeWorkerState();
    ~NodeWorkerState();

    // The worker's start sequence, before preloads and the entry point. It evaluates no builtin module. Throws what deserializing workerData throws.
    void takeFromParent(Zig::GlobalObject&, WebCore::WorkerOptions&);
    void entryDidSettle(Zig::GlobalObject&);

    WebCore::MessagePort* port(NodePort which) const { return m_ports[which].get(); }
    JSC::JSValue workerData() const { return m_workerData.get(); }

    // What an env that `new Worker` copied or shares names when the worker starts. A worker that inherits the process's env does not call this.
    void setOwnEnvAtStart(bool namesIpcChannel, bool namesForceColor)
    {
        m_hasOwnEnv = true;
        m_envNamesIpcChannel = namesIpcChannel;
        m_ownEnvNamesForceColor = namesForceColor;
    }
    // Node then disables the IPC surface of `process`. An inherited env has no NODE_CHANNEL_FD: the env loader takes none from the process's environment (is_ipc_channel_key).
    bool envNamesIpcChannel() const { return m_envNamesIpcChannel; }

    // process.stdin (0), stdout (1) or stderr (2). A build that throws is not remembered: the next call builds again.
    JSC::JSValue stdioStream(Zig::GlobalObject&, unsigned fd);
    // One console call's output for fd 1 or 2, as UTF-8. It goes through process.stdout / stderr once the worker has built that, and from here to the same port until then. Throws only what that stream's writer lets through (a stack overflow).
    void writeConsole(Zig::GlobalObject&, unsigned fd, std::span<const uint8_t>);
    // node's flushSync: a synchronous exit leaves no loop turn for the parent's ack, so what waits for one is posted now.
    void flushStdioForExit(Zig::GlobalObject&);

    // `listener` takes the place of what listens on the port for this object.
    void listen(NodePort, Ref<WebCore::EventListener>&& listener);
    void didReceiveMessage(Zig::GlobalObject&, NodePort, WebCore::EventListener& receiver, WebCore::ScriptExecutionContext&, WebCore::Event&);

    template<typename Visitor> void visit(Visitor&);

private:
    // The flow control of internal/worker/stdio: one batch is in flight, and what is written meanwhile waits for the reader's ack.
    struct ConsoleQueue {
        // The output of the console calls that the reader has yet to ack: of the batch in flight (the first `inFlight` calls), then of what waits behind it. `ends[i]` is where the output of call `i` ends: the reader gets one chunk for each call.
        Vector<uint8_t> bytes;
        Vector<size_t> ends;
        size_t inFlight { 0 };

        std::span<const uint8_t> output(size_t call) const
        {
            size_t begin = call ? ends[call - 1] : 0;
            return bytes.subspan(begin, ends[call] - begin);
        }
        void clear()
        {
            bytes.clear();
            ends.clear();
            inFlight = 0;
        }
    };

    void stopListening(NodePort);
    // The output of the calls from `first` up to `end`, as an array with a Uint8Array for each. Null with an exception pending.
    JSC::JSArray* consoleChunks(Zig::GlobalObject&, const ConsoleQueue&, size_t first, size_t end);
    // Posts what the queue holds from call `first` on. Whether the batch is with the port. Leaves no exception pending.
    bool postConsoleOutput(Zig::GlobalObject&, unsigned fd, size_t first);
    // Posts what waits for an ack without one, and stops waiting.
    void releaseConsoleQueue(Zig::GlobalObject&, unsigned fd);
    void writeConsoleToStream(Zig::GlobalObject&, JSC::JSObject* write, std::span<const uint8_t>);

    std::array<RefPtr<WebCore::MessagePort>, NodePort::NodePortCount> m_ports;
    // What listens on a port for this object: its own listener until the worker builds what reads the port, and on the hub port then the listener of internal/worker/messaging.
    std::array<RefPtr<WebCore::EventListener>, NodePort::NodePortCount> m_listeners;
    std::array<ConsoleQueue, 2> m_consoleQueues;
    bool m_entrySettled { false };
    bool m_isExiting { false };
    bool m_hasOwnEnv { false };
    bool m_envNamesIpcChannel { false };
    bool m_ownEnvNamesForceColor { false };

    JSC::WriteBarrier<JSC::Unknown> m_workerData;
    std::array<JSC::WriteBarrier<JSC::JSObject>, 3> m_stdioStreams;
    // Of process.stdout and stderr (internal/worker/stdio): what completes the batch in flight without the reader's ack, and what writes console output to the stream.
    std::array<JSC::WriteBarrier<JSC::JSObject>, 2> m_stdioFlush;
    std::array<JSC::WriteBarrier<JSC::JSObject>, 2> m_consoleWrite;
};

} // namespace Bun
