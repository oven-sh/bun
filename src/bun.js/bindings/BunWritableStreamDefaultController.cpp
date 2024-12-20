#include "root.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>
#include "JSAbortController.h"

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

namespace Bun {

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
    if (sizeAlgorithm)
        controller->m_strategySizeAlgorithm.set(vm, controller, sizeAlgorithm);
    else
        controller->m_strategySizeAlgorithm.clear();

    if (stream)
        controller->m_stream.set(vm, controller, stream);
    else
        controller->m_stream.clear();
    controller->m_strategyHWM = highWaterMark;

    return controller;
}

void JSWritableStreamDefaultController::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    m_queue.set(vm, this, JSC::constructEmptyArray(globalObject(), nullptr, 0));
    m_abortController.initLater([](const JSC::LazyProperty<JSObject, WebCore::JSAbortController>::Initializer& init) {
        auto* lexicalGlobalObject = init.owner->globalObject();
        Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
        auto& scriptExecutionContext = *globalObject->scriptExecutionContext();
        Ref<WebCore::AbortController> abortController = WebCore::AbortController::create(scriptExecutionContext);
        JSAbortController* abortControllerValue = jsCast<JSAbortController*>(WebCore::toJSNewlyCreated<IDLInterface<WebCore::AbortController>>(*lexicalGlobalObject, *globalObject, WTFMove(abortController)));
        init.set(abortControllerValue);
    });
}

Ref<WebCore::AbortSignal> JSWritableStreamDefaultController::abortSignal() const
{
    auto* abortController = m_abortController.getInitializedOnMainThread(this);
    auto& impl = abortController->wrapped();
    return impl.protectedSignal();
}

JSC::JSValue JSWritableStreamDefaultController::error(JSGlobalObject* globalObject, JSValue reason)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Let stream be this.[[stream]].
    JSWritableStream* stream = m_stream.get();

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
    m_strategySizeAlgorithm.clear();

    stream->error(globalObject, reason);

    return jsUndefined();
}

bool JSWritableStreamDefaultController::shouldCallWrite() const
{
    if (!m_started)
        return false;

    if (m_writing)
        return false;

    if (m_inFlightWriteRequest)
        return false;

    if (!m_stream || m_stream->state() != JSWritableStream::State::Writable)
        return false;

    return true;
}

double JSWritableStreamDefaultController::getDesiredSize() const
{
    return m_strategyHWM - m_queueTotalSize;
}

template<typename Visitor>
void JSWritableStreamDefaultController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSWritableStreamDefaultController* thisObject = jsCast<JSWritableStreamDefaultController*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}

template<typename Visitor>
void JSWritableStreamDefaultController::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_stream);
    visitor.append(m_abortAlgorithm);
    visitor.append(m_closeAlgorithm);
    visitor.append(m_writeAlgorithm);
    visitor.append(m_strategySizeAlgorithm);
    visitor.append(m_queue);
    m_abortController.visit(visitor);
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultController);
DEFINE_VISIT_ADDITIONAL_CHILDREN(JSWritableStreamDefaultController);

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
    JSWritableStream* stream = m_stream.get();

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
    m_strategySizeAlgorithm.clear();

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

bool JSWritableStreamDefaultController::started() const
{
    return m_started;
}

void JSWritableStreamDefaultController::errorSteps()
{
    // Implementation of error steps for the controller
    if (m_stream)
        m_stream->error(globalObject(), jsUndefined());
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
