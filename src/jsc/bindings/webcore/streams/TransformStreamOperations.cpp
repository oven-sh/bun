#include "config.h"
#include "WebStreamsInternals.h"

#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultController.h"
#include "JSStreamsRuntime.h"
#include "JSTextDecoderStream.h"
#include "JSTextEncoderStream.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultController.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/SlotVisitorMacros.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;
using WebCore::JSStreamsRuntime;

// Null-safe: Bun's native-sink pumps clear a consumed stream's controller slot in their
// finally step, so a transform reaction (or an async transform()/flush() resuming after
// that teardown) can see a readable with no controller. A torn-down readable is terminal.
JSReadableStreamDefaultController* transformReadableController(JSTransformStream* stream)
{
    const auto* readable = stream->m_readable.get();
    if (readable->m_controllerKind != ControllerKind::Default)
        return nullptr;
    return uncheckedDowncast<JSReadableStreamDefaultController>(readable->m_controller.get());
}

// [[flushAlgorithm]] dispatch (needed only by the default sink close algorithm below).
static JSPromise* performFlushAlgorithm(JSC::VM& vm, JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (controller->m_transformerKind) {
    case TransformerKind::JavaScript:
        if (auto* method = controller->m_flushMethod.get()) {
            MarkedArgumentBuffer args;
            args.append(controller);
            ASSERT(!args.hasOverflowed());
            RELEASE_AND_RETURN(scope, invokePromiseReturningMethod(vm, globalObject, method, controller->m_transformer.get(), args));
        }
        break;
    case TransformerKind::Identity:
        break;
    case TransformerKind::TextEncoder:
        RELEASE_AND_RETURN(scope, textEncoderStreamFlush(globalObject, uncheckedDowncast<JSTextEncoderStream>(controller->m_algorithmContext.get()), controller));
    case TransformerKind::TextDecoder:
        RELEASE_AND_RETURN(scope, textDecoderStreamFlush(globalObject, uncheckedDowncast<JSTextDecoderStream>(controller->m_algorithmContext.get()), controller));
    }
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

// [[cancelAlgorithm]] dispatch. The TextEncoder/TextDecoder kinds have no cancel algorithm.
static JSPromise* performCancelAlgorithm(JSC::VM& vm, JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (controller->m_transformerKind == TransformerKind::JavaScript) {
        if (auto* method = controller->m_cancelMethod.get()) {
            MarkedArgumentBuffer args;
            args.append(reason);
            ASSERT(!args.hasOverflowed());
            RELEASE_AND_RETURN(scope, invokePromiseReturningMethod(vm, globalObject, method, controller->m_transformer.get(), args));
        }
    }
    RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
}

JSTransformStream* createTransformStream(JSGlobalObject* globalObject, TransformerKind kind, JSCell* algorithmContext, double writableHighWaterMark, JSObject* writableSizeAlgorithm, double readableHighWaterMark, JSObject* readableSizeAlgorithm)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(writableHighWaterMark >= 0);
    ASSERT(readableHighWaterMark >= 0);
    auto* domGlobalObject = defaultGlobalObject(globalObject);

    auto* stream = JSTransformStream::create(vm, WebCore::getDOMStructure<JSTransformStream>(vm, *domGlobalObject));
    auto* startPromise = JSPromise::create(vm, globalObject->promiseStructure());
    initializeTransformStream(globalObject, stream, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm);
    RETURN_IF_EXCEPTION(scope, nullptr);

    auto* controller = JSTransformStreamDefaultController::create(vm, WebCore::getDOMStructure<JSTransformStreamDefaultController>(vm, *domGlobalObject));
    controller->m_transformerKind = kind;
    if (algorithmContext)
        controller->m_algorithmContext.set(vm, controller, algorithmContext);
    setUpTransformStreamDefaultController(vm, stream, controller);

    // The internal kinds' start algorithm is trivial.
    resolvePromise(globalObject, startPromise, jsUndefined());
    RETURN_IF_EXCEPTION(scope, nullptr);
    return stream;
}

void initializeTransformStream(JSGlobalObject* globalObject, JSTransformStream* stream, JSPromise* startPromise, double writableHighWaterMark, JSObject* writableSizeAlgorithm, double readableHighWaterMark, JSObject* readableSizeAlgorithm)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* writable = createWritableStream(globalObject, SinkKind::Transform, stream, startPromise, writableHighWaterMark, writableSizeAlgorithm);
    RETURN_IF_EXCEPTION(scope, void());
    stream->m_writable.set(vm, stream, writable);

    auto* readable = createReadableStream(globalObject, SourceKind::Transform, stream, startPromise, readableHighWaterMark, readableSizeAlgorithm);
    RETURN_IF_EXCEPTION(scope, void());
    stream->m_readable.set(vm, stream, readable);

    stream->m_backpressure = false;
    stream->m_backpressureChangePromise.clear();
    transformStreamSetBackpressure(globalObject, stream, true);
    // Setting backpressure on a fresh stream resolves no promise and cannot throw.
    scope.assertNoException();
    stream->m_controller.clear();
}

void transformStreamError(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (auto* readableController = transformReadableController(stream)) {
        readableStreamDefaultControllerError(globalObject, readableController, error);
        RETURN_IF_EXCEPTION(scope, void());
    }
    RELEASE_AND_RETURN(scope, transformStreamErrorWritableAndUnblockWrite(globalObject, stream, error));
}

void transformStreamErrorWritableAndUnblockWrite(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    transformStreamDefaultControllerClearAlgorithms(stream->m_controller.get());
    writableStreamDefaultControllerErrorIfNeeded(globalObject, stream->m_writable->m_controller.get(), error);
    RETURN_IF_EXCEPTION(scope, void());
    RELEASE_AND_RETURN(scope, transformStreamUnblockWrite(globalObject, stream));
}

void transformStreamSetBackpressure(JSGlobalObject* globalObject, JSTransformStream* stream, bool backpressure)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_backpressure != backpressure);
    if (auto* previous = stream->m_backpressureChangePromise.get()) {
        resolvePromise(globalObject, previous, jsUndefined());
        // Resolving with `undefined` performs no thenable lookup and cannot throw.
        scope.assertNoException();
    }
    stream->m_backpressureChangePromise.set(vm, stream, JSPromise::create(vm, globalObject->promiseStructure()));
    stream->m_backpressure = backpressure;
}

void transformStreamUnblockWrite(JSGlobalObject* globalObject, JSTransformStream* stream)
{
    if (stream->m_backpressure)
        transformStreamSetBackpressure(globalObject, stream, false);
}

void setUpTransformStreamDefaultController(VM& vm, JSTransformStream* stream, JSTransformStreamDefaultController* controller)
{
    ASSERT(!stream->m_controller);
    controller->m_stream.set(vm, controller, stream);
    stream->m_controller.set(vm, stream, controller);
}

void setUpTransformStreamDefaultControllerFromTransformer(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue transformer, const TransformerDict& transformerDict)
{
    auto& vm = getVM(globalObject);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* controller = JSTransformStreamDefaultController::create(vm, WebCore::getDOMStructure<JSTransformStreamDefaultController>(vm, *domGlobalObject));

    if (transformer.isObject()) {
        controller->m_transformerKind = TransformerKind::JavaScript;
        controller->m_transformer.set(vm, controller, transformer);
        if (!transformerDict.transform.isEmpty())
            controller->m_transformMethod.set(vm, controller, asObject(transformerDict.transform));
        if (!transformerDict.flush.isEmpty())
            controller->m_flushMethod.set(vm, controller, asObject(transformerDict.flush));
        if (!transformerDict.cancel.isEmpty())
            controller->m_cancelMethod.set(vm, controller, asObject(transformerDict.cancel));
    } else
        controller->m_transformerKind = TransformerKind::Identity;

    setUpTransformStreamDefaultController(vm, stream, controller);
}

JSPromise* transformStreamDefaultSinkWriteAlgorithm(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(stream->m_writable->m_state == WritableStreamState::Writable);
    auto* controller = stream->m_controller.get();
    if (stream->m_backpressure) {
        auto* backpressureChangePromise = stream->m_backpressureChangePromise.get();
        ASSERT(backpressureChangePromise);
        auto* result = JSPromise::create(vm, globalObject->promiseStructure());
        stream->m_pendingWriteChunk.set(vm, stream, chunk);
        auto* runtime = JSStreamsRuntime::from(globalObject);
        backpressureChangePromise->performPromiseThenWithContext(vm, globalObject, runtime->onTSSinkWriteBackpressureChangeFulfilled(), jsUndefined(), result, stream);
        return result;
    }
    RELEASE_AND_RETURN(scope, transformStreamDefaultControllerPerformTransform(globalObject, controller, chunk));
}

JSPromise* transformStreamDefaultSinkAbortAlgorithm(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = stream->m_controller.get();
    if (auto* finishPromise = controller->m_finishPromise.get())
        return finishPromise;
    auto* finishPromise = JSPromise::create(vm, globalObject->promiseStructure());
    controller->m_finishPromise.set(vm, controller, finishPromise);

    auto* cancelPromise = performCancelAlgorithm(vm, globalObject, controller, reason);
    RETURN_IF_EXCEPTION(scope, nullptr);
    transformStreamDefaultControllerClearAlgorithms(controller);

    auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), stream, reason);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    cancelPromise->performPromiseThenWithContext(vm, globalObject, runtime->onTSSinkAbortCancelFulfilled(), runtime->onTSSinkAbortCancelRejected(), jsUndefined(), context);
    return controller->m_finishPromise.get();
}

JSPromise* transformStreamDefaultSinkCloseAlgorithm(JSGlobalObject* globalObject, JSTransformStream* stream)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = stream->m_controller.get();
    if (auto* finishPromise = controller->m_finishPromise.get())
        return finishPromise;
    auto* finishPromise = JSPromise::create(vm, globalObject->promiseStructure());
    controller->m_finishPromise.set(vm, controller, finishPromise);

    auto* flushPromise = performFlushAlgorithm(vm, globalObject, controller);
    RETURN_IF_EXCEPTION(scope, nullptr);
    transformStreamDefaultControllerClearAlgorithms(controller);

    auto* runtime = JSStreamsRuntime::from(globalObject);
    flushPromise->performPromiseThenWithContext(vm, globalObject, runtime->onTSSinkCloseFlushFulfilled(), runtime->onTSSinkCloseFlushRejected(), jsUndefined(), stream);
    return controller->m_finishPromise.get();
}

JSPromise* transformStreamDefaultSourceCancelAlgorithm(JSGlobalObject* globalObject, JSTransformStream* stream, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* controller = stream->m_controller.get();
    if (auto* finishPromise = controller->m_finishPromise.get())
        return finishPromise;
    auto* finishPromise = JSPromise::create(vm, globalObject->promiseStructure());
    controller->m_finishPromise.set(vm, controller, finishPromise);

    auto* cancelPromise = performCancelAlgorithm(vm, globalObject, controller, reason);
    RETURN_IF_EXCEPTION(scope, nullptr);
    transformStreamDefaultControllerClearAlgorithms(controller);

    auto* context = InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), stream, reason);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    cancelPromise->performPromiseThenWithContext(vm, globalObject, runtime->onTSSourceCancelFulfilled(), runtime->onTSSourceCancelRejected(), jsUndefined(), context);
    return controller->m_finishPromise.get();
}

JSPromise* transformStreamDefaultSourcePullAlgorithm(JSGlobalObject* globalObject, JSTransformStream* stream)
{
    ASSERT(stream->m_backpressure);
    ASSERT(stream->m_backpressureChangePromise);
    transformStreamSetBackpressure(globalObject, stream, false);
    return stream->m_backpressureChangePromise.get();
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

// [reaction-convention]: handler(resolutionValue, contextCell).

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSSinkWriteBackpressureChangeFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = uncheckedDowncast<JSTransformStream>(callFrame->argument(1));
    JSValue chunk = stream->m_pendingWriteChunk.get();
    stream->m_pendingWriteChunk.clear();

    const auto* writable = stream->m_writable.get();
    if (writable->m_state == WritableStreamState::Erroring) {
        throwException(globalObject, scope, writable->m_storedError.get());
        return {};
    }
    ASSERT(writable->m_state == WritableStreamState::Writable);
    auto* result = transformStreamDefaultControllerPerformTransform(globalObject, stream->m_controller.get(), chunk);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSSinkAbortCancelFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1));
    auto* stream = uncheckedDowncast<JSTransformStream>(context->getInternalField(0));
    JSValue reason = context->getInternalField(1);
    auto* finishPromise = stream->m_controller->m_finishPromise.get();

    const auto* readable = stream->m_readable.get();
    if (readable->m_state == ReadableStreamState::Errored) {
        rejectPromise(globalObject, finishPromise, readable->m_storedError.get());
        return JSValue::encode(jsUndefined());
    }
    if (auto* readableController = transformReadableController(stream)) {
        readableStreamDefaultControllerError(globalObject, readableController, reason);
        RETURN_IF_EXCEPTION(scope, {});
    }
    resolvePromise(globalObject, finishPromise, jsUndefined());
    // Resolving with `undefined` performs no thenable lookup and cannot throw.
    scope.assertNoException();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSSinkAbortCancelRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue rejection = callFrame->argument(0);
    auto* stream = uncheckedDowncast<JSTransformStream>(uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1))->getInternalField(0));
    auto* finishPromise = stream->m_controller->m_finishPromise.get();

    if (auto* readableController = transformReadableController(stream)) {
        readableStreamDefaultControllerError(globalObject, readableController, rejection);
        RETURN_IF_EXCEPTION(scope, {});
    }
    rejectPromise(globalObject, finishPromise, rejection);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSSinkCloseFlushFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = uncheckedDowncast<JSTransformStream>(callFrame->argument(1));
    auto* finishPromise = stream->m_controller->m_finishPromise.get();

    const auto* readable = stream->m_readable.get();
    if (readable->m_state == ReadableStreamState::Errored) {
        rejectPromise(globalObject, finishPromise, readable->m_storedError.get());
        return JSValue::encode(jsUndefined());
    }
    if (auto* readableController = transformReadableController(stream)) {
        readableStreamDefaultControllerClose(globalObject, readableController);
        RETURN_IF_EXCEPTION(scope, {});
    }
    resolvePromise(globalObject, finishPromise, jsUndefined());
    // Resolving with `undefined` performs no thenable lookup and cannot throw.
    scope.assertNoException();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSSinkCloseFlushRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue rejection = callFrame->argument(0);
    auto* stream = uncheckedDowncast<JSTransformStream>(callFrame->argument(1));
    auto* finishPromise = stream->m_controller->m_finishPromise.get();

    if (auto* readableController = transformReadableController(stream)) {
        readableStreamDefaultControllerError(globalObject, readableController, rejection);
        RETURN_IF_EXCEPTION(scope, {});
    }
    rejectPromise(globalObject, finishPromise, rejection);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSSourceCancelFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1));
    auto* stream = uncheckedDowncast<JSTransformStream>(context->getInternalField(0));
    JSValue reason = context->getInternalField(1);
    auto* finishPromise = stream->m_controller->m_finishPromise.get();

    const auto* writable = stream->m_writable.get();
    if (writable->m_state == WritableStreamState::Errored) {
        rejectPromise(globalObject, finishPromise, writable->m_storedError.get());
        return JSValue::encode(jsUndefined());
    }
    writableStreamDefaultControllerErrorIfNeeded(globalObject, writable->m_controller.get(), reason);
    RETURN_IF_EXCEPTION(scope, {});
    transformStreamUnblockWrite(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    resolvePromise(globalObject, finishPromise, jsUndefined());
    // Resolving with `undefined` performs no thenable lookup and cannot throw.
    scope.assertNoException();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSSourceCancelRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue rejection = callFrame->argument(0);
    auto* stream = uncheckedDowncast<JSTransformStream>(uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1))->getInternalField(0));
    auto* finishPromise = stream->m_controller->m_finishPromise.get();

    writableStreamDefaultControllerErrorIfNeeded(globalObject, stream->m_writable->m_controller.get(), rejection);
    RETURN_IF_EXCEPTION(scope, {});
    transformStreamUnblockWrite(globalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    rejectPromise(globalObject, finishPromise, rejection);
    return JSValue::encode(jsUndefined());
}

} // namespace WebCore
