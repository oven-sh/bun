// JSStreamPipeToOperation — one cell per pipeTo/pipeThrough holding the operation's entire
// state. No closures; one visitChildren.
//
// LIVENESS: the acquired reader and writer each hold a visited m_pipeOperation back-edge to
// THIS cell, set at acquire and cleared in "finalize". Either stream end reachable ⇒ its
// reader/writer ⇒ this op ⇒ the other end. Zero Strong handles.
// The AbortSignal registration MUST go through the GC-visited
// addAbortAlgorithmToSignal/removeAbortAlgorithmFromSignal API (never
// AbortSignal::addAlgorithm) and MUST be removed on every terminal path. The registered
// callable is a JSBoundFunction over the [bound-convention] `boundPipeAbortAlgorithm`
// target (JSStreamsRuntime.h) with THIS cell bound at argument(0) — JSAbortAlgorithm invokes
// it as `(reason)` with no context slot, so a reaction-convention handler cannot be used.
//
// OWNERSHIP: `readableStreamPipeTo` (ReadableStreamOperations.cpp) only validates, allocates
// + populates this cell, and calls `startPipeToOperation(global, op)` (WebStreamsInternals.h).
// EVERYTHING ELSE — the loop, the four propagation checks, shutdown / shutdown-with-an-action
// / finalize, and every onPipe* reaction body — is a method here, owned by
// JSStreamPipeToOperation.cpp.
// Internal cell: no prototype, no constructor. Non-destructible (no WTF-container member).
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultWriter.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSStreamPipeToOperation final : public JSC::JSInternalFieldObjectImpl<9> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<9>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // The piped streams & their acquired lock holders.
        Source = 0, // `source`
        Destination, // `dest`
        // The acquired reader (the reference pipe always uses a default reader, even for a
        // byte source). Its m_pipeOperation points back here.
        Reader,
        // The acquired writer. Its m_pipeOperation points back here.
        Writer,
        // The JSAbortSignal wrapper cell (empty = no signal). Roots the impl the abort algorithm
        // is registered on so removeAbortAlgorithmFromSignal(m_abortAlgorithmId) can always run.
        Signal,
        // Operation state.
        // The promise pipeTo() returned. Roots nothing by itself; kept so finalize can settle it.
        Promise,
        // The promise of the write we are currently reacting to (the pipe reacts to EVERY
        // write-request promise).
        CurrentWrite,
        // "shutdown with an action": the action's promise while it is pending.
        ShutdownActionPromise,
        // The `originalError` / `error` handed to finalize; gated by m_hasShutdownError
        // (an error value of `undefined` is legal).
        ShutdownError,
    };

    static JSStreamPipeToOperation* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSStreamPipeToOperation);
    }

    DECLARE_INFO;
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

    // The pipe state machine. ALL methods: userJS: yes.

    // The CLOSED set of spec "shutdown with an action" actions (no stored closures anywhere
    // in the subsystem, so the pending action is an enum + the ShutdownError field, performed by
    // shutdownWithAction / after onPipeWritesFinishedForShutdown).
    enum class ShutdownAction : uint8_t {
        None, // plain "shutdown" (no action)
        AbortDestination, // ! WritableStreamAbort(dest, error)          — errors forward
        CancelSource, // ! ReadableStreamCancel(source, error)           — errors backward
        CloseDestinationWithErrorPropagation, // writer close-with-error — closing forward
        AbortBoth, // the signal's abort algorithm: abort dest THEN cancel source
    };

    // The four spec propagation checks. Each re-tests its condition from live state (never
    // from a cached snapshot) and triggers shutdown/shutdownWithAction if it holds.
    // spec: "Errors must be propagated forward: if source.[[state]] is/becomes 'errored'".
    void checkErrorsMustBePropagatedForward(JSC::JSGlobalObject*);
    // spec: "Errors must be propagated backward: if dest.[[state]] is/becomes 'errored'".
    void checkErrorsMustBePropagatedBackward(JSC::JSGlobalObject*);
    // spec: "Closing must be propagated forward: if source.[[state]] is/becomes 'closed'".
    void checkClosingMustBePropagatedForward(JSC::JSGlobalObject*);
    // spec: "Closing must be propagated backward: if ! WritableStreamCloseQueuedOrInFlight
    // or dest.[[state]] is 'closed'".
    void checkClosingMustBePropagatedBackward(JSC::JSGlobalObject*);

    // The spec shutdown protocol. `hasError` gates `error` (undefined is a legal error).
    // spec "shutdown with an action": waits for pending writes, performs `action`, finalizes.
    void shutdownWithAction(JSC::JSGlobalObject*, ShutdownAction, JSC::JSValue error, bool hasError);
    // spec "shutdown": waits for pending writes, then finalizes (no action).
    void shutdown(JSC::JSGlobalObject*, JSC::JSValue error, bool hasError);
    // spec "finalize": releases the reader/writer, CLEARS both m_pipeOperation back-edges,
    // removes the abort algorithm, and settles m_promise. Idempotent (m_finalized).
    void finalize(JSC::JSGlobalObject*);

    // The per-reaction entry points. Each jsWebStreamsHandler_onPipe* trampoline
    // (JSStreamsRuntime.h, [reaction-convention]) jsCasts its context cell to THIS class and
    // calls the matching method; the bodies live in JSStreamPipeToOperation.cpp.
    void onSourceClosedFulfilled(JSC::JSGlobalObject*);
    void onSourceClosedRejected(JSC::JSGlobalObject*, JSC::JSValue error);
    void onDestClosedFulfilled(JSC::JSGlobalObject*);
    void onDestClosedRejected(JSC::JSGlobalObject*, JSC::JSValue error);
    void onWriterReadyFulfilled(JSC::JSGlobalObject*);
    // Registered as BOTH the fulfillment and the rejection handler of every write promise.
    void onWriteSettled(JSC::JSGlobalObject*);
    void onWritesFinishedForShutdown(JSC::JSGlobalObject*);
    void onShutdownActionFulfilled(JSC::JSGlobalObject*);
    void onShutdownActionRejected(JSC::JSGlobalObject*, JSC::JSValue error);
    // The signal's abort-algorithm body ([bound-convention] boundPipeAbortAlgorithm):
    // performs the spec's "abort both" shutdown-with-an-action.
    void onSignalAbort(JSC::JSGlobalObject*, JSC::JSValue reason);

    const JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) { return Base::internalField(static_cast<uint32_t>(field)); }

    JSReadableStream* source() const { return uncheckedDowncast<JSReadableStream>(fieldCell(Field::Source)); }
    JSWritableStream* destination() const { return uncheckedDowncast<JSWritableStream>(fieldCell(Field::Destination)); }
    JSReadableStreamDefaultReader* reader() const { return uncheckedDowncast<JSReadableStreamDefaultReader>(fieldCell(Field::Reader)); }
    JSWritableStreamDefaultWriter* writer() const { return uncheckedDowncast<JSWritableStreamDefaultWriter>(fieldCell(Field::Writer)); }
    JSC::JSObject* signal() const { return uncheckedDowncast<JSC::JSObject>(fieldCell(Field::Signal)); }
    JSC::JSPromise* promise() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::Promise)); }
    JSC::JSPromise* currentWrite() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::CurrentWrite)); }
    JSC::JSPromise* shutdownActionPromise() const { return uncheckedDowncast<JSC::JSPromise>(fieldCell(Field::ShutdownActionPromise)); }
    JSC::JSValue shutdownError() const { return internalField(Field::ShutdownError).get(); }

    void setSource(JSC::VM& vm, JSReadableStream* source) { internalField(Field::Source).set(vm, this, source); }
    void setDestination(JSC::VM& vm, JSWritableStream* destination) { internalField(Field::Destination).set(vm, this, destination); }
    void setReader(JSC::VM& vm, JSReadableStreamDefaultReader* reader) { internalField(Field::Reader).set(vm, this, reader); }
    void setWriter(JSC::VM& vm, JSWritableStreamDefaultWriter* writer) { internalField(Field::Writer).set(vm, this, writer); }
    void setSignal(JSC::VM& vm, JSC::JSObject* signal) { internalField(Field::Signal).set(vm, this, signal); }
    void setPromise(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::Promise).set(vm, this, promise); }
    void setCurrentWrite(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::CurrentWrite).set(vm, this, promise); }
    void setShutdownActionPromise(JSC::VM& vm, JSC::JSPromise* promise) { internalField(Field::ShutdownActionPromise).set(vm, this, promise); }
    void setShutdownError(JSC::VM& vm, JSC::JSValue error) { internalField(Field::ShutdownError).set(vm, this, error); }

    // Handle returned by WebCore::addAbortAlgorithmToSignal; 0 = none registered.
    uint32_t m_abortAlgorithmId { 0 };
    // "shutdown with an action" wait-for-all latch: the number of action promises still
    // pending (AbortBoth registers two). The last settlement proceeds.
    uint8_t m_pendingShutdownActions { 0 };
    // The pending-abort action: which spec action shutdownWithAction is to perform once the
    // pending writes drain (onWritesFinishedForShutdown). No closures.
    ShutdownAction m_pendingShutdownAction { ShutdownAction::None };
    bool m_hasShutdownError : 1 { false };
    // `shuttingDown`
    bool m_shuttingDown : 1 { false };
    // set once "finalize" ran (back-edges cleared, abort algorithm removed).
    bool m_finalized : 1 { false };
    // a read has been issued and its read request has not settled yet.
    bool m_readInFlight : 1 { false };
    bool m_preventClose : 1 { false };
    bool m_preventAbort : 1 { false };
    bool m_preventCancel : 1 { false };

private:
    JSStreamPipeToOperation(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);

    JSC::JSCell* fieldCell(Field field) const
    {
        JSC::JSValue value = internalField(field).get();
        return value.isCell() ? value.asCell() : nullptr;
    }
};

} // namespace WebCore
