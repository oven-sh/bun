
#pragma once

#include "root.h"

namespace Bun {

class JSSocketAddressPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSSocketAddressPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSSocketAddressPrototype* ptr = new (NotNull, JSC::allocateCell<JSSocketAddressPrototype>(vm)) JSSocketAddressPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSSocketAddressPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

protected:
    JSSocketAddressPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    // void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    // void finishCreation(JSC::VM& vm) { Base::finishCreation(vm); }
    DECLARE_DEFAULT_FINISH_CREATION;
};

} // namespace Bun
