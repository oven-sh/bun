#pragma once
#include "root.h"
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyProperty.h>
#include <wtf/FixedVector.h>

namespace Bun {

// The per-global-object state of generated bindings, by index into Bindgen::Tables.
struct BindgenAdditionsToGlobalObject {
    BindgenAdditionsToGlobalObject();
    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        for (auto& structure : m_objectStructures)
            structure.visit(visitor);
        for (auto& lazyClass : m_classes)
            lazyClass.visit(visitor);
    }

    // Sized by the constructor, so the marker never sees them change.
    WTF::FixedVector<JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>> m_objectStructures;
    WTF::FixedVector<JSC::LazyClassStructure> m_classes;
};

}
