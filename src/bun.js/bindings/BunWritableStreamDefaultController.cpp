#include "root.h"

#include "AbortController.h"
#include "JSDOMConvertInterface.h"
#include <JavaScriptCore/JSPromise.h>
#include "JSAbortController.h"
#include <JavaScriptCore/WriteBarrierInlines.h>

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSArray.h>

#include "BunWritableStreamDefaultController.h"
#include "BunWritableStream.h"
#include "JSAbortSignal.h"
#include "IDLTypes.h"
#include "JSDOMBinding.h"
#include "BunStreamStructures.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include "BunStreamInlines.h"
#include "JSAbortSignal.h"
#include "DOMJITIDLType.h"
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {

JSWritableStream* JSWritableStreamDefaultController::stream() const
{
    return jsDynamicCast<JSWritableStream*>(m_stream.get());
}

void JSWritableStreamDefaultController::setStream(JSC::VM& vm, JSWritableStream* stream) { m_stream.set(vm, this, stream); }
void JSWritableStreamDefaultController::setAbortAlgorithm(JSC::VM& vm, JSC::JSObject* abortAlgorithm) { m_abortAlgorithm.set(vm, this, abortAlgorithm); }
void JSWritableStreamDefaultController::setCloseAlgorithm(JSC::VM& vm, JSC::JSObject* closeAlgorithm) { m_closeAlgorithm.set(vm, this, closeAlgorithm); }
void JSWritableStreamDefaultController::setWriteAlgorithm(JSC::VM& vm, JSC::JSObject* writeAlgorithm) { m_writeAlgorithm.set(vm, this, writeAlgorithm); }

JSC::GCClient::IsoSubspace* JSWritableStreamDefaultController::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSWritableStreamDefaultController, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWritableStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStreamDefaultController = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWritableStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStreamDefaultController = std::forward<decltype(space)>(space); });
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultControllerCloseFulfill, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->argument(1));
    if (UNLIKELY(!stream))
        return throwVMTypeError(globalObject, scope, "WritableStreamDefaultController.close called with invalid stream"_s);

    stream->finishInFlightClose();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultControllerCloseReject, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->argument(1));
    if (UNLIKELY(!stream))
        return throwVMTypeError(globalObject, scope, "WritableStreamDefaultController.close called with invalid stream"_s);

    stream->finishInFlightCloseWithError(callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

JSWritableStreamDefaultController* JSWritableStreamDefaultController::create(
    JSC::VM& vm,
    JSC::JSGlobalObject* globalObject,
    JSC::Structure* structure,
    JSWritableStream* stream,
    double highWaterMark,
    JSC::JSObject* abortAlgorithm,
    JSC::JSObject* closeAlgorithm,
    JSC::JSObject* writeAlgorithm,
    JSC::JSObject* sizeAlgorithm)
{
    JSWritableStreamDefaultController* controller = new (
        NotNull, JSC::allocateCell<JSWritableStreamDefaultController>(vm))
        JSWritableStreamDefaultController(vm, structure);

    controller->finishCreation(vm);
    if (abortAlgorithm)
        controller->m_abortAlgorithm.setMayBeNull(vm, controller, abortAlgorithm);
    else
        controller->m_abortAlgorithm.clear();
    if (closeAlgorithm)
        controller->m_closeAlgorithm.setMayBeNull(vm, controller, closeAlgorithm);
    else
        controller->m_closeAlgorithm.clear();
    if (writeAlgorithm)
        controller->m_writeAlgorithm.setMayBeNull(vm, controller, writeAlgorithm);
    else
        controller->m_writeAlgorithm.clear();

    if (stream)
        controller->m_stream.set(vm, controller, stream);
    else
        controller->m_stream.clear();

    controller->queue().initialize(vm, globalObject, highWaterMark, controller, sizeAlgorithm);

    return controller;
}

void JSWritableStreamDefaultController::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    m_abortController.initLater([](const JSC::LazyProperty<JSObject, WebCore::JSAbortController>::Initializer& init) {
        auto* lexicalGlobalObject = init.owner->globalObject();
        Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
        auto& scriptExecutionContext = *globalObject->scriptExecutionContext();
        Ref<WebCore::AbortController> abortController = WebCore::AbortController::create(scriptExecutionContext);
        JSAbortController* abortControllerValue = jsCast<JSAbortController*>(WebCore::toJSNewlyCreated<IDLInterface<WebCore::AbortController>>(*lexicalGlobalObject, *globalObject, WTFMove(abortController)));
        init.set(abortControllerValue);
    });
}

WebCore::AbortSignal& JSWritableStreamDefaultController::signal() const
{
    auto* abortController = m_abortController.getInitializedOnMainThread(this);
    auto& impl = abortController->wrapped();
    return impl.signal();
}

Ref<WebCore::AbortSignal> JSWritableStreamDefaultController::abortSignal() const
{
    auto* abortController = m_abortController.getInitializedOnMainThread(this);
    auto& impl = abortController->wrapped();
    return impl.protectedSignal();
}

JSC::JSValue JSWritableStreamDefaultController::error(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Let stream be this.[[stream]].
    JSWritableStream* stream = this->stream();

    // 2. Assert: stream is not undefined.
    ASSERT(stream);

    // 3. Let state be stream.[[state]].
    auto state = stream->state();

    // 4. Assert: state is "writable".
    if (state != JSWritableStream::State::Writable)
        return throwTypeError(globalObject, scope, "WritableStreamDefaultController.error called on non-writable stream"_s);

    // 5. Perform ! WritableStreamDefaultControllerError(this, error).
    m_writeAlgorithm.clear();
    m_closeAlgorithm.clear();
    m_abortAlgorithm.clear();
    m_queue.clearAlgorithms();

    stream->error(vm, globalObject, reason);

    return jsUndefined();
}

void JSWritableStreamDefaultController::write(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Let stream be this.[[stream]].
    JSWritableStream* stream = this->stream();
    ASSERT(stream);

    // 2. If ! WritableStreamCloseQueuedOrInFlight(stream) is true, return a promise rejected with a TypeError.
    if (stream->isCloseQueuedOrInFlight()) {
        throwTypeError(globalObject, scope, "Cannot write to a stream that is closed or closing"_s);
        return;
    }

    // 3. If stream.[[state]] is not "writable", return a promise rejected with a TypeError.
    if (stream->state() != JSWritableStream::State::Writable) {
        throwTypeError(globalObject, scope, "Cannot write to a stream that is not writable"_s);
        return;
    }

    // 4. Let sizeAlgorithm be this.[[strategySizeAlgorithm]].
    // 5. Let chunkSize be ? Call(sizeAlgorithm, undefined, « chunk »).
    // 6. Let enqueueResult be EnqueueValueWithSize(this, chunk, chunkSize).
    m_queue.enqueueValueAndGetSize(vm, globalObject, this, chunk);
    RETURN_IF_EXCEPTION(scope, void());

    // 7. If ! WritableStreamCloseQueuedOrInFlight(stream) is false and stream.[[state]] is "writable",
    if (!stream->isCloseQueuedOrInFlight() && stream->state() == JSWritableStream::State::Writable) {
        // Let backpressure be ! WritableStreamDefaultControllerGetBackpressure(this).
        bool backpressure = getDesiredSize() <= 0;

        // Perform ! WritableStreamUpdateBackpressure(stream, backpressure).
        stream->updateBackpressure(vm, globalObject, backpressure);
    }

    // 8. Perform ! WritableStreamDefaultControllerAdvanceQueueIfNeeded(this).
    if (shouldCallWrite()) {
        m_writing = true;
        m_inFlightWriteRequest = true;
        MarkedArgumentBuffer args;
        args.append(chunk);
        JSObject* writeAlgorithm = m_writeAlgorithm.get();
        auto callData = JSC::getCallData(writeAlgorithm);
        JSC::profiledCall(globalObject, JSC::ProfilingReason::API, writeAlgorithm, callData, jsUndefined(), args);
        if (UNLIKELY(scope.exception())) {
            m_writing = false;
            m_inFlightWriteRequest = false;
            return;
        }
    }
}

bool JSWritableStreamDefaultController::shouldCallWrite() const
{
    if (!m_started)
        return false;

    if (m_writing)
        return false;

    if (m_inFlightWriteRequest)
        return false;

    if (!stream() || stream()->state() != JSWritableStream::State::Writable)
        return false;

    return true;
}

template<typename Visitor>
void JSWritableStreamDefaultController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSWritableStreamDefaultController* thisObject = jsCast<JSWritableStreamDefaultController*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_stream);
    visitor.append(thisObject->m_abortAlgorithm);
    visitor.append(thisObject->m_closeAlgorithm);
    visitor.append(thisObject->m_writeAlgorithm);
    thisObject->m_abortController.visit(visitor);

    thisObject->m_queue.visit<Visitor>(visitor);
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultController);

const JSC::ClassInfo JSWritableStreamDefaultController::s_info = {
    "WritableStreamDefaultController"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultController)
};

JSValue JSWritableStreamDefaultController::close(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Let stream be this.[[stream]].
    JSWritableStream* stream = this->stream();

    // 2. Assert: stream is not undefined.
    ASSERT(stream);

    // 3. Let state be stream.[[state]].
    auto state = stream->state();

    // 4. Assert: state is "writable".
    ASSERT(state == JSWritableStream::State::Writable);

    // 5. Let closeRequest be stream.[[closeRequest]].
    // 6. Assert: closeRequest is not undefined.
    // TODO: do we need to check this?

    JSObject* closeFunction = m_closeAlgorithm.get();

    // 7. Perform ! WritableStreamDefaultControllerClearAlgorithms(this).
    m_writeAlgorithm.clear();
    m_closeAlgorithm.clear();
    m_abortAlgorithm.clear();
    m_queue.clearAlgorithms();

    // 8. Let sinkClosePromise be the result of performing this.[[closeAlgorithm]].
    JSValue sinkClosePromise;
    if (m_closeAlgorithm) {
        if (closeFunction) {
            MarkedArgumentBuffer args;
            ASSERT(!args.hasOverflowed());
            sinkClosePromise = JSC::profiledCall(globalObject, JSC::ProfilingReason::Microtask, closeFunction, JSC::getCallData(closeFunction), jsUndefined(), args);
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            sinkClosePromise = jsUndefined();
        }
    } else {
        sinkClosePromise = jsUndefined();
    }

    // 9. Upon fulfillment of sinkClosePromise:
    //    a. Perform ! WritableStreamFinishInFlightClose(stream).
    // 10. Upon rejection of sinkClosePromise with reason r:
    //    a. Perform ! WritableStreamFinishInFlightCloseWithError(stream, r).
    if (JSPromise* promise = jsDynamicCast<JSPromise*>(sinkClosePromise)) {
        Bun::then(globalObject, promise, jsWritableStreamDefaultControllerCloseFulfill, jsWritableStreamDefaultControllerCloseReject, stream);
    } else {
        // If not a promise, treat as fulfilled
        stream->finishInFlightClose();
    }

    return jsUndefined();
}

void JSWritableStreamDefaultController::errorSteps()
{
    // Implementation of error steps for the controller
    if (stream())
        stream()->error(globalObject(), jsUndefined());
}

JSValue JSWritableStreamDefaultController::performAbortAlgorithm(JSValue reason)
{
    if (!m_abortAlgorithm)
        return jsUndefined();

    MarkedArgumentBuffer args;
    args.append(reason);

    auto callData = JSC::getCallData(m_abortAlgorithm.get());
    return call(globalObject(), m_abortAlgorithm.get(), callData, jsUndefined(), args);
}
}
