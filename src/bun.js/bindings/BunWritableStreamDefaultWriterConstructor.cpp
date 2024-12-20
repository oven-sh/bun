#include "BunWritableStreamDefaultWriterConstructor.h"
#include "BunWritableStreamDefaultWriterPrototype.h"
#include "BunWritableStreamDefaultWriter.h"
#include "BunWritableStream.h"
#include "JavaScriptCore/InternalFunction.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSWritableStreamDefaultWriterConstructor::s_info = {
    "Function"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultWriterConstructor)
};

JSWritableStreamDefaultWriterConstructor::JSWritableStreamDefaultWriterConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

void JSWritableStreamDefaultWriterConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSWritableStreamDefaultWriterPrototype* prototype)
{
    Base::finishCreation(vm, 1, "WritableStreamDefaultWriter"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

JSWritableStreamDefaultWriterConstructor* JSWritableStreamDefaultWriterConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSWritableStreamDefaultWriterPrototype* prototype)
{
    JSWritableStreamDefaultWriterConstructor* constructor = new (NotNull, allocateCell<JSWritableStreamDefaultWriterConstructor>(vm)) JSWritableStreamDefaultWriterConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

// This is called when constructing a new writer with new WritableStreamDefaultWriter(stream)
EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamDefaultWriterConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!callFrame->argumentCount()) {
        throwTypeError(lexicalGlobalObject, scope, "WritableStreamDefaultWriter constructor requires a WritableStream argument"_s);
        return encodedJSValue();
    }

    JSValue streamValue = callFrame->argument(0);
    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(streamValue);
    if (!stream) {
        throwTypeError(lexicalGlobalObject, scope, "WritableStreamDefaultWriter constructor argument must be a WritableStream"_s);
        return encodedJSValue();
    }

    // Check if stream is locked
    if (stream->isLocked()) {
        throwTypeError(lexicalGlobalObject, scope, "Cannot construct a WritableStreamDefaultWriter for a locked WritableStream"_s);
        return encodedJSValue();
    }

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    Structure* structure = globalObject->streams().getWritableStreamStructure(globalObject);
    JSValue newTarget = callFrame->newTarget();

    if (UNLIKELY(globalObject->streams().getWritableStreamConstructor(globalObject) != newTarget)) {
        auto* functionGlobalObject = getFunctionRealm(lexicalGlobalObject, newTarget.getObject());
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            lexicalGlobalObject, newTarget.getObject(), globalObject->streams().getWritableStreamStructure(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSWritableStreamDefaultWriter* writer = JSWritableStreamDefaultWriter::create(vm, structure, stream);
    return JSValue::encode(writer);
}

// This handles direct calls to WritableStreamDefaultWriter as a function, which should throw an error
EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamDefaultWriterConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMTypeError(globalObject, scope, "WritableStreamDefaultWriter constructor cannot be called as a function"_s);
}

} // namespace Bun
