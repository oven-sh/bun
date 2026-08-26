// JSReadableStreamDefaultController — the ReadableStreamDefaultController instance cell.
// Not user-constructible. The algorithm slots are the kind tag + method/context members of
// SourceAlgorithmSlots (no stored closures). DESTRUCTIBLE (owns the [[queue]] StreamQueue).
#pragma once

#include "root.h"
#include "StreamsForward.h"
#include "StreamQueue.h"

#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSDestructibleObject.h>

namespace WebCore {

class JSReadableStreamDefaultController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    // Internal allocation entry point (setUpReadableStreamDefaultController* / createReadableStream).
    static JSReadableStreamDefaultController* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, every barrier inside m_algorithms,
    // m_strategySizeAlgorithm, and m_queue (a barrier container: via
    // m_queue.visit(locker, visitor) inside ONE `Locker { cellLock() }` scope taken by THIS
    // visitChildrenImpl — cellLock() is non-recursive; see StreamQueue.h).
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

    // [[queue]] + [[queueTotalSize]]
    Bun::WebStreams::StreamQueue<Bun::WebStreams::ValueWithSize> m_queue;
    // [[stream]]
    JSC::WriteBarrier<JSReadableStream> m_stream;
    // [[strategyHWM]]
    double m_strategyHWM { 1 };
    // [[started]]
    bool m_started : 1 { false };
    // [[pulling]]
    bool m_pulling : 1 { false };
    // [[pullAgain]]
    bool m_pullAgain : 1 { false };
    // [[closeRequested]]
    bool m_closeRequested : 1 { false };

    // The algorithm machinery — replaces [[pullAlgorithm]] and [[cancelAlgorithm]]; the
    // start algorithm is never stored. See SourceAlgorithmSlots (StreamQueue.h).
    Bun::WebStreams::SourceAlgorithmSlots m_algorithms;

    // [[strategySizeAlgorithm]] — null ⇒ the default `() => 1`.
    JSC::WriteBarrier<JSC::JSObject> m_strategySizeAlgorithm;

    // Internal methods

    // [[CancelSteps]](reason) — userJS: YES (performs the user cancel algorithm).
    JSC::JSPromise* cancelSteps(JSC::JSGlobalObject*, JSC::JSValue reason);
    // [[PullSteps]](readRequest) — userJS: YES (may run the user pull algorithm).
    void pullSteps(JSC::JSGlobalObject*, JSReadRequest*);
    // The queue-hit half of [[PullSteps]]: dequeue + the close-or-pull bookkeeping.
    // Caller checks !m_queue.isEmpty(). Returns the chunk (empty on exception).
    JSC::JSValue dequeueChunkForRead(JSC::JSGlobalObject*);
    // [[ReleaseSteps]]() — spec: "Return." (no-op). userJS: no.
    void releaseSteps();

private:
    JSReadableStreamDefaultController(JSC::VM&, JSC::Structure*);
    ~JSReadableStreamDefaultController();
    void finishCreation(JSC::VM&);
};

// Construct throws `TypeError: Illegal constructor`; the constructor object is still
// installed on globalThis so instanceof / .prototype work.
using JSReadableStreamDefaultControllerConstructor = JSDOMConstructorNotConstructable<JSReadableStreamDefaultController>;

} // namespace WebCore
