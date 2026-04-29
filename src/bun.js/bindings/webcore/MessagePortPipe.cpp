#include "config.h"
#include "MessagePortPipe.h"

#include "MessagePort.h"
#include "ScriptExecutionContext.h"
#include <wtf/Locker.h>

namespace WebCore {

MessagePortPipe::~MessagePortPipe() = default;

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
    ScriptExecutionContext::postTaskTo(ctxId, [pipe = Ref { *this }, side](ScriptExecutionContext&) {
        pipe->drainAndDispatch(side);
    });
}

void MessagePortPipe::drainAndDispatch(uint8_t side)
{
    RefPtr<MessagePort> port;
    {
        Locker locker { m_sides[side].lock };
        port = m_sides[side].port.get();
    }
    // If the port was detached or collected between scheduling and now, the
    // messages stay buffered; the next attach() will reschedule.
    if (port)
        port->drainAndDispatch();
}

Deque<MessageWithMessagePorts> MessagePortPipe::takeAll(uint8_t side)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    Locker locker { s.lock };
    // Clear DrainScheduled (and queued count) *before* handing the messages
    // back. Because the lock is held, a concurrent send() can't interleave;
    // it will observe DrainScheduled=0 on its next attempt and reschedule.
    uint64_t ns = s.state.load(std::memory_order_relaxed);
    ns &= (Closed | Attached); // preserve only these; drop DrainScheduled + count.
    s.state.store(ns, std::memory_order_release);
    return std::exchange(s.inbox, {});
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
