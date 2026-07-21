// JSReadableByteStreamController — the ReadableByteStreamController instance cell.
// Not user-constructible. DESTRUCTIBLE (owns the byte [[queue]] + [[pendingPullIntos]]
// deques).
#pragma once

#include "root.h"
#include "StreamsForward.h"
#include "StreamQueue.h"

#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <wtf/Deque.h>

namespace WebCore {

class JSReadableByteStreamController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    // Internal allocation entry point (setUpReadableByteStreamController*).
    static JSReadableByteStreamController* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, m_byobRequest, every barrier inside
    // m_algorithms, and the barrier container m_pendingPullIntos (m_queue entries hold
    // ArrayBuffer impls via RefPtr, so the queue has nothing for the GC).
    //   cellLock() is NON-RECURSIVE (StreamQueue.h). This visitChildrenImpl takes
    //   `Locker locker { cellLock() }` exactly ONCE, and inside that ONE scope both
    //   iterates m_pendingPullIntos and calls m_queue.visit(locker, visitor) (StreamQueue
    //   never re-acquires the lock). Never visit either container outside that scope, and
    //   never take a second Locker. Mutating ops that touch BOTH containers do the same.
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // Spec internal slots

    // [[queue]] (list of readable byte stream queue entries) + [[queueTotalSize]]
    Bun::WebStreams::StreamQueue<Bun::WebStreams::ByteQueueEntry> m_queue;
    // [[pendingPullIntos]] — mutated AND visited under cellLock().
    WTF::Deque<JSC::WriteBarrier<JSPullIntoDescriptor>, 4> m_pendingPullIntos;
    // [[stream]]
    JSC::WriteBarrier<JSReadableStream> m_stream;
    // [[byobRequest]] — null after invalidation / when none is pending.
    JSC::WriteBarrier<JSReadableStreamBYOBRequest> m_byobRequest;
    // [[autoAllocateChunkSize]] — 0 = the spec's `undefined` (the spec rejects an explicit 0
    // with TypeError at set-up, so 0 is a safe sentinel).
    uint64_t m_autoAllocateChunkSize { 0 };
    // [[strategyHWM]]
    double m_strategyHWM { 0 };
    // [[started]]
    bool m_started : 1 { false };
    // [[pulling]]
    bool m_pulling : 1 { false };
    // [[pullAgain]]
    bool m_pullAgain : 1 { false };
    // [[closeRequested]]
    bool m_closeRequested : 1 { false };

    // The algorithm machinery — replaces [[pullAlgorithm]] and [[cancelAlgorithm]]. A byte
    // stream has NO size algorithm (a byte stream given a size strategy is a RangeError at
    // construction). See SourceAlgorithmSlots (StreamQueue.h).
    // The reachable m_algorithms.kind set on a BYTE controller is EXACTLY
    // {JavaScript, Nothing, ByteTeeBranch, Native}. CrossRealm is impossible (the cross-realm
    // readable endpoint is always a DEFAULT controller — JSCrossRealmTransformState's
    // back-pointer is exact-typed to one).
    Bun::WebStreams::SourceAlgorithmSlots m_algorithms;

    // Internal methods

    // [[CancelSteps]](reason) — userJS: YES (performs the user cancel algorithm).
    JSC::JSPromise* cancelSteps(JSC::JSGlobalObject*, JSC::JSValue reason);
    // [[PullSteps]](readRequest) — userJS: YES (transitive).
    void pullSteps(JSC::JSGlobalObject*, JSReadRequest*);
    // [[ReleaseSteps]]() — truncates [[pendingPullIntos]] to its head w/ readerType=None. userJS: no.
    void releaseSteps();

private:
    JSReadableByteStreamController(JSC::VM&, JSC::Structure*);
    ~JSReadableByteStreamController();
    void finishCreation(JSC::VM&);
};

// Construct throws `TypeError: Illegal constructor`; the constructor object is still
// installed on globalThis so instanceof / .prototype work.
using JSReadableByteStreamControllerConstructor = JSDOMConstructorNotConstructable<JSReadableByteStreamController>;

} // namespace WebCore
