#include "config.h"
#include "JSReadableStreamDefaultReader.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMBinding.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSDirectStreamController.h"
#include "JSReadRequest.h"
#include "JSReadableByteStreamController.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultController.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/Locker.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSStreamsRuntime;

// The only cast of the erased stream->m_controller slot in this file; every switch is TOTAL.
static WebCore::JSReadableStreamDefaultController* defaultControllerOf(JSReadableStream* stream)
{
    ASSERT(stream->m_controllerKind == ControllerKind::Default);
    return uncheckedDowncast<WebCore::JSReadableStreamDefaultController>(stream->m_controller.get());
}

static WebCore::JSReadableByteStreamController* byteControllerOf(JSReadableStream* stream)
{
    ASSERT(stream->m_controllerKind == ControllerKind::Byte);
    return uncheckedDowncast<WebCore::JSReadableByteStreamController>(stream->m_controller.get());
}

// Detaches [[readRequests]] before dispatch ("set to an empty list, then iterate"): once the
// requests leave the visited deque the MarkedArgumentBuffer is their only root.
static void detachReadRequests(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader, MarkedArgumentBuffer& out)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    {
        WTF::Locker locker { reader->cellLock() };
        for (auto& request : reader->m_readRequests)
            out.append(request.get());
        reader->m_readRequests.clear();
    }
    if (out.hasOverflowed()) [[unlikely]]
        throwOutOfMemoryError(globalObject, scope);
}

// ReadableStreamDefaultReaderErrorReadRequests(reader, e)
void readableStreamDefaultReaderErrorReadRequests(JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer readRequests;
    detachReadRequests(vm, globalObject, reader, readRequests);
    RETURN_IF_EXCEPTION(scope, void());
    for (size_t i = 0, count = readRequests.size(); i < count; ++i) {
        uncheckedDowncast<WebCore::JSReadRequest>(readRequests.at(i))->errorSteps(globalObject, error);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

// ReadableStreamDefaultReaderRead(reader, readRequest)
// A read on a readable, default-controller stream with a queued chunk and no pending read
// requests needs no JSReadRequest: dequeue synchronously. Returns an empty JSValue when the
// fast path does not apply (or on exception; callers RETURN_IF_EXCEPTION).
JSValue readableStreamDefaultReaderTryReadFromQueue(JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* stream = reader->m_stream.get();
    if (!stream || stream->m_state != ReadableStreamState::Readable || stream->m_controllerKind != ControllerKind::Default || !reader->m_readRequests.isEmpty())
        return {};
    auto* controller = uncheckedDowncast<WebCore::JSReadableStreamDefaultController>(stream->m_controller.get());
    if (controller->m_queue.isEmpty())
        return {};
    stream->m_disturbed = true;
    RELEASE_AND_RETURN(scope, controller->dequeueChunkForRead(globalObject));
}

void readableStreamDefaultReaderRead(JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader, WebCore::JSReadRequest* readRequest)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = reader->m_stream.get();
    ASSERT(stream);
    stream->m_disturbed = true;
    const ReadableStreamState state = stream->m_state;
    if (state == ReadableStreamState::Closed)
        RELEASE_AND_RETURN(scope, readRequest->closeSteps(globalObject));
    if (state == ReadableStreamState::Errored) {
        JSValue storedError = stream->m_storedError.get();
        RELEASE_AND_RETURN(scope, readRequest->errorSteps(globalObject, storedError ? storedError : jsUndefined()));
    }

    switch (stream->m_controllerKind) {
    case ControllerKind::Default:
        RELEASE_AND_RETURN(scope, defaultControllerOf(stream)->pullSteps(globalObject, readRequest));
    case ControllerKind::Byte:
        RELEASE_AND_RETURN(scope, byteControllerOf(stream)->pullSteps(globalObject, readRequest));
    case ControllerKind::None:
        // No controller yet (an unmaterialized Bun stream): the read stays pending.
        readableStreamAddReadRequest(vm, stream, readRequest);
        return;
    case ControllerKind::Direct: {
        auto* controller = uncheckedDowncast<WebCore::JSDirectStreamController>(stream->m_controller.get());
        // The direct pump allocates and settles its own head-of-line promise; a
        // promise-backed read adopts it instead of waiting in [[readRequests]].
        if (readRequest->kind() == ReadRequestKind::Promise) {
            auto* readPromise = uncheckedDowncast<JSPromise>(readRequest->m_context.get());
            JSValue pulled = controller->onPull(globalObject);
            RETURN_IF_EXCEPTION(scope, void());
            if (!pulled.isObject()) {
                // The pump refused (already closed / re-entrant pull): report done.
                JSObject* doneResult = createIteratorResultObject(globalObject, jsUndefined(), true);
                RETURN_IF_EXCEPTION(scope, void());
                RELEASE_AND_RETURN(scope, resolvePromise(globalObject, readPromise, doneResult));
            }
            RELEASE_AND_RETURN(scope, resolvePromise(globalObject, readPromise, pulled));
        }
        // Other read-request kinds wait in [[readRequests]]; the pump's unobserved
        // head-of-line promise for this read is dropped so delivery reaches the request.
        readableStreamAddReadRequest(vm, stream, readRequest);
        bool hadPendingRead = !!controller->m_pendingRead;
        JSValue pulled = controller->onPull(globalObject);
        RETURN_IF_EXCEPTION(scope, void());
        if (!hadPendingRead && controller->m_pendingRead && pulled == JSValue(controller->m_pendingRead.get()))
            controller->m_pendingRead.clear();
        return;
    }
    case ControllerKind::NativeSink: {
        // A native-sink-locked stream cannot acquire a default reader.
        ASSERT_NOT_REACHED();
        JSObject* error = Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: This ReadableStream is locked to a native sink"_s);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, readRequest->errorSteps(globalObject, error));
    }
    }
}

// ReadableStreamDefaultReaderRelease(reader)
void readableStreamDefaultReaderRelease(JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    readableStreamReaderGenericRelease(globalObject, reader);
    RETURN_IF_EXCEPTION(scope, void());
    JSObject* error = Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Releasing reader"_s);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, readableStreamDefaultReaderErrorReadRequests(globalObject, reader, error));
}

// The `{value, size, done}` readMany result shape.
static JSObject* createReadManyResult(JSC::VM& vm, JSGlobalObject* globalObject, JSValue value, double size, bool done)
{
    auto* structure = JSStreamsRuntime::from(globalObject)->readManyResultStructure(defaultGlobalObject(globalObject));
    auto* result = constructEmptyObject(vm, structure);
    result->putDirectOffset(vm, 0, value);
    result->putDirectOffset(vm, 1, jsNumber(size));
    result->putDirectOffset(vm, 2, jsBoolean(done));
    return result;
}

// Appends every queued chunk to `into` at `base`, resets the queue, THEN runs the
// close/pull step; returns the PRE-drain [[queueTotalSize]]. Reset must precede the step:
// its user JS may reentrantly enqueue (must survive) or close() (must see an empty queue).
static double drainQueueEntriesInto(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStream* __restrict stream, JSArray* __restrict into, unsigned base)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isByte = stream->m_controllerKind == ControllerKind::Byte;
    ASSERT(isByte || stream->m_controllerKind == ControllerKind::Default);
    auto* defaultController = isByte ? nullptr : defaultControllerOf(stream);
    auto* byteController = isByte ? byteControllerOf(stream) : nullptr;

    double size = isByte ? byteController->m_queue.totalSize() : defaultController->m_queue.totalSize();
    size_t queueLength = isByte ? byteController->m_queue.size() : defaultController->m_queue.size();
    // [[queueTotalSize]] is deliberately NOT decremented while draining (see above).
    for (unsigned i = 0; i < queueLength; ++i) {
        JSValue chunk;
        if (isByte) {
            RefPtr<JSC::ArrayBuffer> buffer;
            size_t byteOffset = 0;
            size_t byteLength = 0;
            {
                WTF::Locker locker { byteController->cellLock() };
                auto& entry = byteController->m_queue.first();
                buffer = WTF::move(entry.buffer);
                byteOffset = entry.byteOffset;
                byteLength = entry.byteLength;
                byteController->m_queue.removeFirst(locker);
            }
            bool resizable = buffer->isResizableOrGrowableShared();
            chunk = JSUint8Array::create(globalObject, globalObject->typedArrayStructure(TypeUint8, resizable), WTF::move(buffer), byteOffset, byteLength);
            RETURN_IF_EXCEPTION(scope, size);
        } else {
            WTF::Locker locker { defaultController->cellLock() };
            auto& entry = defaultController->m_queue.first();
            chunk = entry.value.get();
            defaultController->m_queue.removeFirst(locker);
        }
        into->putDirectIndex(globalObject, base + i, chunk);
        RETURN_IF_EXCEPTION(scope, size);
    }

    if (isByte) {
        WTF::Locker locker { byteController->cellLock() };
        byteController->m_queue.resetQueue(locker);
    } else {
        WTF::Locker locker { defaultController->cellLock() };
        defaultController->m_queue.resetQueue(locker);
    }
    if (stream->m_state != ReadableStreamState::Closed) {
        bool closeRequested = isByte ? byteController->m_closeRequested : defaultController->m_closeRequested;
        // Pull DECISION against the PRE-drain total (readMany cadence: a full batch defers
        // the next pull to the next wake); the queue is already reset, so reentrant enqueues survive.
        double hwm = isByte ? byteController->m_strategyHWM : defaultController->m_strategyHWM;
        if (closeRequested)
            readableStreamCloseIfPossible(globalObject, stream);
        else if (hwm - size > 0) {
            if (isByte)
                readableByteStreamControllerCallPullIfNeeded(globalObject, byteController);
            else
                readableStreamDefaultControllerCallPullIfNeeded(globalObject, defaultController);
        }
        RETURN_IF_EXCEPTION(scope, size);
    }
    return size;
}

static JSValue drainQueueForReadMany(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStream* stream, JSValue headChunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isByte = stream->m_controllerKind == ControllerKind::Byte;
    size_t queueLength = isByte ? byteControllerOf(stream)->m_queue.size() : defaultControllerOf(stream)->m_queue.size();
    unsigned base = headChunk ? 1 : 0;
    auto* values = constructEmptyArray(globalObject, nullptr, base + queueLength);
    RETURN_IF_EXCEPTION(scope, {});
    if (headChunk) {
        values->putDirectIndex(globalObject, 0, headChunk);
        RETURN_IF_EXCEPTION(scope, {});
    }
    double size = drainQueueEntriesInto(vm, globalObject, stream, values, base);
    RETURN_IF_EXCEPTION(scope, {});
    return createReadManyResult(vm, globalObject, values, size, false);
}

// The buffered-consumer pump step: bulk-appends everything queued to `chunks`; when the
// queue is empty and the stream is still readable, issues ONE spec read and hands its
// promise back via `pendingRead`. Throws the stored error on an errored stream.
ConsumerFillStep readableStreamDefaultReaderFillFromQueue(JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader, JSArray* chunks, JSPromise** pendingRead)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    *pendingRead = nullptr;
    auto* stream = reader->m_stream.get();
    if (!stream) [[unlikely]] {
        throwException(globalObject, scope, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The reader is not attached to a stream"_s));
        return ConsumerFillStep::Done;
    }
    stream->m_disturbed = true;
    while (true) {
        if (stream->m_state == ReadableStreamState::Errored) {
            JSValue storedError = stream->m_storedError.get();
            throwException(globalObject, scope, storedError ? storedError : jsUndefined());
            return ConsumerFillStep::Done;
        }
        bool isByte = stream->m_controllerKind == ControllerKind::Byte;
        bool queueEmpty = isByte ? byteControllerOf(stream)->m_queue.isEmpty() : defaultControllerOf(stream)->m_queue.isEmpty();
        if (!queueEmpty) {
            drainQueueEntriesInto(vm, globalObject, stream, chunks, chunks->length());
            RETURN_IF_EXCEPTION(scope, ConsumerFillStep::Done);
            continue;
        }
        if (stream->m_state == ReadableStreamState::Closed)
            return ConsumerFillStep::Done;
        auto* runtime = JSStreamsRuntime::from(globalObject);
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        auto* readRequest = WebCore::JSReadRequest::create(vm, runtime->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::Promise, promise);
        if (isByte)
            byteControllerOf(stream)->pullSteps(globalObject, readRequest);
        else
            defaultControllerOf(stream)->pullSteps(globalObject, readRequest);
        RETURN_IF_EXCEPTION(scope, ConsumerFillStep::Done);
        *pendingRead = promise;
        return ConsumerFillStep::Pending;
    }
}

static JSValue emptyDoneReadManyResult(JSC::VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* values = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});
    return createReadManyResult(vm, globalObject, values, 0, true);
}

// The onReadManyPullFulfilled continuation: `result` is the `{value, done}` the spec pull
// resolved, prepended to whatever that pull enqueued.
static JSValue readManyAfterPull(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader, JSValue result)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!result.isObject()) [[unlikely]]
        RELEASE_AND_RETURN(scope, emptyDoneReadManyResult(vm, globalObject));
    JSValue chunk = asObject(result)->get(globalObject, vm.propertyNames->value);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue done = asObject(result)->get(globalObject, vm.propertyNames->done);
    RETURN_IF_EXCEPTION(scope, {});
    if (done.toBoolean(globalObject)) {
        auto* values = constructEmptyArray(globalObject, nullptr, chunk.toBoolean(globalObject) ? 1 : 0);
        RETURN_IF_EXCEPTION(scope, {});
        if (values->length()) {
            values->putDirectIndex(globalObject, 0, chunk);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return createReadManyResult(vm, globalObject, values, 0, true);
    }
    // The reader can have been released by the user pull that produced the chunk.
    auto* stream = reader->m_stream.get();
    if (!stream || (stream->m_controllerKind != ControllerKind::Default && stream->m_controllerKind != ControllerKind::Byte)) [[unlikely]] {
        auto* values = constructEmptyArray(globalObject, nullptr, 1);
        RETURN_IF_EXCEPTION(scope, {});
        values->putDirectIndex(globalObject, 0, chunk);
        RETURN_IF_EXCEPTION(scope, {});
        return createReadManyResult(vm, globalObject, values, 1, false);
    }
    RELEASE_AND_RETURN(scope, drainQueueForReadMany(vm, globalObject, stream, chunk));
}

// The onReadManyDirectPullFulfilled continuation: maps the direct pump's `{done, value}`
// into the readMany result shape.
static JSValue readManyAfterDirectPull(JSC::VM& vm, JSGlobalObject* globalObject, JSValue result)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!result.isObject()) [[unlikely]]
        RELEASE_AND_RETURN(scope, emptyDoneReadManyResult(vm, globalObject));
    JSValue chunk = asObject(result)->get(globalObject, vm.propertyNames->value);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue done = asObject(result)->get(globalObject, vm.propertyNames->done);
    RETURN_IF_EXCEPTION(scope, {});
    bool isDone = done.toBoolean(globalObject);
    bool hasChunk = isDone ? chunk.toBoolean(globalObject) : true;
    auto* values = constructEmptyArray(globalObject, nullptr, hasChunk ? 1 : 0);
    RETURN_IF_EXCEPTION(scope, {});
    if (hasChunk) {
        values->putDirectIndex(globalObject, 0, chunk);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return createReadManyResult(vm, globalObject, values, isDone ? 0 : 1, !!isDone);
}

// Bun `reader.readMany()`: `{value, size, done}` synchronously, or a promise of one.
JSValue readableStreamDefaultReaderReadMany(JSGlobalObject* globalObject, JSReadableStreamDefaultReader* reader)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = reader->m_stream.get();
    if (!stream) {
        throwException(globalObject, scope, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The reader is not attached to a stream"_s));
        return {};
    }
    stream->m_disturbed = true;
    const ReadableStreamState state = stream->m_state;
    if (state == ReadableStreamState::Errored) {
        JSValue storedError = stream->m_storedError.get();
        throwException(globalObject, scope, storedError ? storedError : jsUndefined());
        return {};
    }

    auto* runtime = JSStreamsRuntime::from(globalObject);
    const ControllerKind controllerKind = stream->m_controllerKind;
    switch (controllerKind) {
    case ControllerKind::Direct: {
        if (state == ReadableStreamState::Closed)
            break;
        auto* controller = uncheckedDowncast<WebCore::JSDirectStreamController>(stream->m_controller.get());
        JSValue pulled = controller->onPull(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto* pulledPromise = dynamicDowncast<JSPromise>(pulled);
        if (!pulledPromise)
            break;
        auto* result = JSPromise::create(vm, globalObject->promiseStructure());
        pulledPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReadManyDirectPullFulfilled(), jsUndefined(), result, reader);
        RETURN_IF_EXCEPTION(scope, {});
        return result;
    }
    case ControllerKind::None:
        if (state == ReadableStreamState::Closed)
            break;
        throwException(globalObject, scope, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: This ReadableStream has no controller"_s));
        return {};
    case ControllerKind::NativeSink:
        ASSERT_NOT_REACHED();
        throwException(globalObject, scope, Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: This ReadableStream is locked to a native sink"_s));
        return {};
    case ControllerKind::Default:
    case ControllerKind::Byte: {
        bool isByte = controllerKind == ControllerKind::Byte;
        bool queueIsEmpty = isByte ? byteControllerOf(stream)->m_queue.isEmpty() : defaultControllerOf(stream)->m_queue.isEmpty();
        if (!queueIsEmpty)
            RELEASE_AND_RETURN(scope, drainQueueForReadMany(vm, globalObject, stream, JSValue()));
        if (stream->m_state == ReadableStreamState::Closed)
            break;
        // Queue empty, readable: one spec pull, continued by onReadManyPullFulfilled.
        auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
        auto* readRequest = WebCore::JSReadRequest::create(vm, runtime->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::Promise, promise);
        if (isByte)
            byteControllerOf(stream)->pullSteps(globalObject, readRequest);
        else
            defaultControllerOf(stream)->pullSteps(globalObject, readRequest);
        RETURN_IF_EXCEPTION(scope, {});
        auto* result = JSPromise::create(vm, globalObject->promiseStructure());
        promise->performPromiseThenWithContext(vm, globalObject, runtime->onReadManyPullFulfilled(), jsUndefined(), result, reader);
        RETURN_IF_EXCEPTION(scope, {});
        return result;
    }
    }
    RELEASE_AND_RETURN(scope, emptyDoneReadManyResult(vm, globalObject));
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_cancel);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_read);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_readMany);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_releaseLock);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototype_inspectCustom);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamDefaultReaderPrototypeGetter_closed);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamDefaultReaderPrototypeGetter_constructor);

class JSReadableStreamDefaultReaderPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableStreamDefaultReaderPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamDefaultReaderPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReaderPrototype>(vm)) JSReadableStreamDefaultReaderPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamDefaultReaderPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStreamDefaultReaderPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamDefaultReaderPrototype, JSReadableStreamDefaultReaderPrototype::Base);

// JSReadableStreamDefaultReaderConstructor = JSStreamConstructor<JSReadableStreamDefaultReader>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamDefaultReaderConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSReadableStreamDefaultReaderConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSReadableStreamDefaultReaderConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSReadableStreamDefaultReaderConstructor::subspaceForImpl(JSC::VM&);
template<> void JSReadableStreamDefaultReaderConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSReadableStreamDefaultReaderConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSReadableStreamDefaultReaderConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSReadableStreamDefaultReaderConstructor::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReaderConstructor) };

template<> JSValue JSReadableStreamDefaultReaderConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSReadableStreamDefaultReaderConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamDefaultReaderConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSReadableStreamDefaultReaderConstructor);

template<> GCClient::IsoSubspace* JSReadableStreamDefaultReaderConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamDefaultReaderConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamDefaultReaderConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamDefaultReaderConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamDefaultReaderConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamDefaultReaderConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSReadableStreamDefaultReaderConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ReadableStreamDefaultReader"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSReadableStreamDefaultReader::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSReadableStreamDefaultReader>(vm, globalObject));
}

// new ReadableStreamDefaultReader(stream): SetUpReadableStreamDefaultReader(this, stream).
template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamDefaultReaderConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSReadableStreamDefaultReaderConstructor>(callFrame->jsCallee());

    auto* stream = dynamicDowncast<JSReadableStream>(callFrame->argument(0));
    if (!stream)
        return throwVMTypeError(lexicalGlobalObject, scope, "ReadableStreamDefaultReader constructor requires a ReadableStream as its first argument"_s);

    // Same as getReader(): a lazy native/direct stream materializes before it is locked.
    stream->materializeIfNeeded(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* reader = JSReadableStreamDefaultReader::create(vm, structure);
    setUpReadableStreamDefaultReader(lexicalGlobalObject, reader, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(reader);
}
JSC_ANNOTATE_HOST_FUNCTION(JSReadableStreamDefaultReaderConstructorConstruct, JSReadableStreamDefaultReaderConstructor::construct);

// JSReadableStreamDefaultReaderPrototype

static const HashTableValue JSReadableStreamDefaultReaderPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamDefaultReaderPrototypeGetter_constructor, 0 } },
    { "closed"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamDefaultReaderPrototypeGetter_closed, 0 } },
    { "cancel"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamDefaultReaderPrototypeFunction_cancel, 0 } },
    { "read"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamDefaultReaderPrototypeFunction_read, 0 } },
    { "readMany"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamDefaultReaderPrototypeFunction_readMany, 0 } },
    { "releaseLock"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamDefaultReaderPrototypeFunction_releaseLock, 0 } },
};

const ClassInfo JSReadableStreamDefaultReaderPrototype::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReaderPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSReadableStreamDefaultReader>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "stream"_s), thisObject->m_stream.get() ? JSValue(thisObject->m_stream.get()) : jsUndefined(), 0);
    size_t requestCount;
    {
        WTF::Locker locker { thisObject->cellLock() };
        requestCount = thisObject->m_readRequests.size();
    }
    data->putDirect(vm, Identifier::fromString(vm, "readRequests"_s), jsNumber(requestCount), 0);
    data->putDirect(vm, Identifier::fromString(vm, "close"_s), thisObject->m_closedPromise.get() ? JSValue(thisObject->m_closedPromise.get()) : jsUndefined(), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "ReadableStreamDefaultReader"_s, data));
}

void JSReadableStreamDefaultReaderPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableStreamDefaultReader::info(), JSReadableStreamDefaultReaderPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsReadableStreamDefaultReaderPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSReadableStreamDefaultReader

const ClassInfo JSReadableStreamDefaultReader::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReader) };

JSReadableStreamDefaultReader::JSReadableStreamDefaultReader(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSReadableStreamDefaultReader::~JSReadableStreamDefaultReader() = default;

void JSReadableStreamDefaultReader::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadableStreamDefaultReader* JSReadableStreamDefaultReader::create(VM& vm, Structure* structure)
{
    auto* reader = new (NotNull, allocateCell<JSReadableStreamDefaultReader>(vm)) JSReadableStreamDefaultReader(vm, structure);
    reader->finishCreation(vm);
    return reader;
}

void JSReadableStreamDefaultReader::destroy(JSCell* cell)
{
    static_cast<JSReadableStreamDefaultReader*>(cell)->JSReadableStreamDefaultReader::~JSReadableStreamDefaultReader();
}

Structure* JSReadableStreamDefaultReader::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSReadableStreamDefaultReader::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSReadableStreamDefaultReaderPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSReadableStreamDefaultReaderPrototype::create(vm, &globalObject, structure);
}

JSObject* JSReadableStreamDefaultReader::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSReadableStreamDefaultReader>(vm, globalObject);
}

JSValue JSReadableStreamDefaultReader::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSReadableStreamDefaultReaderConstructor, DOMConstructorID::ReadableStreamDefaultReader>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSReadableStreamDefaultReader::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamDefaultReader, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamDefaultReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamDefaultReader = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamDefaultReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamDefaultReader = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSReadableStreamDefaultReader);

template<typename Visitor>
void JSReadableStreamDefaultReader::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamDefaultReader>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_closedPromise);
    visitor.appendHidden(thisObject->m_pipeOperation);
    WTF::Locker locker { thisObject->cellLock() };
    for (auto& request : thisObject->m_readRequests)
        visitor.appendHidden(request);
}

void JSReadableStreamDefaultReader::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamDefaultReader>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closedPromise, "closedPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pipeOperation, "pipeOperation"_s);
    {
        WTF::Locker locker { thisObject->cellLock() };
        uint32_t i = 0;
        for (auto& entry : thisObject->m_readRequests) {
            if (auto* request = entry.get())
                analyzer.analyzeIndexEdge(cell, request, i);
            ++i;
        }
    }
}

// Prototype accessors and host functions

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamDefaultReaderPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSReadableStreamDefaultReaderPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSReadableStreamDefaultReader::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamDefaultReaderPrototypeGetter_closed, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    const auto* reader = dynamicDowncast<JSReadableStreamDefaultReader>(JSValue::decode(thisValue));
    if (!reader) [[unlikely]]
        return JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "The 'closed' getter can only be used on a ReadableStreamDefaultReader"_s)));
    return JSValue::encode(reader->m_closedPromise.get());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_cancel, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamDefaultReader>(callFrame->thisValue());
    if (!reader) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "ReadableStreamDefaultReader.prototype.cancel can only be called on a ReadableStreamDefaultReader"_s))));
    if (!reader->m_stream)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The reader is not attached to a stream"_s))));
    auto* promise = readableStreamReaderGenericCancel(lexicalGlobalObject, reader, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_read, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamDefaultReader>(callFrame->thisValue());
    if (!reader) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "ReadableStreamDefaultReader.prototype.read can only be called on a ReadableStreamDefaultReader"_s))));
    if (!reader->m_stream)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: The reader is not attached to a stream"_s))));

    // Queued chunk and nothing waiting: resolve synchronously with no read request.
    JSValue chunk = Bun::WebStreams::readableStreamDefaultReaderTryReadFromQueue(lexicalGlobalObject, reader);
    RETURN_IF_EXCEPTION(scope, {});
    if (chunk) {
        JSObject* result = createIteratorResultObject(lexicalGlobalObject, chunk, false);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseResolvedWith(lexicalGlobalObject, result)));
    }
    auto* domGlobalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* runtime = JSStreamsRuntime::from(lexicalGlobalObject);
    auto* promise = JSPromise::create(vm, lexicalGlobalObject->promiseStructure());
    auto* readRequest = JSReadRequest::create(vm, runtime->readRequestStructure(domGlobalObject), ReadRequestKind::Promise, promise);
    readableStreamDefaultReaderRead(lexicalGlobalObject, reader, readRequest);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_readMany, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamDefaultReader>(callFrame->thisValue());
    if (!reader) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope, "ReadableStreamDefaultReader.readMany() should not be called directly"_s);
    RELEASE_AND_RETURN(scope, JSValue::encode(readableStreamDefaultReaderReadMany(lexicalGlobalObject, reader)));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultReaderPrototypeFunction_releaseLock, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamDefaultReader>(callFrame->thisValue());
    if (!reader) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "ReadableStreamDefaultReader"_s);
    if (!reader->m_stream)
        return JSValue::encode(jsUndefined());
    readableStreamDefaultReaderRelease(lexicalGlobalObject, reader);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// [reaction-convention] handlers owned by this file (context at argument(1) = the reader).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadManyPullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = dynamicDowncast<JSReadableStreamDefaultReader>(callFrame->argument(1));
    if (!reader) [[unlikely]]
        return JSValue::encode(jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readManyAfterPull(vm, globalObject, reader, callFrame->argument(0))));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadManyDirectPullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readManyAfterDirectPull(vm, globalObject, callFrame->argument(0))));
}

} // namespace WebCore
