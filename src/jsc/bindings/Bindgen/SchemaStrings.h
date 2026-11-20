#pragma once
#include "root.h"
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSString.h>
#include <wtf/FixedVector.h>

namespace Bun::Bindgen {

// The strings schemas name, per VM: Identifiers for dictionary members and JSStrings for enumeration values, each made on first use.
class SchemaStrings {
    WTF_MAKE_NONCOPYABLE(SchemaStrings);
    WTF_MAKE_NONMOVABLE(SchemaStrings);

public:
    explicit SchemaStrings(JSC::VM&);

    // `count` of them, starting at Tables::memberNames[first] (GeneratedBindings+Tables.h).
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
    WTF::FixedVector<JSC::Identifier> m_memberNames;
    WTF::FixedVector<JSC::JSString*> m_enumerationValues;
};

SchemaStrings& schemaStrings(JSC::VM&);

}
