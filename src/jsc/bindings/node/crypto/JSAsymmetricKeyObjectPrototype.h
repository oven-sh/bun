#pragma once

#include "root.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

// The shared prototype that PublicKeyObject.prototype and PrivateKeyObject.prototype inherit
// from, mirroring Node's KeyObject -> AsymmetricKeyObject -> Public/PrivateKeyObject hierarchy.
// It owns the `asymmetricKeyType` and `asymmetricKeyDetails` getters.
class JSAsymmetricKeyObjectPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSAsymmetricKeyObjectPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSAsymmetricKeyObjectPrototype* prototype = new (NotNull, JSC::allocateCell<JSAsymmetricKeyObjectPrototype>(vm)) JSAsymmetricKeyObjectPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSAsymmetricKeyObjectPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

void setupAsymmetricKeyObjectPrototype(const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSObject>::Initializer& init);

} // namespace Bun
