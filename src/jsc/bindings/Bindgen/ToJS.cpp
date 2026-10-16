#include "root.h"
#include "Bindgen/SchemaStrings.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun::Bindgen {
using namespace JSC;

// The members are named by Tables::memberNames, from `firstMemberNameIndex`. An empty value is a member that is absent.
extern "C" EncodedJSValue Bun__Bindgen__createObject(JSGlobalObject* globalObject, unsigned firstMemberNameIndex, const JSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    const Identifier* memberNames = schemaStrings(vm).memberNames(firstMemberNameIndex, count);
    JSObject* object = constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min<unsigned>(count, JSFinalObject::maxInlineCapacity));
    for (size_t i = 0; i < count; ++i) {
        if (values[i])
            object->putDirect(vm, memberNames[i], values[i]);
    }
    return JSValue::encode(object);
}

extern "C" EncodedJSValue Bun__Bindgen__enumerationValueToJS(JSGlobalObject* globalObject, unsigned index)
{
    return JSValue::encode(schemaStrings(getVM(globalObject)).enumerationValue(index));
}

extern "C" EncodedJSValue Bun__Bindgen__constructArrayFromValues(JSGlobalObject* globalObject, const JSValue* values, size_t count)
{
    return JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values, count));
}

extern "C" EncodedJSValue Bun__Bindgen__constructArray(JSGlobalObject* globalObject, MarkedArgumentBuffer* values)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (values->hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), *values)));
}

}
