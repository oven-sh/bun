#include "BunClientData.h"
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

JSC::GCClient::IsoSubspace* JSTransformStreamDefaultController::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSTransformStreamDefaultController, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForTransformStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForTransformStreamDefaultController = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForTransformStreamDefaultController.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForTransformStreamDefaultController = std::forward<decltype(space)>(space); });
}

void JSTransformStreamDefaultController::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSTransformStream* transformStream)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_stream.set(vm, this, transformStream);
}

JSTransformStream* JSTransformStreamDefaultController::stream() const
{
    return JSC::jsCast<JSTransformStream*>(m_stream.get());
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

bool JSTransformStreamDefaultController::enqueue(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue chunk)
{
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
    if (hasBackpressure) {
        stream->setBackpressure(vm, globalObject);
    } else {
        stream->unblockWrite(vm, globalObject);
    }

    return true;
}

void JSTransformStreamDefaultController::error(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue error)
{
    auto* stream = this->stream();
    ASSERT(stream);
    stream->error(vm, globalObject, error);
}

void JSTransformStreamDefaultController::terminate(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* stream = this->stream();
    ASSERT(stream);

    // Get the readable controller
    auto* readable = stream->readableStream();
    ASSERT(readable);
    auto* readableController = readable->controller();
    ASSERT(readableController);

    // Close the readable controller
    readableController->close(vm, globalObject);
    RETURN_IF_EXCEPTION(scope, void());

    // Create TypeError for termination
    JSC::JSValue error = JSC::createTypeError(globalObject, "The stream has been terminated"_s);

    // Error the writable side and unblock write
    // Call TransformStreamErrorWritableAndUnblockWrite operation
    stream->errorWritableAndUnblockWrite(vm, globalObject, error);
}

const ClassInfo JSTransformStreamDefaultController::s_info = { "TransformStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultController) };

} // namespace Bun
