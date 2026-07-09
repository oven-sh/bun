#include "config.h"
#include <JavaScriptCore/Microtask.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include "WebStreamsInternals.h"

#include "JSReadableStream.h"
#include "JSWritableStream.h"

#include "BunClientData.h"
#include "JSBuffer.h"
#include "JSDOMConvertNumbers.h"
#include "JSStreamsRuntime.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/TypedArrayType.h>
#include <cmath>

namespace Bun {
namespace WebStreams {

using namespace JSC;

// spec ExtractHighWaterMark(strategy, defaultHWM)
double extractHighWaterMark(JSGlobalObject* globalObject, const QueuingStrategyDict& strategy, double defaultHWM)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!strategy.highWaterMark)
        return defaultHWM;
    double highWaterMark = *strategy.highWaterMark;
    if (std::isnan(highWaterMark) || highWaterMark < 0) {
        throwRangeError(globalObject, scope, "The queuing strategy's highWaterMark must be a non-negative, non-NaN number"_s);
        return 0;
    }
    return highWaterMark;
}

// spec ExtractSizeAlgorithm(strategy): nullptr means the default `() => 1` algorithm.
JSObject* extractSizeAlgorithm(const QueuingStrategyDict& strategy)
{
    if (strategy.size.isEmpty())
        return nullptr;
    return asObject(strategy.size);
}

// How many bytes at the tail of `data` form an incomplete UTF-8 sequence (1..3), or 0 if
// it ends on a boundary (or the tail is definitely invalid and should be replaced now).
static size_t incompleteTrailingUTF8(std::span<const uint8_t> data)
{
    size_t len = data.size();
    for (size_t back = 1; back <= std::min<size_t>(3, len); ++back) {
        uint8_t b = data[len - back];
        if ((b & 0xC0) == 0x80)
            continue;
        size_t need;
        if (b < 0x80)
            need = 1;
        else if ((b & 0xE0) == 0xC0)
            need = 2;
        else if ((b & 0xF0) == 0xE0)
            need = 3;
        else if ((b & 0xF8) == 0xF0)
            need = 4;
        else
            return 0;
        return back < need ? back : 0;
    }
    return 0;
}

JSC::JSString* streamingUTF8Decode(JSGlobalObject* globalObject, std::span<const uint8_t> chunk, StreamingUTF8DecodeState& state, bool flush)
{
    WTF::Vector<uint8_t> joinedStorage;
    std::span<const uint8_t> joined = chunk;
    if (unsigned pendingLen = state.pendingLen()) {
        joinedStorage.reserveInitialCapacity(pendingLen + chunk.size());
        joinedStorage.append(std::span<const uint8_t> { state.pending, pendingLen });
        joinedStorage.append(chunk);
        joined = joinedStorage.span();
        state.clearPending();
    }

    if (!state.bomSeen) {
        static constexpr uint8_t bom[] = { 0xEF, 0xBB, 0xBF };
        if (joined.size() >= 3 && !memcmp(joined.data(), bom, 3)) {
            joined = joined.subspan(3);
            state.bomSeen = true;
        } else if (!flush && joined.size() < 3 && !memcmp(joined.data(), bom, joined.size())) {
            // Still a possible BOM prefix; carry it to the next chunk.
            state.setPending(joined.data(), static_cast<unsigned>(joined.size()));
            return nullptr;
        } else if (!joined.empty())
            state.bomSeen = true;
    }

    size_t holdBack = flush ? 0 : incompleteTrailingUTF8(joined);
    if (holdBack)
        state.setPending(joined.data() + (joined.size() - holdBack), static_cast<unsigned>(holdBack));
    auto toDecode = joined.first(joined.size() - holdBack);
    if (toDecode.empty())
        return nullptr;

    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Bun's simdutf-backed Buffer.toString('utf8') path: SIMD ASCII check,
    // external UTF-16 for non-ASCII, replacement chars for invalid sequences.
    // Small chunks avoid the FFI round-trip.
    if (toDecode.size() < 64)
        return jsString(vm, WTF::String::fromUTF8ReplacingInvalidSequences(toDecode));
    JSValue decoded = JSValue::decode(Bun__encoding__toStringUTF8(toDecode.data(), toDecode.size(), globalObject));
    RETURN_IF_EXCEPTION(scope, nullptr);
    return asString(decoded);
}

// spec IsNonNegativeNumber(v). Non-throwing leaf: pure type + range test, no coercion.
bool isNonNegativeNumber(JSValue value)
{
    if (!value.isNumber())
        return false;
    double number = value.asNumber();
    if (std::isnan(number))
        return false;
    return number >= 0;
}

// Queues handler(value, contextCell) — the reaction-convention argument order.
void queueStreamsMicrotask(JSGlobalObject* globalObject, JSFunction* handler, JSValue value, JSValue context)
{
    QueuedTask task { nullptr, InternalMicrotask::BunInvokeJobWithArguments, 0, globalObject, handler, value, context };
    globalObject->vm().queueMicrotask(WTF::move(task));
}

bool canTransferArrayBuffer(JSC::ArrayBuffer& buffer)
{
    return !buffer.isDetached() && buffer.isDetachable();
}

// spec TransferArrayBuffer(O) = ArrayBufferCopyAndDetach(O, undefined, fixed-length):
// resizability must NOT survive the transfer, or a later user resize() invalidates every
// byte length the byte controller recorded. No JSArrayBuffer wrapper cell is created.
RefPtr<JSC::ArrayBuffer> transferArrayBufferImpl(JSGlobalObject* globalObject, JSC::ArrayBuffer& buffer)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(!buffer.isDetached());
    if (!buffer.isDetachable()) [[unlikely]] {
        throwTypeError(globalObject, scope, "Cannot transfer an ArrayBuffer that is not detachable"_s);
        return nullptr;
    }
    if (buffer.isResizableNonShared()) [[unlikely]] {
        // Same shape as JSC's arrayBufferCopyAndDetach FixedLength slow path: copy into a
        // fixed-length block, then detach the original.
        RefPtr<JSC::ArrayBuffer> copy = JSC::ArrayBuffer::tryCreate(buffer.span());
        if (!copy) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return nullptr;
        }
        JSC::ArrayBufferContents droppedContents;
        bool detached = buffer.transferTo(vm, droppedContents);
        ASSERT_UNUSED(detached, detached);
        return copy;
    }
    JSC::ArrayBufferContents contents;
    bool transferred = buffer.transferTo(vm, contents);
    ASSERT_UNUSED(transferred, transferred);
    return JSC::ArrayBuffer::create(WTF::move(contents));
}

// spec CloneAsUint8Array(O): CloneArrayBuffer(O.[[ViewedArrayBuffer]], O.[[ByteOffset]],
// O.[[ByteLength]], %ArrayBuffer%) then Construct(%Uint8Array%, « buffer »).
JSUint8Array* cloneAsUint8Array(JSGlobalObject* globalObject, JSArrayBufferView* view)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(!view->isDetached());
    size_t byteLength = view->byteLength();
    RefPtr<ArrayBuffer> cloned = ArrayBuffer::tryCreate(view->span());
    if (!cloned) [[unlikely]] {
        throwRangeError(globalObject, scope, "Cannot allocate the cloned ArrayBuffer required by the readable byte stream"_s);
        return nullptr;
    }
    RELEASE_AND_RETURN(scope, JSUint8Array::create(globalObject, globalObject->typedArrayStructure(TypeUint8, false), WTF::move(cloned), 0, byteLength));
}

// spec CanCopyDataBlockBytes(toBuffer, toIndex, fromBuffer, fromIndex, count). Non-throwing leaf.
bool canCopyDataBlockBytes(JSC::ArrayBuffer& toBuffer, size_t toIndex, JSC::ArrayBuffer& fromBuffer, size_t fromIndex, size_t count)
{
    ArrayBuffer* to = &toBuffer;
    ArrayBuffer* from = &fromBuffer;
    if (to == from)
        return false;
    if (to->isDetached() || from->isDetached())
        return false;
    size_t toByteLength = to->byteLength();
    if (count > toByteLength || toIndex > toByteLength - count)
        return false;
    size_t fromByteLength = from->byteLength();
    if (count > fromByteLength || fromIndex > fromByteLength - count)
        return false;
    return true;
}

// The WebIDL dictionary conversions. Each performs the observable, alphabetical-order
// [[Get]]s of the real conversion and throws the mandated TypeErrors.

// WebIDL: a non-nullish, non-object value cannot be converted to a dictionary.
static bool checkDictionaryReceiver(JSC::VM& vm, JSGlobalObject* globalObject, JSValue value, ASCIILiteral message)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (value.isUndefinedOrNull())
        return false;
    if (!value.isObject()) {
        throwTypeError(globalObject, scope, message);
        return false;
    }
    return true;
}

// A present callback-typed member must be callable; returns the empty JSValue when absent.
static JSValue getCallbackMember(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* object, JSC::PropertyName propertyName, ASCIILiteral message)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = object->get(globalObject, propertyName);
    RETURN_IF_EXCEPTION(scope, {});
    if (value.isUndefined())
        return JSValue();
    if (!value.isCallable()) {
        throwTypeError(globalObject, scope, message);
        return {};
    }
    return value;
}

UnderlyingSinkDict convertUnderlyingSinkDict(JSGlobalObject* globalObject, JSValue underlyingSink)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& names = WebCore::builtinNames(vm);
    UnderlyingSinkDict result {};
    bool isObject = checkDictionaryReceiver(vm, globalObject, underlyingSink, "The underlying sink must be an object"_s);
    RETURN_IF_EXCEPTION(scope, result);
    if (!isObject)
        return result;
    auto* sinkObject = asObject(underlyingSink);

    result.abort = getCallbackMember(vm, globalObject, sinkObject, builtinNames(vm).abortPublicName(), "The underlying sink's 'abort' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.close = getCallbackMember(vm, globalObject, sinkObject, names.closePublicName(), "The underlying sink's 'close' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.start = getCallbackMember(vm, globalObject, sinkObject, names.startPublicName(), "The underlying sink's 'start' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);

    // `type` is `any`: presence alone is recorded (the constructor's RangeError).
    JSValue type = sinkObject->get(globalObject, vm.propertyNames->type);
    RETURN_IF_EXCEPTION(scope, result);
    result.hasType = !type.isUndefined();

    result.write = getCallbackMember(vm, globalObject, sinkObject, names.writePublicName(), "The underlying sink's 'write' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    return result;
}

TransformerDict convertTransformerDict(JSGlobalObject* globalObject, JSValue transformer)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& names = WebCore::builtinNames(vm);
    TransformerDict result {};
    bool isObject = checkDictionaryReceiver(vm, globalObject, transformer, "The transformer must be an object"_s);
    RETURN_IF_EXCEPTION(scope, result);
    if (!isObject)
        return result;
    auto* transformerObject = asObject(transformer);

    result.cancel = getCallbackMember(vm, globalObject, transformerObject, names.cancelPublicName(), "The transformer's 'cancel' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.flush = getCallbackMember(vm, globalObject, transformerObject, builtinNames(vm).flushPublicName(), "The transformer's 'flush' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);

    // `readableType` / `writableType` are `any`: presence alone triggers the RangeError.
    JSValue readableType = transformerObject->get(globalObject, builtinNames(vm).readableTypePublicName());
    RETURN_IF_EXCEPTION(scope, result);
    result.hasReadableType = !readableType.isUndefined();

    result.start = getCallbackMember(vm, globalObject, transformerObject, names.startPublicName(), "The transformer's 'start' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.transform = getCallbackMember(vm, globalObject, transformerObject, builtinNames(vm).transformPublicName(), "The transformer's 'transform' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);

    JSValue writableType = transformerObject->get(globalObject, builtinNames(vm).writableTypePublicName());
    RETURN_IF_EXCEPTION(scope, result);
    result.hasWritableType = !writableType.isUndefined();
    return result;
}

QueuingStrategyDict convertQueuingStrategyDict(JSGlobalObject* globalObject, JSValue strategy)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& names = WebCore::builtinNames(vm);
    QueuingStrategyDict result {};
    bool isObject = checkDictionaryReceiver(vm, globalObject, strategy, "The queuing strategy must be an object"_s);
    RETURN_IF_EXCEPTION(scope, result);
    if (!isObject)
        return result;
    auto* strategyObject = asObject(strategy);

    JSValue highWaterMark = strategyObject->get(globalObject, names.highWaterMarkPublicName());
    RETURN_IF_EXCEPTION(scope, result);
    if (!highWaterMark.isUndefined()) {
        double value = highWaterMark.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, result);
        result.highWaterMark = value;
    }

    result.size = getCallbackMember(vm, globalObject, strategyObject, vm.propertyNames->size, "The queuing strategy's 'size' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    return result;
}

// Promise helpers.

// Web IDL "a promise resolved with v": a NEW promise resolved with v; a promise/thenable v is
// adopted through a job, one reaction later than ES PromiseResolve's identity would fire — the
// delay is observable (WPT transform abort/cancel-during-start races), so never use identity here.
// For values that are provably not thenables (undefined, internal arrays/objects we
// created): fulfill directly instead of running the observable resolve machinery.
StreamAsyncContextScope::StreamAsyncContextScope(JSGlobalObject* globalObject, JSReadableStream* stream)
    : m_vm(globalObject->vm())
{
    JSValue snapshot = stream->m_asyncContext.get();
    if (!snapshot || snapshot.isUndefinedOrNull())
        return;
    auto* asyncContextData = globalObject->m_asyncContextData.get();
    JSValue current = asyncContextData->getInternalField(0);
    m_asyncContextData = asyncContextData;
    m_previous = current;
    if (snapshot == current)
        return;
    asyncContextData->putInternalField(m_vm, 0, snapshot);
}

StreamAsyncContextScope::~StreamAsyncContextScope()
{
    if (m_asyncContextData)
        m_asyncContextData->putInternalField(m_vm, 0, m_previous);
}

// obj.name(args...) with obj as |this|; the EMPTY value if `name` is not callable.
JSValue invokeOptionalMethod(JSGlobalObject* globalObject, JSObject* object, const Identifier& name, const MarkedArgumentBuffer& args)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = object->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    if (!method.isCallable())
        return {};
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, method, object, args, "method is not a function"_s));
}

bool errorCodeIs(JSGlobalObject* globalObject, JSValue error, ASCIILiteral code)
{
    auto& vm = getVM(globalObject);
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (!error || !error.isObject())
        return false;
    JSValue codeValue = asObject(error)->getIfPropertyExists(globalObject, WebCore::builtinNames(vm).codePublicName());
    if (catchScope.exception()) [[unlikely]] {
        catchScope.clearExceptionExceptTermination();
        return false;
    }
    if (!codeValue || !codeValue.isString())
        return false;
    String codeString = asString(codeValue)->value(globalObject);
    if (catchScope.exception()) [[unlikely]] {
        catchScope.clearExceptionExceptTermination();
        return false;
    }
    return codeString == StringView(code);
}

// Shared [bound-convention] wrapper: target(contextCell, ...callArgs).
JSC::JSBoundFunction* createStreamsBoundHandler(JSGlobalObject* globalObject, JSFunction* target, JSCell* context)
{
    auto& vm = getVM(globalObject);
    MarkedArgumentBuffer boundArgs;
    boundArgs.append(context);
    ASSERT(!boundArgs.hasOverflowed());
    return JSBoundFunction::create(vm, globalObject, target, jsUndefined(), ArgList(boundArgs), 1, nullptr,
        makeSource("streamsBoundHandler"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
}

JSPromise* promiseFulfilledWith(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = getVM(globalObject);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    promise->fulfill(vm, value);
    return promise;
}

JSPromise* promiseResolvedWith(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = getVM(globalObject);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    promise->resolve(globalObject, vm, value);
    return promise;
}

JSPromise* promiseRejectedWith(JSGlobalObject* globalObject, JSValue reason)
{
    return JSPromise::rejectedPromise(globalObject, reason);
}

// "resolve promise with v": the same thenable lookup as promiseResolvedWith.
void resolvePromise(JSGlobalObject* globalObject, JSPromise* promise, JSValue value)
{
    promise->resolve(globalObject, getVM(globalObject), value);
}

void rejectPromise(JSGlobalObject* globalObject, JSPromise* promise, JSValue reason)
{
    promise->reject(getVM(globalObject), reason);
}

void markPromiseAsHandled(VM&, JSPromise* promise)
{
    promise->markAsHandled();
}

// The stream-level closed promise. The Pending guard makes every settle site unconditionally
// safe: a terminal transition can only run once, but the promise may already have been created
// in a terminal state by webStreamClosedPromise().
template<typename Stream>
static void resolveClosedPromise(VM& vm, Stream* stream)
{
    auto* promise = stream->m_closedPromise.get();
    if (!promise || promise->status() != JSPromise::Status::Pending)
        return;
    // Always undefined: a primitive resolution skips the `then` lookup.
    promise->fulfill(vm, jsUndefined());
}

template<typename Stream>
static void rejectClosedPromise(VM& vm, Stream* stream, JSValue error)
{
    auto* promise = stream->m_closedPromise.get();
    if (!promise || promise->status() != JSPromise::Status::Pending)
        return;
    // Nothing is obliged to observe this promise, so it must never report as unhandled.
    promise->rejectAsHandled(vm, error);
}

void resolveStreamClosedPromise(VM& vm, JSReadableStream* stream)
{
    resolveClosedPromise(vm, stream);
}

void resolveStreamClosedPromise(VM& vm, JSWritableStream* stream)
{
    resolveClosedPromise(vm, stream);
}

void rejectStreamClosedPromise(VM& vm, JSReadableStream* stream, JSValue error)
{
    rejectClosedPromise(vm, stream, error);
}

void rejectStreamClosedPromise(VM& vm, JSWritableStream* stream, JSValue error)
{
    rejectClosedPromise(vm, stream, error);
}

JSPromise* webStreamClosedPromise(JSGlobalObject* globalObject, JSReadableStream* stream)
{
    auto& vm = getVM(globalObject);
    if (auto* existing = stream->m_closedPromise.get())
        return existing;

    JSPromise* promise = nullptr;
    switch (stream->m_state) {
    case ReadableStreamState::Closed:
        promise = promiseFulfilledWith(globalObject, jsUndefined());
        break;
    case ReadableStreamState::Errored: {
        JSValue storedError = stream->m_storedError.get();
        promise = promiseRejectedWith(globalObject, storedError ? storedError : jsUndefined());
        promise->markAsHandled();
        break;
    }
    case ReadableStreamState::Readable:
        promise = JSPromise::create(vm, globalObject->promiseStructure());
        break;
    }
    stream->m_closedPromise.set(vm, stream, promise);
    return promise;
}

JSPromise* webStreamClosedPromise(JSGlobalObject* globalObject, JSWritableStream* stream)
{
    auto& vm = getVM(globalObject);
    if (auto* existing = stream->m_closedPromise.get())
        return existing;

    JSPromise* promise = nullptr;
    switch (stream->m_state) {
    case WritableStreamState::Closed:
        promise = promiseFulfilledWith(globalObject, jsUndefined());
        break;
    case WritableStreamState::Errored: {
        JSValue storedError = stream->m_storedError.get();
        promise = promiseRejectedWith(globalObject, storedError ? storedError : jsUndefined());
        promise->markAsHandled();
        break;
    }
    // Erroring is not terminal: writableStreamFinishErroring() rejects the pending promise.
    case WritableStreamState::Writable:
    case WritableStreamState::Erroring:
        promise = JSPromise::create(vm, globalObject->promiseStructure());
        break;
    }
    stream->m_closedPromise.set(vm, stream, promise);
    return promise;
}

// The ONE sanctioned completion-record catch: the spec's "interpreting X as a completion
// record" sites only. Empty return = a VM termination the caller must propagate.
JSValue takeAbruptCompletion(JSGlobalObject*, TopExceptionScope& catchScope)
{
    const JSC::Exception* exception = catchScope.exception();
    ASSERT(exception);
    JSValue thrown = exception->value();
    if (!catchScope.clearExceptionExceptTermination()) [[unlikely]]
        return {};
    return thrown;
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;

// [reaction-convention] _MISC group: the shared no-op fulfillment step that returns undefined.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onReturnUndefined, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsUndefined());
}

// The per-realm ByteLengthQueuingStrategy `size` function: GetV(chunk, "byteLength").
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsByteLengthQueuingStrategySize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSValue::encode(callFrame->argument(0).get(globalObject, vm.propertyNames->byteLength)));
}

// The per-realm CountQueuingStrategy `size` function: always 1.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsCountQueuingStrategySize, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsNumber(1));
}

} // namespace WebCore
