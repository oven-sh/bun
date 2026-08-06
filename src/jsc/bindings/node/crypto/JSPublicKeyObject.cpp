#include "JSPublicKeyObject.h"
#include "JSPublicKeyObjectPrototype.h"
#include "JSPublicKeyObjectConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSPublicKeyObject::s_info = { "PublicKeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPublicKeyObject) };

void JSPublicKeyObject::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm, globalObject);
}

void setupPublicKeyObjectClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* globalObject = defaultGlobalObject(init.global);

    JSObject* asymmetricKeyObjectPrototype = globalObject->m_JSAsymmetricKeyObjectPrototype.getInitializedOnMainThread(globalObject);
    auto* prototypeStructure = JSPublicKeyObjectPrototype::createStructure(init.vm, init.global, asymmetricKeyObjectPrototype);
    auto* prototype = JSPublicKeyObjectPrototype::create(init.vm, init.global, prototypeStructure);

    // Parent the constructor on KeyObject so statics (KeyObject.from) inherit, like
    // Node's `class PublicKeyObject extends AsymmetricKeyObject extends KeyObject`.
    auto* constructorStructure = JSPublicKeyObjectConstructor::createStructure(init.vm, init.global, globalObject->KeyObject());
    auto* constructor = JSPublicKeyObjectConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSPublicKeyObject::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
