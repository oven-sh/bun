#pragma once

#include "root.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Locker.h>
#include <wtf/Vector.h>

namespace JSC {
class JSWeakSet;
}

namespace Bun {

// Zig::GlobalObject::m_aboutToBeNotifiedRejectedPromises. Only the JS thread writes, under owner->cellLock(); the GC thread visits.
class RejectedPromiseQueue {
public:
    void append(JSC::VM&, JSC::JSCell* owner, JSC::JSPromise*, JSC::JSObject* rejectionOwner);
    // The promise got its first handler. True if markReported() saw it: it is owed 'rejectionHandled'.
    bool didHandle(JSC::JSCell* owner, JSC::JSPromise*);
    // Move every entry that still has no handler out (index-aligned; jsNull() owner for the global object's) and clear.
    void drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& promises, JSC::MarkedArgumentBuffer& rejectionOwners);
    // Right before a drained promise is reported as unhandled.
    void markReported(JSC::JSGlobalObject* owner, JSC::JSPromise*);
    template<typename Visitor> void visit(JSC::JSCell* owner, Visitor&);
    bool isEmpty() const { return m_entries.isEmpty(); }
    // For a read that only its caller asked for. Entries enter at the end and never move up, so the queue is longer after
    // the read only if its newest entry entered during it. Makes room first: an append to a full queue can drop handled entries.
    size_t sizeBeforeRead(JSC::JSCell* owner);
    // If the queue is longer than `sizeBefore` and its newest entry holds `returned`, that promise is marked as handled.
    void handleRejectionOfRead(size_t sizeBefore, JSC::JSValue returned);

private:
    struct Entry {
        JSC::WriteBarrier<JSC::Unknown> promise; // JSPromise
        JSC::WriteBarrier<JSC::Unknown> rejectionOwner; // JSModuleGraph or null
    };
    static bool isHandled(const Entry& entry) { return static_cast<JSC::JSPromise*>(entry.promise.get().asCell())->isHandled(); }
    bool wasReported(JSC::JSPromise*);
    void makeRoom();
    void makeRoomBeforeRead(JSC::JSCell* owner);

    // In rejection order. A promise that gets a handler stays until it is at the end, makeRoom() runs, or the drain.
    // One that native code only marks as handled stays at the end too.
    WTF::Vector<Entry> m_entries;
    // Promises reported as unhandled. Weak: a reported promise that dies leaves it.
    JSC::WriteBarrier<JSC::JSWeakSet> m_reported;
};

// Inlined into promiseRejectionTracker, their one caller.
ALWAYS_INLINE void RejectedPromiseQueue::append(JSC::VM& vm, JSC::JSCell* owner, JSC::JSPromise* promise, JSC::JSObject* rejectionOwner)
{
    WTF::Locker locker { owner->cellLock() };
    if (m_entries.size() == m_entries.capacity()) [[unlikely]]
        makeRoom();
    m_entries.unsafeAppendWithoutCapacityCheck(Entry {});
    m_entries.last().promise.set(vm, owner, promise);
    m_entries.last().rejectionOwner.set(vm, owner, rejectionOwner ? JSC::JSValue(rejectionOwner) : JSC::jsNull());
}

ALWAYS_INLINE bool RejectedPromiseQueue::didHandle(JSC::JSCell* owner, JSC::JSPromise* promise)
{
    if (!m_entries.isEmpty() && m_entries.last().promise.get().asCell() == promise) {
        WTF::Locker locker { owner->cellLock() };
        m_entries.removeLast();
        while (!m_entries.isEmpty() && isHandled(m_entries.last()))
            m_entries.removeLast();
        return false;
    }
    return m_reported && wasReported(promise);
}

ALWAYS_INLINE size_t RejectedPromiseQueue::sizeBeforeRead(JSC::JSCell* owner)
{
    if (m_entries.size() == m_entries.capacity() && !m_entries.isEmpty()) [[unlikely]]
        makeRoomBeforeRead(owner);
    return m_entries.size();
}

ALWAYS_INLINE void RejectedPromiseQueue::handleRejectionOfRead(size_t sizeBefore, JSC::JSValue returned)
{
    if (m_entries.size() > sizeBefore && m_entries.last().promise.get() == returned) [[unlikely]]
        static_cast<JSC::JSPromise*>(returned.asCell())->markAsHandled();
}

} // namespace Bun
