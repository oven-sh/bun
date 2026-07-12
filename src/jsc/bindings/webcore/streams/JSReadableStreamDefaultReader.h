// JSReadableStreamDefaultReader — the ReadableStreamDefaultReader instance cell.
// DESTRUCTIBLE (owns the [[readRequests]] Deque).
#pragma once

#include "root.h"
#include "StreamsForward.h"
#include "JSReadableStreamReaderBase.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <wtf/Deque.h>

namespace WebCore {

class JSReadableStreamDefaultReader final : public JSReadableStreamReaderBase {
public:
    using Base = JSReadableStreamReaderBase;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    // Internal allocation entry point (acquireReadableStreamDefaultReader).
    static JSReadableStreamDefaultReader* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream + m_closedPromise (from the base),
    // m_pipeOperation, and m_readRequests (a barrier container: UNDER cellLock()).
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

    // [[readRequests]] — mutated AND visited under cellLock().
    WTF::Deque<JSC::WriteBarrier<JSReadRequest>, 4> m_readRequests;

    // The reader→operation liveness back-edge, set when a pipe (JSStreamPipeToOperation) or
    // a Bun pump (JSReadStreamIntoSinkOperation / JSResumableSinkPumpOperation) acquires
    // this reader, cleared on release/finalize. ERASED on purpose: one operation per reader
    // by construction. Visited.
    JSC::WriteBarrier<JSC::JSCell> m_pipeOperation;

private:
    JSReadableStreamDefaultReader(JSC::VM&, JSC::Structure*);
    ~JSReadableStreamDefaultReader();
    void finishCreation(JSC::VM&);
};

using JSReadableStreamDefaultReaderConstructor = JSStreamConstructor<JSReadableStreamDefaultReader>;

} // namespace WebCore
