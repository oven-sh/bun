#include "root.h"

#include "BunReadableStreamDefaultController.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSArray.h>
#include "BunReadableStream.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Completion.h>
#include "BunReadableStreamDefaultReader.h"
#include "DOMIsoSubspaces.h"
#include "BunClientData.h"
#include "BunStreamStructures.h"
#include "DOMClientIsoSubspaces.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/JSPromise.h>

#include "BunStreamInlines.h"
namespace Bun {

using namespace JSC;

template<typename CellType, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSReadableStreamDefaultController::subspaceFor(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamDefaultController, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSReadableStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSReadableStreamDefaultController = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSReadableStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSReadableStreamDefaultController = std::forward<decltype(space)>(space); });
}
JSReadableStreamDefaultController* JSReadableStreamDefaultController::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSReadableStream* stream)
{
    JSReadableStreamDefaultController* controller = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultController>(vm)) JSReadableStreamDefaultController(vm, structure);
    controller->finishCreation(vm, stream);
    return controller;
}

JSValue JSReadableStreamDefaultController::desiredSizeValue()
{
    if (!canCloseOrEnqueue())
        return jsNull();

    // According to spec, desiredSize = highWaterMark - queueTotalSize
    return jsNumber(m_strategyHWM - m_queueTotalSize);
}

double JSReadableStreamDefaultController::desiredSize() const
{
    if (!canCloseOrEnqueue())
        return PNaN;

    return m_strategyHWM - m_queueTotalSize;
}

bool JSReadableStreamDefaultController::canCloseOrEnqueue() const
{
    // If closeRequested, we can no longer enqueue
    if (m_closeRequested)
        return false;

    // Get stream state
    auto* stream = jsDynamicCast<JSReadableStream*>(m_stream.get());
    ASSERT(stream);

    return stream->state() == JSReadableStream::State::Readable;
}

JSValue JSReadableStreamDefaultController::enqueue(JSGlobalObject* globalObject, JSValue chunk)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!canCloseOrEnqueue())
        return throwTypeError(globalObject, scope, "Cannot enqueue chunk to closed stream"_s);

    auto* stream = jsDynamicCast<JSReadableStream*>(m_stream.get());
    ASSERT(stream);

    // If we have a size algorithm, use it to calculate chunk size
    double chunkSize = 1;
    JSObject* sizeAlgorithm = m_strategySizeAlgorithm ? m_strategySizeAlgorithm.get() : nullptr;

    if (sizeAlgorithm) {
        MarkedArgumentBuffer args;
        args.append(chunk);
        ASSERT(!args.hasOverflowed());
        JSValue sizeResult = JSC::profiledCall(globalObject, ProfilingReason::API, sizeAlgorithm, JSC::getCallData(sizeAlgorithm), jsUndefined(), args);
        RETURN_IF_EXCEPTION(scope, {});

        chunkSize = sizeResult.toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (!std::isfinite(chunkSize) || chunkSize < 0)
            return throwTypeError(globalObject, scope, "Chunk size must be a finite, non-negative number"_s);
    }

    // Enqueue the chunk
    JSArray* queue = m_queue.getInitializedOnMainThread(globalObject);
    scope.release();
    queue->push(globalObject, chunk);

    m_queueTotalSize += chunkSize;

    callPullIfNeeded(globalObject);
    return jsUndefined();
}

void JSReadableStreamDefaultController::error(JSGlobalObject* globalObject, JSValue error)
{
    VM& vm = globalObject->vm();

    auto* stream = jsDynamicCast<JSReadableStream*>(m_stream.get());
    ASSERT(stream);

    if (stream->state() != JSReadableStream::State::Readable)
        return;

    // Reset queue
    if (m_queue.isInitialized())
        m_queue.setMayBeNull(vm, this, nullptr);
    m_queueTotalSize = 0;

    // Clear our algorithms so we stop executing them
    m_pullAlgorithm.clear();
    m_cancelAlgorithm.clear();
    m_strategySizeAlgorithm.clear();

    stream->error(error);
}

void JSReadableStreamDefaultController::close(JSGlobalObject* globalObject)
{
    if (!canCloseOrEnqueue())
        return;

    auto* stream = jsDynamicCast<JSReadableStream*>(m_stream.get());
    ASSERT(stream);

    m_closeRequested = true;

    // If queue is empty, we can close immediately
    if (!m_queueTotalSize) {
        // Clear algorithms before closing
        m_pullAlgorithm.clear();
        m_cancelAlgorithm.clear();
        m_strategySizeAlgorithm.clear();

        stream->close(globalObject);
    }
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerFullfillPull, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStreamDefaultController* thisObject = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->argument(1));
    if (!thisObject)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.callPullIfNeeded called on incompatible object"_s);

    thisObject->fulfillPull(globalObject);
    return JSValue::encode(jsUndefined());
}

void JSReadableStreamDefaultController::fulfillPull(JSGlobalObject* globalObject)
{
    m_pulling = false;

    // If pullAgain was set while we were pulling, pull again
    if (m_pullAgain) {
        m_pullAgain = false;
        this->callPullIfNeeded(globalObject);
    }
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerRejectPull, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSReadableStreamDefaultController* thisObject = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->argument(1));
    if (!thisObject)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.rejectPull called on incompatible object"_s);

    thisObject->rejectPull(globalObject, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

void JSReadableStreamDefaultController::rejectPull(JSGlobalObject* globalObject, JSValue error)
{
    m_pulling = false;
    this->error(globalObject, error);
}

void JSReadableStreamDefaultController::callPullIfNeeded(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Return if we can't/shouldn't pull
    if (!shouldCallPull())
        return;

    // Already pulling, flag to pull again when done
    if (m_pulling) {
        m_pullAgain = true;
        return;
    }

    // Call pull algorithm
    JSObject* pullAlgorithm = m_pullAlgorithm.get();
    if (!pullAlgorithm) {
        m_pulling = false;
        m_pullAgain = false;
        return;
    }

    m_pulling = true;

    MarkedArgumentBuffer args;
    args.append(this);

    JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, pullAlgorithm, JSC::getCallData(pullAlgorithm), jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, void());

    // Handle the promise returned by pull
    if (JSPromise* promise = jsDynamicCast<JSPromise*>(result)) {
        Bun::then(globalObject, promise, jsReadableStreamDefaultControllerFullfillPull, jsReadableStreamDefaultControllerRejectPull, this);
    } else {
        // Not a promise, just mark pulling as done
        m_pulling = false;
    }
}

bool JSReadableStreamDefaultController::shouldCallPull() const
{
    auto* stream = jsDynamicCast<JSReadableStream*>(m_stream.get());
    ASSERT(stream);

    if (!m_started)
        return false;

    if (stream->state() != JSReadableStream::State::Readable)
        return false;

    if (m_closeRequested)
        return false;

    auto* reader = stream->reader();
    if (!reader)
        return false;

    // Only pull if we need more chunks
    if (reader->length() == 0)
        return false;

    double desiredSize = m_strategyHWM - m_queueTotalSize;
    if (desiredSize <= 0)
        return false;

    return true;
}

void JSReadableStreamDefaultController::finishCreation(VM& vm, JSReadableStream* stream)
{
    Base::finishCreation(vm);
    m_stream.set(vm, this, stream);
}

const ClassInfo JSReadableStreamDefaultController::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultController) };
}
