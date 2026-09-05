#include "config.h"
#include "BunStreamConsumers.h"

#include "BufferEncodingType.h"
#include "BunClientData.h"
#include "BunObject.h"
#include "BunStandaloneTextSink.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "helpers.h"
#include "JSDOMFormData.h"
#include "JSDOMGlobalObject.h"
#include "JSDirectStreamController.h"
#include "JSOneShotDirectSink.h"
#include "JSReadableStreamIntoArrayOperation.h"
#include "JSReadRequest.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamsRuntime.h"
#include "ObjectBindings.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/ConstructData.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/Locker.h>
#include <wtf/Vector.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

using namespace JSC;
using Bun::WebStreams::analyzeBarrierEdge;

// JSBunStandaloneTextSink — the GENERIC toText accumulator cell (BunStandaloneTextSink.h).

const ClassInfo JSBunStandaloneTextSink::s_info = { "BunStandaloneTextSink"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunStandaloneTextSink) };

JSBunStandaloneTextSink::JSBunStandaloneTextSink(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSBunStandaloneTextSink::~JSBunStandaloneTextSink() = default;

void JSBunStandaloneTextSink::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSBunStandaloneTextSink* JSBunStandaloneTextSink::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSBunStandaloneTextSink>(vm)) JSBunStandaloneTextSink(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

void JSBunStandaloneTextSink::destroy(JSCell* cell)
{
    static_cast<JSBunStandaloneTextSink*>(cell)->JSBunStandaloneTextSink::~JSBunStandaloneTextSink();
}

Structure* JSBunStandaloneTextSink::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSBunStandaloneTextSink::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSBunStandaloneTextSink, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForBunStandaloneTextSink, m_subspaceForBunStandaloneTextSink));
}

DEFINE_VISIT_CHILDREN(JSBunStandaloneTextSink);

template<typename Visitor>
void JSBunStandaloneTextSink::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSBunStandaloneTextSink>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_accumulator.visit(locker, visitor);
}

void JSBunStandaloneTextSink::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSBunStandaloneTextSink>(cell);
    Base::analyzeHeap(cell, analyzer);
    WTF::Locker locker { thisObject->cellLock() };
    thisObject->m_accumulator.analyzeHeap(locker, cell, analyzer);
}

// JSOneShotDirectSink — consumeDirectStreamToArrayBuffer's throwaway controller cell.

const ClassInfo JSOneShotDirectSink::s_info = { "OneShotDirectSink"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSOneShotDirectSink) };

JSOneShotDirectSink::JSOneShotDirectSink(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSOneShotDirectSink::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSOneShotDirectSink* JSOneShotDirectSink::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSOneShotDirectSink>(vm)) JSOneShotDirectSink(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSOneShotDirectSink::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSOneShotDirectSink::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSOneShotDirectSink, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForOneShotDirectSink, m_subspaceForOneShotDirectSink));
}

DEFINE_VISIT_CHILDREN(JSOneShotDirectSink);

template<typename Visitor>
void JSOneShotDirectSink::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSOneShotDirectSink>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_arrayBufferSink);
    visitor.appendHidden(thisObject->m_capabilityPromise);
    visitor.appendHidden(thisObject->m_closeFunction);
}

void JSOneShotDirectSink::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSOneShotDirectSink>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_arrayBufferSink, "arrayBufferSink"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_capabilityPromise, "capabilityPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closeFunction, "closeFunction"_s);
}

// JSReadableStreamIntoArrayOperation — the queue-backed array pump's persistent state.

const ClassInfo JSReadableStreamIntoArrayOperation::s_info = { "ReadableStreamIntoArrayOperation"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamIntoArrayOperation) };

JSReadableStreamIntoArrayOperation::JSReadableStreamIntoArrayOperation(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamIntoArrayOperation::finishCreation(VM& vm, JSReadableStreamDefaultReader* reader, JSArray* chunks, JSPromise* result)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_reader.set(vm, this, reader);
    m_chunks.set(vm, this, chunks);
    m_result.set(vm, this, result);
}

JSReadableStreamIntoArrayOperation* JSReadableStreamIntoArrayOperation::create(VM& vm, Structure* structure, JSReadableStreamDefaultReader* reader, JSArray* chunks, JSPromise* result)
{
    auto* cell = new (NotNull, allocateCell<JSReadableStreamIntoArrayOperation>(vm)) JSReadableStreamIntoArrayOperation(vm, structure);
    cell->finishCreation(vm, reader, chunks, result);
    return cell;
}

Structure* JSReadableStreamIntoArrayOperation::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSReadableStreamIntoArrayOperation::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamIntoArrayOperation, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForReadableStreamIntoArrayOperation, m_subspaceForReadableStreamIntoArrayOperation));
}

DEFINE_VISIT_CHILDREN(JSReadableStreamIntoArrayOperation);

template<typename Visitor>
void JSReadableStreamIntoArrayOperation::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamIntoArrayOperation>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_reader);
    visitor.appendHidden(thisObject->m_chunks);
    visitor.appendHidden(thisObject->m_result);
}

void JSReadableStreamIntoArrayOperation::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamIntoArrayOperation>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_reader, "reader"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_chunks, "chunks"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_result, "result"_s);
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSBunStandaloneTextSink;
using WebCore::JSDirectStreamController;
using WebCore::JSOneShotDirectSink;
using WebCore::JSReadableStreamIntoArrayOperation;
using WebCore::JSReadRequest;
using WebCore::JSStreamsRuntime;

WTF::String withoutUTF8BOM(const WTF::String& string)
{
    if (string.length() && string[0] == 0xFEFF)
        return string.substring(1);
    return string;
}

// The generic toText result strip: the accumulator's rope-path strip followed by the
// end()-path strip of the sink pump this replaced (so "\uFEFF\uFEFF..." loses both).
static WTF::String stripTextResultBOM(const WTF::String& string)
{
    return withoutUTF8BOM(withoutUTF8BOM(string));
}

// UTF-8 size / write via the simdutf-backed Buffer encoders. Lone surrogates count (and
// write) as U+FFFD, so the pair always agrees; plain simdutf::utf8_length_from_utf16 does not.
static size_t utf8ByteLengthWithReplacement(const WTF::String& string)
{
    if (string.isEmpty())
        return 0;
    if (string.is8Bit())
        return Bun__encoding__byteLengthLatin1AsUTF8(string.span8().data(), string.span8().size());
    return Bun__encoding__byteLengthUTF16AsUTF8(string.span16().data(), string.span16().size());
}

static size_t writeUTF8(const WTF::String& string, std::span<uint8_t> destination)
{
    if (string.isEmpty())
        return 0;
    constexpr auto utf8 = static_cast<Encoding>(WebCore::BufferEncodingType::utf8);
    if (string.is8Bit())
        return Bun__encoding__writeLatin1(string.span8().data(), string.span8().size(), destination.data(), destination.size(), utf8);
    return Bun__encoding__writeUTF16(string.span16().data(), string.span16().size(), destination.data(), destination.size(), utf8);
}

bool appendUTF8WithinStringLimit(const WTF::String& string, WTF::Vector<uint8_t>& bytes)
{
    size_t byteLength = utf8ByteLengthWithReplacement(string);
    if (!byteLength)
        return true;
    size_t oldSize = bytes.size();
    // UTF-8 expansion can exceed any reserve taken from the code-unit estimate.
    if (exceedsStringLimit(oldSize + byteLength) || !bytes.tryGrow(oldSize + byteLength)) [[unlikely]]
        return false;
    size_t written = writeUTF8(string, bytes.mutableSpan().subspan(oldSize));
    // The sizer and writer must agree; never expose ungrown (uninitialized) bytes.
    ASSERT(written == byteLength);
    if (written < byteLength) [[unlikely]]
        bytes.shrink(oldSize + written);
    return true;
}

// `obj[name](...args)` with `this` = obj.
static JSValue invokeMethod(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* object, const Identifier& name, const MarkedArgumentBuffer& args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = object->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(method);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, makeString(name.string(), " is not a function"_s));
        return {};
    }
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, method, callData, object, args));
}

static JSC::JSUint8Array* encodeStringToUint8Array(JSC::VM& vm, JSGlobalObject* globalObject, JSValue stringValue)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String string = stringValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // The same simdutf sizer/writer pair the chunk appender uses: one sizing pass, one
    // encode straight into the result (no intermediate CString copy). The result is
    // buffer-backed from birth so a later `.buffer` access never has to change modes.
    size_t byteLength = utf8ByteLengthWithReplacement(string);
    RefPtr<JSC::ArrayBuffer> resultBuffer = JSC::ArrayBuffer::tryCreateUninitialized(byteLength, 1);
    if (!resultBuffer) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    if (byteLength) {
        size_t written = writeUTF8(string, { static_cast<uint8_t*>(resultBuffer->data()), byteLength });
        ASSERT_UNUSED(written, written == byteLength);
    }
    auto* structure = globalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>();
    RELEASE_AND_RETURN(scope, JSC::JSUint8Array::create(globalObject, structure, WTF::move(resultBuffer), 0, byteLength));
}

static bool appendChunkBytes(JSC::VM& vm, JSGlobalObject* globalObject, JSValue chunk, WTF::Vector<uint8_t>& bytes)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (chunk.isString()) {
        WTF::String string = asString(chunk)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        if (!appendUTF8WithinStringLimit(string, bytes)) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return false;
        }
        return true;
    }
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(chunk)) {
        if (!view->isDetached() && !bytes.tryAppend(view->span())) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return false;
        }
        return true;
    }
    if (auto* jsBuffer = dynamicDowncast<JSC::JSArrayBuffer>(chunk)) {
        if (auto* impl = jsBuffer->impl(); impl && !impl->isDetached()) {
            if (!bytes.tryAppend(impl->span())) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return false;
            }
        }
        return true;
    }
    throwTypeError(globalObject, scope, "Expected an ArrayBuffer, ArrayBufferView, or string chunk"_s);
    return false;
}

// The N-chunk concatenation shared by toArrayBuffer / toBytes (the concatArrayBuffers /
// ArrayBufferSink arms of RS:157-289 produce the same bytes; only the wrapper type differs).
static JSValue concatenateChunks(JSC::VM& vm, JSGlobalObject* globalObject, JSArray* chunks, bool asUint8Array)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    unsigned length = chunks->length();

    // ONE pass over the array: read each element exactly once, materialize each string
    // exactly once, and size the output as we go. `values` roots every chunk across the
    // string materializations; `stringChunks` carries each string and its UTF-8 size so
    // the write pass below never re-reads the array or re-encodes.
    MarkedArgumentBuffer values;
    WTF::Vector<std::pair<WTF::String, size_t>, 16> stringChunks;
    bool anyString = false;
    WTF::CheckedSize total = 0;
    for (unsigned i = 0; i < length; i++) {
        JSValue chunk = chunks->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        values.append(chunk);
        if (chunk.isString()) {
            anyString = true;
            WTF::String string = asString(chunk)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            size_t byteLength = utf8ByteLengthWithReplacement(string);
            total += byteLength;
            stringChunks.append({ WTF::move(string), byteLength });
            continue;
        }
        stringChunks.append({ WTF::String(), 0 });
        if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(chunk))
            total += view->isDetached() ? 0 : view->byteLength();
        else if (auto* jsBuffer = dynamicDowncast<JSC::JSArrayBuffer>(chunk)) {
            auto* impl = jsBuffer->impl();
            total += (impl && !impl->isDetached()) ? impl->byteLength() : 0;
        } else {
            throwTypeError(globalObject, scope, "Expected an ArrayBuffer, ArrayBufferView, or string chunk"_s);
            return {};
        }
    }
    if (values.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    // All-binary chunk arrays (the hot path) use `Bun.concatArrayBuffers`' single-allocation
    // concatenation, exactly as the previous implementation did.
    if (!anyString)
        RELEASE_AND_RETURN(scope, JSValue::decode(Bun::flattenArrayOfBuffersIntoArrayBufferOrUint8Array(globalObject, chunks, std::numeric_limits<size_t>::max(), asUint8Array)));

    if (total.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    WTF::Vector<uint8_t> bytes;
    bytes.reserveInitialCapacity(total.value());
    for (unsigned i = 0; i < length; i++) {
        auto& [string, stringByteLength] = stringChunks[i];
        if (!string.isNull()) {
            if (stringByteLength) {
                size_t oldSize = bytes.size();
                bytes.grow(oldSize + stringByteLength);
                size_t written = writeUTF8(string, bytes.mutableSpan().subspan(oldSize));
                // The sizer and writer must agree; never expose ungrown (uninitialized) bytes.
                ASSERT(written == stringByteLength);
                if (written < stringByteLength) [[unlikely]]
                    bytes.shrink(oldSize + written);
            }
            continue;
        }
        JSValue chunk = values.at(i);
        if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(chunk)) {
            if (!view->isDetached())
                bytes.append(view->span());
        } else if (auto* jsBuffer = dynamicDowncast<JSC::JSArrayBuffer>(chunk)) {
            if (auto* impl = jsBuffer->impl(); impl && !impl->isDetached())
                bytes.append(impl->span());
        }
    }
    if (asUint8Array) {
        // Buffer-backed from birth: a later `.buffer` access never has to change modes.
        RefPtr<JSC::ArrayBuffer> resultBuffer = JSC::ArrayBuffer::tryCreate(bytes.span());
        if (!resultBuffer) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        auto* structure = globalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>();
        RELEASE_AND_RETURN(scope, JSC::JSUint8Array::create(globalObject, structure, WTF::move(resultBuffer), 0, bytes.size()));
    }
    auto buffer = JSC::ArrayBuffer::tryCreate(bytes.span());
    if (!buffer) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    return JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(buffer));
}

static bool binaryChunkSpan(JSValue chunk, std::span<const uint8_t>& out)
{
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(chunk)) {
        if (!view->isDetached())
            out = view->span();
        return true;
    }
    if (auto* jsBuffer = dynamicDowncast<JSC::JSArrayBuffer>(chunk)) {
        if (auto* impl = jsBuffer->impl(); impl && !impl->isDetached())
            out = impl->span();
        return true;
    }
    return false;
}

// The toArrayBuffer chunk-array converter (RS:157-206).
static JSValue convertChunksToArrayBuffer(JSGlobalObject* globalObject, JSValue chunksValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* chunks = dynamicDowncast<JSArray>(chunksValue);
    if (!chunks) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected an array of chunks"_s);
        return {};
    }
    unsigned length = chunks->length();
    if (!length) {
        auto buffer = JSC::ArrayBuffer::tryCreate(size_t { 0 }, 1);
        if (!buffer) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        return JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(buffer));
    }
    if (length == 1) {
        JSValue chunk = chunks->getIndex(globalObject, 0);
        RETURN_IF_EXCEPTION(scope, {});
        std::span<const uint8_t> span;
        if (binaryChunkSpan(chunk, span)) {
            auto copied = JSC::ArrayBuffer::tryCreate(span);
            if (!copied) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            return JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(copied));
        }
        if (chunk.isString())
            RELEASE_AND_RETURN(scope, encodeStringToUint8Array(vm, globalObject, chunk));
    }
    RELEASE_AND_RETURN(scope, concatenateChunks(vm, globalObject, chunks, /* asUint8Array */ false));
}

// The toBytes chunk-array converter (RS:238-283).
static JSValue convertChunksToBytes(JSGlobalObject* globalObject, JSValue chunksValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* chunks = dynamicDowncast<JSArray>(chunksValue);
    if (!chunks) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected an array of chunks"_s);
        return {};
    }
    auto* structure = globalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>();
    unsigned length = chunks->length();
    if (!length)
        RELEASE_AND_RETURN(scope, JSC::JSUint8Array::create(globalObject, structure, size_t { 0 }));
    if (length == 1) {
        JSValue chunk = chunks->getIndex(globalObject, 0);
        RETURN_IF_EXCEPTION(scope, {});
        std::span<const uint8_t> span;
        if (binaryChunkSpan(chunk, span)) {
            auto copied = JSC::ArrayBuffer::tryCreate(span);
            if (!copied) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            RELEASE_AND_RETURN(scope, JSC::JSUint8Array::create(globalObject, structure, WTF::move(copied), 0, span.size()));
        }
        if (chunk.isString())
            RELEASE_AND_RETURN(scope, encodeStringToUint8Array(vm, globalObject, chunk));
    }
    RELEASE_AND_RETURN(scope, concatenateChunks(vm, globalObject, chunks, /* asUint8Array */ true));
}

static JSValue textAccumulatorWrite(JSC::VM& vm, JSGlobalObject*, JSC::JSObject* owner, BunTextAccumulator&, JSValue chunk);
static WTF::String finishTextAccumulator(JSC::VM& vm, JSGlobalObject*, JSC::JSObject* owner, BunTextAccumulator&);

// The chunk-array -> text conversion: pure-string arrays join once (no UTF-8 round trip);
// mixed/binary chunk arrays run through the shared text accumulator.
static JSValue convertChunksToText(JSGlobalObject* globalObject, JSValue chunksValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* chunks = dynamicDowncast<JSArray>(chunksValue);
    if (!chunks) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected an array of chunks"_s);
        return {};
    }
    unsigned length = chunks->length();
    if (!length)
        return jsEmptyString(vm);

    if (length == 1) {
        JSValue chunk = chunks->getIndex(globalObject, 0);
        RETURN_IF_EXCEPTION(scope, {});
        if (chunk.isString()) {
            WTF::String string = asString(chunk)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            WTF::String stripped = stripTextResultBOM(string);
            if (stripped.impl() == string.impl())
                return chunk;
            RELEASE_AND_RETURN(scope, jsString(vm, stripped));
        }
        std::span<const uint8_t> span;
        if (binaryChunkSpan(chunk, span)) {
            if (exceedsStringLimit(span.size())) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            WTF::String text = Zig::convertUTF8ToString(span);
            if (text.isNull() && !span.empty()) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return {};
            }
            RELEASE_AND_RETURN(scope, jsString(vm, withoutUTF8BOM(text)));
        }
    }

    // ONE pass over the array: every element is read exactly once and held in a
    // MarkedArgumentBuffer for the conversion below.
    MarkedArgumentBuffer values;
    bool allStrings = true;
    WTF::CheckedUint32 codeUnits = 0;
    for (unsigned i = 0; i < length; i++) {
        JSValue chunk = chunks->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        values.append(chunk);
        if (!chunk.isString())
            allStrings = false;
        else if (allStrings)
            codeUnits += asString(chunk)->length();
    }
    if (values.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    if (allStrings) {
        if (codeUnits.hasOverflowed() || exceedsStringLimit(codeUnits.value())) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        WTF::StringBuilder rope;
        rope.reserveCapacity(codeUnits.value());
        for (unsigned i = 0; i < length; i++) {
            WTF::String string = asString(values.at(i))->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            rope.append(string);
        }
        if (rope.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        RELEASE_AND_RETURN(scope, jsString(vm, stripTextResultBOM(rope.toString())));
    }

    // Mixed string/binary chunks: drive the shared accumulator so adjacent-string rope
    // joining, the flush-on-buffer ordering, and both BOM strips stay identical.
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* sink = WebCore::JSBunStandaloneTextSink::create(vm, runtime->standaloneTextSinkStructure(domGlobalObject));
    for (unsigned i = 0; i < length; i++) {
        textAccumulatorWrite(vm, globalObject, sink, sink->m_accumulator, values.at(i));
        RETURN_IF_EXCEPTION(scope, {});
    }
    WTF::String text = finishTextAccumulator(vm, globalObject, sink, sink->m_accumulator);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, jsString(vm, withoutUTF8BOM(text)));
}

static JSObject* createLockedError(JSGlobalObject* globalObject)
{
    return Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream is locked"_s);
}

// Consuming an already-consumed (disturbed, no longer locked) stream must reject
// instead of resolving with an empty result: https://github.com/oven-sh/bun/issues/6860
static JSObject* createAlreadyUsedError(JSGlobalObject* globalObject)
{
    return Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: ReadableStream has already been used"_s);
}

// The one shared `BunTextAccumulator` write arm (createTextStream.write, RSI:1411-1441).
static JSValue textAccumulatorWrite(JSC::VM& vm, JSGlobalObject* globalObject, JSC::JSObject* owner, BunTextAccumulator& accumulator, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (chunk.isString()) {
        WTF::String string = asString(chunk)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        unsigned length = string.length();
        if (length) {
            accumulator.rope.append(string);
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
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(chunk))
        byteLength = view->isDetached() ? 0 : view->byteLength();
    else if (auto* jsBuffer = dynamicDowncast<JSC::JSArrayBuffer>(chunk)) {
        auto* impl = jsBuffer->impl();
        byteLength = impl ? impl->byteLength() : 0;
    } else {
        throwTypeError(globalObject, scope, "Expected text, ArrayBuffer or ArrayBufferView"_s);
        return {};
    }
    if (byteLength) {
        accumulator.hasBuffer = true;
        JSC::JSString* flushedRope = nullptr;
        if (accumulator.rope.length()) {
            flushedRope = jsString(vm, accumulator.rope.toString());
            RETURN_IF_EXCEPTION(scope, {});
            accumulator.rope.clear();
        }
        WTF::Locker locker { owner->cellLock() };
        if (flushedRope)
            accumulator.pieces.append(JSC::WriteBarrier<JSC::Unknown>(vm, owner, flushedRope));
        accumulator.pieces.append(JSC::WriteBarrier<JSC::Unknown>(vm, owner, chunk));
    }
    accumulator.estimatedLength += byteLength;
    return jsNumber(static_cast<double>(byteLength));
}

// createTextStream.finishInternal (RSI:1463-1501). Does NOT strip the leading UTF-8 BOM on
// the buffer / mixed paths (only the pure-string rope path strips it) — see withoutUTF8BOM.
static WTF::String finishTextAccumulator(JSC::VM& vm, JSGlobalObject* globalObject, JSC::JSObject* owner, BunTextAccumulator& accumulator)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Once the result is materialized nothing may keep the accumulated payload alive:
    // release at every return below (the owner can outlive this call by a lot).
    auto releaseAccumulated = [&] {
        WTF::Locker locker { owner->cellLock() };
        accumulator.reset(locker);
    };
    const bool hasString = accumulator.hasString;
    const bool hasBuffer = accumulator.hasBuffer;
    if (!hasString && !hasBuffer)
        return WTF::emptyString();
    if (hasString && !hasBuffer) {
        if (exceedsStringLimit(accumulator.rope.length())) [[unlikely]] {
            releaseAccumulated();
            throwOutOfMemoryError(globalObject, scope);
            return WTF::String();
        }
        WTF::String rope = accumulator.rope.toString();
        releaseAccumulated();
        if (rope.length() && rope[0] == 0xFEFF)
            return rope.substring(1);
        return rope;
    }
    // estimatedLength never overcounts the bytes, so an estimate past the limit is final.
    const double estimatedLength = accumulator.estimatedLength;
    if (estimatedLength > static_cast<double>(WTF::StringImpl::MaxLength)
        || exceedsStringLimit(static_cast<size_t>(estimatedLength))) [[unlikely]] {
        releaseAccumulated();
        throwOutOfMemoryError(globalObject, scope);
        return WTF::String();
    }
    WTF::Vector<uint8_t> bytes;
    if (estimatedLength > 0 && !bytes.tryReserveInitialCapacity(static_cast<size_t>(estimatedLength))) [[unlikely]] {
        releaseAccumulated();
        throwOutOfMemoryError(globalObject, scope);
        return WTF::String();
    }
    for (auto& piece : accumulator.pieces) {
        JSValue value = piece.get();
        if (!value)
            continue;
        bool appended = appendChunkBytes(vm, globalObject, value, bytes);
        if (scope.exception() || !appended) [[unlikely]] {
            releaseAccumulated();
            return WTF::String();
        }
    }
    if (accumulator.rope.length()) {
        WTF::String rope = accumulator.rope.toString();
        if (rope[0] == 0xFEFF)
            rope = rope.substring(1);
        if (!appendUTF8WithinStringLimit(rope, bytes)) [[unlikely]] {
            releaseAccumulated();
            throwOutOfMemoryError(globalObject, scope);
            return WTF::String();
        }
    }
    releaseAccumulated();
    if (exceedsStringLimit(bytes.size())) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return WTF::String();
    }
    WTF::String text = Zig::convertUTF8ToString(bytes.span());
    if (text.isNull() && !bytes.isEmpty()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return WTF::String();
    }
    return text;
}

// reader.read() as a Promise-kind read request.
static JSPromise* readerReadAsPromise(JSC::VM& vm, JSGlobalObject* globalObject, WebCore::JSReadableStreamDefaultReader* reader)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    auto* request = JSReadRequest::create(vm, runtime->readRequestStructure(domGlobalObject), ReadRequestKind::Promise, promise);
    readableStreamDefaultReaderRead(globalObject, reader, request);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return promise;
}

// The readableStreamIntoArray readMany continuation. Runs synchronously until readMany
// returns a promise, then chains the next hop onto a fresh derived promise it returns.
static JSValue intoArrayLoop(JSC::VM& vm, JSGlobalObject* globalObject, WebCore::JSReadableStreamDefaultReader* reader, JSArray* __restrict chunks, JSValue manyResult)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    JSValue many = manyResult;
    while (true) {
        if (auto* manyPromise = dynamicDowncast<JSPromise>(many)) {
            auto* context = InternalFieldTuple::create(vm, domGlobalObject->internalFieldTupleStructure(), reader, chunks);
            auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
            manyPromise->performPromiseThenWithContext(vm, globalObject, runtime->onIntoArrayReadManyFulfilled(), runtime->onIntoArrayReadManyRejected(), derived, context);
            return derived;
        }
        JSObject* result = many.getObject();
        if (!result) [[unlikely]] {
            throwTypeError(globalObject, scope, "readMany() did not return an object"_s);
            return {};
        }
        auto [doneValue, value] = runtime->readManyResult(globalObject, result);
        RETURN_IF_EXCEPTION(scope, {});
        if (auto* valueArray = dynamicDowncast<JSArray>(value)) {
            unsigned valueLength = valueArray->length();
            for (unsigned i = 0; i < valueLength; i++) {
                JSValue element = valueArray->getIndex(globalObject, i);
                RETURN_IF_EXCEPTION(scope, {});
                chunks->push(globalObject, element);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
        if (doneValue.toBoolean(globalObject)) {
            readableStreamDefaultReaderRelease(globalObject, reader);
            RETURN_IF_EXCEPTION(scope, {});
            return chunks;
        }
        many = readableStreamDefaultReaderReadMany(globalObject, reader);
        RETURN_IF_EXCEPTION(scope, {});
    }
}

JSValue readableStreamIntoArray(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    stream->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* reader = acquireReadableStreamDefaultReader(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    auto* chunks = constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    const ControllerKind controllerKind = stream->m_controllerKind;
    bool isQueueBacked = controllerKind == ControllerKind::Default || controllerKind == ControllerKind::Byte;
    // From here on this returns a promise (promiseFromSteps): readMany() throwing synchronously on an
    // already-errored stream, a getter throwing while draining, are its rejection.
    RELEASE_AND_RETURN(scope, promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!isQueueBacked) {
            // Direct (and controller-less) streams keep the generic readMany loop.
            JSValue many = readableStreamDefaultReaderReadMany(globalObject, reader);
            RETURN_IF_EXCEPTION(scope, nullptr);
            JSValue result = intoArrayLoop(vm, globalObject, reader, chunks, many);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (auto* promise = dynamicDowncast<JSPromise>(result))
                return promise;
            RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, result));
        }
        // Queue-backed streams: one persistent op {reader, chunks, result promise} carries the
        // pump across every read, so a pending hop costs one reaction registration and nothing else.
        JSPromise* pendingRead = nullptr;
        ConsumerFillStep step = readableStreamDefaultReaderFillFromQueue(globalObject, reader, chunks, &pendingRead);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (step == ConsumerFillStep::Done) {
            readableStreamDefaultReaderRelease(globalObject, reader);
            RETURN_IF_EXCEPTION(scope, nullptr);
            RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, chunks));
        }
        auto* domGlobalObject = defaultGlobalObject(globalObject);
        auto* runtime = JSStreamsRuntime::from(globalObject);
        auto* resultPromise = JSPromise::create(vm, globalObject->promiseStructure());
        auto* op = JSReadableStreamIntoArrayOperation::create(vm, runtime->intoArrayOperationStructure(domGlobalObject), reader, chunks, resultPromise);
        pendingRead->performPromiseThenWithContext(vm, globalObject, runtime->onIntoArrayReadFulfilled(), runtime->onIntoArrayReadRejected(), jsUndefined(), op);
        RETURN_IF_EXCEPTION(scope, nullptr);
        return resultPromise;
    }));
}

enum class ChunkArrayConversion : uint8_t { ArrayBuffer,
    Bytes,
    Text };
static JSValue convertChunkArrayPromise(JSC::VM& vm, JSGlobalObject*, JSValue arrayResult, ChunkArrayConversion);

JSValue readableStreamIntoText(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue arrayResult = readableStreamIntoArray(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, convertChunkArrayPromise(vm, globalObject, arrayResult, ChunkArrayConversion::Text));
}

// The buffered-native fast path (RSI:1240-1268).
JSValue tryUseReadableStreamBufferedFastPath(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream, const Identifier& method)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue nativePtr = stream->nativePtrForJS();
    if (!nativePtr || !nativePtr.isCell())
        return {};
    JSObject* handle = nativePtr.getObject();
    if (!handle)
        return {};
    if (stream->nativeSourceConsumed())
        return {};
    JSValue methodValue = handle->get(globalObject, method);
    RETURN_IF_EXCEPTION(scope, {});
    if (!methodValue.isCallable())
        return {};
    auto callData = JSC::getCallData(methodValue);
    MarkedArgumentBuffer noArguments;
    JSValue promiseValue = JSC::call(globalObject, methodValue, callData, handle, noArguments);
    // If the native call throws, propagate WITHOUT setting m_disturbed.
    RETURN_IF_EXCEPTION(scope, {});
    stream->m_disturbed = true;
    stream->m_bunMode = BunStreamMode::Default;
    stream->m_lockedWithoutReader = true;
    auto* promise = dynamicDowncast<JSPromise>(promiseValue);
    if (!promise) [[unlikely]]
        return promiseValue;
    if (promise->status() == JSPromise::Status::Fulfilled) {
        stream->m_lockedWithoutReader = false;
        readableStreamCloseIfPossible(globalObject, stream);
        RETURN_IF_EXCEPTION(scope, {});
        return promise;
    }
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
    promise->performPromiseThenWithContext(vm, globalObject, runtime->onBufferedFastPathSettled(), runtime->onBufferedFastPathRejected(), derived, stream);
    return derived;
}

// The direct read loop shared by readableStreamTo{Text,Array}Direct.
// context tuple = { stream, reader }.

static JSValue finishDirectConsumeLoop(JSC::VM& vm, JSGlobalObject* globalObject, WebCore::JSReadableStream* stream, WebCore::JSReadableStreamDefaultReader* reader)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (reader->m_stream) {
        readableStreamDefaultReaderRelease(globalObject, reader);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (stream->m_controllerKind == ControllerKind::Direct) {
        const auto* controller = uncheckedDowncast<JSDirectStreamController>(stream->m_controller.get());
        if (controller->m_closingPromise)
            return controller->m_closingPromise.get();
    }
    return jsUndefined();
}

static JSValue directConsumeLoopStep(JSC::VM& vm, JSGlobalObject* globalObject, InternalFieldTuple* context)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = uncheckedDowncast<WebCore::JSReadableStream>(context->getInternalField(0));
    auto* reader = uncheckedDowncast<WebCore::JSReadableStreamDefaultReader>(context->getInternalField(1));
    if (stream->m_state != ReadableStreamState::Readable)
        RELEASE_AND_RETURN(scope, finishDirectConsumeLoop(vm, globalObject, stream, reader));
    auto* readPromise = readerReadAsPromise(vm, globalObject, reader);
    RETURN_IF_EXCEPTION(scope, {});
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
    readPromise->performPromiseThenWithContext(vm, globalObject, runtime->onDirectConsumeLoopReadFulfilled(), runtime->onDirectConsumeLoopReadRejected(), derived, context);
    return derived;
}

static JSValue consumeDirectStreamBody(JSC::VM& vm, JSGlobalObject* globalObject, WebCore::JSReadableStream* stream, DirectSinkKind kind)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    setUpDirectStreamController(globalObject, stream, kind, stream->m_bunHighWaterMark);
    RETURN_IF_EXCEPTION(scope, {});
    stream->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* reader = acquireReadableStreamDefaultReader(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    auto* context = InternalFieldTuple::create(vm, defaultGlobalObject(globalObject)->internalFieldTupleStructure(), stream, reader);
    RELEASE_AND_RETURN(scope, directConsumeLoopStep(vm, globalObject, context));
}

// This returns a promise (promiseFromSteps): every synchronous abrupt completion is its rejection.
static JSValue consumeDirectStream(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream, DirectSinkKind kind)
{
    return promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto& vm = getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue result = consumeDirectStreamBody(vm, globalObject, stream, kind);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (auto* promise = dynamicDowncast<JSPromise>(result))
            return promise;
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, result));
    });
}

JSValue readableStreamToTextDirect(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    return consumeDirectStream(globalObject, stream, DirectSinkKind::Text);
}

JSValue readableStreamToArrayDirect(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    return consumeDirectStream(globalObject, stream, DirectSinkKind::Array);
}

// The one-shot direct → ArrayBuffer/Uint8Array conversion (RSI:2474-2554).

static JSObject* createOneShotBoundMethod(JSC::VM& vm, JSGlobalObject* globalObject, JSFunction* target, JSValue contextArgument, unsigned length, ASCIILiteral name)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer boundArguments;
    boundArguments.append(contextArgument);
    SourceCode source = makeSource(WTF::String(name), SourceOrigin(), SourceTaintedOrigin::Untainted);
    JSString* boundName = jsString(vm, WTF::String(name));
    RELEASE_AND_RETURN(scope, JSBoundFunction::create(vm, globalObject, target, jsUndefined(), ArgList(boundArguments), length, boundName, source));
}

static void installOneShotMethods(JSC::VM& vm, JSGlobalObject* globalObject, JSOneShotDirectSink* sink)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* startMethod = createOneShotBoundMethod(vm, globalObject, runtime->boundOneShotStart(), sink, 0, "start"_s);
    RETURN_IF_EXCEPTION(scope, );
    sink->putDirect(vm, builtinNames(vm).startPublicName(), startMethod, 0);
    auto* writeMethod = createOneShotBoundMethod(vm, globalObject, runtime->boundOneShotDirectWrite(), sink, 1, "write"_s);
    RETURN_IF_EXCEPTION(scope, );
    sink->putDirect(vm, builtinNames(vm).writePublicName(), writeMethod, 0);
    auto* endMethod = createOneShotBoundMethod(vm, globalObject, runtime->boundOneShotDirectClose(), sink, 0, "end"_s);
    RETURN_IF_EXCEPTION(scope, );
    sink->putDirect(vm, builtinNames(vm).endPublicName(), endMethod, 0);
    auto* closeMethod = createOneShotBoundMethod(vm, globalObject, runtime->boundOneShotDirectClose(), sink, 1, "close"_s);
    RETURN_IF_EXCEPTION(scope, );
    sink->putDirect(vm, builtinNames(vm).closePublicName(), closeMethod, 0);
    auto* flushMethod = createOneShotBoundMethod(vm, globalObject, runtime->boundOneShotDirectFlush(), sink, 0, "flush"_s);
    RETURN_IF_EXCEPTION(scope, );
    sink->putDirect(vm, builtinNames(vm).flushPublicName(), flushMethod, 0);
}

// Calls the user's pull(oneShotController) exactly once (its own scope so the caller may
// catch the abrupt completion).
static JSValue oneShotCallPull(JSC::VM& vm, JSGlobalObject* globalObject, JSValue pullFunction, JSOneShotDirectSink* sink)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto callData = JSC::getCallData(pullFunction);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "The 'pull' method of a direct ReadableStream's underlying source is not a function"_s);
        return {};
    }
    MarkedArgumentBuffer arguments;
    arguments.append(sink);
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, pullFunction, callData, jsUndefined(), arguments));
}

JSValue consumeDirectStreamToArrayBuffer(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream, bool asUint8Array)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);

    JSObject* underlyingSource = stream->m_directUnderlyingSource.get();
    if (!underlyingSource) [[unlikely]]
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));

    MarkedArgumentBuffer noArguments;
    JSObject* arrayBufferSink = JSC::construct(globalObject, domGlobalObject->ArrayBufferSink(), noArguments, "ArrayBufferSink is not constructible"_s);
    RETURN_IF_EXCEPTION(scope, {});

    stream->m_directUnderlyingSource.clear();
    stream->m_bunMode = BunStreamMode::Default;
    stream->m_lockedWithoutReader = true;
    stream->m_disturbed = true;

    JSObject* startOptions = constructEmptyObject(globalObject);
    const double bunHighWaterMark = stream->m_bunHighWaterMark;
    bool hasNumericHighWaterMark = stream->m_bunHighWaterMarkIsNumber || !std::isnan(bunHighWaterMark);
    startOptions->putDirect(vm, builtinNames(vm).highWaterMarkPublicName(), hasNumericHighWaterMark ? jsNumber(bunHighWaterMark) : jsUndefined());
    startOptions->putDirect(vm, builtinNames(vm).asUint8ArrayPublicName(), jsBoolean(asUint8Array));
    MarkedArgumentBuffer startArguments;
    startArguments.append(startOptions);
    invokeMethod(vm, globalObject, arrayBufferSink, builtinNames(vm).startPublicName(), startArguments);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue pullFunction = underlyingSource->get(globalObject, builtinNames(vm).pullPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    JSValue closeFunction = underlyingSource->get(globalObject, builtinNames(vm).closePublicName());
    RETURN_IF_EXCEPTION(scope, {});

    auto* capability = JSPromise::create(vm, globalObject->promiseStructure());
    auto* sink = JSOneShotDirectSink::create(vm, runtime->oneShotDirectSinkStructure(domGlobalObject));
    sink->m_stream.set(vm, sink, stream);
    sink->m_arrayBufferSink.set(vm, sink, arrayBufferSink);
    sink->m_capabilityPromise.set(vm, sink, capability);
    sink->m_asUint8Array = asUint8Array;
    sink->m_closeFunction.set(vm, sink, closeFunction);
    installOneShotMethods(vm, globalObject, sink);
    RETURN_IF_EXCEPTION(scope, {});

    // The boundary into the direct source's pull(): its completion is converted here — a synchronous
    // throw errors the stream and rejects the returned promise; a returned promise's rejection is
    // handled by its reaction.
    JSValue firstPull = oneShotCallPull(vm, globalObject, pullFunction, sink);
    if (JSC::Exception* exception = scope.exception()) {
        TRY_CLEAR_EXCEPTION(scope, {});
        stream->m_lockedWithoutReader = false;
        // pull() may already have errored the stream through the sink before throwing.
        if (stream->m_state == ReadableStreamState::Readable) {
            readableStreamError(globalObject, stream, exception->value());
            RETURN_IF_EXCEPTION(scope, {});
        }
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, exception->value()));
    }
    if (auto* pullPromise = dynamicDowncast<JSPromise>(firstPull)) {
        auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
        pullPromise->performPromiseThenWithContext(vm, globalObject, runtime->onConsumeDirectToArrayBufferPullFulfilled(), runtime->onConsumeDirectToArrayBufferPullRejected(), derived, sink);
        return derived;
    }
    // A synchronous (non-promise) producer: close the stream and return the capability.
    stream->m_lockedWithoutReader = false;
    readableStreamCloseIfPossible(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return capability;
}

// Bun.readableStreamTo* — each function's check order is observable; do not reorder.

JSValue readableStreamToText(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (stream->m_bunMode == BunStreamMode::DirectPending)
        RELEASE_AND_RETURN(scope, readableStreamToTextDirect(globalObject, stream));
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));
    if (stream->m_disturbed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createAlreadyUsedError(globalObject)));
    JSValue fastPath = tryUseReadableStreamBufferedFastPath(globalObject, stream, builtinNames(vm).textPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    if (fastPath)
        return fastPath;
    RELEASE_AND_RETURN(scope, readableStreamIntoText(globalObject, stream));
}

JSValue readableStreamToArray(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (stream->m_bunMode == BunStreamMode::DirectPending)
        RELEASE_AND_RETURN(scope, readableStreamToArrayDirect(globalObject, stream));
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));
    if (stream->m_disturbed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createAlreadyUsedError(globalObject)));
    RELEASE_AND_RETURN(scope, readableStreamIntoArray(globalObject, stream));
}

// The chunk arrays these conversions consume are built by the array pump and never escape
// to user code; empty the array once converted so the per-chunk buffers die at the next
// collection instead of living as long as the settled reaction cells.
static void releaseInternalChunkArray(JSGlobalObject* globalObject, JSValue chunksValue)
{
    if (auto* array = dynamicDowncast<JSArray>(chunksValue))
        array->setLength(globalObject, 0);
}

static JSValue convertChunks(JSGlobalObject* globalObject, JSValue chunks, ChunkArrayConversion kind)
{
    switch (kind) {
    case ChunkArrayConversion::ArrayBuffer:
        return convertChunksToArrayBuffer(globalObject, chunks);
    case ChunkArrayConversion::Bytes:
        return convertChunksToBytes(globalObject, chunks);
    case ChunkArrayConversion::Text:
        return convertChunksToText(globalObject, chunks);
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// Shared toArrayBuffer/toBytes/toText tail: preserve the fulfilled-promise peek (RS:207-213).
static JSValue convertChunkArrayPromise(JSC::VM& vm, JSGlobalObject* globalObject, JSValue arrayResult, ChunkArrayConversion kind)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* arrayPromise = dynamicDowncast<JSPromise>(arrayResult);
    if (!arrayPromise) [[unlikely]]
        return arrayResult;
    auto* runtime = JSStreamsRuntime::from(globalObject);
    if (arrayPromise->status() == JSPromise::Status::Fulfilled) {
        auto convertNow = [&] -> JSPromise* {
            auto scope = DECLARE_THROW_SCOPE(vm);
            JSValue converted = convertChunks(globalObject, arrayPromise->result(), kind);
            RETURN_IF_EXCEPTION(scope, nullptr);
            releaseInternalChunkArray(globalObject, arrayPromise->result());
            RETURN_IF_EXCEPTION(scope, nullptr);
            auto* fulfilled = JSPromise::create(vm, globalObject->promiseStructure());
            fulfilled->fulfill(vm, converted);
            return fulfilled;
        };
        // Text consumers are promise-returning: a synchronous conversion failure rejects. The buffer
        // consumers have always thrown it synchronously.
        if (kind == ChunkArrayConversion::Text)
            RELEASE_AND_RETURN(scope, promiseFromSteps(globalObject, convertNow));
        RELEASE_AND_RETURN(scope, convertNow());
    }
    JSFunction* onFulfilled = nullptr;
    switch (kind) {
    case ChunkArrayConversion::ArrayBuffer:
        onFulfilled = runtime->onReadableStreamToArrayBufferFulfilled();
        break;
    case ChunkArrayConversion::Bytes:
        onFulfilled = runtime->onReadableStreamToBytesFulfilled();
        break;
    case ChunkArrayConversion::Text:
        onFulfilled = runtime->onReadableStreamToTextChunksFulfilled();
        break;
    }
    auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
    arrayPromise->performPromiseThenWithContext(vm, globalObject, onFulfilled, jsUndefined(), derived, jsUndefined());
    return derived;
}

JSValue readableStreamToArrayBuffer(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (stream->m_bunMode == BunStreamMode::DirectPending)
        RELEASE_AND_RETURN(scope, consumeDirectStreamToArrayBuffer(globalObject, stream, /* asUint8Array */ false));
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));
    if (stream->m_disturbed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createAlreadyUsedError(globalObject)));
    JSValue fastPath = tryUseReadableStreamBufferedFastPath(globalObject, stream, builtinNames(vm).arrayBufferPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    if (fastPath)
        return fastPath;
    JSValue arrayResult = readableStreamToArray(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, convertChunkArrayPromise(vm, globalObject, arrayResult, ChunkArrayConversion::ArrayBuffer));
}

JSValue readableStreamToBytes(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (stream->m_bunMode == BunStreamMode::DirectPending)
        RELEASE_AND_RETURN(scope, consumeDirectStreamToArrayBuffer(globalObject, stream, /* asUint8Array */ true));
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));
    if (stream->m_disturbed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createAlreadyUsedError(globalObject)));
    JSValue fastPath = tryUseReadableStreamBufferedFastPath(globalObject, stream, builtinNames(vm).bytesPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    if (fastPath)
        return fastPath;
    JSValue arrayResult = readableStreamToArray(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, convertChunkArrayPromise(vm, globalObject, arrayResult, ChunkArrayConversion::Bytes));
}

JSValue readableStreamToJSON(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));
    if (stream->m_disturbed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createAlreadyUsedError(globalObject)));
    JSValue fastPath = tryUseReadableStreamBufferedFastPath(globalObject, stream, builtinNames(vm).jsonPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    if (fastPath)
        return fastPath;
    JSValue textResult = readableStreamToText(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    auto* textPromise = dynamicDowncast<JSPromise>(textResult);
    if (!textPromise) [[unlikely]]
        return textResult;
    auto* runtime = JSStreamsRuntime::from(globalObject);
    if (textPromise->status() == JSPromise::Status::Fulfilled) {
        // .json() returns a promise (promiseFromSteps): a parse failure is its rejection.
        RELEASE_AND_RETURN(scope, promiseFromSteps(globalObject, [&] -> JSPromise* {
            auto scope = DECLARE_THROW_SCOPE(vm);
            WTF::String text = textPromise->result().toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, nullptr);
            JSValue parsed = JSONParseWithException(globalObject, text);
            RETURN_IF_EXCEPTION(scope, nullptr);
            auto* fulfilled = JSPromise::create(vm, globalObject->promiseStructure());
            fulfilled->fulfill(vm, parsed);
            return fulfilled;
        }));
    }
    auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
    textPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReadableStreamToJSONFulfilled(), jsUndefined(), derived, jsUndefined());
    return derived;
}

JSValue readableStreamToBlob(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));
    if (stream->m_disturbed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createAlreadyUsedError(globalObject)));
    JSValue fastPath = tryUseReadableStreamBufferedFastPath(globalObject, stream, builtinNames(vm).blobPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    if (fastPath)
        return fastPath;
    JSValue arrayResult = readableStreamToArray(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    auto* arrayPromise = dynamicDowncast<JSPromise>(arrayResult);
    if (!arrayPromise) [[unlikely]] {
        arrayPromise = promiseFulfilledWith(globalObject, arrayResult);
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
    arrayPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReadableStreamToBlobFulfilled(), jsUndefined(), derived, jsUndefined());
    return derived;
}

JSValue readableStreamToFormData(JSGlobalObject* globalObject, WebCore::JSReadableStream* stream, JSValue contentType)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (isReadableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createLockedError(globalObject)));
    if (stream->m_disturbed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createAlreadyUsedError(globalObject)));
    JSValue blobResult = readableStreamToBlob(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    auto* blobPromise = dynamicDowncast<JSPromise>(blobResult);
    if (!blobPromise) [[unlikely]] {
        blobPromise = promiseFulfilledWith(globalObject, blobResult);
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
    blobPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReadableStreamToFormDataFulfilled(), jsUndefined(), derived, contentType);
    return derived;
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

// The js2native host-function surface (BunStreamConsumers.h).

JSC_DEFINE_HOST_FUNCTION(jsFunctionReadableStreamToText, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue streamValue = callFrame->argument(0);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readableStreamToText(globalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReadableStreamToArray, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue streamValue = callFrame->argument(0);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readableStreamToArray(globalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReadableStreamToArrayBuffer, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue streamValue = callFrame->argument(0);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readableStreamToArrayBuffer(globalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReadableStreamToBytes, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue streamValue = callFrame->argument(0);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readableStreamToBytes(globalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReadableStreamToJSON, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue streamValue = callFrame->argument(0);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readableStreamToJSON(globalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReadableStreamToBlob, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue streamValue = callFrame->argument(0);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readableStreamToBlob(globalObject, stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionReadableStreamToFormData, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue streamValue = callFrame->argument(0);
    auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "stream"_s, "ReadableStream"_s, streamValue);
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::readableStreamToFormData(globalObject, stream, callFrame->argument(1))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTransferToNativeReadableStream, (JSGlobalObject*, CallFrame* callFrame))
{
    if (auto* stream = dynamicDowncast<JSReadableStream>(callFrame->argument(0))) {
        stream->m_transferred = true;
        stream->m_disturbed = true;
    }
    return JSValue::encode(jsUndefined());
}

// [reaction-convention] handlers (FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_CONSUMERS).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onBufferedFastPathRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = uncheckedDowncast<JSReadableStream>(callFrame->uncheckedArgument(1));
    JSValue error = callFrame->argument(0);
    stream->m_lockedWithoutReader = false;
    auto* cancelPromise = Bun::WebStreams::readableStreamCancel(globalObject, stream, error);
    RETURN_IF_EXCEPTION(scope, {});
    if (cancelPromise)
        Bun::WebStreams::markPromiseAsHandled(vm, cancelPromise);
    Bun::WebStreams::readableStreamCloseIfPossible(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    throwException(globalObject, scope, error);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onBufferedFastPathSettled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = uncheckedDowncast<JSReadableStream>(callFrame->uncheckedArgument(1));
    stream->m_lockedWithoutReader = false;
    Bun::WebStreams::readableStreamCloseIfPossible(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(callFrame->argument(0));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadableStreamToArrayBufferFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue chunksValue = callFrame->argument(0);
    JSValue result = Bun::WebStreams::convertChunksToArrayBuffer(globalObject, chunksValue);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::WebStreams::releaseInternalChunkArray(globalObject, chunksValue);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadableStreamToBytesFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue chunksValue = callFrame->argument(0);
    JSValue result = Bun::WebStreams::convertChunksToBytes(globalObject, chunksValue);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::WebStreams::releaseInternalChunkArray(globalObject, chunksValue);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadableStreamToTextChunksFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue chunksValue = callFrame->argument(0);
    JSValue result = Bun::WebStreams::convertChunksToText(globalObject, chunksValue);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::WebStreams::releaseInternalChunkArray(globalObject, chunksValue);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadableStreamToJSONFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String text = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(JSONParseWithException(globalObject, text)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadableStreamToBlobFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer arguments;
    arguments.append(callFrame->argument(0));
    JSObject* blob = JSC::construct(globalObject, defaultGlobalObject(globalObject)->JSBlobConstructor(), arguments, "Blob is not constructible"_s);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::WebStreams::releaseInternalChunkArray(globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(blob);
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadableStreamToFormDataFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue blob = callFrame->argument(0);
    JSValue contentType = callFrame->argument(1);
    JSValue constructor = JSDOMFormData::getConstructor(vm, globalObject);
    JSValue fromFunction = constructor.get(globalObject, vm.propertyNames->from);
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(fromFunction);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "FormData.from is not a function"_s);
        return {};
    }
    MarkedArgumentBuffer arguments;
    arguments.append(blob);
    arguments.append(contentType);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::call(globalObject, fromFunction, callData, constructor, arguments)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onIntoArrayReadManyFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<InternalFieldTuple>(callFrame->uncheckedArgument(1));
    auto* reader = uncheckedDowncast<JSReadableStreamDefaultReader>(context->getInternalField(0));
    auto* chunks = uncheckedDowncast<JSArray>(context->getInternalField(1));
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::intoArrayLoop(vm, globalObject, reader, chunks, callFrame->argument(0))));
}

// The persistent-op pump: settle, then release the reader (the original
// `finally { reader.releaseLock() }`). If that release throws after a successful settle, the
// boundary delivers the error here again with the result already fulfilled; only the first
// settle counts.
static void intoArraySettle(JSC::VM& vm, JSGlobalObject* globalObject, WebCore::JSReadableStreamDefaultReader* reader, JSPromise* resultPromise, JSValue chunks, JSValue error)
{
    if (resultPromise->status() == JSPromise::Status::Pending) {
        if (error)
            resultPromise->reject(vm, error);
        else
            resultPromise->fulfill(vm, chunks);
    }
    if (reader->m_stream)
        Bun::WebStreams::readableStreamDefaultReaderRelease(globalObject, reader);
}

// One step of the queue-backed pump: consume the read result, refill from the queue; true = done.
static bool intoArrayStep(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStreamIntoArrayOperation* op, JSValue readResult, JSPromise*& pendingRead)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!readResult.isObject()) [[unlikely]]
        return true;
    auto [done, value] = Bun::getIteratorResult(globalObject, asObject(readResult));
    RETURN_IF_EXCEPTION(scope, true);
    if (done.toBoolean(globalObject))
        return true;
    auto* chunks = op->m_chunks.get();
    chunks->push(globalObject, value);
    RETURN_IF_EXCEPTION(scope, true);
    auto step = Bun::WebStreams::readableStreamDefaultReaderFillFromQueue(globalObject, op->m_reader.get(), chunks, &pendingRead);
    RETURN_IF_EXCEPTION(scope, true);
    return step == Bun::WebStreams::ConsumerFillStep::Done;
}

// The read's fulfilment reaction (enterStreams): a throw while consuming the result (a `done`/
// `value` getter, the refill) is the operation's rejection.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onIntoArrayReadFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto* op = uncheckedDowncast<JSReadableStreamIntoArrayOperation>(callFrame->uncheckedArgument(1));
    auto* reader = op->m_reader.get();
    auto* resultPromise = op->m_result.get();

    JSValue readResult = callFrame->argument(0);
    return enterStreams(globalObject, [&] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSPromise* pendingRead = nullptr;
        bool finished = intoArrayStep(vm, globalObject, op, readResult, pendingRead);
        RETURN_IF_EXCEPTION(scope, );
        if (finished)
            RELEASE_AND_RETURN(scope, intoArraySettle(vm, globalObject, reader, resultPromise, op->m_chunks.get(), {}));
        auto* runtime = JSStreamsRuntime::from(globalObject);
        pendingRead->performPromiseThenWithContext(vm, globalObject, runtime->onIntoArrayReadFulfilled(), runtime->onIntoArrayReadRejected(), jsUndefined(), op); }, [&](JSValue error) { intoArraySettle(vm, globalObject, reader, resultPromise, {}, error); });
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onIntoArrayReadRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* op = uncheckedDowncast<JSReadableStreamIntoArrayOperation>(callFrame->uncheckedArgument(1));
    intoArraySettle(vm, globalObject, op->m_reader.get(), op->m_result.get(), {}, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onIntoArrayReadManyRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<InternalFieldTuple>(callFrame->uncheckedArgument(1));
    auto* reader = uncheckedDowncast<JSReadableStreamDefaultReader>(context->getInternalField(0));
    JSValue error = callFrame->argument(0);
    if (reader->m_stream) {
        Bun::WebStreams::readableStreamDefaultReaderRelease(globalObject, reader);
        RETURN_IF_EXCEPTION(scope, {});
    }
    throwException(globalObject, scope, error);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDirectConsumeLoopReadFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<InternalFieldTuple>(callFrame->uncheckedArgument(1));
    bool done = false;
    if (JSObject* result = callFrame->argument(0).getObject()) {
        JSValue doneValue = Bun::getIteratorResult(globalObject, result).first;
        RETURN_IF_EXCEPTION(scope, {});
        done = doneValue.toBoolean(globalObject);
    }
    if (!done)
        RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::directConsumeLoopStep(vm, globalObject, context)));
    auto* stream = uncheckedDowncast<JSReadableStream>(context->getInternalField(0));
    auto* reader = uncheckedDowncast<JSReadableStreamDefaultReader>(context->getInternalField(1));
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::finishDirectConsumeLoop(vm, globalObject, stream, reader)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onDirectConsumeLoopReadRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, scope, callFrame->argument(0));
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onConsumeDirectToArrayBufferPullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* sink = uncheckedDowncast<JSOneShotDirectSink>(callFrame->uncheckedArgument(1));
    auto* stream = sink->m_stream.get();
    if (stream) {
        stream->m_lockedWithoutReader = false;
        Bun::WebStreams::readableStreamCloseIfPossible(globalObject, stream);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(sink->m_capabilityPromise.get());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onConsumeDirectToArrayBufferPullRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* sink = uncheckedDowncast<JSOneShotDirectSink>(callFrame->uncheckedArgument(1));
    JSValue error = callFrame->argument(0);
    auto* stream = sink->m_stream.get();
    if (stream) {
        stream->m_lockedWithoutReader = false;
        if (stream->m_state == ReadableStreamState::Readable) {
            Bun::WebStreams::readableStreamError(globalObject, stream, error);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    throwException(globalObject, scope, error);
    return {};
}

// [bound-convention] targets (FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ONE_SHOT).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundOneShotStart, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundOneShotDirectWrite, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto* sink = uncheckedDowncast<JSOneShotDirectSink>(callFrame->uncheckedArgument(0));
    if (sink->m_closed)
        return JSValue::encode(jsUndefined());
    MarkedArgumentBuffer arguments;
    arguments.append(callFrame->argument(1));
    RELEASE_AND_RETURN(scope, JSValue::encode(Bun::WebStreams::invokeMethod(vm, globalObject, sink->m_arrayBufferSink.get(), builtinNames(vm).writePublicName(), arguments)));
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundOneShotDirectClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* sink = uncheckedDowncast<JSOneShotDirectSink>(callFrame->uncheckedArgument(0));
    if (sink->m_closed)
        return JSValue::encode(jsUndefined());
    sink->m_closed = true;
    JSValue closeFunction = sink->m_closeFunction.get();
    if (closeFunction.toBoolean(globalObject)) {
        auto callData = JSC::getCallData(closeFunction);
        if (callData.type == CallData::Type::None) [[unlikely]] {
            throwTypeError(globalObject, scope, "The 'close' member of a direct ReadableStream's underlying source is not a function"_s);
            return {};
        }
        MarkedArgumentBuffer noArguments;
        JSC::call(globalObject, closeFunction, callData, jsUndefined(), noArguments);
        RETURN_IF_EXCEPTION(scope, {});
    }
    MarkedArgumentBuffer noArguments;
    JSValue endResult = Bun::WebStreams::invokeMethod(vm, globalObject, sink->m_arrayBufferSink.get(), builtinNames(vm).endPublicName(), noArguments);
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* capability = sink->m_capabilityPromise.get(); capability && capability->status() == JSPromise::Status::Pending)
        capability->fulfill(vm, endResult);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundOneShotDirectFlush, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    const auto* sink = uncheckedDowncast<JSOneShotDirectSink>(callFrame->uncheckedArgument(0));
    if (sink->m_closed)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsNumber(0));
}

} // namespace WebCore
