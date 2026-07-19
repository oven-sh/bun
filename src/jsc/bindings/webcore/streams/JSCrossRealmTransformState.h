// JSCrossRealmTransformState — one cell per cross-realm (transferred) stream endpoint.
// Transferable streams are NOT implemented: CrossRealmTransform.cpp may stub its entry
// points, but this cell and the CrossRealm enum arms stay in the frozen headers so nothing
// has to be re-frozen later.
// The port's message/messageerror handlers MUST be registered through the port's GC-visited
// listener machinery with THIS cell as the context (a raw-pointer native listener is a UAF).
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSCrossRealmTransformState final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSCrossRealmTransformState* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_port, m_backpressurePromise, m_readableController,
    // m_writableController.
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

    // The JSMessagePort wrapper cell this endpoint sends/receives on.
    JSC::WriteBarrier<JSC::JSObject> m_port;
    // MUTABLE — the writable side's message handler reassigns it on every "pull"/"error".
    JSC::WriteBarrier<JSC::JSPromise> m_backpressurePromise;
    // Back-pointers to the controller in THIS realm — EXACT-TYPED (the subsystem allows
    // exactly ONE erased back-pointer, JSReadableStream::m_controller, so this is not a
    // second one). EXACTLY ONE of the two is non-null: m_readableController on the readable
    // (transfer-receiving) endpoint, m_writableController on the writable endpoint. Dispatch
    // on which is non-null; never jsCast an erased slot here.
    JSC::WriteBarrier<JSReadableStreamDefaultController> m_readableController;
    JSC::WriteBarrier<JSWritableStreamDefaultController> m_writableController;

private:
    JSCrossRealmTransformState(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
