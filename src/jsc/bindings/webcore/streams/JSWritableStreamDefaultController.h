// JSWritableStreamDefaultController — the WritableStreamDefaultController instance cell.
// Not user-constructible. DESTRUCTIBLE (owns the [[queue]]).
#pragma once

#include "root.h"
#include "StreamsForward.h"
#include "StreamQueue.h"

#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSDestructibleObject.h>

namespace WebCore {

class JSWritableStreamDefaultController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    // Internal allocation entry point (setUpWritableStreamDefaultController*).
    static JSWritableStreamDefaultController* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, m_abortController, every barrier inside
    // m_algorithms, m_strategySizeAlgorithm, and m_queue (a barrier container: via
    // m_queue.visit(locker, visitor) inside ONE `Locker { cellLock() }` scope taken by THIS
    // visitChildrenImpl — cellLock() is non-recursive; see StreamQueue.h).
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSC::JSCell*, JSC::HeapAnalyzer&);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // Spec internal slots

    // [[queue]] + [[queueTotalSize]] — the close sentinel is an EMPTY value barrier
    // (StreamQueue.h). [[queueTotalSize]] is a double.
    Bun::WebStreams::StreamQueue<Bun::WebStreams::ValueWithSize> m_queue;
    // [[stream]]
    JSC::WriteBarrier<JSWritableStream> m_stream;
    // [[abortController]] — the JSAbortController wrapper cell (its `signal` is the
    // controller's exposed [[signal]]).
    JSC::WriteBarrier<JSC::JSObject> m_abortController;
    // [[strategyHWM]]
    double m_strategyHWM { 1 };
    // [[started]]
    bool m_started { false };

    // The algorithm machinery — replaces [[writeAlgorithm]], [[closeAlgorithm]], and
    // [[abortAlgorithm]]. See SinkAlgorithmSlots (StreamQueue.h).
    Bun::WebStreams::SinkAlgorithmSlots m_algorithms;

    // [[strategySizeAlgorithm]] — null ⇒ the default `() => 1`.
    JSC::WriteBarrier<JSC::JSObject> m_strategySizeAlgorithm;

    // Internal methods

    // [[AbortSteps]](reason) — userJS: YES (performs the user abort algorithm).
    JSC::JSPromise* abortSteps(JSC::JSGlobalObject*, JSC::JSValue reason);
    // [[ErrorSteps]]() — ResetQueue only. userJS: no.
    void errorSteps();

private:
    JSWritableStreamDefaultController(JSC::VM&, JSC::Structure*);
    ~JSWritableStreamDefaultController();
    void finishCreation(JSC::VM&);
};

// Construct throws `TypeError: Illegal constructor`; the constructor object is still
// installed on globalThis so instanceof / .prototype work.
using JSWritableStreamDefaultControllerConstructor = JSDOMConstructorNotConstructable<JSWritableStreamDefaultController>;

} // namespace WebCore
