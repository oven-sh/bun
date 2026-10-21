#include "root.h"
#include "Bindgen/AdditionsToGlobalObject.h"
#include "GeneratedBindings+Classes.h"
#include "ZigGlobalObject.h"

namespace Bun::Bindgen {

void AdditionsToGlobalObject::initialize()
{
    for (auto& lazyClass : m_classes) {
        lazyClass.initLater([](JSC::LazyClassStructure::Initializer& init) {
            // Every caller of `get` passes the global object that holds the class.
            auto& classes = uncheckedDowncast<Zig::GlobalObject>(init.global)->m_bindgenAdditions.m_classes;
            Generated::setupClassStructure[&init.classStructure - classes](init);
        });
    }
}

}
