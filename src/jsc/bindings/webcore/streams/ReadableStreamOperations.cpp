#include "root.h"
#include "ErrorCode.h"
#include "AsyncStackTrace.h"

#include "WebStreamsInternals.h"

#include "BunClientData.h"
#include "BunStreamSource.h"
#include "JSDOMWrapperCache.h"
#include "JSDirectStreamController.h"
#include "JSReadRequest.h"
#include "JSReadableByteStreamController.h"
#include "JSReadableStream.h"
#include "JSReadableStreamAsyncIterator.h"
#include "JSReadableStreamBYOBReader.h"
#include "JSReadableStreamBYOBRequest.h"
#include "JSReadableStreamDefaultController.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamAlgorithmContexts.h"
#include "JSStreamPipeToOperation.h"
#include "JSStreamTeeState.h"
#include "JSStreamsRuntime.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultWriter.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSAsyncFromSyncIterator.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/Locker.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSStreamsRuntime;

// Every switch over ControllerKind is TOTAL; these two are the only casts of the erased
// stream->m_controller slot in this file.
JSReadableStreamDefaultController* defaultControllerOf(JSReadableStream* stream)
{
    switch (stream->m_controllerKind) {
    case ControllerKind::Default:
        return uncheckedDowncast<JSReadableStreamDefaultController>(stream->m_controller.get());
    case ControllerKind::None:
    case ControllerKind::Byte:
    case ControllerKind::Direct:
    case ControllerKind::NativeSink:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

JSReadableByteStreamController* byteControllerOf(JSReadableStream* stream)
{
    switch (stream->m_controllerKind) {
    case ControllerKind::Byte:
        return uncheckedDowncast<JSReadableByteStreamController>(stream->m_controller.get());
    case ControllerKind::None:
    case ControllerKind::Default:
    case ControllerKind::Direct:
    case ControllerKind::NativeSink:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
    return nullptr;
}

// Null-safe tee-branch controller recovery: Bun's native-sink pumps clear a consumed
// stream's controller slot in their finally step, so a tee reaction queued before that
// teardown can see a branch with no controller. A torn-down branch is terminal; skip it.
JSReadableStreamDefaultController* teeBranchDefaultController(JSReadableStream* branch)
{
    if (branch->m_controllerKind != ControllerKind::Default)
        return nullptr;
    return uncheckedDowncast<JSReadableStreamDefaultController>(branch->m_controller.get());
}

JSReadableByteStreamController* teeBranchByteController(JSReadableStream* branch)
{
    if (branch->m_controllerKind != ControllerKind::Byte)
        return nullptr;
    return uncheckedDowncast<JSReadableByteStreamController>(branch->m_controller.get());
}

// The byte tee's mutable reader slot is erased to JSCell; recover the non-polymorphic
// reader base through the two concrete classes.
static JSReadableStreamReaderBase* teeReader(JSStreamTeeState* teeState)
{
    JSCell* cell = teeState->m_reader.get();
    if (auto* byobReader = dynamicDowncast<WebCore::JSReadableStreamBYOBReader>(cell))
        return byobReader;
    return uncheckedDowncast<WebCore::JSReadableStreamDefaultReader>(cell);
}

// [reaction-convention] deferral: runs handler(value, context) as its own microtask,
// carrying the current async context, without allocating a promise.
void queueReactionJob(JSC::VM& vm, JSGlobalObject* globalObject, JSFunction* handler, JSValue value, JSValue context)
{
    JSValue asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);
    if (asyncContext.isEmpty())
        asyncContext = jsUndefined();
    QueuedTask task { nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, handler, asyncContext, value, context };
    vm.queueMicrotask(WTF::move(task));
}

// "Let startPromise be a promise resolved with startResult. Upon fulfillment / rejection of
// startPromise, ...". A non-object startResult cannot be a thenable, so no promise is needed.
static void reactToStartResult(JSC::VM& vm, JSGlobalObject* globalObject, JSValue startResult, JSFunction* onFulfilled, JSFunction* onRejected, JSCell* context)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!startResult.isObject()) {
        queueReactionJob(vm, globalObject, onFulfilled, startResult, context);
        return;
    }
    auto* startPromise = promiseResolvedWith(globalObject, startResult);
    RETURN_IF_EXCEPTION(scope, void());
    startPromise->performPromiseThenWithContext(vm, globalObject, onFulfilled, onRejected, jsUndefined(), context);
    RETURN_IF_EXCEPTION(scope, void());
}

// Detaches the reader's request list before dispatch, per the spec's "set to an empty list,
// then iterate". A MarkedArgumentBuffer is the only GC-visible holder once the requests
// leave the visited deque.
template<typename Reader>
static void detachReadRequests(JSC::VM& vm, JSGlobalObject* globalObject, Reader* reader, MarkedArgumentBuffer& out)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    {
        WTF::Locker locker { reader->cellLock() };
        if constexpr (std::is_same_v<Reader, WebCore::JSReadableStreamDefaultReader>) {
            for (auto& request : reader->m_readRequests)
                out.append(request.get());
            reader->m_readRequests.clear();
        } else {
            for (auto& request : reader->m_readIntoRequests)
                out.append(request.get());
            reader->m_readIntoRequests.clear();
        }
    }
    if (out.hasOverflowed()) [[unlikely]]
        throwOutOfMemoryError(globalObject, scope);
}

// InitializeReadableStream(stream)
void initializeReadableStream(JSReadableStream* stream)
{
    stream->m_state = ReadableStreamState::Readable;
    stream->m_reader.clear();
    stream->m_storedError.clear();
    stream->m_disturbed = false;
}

// IsReadableStreamLocked(stream), widened by Bun's reader-less lock states.
bool isReadableStreamLocked(JSReadableStream* stream)
{
    return !!stream->m_reader || stream->m_lockedWithoutReader || stream->nativeHandleDetached();
}

// ReadableStreamHasDefaultReader(stream)
bool readableStreamHasDefaultReader(JSReadableStream* stream)
{
    auto* reader = stream->m_reader.get();
    return reader && !reader->isBYOB();
}

// ReadableStreamHasBYOBReader(stream)
bool readableStreamHasBYOBReader(JSReadableStream* stream)
{
    auto* reader = stream->m_reader.get();
    return reader && reader->isBYOB();
}

// ReadableStreamGetNumReadRequests(stream). NULL-SAFE by design: resolving a read result
// runs user JS (a patched Object.prototype.then) that can release the reader between a
// caller's check and its use, so a missing reader reads as "no pending requests".
size_t readableStreamGetNumReadRequests(JSReadableStream* stream)
{
    if (!readableStreamHasDefaultReader(stream)) [[unlikely]]
        return 0;
    return static_cast<JSReadableStreamDefaultReader*>(stream->m_reader.get())->m_readRequests.size();
}

// ReadableStreamGetNumReadIntoRequests(stream). Null-safe: see readableStreamGetNumReadRequests.
size_t readableStreamGetNumReadIntoRequests(JSReadableStream* stream)
{
    if (!readableStreamHasBYOBReader(stream)) [[unlikely]]
        return 0;
    return static_cast<JSReadableStreamBYOBReader*>(stream->m_reader.get())->m_readIntoRequests.size();
}

// ReadableStreamAddReadRequest(stream, readRequest)
void readableStreamAddReadRequest(VM& vm, JSReadableStream* stream, JSReadRequest* readRequest)
{
    ASSERT(readableStreamHasDefaultReader(stream));
    ASSERT(stream->m_state == ReadableStreamState::Readable);
    auto* reader = static_cast<JSReadableStreamDefaultReader*>(stream->m_reader.get());
    WTF::Locker locker { reader->cellLock() };
    reader->m_readRequests.append(WriteBarrier<JSReadRequest>(vm, reader, readRequest));
}

// ReadableStreamAddReadIntoRequest(stream, readRequest)
void readableStreamAddReadIntoRequest(VM& vm, JSReadableStream* stream, JSReadIntoRequest* readRequest)
{
    ASSERT(readableStreamHasBYOBReader(stream));
    ASSERT(stream->m_state == ReadableStreamState::Readable || stream->m_state == ReadableStreamState::Closed);
    auto* reader = static_cast<JSReadableStreamBYOBReader*>(stream->m_reader.get());
    WTF::Locker locker { reader->cellLock() };
    reader->m_readIntoRequests.append(WriteBarrier<JSReadIntoRequest>(vm, reader, readRequest));
}

// ReadableStreamFulfillReadRequest(stream, chunk, done). A user-installed
// Object.prototype.then can release the reader while an earlier request in the same batch
// is being resolved; its remaining requests were already rejected, so there is nothing to do.
void readableStreamFulfillReadRequest(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue chunk, bool done)
{
    if (!readableStreamHasDefaultReader(stream)) [[unlikely]]
        return;
    auto* reader = static_cast<JSReadableStreamDefaultReader*>(stream->m_reader.get());
    if (reader->m_readRequests.isEmpty()) [[unlikely]]
        return;
    JSReadRequest* readRequest = nullptr;
    {
        WTF::Locker locker { reader->cellLock() };
        readRequest = reader->m_readRequests.takeFirst().get();
    }
    if (done)
        readRequest->closeSteps(globalObject);
    else
        readRequest->chunkSteps(globalObject, chunk);
}

// ReadableStreamFulfillReadIntoRequest(stream, chunk, done). Null-safe like
// readableStreamFulfillReadRequest: a reader released mid-batch already rejected these.
void readableStreamFulfillReadIntoRequest(JSGlobalObject* globalObject, JSReadableStream* stream, JSArrayBufferView* chunk, bool done)
{
    if (!readableStreamHasBYOBReader(stream)) [[unlikely]]
        return;
    auto* reader = static_cast<JSReadableStreamBYOBReader*>(stream->m_reader.get());
    if (reader->m_readIntoRequests.isEmpty()) [[unlikely]]
        return;
    JSReadIntoRequest* readIntoRequest = nullptr;
    {
        WTF::Locker locker { reader->cellLock() };
        readIntoRequest = reader->m_readIntoRequests.takeFirst().get();
    }
    if (done)
        readIntoRequest->closeSteps(globalObject, chunk);
    else
        readIntoRequest->chunkSteps(globalObject, chunk);
}

// ReadableStreamClose(stream)
void readableStreamClose(JSGlobalObject* globalObject, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_state == ReadableStreamState::Readable);
    stream->m_state = ReadableStreamState::Closed;
    resolveStreamClosedPromise(vm, stream);
    auto* reader = stream->m_reader.get();
    if (!reader)
        return;
    resolvePromise(globalObject, reader->m_closedPromise.get(), jsUndefined());
    RETURN_IF_EXCEPTION(scope, void());
    if (reader->isBYOB())
        return;
    auto* defaultReader = static_cast<JSReadableStreamDefaultReader*>(reader);
    MarkedArgumentBuffer readRequests;
    detachReadRequests(vm, globalObject, defaultReader, readRequests);
    RETURN_IF_EXCEPTION(scope, void());
    for (size_t i = 0, count = readRequests.size(); i < count; ++i) {
        uncheckedDowncast<JSReadRequest>(readRequests.at(i))->closeSteps(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

void readableStreamCloseIfPossible(JSGlobalObject* globalObject, JSReadableStream* stream)
{
    if (stream->m_state == ReadableStreamState::Readable)
        readableStreamClose(globalObject, stream);
}

// `$webStreamControllerError` — what node:stream's addAbortSignal() does to a WHATWG stream.
// Node keeps a bound `controller.error` on the stream under a symbol; Bun's controllers live
// in C++, so the dispatch happens here instead and the common case allocates nothing.
// A no-op once the stream is no longer readable, exactly like controller.error().
void webStreamControllerError(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue error)
{
    if (stream->m_state != ReadableStreamState::Readable)
        return;
    switch (stream->m_controllerKind) {
    case ControllerKind::Default:
        readableStreamDefaultControllerError(globalObject, defaultControllerOf(stream), error);
        return;
    case ControllerKind::Byte:
        readableByteStreamControllerError(globalObject, byteControllerOf(stream), error);
        return;
    case ControllerKind::Direct:
        // handleError is what the direct controller's own error() method dispatches to:
        // it tears the sink down, rejects any pending read, and errors the stream.
        // onClose() is the graceful end() path and would resolve the read instead.
        uncheckedDowncast<WebCore::JSDirectStreamController>(stream->m_controller.get())->handleError(globalObject, error);
        return;
    case ControllerKind::None:
    case ControllerKind::NativeSink:
        // No spec controller to reset a queue on; error the stream itself.
        readableStreamError(globalObject, stream, error);
        return;
    }
}

// ReadableStreamError(stream, e)
void readableStreamError(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_state == ReadableStreamState::Readable);
    stream->m_state = ReadableStreamState::Errored;
    stream->m_storedError.set(vm, stream, error);
    rejectStreamClosedPromise(vm, stream, error);
    auto* reader = stream->m_reader.get();
    if (!reader)
        return;
    // Errors created inside our own promise reactions have no JavaScript frames; borrow
    // the awaiting async function's frames from the promise user code is blocked on:
    // reader.read() and byobReader.read(view) promises, the async iterator's ongoing
    // (Web IDL-transformed) promise for `for await`, and pipeTo()'s returned promise.
    JSPromise* awaited = reader->m_closedPromise.get();
    if (!reader->isBYOB()) {
        auto* defaultReader = static_cast<JSReadableStreamDefaultReader*>(reader);
        WTF::Locker locker { defaultReader->cellLock() };
        for (auto& request : defaultReader->m_readRequests) {
            JSPromise* found = nullptr;
            switch (request->kind()) {
            case ReadRequestKind::Promise:
                found = dynamicDowncast<JSPromise>(request->m_context.get());
                break;
            case ReadRequestKind::AsyncIterator:
                if (auto* tuple = dynamicDowncast<JSC::InternalFieldTuple>(request->m_context.get())) {
                    if (auto* iterator = dynamicDowncast<JSReadableStreamAsyncIterator>(tuple->getInternalField(0)))
                        found = iterator->m_ongoingPromise.get();
                }
                break;
            case ReadRequestKind::PipeTo:
                if (auto* op = dynamicDowncast<JSStreamPipeToOperation>(request->m_context.get()))
                    found = op->m_promise.get();
                break;
            default:
                break;
            }
            if (found) {
                awaited = found;
                break;
            }
        }
    } else {
        auto* byobReader = static_cast<JSReadableStreamBYOBReader*>(reader);
        WTF::Locker locker { byobReader->cellLock() };
        for (auto& request : byobReader->m_readIntoRequests) {
            if (request->kind() == ReadIntoRequestKind::Promise) {
                if (auto* promise = dynamicDowncast<JSPromise>(request->m_context.get())) {
                    awaited = promise;
                    break;
                }
            }
        }
    }
    Bun::attachAsyncStackFromPromise(globalObject, error, awaited);
    rejectPromise(globalObject, reader->m_closedPromise.get(), error);
    RETURN_IF_EXCEPTION(scope, void());
    markPromiseAsHandled(vm, reader->m_closedPromise.get());
    if (!reader->isBYOB())
        RELEASE_AND_RETURN(scope, readableStreamDefaultReaderErrorReadRequests(globalObject, static_cast<JSReadableStreamDefaultReader*>(reader), error));
    RELEASE_AND_RETURN(scope, readableStreamBYOBReaderErrorReadIntoRequests(globalObject, static_cast<JSReadableStreamBYOBReader*>(reader), error));
}

// ReadableStreamCancel(stream, reason)
JSPromise* readableStreamCancel(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);

    stream->m_disturbed = true;
    const ReadableStreamState state = stream->m_state;
    if (state == ReadableStreamState::Closed)
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    if (state == ReadableStreamState::Errored)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, stream->m_storedError.get()));

    readableStreamClose(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, nullptr);

    auto* reader = stream->m_reader.get();
    if (reader && reader->isBYOB()) {
        auto* byobReader = static_cast<JSReadableStreamBYOBReader*>(reader);
        MarkedArgumentBuffer readIntoRequests;
        detachReadRequests(vm, globalObject, byobReader, readIntoRequests);
        RETURN_IF_EXCEPTION(scope, nullptr);
        for (size_t i = 0, count = readIntoRequests.size(); i < count; ++i) {
            uncheckedDowncast<JSReadIntoRequest>(readIntoRequests.at(i))->closeSteps(globalObject, nullptr);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
    }

    JSPromise* sourceCancelPromise = nullptr;
    switch (stream->m_controllerKind) {
    case ControllerKind::None:
        if (stream->m_bunMode == BunStreamMode::NativePending)
            sourceCancelPromise = cancelPendingNativeSource(globalObject, stream, reason);
        else {
            stream->m_bunMode = BunStreamMode::Default;
            sourceCancelPromise = promiseFulfilledWith(globalObject, JSC::jsUndefined());
        }
        break;
    case ControllerKind::Default:
        sourceCancelPromise = defaultControllerOf(stream)->cancelSteps(globalObject, reason);
        break;
    case ControllerKind::Byte:
        sourceCancelPromise = byteControllerOf(stream)->cancelSteps(globalObject, reason);
        break;
    case ControllerKind::Direct: {
        auto* controller = uncheckedDowncast<WebCore::JSDirectStreamController>(stream->m_controller.get());
        controller->onClose(globalObject, reason);
        RETURN_IF_EXCEPTION(scope, nullptr);
        // readableStreamClose above already moved the stream out of Readable, so onClose
        // early-returned; a direct read still pending on the controller settles as done here
        // (a canceled read resolves with { value: undefined, done: true }).
        if (auto* pendingRead = controller->m_pendingRead.get()) {
            controller->m_pendingRead.clear();
            JSObject* doneResult = createIteratorResultObject(globalObject, jsUndefined(), true);
            RETURN_IF_EXCEPTION(scope, nullptr);
            pendingRead->fulfill(vm, doneResult);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        sourceCancelPromise = promiseFulfilledWith(globalObject, JSC::jsUndefined());
        break;
    }
    case ControllerKind::NativeSink: {
        auto* sinkController = stream->m_controller.get();
        JSValue closeFunction = sinkController->getIfPropertyExists(globalObject, builtinNames(vm).closePublicName());
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!closeFunction || !closeFunction.isCallable()) {
            throwTypeError(globalObject, scope, "The stream's native sink controller has no close method"_s);
            return nullptr;
        }
        auto callData = JSC::getCallData(closeFunction);
        MarkedArgumentBuffer args;
        args.append(reason);
        ASSERT(!args.hasOverflowed());
        JSValue closeResult = JSC::call(globalObject, closeFunction, callData, sinkController, args);
        RETURN_IF_EXCEPTION(scope, nullptr);
        sourceCancelPromise = promiseResolvedWith(globalObject, closeResult);
        break;
    }
    }
    RETURN_IF_EXCEPTION(scope, nullptr);

    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    sourceCancelPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReturnUndefined(), jsUndefined(), result, jsUndefined());
    RETURN_IF_EXCEPTION(scope, nullptr);
    return result;
}

// ReadableStreamReaderGenericInitialize(reader, stream)
void readableStreamReaderGenericInitialize(JSGlobalObject* globalObject, JSReadableStreamReaderBase* reader, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    reader->m_stream.set(vm, reader, stream);
    stream->m_reader.set(vm, stream, reader);
    switch (stream->m_state) {
    case ReadableStreamState::Readable:
        reader->m_closedPromise.set(vm, reader, JSPromise::create(vm, globalObject->promiseStructure()));
        return;
    case ReadableStreamState::Closed: {
        auto* closedPromise = promiseFulfilledWith(globalObject, JSC::jsUndefined());
        RETURN_IF_EXCEPTION(scope, void());
        reader->m_closedPromise.set(vm, reader, closedPromise);
        return;
    }
    case ReadableStreamState::Errored: {
        auto* closedPromise = promiseRejectedWith(globalObject, stream->m_storedError.get());
        RETURN_IF_EXCEPTION(scope, void());
        reader->m_closedPromise.set(vm, reader, closedPromise);
        markPromiseAsHandled(vm, closedPromise);
        return;
    }
    }
}

// ReadableStreamReaderGenericRelease(reader)
void readableStreamReaderGenericRelease(JSGlobalObject* globalObject, JSReadableStreamReaderBase* reader)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = reader->m_stream.get();
    ASSERT(stream);
    ASSERT(stream->m_reader.get() == reader);

    JSObject* releaseError = Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Reader released"_s);
    RETURN_IF_EXCEPTION(scope, void());
    if (stream->m_state == ReadableStreamState::Readable) {
        rejectPromise(globalObject, reader->m_closedPromise.get(), releaseError);
        RETURN_IF_EXCEPTION(scope, void());
    } else {
        auto* rejected = promiseRejectedWith(globalObject, releaseError);
        RETURN_IF_EXCEPTION(scope, void());
        reader->m_closedPromise.set(vm, reader, rejected);
    }
    markPromiseAsHandled(vm, reader->m_closedPromise.get());

    switch (stream->m_controllerKind) {
    case ControllerKind::None:
    case ControllerKind::NativeSink:
        break;
    case ControllerKind::Direct: {
        // A direct stream's in-flight read lives on the controller (not in the reader's
        // read-request queue), so releasing the reader must settle it here.
        auto* controller = uncheckedDowncast<WebCore::JSDirectStreamController>(stream->m_controller.get());
        if (auto* pendingRead = controller->m_pendingRead.get()) {
            controller->m_pendingRead.clear();
            JSObject* pendingReadError = Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Releasing reader"_s);
            RETURN_IF_EXCEPTION(scope, void());
            pendingRead->reject(vm, pendingReadError);
            RETURN_IF_EXCEPTION(scope, void());
        }
        break;
    }
    case ControllerKind::Default: {
        auto* controller = defaultControllerOf(stream);
        controller->releaseSteps();
        // Bun: drop the native handle's event-loop ref when its consumer releases the lock.
        if (stream->m_nativePtr && controller->m_algorithms.kind == SourceKind::Native) {
            const auto* adapter = uncheckedDowncast<WebCore::JSNativeStreamSourceAdapter>(controller->m_algorithms.algorithmContext.get());
            if (auto* handle = adapter->m_handle.get()) {
                JSValue updateRef = handle->getIfPropertyExists(globalObject, builtinNames(vm).updateRefPublicName());
                RETURN_IF_EXCEPTION(scope, void());
                if (updateRef && updateRef.isCallable()) {
                    auto callData = JSC::getCallData(updateRef);
                    MarkedArgumentBuffer args;
                    args.append(jsBoolean(false));
                    ASSERT(!args.hasOverflowed());
                    JSC::call(globalObject, updateRef, callData, handle, args);
                    RETURN_IF_EXCEPTION(scope, void());
                }
            }
        }
        break;
    }
    case ControllerKind::Byte:
        byteControllerOf(stream)->releaseSteps();
        break;
    }
    stream->m_reader.clear();
    reader->m_stream.clear();
}

// ReadableStreamReaderGenericCancel(reader, reason)
JSPromise* readableStreamReaderGenericCancel(JSGlobalObject* globalObject, JSReadableStreamReaderBase* reader, JSValue reason)
{
    auto* stream = reader->m_stream.get();
    ASSERT(stream);
    return readableStreamCancel(globalObject, stream, reason);
}

// SetUpReadableStreamDefaultReader(reader, stream)
void setUpReadableStreamDefaultReader(JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isReadableStreamLocked(stream)) {
        throwException(globalObject, scope, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream is locked"_s));
        return;
    }
    RELEASE_AND_RETURN(scope, readableStreamReaderGenericInitialize(globalObject, reader, stream));
}

// SetUpReadableStreamBYOBReader(reader, stream)
void setUpReadableStreamBYOBReader(JSGlobalObject* globalObject, JSReadableStreamBYOBReader* reader, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isReadableStreamLocked(stream)) {
        throwException(globalObject, scope, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream is locked"_s));
        return;
    }
    if (stream->m_controllerKind != ControllerKind::Byte) {
        throwTypeError(globalObject, scope, "A BYOB reader requires a ReadableStream with an underlying byte source"_s);
        return;
    }
    RELEASE_AND_RETURN(scope, readableStreamReaderGenericInitialize(globalObject, reader, stream));
}

// AcquireReadableStreamDefaultReader(stream)
JSReadableStreamDefaultReader* acquireReadableStreamDefaultReader(JSGlobalObject* globalObject, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* reader = JSReadableStreamDefaultReader::create(vm, WebCore::getDOMStructure<JSReadableStreamDefaultReader>(vm, *domGlobalObject));
    setUpReadableStreamDefaultReader(globalObject, reader, stream);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return reader;
}

// AcquireReadableStreamBYOBReader(stream)
JSReadableStreamBYOBReader* acquireReadableStreamBYOBReader(JSGlobalObject* globalObject, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* reader = JSReadableStreamBYOBReader::create(vm, WebCore::getDOMStructure<JSReadableStreamBYOBReader>(vm, *domGlobalObject));
    setUpReadableStreamBYOBReader(globalObject, reader, stream);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return reader;
}

// SetUpReadableStreamDefaultController steps 1-8. The caller populated the controller's
// algorithm slots; the start reaction (steps 10-12) is registered by the caller.
static void installDefaultController(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStream* __restrict stream, JSReadableStreamDefaultController* __restrict controller, double highWaterMark)
{
    ASSERT(stream->m_controllerKind == ControllerKind::None && !stream->m_controller);
    controller->m_stream.set(vm, controller, stream);
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.resetQueue(locker);
    }
    controller->m_started = false;
    controller->m_closeRequested = false;
    controller->m_pullAgain = false;
    controller->m_pulling = false;
    controller->m_strategyHWM = highWaterMark;
    stream->m_controller.set(vm, stream, controller);
    stream->m_controllerKind = ControllerKind::Default;
}

void setUpReadableStreamDefaultController(JSGlobalObject* globalObject, JSReadableStream* stream, JSReadableStreamDefaultController* controller, JSValue startResult, double highWaterMark)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    installDefaultController(vm, globalObject, stream, controller, highWaterMark);
    RELEASE_AND_RETURN(scope, reactToStartResult(vm, globalObject, startResult, runtime->onRSDefaultControllerStartFulfilled(), runtime->onRSDefaultControllerStartRejected(), controller));
}

void setUpReadableStreamDefaultControllerFromUnderlyingSource(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue underlyingSource, const UnderlyingSourceDict& dict, double highWaterMark, JSObject* sizeAlgorithm)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* domGlobalObject = defaultGlobalObject(globalObject);

    auto* controller = JSReadableStreamDefaultController::create(vm, WebCore::getDOMStructure<JSReadableStreamDefaultController>(vm, *domGlobalObject));
    controller->m_algorithms.kind = SourceKind::JavaScript;
    controller->m_algorithms.underlyingObject.set(vm, controller, underlyingSource);
    if (dict.pull)
        controller->m_algorithms.method1.set(vm, controller, asObject(dict.pull));
    if (dict.cancel)
        controller->m_algorithms.method2.set(vm, controller, asObject(dict.cancel));
    if (sizeAlgorithm)
        controller->m_strategySizeAlgorithm.set(vm, controller, sizeAlgorithm);

    installDefaultController(vm, globalObject, stream, controller, highWaterMark);

    JSValue startResult = jsUndefined();
    if (dict.start) {
        auto callData = JSC::getCallData(dict.start);
        MarkedArgumentBuffer args;
        args.append(controller);
        ASSERT(!args.hasOverflowed());
        startResult = JSC::call(globalObject, dict.start, callData, underlyingSource, args);
        RETURN_IF_EXCEPTION(scope, void());
    }
    RELEASE_AND_RETURN(scope, reactToStartResult(vm, globalObject, startResult, runtime->onRSDefaultControllerStartFulfilled(), runtime->onRSDefaultControllerStartRejected(), controller));
}

// SetUpReadableByteStreamController steps 1-13.
static void installByteController(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStream* __restrict stream, JSReadableByteStreamController* __restrict controller, double highWaterMark, std::optional<uint64_t> autoAllocateChunkSize)
{
    ASSERT(stream->m_controllerKind == ControllerKind::None && !stream->m_controller);
    if (autoAllocateChunkSize)
        ASSERT(*autoAllocateChunkSize > 0);
    controller->m_stream.set(vm, controller, stream);
    controller->m_pullAgain = false;
    controller->m_pulling = false;
    controller->m_byobRequest.clear();
    {
        WTF::Locker locker { controller->cellLock() };
        controller->m_queue.resetQueue(locker);
        controller->m_pendingPullIntos.clear();
    }
    controller->m_closeRequested = false;
    controller->m_started = false;
    controller->m_strategyHWM = highWaterMark;
    controller->m_autoAllocateChunkSize = autoAllocateChunkSize.value_or(0);
    stream->m_controller.set(vm, stream, controller);
    stream->m_controllerKind = ControllerKind::Byte;
}

void setUpReadableByteStreamController(JSGlobalObject* globalObject, JSReadableStream* stream, JSReadableByteStreamController* controller, JSValue startResult, double highWaterMark, std::optional<uint64_t> autoAllocateChunkSize)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    installByteController(vm, globalObject, stream, controller, highWaterMark, autoAllocateChunkSize);
    RELEASE_AND_RETURN(scope, reactToStartResult(vm, globalObject, startResult, runtime->onRSByteControllerStartFulfilled(), runtime->onRSByteControllerStartRejected(), controller));
}

void setUpReadableByteStreamControllerFromUnderlyingSource(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue underlyingSource, const UnderlyingSourceDict& dict, double highWaterMark)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* domGlobalObject = defaultGlobalObject(globalObject);

    auto* controller = JSReadableByteStreamController::create(vm, WebCore::getDOMStructure<JSReadableByteStreamController>(vm, *domGlobalObject));
    controller->m_algorithms.kind = SourceKind::JavaScript;
    controller->m_algorithms.underlyingObject.set(vm, controller, underlyingSource);
    if (dict.pull)
        controller->m_algorithms.method1.set(vm, controller, asObject(dict.pull));
    if (dict.cancel)
        controller->m_algorithms.method2.set(vm, controller, asObject(dict.cancel));

    if (dict.autoAllocateChunkSize && !*dict.autoAllocateChunkSize) {
        throwTypeError(globalObject, scope, "autoAllocateChunkSize must be greater than 0"_s);
        return;
    }
    installByteController(vm, globalObject, stream, controller, highWaterMark, dict.autoAllocateChunkSize);

    JSValue startResult = jsUndefined();
    if (dict.start) {
        auto callData = JSC::getCallData(dict.start);
        MarkedArgumentBuffer args;
        args.append(controller);
        ASSERT(!args.hasOverflowed());
        startResult = JSC::call(globalObject, dict.start, callData, underlyingSource, args);
        RETURN_IF_EXCEPTION(scope, void());
    }
    RELEASE_AND_RETURN(scope, reactToStartResult(vm, globalObject, startResult, runtime->onRSByteControllerStartFulfilled(), runtime->onRSByteControllerStartRejected(), controller));
}

// CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm[, highWaterMark[, sizeAlgorithm]])
JSReadableStream* createReadableStream(JSGlobalObject* globalObject, SourceKind kind, JSCell* algorithmContext, JSValue startResult, double highWaterMark, JSObject* sizeAlgorithm)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    ASSERT(isNonNegativeNumber(jsNumber(highWaterMark)));

    auto* stream = JSReadableStream::create(vm, WebCore::getDOMStructure<JSReadableStream>(vm, *domGlobalObject));
    initializeReadableStream(stream);
    auto* controller = JSReadableStreamDefaultController::create(vm, WebCore::getDOMStructure<JSReadableStreamDefaultController>(vm, *domGlobalObject));
    controller->m_algorithms.kind = kind;
    if (algorithmContext)
        controller->m_algorithms.algorithmContext.set(vm, controller, algorithmContext);
    if (sizeAlgorithm)
        controller->m_strategySizeAlgorithm.set(vm, controller, sizeAlgorithm);
    setUpReadableStreamDefaultController(globalObject, stream, controller, startResult, highWaterMark);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return stream;
}

// CreateReadableByteStream(startAlgorithm, pullAlgorithm, cancelAlgorithm)
JSReadableStream* createReadableByteStream(JSGlobalObject* globalObject, SourceKind kind, JSCell* algorithmContext)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);

    auto* stream = JSReadableStream::create(vm, WebCore::getDOMStructure<JSReadableStream>(vm, *domGlobalObject));
    initializeReadableStream(stream);
    auto* controller = JSReadableByteStreamController::create(vm, WebCore::getDOMStructure<JSReadableByteStreamController>(vm, *domGlobalObject));
    controller->m_algorithms.kind = kind;
    if (algorithmContext)
        controller->m_algorithms.algorithmContext.set(vm, controller, algorithmContext);
    setUpReadableByteStreamController(globalObject, stream, controller, jsUndefined(), 0, std::nullopt);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return stream;
}

// `ReadableStream.from(x)` where x has no usable @@asyncIterator/@@iterator. The spec only
// says "throw a TypeError"; Node additionally tags it and renders the argument the way `%s`
// does, e.g. `{ a: 1 } must be iterable`.
static void throwNotIterable(JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue iterable)
{
    WTF::StringBuilder builder;
    Bun::JSValueToStringSafe(globalObject, builder, iterable, false);
    RETURN_IF_EXCEPTION(scope, );
    builder.append(" must be iterable"_s);
    Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ARG_NOT_ITERABLE, builder.toString());
}

// GetMethod(value, propertyName): a [[Get]] on the boxed value (GetV — legal on primitives),
// yielding undefined for undefined/null. A non-callable method is "not iterable" to Node.
static JSValue getMethodOnValue(JSC::VM& vm, JSGlobalObject* globalObject, JSValue value, PropertyName propertyName)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = value.get(globalObject, propertyName);
    RETURN_IF_EXCEPTION(scope, {});
    if (method.isUndefinedOrNull())
        return jsUndefined();
    if (!method.isCallable()) {
        throwNotIterable(globalObject, scope, value);
        return {};
    }
    return method;
}

// GetIterator(obj, ASYNC). JSC's getAsyncIterator requires an object, but GetIterator does not:
// primitives (a string) are valid sync iterables here, so ReadableStream.from("ab") must stream
// its code points. The sync fallback wraps the sync iterator in JSC's AsyncFromSyncIterator.
static IterationRecord getIteratorAsync(JSC::VM& vm, JSGlobalObject* globalObject, JSValue iterable)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue asyncMethod = getMethodOnValue(vm, globalObject, iterable, vm.propertyNames->asyncIteratorSymbol);
    RETURN_IF_EXCEPTION(scope, {});
    if (asyncMethod.isUndefined()) {
        JSValue syncMethod = getMethodOnValue(vm, globalObject, iterable, vm.propertyNames->iteratorSymbol);
        RETURN_IF_EXCEPTION(scope, {});
        if (syncMethod.isUndefined()) {
            throwNotIterable(globalObject, scope, iterable);
            return {};
        }
        auto callData = JSC::getCallData(syncMethod);
        JSValue syncIterator = JSC::call(globalObject, syncMethod, callData, iterable, ArgList());
        RETURN_IF_EXCEPTION(scope, {});
        if (!syncIterator.isObject()) {
            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The iterator method must return an object"_s);
            return {};
        }
        IterationRecord syncRecord = iteratorDirect(globalObject, syncIterator);
        RETURN_IF_EXCEPTION(scope, {});
        auto* asyncFromSyncIterator = JSAsyncFromSyncIterator::create(vm, globalObject->asyncFromSyncIteratorStructure(), syncRecord.iterator, syncRecord.nextMethod);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, iteratorDirect(globalObject, asyncFromSyncIterator));
    }
    auto callData = JSC::getCallData(asyncMethod);
    JSValue iterator = JSC::call(globalObject, asyncMethod, callData, iterable, ArgList());
    RETURN_IF_EXCEPTION(scope, {});
    if (!iterator.isObject()) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The iterator method must return an object"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, iteratorDirect(globalObject, iterator));
}

// ReadableStreamFromIterable(asyncIterable)
JSReadableStream* readableStreamFromIterable(JSGlobalObject* globalObject, JSValue asyncIterable)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* domGlobalObject = defaultGlobalObject(globalObject);

    IterationRecord iteratorRecord = getIteratorAsync(vm, globalObject, asyncIterable);
    RETURN_IF_EXCEPTION(scope, nullptr);

    auto* context = WebCore::JSStreamFromIterableContext::create(vm, runtime->fromIterableContextStructure(domGlobalObject));
    context->m_iterator.set(vm, context, asObject(iteratorRecord.iterator));
    context->m_nextMethod.set(vm, context, iteratorRecord.nextMethod);
    RELEASE_AND_RETURN(scope, createReadableStream(globalObject, SourceKind::FromIterable, context, jsUndefined(), 0, nullptr));
}

// ReadableStream.from's pullAlgorithm.
JSPromise* fromIterablePullAlgorithm(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    const auto* context = uncheckedDowncast<WebCore::JSStreamFromIterableContext>(controller->m_algorithms.algorithmContext.get());
    IterationRecord iteratorRecord { context->m_iterator.get(), context->m_nextMethod.get() };

    JSValue nextResult;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        nextResult = iteratorNextExported(globalObject, iteratorRecord);
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return nullptr;
            RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
        }
    }
    auto* nextPromise = promiseResolvedWith(globalObject, nextResult);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    nextPromise->performPromiseThenWithContext(vm, globalObject, runtime->onFromIterablePullFulfilled(), jsUndefined(), result, controller);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return result;
}

// ReadableStream.from's cancelAlgorithm.
JSPromise* fromIterableCancelAlgorithm(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    const auto* context = uncheckedDowncast<WebCore::JSStreamFromIterableContext>(controller->m_algorithms.algorithmContext.get());
    JSObject* iterator = context->m_iterator.get();

    JSValue returnMethod;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        returnMethod = iterator->get(globalObject, vm.propertyNames->returnKeyword);
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return nullptr;
            RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
        }
    }
    if (returnMethod.isUndefinedOrNull())
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    if (!returnMethod.isCallable()) {
        JSObject* notCallable = createTypeError(globalObject, "The async iterator's return property must be callable"_s);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, notCallable));
    }

    JSValue returnResult;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        auto callData = JSC::getCallData(returnMethod);
        MarkedArgumentBuffer args;
        args.append(reason);
        ASSERT(!args.hasOverflowed());
        returnResult = JSC::call(globalObject, returnMethod, callData, iterator, args);
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return nullptr;
            RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
        }
    }
    auto* returnPromise = promiseResolvedWith(globalObject, returnResult);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    returnPromise->performPromiseThenWithContext(vm, globalObject, runtime->onFromIterableCancelFulfilled(), jsUndefined(), result, controller);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return result;
}

// The [reaction-convention] body of onFromIterablePullFulfilled(iterResult, controller).
static EncodedJSValue fromIterablePullFulfilled(JSGlobalObject* globalObject, JSValue iterResult, JSReadableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!iterResult.isObject())
        return throwVMTypeError(globalObject, scope, "The promise returned by the async iterator's next() method must fulfill with an object"_s);
    bool done = iteratorCompleteExported(globalObject, iterResult);
    RETURN_IF_EXCEPTION(scope, {});
    if (done) {
        readableStreamDefaultControllerClose(globalObject, controller);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }
    JSValue value = iteratorValue(globalObject, iterResult);
    RETURN_IF_EXCEPTION(scope, {});
    readableStreamDefaultControllerEnqueue(globalObject, controller, value);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// The [reaction-convention] body of onFromIterableCancelFulfilled(iterResult, controller).
static EncodedJSValue fromIterableCancelFulfilled(JSGlobalObject* globalObject, JSValue iterResult)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!iterResult.isObject())
        return throwVMTypeError(globalObject, scope, "The promise returned by the async iterator's return() method must fulfill with an object"_s);
    return JSValue::encode(jsUndefined());
}

// Bun: `$structuredCloneForStream(chunk)` — the shared native host function installed as a
// private static global; the default tee's cloneForBranch2 path is its only caller here.
static JSValue structuredCloneChunk(JSC::VM& vm, JSGlobalObject* globalObject, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    JSValue cloneFunction = domGlobalObject->get(globalObject, WebCore::builtinNames(vm).structuredCloneForStreamPrivateName());
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(cloneFunction);
    MarkedArgumentBuffer args;
    args.append(chunk);
    ASSERT(!args.hasOverflowed());
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, cloneFunction, callData, jsUndefined(), args));
}

// ReadableStreamDefaultTee's shared pullAlgorithm.
JSPromise* defaultTeePullAlgorithm(JSGlobalObject* globalObject, JSStreamTeeState* teeState, uint8_t)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    if (teeState->m_reading) {
        teeState->m_readAgain1 = true;
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    }
    teeState->m_reading = true;
    auto* readRequest = WebCore::JSReadRequest::create(vm, runtime->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::DefaultTee, teeState);
    readableStreamDefaultReaderRead(globalObject, uncheckedDowncast<JSReadableStreamDefaultReader>(teeState->m_reader.get()), readRequest);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

// ReadableStreamDefaultTee's cancel1Algorithm / cancel2Algorithm.
JSPromise* defaultTeeCancelAlgorithm(JSGlobalObject* globalObject, JSStreamTeeState* teeState, uint8_t branch, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!branch) {
        teeState->m_canceled1 = true;
        teeState->m_reason1.set(vm, teeState, reason);
    } else {
        teeState->m_canceled2 = true;
        teeState->m_reason2.set(vm, teeState, reason);
    }
    if ((!branch && teeState->m_canceled2) || (branch && teeState->m_canceled1)) {
        JSArray* compositeReason = constructArrayPair(globalObject, teeState->m_reason1.get(), teeState->m_reason2.get());
        RETURN_IF_EXCEPTION(scope, nullptr);
        auto* cancelResult = readableStreamCancel(globalObject, teeState->m_stream.get(), compositeReason);
        RETURN_IF_EXCEPTION(scope, nullptr);
        resolvePromise(globalObject, teeState->m_cancelPromise.get(), cancelResult);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return teeState->m_cancelPromise.get();
}

// The default-tee read request's chunk steps run as a microtask
// (onDefaultTeeReadChunkMicrotask). Each canceled flag is re-read live, as the spec does.
static EncodedJSValue defaultTeeChunkStepsMicrotask(JSGlobalObject* globalObject, JSValue chunk, JSStreamTeeState* teeState)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    teeState->m_readAgain1 = false;
    auto* controller1 = teeBranchDefaultController(teeState->m_branch1.get());
    auto* controller2 = teeBranchDefaultController(teeState->m_branch2.get());
    JSValue chunk1 = chunk;
    JSValue chunk2 = chunk;
    if (!teeState->m_canceled2 && teeState->m_shouldClone) {
        JSValue cloneResult;
        {
            auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            cloneResult = structuredCloneChunk(vm, globalObject, chunk2);
            if (catchScope.exception()) [[unlikely]] {
                JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
                if (thrown.isEmpty())
                    return {};
                if (controller1) {
                    readableStreamDefaultControllerError(globalObject, controller1, thrown);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                if (controller2) {
                    readableStreamDefaultControllerError(globalObject, controller2, thrown);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                auto* cancelResult = readableStreamCancel(globalObject, teeState->m_stream.get(), thrown);
                RETURN_IF_EXCEPTION(scope, {});
                resolvePromise(globalObject, teeState->m_cancelPromise.get(), cancelResult);
                RETURN_IF_EXCEPTION(scope, {});
                return JSValue::encode(jsUndefined());
            }
        }
        chunk2 = cloneResult;
    }
    if (!teeState->m_canceled1 && controller1) {
        readableStreamDefaultControllerEnqueue(globalObject, controller1, chunk1);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!teeState->m_canceled2 && controller2) {
        readableStreamDefaultControllerEnqueue(globalObject, controller2, chunk2);
        RETURN_IF_EXCEPTION(scope, {});
    }
    teeState->m_reading = false;
    if (teeState->m_readAgain1) {
        defaultTeePullAlgorithm(globalObject, teeState, 0);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

// "Upon rejection of reader.[[closedPromise]] with reason r" (default tee).
static EncodedJSValue defaultTeeReaderClosedRejected(JSGlobalObject* globalObject, JSValue reason, JSStreamTeeState* teeState)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (auto* controller1 = teeBranchDefaultController(teeState->m_branch1.get())) {
        readableStreamDefaultControllerError(globalObject, controller1, reason);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (auto* controller2 = teeBranchDefaultController(teeState->m_branch2.get())) {
        readableStreamDefaultControllerError(globalObject, controller2, reason);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!teeState->m_canceled1 || !teeState->m_canceled2) {
        resolvePromise(globalObject, teeState->m_cancelPromise.get(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

// ReadableStreamDefaultTee(stream, cloneForBranch2)
std::pair<JSReadableStream*, JSReadableStream*> readableStreamDefaultTee(JSGlobalObject* globalObject, JSReadableStream* stream, bool cloneForBranch2)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    std::pair<JSReadableStream*, JSReadableStream*> failure { nullptr, nullptr };

    auto* reader = acquireReadableStreamDefaultReader(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, failure);

    auto* teeState = WebCore::JSStreamTeeState::create(vm, runtime->teeStateStructure(domGlobalObject));
    teeState->m_stream.set(vm, teeState, stream);
    teeState->m_reader.set(vm, teeState, reader);
    teeState->m_shouldClone = cloneForBranch2;
    teeState->m_cancelPromise.set(vm, teeState, JSPromise::create(vm, globalObject->promiseStructure()));

    auto* branch1 = createReadableStream(globalObject, SourceKind::TeeBranch, teeState, jsUndefined());
    RETURN_IF_EXCEPTION(scope, failure);
    defaultControllerOf(branch1)->m_algorithms.teeBranchIndex = 0;
    teeState->m_branch1.set(vm, teeState, branch1);

    auto* branch2 = createReadableStream(globalObject, SourceKind::TeeBranch, teeState, jsUndefined());
    RETURN_IF_EXCEPTION(scope, failure);
    defaultControllerOf(branch2)->m_algorithms.teeBranchIndex = 1;
    teeState->m_branch2.set(vm, teeState, branch2);

    reader->m_closedPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReturnUndefined(), runtime->onDefaultTeeReaderClosedRejected(), jsUndefined(), teeState);
    RETURN_IF_EXCEPTION(scope, failure);
    return { branch1, branch2 };
}

// ReadableByteStreamTee's forwardReaderError(thisReader).
static void byteTeeForwardReaderError(JSC::VM& vm, JSGlobalObject* globalObject, JSStreamTeeState* teeState, JSReadableStreamReaderBase* thisReader)
{
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), teeState, thisReader);
    thisReader->m_closedPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReturnUndefined(), runtime->onByteTeeReaderClosedRejected(), jsUndefined(), context);
}

// ReadableByteStreamTee's pullWithDefaultReader.
static void byteTeePullWithDefaultReader(JSC::VM& vm, JSGlobalObject* globalObject, JSStreamTeeState* teeState)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* reader = teeReader(teeState);
    if (reader->isBYOB()) {
        auto* byobReader = static_cast<JSReadableStreamBYOBReader*>(reader);
        ASSERT(byobReader->m_readIntoRequests.isEmpty());
        readableStreamBYOBReaderRelease(globalObject, byobReader);
        RETURN_IF_EXCEPTION(scope, void());
        auto* defaultReader = acquireReadableStreamDefaultReader(globalObject, teeState->m_stream.get());
        RETURN_IF_EXCEPTION(scope, void());
        teeState->m_reader.set(vm, teeState, defaultReader);
        byteTeeForwardReaderError(vm, globalObject, teeState, defaultReader);
        RETURN_IF_EXCEPTION(scope, void());
        reader = defaultReader;
    }
    auto* readRequest = WebCore::JSReadRequest::create(vm, runtime->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::ByteTee, teeState);
    RELEASE_AND_RETURN(scope, readableStreamDefaultReaderRead(globalObject, static_cast<JSReadableStreamDefaultReader*>(reader), readRequest));
}

// ReadableByteStreamTee's pullWithBYOBReader(view, forBranch2).
static void byteTeePullWithBYOBReader(JSC::VM& vm, JSGlobalObject* globalObject, JSStreamTeeState* teeState, JSArrayBufferView* view, bool forBranch2)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* reader = teeReader(teeState);
    if (!reader->isBYOB()) {
        auto* defaultReader = static_cast<JSReadableStreamDefaultReader*>(reader);
        ASSERT(defaultReader->m_readRequests.isEmpty());
        readableStreamDefaultReaderRelease(globalObject, defaultReader);
        RETURN_IF_EXCEPTION(scope, void());
        auto* byobReader = acquireReadableStreamBYOBReader(globalObject, teeState->m_stream.get());
        RETURN_IF_EXCEPTION(scope, void());
        teeState->m_reader.set(vm, teeState, byobReader);
        byteTeeForwardReaderError(vm, globalObject, teeState, byobReader);
        RETURN_IF_EXCEPTION(scope, void());
        reader = byobReader;
    }
    // The read-into request's chunk/close steps need `forBranch2`; the context is therefore
    // the InternalFieldTuple {teeState, forBranch2}.
    auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), teeState, jsBoolean(forBranch2));
    auto* readIntoRequest = WebCore::JSReadIntoRequest::create(vm, runtime->readIntoRequestStructure(defaultGlobalObject(globalObject)), ReadIntoRequestKind::ByteTee, context);
    RELEASE_AND_RETURN(scope, readableStreamBYOBReaderRead(globalObject, static_cast<JSReadableStreamBYOBReader*>(reader), view, 1, readIntoRequest));
}

// ReadableByteStreamTee's pull1Algorithm / pull2Algorithm.
JSPromise* byteTeePullAlgorithm(JSGlobalObject* globalObject, JSStreamTeeState* teeState, uint8_t branch)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (teeState->m_reading) {
        if (!branch)
            teeState->m_readAgain1 = true;
        else
            teeState->m_readAgain2 = true;
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    }
    teeState->m_reading = true;
    auto* branchStream = branch ? teeState->m_branch2.get() : teeState->m_branch1.get();
    const auto* byobRequest = readableByteStreamControllerGetBYOBRequest(globalObject, byteControllerOf(branchStream));
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!byobRequest)
        byteTeePullWithDefaultReader(vm, globalObject, teeState);
    else
        byteTeePullWithBYOBReader(vm, globalObject, teeState, byobRequest->m_view.get(), !!branch);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

// ReadableByteStreamTee's cancel1Algorithm / cancel2Algorithm.
JSPromise* byteTeeCancelAlgorithm(JSGlobalObject* globalObject, JSStreamTeeState* teeState, uint8_t branch, JSValue reason)
{
    return defaultTeeCancelAlgorithm(globalObject, teeState, branch, reason);
}

// The byte tee's default-reader chunk steps microtask (onByteTeeReadChunkMicrotask).
static EncodedJSValue byteTeeChunkStepsMicrotask(JSGlobalObject* globalObject, JSValue chunk, JSStreamTeeState* teeState)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    teeState->m_readAgain1 = false;
    teeState->m_readAgain2 = false;
    auto* controller1 = teeBranchByteController(teeState->m_branch1.get());
    auto* controller2 = teeBranchByteController(teeState->m_branch2.get());
    auto* chunk1 = uncheckedDowncast<JSArrayBufferView>(chunk);
    JSArrayBufferView* chunk2 = chunk1;
    if (!teeState->m_canceled1 && !teeState->m_canceled2) {
        JSUint8Array* cloneResult = nullptr;
        {
            auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            cloneResult = cloneAsUint8Array(globalObject, chunk1);
            if (catchScope.exception()) [[unlikely]] {
                JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
                if (thrown.isEmpty())
                    return {};
                if (controller1) {
                    readableByteStreamControllerError(globalObject, controller1, thrown);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                if (controller2) {
                    readableByteStreamControllerError(globalObject, controller2, thrown);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                auto* cancelResult = readableStreamCancel(globalObject, teeState->m_stream.get(), thrown);
                RETURN_IF_EXCEPTION(scope, {});
                resolvePromise(globalObject, teeState->m_cancelPromise.get(), cancelResult);
                RETURN_IF_EXCEPTION(scope, {});
                return JSValue::encode(jsUndefined());
            }
        }
        chunk2 = cloneResult;
    }
    if (!teeState->m_canceled1 && controller1) {
        readableByteStreamControllerEnqueue(globalObject, controller1, chunk1);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!teeState->m_canceled2 && controller2) {
        readableByteStreamControllerEnqueue(globalObject, controller2, chunk2);
        RETURN_IF_EXCEPTION(scope, {});
    }
    teeState->m_reading = false;
    if (teeState->m_readAgain1) {
        byteTeePullAlgorithm(globalObject, teeState, 0);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (teeState->m_readAgain2) {
        byteTeePullAlgorithm(globalObject, teeState, 1);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

// The byte tee's BYOB-reader chunk steps microtask (onByteTeeReadIntoChunkMicrotask).
static EncodedJSValue byteTeeReadIntoChunkStepsMicrotask(JSGlobalObject* globalObject, JSValue chunkValue, InternalFieldTuple* context)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* teeState = uncheckedDowncast<JSStreamTeeState>(context->getInternalField(0));
    bool forBranch2 = context->getInternalField(1).asBoolean();
    auto* chunk = uncheckedDowncast<JSArrayBufferView>(chunkValue);

    teeState->m_readAgain1 = false;
    teeState->m_readAgain2 = false;
    auto* byobBranch = forBranch2 ? teeState->m_branch2.get() : teeState->m_branch1.get();
    auto* otherBranch = forBranch2 ? teeState->m_branch1.get() : teeState->m_branch2.get();
    auto* byobController = teeBranchByteController(byobBranch);
    auto* otherController = teeBranchByteController(otherBranch);
    bool byobCanceled = forBranch2 ? teeState->m_canceled2 : teeState->m_canceled1;
    bool otherCanceled = forBranch2 ? teeState->m_canceled1 : teeState->m_canceled2;

    if (!otherCanceled) {
        JSUint8Array* clonedChunk = nullptr;
        {
            auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            clonedChunk = cloneAsUint8Array(globalObject, chunk);
            if (catchScope.exception()) [[unlikely]] {
                JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
                if (thrown.isEmpty())
                    return {};
                if (byobController) {
                    readableByteStreamControllerError(globalObject, byobController, thrown);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                if (otherController) {
                    readableByteStreamControllerError(globalObject, otherController, thrown);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                auto* cancelResult = readableStreamCancel(globalObject, teeState->m_stream.get(), thrown);
                RETURN_IF_EXCEPTION(scope, {});
                resolvePromise(globalObject, teeState->m_cancelPromise.get(), cancelResult);
                RETURN_IF_EXCEPTION(scope, {});
                return JSValue::encode(jsUndefined());
            }
        }
        if (!byobCanceled && byobController) {
            readableByteStreamControllerRespondWithNewView(globalObject, byobController, chunk);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (otherController) {
            readableByteStreamControllerEnqueue(globalObject, otherController, clonedChunk);
            RETURN_IF_EXCEPTION(scope, {});
        }
    } else if (!byobCanceled && byobController) {
        readableByteStreamControllerRespondWithNewView(globalObject, byobController, chunk);
        RETURN_IF_EXCEPTION(scope, {});
    }
    teeState->m_reading = false;
    if (teeState->m_readAgain1) {
        byteTeePullAlgorithm(globalObject, teeState, 0);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (teeState->m_readAgain2) {
        byteTeePullAlgorithm(globalObject, teeState, 1);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

// forwardReaderError's rejection handler (onByteTeeReaderClosedRejected).
static EncodedJSValue byteTeeReaderClosedRejected(JSGlobalObject* globalObject, JSValue reason, InternalFieldTuple* context)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* teeState = uncheckedDowncast<JSStreamTeeState>(context->getInternalField(0));
    if (context->getInternalField(1) != teeState->m_reader.get())
        return JSValue::encode(jsUndefined());
    if (auto* controller1 = teeBranchByteController(teeState->m_branch1.get())) {
        readableByteStreamControllerError(globalObject, controller1, reason);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (auto* controller2 = teeBranchByteController(teeState->m_branch2.get())) {
        readableByteStreamControllerError(globalObject, controller2, reason);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!teeState->m_canceled1 || !teeState->m_canceled2) {
        resolvePromise(globalObject, teeState->m_cancelPromise.get(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

// ReadableByteStreamTee(stream)
std::pair<JSReadableStream*, JSReadableStream*> readableByteStreamTee(JSGlobalObject* globalObject, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    std::pair<JSReadableStream*, JSReadableStream*> failure { nullptr, nullptr };
    ASSERT(stream->m_controllerKind == ControllerKind::Byte);

    auto* reader = acquireReadableStreamDefaultReader(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, failure);

    auto* teeState = WebCore::JSStreamTeeState::create(vm, runtime->teeStateStructure(domGlobalObject));
    teeState->m_stream.set(vm, teeState, stream);
    teeState->m_reader.set(vm, teeState, reader);
    teeState->m_cancelPromise.set(vm, teeState, JSPromise::create(vm, globalObject->promiseStructure()));

    auto* branch1 = createReadableByteStream(globalObject, SourceKind::ByteTeeBranch, teeState);
    RETURN_IF_EXCEPTION(scope, failure);
    byteControllerOf(branch1)->m_algorithms.teeBranchIndex = 0;
    teeState->m_branch1.set(vm, teeState, branch1);

    auto* branch2 = createReadableByteStream(globalObject, SourceKind::ByteTeeBranch, teeState);
    RETURN_IF_EXCEPTION(scope, failure);
    byteControllerOf(branch2)->m_algorithms.teeBranchIndex = 1;
    teeState->m_branch2.set(vm, teeState, branch2);

    byteTeeForwardReaderError(vm, globalObject, teeState, reader);
    RETURN_IF_EXCEPTION(scope, failure);
    return { branch1, branch2 };
}

// ReadableStreamTee(stream, cloneForBranch2)
std::pair<JSReadableStream*, JSReadableStream*> readableStreamTee(JSGlobalObject* globalObject, JSReadableStream* stream, bool cloneForBranch2)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::pair<JSReadableStream*, JSReadableStream*> failure { nullptr, nullptr };
    stream->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, failure);
    if (stream->m_controllerKind == ControllerKind::Byte)
        RELEASE_AND_RETURN(scope, readableByteStreamTee(globalObject, stream));
    RELEASE_AND_RETURN(scope, readableStreamDefaultTee(globalObject, stream, cloneForBranch2));
}

// ReadableStreamPipeTo(source, dest, preventClose, preventAbort, preventCancel[, signal]).
// Validates, allocates + populates the operation cell, then hands it to startPipeToOperation.
JSPromise* readableStreamPipeTo(JSGlobalObject* globalObject, JSReadableStream* source, JSWritableStream* destination, bool preventClose, bool preventAbort, bool preventCancel, JSObject* signal)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* domGlobalObject = defaultGlobalObject(globalObject);

    source->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    ASSERT(!isReadableStreamLocked(source));
    ASSERT(!isWritableStreamLocked(destination));

    auto* reader = acquireReadableStreamDefaultReader(globalObject, source);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* writer = acquireWritableStreamDefaultWriter(globalObject, destination);
    RETURN_IF_EXCEPTION(scope, nullptr);
    source->m_disturbed = true;

    auto* operation = WebCore::JSStreamPipeToOperation::create(vm, runtime->pipeToOperationStructure(domGlobalObject));
    operation->m_source.set(vm, operation, source);
    operation->m_destination.set(vm, operation, destination);
    operation->m_reader.set(vm, operation, reader);
    operation->m_writer.set(vm, operation, writer);
    operation->m_preventClose = preventClose;
    operation->m_preventAbort = preventAbort;
    operation->m_preventCancel = preventCancel;
    if (signal)
        operation->m_signal.set(vm, operation, signal);
    operation->m_promise.set(vm, operation, JSPromise::create(vm, globalObject->promiseStructure()));
    reader->m_pipeOperation.set(vm, reader, operation);
    writer->m_pipeOperation.set(vm, writer, operation);

    startPipeToOperation(globalObject, operation);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return operation->m_promise.get();
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
namespace Streams = Bun::WebStreams;

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onFromIterablePullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* controller = uncheckedDowncast<JSReadableStreamDefaultController>(callFrame->argument(1));
    return Streams::fromIterablePullFulfilled(globalObject, callFrame->argument(0), controller);
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onFromIterableCancelFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return Streams::fromIterableCancelFulfilled(globalObject, callFrame->argument(0));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDefaultTeeReadChunkMicrotask, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return Streams::defaultTeeChunkStepsMicrotask(globalObject, callFrame->argument(0), uncheckedDowncast<JSStreamTeeState>(callFrame->argument(1)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDefaultTeeReaderClosedRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return Streams::defaultTeeReaderClosedRejected(globalObject, callFrame->argument(0), uncheckedDowncast<JSStreamTeeState>(callFrame->argument(1)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onByteTeeReadChunkMicrotask, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return Streams::byteTeeChunkStepsMicrotask(globalObject, callFrame->argument(0), uncheckedDowncast<JSStreamTeeState>(callFrame->argument(1)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onByteTeeReadIntoChunkMicrotask, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return Streams::byteTeeReadIntoChunkStepsMicrotask(globalObject, callFrame->argument(0), uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onByteTeeReaderClosedRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return Streams::byteTeeReaderClosedRejected(globalObject, callFrame->argument(0), uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1)));
}

} // namespace WebCore
