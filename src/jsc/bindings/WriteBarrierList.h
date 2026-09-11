#pragma once

#include <type_traits>
#include <wtf/Vector.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ArgList.h>

namespace Bun {

/**
 * A variable-length list of JSValue objects with garbage collection support.
 *
 * This class provides a thread-safe container for WriteBarrier<T> objects that can
 * dynamically grow and shrink. It includes helper methods for visiting contained
 * objects during garbage collection traversal.
 *
 * Use this class when:
 * - The number of items may change at runtime (append/remove operations)
 * - You need thread-safe access to the list
 * - You need automatic garbage collection support for contained JSValues
 *
 * For better performance when the length is known and fixed, prefer
 * FixedVector<WriteBarrier<T>> instead.
 *
 * @tparam T The type of JSC objects to store (must inherit from JSC::JSCell)
 */
template<typename T>
class WriteBarrierList {
public:
    WriteBarrierList()
    {
    }

    void append(JSC::VM& vm, JSC::JSCell* owner, T* value)
    {
        WTF::Locker locker { owner->cellLock() };
        m_list.append(JSC::WriteBarrier<T>(vm, owner, value));
    }

    // Move every element into `arguments` and clear the backing vector in one
    // linear pass under a single cellLock.
    void drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& arguments)
    {
        WTF::Locker locker { owner->cellLock() };
        arguments.ensureCapacity(arguments.size() + m_list.size());
        for (JSC::WriteBarrier<T>& value : m_list) {
            if (auto* cell = value.get())
                arguments.append(cell);
        }
        m_list.clear();
    }

    template<typename Visitor>
    void visit(JSC::JSCell* owner, Visitor& visitor)
    {
        WTF::Locker locker { owner->cellLock() };
        for (auto& value : m_list) {
            visitor.append(value);
        }
    }

    bool isEmpty() const
    {
        return m_list.isEmpty();
    }

    template<typename MatchFunction>
    bool removeFirstMatching(JSC::JSCell* owner, const MatchFunction& matches)
    {
        WTF::Locker locker { owner->cellLock() };
        return m_list.removeFirstMatching(matches);
    }

private:
    WTF::Vector<JSC::WriteBarrier<T>> m_list;
};

/**
 * Promises rejected with no handler, awaiting the end-of-microtasks check, each with
 * whose rejection it is, decided when it happened: a Bun.unsafe.ModuleGraph, or null
 * for the global object's own code. Same locking as WriteBarrierList.
 */
class PendingRejectionList {
public:
    void append(JSC::VM& vm, JSC::JSCell* owner, JSC::JSPromise* promise, JSC::JSObject* rejectionOwner)
    {
        WTF::Locker locker { owner->cellLock() };
        m_list.append({ JSC::WriteBarrier<JSC::JSPromise>(vm, owner, promise), JSC::WriteBarrier<JSC::JSObject>() });
        m_list.last().rejectionOwner.setMayBeNull(vm, owner, rejectionOwner);
    }

    // Move every entry into `promises` / `rejectionOwners` (index-aligned; jsNull() for
    // the global object's) and clear the backing vector, under one cellLock.
    void drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& promises, JSC::MarkedArgumentBuffer& rejectionOwners)
    {
        WTF::Locker locker { owner->cellLock() };
        promises.ensureCapacity(promises.size() + m_list.size());
        rejectionOwners.ensureCapacity(rejectionOwners.size() + m_list.size());
        for (Entry& entry : m_list) {
            if (auto* promise = entry.promise.get()) {
                promises.append(promise);
                rejectionOwners.append(entry.rejectionOwner ? JSC::JSValue(entry.rejectionOwner.get()) : JSC::jsNull());
            }
        }
        m_list.clear();
    }

    template<typename Visitor>
    void visit(JSC::JSCell* owner, Visitor& visitor)
    {
        WTF::Locker locker { owner->cellLock() };
        for (auto& entry : m_list) {
            visitor.append(entry.promise);
            visitor.append(entry.rejectionOwner);
        }
    }

    bool isEmpty() const { return m_list.isEmpty(); }

    bool remove(JSC::JSCell* owner, JSC::JSPromise* promise)
    {
        WTF::Locker locker { owner->cellLock() };
        return m_list.removeFirstMatching([&](Entry& entry) { return entry.promise.get() == promise; });
    }

private:
    struct Entry {
        JSC::WriteBarrier<JSC::JSPromise> promise;
        JSC::WriteBarrier<JSC::JSObject> rejectionOwner;
    };
    WTF::Vector<Entry> m_list;
};

}
