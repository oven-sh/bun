#pragma once
#include "root.h"
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSString.h>

namespace Bun::Bindgen {

// Identifiers for dictionary member names and JSStrings for enumeration values, each made on first use.
class Identifiers {
    WTF_MAKE_NONCOPYABLE(Identifiers);
    WTF_MAKE_NONMOVABLE(Identifiers);

public:
    explicit Identifiers(JSC::VM&);

    // `count` identifiers starting at Tables::memberNames[first] (GeneratedBindings+Tables.h).
    ALWAYS_INLINE const JSC::Identifier* memberNames(unsigned first, unsigned count)
    {
        if (m_memberNames[first].isNull()) [[unlikely]]
            initializeMemberNames(first, count);
        return &m_memberNames[first];
    }

    // Tables::enumerationValues[index].
    ALWAYS_INLINE JSC::JSString* enumerationValue(unsigned index)
    {
        if (!m_enumerationValues[index]) [[unlikely]]
            initializeEnumerationValue(index);
        return m_enumerationValues[index];
    }

    // Called from a marking constraint, with the world stopped.
    template<typename Visitor> void visit(Visitor&);

private:
    void initializeMemberNames(unsigned first, unsigned count);
    void initializeEnumerationValue(unsigned index);

    JSC::VM& m_vm;
    // Not arrays sized by the tables: most of the C++ includes this through BunClientData.h.
    const std::unique_ptr<JSC::Identifier[]> m_memberNames;
    const std::unique_ptr<JSC::JSString*[]> m_enumerationValues;
};

Identifiers& identifiers(JSC::VM&);

// The Structure of a returned dictionary, by index into Tables::objectStructures.
JSC::Structure* createObjectStructure(JSC::VM&, JSC::JSGlobalObject*, unsigned index);

}
