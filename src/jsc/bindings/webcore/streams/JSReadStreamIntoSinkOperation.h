// JSReadStreamIntoSinkOperation — the readStreamIntoSink async pump's state cell. Driven
// entirely by [reaction-convention] reactions.
// ROOTING: the acquired reader's visited m_pipeOperation back-edge points HERE (set at
// acquire, cleared at teardown), so `Rust Strong → stream → reader → this →
// m_sink / m_result` holds across the backpressure await.
// Internal cell: no prototype, no constructor. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSReadStreamIntoSinkOperation final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSReadStreamIntoSinkOperation* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit ALL FOUR barriers: m_stream, m_reader, m_sink, m_result.
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
    // the acquired default reader. The error path CLEARS this FIRST, so the final
    // releaseLock is deliberately skipped there.
    JSC::WriteBarrier<JSReadableStreamDefaultReader> m_reader;
    // ERASED: the native JSSink controller the pump writes into.
    JSC::WriteBarrier<JSC::JSObject> m_sink;
    // the JSPromise readStreamIntoSink returned (what Rust's Signal protocol awaits).
    JSC::WriteBarrier<JSC::JSPromise> m_result;
    bool m_didThrow : 1 { false };
    bool m_didClose : 1 { false };
    bool m_started : 1 { false };

private:
    JSReadStreamIntoSinkOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
