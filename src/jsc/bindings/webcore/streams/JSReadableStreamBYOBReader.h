// JSReadableStreamBYOBReader — the ReadableStreamBYOBReader instance cell.
// DESTRUCTIBLE (owns the [[readIntoRequests]] Deque).
#pragma once

#include "root.h"
#include "StreamsForward.h"
#include "JSReadableStreamReaderBase.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <wtf/Deque.h>

namespace WebCore {

class JSReadableStreamBYOBReader final : public JSReadableStreamReaderBase {
public:
    using Base = JSReadableStreamReaderBase;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    // Internal allocation entry point (acquireReadableStreamBYOBReader).
    static JSReadableStreamBYOBReader* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream + m_closedPromise (from the base) and
    // m_readIntoRequests (a barrier container: UNDER cellLock()).
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

    // [[readIntoRequests]] — mutated AND visited under cellLock().
    WTF::Deque<JSC::WriteBarrier<JSReadIntoRequest>, 4> m_readIntoRequests;

private:
    JSReadableStreamBYOBReader(JSC::VM&, JSC::Structure*);
    ~JSReadableStreamBYOBReader();
    void finishCreation(JSC::VM&);
};

using JSReadableStreamBYOBReaderConstructor = JSStreamConstructor<JSReadableStreamBYOBReader>;

} // namespace WebCore
