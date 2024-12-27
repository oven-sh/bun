#include "root.h"

#include "BunReadableStreamConstructor.h"
#include "BunReadableStream.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include "ErrorCode.h"
#include "BunReadableStreamDefaultController.h"
namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamConstructor) };

JSReadableStreamConstructor* JSReadableStreamConstructor::create(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    auto* structure = createStructure(vm, globalObject, prototype);
    auto* constructor = new (NotNull, allocateCell<JSReadableStreamConstructor>(vm)) JSReadableStreamConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

Structure* JSReadableStreamConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

JSReadableStreamConstructor::JSReadableStreamConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

void JSReadableStreamConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "ReadableStream"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamConstructor::construct(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    JSObject* newTarget = asObject(callFrame->newTarget());
    auto& streams = zigGlobalObject->streams();
    Structure* structure = streams.structure<JSReadableStream>(globalObject);

    auto* constructor = streams.constructor<JSReadableStream>(globalObject);

    if (!(!newTarget || newTarget != constructor)) {
        if (newTarget) {
            structure = JSC::InternalFunction::createSubclassStructure(getFunctionRealm(globalObject, newTarget), newTarget, structure);
        } else {
            structure = JSC::InternalFunction::createSubclassStructure(globalObject, constructor, structure);
        }
    }

    JSValue underlyingSourceDict = callFrame->argument(0);
    JSObject* underlyingSourceObj = nullptr;

    if (!underlyingSourceDict.isUndefined() && !underlyingSourceDict.isNull()) {
        underlyingSourceObj = underlyingSourceDict.getObject();
        if (!underlyingSourceObj) {
            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "underlyingSource must be an object or undefined"_s);
            return {};
        }
    }

    double highWaterMark = 1;
    JSObject* startFunction = nullptr;
    JSC::CallData startCallData;
    JSObject* pullFunction = nullptr;
    JSObject* cancelFunction = nullptr;
    JSObject* sizeFunction = nullptr;
    bool isBYOB = false;
    auto& builtinNames = WebCore::builtinNames(vm);

    if (underlyingSourceObj) {
        JSValue typeValue = underlyingSourceObj->getIfPropertyExists(globalObject, vm.propertyNames->type);
        RETURN_IF_EXCEPTION(scope, {});

        if (typeValue && !typeValue.isNull() && !typeValue.isUndefined()) {
            if (!typeValue.isString()) {
                Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "ReadableStream 'type' must be a string or undefined"_s);
                return {};
            }

            auto typeString = typeValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            if (typeString == "byob"_s) {
                isBYOB = true;
            }
        }

        JSValue startValue = underlyingSourceObj->getIfPropertyExists(globalObject, builtinNames.startPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (startValue && !startValue.isNull() && !startValue.isUndefined()) {
            startFunction = startValue.getObject();
            if (!startFunction) {
                Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "ReadableStream 'start' must be a function or undefined"_s);
                return {};
            }
            startCallData = JSC::getCallData(startFunction);

            if (startCallData.type == CallData::Type::None) {
                Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "ReadableStream 'start' must be a function or undefined"_s);
                return {};
            }
        }

        JSValue pullValue = underlyingSourceObj->getIfPropertyExists(globalObject, builtinNames.pullPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (pullValue && !pullValue.isNull() && !pullValue.isUndefined()) {
            pullFunction = pullValue.getObject();

            if (!pullFunction || !pullFunction->isCallable()) {
                Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "ReadableStream 'pull' must be a function or undefined"_s);
                return {};
            }
        }

        JSValue cancelValue = underlyingSourceObj->getIfPropertyExists(globalObject, builtinNames.cancelPublicName());
        RETURN_IF_EXCEPTION(scope, {});

        if (cancelValue && !cancelValue.isNull() && !cancelValue.isUndefined()) {
            cancelFunction = cancelValue.getObject();

            if (!cancelFunction || !cancelFunction->isCallable()) {
                Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "ReadableStream 'cancel' must be a function or undefined"_s);
                return {};
            }
        }

        JSValue sizeValue = underlyingSourceObj->getIfPropertyExists(globalObject, vm.propertyNames->size);
        RETURN_IF_EXCEPTION(scope, {});

        if (sizeValue && !sizeValue.isNull() && !sizeValue.isUndefined()) {
            sizeFunction = sizeValue.getObject();
        }
    }

    if (isBYOB) {
        // TODO: Implement BYOB
        scope.throwException(globalObject, JSC::createTypeError(globalObject, "BYOB ReadableStream is not implemented"_s));
        return {};
    }

    auto* stream = JSReadableStream::create(vm, globalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    JSReadableStreamDefaultController* controller = JSReadableStreamDefaultController::create(vm, globalObject, streams.structure<JSReadableStreamDefaultController>(globalObject), stream);
    RETURN_IF_EXCEPTION(scope, {});
    stream->setController(vm, controller);

    controller->setup(vm, globalObject, stream, underlyingSourceObj, startFunction, pullFunction, cancelFunction, highWaterMark, sizeFunction);

    return JSValue::encode(stream);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamConstructor::call(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    return throwVMTypeError(globalObject, scope, "ReadableStream constructor cannot be called without 'new'"_s);
}

} // namespace Bun
