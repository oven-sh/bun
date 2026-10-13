#pragma once
#include "root.h"
#include "Bindgen/Identifiers.h"
#include "ObjectBindings.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/StructureInlines.h>

namespace Bun::Bindgen {

// Reads the members of a dictionary, by index into its run of Tables::memberNames.
class DictionaryMemberReader {
public:
    DictionaryMemberReader(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, unsigned firstMemberNameIndex, unsigned memberNameCount)
        : m_vm(vm)
        , m_globalObject(globalObject)
        , m_object(object)
        , m_memberNames(identifiers(vm).identifiersAt(firstMemberNameIndex, memberNameCount))
    {
    }

    // May throw.
    ALWAYS_INLINE JSC::JSValue get(unsigned index)
    {
        if (ownPropertiesAreTheWholeAnswer()) [[likely]] {
            unsigned attributes = 0;
            JSC::PropertyOffset offset = m_object->structure()->get(m_vm, m_memberNames[index], attributes);
            if (offset == JSC::invalidOffset)
                return JSC::jsUndefined();
            if (!(attributes & (JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::CustomAccessorOrValue))) [[likely]]
                return m_object->getDirect(offset);
        }
        return getIfPropertyExistsPrototypePollutionMitigation(m_vm, m_globalObject, m_object, m_memberNames[index]);
    }

private:
    // The lookup below stops before Object.prototype. Asked per member: converting one can run JavaScript.
    ALWAYS_INLINE bool ownPropertiesAreTheWholeAnswer() const
    {
        if (m_object->type() != JSC::FinalObjectType)
            return false;
        JSC::Structure* structure = m_object->structure();
        if (structure->hasPolyProto())
            return false;
        JSC::JSValue prototype = structure->storedPrototype();
        return prototype == m_globalObject->objectPrototype() || prototype.isNull();
    }

    JSC::VM& m_vm;
    JSC::JSGlobalObject* m_globalObject;
    JSC::JSObject* m_object;
    const JSC::Identifier* m_memberNames;
};

}
