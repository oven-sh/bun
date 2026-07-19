// JSAsyncIteratorSourceOperation — state cell for Bun's async-iterable → direct-stream body
// extension (BunAsyncIterableSource.cpp): the iterator, the controller handed to pull(), and
// the one promise every pull() returns. Internal cell: no prototype, no constructor.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSAsyncIteratorSourceOperation final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSAsyncIteratorSourceOperation* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_iterator, m_controller, m_pullPromise.
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

    // The async iterator; cleared when cancellation or the error path hands it off.
    JSC::WriteBarrier<JSC::JSObject> m_iterator;
    // Whatever object pull() received (the direct controller, or the HTTP sink facade).
    JSC::WriteBarrier<JSC::JSObject> m_controller;
    // The single promise returned to every pull() while the iterator runs.
    JSC::WriteBarrier<JSC::JSPromise> m_pullPromise;
    bool m_cancelled : 1 { false };
    bool m_done : 1 { false };
    bool m_running : 1 { false };
    // {done:true, value} still writes the value first; this remembers the done across a
    // backpressure suspension on that final write.
    bool m_iteratorDone : 1 { false };

private:
    JSAsyncIteratorSourceOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
