#include "root.h"
#include "Bindgen/DictionaryMemberReader.h"
#include "ObjectBindings.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun::Bindgen {
using namespace JSC;

// `get` stops before Object.prototype, so the own properties of a plain object are the whole answer. Null for any other object.
static ALWAYS_INLINE Structure* plainStructureOf(JSGlobalObject* globalObject, JSObject* object)
{
    if (object->type() != FinalObjectType)
        return nullptr;
    Structure* structure = object->structure();
    // The prototype of an object with a poly proto changes without its structure.
    if (!structure->hasMonoProto())
        return nullptr;
    JSValue prototype = structure->storedPrototype();
    return prototype == globalObject->objectPrototype() || prototype.isNull() ? structure : nullptr;
}

JSValue DictionaryMemberReader::getSlow(unsigned index)
{
    // Asked again when the structure is another: converting a member can run JavaScript.
    if (m_object->structureID() != m_plainStructureID) {
        m_plainStructure = plainStructureOf(m_globalObject, m_object);
        m_plainStructureID = m_plainStructure ? m_plainStructure->id() : StructureID();
    }
    if (m_plainStructure) [[likely]] {
        unsigned attributes = 0;
        PropertyOffset offset = m_plainStructure->get(m_vm, m_memberNames[index], attributes);
        if (offset == invalidOffset)
            return jsUndefined();
        if (!(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) [[likely]]
            return m_object->getDirect(offset);
    }
    return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
}

}
