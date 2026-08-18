#include "BunClientData.h"
#include "config.h"
#include "BunStreamSource.h"

#include "AsyncContextFrame.h"
#include "BunStandaloneTextSink.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSDirectSinkCloseState.h"
#include "JSReadRequest.h"
#include "JSReadStreamIntoSinkOperation.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultController.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSSink.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSStreamsRuntime.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/ErrorType.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/Microtask.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

using namespace JSC;
using Bun::WebStreams::analyzeBarrierEdge;

const ClassInfo JSNativeStreamSourceAdapter::s_info = { "NativeStreamSourceAdapter"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNativeStreamSourceAdapter) };

JSNativeStreamSourceAdapter::JSNativeStreamSourceAdapter(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSNativeStreamSourceAdapter::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    auto values = initialValues();
    for (unsigned i = 0; i < numberOfInternalFields; ++i)
        Base::internalField(i).set(vm, this, values[i]);
    ASSERT(inherits(info()));
}

JSNativeStreamSourceAdapter* JSNativeStreamSourceAdapter::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSNativeStreamSourceAdapter>(vm)) JSNativeStreamSourceAdapter(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSNativeStreamSourceAdapter::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSNativeStreamSourceAdapter::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSNativeStreamSourceAdapter, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNativeStreamSourceAdapter.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNativeStreamSourceAdapter = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNativeStreamSourceAdapter.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNativeStreamSourceAdapter = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSNativeStreamSourceAdapter::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSNativeStreamSourceAdapter>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSNativeStreamSourceAdapter);

const ClassInfo JSDirectSinkCloseState::s_info = { "DirectSinkCloseState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDirectSinkCloseState) };

JSDirectSinkCloseState::JSDirectSinkCloseState(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSDirectSinkCloseState::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSDirectSinkCloseState* JSDirectSinkCloseState::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSDirectSinkCloseState>(vm)) JSDirectSinkCloseState(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSDirectSinkCloseState::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSDirectSinkCloseState::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDirectSinkCloseState, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForDirectSinkCloseState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForDirectSinkCloseState = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForDirectSinkCloseState.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForDirectSinkCloseState = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSDirectSinkCloseState::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDirectSinkCloseState>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_underlyingSource);
    visitor.appendHidden(thisObject->m_sinkController);
    visitor.appendHidden(thisObject->m_closePromise);
}

DEFINE_VISIT_CHILDREN(JSDirectSinkCloseState);

void JSDirectSinkCloseState::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSDirectSinkCloseState>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_underlyingSource, "underlyingSource"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_sinkController, "sinkController"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closePromise, "closePromise"_s);
}

const ClassInfo JSReadStreamIntoSinkOperation::s_info = { "ReadStreamIntoSinkOperation"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadStreamIntoSinkOperation) };

JSReadStreamIntoSinkOperation::JSReadStreamIntoSinkOperation(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadStreamIntoSinkOperation::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadStreamIntoSinkOperation* JSReadStreamIntoSinkOperation::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSReadStreamIntoSinkOperation>(vm)) JSReadStreamIntoSinkOperation(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* JSReadStreamIntoSinkOperation::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSReadStreamIntoSinkOperation::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadStreamIntoSinkOperation, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadStreamIntoSinkOperation.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadStreamIntoSinkOperation = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadStreamIntoSinkOperation.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadStreamIntoSinkOperation = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSReadStreamIntoSinkOperation::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadStreamIntoSinkOperation>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_reader);
    visitor.appendHidden(thisObject->m_sink);
    visitor.appendHidden(thisObject->m_result);
    visitor.appendHidden(thisObject->m_pendingBatch);
    visitor.appendHidden(thisObject->m_nativeTransform);
}

DEFINE_VISIT_CHILDREN(JSReadStreamIntoSinkOperation);

void JSReadStreamIntoSinkOperation::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadStreamIntoSinkOperation>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_reader, "reader"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_sink, "sink"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_result, "result"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pendingBatch, "pendingBatch"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_nativeTransform, "nativeTransform"_s);
}

} // namespace WebCore

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSBunStandaloneTextSink;

static constexpr size_t nativeSourceMinChunkSize = 64 * 1024;
static constexpr size_t nativeSourceDefaultChunkSize = 256 * 1024;
static constexpr size_t nativeSourceMaxChunkSize = 2 * 1024 * 1024;

// Shared bound-convention wrapper: see createStreamsBoundHandler (WebStreamsMisc.cpp).
static inline JSBoundFunction* createBoundHandler(JSGlobalObject* globalObject, JSFunction* target, JSCell* context)
{
    return createStreamsBoundHandler(globalObject, target, context);
}

// object.<name>(...args) with a real [[Get]], as the replaced builtins did.
static JSValue invokeMethod(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* object, const Identifier& name, const MarkedArgumentBuffer& args)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = object->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    if (!method.isCallable()) [[unlikely]] {
        throwTypeError(globalObject, scope, makeString(name.string(), " is not a function"_s));
        return {};
    }
    RELEASE_AND_RETURN(scope, call(globalObject, method, getCallData(method), object, args));
}

// The native-handle cancel protocol shared by nativeSourceCancel / cancelPendingNativeSource.
static void invokeNativeHandleCancel(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* handle, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer updateRefArgs;
    updateRefArgs.append(jsBoolean(false));
    ASSERT(!updateRefArgs.hasOverflowed());
    invokeMethod(vm, globalObject, handle, builtinNames(vm).updateRefPublicName(), updateRefArgs);
    RETURN_IF_EXCEPTION(scope, );
    MarkedArgumentBuffer cancelArgs;
    cancelArgs.append(reason);
    ASSERT(!cancelArgs.hasOverflowed());
    scope.release();
    invokeMethod(vm, globalObject, handle, builtinNames(vm).cancelPublicName(), cancelArgs);
}

static JSValue wrapWithAsyncContext(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue callable)
{
    JSValue asyncContext = stream->m_asyncContext.get();
    if (callable.isUndefined() || asyncContext.isEmpty() || asyncContext.isUndefined())
        return callable;
    return AsyncContextFrame::create(globalObject, callable, asyncContext);
}

// The generated JSSink controller's C++ start(readableStream, onPull, onClose) registration.
static void startJSSinkController(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* sink, JSValue streamValue, JSValue onPull, JSValue onClose)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
#define BUN_START_JSSINK_CONTROLLER(ControllerType)                                              \
    if (auto* controller = dynamicDowncast<WebCore::ControllerType>(sink)) {                     \
        if (!controller->wrapped()) [[unlikely]] {                                               \
            throwTypeError(globalObject, scope, "Cannot start stream with closed controller"_s); \
            return;                                                                              \
        }                                                                                        \
        controller->start(globalObject, streamValue, onPull, onClose);                           \
        return;                                                                                  \
    }
    BUN_START_JSSINK_CONTROLLER(JSReadableArrayBufferSinkController)
    BUN_START_JSSINK_CONTROLLER(JSReadableFileSinkController)
    BUN_START_JSSINK_CONTROLLER(JSReadableHTTPResponseSinkController)
    BUN_START_JSSINK_CONTROLLER(JSReadableHTTPSResponseSinkController)
    BUN_START_JSSINK_CONTROLLER(JSReadableH3ResponseSinkController)
    BUN_START_JSSINK_CONTROLLER(JSReadableNetworkSinkController)
    BUN_START_JSSINK_CONTROLLER(JSReadableFetchRequestBodySinkController)
    BUN_START_JSSINK_CONTROLLER(JSReadableHTMLRewriterSinkController)
#undef BUN_START_JSSINK_CONTROLLER
    throwTypeError(globalObject, scope, "Unknown direct controller. This is a bug in Bun."_s);
}

// ReadableStream.prototype.cancel semantics; the result promise is only ever markAsHandled'd.
static void publicStreamCancelIgnoringResult(JSC::VM& vm, JSGlobalObject* globalObject, JSReadableStream* stream, JSValue reason)
{
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSPromise* promise = nullptr;
    if (isReadableStreamLocked(stream))
        promise = promiseRejectedWith(globalObject, createTypeError(globalObject, "ReadableStream is locked"_s));
    else
        promise = readableStreamCancel(globalObject, stream, reason);
    if (catchScope.exception()) [[unlikely]] {
        takeAbruptCompletion(globalObject, catchScope);
        return;
    }
    if (promise)
        markPromiseAsHandled(vm, promise);
}

static void clearStreamControllerSlots(JSReadableStream* stream)
{
    stream->m_controller.clear();
    stream->m_controllerKind = ControllerKind::None;
    stream->m_directUnderlyingSource.clear();
}

//                       SourceKind::Native — the lazily materialized native source

static void nativeStorePendingView(JSC::VM& vm, JSNativeStreamSourceAdapter* adapter, JSValue newView)
{
    if (JSObject* object = newView.getObject())
        adapter->setPendingView(vm, object);
    else
        adapter->clearPendingView(vm);
}

// Text mode: decode `bytes` against `state` and enqueue the resulting string
// (empty strings are skipped; an empty non-flush decode re-arms the pull loop).
static void nativeEnqueueTextChunk(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller, StreamingUTF8DecodeState& state, std::span<const uint8_t> bytes, bool flush)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* decoded = streamingUTF8Decode(globalObject, bytes, state, flush);
    RETURN_IF_EXCEPTION(scope, void());
    if (!controller)
        return;
    if (!decoded || !decoded->length()) {
        if (!flush)
            RELEASE_AND_RETURN(scope, readableStreamDefaultControllerCallPullIfNeeded(globalObject, controller));
        return;
    }
    readableStreamDefaultControllerEnqueue(globalObject, controller, decoded);
    RETURN_IF_EXCEPTION(scope, void());
}

static bool nativeCloserFlag(JSC::VM& vm, JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* closer = uncheckedDowncast<JSArray>(adapter->closer());
    JSValue flag = closer->getIndex(globalObject, 0);
    RETURN_IF_EXCEPTION(scope, false);
    return flag.toBoolean(globalObject);
}

// Terminal severing: the handle's callback slots, the handle edge, and the pending view.
static void nativeSourceSever(JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter)
{
    auto& vm = getVM(globalObject);
    if (JSObject* handle = adapter->handle()) {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        PutPropertySlot onCloseSlot(handle, false);
        handle->methodTable()->put(handle, globalObject, builtinNames(vm).onClosePublicName(), jsUndefined(), onCloseSlot);
        if (!catchScope.exception()) {
            PutPropertySlot onDrainSlot(handle, false);
            handle->methodTable()->put(handle, globalObject, builtinNames(vm).onDrainPublicName(), jsUndefined(), onDrainSlot);
        }
        if (catchScope.exception()) [[unlikely]] {
            if (takeAbruptCompletion(globalObject, catchScope).isEmpty())
                return;
        }
    }
    adapter->clearHandle(vm);
    adapter->clearPendingView(vm);
}

// The queued callClose job body: close the controller if the consumer is still alive, then sever.
static void nativeSourceCallClose(JSC::VM& vm, JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter)
{
    auto* controller = adapter->controller();
    adapter->clearController(vm);
    if (controller && readableStreamDefaultControllerCanCloseOrEnqueue(controller)) {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        if (adapter->m_textMode)
            nativeEnqueueTextChunk(globalObject, controller, adapter->m_textState, {}, /* flush */ true);
        if (!catchScope.exception())
            readableStreamDefaultControllerClose(globalObject, controller);
        if (catchScope.exception()) [[unlikely]] {
            JSValue thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return;
            Bun__reportError(globalObject, JSValue::encode(thrown));
        }
    }
    nativeSourceSever(globalObject, adapter);
}

static void scheduleNativeSourceCallClose(JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter)
{
    queueStreamsMicrotask(globalObject, WebCore::JSStreamsRuntime::from(globalObject)->onNativeSourceCallCloseMicrotask(), jsUndefined(), adapter);
}

// Sizes the next slab to what the source actually delivers: one doubling when a pull fills the slab (files),
// and a shrink to the read size when it does not (pipes and sockets top out at 64-128 KiB per read), so that
// steady-state fills are whole and the slab is handed over rather than copied out of.
static void nativeAdjustChunkSize(JSNativeStreamSourceAdapter* adapter, size_t resultBytes, size_t slabBytes)
{
    const size_t chunkSize = adapter->m_chunkSize;
    if (resultBytes >= slabBytes) {
        if (!adapter->m_hasResized) {
            adapter->m_hasResized = true;
            adapter->m_chunkSize = std::min<size_t>(chunkSize * 2, nativeSourceMaxChunkSize);
        }
        return;
    }
    if (resultBytes > 0 && resultBytes < chunkSize) {
        adapter->m_hasResized = true;
        adapter->m_chunkSize = std::max<size_t>(WTF::roundUpToPowerOfTwo(resultBytes), nativeSourceMinChunkSize);
    }
}

// The pending slab is only ever handed to JS whole, so it is reused as long as it is still big enough; the
// bytes are written by the source before anything reads them, so it need not be zeroed.
static JSC::JSUint8Array* nativeGetInternalBuffer(JSC::VM& vm, JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    const size_t chunkSize = adapter->m_chunkSize;
    if (JSObject* pending = adapter->pendingView()) {
        auto* view = uncheckedDowncast<JSC::JSUint8Array>(pending);
        if (!view->isDetached() && view->length() == chunkSize)
            return view;
    }
    auto* fresh = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->typedArrayStructure(JSC::TypeUint8, false), chunkSize);
    RETURN_IF_EXCEPTION(scope, nullptr);
    adapter->setPendingView(vm, fresh);
    return fresh;
}

// Decodes one pull result. Returns the value to store as the pending view (a view or undefined).
static JSValue nativeDecodePullResult(JSC::VM& vm, JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter, JSReadableStreamDefaultController* controller, JSValue result, JSC::JSUint8Array* view, bool isClosed)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (result.isNumber()) {
        double written = result.asNumber();
        if (!isClosed)
            nativeAdjustChunkSize(adapter, written > 0 ? static_cast<size_t>(written) : 0, view ? view->length() : adapter->m_chunkSize);
        if (adapter->m_textMode) {
            if (written > 0 && view) {
                size_t count = std::min(static_cast<size_t>(written), static_cast<size_t>(view->length()));
                nativeEnqueueTextChunk(globalObject, controller, adapter->m_textState, view->span().first(count), /* flush */ false);
                RETURN_IF_EXCEPTION(scope, {});
            }
            if (isClosed) {
                scheduleNativeSourceCallClose(globalObject, adapter);
                return jsUndefined();
            }
            // The whole view is free to reuse next pull (bytes were copied out).
            return view ? JSValue(view) : jsUndefined();
        }
        JSValue newView = view ? JSValue(view) : jsUndefined();
        if (written > 0 && view) {
            size_t count = std::min(static_cast<size_t>(written), static_cast<size_t>(view->length()));
            JSC::JSArrayBufferView* toEnqueue = view;
            if (count < view->length()) {
                // A partial fill (pipes, sockets, the tail of a file) is copied out right-sized and the
                // whole slab is reused for the next pull: no subarray views, and the slab is never adopted
                // into an ArrayBuffer (which only full collections reclaim). A full fill hands over the slab.
                auto* chunk = JSC::JSUint8Array::createUninitialized(globalObject, globalObject->typedArrayStructure(JSC::TypeUint8, false), count);
                RETURN_IF_EXCEPTION(scope, {});
                memcpy(chunk->typedVector(), view->typedVector(), count);
                toEnqueue = chunk;
            } else
                newView = jsUndefined();
            if (controller) {
                readableStreamDefaultControllerEnqueue(globalObject, controller, toEnqueue);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
        if (isClosed) {
            scheduleNativeSourceCallClose(globalObject, adapter);
            return jsUndefined();
        }
        return newView;
    }
    if (result.isBoolean()) {
        scheduleNativeSourceCallClose(globalObject, adapter);
        return jsUndefined();
    }
    if (auto* chunk = dynamicDowncast<JSC::JSArrayBufferView>(result)) {
        if (!isClosed && chunk->byteLength() >= adapter->m_chunkSize)
            nativeAdjustChunkSize(adapter, chunk->byteLength(), chunk->byteLength());
        if (chunk->byteLength() > 0) {
            if (adapter->m_textMode) {
                nativeEnqueueTextChunk(globalObject, controller, adapter->m_textState, chunk->span(), /* flush */ false);
                RETURN_IF_EXCEPTION(scope, {});
            } else if (controller) {
                readableStreamDefaultControllerEnqueue(globalObject, controller, chunk);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
        if (isClosed) {
            scheduleNativeSourceCallClose(globalObject, adapter);
            return jsUndefined();
        }
        return view ? JSValue(view) : jsUndefined();
    }
    Bun::ERR::INVALID_STATE(scope, globalObject, "Internal error: invalid result from pull. This is a bug in Bun. Please report it."_s);
    return {};
}

void materializeNativeSource(JSGlobalObject* globalObject, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (stream->nativeHandleDetached())
        return;
    JSObject* handle = stream->m_nativePtr.get().getObject();
    if (!handle)
        return;
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = WebCore::JSStreamsRuntime::from(globalObject);

    stream->m_disturbed = true;
    size_t autoAllocateChunkSize = stream->m_autoAllocateChunkSize ? static_cast<size_t>(stream->m_autoAllocateChunkSize) : nativeSourceDefaultChunkSize;

    MarkedArgumentBuffer startArgs;
    startArgs.append(jsNumber(static_cast<double>(autoAllocateChunkSize)));
    ASSERT(!startArgs.hasOverflowed());
    JSValue startResult = invokeMethod(vm, globalObject, handle, builtinNames(vm).startPublicName(), startArgs);
    RETURN_IF_EXCEPTION(scope, );

    double chunkSize = 0;
    JSValue drainValue;
    if (dynamicDowncast<JSC::JSArrayBufferView>(startResult))
        drainValue = startResult;
    else {
        chunkSize = startResult.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        MarkedArgumentBuffer noArgs;
        drainValue = invokeMethod(vm, globalObject, handle, builtinNames(vm).drainPublicName(), noArgs);
        RETURN_IF_EXCEPTION(scope, );
    }

    // Fully-buffered fast path: no adapter, no further native round-trips.
    if (chunkSize == 0) {
        auto* controller = WebCore::JSReadableStreamDefaultController::create(vm, WebCore::getDOMStructure<WebCore::JSReadableStreamDefaultController>(vm, *domGlobalObject));
        controller->m_algorithms.kind = SourceKind::Nothing;
        setUpReadableStreamDefaultController(globalObject, stream, controller, jsUndefined(), 1);
        RETURN_IF_EXCEPTION(scope, );
        auto* drainView = dynamicDowncast<JSC::JSArrayBufferView>(drainValue);
        if (drainView && drainView->byteLength() > 0) {
            if (stream->m_nativeTextMode) {
                StreamingUTF8DecodeState state;
                nativeEnqueueTextChunk(globalObject, controller, state, drainView->span(), /* flush */ true);
            } else {
                readableStreamDefaultControllerEnqueue(globalObject, controller, drainView);
            }
            RETURN_IF_EXCEPTION(scope, );
        }
        readableStreamDefaultControllerClose(globalObject, controller);
        RETURN_IF_EXCEPTION(scope, );
        return;
    }

    auto* adapter = WebCore::JSNativeStreamSourceAdapter::create(vm, runtime->nativeStreamSourceAdapterStructure(domGlobalObject));
    adapter->setHandle(vm, handle);
    adapter->m_textMode = stream->m_nativeTextMode;
    adapter->m_chunkSize = std::max(static_cast<size_t>(chunkSize), autoAllocateChunkSize);
    auto* closer = JSC::constructEmptyArray(globalObject, nullptr, 1);
    RETURN_IF_EXCEPTION(scope, );
    closer->putDirectIndex(globalObject, 0, jsBoolean(false));
    RETURN_IF_EXCEPTION(scope, );
    adapter->setCloser(vm, closer);
    if (!drainValue.isUndefined())
        adapter->setDrainValue(vm, drainValue);

    auto* onCloseBound = createBoundHandler(globalObject, runtime->boundOnNativeSourceClose(), adapter);
    RETURN_IF_EXCEPTION(scope, );
    auto* onDrainBound = createBoundHandler(globalObject, runtime->boundOnNativeSourceDrain(), adapter);
    RETURN_IF_EXCEPTION(scope, );
    PutPropertySlot onCloseSlot(handle, false);
    handle->methodTable()->put(handle, globalObject, builtinNames(vm).onClosePublicName(), onCloseBound, onCloseSlot);
    RETURN_IF_EXCEPTION(scope, );
    PutPropertySlot onDrainSlot(handle, false);
    handle->methodTable()->put(handle, globalObject, builtinNames(vm).onDrainPublicName(), onDrainBound, onDrainSlot);
    RETURN_IF_EXCEPTION(scope, );

    auto* controller = WebCore::JSReadableStreamDefaultController::create(vm, WebCore::getDOMStructure<WebCore::JSReadableStreamDefaultController>(vm, *domGlobalObject));
    controller->m_algorithms.kind = SourceKind::Native;
    controller->m_algorithms.algorithmContext.set(vm, controller, adapter);
    setUpReadableStreamDefaultController(globalObject, stream, controller, jsUndefined(), 1);
    RETURN_IF_EXCEPTION(scope, );
    nativeSourceStart(globalObject, controller);
    RETURN_IF_EXCEPTION(scope, );
}

JSValue nativeSourceStart(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(controller->m_algorithms.algorithmContext.get());
    JSValue drainValue = adapter->drainValue();
    if (!drainValue.isUndefined()) {
        adapter->clearDrainValue(vm);
        if (!adapter->controller())
            adapter->setController(vm, controller);
        if (adapter->m_textMode) {
            if (auto* drainView = dynamicDowncast<JSC::JSArrayBufferView>(drainValue))
                nativeEnqueueTextChunk(globalObject, controller, adapter->m_textState, drainView->span(), /* flush */ false);
        } else {
            readableStreamDefaultControllerEnqueue(globalObject, controller, drainValue);
        }
        RETURN_IF_EXCEPTION(scope, {});
    }
    return jsUndefined();
}

static JSPromise* nativeSourcePullImpl(JSC::VM& vm, JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter, JSReadableStreamDefaultController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!adapter->controller())
        adapter->setController(vm, controller);

    JSObject* handle = adapter->handle();
    if (!handle || adapter->m_closed) {
        adapter->m_closed = true;
        scheduleNativeSourceCallClose(globalObject, adapter);
        nativeSourceSever(globalObject, adapter);
        RETURN_IF_EXCEPTION(scope, nullptr);
        return nullptr;
    }

    auto* closer = uncheckedDowncast<JSArray>(adapter->closer());
    closer->putDirectIndex(globalObject, 0, jsBoolean(false));
    RETURN_IF_EXCEPTION(scope, nullptr);

    if (JSObject* pendingObject = adapter->pendingView()) {
        MarkedArgumentBuffer noArgs;
        JSValue drained = invokeMethod(vm, globalObject, handle, builtinNames(vm).drainPublicName(), noArgs);
        RETURN_IF_EXCEPTION(scope, nullptr);
        bool isTruthy = drained.toBoolean(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (isTruthy) {
            bool isClosed = nativeCloserFlag(vm, globalObject, adapter);
            RETURN_IF_EXCEPTION(scope, nullptr);
            JSValue newView = nativeDecodePullResult(vm, globalObject, adapter, controller, drained, uncheckedDowncast<JSC::JSUint8Array>(pendingObject), isClosed);
            RETURN_IF_EXCEPTION(scope, nullptr);
            nativeStorePendingView(vm, adapter, newView);
            return nullptr;
        }
    }

    auto* view = nativeGetInternalBuffer(vm, globalObject, adapter);
    RETURN_IF_EXCEPTION(scope, nullptr);

    MarkedArgumentBuffer pullArgs;
    pullArgs.append(view);
    pullArgs.append(closer);
    ASSERT(!pullArgs.hasOverflowed());
    JSValue result = invokeMethod(vm, globalObject, handle, builtinNames(vm).pullPublicName(), pullArgs);
    RETURN_IF_EXCEPTION(scope, nullptr);

    if (auto* pullPromise = dynamicDowncast<JSPromise>(result)) {
        auto* runtime = WebCore::JSStreamsRuntime::from(globalObject);
        pullPromise->performPromiseThenWithContext(vm, globalObject, runtime->onNativePullFulfilled(), runtime->onNativePullRejected(), jsUndefined(), adapter);
        return pullPromise;
    }

    bool isClosed = nativeCloserFlag(vm, globalObject, adapter);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSValue newView = nativeDecodePullResult(vm, globalObject, adapter, controller, result, view, isClosed);
    RETURN_IF_EXCEPTION(scope, nullptr);
    nativeStorePendingView(vm, adapter, newView);
    if (adapter->m_closed)
        adapter->clearPendingView(vm);
    return nullptr;
}

JSPromise* nativeSourcePull(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(controller->m_algorithms.algorithmContext.get());
    JSValue thrown;
    JSPromise* asyncResult = nullptr;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        asyncResult = nativeSourcePullImpl(vm, globalObject, adapter, controller);
        if (catchScope.exception()) [[unlikely]] {
            thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return nullptr;
        }
    }
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    if (asyncResult)
        return asyncResult;
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

JSPromise* nativeSourceCancel(JSGlobalObject* globalObject, JSReadableStreamDefaultController* controller, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(controller->m_algorithms.algorithmContext.get());
    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        adapter->clearPendingView(vm);
        adapter->clearController(vm);
        if (JSObject* handle = adapter->handle())
            invokeNativeHandleCancel(vm, globalObject, handle, reason);
        if (!catchScope.exception())
            nativeSourceSever(globalObject, adapter);
        if (catchScope.exception()) [[unlikely]] {
            thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return nullptr;
        }
    }
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

JSPromise* cancelPendingNativeSource(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_bunMode == BunStreamMode::NativePending);
    ASSERT(stream->m_controllerKind == ControllerKind::None);
    stream->m_bunMode = BunStreamMode::Default;
    JSObject* handle = stream->nativeHandleDetached() ? nullptr : stream->m_nativePtr.get().getObject();
    if (!handle)
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        invokeNativeHandleCancel(vm, globalObject, handle, reason);
        if (catchScope.exception()) [[unlikely]] {
            thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return nullptr;
        }
    }
    if (!thrown.isEmpty())
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, thrown));
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

// The [bound-convention] onDrain body: a dead consumer drops the chunk.
static void nativeSourceOnDrain(JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter, JSValue chunk)
{
    auto* controller = adapter->controller();
    if (!controller)
        return;
    if (adapter->m_textMode) {
        if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(chunk))
            nativeEnqueueTextChunk(globalObject, controller, adapter->m_textState, view->span(), /* flush */ false);
        return;
    }
    readableStreamDefaultControllerEnqueue(globalObject, controller, chunk);
}

// The [bound-convention] native-initiated onClose body.
static void nativeSourceOnClose(JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter)
{
    adapter->m_closed = true;
    if (adapter->controller())
        scheduleNativeSourceCallClose(globalObject, adapter);
    nativeSourceSever(globalObject, adapter);
}

static void nativeSourcePullFulfilled(JSC::VM& vm, JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter, JSValue result)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = adapter->controller();
    JSC::JSUint8Array* view = nullptr;
    if (JSObject* pendingObject = adapter->pendingView())
        view = uncheckedDowncast<JSC::JSUint8Array>(pendingObject);
    bool isClosed = nativeCloserFlag(vm, globalObject, adapter);
    RETURN_IF_EXCEPTION(scope, );
    JSValue newView = nativeDecodePullResult(vm, globalObject, adapter, controller, result, view, isClosed);
    RETURN_IF_EXCEPTION(scope, );
    nativeStorePendingView(vm, adapter, newView);
    if (adapter->m_closed)
        adapter->clearPendingView(vm);
}

static void nativeSourcePullRejected(JSC::VM& vm, JSGlobalObject* globalObject, JSNativeStreamSourceAdapter* adapter, JSValue error)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    adapter->clearPendingView(vm);
    adapter->m_closed = true;
    auto* controller = adapter->controller();
    adapter->clearController(vm);
    if (controller) {
        readableStreamDefaultControllerError(globalObject, controller, error);
        RETURN_IF_EXCEPTION(scope, );
    }
    nativeSourceSever(globalObject, adapter);
}

//                       The native-sink path

// readDirectStreamOnClose: the state-mutation half runs only when a stream is provided.
static void readDirectStreamCloseImpl(JSC::VM& vm, JSGlobalObject* globalObject, JSDirectSinkCloseState* state, JSValue streamValue, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    // The sink closed (or is closing): end() detaches the controller cell from the native
    // sink so a later GC of the cell cannot release a reference it does not own.
    if (JSObject* sinkController = state->m_sinkController.get()) {
        state->m_sinkController.clear();
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        MarkedArgumentBuffer noArgs;
        invokeMethod(vm, globalObject, sinkController, builtinNames(vm).endPublicName(), noArgs);
        if (catchScope.exception()) [[unlikely]]
            catchScope.clearExceptionExceptTermination();
    }
    JSObject* underlyingSource = state->m_underlyingSource.get();
    state->m_underlyingSource.clear();
    if (underlyingSource) {
        JSValue cancelFunction = underlyingSource->get(globalObject, builtinNames(vm).cancelPublicName());
        RETURN_IF_EXCEPTION(scope, );
        bool hasCancel = cancelFunction.toBoolean(globalObject);
        if (hasCancel) {
            auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            if (cancelFunction.isCallable()) {
                MarkedArgumentBuffer cancelArgs;
                cancelArgs.append(reason);
                ASSERT(!cancelArgs.hasOverflowed());
                JSValue cancelResult = call(globalObject, cancelFunction, getCallData(cancelFunction), underlyingSource, cancelArgs);
                if (!catchScope.exception()) {
                    if (auto* cancelPromise = dynamicDowncast<JSPromise>(cancelResult))
                        markPromiseAsHandled(vm, cancelPromise);
                }
            }
            if (catchScope.exception()) [[unlikely]] {
                if (takeAbruptCompletion(globalObject, catchScope).isEmpty())
                    return;
            }
        }
    }
    if (auto* stream = dynamicDowncast<JSReadableStream>(streamValue)) {
        clearStreamControllerSlots(stream);
        stream->m_reader.clear();
        stream->m_lockedWithoutReader = false;
        // This path writes the terminal state directly (the controller and reader slots are
        // already torn down), so it settles the closed promise itself.
        if (reason.toBoolean(globalObject)) {
            stream->m_state = ReadableStreamState::Errored;
            stream->m_storedError.set(vm, stream, reason);
            rejectStreamClosedPromise(vm, stream, reason);
        } else {
            stream->m_state = ReadableStreamState::Closed;
            resolveStreamClosedPromise(vm, stream);
        }
    }
    if (auto* closePromise = state->m_closePromise.get()) {
        state->m_closePromise.clear();
        resolvePromise(globalObject, closePromise, jsUndefined());
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSValue readDirectStream(JSGlobalObject* globalObject, JSReadableStream* stream, JSObject* sinkController, JSObject* underlyingSource)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = WebCore::JSStreamsRuntime::from(globalObject);

    stream->m_directUnderlyingSource.clear();
    stream->m_bunMode = BunStreamMode::Default;

    auto* state = WebCore::JSDirectSinkCloseState::create(vm, runtime->directSinkCloseStateStructure(domGlobalObject));
    state->m_underlyingSource.set(vm, state, underlyingSource);
    state->m_sinkController.set(vm, state, sinkController);

    JSValue pull = underlyingSource->get(globalObject, builtinNames(vm).pullPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    bool pullIsTruthy = pull.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!pullIsTruthy) {
        readDirectStreamCloseImpl(vm, globalObject, state, jsUndefined(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
        return jsUndefined();
    }
    if (!pull.isCallable()) {
        readDirectStreamCloseImpl(vm, globalObject, state, jsUndefined(), jsUndefined());
        RETURN_IF_EXCEPTION(scope, {});
        throwTypeError(globalObject, scope, "pull is not a function"_s);
        return {};
    }

    stream->m_controller.set(vm, stream, sinkController);
    stream->m_controllerKind = ControllerKind::NativeSink;

    double rawHighWaterMark = stream->m_bunHighWaterMark;
    double highWaterMark = (std::isnan(rawHighWaterMark) || rawHighWaterMark < 64) ? 64 : rawHighWaterMark;
    auto* startOptions = constructEmptyObject(globalObject);
    startOptions->putDirect(vm, builtinNames(vm).highWaterMarkPublicName(), jsNumber(highWaterMark));
    MarkedArgumentBuffer startArgs;
    startArgs.append(startOptions);
    ASSERT(!startArgs.hasOverflowed());
    invokeMethod(vm, globalObject, sinkController, builtinNames(vm).startPublicName(), startArgs);
    RETURN_IF_EXCEPTION(scope, {});

    auto* closeBound = createBoundHandler(globalObject, runtime->boundReadDirectStreamOnClose(), state);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue onClose = wrapWithAsyncContext(globalObject, stream, closeBound);
    RETURN_IF_EXCEPTION(scope, {});
    // A direct-stream `pull` is invoked once below and runs to completion; it
    // is not a resume hook. Leaving m_onPull empty makes the sink's onReady()
    // a no-op so a backpressure drain cannot re-enter the still-running pull.
    startJSSinkController(vm, globalObject, sinkController, stream, jsUndefined(), onClose);
    RETURN_IF_EXCEPTION(scope, {});

    stream->m_lockedWithoutReader = true;

    MarkedArgumentBuffer pullArgs;
    pullArgs.append(sinkController);
    ASSERT(!pullArgs.hasOverflowed());
    JSValue maybePromise = call(globalObject, pull, getCallData(pull), underlyingSource, pullArgs);
    RETURN_IF_EXCEPTION(scope, {});

    if (auto* pullPromise = dynamicDowncast<JSPromise>(maybePromise)) {
        auto* result = JSPromise::create(vm, globalObject->promiseStructure());
        pullPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReturnUndefined(), jsUndefined(), result, jsUndefined());
        return result;
    }
    if (stream->m_state == ReadableStreamState::Readable) {
        auto* closePromise = JSPromise::create(vm, globalObject->promiseStructure());
        state->m_closePromise.set(vm, state, closePromise);
        return closePromise;
    }
    return jsUndefined();
}

JSValue assignToStream(JSGlobalObject* globalObject, JSReadableStream* stream, JSValue jsSinkController)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* sink = jsSinkController.getObject();
    if (!sink) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected a sink controller"_s);
        return {};
    }
    JSObject* underlyingSource = stream->m_directUnderlyingSource.get();
    if (stream->m_bunMode == BunStreamMode::DirectPending && underlyingSource)
        RELEASE_AND_RETURN(scope, readDirectStream(globalObject, stream, sink, underlyingSource));
    RELEASE_AND_RETURN(scope, readStreamIntoSink(globalObject, stream, sink));
}

//                       readStreamIntoSink — the generic pump

using WebCore::JSReadStreamIntoSinkOperation;

static void rsisIssueRead(JSGlobalObject*, JSReadStreamIntoSinkOperation*);
static void rsisFinish(JSGlobalObject*, JSReadStreamIntoSinkOperation*);
static void rsisAbrupt(JSC::VM&, JSGlobalObject*, JSReadStreamIntoSinkOperation*, JSValue error);

static JSValue rsisSinkWrite(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSValue chunk)
{
    if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk)) {
        if (auto* ctrl = dynamicDowncast<WebCore::JSReadableSinkControllerBase>(op->m_sink.get())) {
            if (void* sinkPtr = ctrl->wrapped())
                return JSValue::decode(Bun__NativeTransformSink__writeBytes(static_cast<uint8_t>(ctrl->sinkId()), sinkPtr, globalObject, static_cast<const uint8_t*>(view->vector()), view->byteLength()));
        }
    }
    MarkedArgumentBuffer args;
    args.append(chunk);
    ASSERT(!args.hasOverflowed());
    return invokeMethod(vm, globalObject, op->m_sink.get(), builtinNames(vm).writePublicName(), args);
}

static JSValue rsisSinkEnd(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    MarkedArgumentBuffer noArgs;
    return invokeMethod(vm, globalObject, op->m_sink.get(), builtinNames(vm).endPublicName(), noArgs);
}

static void rsisSinkClose(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSValue error)
{
    MarkedArgumentBuffer args;
    args.append(error);
    ASSERT(!args.hasOverflowed());
    invokeMethod(vm, globalObject, op->m_sink.get(), builtinNames(vm).closePublicName(), args);
}

// Runs one synchronous segment of the pump; an abrupt completion becomes the pump's catch path.
template<typename Body>
static void rsisRunCatching(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, const Body& body)
{
    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        body();
        if (catchScope.exception()) [[unlikely]] {
            thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return;
        }
    }
    if (!thrown.isEmpty())
        rsisAbrupt(vm, globalObject, op, thrown);
}

// Detach the native byte transform from this sink. Called BEFORE sink end()/close()
// so a re-entrant transform write cannot see a freed m_sinkPtr. Idempotent.
static void rsisDetachNativeTransform(JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    auto* ts = op->m_nativeTransform.get();
    if (!ts)
        return;
    ts->m_nativeSinkPtr = nullptr;
    ts->m_nativeSinkCell.clear();
    if (auto* ready = ts->m_nativeSinkReadyPromise.get()) {
        ts->m_nativeSinkReadyPromise.clear();
        resolvePromise(globalObject, ready, jsUndefined());
    }
    nativeCodecAbandon(globalObject, ts);
    op->m_nativeTransform.clear();
}

// The pump's `finally`: release the reader (unless the throw path orphaned it) and detach.
static void rsisFinally(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (auto* reader = op->m_reader.get()) {
        {
            auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            readableStreamDefaultReaderRelease(globalObject, reader);
            if (catchScope.exception()) [[unlikely]] {
                if (takeAbruptCompletion(globalObject, catchScope).isEmpty())
                    return;
            }
        }
        reader->m_pipeOperation.clear();
        op->m_reader.clear();
    }
    rsisDetachNativeTransform(globalObject, op);
    op->m_sink.clear();
    op->m_pendingBatch.clear();
    op->m_waitingOnSink = false;
    auto* stream = op->m_stream.get();
    if (!stream)
        return;
    ReadableStreamState state = stream->m_state;
    clearStreamControllerSlots(stream);
    if (!op->m_didThrow && state != ReadableStreamState::Closed && state != ReadableStreamState::Errored) {
        readableStreamCloseIfPossible(globalObject, stream);
        RETURN_IF_EXCEPTION(scope, );
    }
    op->m_stream.clear();
}

static void rsisFinish(JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    op->m_didClose = true;
    auto* result = op->m_result.get();
    rsisDetachNativeTransform(globalObject, op);
    JSValue endResult = rsisSinkEnd(vm, globalObject, op);
    RETURN_IF_EXCEPTION(scope, );
    rsisFinally(vm, globalObject, op);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, resolvePromise(globalObject, result, endResult));
}

// The pump's `catch (e)`: the reader is deliberately orphaned, never released.
static void rsisAbrupt(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSValue error)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    op->m_didThrow = true;
    op->m_reader.clear();
    auto* result = op->m_result.get();
    if (auto* stream = op->m_stream.get())
        publicStreamCancelIgnoringResult(vm, globalObject, stream, error);
    JSValue rejectionValue = error;
    rsisDetachNativeTransform(globalObject, op);
    if (op->m_sink && !op->m_didClose) {
        op->m_didClose = true;
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        rsisSinkClose(vm, globalObject, op, error);
        if (catchScope.exception()) [[unlikely]] {
            JSValue secondError = takeAbruptCompletion(globalObject, catchScope);
            if (secondError.isEmpty())
                return;
            auto* errors = constructEmptyArray(globalObject, nullptr, 0);
            RETURN_IF_EXCEPTION(scope, );
            errors->putDirectIndex(globalObject, 0, error);
            RETURN_IF_EXCEPTION(scope, );
            errors->putDirectIndex(globalObject, 1, secondError);
            RETURN_IF_EXCEPTION(scope, );
            rejectionValue = createAggregateError(vm, globalObject->errorStructure(ErrorType::AggregateError), errors, String(), jsUndefined());
        }
    }
    rsisFinally(vm, globalObject, op);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, rejectPromise(globalObject, result, rejectionValue));
}

// One sink.write(chunk). wrote<0 = backpressure: stash tail on m_pendingBatch, suspend; m_onPull resumes.
static std::optional<bool> rsisWriteChunk(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSValue chunk, JSObject* batchValues, unsigned nextIndex, unsigned length)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue wrote = rsisSinkWrite(vm, globalObject, op, chunk);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    bool shouldSuspend = wrote.isNumber() && wrote.asNumber() < 0;
    if (auto* wrotePromise = dynamicDowncast<JSPromise>(wrote)) {
        markPromiseAsHandled(vm, wrotePromise);
        shouldSuspend = wrotePromise->status() == JSPromise::Status::Pending;
    }
    if (shouldSuspend) {
        if (batchValues && nextIndex < length) {
            auto* tail = constructEmptyArray(globalObject, nullptr, 0);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            unsigned tailIndex = 0;
            for (unsigned i = nextIndex; i < length; i++) {
                JSValue rest = batchValues->getIndex(globalObject, i);
                RETURN_IF_EXCEPTION(scope, std::nullopt);
                tail->putDirectIndex(globalObject, tailIndex++, rest);
                RETURN_IF_EXCEPTION(scope, std::nullopt);
            }
            op->m_pendingBatch.set(vm, op, tail);
        } else {
            op->m_pendingBatch.clear();
        }
        op->m_waitingOnSink = true;
        return false;
    }
    return true;
}

// Writes values[start..length); false = suspended on backpressure (or an exception is pending).
static bool rsisWriteChunkArrayFrom(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSObject* values, unsigned start, unsigned length)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    for (unsigned i = start; i < length; i++) {
        JSValue chunk = values->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, false);
        auto step = rsisWriteChunk(vm, globalObject, op, chunk, values, i + 1, length);
        RETURN_IF_EXCEPTION(scope, false);
        if (!step.value_or(false))
            return false;
    }
    return true;
}

static void rsisAfterBatch(JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    const auto* stream = op->m_stream.get();
    if (op->m_didClose || (stream && stream->m_state == ReadableStreamState::Closed)) {
        rsisFinish(globalObject, op);
        return;
    }
    rsisIssueRead(globalObject, op);
}

// m_onPull fired: drain stashed batch tail then resume the read loop.
static void rsisContinueAfterReady(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (op->m_didClose) {
        op->m_pendingBatch.clear();
        RELEASE_AND_RETURN(scope, rsisFinish(globalObject, op));
    }
    auto* tail = dynamicDowncast<JSArray>(op->m_pendingBatch.get());
    op->m_pendingBatch.clear();
    if (!tail) {
        RELEASE_AND_RETURN(scope, rsisIssueRead(globalObject, op));
    }
    bool completed = rsisWriteChunkArrayFrom(vm, globalObject, op, tail, 0, tail->length());
    RETURN_IF_EXCEPTION(scope, );
    if (!completed)
        return;
    RELEASE_AND_RETURN(scope, rsisAfterBatch(globalObject, op));
}

static void rsisRegisterAndStart(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    {
        auto* stream = op->m_stream.get();
        auto* runtime = WebCore::JSStreamsRuntime::from(globalObject);
        auto* onCloseBound = createBoundHandler(globalObject, runtime->boundReadStreamIntoSinkOnClose(), op);
        RETURN_IF_EXCEPTION(scope, );
        auto* onPullBound = createBoundHandler(globalObject, runtime->boundReadStreamIntoSinkOnReady(), op);
        RETURN_IF_EXCEPTION(scope, );
        JSValue onClose = wrapWithAsyncContext(globalObject, stream, onCloseBound);
        RETURN_IF_EXCEPTION(scope, );
        JSValue onPull = wrapWithAsyncContext(globalObject, stream, onPullBound);
        RETURN_IF_EXCEPTION(scope, );
        startJSSinkController(vm, globalObject, op->m_sink.get(), stream, onPull, onClose);
        RETURN_IF_EXCEPTION(scope, );
        double rawHighWaterMark = stream->m_bunHighWaterMark;
        auto* startOptions = constructEmptyObject(globalObject);
        startOptions->putDirect(vm, builtinNames(vm).highWaterMarkPublicName(), jsNumber(std::isnan(rawHighWaterMark) ? 0 : rawHighWaterMark));
        MarkedArgumentBuffer startArgs;
        startArgs.append(startOptions);
        ASSERT(!startArgs.hasOverflowed());
        invokeMethod(vm, globalObject, op->m_sink.get(), builtinNames(vm).startPublicName(), startArgs);
        RETURN_IF_EXCEPTION(scope, );
    }
    op->m_started = true;
}

static void rsisContinueWithMany(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSValue many)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* manyObject = many.getObject();
    if (!manyObject) [[unlikely]] {
        throwTypeError(globalObject, scope, "readMany() returned an invalid result"_s);
        return;
    }
    JSValue done = manyObject->get(globalObject, vm.propertyNames->done);
    RETURN_IF_EXCEPTION(scope, );
    bool isDone = done.toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    if (isDone) {
        RELEASE_AND_RETURN(scope, rsisFinish(globalObject, op));
    }
    if (!op->m_started) {
        rsisRegisterAndStart(vm, globalObject, op);
        RETURN_IF_EXCEPTION(scope, );
    }
    JSValue valuesValue = manyObject->get(globalObject, vm.propertyNames->value);
    RETURN_IF_EXCEPTION(scope, );
    JSObject* values = valuesValue.getObject();
    unsigned length = 0;
    if (values) {
        JSValue lengthValue = values->get(globalObject, vm.propertyNames->length);
        RETURN_IF_EXCEPTION(scope, );
        length = lengthValue.toUInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (length) {
        bool completed = rsisWriteChunkArrayFrom(vm, globalObject, op, values, 0, length);
        RETURN_IF_EXCEPTION(scope, );
        if (!completed)
            return;
    }
    RELEASE_AND_RETURN(scope, rsisAfterBatch(globalObject, op));
}

static void rsisIssueRead(JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = WebCore::JSStreamsRuntime::from(globalObject);
    auto* readRequest = WebCore::JSReadRequest::create(vm, runtime->readRequestStructure(domGlobalObject), ReadRequestKind::ReadStreamIntoSink, op);
    RELEASE_AND_RETURN(scope, readableStreamDefaultReaderRead(globalObject, op->m_reader.get(), readRequest));
}

static void rsisHandleChunk(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto step = rsisWriteChunk(vm, globalObject, op, chunk, nullptr, 0, 0);
    RETURN_IF_EXCEPTION(scope, );
    if (!step.value_or(false))
        return;
    // write() runs user code that may close the sink; re-check before the next read.
    RELEASE_AND_RETURN(scope, rsisAfterBatch(globalObject, op));
}

// `stream` is the readable half of a byte-producing native JSTransformStream subclass
// (Compression/Decompression/TextEncoder) → that transform; otherwise null.
static JSTransformStream* nativeByteTransformBehind(JSReadableStream* stream)
{
    if (stream->m_controllerKind != ControllerKind::Default)
        return nullptr;
    auto* defCtrl = uncheckedDowncast<JSReadableStreamDefaultController>(stream->m_controller.get());
    if (!defCtrl || defCtrl->m_algorithms.kind != SourceKind::Transform)
        return nullptr;
    auto* ts = dynamicDowncast<JSTransformStream>(defCtrl->m_algorithms.algorithmContext.get());
    if (!ts || !ts->m_controller)
        return nullptr;
    switch (ts->m_controller->m_transformerKind) {
    case TransformerKind::Compression:
    case TransformerKind::Decompression:
    case TransformerKind::TextEncoder:
        return ts;
    default:
        return nullptr;
    }
}

static void rsisBegin(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = op->m_stream.get();
    stream->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    auto* reader = acquireReadableStreamDefaultReader(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, );
    op->m_reader.set(vm, op, reader);
    reader->m_pipeOperation.set(vm, reader, op);
    // Byte-producing native transform + native JSSink: attach the sink to the transform so its
    // transform arms write coder output straight to the sink (no JSUint8Array per chunk). The
    // pump below still runs to drain any already-queued chunk, wait for done, and call end().
    // Attached only after the reader is acquired so a failed second attempt (stream already
    // locked) cannot overwrite the first pump's attachment.
    if (auto* ts = nativeByteTransformBehind(stream); ts && !ts->m_nativeSinkPtr) {
        if (auto* sinkCtrl = dynamicDowncast<WebCore::JSReadableSinkControllerBase>(op->m_sink.get())) {
            if (void* sinkPtr = sinkCtrl->wrapped()) {
                ts->m_nativeSinkPtr = sinkPtr;
                ts->m_nativeSinkId = static_cast<uint8_t>(sinkCtrl->sinkId());
                ts->m_nativeSinkCell.set(vm, ts, sinkCtrl);
                op->m_nativeTransform.set(vm, op, ts);
            }
        }
    }
    JSValue many = readableStreamDefaultReaderReadMany(globalObject, reader);
    RETURN_IF_EXCEPTION(scope, );
    if (auto* manyPromise = dynamicDowncast<JSPromise>(many)) {
        // The sink may abort before readMany settles (#6758): start it now.
        rsisRegisterAndStart(vm, globalObject, op);
        RETURN_IF_EXCEPTION(scope, );
        auto* runtime = WebCore::JSStreamsRuntime::from(globalObject);
        manyPromise->performPromiseThenWithContext(vm, globalObject, runtime->onReadStreamIntoSinkReadManyFulfilled(), runtime->onReadStreamIntoSinkRejected(), jsUndefined(), op);
        return;
    }
    RELEASE_AND_RETURN(scope, rsisContinueWithMany(vm, globalObject, op, many));
}

JSPromise* readStreamIntoSink(JSGlobalObject* globalObject, JSReadableStream* stream, JSObject* sink)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = WebCore::JSStreamsRuntime::from(globalObject);
    auto* op = JSReadStreamIntoSinkOperation::create(vm, runtime->readStreamIntoSinkOperationStructure(domGlobalObject));
    op->m_stream.set(vm, op, stream);
    op->m_sink.set(vm, op, sink);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    op->m_result.set(vm, op, result);
    rsisRunCatching(vm, globalObject, op, [&] {
        rsisBegin(vm, globalObject, op);
    });
    RETURN_IF_EXCEPTION(scope, nullptr);
    return result;
}

// readStreamIntoSinkOnClose(op, stream, reason) — the JSSink onClose [bound-convention] body.
static void readStreamIntoSinkOnCloseImpl(JSC::VM& vm, JSGlobalObject* globalObject, JSReadStreamIntoSinkOperation* op, JSValue streamValue, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    rsisDetachNativeTransform(globalObject, op);
    // The sink closed underneath the pump (which may stay suspended forever): end() FIRST,
    // before the fallible cancel below, so the controller cell always detaches from the
    // native sink instead of being collected attached (its destructor would over-release).
    if (JSObject* sink = op->m_sink.get()) {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        MarkedArgumentBuffer noArgs;
        invokeMethod(vm, globalObject, sink, builtinNames(vm).endPublicName(), noArgs);
        if (catchScope.exception()) [[unlikely]]
            catchScope.clearExceptionExceptTermination();
    }
    if (!op->m_didThrow && !op->m_didClose) {
        auto* stream = dynamicDowncast<JSReadableStream>(streamValue);
        if (stream && stream->m_state != ReadableStreamState::Closed) {
            auto* cancelPromise = readableStreamCancel(globalObject, stream, reason);
            if (scope.exception()) [[unlikely]] {
                op->m_didClose = true;
                return;
            }
            // The sink initiated this cancel (peer abort / sink close); the source's
            // cancel() rejection has no consumer, so keep it out of unhandledRejection.
            if (cancelPromise)
                markPromiseAsHandled(vm, cancelPromise);
        }
    }
    op->m_didClose = true;
    // end() detached m_onPull; drive a parked pump to completion so m_result settles.
    if (op->m_waitingOnSink) {
        op->m_waitingOnSink = false;
        scope.release();
        rsisRunCatching(vm, globalObject, op, [&] {
            rsisContinueAfterReady(vm, globalObject, op);
        });
    }
}

} // namespace WebStreams
} // namespace Bun

//                       The shared handler bodies (JSStreamsRuntime targets)

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

// [reaction-convention]: handler(resolutionValue, contextCell).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onNativePullFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(callFrame->argument(1));
    JSValue result = callFrame->argument(0);
    JSValue thrown;
    {
        auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        Bun::WebStreams::nativeSourcePullFulfilled(vm, globalObject, adapter, result);
        if (catchScope.exception()) [[unlikely]] {
            thrown = takeAbruptCompletion(globalObject, catchScope);
            if (thrown.isEmpty())
                return {};
        }
    }
    // Boundary: an internal decode failure errors the stream instead of escaping.
    if (!thrown.isEmpty()) {
        if (auto* controller = adapter->controller()) {
            readableStreamDefaultControllerError(globalObject, controller, thrown);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onNativePullRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(callFrame->argument(1));
    Bun::WebStreams::nativeSourcePullRejected(vm, globalObject, adapter, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onNativeSourceCallCloseMicrotask, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(callFrame->argument(1));
    Bun::WebStreams::nativeSourceCallClose(vm, globalObject, adapter);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadStreamIntoSinkReadManyFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSReadStreamIntoSinkOperation>(callFrame->argument(1));
    JSValue many = callFrame->argument(0);
    Bun::WebStreams::rsisRunCatching(vm, globalObject, op, [&] {
        Bun::WebStreams::rsisContinueWithMany(vm, globalObject, op, many);
    });
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadStreamIntoSinkChunk, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSReadStreamIntoSinkOperation>(callFrame->argument(1));
    JSValue chunk = callFrame->argument(0);
    Bun::WebStreams::rsisRunCatching(vm, globalObject, op, [&] {
        Bun::WebStreams::rsisHandleChunk(vm, globalObject, op, chunk);
    });
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadStreamIntoSinkClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSReadStreamIntoSinkOperation>(callFrame->argument(1));
    Bun::WebStreams::rsisRunCatching(vm, globalObject, op, [&] {
        Bun::WebStreams::rsisFinish(globalObject, op);
    });
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReadStreamIntoSinkRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSReadStreamIntoSinkOperation>(callFrame->argument(1));
    Bun::WebStreams::rsisAbrupt(vm, globalObject, op, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// [bound-convention]: handler(contextCell, ...callArgs).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundOnNativeSourceClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(callFrame->argument(0));
    Bun::WebStreams::nativeSourceOnClose(globalObject, adapter);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundOnNativeSourceDrain, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* adapter = uncheckedDowncast<JSNativeStreamSourceAdapter>(callFrame->argument(0));
    Bun::WebStreams::nativeSourceOnDrain(globalObject, adapter, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundReadDirectStreamOnClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* state = uncheckedDowncast<JSDirectSinkCloseState>(callFrame->argument(0));
    Bun::WebStreams::readDirectStreamCloseImpl(vm, globalObject, state, callFrame->argument(1), callFrame->argument(2));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundReadStreamIntoSinkOnClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSReadStreamIntoSinkOperation>(callFrame->argument(0));
    Bun::WebStreams::readStreamIntoSinkOnCloseImpl(vm, globalObject, op, callFrame->argument(1), callFrame->argument(2));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_boundReadStreamIntoSinkOnReady, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* op = uncheckedDowncast<JSReadStreamIntoSinkOperation>(callFrame->argument(0));
    // A native transform arm may be parked on m_nativeSinkReadyPromise without the
    // pump itself being suspended (output bypasses the pump's read loop). Resolve it
    // regardless of m_waitingOnSink so the transform's in-flight write can settle.
    if (auto* ts = op->m_nativeTransform.get()) {
        if (auto* ready = ts->m_nativeSinkReadyPromise.get()) {
            ts->m_nativeSinkReadyPromise.clear();
            Bun::WebStreams::resolvePromise(globalObject, ready, jsUndefined());
            scope.assertNoException();
        } else if (ts->m_codecPromise) {
            Bun::WebStreams::nativeCodecContinue(globalObject, ts);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    if (!op->m_waitingOnSink)
        return JSValue::encode(jsUndefined());
    op->m_waitingOnSink = false;
    Bun::WebStreams::rsisRunCatching(vm, globalObject, op, [&] {
        Bun::WebStreams::rsisContinueAfterReady(vm, globalObject, op);
    });
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
