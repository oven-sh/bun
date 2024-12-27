#include "BunWritableStreamPrototype.h"
#include "BunWritableStream.h"
#include "BunWritableStreamDefaultController.h"
#include "BunWritableStreamDefaultWriter.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// JSWritableStreamPrototype bindings
JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_abort, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.abort called on non-WritableStream object"_s);

    JSValue reason = callFrame->argument(0);
    return JSValue::encode(stream->abort(globalObject, reason));
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_close, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.close called on non-WritableStream object"_s);

    return JSValue::encode(stream->close(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_getWriter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.getWriter called on non-WritableStream object"_s);

    if (stream->isLocked())
        return throwVMTypeError(globalObject, scope, "Cannot get writer for locked WritableStream"_s);

    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto& streams = domGlobalObject->streams();

    Structure* writerStructure = streams.structure<JSWritableStreamDefaultWriter>(domGlobalObject);
    auto* writer = JSWritableStreamDefaultWriter::create(vm, writerStructure, stream);
    RETURN_IF_EXCEPTION(scope, {});

    stream->setWriter(vm, writer);
    return JSValue::encode(writer);
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamPrototypeLockedGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(JSValue::decode(thisValue));
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.locked called on non-WritableStream object"_s);

    return JSValue::encode(jsBoolean(stream->isLocked()));
}

// Static hash table of properties
static const HashTableValue JSWritableStreamPrototypeTableValues[] = {
    { "abort"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_abort, 1 } },
    { "close"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_close, 0 } },
    { "getWriter"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_getWriter, 0 } },
    { "locked"_s,
        static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamPrototypeLockedGetter, nullptr } }
};

// Prototype Implementation
const ClassInfo JSWritableStreamPrototype::s_info = { "WritableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamPrototype) };

JSWritableStreamPrototype* JSWritableStreamPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    auto* prototype = new (NotNull, allocateCell<JSWritableStreamPrototype>(vm)) JSWritableStreamPrototype(vm, structure);
    prototype->finishCreation(vm, globalObject);
    return prototype;
}

JSWritableStreamPrototype::JSWritableStreamPrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSWritableStreamPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWritableStream::info(), JSWritableStreamPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

} // namespace Bun
