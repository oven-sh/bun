#include "JSConstantsObject.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSConstantsObject::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSConstantsObject) };

JSConstantsObject* JSConstantsObject::create(VM& vm, JSGlobalObject* globalObject, const ClassInfo* classInfo, JSValue prototype)
{
    ASSERT(isConstantsObjectClassInfo(classInfo));
    auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), classInfo);
    auto* object = new (NotNull, allocateCell<JSConstantsObject>(vm)) JSConstantsObject(vm, structure);
    object->finishCreation(vm);
    return object;
}

// JSC enumerates a static table in table order only until something reifies the
// whole table (Object.entries, spread, Object.assign, delete). From then on it
// enumerates the structure, which holds the properties in the order they were
// first read. The eagerly built objects this class replaces always enumerated in
// table order, so list the table first: the names JSC adds afterwards are
// duplicates, and only properties added by user code end up after the table.
// OverridesGetOwnSpecialPropertyNames in StructureFlags is what makes the
// structure-walking fast paths (Object.entries, inspect, ...) come through here.
//
// Known difference from a plain object: a table property that user code deletes
// and then assigns again still enumerates at its table position instead of last.
// Once the table is reified, the structure cannot tell that case apart from a
// property that was never deleted.
void JSConstantsObject::getOwnSpecialPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    VM& vm = globalObject->vm();
    const HashTable* table = object->classInfo()->staticPropHashTable;
    if (!table)
        return;

    bool reified = object->staticPropertiesReified();
    for (const auto& entry : *table) {
        Identifier name = Identifier::fromString(vm, entry.m_key);
        unsigned attributes;
        if (!isValidOffset(object->getDirectOffset(vm, name, attributes))) {
            // Reified and then deleted.
            if (reified)
                continue;
            attributes = entry.m_attributes;
        }
        if (mode == DontEnumPropertiesMode::Exclude && (attributes & PropertyAttribute::DontEnum))
            continue;
        propertyNames.add(name);
    }
}

bool isConstantsObjectClassInfo(const ClassInfo* classInfo)
{
    return classInfo->isSubClassOf(JSConstantsObject::info());
}

} // namespace Bun
