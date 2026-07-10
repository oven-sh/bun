// JSOneShotDirectSink — the one-shot direct consumer's throwaway controller
// (`consumeDirectStreamToArrayBuffer` / readableStreamToArrayBufferDirect).
//
// This path does NOT build a persistent controller or a reader, and shares no state machine
// with JSDirectStreamController — do not force it into one. It hand-rolls a
// `{start, close, end, flush, write}` object over a real `Bun.ArrayBufferSink`, calls the
// user's `pull(controller)` EXACTLY ONCE, and settles the capability promise from the pull's
// outcome. This cell IS that `controller`: it roots the ArrayBufferSink, the capability
// promise, and the source stream across the pull, and carries the `closed` flag.
// Its start/write/end/close/flush are OWN JSBoundFunctions over the shared
// boundOneShotStart / boundOneShotDirect{Write,Close,Flush} [bound-convention] targets
// (JSStreamsRuntime.h), with THIS cell as the bound context at argument(0):
//   - `start` is bound to boundOneShotStart, a no-op target that returns undefined;
//   - `end` and `close` are two bound cells over the ONE boundOneShotDirectClose target.
// Internal cell: no prototype, no constructor, never exposed to JS beyond `pull(controller)`.
// Non-destructible: WriteBarrier + scalar members only.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSOneShotDirectSink final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSOneShotDirectSink* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit ALL FOUR barriers: m_stream, m_arrayBufferSink,
    // m_capabilityPromise, m_closeFunction. No barrier container ⇒ no cellLock needed.
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

    // The consumed DirectPending stream (already marked locked + disturbed before the pull).
    JSC::WriteBarrier<JSReadableStream> m_stream;
    // The real Bun.ArrayBufferSink cell every write() lands in.
    JSC::WriteBarrier<JSC::JSObject> m_arrayBufferSink;
    // The capability promise consumeDirectStreamToArrayBuffer returned; end()/close() settle
    // it (and the onConsumeDirectToArrayBufferPull* reactions settle it on the pull's promise).
    JSC::WriteBarrier<JSC::JSPromise> m_capabilityPromise;
    // The underlying source's optional close() method, invoked by end()/close().
    JSC::WriteBarrier<JSC::Unknown> m_closeFunction;
    // Set by end()/close(): later write()/end()/close()/flush() calls are no-ops.
    bool m_closed : 1 { false };
    // true ⇒ resolve with a Uint8Array (toBytes); false ⇒ an ArrayBuffer (toArrayBuffer).
    bool m_asUint8Array : 1 { false };

private:
    JSOneShotDirectSink(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
