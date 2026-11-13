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

JSValue DictionaryMemberReader::get(unsigned index)
{
    if (!m_object) [[unlikely]]
        return jsUndefined();
    // Asked per member: converting one can run JavaScript.
    if (m_object->type() == FinalObjectType && canSkipPrototypeChain(m_globalObject, m_object)) [[likely]] {
        unsigned attributes = 0;
        JSValue value = m_object->getDirect(m_vm, m_memberNames[index], attributes);
        if (!value)
            return jsUndefined();
        if (!(attributes & PropertyAttribute::AccessorOrCustomAccessorOrValue)) [[likely]]
            return value;
    } else if (AOT::PropertyWalk::isCompiledObject(m_object) && canSkipPrototypeChain(m_globalObject, m_object)) {
        JSValue value;
        switch (AOT::PropertyWalk::tryGetOwnValue(m_object, m_memberNames[index].impl(), value)) {
        case AOT::PropertyWalk::Presence::Present:
            return value;
        case AOT::PropertyWalk::Presence::Absent:
            return jsUndefined();
        case AOT::PropertyWalk::Presence::Unknown:
            break;
        }
    }
    return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
}

}
