#include "BunReadableStreamPrototype.h"
#include "BunReadableStream.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamGetLocked);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamGetReader);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamCancel);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPipeTo);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPipeThrough);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamTee);

static const HashTableValue JSReadableStreamPrototypeTableValues[] = {
    { "locked"_s,
        static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsReadableStreamGetLocked, nullptr } },
    { "getReader"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamGetReader, 1 } },
    { "cancel"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamCancel, 1 } },
    { "pipeTo"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamPipeTo, 2 } },
    { "pipeThrough"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamPipeThrough, 2 } },
    { "tee"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamTee, 0 } }
};

const ClassInfo JSReadableStreamPrototype::s_info = { "ReadableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamPrototype) };

JSReadableStreamPrototype* JSReadableStreamPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    auto* thisObject = new (NotNull, allocateCell<JSReadableStreamPrototype>(vm)) JSReadableStreamPrototype(vm, structure);
    thisObject->finishCreation(vm, globalObject);
    return thisObject;
}

Structure* JSReadableStreamPrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    auto* structure = Base::createStructure(vm, globalObject, prototype);
    structure->setMayBePrototype(true);
    return structure;
}

template<typename CellType, SubspaceAccess>
JSC::GCClient::IsoSubspace* JSReadableStreamPrototype::subspaceFor(VM& vm)
{
    STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamPrototype, Base);
    return &vm.plainObjectSpace();
}

JSReadableStreamPrototype::JSReadableStreamPrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSReadableStreamPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JavaScript bindings
// JavaScript bindings
JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamGetLocked, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(JSValue::decode(thisValue));
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    return JSValue::encode(jsBoolean(stream->locked()));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamGetReader, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue options = callFrame->argument(0);
    return JSValue::encode(stream->getReader(vm, globalObject, options));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamCancel, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue reason = callFrame->argument(0);
    return JSValue::encode(stream->cancel(vm, globalObject, reason));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPipeTo, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue destination = callFrame->argument(0);
    JSValue options = callFrame->argument(1);

    return JSValue::encode(stream->pipeTo(vm, globalObject, destination.toObject(globalObject), options));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPipeThrough, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue transform = callFrame->argument(0);
    JSValue options = callFrame->argument(1);

    return JSValue::encode(stream->pipeThrough(vm, globalObject, transform.toObject(globalObject), options));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamTee, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSC::JSValue firstStream;
    JSC::JSValue secondStream;
    stream->tee(vm, globalObject, firstStream, secondStream);
    RETURN_IF_EXCEPTION(scope, {});

    JSArray* array = constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 2);
    array->putDirectIndex(globalObject, 0, firstStream);
    array->putDirectIndex(globalObject, 1, secondStream);
    return JSValue::encode(array);
}

} // namespace Bun
