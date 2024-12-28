#include "root.h"

#include "BunReadableStreamBYOBReaderPrototype.h"
#include "BunReadableStreamBYOBReader.h"
#include "BunReadableStream.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamBYOBReaderClosedGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamBYOBReaderConstructor);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBReaderRead);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBReaderReleaseLock);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamBYOBReaderCancel);

/* Hash table for prototype */

static const HashTableValue JSReadableStreamBYOBReaderPrototypeTableValues[] = {
    { "closed"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsReadableStreamBYOBReaderClosedGetter, 0 } },
    { "read"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBReaderRead, 0 } },
    { "cancel"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBReaderCancel, 0 } },
    { "releaseLock"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamBYOBReaderReleaseLock, 0 } },
};

const ClassInfo JSReadableStreamBYOBReaderPrototype::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReaderPrototype) };

JSReadableStreamBYOBReaderPrototype* JSReadableStreamBYOBReaderPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    auto* prototype = new (NotNull, allocateCell<JSReadableStreamBYOBReaderPrototype>(vm)) JSReadableStreamBYOBReaderPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

Structure* JSReadableStreamBYOBReaderPrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSReadableStreamBYOBReaderPrototype::JSReadableStreamBYOBReaderPrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamBYOBReaderPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, info(), JSReadableStreamBYOBReaderPrototypeTableValues, *this);
    this->structure()->setMayBePrototype(true);
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamBYOBReaderClosedGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(JSValue::decode(thisValue));
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.closed called on incompatible receiver"_s);
    return JSValue::encode(reader->closedPromise());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBReaderRead, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Validate the reader
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(callFrame->thisValue());
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read called on incompatible receiver"_s);

    // 2. Check if stream is undefined (released)
    if (!reader->stream())
        return throwVMTypeError(globalObject, scope, "Cannot read from a released reader"_s);

    // 3. Validate view argument
    if (!callFrame->argumentCount())
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read requires at least one argument"_s);

    JSValue viewValue = callFrame->argument(0);
    if (!viewValue.isObject())
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read requires an ArrayBufferView argument"_s);

    // 4. Get the ArrayBufferView
    JSArrayBufferView* view = jsDynamicCast<JSArrayBufferView*>(viewValue);
    if (!view)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read requires an ArrayBufferView argument"_s);

    // 7. Get read options
    uint64_t minRequested = 1;
    if (callFrame->argumentCount() > 1) {
        JSValue options = callFrame->argument(1);
        if (!options.isUndefined()) {
            if (!options.isObject())
                return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader read options must be an object"_s);

            JSObject* optionsObj = jsCast<JSObject*>(options);
            JSValue minValue = optionsObj->get(globalObject, Identifier::fromString(vm, "min"_s));
            RETURN_IF_EXCEPTION(scope, encodedJSValue());

            if (!minValue.isUndefined()) {
                minRequested = minValue.toNumber(globalObject);
                RETURN_IF_EXCEPTION(scope, encodedJSValue());

                if (minRequested == 0)
                    return throwVMTypeError(globalObject, scope, "min option must be greater than 0"_s);

                if (minRequested > view->byteLength())
                    return throwVMRangeError(globalObject, scope, "min option cannot be greater than view's byte length"_s);
            }
        }
    }

    return JSValue::encode(reader->read(vm, globalObject, view, minRequested));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBReaderReleaseLock, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Validate the reader
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(callFrame->thisValue());
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.releaseLock called on incompatible receiver"_s);

    reader->releaseLock(vm, globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamBYOBReaderCancel, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Validate the reader
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(callFrame->thisValue());
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.cancel called on incompatible receiver"_s);

    // 2. Check if stream is undefined (released)
    JSReadableStream* stream = reader->stream();
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Cannot cancel a released reader"_s);

    // 3. Get cancel reason
    JSValue reason = callFrame->argument(0);

    // 4. Cancel the stream with the given reason
    JSPromise* promise = stream->cancel(vm, globalObject, reason);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    return JSValue::encode(promise);
}

JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamBYOBReaderConstructor, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return JSValue::encode(defaultGlobalObject(globalObject)->streams().constructor<JSReadableStreamBYOBReader>(globalObject));
}
}
