#include "JSPrivateKeyObject.h"
#include "JSPrivateKeyObjectPrototype.h"
#include "JSKeyObjectConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSPrivateKeyObject::s_info = { "PrivateKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPrivateKeyObject) };

void JSPrivateKeyObject::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm, globalObject);
}

template<typename Visitor>
void JSPrivateKeyObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSPrivateKeyObject* thisObject = jsCast<JSPrivateKeyObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_keyDetails);
}

DEFINE_VISIT_CHILDREN(JSPrivateKeyObject);

void setupPrivateKeyObjectClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* globalObject = defaultGlobalObject(init.global);

    auto* prototypeStructure = JSPrivateKeyObjectPrototype::createStructure(init.vm, init.global, globalObject->KeyObjectPrototype());
    auto* prototype = JSPrivateKeyObjectPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSKeyObjectConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSKeyObjectConstructor::create(init.vm, init.global, constructorStructure, prototype);

    auto* structure = JSPrivateKeyObject::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
