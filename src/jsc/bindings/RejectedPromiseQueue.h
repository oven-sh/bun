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

private:
    struct Entry {
        JSC::WriteBarrier<JSC::Unknown> promise; // JSPromise
        JSC::WriteBarrier<JSC::Unknown> rejectionOwner; // JSModuleGraph or null
    };
    static bool isHandled(const Entry& entry) { return static_cast<JSC::JSPromise*>(entry.promise.get().asCell())->isHandled(); }
    bool wasReported(JSC::JSPromise*);
    void makeRoom();

    // In rejection order. A handled promise stays until it is at the end, makeRoom() runs, or the drain.
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

} // namespace Bun
