#include "root.h"

#include "BunTransformStreamDefaultController.h"
#include "BunTransformStream.h"
#include "BunReadableStream.h"
#include "BunWritableStream.h"
#include "BunReadableStreamDefaultController.h"

namespace Bun {

using namespace JSC;

JSTransformStreamDefaultController* JSTransformStreamDefaultController::create(
    JSC::VM& vm,
    JSC::JSGlobalObject* globalObject,
    JSC::Structure* structure,
    JSTransformStream* transformStream)
{
    JSTransformStreamDefaultController* controller = new (NotNull, JSC::allocateCell<JSTransformStreamDefaultController>(vm))
        JSTransformStreamDefaultController(vm, structure);
    controller->finishCreation(vm, globalObject, transformStream);
    return controller;
}

void JSTransformStreamDefaultController::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSTransformStream* transformStream)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_stream.set(vm, this, transformStream);
}

template<typename Visitor>
void JSTransformStreamDefaultController::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSTransformStreamDefaultController*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_stream);
    visitor.append(thisObject->m_flushPromise);
    visitor.append(thisObject->m_transformAlgorithm);
    visitor.append(thisObject->m_flushAlgorithm);
}

DEFINE_VISIT_CHILDREN(JSTransformStreamDefaultController);

bool JSTransformStreamDefaultController::enqueue(JSC::JSGlobalObject* globalObject, JSC::JSValue chunk)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the transform stream
    auto* stream = jsDynamicCast<JSTransformStream*>(m_stream.get());
    ASSERT(stream);

    // Get the readable controller from the stream's readable side
    auto* readable = jsDynamicCast<JSReadableStream*>(stream->readable());
    ASSERT(readable);
    auto* readableController = jsDynamicCast<JSReadableStreamDefaultController*>(readable->controller());
    ASSERT(readableController);

    // Check if we can enqueue to the readable controller
    if (!readableController->canCloseOrEnqueue()) {
        throwTypeError(globalObject, scope, "Cannot enqueue to readable side - controller cannot close or enqueue"_s);
        return false;
    }

    // Try to enqueue the chunk to the readable controller
    readableController->enqueue(vm, globalObject, chunk);

    // If enqueuing resulted in an error
    if (scope.exception()) {
        // Get the error from the scope
        JSValue error = scope.exception();
        scope.clearException();

        // Error the writable side and unblock write
        stream->error(vm, globalObject, error);

        // Throw the readable's stored error
        throwException(globalObject, scope, error);
        return false;
    }

    // Check if the readable controller now has backpressure
    double desiredSize = readableController->desiredSize();
    bool hasBackpressure = desiredSize <= 0;

    // If backpressure state changed and is now true
    if (hasBackpressure && !stream->hasBackpressure()) {
        stream->setBackpressure(true);
    }

    return true;
}

void JSTransformStreamDefaultController::error(JSC::JSGlobalObject* globalObject, JSC::JSValue error)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Implementation following spec's TransformStreamDefaultControllerError
    // This would propagate the error to both the readable and writable sides
}

void JSTransformStreamDefaultController::terminate(JSC::JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Implementation following spec's TransformStreamDefaultControllerTerminate
    // This would close the readable side and error the writable side
}

} // namespace Bun
