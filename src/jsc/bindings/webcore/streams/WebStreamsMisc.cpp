#include "config.h"
#include "WebStreamsInternals.h"

#include "JSReadableStream.h"

#include "BunClientData.h"
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

// spec CanTransferArrayBuffer(O). Non-throwing leaf. JSC's `isDetachable()` is the fork's
// [[ArrayBufferDetachKey]]-is-undefined test (false for Wasm/pinned/locked/shared buffers).
bool canTransferArrayBuffer(JSArrayBuffer* object)
{
    ArrayBuffer* buffer = object->impl();
    if (buffer->isDetached())
        return false;
    return buffer->isDetachable();
}

// spec TransferArrayBuffer(O): detach O and return a fresh ArrayBuffer over the same block.
JSArrayBuffer* transferArrayBuffer(JSGlobalObject* globalObject, JSArrayBuffer* object)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArrayBuffer* buffer = object->impl();
    ASSERT(!buffer->isDetached());
    if (!buffer->isDetachable()) [[unlikely]] {
        throwTypeError(globalObject, scope, "Cannot transfer an ArrayBuffer that is not detachable"_s);
        return nullptr;
    }
    ArrayBufferContents contents;
    bool transferred = buffer->transferTo(vm, contents);
    ASSERT_UNUSED(transferred, transferred);
    RELEASE_AND_RETURN(scope, JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(ArrayBufferSharingMode::Default), ArrayBuffer::create(WTF::move(contents))));
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
bool canCopyDataBlockBytes(JSArrayBuffer* toBuffer, size_t toIndex, JSArrayBuffer* fromBuffer, size_t fromIndex, size_t count)
{
    ArrayBuffer* to = toBuffer->impl();
    ArrayBuffer* from = fromBuffer->impl();
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
static bool checkDictionaryReceiver(JSGlobalObject* globalObject, JSValue value, ASCIILiteral message)
{
    auto& vm = getVM(globalObject);
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
static JSValue getCallbackMember(JSGlobalObject* globalObject, JSObject* object, JSC::PropertyName propertyName, ASCIILiteral message)
{
    auto& vm = getVM(globalObject);
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
    bool isObject = checkDictionaryReceiver(globalObject, underlyingSink, "The underlying sink must be an object"_s);
    RETURN_IF_EXCEPTION(scope, result);
    if (!isObject)
        return result;
    auto* sinkObject = asObject(underlyingSink);

    result.abort = getCallbackMember(globalObject, sinkObject, Identifier::fromString(vm, "abort"_s), "The underlying sink's 'abort' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.close = getCallbackMember(globalObject, sinkObject, names.closePublicName(), "The underlying sink's 'close' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.start = getCallbackMember(globalObject, sinkObject, names.startPublicName(), "The underlying sink's 'start' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);

    // `type` is `any`: presence alone is recorded (the constructor's RangeError).
    JSValue type = sinkObject->get(globalObject, vm.propertyNames->type);
    RETURN_IF_EXCEPTION(scope, result);
    result.hasType = !type.isUndefined();

    result.write = getCallbackMember(globalObject, sinkObject, names.writePublicName(), "The underlying sink's 'write' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    return result;
}

TransformerDict convertTransformerDict(JSGlobalObject* globalObject, JSValue transformer)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& names = WebCore::builtinNames(vm);
    TransformerDict result {};
    bool isObject = checkDictionaryReceiver(globalObject, transformer, "The transformer must be an object"_s);
    RETURN_IF_EXCEPTION(scope, result);
    if (!isObject)
        return result;
    auto* transformerObject = asObject(transformer);

    result.cancel = getCallbackMember(globalObject, transformerObject, names.cancelPublicName(), "The transformer's 'cancel' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.flush = getCallbackMember(globalObject, transformerObject, Identifier::fromString(vm, "flush"_s), "The transformer's 'flush' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);

    // `readableType` / `writableType` are `any`: presence alone triggers the RangeError.
    JSValue readableType = transformerObject->get(globalObject, Identifier::fromString(vm, "readableType"_s));
    RETURN_IF_EXCEPTION(scope, result);
    result.hasReadableType = !readableType.isUndefined();

    result.start = getCallbackMember(globalObject, transformerObject, names.startPublicName(), "The transformer's 'start' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);
    result.transform = getCallbackMember(globalObject, transformerObject, Identifier::fromString(vm, "transform"_s), "The transformer's 'transform' property must be a function"_s);
    RETURN_IF_EXCEPTION(scope, result);

    JSValue writableType = transformerObject->get(globalObject, Identifier::fromString(vm, "writableType"_s));
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
    bool isObject = checkDictionaryReceiver(globalObject, strategy, "The queuing strategy must be an object"_s);
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

    result.size = getCallbackMember(globalObject, strategyObject, vm.propertyNames->size, "The queuing strategy's 'size' property must be a function"_s);
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
    m_asyncContextData = globalObject->m_asyncContextData.get();
    m_previous = m_asyncContextData->getInternalField(0);
    m_asyncContextData->putInternalField(m_vm, 0, snapshot);
}

StreamAsyncContextScope::~StreamAsyncContextScope()
{
    if (m_asyncContextData)
        m_asyncContextData->putInternalField(m_vm, 0, m_previous);
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

// The ONE sanctioned completion-record catch: the spec's "interpreting X as a completion
// record" sites only. Empty return = a VM termination the caller must propagate.
JSValue takeAbruptCompletion(JSGlobalObject*, TopExceptionScope& catchScope)
{
    JSC::Exception* exception = catchScope.exception();
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
