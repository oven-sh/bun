#include "root.h"

#include "BunReadableStreamDefaultController.h"
#include "BunReadableStream.h"
#include "BunReadableStreamDefaultReader.h"

#include "ErrorCode.h"
#include <JavaScriptCore/JSObjectInlines.h>

#include "BunReadableStreamDefaultReaderPrototype.h"
#include "BunReadableStreamDefaultReaderConstructor.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamDefaultReaderConstructor::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReaderConstructor) };

JSReadableStreamDefaultReaderConstructor* JSReadableStreamDefaultReaderConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStreamDefaultReaderPrototype* prototype)
{
    JSReadableStreamDefaultReaderConstructor* constructor = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReaderConstructor>(vm)) JSReadableStreamDefaultReaderConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSReadableStreamDefaultReaderConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStreamDefaultReaderPrototype* prototype)
{
    Base::finishCreation(vm, 1, "ReadableStreamDefaultReader"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamDefaultReaderConstructor::call(JSC::JSGlobalObject* globalObject, JSC::CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "ReadableStreamDefaultReader constructor cannot be called as a function"_s);
    return {};
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamDefaultReaderConstructor::construct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultReader constructor requires a ReadableStream argument"_s);
    }

    JSValue streamValue = callFrame->uncheckedArgument(0);
    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(streamValue);
    if (!stream) {
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultReader constructor argument must be a ReadableStream"_s);
    }

    // Check if stream is already locked
    if (stream->isLocked()) {
        return throwVMTypeError(globalObject, scope, "Cannot construct a ReadableStreamDefaultReader for a locked ReadableStream"_s);
    }

    JSC::JSObject* newTarget = callFrame->newTarget().getObject();
    JSC::JSObject* constructor = callFrame->jsCallee();

    auto* structure = defaultGlobalObject(globalObject)->readableStreamDefaultReaderStructure();

    // TODO: double-check this.
    if (!(!newTarget || newTarget == constructor)) {
        if (newTarget) {
            structure = JSC::InternalFunction::createSubclassStructure(getFunctionRealm(globalObject, newTarget), newTarget, structure);
        } else {
            structure = JSC::InternalFunction::createSubclassStructure(globalObject, constructor, structure);
        }
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSReadableStreamDefaultReader* reader = JSReadableStreamDefaultReader::create(vm, globalObject, structure, stream);
    RETURN_IF_EXCEPTION(scope, {});

    // Lock the stream to this reader
    stream->setReader(reader);

    // Set up initial ready state
    if (stream->isDisturbed() || stream->state() == JSReadableStream::State::Errored) {
        JSValue error = stream->storedError();
        if (!error)
            error = jsUndefined();

        reader->readyPromise()->reject(globalObject, error);
    } else {
        reader->readyPromise()->fulfillWithNonPromise(globalObject, jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(reader));
}

} // namespace Bun
