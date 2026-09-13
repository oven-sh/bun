// JSTransformStream — the TransformStream instance cell, and the C++ base of the
// native TransformerKind specializations (JSCompressionStream, JSDecompressionStream,
// JSTextEncoderStream, JSTextDecoderStream). The subclasses free their native state
// eagerly at ClearAlgorithms with vm.heap.addFinalizer as a fallback; no destroy().
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSTransformStream : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    // Internal (non-user) allocation entry point (setUpNativeTransformStream).
    static JSTransformStream* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit every WriteBarrier field below.
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

    // [[readable]]
    JSC::WriteBarrier<JSReadableStream> m_readable;
    // [[writable]]
    JSC::WriteBarrier<JSWritableStream> m_writable;
    // [[controller]] — exact-typed.
    JSC::WriteBarrier<JSTransformStreamDefaultController> m_controller;
    // [[backpressureChangePromise]] — fulfilled + replaced every time [[backpressure]] flips.
    JSC::WriteBarrier<JSC::JSPromise> m_backpressureChangePromise;
    // Chunk for the single in-flight sink write waiting on backpressure (writes are serialized).
    JSC::WriteBarrier<JSC::Unknown> m_pendingWriteChunk;
    // [[backpressure]] — InitializeTransformStream sets it (to true) before anything reads it,
    // so the spec's initial "undefined" state needs no separate representation.
    bool m_backpressure : 1 { false };
    // Native transform/flush arm is on the stack (coder pointer live); a re-entrant
    // ClearAlgorithms defers the eager free to the arm's epilogue instead.
    bool m_nativeStateInUse : 1 { false };
    bool m_nativeStateReleasePending : 1 { false };
    // An off-thread codec step has the coder's state; ClearAlgorithms / runNativeArm must defer
    // the free until the step's JS-thread completion hands it back and clears this.
    bool m_asyncCodecInFlight : 1 { false };
    // The chunk behind m_codecPromise runs its steps on the thread pool.
    bool m_codecChunkOffThread : 1 { false };

    // Native byte-producing subclasses only: when `readStreamIntoSink` attaches a
    // native JSSink controller to this transform, the transform arms write coder
    // output straight to `m_nativeSinkPtr` via the Rust SinkHandle dispatcher
    // (Bun__NativeTransformSink__writeBytes) instead of wrapping it in a
    // JSUint8Array and enqueueing on the readable.
    // `m_nativeSinkReadyPromise` is the transform-algorithm result returned on
    // sink backpressure; the sink's onReady resolves it.
    JSC::WriteBarrier<JSC::JSObject> m_nativeSinkCell;
    JSC::WriteBarrier<JSC::JSPromise> m_nativeSinkReadyPromise;
    // Compression/Decompression only: transform-algorithm promise of a chunk whose codec
    // steps span turns (off-thread, or waiting for the consumer to take the output so far);
    // the consumer drives it on (WebStreamsInternals.h: nativeCodecContinue / Abandon). While
    // set, the coder holds that chunk's state and ClearAlgorithms defers the coder release.
    JSC::WriteBarrier<JSC::JSPromise> m_codecPromise;
    void* m_nativeSinkPtr { nullptr };
    uint8_t m_nativeSinkId { 0 };

protected:
    JSTransformStream(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

using JSTransformStreamConstructor = JSStreamConstructor<JSTransformStream>;

} // namespace WebCore
