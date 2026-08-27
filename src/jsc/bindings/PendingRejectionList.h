#pragma once

#include <wtf/Vector.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun {

// Promises rejected with no handler yet, each with the async context active at
// the rejection (node: promiseInfo.contextFrame). Same cellLock discipline as
// WriteBarrierList.
class PendingRejectionList {
public:
    void append(JSC::VM& vm, JSC::JSCell* owner, JSC::JSPromise* promise, JSC::JSValue asyncContext)
    {
        WTF::Locker locker { owner->cellLock() };
        m_entries.append(Entry {
            JSC::WriteBarrier<JSC::JSPromise>(vm, owner, promise),
            JSC::WriteBarrier<JSC::Unknown>(vm, owner, asyncContext),
        });
    }

    bool remove(JSC::JSCell* owner, JSC::JSPromise* promise)
    {
        WTF::Locker locker { owner->cellLock() };
        return m_entries.removeFirstMatching([&](const Entry& entry) {
            return entry.promise.get() == promise;
        });
    }

    // promises[i] and asyncContexts[i] describe the same rejection.
    void drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& promises, JSC::MarkedArgumentBuffer& asyncContexts)
    {
        WTF::Locker locker { owner->cellLock() };
        promises.ensureCapacity(promises.size() + m_entries.size());
        asyncContexts.ensureCapacity(asyncContexts.size() + m_entries.size());
        for (Entry& entry : m_entries) {
            if (auto* promise = entry.promise.get()) {
                promises.append(promise);
                asyncContexts.append(entry.asyncContext.get());
            }
        }
        m_entries.clear();
    }

    template<typename Visitor>
    void visit(JSC::JSCell* owner, Visitor& visitor)
    {
        WTF::Locker locker { owner->cellLock() };
        for (auto& entry : m_entries) {
            visitor.append(entry.promise);
            visitor.append(entry.asyncContext);
        }
    }

    bool isEmpty() const
    {
        return m_entries.isEmpty();
    }

private:
    struct Entry {
        JSC::WriteBarrier<JSC::JSPromise> promise;
        JSC::WriteBarrier<JSC::Unknown> asyncContext;
    };

    WTF::Vector<Entry> m_entries;
};

}
