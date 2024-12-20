#include "root.h"

#include "BunTransformStreamDefaultController.h"
#include "BunTransformStream.h"
#include "BunReadableStream.h"
#include "BunWritableStream.h"

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

    // Implementation following spec's TransformStreamDefaultControllerEnqueue
    // This would integrate with the ReadableStream's controller to actually enqueue the chunk
    // and handle backpressure

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
