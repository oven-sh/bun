#include "root.h"

#include "BunReadableStreamBYOBReaderConstructor.h"
#include "BunReadableStreamBYOBReader.h"
#include "BunReadableStream.h"
#include "JavaScriptCore/InternalFunction.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/Error.h>

#include "JSDOMConstructorBase.h"
#include "JSDOMConstructorNotConstructable.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamBYOBReaderConstructor::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReaderConstructor) };

JSReadableStreamBYOBReaderConstructor::JSReadableStreamBYOBReaderConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, WebCore::callThrowTypeErrorForJSDOMConstructorNotCallableOrConstructable, WebCore::callThrowTypeErrorForJSDOMConstructorNotCallableOrConstructable)
{
}

void JSReadableStreamBYOBReaderConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "ReadableStreamBYOBReader"_s, InternalFunction::PropertyAdditionMode::WithStructureTransition);
    ASSERT(inherits(info()));

    putDirect(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSReadableStreamBYOBReaderConstructor* JSReadableStreamBYOBReaderConstructor::create(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    auto* structure = createStructure(vm, globalObject, prototype);
    JSReadableStreamBYOBReaderConstructor* constructor = new (NotNull, allocateCell<JSReadableStreamBYOBReaderConstructor>(vm)) JSReadableStreamBYOBReaderConstructor(vm, structure);
    constructor->finishCreation(vm, prototype);
    return constructor;
}

Structure* JSReadableStreamBYOBReaderConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

} // namespace Bun
