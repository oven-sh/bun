// JSDirectStreamSource — a `type:"direct"` underlying source, converted ONCE at stream
// construction: the user object (the `this` of every call) and its pull / cancel / close
// methods. Held by the stream while DirectPending, then by whichever consumer takes the
// stream (JSDirectStreamController, JSDirectSinkCloseState, JSOneShotDirectSink); nobody
// reads a property of the user object after construction.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>

namespace WebCore {

class JSDirectStreamSource final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSDirectStreamSource* create(JSC::VM&, JSC::Structure*, JSC::JSValue underlyingSource, JSC::JSObject* pull, JSC::JSObject* cancel, JSC::JSObject* close);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_underlyingSource, m_pull, m_cancel, m_close.
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

    // The user's underlyingSource object; `undefined` for Bun's internal sources.
    JSC::WriteBarrier<JSC::Unknown> m_underlyingSource;
    // Each is callable or null.
    JSC::WriteBarrier<JSC::JSObject> m_pull;
    JSC::WriteBarrier<JSC::JSObject> m_cancel;
    // Bun's close(reason) lifecycle hook: the stream ended or errored.
    JSC::WriteBarrier<JSC::JSObject> m_close;

    JSC::JSValue thisValue() const { return m_underlyingSource.get(); }
    // cancel(reason) in the stream's async context, as a promise (a throw rejects it).
    JSC::JSPromise* cancel(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue reason);
    // close(reason); a throw propagates.
    void close(JSC::JSGlobalObject*, JSC::JSValue reason);

private:
    JSDirectStreamSource(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSValue underlyingSource, JSC::JSObject* pull, JSC::JSObject* cancel, JSC::JSObject* close);
};

} // namespace WebCore
