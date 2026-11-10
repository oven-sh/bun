#pragma once
#include "root.h"
#include "GeneratedBindings+Counts.h"
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun::Bindgen {

// The per-global-object state of generated bindings.
struct AdditionsToGlobalObject {
    void initialize();

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        for (auto& lazyClass : m_classes)
            lazyClass.visit(visitor);
        for (auto& structure : m_returnedDictionaryStructures)
            visitor.append(structure);
    }

    // By `classIndex`.
    JSC::LazyClassStructure m_classes[Counts::numberOfClasses];
    // What an object with every member of a returned dictionary has, made when the first is returned.
    JSC::WriteBarrier<JSC::Structure> m_returnedDictionaryStructures[Counts::numberOfReturnedDictionaries];
};

}
