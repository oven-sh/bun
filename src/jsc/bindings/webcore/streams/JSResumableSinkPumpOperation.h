// JSResumableSinkPumpOperation — the assignStreamIntoResumableSink pump's state cell. Its
// drain/cancel callables are [bound-convention] JSBoundFunctions over JSStreamsRuntime
// handlers with THIS cell bound (they are stored on the native ResumableSink, so they must
// be GC-visited callables).
// ROOTING: the acquired reader's visited m_pipeOperation back-edge points HERE.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>

namespace WebCore {

class JSResumableSinkPumpOperation final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSResumableSinkPumpOperation* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit all four barriers: m_stream, m_sink, m_reader, m_error.
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

    JSC::WriteBarrier<JSReadableStream> m_stream;
    // the native ResumableSink wrapper (start/setHandlers/write/end).
    JSC::WriteBarrier<JSC::JSObject> m_sink;
    // the acquired default reader (carries the m_pipeOperation back-edge to this cell).
    JSC::WriteBarrier<JSReadableStreamDefaultReader> m_reader;
    // the sticky error, if any (gated by m_closed / emptiness).
    JSC::WriteBarrier<JSC::Unknown> m_error;
    // a drain loop is running (re-entrancy guard).
    bool m_reading : 1 { false };
    // terminal.
    bool m_closed : 1 { false };

private:
    JSResumableSinkPumpOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
