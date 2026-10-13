#pragma once
#include "root.h"
#include "Bindgen/Identifiers.h"
#include "ObjectBindings.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/StructureInlines.h>

namespace Bun::Bindgen {

// Reads the members of a dictionary, by index into its run of Tables::memberNames.
//
// Every lookup follows one rule: own properties, then the prototype chain up to but not including
// Object.prototype. For a plain object whose prototype is Object.prototype or null, the own property
// table is therefore the whole answer, and it is read directly: no PropertySlot, no walk. Reading
// data properties is unobservable, so they are all read up front.
template<unsigned memberNameCount>
class DictionaryMemberReader {
public:
    DictionaryMemberReader(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, unsigned firstMemberNameIndex)
        : m_vm(vm)
        , m_globalObject(globalObject)
        , m_object(object)
        , m_memberNames(identifiers(vm).identifiersAt(firstMemberNameIndex, memberNameCount))
        , m_isPlainObject(readPlainObject())
    {
    }

    // May throw.
    ALWAYS_INLINE JSC::JSValue get(unsigned index)
    {
        if (m_isPlainObject) [[likely]]
            return m_values[index];
        return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
    }

private:
    bool readPlainObject()
    {
        if (m_object->type() != JSC::FinalObjectType)
            return false;
        JSC::Structure* structure = m_object->structure();
        if (structure->hasPolyProto())
            return false;
        JSC::JSValue prototype = structure->storedPrototype();
        if (prototype != m_globalObject->objectPrototype() && !prototype.isNull())
            return false;
        for (unsigned i = 0; i < memberNameCount; ++i) {
            unsigned attributes = 0;
            JSC::PropertyOffset offset = structure->get(m_vm, m_memberNames[i], attributes);
            if (offset == JSC::invalidOffset)
                m_values[i] = JSC::jsUndefined();
            else if (attributes & (JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::CustomAccessorOrValue)) [[unlikely]]
                return false;
            else
                m_values[i] = m_object->getDirect(offset);
        }
        return true;
    }

    JSC::VM& m_vm;
    JSC::JSGlobalObject* m_globalObject;
    JSC::JSObject* m_object;
    const JSC::Identifier* m_memberNames;
    JSC::JSValue m_values[memberNameCount];
    bool m_isPlainObject;
};

}
