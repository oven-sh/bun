#include "JSPublicKeyObject.h"
#include "JSPublicKeyObjectPrototype.h"
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

const JSC::ClassInfo JSPublicKeyObject::s_info = { "PublicKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPublicKeyObject) };

void JSPublicKeyObject::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm, globalObject);
}

template<typename Visitor>
void JSPublicKeyObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSPublicKeyObject* thisObject = jsCast<JSPublicKeyObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_keyDetails);
}

DEFINE_VISIT_CHILDREN(JSPublicKeyObject);

void setupPublicKeyObjectClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* globalObject = defaultGlobalObject(init.global);

    auto* prototypeStructure = JSPublicKeyObjectPrototype::createStructure(init.vm, init.global, globalObject->KeyObjectPrototype());
    auto* prototype = JSPublicKeyObjectPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSKeyObjectConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSKeyObjectConstructor::create(init.vm, init.global, constructorStructure, prototype);

    auto* structure = JSPublicKeyObject::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
