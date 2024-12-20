#include "root.h"

#include "ZigGlobalObject.h"
#include "BunTransformStreamConstructor.h"
#include "BunTransformStream.h"
#include "BunTransformStreamPrototype.h"
#include "BunTransformStreamDefaultController.h"
#include "BunBuiltinNames.h"

#include "ErrorCode.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSTransformStreamConstructor::s_info = {
    "Function"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSTransformStreamConstructor)
};

JSTransformStreamConstructor* JSTransformStreamConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSTransformStreamPrototype* prototype)
{
    JSTransformStreamConstructor* constructor = new (NotNull, JSC::allocateCell<JSTransformStreamConstructor>(vm)) JSTransformStreamConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

JSTransformStreamConstructor::JSTransformStreamConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, call, construct)
{
}

void JSTransformStreamConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSTransformStreamPrototype* prototype)
{
    Base::finishCreation(vm, 3, "TransformStream"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype,
        PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

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

} // namespace Bun
