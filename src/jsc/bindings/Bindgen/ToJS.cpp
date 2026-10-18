#include "root.h"
#include "Bindgen/SchemaStrings.h"
#include "ErrorCode.h"
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

// 0 is also what an iterator of unknown length reports, so it gets the inline room of `{}`.
extern "C" EncodedJSValue Bun__Bindgen__createRecord(JSGlobalObject* globalObject, size_t capacity)
{
    if (!capacity)
        return JSValue::encode(constructEmptyObject(globalObject));
    return JSValue::encode(constructEmptyObject(globalObject, globalObject->objectPrototype(), static_cast<unsigned>(std::min<size_t>(capacity, JSFinalObject::maxInlineCapacity))));
}

extern "C" bool Bun__Bindgen__putRecordEntry(JSGlobalObject* globalObject, EncodedJSValue record, const uint8_t* key, size_t keyLength, EncodedJSValue value)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (keyLength > WTF::String::MaxLength) [[unlikely]] {
        Bun::ERR::STRING_TOO_LONG(scope, globalObject);
        return false;
    }
    auto name = Identifier::fromString(vm, WTF::String::fromUTF8ReplacingInvalidSequences(std::span { key, keyLength }));
    asObject(JSValue::decode(record))->putDirectMayBeIndex(globalObject, name, JSValue::decode(value));
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
