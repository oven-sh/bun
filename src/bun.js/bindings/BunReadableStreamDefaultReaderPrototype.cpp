#include "BunReadableStreamDefaultReaderPrototype.h"
#include "BunReadableStreamDefaultReader.h"
#include "BunReadableStream.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(readableStreamDefaultReaderClosedGetter);
static JSC_DECLARE_CUSTOM_GETTER(readableStreamDefaultReaderReadyGetter);
static JSC_DECLARE_HOST_FUNCTION(readableStreamDefaultReaderRead);
static JSC_DECLARE_HOST_FUNCTION(readableStreamDefaultReaderReleaseLock);
static JSC_DECLARE_HOST_FUNCTION(readableStreamDefaultReaderCancel);

const ClassInfo JSReadableStreamDefaultReaderPrototype::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReaderPrototype) };

static const HashTableValue JSReadableStreamDefaultReaderPrototypeTableValues[] = {
    { "closed"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, readableStreamDefaultReaderClosedGetter, nullptr } },
    { "ready"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, readableStreamDefaultReaderReadyGetter, nullptr } },
    { "read"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamDefaultReaderRead, 0 } },
    { "releaseLock"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamDefaultReaderReleaseLock, 0 } },
    { "cancel"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamDefaultReaderCancel, 1 } },
};

JSReadableStreamDefaultReaderPrototype* JSReadableStreamDefaultReaderPrototype::create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
{
    JSReadableStreamDefaultReaderPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReaderPrototype>(vm)) JSReadableStreamDefaultReaderPrototype(vm, globalObject, structure);
    ptr->finishCreation(vm);
    return ptr;
}

void JSReadableStreamDefaultReaderPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableStreamDefaultReader::info(), JSReadableStreamDefaultReaderPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JS Bindings Implementation
JSC_DEFINE_HOST_FUNCTION(readableStreamDefaultReaderRead, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultReader* reader = jsDynamicCast<JSReadableStreamDefaultReader*>(callFrame->thisValue());
    if (!reader) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.read called on incompatible object"_s));
        return {};
    }

    JSC::JSPromise* promise = reader->read(vm, globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(readableStreamDefaultReaderReleaseLock, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultReader* reader = jsDynamicCast<JSReadableStreamDefaultReader*>(callFrame->thisValue());
    if (!reader) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.releaseLock called on incompatible object"_s));
        return {};
    }

    reader->releaseLock();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(readableStreamDefaultReaderClosedGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultReader* reader = jsDynamicCast<JSReadableStreamDefaultReader*>(JSValue::decode(thisValue));
    if (!reader) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.closed called on incompatible object"_s));
        return {};
    }

    return JSValue::encode(reader->closedPromise());
}

JSC_DEFINE_CUSTOM_GETTER(readableStreamDefaultReaderReadyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultReader* reader = jsDynamicCast<JSReadableStreamDefaultReader*>(JSValue::decode(thisValue));
    if (!reader) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.ready called on incompatible object"_s));
        return {};
    }

    return JSValue::encode(reader->readyPromise());
}

JSC_DEFINE_HOST_FUNCTION(readableStreamDefaultReaderCancel, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultReader* reader = jsDynamicCast<JSReadableStreamDefaultReader*>(callFrame->thisValue());
    if (!reader) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.cancel called on incompatible object"_s));
        return {};
    }

    JSValue reason = callFrame->argument(0);
    if (!reader->isActive()) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.cancel called on released reader"_s));
        return {};
    }

    return JSValue::encode(reader->stream()->cancel(globalObject, reason));
}

} // namespace Bun
