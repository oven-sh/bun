#include "config.h"
#include "JSDirectStreamController.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSReadRequest.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/Locker.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static constexpr auto directControllerClosedMessage = "ReadableStreamDirectController is now closed"_s;

const ClassInfo JSDirectStreamController::s_info = { "DirectStreamController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDirectStreamController) };

JSDirectStreamController::JSDirectStreamController(VM& vm, Structure* structure, DirectSinkKind sinkKind)
    : Base(vm, structure)
{
    m_sinkKind = sinkKind;
}

JSDirectStreamController::~JSDirectStreamController() = default;

void JSDirectStreamController::destroy(JSCell* cell)
{
    static_cast<JSDirectStreamController*>(cell)->JSDirectStreamController::~JSDirectStreamController();
}

void JSDirectStreamController::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSDirectStreamController* JSDirectStreamController::create(VM& vm, Structure* structure, DirectSinkKind sinkKind)
{
    auto* cell = new (NotNull, allocateCell<JSDirectStreamController>(vm)) JSDirectStreamController(vm, structure, sinkKind);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSDirectStreamController::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSDirectStreamController::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDirectStreamController, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForDirectStreamController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForDirectStreamController = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForDirectStreamController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForDirectStreamController = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSDirectStreamController);

template<typename Visitor>
void JSDirectStreamController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDirectStreamController>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_stream);
    visitor.append(thisObject->m_underlyingSource);
    visitor.append(thisObject->m_pendingRead);
    visitor.append(thisObject->m_deferCloseReason);
    visitor.append(thisObject->m_arrayBufferSink);
    visitor.append(thisObject->m_array);
    visitor.append(thisObject->m_closingPromise);
    visitor.append(thisObject->m_finalChunk);
    Locker locker { thisObject->cellLock() };
    thisObject->m_textAccumulator.visit(locker, visitor);
}

// Restores the stream's construction-time async-context snapshot around the direct pull.
class DirectPullAsyncContextScope {
    WTF_MAKE_NONCOPYABLE(DirectPullAsyncContextScope);

public:
    DirectPullAsyncContextScope(JSGlobalObject* globalObject, JSReadableStream* stream)
        : m_vm(globalObject->vm())
    {
        JSValue snapshot = stream->m_asyncContext.get();
        if (!snapshot || snapshot.isUndefinedOrNull())
            return;
        m_asyncContextData = globalObject->m_asyncContextData.get();
        m_previous = m_asyncContextData->getInternalField(0);
        m_asyncContextData->putInternalField(m_vm, 0, snapshot);
    }
    ~DirectPullAsyncContextScope()
    {
        if (m_asyncContextData)
            m_asyncContextData->putInternalField(m_vm, 0, m_previous);
    }

private:
    VM& m_vm;
    InternalFieldTuple* m_asyncContextData { nullptr };
    JSValue m_previous;
};

static size_t byteLengthOf(JSValue value)
{
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value))
        return view->isDetached() ? 0 : view->byteLength();
    if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
        auto* impl = buffer->impl();
        return (!impl || impl->isDetached()) ? 0 : impl->byteLength();
    }
    return 0;
}

static JSValue callArrayBufferSinkMethod(JSGlobalObject* globalObject, JSObject* sink, ASCIILiteral name, MarkedArgumentBuffer& args)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue function = sink->get(globalObject, Identifier::fromString(vm, name));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, function, sink, args, "ArrayBufferSink method is not a function"_s));
}

static JSValue writeToArrayBufferSink(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue chunk)
{
    JSObject* sink = controller->m_arrayBufferSink.get();
    if (!sink) [[unlikely]]
        return jsUndefined();
    MarkedArgumentBuffer args;
    args.append(chunk);
    return callArrayBufferSinkMethod(globalObject, sink, "write"_s, args);
}

static JSValue writeToTextSink(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& accumulator = controller->m_textAccumulator;

    if (chunk.isString()) {
        auto* string = asString(chunk);
        unsigned length = string->length();
        if (length > 0) {
            String value = string->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            accumulator.rope.append(value);
            accumulator.hasString = true;
            accumulator.estimatedLength += length;
        }
        return jsNumber(length);
    }

    size_t byteLength = 0;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk))
        byteLength = view->isDetached() ? 0 : view->byteLength();
    else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(chunk))
        byteLength = (!buffer->impl() || buffer->impl()->isDetached()) ? 0 : buffer->impl()->byteLength();
    else {
        throwTypeError(globalObject, scope, "Expected text, ArrayBuffer or ArrayBufferView"_s);
        return {};
    }

    if (byteLength > 0) {
        accumulator.hasBuffer = true;
        JSString* ropeString = nullptr;
        if (!accumulator.rope.isEmpty()) {
            ropeString = jsString(vm, accumulator.rope.toString());
            RETURN_IF_EXCEPTION(scope, {});
        }
        // GC-allocation is done; the barrier container is only mutated under the cell lock.
        Locker locker { controller->cellLock() };
        if (ropeString) {
            accumulator.pieces.append(WriteBarrier<Unknown>(vm, controller, ropeString));
            accumulator.rope.clear();
        }
        accumulator.pieces.append(WriteBarrier<Unknown>(vm, controller, chunk));
    }
    accumulator.estimatedLength += byteLength;
    return jsNumber(byteLength);
}

static JSValue writeToArraySink(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* array = controller->m_array.get();
    if (!array) [[unlikely]]
        return jsUndefined();
    array->push(globalObject, chunk);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue byteLength = chunk.get(globalObject, vm.propertyNames->byteLength);
    RETURN_IF_EXCEPTION(scope, {});
    if (byteLength.toBoolean(globalObject))
        return byteLength;
    RELEASE_AND_RETURN(scope, chunk.get(globalObject, vm.propertyNames->length));
}

static JSValue writeToDirectSink(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue chunk)
{
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer:
        return writeToArrayBufferSink(globalObject, controller, chunk);
    case DirectSinkKind::Text:
        return writeToTextSink(globalObject, controller, chunk);
    case DirectSinkKind::Array:
        return writeToArraySink(globalObject, controller, chunk);
    }
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

static String finishTextSink(JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto& accumulator = controller->m_textAccumulator;
    if (!accumulator.hasString && !accumulator.hasBuffer)
        return emptyString();

    // Pure-string rope: the ONLY arm of the direct Text sink that strips a leading BOM.
    if (accumulator.hasString && !accumulator.hasBuffer) {
        String rope = accumulator.rope.toString();
        if (rope.length() && rope[0] == 0xFEFF)
            return rope.substring(1);
        return rope;
    }

    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    Vector<uint8_t> bytes;
    for (auto& piece : accumulator.pieces) {
        JSValue value = piece.get();
        if (value.isString()) {
            String string = asString(value)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto utf8 = string.utf8();
            bytes.append(std::span { reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length() });
        } else if (auto* view = dynamicDowncast<JSArrayBufferView>(value)) {
            if (!view->isDetached())
                bytes.append(view->span());
        } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
            if (buffer->impl() && !buffer->impl()->isDetached())
                bytes.append(buffer->impl()->span());
        }
    }
    if (!accumulator.rope.isEmpty()) {
        String rope = accumulator.rope.toString();
        if (rope[0] == 0xFEFF)
            rope = rope.substring(1);
        auto utf8 = rope.utf8();
        bytes.append(std::span { reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length() });
    }
    return String::fromUTF8ReplacingInvalidSequences(bytes.span());
}

static JSValue endTextSink(JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (controller->m_calledDone)
        return jsEmptyString(vm);
    controller->m_calledDone = true;
    String result = finishTextSink(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, {});
    JSString* resultString = jsString(vm, result);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* closingPromise = controller->m_closingPromise.get())
        closingPromise->fulfill(vm, resultString);
    return resultString;
}

static JSValue endArraySink(JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (controller->m_calledDone) [[unlikely]] {
        JSArray* empty = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        return empty;
    }
    controller->m_calledDone = true;
    JSArray* array = controller->m_array.get();
    if (auto* closingPromise = controller->m_closingPromise.get()) {
        resolvePromise(globalObject, closingPromise, array);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return array;
}

// `sink.end()`. May throw; the ArrayBufferSink slot is only cleared on success.
static JSValue endDirectSink(JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSObject* sink = controller->m_arrayBufferSink.get();
        if (!sink) [[unlikely]]
            return jsUndefined();
        MarkedArgumentBuffer args;
        JSValue flushed = callArrayBufferSinkMethod(globalObject, sink, "end"_s, args);
        RETURN_IF_EXCEPTION(scope, {});
        controller->m_arrayBufferSink.clear();
        return flushed;
    }
    case DirectSinkKind::Text:
        RELEASE_AND_RETURN(scope, endTextSink(globalObject, controller));
    case DirectSinkKind::Array:
        RELEASE_AND_RETURN(scope, endArraySink(globalObject, controller));
    }
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

// `sink.flush()`: only the ArrayBuffer sink produces bytes; the Text/Array sinks return 0.
static JSValue flushDirectSink(JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSObject* sink = controller->m_arrayBufferSink.get();
        if (!sink) [[unlikely]]
            return jsNumber(0);
        MarkedArgumentBuffer args;
        return callArrayBufferSinkMethod(globalObject, sink, "flush"_s, args);
    }
    case DirectSinkKind::Text:
    case DirectSinkKind::Array:
        return jsNumber(0);
    }
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

// `sink.close(error)`: the Text/Array sinks fulfill their closing promise with the partial result.
static void closeDirectSinkForError(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue error)
{
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSObject* sink = controller->m_arrayBufferSink.get();
        if (!sink)
            return;
        controller->m_arrayBufferSink.clear();
        MarkedArgumentBuffer args;
        args.append(error);
        callArrayBufferSinkMethod(globalObject, sink, "close"_s, args);
        return;
    }
    case DirectSinkKind::Text:
        if (!controller->m_calledDone)
            endTextSink(globalObject, controller);
        return;
    case DirectSinkKind::Array:
        if (!controller->m_calledDone)
            endArraySink(globalObject, controller);
        return;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// The Bun-only `underlyingSource.close(reason)` lifecycle callback; the call is swallowed.
static void callUnderlyingSourceClose(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* underlyingSource = controller->m_underlyingSource.get();
    if (!underlyingSource)
        return;
    JSValue closeFunction = underlyingSource->get(globalObject, Identifier::fromString(vm, "close"_s));
    RETURN_IF_EXCEPTION(scope, );
    auto callData = JSC::getCallData(closeFunction);
    if (callData.type == CallData::Type::None)
        return;
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    MarkedArgumentBuffer args;
    args.append(reason);
    JSC::call(globalObject, closeFunction, callData, underlyingSource, args);
    if (catchScope.exception()) [[unlikely]] {
        if (takeAbruptCompletion(globalObject, catchScope).isEmpty())
            return;
    }
}

void JSDirectStreamController::handleError(JSGlobalObject* globalObject, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_closed) {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        closeDirectSinkForError(globalObject, this, error);
        if (catchScope.exception()) [[unlikely]] {
            if (takeAbruptCompletion(globalObject, catchScope).isEmpty())
                return;
        }
    }
    m_closed = true;

    callUnderlyingSourceClose(globalObject, this, error);
    RETURN_IF_EXCEPTION(scope, );

    if (auto* pendingRead = m_pendingRead.get()) {
        m_pendingRead.clear();
        rejectPromise(globalObject, pendingRead, error);
        RETURN_IF_EXCEPTION(scope, );
    }

    auto* stream = m_stream.get();
    if (stream && stream->m_state == ReadableStreamState::Readable)
        RELEASE_AND_RETURN(scope, readableStreamError(globalObject, stream, error));
}

JSValue JSDirectStreamController::onPull(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // The one-shot final chunk armed by onClose: deliver it, then close.
    if (m_finalChunkArmed) {
        m_finalChunkArmed = false;
        JSValue chunk = m_finalChunk.get();
        m_finalChunk.clear();
        JSObject* result = createIteratorResultObject(globalObject, chunk, false);
        RETURN_IF_EXCEPTION(scope, {});
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        promise->fulfill(vm, result);
        RETURN_IF_EXCEPTION(scope, {});
        if (auto* stream = m_stream.get()) {
            readableStreamCloseIfPossible(globalObject, stream);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return promise;
    }

    auto* stream = m_stream.get();
    if (!stream || stream->m_state != ReadableStreamState::Readable || m_closed)
        return jsUndefined();
    // Re-entrant pull while a pull is already running.
    if (m_deferClose == -1)
        return jsUndefined();

    m_deferClose = -1;
    m_deferFlush = -1;

    JSValue abrupt;
    bool threw = false;
    {
        DirectPullAsyncContextScope asyncContextScope(globalObject, stream);
        JSObject* underlyingSource = m_underlyingSource.get();
        JSValue result;
        {
            auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            // Unlike the spec, pull may be called many times; backpressure is the destination's job.
            JSValue pullFunction = underlyingSource->get(globalObject, Identifier::fromString(vm, "pull"_s));
            if (!catchScope.exception()) [[likely]] {
                MarkedArgumentBuffer args;
                args.append(this);
                result = JSC::call(globalObject, pullFunction, underlyingSource, args, "underlyingSource.pull is not a function"_s);
            }
            if (catchScope.exception()) [[unlikely]] {
                threw = true;
                abrupt = takeAbruptCompletion(globalObject, catchScope);
            }
        }
        if (threw) {
            // A synchronous throw from pull errors the stream and rejects the returned read.
            if (abrupt)
                handleError(globalObject, abrupt);
        } else if (auto* pullPromise = dynamicDowncast<JSPromise>(result)) {
            // The un-handled result promise is load-bearing: a rejected pull must still unhandledReject.
            auto* runtime = JSStreamsRuntime::from(globalObject);
            auto* rejectionResult = JSPromise::create(vm, globalObject->promiseStructure());
            pullPromise->performPromiseThenWithContext(vm, globalObject, jsUndefined(), runtime->onDirectPullRejected(), rejectionResult, this);
        }
    }

    int8_t deferredClose = m_deferClose;
    int8_t deferredFlush = m_deferFlush;
    m_deferClose = 0;
    m_deferFlush = 0;

    if (threw && abrupt) {
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, abrupt));
    }
    // A VM termination from the pull, or a failure while registering the rejection reaction.
    RETURN_IF_EXCEPTION(scope, {});

    // controller.error() inside pull is not deferred: re-validate before adding a read request.
    stream = m_stream.get();
    if (!stream || stream->m_state != ReadableStreamState::Readable) {
        if (auto* pendingRead = m_pendingRead.get())
            return pendingRead;
        if (stream && stream->m_state == ReadableStreamState::Errored)
            RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, stream->m_storedError.get()));
        JSObject* doneResult = createIteratorResultObject(globalObject, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, {});
        auto* doneP = JSPromise::create(vm, globalObject->promiseStructure());
        doneP->fulfill(vm, doneResult);
        return doneP;
    }

    JSPromise* promiseToReturn = nullptr;
    if (!m_pendingRead) {
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        m_pendingRead.set(vm, this, promise);
        promiseToReturn = promise;
    } else {
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        auto* runtime = JSStreamsRuntime::from(globalObject);
        auto* readRequest = JSReadRequest::create(vm, runtime->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::Promise, promise);
        readableStreamAddReadRequest(vm, stream, readRequest);
        promiseToReturn = promise;
    }

    if (deferredClose == 1) {
        JSValue reason = m_deferCloseReason.get();
        m_deferCloseReason.clear();
        onClose(globalObject, reason);
        RETURN_IF_EXCEPTION(scope, {});
        return promiseToReturn;
    }
    if (deferredFlush == 1) {
        onFlush(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return promiseToReturn;
}

// The pump's head-of-line promise (m_pendingRead) is the active consumer only while no
// non-promise read request (pipeTo / tee / for-await) is queued ahead of it: those are
// registered in [[readRequests]] BEFORE the pull runs and must get chunks via chunkSteps.
static bool headOfLinePromiseIsActiveConsumer(JSReadableStreamDefaultReader* reader)
{
    Locker locker { reader->cellLock() };
    if (reader->m_readRequests.isEmpty())
        return true;
    return reader->m_readRequests.first().get()->kind() == ReadRequestKind::Promise;
}

void JSDirectStreamController::onClose(JSGlobalObject* globalObject, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* stream = m_stream.get();
    if (!stream || stream->m_state != ReadableStreamState::Readable)
        return;
    if (m_deferClose != 0) {
        m_deferClose = 1;
        m_deferCloseReason.set(vm, this, reason);
        return;
    }
    if (m_closed || (m_sinkKind == DirectSinkKind::ArrayBuffer && !m_arrayBufferSink))
        return;
    // No "Closing" stream state exists: m_closed set here is what blocks re-entry.
    m_closed = true;

    callUnderlyingSourceClose(globalObject, this, reason);
    RETURN_IF_EXCEPTION(scope, );

    JSValue flushed;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        flushed = endDirectSink(globalObject, this);
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
            if (!thrown)
                return;
            if (auto* pendingRead = m_pendingRead.get()) {
                m_pendingRead.clear();
                rejectPromise(globalObject, pendingRead, thrown);
                return;
            }
            throwException(globalObject, scope, thrown);
            return;
        }
    }

    size_t flushedByteLength = byteLengthOf(flushed);
    if (readableStreamHasDefaultReader(stream)) {
        auto* reader = static_cast<JSReadableStreamDefaultReader*>(stream->m_reader.get());
        auto* pendingRead = m_pendingRead.get();
        // Skipped when a non-promise read request is at the head: it is delivered below.
        if (pendingRead && flushedByteLength && headOfLinePromiseIsActiveConsumer(reader)) {
            m_pendingRead.clear();
            JSObject* result = createIteratorResultObject(globalObject, flushed, false);
            RETURN_IF_EXCEPTION(scope, );
            pendingRead->fulfill(vm, result);
            RETURN_IF_EXCEPTION(scope, );
            RELEASE_AND_RETURN(scope, readableStreamCloseIfPossible(globalObject, stream));
        }
    }

    if (flushedByteLength) {
        if (readableStreamGetNumReadRequests(stream) > 0) {
            readableStreamFulfillReadRequest(globalObject, stream, flushed, false);
            RETURN_IF_EXCEPTION(scope, );
            RELEASE_AND_RETURN(scope, readableStreamCloseIfPossible(globalObject, stream));
        }
        // Nobody is reading: the NEXT read() delivers this chunk, then closes.
        m_finalChunk.set(vm, this, flushed);
        m_finalChunkArmed = true;
        return;
    }

    if (auto* pendingRead = m_pendingRead.get()) {
        m_pendingRead.clear();
        JSObject* doneResult = createIteratorResultObject(globalObject, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, );
        pendingRead->fulfill(vm, doneResult);
        RETURN_IF_EXCEPTION(scope, );
    }
    RELEASE_AND_RETURN(scope, readableStreamCloseIfPossible(globalObject, stream));
}

void JSDirectStreamController::onFlush(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* stream = m_stream.get();
    if (!stream)
        return;
    if (m_closed || (m_sinkKind == DirectSinkKind::ArrayBuffer && !m_arrayBufferSink))
        return;
    // No default reader: return WITHOUT deferring.
    auto* reader = dynamicDowncast<JSReadableStreamDefaultReader>(stream->m_reader.get());
    if (!reader)
        return;

    if (auto* pendingRead = m_pendingRead.get()) {
        m_pendingRead.clear();
        JSValue flushed = flushDirectSink(globalObject, this);
        RETURN_IF_EXCEPTION(scope, );
        if (byteLengthOf(flushed)) {
            // A non-promise read request at the head is the active consumer: deliver the
            // chunk through its own chunkSteps and leave the head-of-line promise pending
            // (its registrar drops it).
            if (!headOfLinePromiseIsActiveConsumer(reader)) {
                m_pendingRead.set(vm, this, pendingRead);
                RELEASE_AND_RETURN(scope, readableStreamFulfillReadRequest(globalObject, stream, flushed, false));
            }
            {
                Locker locker { reader->cellLock() };
                if (!reader->m_readRequests.isEmpty()) {
                    auto nextRequest = reader->m_readRequests.takeFirst();
                    auto* readRequest = nextRequest.get();
                    if (readRequest && readRequest->kind() == ReadRequestKind::Promise)
                        m_pendingRead.set(vm, this, uncheckedDowncast<JSPromise>(readRequest->m_context.get()));
                }
            }
            JSObject* result = createIteratorResultObject(globalObject, flushed, false);
            RETURN_IF_EXCEPTION(scope, );
            RELEASE_AND_RETURN(scope, pendingRead->fulfill(vm, result));
        }
        m_pendingRead.set(vm, this, pendingRead);
        return;
    }

    if (readableStreamGetNumReadRequests(stream) > 0) {
        JSValue flushed = flushDirectSink(globalObject, this);
        RETURN_IF_EXCEPTION(scope, );
        if (byteLengthOf(flushed))
            RELEASE_AND_RETURN(scope, readableStreamFulfillReadRequest(globalObject, stream, flushed, false));
        return;
    }

    if (m_deferFlush == -1)
        m_deferFlush = 1;
}

// The rejection reaction of the user pull()'s returned promise ([reaction-convention]).
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDirectPullRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    JSValue error = callFrame->argument(0);
    controller->handleError(globalObject, error);
    RETURN_IF_EXCEPTION(scope, {});
    // Re-throw so the (deliberately un-handled) result promise rejects with the pull error.
    throwException(globalObject, scope, error);
    return {};
}

// The FIVE public own methods are JSBoundFunctions over these [bound-convention] targets.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectWrite, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    if (controller->m_closed)
        return throwVMTypeError(globalObject, scope, directControllerClosedMessage);
    RELEASE_AND_RETURN(scope, JSValue::encode(writeToDirectSink(globalObject, controller, callFrame->argument(1))));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    if (controller->m_closed)
        return throwVMTypeError(globalObject, scope, directControllerClosedMessage);
    controller->onClose(globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectFlush, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    if (controller->m_closed)
        return throwVMTypeError(globalObject, scope, directControllerClosedMessage);
    controller->onFlush(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectError, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    if (controller->m_closed)
        return throwVMTypeError(globalObject, scope, directControllerClosedMessage);
    controller->handleError(globalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// Installs write/end/close/flush/error as detachable OWN JSBoundFunction properties.
static void installDirectControllerMethods(JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    struct Method {
        ASCIILiteral name;
        JSFunction* target;
        double length;
    };
    const Method methods[] = {
        { "write"_s, runtime->boundDirectWrite(), 1 },
        { "end"_s, runtime->boundDirectClose(), 0 },
        { "close"_s, runtime->boundDirectClose(), 1 },
        { "flush"_s, runtime->boundDirectFlush(), 0 },
        { "error"_s, runtime->boundDirectError(), 1 },
    };
    for (const auto& method : methods) {
        MarkedArgumentBuffer boundArgs;
        boundArgs.append(controller);
        String name(method.name);
        auto* boundFunction = JSBoundFunction::create(vm, globalObject, method.target, jsUndefined(), ArgList(boundArgs), method.length, jsString(vm, name), makeSource(name, SourceOrigin(), SourceTaintedOrigin::Untainted));
        RETURN_IF_EXCEPTION(scope, );
        controller->putDirect(vm, Identifier::fromString(vm, method.name), boundFunction, 0);
    }
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSDirectStreamController;
using WebCore::JSStreamsRuntime;

void setUpDirectStreamController(JSC::JSGlobalObject* globalObject, JSReadableStream* stream, DirectSinkKind sinkKind, double highWaterMark)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* controller = JSDirectStreamController::create(vm, runtime->directStreamControllerStructure(zigGlobalObject), sinkKind);
    controller->m_stream.set(vm, controller, stream);
    if (JSObject* underlyingSource = stream->m_directUnderlyingSource.get())
        controller->m_underlyingSource.set(vm, controller, underlyingSource);

    switch (sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSObject* sinkConstructor = zigGlobalObject->ArrayBufferSink();
        auto constructData = JSC::getConstructData(sinkConstructor);
        MarkedArgumentBuffer constructArgs;
        JSObject* sink = JSC::construct(globalObject, sinkConstructor, constructData, constructArgs);
        RETURN_IF_EXCEPTION(scope, );
        controller->m_arrayBufferSink.set(vm, controller, sink);
        JSObject* options = constructEmptyObject(globalObject);
        // Forwarded iff the raw strategy highWaterMark is a non-zero, non-NaN number.
        if (stream->m_bunHighWaterMarkIsNumber && highWaterMark != 0 && !std::isnan(highWaterMark))
            options->putDirect(vm, Identifier::fromString(vm, "highWaterMark"_s), jsNumber(highWaterMark), 0);
        options->putDirect(vm, Identifier::fromString(vm, "stream"_s), jsBoolean(true), 0);
        options->putDirect(vm, Identifier::fromString(vm, "asUint8Array"_s), jsBoolean(true), 0);
        MarkedArgumentBuffer startArgs;
        startArgs.append(options);
        WebCore::callArrayBufferSinkMethod(globalObject, sink, "start"_s, startArgs);
        RETURN_IF_EXCEPTION(scope, );
        break;
    }
    case DirectSinkKind::Text: {
        controller->m_closingPromise.set(vm, controller, JSPromise::create(vm, globalObject->promiseStructure()));
        break;
    }
    case DirectSinkKind::Array: {
        JSArray* array = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, );
        controller->m_array.set(vm, controller, array);
        controller->m_closingPromise.set(vm, controller, JSPromise::create(vm, globalObject->promiseStructure()));
        break;
    }
    }

    WebCore::installDirectControllerMethods(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, );

    stream->m_controller.set(vm, stream, controller);
    stream->m_controllerKind = ControllerKind::Direct;
    stream->m_directUnderlyingSource.clear();
    stream->m_bunMode = BunStreamMode::Default;
}

} // namespace WebStreams
} // namespace Bun
