#pragma once
#include "root.h"
#include "Bindgen/Identifiers.h"
#include <JavaScriptCore/JSObject.h>

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

    // May throw. Out of line: inlined, it is most of the size of every generated convertDictionary.
    JSC::JSValue get(unsigned index);

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
