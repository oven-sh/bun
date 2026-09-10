#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>

namespace Bun {

class JSHashPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHashPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSHashPrototype* prototype = new (NotNull, JSC::allocateCell<JSHashPrototype>(vm)) JSHashPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSHashPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

} // namespace Bun
