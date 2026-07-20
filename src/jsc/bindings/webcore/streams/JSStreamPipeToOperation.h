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

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>

namespace WebCore {

class JSStreamPipeToOperation final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSStreamPipeToOperation* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_source, m_destination, m_reader, m_writer, m_signal,
    // m_promise, m_currentWrite, m_shutdownActionPromise, m_shutdownError.
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
    // in the subsystem, so the pending action is an enum + m_shutdownError, performed by
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

    // The piped streams & their acquired lock holders.
    JSC::WriteBarrier<JSReadableStream> m_source; // `source`
    JSC::WriteBarrier<JSWritableStream> m_destination; // `dest`
    // The acquired reader (the reference pipe always uses a default reader, even for a
    // byte source). Its m_pipeOperation points back here.
    JSC::WriteBarrier<JSReadableStreamDefaultReader> m_reader;
    // The acquired writer. Its m_pipeOperation points back here.
    JSC::WriteBarrier<JSWritableStreamDefaultWriter> m_writer;

    // The JSAbortSignal wrapper cell (null = no signal). Roots the impl the abort algorithm
    // is registered on so removeAbortAlgorithmFromSignal(m_abortAlgorithmId) can always run.
    JSC::WriteBarrier<JSC::JSObject> m_signal;
    // Handle returned by WebCore::addAbortAlgorithmToSignal; 0 = none registered.
    uint32_t m_abortAlgorithmId { 0 };

    // Operation state.
    // The promise pipeTo() returned. Roots nothing by itself; kept so finalize can settle it.
    JSC::WriteBarrier<JSC::JSPromise> m_promise;
    // The promise of the write we are currently reacting to (the pipe reacts to EVERY
    // write-request promise).
    JSC::WriteBarrier<JSC::JSPromise> m_currentWrite;
    // "shutdown with an action": the action's promise while it is pending.
    JSC::WriteBarrier<JSC::JSPromise> m_shutdownActionPromise;
    // The `originalError` / `error` handed to finalize; gated by m_hasShutdownError
    // (an error value of `undefined` is legal).
    JSC::WriteBarrier<JSC::Unknown> m_shutdownError;
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
};

} // namespace WebCore
