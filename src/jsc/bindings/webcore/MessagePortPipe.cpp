#include "config.h"
#include "MessagePort.h"
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
        pipe->close(side, MessagePortPipe::CloseKind::Explicit);
}

void MessagePortPipe::send(uint8_t fromSide, MessageWithMessagePorts&& message)
{
    ASSERT(fromSide < 2);
    auto& dst = m_sides[1 - fromSide];

    ScriptExecutionContextIdentifier wakeCtx = 0;
    BunLoopKind wakeLoopKind = BunLoopKind::Regular;
    {
        Locker locker { dst.lock };
        uint64_t s = dst.state.load(std::memory_order_relaxed);
        if (s & Closed)
            return;
        // What orders a side's close behind its messages: once closed, it never sends.
        ASSERT(!(s & PeerClosed));

        dst.inbox.append(WTF::move(message));

        uint64_t ns = s + QueuedOne;
        if ((s & Attached) && !(s & DrainScheduled)) {
            ns |= DrainScheduled;
            wakeCtx = dst.ctxId;
            wakeLoopKind = dst.ctxLoopKind;
        }
        dst.state.store(ns, std::memory_order_release);
    }

    if (wakeCtx)
        scheduleDrain(1 - fromSide, wakeCtx, wakeLoopKind, false);
}

void MessagePortPipe::scheduleDrain(uint8_t side, ScriptExecutionContextIdentifier ctxId, BunLoopKind ctxLoopKind, bool closeTurn)
{
    // The posted task holds a strong ref to the pipe so it can't be destroyed
    // while a wakeup is in flight. The task captures the ctxId it was posted
    // to so drainAndDispatch can detect if the side moved to a different
    // context before the task ran.
    bool posted = ScriptExecutionContext::postTaskTo(ctxId, ctxLoopKind, [pipe = Ref { *this }, side, ctxId, closeTurn](ScriptExecutionContext&) {
        pipe->drainAndDispatch(side, ctxId, closeTurn);
    });
    if (!posted) {
        // Context already torn down. Drop DrainScheduled so a future
        // attach() to a new context can reschedule.
        auto& s = m_sides[side];
        Locker locker { s.lock };
        // Not for a side that moved on: detach() dropped the bit, and by now it can be the next owner's.
        if (s.ctxId == ctxId)
            s.state.fetch_and(~uint64_t(DrainScheduled), std::memory_order_acq_rel);
    }
}

void MessagePortPipe::drainAndDispatch(uint8_t side, ScriptExecutionContextIdentifier expectedCtx, bool closeTurn)
{
    // Mirrors Node's MessagePort::OnMessage (src/node_messaging.cc): one
    // drain task processes the whole inbox in a loop, draining microtasks
    // between each delivery so queueMicrotask/Promise callbacks observe
    // messages one at a time, but without a separate posted task per
    // message. The per-invocation limit is a fixed count (not "whatever was
    // queued when the drain began", which a sender on another thread can make
    // arbitrarily large); the rest continues after the loop has polled.
    //
    // Messages move inbox -> `draining` a small batch per lock acquisition and are
    // popped from `draining` one at a time (still under the lock, but without a
    // sender contending for it per message). If the handler transfers this port
    // (pipe->detach clears `s.port`/`Attached`), detach() splices `draining` back
    // in front of the inbox so everything stays buffered, in order, for the new owner.
    // The peer's close is handed over here only, by a task posted for it (`closeTurn`) that finds nothing queued.
    auto& s = m_sides[side];

    RefPtr<MessagePort> port;
    bool attached;
    bool closeIsNext = false;
    BunLoopKind loopKind = BunLoopKind::Regular;
    {
        Locker locker { s.lock };
        // This task was posted to `expectedCtx` (and is running there). If
        // the side has since been detached and re-attached to a different
        // context, s.port now belongs to a different thread — dispatching
        // from here would be cross-thread JS. Leave everything alone: the
        // new owner's attach() has (or will have) scheduled its own drain.
        if (s.ctxId != expectedCtx)
            return;
        port = s.port.get();
        uint64_t st = s.state.load(std::memory_order_relaxed);
        if (!port || !queuedCount(st)) {
            if (!port || !closePending(st)) {
                s.state.store(st & ~DrainScheduled, std::memory_order_release);
                return;
            }
            // DrainScheduled stays set through the hand-over: it pins the wrapper (virtualHasPendingActivity()).
            closeIsNext = true;
            loopKind = s.ctxLoopKind;
            s.state.store(st | DrainScheduled | (closeTurn ? PeerCloseDelivered : 0), std::memory_order_release);
        }
        attached = st & Attached;
    }
    if (closeIsNext) {
        if (!closeTurn) {
            scheduleDrain(side, expectedCtx, loopKind, true);
            return;
        }
        port->peerClosed();
        Locker locker { s.lock };
        // A 'close' listener may have closed or transferred the port.
        if (s.ctxId == expectedCtx && s.port.get() == port)
            s.state.fetch_and(~uint64_t(DrainScheduled), std::memory_order_acq_rel);
        return;
    }

    // Not receiving (no 'message' listener, or registered for 'close' only): the inbox stays, and the close behind it.
    auto* context = port->scriptExecutionContext();
    if (!attached || !port->hasMessageEventListener() || !context || !context->globalObject()) {
        bool closeHeld;
        {
            Locker locker { s.lock };
            closeHeld = s.state.fetch_and(~uint64_t(DrainScheduled), std::memory_order_acq_rel) & PeerClosed;
        }
        if (closeHeld)
            port->peerCloseHeld();
        return;
    }
    auto* globalObject = defaultGlobalObject(context->globalObject());

    static constexpr size_t takeAtOnce = 64;
    size_t limit = 1024;
    ScriptExecutionContextIdentifier rescheduleCtx = 0;
    bool closeHeld = false;
    while (true) {
        std::optional<MessageWithMessagePorts> message;
        {
            Locker locker { s.lock };
            // Re-check each iteration: the handler (or a concurrent thread)
            // may have closed or transferred this port. A same-context
            // detach+re-attach restores ctxId but installs a different
            // MessagePort, so compare port identity too — dispatching to
            // the stale (now m_isDetached) `port` would silently drop.
            // The new owner's attach() scheduled its own drain, and detach()
            // already returned anything we had taken to the inbox.
            if (s.ctxId != expectedCtx || s.port.get() != port)
                break;
            uint64_t st = s.state.load(std::memory_order_relaxed);
            if (s.draining.isEmpty() && !s.inbox.isEmpty()) {
                // A closed peer sends nothing more: what it left is delivered whole, as Node does.
                if (st & PeerClosed)
                    limit = std::max(limit, static_cast<size_t>(s.inbox.size()));
                if (!limit) {
                    // Yield to the rest of the event loop; DrainScheduled stays
                    // set so concurrent sends don't double-schedule.
                    rescheduleCtx = s.ctxId;
                    break;
                }
                // Refill: this is the only acquisition that contends with senders
                // for more than one message's worth of work.
                size_t n = std::min({ takeAtOnce, limit, static_cast<size_t>(s.inbox.size()) });
                for (size_t i = 0; i < n; ++i)
                    s.draining.append(s.inbox.takeFirst());
                limit -= n;
            }
            Take taken = s.take(st, message);
            if (taken != Take::Message) {
                // DrainScheduled stays set for the task that hands over the close.
                closeIsNext = taken == Take::EndOfStream;
                if (closeIsNext)
                    loopKind = s.ctxLoopKind;
                else
                    s.state.store(st & ~DrainScheduled, std::memory_order_release);
                break;
            }
        }

        port->dispatchOneMessage(*context, WTF::move(*message));

        // Node's MakeCallback wraps each emit in an InternalCallbackScope,
        // which drains nextTick + microtasks on exit; match that so
        // queueMicrotask(cb) inside onmessage runs before the next message.
        if (globalObject->drainMicrotasks())
            break; // termination pending

        // Listeners may have been removed mid-drain (port.off()); pause like the
        // pre-loop check instead of dispatching the rest to zero listeners.
        if (!port->hasMessageEventListener()) {
            Locker locker { s.lock };
            // Closed or transferred by the handler: the side is no longer this port's.
            if (s.ctxId != expectedCtx || s.port.get() != port)
                break;
            while (!s.draining.isEmpty())
                s.inbox.prepend(s.draining.takeLast());
            uint64_t st = s.state.load(std::memory_order_relaxed);
            // The removed listener took the last message: the close follows it.
            closeIsNext = !queuedCount(st) && closePending(st);
            if (closeIsNext)
                loopKind = s.ctxLoopKind;
            else {
                s.state.store(st & ~DrainScheduled, std::memory_order_release);
                closeHeld = st & PeerClosed;
            }
            break;
        }
    }

    // Budget spent with messages left. We are on `context`'s thread: continue on
    // its next loop iteration (after I/O and timers), not in this drain.
    if (rescheduleCtx) {
        context->postTaskAfterYield([pipe = Ref { *this }, side, rescheduleCtx](ScriptExecutionContext&) {
            pipe->drainAndDispatch(side, rescheduleCtx, false);
        });
    } else if (closeIsNext)
        scheduleDrain(side, expectedCtx, loopKind, true);
    else if (closeHeld)
        port->peerCloseHeld();
}

std::optional<MessageWithMessagePorts> MessagePortPipe::takeOne(uint8_t side)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    std::optional<MessageWithMessagePorts> message;
    ScriptExecutionContextIdentifier wakeCtx = 0;
    BunLoopKind wakeLoopKind = BunLoopKind::Regular;
    {
        Locker locker { s.lock };
        uint64_t st = s.state.load(std::memory_order_relaxed);
        // Only the peer's close is left: the drain hands it over once the caller has returned.
        if (s.take(st, message) == Take::EndOfStream && (st & ContextKnown) && !(st & DrainScheduled)) {
            s.state.store(st | DrainScheduled, std::memory_order_release);
            wakeCtx = s.ctxId;
            wakeLoopKind = s.ctxLoopKind;
        }
    }
    if (wakeCtx)
        scheduleDrain(side, wakeCtx, wakeLoopKind, true);
    return message;
}

void MessagePortPipe::attach(uint8_t side, ScriptExecutionContext& context, ThreadSafeWeakPtr<MessagePort> port)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    ScriptExecutionContextIdentifier ctxId = context.identifier();
    BunLoopKind ctxLoopKind = context.currentLoopKind();
    ScriptExecutionContextIdentifier wakeCtx = 0;
    bool closeTurn = false;
    {
        Locker locker { s.lock };
        s.ctxId = ctxId;
        s.ctxLoopKind = ctxLoopKind;
        s.port = WTF::move(port);
        uint64_t st = s.state.load(std::memory_order_relaxed);
        ASSERT(!(st & Closed));
        uint64_t ns = st | Attached | ContextKnown;
        // Also for a pending close with nothing ahead of it: the peer closed while this side had no owner.
        closeTurn = closePending(st) && !queuedCount(st);
        if ((queuedCount(st) > 0 || closeTurn) && !(st & DrainScheduled)) {
            ns |= DrainScheduled;
            wakeCtx = ctxId;
        }
        s.state.store(ns, std::memory_order_release);
    }
    if (wakeCtx)
        scheduleDrain(side, wakeCtx, ctxLoopKind, closeTurn);
}

void MessagePortPipe::registerCloseContext(uint8_t side, ScriptExecutionContext& context, ThreadSafeWeakPtr<MessagePort> port)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    ScriptExecutionContextIdentifier ctxId = context.identifier();
    BunLoopKind ctxLoopKind = context.currentLoopKind();
    ScriptExecutionContextIdentifier wakeCtx = 0;
    bool closeTurn = false;
    {
        Locker locker { s.lock };
        uint64_t st = s.state.load(std::memory_order_relaxed);
        // Already closed, or context already known (started or previously registered).
        if ((st & Closed) || (st & (Attached | ContextKnown)))
            return;
        s.ctxId = ctxId;
        s.ctxLoopKind = ctxLoopKind;
        s.port = WTF::move(port);
        uint64_t ns = st | ContextKnown;
        // See attach(): the peer closed while this side had no context.
        closeTurn = !queuedCount(st);
        if (closePending(st) && !(st & DrainScheduled)) {
            ns |= DrainScheduled;
            wakeCtx = ctxId;
        }
        s.state.store(ns, std::memory_order_release);
    }
    if (wakeCtx)
        scheduleDrain(side, wakeCtx, ctxLoopKind, closeTurn);
}

void MessagePortPipe::detach(uint8_t side)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    Locker locker { s.lock };
    // Taken for dispatch by the owner that is letting go: back in front, in order.
    while (!s.draining.isEmpty())
        s.inbox.prepend(s.draining.takeLast());
    s.ctxId = 0;
    s.port = nullptr;
    // Drop Attached and DrainScheduled. A drain task already in flight on
    // the old context can't be recalled, but it captured the old ctxId and
    // drainAndDispatch()'s s.ctxId != expectedCtx check makes it a no-op —
    // even if a new owner attach()es to a different context before it runs.
    // Messages remain queued for the next owner.
    // So does the peer's close: PeerCloseDelivered is per owner.
    s.state.fetch_and(~uint64_t(Attached | ContextKnown | DrainScheduled | PeerCloseDelivered), std::memory_order_acq_rel);
}

void MessagePortPipe::close(uint8_t side, CloseKind kind)
{
    ASSERT(side < 2);

    // Dropped messages can carry TransferredMessagePorts, whose destructor
    // calls close() on their pipe. Letting those destruct naturally recurses
    // (close -> ~Deque -> ~TransferredMessagePort -> close -> ...), so a long
    // chain of nested transferred ports overflows the native stack. Drain the
    // cascade iteratively instead: steal transferred pipes from each batch of
    // dropped messages into a stack-local worklist and close them in a loop.
    Vector<std::tuple<RefPtr<MessagePortPipe>, uint8_t, CloseKind>> worklist;
    worklist.append({ this, side, kind });

    while (!worklist.isEmpty()) {
        auto [pipe, sd, sdKind] = worklist.takeLast();
        auto& s = pipe->m_sides[sd];

        Deque<MessageWithMessagePorts> dropped;
        {
            Locker locker { s.lock };
            s.ctxId = 0;
            s.port = nullptr;
            // Closed is terminal; queued messages are dropped.
            s.state.store(Closed, std::memory_order_release);
            dropped = std::exchange(s.inbox, {});
            while (!s.draining.isEmpty())
                dropped.prepend(s.draining.takeLast());
        }

        // Harvest transferred pipes before `dropped` destructs so their
        // ~TransferredMessagePort sees pipe == nullptr and is a no-op.
        for (auto& message : dropped) {
            for (auto& tp : message.transferredPorts) {
                if (auto p = std::exchange(tp.pipe, nullptr))
                    worklist.append({ WTF::move(p), tp.side, CloseKind::Explicit });
            }
        }
        // `dropped` (and the RefPtr in the structured binding) destruct
        // outside the lock; they may hold the last ref to pipes whose
        // destructors also take locks.

        // Notify each closed pipe's entangled peer so it can fire 'close' and
        // release its event-loop ref — including nested in-transit ports drained
        // from the worklist, not just the originally-closed side.
        // Always notify, even for a collected wrapper. Node never collects an entangled
        // port so it never faces this; bun does, and a peer that is never told is
        // stranded -- its loop ref is never released and the process hangs. A 'close'
        // fired at GC timing is the lesser evil. (jsRef() still ignores a collected
        // peer until the port is told: it keys on PeerClosedByRequest, not on PeerClosed.)
        pipe->markPeerClosed(1 - sd, sdKind);
    }
}

void MessagePortPipe::markPeerClosed(uint8_t peerSide, CloseKind kind)
{
    auto& s = m_sides[peerSide];
    ScriptExecutionContextIdentifier wakeCtx = 0;
    BunLoopKind wakeLoopKind = BunLoopKind::Regular;
    bool closeTurn = false;
    {
        Locker locker { s.lock };
        uint64_t st = s.state.load(std::memory_order_relaxed);
        if (st & Closed)
            return;
        // The closed side's last send() is already in this inbox: this store puts the close behind it.
        uint64_t ns = st | PeerClosed | (kind == CloseKind::Explicit ? PeerClosedByRequest : 0);
        // A side with no context yet is woken by attach() / registerCloseContext(), which read PeerClosed under this lock.
        closeTurn = !queuedCount(st);
        if ((st & ContextKnown) && !(st & DrainScheduled)) {
            ns |= DrainScheduled;
            wakeCtx = s.ctxId;
            wakeLoopKind = s.ctxLoopKind;
        }
        s.state.store(ns, std::memory_order_release);
    }
    if (wakeCtx)
        scheduleDrain(peerSide, wakeCtx, wakeLoopKind, closeTurn);
}

} // namespace WebCore
