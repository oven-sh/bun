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

JSValue DictionaryMemberReader::get(const Identifier& name)
{
    // Asked per member: converting one can run JavaScript.
    if (canSkipPrototypeChain(m_globalObject, m_object)) [[likely]] {
        unsigned attributes = 0;
        JSValue value = m_object->getDirect(m_vm, name, attributes);
        if (!value)
            return jsUndefined();
        if (!(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) [[likely]]
            return value;
    }
    return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, name);
}

JSValue DictionaryMemberReader::getOwn(unsigned index)
{
    auto scope = DECLARE_THROW_SCOPE(m_vm);
    JSValue value = getOwnIfPresent(index);
    RETURN_IF_EXCEPTION(scope, {});
    return value ? value : jsUndefined();
}

JSValue DictionaryMemberReader::getOwnIfPresent(unsigned index)
{
    auto scope = DECLARE_THROW_SCOPE(m_vm);
    PropertySlot slot(m_object, PropertySlot::InternalMethodType::GetOwnProperty);
    bool found = JSValue(m_object).getOwnPropertySlot(m_globalObject, m_memberNames[index], slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!found)
        return {};
    RELEASE_AND_RETURN(scope, slot.getValue(m_globalObject, m_memberNames[index]));
}

}
