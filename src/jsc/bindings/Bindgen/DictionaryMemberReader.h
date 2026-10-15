#pragma once
#include "root.h"
#include "Bindgen/SchemaStrings.h"
#include <JavaScriptCore/JSObject.h>

namespace Bun::Bindgen {

// Reads the members of a dictionary, by index into its run of Tables::memberNames.
class DictionaryMemberReader {
public:
    DictionaryMemberReader(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, unsigned firstMemberNameIndex, unsigned memberNameCount)
        : m_vm(vm)
        , m_globalObject(globalObject)
        , m_object(object)
        , m_memberNames(schemaStrings(vm).memberNames(firstMemberNameIndex, memberNameCount))
    {
    }

    // May throw. Out of line: inlined, it is most of the size of every generated dictionary converter.
    NEVER_INLINE JSC::JSValue get(unsigned index);

private:
    // `get` stops before Object.prototype. Asked per member: converting one can run JavaScript.
    ALWAYS_INLINE bool canSkipPrototypeChain() const
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
