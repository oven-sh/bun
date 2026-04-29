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
// Wakeups are coalesced: a burst of N sends schedules at most one drain task
// on the receiving context. The receiving side clears DrainScheduled before
// swapping the inbox, so a send that races past the clear simply schedules a
// second (harmless, no-op) drain. No message is ever stranded.
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

        QueuedShift = 8,
        QueuedOne = 1ull << QueuedShift,
    };
    static constexpr uint64_t queuedCount(uint64_t s) { return s >> QueuedShift; }

    // Sender-thread operations.
    // `fromSide` is the sender's side; the message lands in the *other* side's inbox.
    void send(uint8_t fromSide, MessageWithMessagePorts&&);

    // Receiver-thread operations.
    Deque<MessageWithMessagePorts> takeAll(uint8_t side);
    std::optional<MessageWithMessagePorts> takeOne(uint8_t side); // receiveMessageOnPort

    // Attach this side to a context + port. Schedules a drain if messages are
    // already queued (e.g. after transfer). Passing a null port is allowed and
    // means "just buffer, don't dispatch" (used before start()).
    void attach(uint8_t side, ScriptExecutionContextIdentifier, ThreadSafeWeakPtr<MessagePort>);
    void detach(uint8_t side);
    void close(uint8_t side);

    // Lockless snapshot for the GC visitor / hasPendingActivity.
    uint64_t state(uint8_t side) const { return m_sides[side].state.load(std::memory_order_acquire); }
    bool isOtherSideOpen(uint8_t side) const { return !(state(1 - side) & Closed); }

    // Equality is by identity; used to reject "port posted through itself".
    bool operator==(const MessagePortPipe& other) const { return this == &other; }

private:
    MessagePortPipe() = default;

    void scheduleDrain(uint8_t side, ScriptExecutionContextIdentifier);
    void drainAndDispatch(uint8_t side);

    struct Side {
        WTF::Lock lock;
        WTF::Deque<MessageWithMessagePorts> inbox WTF_GUARDED_BY_LOCK(lock);
        ScriptExecutionContextIdentifier ctxId WTF_GUARDED_BY_LOCK(lock) { 0 };
        ThreadSafeWeakPtr<MessagePort> port WTF_GUARDED_BY_LOCK(lock);
        // Packed flags + count. Written only while holding `lock`; read locklessly.
        std::atomic<uint64_t> state { 0 };
    };
    Side m_sides[2];
};

} // namespace WebCore
