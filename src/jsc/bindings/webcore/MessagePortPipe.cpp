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
        scheduleDrain(1 - fromSide, wakeCtx, wakeLoopKind);
}

void MessagePortPipe::scheduleDrain(uint8_t side, ScriptExecutionContextIdentifier ctxId, BunLoopKind ctxLoopKind)
{
    // The posted task holds a strong ref to the pipe so it can't be destroyed
    // while a wakeup is in flight. The task captures the ctxId it was posted
    // to so drainAndDispatch can detect if the side moved to a different
    // context before the task ran.
    bool posted = ScriptExecutionContext::postTaskTo(ctxId, ctxLoopKind, [pipe = Ref { *this }, side, ctxId](ScriptExecutionContext&) {
        pipe->drainAndDispatch(side, ctxId);
    });
    if (!posted) {
        // Context already torn down. Drop DrainScheduled so a future
        // attach() to a new context can reschedule.
        Locker locker { m_sides[side].lock };
        m_sides[side].state.fetch_and(~uint64_t(DrainScheduled), std::memory_order_acq_rel);
    }
}

void MessagePortPipe::drainAndDispatch(uint8_t side, ScriptExecutionContextIdentifier expectedCtx, bool fromYieldContinuation)
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
    auto& s = m_sides[side];

    RefPtr<MessagePort> port;
    size_t limit;
    bool ownsDispatching = false;
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
        // A spent budget hands the rest to an after-yield continuation so a
        // self-feeding message loop cannot starve timers and I/O; wakeup tasks
        // posted by send() in the meantime stand down until it has run.
        if (st & YieldPending) {
            if (!fromYieldContinuation)
                return;
            st &= ~uint64_t(YieldPending);
        }
        if (!port || (s.draining.isEmpty() && s.inbox.isEmpty())) {
            s.state.store(st & ~DrainScheduled, std::memory_order_release);
            return;
        }
        limit = 1024;
        // Trade DrainScheduled for Dispatching before user JS runs: a handler
        // can park this loop in a nested event-loop wait, and a send() arriving
        // then must post a fresh drain task (#37189). Dispatching keeps
        // hasPendingActivity() true across the dispatch window DrainScheduled
        // used to cover. A nested drain (posted by such a send) finds the bit
        // already set and leaves clearing it to this outer invocation.
        ownsDispatching = !(st & Dispatching);
        s.state.store((st & ~DrainScheduled) | Dispatching, std::memory_order_release);
    }

    // Clear Dispatching only if this invocation set it and still owns the
    // side; after a detach the bit belongs to the next owner's drain.
    auto finish = [&] {
        if (!ownsDispatching)
            return;
        Locker locker { s.lock };
        if (s.ctxId == expectedCtx && s.port.get() == port)
            s.state.fetch_and(~uint64_t(Dispatching), std::memory_order_acq_rel);
    };

    // All 'message' listeners removed: the port is paused. Leave the inbox buffered
    // and stop draining; a later addEventListener re-schedules this drain.
    if (!port->hasMessageEventListener()) {
        finish();
        return;
    }

    auto* context = port->scriptExecutionContext();
    if (!context || !context->globalObject()) {
        finish();
        return;
    }
    auto* globalObject = defaultGlobalObject(context->globalObject());

    static constexpr size_t takeAtOnce = 64;
    ScriptExecutionContextIdentifier rescheduleCtx = 0;
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
            // already returned anything we had taken to the inbox (and reset
            // the flags).
            if (s.ctxId != expectedCtx || s.port.get() != port)
                return;
            uint64_t st = s.state.load(std::memory_order_relaxed);
            if (!(st & Attached) || (s.draining.isEmpty() && s.inbox.isEmpty())) {
                if (ownsDispatching)
                    s.state.store(st & ~uint64_t(Dispatching), std::memory_order_release);
                break;
            }
            if (s.draining.isEmpty()) {
                if (!limit) {
                    // Budget spent; the after-yield continuation posted below
                    // is the only invocation allowed to keep draining, so
                    // timers and I/O get a turn even when a racing send
                    // already posted a regular wakeup task (which will stand
                    // down on YieldPending). Nested waits still progress: the
                    // loop tick they spin promotes after-yield tasks.
                    st |= YieldPending;
                    rescheduleCtx = s.ctxId;
                    if (ownsDispatching)
                        st &= ~uint64_t(Dispatching);
                    s.state.store(st, std::memory_order_release);
                    break;
                }
                // Refill: this is the only acquisition that contends with senders
                // for more than one message's worth of work.
                size_t n = std::min({ takeAtOnce, limit, static_cast<size_t>(s.inbox.size()) });
                for (size_t i = 0; i < n; ++i)
                    s.draining.append(s.inbox.takeFirst());
                limit -= n;
            }
            message = s.draining.takeFirst();
            s.state.store(st - QueuedOne, std::memory_order_release);
        }

        port->dispatchOneMessage(*context, WTF::move(*message));

        // Node's MakeCallback wraps each emit in an InternalCallbackScope,
        // which drains nextTick + microtasks on exit; match that so
        // queueMicrotask(cb) inside onmessage runs before the next message.
        if (globalObject->drainMicrotasks()) {
            finish();
            return; // termination pending
        }

        // Listeners may have been removed mid-drain (port.off()); pause like the
        // pre-loop check instead of dispatching the rest to zero listeners.
        if (!port->hasMessageEventListener()) {
            {
                Locker locker { s.lock };
                while (!s.draining.isEmpty())
                    s.inbox.prepend(s.draining.takeLast());
            }
            finish();
            return;
        }
    }

    // Budget spent with messages left. We are on `context`'s thread: continue on
    // its next loop iteration (after I/O and timers), not in this drain.
    if (rescheduleCtx) {
        context->postTaskAfterYield([pipe = Ref { *this }, side, rescheduleCtx](ScriptExecutionContext&) {
            pipe->drainAndDispatch(side, rescheduleCtx, /* fromYieldContinuation */ true);
        });
    }
}

std::optional<MessageWithMessagePorts> MessagePortPipe::takeOne(uint8_t side)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    Locker locker { s.lock };
    // From inside a handler (receiveMessageOnPort), the next message in order may
    // already sit in the drain's batch.
    auto& queue = s.draining.isEmpty() ? s.inbox : s.draining;
    if (queue.isEmpty())
        return std::nullopt;
    s.state.fetch_sub(QueuedOne, std::memory_order_acq_rel);
    return queue.takeFirst();
}

void MessagePortPipe::attach(uint8_t side, ScriptExecutionContext& context, ThreadSafeWeakPtr<MessagePort> port)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    ScriptExecutionContextIdentifier ctxId = context.identifier();
    BunLoopKind ctxLoopKind = context.currentLoopKind();
    ScriptExecutionContextIdentifier wakeCtx = 0;
    {
        Locker locker { s.lock };
        s.ctxId = ctxId;
        s.ctxLoopKind = ctxLoopKind;
        s.port = WTF::move(port);
        uint64_t st = s.state.load(std::memory_order_relaxed);
        uint64_t ns = (st | Attached | ContextKnown) & ~Closed;
        if (queuedCount(st) > 0 && !(st & DrainScheduled)) {
            ns |= DrainScheduled;
            wakeCtx = ctxId;
        }
        s.state.store(ns, std::memory_order_release);
    }
    if (wakeCtx)
        scheduleDrain(side, wakeCtx, ctxLoopKind);
    // Peer already closed while this side was in transit (detach() cleared
    // ContextKnown so notifyPeerClosed() early-returned): re-deliver to the new
    // owner, or the receiving context's listener loop-ref is never released.
    if (m_sides[1 - side].state.load(std::memory_order_acquire) & Closed)
        notifyPeerClosed(side);
}

void MessagePortPipe::registerCloseContext(uint8_t side, ScriptExecutionContext& context, ThreadSafeWeakPtr<MessagePort> port)
{
    ASSERT(side < 2);
    auto& s = m_sides[side];
    ScriptExecutionContextIdentifier ctxId = context.identifier();
    BunLoopKind ctxLoopKind = context.currentLoopKind();
    {
        Locker locker { s.lock };
        uint64_t st = s.state.load(std::memory_order_relaxed);
        // Already closed, or context already known (started or previously registered).
        if ((st & Closed) || (st & (Attached | ContextKnown)))
            return;
        s.ctxId = ctxId;
        s.ctxLoopKind = ctxLoopKind;
        s.port = WTF::move(port);
        s.state.store(st | ContextKnown, std::memory_order_release);
    }
    // See attach(): re-deliver a peer-close that fired while this side had no
    // context (in transit or never registered).
    if (m_sides[1 - side].state.load(std::memory_order_acquire) & Closed)
        notifyPeerClosed(side);
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
    // Drop Attached, DrainScheduled, Dispatching and YieldPending. A drain
    // task already in flight on the old context can't be recalled, but it
    // captured the old ctxId and drainAndDispatch()'s s.ctxId != expectedCtx
    // check makes it a no-op — even if a new owner attach()es to a different
    // context before it runs. Messages remain queued for the next owner.
    s.state.fetch_and(~uint64_t(Attached | ContextKnown | DrainScheduled | Dispatching | YieldPending), std::memory_order_acq_rel);
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
            s.state.store(sdKind == CloseKind::Explicit ? (Closed | ClosedByRequest) : Closed, std::memory_order_release);
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
        // peer: it keys on ClosedByRequest, not on Closed.)
        pipe->notifyPeerClosed(1 - sd);
    }
}

void MessagePortPipe::notifyPeerClosed(uint8_t peerSide)
{
    auto& s = m_sides[peerSide];
    ScriptExecutionContextIdentifier ctxId = 0;
    BunLoopKind ctxLoopKind = BunLoopKind::Regular;
    {
        Locker locker { s.lock };
        uint64_t st = s.state.load(std::memory_order_acquire);
        if ((st & Closed) || !(st & ContextKnown))
            return;
        ctxId = s.ctxId;
        ctxLoopKind = s.ctxLoopKind;
    }
    if (!ctxId)
        return;
    ScriptExecutionContext::postTaskTo(ctxId, ctxLoopKind, [pipe = Ref { *this }, peerSide, ctxId](ScriptExecutionContext&) {
        RefPtr<MessagePort> port;
        {
            Locker locker { pipe->m_sides[peerSide].lock };
            if (pipe->m_sides[peerSide].ctxId != ctxId)
                return;
            port = pipe->m_sides[peerSide].port.get();
        }
        if (port)
            port->peerClosed();
    });
}

} // namespace WebCore

#endif // BUN_MESSAGEPORT_USES_PIPE
