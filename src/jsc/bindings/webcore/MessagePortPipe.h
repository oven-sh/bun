// MessagePortPipe is the cross-thread concurrency primitive underlying
// MessagePort / MessageChannel.
//
// A pipe has two sides. Each side has an inbox (messages waiting to be
// delivered to the port attached on that side) protected by a per-side lock,
// plus a single atomic state word that packs all flags and the queued-message
// count. All mutations happen under the per-side lock; the atomic exists so
// that lockless readers (the GC's hasPendingActivity check, and senders
// deciding whether to schedule a wakeup) can observe a consistent snapshot.
//
// Wakeups are coalesced: a burst of N sends schedules one cross-thread drain
// task on the receiving context. The drain task moves messages inbox ->
// `Side::draining` a small batch per lock acquisition and dispatches them one
// at a time, draining microtasks between each (matching Node's MakeCallback /
// InternalCallbackScope behavior), up to a fixed 1024 per task before
// continuing on the loop's next iteration (a closed peer's backlog is finite and
// is delivered whole). A port transferred mid-loop carries
// the whole remaining queue to the new owner: detach() puts `draining` back in
// front of the inbox, in order.
//
// A side's close is recorded in the *other* side's state word (PeerClosed), under
// that side's lock. A closed side never sends again, so "PeerClosed and nothing
// queued" is Node's close message at the front of the queue: the receiver is handed
// the peer's close only once it has consumed everything sent before it, and reads
// both facts in one load. Only a drain task posted for the close hands it over.
//
// The Web API semantics (start(), close(), transfer, event dispatch) live in
// MessagePort; this class knows nothing about EventTarget or JS.

#pragma once

#include "MessageWithMessagePorts.h"
#include <wtf/Deque.h>
#include <wtf/Lock.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/ThreadSafeWeakPtr.h>

namespace WebCore {

class MessagePort;
class ScriptExecutionContext;
using ScriptExecutionContextIdentifier = uint32_t;

class MessagePortPipe final : public ThreadSafeRefCounted<MessagePortPipe> {
public:
    static Ref<MessagePortPipe> create() { return adoptRef(*new MessagePortPipe); }
    ~MessagePortPipe();

    // Per-side state word layout. Low byte is flags; the queued-message count
    // lives in the upper bits so it can be bumped with fetch_add(QueuedOne).
    enum State : uint64_t {
        Closed = 1ull << 0, // close() was called on this side; drops further deliveries.
        DrainScheduled = 1ull << 1, // a drain task for this side is in flight.
        Attached = 1ull << 2, // ctxId/port are valid; ok to schedule drains.
        ContextKnown = 1ull << 3, // ctxId/port are valid for handing over the peer's close only (no messages).
        PeerClosedByRequest = 1ull << 4, // the PeerClosed below came from close(), not from the port being collected.
        PeerClosed = 1ull << 5, // the other side closed; nothing more is queued here.
        PeerCloseDelivered = 1ull << 6, // this side's current owner was handed the peer's close.

        QueuedShift = 8,
        QueuedOne = 1ull << QueuedShift,
    };
    static constexpr uint64_t queuedCount(uint64_t s) { return s >> QueuedShift; }
    // The peer closed and everything it sent before that was consumed.
    static constexpr bool atEndOfStream(uint64_t s) { return (s & PeerClosed) && !queuedCount(s); }
    // The peer closed and this side's owner has not been handed that close yet.
    static constexpr bool closePending(uint64_t s) { return (s & (PeerClosed | PeerCloseDelivered)) == PeerClosed; }

    // Sender-thread operations.
    // `fromSide` is the sender's side; the message lands in the *other* side's inbox.
    void send(uint8_t fromSide, MessageWithMessagePorts&&);

    // Receiver-thread synchronous pop, for node:worker_threads receiveMessageOnPort. A read
    // that finds only the peer's close schedules the drain that hands it over.
    std::optional<MessageWithMessagePorts> takeOne(uint8_t side);

    // Attach this side to a context + port. Schedules a drain if messages are
    // already queued (e.g. after transfer) or the peer's close is pending. Passing a
    // null port is allowed and means "just buffer, don't dispatch" (used before start()).
    void attach(uint8_t side, ScriptExecutionContext&, ThreadSafeWeakPtr<MessagePort>);
    // Like attach() but only records ctxId/port so the peer's close can be handed to a
    // port that never started (no 'message' listener). The drain it enables dispatches
    // no messages. No-op if already attached/registered/closed.
    void registerCloseContext(uint8_t side, ScriptExecutionContext&, ThreadSafeWeakPtr<MessagePort>);
    void detach(uint8_t side);
    // Explicit == a real, permanent close: close(), context teardown, or an orphaned
    // transferred endpoint. Collected == the owning MessagePort's wrapper was garbage
    // collected while still entangled. Only Explicit sets PeerClosedByRequest on the other
    // side, so until the port is told jsRef() can tell a real close from a collection (node
    // never collects an entangled port, so reading PeerClosed alone made .ref() GC-dependent).
    // Both set PeerClosed.
    enum class CloseKind : uint8_t { Explicit,
        Collected };
    void close(uint8_t side, CloseKind = CloseKind::Collected);

    // Lockless snapshot for the GC visitor / hasPendingActivity.
    uint64_t state(uint8_t side) const { return m_sides[side].state.load(std::memory_order_acquire); }

    // Equality is by identity; used to reject "port posted through itself".
    bool operator==(const MessagePortPipe& other) const { return this == &other; }

private:
    MessagePortPipe() = default;

    // `closeTurn`: the task is posted for the peer's close, which was seen with nothing
    // queued ahead of it. Only such a task hands the close to the port.
    void scheduleDrain(uint8_t side, ScriptExecutionContextIdentifier, BunLoopKind, bool closeTurn);
    void markPeerClosed(uint8_t peerSide, CloseKind);
    void drainAndDispatch(uint8_t side, ScriptExecutionContextIdentifier expectedCtx, bool closeTurn);

    enum class Take : uint8_t { Message,
        Nothing,
        EndOfStream };

    struct Side {
        WTF::Lock lock;
        WTF::Deque<MessageWithMessagePorts> inbox WTF_GUARDED_BY_LOCK(lock);
        // Messages the owner's drain has taken out of `inbox` (a small batch per lock
        // acquisition) but not dispatched yet. Still counted as queued in `state`. If the
        // handler transfers the port mid-batch, detach() puts them back in front of `inbox`
        // so the next owner sees everything, in order; close() drops them with the rest.
        WTF::Deque<MessageWithMessagePorts> draining WTF_GUARDED_BY_LOCK(lock);
        ScriptExecutionContextIdentifier ctxId WTF_GUARDED_BY_LOCK(lock) { 0 };
        // The loop `ctxId` was running when this side attached there; drains are posted to it.
        BunLoopKind ctxLoopKind WTF_GUARDED_BY_LOCK(lock) { BunLoopKind::Regular };
        ThreadSafeWeakPtr<MessagePort> port WTF_GUARDED_BY_LOCK(lock);
        // Packed flags + count. Written only while holding `lock`; read locklessly.
        std::atomic<uint64_t> state { 0 };

        // The one way a message leaves this side, for the drain and for takeOne(). `st` is
        // `state` as loaded under `lock`. EndOfStream: nothing is queued and the peer's
        // close is pending.
        ALWAYS_INLINE Take take(uint64_t st, std::optional<MessageWithMessagePorts>& message) WTF_REQUIRES_LOCK(lock)
        {
            // From inside a handler (receiveMessageOnPort), the next message in order may
            // already sit in the drain's batch.
            auto& queue = draining.isEmpty() ? inbox : draining;
            if (queue.isEmpty())
                return closePending(st) ? Take::EndOfStream : Take::Nothing;
            message = queue.takeFirst();
            state.store(st - QueuedOne, std::memory_order_release);
            return Take::Message;
        }
    };
    Side m_sides[2];
};

} // namespace WebCore
