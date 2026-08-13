// JSWritableStream — the WritableStream instance cell. ONE GC cell IS the stream (there is
// no InternalWritableStream / WritableStream impl split).
// DESTRUCTIBLE (owns the [[writeRequests]] Deque).
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <wtf/Deque.h>

namespace Bun {
namespace WebStreams {

// WritableStream [[pendingAbortRequest]]. "the slot is undefined" ⇔ `!promise`
// (gate on the barrier, never on a separate bool). Declared here (not WebStreamsInternals.h)
// because it is a member of JSWritableStream.
struct PendingAbortRequest {
    JSC::WriteBarrier<JSC::JSPromise> promise; // "promise"
    JSC::WriteBarrier<JSC::Unknown> reason; // "reason"
    bool wasAlreadyErroring { false }; // "was already erroring"
};

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

class JSWritableStream final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    // Internal (non-user) allocation entry point (createWritableStream / transform / transfer).
    static JSWritableStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_controller, m_writer, m_storedError, m_closeRequest,
    // m_inFlightWriteRequest, m_inFlightCloseRequest, m_closedPromise,
    // m_pendingAbortRequest.{promise,reason}, and m_writeRequests (a barrier container: UNDER
    // cellLock()).
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSC::JSCell*, JSC::HeapAnalyzer&);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // Spec internal slots

    // [[writeRequests]] — a deque of PROMISES, not of request cells.
    // Mutated AND visited under cellLock().
    WTF::Deque<JSC::WriteBarrier<JSC::JSPromise>, 4> m_writeRequests;
    // [[controller]] — exact-typed (only the readable side is erased).
    JSC::WriteBarrier<JSWritableStreamDefaultController> m_controller;
    // [[writer]]
    JSC::WriteBarrier<JSWritableStreamDefaultWriter> m_writer;
    // [[storedError]] — gate reads on m_state.
    JSC::WriteBarrier<JSC::Unknown> m_storedError;
    // [[closeRequest]]
    JSC::WriteBarrier<JSC::JSPromise> m_closeRequest;
    // [[inFlightWriteRequest]]
    JSC::WriteBarrier<JSC::JSPromise> m_inFlightWriteRequest;
    // [[inFlightCloseRequest]]
    JSC::WriteBarrier<JSC::JSPromise> m_inFlightCloseRequest;
    // Settles when the stream reaches a terminal state, for observers that must not lock it
    // (node:stream's finished()). Created on first request; empty until then.
    JSC::WriteBarrier<JSC::JSPromise> m_closedPromise;
    // [[pendingAbortRequest]] — "undefined" ⇔ !m_pendingAbortRequest.promise.
    Bun::WebStreams::PendingAbortRequest m_pendingAbortRequest;
    // [[state]]
    WritableStreamState m_state { WritableStreamState::Writable };
    // [[backpressure]]
    bool m_backpressure : 1 { false };
    // [[Detached]] (transferable streams are not implemented; the slot exists)
    bool m_detached : 1 { false };

private:
    JSWritableStream(JSC::VM&, JSC::Structure*);
    ~JSWritableStream();
    void finishCreation(JSC::VM&);
};

using JSWritableStreamConstructor = JSStreamConstructor<JSWritableStream>;

} // namespace WebCore
