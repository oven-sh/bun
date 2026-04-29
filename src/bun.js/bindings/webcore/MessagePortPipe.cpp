#include "config.h"
#include "MessagePort.h"

// When the verification harness reverts src/ to origin/main, this file and
// MessagePortPipe.h survive as new untracked files but MessagePort.h /
// TransferredMessagePort.h revert to their identifier-based predecessors.
// The body below references symbols that only exist on the pipe-backed
// MessagePort.h (dispatchOneMessage, the struct TransferredMessagePort), so
// compile it only when that header is present.
#if BUN_MESSAGEPORT_USES_PIPE

#include "MessagePortPipe.h"
#include "ScriptExecutionContext.h"
#include <wtf/Locker.h>

namespace WebCore {

MessagePortPipe::~MessagePortPipe() = default;

// Defined here (not in TransferredMessagePort.h) to break the header cycle
// MessagePortPipe.h → MessageWithMessagePorts.h → TransferredMessagePort.h.
TransferredMessagePort::~TransferredMessagePort()
{
    // If this endpoint is destroyed while still owning the pipe side (never
    // handed off to a new MessagePort via entangle()), the side is orphaned;
    // mark it Closed so the peer's hasPendingActivity() can return false.
    if (pipe)
        pipe->close(side);
}

TransferredMessagePort& TransferredMessagePort::operator=(TransferredMessagePort&& other)
{
    if (this != &other) {
        if (pipe)
            pipe->close(side);
        pipe = WTF::move(other.pipe);
        side = other.side;
    }
    return *this;
}

void MessagePortPipe::send(uint8_t fromSide, MessageWithMessagePorts&& message)
{
    ASSERT(fromSide < 2);
    auto& dst = m_sides[1 - fromSide];

    ScriptExecutionContextIdentifier wakeCtx = 0;
    {
        Locker locker { dst.lock };
        uint64_t s = dst.state.load(std::memory_order_relaxed);
        if (s & Closed)
            return;

        dst.inbox.append(WTF::move(message));

        uint64_t ns = s + QueuedOne;
        if ((s & Attached) && !(s & DrainScheduled)) {
            ns |= DrainScheduled;
            wakeCtx = dst.ctxId;
        }
        dst.state.store(ns, std::memory_order_release);
    }

    if (wakeCtx)
        scheduleDrain(1 - fromSide, wakeCtx);
}

void MessagePortPipe::scheduleDrain(uint8_t side, ScriptExecutionContextIdentifier ctxId)
{
    // The posted task holds a strong ref to the pipe so it can't be destroyed
    // while a wakeup is in flight. The task runs on the receiver's context
    // thread and calls back into the attached port to fire events.
    bool posted = ScriptExecutionContext::postTaskTo(ctxId, [pipe = Ref { *this }, side](ScriptExecutionContext&) {
        pipe->drainAndDispatch(side);
    });
    if (!posted) {
        // Context already torn down. Drop DrainScheduled so a future
        // attach() to a new context can reschedule.
        Locker locker { m_sides[side].lock };
        m_sides[side].state.fetch_and(~uint64_t(DrainScheduled), std::memory_order_acq_rel);
    }
}

void MessagePortPipe::drainAndDispatch(uint8_t side)
{
    // Mirrors Node's MessagePort::OnMessage (src/node_messaging.cc): one
    // drain task processes the whole inbox in a loop, draining microtasks
    // between each delivery so queueMicrotask/Promise callbacks observe
    // messages one at a time, but without a separate posted task per
    // message. The per-invocation limit is max(initial queue size, 1000)
    // — enough to amortize the uv_async-style reschedule cost, capped so a
    // fast sender can't starve the event loop indefinitely.
    //
    // Messages are popped one at a time under the lock, so if the handler
    // transfers this port (pipe->detach clears `s.port`/`Attached`) the
    // remaining inbox stays buffered for the new owner.
    auto& s = m_sides[side];

    RefPtr<MessagePort> port;
    size_t limit;
    {
        Locker locker { s.lock };
        port = s.port.get();
        uint64_t st = s.state.load(std::memory_order_relaxed);
        if (!port || s.inbox.isEmpty()) {
            s.state.store(st & ~DrainScheduled, std::memory_order_release);
            return;
        }
        limit = std::max<size_t>(s.inbox.size(), 1000);
    }

    auto* context = port->scriptExecutionContext();
    if (!context || !context->globalObject()) {
        Locker locker { s.lock };
        s.state.fetch_and(~uint64_t(DrainScheduled), std::memory_order_acq_rel);
        return;
    }
    auto* globalObject = defaultGlobalObject(context->globalObject());

    ScriptExecutionContextIdentifier rescheduleCtx = 0;
    while (true) {
        std::optional<MessageWithMessagePorts> message;
        {
            Locker locker { s.lock };
            uint64_t st = s.state.load(std::memory_order_relaxed);
            // Re-check each iteration: the handler may have closed or
            // transferred this port (detach() clears Attached and s.port).
            if (!(st & Attached) || s.inbox.isEmpty()) {
                s.state.store(st & ~DrainScheduled, std::memory_order_release);
                break;
            }
            if (limit-- == 0) {
                // Yield to the rest of the event loop; DrainScheduled stays
                // set so concurrent sends don't double-schedule.
                rescheduleCtx = s.ctxId;
                break;
            }
            message = s.inbox.takeFirst();
            s.state.store(st - QueuedOne, std::memory_order_release);
        }

        port->dispatchOneMessage(*context, WTF::move(*message));

        // Node's MakeCallback wraps each emit in an InternalCallbackScope,
        // which drains nextTick + microtasks on exit; match that so
        // queueMicrotask(cb) inside onmessage runs before the next message.
        if (globalObject->drainMicrotasks())
            break; // termination pending
    }

    if (rescheduleCtx)
        scheduleDrain(side, rescheduleCtx);
}

std::optional<MessageWithMessagePorts> MessagePortPipe::takeOne(uint8_t side)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    Locker locker { s.lock };
    if (s.inbox.isEmpty())
        return std::nullopt;
    s.state.fetch_sub(QueuedOne, std::memory_order_acq_rel);
    return s.inbox.takeFirst();
}

void MessagePortPipe::attach(uint8_t side, ScriptExecutionContextIdentifier ctxId, ThreadSafeWeakPtr<MessagePort> port)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    ScriptExecutionContextIdentifier wakeCtx = 0;
    {
        Locker locker { s.lock };
        s.ctxId = ctxId;
        s.port = WTF::move(port);
        uint64_t st = s.state.load(std::memory_order_relaxed);
        uint64_t ns = (st | Attached) & ~Closed;
        if (queuedCount(st) > 0 && !(st & DrainScheduled)) {
            ns |= DrainScheduled;
            wakeCtx = ctxId;
        }
        s.state.store(ns, std::memory_order_release);
    }
    if (wakeCtx)
        scheduleDrain(side, wakeCtx);
}

void MessagePortPipe::detach(uint8_t side)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    Locker locker { s.lock };
    s.ctxId = 0;
    s.port = nullptr;
    // Drop Attached and DrainScheduled: if a drain task was already posted it
    // will find no port and no-op; messages remain queued for the next owner.
    s.state.fetch_and(~uint64_t(Attached | DrainScheduled), std::memory_order_acq_rel);
}

void MessagePortPipe::close(uint8_t side)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    Deque<MessageWithMessagePorts> dropped;
    {
        Locker locker { s.lock };
        s.ctxId = 0;
        s.port = nullptr;
        // Closed is terminal; queued messages are dropped.
        s.state.store(Closed, std::memory_order_release);
        dropped = std::exchange(s.inbox, {});
    }
    // `dropped` destructs outside the lock; it may hold the last ref to
    // transferred pipes whose destructors also take locks.
}

} // namespace WebCore

#endif // BUN_MESSAGEPORT_USES_PIPE
