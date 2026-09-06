// JSDirectSinkCloseState — the context cell of readDirectStream's bound onClose callable:
// the port of the `{underlyingSource, closePromiseCapability}` bound `this`.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSDirectSinkCloseState final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSDirectSinkCloseState* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit ALL THREE: m_underlyingSource, m_sinkController,
    // m_closePromise. (An unvisited m_closePromise is a premature collection of the
    // promise handed to Rust.)
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

    // the direct stream's user underlyingSource (its `cancel` runs from onClose).
    JSC::WriteBarrier<JSC::JSObject> m_underlyingSource;
    // the JS sink controller driving the source; onClose must end() it so the cell
    // detaches from the native sink before it can be collected.
    JSC::WriteBarrier<JSC::JSObject> m_sinkController;
    // the close-capability promise returned to the caller when `pull` returned synchronously
    // without closing; initially null, armed by readDirectStream, resolved by onClose.
    JSC::WriteBarrier<JSC::JSPromise> m_closePromise;

private:
    JSDirectSinkCloseState(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
