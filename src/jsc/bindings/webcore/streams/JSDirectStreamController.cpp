#include "config.h"
#include "JSDirectStreamController.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "helpers.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSReadRequest.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
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

// Deliver buffered data to a waiting reader at the end of this tick via the runtime's
// deferred-task service (JSStreamsRuntime.cpp); a no-op there if the data was already taken.
// A write made inside pull() runs before the read that triggered it is recorded, so arming
// does not require a waiting consumer.
void JSDirectStreamController::armEndOfTickFlush(JSGlobalObject* globalObject)
{
    if (m_endOfTickFlushArmed || m_closed || !m_stream)
        return;
    JSStreamsRuntime::from(globalObject)->armEndOfTickFlush(globalObject, this);
    m_endOfTickFlushArmed = true;
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
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_underlyingSource);
    visitor.appendHidden(thisObject->m_pull);
    visitor.appendHidden(thisObject->m_pendingRead);
    visitor.appendHidden(thisObject->m_deferCloseReason);
    visitor.appendHidden(thisObject->m_arrayBufferSink);
    visitor.appendHidden(thisObject->m_array);
    visitor.appendHidden(thisObject->m_closingPromise);
    visitor.appendHidden(thisObject->m_finalChunk);
    Locker locker { thisObject->cellLock() };
    thisObject->m_textAccumulator.visit(locker, visitor);
}

void JSDirectStreamController::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSDirectStreamController>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_underlyingSource, "underlyingSource"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pull, "pull"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pendingRead, "pendingRead"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_deferCloseReason, "deferCloseReason"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_arrayBufferSink, "arrayBufferSink"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_array, "array"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closingPromise, "closingPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_finalChunk, "finalChunk"_s);
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_textAccumulator.analyzeHeap(locker, cell, analyzer);
}

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

static JSValue callArrayBufferSinkMethod(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* sink, const Identifier& name, MarkedArgumentBuffer& args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue function = sink->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, function, sink, args, "ArrayBufferSink method is not a function"_s));
}

static JSValue writeToArrayBufferSink(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    JSObject* sink = controller->m_arrayBufferSink.get();
    if (!sink) [[unlikely]]
        return jsUndefined();
    MarkedArgumentBuffer args;
    args.append(chunk);
    return callArrayBufferSinkMethod(vm, globalObject, sink, builtinNames(vm).writePublicName(), args);
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
            if (accumulator.rope.hasOverflowed()) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            accumulator.hasString = true;
            accumulator.estimatedLength += length;
        }
        return jsNumber(length);
    }

    size_t byteLength = 0;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk))
        byteLength = view->isDetached() ? 0 : view->byteLength();
    else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(chunk)) {
        auto* impl = buffer->impl();
        byteLength = (!impl || impl->isDetached()) ? 0 : impl->byteLength();
    } else {
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

static String finishTextSink(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto& accumulator = controller->m_textAccumulator;
    const bool hasString = accumulator.hasString;
    const bool hasBuffer = accumulator.hasBuffer;
    if (!hasString && !hasBuffer)
        return emptyString();

    auto scope = DECLARE_THROW_SCOPE(vm);
    // Pure-string rope: the ONLY arm of the direct Text sink that strips a leading BOM.
    if (hasString && !hasBuffer) {
        if (Bun::WebStreams::exceedsStringLimit(accumulator.rope.length())) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return String();
        }
        String rope = accumulator.rope.toString();
        if (rope.length() && rope[0] == 0xFEFF)
            return rope.substring(1);
        return rope;
    }

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
            auto* impl = buffer->impl();
            if (impl && !impl->isDetached())
                bytes.append(impl->span());
        }
    }
    if (!accumulator.rope.isEmpty()) {
        String rope = accumulator.rope.toString();
        if (rope[0] == 0xFEFF)
            rope = rope.substring(1);
        auto utf8 = rope.utf8();
        bytes.append(std::span { reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length() });
    }
    if (Bun::WebStreams::exceedsStringLimit(bytes.size())) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return String();
    }
    return String::fromUTF8ReplacingInvalidSequences(bytes.span());
}

static JSValue endTextSink(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (controller->m_calledDone)
        return jsEmptyString(vm);
    controller->m_calledDone = true;
    String result = finishTextSink(vm, globalObject, controller);
    // The accumulated payload must not stay alive on the controller (it lives as long
    // as the stream); the result string owns everything it needs.
    {
        Locker locker { controller->cellLock() };
        controller->m_textAccumulator.reset(locker);
    }
    RETURN_IF_EXCEPTION(scope, {});
    JSString* resultString = jsString(vm, result);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* closingPromise = controller->m_closingPromise.get())
        closingPromise->fulfill(vm, resultString);
    return resultString;
}

static JSValue endArraySink(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (controller->m_calledDone) [[unlikely]] {
        JSArray* empty = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        return empty;
    }
    controller->m_calledDone = true;
    JSArray* array = controller->m_array.get();
    // The array is the caller's result now; the controller must not keep it alive.
    controller->m_array.clear();
    if (auto* closingPromise = controller->m_closingPromise.get()) {
        resolvePromise(globalObject, closingPromise, array);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return array;
}

// `sink.end()`. May throw; the ArrayBufferSink slot is only cleared on success.
static JSValue endDirectSink(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSObject* sink = controller->m_arrayBufferSink.get();
        if (!sink) [[unlikely]]
            return jsUndefined();
        MarkedArgumentBuffer args;
        JSValue flushed = callArrayBufferSinkMethod(vm, globalObject, sink, builtinNames(vm).endPublicName(), args);
        RETURN_IF_EXCEPTION(scope, {});
        controller->m_arrayBufferSink.clear();
        return flushed;
    }
    case DirectSinkKind::Text:
        RELEASE_AND_RETURN(scope, endTextSink(vm, globalObject, controller));
    case DirectSinkKind::Array:
        RELEASE_AND_RETURN(scope, endArraySink(vm, globalObject, controller));
    }
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

// `sink.flush()`: only the ArrayBuffer sink produces bytes; the Text/Array sinks return 0.
static JSValue flushDirectSink(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSObject* sink = controller->m_arrayBufferSink.get();
        if (!sink) [[unlikely]]
            return jsNumber(0);
        MarkedArgumentBuffer args;
        return callArrayBufferSinkMethod(vm, globalObject, sink, builtinNames(vm).flushPublicName(), args);
    }
    case DirectSinkKind::Text:
    case DirectSinkKind::Array:
        return jsNumber(0);
    }
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

// `sink.close(error)`: the Text/Array sinks fulfill their closing promise with the partial result.
static void closeDirectSinkForError(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue error)
{
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSObject* sink = controller->m_arrayBufferSink.get();
        if (!sink)
            return;
        controller->m_arrayBufferSink.clear();
        MarkedArgumentBuffer args;
        args.append(error);
        callArrayBufferSinkMethod(vm, globalObject, sink, builtinNames(vm).closePublicName(), args);
        return;
    }
    case DirectSinkKind::Text:
        if (!controller->m_calledDone)
            endTextSink(vm, globalObject, controller);
        return;
    case DirectSinkKind::Array:
        if (!controller->m_calledDone)
            endArraySink(vm, globalObject, controller);
        return;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// The Bun-only `underlyingSource.close(reason)` lifecycle callback; the call is swallowed.
static void callUnderlyingSourceClose(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* underlyingSource = controller->m_underlyingSource.get();
    if (!underlyingSource)
        return;
    JSValue closeFunction = underlyingSource->get(globalObject, builtinNames(vm).closePublicName());
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

    const bool wasClosed = m_closed;
    if (!wasClosed) {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        closeDirectSinkForError(vm, globalObject, this, error);
        if (catchScope.exception()) [[unlikely]] {
            if (takeAbruptCompletion(globalObject, catchScope).isEmpty())
                return;
        }
    }
    m_closed = true;

    // onClose() already ran the user's close() if the sink was closed (end() arming the
    // final chunk leaves the stream Readable), so running it again would double it.
    if (!wasClosed) {
        callUnderlyingSourceClose(vm, globalObject, this, error);
        RETURN_IF_EXCEPTION(scope, );
    }

    if (auto* pendingRead = m_pendingRead.get()) {
        m_pendingRead.clear();
        rejectPromise(globalObject, pendingRead, error);
        RETURN_IF_EXCEPTION(scope, );
    }

    auto* stream = m_stream.get();
    if (stream && stream->m_state == ReadableStreamState::Readable)
        RELEASE_AND_RETURN(scope, readableStreamError(globalObject, stream, error));
}

// Invokes the user's pull() once, bracketed by m_pullInFlight (the spec sets [[pulling]]
// before invoking pullAlgorithm); left set only when a promise's settlement reaction will
// clear it. Returns the synchronous abrupt completion (empty on normal return/termination).
static JSValue callDirectPull(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    StreamAsyncContextScope asyncContextScope(globalObject, controller->m_stream.get());
    JSObject* pullFunction = controller->m_pull.get();
    JSObject* underlyingSource = controller->m_underlyingSource.get();
    controller->m_pullInFlight = true;
    JSValue result;
    JSValue abrupt;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        MarkedArgumentBuffer args;
        args.append(controller);
        result = JSC::call(globalObject, pullFunction ? JSValue(pullFunction) : jsUndefined(), underlyingSource, args, "underlyingSource.pull is not a function"_s);
        if (catchScope.exception()) [[unlikely]]
            abrupt = takeAbruptCompletion(globalObject, catchScope);
    }
    if (!abrupt.isEmpty()) {
        controller->m_pullInFlight = false;
        return abrupt;
    }
    if (auto* pullPromise = dynamicDowncast<JSPromise>(result)) {
        auto* runtime = JSStreamsRuntime::from(globalObject);
        pullPromise->performPromiseThenWithContext(vm, globalObject, runtime->onDirectPullFulfilled(), runtime->onDirectPullRejected(), jsUndefined(), controller);
        if (scope.exception()) [[unlikely]]
            controller->m_pullInFlight = false;
    } else {
        controller->m_pullInFlight = false;
    }
    return {};
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
        auto* stream = m_stream.get();
        // Non-Promise readers (for-await/tee/pipeTo) queue the request BEFORE this call and
        // drop the returned promise; deliver through chunkSteps instead of a wrapped promise.
        if (stream && readableStreamHasDefaultReader(stream) && readableStreamGetNumReadRequests(stream) > 0) {
            readableStreamFulfillReadRequest(globalObject, stream, chunk, false);
            RETURN_IF_EXCEPTION(scope, {});
            readableStreamCloseIfPossible(globalObject, stream);
            RETURN_IF_EXCEPTION(scope, {});
            return jsUndefined();
        }
        JSObject* result = createIteratorResultObject(globalObject, chunk, false);
        RETURN_IF_EXCEPTION(scope, {});
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        promise->fulfill(vm, result);
        RETURN_IF_EXCEPTION(scope, {});
        if (stream) {
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

    int8_t deferredClose = 0;
    int8_t deferredFlush = 0;

    // Serialize pull(): while an async pull's promise is pending, subsequent reads install
    // m_pendingRead for it to deliver into via flush()/end(); its fulfillment reaction
    // clears m_pullInFlight and re-pulls if a consumer is still waiting.
    if (!m_pullInFlight) {
        m_deferClose = -1;
        m_deferFlush = -1;

        JSValue abrupt = callDirectPull(vm, globalObject, this);

        deferredClose = m_deferClose;
        deferredFlush = m_deferFlush;
        m_deferClose = 0;
        m_deferFlush = 0;

        if (!abrupt.isEmpty()) {
            // A synchronous throw from pull errors the stream and rejects the returned read.
            handleError(globalObject, abrupt);
            RETURN_IF_EXCEPTION(scope, {});
            RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, abrupt));
        }
        // A VM termination from the pull, or a failure while registering the reaction.
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        // A new read arrived while an async pull is pending: the fulfillment reaction will
        // re-pull. Drain anything that pull already wrote; onFlush is a no-op-restore on an
        // empty sink.
        m_pullAgain = true;
        deferredFlush = 1;
    }

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

    callUnderlyingSourceClose(vm, globalObject, this, reason);
    RETURN_IF_EXCEPTION(scope, );

    JSValue flushed;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        flushed = endDirectSink(vm, globalObject, this);
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
        // The reader can have been released while the (async) pull was still running.
        if (readableStreamHasDefaultReader(stream) && readableStreamGetNumReadRequests(stream) > 0) {
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
        JSValue flushed = flushDirectSink(vm, globalObject, this);
        RETURN_IF_EXCEPTION(scope, );
        if (byteLengthOf(flushed)) {
            // A non-promise read request at the head is the active consumer: deliver the
            // chunk through its own chunkSteps and leave the head-of-line promise pending
            // (its registrar drops it).
            if (!headOfLinePromiseIsActiveConsumer(reader)) {
                m_pendingRead.set(vm, this, pendingRead);
                // The spec's enqueue → CallPullIfNeeded equivalent: re-arm when this delivery
                // still leaves a consumer queued behind the in-flight pull.
                if (m_pullInFlight && readableStreamGetNumReadRequests(stream) > 1)
                    m_pullAgain = true;
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
            if (m_pullInFlight && (m_pendingRead || readableStreamGetNumReadRequests(stream) > 0))
                m_pullAgain = true;
            JSObject* result = createIteratorResultObject(globalObject, flushed, false);
            RETURN_IF_EXCEPTION(scope, );
            RELEASE_AND_RETURN(scope, pendingRead->fulfill(vm, result));
        }
        m_pendingRead.set(vm, this, pendingRead);
        return;
    }

    if (readableStreamGetNumReadRequests(stream) > 0) {
        JSValue flushed = flushDirectSink(vm, globalObject, this);
        RETURN_IF_EXCEPTION(scope, );
        if (byteLengthOf(flushed)) {
            if (m_pullInFlight && readableStreamGetNumReadRequests(stream) > 1)
                m_pullAgain = true;
            RELEASE_AND_RETURN(scope, readableStreamFulfillReadRequest(globalObject, stream, flushed, false));
        }
        return;
    }

    if (m_deferFlush == -1)
        m_deferFlush = 1;
}

static bool takeDirectPullAgain(JSDirectStreamController* controller)
{
    bool pullAgain = controller->m_pullAgain;
    controller->m_pullAgain = false;
    return pullAgain;
}

static bool directControllerHasWaitingConsumer(JSDirectStreamController* controller, JSReadableStream* stream)
{
    return controller->m_pendingRead || (stream && readableStreamGetNumReadRequests(stream) > 0);
}

// Settlement reactions of the user pull()'s returned promise ([reaction-convention]).
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDirectPullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto* stream = controller->m_stream.get();
    if (controller->m_closed || !stream || stream->m_state != ReadableStreamState::Readable) {
        controller->m_pullInFlight = false;
        controller->m_pullAgain = false;
        return JSValue::encode(jsUndefined());
    }
    // Drain anything this pull wrote while no reader was waiting. m_pullInFlight stays set
    // so onFlush's delivery-branch re-arm fires for a pull that wrote without c.flush().
    controller->onFlush(globalObject);
    controller->m_pullInFlight = false;
    RETURN_IF_EXCEPTION(scope, {});
    bool pullAgain = takeDirectPullAgain(controller);
    // Edge-triggered (m_pullAgain) AND level-checked (a consumer is waiting), the spec's
    // ShouldCallPull equivalent; loop so a synchronous re-pull chains to the next consumer.
    while (pullAgain && !controller->m_closed && !controller->m_pullInFlight
        && directControllerHasWaitingConsumer(controller, controller->m_stream.get())) {
        controller->m_deferClose = -1;
        controller->m_deferFlush = -1;
        JSValue abrupt = callDirectPull(vm, globalObject, controller);
        int8_t deferredClose = controller->m_deferClose;
        int8_t deferredFlush = controller->m_deferFlush;
        controller->m_deferClose = 0;
        controller->m_deferFlush = 0;
        if (!abrupt.isEmpty()) {
            controller->handleError(globalObject, abrupt);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(jsUndefined());
        }
        RETURN_IF_EXCEPTION(scope, {});
        if (deferredClose == 1) {
            JSValue reason = controller->m_deferCloseReason.get();
            controller->m_deferCloseReason.clear();
            controller->onClose(globalObject, reason);
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            // An async re-pull left m_pullInFlight set: its own fulfillment reaction drains
            // and picks up m_pullAgain.
            if (controller->m_pullInFlight) {
                if (deferredFlush == 1)
                    controller->onFlush(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                break;
            }
            // Sync re-pull: drain with m_pullInFlight bracketed so onFlush's delivery-branch
            // re-arm fires regardless of whether the pull called c.flush() itself.
            controller->m_pullInFlight = true;
            controller->onFlush(globalObject);
            controller->m_pullInFlight = false;
            RETURN_IF_EXCEPTION(scope, {});
        }
        pullAgain = takeDirectPullAgain(controller);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDirectPullRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    controller->m_pullInFlight = false;
    JSValue error = callFrame->argument(0);
    controller->handleError(globalObject, error);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
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
    JSValue wrote = writeToDirectSink(globalObject, controller, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    controller->armEndOfTickFlush(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(wrote);
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
static void installDirectControllerMethods(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto& names = builtinNames(vm);
    struct Method {
        const Identifier& key;
        JSFunction* target;
        double length;
    };
    const Method methods[] = {
        { names.writePublicName(), runtime->boundDirectWrite(), 1 },
        { names.endPublicName(), runtime->boundDirectClose(), 0 },
        { names.closePublicName(), runtime->boundDirectClose(), 1 },
        { names.flushPublicName(), runtime->boundDirectFlush(), 0 },
        { vm.propertyNames->error, runtime->boundDirectError(), 1 },
    };
    for (const auto& method : methods) {
        MarkedArgumentBuffer boundArgs;
        boundArgs.append(controller);
        String name = method.key.string();
        auto* boundFunction = JSBoundFunction::create(vm, globalObject, method.target, jsUndefined(), ArgList(boundArgs), method.length, jsString(vm, name), makeSource(name, SourceOrigin(), SourceTaintedOrigin::Untainted));
        RETURN_IF_EXCEPTION(scope, );
        controller->putDirect(vm, method.key, boundFunction, 0);
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
    if (JSObject* underlyingSource = stream->m_directUnderlyingSource.get()) {
        controller->m_underlyingSource.set(vm, controller, underlyingSource);
        JSValue pull = underlyingSource->get(globalObject, builtinNames(vm).pullPublicName());
        RETURN_IF_EXCEPTION(scope, );
        if (auto* pullObject = pull.getObject())
            controller->m_pull.set(vm, controller, pullObject);
    }

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
            options->putDirect(vm, builtinNames(vm).highWaterMarkPublicName(), jsNumber(highWaterMark), 0);
        options->putDirect(vm, builtinNames(vm).streamPublicName(), jsBoolean(true), 0);
        options->putDirect(vm, builtinNames(vm).asUint8ArrayPublicName(), jsBoolean(true), 0);
        MarkedArgumentBuffer startArgs;
        startArgs.append(options);
        WebCore::callArrayBufferSinkMethod(vm, globalObject, sink, builtinNames(vm).startPublicName(), startArgs);
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

    WebCore::installDirectControllerMethods(vm, globalObject, controller);
    RETURN_IF_EXCEPTION(scope, );

    stream->m_controller.set(vm, stream, controller);
    stream->m_controllerKind = ControllerKind::Direct;
    stream->m_directUnderlyingSource.clear();
    stream->m_bunMode = BunStreamMode::Default;
}

} // namespace WebStreams
} // namespace Bun
