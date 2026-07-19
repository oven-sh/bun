// WebStreamsInternals.h — THE FROZEN ABI of the Web Streams C++ implementation.
// Every cross-file free function of the subsystem is declared here, EXACTLY ONCE, grouped
// by the .cpp that OWNS its body. NO definitions live here.
//
// Every declaration carries:   // userJS: yes|no — <owner .cpp>
//   "userJS: yes" = the op can synchronously run arbitrary user JS (directly, through a
//   thenable, or transitively) — callers must re-validate every reentrantly-mutable piece of
//   controller/stream state after the call.
//   "userJS: no"  = it never does (it may still allocate / throw unless noted "pure").
//
// The reaction / bound-callable handler lists (the OTHER half of the ABI) live in
// JSStreamsRuntime.h. The queue ops (EnqueueValueWithSize / DequeueValue / PeekQueueValue /
// ResetQueue) are StreamQueue<> methods (StreamQueue.h). The controller internal methods
// ([[PullSteps]] / [[CancelSteps]] / [[ReleaseSteps]] / [[AbortSteps]] / [[ErrorSteps]]) are
// members of their controller class.
#pragma once

#include "root.h"
#include "StreamsForward.h"
#include "BunStreamConsumers.h"

// These three are used by name below (`JSC::JSUint8Array*` is a typedef and cannot be
// forward-declared; `const JSC::Identifier&`; `WTF::String`) — do not rely on transitive
// includes from root.h for them. MarkedVector.h supplies JSC::MarkedArgumentBuffer.
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/MarkedVector.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/ThrowScope.h>
#include <optional>
#include <utility>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include "helpers.h"
#include <wtf/text/StringImpl.h>

namespace WebCore {
class MessagePort;
class AbortSignal;
}

namespace Bun {
namespace WebStreams {

// Building a string past this limit would abort the process inside WTF; text consumers
// check it and throw a catchable out-of-memory error instead. Mirrors the predicate
// Bun's string constructors use (helpers.h), including the synthetic limit that
// `bun:internal-for-testing` can lower.
inline bool exceedsStringLimit(size_t length)
{
    return length > Bun__stringSyntheticAllocationLimit || length > WTF::StringImpl::MaxLength;
}

// Reduce noise: every class name below is a WebCore JS cell (StreamsForward.h).
using WebCore::JSCrossRealmTransformState;
using WebCore::JSDirectSinkCloseState;
using WebCore::JSDirectStreamController;
using WebCore::JSNativeStreamSourceAdapter;
using WebCore::JSPullIntoDescriptor;
using WebCore::JSReadableByteStreamController;
using WebCore::JSReadableStream;
using WebCore::JSReadableStreamAsyncIterator;
using WebCore::JSReadableStreamBYOBReader;
using WebCore::JSReadableStreamBYOBRequest;
using WebCore::JSReadableStreamDefaultController;
using WebCore::JSReadableStreamDefaultReader;
using WebCore::JSReadableStreamReaderBase;
using WebCore::JSReadIntoRequest;
using WebCore::JSReadRequest;
using WebCore::JSReadStreamIntoSinkOperation;
using WebCore::JSResumableSinkPumpOperation;
using WebCore::JSStreamFromIterableContext;
using WebCore::JSStreamPipeToOperation;
using WebCore::JSStreamsRuntime;
using WebCore::JSStreamTeeState;
using WebCore::JSTextDecoderStream;
using WebCore::JSTextEncoderStream;
using WebCore::JSTransformStream;
using WebCore::JSTransformStreamDefaultController;
using WebCore::JSWritableStream;
using WebCore::JSWritableStreamDefaultController;
using WebCore::JSWritableStreamDefaultWriter;

// Converted WebIDL dictionaries. STACK-ONLY carriers: the JSValues are rooted by the
// conservative stack scan for the constructor's duration and are NEVER stored. A member is
// the empty JSValue when the dictionary member is absent. The conversion itself (below,
// WebStreamsMisc.cpp) performs the observable alphabetical-order [[Get]]s and the
// callability TypeErrors.

struct UnderlyingSourceDict {
    JSC::JSValue start; // callable or empty
    JSC::JSValue pull; // callable or empty
    JSC::JSValue cancel; // callable or empty
    std::optional<ReadableStreamType> type; // "bytes" or absent
    std::optional<uint64_t> autoAllocateChunkSize; // [EnforceRange] unsigned long long
};
struct UnderlyingSinkDict {
    JSC::JSValue start; // callable or empty
    JSC::JSValue write; // callable or empty
    JSC::JSValue close; // callable or empty
    JSC::JSValue abort; // callable or empty
    bool hasType { false }; // presence alone triggers the constructor's RangeError
};
struct TransformerDict {
    JSC::JSValue start; // callable or empty
    JSC::JSValue transform; // callable or empty
    JSC::JSValue flush; // callable or empty
    JSC::JSValue cancel; // callable or empty
    bool hasReadableType { false }; // presence alone triggers the constructor's RangeError
    bool hasWritableType { false }; // presence alone triggers the constructor's RangeError
};
struct QueuingStrategyDict {
    std::optional<double> highWaterMark; // absent vs present-NaN are distinct states
    JSC::JSValue size; // callable or empty (empty ⇒ the default `() => 1`)
};

// WebStreamsMisc.cpp — shared utilities, promise helpers, dictionary conversion, and the ONE
// sanctioned catch helper.

// spec ExtractHighWaterMark(strategy, defaultHWM). Throws RangeError (NaN / negative).
double extractHighWaterMark(JSC::JSGlobalObject*, const QueuingStrategyDict&, double defaultHWM); // userJS: no — WebStreamsMisc.cpp
// spec ExtractSizeAlgorithm(strategy) → the converted callback object; nullptr = `() => 1`.
JSC::JSObject* extractSizeAlgorithm(const QueuingStrategyDict&); // userJS: no — WebStreamsMisc.cpp
// spec IsNonNegativeNumber(v) — pure type + range test, NO coercion.
bool isNonNegativeNumber(JSC::JSValue); // userJS: no — WebStreamsMisc.cpp
// spec TransferArrayBuffer(O). Throws TypeError on a non-transferable buffer.
// (Runs no JS, but DETACHES `buffer`: callers must re-read any cached view length/vector()
// of the SOURCE buffer afterward.)
RefPtr<JSC::ArrayBuffer> transferArrayBufferImpl(JSC::JSGlobalObject*, JSC::ArrayBuffer&); // userJS: no — WebStreamsMisc.cpp
bool canTransferArrayBuffer(JSC::ArrayBuffer&); // userJS: no — WebStreamsMisc.cpp
// spec CanTransferArrayBuffer(O) — pure.
// spec CloneAsUint8Array(O) — allocation-throws only.
JSC::JSUint8Array* cloneAsUint8Array(JSC::JSGlobalObject*, JSC::JSArrayBufferView*); // userJS: no — WebStreamsMisc.cpp
// spec StructuredClone(v): use the EXISTING WebCore::structuredCloneForStream
// (src/jsc/bindings/webcore/StructuredClone.h). No streams-local duplicate is declared.
// spec CanCopyDataBlockBytes(toBuffer, toIndex, fromBuffer, fromIndex, count) — pure.
bool canCopyDataBlockBytes(JSC::ArrayBuffer& toBuffer, size_t toIndex, JSC::ArrayBuffer& fromBuffer, size_t fromIndex, size_t count); // userJS: no — WebStreamsMisc.cpp

// The WebIDL dictionary conversions (alphabetical member order; real [[Get]]s; TypeError on
// a present-but-not-callable member; ReadableStreamType TypeError on an unknown `type`).
UnderlyingSinkDict convertUnderlyingSinkDict(JSC::JSGlobalObject*, JSC::JSValue underlyingSink); // userJS: yes — WebStreamsMisc.cpp
TransformerDict convertTransformerDict(JSC::JSGlobalObject*, JSC::JSValue transformer); // userJS: yes — WebStreamsMisc.cpp
QueuingStrategyDict convertQueuingStrategyDict(JSC::JSGlobalObject*, JSC::JSValue strategy); // userJS: yes — WebStreamsMisc.cpp

// Promise helpers (thin, named after the spec phrases).
// "a promise resolved with v" — resolving with ANY OBJECT (not only a user thenable) performs
// Get(v, "then"), so a user-installed `Object.prototype.then` getter runs synchronously —
// even for OUR fresh `{value, done}` result objects. Only primitive resolutions
// (undefined / true / ...) are exempt. Do NOT "optimize" a fulfillment site to skip
// re-validation on the grounds that the resolution value is internally constructed.
JSC::JSPromise* promiseFulfilledWith(JSC::JSGlobalObject*, JSC::JSValue); // userJS: no — WebStreamsMisc.cpp
// [bound-convention] wrapper: target(contextCell, ...callArgs). userJS: no — WebStreamsMisc.cpp
JSC::JSBoundFunction* createStreamsBoundHandler(JSC::JSGlobalObject*, JSC::JSFunction* target, JSC::JSCell* context);
// obj.name(...args); returns the EMPTY value when `name` is not callable. userJS: yes — WebStreamsMisc.cpp
JSC::JSValue invokeOptionalMethod(JSC::JSGlobalObject*, JSC::JSObject*, const JSC::Identifier& name, const JSC::MarkedArgumentBuffer&);
// error.code === code, swallowing any lookup exception. userJS: yes — WebStreamsMisc.cpp
bool errorCodeIs(JSC::JSGlobalObject*, JSC::JSValue error, WTF::ASCIILiteral code);
JSC::JSPromise* promiseResolvedWith(JSC::JSGlobalObject*, JSC::JSValue); // userJS: yes — WebStreamsMisc.cpp
// "a promise rejected with r" (rejection never does a `then` lookup)
JSC::JSPromise* promiseRejectedWith(JSC::JSGlobalObject*, JSC::JSValue); // userJS: no — WebStreamsMisc.cpp
// "resolve promise with v" — SAME `Object.prototype.then` hazard as promiseResolvedWith:
// resolving with ANY object (user-controlled or our own) runs user JS.
void resolvePromise(JSC::JSGlobalObject*, JSC::JSPromise*, JSC::JSValue); // userJS: yes — WebStreamsMisc.cpp
// "reject promise with r"
void rejectPromise(JSC::JSGlobalObject*, JSC::JSPromise*, JSC::JSValue); // userJS: no — WebStreamsMisc.cpp
// "Set promise.[[PromiseIsHandled]] to true"
void markPromiseAsHandled(JSC::VM&, JSC::JSPromise*); // userJS: no — WebStreamsMisc.cpp
// {value,done} results: use JSC::createIteratorResultObject
// (<JavaScriptCore/IteratorOperations.h>; VM-cached structure).

// The stream-level closed promise: node:stream's finished() observes a terminal state without
// locking the stream, so it cannot use the reader's/writer's [[closedPromise]]. Created on the
// first webStreamClosedPromise() call and cached on the cell; settled from EVERY terminal
// transition below. Settling is a no-op when nothing ever asked for the promise, and always
// settles with a primitive / the stored error, so none of these can run user JS or throw.
JSC::JSPromise* webStreamClosedPromise(JSC::JSGlobalObject*, JSReadableStream*); // userJS: no — WebStreamsMisc.cpp
JSC::JSPromise* webStreamClosedPromise(JSC::JSGlobalObject*, JSWritableStream*); // userJS: no — WebStreamsMisc.cpp
void resolveStreamClosedPromise(JSC::VM&, JSReadableStream*); // userJS: no — WebStreamsMisc.cpp
void resolveStreamClosedPromise(JSC::VM&, JSWritableStream*); // userJS: no — WebStreamsMisc.cpp
void rejectStreamClosedPromise(JSC::VM&, JSReadableStream*, JSC::JSValue error); // userJS: no — WebStreamsMisc.cpp
void rejectStreamClosedPromise(JSC::VM&, JSWritableStream*, JSC::JSValue error); // userJS: no — WebStreamsMisc.cpp

// `$webStreamControllerError` — node:stream's addAbortSignal() erroring a WHATWG stream, i.e.
// what `controller.error(e)` does, including its no-op once the stream left readable/writable.
void webStreamControllerError(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue error); // userJS: yes — ReadableStreamOperations.cpp
void webStreamControllerError(JSC::JSGlobalObject*, JSWritableStream*, JSC::JSValue error); // userJS: yes — WritableStreamOperations.cpp

// THE ONE SANCTIONED CATCH of the subsystem. Returns the thrown value after
// clearExceptionExceptTermination(); returns the EMPTY JSValue if the exception is a VM
// termination (which the caller must propagate, never consume). Never call bare
// clearException() anywhere in the subsystem.
JSC::JSValue takeAbruptCompletion(JSC::JSGlobalObject*, JSC::TopExceptionScope&); // userJS: no — WebStreamsMisc.cpp

// ReadableStreamOperations.cpp — stream-level RS ops, reader set-up, controller set-up,
// tee, from-iterable.

// Internal creation.
// `startResult` = the value "the start algorithm returned" (a pre-existing pending promise
// for the transform's inner streams; jsUndefined() for tee/from-iterable/cross-realm).
JSReadableStream* createReadableStream(JSC::JSGlobalObject*, SourceKind, JSC::JSCell* algorithmContext, JSC::JSValue startResult, double highWaterMark = 1, JSC::JSObject* sizeAlgorithm = nullptr); // userJS: yes — ReadableStreamOperations.cpp
JSReadableStream* createReadableByteStream(JSC::JSGlobalObject*, SourceKind, JSC::JSCell* algorithmContext); // userJS: yes — ReadableStreamOperations.cpp
void initializeReadableStream(JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp
bool isReadableStreamLocked(JSReadableStream*); // userJS: no (pure; includes Bun's m_lockedWithoutReader / detached-handle states) — ReadableStreamOperations.cpp

// Readers.
JSReadableStreamDefaultReader* acquireReadableStreamDefaultReader(JSC::JSGlobalObject*, JSReadableStream*); // userJS: no (throws TypeError if locked) — ReadableStreamOperations.cpp
JSReadableStreamBYOBReader* acquireReadableStreamBYOBReader(JSC::JSGlobalObject*, JSReadableStream*); // userJS: no (throws TypeError) — ReadableStreamOperations.cpp
void setUpReadableStreamDefaultReader(JSC::JSGlobalObject*, JSReadableStreamDefaultReader*, JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp
void setUpReadableStreamBYOBReader(JSC::JSGlobalObject*, JSReadableStreamBYOBReader*, JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp
JSC::JSPromise* readableStreamReaderGenericCancel(JSC::JSGlobalObject*, JSReadableStreamReaderBase*, JSC::JSValue reason); // userJS: yes — ReadableStreamOperations.cpp
void readableStreamReaderGenericInitialize(JSC::JSGlobalObject*, JSReadableStreamReaderBase*, JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp
void readableStreamReaderGenericRelease(JSC::JSGlobalObject*, JSReadableStreamReaderBase*); // userJS: no (also runs Bun's native-handle updateRef(false) gate) — ReadableStreamOperations.cpp

// Stream-level state ops.
JSC::JSPromise* readableStreamCancel(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue reason); // userJS: yes — ReadableStreamOperations.cpp
void readableStreamClose(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes (read-request close-steps dispatch) — ReadableStreamOperations.cpp
void readableStreamError(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue error); // userJS: yes (error-steps dispatch) — ReadableStreamOperations.cpp
// Bun helper used by every consumer teardown: closes the stream iff its state still allows
// it. Callers: BunStreamConsumers.cpp, BunStreamSource.cpp, JSDirectStreamController.cpp.
void readableStreamCloseIfPossible(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — ReadableStreamOperations.cpp
void readableStreamAddReadRequest(JSC::VM&, JSReadableStream*, JSReadRequest*); // userJS: no — ReadableStreamOperations.cpp
void readableStreamAddReadIntoRequest(JSC::VM&, JSReadableStream*, JSReadIntoRequest*); // userJS: no — ReadableStreamOperations.cpp
void readableStreamFulfillReadRequest(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue chunk, bool done); // userJS: yes (read-request dispatch) — ReadableStreamOperations.cpp
void readableStreamFulfillReadIntoRequest(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSArrayBufferView* chunk, bool done); // userJS: yes (read-into dispatch) — ReadableStreamOperations.cpp
size_t readableStreamGetNumReadRequests(JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp
size_t readableStreamGetNumReadIntoRequests(JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp
bool readableStreamHasDefaultReader(JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp
bool readableStreamHasBYOBReader(JSReadableStream*); // userJS: no — ReadableStreamOperations.cpp

// Tee / from / pipe entry points.
// Bun: `cloneForBranch2` is Bun's `shouldClone` (Response.clone passes true; the public
// tee() passes false). ALSO runs materializeIfNeeded first.
std::pair<JSReadableStream*, JSReadableStream*> readableStreamTee(JSC::JSGlobalObject*, JSReadableStream*, bool cloneForBranch2); // userJS: yes — ReadableStreamOperations.cpp
std::pair<JSReadableStream*, JSReadableStream*> readableStreamDefaultTee(JSC::JSGlobalObject*, JSReadableStream*, bool cloneForBranch2); // userJS: yes — ReadableStreamOperations.cpp
std::pair<JSReadableStream*, JSReadableStream*> readableByteStreamTee(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — ReadableStreamOperations.cpp
// spec ReadableStreamFromIterable(asyncIterable) — `ReadableStream.from`.
JSReadableStream* readableStreamFromIterable(JSC::JSGlobalObject*, JSC::JSValue asyncIterable); // userJS: yes — ReadableStreamOperations.cpp

// Non-JavaScript SourceKind algorithm ARMS owned by THIS file. The controller's pull/cancel
// dispatch is a TOTAL `switch (m_algorithms.kind)` in JSReadableStreamDefaultController.cpp /
// JSReadableByteStreamController.cpp; every arm whose BODY lives in a different file (per the
// owner rule) is declared here so the two files have a declared bridge. `branch` is the
// controller's m_algorithms.teeBranchIndex (0 or 1).
// TeeBranch / ByteTeeBranch (context = the JSStreamTeeState):
JSC::JSPromise* defaultTeePullAlgorithm(JSC::JSGlobalObject*, JSStreamTeeState*, uint8_t branch); // userJS: yes — ReadableStreamOperations.cpp
JSC::JSPromise* defaultTeeCancelAlgorithm(JSC::JSGlobalObject*, JSStreamTeeState*, uint8_t branch, JSC::JSValue reason); // userJS: yes — ReadableStreamOperations.cpp
JSC::JSPromise* byteTeePullAlgorithm(JSC::JSGlobalObject*, JSStreamTeeState*, uint8_t branch); // userJS: yes — ReadableStreamOperations.cpp
JSC::JSPromise* byteTeeCancelAlgorithm(JSC::JSGlobalObject*, JSStreamTeeState*, uint8_t branch, JSC::JSValue reason); // userJS: yes — ReadableStreamOperations.cpp
// FromIterable (the controller's algorithmContext is the JSStreamFromIterableContext):
JSC::JSPromise* fromIterablePullAlgorithm(JSC::JSGlobalObject*, JSReadableStreamDefaultController*); // userJS: yes (iterator `next`) — ReadableStreamOperations.cpp
JSC::JSPromise* fromIterableCancelAlgorithm(JSC::JSGlobalObject*, JSReadableStreamDefaultController*, JSC::JSValue reason); // userJS: yes (iterator `return`) — ReadableStreamOperations.cpp
// (The Transform arm's cross-file targets are transformStreamDefaultSource{Pull,Cancel}Algorithm
// below; the Native arm's are nativeSource{Start,Pull,Cancel} in the BunStreamSource.cpp
// section; the CrossRealm arms are with the rest of CrossRealmTransform.cpp.)
// `signal` is the JSAbortSignal WRAPPER cell (nullptr = no signal); the pipe op roots it.
// Byte sources are supported: per spec, the pipe always acquires a DEFAULT reader.
JSC::JSPromise* readableStreamPipeTo(JSC::JSGlobalObject*, JSReadableStream* source, JSWritableStream* destination, bool preventClose, bool preventAbort, bool preventCancel, JSC::JSObject* signal = nullptr); // userJS: yes — ReadableStreamOperations.cpp (allocates + populates the op cell, then hands it to startPipeToOperation; the state machine lives in JSStreamPipeToOperation.cpp)

// Controller set-up. Each takes the START RESULT, not a start method — the caller (the
// FromUnderlyingSource op or an internal Create*) already ran the start algorithm; this op
// only reacts to it. pull/cancel/size/kind/context members are populated on the controller
// by the CALLER.
void setUpReadableStreamDefaultController(JSC::JSGlobalObject*, JSReadableStream*, JSReadableStreamDefaultController*, JSC::JSValue startResult, double highWaterMark); // userJS: yes (thenable startResult) — ReadableStreamOperations.cpp
void setUpReadableStreamDefaultControllerFromUnderlyingSource(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue underlyingSource, const UnderlyingSourceDict&, double highWaterMark, JSC::JSObject* sizeAlgorithm); // userJS: yes (invokes the user `start`) — ReadableStreamOperations.cpp
void setUpReadableByteStreamController(JSC::JSGlobalObject*, JSReadableStream*, JSReadableByteStreamController*, JSC::JSValue startResult, double highWaterMark, std::optional<uint64_t> autoAllocateChunkSize); // userJS: yes (thenable startResult) — ReadableStreamOperations.cpp
void setUpReadableByteStreamControllerFromUnderlyingSource(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue underlyingSource, const UnderlyingSourceDict&, double highWaterMark); // userJS: yes (invokes the user `start`) — ReadableStreamOperations.cpp

// JSReadableStreamDefaultReader.cpp

void readableStreamDefaultReaderRead(JSC::JSGlobalObject*, JSReadableStreamDefaultReader*, JSReadRequest*); // userJS: yes ([[PullSteps]] → user pull; the TOTAL ControllerKind dispatch) — JSReadableStreamDefaultReader.cpp
void queueStreamsMicrotask(JSC::JSGlobalObject*, JSC::JSFunction* handler, JSC::JSValue value, JSC::JSValue context); // userJS: no — WebStreamsMisc.cpp
JSC::JSValue readableStreamDefaultReaderTryReadFromQueue(JSC::JSGlobalObject*, JSReadableStreamDefaultReader*); // userJS: yes (a drained queue can pull) — JSReadableStreamDefaultReader.cpp
void readableStreamDefaultReaderRelease(JSC::JSGlobalObject*, JSReadableStreamDefaultReader*); // userJS: yes (error-steps dispatch) — JSReadableStreamDefaultReader.cpp
void readableStreamDefaultReaderErrorReadRequests(JSC::JSGlobalObject*, JSReadableStreamDefaultReader*, JSC::JSValue error); // userJS: yes — JSReadableStreamDefaultReader.cpp
// Bun public `reader.readMany()`: returns the `{value,size,done}` object synchronously OR
// a promise of one.
// Restores the stream's construction-time async-context snapshot around a user
// source callback (pull/cancel and the direct pull). Defined in WebStreamsMisc.cpp.
class StreamAsyncContextScope {
    WTF_MAKE_NONCOPYABLE(StreamAsyncContextScope);

public:
    StreamAsyncContextScope(JSC::JSGlobalObject*, JSReadableStream*);
    ~StreamAsyncContextScope();

private:
    JSC::VM& m_vm;
    JSC::InternalFieldTuple* m_asyncContextData { nullptr };
    JSC::JSValue m_previous;
};

enum class ConsumerFillStep : uint8_t { Done,
    Pending };
// The buffered-consumer pump step (BunStreamConsumers.cpp): bulk queue drain into `chunks`,
// or one pending spec read when the queue is empty. Throws on an errored stream.
ConsumerFillStep readableStreamDefaultReaderFillFromQueue(JSC::JSGlobalObject*, JSReadableStreamDefaultReader*, JSC::JSArray* chunks, JSC::JSPromise** pendingRead); // userJS: yes — JSReadableStreamDefaultReader.cpp
JSC::JSValue readableStreamDefaultReaderReadMany(JSC::JSGlobalObject*, JSReadableStreamDefaultReader*); // userJS: yes — JSReadableStreamDefaultReader.cpp

// JSReadableStreamBYOBReader.cpp

// `min` arrives via [EnforceRange] unsigned long long (already range-checked ≥ 1).
void readableStreamBYOBReaderRead(JSC::JSGlobalObject*, JSReadableStreamBYOBReader*, JSC::JSArrayBufferView* view, uint64_t min, JSReadIntoRequest*); // userJS: yes — JSReadableStreamBYOBReader.cpp
void readableStreamBYOBReaderRelease(JSC::JSGlobalObject*, JSReadableStreamBYOBReader*); // userJS: yes — JSReadableStreamBYOBReader.cpp
void readableStreamBYOBReaderErrorReadIntoRequests(JSC::JSGlobalObject*, JSReadableStreamBYOBReader*, JSC::JSValue error); // userJS: yes — JSReadableStreamBYOBReader.cpp

// JSReadableStreamDefaultController.cpp

void readableStreamDefaultControllerCallPullIfNeeded(JSC::JSGlobalObject*, JSReadableStreamDefaultController*); // userJS: yes (user pull) — JSReadableStreamDefaultController.cpp
bool readableStreamDefaultControllerShouldCallPull(JSReadableStreamDefaultController*); // userJS: no — JSReadableStreamDefaultController.cpp
void readableStreamDefaultControllerClearAlgorithms(JSReadableStreamDefaultController*); // userJS: no — JSReadableStreamDefaultController.cpp
void readableStreamDefaultControllerClose(JSC::JSGlobalObject*, JSReadableStreamDefaultController*); // userJS: yes — JSReadableStreamDefaultController.cpp
void readableStreamDefaultControllerEnqueue(JSC::JSGlobalObject*, JSReadableStreamDefaultController*, JSC::JSValue chunk); // userJS: yes (user size(); throws) — JSReadableStreamDefaultController.cpp
void readableStreamDefaultControllerError(JSC::JSGlobalObject*, JSReadableStreamDefaultController*, JSC::JSValue error); // userJS: yes — JSReadableStreamDefaultController.cpp
std::optional<double> readableStreamDefaultControllerGetDesiredSize(JSReadableStreamDefaultController*); // userJS: no (nullopt = spec null) — JSReadableStreamDefaultController.cpp
bool readableStreamDefaultControllerHasBackpressure(JSReadableStreamDefaultController*); // userJS: no — JSReadableStreamDefaultController.cpp
bool readableStreamDefaultControllerCanCloseOrEnqueue(JSReadableStreamDefaultController*); // userJS: no — JSReadableStreamDefaultController.cpp

// JSReadableByteStreamController.cpp

void readableByteStreamControllerCallPullIfNeeded(JSC::JSGlobalObject*, JSReadableByteStreamController*); // userJS: yes (user pull) — JSReadableByteStreamController.cpp
bool readableByteStreamControllerShouldCallPull(JSReadableByteStreamController*); // userJS: no — JSReadableByteStreamController.cpp
void readableByteStreamControllerClearAlgorithms(JSReadableByteStreamController*); // userJS: no — JSReadableByteStreamController.cpp
void readableByteStreamControllerClearPendingPullIntos(JSReadableByteStreamController*); // userJS: no — JSReadableByteStreamController.cpp
void readableByteStreamControllerClose(JSC::JSGlobalObject*, JSReadableByteStreamController*); // userJS: yes — JSReadableByteStreamController.cpp
// The consumer of ProcessPullIntoDescriptorsUsingQueue's MarkedArgumentBuffer (see below):
// the descriptor is NO LONGER in [[pendingPullIntos]] when this runs; the caller's
// MarkedArgumentBuffer is what keeps it (and its later siblings) alive across this call.
void readableByteStreamControllerCommitPullIntoDescriptor(JSC::JSGlobalObject*, JSReadableStream*, JSPullIntoDescriptor*); // userJS: yes (fulfill dispatch) — JSReadableByteStreamController.cpp
JSC::JSArrayBufferView* readableByteStreamControllerConvertPullIntoDescriptor(JSC::JSGlobalObject*, JSPullIntoDescriptor*); // userJS: no (intrinsic view construction only) — JSReadableByteStreamController.cpp
void readableByteStreamControllerEnqueue(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSC::JSArrayBufferView* chunk); // userJS: yes; throws — JSReadableByteStreamController.cpp
void readableByteStreamControllerEnqueueChunkToQueue(JSReadableByteStreamController*, RefPtr<JSC::ArrayBuffer>&&, size_t byteOffset, size_t byteLength); // userJS: no — JSReadableByteStreamController.cpp
void readableByteStreamControllerEnqueueClonedChunkToQueue(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSC::ArrayBuffer&, size_t byteOffset, size_t byteLength); // userJS: yes (a takeAbruptCompletion catch site; errors the controller then rethrows) — JSReadableByteStreamController.cpp
void readableByteStreamControllerEnqueueDetachedPullIntoToQueue(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSPullIntoDescriptor*); // userJS: yes; throws — JSReadableByteStreamController.cpp
void readableByteStreamControllerError(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSC::JSValue error); // userJS: yes — JSReadableByteStreamController.cpp
void readableByteStreamControllerFillHeadPullIntoDescriptor(JSReadableByteStreamController*, size_t size, JSPullIntoDescriptor*); // userJS: no — JSReadableByteStreamController.cpp
bool readableByteStreamControllerFillPullIntoDescriptorFromQueue(JSReadableByteStreamController*, JSPullIntoDescriptor*); // userJS: no — JSReadableByteStreamController.cpp
void readableByteStreamControllerFillReadRequestFromQueue(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSReadRequest*); // userJS: yes — JSReadableByteStreamController.cpp
JSReadableStreamBYOBRequest* readableByteStreamControllerGetBYOBRequest(JSC::JSGlobalObject*, JSReadableByteStreamController*); // userJS: no (nullptr = spec null) — JSReadableByteStreamController.cpp
std::optional<double> readableByteStreamControllerGetDesiredSize(JSReadableByteStreamController*); // userJS: no — JSReadableByteStreamController.cpp
void readableByteStreamControllerHandleQueueDrain(JSC::JSGlobalObject*, JSReadableByteStreamController*); // userJS: yes — JSReadableByteStreamController.cpp
void readableByteStreamControllerInvalidateBYOBRequest(JSReadableByteStreamController*); // userJS: no — JSReadableByteStreamController.cpp
// Fills `filledPullIntos` with every descriptor whose fill completes from the queue, SHIFTING
// each one out of the visited [[pendingPullIntos]] deque as the spec requires. From that
// moment `filledPullIntos` is those descriptors' ONLY root: nothing else reaches them, and a
// heap-spilled WTF::Vector is invisible to the conservative scan. That is exactly why the
// out-param is a JSC::MarkedArgumentBuffer — its overflow storage IS registered with the
// VM's mark-list set, so every entry (inline and spilled) stays GC-visible while the caller's
// commit loop runs user JS (Commit is userJS: yes). MarkedArgumentBuffer is non-copyable,
// hence the caller-provided out-param instead of a return value.
// CALLER CONTRACT: commit these one at a time via
// readableByteStreamControllerCommitPullIntoDescriptor
// (jsCast<JSPullIntoDescriptor*>(filledPullIntos.at(i))); because each commit can run user
// JS, re-read all reentrantly-mutable controller/stream state after every commit — never
// cache a view of it across the loop.
void readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(JSReadableByteStreamController*, JSC::MarkedArgumentBuffer& filledPullIntos); // userJS: no — JSReadableByteStreamController.cpp
void readableByteStreamControllerProcessReadRequestsUsingQueue(JSC::JSGlobalObject*, JSReadableByteStreamController*); // userJS: yes — JSReadableByteStreamController.cpp
void readableByteStreamControllerPullInto(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSC::JSArrayBufferView* view, uint64_t min, JSReadIntoRequest*); // userJS: yes — JSReadableByteStreamController.cpp
void readableByteStreamControllerRespond(JSC::JSGlobalObject*, JSReadableByteStreamController*, uint64_t bytesWritten); // userJS: yes; throws — JSReadableByteStreamController.cpp
void readableByteStreamControllerRespondInClosedState(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSPullIntoDescriptor* firstDescriptor); // userJS: yes — JSReadableByteStreamController.cpp
void readableByteStreamControllerRespondInReadableState(JSC::JSGlobalObject*, JSReadableByteStreamController*, uint64_t bytesWritten, JSPullIntoDescriptor*); // userJS: yes; throws — JSReadableByteStreamController.cpp
void readableByteStreamControllerRespondInternal(JSC::JSGlobalObject*, JSReadableByteStreamController*, uint64_t bytesWritten); // userJS: yes; throws — JSReadableByteStreamController.cpp
void readableByteStreamControllerRespondWithNewView(JSC::JSGlobalObject*, JSReadableByteStreamController*, JSC::JSArrayBufferView* view); // userJS: yes; throws — JSReadableByteStreamController.cpp
JSPullIntoDescriptor* readableByteStreamControllerShiftPendingPullInto(JSReadableByteStreamController*); // userJS: no — JSReadableByteStreamController.cpp

// WritableStreamOperations.cpp

JSWritableStream* createWritableStream(JSC::JSGlobalObject*, SinkKind, JSC::JSCell* algorithmContext, JSC::JSValue startResult, double highWaterMark, JSC::JSObject* sizeAlgorithm); // userJS: yes — WritableStreamOperations.cpp
void initializeWritableStream(JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
bool isWritableStreamLocked(JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
JSWritableStreamDefaultWriter* acquireWritableStreamDefaultWriter(JSC::JSGlobalObject*, JSWritableStream*); // userJS: no (throws TypeError if locked) — WritableStreamOperations.cpp
void setUpWritableStreamDefaultWriter(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*, JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
// "signal abort on [[abortController]]" runs user `abort` listeners SYNCHRONOUSLY.
JSC::JSPromise* writableStreamAbort(JSC::JSGlobalObject*, JSWritableStream*, JSC::JSValue reason); // userJS: yes — WritableStreamOperations.cpp
JSC::JSPromise* writableStreamClose(JSC::JSGlobalObject*, JSWritableStream*); // userJS: yes — WritableStreamOperations.cpp
JSC::JSPromise* writableStreamAddWriteRequest(JSC::JSGlobalObject*, JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
bool writableStreamCloseQueuedOrInFlight(JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
void writableStreamDealWithRejection(JSC::JSGlobalObject*, JSWritableStream*, JSC::JSValue error); // userJS: yes — WritableStreamOperations.cpp
void writableStreamStartErroring(JSC::JSGlobalObject*, JSWritableStream*, JSC::JSValue reason); // userJS: yes — WritableStreamOperations.cpp
void writableStreamFinishErroring(JSC::JSGlobalObject*, JSWritableStream*); // userJS: yes (user abort algorithm) — WritableStreamOperations.cpp
void writableStreamFinishInFlightWrite(JSC::JSGlobalObject*, JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
void writableStreamFinishInFlightWriteWithError(JSC::JSGlobalObject*, JSWritableStream*, JSC::JSValue error); // userJS: yes — WritableStreamOperations.cpp
void writableStreamFinishInFlightClose(JSC::JSGlobalObject*, JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
void writableStreamFinishInFlightCloseWithError(JSC::JSGlobalObject*, JSWritableStream*, JSC::JSValue error); // userJS: yes — WritableStreamOperations.cpp
bool writableStreamHasOperationMarkedInFlight(JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
void writableStreamMarkCloseRequestInFlight(JSC::VM&, JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
void writableStreamMarkFirstWriteRequestInFlight(JSC::VM&, JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
void writableStreamRejectCloseAndClosedPromiseIfNeeded(JSC::JSGlobalObject*, JSWritableStream*); // userJS: no — WritableStreamOperations.cpp
void writableStreamUpdateBackpressure(JSC::JSGlobalObject*, JSWritableStream*, bool backpressure); // userJS: no — WritableStreamOperations.cpp
void setUpWritableStreamDefaultController(JSC::JSGlobalObject*, JSWritableStream*, JSWritableStreamDefaultController*, JSC::JSValue startResult, double highWaterMark); // userJS: yes (thenable startResult) — WritableStreamOperations.cpp
void setUpWritableStreamDefaultControllerFromUnderlyingSink(JSC::JSGlobalObject*, JSWritableStream*, JSC::JSValue underlyingSink, const UnderlyingSinkDict&, double highWaterMark, JSC::JSObject* sizeAlgorithm); // userJS: yes (invokes the user `start`) — WritableStreamOperations.cpp

// JSWritableStreamDefaultWriter.cpp

JSC::JSPromise* writableStreamDefaultWriterAbort(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*, JSC::JSValue reason); // userJS: yes — JSWritableStreamDefaultWriter.cpp
JSC::JSPromise* writableStreamDefaultWriterClose(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*); // userJS: yes — JSWritableStreamDefaultWriter.cpp
JSC::JSPromise* writableStreamDefaultWriterCloseWithErrorPropagation(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*); // userJS: yes — JSWritableStreamDefaultWriter.cpp
void writableStreamDefaultWriterEnsureClosedPromiseRejected(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*, JSC::JSValue error); // userJS: no — JSWritableStreamDefaultWriter.cpp
void writableStreamDefaultWriterEnsureReadyPromiseRejected(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*, JSC::JSValue error); // userJS: no — JSWritableStreamDefaultWriter.cpp
std::optional<double> writableStreamDefaultWriterGetDesiredSize(JSWritableStreamDefaultWriter*); // userJS: no (nullopt = spec null) — JSWritableStreamDefaultWriter.cpp
void writableStreamDefaultWriterRelease(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*); // userJS: no — JSWritableStreamDefaultWriter.cpp
JSC::JSPromise* writableStreamDefaultWriterWrite(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter*, JSC::JSValue chunk); // userJS: yes (user size() FIRST, then re-checks [[stream]]) — JSWritableStreamDefaultWriter.cpp

// JSWritableStreamDefaultController.cpp

void writableStreamDefaultControllerAdvanceQueueIfNeeded(JSC::JSGlobalObject*, JSWritableStreamDefaultController*); // userJS: yes — JSWritableStreamDefaultController.cpp
void writableStreamDefaultControllerClearAlgorithms(JSWritableStreamDefaultController*); // userJS: no — JSWritableStreamDefaultController.cpp
void writableStreamDefaultControllerClose(JSC::JSGlobalObject*, JSWritableStreamDefaultController*); // userJS: yes — JSWritableStreamDefaultController.cpp
void writableStreamDefaultControllerError(JSC::JSGlobalObject*, JSWritableStreamDefaultController*, JSC::JSValue error); // userJS: yes — JSWritableStreamDefaultController.cpp
void writableStreamDefaultControllerErrorIfNeeded(JSC::JSGlobalObject*, JSWritableStreamDefaultController*, JSC::JSValue error); // userJS: yes — JSWritableStreamDefaultController.cpp
bool writableStreamDefaultControllerGetBackpressure(JSWritableStreamDefaultController*); // userJS: no — JSWritableStreamDefaultController.cpp
// Calls the user size(); a sanctioned takeAbruptCompletion catch site (converts the abrupt
// completion into ErrorIfNeeded and returns 1 — it NEVER throws out).
double writableStreamDefaultControllerGetChunkSize(JSC::JSGlobalObject*, JSWritableStreamDefaultController*, JSC::JSValue chunk); // userJS: yes — JSWritableStreamDefaultController.cpp
double writableStreamDefaultControllerGetDesiredSize(JSWritableStreamDefaultController*); // userJS: no — JSWritableStreamDefaultController.cpp
void writableStreamDefaultControllerProcessClose(JSC::JSGlobalObject*, JSWritableStreamDefaultController*); // userJS: yes (user close algorithm) — JSWritableStreamDefaultController.cpp
void writableStreamDefaultControllerProcessWrite(JSC::JSGlobalObject*, JSWritableStreamDefaultController*, JSC::JSValue chunk); // userJS: yes (user write algorithm) — JSWritableStreamDefaultController.cpp
void writableStreamDefaultControllerWrite(JSC::JSGlobalObject*, JSWritableStreamDefaultController*, JSC::JSValue chunk, double chunkSize); // userJS: yes — JSWritableStreamDefaultController.cpp

// TransformStreamOperations.cpp

// The internal-creation parallel of createReadableStream.
JSTransformStream* createTransformStream(JSC::JSGlobalObject*, TransformerKind, JSC::JSCell* algorithmContext, double writableHighWaterMark = 1, JSC::JSObject* writableSizeAlgorithm = nullptr, double readableHighWaterMark = 0, JSC::JSObject* readableSizeAlgorithm = nullptr); // userJS: yes — TransformStreamOperations.cpp
void initializeTransformStream(JSC::JSGlobalObject*, JSTransformStream*, JSC::JSPromise* startPromise, double writableHighWaterMark, JSC::JSObject* writableSizeAlgorithm, double readableHighWaterMark, JSC::JSObject* readableSizeAlgorithm); // userJS: yes — TransformStreamOperations.cpp
void transformStreamError(JSC::JSGlobalObject*, JSTransformStream*, JSC::JSValue error); // userJS: yes — TransformStreamOperations.cpp
void transformStreamErrorWritableAndUnblockWrite(JSC::JSGlobalObject*, JSTransformStream*, JSC::JSValue error); // userJS: yes — TransformStreamOperations.cpp
void transformStreamSetBackpressure(JSC::JSGlobalObject*, JSTransformStream*, bool backpressure); // userJS: no — TransformStreamOperations.cpp
void transformStreamUnblockWrite(JSC::JSGlobalObject*, JSTransformStream*); // userJS: no — TransformStreamOperations.cpp
void setUpTransformStreamDefaultController(JSC::VM&, JSTransformStream*, JSTransformStreamDefaultController*); // userJS: no — TransformStreamOperations.cpp
void setUpTransformStreamDefaultControllerFromTransformer(JSC::JSGlobalObject*, JSTransformStream*, JSC::JSValue transformer, const TransformerDict&); // userJS: no — TransformStreamOperations.cpp
JSC::JSPromise* transformStreamDefaultSinkWriteAlgorithm(JSC::JSGlobalObject*, JSTransformStream*, JSC::JSValue chunk); // userJS: yes — TransformStreamOperations.cpp
JSC::JSPromise* transformStreamDefaultSinkAbortAlgorithm(JSC::JSGlobalObject*, JSTransformStream*, JSC::JSValue reason); // userJS: yes — TransformStreamOperations.cpp
JSC::JSPromise* transformStreamDefaultSinkCloseAlgorithm(JSC::JSGlobalObject*, JSTransformStream*); // userJS: yes (user flush) — TransformStreamOperations.cpp
JSC::JSPromise* transformStreamDefaultSourceCancelAlgorithm(JSC::JSGlobalObject*, JSTransformStream*, JSC::JSValue reason); // userJS: yes — TransformStreamOperations.cpp
JSC::JSPromise* transformStreamDefaultSourcePullAlgorithm(JSC::JSGlobalObject*, JSTransformStream*); // userJS: no — TransformStreamOperations.cpp

// JSTransformStreamDefaultController.cpp

void transformStreamDefaultControllerClearAlgorithms(JSTransformStreamDefaultController*); // userJS: no — JSTransformStreamDefaultController.cpp
// A sanctioned takeAbruptCompletion catch site (catches the readable-side enqueue's abrupt
// completion, errors the writable, then throws stream.[[readable]].[[storedError]]).
void transformStreamDefaultControllerEnqueue(JSC::JSGlobalObject*, JSTransformStreamDefaultController*, JSC::JSValue chunk); // userJS: yes; throws — JSTransformStreamDefaultController.cpp
void transformStreamDefaultControllerError(JSC::JSGlobalObject*, JSTransformStreamDefaultController*, JSC::JSValue error); // userJS: yes — JSTransformStreamDefaultController.cpp
JSC::JSPromise* transformStreamDefaultControllerPerformTransform(JSC::JSGlobalObject*, JSTransformStreamDefaultController*, JSC::JSValue chunk); // userJS: yes (user transform) — JSTransformStreamDefaultController.cpp
void transformStreamDefaultControllerTerminate(JSC::JSGlobalObject*, JSTransformStreamDefaultController*); // userJS: yes — JSTransformStreamDefaultController.cpp

// JSTextEncoderStream.cpp — the TransformerKind::TextEncoder algorithm ARMS. Invoked from
// transformStreamDefaultControllerPerformTransform's / the flush dispatch's TOTAL
// `switch (m_transformerKind)` in JSTransformStreamDefaultController.cpp; declared here so
// the two files have a declared bridge.

JSC::JSPromise* textEncoderStreamTransform(JSC::JSGlobalObject*, JSTextEncoderStream*, JSTransformStreamDefaultController*, JSC::JSValue chunk); // userJS: yes (enqueue can hit a user size algorithm) — JSTextEncoderStream.cpp
JSC::JSPromise* textEncoderStreamFlush(JSC::JSGlobalObject*, JSTextEncoderStream*, JSTransformStreamDefaultController*); // userJS: yes — JSTextEncoderStream.cpp

// JSTextDecoderStream.cpp — the TransformerKind::TextDecoder algorithm ARMS. Same
// dispatch/bridge relationship as the TextEncoder arms above.

JSC::JSPromise* textDecoderStreamTransform(JSC::JSGlobalObject*, JSTextDecoderStream*, JSTransformStreamDefaultController*, JSC::JSValue chunk); // userJS: yes — JSTextDecoderStream.cpp
JSC::JSPromise* textDecoderStreamFlush(JSC::JSGlobalObject*, JSTextDecoderStream*, JSTransformStreamDefaultController*); // userJS: yes — JSTextDecoderStream.cpp

// CrossRealmTransform.cpp — transferable streams are NOT implemented. These signatures are
// FROZEN, but the .cpp may be a stub whose entry points assert / throw; the per-class
// transfer / transfer-receiving steps have no declarations here.

void crossRealmTransformSendError(JSC::JSGlobalObject*, WebCore::MessagePort&, JSC::JSValue error); // userJS: yes — CrossRealmTransform.cpp
// Throws on serialization failure. `type` is the closed protocol set.
void packAndPostMessage(JSC::JSGlobalObject*, WebCore::MessagePort&, CrossRealmMessageType, JSC::JSValue value); // userJS: yes — CrossRealmTransform.cpp
// Returns true = normal completion. On false the error has already been forwarded via
// crossRealmTransformSendError and the abrupt completion is left on the throw scope
// (resolve it with takeAbruptCompletion above).
bool packAndPostMessageHandlingError(JSC::JSGlobalObject*, WebCore::MessagePort&, CrossRealmMessageType, JSC::JSValue value); // userJS: yes — CrossRealmTransform.cpp
void setUpCrossRealmTransformReadable(JSC::JSGlobalObject*, JSReadableStream*, WebCore::MessagePort&); // userJS: yes — CrossRealmTransform.cpp
void setUpCrossRealmTransformWritable(JSC::JSGlobalObject*, JSWritableStream*, WebCore::MessagePort&); // userJS: yes — CrossRealmTransform.cpp

// JSStreamPipeToOperation.cpp — the pipeTo state machine. readableStreamPipeTo
// (ReadableStreamOperations.cpp, above) ONLY validates, allocates the JSStreamPipeToOperation
// cell, sets the reader/writer back-edges, and calls THIS entry point. Everything else — the
// loop, the four propagation checks, shutdown / shutdown-with-an-action / finalize, the
// onPipe* reaction bodies, and the signal's boundPipeAbortAlgorithm body — lives in
// JSStreamPipeToOperation.cpp as methods on the cell (JSStreamPipeToOperation.h).

// Registers the source/dest [[closedPromise]] reactions and the GC-visited signal abort
// algorithm, then starts the read/write loop. The op cell was fully populated by the caller.
void startPipeToOperation(JSC::JSGlobalObject*, JSStreamPipeToOperation*); // userJS: yes — JSStreamPipeToOperation.cpp
// The PipeTo read request's steps. JSReadRequest.cpp's kind switch dispatches into the cell here.
void pipeToReadRequestChunkSteps(JSC::JSGlobalObject*, JSStreamPipeToOperation*, JSC::JSValue chunk); // userJS: yes — JSStreamPipeToOperation.cpp
void pipeToReadRequestCloseSteps(JSC::JSGlobalObject*, JSStreamPipeToOperation*); // userJS: yes — JSStreamPipeToOperation.cpp
void pipeToReadRequestErrorSteps(JSC::JSGlobalObject*, JSStreamPipeToOperation*, JSC::JSValue error); // userJS: yes — JSStreamPipeToOperation.cpp

// JSReadableStreamAsyncIterator.cpp — its methods are on the cell; nothing is cross-file.

//                                    THE BUN LAYER

// BunStreamSource.cpp — the lazy native source and the native-sink pumps.

// lazyLoadStream: installs the Native default controller (or the empty fast path).
void materializeNativeSource(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamSource.cpp

// The SourceKind::Native algorithm ARMS. The pull/cancel dispatch is a TOTAL
// `switch (m_algorithms.kind)` in JSReadableStreamDefaultController.cpp (a Native source is
// ALWAYS a default controller); these bodies live HERE per BunStreamSource.h's owner rule,
// so this is the declared bridge between the two files. The controller's algorithmContext is
// the JSNativeStreamSourceAdapter for all three.
JSC::JSValue nativeSourceStart(JSC::JSGlobalObject*, JSReadableStreamDefaultController*); // userJS: no (native handle.start; enqueues the drain value) — BunStreamSource.cpp
JSC::JSPromise* nativeSourcePull(JSC::JSGlobalObject*, JSReadableStreamDefaultController*); // userJS: no (native handle.pull; its promise's reactions are onNativePull*) — BunStreamSource.cpp
JSC::JSPromise* nativeSourceCancel(JSC::JSGlobalObject*, JSReadableStreamDefaultController*, JSC::JSValue reason); // userJS: no (native handle.cancel + teardown) — BunStreamSource.cpp
// The JSSink entry point (GlobalObject::assignToStream's body). Returns undefined or
// a JSPromise (the Signal protocol's value).
JSC::JSValue assignToStream(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue jsSinkController); // userJS: yes — BunStreamSource.cpp
// The direct-stream → native-JSSink path. Returns undefined | JSPromise.
JSC::JSValue readDirectStream(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSObject* sinkController, JSC::JSObject* underlyingSource); // userJS: yes — BunStreamSource.cpp
// The generic pump into a native JSSink controller.
JSC::JSPromise* readStreamIntoSink(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSObject* sink); // userJS: yes — BunStreamSource.cpp
// The ResumableSink protocol. Returns undefined (encoded).
JSC::JSValue assignStreamIntoResumableSink(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSObject* resumableSink); // userJS: yes — BunStreamSource.cpp

// JSDirectStreamController.cpp — direct-stream materialization + the direct controller.

// Installs a JSDirectStreamController of the given flavor on the stream, nulls the stream's
// m_directUnderlyingSource, and sets m_bunMode = Default.
void setUpDirectStreamController(JSC::JSGlobalObject*, JSReadableStream*, DirectSinkKind, double highWaterMark); // userJS: yes — JSDirectStreamController.cpp

// BunStreamConsumers.cpp — Bun.readableStreamTo*, the buffered fast path, the direct
// consumers, and the generic accumulators. These are the native entry points; their
// host-function wrappers (installed on BunObject and reached from js2native) are declared in
// BunStreamConsumers.h.

JSC::JSValue readableStreamToText(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
JSC::JSValue readableStreamToArray(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
JSC::JSValue readableStreamToArrayBuffer(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
JSC::JSValue readableStreamToBytes(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
JSC::JSValue readableStreamToJSON(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
JSC::JSValue readableStreamToBlob(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
JSC::JSValue readableStreamToFormData(JSC::JSGlobalObject*, JSReadableStream*, JSC::JSValue contentType); // userJS: yes — BunStreamConsumers.cpp

// The buffered fast path: returns the native handle's own .text()/.arrayBuffer()/... promise,
// or the EMPTY JSValue if the fast path does not apply. `method` is the property name to
// [[Get]] on the handle ("text" | "arrayBuffer" | "bytes" | "json" | "blob"). MAY THROW
// (propagate without setting m_disturbed).
JSC::JSValue tryUseReadableStreamBufferedFastPath(JSC::JSGlobalObject*, JSReadableStream*, const JSC::Identifier& method); // userJS: yes — BunStreamConsumers.cpp

// The generic toText path: the readMany array pump + a single chunk-array -> string
// conversion (BunStreamConsumers.cpp convertChunksToText); BOM-strips its result.
JSC::JSValue readableStreamIntoText(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
// toArray's generic path (getReader + readMany until done).
JSC::JSValue readableStreamIntoArray(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
// Drop ONE leading U+FEFF, and only on the generic toText path.
WTF::String withoutUTF8BOM(const WTF::String&); // userJS: no — BunStreamConsumers.cpp

// The three *Direct conversion paths.
JSC::JSValue readableStreamToTextDirect(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
JSC::JSValue readableStreamToArrayDirect(JSC::JSGlobalObject*, JSReadableStream*); // userJS: yes — BunStreamConsumers.cpp
// The ONE-SHOT direct→ArrayBuffer/Uint8Array conversion: no persistent controller, no
// reader. Allocates a WebCore::JSOneShotDirectSink (JSOneShotDirectSink.h) as the throwaway
// `controller` handed to the user's `pull` exactly once; its start/write/end/close/flush are
// OWN JSBoundFunctions over the boundOneShot* targets (JSStreamsRuntime.h). It deliberately
// does NOT reuse boundDirect* / JSDirectStreamController.
JSC::JSValue consumeDirectStreamToArrayBuffer(JSC::JSGlobalObject*, JSReadableStream*, bool asUint8Array); // userJS: yes — BunStreamConsumers.cpp

// (readableStreamCloseIfPossible is declared in the ReadableStreamOperations.cpp block above
// — that file owns its body. It is only USED throughout this file.)

// WebStreamsExports.cpp — the extern "C" / Rust FFI surface. Every symbol keeps its EXACT
// name and signature; the ReadableStreamTag discriminants are FROZEN by assert_ffi_discr! on
// the Rust side (Invalid=-1, JavaScript=0, Blob=1, File=2, Direct=3 [never emitted], Bytes=4).

// Builds a DirectPending stream that pulls from an async iterator / async-generator function
// (the ReadableStreamTag__tagged coercion path). This is Bun's direct-mode wrapper, NOT the
// spec's readableStreamFromIterable. Owned by WebStreamsExports.cpp: the tag protocol is that
// file's surface, and it is this function's only caller.
// An async-generator-function value is accepted directly (started eagerly). BunAsyncIterableSource.cpp
bool isNonHostAsyncGeneratorFunction(JSC::JSObject*);
JSReadableStream* readableStreamFromAsyncIterator(JSC::JSGlobalObject*, JSC::JSValue asyncIterableOrGeneratorFn); // userJS: yes — WebStreamsExports.cpp

} // namespace WebStreams
} // namespace Bun

// The extern "C" block is outside any namespace.
// All are DEFINED in WebStreamsExports.cpp. userJS: yes for all except the pure predicates.
extern "C" {

// THE tag protocol. Writes the out-params; the async-iterator arm may REPLACE
// *possibleReadableStream with a newly-built DirectPending stream. userJS: yes.
int32_t ReadableStreamTag__tagged(Zig::GlobalObject*, JSC::EncodedJSValue* possibleReadableStream, void** ptr);

// The ReadableStream__* set.
bool ReadableStream__tee(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*, JSC::EncodedJSValue* possibleReadableStream1, JSC::EncodedJSValue* possibleReadableStream2); // userJS: yes
bool ReadableStream__isDisturbed(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*); // userJS: no
bool ReadableStream__isLocked(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*); // userJS: no
// no-op unless the reader slot holds a REAL reader (the direct/native lock is a no-op here).
void ReadableStream__cancel(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*); // userJS: yes
// NO sentinel guard (reachable on a NativeSink-controlled stream).
void ReadableStream__cancelWithReason(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*, JSC::EncodedJSValue reason); // userJS: yes
void ReadableStream__detach(JSC::EncodedJSValue possibleReadableStream, Zig::GlobalObject*); // userJS: no
JSC::EncodedJSValue ReadableStream__empty(Zig::GlobalObject*); // userJS: no
JSC::EncodedJSValue ReadableStream__used(Zig::GlobalObject*); // userJS: no
JSC::EncodedJSValue ReadableStream__errored(Zig::GlobalObject*, JSC::EncodedJSValue reason); // userJS: no
JSC::EncodedJSValue ZigGlobalObject__createNativeReadableStream(Zig::GlobalObject*, JSC::EncodedJSValue nativePtr); // userJS: no
JSC::EncodedJSValue ZigGlobalObject__readableStreamToArrayBuffer(Zig::GlobalObject*, JSC::EncodedJSValue stream); // userJS: yes
JSC::EncodedJSValue ZigGlobalObject__readableStreamToBytes(Zig::GlobalObject*, JSC::EncodedJSValue stream); // userJS: yes
JSC::EncodedJSValue ZigGlobalObject__readableStreamToText(Zig::GlobalObject*, JSC::EncodedJSValue stream); // userJS: yes
JSC::EncodedJSValue ZigGlobalObject__readableStreamToJSON(Zig::GlobalObject*, JSC::EncodedJSValue stream); // userJS: yes
JSC::EncodedJSValue ZigGlobalObject__readableStreamToBlob(Zig::GlobalObject*, JSC::EncodedJSValue stream); // userJS: yes
JSC::EncodedJSValue ZigGlobalObject__readableStreamToFormData(Zig::GlobalObject*, JSC::EncodedJSValue stream, JSC::EncodedJSValue contentType); // userJS: yes
// Caller: ResumableSink.rs; returns encoded undefined.
JSC::EncodedJSValue Bun__assignStreamIntoResumableSink(JSC::JSGlobalObject*, JSC::EncodedJSValue stream, JSC::EncodedJSValue sink); // userJS: yes

} // extern "C"
