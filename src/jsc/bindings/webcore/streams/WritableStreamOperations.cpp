#include "config.h"
#include "WebStreamsInternals.h"

#include "AbortController.h"
#include "ErrorCode.h"
#include "JSAbortController.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSStreamsRuntime.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultController.h"
#include "JSWritableStreamDefaultWriter.h"
#include "StreamQueue.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Microtask.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <wtf/Locker.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;

static void clearPendingAbortRequest(JSWritableStream* stream)
{
    stream->m_pendingAbortRequest.promise.clear();
    stream->m_pendingAbortRequest.reason.clear();
    stream->m_pendingAbortRequest.wasAlreadyErroring = false;
}

// SetUpWritableStreamDefaultController, minus reacting to the start result. The algorithm
// slots and the size algorithm were already populated on `controller` by the caller.
static void setUpWritableStreamDefaultControllerBeforeStart(JSC::VM& vm, JSGlobalObject* globalObject, JSWritableStream* __restrict stream, JSWritableStreamDefaultController* __restrict controller, double highWaterMark)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    ASSERT(!stream->m_controller);
    controller->m_stream.set(vm, controller, stream);
    stream->m_controller.set(vm, stream, controller);
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.resetQueue(locker);
    }

    auto* domGlobalObject = defaultGlobalObject(globalObject);
    JSValue abortController = WebCore::toJSNewlyCreated(globalObject, domGlobalObject, WebCore::AbortController::create(*domGlobalObject->scriptExecutionContext()));
    RETURN_IF_EXCEPTION(scope, );
    controller->m_abortController.set(vm, controller, asObject(abortController));

    controller->m_started = false;
    controller->m_strategyHWM = highWaterMark;

    bool backpressure = writableStreamDefaultControllerGetBackpressure(controller);
    RELEASE_AND_RETURN(scope, writableStreamUpdateBackpressure(globalObject, stream, backpressure));
}

// "Let startPromise be a promise resolved with startResult; upon fulfillment / rejection…".
// A non-thenable primitive needs no promise: the fulfillment handler is queued directly.
static void reactToWritableControllerStart(JSC::VM& vm, JSGlobalObject* globalObject, JSWritableStreamDefaultController* controller, JSValue startResult)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    if (startResult.isObject()) {
        JSPromise* startPromise = promiseResolvedWith(globalObject, startResult);
        RETURN_IF_EXCEPTION(scope, );
        startPromise->performPromiseThenWithContext(vm, globalObject, runtime->onWSControllerStartFulfilled(), runtime->onWSControllerStartRejected(), jsUndefined(), controller);
        return;
    }
    QueuedTask task { nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, runtime->onWSControllerStartFulfilled(), globalObject->m_asyncContextData.get()->getInternalField(0), startResult, controller };
    vm.queueMicrotask(WTF::move(task));
}

JSWritableStream* createWritableStream(JSGlobalObject* globalObject, SinkKind kind, JSCell* algorithmContext, JSValue startResult, double highWaterMark, JSObject* sizeAlgorithm)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(highWaterMark >= 0);

    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* stream = JSWritableStream::create(vm, WebCore::getDOMStructure<JSWritableStream>(vm, *domGlobalObject));
    initializeWritableStream(stream);

    auto* controller = JSWritableStreamDefaultController::create(vm, WebCore::getDOMStructure<JSWritableStreamDefaultController>(vm, *domGlobalObject));
    controller->m_algorithms.kind = kind;
    if (algorithmContext)
        controller->m_algorithms.algorithmContext.set(vm, controller, algorithmContext);
    if (sizeAlgorithm)
        controller->m_strategySizeAlgorithm.set(vm, controller, sizeAlgorithm);

    setUpWritableStreamDefaultController(globalObject, stream, controller, startResult, highWaterMark);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return stream;
}

void initializeWritableStream(JSWritableStream* stream)
{
    stream->m_state = WritableStreamState::Writable;
    stream->m_storedError.clear();
    stream->m_writer.clear();
    stream->m_controller.clear();
    stream->m_inFlightWriteRequest.clear();
    stream->m_closeRequest.clear();
    stream->m_inFlightCloseRequest.clear();
    clearPendingAbortRequest(stream);
    {
        WTF::Locker locker { stream->cellLock() };
        stream->m_writeRequests.clear();
    }
    stream->m_backpressure = false;
}

bool isWritableStreamLocked(JSWritableStream* stream)
{
    return !!stream->m_writer;
}

JSWritableStreamDefaultWriter* acquireWritableStreamDefaultWriter(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* writer = JSWritableStreamDefaultWriter::create(vm, WebCore::getDOMStructure<JSWritableStreamDefaultWriter>(vm, *domGlobalObject));
    setUpWritableStreamDefaultWriter(globalObject, writer, stream);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return writer;
}

void setUpWritableStreamDefaultWriter(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (isWritableStreamLocked(stream)) {
        throwException(globalObject, scope, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: WritableStream is locked"_s));
        return;
    }
    writer->m_stream.set(vm, writer, stream);
    stream->m_writer.set(vm, stream, writer);

    switch (stream->m_state) {
    case WritableStreamState::Writable: {
        if (!writableStreamCloseQueuedOrInFlight(stream) && stream->m_backpressure)
            writer->m_readyPromise.set(vm, writer, JSPromise::create(vm, globalObject->promiseStructure()));
        else {
            JSPromise* ready = promiseFulfilledWith(globalObject, JSC::jsUndefined());
            RETURN_IF_EXCEPTION(scope, );
            writer->m_readyPromise.set(vm, writer, ready);
        }
        writer->m_closedPromise.set(vm, writer, JSPromise::create(vm, globalObject->promiseStructure()));
        return;
    }
    case WritableStreamState::Erroring: {
        JSPromise* ready = promiseRejectedWith(globalObject, stream->m_storedError.get());
        RETURN_IF_EXCEPTION(scope, );
        markPromiseAsHandled(vm, ready);
        writer->m_readyPromise.set(vm, writer, ready);
        writer->m_closedPromise.set(vm, writer, JSPromise::create(vm, globalObject->promiseStructure()));
        return;
    }
    case WritableStreamState::Closed: {
        JSPromise* ready = promiseFulfilledWith(globalObject, JSC::jsUndefined());
        RETURN_IF_EXCEPTION(scope, );
        writer->m_readyPromise.set(vm, writer, ready);
        JSPromise* closed = promiseFulfilledWith(globalObject, JSC::jsUndefined());
        RETURN_IF_EXCEPTION(scope, );
        writer->m_closedPromise.set(vm, writer, closed);
        return;
    }
    case WritableStreamState::Errored: {
        JSValue storedError = stream->m_storedError.get();
        JSPromise* ready = promiseRejectedWith(globalObject, storedError);
        RETURN_IF_EXCEPTION(scope, );
        markPromiseAsHandled(vm, ready);
        writer->m_readyPromise.set(vm, writer, ready);
        JSPromise* closed = promiseRejectedWith(globalObject, storedError);
        RETURN_IF_EXCEPTION(scope, );
        markPromiseAsHandled(vm, closed);
        writer->m_closedPromise.set(vm, writer, closed);
        return;
    }
    }
}

JSPromise* writableStreamAbort(JSGlobalObject* globalObject, JSWritableStream* stream, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (stream->m_state == WritableStreamState::Closed || stream->m_state == WritableStreamState::Errored)
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));

    // Signaling abort runs the user's `abort` listeners synchronously.
    auto* controller = stream->m_controller.get();
    ASSERT(controller && controller->m_abortController);
    uncheckedDowncast<WebCore::JSAbortController>(controller->m_abortController.get())->wrapped().abort(*defaultGlobalObject(globalObject), reason);
    RETURN_IF_EXCEPTION(scope, nullptr);

    WritableStreamState state = stream->m_state;
    if (state == WritableStreamState::Closed || state == WritableStreamState::Errored)
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    if (stream->m_pendingAbortRequest.promise)
        return stream->m_pendingAbortRequest.promise.get();

    ASSERT(state == WritableStreamState::Writable || state == WritableStreamState::Erroring);
    bool wasAlreadyErroring = false;
    if (state == WritableStreamState::Erroring) {
        wasAlreadyErroring = true;
        reason = jsUndefined();
    }

    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    stream->m_pendingAbortRequest.promise.set(vm, stream, promise);
    stream->m_pendingAbortRequest.reason.set(vm, stream, reason);
    stream->m_pendingAbortRequest.wasAlreadyErroring = wasAlreadyErroring;
    if (!wasAlreadyErroring) {
        writableStreamStartErroring(globalObject, stream, reason);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return promise;
}

JSPromise* writableStreamClose(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    WritableStreamState state = stream->m_state;
    if (state == WritableStreamState::Closed || state == WritableStreamState::Errored)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Cannot close a WritableStream that is closed or errored"_s)));
    ASSERT(state == WritableStreamState::Writable || state == WritableStreamState::Erroring);
    ASSERT(!writableStreamCloseQueuedOrInFlight(stream));

    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    stream->m_closeRequest.set(vm, stream, promise);

    auto* writer = stream->m_writer.get();
    if (writer && stream->m_backpressure && state == WritableStreamState::Writable) {
        // Materialize-then-resolve so a later `.ready` read sees fulfilled even when the lazy
        // slot was null (close() does not clear [[backpressure]]).
        resolvePromise(globalObject, writer->readyPromise(globalObject), jsUndefined());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    writableStreamDefaultControllerClose(globalObject, stream->m_controller.get());
    RETURN_IF_EXCEPTION(scope, nullptr);
    return promise;
}

// Non-throwing leaf: only allocates the write-request promise cell.
JSPromise* writableStreamAddWriteRequest(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    ASSERT(isWritableStreamLocked(stream));
    ASSERT(stream->m_state == WritableStreamState::Writable);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    {
        WTF::Locker locker { stream->cellLock() };
        stream->m_writeRequests.append(WriteBarrier<JSPromise>(vm, stream, promise));
    }
    return promise;
}

bool writableStreamCloseQueuedOrInFlight(JSWritableStream* stream)
{
    return !!stream->m_closeRequest || !!stream->m_inFlightCloseRequest;
}

void writableStreamDealWithRejection(JSGlobalObject* globalObject, JSWritableStream* stream, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const WritableStreamState state = stream->m_state;
    if (state == WritableStreamState::Writable) {
        writableStreamStartErroring(globalObject, stream, error);
        RETURN_IF_EXCEPTION(scope, );
        return;
    }
    ASSERT(state == WritableStreamState::Erroring);
    RELEASE_AND_RETURN(scope, writableStreamFinishErroring(globalObject, stream));
}

// `$webStreamControllerError` — see the ReadableStream overload in ReadableStreamOperations.cpp.
// Mirrors WritableStreamDefaultController.prototype.error, which is what Node's
// addAbortSignal() holds a bound reference to.
void webStreamControllerError(JSGlobalObject* globalObject, JSWritableStream* stream, JSValue error)
{
    if (stream->m_state != WritableStreamState::Writable)
        return;
    writableStreamDefaultControllerError(globalObject, stream->m_controller.get(), error);
}

void writableStreamStartErroring(JSGlobalObject* globalObject, JSWritableStream* stream, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    ASSERT(!stream->m_storedError);
    ASSERT(stream->m_state == WritableStreamState::Writable);
    const auto* controller = stream->m_controller.get();
    ASSERT(controller);

    stream->m_state = WritableStreamState::Erroring;
    stream->m_storedError.set(vm, stream, reason);
    if (auto* writer = stream->m_writer.get()) {
        writableStreamDefaultWriterEnsureReadyPromiseRejected(globalObject, writer, reason);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (!writableStreamHasOperationMarkedInFlight(stream) && controller->m_started)
        RELEASE_AND_RETURN(scope, writableStreamFinishErroring(globalObject, stream));
}

void writableStreamFinishErroring(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    ASSERT(stream->m_state == WritableStreamState::Erroring);
    ASSERT(!writableStreamHasOperationMarkedInFlight(stream));
    stream->m_state = WritableStreamState::Errored;
    rejectStreamClosedPromise(vm, stream, stream->m_storedError.get());

    auto* controller = stream->m_controller.get();
    controller->errorSteps();

    JSValue storedError = stream->m_storedError.get();
    // Rejecting runs no user JS, so nothing can mutate the deque under this loop.
    for (auto& writeRequest : stream->m_writeRequests) {
        rejectPromise(globalObject, writeRequest.get(), storedError);
        RETURN_IF_EXCEPTION(scope, );
    }
    {
        WTF::Locker locker { stream->cellLock() };
        stream->m_writeRequests.clear();
    }

    if (!stream->m_pendingAbortRequest.promise)
        RELEASE_AND_RETURN(scope, writableStreamRejectCloseAndClosedPromiseIfNeeded(globalObject, stream));

    auto* abortPromise = stream->m_pendingAbortRequest.promise.get();
    JSValue abortReason = stream->m_pendingAbortRequest.reason.get();
    bool wasAlreadyErroring = stream->m_pendingAbortRequest.wasAlreadyErroring;
    clearPendingAbortRequest(stream);

    if (wasAlreadyErroring) {
        rejectPromise(globalObject, abortPromise, storedError);
        RETURN_IF_EXCEPTION(scope, );
        RELEASE_AND_RETURN(scope, writableStreamRejectCloseAndClosedPromiseIfNeeded(globalObject, stream));
    }

    JSPromise* promise = controller->abortSteps(globalObject, abortReason);
    RETURN_IF_EXCEPTION(scope, );
    ASSERT(promise);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), abortPromise, stream);
    promise->performPromiseThenWithContext(vm, globalObject, runtime->onWSAbortStepsFulfilled(), runtime->onWSAbortStepsRejected(), jsUndefined(), context);
}

void writableStreamFinishInFlightWrite(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_inFlightWriteRequest);
    resolvePromise(globalObject, stream->m_inFlightWriteRequest.get(), jsUndefined());
    RETURN_IF_EXCEPTION(scope, );
    stream->m_inFlightWriteRequest.clear();
}

void writableStreamFinishInFlightWriteWithError(JSGlobalObject* globalObject, JSWritableStream* stream, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_inFlightWriteRequest);
    rejectPromise(globalObject, stream->m_inFlightWriteRequest.get(), error);
    RETURN_IF_EXCEPTION(scope, );
    stream->m_inFlightWriteRequest.clear();
    ASSERT(stream->m_state == WritableStreamState::Writable || stream->m_state == WritableStreamState::Erroring);
    RELEASE_AND_RETURN(scope, writableStreamDealWithRejection(globalObject, stream, error));
}

void writableStreamFinishInFlightClose(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_inFlightCloseRequest);
    resolvePromise(globalObject, stream->m_inFlightCloseRequest.get(), jsUndefined());
    RETURN_IF_EXCEPTION(scope, );
    stream->m_inFlightCloseRequest.clear();

    WritableStreamState state = stream->m_state;
    ASSERT(state == WritableStreamState::Writable || state == WritableStreamState::Erroring);
    if (state == WritableStreamState::Erroring) {
        stream->m_storedError.clear();
        if (stream->m_pendingAbortRequest.promise) {
            resolvePromise(globalObject, stream->m_pendingAbortRequest.promise.get(), jsUndefined());
            RETURN_IF_EXCEPTION(scope, );
            clearPendingAbortRequest(stream);
        }
    }
    stream->m_state = WritableStreamState::Closed;
    resolveStreamClosedPromise(vm, stream);
    if (auto* writer = stream->m_writer.get()) {
        resolvePromise(globalObject, writer->m_closedPromise.get(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, );
    }
    ASSERT(!stream->m_pendingAbortRequest.promise);
    ASSERT(!stream->m_storedError);
}

void writableStreamFinishInFlightCloseWithError(JSGlobalObject* globalObject, JSWritableStream* stream, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_inFlightCloseRequest);
    rejectPromise(globalObject, stream->m_inFlightCloseRequest.get(), error);
    RETURN_IF_EXCEPTION(scope, );
    stream->m_inFlightCloseRequest.clear();
    ASSERT(stream->m_state == WritableStreamState::Writable || stream->m_state == WritableStreamState::Erroring);
    if (stream->m_pendingAbortRequest.promise) {
        rejectPromise(globalObject, stream->m_pendingAbortRequest.promise.get(), error);
        RETURN_IF_EXCEPTION(scope, );
        clearPendingAbortRequest(stream);
    }
    RELEASE_AND_RETURN(scope, writableStreamDealWithRejection(globalObject, stream, error));
}

bool writableStreamHasOperationMarkedInFlight(JSWritableStream* stream)
{
    return !!stream->m_inFlightWriteRequest || !!stream->m_inFlightCloseRequest;
}

void writableStreamMarkCloseRequestInFlight(VM& vm, JSWritableStream* stream)
{
    ASSERT(!stream->m_inFlightCloseRequest);
    ASSERT(stream->m_closeRequest);
    stream->m_inFlightCloseRequest.set(vm, stream, stream->m_closeRequest.get());
    stream->m_closeRequest.clear();
}

void writableStreamMarkFirstWriteRequestInFlight(VM& vm, JSWritableStream* stream)
{
    ASSERT(!stream->m_inFlightWriteRequest);
    ASSERT(!stream->m_writeRequests.isEmpty());
    JSPromise* writeRequest = nullptr;
    {
        WTF::Locker locker { stream->cellLock() };
        writeRequest = stream->m_writeRequests.takeFirst().get();
    }
    stream->m_inFlightWriteRequest.set(vm, stream, writeRequest);
}

void writableStreamRejectCloseAndClosedPromiseIfNeeded(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_state == WritableStreamState::Errored);
    JSValue storedError = stream->m_storedError.get();
    if (stream->m_closeRequest) {
        ASSERT(!stream->m_inFlightCloseRequest);
        rejectPromise(globalObject, stream->m_closeRequest.get(), storedError);
        RETURN_IF_EXCEPTION(scope, );
        stream->m_closeRequest.clear();
    }
    if (auto* writer = stream->m_writer.get()) {
        rejectPromise(globalObject, writer->m_closedPromise.get(), storedError);
        RETURN_IF_EXCEPTION(scope, );
        markPromiseAsHandled(vm, writer->m_closedPromise.get());
    }
}

void writableStreamUpdateBackpressure(JSGlobalObject* globalObject, JSWritableStream* stream, bool backpressure)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_state == WritableStreamState::Writable);
    ASSERT(!writableStreamCloseQueuedOrInFlight(stream));
    auto* writer = stream->m_writer.get();
    if (writer && backpressure != stream->m_backpressure) {
        if (backpressure)
            writer->m_readyPromise.clear();
        else if (auto* ready = writer->m_readyPromise.get()) {
            resolvePromise(globalObject, ready, jsUndefined());
            RETURN_IF_EXCEPTION(scope, );
        }
    }
    stream->m_backpressure = backpressure;
}

void setUpWritableStreamDefaultController(JSGlobalObject* globalObject, JSWritableStream* stream, JSWritableStreamDefaultController* controller, JSValue startResult, double highWaterMark)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    setUpWritableStreamDefaultControllerBeforeStart(vm, globalObject, stream, controller, highWaterMark);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, reactToWritableControllerStart(vm, globalObject, controller, startResult));
}

void setUpWritableStreamDefaultControllerFromUnderlyingSink(JSGlobalObject* globalObject, JSWritableStream* stream, JSValue underlyingSink, const UnderlyingSinkDict& underlyingSinkDict, double highWaterMark, JSObject* sizeAlgorithm)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* controller = JSWritableStreamDefaultController::create(vm, WebCore::getDOMStructure<JSWritableStreamDefaultController>(vm, *domGlobalObject));
    controller->m_algorithms.kind = SinkKind::JavaScript;
    controller->m_algorithms.underlyingObject.set(vm, controller, underlyingSink);
    if (underlyingSinkDict.write)
        controller->m_algorithms.method1.set(vm, controller, asObject(underlyingSinkDict.write));
    if (underlyingSinkDict.close)
        controller->m_algorithms.method2.set(vm, controller, asObject(underlyingSinkDict.close));
    if (underlyingSinkDict.abort)
        controller->m_algorithms.method3.set(vm, controller, asObject(underlyingSinkDict.abort));
    if (sizeAlgorithm)
        controller->m_strategySizeAlgorithm.set(vm, controller, sizeAlgorithm);

    // The user `start` must observe a fully wired controller, so it runs between the two
    // halves of SetUpWritableStreamDefaultController; its exception is rethrown.
    setUpWritableStreamDefaultControllerBeforeStart(vm, globalObject, stream, controller, highWaterMark);
    RETURN_IF_EXCEPTION(scope, );

    JSValue startResult = jsUndefined();
    const JSValue start = underlyingSinkDict.start;
    if (start) {
        MarkedArgumentBuffer args;
        args.append(controller);
        ASSERT(!args.hasOverflowed());
        auto callData = JSC::getCallData(start);
        ASSERT(callData.type != CallData::Type::None);
        startResult = JSC::call(globalObject, start, callData, underlyingSink, args);
        RETURN_IF_EXCEPTION(scope, );
    }
    RELEASE_AND_RETURN(scope, reactToWritableControllerStart(vm, globalObject, controller, startResult));
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

// Reactions to the promise returned by [[AbortSteps]] (WritableStreamFinishErroring).
// context = InternalFieldTuple{ the pending abort request's promise, the JSWritableStream }:
// the abort request was already detached from the stream when the reaction was registered.

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSAbortStepsFulfilled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<JSC::InternalFieldTuple>(callFrame->uncheckedArgument(1));
    auto* abortRequestPromise = uncheckedDowncast<JSC::JSPromise>(context->getInternalField(0));
    auto* stream = uncheckedDowncast<JSWritableStream>(context->getInternalField(1));
    Bun::WebStreams::resolvePromise(globalObject, abortRequestPromise, JSC::jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    Bun::WebStreams::writableStreamRejectCloseAndClosedPromiseIfNeeded(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onWSAbortStepsRejected, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<JSC::InternalFieldTuple>(callFrame->uncheckedArgument(1));
    auto* abortRequestPromise = uncheckedDowncast<JSC::JSPromise>(context->getInternalField(0));
    auto* stream = uncheckedDowncast<JSWritableStream>(context->getInternalField(1));
    Bun::WebStreams::rejectPromise(globalObject, abortRequestPromise, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    Bun::WebStreams::writableStreamRejectCloseAndClosedPromiseIfNeeded(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(JSC::jsUndefined());
}

} // namespace WebCore
