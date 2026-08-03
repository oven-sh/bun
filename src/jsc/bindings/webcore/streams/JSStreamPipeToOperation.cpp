#include "config.h"
#include "JSStreamPipeToOperation.h"

#include "AbortSignal.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSAbortAlgorithm.h"
#include "JSAbortSignal.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSReadRequest.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamsRuntime.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultWriter.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static void pipeToLoopStep(JSGlobalObject*, JSStreamPipeToOperation*);
static void performPipeShutdownAction(JSGlobalObject*, JSStreamPipeToOperation*);

const ClassInfo JSStreamPipeToOperation::s_info = { "StreamPipeToOperation"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSStreamPipeToOperation) };

JSStreamPipeToOperation::JSStreamPipeToOperation(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSStreamPipeToOperation::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSStreamPipeToOperation* JSStreamPipeToOperation::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSStreamPipeToOperation>(vm)) JSStreamPipeToOperation(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSStreamPipeToOperation::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSStreamPipeToOperation::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSStreamPipeToOperation, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForStreamPipeToOperation.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForStreamPipeToOperation = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForStreamPipeToOperation.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForStreamPipeToOperation = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSStreamPipeToOperation);

template<typename Visitor>
void JSStreamPipeToOperation::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSStreamPipeToOperation>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_source);
    visitor.appendHidden(thisObject->m_destination);
    visitor.appendHidden(thisObject->m_reader);
    visitor.appendHidden(thisObject->m_writer);
    visitor.appendHidden(thisObject->m_signal);
    visitor.appendHidden(thisObject->m_promise);
    visitor.appendHidden(thisObject->m_currentWrite);
    visitor.appendHidden(thisObject->m_shutdownActionPromise);
    visitor.appendHidden(thisObject->m_shutdownError);
}

void JSStreamPipeToOperation::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSStreamPipeToOperation>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_source, "source"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_destination, "destination"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_reader, "reader"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_writer, "writer"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_signal, "signal"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_promise, "promise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_currentWrite, "currentWrite"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_shutdownActionPromise, "shutdownActionPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_shutdownError, "shutdownError"_s);
}

static JSValue pipeShutdownError(JSStreamPipeToOperation* op)
{
    if (!op->m_hasShutdownError)
        return jsUndefined();
    JSValue error = op->m_shutdownError.get();
    return error ? error : jsUndefined();
}

static void registerPipeReaction(JSGlobalObject* globalObject, JSPromise* promise, JSFunction* onFulfilled, JSFunction* onRejected, JSObject* context)
{
    auto& vm = getVM(globalObject);
    // With no result capability, JSC requires BOTH handlers to be callable: a non-callable
    // handler routes the settlement through PromiseResolveWithoutHandlerJob, which does an
    // unconditional [[Get]] on the (here undefined) capability. Substitute the shared no-op.
    auto* runtime = JSStreamsRuntime::from(globalObject);
    promise->performPromiseThenWithContext(vm, globalObject, onFulfilled ? onFulfilled : runtime->onReturnUndefined(), onRejected ? onRejected : runtime->onReturnUndefined(), jsUndefined(), context);
}

// [reaction-convention] deferral: runs handler(value, context) as its own microtask,
// carrying the current async context, without allocating a promise.
static void queuePipeReactionJob(JSC::VM& vm, JSGlobalObject* globalObject, JSFunction* handler, JSValue value, JSValue context)
{
    JSValue asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);
    if (asyncContext.isEmpty())
        asyncContext = jsUndefined();
    QueuedTask task { nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, handler, asyncContext, value, context };
    vm.queueMicrotask(WTF::move(task));
}

// Publish a write for the shutdown paths: m_currentWrite is the newest write, and every
// write gets the settled reaction that re-checks the pipe's state.
static void publishPipeWrite(JSGlobalObject* globalObject, JSStreamPipeToOperation* op, JSPromise* writePromise)
{
    auto& vm = getVM(globalObject);
    op->m_currentWrite.set(vm, op, writePromise);
    auto* settledHandler = JSStreamsRuntime::from(globalObject)->onPipeWriteSettled();
    registerPipeReaction(globalObject, writePromise, settledHandler, settledHandler, op);
}

// One tick of the read/write loop: backpressure first, then at most one read.
static void pipeToLoopStep(JSGlobalObject* globalObject, JSStreamPipeToOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (op->m_shuttingDown || op->m_finalized || op->m_readInFlight)
        return;
    auto* writer = op->m_writer.get();
    auto desiredSize = writableStreamDefaultWriterGetDesiredSize(writer);
    // null: the destination is erroring/errored; the backward error observer shuts the pipe down.
    if (!desiredSize)
        return;
    auto* runtime = JSStreamsRuntime::from(globalObject);
    if (*desiredSize <= 0) {
        registerPipeReaction(globalObject, writer->readyPromise(globalObject), runtime->onPipeWriterReadyFulfilled(), nullptr, op);
        return;
    }
    auto* readRequest = JSReadRequest::create(vm, runtime->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::PipeTo, op);
    op->m_readInFlight = true;
    readableStreamDefaultReaderRead(globalObject, op->m_reader.get(), readRequest);
    RETURN_IF_EXCEPTION(scope, );
}

// The pipe's signal abort algorithm: START both actions back-to-back, then wait for ALL of
// them. The wait-for-all latch is `op->m_pendingShutdownActions`; the last settlement
// proceeds, and the FIRST rejection finalizes with its reason (finalize is idempotent).
static void startPipeAbortBothActions(JSC::VM& vm, JSGlobalObject* globalObject, JSStreamPipeToOperation* op, JSValue error)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSPromise* actions[2] = { nullptr, nullptr };
    unsigned actionCount = 0;
    if (!op->m_preventAbort) {
        auto* destination = op->m_destination.get();
        if (destination->m_state == WritableStreamState::Writable)
            actions[actionCount] = writableStreamAbort(globalObject, destination, error);
        else
            actions[actionCount] = promiseFulfilledWith(globalObject, JSC::jsUndefined());
        RETURN_IF_EXCEPTION(scope, );
        actionCount++;
    }
    if (!op->m_preventCancel) {
        // The per-action state guard is evaluated when the action is invoked (after the abort).
        auto* source = op->m_source.get();
        if (source->m_state == ReadableStreamState::Readable)
            actions[actionCount] = readableStreamCancel(globalObject, source, error);
        else
            actions[actionCount] = promiseFulfilledWith(globalObject, JSC::jsUndefined());
        RETURN_IF_EXCEPTION(scope, );
        actionCount++;
    }
    if (!actionCount)
        RELEASE_AND_RETURN(scope, op->finalize(globalObject));
    op->m_shutdownActionPromise.set(vm, op, actions[0]);
    op->m_pendingShutdownActions = static_cast<uint8_t>(actionCount);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    for (unsigned i = 0; i < actionCount; i++)
        registerPipeReaction(globalObject, actions[i], runtime->onPipeShutdownActionFulfilled(), runtime->onPipeShutdownActionRejected(), op);
}

// spec "shutdown with an action" step 4: perform the pending action exactly once.
static void performPipeShutdownAction(JSGlobalObject* globalObject, JSStreamPipeToOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (op->m_finalized || op->m_shutdownActionPromise)
        return;
    JSValue error = pipeShutdownError(op);
    JSPromise* actionPromise = nullptr;
    switch (op->m_pendingShutdownAction) {
    case JSStreamPipeToOperation::ShutdownAction::None:
        RELEASE_AND_RETURN(scope, op->finalize(globalObject));
    case JSStreamPipeToOperation::ShutdownAction::AbortDestination:
        actionPromise = writableStreamAbort(globalObject, op->m_destination.get(), error);
        break;
    case JSStreamPipeToOperation::ShutdownAction::CancelSource:
        actionPromise = readableStreamCancel(globalObject, op->m_source.get(), error);
        break;
    case JSStreamPipeToOperation::ShutdownAction::CloseDestinationWithErrorPropagation:
        actionPromise = writableStreamDefaultWriterCloseWithErrorPropagation(globalObject, op->m_writer.get());
        break;
    case JSStreamPipeToOperation::ShutdownAction::AbortBoth:
        RELEASE_AND_RETURN(scope, startPipeAbortBothActions(vm, globalObject, op, error));
    }
    RETURN_IF_EXCEPTION(scope, );
    op->m_shutdownActionPromise.set(vm, op, actionPromise);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    registerPipeReaction(globalObject, actionPromise, runtime->onPipeShutdownActionFulfilled(), runtime->onPipeShutdownActionRejected(), op);
}

void JSStreamPipeToOperation::checkErrorsMustBePropagatedForward(JSGlobalObject* globalObject)
{
    const auto* source = m_source.get();
    if (source->m_state != ReadableStreamState::Errored)
        return;
    JSValue storedError = source->m_storedError.get();
    if (!storedError)
        storedError = jsUndefined();
    if (!m_preventAbort)
        shutdownWithAction(globalObject, ShutdownAction::AbortDestination, storedError, true);
    else
        shutdown(globalObject, storedError, true);
}

void JSStreamPipeToOperation::checkErrorsMustBePropagatedBackward(JSGlobalObject* globalObject)
{
    const auto* destination = m_destination.get();
    if (destination->m_state != WritableStreamState::Errored)
        return;
    JSValue storedError = destination->m_storedError.get();
    if (!storedError)
        storedError = jsUndefined();
    if (!m_preventCancel)
        shutdownWithAction(globalObject, ShutdownAction::CancelSource, storedError, true);
    else
        shutdown(globalObject, storedError, true);
}

void JSStreamPipeToOperation::checkClosingMustBePropagatedForward(JSGlobalObject* globalObject)
{
    if (m_source->m_state != ReadableStreamState::Closed)
        return;
    if (!m_preventClose)
        shutdownWithAction(globalObject, ShutdownAction::CloseDestinationWithErrorPropagation, jsUndefined(), false);
    else
        shutdown(globalObject, jsUndefined(), false);
}

void JSStreamPipeToOperation::checkClosingMustBePropagatedBackward(JSGlobalObject* globalObject)
{
    auto* destination = m_destination.get();
    if (!writableStreamCloseQueuedOrInFlight(destination) && destination->m_state != WritableStreamState::Closed)
        return;
    JSValue destClosed = createTypeError(globalObject, "The destination WritableStream closed before all of the data could be piped to it"_s);
    if (!m_preventCancel)
        shutdownWithAction(globalObject, ShutdownAction::CancelSource, destClosed, true);
    else
        shutdown(globalObject, destClosed, true);
}

void JSStreamPipeToOperation::shutdownWithAction(JSGlobalObject* globalObject, ShutdownAction action, JSValue error, bool hasError)
{
    if (m_shuttingDown)
        return;
    auto& vm = getVM(globalObject);
    m_shuttingDown = true;
    m_pendingShutdownAction = action;
    if (hasError) {
        m_hasShutdownError = true;
        m_shutdownError.set(vm, this, error);
    }
    auto* destination = m_destination.get();
    if (destination->m_state == WritableStreamState::Writable && !writableStreamCloseQueuedOrInFlight(destination)) {
        if (auto* currentWrite = m_currentWrite.get(); currentWrite && currentWrite->status() == JSPromise::Status::Pending) {
            onWritesFinishedForShutdown(globalObject);
            return;
        }
        // Step 3.2's write-drain wait is ALWAYS a reaction ("In parallel"): with no pending
        // write, defer so no shutdown effect is observable inside the pipeTo() call.
        queuePipeReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onPipeWritesFinishedForShutdown(), jsUndefined(), this);
        return;
    }
    performPipeShutdownAction(globalObject, this);
}

void JSStreamPipeToOperation::shutdown(JSGlobalObject* globalObject, JSValue error, bool hasError)
{
    shutdownWithAction(globalObject, ShutdownAction::None, error, hasError);
}

void JSStreamPipeToOperation::finalize(JSGlobalObject* globalObject)
{
    if (m_finalized)
        return;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    m_finalized = true;
    auto* writer = m_writer.get();
    auto* reader = m_reader.get();
    // Unconditional obligations first (back-edges, abort-algorithm removal, the promise and
    // error to settle with) so a throwing release cannot skip them.
    writer->m_pipeOperation.clear();
    reader->m_pipeOperation.clear();
    if (m_abortAlgorithmId) {
        auto& signal = downcast<JSAbortSignal>(m_signal.get())->wrapped();
        AbortSignal::removeAbortAlgorithmFromSignal(signal, m_abortAlgorithmId);
        m_abortAlgorithmId = 0;
    }
    auto* promise = m_promise.get();
    bool hasShutdownError = m_hasShutdownError;
    JSValue shutdownError = pipeShutdownError(this);
    writableStreamDefaultWriterRelease(globalObject, writer);
    RETURN_IF_EXCEPTION(scope, );
    readableStreamDefaultReaderRelease(globalObject, reader);
    RETURN_IF_EXCEPTION(scope, );
    if (hasShutdownError)
        RELEASE_AND_RETURN(scope, rejectPromise(globalObject, promise, shutdownError));
    RELEASE_AND_RETURN(scope, resolvePromise(globalObject, promise, jsUndefined()));
}

void JSStreamPipeToOperation::onSourceClosedFulfilled(JSGlobalObject* globalObject)
{
    if (m_finalized)
        return;
    checkClosingMustBePropagatedForward(globalObject);
}

void JSStreamPipeToOperation::onSourceClosedRejected(JSGlobalObject* globalObject, JSValue)
{
    if (m_finalized)
        return;
    checkErrorsMustBePropagatedForward(globalObject);
}

void JSStreamPipeToOperation::onDestClosedFulfilled(JSGlobalObject* globalObject)
{
    if (m_finalized)
        return;
    checkClosingMustBePropagatedBackward(globalObject);
}

void JSStreamPipeToOperation::onDestClosedRejected(JSGlobalObject* globalObject, JSValue)
{
    if (m_finalized)
        return;
    checkErrorsMustBePropagatedBackward(globalObject);
}

void JSStreamPipeToOperation::onWriterReadyFulfilled(JSGlobalObject* globalObject)
{
    pipeToLoopStep(globalObject, this);
}

// Reacting to every write promise is the point (no spurious unhandledRejection); the
// loop and shutdown are driven by the read requests and onWritesFinishedForShutdown.
void JSStreamPipeToOperation::onWriteSettled(JSGlobalObject*)
{
}

// "Wait until every chunk that has been read has been written": re-checks the CURRENT
// write each time (a chunk read before shutdown may start one more write meanwhile).
void JSStreamPipeToOperation::onWritesFinishedForShutdown(JSGlobalObject* globalObject)
{
    if (m_finalized)
        return;
    if (auto* currentWrite = m_currentWrite.get(); currentWrite && currentWrite->status() == JSPromise::Status::Pending) {
        auto* handler = JSStreamsRuntime::from(globalObject)->onPipeWritesFinishedForShutdown();
        registerPipeReaction(globalObject, currentWrite, handler, handler, this);
        return;
    }
    performPipeShutdownAction(globalObject, this);
}

void JSStreamPipeToOperation::onShutdownActionFulfilled(JSGlobalObject* globalObject)
{
    if (m_finalized)
        return;
    finalize(globalObject);
}

void JSStreamPipeToOperation::onShutdownActionRejected(JSGlobalObject* globalObject, JSValue error)
{
    if (m_finalized)
        return;
    auto& vm = getVM(globalObject);
    m_hasShutdownError = true;
    m_shutdownError.set(vm, this, error);
    finalize(globalObject);
}

void JSStreamPipeToOperation::onSignalAbort(JSGlobalObject* globalObject, JSValue reason)
{
    if (m_finalized)
        return;
    shutdownWithAction(globalObject, ShutdownAction::AbortBoth, reason, true);
}

#define WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE(name, method)                                                \
    JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_##name, (JSGlobalObject * globalObject, CallFrame * callFrame)) \
    {                                                                                                            \
        auto& vm = getVM(globalObject);                                                                          \
        auto scope = DECLARE_THROW_SCOPE(vm);                                                                    \
        JSValue contextValue = callFrame->argument(1);                                                           \
        auto* op = dynamicDowncast<JSStreamPipeToOperation>(contextValue);                                       \
        if (!op) [[unlikely]]                                                                                    \
            return JSValue::encode(jsUndefined());                                                               \
        op->method(globalObject);                                                                                \
        RETURN_IF_EXCEPTION(scope, {});                                                                          \
        return JSValue::encode(jsUndefined());                                                                   \
    }
#define WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE_WITH_VALUE(name, method)                                     \
    JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_##name, (JSGlobalObject * globalObject, CallFrame * callFrame)) \
    {                                                                                                            \
        auto& vm = getVM(globalObject);                                                                          \
        auto scope = DECLARE_THROW_SCOPE(vm);                                                                    \
        JSValue contextValue = callFrame->argument(1);                                                           \
        auto* op = dynamicDowncast<JSStreamPipeToOperation>(contextValue);                                       \
        if (!op) [[unlikely]]                                                                                    \
            return JSValue::encode(jsUndefined());                                                               \
        op->method(globalObject, callFrame->argument(0));                                                        \
        RETURN_IF_EXCEPTION(scope, {});                                                                          \
        return JSValue::encode(jsUndefined());                                                                   \
    }

WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE(onPipeSourceClosedFulfilled, onSourceClosedFulfilled)
WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE_WITH_VALUE(onPipeSourceClosedRejected, onSourceClosedRejected)
WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE(onPipeDestClosedFulfilled, onDestClosedFulfilled)
WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE_WITH_VALUE(onPipeDestClosedRejected, onDestClosedRejected)
WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE(onPipeWriterReadyFulfilled, onWriterReadyFulfilled)
WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE(onPipeWriteSettled, onWriteSettled)
WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE(onPipeWritesFinishedForShutdown, onWritesFinishedForShutdown)

#undef WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE
#undef WEB_STREAMS_DEFINE_PIPE_REACTION_TRAMPOLINE_WITH_VALUE

// [reaction-convention] the deferred sink write, queued as a plain job (no result
// capability, so any throw must settle the published promise itself). argument(0) = the
// chunk; context = InternalFieldTuple{op, the promise published as m_currentWrite}, which
// adopts the real write's settlement. After the head write, chunks the source already has
// queued are written in place while the destination reports capacity: no read request, no
// extra microtask per chunk. The dequeue and the write both run user JS, so every guard is
// re-established around each of them.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onPipeChunkDeferredWrite, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* context = dynamicDowncast<InternalFieldTuple>(callFrame->argument(1));
    if (!context) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto* op = dynamicDowncast<JSStreamPipeToOperation>(context->getInternalField(0));
    if (!op) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto* trackingPromise = uncheckedDowncast<JSPromise>(context->getInternalField(1));
    do {
        if (op->m_finalized) {
            resolvePromise(globalObject, trackingPromise, jsUndefined());
            break;
        }
        auto* writePromise = writableStreamDefaultWriterWrite(globalObject, op->m_writer.get(), callFrame->argument(0));
        if (catchScope.exception()) [[unlikely]]
            break;
        writePromise->performPromiseThenWithContext(vm, globalObject, jsUndefined(), jsUndefined(), trackingPromise, jsUndefined());
        if (catchScope.exception()) [[unlikely]]
            break;

        while (!op->m_finalized && !op->m_shuttingDown) {
            auto* writer = op->m_writer.get();
            auto desiredSize = writableStreamDefaultWriterGetDesiredSize(writer);
            if (!desiredSize || *desiredSize <= 0)
                break;
            auto* reader = op->m_reader.get();
            if (!reader)
                break;
            JSValue next = readableStreamDefaultReaderTryReadFromQueue(globalObject, reader);
            if (catchScope.exception()) [[unlikely]]
                break;
            if (!next)
                break;
            // The dequeue can run the source's pull(): re-check before touching the writer.
            // A dequeued chunk must still be written if a shutdown merely began (the
            // shutdown waits on m_currentWrite); only a finalized op or a replaced writer
            // makes the write invalid.
            if (op->m_finalized || op->m_writer.get() != writer)
                break;
            auto* nextWrite = writableStreamDefaultWriterWrite(globalObject, writer, next);
            if (catchScope.exception()) [[unlikely]]
                break;
            publishPipeWrite(globalObject, op, nextWrite);
            if (catchScope.exception()) [[unlikely]]
                break;
        }
    } while (false);
    if (catchScope.exception()) [[unlikely]] {
        JSValue error = takeAbruptCompletion(globalObject, catchScope);
        if (error.isEmpty())
            return JSValue::encode(jsUndefined());
        // The shutdown paths wait on the published m_currentWrite: never leave it pending.
        if (trackingPromise->status() == JSPromise::Status::Pending)
            rejectPromise(globalObject, trackingPromise, error);
    }
    return JSValue::encode(jsUndefined());
}

// [reaction-convention] shutdown-action settlement. The context is the op cell; the
// AbortBoth wait-for-all is the op's m_pendingShutdownActions counter.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onPipeShutdownActionFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = dynamicDowncast<JSStreamPipeToOperation>(callFrame->argument(1));
    if (!op) [[unlikely]]
        return JSValue::encode(jsUndefined());
    if (op->m_pendingShutdownActions > 1) {
        op->m_pendingShutdownActions--;
        return JSValue::encode(jsUndefined());
    }
    op->m_pendingShutdownActions = 0;
    op->onShutdownActionFulfilled(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// The wait-for-all rejects immediately with the FIRST rejection's reason; finalize is
// idempotent, so the other action's later settlement is a no-op.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onPipeShutdownActionRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = dynamicDowncast<JSStreamPipeToOperation>(callFrame->argument(1));
    if (!op) [[unlikely]]
        return JSValue::encode(jsUndefined());
    op->m_pendingShutdownActions = 0;
    op->onShutdownActionRejected(globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// [bound-convention]: (pipeOpCell, reason).
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundPipeAbortAlgorithm, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue contextValue = callFrame->argument(0);
    auto* op = dynamicDowncast<JSStreamPipeToOperation>(contextValue);
    if (!op) [[unlikely]]
        return JSValue::encode(jsUndefined());
    op->onSignalAbort(globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;

void startPipeToOperation(JSGlobalObject* globalObject, JSStreamPipeToOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);

    if (JSObject* signalObject = op->m_signal.get()) {
        auto& signal = downcast<WebCore::JSAbortSignal>(signalObject)->wrapped();
        if (signal.aborted()) {
            JSValue reason = signal.jsReason(*globalObject);
            RETURN_IF_EXCEPTION(scope, );
            RELEASE_AND_RETURN(scope, op->onSignalAbort(globalObject, reason));
        }
        MarkedArgumentBuffer boundArguments;
        boundArguments.append(op);
        ASSERT(!boundArguments.hasOverflowed());
        auto sourceCode = makeSource("pipeToAbortAlgorithm"_s, SourceOrigin(), SourceTaintedOrigin::Untainted);
        auto* boundAlgorithm = JSBoundFunction::create(vm, globalObject, runtime->boundPipeAbortAlgorithm(), jsUndefined(), ArgList(boundArguments), 1, nullptr, sourceCode);
        RETURN_IF_EXCEPTION(scope, );
        op->m_abortAlgorithmId = WebCore::AbortSignal::addAbortAlgorithmToSignal(signal, WebCore::JSAbortAlgorithm::create(vm, boundAlgorithm));
    }

    const auto* reader = op->m_reader.get();
    const auto* writer = op->m_writer.get();
    WebCore::registerPipeReaction(globalObject, reader->m_closedPromise.get(), runtime->onPipeSourceClosedFulfilled(), runtime->onPipeSourceClosedRejected(), op);
    WebCore::registerPipeReaction(globalObject, writer->m_closedPromise.get(), runtime->onPipeDestClosedFulfilled(), runtime->onPipeDestClosedRejected(), op);

    op->checkErrorsMustBePropagatedForward(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    op->checkErrorsMustBePropagatedBackward(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    op->checkClosingMustBePropagatedForward(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    op->checkClosingMustBePropagatedBackward(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, WebCore::pipeToLoopStep(globalObject, op));
}

// The PipeTo read request's steps (JSReadRequest.cpp dispatches its PipeTo arm here).
// No {value,done} object and no read promise: the chunk goes straight into the writer.
void pipeToReadRequestChunkSteps(JSGlobalObject* globalObject, JSStreamPipeToOperation* op, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    op->m_readInFlight = false;
    if (op->m_finalized)
        return;
    auto* writer = op->m_writer.get();
    auto* runtime = JSStreamsRuntime::from(globalObject);
    // The sink write is deferred by one microtask so an enqueue() inside the source never
    // synchronously reenters the destination's write algorithm. m_currentWrite is the deferred
    // write's promise, so a shutdown that must drain the pending writes still waits for it.
    auto* writePromise = JSPromise::create(vm, globalObject->promiseStructure());
    auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), op, writePromise);
    queuePipeReactionJob(vm, globalObject, runtime->onPipeChunkDeferredWrite(), chunk, context);
    publishPipeWrite(globalObject, op, writePromise);
    RETURN_IF_EXCEPTION(scope, );
    // A shutdown that is waiting on m_currentWrite re-checks it when its reaction fires.
    if (op->m_shuttingDown)
        return;
    RELEASE_AND_RETURN(scope, WebCore::registerPipeReaction(globalObject, writer->readyPromise(globalObject), runtime->onPipeWriterReadyFulfilled(), nullptr, op));
}

void pipeToReadRequestCloseSteps(JSGlobalObject* globalObject, JSStreamPipeToOperation* op)
{
    op->m_readInFlight = false;
    if (op->m_finalized)
        return;
    op->checkClosingMustBePropagatedForward(globalObject);
}

void pipeToReadRequestErrorSteps(JSGlobalObject* globalObject, JSStreamPipeToOperation* op, JSValue)
{
    op->m_readInFlight = false;
    if (op->m_finalized)
        return;
    op->checkErrorsMustBePropagatedForward(globalObject);
}

} // namespace WebStreams
} // namespace Bun
