#pragma once

#include "root.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

class JSPrivateKeyObjectPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSPrivateKeyObjectPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSPrivateKeyObjectPrototype* prototype = new (NotNull, JSC::allocateCell<JSPrivateKeyObjectPrototype>(vm)) JSPrivateKeyObjectPrototype(vm, structure);
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
    JSPrivateKeyObjectPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace Bun
