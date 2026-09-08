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
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSPromise.h>
#include <span>

namespace WebCore {

// The ArrayBuffer sink's byte buffer. Allocated from the Primitive Gigacage — where
// ArrayBuffer contents live — so a drained chunk adopts the allocation instead of copying it;
// size_t extents (a chunk may be anything a Uint8Array can hold, past WTF::Vector's 2^31).
class DirectByteBuffer {
    WTF_MAKE_NONCOPYABLE(DirectByteBuffer);

public:
    DirectByteBuffer() = default;
    ~DirectByteBuffer() { deallocate(); }

    size_t size() const { return m_size; }
    size_t capacity() const { return m_data ? m_capacity : 0; }
    // After releaseAsArrayBuffer(): the released batch's capacity, to size the next one.
    size_t lastCapacity() const { return m_capacity; }
    bool isEmpty() const { return !m_size; }
    std::span<const uint8_t> span() const { return { m_data, m_size }; }

    // false = allocation failed or the result would not fit a Uint8Array.
    bool tryReserve(size_t capacity);
    bool tryAppend(std::span<const uint8_t>);
    bool tryAppendUTF8(WTF::StringView);
    void shrinkToEmpty() { m_size = 0; }
    void deallocate();
    // The bytes as an exactly-sized ArrayBuffer (no copy); leaves this empty.
    Ref<JSC::ArrayBuffer> releaseAsArrayBuffer();

private:
    bool tryGrowTo(size_t size);

    uint8_t* m_data { nullptr };
    size_t m_size { 0 };
    size_t m_capacity { 0 };
};

class JSDirectStreamController final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSDirectStreamController* create(JSC::VM&, JSC::Structure*, Bun::WebStreams::DirectSinkKind);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_stream, m_source, m_pendingRead, m_deferCloseReason,
    // m_array, m_sinkPromise, m_finalChunk, and — inside ONE
    // `Locker { cellLock() }` scope taken by THIS visitChildrenImpl (cellLock() is
    // non-recursive; see StreamQueue.h) — report m_buffer's capacity and visit the barrier
    // container m_textAccumulator.pieces (m_textAccumulator.visit(locker, visitor)).
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);
    static size_t estimatedSize(JSCell*, JSC::VM&);

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
    // The converted user source (this + pull/cancel/close). Cleared once no hook can run.
    JSC::WriteBarrier<JSDirectStreamSource> m_source;
    // _pendingRead — the promise the in-flight read()/readMany() is waiting on. Only
    // promise-backed reads register here; pipeTo / tee / for-await reads wait in the
    // reader's [[readRequests]] instead (see onPull). handleError rejects AND CLEARS it.
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
    // process.nextTick job delivers it during the same microtask/nextTick drain.
    bool m_endOfTickFlushArmed : 1 { false };
    bool m_finalChunkArmed : 1 { false };
    // ArrayBuffer sink: the bytes write() accepted since it armed m_pendingWrite (saturating).
    uint32_t m_pendingWriteLength { 0 };

    // ArrayBuffer sink: the bytes written since the reader last took them. Its size is the
    // backpressure measure: once it reaches the stream's highWaterMark, write() returns the
    // pending-write promise (m_sinkPromise; one until the next drain) instead of a number, the
    // same contract as a native sink. Taking the bytes fulfills it with the bytes written
    // meanwhile; error / cancel fulfill it with `false`. Its storage is replaced/freed only
    // under cellLock() (the visitor reports its capacity as extra memory).
    DirectByteBuffer m_buffer;

    // Text sink: the ONE shared createTextStream accumulator value type
    // (BunStandaloneTextSink.h), also owned by the standalone JSBunStandaloneTextSink — one
    // implementation, two owners. Its `pieces` barrier container is mutated AND visited
    // under THIS cell's cellLock() (see the visit-list comment above). This arm does NOT
    // BOM-strip.
    Bun::WebStreams::BunTextAccumulator m_textAccumulator;

    // Array sink.
    JSC::WriteBarrier<JSC::JSArray> m_array;

    // ArrayBuffer sink: the parked write() promise. Text/Array sinks: the closing capability.
    // One slot, two meanings: every access goes through the accessor for its sink kind.
    JSC::WriteBarrier<JSC::JSPromise> m_sinkPromise;
    JSC::WriteBarrier<JSC::JSPromise>& pendingWrite()
    {
        ASSERT(m_sinkKind == Bun::WebStreams::DirectSinkKind::ArrayBuffer);
        return m_sinkPromise;
    }
    JSC::WriteBarrier<JSC::JSPromise>& closingPromise()
    {
        ASSERT(m_sinkKind != Bun::WebStreams::DirectSinkKind::ArrayBuffer);
        return m_sinkPromise;
    }

    void armEndOfTickFlush(JSC::JSGlobalObject*);

    // Final-chunk-on-close: the NEXT read() delivers m_finalChunk then closes. onPull checks
    // m_finalChunkArmed FIRST.
    JSC::WriteBarrier<JSC::Unknown> m_finalChunk;

    // The state machine. All userJS: YES.
    // The READ pump: every default-reader read on a Direct stream lands here. A promise-backed
    // read()/readMany() passes readRequestQueued=false and adopts the returned promise
    // (undefined when the pump refused). A pipeTo / tee / for-await read adds its
    // JSReadRequest to [[readRequests]] first and passes readRequestQueued=true: that
    // request is the consumer, the pump registers no promise for it and returns undefined.
    JSC::JSValue onPull(JSC::JSGlobalObject*, bool readRequestQueued);
    // `end()` / `close(reason)` — reason may be the empty JSValue (absent).
    void onClose(JSC::JSGlobalObject*, JSC::JSValue reason);
    // `flush()` — BRANCH ORDER IS LOAD-BEARING.
    void onFlush(JSC::JSGlobalObject*);
    // handleDirectStreamError.
    // true if a pending read or the stream received the error; false if there was nothing left to error.
    bool handleError(JSC::JSGlobalObject*, JSC::JSValue error);
    void finishClose(JSC::JSGlobalObject*, JSC::JSValue flushed);
    // [[CancelSteps]](reason): readableStreamCancel already closed the stream; settle what the
    // controller still holds, then run the source's cancel(reason).
    JSC::JSPromise* cancelSteps(JSC::JSGlobalObject*, JSC::JSValue reason);

    // ArrayBuffer sink. takeBuffer: the buffered bytes as a Uint8Array (jsNumber(0) when
    // empty) — this is the drain that settles m_pendingWrite. The chunk adopts the buffer's
    // allocation; only a chunk small enough for JSC's inline typed-array storage is copied.
    JSC::JSValue takeBuffer(JSC::JSGlobalObject*);
    void freeBuffer();
    void settlePendingWrite(JSC::VM&, JSC::JSValue);

private:
    JSDirectStreamController(JSC::VM&, JSC::Structure*, Bun::WebStreams::DirectSinkKind);
    ~JSDirectStreamController();
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
