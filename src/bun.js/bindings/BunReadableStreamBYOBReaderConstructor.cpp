#include "root.h"

#include "BunReadableStreamBYOBReaderConstructor.h"
#include "BunReadableStreamBYOBReader.h"
#include "BunReadableStream.h"
#include "JavaScriptCore/InternalFunction.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/Error.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamBYOBReaderConstructor::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReaderConstructor) };

JSReadableStreamBYOBReaderConstructor::JSReadableStreamBYOBReaderConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, nullptr, construct)
{
}

void JSReadableStreamBYOBReaderConstructor::finishCreation(VM& vm)
{
    Base::finishCreation(vm, 1, "ReadableStreamBYOBReader"_s, InternalFunction::PropertyAdditionMode::WithoutStructureTransition);
    ASSERT(inherits(info()));
}

JSReadableStreamBYOBReaderConstructor* JSReadableStreamBYOBReaderConstructor::create(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    auto* structure = createStructure(vm, globalObject, prototype);
    JSReadableStreamBYOBReaderConstructor* constructor = new (NotNull, allocateCell<JSReadableStreamBYOBReaderConstructor>(vm)) JSReadableStreamBYOBReaderConstructor(vm, structure);
    constructor->finishCreation(vm);
    return constructor;
}

Structure* JSReadableStreamBYOBReaderConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

} // namespace Bun
