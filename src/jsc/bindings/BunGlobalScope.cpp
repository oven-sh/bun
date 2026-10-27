
#include "root.h"
#include "ZigGlobalObject.h"
#include "BunGlobalScope.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/VMTraps.h"
#include "JavaScriptCore/VMTrapsInlines.h"
#include "JavaScriptCore/LazyClassStructure.h"
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/TypeError.h"
#include "BunClientData.h"

namespace Bun {

using namespace JSC;

// The structure of the object literal `{ first, second }`: `first` is at offset 0 and `second` at offset 1.
static Structure* createPairObjectStructure(VM& vm, JSGlobalObject& globalObject, PropertyName first, PropertyName second)
{
    Structure* structure = globalObject.structureCache().emptyObjectStructureForPrototype(&globalObject, globalObject.objectPrototype(), 2);
    PropertyOffset offset;
    structure = Structure::addPropertyTransition(vm, structure, first, 0, offset);
    RELEASE_ASSERT(offset == 0);
    structure = Structure::addPropertyTransition(vm, structure, second, 0, offset);
    RELEASE_ASSERT(offset == 1);
    return structure;
}

void GlobalScope::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_encodeIntoObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& builtinNames = WebCore::clientData(init.vm)->builtinNames();
            init.set(createPairObjectStructure(init.vm, *init.owner, builtinNames.readPublicName(), builtinNames.writtenPublicName()));
        });
    m_bufferToJSONObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& builtinNames = WebCore::clientData(init.vm)->builtinNames();
            init.set(createPairObjectStructure(init.vm, *init.owner, init.vm.propertyNames->type, builtinNames.dataPublicName()));
        });
}

bool GlobalScope::setPrototype(JSObject* object, JSGlobalObject* globalObject, JSValue prototype, bool shouldThrowIfCantSet)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* proxy = uncheckedDowncast<GlobalScope>(object)->globalThis();

    if (proxy->getPrototypeDirect() == prototype)
        return true;

    // A prototype chain holds the global's proxy, which the cycle check in JSObject doesn't compare with.
    for (JSValue next = prototype; next.isObject() && asObject(next)->type() != ProxyObjectType; next = asObject(next)->getPrototypeDirect()) {
        if (next == proxy && object->isStructureExtensible())
            return typeError(globalObject, scope, shouldThrowIfCantSet, "cyclic __proto__ value"_s);
    }

    bool didSet = Base::setPrototype(object, globalObject, prototype, shouldThrowIfCantSet);
    RETURN_IF_EXCEPTION(scope, false);
    // The cycle check of any other object walks through the proxy's own prototype.
    if (didSet)
        proxy->setPrototypeDirect(vm, prototype);
    return didSet;
}

DEFINE_VISIT_CHILDREN(GlobalScope);

template<typename Visitor>
void GlobalScope::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    GlobalScope* thisObject = uncheckedDowncast<GlobalScope>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    thisObject->m_encodeIntoObjectStructure.visit(visitor);
    thisObject->m_bufferToJSONObjectStructure.visit(visitor);
}

const JSC::ClassInfo GlobalScope::s_info = { "GlobalScope"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(GlobalScope) };

}
