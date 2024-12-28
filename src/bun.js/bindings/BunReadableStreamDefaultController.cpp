
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "root.h"

#include "JavaScriptCore/IteratorOperations.h"
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
#include "wtf/Assertions.h"
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

JSReadableStreamDefaultController::JSReadableStreamDefaultController(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

template<typename Visitor>
void JSReadableStreamDefaultController::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = static_cast<JSReadableStreamDefaultController*>(cell);
    Base::visitChildren(cell, visitor);

    thisObject->visitAdditionalChildren(visitor);
}

template<typename Visitor>
void JSReadableStreamDefaultController::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_underlyingSource);
    visitor.append(m_pullAlgorithm);
    visitor.append(m_cancelAlgorithm);
    visitor.append(m_stream);
    m_queue.visit<Visitor>(this, visitor);
}

template<typename Visitor>
void JSReadableStreamDefaultController::visitOutputConstraintsImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSReadableStreamDefaultController*>(cell);
    Base::visitOutputConstraints(cell, visitor);

    thisObject->visitAdditionalChildren(visitor);
}

DEFINE_VISIT_CHILDREN(JSReadableStreamDefaultController);
DEFINE_VISIT_ADDITIONAL_CHILDREN(JSReadableStreamDefaultController);
DEFINE_VISIT_OUTPUT_CONSTRAINTS(JSReadableStreamDefaultController);

JSReadableStreamDefaultController* JSReadableStreamDefaultController::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSReadableStream* stream)
{
    JSReadableStreamDefaultController* controller = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultController>(vm)) JSReadableStreamDefaultController(vm, structure);
    controller->finishCreation(vm, stream);
    return controller;
}

JSReadableStream* JSReadableStreamDefaultController::stream() const
{
    return jsDynamicCast<JSReadableStream*>(m_stream.get());
}

JSValue JSReadableStreamDefaultController::desiredSizeValue()
{
    if (!canCloseOrEnqueue())
        return jsNull();

    // According to spec, desiredSize = highWaterMark - queueTotalSize
    return jsNumber(queue().desiredSize());
}

double JSReadableStreamDefaultController::desiredSize() const
{
    if (!canCloseOrEnqueue())
        return PNaN;

    return queue().desiredSize();
}

bool JSReadableStreamDefaultController::canCloseOrEnqueue() const
{
    // If closeRequested, we can no longer enqueue
    if (m_closeRequested)
        return false;

    // Get stream state
    auto* stream = this->stream();
    ASSERT(stream);

    return stream->state() == JSReadableStream::State::Readable;
}

void JSReadableStreamDefaultController::performPullSteps(VM& vm, JSGlobalObject* globalObject, JSPromise* readRequest)
{
    auto* stream = this->stream();
    ASSERT(stream);

    if (!this->queue().isEmpty()) {
        // Let chunk be ! DequeueValue(this).
        JSValue chunk = this->queue().dequeueValue(vm, globalObject, this);
        ASSERT(!chunk.isEmpty());

        // Perform readRequest’s chunk steps, given chunk.
        readRequest->fulfill(globalObject, JSC::createIteratorResultObject(globalObject, chunk, false));
        return;
    }

    if (m_closeRequested) {
        // Perform ! ReadableStreamDefaultControllerClearAlgorithms(this).
        this->clearAlgorithms();

        // Perform ! ReadableStreamClose(stream).
        stream->close(globalObject);

        readRequest->fulfill(globalObject, createIteratorResultObject(globalObject, jsUndefined(), true));
        return;
    }

    stream->reader()->addReadRequest(vm, globalObject, readRequest);

    // Otherwise, perform ! ReadableStreamDefaultControllerCallPullIfNeeded(this).
    this->callPullIfNeeded(globalObject);
}

JSValue JSReadableStreamDefaultController::enqueue(VM& vm, JSGlobalObject* globalObject, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!canCloseOrEnqueue())
        return throwTypeError(globalObject, scope, "Cannot enqueue chunk to closed stream"_s);

    if (auto* reader = stream()->reader()) {
        if (!reader->isEmpty()) {
            // Assert: ! ReadableStreamHasDefaultReader(stream) is true.
            // 1. Let reader be stream.[[reader]].
            // 2. Assert: reader.[[readRequests]] is not empty.
            // 3. Let readRequest be reader.[[readRequests]][0].
            JSPromise* readRequest = reader->takeFirst(vm, globalObject);
            JSObject* result = JSC::createIteratorResultObject(globalObject, chunk, false);
            readRequest->fulfill(globalObject, result);
            callPullIfNeeded(globalObject);
            return jsUndefined();
        }
    }

    queue().enqueueValueAndGetSize(vm, globalObject, this, chunk);
    RETURN_IF_EXCEPTION(scope, {});
    callPullIfNeeded(globalObject);
    return jsUndefined();
}

void JSReadableStreamDefaultController::error(VM& vm, JSGlobalObject* globalObject, JSValue error)
{
    auto* stream = jsDynamicCast<JSReadableStream*>(m_stream.get());
    ASSERT(stream);

    if (stream->state() != JSReadableStream::State::Readable)
        return;

    // Reset queue
    queue().resetQueue(vm, globalObject, this);

    // Clear our algorithms so we stop executing them
    clearAlgorithms();

    stream->error(globalObject, error);
}

void JSReadableStreamDefaultController::close(VM& vm, JSGlobalObject* globalObject)
{
    if (!canCloseOrEnqueue())
        return;

    auto* stream = this->stream();
    ASSERT(stream);

    m_closeRequested = true;

    // If queue is empty, we can close immediately
    if (queue().isEmpty()) {
        clearAlgorithms();
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

void JSReadableStreamDefaultController::setup(
    JSC::VM& vm,
    JSC::JSGlobalObject* globalObject,
    Bun::JSReadableStream* stream,
    JSC::JSObject* underlyingSource,
    JSC::JSObject* startAlgorithm,
    JSC::JSObject* pullAlgorithm,
    JSC::JSObject* cancelAlgorithm,
    double highWaterMark,
    JSC::JSObject* sizeAlgorithm)
{
    queue().initialize(vm, globalObject, highWaterMark, this, sizeAlgorithm);

    if (pullAlgorithm) setPullAlgorithm(pullAlgorithm);
    if (cancelAlgorithm) setCancelAlgorithm(cancelAlgorithm);
    if (underlyingSource) setUnderlyingSource(underlyingSource);

    // 4. Set controller.[[started]], controller.[[closeRequested]], controller.[[pullAgain]], and controller.[[pulling]] to false.
    m_started = false;
    m_closeRequested = false;
    m_pullAgain = false;
    m_pulling = false;

    // Set stream's controller to this
    stream->setController(vm, this);

    auto scope = DECLARE_THROW_SCOPE(vm);

    // Call start algorithm if provided
    if (startAlgorithm) {
        MarkedArgumentBuffer args;
        args.append(this);

        auto callData = JSC::getCallData(startAlgorithm);
        if (callData.type == JSC::CallData::Type::None) {
            throwTypeError(globalObject, scope, "Start function is not callable"_s);
            return;
        }

        JSValue startResult = JSC::profiledCall(globalObject, ProfilingReason::API, startAlgorithm, callData, underlyingSource, args);
        RETURN_IF_EXCEPTION(scope, );

        // Handle promise fulfillment/rejection
        if (startResult && !startResult.isUndefined()) {
            if (JSPromise* promise = jsDynamicCast<JSPromise*>(startResult)) {
                switch (promise->status(vm)) {
                case JSPromise::Status::Fulfilled:
                    break;
                case JSPromise::Status::Rejected:
                    this->error(globalObject, promise->result(vm));
                    return;
                case JSPromise::Status::Pending:
                    // We need to wait for the promise to resolve
                    ASSERT_NOT_REACHED_WITH_MESSAGE("TODO: handle pending start promise");
                    return;
                }
            }
        }
    }

    m_started = true;
    callPullIfNeeded(globalObject);
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

    EnsureStillAliveScope ensureStillAliveScope(this);
    JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, pullAlgorithm, JSC::getCallData(pullAlgorithm), m_underlyingSource.get(), args);
    if (scope.exception()) {
        m_pulling = false;
        // TODO: is there more we should do here?
        return;
    }

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
    auto* stream = this->stream();
    ASSERT(stream);

    if (!m_started)
        return false;

    if (stream->state() != JSReadableStream::State::Readable)
        return false;

    if (m_closeRequested)
        return false;

    auto* reader = stream->reader();
    // If ! IsReadableStreamLocked(stream) is true and ! ReadableStreamGetNumReadRequests(stream) > 0, return true.
    if ((!stream->isLocked() || reader->isEmpty()) && desiredSize() <= 0)
        return false;

    return true;
}

void JSReadableStreamDefaultController::clearAlgorithms()
{
    // m_pullAlgorithm.clear();
    // m_cancelAlgorithm.clear();
    // m_underlyingSource.clear();

    // queue().clearAlgorithms();
}

void JSReadableStreamDefaultController::finishCreation(VM& vm, JSReadableStream* stream)
{
    Base::finishCreation(vm);
    m_stream.set(vm, this, stream);
    m_pullAlgorithm.clear();
    m_cancelAlgorithm.clear();
    m_underlyingSource.clear();
    queue().resetQueue(vm, globalObject(), this);
}

const ClassInfo JSReadableStreamDefaultController::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultController) };
}
