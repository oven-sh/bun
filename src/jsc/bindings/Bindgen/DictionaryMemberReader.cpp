#include "root.h"
#include "Bindgen/DictionaryMemberReader.h"
#include "ObjectBindings.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun::Bindgen {
using namespace JSC;

// `get` stops before Object.prototype.
static ALWAYS_INLINE bool canSkipPrototypeChain(JSGlobalObject* globalObject, JSObject* object)
{
    if (object->type() != FinalObjectType)
        return false;
    JSValue prototype = object->getPrototypeDirect();
    return prototype == globalObject->objectPrototype() || prototype.isNull();
}

JSValue DictionaryMemberReader::get(unsigned index)
{
    // Asked per member: converting one can run JavaScript.
    if (canSkipPrototypeChain(m_globalObject, m_object)) [[likely]] {
        unsigned attributes = 0;
        JSValue value = m_object->getDirect(m_vm, m_memberNames[index], attributes);
        if (!value)
            return jsUndefined();
        if (!(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) [[likely]]
            return value;
    }
    return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
}

}
