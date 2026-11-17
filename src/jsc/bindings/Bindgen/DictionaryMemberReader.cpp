#include "root.h"
#include "Bindgen/DictionaryMemberReader.h"
#include "ObjectBindings.h"
#include <JavaScriptCore/AOTPropertyWalk.h>
#include <JavaScriptCore/JSCInlines.h>

namespace Bun::Bindgen {
using namespace JSC;

// `get` stops before Object.prototype.
static ALWAYS_INLINE bool canSkipPrototypeChain(JSGlobalObject* globalObject, JSObject* object)
{
    JSValue prototype = object->getPrototypeDirect();
    return prototype == globalObject->objectPrototype() || prototype.isNull();
}

NEVER_INLINE JSValue DictionaryMemberReader::fullGet(unsigned index)
{
    auto scope = DECLARE_THROW_SCOPE(m_vm);
    JSValue value = m_object->get(m_globalObject, m_memberNames[index]);
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

// The object does not have it, and its prototype is Object.prototype or null.
ALWAYS_INLINE JSValue DictionaryMemberReader::inherited(unsigned index)
{
    if (m_lookup == StopsAtObjectPrototype)
        return jsUndefined();
    auto* prototype = m_globalObject->objectPrototype();
    ASSERT(!TypeInfo::hasStaticPropertyTable(prototype->inlineTypeFlags()) && !TypeInfo::overridesGetOwnPropertySlot(prototype->inlineTypeFlags()));
    if (!isValidOffset(prototype->getDirectOffset(m_vm, m_memberNames[index]))) [[likely]]
        return jsUndefined();
    return fullGet(index);
}

JSValue DictionaryMemberReader::get(unsigned index)
{
    // Asked per member: converting one can run JavaScript.
    if (m_object->type() == FinalObjectType && canSkipPrototypeChain(m_globalObject, m_object)) [[likely]] {
        unsigned attributes = 0;
        JSValue value = m_object->getDirect(m_vm, m_memberNames[index], attributes);
        if (!value)
            return inherited(index);
        if (!(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) [[likely]]
            return value;
    } else if (AOT::PropertyWalk::isCompiledObject(m_object) && canSkipPrototypeChain(m_globalObject, m_object)) {
        JSValue value;
        switch (AOT::PropertyWalk::tryGetOwnValue(m_object, m_memberNames[index].impl(), value)) {
        case AOT::PropertyWalk::Presence::Present:
            return value;
        case AOT::PropertyWalk::Presence::Absent:
            return inherited(index);
        case AOT::PropertyWalk::Presence::Unknown:
            break;
        }
    }
    if (m_lookup == ReadsObjectPrototype)
        return fullGet(index);
    return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
}

}
