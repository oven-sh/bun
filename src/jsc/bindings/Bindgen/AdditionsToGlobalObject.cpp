#include "root.h"
#include "Bindgen/AdditionsToGlobalObject.h"
#include "Bindgen/JSWrapper.h"
#include "GeneratedBindings+Tables.h"
#include "ZigGlobalObject.h"

namespace Bun::Bindgen {

void AdditionsToGlobalObject::initialize()
{
    // One callback for every class, which it tells apart by where the LazyClassStructure is, as in GlobalObject::initGeneratedLazyClasses.
    for (auto& lazyClass : m_classes) {
        lazyClass.initLater([](JSC::LazyClassStructure::Initializer& init) {
            size_t classIndex = &init.classStructure - defaultGlobalObject(init.global)->m_bindgenAdditions.m_classes;
            RELEASE_ASSERT(classIndex < Tables::classes.size());
            setupClassStructure(init, classIndex);
        });
    }
}

}
