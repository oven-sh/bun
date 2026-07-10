// BunStreamSource.h — JSNativeStreamSourceAdapter, the C++ port of the old
// NativeReadableStreamSource JS class. Its .cpp also owns materializeNativeSource and the
// SourceKind::Native pull/cancel/start algorithm arms.
//
// DESTRUCTIBLE: it owns a JSC::Weak (a non-trivially-destructible member).
// The Weak member is THE one sanctioned JSC::Weak in the whole subsystem: a STRONG back-edge
// would let Rust's external Strong root on the native handle pin the entire abandoned JS
// consumer graph forever.
// Internal cell: no prototype, no constructor, never exposed to JS.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableByteStreamController.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/Weak.h>

namespace WebCore {

class JSNativeStreamSourceAdapter final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSNativeStreamSourceAdapter* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_handle, m_pendingView, m_closer, m_drainValue.
    // m_controller is a JSC::Weak and MUST NOT be visited (that is the whole point).
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

    // the JS{Blob,File,Bytes}InternalReadableStreamSource handle cell. CLEARED (with
    // handle.onClose/onDrain and m_pendingView) on all three terminal paths.
    JSC::WriteBarrier<JSC::JSObject> m_handle;
    // `$data`: the unfilled tail Uint8Array reused across pulls.
    JSC::WriteBarrier<JSC::JSObject> m_pendingView;
    // `#closer`: a per-instance length-1 JSArray the native pull writes EOF into (#29787).
    JSC::WriteBarrier<JSC::JSObject> m_closer;
    // the drain value returned by handle.start()/drain(), enqueued by the Native
    // startAlgorithm and then cleared.
    JSC::WriteBarrier<JSC::Unknown> m_drainValue;
    // THE ONE SANCTIONED JSC::Weak in the subsystem. Null-check EVERY read: null ⇒ the JS
    // consumer side was collected ⇒ drop the data / no-op. Assigned lazily — never eagerly.
    JSC::Weak<JSReadableByteStreamController> m_controller;
    // adaptive chunk size (256 KiB default, doubled once up to 2 MiB).
    size_t m_chunkSize { 0 };
    // #hasResized — the one-shot chunk-size adaptation already happened.
    bool m_hasResized : 1 { false };
    // #closed
    bool m_closed : 1 { false };
    // the in-flight async pull's m_pendingView is the head pull-into descriptor's buffer
    // (respond(n) on fulfilment) rather than an adapter-owned scratch buffer (enqueue()).
    bool m_pendingIsBYOB : 1 { false };

private:
    JSNativeStreamSourceAdapter(JSC::VM&, JSC::Structure*);
    ~JSNativeStreamSourceAdapter();
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
