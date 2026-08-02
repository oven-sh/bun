// JSTransformStream — the TransformStream instance cell, and the C++ base of the
// native TransformerKind specializations (JSCompressionStream, JSDecompressionStream,
// JSTextEncoderStream, JSTextDecoderStream). Destructible so those subclasses can
// free their Rust state; this base's destructor is trivial.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSTransformStream : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    // Internal (non-user) allocation entry point (setUpNativeTransformStream).
    static JSTransformStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_readable, m_writable, m_controller,
    // m_backpressureChangePromise, m_pendingWriteChunk.
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
    // [[Detached]] (transferable streams are not implemented; the slot exists)
    bool m_detached : 1 { false };

    // Native byte-producing subclasses only: when `readStreamIntoSink` attaches a
    // native JSSink controller to this transform, the transform arms write coder
    // output straight to `m_nativeSinkPtr` via `JSSink__writeBytes` instead of
    // wrapping it in a JSUint8Array and enqueueing on the readable.
    // `m_nativeSinkReadyPromise` is the transform-algorithm result returned on
    // sink backpressure; the sink's onReady resolves it.
    JSC::WriteBarrier<JSC::JSObject> m_nativeSinkCell;
    JSC::WriteBarrier<JSC::JSPromise> m_nativeSinkReadyPromise;
    void* m_nativeSinkPtr { nullptr };
    uint8_t m_nativeSinkId { 0 };

protected:
    JSTransformStream(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

using JSTransformStreamConstructor = JSStreamConstructor<JSTransformStream>;

} // namespace WebCore
