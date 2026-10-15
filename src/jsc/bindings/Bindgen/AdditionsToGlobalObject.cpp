#include "root.h"
#include "Bindgen/AdditionsToGlobalObject.h"
#include "Bindgen/JSWrapper.h"
#include "Bindgen/ToJS.h"
#include "GeneratedBindings+Tables.h"
#include "ZigGlobalObject.h"

namespace Bun::Bindgen {

AdditionsToGlobalObject::AdditionsToGlobalObject()
    : m_objectStructures(Tables::objectStructures.size())
    , m_classes(Tables::classes.size())
{
}

void AdditionsToGlobalObject::initialize()
{
    for (auto& structure : m_objectStructures) {
        structure.initLater([](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& additions = defaultGlobalObject(init.owner)->m_bindgenAdditions;
            init.set(createObjectStructure(init.vm, init.owner, &init.property - additions.m_objectStructures.begin()));
        });
    }
    for (auto& lazyClass : m_classes) {
        lazyClass.initLater([](JSC::LazyClassStructure::Initializer& init) {
            auto& additions = defaultGlobalObject(init.global)->m_bindgenAdditions;
            setupClassStructure(init, &init.classStructure - additions.m_classes.begin());
        });
    }
}

}
