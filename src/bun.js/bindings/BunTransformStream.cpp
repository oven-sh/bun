#include "BunClientData.h"
#include "root.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/CallData.h>
#include "ErrorCode.h"
#include "BunTransformStream.h"
#include "BunTransformStreamDefaultController.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"

namespace Bun {

using namespace JSC;

// Prototype implementation
class JSTransformStreamPrototype final : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    static JSTransformStreamPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSTransformStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSTransformStreamPrototype>(vm)) JSTransformStreamPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTransformStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSTransformStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

// Constructor implementation
class JSTransformStreamConstructor final : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    static JSTransformStreamConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSTransformStreamPrototype* prototype)
    {
        JSTransformStreamConstructor* constructor = new (NotNull, JSC::allocateCell<JSTransformStreamConstructor>(vm)) JSTransformStreamConstructor(vm, structure);
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
    JSTransformStreamConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSTransformStreamPrototype*);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
};

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamReadableGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSTransformStream*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return throwVMTypeError(globalObject, scope, "Cannot get readable property of non-TransformStream"_s);
    }

    ASSERT(thisObject->readable());
    return JSValue::encode(thisObject->readable());
}

JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamWritableGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSTransformStream*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return throwVMTypeError(globalObject, scope, "Cannot get writable property of non-TransformStream"_s);
    }

    ASSERT(thisObject->writable());
    return JSValue::encode(thisObject->writable());
}

// Implementing the constructor binding
JSC_DEFINE_CUSTOM_GETTER(jsTransformStreamConstructor,
    (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* prototype = jsDynamicCast<JSTransformStreamPrototype*>(JSValue::decode(thisValue));
    if (UNLIKELY(!prototype))
        return throwVMTypeError(globalObject, scope, "Cannot get constructor for TransformStream"_s);

    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobalObject))
        return throwVMTypeError(globalObject, scope, "Invalid global object"_s);

    return JSValue::encode(zigGlobalObject->transformStreamConstructor());
}

// All static properties for the prototype
static const HashTableValue JSTransformStreamPrototypeTableValues[] = {
    { "readable"_s,
        static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamReadableGetter, nullptr } },
    { "writable"_s,
        static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamWritableGetter, nullptr } },
    { "constructor"_s,
        static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsTransformStreamConstructor, nullptr } }
};

// And now the constructor implementation
const ClassInfo JSTransformStreamConstructor::s_info = {
    "Function"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSTransformStreamConstructor)
};

void JSTransformStreamConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSTransformStreamPrototype* prototype)
{
    Base::finishCreation(vm, 3, "TransformStream"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype,
        PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

// Constructor function implementation for both 'new TransformStream()' and TransformStream() call
JSC_DEFINE_HOST_FUNCTION(JSTransformStreamConstructor::construct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobalObject))
        return throwVMTypeError(globalObject, scope, "Invalid global object"_s);

    JSObject* newTarget = asObject(callFrame->newTarget());
    Structure* structure = zigGlobalObject->transformStreamStructure();

    auto* constructor = zigGlobalObject->transformStreamConstructor();

    if (!(!newTarget || newTarget != constructor)) {
        if (newTarget) {
            structure = JSC::InternalFunction::createSubclassStructure(getFunctionRealm(globalObject, newTarget), newTarget, structure);
        } else {
            structure = JSC::InternalFunction::createSubclassStructure(globalObject, constructor, structure);
        }
    }

    RETURN_IF_EXCEPTION(scope, {});

    // Extract constructor arguments per spec:
    // new TransformStream(transformer = undefined, writableStrategy = {}, readableStrategy = {})
    JSValue transformerArg = callFrame->argument(0);
    JSValue writableStrategyArg = callFrame->argument(1);
    JSValue readableStrategyArg = callFrame->argument(2);

    // Create the underlying transform stream
    JSTransformStream* transformStream = JSTransformStream::create(vm, globalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    auto& builtinNames = Bun::builtinNames(vm);

    // Set up readable and writable sides with provided strategies
    if (!writableStrategyArg.isUndefined()) {
        // Apply writable strategy
        JSValue highWaterMark = writableStrategyArg.get(globalObject, builtinNames.highWaterMarkPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        JSValue size = writableStrategyArg.get(globalObject, vm.propertyNames->size);
        RETURN_IF_EXCEPTION(scope, {});
        // ... apply strategy to writable side
        UNUSED_PARAM(highWaterMark);
        UNUSED_PARAM(size);
    }

    if (!readableStrategyArg.isUndefined()) {
        // Apply readable strategy
        JSValue highWaterMark = readableStrategyArg.get(globalObject, builtinNames.highWaterMarkPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        JSValue size = readableStrategyArg.get(globalObject, vm.propertyNames->size);
        RETURN_IF_EXCEPTION(scope, {});
        // ... apply strategy to readable side

        // TODO: set up readable side
        UNUSED_PARAM(highWaterMark);
        UNUSED_PARAM(size);
    }

    // Handle transformer setup if provided
    if (!transformerArg.isUndefined()) {
        JSValue transformFn = transformerArg.get(globalObject, builtinNames.transformPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        JSValue flushFn = transformerArg.get(globalObject, builtinNames.flushPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        JSValue startFn = transformerArg.get(globalObject, builtinNames.startPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        // Set up transform algorithm
        if (!transformFn.isUndefined()) {
            // Install transform function
        }

        // Set up flush algorithm
        if (!flushFn.isUndefined()) {
            // Install flush function
        }

        // Call start if present
        if (!startFn.isUndefined()) {
            auto* controller = transformStream->controller();
            MarkedArgumentBuffer args;
            args.append(controller);

            auto callData = JSC::getCallData(startFn);
            if (callData.type == JSC::CallData::Type::None) {
                throwTypeError(globalObject, scope, "Start function is not callable"_s);
                return {};
            }
            IGNORE_WARNINGS_BEGIN("unused-variable")
            JSC::JSValue startResult = JSC::call(globalObject, startFn, callData, transformerArg, args);
            IGNORE_WARNINGS_END
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(transformStream));
}

JSC_DEFINE_HOST_FUNCTION(JSTransformStreamConstructor::call, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "Cannot call TransformStream"_s);
    return {};
}

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
        m_controller->error(globalObject, error);
}

void JSTransformStream::terminate(VM& vm, JSGlobalObject* globalObject)
{
    if (m_controller)
        m_controller->terminate(globalObject);
}

JSTransformStream* JSTransformStream::create(
    VM& vm,
    JSGlobalObject* globalObject,
    Structure* structure)
{
    JSTransformStream* ptr = new (
        NotNull,
        JSC::allocateCell<JSTransformStream>(vm)) JSTransformStream(vm, structure);

    ptr->finishCreation(vm, globalObject);
    return ptr;
}

void JSTransformStreamPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(
        vm,
        JSTransformStream::info(),
        JSTransformStreamPrototypeTableValues,
        *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSTransformStream::~JSTransformStream()
{
}

} // namespace Bun
