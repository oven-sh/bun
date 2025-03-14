#include "JSECDH.h"
#include "JSECDHPrototype.h"
#include "JSECDHConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

const JSC::ClassInfo JSECDH::s_info = { "ECDH"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSECDH) };

void JSECDH::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSECDH::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSECDH* thisObject = jsCast<JSECDH*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSECDH);

void setupECDHClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSECDHPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSECDHPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSECDHConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSECDHConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSECDH::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
