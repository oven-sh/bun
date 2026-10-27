#pragma once

#include "root.h"
#include "MessagePort.h"
#include "WorkerOptions.h"
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Deque.h>
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
    // The output of consecutive console calls. The reader gets a chunk for each call.
    struct ConsoleSegment {
        // A segment of this weight takes no further call: it holds about a megabyte of output or 16,000 calls, and one call more. A call weighs its bytes and `callWeight` for the chunk that it becomes.
        static constexpr size_t fullWeight = 1024 * 1024;
        static constexpr size_t callWeight = 64;

        Vector<uint8_t> bytes;
        // `ends[i]` is where the output of call `i` ends in `bytes`.
        Vector<size_t> ends;

        size_t weight() const { return bytes.size() + ends.size() * callWeight; }
        std::span<const uint8_t> output(size_t call) const
        {
            size_t begin = call ? ends[call - 1] : 0;
            return bytes.subspan(begin, ends[call] - begin);
        }
    };

    // One message to the reader takes segments up to this weight, and one segment at least. That is far below what a Vector and the serializer hold. Short of it, an ack releases all that waits, as the writev of a stream does.
    static constexpr size_t maxConsoleMessageWeight = 256 * ConsoleSegment::fullWeight;

    // The flow control of internal/worker/stdio: one message is in flight, and what is written meanwhile waits for the reader's ack. As the Writable of a stream, the queue holds what waits without a limit.
    struct ConsoleQueue {
        // What the reader has yet to ack: the first `inFlight` segments are the message in flight, the others wait.
        Deque<ConsoleSegment> segments;
        size_t inFlight { 0 };

        // Adds the output of one console call to the last segment that waits, or to a new one. False for output that a Vector cannot hold.
        bool append(std::span<const uint8_t> callOutput)
        {
            if (segments.size() == inFlight || segments.last().weight() >= ConsoleSegment::fullWeight)
                segments.append(ConsoleSegment {});
            auto& segment = segments.last();
            if (segment.bytes.tryAppend(callOutput)) [[likely]] {
                if (segment.ends.tryAppend(segment.bytes.size())) [[likely]]
                    return true;
                segment.bytes.shrink(segment.bytes.size() - callOutput.size());
            }
            if (segment.ends.isEmpty())
                segments.removeLast();
            return false;
        }
        void removeInFlight()
        {
            for (; inFlight; inFlight--)
                segments.removeFirst();
        }
        // How many of its first segments the next message takes.
        size_t nextMessageSegments() const
        {
            size_t count = 0;
            size_t weight = 0;
            for (auto& segment : segments) {
                weight += segment.weight();
                if (count && weight > maxConsoleMessageWeight)
                    break;
                count++;
            }
            return count;
        }
        void clear()
        {
            segments.clear();
            inFlight = 0;
        }
    };

    void stopListening(NodePort);
    // The output of each call of the queue's first `count` segments, as an array with a Uint8Array for each. Null with an exception pending.
    JSC::JSArray* consoleChunks(Zig::GlobalObject&, const ConsoleQueue&, size_t count);
    // Posts the queue's first `count` segments as one message. Whether that is with the port. Leaves no exception pending.
    bool postConsoleSegments(Zig::GlobalObject&, unsigned fd, size_t count);
    // For a queue that has no message in flight: posts what waits as the message in flight. At an exit, as releaseConsoleQueue. False when nothing is in flight afterwards.
    bool sendConsoleQueue(Zig::GlobalObject&, unsigned fd);
    // Posts what waits for an ack without one, a message for each segment, and stops waiting.
    void releaseConsoleQueue(Zig::GlobalObject&, unsigned fd);
    void writeConsoleToStream(Zig::GlobalObject&, JSC::JSObject* write, std::span<const uint8_t>);

    std::array<RefPtr<WebCore::MessagePort>, NodePort::NodePortCount> m_ports;
    // What listens on a port for this object: its own listener until the worker builds what reads the port, then the listener of what was built (of the stream on a stdio port, of internal/worker/messaging on the hub port).
    std::array<RefPtr<WebCore::EventListener>, NodePort::NodePortCount> m_listeners;
    std::array<ConsoleQueue, 2> m_consoleQueues;
    // By fd: the build of that stream is on the stack. The console reads it for stdout and stderr.
    std::array<bool, 3> m_buildingStream {};
    bool m_entrySettled { false };
    bool m_isExiting { false };
    bool m_hasOwnEnv { false };
    bool m_envNamesIpcChannel { false };
    bool m_ownEnvNamesForceColor { false };

    JSC::WriteBarrier<JSC::Unknown> m_workerData;
    std::array<JSC::WriteBarrier<JSC::JSObject>, 3> m_stdioStreams;
    // Of process.stdout and stderr (internal/worker/stdio): the stream's listener on the port, which completes the batch in flight also without the reader's ack, and what writes console output to the stream.
    std::array<JSC::WriteBarrier<JSC::JSObject>, 2> m_stdioFlush;
    std::array<JSC::WriteBarrier<JSC::JSObject>, 2> m_consoleWrite;
};

} // namespace Bun
