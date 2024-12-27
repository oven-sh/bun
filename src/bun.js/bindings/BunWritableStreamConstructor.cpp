#include "BunWritableStreamConstructor.h"
#include "BunWritableStreamPrototype.h"
#include "BunWritableStream.h"
#include "BunWritableStreamDefaultController.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

using namespace JSC;

// Constructor Implementation
const ClassInfo JSWritableStreamConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamConstructor) };

JSWritableStreamConstructor::JSWritableStreamConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

JSWritableStreamConstructor* JSWritableStreamConstructor::create(VM& vm, JSGlobalObject* globalObject, JSWritableStreamPrototype* prototype)
{
    auto* structure = createStructure(vm, globalObject, globalObject->functionPrototype());
    JSWritableStreamConstructor* constructor = new (NotNull, allocateCell<JSWritableStreamConstructor>(vm)) JSWritableStreamConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

Structure* JSWritableStreamConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

static void underlyingSinkFromJS(
    JSC::VM& vm, JSGlobalObject* globalObject, JSValue underlyingSinkValue,
    JSC::JSValue strategyValue,
    JSC::JSValue& highWaterMarkValue,
    JSC::JSValue& sizeAlgorithmValue,
    JSC::JSValue& closeAlgorithmValue,
    JSC::JSValue& abortAlgorithmValue,
    JSC::JSValue& writeAlgorithmValue,
    JSC::JSValue& startAlgorithmValue)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Default values
    startAlgorithmValue = jsUndefined();
    writeAlgorithmValue = jsUndefined();
    closeAlgorithmValue = jsUndefined();
    abortAlgorithmValue = jsUndefined();

    auto& propertyNames = Bun::builtinNames(vm);

    // Extract strategy parameters
    if (!strategyValue.isUndefined()) {
        JSObject* strategyObj = strategyValue.getObject();
        if (!strategyObj) {
            throwVMTypeError(globalObject, scope, "WritableStream strategy must be an object"_s);
            return;
        }

        // Get highWaterMark
        highWaterMarkValue = strategyObj->getIfPropertyExists(globalObject, propertyNames.highWaterMarkPublicName());
        RETURN_IF_EXCEPTION(scope, void());
        if (!highWaterMarkValue || highWaterMarkValue.isUndefined()) {
            highWaterMarkValue = jsNumber(1);
        }

        // Get size algorithm
        sizeAlgorithmValue = strategyObj->getIfPropertyExists(globalObject, vm.propertyNames->size);
        RETURN_IF_EXCEPTION(scope, void());

        if (!sizeAlgorithmValue) {
            sizeAlgorithmValue = jsUndefined();
        }

        if (!sizeAlgorithmValue.isUndefined() && !sizeAlgorithmValue.isCallable()) {
            throwVMTypeError(globalObject, scope, "WritableStream strategy size must be callable"_s);
            return;
        }
        strategyValue = sizeAlgorithmValue;
    } else {
        highWaterMarkValue = jsNumber(1);
        sizeAlgorithmValue = jsUndefined();
    }

    // If no underlying sink, use defaults and return
    if (underlyingSinkValue.isUndefinedOrNull()) {
        return;
    }

    JSObject* underlyingSink = underlyingSinkValue.getObject();
    if (!underlyingSink) {
        throwVMTypeError(globalObject, scope, "WritableStream underlying sink must be an object"_s);
        return;
    }

    // Get start method
    startAlgorithmValue = underlyingSink->getIfPropertyExists(globalObject, propertyNames.startPublicName());
    RETURN_IF_EXCEPTION(scope, void());
    if (!startAlgorithmValue) {
        startAlgorithmValue = jsUndefined();
    }

    if (!startAlgorithmValue.isUndefined() && !startAlgorithmValue.isCallable()) {
        throwVMTypeError(globalObject, scope, "WritableStream underlying sink start must be callable"_s);
        return;
    }

    // Get write method
    writeAlgorithmValue = underlyingSink->getIfPropertyExists(globalObject, propertyNames.writePublicName());
    RETURN_IF_EXCEPTION(scope, void());
    if (!writeAlgorithmValue) {
        writeAlgorithmValue = jsUndefined();
    }

    if (!writeAlgorithmValue.isUndefined() && !writeAlgorithmValue.isCallable()) {
        throwVMTypeError(globalObject, scope, "WritableStream underlying sink write must be callable"_s);
        return;
    }

    // Get close method
    closeAlgorithmValue = underlyingSink->getIfPropertyExists(globalObject, propertyNames.closePublicName());
    RETURN_IF_EXCEPTION(scope, void());
    if (!closeAlgorithmValue) {
        closeAlgorithmValue = jsUndefined();
    }

    if (!closeAlgorithmValue.isUndefined() && !closeAlgorithmValue.isCallable()) {
        throwVMTypeError(globalObject, scope, "WritableStream underlying sink close must be callable"_s);
        return;
    }

    // Get abort method
    abortAlgorithmValue = underlyingSink->getIfPropertyExists(globalObject, Identifier::fromString(vm, "abort"_s));
    RETURN_IF_EXCEPTION(scope, void());
    if (!abortAlgorithmValue) {
        abortAlgorithmValue = jsUndefined();
    }

    if (!abortAlgorithmValue.isUndefined() && !abortAlgorithmValue.isCallable()) {
        throwVMTypeError(globalObject, scope, "WritableStream underlying sink abort must be callable"_s);
        return;
    }

    // Check for type property which is currently reserved
    JSValue typeValue = underlyingSink->getIfPropertyExists(globalObject, Identifier::fromString(vm, "type"_s));
    RETURN_IF_EXCEPTION(scope, void());
    if (!typeValue) {
        typeValue = jsUndefined();
    }

    if (!typeValue.isUndefined()) {
        throwVMTypeError(globalObject, scope, "WritableStream underlying sink type property is reserved for future use"_s);
        return;
    }
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrivateConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    // Similar to above but for internal usage
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto& streams = domGlobalObject->streams();
    Structure* structure = streams.structure<JSWritableStream>(domGlobalObject);
    JSWritableStream* stream = JSWritableStream::create(vm, globalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(stream);
}

void JSWritableStreamConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSWritableStreamPrototype* prototype)
{
    Base::finishCreation(vm, 1, "WritableStream"_s, PropertyAdditionMode::WithStructureTransition);
    this->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, 0);
}

JSC_DEFINE_HOST_FUNCTION(JSWritableStreamConstructor::call, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    return throwVMTypeError(globalObject, scope, "Cannot call WritableStream"_s);
}

JSC_DEFINE_HOST_FUNCTION(JSWritableStreamConstructor::construct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (UNLIKELY(!zigGlobalObject))
        return throwVMTypeError(globalObject, scope, "Invalid global object"_s);

    JSObject* newTarget = asObject(callFrame->newTarget());
    Structure* structure = zigGlobalObject->streams().structure<JSWritableStream>(zigGlobalObject);
    auto* constructor = zigGlobalObject->streams().constructor<JSWritableStream>(zigGlobalObject);

    if (!(!newTarget || newTarget != constructor)) {
        if (newTarget) {
            structure = JSC::InternalFunction::createSubclassStructure(getFunctionRealm(globalObject, newTarget), newTarget, structure);
        } else {
            structure = JSC::InternalFunction::createSubclassStructure(globalObject, constructor, structure);
        }
    }

    RETURN_IF_EXCEPTION(scope, {});

    // Extract constructor arguments per spec:
    // new WritableStream(underlyingSink = {}, strategy = {})
    JSValue underlyingSinkArg = callFrame->argument(0);
    JSValue strategyArg = callFrame->argument(1);

    // Create the underlying writable stream
    JSWritableStream* writableStream = JSWritableStream::create(vm, globalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    double highWaterMark = 1;

    JSC::JSValue highWaterMarkValue;
    JSC::JSValue sizeAlgorithmValue;
    JSC::JSValue closeAlgorithmValue;
    JSC::JSValue abortAlgorithmValue;
    JSC::JSValue writeAlgorithmValue;
    JSC::JSValue startAlgorithmValue;
    underlyingSinkFromJS(vm, globalObject, underlyingSinkArg, strategyArg, highWaterMarkValue, sizeAlgorithmValue, closeAlgorithmValue, abortAlgorithmValue, writeAlgorithmValue, startAlgorithmValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Set up the controller
    Structure* controllerStructure = zigGlobalObject->streams().structure<JSWritableStreamDefaultController>(zigGlobalObject);
    auto* controller = JSWritableStreamDefaultController::create(
        vm,
        globalObject,
        controllerStructure,
        writableStream,
        highWaterMark,
        abortAlgorithmValue.getObject(),
        closeAlgorithmValue.getObject(),
        writeAlgorithmValue.getObject(),
        sizeAlgorithmValue.getObject());
    RETURN_IF_EXCEPTION(scope, {});
    writableStream->setController(controller);

    RELEASE_AND_RETURN(scope, JSValue::encode(writableStream));
}

} // namespace Bun
