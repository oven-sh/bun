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

    // Empty if it threw. Out of line: inlined, it is most of the size of every generated dictionary converter.
    NEVER_INLINE JSC::JSValue get(unsigned index);

private:
    JSC::VM& m_vm;
    JSC::JSGlobalObject* m_globalObject;
    JSC::JSObject* m_object;
    const JSC::Identifier* m_memberNames;
};

}
