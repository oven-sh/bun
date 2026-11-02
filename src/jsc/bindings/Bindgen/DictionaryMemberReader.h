#pragma once
#include "root.h"
#include "Bindgen/SchemaStrings.h"
#include <JavaScriptCore/JSObject.h>

namespace Bun::Bindgen {

// Reads the members of a dictionary, by index into its run of Tables::memberNames.
class DictionaryMemberReader {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    DictionaryMemberReader(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, unsigned firstMemberNameIndex, unsigned memberNameCount)
        : m_vm(vm)
        , m_globalObject(globalObject)
        , m_object(object)
        , m_memberNames(schemaStrings(vm).memberNames(firstMemberNameIndex, memberNameCount))
    {
    }

    // Empty if it threw.
    ALWAYS_INLINE JSC::JSValue get(unsigned index)
    {
        // Most objects have few of the members, and the structure of a plain one rules out nearly all the others without a call or a lookup.
        if (m_object->structureID() == m_plainStructureID && m_plainStructure->seenProperties().ruleOut(WTF::CompactPtr<WTF::UniquedStringImpl>::encode(m_memberNames[index].impl())))
            return JSC::jsUndefined();
        return getSlow(index);
    }

private:
    // Out of line: inlined, it is most of the size of every generated dictionary converter.
    NEVER_INLINE JSC::JSValue getSlow(unsigned index);

    JSC::VM& m_vm;
    JSC::JSGlobalObject* m_globalObject;
    JSC::JSObject* m_object;
    const JSC::Identifier* m_memberNames;
    // The structure `m_object` had when `getSlow` last looked, if it was a plain object then. And its id, which `get` compares with that of the object as it is stored there.
    JSC::Structure* m_plainStructure { nullptr };
    JSC::StructureID m_plainStructureID;
};

}
