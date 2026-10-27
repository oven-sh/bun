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

static ALWAYS_INLINE JSValue getMember(VM& vm, JSGlobalObject* globalObject, JSObject* object, const Identifier& name)
{
    // Asked per member: converting one can run JavaScript.
    if (canSkipPrototypeChain(globalObject, object)) [[likely]] {
        unsigned attributes = 0;
        JSValue value = object->getDirect(vm, name, attributes);
        if (!value)
            return jsUndefined();
        if (!(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) [[likely]]
            return value;
    }
    return getIfPropertyExistsPrototypePollutionMitigation(vm, globalObject, object, name);
}

JSValue DictionaryMemberReader::get(const Identifier& name)
{
    return getMember(m_vm, m_globalObject, m_object, name);
}

JSValue getDictionaryMember(JSGlobalObject* globalObject, JSObject* object, unsigned memberNameIndex)
{
    auto& vm = getVM(globalObject);
    return getMember(vm, globalObject, object, schemaStrings(vm).memberNames(memberNameIndex, 1)[0]);
}

JSValue DictionaryMemberReader::getOwn(unsigned index)
{
    auto scope = DECLARE_THROW_SCOPE(m_vm);
    JSValue value = getOwnIfPropertyExists(index);
    RETURN_IF_EXCEPTION(scope, {});
    return value ? value : jsUndefined();
}

JSValue DictionaryMemberReader::getOwnIfPropertyExists(unsigned index)
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
