#include "BunWritableStreamDefaultWriterPrototype.h"
#include "BunWritableStreamDefaultWriter.h"
#include "JSDOMWrapper.h"

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterClosedGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterReadyGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterDesiredSizeGetter);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterWrite);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterAbort);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterClose);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterReleaseLock);

// Property attributes for standard WritableStreamDefaultWriter prototype properties
static const unsigned ProtoAccessorDontDelete = PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor;
static const unsigned ProtoFunctionDontEnum = PropertyAttribute::DontEnum | PropertyAttribute::Function;

// Table of prototype properties and methods
static const HashTableValue JSWritableStreamDefaultWriterPrototypeTableValues[] = {
    { "closed"_s, ProtoAccessorDontDelete, NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterClosedGetter, nullptr } },
    { "ready"_s, ProtoAccessorDontDelete, NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterReadyGetter, nullptr } },
    { "desiredSize"_s, ProtoAccessorDontDelete, NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterDesiredSizeGetter, nullptr } },
    { "write"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterWrite, 1 } },
    { "abort"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterAbort, 1 } },
    { "close"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterClose, 0 } },
    { "releaseLock"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterReleaseLock, 0 } },
};

const ClassInfo JSWritableStreamDefaultWriterPrototype::s_info = {
    "WritableStreamDefaultWriter"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultWriterPrototype)
};

JSWritableStreamDefaultWriterPrototype* JSWritableStreamDefaultWriterPrototype::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSWritableStreamDefaultWriterPrototype* ptr = new (NotNull, JSC::allocateCell<JSWritableStreamDefaultWriterPrototype>(vm)) JSWritableStreamDefaultWriterPrototype(vm, structure);
    ptr->finishCreation(vm, globalObject);
    return ptr;
}

void JSWritableStreamDefaultWriterPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSWritableStreamDefaultWriterPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Getter implementations
JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterClosedGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(JSValue::decode(thisValue));
    if (!writer) {
        throwTypeError(globalObject, scope, "Not a WritableStreamDefaultWriter"_s);
        return encodedJSValue();
    }

    return JSValue::encode(writer->closed());
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterReadyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(JSValue::decode(thisValue));
    if (!writer) {
        throwTypeError(globalObject, scope, "Not a WritableStreamDefaultWriter"_s);
        return encodedJSValue();
    }

    return JSValue::encode(writer->ready());
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterDesiredSizeGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(JSValue::decode(thisValue));
    if (!writer) {
        throwTypeError(globalObject, scope, "Not a WritableStreamDefaultWriter"_s);
        return encodedJSValue();
    }

    return JSValue::encode(jsNumber(writer->desiredSize()));
}

// Method implementations
JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterWrite, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject,
            createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    JSValue chunk = callFrame->argument(0);

    JSValue error;
    if (!writer->write(globalObject, chunk, &error)) {
        scope.throwException(globalObject, error);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject,
            createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    JSValue error;
    if (!writer->close(globalObject, &error)) {
        scope.throwException(globalObject, error);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterAbort, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject,
            createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    JSValue reason = callFrame->argument(0);

    JSValue error;
    if (!writer->abort(globalObject, reason, &error)) {
        scope.throwException(globalObject, error);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterReleaseLock, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject,
            createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    writer->release();
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
