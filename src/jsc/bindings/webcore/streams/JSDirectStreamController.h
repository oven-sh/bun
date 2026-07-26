// JSDirectStreamController — the Bun `type:"direct"` controller for JS consumption. ONE
// class, three sink flavors (DirectSinkKind). It is NOT a spec controller: no enqueue, no
// desiredSize, no byobRequest; its five public methods (write, end, close, flush, error) are
// per-controller OWN JSBoundFunction properties ([bound-convention]) — there is no prototype
// method table and no constructor class. The stream's m_controllerKind is
// ControllerKind::Direct.
// DESTRUCTIBLE: owns a WTF::StringBuilder + a Vector of barriers.
#pragma once

#include "root.h"
#include "StreamsForward.h"

// The ONE shared BunTextAccumulator value type ("one implementation, two owners" — the
// other owner is the standalone JSBunStandaloneTextSink). Not a cycle:
// BunStandaloneTextSink.h does not include this header.
#include "BunStandaloneTextSink.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSDirectStreamController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSDirectStreamController* create(JSC::VM&, JSC::Structure*, Bun::WebStreams::DirectSinkKind);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, m_underlyingSource, m_pull, m_pendingRead,
    // m_deferCloseReason, m_arrayBufferSink, m_array, m_closingPromise, m_finalChunk, and
    // the barrier container m_textAccumulator.pieces (via
    // m_textAccumulator.visit(locker, visitor) inside ONE `Locker { cellLock() }` scope
    // taken by THIS visitChildrenImpl — cellLock() is non-recursive; see StreamQueue.h).
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

    // Core state
    // $controlledReadableStream
    JSC::WriteBarrier<JSReadableStream> m_stream;
    // the USER underlyingSource object and its captured `pull` method (captured once at
    // setUpDirectStreamController, matching the native-sink path's m_onPull).
    JSC::WriteBarrier<JSC::JSObject> m_underlyingSource;
    JSC::WriteBarrier<JSC::JSObject> m_pull;
    // _pendingRead — the promise the in-flight read() is waiting on. handleError rejects
    // AND CLEARS it.
    JSC::WriteBarrier<JSC::JSPromise> m_pendingRead;
    // _deferCloseReason
    JSC::WriteBarrier<JSC::Unknown> m_deferCloseReason;
    // -1 = pull in progress (reentrancy guard), 0 = idle, 1 = close deferred
    int8_t m_deferClose { 0 };
    // -1 = pull in progress, 0 = idle, 1 = flush deferred
    int8_t m_deferFlush { 0 };
    // which of the 3 sink flavors this controller runs.
    DirectSinkKind m_sinkKind { DirectSinkKind::ArrayBuffer };
    // Once closed, the five methods are no-ops (there is NO "swap all 5 methods to a
    // throwing stub" trick).
    bool m_closed : 1 { false };
    // An async pull()'s returned promise has not yet settled; cleared by its settlement
    // reactions. m_pullAgain is set only when a NEW read arrives while m_pullInFlight
    // (edge-triggered, matching the spec default controller's [[pullAgain]]).
    bool m_pullInFlight : 1 { false };
    bool m_pullAgain : 1 { false };
    bool m_calledDone : 1 { false };
    // End-of-tick auto-flush (the JS-facing analogue of the HTTP sink's AutoFlusher):
    // armed by write() when data is buffered below the HWM while a consumer waits; the
    // deferred task runs right after the current microtask drain and delivers it.
    bool m_endOfTickFlushArmed : 1 { false };
    bool m_finalChunkArmed : 1 { false };

    // ArrayBuffer sink: a real Bun.ArrayBufferSink cell (ArrayBuffer kind only).
    JSC::WriteBarrier<JSC::JSObject> m_arrayBufferSink;

    // Text sink: the ONE shared createTextStream accumulator value type
    // (BunStandaloneTextSink.h), also owned by the standalone JSBunStandaloneTextSink — one
    // implementation, two owners. Its `pieces` barrier container is mutated AND visited
    // under THIS cell's cellLock() (see the visit-list comment above). This arm does NOT
    // BOM-strip.
    Bun::WebStreams::BunTextAccumulator m_textAccumulator;

    // Array sink.
    JSC::WriteBarrier<JSC::JSArray> m_array;

    // Text/Array closing capability.
    JSC::WriteBarrier<JSC::JSPromise> m_closingPromise;

    void armEndOfTickFlush(JSC::JSGlobalObject*);

    // Final-chunk-on-close: the NEXT read() delivers m_finalChunk then closes. onPull checks
    // m_finalChunkArmed FIRST.
    JSC::WriteBarrier<JSC::Unknown> m_finalChunk;

    // The state machine. All userJS: YES.
    // the READ pump: the default reader's read()/readMany() on a Direct stream lands here.
    JSC::JSValue onPull(JSC::JSGlobalObject*);
    // `end()` / `close(reason)` — reason may be the empty JSValue (absent).
    void onClose(JSC::JSGlobalObject*, JSC::JSValue reason);
    // `flush()` — BRANCH ORDER IS LOAD-BEARING.
    void onFlush(JSC::JSGlobalObject*);
    // handleDirectStreamError.
    void handleError(JSC::JSGlobalObject*, JSC::JSValue error);

private:
    JSDirectStreamController(JSC::VM&, JSC::Structure*, Bun::WebStreams::DirectSinkKind);
    ~JSDirectStreamController();
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
