#include "root.h"

#include "BunWritableStream.h"
#include "BunReadableStream.h"
#include "BunTransformStream.h"
#include "BunTransformStreamDefaultController.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSPromise.h>

#include "BunWritableStreamDefaultController.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSTransformStream::s_info = {
    "TransformStream"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSTransformStream)
};

template<typename Visitor>
void JSTransformStream::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSTransformStream*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_readable);
    visitor.append(thisObject->m_writable);
    visitor.append(thisObject->m_controller);
    visitor.append(thisObject->m_backpressureChangePromise);
}

DEFINE_VISIT_CHILDREN(JSTransformStream);

JSTransformStream::JSTransformStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSTransformStream::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    // Initialize readable/writable sides and controller
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobalObject)) {
        throwTypeError(globalObject, scope, "Invalid global object"_s);
        return;
    }

    // Initialize with empty promises that will be fulfilled when ready
    m_backpressureChangePromise.set(vm, this, JSPromise::create(vm, zigGlobalObject->promiseStructure()));

    // Set up the controller
    m_controller.set(vm, this, JSTransformStreamDefaultController::create(vm, globalObject, zigGlobalObject->transformStreamDefaultControllerStructure(), this));

    RETURN_IF_EXCEPTION(scope, void());
}

JSTransformStream* JSTransformStream::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    JSTransformStream* ptr = new (NotNull, JSC::allocateCell<JSTransformStream>(vm)) JSTransformStream(vm, structure);
    ptr->finishCreation(vm, globalObject);
    return ptr;
}

void JSTransformStream::enqueue(VM& vm, JSGlobalObject* globalObject, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_controller)
        m_controller->enqueue(globalObject, chunk);

    RETURN_IF_EXCEPTION(scope, void());
}

void JSTransformStream::error(VM& vm, JSGlobalObject* globalObject, JSValue error)
{
    if (m_controller)
        m_controller->error(vm, globalObject, error);
}

void JSTransformStream::terminate(VM& vm, JSGlobalObject* globalObject)
{
    if (m_controller)
        m_controller->terminate(vm, globalObject);
}

void JSTransformStream::errorWritableAndUnblockWrite(VM& vm, JSGlobalObject* globalObject, JSValue error)
{
    if (m_controller) {
        auto* controller = this->controller();
        // Clear algorithms on controller
        controller->clearAlgorithms();

        // Error the writable stream's controller if needed
        if (auto* writable = writableStream()) {
            if (auto* controller = writable->controller()) {
                controller->error(vm, globalObject, error);
            }
        }

        this->unblockWrite(vm, globalObject);
    }
}

void JSTransformStream::unblockWrite(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    // If stream.[[backpressure]] is true, perform ! TransformStreamSetBackpressure(stream, false).
    if (m_backpressure) {
        if (m_backpressureChangePromise) {
            m_backpressureChangePromise->fulfillWithNonPromise(globalObject, jsUndefined());
            m_backpressureChangePromise.clear();
        }
    }

    m_backpressure = false;
}

JSWritableStream* JSTransformStream::writableStream() const
{
    return jsCast<JSWritableStream*>(m_writable.get());
}

JSReadableStream* JSTransformStream::readableStream() const
{
    return jsCast<JSReadableStream*>(m_readable.get());
}

void JSTransformStream::setBackpressure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    if (m_backpressure) {
        return;
    }

    // TransformStreamSetBackpressure(stream, backpressure) performs the following steps:
    // Assert: stream.[[backpressure]] is not backpressure.
    if (m_backpressureChangePromise) {
        m_backpressureChangePromise->fulfillWithNonPromise(globalObject, jsUndefined());
        m_backpressureChangePromise.clear();
    }

    m_backpressure = true;
}

} // namespace Bun
