// JSStreamTeeState — the shared per-tee() state cell for BOTH the default tee and the byte
// tee. It is the algorithmContext of both branch controllers (SourceKind::TeeBranch /
// ByteTeeBranch; the branch index lives on the controller). ReadableByteStreamTee is a
// DIFFERENT algorithm from the default tee — the two only share this state cell.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSStreamTeeState final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSStreamTeeState* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, m_reader, m_branch1, m_branch2,
    // m_cancelPromise, m_reason1, m_reason2.
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

    // The ORIGINAL stream — every cancel needs it.
    JSC::WriteBarrier<JSReadableStream> m_stream;
    // MUTABLE: the byte tee releases and re-acquires readers of EITHER kind repeatedly.
    // Erased to JSCell on purpose.
    JSC::WriteBarrier<JSC::JSCell> m_reader;
    // `branch1` / `branch2`
    JSC::WriteBarrier<JSReadableStream> m_branch1;
    JSC::WriteBarrier<JSReadableStream> m_branch2;
    // `cancelPromise`
    JSC::WriteBarrier<JSC::JSPromise> m_cancelPromise;
    // `reason1` / `reason2` — only meaningful once canceled1/canceled2 is set.
    JSC::WriteBarrier<JSC::Unknown> m_reason1;
    JSC::WriteBarrier<JSC::Unknown> m_reason2;
    // `reading`
    bool m_reading : 1 { false };
    // default tee: `readAgain`; byte tee: `readAgainForBranch1`. (One flag, two spec names.)
    bool m_readAgain1 : 1 { false };
    // byte tee only: `readAgainForBranch2`.
    bool m_readAgain2 : 1 { false };
    // `canceled1` / `canceled2`
    bool m_canceled1 : 1 { false };
    bool m_canceled2 : 1 { false };
    // Bun: structured-clone branch2's chunks (Response.clone() passes true;
    // ReadableStream.prototype.tee() passes false). Default-tee chunkSteps only.
    bool m_shouldClone : 1 { false };

private:
    JSStreamTeeState(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
