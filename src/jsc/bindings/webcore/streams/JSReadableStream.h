// JSReadableStream — the ReadableStream instance cell. ONE GC cell IS the stream: no
// wrapped impl, no RefCounted, no toWrapped.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <limits>

namespace WebCore {

// Non-destructible (owns no WTF container).
class JSReadableStream final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    // Internal (non-user) allocation entry point; callers use getDOMStructure<JSReadableStream>().
    static JSReadableStream* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_reader, m_storedError, m_controller, m_nativePtr,
    // m_directUnderlyingSource, m_asyncContext, m_closedPromise. No barrier container ⇒ no
    // cellLock needed.
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

    // Spec internal slots

    // [[state]]
    ReadableStreamState m_state { ReadableStreamState::Readable };
    // The Bun lazy-start mode; tells materializeIfNeeded() what to do.
    BunStreamMode m_bunMode { BunStreamMode::Default };
    // The tag for the ERASED m_controller below. Every switch over it is TOTAL.
    ControllerKind m_controllerKind { ControllerKind::None };
    // [[disturbed]]
    bool m_disturbed : 1 { false };
    // [[Detached]] (transferable streams are not implemented; the slot exists)
    bool m_detached : 1 { false };
    // Bun: locked by a native/direct consumer WITHOUT a real reader object. Part of every
    // isReadableStreamLocked() check.
    bool m_lockedWithoutReader : 1 { false };
    // Set by jsFunctionTransferToNativeReadableStream.
    bool m_transferred : 1 { false };
    // `typeof rawHighWaterMark === "number"` at construction time.
    bool m_bunHighWaterMarkIsNumber : 1 { false };
    // `$bunNativeType`: write-only today, kept for the FFI ABI.
    int32_t m_nativeType { 0 };

    // [[reader]] — a default reader, a BYOB reader, or null (undefined).
    JSC::WriteBarrier<JSReadableStreamReaderBase> m_reader;
    // [[storedError]] — gate reads on m_state == Errored (an errored stream's stored error
    // can legitimately BE `undefined`).
    JSC::WriteBarrier<JSC::Unknown> m_storedError;
    // [[controller]] — the subsystem's ONE mandatory ERASED back-pointer: a spec controller,
    // a JSDirectStreamController, or a generated JSReadable*Controller JSSink cell. Raw
    // jsCast/jsDynamicCast on this slot is BANNED; dispatch on m_controllerKind through the
    // total switch.
    JSC::WriteBarrier<JSC::JSObject> m_controller;

    // Bun extension state

    // `$bunNativePtr`: empty = not native; a JSCell = the JS{Blob,File,Bytes}Internal-
    // ReadableStreamSource handle from Rust; jsNumber(-1) = detached.
    JSC::WriteBarrier<JSC::Unknown> m_nativePtr;
    // `$underlyingSource` on the STREAM. Non-null ⇔ type:"direct" AND not yet consumed.
    JSC::WriteBarrier<JSC::JSObject> m_directUnderlyingSource;
    // `$asyncContext` snapshot at construction. Written once in finishCreation.
    JSC::WriteBarrier<JSC::Unknown> m_asyncContext;
    // Settles when the stream reaches a terminal state, for observers that must not lock it
    // (node:stream's finished()). Created on first request; empty until then.
    JSC::WriteBarrier<JSC::JSPromise> m_closedPromise;
    // `$highWaterMark` on the STREAM (the raw strategy HWM, ToNumber'd once). NaN = unset.
    // Written by ALL FOUR constructor arms.
    double m_bunHighWaterMark { std::numeric_limits<double>::quiet_NaN() };
    // autoAllocateChunkSize from $createNativeReadableStream. 0 = unset (=> 256 KiB default).
    uint64_t m_autoAllocateChunkSize { 0 };

    // Bun helpers

    // Runs the lazy-start thunk if any. Idempotent. MUST be the first thing every consumer
    // does. userJS: YES (direct pull setup / native handle.start()).
    void materializeIfNeeded(JSC::JSGlobalObject*);

    // The value the old `$bunNativePtr` DOMAttribute getter returned.
    JSC::JSValue nativePtrForJS() const
    {
        if (m_transferred)
            return JSC::jsNumber(-1);
        return m_nativePtr.get(); // may be empty
    }
    bool nativeHandleDetached() const
    {
        return m_transferred || (m_nativePtr.get().isInt32() && m_nativePtr.get().asInt32() == -1);
    }

private:
    JSReadableStream(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

using JSReadableStreamConstructor = JSStreamConstructor<JSReadableStream>;

} // namespace WebCore
