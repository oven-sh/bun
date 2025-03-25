#include "JSCipher.h"
#include "JSCipherPrototype.h"
#include "JSCipherConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSCipher::s_info = { "Cipher"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCipher) };

void JSCipher::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSCipher::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSCipher* thisObject = jsCast<JSCipher*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSCipher);

void setupCipherClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSCipherPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSCipherPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSCipherConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSCipherConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSCipher::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
