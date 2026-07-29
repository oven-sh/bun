// BunStreamSource.h — JSNativeStreamSourceAdapter, the C++ port of the old
// NativeReadableStreamSource JS class. Its .cpp also owns materializeNativeSource and the
// SourceKind::Native pull/cancel/start algorithm arms.
//
// Internal cell: no prototype, no constructor, never exposed to JS. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableStreamDefaultController.h"
#include <JavaScriptCore/JSObject.h>

namespace WebCore {

class JSNativeStreamSourceAdapter final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSNativeStreamSourceAdapter* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_handle, m_pendingView, m_closer, m_drainValue, m_controller.
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
    // Visited (roots the consumer graph while the adapter is a queued reaction
    // context); cleared on every terminal path.
    JSC::WriteBarrier<JSReadableStreamDefaultController> m_controller;
    // adaptive chunk size (256 KiB default, doubled once up to 2 MiB).
    size_t m_chunkSize { 0 };
    // #hasResized — the one-shot chunk-size adaptation already happened.
    bool m_hasResized : 1 { false };
    // #closed
    bool m_closed : 1 { false };
    // Body.textStream(): each pulled byte span is UTF-8-decoded before enqueue.
    bool m_textMode : 1 { false };
    Bun::WebStreams::StreamingUTF8DecodeState m_textState;

private:
    JSNativeStreamSourceAdapter(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
