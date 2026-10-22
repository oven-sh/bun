#include "root.h"
#include "Bindgen/SchemaStrings.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun::Bindgen {
using namespace JSC;

static NEVER_INLINE Structure* createReturnedDictionaryStructure(VM& vm, Zig::GlobalObject* globalObject, WriteBarrier<Structure>& cached, unsigned firstMemberNameIndex, unsigned count)
{
    const Identifier* memberNames = schemaStrings(vm).memberNames(firstMemberNameIndex, count);
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), count);
    for (unsigned i = 0; i < count; ++i) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, memberNames[i], 0, offset);
        RELEASE_ASSERT(offset == static_cast<PropertyOffset>(i));
    }
    cached.set(vm, globalObject, structure);
    return structure;
}

// The members are named by Tables::memberNames, from `firstMemberNameIndex`. An empty value is a member that is absent.
extern "C" EncodedJSValue Bun__Bindgen__createObject(JSGlobalObject* globalObject, unsigned firstMemberNameIndex, unsigned dictionaryIndex, bool hasEveryMember, const JSValue* values, size_t count)
{
    VM& vm = getVM(globalObject);
    if (!hasEveryMember) {
        hasEveryMember = true;
        for (size_t i = 0; i < count; ++i)
            hasEveryMember &= !!values[i];
    }
    hasEveryMember &= count <= JSFinalObject::maxInlineCapacity;
    if (auto* owner = dynamicDowncast<Zig::GlobalObject>(globalObject); owner && hasEveryMember) [[likely]] {
        auto& cached = owner->m_bindgenAdditions.m_returnedDictionaryStructures[dictionaryIndex];
        Structure* structure = cached.get();
        if (!structure) [[unlikely]]
            structure = createReturnedDictionaryStructure(vm, owner, cached, firstMemberNameIndex, count);
        JSObject* object = constructEmptyObject(vm, structure);
        // Nothing was allocated since, so the collector has not looked at the object, and no write needs a barrier.
        static_assert(sizeof(WriteBarrier<Unknown>) == sizeof(JSValue));
        memcpy(static_cast<void*>(object->inlineStorage()), values, count * sizeof(JSValue));
        return JSValue::encode(object);
    }
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

}
