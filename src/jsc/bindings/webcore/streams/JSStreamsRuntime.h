// JSStreamsRuntime — the ONE per-global container holding every piece of per-global Web
// Streams state: the two CLOSED handler-function lists, the per-realm queuing-strategy
// `size` functions, and the cached Structures of every internal (prototype-less) cell class.
// Not a GC cell: a plain struct held BY VALUE on Zig::GlobalObject (visited via
// `JSStreamsRuntime::visit` from the global's visitChildren) and reached through
// `globalObject->streamsRuntime()`; do NOT add per-function fields to ZigGlobalObject. Every
// handler / size function / Structure is a LazyProperty<JSGlobalObject, T> materialized on
// first use.
//
// THE TWO CALLABLE MECHANISMS — the ONLY two. Anything else (a per-stream JSFunction, ANY
// capturing JSNativeStdFunction) is FORBIDDEN in this subsystem.
//
// [reaction-convention] — FOR_EACH_WEB_STREAMS_REACTION_HANDLER. Registered ONLY through
//   `promise->performPromiseThenWithContext(vm, global, onFulfilled, onRejected,
//    resultPromiseOrJSUndefined, contextCell)`. The handler is invoked as
//        handler(resolutionValue, contextCell)          // context at argument(1)
//   with `this` = undefined. The SAME convention is used for the native
//   `queueMicrotask(handler, value, contextCell)` deferrals, so a reaction handler is
//   reusable as a microtask job. Every handler is a BOUNDARY: it must convert any internal
//   failure into the spec action and never return with a pending exception.
//
// [bound-convention] — FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET. The shared function is
//   NEVER called directly; it is wrapped per use-site in
//   `JSC::JSBoundFunction::create(vm, global, target, jsUndefined(), {contextCell}, ...)`
//   and STORED ON an object we do not control (the native source handle, the JSSink
//   controller). `boundFunctionCall` PREPENDS the bound args, so the target receives
//        handler(contextCell, ...callArgs)              // context at argument(0)
//   — the OPPOSITE position. A function may belong to EXACTLY ONE of the two lists.
//
// Both handler lists are CLOSED: adding a handler requires a new macro entry here plus a
// JSC_DEFINE_HOST_FUNCTION in the owner .cpp; it changes no signature.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/Structure.h>
#include <utility>

namespace WebCore {

// [reaction-convention] handlers, grouped by the .cpp that OWNS the body.
// Signature of every entry:  name(JSC::JSValue resolutionValue, contextCell at argument(1)).

// owner: WebStreamsMisc.cpp — the shared "fulfillment step that returns undefined" / no-op
// reaction (readableStreamCancel; readDirectStream's `.then(noop)`). context: unused.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_MISC(V) \
    V(onReturnUndefined)

// owner: JSReadableStreamDefaultController.cpp. context = JSReadableStreamDefaultController.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_RS_DEFAULT_CONTROLLER(V) \
    V(onRSDefaultControllerStartFulfilled)                             \
    V(onRSDefaultControllerStartRejected)                              \
    V(onRSDefaultControllerPullFulfilled)                              \
    V(onRSDefaultControllerPullRejected)

// owner: JSReadableByteStreamController.cpp. context = JSReadableByteStreamController.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_RS_BYTE_CONTROLLER(V) \
    V(onRSByteControllerStartFulfilled)                             \
    V(onRSByteControllerStartRejected)                              \
    V(onRSByteControllerPullFulfilled)                              \
    V(onRSByteControllerPullRejected)

// owner: ReadableStreamOperations.cpp.
//   FromIterable: context = the JSReadableStreamDefaultController (its algorithmContext is
//     the JSStreamFromIterableContext).
//   Tee: context = the JSStreamTeeState, except onByteTeeReaderClosedRejected whose context
//     is an InternalFieldTuple{teeState, thisReader}.
//   The two *Microtask entries are the tee chunk-steps "queue a microtask" jobs.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_RS_OPERATIONS(V) \
    V(onFromIterablePullFulfilled)                             \
    V(onFromIterableCancelFulfilled)                           \
    V(onDefaultTeeReadChunkMicrotask)                          \
    V(onDefaultTeeReaderClosedRejected)                        \
    V(onByteTeeReadChunkMicrotask)                             \
    V(onByteTeeReadIntoChunkMicrotask)                         \
    V(onByteTeeReaderClosedRejected)

// owner: BunAsyncIterableSource.cpp. context = the JSAsyncIteratorSourceOperation, EXCEPT
// onAsyncIterableSourceErrorRethrow / onAsyncIterableSourceErrorSwallowed, whose context is
// an InternalFieldTuple{op, originalError} (registered on iter.throw()'s settlement).
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_ASYNC_ITERABLE_SOURCE(V) \
    V(onAsyncIterableSourceNextFulfilled)                              \
    V(onAsyncIterableSourceFlushFulfilled)                             \
    V(onAsyncIterableSourceErrored)                                    \
    V(onAsyncIterableSourceEndFulfilled)                               \
    V(onAsyncIterableSourceCleanupSettled)                             \
    V(onAsyncIterableSourceErrorRethrow)                               \
    V(onAsyncIterableSourceErrorSwallowed)

// owner: JSReadableStreamAsyncIterator.cpp. context = the JSReadableStreamAsyncIterator,
// EXCEPT onAsyncIteratorReturnAfterOngoingSettled and onAsyncIteratorCancelFulfilled, whose
// context is an InternalFieldTuple{iterator, value} (the return()/cancel value may be null/undefined).
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_ASYNC_ITERATOR(V) \
    V(onAsyncIteratorNextAfterOngoingSettled)                   \
    V(onAsyncIteratorReturnAfterOngoingSettled)                 \
    V(onAsyncIteratorCancelFulfilled)                           \
    V(onAsyncIteratorResolveMicrotask)                          \
    V(onAsyncIteratorRejectMicrotask)

// owner: JSStreamPipeToOperation.cpp. context = the JSStreamPipeToOperation, EXCEPT
// onPipeChunkDeferredWrite, whose context is an InternalFieldTuple{op, m_currentWrite
// promise} and whose argument is the chunk (the pipe's deferred sink write job).
// onPipeWriteSettled is registered as BOTH the fulfillment and the rejection handler of
// every write-request promise (the pipe must react to every one).
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_PIPE(V) \
    V(onPipeChunkDeferredWrite)                       \
    V(onPipeSourceClosedFulfilled)                    \
    V(onPipeSourceClosedRejected)                     \
    V(onPipeDestClosedFulfilled)                      \
    V(onPipeDestClosedRejected)                       \
    V(onPipeWriterReadyFulfilled)                     \
    V(onPipeWriteSettled)                             \
    V(onPipeWritesFinishedForShutdown)                \
    V(onPipeShutdownActionFulfilled)                  \
    V(onPipeShutdownActionRejected)

// owner: WritableStreamOperations.cpp. context = the JSWritableStream.
// (WritableStreamFinishErroring's reaction to the [[AbortSteps]] promise.)
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_WS_OPERATIONS(V) \
    V(onWSAbortStepsFulfilled)                                 \
    V(onWSAbortStepsRejected)

// owner: JSWritableStreamDefaultController.cpp. context = JSWritableStreamDefaultController.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_WS_CONTROLLER(V) \
    V(onWSControllerStartFulfilled)                            \
    V(onWSControllerStartRejected)                             \
    V(onWSSinkCloseFulfilled)                                  \
    V(onWSSinkCloseRejected)                                   \
    V(onWSSinkWriteFulfilled)                                  \
    V(onWSSinkWriteRejected)

// owner: TransformStreamOperations.cpp. context = the JSTransformStream, EXCEPT
// onTSSinkAbortCancel{Fulfilled,Rejected} and onTSSourceCancel{Fulfilled,Rejected},
// whose context is an InternalFieldTuple{transformStream, reason}.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_TS_OPERATIONS(V) \
    V(onTSSinkWriteBackpressureChangeFulfilled)                \
    V(onTSSinkAbortCancelFulfilled)                            \
    V(onTSSinkAbortCancelRejected)                             \
    V(onTSSinkCloseFlushFulfilled)                             \
    V(onTSSinkCloseFlushRejected)                              \
    V(onTSSourceCancelFulfilled)                               \
    V(onTSSourceCancelRejected)

// owner: JSTransformStreamDefaultController.cpp. context = JSTransformStreamDefaultController.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_TS_CONTROLLER(V) \
    V(onTSPerformTransformRejected)

// owner: BunStreamSource.cpp.
//   onNativePull*: context = the JSNativeStreamSourceAdapter.
//   onNativeSourceCallCloseMicrotask: the native source's `queueMicrotask(callClose)` job;
//     context = the adapter.
//   onReadStreamIntoSink*: context = the JSReadStreamIntoSinkOperation.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_SOURCE(V) \
    V(onNativePullFulfilled)                                \
    V(onNativePullRejected)                                 \
    V(onNativeSourceCallCloseMicrotask)                     \
    V(onReadStreamIntoSinkReadManyFulfilled)                \
    V(onReadStreamIntoSinkChunk)                            \
    V(onReadStreamIntoSinkClose)                            \
    V(onReadStreamIntoSinkRejected)

// owner: JSDirectStreamController.cpp. context = the JSDirectStreamController.
//   onDirectEndOfTickFlush: the end-of-tick auto-flush job, scheduled via
//     process.nextTick(handler, undefined, controller) — it still uses the
//     reaction-convention context position (argument 1).
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_DIRECT_CONTROLLER(V) \
    V(onDirectPullFulfilled)                                       \
    V(onDirectPullRejected)                                        \
    V(onDirectEndOfTickFlush)

// owner: JSReadableStreamDefaultReader.cpp (readMany). context = the reader.
//   onReadManyPullFulfilled: controller.$pull()'s fulfillment.
//   onReadManyDirectPullFulfilled: the Direct (not-yet-started) controller branch: maps
//     directController->onPull()'s {done,value} into the readMany {value,size,done} result
//     shape (a DIFFERENT mapping from onReadManyPullFulfilled's).
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_READER(V) \
    V(onReadManyPullFulfilled)                          \
    V(onReadManyDirectPullFulfilled)

// owner: BunStreamConsumers.cpp.
//   onBufferedFastPath*: context = the JSReadableStream (the fast path's catch/finally pair).
//   onReadableStreamTo*Fulfilled: the generic-path promise chains
//     (toArrayBuffer/toBytes/toBlob: value = the chunk array; toJSON: value = the text;
//      toFormData: value = the Blob, context = the contentType JSString).
//   onIntoArrayReadMany*: readableStreamIntoArray's readMany() continuation (readMany may
//     return a Promise); context = an InternalFieldTuple{reader, resultArray}.
//   onDirectConsumeLoopRead*: the readableStreamTo{Text,Array}Direct read loop;
//     context = an InternalFieldTuple{stream, reader}.
//   onConsumeDirectToArrayBufferPull*: the one-shot pull's settlement; context = the
//     JSOneShotDirectSink cell (it roots the stream, the ArrayBufferSink, the capability
//     promise, and the closed flag — see JSOneShotDirectSink.h).
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_CONSUMERS(V)                                               \
    V(onBufferedFastPathRejected)                                                                            \
    V(onBufferedFastPathSettled)                                                                             \
    V(onReadableStreamToArrayBufferFulfilled)                                                                \
    V(onReadableStreamToBytesFulfilled)                                                                      \
    V(onReadableStreamToTextChunksFulfilled)                                                                 \
    V(onReadableStreamToJSONFulfilled)                                                                       \
    V(onReadableStreamToBlobFulfilled)                                                                       \
    V(onReadableStreamToFormDataFulfilled)                                                                   \
    V(onIntoArrayReadManyFulfilled) /* append value; !done => readMany() again; done => release + resolve */ \
    V(onIntoArrayReadManyRejected) /* release the reader, reject the result promise */                       \
    V(onIntoArrayReadFulfilled) /* persistent-op pump: append the read chunk, keep filling */                \
    V(onIntoArrayReadRejected) /* persistent-op pump: release the reader, reject the result */               \
    V(onDirectConsumeLoopReadFulfilled)                                                                      \
    V(onDirectConsumeLoopReadRejected)                                                                       \
    V(onConsumeDirectToArrayBufferPullFulfilled)                                                             \
    V(onConsumeDirectToArrayBufferPullRejected)

// THE closed [reaction-convention] list.
#define FOR_EACH_WEB_STREAMS_REACTION_HANDLER(V)                   \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_MISC(V)                  \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_RS_DEFAULT_CONTROLLER(V) \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_RS_BYTE_CONTROLLER(V)    \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_RS_OPERATIONS(V)         \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_ASYNC_ITERATOR(V)        \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_ASYNC_ITERABLE_SOURCE(V) \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_PIPE(V)                  \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_WS_OPERATIONS(V)         \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_WS_CONTROLLER(V)         \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_TS_OPERATIONS(V)         \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_TS_CONTROLLER(V)         \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_SOURCE(V)            \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_DIRECT_CONTROLLER(V)     \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_READER(V)                \
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_CONSUMERS(V)

// [bound-convention] targets, grouped by the .cpp that OWNS the body.
// Signature of every entry:  name(contextCell at argument(0), ...callArgs).

// owner: BunStreamSource.cpp.
//   boundOnNativeSourceClose(adapter) / boundOnNativeSourceDrain(adapter, chunk): stored as
//     handle.onClose / handle.onDrain.
//   boundReadDirectStreamOnClose(state, streamOrUndefined, reason): readDirectStream's
//     JSSink onClose.
//   boundReadStreamIntoSinkOnClose(op, stream, reason): readStreamIntoSink's JSSink onClose.
//   boundReadStreamIntoSinkOnReady(op, controller, amt, offset): JSSink m_onPull resume after backpressure.
#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_BUN_SOURCE(V) \
    V(boundOnNativeSourceClose)                                 \
    V(boundOnNativeSourceDrain)                                 \
    V(boundReadDirectStreamOnClose)                             \
    V(boundReadStreamIntoSinkOnClose)                           \
    V(boundReadStreamIntoSinkOnReady)

// owner: JSDirectStreamController.cpp — the FIVE detachable own methods of the direct
// controller: `end` and `close` are two bound cells over the ONE boundDirectClose target.
#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_DIRECT_CONTROLLER(V) \
    V(boundDirectWrite)                                                \
    V(boundDirectClose)                                                \
    V(boundDirectFlush)                                                \
    V(boundDirectError)

// owner: BunStreamConsumers.cpp — the one-shot direct consumer's throwaway controller
// (consumeDirectStreamToArrayBuffer). Its {start, write, end, close, flush} are OWN
// JSBoundFunctions over these; context (argument 0) = the JSOneShotDirectSink cell. This
// path deliberately does NOT reuse boundDirect* / JSDirectStreamController.
#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ONE_SHOT(V)                                   \
    V(boundOneShotStart) /* `start` is bound to this no-op target that returns undefined */     \
    V(boundOneShotDirectWrite)                                                                  \
    V(boundOneShotDirectClose) /* `end` and `close` are two bound cells over this one target */ \
    V(boundOneShotDirectFlush)

// owner: JSStreamPipeToOperation.cpp — the pipe's AbortSignal abort algorithm.
// `readableStreamPipeTo({signal})` registers it through the GC-visited
// addAbortAlgorithmToSignal API, whose JSAbortAlgorithm wraps ONE JSObject* callback invoked
// as `(reason)` with no context slot — so the callable MUST be a JSBoundFunction over this
// target with the op cell bound at argument 0: boundPipeAbortAlgorithm(pipeOpCell, reason).
#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_PIPE(V) \
    V(boundPipeAbortAlgorithm)

// owner: BunAsyncIterableSource.cpp — the async-iterable direct source's three methods.
// Bound context (argument 0) = the JSAsyncIteratorSourceOperation.
#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ASYNC_ITERABLE_SOURCE(V) \
    V(boundAsyncIterableSourcePull)                                        \
    V(boundAsyncIterableSourceCancel)                                      \
    V(boundAsyncIterableSourceClose)

// THE closed [bound-convention] list.
#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(V)               \
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_BUN_SOURCE(V)        \
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_DIRECT_CONTROLLER(V) \
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ONE_SHOT(V)          \
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_PIPE(V)              \
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ASYNC_ITERABLE_SOURCE(V)

// The native trampolines behind every handler. Each is DEFINED (JSC_DEFINE_HOST_FUNCTION)
// in its owner .cpp above; JSStreamsRuntime.cpp only wraps them in shared JSFunctions.
#define WEB_STREAMS_DECLARE_HANDLER_HOST_FUNCTION(name) \
    JSC_DECLARE_HOST_FUNCTION(jsWebStreamsHandler_##name);
FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_DECLARE_HANDLER_HOST_FUNCTION)
FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_DECLARE_HANDLER_HOST_FUNCTION)
#undef WEB_STREAMS_DECLARE_HANDLER_HOST_FUNCTION

// The per-realm queuing-strategy size functions (owner: WebStreamsMisc.cpp).
JSC_DECLARE_HOST_FUNCTION(jsWebStreamsByteLengthQueuingStrategySize);
JSC_DECLARE_HOST_FUNCTION(jsWebStreamsCountQueuingStrategySize);

// The internal (prototype-less) cell classes whose per-global Structure is cached here.
// V(memberName, ClassName)
#define FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(V)                           \
    V(readRequestStructure, JSReadRequest)                                   \
    V(readIntoRequestStructure, JSReadIntoRequest)                           \
    V(pullIntoDescriptorStructure, JSPullIntoDescriptor)                     \
    V(pipeToOperationStructure, JSStreamPipeToOperation)                     \
    V(teeStateStructure, JSStreamTeeState)                                   \
    V(fromIterableContextStructure, JSStreamFromIterableContext)             \
    V(directStreamControllerStructure, JSDirectStreamController)             \
    V(nativeStreamSourceAdapterStructure, JSNativeStreamSourceAdapter)       \
    V(directSinkCloseStateStructure, JSDirectSinkCloseState)                 \
    V(asyncIteratorSourceOperationStructure, JSAsyncIteratorSourceOperation) \
    V(readStreamIntoSinkOperationStructure, JSReadStreamIntoSinkOperation)   \
    V(standaloneTextSinkStructure, JSBunStandaloneTextSink)                  \
    V(oneShotDirectSinkStructure, JSOneShotDirectSink)                       \
    V(intoArrayOperationStructure, JSReadableStreamIntoArrayOperation)

class JSStreamsRuntime final {
    WTF_MAKE_NONCOPYABLE(JSStreamsRuntime);

public:
#define WEB_STREAMS_STRUCTURE_INDEX_ENTRY(memberName, ClassName) memberName,
    enum class InternalStructure : uint8_t {
        FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_STRUCTURE_INDEX_ENTRY)
            Count
    };
#undef WEB_STREAMS_STRUCTURE_INDEX_ENTRY

    // Index of every handler in m_handlers, in macro order (both lists).
    // clang-format off
#define WEB_STREAMS_HANDLER_INDEX_ENTRY(name) name,
    enum class Handler : uint8_t {
        FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_HANDLER_INDEX_ENTRY)
        FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_HANDLER_INDEX_ENTRY)
        Count
    };
#undef WEB_STREAMS_HANDLER_INDEX_ENTRY
    // clang-format on

    JSStreamsRuntime() = default;
    void initialize(Zig::GlobalObject*);

    // The one accessor everything uses: `defaultGlobalObject(global)->streamsRuntime()`
    // behind a free function so streams .cpp files do not include ZigGlobalObject.h.
    static JSStreamsRuntime* from(JSC::JSGlobalObject*);

    // Called from Zig::GlobalObject::visitChildren. MUST visit EVERY handler
    // LazyProperty (both macro lists), the two size-function LazyProperties, and every
    // LazyProperty in FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE. Safe on a
    // default-constructed instance (LazyProperty::visit is a no-op for m_pointer == 0).
    template<typename Visitor>
    void visit(Visitor&);

    // The shared handler functions. Each LazyProperty materializes the JSFunction on FIRST
    // use; the global is the owner passed to `init.owner`.
#define WEB_STREAMS_DECLARE_HANDLER_ACCESSOR(name) \
    JSC::JSFunction* name() const { return m_handlers[static_cast<size_t>(Handler::name)].getInitializedOnMainThread(m_globalObject); }
    FOR_EACH_WEB_STREAMS_REACTION_HANDLER(WEB_STREAMS_DECLARE_HANDLER_ACCESSOR)
    FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET(WEB_STREAMS_DECLARE_HANDLER_ACCESSOR)
#undef WEB_STREAMS_DECLARE_HANDLER_ACCESSOR

    // The per-realm queuing-strategy size functions (spec: same function object per realm;
    // %ByteLengthQueuingStrategy%.prototype.size / %CountQueuingStrategy%.prototype.size).
    JSC::JSFunction* byteLengthQueuingStrategySizeFunction(const Zig::GlobalObject*);
    JSC::JSFunction* countQueuingStrategySizeFunction(const Zig::GlobalObject*);

    // The cached Structures of the internal cells.
#define WEB_STREAMS_DECLARE_STRUCTURE_ACCESSOR(memberName, ClassName) \
    JSC::Structure* memberName(const Zig::GlobalObject*);
    FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE(WEB_STREAMS_DECLARE_STRUCTURE_ACCESSOR)
#undef WEB_STREAMS_DECLARE_STRUCTURE_ACCESSOR

    // The readMany `{value, size, done}` result shape, so results are built with
    // putDirectOffset instead of three transitioning putDirects.
    JSC::Structure* readManyResultStructure(const Zig::GlobalObject*);
    static constexpr JSC::PropertyOffset readManyResultValueOffset = 0;
    static constexpr JSC::PropertyOffset readManyResultSizeOffset = 1;
    static constexpr JSC::PropertyOffset readManyResultDoneOffset = 2;

    // `{ done, value }` of a readMany() result: the slots while `result` has readManyResultStructure, else `get(done)` then `get(value)` (both empty if either throws).
    std::pair<JSC::JSValue, JSC::JSValue> readManyResult(JSC::JSGlobalObject*, JSC::JSObject* result) const;

private:
    JSC::JSGlobalObject* m_globalObject { nullptr };

    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSFunction> m_handlers[static_cast<size_t>(Handler::Count)];

    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSFunction> m_byteLengthQueuingStrategySizeFunction;
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSFunction> m_countQueuingStrategySizeFunction;

    JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure> m_internalStructures[static_cast<size_t>(InternalStructure::Count)];
    JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure> m_readManyResultStructure;
};

inline std::pair<JSC::JSValue, JSC::JSValue> JSStreamsRuntime::readManyResult(JSC::JSGlobalObject* globalObject, JSC::JSObject* result) const
{
    if (result->structureID() == m_readManyResultStructure.getInitializedOnMainThread(m_globalObject)->id()) [[likely]]
        return { result->getDirect(readManyResultDoneOffset), result->getDirect(readManyResultValueOffset) };

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue done = result->get(globalObject, vm.propertyNames->done);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSValue value = result->get(globalObject, vm.propertyNames->value);
    RETURN_IF_EXCEPTION(scope, {});
    return { done, value };
}

} // namespace WebCore
