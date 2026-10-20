#include "root.h"
#include "Bindgen/SchemaStrings.h"
#include "helpers.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun::Bindgen {
using namespace JSC;

// The members are named by Tables::memberNames, from `firstMemberNameIndex`. An empty value is a member that is absent.
static EncodedJSValue putMembers(VM& vm, JSObject* object, unsigned firstMemberNameIndex, const JSValue* values, size_t count)
{
    const Identifier* memberNames = schemaStrings(vm).memberNames(firstMemberNameIndex, count);
    for (size_t i = 0; i < count; ++i) {
        if (values[i])
            object->putDirect(vm, memberNames[i], values[i]);
    }
    return JSValue::encode(object);
}

extern "C" EncodedJSValue Bun__Bindgen__createObject(JSGlobalObject* globalObject, unsigned firstMemberNameIndex, const JSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    JSObject* object = constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min<unsigned>(count, JSFinalObject::maxInlineCapacity));
    return putMembers(vm, object, firstMemberNameIndex, values, count);
}

extern "C" EncodedJSValue Bun__Bindgen__createNullPrototypeObject(JSGlobalObject* globalObject, unsigned firstMemberNameIndex, const JSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    JSObject* object = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    return putMembers(vm, object, firstMemberNameIndex, values, count);
}

extern "C" bool Bun__Bindgen__putRecordEntry(JSGlobalObject* globalObject, EncodedJSValue record, const uint8_t* key, size_t keyLength, EncodedJSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto name = Zig::convertUTF8ToString(std::span { key, keyLength });
    if (name.isNull()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return false;
    }
    asObject(JSValue::decode(record))->putDirectMayBeIndex(globalObject, Identifier::fromString(vm, name), JSValue::decode(value));
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

extern "C" EncodedJSValue Bun__Bindgen__enumerationValueToJS(JSGlobalObject* globalObject, unsigned index)
{
    return JSValue::encode(schemaStrings(getVM(globalObject)).enumerationValue(index));
}

extern "C" EncodedJSValue Bun__Bindgen__constructArrayFromValues(JSGlobalObject* globalObject, const JSValue* values, size_t count)
{
    return JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values, count));
}

}
