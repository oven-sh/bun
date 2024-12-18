#include "root.h"

#include "BunReadableStreamDefaultController.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSArray.h>
#include "BunReadableStream.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Completion.h>
namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeClose, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->thisValue());
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.close called on incompatible object"_s);

    controller->close(globalObject);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeEnqueue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->thisValue());
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.enqueue called on incompatible object"_s);

    JSValue chunk = callFrame->argument(0);
    return JSValue::encode(controller->enqueue(globalObject, chunk));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamDefaultControllerPrototypeError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(callFrame->thisValue());
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.error called on incompatible object"_s);

    JSValue error = callFrame->argument(0);
    controller->error(globalObject, error);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamDefaultControllerPrototypeDesiredSizeGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultController* controller = jsDynamicCast<JSReadableStreamDefaultController*>(JSValue::decode(thisValue));
    if (!controller)
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultController.prototype.desiredSize called on incompatible object"_s);

    return JSValue::encode(jsDoubleNumber(controller->desiredSize()));
}

static const JSC::HashTableValue JSReadableStreamDefaultControllerPrototypeTableValues[] = {
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeClose, 0 } },
    { "enqueue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeEnqueue, 1 } },
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamDefaultControllerPrototypeError, 1 } },
    { "desiredSize"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsReadableStreamDefaultControllerPrototypeDesiredSizeGetter, nullptr } }
};

class JSReadableStreamDefaultControllerConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSReadableStreamDefaultControllerConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSObject* prototype)
    {
        JSReadableStreamDefaultControllerConstructor* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultControllerConstructor>(vm)) JSReadableStreamDefaultControllerConstructor(vm, structure);
        ptr->finishCreation(vm, globalObject, prototype);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSReadableStreamDefaultControllerConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, nullptr, nullptr) // nullptr for construct as this isn't constructable
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "ReadableStreamDefaultController"_s, PropertyAdditionMode::WithoutStructureTransition);

        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

class JSReadableStreamDefaultControllerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSReadableStreamDefaultControllerPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamDefaultControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultControllerPrototype>(vm)) JSReadableStreamDefaultControllerPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamDefaultControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSReadableStreamDefaultControllerPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, info(), JSReadableStreamDefaultControllerPrototypeTableValues, *this);

        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

JSReadableStreamDefaultController* JSReadableStreamDefaultController::create(VM& vm, Structure* structure, JSReadableStream* stream)
{
    JSReadableStreamDefaultController* controller = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultController>(vm)) JSReadableStreamDefaultController(vm, structure);
    controller->finishCreation(vm, stream);
    return controller;
}

JSObject* JSReadableStreamDefaultController::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    JSReadableStreamDefaultControllerPrototype* prototype = JSReadableStreamDefaultControllerPrototype::create(vm, globalObject, JSReadableStreamDefaultControllerPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    return prototype;
}

JSValue JSReadableStreamDefaultController::desiredSizeValue()
{
    if (!canCloseOrEnqueue())
        return jsNull();

    // According to spec, desiredSize = highWaterMark - queueTotalSize
    return jsNumber(m_strategyHWM - m_queueTotalSize);
}

double JSReadableStreamDefaultController::desiredSize()
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
    JSArray* queue = m_queue.get(this);
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
        Bun::performPromiseThen(globalObject, promise, jsReadableStreamDefaultControllerFullfillPull, jsReadableStreamDefaultControllerRejectPull, this);
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
    if (reader->numReadRequests() == 0)
        return false;

    double desiredSize = m_strategyHWM - m_queueTotalSize;
    if (desiredSize <= 0)
        return false;

    return true;
}

const ClassInfo JSReadableStreamDefaultControllerConstructor::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultControllerConstructor) };
const ClassInfo JSReadableStreamDefaultControllerPrototype::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultControllerPrototype) };
const ClassInfo JSReadableStreamDefaultController::s_info = { "ReadableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultController) };
}
