#pragma once
#include "root.h"
#include "GeneratedBindings+Counts.h"
#include <JavaScriptCore/LazyClassStructure.h>

namespace Bun::Bindgen {

// The per-global-object state of generated bindings.
struct AdditionsToGlobalObject {
    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        for (auto& lazyClass : m_classes)
            lazyClass.visit(visitor);
    }

    // By `classIndex`.
    JSC::LazyClassStructure m_classes[Counts::numberOfClasses];
};

}
