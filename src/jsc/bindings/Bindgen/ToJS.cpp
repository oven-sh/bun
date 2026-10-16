#include "root.h"
#include "Bindgen/ToJS.h"
#include "Bindgen/SchemaStrings.h"
#include "GeneratedBindings+Tables.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/StructureInlines.h>
#include <algorithm>

namespace Bun::Bindgen {
using namespace JSC;

static_assert(std::ranges::all_of(Tables::objectStructures, [](const auto& structure) { return structure.memberCount <= JSFinalObject::maxInlineCapacity; }), "a returned dictionary has more members than an object holds inline");

Structure* createObjectStructure(VM& vm, JSGlobalObject* globalObject, unsigned index)
{
    auto [firstMemberNameIndex, memberCount] = Tables::objectStructures[index];
    const Identifier* memberNames = schemaStrings(vm).memberNames(firstMemberNameIndex, memberCount);
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), memberCount);
    for (unsigned i = 0; i < memberCount; ++i) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, memberNames[i], 0, offset);
        RELEASE_ASSERT(offset == static_cast<PropertyOffset>(i));
    }
    return structure;
}

// An empty value is a member that is absent.
extern "C" EncodedJSValue Bun__Bindgen__createObject(JSGlobalObject* globalObject, unsigned structureIndex, const EncodedJSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    auto* global = defaultGlobalObject(globalObject);
    ASSERT(count == Tables::objectStructures[structureIndex].memberCount);
    bool hasEveryMember = true;
    for (size_t i = 0; i < count; ++i)
        hasEveryMember &= !!values[i];
    if (hasEveryMember) [[likely]] {
        JSObject* object = constructEmptyObject(vm, global->m_bindgenAdditions.m_objectStructures[structureIndex].get(global));
        for (size_t i = 0; i < count; ++i)
            object->putDirectOffset(vm, static_cast<PropertyOffset>(i), JSValue::decode(values[i]));
        return JSValue::encode(object);
    }
    const Identifier* memberNames = schemaStrings(vm).memberNames(Tables::objectStructures[structureIndex].firstMemberNameIndex, count);
    JSObject* object = constructEmptyObject(global, global->objectPrototype(), count);
    for (size_t i = 0; i < count; ++i) {
        if (values[i])
            object->putDirect(vm, memberNames[i], JSValue::decode(values[i]));
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
