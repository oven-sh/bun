#include "config.h"
#include "JSDirectStreamController.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "helpers.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSDirectStreamSource.h"
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
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/Locker.h>
#include <wtf/text/StringBuilder.h>

extern "C" void Bun__Process__queueNextTick2(Zig::GlobalObject*, JSC::EncodedJSValue func, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2);

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

const ClassInfo JSDirectStreamSource::s_info = { "DirectStreamSource"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDirectStreamSource) };

JSDirectStreamSource::JSDirectStreamSource(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSDirectStreamSource::finishCreation(VM& vm, JSValue underlyingSource, JSObject* pull, JSObject* cancel, JSObject* close)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    auto valueOrNull = [](JSObject* object) { return object ? JSValue(object) : jsNull(); };
    Base::internalField(static_cast<uint32_t>(Field::UnderlyingSource)).set(vm, this, underlyingSource);
    Base::internalField(static_cast<uint32_t>(Field::Pull)).set(vm, this, valueOrNull(pull));
    Base::internalField(static_cast<uint32_t>(Field::Cancel)).set(vm, this, valueOrNull(cancel));
    Base::internalField(static_cast<uint32_t>(Field::Close)).set(vm, this, valueOrNull(close));
}

JSDirectStreamSource* JSDirectStreamSource::create(VM& vm, Structure* structure, JSValue underlyingSource, JSObject* pull, JSObject* cancel, JSObject* close)
{
    auto* cell = new (NotNull, allocateCell<JSDirectStreamSource>(vm)) JSDirectStreamSource(vm, structure);
    cell->finishCreation(vm, underlyingSource, pull, cancel, close);
    return cell;
}

Structure* JSDirectStreamSource::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSDirectStreamSource::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDirectStreamSource, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDirectStreamSource, m_subspaceForDirectStreamSource));
}

template<typename Visitor>
void JSDirectStreamSource::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDirectStreamSource>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    visitInternalFieldsHidden(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSDirectStreamSource);

void JSDirectStreamSource::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSDirectStreamSource>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::UnderlyingSource), "underlyingSource"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Pull), "pull"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Cancel), "cancel"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->internalField(Field::Close), "close"_s);
}

JSPromise* JSDirectStreamSource::cancel(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSObject* cancelMethod = cancelFunction();
    if (!cancelMethod)
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, jsUndefined()));
    MarkedArgumentBuffer args;
    args.append(reason);
    StreamAsyncContextScope asyncContextScope(globalObject, stream);
    RELEASE_AND_RETURN(scope, invokeCallbackReturningPromise(globalObject, cancelMethod, thisValue(), args));
}

void JSDirectStreamSource::close(JSGlobalObject* globalObject, JSValue reason)
{
    JSObject* closeMethod = closeFunction();
    if (!closeMethod)
        return;
    MarkedArgumentBuffer args;
    args.append(reason);
    JSC::call(globalObject, closeMethod, JSC::getCallData(closeMethod), thisValue(), args);
}

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

// Deliver data written outside pull() to a waiting reader at the end of this tick: a
// process.nextTick job (rooting the controller until it runs; a no-op if the data was already
// taken). A write during the synchronous part of pull() needs no job: onPull drains it as soon
// as pull() returns.
void JSDirectStreamController::armEndOfTickFlush(JSGlobalObject* globalObject)
{
    // No consumer takes chunks before end() from a Text/Array sink (readableStreamToText /
    // readableStreamToArray): a delivery job would be a no-op that pins the controller.
    if (m_sinkKind != DirectSinkKind::ArrayBuffer || m_endOfTickFlushArmed || m_closed || !m_stream || m_deferFlush == -1)
        return;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    m_endOfTickFlushArmed = true;
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* handler = JSStreamsRuntime::from(globalObject)->onDirectEndOfTickFlush();
    Bun__Process__queueNextTick2(zigGlobal, JSValue::encode(handler), JSValue::encode(jsUndefined()), JSValue::encode(this));
    if (scope.exception()) [[unlikely]]
        m_endOfTickFlushArmed = false;
}

Structure* JSDirectStreamController::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSDirectStreamController::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDirectStreamController, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDirectStreamController, m_subspaceForDirectStreamController));
}

DEFINE_VISIT_CHILDREN(JSDirectStreamController);

template<typename Visitor>
void JSDirectStreamController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDirectStreamController>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_source);
    visitor.appendHidden(thisObject->m_pendingRead);
    visitor.appendHidden(thisObject->m_deferCloseReason);
    visitor.appendHidden(thisObject->m_array);
    visitor.appendHidden(thisObject->m_sinkPromise);
    visitor.appendHidden(thisObject->m_finalChunk);
    visitor.reportExtraMemoryVisited(thisObject->m_reportedCapacity);
    Locker locker { thisObject->cellLock() };
    thisObject->m_textAccumulator.visit(locker, visitor);
}

void JSDirectStreamController::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSDirectStreamController>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_source, "source"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pendingRead, "pendingRead"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_deferCloseReason, "deferCloseReason"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_array, "array"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_sinkPromise, thisObject->m_sinkKind == DirectSinkKind::ArrayBuffer ? "pendingWrite"_s : "closingPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_finalChunk, "finalChunk"_s);
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_textAccumulator.analyzeHeap(locker, cell, analyzer);
}

size_t JSDirectStreamController::estimatedSize(JSCell* cell, VM& vm)
{
    return Base::estimatedSize(cell, vm) + uncheckedDowncast<JSDirectStreamController>(cell)->m_buffer.capacity();
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

bool DirectByteBuffer::tryGrowTo(size_t size)
{
    size_t current = capacity();
    if (size <= current)
        return true;
    if (size > MAX_ARRAY_BUFFER_SIZE)
        return false;
    size_t capacity = std::max<size_t>(size, current > MAX_ARRAY_BUFFER_SIZE / 2 ? MAX_ARRAY_BUFFER_SIZE : std::max<size_t>(64, current * 2));
    void* data = m_data ? Gigacage::tryRealloc(Gigacage::Primitive, m_data, capacity) : Gigacage::tryMalloc(Gigacage::Primitive, capacity);
    if (!data)
        return false;
    m_data = static_cast<uint8_t*>(data);
    m_capacity = capacity;
    return true;
}

bool DirectByteBuffer::tryReserve(size_t capacity)
{
    return tryGrowTo(capacity);
}

bool DirectByteBuffer::tryAppend(std::span<const uint8_t> bytes)
{
    if (bytes.empty())
        return true;
    size_t size = m_size + bytes.size();
    if (size < m_size || !tryGrowTo(size))
        return false;
    memcpy(m_data + m_size, bytes.data(), bytes.size());
    m_size = size;
    return true;
}

bool DirectByteBuffer::tryAppendUTF8(StringView string)
{
    size_t byteLength = utf8ByteLengthWithReplacement(string);
    if (!byteLength)
        return true;
    size_t size = m_size + byteLength;
    if (size < m_size || !tryGrowTo(size))
        return false;
    m_size += writeUTF8WithReplacement(string, { m_data + m_size, byteLength });
    return true;
}

void DirectByteBuffer::deallocate()
{
    if (m_data)
        Gigacage::free(Gigacage::Primitive, m_data);
    m_data = nullptr;
    m_size = 0;
    m_capacity = 0;
}

Ref<ArrayBuffer> DirectByteBuffer::releaseAsArrayBuffer()
{
    if (m_capacity != m_size) {
        if (void* data = Gigacage::tryRealloc(Gigacage::Primitive, m_data, m_size))
            m_data = static_cast<uint8_t*>(data);
    }
    std::span<const uint8_t> bytes { m_data, m_size };
    m_data = nullptr;
    m_size = 0;
    return ArrayBuffer::createAdopted(bytes);
}

// The reader-side backpressure threshold of the ArrayBuffer sink: the strategy's highWaterMark
// (bytes, for a direct stream) when positive, else 64 KiB.
static size_t directHighWaterMark(JSDirectStreamController* controller)
{
    constexpr size_t defaultHighWaterMark = 64 * 1024;
    auto* stream = controller->m_stream.get();
    double highWaterMark = stream ? stream->m_bunHighWaterMark : PNaN;
    if (!(highWaterMark >= 1))
        return highWaterMark > 0 ? 1 : defaultHighWaterMark;
    return highWaterMark >= std::numeric_limits<uint32_t>::max() ? std::numeric_limits<uint32_t>::max() : static_cast<size_t>(highWaterMark);
}

void JSDirectStreamController::settlePendingWrite(JSC::VM& vm, JSValue value)
{
    // Only the ArrayBuffer sink parks writes; for Text/Array the slot is the closing capability.
    if (m_sinkKind != DirectSinkKind::ArrayBuffer)
        return;
    auto* promise = pendingWrite().get();
    if (!promise)
        return;
    pendingWrite().clear();
    promise->fulfill(vm, value);
}

void JSDirectStreamController::syncReportedCapacity(JSC::VM& vm)
{
    size_t capacity = m_buffer.capacity();
    if (capacity > m_reportedCapacity)
        vm.heap.reportExtraMemoryAllocated(this, capacity - m_reportedCapacity);
    m_reportedCapacity = capacity;
}

JSValue JSDirectStreamController::takeBuffer(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (m_buffer.isEmpty())
        return jsNumber(0);
    size_t byteLength = m_buffer.size();
    auto* structure = globalObject->typedArrayStructureWithTypedArrayType<TypeUint8>();
    JSUint8Array* chunk;
    if (byteLength > JSArrayBufferView::fastSizeLimit) {
        chunk = JSUint8Array::create(globalObject, structure, m_buffer.releaseAsArrayBuffer(), 0, byteLength);
        m_reportedCapacity = 0;
    } else {
        // Small enough for the view's inline (GC) storage: cheaper to copy than to give it an ArrayBuffer.
        chunk = JSUint8Array::createUninitialized(globalObject, structure, byteLength);
        if (chunk)
            memcpy(chunk->vector(), m_buffer.span().data(), byteLength);
        m_buffer.shrinkToEmpty();
    }
    RETURN_IF_EXCEPTION(scope, {});
    settlePendingWrite(vm, jsNumber(m_pendingWriteLength));
    return chunk;
}

void JSDirectStreamController::freeBuffer()
{
    m_buffer.deallocate();
    m_reportedCapacity = 0;
}

// Appends the chunk's bytes (a string is UTF-8 encoded); returns the byte count.
static JSValue writeToByteBuffer(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* string = chunk.isString() ? asString(chunk) : nullptr;
    GCOwnedDataScope<StringView> characters;
    std::span<const uint8_t> bytes;
    if (string) {
        characters = string->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk)) {
        if (!view->isDetached())
            bytes = view->span();
    } else if (auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(chunk)) {
        if (auto* impl = arrayBuffer->impl(); impl && !impl->isDetached())
            bytes = impl->span();
    } else {
        Bun::throwError(globalObject, scope, chunk.isUndefinedOrNull() ? Bun::ErrorCode::ERR_STREAM_NULL_VALUES : Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "write() expects a string, ArrayBufferView, or ArrayBuffer"_s);
        return {};
    }

    auto& buffer = controller->m_buffer;
    size_t sizeBefore = buffer.size();
    // A steady producer fills about what it filled last time: allocate that once per batch.
    if (!buffer.capacity() && buffer.lastCapacity())
        buffer.tryReserve(std::min(buffer.lastCapacity(), directHighWaterMark(controller)));
    if (!(string ? buffer.tryAppendUTF8(characters) : buffer.tryAppend(bytes))) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    return jsNumber(buffer.size() - sizeBefore);
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
        return writeToByteBuffer(globalObject, controller, chunk);
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

    // Sizes are recorded at write() time; rejecting even if buffers were detached later is intended.
    const double estimatedLength = accumulator.estimatedLength;
    if (estimatedLength > static_cast<double>(WTF::StringImpl::MaxLength)
        || Bun::WebStreams::exceedsStringLimit(static_cast<size_t>(estimatedLength))) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return String();
    }
    Vector<uint8_t> bytes;
    if (estimatedLength > 0 && !bytes.tryReserveInitialCapacity(static_cast<size_t>(estimatedLength))) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return String();
    }
    for (auto& piece : accumulator.pieces) {
        JSValue value = piece.get();
        bool appended = true;
        if (value.isString()) {
            String string = asString(value)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            appended = Bun::WebStreams::appendUTF8WithinStringLimit(string, bytes);
        } else if (auto* view = dynamicDowncast<JSArrayBufferView>(value)) {
            if (!view->isDetached())
                appended = bytes.tryAppend(view->span());
        } else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(value)) {
            auto* impl = buffer->impl();
            if (impl && !impl->isDetached())
                appended = bytes.tryAppend(impl->span());
        }
        if (!appended) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return String();
        }
    }
    if (!accumulator.rope.isEmpty()) {
        String rope = accumulator.rope.toString();
        if (rope[0] == 0xFEFF)
            rope = rope.substring(1);
        if (!Bun::WebStreams::appendUTF8WithinStringLimit(rope, bytes)) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return String();
        }
    }
    if (Bun::WebStreams::exceedsStringLimit(bytes.size())) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return String();
    }
    String text = Zig::convertUTF8ToString(bytes.span());
    if (text.isNull() && !bytes.isEmpty()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return String();
    }
    return text;
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
    if (auto* closingPromise = controller->closingPromise().get())
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
    if (auto* closingPromise = controller->closingPromise().get()) {
        resolvePromise(globalObject, closingPromise, array);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return array;
}

// `sink.end()`: the sink's final chunk. May throw.
static JSValue endDirectSink(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        JSValue flushed = controller->takeBuffer(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        controller->freeBuffer();
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
    case DirectSinkKind::ArrayBuffer:
        return controller->takeBuffer(globalObject);
    case DirectSinkKind::Text:
    case DirectSinkKind::Array:
        return jsNumber(0);
    }
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

// `sink.close(error)`: the Text/Array sinks fulfill their closing promise with the partial result.
static void closeDirectSinkForError(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    switch (controller->m_sinkKind) {
    case DirectSinkKind::ArrayBuffer:
        controller->freeBuffer();
        return;
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

// Errors the stream with `error`: rejects the pending read, errors the stream, tears the sink down,
// then runs the user's close(error) hook. The stream is fully errored before anything that can throw
// (the sink teardown, the hook) runs, so a throw from those propagates with the stream consistent.
bool JSDirectStreamController::handleError(JSGlobalObject* globalObject, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    const bool wasClosed = m_closed;
    m_closed = true;
    auto* source = m_source.get();
    directStreamControllerClearSource(this);
    settlePendingWrite(vm, jsBoolean(false));

    bool delivered = false;
    if (auto* pendingRead = m_pendingRead.get()) {
        m_pendingRead.clear();
        rejectPromise(globalObject, pendingRead, error);
        RETURN_IF_EXCEPTION(scope, false);
        delivered = true;
    }
    auto* stream = m_stream.get();
    if (stream && stream->m_state == ReadableStreamState::Readable) {
        readableStreamError(globalObject, stream, error);
        RETURN_IF_EXCEPTION(scope, false);
        delivered = true;
    }

    // onClose() already closed the sink and ran the user's close() if the controller was closed
    // (end() arming the final chunk leaves the stream Readable), so doing it again would double it.
    if (wasClosed)
        return delivered;
    closeDirectSinkForError(vm, globalObject, this);
    RETURN_IF_EXCEPTION(scope, false);
    if (source) {
        source->close(globalObject, error);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return delivered;
}

// The reactions' deliver: error the stream; an error nothing was left to receive (the stream had
// already closed) is thrown on for the runner to report rather than dropped.
static void deliverDirectError(JSGlobalObject* globalObject, JSDirectStreamController* controller, JSValue error)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    bool delivered = controller->handleError(globalObject, error);
    RETURN_IF_EXCEPTION(scope, );
    if (!delivered)
        throwException(globalObject, scope, error);
}

// Invokes the user's pull() once, bracketed by m_pullInFlight (the spec sets [[pulling]]
// before invoking pullAlgorithm); left set only when a promise's settlement reaction will
// clear it. This is the boundary into the user's pull(): as for the spec's promise-returning
// pullAlgorithm, its completion is converted here — a synchronous throw is returned as a value
// (the caller errors the stream with it and rejects the read), a returned promise's rejection goes
// to onDirectPullRejected. Empty on normal return, and on VM termination (left pending).
static JSValue callDirectPull(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    StreamAsyncContextScope asyncContextScope(globalObject, controller->m_stream.get());
    auto* source = controller->m_source.get();
    JSObject* pullFunction = source ? source->pullFunction() : nullptr;
    controller->m_pullInFlight = true;
    MarkedArgumentBuffer args;
    args.append(controller);
    JSValue result = JSC::call(globalObject, pullFunction ? JSValue(pullFunction) : jsUndefined(), source ? source->thisValue() : jsUndefined(), args, "underlyingSource.pull is not a function"_s);
    if (JSC::Exception* exception = scope.exception()) [[unlikely]] {
        controller->m_pullInFlight = false;
        TRY_CLEAR_EXCEPTION(scope, {});
        return exception->value();
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

JSValue JSDirectStreamController::onPull(JSGlobalObject* globalObject, bool readRequestQueued)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    StagedBytesScope stagedBytes(vm, this);

    // The one-shot final chunk armed by onClose: deliver it, then close.
    if (m_finalChunkArmed) {
        m_finalChunkArmed = false;
        JSValue chunk = m_finalChunk.get();
        m_finalChunk.clear();
        auto* stream = m_stream.get();
        // A queued read request (for-await/tee/pipeTo) takes the chunk through its own
        // chunkSteps; a promise-backed read gets it wrapped in the returned promise.
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
        // A VM termination from the pull, or a failure while registering the reaction.
        RETURN_IF_EXCEPTION(scope, {});

        if (!abrupt.isEmpty()) {
            // A synchronous throw from pull errors the stream, which settles a queued read
            // request through its errorSteps; a promise-backed read gets the rejection here.
            handleError(globalObject, abrupt);
            RETURN_IF_EXCEPTION(scope, {});
            if (readRequestQueued)
                return jsUndefined();
            RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, abrupt));
        }
    } else {
        // A new read arrived while an async pull is pending: the fulfillment reaction will
        // re-pull. Drain anything that pull already wrote; onFlush is a no-op-restore on an
        // empty sink.
        m_pullAgain = true;
        deferredFlush = 1;
    }

    // controller.error() inside pull is not deferred: re-validate before registering a consumer.
    // A queued read request was already settled by the stream's error/close steps.
    stream = m_stream.get();
    if (!stream || stream->m_state != ReadableStreamState::Readable) {
        if (readRequestQueued)
            return jsUndefined();
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

    // Register the consumer before replaying what pull() deferred. A queued read request is
    // already registered; a promise made for it here would swallow that delivery unobserved.
    JSPromise* promiseToReturn = nullptr;
    if (!readRequestQueued) {
        promiseToReturn = JSPromise::create(vm, globalObject->promiseStructure());
        if (!m_pendingRead)
            m_pendingRead.set(vm, this, promiseToReturn);
        else {
            auto* runtime = JSStreamsRuntime::from(globalObject);
            auto* readRequest = JSReadRequest::create(vm, runtime->readRequestStructure(defaultGlobalObject(globalObject)), ReadRequestKind::Promise, promiseToReturn);
            readableStreamAddReadRequest(vm, stream, readRequest);
        }
    }

    if (deferredClose == 1) {
        JSValue reason = m_deferCloseReason.get();
        m_deferCloseReason.clear();
        onClose(globalObject, reason);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (deferredFlush == 1 || !m_buffer.isEmpty()) {
        // Bytes written before this read (outside pull, or by a producer now parked on
        // backpressure) go to the consumer just registered.
        onFlush(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return promiseToReturn ? JSValue(promiseToReturn) : jsUndefined();
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
    if (m_closed)
        return;
    // close(error): the source failed; error the stream instead of ending it (the native sink path's fail()).
    if (reason.toBoolean(globalObject)) {
        handleError(globalObject, reason);
        RELEASE_AND_RETURN(scope, );
    }
    // No "Closing" stream state exists: m_closed set here is what blocks re-entry.
    m_closed = true;
    auto* source = m_source.get();
    directStreamControllerClearSource(this);

    JSValue flushed = endDirectSink(vm, globalObject, this);
    RETURN_IF_EXCEPTION(scope, );
    finishClose(globalObject, flushed);
    RETURN_IF_EXCEPTION(scope, );
    // The user's close(reason) hook runs once the stream is fully closed, so a throw from it
    // propagates to whoever closed with nothing left half-done.
    if (source)
        RELEASE_AND_RETURN(scope, source->close(globalObject, reason));
}

// The rest of close(): hand end()'s final chunk to whoever is reading (or arm it for the next read),
// then close the stream.
void JSDirectStreamController::finishClose(JSGlobalObject* globalObject, JSValue flushed)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = m_stream.get();

    if (byteLengthOf(flushed)) {
        if (auto* pendingRead = m_pendingRead.get()) {
            m_pendingRead.clear();
            JSObject* result = createIteratorResultObject(globalObject, flushed, false);
            RETURN_IF_EXCEPTION(scope, );
            pendingRead->fulfill(vm, result);
            RETURN_IF_EXCEPTION(scope, );
            RELEASE_AND_RETURN(scope, readableStreamCloseIfPossible(globalObject, stream));
        }
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

JSPromise* JSDirectStreamController::cancelSteps(JSGlobalObject* globalObject, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Null once end()/close()/error() ran: the source already saw close(reason).
    auto* source = m_source.get();
    m_closed = true;
    // A canceled read resolves with { value: undefined, done: true }.
    if (auto* pendingRead = m_pendingRead.get()) {
        m_pendingRead.clear();
        JSObject* doneResult = createIteratorResultObject(globalObject, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, nullptr);
        pendingRead->fulfill(vm, doneResult);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    settlePendingWrite(vm, jsBoolean(false));
    if (m_sinkKind == DirectSinkKind::ArrayBuffer)
        freeBuffer();
    JSPromise* result = source ? source->cancel(globalObject, m_stream.get(), reason) : promiseFulfilledWith(globalObject, jsUndefined());
    RETURN_IF_EXCEPTION(scope, nullptr);
    directStreamControllerClearSource(this);
    return result;
}

void JSDirectStreamController::onFlush(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* stream = m_stream.get();
    if (!stream)
        return;
    if (m_closed)
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
            // onPull queues concurrent promise-backed reads behind the head-of-line one.
            {
                Locker locker { reader->cellLock() };
                if (!reader->m_readRequests.isEmpty() && reader->m_readRequests.first().get()->kind() == ReadRequestKind::Promise) {
                    auto* readRequest = reader->m_readRequests.takeFirst().get();
                    m_pendingRead.set(vm, this, uncheckedDowncast<JSPromise>(readRequest->context()));
                }
            }
            // The spec's enqueue → CallPullIfNeeded equivalent: re-arm when this delivery
            // still leaves a consumer waiting behind the in-flight pull.
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
// The pull promise's fulfilment reaction (enterStreams): drain, then re-pull while a consumer is
// waiting. Whatever throws in here (a chunkSteps callback, a deferred close, the source's hooks)
// errors the stream.
static void directPullFulfilled(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectStreamController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSDirectStreamController::StagedBytesScope stagedBytes(vm, controller);
    auto* stream = controller->m_stream.get();
    if (controller->m_closed || !stream || stream->m_state != ReadableStreamState::Readable) {
        controller->m_pullInFlight = false;
        controller->m_pullAgain = false;
        return;
    }
    // Drain anything this pull wrote while no reader was waiting. m_pullInFlight stays set
    // so onFlush's delivery-branch re-arm fires for a pull that wrote without c.flush().
    controller->onFlush(globalObject);
    controller->m_pullInFlight = false;
    RETURN_IF_EXCEPTION(scope, );
    if (controller->m_closeOnPullSettled) {
        controller->m_pullAgain = false;
        stream = controller->m_stream.get();
        if (!controller->m_closed && stream && stream->m_state == ReadableStreamState::Readable)
            controller->onClose(globalObject, jsUndefined());
        RELEASE_AND_RETURN(scope, );
    }
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
        RETURN_IF_EXCEPTION(scope, );
        if (!abrupt.isEmpty()) {
            controller->handleError(globalObject, abrupt);
            RELEASE_AND_RETURN(scope, );
        }
        if (deferredClose == 1) {
            JSValue reason = controller->m_deferCloseReason.get();
            controller->m_deferCloseReason.clear();
            controller->onClose(globalObject, reason);
            RETURN_IF_EXCEPTION(scope, );
        } else {
            // An async re-pull left m_pullInFlight set: its own fulfillment reaction drains
            // and picks up m_pullAgain. What its synchronous part already wrote goes to the
            // waiting reader now, as in onPull: no end-of-tick job was queued for it, and the
            // pull may be parked on that very write.
            if (controller->m_pullInFlight) {
                if (deferredFlush == 1 || !controller->m_buffer.isEmpty())
                    controller->onFlush(globalObject);
                RETURN_IF_EXCEPTION(scope, );
                break;
            }
            // Sync re-pull: drain with m_pullInFlight bracketed so onFlush's delivery-branch
            // re-arm fires regardless of whether the pull called c.flush() itself.
            controller->m_pullInFlight = true;
            controller->onFlush(globalObject);
            controller->m_pullInFlight = false;
            RETURN_IF_EXCEPTION(scope, );
        }
        pullAgain = takeDirectPullAgain(controller);
    }
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDirectPullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    return enterStreams(globalObject, [&] { directPullFulfilled(vm, globalObject, controller); }, [&](JSValue error) { deliverDirectError(globalObject, controller, error); });
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

// Runs from the end-of-tick queue with nothing above it (enterStreams): a throw from onFlush
// (e.g. a read request's chunkSteps) errors the stream.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDirectEndOfTickFlush, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(1));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    controller->m_endOfTickFlushArmed = false;
    if (controller->m_closed || !controller->m_stream)
        return JSValue::encode(jsUndefined());
    return enterStreams(globalObject, [&] { controller->onFlush(globalObject); }, [&](JSValue error) { deliverDirectError(globalObject, controller, error); });
}

// The FIVE public own methods are JSBoundFunctions over these [bound-convention] targets.
// Once the source ended the stream they no-op: a late call from an in-flight pull() must not
// throw, and a call that follows end()/close() inside the same pull() must not reach the sink
// before the deferred close drains it.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectWrite, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller) [[unlikely]]
        return JSValue::encode(jsUndefined());
    if (controller->sourceEnded())
        return JSValue::encode(jsNumber(0));
    JSDirectStreamController::StagedBytesScope stagedBytes(vm, controller);
    JSValue wrote = writeToDirectSink(globalObject, controller, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    controller->armEndOfTickFlush(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (controller->m_sinkKind == DirectSinkKind::ArrayBuffer && controller->m_buffer.size() >= directHighWaterMark(controller)) {
        double written = wrote.asNumber();
        if (!controller->pendingWrite()) {
            controller->pendingWrite().set(vm, controller, JSPromise::create(vm, globalObject->promiseStructure()));
            controller->m_pendingWriteLength = 0;
        }
        controller->m_pendingWriteLength = static_cast<uint32_t>(std::min<double>(std::numeric_limits<uint32_t>::max(), controller->m_pendingWriteLength + written));
        return JSValue::encode(controller->pendingWrite().get());
    }
    return JSValue::encode(wrote);
}

// controller.close(): if closing fails part-way (the sink's end(), the source's close() hook),
// the stream cannot complete normally — it is errored with that failure (so a pending read
// settles) and the failure is still thrown to the caller of close().
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller || controller->sourceEnded()) [[unlikely]]
        return JSValue::encode(jsUndefined());
    return enterStreams(globalObject, [&] { controller->onClose(globalObject, callFrame->argument(1)); }, [&](JSValue error) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        controller->handleError(globalObject, error);
        RETURN_IF_EXCEPTION(scope, );
        throwException(globalObject, scope, error); });
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectFlush, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller || controller->sourceEnded()) [[unlikely]]
        return JSValue::encode(jsUndefined());
    controller->onFlush(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // flush(true) waits for the drain, like a native sink: the promise write() returned. The
    // Text/Array sinks never park a write (their slot is the closing capability).
    if (controller->m_sinkKind == DirectSinkKind::ArrayBuffer && callFrame->argument(1).toBoolean(globalObject)) {
        if (auto* pendingWrite = controller->pendingWrite().get())
            return JSValue::encode(pendingWrite);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundDirectError, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = dynamicDowncast<JSDirectStreamController>(callFrame->argument(0));
    if (!controller || controller->sourceEnded()) [[unlikely]]
        return JSValue::encode(jsUndefined());
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
    auto& strings = Bun::commonStrings(vm);
    struct Method {
        const Identifier& key;
        JSString* name;
        JSFunction* target;
        double length;
        bool ignoresArguments; // end() shares close()'s target; a bound `undefined` keeps end(x) a clean close
    };
    const Method methods[] = {
        { names.writePublicName(), strings.writeString(), runtime->boundDirectWrite(), 1, false },
        { names.endPublicName(), strings.endString(), runtime->boundDirectClose(), 0, true },
        { names.closePublicName(), strings.closeString(), runtime->boundDirectClose(), 1, false },
        { names.flushPublicName(), strings.flushString(), runtime->boundDirectFlush(), 0, false },
        { vm.propertyNames->error, strings.fetchErrorString(), runtime->boundDirectError(), 1, false },
    };
    SourceCode source = makeSource("DirectStreamController"_s, SourceOrigin(), SourceTaintedOrigin::Untainted);
    for (const auto& method : methods) {
        MarkedArgumentBuffer boundArgs;
        boundArgs.append(controller);
        if (method.ignoresArguments)
            boundArgs.append(jsUndefined());
        auto* boundFunction = JSBoundFunction::create(vm, globalObject, method.target, jsUndefined(), ArgList(boundArgs), method.length, method.name, source);
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

// The most an explicit highWaterMark pre-allocates; the buffer still grows past it on demand.
static constexpr size_t maxDirectBufferReserve = 256 * 1024 * 1024;

void directStreamControllerClearSource(JSDirectStreamController* controller)
{
    controller->m_source.clear();
    controller->m_deferCloseReason.clear();
    if (auto* stream = controller->m_stream.get())
        readableStreamClearSourceBarriers(stream);
}

void setUpDirectStreamController(JSC::JSGlobalObject* globalObject, JSReadableStream* stream, DirectSinkKind sinkKind)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* controller = JSDirectStreamController::create(vm, runtime->directStreamControllerStructure(zigGlobalObject), sinkKind);
    controller->m_stream.set(vm, controller, stream);
    controller->m_source.setMayBeNull(vm, controller, stream->m_directSource.get());

    switch (sinkKind) {
    case DirectSinkKind::ArrayBuffer: {
        if (double highWaterMark = stream->m_bunHighWaterMark; stream->m_bunHighWaterMarkIsNumber && highWaterMark > 0) {
            controller->m_buffer.tryReserve(std::min<size_t>(WebCore::directHighWaterMark(controller), maxDirectBufferReserve));
            controller->syncReportedCapacity(vm);
        }
        break;
    }
    case DirectSinkKind::Text: {
        controller->closingPromise().set(vm, controller, JSPromise::create(vm, globalObject->promiseStructure()));
        break;
    }
    case DirectSinkKind::Array: {
        JSArray* array = constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, );
        controller->m_array.set(vm, controller, array);
        controller->closingPromise().set(vm, controller, JSPromise::create(vm, globalObject->promiseStructure()));
        break;
    }
    }

    WebCore::installDirectControllerMethods(vm, globalObject, controller);
    RETURN_IF_EXCEPTION(scope, );

    stream->m_controller.set(vm, stream, controller);
    stream->m_controllerKind = ControllerKind::Direct;
    stream->m_directSource.clear();
    stream->m_bunMode = BunStreamMode::Default;
}

} // namespace WebStreams
} // namespace Bun
