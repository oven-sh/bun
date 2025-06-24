#include "JSSecretKeyObject.h"
#include "JSSecretKeyObjectPrototype.h"
#include "JSSecretKeyObjectConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSSecretKeyObject::s_info = { "SecretKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSecretKeyObject) };

void JSSecretKeyObject::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm, globalObject);
}

template<typename Visitor>
void JSSecretKeyObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSSecretKeyObject* thisObject = jsCast<JSSecretKeyObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSSecretKeyObject);

void setupSecretKeyObjectClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* globalObject = defaultGlobalObject(init.global);

    auto* prototypeStructure = JSSecretKeyObjectPrototype::createStructure(init.vm, init.global, globalObject->KeyObjectPrototype());
    auto* prototype = JSSecretKeyObjectPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSSecretKeyObjectConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSSecretKeyObjectConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSSecretKeyObject::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
