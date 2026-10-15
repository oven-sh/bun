#include "root.h"
#include "Bindgen/DictionaryMemberReader.h"
#include "ObjectBindings.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/StructureInlines.h>

namespace Bun::Bindgen {
using namespace JSC;

JSValue DictionaryMemberReader::get(unsigned index)
{
    if (canSkipPrototypeChain()) [[likely]] {
        unsigned attributes = 0;
        PropertyOffset offset = m_object->structure()->get(m_vm, m_memberNames[index], attributes);
        if (offset == invalidOffset)
            return jsUndefined();
        if (!(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue))) [[likely]]
            return m_object->getDirect(offset);
    }
    return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
}

}
