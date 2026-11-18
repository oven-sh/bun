#pragma once
#include "root.h"

namespace Bun::Bindgen {

// The number of the interface, if the realm has made it.
std::optional<unsigned> interfaceWithPrototype(JSC::JSGlobalObject*, JSC::JSObject*);
std::optional<unsigned> interfaceWithConstructor(JSC::JSGlobalObject*, JSC::JSObject*);
unsigned interfaceOf(JSC::JSObject* cell);

// While it lives, the setter of a [Replaceable] attribute only says that it is one.
class Replacement {
public:
    explicit Replacement(JSC::PropertyName name)
        : m_name(name)
        , m_scope(current, this)
    {
    }
    bool wasAskedFor() const { return m_wasAskedFor; }
    static bool intercepts(JSC::PropertyName name) { return current && current->m_name == name && (current->m_wasAskedFor = true); }

private:
    static inline thread_local Replacement* current;
    JSC::PropertyName m_name;
    SetForScope<Replacement*> m_scope;
    bool m_wasAskedFor { false };
};

}
