#pragma once

#include "root.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/HashMap.h>
#include <wtf/Vector.h>

namespace JSC {
class JSPromise;
}

namespace Bun {

// Zig::GlobalObject::m_aboutToBeNotifiedRejectedPromises. Every method takes owner->cellLock().
class RejectedPromiseQueue {
public:
    void append(JSC::VM&, JSC::JSCell* owner, JSC::JSPromise*, JSC::JSObject* rejectionOwner);
    bool remove(JSC::JSCell* owner, JSC::JSPromise*);
    // Move every entry out (index-aligned; jsNull() owner for the global object's) and clear.
    void drainTo(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& promises, JSC::MarkedArgumentBuffer& rejectionOwners);
    template<typename Visitor> void visit(JSC::JSCell* owner, Visitor&);
    bool isEmpty() const { return m_entries.isEmpty(); }

private:
    struct Entry {
        JSC::WriteBarrier<JSC::Unknown> promise; // JSPromise
        JSC::WriteBarrier<JSC::Unknown> rejectionOwner; // JSModuleGraph or null
    };
    // In rejection order. remove() leaves a hole (an empty promise) unless the entry is the last.
    WTF::Vector<Entry> m_entries;
    unsigned m_holes { 0 };
    // promise -> index for m_entries[0..m_indexed), extended by remove() only to search a long queue.
    WTF::HashMap<JSC::JSPromise*, unsigned> m_indices;
    unsigned m_indexed { 0 };
};

// Zig::GlobalObject::m_rejectedPromisesBeingProcessed: one drained batch, reported from `index` on.
struct InFlightRejections {
    JSC::MarkedArgumentBuffer* buffer;
    size_t index;
    InFlightRejections* outer;
    // promise -> position in `buffer`, built by the first tailContains() of a long tail.
    WTF::HashMap<JSC::JSPromise*, unsigned> positions {};

    bool tailContains(JSC::JSPromise*);
};

} // namespace Bun
