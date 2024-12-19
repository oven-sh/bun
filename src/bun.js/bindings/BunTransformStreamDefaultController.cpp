#include "root.h"

#include "BunTransformStreamDefaultController.h"
#include "BunTransformStream.h"
#include "BunReadableStream.h"
#include "BunWritableStream.h"

namespace Bun {

using namespace JSC;

class JSTransformStreamDefaultControllerPrototype final : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    static JSTransformStreamDefaultControllerPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSTransformStreamDefaultControllerPrototype* ptr = new (NotNull, JSC::allocateCell<JSTransformStreamDefaultControllerPrototype>(vm))
            JSTransformStreamDefaultControllerPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTransformStreamDefaultControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSTransformStreamDefaultControllerPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSTransformStreamDefaultControllerConstructor final : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    static JSTransformStreamDefaultControllerConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSTransformStreamDefaultControllerPrototype* prototype)
    {
        JSTransformStreamDefaultControllerConstructor* constructor = new (NotNull, JSC::allocateCell<JSTransformStreamDefaultControllerConstructor>(vm))
            JSTransformStreamDefaultControllerConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSTransformStreamDefaultControllerConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSTransformStreamDefaultControllerPrototype*);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
};

static const HashTableValue JSTransformStreamDefaultControllerPrototypeTableValues[] = {
    { "enqueue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerEnqueue, 1 } },
    { "error"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerError, 1 } },
    { "terminate"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsTransformStreamDefaultControllerTerminate, 0 } },
    { "desiredSize"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamDefaultControllerDesiredSize, 0 } },
};

const ClassInfo JSTransformStreamDefaultController::s_info = { "TransformStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultController) };
const ClassInfo JSTransformStreamDefaultControllerConstructor::s_info = { "TransformStreamDefaultController"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultControllerConstructor) };

const ClassInfo JSTransformStreamDefaultControllerPrototype::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultControllerPrototype) };

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

void JSTransformStreamDefaultControllerPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, info(), JSTransformStreamDefaultControllerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void JSTransformStreamDefaultControllerConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSTransformStreamDefaultControllerPrototype* prototype)
{
    Base::finishCreation(vm, 2, "TransformStreamDefaultController"_s, PropertyAdditionMode::WithoutStructureTransition);
    ASSERT(inherits(info()));

    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);
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

// JavaScript binding implementations

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamDefaultControllerDesiredSize, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSTransformStreamDefaultController*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    // Return the desired size per spec
    return JSValue::encode(jsNumber(0)); // Placeholder
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerEnqueue, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* controller = jsDynamicCast<JSTransformStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    JSValue chunk = callFrame->argument(0);

    if (!controller->enqueue(globalObject, chunk))
        return JSValue::encode(jsUndefined());

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerError, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* controller = jsDynamicCast<JSTransformStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    controller->error(globalObject, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTransformStreamDefaultControllerTerminate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* controller = jsDynamicCast<JSTransformStreamDefaultController*>(callFrame->thisValue());
    if (UNLIKELY(!controller))
        return throwVMTypeError(globalObject, scope, "Receiver must be a TransformStreamDefaultController"_s);

    controller->terminate(globalObject);
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
