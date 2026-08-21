// JSWritableStreamDefaultWriter — the WritableStreamDefaultWriter instance cell.
// Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSWritableStreamDefaultWriter final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    // Internal allocation entry point (acquireWritableStreamDefaultWriter).
    static JSWritableStreamDefaultWriter* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, m_closedPromise, m_readyPromise, m_pipeOperation.
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

    // [[stream]] — null = released / not attached.
    JSC::WriteBarrier<JSWritableStream> m_stream;
    // [[closedPromise]] — spec-required at construction; NOT lazy. Replaced on release.
    JSC::WriteBarrier<JSC::JSPromise> m_closedPromise;
    // [[readyPromise]] — replaced on backpressure changes / erroring. Cleared (lazy) when
    // backpressure goes true; readyPromise() materializes a pending one on first access.
    JSC::WriteBarrier<JSC::JSPromise> m_readyPromise;
    JSC::JSPromise* readyPromise(JSC::JSGlobalObject*);
    // The writer→pipe-operation liveness back-edge, set when a pipe acquires this writer and
    // cleared in the pipe's "finalize". Visited.
    JSC::WriteBarrier<JSStreamPipeToOperation> m_pipeOperation;

private:
    JSWritableStreamDefaultWriter(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

using JSWritableStreamDefaultWriterConstructor = JSStreamConstructor<JSWritableStreamDefaultWriter>;

} // namespace WebCore
